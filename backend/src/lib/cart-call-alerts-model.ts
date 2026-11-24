// Cart call alerts - pure rules (no database), so they can be tested.
// cart-call-alerts.ts sends them. Bright, 24 Nov 2026: "most of them don't call
// their abandoned cart early ... heavy alert ... morning and afternoon chase ...
// the head of sales rep to also alert on each sales rep who hasn't called".

export type WorkHours = { workStartMinute: number; workEndMinute: number; worksSunday: boolean };
export type Stage = "remind" | "escalate" | "hour";

const LAGOS_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

/** Lagos day key and minute-of-day for an instant. */
export const lagosParts = (ms: number) => {
  const d = new Date(ms + LAGOS_MS);
  return { day: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
};

/** Is this instant inside the working window (Lagos)? */
export function isWorkingNow(ms: number, hours: WorkHours) {
  const { minute, dow } = lagosParts(ms);
  if (dow === 0 && !hours.worksSunday) return false;
  return minute >= hours.workStartMinute && minute < hours.workEndMinute;
}

/**
 * Working minutes between two instants: only time inside working hours on
 * working days counts. A cart handed out at 4:55pm has waited 5 minutes at
 * 8:35 the next morning, not 15 hours, so nobody is chased for the night.
 */
export function workingMinutesBetween(fromMs: number, toMs: number, hours: WorkHours) {
  if (toMs <= fromMs) return 0;
  let total = 0;
  // Walk Lagos days from the start day to the end day (a cart is never older than a few days here).
  const startDay = Date.parse(`${lagosParts(fromMs).day}T00:00:00Z`) - LAGOS_MS;
  for (let dayStart = startDay; dayStart < toMs && total < 100_000; dayStart += DAY_MS) {
    const dow = new Date(dayStart + LAGOS_MS).getUTCDay();
    if (dow === 0 && !hours.worksSunday) continue;
    const open = dayStart + hours.workStartMinute * 60_000;
    const close = dayStart + hours.workEndMinute * 60_000;
    const a = Math.max(open, fromMs), b = Math.min(close, toMs);
    if (b > a) total += (b - a) / 60_000;
  }
  return Math.floor(total);
}

/** The alerts a not-yet-called cart has earned after `waited` working minutes. */
export function stagesDue(waited: number, callMinutes: number): Stage[] {
  const out: Stage[] = [];
  if (waited >= callMinutes) out.push("remind");
  if (waited >= callMinutes * 2) out.push("escalate");
  if (waited >= Math.max(60, callMinutes * 3)) out.push("hour");
  return out;
}

export type ChaseCart = { id: string; customer: string; product: string; neverCalled: boolean; loggedToday: boolean; callbackToday?: boolean };

/** What one rep is told at the 9am / 2pm chase. null = nothing to chase. */
export function chaseMessage(slot: "morning" | "afternoon", carts: ChaseCart[], finePerCart: number) {
  const due = carts.filter((c) => !c.loggedToday);
  if (due.length === 0) return null;
  const never = due.filter((c) => c.neverCalled).length;
  const callbacks = due.filter((c) => c.callbackToday).length;
  // Callbacks the customer asked for today first, then never-called carts.
  const rank = (c: ChaseCart) => (c.callbackToday ? 2 : 0) + (c.neverCalled ? 1 : 0);
  const first = [...due].sort((a, b) => rank(b) - rank(a)).slice(0, 4)
    .map((c) => `${c.customer || "No name"}${c.product ? ` (${c.product})` : ""}`);
  const title = slot === "morning"
    ? `🌅 Morning chase: call your ${due.length} cart${due.length === 1 ? "" : "s"} now`
    : `☀️ Afternoon chase: ${due.length} cart${due.length === 1 ? "" : "s"} still not called today`;
  const parts = [
    callbacks > 0 ? `📅 ${callbacks} callback${callbacks === 1 ? "" : "s"} the customer asked for today` : null,
    never > 0 ? `${never} never called` : null,
    finePerCart > 0 ? `₦${finePerCart.toLocaleString("en-NG")} each if not logged today (₦${(finePerCart * due.length).toLocaleString("en-NG")})` : null,
    `Start with: ${first.join(", ")}${due.length > first.length ? ` +${due.length - first.length} more` : ""}`
  ].filter(Boolean);
  return { title, message: `${parts.join(". ")}.`, due: due.length, never };
}

export type RepChase = { repName: string; due: number; never: number; total: number };

/** The Head of Sales summary at the 9am / 2pm chase: reps with carts not called today, worst first. */
export function hosChaseMessage(slot: "morning" | "afternoon", reps: RepChase[]) {
  const behind = reps.filter((r) => r.due > 0).sort((a, b) => b.due - a.due || b.never - a.never);
  if (behind.length === 0) return null;
  const total = behind.reduce((s, r) => s + r.due, 0);
  return {
    title: `${slot === "morning" ? "🌅 Morning" : "☀️ Afternoon"} chase: ${behind.length} rep${behind.length === 1 ? "" : "s"} have ${total} cart${total === 1 ? "" : "s"} not called today`,
    message: `${behind.map((r) => `${r.repName} ${r.due} of ${r.total}${r.never ? ` (${r.never} never called)` : ""}`).join(" · ")}. Push them to call now.`
  };
}
