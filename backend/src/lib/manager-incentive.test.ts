import assert from "node:assert/strict";
import test from "node:test";
import { computeIncentive, INCENTIVE_GATES } from "./manager-incentive.js";

const LEVELS = { minimum: 2_800_000, target: 3_100_000, exceptional: 3_400_000 };
const RULE = {
  baseReward: 100_000,
  minimumMultiplier: 50, targetMultiplier: 100, exceptionalMultiplier: 125
};

test("the tier ladder pays the spec's worked example", () => {
  // Owner sets a ₦100,000 base: 50% / 100% / 125%.
  assert.equal(computeIncentive(2_700_000, 2_700_000, LEVELS, RULE, 5).amount, 0);
  assert.equal(computeIncentive(2_800_000, 2_800_000, LEVELS, RULE, 5).amount, 50_000);
  assert.equal(computeIncentive(3_100_000, 3_100_000, LEVELS, RULE, 5).amount, 100_000);
  assert.equal(computeIncentive(3_400_000, 3_400_000, LEVELS, RULE, 5).amount, 125_000);
});

test("an exceptional result never falls through to the target band", () => {
  const out = computeIncentive(5_000_000, 5_000_000, LEVELS, RULE, 3);
  assert.equal(out.tier, "exceptional");
  assert.equal(out.multiplier, 125);
});

test("boundaries are inclusive at the bottom of each band", () => {
  // Exactly on a threshold earns that band, not the one below it.
  assert.equal(computeIncentive(2_800_000, 2_800_000, LEVELS, RULE, 5).tier, "minimum");
  assert.equal(computeIncentive(2_799_999, 2_799_999, LEVELS, RULE, 5).tier, "none");
});

test("next tier states the shortfall and what it costs per remaining day", () => {
  const out = computeIncentive(2_650_600, 2_709_829, LEVELS, RULE, 2);
  assert.equal(out.tier, "none");
  assert.equal(out.nextTier?.name, "Minimum");
  assert.equal(out.nextTier?.shortfall, 149_400);
  // ₦149,400 across the 2 days left.
  assert.equal(out.nextTier?.perDay, 74_700);
});

test("a finished period reports no per-day requirement rather than dividing by zero", () => {
  const out = computeIncentive(2_000_000, 2_000_000, LEVELS, RULE, 0);
  assert.equal(out.nextTier?.perDay, 0);
  assert.ok(Number.isFinite(out.nextTier?.perDay ?? 0));
});

test("the projected reward is reported separately from the earned one", () => {
  // Earned nothing yet, but the trend clears the target: the manager needs to
  // see both, and they must not be conflated.
  const out = computeIncentive(2_000_000, 3_200_000, LEVELS, RULE, 6);
  assert.equal(out.amount, 0);
  assert.equal(out.projectedTier, "target");
  assert.equal(out.projectedAmount, 100_000);
});

test("settling needs EVERY gate, not a majority", () => {
  const allButOne = Object.fromEntries(INCENTIVE_GATES.map((g) => [g, true]));
  allButOne.agent_cash_reconciled = false;

  const partial = computeIncentive(3_100_000, 3_100_000, LEVELS,
    { ...RULE, verificationGates: allButOne }, 0);
  assert.equal(partial.settleable, false);
  assert.deepEqual(partial.gatesOutstanding, ["agent_cash_reconciled"]);

  const complete = computeIncentive(3_100_000, 3_100_000, LEVELS,
    { ...RULE, verificationGates: Object.fromEntries(INCENTIVE_GATES.map((g) => [g, true])) }, 0);
  assert.equal(complete.settleable, true);
});

test("no gates recorded means nothing is settleable", () => {
  const out = computeIncentive(3_400_000, 3_400_000, LEVELS, RULE, 0);
  assert.equal(out.settleable, false);
  assert.equal(out.gatesOutstanding.length, INCENTIVE_GATES.length);
});
