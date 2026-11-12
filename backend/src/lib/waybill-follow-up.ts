// ── Waybill Follow-Up Center: loading, logging, charging (Bright, 7 Nov 2026) ─
// Rules: waybill-follow-up-rules.ts. Every waybill still In Transit is
// followed up five times a working day until it is marked Received; each one
// not followed up in a session costs the person responsible ₦500, charged at
// once (a rep_penalties fine, so payroll and Telegram /fines see it).

import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import {
  CHANNELS, DEFAULT_SETTINGS, isCustomerDelivery, NEXT_ACTIONS, NOTICE_FROM, RESPONSES, SESSIONS, addDays, cleanSettings, complianceRate, dayStartMs, isWorkingDay, lagosDay,
  logProblem, missedCharges, noNewsStreak, noticeCharges, noticeState, owesSession, responseOf, sessionForLog, sessionStatus, sessionWindows, waybillState,
  type FollowUpSettings, type FollowUpWaybill, type NoticeState, type SessionKey, type SessionWindow
} from "./waybill-follow-up-rules.js";

export const PENALTY_TYPE = "waybill_follow_up_miss";
const SYSTEM_NAME = "Automatic (Waybill Follow-Up Center)";
export const EVIDENCE_BUCKET = "waybill-follow-up-evidence";
const LOGISTICS_ROLE = "Inventory Manager & Logistics Operations";
/** People who may be made responsible for the follow-ups. */
export const RESPONSIBLE_ROLES = [LOGISTICS_ROLE, "Inventory Manager", "Manager", "Admin"];

const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const sundayOf = (key: string) => addDays(key, -new Date(`${key}T12:00:00Z`).getUTCDay());

// ── Settings and the person responsible ─────────────────────────────────────

export async function settingsFor(orgId: string): Promise<FollowUpSettings> {
  const { data, error } = await supabase.from("waybill_follow_up_settings").select("*").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  return data ? cleanSettings(data as any) : { ...DEFAULT_SETTINGS };
}

/** The person charged: the one set in Settings, else the only active Inventory & Logistics user (none or several: nobody). */
export async function responsibleFor(orgId: string, settings: FollowUpSettings): Promise<{ id: string; name: string } | null> {
  if (settings.responsibleUserId) {
    const { data } = await supabase.from("users").select("id, name, active").eq("org_id", orgId).eq("id", settings.responsibleUserId).maybeSingle();
    return data && (data as any).active !== false ? { id: String((data as any).id), name: String((data as any).name ?? "") } : null;
  }
  const { data, error } = await supabase.from("users").select("id, name").eq("org_id", orgId).eq("role", LOGISTICS_ROLE).eq("active", true);
  if (error) throw error;
  return (data ?? []).length === 1 ? { id: String((data as any[])[0].id), name: String((data as any[])[0].name ?? "") } : null;
}

// ── Waybills, agents, logs ──────────────────────────────────────────────────

type WaybillRow = {
  id: string; status: string; created_at: string; closed_at: string | null; to_location: string | null;
  to_agent_id: string | null; agent_id: string | null; to_agent_location_id: string | null;
  product_name: string | null; quantity: number | null; carrier: string | null; tracking_number: string | null; branch_id: string | null;
  dispatched_date: string | null;
};
const WAYBILL_COLUMNS = "id, status, created_at, closed_at, to_location, to_agent_id, agent_id, to_agent_location_id, product_name, quantity, carrier, tracking_number, branch_id, dispatched_date";

/** Still In Transit, or left In Transit since `sinceDay` (they may still owe that day's early sessions). */
async function waybillsSince(orgId: string, sinceDay: string): Promise<WaybillRow[]> {
  const { data, error } = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId)
    .or(`status.eq."In Transit",closed_at.gte."${new Date(dayStartMs(sinceDay)).toISOString()}"`).limit(5000);
  if (error) throw error;
  return (data ?? []) as WaybillRow[];
}

const asFollowUp = (row: WaybillRow): FollowUpWaybill => ({
  id: String(row.id), createdMs: Date.parse(row.created_at), status: String(row.status), closedMs: row.closed_at ? Date.parse(row.closed_at) : null, toLocation: row.to_location ?? null
});

type Place = { agentName: string; agentPhone: string | null; state: string; city: string };

/** Agent name and where the waybill goes, for the tables and messages. */
async function placesFor(orgId: string, rows: WaybillRow[]): Promise<Map<string, Place>> {
  const agentIds = [...new Set(rows.map((row) => row.to_agent_id ?? row.agent_id).filter(Boolean))] as string[];
  const locationIds = [...new Set(rows.map((row) => row.to_agent_location_id).filter(Boolean))] as string[];
  const [agents, locations] = await Promise.all([
    agentIds.length ? supabase.from("agents").select("id, name, phone, whatsapp_phone, primary_base_state").eq("org_id", orgId).in("id", agentIds) : Promise.resolve({ data: [], error: null }),
    locationIds.length ? supabase.from("agent_locations").select("id, name, state, city").eq("org_id", orgId).in("id", locationIds) : Promise.resolve({ data: [], error: null })
  ]);
  if (agents.error) throw agents.error;
  if (locations.error) throw locations.error;
  const agentById = new Map(((agents.data ?? []) as any[]).map((row) => [String(row.id), row]));
  const locationById = new Map(((locations.data ?? []) as any[]).map((row) => [String(row.id), row]));
  return new Map(rows.map((row) => {
    const agent = agentById.get(String(row.to_agent_id ?? row.agent_id ?? ""));
    const location = locationById.get(String(row.to_agent_location_id ?? ""));
    return [String(row.id), {
      agentName: String(agent?.name ?? location?.name ?? "No agent"),
      agentPhone: agent?.whatsapp_phone ?? agent?.phone ?? null,
      state: String(location?.state ?? agent?.primary_base_state ?? row.to_location ?? ""),
      city: String(location?.city ?? "")
    }];
  }));
}

type LogRecord = {
  id: string; waybill_id: string; batch_id: string | null; session_date: string; session_key: SessionKey | null; channels: string[];
  response: string; response_note: string; next_action: string; evidence_path: string | null; logged_by_name: string; logged_at: string;
};
const LOG_COLUMNS = "id, waybill_id, batch_id, session_date, session_key, channels, response, response_note, next_action, evidence_path, logged_by_name, logged_at";

async function logsBetween(orgId: string, from: string, to: string): Promise<LogRecord[]> {
  const { data, error } = await supabase.from("waybill_follow_up_logs").select(LOG_COLUMNS).eq("org_id", orgId)
    .gte("session_date", from).lte("session_date", to).order("logged_at", { ascending: false }).limit(20000);
  if (error) throw error;
  return (data ?? []) as LogRecord[];
}

/** Every log of these waybills, newest first (last follow-up, last answer, no-news streak). */
async function logsOfWaybills(orgId: string, ids: string[]): Promise<LogRecord[]> {
  const out: LogRecord[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("waybill_follow_up_logs").select(LOG_COLUMNS).eq("org_id", orgId)
      .in("waybill_id", ids.slice(i, i + 200)).order("logged_at", { ascending: false }).limit(20000);
    if (error) throw error;
    out.push(...((data ?? []) as LogRecord[]));
  }
  return out.sort((a, b) => b.logged_at.localeCompare(a.logged_at));
}

/** "I've informed the agent's group" ticks of these waybills (migration 332). */
async function noticesFor(orgId: string, ids: string[]): Promise<Map<string, { informedAt: string; informedByName: string }>> {
  const out = new Map<string, { informedAt: string; informedByName: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("waybill_agent_notices").select("waybill_id, informed_at, informed_by_name").eq("org_id", orgId).in("waybill_id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const row of (data ?? []) as any[]) out.set(String(row.waybill_id), { informedAt: String(row.informed_at), informedByName: String(row.informed_by_name ?? "") });
  }
  return out;
}

type NoticeView = { state: NoticeState; startAt: string; dueAt: string; informedAt: string | null; informedByName: string | null } | null;
function noticeView(row: WaybillRow, notice: { informedAt: string; informedByName: string } | undefined, settings: FollowUpSettings, nowMs: number): NoticeView {
  const result = noticeState({
    createdMs: Date.parse(row.created_at), informedMs: notice ? Date.parse(notice.informedAt) : null,
    closedMs: row.closed_at ? Date.parse(row.closed_at) : null, nowMs, settings
  });
  return result ? {
    state: result.state, startAt: new Date(result.startMs).toISOString(), dueAt: new Date(result.dueMs).toISOString(),
    informedAt: notice?.informedAt ?? null, informedByName: notice?.informedByName ?? null
  } : null;
}

/** Waybill ids with a log counted for each session of a day: "m1" → {WB-1, WB-2}. */
const loggedBySession = (logs: LogRecord[], dateKey: string) => {
  const out = new Map<string, Set<string>>();
  for (const log of logs) {
    if (log.session_date !== dateKey || !log.session_key) continue;
    const set = out.get(log.session_key) ?? new Set<string>();
    set.add(log.waybill_id);
    out.set(log.session_key, set);
  }
  return out;
};

// ── The page ────────────────────────────────────────────────────────────────

export type ActiveRow = {
  id: string; productName: string; quantity: number; carrier: string | null; createdAt: string; ageDays: number;
  dispatchedDate: string | null;
  /** Today's logs that counted for a session: the log form's own progress list. */
  todayLogs: Array<{ sessionKey: SessionKey; at: string }>;
  agentName: string; agentPhone: string | null; state: string; city: string;
  lastLog: { at: string; channels: string[]; response: string; note: string } | null;
  status: ReturnType<typeof waybillState>; noNewsStreak: number; followUpsToday: number;
  /** "I've informed the agent's group" within the hour (null: made before that rule). */
  notice: NoticeView;
};

export type LogView = {
  id: string; waybillId: string; at: string; sessionKey: SessionKey | null; sessionLabel: string | null; channels: string[];
  response: string; responseNote: string; nextAction: string; loggedByName: string; hasEvidence: boolean; batchId: string | null;
  agentName: string; state: string;
};

const sessionLabelOf = (key: string | null) => SESSIONS.find((session) => session.key === key)?.label ?? null;

function logView(log: LogRecord, places: Map<string, Place>): LogView {
  const place = places.get(log.waybill_id);
  return {
    id: log.id, waybillId: log.waybill_id, at: log.logged_at, sessionKey: log.session_key, sessionLabel: sessionLabelOf(log.session_key),
    channels: log.channels, response: log.response, responseNote: log.response_note, nextAction: log.next_action, loggedByName: log.logged_by_name,
    hasEvidence: Boolean(log.evidence_path), batchId: log.batch_id, agentName: place?.agentName ?? "", state: place?.state ?? ""
  };
}

function activeRows(rows: WaybillRow[], places: Map<string, Place>, logs: LogRecord[], settings: FollowUpSettings, nowMs: number, notices: Map<string, { informedAt: string; informedByName: string }>): ActiveRow[] {
  const today = lagosDay(nowMs);
  const byWaybill = new Map<string, LogRecord[]>();
  for (const log of logs) byWaybill.set(log.waybill_id, [...(byWaybill.get(log.waybill_id) ?? []), log]);
  return rows.filter((row) => row.status === "In Transit").map((row) => {
    const own = byWaybill.get(String(row.id)) ?? [];
    const last = own[0] ?? null;
    const place = places.get(String(row.id));
    const createdMs = Date.parse(row.created_at);
    return {
      id: String(row.id), productName: String(row.product_name ?? ""), quantity: Number(row.quantity ?? 0), carrier: row.carrier ?? null,
      createdAt: row.created_at, ageDays: Math.max(0, Math.floor((nowMs - createdMs) / 86_400_000)),
      dispatchedDate: row.dispatched_date ? String(row.dispatched_date).slice(0, 10) : null,
      todayLogs: own.filter((log) => log.session_date === today && log.session_key).map((log) => ({ sessionKey: log.session_key as SessionKey, at: log.logged_at })),
      agentName: place?.agentName ?? "No agent", agentPhone: place?.agentPhone ?? null, state: place?.state ?? "", city: place?.city ?? "",
      lastLog: last ? { at: last.logged_at, channels: last.channels, response: last.response, note: last.response_note } : null,
      status: waybillState({ lastResponse: last?.response ?? null, createdMs, nowMs, overdueAfterDays: settings.overdueAfterDays }),
      noNewsStreak: noNewsStreak(own.map((log) => log.response)),
      followUpsToday: own.filter((log) => log.session_date === today).length,
      notice: noticeView(row, notices.get(String(row.id)), settings, nowMs)
    };
  }).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

type SessionView = {
  key: SessionKey; label: string; timeLabel: string; openAt: string; dueAt: string; closeAt: string;
  status: ReturnType<typeof sessionStatus>["status"]; owed: number; logged: number; missing: number; completedAt: string | null;
};

/** One day's five sessions: who owed each, who was logged, and when it was completed. */
function daySessions(dateKey: string, waybills: FollowUpWaybill[], logs: LogRecord[], settings: FollowUpSettings, nowMs: number): Array<SessionView & { window: SessionWindow; missingIds: string[] }> {
  const working = isWorkingDay(dateKey, settings);
  const logged = loggedBySession(logs, dateKey);
  return sessionWindows(dateKey, settings.graceMinutes).map((window) => {
    const dueIds = waybills.filter((waybill) => owesSession(waybill, window)).map((waybill) => waybill.id);
    const loggedIds = logged.get(window.key) ?? new Set<string>();
    const { status, missing } = sessionStatus({ window, nowMs, workingDay: working, dueIds, loggedIds });
    // Completed at: when the last owed waybill got its first log in the window.
    let completedAt: string | null = null;
    if (status === "completed") {
      const firstLog = new Map<string, string>();
      for (const log of logs) if (log.session_date === dateKey && log.session_key === window.key && dueIds.includes(log.waybill_id)) {
        const seen = firstLog.get(log.waybill_id);
        if (!seen || log.logged_at < seen) firstLog.set(log.waybill_id, log.logged_at);
      }
      completedAt = [...firstLog.values()].sort().pop() ?? null;
    }
    return {
      key: window.key, label: window.label, timeLabel: window.timeLabel, window,
      openAt: new Date(window.openMs).toISOString(), dueAt: new Date(window.dueMs).toISOString(), closeAt: new Date(window.closeMs).toISOString(),
      status, owed: dueIds.length, logged: dueIds.length - missing.length, missing: missing.length, missingIds: missing, completedAt
    };
  });
}

export async function dashboardFor(orgId: string, dateKey: string, nowMs = Date.now()) {
  const settings = await settingsFor(orgId);
  const today = lagosDay(nowMs);
  const weekStart = sundayOf(dateKey);
  const [rows, weekLogs, misses, responsible] = await Promise.all([
    waybillsSince(orgId, weekStart),
    logsBetween(orgId, weekStart, dateKey),
    supabase.from("waybill_follow_up_misses").select("id, waybill_id, session_date, session_key, amount, state").eq("org_id", orgId)
      .gte("session_date", weekStart).lte("session_date", dateKey).limit(20000),
    responsibleFor(orgId, settings)
  ]);
  if (misses.error) throw misses.error;
  const dayEnd = dayStartMs(addDays(dateKey, 1));
  const existing = rows.filter((row) => Date.parse(row.created_at) < dayEnd);
  const waybills = existing.map(asFollowUp);
  const active = rows.filter((row) => row.status === "In Transit");
  const [places, activeLogs, notices] = await Promise.all([
    placesFor(orgId, rows), logsOfWaybills(orgId, active.map((row) => String(row.id))), noticesFor(orgId, active.map((row) => String(row.id)))
  ]);
  const dayLogs = weekLogs.filter((log) => log.session_date === dateKey);
  const sessions = daySessions(dateKey, waybills, dayLogs, settings, nowMs);
  const activeList = activeRows(active, places, activeLogs, settings, nowMs, notices);

  // Follow-ups due: the session open right now, else the next one today.
  const open = dateKey === today ? sessions.find((session) => session.status === "open") : undefined;
  const next = dateKey === today ? sessions.find((session) => nowMs < session.window.closeMs && session.status !== "off") ?? null : null;
  // Sessions are owed from the day after a waybill is made.
  const dueNow = open ? open.missing : next ? active.filter((row) => lagosDay(Date.parse(row.created_at)) < dateKey).length : 0;

  const ran = sessions.filter((session) => session.status !== "upcoming" && session.status !== "off");
  const owed = ran.reduce((sum, session) => sum + session.owed, 0);
  const loggedCount = ran.reduce((sum, session) => sum + session.logged, 0);
  const dayMisses = ((misses.data ?? []) as any[]).filter((row) => row.session_date === dateKey && row.state !== "cancelled");
  const receivedToday = rows.filter((row) => row.status === "Received" && row.closed_at && lagosDay(Date.parse(row.closed_at)) === dateKey).length;

  // This week so far: every closed session that owed anything.
  let weekOwed = 0, weekLogged = 0, totalSessions = 0, missedSessions = 0;
  for (let day = weekStart; day <= dateKey; day = addDays(day, 1)) {
    const end = dayStartMs(addDays(day, 1));
    const dayWaybills = rows.filter((row) => Date.parse(row.created_at) < end).map(asFollowUp);
    for (const session of daySessions(day, dayWaybills, weekLogs.filter((log) => log.session_date === day), settings, nowMs)) {
      if (session.status !== "completed" && session.status !== "missed") continue;
      totalSessions += 1;
      if (session.status === "missed") missedSessions += 1;
      weekOwed += session.owed;
      weekLogged += session.logged;
    }
  }

  return {
    date: dateKey, today, nowMs, workingDay: isWorkingDay(dateKey, settings),
    settings: { ...settings, responsibleName: responsible?.name ?? null },
    cards: {
      activeWaybills: active.length,
      dueNow,
      completedToday: dayLogs.filter((log) => log.session_key).length,
      compliance: complianceRate(owed, loggedCount),
      missed: dayMisses.length,
      missedAmount: dayMisses.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
      pendingResponses: activeList.filter((row) => !row.lastLog || responseOf(row.lastLog.response)?.useful === false).length,
      receivedToday
    },
    sessions: sessions.map(({ window: _window, missingIds: _missing, ...session }) => session),
    next: next ? { key: next.key, label: next.label, timeLabel: next.timeLabel, dueAt: next.dueAt, closeAt: next.closeAt, open: next.status === "open" } : null,
    waybills: activeList,
    recentLogs: dayLogs.slice(0, 8).map((log) => logView(log, places)),
    accountability: { missed: dayMisses.length, amountEach: settings.amount, total: dayMisses.reduce((sum, row) => sum + Number(row.amount ?? 0), 0) },
    week: { complianceRate: complianceRate(weekOwed, weekLogged), totalSessions, missedSessions },
    options: { responses: RESPONSES, channels: CHANNELS, nextActions: NEXT_ACTIONS }
  };
}

/** The Active Waybills tab (and the log form's list). */
export async function activeWaybills(orgId: string, nowMs = Date.now()) {
  const settings = await settingsFor(orgId);
  const { data, error } = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId).eq("status", "In Transit").limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as WaybillRow[];
  const [places, logs, notices] = await Promise.all([
    placesFor(orgId, rows), logsOfWaybills(orgId, rows.map((row) => String(row.id))), noticesFor(orgId, rows.map((row) => String(row.id)))
  ]);
  const session = sessionForLog(nowMs, settings.graceMinutes);
  return { waybills: activeRows(rows, places, logs, settings, nowMs, notices), currentSession: session ? { key: session, label: sessionLabelOf(session) } : null };
}

/** Follow-Up History: every log in a date range, newest first. */
export async function historyFor(orgId: string, from: string, to: string, waybillId?: string) {
  let logs = await logsBetween(orgId, from, to);
  if (waybillId) logs = logs.filter((log) => log.waybill_id.toLowerCase().includes(waybillId.toLowerCase()));
  const ids = [...new Set(logs.map((log) => log.waybill_id))];
  const rows: WaybillRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId).in("id", ids.slice(i, i + 200));
    if (error) throw error;
    rows.push(...((data ?? []) as WaybillRow[]));
  }
  const places = await placesFor(orgId, rows);
  return { logs: logs.slice(0, 2000).map((log) => logView(log, places)) };
}

/** Every follow-up of one waybill, all time, newest first (the per-waybill log window, Bright 12 Nov 2026). */
export async function waybillLogs(orgId: string, waybillId: string) {
  const { data, error } = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId).eq("id", waybillId).maybeSingle();
  if (error) throw error;
  if (!data) throw new FollowUpError(404, "This waybill was not found.");
  const [logs, places] = await Promise.all([logsOfWaybills(orgId, [waybillId]), placesFor(orgId, [data as WaybillRow])]);
  return { logs: logs.map((log) => logView(log, places)) };
}

// ── Logging a follow-up ─────────────────────────────────────────────────────

const EVIDENCE_MIME: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };

export class FollowUpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/**
 * One call or WhatsApp message, for one or several waybills: one log each,
 * sharing a batch id (Bright: one call may cover several waybills, but only
 * the ones named). The session is the one open at this moment, never chosen.
 */
export async function addLogs(orgId: string, user: { id: string; name: string | null }, input: {
  waybillIds: unknown; channels: unknown; response: unknown; responseNote?: unknown; nextAction?: unknown; evidence?: { dataUrl?: unknown } | null;
}, nowMs = Date.now()) {
  const problem = logProblem({ waybillIds: input.waybillIds, channels: input.channels, response: input.response, responseNote: input.responseNote });
  if (problem) throw new FollowUpError(400, problem);
  const ids = [...new Set((input.waybillIds as unknown[]).map((id) => String(id).trim()).filter(Boolean))];
  const { data, error } = await supabase.from("waybill_records").select("id, status, branch_id").eq("org_id", orgId).in("id", ids);
  if (error) throw error;
  const found = new Map(((data ?? []) as any[]).map((row) => [String(row.id), row]));
  const notOpen = ids.filter((id) => found.get(id)?.status !== "In Transit");
  if (notOpen.length) throw new FollowUpError(409, `${notOpen.slice(0, 3).join(", ")}${notOpen.length > 3 ? ` and ${notOpen.length - 3} more` : ""} ${notOpen.length === 1 ? "is" : "are"} no longer waiting for receipt.`);

  const settings = await settingsFor(orgId);
  const sessionKey = sessionForLog(nowMs, settings.graceMinutes);
  let evidencePath: string | null = null;
  if (input.evidence && typeof input.evidence.dataUrl === "string" && input.evidence.dataUrl) {
    const match = input.evidence.dataUrl.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    const ext = match ? EVIDENCE_MIME[match[1].toLowerCase()] : undefined;
    if (!match || !ext) throw new FollowUpError(400, "Attach a screenshot or call log (PNG, JPG or PDF).");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 5 * 1024 * 1024) throw new FollowUpError(413, "That file is over 5MB.");
    evidencePath = `${orgId}/${lagosDay(nowMs)}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from(EVIDENCE_BUCKET).upload(evidencePath, buffer, { contentType: match[1].toLowerCase(), upsert: false });
    if (uploadError) throw uploadError;
  }
  const batchId = ids.length > 1 ? randomUUID() : null;
  const loggedAt = new Date(nowMs).toISOString();
  const rows = ids.map((id) => ({
    org_id: orgId, branch_id: found.get(id)?.branch_id ?? null, waybill_id: id, batch_id: batchId,
    session_date: lagosDay(nowMs), session_key: sessionKey,
    channels: [...new Set(input.channels as string[])], response: String(input.response),
    response_note: String(input.responseNote ?? "").trim().slice(0, 500), next_action: String(input.nextAction ?? "").trim().slice(0, 300),
    evidence_path: evidencePath, logged_by: user.id, logged_by_name: user.name ?? "", logged_at: loggedAt
  }));
  const { error: insertError } = await supabase.from("waybill_follow_up_logs").insert(rows);
  if (insertError) throw insertError;
  return { logged: rows.length, sessionKey, sessionLabel: sessionLabelOf(sessionKey) };
}

/**
 * "I've informed the agent's group": one tick per waybill, timed by the
 * server. A tick after the deadline still counts as told, but the late
 * notice is charged.
 */
export async function informAgent(orgId: string, user: { id: string; name: string | null }, waybillIds: unknown, nowMs = Date.now()) {
  const ids = Array.isArray(waybillIds) ? [...new Set(waybillIds.map((id) => String(id ?? "").trim()).filter(Boolean))].slice(0, 100) : [];
  if (ids.length === 0) throw new FollowUpError(400, "Choose at least one waybill.");
  const settings = await settingsFor(orgId);
  const { data, error } = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId).in("id", ids);
  if (error) throw error;
  const rows = ((data ?? []) as WaybillRow[]).filter((row) => needsNoticeRow(row));
  if (rows.length === 0) throw new FollowUpError(404, "These waybills don't need the agent's group told.");
  const informedAt = new Date(nowMs).toISOString();
  const { data: saved, error: saveError } = await supabase.from("waybill_agent_notices").upsert(rows.map((row) => ({
    org_id: orgId, branch_id: row.branch_id ?? null, waybill_id: String(row.id), informed_at: informedAt, informed_by: user.id, informed_by_name: user.name ?? ""
  })), { onConflict: "org_id,waybill_id", ignoreDuplicates: true }).select("waybill_id");
  if (saveError) throw saveError;
  const late = rows.filter((row) => {
    const notice = noticeState({ createdMs: Date.parse(row.created_at), informedMs: nowMs, closedMs: row.closed_at ? Date.parse(row.closed_at) : null, nowMs, settings });
    return notice?.state === "done_late";
  }).map((row) => String(row.id));
  return { informed: (saved ?? []).length, already: rows.length - (saved ?? []).length, late };
}
const needsNoticeRow = (row: WaybillRow) => lagosDay(Date.parse(row.created_at)) >= NOTICE_FROM && !isCustomerDelivery(row.to_location);

export async function evidenceUrl(orgId: string, logId: string) {
  const { data, error } = await supabase.from("waybill_follow_up_logs").select("evidence_path").eq("org_id", orgId).eq("id", logId).maybeSingle();
  if (error) throw error;
  const path = (data as any)?.evidence_path;
  if (!path) throw new FollowUpError(404, "No photo on this log.");
  const { data: signed, error: signError } = await supabase.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 300);
  if (signError) throw signError;
  return signed.signedUrl;
}

// ── Charges ─────────────────────────────────────────────────────────────────

const clockOf = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const noticeLength = (minutes: number) => (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}` : `${minutes} min`);

export async function missesBetween(orgId: string, from: string, to: string) {
  const { data, error } = await supabase.from("waybill_follow_up_misses").select("*").eq("org_id", orgId)
    .gte("session_date", from).lte("session_date", to).order("session_date", { ascending: false }).order("created_at", { ascending: false }).limit(5000);
  if (error) throw error;
  const misses = (data ?? []) as any[];
  const ids = [...new Set(misses.map((row) => String(row.waybill_id)))];
  const rows: WaybillRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const res = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId).in("id", ids.slice(i, i + 200));
    if (res.error) throw res.error;
    rows.push(...((res.data ?? []) as WaybillRow[]));
  }
  const places = await placesFor(orgId, rows);
  const settings = await settingsFor(orgId);
  const createdOf = new Map(rows.map((row) => [String(row.id), row.created_at]));
  return misses.map((row) => {
    const session = sessionWindows(String(row.session_date), 0).find((window) => window.key === row.session_key);
    // A late notice: "Inform agent (1 hour)", due at its deadline.
    const created = createdOf.get(String(row.waybill_id));
    const notice = row.session_key === "notice" && created
      ? noticeState({ createdMs: Date.parse(created), informedMs: null, closedMs: null, nowMs: Date.now(), settings }) : null;
    return {
      id: String(row.id), waybillId: String(row.waybill_id), sessionDate: String(row.session_date), sessionKey: row.session_key as SessionKey | "notice",
      sessionLabel: row.session_key === "notice" ? `Inform agent (${noticeLength(settings.noticeMinutes)})` : sessionLabelOf(row.session_key),
      timeLabel: row.session_key === "notice" ? (notice ? `by ${clockOf(notice.dueMs)}` : "") : session?.timeLabel ?? "", amount: Number(row.amount ?? 0), state: String(row.state),
      responsibleUserId: row.responsible_user_id ?? null, responsibleName: String(row.responsible_name ?? ""),
      disputeReason: row.dispute_reason ?? null, decidedByName: row.decided_by_name ?? null, decidedAt: row.decided_at ?? null, decisionNote: row.decision_note ?? null,
      agentName: places.get(String(row.waybill_id))?.agentName ?? "", placeState: places.get(String(row.waybill_id))?.state ?? ""
    };
  });
}

/** Record and charge every waybill not followed up in the sessions of a day that have closed. */
async function chargeDay(orgId: string, dateKey: string, settings: FollowUpSettings, nowMs: number) {
  if (!isWorkingDay(dateKey, settings) || dateKey < settings.chargesFrom) return [];
  const windows = sessionWindows(dateKey, settings.graceMinutes).filter((window) => window.closeMs < nowMs);
  if (windows.length === 0) return [];
  const rows = (await waybillsSince(orgId, dateKey)).filter((row) => Date.parse(row.created_at) < dayStartMs(addDays(dateKey, 1)));
  if (rows.length === 0) return [];
  const logs = await logsBetween(orgId, dateKey, dateKey);
  const logged = loggedBySession(logs, dateKey);
  const waybills = rows.map(asFollowUp);
  const charges = windows.flatMap((window) => missedCharges({ window, nowMs, workingDay: true, settings, waybills, loggedIds: logged.get(window.key) ?? new Set() }));
  if (charges.length === 0) return [];
  const responsible = await responsibleFor(orgId, settings);
  const branchOf = new Map(rows.map((row) => [String(row.id), row.branch_id]));
  // Insert-only: a miss already recorded (and perhaps disputed or cancelled) is never touched again.
  const { data: inserted, error } = await supabase.from("waybill_follow_up_misses").upsert(charges.map((charge) => ({
    org_id: orgId, branch_id: branchOf.get(charge.waybillId) ?? null, waybill_id: charge.waybillId, session_date: charge.sessionDate, session_key: charge.sessionKey,
    responsible_user_id: responsible?.id ?? null, responsible_name: responsible?.name ?? "", amount: charge.amount,
    state: responsible ? "charged" : "not_charged"
  })), { onConflict: "waybill_id,session_date,session_key", ignoreDuplicates: true }).select("id, waybill_id, session_date, session_key, amount, branch_id, state");
  if (error) throw error;
  const fresh = (inserted ?? []) as any[];
  if (!responsible || fresh.length === 0) return fresh.map((row) => ({ ...row, charged: false }));
  const places = await placesFor(orgId, rows.filter((row) => fresh.some((miss) => miss.waybill_id === row.id)));
  for (const miss of fresh) {
    const window = windows.find((row) => row.key === miss.session_key)!;
    const place = places.get(String(miss.waybill_id));
    const { data: penalty, error: penaltyError } = await supabase.from("rep_penalties").insert({
      org_id: orgId, branch_id: miss.branch_id ?? null, rep_id: responsible.id, rep_name: responsible.name, type: PENALTY_TYPE,
      amount: Number(miss.amount), remove_all_bonuses: false, period: String(miss.session_date).slice(0, 7),
      reason: `Waybill ${miss.waybill_id}${place?.state ? ` (${place.state})` : ""} not followed up at ${window.timeLabel} on ${shortDay(String(miss.session_date))}`,
      by_name: SYSTEM_NAME
    }).select("id").single();
    if (penaltyError) { logger.warn("waybill follow-up charge failed", { orgId, miss: miss.id, error: penaltyError.message }); continue; }
    await supabase.from("waybill_follow_up_misses").update({ penalty_id: (penalty as any).id }).eq("id", miss.id);
  }
  return fresh.map((row) => ({ ...row, charged: true, responsibleName: responsible.name }));
}

/**
 * Record and charge every waybill whose agent's group was not told in time
 * (Bright, 7 Nov 2026): ₦noticeAmount each, once, like a missed session.
 */
async function chargeNotices(orgId: string, settings: FollowUpSettings, nowMs: number) {
  const since = [NOTICE_FROM, addDays(lagosDay(nowMs), -4)].sort().pop()!;
  const { data, error } = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId)
    .gte("created_at", new Date(dayStartMs(since)).toISOString()).limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as WaybillRow[];
  if (rows.length === 0) return [];
  const notices = await noticesFor(orgId, rows.map((row) => String(row.id)));
  const charges = noticeCharges({
    waybills: rows.map((row) => ({ ...asFollowUp(row), informedMs: notices.has(String(row.id)) ? Date.parse(notices.get(String(row.id))!.informedAt) : null })),
    nowMs, settings
  });
  if (charges.length === 0) return [];
  const responsible = await responsibleFor(orgId, settings);
  const branchOf = new Map(rows.map((row) => [String(row.id), row.branch_id]));
  const { data: inserted, error: insertError } = await supabase.from("waybill_follow_up_misses").upsert(charges.map((charge) => ({
    org_id: orgId, branch_id: branchOf.get(charge.waybillId) ?? null, waybill_id: charge.waybillId, session_date: charge.sessionDate, session_key: "notice",
    responsible_user_id: responsible?.id ?? null, responsible_name: responsible?.name ?? "", amount: charge.amount,
    state: responsible ? "charged" : "not_charged"
  })), { onConflict: "waybill_id,session_date,session_key", ignoreDuplicates: true }).select("id, waybill_id, session_date, session_key, amount, branch_id, state");
  if (insertError) throw insertError;
  const fresh = (inserted ?? []) as any[];
  if (!responsible || fresh.length === 0) return fresh.map((row) => ({ ...row, charged: false }));
  const places = await placesFor(orgId, rows.filter((row) => fresh.some((miss) => miss.waybill_id === row.id)));
  const dueOf = new Map(charges.map((charge) => [charge.waybillId, charge.dueMs]));
  for (const miss of fresh) {
    const place = places.get(String(miss.waybill_id));
    const { data: penalty, error: penaltyError } = await supabase.from("rep_penalties").insert({
      org_id: orgId, branch_id: miss.branch_id ?? null, rep_id: responsible.id, rep_name: responsible.name, type: PENALTY_TYPE,
      amount: Number(miss.amount), remove_all_bonuses: false, period: String(miss.session_date).slice(0, 7),
      reason: `Waybill ${miss.waybill_id}${place?.state ? ` (${place.state})` : ""}: agent's group not told within ${noticeLength(settings.noticeMinutes)} (due ${clockOf(dueOf.get(String(miss.waybill_id)) ?? nowMs)}, ${shortDay(String(miss.session_date))})`,
      by_name: SYSTEM_NAME
    }).select("id").single();
    if (penaltyError) { logger.warn("waybill notice charge failed", { orgId, miss: miss.id, error: penaltyError.message }); continue; }
    await supabase.from("waybill_follow_up_misses").update({ penalty_id: (penalty as any).id }).eq("id", miss.id);
  }
  return fresh.map((row) => ({ ...row, charged: true, responsibleName: responsible.name }));
}

/** Waybills still waiting for the tick with 15 minutes or less left: the Telegram nudge. */
async function noticesDueSoon(orgId: string, settings: FollowUpSettings, nowMs: number) {
  const { data, error } = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId).eq("status", "In Transit")
    .gte("created_at", new Date(dayStartMs([NOTICE_FROM, addDays(lagosDay(nowMs), -4)].sort().pop()!)).toISOString()).limit(5000);
  if (error) throw error;
  const rows = (data ?? []) as WaybillRow[];
  const notices = await noticesFor(orgId, rows.map((row) => String(row.id)));
  return rows.filter((row) => !notices.has(String(row.id))).flatMap((row) => {
    const notice = noticeState({ createdMs: Date.parse(row.created_at), informedMs: null, closedMs: null, nowMs, settings });
    return notice && notice.state === "waiting" && notice.dueMs - nowMs <= 15 * 60_000 ? [{ id: String(row.id), dueMs: notice.dueMs }] : [];
  });
}

/** Dispute a charge: the person charged (or leadership for them). It stays charged until the Owner decides. */
export async function disputeMiss(orgId: string, missId: string, user: { id: string; role: string }, reason: string) {
  const text = reason.trim();
  if (text.length < 5) throw new FollowUpError(400, "Say why this charge is wrong.");
  const { data, error } = await supabase.from("waybill_follow_up_misses").select("id, state, responsible_user_id").eq("org_id", orgId).eq("id", missId).maybeSingle();
  if (error) throw error;
  if (!data) throw new FollowUpError(404, "Charge not found.");
  if ((data as any).state !== "charged") throw new FollowUpError(409, "Only a charged miss can be disputed.");
  if ((data as any).responsible_user_id !== user.id && !["Owner", "Admin", "Manager"].includes(user.role)) throw new FollowUpError(403, "Only the person charged can dispute it.");
  const { error: updateError } = await supabase.from("waybill_follow_up_misses").update({ state: "disputed", dispute_reason: text.slice(0, 500) }).eq("id", missId).eq("state", "charged");
  if (updateError) throw updateError;
}

/** The Owner keeps or cancels a charge (cancel removes the fine). */
export async function decideMiss(orgId: string, missId: string, owner: { name: string | null }, decision: "keep" | "cancel", note: string) {
  const { data, error } = await supabase.from("waybill_follow_up_misses").select("id, state, penalty_id").eq("org_id", orgId).eq("id", missId).maybeSingle();
  if (error) throw error;
  if (!data) throw new FollowUpError(404, "Charge not found.");
  const row = data as any;
  if (row.state === "cancelled") throw new FollowUpError(409, "This charge was already cancelled.");
  const decided = { decided_by_name: owner.name ?? "Owner", decided_at: new Date().toISOString(), decision_note: note.trim().slice(0, 500) || null };
  if (decision === "keep") {
    const { error: keepError } = await supabase.from("waybill_follow_up_misses").update({ state: row.state === "not_charged" ? "not_charged" : "charged", ...decided }).eq("id", missId);
    if (keepError) throw keepError;
    return;
  }
  if (row.penalty_id) {
    const { error: deleteError } = await supabase.from("rep_penalties").delete().eq("org_id", orgId).eq("id", row.penalty_id);
    if (deleteError) throw deleteError;
  }
  const { error: cancelError } = await supabase.from("waybill_follow_up_misses").update({ state: "cancelled", penalty_id: null, ...decided }).eq("id", missId);
  if (cancelError) throw cancelError;
}

// ── Reports ─────────────────────────────────────────────────────────────────

/** A week's follow-up discipline and progress, day by day. */
export async function weekReport(orgId: string, weekStart: string, nowMs = Date.now()) {
  const settings = await settingsFor(orgId);
  const weekEnd = addDays(weekStart, 6);
  const lastDay = weekEnd < lagosDay(nowMs) ? weekEnd : lagosDay(nowMs);
  const [rows, logs, misses] = await Promise.all([waybillsSince(orgId, weekStart), logsBetween(orgId, weekStart, weekEnd), missesBetween(orgId, weekStart, weekEnd)]);
  const days = [];
  for (let day = weekStart; day <= lastDay; day = addDays(day, 1)) {
    const end = dayStartMs(addDays(day, 1));
    const dayWaybills = rows.filter((row) => Date.parse(row.created_at) < end).map(asFollowUp);
    const sessions = daySessions(day, dayWaybills, logs.filter((log) => log.session_date === day), settings, nowMs);
    const ran = sessions.filter((session) => session.status === "completed" || session.status === "missed");
    const owed = ran.reduce((sum, session) => sum + session.owed, 0);
    const done = ran.reduce((sum, session) => sum + session.logged, 0);
    const dayMisses = misses.filter((miss) => miss.sessionDate === day && miss.state !== "cancelled");
    days.push({
      date: day, workingDay: isWorkingDay(day, settings), sessions: ran.length, missedSessions: ran.filter((session) => session.status === "missed").length,
      owed, logged: done, compliance: complianceRate(owed, done), missed: dayMisses.length, charged: dayMisses.reduce((sum, miss) => sum + (miss.state === "not_charged" ? 0 : miss.amount), 0)
    });
  }
  const weekLogs = logs.filter((log) => log.session_date <= lastDay);
  const useful = weekLogs.filter((log) => responseOf(log.response)?.useful).length;
  const active = rows.filter((row) => row.status === "In Transit");
  const received = rows.filter((row) => row.status === "Received" && row.closed_at && lagosDay(Date.parse(row.closed_at)) >= weekStart && lagosDay(Date.parse(row.closed_at)) <= weekEnd);
  const lastLogOf = new Map<string, string>();
  for (const log of logs) if (!lastLogOf.has(log.waybill_id)) lastLogOf.set(log.waybill_id, log.logged_at);
  const totals = days.reduce((sum, day) => ({ owed: sum.owed + day.owed, logged: sum.logged + day.logged, missed: sum.missed + day.missed, charged: sum.charged + day.charged, missedSessions: sum.missedSessions + day.missedSessions }), { owed: 0, logged: 0, missed: 0, charged: 0, missedSessions: 0 });
  return {
    weekStart, weekEnd, days,
    kpis: {
      compliance: complianceRate(totals.owed, totals.logged),
      missedFollowUps: totals.missed,
      missedSessions: totals.missedSessions,
      charged: totals.charged,
      // Still waiting and nothing logged in the last 24 hours.
      withoutUpdates: active.filter((row) => { const last = lastLogOf.get(String(row.id)); return !last || nowMs - Date.parse(last) > 86_400_000; }).length,
      responseRate: weekLogs.length ? Math.round((useful / weekLogs.length) * 100) : null,
      overdue: active.filter((row) => nowMs - Date.parse(row.created_at) > settings.overdueAfterDays * 86_400_000).length,
      received: received.length,
      averageDaysToReceive: received.length
        ? Math.round((received.reduce((sum, row) => sum + (Date.parse(row.closed_at!) - Date.parse(row.created_at)), 0) / received.length / 86_400_000) * 10) / 10
        : null,
      logs: weekLogs.length
    }
  };
}

// ── The job: reminders before each session, charges after it ──────────────

const WAYBILL_TRIGGERS = ["waybill_follow_up_due", "waybill_follow_up_missed", "waybill_notice_due", "waybill_notice_late"] as const;
const automationsReady = new Set<string>();

export async function runWaybillFollowUpJob(nowMs = Date.now()) {
  const { data: orgs, error } = await supabase.from("organizations").select("id");
  if (error) throw error;
  const { telegramWaybillReminder, telegramWaybillMissed, telegramWaybillNoticeSoon, telegramWaybillNoticeLate, ensureDefaultAutomations } = await import("./telegram.js");
  const linesFor = async (orgId: string, ids: string[]) => {
    const rows: WaybillRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const res = await supabase.from("waybill_records").select(WAYBILL_COLUMNS).eq("org_id", orgId).in("id", ids.slice(i, i + 200));
      if (res.error) throw res.error;
      rows.push(...((res.data ?? []) as WaybillRow[]));
    }
    const places = await placesFor(orgId, rows);
    return ids.map((id) => ({ id, place: places.get(id)?.state ?? "", agent: places.get(id)?.agentName ?? "No agent" }));
  };
  for (const org of (orgs ?? []) as Array<{ id: string }>) {
    try {
      const settings = await settingsFor(org.id);
      const today = lagosDay(nowMs);
      // The waybill messages need their ready-made automations; they are made
      // here once, so nobody has to open the Telegram Bot page first.
      if (!automationsReady.has(org.id)) {
        await ensureDefaultAutomations(org.id, WAYBILL_TRIGGERS).catch((ensureError: any) => logger.warn("waybill automations not made", { orgId: org.id, error: String(ensureError?.message ?? ensureError) }));
        automationsReady.add(org.id);
      }

      // The agent's group not told within the hour: charge, then say so.
      const lateNotices = await chargeNotices(org.id, settings, nowMs);
      if (lateNotices.length) {
        const responsible = await responsibleFor(org.id, settings);
        await telegramWaybillNoticeLate(org.id, {
          waybills: await linesFor(org.id, lateNotices.map((row) => String(row.waybill_id))), amount: settings.noticeAmount, minutes: settings.noticeMinutes,
          charged: lateNotices.some((row) => row.charged), responsibleUserId: responsible?.id ?? null, responsibleName: responsible?.name ?? null,
          dedupeKey: lateNotices.map((row) => String(row.waybill_id)).sort().join(",")
        }).catch((sendError: any) => logger.warn("waybill notice late telegram failed", { orgId: org.id, error: String(sendError?.message ?? sendError) }));
      }
      // 15 minutes or less left to tick: one nudge per waybill.
      for (const soon of await noticesDueSoon(org.id, settings, nowMs)) {
        const [line] = await linesFor(org.id, [soon.id]);
        await telegramWaybillNoticeSoon(org.id, { waybill: line, dueMs: soon.dueMs, nowMs, amount: settings.noticeAmount, charged: lagosDay(soon.dueMs) >= settings.chargesFrom })
          .catch((sendError: any) => logger.warn("waybill notice soon telegram failed", { orgId: org.id, error: String(sendError?.message ?? sendError) }));
      }
      // Yesterday too, in case the server was down when its last session closed.
      for (const day of [addDays(today, -1), today]) {
        const fresh = await chargeDay(org.id, day, settings, nowMs);
        if (fresh.length === 0) continue;
        const bySession = new Map<string, any[]>();
        for (const miss of fresh) bySession.set(miss.session_key, [...(bySession.get(miss.session_key) ?? []), miss]);
        const responsible = await responsibleFor(org.id, settings);
        for (const [key, list] of bySession) {
          const window = sessionWindows(day, settings.graceMinutes).find((row) => row.key === key)!;
          await telegramWaybillMissed(org.id, {
            dateKey: day, sessionKey: key, timeLabel: window.timeLabel, dayLabel: shortDay(day),
            waybills: await linesFor(org.id, list.map((row) => String(row.waybill_id))), amount: settings.amount,
            charged: list.some((row) => row.charged), responsibleUserId: responsible?.id ?? null, responsibleName: responsible?.name ?? null
          }).catch((sendError: any) => logger.warn("waybill missed telegram failed", { orgId: org.id, error: String(sendError?.message ?? sendError) }));
        }
      }
      // Ten minutes before each session: the reminder.
      if (isWorkingDay(today, settings)) {
        const window = sessionWindows(today, settings.graceMinutes).find((row) => nowMs >= row.dueMs - 10 * 60_000 && nowMs < row.dueMs - 5 * 60_000);
        if (window) {
          const { data: active } = await supabase.from("waybill_records").select("id, created_at").eq("org_id", org.id).eq("status", "In Transit").limit(5000);
          // Sessions start the day after a waybill is made.
          const owing = ((active ?? []) as any[]).filter((row) => lagosDay(Date.parse(row.created_at)) < today).map((row) => String(row.id));
          if (owing.length) {
            await telegramWaybillReminder(org.id, {
              dateKey: today, sessionKey: window.key, label: window.label, timeLabel: window.timeLabel, openMs: window.openMs, closeMs: window.closeMs,
              waybills: await linesFor(org.id, owing), amount: settings.amount, charged: today >= settings.chargesFrom
            }).catch((sendError: any) => logger.warn("waybill reminder telegram failed", { orgId: org.id, error: String(sendError?.message ?? sendError) }));
          }
        }
      }
    } catch (jobError) {
      logger.error("waybill follow-up job failed", { orgId: org.id, error: String((jobError as Error)?.message ?? jobError) });
    }
  }
}
