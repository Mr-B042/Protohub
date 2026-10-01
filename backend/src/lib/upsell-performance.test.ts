import assert from "node:assert/strict";
import test from "node:test";
import { latestTargetsByRep, performanceLogRowFromAttempt } from "./upsell-performance.js";

const attempt = (overrides: Record<string, unknown> = {}) => ({
  order_id: "4661",
  rep_id: "rep-1",
  attempted_at: "2026-09-30T23:30:00+00:00",
  eligibility: "eligible",
  exemption_reason: null,
  original_product_id: "prod-1",
  original_product_name: "5-in-1 Corner Racks",
  original_quantity: 1,
  offer_lines: [
    { offer_type: "cross_sell", response: "waived_no_offer", refusal_reason: null, offered_quantity: null },
    { offer_type: "upsell", response: "declined", refusal_reason: "not_interested", offered_quantity: 2, offered_package_name: "Ultra Pack", offered_product_name: null }
  ],
  ...overrides
});

test("performanceLogRowFromAttempt keeps the upsell line and ignores the cross-sell line", () => {
  const row = performanceLogRowFromAttempt(attempt());
  assert.equal(row.upsell?.response, "declined");
  assert.equal(row.upsell?.refusalReason, "not_interested");
  assert.equal(row.upsell?.offeredQuantity, 2);
  assert.equal(row.upsell?.offeredPackageName, "Ultra Pack");
  assert.equal(row.originalQuantity, 1);
  assert.equal(row.eligible, true);
});

test("performanceLogRowFromAttempt dates the call in Lagos, not UTC", () => {
  // 23:30 UTC on 30 Sept is 00:30 on 1 Oct in Lagos.
  assert.equal(performanceLogRowFromAttempt(attempt()).attemptedKey, "2026-10-01");
});

test("performanceLogRowFromAttempt returns no upsell when the call logged none", () => {
  const row = performanceLogRowFromAttempt(attempt({ offer_lines: [{ offer_type: "cross_sell", response: "waived_no_offer" }] }));
  assert.equal(row.upsell, null);
});

test("performanceLogRowFromAttempt marks exempt calls as not eligible", () => {
  const row = performanceLogRowFromAttempt(attempt({ eligibility: "exempt", exemption_reason: "unreachable_customer", offer_lines: [] }));
  assert.equal(row.eligible, false);
  assert.equal(row.exemptionReason, "unreachable_customer");
});

test("latestTargetsByRep carries the last target forward and ignores later weeks", () => {
  const targets = latestTargetsByRep([
    { rep_id: "a", week_start: "2026-07-12", target_pct: 10 },
    { rep_id: "a", week_start: "2026-08-09", target_pct: 5 },
    { rep_id: "a", week_start: "2026-10-04", target_pct: 8 },
    { rep_id: "b", week_start: "2026-07-12", target_pct: "10" }
  ], "2026-09-30");
  const byRep = Object.fromEntries(targets.map((target) => [target.repId, target]));
  assert.equal(byRep.a.targetPct, 5);
  assert.equal(byRep.a.weekStart, "2026-08-09");
  assert.equal(byRep.b.targetPct, 10);
});
