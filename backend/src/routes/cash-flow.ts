import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";
import {
  computeAccountBalances,
  summariseAccounts,
  unassignedTotal
} from "../lib/bank-accounts.js";
import {
  buildBreakdown,
  buildDailyTrend,
  CASH_OUT_GROUPS,
  cashOutGroupFor,
  changeVsPrevious,
  dayRange,
  withRunningBalance
} from "../lib/cash-flow.js";
import {
  nextReserveRef,
  reserveBreakdown,
  reserveDisplayStatus,
  reserveInsights,
  summariseReserves,
  upcomingReleases,
  type ReserveInput
} from "../lib/cash-reserves.js";
import {
  investigationProgress,
  reconciliationStatus,
  summariseVerification,
  VARIANCE_REASONS
} from "../lib/weekly-reconciliation.js";

const router = Router();
// ⚠️ OWNER ONLY, deliberately narrower than the rest of Finance & Accounting.
// This page shows the true bank position, what is still owed by agents, and
// every account balance - the most sensitive money view in the app - and
// Bright asked for it kept to himself for now. Enforced here rather than only
// by hiding the tab, so the endpoints refuse a direct call regardless of what
// the UI shows. Widen this and the tab's own role check together, never one
// alone.
router.use(requireAuth, requireRole("Owner"));

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const RangeSchema = z.object({
  from: z.string().regex(DATE_KEY),
  to: z.string().regex(DATE_KEY)
});

const LAGOS = "Africa/Lagos";
/** Start of a Lagos calendar day as an absolute instant. */
const startOfLagosDay = (dateKey: string) => new Date(`${dateKey}T00:00:00+01:00`).toISOString();
/** Exclusive end: the start of the following day. */
const endOfLagosDay = (dateKey: string) => {
  const next = new Date(`${dateKey}T00:00:00+01:00`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
};
const lagosDayOf = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: LAGOS });

type CashRow = {
  id: string;
  at: string;
  direction: "in" | "out";
  category: string;
  description: string;
  source: string;
  cashIn: number;
  cashOut: number;
};

/** Every remittance (cash IN) between two instants. */
async function loadRemittances(orgId: string, fromIso: string, toIso: string): Promise<CashRow[]> {
  const { data } = await supabase
    .from("remittance_transactions")
    .select("id, order_id, delta_amount, received_at, logged_by_name, customer_snapshot, agent_id_snapshot")
    .eq("org_id", orgId)
    .gte("received_at", fromIso).lt("received_at", toIso)
    .order("received_at", { ascending: true })
    .limit(REPORT_ROW_CEILING);
  const rows = (data ?? []) as any[];
  const agentIds = [...new Set(rows.map((row) => row.agent_id_snapshot).filter(Boolean))];
  const agentNames = new Map<string, string>();
  if (agentIds.length > 0) {
    const { data: agents } = await supabase.from("agents").select("id, name").in("id", agentIds);
    (agents ?? []).forEach((agent: any) => agentNames.set(agent.id, agent.name));
  }
  return rows.map((row) => {
    const agent = row.agent_id_snapshot ? agentNames.get(row.agent_id_snapshot) ?? "Agent" : "Direct";
    return {
      id: `remit-${row.id}`,
      at: row.received_at,
      direction: "in" as const,
      category: "Agent Remittance",
      description: `Remittance from ${agent}${row.order_id ? ` · order ${row.order_id}` : ""}`,
      source: agent,
      cashIn: Number(row.delta_amount ?? 0),
      cashOut: 0
    };
  });
}

/** Every expense (cash OUT) on the Lagos days covered by the range. */
async function loadExpenses(orgId: string, fromKey: string, toKey: string): Promise<CashRow[]> {
  const { data } = await supabase
    .from("expenses")
    .select("id, date, category, description, amount, paid_by, created_at")
    .eq("org_id", orgId)
    .gte("date", fromKey).lte("date", toKey)
    .order("date", { ascending: true })
    .limit(REPORT_ROW_CEILING);
  return ((data ?? []) as any[]).map((row) => ({
    id: `expense-${row.id}`,
    // expenses carry a plain date, so they are pinned to 09:00 Lagos purely so
    // they sort sensibly against timestamped remittances on the same day.
    at: row.created_at ?? `${row.date}T09:00:00+01:00`,
    direction: "out" as const,
    category: cashOutGroupFor(row.category),
    description: String(row.description ?? row.category ?? "Expense"),
    source: String(row.paid_by ?? "").trim() || "Company",
    cashIn: 0,
    cashOut: Number(row.amount ?? 0)
  }));
}

/** Net cash movement strictly between two instants. */
async function netBetween(orgId: string, fromIso: string, toIso: string): Promise<number> {
  const fromKey = lagosDayOf(fromIso);
  const toKey = lagosDayOf(new Date(new Date(toIso).getTime() - 1).toISOString());
  const [remits, spends] = await Promise.all([
    loadRemittances(orgId, fromIso, toIso),
    toKey >= fromKey ? loadExpenses(orgId, fromKey, toKey) : Promise.resolve([] as CashRow[])
  ]);
  return remits.reduce((sum, row) => sum + row.cashIn, 0) - spends.reduce((sum, row) => sum + row.cashOut, 0);
}

/**
 * Opening cash at the start of a period.
 *
 * The most recent anchor at or before the period start, plus everything that
 * moved between the anchor and the period start. With no anchor at all the
 * figure is only "net cash generated since records began", which is NOT a bank
 * balance - `anchored: false` tells the page to say so rather than let the
 * number be read as money on hand.
 */
async function resolveOpeningCash(orgId: string, periodStartIso: string) {
  // A counted weekly opening beats everything else: it is the figure someone
  // physically checked against the accounts on the first day of this week.
  const weekStartKey = lagosDayOf(periodStartIso);
  const { data: weekly } = await supabase
    .from("cash_opening_balances")
    .select("id, amount, effective_at, method, reason, set_by_name, week_start")
    .eq("org_id", orgId).eq("week_start", weekStartKey).maybeSingle();
  if (weekly) {
    return {
      amount: Number(weekly.amount ?? 0),
      anchored: true,
      // Counted for THIS week, so it is frozen: nothing later can move it.
      source: "weekly_count" as const,
      anchor: {
        id: weekly.id,
        amount: Number(weekly.amount ?? 0),
        effectiveAt: weekly.effective_at,
        method: weekly.method,
        reason: weekly.reason ?? "",
        setByName: weekly.set_by_name ?? ""
      }
    };
  }

  // ⚠️ Bank accounts win when they exist. They are the cash Protohub can
  // actually reach - Opay and Moniepoint - so once they are set up they are
  // THE source, and the company-wide anchor below is only a fallback for an
  // org that has not added any. Letting both run would put two different
  // "opening cash" figures on one page.
  const { data: accountRows } = await supabase.from("bank_accounts")
    .select("opening_balance, opening_balance_date, created_at")
    .eq("org_id", orgId).eq("active", true);
  const accounts = (accountRows ?? []) as any[];
  if (accounts.length > 0) {
    const baseline = accounts.reduce((sum, row) => sum + Number(row.opening_balance ?? 0), 0);
    // Movements are counted from the EARLIEST account's effective date, so an
    // account added later does not double-count what came before it.
    const dates = accounts
      .map((row) => row.opening_balance_date ?? String(row.created_at ?? "").slice(0, 10))
      .filter(Boolean)
      .sort();
    const baselineIso = dates.length > 0 ? startOfLagosDay(dates[0]) : periodStartIso;
    const drift = baselineIso < periodStartIso ? await netBetween(orgId, baselineIso, periodStartIso) : 0;
    return {
      amount: baseline + drift,
      anchored: true,
      // ⚠️ DERIVED, not counted. This week was never opened, so its figure is
      // recomputed from the account opening balances every time it is viewed -
      // editing an account's opening balance moves it retrospectively. Only a
      // counted week is frozen.
      source: "derived_accounts" as const,
      anchor: {
        id: "bank-accounts",
        amount: baseline,
        effectiveAt: baselineIso,
        method: "bank_accounts",
        reason: `Sum of ${accounts.length} active account${accounts.length === 1 ? "" : "s"} opening balance${accounts.length === 1 ? "" : "s"}.`,
        setByName: "Bank accounts"
      }
    };
  }

  const { data: anchor } = await supabase
    .from("cash_opening_balances")
    .select("id, amount, effective_at, method, reason, set_by_name")
    .eq("org_id", orgId)
    .lte("effective_at", periodStartIso)
    .order("effective_at", { ascending: false })
    .limit(1).maybeSingle();

  if (!anchor) {
    const { data: earliest } = await supabase.from("remittance_transactions")
      .select("received_at").eq("org_id", orgId)
      .order("received_at", { ascending: true }).limit(1).maybeSingle();
    const since = earliest?.received_at ?? periodStartIso;
    const drift = since < periodStartIso ? await netBetween(orgId, since, periodStartIso) : 0;
    return { amount: drift, anchored: false, source: "derived_ledger" as const, anchor: null as any };
  }

  const drift = await netBetween(orgId, anchor.effective_at, periodStartIso);
  return {
    amount: Number(anchor.amount ?? 0) + drift,
    anchored: true,
    source: "standalone_anchor" as const,
    anchor: {
      id: anchor.id,
      amount: Number(anchor.amount ?? 0),
      effectiveAt: anchor.effective_at,
      method: anchor.method,
      reason: anchor.reason ?? "",
      setByName: anchor.set_by_name ?? ""
    }
  };
}

/** Cash collected from customers that agents have not handed over. */
async function cashStillWithAgents(orgId: string): Promise<number> {
  const { data: orders } = await supabase.from("orders")
    .select("id, amount").eq("org_id", orgId)
    .eq("status", "Delivered").neq("review_hold", true)
    .limit(REPORT_ROW_CEILING);
  const rows = (orders ?? []) as any[];
  if (rows.length === 0) return 0;
  const { data: remitted } = await supabase.from("remittance_transactions")
    .select("order_id, delta_amount").eq("org_id", orgId).limit(REPORT_ROW_CEILING);
  const paid = new Map<string, number>();
  ((remitted ?? []) as any[]).forEach((row) => {
    paid.set(row.order_id, (paid.get(row.order_id) ?? 0) + Number(row.delta_amount ?? 0));
  });
  return rows.reduce((sum, order) =>
    sum + Math.max(0, Number(order.amount ?? 0) - (paid.get(order.id) ?? 0)), 0);
}

// ── GET /api/cash-flow ────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const parsed = RangeSchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const { from, to } = parsed.data;
    if (to < from) { res.status(400).json({ error: "The end date is before the start date." }); return; }

    const fromIso = startOfLagosDay(from);
    const toIso = endOfLagosDay(to);

    const [opening, remits, spends, held] = await Promise.all([
      resolveOpeningCash(orgId, fromIso),
      loadRemittances(orgId, fromIso, toIso),
      loadExpenses(orgId, from, to),
      cashStillWithAgents(orgId)
    ]);

    const cashIn = remits.reduce((sum, row) => sum + row.cashIn, 0);
    const cashOut = spends.reduce((sum, row) => sum + row.cashOut, 0);

    // Same-length window immediately before this one, so "vs last period"
    // compares like with like rather than a week against a month.
    const spanDays = dayRange(from, to).length || 1;
    const prevEnd = new Date(`${from}T00:00:00+01:00`);
    prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setUTCDate(prevStart.getUTCDate() - (spanDays - 1));
    const prevNet = await netBetween(
      orgId,
      prevStart.toISOString(),
      new Date(prevEnd.getTime() + 86_400_000).toISOString()
    );

    const outByGroup = new Map<string, number>();
    spends.forEach((row) => outByGroup.set(row.category, (outByGroup.get(row.category) ?? 0) + row.cashOut));
    const inByGroup = new Map<string, number>([
      ["Agent Remittances", cashIn],
      ["Other Cash In", 0]
    ]);

    const all = [...remits, ...spends].sort((left, right) => left.at.localeCompare(right.at));

    res.json({
      period: { from, to },
      openingCash: opening.amount,
      openingAnchored: opening.anchored,
      openingSource: opening.source,
      openingAnchor: opening.anchor,
      cashIn,
      cashOut,
      netCashFlow: cashIn - cashOut,
      closingCash: opening.amount + cashIn - cashOut,
      netChangeVsPreviousPct: changeVsPrevious(cashIn - cashOut, prevNet),
      cashStillWithAgents: held,
      trend: buildDailyTrend(
        dayRange(from, to),
        remits.map((row) => ({ day: lagosDayOf(row.at), amount: row.cashIn })),
        spends.map((row) => ({ day: lagosDayOf(row.at), amount: row.cashOut }))
      ),
      cashInBreakdown: buildBreakdown(inByGroup, ["Agent Remittances", "Other Cash In"]),
      cashOutBreakdown: buildBreakdown(outByGroup, CASH_OUT_GROUPS),
      transactions: withRunningBalance(all, opening.amount)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load cash flow." });
  }
});

// ── GET /api/cash-flow/opening-balances ───────────────────
router.get("/opening-balances", async (req, res) => {
  try {
    const { data } = await supabase.from("cash_opening_balances")
      .select("id, amount, effective_at, method, reason, set_by_name, created_at")
      .eq("org_id", req.user!.orgId)
      .order("effective_at", { ascending: false })
      .limit(100);
    res.json({
      rows: ((data ?? []) as any[]).map((row) => ({
        id: row.id,
        amount: Number(row.amount ?? 0),
        effectiveAt: row.effective_at,
        method: row.method,
        reason: row.reason ?? "",
        setByName: row.set_by_name ?? "",
        createdAt: row.created_at
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load opening cash history." });
  }
});

const OpeningSchema = z.object({
  amount: z.coerce.number().min(0).max(1_000_000_000_000),
  effectiveAt: z.string().min(10),
  method: z.enum(["manual", "carry_forward"]).default("manual"),
  reason: z.string().trim().min(1, "Say why this figure is being set.").max(250)
}).strict();

// Owner/Admin only: this moves every balance on the page, so it is not a
// Manager-level edit. Rows are append-only - a correction is a new anchor,
// which is what makes the history worth reading.
router.post("/opening-balances", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const parsed = OpeningSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const effective = new Date(parsed.data.effectiveAt);
    if (Number.isNaN(effective.getTime())) { res.status(400).json({ error: "That date and time could not be read." }); return; }

    const { data: actor } = await supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle();
    const { data, error } = await supabase.from("cash_opening_balances")
      .insert({
        org_id: req.user!.orgId,
        amount: parsed.data.amount,
        effective_at: effective.toISOString(),
        method: parsed.data.method,
        reason: parsed.data.reason,
        set_by: req.user!.id,
        set_by_name: String(actor?.name ?? "").trim() || "Unknown"
      })
      .select("id, amount, effective_at, method, reason, set_by_name, created_at")
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ row: {
      id: data.id,
      amount: Number(data.amount ?? 0),
      effectiveAt: data.effective_at,
      method: data.method,
      reason: data.reason ?? "",
      setByName: data.set_by_name ?? "",
      createdAt: data.created_at
    } });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save that opening cash." });
  }
});


// ══ Bank accounts ═════════════════════════════════════════

const AccountSchema = z.object({
  name: z.string().trim().min(1).max(80),
  accountType: z.enum(["bank", "cash"]).default("bank"),
  bankName: z.string().trim().max(80).default(""),
  accountNumberLast4: z.string().trim().regex(/^[0-9]{0,4}$/, "Use the last 4 digits only.").default(""),
  isPrimary: z.boolean().default(false),
  openingBalance: z.coerce.number().min(-1_000_000_000_000).max(1_000_000_000_000).default(0),
  openingBalanceDate: z.string().regex(DATE_KEY).nullable().optional()
}).strict();

const rowToAccount = (row: any) => ({
  id: row.id,
  name: row.name,
  accountType: row.account_type as "bank" | "cash",
  bankName: row.bank_name ?? "",
  accountNumberLast4: row.account_number_last4 ?? "",
  isPrimary: row.is_primary === true,
  active: row.active !== false,
  openingBalance: Number(row.opening_balance ?? 0),
  openingBalanceDate: row.opening_balance_date ?? null,
  updatedAt: row.updated_at ?? null
});

/** Every movement ever, so an account balance reflects its whole life. */
async function loadAllMovements(orgId: string, untilIso?: string) {
  // `untilIso` bounds the movements to those that had happened by an instant,
  // which is what a WEEK-END balance means. Without it the balance is "now",
  // and reconciling last week against today's account totals would compare two
  // different moments and manufacture a variance out of thin air.
  const untilKey = untilIso ? lagosDayOf(new Date(new Date(untilIso).getTime() - 1).toISOString()) : null;
  const remitQuery = supabase.from("remittance_transactions")
    .select("bank_account_id, delta_amount").eq("org_id", orgId).limit(REPORT_ROW_CEILING);
  const spendQuery = supabase.from("expenses")
    .select("bank_account_id, amount").eq("org_id", orgId).limit(REPORT_ROW_CEILING);
  if (untilIso) remitQuery.lt("received_at", untilIso);
  if (untilKey) spendQuery.lte("date", untilKey);
  const [{ data: remits }, { data: spends }] = await Promise.all([remitQuery, spendQuery]);
  return [
    ...((remits ?? []) as any[]).map((row) => ({
      accountId: row.bank_account_id ?? null, cashIn: Number(row.delta_amount ?? 0), cashOut: 0
    })),
    ...((spends ?? []) as any[]).map((row) => ({
      accountId: row.bank_account_id ?? null, cashIn: 0, cashOut: Number(row.amount ?? 0)
    }))
  ];
}

// ── GET /api/cash-flow/accounts ───────────────────────────
router.get("/accounts", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const [{ data: accountRows }, { data: transferRows }, movements] = await Promise.all([
      supabase.from("bank_accounts").select("*").eq("org_id", orgId)
        .order("is_primary", { ascending: false }).order("created_at", { ascending: true }),
      supabase.from("bank_account_transfers")
        .select("id, from_account_id, to_account_id, amount, transferred_at, cleared_at, note")
        .eq("org_id", orgId).order("transferred_at", { ascending: false }).limit(REPORT_ROW_CEILING),
      loadAllMovements(orgId)
    ]);

    const accounts = ((accountRows ?? []) as any[]).map(rowToAccount);
    const transfers = ((transferRows ?? []) as any[]).map((row) => ({
      id: row.id,
      fromAccountId: row.from_account_id,
      toAccountId: row.to_account_id,
      amount: Number(row.amount ?? 0),
      transferredAt: row.transferred_at,
      clearedAt: row.cleared_at ?? null,
      note: row.note ?? ""
    }));

    const balances = computeAccountBalances(
      accounts.filter((account) => account.active).map((account) => ({ id: account.id, openingBalance: account.openingBalance })),
      movements,
      transfers
    );
    const totals = summariseAccounts(
      accounts.filter((account) => account.active).map((account) => ({ id: account.id, kind: account.accountType })),
      balances
    );

    res.json({
      accounts: accounts.map((account) => ({
        ...account,
        ...(balances.find((row) => row.accountId === account.id) ?? {
          currentBalance: account.openingBalance, availableBalance: account.openingBalance, pendingIn: 0, pendingOut: 0
        })
      })),
      totals,
      // Cash recorded before accounts existed. Reported rather than hidden so
      // the gap between the ledger and the account balances is explained.
      unassigned: unassignedTotal(movements),
      transfers
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load accounts." });
  }
});

router.post("/accounts", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const parsed = AccountSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const body = parsed.data;
    // Only one account can be primary, so promoting one demotes the rest.
    if (body.isPrimary) {
      await supabase.from("bank_accounts").update({ is_primary: false }).eq("org_id", orgId);
    }
    const { data, error } = await supabase.from("bank_accounts").insert({
      org_id: orgId,
      name: body.name,
      account_type: body.accountType,
      bank_name: body.bankName,
      account_number_last4: body.accountNumberLast4,
      is_primary: body.isPrimary,
      opening_balance: body.openingBalance,
      opening_balance_date: body.openingBalanceDate ?? null
    }).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ account: rowToAccount(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not add that account." });
  }
});

router.patch("/accounts/:id", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const parsed = AccountSchema.partial().extend({ active: z.boolean().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const body = parsed.data;
    if (body.isPrimary) {
      await supabase.from("bank_accounts").update({ is_primary: false }).eq("org_id", orgId);
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.accountType !== undefined) patch.account_type = body.accountType;
    if (body.bankName !== undefined) patch.bank_name = body.bankName;
    if (body.accountNumberLast4 !== undefined) patch.account_number_last4 = body.accountNumberLast4;
    if (body.isPrimary !== undefined) patch.is_primary = body.isPrimary;
    if (body.active !== undefined) patch.active = body.active;
    if (body.openingBalance !== undefined) patch.opening_balance = body.openingBalance;
    if (body.openingBalanceDate !== undefined) patch.opening_balance_date = body.openingBalanceDate ?? null;

    const { data, error } = await supabase.from("bank_accounts")
      .update(patch).eq("org_id", orgId).eq("id", req.params.id).select("*").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ account: rowToAccount(data) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update that account." });
  }
});

// ── Transfers between our own accounts ────────────────────
// ⚠️ Never cash flow. Nothing enters or leaves the business, so these are
// excluded from cash in/out while still moving the two account balances.
const TransferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountId: z.string().uuid(),
  amount: z.coerce.number().positive().max(1_000_000_000_000),
  transferredAt: z.string().min(10).optional(),
  note: z.string().trim().max(250).default(""),
  markCleared: z.boolean().default(false)
}).strict().superRefine((value, context) => {
  if (value.fromAccountId === value.toAccountId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Choose two different accounts.", path: ["toAccountId"] });
  }
});

router.post("/transfers", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const parsed = TransferSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const body = parsed.data;
    const { data: owned } = await supabase.from("bank_accounts")
      .select("id").eq("org_id", orgId).in("id", [body.fromAccountId, body.toAccountId]);
    if ((owned ?? []).length !== 2) { res.status(404).json({ error: "One of those accounts does not exist here." }); return; }

    const { data, error } = await supabase.from("bank_account_transfers").insert({
      org_id: orgId,
      from_account_id: body.fromAccountId,
      to_account_id: body.toAccountId,
      amount: body.amount,
      transferred_at: body.transferredAt ? new Date(body.transferredAt).toISOString() : new Date().toISOString(),
      cleared_at: body.markCleared ? new Date().toISOString() : null,
      note: body.note,
      created_by: req.user!.id
    }).select("id").single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ id: data.id });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not record that transfer." });
  }
});

router.post("/transfers/:id/clear", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const { error } = await supabase.from("bank_account_transfers")
      .update({ cleared_at: new Date().toISOString() })
      .eq("org_id", req.user!.orgId).eq("id", req.params.id).is("cleared_at", null);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not clear that transfer." });
  }
});

// ── Assigning historical cash to an account ───────────────
// Rows recorded before accounts existed have no account and read as
// Unassigned. This lets the Owner attribute them in bulk rather than one at a
// time, or leave them alone - guessing on their behalf would invent a bank
// history that never happened.
const AssignSchema = z.object({
  accountId: z.string().uuid(),
  from: z.string().regex(DATE_KEY),
  to: z.string().regex(DATE_KEY),
  target: z.enum(["remittances", "expenses", "both"]).default("both"),
  onlyUnassigned: z.boolean().default(true)
}).strict();

router.post("/assign-account", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const parsed = AssignSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const body = parsed.data;
    const { data: account } = await supabase.from("bank_accounts")
      .select("id").eq("org_id", orgId).eq("id", body.accountId).maybeSingle();
    if (!account) { res.status(404).json({ error: "That account does not exist here." }); return; }

    let remittances = 0;
    let expenses = 0;
    if (body.target !== "expenses") {
      let query = supabase.from("remittance_transactions").update({ bank_account_id: body.accountId })
        .eq("org_id", orgId)
        .gte("received_at", startOfLagosDay(body.from)).lt("received_at", endOfLagosDay(body.to));
      if (body.onlyUnassigned) query = query.is("bank_account_id", null);
      const { data } = await query.select("id");
      remittances = (data ?? []).length;
    }
    if (body.target !== "remittances") {
      let query = supabase.from("expenses").update({ bank_account_id: body.accountId })
        .eq("org_id", orgId).gte("date", body.from).lte("date", body.to);
      if (body.onlyUnassigned) query = query.is("bank_account_id", null);
      const { data } = await query.select("id");
      expenses = (data ?? []).length;
    }
    res.json({ remittances, expenses });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not assign those transactions." });
  }
});

// Removing an account. Refused outright once anything has moved through it -
// deleting would either orphan those transactions or, worse, silently detach
// them and change every balance on the page. Deactivating keeps the history
// and takes it off the dashboard, which is what "remove" almost always means.
router.delete("/accounts/:id", requireRole("Owner"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const accountId = req.params.id;
    const { data: account } = await supabase.from("bank_accounts")
      .select("id, name").eq("org_id", orgId).eq("id", accountId).maybeSingle();
    if (!account) { res.status(404).json({ error: "That account does not exist here." }); return; }

    const countWhere = async (table: string, column: string) => {
      const { count } = await supabase.from(table)
        .select("id", { count: "exact", head: true }).eq(column, accountId);
      return count ?? 0;
    };
    const [remittances, expenses, transfersOut, transfersIn] = await Promise.all([
      countWhere("remittance_transactions", "bank_account_id"),
      countWhere("expenses", "bank_account_id"),
      countWhere("bank_account_transfers", "from_account_id"),
      countWhere("bank_account_transfers", "to_account_id")
    ]);
    const blockers = [
      remittances > 0 && `${remittances} remittance${remittances === 1 ? "" : "s"}`,
      expenses > 0 && `${expenses} expense${expenses === 1 ? "" : "s"}`,
      (transfersOut + transfersIn) > 0 && `${transfersOut + transfersIn} transfer${transfersOut + transfersIn === 1 ? "" : "s"}`
    ].filter(Boolean) as string[];

    if (blockers.length > 0) {
      res.status(409).json({
        error: `${account.name} has ${blockers.join(", ")} against it and cannot be deleted. Deactivate it instead - that hides it from the dashboard while keeping the history.`,
        blockers
      });
      return;
    }
    const { error } = await supabase.from("bank_accounts").delete().eq("org_id", orgId).eq("id", accountId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true, deleted: account.name });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not remove that account." });
  }
});

// ── Weekly opening cash ───────────────────────────────────
// Protohub accounts weekly, so each week starts from a counted figure rather
// than a balance that has drifted since whenever it was last set.

/** Sunday-anchored, matching every other weekly figure in this app. */
function sundayWeekStart(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}
function addDaysKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ── GET /api/cash-flow/weekly-opening?weekStart= ──────────
router.get("/weekly-opening", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const requested = String(req.query.weekStart ?? "");
    // Any date resolves to the Sunday week it falls in - the official start.
    const weekStart = sundayWeekStart(
      DATE_KEY.test(requested) ? requested : lagosDayOf(new Date().toISOString())
    );
    const weekEnd = addDaysKey(weekStart, 6);
    const previousStart = addDaysKey(weekStart, -7);

    const [{ data: existing }, { data: accounts }] = await Promise.all([
      supabase.from("cash_opening_balances")
        .select("id, amount, effective_at, method, reason, set_by_name, week_start")
        .eq("org_id", orgId).eq("week_start", weekStart).maybeSingle(),
      supabase.from("bank_accounts")
        .select("id, name, bank_name, account_type, account_number_last4, is_primary")
        .eq("org_id", orgId).eq("active", true)
        .order("is_primary", { ascending: false }).order("created_at", { ascending: true })
    ]);

    let sources: Array<{ bankAccountId: string | null; accountLabel: string; amount: number }> = [];
    if (existing) {
      const { data: rows } = await supabase.from("cash_opening_balance_sources")
        .select("bank_account_id, account_label, amount").eq("opening_balance_id", existing.id);
      sources = ((rows ?? []) as any[]).map((row) => ({
        bankAccountId: row.bank_account_id ?? null,
        accountLabel: row.account_label ?? "",
        amount: Number(row.amount ?? 0)
      }));
    }

    // Last week's CLOSING cash - its opening plus everything that moved. This
    // is what the new opening should be checked against: a large unexplained
    // gap means either a miscount or cash that never got recorded.
    const previousOpening = await resolveOpeningCash(orgId, startOfLagosDay(previousStart));
    const previousNet = await netBetween(orgId, startOfLagosDay(previousStart), startOfLagosDay(weekStart));

    res.json({
      weekStart,
      weekEnd,
      /** True when this week has never been opened - the page blocks on it. */
      needsOpening: !existing,
      existing: existing ? {
        id: existing.id,
        amount: Number(existing.amount ?? 0),
        effectiveAt: existing.effective_at,
        reason: existing.reason ?? "",
        setByName: existing.set_by_name ?? "",
        sources
      } : null,
      accounts: ((accounts ?? []) as any[]).map((row) => ({
        id: row.id,
        name: row.name,
        bankName: row.bank_name ?? "",
        accountType: row.account_type,
        accountNumberLast4: row.account_number_last4 ?? "",
        isPrimary: row.is_primary === true
      })),
      previousWeek: {
        from: previousStart,
        to: addDaysKey(previousStart, 6),
        closingCash: previousOpening.amount + previousNet
      },
      /** The week start the rest of the app would use, for a mismatch warning. */
      suggestedWeekStart: sundayWeekStart(weekStart)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the week's opening cash." });
  }
});

const WeeklyOpeningSchema = z.object({
  weekStart: z.string().regex(DATE_KEY),
  reason: z.string().trim().max(250).default(""),
  sources: z.array(z.object({
    bankAccountId: z.string().uuid().nullable().optional(),
    accountLabel: z.string().trim().min(1).max(80),
    amount: z.coerce.number().min(0).max(1_000_000_000_000)
  })).min(1, "Add at least one cash source.").max(20)
}).strict();

router.post("/weekly-opening", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = WeeklyOpeningSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    // ⚠️ The accounting week officially starts on SUNDAY, the same anchor
    // payroll, bonuses and the Head of Sales scorecard already use. Snapped
    // rather than rejected: whatever day is sent, the week it belongs to is
    // unambiguous, and this guarantees one row per real week no matter which
    // client sent it. Everything built on weekly cash can now assume Sunday.
    const body = { ...parsed.data, weekStart: sundayWeekStart(parsed.data.weekStart) };
    const total = body.sources.reduce((sum, source) => sum + Number(source.amount ?? 0), 0);

    const { data: actor } = await supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle();
    // ⚠️ ONE round trip, ONE transaction. This used to delete the week's row
    // and then insert a replacement: a failure between the two destroyed the
    // very figure being corrected. The function upserts the parent and
    // replaces its sources atomically, so a failed correction changes nothing.
    // Only THIS week's row is touched - other weeks are never rewritten.
    const { data: savedId, error } = await supabase.rpc("save_weekly_opening_cash", {
      p_org_id: orgId,
      p_week_start: body.weekStart,
      p_amount: total,
      p_reason: body.reason || `Counted across ${body.sources.length} cash source${body.sources.length === 1 ? "" : "s"}.`,
      p_set_by: req.user!.id,
      p_set_by_name: String(actor?.name ?? "").trim() || "Unknown",
      p_sources: body.sources.map((source) => ({
        bankAccountId: source.bankAccountId ?? null,
        accountLabel: source.accountLabel,
        amount: source.amount
      }))
    });
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({ id: savedId, weekStart: body.weekStart, total });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save the week's opening cash." });
  }
});

// ══ Weekly Reconciliation ═════════════════════════════════
//
// Cash Flow reports what was RECORDED. This asks the other question - what is
// actually in the accounts - and the gap between the two is the point of the
// whole tab. A week that reconciles to zero means the books can be trusted; a
// week that does not means money moved without being written down.

/** Per-account balances as they stood at an instant, newest account last. */
async function accountBalancesAsAt(orgId: string, untilIso: string) {
  const [{ data: accountRows }, { data: transferRows }, movements] = await Promise.all([
    supabase.from("bank_accounts")
      .select("id, name, bank_name, account_type, account_number_last4, is_primary, opening_balance")
      .eq("org_id", orgId).eq("active", true)
      .order("is_primary", { ascending: false }).order("created_at", { ascending: true }),
    supabase.from("bank_account_transfers")
      .select("from_account_id, to_account_id, amount, cleared_at")
      .eq("org_id", orgId).lt("transferred_at", untilIso).limit(REPORT_ROW_CEILING),
    loadAllMovements(orgId, untilIso)
  ]);
  const accounts = ((accountRows ?? []) as any[]);
  const balances = computeAccountBalances(
    accounts.map((row) => ({ id: row.id, openingBalance: Number(row.opening_balance ?? 0) })),
    movements,
    ((transferRows ?? []) as any[]).map((row) => ({
      fromAccountId: row.from_account_id,
      toAccountId: row.to_account_id,
      amount: Number(row.amount ?? 0),
      clearedAt: row.cleared_at ?? null
    }))
  );
  return {
    accounts: accounts.map((row) => ({
      id: row.id,
      name: row.name,
      bankName: row.bank_name ?? "",
      accountType: row.account_type,
      accountNumberLast4: row.account_number_last4 ?? "",
      systemBalance: balances.find((entry) => entry.accountId === row.id)?.currentBalance
        ?? Number(row.opening_balance ?? 0)
    })),
    unassigned: unassignedTotal(movements)
  };
}

/** The week's trading and spending shape, for the summary strip. */
async function weekActivity(orgId: string, weekStart: string, weekEnd: string) {
  const fromIso = startOfLagosDay(weekStart);
  const toIso = endOfLagosDay(weekEnd);
  const [{ data: placed }, { data: deliveredRows }, spends, remits] = await Promise.all([
    supabase.from("orders").select("id, status, review_hold")
      .eq("org_id", orgId).gte("created_at", fromIso).lt("created_at", toIso)
      .limit(REPORT_ROW_CEILING),
    // Delivered THIS week regardless of when placed - that is what generates
    // the cash the agents owe, so it is the right base for the remittance
    // ratio even though the delivery rate beside it is a cohort figure.
    supabase.from("orders").select("id, amount")
      .eq("org_id", orgId).eq("status", "Delivered").neq("review_hold", true)
      .gte("updated_at", fromIso).lt("updated_at", toIso)
      .limit(REPORT_ROW_CEILING),
    loadExpenses(orgId, weekStart, weekEnd),
    loadRemittances(orgId, fromIso, toIso)
  ]);

  const cohort = ((placed ?? []) as any[]).filter((row) => row.review_hold !== true);
  const cohortDelivered = cohort.filter((row) => row.status === "Delivered").length;
  const deliveredValue = ((deliveredRows ?? []) as any[])
    .reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const remitted = remits.reduce((sum, row) => sum + row.cashIn, 0);
  const byGroup = new Map<string, number>();
  spends.forEach((row) => byGroup.set(row.category, (byGroup.get(row.category) ?? 0) + row.cashOut));
  const cashOut = spends.reduce((sum, row) => sum + row.cashOut, 0);
  const share = (value: number) => (cashOut > 0 ? Math.round((value / cashOut) * 10000) / 100 : 0);

  return {
    // ⚠️ COHORT delivery rate - of the orders PLACED this week, how many have
    // been delivered. Deliberately the Orders page definition, not the
    // dashboard's throughput one; the two differ on purpose and unifying them
    // here would put a third number in front of the same word.
    ordersPlaced: cohort.length,
    ordersDelivered: cohortDelivered,
    deliveryRatePct: cohort.length > 0 ? Math.round((cohortDelivered / cohort.length) * 10000) / 100 : 0,
    agentRemittances: remitted,
    /** Value delivered this week - what agents should eventually hand over. */
    expectedRemittances: deliveredValue,
    remittanceCoveragePct: deliveredValue > 0 ? Math.round((remitted / deliveredValue) * 10000) / 100 : 0,
    adSpend: byGroup.get("Facebook / Instagram Ads") ?? 0,
    adSpendPct: share(byGroup.get("Facebook / Instagram Ads") ?? 0),
    stockPurchases: byGroup.get("Stock Purchases") ?? 0,
    stockPurchasesPct: share(byGroup.get("Stock Purchases") ?? 0),
    otherExpenses: (byGroup.get("Other Operating Expenses") ?? 0) + (byGroup.get("Payroll") ?? 0)
      + (byGroup.get("Logistics / Dispatch") ?? 0),
    otherExpensesPct: share((byGroup.get("Other Operating Expenses") ?? 0) + (byGroup.get("Payroll") ?? 0)
      + (byGroup.get("Logistics / Dispatch") ?? 0))
  };
}

// ── GET /api/cash-flow/reconciliation?weekStart= ──────────
router.get("/reconciliation", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const requested = String(req.query.weekStart ?? "");
    const weekStart = sundayWeekStart(
      DATE_KEY.test(requested) ? requested : lagosDayOf(new Date().toISOString())
    );
    const weekEnd = addDaysKey(weekStart, 6);
    const fromIso = startOfLagosDay(weekStart);
    const toIso = endOfLagosDay(weekEnd);

    const [opening, live, verificationRow, investigationRow, activity] = await Promise.all([
      resolveOpeningCash(orgId, fromIso),
      accountBalancesAsAt(orgId, toIso),
      supabase.from("weekly_cash_verifications")
        .select("*").eq("org_id", orgId).eq("week_start", weekStart).maybeSingle(),
      supabase.from("cash_variance_investigations")
        .select("*").eq("org_id", orgId).eq("week_start", weekStart).maybeSingle(),
      weekActivity(orgId, weekStart, weekEnd)
    ]);

    const [remits, spends] = await Promise.all([
      loadRemittances(orgId, fromIso, toIso),
      loadExpenses(orgId, weekStart, weekEnd)
    ]);
    const cashIn = remits.reduce((sum, row) => sum + row.cashIn, 0);
    const cashOut = spends.reduce((sum, row) => sum + row.cashOut, 0);
    const expectedClosing = opening.amount + cashIn - cashOut;

    const verification = (verificationRow?.data ?? null) as any;
    let verifiedAccounts: any[] = [];
    if (verification?.id) {
      const { data: rows } = await supabase.from("weekly_cash_verification_accounts")
        .select("bank_account_id, account_label, system_balance, actual_balance")
        .eq("verification_id", verification.id);
      verifiedAccounts = ((rows ?? []) as any[]).map((row) => ({
        bankAccountId: row.bank_account_id ?? null,
        accountLabel: row.account_label ?? "",
        systemBalance: Number(row.system_balance ?? 0),
        actualBalance: Number(row.actual_balance ?? 0)
      }));
    }

    const investigation = (investigationRow?.data ?? null) as any;
    let events: any[] = [];
    if (investigation?.id) {
      const { data: rows } = await supabase.from("cash_variance_investigation_events")
        .select("id, kind, detail, amount, actor_name, created_at")
        .eq("investigation_id", investigation.id).order("created_at", { ascending: true });
      events = ((rows ?? []) as any[]).map((row) => ({
        id: row.id, kind: row.kind, detail: row.detail ?? "",
        amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
        actorName: row.actor_name ?? "", createdAt: row.created_at
      }));
    }

    // Largest single movements, for the highlights panel.
    const topIn = remits.slice().sort((a, b) => b.cashIn - a.cashIn)[0] ?? null;
    const topOut = spends.slice().sort((a, b) => b.cashOut - a.cashOut)[0] ?? null;
    const { data: transferRows } = await supabase.from("bank_account_transfers")
      .select("id, amount, transferred_at, from_account_id, to_account_id")
      .eq("org_id", orgId).gte("transferred_at", fromIso).lt("transferred_at", toIso)
      .order("amount", { ascending: false }).limit(1);
    const topTransfer = ((transferRows ?? []) as any[])[0] ?? null;
    const accountName = (id: string | null) =>
      live.accounts.find((account) => account.id === id)?.name ?? "Unassigned";

    res.json({
      weekStart,
      weekEnd,
      openingCash: opening.amount,
      // Only a counted week is a verified opening; everything else is derived
      // and can still move under the reconciliation's feet.
      openingVerified: opening.source === "weekly_count",
      cashIn,
      cashOut,
      expectedClosing,
      accounts: live.accounts,
      unassigned: live.unassigned,
      verification: verification ? {
        id: verification.id,
        status: verification.status,
        // The frozen pair, kept apart from the live figures above so a
        // backdated entry cannot quietly rewrite a signed-off variance.
        expectedClosing: Number(verification.expected_closing ?? 0),
        actualClosing: Number(verification.actual_closing ?? 0),
        notes: verification.notes ?? "",
        verifiedByName: verification.verified_by_name ?? "",
        verifiedAt: verification.verified_at,
        accounts: verifiedAccounts
      } : null,
      investigation: investigation ? {
        id: investigation.id,
        status: investigation.status,
        varianceAmount: Number(investigation.variance_amount ?? 0),
        reason: investigation.reason ?? "",
        amountExplained: Number(investigation.amount_explained ?? 0),
        description: investigation.description ?? "",
        occurredOn: investigation.occurred_on,
        category: investigation.category ?? "",
        evidenceName: investigation.evidence_name ?? "",
        evidenceUrl: investigation.evidence_url ?? "",
        createdByName: investigation.created_by_name ?? "",
        events
      } : null,
      activity,
      highlights: {
        topCashIn: topIn ? { label: topIn.description, amount: topIn.cashIn, at: topIn.at } : null,
        topCashOut: topOut ? { label: topOut.description, amount: topOut.cashOut, at: topOut.at } : null,
        topTransfer: topTransfer ? {
          label: `Transfer from ${accountName(topTransfer.from_account_id)} to ${accountName(topTransfer.to_account_id)}`,
          amount: Number(topTransfer.amount ?? 0),
          at: topTransfer.transferred_at
        } : null
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the week's reconciliation." });
  }
});

const VerificationSchema = z.object({
  weekStart: z.string().regex(DATE_KEY),
  status: z.enum(["draft", "verified"]).default("verified"),
  notes: z.string().trim().max(250).default(""),
  accounts: z.array(z.object({
    bankAccountId: z.string().uuid().nullable().optional(),
    accountLabel: z.string().trim().min(1).max(80),
    systemBalance: z.coerce.number().min(-1_000_000_000_000).max(1_000_000_000_000),
    actualBalance: z.coerce.number().min(-1_000_000_000_000).max(1_000_000_000_000)
  })).min(1, "Count at least one account.").max(30)
}).strict();

// ── POST /api/cash-flow/reconciliation ────────────────────
router.post("/reconciliation", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = VerificationSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const weekStart = sundayWeekStart(parsed.data.weekStart);
    const body = parsed.data;

    const summary = summariseVerification(body.accounts.map((row) => ({
      bankAccountId: row.bankAccountId ?? null,
      accountLabel: row.accountLabel,
      systemBalance: row.systemBalance,
      actualBalance: row.actualBalance
    })));

    const { data: actor } = await supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle();
    // ⚠️ One transaction. A delete-then-insert here would destroy the very
    // count being corrected if the second call failed - the same hazard the
    // weekly opening cash function was written to avoid.
    const { data: savedId, error } = await supabase.rpc("save_weekly_cash_verification", {
      p_org_id: orgId,
      p_week_start: weekStart,
      p_expected: summary.totalSystem,
      p_actual: summary.totalActual,
      p_status: body.status,
      p_notes: body.notes,
      p_verified_by: req.user!.id,
      p_verified_by_name: String(actor?.name ?? "").trim() || "Unknown",
      p_accounts: body.accounts.map((row) => ({
        bankAccountId: row.bankAccountId ?? null,
        accountLabel: row.accountLabel,
        systemBalance: row.systemBalance,
        actualBalance: row.actualBalance
      }))
    });
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({
      id: savedId,
      weekStart,
      expectedClosing: summary.totalSystem,
      actualClosing: summary.totalActual,
      variance: summary.variance,
      status: reconciliationStatus({ verified: body.status === "verified", variance: summary.variance })
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save the closing cash count." });
  }
});

const InvestigationSchema = z.object({
  weekStart: z.string().regex(DATE_KEY),
  status: z.enum(["in_progress", "submitted", "resolved"]).default("in_progress"),
  reason: z.enum(VARIANCE_REASONS).nullable().optional(),
  amountExplained: z.coerce.number().min(0).max(1_000_000_000_000).default(0),
  description: z.string().trim().max(500).default(""),
  occurredOn: z.string().regex(DATE_KEY).nullable().optional(),
  category: z.string().trim().max(60).default(""),
  evidenceName: z.string().trim().max(200).default(""),
  evidenceUrl: z.string().trim().max(500).default("")
}).strict();

// ── POST /api/cash-flow/reconciliation/investigation ──────
router.post("/reconciliation/investigation", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = InvestigationSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const weekStart = sundayWeekStart(parsed.data.weekStart);
    const body = parsed.data;

    // A submitted investigation must actually explain something. Allowing an
    // empty one through would let a week be signed off with the money still
    // missing and no account of where it went.
    if (body.status !== "in_progress" && !body.description.trim()) {
      res.status(400).json({ error: "Add an explanation before submitting the investigation." });
      return;
    }

    const { data: verification } = await supabase.from("weekly_cash_verifications")
      .select("id, expected_closing, actual_closing")
      .eq("org_id", orgId).eq("week_start", weekStart).maybeSingle();
    if (!verification) {
      res.status(400).json({ error: "Verify the week's closing cash before investigating a variance." });
      return;
    }
    const variance = Number(verification.actual_closing ?? 0) - Number(verification.expected_closing ?? 0);

    const { data: actor } = await supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle();
    const actorName = String(actor?.name ?? "").trim() || "Unknown";
    const { data: existing } = await supabase.from("cash_variance_investigations")
      .select("id, status, amount_explained, evidence_name")
      .eq("org_id", orgId).eq("week_start", weekStart).maybeSingle();

    const payload = {
      org_id: orgId,
      week_start: weekStart,
      verification_id: verification.id,
      variance_amount: variance,
      reason: body.reason ?? "",
      amount_explained: body.amountExplained,
      description: body.description,
      occurred_on: body.occurredOn ?? null,
      category: body.category,
      evidence_name: body.evidenceName,
      evidence_url: body.evidenceUrl,
      status: body.status,
      created_by: existing ? undefined : req.user!.id,
      created_by_name: existing ? undefined : actorName,
      updated_at: new Date().toISOString()
    };
    Object.keys(payload).forEach((key) => {
      if ((payload as any)[key] === undefined) delete (payload as any)[key];
    });

    const { data: saved, error } = await supabase.from("cash_variance_investigations")
      .upsert(payload, { onConflict: "org_id,week_start" })
      .select("id").single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // The history panel is built from these, so each meaningful step is
    // recorded as it happens rather than reconstructed afterwards.
    const events: Array<{ kind: string; detail: string; amount: number | null }> = [];
    if (!existing) events.push({ kind: "started", detail: "Investigation started", amount: null });
    if (body.evidenceName && body.evidenceName !== (existing?.evidence_name ?? "")) {
      events.push({ kind: "evidence_uploaded", detail: body.evidenceName, amount: null });
    }
    if (body.amountExplained > 0 && body.amountExplained !== Number(existing?.amount_explained ?? 0)) {
      events.push({ kind: "partial_explained", detail: "Amount explained updated", amount: body.amountExplained });
    }
    if (body.status === "submitted" && existing?.status !== "submitted") {
      events.push({ kind: "submitted", detail: "Investigation submitted", amount: null });
    }
    if (body.status === "resolved" && existing?.status !== "resolved") {
      events.push({ kind: "resolved", detail: "Variance resolved", amount: null });
    }
    if (events.length > 0) {
      await supabase.from("cash_variance_investigation_events").insert(events.map((event) => ({
        investigation_id: saved.id,
        kind: event.kind,
        detail: event.detail,
        amount: event.amount,
        actor_id: req.user!.id,
        actor_name: actorName
      })));
    }

    // Keep the week's headline in step with its investigation.
    await supabase.from("weekly_cash_verifications")
      .update({ status: body.status === "resolved" ? "resolved" : "investigating", updated_at: new Date().toISOString() })
      .eq("id", verification.id);

    res.json({
      id: saved.id,
      weekStart,
      variance,
      progress: investigationProgress(variance, body.amountExplained)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save the investigation." });
  }
});

// ── GET /api/cash-flow/reconciliation/history ─────────────
router.get("/reconciliation/history", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data } = await supabase.from("weekly_cash_verifications")
      .select("id, week_start, expected_closing, actual_closing, status, verified_by_name, verified_at")
      .eq("org_id", orgId).order("week_start", { ascending: false }).limit(52);
    const rows = (data ?? []) as any[];
    const { data: investigations } = await supabase.from("cash_variance_investigations")
      .select("week_start, status, amount_explained")
      .eq("org_id", orgId).in("week_start", rows.map((row) => row.week_start));
    const byWeek = new Map<string, any>();
    ((investigations ?? []) as any[]).forEach((row) => byWeek.set(row.week_start, row));

    res.json({
      weeks: rows.map((row) => {
        const expected = Number(row.expected_closing ?? 0);
        const actual = Number(row.actual_closing ?? 0);
        const investigation = byWeek.get(row.week_start);
        return {
          id: row.id,
          weekStart: row.week_start,
          weekEnd: addDaysKey(row.week_start, 6),
          expectedClosing: expected,
          actualClosing: actual,
          variance: actual - expected,
          amountExplained: Number(investigation?.amount_explained ?? 0),
          status: reconciliationStatus({
            verified: row.status !== "draft",
            variance: actual - expected,
            investigationStatus: investigation?.status ?? null
          }),
          verifiedByName: row.verified_by_name ?? "",
          verifiedAt: row.verified_at
        };
      })
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load reconciliation history." });
  }
});

// ══ Restricted Cash / Reserves ════════════════════════════
//
// ⚠️ A reserve is a LABEL, never a movement. Setting money aside does not
// transfer, withdraw or touch a single naira - bank balances, cash flow totals
// and reconciliation figures are all unaffected. The only figure a reserve
// changes is Free Operating Cash. Nothing below writes to bank_accounts,
// expenses or remittance_transactions, and nothing should.

/** Total liquid cash across every active account, including cash in hand. */
async function totalLiquidCash(orgId: string): Promise<number> {
  const [{ data: accountRows }, { data: transferRows }, movements] = await Promise.all([
    supabase.from("bank_accounts").select("id, account_type, opening_balance")
      .eq("org_id", orgId).eq("active", true),
    supabase.from("bank_account_transfers")
      .select("from_account_id, to_account_id, amount, cleared_at")
      .eq("org_id", orgId).limit(REPORT_ROW_CEILING),
    loadAllMovements(orgId)
  ]);
  const accounts = (accountRows ?? []) as any[];
  const balances = computeAccountBalances(
    accounts.map((row) => ({ id: row.id, openingBalance: Number(row.opening_balance ?? 0) })),
    movements,
    ((transferRows ?? []) as any[]).map((row) => ({
      fromAccountId: row.from_account_id, toAccountId: row.to_account_id,
      amount: Number(row.amount ?? 0), clearedAt: row.cleared_at ?? null
    }))
  );
  return summariseAccounts(
    accounts.map((row) => ({ id: row.id, kind: row.account_type })), balances
  ).totalLiquid;
}

const reserveRowToInput = (row: any): ReserveInput => ({
  id: row.id,
  name: row.name,
  category: row.category,
  amount: Number(row.amount ?? 0),
  releasedAmount: Number(row.released_amount ?? 0),
  status: row.status,
  expectedReleaseDate: row.expected_release_date ?? null,
  availableToUse: row.available_to_use === true
});

// ── GET /api/cash-flow/reserves ───────────────────────────
router.get("/reserves", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const today = lagosDayOf(new Date().toISOString());
    const [{ data: rows }, liquid] = await Promise.all([
      supabase.from("cash_reserves").select("*").eq("org_id", orgId)
        .order("created_at", { ascending: false }).limit(REPORT_ROW_CEILING),
      totalLiquidCash(orgId)
    ]);
    const reserves = ((rows ?? []) as any[]);
    const inputs = reserves.map(reserveRowToInput);
    const summary = summariseReserves(inputs, liquid);

    res.json({
      reserves: reserves.map((row) => {
        const input = reserveRowToInput(row);
        return {
          id: row.id,
          refCode: row.ref_code,
          name: row.name,
          purpose: row.purpose ?? "",
          bankAccountId: row.bank_account_id ?? null,
          accountLabel: row.account_label ?? "",
          amount: Number(row.amount ?? 0),
          releasedAmount: Number(row.released_amount ?? 0),
          outstanding: Math.max(Number(row.amount ?? 0) - Number(row.released_amount ?? 0), 0),
          availableToUse: row.available_to_use === true,
          expectedReleaseDate: row.expected_release_date ?? null,
          category: row.category,
          status: row.status,
          displayStatus: reserveDisplayStatus(input, today),
          createdByName: row.created_by_name ?? "",
          createdAt: row.created_at
        };
      }),
      summary,
      breakdown: reserveBreakdown(inputs),
      insights: reserveInsights(inputs, summary, today),
      upcoming: upcomingReleases(inputs, today, 30),
      today
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load reserves." });
  }
});

const ReserveSchema = z.object({
  name: z.string().trim().min(1, "Give the reserve a name.").max(80),
  purpose: z.string().trim().max(200).default(""),
  bankAccountId: z.string().uuid().nullable().optional(),
  amount: z.coerce.number().positive("A reserve has to be more than ₦0.").max(1_000_000_000_000),
  availableToUse: z.boolean().default(false),
  expectedReleaseDate: z.string().regex(DATE_KEY).nullable().optional(),
  category: z.enum(["payroll", "tax", "supplier", "advertising", "emergency", "owner", "other"]).default("other")
}).strict();

// ── POST /api/cash-flow/reserves ──────────────────────────
router.post("/reserves", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = ReserveSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const body = parsed.data;
    const today = lagosDayOf(new Date().toISOString());

    const [{ data: codes }, { data: account }, { data: actor }] = await Promise.all([
      supabase.from("cash_reserves").select("ref_code").eq("org_id", orgId).limit(REPORT_ROW_CEILING),
      body.bankAccountId
        ? supabase.from("bank_accounts").select("name").eq("id", body.bankAccountId).eq("org_id", orgId).maybeSingle()
        : Promise.resolve({ data: null } as any),
      supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle()
    ]);

    const { data, error } = await supabase.from("cash_reserves").insert({
      org_id: orgId,
      ref_code: nextReserveRef(((codes ?? []) as any[]).map((row) => row.ref_code), today),
      name: body.name,
      purpose: body.purpose,
      bank_account_id: body.bankAccountId ?? null,
      account_label: String(account?.name ?? "").trim(),
      amount: body.amount,
      available_to_use: body.availableToUse,
      expected_release_date: body.expectedReleaseDate ?? null,
      category: body.category,
      created_by: req.user!.id,
      created_by_name: String(actor?.name ?? "").trim() || "Unknown"
    }).select("id, ref_code").single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({ id: data.id, refCode: data.ref_code });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not create that reserve." });
  }
});

// ── PATCH /api/cash-flow/reserves/:id ─────────────────────
router.patch("/reserves/:id", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = ReserveSchema.partial().safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const body = parsed.data;

    const { data: existing } = await supabase.from("cash_reserves")
      .select("released_amount").eq("id", req.params.id).eq("org_id", orgId).maybeSingle();
    if (!existing) { res.status(404).json({ error: "That reserve no longer exists." }); return; }
    // Shrinking a reserve below what has already been let out would break the
    // running total, so it is refused rather than silently clamped.
    if (body.amount !== undefined && body.amount < Number(existing.released_amount ?? 0)) {
      res.status(400).json({
        error: `₦${Math.round(Number(existing.released_amount)).toLocaleString("en-NG")} has already been released from this reserve, so it cannot be reduced below that.`
      });
      return;
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) patch.name = body.name;
    if (body.purpose !== undefined) patch.purpose = body.purpose;
    if (body.amount !== undefined) patch.amount = body.amount;
    if (body.availableToUse !== undefined) patch.available_to_use = body.availableToUse;
    if (body.expectedReleaseDate !== undefined) patch.expected_release_date = body.expectedReleaseDate ?? null;
    if (body.category !== undefined) patch.category = body.category;
    if (body.bankAccountId !== undefined) {
      patch.bank_account_id = body.bankAccountId ?? null;
      const { data: account } = body.bankAccountId
        ? await supabase.from("bank_accounts").select("name").eq("id", body.bankAccountId).eq("org_id", orgId).maybeSingle()
        : { data: null } as any;
      patch.account_label = String(account?.name ?? "").trim();
    }

    const { error } = await supabase.from("cash_reserves").update(patch)
      .eq("id", req.params.id).eq("org_id", orgId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not update that reserve." });
  }
});

const ReleaseSchema = z.object({
  amount: z.coerce.number().positive("Release more than ₦0.").max(1_000_000_000_000),
  note: z.string().trim().max(200).default("")
}).strict();

// ── POST /api/cash-flow/reserves/:id/release ──────────────
router.post("/reserves/:id/release", requireRole("Owner"), async (req, res) => {
  try {
    const parsed = ReleaseSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
    const orgId = req.user!.orgId;
    const { data: actor } = await supabase.from("users").select("name").eq("id", req.user!.id).maybeSingle();

    // ⚠️ One statement. Read-modify-write here would let two concurrent
    // releases each read the same figure and both succeed, letting more out of
    // a reserve than it ever held. The CHECK constraint refuses the second.
    const { data: remaining, error } = await supabase.rpc("release_cash_reserve", {
      p_reserve_id: req.params.id,
      p_org_id: orgId,
      p_amount: parsed.data.amount,
      p_note: parsed.data.note,
      p_released_by: req.user!.id,
      p_released_by_name: String(actor?.name ?? "").trim() || "Unknown"
    });
    if (error) {
      const overRelease = /cash_reserves_released_check/.test(error.message ?? "");
      res.status(overRelease ? 400 : 500).json({
        error: overRelease
          ? "That is more than this reserve still holds."
          : error.message
      });
      return;
    }
    res.json({ remaining: Number(remaining ?? 0) });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not release that reserve." });
  }
});

// ── DELETE /api/cash-flow/reserves/:id ────────────────────
router.delete("/reserves/:id", requireRole("Owner"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: existing } = await supabase.from("cash_reserves")
      .select("released_amount").eq("id", req.params.id).eq("org_id", orgId).maybeSingle();
    if (!existing) { res.status(404).json({ error: "That reserve no longer exists." }); return; }

    // A reserve that has released money is part of the audit trail, so it is
    // cancelled rather than deleted - the releases must stay traceable.
    if (Number(existing.released_amount ?? 0) > 0) {
      const { error } = await supabase.from("cash_reserves")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", req.params.id).eq("org_id", orgId);
      if (error) { res.status(500).json({ error: error.message }); return; }
      res.json({ ok: true, cancelled: true });
      return;
    }

    const { error } = await supabase.from("cash_reserves")
      .delete().eq("id", req.params.id).eq("org_id", orgId);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ ok: true, cancelled: false });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not remove that reserve." });
  }
});

export default router;
