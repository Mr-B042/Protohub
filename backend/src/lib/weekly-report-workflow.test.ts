import assert from "node:assert/strict";
import test from "node:test";
import { canManagerAct, canOwnerAct, canRepSubmit, canSubmitToOwner, reportDueDate, canChangePayout, payoutChangeProblem, previousWeekGate, effectiveDueDate } from "./weekly-report-workflow.js";

test("a rep submits a draft or a returned report, nothing else", () => {
  assert.equal(canRepSubmit(null, null).ok, true);
  assert.equal(canRepSubmit("draft", "open").ok, true);
  assert.equal(canRepSubmit("returned", "returned_to_manager").ok, true);
  assert.equal(canRepSubmit("submitted", "open").ok, false);
  assert.equal(canRepSubmit("manager_approved", "open").ok, false);
  assert.equal(canRepSubmit("locked", "locked").ok, false);
});

test("nobody below the owner can move a report while the owner holds the week", () => {
  assert.equal(canRepSubmit("returned", "submitted_to_owner").ok, false);
  assert.equal(canManagerAct("approve", "submitted", "submitted_to_owner").ok, false);
  assert.equal(canManagerAct("return", "manager_approved", "locked").ok, false);
});

test("the manager approves only a submitted report, and can return an approved one", () => {
  assert.equal(canManagerAct("approve", "submitted", "open").ok, true);
  assert.equal(canManagerAct("approve", "draft", "open").ok, false);
  assert.equal(canManagerAct("approve", "returned", "open").ok, false);
  assert.equal(canManagerAct("return", "submitted", "open").ok, true);
  assert.equal(canManagerAct("return", "manager_approved", "returned_to_manager").ok, true);
  assert.equal(canManagerAct("return", "returned", "open").ok, false);
  assert.equal(canManagerAct("flag", "draft", "open").ok, true);
});

test("submit to owner needs every expected rep approved", () => {
  const reps = ["a", "b", "c"];
  assert.equal(canSubmitToOwner("open", reps, [
    { repId: "a", status: "manager_approved" },
    { repId: "b", status: "manager_approved" },
    { repId: "c", status: "manager_approved" }
  ]).ok, true);

  const oneReturned = canSubmitToOwner("open", reps, [
    { repId: "a", status: "manager_approved" },
    { repId: "b", status: "returned" },
    { repId: "c", status: "manager_approved" }
  ]);
  assert.equal(oneReturned.ok, false);
  assert.deepEqual(oneReturned.notApproved, ["b"]);

  const oneMissing = canSubmitToOwner("returned_to_manager", reps, [
    { repId: "a", status: "manager_approved" },
    { repId: "b", status: "manager_approved" }
  ]);
  assert.equal(oneMissing.ok, false);
  assert.deepEqual(oneMissing.missing, ["c"]);

  assert.equal(canSubmitToOwner("open", [], []).ok, false);
  assert.equal(canSubmitToOwner("submitted_to_owner", ["a"], [{ repId: "a", status: "manager_approved" }]).ok, false);
});

test("the owner acts only on a week the manager submitted, and reopens only a locked one", () => {
  assert.equal(canOwnerAct("approve_lock", "submitted_to_owner").ok, true);
  assert.equal(canOwnerAct("return", "submitted_to_owner").ok, true);
  assert.equal(canOwnerAct("approve_lock", "open").ok, false);
  assert.equal(canOwnerAct("approve_lock", "returned_to_manager").ok, false);
  assert.equal(canOwnerAct("reopen", "locked").ok, true);
  assert.equal(canOwnerAct("reopen", "submitted_to_owner").ok, false);
});

test("a week's report is due on the Tuesday after it ends", () => {
  assert.equal(reportDueDate("2026-09-20"), "2026-09-29");
  assert.equal(reportDueDate("2026-09-27"), "2026-10-06");
  // Across a month and a year end.
  assert.equal(reportDueDate("2026-12-27"), "2027-01-05");
});

test("a payout is changed only on a submitted report while the week is with the manager", () => {
  assert.equal(canChangePayout("submitted", "open").ok, true);
  assert.equal(canChangePayout("manager_approved", "open").ok, true);
  assert.equal(canChangePayout("manager_approved", "returned_to_manager").ok, true);
  assert.equal(canChangePayout("draft", "open").ok, false);
  assert.equal(canChangePayout(null, null).ok, false);
  assert.equal(canChangePayout("returned", "open").ok, false);
  // With the owner, or locked: the figure the owner is looking at cannot move.
  assert.equal(canChangePayout("manager_approved", "submitted_to_owner").ok, false);
  assert.equal(canChangePayout("locked", "locked").ok, false);
});

test("a payout change can add or take off, never zero and never below nothing", () => {
  assert.equal(payoutChangeProblem(21150, -2000), null);
  assert.equal(payoutChangeProblem(21150, 3500), null);
  assert.equal(payoutChangeProblem(21150, -21150), null);
  assert.ok(payoutChangeProblem(21150, 0));
  assert.ok(payoutChangeProblem(21150, Number.NaN));
  assert.ok(payoutChangeProblem(6000, -6001));
});

test("a rep cannot send a new report until last week has been sent to the owner", () => {
  // Week of 4 Oct: the week of 27 Sept is still with the manager.
  assert.equal(previousWeekGate({ weekStart: "2026-10-04", previousExpectedReps: 4, previousSubmitCount: 0 }).ok, false);
  assert.equal(previousWeekGate({ weekStart: "2026-10-04", previousExpectedReps: 4, previousSubmitCount: 1 }).ok, true);
  // Sent once and returned by the owner still counts as sent.
  assert.equal(previousWeekGate({ weekStart: "2026-10-04", previousExpectedReps: 4, previousSubmitCount: 2 }).ok, true);
  // Nobody had to report last week: nothing to wait for.
  assert.equal(previousWeekGate({ weekStart: "2026-10-04", previousExpectedReps: 0, previousSubmitCount: 0 }).ok, true);
  // The first report week has no week before it.
  assert.equal(previousWeekGate({ weekStart: "2026-09-27", previousExpectedReps: 4, previousSubmitCount: 0 }).ok, true);
});

test("a rep held up by the manager gets until the end of the day after last week was sent", () => {
  // Normal: the Tuesday after the week.
  assert.equal(effectiveDueDate("2026-10-04", null), "2026-10-13");
  assert.equal(effectiveDueDate("2026-10-04", "2026-10-09"), "2026-10-13");
  assert.equal(effectiveDueDate("2026-10-04", "2026-10-12"), "2026-10-13");
  // Sent on the Tuesday itself or later: the rep has the next day.
  assert.equal(effectiveDueDate("2026-10-04", "2026-10-13"), "2026-10-14");
  assert.equal(effectiveDueDate("2026-10-04", "2026-10-16"), "2026-10-17");
});
