import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

// Orders in these raw statuses are the daily follow-up obligation set (mirrors the
// Follow-up Queue page). Delivered / Cancelled / Failed are terminal — no obligation.
const IN_SCOPE_STATUSES = ["New", "Confirmed", "Postponed"] as const;
export const FOLLOW_UP_MISS_AMOUNT = 50;
// When the customer's last outcome is "unreachable" they must be called this many
// times in the day for the order to count as attended.
const REQUIRED_CALLS_WHEN_UNREACHABLE = 3;
const UNREACHABLE_OUTCOME_GROUP = "unreachable";

// Africa/Lagos is UTC+1 year-round (no DST). Work the calendar in Lagos local time.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export function lagosDateKey(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}
function dowOf(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay(); // 0=Sun .. 6=Sat
}
export function isWorkingDay(dateKey: string): boolean {
  return dowOf(dateKey) !== 0; // no work on Sundays
}
// 1-based count of working days (Mon–Sat) from startKey..todayKey inclusive.
function workingDayNumber(startKey: string, todayKey: string): number {
  if (startKey > todayKey) return 0;
  let n = 0;
  const cur = new Date(`${startKey}T12:00:00Z`);
  const end = new Date(`${todayKey}T12:00:00Z`);
  while (cur.getTime() <= end.getTime()) {
    if (isWorkingDay(cur.toISOString().slice(0, 10))) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}
function lagosStartOfDayUtc(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00.000+01:00`).toISOString();
}

// Working hours 08:30–17:00 (Africa/Lagos). A new order that arrives OUTSIDE these
// hours isn't charged for its arrival day — the rep had no working window to act on
// it. From the next working day the obligation applies normally.
const WORK_START_MIN = 8 * 60 + 30; // 08:30
const WORK_END_MIN = 17 * 60;       // 17:00
function lagosMinutesOfDay(input: string | Date): number {
  const d = typeof input === "string" ? new Date(input) : input;
  const lagos = new Date(d.getTime() + LAGOS_OFFSET_MS);
  return lagos.getUTCHours() * 60 + lagos.getUTCMinutes();
}

export type FollowUpObligation = {
  orderId: string;
  repId: string | null;
  repName: string | null;
  customer: string | null;
  phone: string | null;
  status: string;
  dayNumber: number;
  paused: boolean;           // scheduled/postponed to a future date
  scheduledFor: string | null;
  exempt: boolean;           // new order that arrived outside working hours today

  requiredCalls: number;     // 3 when the customer is unreachable, else 1
  attemptsToday: number;
  callsToday: number;
  channelsToday: string[];
  customerReachedToday: boolean;
  attended: boolean;
};

export type FollowUpBoard = {
  date: string;
  workingDay: boolean;
  obligations: FollowUpObligation[];
  dueCount: number;
  attendedCount: number;
  unattendedCount: number;
};

async function computeBoard(orgId: string, dateKey: string, repId?: string | null): Promise<FollowUpBoard> {
  if (!isWorkingDay(dateKey)) {
    return { date: dateKey, workingDay: false, obligations: [], dueCount: 0, attendedCount: 0, unattendedCount: 0 };
  }

  let orderQuery = supabase
    .from("orders")
    .select("id, assigned_rep_id, customer, phone, status, created_at, next_follow_up_at, scheduled_at, scheduled_date")
    .eq("org_id", orgId)
    .in("status", IN_SCOPE_STATUSES as unknown as string[])
    .not("assigned_rep_id", "is", null);
  if (repId) orderQuery = orderQuery.eq("assigned_rep_id", repId);
  const { data: orders } = await orderQuery;
  const orderRows = (orders ?? []) as Array<{
    id: string; assigned_rep_id: string | null; customer: string | null; phone: string | null;
    status: string; created_at: string; next_follow_up_at: string | null; scheduled_at: string | null; scheduled_date: string | null;
  }>;
  if (orderRows.length === 0) {
    return { date: dateKey, workingDay: true, obligations: [], dueCount: 0, attendedCount: 0, unattendedCount: 0 };
  }
  const orderIds = orderRows.map((o) => o.id);

  // Rep names
  const repIds = Array.from(new Set(orderRows.map((o) => o.assigned_rep_id).filter(Boolean))) as string[];
  const repNameById = new Map<string, string>();
  if (repIds.length) {
    const { data: reps } = await supabase.from("users").select("id, name").in("id", repIds);
    for (const r of (reps ?? []) as Array<{ id: string; name: string }>) repNameById.set(r.id, r.name);
  }

  // Today's attempts, grouped per order.
  const startUtc = lagosStartOfDayUtc(dateKey);
  const { data: todayAttempts } = await supabase
    .from("order_contact_attempts")
    .select("order_id, channel, channels, customer_reached")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .gte("attempted_at", startUtc);
  const todayByOrder = new Map<string, { attempts: number; calls: number; channels: Set<string>; reached: boolean }>();
  for (const a of (todayAttempts ?? []) as Array<{ order_id: string; channel: string | null; channels: string[] | null; customer_reached: boolean | null }>) {
    const e = todayByOrder.get(a.order_id) ?? { attempts: 0, calls: 0, channels: new Set<string>(), reached: false };
    e.attempts++;
    const chans = Array.isArray(a.channels) && a.channels.length ? a.channels : (a.channel ? [a.channel] : []);
    for (const c of chans) e.channels.add(c);
    if (chans.includes("call")) e.calls++;
    if (a.customer_reached) e.reached = true;
    todayByOrder.set(a.order_id, e);
  }

  // Latest outcome group per order (drives the 3-call rule).
  const { data: recentAttempts } = await supabase
    .from("order_contact_attempts")
    .select("order_id, outcome_group, attempted_at")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .order("attempted_at", { ascending: false });
  const latestGroupByOrder = new Map<string, string | null>();
  for (const a of (recentAttempts ?? []) as Array<{ order_id: string; outcome_group: string | null }>) {
    if (!latestGroupByOrder.has(a.order_id)) latestGroupByOrder.set(a.order_id, a.outcome_group ?? null);
  }

  const obligations: FollowUpObligation[] = orderRows.map((o) => {
    const createdKey = lagosDateKey(o.created_at);
    const dayNumber = workingDayNumber(createdKey, dateKey);
    const plannedRaw = o.next_follow_up_at ?? o.scheduled_at ?? (o.scheduled_date ? `${o.scheduled_date}T12:00:00+01:00` : null);
    const plannedKey = plannedRaw ? lagosDateKey(plannedRaw) : null;
    const paused = !!plannedKey && plannedKey > dateKey;
    // Grace: an order created today, outside working hours, isn't due/charged today.
    const createdMins = lagosMinutesOfDay(o.created_at);
    const exempt = createdKey === dateKey && (createdMins < WORK_START_MIN || createdMins >= WORK_END_MIN);
    const t = todayByOrder.get(o.id);
    const requiredCalls = latestGroupByOrder.get(o.id) === UNREACHABLE_OUTCOME_GROUP ? REQUIRED_CALLS_WHEN_UNREACHABLE : 1;
    const attemptsToday = t?.attempts ?? 0;
    const callsToday = t?.calls ?? 0;
    const attended = (paused || exempt) ? true : (requiredCalls > 1 ? callsToday >= requiredCalls : attemptsToday >= 1);
    return {
      orderId: o.id,
      repId: o.assigned_rep_id,
      repName: o.assigned_rep_id ? repNameById.get(o.assigned_rep_id) ?? null : null,
      customer: o.customer,
      phone: o.phone,
      status: o.status,
      dayNumber,
      paused,
      scheduledFor: plannedKey,
      exempt,
      requiredCalls,
      attemptsToday,
      callsToday,
      channelsToday: t ? Array.from(t.channels) : [],
      customerReachedToday: t?.reached ?? false,
      attended
    };
  });

  const due = obligations.filter((o) => !o.paused && !o.exempt);
  const attendedCount = due.filter((o) => o.attended).length;
  return {
    date: dateKey,
    workingDay: true,
    obligations,
    dueCount: due.length,
    attendedCount,
    unattendedCount: due.length - attendedCount
  };
}

export async function getFollowUpBoard(orgId: string, repId?: string | null, dateKey?: string): Promise<FollowUpBoard> {
  return computeBoard(orgId, dateKey ?? lagosDateKey(new Date()), repId ?? undefined);
}

// Nightly close: record one PENDING miss per due-but-unattended obligation. Never
// clobbers a miss that's already been reviewed for the same order/day. Sundays skip.
export async function runFollowUpClose(orgId: string, dateKey?: string): Promise<{ recorded: number }> {
  const key = dateKey ?? lagosDateKey(new Date());
  if (!isWorkingDay(key)) return { recorded: 0 };
  const board = await computeBoard(orgId, key);
  const misses = board.obligations.filter((o) => !o.paused && !o.exempt && !o.attended && o.repId);
  if (misses.length === 0) return { recorded: 0 };
  const rows = misses.map((o) => ({
    org_id: orgId,
    order_id: o.orderId,
    rep_id: o.repId,
    rep_name: o.repName,
    miss_date: key,
    day_number: o.dayNumber,
    reason: o.attemptsToday > 0 ? "insufficient_calls" : "no_log",
    amount: FOLLOW_UP_MISS_AMOUNT,
    state: "pending"
  }));
  const { error } = await supabase
    .from("follow_up_misses")
    .upsert(rows, { onConflict: "order_id,miss_date", ignoreDuplicates: true });
  if (error) {
    logger.warn("follow-up close upsert failed", { orgId, date: key, error: error.message });
    return { recorded: 0 };
  }
  return { recorded: rows.length };
}

export async function runFollowUpCloseAllOrgs(dateKey?: string): Promise<void> {
  const { data: orgs } = await supabase.from("organizations").select("id");
  for (const org of (orgs ?? []) as Array<{ id: string }>) {
    try {
      await runFollowUpClose(org.id, dateKey);
    } catch (e) {
      logger.error("follow-up close crashed", { orgId: org.id, error: (e as Error).message });
    }
  }
}

// Log a follow-up from the Daily Log grid. Appends a dated line to the order's
// `call_outcome` (the single running log everyone already reads — order details,
// WhatsApp, reports) AND records a structured attempt (so the grid's per-day cells
// + reporting work). An optional promised date sets next_follow_up_at, which pauses
// the daily obligation until that day, then resurfaces the order.
export async function logFollowUpEntry(
  orgId: string,
  orderId: string,
  repId: string | null,
  text: string,
  channels: string[],
  promisedDate?: string | null,
  recoveryBucket?: string | null,
  outcomeGroup?: string | null
): Promise<{ ok: true }> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, assigned_rep_id, call_outcome, follow_up_attempt_count")
    .eq("org_id", orgId)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new Error("Order not found.");

  const todayKey = lagosDateKey(new Date());
  const entry = `${todayKey.slice(8, 10)}/${todayKey.slice(5, 7)}: ${text}`;
  const existing = ((order as { call_outcome?: string | null }).call_outcome ?? "").trim();
  const newCallOutcome = existing ? `${existing}\n${entry}` : entry;
  const primary = channels.includes("call") ? "call" : channels.includes("sms") ? "sms" : channels.some((c) => c.startsWith("whatsapp")) ? "whatsapp" : "manual";
  const nowIso = new Date().toISOString();

  await supabase.from("order_contact_attempts").insert({
    org_id: orgId,
    order_id: orderId,
    rep_id: repId ?? (order as { assigned_rep_id?: string | null }).assigned_rep_id ?? null,
    attempted_at: nowIso,
    channel: primary,
    channels,
    attempt_type: "fresh_follow_up",
    outcome_code: text,
    recovery_bucket: recoveryBucket ?? null,
    outcome_group: outcomeGroup ?? null
  });

  const update: Record<string, unknown> = {
    call_outcome: newCallOutcome,
    last_contact_attempt_at: nowIso,
    last_contact_attempt_outcome: text,
    follow_up_attempt_count: (Number((order as { follow_up_attempt_count?: number }).follow_up_attempt_count) || 0) + 1
  };
  if (promisedDate) update.next_follow_up_at = `${promisedDate}T09:00:00+01:00`;

  // #3 Auto-flag reachability from the tag. Count consecutive "unreachable" outcomes
  // (most recent first, incl. the one just logged) → at_risk at 3+. Progress resets.
  if (outcomeGroup === "unreachable") {
    const { data: recent } = await supabase
      .from("order_contact_attempts")
      .select("outcome_group")
      .eq("org_id", orgId)
      .eq("order_id", orderId)
      .order("attempted_at", { ascending: false })
      .limit(12);
    let streak = 0;
    for (const a of (recent ?? []) as Array<{ outcome_group: string | null }>) {
      if (a.outcome_group === "unreachable") streak++;
      else break;
    }
    update.buyer_health = streak >= 3 ? "at_risk" : "watch";
  } else if (outcomeGroup === "progress") {
    update.buyer_health = "healthy";
  } else if (outcomeGroup === "closed_loss") {
    update.buyer_health = "not_serious_candidate";
  }

  await supabase.from("orders").update(update).eq("org_id", orgId).eq("id", orderId);
  return { ok: true };
}

// ── Day-by-day log grid (Google-Sheets style) ─────────────
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function mondayOfWeek(dateKey: string): string {
  const dow = dowOf(dateKey);
  const back = dow === 0 ? 6 : dow - 1;
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}
function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type FollowUpGridCell = {
  state: "logged" | "missed" | "today";
  outcome?: string | null;
  channels?: string[];
  calls?: number;
  attempts?: number;
  reached?: boolean;
};
export type FollowUpGrid = {
  weekStart: string;
  isCurrentWeek: boolean;
  days: Array<{ key: string; label: string; isToday: boolean }>;
  summary: { attendedToday: number; dueToday: number; unattendedToday: number; workingDayToday: boolean };
  rows: Array<{
    orderId: string;
    customer: string | null;
    phone: string | null;
    productName: string | null;
    packageName: string | null;
    amount: number | null;
    currency: string | null;
    location: string | null;
    callOutcome: string | null;
    nextFollowUpAt: string | null;
    buyerHealth: string | null;
    repId: string | null;
    repName: string | null;
    status: string;
    createdKey: string;
    cells: Record<string, FollowUpGridCell>;
  }>;
};

// Orders as rows, the week's working days (Mon–Sat) as columns, each cell the day's
// log: logged (outcome + channels), missed (recorded penalty), or today (due, fill in).
export async function getFollowUpGrid(orgId: string, repId?: string | null, weekStartKey?: string): Promise<FollowUpGrid> {
  const todayKey = lagosDateKey(new Date());
  const weekStart = weekStartKey ?? mondayOfWeek(todayKey);
  const days = Array.from({ length: 6 }, (_, i) => {
    const key = addDays(weekStart, i);
    return { key, label: `${WEEKDAY_SHORT[dowOf(key)]} ${Number(key.slice(8, 10))}`, isToday: key === todayKey };
  });
  const isCurrentWeek = weekStart === mondayOfWeek(todayKey);

  const board = await getFollowUpBoard(orgId, repId, todayKey);
  const summary = {
    attendedToday: board.attendedCount,
    dueToday: board.dueCount,
    unattendedToday: board.unattendedCount,
    workingDayToday: board.workingDay
  };

  let orderQuery = supabase
    .from("orders")
    .select("id, assigned_rep_id, customer, phone, status, created_at, next_follow_up_at, scheduled_at, scheduled_date, product_name, package_name, amount, currency, location, call_outcome, buyer_health")
    .eq("org_id", orgId)
    .in("status", IN_SCOPE_STATUSES as unknown as string[])
    .not("assigned_rep_id", "is", null);
  if (repId) orderQuery = orderQuery.eq("assigned_rep_id", repId);
  const { data: orders } = await orderQuery;
  const orderRows = (orders ?? []) as Array<{
    id: string; assigned_rep_id: string | null; customer: string | null; phone: string | null;
    status: string; created_at: string; next_follow_up_at: string | null; scheduled_at: string | null; scheduled_date: string | null;
    product_name: string | null; package_name: string | null; amount: number | null; currency: string | null; location: string | null;
    call_outcome: string | null; buyer_health: string | null;
  }>;
  if (orderRows.length === 0) return { weekStart, isCurrentWeek, days, summary, rows: [] };
  const orderIds = orderRows.map((o) => o.id);

  const repIds = Array.from(new Set(orderRows.map((o) => o.assigned_rep_id).filter(Boolean))) as string[];
  const repNameById = new Map<string, string>();
  if (repIds.length) {
    const { data: reps } = await supabase.from("users").select("id, name").in("id", repIds);
    for (const r of (reps ?? []) as Array<{ id: string; name: string }>) repNameById.set(r.id, r.name);
  }

  // Attempts within the week, grouped per order+day (latest outcome wins).
  const { data: attempts } = await supabase
    .from("order_contact_attempts")
    .select("order_id, channel, channels, customer_reached, outcome_code, attempted_at")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .gte("attempted_at", lagosStartOfDayUtc(weekStart))
    .lt("attempted_at", lagosStartOfDayUtc(addDays(weekStart, 6)))
    .order("attempted_at", { ascending: true });
  const byOrderDay = new Map<string, { attempts: number; calls: number; channels: Set<string>; reached: boolean; outcome: string | null }>();
  for (const a of (attempts ?? []) as Array<{ order_id: string; channel: string | null; channels: string[] | null; customer_reached: boolean | null; outcome_code: string | null; attempted_at: string }>) {
    const k = `${a.order_id}|${lagosDateKey(a.attempted_at)}`;
    const e = byOrderDay.get(k) ?? { attempts: 0, calls: 0, channels: new Set<string>(), reached: false, outcome: null };
    e.attempts++;
    const chans = Array.isArray(a.channels) && a.channels.length ? a.channels : (a.channel ? [a.channel] : []);
    for (const c of chans) e.channels.add(c);
    if (chans.includes("call")) e.calls++;
    if (a.customer_reached) e.reached = true;
    if (a.outcome_code) e.outcome = a.outcome_code; // ascending → last (latest) wins
    byOrderDay.set(k, e);
  }

  // Recorded misses (the authoritative red cells).
  const { data: misses } = await supabase
    .from("follow_up_misses")
    .select("order_id, miss_date")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .gte("miss_date", weekStart)
    .lte("miss_date", addDays(weekStart, 5));
  const missSet = new Set((misses ?? []).map((m) => `${m.order_id}|${m.miss_date}`));

  const todayObligation = new Map(board.obligations.map((o) => [o.orderId, o]));

  const rows = orderRows.map((o) => {
    const createdKey = lagosDateKey(o.created_at);
    const cells: Record<string, FollowUpGridCell> = {};
    const todayOb = todayObligation.get(o.id);
    for (const d of days) {
      const k = `${o.id}|${d.key}`;
      const logged = byOrderDay.get(k);
      if (logged) {
        cells[d.key] = { state: "logged", outcome: logged.outcome, channels: Array.from(logged.channels), calls: logged.calls, attempts: logged.attempts, reached: logged.reached };
      } else if (missSet.has(k)) {
        cells[d.key] = { state: "missed" };
      } else if (d.isToday && todayOb && !todayOb.paused && !todayOb.exempt && !todayOb.attended) {
        cells[d.key] = { state: "today" };
      }
    }
    return {
      orderId: o.id,
      customer: o.customer,
      phone: o.phone,
      productName: o.product_name,
      packageName: o.package_name,
      amount: o.amount,
      currency: o.currency,
      location: o.location,
      callOutcome: o.call_outcome,
      nextFollowUpAt: o.next_follow_up_at,
      buyerHealth: o.buyer_health,
      repId: o.assigned_rep_id,
      repName: o.assigned_rep_id ? repNameById.get(o.assigned_rep_id) ?? null : null,
      status: o.status,
      createdKey,
      cells
    };
  });

  return { weekStart, isCurrentWeek, days, summary, rows };
}
