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
    return { amount: drift, anchored: false, anchor: null as any };
  }

  const drift = await netBetween(orgId, anchor.effective_at, periodStartIso);
  return {
    amount: Number(anchor.amount ?? 0) + drift,
    anchored: true,
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
async function loadAllMovements(orgId: string) {
  const [{ data: remits }, { data: spends }] = await Promise.all([
    supabase.from("remittance_transactions")
      .select("bank_account_id, delta_amount").eq("org_id", orgId).limit(REPORT_ROW_CEILING),
    supabase.from("expenses")
      .select("bank_account_id, amount").eq("org_id", orgId).limit(REPORT_ROW_CEILING)
  ]);
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

export default router;
