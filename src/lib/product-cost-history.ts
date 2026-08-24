// What a product cost on a GIVEN DAY, rather than what it costs today.
//
// orders.cogs_snapshot freezes an order's TOTAL cost at delivery, which keeps
// reported profit stable when a unit cost later changes. It cannot answer "what
// did this one line cost", so a per-line profit breakdown had no choice but to
// read live pricing - and silently restated history the moment a cost moved.
//
// product_cost_changes already records every move with its before and after
// value, so it doubles as a cost history: start from today's cost and step back
// through every change made AFTER the day in question.

export type ProductCostChange = {
  productId: string;
  currency?: string;
  previousUnitCost: number;
  newUnitCost: number;
  /** ISO timestamp of when the change was made. */
  createdAt: string;
};

const dayOf = (value: string | null | undefined) => String(value ?? "").slice(0, 10);
const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The unit cost that applied on `asOfDay` (YYYY-MM-DD).
 *
 * A change made ON the day itself is treated as already in force - the person
 * changing the cost is telling us what it is now, and orders that closed before
 * they did so are protected by their frozen snapshot rather than by this.
 *
 * With no history, or no day to resolve against, today's cost is the answer.
 */
export function unitCostAsOf(
  currentUnitCost: number,
  changes: ProductCostChange[],
  asOfDay: string | null | undefined
): number {
  const day = dayOf(asOfDay);
  if (!day) return num(currentUnitCost);
  const after = changes
    .filter((change) => dayOf(change.createdAt) > day)
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  if (after.length === 0) return num(currentUnitCost);
  // The earliest change made after that day replaced the cost that was in force
  // on it, so its "before" value is what we are looking for.
  return num(after[0].previousUnitCost);
}

/** Index the flat change log by product, so a lookup does not rescan it. */
export function indexCostChanges(changes: ProductCostChange[]): Map<string, ProductCostChange[]> {
  const byProduct = new Map<string, ProductCostChange[]>();
  for (const change of changes) {
    if (!change?.productId) continue;
    const list = byProduct.get(change.productId);
    if (list) list.push(change);
    else byProduct.set(change.productId, [change]);
  }
  return byProduct;
}

/**
 * True when this product's cost has moved since that day - i.e. the figure on
 * screen is a historical cost and not the one in the product record. Lets the
 * UI say so rather than leaving a reader to wonder why two pages disagree.
 */
export function costMovedSince(changes: ProductCostChange[], asOfDay: string | null | undefined): boolean {
  const day = dayOf(asOfDay);
  if (!day) return false;
  return changes.some((change) => dayOf(change.createdAt) > day);
}
