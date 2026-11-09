/**
 * One message per real event (Bright, 9 Nov 2026: "sales reps might do a
 * double change to the same order status which might trigger sending twice").
 * The audit that day found ~2,400 repeat customer SMS (2,091 of them
 * "rescheduled") from reps saving the same status again.
 *
 * Rules for customer order emails and SMS:
 *  - saving the SAME status again sends nothing (a Postponed order whose
 *    delivery day changed is a new event and does send);
 *  - the new-order and delivered messages go once per order, ever;
 *  - any other status message goes once per order + status (+ delivery day
 *    for reschedules) within 12 hours;
 *  - a double tap (two saves at once) is stopped by a short in-memory lock.
 */

export const REPEAT_WINDOW_MS = 12 * 60 * 60_000;
const LOCK_MS = 2 * 60_000;

/** "once" = never again for this order; otherwise the window in ms. */
export function repeatWindow(kind: string): "once" | number {
  return kind === "order_new" || kind === "order_delivered" ? "once" : REPEAT_WINDOW_MS;
}

/** A save that changes nothing the customer would hear about. */
export function sameStatusSave(fromStatus: string | null, toStatus: string, dayBefore?: string | null, dayAfter?: string | null) {
  if (!fromStatus || fromStatus !== toStatus) return false;
  // A new delivery day for a postponed order is news.
  if (toStatus === "Postponed" && (dayAfter ?? "") !== (dayBefore ?? "")) return false;
  return true;
}

const locks = new Map<string, number>();
/** True the first time a key is seen in the last 2 minutes (double taps hit the same server). */
export function takeLock(key: string, nowMs = Date.now()) {
  for (const [k, at] of locks) if (nowMs - at > LOCK_MS) locks.delete(k);
  if (locks.has(key)) return false;
  locks.set(key, nowMs);
  return true;
}
