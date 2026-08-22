// ₦500 a day for a rep who logs nothing on their assigned carts.
//
// ⚠️ Per REP per DAY, not per cart. A rep with 61 carts and a rep with 6 have
// committed the same offence by not logging; a per-cart rate would charge one
// of them ₦30,500 for it. This differs from the order follow-up KPI (₦50 per
// order per day) on purpose.
//
// ⚠️ NEVER auto-deducted. A miss is recorded and shown; it becomes money only
// when the Owner approves it.

export const CART_LOG_MISS_AMOUNT = 500;

/**
 * Go-live. Monday 24 August 2026.
 *
 * Before this date the page runs a visible countdown and records nothing: reps
 * were told the rule is coming, and charging for days they were never warned
 * about would make the first payroll argument about fairness rather than about
 * the logging.
 */
export const CART_LOG_PENALTY_START_DATE = "2026-08-24";

/** Sundays are off, matching the order follow-up KPI. */
export function isChargeableDay(dateKey: string): boolean {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return Number.isFinite(day) && day !== 0;
}

export type PenaltyPhase = {
  active: boolean;
  startDate: string;
  /** Whole days until the rule starts. 0 on the day itself, negative after. */
  daysUntil: number;
  label: string;
};

export function penaltyPhase(todayKey: string, startDate = CART_LOG_PENALTY_START_DATE): PenaltyPhase {
  const today = new Date(`${todayKey}T00:00:00Z`).getTime();
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const daysUntil = Math.round((start - today) / 86_400_000);
  const active = todayKey >= startDate;
  return {
    active,
    startDate,
    daysUntil,
    label: active
      ? "Penalties are live"
      : daysUntil === 1 ? "Penalties start tomorrow"
        : daysUntil === 0 ? "Penalties start today"
          : `Penalties start in ${daysUntil} days`
  };
}

export type RepDayInput = {
  repId: string;
  repName: string;
  dateKey: string;
  /** Assigned carts that were still open that day - closed ones are exempt. */
  cartsDue: number;
  /** Attempts the rep logged that day, across any of their carts. */
  logsMade: number;
};

export type RepDayStatus = "not_due" | "clear" | "missed" | "before_go_live";

/**
 * Whether a rep owes for a day.
 *
 * ⚠️ Logging ONE cart clears the day. Bright's rule catches the rep who did
 * nothing, not the rep who worked their board imperfectly - a per-cart standard
 * is what the order KPI already does, and doubling it here would make the two
 * systems fight over the same behaviour.
 *
 * A day with no carts due is "not_due", never "clear": a rep with an empty
 * board did not earn a pass, there was simply nothing to do.
 */
export function repDayStatus(input: RepDayInput, startDate = CART_LOG_PENALTY_START_DATE): RepDayStatus {
  if (input.dateKey < startDate) return "before_go_live";
  if (!isChargeableDay(input.dateKey)) return "not_due";
  if (input.cartsDue <= 0) return "not_due";
  return input.logsMade > 0 ? "clear" : "missed";
}

export type RepPenaltySummary = {
  repId: string;
  repName: string;
  missedDays: string[];
  missedCount: number;
  /** What they would owe if every pending miss were approved. */
  atRiskAmount: number;
  clearDays: number;
};

export function summariseRepPenalties(
  days: RepDayInput[], startDate = CART_LOG_PENALTY_START_DATE
): RepPenaltySummary[] {
  const byRep = new Map<string, RepPenaltySummary>();
  (days ?? []).forEach((day) => {
    const entry = byRep.get(day.repId) ?? {
      repId: day.repId, repName: day.repName,
      missedDays: [], missedCount: 0, atRiskAmount: 0, clearDays: 0
    };
    const status = repDayStatus(day, startDate);
    if (status === "missed") {
      entry.missedDays.push(day.dateKey);
      entry.missedCount += 1;
      entry.atRiskAmount += CART_LOG_MISS_AMOUNT;
    } else if (status === "clear") {
      entry.clearDays += 1;
    }
    byRep.set(day.repId, entry);
  });
  return [...byRep.values()].sort((left, right) => right.atRiskAmount - left.atRiskAmount);
}

export type TodayStanding = {
  dateKey: string;
  cartsDue: number;
  logsMade: number;
  status: RepDayStatus;
  /** What it costs if the day ends like this. 0 unless actually at risk. */
  atRisk: number;
  /** True before go-live: the same miss, but nothing is charged for it yet. */
  rehearsal: boolean;
  message: string;
};

/**
 * Where a rep stands RIGHT NOW, today.
 *
 * ⚠️ Written in the second person and in the present tense on purpose. A rep
 * reading "3 misses this week" has already lost the money; a rep reading "you
 * have not logged anything today" can still act. The whole point of the
 * penalty is the behaviour, not the collection.
 */
export function todayStanding(
  input: RepDayInput, startDate = CART_LOG_PENALTY_START_DATE
): TodayStanding {
  const status = repDayStatus(input, startDate);
  const rehearsal = input.dateKey < startDate;
  const atRisk = status === "missed" ? CART_LOG_MISS_AMOUNT : 0;

  let message: string;
  if (!isChargeableDay(input.dateKey)) {
    message = "Sunday - nothing due today.";
  } else if (input.cartsDue <= 0) {
    message = "No carts on your board today.";
  } else if (input.logsMade > 0) {
    message = `Logged today. ${input.cartsDue} cart${input.cartsDue === 1 ? "" : "s"} on your board.`;
  } else if (rehearsal) {
    message = `${input.cartsDue} cart${input.cartsDue === 1 ? "" : "s"} and nothing logged yet. From ${startDate} a day like this costs ₦${CART_LOG_MISS_AMOUNT}.`;
  } else {
    message = `${input.cartsDue} cart${input.cartsDue === 1 ? "" : "s"} and nothing logged yet. Log one before the day ends or this is ₦${CART_LOG_MISS_AMOUNT}.`;
  }

  return {
    dateKey: input.dateKey,
    cartsDue: input.cartsDue,
    logsMade: input.logsMade,
    status,
    atRisk: rehearsal ? 0 : atRisk,
    rehearsal,
    message
  };
}

// ── Date range presets ────────────────────────────────────

export type RangePreset =
  | "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | "all";

export const RANGE_PRESETS: RangePreset[] = [
  "today", "yesterday", "this_week", "last_week", "this_month", "last_month", "all"
];

export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  today: "Today", yesterday: "Yesterday", this_week: "This week", last_week: "Last week",
  this_month: "This month", last_month: "Last month", all: "All time"
};

const shift = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Monday of the week a date falls in. The cart board runs Mon-Sat. */
export function mondayOf(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  const dow = date.getUTCDay();
  // Sunday (0) belongs to the week that just ENDED, not the one starting - a
  // Sunday review is looking back at Mon-Sat, never forward at an empty week.
  return shift(dateKey, dow === 0 ? -6 : 1 - dow);
}

/**
 * Resolve a preset to an inclusive Lagos date range.
 *
 * "all" returns a null `from` rather than an arbitrary early date, so callers
 * can leave the bound off entirely instead of quietly cutting history.
 */
export function resolveRange(preset: RangePreset, todayKey: string): { from: string | null; to: string } {
  switch (preset) {
    case "today": return { from: todayKey, to: todayKey };
    case "yesterday": return { from: shift(todayKey, -1), to: shift(todayKey, -1) };
    case "this_week": return { from: mondayOf(todayKey), to: todayKey };
    case "last_week": {
      const lastMonday = shift(mondayOf(todayKey), -7);
      return { from: lastMonday, to: shift(lastMonday, 5) };
    }
    case "this_month": return { from: `${todayKey.slice(0, 7)}-01`, to: todayKey };
    case "last_month": {
      const firstOfThis = new Date(`${todayKey.slice(0, 7)}-01T00:00:00Z`);
      const lastMonthEnd = new Date(firstOfThis);
      lastMonthEnd.setUTCDate(0);
      const key = lastMonthEnd.toISOString().slice(0, 10);
      return { from: `${key.slice(0, 7)}-01`, to: key };
    }
    case "all":
    default: return { from: null, to: todayKey };
  }
}

/** Every chargeable (Mon-Sat) day in a range, oldest first. */
export function chargeableDaysIn(from: string, to: string): string[] {
  const out: string[] = [];
  if (to < from) return out;
  for (let cursor = from; cursor <= to; cursor = shift(cursor, 1)) {
    if (isChargeableDay(cursor)) out.push(cursor);
  }
  return out;
}
