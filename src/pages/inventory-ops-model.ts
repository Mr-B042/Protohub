// Shared, auditable inventory arithmetic for every Inventory & Logistics view.
// Physical stock, committed demand and stock in transit remain separate so a
// screen cannot make an unavailable unit look sellable.
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";

export const CLOSED_ORDER_STATES = new Set(["delivered", "cancelled", "failed"]);
export const norm = (value?: string) => String(value ?? "").trim().toLowerCase();
export const num = (value: number) => Math.max(0, Math.round(value)).toLocaleString("en-NG");
export const money = (value: number) => `₦${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;
export const coverText = (days: number) => (Number.isFinite(days) ? `${Math.round(days * 10) / 10}` : "-");
export const runRateText = (units: number) => `${Math.round(Math.max(0, units) * 10) / 10}`;

export const canonicalStateKey = (value?: string) => {
  const key = norm(value)
    .replace(/\bnigeria\b/g, "")
    .replace(/\bstate\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
  if (["abuja", "fct", "fctabuja", "federalcapitalterritory"].includes(key)) return "fct";
  return key;
};

const stateLabel = (value?: string) => {
  const key = canonicalStateKey(value);
  if (key === "fct") return "FCT Abuja";
  const clean = String(value ?? "").replace(/,?\s*Nigeria\s*$/i, "").trim();
  return clean || "Unassigned";
};

export type StockStatus = "Healthy" | "Watch" | "Restock Soon" | "Critical" | "No Data";

export function statusFor(coverDays: number, hasDemand: boolean, criticalDays: number, watchDays: number): StockStatus {
  if (!hasDemand) return "No Data";
  if (coverDays <= criticalDays) return "Critical";
  if (coverDays <= watchDays) return "Restock Soon";
  if (coverDays <= watchDays * 1.5) return "Watch";
  return "Healthy";
}

export const statusTone = (status: StockStatus) =>
  status === "Critical" ? "bg-rose-50 text-rose-700"
    : status === "Restock Soon" ? "bg-orange-50 text-orange-700"
      : status === "Watch" ? "bg-amber-50 text-amber-700"
        : status === "No Data" ? "bg-gray-100 text-gray-600"
          : "bg-emerald-50 text-emerald-700";

export const statusText = (status: StockStatus) =>
  status === "Critical" ? "text-rose-600"
    : status === "Restock Soon" ? "text-orange-600"
      : status === "Watch" ? "text-amber-600"
        : status === "No Data" ? "text-gray-500" : "text-emerald-600";

export const inventoryLinesForOrder = (order: OpsOrder) => {
  const lines = new Map<string, number>();
  const source = order.inventoryItems?.length
    ? order.inventoryItems
    : order.productId ? [{ productId: order.productId, quantity: order.quantity }] : [];
  for (const line of source) {
    const quantity = Math.max(0, Number(line.quantity) || 0);
    if (!line.productId || quantity <= 0) continue;
    lines.set(line.productId, (lines.get(line.productId) ?? 0) + quantity);
  }
  return Array.from(lines, ([productId, quantity]) => ({ productId, quantity }));
};

export const waybillInventoryLines = (waybill: OpsWaybill) => {
  const source = waybill.items?.length
    ? waybill.items
    : [{ productId: waybill.productId, productName: waybill.productName, quantity: waybill.quantity }];
  return source
    .map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantity: Math.max(0, Number(line.quantity) || 0)
    }))
    .filter((line) => line.quantity > 0);
};

export const isInTransitWaybill = (waybill: OpsWaybill) =>
  ["in transit", "picked up", "shipped", "sent"].includes(norm(waybill.status));

export const orderEventDate = (order: OpsOrder) => order.deliveredAt || order.createdAt;
export const isInsideWindow = (iso: string | undefined, days: number) => {
  if (!iso) return false;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return false;
  const age = Date.now() - time;
  return age >= -86_400_000 && age < Math.max(1, days) * 86_400_000;
};

/** Units heading into each state on a waybill that has not been received. */
export function inTransitByState(waybills: OpsWaybill[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const waybill of waybills) {
    if (!isInTransitWaybill(waybill)) continue;
    const key = canonicalStateKey(waybill.toState || waybill.to);
    if (!key) continue;
    const units = waybillInventoryLines(waybill).reduce((sum, line) => sum + line.quantity, 0);
    out.set(key, (out.get(key) ?? 0) + units);
  }
  return out;
}

export type StateRow = {
  key: string;
  state: string;
  agents: number;
  totalUnits: number;
  unitsByProductId: Map<string, number>;
  dailySalesByProductId: Map<string, number>;
  openUnitsByProductId: Map<string, number>;
  inTransitByProductId: Map<string, number>;
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
  watchDays: number,
  includedProductIds?: ReadonlySet<string>
): StateRow[] {
  type StateBucket = {
    label: string;
    units: Map<string, number>;
    agents: Set<string>;
    delivered: Map<string, number>;
    open: Map<string, number>;
    openOrderIds: Set<OpsOrder>;
    transit: Map<string, number>;
  };
  const buckets = new Map<string, StateBucket>();
  const bucketFor = (raw: string | undefined) => {
    const key = canonicalStateKey(raw);
    if (!key) return null;
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: StateBucket = {
      label: stateLabel(raw), units: new Map(), agents: new Set(), delivered: new Map(),
      open: new Map(), openOrderIds: new Set(), transit: new Map()
    };
    buckets.set(key, created);
    return created;
  };

  for (const hub of stateHubs) {
    const stocks = includedProductIds
      ? hub.stocks.filter((stock) => includedProductIds.has(stock.productId))
      : hub.stocks;
    if (includedProductIds && stocks.length === 0) continue;
    const bucket = bucketFor(hub.state);
    if (!bucket) continue;
    bucket.agents.add(hub.agentId ?? hub.agentName);
    for (const stock of stocks) {
      bucket.units.set(stock.productId, (bucket.units.get(stock.productId) ?? 0) + Math.max(0, stock.quantity));
    }
  }

  for (const order of orders) {
    const lines = inventoryLinesForOrder(order).filter((line) => !includedProductIds || includedProductIds.has(line.productId));
    if (includedProductIds && lines.length === 0) continue;
    const bucket = bucketFor(order.state || order.location);
    if (!bucket) continue;
    const status = norm(order.status);
    if (status === "delivered" && isInsideWindow(orderEventDate(order), lookbackDays)) {
      for (const line of lines) bucket.delivered.set(line.productId, (bucket.delivered.get(line.productId) ?? 0) + line.quantity);
    } else if (!CLOSED_ORDER_STATES.has(status)) {
      bucket.openOrderIds.add(order);
      for (const line of lines) bucket.open.set(line.productId, (bucket.open.get(line.productId) ?? 0) + line.quantity);
    }
  }

  for (const waybill of waybills) {
    if (!isInTransitWaybill(waybill)) continue;
    const lines = waybillInventoryLines(waybill).filter((line) => !includedProductIds || (!!line.productId && includedProductIds.has(line.productId)));
    if (includedProductIds && lines.length === 0) continue;
    const bucket = bucketFor(waybill.toState || waybill.to);
    if (!bucket) continue;
    for (const line of lines) {
      const productId = line.productId || `name:${norm(line.productName)}`;
      bucket.transit.set(productId, (bucket.transit.get(productId) ?? 0) + line.quantity);
    }
  }

  return Array.from(buckets.entries()).map(([key, bucket]) => {
    const totalUnits = Array.from(bucket.units.values()).reduce((sum, value) => sum + value, 0);
    const openUnits = Array.from(bucket.open.values()).reduce((sum, value) => sum + value, 0);
    const inTransit = Array.from(bucket.transit.values()).reduce((sum, value) => sum + value, 0);
    const deliveredUnits = Array.from(bucket.delivered.values()).reduce((sum, value) => sum + value, 0);
    const dailySales = deliveredUnits / Math.max(1, lookbackDays);
    const dailySalesByProductId = new Map(Array.from(bucket.delivered, ([id, units]) => [id, units / Math.max(1, lookbackDays)]));
    const available = Math.max(0, totalUnits - openUnits);
    const coverDays = dailySales > 0 ? available / dailySales : Number.POSITIVE_INFINITY;
    return {
      key, state: bucket.label, agents: bucket.agents.size, totalUnits,
      unitsByProductId: bucket.units,
      dailySalesByProductId,
      openUnitsByProductId: bucket.open,
      inTransitByProductId: bucket.transit,
      dailySales, openOrders: bucket.openOrderIds.size, openUnits, inTransit, available, coverDays,
      status: openUnits > 0 && available <= 0
        ? "Critical"
        : statusFor(coverDays, dailySales > 0, criticalDays, watchDays)
    };
  }).sort((a, b) => b.totalUnits - a.totalUnits || a.state.localeCompare(b.state));
}

export type ProductRow = {
  id: string;
  name: string;
  category: string;
  warehouse: number;
  agents: number;
  inTransit: number;
  totalStock: number;
  dailySales: number;
  coverDays: number;
  status: StockStatus;
  reserved: number;
  available: number;
  shortestState: { state: string; coverDays: number } | null;
  stateNeeds14d: Array<{ state: string; units: number }>;
  unitsNeeded14d: number;
  trend: number[];
};

export function buildProductRows(
  products: OpsProduct[],
  stateRows: StateRow[],
  orders: OpsOrder[],
  lookbackDays: number,
  criticalDays: number,
  watchDays: number,
  waybills: OpsWaybill[] = []
): ProductRow[] {
  const sold = new Map<string, number>();
  const reserved = new Map<string, number>();
  const dailyByProduct = new Map<string, number[]>();
  const productIdByName = new Map(products.map((product) => [norm(product.name), product.id]));
  const transit = new Map<string, number>();
  const dayIndex = (iso?: string) => {
    if (!iso) return -1;
    const then = Date.parse(iso);
    if (!Number.isFinite(then)) return -1;
    const days = Math.floor((Date.now() - then) / 86_400_000);
    return days >= 0 && days < lookbackDays ? lookbackDays - 1 - days : -1;
  };

  for (const order of orders) {
    const status = norm(order.status);
    const lines = inventoryLinesForOrder(order);
    if (status === "delivered" && isInsideWindow(orderEventDate(order), lookbackDays)) {
      const slot = dayIndex(orderEventDate(order));
      for (const line of lines) {
        sold.set(line.productId, (sold.get(line.productId) ?? 0) + line.quantity);
        if (slot >= 0) {
          const series = dailyByProduct.get(line.productId) ?? Array.from({ length: lookbackDays }, () => 0);
          series[slot] += line.quantity;
          dailyByProduct.set(line.productId, series);
        }
      }
    } else if (!CLOSED_ORDER_STATES.has(status)) {
      for (const line of lines) reserved.set(line.productId, (reserved.get(line.productId) ?? 0) + line.quantity);
    }
  }

  for (const waybill of waybills) {
    if (!isInTransitWaybill(waybill)) continue;
    for (const line of waybillInventoryLines(waybill)) {
      const productId = line.productId || productIdByName.get(norm(line.productName));
      if (productId) transit.set(productId, (transit.get(productId) ?? 0) + line.quantity);
    }
  }

  return products.map((product) => {
    const totalStock = product.warehouseStock + product.agentStock;
    const held = reserved.get(product.id) ?? 0;
    const available = Math.max(0, totalStock - held);
    const dailySales = (sold.get(product.id) ?? 0) / Math.max(1, lookbackDays);
    const coverDays = dailySales > 0 ? available / dailySales : Number.POSITIVE_INFINITY;
    let shortest: { state: string; coverDays: number } | null = null;
    const stateNeeds14d: Array<{ state: string; units: number }> = [];

    for (const row of stateRows) {
      const stateDaily = row.dailySalesByProductId.get(product.id) ?? 0;
      if (stateDaily <= 0) continue;
      const stateAvailable = Math.max(0, (row.unitsByProductId.get(product.id) ?? 0) - (row.openUnitsByProductId.get(product.id) ?? 0));
      const stateTransit = row.inTransitByProductId.get(product.id) ?? 0;
      const stateCover = stateAvailable / stateDaily;
      if (!shortest || stateCover < shortest.coverDays) shortest = { state: row.state, coverDays: stateCover };
      const needed = Math.max(0, Math.ceil(stateDaily * 14 - stateAvailable - stateTransit));
      if (needed > 0) stateNeeds14d.push({ state: row.state, units: needed });
    }

    return {
      id: product.id,
      name: product.name,
      category: product.category ?? "Uncategorised",
      warehouse: product.warehouseStock,
      agents: product.agentStock,
      inTransit: transit.get(product.id) ?? 0,
      totalStock,
      dailySales,
      coverDays,
      status: held > 0 && available <= 0
        ? "Critical"
        : statusFor(coverDays, dailySales > 0, criticalDays, watchDays),
      reserved: held,
      available,
      shortestState: shortest,
      stateNeeds14d: stateNeeds14d.sort((a, b) => b.units - a.units),
      unitsNeeded14d: Math.max(0, Math.ceil(dailySales * 14 - available - (transit.get(product.id) ?? 0))),
      trend: dailyByProduct.get(product.id) ?? Array.from({ length: lookbackDays }, () => 0)
    };
  }).sort((a, b) => a.coverDays - b.coverDays || b.dailySales - a.dailySales);
}

export function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  if (rows.length === 0 || typeof document === "undefined") return;
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const body = [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header] ?? "")).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
