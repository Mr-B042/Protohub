// Shared derivations for the Inventory & Logistics Operations sub-pages.
//
// Stock by Product, Stock by State, Stock by Agent, State/Order Coverage and
// Restock Forecast are five views of the same question. They must not each
// invent their own arithmetic - the whole failure mode this replaces is a
// screen saying a state has stock while its orders sit unfulfillable.
//
// So the definitions live here, once:
//
//   reserved   units on orders that are placed but not delivered/cancelled/failed
//   available  warehouse + agent-held - reserved
//   dailySales delivered units over the Owner's own lookback window
//   coverDays  available / dailySales, Infinity when nothing is selling
//
// In-transit is never folded into available: it cannot be sold today.
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";

export const CLOSED_ORDER_STATES = new Set(["delivered", "cancelled", "failed"]);
export const norm = (value?: string) => String(value ?? "").trim().toLowerCase();
export const num = (value: number) => Math.max(0, Math.round(value)).toLocaleString("en-NG");
export const money = (value: number) => `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;
export const coverText = (days: number) => (Number.isFinite(days) ? `${Math.round(days * 10) / 10}` : "-");

export type StockStatus = "Healthy" | "Watch" | "Restock Soon" | "Critical";

export function statusFor(coverDays: number, hasDemand: boolean, criticalDays: number, watchDays: number): StockStatus {
  if (!hasDemand) return "Healthy";
  if (coverDays <= criticalDays) return "Critical";
  if (coverDays <= watchDays) return "Restock Soon";
  if (coverDays <= watchDays * 1.5) return "Watch";
  return "Healthy";
}

export const statusTone = (status: StockStatus) =>
  status === "Critical" ? "bg-rose-50 text-rose-700"
    : status === "Restock Soon" ? "bg-orange-50 text-orange-700"
      : status === "Watch" ? "bg-amber-50 text-amber-700"
        : "bg-emerald-50 text-emerald-700";

export const statusText = (status: StockStatus) =>
  status === "Critical" ? "text-rose-600"
    : status === "Restock Soon" ? "text-orange-600"
      : status === "Watch" ? "text-amber-600" : "text-emerald-600";

/** Units heading into each state on a waybill that has not been received. */
export function inTransitByState(waybills: OpsWaybill[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const waybill of waybills) {
    if (norm(waybill.status) !== "in transit") continue;
    const to = String(waybill.to ?? "").trim();
    if (!to) continue;
    const units = waybill.items?.length
      ? waybill.items.reduce((sum, item) => sum + Math.max(0, item.quantity), 0)
      : Math.max(0, waybill.quantity);
    out.set(to, (out.get(to) ?? 0) + units);
  }
  return out;
}

export type StateRow = {
  state: string;
  agents: number;
  totalUnits: number;
  unitsByProductId: Map<string, number>;
  dailySales: number;
  openOrders: number;
  openUnits: number;
  inTransit: number;
  available: number;
  coverDays: number;
  status: StockStatus;
};

export function buildStateRows(
  stateHubs: OpsStateHub[],
  orders: OpsOrder[],
  waybills: OpsWaybill[],
  lookbackDays: number,
  criticalDays: number,
  watchDays: number
): StateRow[] {
  const transit = inTransitByState(waybills);
  const byState = new Map<string, { units: Map<string, number>; agents: Set<string> }>();
  for (const hub of stateHubs) {
    const bucket = byState.get(hub.state) ?? { units: new Map<string, number>(), agents: new Set<string>() };
    bucket.agents.add(hub.agentId ?? hub.agentName);
    for (const stock of hub.stocks) {
      bucket.units.set(stock.productId, (bucket.units.get(stock.productId) ?? 0) + Math.max(0, stock.quantity));
    }
    byState.set(hub.state, bucket);
  }

  const sold = new Map<string, number>();
  const openCount = new Map<string, number>();
  const openUnits = new Map<string, number>();
  for (const order of orders) {
    const state = String(order.state ?? "").trim();
    if (!state) continue;
    const status = norm(order.status);
    if (status === "delivered") {
      sold.set(state, (sold.get(state) ?? 0) + Math.max(0, order.quantity));
    } else if (!CLOSED_ORDER_STATES.has(status)) {
      openCount.set(state, (openCount.get(state) ?? 0) + 1);
      openUnits.set(state, (openUnits.get(state) ?? 0) + Math.max(0, order.quantity));
    }
  }

  const states = new Set<string>([...byState.keys(), ...openCount.keys()]);
  return Array.from(states).map((state) => {
    const bucket = byState.get(state);
    const totalUnits = Array.from(bucket?.units.values() ?? []).reduce((sum, value) => sum + value, 0);
    const reserved = openUnits.get(state) ?? 0;
    const available = Math.max(0, totalUnits - reserved);
    const dailySales = Math.round(((sold.get(state) ?? 0) / Math.max(1, lookbackDays)) * 10) / 10;
    const coverDays = dailySales > 0 ? available / dailySales : Number.POSITIVE_INFINITY;
    return {
      state,
      agents: bucket?.agents.size ?? 0,
      totalUnits,
      unitsByProductId: bucket?.units ?? new Map<string, number>(),
      dailySales,
      openOrders: openCount.get(state) ?? 0,
      openUnits: reserved,
      inTransit: transit.get(state) ?? 0,
      available,
      coverDays,
      status: statusFor(coverDays, dailySales > 0, criticalDays, watchDays)
    };
  }).sort((a, b) => b.totalUnits - a.totalUnits);
}

export type ProductRow = {
  id: string;
  name: string;
  category: string;
  totalStock: number;
  dailySales: number;
  coverDays: number;
  status: StockStatus;
  reserved: number;
  available: number;
  /** The state that runs out first - the one that decides urgency. */
  shortestState: { state: string; coverDays: number } | null;
  unitsNeeded14d: number;
  /** Delivered units per day over the window, oldest first, for the trend line. */
  trend: number[];
};

export function buildProductRows(
  products: OpsProduct[],
  stateRows: StateRow[],
  orders: OpsOrder[],
  lookbackDays: number,
  criticalDays: number,
  watchDays: number
): ProductRow[] {
  const sold = new Map<string, number>();
  const reserved = new Map<string, number>();
  const dailyByProduct = new Map<string, number[]>();
  const dayIndex = (iso?: string) => {
    if (!iso) return -1;
    const then = Date.parse(String(iso).slice(0, 10));
    if (Number.isNaN(then)) return -1;
    const days = Math.floor((Date.now() - then) / 86_400_000);
    return days >= 0 && days < lookbackDays ? lookbackDays - 1 - days : -1;
  };
  for (const order of orders) {
    if (!order.productId) continue;
    const status = norm(order.status);
    if (status === "delivered") {
      sold.set(order.productId, (sold.get(order.productId) ?? 0) + Math.max(0, order.quantity));
      const slot = dayIndex(order.createdAt);
      if (slot >= 0) {
        const series = dailyByProduct.get(order.productId) ?? Array.from({ length: lookbackDays }, () => 0);
        series[slot] += Math.max(0, order.quantity);
        dailyByProduct.set(order.productId, series);
      }
    } else if (!CLOSED_ORDER_STATES.has(status)) {
      reserved.set(order.productId, (reserved.get(order.productId) ?? 0) + Math.max(0, order.quantity));
    }
  }

  return products.map((product) => {
    const totalStock = product.warehouseStock + product.agentStock;
    const held = reserved.get(product.id) ?? 0;
    const available = Math.max(0, totalStock - held);
    const dailySales = Math.round(((sold.get(product.id) ?? 0) / Math.max(1, lookbackDays)) * 10) / 10;
    const coverDays = dailySales > 0 ? available / dailySales : Number.POSITIVE_INFINITY;

    // Which state runs out first for this product. Network cover can look
    // comfortable while one state is already empty - that state is the one
    // that loses the order, so it drives the priority.
    let shortest: { state: string; coverDays: number } | null = null;
    for (const row of stateRows) {
      const units = row.unitsByProductId.get(product.id) ?? 0;
      if (row.dailySales <= 0 || row.totalUnits <= 0) continue;
      // That product's share of the state's run rate.
      const share = (units / row.totalUnits) * row.dailySales;
      const stateCover = share > 0 ? units / share : Number.POSITIVE_INFINITY;
      if (!shortest || stateCover < shortest.coverDays) shortest = { state: row.state, coverDays: stateCover };
    }

    return {
      id: product.id,
      name: product.name,
      category: product.category ?? "Uncategorised",
      totalStock,
      dailySales,
      coverDays,
      status: statusFor(coverDays, dailySales > 0, criticalDays, watchDays),
      reserved: held,
      available,
      shortestState: shortest,
      // What the next fortnight needs beyond what is already on hand.
      unitsNeeded14d: Math.max(0, Math.ceil(dailySales * 14) - available),
      trend: dailyByProduct.get(product.id) ?? Array.from({ length: lookbackDays }, () => 0)
    };
  }).sort((a, b) => a.coverDays - b.coverDays || b.dailySales - a.dailySales);
}
