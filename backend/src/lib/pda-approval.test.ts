import assert from "node:assert/strict";
import test from "node:test";
import { approvalBlockers } from "./pda-approval.js";

const approvedItem = (label: string) => ({ mandatory: true, status: "Approved", label });
const approvedGuarantor = (slot: number, type: string | null) =>
  ({ slot, verification_status: "Approved", guarantor_type: type });
const approvedDoc = (label: string) => ({ status: "Approved", label });

function readyApplication() {
  return {
    kyc: [approvedItem("Government ID"), approvedItem("Bank Account")],
    guarantors: [approvedGuarantor(1, "Family"), approvedGuarantor(2, "Independent")],
    documents: [approvedDoc("Agent Agreement")]
  };
}

test("a fully approved application has no blockers", () => {
  const app = readyApplication();
  assert.deepEqual(approvalBlockers(app.kyc, app.guarantors, app.documents), []);
});

test("any pending mandatory item blocks approval", () => {
  const app = readyApplication();
  app.kyc.push({ mandatory: true, status: "Pending", label: "Live Verification Video" });
  const blockers = approvalBlockers(app.kyc, app.guarantors, app.documents);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /Live Verification Video/);
});

test("an optional item does not block approval", () => {
  const app = readyApplication();
  app.kyc.push({ mandatory: false, status: "Pending", label: "Nice To Have" });
  assert.deepEqual(approvalBlockers(app.kyc, app.guarantors, app.documents), []);
});

test("a missing guarantor blocks approval", () => {
  const app = readyApplication();
  const blockers = approvalBlockers(app.kyc, [approvedGuarantor(1, "Family")], app.documents);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /Guarantor 2 has not been added/);
});

test("an unverified guarantor blocks approval", () => {
  const app = readyApplication();
  const guarantors = [
    approvedGuarantor(1, "Family"),
    { slot: 2, verification_status: "Unable to Verify", guarantor_type: "Independent" }
  ];
  const blockers = approvalBlockers(app.kyc, guarantors, app.documents);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /Guarantor 2 is unable to verify/);
});

test("two family guarantors are rejected even when both are verified", () => {
  // The whole point of the second guarantor is independence - two relatives can
  // simply back each other up.
  const app = readyApplication();
  const guarantors = [approvedGuarantor(1, "Family"), approvedGuarantor(2, "Family")];
  const blockers = approvalBlockers(app.kyc, guarantors, app.documents);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /independent referee/);
});

test("two independent guarantors are acceptable", () => {
  // Only an all-family pair is disallowed; being stricter than required is fine.
  const app = readyApplication();
  const guarantors = [approvedGuarantor(1, "Independent"), approvedGuarantor(2, "Independent")];
  assert.deepEqual(approvalBlockers(app.kyc, guarantors, app.documents), []);
});

test("an unsigned agreement blocks approval", () => {
  const app = readyApplication();
  app.documents.push({ status: "Not Uploaded", label: "COD Collection & Remittance Agreement" });
  const blockers = approvalBlockers(app.kyc, app.guarantors, app.documents);
  assert.equal(blockers.length, 1);
  assert.match(blockers[0], /COD Collection & Remittance Agreement/);
});

test("every outstanding requirement is listed, not just the first", () => {
  // The reviewer needs the full picture, not a one-at-a-time drip.
  const blockers = approvalBlockers(
    [{ mandatory: true, status: "Pending", label: "Government ID" }],
    [],
    [{ status: "Not Uploaded", label: "Agent Agreement" }]
  );
  assert.equal(blockers.length, 4);
});
