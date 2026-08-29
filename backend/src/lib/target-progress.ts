import { weekStartsForMonth } from "./salary-spread.js";

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
};

const lever = (actual: number, target: number): LeverProgress => ({
  actual,
  target,
  percentAchieved: target > 0 ? Math.round((actual / target) * 1000) / 10 : null
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
};

export function computeTargetProgress(
  target: TargetDefinition,
  orders: TargetOrder[],
  adSpendRows: DatedAmount[],
  commissions = 0,
  deliveryExpenseFallback = 0,
  commissionsByDay?: Map<string, number>
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

  return {
    breakdown,
    contribution: lever(breakdown.contribution, target.contributionTarget),
    ordersPlaced: lever(placed.length, target.orderTarget),
    delivered: lever(delivered.length, target.deliveredTarget),
    pieces: lever(pieces, target.piecesTarget),
    deliveryRate: lever(ratePct, target.deliveryRateTarget),
    adSpend: {
      ...lever(adSpend, target.adSpendCeiling),
      overCeiling: target.adSpendCeiling > 0 && adSpend > target.adSpendCeiling
    },
    weeklyMilestones: buildWeeklyMilestones(target, orders, adSpendRows, commissionsByDay)
  };
}
