// Public self-application for Personal Delivery Agents.
//
// An applicant fills in their own details and waits for approval, rather than
// someone in the office re-typing everything from a WhatsApp thread.
//
// ⚠️ This is UNAUTHENTICATED, so every route here assumes the caller is hostile
// until proven otherwise:
//   - the link carries a random token, never the org id
//   - links are revocable, optionally expiring, and can carry a submission cap,
//     because a link forwarded around WhatsApp cannot be un-forwarded
//   - uploads are size- and type-checked and land in the PRIVATE bucket
//   - a submission can only ever create an application awaiting review; there
//     is no path from here to an approved agent
import { Router } from "express";
import { z } from "zod";
import { SubmitSchema } from "../lib/pda-application-schema.js";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";
import {
  agreementTemplateRows, isPdaAgreementKey, PDA_AGREEMENT_VERSION,
  renderPdaAgreement, signerNameMatches
} from "../lib/pda-agreements.js";

const router = Router();

const LINKS = "pda_application_links";
const AGENTS = "personal_delivery_agents";
const KYC = "pda_kyc_items";
const GUARANTORS = "pda_guarantors";
const BLOCKED = "pda_blocked_applicants";
const DOCUMENTS = "pda_documents";
const AGREEMENT_ACCEPTANCES = "pda_agreement_acceptances";

// Digits only, so 0803..., 234803... and +234 803 ... are one person.
const phoneDigits = (value: string) => value.replace(/\D/g, "").replace(/^234/, "").replace(/^0/, "");
const KYC_BUCKET = "pda-kyc";

/** Tight limits: this endpoint is open to the internet. */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many applications from this connection. Try again later." }
});
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads from this connection. Try again later." }
});
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

/** Resolves a token to a usable link, or explains precisely why it is not. */
async function resolveLink(token: string) {
  if (!token || token.length < 16) return { error: "This application link is not valid." as const };
  const { data } = await supabase.from(LINKS).select("*").eq("token", token).maybeSingle();
  if (!data) return { error: "This application link is not valid." as const };
  if (!data.active) return { error: "This application link has been closed." as const };
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return { error: "This application link has expired." as const };
  }
  if (data.max_submissions && Number(data.submission_count ?? 0) >= Number(data.max_submissions)) {
    return { error: "This application link is no longer accepting submissions." as const };
  }
  return { link: data };
}

// ── The applicant's own status page ───────────────────────
// Reached by a private token, not a login. An applicant is not a user of the
// system - they become one only when a manager approves them and grants access.
//
// Nothing here reveals anything about the business: no other applicants, no
// reviewer names, no internal notes. Only their own application, what has been
// approved, and what is still wanted from them.
const STATUS_ITEM_UPLOADABLE = new Set([
  "government_id", "government_id_back", "proof_of_address", "selfie_with_id", "live_verification_video"
]);

// Statuses the applicant sees, in their words rather than ours.
const APPLICANT_STAGE: Record<string, { label: string; tone: string; detail: string }> = {
  "KYC Submitted":  { label: "Under review", tone: "review", detail: "We have your application and are checking your documents." },
  "KYC Incomplete": { label: "Something is missing", tone: "action", detail: "We need a few more things from you before we can continue." },
  "Guarantor Verification Pending": { label: "Calling your guarantors", tone: "review", detail: "We are contacting the two people you listed." },
  "Management Review": { label: "Final review", tone: "review", detail: "Your file is with a manager for the final decision." },
  "Approved":  { label: "Approved", tone: "good", detail: "You have been approved. The office will contact you about starting." },
  "Probation": { label: "Approved", tone: "good", detail: "You have been approved and are on your first 30 days." },
  "Active":    { label: "Active", tone: "good", detail: "You are an active delivery agent." },
  "Rejected":  { label: "Not accepted", tone: "bad", detail: "This application was not accepted." }
};

async function resolveApplicant(token: string) {
  const clean = String(token ?? "").trim();
  if (clean.length < 16) return { error: "This status link is not valid." } as const;
  const { data } = await supabase.from(AGENTS)
    .select("id, org_id, agent_code, full_name, phone, account_status, status_reason, created_at, application_link_id")
    .eq("status_token", clean).maybeSingle();
  if (!data) return { error: "This status link is not valid." } as const;
  return { agent: data as any } as const;
}

async function ensureAgentAgreements(agent: { id: string; org_id: string }) {
  const { data: existing } = await supabase.from(DOCUMENTS)
    .select("document_key").eq("org_id", agent.org_id).eq("agent_id", agent.id);
  const have = new Set((existing ?? []).map((row: any) => String(row.document_key)));
  const missing = agreementTemplateRows().filter((agreement) => !have.has(agreement.key));
  if (missing.length === 0) return;
  await supabase.from(DOCUMENTS).insert(missing.map((agreement) => ({
    org_id: agent.org_id,
    agent_id: agent.id,
    document_key: agreement.key,
    label: agreement.label,
    version: PDA_AGREEMENT_VERSION,
    issued_at: new Date().toISOString().slice(0, 10),
    status: "Awaiting Acceptance"
  })));
}

router.get("/status/:statusToken", readLimiter, async (req, res) => {
  const found = await resolveApplicant(String(req.params.statusToken ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const agent = found.agent;

  await ensureAgentAgreements(agent);
  const [{ data: org }, { data: items }, { data: guarantors }, { data: documents }, { data: acceptances }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", agent.org_id).maybeSingle(),
    supabase.from(KYC).select("item_key, label, status, mandatory, rejection_reason").eq("agent_id", agent.id).order("created_at"),
    supabase.from(GUARANTORS).select("slot, full_name, verification_status").eq("agent_id", agent.id).order("slot"),
    supabase.from(DOCUMENTS).select("id, document_key, label, version, issued_at, status, rejection_reason")
      .eq("agent_id", agent.id).order("created_at"),
    supabase.from(AGREEMENT_ACCEPTANCES)
      .select("document_id, typed_name, accepted_at, content_hash")
      .eq("agent_id", agent.id).is("superseded_at", null).order("accepted_at", { ascending: false })
  ]);

  const stage = APPLICANT_STAGE[agent.account_status]
    ?? { label: "Under review", tone: "review", detail: "Your application is being looked at." };

  res.json({
    orgName: org?.name ?? "Protohub",
    reference: `PDA-APP-${String(agent.agent_code ?? "").replace(/^PDA-/, "")}`,
    fullName: agent.full_name,
    submittedAt: agent.created_at,
    stage,
    // Shown only when it was actually written. An empty reason must not render
    // as a blank accusation.
    reason: agent.status_reason || null,
    items: (items ?? [])
      .filter((item: any) => !isPdaAgreementKey(String(item.item_key)))
      .map((item: any) => ({
      key: item.item_key,
      label: item.label,
      status: item.status,
      mandatory: item.mandatory,
      // Why it was turned down, so they can fix it rather than guess.
      note: item.status === "Rejected" || item.status === "Replacement Requested" ? item.rejection_reason ?? null : null,
      canUpload: STATUS_ITEM_UPLOADABLE.has(item.item_key)
        && ["Pending", "Rejected", "Replacement Requested"].includes(item.status)
      })),
    agreements: (documents ?? [])
      .filter((doc: any) => isPdaAgreementKey(String(doc.document_key)))
      .map((doc: any) => {
        const acceptance = (acceptances ?? []).find((row: any) => row.document_id === doc.id) ?? null;
        const content = renderPdaAgreement({
          key: doc.document_key,
          companyName: org?.name ?? "Protohub",
          applicantName: agent.full_name,
          reference: `PDA-APP-${String(agent.agent_code ?? "").replace(/^PDA-/, "")}`,
          issuedOn: doc.issued_at ?? new Date().toISOString().slice(0, 10),
          version: doc.version
        });
        return {
          id: doc.id,
          key: doc.document_key,
          label: doc.label,
          version: doc.version,
          status: doc.status,
          rejectionReason: doc.rejection_reason ?? null,
          canAccept: !["Rejected", "Terminated", "Approved", "Probation", "Active"].includes(agent.account_status)
            && ["Awaiting Acceptance", "Rejected", "Replacement Requested"].includes(doc.status),
          acceptedAt: acceptance?.accepted_at ?? null,
          signedName: acceptance?.typed_name ?? null,
          content
        };
      }),
    guarantors: (guarantors ?? []).map((g: any) => ({
      slot: g.slot,
      fullName: g.full_name,
      status: g.verification_status
    }))
  });
});

const AgreementAcceptanceSchema = z.object({
  version: z.string().trim().min(1).max(40),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  typedName: z.string().trim().min(3).max(160),
  confirmedRead: z.literal(true),
  agreed: z.literal(true)
});

// Electronic acceptance is evidence for management review, not approval. The
// immutable snapshot records exactly what was accepted; management still has
// to approve the agreement and the application separately.
router.post("/status/:statusToken/agreements/:documentKey/accept", uploadLimiter, async (req, res) => {
  const found = await resolveApplicant(String(req.params.statusToken ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const agent = found.agent;
  if (["Rejected", "Terminated", "Approved", "Probation", "Active"].includes(agent.account_status)) {
    res.status(409).json({ error: "This application is already decided. Please contact the office." });
    return;
  }
  const key = String(req.params.documentKey ?? "");
  if (!isPdaAgreementKey(key)) { res.status(404).json({ error: "That agreement was not found." }); return; }
  const parsed = AgreementAcceptanceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Read the agreement, tick both confirmations and type your full name." }); return; }
  if (!signerNameMatches(parsed.data.typedName, agent.full_name)) {
    res.status(400).json({ error: `Type your full name exactly as shown: ${agent.full_name}.` });
    return;
  }

  await ensureAgentAgreements(agent);
  const [{ data: document }, { data: org }] = await Promise.all([
    supabase.from(DOCUMENTS).select("*").eq("org_id", agent.org_id).eq("agent_id", agent.id)
      .eq("document_key", key).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("organizations").select("name").eq("id", agent.org_id).maybeSingle()
  ]);
  if (!document) { res.status(404).json({ error: "That agreement was not found." }); return; }
  if (document.status === "Approved") { res.status(409).json({ error: "That agreement has already been approved." }); return; }
  if (!["Awaiting Acceptance", "Rejected", "Replacement Requested"].includes(document.status)) {
    res.status(409).json({ error: "That agreement has already been sent for review." }); return;
  }

  const snapshot = renderPdaAgreement({
    key,
    companyName: org?.name ?? "Protohub",
    applicantName: agent.full_name,
    reference: `PDA-APP-${String(agent.agent_code ?? "").replace(/^PDA-/, "")}`,
    issuedOn: document.issued_at ?? new Date().toISOString().slice(0, 10),
    version: document.version
  });
  if (parsed.data.version !== snapshot.version || parsed.data.contentHash !== snapshot.contentHash) {
    res.status(409).json({ error: "This agreement was updated while you were reading it. Reopen it and review the current version." });
    return;
  }

  const acceptedAt = new Date().toISOString();
  const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  const { error: acceptanceError } = await supabase.from(AGREEMENT_ACCEPTANCES).insert({
    org_id: agent.org_id,
    agent_id: agent.id,
    document_id: document.id,
    document_key: key,
    version: snapshot.version,
    company_name_snapshot: snapshot.companyName,
    applicant_name_snapshot: snapshot.applicantName,
    application_reference: snapshot.reference,
    typed_name: parsed.data.typedName.trim(),
    declaration_text: snapshot.declaration,
    content_hash: snapshot.contentHash,
    agreement_snapshot: snapshot,
    source_ip: forwarded || req.ip || null,
    user_agent: String(req.headers["user-agent"] ?? "").slice(0, 1000) || null,
    accepted_at: acceptedAt
  });
  if (acceptanceError && acceptanceError.code !== "23505") {
    res.status(500).json({ error: "Could not record your acceptance. Please try again." });
    return;
  }

  const { error: documentError } = await supabase.from(DOCUMENTS).update({
    status: "Electronically Accepted",
    uploaded_at: acceptedAt,
    rejection_reason: null,
    approved_by: null,
    approved_at: null,
    updated_at: acceptedAt
  }).eq("org_id", agent.org_id).eq("id", document.id).eq("agent_id", agent.id);
  if (documentError) {
    res.status(500).json({ error: "Your signature was recorded, but the review status could not be updated. Please retry." });
    return;
  }
  if (agent.account_status === "KYC Incomplete") {
    await supabase.from(AGENTS).update({ account_status: "KYC Submitted", status_reason: null }).eq("id", agent.id);
  }
  res.status(201).json({ ok: true, acceptedAt });
});

// Replace one outstanding document without redoing the whole application.
router.post("/status/:statusToken/items/:itemKey", uploadLimiter, async (req, res) => {
  const found = await resolveApplicant(String(req.params.statusToken ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const agent = found.agent;

  // A decided application is closed. Letting a rejected applicant keep
  // uploading would create a queue of files nobody is going to review.
  if (["Rejected", "Terminated", "Approved", "Probation", "Active"].includes(agent.account_status)) {
    res.status(409).json({ error: "This application is already decided. Please contact the office." });
    return;
  }

  const itemKey = String(req.params.itemKey ?? "");
  if (!STATUS_ITEM_UPLOADABLE.has(itemKey)) { res.status(400).json({ error: "That item cannot be uploaded here." }); return; }

  const { data: item } = await supabase.from(KYC)
    .select("id, status").eq("agent_id", agent.id).eq("item_key", itemKey).maybeSingle();
  if (!item) { res.status(404).json({ error: "That item is not part of your application." }); return; }
  // An approved document is not theirs to swap. Replacing one after the fact is
  // exactly how a verified ID becomes somebody else's.
  if (item.status === "Approved") { res.status(409).json({ error: "That document has already been approved." }); return; }

  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(/^data:((?:image|video|application)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) { res.status(400).json({ error: "That file could not be read." }); return; }
  const mime = match[1].toLowerCase();
  const ext = UPLOAD_MIME_EXT[mime];
  if (!ext) { res.status(400).json({ error: "Upload a photo, a PDF or a short video." }); return; }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 25 * 1024 * 1024) { res.status(413).json({ error: "That file is larger than 25MB." }); return; }

  const objectName = `${agent.org_id}/public/${agent.application_link_id ?? "direct"}/${randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(KYC_BUCKET)
    .upload(objectName, buffer, { contentType: mime, upsert: false });
  if (uploadError) { res.status(500).json({ error: "Could not save that file. Please try again." }); return; }

  // Submitted, never approved - the same rule as the first submission.
  await supabase.from(KYC).update({
    file_url: objectName, status: "Submitted",
    rejection_reason: null, reviewed_by: null, reviewed_at: null,
    updated_at: new Date().toISOString()
  }).eq("id", item.id);

  // Someone who was told something was missing has now answered, so put the
  // file back in the review queue rather than leaving it parked.
  if (agent.account_status === "KYC Incomplete") {
    await supabase.from(AGENTS).update({ account_status: "KYC Submitted", status_reason: null }).eq("id", agent.id);
  }

  res.status(201).json({ ok: true });
});


// ── GET /api/public/agent-application/:token ──────────────
// Confirms the link works and returns only what the form needs to render.
// Deliberately exposes nothing about the organisation beyond its name.
//
// Declared AFTER the /status routes: this pattern is a single segment and
// would otherwise match /status/<token> first, answering "not a valid link"
// to every applicant checking their own application.
router.get("/:token", readLimiter, async (req, res) => {
  const found = await resolveLink(String(req.params.token ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const { data: org } = await supabase.from("organizations").select("name").eq("id", found.link.org_id).maybeSingle();
  res.json({
    ok: true,
    orgName: org?.name ?? "Protohub",
    label: found.link.label ?? null
  });
});

// ── POST /api/public/agent-application/:token/upload ──────
const UPLOAD_MIME_EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp",
  "application/pdf": "pdf", "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"
};

router.post("/:token/upload", uploadLimiter, async (req, res) => {
  const found = await resolveLink(String(req.params.token ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }

  const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
  const match = dataUrl.match(/^data:((?:image|video|application)\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) { res.status(400).json({ error: "That file could not be read." }); return; }
  const mime = match[1].toLowerCase();
  const ext = UPLOAD_MIME_EXT[mime];
  if (!ext) { res.status(400).json({ error: "Upload a photo, a PDF or a short video." }); return; }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 25 * 1024 * 1024) { res.status(413).json({ error: "That file is larger than 25MB." }); return; }

  // Namespaced by link so an abusive link's uploads can be found and removed
  // together, without touching anything an employee uploaded.
  const objectName = `${found.link.org_id}/public/${found.link.id}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(KYC_BUCKET)
    .upload(objectName, buffer, { contentType: mime, upsert: false });
  if (error) { res.status(500).json({ error: "Could not save that file. Please try again." }); return; }
  res.status(201).json({ path: objectName });
});

// ── POST /api/public/agent-application/:token ─────────────
router.post("/:token", submitLimiter, async (req, res) => {
  const found = await resolveLink(String(req.params.token ?? ""));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }

  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    // Cross-field rules (the all-family guarantor pair, a duplicated number)
    // can land in formErrors, so read both or the applicant gets a useless
    // "Some details are missing" for a problem we can name exactly.
    const first = Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0];
    res.status(400).json({ error: first ?? "Some details are missing." });
    return;
  }
  const d = parsed.data;
  const orgId = found.link.org_id;

  try {
    // A duplicate phone almost always means someone submitted twice, not a
    // second person. Point them at the office rather than creating a twin
    // application for a reviewer to untangle.
    const { data: existing } = await supabase.from(AGENTS)
      .select("id").eq("org_id", orgId).eq("phone", d.phone).maybeSingle();
    if (existing) {
      res.status(409).json({ error: "An application already exists for this phone number. Please contact the office." });
      return;
    }

    // Blocked people are refused on EVERY link, not just the one they were
    // given. A link that leaked cannot be un-forwarded, so revoking that single
    // link would only send them to the next one.
    //
    // The message deliberately does not say "you are blocked" - it should not
    // teach someone which number to stop using.
    const { data: blocked } = await supabase.from(BLOCKED)
      .select("id").eq("org_id", orgId).eq("phone_digits", phoneDigits(d.phone)).maybeSingle();
    if (blocked) {
      res.status(403).json({ error: "This application cannot be accepted online. Please contact the office." });
      return;
    }

    const { count } = await supabase.from(AGENTS).select("id", { count: "exact", head: true }).eq("org_id", orgId);
    const agentCode = `PDA-${String((count ?? 0) + 1).padStart(5, "0")}`;

    const { data: agent, error } = await supabase.from(AGENTS).insert({
      org_id: orgId,
      agent_code: agentCode,
      full_name: d.fullName,
      phone: d.phone,
      whatsapp_phone: d.whatsappPhone || null,
      email: d.email || null,
      date_of_birth: d.dateOfBirth || null,
      gender: d.gender || null,
      state: d.state || null,
      city: d.city || null,
      residential_address: d.residentialAddress || null,
      emergency_contact_name: d.emergencyContactName || null,
      emergency_contact_phone: d.emergencyContactPhone || null,
      id_type: d.idType || null,
      id_number: d.idNumber || null,
      transport_method: d.transportMethod || null,
      vehicle_model: d.vehicleModel || null,
      vehicle_plate: d.vehiclePlate || null,
      service_areas: d.serviceAreas ?? [],
      bank_name: d.bankName || null,
      bank_account_number: d.bankAccountNumber || null,
      bank_account_name: d.bankAccountName || null,
      // Submitted, never approved. There is no path from this endpoint to an
      // agent who can hold stock or cash.
      account_status: "KYC Submitted",
      kyc_status: "KYC Submitted",
      trust_level: "Probation",
      availability: "Offline",
      application_link_id: found.link.id,
      submitted_via: "Public link",
      // Their way back in. Not a login - see migration 203.
      status_token: randomUUID().replace(/-/g, "")
    }).select("id, status_token").single();
    if (error || !agent) { res.status(500).json({ error: "Could not submit your application. Please try again." }); return; }

    const DEFAULT_ITEMS: Array<{ key: string; label: string; path?: string }> = [
      { key: "personal_information", label: "Personal Information" },
      { key: "government_id", label: "Government-issued ID (front)", path: d.idFrontPath },
      { key: "government_id_back", label: "Government-issued ID (back)", path: d.idBackPath },
      { key: "proof_of_address", label: "Proof of Address", path: d.proofOfAddressPath },
      { key: "selfie_with_id", label: "Selfie holding ID", path: d.selfiePath },
      { key: "live_verification_video", label: "Live Verification Video" },
      { key: "bank_account", label: "Bank Account" },
      { key: "guarantor_one", label: "Guarantor One" },
      { key: "guarantor_two", label: "Guarantor Two" }
    ];
    await supabase.from(KYC).insert(DEFAULT_ITEMS.map((item) => ({
      org_id: orgId,
      agent_id: agent.id,
      item_key: item.key,
      label: item.label,
      mandatory: true,
      // What the applicant supplied is SUBMITTED. Nothing self-submitted is
      // ever pre-approved - that is the reviewer's job, and the whole point.
      status: item.path ? "Submitted"
        : ["personal_information", "bank_account"].includes(item.key) && d.bankAccountNumber ? "Submitted"
        : item.key === "personal_information" ? "Submitted"
        : "Pending",
      file_url: item.path ?? null
    })));

    await supabase.from(DOCUMENTS).insert(agreementTemplateRows().map((agreement) => ({
      org_id: orgId,
      agent_id: agent.id,
      document_key: agreement.key,
      label: agreement.label,
      version: PDA_AGREEMENT_VERSION,
      issued_at: new Date().toISOString().slice(0, 10),
      status: "Awaiting Acceptance"
    })));

    if (d.guarantors?.length) {
      await supabase.from(GUARANTORS).insert(d.guarantors.slice(0, 2).map((g, index) => ({
        org_id: orgId,
        agent_id: agent.id,
        slot: index + 1,
        guarantor_type: g.guarantorType ?? null,
        full_name: g.fullName,
        relationship: g.relationship ?? null,
        phone: g.phone,
        whatsapp_phone: g.whatsappPhone ?? null,
        email: g.email ?? null,
        address: g.address ?? null,
        occupation: g.occupation ?? null,
        workplace: g.workplace ?? null,
        years_known: g.yearsKnown ?? null,
        reference_statement: g.referenceStatement ?? null,
        id_document_url: g.idDocumentPath ?? null,
        photo_url: g.photoPath ?? null,
        // The applicant SAYS they consented; nobody has verified it. Consent is
        // confirmed on the guarantor call, not by the person who benefits.
        consent_given: false,
        verification_status: "Not Contacted"
      })));
    }

    await supabase.from(LINKS).update({
      submission_count: Number(found.link.submission_count ?? 0) + 1
    }).eq("id", found.link.id);

    res.status(201).json({
      ok: true,
      reference: `PDA-APP-${agentCode.replace(/^PDA-/, "")}`,
      statusToken: agent.status_token,
      message: "Your application has been received. Someone will call your guarantors and contact you about the next steps."
    });
  } catch {
    res.status(500).json({ error: "Could not submit your application. Please try again." });
  }
});

export default router;
