import assert from "node:assert/strict";
import test from "node:test";
import { scoreOrderDocumentation, type DocumentationScoreOrder } from "./recovery-rep-documentation-score.js";

const order = (o: Partial<DocumentationScoreOrder> & { id: string }): DocumentationScoreOrder => ({
  status: "New", call_outcome: null, next_follow_up_at: null, scheduled_at: null, scheduled_date: null, ...o
});

test("an order passes only when all three criteria are met", () => {
  const orders = [
    order({ id: "full", status: "Delivered", call_outcome: "Reached" }),          // attempt + outcome + terminal
    order({ id: "no-attempt", status: "Delivered", call_outcome: "Reached" }),    // missing attempt
    order({ id: "no-outcome", status: "Delivered" }),                             // missing outcome
    order({ id: "open-no-followup", call_outcome: "Reached" })                     // open, nothing scheduled
  ];
  const result = scoreOrderDocumentation(orders, new Set(["full", "no-outcome", "open-no-followup"]));
  assert.equal(result.scoredCount, 4);
  assert.equal(result.passingCount, 1);
  assert.equal(result.ratePct, 25);
});

test("per-criterion counts break down WHICH part of the trail was dropped", () => {
  const orders = [
    order({ id: "a", status: "Delivered", call_outcome: "Reached" }),
    order({ id: "b", status: "Cancelled", call_outcome: "" }),        // blank outcome does not count
    order({ id: "c", next_follow_up_at: "2026-08-01T09:00:00Z" })     // open but scheduled
  ];
  const result = scoreOrderDocumentation(orders, new Set(["a", "b"]));
  assert.deepEqual(result.criteria, { contactAttempt: 2, callOutcome: 1, followUpOrTerminal: 3 });
  // Each criterion is always at least the all-three passing count.
  assert.ok(result.criteria.contactAttempt >= result.passingCount);
  assert.ok(result.criteria.callOutcome >= result.passingCount);
  assert.ok(result.criteria.followUpOrTerminal >= result.passingCount);
});

test("a terminal status satisfies the follow-up criterion without a scheduled date", () => {
  for (const status of ["Delivered", "Cancelled", "Failed"]) {
    const result = scoreOrderDocumentation([order({ id: "x", status, call_outcome: "Reached" })], new Set(["x"]));
    assert.equal(result.passingCount, 1, `${status} should satisfy follow-up-or-terminal`);
  }
  // A non-terminal status with nothing scheduled does not.
  const open = scoreOrderDocumentation([order({ id: "x", status: "Confirmed", call_outcome: "Reached" })], new Set(["x"]));
  assert.equal(open.passingCount, 0);
});

test("an empty cohort scores 100% rather than dividing by zero", () => {
  const result = scoreOrderDocumentation([], new Set());
  assert.equal(result.scoredCount, 0);
  assert.equal(result.ratePct, 100);
  assert.deepEqual(result.criteria, { contactAttempt: 0, callOutcome: 0, followUpOrTerminal: 0 });
});
