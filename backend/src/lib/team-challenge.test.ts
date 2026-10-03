import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MILESTONES, DEFAULT_SCORING, maxBudget, raceResults, scoreOrder, splitEqually, teamEntitlements } from "./team-challenge.js";

const order = (overrides: Partial<Parameters<typeof scoreOrder>[0]>) => ({
  productId: "rack", amount: 39500, originalAmount: null, upsellFromQty: null, upsellToQty: null, quantity: 1, crossSellLines: [], ...overrides
});

test("score: one rack → two is an upgrade worth 2", () => {
  const score = scoreOrder(order({ amount: 79000, originalAmount: 39500, upsellFromQty: 1, upsellToQty: 2, quantity: 2 }), DEFAULT_SCORING);
  assert.equal(score?.points, 2);
  assert.equal(score?.category, "upsell");
  assert.equal(score?.addedValue, 39500);
});

test("score: an order placed for two (no upgrade) earns nothing", () => {
  assert.equal(scoreOrder(order({ amount: 79000, quantity: 2 }), DEFAULT_SCORING), null);
});

test("score: a free gift earns nothing; a paid add-on is a cross-sell worth 1", () => {
  assert.equal(scoreOrder(order({ crossSellLines: [{ amount: 0, productId: "hook" }] }), DEFAULT_SCORING), null);
  const score = scoreOrder(order({ amount: 56000, crossSellLines: [{ amount: 16500, productId: "brush", addedById: "rep-1" }] }), DEFAULT_SCORING);
  assert.equal(score?.points, 1);
  assert.equal(score?.category, "cross_sell");
  assert.equal(score?.crossSellOwner, "rep-1");
});

test("score: upgrade + cross-sell scores the highest once (2, not 3)", () => {
  const score = scoreOrder(order({ amount: 95500, originalAmount: 39500, upsellFromQty: 1, upsellToQty: 2, crossSellLines: [{ amount: 16500 }] }), DEFAULT_SCORING);
  assert.equal(score?.points, 2);
  assert.equal(score?.category, "both");
});

test("score: one → three is the higher upgrade worth 3; minimum added value filters", () => {
  assert.equal(scoreOrder(order({ amount: 118500, originalAmount: 39500, upsellFromQty: 1, upsellToQty: 3 }), DEFAULT_SCORING)?.points, 3);
  assert.equal(scoreOrder(order({ amount: 45000, crossSellLines: [{ amount: 5500 }] }), { ...DEFAULT_SCORING, minAddedValue: 10000 }), null);
});

const at = (minute: number) => new Date(Date.UTC(2026, 9, 5, 9, minute)).toISOString();

test("race: Bright's example - A first to 50, B second; B first to 100, A second", () => {
  const entries = [
    { teamId: "A", points: 50, qualifiedAt: at(1), status: "verified" },
    { teamId: "B", points: 50, qualifiedAt: at(2), status: "verified" },
    { teamId: "B", points: 50, qualifiedAt: at(3), status: "verified" },
    { teamId: "A", points: 50, qualifiedAt: at(4), status: "verified" }
  ];
  const results = raceResults(["A", "B"], entries, DEFAULT_MILESTONES, null);
  const a = teamEntitlements("A", results);
  const b = teamEntitlements("B", results);
  assert.deepEqual(a.map((row) => row.step), [50000, 10000]);
  assert.deepEqual(b.map((row) => row.step), [20000, 130000]);
  assert.equal(a[1].entitlement, 60000);
  assert.equal(b[1].entitlement, 150000);
});

test("race: A wins both - 150,000 and 60,000; budget is 210,000", () => {
  const entries = [
    { teamId: "A", points: 50, qualifiedAt: at(1), status: "verified" },
    { teamId: "B", points: 50, qualifiedAt: at(2), status: "verified" },
    { teamId: "A", points: 50, qualifiedAt: at(3), status: "verified" },
    { teamId: "B", points: 50, qualifiedAt: at(4), status: "verified" }
  ];
  const results = raceResults(["A", "B"], entries, DEFAULT_MILESTONES, null);
  assert.deepEqual(teamEntitlements("A", results).map((row) => row.step), [50000, 100000]);
  assert.deepEqual(teamEntitlements("B", results).map((row) => row.step), [20000, 40000]);
  assert.equal(maxBudget(DEFAULT_MILESTONES), 210000);
});

test("race: the qualification time decides, not review order; passing the target counts (49 + 2 = 51)", () => {
  const entries = [
    { teamId: "B", points: 49, qualifiedAt: at(0), status: "verified" },
    { teamId: "A", points: 49, qualifiedAt: at(0), status: "verified" },
    { teamId: "B", points: 2, qualifiedAt: at(15), status: "verified" },
    { teamId: "A", points: 2, qualifiedAt: at(10), status: "verified" }
  ];
  const [m1] = raceResults(["A", "B"], entries, DEFAULT_MILESTONES, null);
  assert.deepEqual(m1.winnerTeamIds, ["A"]);
  assert.deepEqual(m1.runnerUpTeamIds, ["B"]);
});

test("race: an earlier order still awaiting verification keeps the winner provisional", () => {
  const entries = [
    { teamId: "A", points: 50, qualifiedAt: at(10), status: "verified" },
    { teamId: "B", points: 50, qualifiedAt: at(5), status: "awaiting_verification" }
  ];
  assert.equal(raceResults(["A", "B"], entries, DEFAULT_MILESTONES, null)[0].provisional, true);
});

test("race: an exact tie splits winner + runner-up equally; nothing after the close counts", () => {
  const entries = [
    { teamId: "A", points: 50, qualifiedAt: at(5), status: "verified" },
    { teamId: "B", points: 50, qualifiedAt: at(5), status: "verified" }
  ];
  const results = raceResults(["A", "B"], entries, DEFAULT_MILESTONES, null);
  assert.equal(teamEntitlements("A", results)[0].entitlement, 35000);
  assert.equal(raceResults(["A"], [{ teamId: "A", points: 50, qualifiedAt: at(30), status: "verified" }], DEFAULT_MILESTONES, at(20))[0].reached.length, 0);
});

test("split: equal shares, kobo-exact", () => {
  assert.deepEqual(splitEqually(50000, ["x", "y"]), [{ repId: "x", amount: 25000 }, { repId: "y", amount: 25000 }]);
  assert.equal(splitEqually(100, ["a", "b", "c"]).reduce((sum, row) => sum + row.amount, 0), 100);
});
