import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIntegrity, duplicateOf, pickSpotChecks, reachedProblem, repeatProblem, rushedSittings, withoutDuplicates, type IntegrityLog
} from "./cart-log-integrity.js";

let n = 0;
const log = (repId: string, cartId: string, savedAt: string, outcome = "Unresponsive", extra: Partial<IntegrityLog> = {}): IntegrityLog => ({
  id: `l${++n}`, cartId, repId, repName: repId, outcome, custom: null, note: null, reached: false, nextActionAt: null, savedAt, tappedAt: null, ...extra
});

test("spoke-to-them must agree with the outcome", () => {
  assert.match(reachedProblem("Not interested", false)!, /spoke to the customer/);
  assert.match(reachedProblem("Unresponsive", true)!, /nobody answered/);
  assert.equal(reachedProblem("Interested", true), null);
  assert.equal(reachedProblem("Other", false), null);
});

test("same words as an earlier day's log are refused; today's own repeat and new words pass", () => {
  const history = [{ id: "a", repId: "r", outcome: "Other", custom: "Next month", note: "next month", savedAt: "2026-11-20T10:00:00Z" }];
  assert.match(repeatProblem(history, "Other", "next MONTH", "Next month!", "2026-11-24T09:00:00Z")!, /same words as the log on 2026-11-20/);
  assert.equal(repeatProblem(history, "Other", "Will pay on 30th", "Will pay on 30th", "2026-11-24T09:00:00Z"), null);
  assert.equal(repeatProblem(history, "Unresponsive", undefined, undefined, "2026-11-24T09:00:00Z"), null);
});

test("a double-save within 2 minutes returns the first save", () => {
  const history = [{ id: "a", repId: "r", outcome: "Other", custom: "x", note: "y", savedAt: "2026-11-24T09:00:00.000Z" }];
  assert.equal(duplicateOf(history, "r", "Other", "x", "y", "2026-11-24T09:00:01.000Z")?.id, "a");
  assert.equal(duplicateOf(history, "r", "Other", "x", "y", "2026-11-24T09:03:00.000Z"), null);
  assert.equal(duplicateOf(history, "r", "Other", "x", "z", "2026-11-24T09:00:01.000Z"), null);
});

test("double-saves are dropped before anything is counted", () => {
  const a = log("r", "c1", "2026-11-24T09:00:00.000Z"); const b = { ...a, id: "dup", savedAt: "2026-11-24T09:00:00.200Z" };
  assert.deepEqual(withoutDuplicates([a, b]).kept.map((l) => l.id), [a.id]);
});

test("5 different carts at ~30s each is a rushed sitting; calls 3 minutes apart are not", () => {
  const fast = [0, 30, 60, 90, 120].map((s, i) => log("r", `c${i}`, new Date(Date.parse("2026-11-24T18:00:00Z") + s * 1000).toISOString()));
  const slow = [0, 180, 360, 540, 720].map((s, i) => log("q", `d${i}`, new Date(Date.parse("2026-11-24T10:00:00Z") + s * 1000).toISOString()));
  const sit = rushedSittings([...fast, ...slow]);
  assert.equal(sit.length, 1);
  assert.equal(sit[0].repId, "r");
  assert.equal(sit[0].carts, 5);
  assert.equal(sit[0].secondsPerCart, 30);
});

test("the integrity panel ranks the rep with the patterns first and says why", () => {
  const base = Date.parse("2026-11-24T18:00:00Z");
  const rushed = Array.from({ length: 6 }, (_, i) => log("chelsea", `c${i}`, new Date(base + i * 25_000).toISOString(), "Interested"));
  const honest = Array.from({ length: 6 }, (_, i) => log("precious", `p${i}`, new Date(base + i * 300_000).toISOString(), "Not interested",
    { reached: true, custom: "Price", note: `said too costly ${i}` }));
  const out = buildIntegrity({ logs: [...rushed, ...honest], historyBefore: [], repNames: new Map(), convertedCarts: new Set(), tapsSince: null, spot: [] });
  assert.equal(out.reps[0].repId, "chelsea");
  assert.equal(out.reps[0].level, "high");
  assert.equal(out.reps[0].untouched, 6);
  assert.equal(out.reps.find((r) => r.repId === "precious")!.level, "low");
  assert.ok(out.flagged.find((f) => f.repId === "chelsea")!.reasons.some((r) => /pre-filled/.test(r)));
});

test("spot checks: up to 3 per rep, one per cart, the same picks every time", () => {
  const logs = Array.from({ length: 8 }, (_, i) => log("r", `c${i % 5}`, `2026-11-2${i % 3}T10:0${i}:00Z`, "Not interested"));
  const a = pickSpotChecks(logs, "2026-11-22"), b = pickSpotChecks(logs, "2026-11-22");
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((l) => l.cartId)).size, 3);
  assert.deepEqual(a.map((l) => l.id), b.map((l) => l.id));
});

import { laterProblem, pausedOn, rescheduleDateProblem } from "./cart-log-integrity.js";

test("a later day written as Other / Interested is sent to Rescheduled", () => {
  assert.match(laterProblem("Other", "Rescheduled against month ending", "")!, /Rescheduled/);
  assert.match(laterProblem("Interested", null, "will pay after salary")!, /Rescheduled/);
  assert.match(laterProblem("Asked to call back", null, "call back next week")!, /Rescheduled/);
  assert.match(laterProblem("Other", "Saturday", "Saturday")!, /Rescheduled/);
  assert.equal(laterProblem("Asked to call back", null, "call back later today"), null);
  assert.equal(laterProblem("Not interested", "Not ready yet / no money now", "maybe next month"), null);
  assert.equal(laterProblem("Interested", null, "ready, waiting for rider"), null);
});

test("Rescheduled needs a date from tomorrow to 60 days", () => {
  assert.match(rescheduleDateProblem("Rescheduled", "", "2026-11-24")!, /exact date/);
  assert.match(rescheduleDateProblem("Rescheduled", "2026-11-24", "2026-11-24")!, /after today/);
  assert.match(rescheduleDateProblem("Rescheduled", "2027-02-01", "2026-11-24")!, /within 60 days/);
  assert.equal(rescheduleDateProblem("Rescheduled", "2026-11-30", "2026-11-24"), null);
  assert.equal(rescheduleDateProblem("Interested", "", "2026-11-24"), null);
});

test("a dated reschedule pauses the cart until the callback day, then it is due", () => {
  const logs = [{ cartId: "c", savedDay: "2026-11-24", outcome: "Rescheduled", callbackDay: "2026-11-30" }];
  assert.equal(pausedOn(logs, "c", "2026-11-25"), true);
  assert.equal(pausedOn(logs, "c", "2026-11-29"), true);
  assert.equal(pausedOn(logs, "c", "2026-11-30"), false);
  assert.equal(pausedOn(logs, "c", "2026-11-23"), false);
});
