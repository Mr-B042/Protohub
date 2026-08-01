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
import {
  dispatchBlockers, deliveryProofBlockers, rescheduleKeepsStockReserved,
  failureReasonBlockers, CUSTOMER_READY
} from "../lib/pda-delivery-flow.js";
import { applyStockMovement } from "../lib/pda-stock.js";
import {
  reconciliationStatusFor, earningStatusFor, cashPositionFor,
  outstandingForAssignment, allocateRemittance, codAssignmentBlockers
} from "../lib/pda-cod.js";
import { rankCandidates } from "../lib/pda-assignment-match.js";
import { resolveStandardFee } from "../lib/pda-fees.js";
import { recordStockLossExpense } from "../lib/stock-loss-expense.js";

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
    const yesterdayKey = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    // Inventory held is real now that stock exists (migration 191), so it is a
    // counted figure rather than one of the "not measurable yet" placeholders.
    const [{ data: stockRows }, { count: inTransitCount }, { count: openDiscrepancies }] = await Promise.all([
      supabase.from("pda_agent_stock")
        .select("available, reserved, out_for_delivery, damaged, missing, awaiting_investigation")
        .eq("org_id", req.user!.orgId),
      supabase.from("pda_stock_transfers").select("id", { count: "exact", head: true })
        .eq("org_id", req.user!.orgId).eq("status", "In Transit"),
      supabase.from("pda_stock_discrepancies").select("id", { count: "exact", head: true })
        .eq("org_id", req.user!.orgId).in("status", ["Reported", "Under Investigation"])
    ]);
    const { data: cashRows } = await supabase.from("pda_order_assignments")
      .select("delivery_status, amount_collected, amount_remitted, delivery_fee, agent_id, earning_status")
      .eq("org_id", req.user!.orgId);
    const cash = cashPositionFor(
      (cashRows ?? []).map((row: any) => ({
        deliveryStatus: row.delivery_status,
        amountCollected: row.amount_collected,
        amountRemitted: row.amount_remitted,
        deliveryFee: row.delivery_fee
      })),
      (cashRows ?? []).map((row: any) => row.earning_status)
    );
    // Today's dispatch picture. Counted from the assignment rows already
    // loaded above, so this costs no extra query.
    const { data: todayRows } = await supabase.from("pda_order_assignments")
      .select("offered_at, delivered_at, delivery_status, assignment_status")
      .eq("org_id", req.user!.orgId);
    const isToday = (value: any) => String(value ?? "").slice(0, 10) === todayKey;
    const orders = {
      assignedToday: (todayRows ?? []).filter((row: any) => isToday(row.offered_at)).length,
      awaitingAcceptance: (todayRows ?? []).filter((row: any) => row.assignment_status === "Awaiting Agent Acceptance").length,
      dispatchesInProgress: (todayRows ?? []).filter((row: any) =>
        ["Dispatch Started", "Arrived at Customer Location"].includes(row.delivery_status)).length,
      deliveredToday: (todayRows ?? []).filter((row: any) => isToday(row.delivered_at)).length,
      failedToday: (todayRows ?? []).filter((row: any) =>
        ["Failed", "Rejected"].includes(row.delivery_status) && isToday(row.offered_at)).length,
      // Something an agent accepted but has not touched in over a day. This is
      // the quiet failure mode - nobody complains, the customer just waits.
      staleOpen: (todayRows ?? []).filter((row: any) =>
        !["Delivered", "Failed", "Rejected", "Cancelled"].includes(row.delivery_status)
        && row.assignment_status === "Accepted"
        && !isToday(row.offered_at)).length
    };
    // Agents personally holding company money, not orders - one agent sitting
    // on five unremitted deliveries is one problem, not five.
    const agentsHoldingCash = new Set(
      (cashRows ?? [])
        .filter((row: any) => row.delivery_status === "Delivered"
          && Number(row.amount_collected ?? 0) > Number(row.amount_remitted ?? 0))
        .map((row: any) => row.agent_id)
    ).size;

    // ── Everything the Overview design shows, counted from real rows ──
    const { data: settingsRow } = await supabase.from("pda_settings")
      .select("remittance_grace_days").eq("org_id", req.user!.orgId).maybeSingle();
    const graceDays = Number(settingsRow?.remittance_grace_days ?? 3);

    const { data: fullAssignments } = await supabase.from("pda_order_assignments")
      .select("agent_id, delivery_status, assignment_status, customer_contact_status, amount_collected, amount_remitted, delivery_fee, offered_at, delivered_at")
      .eq("org_id", req.user!.orgId);
    const allAssignments = fullAssignments ?? [];
    const dayOf = (value: any) => String(value ?? "").slice(0, 10);

    // Real day-over-day comparisons. Where yesterday had nothing, the delta is
    // null rather than a meaningless +100%.
    const pctChange = (today: number, before: number): number | null =>
      before <= 0 ? null : Math.round(((today - before) / before) * 1000) / 10;
    const assignedYesterday = allAssignments.filter((r: any) => dayOf(r.offered_at) === yesterdayKey).length;
    const deliveredYesterday = allAssignments.filter((r: any) => dayOf(r.delivered_at) === yesterdayKey).length;
    const deliveredTodayRows = allAssignments.filter((r: any) => dayOf(r.delivered_at) === todayKey);
    const codCollectedToday = deliveredTodayRows.reduce((sum: number, r: any) => sum + Number(r.amount_collected ?? 0), 0);
    const codCollectedYesterday = allAssignments
      .filter((r: any) => dayOf(r.delivered_at) === yesterdayKey)
      .reduce((sum: number, r: any) => sum + Number(r.amount_collected ?? 0), 0);
    const closedToday = allAssignments.filter((r: any) =>
      dayOf(r.delivered_at) === todayKey || (["Failed", "Rejected"].includes(r.delivery_status) && dayOf(r.offered_at) === todayKey));

    const comparisons = {
      ordersAssignedDeltaPct: pctChange(
        allAssignments.filter((r: any) => dayOf(r.offered_at) === todayKey).length, assignedYesterday),
      deliveredDeltaPct: pctChange(deliveredTodayRows.length, deliveredYesterday),
      codCollectedDeltaPct: pctChange(codCollectedToday, codCollectedYesterday),
      successRatePct: closedToday.length > 0
        ? Math.round((deliveredTodayRows.length / closedToday.length) * 1000) / 10
        : null
    };

    // Cash held past the grace period. This is the figure worth chasing.
    const overdueCutoff = new Date(Date.now() - graceDays * 86400000).toISOString().slice(0, 10);
    const overdueCash = allAssignments
      .filter((r: any) => r.delivery_status === "Delivered"
        && dayOf(r.delivered_at) !== "" && dayOf(r.delivered_at) < overdueCutoff)
      .reduce((sum: number, r: any) =>
        sum + Math.max(0, Number(r.amount_collected ?? 0) - Number(r.amount_remitted ?? 0)), 0);

    const kycBreakdown = {
      verified: countWhere((a: any) => OPERATIONAL_STATUSES.includes(String(a.account_status))),
      pending: countWhere((a: any) => ["KYC Submitted", "Guarantor Verification Pending", "Management Review"].includes(String(a.account_status))),
      incomplete: countWhere((a: any) => ["Application Started", "KYC Incomplete"].includes(String(a.account_status))),
      rejected: countWhere((a: any) => ["Rejected", "Terminated"].includes(String(a.account_status)))
    };

    const orderStatusToday = {
      inProgress: allAssignments.filter((r: any) => ["Dispatch Started", "Arrived at Customer Location"].includes(r.delivery_status)).length,
      awaitingCustomer: allAssignments.filter((r: any) =>
        !["Delivered", "Failed", "Rejected", "Cancelled"].includes(r.delivery_status)
        && r.customer_contact_status !== "Customer Ready").length,
      readyForPickup: allAssignments.filter((r: any) =>
        r.delivery_status === "Ready for Dispatch" && r.customer_contact_status === "Customer Ready").length,
      delivered: deliveredTodayRows.length,
      failed: allAssignments.filter((r: any) =>
        ["Failed", "Rejected"].includes(r.delivery_status) && dayOf(r.offered_at) === todayKey).length
    };

    // Inventory value needs real unit costs - the same source the order COGS
    // uses, so the figure agrees with the P&L.
    const { data: pricingRows } = await supabase.from("product_pricings").select("product_id, unit_cost");
    const unitCostByProduct = new Map<string, number>();
    for (const row of (pricingRows ?? []) as any[]) {
      const cost = Number(row.unit_cost ?? 0);
      if (cost > 0) unitCostByProduct.set(String(row.product_id), Math.max(unitCostByProduct.get(String(row.product_id)) ?? 0, cost));
    }
    const { data: valuedStock } = await supabase.from("pda_agent_stock")
      .select("agent_id, product_id, available, reserved, out_for_delivery").eq("org_id", req.user!.orgId);
    const stockValueByAgent = new Map<string, { units: number; value: number }>();
    let inventoryValue = 0;
    for (const row of (valuedStock ?? []) as any[]) {
      const units = Number(row.available ?? 0) + Number(row.reserved ?? 0) + Number(row.out_for_delivery ?? 0);
      const value = units * (unitCostByProduct.get(String(row.product_id)) ?? 0);
      inventoryValue += value;
      const current = stockValueByAgent.get(row.agent_id) ?? { units: 0, value: 0 };
      stockValueByAgent.set(row.agent_id, { units: current.units + units, value: current.value + value });
    }

    // The agent table on the Overview.
    const { data: agentDetail } = await supabase.from(AGENTS)
      .select("id, agent_code, full_name, phone, photo_url, account_status, kyc_status, availability, state, city, service_areas, service_radius_km")
      .eq("org_id", req.user!.orgId).order("created_at", { ascending: false });
    const agentRows = (agentDetail ?? []).map((row: any) => {
      const mine = allAssignments.filter((a: any) => a.agent_id === row.id);
      const active = mine.filter((a: any) =>
        ["Ready for Dispatch", "Dispatch Started", "Arrived at Customer Location", "Rescheduled"].includes(a.delivery_status));
      const closed = mine.filter((a: any) => ["Delivered", "Failed", "Rejected"].includes(a.delivery_status));
      const delivered = mine.filter((a: any) => a.delivery_status === "Delivered");
      const codHeldRows = delivered.filter((a: any) => Number(a.amount_collected ?? 0) > Number(a.amount_remitted ?? 0));
      const stock = stockValueByAgent.get(row.id) ?? { units: 0, value: 0 };
      return {
        id: row.id,
        agentCode: row.agent_code,
        fullName: row.full_name,
        phone: row.phone,
        photoUrl: row.photo_url ?? null,
        accountStatus: row.account_status,
        kycStatus: row.kyc_status,
        availability: row.availability,
        serviceArea: [row.city, row.state].filter(Boolean).join(", ")
          || (Array.isArray(row.service_areas) ? row.service_areas.join(", ") : ""),
        serviceRadiusKm: row.service_radius_km === null || row.service_radius_km === undefined
          ? null : Number(row.service_radius_km),
        activeOrders: active.length,
        inProgress: mine.filter((a: any) => ["Dispatch Started", "Arrived at Customer Location"].includes(a.delivery_status)).length,
        inventoryUnits: stock.units,
        inventoryValue: Math.round(stock.value),
        codHeld: codHeldRows.reduce((sum: number, a: any) =>
          sum + Math.max(0, Number(a.amount_collected ?? 0) - Number(a.amount_remitted ?? 0)), 0),
        codOrders: codHeldRows.length,
        // Null, never 0 - an agent with no closed orders has no record yet,
        // which is a different thing from a 0% delivery rate.
        performancePct: closed.length > 0 ? Math.round((delivered.length / closed.length) * 1000) / 10 : null
      };
    });

    const inventory = (stockRows ?? []).reduce((acc: any, row: any) => ({
      available: acc.available + Number(row.available ?? 0),
      reserved: acc.reserved + Number(row.reserved ?? 0),
      outForDelivery: acc.outForDelivery + Number(row.out_for_delivery ?? 0),
      unaccounted: acc.unaccounted + Number(row.damaged ?? 0) + Number(row.missing ?? 0)
        + Number(row.awaiting_investigation ?? 0)
    }), { available: 0, reserved: 0, outForDelivery: 0, unaccounted: 0 });
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
        guarantorsOutstanding,
        inventoryHeld: inventory.available + inventory.reserved + inventory.outForDelivery + inventory.unaccounted,
        inventoryAvailable: inventory.available,
        inventoryOutForDelivery: inventory.outForDelivery,
        inventoryUnaccounted: inventory.unaccounted,
        stockInTransit: inTransitCount ?? 0,
        openStockReports: openDiscrepancies ?? 0,
        codOutstanding: cash.outstanding,
        agentsHoldingCash,
        ordersWithCashOutstanding: cash.ordersWithCashOutstanding,
        earningsAvailable: cash.availableEarnings,
        earningsPending: cash.pendingEarnings,
        ordersAssignedToday: orders.assignedToday,
        ordersAwaitingAcceptance: orders.awaitingAcceptance,
        dispatchesInProgress: orders.dispatchesInProgress,
        deliveredToday: orders.deliveredToday,
        failedToday: orders.failedToday,
        staleOpenOrders: orders.staleOpen
      },
      byStatus,
      // Yesterday's equivalents, so the "vs yesterday" deltas on the KPI cards
      // are computed from real dated rows rather than invented.
      comparisons,
      kycBreakdown,
      ordersToday: orderStatusToday,
      inventory: {
        totalUnits: inventory.available + inventory.reserved + inventory.outForDelivery,
        totalValue: inventoryValue,
        unaccounted: inventory.unaccounted
      },
      codOverview: {
        collectedToday: codCollectedToday,
        outstanding: cash.outstanding,
        overdue: overdueCash
      },
      agents: agentRows,
      unavailable: {}
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


// ─────────────────────────────────────────────────────────
// Order assignments and the agent's own workflow (migration 190).
// ─────────────────────────────────────────────────────────

const ASSIGNMENTS = "pda_order_assignments";
/** The agent's own portal role. */
const AGENT_ROLE = "Delivery Agent";

const mapAssignment = (row: any) => ({
  id: row.id,
  orderId: row.order_id,
  agentId: row.agent_id,
  assignmentStatus: row.assignment_status,
  offeredAt: row.offered_at,
  declineReason: row.decline_reason ?? null,
  customerContactStatus: row.customer_contact_status,
  lastContactAt: row.last_contact_at ?? null,
  customerReadyAt: row.customer_ready_at ?? null,
  deliveryStatus: row.delivery_status,
  dispatchStartedAt: row.dispatch_started_at ?? null,
  expectedArrivalAt: row.expected_arrival_at ?? null,
  deliveredAt: row.delivered_at ?? null,
  failureReason: row.failure_reason ?? null,
  failureNote: row.failure_note ?? null,
  rescheduledTo: row.rescheduled_to ?? null,
  rescheduleReason: row.reschedule_reason ?? null,
  stockReserved: row.stock_reserved,
  deliveryFee: Number(row.delivery_fee ?? 0),
  feeStatus: row.fee_status,
  amountCollected: row.amount_collected === null || row.amount_collected === undefined
    ? null : Number(row.amount_collected),
  paymentMethod: row.payment_method ?? null,
  proofType: row.proof_type ?? null,
  order: row.order ?? null
});

/** org_id can arrive as an array on some tokens; normalise once. */
const orgIdOf = (req: any): string =>
  Array.isArray(req.user?.orgId) ? String(req.user.orgId[0] ?? "") : String(req.user?.orgId ?? "");

/** Express route params are typed loosely here; take the first value. */
const paramOf = (value: unknown): string =>
  Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");

/**
 * The personal delivery agent record behind the signed-in user.
 * Returns null for anyone who is not a portal agent.
 */
async function agentForUser(orgId: string, userId: string) {
  const { data } = await supabase.from(AGENTS)
    .select("id, full_name, agent_code, account_status, trust_level, availability, max_active_orders, max_cod_exposure, probation_ends_at")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  return data ?? null;
}

// ── POST /api/personal-delivery-agents/:id/assign ─────────
// Management offers an order to an agent. Refused unless the agent is actually
// allowed to work - approval is not a formality, it is what stands between a
// stranger and our stock and cash.
const AssignSchema = z.object({
  orderId: z.string().trim().min(1),
  deliveryFee: z.number().min(0),
  lockFee: z.boolean().optional()
});

router.post("/:id/assign", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = AssignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = req.user!.orgId;
    const { data: agent } = await supabase.from(AGENTS)
      .select("id, account_status, availability, max_active_orders, max_cod_exposure")
      .eq("org_id", orgId).eq("id", req.params.id).single();
    if (!agent) { res.status(404).json({ error: "Agent not found." }); return; }

    if (!OPERATIONAL_STATUSES.includes(String(agent.account_status))) {
      res.status(409).json({
        error: `${agent.account_status} agents cannot be given orders. Approve the application first.`
      });
      return;
    }

    // Probation and trust levels exist to cap exposure, so the limit is checked
    // here rather than trusted to whoever is doing the assigning.
    if (agent.max_active_orders) {
      const { count } = await supabase.from(ASSIGNMENTS)
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agent.id)
        .in("delivery_status", ["Ready for Dispatch", "Dispatch Started", "Arrived at Customer Location", "Rescheduled"]);
      if ((count ?? 0) >= agent.max_active_orders) {
        res.status(409).json({ error: `This agent is already at their limit of ${agent.max_active_orders} active orders.` });
        return;
      }
    }

    // An agent already holding more of our money than their approved limit must
    // not be given another cash order - the exposure compounds silently.
    const { data: agentCash } = await supabase.from(ASSIGNMENTS)
      .select("delivery_status, amount_collected, amount_remitted, delivery_fee")
      .eq("agent_id", agent.id);
    const { data: incomingOrder } = await supabase.from("orders")
      .select("amount").eq("org_id", orgId).eq("id", parsed.data.orderId).maybeSingle();
    const cashBlockers = codAssignmentBlockers(
      cashPositionFor((agentCash ?? []).map((row: any) => ({
        deliveryStatus: row.delivery_status,
        amountCollected: row.amount_collected,
        amountRemitted: row.amount_remitted,
        deliveryFee: row.delivery_fee
      }))),
      (agent as any).max_cod_exposure,
      Number(incomingOrder?.amount ?? 0)
    );
    if (cashBlockers.length > 0) {
      res.status(409).json({ error: cashBlockers[0], blockers: cashBlockers });
      return;
    }

    const { data, error } = await supabase.from(ASSIGNMENTS).insert({
      org_id: orgId,
      order_id: parsed.data.orderId,
      agent_id: agent.id,
      assignment_status: "Awaiting Agent Acceptance",
      delivery_fee: parsed.data.deliveryFee,
      fee_status: parsed.data.lockFee ? "Locked" : "Proposed",
      fee_locked_at: parsed.data.lockFee ? new Date().toISOString() : null,
      fee_proposed_by: "Management"
    }).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json({ row: mapAssignment(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not assign that order." });
  }
});

// ── GET /api/personal-delivery-agents/my/summary ──────────
// The agent's own Home screen. Deliberately small: an agent needs their work
// queue and their money, not company reports.
router.get("/my/summary", requireRole(AGENT_ROLE), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const agent = await agentForUser(orgId, req.user!.id);
    if (!agent) { res.status(404).json({ error: "No delivery agent profile is linked to this login." }); return; }

    const { data: assignments } = await supabase.from(ASSIGNMENTS)
      .select("*").eq("agent_id", agent.id).order("offered_at", { ascending: false });
    const rows = assignments ?? [];
    const open = rows.filter((r: any) => !["Delivered", "Failed", "Rejected", "Cancelled"].includes(r.delivery_status));

    res.json({
      agent: {
        id: agent.id, fullName: agent.full_name, agentCode: agent.agent_code,
        accountStatus: agent.account_status, trustLevel: agent.trust_level,
        availability: agent.availability, probationEndsAt: agent.probation_ends_at ?? null
      },
      counts: {
        awaitingAcceptance: rows.filter((r: any) => r.assignment_status === "Awaiting Agent Acceptance").length,
        awaitingCustomerConfirmation: open.filter((r: any) => r.customer_contact_status !== "Customer Ready").length,
        readyToDispatch: open.filter((r: any) => r.customer_contact_status === "Customer Ready"
          && r.delivery_status === "Ready for Dispatch").length,
        inProgress: open.filter((r: any) => ["Dispatch Started", "Arrived at Customer Location"].includes(r.delivery_status)).length,
        rescheduled: open.filter((r: any) => r.delivery_status === "Rescheduled").length,
        deliveredToday: rows.filter((r: any) => String(r.delivered_at ?? "").slice(0, 10) === new Date().toISOString().slice(0, 10)).length
      },
      // Earnings and cash owed arrive with COD & Reconciliation. Reported as
      // unavailable rather than as zero: an agent seeing "₦0 to remit" when
      // they are holding our cash is the worst possible wrong answer.
      wallet: { available: null, pending: null, codToRemit: null, note: "COD & Reconciliation is not built yet" }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load your dashboard." });
  }
});

// ── GET /api/personal-delivery-agents/my/orders ───────────
router.get("/my/orders", requireRole(AGENT_ROLE), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const agent = await agentForUser(orgId, req.user!.id);
    if (!agent) { res.status(404).json({ error: "No delivery agent profile is linked to this login." }); return; }

    const { data: assignments, error } = await supabase.from(ASSIGNMENTS)
      .select("*").eq("agent_id", agent.id).order("offered_at", { ascending: false }).limit(200);
    if (error) { res.status(500).json({ error: error.message }); return; }

    const orderIds = [...new Set((assignments ?? []).map((row: any) => row.order_id))];
    const { data: orders } = orderIds.length
      ? await supabase.from("orders")
          .select("id, customer, phone, address, state, product_name, package_name, amount, quantity, status")
          .eq("org_id", orgId).in("id", orderIds)
      : { data: [] as any[] };
    const orderById = new Map((orders ?? []).map((o: any) => [o.id, o]));

    res.json({
      rows: (assignments ?? []).map((row: any) => {
        const order = orderById.get(row.order_id);
        return mapAssignment({
          ...row,
          // Only what the agent needs to do the job. No cost, no margin.
          order: order ? {
            id: order.id, customer: order.customer, phone: order.phone,
            address: order.address, state: order.state,
            productName: order.package_name || order.product_name,
            quantity: order.quantity, amount: Number(order.amount ?? 0)
          } : null
        });
      })
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load your orders." });
  }
});

/**
 * Moves the stock behind an assignment, resolving the product from the order.
 *
 * Deliberately best-effort: a stock hiccup must not stop an agent recording
 * what actually happened on a delivery. The ledger is the record of truth, so a
 * failure here surfaces as a missing ledger row rather than a lost outcome.
 */
async function moveAssignmentStock(
  req: any, assignment: any, movement: "Out for delivery" | "Delivered to customer" | "Returned to available"
) {
  try {
    const orgId = orgIdOf(req);
    const { data: order } = await supabase.from("orders")
      .select("product_id, product_name, quantity").eq("org_id", orgId).eq("id", assignment.order_id).maybeSingle();
    if (!order?.product_id) return;
    await applyStockMovement({
      orgId, agentId: assignment.agent_id,
      productId: order.product_id, productName: order.product_name,
      movement, quantity: Math.max(1, Number(order.quantity ?? 1)),
      orderId: assignment.order_id,
      userId: req.user?.id ?? null, userName: req.user?.name ?? null
    });
  } catch {
    // Swallowed on purpose - see the note above.
  }
}

/** Loads an assignment and proves it belongs to the signed-in agent. */
async function loadOwnAssignment(orgId: string, userId: string, assignmentId: string) {
  const agent = await agentForUser(orgId, userId);
  if (!agent) return { error: "No delivery agent profile is linked to this login." as const };
  const { data } = await supabase.from(ASSIGNMENTS)
    .select("*").eq("org_id", orgId).eq("id", assignmentId).eq("agent_id", agent.id).maybeSingle();
  if (!data) return { error: "That order is not assigned to you." as const };
  return { agent, assignment: data };
}

// ── POST .../my/orders/:assignmentId/respond ──────────────
const RespondSchema = z.object({
  accept: z.boolean(),
  declineReason: z.enum([
    "Too far", "Not available", "Transport issue", "Fee too low",
    "Product not physically available", "Unsafe location", "Too many active orders", "Other"
  ]).optional()
}).superRefine((value, ctx) => {
  if (!value.accept && !value.declineReason) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["declineReason"], message: "Say why you cannot take it." });
  }
});

router.post("/my/orders/:assignmentId/respond", requireRole(AGENT_ROLE), async (req, res) => {
  const parsed = RespondSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const found = await loadOwnAssignment(orgIdOf(req), req.user!.id, paramOf(req.params.assignmentId));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const { data, error } = await supabase.from(ASSIGNMENTS).update({
    assignment_status: parsed.data.accept ? "Accepted" : "Declined",
    decline_reason: parsed.data.accept ? null : parsed.data.declineReason,
    responded_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }).eq("id", req.params.assignmentId).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ row: mapAssignment(data) });
});

// ── POST .../my/orders/:assignmentId/contact ──────────────
const ContactSchema = z.object({
  customerContactStatus: z.enum([
    "Contacted", "Customer Ready", "Not Picking", "Number Not Reachable",
    "Customer Requested Callback", "Customer Requested Reschedule", "Customer Cancelled"
  ])
});

router.post("/my/orders/:assignmentId/contact", requireRole(AGENT_ROLE), async (req, res) => {
  const parsed = ContactSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const found = await loadOwnAssignment(orgIdOf(req), req.user!.id, paramOf(req.params.assignmentId));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const isReady = parsed.data.customerContactStatus === CUSTOMER_READY;
  const { data, error } = await supabase.from(ASSIGNMENTS).update({
    customer_contact_status: parsed.data.customerContactStatus,
    last_contact_at: new Date().toISOString(),
    // Cleared when readiness is withdrawn, so a stale "ready" can never unlock
    // dispatch after the customer has gone quiet again.
    customer_ready_at: isReady ? new Date().toISOString() : null,
    updated_at: new Date().toISOString()
  }).eq("id", req.params.assignmentId).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ row: mapAssignment(data) });
});

// ── POST .../my/orders/:assignmentId/dispatch ─────────────
router.post("/my/orders/:assignmentId/dispatch", requireRole(AGENT_ROLE), async (req, res) => {
  const found = await loadOwnAssignment(orgIdOf(req), req.user!.id, paramOf(req.params.assignmentId));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  const a = found.assignment;
  const blockers = dispatchBlockers({
    assignmentStatus: a.assignment_status,
    customerContactStatus: a.customer_contact_status,
    deliveryStatus: a.delivery_status,
    feeStatus: a.fee_status
  });
  if (blockers.length > 0) { res.status(409).json({ error: "You cannot start this delivery yet.", blockers }); return; }

  const minutes = Number(req.body?.expectedMinutes ?? 0);
  const expected = Number.isFinite(minutes) && minutes > 0
    ? new Date(Date.now() + minutes * 60_000).toISOString() : null;

  const { data, error } = await supabase.from(ASSIGNMENTS).update({
    delivery_status: "Dispatch Started",
    dispatch_started_at: new Date().toISOString(),
    expected_arrival_at: expected,
    stock_reserved: true,
    updated_at: new Date().toISOString()
  }).eq("id", req.params.assignmentId).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await moveAssignmentStock(req, found.assignment, "Out for delivery");
  res.json({ row: mapAssignment(data) });
});

// ── POST .../my/orders/:assignmentId/delivered ────────────
const DeliveredSchema = z.object({
  amountCollected: z.number().min(0),
  paymentMethod: z.enum(["Cash", "Transfer", "POS", "Already paid"]),
  proofType: z.string().trim().min(1),
  proofFilePath: z.string().trim().max(500).optional(),
  proofReference: z.string().trim().max(200).optional()
});

router.post("/my/orders/:assignmentId/delivered", requireRole(AGENT_ROLE), async (req, res) => {
  const parsed = DeliveredSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const found = await loadOwnAssignment(orgIdOf(req), req.user!.id, paramOf(req.params.assignmentId));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }

  const blockers = deliveryProofBlockers(parsed.data);
  if (blockers.length > 0) { res.status(409).json({ error: "This delivery needs proof before it can be closed.", blockers }); return; }

  // Settle the stock ONCE. Re-saving a delivered order must not deduct twice -
  // the same non-idempotency that once over-deducted 275 units across 42 orders
  // on the main order flow.
  if (!found.assignment.stock_settled) {
    await moveAssignmentStock(req, found.assignment, "Delivered to customer");
  }

  const { data, error } = await supabase.from(ASSIGNMENTS).update({
    delivery_status: "Delivered",
    stock_settled: true,
    delivered_at: new Date().toISOString(),
    amount_collected: parsed.data.amountCollected,
    payment_method: parsed.data.paymentMethod,
    proof_type: parsed.data.proofType,
    proof_file_path: parsed.data.proofFilePath ?? null,
    proof_reference: parsed.data.proofReference ?? null,
    stock_reserved: false,
    updated_at: new Date().toISOString()
  }).eq("id", req.params.assignmentId).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  // The agent is now holding company cash, so say so immediately rather than
  // waiting for someone to run a reconciliation.
  await refreshAssignmentCash(String(data.id));
  res.json({ row: mapAssignment(data) });
});

// ── POST .../my/orders/:assignmentId/failed ───────────────
const FailedSchema = z.object({
  outcome: z.enum(["Failed", "Rejected"]),
  failureReason: z.string().trim().min(1),
  failureNote: z.string().trim().max(1000).optional()
});

router.post("/my/orders/:assignmentId/failed", requireRole(AGENT_ROLE), async (req, res) => {
  const parsed = FailedSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const found = await loadOwnAssignment(orgIdOf(req), req.user!.id, paramOf(req.params.assignmentId));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }

  const blockers = failureReasonBlockers(parsed.data.failureReason, parsed.data.failureNote);
  if (blockers.length > 0) { res.status(409).json({ error: blockers[0], blockers }); return; }

  // The unit is back in the agent's hands, so it must stop being held for this
  // order - otherwise their available stock silently shrinks with every failure.
  if (!found.assignment.stock_settled) {
    await moveAssignmentStock(req, found.assignment, "Returned to available");
  }

  const { data, error } = await supabase.from(ASSIGNMENTS).update({
    delivery_status: parsed.data.outcome,
    stock_settled: true,
    failure_reason: parsed.data.failureReason,
    failure_note: parsed.data.failureNote ?? null,
    // The unit is back with the agent, so it must stop being held for this order.
    stock_reserved: false,
    updated_at: new Date().toISOString()
  }).eq("id", req.params.assignmentId).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ row: mapAssignment(data) });
});

// ── POST .../my/orders/:assignmentId/reschedule ───────────
const RescheduleSchema = z.object({
  rescheduledTo: z.string().trim().max(20).optional(),
  daypart: z.string().trim().max(40).optional(),
  reason: z.string().trim().max(500).optional()
});

router.post("/my/orders/:assignmentId/reschedule", requireRole(AGENT_ROLE), async (req, res) => {
  const parsed = RescheduleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const found = await loadOwnAssignment(orgIdOf(req), req.user!.id, paramOf(req.params.assignmentId));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }

  // A firm date holds the unit. "I'll call you later" does not - otherwise one
  // vague customer can block a unit of stock indefinitely.
  const keepReserved = rescheduleKeepsStockReserved(parsed.data.rescheduledTo);
  const { data, error } = await supabase.from(ASSIGNMENTS).update({
    delivery_status: "Rescheduled",
    rescheduled_to: keepReserved ? parsed.data.rescheduledTo : null,
    reschedule_daypart: parsed.data.daypart ?? null,
    reschedule_reason: parsed.data.reason ?? null,
    stock_reserved: keepReserved,
    customer_contact_status: "Customer Requested Reschedule",
    customer_ready_at: null,
    dispatch_started_at: null,
    updated_at: new Date().toISOString()
  }).eq("id", req.params.assignmentId).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ row: mapAssignment(data), stockReleased: !keepReserved });
});

// ── POST .../my/availability ──────────────────────────────
router.post("/my/availability", requireRole(AGENT_ROLE), async (req, res) => {
  const availability = String(req.body?.availability ?? "");
  if (!["Available", "Busy", "Unavailable", "Offline"].includes(availability)) {
    res.status(400).json({ error: "Pick a valid availability." });
    return;
  }
  const agent = await agentForUser(orgIdOf(req), req.user!.id);
  if (!agent) { res.status(404).json({ error: "No delivery agent profile is linked to this login." }); return; }
  // A restricted or suspended agent must not be able to put themselves back on
  // the board by flipping a toggle.
  if (!OPERATIONAL_STATUSES.includes(String(agent.account_status))) {
    res.status(409).json({ error: `Your account is ${agent.account_status}. Contact the office.` });
    return;
  }
  const { error } = await supabase.from(AGENTS)
    .update({ availability, updated_at: new Date().toISOString() })
    .eq("org_id", req.user!.orgId).eq("id", agent.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ availability });
});


// ─────────────────────────────────────────────────────────
// Inventory (migration 191)
// ─────────────────────────────────────────────────────────

const TRANSFERS = "pda_stock_transfers";
const STOCK = "pda_agent_stock";
const LEDGER = "pda_stock_ledger";
const DISCREPANCIES = "pda_stock_discrepancies";

// ── POST /:id/stock/send ──────────────────────────────────
// Company → agent. Nothing lands in the agent's balance yet: it is in transit
// until they confirm what actually arrived.
const SendStockSchema = z.object({
  productId: z.string().trim().min(1),
  productName: z.string().trim().max(200).optional(),
  quantity: z.number().int().min(1),
  waybillReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional()
});

router.post("/:id/stock/send", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = SendStockSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = orgIdOf(req);
    const agentId = paramOf(req.params.id);
    const { data: agent } = await supabase.from(AGENTS)
      .select("id, account_status, max_stock_units").eq("org_id", orgId).eq("id", agentId).single();
    if (!agent) { res.status(404).json({ error: "Agent not found." }); return; }

    // Stock is the thing most worth protecting: an unapproved agent must never
    // receive any.
    if (!OPERATIONAL_STATUSES.includes(String(agent.account_status))) {
      res.status(409).json({ error: `${agent.account_status} agents cannot hold stock. Approve the application first.` });
      return;
    }

    // Probation exists to cap how much of our stock sits with someone new.
    if (agent.max_stock_units) {
      const { data: held } = await supabase.from(STOCK)
        .select("available, reserved, out_for_delivery, damaged, missing, awaiting_investigation")
        .eq("agent_id", agentId);
      const heldTotal = (held ?? []).reduce((sum: number, row: any) =>
        sum + Number(row.available ?? 0) + Number(row.reserved ?? 0) + Number(row.out_for_delivery ?? 0)
        + Number(row.damaged ?? 0) + Number(row.missing ?? 0) + Number(row.awaiting_investigation ?? 0), 0);
      const { data: inTransit } = await supabase.from(TRANSFERS)
        .select("quantity_sent").eq("agent_id", agentId).eq("status", "In Transit");
      const transitTotal = (inTransit ?? []).reduce((sum: number, row: any) => sum + Number(row.quantity_sent ?? 0), 0);
      if (heldTotal + transitTotal + parsed.data.quantity > agent.max_stock_units) {
        res.status(409).json({
          error: `That would put ${heldTotal + transitTotal + parsed.data.quantity} units with this agent, above their ${agent.max_stock_units}-unit limit.`
        });
        return;
      }
    }

    const { data, error } = await supabase.from(TRANSFERS).insert({
      org_id: orgId, agent_id: agentId,
      product_id: parsed.data.productId,
      product_name: parsed.data.productName ?? null,
      quantity_sent: parsed.data.quantity,
      waybill_reference: parsed.data.waybillReference ?? null,
      notes: parsed.data.notes ?? null,
      status: "In Transit",
      sent_by: req.user!.id
    }).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json({ row: data });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not send that stock." });
  }
});

// ── POST /my/transfers/:transferId/confirm ────────────────
// The agent says what actually arrived. A shortfall is recorded as a fact, not
// silently corrected - only what they confirm enters their balance.
const ConfirmTransferSchema = z.object({
  quantityReceived: z.number().int().min(0),
  conditionNote: z.string().trim().max(500).optional(),
  proofFilePath: z.string().trim().max(500).optional()
});

router.post("/my/transfers/:transferId/confirm", requireRole(AGENT_ROLE), async (req, res) => {
  const parsed = ConfirmTransferSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = orgIdOf(req);
    const agent = await agentForUser(orgId, req.user!.id);
    if (!agent) { res.status(404).json({ error: "No delivery agent profile is linked to this login." }); return; }

    const transferId = paramOf(req.params.transferId);
    const { data: transfer } = await supabase.from(TRANSFERS)
      .select("*").eq("org_id", orgId).eq("id", transferId).eq("agent_id", agent.id).maybeSingle();
    if (!transfer) { res.status(404).json({ error: "That delivery of stock is not yours." }); return; }
    if (transfer.status !== "In Transit") {
      res.status(409).json({ error: "You have already confirmed this one." });
      return;
    }
    if (parsed.data.quantityReceived > transfer.quantity_sent) {
      res.status(400).json({ error: `Only ${transfer.quantity_sent} were sent. Report a discrepancy if you received more.` });
      return;
    }

    const short = parsed.data.quantityReceived < transfer.quantity_sent;
    await supabase.from(TRANSFERS).update({
      quantity_received: parsed.data.quantityReceived,
      condition_note: parsed.data.conditionNote ?? null,
      proof_file_path: parsed.data.proofFilePath ?? null,
      status: short ? "Received Short" : "Received",
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id", transferId);

    if (parsed.data.quantityReceived > 0) {
      const result = await applyStockMovement({
        orgId, agentId: agent.id,
        productId: transfer.product_id, productName: transfer.product_name,
        movement: "Received from company",
        quantity: parsed.data.quantityReceived,
        transferId,
        note: short ? `${transfer.quantity_sent} sent, ${parsed.data.quantityReceived} confirmed` : null,
        userId: req.user!.id, userName: req.user!.name
      });
      if (result.error) { res.status(409).json({ error: result.error }); return; }
    }

    res.json({ received: parsed.data.quantityReceived, short });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not confirm that stock." });
  }
});

// ── GET /:id/stock ────────────────────────────────────────
router.get("/:id/stock", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const agentId = paramOf(req.params.id);
    const [stockRes, ledgerRes, transferRes] = await Promise.all([
      supabase.from(STOCK).select("*").eq("agent_id", agentId),
      supabase.from(LEDGER).select("*").eq("agent_id", agentId).order("created_at", { ascending: false }).limit(100),
      supabase.from(TRANSFERS).select("*").eq("agent_id", agentId).order("sent_at", { ascending: false }).limit(50)
    ]);
    res.json({
      stock: stockRes.data ?? [],
      ledger: ledgerRes.data ?? [],
      transfers: transferRes.data ?? [],
      orgId
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load that stock." });
  }
});

// ── GET /my/stock ─────────────────────────────────────────
router.get("/my/stock", requireRole(AGENT_ROLE), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const agent = await agentForUser(orgId, req.user!.id);
    if (!agent) { res.status(404).json({ error: "No delivery agent profile is linked to this login." }); return; }
    const [stockRes, transferRes, ledgerRes] = await Promise.all([
      supabase.from(STOCK).select("*").eq("agent_id", agent.id),
      supabase.from(TRANSFERS).select("*").eq("agent_id", agent.id).eq("status", "In Transit").order("sent_at", { ascending: false }),
      supabase.from(LEDGER).select("*").eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(50)
    ]);
    res.json({
      stock: stockRes.data ?? [],
      incoming: transferRes.data ?? [],
      ledger: ledgerRes.data ?? []
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load your stock." });
  }
});

// ── POST /my/stock/discrepancy ────────────────────────────
// The agent's only lever over their own numbers. Reporting moves NOTHING; a
// manager must approve before any quantity changes.
const DiscrepancySchema = z.object({
  productId: z.string().trim().min(1),
  reportedQuantity: z.number().int().min(0),
  reason: z.enum(["Damaged", "Missing", "Never arrived", "Miscounted", "Stolen", "Other"]),
  agentNote: z.string().trim().max(1000).optional()
});

router.post("/my/stock/discrepancy", requireRole(AGENT_ROLE), async (req, res) => {
  const parsed = DiscrepancySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = orgIdOf(req);
    const agent = await agentForUser(orgId, req.user!.id);
    if (!agent) { res.status(404).json({ error: "No delivery agent profile is linked to this login." }); return; }

    const { data: stockRow } = await supabase.from(STOCK)
      .select("available").eq("agent_id", agent.id).eq("product_id", parsed.data.productId).maybeSingle();

    const { data, error } = await supabase.from(DISCREPANCIES).insert({
      org_id: orgId, agent_id: agent.id,
      product_id: parsed.data.productId,
      reported_quantity: parsed.data.reportedQuantity,
      system_quantity: Number(stockRow?.available ?? 0),
      reason: parsed.data.reason,
      agent_note: parsed.data.agentNote ?? null,
      status: "Reported"
    }).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json({ row: data, note: "Reported. Your stock has not changed - the office will review it." });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not report that." });
  }
});

// ── POST /stock/discrepancies/:discrepancyId/review ───────
// Approving is what finally moves the units, and it books the loss as a cost.
const ReviewDiscrepancySchema = z.object({
  decision: z.enum(["Approved", "Rejected", "Under Investigation"]),
  reviewNote: z.string().trim().max(1000).optional()
}).superRefine((value, ctx) => {
  if (value.decision === "Rejected" && !value.reviewNote?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewNote"], message: "Say why it was rejected." });
  }
});

router.post("/stock/discrepancies/:discrepancyId/review", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = ReviewDiscrepancySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = orgIdOf(req);
    const discrepancyId = paramOf(req.params.discrepancyId);
    const { data: row } = await supabase.from(DISCREPANCIES)
      .select("*").eq("org_id", orgId).eq("id", discrepancyId).maybeSingle();
    if (!row) { res.status(404).json({ error: "Report not found." }); return; }
    if (row.status === "Approved") { res.status(409).json({ error: "That report has already been approved." }); return; }

    if (parsed.data.decision === "Approved") {
      const shortfall = Number(row.system_quantity ?? 0) - Number(row.reported_quantity ?? 0);
      if (shortfall > 0) {
        const movement = row.reason === "Damaged" ? "Written off damaged" : "Written off missing";
        const result = await applyStockMovement({
          orgId, agentId: row.agent_id, productId: row.product_id,
          movement, quantity: shortfall,
          note: `Discrepancy approved: ${row.reason}${parsed.data.reviewNote ? ` - ${parsed.data.reviewNote}` : ""}`,
          userId: req.user!.id, userName: req.user!.name
        });
        if (result.error) { res.status(409).json({ error: result.error }); return; }

        // Writing the units off is only half of it - the loss has to become a
        // cost, or shrinkage still never reaches the P&L.
        await recordStockLossExpense({
          orgId, reference: discrepancyId,
          productId: row.product_id, productName: row.product_id,
          units: shortfall, reason: String(row.reason),
          context: "Personal delivery agent stock report"
        });
      }
    }

    const { data, error } = await supabase.from(DISCREPANCIES).update({
      status: parsed.data.decision,
      review_note: parsed.data.reviewNote ?? null,
      reviewed_by: req.user!.id,
      reviewed_at: new Date().toISOString()
    }).eq("id", discrepancyId).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ row: data });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not review that report." });
  }
});


// ─────────────────────────────────────────────────────────
// COD & Reconciliation (migration 192)
//
// Agents remit the FULL customer payment and are paid their fee separately.
// See backend/src/lib/pda-cod.ts for why netting is not allowed.
// ─────────────────────────────────────────────────────────

const REMITTANCES = "pda_remittances";
const ALLOCATIONS = "pda_remittance_allocations";
const PAYOUTS = "pda_earning_payouts";

const cashShape = (row: any) => ({
  deliveryStatus: row.delivery_status,
  amountCollected: row.amount_collected,
  amountRemitted: row.amount_remitted,
  deliveryFee: row.delivery_fee
});

/** Recomputes reconciliation + earning status for one assignment and saves it. */
async function refreshAssignmentCash(assignmentId: string) {
  const { data: row } = await supabase.from(ASSIGNMENTS).select("*").eq("id", assignmentId).maybeSingle();
  if (!row) return;
  const shape = cashShape(row);
  const reconciliation = reconciliationStatusFor(shape);
  const earning = earningStatusFor(shape, row.earning_status);
  await supabase.from(ASSIGNMENTS).update({
    reconciliation_status: reconciliation,
    earning_status: earning,
    earning_available_at: earning === "Available" && !row.earning_available_at
      ? new Date().toISOString() : row.earning_available_at,
    updated_at: new Date().toISOString()
  }).eq("id", assignmentId);
}

// ── GET /:id/cod ──────────────────────────────────────────
router.get("/:id/cod", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const agentId = paramOf(req.params.id);
    const [assignRes, remitRes, payoutRes] = await Promise.all([
      supabase.from(ASSIGNMENTS).select("*").eq("org_id", orgId).eq("agent_id", agentId)
        .order("delivered_at", { ascending: false }),
      supabase.from(REMITTANCES).select("*").eq("org_id", orgId).eq("agent_id", agentId)
        .order("received_at", { ascending: false }).limit(50),
      supabase.from(PAYOUTS).select("*").eq("org_id", orgId).eq("agent_id", agentId)
        .order("paid_at", { ascending: false }).limit(50)
    ]);
    const assignments = assignRes.data ?? [];
    const position = cashPositionFor(
      assignments.map(cashShape),
      assignments.map((row: any) => row.earning_status)
    );

    const orderIds = [...new Set(assignments.map((row: any) => row.order_id))];
    const { data: orders } = orderIds.length
      ? await supabase.from("orders").select("id, customer, amount").eq("org_id", orgId).in("id", orderIds)
      : { data: [] as any[] };
    const orderById = new Map((orders ?? []).map((o: any) => [o.id, o]));

    res.json({
      position,
      rows: assignments
        .filter((row: any) => row.delivery_status === "Delivered")
        .map((row: any) => ({
          assignmentId: row.id,
          orderId: row.order_id,
          customer: orderById.get(row.order_id)?.customer ?? null,
          orderValue: Number(orderById.get(row.order_id)?.amount ?? 0),
          amountCollected: Number(row.amount_collected ?? 0),
          paymentMethod: row.payment_method,
          deliveryFee: Number(row.delivery_fee ?? 0),
          // Always the full collected amount - never reduced by the fee.
          amountDue: Number(row.amount_collected ?? 0),
          amountRemitted: Number(row.amount_remitted ?? 0),
          difference: Number(row.amount_collected ?? 0) - Number(row.amount_remitted ?? 0),
          reconciliationStatus: row.reconciliation_status,
          earningStatus: row.earning_status,
          deliveredAt: row.delivered_at
        })),
      remittances: remitRes.data ?? [],
      payouts: payoutRes.data ?? []
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the cash position." });
  }
});

// ── POST /:id/remittances ─────────────────────────────────
// Logged by the office when the money is actually in hand. "The agent says
// they sent it" and "we have it" are different facts, so only the second one
// reduces what they owe.
const RemittanceSchema = z.object({
  amount: z.number().min(1),
  method: z.enum(["Cash", "Transfer", "POS", "Other"]).default("Cash"),
  reference: z.string().trim().max(200).optional(),
  note: z.string().trim().max(500).optional()
});

router.post("/:id/remittances", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = RemittanceSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  try {
    const orgId = orgIdOf(req);
    const agentId = paramOf(req.params.id);

    const { data: assignments } = await supabase.from(ASSIGNMENTS)
      .select("*").eq("org_id", orgId).eq("agent_id", agentId).eq("delivery_status", "Delivered")
      .order("delivered_at", { ascending: true });

    const debts = (assignments ?? []).map((row: any) => ({
      assignmentId: row.id,
      outstanding: outstandingForAssignment(cashShape(row))
    })).filter((debt) => debt.outstanding > 0);

    const { allocations, unallocated } = allocateRemittance(parsed.data.amount, debts);
    if (allocations.length === 0) {
      res.status(409).json({ error: "This agent has no outstanding cash to apply a payment to." });
      return;
    }

    const { data: remittance, error } = await supabase.from(REMITTANCES).insert({
      org_id: orgId, agent_id: agentId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      reference: parsed.data.reference ?? null,
      note: parsed.data.note ?? null,
      received_by: req.user!.id,
      received_by_name: req.user!.name
    }).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from(ALLOCATIONS).insert(allocations.map((allocation) => ({
      org_id: orgId,
      remittance_id: remittance.id,
      assignment_id: allocation.assignmentId,
      amount: allocation.amount
    })));

    // Apply to each order, then recompute its status so the fee becomes
    // payable at exactly the moment the cash is fully in.
    for (const allocation of allocations) {
      const row = (assignments ?? []).find((a: any) => a.id === allocation.assignmentId);
      const next = Number(row?.amount_remitted ?? 0) + allocation.amount;
      await supabase.from(ASSIGNMENTS)
        .update({ amount_remitted: next, updated_at: new Date().toISOString() })
        .eq("id", allocation.assignmentId);
      await refreshAssignmentCash(allocation.assignmentId);
    }

    // If the agent handed over more than they owed, say so rather than quietly
    // keeping it - an unexplained surplus is as much a red flag as a shortfall.
    res.status(201).json({
      row: remittance,
      applied: allocations.length,
      unallocated,
      note: unallocated > 0
        ? `${unallocated} more than this agent owed. Confirm where it came from before treating it as settled.`
        : undefined
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not record that payment." });
  }
});

// ── POST /:id/earnings/pay ────────────────────────────────
// Pays out fees that have become available. Only orders whose customer cash is
// fully in are eligible - paying earlier means paying for money we do not have.
router.post("/:id/earnings/pay", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const agentId = paramOf(req.params.id);
    const { data: assignments } = await supabase.from(ASSIGNMENTS)
      .select("*").eq("org_id", orgId).eq("agent_id", agentId).eq("earning_status", "Available");

    const eligible = assignments ?? [];
    const total = eligible.reduce((sum: number, row: any) => sum + Number(row.delivery_fee ?? 0), 0);
    if (total <= 0) { res.status(409).json({ error: "This agent has no earnings available to pay." }); return; }

    const { data: payout, error } = await supabase.from(PAYOUTS).insert({
      org_id: orgId, agent_id: agentId,
      amount: total,
      method: typeof req.body?.method === "string" ? req.body.method : null,
      reference: typeof req.body?.reference === "string" ? req.body.reference : null,
      paid_by: req.user!.id, paid_by_name: req.user!.name
    }).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    await supabase.from(ASSIGNMENTS).update({
      earning_status: "Paid",
      earning_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).in("id", eligible.map((row: any) => row.id));

    res.status(201).json({ row: payout, orders: eligible.length, amount: total });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not pay those earnings." });
  }
});

// ── GET /my/wallet ────────────────────────────────────────
// The agent's own money. Company cash and their earnings are kept visibly
// apart so "what I owe" is never confused with "what I am owed".
router.get("/my/wallet", requireRole(AGENT_ROLE), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const agent = await agentForUser(orgId, req.user!.id);
    if (!agent) { res.status(404).json({ error: "No delivery agent profile is linked to this login." }); return; }

    const { data: assignments } = await supabase.from(ASSIGNMENTS)
      .select("*").eq("agent_id", agent.id);
    const rows = assignments ?? [];
    const position = cashPositionFor(rows.map(cashShape), rows.map((row: any) => row.earning_status));

    const { data: payouts } = await supabase.from(PAYOUTS)
      .select("amount, paid_at, reference").eq("agent_id", agent.id)
      .order("paid_at", { ascending: false }).limit(20);

    res.json({
      codToRemit: position.outstanding,
      ordersWithCashOutstanding: position.ordersWithCashOutstanding,
      availableEarnings: position.availableEarnings,
      pendingEarnings: position.pendingEarnings,
      recentPayouts: payouts ?? [],
      codLimit: agent.max_cod_exposure === null || agent.max_cod_exposure === undefined
        ? null : Number(agent.max_cod_exposure)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load your wallet." });
  }
});


// ─────────────────────────────────────────────────────────
// Orders & Dispatch
// ─────────────────────────────────────────────────────────

/** Live figures needed to judge whether an agent can take more work. */
async function agentCapacitySnapshot(orgId: string, productId?: string | null) {
  const [{ data: agents }, { data: assignments }, { data: stock }] = await Promise.all([
    supabase.from(AGENTS)
      .select("id, full_name, account_status, availability, trust_level, state, service_areas, max_active_orders, max_cod_exposure")
      .eq("org_id", orgId),
    supabase.from(ASSIGNMENTS)
      .select("agent_id, delivery_status, amount_collected, amount_remitted, delivery_fee")
      .eq("org_id", orgId),
    productId
      ? supabase.from("pda_agent_stock").select("agent_id, available").eq("org_id", orgId).eq("product_id", productId)
      : Promise.resolve({ data: [] as any[] })
  ]);

  const rows = assignments ?? [];
  const activeByAgent = new Map<string, number>();
  const cashByAgent = new Map<string, number>();
  for (const row of rows as any[]) {
    if (["Ready for Dispatch", "Dispatch Started", "Arrived at Customer Location", "Rescheduled"].includes(row.delivery_status)) {
      activeByAgent.set(row.agent_id, (activeByAgent.get(row.agent_id) ?? 0) + 1);
    }
    const owed = outstandingForAssignment({
      deliveryStatus: row.delivery_status,
      amountCollected: row.amount_collected,
      amountRemitted: row.amount_remitted,
      deliveryFee: row.delivery_fee
    });
    if (owed > 0) cashByAgent.set(row.agent_id, (cashByAgent.get(row.agent_id) ?? 0) + owed);
  }
  const stockByAgent = new Map<string, number>(
    (stock ?? []).map((row: any) => [row.agent_id, Number(row.available ?? 0)])
  );

  return (agents ?? []).map((row: any) => ({
    id: row.id,
    fullName: row.full_name,
    accountStatus: row.account_status,
    availability: row.availability,
    trustLevel: row.trust_level,
    state: row.state,
    serviceAreas: Array.isArray(row.service_areas) ? row.service_areas : [],
    maxActiveOrders: row.max_active_orders,
    maxCodExposure: row.max_cod_exposure === null || row.max_cod_exposure === undefined
      ? null : Number(row.max_cod_exposure),
    activeOrders: activeByAgent.get(row.id) ?? 0,
    cashOutstanding: cashByAgent.get(row.id) ?? 0,
    availableStock: stockByAgent.get(row.id) ?? 0
  }));
}

// ── GET /assignments/candidates?orderId= ──────────────────
// Who can take this order, and for everyone who cannot, why not. The reasons
// matter: a dispatcher facing an empty list needs to know whether nobody has
// stock or nobody is online, not just that the list is empty.
router.get("/assignments/candidates", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const orderId = typeof req.query.orderId === "string" ? req.query.orderId : "";
    if (!orderId) { res.status(400).json({ error: "An order id is required." }); return; }

    const { data: order } = await supabase.from("orders")
      .select("id, customer, state, product_id, product_name, quantity, amount")
      .eq("org_id", orgId).eq("id", orderId).maybeSingle();
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }

    const agents = await agentCapacitySnapshot(orgId, order.product_id);
    const ranked = rankCandidates(agents, {
      state: order.state,
      quantity: Math.max(1, Number(order.quantity ?? 1)),
      amount: Number(order.amount ?? 0)
    });

    res.json({
      order: {
        id: order.id, customer: order.customer, state: order.state,
        productName: order.product_name, quantity: order.quantity, amount: Number(order.amount ?? 0)
      },
      candidates: ranked
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not work out who can take this order." });
  }
});

// ── GET /assignments ──────────────────────────────────────
// Management sees every assignment. A Sales Rep sees only the ones on THEIR
// customers' orders - they monitor their own deliveries, they do not run the
// agent fleet.
router.get("/assignments", requireRole(...READ_ROLES), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const isManagement = (MANAGEMENT_ROLES as readonly string[]).includes(req.user!.role);

    let query = supabase.from(ASSIGNMENTS).select("*").eq("org_id", orgId)
      .order("offered_at", { ascending: false }).limit(300);
    const status = typeof req.query.status === "string" ? req.query.status : null;
    if (status && status !== "All") query = query.eq("delivery_status", status);
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId : null;
    if (agentId) query = query.eq("agent_id", agentId);

    const { data: assignments, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }

    const orderIds = [...new Set((assignments ?? []).map((row: any) => row.order_id))];
    const { data: orders } = orderIds.length
      ? await supabase.from("orders")
          .select("id, customer, phone, state, product_name, package_name, amount, assigned_rep_id")
          .eq("org_id", orgId).in("id", orderIds)
      : { data: [] as any[] };
    const orderById = new Map((orders ?? []).map((o: any) => [o.id, o]));

    const { data: agentRows } = await supabase.from(AGENTS)
      .select("id, full_name, phone, availability, account_status").eq("org_id", orgId);
    const agentById = new Map((agentRows ?? []).map((a: any) => [a.id, a]));

    const scopeId = req.user!.effectiveUserId ?? req.user!.id;
    const rows = (assignments ?? [])
      .filter((row: any) => {
        if (isManagement) return true;
        return orderById.get(row.order_id)?.assigned_rep_id === scopeId;
      })
      .map((row: any) => {
        const order = orderById.get(row.order_id);
        const agent = agentById.get(row.agent_id);
        return {
          id: row.id,
          orderId: row.order_id,
          customer: order?.customer ?? null,
          state: order?.state ?? null,
          productName: order?.package_name || order?.product_name || null,
          orderValue: Number(order?.amount ?? 0),
          agentId: row.agent_id,
          agentName: agent?.full_name ?? null,
          // A rep needs to be able to ring the agent about their own customer.
          agentPhone: agent?.phone ?? null,
          agentAvailability: agent?.availability ?? null,
          assignmentStatus: row.assignment_status,
          customerContactStatus: row.customer_contact_status,
          deliveryStatus: row.delivery_status,
          declineReason: row.decline_reason,
          failureReason: row.failure_reason,
          deliveryFee: Number(row.delivery_fee ?? 0),
          expectedArrivalAt: row.expected_arrival_at,
          dispatchStartedAt: row.dispatch_started_at,
          deliveredAt: row.delivered_at,
          rescheduledTo: row.rescheduled_to,
          // Managers and reps both need "when did anyone last touch this".
          lastUpdatedAt: row.updated_at,
          // Cash figures are management-only: a rep monitoring a delivery has
          // no business seeing what an agent owes the company.
          ...(isManagement ? {
            amountCollected: row.amount_collected === null ? null : Number(row.amount_collected),
            amountRemitted: Number(row.amount_remitted ?? 0),
            reconciliationStatus: row.reconciliation_status
          } : {})
        };
      });

    res.json({ rows, scope: isManagement ? "management" : "rep" });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load dispatch." });
  }
});


// ─────────────────────────────────────────────────────────
// Fees & Earnings, Incidents, Reports, Settings (migration 193)
// ─────────────────────────────────────────────────────────

const FEE_RULES = "pda_fee_rules";
const NEGOTIATIONS = "pda_fee_negotiations";
const INCIDENTS = "pda_incidents";
const SETTINGS = "pda_settings";

const DEFAULT_SETTINGS = {
  probationDays: 30,
  probationMaxStock: 20, probationMaxCod: 100000, probationMaxActiveOrders: 3,
  verifiedMaxStock: 60, verifiedMaxCod: 300000, verifiedMaxActiveOrders: 8,
  trustedMaxStock: 150, trustedMaxCod: 750000, trustedMaxActiveOrders: 15,
  staleOrderHours: 24, remittanceGraceDays: 3,
  workingHoursStart: "08:30", workingHoursEnd: "17:30", kycValidMonths: 12
};

const mapSettings = (row: any) => !row ? DEFAULT_SETTINGS : ({
  probationDays: Number(row.probation_days ?? DEFAULT_SETTINGS.probationDays),
  probationMaxStock: Number(row.probation_max_stock ?? DEFAULT_SETTINGS.probationMaxStock),
  probationMaxCod: Number(row.probation_max_cod ?? DEFAULT_SETTINGS.probationMaxCod),
  probationMaxActiveOrders: Number(row.probation_max_active_orders ?? DEFAULT_SETTINGS.probationMaxActiveOrders),
  verifiedMaxStock: Number(row.verified_max_stock ?? DEFAULT_SETTINGS.verifiedMaxStock),
  verifiedMaxCod: Number(row.verified_max_cod ?? DEFAULT_SETTINGS.verifiedMaxCod),
  verifiedMaxActiveOrders: Number(row.verified_max_active_orders ?? DEFAULT_SETTINGS.verifiedMaxActiveOrders),
  trustedMaxStock: Number(row.trusted_max_stock ?? DEFAULT_SETTINGS.trustedMaxStock),
  trustedMaxCod: Number(row.trusted_max_cod ?? DEFAULT_SETTINGS.trustedMaxCod),
  trustedMaxActiveOrders: Number(row.trusted_max_active_orders ?? DEFAULT_SETTINGS.trustedMaxActiveOrders),
  staleOrderHours: Number(row.stale_order_hours ?? DEFAULT_SETTINGS.staleOrderHours),
  remittanceGraceDays: Number(row.remittance_grace_days ?? DEFAULT_SETTINGS.remittanceGraceDays),
  workingHoursStart: String(row.working_hours_start ?? DEFAULT_SETTINGS.workingHoursStart).slice(0, 5),
  workingHoursEnd: String(row.working_hours_end ?? DEFAULT_SETTINGS.workingHoursEnd).slice(0, 5),
  kycValidMonths: Number(row.kyc_valid_months ?? DEFAULT_SETTINGS.kycValidMonths)
});

const mapFeeRule = (row: any) => ({
  id: row.id, scope: row.scope, matchValue: row.match_value ?? null,
  distanceMinKm: row.distance_min_km === null || row.distance_min_km === undefined ? null : Number(row.distance_min_km),
  distanceMaxKm: row.distance_max_km === null || row.distance_max_km === undefined ? null : Number(row.distance_max_km),
  fee: Number(row.fee ?? 0),
  sameDaySurcharge: Number(row.same_day_surcharge ?? 0),
  active: row.active, note: row.note ?? null
});

// ── Settings ──────────────────────────────────────────────
router.get("/settings", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const { data } = await supabase.from(SETTINGS).select("*").eq("org_id", orgIdOf(req)).maybeSingle();
  res.json({ settings: mapSettings(data) });
});

const SettingsSchema = z.object({
  probationDays: z.number().int().min(0).max(365),
  probationMaxStock: z.number().int().min(0), probationMaxCod: z.number().min(0), probationMaxActiveOrders: z.number().int().min(0),
  verifiedMaxStock: z.number().int().min(0), verifiedMaxCod: z.number().min(0), verifiedMaxActiveOrders: z.number().int().min(0),
  trustedMaxStock: z.number().int().min(0), trustedMaxCod: z.number().min(0), trustedMaxActiveOrders: z.number().int().min(0),
  staleOrderHours: z.number().int().min(1).max(720),
  remittanceGraceDays: z.number().int().min(0).max(90),
  workingHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
  workingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
  kycValidMonths: z.number().int().min(1).max(120)
}).superRefine((value, ctx) => {
  // Limits that get tighter as trust grows would be nonsense, and would let a
  // demotion silently INCREASE someone's exposure.
  if (value.verifiedMaxCod < value.probationMaxCod || value.trustedMaxCod < value.verifiedMaxCod) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["trustedMaxCod"], message: "Cash limits must not shrink as trust increases." });
  }
  if (value.verifiedMaxStock < value.probationMaxStock || value.trustedMaxStock < value.verifiedMaxStock) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["trustedMaxStock"], message: "Stock limits must not shrink as trust increases." });
  }
});

router.put("/settings", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const d = parsed.data;
  const { error } = await supabase.from(SETTINGS).upsert({
    org_id: orgIdOf(req),
    probation_days: d.probationDays,
    probation_max_stock: d.probationMaxStock, probation_max_cod: d.probationMaxCod, probation_max_active_orders: d.probationMaxActiveOrders,
    verified_max_stock: d.verifiedMaxStock, verified_max_cod: d.verifiedMaxCod, verified_max_active_orders: d.verifiedMaxActiveOrders,
    trusted_max_stock: d.trustedMaxStock, trusted_max_cod: d.trustedMaxCod, trusted_max_active_orders: d.trustedMaxActiveOrders,
    stale_order_hours: d.staleOrderHours, remittance_grace_days: d.remittanceGraceDays,
    working_hours_start: d.workingHoursStart, working_hours_end: d.workingHoursEnd,
    kyc_valid_months: d.kycValidMonths,
    updated_at: new Date().toISOString(), updated_by: req.user!.id
  }, { onConflict: "org_id" });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ settings: d });
});

// ── Fee rules ─────────────────────────────────────────────
router.get("/fees/rules", requireRole(...READ_ROLES), async (req, res) => {
  const { data, error } = await supabase.from(FEE_RULES).select("*")
    .eq("org_id", orgIdOf(req)).order("scope").order("fee");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ rows: (data ?? []).map(mapFeeRule) });
});

const FeeRuleSchema = z.object({
  scope: z.enum(["default", "state", "city", "zone", "distance", "product"]),
  matchValue: z.string().trim().max(160).optional(),
  distanceMinKm: z.number().min(0).optional(),
  distanceMaxKm: z.number().min(0).optional(),
  fee: z.number().min(0),
  sameDaySurcharge: z.number().min(0).optional(),
  note: z.string().trim().max(300).optional()
}).superRefine((value, ctx) => {
  if (value.scope !== "default" && value.scope !== "distance" && !value.matchValue?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["matchValue"], message: `A ${value.scope} rule needs a ${value.scope} to match.` });
  }
  if (value.scope === "distance") {
    if (value.distanceMinKm === undefined || value.distanceMaxKm === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["distanceMaxKm"], message: "A distance band needs both a from and a to." });
    } else if (value.distanceMaxKm <= value.distanceMinKm) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["distanceMaxKm"], message: "The upper bound must be above the lower one." });
    }
  }
});

router.post("/fees/rules", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = FeeRuleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const { data, error } = await supabase.from(FEE_RULES).insert({
    org_id: orgIdOf(req), scope: parsed.data.scope,
    match_value: parsed.data.matchValue ?? null,
    distance_min_km: parsed.data.distanceMinKm ?? null,
    distance_max_km: parsed.data.distanceMaxKm ?? null,
    fee: parsed.data.fee,
    same_day_surcharge: parsed.data.sameDaySurcharge ?? 0,
    note: parsed.data.note ?? null,
    created_by: req.user!.id
  }).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ row: mapFeeRule(data) });
});

router.delete("/fees/rules/:ruleId", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  // Deactivated rather than deleted: an order priced by this rule should still
  // be explainable months later.
  const { error } = await supabase.from(FEE_RULES)
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("org_id", orgIdOf(req)).eq("id", paramOf(req.params.ruleId));
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, deactivated: true });
});

// ── GET /fees/quote?orderId= ──────────────────────────────
// What the standard rate says this delivery is worth, and which rule decided.
router.get("/fees/quote", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const orderId = typeof req.query.orderId === "string" ? req.query.orderId : "";
    const { data: order } = await supabase.from("orders")
      .select("id, state, city, product_id").eq("org_id", orgId).eq("id", orderId).maybeSingle();
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }
    const { data: rules } = await supabase.from(FEE_RULES).select("*").eq("org_id", orgId).eq("active", true);
    const quote = resolveStandardFee((rules ?? []).map(mapFeeRule) as any, {
      state: order.state, city: (order as any).city ?? null, productId: order.product_id,
      sameDay: String(req.query.sameDay) === "true"
    });
    res.json({ quote });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not price that delivery." });
  }
});

// ── Negotiated rates ──────────────────────────────────────
router.get("/fees/negotiations", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const { data, error } = await supabase.from(NEGOTIATIONS).select("*")
    .eq("org_id", orgIdOf(req)).order("created_at", { ascending: false }).limit(100);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ rows: data ?? [] });
});

// The agent asks for a different rate on an awkward order.
router.post("/my/orders/:assignmentId/propose-fee", requireRole(AGENT_ROLE), async (req, res) => {
  const proposedFee = Number(req.body?.proposedFee);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isFinite(proposedFee) || proposedFee < 0) { res.status(400).json({ error: "Enter the fee you need." }); return; }
  if (!reason) { res.status(400).json({ error: "Say why the standard fee does not work." }); return; }
  const found = await loadOwnAssignment(orgIdOf(req), req.user!.id, paramOf(req.params.assignmentId));
  if ("error" in found) { res.status(404).json({ error: found.error }); return; }
  // Once the trip has begun the cost is already sunk, so the fee is settled.
  if (found.assignment.dispatch_started_at) {
    res.status(409).json({ error: "You have already started this delivery, so the fee is fixed." });
    return;
  }
  const { data, error } = await supabase.from(NEGOTIATIONS).insert({
    org_id: orgIdOf(req), assignment_id: found.assignment.id, agent_id: found.agent.id,
    standard_fee: found.assignment.delivery_fee, proposed_fee: proposedFee,
    proposed_reason: reason, status: "Pending"
  }).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  await supabase.from(ASSIGNMENTS)
    .update({ fee_status: "Pending Approval", updated_at: new Date().toISOString() })
    .eq("id", found.assignment.id);
  res.status(201).json({ row: data });
});

const NegotiationDecisionSchema = z.object({
  decision: z.enum(["Approved", "Rejected", "Countered"]),
  counterFee: z.number().min(0).optional(),
  note: z.string().trim().max(500).optional()
}).superRefine((value, ctx) => {
  if (value.decision === "Countered" && value.counterFee === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["counterFee"], message: "A counter needs a figure." });
  }
  if (value.decision === "Rejected" && !value.note?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "Say why it was rejected." });
  }
});

router.post("/fees/negotiations/:negotiationId/decide", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = NegotiationDecisionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const orgId = orgIdOf(req);
  const negotiationId = paramOf(req.params.negotiationId);
  const { data: negotiation } = await supabase.from(NEGOTIATIONS)
    .select("*").eq("org_id", orgId).eq("id", negotiationId).maybeSingle();
  if (!negotiation) { res.status(404).json({ error: "Request not found." }); return; }

  const { error } = await supabase.from(NEGOTIATIONS).update({
    status: parsed.data.decision,
    counter_fee: parsed.data.counterFee ?? null,
    decision_note: parsed.data.note ?? null,
    decided_by: req.user!.id, decided_by_name: req.user!.name,
    decided_at: new Date().toISOString()
  }).eq("id", negotiationId);
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Approving locks the agreed figure to the order. Rejecting leaves the
  // original standard fee locked, so nothing is ever left unpriced.
  if (parsed.data.decision === "Approved") {
    await supabase.from(ASSIGNMENTS).update({
      delivery_fee: negotiation.proposed_fee,
      fee_status: "Locked", fee_locked_at: new Date().toISOString(),
      fee_proposed_by: "Agent", updated_at: new Date().toISOString()
    }).eq("id", negotiation.assignment_id);
  } else if (parsed.data.decision === "Rejected") {
    await supabase.from(ASSIGNMENTS).update({
      fee_status: "Locked", fee_locked_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", negotiation.assignment_id);
  }
  res.json({ ok: true });
});

// ── Incidents ─────────────────────────────────────────────
router.get("/incidents", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : null;
  let query = supabase.from(INCIDENTS).select("*").eq("org_id", orgIdOf(req))
    .order("created_at", { ascending: false }).limit(200);
  if (status && status !== "All") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ rows: data ?? [] });
});

const IncidentSchema = z.object({
  agentId: z.string().uuid(),
  orderId: z.string().trim().max(60).optional(),
  incidentType: z.enum([
    "Missing inventory", "Damaged product", "Missing COD", "Customer complaint",
    "Agent misconduct", "Delivery accident", "Theft", "Wrong product delivered",
    "False delivery claim", "Unsafe delivery location", "Other"
  ]),
  severity: z.enum(["Low", "Medium", "High", "Critical"]),
  description: z.string().trim().min(5, "Describe what happened.").max(2000),
  amountAtRisk: z.number().min(0).optional()
});

router.post("/incidents", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = IncidentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const { data, error } = await supabase.from(INCIDENTS).insert({
    org_id: orgIdOf(req), agent_id: parsed.data.agentId,
    order_id: parsed.data.orderId ?? null,
    incident_type: parsed.data.incidentType, severity: parsed.data.severity,
    description: parsed.data.description,
    amount_at_risk: parsed.data.amountAtRisk ?? 0,
    status: "Open",
    reported_by: req.user!.id, reported_by_name: req.user!.name
  }).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }

  // A serious open incident should stop new work reaching that agent while it
  // is investigated - that is the entire point of raising one.
  if (parsed.data.severity === "Critical" || parsed.data.severity === "High") {
    await supabase.from(AGENTS).update({
      account_status: "Temporarily Suspended",
      availability: "Offline",
      restriction_reason: `${parsed.data.severity} incident: ${parsed.data.incidentType}`,
      updated_at: new Date().toISOString()
    }).eq("org_id", orgIdOf(req)).eq("id", parsed.data.agentId)
      .in("account_status", OPERATIONAL_STATUSES);
  }
  res.status(201).json({ row: data, agentSuspended: ["Critical", "High"].includes(parsed.data.severity) });
});

const IncidentUpdateSchema = z.object({
  status: z.enum(["Open", "Under Investigation", "Awaiting Agent Response", "Resolved", "Closed - No Action", "Escalated"]),
  resolution: z.string().trim().max(2000).optional(),
  finalDecision: z.string().trim().max(500).optional(),
  amountAtRisk: z.number().min(0).optional()
}).superRefine((value, ctx) => {
  if ((value.status === "Resolved" || value.status === "Closed - No Action") && !value.resolution?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "Record what was actually decided." });
  }
});

router.patch("/incidents/:incidentId", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  const parsed = IncidentUpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const patch: Record<string, unknown> = {
    status: parsed.data.status, updated_at: new Date().toISOString()
  };
  if (parsed.data.resolution !== undefined) patch.resolution = parsed.data.resolution;
  if (parsed.data.finalDecision !== undefined) patch.final_decision = parsed.data.finalDecision;
  if (parsed.data.amountAtRisk !== undefined) patch.amount_at_risk = parsed.data.amountAtRisk;
  if (parsed.data.status === "Resolved" || parsed.data.status === "Closed - No Action") {
    patch.resolved_at = new Date().toISOString();
  }
  const { data, error } = await supabase.from(INCIDENTS).update(patch)
    .eq("org_id", orgIdOf(req)).eq("id", paramOf(req.params.incidentId)).select("*").single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ row: data });
});

// ── Reports ───────────────────────────────────────────────
// Per-agent performance. Every figure is counted from real rows; an agent with
// no deliveries yet gets nulls rather than a 0% delivery rate, which would read
// as failure rather than "no data".
router.get("/reports", requireRole(...MANAGEMENT_ROLES), async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const [{ data: agents }, { data: assignments }, { data: incidents }, { data: stock }] = await Promise.all([
      supabase.from(AGENTS).select("id, full_name, agent_code, account_status, trust_level, state").eq("org_id", orgId),
      supabase.from(ASSIGNMENTS).select("*").eq("org_id", orgId),
      supabase.from(INCIDENTS).select("agent_id, status, amount_at_risk").eq("org_id", orgId),
      supabase.from("pda_agent_stock").select("agent_id, available, reserved, out_for_delivery, damaged, missing, awaiting_investigation").eq("org_id", orgId)
    ]);

    const rows = (agents ?? []).map((agent: any) => {
      const mine = (assignments ?? []).filter((row: any) => row.agent_id === agent.id);
      const closed = mine.filter((row: any) => ["Delivered", "Failed", "Rejected"].includes(row.delivery_status));
      const delivered = mine.filter((row: any) => row.delivery_status === "Delivered");
      const offered = mine.length;
      const accepted = mine.filter((row: any) => row.assignment_status === "Accepted").length;
      const declined = mine.filter((row: any) => row.assignment_status === "Declined").length;

      const position = cashPositionFor(
        mine.map((row: any) => ({
          deliveryStatus: row.delivery_status, amountCollected: row.amount_collected,
          amountRemitted: row.amount_remitted, deliveryFee: row.delivery_fee
        })),
        mine.map((row: any) => row.earning_status)
      );
      const agentIncidents = (incidents ?? []).filter((row: any) => row.agent_id === agent.id);
      const agentStock = (stock ?? []).filter((row: any) => row.agent_id === agent.id);

      return {
        agentId: agent.id, fullName: agent.full_name, agentCode: agent.agent_code,
        accountStatus: agent.account_status, trustLevel: agent.trust_level, state: agent.state,
        ordersOffered: offered, ordersAccepted: accepted, ordersDeclined: declined,
        // Null, not 0 - "no data" and "never delivers" are different facts.
        acceptanceRatePct: offered > 0 ? Math.round((accepted / offered) * 1000) / 10 : null,
        delivered: delivered.length,
        failed: closed.length - delivered.length,
        deliveryRatePct: closed.length > 0 ? Math.round((delivered.length / closed.length) * 1000) / 10 : null,
        rescheduled: mine.filter((row: any) => row.delivery_status === "Rescheduled").length,
        cashOutstanding: position.outstanding,
        earningsAvailable: position.availableEarnings,
        earningsPaid: mine.filter((row: any) => row.earning_status === "Paid")
          .reduce((sum: number, row: any) => sum + Number(row.delivery_fee ?? 0), 0),
        openIncidents: agentIncidents.filter((row: any) => !["Resolved", "Closed - No Action"].includes(row.status)).length,
        amountAtRisk: agentIncidents
          .filter((row: any) => !["Resolved", "Closed - No Action"].includes(row.status))
          .reduce((sum: number, row: any) => sum + Number(row.amount_at_risk ?? 0), 0),
        unitsHeld: agentStock.reduce((sum: number, row: any) =>
          sum + Number(row.available ?? 0) + Number(row.reserved ?? 0) + Number(row.out_for_delivery ?? 0), 0),
        unitsUnaccounted: agentStock.reduce((sum: number, row: any) =>
          sum + Number(row.damaged ?? 0) + Number(row.missing ?? 0) + Number(row.awaiting_investigation ?? 0), 0)
      };
    });

    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not build the report." });
  }
});

export default router;
