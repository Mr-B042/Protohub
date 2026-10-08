import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MILESTONES, DEFAULT_SCORING, contributionOf, maxBudget, pointsFor, raceResults, splitEqually, teamEntitlements, type ContributionInput, needsManager, normaliseScoring } from "./team-challenge.js";

const costs: Record<string, number> = { rack: 11_500, brush: 4_000, hook: 300 };
const input = (overrides: Partial<ContributionInput>): ContributionInput => ({
  productId: "rack", amount: 39_500, originalAmount: 39_500, originalQuantity: 1, upsellFromQty: null, upsellToQty: null, quantity: 1,
  crossSellLines: [], giftLines: [], unitCost: (id) => costs[id ?? ""] ?? 0, repBonus: 0, extraLogistics: 0, adjustment: 0, packagingPerUnit: 500, ...overrides
});

test("contribution: Bright's example - 39,500 → 68,500 leaves 14,600 = 1 point", () => {
  const result = contributionOf(input({ amount: 68_500, upsellFromQty: 1, upsellToQty: 2, quantity: 2, repBonus: 2_400 }))!;
  assert.equal(result.revenue, 29_000);
  assert.equal(result.productCost, 11_500);
  assert.equal(result.packaging, 500);
  assert.equal(result.contribution, 14_600);
  assert.equal(pointsFor(result.contribution, DEFAULT_SCORING), 1);
});

test("points: 0 / 1 / 2, then +1 every further 50,000 (100k = 3, 150k = 4) - no cap", () => {
  assert.equal(pointsFor(9_999, DEFAULT_SCORING), 0);
  assert.equal(pointsFor(10_000, DEFAULT_SCORING), 1);
  assert.equal(pointsFor(49_999, DEFAULT_SCORING), 1);
  assert.equal(pointsFor(52_000, DEFAULT_SCORING), 2);
  assert.equal(pointsFor(99_999, DEFAULT_SCORING), 2);
  assert.equal(pointsFor(100_000, DEFAULT_SCORING), 3);
  assert.equal(pointsFor(150_000, DEFAULT_SCORING), 4);
  assert.equal(pointsFor(500_000, DEFAULT_SCORING), 11);
  assert.equal(pointsFor(500_000, { ...DEFAULT_SCORING, extraPointEvery: 0 }), 2);
});

test("contribution: upsell + cross-sell are assessed together as one transaction", () => {
  const result = contributionOf(input({
    amount: 39_500 + 50_000 + 20_000, upsellFromQty: 1, upsellToQty: 2, quantity: 2,
    crossSellLines: [{ amount: 20_000, quantity: 1, productId: "brush" }], repBonus: 0, packagingPerUnit: 0
  }))!;
  assert.equal(result.hasUpsell && result.hasCrossSell, true);
  assert.equal(result.contribution, 70_000 - 11_500 - 4_000);
  assert.equal(pointsFor(result.contribution, DEFAULT_SCORING), 2);
});

test("contribution: rep-added gifts, extra delivery and a manager adjustment come off; nothing added = null", () => {
  const result = contributionOf(input({ amount: 56_000, crossSellLines: [{ amount: 16_500, quantity: 1, productId: "brush" }], giftLines: [{ quantity: 10, productId: "hook" }], extraLogistics: 2_000, adjustment: -1_000 }))!;
  assert.equal(result.gifts, 3_000);
  assert.equal(result.contribution, 16_500 - 4_000 - 3_000 - 2_000 - 500 - 1_000);
  assert.equal(contributionOf(input({ amount: 79_000, quantity: 2 })), null);
  assert.equal(contributionOf(input({ crossSellLines: [{ amount: 0, productId: "hook" }] })), null);
});

const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 9, minute)).toISOString();
const teams = [{ id: "A", memberIds: ["a1", "a2"] }, { id: "B", memberIds: ["b1", "b2"] }];
const e = (teamId: string, repId: string, points: number, minute: number, status = "verified") => ({ teamId, repId, points, qualifiedAt: at(minute), status });

test("race: A wins both - 50,000 then 100,000; B second - 10,000 then 30,000; budget 190,000", () => {
  const entries = [e("A", "a1", 25, 1), e("A", "a2", 25, 2), e("B", "b1", 25, 3), e("B", "b2", 25, 4), e("A", "a1", 25, 5), e("A", "a2", 25, 6), e("B", "b1", 25, 7), e("B", "b2", 25, 8)];
  const results = raceResults(teams, entries, DEFAULT_MILESTONES, null);
  assert.deepEqual(teamEntitlements("A", results).map((row) => row.step), [50_000, 100_000]);
  assert.deepEqual(teamEntitlements("B", results).map((row) => row.step), [10_000, 30_000]);
  assert.equal(maxBudget(DEFAULT_MILESTONES), 190_000);
});

test("race: 50 reached but a member has 8 - member requirement pending, 2 more needed; reached when they get there", () => {
  const entries = [e("A", "a1", 42, 1), e("A", "a2", 8, 2)];
  const [m1] = raceResults(teams, entries, DEFAULT_MILESTONES, null);
  assert.equal(m1.reached.length, 0);
  assert.deepEqual(m1.memberPending, [{ teamId: "A", short: [{ repId: "a2", need: 2 }] }]);
  const [later] = raceResults(teams, [...entries, e("A", "a2", 2, 9)], DEFAULT_MILESTONES, null);
  assert.deepEqual(later.reached, [{ teamId: "A", at: at(9) }]);
});

test("race: qualification time decides, not review order; earlier pending keeps it provisional; ties split", () => {
  const entries = [e("B", "b1", 25, 0), e("B", "b2", 24, 0), e("A", "a1", 25, 0), e("A", "a2", 24, 0), e("B", "b2", 2, 15), e("A", "a2", 2, 10)];
  const [m1] = raceResults(teams, entries, DEFAULT_MILESTONES, null);
  assert.deepEqual(m1.winnerTeamIds, ["A"]);
  assert.equal(raceResults(teams, [...entries, e("B", "b1", 2, 5, "awaiting_verification")], DEFAULT_MILESTONES, null)[0].provisional, true);
  const tie = raceResults(teams, [e("A", "a1", 25, 5), e("A", "a2", 25, 5), e("B", "b1", 25, 5), e("B", "b2", 25, 5)], DEFAULT_MILESTONES, null);
  assert.equal(teamEntitlements("A", tie)[0].entitlement, 30_000);
});

test("split: equal shares, kobo-exact", () => {
  assert.deepEqual(splitEqually(50_000, ["x", "y"]), [{ repId: "x", amount: 25_000 }, { repId: "y", amount: 25_000 }]);
  assert.equal(splitEqually(100, ["a", "b", "c"]).reduce((sum, row) => sum + row.amount, 0), 100);
});

test("a clean delivered + paid order needs no manager; anything unusual says why", () => {
  const clean = { linkedOrders: 0, adjustment: 0, editedAfterDelivery: false, hasNoteOrEscalation: false, pointsChangedAfterVerification: false };
  assert.deepEqual(needsManager(clean), []);
  assert.match(needsManager({ ...clean, editedAfterDelivery: true })[0], /edited after it was delivered/);
  assert.match(needsManager({ ...clean, adjustment: -2000 })[0], /adjusted by hand/);
  assert.match(needsManager({ ...clean, linkedOrders: 2 })[0], /2 other orders of the same customer/);
  assert.match(needsManager({ ...clean, pointsChangedAfterVerification: true })[0], /points changed/);
  assert.match(needsManager({ ...clean, hasNoteOrEscalation: true })[0], /note or it was escalated/);
});

test("automatic verification is on unless the Owner switches it off", () => {
  assert.equal(normaliseScoring({}).autoVerifyClean, true);
  assert.equal(normaliseScoring({ autoVerifyClean: false }).autoVerifyClean, false);
});
