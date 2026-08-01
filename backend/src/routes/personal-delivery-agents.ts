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

export default router;
