// Per-day recovery activity for the bonus calendar.
//
// The panel's cards answer "how much across the range". The calendar answers
// "which days were the bad ones", which is the question a supervisor actually
// acts on - a month that lands on target can still hide a fortnight of nothing.

export type RecoveryDayCounts = {
  /** YYYY-MM-DD, Lagos. */
  day: string;
  followUp: number;
  retention: number;
  delivered: number;
  /** Orders CLAIMED that day - a separate duty from working the board. */
  claimed: number;
  /**
   * Open orders the rep was already holding when the day began.
   *
   * ⚠️ A rep at the claim cap CANNOT claim, so a zero-claim day at the cap is
   * correct behaviour. Without this the claim target would mark them down for
   * doing exactly the right thing.
   */
  heldAtStart?: number;
};

export type RecoveryDayTargets = {
  followUp: number;
  retention: number;
  delivered: number;
  claimed: number;
};

/**
 * ⚠️ "rest" is a first-class status, not a kind of failure.
 *
 * Sundays are a rest day across this business - the order follow-up KPI skips
 * them and so does the cart log penalty. Colouring a rep's Sunday red for
 * missing a target they were never set would invent a failure, so a Sunday is
 * neutral and is counted in neither the below nor the above tally.
 *
 * "none" means nothing is known yet: a future day, or a day before the rep
 * started. Distinct from a zero day, which IS a miss.
 */
export type RecoveryDayStatus = "none" | "rest" | "critical" | "below" | "above";

/** Was the rep unable to claim that day because their board was full? */
export function atClaimCap(counts: RecoveryDayCounts, claimCap: number): boolean {
  if (!Number.isFinite(claimCap) || claimCap <= 0) return false;
  return (Number(counts.heldAtStart) || 0) >= claimCap;
}

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** Sunday in Lagos. Dates are plain keys, so UTC parsing is exact here. */
export function isRestDay(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCDay() === 0;
}

/**
 * How close a day came to its targets, as a 0..1+ ratio.
 *
 * ⚠️ The WEAKEST metric decides. A rep who logs eighty follow-ups and no
 * retention touches has not had a good day, and averaging the two would let a
 * single big number bury an entire ignored duty.
 *
 * Targets set to zero are skipped rather than treated as instantly met.
 */
export function dayAttainment(
  counts: RecoveryDayCounts, targets: RecoveryDayTargets, claimCap = 0
): number | null {
  const ratios: number[] = [];
  if (num(targets.followUp) > 0) ratios.push(num(counts.followUp) / num(targets.followUp));
  if (num(targets.retention) > 0) ratios.push(num(counts.retention) / num(targets.retention));
  if (num(targets.delivered) > 0) ratios.push(num(counts.delivered) / num(targets.delivered));
  // ⚠️ Claiming counts EXCEPT when the board was already full. A rep at the cap
  // cannot claim, so judging them on it would mark them down for doing exactly
  // the right thing - which is why the cap has to be read here rather than the
  // metric simply being left out.
  if (num(targets.claimed) > 0 && !atClaimCap(counts, claimCap)) {
    ratios.push(num(counts.claimed) / num(targets.claimed));
  }
  if (ratios.length === 0) return null;
  return Math.min(...ratios);
}

/** Below half of target is called out separately - it is a different problem. */
export const CRITICAL_ATTAINMENT = 0.5;

export function dayStatus(
  counts: RecoveryDayCounts,
  targets: RecoveryDayTargets,
  todayKey: string,
  claimCap = 0
): RecoveryDayStatus {
  if (counts.day > todayKey) return "none";
  if (isRestDay(counts.day)) return "rest";
  const attainment = dayAttainment(counts, targets, claimCap);
  if (attainment === null) return "none";
  if (attainment >= 1) return "above";
  return attainment < CRITICAL_ATTAINMENT ? "critical" : "below";
}

export type RecoveryCalendarDay = RecoveryDayCounts & {
  status: RecoveryDayStatus;
  attainment: number | null;
  /** The board was full, so no claim was possible - not a miss. */
  claimCapped: boolean;
};

export type RecoveryCalendarSummary = {
  days: RecoveryCalendarDay[];
  followUpTotal: number;
  retentionTotal: number;
  deliveredTotal: number;
  claimedTotal: number;
  /** Working days that reached the claim target - the answer to "is she hitting it". */
  claimDaysMet: number;
  /** Working days that did not, ignoring days with no board activity at all. */
  claimDaysMissed: number;
  /** Working days the rep could not claim on because the board was full. */
  claimDaysAtCap: number;
  belowTargetDays: number;
  aboveTargetDays: number;
  restDays: number;
};

/** Every day in the range, including ones with no activity at all. */
export function buildRecoveryCalendar(
  dayKeys: string[],
  countsByDay: Map<string, RecoveryDayCounts>,
  targets: RecoveryDayTargets,
  todayKey: string,
  claimCap = 0
): RecoveryCalendarSummary {
  const days = dayKeys.map((day) => {
    const counts = countsByDay.get(day) ?? { day, followUp: 0, retention: 0, delivered: 0, claimed: 0 };
    const row: RecoveryDayCounts = {
      day,
      followUp: num(counts.followUp),
      retention: num(counts.retention),
      delivered: num(counts.delivered),
      claimed: num(counts.claimed),
      heldAtStart: num(counts.heldAtStart)
    };
    return {
      ...row,
      status: dayStatus(row, targets, todayKey, claimCap),
      attainment: dayAttainment(row, targets, claimCap),
      claimCapped: atClaimCap(row, claimCap)
    };
  });
  return {
    days,
    followUpTotal: days.reduce((sum, row) => sum + row.followUp, 0),
    retentionTotal: days.reduce((sum, row) => sum + row.retention, 0),
    deliveredTotal: days.reduce((sum, row) => sum + row.delivered, 0),
    claimedTotal: days.reduce((sum, row) => sum + row.claimed, 0),
    // Judged only on days that were actually workable: never a Sunday, and
    // never a future day the rep has not reached yet.
    claimDaysMet: num(targets.claimed) > 0
      ? days.filter((row) => row.status !== "rest" && row.status !== "none" && row.claimed >= targets.claimed).length
      : 0,
    // A capped day is neither met nor missed - it is excused, and counting it
    // as a miss is the unfairness this whole branch exists to avoid.
    claimDaysMissed: num(targets.claimed) > 0
      ? days.filter((row) => row.status !== "rest" && row.status !== "none"
          && !row.claimCapped && row.claimed < targets.claimed).length
      : 0,
    claimDaysAtCap: days.filter((row) => row.status !== "rest" && row.status !== "none" && row.claimCapped).length,
    // ⚠️ "critical" counts as below target. It is a severity, not a separate
    // outcome, and a supervisor reading "6 below target days" must not be
    // shown a number that quietly excludes the very worst ones.
    belowTargetDays: days.filter((row) => row.status === "below" || row.status === "critical").length,
    aboveTargetDays: days.filter((row) => row.status === "above").length,
    restDays: days.filter((row) => row.status === "rest").length
  };
}

/** Every Lagos day from `from` to `to`, inclusive. */
export function calendarDayKeys(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return out;
  for (let cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    out.push(cursor.toISOString().slice(0, 10));
  }
  return out;
}
