// Shared per-rep and per-team weekly metrics for the Head of Sales Rep
// dashboard (Overview, Weekly Scorecard, Team Performance, Upsell &
// Cross-sell all read the same numbers from here) - five views of the same
// question must not each invent their own arithmetic, or a screen can end up
// disagreeing with the Manager Dashboard's own bonus gate about the same
// rep in the same week.
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey, weekEndFromStart } from "./sales-bonus-engine.js";

export type HeadOfSalesOrder = {
  id: string;
  assigned_rep_id?: string | null;
  status?: string | null;
  amount?: number | null;
  quantity?: number | null;
  created_at?: string | null;
  delivered_date?: string | null;
  review_hold?: boolean | null;
  upsell_from_qty?: number | null;
  upsell_to_qty?: number | null;
  original_amount?: number | null;
  original_quantity?: number | null;
  cross_sell_lines?: unknown;
};

const numeric = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// created_at is a timestamptz - it must be read back as a Lagos calendar day
// before comparing against a week's date-key bounds, or an order placed late
// evening WAT lands in the wrong week. delivered_date is already a plain
// date column (manager-bonuses.ts compares it as a bare string with no
// timezone conversion), so it needs no such treatment.
const createdDateKey = (order: HeadOfSalesOrder): string =>
  order.created_at ? lagosDateKey(order.created_at) : "";
const deliveredDateKey = (order: HeadOfSalesOrder): string =>
  typeof order.delivered_date === "string" ? order.delivered_date.slice(0, 10) : "";

const crossSellLinesOf = (order: HeadOfSalesOrder): Array<{ amount?: unknown }> =>
  Array.isArray(order.cross_sell_lines) ? (order.cross_sell_lines as Array<{ amount?: unknown }>) : [];

const crossSellRevenueOf = (order: HeadOfSalesOrder): number =>
  crossSellLinesOf(order).reduce((sum, line) => sum + numeric(line?.amount), 0);

// Same definition as orderHasVerifiedUpsell (src/App.tsx) - both must agree
// on what counts as an upsell, or the scorecard and the order's own detail
// view would disagree about the same order.
export const orderHasVerifiedUpsell = (order: HeadOfSalesOrder): boolean =>
  Boolean(order.upsell_from_qty && order.upsell_to_qty && order.upsell_to_qty > order.upsell_from_qty);

export const orderHasCrossSell = (order: HeadOfSalesOrder): boolean => crossSellLinesOf(order).length > 0;

// Ported from expansionProfitBreakdownForOrder (src/App.tsx) so this engine
// and the Upsell Bonus panel can never disagree about incremental revenue.
// original_amount/original_quantity are only trustworthy for THIS specific
// upsell-delta math - never for "what is the main product's price" (see the
// comment on orderPurchaseBreakdown in customer-retention.ts, which uses
// amount - crossSellRevenue instead for that different question). Gated
// the same way the client gates it: no verified upsell, no delta.
export function incrementalRevenueForOrder(order: HeadOfSalesOrder): { upsell: number; crossSell: number } {
  const crossSell = crossSellRevenueOf(order);
  if (!orderHasVerifiedUpsell(order) || typeof order.original_amount !== "number" || typeof order.original_quantity !== "number") {
    return { upsell: 0, crossSell };
  }
  const upsell = numeric(order.amount) - order.original_amount - crossSell;
  return { upsell: Math.max(0, upsell), crossSell };
}

export type RepWeekMetrics = {
  repId: string;
  weekStart: string;
  ordersAssigned: number;
  ordersDelivered: number;
  deliveryRate: number;
  revenue: number;
  aov: number;
  upsellCount: number;
  upsellRate: number;
  crossSellCount: number;
  crossSellRate: number;
  incrementalRevenueUpsell: number;
  incrementalRevenueCrossSell: number;
};

/**
 * One rep's numbers for one Sunday-anchored week.
 *
 * From the week of 11 Oct 2026 (HOS_COHORT_FROM): of the orders this rep was
 * ASSIGNED and CREATED in the period (excluding review_hold), how many are
 * delivered - the Manager Dashboard team table's way. Earlier weeks: everything
 * delivered by delivery date in the period over that same cohort.
 */
/**
 * Same maths over an arbitrary date range rather than a Sunday week, so the
 * dashboard can answer Today / Yesterday / a custom range instead of snapping
 * everything onto its containing week.
 *
 * Rate metrics (AOV, upsell rate, cross-sell rate, delivery rate) stay
 * comparable across period lengths because they are averages. TOTALS
 * (revenue, incremental revenue, order counts) are not comparable to a weekly
 * baseline - a single day will always look small against a week - so callers
 * must not put a short range next to a weekly target without saying so.
 */
export function computeRepRangeMetrics(
  orders: HeadOfSalesOrder[],
  repId: string,
  rangeStart: string,
  rangeEnd: string
): RepWeekMetrics {
  return computeRepMetricsBetween(orders, repId, rangeStart, rangeEnd);
}

export function computeTeamRangeMetrics(
  orders: HeadOfSalesOrder[],
  repIds: string[],
  rangeStart: string,
  rangeEnd: string
): TeamWeekMetrics {
  return buildTeamMetrics(
    repIds.map((repId) => computeRepMetricsBetween(orders, repId, rangeStart, rangeEnd)),
    rangeStart
  );
}

export function computeRepWeekMetrics(orders: HeadOfSalesOrder[], repId: string, weekStart: string): RepWeekMetrics {
  return computeRepMetricsBetween(orders, repId, weekStart, weekEndFromStart(weekStart));
}

// ── Same figures as the Manager Dashboard (Bright, 16 Oct 2026) ─────────────
// From the week of 11 Oct 2026 the delivered set is THIS PERIOD'S ORDERS that
// are now delivered (the Manager Dashboard team table, the weekly report and
// the weekly bonus rule all count it this way). Before, it was everything
// delivered in the period, including orders placed earlier, over orders placed
// in the period - so Delight read 55% here and 50% on the Manager Dashboard
// for the same week. Delivery rate, AOV, upsell and cross-sell all follow, and
// so does the Head of Sales bonus (Bright chose to judge it on the same
// figure). Earlier weeks keep the old way, so paid weeks do not move.
export const HOS_COHORT_FROM = "2026-10-11";

function computeRepMetricsBetween(orders: HeadOfSalesOrder[], repId: string, weekStart: string, weekEnd: string): RepWeekMetrics {
  const cohort = orders.filter((order) => {
    if (order.assigned_rep_id !== repId || order.review_hold === true) return false;
    const key = createdDateKey(order);
    return key >= weekStart && key <= weekEnd;
  });
  const delivered = weekStart >= HOS_COHORT_FROM
    ? cohort.filter((order) => order.status === "Delivered")
    : orders.filter((order) => {
    // review_hold is excluded here as well as in the cohort above. It was only
    // filtered on one side, so a held order that got delivered inflated
    // revenue, AOV and the upsell/cross-sell counts while being absent from the
    // denominator - which could push delivery rate past 100%. Held orders are
    // excluded from every conversion report in this codebase; this was the one
    // place it was half-applied.
    if (order.assigned_rep_id !== repId || order.status !== "Delivered" || order.review_hold === true) return false;
    const key = deliveredDateKey(order);
    return key >= weekStart && key <= weekEnd;
  });

  const revenue = delivered.reduce((sum, order) => sum + numeric(order.amount), 0);
  const upsellCount = delivered.filter(orderHasVerifiedUpsell).length;
  const crossSellCount = delivered.filter(orderHasCrossSell).length;
  const incremental = delivered.reduce((acc, order) => {
    const { upsell, crossSell } = incrementalRevenueForOrder(order);
    acc.upsell += upsell;
    acc.crossSell += crossSell;
    return acc;
  }, { upsell: 0, crossSell: 0 });

  return {
    repId,
    weekStart,
    ordersAssigned: cohort.length,
    ordersDelivered: delivered.length,
    deliveryRate: cohort.length > 0 ? Math.round((delivered.length / cohort.length) * 1000) / 10 : 0,
    revenue,
    aov: delivered.length > 0 ? Math.round(revenue / delivered.length) : 0,
    upsellCount,
    upsellRate: delivered.length > 0 ? Math.round((upsellCount / delivered.length) * 1000) / 10 : 0,
    crossSellCount,
    crossSellRate: delivered.length > 0 ? Math.round((crossSellCount / delivered.length) * 1000) / 10 : 0,
    incrementalRevenueUpsell: Math.round(incremental.upsell),
    incrementalRevenueCrossSell: Math.round(incremental.crossSell)
  };
}

export type TeamWeekMetrics = {
  weekStart: string;
  reps: RepWeekMetrics[];
  team: Omit<RepWeekMetrics, "repId">;
};

/**
 * Team aggregate is delivered-weighted (every rep's raw counts summed, then
 * one rate computed off the totals) - NOT a flat average of each rep's own
 * rate, which would let a rep with 2 delivered orders at 100% count the same
 * as one with 60 delivered at 55%.
 */
export function computeTeamWeekMetrics(orders: HeadOfSalesOrder[], repIds: string[], weekStart: string): TeamWeekMetrics {
  return buildTeamMetrics(repIds.map((repId) => computeRepWeekMetrics(orders, repId, weekStart)), weekStart);
}

function buildTeamMetrics(reps: RepWeekMetrics[], weekStart: string): TeamWeekMetrics {
  const totals = reps.reduce((acc, rep) => ({
    ordersAssigned: acc.ordersAssigned + rep.ordersAssigned,
    ordersDelivered: acc.ordersDelivered + rep.ordersDelivered,
    revenue: acc.revenue + rep.revenue,
    upsellCount: acc.upsellCount + rep.upsellCount,
    crossSellCount: acc.crossSellCount + rep.crossSellCount,
    incrementalRevenueUpsell: acc.incrementalRevenueUpsell + rep.incrementalRevenueUpsell,
    incrementalRevenueCrossSell: acc.incrementalRevenueCrossSell + rep.incrementalRevenueCrossSell
  }), { ordersAssigned: 0, ordersDelivered: 0, revenue: 0, upsellCount: 0, crossSellCount: 0, incrementalRevenueUpsell: 0, incrementalRevenueCrossSell: 0 });

  return {
    weekStart,
    reps,
    team: {
      weekStart,
      ordersAssigned: totals.ordersAssigned,
      ordersDelivered: totals.ordersDelivered,
      deliveryRate: totals.ordersAssigned > 0 ? Math.round((totals.ordersDelivered / totals.ordersAssigned) * 1000) / 10 : 0,
      revenue: totals.revenue,
      aov: totals.ordersDelivered > 0 ? Math.round(totals.revenue / totals.ordersDelivered) : 0,
      upsellCount: totals.upsellCount,
      upsellRate: totals.ordersDelivered > 0 ? Math.round((totals.upsellCount / totals.ordersDelivered) * 1000) / 10 : 0,
      crossSellCount: totals.crossSellCount,
      crossSellRate: totals.ordersDelivered > 0 ? Math.round((totals.crossSellCount / totals.ordersDelivered) * 1000) / 10 : 0,
      incrementalRevenueUpsell: totals.incrementalRevenueUpsell,
      incrementalRevenueCrossSell: totals.incrementalRevenueCrossSell
    }
  };
}

export type TrailingBaseline = {
  weeks: number;
  team: Omit<RepWeekMetrics, "repId" | "weekStart">;
};

/**
 * Averages computeTeamWeekMetrics over the `weeks` Sunday-anchored weeks
 * strictly BEFORE weekStart (weekStart itself is "this week", never part of
 * its own baseline). Loops the same addDaysToDateKey(weekStart, -7*offset)
 * shape sales-expansion.ts already uses for its PIP consecutive-week check.
 */
export function computeTrailingBaseline(
  orders: HeadOfSalesOrder[],
  repIds: string[],
  weekStart: string,
  weeks = 4
): TrailingBaseline {
  const priorWeeks: TeamWeekMetrics["team"][] = [];
  for (let offset = 1; offset <= weeks; offset += 1) {
    const priorWeekStart = addDaysToDateKey(weekStart, -7 * offset);
    priorWeeks.push(computeTeamWeekMetrics(orders, repIds, priorWeekStart).team);
  }

  const sum = priorWeeks.reduce((acc, week) => ({
    ordersAssigned: acc.ordersAssigned + week.ordersAssigned,
    ordersDelivered: acc.ordersDelivered + week.ordersDelivered,
    deliveryRate: acc.deliveryRate + week.deliveryRate,
    revenue: acc.revenue + week.revenue,
    aov: acc.aov + week.aov,
    upsellCount: acc.upsellCount + week.upsellCount,
    upsellRate: acc.upsellRate + week.upsellRate,
    crossSellCount: acc.crossSellCount + week.crossSellCount,
    crossSellRate: acc.crossSellRate + week.crossSellRate,
    incrementalRevenueUpsell: acc.incrementalRevenueUpsell + week.incrementalRevenueUpsell,
    incrementalRevenueCrossSell: acc.incrementalRevenueCrossSell + week.incrementalRevenueCrossSell
  }), { ordersAssigned: 0, ordersDelivered: 0, deliveryRate: 0, revenue: 0, aov: 0, upsellCount: 0, upsellRate: 0, crossSellCount: 0, crossSellRate: 0, incrementalRevenueUpsell: 0, incrementalRevenueCrossSell: 0 });

  const n = Math.max(1, priorWeeks.length);
  const avg = (value: number, decimals = 0) => {
    const factor = 10 ** decimals;
    return Math.round((value / n) * factor) / factor;
  };

  return {
    weeks: priorWeeks.length,
    team: {
      ordersAssigned: avg(sum.ordersAssigned),
      ordersDelivered: avg(sum.ordersDelivered),
      deliveryRate: avg(sum.deliveryRate, 1),
      revenue: avg(sum.revenue),
      aov: avg(sum.aov),
      upsellCount: avg(sum.upsellCount),
      upsellRate: avg(sum.upsellRate, 1),
      crossSellCount: avg(sum.crossSellCount),
      crossSellRate: avg(sum.crossSellRate, 1),
      incrementalRevenueUpsell: avg(sum.incrementalRevenueUpsell),
      incrementalRevenueCrossSell: avg(sum.incrementalRevenueCrossSell)
    }
  };
}

export { sundayWeekStartForDateKey, weekEndFromStart, addDaysToDateKey, lagosDateKey };
