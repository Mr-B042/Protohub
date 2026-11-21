import assert from "node:assert/strict";
import test from "node:test";
import { DAY, isQuiet, reengageAction, type CheckRound } from "./email-reengage-rules.js";

const NOW = Date.parse("2026-11-21T12:00:00Z");
const none = { lastOpenedMs: null, lastClickedMs: null };
const round = (o: Partial<CheckRound>): CheckRound => ({ round: 1, email1Ms: null, email2Ms: null, email1Waiting: false, email2Waiting: false, ...o });

test("quiet = 3+ emails in 60 days and no open or click in 60 days", () => {
  assert.equal(isQuiet(none, 3, NOW), true);
  assert.equal(isQuiet(none, 2, NOW), false, "new people keep their 3 chances");
  assert.equal(isQuiet({ lastOpenedMs: NOW - 10 * DAY, lastClickedMs: null }, 9, NOW), false);
  assert.equal(isQuiet({ lastOpenedMs: NOW - 61 * DAY, lastClickedMs: null }, 5, NOW), true);
  assert.equal(isQuiet({ lastOpenedMs: null, lastClickedMs: NOW - DAY }, 5, NOW), false);
});

test("the check: email 1, 4 days, email 2, 4 days, stop", () => {
  assert.equal(reengageAction(none, true, null, NOW), "send1");
  assert.equal(reengageAction(none, false, null, NOW), "none");
  assert.equal(reengageAction(none, true, round({ email1Waiting: true }), NOW), "none", "email 1 still queued");
  assert.equal(reengageAction(none, true, round({ email1Ms: NOW - 3 * DAY }), NOW), "none");
  assert.equal(reengageAction(none, true, round({ email1Ms: NOW - 4 * DAY }), NOW), "send2");
  assert.equal(reengageAction(none, true, round({ email1Ms: NOW - 8 * DAY, email2Ms: NOW - 3 * DAY }), NOW), "none");
  assert.equal(reengageAction(none, true, round({ email1Ms: NOW - 8 * DAY, email2Ms: NOW - 4 * DAY }), NOW), "stop");
});

test("opening or clicking anything after email 1 keeps them", () => {
  const opened = { lastOpenedMs: NOW - 2 * DAY, lastClickedMs: null };
  assert.equal(reengageAction(opened, false, round({ email1Ms: NOW - 5 * DAY }), NOW), "none");
  assert.equal(reengageAction(opened, false, round({ email1Ms: NOW - 9 * DAY, email2Ms: NOW - 5 * DAY }), NOW), "none");
});

test("a new check only after the last one is 60+ days old", () => {
  const old = round({ email1Ms: NOW - 80 * DAY, email2Ms: null });
  assert.equal(reengageAction(none, true, old, NOW), "send1");
  assert.equal(reengageAction(none, false, old, NOW), "none");
});
