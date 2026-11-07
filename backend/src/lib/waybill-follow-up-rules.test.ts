import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS, cleanSettings, complianceRate, logProblem, missedCharges, noNewsStreak, owesSession, sessionForLog,
  sessionStatus, sessionWindows, waybillState, type FollowUpWaybill
} from "./waybill-follow-up-rules.js";

const at = (dateKey: string, hhmm: string) => Date.parse(`${dateKey}T${hhmm}:00+01:00`);
const DAY = "2026-11-09"; // a Monday
const windows = sessionWindows(DAY, 15);
const w = (key: string) => windows.find((row) => row.key === key)!;

test("five sessions a day, each logged on its own; the evening counts once from 4 to 5 PM", () => {
  assert.deepEqual(windows.map((row) => [row.label, row.timeLabel]), [
    ["Morning 1", "8:00 AM"], ["Morning 2", "10:00 AM"], ["Afternoon 1", "12:00 PM"], ["Afternoon 2", "2:00 PM"], ["Evening", "4:00 – 5:00 PM"]
  ]);
  assert.equal(sessionForLog(at(DAY, "07:46"), 15), "m1");
  assert.equal(sessionForLog(at(DAY, "08:15"), 15), "m1");
  assert.equal(sessionForLog(at(DAY, "08:16"), 15), null); // too late for 8:00, too early for 10:00
  assert.equal(sessionForLog(at(DAY, "10:02"), 15), "m2"); // a 10 AM log never covers 8 AM
  assert.equal(sessionForLog(at(DAY, "16:59"), 15), "ev");
  assert.equal(sessionForLog(at(DAY, "17:01"), 15), null);
});

test("received at 11:35: 12:00, 2:00 and the evening are not owed; nothing before the waybill existed is owed", () => {
  const waybill: FollowUpWaybill = { id: "WB-1", createdMs: at(DAY, "07:00"), status: "Received", closedMs: at(DAY, "11:35") };
  assert.deepEqual(windows.map((row) => owesSession(waybill, row)), [true, true, false, false, false]);
  const lateIn: FollowUpWaybill = { id: "WB-2", createdMs: at(DAY, "10:05"), status: "In Transit", closedMs: null };
  assert.deepEqual(windows.map((row) => owesSession(lateIn, row)), [false, false, true, true, true]);
  // Received inside the window, before it closed: that session is not owed either.
  const quick: FollowUpWaybill = { id: "WB-3", createdMs: at(DAY, "07:00"), status: "Received", closedMs: at(DAY, "12:05") };
  assert.equal(owesSession(quick, w("a1")), false);
  // An old waybill closed before the trigger existed (no time) is never owed.
  assert.equal(owesSession({ id: "WB-4", createdMs: at(DAY, "07:00"), status: "Received", closedMs: null }, w("m1")), false);
});

test("₦500 per waybill per missed session, only after the window closes, on working days, from the start date", () => {
  const settings = { ...DEFAULT_SETTINGS, chargesFrom: DAY };
  const waybills: FollowUpWaybill[] = [
    { id: "WB-1", createdMs: at(DAY, "07:00"), status: "In Transit", closedMs: null },
    { id: "WB-2", createdMs: at(DAY, "07:00"), status: "In Transit", closedMs: null },
    { id: "WB-3", createdMs: at(DAY, "07:00"), status: "In Transit", closedMs: null }
  ];
  const logged = new Set(["WB-1"]);
  const charges = missedCharges({ window: w("m2"), nowMs: at(DAY, "10:16"), workingDay: true, settings, waybills, loggedIds: logged });
  assert.deepEqual(charges.map((row) => [row.waybillId, row.sessionKey, row.amount]), [["WB-2", "m2", 500], ["WB-3", "m2", 500]]);
  assert.deepEqual(missedCharges({ window: w("m2"), nowMs: at(DAY, "10:10"), workingDay: true, settings, waybills, loggedIds: logged }), []); // still open
  assert.deepEqual(missedCharges({ window: w("m2"), nowMs: at(DAY, "10:16"), workingDay: false, settings, waybills, loggedIds: logged }), []); // day off
  assert.deepEqual(missedCharges({ window: w("m2"), nowMs: at(DAY, "10:16"), workingDay: true, settings: { ...settings, chargesFrom: "2026-11-10" }, waybills, loggedIds: logged }), []);
});

test("schedule states: upcoming, open, completed, missed, nothing due, day off", () => {
  const base = { window: w("a1"), workingDay: true };
  assert.equal(sessionStatus({ ...base, nowMs: at(DAY, "11:00"), dueIds: ["A"], loggedIds: new Set() }).status, "upcoming");
  assert.equal(sessionStatus({ ...base, nowMs: at(DAY, "12:05"), dueIds: ["A", "B"], loggedIds: new Set(["A"]) }).status, "open");
  assert.equal(sessionStatus({ ...base, nowMs: at(DAY, "12:05"), dueIds: ["A"], loggedIds: new Set(["A"]) }).status, "completed");
  const missed = sessionStatus({ ...base, nowMs: at(DAY, "12:20"), dueIds: ["A", "B"], loggedIds: new Set(["A"]) });
  assert.deepEqual([missed.status, missed.missing], ["missed", ["B"]]);
  assert.equal(sessionStatus({ ...base, nowMs: at(DAY, "12:20"), dueIds: [], loggedIds: new Set() }).status, "nothing_due");
  assert.equal(sessionStatus({ ...base, workingDay: false, nowMs: at(DAY, "12:20"), dueIds: ["A"], loggedIds: new Set() }).status, "off");
});

test("a log needs a channel, what the agent said and the notes (required, up to 500)", () => {
  const ok = { waybillIds: ["WB-1"], channels: ["call"], response: "no_answer", responseNote: "Called twice, not picked" };
  assert.equal(logProblem(ok), null);
  assert.match(logProblem({ ...ok, channels: [] })!, /WhatsApp group, phone call, or both/);
  assert.match(logProblem({ ...ok, response: "made_up" })!, /what the agent said/);
  assert.match(logProblem({ ...ok, responseNote: "" })!, /Write the follow-up notes/);
  assert.match(logProblem({ ...ok, response: "other", responseNote: "" })!, /Write what the agent said/);
  assert.match(logProblem({ ...ok, responseNote: "x".repeat(501) })!, /under 500/);
  assert.match(logProblem({ ...ok, waybillIds: [] })!, /at least one waybill/);
});

test("waybill states and the no-news streak", () => {
  const now = at(DAY, "12:00");
  assert.equal(waybillState({ lastResponse: "received", createdMs: now - 86_400_000, nowMs: now, overdueAfterDays: 3 }), "verify");
  assert.equal(waybillState({ lastResponse: "in_transit", createdMs: now - 4 * 86_400_000, nowMs: now, overdueAfterDays: 3 }), "overdue");
  assert.equal(waybillState({ lastResponse: "in_transit", createdMs: now - 86_400_000, nowMs: now, overdueAfterDays: 3 }), "in_transit");
  assert.equal(waybillState({ lastResponse: null, createdMs: now - 3_600_000, nowMs: now, overdueAfterDays: 3 }), "pending");
  assert.equal(noNewsStreak(["no_answer", "no_reply", "unavailable", "in_transit", "no_answer"]), 3);
  assert.equal(noNewsStreak(["receive_today", "no_answer"]), 0);
  assert.equal(complianceRate(25, 24), 96);
  assert.equal(complianceRate(0, 0), null);
});

test("settings are cleaned", () => {
  const s = cleanSettings({ amount: "750", grace_minutes: 90, working_days: [1, 2, 9, 6], charges_from: "soon", overdue_after_days: 0 });
  assert.deepEqual(s, { responsibleUserId: null, amount: 750, graceMinutes: 45, workingDays: [1, 2, 6], chargesFrom: "2026-11-09", overdueAfterDays: 1 });
});
