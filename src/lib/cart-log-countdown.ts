// How long a rep has left to clear their board before the day's charge lands.
//
// The penalty is decided by the Lagos calendar day, so the deadline is the next
// Lagos midnight - not the browser's midnight. A rep on a phone set to another
// timezone must see the same deadline as the rule that will charge them.

/** Lagos is UTC+1 year-round; Nigeria has never observed DST. */
export const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Milliseconds until a given hour of the CURRENT Lagos day. Never negative -
 * once the hour has passed the answer is 0, meaning "the window has closed",
 * not "wait until tomorrow".
 *
 * Hour 24 means the end of the day. The follow-up KPI closes at 22 because its
 * nightly job runs 21:00 UTC; the cart log has no job and is decided purely by
 * the Lagos date, so anything logged before midnight still counts.
 */
export function msUntilLagosHour(nowMs: number, hour: number): number {
  if (!Number.isFinite(nowMs) || !Number.isFinite(hour)) return 0;
  const intoDay = ((nowMs + LAGOS_OFFSET_MS) % DAY_MS + DAY_MS) % DAY_MS;
  return Math.max(0, hour * 3_600_000 - intoDay);
}

/** Milliseconds left in the current Lagos day. Never negative. */
export function msUntilEndOfLagosDay(nowMs: number): number {
  return msUntilLagosHour(nowMs, 24);
}

export type CountdownParts = { hours: number; minutes: number; seconds: number };

export function countdownParts(ms: number): CountdownParts {
  const safe = Math.max(0, Math.floor(Number(ms) || 0));
  return {
    hours: Math.floor(safe / 3_600_000),
    minutes: Math.floor((safe % 3_600_000) / 60_000),
    seconds: Math.floor((safe % 60_000) / 1000)
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "6:42:09" - a clock, because that is what a deadline reads like. */
export function formatCountdown(ms: number): string {
  const { hours, minutes, seconds } = countdownParts(ms);
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * "10h 44m 19s" - the wording the follow-up charge banner already uses.
 *
 * The hours segment is dropped under an hour rather than shown as "0h", so the
 * last stretch reads as urgently as it actually is.
 */
export function formatCountdownWords(ms: number): string {
  const { hours, minutes, seconds } = countdownParts(ms);
  return hours > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${minutes}m ${seconds}s`;
}

/**
 * How loud the timer should be.
 *
 * ⚠️ Deliberately calm for most of the day. A countdown that screams from 9am
 * is one people stop seeing by 10am, and the whole value of this thing is that
 * it still registers at 4pm when there is something left to save.
 */
export type CountdownTier = "calm" | "warning" | "critical" | "over";

export function countdownTier(ms: number): CountdownTier {
  const safe = Math.max(0, Number(ms) || 0);
  if (safe <= 0) return "over";
  if (safe <= 60 * 60 * 1000) return "critical";
  if (safe <= 3 * 60 * 60 * 1000) return "warning";
  return "calm";
}

export const COUNTDOWN_TIER_STYLE: Record<CountdownTier, { chip: string; digits: string; note: string }> = {
  calm: {
    chip: "border-amber-300 bg-amber-50",
    digits: "text-amber-900",
    note: "text-amber-700"
  },
  warning: {
    chip: "border-orange-400 bg-orange-50",
    digits: "text-orange-900",
    note: "text-orange-700"
  },
  critical: {
    chip: "border-rose-500 bg-rose-50 cart-countdown-critical",
    digits: "text-rose-900",
    note: "text-rose-700"
  },
  over: {
    chip: "border-gray-300 bg-gray-50",
    digits: "text-gray-500",
    note: "text-gray-500"
  }
};

/** The line under the clock. Says what is lost, and that it is still avoidable. */
export function countdownMessage(ms: number, cartsRemaining: number, amountAtRisk: number): string {
  const carts = `${cartsRemaining} cart${cartsRemaining === 1 ? "" : "s"}`;
  const money = `₦${Math.max(0, Math.round(amountAtRisk)).toLocaleString("en-NG")}`;
  if (cartsRemaining <= 0) return "Board clear - nothing at risk today.";
  if (countdownTier(ms) === "over") return `Day ended with ${carts} unlogged. ${money} pending the Owner's review.`;
  return `left to log ${carts} · ${money} at risk`;
}
