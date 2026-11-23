// Loads one branch's rows for Stock Intelligence and runs the model
// (stock-intel-model.ts). Used by routes/stock-intel.ts (the tab) and
// stock-intel-alerts.ts (the hourly alerts), so both see the same figures.
//
// Every query names the branch itself: the alert job has no request scope,
// so branchScopedFetch would not filter it.

import { supabase } from "./supabase.js";
import { orderInventoryLinesFromRow } from "./order-inventory.js";
import { lagosTodayKey } from "./salary-spread.js";
import { tidyOrderState } from "./order-state.js";
import { REPORT_ROW_CEILING } from "./query-limits.js";
import {
  buildStockIntel, daysBetweenKeys, shiftDay,
  type IntelDelivery, type IntelHub, type IntelInbound, type IntelLeadSample, type IntelReserve, type IntelResult, type IntelRoute, type IntelSetting
} from "./stock-intel-model.js";

/** How far back deliveries are read: long enough for a 28-day window and its streaks. */
const DELIVERY_LOOKBACK_DAYS = 60;
const LEAD_LOOKBACK_DAYS = 180;
const MOVEMENT_DAYS = 60;
/** Open orders already promised to a hub (they will take its stock). */
export const RESERVING_STATUSES = ["Confirmed", "In Process", "Dispatched", "Postponed"];

export type IntelProduct = { id: string; name: string; warehouse: number };
export type IntelWaybill = {
  id: string; status: string; toLocationId: string | null; toAgentId: string | null; fromLocationId: string | null;
  toLabel: string; fromLabel: string; dispatched: string | null; received: string | null; createdAt: string;
  items: Array<{ productId: string; productName: string; quantity: number }>;
};
export type IntelDecision = { id: string; productId: string; status: string; units: number; proposedAt: string; decidedAt: string | null; proposedBy: string | null };

export type StockIntelData = {
  today: string;
  windowDays: number;
  result: IntelResult;
  products: IntelProduct[];
  hubs: Array<{ locationId: string; agentId: string; agentName: string; hubName: string; state: string }>;
  routes: IntelRoute[];
  settings: Array<IntelSetting & { id: string }>;
  waybills: IntelWaybill[];
  decisions: IntelDecision[];
  /** Orders placed in the window per state: how many, how many delivered (Distribution Performance). */
  outcomes: Array<{ state: string; orders: number; delivered: number }>;
  /** Hub x product received in the last 60 days (Stock Movements). */
  received: Array<{ locationId: string; productId: string; units: number }>;
};

const tidyState = (value: string | null | undefined) => String(tidyOrderState((value ?? "").trim().replace(/\s+/g, " ")) ?? "");
const num = (value: unknown) => Math.max(0, Number(value ?? 0) || 0);

type WaybillItem = { productId: string; productName: string; quantity: number };
function waybillItems(row: any): WaybillItem[] {
  if (Array.isArray(row.items) && row.items.length > 0) {
    return row.items
      .map((item: any) => ({ productId: String(item.product_id ?? item.productId ?? ""), productName: String(item.product_name ?? item.productName ?? ""), quantity: num(item.quantity) }))
      .filter((item: WaybillItem) => item.productId && item.quantity > 0);
  }
  return row.product_id ? [{ productId: String(row.product_id), productName: String(row.product_name ?? ""), quantity: num(row.quantity) }] : [];
}

export async function loadStockIntel(args: { orgId: string; branchId: string; windowDays: number; productId?: string | null }): Promise<StockIntelData> {
  const { orgId, branchId } = args;
  const windowDays = Math.min(28, Math.max(7, Math.round(args.windowDays) || 7));
  const today = lagosTodayKey();
  const deliveredSince = shiftDay(today, -(DELIVERY_LOOKBACK_DAYS - 1));
  const leadSince = shiftDay(today, -LEAD_LOOKBACK_DAYS);
  const movementSince = shiftDay(today, -MOVEMENT_DAYS);
  const check = <T>(label: string, result: { data: T | null; error: { message: string } | null }): T => {
    if (result.error) throw new Error(`Could not load ${label}: ${result.error.message}`);
    return (result.data ?? []) as T;
  };

  const [agentsRes, productsRes, routesRes, settingsRes] = await Promise.all([
    supabase.from("agents").select("id, name, status").eq("org_id", orgId).eq("branch_id", branchId).limit(REPORT_ROW_CEILING),
    supabase.from("products").select("id, name, warehouse_stock").eq("org_id", orgId).eq("branch_id", branchId).limit(REPORT_ROW_CEILING),
    supabase.from("stock_supply_routes").select("id, dest_state, product_id, source_state, priority").eq("org_id", orgId).eq("branch_id", branchId).limit(REPORT_ROW_CEILING),
    supabase.from("stock_lead_time_settings").select("id, agent_location_id, product_id, lead_time_days, safety_days").eq("org_id", orgId).eq("branch_id", branchId).limit(REPORT_ROW_CEILING)
  ]);
  const agents = check<any[]>("agents", agentsRes).filter((agent) => String(agent.status ?? "Active") === "Active");
  const agentName = new Map(agents.map((agent) => [String(agent.id), String(agent.name ?? "Delivery agent")]));
  const products: IntelProduct[] = check<any[]>("products", productsRes).map((p) => ({ id: String(p.id), name: String(p.name ?? "Product"), warehouse: num(p.warehouse_stock) }));
  const routes: IntelRoute[] = check<any[]>("supply routes", routesRes).map((r) => ({
    id: String(r.id), destState: tidyState(r.dest_state), productId: r.product_id ? String(r.product_id) : null,
    sourceState: r.source_state ? tidyState(r.source_state) : null, priority: Number(r.priority ?? 1)
  }));
  const settings = check<any[]>("lead time settings", settingsRes).map((s) => ({
    id: String(s.id), locationId: s.agent_location_id ? String(s.agent_location_id) : null, productId: s.product_id ? String(s.product_id) : null,
    leadTimeDays: s.lead_time_days == null ? null : Number(s.lead_time_days), safetyDays: s.safety_days == null ? null : Number(s.safety_days)
  }));

  const agentIds = [...agentName.keys()];
  const locationsRes = agentIds.length === 0 ? { data: [], error: null } : await supabase
    .from("agent_locations")
    .select("id, agent_id, name, state, active, stock:agent_location_stock(product_id, quantity, defective, missing)")
    .eq("branch_id", branchId).in("agent_id", agentIds).eq("active", true).limit(REPORT_ROW_CEILING);
  const locations = check<any[]>("agent hubs", locationsRes as any);
  const hubs: IntelHub[] = locations.map((loc) => ({
    locationId: String(loc.id), agentId: String(loc.agent_id), agentName: agentName.get(String(loc.agent_id)) ?? "Delivery agent",
    hubName: String(loc.name ?? ""), state: tidyState(loc.state),
    stock: new Map<string, { quantity: number; defective: number; missing: number }>((loc.stock ?? []).map((s: any) => [String(s.product_id), { quantity: num(s.quantity), defective: num(s.defective), missing: num(s.missing) }] as [string, { quantity: number; defective: number; missing: number }]))
  })).filter((hub) => hub.state);
  const hubIds = new Set(hubs.map((hub) => hub.locationId));
  const hubsByAgent = new Map<string, string[]>();
  for (const hub of hubs) hubsByAgent.set(hub.agentId, [...(hubsByAgent.get(hub.agentId) ?? []), hub.locationId]);
  // An order without a hub on a multi-hub agent is not guessed onto one.
  const hubOfOrder = (row: any) => {
    const explicit = row.agent_location_id && hubIds.has(String(row.agent_location_id)) ? String(row.agent_location_id) : "";
    if (explicit) return explicit;
    const list = row.agent_id ? hubsByAgent.get(String(row.agent_id)) ?? [] : [];
    return list.length === 1 ? list[0] : "";
  };

  const orderFields = "id, product_id, product_name, quantity, status, delivered_date, agent_id, agent_location_id, package_components_snapshot, cross_sell_lines, additional_lines, free_gift_lines";
  const windowStart = shiftDay(today, -(windowDays - 1));
  const [deliveredRes, openRes, waybillRes, decisionsRes, cohortRes] = await Promise.all([
    supabase.from("orders").select(orderFields).eq("org_id", orgId).eq("branch_id", branchId).neq("launch_stage", "silent")
      .eq("status", "Delivered").gte("delivered_date", deliveredSince).lte("delivered_date", today).limit(REPORT_ROW_CEILING),
    supabase.from("orders").select(orderFields).eq("org_id", orgId).eq("branch_id", branchId).neq("launch_stage", "silent")
      .in("status", RESERVING_STATUSES).limit(REPORT_ROW_CEILING),
    supabase.from("waybill_records")
      .select("id, status, items, product_id, product_name, quantity, agent_id, to_agent_location_id, from_agent_location_id, from_location, to_location, dispatched_date, received_date, created_at")
      .eq("org_id", orgId).eq("branch_id", branchId)
      .or(`status.eq."In Transit",created_at.gte."${leadSince}T00:00:00Z"`)
      .order("created_at", { ascending: false }).limit(REPORT_ROW_CEILING),
    supabase.from("stock_allocation_decisions").select("id, product_id, status, final_lines, proposed_at, decided_at, proposed_by_name")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("proposed_at", `${movementSince}T00:00:00Z`).limit(REPORT_ROW_CEILING),
    supabase.from("orders").select("state, status").eq("org_id", orgId).eq("branch_id", branchId).neq("launch_stage", "silent")
      .gte("created_at", `${windowStart}T00:00:00+01:00`).limit(REPORT_ROW_CEILING)
  ]);
  const outcomeMap = new Map<string, { orders: number; delivered: number }>();
  for (const row of check<any[]>("orders of the period", cohortRes)) {
    const state = tidyState(row.state);
    if (!state) continue;
    const entry = outcomeMap.get(state) ?? { orders: 0, delivered: 0 };
    entry.orders += 1;
    if (row.status === "Delivered") entry.delivered += 1;
    outcomeMap.set(state, entry);
  }

  const deliveries: IntelDelivery[] = [];
  for (const row of check<any[]>("delivered orders", deliveredRes)) {
    const locationId = hubOfOrder(row);
    const dayKey = String(row.delivered_date ?? "").slice(0, 10);
    if (!locationId || !dayKey) continue;
    for (const line of orderInventoryLinesFromRow(row)) deliveries.push({ locationId, productId: line.productId, units: num(line.quantity), dayKey, orderId: String(row.id) });
  }
  const reserves: IntelReserve[] = [];
  for (const row of check<any[]>("open orders", openRes)) {
    const locationId = hubOfOrder(row);
    if (!locationId) continue;
    for (const line of orderInventoryLinesFromRow(row)) reserves.push({ locationId, productId: line.productId, units: num(line.quantity), orderId: String(row.id) });
  }

  const hubLabel = new Map(hubs.map((hub) => [hub.locationId, hub.hubName && hub.hubName !== hub.agentName ? `${hub.agentName} (${hub.hubName})` : hub.agentName]));
  const inbound: IntelInbound[] = [];
  const leadSamples: IntelLeadSample[] = [];
  const waybills: IntelWaybill[] = [];
  const receivedMap = new Map<string, number>();
  for (const row of check<any[]>("waybills", waybillRes)) {
    const toLocationId = row.to_agent_location_id ? String(row.to_agent_location_id) : null;
    const items = waybillItems(row);
    const status = String(row.status ?? "");
    const dispatched = row.dispatched_date ? String(row.dispatched_date).slice(0, 10) : null;
    const received = row.received_date ? String(row.received_date).slice(0, 10) : null;
    if (status === "In Transit" && toLocationId && hubIds.has(toLocationId)) for (const item of items) inbound.push({ locationId: toLocationId, productId: item.productId, units: item.quantity });
    if (status === "Received" && toLocationId && dispatched && received) leadSamples.push({ locationId: toLocationId, days: daysBetweenKeys(dispatched, received), receivedKey: received });
    if (status === "Received" && toLocationId && received && received >= movementSince) {
      for (const item of items) receivedMap.set(`${toLocationId}::${item.productId}`, (receivedMap.get(`${toLocationId}::${item.productId}`) ?? 0) + item.quantity);
    }
    const created = String(row.created_at ?? "");
    if (status === "In Transit" || created.slice(0, 10) >= movementSince) {
      waybills.push({
        id: String(row.id), status, toLocationId, toAgentId: row.agent_id ? String(row.agent_id) : null,
        fromLocationId: row.from_agent_location_id ? String(row.from_agent_location_id) : null,
        toLabel: (toLocationId && hubLabel.get(toLocationId)) || String(row.to_location ?? "—"),
        fromLabel: (row.from_agent_location_id && hubLabel.get(String(row.from_agent_location_id))) || String(row.from_location ?? "Main warehouse"),
        dispatched, received, createdAt: created, items
      });
    }
  }
  const decisions: IntelDecision[] = check<any[]>("stock decisions", decisionsRes).map((d) => ({
    id: String(d.id), productId: String(d.product_id), status: String(d.status),
    units: (Array.isArray(d.final_lines) ? d.final_lines : []).reduce((sum: number, line: any) => sum + num(line?.units), 0),
    proposedAt: String(d.proposed_at ?? ""), decidedAt: d.decided_at ? String(d.decided_at) : null, proposedBy: d.proposed_by_name ? String(d.proposed_by_name) : null
  }));

  const productIds = args.productId ? new Set([args.productId]) : null;
  const result = buildStockIntel({
    today, windowDays, hubs, deliveries, reserves, inbound, leadSamples, routes, settings,
    warehouse: new Map(products.map((p) => [p.id, p.warehouse])), productIds
  });
  return {
    today, windowDays, result, products,
    hubs: hubs.map(({ locationId, agentId, agentName: name, hubName, state }) => ({ locationId, agentId, agentName: name, hubName, state })),
    routes, settings, waybills, decisions,
    outcomes: [...outcomeMap].map(([state, v]) => ({ state, ...v })),
    received: [...receivedMap].map(([key, units]) => { const [locationId, productId] = key.split("::"); return { locationId, productId, units }; })
      .filter((row) => !productIds || productIds.has(row.productId))
  };
}
