import assert from "node:assert/strict";
import test from "node:test";
import {
  atClaimCap, buildRecoveryCalendar, calendarDayKeys, CRITICAL_ATTAINMENT, dayAttainment, dayStatus,
  isRestDay, type RecoveryDayCounts, type RecoveryDayTargets
} from "./recovery-calendar.js";

const TARGETS: RecoveryDayTargets = { followUp: 10, retention: 10, delivered: 1, claimed: 10 };
const TODAY = "2026-08-24";
const counts = (over: Partial<RecoveryDayCounts> = {}): RecoveryDayCounts =>
  ({ day: "2026-08-20", followUp: 10, retention: 10, delivered: 1, claimed: 10, ...over });

test("Sunday is a rest day, never a failure", () => {
  // 2026-08-23 is a Sunday.
  assert.equal(isRestDay("2026-08-23"), true);
  assert.equal(isRestDay("2026-08-24"), false);
  assert.equal(dayStatus(counts({ day: "2026-08-23", followUp: 0, retention: 0, delivered: 0, claimed: 0 }), TARGETS, TODAY), "rest");
});

test("a future day is unknown, not a miss", () => {
  assert.equal(dayStatus(counts({ day: "2026-08-30", followUp: 0, retention: 0 }), TARGETS, TODAY), "none");
});

// ⚠️ A past day with nothing logged IS a miss - the whole point of the board.
test("a past day with zero activity is critical, not blank", () => {
  assert.equal(dayStatus(counts({ day: "2026-08-20", followUp: 0, retention: 0, delivered: 0, claimed: 0 }), TARGETS, TODAY), "critical");
});

test("hitting every target reads as above", () => {
  assert.equal(dayStatus(counts(), TARGETS, TODAY), "above");
  assert.equal(dayStatus(counts({ followUp: 40, retention: 30, delivered: 5 }), TARGETS, TODAY), "above");
});

test("the WEAKEST metric decides, so one big number cannot bury a duty", () => {
  const lopsided = counts({ followUp: 80, retention: 0, delivered: 1 });
  assert.equal(dayAttainment(lopsided, TARGETS), 0);
  assert.equal(dayStatus(lopsided, TARGETS, TODAY), "critical");
});

test("half of target is the line between below and critical", () => {
  assert.equal(dayStatus(counts({ followUp: 5, retention: 10, delivered: 1 }), TARGETS, TODAY), "below");
  assert.equal(dayStatus(counts({ followUp: 4, retention: 10, delivered: 1 }), TARGETS, TODAY), "critical");
  assert.equal(CRITICAL_ATTAINMENT, 0.5);
});

test("a target of zero is skipped, not treated as instantly met", () => {
  const noDelivered: RecoveryDayTargets = { followUp: 10, retention: 10, delivered: 0, claimed: 0 };
  assert.equal(dayAttainment(counts({ delivered: 0 }), noDelivered), 1);
  assert.equal(dayStatus(counts({ delivered: 0 }), noDelivered, TODAY), "above");
});

test("with no targets at all a day cannot be judged", () => {
  const none: RecoveryDayTargets = { followUp: 0, retention: 0, delivered: 0, claimed: 0 };
  assert.equal(dayAttainment(counts(), none), null);
  assert.equal(dayStatus(counts(), none, TODAY), "none");
});

test("days with no row still appear, as zero days", () => {
  const summary = buildRecoveryCalendar(
    ["2026-08-20", "2026-08-21"], new Map(), TARGETS, TODAY
  );
  assert.equal(summary.days.length, 2);
  assert.equal(summary.days[0].followUp, 0);
  assert.equal(summary.days[0].status, "critical");
});

// ⚠️ A reader of "below target days" must not be shown a figure that quietly
// excludes the very worst days.
test("critical days are counted inside below-target days", () => {
  const byDay = new Map([
    ["2026-08-20", { day: "2026-08-20", followUp: 0, retention: 0, delivered: 0, claimed: 10 }],
    ["2026-08-21", { day: "2026-08-21", followUp: 7, retention: 10, delivered: 1, claimed: 10 }],
    ["2026-08-22", { day: "2026-08-22", followUp: 10, retention: 10, delivered: 1, claimed: 10 }]
  ]);
  const summary = buildRecoveryCalendar(
    ["2026-08-20", "2026-08-21", "2026-08-22"], byDay, TARGETS, TODAY
  );
  assert.equal(summary.belowTargetDays, 2);
  assert.equal(summary.aboveTargetDays, 1);
});

test("rest days sit outside both tallies", () => {
  const summary = buildRecoveryCalendar(
    ["2026-08-23"], new Map(), TARGETS, TODAY
  );
  assert.equal(summary.restDays, 1);
  assert.equal(summary.belowTargetDays, 0);
  assert.equal(summary.aboveTargetDays, 0);
});

test("totals add up across the range", () => {
  const byDay = new Map([
    ["2026-08-20", { day: "2026-08-20", followUp: 4, retention: 7, delivered: 1, claimed: 0 }],
    ["2026-08-21", { day: "2026-08-21", followUp: 6, retention: 5, delivered: 2, claimed: 0 }]
  ]);
  const summary = buildRecoveryCalendar(["2026-08-20", "2026-08-21"], byDay, TARGETS, TODAY);
  assert.equal(summary.followUpTotal, 10);
  assert.equal(summary.retentionTotal, 12);
  assert.equal(summary.deliveredTotal, 3);
});

test("negative or junk counts never leak through as negatives", () => {
  const byDay = new Map([["2026-08-20", { day: "2026-08-20", followUp: -5, retention: Number.NaN, delivered: 1, claimed: 0 }]]);
  const summary = buildRecoveryCalendar(["2026-08-20"], byDay, TARGETS, TODAY);
  assert.equal(summary.days[0].followUp, 0);
  assert.equal(summary.days[0].retention, 0);
});

test("day keys walk the whole range inclusively", () => {
  assert.deepEqual(calendarDayKeys("2026-08-20", "2026-08-22"), ["2026-08-20", "2026-08-21", "2026-08-22"]);
  assert.deepEqual(calendarDayKeys("2026-08-20", "2026-08-20"), ["2026-08-20"]);
  assert.deepEqual(calendarDayKeys("2026-08-22", "2026-08-20"), []);
  assert.deepEqual(calendarDayKeys("junk", "2026-08-20"), []);
});

test("a month boundary is walked correctly", () => {
  assert.deepEqual(calendarDayKeys("2026-07-30", "2026-08-02"),
    ["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"]);
});

// ── Claiming: a separate duty from working the board ──

test("claims are totalled across the range", () => {
  const byDay = new Map([
    ["2026-08-20", { day: "2026-08-20", followUp: 10, retention: 10, delivered: 1, claimed: 12 }],
    ["2026-08-21", { day: "2026-08-21", followUp: 10, retention: 10, delivered: 1, claimed: 3 }]
  ]);
  const summary = buildRecoveryCalendar(["2026-08-20", "2026-08-21"], byDay, TARGETS, TODAY);
  assert.equal(summary.claimedTotal, 15);
});

test("claim days are counted met and missed against the target", () => {
  const byDay = new Map([
    ["2026-08-20", { day: "2026-08-20", followUp: 10, retention: 10, delivered: 1, claimed: 12 }],
    ["2026-08-21", { day: "2026-08-21", followUp: 10, retention: 10, delivered: 1, claimed: 10 }],
    ["2026-08-22", { day: "2026-08-22", followUp: 10, retention: 10, delivered: 1, claimed: 3 }]
  ]);
  const summary = buildRecoveryCalendar(["2026-08-20", "2026-08-21", "2026-08-22"], byDay, TARGETS, TODAY);
  // Exactly on target counts as met.
  assert.equal(summary.claimDaysMet, 2);
  assert.equal(summary.claimDaysMissed, 1);
});

// ⚠️ A rep is not judged on a rest day or on a day they have not reached.
test("Sundays and future days are outside the claim tally", () => {
  const summary = buildRecoveryCalendar(["2026-08-23", "2026-08-30"], new Map(), TARGETS, TODAY);
  assert.equal(summary.claimDaysMet, 0);
  assert.equal(summary.claimDaysMissed, 0);
});

// ⚠️ Claiming now counts toward the day's colour - Bright asked for it -
// EXCEPT when the board was already full, because a rep at the cap cannot
// claim and must not be marked down for it.
test("claiming nothing is a miss when the rep had room to claim", () => {
  const idle = counts({ claimed: 0, heldAtStart: 5 });
  assert.equal(dayAttainment(idle, TARGETS, 20), 0);
  assert.equal(dayStatus(idle, TARGETS, TODAY, 20), "critical");
});

test("claiming nothing AT THE CAP is excused, not punished", () => {
  const full = counts({ claimed: 0, heldAtStart: 20 });
  assert.equal(atClaimCap(full, 20), true);
  assert.equal(dayAttainment(full, TARGETS, 20), 1);
  assert.equal(dayStatus(full, TARGETS, TODAY, 20), "above");
});

test("a capped day counts as neither met nor missed", () => {
  const byDay = new Map([
    ["2026-08-20", { day: "2026-08-20", followUp: 10, retention: 10, delivered: 1, claimed: 0, heldAtStart: 20 }]
  ]);
  const summary = buildRecoveryCalendar(["2026-08-20"], byDay, TARGETS, TODAY, 20);
  assert.equal(summary.claimDaysAtCap, 1);
  assert.equal(summary.claimDaysMet, 0);
  assert.equal(summary.claimDaysMissed, 0);
});

// With no cap configured there is nothing to excuse a rep on.
test("without a cap every short day is a real miss", () => {
  assert.equal(atClaimCap(counts({ heldAtStart: 999 }), 0), false);
  assert.equal(dayStatus(counts({ claimed: 0, heldAtStart: 999 }), TARGETS, TODAY, 0), "critical");
});

test("with no claim target set the tallies stay at zero rather than counting every day", () => {
  const noClaim: RecoveryDayTargets = { ...TARGETS, claimed: 0 };
  const summary = buildRecoveryCalendar(["2026-08-20"], new Map(), noClaim, TODAY);
  assert.equal(summary.claimDaysMet, 0);
  assert.equal(summary.claimDaysMissed, 0);
});
