// ── Orders must leave "New" within 15 working minutes (Bright, 23 Oct 2026) ─
// Pure rules (no database) so they can be tested. See late-send.ts.
//
// The clock only runs in working hours, Lagos time:
//   Monday            11:00 - 17:30  (Mondays start late: the weekend pile-up)
//   Tuesday-Saturday  10:00 - 17:30
//   Sunday            closed
// An order that comes in at night, early morning, after 5:30pm or on Sunday
// starts its clock at the next opening. That gives reps the first hour to
// reach the night orders. 15 minutes are counted inside those hours only.
//
// "Sent out" = the first status change away from New (any status, Bright's
// choice: Confirmed, Postponed, Failed, Cancelled, Delivered all count).

export const LATE_SEND_MINUTES = 15;
/** Orders that reached a rep before this day are never checked. */
export const LATE_SEND_FROM = "2026-10-24";

const LAGOS_OFFSET_MS = 60 * 60_000; // UTC+1 all year, no daylight saving
const CLOSE_MIN = 17 * 60 + 30;

/** Opening minute of the day (0 = Sunday), or null when closed. */
export function openingMinute(weekday: number): number | null {
  if (weekday === 0) return null;
  return weekday === 1 ? 11 * 60 : 10 * 60;
}

/** Walk working minutes forward from a moment. Returns [clock start, deadline] as ms. */
export function lateSendWindow(arrivedAtMs: number, minutes = LATE_SEND_MINUTES): { startMs: number; deadlineMs: number } {
  // Work in "Lagos wall clock as if UTC" milliseconds.
  let t = arrivedAtMs + LAGOS_OFFSET_MS;
  let remaining = minutes * 60_000;
  let startMs: number | null = null;
  for (let guard = 0; guard < 14; guard += 1) {
    const day = new Date(t);
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const open = openingMinute(day.getUTCDay());
    const nextDay = midnight + 24 * 60 * 60_000;
    if (open === null) { t = nextDay; continue; }
    const openMs = midnight + open * 60_000;
    const closeMs = midnight + CLOSE_MIN * 60_000;
    if (t >= closeMs) { t = nextDay; continue; }
    if (t < openMs) t = openMs;
    if (startMs === null) startMs = t;
    if (t + remaining <= closeMs) {
      return { startMs: startMs - LAGOS_OFFSET_MS, deadlineMs: t + remaining - LAGOS_OFFSET_MS };
    }
    remaining -= closeMs - t;
    t = nextDay;
  }
  throw new Error("lateSendWindow: no working time found");
}

/** Working-time minutes late (0 when on time). Uses wall-clock minutes past the deadline. */
export function minutesLate(deadlineMs: number, sentAtMs: number | null, nowMs: number) {
  const end = sentAtMs ?? nowMs;
  return end > deadlineMs ? Math.ceil((end - deadlineMs) / 60_000) : 0;
}

/** The Lagos date (YYYY-MM-DD) of a moment. */
export function lagosDateOf(ms: number) {
  return new Date(ms + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}
