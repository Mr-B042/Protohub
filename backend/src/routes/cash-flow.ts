import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";
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
// Money in and out of the business - the same audience as Finance & Accounting.
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

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

export default router;
