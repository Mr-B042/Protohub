import assert from "node:assert/strict";
import test from "node:test";
import { buildRecoveryPlan } from "./recovery-plan.js";
import type { TargetDefinition, TargetProgress } from "./target-progress.js";

const TARGET: TargetDefinition = {
  periodStart: "2026-08-01", periodEnd: "2026-08-31",
  contributionTarget: 3_100_000, orderTarget: 740, deliveredTarget: 560,
  piecesTarget: 2350, deliveryRateTarget: 75, adSpendCeiling: 4_400_000
};

const lever = (actual: number, target: number, projected = actual) => ({
  actual, target,
  percentAchieved: target > 0 ? Math.round((actual / target) * 1000) / 10 : null,
  expectedByToday: target, variance: actual - target, projected
});

/** A healthy month, which individual tests then break in one specific way. */
const progressWith = (over: Partial<TargetProgress> = {}): TargetProgress => ({
  breakdown: {
    revenue: 9_700_000, cogs: 1_080_000, logistics: 2_270_000,
    commissions: 0, adSpend: 3_700_000,
    contributionBeforeAds: 6_350_000, contribution: 2_650_000
  },
  contribution: lever(2_650_000, 3_100_000, 3_200_000),
  ordersPlaced: lever(700, 740, 745),
  delivered: lever(530, 560, 565),
  pieces: lever(2_240, 2_350, 2_360),
  deliveryRate: lever(76, 75, 76),
  adSpend: { ...lever(3_700_000, 4_400_000), overCeiling: false },
  weeklyMilestones: [],
  forecast: {
    trendStart: "2026-08-20", trendEnd: "2026-08-26",
    dailyAverageContribution: 60_000, dailyAverageOrders: 25,
    dailyAverageDelivered: 19, dailyAveragePieces: 79,
    projectedContribution: 3_200_000, projectedOrders: 745,
    projectedDelivered: 565, projectedPieces: 2_360,
    projectedPercent: 103.2, status: "on_track",
    daysElapsed: 27, daysRemainingInclusive: 5, daysAfterToday: 4
  },
  requiredPace: {
    remainingContribution: 450_000, remainingOrders: 40,
    remainingDelivered: 30, remainingPieces: 110,
    contributionPerDay: 90_000, ordersPerDay: 8,
    deliveredPerDay: 6, piecesPerDay: 22, daysRemainingInclusive: 5
  },
  ...over
});

test("Plan A when the projection clears the target", () => {
  const plan = buildRecoveryPlan(TARGET, progressWith());
  assert.equal(plan.planCode, "A");
  assert.equal(plan.problem, "none");
  assert.match(plan.headline, /on track/i);
});

test("Plan B quantifies the order shortfall and offers an upsell alternative", () => {
  const plan = buildRecoveryPlan(TARGET, progressWith({
    ordersPlaced: lever(560, 740, 686),
    forecast: { ...progressWith().forecast, projectedOrders: 686, projectedContribution: 2_700_000, projectedPercent: 87.1, status: "behind" }
  }));

  assert.equal(plan.planCode, "B");
  // The spec's rule: never "orders are behind", always by how many.
  assert.match(plan.headline, /54 below target/);
  // And always with an alternative route that needs no extra traffic.
  assert.ok(plan.actions.some((a) => /pieces per delivery/i.test(a.label)));
});

test("Plan C counts deliveries that are already paid for", () => {
  const plan = buildRecoveryPlan(TARGET, progressWith({
    ordersPlaced: lever(600, 740, 700),
    delivered: lever(420, 560, 450),
    deliveryRate: lever(70, 75, 70),
    forecast: { ...progressWith().forecast, projectedOrders: 700, projectedContribution: 2_600_000, projectedPercent: 83.9, status: "behind" }
  }));

  assert.equal(plan.planCode, "C");
  assert.equal(plan.problem, "delivery_rate");
  // 75% of 600 placed is 450; 420 have landed, so 30 are recoverable.
  assert.match(plan.actions[0].label, /Recover 30 pending deliveries/);
});

test("Plan D converts a piece gap into a number of package upgrades", () => {
  const plan = buildRecoveryPlan(TARGET, progressWith({
    delivered: lever(500, 560, 520),
    pieces: lever(1_950, 2_350, 2_000),
    forecast: { ...progressWith().forecast, projectedOrders: 745, projectedContribution: 2_700_000, projectedPercent: 87.1, status: "behind" }
  }));

  assert.equal(plan.planCode, "D");
  // 3.9 now vs 4.2 target across 500 deliveries = 150 upgrades.
  assert.match(plan.headline, /3\.9 pieces per delivery against a target of 4\.2/);
  assert.match(plan.actions[0].label, /Upgrade 150 customers/);
});

test("Plan E fires when activity is fine but the money is not", () => {
  // Every activity lever at or above target, contribution still short: telling
  // anyone to sell more here would be the wrong instruction.
  const plan = buildRecoveryPlan(TARGET, progressWith({
    ordersPlaced: lever(760, 740, 760),
    delivered: lever(575, 560, 575),
    pieces: lever(2_420, 2_350, 2_420),
    deliveryRate: lever(76, 75, 76),
    adSpend: { ...lever(4_900_000, 4_400_000), overCeiling: true },
    forecast: { ...progressWith().forecast, projectedOrders: 760, projectedContribution: 2_500_000, projectedPercent: 80.6, status: "behind" }
  }));

  assert.equal(plan.planCode, "E");
  assert.equal(plan.problem, "contribution");
  assert.match(plan.headline, /margin, not volume/);
  // Over-ceiling advertising is promoted to the top action, with the overspend
  // as its impact - that is the most direct naira available.
  assert.match(plan.actions[0].label, /over its ceiling/i);
  assert.equal(plan.actions[0].impact, 500_000);
});

test("the weakest lever is chosen by measurement, not a fixed order", () => {
  // Orders are only slightly behind; the delivery rate is far worse. A
  // hard-coded precedence would still return Plan B.
  const plan = buildRecoveryPlan(TARGET, progressWith({
    ordersPlaced: lever(730, 740, 735),
    delivered: lever(365, 560, 380),
    deliveryRate: lever(50, 75, 50),
    forecast: { ...progressWith().forecast, projectedOrders: 735, projectedContribution: 2_400_000, projectedPercent: 77.4, status: "behind" }
  }));
  assert.equal(plan.planCode, "C");
});

test("every action carries a number, never a bare instruction", () => {
  const plan = buildRecoveryPlan(TARGET, progressWith({
    ordersPlaced: lever(560, 740, 686),
    forecast: { ...progressWith().forecast, projectedOrders: 686, projectedContribution: 2_700_000, projectedPercent: 87.1, status: "behind" }
  }));
  for (const action of plan.actions) {
    assert.ok(/\d/.test(`${action.label} ${action.detail}`), `no number in: ${action.label}`);
  }
});
