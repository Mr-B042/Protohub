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

type FollowUpOutcomeDefinition = {
  bucket: FollowUpRecoveryBucket;
  label: string;
  group: FollowUpOutcomeGroup;
  requiresNextAction: boolean;
};

export const FOLLOW_UP_OUTCOME_DEFINITIONS: FollowUpOutcomeDefinition[] = [
  { bucket: "ready_now", label: "Ready now", group: "progress", requiresNextAction: false },
  { bucket: "call_tomorrow", label: "Call tomorrow", group: "recoverable", requiresNextAction: true },
  { bucket: "call_in_2_3_days", label: "Call in 2-3 days", group: "recoverable", requiresNextAction: true },
  { bucket: "salary_wait", label: "Waiting for salary / payday", group: "recoverable", requiresNextAction: true },
  { bucket: "spouse_approval", label: "Needs spouse approval", group: "recoverable", requiresNextAction: true },
  { bucket: "wants_discount", label: "Wants discount", group: "recoverable", requiresNextAction: true },
  { bucket: "asked_for_whatsapp", label: "Asked for WhatsApp details", group: "recoverable", requiresNextAction: true },
  { bucket: "no_answer", label: "No answer", group: "unreachable", requiresNextAction: true },
  { bucket: "switched_off", label: "Phone switched off", group: "unreachable", requiresNextAction: true },
  { bucket: "line_busy", label: "Line busy", group: "unreachable", requiresNextAction: true },
  { bucket: "not_interested", label: "Not interested", group: "closed_loss", requiresNextAction: false },
  { bucket: "wrong_number", label: "Wrong number", group: "closed_loss", requiresNextAction: false },
  { bucket: "out_of_coverage", label: "Out of coverage", group: "closed_loss", requiresNextAction: false }
];

const OUTCOME_BY_BUCKET = new Map(FOLLOW_UP_OUTCOME_DEFINITIONS.map((definition) => [definition.bucket, definition]));
const OUTCOME_BY_LABEL = new Map(
  FOLLOW_UP_OUTCOME_DEFINITIONS.map((definition) => [definition.label.trim().toLowerCase(), definition])
);

const LEGACY_GROUP_OVERRIDES: Array<{ match: RegExp; group: FollowUpOutcomeGroup }> = [
  { match: /confirmed|ready|delivered|recovered delivery|waybill|awaiting payment/i, group: "progress" },
  { match: /not ready|pending|will call back|scheduled callback|travelled|seat at home|have questions/i, group: "recoverable" },
  { match: /no answer|line busy|not picking|switched off|not reached|not available|number not going/i, group: "unreachable" },
  { match: /refused|wrong number|out of stock|out of coverage|not interested/i, group: "closed_loss" }
];

export const followUpOutcomeDefinitionForBucket = (bucket?: string | null) =>
  bucket ? OUTCOME_BY_BUCKET.get(bucket as FollowUpRecoveryBucket) ?? null : null;

export const classifyFollowUpOutcome = (input: {
  outcomeCode: string;
  recoveryBucket?: string | null;
}) => {
  const bucketDefinition = followUpOutcomeDefinitionForBucket(input.recoveryBucket ?? null);
  if (bucketDefinition) {
    return {
      outcomeCode: bucketDefinition.label,
      outcomeGroup: bucketDefinition.group,
      recoveryBucket: bucketDefinition.bucket,
      requiresNextAction: bucketDefinition.requiresNextAction
    };
  }

  const normalized = input.outcomeCode.trim().toLowerCase();
  const labelDefinition = OUTCOME_BY_LABEL.get(normalized);
  if (labelDefinition) {
    return {
      outcomeCode: labelDefinition.label,
      outcomeGroup: labelDefinition.group,
      recoveryBucket: labelDefinition.bucket,
      requiresNextAction: labelDefinition.requiresNextAction
    };
  }

  const legacyMatch = LEGACY_GROUP_OVERRIDES.find((entry) => entry.match.test(input.outcomeCode));
  const outcomeGroup = legacyMatch?.group ?? "other";
  return {
    outcomeCode: input.outcomeCode.trim(),
    outcomeGroup,
    recoveryBucket: null,
    requiresNextAction: outcomeGroup === "recoverable" || outcomeGroup === "unreachable"
  };
};
