// Pieces Sold (Product Trend › Stock Intelligence › Overview, Bright 24 Nov 2026).
// "How many pieces of each product did we sell each day, in each state, by
// each agent?" for any date range.
//
// Sold = DELIVERED (pay on delivery: a piece is sold when it is delivered),
// counted on the order's delivered_date. Pieces come from the same line
// expansion stock uses (orderInventoryLinesFromRow), so a 3-piece package
// counts as its pieces, and cross-sell / extra / gift lines count too.
// State = the order's state; agent = the order's delivery agent (inactive
// agents included - past sales still happened). Silent-test orders are left
// out, as everywhere else in Product Trend.

import { supabase } from "./supabase.js";
import { orderInventoryLinesFromRow } from "./order-inventory.js";
import { lagosTodayKey } from "./salary-spread.js";
import { tidyOrderState } from "./order-state.js";
import { fetchAllRowsOrThrow, REPORT_ROW_CEILING } from "./query-limits.js";
import { daysBetweenKeys, shiftDay } from "./stock-intel-model.js";

export const MAX_SOLD_RANGE_DAYS = 400;

export { buildSold, type SoldDay, type SoldLine, type SoldOrderCell, type SoldRow } from "./stock-sold-model.js";
import { buildSold, type SoldRow } from "./stock-sold-model.js";

const validKey = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const firstOfLastMonth = (today: string) => {
  const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export async function loadStockSold(args: { orgId: string; branchId: string; start?: unknown; end?: unknown; productId?: string | null }) {
  const today = lagosTodayKey();
  let start = validKey(args.start) ? String(args.start) : today;
  let end = validKey(args.end) ? String(args.end) : today;
  if (end < start) [start, end] = [end, start];
  if (daysBetweenKeys(start, end) + 1 > MAX_SOLD_RANGE_DAYS) start = shiftDay(end, -(MAX_SOLD_RANGE_DAYS - 1));
  // Load enough for the quick-range chips too (Today … Last Month), in one read.
  // Every loaded day is sent, so the page can count the chips with its own
  // product / state / agent filters applied.
  const from = [start, firstOfLastMonth(today), shiftDay(today, -13)].sort()[0];
  const to = [end, today].sort()[1];

  const fields = "id, product_id, product_name, quantity, delivered_date, state, agent_id, package_components_snapshot, cross_sell_lines, additional_lines, free_gift_lines";
  const [rows, agentsRes] = await Promise.all([
    fetchAllRowsOrThrow<SoldRow>(() => supabase.from("orders").select(fields)
      .eq("org_id", args.orgId).eq("branch_id", args.branchId).neq("launch_stage", "silent")
      .eq("status", "Delivered").gte("delivered_date", from).lte("delivered_date", to)
      .order("id", { ascending: true }) as any),
    supabase.from("agents").select("id, name").eq("org_id", args.orgId).eq("branch_id", args.branchId).limit(REPORT_ROW_CEILING)
  ]);
  if (agentsRes.error) throw new Error(`Could not load agents: ${agentsRes.error.message}`);
  const productIds = args.productId ? new Set([args.productId]) : null;
  const built = buildSold(rows, (row) => orderInventoryLinesFromRow(row as any).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) || 0 })), { start: from, end: to, productIds, tidyState: (state) => String(tidyOrderState(state) ?? "") });
  const used = new Set(built.lines.map((l) => l.agentId));
  return {
    today, start, end, from, to,
    ...built,
    agents: (agentsRes.data ?? []).filter((a: any) => used.has(String(a.id))).map((a: any) => ({ id: String(a.id), name: String(a.name ?? "Delivery agent") }))
  };
}
