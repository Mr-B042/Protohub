import test from "node:test";
import assert from "node:assert/strict";
import {
  dueStageFor,
  priorityBandFor,
  compareByPriority,
  daysBetween,
  type RetentionTouchpointRecord,
  type PriorityBand
} from "./customer-retention-logic.js";

const tp = (overrides: Partial<RetentionTouchpointRecord>): RetentionTouchpointRecord => ({
  stage: "satisfaction_check",
  satisfaction_outcome: null,
  review_collected: null,
  referral_collected: null,
  retention_outcome: null,
  logged_at: "2026-01-01T00:00:00Z",
  ...overrides
});

test("no touchpoints: satisfaction_check due once delivered >= 3 days", () => {
  assert.deepEqual(dueStageFor("2026-01-01", "2026-01-03", []), { dueStage: null, overdueBy: 0 });
  assert.deepEqual(dueStageFor("2026-01-01", "2026-01-04", []), { dueStage: "satisfaction_check", overdueBy: 0 });
  assert.deepEqual(dueStageFor("2026-01-01", "2026-01-06", []), { dueStage: "satisfaction_check", overdueBy: 2 });
});

test("negative satisfaction outcome routes to needs_resolution", () => {
  const rows = [tp({ satisfaction_outcome: "not_satisfied" })];
  assert.equal(dueStageFor("2026-01-01", "2026-01-10", rows).dueStage, "needs_resolution");
});

test("needs_resolution re-entry: a LATER positive satisfaction check un-traps the order", () => {
  const rows = [
    tp({ satisfaction_outcome: "not_satisfied", logged_at: "2026-01-04T00:00:00Z" }),
    tp({ satisfaction_outcome: "satisfied", logged_at: "2026-01-08T00:00:00Z" })
  ];
  // Latest outcome is positive, so the order should progress toward review, not stay stuck.
  const result = dueStageFor("2026-01-01", "2026-01-09", rows);
  assert.equal(result.dueStage, "review_referral");
});

test("a review-referral row with no completed field does NOT close out the review stage (requested-only)", () => {
  const rows = [
    tp({ satisfaction_outcome: "satisfied", logged_at: "2026-01-04T00:00:00Z" }),
    tp({ stage: "review_referral", review_collected: false, referral_collected: false, logged_at: "2026-01-09T00:00:00Z" })
  ];
  const result = dueStageFor("2026-01-01", "2026-01-09", rows);
  assert.equal(result.dueStage, "review_referral", "requested-only row must not satisfy the stage");
});

test("a review-referral row with review_collected=true DOES close out the stage", () => {
  const rows = [
    tp({ satisfaction_outcome: "satisfied", logged_at: "2026-01-04T00:00:00Z" }),
    tp({ stage: "review_referral", review_collected: true, logged_at: "2026-01-09T00:00:00Z" })
  ];
  const result = dueStageFor("2026-01-01", "2026-01-25", rows);
  assert.equal(result.dueStage, "retention_sale");
});

test("retention_sale window: due 21-45 days, then win_back 46-90, then nothing past 90", () => {
  const base = [
    tp({ satisfaction_outcome: "satisfied", logged_at: "2026-01-04T00:00:00Z" }),
    tp({ stage: "review_referral", review_collected: true, logged_at: "2026-01-09T00:00:00Z" })
  ];
  assert.equal(dueStageFor("2026-01-01", "2026-01-22", base).dueStage, "retention_sale");
  assert.equal(daysBetween("2026-01-01", "2026-02-15"), 45);
  assert.equal(dueStageFor("2026-01-01", "2026-02-15", base).dueStage, "retention_sale"); // last day of the 21-45 window
  assert.equal(dueStageFor("2026-01-01", "2026-02-16", base).dueStage, "win_back"); // day 46, window rolls into win_back
  assert.equal(daysBetween("2026-01-01", "2026-04-01"), 90);
  assert.equal(dueStageFor("2026-01-01", "2026-04-01", base).dueStage, "win_back"); // day 90, last day of the win-back window
  assert.equal(dueStageFor("2026-01-01", "2026-04-02", base).dueStage, null); // day 91, past win-back
});

test("a retention_sale row with any outcome closes out that stage (no win_back after)", () => {
  const rows = [
    tp({ satisfaction_outcome: "satisfied", logged_at: "2026-01-04T00:00:00Z" }),
    tp({ stage: "review_referral", review_collected: true, logged_at: "2026-01-09T00:00:00Z" }),
    tp({ stage: "retention_sale", retention_outcome: "declined", logged_at: "2026-01-25T00:00:00Z" })
  ];
  assert.deepEqual(dueStageFor("2026-01-01", "2026-03-01", rows), { dueStage: null, overdueBy: 0 });
});

test("priorityBandFor: needs_resolution is always critical regardless of value/overdue", () => {
  assert.equal(priorityBandFor({ dueStage: "needs_resolution", overdueBy: 0, orderAmount: 1000 }, { highValueOrderThreshold: 50000 }), "critical");
});

test("priorityBandFor: overdue beats high-value", () => {
  const band = priorityBandFor({ dueStage: "satisfaction_check", overdueBy: 1, orderAmount: 999999 }, { highValueOrderThreshold: 50000 });
  assert.equal(band, "overdue");
});

test("priorityBandFor: high-value beats plain due", () => {
  assert.equal(priorityBandFor({ dueStage: "satisfaction_check", overdueBy: 0, orderAmount: 60000 }, { highValueOrderThreshold: 50000 }), "high_value");
  assert.equal(priorityBandFor({ dueStage: "satisfaction_check", overdueBy: 0, orderAmount: 10000 }, { highValueOrderThreshold: 50000 }), "due");
});

test("priorityBandFor: win_back (not overdue/high-value) is opportunity", () => {
  assert.equal(priorityBandFor({ dueStage: "win_back", overdueBy: 0, orderAmount: 10000 }, { highValueOrderThreshold: 50000 }), "opportunity");
});

test("compareByPriority: bands rank critical < overdue < high_value < due < opportunity, then overdueBy desc, then amount desc", () => {
  const rows: Array<{ priorityBand: PriorityBand; overdueBy: number; orderAmount: number }> = [
    { priorityBand: "due", overdueBy: 0, orderAmount: 5000 },
    { priorityBand: "critical", overdueBy: 0, orderAmount: 1000 },
    { priorityBand: "overdue", overdueBy: 10, orderAmount: 2000 },
    { priorityBand: "overdue", overdueBy: 20, orderAmount: 1000 },
    { priorityBand: "opportunity", overdueBy: 0, orderAmount: 100000 }
  ];
  const sorted = [...rows].sort(compareByPriority);
  assert.deepEqual(sorted.map((r) => r.priorityBand), ["critical", "overdue", "overdue", "due", "opportunity"]);
  assert.equal(sorted[1].overdueBy, 20); // more-overdue row ranks first within the same band
});
