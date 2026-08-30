/**
 * What the manager has earned, and what it would take to reach the next level.
 *
 * ⚠️ EVERY FIGURE HERE IS PROVISIONAL UNTIL THE MONTH IS VERIFIED. Contribution
 * keeps moving after month end - late ad invoices, returns, unreconciled agent
 * cash - so a payout computed on the last day of the month is an estimate, not
 * a settlement. The gates below are the difference, and `settleable` is false
 * until every one of them is true. Nothing in this file writes a payment.
 */

export type IncentiveRule = {
  baseReward: number;
  minimumMultiplier: number;
  targetMultiplier: number;
  exceptionalMultiplier: number;
  verificationGates?: Record<string, boolean> | null;
  verificationStatus?: string | null;
};

export type IncentiveLevels = {
  minimum: number;
  target: number;
  exceptional: number;
};

export const INCENTIVE_GATES = [
  "month_closed",
  "deliveries_verified",
  "advertising_complete",
  "returns_recorded",
  "agent_cash_reconciled",
  "data_integrity_confirmed"
] as const;

export type IncentiveOutcome = {
  tier: "none" | "minimum" | "target" | "exceptional";
  tierLabel: string;
  multiplier: number;
  amount: number;
  /** Same maths applied to the projected month-end contribution. */
  projectedTier: IncentiveOutcome["tier"];
  projectedAmount: number;
  /** Contribution still needed to reach the next tier, or null at the top. */
  nextTier: { name: string; threshold: number; shortfall: number; perDay: number } | null;
  gatesMet: string[];
  gatesOutstanding: string[];
  settleable: boolean;
};

const tierFor = (contribution: number, levels: IncentiveLevels): IncentiveOutcome["tier"] => {
  // Descending, so the highest cleared band wins. An exceptional result must
  // never fall through to the target band.
  if (levels.exceptional > 0 && contribution >= levels.exceptional) return "exceptional";
  if (levels.target > 0 && contribution >= levels.target) return "target";
  if (levels.minimum > 0 && contribution >= levels.minimum) return "minimum";
  return "none";
};

export function computeIncentive(
  contribution: number,
  projectedContribution: number,
  levels: IncentiveLevels,
  rule: IncentiveRule,
  daysRemainingInclusive: number
): IncentiveOutcome {
  const tier = tierFor(contribution, levels);
  const multiplierFor = (t: IncentiveOutcome["tier"]) =>
    t === "exceptional" ? rule.exceptionalMultiplier
      : t === "target" ? rule.targetMultiplier
      : t === "minimum" ? rule.minimumMultiplier
      : 0;

  const amountFor = (t: IncentiveOutcome["tier"]) =>
    Math.round((rule.baseReward * multiplierFor(t)) / 100);

  const projectedTier = tierFor(projectedContribution, levels);

  // The next rung up from where the CURRENT result stands.
  const ladder: Array<{ name: string; threshold: number }> = [
    { name: "Minimum", threshold: levels.minimum },
    { name: "Target", threshold: levels.target },
    { name: "Exceptional", threshold: levels.exceptional }
  ].filter((rung) => rung.threshold > 0);

  const next = ladder.find((rung) => contribution < rung.threshold) ?? null;
  const nextTier = next
    ? {
        name: next.name,
        threshold: next.threshold,
        shortfall: Math.round(next.threshold - contribution),
        // What that rung costs per remaining day. Zero days left means the
        // answer is "nothing can reach it", not a division by zero.
        perDay: daysRemainingInclusive > 0
          ? Math.round((next.threshold - contribution) / daysRemainingInclusive)
          : 0
      }
    : null;

  const gates = rule.verificationGates ?? {};
  const gatesMet = INCENTIVE_GATES.filter((gate) => gates[gate] === true);
  const gatesOutstanding = INCENTIVE_GATES.filter((gate) => gates[gate] !== true);

  return {
    tier,
    tierLabel: tier === "none" ? "No reward yet"
      : tier === "minimum" ? "Minimum level"
      : tier === "target" ? "Target level"
      : "Exceptional level",
    multiplier: multiplierFor(tier),
    amount: amountFor(tier),
    projectedTier,
    projectedAmount: amountFor(projectedTier),
    nextTier,
    gatesMet: [...gatesMet],
    gatesOutstanding: [...gatesOutstanding],
    // ⚠️ Settling needs EVERY gate, not a majority. A payout made on partial
    // verification is a payout made on numbers still in motion.
    settleable: gatesOutstanding.length === 0
  };
}
