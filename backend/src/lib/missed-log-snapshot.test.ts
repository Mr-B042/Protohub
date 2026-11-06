import assert from "node:assert/strict";
import test from "node:test";
import { snapshotWithApprovedMisses } from "./missed-log-snapshot.js";

// Delight's 25-31 Oct report as it was saved (manager approved, 6 Nov 2026):
// three missed follow-ups on 28 Oct waiting, nothing taken off.
const delight = () => ({
  repName: "Delight Ogbonna",
  fines: [] as any[],
  totals: { fines: 0, baseBonus: 2600, upsellBonus: 400, crossSellBonus: 0, deliveryBonus: 0, adjustments: 0, carriedFines: 0, finalBonus: 3000, unpaidFines: 0, logMissFines: 0, pendingLogMisses: 150 },
  logMisses: [
    { ref: "m-5432", kind: "follow_up", missDate: "2026-10-28", amount: 50, status: "pending", orderId: "5432" },
    { ref: "m-5615", kind: "follow_up", missDate: "2026-10-28", amount: 50, status: "pending", orderId: "5615" },
    { ref: "m-5383", kind: "follow_up", missDate: "2026-10-28", amount: 50, status: "pending", orderId: "5383" }
  ]
});

test("approved follow-up misses come off a sent report, as the report itself would take them off", () => {
  const next = snapshotWithApprovedMisses(delight(), ["m-5432", "m-5615", "m-5383"]);
  assert.deepEqual(next.fines, [{ id: "logmiss:follow_up|2026-10-28", date: "2026-10-28", amount: 150, label: "Missed follow-up logs 28 Oct: 3 orders" }]);
  assert.equal(next.totals.fines, 150);
  assert.equal(next.totals.logMissFines, 150);
  assert.equal(next.totals.pendingLogMisses, 0);
  assert.equal(next.totals.finalBonus, 2850);
  assert.equal(next.totals.unpaidFines, 0);
  assert.ok(next.logMisses.every((miss: any) => miss.status === "approved"));
});

test("running it again changes nothing (no double charge)", () => {
  const once = snapshotWithApprovedMisses(delight(), ["m-5432", "m-5615", "m-5383"]);
  assert.equal(snapshotWithApprovedMisses(once, ["m-5432", "m-5615", "m-5383"]), once);
});

test("only the misses named, only follow-ups; other fines and cart logs stay as they were", () => {
  const snapshot = delight();
  snapshot.fines = [{ id: "pen-1", date: "2026-10-27", amount: 500, label: "Late order send - Order #5600" }];
  snapshot.totals.fines = 500;
  snapshot.totals.finalBonus = 2500;
  snapshot.logMisses.push({ ref: "cart|d|2026-10-29", kind: "cart_log", missDate: "2026-10-29", amount: 1000, status: "pending", orderId: "" });
  snapshot.totals.pendingLogMisses = 1150;
  const next = snapshotWithApprovedMisses(snapshot, ["m-5432", "cart|d|2026-10-29"]);
  assert.deepEqual(next.fines.map((fine: any) => [fine.id, fine.amount]), [["pen-1", 500], ["logmiss:follow_up|2026-10-28", 50]]);
  assert.equal(next.fines[1].label, "Missed follow-up logs 28 Oct: 1 order");
  assert.equal(next.totals.fines, 550);
  assert.equal(next.totals.pendingLogMisses, 1100);
  assert.equal(next.totals.finalBonus, 2450);
  assert.equal(next.logMisses.find((miss: any) => miss.kind === "cart_log").status, "pending");
});

test("fines bigger than the bonus carry the rest to next week", () => {
  const snapshot = delight();
  snapshot.totals.baseBonus = 100;
  snapshot.totals.upsellBonus = 0;
  snapshot.totals.finalBonus = 100;
  const next = snapshotWithApprovedMisses(snapshot, ["m-5432", "m-5615", "m-5383"]);
  assert.equal(next.totals.finalBonus, 0);
  assert.equal(next.totals.unpaidFines, 50);
});
