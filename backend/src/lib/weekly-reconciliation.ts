// Weekly Reconciliation: what the books say vs what is really in the accounts.
//
// ⚠️ Direction matters and is fixed: variance = ACTUAL − EXPECTED.
// Negative means money is missing (less in the accounts than the books claim),
// positive means unrecorded money arrived. Flipping this sign turns "₦120,000
// has gone astray" into "we found ₦120,000", so every caller reads it the same
// way and nothing here recomputes it locally.

/** Naira are whole numbers; this absorbs float noise, not real differences. */
export const CASH_MATCH_TOLERANCE = 0.5;

export type VerificationAccountInput = {
  bankAccountId: string | null;
  accountLabel: string;
  systemBalance: number;
  actualBalance: number;
};

export type VerificationAccountLine = VerificationAccountInput & {
  difference: number;
  matched: boolean;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** actual − system for one account. Same sign convention as the week total. */
export function accountDifference(row: { systemBalance: unknown; actualBalance: unknown }): number {
  return num(row.actualBalance) - num(row.systemBalance);
}

export function isMatched(difference: number): boolean {
  return Math.abs(num(difference)) <= CASH_MATCH_TOLERANCE;
}

export type VerificationSummary = {
  lines: VerificationAccountLine[];
  totalSystem: number;
  totalActual: number;
  variance: number;
  matchedCount: number;
  mismatchedCount: number;
  totalCount: number;
};

/**
 * Roll a week's per-account count into the figures the panel shows.
 *
 * The week variance is the sum of the account differences rather than a
 * separately-typed total, so the breakdown can never disagree with the
 * headline - if the accounts add up, the variance is right by construction.
 */
export function summariseVerification(rows: VerificationAccountInput[]): VerificationSummary {
  const lines: VerificationAccountLine[] = (rows ?? []).map((row) => {
    const difference = accountDifference(row);
    return {
      bankAccountId: row.bankAccountId ?? null,
      accountLabel: row.accountLabel ?? "",
      systemBalance: num(row.systemBalance),
      actualBalance: num(row.actualBalance),
      difference,
      matched: isMatched(difference)
    };
  });
  const totalSystem = lines.reduce((sum, line) => sum + line.systemBalance, 0);
  const totalActual = lines.reduce((sum, line) => sum + line.actualBalance, 0);
  const matchedCount = lines.filter((line) => line.matched).length;
  return {
    lines,
    totalSystem,
    totalActual,
    variance: totalActual - totalSystem,
    matchedCount,
    mismatchedCount: lines.length - matchedCount,
    totalCount: lines.length
  };
}

export type ReconciliationStatus =
  | "not_verified"
  | "balanced"
  | "needs_investigation"
  | "investigating"
  | "resolved";

export const RECONCILIATION_STATUS_LABEL: Record<ReconciliationStatus, string> = {
  not_verified: "Not Verified",
  balanced: "Balanced",
  needs_investigation: "Needs Investigation",
  investigating: "Investigating",
  resolved: "Resolved"
};

/**
 * The one status badge the whole week is judged by.
 *
 * ⚠️ A resolved investigation does NOT make a week balanced, and is not
 * allowed to look like one. The money is still missing; what changed is that
 * it is now explained. Collapsing the two would let a week with ₦120,000 gone
 * read identically to a week that reconciled exactly.
 */
export function reconciliationStatus(input: {
  verified: boolean;
  variance: number;
  investigationStatus?: "in_progress" | "submitted" | "resolved" | null;
}): ReconciliationStatus {
  if (!input.verified) return "not_verified";
  if (isMatched(num(input.variance))) return "balanced";
  if (input.investigationStatus === "resolved") return "resolved";
  if (input.investigationStatus === "in_progress" || input.investigationStatus === "submitted") {
    return "investigating";
  }
  return "needs_investigation";
}

export type InvestigationProgress = {
  variance: number;
  explained: number;
  unexplained: number;
  /** 0-100, rounded. 100 only when nothing is left unexplained. */
  pct: number;
};

/**
 * How much of a variance has actually been accounted for.
 *
 * Worked in ABSOLUTE terms: a −₦120,000 shortfall explained by a ₦100,000
 * unrecorded payment is 83% explained, and signing the explanation the other
 * way would report −83%. The explained figure is clamped to the variance so a
 * fat-fingered entry cannot report more than 100% or a negative remainder.
 */
export function investigationProgress(variance: unknown, explained: unknown): InvestigationProgress {
  const total = Math.abs(num(variance));
  const covered = Math.min(Math.max(Math.abs(num(explained)), 0), total);
  return {
    variance: num(variance),
    explained: covered,
    unexplained: Math.round((total - covered) * 100) / 100,
    pct: total <= CASH_MATCH_TOLERANCE ? 100 : Math.round((covered / total) * 100)
  };
}

export const VARIANCE_REASONS = [
  "missing_transaction",
  "incorrect_transaction",
  "timing_difference",
  "bank_charges",
  "owner_withdrawal",
  "cash_shortage",
  "agent_remittance",
  "transfer_misclassified",
  "other"
] as const;

export type VarianceReason = (typeof VARIANCE_REASONS)[number];

export const VARIANCE_REASON_LABEL: Record<VarianceReason, string> = {
  missing_transaction: "Missing Transaction",
  incorrect_transaction: "Incorrect Transaction",
  timing_difference: "Timing Difference",
  bank_charges: "Bank Charges / Fees",
  owner_withdrawal: "Owner Withdrawal",
  cash_shortage: "Cash Shortage",
  agent_remittance: "Agent Remittance Issue",
  transfer_misclassified: "Transfer Misclassified",
  other: "Other"
};
