// Weekly Financial Control Overview: the whole week's position on one screen.
//
// ⚠️ Every figure here is sourced from the tabs that own it - Cash Flow,
// Reconciliation, Reserves, Inventory, Period Close - and none is recomputed
// with different rules. An overview that quietly disagrees with the page it
// summarises is worse than no overview at all.

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export type Movement = { current: number; previous: number; delta: number; pct: number | null };

/**
 * This week against last.
 *
 * ⚠️ pct is NULL when last week was zero, not 0 and not Infinity. Going from
 * ₦0 to ₦500,000 is not "0% growth" and printing "∞%" is not a figure anyone
 * can act on - the UI shows "new" instead.
 */
export function weekOverWeek(current: unknown, previous: unknown): Movement {
  const now = num(current);
  const before = num(previous);
  return {
    current: now,
    previous: before,
    delta: now - before,
    pct: before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10
  };
}

export type HealthRating = "good" | "fair" | "poor" | "unknown";

export type HealthCheck = { key: string; label: string; rating: HealthRating; detail: string };

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

/**
 * The five at-a-glance ratings.
 *
 * ⚠️ Deliberately conservative: anything that cannot be judged reads "unknown"
 * rather than defaulting to good. A dashboard that shows green because it has
 * no data is worse than one that admits it does not know.
 */
export function healthChecks(input: {
  freeOperatingCash: number;
  netCashFlow: number;
  operatingExpenseRatioPct: number;
  collectionEfficiencyPct: number;
  cashVariance: number;
  varianceVerified: boolean;
  hasRevenue: boolean;
}): HealthCheck[] {
  const liquidity: HealthRating = input.freeOperatingCash > 0 ? "good"
    : input.freeOperatingCash === 0 ? "fair" : "poor";

  const cashFlow: HealthRating = input.netCashFlow > 0 ? "good"
    : input.netCashFlow === 0 ? "fair" : "poor";

  const expenseControl: HealthRating = !input.hasRevenue ? "unknown"
    : input.operatingExpenseRatioPct <= 25 ? "good"
      : input.operatingExpenseRatioPct <= 40 ? "fair" : "poor";

  const collection: HealthRating = !input.hasRevenue ? "unknown"
    : input.collectionEfficiencyPct >= 90 ? "good"
      : input.collectionEfficiencyPct >= 70 ? "fair" : "poor";

  const variance: HealthRating = !input.varianceVerified ? "unknown"
    : Math.abs(input.cashVariance) <= 0.5 ? "good"
      : Math.abs(input.cashVariance) <= 50_000 ? "fair" : "poor";

  return [
    {
      key: "liquidity", label: "Liquidity Status", rating: liquidity,
      detail: input.freeOperatingCash >= 0
        ? `${naira(input.freeOperatingCash)} free to operate on`
        : `${naira(Math.abs(input.freeOperatingCash))} more reserved than held`
    },
    {
      key: "cash_flow", label: "Cash Flow", rating: cashFlow,
      detail: input.netCashFlow >= 0
        ? `${naira(input.netCashFlow)} more came in than went out`
        : `${naira(Math.abs(input.netCashFlow))} more went out than came in`
    },
    {
      key: "expense_control", label: "Expense Control", rating: expenseControl,
      detail: input.hasRevenue
        ? `Operating expenses are ${input.operatingExpenseRatioPct.toFixed(2)}% of revenue`
        : "No revenue this week to judge against"
    },
    {
      key: "collection", label: "Collection Efficiency", rating: collection,
      detail: input.hasRevenue
        ? `${input.collectionEfficiencyPct.toFixed(2)}% of delivered value has been remitted`
        : "Nothing delivered this week"
    },
    {
      key: "variance", label: "Variance Status", rating: variance,
      detail: !input.varianceVerified
        ? "Closing cash has not been counted"
        : Math.abs(input.cashVariance) <= 0.5
          ? "The week balances"
          : `${naira(Math.abs(input.cashVariance))} unexplained`
    }
  ];
}

export type Highlight = {
  key: string; label: string; value: number;
  /** "naira" prints as money, "pct" as a percentage. */
  format: "naira" | "pct";
  movement: Movement;
};

/**
 * The five ratios under the summary.
 *
 * ⚠️ Averages are over SEVEN days always, not over days that happened to have
 * activity. A quiet Sunday is part of the week; excluding it would flatter the
 * daily average of a business that does not trade every day.
 */
export function financialHighlights(
  current: { cashIn: number; cashOut: number; revenue: number; cogs: number; deliveredValue: number },
  previous: { cashIn: number; cashOut: number; revenue: number; cogs: number; deliveredValue: number }
): Highlight[] {
  const ratio = (top: number, bottom: number) =>
    bottom > 0 ? Math.round((top / bottom) * 10000) / 100 : 0;
  const grossMargin = (row: typeof current) => row.revenue - row.cogs;

  return [
    {
      key: "avg_daily_sales", label: "Average Daily Sales (Received)",
      value: Math.round(current.cashIn / 7), format: "naira",
      movement: weekOverWeek(Math.round(current.cashIn / 7), Math.round(previous.cashIn / 7))
    },
    {
      key: "avg_daily_expenses", label: "Average Daily Expenses",
      value: Math.round(current.cashOut / 7), format: "naira",
      movement: weekOverWeek(Math.round(current.cashOut / 7), Math.round(previous.cashOut / 7))
    },
    {
      key: "gross_margin", label: "Gross Margin",
      value: grossMargin(current), format: "naira",
      movement: weekOverWeek(grossMargin(current), grossMargin(previous))
    },
    {
      key: "opex_ratio", label: "Operating Expense Ratio",
      value: ratio(current.cashOut, current.revenue), format: "pct",
      movement: weekOverWeek(ratio(current.cashOut, current.revenue), ratio(previous.cashOut, previous.revenue))
    },
    {
      key: "collection", label: "Collection Efficiency",
      value: ratio(current.cashIn, current.deliveredValue), format: "pct",
      movement: weekOverWeek(
        ratio(current.cashIn, current.deliveredValue),
        ratio(previous.cashIn, previous.deliveredValue))
    }
  ];
}

export type RankedSlice = { label: string; amount: number; sharePct: number };

/** Largest first, with each one's share of the total. */
export function rankSlices(entries: Map<string, number>): RankedSlice[] {
  const rows = [...entries.entries()].map(([label, amount]) => ({ label, amount: num(amount) }));
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return rows
    .filter((row) => row.amount > 0)
    .map((row) => ({ ...row, sharePct: total > 0 ? Math.round((row.amount / total) * 10000) / 100 : 0 }))
    .sort((left, right) => right.amount - left.amount);
}
