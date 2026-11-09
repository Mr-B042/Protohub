import assert from "node:assert/strict";
import test from "node:test";
import { REPEAT_WINDOW_MS, repeatWindow, sameStatusSave, takeLock } from "./message-once.js";

test("saving the same status again sends nothing; a new delivery day does", () => {
  assert.equal(sameStatusSave("Confirmed", "Confirmed"), true);
  assert.equal(sameStatusSave("Postponed", "Postponed", "2026-11-10", "2026-11-10"), true);
  assert.equal(sameStatusSave("Postponed", "Postponed", "2026-11-10", "2026-11-12"), false);
  assert.equal(sameStatusSave("Confirmed", "Delivered"), false);
  assert.equal(sameStatusSave(null, "New"), false);
});

test("new-order and delivered go once per order; others once per 12 hours", () => {
  assert.equal(repeatWindow("order_new"), "once");
  assert.equal(repeatWindow("order_delivered"), "once");
  assert.equal(repeatWindow("order_rescheduled"), REPEAT_WINDOW_MS);
});

test("a double tap is stopped for 2 minutes", () => {
  const key = `t:${Math.random()}`;
  assert.equal(takeLock(key, 1_000), true);
  assert.equal(takeLock(key, 60_000), false);
  assert.equal(takeLock(key, 1_000 + 3 * 60_000), true);
});
