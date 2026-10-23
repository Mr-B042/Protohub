import { supabase } from "./supabase.js";
import { weekEndFromStart } from "./sales-bonus-engine.js";

// ── Delivered orders with no delivery fee: a reminder, not a fine ───────────
// Bright, 23 Oct 2026: the system no longer fines reps ₦500 for these. The
// weekly report only LISTS them for Manager / Admin / Owner, who charge by
// hand if they want to (Change payout on the review, or Penalties). Nothing
// here writes to rep_penalties and nothing is taken off any payout.
//
// The 4 charges made by the old automatic rule (week of 11 Oct) are still in
// rep_penalties as type MISSING_FEE_TYPE. Keep that type out of the rep's
// fines (finesForWeek) so those reports do not change after they were sent.

export const MISSING_FEE_TYPE = "missing_delivery_fee";

export type MissingFeeOrder = { orderId: string; deliveredDate: string };
export type MissingFeeWeek = { orders: MissingFeeOrder[] };

/** Per rep: orders delivered in this week whose delivery fee is still blank or 0. */
export async function missingFeesFor(orgId: string, weekStart: string) {
  const { data, error } = await supabase.from("orders")
    .select("id, assigned_rep_id, delivered_date, logistics_cost")
    .eq("org_id", orgId).eq("status", "Delivered").not("assigned_rep_id", "is", null)
    .gte("delivered_date", weekStart).lte("delivered_date", weekEndFromStart(weekStart))
    .order("delivered_date", { ascending: true })
    .limit(5000);
  if (error) throw error;
  const out: Record<string, MissingFeeWeek> = {};
  for (const order of data ?? []) {
    if (Number(order.logistics_cost ?? 0) > 0) continue;
    const repId = String(order.assigned_rep_id);
    (out[repId] ?? (out[repId] = { orders: [] })).orders.push({ orderId: String(order.id), deliveredDate: String(order.delivered_date) });
  }
  return out;
}
