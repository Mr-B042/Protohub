// What an order actually cost us.
//
// ⚠️ THE RULE: a frozen snapshot always wins over a live recomputation.
//
// Before snapshots existed, every report worked COGS out as `quantity x
// TODAY'S unit_cost`. That meant editing a product's cost silently restated
// every order ever sold containing it - ₦48,500 of reported profit would have
// vanished from July and August the moment one shelf went from ₦11,500 to
// ₦12,000. A delivered order's cost is settled, like a closed week.

export type CogsSource = "snapshot" | "live";

export type CogsResult = {
  amount: number;
  source: CogsSource;
  /** When the snapshot was taken. Null for a live figure. */
  frozenAt: string | null;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Resolve one order's COGS.
 *
 * ⚠️ A snapshot of 0 is still a snapshot. Treating zero as "missing" and
 * falling through to live pricing would silently un-freeze every order that
 * genuinely cost nothing - free replacements, written-off goods - and let a
 * later cost change move them.
 */
export function resolveOrderCogs(
  order: { cogs_snapshot?: unknown; cogs_snapshot_at?: unknown },
  liveCogs: number
): CogsResult {
  const snapshot = order?.cogs_snapshot;
  if (snapshot !== null && snapshot !== undefined && Number.isFinite(Number(snapshot))) {
    return {
      amount: num(snapshot),
      source: "snapshot",
      frozenAt: typeof order.cogs_snapshot_at === "string" ? order.cogs_snapshot_at : null
    };
  }
  return { amount: num(liveCogs), source: "live", frozenAt: null };
}

/** Should this order be frozen before a cost change? */
export function needsFreezing(order: {
  status?: unknown; cogs_snapshot?: unknown;
}): boolean {
  // ⚠️ Only DELIVERED orders freeze. An order still in flight has not incurred
  // its cost yet, and freezing it would lock in a price for goods that may
  // ship from stock bought later - the opposite of what a snapshot is for.
  if (String(order?.status ?? "") !== "Delivered") return false;
  return order?.cogs_snapshot === null || order?.cogs_snapshot === undefined;
}

export type CostChangeImpact = {
  previousUnitCost: number;
  newUnitCost: number;
  delta: number;
  /** Delivered orders that would be recosted if history were not frozen. */
  ordersAffected: number;
  unitsAffected: number;
  /** How much reported profit would move. Negative means profit falls. */
  reportedProfitShift: number;
  alreadyFrozen: number;
};

/**
 * What a cost change would do to history if nothing were frozen.
 *
 * Shown BEFORE the change so the size of the restatement is a decision rather
 * than a surprise found weeks later in a margin report.
 */
export function costChangeImpact(input: {
  previousUnitCost: unknown;
  newUnitCost: unknown;
  deliveredOrders: Array<{ units: number; frozen: boolean }>;
}): CostChangeImpact {
  const previous = num(input.previousUnitCost);
  const next = num(input.newUnitCost);
  const delta = next - previous;
  const unfrozen = (input.deliveredOrders ?? []).filter((row) => !row.frozen);
  const units = unfrozen.reduce((sum, row) => sum + num(row.units), 0);
  return {
    previousUnitCost: previous,
    newUnitCost: next,
    delta,
    ordersAffected: unfrozen.length,
    unitsAffected: units,
    // A cost RISE cuts profit, so the shift is the negative of the extra cost.
    // `|| 0` normalises NEGATIVE ZERO: negating 0 yields -0, which is not
    // strictly equal to 0, serialises as -0 in JSON, and would render as "-₦0".
    reportedProfitShift: -(delta * units) || 0,
    alreadyFrozen: (input.deliveredOrders ?? []).length - unfrozen.length
  };
}
