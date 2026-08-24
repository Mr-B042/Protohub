import assert from "node:assert/strict";
import test from "node:test";
import {
  CART_LOG_MISS_AMOUNT, CART_LOG_PENALTY_START_DATE, chargeableDaysIn, isChargeableDay,
  dayPenaltyAmount, missedCartCount,
  mondayOf, penaltyPhase, repDayStatus, resolveRange, summariseRepPenalties, todayStanding, type RepDayInput
} from "./cart-log-penalty.js";

const day = (over: Partial<RepDayInput> = {}): RepDayInput => ({
  repId: "r1", repName: "Chelsea", dateKey: "2026-08-25", cartsDue: 61, logsMade: 0, ...over
});

test("the rate is five hundred, charged per cart", () => {
  assert.equal(CART_LOG_MISS_AMOUNT, 500);
  assert.equal(dayPenaltyAmount(day({ cartsDue: 40, logsMade: 0 })), 20_000);
});

test("go-live is Monday 24 August 2026", () => {
  assert.equal(CART_LOG_PENALTY_START_DATE, "2026-08-24");
  assert.equal(new Date(`${CART_LOG_PENALTY_START_DATE}T00:00:00Z`).getUTCDay(), 1);
});

test("Sundays are off", () => {
  assert.equal(isChargeableDay("2026-08-23"), false); // Sunday
  assert.equal(isChargeableDay("2026-08-24"), true);  // Monday
  assert.equal(isChargeableDay("2026-08-29"), true);  // Saturday
});

// Nobody is charged for days they were never warned about.
test("days before go-live are never chargeable", () => {
  assert.equal(repDayStatus(day({ dateKey: "2026-08-21", logsMade: 0 })), "before_go_live");
  assert.equal(repDayStatus(day({ dateKey: "2026-08-22", logsMade: 0 })), "before_go_live");
});

test("the first chargeable day is go-live itself", () => {
  assert.equal(repDayStatus(day({ dateKey: "2026-08-24", logsMade: 0 })), "missed");
});

test("logging nothing on a working day with carts due is a miss", () => {
  assert.equal(repDayStatus(day({ logsMade: 0, cartsDue: 61 })), "missed");
});

// One log clears the day - this catches absence, not sloppiness.
test("logging even one cart clears the whole day", () => {
  assert.equal(repDayStatus(day({ logsMade: 1, cartsDue: 61 })), "clear");
});

test("a rep with no carts due is not_due, never clear", () => {
  const status = repDayStatus(day({ cartsDue: 0, logsMade: 0 }));
  assert.equal(status, "not_due");
  assert.notEqual(status, "clear");
});

test("a Sunday with carts due is still not chargeable", () => {
  assert.equal(repDayStatus(day({ dateKey: "2026-08-30", cartsDue: 40, logsMade: 0 })), "not_due");
});

// ⚠️ Reversed on 2026-08-24. The charge now scales with the board: a rep
// holding 61 carts is exposed to ten times a rep holding 6.
test("the charge scales with board size", () => {
  const big = summariseRepPenalties([day({ repId: "big", cartsDue: 61, logsMade: 0 })]);
  const small = summariseRepPenalties([day({ repId: "small", cartsDue: 6, logsMade: 0 })]);
  assert.equal(big[0].atRiskAmount, 30_500);
  assert.equal(small[0].atRiskAmount, 3_000);
  assert.equal(big[0].missedCarts, 61);
});

test("only the carts left untouched are charged", () => {
  assert.equal(missedCartCount(day({ cartsDue: 40, logsMade: 12, cartsLogged: 10 })), 30);
  assert.equal(dayPenaltyAmount(day({ cartsDue: 40, logsMade: 12, cartsLogged: 10 })), 15_000);
});

// Repeat calls on the same cart clear that cart once, not once per call.
test("effort on one cart does not clear the rest of the board", () => {
  assert.equal(missedCartCount(day({ cartsDue: 40, logsMade: 9, cartsLogged: 1 })), 39);
});

test("a fully worked board owes nothing", () => {
  const rows = summariseRepPenalties([day({ cartsDue: 40, logsMade: 40, cartsLogged: 40 })]);
  assert.equal(rows[0].atRiskAmount, 0);
  assert.equal(rows[0].clearDays, 1);
});

// Logging MORE carts than the board holds cannot buy credit.
test("over-logging never produces a negative charge", () => {
  assert.equal(missedCartCount(day({ cartsDue: 5, logsMade: 20, cartsLogged: 20 })), 0);
  assert.equal(dayPenaltyAmount(day({ cartsDue: 5, logsMade: 20, cartsLogged: 20 })), 0);
});

// Older callers that never sent cartsLogged must not suddenly bill a full
// board to a rep who did work - unknown means "assume covered".
test("an unknown distinct-cart count never over-charges", () => {
  assert.equal(missedCartCount({ ...day({ cartsDue: 40, logsMade: 3 }), cartsLogged: undefined }), 0);
  assert.equal(missedCartCount({ ...day({ cartsDue: 40, logsMade: 0 }), cartsLogged: undefined }), 40);
});

test("misses accumulate across days and rank worst rep first", () => {
  const rows = summariseRepPenalties([
    day({ repId: "a", repName: "A", dateKey: "2026-08-24", logsMade: 0 }),
    day({ repId: "a", repName: "A", dateKey: "2026-08-25", logsMade: 0 }),
    day({ repId: "b", repName: "B", dateKey: "2026-08-24", logsMade: 0 }),
    day({ repId: "b", repName: "B", dateKey: "2026-08-25", logsMade: 3 })
  ]);
  assert.equal(rows[0].repId, "a");
  assert.equal(rows[0].missedCount, 2);
  assert.equal(rows[0].atRiskAmount, 61_000);
  assert.equal(rows[0].missedCarts, 122);
  assert.equal(rows[1].missedCount, 1);
  assert.equal(rows[1].clearDays, 1);
});

test("a rep who never missed reports zero at risk", () => {
  const rows = summariseRepPenalties([day({ logsMade: 4 }), day({ dateKey: "2026-08-26", logsMade: 2 })]);
  assert.equal(rows[0].atRiskAmount, 0);
  assert.equal(rows[0].clearDays, 2);
  assert.deepEqual(rows[0].missedDays, []);
});

test("the countdown reads down to go-live and flips after", () => {
  assert.equal(penaltyPhase("2026-08-22").active, false);
  assert.equal(penaltyPhase("2026-08-22").daysUntil, 2);
  assert.equal(penaltyPhase("2026-08-23").label, "Penalties start tomorrow");
  assert.equal(penaltyPhase("2026-08-24").active, true);
  assert.equal(penaltyPhase("2026-08-24").label, "Penalties are live");
  assert.equal(penaltyPhase("2026-09-01").active, true);
});

test("Monday of a mid-week day is that week's Monday", () => {
  assert.equal(mondayOf("2026-08-22"), "2026-08-17"); // Saturday
  assert.equal(mondayOf("2026-08-17"), "2026-08-17"); // Monday itself
});

// A Sunday review looks BACK at the week that just ended.
test("Sunday belongs to the week that just finished, not the next one", () => {
  assert.equal(mondayOf("2026-08-23"), "2026-08-17");
});

test("today and yesterday resolve to single days", () => {
  assert.deepEqual(resolveRange("today", "2026-08-22"), { from: "2026-08-22", to: "2026-08-22" });
  assert.deepEqual(resolveRange("yesterday", "2026-08-22"), { from: "2026-08-21", to: "2026-08-21" });
});

test("this week runs Monday to today, not Monday to Saturday", () => {
  assert.deepEqual(resolveRange("this_week", "2026-08-19"), { from: "2026-08-17", to: "2026-08-19" });
});

test("last week is a full Monday to Saturday block", () => {
  assert.deepEqual(resolveRange("last_week", "2026-08-22"), { from: "2026-08-10", to: "2026-08-15" });
});

test("this month starts on the first", () => {
  assert.deepEqual(resolveRange("this_month", "2026-08-22"), { from: "2026-08-01", to: "2026-08-22" });
});

test("last month spans the whole previous calendar month", () => {
  assert.deepEqual(resolveRange("last_month", "2026-08-22"), { from: "2026-07-01", to: "2026-07-31" });
});

test("last month handles a January rollover into December", () => {
  assert.deepEqual(resolveRange("last_month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
});

// "all" must not silently invent a start date and cut history.
test("all time leaves the lower bound off entirely", () => {
  assert.equal(resolveRange("all", "2026-08-22").from, null);
});

test("a chargeable range skips Sundays", () => {
  const days = chargeableDaysIn("2026-08-17", "2026-08-24");
  assert.equal(days.length, 7);
  assert.ok(!days.includes("2026-08-23"));
  assert.equal(days[0], "2026-08-17");
});

test("a backwards range yields nothing rather than looping", () => {
  assert.deepEqual(chargeableDaysIn("2026-08-24", "2026-08-17"), []);
});

// ── Today's standing, the part a rep actually reads ──

test("a rep who has logged nothing today is told they still can", () => {
  const standing = todayStanding(day({ dateKey: "2026-08-25", cartsDue: 61, logsMade: 0 }));
  assert.equal(standing.status, "missed");
  assert.equal(standing.atRisk, 30_500);
  assert.equal(standing.cartsRemaining, 61);
  assert.match(standing.message, /before the day ends/);
  // The rate has to appear next to the total, or ₦30,500 reads as a bug.
  assert.match(standing.message, /₦500 each/);
});

test("a rep who has logged today is clear and owes nothing", () => {
  const standing = todayStanding(day({ dateKey: "2026-08-25", logsMade: 61, cartsLogged: 61 }));
  assert.equal(standing.status, "clear");
  assert.equal(standing.atRisk, 0);
  assert.equal(standing.cartsRemaining, 0);
  assert.match(standing.message, /Whole board logged/);
});

// ⚠️ Under the old flat rule this rep was "clear". They are not any more.
test("a partly worked board is still a miss, for the remainder only", () => {
  const standing = todayStanding(day({ dateKey: "2026-08-25", cartsDue: 40, logsMade: 5, cartsLogged: 5 }));
  assert.equal(standing.status, "missed");
  assert.equal(standing.cartsRemaining, 35);
  assert.equal(standing.atRisk, 17_500);
});

// Before go-live the warning still shows, but no money is at stake.
test("during the rehearsal the same miss costs nothing", () => {
  const standing = todayStanding(day({ dateKey: "2026-08-21", cartsDue: 40, logsMade: 0 }));
  assert.equal(standing.rehearsal, true);
  assert.equal(standing.atRisk, 0);
  assert.match(standing.message, /From 2026-08-24 that is 40 × ₦500 = ₦20,000/);
});

test("Sunday says nothing is due rather than showing a risk", () => {
  const standing = todayStanding(day({ dateKey: "2026-08-30", cartsDue: 40, logsMade: 0 }));
  assert.equal(standing.atRisk, 0);
  assert.match(standing.message, /Sunday/);
});

test("an empty board is not a warning", () => {
  const standing = todayStanding(day({ dateKey: "2026-08-25", cartsDue: 0, logsMade: 0 }));
  assert.equal(standing.status, "not_due");
  assert.equal(standing.atRisk, 0);
  assert.match(standing.message, /No carts/);
});

// ── Regression: the due-set intersection ──
//
// Chelsea, 24 Aug 2026: 11 carts due, 37 distinct carts logged, but only 8 of
// those were hers-and-due. She owed for 3 and the board showed nothing,
// because the raw 37 was clamped to 11 and cancelled the whole obligation.

test("only logs against DUE carts clear the board", () => {
  const chelsea = day({ cartsDue: 11, logsMade: 52, cartsLogged: 8 });
  assert.equal(missedCartCount(chelsea), 3);
  assert.equal(dayPenaltyAmount(chelsea), 1_500);
  assert.equal(repDayStatus(chelsea), "missed");
});

test("a busy day on carts that were never due clears nothing", () => {
  assert.equal(missedCartCount(day({ cartsDue: 11, logsMade: 37, cartsLogged: 0 })), 11);
});
