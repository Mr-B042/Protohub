// Personal Delivery Agents (migration 188) - individuals who hold Protohub
// stock and collect customer cash, kept deliberately separate from the
// logistics companies in `agents`.
//
// This slice covers the internal Overview and the agent list behind it. The
// KYC review, inventory, COD and incident surfaces build on the same tables.
//
// ⚠️ Sensitive-field discipline: KYC documents, guarantor records, bank details
// and residential addresses are the most sensitive data in Protohub. Sales Reps
// may monitor deliveries but must never see any of it, so the list response is
// filtered by role SERVER-SIDE (see `stripSensitive`) rather than hidden in the
// UI - the data never reaches their browser.
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { randomUUID } from "node:crypto";
import { approvalBlockers } from "../lib/pda-approval.js";

const router = Router();
router.use(requireAuth);

const AGENTS = "personal_delivery_agents";
const KYC = "pda_kyc_items";
const GUARANTORS = "pda_guarantors";

/** Full internal access to the module. */
const MANAGEMENT_ROLES = ["Owner", "Admin", "Manager"] as const;
/** Can see the module at all (reps get a filtered view). */
const READ_ROLES = ["Owner", "Admin", "Manager", "Sales Rep"] as const;

/** Statuses that mean the agent may actually hold stock and take orders. */
export const OPERATIONAL_STATUSES = ["Approved", "Probation", "Active"];
/** Statuses that block new work but are not a termination. */
export const RESTRICTED_STATUSES = [
  "Restricted", "Temporarily Suspended", "KYC Expired",
  "Cash Remittance Overdue", "Inventory Discrepancy"
];
/** Still going through onboarding - must not receive stock or orders. */
export const PENDING_STATUSES = [
  "Application Started", "KYC Incomplete", "KYC Submitted",
  "Guarantor Verification Pending", "Management Review"
];

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205";
}

const SELECT = `
  id, agent_code, full_name, phone, whatsapp_phone, email, state, city,
  residential_address, photo_url, service_areas, service_radius_km, transport_method,
  account_status, kyc_status, trust_level, availability,
  max_stock_units, max_cod_exposure, max_active_orders,
  bank_name, bank_account_number, bank_account_name,
  approved_at, probation_ends_at, kyc_expires_at, restriction_reason,
  created_at, updated_at
`;

const mapAgent = (row: any) => ({
  id: row.id,
  agentCode: row.agent_code,
  fullName: row.full_name,
  phone: row.phone,
  whatsappPhone: row.whatsapp_phone ?? null,
  email: row.email ?? null,
  state: row.state ?? null,
  city: row.city ?? null,
  residentialAddress: row.residential_address ?? null,
  photoUrl: row.photo_url ?? null,
  serviceAreas: Array.isArray(row.service_areas) ? row.service_areas : [],
  serviceRadiusKm: row.service_radius_km === null || row.service_radius_km === undefined
    ? null : Number(row.service_radius_km),
  transportMethod: row.transport_method ?? null,
  accountStatus: row.account_status,
  kycStatus: row.kyc_status,
  trustLevel: row.trust_level,
  availability: row.availability,
  maxStockUnits: row.max_stock_units ?? null,
  maxCodExposure: row.max_cod_exposure === null || row.max_cod_exposure === undefined
    ? null : Number(row.max_cod_exposure),
  maxActiveOrders: row.max_active_orders ?? null,
  bankName: row.bank_name ?? null,
  bankAccountNumber: row.bank_account_number ?? null,
  bankAccountName: row.bank_account_name ?? null,
  approvedAt: row.approved_at ?? null,
  probationEndsAt: row.probation_ends_at ?? null,
  kycExpiresAt: row.kyc_expires_at ?? null,
  restrictionReason: row.restriction_reason ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

type MappedAgent = ReturnType<typeof mapAgent>;

/**
 * Strips everything a Sales Rep must not see. Applied on the server so the
 * values are never sent, rather than merely hidden by the UI.
 */
function stripSensitive(agent: MappedAgent, role: string): MappedAgent | Omit<MappedAgent,
  "bankName" | "bankAccountNumber" | "bankAccountName" | "residentialAddress" | "email"> {
  if ((MANAGEMENT_ROLES as readonly string[]).includes(role)) return agent;
  const {
    bankName, bankAccountNumber, bankAccountName, residentialAddress, email,
    ...safe
  } = agent;
  return safe;
}

// ── GET /api/personal-delivery-agents ─────────────────────
router.get("/", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : null;
    let query = supabase.from(AGENTS).select(SELECT).eq("org_id", req.user!.orgId).order("created_at", { ascending: false });
    if (status && status !== "All") query = query.eq("account_status", status);
    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) { res.json({ rows: [], pendingMigration: true }); return; }
      res.status(500).json({ error: error.message });
      return;
    }
    const rows = (data ?? []).map(mapAgent).map((agent) => stripSensitive(agent, req.user!.role));
    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load personal delivery agents." });
  }
});

// ── GET /api/personal-delivery-agents/overview ────────────
// Every figure here is counted from real rows. Where a capability does not
// exist yet (agent-held inventory, COD ledger), the endpoint reports it as
// unavailable rather than returning a zero that would read as "nothing
// outstanding" - a false reassurance is worse than a blank.
router.get("/overview", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from(AGENTS)
      .select("id, account_status, kyc_status, availability, trust_level, kyc_expires_at")
      .eq("org_id", req.user!.orgId);
    if (error) {
      if (isMissingTable(error)) {
        res.json({ pendingMigration: true, totals: null });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }
    const agents = data ?? [];
    const countWhere = (fn: (row: any) => boolean) => agents.filter(fn).length;

    const byStatus: Record<string, number> = {};
    for (const agent of agents) {
      const key = String(agent.account_status ?? "Unknown");
      byStatus[key] = (byStatus[key] ?? 0) + 1;
    }

    // KYC checklist progress across every agent still in onboarding.
    const pendingIds = agents
      .filter((a: any) => PENDING_STATUSES.includes(String(a.account_status)))
      .map((a: any) => a.id);
    let kycItemsOutstanding = 0;
    let guarantorsOutstanding = 0;
    if (pendingIds.length > 0) {
      const [{ count: kycCount }, { count: guarantorCount }] = await Promise.all([
        supabase.from(KYC).select("id", { count: "exact", head: true })
          .eq("org_id", req.user!.orgId).in("agent_id", pendingIds)
          .in("status", ["Pending", "Submitted", "Replacement Requested"]),
        supabase.from(GUARANTORS).select("id", { count: "exact", head: true })
          .eq("org_id", req.user!.orgId).in("agent_id", pendingIds)
          .not("verification_status", "in", '("Approved","Rejected")')
      ]);
      kycItemsOutstanding = kycCount ?? 0;
      guarantorsOutstanding = guarantorCount ?? 0;
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    res.json({
      totals: {
        totalAgents: agents.length,
        operational: countWhere((a) => OPERATIONAL_STATUSES.includes(String(a.account_status))),
        pendingApplications: countWhere((a) => PENDING_STATUSES.includes(String(a.account_status))),
        restricted: countWhere((a) => RESTRICTED_STATUSES.includes(String(a.account_status))),
        terminated: countWhere((a) => String(a.account_status) === "Terminated"),
        rejected: countWhere((a) => String(a.account_status) === "Rejected"),
        availableNow: countWhere((a) => String(a.availability) === "Available"
          && OPERATIONAL_STATUSES.includes(String(a.account_status))),
        onProbation: countWhere((a) => String(a.trust_level) === "Probation"
          && OPERATIONAL_STATUSES.includes(String(a.account_status))),
        kycExpiringSoon: countWhere((a) => {
          const expiry = a.kyc_expires_at ? String(a.kyc_expires_at) : "";
          if (!expiry) return false;
          const days = (new Date(expiry).getTime() - new Date(todayKey).getTime()) / 86400000;
          return days <= 30;
        }),
        kycItemsOutstanding,
        guarantorsOutstanding
      },
      byStatus,
      // Named explicitly so the UI can say "not built yet" instead of showing
      // a zero that looks like a clean bill of health.
      unavailable: {
        ordersAssignedToday: "Orders & Dispatch is not built yet",
        dispatchesInProgress: "Orders & Dispatch is not built yet",
        deliveredToday: "Orders & Dispatch is not built yet",
        codOutstanding: "COD & Reconciliation is not built yet",
        inventoryHeld: "Agent inventory is not built yet",
        overdueRemittances: "COD & Reconciliation is not built yet"
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the overview." });
  }
});

// ── POST /api/personal-delivery-agents ────────────────────
// Starts an application. Everything beyond identity is filled in during KYC,
// so only the fields needed to contact the person are required here.
const CreateSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required.").max(160),
  phone: z.string().trim().min(7, "Phone number is required.").max(40),
  whatsappPhone: z.string().trim().max(40).optional(),
  email: z.string().trim().email("Enter a valid email.").max(160).optional().or(z.literal("")),
  state: z.string().trim().max(80).optional(),
  city: z.string().trim().max(80).optional(),
  transportMethod: z.enum([
    "Motorcycle", "Car", "Public transport", "Bicycle", "Walking", "Hired dispatch", "Other"
  ]).optional()
});

/** The checklist every application starts with - see the KYC section of the spec. */
const DEFAULT_KYC_ITEMS: Array<{ key: string; label: string; mandatory?: boolean }> = [
  { key: "personal_information", label: "Personal Information" },
  { key: "government_id", label: "Government-issued ID" },
  { key: "proof_of_address", label: "Proof of Address" },
  { key: "selfie_with_id", label: "Selfie holding ID" },
  { key: "live_verification_video", label: "Live Verification Video" },
  { key: "bank_account", label: "Bank Account" },
  { key: "guarantor_one", label: "Guarantor One" },
  { key: "guarantor_two", label: "Guarantor Two" },
  { key: "agent_agreement", label: "Personal Delivery Agent Agreement" },
  { key: "inventory_agreement", label: "Inventory Custody Agreement" },
  { key: "cod_agreement", label: "COD Collection & Remittance Agreement" },
  { key: "loss_damage_form", label: "Loss & Damage Responsibility Form" },
  { key: "confidentiality_agreement", label: "Data & Customer Confidentiality Agreement" },
  { key: "termination_agreement", label: "Termination & Stock Recovery Agreement" }
];

router.post("/", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = req.user!.orgId;
    // PDA-00001 style, per org.
    const { count } = await supabase.from(AGENTS)
      .select("id", { count: "exact", head: true }).eq("org_id", orgId);
    const agentCode = `PDA-${String((count ?? 0) + 1).padStart(5, "0")}`;

    const { data, error } = await supabase.from(AGENTS).insert({
      org_id: orgId,
      agent_code: agentCode,
      full_name: parsed.data.fullName,
      phone: parsed.data.phone,
      whatsapp_phone: parsed.data.whatsappPhone || null,
      email: parsed.data.email || null,
      state: parsed.data.state || null,
      city: parsed.data.city || null,
      transport_method: parsed.data.transportMethod || null,
      account_status: "Application Started",
      kyc_status: "KYC Incomplete",
      trust_level: "Probation",
      availability: "Offline"
    }).select(SELECT).single();

    if (error) {
      if (isMissingTable(error)) { res.status(503).json({ error: "Personal Delivery Agents is still being activated on this environment." }); return; }
      res.status(500).json({ error: error.message });
      return;
    }

    // Seed the checklist so review is item-by-item from the very first screen.
    await supabase.from(KYC).insert(DEFAULT_KYC_ITEMS.map((item) => ({
      org_id: orgId,
      agent_id: data.id,
      item_key: item.key,
      label: item.label,
      mandatory: item.mandatory ?? true,
      status: "Pending"
    })));

    res.status(201).json({ row: mapAgent(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not start the application." });
  }
});


// ─────────────────────────────────────────────────────────
// Applications & KYC
//
// The governing rule: nobody is approved as a whole person in one click.
// Every mandatory checklist item, both guarantors and every mandatory
// agreement must pass individually before /approve will do anything.
// ─────────────────────────────────────────────────────────

const DOCS = "pda_documents";
const KYC_BUCKET = "pda-kyc";

/** The agreements every agent must sign before handling stock or cash. */
const DEFAULT_DOCUMENTS: Array<{ key: string; label: string }> = [
  { key: "agent_agreement", label: "Personal Delivery Agent Agreement" },
  { key: "inventory_agreement", label: "Inventory Custody Agreement" },
  { key: "cod_agreement", label: "COD Collection & Remittance Agreement" },
  { key: "loss_damage_form", label: "Loss & Damage Responsibility Form" },
  { key: "confidentiality_agreement", label: "Data & Customer Confidentiality Agreement" },
  { key: "guarantor_form", label: "Guarantor Responsibility Form" },
  { key: "termination_agreement", label: "Termination & Stock Recovery Agreement" }
];

const mapKycItem = (row: any) => ({
  id: row.id,
  itemKey: row.item_key,
  label: row.label,
  mandatory: row.mandatory,
  status: row.status,
  filePath: row.file_url ?? null,
  reviewedAt: row.reviewed_at ?? null,
  reviewNote: row.review_note ?? null,
  rejectionReason: row.rejection_reason ?? null
});

const mapGuarantor = (row: any) => ({
  id: row.id,
  slot: row.slot,
  guarantorType: row.guarantor_type ?? null,
  fullName: row.full_name,
  relationship: row.relationship ?? null,
  phone: row.phone,
  whatsappPhone: row.whatsapp_phone ?? null,
  address: row.address ?? null,
  occupation: row.occupation ?? null,
  idDocumentPath: row.id_document_url ?? null,
  photoPath: row.photo_url ?? null,
  signedFormPath: row.signed_form_url ?? null,
  consentGiven: row.consent_given,
  verificationStatus: row.verification_status,
  verificationNotes: row.verification_notes ?? null,
  verifiedAt: row.verified_at ?? null,
  callScheduledAt: row.call_scheduled_at ?? null
});

const mapDocument = (row: any) => ({
  id: row.id,
  documentKey: row.document_key,
  label: row.label,
  version: row.version,
  signedFilePath: row.signed_file_url ?? null,
  uploadedAt: row.uploaded_at ?? null,
  status: row.status,
  approvedAt: row.approved_at ?? null,
  rejectionReason: row.rejection_reason ?? null
});

// ── GET /api/personal-delivery-agents/:id ─────────────────
// Management only: this returns KYC documents, guarantors and bank details.
router.get("/:id", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: agent, error } = await supabase
      .from(AGENTS).select("*").eq("org_id", orgId).eq("id", req.params.id).single();
    if (error || !agent) { res.status(404).json({ error: "Agent not found." }); return; }

    const [kycRes, guarantorRes, docRes] = await Promise.all([
      supabase.from(KYC).select("*").eq("agent_id", agent.id).order("created_at"),
      supabase.from(GUARANTORS).select("*").eq("agent_id", agent.id).order("slot"),
      supabase.from(DOCS).select("*").eq("agent_id", agent.id).order("created_at")
    ]);
    const kycItems = kycRes.data ?? [];
    const guarantors = guarantorRes.data ?? [];
    const documents = docRes.data ?? [];

    res.json({
      agent: { ...mapAgent(agent), verificationPhrase: agent.verification_phrase ?? null,
        verificationPhraseIssuedAt: agent.verification_phrase_issued_at ?? null },
      kycItems: kycItems.map(mapKycItem),
      guarantors: guarantors.map(mapGuarantor),
      documents: documents.map(mapDocument),
      blockers: approvalBlockers(kycItems as any, guarantors as any, documents as any)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the application." });
  }
});

// ── POST /api/personal-delivery-agents/media/upload ───────
// Uploads to the PRIVATE pda-kyc bucket and returns the object path, never a
// public URL. Viewing requires a signed URL from the endpoint below.
const KYC_MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
};

router.post("/media/upload", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(/^data:((?:image|video|application)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) { res.status(400).json({ error: "Invalid file data." }); return; }
  const mime = match[1].toLowerCase();
  const ext = KYC_MIME_EXT[mime];
  if (!ext) { res.status(400).json({ error: `Unsupported file type: ${mime}.` }); return; }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 50 * 1024 * 1024) { res.status(413).json({ error: "File exceeds the 50MB limit." }); return; }
  const objectName = `${req.user!.orgId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(KYC_BUCKET)
    .upload(objectName, buffer, { contentType: mime, upsert: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ path: objectName });
});

// ── GET /api/personal-delivery-agents/media/signed ────────
// Short-lived link so an ID or bank document is never reachable by URL alone.
router.get("/media/signed", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const path = typeof req.query.path === "string" ? req.query.path : "";
  // Path traversal guard, and an org can only ever reach its own prefix.
  if (!path || path.includes("..") || !path.startsWith(`${req.user!.orgId}/`)) {
    res.status(400).json({ error: "Invalid file path." });
    return;
  }
  const { data, error } = await supabase.storage.from(KYC_BUCKET).createSignedUrl(path, 300);
  if (error || !data) { res.status(500).json({ error: error?.message ?? "Could not open the file." }); return; }
  res.json({ url: data.signedUrl, expiresInSeconds: 300 });
});

// ── PATCH /api/personal-delivery-agents/kyc-items/:itemId ─
const KycReviewSchema = z.object({
  status: z.enum(["Pending", "Submitted", "Approved", "Rejected", "Replacement Requested", "Not Applicable"]),
  reviewNote: z.string().trim().max(1000).optional(),
  rejectionReason: z.string().trim().max(500).optional(),
  filePath: z.string().trim().max(500).optional()
}).superRefine((value, ctx) => {
  // A rejection with no reason gives the applicant nothing to fix and leaves
  // no record of why a reviewer said no.
  if ((value.status === "Rejected" || value.status === "Replacement Requested") && !value.rejectionReason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rejectionReason"], message: "Say what is wrong with it." });
  }
});

router.patch("/kyc-items/:itemId", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = KycReviewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const patch: Record<string, unknown> = {
      status: parsed.data.status,
      reviewed_by: req.user!.id,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (parsed.data.reviewNote !== undefined) patch.review_note = parsed.data.reviewNote;
    if (parsed.data.rejectionReason !== undefined) patch.rejection_reason = parsed.data.rejectionReason;
    if (parsed.data.filePath !== undefined) patch.file_url = parsed.data.filePath;

    const { data, error } = await supabase.from(KYC).update(patch)
      .eq("org_id", req.user!.orgId).eq("id", req.params.itemId).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Checklist item not found." }); return; }
    res.json({ row: mapKycItem(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update the item." });
  }
});

// ── POST /api/personal-delivery-agents/:id/verification-phrase
// Issues (or re-issues) the phrase for the live video. Re-issuing deliberately
// resets the video item: an older recording cannot satisfy a newer phrase.
const VERIFICATION_SUBJECTS = ["blue", "green", "silver", "golden", "quiet", "bright", "steady", "clear"];
const VERIFICATION_NOUNS = ["harbour", "lantern", "compass", "market", "river", "anchor", "garden", "signal"];

router.post("/:id/verification-phrase", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const phrase = `${pick(VERIFICATION_SUBJECTS)} ${pick(VERIFICATION_NOUNS)} ${Math.floor(1000 + Math.random() * 9000)}`;
    const { data, error } = await supabase.from(AGENTS).update({
      verification_phrase: phrase,
      verification_phrase_issued_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("org_id", req.user!.orgId).eq("id", req.params.id).select("id").single();
    if (error || !data) { res.status(404).json({ error: "Agent not found." }); return; }

    await supabase.from(KYC).update({
      status: "Pending", file_url: null,
      review_note: "Phrase re-issued - a new recording is required.",
      updated_at: new Date().toISOString()
    }).eq("org_id", req.user!.orgId).eq("agent_id", req.params.id).eq("item_key", "live_verification_video");

    res.json({ phrase });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not issue a phrase." });
  }
});

// ── Guarantors ────────────────────────────────────────────
const GuarantorSchema = z.object({
  slot: z.number().int().min(1).max(2),
  guarantorType: z.enum(["Family", "Independent"]).optional(),
  fullName: z.string().trim().min(2).max(160),
  relationship: z.string().trim().max(120).optional(),
  phone: z.string().trim().min(7).max(40),
  whatsappPhone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(500).optional(),
  occupation: z.string().trim().max(160).optional(),
  idDocumentPath: z.string().trim().max(500).optional(),
  photoPath: z.string().trim().max(500).optional(),
  signedFormPath: z.string().trim().max(500).optional(),
  consentGiven: z.boolean().optional()
});

router.post("/:id/guarantors", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = GuarantorSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const payload = {
      org_id: req.user!.orgId,
      agent_id: req.params.id,
      slot: parsed.data.slot,
      guarantor_type: parsed.data.guarantorType ?? null,
      full_name: parsed.data.fullName,
      relationship: parsed.data.relationship ?? null,
      phone: parsed.data.phone,
      whatsapp_phone: parsed.data.whatsappPhone ?? null,
      address: parsed.data.address ?? null,
      occupation: parsed.data.occupation ?? null,
      id_document_url: parsed.data.idDocumentPath ?? null,
      photo_url: parsed.data.photoPath ?? null,
      signed_form_url: parsed.data.signedFormPath ?? null,
      consent_given: parsed.data.consentGiven ?? false,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from(GUARANTORS)
      .upsert(payload, { onConflict: "agent_id,slot" }).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json({ row: mapGuarantor(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save the guarantor." });
  }
});

const GuarantorVerifySchema = z.object({
  verificationStatus: z.enum([
    "Not Contacted", "Call Scheduled", "Reached", "Confirmed", "Information Mismatch",
    "Declined Responsibility", "Unable to Verify", "Approved", "Rejected"
  ]),
  verificationNotes: z.string().trim().max(1000).optional(),
  callScheduledAt: z.string().trim().max(40).optional()
});

router.patch("/guarantors/:guarantorId", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = GuarantorVerifySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const patch: Record<string, unknown> = {
      verification_status: parsed.data.verificationStatus,
      verified_by: req.user!.id,
      updated_at: new Date().toISOString()
    };
    if (parsed.data.verificationNotes !== undefined) patch.verification_notes = parsed.data.verificationNotes;
    if (parsed.data.callScheduledAt) patch.call_scheduled_at = parsed.data.callScheduledAt;
    if (parsed.data.verificationStatus === "Approved" || parsed.data.verificationStatus === "Rejected") {
      patch.verified_at = new Date().toISOString();
    }
    const { data, error } = await supabase.from(GUARANTORS).update(patch)
      .eq("org_id", req.user!.orgId).eq("id", req.params.guarantorId).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Guarantor not found." }); return; }
    res.json({ row: mapGuarantor(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update the guarantor." });
  }
});

// ── Signed agreements ─────────────────────────────────────
router.post("/:id/documents/seed", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: existing } = await supabase.from(DOCS)
      .select("document_key").eq("org_id", orgId).eq("agent_id", req.params.id);
    const have = new Set((existing ?? []).map((row: any) => row.document_key));
    const missing = DEFAULT_DOCUMENTS.filter((doc) => !have.has(doc.key));
    if (missing.length > 0) {
      await supabase.from(DOCS).insert(missing.map((doc) => ({
        org_id: orgId, agent_id: req.params.id,
        document_key: doc.key, label: doc.label,
        version: "v1", issued_at: new Date().toISOString().slice(0, 10),
        status: "Not Uploaded"
      })));
    }
    res.json({ seeded: missing.length });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not prepare the agreements." });
  }
});

const DocumentReviewSchema = z.object({
  status: z.enum(["Not Uploaded", "Uploaded", "Approved", "Rejected", "Replacement Requested"]),
  signedFilePath: z.string().trim().max(500).optional(),
  rejectionReason: z.string().trim().max(500).optional()
}).superRefine((value, ctx) => {
  if ((value.status === "Rejected" || value.status === "Replacement Requested") && !value.rejectionReason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rejectionReason"], message: "Say what is wrong with it." });
  }
});

router.patch("/documents/:documentId", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = DocumentReviewSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const patch: Record<string, unknown> = { status: parsed.data.status, updated_at: new Date().toISOString() };
    if (parsed.data.signedFilePath !== undefined) {
      patch.signed_file_url = parsed.data.signedFilePath;
      patch.uploaded_at = new Date().toISOString();
    }
    if (parsed.data.rejectionReason !== undefined) patch.rejection_reason = parsed.data.rejectionReason;
    if (parsed.data.status === "Approved") {
      patch.approved_by = req.user!.id;
      patch.approved_at = new Date().toISOString();
    }
    const { data, error } = await supabase.from(DOCS).update(patch)
      .eq("org_id", req.user!.orgId).eq("id", req.params.documentId).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Document not found." }); return; }
    res.json({ row: mapDocument(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update the document." });
  }
});

// ── POST /api/personal-delivery-agents/:id/approve ────────
// Owner/Admin only, and refuses unless every blocker is clear. The gate lives
// HERE, not only in the UI - a disabled button is a hint, a server check is a
// rule. Approval lands the agent on Probation, never straight to full trust.
router.post("/:id/approve", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: agent } = await supabase.from(AGENTS)
      .select("id, account_status").eq("org_id", orgId).eq("id", req.params.id).single();
    if (!agent) { res.status(404).json({ error: "Agent not found." }); return; }

    const [kycRes, guarantorRes, docRes] = await Promise.all([
      supabase.from(KYC).select("mandatory, status, label").eq("agent_id", req.params.id),
      supabase.from(GUARANTORS).select("slot, verification_status, guarantor_type").eq("agent_id", req.params.id),
      supabase.from(DOCS).select("status, label").eq("agent_id", req.params.id)
    ]);
    const blockers = approvalBlockers(
      (kycRes.data ?? []) as any, (guarantorRes.data ?? []) as any, (docRes.data ?? []) as any
    );
    if (blockers.length > 0) {
      res.status(409).json({ error: "This application is not ready for approval.", blockers });
      return;
    }

    const probationEnds = new Date();
    probationEnds.setDate(probationEnds.getDate() + 30);
    const { data, error } = await supabase.from(AGENTS).update({
      account_status: "Probation",
      kyc_status: "Approved",
      trust_level: "Probation",
      approved_at: new Date().toISOString(),
      approved_by: req.user!.id,
      probation_ends_at: probationEnds.toISOString().slice(0, 10),
      updated_at: new Date().toISOString()
    }).eq("org_id", orgId).eq("id", req.params.id).select(SELECT).single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ row: mapAgent(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not approve the application." });
  }
});

// ── POST /api/personal-delivery-agents/:id/status ─────────
// Reject, suspend, restrict or terminate - always with a reason on record.
const StatusSchema = z.object({
  accountStatus: z.enum([
    "Application Started", "KYC Incomplete", "KYC Submitted", "Guarantor Verification Pending",
    "Management Review", "Approved", "Probation", "Active", "Rejected", "Restricted",
    "Temporarily Suspended", "KYC Expired", "Cash Remittance Overdue", "Inventory Discrepancy", "Terminated"
  ]),
  reason: z.string().trim().max(1000).optional()
}).superRefine((value, ctx) => {
  const needsReason = ["Rejected", "Restricted", "Temporarily Suspended", "Terminated"];
  if (needsReason.includes(value.accountStatus) && !value.reason?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "A reason is required for this status." });
  }
});

router.post("/:id/status", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const patch: Record<string, unknown> = {
      account_status: parsed.data.accountStatus,
      updated_at: new Date().toISOString()
    };
    if (parsed.data.accountStatus === "Terminated") patch.termination_reason = parsed.data.reason ?? null;
    else patch.restriction_reason = parsed.data.reason ?? null;
    // Going offline matters: a restricted agent must not look assignable.
    if (!OPERATIONAL_STATUSES.includes(parsed.data.accountStatus)) patch.availability = "Offline";

    const { data, error } = await supabase.from(AGENTS).update(patch)
      .eq("org_id", req.user!.orgId).eq("id", req.params.id).select(SELECT).single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Agent not found." }); return; }
    res.json({ row: mapAgent(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update the status." });
  }
});

export default router;
