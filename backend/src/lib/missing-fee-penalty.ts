import { supabase } from "./supabase.js";
import { addDaysToDateKey, weekEndFromStart } from "./sales-bonus-engine.js";
import { carryMissingFees } from "./missing-fee-carry.js";

// ── ₦500 per delivered order with no delivery fee (Bright, 20 Oct 2026) ─────
// When a rep SENDS a weekly report, every order of theirs that was delivered
// up to the end of that week with no delivery fee, and was never charged
// before, is charged ₦500 on THAT report. That covers the week's own orders
// and any older one a locked week missed ("charged for the next weekly
// report"). Once charged it stays, even if the fee is typed in later.
// Failed deliveries are left out (not every failed delivery has a fee).
//
// ⚠️ HIDDEN FROM THE REP. The rows live in rep_penalties (so payroll takes
// them off like every other fine) but weekly-reports leaves this type out of
// the rep's fines; only Manager / Admin / Owner get them, laid over the rep's
// submitted figures on their screens. The rep's snapshot is never rewritten.

export const MISSING_FEE_TYPE = "missing_delivery_fee";
export const MISSING_FEE_AMOUNT = 500;
/** Orders delivered before this are never charged (Bright asked from 4 Oct). */
export const MISSING_FEE_FROM = "2026-10-04";

export type MissingFeeCharge = { id: string; orderId: string; amount: number; reason: string; chargedAt: string };
export type MissingFeeWeek = { charges: MissingFeeCharge[]; total: number; carried: number };

/** Charge the rep's uncharged no-fee deliveries on this week's report. Returns how many. */
export async function chargeMissingFees(args: { orgId: string; branchId: string; repId: string; repName: string; weekStart: string }) {
  const { orgId, branchId, repId, repName, weekStart } = args;
  const weekEnd = weekEndFromStart(weekStart);
  const { data: orders, error } = await supabase.from("orders")
    .select("id, delivered_date, logistics_cost")
    .eq("org_id", orgId).eq("assigned_rep_id", repId).eq("status", "Delivered")
    .gte("delivered_date", MISSING_FEE_FROM).lte("delivered_date", weekEnd)
    .limit(5000);
  if (error) throw error;
  const noFee = (orders ?? []).filter((order: any) => !(Number(order.logistics_cost ?? 0) > 0));
  if (noFee.length === 0) return 0;
  // In batches: a long .in() list is refused as "URI too long".
  const already = new Set<string>();
  const ids = noFee.map((order: any) => String(order.id));
  for (let i = 0; i < ids.length; i += 200) {
    const { data: charged, error: chargedError } = await supabase.from("rep_penalties")
      .select("order_id").eq("org_id", orgId).eq("type", MISSING_FEE_TYPE).in("order_id", ids.slice(i, i + 200));
    if (chargedError) throw chargedError;
    for (const row of charged ?? []) already.add(String(row.order_id));
  }
  // Payroll month = the month the report week's Saturday falls in (as payout changes).
  const period = weekEnd.slice(0, 7);
  let added = 0;
  for (const order of noFee) {
    const orderId = String(order.id);
    if (already.has(orderId)) continue;
    const { error: insertError } = await supabase.from("rep_penalties").insert({
      org_id: orgId, branch_id: branchId, rep_id: repId, rep_name: repName,
      type: MISSING_FEE_TYPE, amount: MISSING_FEE_AMOUNT, remove_all_bonuses: false,
      period, week_start: weekStart, order_id: orderId,
      reason: `Order #${orderId} delivered ${order.delivered_date} with no delivery fee`,
      by_name: "System (weekly report)"
    });
    // 23505 = charged a moment ago by a second submit; one charge per order.
    if (insertError && insertError.code !== "23505") throw insertError;
    if (!insertError) added += 1;
  }
  return added;
}

/** Per rep: this week's charges and what earlier weeks left unpaid. */
export async function missingFeesFor(orgId: string, branchId: string, repIds: string[] | null, weekStart: string) {
  let chargeQuery = supabase.from("rep_penalties")
    .select("id, rep_id, order_id, amount, reason, week_start, created_at")
    .eq("org_id", orgId).eq("type", MISSING_FEE_TYPE)
    .gte("week_start", MISSING_FEE_FROM).lte("week_start", weekStart)
    .order("created_at", { ascending: true }).limit(5000);
  if (repIds) chargeQuery = chargeQuery.in("rep_id", repIds);
  const { data: rows, error } = await chargeQuery;
  if (error) throw error;
  const out: Record<string, MissingFeeWeek> = {};
  const earlierWeeks = new Set<string>();
  for (const row of rows ?? []) {
    const repId = String(row.rep_id);
    if (row.week_start === weekStart) {
      const week = out[repId] ?? (out[repId] = { charges: [], total: 0, carried: 0 });
      const amount = Number(row.amount ?? 0);
      week.charges.push({ id: row.id, orderId: String(row.order_id ?? ""), amount, reason: row.reason ?? "", chargedAt: row.created_at });
      week.total += amount;
    } else {
      earlierWeeks.add(String(row.week_start));
    }
  }
  if (earlierWeeks.size === 0) return out;

  // Earlier weeks: what each rep would have been paid (submitted figure plus
  // any manager payout change), to see how much of the charges it covered.
  const first = [...earlierWeeks].sort()[0];
  const weeks: string[] = [];
  for (let week = first; week < weekStart; week = addDaysToDateKey(week, 7)) weeks.push(week);
  let reportQuery = supabase.from("rep_weekly_reports").select("rep_id, week_start, status, snapshot")
    .eq("org_id", orgId).eq("branch_id", branchId).gte("week_start", first).lt("week_start", weekStart);
  let changeQuery = supabase.from("weekly_report_payout_changes").select("rep_id, week_start, amount")
    .eq("org_id", orgId).eq("branch_id", branchId).gte("week_start", first).lt("week_start", weekStart);
  if (repIds) { reportQuery = reportQuery.in("rep_id", repIds); changeQuery = changeQuery.in("rep_id", repIds); }
  const [reports, changes] = await Promise.all([reportQuery, changeQuery]);
  if (reports.error) throw reports.error;
  if (changes.error) throw changes.error;
  const payable = new Map<string, number>();
  for (const row of reports.data ?? []) {
    if (row.status === "draft") continue;
    payable.set(`${row.rep_id}|${row.week_start}`, Number((row.snapshot as any)?.totals?.finalBonus ?? 0));
  }
  for (const row of changes.data ?? []) {
    const key = `${row.rep_id}|${row.week_start}`;
    payable.set(key, Math.max(0, (payable.get(key) ?? 0) + Number(row.amount ?? 0)));
  }
  const chargesByKey = new Map<string, number>();
  const reps = new Set<string>();
  for (const row of rows ?? []) {
    if (row.week_start === weekStart) continue;
    const key = `${row.rep_id}|${row.week_start}`;
    chargesByKey.set(key, (chargesByKey.get(key) ?? 0) + Number(row.amount ?? 0));
    reps.add(String(row.rep_id));
  }
  for (const repId of reps) {
    const carried = carryMissingFees(weeks.map((week) => ({
      charges: chargesByKey.get(`${repId}|${week}`) ?? 0,
      payable: payable.get(`${repId}|${week}`) ?? 0
    })));
    if (carried > 0) {
      const week = out[repId] ?? (out[repId] = { charges: [], total: 0, carried: 0 });
      week.carried = carried;
    }
  }
  return out;
}
