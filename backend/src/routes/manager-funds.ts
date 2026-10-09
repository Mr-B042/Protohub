import { randomUUID } from "node:crypto";
import { recomputeWaybillWeek } from "../lib/waybill-costs.js";
import { Router, type Request } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey, weekEndFromStart } from "../lib/sales-bonus-engine.js";
import {
  DEFAULT_FUND_SETTINGS, FUND_CATEGORIES, KIND_LABEL, customerPaymentEffect, fundTotals, fundsEditable, fundsReadiness,
  logisticsSplit, missingProof, scaleSplits, splitProblem, type FundKind, type ProductSplit, type FundSettings, type FundTxn
} from "../lib/manager-funds.js";
import { notifyFunds } from "../lib/weekly-report-notifications.js";

// Manager Funds & Expenses (Bright, 1 Oct 2026). See migration 271 and
// lib/manager-funds.ts for the maths and rules.
//
// ⚠️ EVERY ENTRY IS MIRRORED INTO THE BOOKS so nothing is counted twice:
//   customer payment -> a payment on the order (same rules as the order screen)
//   owner / company funds in, remittance out -> a transfer between accounts
//   expense -> an Expenses row from her wallet account
//   other money in -> her ledger only (Cash Flow has no home for it)
// Each write creates the ledger row, then the mirror; if the mirror fails the
// ledger row is removed, so the two never disagree.
const router = Router();
router.use(requireAuth);

const LEADERSHIP = ["Owner", "Admin", "Manager"] as const;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const EVIDENCE_BUCKET = "manager-fund-evidence";
const EVIDENCE_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "application/pdf": "pdf"
};

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const sendError = (res: any, error: any, fallback: string) => res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
const round = (value: number) => Math.round(value * 100) / 100;
const lagosDay = (iso: string) => new Date(new Date(iso).getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);

const requireBranch = (req: Request) => {
  const branchId = req.user!.branchId;
  if (!branchId) throw httpError(400, "Open a branch first.");
  return branchId;
};

async function audit(req: Request, branchId: string, weekStart: string, action: string, detail: Record<string, unknown>) {
  const { error } = await supabase.from("weekly_report_audit").insert({
    org_id: req.user!.orgId, branch_id: branchId, week_start: weekStart,
    actor_id: req.user!.id, actor_name: req.user!.name ?? null, actor_role: req.user!.role,
    action, detail
  });
  if (error) throw error;
}

async function loadSettings(orgId: string, branchId: string): Promise<FundSettings> {
  const { data, error } = await supabase.from("manager_fund_settings")
    .select("expense_proof_min, remittance_proof_required, owner_funding_reference_required, other_in_proof_required")
    .eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  if (error) throw error;
  if (!data) return DEFAULT_FUND_SETTINGS;
  return {
    expenseProofMin: Number(data.expense_proof_min ?? DEFAULT_FUND_SETTINGS.expenseProofMin),
    remittanceProofRequired: !!data.remittance_proof_required,
    ownerFundingReferenceRequired: !!data.owner_funding_reference_required,
    otherInProofRequired: !!data.other_in_proof_required
  };
}

async function companyStatus(orgId: string, branchId: string, weekStart: string): Promise<string | null> {
  const { data, error } = await supabase.from("company_weekly_reports").select("status")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).maybeSingle();
  if (error) throw error;
  return data?.status ?? null;
}

async function findWallet(orgId: string, branchId: string, managerId: string) {
  const { data, error } = await supabase.from("bank_accounts").select("id, name")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("holder_user_id", managerId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Her wallet: an ordinary 'cash' account with her as holder. Made on first use. */
async function ensureWallet(orgId: string, branchId: string, manager: { id: string; name: string }) {
  const existing = await findWallet(orgId, branchId, manager.id);
  if (existing) return existing;
  const { data, error } = await supabase.from("bank_accounts").insert({
    org_id: orgId, branch_id: branchId, holder_user_id: manager.id,
    name: `${manager.name} - Manager Wallet`, account_type: "cash", bank_name: "Manager wallet",
    account_number_last4: "", is_primary: false, active: true, opening_balance: 0
  }).select("id, name").single();
  if (error) {
    // Two first-writes at once: the unique (branch, holder) index wins; read it back.
    const again = await findWallet(orgId, branchId, manager.id);
    if (again) return again;
    throw error;
  }
  return data;
}

/** Opening = last locked week's COUNTED closing (Cash Flow's counted-opening rule); else 0. */
async function resolveOpening(orgId: string, branchId: string, managerId: string, weekStart: string) {
  const { data: existing, error } = await supabase.from("manager_fund_weeks").select("*")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("manager_id", managerId).eq("week_start", weekStart).maybeSingle();
  if (error) throw error;
  if (existing) return { row: existing, opening: Number(existing.opening_balance ?? 0), source: existing.opening_source as string };
  const { data: previous, error: previousError } = await supabase.from("manager_fund_weeks")
    .select("week_start, actual_closing, closing_snapshot")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("manager_id", managerId)
    .lt("week_start", weekStart).not("locked_at", "is", null)
    .order("week_start", { ascending: false }).limit(1).maybeSingle();
  if (previousError) throw previousError;
  if (previous) {
    const carried = previous.actual_closing ?? previous.closing_snapshot?.expected ?? 0;
    return { row: null, opening: Number(carried), source: "carried" };
  }
  return { row: null, opening: 0, source: "first_week" };
}

async function ensureWeek(orgId: string, branchId: string, managerId: string, walletId: string, weekStart: string) {
  const resolved = await resolveOpening(orgId, branchId, managerId, weekStart);
  if (resolved.row) return resolved.row;
  const { data, error } = await supabase.from("manager_fund_weeks").upsert({
    org_id: orgId, branch_id: branchId, manager_id: managerId, wallet_account_id: walletId, week_start: weekStart,
    opening_balance: resolved.opening, opening_source: resolved.source
  }, { onConflict: "branch_id,manager_id,week_start", ignoreDuplicates: true }).select("*").maybeSingle();
  if (error) throw error;
  if (data) return data;
  return (await resolveOpening(orgId, branchId, managerId, weekStart)).row;
}

const TXN_COLUMNS = "id, manager_id, wallet_account_id, week_start, kind, category, product_id, product_splits, waybill_own_cost, amount, occurred_at, description, paid_to, payment_method, reference, order_ids, counterparty_account_id, evidence, expense_id, transfer_id, remittance_transaction_ids, status, return_reason, void_reason, voided_at, adjusts_transaction_id, version, created_by, created_by_name, created_at, updated_at";

const toFundTxn = (row: any): FundTxn => ({
  id: row.id, kind: row.kind, category: row.category ?? null, amount: Number(row.amount ?? 0), occurredAt: row.occurred_at,
  status: row.status, reference: row.reference, orderIds: row.order_ids ?? [], description: row.description,
  evidenceCount: Array.isArray(row.evidence) ? row.evidence.length : 0
});

const mapTxn = (row: any, settings: FundSettings, countedOnOrders = 0) => ({
  /** Rider fees already on the orders: paid from the wallet, not a new cost. */
  countedOnOrders,
  id: row.id,
  productId: row.product_id ?? null,
  productSplits: Array.isArray(row.product_splits) ? row.product_splits as ProductSplit[] : null,
  /** Waybill ticked "its own cost": on top of the weekly total, not part of it. */
  ownCost: row.waybill_own_cost === true,
  managerId: row.manager_id,
  weekStart: row.week_start,
  kind: row.kind as FundKind,
  kindLabel: KIND_LABEL[row.kind as FundKind],
  category: row.category ?? null,
  categoryLabel: row.category ? FUND_CATEGORIES[row.category as keyof typeof FUND_CATEGORIES]?.label ?? row.category : null,
  amount: Number(row.amount ?? 0),
  occurredAt: row.occurred_at,
  description: row.description ?? null,
  paidTo: row.paid_to ?? null,
  paymentMethod: row.payment_method ?? null,
  reference: row.reference ?? null,
  orderIds: row.order_ids ?? [],
  counterpartyAccountId: row.counterparty_account_id ?? null,
  evidence: (Array.isArray(row.evidence) ? row.evidence : []).map((item: any) => ({ path: item.path, name: item.name, mime: item.mime, size: item.size, uploadedAt: item.uploadedAt })),
  status: row.status,
  returnReason: row.return_reason ?? null,
  voidReason: row.void_reason ?? null,
  adjustsTransactionId: row.adjusts_transaction_id ?? null,
  version: Number(row.version ?? 1),
  createdByName: row.created_by_name ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  missingProof: missingProof(toFundTxn(row), settings)
});

/** Who the request is about. A manager sees her own wallet; Owner/Admin can pick. */
async function resolveManager(req: Request, requestedId: string | undefined) {
  const scope = scopeOf(req);
  // A Manager (or the Owner using View As on one) only ever sees her own
  // wallet. Owner/Admin pick one; an Admin with no pick sees their own.
  // Viewing as an Admin (Bright, 3 Oct 2026: Onyin is an Admin and the only
  // manager) shows that Admin's own wallet too, not an empty page.
  const managerId = scope.role === "Manager"
    ? scope.id
    : requestedId || (scope.role === "Admin" ? scope.id : "");
  if (!managerId) return null;
  const { data, error } = await supabase.from("users").select("id, name, role").eq("id", managerId).eq("org_id", req.user!.orgId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "That manager was not found.");
  return { id: data.id as string, name: String(data.name ?? "Manager"), role: String(data.role) };
}

/** The money side of a week, for one manager. Used by GET, submit and lock. */
export async function loadFundWeek(orgId: string, branchId: string, managerId: string, weekStart: string) {
  const [settings, resolved, wallet, txnsResult, status] = await Promise.all([
    loadSettings(orgId, branchId),
    resolveOpening(orgId, branchId, managerId, weekStart),
    findWallet(orgId, branchId, managerId),
    supabase.from("manager_fund_transactions").select(TXN_COLUMNS)
      .eq("org_id", orgId).eq("branch_id", branchId).eq("manager_id", managerId).eq("week_start", weekStart)
      .order("occurred_at", { ascending: true }),
    companyStatus(orgId, branchId, weekStart)
  ]);
  if (txnsResult.error) throw txnsResult.error;
  const rows = txnsResult.data ?? [];
  const week = resolved.row;
  const actual = week?.actual_closing === null || week?.actual_closing === undefined ? null : Number(week.actual_closing);
  const totals = fundTotals(resolved.opening, rows.map(toFundTxn), actual, settings);
  return {
    settings, wallet, rows, week, totals, companyStatus: status,
    openingSource: resolved.source,
    locked: !!week?.locked_at,
    readiness: fundsReadiness(totals, week?.variance_explanation ?? null),
    hasActivity: rows.length > 0 || resolved.opening !== 0 || !!week
  };
}

/** Every manager wallet in the branch: holders plus anyone with the Manager
 *  role - or, when the branch has no Manager, its active Admins (Onyin is an
 *  Admin and runs the money; same rule as the monthly incentive). */
export async function branchFundManagers(orgId: string, branchId: string) {
  const [{ data: wallets, error: walletError }, { data: managers, error: managerError }, { data: members, error: memberError }] = await Promise.all([
    supabase.from("bank_accounts").select("holder_user_id").eq("org_id", orgId).eq("branch_id", branchId).not("holder_user_id", "is", null),
    supabase.from("users").select("id, name, role").eq("org_id", orgId).eq("active", true).in("role", ["Manager", "Admin"]),
    supabase.from("branch_memberships").select("user_id").eq("branch_id", branchId)
  ]);
  if (walletError) throw walletError;
  if (managerError) throw managerError;
  if (memberError) throw memberError;
  const memberIds = new Set((members ?? []).map((row: any) => row.user_id));
  const inBranch = (managers ?? []).filter((row: any) => memberIds.has(row.id));
  const branchManagers = inBranch.filter((row: any) => row.role === "Manager");
  const leaders = branchManagers.length > 0 ? branchManagers : inBranch.filter((row: any) => row.role === "Admin");
  const ids = new Set<string>([
    ...(wallets ?? []).map((row: any) => row.holder_user_id as string),
    ...leaders.map((row: any) => row.id as string)
  ]);
  if (ids.size === 0) return [];
  const { data: users, error } = await supabase.from("users").select("id, name").in("id", Array.from(ids));
  if (error) throw error;
  return (users ?? []).map((row: any) => ({ id: row.id as string, name: String(row.name ?? "Manager") })).sort((a, b) => a.name.localeCompare(b.name));
}

const weekStartSchema = z.string().regex(DATE_KEY).refine((value) => sundayWeekStartForDateKey(value) === value, { message: "The week must start on a Sunday." });

// ── Read ─────────────────────────────────────────────────────────────────────

router.get("/week", requireRole(...LEADERSHIP), async (req, res) => {
  const parsed = z.object({ weekStart: weekStartSchema.optional(), managerId: z.string().uuid().optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const managers = await branchFundManagers(orgId, branchId);
    let manager = await resolveManager(req, parsed.data.managerId);
    if (!manager && managers[0]) manager = await resolveManager(req, managers[0].id);
    if (!manager) { res.json({ weekStart, weekEnd: weekEndFromStart(weekStart), manager: null, managers, transactions: [] }); return; }
    // A Manager only ever sees her own wallet.
    if (scopeOf(req).role === "Manager" && manager.id !== scopeOf(req).id) throw httpError(403, "You can only see your own wallet.");

    const fund = await loadFundWeek(orgId, branchId, manager.id, weekStart);
    const [{ data: accounts, error: accountsError }, { data: adjustments, error: adjustmentError }] = await Promise.all([
      supabase.from("bank_accounts").select("id, name, bank_name, holder_user_id").eq("org_id", orgId).eq("branch_id", branchId).eq("active", true),
      supabase.from("manager_fund_adjustment_requests").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("manager_id", manager.id)
        .order("created_at", { ascending: false }).limit(50)
    ]);
    if (accountsError) throw accountsError;
    if (adjustmentError) throw adjustmentError;
    const editable = fundsEditable(fund.companyStatus, fund.locked);
    // Rider fees matched to orders' own delivery fees: amount minus what was booked.
    const riderRows = fund.rows.filter((row: any) => row.kind === "expense" && row.category === "logistics" && row.status !== "voided" && (row.order_ids ?? []).length > 0);
    const bookedIds = riderRows.map((row: any) => row.expense_id).filter(Boolean);
    const booked = new Map<string, number>();
    if (bookedIds.length > 0) {
      const { data: bookedRows, error: bookedError } = await supabase.from("expenses").select("id, amount").eq("org_id", orgId).in("id", bookedIds);
      if (bookedError) throw bookedError;
      for (const item of bookedRows ?? []) booked.set(String(item.id), Number(item.amount ?? 0));
    }
    const countedOnOrders = new Map<string, number>(riderRows.map((row: any) => [row.id as string, round(Math.max(0, Number(row.amount) - (row.expense_id ? booked.get(row.expense_id) ?? 0 : 0)))]));
    const days = Array.from({ length: 7 }, (_, index) => addDaysToDateKey(weekStart, index));
    const daily = days.map((date) => {
      const dayRows = fund.rows.filter((row: any) => row.status !== "voided" && lagosDay(row.occurred_at) === date);
      return {
        date,
        moneyIn: round(dayRows.filter((row: any) => ["customer_payment", "owner_funding", "company_transfer_in", "other_in"].includes(row.kind)).reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
        expenses: round(dayRows.filter((row: any) => row.kind === "expense").reduce((sum: number, row: any) => sum + Number(row.amount), 0)),
        remitted: round(dayRows.filter((row: any) => row.kind === "remittance_out").reduce((sum: number, row: any) => sum + Number(row.amount), 0))
      };
    });
    res.json({
      weekStart,
      weekEnd: weekEndFromStart(weekStart),
      manager: { id: manager.id, name: manager.name },
      managers,
      wallet: fund.wallet,
      week: {
        opening: fund.totals.opening,
        openingSource: fund.openingSource,
        actualClosing: fund.totals.actual,
        varianceExplanation: fund.week?.variance_explanation ?? null,
        notes: fund.week?.notes ?? null,
        locked: fund.locked,
        closingSnapshot: fund.week?.closing_snapshot ?? null
      },
      companyStatus: fund.companyStatus ?? "open",
      editable: editable.ok,
      editableReason: editable.ok ? null : editable.error,
      settings: fund.settings,
      totals: fund.totals,
      readiness: fund.readiness,
      transactions: fund.rows.map((row: any) => mapTxn(row, fund.settings, countedOnOrders.get(row.id) ?? 0)),
      companyAccounts: (accounts ?? []).filter((row: any) => !row.holder_user_id).map((row: any) => ({ id: row.id, name: row.name, bankName: row.bank_name })),
      adjustments: (adjustments ?? []).map((row: any) => ({
        id: row.id, transactionId: row.transaction_id, originalAmount: Number(row.original_amount), requestedAmount: Number(row.requested_amount),
        reason: row.reason, status: row.status, decidedByName: row.decided_by_name ?? null, decidedAt: row.decided_at ?? null,
        decisionNote: row.decision_note ?? null, createdAt: row.created_at
      })),
      daily,
      categories: Object.entries(FUND_CATEGORIES).map(([key, value]) => ({ key, label: value.label })),
      // For the "Waybill" category: which product's waybills a payment was for.
      products: await (async () => {
        const { data: rows } = await supabase.from("products").select("id, name, active").eq("org_id", orgId).order("name");
        return ((rows ?? []) as any[]).filter((row) => row.active !== false).map((row) => ({ id: row.id, name: row.name }));
      })()
    });
  } catch (error: any) {
    sendError(res, error, "Could not load the manager's funds.");
  }
});

// ── Write: helpers ───────────────────────────────────────────────────────────

/** The writer is always the manager herself, never someone else's wallet. */
const writer = (req: Request) => {
  if (req.user!.role !== "Manager" && req.user!.role !== "Admin") throw httpError(403, "Only the manager logs her own wallet.");
  return { id: req.user!.id, name: req.user!.name ?? "Manager", role: req.user!.role };
};

async function assertEditable(orgId: string, branchId: string, managerId: string, weekStart: string) {
  const [status, resolved] = await Promise.all([
    companyStatus(orgId, branchId, weekStart),
    resolveOpening(orgId, branchId, managerId, weekStart)
  ]);
  const verdict = fundsEditable(status, !!resolved.row?.locked_at);
  if (!verdict.ok) throw httpError(409, verdict.error);
}

async function assertCompanyAccount(orgId: string, branchId: string, accountId: string | undefined) {
  if (!accountId) throw httpError(400, "Choose the company account.");
  const { data, error } = await supabase.from("bank_accounts").select("id, holder_user_id")
    .eq("id", accountId).eq("org_id", orgId).eq("branch_id", branchId).eq("active", true).maybeSingle();
  if (error) throw error;
  if (!data || data.holder_user_id) throw httpError(400, "Choose one of the company's accounts.");
}

const ORDER_COLUMNS = "id, amount, logistics_cost, amount_remitted, remittance_status, remittance_edit_open, status, created_at, delivered_date, product_id, product_name, package_name, customer, assigned_rep_id, agent_id";

/**
 * A customer payment is a payment on the order, by the order screen's own
 * rules (customerPaymentEffect), filed under her wallet account.
 */
async function applyOrderPayment(req: Request, orderId: string, payment: number, walletId: string, receivedAt: string, reason: string) {
  const orgId = req.user!.orgId;
  const { data: order, error } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", orderId).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!order) throw httpError(404, `Order #${orderId} was not found in this branch.`);
  const effect = customerPaymentEffect({
    orderAmount: Number(order.amount ?? 0),
    logisticsCost: Number(order.logistics_cost ?? 0),
    alreadyRemitted: Number(order.amount_remitted ?? 0),
    orderStatus: String(order.status ?? ""),
    remittanceStatus: order.remittance_status ?? null,
    editOpen: !!order.remittance_edit_open,
    payment,
    role: req.user!.role
  });
  if (!effect.ok) throw httpError(409, effect.error);
  const updates: Record<string, unknown> = {
    amount_remitted: effect.nextRemitted,
    remittance_status: effect.nextStatus,
    remittance_edit_open: false,
    updated_at: new Date().toISOString()
  };
  if (effect.needsReason) {
    updates.remittance_variance_reason = reason.slice(0, 500);
    updates.remittance_variance_status = req.user!.role === "Owner" ? "approved" : "pending";
    updates.remittance_variance_reviewed_by = req.user!.role === "Owner" ? req.user!.id : null;
    updates.remittance_variance_reviewed_at = req.user!.role === "Owner" ? new Date().toISOString() : null;
  }
  // Guarded on the amount we read, so two payments at once cannot both land.
  const { data: updated, error: updateError } = await supabase.from("orders").update(updates)
    .eq("id", orderId).eq("org_id", orgId).eq("amount_remitted", order.amount_remitted ?? 0).select("id");
  if (updateError) throw updateError;
  if (!updated || updated.length === 0) throw httpError(409, `Order #${orderId} changed while saving. Reload and try again.`);
  const orderAmount = Number(order.amount ?? 0);
  const logistics = Number(order.logistics_cost ?? 0);
  const { data: remittance, error: remittanceError } = await supabase.from("remittance_transactions").insert({
    org_id: orgId,
    branch_id: req.user!.branchId,
    order_id: orderId,
    delta_amount: round(effect.nextRemitted - Number(order.amount_remitted ?? 0)),
    previous_amount_remitted: Number(order.amount_remitted ?? 0),
    running_amount_remitted: effect.nextRemitted,
    received_at: receivedAt,
    logged_by_user_id: req.user!.id,
    logged_by_name: req.user!.name ?? null,
    reason,
    bank_account_id: walletId,
    order_created_at_snapshot: order.created_at ?? null,
    order_delivered_date_snapshot: order.delivered_date ?? null,
    product_id_snapshot: order.product_id ?? null,
    product_name_snapshot: order.product_name ?? null,
    package_name_snapshot: order.package_name ?? null,
    customer_snapshot: order.customer ?? null,
    assigned_rep_id_snapshot: order.assigned_rep_id ?? null,
    agent_id_snapshot: order.agent_id ?? null,
    order_amount_snapshot: orderAmount,
    logistics_cost_snapshot: logistics,
    expected_remittance_snapshot: Math.max(0, round(orderAmount - logistics))
  }).select("id").single();
  if (remittanceError) {
    // Put the order back exactly as it was; the payment did not happen.
    await supabase.from("orders").update({ amount_remitted: order.amount_remitted, remittance_status: order.remittance_status })
      .eq("id", orderId).eq("org_id", orgId).eq("amount_remitted", effect.nextRemitted);
    throw remittanceError;
  }
  return remittance.id as string;
}

/** Undo a customer payment: same lock as the order screen. */
async function reverseOrderPayment(req: Request, orderId: string, payment: number, walletId: string, reason: string) {
  const orgId = req.user!.orgId;
  const { data: order, error } = await supabase.from("orders").select(ORDER_COLUMNS).eq("id", orderId).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  if (!order) throw httpError(404, `Order #${orderId} was not found.`);
  if (order.remittance_status === "Paid" && !order.remittance_edit_open && req.user!.role !== "Owner") {
    throw httpError(409, `Order #${orderId} is settled and locked. Ask the Owner to open it for correction, then remove this payment.`);
  }
  const previous = Number(order.amount_remitted ?? 0);
  const next = Math.max(0, round(previous - payment));
  const { data: updated, error: updateError } = await supabase.from("orders").update({
    amount_remitted: next, remittance_status: next > 0 ? "Partial" : "Pending", remittance_edit_open: false, updated_at: new Date().toISOString()
  }).eq("id", orderId).eq("org_id", orgId).eq("amount_remitted", order.amount_remitted ?? 0).select("id");
  if (updateError) throw updateError;
  if (!updated || updated.length === 0) throw httpError(409, `Order #${orderId} changed while saving. Reload and try again.`);
  const { error: remittanceError } = await supabase.from("remittance_transactions").insert({
    org_id: orgId, branch_id: req.user!.branchId, order_id: orderId,
    delta_amount: round(next - previous), previous_amount_remitted: previous, running_amount_remitted: next,
    received_at: new Date().toISOString(), logged_by_user_id: req.user!.id, logged_by_name: req.user!.name ?? null,
    reason, bank_account_id: walletId
  });
  if (remittanceError) throw remittanceError;
}

const currencyFor = async (branchId: string) => {
  const { data } = await supabase.from("branches").select("currency").eq("id", branchId).maybeSingle();
  return ["NGN", "USD", "GBP"].includes(String(data?.currency)) ? String(data!.currency) : "NGN";
};

const expenseRow = (input: { id: string; orgId: string; branchId: string; walletId: string; date: string; category: string; description: string; amount: number; paidBy: string; currency: string; productId?: string | null }) => ({
  id: input.id, org_id: input.orgId, branch_id: input.branchId, date: input.date, product_id: input.productId ?? null,
  category: FUND_CATEGORIES[input.category as keyof typeof FUND_CATEGORIES].expenseCategory,
  description: input.description, amount: input.amount, currency: input.currency, paid_by: input.paidBy,
  bank_account_id: input.walletId
});

const expenseDescription = (category: string, description: string | null | undefined, paidTo: string | null | undefined) =>
  `[Manager wallet] ${FUND_CATEGORIES[category as keyof typeof FUND_CATEGORIES].label}${description ? `: ${description}` : ""}${paidTo ? ` - paid to ${paidTo}` : ""}`.slice(0, 500);


// ── No double counting (Bright, 3 Oct 2026) ─────────────────────────────────
// An order's delivery fee is already a "Delivery" expense (EXP-DEL-<order>,
// booked from the order screen). A rider fee the manager pays from the wallet
// for those orders is the SAME money: only the part above the orders' fees is
// a new cost. The covered part still leaves her wallet, so the orders' own fee
// entries are marked as paid from the wallet (Cash Flow account balances).

const cleanOrderIds = (ids: Array<string | null | undefined> | null | undefined) =>
  Array.from(new Set((ids ?? []).map((id) => String(id ?? "").replace(/^#/, "").trim()).filter(Boolean)));

/** Each order's money position: what the forms show and the split uses. */
async function ordersPosition(orgId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("orders")
    .select("id, customer, status, amount, logistics_cost, amount_remitted, remittance_status").eq("org_id", orgId).in("id", ids);
  if (error) throw error;
  const found = new Map((data ?? []).map((row: any) => [String(row.id), row]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) throw httpError(404, `Order ${missing.map((id) => `#${id}`).join(", ")} was not found.`);
  return ids.map((id) => {
    const row: any = found.get(id);
    const failed = row.status === "Failed" || row.status === "Cancelled";
    const amount = Number(row.amount ?? 0);
    const deliveryFee = Number(row.logistics_cost ?? 0);
    const received = Number(row.amount_remitted ?? 0);
    const expected = failed ? 0 : Math.max(0, round(amount - deliveryFee));
    return {
      id, customer: String(row.customer ?? ""), status: String(row.status ?? ""), amount, deliveryFee, received, expected,
      left: round(Math.max(0, expected - received)), remittanceStatus: row.remittance_status ?? null
    };
  });
}

/** How much of these orders' fees other live wallet rider-fee entries already matched. */
async function claimedByOtherEntries(orgId: string, ids: string[], excludeTxnId: string | null) {
  if (ids.length === 0) return 0;
  const { data, error } = await supabase.from("manager_fund_transactions").select("id, amount, expense_id")
    .eq("org_id", orgId).eq("kind", "expense").eq("category", "logistics").in("status", ["recorded", "returned"]).overlaps("order_ids", ids);
  if (error) throw error;
  const others = (data ?? []).filter((row: any) => row.id !== excludeTxnId);
  if (others.length === 0) return 0;
  const expenseIds = others.map((row: any) => row.expense_id).filter(Boolean);
  const booked = new Map<string, number>();
  if (expenseIds.length > 0) {
    const { data: rows, error: expenseError } = await supabase.from("expenses").select("id, amount").eq("org_id", orgId).in("id", expenseIds);
    if (expenseError) throw expenseError;
    for (const row of rows ?? []) booked.set(String(row.id), Number(row.amount ?? 0));
  }
  return round(others.reduce((sum: number, row: any) => sum + Math.max(0, Number(row.amount) - (row.expense_id ? booked.get(row.expense_id) ?? 0 : 0)), 0));
}

async function expenseSplit(orgId: string, category: string, amount: number, orderIds: string[], txnId: string | null) {
  if (category !== "logistics" || orderIds.length === 0) return { counted: 0, newCost: round(amount), orders: [] as Awaited<ReturnType<typeof ordersPosition>> };
  const orders = await ordersPosition(orgId, orderIds);
  const fees = orders.reduce((sum, order) => sum + order.deliveryFee, 0);
  const claimed = await claimedByOtherEntries(orgId, orderIds, txnId);
  return { ...logisticsSplit(amount, fees, claimed), orders };
}

const feeExpenseIds = (orderIds: string[]) => orderIds.map((id) => `EXP-DEL-${id}`);

/** Puts back the orders' fee entries this entry had marked as paid from the wallet. */
async function releaseOrderFees(orgId: string, walletId: string, orderIds: string[]) {
  if (orderIds.length === 0) return;
  const { error } = await supabase.from("expenses").update({ bank_account_id: null })
    .eq("org_id", orgId).eq("bank_account_id", walletId).in("id", feeExpenseIds(orderIds));
  if (error) throw error;
}

/** Removes a shared waybill's extra product expenses beyond the first `keep`. */
async function removeExtraShares(orgId: string, expenseId: string, keep: number) {
  const { data, error } = await supabase.from("expenses").select("id").eq("org_id", orgId).like("id", `${expenseId}-%`);
  if (error) throw error;
  const extra = ((data ?? []) as any[]).map((row) => String(row.id))
    .filter((id) => { const index = Number(id.slice(expenseId.length + 1)); return Number.isInteger(index) && index > keep; });
  if (extra.length === 0) return;
  const removed = await supabase.from("expenses").delete().eq("org_id", orgId).in("id", extra);
  if (removed.error) throw removed.error;
}

/** The products a waybill payment is for: one (productId) or shared (2+ splits). */
function waybillProducts(input: { productId?: string; productSplits?: ProductSplit[] }, amount: number) {
  const splits = input.productSplits ?? [];
  if (splits.length > 1) {
    const problem = splitProblem(splits, amount);
    if (problem) throw httpError(400, problem);
    return { productId: splits[0].productId, productSplits: splits };
  }
  return { productId: splits[0]?.productId ?? input.productId ?? null, productSplits: null };
}

/**
 * Books (or updates / removes) the expense behind a wallet expense entry: only
 * its NEW cost. Returns the expense id to keep on the entry (null = none).
 */
async function syncWalletExpense(input: {
  orgId: string; branchId: string; txnId: string; walletId: string; existingExpenseId: string | null;
  category: string; amount: number; occurredAt: string; description: string | null; paidTo: string | null; paidBy: string;
  orderIds: string[]; previousOrderIds: string[];
  /** Waybill only: which product's waybills this payment was for. */
  productId?: string | null; previousCategory?: string | null;
  /** Waybill shared by 2+ products: one expense per product (MGRF-<id>, MGRF-<id>-2, ...). */
  productSplits?: ProductSplit[] | null;
  /** Waybill ticked "its own cost": said in the expense's description. */
  ownCost?: boolean;
}) {
  const split = await expenseSplit(input.orgId, input.category, input.amount, input.orderIds, input.txnId);
  const coveredIds = split.counted > 0 ? input.orderIds : [];
  const covered = split.counted > 0
    ? ` · ${split.counted.toLocaleString("en-NG")} of it is the delivery fee already on order${coveredIds.length === 1 ? "" : "s"} ${coveredIds.map((id) => `#${id}`).join(", ")} (not counted again)`
    : "";
  const ownCostNote = input.category === "waybill" && input.ownCost ? " · own cost, on top of the week's waybill total" : "";
  const description = `${expenseDescription(input.category, input.description, input.paidTo)}${covered}${ownCostNote}`.slice(0, 500);
  const expenseId = input.existingExpenseId ?? `MGRF-${input.txnId}`;
  const shares = input.category === "waybill" && (input.productSplits?.length ?? 0) > 1 && split.newCost > 0 ? input.productSplits! : null;
  if (shares) {
    // One expense per product; the first keeps the id the entry points to.
    const currency = await currencyFor(input.branchId);
    const rows = shares.map((share, index) => expenseRow({
      id: index === 0 ? expenseId : `${expenseId}-${index + 1}`, orgId: input.orgId, branchId: input.branchId, walletId: input.walletId,
      date: lagosDay(input.occurredAt), category: input.category, description: `${description} · share ${index + 1} of ${shares.length}`.slice(0, 500),
      amount: share.amount, paidBy: input.paidBy, currency, productId: share.productId
    }));
    const { error } = await supabase.from("expenses").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  } else if (split.newCost > 0) {
    if (input.existingExpenseId) {
      const { error } = await supabase.from("expenses").update({
        amount: split.newCost, date: lagosDay(input.occurredAt), description, product_id: input.productId ?? null,
        category: FUND_CATEGORIES[input.category as keyof typeof FUND_CATEGORIES].expenseCategory
      }).eq("id", input.existingExpenseId).eq("org_id", input.orgId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("expenses").insert(expenseRow({
        id: expenseId, orgId: input.orgId, branchId: input.branchId, walletId: input.walletId, date: lagosDay(input.occurredAt),
        category: input.category, description, amount: split.newCost, paidBy: input.paidBy, currency: await currencyFor(input.branchId), productId: input.productId ?? null
      }));
      if (error) throw error;
    }
  } else if (input.existingExpenseId) {
    const { error } = await supabase.from("expenses").delete().eq("id", input.existingExpenseId).eq("org_id", input.orgId);
    if (error) throw error;
  }
  await removeExtraShares(input.orgId, expenseId, shares?.length ?? 1);
  await releaseOrderFees(input.orgId, input.walletId, input.previousOrderIds.filter((id) => !coveredIds.includes(id)));
  if (coveredIds.length > 0) {
    const { error } = await supabase.from("expenses").update({ bank_account_id: input.walletId })
      .eq("org_id", input.orgId).is("bank_account_id", null).in("id", feeExpenseIds(coveredIds));
    if (error) throw error;
  }
  // A waybill payment counts toward the product's typed weekly total, not on top of it.
  if (input.category === "waybill" || input.previousCategory === "waybill") await recomputeWaybillWeek(input.orgId, input.branchId, lagosDay(input.occurredAt));
  return { expenseId: split.newCost > 0 ? expenseId : null, counted: split.counted, newCost: split.newCost };
}

// ── Write: log ───────────────────────────────────────────────────────────────

const LogSchema = z.object({
  kind: z.enum(["customer_payment", "owner_funding", "company_transfer_in", "other_in", "expense", "remittance_out"]),
  category: z.enum(Object.keys(FUND_CATEGORIES) as [string, ...string[]]).optional(),
  amount: z.number().positive().max(100_000_000),
  occurredAt: z.string().datetime({ offset: true }),
  description: z.string().trim().max(500).optional(),
  paidTo: z.string().trim().max(200).optional(),
  paymentMethod: z.enum(["cash", "transfer", "pos", "other"]).optional(),
  reference: z.string().trim().max(120).optional(),
  orderId: z.string().trim().max(60).optional(),
  // Expenses only: the orders this cost was for (e.g. one rider fee, three deliveries).
  relatedOrderIds: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  counterpartyAccountId: z.string().uuid().optional(),
  // Admin/Owner only: why a customer payment does not settle the order exactly.
  varianceReason: z.string().trim().max(400).optional(),
  // Waybill expenses: which product's waybills (Bright, 9 Oct 2026).
  productId: z.string().trim().min(1).max(60).optional(),
  // A waybill shared by several products, each with its share (Bright, 9 Oct 2026).
  productSplits: z.array(z.object({ productId: z.string().trim().min(1).max(60), amount: z.number().positive() })).max(6).optional(),
  // Waybill ticked "its own cost": added on top of the weekly total (Bright, 9 Oct 2026).
  ownCost: z.boolean().optional()
});

router.post("/transactions", requireRole("Manager", "Admin"), async (req, res) => {
  const parsed = LogSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const body = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const me = writer(req);
    if (new Date(body.occurredAt).getTime() > Date.now() + 5 * 60 * 1000) throw httpError(400, "That date is in the future.");
    const weekStart = sundayWeekStartForDateKey(lagosDay(body.occurredAt));
    await assertEditable(orgId, branchId, me.id, weekStart);
    if (body.kind === "expense" && !body.category) throw httpError(400, "Choose a category.");
    const waybill = body.kind === "expense" && body.category === "waybill" ? waybillProducts(body, body.amount) : { productId: null, productSplits: null };
    if (body.kind === "expense" && body.category === "waybill" && !waybill.productId) throw httpError(400, "Choose which product's waybills this was for.");
    if (body.kind === "customer_payment" && !body.orderId) throw httpError(400, "Enter the order number this payment is for.");
    if (["owner_funding", "company_transfer_in", "remittance_out"].includes(body.kind)) await assertCompanyAccount(orgId, branchId, body.counterpartyAccountId);

    const wallet = await ensureWallet(orgId, branchId, me);
    await ensureWeek(orgId, branchId, me.id, wallet.id, weekStart);
    const orderId = body.orderId?.replace(/^#/, "");

    const { data: row, error } = await supabase.from("manager_fund_transactions").insert({
      org_id: orgId, branch_id: branchId, manager_id: me.id, wallet_account_id: wallet.id, week_start: weekStart,
      kind: body.kind, category: body.kind === "expense" ? body.category : null, amount: body.amount, occurred_at: body.occurredAt,
      description: body.description || null, paid_to: body.paidTo || null, payment_method: body.paymentMethod ?? null,
      reference: body.reference || null,
      order_ids: orderId ? [orderId] : body.kind === "expense" ? (body.relatedOrderIds ?? []).map((id) => id.replace(/^#/, "")) : [],
      counterparty_account_id: body.counterpartyAccountId ?? null,
      product_id: waybill.productId, product_splits: waybill.productSplits,
      waybill_own_cost: body.kind === "expense" && body.category === "waybill" ? body.ownCost === true : false,
      created_by: me.id, created_by_name: me.name
    }).select(TXN_COLUMNS).single();
    if (error) throw error;

    // Mirror into the books. If that fails, remove the ledger row.
    try {
      const mirror: Record<string, unknown> = {};
      if (body.kind === "expense") {
        // Only the NEW cost is booked: a rider fee for orders whose delivery
        // fee is already recorded is that same money (see syncWalletExpense).
        const synced = await syncWalletExpense({
          orgId, branchId, txnId: row.id, walletId: wallet.id, existingExpenseId: null, category: body.category!,
          amount: body.amount, occurredAt: body.occurredAt, description: body.description ?? null, paidTo: body.paidTo ?? null,
          paidBy: me.name, orderIds: cleanOrderIds(row.order_ids), previousOrderIds: [],
          productId: waybill.productId, productSplits: waybill.productSplits, ownCost: body.ownCost === true
        });
        if (synced.expenseId) mirror.expense_id = synced.expenseId;
      } else if (body.kind === "owner_funding" || body.kind === "company_transfer_in" || body.kind === "remittance_out") {
        const into = body.kind !== "remittance_out";
        const { data: transfer, error: transferError } = await supabase.from("bank_account_transfers").insert({
          org_id: orgId, branch_id: branchId,
          from_account_id: into ? body.counterpartyAccountId : wallet.id,
          to_account_id: into ? wallet.id : body.counterpartyAccountId,
          amount: body.amount, transferred_at: body.occurredAt, cleared_at: body.occurredAt,
          note: `${KIND_LABEL[body.kind]}${body.reference ? ` (${body.reference})` : ""}${body.description ? ` - ${body.description}` : ""}`.slice(0, 500),
          created_by: me.id
        }).select("id").single();
        if (transferError) throw transferError;
        mirror.transfer_id = transfer.id;
      } else if (body.kind === "customer_payment") {
        const remittanceId = await applyOrderPayment(req, orderId!, body.amount, wallet.id, body.occurredAt,
          `Paid to ${me.name} (manager wallet)${body.reference ? ` · ref ${body.reference}` : ""}${body.varianceReason ? ` · ${body.varianceReason}` : ""}`);
        mirror.remittance_transaction_ids = [remittanceId];
      }
      if (Object.keys(mirror).length > 0) {
        const { error: linkError } = await supabase.from("manager_fund_transactions").update(mirror).eq("id", row.id);
        if (linkError) throw linkError;
      }
    } catch (mirrorError) {
      await supabase.from("manager_fund_transactions").delete().eq("id", row.id);
      throw mirrorError;
    }

    await audit(req, branchId, weekStart, "fund_logged", {
      managerId: me.id, transactionId: row.id, kind: body.kind, category: body.category ?? null, amount: body.amount, orderId: orderId ?? null
    });
    res.status(201).json({ id: row.id });
  } catch (error: any) {
    sendError(res, error, "Could not log this transaction.");
  }
});

// ── Write: edit / void ───────────────────────────────────────────────────────

async function loadOwnTxn(req: Request, id: string) {
  const branchId = requireBranch(req);
  const { data, error } = await supabase.from("manager_fund_transactions").select(TXN_COLUMNS)
    .eq("id", id).eq("org_id", req.user!.orgId).eq("branch_id", branchId).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "That transaction was not found.");
  if (data.manager_id !== req.user!.id) throw httpError(403, "Only the manager who logged it can change it.");
  return { branchId, row: data };
}

const EditSchema = z.object({
  amount: z.number().positive().max(100_000_000).optional(),
  category: z.enum(Object.keys(FUND_CATEGORIES) as [string, ...string[]]).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  description: z.string().trim().max(500).optional(),
  paidTo: z.string().trim().max(200).optional(),
  paymentMethod: z.enum(["cash", "transfer", "pos", "other"]).optional(),
  reference: z.string().trim().max(120).optional(),
  counterpartyAccountId: z.string().uuid().optional(),
  relatedOrderIds: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  productId: z.string().trim().min(1).max(60).optional(),
  // A waybill shared by several products, each with its share (Bright, 9 Oct 2026).
  productSplits: z.array(z.object({ productId: z.string().trim().min(1).max(60), amount: z.number().positive() })).max(6).optional(),
  // Waybill ticked "its own cost": added on top of the weekly total (Bright, 9 Oct 2026).
  ownCost: z.boolean().optional()
});

router.patch("/transactions/:id", requireRole("Manager", "Admin"), async (req, res) => {
  const parsed = EditSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const body = parsed.data;
  try {
    const orgId = req.user!.orgId;
    const { branchId, row } = await loadOwnTxn(req, String(req.params.id));
    if (row.status === "voided") throw httpError(409, "This transaction was removed.");
    if (row.kind === "customer_payment") throw httpError(409, "A customer payment changes an order. Remove it and log it again instead.");
    await assertEditable(orgId, branchId, row.manager_id, row.week_start);
    if (body.occurredAt && sundayWeekStartForDateKey(lagosDay(body.occurredAt)) !== row.week_start) {
      throw httpError(400, "Keep the date inside the same week. To move it, remove it and log it in the other week.");
    }
    if (body.counterpartyAccountId) await assertCompanyAccount(orgId, branchId, body.counterpartyAccountId);
    const next = {
      amount: body.amount ?? Number(row.amount),
      category: row.kind === "expense" ? (body.category ?? row.category) : null,
      occurred_at: body.occurredAt ?? row.occurred_at,
      description: body.description ?? row.description,
      paid_to: body.paidTo ?? row.paid_to,
      payment_method: body.paymentMethod ?? row.payment_method,
      reference: body.reference ?? row.reference,
      counterparty_account_id: body.counterpartyAccountId ?? row.counterparty_account_id,
      order_ids: row.kind === "expense" && body.relatedOrderIds ? cleanOrderIds(body.relatedOrderIds) : (row.order_ids ?? []),
      expense_id: row.expense_id ?? null,
      product_id: null as string | null,
      product_splits: null as ProductSplit[] | null,
      waybill_own_cost: false
    };
    if (row.kind === "expense" && next.category === "waybill") {
      // New products sent: use them. Same products, new amount: keep each one's proportion.
      const stored = Array.isArray(row.product_splits) ? row.product_splits as ProductSplit[] : null;
      const chosen = body.productSplits?.length || body.productId
        ? waybillProducts(body, next.amount)
        : stored && stored.length > 1 ? { productId: stored[0].productId, productSplits: scaleSplits(stored, next.amount) } : { productId: row.product_id ?? null, productSplits: null };
      next.product_id = chosen.productId;
      next.product_splits = chosen.productSplits;
      next.waybill_own_cost = body.ownCost ?? row.waybill_own_cost === true;
    }
    if (row.kind === "expense" && next.category === "waybill" && !next.product_id) throw httpError(400, "Choose which product's waybills this was for.");

    if (row.kind === "expense") {
      const synced = await syncWalletExpense({
        orgId, branchId, txnId: row.id, walletId: row.wallet_account_id, existingExpenseId: row.expense_id ?? null, category: next.category!,
        amount: next.amount, occurredAt: next.occurred_at, description: next.description, paidTo: next.paid_to,
        paidBy: row.created_by_name ?? req.user!.name ?? "Manager", orderIds: cleanOrderIds(next.order_ids), previousOrderIds: cleanOrderIds(row.order_ids),
        productId: next.product_id, productSplits: next.product_splits, previousCategory: row.category, ownCost: next.waybill_own_cost
      });
      next.expense_id = synced.expenseId;
    }
    if (row.transfer_id) {
      const into = row.kind !== "remittance_out";
      const { error } = await supabase.from("bank_account_transfers").update({
        amount: next.amount, transferred_at: next.occurred_at, cleared_at: next.occurred_at,
        from_account_id: into ? next.counterparty_account_id : row.wallet_account_id,
        to_account_id: into ? row.wallet_account_id : next.counterparty_account_id
      }).eq("id", row.transfer_id).eq("org_id", orgId);
      if (error) throw error;
    }
    const { data: updated, error } = await supabase.from("manager_fund_transactions").update({
      ...next,
      // Fixing a returned entry puts it back in line for the owner.
      status: "recorded",
      version: Number(row.version ?? 1) + 1,
      updated_at: new Date().toISOString()
    }).eq("id", row.id).eq("version", row.version).select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This transaction changed while you were saving. Reload and try again.");
    // The "its own cost" tick is read from the saved entry, so count the week again now it is saved.
    if (next.category === "waybill" && next.waybill_own_cost !== (row.waybill_own_cost === true)) await recomputeWaybillWeek(orgId, branchId, lagosDay(next.occurred_at));
    await audit(req, branchId, row.week_start, "fund_edited", {
      managerId: row.manager_id, transactionId: row.id, kind: row.kind,
      before: { amount: Number(row.amount), category: row.category, description: row.description, occurredAt: row.occurred_at },
      after: { amount: next.amount, category: next.category, description: next.description, occurredAt: next.occurred_at },
      wasReturned: row.status === "returned"
    });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not save this change.");
  }
});

router.post("/transactions/:id/void", requireRole("Manager", "Admin"), async (req, res) => {
  const parsed = z.object({ reason: z.string().trim().min(3, "Say why it is being removed.").max(400) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const { branchId, row } = await loadOwnTxn(req, String(req.params.id));
    if (row.status === "voided") throw httpError(409, "Already removed.");
    await assertEditable(orgId, branchId, row.manager_id, row.week_start);
    if (row.kind === "customer_payment" && row.order_ids?.[0]) {
      await reverseOrderPayment(req, row.order_ids[0], Number(row.amount), row.wallet_account_id, `Removed by ${req.user!.name}: ${parsed.data.reason}`);
    }
    if (row.expense_id) {
      const { error } = await supabase.from("expenses").delete().eq("id", row.expense_id).eq("org_id", orgId);
      if (error) throw error;
      await removeExtraShares(orgId, row.expense_id, 1);
    }
    if (row.kind === "expense") await releaseOrderFees(orgId, row.wallet_account_id, cleanOrderIds(row.order_ids));
    // The product's typed waybill total takes back the part this payment covered.
    if (row.category === "waybill") await recomputeWaybillWeek(orgId, branchId, lagosDay(row.occurred_at));
    if (row.transfer_id) {
      const { error } = await supabase.from("bank_account_transfers").delete().eq("id", row.transfer_id).eq("org_id", orgId);
      if (error) throw error;
    }
    // Kept, marked removed - never deleted, so the audit trail still has it.
    const { error } = await supabase.from("manager_fund_transactions").update({
      status: "voided", void_reason: parsed.data.reason, voided_by: req.user!.id, voided_at: new Date().toISOString(),
      expense_id: null, transfer_id: null, updated_at: new Date().toISOString()
    }).eq("id", row.id);
    if (error) throw error;
    await audit(req, branchId, row.week_start, "fund_voided", { managerId: row.manager_id, transactionId: row.id, kind: row.kind, amount: Number(row.amount), reason: parsed.data.reason });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not remove this transaction.");
  }
});

// ── Evidence ─────────────────────────────────────────────────────────────────

router.post("/transactions/:id/evidence", requireRole("Manager", "Admin"), async (req, res) => {
  const parsed = z.object({ dataUrl: z.string().min(20), name: z.string().trim().max(160).default("proof") }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const { branchId, row } = await loadOwnTxn(req, String(req.params.id));
    if (row.status === "voided") throw httpError(409, "This transaction was removed.");
    await assertEditable(orgId, branchId, row.manager_id, row.week_start);
    const match = parsed.data.dataUrl.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    const mime = match?.[1].toLowerCase() ?? "";
    const ext = EVIDENCE_MIME[mime];
    if (!match || !ext) throw httpError(400, "Upload a photo (PNG, JPG, WEBP) or a PDF.");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 10 * 1024 * 1024) throw httpError(413, "That file is over 10MB.");
    const evidence = Array.isArray(row.evidence) ? row.evidence : [];
    if (evidence.length >= 10) throw httpError(400, "Up to 10 files per transaction.");
    const path = `${orgId}/${branchId}/${row.id}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(path, buffer, { contentType: mime, upsert: false });
    if (uploadError) throw uploadError;
    const item = { path, name: parsed.data.name, mime, size: buffer.length, uploadedAt: new Date().toISOString(), uploadedBy: req.user!.id };
    const { error } = await supabase.from("manager_fund_transactions").update({
      evidence: [...evidence, item], status: row.status === "returned" ? "recorded" : row.status, updated_at: new Date().toISOString()
    }).eq("id", row.id);
    if (error) throw error;
    await audit(req, branchId, row.week_start, "fund_evidence_added", { managerId: row.manager_id, transactionId: row.id, name: parsed.data.name });
    res.status(201).json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not upload the proof.");
  }
});

/** The forms' order check: each order's money position and, for a rider fee, the split. */
router.get("/order-check", requireRole(...LEADERSHIP), async (req, res) => {
  const parsed = z.object({
    ids: z.string().trim().min(1).max(1500),
    amount: z.coerce.number().min(0).max(100_000_000).optional(),
    category: z.string().trim().max(40).optional(),
    excludeTxnId: z.string().uuid().optional()
  }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const ids = cleanOrderIds(parsed.data.ids.split(/[\s,]+/)).slice(0, 20);
    const orders = await ordersPosition(orgId, ids);
    const split = parsed.data.category === "logistics" && parsed.data.amount !== undefined
      ? await expenseSplit(orgId, "logistics", parsed.data.amount, ids, parsed.data.excludeTxnId ?? null)
      : null;
    res.json({ orders, split: split ? { counted: split.counted, newCost: split.newCost } : null });
  } catch (error: any) {
    sendError(res, error, "Couldn't check those orders.");
  }
});

router.get("/evidence-url", requireRole(...LEADERSHIP), async (req, res) => {
  const parsed = z.object({ transactionId: z.string().uuid(), path: z.string().min(5).max(400) }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const { data: row, error } = await supabase.from("manager_fund_transactions").select("manager_id, evidence")
      .eq("id", parsed.data.transactionId).eq("org_id", req.user!.orgId).eq("branch_id", branchId).maybeSingle();
    if (error) throw error;
    if (!row) throw httpError(404, "Not found.");
    if (req.user!.role === "Manager" && row.manager_id !== req.user!.id) throw httpError(403, "Not yours.");
    // Only a path stored on this very transaction can be opened.
    if (!(row.evidence ?? []).some((item: any) => item.path === parsed.data.path)) throw httpError(404, "Not found.");
    const { data, error: signError } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(parsed.data.path, 300);
    if (signError) throw signError;
    res.json({ url: data.signedUrl });
  } catch (error: any) {
    sendError(res, error, "Could not open the proof.");
  }
});

// ── The week: counted balance, explanation, notes ───────────────────────────

router.put("/week", requireRole("Manager", "Admin"), async (req, res) => {
  const parsed = z.object({
    weekStart: weekStartSchema,
    actualClosing: z.number().min(0).max(1_000_000_000).nullable().optional(),
    varianceExplanation: z.string().trim().max(1000).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional()
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const me = writer(req);
    const { weekStart } = parsed.data;
    await assertEditable(orgId, branchId, me.id, weekStart);
    const wallet = await ensureWallet(orgId, branchId, me);
    const week = await ensureWeek(orgId, branchId, me.id, wallet.id, weekStart);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.actualClosing !== undefined) patch.actual_closing = parsed.data.actualClosing;
    if (parsed.data.varianceExplanation !== undefined) patch.variance_explanation = parsed.data.varianceExplanation;
    if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;
    const { error } = await supabase.from("manager_fund_weeks").update(patch).eq("id", week.id);
    if (error) throw error;
    if (parsed.data.actualClosing !== undefined && Number(parsed.data.actualClosing) !== Number(week.actual_closing)) {
      await audit(req, branchId, weekStart, "fund_balance_counted", { managerId: me.id, actualClosing: parsed.data.actualClosing, previous: week.actual_closing ?? null });
    }
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not save.");
  }
});

// ── After a lock: adjustment requests ───────────────────────────────────────

router.post("/adjustments", requireRole("Manager", "Admin"), async (req, res) => {
  const parsed = z.object({
    transactionId: z.string().uuid(),
    requestedAmount: z.number().min(0).max(100_000_000),
    reason: z.string().trim().min(5, "Say why it needs changing.").max(1000)
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const { branchId, row } = await loadOwnTxn(req, parsed.data.transactionId);
    if (row.kind === "customer_payment") throw httpError(409, "A customer payment is corrected on the order itself. Ask the Owner.");
    const resolved = await resolveOpening(orgId, branchId, row.manager_id, row.week_start);
    if (!resolved.row?.locked_at) throw httpError(409, "This week is not locked. Edit the transaction directly.");
    if (Number(row.amount) === parsed.data.requestedAmount) throw httpError(400, "That is the amount already recorded.");
    const { data: pending } = await supabase.from("manager_fund_adjustment_requests").select("id")
      .eq("transaction_id", row.id).eq("status", "pending").maybeSingle();
    if (pending) throw httpError(409, "There is already a request waiting for the owner on this transaction.");
    const { data, error } = await supabase.from("manager_fund_adjustment_requests").insert({
      org_id: orgId, branch_id: branchId, manager_id: row.manager_id, transaction_id: row.id,
      original_amount: Number(row.amount), requested_amount: parsed.data.requestedAmount, reason: parsed.data.reason,
      created_by: req.user!.id
    }).select("id").single();
    if (error) throw error;
    await audit(req, branchId, row.week_start, "fund_adjustment_requested", {
      managerId: row.manager_id, transactionId: row.id, requestId: data.id,
      originalAmount: Number(row.amount), requestedAmount: parsed.data.requestedAmount, reason: parsed.data.reason
    });
    void notifyFunds(orgId, branchId, { kind: "adjustment_requested", managerName: req.user!.name ?? "The manager", amountFrom: Number(row.amount), amountTo: parsed.data.requestedAmount, weekStart: row.week_start });
    res.status(201).json({ id: data.id });
  } catch (error: any) {
    sendError(res, error, "Could not send the request.");
  }
});

router.post("/adjustments/:id/decide", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ approve: z.boolean(), note: z.string().trim().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const { data: request, error } = await supabase.from("manager_fund_adjustment_requests").select("*")
      .eq("id", String(req.params.id)).eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
    if (error) throw error;
    if (!request) throw httpError(404, "Not found.");
    if (request.status !== "pending") throw httpError(409, "Already decided.");
    const { data: txn, error: txnError } = await supabase.from("manager_fund_transactions").select(TXN_COLUMNS).eq("id", request.transaction_id).maybeSingle();
    if (txnError) throw txnError;
    if (!txn) throw httpError(404, "The transaction is gone.");

    if (parsed.data.approve) {
      // The approved amount replaces the old one on the entry and in the
      // books. The locked week's frozen figures are NOT rewritten; both
      // values stay on the request and in the audit trail.
      const amount = Number(request.requested_amount);
      if (amount > 0) {
        if (txn.kind === "expense") {
          const synced = await syncWalletExpense({
            orgId, branchId, txnId: txn.id, walletId: txn.wallet_account_id, existingExpenseId: txn.expense_id ?? null, category: txn.category ?? "other",
            amount, occurredAt: txn.occurred_at, description: txn.description, paidTo: txn.paid_to, paidBy: txn.created_by_name ?? "Manager",
            orderIds: cleanOrderIds(txn.order_ids), previousOrderIds: cleanOrderIds(txn.order_ids),
            productId: txn.product_id ?? null, previousCategory: txn.category,
            productSplits: Array.isArray(txn.product_splits) && txn.product_splits.length > 1 ? scaleSplits(txn.product_splits as ProductSplit[], amount) : null,
            ownCost: txn.waybill_own_cost === true
          });
          if ((synced.expenseId ?? null) !== (txn.expense_id ?? null)) {
            const { error: e } = await supabase.from("manager_fund_transactions").update({ expense_id: synced.expenseId }).eq("id", txn.id);
            if (e) throw e;
          }
        }
        if (txn.transfer_id) {
          const { error: e } = await supabase.from("bank_account_transfers").update({ amount }).eq("id", txn.transfer_id).eq("org_id", orgId);
          if (e) throw e;
        }
        const { error: e } = await supabase.from("manager_fund_transactions").update({ amount, version: Number(txn.version ?? 1) + 1, updated_at: new Date().toISOString() }).eq("id", txn.id);
        if (e) throw e;
      } else {
        if (txn.expense_id) {
          await supabase.from("expenses").delete().eq("id", txn.expense_id).eq("org_id", orgId);
          await removeExtraShares(orgId, txn.expense_id, 1);
        }
        if (txn.kind === "expense") await releaseOrderFees(orgId, txn.wallet_account_id, cleanOrderIds(txn.order_ids));
        if (txn.category === "waybill") await recomputeWaybillWeek(orgId, branchId, lagosDay(txn.occurred_at));
        if (txn.transfer_id) await supabase.from("bank_account_transfers").delete().eq("id", txn.transfer_id).eq("org_id", orgId);
        const { error: e } = await supabase.from("manager_fund_transactions").update({
          status: "voided", void_reason: `Owner-approved adjustment to ₦0: ${request.reason}`, voided_by: req.user!.id, voided_at: new Date().toISOString(),
          expense_id: null, transfer_id: null, updated_at: new Date().toISOString()
        }).eq("id", txn.id);
        if (e) throw e;
      }
    }
    const { error: decideError } = await supabase.from("manager_fund_adjustment_requests").update({
      status: parsed.data.approve ? "approved" : "rejected", decided_by: req.user!.id, decided_by_name: req.user!.name ?? null,
      decided_at: new Date().toISOString(), decision_note: parsed.data.note ?? null,
      applied_transaction_id: parsed.data.approve ? txn.id : null
    }).eq("id", request.id).eq("status", "pending");
    if (decideError) throw decideError;
    await audit(req, branchId, txn.week_start, parsed.data.approve ? "fund_adjustment_approved" : "fund_adjustment_rejected", {
      managerId: request.manager_id, transactionId: txn.id, requestId: request.id,
      originalAmount: Number(request.original_amount), requestedAmount: Number(request.requested_amount), note: parsed.data.note ?? null
    });
    void notifyFunds(orgId, branchId, { kind: "adjustment_decided", managerId: request.manager_id, approved: parsed.data.approve, amountTo: Number(request.requested_amount), weekStart: txn.week_start });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not record the decision.");
  }
});

// ── Settings (Owner) ────────────────────────────────────────────────────────

router.put("/settings", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({
    expenseProofMin: z.number().min(0).max(10_000_000),
    remittanceProofRequired: z.boolean(),
    ownerFundingReferenceRequired: z.boolean(),
    otherInProofRequired: z.boolean()
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const { error } = await supabase.from("manager_fund_settings").upsert({
      org_id: req.user!.orgId, branch_id: branchId,
      expense_proof_min: parsed.data.expenseProofMin,
      remittance_proof_required: parsed.data.remittanceProofRequired,
      owner_funding_reference_required: parsed.data.ownerFundingReferenceRequired,
      other_in_proof_required: parsed.data.otherInProofRequired,
      updated_by: req.user!.id, updated_at: new Date().toISOString()
    }, { onConflict: "branch_id" });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not save the proof rules.");
  }
});

export default router;
