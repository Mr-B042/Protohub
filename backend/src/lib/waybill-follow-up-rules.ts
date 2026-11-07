// ── Waybill Follow-Up Center: the rules (Bright, 7 Nov 2026) ───────────────
// Pure: no database here, so it can be tested. lib/waybill-follow-up.ts loads
// the waybills and logs and saves the charges.
//
// Bright's choices:
//  - A waybill stays In Transit until the agent's receipt is confirmed (it is
//    marked Received); until then it is followed up five times a working day.
//  - ₦500 per waybill per missed session, charged automatically.
//  - Each session is logged on its own: a 10 AM log never covers 8 AM.
//  - No session after the waybill left In Transit, or before it existed, is owed.

export type SessionKey = "m1" | "m2" | "a1" | "a2" | "ev";

export const SESSIONS: Array<{ key: SessionKey; label: string; minutes: number; endMinutes?: number }> = [
  { key: "m1", label: "Morning 1", minutes: 8 * 60 },
  { key: "m2", label: "Morning 2", minutes: 10 * 60 },
  { key: "a1", label: "Afternoon 1", minutes: 12 * 60 },
  { key: "a2", label: "Afternoon 2", minutes: 14 * 60 },
  // Once, any time from 4 to 5 PM.
  { key: "ev", label: "Evening", minutes: 16 * 60, endMinutes: 17 * 60 }
];
export const SESSION_KEYS = SESSIONS.map((session) => session.key);
export const isSessionKey = (value: unknown): value is SessionKey => typeof value === "string" && (SESSION_KEYS as string[]).includes(value);

export type FollowUpSettings = {
  responsibleUserId: string | null;
  amount: number;
  graceMinutes: number;
  /** 0 = Sunday ... 6 = Saturday. */
  workingDays: number[];
  /** No session before this day (Lagos) is ever charged. */
  chargesFrom: string;
  overdueAfterDays: number;
};

export const DEFAULT_SETTINGS: FollowUpSettings = {
  responsibleUserId: null, amount: 500, graceMinutes: 15, workingDays: [1, 2, 3, 4, 5, 6], chargesFrom: "2026-11-09", overdueAfterDays: 3
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function cleanSettings(raw: Record<string, unknown> | null | undefined): FollowUpSettings {
  const r = raw ?? {};
  const days = Array.isArray(r.working_days ?? r.workingDays) ? (r.working_days ?? r.workingDays) as unknown[] : DEFAULT_SETTINGS.workingDays;
  const from = String(r.charges_from ?? r.chargesFrom ?? "");
  return {
    responsibleUserId: typeof (r.responsible_user_id ?? r.responsibleUserId) === "string" && String(r.responsible_user_id ?? r.responsibleUserId) ? String(r.responsible_user_id ?? r.responsibleUserId) : null,
    amount: Math.max(0, Number(r.amount ?? DEFAULT_SETTINGS.amount) || 0),
    graceMinutes: clampInt(r.grace_minutes ?? r.graceMinutes, 0, 45, DEFAULT_SETTINGS.graceMinutes),
    workingDays: [...new Set(days.map((day) => Math.round(Number(day))).filter((day) => day >= 0 && day <= 6))].sort(),
    chargesFrom: /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : DEFAULT_SETTINGS.chargesFrom,
    overdueAfterDays: clampInt(r.overdue_after_days ?? r.overdueAfterDays, 1, 30, DEFAULT_SETTINGS.overdueAfterDays)
  };
}

// ── Lagos days and session windows ──────────────────────────────────────────

const LAGOS_MS = 60 * 60_000;
export const lagosDay = (ms: number) => new Date(ms + LAGOS_MS).toISOString().slice(0, 10);
export const dayStartMs = (dateKey: string) => Date.parse(`${dateKey}T00:00:00+01:00`);
export const weekdayOf = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();
export const addDays = (dateKey: string, days: number) => new Date(Date.parse(`${dateKey}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
export const isWorkingDay = (dateKey: string, settings: Pick<FollowUpSettings, "workingDays">) => settings.workingDays.includes(weekdayOf(dateKey));

export type SessionWindow = {
  key: SessionKey; label: string; dateKey: string;
  /** "8:00 AM", "4:00 – 5:00 PM". */
  timeLabel: string;
  /** A log counts from openMs to closeMs; dueMs is the session's own time. */
  openMs: number; dueMs: number; closeMs: number;
};

const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/**
 * The five windows of a day. A fixed session counts from `grace` minutes
 * before its time to `grace` minutes after (8:00 → 7:45 to 8:15); the evening
 * one from `grace` before 4 PM to 5 PM.
 */
export function sessionWindows(dateKey: string, graceMinutes: number): SessionWindow[] {
  const base = dayStartMs(dateKey);
  return SESSIONS.map((session) => ({
    key: session.key, label: session.label, dateKey,
    timeLabel: session.endMinutes ? `${clock(session.minutes).replace(/ [AP]M$/, "")} – ${clock(session.endMinutes)}` : clock(session.minutes),
    openMs: base + (session.minutes - graceMinutes) * 60_000,
    dueMs: base + session.minutes * 60_000,
    closeMs: base + (session.endMinutes ?? session.minutes + graceMinutes) * 60_000
  }));
}

/** The session a log made at this moment counts for, or null (between sessions: kept in the history, counts for none). */
export function sessionForLog(ms: number, graceMinutes: number): SessionKey | null {
  return sessionWindows(lagosDay(ms), graceMinutes).find((window) => ms >= window.openMs && ms <= window.closeMs)?.key ?? null;
}

// ── Who owes what ───────────────────────────────────────────────────────────

export type FollowUpWaybill = {
  id: string;
  /** When it was created (the goods left). */
  createdMs: number;
  status: string;
  /** When it left In Transit; null while still In Transit. */
  closedMs: number | null;
};

/**
 * Does this waybill owe the session? It must have existed at the session's
 * time and still been In Transit when the window closed: received at 11:35 →
 * 12:00, 2:00 and evening are not owed; received at 12:05 (before 12:15) →
 * 12:00 is not owed either.
 */
export function owesSession(waybill: FollowUpWaybill, window: SessionWindow) {
  if (waybill.createdMs > window.dueMs) return false;
  if (waybill.closedMs === null) return waybill.status === "In Transit";
  return waybill.closedMs > window.closeMs;
}

export type SessionStatus = "off" | "upcoming" | "open" | "completed" | "missed" | "nothing_due";

/**
 * A session's state for the schedule. dueIds: waybills that owe it;
 * loggedIds: those with a log counted for it.
 */
export function sessionStatus(input: { window: SessionWindow; nowMs: number; workingDay: boolean; dueIds: string[]; loggedIds: Set<string> }): { status: SessionStatus; missing: string[] } {
  const missing = input.dueIds.filter((id) => !input.loggedIds.has(id));
  if (!input.workingDay) return { status: "off", missing: [] };
  if (input.nowMs < input.window.openMs) return { status: "upcoming", missing };
  if (input.dueIds.length === 0) return { status: input.nowMs > input.window.closeMs ? "nothing_due" : "open", missing };
  if (missing.length === 0) return { status: "completed", missing };
  return { status: input.nowMs > input.window.closeMs ? "missed" : "open", missing };
}

/** Each waybill not followed up in a closed session: ₦amount each (Bright: per waybill per session). */
export function missedCharges(input: { window: SessionWindow; nowMs: number; workingDay: boolean; settings: FollowUpSettings; waybills: FollowUpWaybill[]; loggedIds: Set<string> }) {
  const { window } = input;
  if (!input.workingDay || input.nowMs <= window.closeMs || window.dateKey < input.settings.chargesFrom) return [];
  return input.waybills
    .filter((waybill) => owesSession(waybill, window) && !input.loggedIds.has(waybill.id))
    .map((waybill) => ({ waybillId: waybill.id, sessionDate: window.dateKey, sessionKey: window.key, amount: input.settings.amount }));
}

// ── What the agent said ─────────────────────────────────────────────────────

export type ResponseKey =
  | "received" | "receive_today" | "receive_tomorrow" | "in_transit" | "unavailable"
  | "no_answer" | "no_reply" | "problem" | "more_info" | "other";

/** short = the pill in the tables; useful = the agent gave real news (no answer / no reply / away do not). */
export const RESPONSES: Array<{ key: ResponseKey; label: string; short: string; tone: "green" | "amber" | "blue" | "red" | "slate"; useful: boolean }> = [
  { key: "received", label: "Agent confirmed receipt", short: "Received at hub", tone: "green", useful: true },
  { key: "receive_today", label: "Agent promised to receive today", short: "Receiving today", tone: "green", useful: true },
  { key: "receive_tomorrow", label: "Agent promised to receive tomorrow", short: "Receiving tomorrow", tone: "amber", useful: true },
  { key: "in_transit", label: "Shipment still in transit", short: "Still in transit", tone: "blue", useful: true },
  { key: "unavailable", label: "Agent unavailable", short: "Agent unavailable", tone: "red", useful: false },
  { key: "no_answer", label: "Agent did not answer the call", short: "No response", tone: "red", useful: false },
  { key: "no_reply", label: "WhatsApp message sent, no response", short: "No response", tone: "red", useful: false },
  { key: "problem", label: "Agent reported a delivery problem", short: "Delivery problem", tone: "red", useful: true },
  { key: "more_info", label: "Agent requested more information", short: "Needs more info", tone: "amber", useful: true },
  { key: "other", label: "Other", short: "Other", tone: "slate", useful: true }
];
export const isResponseKey = (value: unknown): value is ResponseKey => RESPONSES.some((row) => row.key === value);
export const responseOf = (key: string | null | undefined) => RESPONSES.find((row) => row.key === key) ?? null;

export const CHANNELS = [
  { key: "whatsapp", label: "WhatsApp group reminder" },
  { key: "call", label: "Phone call" }
] as const;
export type ChannelKey = (typeof CHANNELS)[number]["key"];
export const isChannelKey = (value: unknown): value is ChannelKey => CHANNELS.some((row) => row.key === value);

export const NEXT_ACTIONS = ["Await receipt confirmation", "Call again", "Contact the carrier", "Escalate to the Operations Manager"] as const;

export const NOTE_MAX = 500;

/**
 * A log is only valid with a channel, what the agent said and the follow-up
 * notes (Bright's rule: clicking Save is not enough; no reply is logged as
 * "no response", never an invented answer; his form marks the notes as
 * required, up to 500 letters). Returns the problem, or null.
 */
export function logProblem(input: { waybillIds: unknown; channels: unknown; response: unknown; responseNote: unknown }): string | null {
  if (!Array.isArray(input.waybillIds) || input.waybillIds.length === 0) return "Choose at least one waybill.";
  if (input.waybillIds.length > 100) return "Up to 100 waybills in one log.";
  if (!Array.isArray(input.channels) || input.channels.length === 0 || !input.channels.every(isChannelKey)) return "Tick how you reached the agent: WhatsApp group, phone call, or both.";
  if (!isResponseKey(input.response)) return "Choose what the agent said.";
  const note = String(input.responseNote ?? "").trim();
  if (note.length < 3) return input.response === "other" ? "Write what the agent said." : "Write the follow-up notes: what was said and what happens next.";
  if (note.length > NOTE_MAX) return `Keep the notes under ${NOTE_MAX} characters.`;
  return null;
}

// ── A waybill's state in the tables ─────────────────────────────────────────

export type WaybillState = "verify" | "overdue" | "in_transit" | "pending";

/**
 * Verify Receipt: the agent said it arrived; mark it Received to close it.
 * Overdue: on the road longer than the setting. In Transit: the agent said so.
 * Pending: everything else (waiting for news).
 */
export function waybillState(input: { lastResponse: string | null; createdMs: number; nowMs: number; overdueAfterDays: number }): WaybillState {
  if (input.lastResponse === "received") return "verify";
  if (input.nowMs - input.createdMs > input.overdueAfterDays * 86_400_000) return "overdue";
  if (input.lastResponse === "in_transit") return "in_transit";
  return "pending";
}

/** Latest logs first: how many in a row got no real news (2 = flag it, 3 = escalate). */
export function noNewsStreak(responsesNewestFirst: string[]) {
  let streak = 0;
  for (const key of responsesNewestFirst) {
    if (responseOf(key)?.useful !== false) break;
    streak += 1;
  }
  return streak;
}

/** Logged ÷ owed, as a whole percent (null when nothing was owed). */
export function complianceRate(owed: number, logged: number) {
  return owed > 0 ? Math.round((Math.min(logged, owed) / owed) * 100) : null;
}
