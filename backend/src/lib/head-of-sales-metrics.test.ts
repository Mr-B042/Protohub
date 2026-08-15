import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRepWeekMetrics,
  computeTeamWeekMetrics,
  computeTrailingBaseline,
  incrementalRevenueForOrder,
  orderHasCrossSell,
  orderHasVerifiedUpsell,
  type HeadOfSalesOrder
} from "./head-of-sales-metrics.js";

const WEEK = "2026-08-09"; // a Sunday

const order = (overrides: Partial<HeadOfSalesOrder>): HeadOfSalesOrder => ({
  id: overrides.id ?? Math.random().toString(36).slice(2),
  assigned_rep_id: "rep-1",
  status: "Delivered",
  amount: 20_000,
  created_at: `${WEEK}T09:00:00Z`,
  delivered_date: WEEK,
  review_hold: false,
  ...overrides
});

test("orderHasVerifiedUpsell requires a real increase, not just any qty fields", () => {
  assert.equal(orderHasVerifiedUpsell(order({ upsell_from_qty: 1, upsell_to_qty: 2 })), true);
  assert.equal(orderHasVerifiedUpsell(order({ upsell_from_qty: 2, upsell_to_qty: 2 })), false);
  assert.equal(orderHasVerifiedUpsell(order({ upsell_from_qty: 2, upsell_to_qty: 1 })), false);
  assert.equal(orderHasVerifiedUpsell(order({})), false);
});

test("orderHasCrossSell reads real cross_sell_lines only", () => {
  assert.equal(orderHasCrossSell(order({ cross_sell_lines: [{ amount: 5000 }] })), true);
  assert.equal(orderHasCrossSell(order({ cross_sell_lines: [] })), false);
  assert.equal(orderHasCrossSell(order({})), false);
});

test("incrementalRevenueForOrder matches expansionProfitBreakdownForOrder's formula", () => {
  // A pure upsell: 20,000 final vs 15,000 original, no cross-sell.
  const upsellOnly = order({
    amount: 20_000, original_amount: 15_000, original_quantity: 1,
    upsell_from_qty: 1, upsell_to_qty: 2
  });
  assert.deepEqual(incrementalRevenueForOrder(upsellOnly), { upsell: 5_000, crossSell: 0 });

  // Upsell PLUS a cross-sell riding on the same order - the cross-sell
  // revenue must be subtracted out of the upsell delta, not double-counted.
  const mixed = order({
    amount: 27_000, original_amount: 15_000, original_quantity: 1,
    upsell_from_qty: 1, upsell_to_qty: 2,
    cross_sell_lines: [{ amount: 7_000 }]
  });
  assert.deepEqual(incrementalRevenueForOrder(mixed), { upsell: 5_000, crossSell: 7_000 });

  // Cross-sell with no upsell at all - crossSell still counts, upsell is 0.
  const crossSellOnly = order({ amount: 22_000, cross_sell_lines: [{ amount: 2_000 }] });
  assert.deepEqual(incrementalRevenueForOrder(crossSellOnly), { upsell: 0, crossSell: 2_000 });

  // Missing original_amount/original_quantity - never trust the delta.
  const noBaseline = order({ amount: 20_000, upsell_from_qty: 1, upsell_to_qty: 2 });
  assert.deepEqual(incrementalRevenueForOrder(noBaseline), { upsell: 0, crossSell: 0 });
});

test("computeRepWeekMetrics: delivery rate is throughput, not same-cohort conversion", () => {
  const orders = [
    // 3 created (cohort) this week for rep-1, only 1 of them also delivered this week.
    order({ id: "a", created_at: `${WEEK}T08:00:00Z`, status: "New", delivered_date: null }),
    order({ id: "b", created_at: `${WEEK}T08:00:00Z`, status: "Confirmed", delivered_date: null }),
    order({ id: "c", created_at: `${WEEK}T08:00:00Z`, status: "Delivered", delivered_date: WEEK, amount: 10_000 }),
    // Delivered THIS week but created in an earlier week - still counts toward
    // deliveredCount/AOV/rates, but not toward the cohort denominator.
    order({ id: "d", created_at: "2026-07-20T08:00:00Z", status: "Delivered", delivered_date: WEEK, amount: 30_000 }),
    // A different rep entirely - must not leak into rep-1's numbers.
    order({ id: "e", assigned_rep_id: "rep-2", status: "Delivered", delivered_date: WEEK, amount: 99_000 }),
    // review_hold - excluded from the cohort even though created this week.
    order({ id: "f", created_at: `${WEEK}T08:00:00Z`, review_hold: true, status: "New", delivered_date: null })
  ];

  const metrics = computeRepWeekMetrics(orders, "rep-1", WEEK);
  assert.equal(metrics.ordersAssigned, 3); // a, b, c (f excluded by review_hold)
  assert.equal(metrics.ordersDelivered, 2); // c, d
  assert.equal(metrics.deliveryRate, Math.round((2 / 3) * 1000) / 10);
  assert.equal(metrics.revenue, 40_000);
  assert.equal(metrics.aov, 20_000);
});

test("computeRepWeekMetrics: a Lagos-evening order still counts as created this week", () => {
  // 23:30 WAT on the Saturday before WEEK is 22:30 UTC the same day - still
  // the day before WEEK starts either way here, so use the Sunday itself:
  // 00:30 WAT on the week's first day is 2026-08-08T23:30:00Z (previous UTC
  // date) - a naive UTC slice would wrongly push this into last week.
  const lateNightOrder = order({ id: "late", created_at: "2026-08-08T23:30:00Z", status: "New", delivered_date: null });
  const metrics = computeRepWeekMetrics([lateNightOrder], "rep-1", WEEK);
  assert.equal(metrics.ordersAssigned, 1);
});

test("computeTeamWeekMetrics is delivered-weighted, not a flat average of rep rates", () => {
  const orders = [
    // rep-1: 1 of 1 delivered upsold (100% upsell rate on 1 order)
    order({ id: "r1a", assigned_rep_id: "rep-1", upsell_from_qty: 1, upsell_to_qty: 2, amount: 20_000 }),
    // rep-2: 0 of 3 delivered upsold (0% upsell rate on 3 orders)
    order({ id: "r2a", assigned_rep_id: "rep-2", amount: 10_000 }),
    order({ id: "r2b", assigned_rep_id: "rep-2", amount: 10_000 }),
    order({ id: "r2c", assigned_rep_id: "rep-2", amount: 10_000 })
  ];

  const team = computeTeamWeekMetrics(orders, ["rep-1", "rep-2"], WEEK).team;
  // A flat average of 100% and 0% would read 50%. Weighted by delivered
  // orders (1 upsold out of 4 delivered total) it must read 25%.
  assert.equal(team.ordersDelivered, 4);
  assert.equal(team.upsellCount, 1);
  assert.equal(team.upsellRate, 25);
});

test("computeTrailingBaseline averages the 4 weeks strictly before weekStart, excluding it", () => {
  const orders = [
    // This week - must NOT be part of its own baseline.
    order({ id: "this-week", created_at: `${WEEK}T08:00:00Z`, delivered_date: WEEK, amount: 999_000 }),
    // 1 week before.
    order({ id: "w-1", created_at: "2026-08-02T08:00:00Z", delivered_date: "2026-08-02", amount: 10_000 }),
    // 2 weeks before.
    order({ id: "w-2", created_at: "2026-07-26T08:00:00Z", delivered_date: "2026-07-26", amount: 20_000 })
  ];

  const baseline = computeTrailingBaseline(orders, ["rep-1"], WEEK, 4);
  assert.equal(baseline.weeks, 4);
  // Only w-1 (10,000) and w-2 (20,000) contribute; the other 2 of the 4
  // weeks are empty. Averaged over all 4 weeks: (10,000 + 20,000) / 4.
  assert.equal(baseline.team.revenue, 7_500);
});
