import assert from "node:assert/strict";
import test from "node:test";
import {
  computeContribution, computeTargetProgress, placedOrdersIn, deliveredOrdersIn, buildWeeklyMilestones,
  computeForecast, computeRequiredPace, expectedByToday
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

// ── Forecasting and required pace ────────────────────────

const deliveredOn = (day: string, amount = 10_000) => ({
  status: "Delivered", amount, quantity: 2, cogs_snapshot: 0, logistics_cost: 0,
  created_at: `${day}T09:00:00Z`, delivered_date: day, review_hold: false
});

test("required pace divides by days remaining INCLUDING today", () => {
  // The spec's own worked example: ₦2,250,000 left across 20 remaining days
  // is ₦112,500 a day. Today is still a day you can act on.
  const pace = computeRequiredPace(
    { ...TARGET, contributionTarget: 3_000_000 },
    { contribution: 750_000, orders: 0, delivered: 0, pieces: 0 },
    20
  );
  assert.equal(pace.remainingContribution, 2_250_000);
  assert.equal(pace.contributionPerDay, 112_500);
});

test("required pace rounds order counts UP, never down", () => {
  // 121 orders over 5 days is 24.2/day. Doing 24 misses the target; the
  // instruction has to be 25.
  const pace = computeRequiredPace(
    { ...TARGET, orderTarget: 121 },
    { contribution: 0, orders: 0, delivered: 0, pieces: 0 },
    5
  );
  assert.equal(pace.ordersPerDay, 25);
});

test("projection extrapolates over days AFTER today, so today is not counted twice", () => {
  // Seven complete days (Aug 10-16) at ₦10,000 a day, today is Aug 17.
  // Actual already includes anything banked today.
  const orders = ["2026-08-10","2026-08-11","2026-08-12","2026-08-13","2026-08-14","2026-08-15","2026-08-16"]
    .map((d) => deliveredOn(d));
  const actual = { contribution: 70_000, orders: 7, delivered: 7, pieces: 14 };

  const forecast = computeForecast(TARGET, orders, [], actual, "2026-08-17");

  assert.equal(forecast.trendStart, "2026-08-10");
  assert.equal(forecast.trendEnd, "2026-08-16");   // yesterday, never today
  assert.equal(forecast.dailyAverageContribution, 10_000);

  // Aug 17..31 inclusive is 15 days to act on; only 14 of them come AFTER today.
  assert.equal(forecast.daysRemainingInclusive, 15);
  assert.equal(forecast.daysAfterToday, 14);
  // 70,000 banked + 14 further days at 10,000. Using 15 here would invent a
  // whole extra day on top of the partial one already in `actual`.
  assert.equal(forecast.projectedContribution, 210_000);
});

test("status bands follow the projection, not today's position", () => {
  const actual = { contribution: 0, orders: 0, delivered: 0, pieces: 0 };
  const at = (projected: number) => computeForecast(
    { ...TARGET, contributionTarget: 1000 }, [], [],
    { ...actual, contribution: projected }, "2026-08-31"
  ).status;

  assert.equal(at(1000), "achieved");   // target met outright
  assert.equal(at(950), "at_risk");     // 95%
  assert.equal(at(800), "behind");      // 80%
});

test("a target already met stays achieved even if the trend has collapsed", () => {
  // Banked the target early, then stopped selling entirely. A late slump must
  // not downgrade a result already in the bank.
  const forecast = computeForecast(
    { ...TARGET, contributionTarget: 100_000 }, [], [],
    { contribution: 120_000, orders: 0, delivered: 0, pieces: 0 },
    "2026-08-20"
  );
  assert.equal(forecast.dailyAverageContribution, 0);
  assert.equal(forecast.status, "achieved");
});

test("a finished period reports rather than forecasts", () => {
  const forecast = computeForecast(
    TARGET, [], [], { contribution: 500, orders: 0, delivered: 0, pieces: 0 }, "2026-09-15"
  );
  assert.equal(forecast.daysRemainingInclusive, 0);
  assert.equal(forecast.daysAfterToday, 0);
  // Nothing left to extrapolate over: the projection is simply the result.
  assert.equal(forecast.projectedContribution, 500);
});

test("the trend window is clipped to the start of the period", () => {
  // Three days into the month there are not seven complete days to average.
  const forecast = computeForecast(TARGET, [deliveredOn("2026-08-01", 30_000)], [],
    { contribution: 30_000, orders: 1, delivered: 1, pieces: 2 }, "2026-08-03");
  assert.equal(forecast.trendStart, "2026-08-01");
  assert.equal(forecast.trendEnd, "2026-08-02");
  // Averaged over the 2 days that exist, not over a phantom 7.
  assert.equal(forecast.dailyAverageContribution, 15_000);
});

test("expected-by-today paces linearly and variance signs correctly", () => {
  // Half way through a 31-day month, half the target should be banked.
  assert.equal(expectedByToday(3_100_000, 16, 31), 1_600_000);

  const progress = computeTargetProgress(
    TARGET, [deliveredOn("2026-08-05", 100_000)], [], 0, 0, undefined, "2026-08-16"
  );
  assert.ok(progress.contribution.variance < 0, "behind pace should read negative");
});

test("a rate is not paced linearly - it is compared to its target from day one", () => {
  const progress = computeTargetProgress(
    TARGET, [deliveredOn("2026-08-02")], [], 0, 0, undefined, "2026-08-03"
  );
  // Expecting "3/31ths of 75%" on the 3rd would be nonsense: a delivery rate
  // does not accumulate.
  assert.equal(progress.deliveryRate.expectedByToday, TARGET.deliveryRateTarget);
});
