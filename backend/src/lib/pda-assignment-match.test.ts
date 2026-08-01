import assert from "node:assert/strict";
import test from "node:test";
import { candidateBlockers, agentCoversState, rankCandidates, type CandidateAgent } from "./pda-assignment-match.js";

const agent = (over: Partial<CandidateAgent> = {}): CandidateAgent => ({
  id: "a1", fullName: "Test Agent",
  accountStatus: "Active", availability: "Available", trustLevel: "Verified",
  state: "Rivers", serviceAreas: [],
  maxActiveOrders: 5, maxCodExposure: 100000,
  activeOrders: 0, cashOutstanding: 0, availableStock: 10,
  ...over
});

const order = { state: "Rivers", quantity: 1, amount: 39500 };

test("a well-placed, stocked, available agent is eligible", () => {
  assert.deepEqual(candidateBlockers(agent(), order), []);
});

test("an unapproved agent can never take an order", () => {
  for (const status of ["Application Started", "Management Review", "Restricted", "Terminated"]) {
    const reasons = candidateBlockers(agent({ accountStatus: status }), order);
    assert.ok(reasons.some((r) => r.includes(status)), `${status} should block`);
  }
});

test("state names match loosely so Rivers and Rivers State are the same place", () => {
  // This exact mismatch once skipped stock deduction across the main order flow.
  assert.equal(agentCoversState(agent({ state: "Rivers" }), "Rivers State"), true);
  assert.equal(agentCoversState(agent({ state: "Rivers State" }), "Rivers"), true);
  assert.equal(agentCoversState(agent({ state: "Lagos" }), "Rivers"), false);
});

test("a secondary service area counts as coverage", () => {
  const multi = agent({ state: "Rivers", serviceAreas: ["Bayelsa", "Abia"] });
  assert.equal(agentCoversState(multi, "Abia"), true);
  assert.equal(agentCoversState(multi, "Kano"), false);
});

test("an agent without the stock is blocked, not merely warned", () => {
  const reasons = candidateBlockers(agent({ availableStock: 1 }), { ...order, quantity: 3 });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /Holds 1 of the 3 needed/);
});

test("an agent at their active-order cap is blocked", () => {
  const reasons = candidateBlockers(agent({ activeOrders: 5, maxActiveOrders: 5 }), order);
  assert.match(reasons[0], /Already on 5 of 5/);
});

test("an order that would breach the cash limit is blocked", () => {
  const reasons = candidateBlockers(agent({ cashOutstanding: 80000, maxCodExposure: 100000 }), order);
  assert.match(reasons[0], /over their limit/);
});

test("no configured limits means those checks never block", () => {
  const unlimited = agent({ maxActiveOrders: null, maxCodExposure: null, activeOrders: 99, cashOutstanding: 999999 });
  assert.deepEqual(candidateBlockers(unlimited, order), []);
});

test("every failing reason is reported, not just the first", () => {
  // A dispatcher facing an empty list needs the full picture.
  const bad = agent({ accountStatus: "Restricted", availability: "Offline", state: "Lagos", availableStock: 0 });
  assert.equal(candidateBlockers(bad, order).length, 4);
});

test("eligible agents sort above ineligible ones", () => {
  const ranked = rankCandidates([
    agent({ id: "blocked", availability: "Offline" }),
    agent({ id: "ok" })
  ], order);
  assert.equal(ranked[0].agentId, "ok");
  assert.equal(ranked[1].eligible, false);
});

test("the least busy agent is preferred, not the best stocked", () => {
  // Ranking by stock would pile every order onto one agent and starve the rest.
  const ranked = rankCandidates([
    agent({ id: "busy", activeOrders: 3, availableStock: 100 }),
    agent({ id: "free", activeOrders: 0, availableStock: 5 })
  ], order);
  assert.equal(ranked[0].agentId, "free");
});

test("with equal workload, less company cash in hand wins", () => {
  const ranked = rankCandidates([
    agent({ id: "holding", cashOutstanding: 50000 }),
    agent({ id: "clear", cashOutstanding: 0 })
  ], order);
  assert.equal(ranked[0].agentId, "clear");
});
