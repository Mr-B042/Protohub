import assert from "node:assert/strict";
import test from "node:test";
import { followUpReminderKey, sameFollowUpReminder } from "./follow-up-reminder-key.js";

const trimText = (value: string, max = 120) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

const build = (fixedStart: string, tail: string) => {
  const message = trimText([fixedStart, tail].join(" · "));
  return { message, key: followUpReminderKey(message, fixedStart) };
};

test("order #5038: editing the status note does not re-send the same reminder", () => {
  const fixedStart = "Mrs bola Bello · Multi Corner Storage Shelf — Basic Package · scheduled for 17 Oct 2026, 4:55 pm";
  const first = build(fixedStart, "Scheduled for 17 Oct · ₦73,000");
  const afterEdit = build(fixedStart, "Assigned to delivery agent · ₦85,000");
  assert.notEqual(first.message, afterEdit.message);
  assert.equal(sameFollowUpReminder(first.message, afterEdit.key), true);
});

test("a new follow-up time is a new reminder", () => {
  const first = build("Ada · Shelf · scheduled for 17 Oct 2026, 4:55 pm", "note");
  const moved = build("Ada · Shelf · scheduled for 18 Oct 2026, 10:00 am", "note");
  assert.equal(sameFollowUpReminder(first.message, moved.key), false);
});

test("a fixed start longer than the cut still matches", () => {
  const fixedStart = `${"A very long customer name ".repeat(4)}· ${"Long product ".repeat(4)}· scheduled for 17 Oct 2026, 4:55 pm`;
  const first = build(fixedStart, "one note");
  const second = build(fixedStart, "another note");
  assert.equal(sameFollowUpReminder(first.message, second.key), true);
});
