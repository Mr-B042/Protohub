import assert from "node:assert/strict";
import test from "node:test";
import {
  outstandingForAssignment, reconciliationStatusFor, earningStatusFor,
  cashPositionFor, codAssignmentBlockers, allocateRemittance
} from "./pda-cod.js";

const delivered = (over: Record<string, unknown> = {}) =>
  ({ deliveryStatus: "Delivered", amountCollected: 39500, amountRemitted: 0, deliveryFee: 4500, ...over });

test("the agent owes the FULL amount collected, never minus their fee", () => {
  // The whole point: netting the fee off would make a ₦4,500 shortage and a
  // correctly kept fee look identical.
  assert.equal(outstandingForAssignment(delivered()), 39500);
});

test("an undelivered order owes nothing", () => {
  assert.equal(outstandingForAssignment(delivered({ deliveryStatus: "Dispatch Started" })), 0);
});

test("remitting the full amount reconciles the order", () => {
  assert.equal(reconciliationStatusFor(delivered({ amountRemitted: 39500 })), "Reconciled");
  assert.equal(outstandingForAssignment(delivered({ amountRemitted: 39500 })), 0);
});

test("remitting exactly the amount minus the fee is a SHORTFALL, not settled", () => {
  // An agent who hands over ₦35,000 of ₦39,500 and keeps their ₦4,500 fee is
  // still ₦4,500 short as far as the company's cash is concerned.
  const row = delivered({ amountRemitted: 35000 });
  assert.equal(reconciliationStatusFor(row), "Partially Remitted");
  assert.equal(outstandingForAssignment(row), 4500);
});

test("cash collected but nothing handed over reads as held by the agent", () => {
  assert.equal(reconciliationStatusFor(delivered()), "Cash Held by Agent");
});

test("a prepaid delivery has nothing to remit, which is not the same as unpaid", () => {
  const row = delivered({ amountCollected: 0 });
  assert.equal(reconciliationStatusFor(row), "Nothing to Remit");
  assert.equal(outstandingForAssignment(row), 0);
});

test("handing over more than was collected is flagged, not absorbed", () => {
  assert.equal(reconciliationStatusFor(delivered({ amountRemitted: 40000 })), "Overpayment");
});

test("a fee is only payable once the cash is fully in", () => {
  assert.equal(earningStatusFor(delivered()), "Pending");
  assert.equal(earningStatusFor(delivered({ amountRemitted: 35000 })), "Pending");
  assert.equal(earningStatusFor(delivered({ amountRemitted: 39500 })), "Available");
});

test("an already-paid or withheld fee is never recomputed back to available", () => {
  assert.equal(earningStatusFor(delivered({ amountRemitted: 39500 }), "Paid"), "Paid");
  assert.equal(earningStatusFor(delivered({ amountRemitted: 39500 }), "Withheld"), "Withheld");
});

test("the cash position separates company money from agent earnings", () => {
  const position = cashPositionFor([
    delivered(),                                   // owes 39500, fee pending
    delivered({ amountRemitted: 39500 }),          // settled, fee available
    delivered({ deliveryStatus: "Failed" })        // not delivered, ignored
  ]);
  assert.equal(position.outstanding, 39500);
  assert.equal(position.availableEarnings, 4500);
  assert.equal(position.pendingEarnings, 4500);
  assert.equal(position.deliveredOrders, 2);
  assert.equal(position.ordersWithCashOutstanding, 1);
});

test("an agent over their COD limit is blocked from more cash orders", () => {
  const blockers = codAssignmentBlockers({ outstanding: 90000 }, 100000, 39500);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /above their approved limit/);
});

test("an agent within their COD limit is not blocked", () => {
  assert.deepEqual(codAssignmentBlockers({ outstanding: 20000 }, 100000, 39500), []);
});

test("no configured COD limit means no COD block", () => {
  assert.deepEqual(codAssignmentBlockers({ outstanding: 999999 }, null, 50000), []);
});

test("a payment clears the oldest debts first and reports any excess", () => {
  const { allocations, unallocated } = allocateRemittance(50000, [
    { assignmentId: "a", outstanding: 39500 },
    { assignmentId: "b", outstanding: 20000 }
  ]);
  assert.deepEqual(allocations, [
    { assignmentId: "a", amount: 39500 },
    { assignmentId: "b", amount: 10500 }
  ]);
  assert.equal(unallocated, 0);
});

test("money beyond the outstanding debt is surfaced, not silently absorbed", () => {
  const { allocations, unallocated } = allocateRemittance(50000, [{ assignmentId: "a", outstanding: 39500 }]);
  assert.equal(allocations.length, 1);
  assert.equal(unallocated, 10500);
});

test("settled orders are skipped when allocating", () => {
  const { allocations } = allocateRemittance(10000, [
    { assignmentId: "settled", outstanding: 0 },
    { assignmentId: "open", outstanding: 8000 }
  ]);
  assert.deepEqual(allocations, [{ assignmentId: "open", amount: 8000 }]);
});
