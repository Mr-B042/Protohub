import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChallengeMilestones,
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

test("splits a monthly challenge into four milestone windows without losing units or reward", () => {
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
  assert.equal(result.milestones.reduce((sum, item) => sum + item.targetUnits, 0), 1_003);
  assert.equal(result.milestones.reduce((sum, item) => sum + item.rewardAmount, 0), 100_001);
});

test("earns each milestone independently and does not carry excess units into another week", () => {
  const result = buildChallengeMilestones({
    cadence: "monthly",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    targetUnits: 1_000,
    rewardAmount: 100_000,
    milestoneMode: "weekly",
    milestoneDistribution: "custom",
    milestoneTargets: [250, 250, 250, 250],
    status: "active",
    today: "2026-08-23",
    orders: [
      { dateKey: "2026-08-03", units: 300 },
      { dateKey: "2026-08-10", units: 260 },
      { dateKey: "2026-08-20", units: 150 },
      { dateKey: "2026-08-23", units: 100 }
    ]
  });
  assert.deepEqual(result.milestones.map((item) => item.status), ["Earned", "Earned", "Missed", "In Progress"]);
  assert.equal(result.earnedRewardAmount, 50_000);
  assert.equal(result.milestones[3].progressUnits, 100);
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
