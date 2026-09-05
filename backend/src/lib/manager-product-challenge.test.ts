import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChallengeMilestones,
  repCheckpoint,
  countWorkingDays,
  distributeWholeNumber,
  evaluateChallengeProgress
} from "./manager-product-challenge.js";

test("marks a completed target as achieved without capping visible progress", () => {
  const result = evaluateChallengeProgress({
    startDate: "2026-08-09",
    endDate: "2026-08-15",
    targetUnits: 100,
    progressUnits: 125,
    status: "active",
    today: "2026-08-13"
  });
  assert.equal(result.progressPercent, 125);
  assert.equal(result.computedStatus, "Achieved");
});

test("uses elapsed time to distinguish at-risk and behind challenges", () => {
  const atRisk = evaluateChallengeProgress({
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    targetUnits: 100,
    progressUnits: 50,
    status: "active",
    today: "2026-08-06"
  });
  const behind = evaluateChallengeProgress({
    startDate: "2026-08-01",
    endDate: "2026-08-10",
    targetUnits: 100,
    progressUnits: 20,
    status: "active",
    today: "2026-08-06"
  });
  assert.equal(atRisk.computedStatus, "At Risk");
  assert.equal(behind.computedStatus, "Behind");
});

test("splits a monthly challenge into four milestone windows whose cumulative targets reach the full total", () => {
  const result = buildChallengeMilestones({
    cadence: "monthly",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    targetUnits: 1_003,
    rewardAmount: 100_001,
    milestoneMode: "weekly",
    milestoneDistribution: "even",
    status: "active",
    today: "2026-08-16",
    orders: []
  });
  assert.equal(result.milestones.length, 4);
  assert.deepEqual(result.milestones.map((item) => [item.startDate, item.endDate]), [
    ["2026-08-01", "2026-08-07"],
    ["2026-08-08", "2026-08-14"],
    ["2026-08-15", "2026-08-21"],
    ["2026-08-22", "2026-08-31"]
  ]);
  assert.deepEqual(result.milestones.map((item) => item.targetUnits), [251, 502, 753, 1_003]);
  assert.equal(result.milestones.reduce((sum, item) => sum + item.rewardAmount, 0), 100_001);
});

test("lets a later week's surplus cover an earlier week's shortfall instead of losing that milestone forever", () => {
  const result = buildChallengeMilestones({
    cadence: "monthly",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    targetUnits: 200,
    rewardAmount: 5_000,
    milestoneMode: "weekly",
    milestoneDistribution: "even",
    status: "active",
    today: "2026-08-14",
    orders: [
      { dateKey: "2026-08-03", units: 47 },
      { dateKey: "2026-08-12", units: 53 }
    ]
  });
  assert.deepEqual(result.milestones.map((item) => item.status), ["Earned", "Earned", "Upcoming", "Upcoming"]);
  assert.equal(result.earnedRewardAmount, 2_500);
});

test("only marks an unmet checkpoint as missed once the whole challenge deadline has passed, not each week in isolation", () => {
  const result = buildChallengeMilestones({
    cadence: "monthly",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    targetUnits: 200,
    rewardAmount: 5_000,
    milestoneMode: "weekly",
    milestoneDistribution: "even",
    status: "active",
    today: "2026-09-01",
    orders: [
      { dateKey: "2026-08-03", units: 47 },
      { dateKey: "2026-08-12", units: 53 },
      { dateKey: "2026-08-18", units: 40 },
      { dateKey: "2026-08-25", units: 40 }
    ]
  });
  assert.deepEqual(result.milestones.map((item) => item.status), ["Earned", "Earned", "Earned", "Missed"]);
  assert.equal(result.earnedRewardAmount, 3_750);
});

test("whole-number target distribution always reconciles to its parent target", () => {
  assert.deepEqual(distributeWholeNumber(10, 4), [3, 3, 2, 2]);
  assert.equal(distributeWholeNumber(1_003, 4).reduce((sum, item) => sum + item, 0), 1_003);
});

test("preserves an explicit paused state", () => {
  const result = evaluateChallengeProgress({
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    targetUnits: 500,
    progressUnits: 200,
    status: "paused",
    today: "2026-08-16"
  });
  assert.equal(result.computedStatus, "Paused");
});

// ── The live Edge Brusher challenge, 3 Sept 2026 ────────────────────────────
// Team target 2,727 pcs over 30 Aug - 30 Sept, split four ways: 682 each.
// Chelsea had delivered 60 pcs (24 + 12 + 24 on 31 Aug, 1 Sept, 2 Sept) when
// her dashboard told her 0 pcs remained for the week.
const EDGE_BRUSHER = {
  startDate: "2026-08-30",
  endDate: "2026-09-30",
  teamTarget: 2_727,
  repTarget: 682,
  today: "2026-09-03",
  orders: [
    { dateKey: "2026-08-31", units: 24 },
    { dateKey: "2026-09-01", units: 12 },
    { dateKey: "2026-09-02", units: 24 }
  ]
};

const edgeBrusherLadder = (targetUnits: number) => buildChallengeMilestones({
  cadence: "monthly",
  startDate: EDGE_BRUSHER.startDate,
  endDate: EDGE_BRUSHER.endDate,
  targetUnits,
  rewardAmount: targetUnits === EDGE_BRUSHER.teamTarget ? 20_000 : 5_000,
  milestoneMode: "weekly",
  milestoneDistribution: "even",
  status: "active",
  today: EDGE_BRUSHER.today,
  orders: EDGE_BRUSHER.orders
}).milestones.find((milestone) => EDGE_BRUSHER.today >= milestone.startDate && EDGE_BRUSHER.today <= milestone.endDate);

test("a rep-scoped milestone ladder is not scaled down a second time", () => {
  // Built from the rep's own 682, so its checkpoint is already personal.
  const milestone = edgeBrusherLadder(EDGE_BRUSHER.repTarget);
  assert.equal(milestone?.targetUnits, 171);

  const checkpoint = repCheckpoint({
    milestone,
    milestoneScaleBase: EDGE_BRUSHER.repTarget,
    allocationTarget: EDGE_BRUSHER.repTarget,
    challengeStartDate: EDGE_BRUSHER.startDate,
    today: EDGE_BRUSHER.today,
    orders: EDGE_BRUSHER.orders
  });

  assert.equal(checkpoint.targetUnits, 171);
  assert.equal(checkpoint.deliveredUnits, 60);
  // The regression: dividing by the team's 2,727 gave 43, which 60 cleared, so
  // the panel reported nothing left to do on a challenge reading "Behind".
  assert.notEqual(checkpoint.targetUnits, 43);
  assert.equal(checkpoint.remainingUnits, 111);
  assert.equal(checkpoint.daysLeft, 4);
});

test("manager and rep views of the same checkpoint agree", () => {
  const repView = repCheckpoint({
    milestone: edgeBrusherLadder(EDGE_BRUSHER.repTarget),
    milestoneScaleBase: EDGE_BRUSHER.repTarget,
    allocationTarget: EDGE_BRUSHER.repTarget,
    challengeStartDate: EDGE_BRUSHER.startDate,
    today: EDGE_BRUSHER.today,
    orders: EDGE_BRUSHER.orders
  });
  const managerView = repCheckpoint({
    milestone: edgeBrusherLadder(EDGE_BRUSHER.teamTarget),
    milestoneScaleBase: EDGE_BRUSHER.teamTarget,
    allocationTarget: EDGE_BRUSHER.repTarget,
    challengeStartDate: EDGE_BRUSHER.startDate,
    today: EDGE_BRUSHER.today,
    orders: EDGE_BRUSHER.orders
  });
  assert.equal(repView.targetUnits, managerView.targetUnits);
  assert.equal(repView.remainingUnits, managerView.remainingUnits);
});

test("checkpoint progress is cumulative, so an earlier shortfall stays owed", () => {
  // Week 2 of the same challenge. The checkpoint is a running total (342), so
  // week 1's shortfall is still outstanding here rather than being forgotten.
  const orders = [...EDGE_BRUSHER.orders, { dateKey: "2026-09-08", units: 30 }];
  const milestone = buildChallengeMilestones({
    cadence: "monthly",
    startDate: EDGE_BRUSHER.startDate,
    endDate: EDGE_BRUSHER.endDate,
    targetUnits: EDGE_BRUSHER.repTarget,
    rewardAmount: 5_000,
    milestoneMode: "weekly",
    milestoneDistribution: "even",
    status: "active",
    today: "2026-09-09",
    orders
  }).milestones.find((item) => "2026-09-09" >= item.startDate && "2026-09-09" <= item.endDate);

  assert.equal(milestone?.index, 2);
  assert.equal(milestone?.targetUnits, 342);

  const checkpoint = repCheckpoint({
    milestone,
    milestoneScaleBase: EDGE_BRUSHER.repTarget,
    allocationTarget: EDGE_BRUSHER.repTarget,
    challengeStartDate: EDGE_BRUSHER.startDate,
    today: "2026-09-09",
    orders
  });
  // 90 delivered in total, not the 30 that landed inside week 2's own window.
  assert.equal(checkpoint.deliveredUnits, 90);
  assert.equal(checkpoint.remainingUnits, 252);
});

// ── Sundays are not working days ────────────────────────────────────────────
test("working days exclude Sundays", () => {
  // 30 Aug 2026 is a Sunday, and the Edge Brusher window opens on it.
  assert.equal(countWorkingDays("2026-08-30", "2026-08-30"), 0);
  assert.equal(countWorkingDays("2026-08-31", "2026-09-06"), 6); // Mon-Sat, Sunday out
  assert.equal(countWorkingDays("2026-08-30", "2026-09-30"), 27); // 32 days, 5 Sundays
  assert.equal(countWorkingDays("2026-09-30", "2026-09-01"), 0); // end before start
});

test("a checkpoint counts only the working days still left", () => {
  const milestone = { index: 1, targetUnits: 171, endDate: "2026-09-06" };
  // Thursday 3 Sept -> 6 Sept is four calendar days, but the 6th is a Sunday.
  const checkpoint = repCheckpoint({
    milestone,
    milestoneScaleBase: 682,
    allocationTarget: 682,
    challengeStartDate: "2026-08-30",
    today: "2026-09-03",
    orders: []
  });
  assert.equal(checkpoint.daysLeft, 4);
  assert.equal(checkpoint.workingDaysLeft, 3);
});
