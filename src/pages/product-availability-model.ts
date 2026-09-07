// Product Availability - where a product already sits, who holds it, and how
// much of it is genuinely sellable.
//
// ⚠️ SELLABLE NOW IS THE ONLY NUMBER THAT MATTERS HERE, and it is not "stock".
// Bright: "set the default rule to only count stock that is actually available,
// excluding reserved stock, pending deductions, damaged stock and in-transit
// stock. That way marketing never pushes a product because the dashboard says
// 20 when only 4 are genuinely sellable."
//
// So four things come off the hub balance:
//
//   damaged / missing  - already removed upstream, where stocks[] is built as
//                        quantity - defective - missing.
//   reserved           - units committed to orders that have not closed.
//   pending deduction  - DELIVERED but not yet reconciled by the Inventory
//                        Officer. Physically gone, still sitting in the balance
//                        until the queue is worked. Missing this would be the
//                        worst of the four: it counts stock that has already
//                        left the building.
//   in transit         - never in the hub balance to begin with, so it is
//                        reported separately as Incoming and never added in.
import type { OpsOrder, OpsProduct, OpsStateHub, OpsWaybill } from "./InventoryLogisticsOperationsPage";
import { CLOSED_ORDER_STATES, canonicalStateKey, inventoryLinesForOrder, isInTransitWaybill, norm, waybillInventoryLines } from "./inventory-ops-model";

/** One agent's position on one product. */
export type AvailabilityCell = {
  productId: string;
  productName: string;
  category: string;
  agentId: string;
  agentName: string;
  locationId: string;
  city: string;
  state: string;
  active: boolean;
  onHand: number;
  reserved: number;
  pendingDeduction: number;
  incoming: number;
  openOrders: number;
  /** On hand, less everything already spoken for. Never below zero. */
  available: number;
};

/** A delivered line waiting on the Inventory Officer. */
export type PendingDeductionLine = {
  agentLocationId: string;
  productId: string;
  quantity: number;
  status: string;
};

const addTo = (map: Map<string, number>, key: string, value: number) =>
  map.set(key, (map.get(key) ?? 0) + value);

export function buildAvailabilityCells(
  products: OpsProduct[],
  hubs: OpsStateHub[],
  orders: OpsOrder[],
  waybills: OpsWaybill[],
  pendingLines: PendingDeductionLine[] = []
): AvailabilityCell[] {
  const productById = new Map(products.map((product) => [product.id, product]));

  // Reserved and open-order counts, keyed by the agent LOCATION that will ship
  // them - the same key the stock itself is held under.
  const reserved = new Map<string, number>();
  const openOrderKeys = new Map<string, Set<OpsOrder>>();
  for (const order of orders) {
    if (CLOSED_ORDER_STATES.has(norm(order.status))) continue;
    const locationId = order.assignedAgentLocationId ?? "";
    if (!locationId) continue;
    for (const line of inventoryLinesForOrder(order)) {
      const key = `${locationId}::${line.productId}`;
      addTo(reserved, key, line.quantity);
      const bucket = openOrderKeys.get(key);
      if (bucket) bucket.add(order); else openOrderKeys.set(key, new Set([order]));
    }
  }

  // Stock on its way in. Not sellable, but worth showing next to what is.
  const incoming = new Map<string, number>();
  for (const waybill of waybills) {
    if (!isInTransitWaybill(waybill)) continue;
    const locationId = waybill.toAgentLocationId ?? "";
    if (!locationId) continue;
    for (const line of waybillInventoryLines(waybill)) {
      if (!line.productId) continue;
      addTo(incoming, `${locationId}::${line.productId}`, line.quantity);
    }
  }

  // Delivered, not yet reconciled. Still in the balance, already out the door.
  const pending = new Map<string, number>();
  for (const line of pendingLines) {
    if (line.status !== "pending" && line.status !== "exception") continue;
    addTo(pending, `${line.agentLocationId}::${line.productId}`, Math.max(0, line.quantity));
  }

  const cells: AvailabilityCell[] = [];
  for (const hub of hubs) {
    const locationId = hub.locationId ?? "";
    for (const stock of hub.stocks) {
      const onHand = Math.max(0, stock.quantity);
      const key = `${locationId}::${stock.productId}`;
      const cellReserved = reserved.get(key) ?? 0;
      const cellPending = pending.get(key) ?? 0;
      const cellIncoming = incoming.get(key) ?? 0;
      const available = Math.max(0, onHand - cellReserved - cellPending);
      // A hub with nothing on hand and nothing inbound is not a row worth
      // showing - it would pad every product with dozens of empty agents.
      if (onHand <= 0 && cellIncoming <= 0) continue;
      const product = productById.get(stock.productId);
      cells.push({
        productId: stock.productId,
        productName: product?.name ?? "Unknown product",
        category: product?.category ?? "Standard",
        agentId: hub.agentId ?? hub.agentName,
        agentName: hub.agentName,
        locationId,
        city: hub.city ?? "",
        state: hub.state,
        active: hub.active !== false,
        onHand,
        reserved: cellReserved,
        pendingDeduction: cellPending,
        incoming: cellIncoming,
        openOrders: openOrderKeys.get(key)?.size ?? 0,
        available
      });
    }
  }
  return cells;
}

export type Opportunity = "High" | "Medium" | "Low";

/**
 * How worth pushing a product is.
 *
 * Reach first, depth second: a product sitting with 18 agents across 9 states
 * can be advertised nationally without moving a box, which is the decision this
 * page exists to support. Depth alone would rank a single warehouse pile top.
 */
export function opportunityFor(states: number, agents: number, available: number): Opportunity {
  if (available <= 0) return "Low";
  if (states >= 5 && agents >= 8) return "High";
  if (states >= 3 && agents >= 4) return "Medium";
  return "Low";
}

export type ProductAvailabilityRow = {
  productId: string;
  productName: string;
  category: string;
  states: number;
  agents: number;
  available: number;
  onHand: number;
  reserved: number;
  pendingDeduction: number;
  incoming: number;
  openOrders: number;
  opportunity: Opportunity;
};

export function productRows(cells: AvailabilityCell[]): ProductAvailabilityRow[] {
  const byProduct = new Map<string, AvailabilityCell[]>();
  for (const cell of cells) {
    const bucket = byProduct.get(cell.productId);
    if (bucket) bucket.push(cell); else byProduct.set(cell.productId, [cell]);
  }
  return [...byProduct.entries()]
    .map(([productId, group]) => {
      // Only places with something sellable count towards reach - a state whose
      // every unit is reserved cannot carry an advert.
      const sellable = group.filter((cell) => cell.available > 0);
      const states = new Set(sellable.map((cell) => canonicalStateKey(cell.state) || norm(cell.state)));
      const agents = new Set(sellable.map((cell) => cell.agentId));
      const available = group.reduce((sum, cell) => sum + cell.available, 0);
      return {
        productId,
        productName: group[0].productName,
        category: group[0].category,
        states: states.size,
        agents: agents.size,
        available,
        onHand: group.reduce((sum, cell) => sum + cell.onHand, 0),
        reserved: group.reduce((sum, cell) => sum + cell.reserved, 0),
        pendingDeduction: group.reduce((sum, cell) => sum + cell.pendingDeduction, 0),
        incoming: group.reduce((sum, cell) => sum + cell.incoming, 0),
        openOrders: group.reduce((sum, cell) => sum + cell.openOrders, 0),
        opportunity: opportunityFor(states.size, agents.size, available)
      };
    })
    .sort((a, b) => b.available - a.available || a.productName.localeCompare(b.productName));
}

export type StateAvailabilityRow = {
  state: string;
  key: string;
  products: number;
  agents: number;
  available: number;
  openOrders: number;
};

export function stateRowsFor(cells: AvailabilityCell[]): StateAvailabilityRow[] {
  const byState = new Map<string, AvailabilityCell[]>();
  for (const cell of cells) {
    const key = canonicalStateKey(cell.state) || norm(cell.state);
    const bucket = byState.get(key);
    if (bucket) bucket.push(cell); else byState.set(key, [cell]);
  }
  return [...byState.entries()]
    .map(([key, group]) => ({
      key,
      state: group[0].state,
      products: new Set(group.filter((cell) => cell.available > 0).map((cell) => cell.productId)).size,
      agents: new Set(group.map((cell) => cell.agentId)).size,
      available: group.reduce((sum, cell) => sum + cell.available, 0),
      openOrders: group.reduce((sum, cell) => sum + cell.openOrders, 0)
    }))
    .sort((a, b) => b.available - a.available || a.state.localeCompare(b.state));
}

export type CrossSellRow = {
  agentId: string;
  agentName: string;
  locationId: string;
  state: string;
  city: string;
  products: number;
  available: number;
  potential: Opportunity;
  lines: AvailabilityCell[];
};

/**
 * Agents holding more than one sellable product.
 *
 * ⚠️ SELLABLE LINES ONLY. The whole point is "this agent is already delivering
 * to that customer, what else can go in the same trip" - a product whose every
 * unit is reserved or already delivered-but-unreconciled cannot go in the van,
 * so counting it would put an offer in a rep's mouth that stock cannot honour.
 */
export function crossSellRows(cells: AvailabilityCell[]): CrossSellRow[] {
  const byAgent = new Map<string, AvailabilityCell[]>();
  for (const cell of cells) {
    if (cell.available <= 0) continue;
    const key = cell.locationId || cell.agentId;
    const bucket = byAgent.get(key);
    if (bucket) bucket.push(cell); else byAgent.set(key, [cell]);
  }
  return [...byAgent.values()]
    .filter((group) => group.length >= 2)
    .map((group) => {
      const available = group.reduce((sum, cell) => sum + cell.available, 0);
      const products = group.length;
      return {
        agentId: group[0].agentId,
        agentName: group[0].agentName,
        locationId: group[0].locationId,
        state: group[0].state,
        city: group[0].city,
        products,
        available,
        potential: (products >= 4 ? "High" : products >= 3 ? "Medium" : "Low") as Opportunity,
        lines: [...group].sort((a, b) => b.available - a.available)
      };
    })
    .sort((a, b) => b.products - a.products || b.available - a.available);
}
