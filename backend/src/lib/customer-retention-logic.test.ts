import test from "node:test";
import assert from "node:assert/strict";
import {
  dueStageFor,
  lifecycleStageFor,
  scheduledFollowUpFor,
  priorityBandFor,
  compareByPriority,
  daysBetween,
  type RetentionTouchpointRecord,
  type PriorityBand
} from "./customer-retention-logic.js";
import type { RetentionTiming } from "./customer-retention-logic.js";

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

test("dueStageFor: a per-product timing override changes the satisfaction-check threshold", () => {
  const fastTiming: RetentionTiming = { satisfactionDays: 1, reviewDays: 7, repeatSaleStartDays: 21, repeatSaleEndDays: 45, winBackEndDays: 90 };
  assert.deepEqual(dueStageFor("2026-01-01", "2026-01-02", [], fastTiming), { dueStage: "satisfaction_check", overdueBy: 0 });
  // Same age is NOT yet due under the org-wide default (3 days).
  assert.deepEqual(dueStageFor("2026-01-01", "2026-01-02", []), { dueStage: null, overdueBy: 0 });
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

test("lifecycleStageFor keeps recently delivered customers visible before the first check is due", () => {
  assert.equal(lifecycleStageFor("2026-01-01", "2026-01-02", []), "delivered");
  assert.equal(lifecycleStageFor("2026-01-01", "2026-01-04", []), "satisfaction_check");
});

test("lifecycleStageFor progresses through advocacy and revenue stages", () => {
  const satisfied = [tp({ satisfaction_outcome: "satisfied", logged_at: "2026-01-04T00:00:00Z" })];
  assert.equal(lifecycleStageFor("2026-01-01", "2026-01-08", satisfied), "review_testimonial");

  const reviewed = [
    ...satisfied,
    tp({ stage: "review_referral", review_collected: true, logged_at: "2026-01-09T00:00:00Z" })
  ];
  assert.equal(lifecycleStageFor("2026-01-01", "2026-01-10", reviewed), "referral");
  assert.equal(lifecycleStageFor("2026-01-01", "2026-01-25", reviewed), "repeat_sale");
  assert.equal(lifecycleStageFor("2026-01-01", "2026-02-20", reviewed), "win_back");
});

test("lifecycleStageFor sends unresolved negative feedback to resolution", () => {
  assert.equal(
    lifecycleStageFor("2026-01-01", "2026-01-05", [tp({ satisfaction_outcome: "not_satisfied" })]),
    "needs_resolution"
  );
});

test("a retention_sale row with any outcome closes out that stage (no win_back after)", () => {
  const rows = [
    tp({ satisfaction_outcome: "satisfied", logged_at: "2026-01-04T00:00:00Z" }),
    tp({ stage: "review_referral", review_collected: true, logged_at: "2026-01-09T00:00:00Z" }),
    tp({ stage: "retention_sale", retention_outcome: "declined", logged_at: "2026-01-25T00:00:00Z" })
  ];
  assert.deepEqual(dueStageFor("2026-01-01", "2026-03-01", rows), { dueStage: null, overdueBy: 0 });
});

test("scheduledFollowUpFor keeps the latest scheduled follow-up actionable", () => {
  const rows = [
    tp({
      next_action: "schedule_follow_up",
      next_action_at: "2026-01-08T10:00:00Z",
      next_action_note: "Customer asked for a morning call",
      logged_at: "2026-01-04T00:00:00Z"
    })
  ];
  assert.deepEqual(scheduledFollowUpFor(rows, "2026-01-07T15:00:00Z"), {
    nextActionAt: "2026-01-08T10:00:00Z",
    note: "Customer asked for a morning call",
    status: "scheduled",
    overdueBy: 0
  });
  assert.equal(scheduledFollowUpFor(rows, "2026-01-08T15:00:00Z")?.status, "due");
  assert.deepEqual(scheduledFollowUpFor(rows, "2026-01-10T15:00:00Z"), {
    nextActionAt: "2026-01-08T10:00:00Z",
    note: "Customer asked for a morning call",
    status: "overdue",
    overdueBy: 2
  });
});

test("scheduledFollowUpFor clears the schedule after a later logged outcome", () => {
  const rows = [
    tp({
      next_action: "schedule_follow_up",
      next_action_at: "2026-01-08T10:00:00Z",
      logged_at: "2026-01-04T00:00:00Z"
    }),
    tp({
      stage: "review_referral",
      next_action: "request_review",
      logged_at: "2026-01-08T10:30:00Z"
    })
  ];
  assert.equal(scheduledFollowUpFor(rows, "2026-01-09T00:00:00Z"), null);
});

test("priorityBandFor: needs_resolution is always critical (P1) regardless of value/overdue", () => {
  assert.equal(priorityBandFor({ dueStage: "needs_resolution", overdueBy: 0, orderAmount: 1000 }, { highValueOrderThreshold: 50000 }), "critical");
});

test("priorityBandFor: overdue (P2) beats high-value (P3)", () => {
  const band = priorityBandFor({ dueStage: "satisfaction_check", overdueBy: 1, orderAmount: 999999 }, { highValueOrderThreshold: 50000 });
  assert.equal(band, "overdue");
});

test("priorityBandFor: high-value (P3) beats satisfaction_due (P4)", () => {
  assert.equal(priorityBandFor({ dueStage: "satisfaction_check", overdueBy: 0, orderAmount: 60000 }, { highValueOrderThreshold: 50000 }), "high_value");
  assert.equal(priorityBandFor({ dueStage: "satisfaction_check", overdueBy: 0, orderAmount: 10000 }, { highValueOrderThreshold: 50000 }), "satisfaction_due");
});

test("priorityBandFor: satisfaction_due (P4) and review_referral_due (P5) are distinct tiers", () => {
  assert.equal(priorityBandFor({ dueStage: "satisfaction_check", overdueBy: 0, orderAmount: 10000 }, { highValueOrderThreshold: 50000 }), "satisfaction_due");
  assert.equal(priorityBandFor({ dueStage: "review_referral", overdueBy: 0, orderAmount: 10000 }, { highValueOrderThreshold: 50000 }), "review_referral_due");
});

test("priorityBandFor: retention_sale and win_back (not overdue/high-value) both collapse into revenue_opportunity (P6), per spec", () => {
  assert.equal(priorityBandFor({ dueStage: "retention_sale", overdueBy: 0, orderAmount: 10000 }, { highValueOrderThreshold: 50000 }), "revenue_opportunity");
  assert.equal(priorityBandFor({ dueStage: "win_back", overdueBy: 0, orderAmount: 10000 }, { highValueOrderThreshold: 50000 }), "revenue_opportunity");
});

test("compareByPriority: bands rank P1-P6 in order, then overdueBy desc, then amount desc", () => {
  const rows: Array<{ priorityBand: PriorityBand; overdueBy: number; orderAmount: number }> = [
    { priorityBand: "satisfaction_due", overdueBy: 0, orderAmount: 5000 },
    { priorityBand: "critical", overdueBy: 0, orderAmount: 1000 },
    { priorityBand: "overdue", overdueBy: 10, orderAmount: 2000 },
    { priorityBand: "overdue", overdueBy: 20, orderAmount: 1000 },
    { priorityBand: "revenue_opportunity", overdueBy: 0, orderAmount: 100000 },
    { priorityBand: "review_referral_due", overdueBy: 0, orderAmount: 5000 }
  ];
  const sorted = [...rows].sort(compareByPriority);
  assert.deepEqual(sorted.map((r) => r.priorityBand), ["critical", "overdue", "overdue", "satisfaction_due", "review_referral_due", "revenue_opportunity"]);
  assert.equal(sorted[1].overdueBy, 20); // more-overdue row ranks first within the same band
});
