// Reconciling ONE account against its bank statement.
//
// ⚠️ Sign convention, shared with Weekly Reconciliation and fixed everywhere:
// difference = STATEMENT − BOOKS. Negative means the bank holds less than we
// recorded (money missing); positive means money arrived we never wrote down.
// The supplied design computed this the other way on one screen; carrying both
// would put two opposite meanings on the same minus sign.

/** Naira are whole; this absorbs float noise, not real differences. */
export const RECONCILED_TOLERANCE = 0.5;

/** Above this, a variance stops being a rounding annoyance. */
export const LARGE_VARIANCE_THRESHOLD = 50_000;

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export type Adjustment = { amount: number; direction: "in" | "out" };

/**
 * What the adjustments move the book balance by.
 *
 * An 'in' adjustment is money the bank credited that we never recorded, so it
 * RAISES what our books should say. An 'out' (a charge) lowers it.
 */
export function adjustmentDelta(adjustments: Adjustment[]): number {
  return (adjustments ?? []).reduce(
    (sum, row) => sum + (row.direction === "in" ? num(row.amount) : -num(row.amount)), 0);
}

export function adjustedBookBalance(bookBalance: unknown, adjustments: Adjustment[]): number {
  return num(bookBalance) + adjustmentDelta(adjustments);
}

/** statement − books, before any adjustments. */
export function rawDifference(statementBalance: unknown, bookBalance: unknown): number {
  return num(statementBalance) - num(bookBalance);
}

/**
 * What is still unexplained once the adjustments are applied.
 *
 * This is the figure that has to reach zero before an account can be marked
 * reconciled - the raw difference is only the starting point.
 */
export function remainingDifference(
  statementBalance: unknown, bookBalance: unknown, adjustments: Adjustment[]
): number {
  return num(statementBalance) - adjustedBookBalance(bookBalance, adjustments);
}

export function isReconciled(remaining: number): boolean {
  return Math.abs(num(remaining)) <= RECONCILED_TOLERANCE;
}

export type VarianceBand = "matched" | "small" | "large";

export function varianceBand(amount: unknown): VarianceBand {
  const size = Math.abs(num(amount));
  if (size <= RECONCILED_TOLERANCE) return "matched";
  return size > LARGE_VARIANCE_THRESHOLD ? "large" : "small";
}

export type ReconciliationRecord = {
  id: string;
  statementBalance: number;
  bookBalance: number;
  status: "in_progress" | "reconciled" | string;
  adjustments?: Adjustment[];
};

export type ReconciliationSummary = {
  total: number;
  reconciled: number;
  inProgress: number;
  unreconciled: number;
  reconciledPct: number;
  inProgressPct: number;
  unreconciledPct: number;
  /** Sum of the ABSOLUTE remaining differences still outstanding. */
  totalVariance: number;
  varianceCount: number;
  bands: Record<VarianceBand, { amount: number; count: number; sharePct: number }>;
};

/**
 * The headline counts.
 *
 * ⚠️ "Unreconciled" means marked in progress but still carrying a gap that has
 * not been explained - a real backlog. An account whose remaining difference is
 * already zero but has not been signed off is merely in progress, not a
 * problem, and lumping the two together would inflate the backlog with work
 * that is effectively done.
 */
export function summariseReconciliations(records: ReconciliationRecord[]): ReconciliationSummary {
  const rows = records ?? [];
  const bands: ReconciliationSummary["bands"] = {
    matched: { amount: 0, count: 0, sharePct: 0 },
    small: { amount: 0, count: 0, sharePct: 0 },
    large: { amount: 0, count: 0, sharePct: 0 }
  };

  let reconciled = 0;
  let inProgress = 0;
  let unreconciled = 0;
  let totalVariance = 0;
  let varianceCount = 0;

  rows.forEach((row) => {
    const remaining = remainingDifference(row.statementBalance, row.bookBalance, row.adjustments ?? []);
    const band = varianceBand(remaining);
    bands[band].amount += Math.abs(remaining);
    bands[band].count += 1;

    if (row.status === "reconciled") reconciled += 1;
    else if (isReconciled(remaining)) inProgress += 1;
    else { unreconciled += 1; }

    if (!isReconciled(remaining)) {
      totalVariance += Math.abs(remaining);
      varianceCount += 1;
    }
  });

  const total = rows.length;
  const pct = (value: number) => (total > 0 ? Math.round((value / total) * 10000) / 100 : 0);
  const bandTotal = bands.matched.amount + bands.small.amount + bands.large.amount;
  (Object.keys(bands) as VarianceBand[]).forEach((key) => {
    bands[key].sharePct = bandTotal > 0 ? Math.round((bands[key].amount / bandTotal) * 10000) / 100 : 0;
  });

  return {
    total, reconciled, inProgress, unreconciled,
    reconciledPct: pct(reconciled),
    inProgressPct: pct(inProgress),
    unreconciledPct: pct(unreconciled),
    totalVariance, varianceCount, bands
  };
}

export type BookItem = {
  sourceType: "expense" | "remittance" | "transfer";
  sourceId: string;
  occurredOn: string;
  description: string;
  amount: number;
  direction: "in" | "out";
};

/**
 * Our recorded movements that have NOT been ticked off the statement.
 *
 * Derived from live data against the set of matches, never stored, so a
 * transaction added after a reconciliation was started still shows up as
 * needing attention instead of being silently excluded.
 */
export function unmatchedBookItems(
  items: BookItem[], matched: Array<{ sourceType: string; sourceId: string }>
): BookItem[] {
  const done = new Set((matched ?? []).map((row) => `${row.sourceType}::${row.sourceId}`));
  return (items ?? []).filter((item) => !done.has(`${item.sourceType}::${item.sourceId}`));
}

export function sumItems(items: Array<{ amount: number }>): number {
  return (items ?? []).reduce((sum, item) => sum + num(item.amount), 0);
}
