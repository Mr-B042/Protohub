// Cash Flow: liquid money actually moving in and out of the business.
//
// ⚠️ This is a CASH view, not a profit view, and the two disagree on purpose.
// Profit is recognised when an order is marked Delivered; cash arrives only
// when the agent remits, days later and sometimes never. A week can show a
// healthy profit and a negative cash position at the same time - that gap is
// the whole reason this page exists, so nothing here may be sourced from
// delivered orders.
//
// Cash IN  = remittance_transactions.delta_amount (money handed over).
// Cash OUT = expenses (money paid out).

/** The groups the Cash Out donut is split into. */
export type CashOutGroup =
  | "Facebook / Instagram Ads"
  | "Stock Purchases"
  | "Logistics / Dispatch"
  | "Payroll"
  | "Other Operating Expenses";

export const CASH_OUT_GROUPS: CashOutGroup[] = [
  "Facebook / Instagram Ads",
  "Stock Purchases",
  "Logistics / Dispatch",
  "Payroll",
  "Other Operating Expenses"
];

/**
 * Which spending bucket an expense category belongs to.
 *
 * ⚠️ "Stock Purchases" has no historical data. Buying inventory was never
 * recorded as an expense - there is no purchases table and no such category
 * existed until now - so the group reads zero for every past period. It is
 * mapped here rather than omitted because it is a real and large outflow, and
 * a cash page that silently leaves it out understates what leaves the bank.
 * The page says so on screen instead of quietly showing a smaller number.
 */
export function cashOutGroupFor(category: unknown): CashOutGroup {
  const value = String(category ?? "").trim().toLowerCase();
  if (value === "ad spend") return "Facebook / Instagram Ads";
  if (value === "stock purchase" || value === "stock purchases") return "Stock Purchases";
  if (value === "delivery" || value === "waybill" || value === "clearing & shipping" || value === "failed delivery") {
    return "Logistics / Dispatch";
  }
  if (value === "salary") return "Payroll";
  return "Other Operating Expenses";
}

export type CashMovement = {
  /** Lagos calendar day, YYYY-MM-DD. */
  day: string;
  amount: number;
};

export type CashFlowTotals = {
  cashIn: number;
  cashOut: number;
  net: number;
};

export function sumCash(movements: CashMovement[]): number {
  return movements.reduce((total, row) => total + (Number(row.amount) || 0), 0);
}

/** Percentage change against the previous period. Null when there is no base. */
export function changeVsPrevious(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export type DailyCashPoint = { day: string; cashIn: number; cashOut: number; net: number };

/**
 * One point per calendar day across the whole range, including days with no
 * movement. A trend line that skips empty days implies activity that did not
 * happen and makes a quiet weekend look like a straight line between Friday
 * and Monday.
 */
export function buildDailyTrend(
  days: string[],
  inflows: CashMovement[],
  outflows: CashMovement[]
): DailyCashPoint[] {
  const inByDay = new Map<string, number>();
  const outByDay = new Map<string, number>();
  inflows.forEach((row) => inByDay.set(row.day, (inByDay.get(row.day) ?? 0) + (Number(row.amount) || 0)));
  outflows.forEach((row) => outByDay.set(row.day, (outByDay.get(row.day) ?? 0) + (Number(row.amount) || 0)));
  return days.map((day) => {
    const cashIn = inByDay.get(day) ?? 0;
    const cashOut = outByDay.get(day) ?? 0;
    return { day, cashIn, cashOut, net: cashIn - cashOut };
  });
}

/** Every Lagos calendar day from `from` to `to`, inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for (let cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    out.push(cursor.toISOString().slice(0, 10));
  }
  return out;
}

export type BreakdownSlice = { label: string; amount: number; sharePct: number };

/**
 * Donut slices with their share of the total, largest first.
 *
 * Zero-value groups are KEPT when they are part of a fixed set, so a reader
 * can see that a category exists and is empty rather than wondering whether it
 * was simply forgotten - which matters most for Stock Purchases.
 */
export function buildBreakdown(
  amountsByLabel: Map<string, number>,
  fixedLabels?: string[]
): { slices: BreakdownSlice[]; total: number } {
  const labels = fixedLabels ?? [...amountsByLabel.keys()];
  const total = labels.reduce((sum, label) => sum + (amountsByLabel.get(label) ?? 0), 0);
  const slices = labels
    .map((label) => {
      const amount = amountsByLabel.get(label) ?? 0;
      return {
        label,
        amount,
        sharePct: total > 0 ? Math.round((amount / total) * 10000) / 100 : 0
      };
    })
    .sort((left, right) => right.amount - left.amount);
  return { slices, total };
}

export type RunningBalanceRow = { balance: number };

/**
 * Walk a period's transactions OLDEST first, carrying the opening balance
 * forward, then hand them back newest-first for display.
 *
 * The balance column has to be computed in chronological order - a running
 * total built newest-first is simply wrong - so the reversal happens after the
 * arithmetic, never before it.
 */
export function withRunningBalance<T extends { cashIn: number; cashOut: number }>(
  oldestFirst: T[],
  openingBalance: number
): Array<T & RunningBalanceRow> {
  let balance = Number(openingBalance) || 0;
  const walked = oldestFirst.map((row) => {
    balance += (Number(row.cashIn) || 0) - (Number(row.cashOut) || 0);
    return { ...row, balance };
  });
  return walked.reverse();
}
