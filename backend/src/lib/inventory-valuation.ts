// Inventory Value: how much cash is tied up in stock.
//
// ⚠️ Valued AT COST, never at what it might sell for. Stock is money already
// spent; counting it at retail would book profit that has not been earned and
// would flatter the cash position of a business whose stock may never move.
// Retail value is carried alongside, clearly labelled as an estimate.

export type StockCondition = "healthy" | "slow_moving" | "at_risk" | "damaged";

export const STOCK_CONDITIONS: StockCondition[] = ["healthy", "slow_moving", "at_risk", "damaged"];

export const STOCK_CONDITION_LABEL: Record<StockCondition, string> = {
  healthy: "Healthy",
  slow_moving: "Slow Moving",
  at_risk: "At Risk",
  damaged: "Damaged / Obsolete"
};

export type ProductStockInput = {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  catalogType: string;
  warehouseUnits: number;
  agentUnits: number;
  damagedUnits: number;
  unitCost: number;
  sellingPrice: number;
  reorderPoint: number;
  /** Units fulfilled from this product over the look-back window. */
  unitsSoldRecently: number;
  /** Net unit change across the reporting week. */
  weekTrend: number;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Good stock currently held by agents. Warehouse/global stock is deliberately
 * excluded from this report: this view measures inventory available through
 * assigned agents, not the company's central reserve.
 */
export function sellableUnits(row: ProductStockInput): number {
  return Math.max(num(row.agentUnits) - num(row.damagedUnits), 0);
}

/**
 * What condition a product's stock is in.
 *
 * ⚠️ Ordered worst-first and returns on the first match, so a product that is
 * both damaged and below reorder point reports the more serious of the two.
 * Reversing this order would let a genuine problem hide behind a milder label.
 */
export function stockCondition(row: ProductStockInput): StockCondition {
  if (num(row.damagedUnits) > 0 && sellableUnits(row) === 0) return "damaged";
  const units = sellableUnits(row);
  if (units === 0) return "at_risk";
  if (num(row.reorderPoint) > 0 && units <= num(row.reorderPoint)) return "at_risk";
  // Stock that has not moved at all over the window is capital sitting still.
  if (num(row.unitsSoldRecently) === 0) return "slow_moving";
  return "healthy";
}

export type ValuedProduct = {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  catalogType: string;
  units: number;
  damagedUnits: number;
  unitCost: number;
  costValue: number;
  retailValue: number;
  condition: StockCondition;
  weekTrend: number;
  /** True when no unit cost exists, so this product values at ₦0. */
  missingCost: boolean;
};

export function valueProduct(row: ProductStockInput): ValuedProduct {
  const units = sellableUnits(row);
  const unitCost = num(row.unitCost);
  return {
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    imageUrl: row.imageUrl ?? null,
    catalogType: row.catalogType || "standard",
    units,
    damagedUnits: num(row.damagedUnits),
    unitCost,
    costValue: units * unitCost,
    retailValue: units * num(row.sellingPrice),
    condition: stockCondition(row),
    weekTrend: num(row.weekTrend),
    missingCost: unitCost <= 0 && units > 0
  };
}

export type InventoryTotals = {
  totalUnits: number;
  totalCostValue: number;
  totalRetailValue: number;
  /** Weighted average, NOT the mean of the per-product costs. */
  averageUnitCost: number;
  productLines: number;
  /** Products holding stock with no cost on file - they value at ₦0. */
  unpricedLines: number;
  unpricedUnits: number;
};

/**
 * The headline figures.
 *
 * ⚠️ Average cost per unit is total value / total units - weighting each
 * product by how much of it is held. Averaging the per-product costs instead
 * would let one nearly-empty expensive line drag the figure far above what the
 * stock is actually worth per unit.
 */
export function summariseInventory(products: ValuedProduct[]): InventoryTotals {
  const rows = products ?? [];
  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);
  const totalCostValue = rows.reduce((sum, row) => sum + row.costValue, 0);
  const unpriced = rows.filter((row) => row.missingCost);
  return {
    totalUnits,
    totalCostValue,
    totalRetailValue: rows.reduce((sum, row) => sum + row.retailValue, 0),
    averageUnitCost: totalUnits > 0 ? Math.round((totalCostValue / totalUnits) * 100) / 100 : 0,
    productLines: rows.filter((row) => row.units > 0).length,
    unpricedLines: unpriced.length,
    unpricedUnits: unpriced.reduce((sum, row) => sum + row.units, 0)
  };
}

export type HealthSlice = {
  condition: StockCondition;
  label: string;
  amount: number;
  units: number;
  sharePct: number;
};

/**
 * Value split by condition.
 *
 * Every condition is kept even at zero: a reader needs to see that "At Risk"
 * exists and is empty, rather than wonder whether it was left out.
 */
export function inventoryHealth(products: ValuedProduct[]): { slices: HealthSlice[]; total: number } {
  const rows = products ?? [];
  const total = rows.reduce((sum, row) => sum + row.costValue, 0);
  const slices = STOCK_CONDITIONS.map((condition) => {
    const matching = rows.filter((row) => row.condition === condition);
    const amount = matching.reduce((sum, row) => sum + row.costValue, 0);
    return {
      condition,
      label: STOCK_CONDITION_LABEL[condition],
      amount,
      units: matching.reduce((sum, row) => sum + row.units, 0),
      sharePct: total > 0 ? Math.round((amount / total) * 10000) / 100 : 0
    };
  });
  return { slices, total };
}

export type GroupedValue = { key: string; label: string; amount: number; units: number; sharePct: number };

/** Value grouped by an arbitrary key, largest first. */
export function groupValue(
  entries: Array<{ key: string; label: string; amount: number; units: number }>
): GroupedValue[] {
  const merged = new Map<string, GroupedValue>();
  (entries ?? []).forEach((entry) => {
    const current = merged.get(entry.key) ?? { key: entry.key, label: entry.label, amount: 0, units: 0, sharePct: 0 };
    current.amount += num(entry.amount);
    current.units += num(entry.units);
    merged.set(entry.key, current);
  });
  const rows = [...merged.values()];
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return rows
    .map((row) => ({ ...row, sharePct: total > 0 ? Math.round((row.amount / total) * 10000) / 100 : 0 }))
    .sort((left, right) => right.amount - left.amount);
}

export type MovementTotals = {
  stockInUnits: number;
  stockInValue: number;
  stockOutUnits: number;
  stockOutValue: number;
  adjustmentUnits: number;
  adjustmentValue: number;
  netUnits: number;
  netValue: number;
};

/**
 * Which direction a stock movement counts in.
 *
 * ⚠️ "Distributed to Agent" and the waybill legs are INTERNAL - stock moving
 * between our own hubs never entered or left the business, exactly as a bank
 * transfer is not cash flow. Counting them would inflate both sides of the
 * week's movement with stock that only changed shelf.
 */
export function movementDirection(type: unknown): "in" | "out" | "adjustment" | "internal" {
  const value = String(type ?? "").trim().toLowerCase();
  if (value === "stock added") return "in";
  if (value === "return") return "in";
  if (value === "order fulfilled") return "out";
  if (value === "correction") return "adjustment";
  if (value === "distributed to agent" || value === "waybill in" || value === "waybill out") return "internal";
  return "adjustment";
}

export function summariseMovements(
  movements: Array<{ type: string; qty: number; productId: string }>,
  costByProduct: Map<string, number>
): MovementTotals {
  const totals: MovementTotals = {
    stockInUnits: 0, stockInValue: 0, stockOutUnits: 0, stockOutValue: 0,
    adjustmentUnits: 0, adjustmentValue: 0, netUnits: 0, netValue: 0
  };
  (movements ?? []).forEach((movement) => {
    const direction = movementDirection(movement.type);
    if (direction === "internal") return;
    const qty = Math.abs(num(movement.qty));
    const value = qty * (costByProduct.get(movement.productId) ?? 0);
    if (direction === "in") { totals.stockInUnits += qty; totals.stockInValue += value; }
    else if (direction === "out") { totals.stockOutUnits += qty; totals.stockOutValue += value; }
    else {
      // A correction can go either way, so its own sign is respected.
      const signed = num(movement.qty);
      totals.adjustmentUnits += signed;
      totals.adjustmentValue += signed * (costByProduct.get(movement.productId) ?? 0);
    }
  });
  totals.netUnits = totals.stockInUnits - totals.stockOutUnits + totals.adjustmentUnits;
  totals.netValue = totals.stockInValue - totals.stockOutValue + totals.adjustmentValue;
  return totals;
}
