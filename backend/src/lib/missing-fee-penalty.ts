import { supabase } from "./supabase.js";
import { addDaysToDateKey, weekEndFromStart } from "./sales-bonus-engine.js";

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

export type MissingFeeOrder = {
  orderId: string; deliveredDate: string;
  customer: string; phone: string; state: string; city: string;
  product: string; quantity: number; amount: number;
  agentName: string | null;
  /** Who marked it Delivered, and when (from the order history). */
  deliveredBy: string | null; deliveredAt: string | null;
  /** What this agent usually charges for this state (middle of the last 90 days' fees), when known. */
  usualFee: number | null; usualFeeFrom: number;
};
export type MissingFeeWeek = { orders: MissingFeeOrder[] };

const middle = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

/** Per rep: orders delivered in this week whose delivery fee is still blank or 0. */
export async function missingFeesFor(orgId: string, weekStart: string) {
  const { data, error } = await supabase.from("orders")
    .select("id, assigned_rep_id, delivered_date, logistics_cost, customer, phone, state, city, product_name, quantity, amount, agent_id, agent_name_snapshot").neq("launch_stage", "silent")
    .eq("org_id", orgId).eq("status", "Delivered").not("assigned_rep_id", "is", null)
    .gte("delivered_date", weekStart).lte("delivered_date", weekEndFromStart(weekStart))
    .order("delivered_date", { ascending: true })
    .limit(5000);
  if (error) throw error;
  const missing = (data ?? []).filter((order: any) => !(Number(order.logistics_cost ?? 0) > 0));
  const out: Record<string, MissingFeeWeek> = {};
  if (missing.length === 0) return out;

  const ids = missing.map((order: any) => String(order.id));
  const agentIds = [...new Set(missing.map((order: any) => order.agent_id).filter(Boolean).map(String))];
  const since = addDaysToDateKey(weekStart, -90);
  const [agents, fees, history] = await Promise.all([
    agentIds.length ? supabase.from("agents").select("id, name").in("id", agentIds) : Promise.resolve({ data: [], error: null }),
    // The agent's recent fees, to show what this order should have cost.
    agentIds.length
      ? supabase.from("orders").select("agent_id, state, logistics_cost").neq("launch_stage", "silent").eq("org_id", orgId).eq("status", "Delivered")
        .in("agent_id", agentIds).gt("logistics_cost", 0).gte("delivered_date", since).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("order_audit").select("order_id, changed_by, to_status, created_at")
      .eq("org_id", orgId).in("order_id", ids).eq("to_status", "Delivered").order("created_at", { ascending: false }).limit(5000)
  ]);
  if (agents.error) throw agents.error;
  if (fees.error) throw fees.error;
  if (history.error) throw history.error;

  const agentName = new Map((agents.data ?? []).map((row: any) => [String(row.id), String(row.name ?? "")]));
  const feeLists = new Map<string, number[]>();
  for (const row of fees.data ?? []) {
    const key = `${row.agent_id}|${String(row.state ?? "").toLowerCase()}`;
    (feeLists.get(key) ?? feeLists.set(key, []).get(key)!).push(Number(row.logistics_cost));
  }
  const markedBy = new Map<string, { by: string | null; at: string }>();
  for (const row of history.data ?? []) {
    if (!markedBy.has(String(row.order_id))) markedBy.set(String(row.order_id), { by: row.changed_by ? String(row.changed_by) : null, at: String(row.created_at) });
  }
  const userIds = [...new Set([...markedBy.values()].map((row) => row.by).filter((id): id is string => !!id))];
  const users = userIds.length ? await supabase.from("users").select("id, name").in("id", userIds) : { data: [], error: null };
  if (users.error) throw users.error;
  const userName = new Map((users.data ?? []).map((row: any) => [String(row.id), String(row.name ?? "")]));

  for (const order of missing as any[]) {
    const repId = String(order.assigned_rep_id);
    const feeList = feeLists.get(`${order.agent_id}|${String(order.state ?? "").toLowerCase()}`) ?? [];
    const marked = markedBy.get(String(order.id));
    (out[repId] ?? (out[repId] = { orders: [] })).orders.push({
      orderId: String(order.id), deliveredDate: String(order.delivered_date),
      customer: String(order.customer ?? ""), phone: String(order.phone ?? ""),
      state: String(order.state ?? ""), city: String(order.city ?? ""),
      product: String(order.product_name ?? ""), quantity: Number(order.quantity ?? 0), amount: Number(order.amount ?? 0),
      agentName: (order.agent_id && agentName.get(String(order.agent_id))) || order.agent_name_snapshot || null,
      deliveredBy: marked?.by ? userName.get(marked.by) ?? null : null, deliveredAt: marked?.at ?? null,
      usualFee: middle(feeList), usualFeeFrom: feeList.length
    });
  }
  return out;
}
