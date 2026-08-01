import assert from "node:assert/strict";
import test from "node:test";
import {
  dispatchBlockers, deliveryProofBlockers, rescheduleKeepsStockReserved, failureReasonBlockers
} from "./pda-delivery-flow.js";

const readyToDispatch = {
  assignmentStatus: "Accepted",
  customerContactStatus: "Customer Ready",
  deliveryStatus: "Ready for Dispatch",
  feeStatus: "Locked"
};

test("a fully prepared assignment can dispatch", () => {
  assert.deepEqual(dispatchBlockers(readyToDispatch), []);
});

test("dispatch is blocked until the customer confirms readiness", () => {
  // The point of the whole gate: setting off before the customer says they are
  // ready is how the company pays for a wasted trip.
  const blockers = dispatchBlockers({ ...readyToDispatch, customerContactStatus: "Contacted" });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /has not confirmed they are ready/);
});

test("merely having called the customer is not readiness", () => {
  for (const status of ["Not Contacted", "Contacted", "Not Picking", "Customer Requested Callback"]) {
    const blockers = dispatchBlockers({ ...readyToDispatch, customerContactStatus: status });
    assert.ok(blockers.length > 0, `${status} should not allow dispatch`);
  }
});

test("dispatch is blocked until the agent has accepted the job", () => {
  const blockers = dispatchBlockers({ ...readyToDispatch, assignmentStatus: "Awaiting Agent Acceptance" });
  assert.match(blockers[0], /Accept the assignment/);
});

test("dispatch is blocked until the fee is agreed", () => {
  // Agreeing the fee after the trip means negotiating once the cost is sunk.
  const blockers = dispatchBlockers({ ...readyToDispatch, feeStatus: "Proposed" });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /fee has not been agreed/);
});

test("a rescheduled delivery can dispatch again", () => {
  assert.deepEqual(dispatchBlockers({ ...readyToDispatch, deliveryStatus: "Rescheduled" }), []);
});

test("an already-dispatched order cannot dispatch twice", () => {
  const blockers = dispatchBlockers({ ...readyToDispatch, deliveryStatus: "Dispatch Started" });
  assert.match(blockers[0], /already dispatch started/);
});

test("delivery needs both proof and a collected amount", () => {
  assert.deepEqual(deliveryProofBlockers({ proofType: "Customer OTP", proofReference: "4821", amountCollected: 39500 }), []);
  assert.equal(deliveryProofBlockers({ amountCollected: 39500 }).length, 1);
  assert.equal(deliveryProofBlockers({ proofType: "Customer OTP", proofReference: "4821" }).length, 1);
});

test("a photo proof with no photo attached is not proof", () => {
  const blockers = deliveryProofBlockers({ proofType: "Delivery photograph", amountCollected: 1000 });
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /Attach the delivery photograph/);
});

test("an OTP proof with no reference is not proof", () => {
  const blockers = deliveryProofBlockers({ proofType: "Customer OTP", amountCollected: 1000 });
  assert.match(blockers[0], /Record the customer otp details/);
});

test("zero collected is valid but a missing amount is not", () => {
  // A genuinely free or prepaid delivery can collect nothing; not recording
  // anything at all is the thing being prevented.
  assert.deepEqual(deliveryProofBlockers({ proofType: "Customer OTP", proofReference: "1", amountCollected: 0 }), []);
  const blockers = deliveryProofBlockers({ proofType: "Customer OTP", proofReference: "1", amountCollected: null });
  assert.match(blockers[0], /how much was collected/);
});

test("a firm reschedule date keeps stock reserved, a vague one does not", () => {
  assert.equal(rescheduleKeepsStockReserved("2026-08-14"), true);
  // "I'll call you later" - holding stock for this blocks inventory forever.
  assert.equal(rescheduleKeepsStockReserved(""), false);
  assert.equal(rescheduleKeepsStockReserved(null), false);
  assert.equal(rescheduleKeepsStockReserved("sometime next week"), false);
});

test("a failure must carry a recognised reason", () => {
  assert.deepEqual(failureReasonBlockers("Customer rejected product"), []);
  assert.equal(failureReasonBlockers("").length, 1);
  assert.equal(failureReasonBlockers("because").length, 1);
});

test("Other requires an explanation", () => {
  assert.equal(failureReasonBlockers("Other").length, 1);
  assert.deepEqual(failureReasonBlockers("Other", "Road closed by flooding"), []);
});
