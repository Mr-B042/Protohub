// Extra products on an order that are NOT cross-sell.
//
// ⚠️ These count toward the order amount, deduct stock and cost COGS. What
// they skip is the cross-sell BONUS and the cross-sell reporting bucket -
// a customer who asked for two more of something is not an upsell win, and
// paying for it as one was the reason cross-sell did not fit.
//
// ⚠️ quantity is PIECES ordered, never pieces x units_per_pack. Cross-sell
// carried exactly that bug and over-deducted stock four-fold.

export type AdditionalLine = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Total for the LINE, not per piece. 0 is allowed - a giveaway still ships. */
  amount: number;
  /** Owner's per-line call. Off by default; nothing pays out by accident. */
  bonusEligible: boolean;
  note: string;
  addedAt: string;
  addedById: string | null;
  addedByName: string;
  addedByRole: string;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const positiveInt = (value: unknown, fallback = 1): number => {
  const parsed = Math.floor(num(value));
  return parsed > 0 ? parsed : fallback;
};

/**
 * Read whatever is on the row into a shape the rest of the app can trust.
 *
 * Lines with no product are DROPPED rather than defaulted: a line that cannot
 * name what is being shipped cannot deduct stock either, and keeping it would
 * put a phantom item on a delivery note.
 */
export function normalizeAdditionalLines(raw: unknown): AdditionalLine[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .filter((entry) => typeof entry.productId === "string" && entry.productId.trim().length > 0)
    .map((entry) => ({
      id: String(entry.id ?? `extra-${Math.random().toString(36).slice(2, 10)}`),
      productId: String(entry.productId),
      productName: String(entry.productName ?? "").trim() || "Unnamed product",
      quantity: positiveInt(entry.quantity, 1),
      // Negative money is never a line; a refund is not an order item.
      amount: Math.max(0, num(entry.amount)),
      bonusEligible: entry.bonusEligible === true,
      note: String(entry.note ?? "").trim(),
      addedAt: String(entry.addedAt ?? new Date().toISOString()),
      addedById: typeof entry.addedById === "string" ? entry.addedById : null,
      addedByName: String(entry.addedByName ?? "").trim(),
      addedByRole: String(entry.addedByRole ?? "").trim()
    }));
}

export function additionalLinesTotal(raw: unknown): number {
  return normalizeAdditionalLines(raw).reduce((sum, line) => sum + line.amount, 0);
}

export function additionalLinesUnits(raw: unknown): number {
  return normalizeAdditionalLines(raw).reduce((sum, line) => sum + line.quantity, 0);
}

/**
 * Only the part the Owner has explicitly marked as bonus-earning.
 *
 * ⚠️ Defaults to nothing. A rep is paid on an extra line only where someone
 * deliberately said so, because the whole point of this route is adding items
 * without triggering a payout.
 */
export function bonusEligibleTotal(raw: unknown): number {
  return normalizeAdditionalLines(raw)
    .filter((line) => line.bonusEligible)
    .reduce((sum, line) => sum + line.amount, 0);
}

export type OrderMoneyBreakdown = {
  total: number;
  crossSell: number;
  additional: number;
  /** What the main product earned, once every add-on is taken off. */
  main: number;
};

/**
 * Split an order's amount into main, cross-sell and extras.
 *
 * ⚠️ Main is DERIVED as total − crossSell − additional, never read from
 * original_amount. Adding extras without subtracting them here would silently
 * inflate every main-product revenue figure in the app by the value of the
 * extras, which is the exact trap the cross-sell rule was written to avoid.
 *
 * Floored at zero: a discount that takes the total below the add-ons is a
 * pricing decision, not a negative main line.
 */
export function orderMoneyBreakdown(order: {
  amount?: unknown; cross_sell_lines?: unknown; additional_lines?: unknown;
}): OrderMoneyBreakdown {
  const total = num(order.amount);
  const crossSell = Array.isArray(order.cross_sell_lines)
    ? (order.cross_sell_lines as Array<Record<string, unknown>>)
      .reduce((sum, line) => sum + Math.max(0, num(line?.amount)), 0)
    : 0;
  const additional = additionalLinesTotal(order.additional_lines);
  return { total, crossSell, additional, main: Math.max(0, total - crossSell - additional) };
}

export type StockCheck = {
  productId: string;
  productName: string;
  needed: number;
  held: number;
  ok: boolean;
};

/**
 * Can the assigned agent actually supply these lines?
 *
 * ⚠️ Requirements are SUMMED per product before checking. Two separate lines
 * of the same product against one stock figure would each pass on their own
 * while together exceeding what the agent holds - the classic double-spend.
 */
export function checkAgentStock(
  lines: Array<{ productId: string; productName: string; quantity: number }>,
  heldByProduct: Map<string, number>
): StockCheck[] {
  const needed = new Map<string, { name: string; qty: number }>();
  (lines ?? []).forEach((line) => {
    const entry = needed.get(line.productId) ?? { name: line.productName, qty: 0 };
    entry.qty += positiveInt(line.quantity, 1);
    needed.set(line.productId, entry);
  });
  return [...needed.entries()].map(([productId, entry]) => {
    const held = num(heldByProduct.get(productId));
    return { productId, productName: entry.name, needed: entry.qty, held, ok: held >= entry.qty };
  });
}

export function stockShortfallMessage(checks: StockCheck[]): string | null {
  const short = (checks ?? []).filter((check) => !check.ok);
  if (short.length === 0) return null;
  return short
    .map((check) => `${check.productName}: needs ${check.needed}, agent holds ${check.held}`)
    .join(" · ");
}
