import assert from "node:assert/strict";
import test from "node:test";
import {
  computeContribution, computeTargetProgress, placedOrdersIn, deliveredOrdersIn, buildWeeklyMilestones
} from "./target-progress.js";

const order = (over: Partial<Parameters<typeof computeContribution>[0][number]> = {}) => ({
  status: "Delivered",
  amount: 20000,
  quantity: 4,
  cogs_snapshot: 2200,
  logistics_cost: 4700,
  created_at: "2026-08-05T10:00:00Z",
  delivered_date: "2026-08-07",
  review_hold: false,
  ...over
});

const TARGET = {
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  contributionTarget: 3_100_000,
  orderTarget: 740,
  deliveredTarget: 560,
  piecesTarget: 2350,
  deliveryRateTarget: 75,
  adSpendCeiling: 4_400_000
};

test("contribution is the app's existing figure minus advertising", () => {
  const rows = [order({ amount: 100_000, cogs_snapshot: 10_000, logistics_cost: 20_000 })];
  const c = computeContribution(rows, 30_000, 5_000);

  // revenue - cogs - logistics - commissions, matching App.tsx's contribution.
  assert.equal(c.contributionBeforeAds, 65_000);
  // ...then advertising on top. That subtraction is the ONLY intended
  // difference from the P&L.
  assert.equal(c.contribution, 35_000);
  assert.equal(c.adSpend, 30_000);
});

test("logistics sources are alternatives, never summed", () => {
  // Per-order cost present: the expense fallback must be ignored entirely.
  // Summing them would double-count, which on real data was ~₦2.2m.
  const withOrderCost = computeContribution([order({ logistics_cost: 4_700 })], 0, 0, 999_999);
  assert.equal(withOrderCost.logistics, 4_700);

  // No per-order cost anywhere: fall back to the recorded Delivery expense.
  const withoutOrderCost = computeContribution([order({ logistics_cost: 0 })], 0, 0, 8_000);
  assert.equal(withoutOrderCost.logistics, 8_000);
});

test("review_hold orders are excluded from both bases", () => {
  const rows = [order(), order({ review_hold: true })];
  assert.equal(placedOrdersIn(rows, "2026-08-01", "2026-08-31").length, 1);
  assert.equal(deliveredOrdersIn(rows, "2026-08-01", "2026-08-31").length, 1);
});

test("delivery is throughput: July's order delivered in August counts in August", () => {
  const carriedOver = order({ created_at: "2026-07-28T10:00:00Z", delivered_date: "2026-08-03" });
  const placed = placedOrdersIn([carriedOver], "2026-08-01", "2026-08-31");
  const delivered = deliveredOrdersIn([carriedOver], "2026-08-01", "2026-08-31");

  // Created in July, so it is NOT in August's placed cohort...
  assert.equal(placed.length, 0);
  // ...but its revenue landed in August, so it IS in August's throughput.
  assert.equal(delivered.length, 1);
});

test("an unset target reports null percent, not a misleading zero", () => {
  const progress = computeTargetProgress({ ...TARGET, piecesTarget: 0 }, [order()], []);
  assert.equal(progress.pieces.percentAchieved, null);
  assert.equal(progress.pieces.actual, 4);
});

test("ad spend is a ceiling and flags when breached", () => {
  const spend = [{ date: "2026-08-10", amount: 5_000_000 }];
  const progress = computeTargetProgress(TARGET, [order()], spend);
  assert.equal(progress.adSpend.overCeiling, true);

  const under = computeTargetProgress(TARGET, [order()], [{ date: "2026-08-10", amount: 1_000 }]);
  assert.equal(under.adSpend.overCeiling, false);
});

test("ad spend outside the period is not counted", () => {
  const spend = [{ date: "2026-07-31", amount: 900_000 }, { date: "2026-08-02", amount: 100 }];
  const progress = computeTargetProgress(TARGET, [order()], spend);
  assert.equal(progress.breakdown.adSpend, 100);
});

test("weekly milestone targets sum to exactly the monthly target", () => {
  const weeks = buildWeeklyMilestones(TARGET, [], []);
  const summed = weeks.reduce((s, w) => s + w.targetContribution, 0);

  // The last week absorbs the remainder, so rounding never leaks a naira.
  assert.equal(summed, TARGET.contributionTarget);
  assert.ok(weeks.length >= 4 && weeks.length <= 6, `unexpected week count ${weeks.length}`);
  assert.equal(weeks[0].startDate, TARGET.periodStart);
  assert.equal(weeks.at(-1)?.endDate, TARGET.periodEnd);
});

test("delivery rate is delivered-by-date over orders created in the period", () => {
  const rows = [
    order({ created_at: "2026-08-01T00:00:00Z", delivered_date: "2026-08-02" }),
    order({ created_at: "2026-08-01T00:00:00Z", status: "New", delivered_date: null }),
    order({ created_at: "2026-08-01T00:00:00Z", status: "New", delivered_date: null }),
    order({ created_at: "2026-08-01T00:00:00Z", status: "New", delivered_date: null })
  ];
  const progress = computeTargetProgress(TARGET, rows, []);
  assert.equal(progress.ordersPlaced.actual, 4);
  assert.equal(progress.delivered.actual, 1);
  assert.equal(progress.deliveryRate.actual, 25);
});
