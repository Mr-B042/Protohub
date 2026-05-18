export const FOLLOW_UP_OUTCOME_GROUPS = [
  "progress",
  "recoverable",
  "unreachable",
  "closed_loss",
  "other"
] as const;

export const FOLLOW_UP_RECOVERY_BUCKETS = [
  "ready_now",
  "call_tomorrow",
  "call_in_2_3_days",
  "salary_wait",
  "spouse_approval",
  "wants_discount",
  "asked_for_whatsapp",
  "no_answer",
  "switched_off",
  "line_busy",
  "not_interested",
  "wrong_number",
  "out_of_coverage"
] as const;

export type FollowUpOutcomeGroup = typeof FOLLOW_UP_OUTCOME_GROUPS[number];
export type FollowUpRecoveryBucket = typeof FOLLOW_UP_RECOVERY_BUCKETS[number];

export type FollowUpOutcomeDefinition = {
  bucket: FollowUpRecoveryBucket;
  label: string;
  group: FollowUpOutcomeGroup;
  requiresNextAction: boolean;
  defaultOffsetDays?: number;
  defaultOffsetMinutes?: number;
  helper: string;
};

export const FOLLOW_UP_OUTCOME_DEFINITIONS: FollowUpOutcomeDefinition[] = [
  { bucket: "ready_now", label: "Ready now", group: "progress", requiresNextAction: false, helper: "Buyer is ready to move now. Use status change if you are confirming immediately." },
  { bucket: "call_tomorrow", label: "Call tomorrow", group: "recoverable", requiresNextAction: true, defaultOffsetDays: 1, helper: "Buyer asked for a callback tomorrow." },
  { bucket: "call_in_2_3_days", label: "Call in 2-3 days", group: "recoverable", requiresNextAction: true, defaultOffsetDays: 2, helper: "Buyer asked for a 2-3 day follow-up window." },
  { bucket: "salary_wait", label: "Waiting for salary / payday", group: "recoverable", requiresNextAction: true, defaultOffsetDays: 3, helper: "Set the payday callback now so it does not get lost." },
  { bucket: "spouse_approval", label: "Needs spouse approval", group: "recoverable", requiresNextAction: true, defaultOffsetDays: 2, helper: "Follow up after they have had time to discuss it." },
  { bucket: "wants_discount", label: "Wants discount", group: "recoverable", requiresNextAction: true, defaultOffsetDays: 1, helper: "Buyer showed interest, but price is the current objection." },
  { bucket: "asked_for_whatsapp", label: "Asked for WhatsApp details", group: "recoverable", requiresNextAction: true, defaultOffsetMinutes: 60, helper: "Send details and set a near-term follow-up so it still gets closed." },
  { bucket: "no_answer", label: "No answer", group: "unreachable", requiresNextAction: true, defaultOffsetMinutes: 120, helper: "Try again soon while the lead is still fresh." },
  { bucket: "switched_off", label: "Phone switched off", group: "unreachable", requiresNextAction: true, defaultOffsetMinutes: 180, helper: "Retry later in the day when the line may be back on." },
  { bucket: "line_busy", label: "Line busy", group: "unreachable", requiresNextAction: true, defaultOffsetMinutes: 90, helper: "Retry shortly; this is often still recoverable the same day." },
  { bucket: "not_interested", label: "Not interested", group: "closed_loss", requiresNextAction: false, helper: "Close the loop clearly so the queue stays clean." },
  { bucket: "wrong_number", label: "Wrong number", group: "closed_loss", requiresNextAction: false, helper: "No further callback needed unless you correct the number." },
  { bucket: "out_of_coverage", label: "Out of coverage", group: "closed_loss", requiresNextAction: false, helper: "Not currently serviceable for this buyer/location." }
];

export const FOLLOW_UP_OUTCOME_GROUP_LABELS: Record<FollowUpOutcomeGroup, string> = {
  progress: "Ready / Progress",
  recoverable: "Needs another follow-up",
  unreachable: "Could not reach buyer",
  closed_loss: "Likely lost",
  other: "Other"
};

const OUTCOME_BY_BUCKET = new Map(FOLLOW_UP_OUTCOME_DEFINITIONS.map((definition) => [definition.bucket, definition]));
const OUTCOME_BY_LABEL = new Map(FOLLOW_UP_OUTCOME_DEFINITIONS.map((definition) => [definition.label.trim().toLowerCase(), definition]));

export const followUpOutcomeDefinitionForBucket = (bucket?: string | null) =>
  bucket ? OUTCOME_BY_BUCKET.get(bucket as FollowUpRecoveryBucket) ?? null : null;

export const classifyFrontendFollowUpOutcome = (input: {
  outcomeCode?: string | null;
  recoveryBucket?: string | null;
  outcomeGroup?: string | null;
}) => {
  const bucketDefinition = followUpOutcomeDefinitionForBucket(input.recoveryBucket ?? null);
  if (bucketDefinition) {
    return bucketDefinition;
  }
  const normalized = input.outcomeCode?.trim().toLowerCase() ?? "";
  const byLabel = OUTCOME_BY_LABEL.get(normalized);
  if (byLabel) return byLabel;
  return input.outcomeCode?.trim()
    ? {
        bucket: undefined,
        label: input.outcomeCode.trim(),
        group: (input.outcomeGroup as FollowUpOutcomeGroup | undefined) ?? "other",
        requiresNextAction: false,
        helper: ""
      }
    : null;
};

export const followUpOutcomeToneClass = (group?: string | null) => {
  switch (group) {
    case "progress":
      return "bg-emerald-100 text-emerald-700";
    case "recoverable":
      return "bg-blue-100 text-blue-700";
    case "unreachable":
      return "bg-amber-100 text-amber-700";
    case "closed_loss":
      return "bg-rose-100 text-rose-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};
