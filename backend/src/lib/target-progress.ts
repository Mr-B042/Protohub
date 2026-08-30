import { weekStartsForMonth, lagosTodayKey } from "./salary-spread.js";

/**
 * Actuals for one product target period.
 *
 * ⚠️ THE ONE DELIBERATE DIFFERENCE FROM THE P&L IS ADVERTISING. Everything
 * here is the app's existing contribution figure - App.tsx computes
 *   contribution = revenue - cogs - logistics - commission
 * for reps and agents already - with AD SPEND subtracted on top. Building it
 * as "existing contribution minus ads" rather than as a fresh formula is
 * deliberate: it guarantees this tab agrees with the P&L on every line except
 * the one we intend to differ on. Inventing a parallel calculation is what
 * made the upsell per-rep rows sum to ₦61,000 under an ₦87,000 team total.
 *
 * ⚠️ LOGISTICS HAS TWO SOURCES AND THEY ARE ALTERNATIVES, NOT ADDITIVE. The
 * P&L's rule (App.tsx: `logisticsFromOrders > 0 ? logisticsFromOrders :
 * recordedDeliveryExpense`) is mirrored exactly. Measured on Edge Brusher for
 * Aug 2026: 465 of 481 delivered orders carry a per-order logistics_cost
 * totalling ₦2,269,200, while the Delivery/Waybill/Failed Delivery expense
 * rows for the same product and month total ₦2,200,700. Those are the SAME
 * costs recorded two ways - adding them would double-count ~₦2.2m.
 */

export type TargetOrder = {
  id?: string | null;
  status?: string | null;
  amount?: number | null;
  quantity?: number | null;
  cogs_snapshot?: number | null;
  logistics_cost?: number | null;
  created_at?: string | null;
  delivered_date?: string | null;
  review_hold?: boolean | null;
};

export type DatedAmount = { date: string; amount: number };

export type TargetDefinition = {
  periodStart: string;
  periodEnd: string;
  contributionTarget: number;
  orderTarget: number;
  deliveredTarget: number;
  piecesTarget: number;
  deliveryRateTarget: number;
  adSpendCeiling: number;
};

const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const dayOf = (value?: string | null): string => (value ?? "").slice(0, 10);

const inPeriod = (day: string, start: string, end: string) => day !== "" && day >= start && day <= end;

/** Orders CREATED in the period, excluding review_hold. */
export const placedOrdersIn = (orders: TargetOrder[], start: string, end: string) =>
  orders.filter((o) => o.review_hold !== true && inPeriod(dayOf(o.created_at), start, end));

/**
 * Orders DELIVERED in the period by delivery date, excluding review_hold.
 *
 * ⚠️ Throughput, not same-cohort conversion - an order created in July and
 * delivered in August belongs to August's revenue. This mirrors the Dashboard
 * "Fulfillment Rate" / manager-bonuses / head-of-sales-metrics definition
 * exactly, and the two bases differ ON PURPOSE. Do not unify them.
 */
export const deliveredOrdersIn = (orders: TargetOrder[], start: string, end: string) =>
  orders.filter((o) =>
    o.review_hold !== true && o.status === "Delivered" && inPeriod(dayOf(o.delivered_date), start, end));

const sumIn = (rows: DatedAmount[], start: string, end: string) =>
  rows.reduce((total, row) => (inPeriod(dayOf(row.date), start, end) ? total + num(row.amount) : total), 0);

export type ContributionBreakdown = {
  revenue: number;
  cogs: number;
  logistics: number;
  commissions: number;
  adSpend: number;
  /** revenue - cogs - logistics - commissions. The app's EXISTING metric. */
  contributionBeforeAds: number;
  /** contributionBeforeAds - adSpend. What this tab targets. */
  contribution: number;
};

export function computeContribution(
  deliveredOrders: TargetOrder[],
  adSpend: number,
  commissions: number,
  deliveryExpenseFallback = 0
): ContributionBreakdown {
  const revenue = deliveredOrders.reduce((s, o) => s + num(o.amount), 0);
  const cogs = deliveredOrders.reduce((s, o) => s + num(o.cogs_snapshot), 0);
  const logisticsFromOrders = deliveredOrders.reduce((s, o) => s + num(o.logistics_cost), 0);
  // The P&L's rule, mirrored: per-order cost wins; the expense rows are only a
  // fallback for orders that never recorded one. Never the sum of both.
  const logistics = logisticsFromOrders > 0 ? logisticsFromOrders : deliveryExpenseFallback;
  const contributionBeforeAds = revenue - cogs - logistics - commissions;
  return {
    revenue, cogs, logistics, commissions, adSpend,
    contributionBeforeAds,
    contribution: contributionBeforeAds - adSpend
  };
}

export type LeverProgress = {
  actual: number;
  target: number;
  /** Null when there is no target to measure against, never a misleading 0. */
  percentAchieved: number | null;
  /** Where linear pacing says this should be by the end of today. */
  expectedByToday: number;
  /** actual - expectedByToday. Negative means behind pace. */
  variance: number;
  /** Month-end result if the seven-day trend holds. */
  projected: number;
};

const lever = (actual: number, target: number, expected = 0, projected = actual): LeverProgress => ({
  actual,
  target,
  percentAchieved: target > 0 ? Math.round((actual / target) * 1000) / 10 : null,
  expectedByToday: expected,
  variance: Math.round((actual - expected) * 10) / 10,
  projected
});

export type WeeklyMilestone = {
  week: number;
  startDate: string;
  endDate: string;
  days: number;
  targetContribution: number;
  actualContribution: number;
  percentAchieved: number | null;
};

/**
 * Sunday-anchored weeks, reusing the salary spread's calendar so a "week" means
 * the same thing everywhere in the app. A month owns 4 or 5 of them and the
 * LAST one absorbs the remainder, so the weekly targets always sum to exactly
 * the monthly target rather than drifting by a rounding unit.
 */
export function buildWeeklyMilestones(
  target: TargetDefinition,
  deliveredOrders: TargetOrder[],
  adSpendRows: DatedAmount[],
  commissionsByDay: Map<string, number> = new Map()
): WeeklyMilestone[] {
  const monthKey = target.periodStart.slice(0, 7);
  const anchors = weekStartsForMonth(monthKey);
  if (anchors.length === 0) return [];

  // Clip each Sunday-anchored week to the period, so a target that does not
  // span a whole month still adds up.
  const windows = anchors.map((anchor, index) => {
    const nextAnchor = anchors[index + 1];
    const rawEnd = nextAnchor
      ? new Date(new Date(`${nextAnchor}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10)
      : target.periodEnd;
    return {
      start: anchor < target.periodStart ? target.periodStart : anchor,
      end: rawEnd > target.periodEnd ? target.periodEnd : rawEnd
    };
  }).filter((w) => w.start <= w.end);

  const daysBetween = (start: string, end: string) =>
    Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

  const totalDays = windows.reduce((s, w) => s + daysBetween(w.start, w.end), 0);
  let allocated = 0;

  return windows.map((w, index) => {
    const days = daysBetween(w.start, w.end);
    const isLast = index === windows.length - 1;
    // The last week takes whatever is left rather than its own rounded share,
    // so the parts sum to the whole exactly.
    const targetContribution = isLast
      ? Math.max(0, target.contributionTarget - allocated)
      : Math.round((target.contributionTarget * days) / Math.max(1, totalDays));
    allocated += targetContribution;

    const weekDelivered = deliveredOrdersIn(deliveredOrders, w.start, w.end);
    const weekCommissions = Array.from(commissionsByDay.entries())
      .reduce((s, [day, value]) => (inPeriod(day, w.start, w.end) ? s + value : s), 0);
    const actualContribution = computeContribution(
      weekDelivered, sumIn(adSpendRows, w.start, w.end), weekCommissions
    ).contribution;

    return {
      week: index + 1,
      startDate: w.start,
      endDate: w.end,
      days,
      targetContribution,
      actualContribution,
      percentAchieved: targetContribution > 0
        ? Math.round((actualContribution / targetContribution) * 1000) / 10
        : null
    };
  });
}

export type TargetProgress = {
  breakdown: ContributionBreakdown;
  contribution: LeverProgress;
  ordersPlaced: LeverProgress;
  delivered: LeverProgress;
  pieces: LeverProgress;
  deliveryRate: LeverProgress;
  /** A CEILING, not a goal - under target is good. Flagged separately. */
  adSpend: LeverProgress & { overCeiling: boolean };
  weeklyMilestones: WeeklyMilestone[];
  forecast: TargetForecast;
  requiredPace: RequiredPace;
};

export function computeTargetProgress(
  target: TargetDefinition,
  orders: TargetOrder[],
  adSpendRows: DatedAmount[],
  commissions = 0,
  deliveryExpenseFallback = 0,
  commissionsByDay?: Map<string, number>,
  today: string = lagosTodayKey()
): TargetProgress {
  const { periodStart: start, periodEnd: end } = target;
  const placed = placedOrdersIn(orders, start, end);
  const delivered = deliveredOrdersIn(orders, start, end);
  const adSpend = sumIn(adSpendRows, start, end);

  const breakdown = computeContribution(delivered, adSpend, commissions, deliveryExpenseFallback);
  const pieces = delivered.reduce((s, o) => s + num(o.quantity), 0);
  // Delivery rate is delivered-by-date over orders CREATED in the period. The
  // mixed basis is the app's own convention, not an oversight here.
  const ratePct = placed.length > 0 ? Math.round((delivered.length / placed.length) * 1000) / 10 : 0;

  const actual = {
    contribution: breakdown.contribution,
    orders: placed.length,
    delivered: delivered.length,
    pieces
  };
  const forecast = computeForecast(target, orders, adSpendRows, actual, today, commissions);
  const requiredPace = computeRequiredPace(target, actual, forecast.daysRemainingInclusive);
  const totalDays = daysInclusive(start, end);
  const expected = (goal: number) => expectedByToday(goal, forecast.daysElapsed, totalDays);

  return {
    breakdown,
    contribution: lever(breakdown.contribution, target.contributionTarget,
      expected(target.contributionTarget), forecast.projectedContribution),
    ordersPlaced: lever(placed.length, target.orderTarget,
      expected(target.orderTarget), forecast.projectedOrders),
    delivered: lever(delivered.length, target.deliveredTarget,
      expected(target.deliveredTarget), forecast.projectedDelivered),
    pieces: lever(pieces, target.piecesTarget,
      expected(target.piecesTarget), forecast.projectedPieces),
    // A RATE is not cumulative: it does not build up over the month, so linear
    // pacing is meaningless for it. Expected is the target itself from day one,
    // and the projection is simply where the rate stands.
    deliveryRate: lever(ratePct, target.deliveryRateTarget, target.deliveryRateTarget, ratePct),
    adSpend: {
      // A ceiling is also not something to "pace towards" - expected is the
      // straight-line spend allowance so far, and over/under is what matters.
      ...lever(adSpend, target.adSpendCeiling, expected(target.adSpendCeiling), adSpend),
      overCeiling: target.adSpendCeiling > 0 && adSpend > target.adSpendCeiling
    },
    weeklyMilestones: buildWeeklyMilestones(target, orders, adSpendRows, commissionsByDay),
    forecast,
    requiredPace
  };
}

// ── Forecasting and pace ─────────────────────────────────

const addDays = (day: string, delta: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

const daysInclusive = (start: string, end: string) =>
  end < start ? 0 : Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;

/** Contribution earned inside an arbitrary window, on the same basis as the whole period. */
export function contributionInRange(
  orders: TargetOrder[], adSpendRows: DatedAmount[], start: string, end: string, commissions = 0
): number {
  return computeContribution(deliveredOrdersIn(orders, start, end), sumIn(adSpendRows, start, end), commissions).contribution;
}

export type TargetForecast = {
  /** The seven COMPLETE days used, so the figure can be checked by hand. */
  trendStart: string;
  trendEnd: string;
  dailyAverageContribution: number;
  dailyAverageOrders: number;
  dailyAverageDelivered: number;
  dailyAveragePieces: number;
  projectedContribution: number;
  projectedOrders: number;
  projectedDelivered: number;
  projectedPieces: number;
  projectedPercent: number | null;
  status: "on_track" | "at_risk" | "behind" | "achieved";
  daysElapsed: number;
  /** Days left to ACT, today included - what the required pace divides by. */
  daysRemainingInclusive: number;
  /** Days strictly after today - what the projection extrapolates over. */
  daysAfterToday: number;
};

export type RequiredPace = {
  remainingContribution: number;
  remainingOrders: number;
  remainingDelivered: number;
  remainingPieces: number;
  contributionPerDay: number;
  ordersPerDay: number;
  deliveredPerDay: number;
  piecesPerDay: number;
  daysRemainingInclusive: number;
};

/**
 * ⚠️ THE PROJECTION AND THE REQUIRED PACE DIVIDE BY DIFFERENT DAY COUNTS, and
 * conflating them double-counts today.
 *
 * The actual already contains whatever today has produced so far. Extrapolating
 * over a window that still includes today would add a second, full day on top
 * of the partial one already banked - so the PROJECTION runs over the days
 * strictly AFTER today.
 *
 * The REQUIRED PACE is the opposite: today is still a day you can act on, so
 * "what must I do per day from here" divides by the days remaining INCLUDING
 * today. The spec's own example does this - ₦2,250,000 over 20 remaining days
 * is ₦112,500/day.
 *
 * ⚠️ THE TREND USES SEVEN COMPLETE DAYS AND SO EXCLUDES TODAY. A half-finished
 * day would drag the average down for no reason other than the clock, which is
 * exactly the "one bad day" distortion the spec asks us to avoid.
 */
export function computeForecast(
  target: TargetDefinition,
  orders: TargetOrder[],
  adSpendRows: DatedAmount[],
  actual: { contribution: number; orders: number; delivered: number; pieces: number },
  today: string = lagosTodayKey(),
  commissions = 0
): TargetForecast {
  const start = target.periodStart;
  const end = target.periodEnd;
  // A finished period forecasts nothing - it reports what happened.
  const effectiveToday = today > end ? end : today < start ? start : today;
  const periodOver = today > end;

  const daysElapsed = daysInclusive(start, effectiveToday);
  const daysRemainingInclusive = periodOver ? 0 : daysInclusive(effectiveToday, end);
  const daysAfterToday = periodOver ? 0 : Math.max(0, daysRemainingInclusive - 1);

  // Seven complete days ending yesterday, clipped to the period's start.
  const trendEnd = addDays(effectiveToday, periodOver ? 0 : -1);
  const rawTrendStart = addDays(trendEnd, -6);
  const trendStart = rawTrendStart < start ? start : rawTrendStart;
  const trendDays = Math.max(1, daysInclusive(trendStart, trendEnd));

  const trendDelivered = deliveredOrdersIn(orders, trendStart, trendEnd);
  const trendPlaced = placedOrdersIn(orders, trendStart, trendEnd);
  const trendContribution = contributionInRange(orders, adSpendRows, trendStart, trendEnd, commissions);

  const dailyAverageContribution = trendContribution / trendDays;
  const dailyAverageOrders = trendPlaced.length / trendDays;
  const dailyAverageDelivered = trendDelivered.length / trendDays;
  const dailyAveragePieces = trendDelivered.reduce((s, o) => s + num(o.quantity), 0) / trendDays;

  const project = (current: number, perDay: number) => Math.round(current + perDay * daysAfterToday);
  const projectedContribution = project(actual.contribution, dailyAverageContribution);
  const projectedPercent = target.contributionTarget > 0
    ? Math.round((projectedContribution / target.contributionTarget) * 1000) / 10
    : null;

  // Achieved is checked FIRST: a target already met is not "on track" to be
  // met, and a late slump must not downgrade a result already banked.
  const status: TargetForecast["status"] =
    actual.contribution >= target.contributionTarget && target.contributionTarget > 0 ? "achieved"
      : projectedPercent == null ? "on_track"
      : projectedPercent >= 100 ? "on_track"
      : projectedPercent >= 90 ? "at_risk"
      : "behind";

  return {
    trendStart, trendEnd,
    dailyAverageContribution: Math.round(dailyAverageContribution),
    dailyAverageOrders: Math.round(dailyAverageOrders * 10) / 10,
    dailyAverageDelivered: Math.round(dailyAverageDelivered * 10) / 10,
    dailyAveragePieces: Math.round(dailyAveragePieces * 10) / 10,
    projectedContribution,
    projectedOrders: project(actual.orders, dailyAverageOrders),
    projectedDelivered: project(actual.delivered, dailyAverageDelivered),
    projectedPieces: project(actual.pieces, dailyAveragePieces),
    projectedPercent,
    status,
    daysElapsed,
    daysRemainingInclusive,
    daysAfterToday
  };
}

export function computeRequiredPace(
  target: TargetDefinition,
  actual: { contribution: number; orders: number; delivered: number; pieces: number },
  daysRemainingInclusive: number
): RequiredPace {
  const remaining = (goal: number, done: number) => Math.max(0, goal - done);
  const perDay = (left: number) => (daysRemainingInclusive > 0 ? left / daysRemainingInclusive : 0);

  const remainingContribution = remaining(target.contributionTarget, actual.contribution);
  const remainingOrders = remaining(target.orderTarget, actual.orders);
  const remainingDelivered = remaining(target.deliveredTarget, actual.delivered);
  const remainingPieces = remaining(target.piecesTarget, actual.pieces);

  return {
    remainingContribution, remainingOrders, remainingDelivered, remainingPieces,
    contributionPerDay: Math.round(perDay(remainingContribution)),
    // Rounded UP: 24.2 orders a day means doing 25, because you cannot place
    // a fifth of an order and rounding down quietly misses the target.
    ordersPerDay: Math.ceil(perDay(remainingOrders)),
    deliveredPerDay: Math.ceil(perDay(remainingDelivered)),
    piecesPerDay: Math.ceil(perDay(remainingPieces)),
    daysRemainingInclusive
  };
}

/** Linear pacing: where the period should be by the end of today. */
export function expectedByToday(target: number, daysElapsed: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return Math.round((target * Math.min(daysElapsed, totalDays)) / totalDays);
}
