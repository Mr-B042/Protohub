// Pieces Sold (Product Trend › Stock Intelligence › Overview, Bright 24 Nov 2026).
// "How many pieces of each product did we sell each day, in each state, by
// each agent?" for any date range.
//
// Sold = DELIVERED (pay on delivery: a piece is sold when it is delivered),
// counted on the order's delivered_date. Each order counts under its MAIN
// product only; free gifts, cross-sells, extras and other package parts are
// sent apart as `extras` and shown inside the main product, never as products
// of their own (Bright, 24 Nov 2026). See stock-sold-model.ts.
// State = the order's state; agent = the order's delivery agent (inactive
// agents included - past sales still happened). Silent-test orders are left
// out, as everywhere else in Product Trend.

import { supabase } from "./supabase.js";
import { orderInventoryLinesBySource } from "./order-inventory.js";
import { lagosTodayKey } from "./salary-spread.js";
import { tidyOrderState } from "./order-state.js";
import { fetchAllRowsOrThrow, REPORT_ROW_CEILING } from "./query-limits.js";
import { daysBetweenKeys, shiftDay } from "./stock-intel-model.js";
import { loadHubStock } from "./state-restock.js";
import { tidyState, waybillItems } from "./stock-intel-data.js";
import { stockTotals } from "./state-restock-model.js";

export const MAX_SOLD_RANGE_DAYS = 400;

export { buildSold, type SoldDay, type SoldExtra, type SoldLine, type SoldOrderCell, type SoldRow } from "./stock-sold-model.js";
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
  // Restock = waybills FROM the warehouse (no sending hub; Bright: "our restock
  // comes from the Lagos warehouse") dispatched in the loaded dates. Hub-to-hub
  // waybills only move stock around, so they are not restock. Cancelled ones
  // never left. Received = arrived; In Transit = on the way.
  const restockRes = supabase.from("waybill_records")
    .select("status, items, product_id, product_name, quantity, to_agent_location_id, to_agent_id, agent_id, dispatched_date")
    .eq("org_id", args.orgId).eq("branch_id", args.branchId).is("from_agent_location_id", null)
    .in("status", ["Received", "In Transit"]).gte("dispatched_date", from).lte("dispatched_date", to)
    .limit(REPORT_ROW_CEILING);
  const hubsRes = supabase.from("agent_locations").select("id, agent_id, state").eq("branch_id", args.branchId).limit(REPORT_ROW_CEILING);
  const [rows, agentsRes, hubStock, restockRows, hubRows] = await Promise.all([
    fetchAllRowsOrThrow<SoldRow>(() => supabase.from("orders").select(fields)
      .eq("org_id", args.orgId).eq("branch_id", args.branchId).neq("launch_stage", "silent")
      .eq("status", "Delivered").gte("delivered_date", from).lte("delivered_date", to)
      .order("id", { ascending: true }) as any),
    supabase.from("agents").select("id, name").eq("org_id", args.orgId).eq("branch_id", args.branchId).limit(REPORT_ROW_CEILING),
    loadHubStock(args.orgId, args.branchId),
    restockRes.then((r) => { if (r.error) throw new Error(`Could not load waybills: ${r.error.message}`); return r.data ?? []; }),
    hubsRes.then((r) => { if (r.error) throw new Error(`Could not load agent hubs: ${r.error.message}`); return r.data ?? []; })
  ]);
  const hubOf = new Map(hubRows.map((h: any) => [String(h.id), { agentId: String(h.agent_id ?? ""), state: tidyState(h.state) }]));
  const restock = restockRows.flatMap((w: any) => {
    const hub = w.to_agent_location_id ? hubOf.get(String(w.to_agent_location_id)) : undefined;
    const agentId = hub?.agentId || String(w.to_agent_id ?? w.agent_id ?? "");
    return waybillItems(w)
      .filter((item) => !args.productId || item.productId === args.productId)
      .map((item) => ({ day: String(w.dispatched_date).slice(0, 10), productId: item.productId, state: hub?.state ?? "", agentId, pieces: item.quantity, arrived: w.status === "Received" }));
  });
  if (agentsRes.error) throw new Error(`Could not load agents: ${agentsRes.error.message}`);
  const productIds = args.productId ? new Set([args.productId]) : null;
  const built = buildSold(rows, (row) => orderInventoryLinesBySource(row as any).map((l) => ({ productId: l.productId, quantity: Number(l.quantity) || 0, sourceType: l.sourceType, isFreeGift: l.isFreeGift })), { start: from, end: to, productIds, tidyState: (state) => String(tidyOrderState(state) ?? "") });
  const used = new Set(built.lines.map((l) => l.agentId));
  // Stock RIGHT NOW (not tied to the date range), per state x agent x product,
  // so the page can total it for whatever products are picked (Bright, 26 Nov).
  const stock = [...stockTotals(hubStock.filter((row) => !productIds || productIds.has(row.productId)), (row) => `${row.state}::${row.agentId}::${row.productId}`)]
    .map(([key, total]) => { const [state, agentId, productId] = key.split("::"); return { state, agentId, productId, left: total.left, onTheWay: total.onTheWay }; });
  return {
    today, start, end, from, to,
    ...built,
    stock,
    restock,
    agents: (agentsRes.data ?? []).filter((a: any) => used.has(String(a.id))).map((a: any) => ({ id: String(a.id), name: String(a.name ?? "Delivery agent") }))
  };
}
