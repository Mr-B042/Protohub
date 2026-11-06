import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/late-send-clock.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { sendOutTimer, lateSendWindow, minutesText, lagosTimeText, responseResult, responseTimeText } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const lagos = (iso) => Date.parse(`${iso}+01:00`);

test("running in work hours: counts down working time", () => {
  // Thu 5 Nov 2026, order at 10:15, now 10:21 → 9 min left.
  const timer = sendOutTimer({ placedAt: "2026-11-05T09:15:00Z" }, lagos("2026-11-05T10:21:00"));
  assert.equal(timer.state, "running");
  assert.equal(timer.leftMs, 9 * 60_000);
  assert.equal(timer.paused, false);
  assert.equal(minutesText(timer.leftMs), "9 min");
});

test("5:25pm order: 5 min today, paused overnight, 10 min tomorrow", () => {
  const placed = new Date(lagos("2026-11-05T17:25:00")).toISOString();
  const evening = sendOutTimer({ placedAt: placed }, lagos("2026-11-05T20:00:00"));
  assert.equal(evening.state, "running");
  assert.equal(evening.paused, true);
  assert.equal(evening.leftMs, 10 * 60_000);
  assert.equal(evening.deadlineMs, lagos("2026-11-06T10:10:00"));
  assert.equal(sendOutTimer({ placedAt: placed }, lagos("2026-11-06T10:11:00")).state, "late");
});

test("night order waits for opening; Monday opens at 11", () => {
  const placed = new Date(lagos("2026-11-08T22:00:00")).toISOString(); // Sunday night
  const timer = sendOutTimer({ placedAt: placed }, lagos("2026-11-09T09:00:00"));
  assert.equal(timer.state, "waiting");
  assert.equal(timer.startMs, lagos("2026-11-09T11:00:00"));
  assert.equal(timer.deadlineMs, lagos("2026-11-09T11:15:00"));
  assert.equal(lagosTimeText(timer.startMs, lagos("2026-11-09T09:00:00")), "11:00am");
});

test("arrival = latest of placed, assigned, revealed; late counts working time", () => {
  const timer = sendOutTimer({
    placedAt: new Date(lagos("2026-11-05T09:00:00")).toISOString(),
    assignedAt: new Date(lagos("2026-11-05T12:00:00")).toISOString()
  }, lagos("2026-11-05T12:21:00"));
  assert.equal(timer.state, "late");
  assert.equal(timer.lateMs, 6 * 60_000);
});

test("orders before the rule started have no timer", () => {
  assert.equal(sendOutTimer({ placedAt: "2026-10-20T09:00:00Z" }, lagos("2026-10-20T12:00:00")), null);
  assert.equal(sendOutTimer({ placedAt: null }, Date.now()), null);
});

test("matches the backend window for a Saturday 5:20pm order", () => {
  const { deadlineMs } = lateSendWindow(lagos("2026-11-07T17:20:00"));
  assert.equal(deadlineMs, lagos("2026-11-09T11:05:00")); // 10 min Sat, Sunday closed, 5 min Monday from 11
});

test("Quick / Late response: same deadline as the fine (6 Nov 2026)", () => {
  const iso = (value) => new Date(lagos(value)).toISOString();
  // Thu 10:15 order, sent 10:21 -> quick in 6 min.
  const quick = responseResult({ placedAt: iso("2026-11-05T10:15:00"), sentOutAt: iso("2026-11-05T10:21:00") });
  assert.equal(quick.state, "quick");
  assert.equal(responseTimeText(quick.workingMs), "6 min");
  // Exactly on the deadline is still quick; one second past is late (backend minutesLate).
  assert.equal(responseResult({ placedAt: iso("2026-11-05T10:15:00"), sentOutAt: iso("2026-11-05T10:30:00") }).state, "quick");
  const late = responseResult({ placedAt: iso("2026-11-05T10:15:00"), sentOutAt: iso("2026-11-05T10:57:00") });
  assert.equal(late.state, "late");
  assert.equal(responseTimeText(late.workingMs), "42 min");
  // 5:25pm order sent 10:05am next day: 5 + 5 working minutes = quick.
  const night = responseResult({ placedAt: iso("2026-11-05T17:25:00"), sentOutAt: iso("2026-11-06T10:05:00") });
  assert.equal(night.state, "quick");
  assert.equal(responseTimeText(night.workingMs), "10 min");
  // Sent at 11pm, before the clock starts next morning.
  assert.equal(responseTimeText(responseResult({ placedAt: iso("2026-11-05T22:00:00"), sentOutAt: iso("2026-11-05T23:00:00") }).workingMs), "under 1 min");
  // Reassigned after it was sent out: not this rep's response.
  assert.equal(responseResult({ placedAt: iso("2026-11-05T10:00:00"), assignedAt: iso("2026-11-05T12:00:00"), sentOutAt: iso("2026-11-05T10:05:00") }), null);
  assert.equal(responseResult({ placedAt: iso("2026-11-05T10:00:00") }), null);
});
