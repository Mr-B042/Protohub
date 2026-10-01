import assert from "node:assert/strict";
import test from "node:test";
import { applyFines, checkCartDay, checkFollowUpMiss } from "./log-miss-check.js";

const base = { orderId: "4307", missDate: "2026-09-23", slot: "day", workingDay: true, startDate: "2026-07-01", assignedToRepNow: true, attemptsThatDay: [], otherOrdersLoggedThatDay: 12 };

test("a follow-up miss with no log that day is confirmed and says what they did instead", () => {
  const result = checkFollowUpMiss(base);
  assert.equal(result.verdict, "miss_confirmed");
  assert.ok(result.findings.some((finding) => finding.text.includes("12 other orders")));
});

test("a log on that order that day makes the charge wrong", () => {
  const result = checkFollowUpMiss({ ...base, attemptsThatDay: [{ lagosHour: 10, lagosMinute: 5, channels: ["call"] }] });
  assert.equal(result.verdict, "miss_wrong");
});

test("chase slots: an afternoon log does not clear a morning miss", () => {
  assert.equal(checkFollowUpMiss({ ...base, slot: "morning", attemptsThatDay: [{ lagosHour: 15, lagosMinute: 0, channels: ["call"] }] }).verdict, "miss_confirmed");
  assert.equal(checkFollowUpMiss({ ...base, slot: "later", attemptsThatDay: [{ lagosHour: 15, lagosMinute: 0, channels: ["call"] }] }).verdict, "miss_wrong");
});

test("Sundays and days before go-live are never charged", () => {
  assert.equal(checkFollowUpMiss({ ...base, workingDay: false }).verdict, "miss_wrong");
  assert.equal(checkFollowUpMiss({ ...base, missDate: "2026-06-30" }).verdict, "miss_wrong");
});

test("cart day: confirmed while carts are still unlogged; wrong once none are, or the amount fell", () => {
  const cart = { missDate: "2026-09-23", amountCharged: 1500, cartsDueNow: 10, cartsMissedNow: 3, amountNow: 1500, loggedCarts: [{ customer: "Ada", time: "10:00 AM" }], missedCarts: [{ customer: "Tunde", product: "Rack" }] };
  assert.equal(checkCartDay(cart).verdict, "miss_confirmed");
  assert.equal(checkCartDay({ ...cart, cartsMissedNow: 0, amountNow: 0 }).verdict, "miss_wrong");
  assert.equal(checkCartDay({ ...cart, cartsMissedNow: 1, amountNow: 500 }).verdict, "miss_wrong");
});

test("fines bigger than the bonus carry the rest into next week", () => {
  assert.deepEqual(applyFines({ earned: 5000, fines: 2000, carriedIn: 0 }), { finalBonus: 3000, unpaid: 0 });
  assert.deepEqual(applyFines({ earned: 5000, fines: 7000, carriedIn: 0 }), { finalBonus: 0, unpaid: 2000 });
  assert.deepEqual(applyFines({ earned: 5000, fines: 1000, carriedIn: 2000 }), { finalBonus: 2000, unpaid: 0 });
  assert.deepEqual(applyFines({ earned: 0, fines: 0, carriedIn: 2000 }), { finalBonus: 0, unpaid: 2000 });
});
