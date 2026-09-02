export type ChallengeLifecycleStatus = "draft" | "active" | "paused" | "completed";

export type ChallengeProgressInput = {
  startDate: string;
  endDate: string;
  targetUnits: number;
  progressUnits: number;
  status: ChallengeLifecycleStatus;
  today: string;
};

export type ChallengeMilestoneStatus = "Earned" | "Missed" | "In Progress" | "Upcoming" | "Paused" | "Draft";

export type ChallengeMilestone = {
  index: number;
  startDate: string;
  endDate: string;
  targetUnits: number;
  progressUnits: number;
  progressPercent: number;
  rewardAmount: number;
  earnedRewardAmount: number;
  status: ChallengeMilestoneStatus;
};

export type ChallengeMilestoneInput = {
  cadence: "weekly" | "monthly" | "quarterly";
  startDate: string;
  endDate: string;
  targetUnits: number;
  rewardAmount: number;
  milestoneMode: "none" | "weekly";
  milestoneDistribution: "even" | "custom";
  milestoneTargets?: number[];
  status: ChallengeLifecycleStatus;
  today: string;
  orders: Array<{ dateKey: string; units: number }>;
};

const DAY_MS = 86_400_000;

const dayNumber = (dateKey: string) => Math.floor(new Date(`${dateKey}T00:00:00Z`).getTime() / DAY_MS);

const dateKeyFromDayNumber = (value: number) => new Date(value * DAY_MS).toISOString().slice(0, 10);

export const challengeMilestoneCount = (cadence: ChallengeMilestoneInput["cadence"]) => {
  if (cadence === "monthly") return 4;
  if (cadence === "quarterly") return 12;
  return 1;
};

export const distributeWholeNumber = (total: number, count: number) => {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeCount = Math.max(1, Math.trunc(count));
  const base = Math.floor(safeTotal / safeCount);
  const remainder = safeTotal - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) => base + (index < remainder ? 1 : 0));
};

const distributeMoney = (total: number, count: number) =>
  distributeWholeNumber(Math.round(Math.max(0, total) * 100), count).map((amount) => amount / 100);

export function buildChallengeMilestones(input: ChallengeMilestoneInput) {
  if (input.milestoneMode !== "weekly") {
    return { milestones: [] as ChallengeMilestone[], earnedRewardAmount: 0 };
  }

  const count = challengeMilestoneCount(input.cadence);
  const start = dayNumber(input.startDate);
  const end = dayNumber(input.endDate);
  const totalDays = Math.max(1, end - start + 1);
  const baseWindowDays = Math.max(1, Math.floor(totalDays / count));
  const evenTargets = distributeWholeNumber(input.targetUnits, count);
  const customTargets = (input.milestoneTargets ?? []).map((target) => Math.max(0, Math.trunc(target)));
  const targets = input.milestoneDistribution === "custom" && customTargets.length === count
    ? customTargets
    : evenTargets;
  const rewards = distributeMoney(input.rewardAmount, count);
  const today = dayNumber(input.today);

  // Milestones are cumulative checkpoints on the way to the one full-period target, not four
  // independent targets. A slow week does not lock in a loss - it only means more is owed by
  // the next checkpoint, and a later surplus can still clear an earlier shortfall. A checkpoint
  // is only ever "Missed" once the whole challenge's deadline has passed without reaching it;
  // before that, it stays open the same way the overall challenge stays open.
  const totalProgressToDate = input.orders.reduce((sum, order) => {
    const orderDay = dayNumber(order.dateKey);
    return orderDay >= start && orderDay <= Math.min(end, today) ? sum + Math.max(0, Math.trunc(order.units)) : sum;
  }, 0);

  let cumulativeTarget = 0;
  const milestones = Array.from({ length: count }, (_, index): ChallengeMilestone => {
    const milestoneStart = start + index * baseWindowDays;
    const milestoneEnd = index === count - 1 ? end : Math.min(end, milestoneStart + baseWindowDays - 1);
    const sliceTargetUnits = Math.max(1, targets[index] ?? 1);
    cumulativeTarget += sliceTargetUnits;
    // Do not carry today's progress into a future milestone. The challenge
    // total is cumulative, but an upcoming week must remain at zero until its
    // window starts.
    const progressUnits = today < milestoneStart
      ? 0
      : Math.min(totalProgressToDate, cumulativeTarget);
    const progressPercent = Math.max(0, Math.round((progressUnits / cumulativeTarget) * 100));
    let status: ChallengeMilestoneStatus;
    if (input.status === "draft") status = "Draft";
    else if (input.status === "paused") status = "Paused";
    else if (totalProgressToDate >= cumulativeTarget) status = "Earned";
    else if (today > end || input.status === "completed") status = "Missed";
    else if (today < milestoneStart) status = "Upcoming";
    else status = "In Progress";
    const rewardAmount = rewards[index] ?? 0;
    return {
      index: index + 1,
      startDate: dateKeyFromDayNumber(milestoneStart),
      endDate: dateKeyFromDayNumber(milestoneEnd),
      targetUnits: cumulativeTarget,
      progressUnits,
      progressPercent,
      rewardAmount,
      earnedRewardAmount: status === "Earned" ? rewardAmount : 0,
      status
    };
  });

  return {
    milestones,
    earnedRewardAmount: milestones.reduce((sum, milestone) => sum + milestone.earnedRewardAmount, 0)
  };
}

export type RepCheckpointInput = {
  /** The checkpoint currently open, from buildChallengeMilestones. */
  milestone: Pick<ChallengeMilestone, "index" | "targetUnits" | "endDate"> | undefined;
  /**
   * ⚠️ THE UNITS THE MILESTONE LADDER WAS BUILT FROM, and nothing else.
   *
   * buildChallengeMilestones is called with whatever target the caller is
   * scoped to: the TEAM target for a manager, the REP'S OWN target when a rep
   * (or an Owner previewing one) is looking. Its milestone targets come back on
   * that same scale, so scaling a rep's share out of them means dividing by the
   * scale they were built on - not by the team total on reflex.
   *
   * Dividing a rep-scoped ladder by the team total shrinks an already-personal
   * milestone a second time. On the live Edge Brusher challenge that turned
   * Chelsea's 171 pcs checkpoint into ceil(682 x 171 / 2727) = 43, which her
   * 60 delivered pieces cleared - so her dashboard reported 0 pcs remaining
   * and 0 pcs/day needed while the same screen said "Behind".
   */
  milestoneScaleBase: number;
  allocationTarget: number;
  challengeStartDate: string;
  today: string;
  orders: Array<{ dateKey: string; units: number }>;
};

/**
 * One rep's position against the checkpoint that is currently open.
 *
 * ⚠️ BOTH SIDES ARE CUMULATIVE. Milestone targets are running totals by design
 * - a checkpoint is Earned when everything delivered since the challenge began
 * clears it, so an earlier shortfall is still owed and an earlier surplus still
 * counts. Delivered pieces are therefore counted from the challenge start, not
 * from the checkpoint's own Monday. Counting one week of deliveries against a
 * month-to-date target reads as failure by arithmetic alone, and gets worse
 * every week.
 */
export function repCheckpoint(input: RepCheckpointInput) {
  const { milestone } = input;
  if (!milestone || input.milestoneScaleBase <= 0) {
    return { index: 0, endDate: null as string | null, targetUnits: 0, deliveredUnits: 0, remainingUnits: 0, daysLeft: 0 };
  }
  const targetUnits = Math.ceil((input.allocationTarget * milestone.targetUnits) / input.milestoneScaleBase);
  const deliveredUnits = input.orders.reduce((sum, order) => (
    order.dateKey >= input.challengeStartDate && order.dateKey <= milestone.endDate
      ? sum + Math.max(0, Math.trunc(order.units))
      : sum
  ), 0);
  return {
    index: milestone.index,
    endDate: milestone.endDate,
    targetUnits,
    deliveredUnits,
    remainingUnits: Math.max(0, targetUnits - deliveredUnits),
    daysLeft: Math.max(0, dayNumber(milestone.endDate) - dayNumber(input.today) + 1)
  };
}

export function evaluateChallengeProgress(input: ChallengeProgressInput) {
  const target = Math.max(1, Math.trunc(input.targetUnits));
  const progressUnits = Math.max(0, Math.trunc(input.progressUnits));
  const progressPercent = Math.max(0, Math.round((progressUnits / target) * 100));
  const start = dayNumber(input.startDate);
  const end = dayNumber(input.endDate);
  const today = dayNumber(input.today);
  const totalDays = Math.max(1, end - start + 1);
  const elapsedDays = Math.min(totalDays, Math.max(0, today - start + 1));
  const expectedPercent = Math.round((elapsedDays / totalDays) * 100);
  const daysLeft = Math.max(0, end - today);

  let computedStatus = "On Track";
  if (input.status === "draft") computedStatus = "Draft";
  else if (input.status === "paused") computedStatus = "Paused";
  else if (input.status === "completed") computedStatus = "Completed";
  else if (today < start) computedStatus = "Upcoming";
  else if (progressPercent >= 100) computedStatus = "Achieved";
  else if (today > end) computedStatus = "Ended";
  else if (progressPercent + 15 < expectedPercent) computedStatus = "Behind";
  else if (progressPercent + 5 < expectedPercent) computedStatus = "At Risk";

  return { progressUnits, progressPercent, expectedPercent, daysLeft, computedStatus };
}
