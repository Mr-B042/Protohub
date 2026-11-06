// ── Send-out countdown on New orders (Bright, 5 Nov 2026) ───────────────────
// The browser copy of backend/src/lib/late-send-rules.ts, so the timer a rep
// sees runs on the same clock the late-send fine uses. Change both together.
//
//   Monday            11:00 - 17:30  Lagos time
//   Tuesday-Saturday  10:00 - 17:30
//   Sunday            closed
// The 15 minutes only run inside those hours. An order that arrives at night
// waits for the next opening.

export const LATE_SEND_MINUTES = 15;
/** Orders that reached a rep before this day are never checked. */
export const LATE_SEND_FROM = "2026-10-24";

const LAGOS_OFFSET_MS = 60 * 60_000; // UTC+1 all year, no daylight saving
const CLOSE_MIN = 17 * 60 + 30;
const DAY_MS = 24 * 60 * 60_000;

function openingMinute(weekday: number): number | null {
  if (weekday === 0) return null;
  return weekday === 1 ? 11 * 60 : 10 * 60;
}

/** [clock start, deadline] in ms for an order that reached the rep at arrivedAtMs. */
export function lateSendWindow(arrivedAtMs: number, minutes = LATE_SEND_MINUTES): { startMs: number; deadlineMs: number } {
  let t = arrivedAtMs + LAGOS_OFFSET_MS;
  let remaining = minutes * 60_000;
  let startMs: number | null = null;
  for (let guard = 0; guard < 14; guard += 1) {
    const day = new Date(t);
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const open = openingMinute(day.getUTCDay());
    const nextDay = midnight + DAY_MS;
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

/** Working-hours milliseconds between two moments (nights and Sundays skipped). */
export function workingMsBetween(fromMs: number, toMs: number) {
  if (!(toMs > fromMs)) return 0;
  let t = fromMs + LAGOS_OFFSET_MS;
  const end = toMs + LAGOS_OFFSET_MS;
  let total = 0;
  for (let guard = 0; guard < 400 && t < end; guard += 1) {
    const day = new Date(t);
    const midnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    const open = openingMinute(day.getUTCDay());
    if (open !== null) {
      const from = Math.max(t, midnight + open * 60_000);
      const to = Math.min(end, midnight + CLOSE_MIN * 60_000);
      if (to > from) total += to - from;
    }
    t = midnight + DAY_MS;
  }
  return total;
}

/** True while the clock is running (inside working hours). */
export function isWorkingTime(nowMs: number) {
  const t = nowMs + LAGOS_OFFSET_MS;
  const day = new Date(t);
  const open = openingMinute(day.getUTCDay());
  if (open === null) return false;
  const minute = day.getUTCHours() * 60 + day.getUTCMinutes();
  return minute >= open && minute < CLOSE_MIN;
}

export type SendOutTimerInput = {
  placedAt?: string | null;
  assignedAt?: string | null;
  revealedAt?: string | null;
};

/** When the order reached the rep: the latest of placed, (re)assigned and revealed. */
export function arrivedAtMs(order: SendOutTimerInput) {
  const placed = Date.parse(String(order.placedAt ?? ""));
  if (!Number.isFinite(placed)) return NaN;
  const assigned = Date.parse(String(order.assignedAt ?? ""));
  const revealed = Date.parse(String(order.revealedAt ?? ""));
  return Math.max(placed, Number.isFinite(assigned) ? assigned : placed, Number.isFinite(revealed) ? revealed : placed);
}

export type SendOutTimer =
  /** Clock has not started yet (order came in out of hours). */
  | { state: "waiting"; startMs: number; deadlineMs: number }
  /** Clock is running or paused overnight; leftMs = working time left. */
  | { state: "running"; leftMs: number; deadlineMs: number; paused: boolean }
  /** Past the deadline; lateMs = working time past it. */
  | { state: "late"; lateMs: number; deadlineMs: number };

/** The timer for a New order, or null when the rule does not apply to it. */
export function sendOutTimer(order: SendOutTimerInput, nowMs: number): SendOutTimer | null {
  const arrived = arrivedAtMs(order);
  if (!Number.isFinite(arrived) || arrived < Date.parse(`${LATE_SEND_FROM}T00:00:00+01:00`)) return null;
  const { startMs, deadlineMs } = lateSendWindow(arrived);
  if (nowMs < startMs) return { state: "waiting", startMs, deadlineMs };
  if (nowMs < deadlineMs) return { state: "running", leftMs: workingMsBetween(nowMs, deadlineMs), deadlineMs, paused: !isWorkingTime(nowMs) };
  return { state: "late", lateMs: workingMsBetween(deadlineMs, nowMs), deadlineMs };
}

/** "9 min", "1 min", "45 sec"; minutes round up so "0 min" never shows while time is left. */
export function minutesText(ms: number) {
  if (ms < 60_000) return `${Math.max(1, Math.ceil(ms / 1000))} sec`;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** "10:24am", with the day when it is not today (Lagos): "Tue 10:24am". */
export function lagosTimeText(ms: number, nowMs: number) {
  const day = (value: number) => new Date(value + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
  const time = new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" }).replace(" ", "").toLowerCase();
  if (day(ms) === day(nowMs)) return time;
  const weekday = new Date(ms).toLocaleDateString("en-US", { weekday: "short", timeZone: "Africa/Lagos" });
  return `${weekday} ${time}`;
}

// ── Quick / Late response on the order list (Bright, 6 Nov 2026) ───────────
// The clock under an order's status only counted up from when it came in, even
// after the rep had acted. The response is when the order first left "New"
// (orders.sent_out_at, migration 323 - the moment the fine reads from the
// history). Quick = by the 15-working-minute deadline, Late = after it, exactly
// as the fine judges it (backend minutesLate: any time past the deadline).

export type ResponseResult = { state: "quick" | "late"; workingMs: number; sentMs: number; deadlineMs: number };

/** How fast the order left New, or null when that is not known. */
export function responseResult(order: SendOutTimerInput & { sentOutAt?: string | null }): ResponseResult | null {
  const sent = Date.parse(String(order.sentOutAt ?? ""));
  const arrived = arrivedAtMs(order);
  // Sent before it reached this rep (moved to them later): not their response.
  if (!Number.isFinite(sent) || !Number.isFinite(arrived) || sent < arrived) return null;
  const { startMs, deadlineMs } = lateSendWindow(arrived);
  return { state: sent <= deadlineMs ? "quick" : "late", workingMs: workingMsBetween(startMs, sent), sentMs: sent, deadlineMs };
}

/** "6 min", "1 hr 5 min", "under 1 min" (working time). */
export function responseTimeText(workingMs: number) {
  return workingMs < 60_000 ? "under 1 min" : minutesText(workingMs);
}
