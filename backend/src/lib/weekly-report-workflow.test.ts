import assert from "node:assert/strict";
import test from "node:test";
import { canManagerAct, canOwnerAct, canRepSubmit, canSubmitToOwner } from "./weekly-report-workflow.js";

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
