import { test } from "node:test";
import assert from "node:assert/strict";
import { chaseMessage, hosChaseMessage, isWorkingNow, stagesDue, workingMinutesBetween } from "./cart-call-alerts-model.js";

const hours = { workStartMinute: 8 * 60 + 30, workEndMinute: 17 * 60, worksSunday: false };
const lagos = (iso: string) => Date.parse(`${iso}+01:00`);

test("only working minutes count: 4:55pm to 8:35am next day is 10 minutes", () => {
  assert.equal(workingMinutesBetween(lagos("2026-11-24T16:55:00"), lagos("2026-11-25T08:35:00"), hours), 10);
  assert.equal(workingMinutesBetween(lagos("2026-11-24T10:00:00"), lagos("2026-11-24T10:25:00"), hours), 25);
});

test("Sunday is skipped unless the branch works Sundays", () => {
  // Sat 28 Nov 4:50pm -> Mon 30 Nov 8:40am = 10 + 10
  assert.equal(workingMinutesBetween(lagos("2026-11-28T16:50:00"), lagos("2026-11-30T08:40:00"), hours), 20);
  assert.equal(isWorkingNow(lagos("2026-11-29T10:00:00"), hours), false);
  assert.equal(isWorkingNow(lagos("2026-11-29T10:00:00"), { ...hours, worksSunday: true }), true);
  assert.equal(isWorkingNow(lagos("2026-11-24T17:30:00"), hours), false);
});

test("stages: call time -> remind, twice -> Head of Sales, an hour -> again", () => {
  assert.deepEqual(stagesDue(9, 10), []);
  assert.deepEqual(stagesDue(10, 10), ["remind"]);
  assert.deepEqual(stagesDue(20, 10), ["remind", "escalate"]);
  assert.deepEqual(stagesDue(60, 10), ["remind", "escalate", "hour"]);
});

test("chase: names never-called carts first and states the charge", () => {
  const m = chaseMessage("morning", [
    { id: "1", customer: "Ada", product: "Racks", neverCalled: false, loggedToday: false },
    { id: "2", customer: "Musa", product: "Shelf", neverCalled: true, loggedToday: false },
    { id: "3", customer: "Done", product: "", neverCalled: false, loggedToday: true }
  ], 500)!;
  assert.match(m.title, /call your 2 carts now/);
  assert.match(m.message, /1 never called/);
  assert.match(m.message, /₦500 each if not logged today \(₦1,000\)/);
  assert.match(m.message, /Start with: Musa \(Shelf\), Ada \(Racks\)/);
  assert.equal(chaseMessage("afternoon", [{ id: "3", customer: "x", product: "", neverCalled: false, loggedToday: true }], 500), null);
});

test("Head of Sales summary lists reps behind, worst first", () => {
  const m = hosChaseMessage("afternoon", [
    { repName: "Precious", due: 0, never: 0, total: 8 }, { repName: "Esther", due: 3, never: 0, total: 9 }, { repName: "Chelsea", due: 7, never: 4, total: 12 }
  ])!;
  assert.match(m.title, /2 reps have 10 carts not called today/);
  assert.match(m.message, /^Chelsea 7 of 12 \(4 never called\) · Esther 3 of 9/);
});
