// Cart follow-up integrity (Bright, 24 Nov 2026, after the follow-up audit).
// Pure rules, no database, so they can be tested. Used by:
//   - routes/carts.ts POST /:id/contact-attempts  (what a save may contain)
//   - routes/carts.ts GET /follow-up-integrity      (the Owner's "Check this" panel)
//   - routes/carts.ts GET /spot-checks              (the weekly call-backs)
//
// What the audit found (29 Sep – 24 Nov): the form pre-filled "Interested" and
// was saved untouched; "Not interested" logged with "spoke to them" unticked;
// the same words on one cart day after day ("next month" 11 times); 15
// different carts "called" in 8½ minutes; double-saves of one cart; and no
// trace that any call was made.

/** Outcomes that can only come from talking to the customer. */
export const CONVERSATION_OUTCOMES = new Set([
  "Interested", "Not interested", "Wants to order now", "Price concern", "Asked to call back", "Rescheduled"
]);
/** Outcomes that mean nobody was reached. */
export const NO_CONTACT_OUTCOMES = new Set(["Unresponsive", "Number not reachable"]);

/** A log needs a Call / WhatsApp / SMS tap on that cart within this many hours. */
export const TAP_WINDOW_HOURS = 4;
/** The same save again within this many minutes is a double-save, not a second call. */
export const DUPLICATE_WINDOW_MS = 2 * 60_000;
/** Rushed sitting: this many different carts or more ... */
export const RUSH_MIN_CARTS = 5;
/** ... at under this many seconds a cart, each within this gap of the last. */
export const RUSH_MAX_SECONDS_PER_CART = 60;
export const RUSH_MAX_GAP_SECONDS = 90;
/** A conversation outcome saved this soon after the previous cart cannot have been a real call. */
export const QUICK_CONVERSATION_SECONDS = 60;
/** Logs saved at or after this hour (Lagos) count as "logged late". */
export const LATE_HOUR = 18;
export const SPOT_CHECKS_PER_REP = 3;
export const SPOT_CHECK_OUTCOMES = new Set(["Interested", "Not interested", "Unresponsive", "Number not reachable"]);

const LAGOS_OFFSET_MS = 60 * 60_000;
export const lagosDay = (iso: string) => new Date(Date.parse(iso) + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
export const lagosHour = (iso: string) => new Date(Date.parse(iso) + LAGOS_OFFSET_MS).getUTCHours();

/** The words a rep typed (Other text + note), tidied for comparing. Empty when none. */
export const freeText = (outcome: string, custom: string | null | undefined, note: string | null | undefined) =>
  [outcome === "Other" ? custom ?? "" : "", note ?? ""].join(" ").toLowerCase().replace(/[^a-z0-9₦]+/g, " ").trim();

/** "Did you speak to them?" must agree with the outcome. */
export function reachedProblem(outcome: string, reached: boolean): string | null {
  if (CONVERSATION_OUTCOMES.has(outcome) && !reached)
    return `"${outcome}" means you spoke to the customer. Choose "Yes, I spoke to them", or pick the outcome that happened (Unresponsive, Number not reachable…).`;
  if (NO_CONTACT_OUTCOMES.has(outcome) && reached)
    return `"${outcome}" means nobody answered, so you cannot have spoken to them. Choose "No", or pick what they said.`;
  return null;
}

export type PastLog = { id: string; repId: string | null; outcome: string; custom: string | null; note: string | null; savedAt: string };

/** Same words as this cart's last log from an EARLIER day: no new contact happened. */
export function repeatProblem(history: PastLog[], outcome: string, custom: string | undefined, note: string | undefined, nowIso: string): string | null {
  const text = freeText(outcome, custom, note);
  if (!text) return null;
  const today = lagosDay(nowIso);
  const last = [...history].filter((h) => lagosDay(h.savedAt) < today && freeText(h.outcome, h.custom, h.note))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0];
  if (!last || freeText(last.outcome, last.custom, last.note) !== text) return null;
  return `These are the same words as the log on ${lagosDay(last.savedAt)}. Write what happened on today's call.`;
}

/** The identical save already went through a moment ago (double click / slow network). */
export function duplicateOf(history: PastLog[], repId: string, outcome: string, custom: string | undefined, note: string | undefined, nowIso: string): PastLog | null {
  const now = Date.parse(nowIso);
  const text = `${outcome}|${(custom ?? "").trim()}|${(note ?? "").trim()}`;
  return history.find((h) => h.repId === repId && now - Date.parse(h.savedAt) < DUPLICATE_WINDOW_MS
    && `${h.outcome}|${(h.custom ?? "").trim()}|${(h.note ?? "").trim()}` === text) ?? null;
}

// ── The Owner's "Check this" panel ─────────────────────────────────────────

export type IntegrityLog = {
  id: string; cartId: string; repId: string; repName: string; outcome: string; custom: string | null; note: string | null;
  reached: boolean; nextActionAt: string | null; savedAt: string; tappedAt: string | null;
};
export type RushedSitting = { repId: string; startedAt: string; endedAt: string; carts: number; secondsPerCart: number; outcomes: string[] };
export type FlaggedLog = IntegrityLog & { reasons: string[] };
export type RepIntegrity = {
  repId: string; repName: string;
  logs: number; duplicates: number; cartsLogged: number;
  rushedSittings: number; rushedCarts: number; quickConversations: number;
  untouched: number; contradictions: number; repeatedWords: number;
  lateLogs: number; latePct: number; noTap: number; tapChecked: number;
  saidInterested: number; interestedBecameOrders: number;
  spotChecked: number; spotDenied: number;
  /** 0–100: how strongly the patterns point at logging to avoid the charge. */
  score: number; level: "high" | "medium" | "low";
};

/** Drop double-saves: the same rep, cart and words within 2 minutes. */
export function withoutDuplicates(logs: IntegrityLog[]) {
  const sorted = [...logs].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  const last = new Map<string, number>();
  const kept: IntegrityLog[] = [];
  let duplicates = 0;
  for (const log of sorted) {
    const key = `${log.repId}|${log.cartId}|${log.outcome}|${(log.custom ?? "").trim()}|${(log.note ?? "").trim()}`;
    const t = Date.parse(log.savedAt);
    const prev = last.get(key);
    last.set(key, t);
    if (prev !== undefined && t - prev < DUPLICATE_WINDOW_MS) { duplicates += 1; continue; }
    kept.push(log);
  }
  return { kept, duplicates };
}

/** Runs of different carts logged back to back, too fast for real calls. */
export function rushedSittings(logs: IntegrityLog[]): Array<RushedSitting & { ids: string[] }> {
  const byRep = new Map<string, IntegrityLog[]>();
  for (const log of logs) byRep.set(log.repId, [...(byRep.get(log.repId) ?? []), log]);
  const out: Array<RushedSitting & { ids: string[] }> = [];
  for (const [repId, list] of byRep) {
    const sorted = [...list].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    let run: IntegrityLog[] = [];
    const flush = () => {
      const carts = new Set(run.map((l) => l.cartId)).size;
      if (carts >= RUSH_MIN_CARTS) {
        const seconds = (Date.parse(run[run.length - 1].savedAt) - Date.parse(run[0].savedAt)) / 1000;
        const perCart = Math.round(seconds / Math.max(1, carts - 1));
        if (perCart < RUSH_MAX_SECONDS_PER_CART) out.push({
          repId, startedAt: run[0].savedAt, endedAt: run[run.length - 1].savedAt, carts, secondsPerCart: perCart,
          outcomes: [...new Set(run.map((l) => l.outcome))], ids: run.map((l) => l.id)
        });
      }
      run = [];
    };
    for (const log of sorted) {
      const prev = run[run.length - 1];
      if (prev && (Date.parse(log.savedAt) - Date.parse(prev.savedAt)) / 1000 > RUSH_MAX_GAP_SECONDS) flush();
      run.push(log);
    }
    flush();
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * Every rep's patterns over the period, worst first, plus each flagged log
 * and why. `historyBefore` = earlier logs on the same carts (for repeats).
 */
export function buildIntegrity(args: {
  logs: IntegrityLog[];
  historyBefore: IntegrityLog[];
  repNames: Map<string, string>;
  /** Carts that became orders (orders.source_cart_id). */
  convertedCarts: Set<string>;
  /** Taps were only recorded from this moment (null = never yet). */
  tapsSince: string | null;
  spot: Array<{ repId: string; status: string }>;
}) {
  const { kept } = withoutDuplicates(args.logs);
  const keptIds = new Set(kept.map((l) => l.id));
  const dupByRep = new Map<string, number>();
  for (const l of args.logs) if (!keptIds.has(l.id)) dupByRep.set(l.repId, (dupByRep.get(l.repId) ?? 0) + 1);
  const sittings = rushedSittings(kept);
  const inRush = new Set(sittings.flatMap((s) => s.ids));
  const reasons = new Map<string, string[]>();
  const flag = (id: string, why: string) => reasons.set(id, [...(reasons.get(id) ?? []), why]);

  const byRep = new Map<string, IntegrityLog[]>();
  for (const l of kept) byRep.set(l.repId, [...(byRep.get(l.repId) ?? []), l]);
  const everything = [...args.historyBefore, ...kept].sort((a, b) => a.savedAt.localeCompare(b.savedAt));

  const reps: RepIntegrity[] = [];
  for (const [repId, list] of byRep) {
    const sorted = [...list].sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    let quick = 0, untouched = 0, contradictions = 0, repeated = 0, late = 0, noTap = 0, tapChecked = 0;
    sorted.forEach((l, i) => {
      if (inRush.has(l.id)) flag(l.id, "Part of a rushed sitting");
      const prev = sorted[i - 1];
      if (prev && prev.cartId !== l.cartId && CONVERSATION_OUTCOMES.has(l.outcome)
          && (Date.parse(l.savedAt) - Date.parse(prev.savedAt)) / 1000 < QUICK_CONVERSATION_SECONDS) {
        quick += 1; flag(l.id, `"${l.outcome}" saved ${Math.round((Date.parse(l.savedAt) - Date.parse(prev.savedAt)) / 1000)}s after the previous cart`);
      }
      if (l.outcome === "Interested" && !l.reached && !(l.note ?? "").trim() && !l.nextActionAt) { untouched += 1; flag(l.id, "Saved as the old pre-filled form (Interested, not reached, no note)"); }
      if (reachedProblem(l.outcome, l.reached)) { contradictions += 1; flag(l.id, l.reached ? `"${l.outcome}" but marked as spoke to them` : `"${l.outcome}" but marked as did not speak to them`); }
      const text = freeText(l.outcome, l.custom, l.note);
      if (text) {
        const earlier = everything.filter((h) => h.cartId === l.cartId && h.id !== l.id && h.savedAt < l.savedAt
          && lagosDay(h.savedAt) < lagosDay(l.savedAt) && freeText(h.outcome, h.custom, h.note)).pop();
        if (earlier && freeText(earlier.outcome, earlier.custom, earlier.note) === text) { repeated += 1; flag(l.id, `Same words as ${lagosDay(earlier.savedAt)}`); }
      }
      if (lagosHour(l.savedAt) >= LATE_HOUR) late += 1;
      if (args.tapsSince && l.savedAt >= args.tapsSince) {
        tapChecked += 1;
        if (!l.tappedAt) { noTap += 1; flag(l.id, "No Call / WhatsApp tap before this log"); }
      }
    });
    const interestedCarts = new Set(sorted.filter((l) => l.outcome === "Interested").map((l) => l.cartId));
    const spot = args.spot.filter((s) => s.repId === repId);
    const rushedCarts = sittings.filter((s) => s.repId === repId).reduce((s, x) => s + x.carts, 0);
    const n = sorted.length;
    const rate = (x: number) => (n ? x / n : 0);
    const convRate = interestedCarts.size >= 5 ? [...interestedCarts].filter((c) => args.convertedCarts.has(c)).length / interestedCarts.size : null;
    // Weighted signals. Each part is capped so one habit alone cannot reach "high".
    const score = Math.round(Math.min(100,
      Math.min(25, rate(rushedCarts) * 100) +
      Math.min(20, rate(quick) * 150) +
      Math.min(20, rate(untouched) * 150) +
      Math.min(15, rate(repeated) * 100) +
      Math.min(10, rate(contradictions) * 25) +
      Math.min(10, tapChecked ? (noTap / tapChecked) * 20 : 0) +
      (convRate !== null && convRate < 0.35 ? 10 : 0) +
      Math.min(20, spot.filter((s) => s.status === "denied").length * 10)
    ));
    reps.push({
      repId, repName: args.repNames.get(repId) ?? sorted[0]?.repName ?? "Sales rep",
      logs: n, duplicates: dupByRep.get(repId) ?? 0, cartsLogged: new Set(sorted.map((l) => l.cartId)).size,
      rushedSittings: sittings.filter((s) => s.repId === repId).length, rushedCarts, quickConversations: quick,
      untouched, contradictions, repeatedWords: repeated, lateLogs: late, latePct: n ? Math.round((late / n) * 100) : 0,
      noTap, tapChecked, saidInterested: interestedCarts.size,
      interestedBecameOrders: [...interestedCarts].filter((c) => args.convertedCarts.has(c)).length,
      spotChecked: spot.filter((s) => s.status !== "pending").length, spotDenied: spot.filter((s) => s.status === "denied").length,
      score, level: score >= 45 ? "high" : score >= 20 ? "medium" : "low"
    });
  }
  reps.sort((a, b) => b.score - a.score || b.logs - a.logs);
  const flagged: FlaggedLog[] = kept.filter((l) => reasons.has(l.id)).map((l) => ({ ...l, reasons: reasons.get(l.id)! }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  return { reps, sittings: sittings.map(({ ids: _ids, ...s }) => s).reverse(), flagged };
}

// ── Weekly spot-checks ─────────────────────────────────────────────────────

/** Small stable hash, so a week's picks are random but the same every time. */
const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Up to 3 logs per rep (one per cart) whose customer a manager should call back. */
export function pickSpotChecks(logs: IntegrityLog[], weekStart: string, perRep = SPOT_CHECKS_PER_REP) {
  const { kept } = withoutDuplicates(logs);
  const byRep = new Map<string, IntegrityLog[]>();
  for (const l of kept) if (SPOT_CHECK_OUTCOMES.has(l.outcome)) byRep.set(l.repId, [...(byRep.get(l.repId) ?? []), l]);
  const picks: IntegrityLog[] = [];
  for (const list of byRep.values()) {
    const seenCart = new Set<string>();
    for (const l of [...list].sort((a, b) => hash(`${weekStart}|${a.id}`) - hash(`${weekStart}|${b.id}`))) {
      if (seenCart.has(l.cartId)) continue;
      seenCart.add(l.cartId); picks.push(l);
      if (seenCart.size >= perRep) break;
    }
  }
  return picks;
}

// ── Rescheduling needs a real date (Bright, 24 Nov 2026) ───────────────────
// "Rescheduled against month ending" was being logged as Other, day after day.
// A customer asking for a later time is a Rescheduled with the exact date.

/** Max days ahead a reschedule may go. */
export const RESCHEDULE_MAX_DAYS = 60;
/** Outcomes whose words must not hide a reschedule. */
const LATER_CHECKED_OUTCOMES = new Set(["Other", "Interested", "Asked to call back", "Price concern", "Wants to order now"]);
/** Words that mean "call me another day". "Later today" is not one of them. */
export const LATER_PATTERN = /\b(tomorrow|next\s+(week|month|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|month\s*(end|ending)|end\s+of\s+(the\s+)?(month|week)|(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|weekend|after\s+(salary|payday|pay\s*day|the\s+\d{1,2}(st|nd|rd|th)?)|salary|payday|pay\s*day|call\s*back\s+(on|by|next|after|in)|in\s+\d+\s+(days?|weeks?)|\d{1,2}(st|nd|rd|th)\b|reschedul\w*)\b/i;

/** Words describing a later day under a non-Rescheduled outcome. */
export function laterProblem(outcome: string, custom: string | null | undefined, note: string | null | undefined): string | null {
  if (!LATER_CHECKED_OUTCOMES.has(outcome)) return null;
  const words = `${outcome === "Other" ? custom ?? "" : ""} ${note ?? ""}`;
  if (!LATER_PATTERN.test(words)) return null;
  return "The customer asked to be called another day. Choose \"Rescheduled\" and pick the exact date they gave.";
}

const addDayKeys = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Rescheduled must carry the date the customer gave: tomorrow to 60 days ahead. */
export function rescheduleDateProblem(outcome: string, nextActionAt: string | null | undefined, todayKey: string): string | null {
  if (outcome !== "Rescheduled") return null;
  const day = String(nextActionAt ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Pick the exact date the customer asked you to call back.";
  if (day <= todayKey) return "The callback date must be after today. If they asked for later today, choose \"Asked to call back\".";
  if (day > addDayKeys(todayKey, RESCHEDULE_MAX_DAYS)) return `Pick a date within ${RESCHEDULE_MAX_DAYS} days. For longer, close the cart with the reason they gave.`;
  return null;
}

export type RescheduleLog = { cartId: string; savedDay: string; outcome: string; callbackDay: string | null };

/**
 * Days a cart is paused by a dated reschedule: from the day it was logged up
 * to (not including) the callback day. On the callback day it is due again.
 * Old Rescheduled logs with no date are not handled here (they stay finished).
 */
export function pausedOn(logs: RescheduleLog[], cartId: string, dayKey: string) {
  return logs.some((l) => l.cartId === cartId && l.outcome === "Rescheduled" && l.callbackDay
    && l.savedDay <= dayKey && dayKey < l.callbackDay);
}
