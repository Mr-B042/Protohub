import assert from "node:assert/strict";
import test from "node:test";
import { requireScopedRep } from "../routes/weekly-reports.js";

// "Requires one of: Sales Rep" when the Owner used View As on a rep (Bright,
// 1 Oct 2026): the "my report" reads must follow the previewed rep.
const run = (user: Record<string, unknown>) => {
  let passed = false;
  let status = 200;
  const res = { status(code: number) { status = code; return this; }, json() { return this; } };
  requireScopedRep({ user } as any, res, () => { passed = true; });
  return { passed, status };
};

test("a sales rep reads their own report", () => {
  assert.equal(run({ id: "rep", role: "Sales Rep" }).passed, true);
});

test("the owner viewing as a sales rep reads that rep's report", () => {
  assert.equal(run({ id: "owner", role: "Owner", effectiveUserId: "rep", effectiveUserRole: "Sales Rep" }).passed, true);
});

test("the owner not previewing anyone has no 'my report'", () => {
  const result = run({ id: "owner", role: "Owner" });
  assert.equal(result.passed, false);
  assert.equal(result.status, 403);
});
