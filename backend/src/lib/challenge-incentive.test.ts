import test from "node:test";
import assert from "node:assert/strict";
import { calendarMonthOf, incentiveTier, incentiveWindow, monthlyDeliveryRate, payableAmount } from "./challenge-incentive.js";

test("tiers: 70+ full, 65-70 half, 60-65 quarter, below 60 nothing", () => {
  assert.equal(incentiveTier(70).percent, 100);
  assert.equal(incentiveTier(82.4).percent, 100);
  assert.equal(incentiveTier(69.9).percent, 50);
  assert.equal(incentiveTier(65).percent, 50);
  assert.equal(incentiveTier(64.9).percent, 25);
  assert.equal(incentiveTier(60).percent, 25);
  assert.equal(incentiveTier(59.9).percent, 0);
  assert.equal(incentiveTier(null).percent, 0);
});

test("next tier and points needed", () => {
  const half = incentiveTier(66.5);
  assert.equal(half.nextPercent, 100);
  assert.equal(half.pointsToNext, 3.5);
  const none = incentiveTier(52);
  assert.equal(none.nextPercent, 25);
  assert.equal(none.pointsToNext, 8);
  assert.equal(incentiveTier(75).nextPercent, null);
});

test("rate and payable", () => {
  assert.equal(monthlyDeliveryRate(0, 0), null);
  assert.equal(monthlyDeliveryRate(200, 141), 70.5);
  assert.equal(payableAmount(20000, 50), 10000);
  assert.equal(payableAmount(13333.33, 25), 3333.33);
});

test("window: accruing during the month, due the first week after", () => {
  assert.equal(incentiveWindow("2026-10-31", "2026-10-20").status, "accruing");
  assert.equal(incentiveWindow("2026-10-31", "2026-11-01").status, "due");
  assert.equal(incentiveWindow("2026-10-31", "2026-11-07").status, "due");
  assert.equal(incentiveWindow("2026-10-31", "2026-11-08").status, "overdue");
});

test("window: a weekly-month challenge is paid after the calendar month ends", () => {
  // September challenge runs 30 Aug - 26 Sept; the rate covers all of September.
  assert.deepEqual(calendarMonthOf("2026-09-26"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(calendarMonthOf("2026-02-28"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(calendarMonthOf("2028-02-26"), { from: "2028-02-01", to: "2028-02-29" });
  assert.equal(incentiveWindow("2026-09-26", "2026-09-28").status, "accruing");
  assert.equal(incentiveWindow("2026-09-26", "2026-10-01").status, "due");
  assert.equal(incentiveWindow("2026-09-26", "2026-10-07").status, "due");
  assert.equal(incentiveWindow("2026-09-26", "2026-10-08").status, "overdue");
});
