// Pure, unit-tested customer-retention worklist logic - no Supabase/Express
// imports here on purpose, so this stays trivially testable. Everything is
// derived from delivered_date + which touchpoint rows already exist; nothing
// is stored as a "next due" column (see backend/supabase/migrations/172).

export type RetentionStage = "satisfaction_check" | "review_referral" | "retention_sale";
export type DueStage = RetentionStage | "needs_resolution" | "win_back" | null;
export type LifecycleStage =
  | "delivered"
  | "satisfaction_check"
  | "review_testimonial"
  | "referral"
  | "repeat_sale"
  | "win_back"
  | "needs_resolution";

// The spec's P1-P6 smart priority system, matched exactly:
// P1 unresolved complaint, P2 overdue follow-up, P3 high-value customer,
// P4 satisfaction check, P5 review/referral opportunity, P6 repeat-sale/
// win-back (the spec explicitly groups these last two into one tier -
// "revenue opportunity after service obligations are covered").
export type PriorityBand = "critical" | "overdue" | "high_value" | "satisfaction_due" | "review_referral_due" | "revenue_opportunity";

export const NEGATIVE_SATISFACTION_OUTCOMES = new Set([
  "has_not_used_it", "needs_usage_guidance", "wrong_damaged_or_incomplete", "not_satisfied"
]);

// Band rank for sorting - lower is more urgent, P1 through P6.
export const PRIORITY_BAND_RANK: Record<PriorityBand, number> = {
  critical: 0, overdue: 1, high_value: 2, satisfaction_due: 3, review_referral_due: 4, revenue_opportunity: 5
};

export const dayKey = (isoOrDate: string) => isoOrDate.slice(0, 10);
export const daysBetween = (fromKey: string, toKey: string) =>
  Math.floor((new Date(`${toKey}T00:00:00Z`).getTime() - new Date(`${fromKey}T00:00:00Z`).getTime()) / 86400000);

export interface RetentionTouchpointRecord {
  stage: RetentionStage;
  satisfaction_outcome: string | null;
  review_collected: boolean | null;
  referral_collected: boolean | null;
  retention_outcome: "accepted" | "declined" | "no_response" | null;
  logged_at: string;
  next_action?: string | null;
  next_action_at?: string | null;
  next_action_note?: string | null;
}

export type ScheduledFollowUpStatus = "scheduled" | "due" | "overdue";

export function scheduledFollowUpFor(
  touchpoints: RetentionTouchpointRecord[],
  todayIso: string
): { nextActionAt: string; note: string | null; status: ScheduledFollowUpStatus; overdueBy: number } | null {
  const latest = touchpoints.length > 0 ? touchpoints[touchpoints.length - 1] : null;
  if (latest?.next_action !== "schedule_follow_up" || !latest.next_action_at) return null;

  const targetKey = dayKey(latest.next_action_at);
  const todayKey = dayKey(todayIso);
  const overdueBy = Math.max(0, daysBetween(targetKey, todayKey));
  return {
    nextActionAt: latest.next_action_at,
    note: latest.next_action_note ?? null,
    status: targetKey < todayKey ? "overdue" : targetKey === todayKey ? "due" : "scheduled",
    overdueBy
  };
}

// A stage only counts as "handled" once a row carries a real completion
// signal, not merely because a row of that stage exists. This is what lets
// a "Not Reached" attempt (reach_status set, nothing else) or a bare
// "review requested" row (review_requested_at set, review_collected still
// false) exist without prematurely closing out the stage.
function stageCompleted(rows: RetentionTouchpointRecord[], stage: RetentionStage): boolean {
  if (stage === "satisfaction_check") return rows.some((t) => t.stage === stage && !!t.satisfaction_outcome);
  if (stage === "review_referral") return rows.some((t) => t.stage === stage && (!!t.review_collected || !!t.referral_collected));
  return rows.some((t) => t.stage === stage && !!t.retention_outcome);
}

// Uses the LATEST satisfaction row with a real outcome (not the first) so a
// customer isn't trapped in Needs Resolution forever after one early
// negative check - a later positive re-check moves them back into normal
// progression. `touchpoints` is expected in ascending logged_at order
// (the existing worklist query already orders this way).
function latestSatisfactionOutcome(touchpoints: RetentionTouchpointRecord[]): string | null {
  const withOutcome = touchpoints.filter((t) => t.stage === "satisfaction_check" && t.satisfaction_outcome);
  return withOutcome.length > 0 ? withOutcome[withOutcome.length - 1].satisfaction_outcome : null;
}

// Org-wide defaults, matching the spec's lifecycle table exactly. A product
// can override any subset of these (backend/supabase/migrations/175) -
// "The exact timing should be configurable by product because a bathroom
// organizer, cleaning tool and other household products may have different
// ideal follow-up windows."
export interface RetentionTiming {
  satisfactionDays: number;
  reviewDays: number;
  repeatSaleStartDays: number;
  repeatSaleEndDays: number;
  winBackEndDays: number;
}
export const DEFAULT_RETENTION_TIMING: RetentionTiming = {
  satisfactionDays: 3, reviewDays: 7, repeatSaleStartDays: 21, repeatSaleEndDays: 45, winBackEndDays: 90
};

export function dueStageFor(
  deliveredDateKey: string,
  todayKey: string,
  touchpoints: RetentionTouchpointRecord[],
  timing: RetentionTiming = DEFAULT_RETENTION_TIMING
): { dueStage: DueStage; overdueBy: number } {
  const age = daysBetween(deliveredDateKey, todayKey);

  if (!stageCompleted(touchpoints, "satisfaction_check")) {
    return age >= timing.satisfactionDays ? { dueStage: "satisfaction_check", overdueBy: age - timing.satisfactionDays } : { dueStage: null, overdueBy: 0 };
  }

  const latestOutcome = latestSatisfactionOutcome(touchpoints);
  if (latestOutcome && NEGATIVE_SATISFACTION_OUTCOMES.has(latestOutcome)) {
    return { dueStage: "needs_resolution", overdueBy: age };
  }

  if (!stageCompleted(touchpoints, "review_referral")) {
    return age >= timing.reviewDays ? { dueStage: "review_referral", overdueBy: age - timing.reviewDays } : { dueStage: null, overdueBy: 0 };
  }

  if (!stageCompleted(touchpoints, "retention_sale")) {
    if (age >= timing.repeatSaleStartDays && age <= timing.repeatSaleEndDays) return { dueStage: "retention_sale", overdueBy: age - timing.repeatSaleStartDays };
    if (age > timing.repeatSaleEndDays && age <= timing.winBackEndDays) return { dueStage: "win_back", overdueBy: age - timing.repeatSaleEndDays };
    return { dueStage: null, overdueBy: 0 };
  }

  return { dueStage: null, overdueBy: 0 };
}

// `dueStageFor` answers "what action is due now?". The Pipeline needs a
// different answer: "where is this customer in the lifecycle?", including
// the quiet waiting windows before an action becomes due.
export function lifecycleStageFor(
  deliveredDateKey: string,
  todayKey: string,
  touchpoints: RetentionTouchpointRecord[],
  timing: RetentionTiming = DEFAULT_RETENTION_TIMING
): LifecycleStage {
  const age = daysBetween(deliveredDateKey, todayKey);
  const satisfactionOutcome = latestSatisfactionOutcome(touchpoints);
  if (satisfactionOutcome && NEGATIVE_SATISFACTION_OUTCOMES.has(satisfactionOutcome)) {
    return "needs_resolution";
  }

  if (!stageCompleted(touchpoints, "satisfaction_check")) {
    return age < timing.satisfactionDays ? "delivered" : "satisfaction_check";
  }

  const reviewCollected = touchpoints.some((row) => row.stage === "review_referral" && !!row.review_collected);
  if (!reviewCollected) return "review_testimonial";

  const referralCollected = touchpoints.some((row) => row.stage === "review_referral" && !!row.referral_collected);
  if (!referralCollected && age < timing.repeatSaleStartDays) return "referral";

  if (age <= timing.repeatSaleEndDays) return "repeat_sale";
  return "win_back";
}

export interface PriorityInput {
  dueStage: DueStage;
  overdueBy: number;
  orderAmount: number;
}
export interface PrioritySettings {
  highValueOrderThreshold: number;
}

export function priorityBandFor(row: PriorityInput, settings: PrioritySettings): PriorityBand {
  if (row.dueStage === "needs_resolution") return "critical";
  if (row.dueStage === null) return "revenue_opportunity";
  if (row.overdueBy > 0) return "overdue";
  if (row.orderAmount >= settings.highValueOrderThreshold) return "high_value";
  if (row.dueStage === "satisfaction_check") return "satisfaction_due";
  if (row.dueStage === "review_referral") return "review_referral_due";
  return "revenue_opportunity"; // retention_sale, win_back
}

export function compareByPriority(
  a: { priorityBand: PriorityBand; overdueBy: number; orderAmount: number },
  b: { priorityBand: PriorityBand; overdueBy: number; orderAmount: number }
): number {
  const bandDiff = PRIORITY_BAND_RANK[a.priorityBand] - PRIORITY_BAND_RANK[b.priorityBand];
  if (bandDiff !== 0) return bandDiff;
  if (b.overdueBy !== a.overdueBy) return b.overdueBy - a.overdueBy;
  return b.orderAmount - a.orderAmount;
}
