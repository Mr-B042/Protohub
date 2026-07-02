import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { classifyFollowUpOutcome } from "./follow-up-outcomes.js";

// Orders in these raw statuses are the daily follow-up obligation set (mirrors the
// Follow-up Queue page). Delivered / Cancelled / Failed are terminal — no obligation.
const IN_SCOPE_STATUSES = ["New", "Confirmed", "Postponed"] as const;
export const FOLLOW_UP_MISS_AMOUNT = 50;
// Go-live: the ₦50 miss penalty only applies from this working day on. Days before
// it (the backlog that existed when the system launched) are never charged.
export const FOLLOW_UP_KPI_START_DATE = "2026-07-01"; // Wednesday — reset old test charges
// When the customer's last outcome is "unreachable" they must be called this many
// chargeable chase slots in the day for the order to count as attended.
const REQUIRED_CALLS_WHEN_UNREACHABLE = 2;
const UNREACHABLE_OUTCOME_GROUP = "unreachable";

// Africa/Lagos is UTC+1 year-round (no DST). Work the calendar in Lagos local time.
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

export function lagosDateKey(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  return new Date(d.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}
// Current hour (0–23) in Lagos. Used to lock the "later" chase slot before noon.
export function lagosHourNow(): number {
  return new Date(Date.now() + LAGOS_OFFSET_MS).getUTCHours();
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

// A rep can mark a customer as Ready while the order is being processed. That
// should not immediately create another same-day "log this order" obligation.
// If the order is still Ready on the next working day, it returns to the Daily
// Log so the rep keeps the customer warm until dispatch/delivery.
const READY_GRACE_STATUSES = new Set(["Confirmed", "In Process"]);
const READY_GRACE_OUTCOMES = new Set(["ready", "ready now", "confirmed"]);
function isReadyOutcome(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (READY_GRACE_OUTCOMES.has(normalized)) return true;
  const latestLine = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean).pop() ?? "";
  const latestText = latestLine.replace(/^\d{1,2}\/\d{1,2}\s*:\s*/, "").trim();
  return READY_GRACE_OUTCOMES.has(latestText) || latestText.startsWith("ready ");
}
function hasReadySameDayGrace(order: { status: string; call_outcome?: string | null; updated_at?: string | null }, dateKey: string): boolean {
  if (!READY_GRACE_STATUSES.has(order.status)) return false;
  if (!isReadyOutcome(order.call_outcome)) return false;
  return !!order.updated_at && lagosDateKey(order.updated_at) === dateKey;
}

// Some old orders still have raw status "Confirmed" while the human-facing status
// is terminal from the latest customer note ("Refused", "Not interested", etc.).
// Those should never appear in Daily Follow-up Log or generate charges.
const TERMINAL_FOLLOW_UP_OUTCOME_RE = /\b(refused|rejected|not interested|wrong number|out of stock|out of coverage|no coverage|failed delivery|cancelled|canceled)\b/i;
function latestOutcomeText(value: string | null | undefined): string {
  const latestLine = String(value ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean).pop() ?? "";
  return latestLine.replace(/^\d{1,2}\/\d{1,2}\s*:\s*/, "").trim();
}
function hasTerminalCustomerOutcome(value: string | null | undefined): boolean {
  const latest = latestOutcomeText(value);
  if (!latest) return false;
  return TERMINAL_FOLLOW_UP_OUTCOME_RE.test(latest) || classifyFollowUpOutcome({ outcomeCode: latest }).outcomeGroup === "closed_loss";
}

// "Chase mode": an unreachable order (buyer_health watch/at_risk) must be tried in
// TWO chargeable same-day slots — morning, then one later attempt (afternoon OR
// evening) — stopping once the customer is reached (a "progress" outcome). Each
// missed required slot is its own ₦50. A reachable order just needs one log a day.
const FOLLOW_UP_SLOTS = ["morning", "later"] as const;
export type FollowUpSlot = typeof FOLLOW_UP_SLOTS[number];
const CHASE_HEALTH = new Set(["watch", "at_risk"]);
function lagosHourOf(iso: string): number {
  return new Date(new Date(iso).getTime() + LAGOS_OFFSET_MS).getUTCHours();
}
function slotOfHour(h: number): FollowUpSlot {
  return h < 12 ? "morning" : "later";
}
function attemptedAtForFollowUpSlot(dateKey: string, slot: FollowUpSlot | null | undefined): string | null {
  if (!slot) return null;
  // The daily grid derives slot status from attempted_at. Use a stable Lagos
  // time inside the intended chargeable slot so a rep can explicitly clear
  // Morning or the combined Afternoon/Evening slot, even if they save late.
  return `${dateKey}T${slot === "morning" ? "09:30" : "13:30"}:00+01:00`;
}
function normalizeMissSlot(slot: string | null | undefined): string {
  // Legacy rows may still have the old afternoon/evening split. From now on
  // either one is treated as the single combined later charge slot.
  return slot === "afternoon" || slot === "evening" ? "later" : slot || "day";
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
  readyGrace: boolean;       // marked Ready today → starts asking again tomorrow

  requiredCalls: number;     // 2 when the customer is unreachable, else 1
  attemptsToday: number;
  callsToday: number;
  channelsToday: string[];
  customerReachedToday: boolean;
  attended: boolean;
  chase: boolean;            // unreachable → morning + later same-day slots
  slots: Record<FollowUpSlot, "done" | "todo" | "na"> | null;
  owedSlots: string[];       // what's still owed today (slot names, or ["day"] for normal)
  owedCount: number;
};

export type FollowUpBoard = {
  date: string;
  workingDay: boolean;
  obligations: FollowUpObligation[];
  dueCount: number;
  attendedCount: number;
  unattendedCount: number;
  atRiskAmount: number;
};

async function computeBoard(orgId: string, dateKey: string, repId?: string | null): Promise<FollowUpBoard> {
  if (!isWorkingDay(dateKey)) {
    return { date: dateKey, workingDay: false, obligations: [], dueCount: 0, attendedCount: 0, unattendedCount: 0, atRiskAmount: 0 };
  }

  let orderQuery = supabase
    .from("orders")
    .select("id, assigned_rep_id, customer, phone, status, created_at, updated_at, next_follow_up_at, scheduled_at, scheduled_date, call_outcome, buyer_health")
    .eq("org_id", orgId)
    .in("status", IN_SCOPE_STATUSES as unknown as string[])
    .not("assigned_rep_id", "is", null);
  if (repId) orderQuery = orderQuery.eq("assigned_rep_id", repId);
  const { data: orders } = await orderQuery;
  const rawOrderRows = (orders ?? []) as Array<{
    id: string; assigned_rep_id: string | null; customer: string | null; phone: string | null;
    status: string; created_at: string; updated_at: string | null; next_follow_up_at: string | null; scheduled_at: string | null; scheduled_date: string | null;
    call_outcome: string | null; buyer_health: string | null;
  }>;
  const orderRows = rawOrderRows.filter((o) => !hasTerminalCustomerOutcome(o.call_outcome));
  if (orderRows.length === 0) {
    return { date: dateKey, workingDay: true, obligations: [], dueCount: 0, attendedCount: 0, unattendedCount: 0, atRiskAmount: 0 };
  }
  const orderIds = orderRows.map((o) => o.id);

  // Rep names
  const repIds = Array.from(new Set(orderRows.map((o) => o.assigned_rep_id).filter(Boolean))) as string[];
  const repNameById = new Map<string, string>();
  if (repIds.length) {
    const { data: reps } = await supabase.from("users").select("id, name").in("id", repIds);
    for (const r of (reps ?? []) as Array<{ id: string; name: string }>) repNameById.set(r.id, r.name);
  }

  // Today's attempts, grouped per order — incl. which same-day slots are done and
  // which slots reached the customer (a "progress" outcome stops the chase).
  const startUtc = lagosStartOfDayUtc(dateKey);
  const { data: todayAttempts } = await supabase
    .from("order_contact_attempts")
    .select("order_id, channel, channels, customer_reached, outcome_group, attempted_at")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .gte("attempted_at", startUtc);
  type TodayAgg = { attempts: number; calls: number; channels: Set<string>; reached: boolean; slotsDone: Set<FollowUpSlot>; positiveSlots: Set<FollowUpSlot> };
  const todayByOrder = new Map<string, TodayAgg>();
  for (const a of (todayAttempts ?? []) as Array<{ order_id: string; channel: string | null; channels: string[] | null; customer_reached: boolean | null; outcome_group: string | null; attempted_at: string }>) {
    const e = todayByOrder.get(a.order_id) ?? { attempts: 0, calls: 0, channels: new Set<string>(), reached: false, slotsDone: new Set<FollowUpSlot>(), positiveSlots: new Set<FollowUpSlot>() };
    e.attempts++;
    const chans = Array.isArray(a.channels) && a.channels.length ? a.channels : (a.channel ? [a.channel] : []);
    for (const c of chans) e.channels.add(c);
    if (chans.includes("call")) e.calls++;
    if (a.customer_reached) e.reached = true;
    const slot = slotOfHour(lagosHourOf(a.attempted_at));
    e.slotsDone.add(slot);
    if (a.outcome_group === "progress") e.positiveSlots.add(slot);
    todayByOrder.set(a.order_id, e);
  }

  // Latest outcome group per order (drives the unreachable chase-slot rule).
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
    const readyGrace = hasReadySameDayGrace(o, dateKey);
    const t = todayByOrder.get(o.id);
    const requiredCalls = latestGroupByOrder.get(o.id) === UNREACHABLE_OUTCOME_GROUP ? REQUIRED_CALLS_WHEN_UNREACHABLE : 1;
    const attemptsToday = t?.attempts ?? 0;
    const callsToday = t?.calls ?? 0;

    // Chase = unreachable order (morning + one later same-day slot). Otherwise
    // one log a day.
    const chase = !paused && !exempt && !readyGrace && CHASE_HEALTH.has(o.buyer_health ?? "");
    let slots: Record<FollowUpSlot, "done" | "todo" | "na"> | null = null;
    let owedSlots: string[] = [];
    if (paused || exempt || readyGrace) {
      // not due today → nothing owed
    } else if (chase) {
      const done = t?.slotsDone ?? new Set<FollowUpSlot>();
      const positive = t?.positiveSlots ?? new Set<FollowUpSlot>();
      slots = { morning: "todo", later: "todo" };
      let reached = false;
      for (const s of FOLLOW_UP_SLOTS) {
        if (reached) { slots[s] = "na"; continue; } // customer reached earlier → no more slots required
        if (done.has(s)) { slots[s] = "done"; if (positive.has(s)) reached = true; }
        else { slots[s] = "todo"; owedSlots.push(s); }
      }
    } else {
      if (attemptsToday < 1) owedSlots = ["day"];
    }
    const attended = (paused || exempt || readyGrace) ? true : owedSlots.length === 0;
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
      readyGrace,
      requiredCalls,
      attemptsToday,
      callsToday,
      channelsToday: t ? Array.from(t.channels) : [],
      customerReachedToday: t?.reached ?? false,
      attended,
      chase,
      slots,
      owedSlots,
      owedCount: owedSlots.length
    };
  });

  const due = obligations.filter((o) => !o.paused && !o.exempt && !o.readyGrace);
  const attendedCount = due.filter((o) => o.attended).length;
  const atRiskAmount = due.reduce((sum, o) => sum + o.owedCount, 0) * FOLLOW_UP_MISS_AMOUNT;
  return {
    date: dateKey,
    workingDay: true,
    obligations,
    dueCount: due.length,
    attendedCount,
    unattendedCount: due.length - attendedCount,
    atRiskAmount
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
  if (key < FOLLOW_UP_KPI_START_DATE) return { recorded: 0 }; // before go-live → never charged
  const board = await computeBoard(orgId, key);
  // One miss row per owed slot. Chase orders can owe up to 2 (morning + later);
  // a normal order owes one "day". Slot is part of the unique key.
  const rows = board.obligations
    .filter((o) => !o.paused && !o.exempt && !o.readyGrace && o.repId && o.owedSlots.length > 0)
    .flatMap((o) => o.owedSlots.map((slot) => ({
      org_id: orgId,
      order_id: o.orderId,
      rep_id: o.repId,
      rep_name: o.repName,
      miss_date: key,
      day_number: o.dayNumber,
      slot,
      reason: slot === "day" ? (o.attemptsToday > 0 ? "insufficient_calls" : "no_log") : `missed_${slot}`,
      amount: FOLLOW_UP_MISS_AMOUNT,
      state: "pending"
    })));
  if (rows.length === 0) return { recorded: 0 };
  const { error } = await supabase
    .from("follow_up_misses")
    .upsert(rows, { onConflict: "order_id,miss_date,slot", ignoreDuplicates: true });
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
  outcomeGroup?: string | null,
  promisedTime?: string | null,
  followUpSlot?: FollowUpSlot | null
): Promise<{ ok: true }> {
  const { data: order } = await supabase
    .from("orders")
    .select("id, assigned_rep_id, call_outcome, follow_up_attempt_count")
    .eq("org_id", orgId)
    .eq("id", orderId)
    .maybeSingle();
  if (!order) throw new Error("Order not found.");

  const actualNowIso = new Date().toISOString();
  const todayKey = lagosDateKey(actualNowIso);
  const entry = `${todayKey.slice(8, 10)}/${todayKey.slice(5, 7)}: ${text}`;
  const existing = ((order as { call_outcome?: string | null }).call_outcome ?? "").trim();
  const newCallOutcome = existing ? `${existing}\n${entry}` : entry;
  const primary = channels.includes("call") ? "call" : channels.includes("sms") ? "sms" : channels.some((c) => c.startsWith("whatsapp")) ? "whatsapp" : "manual";
  const attemptedAtIso = attemptedAtForFollowUpSlot(todayKey, followUpSlot) ?? actualNowIso;

  await supabase.from("order_contact_attempts").insert({
    org_id: orgId,
    order_id: orderId,
    rep_id: repId ?? (order as { assigned_rep_id?: string | null }).assigned_rep_id ?? null,
    attempted_at: attemptedAtIso,
    channel: primary,
    channels,
    attempt_type: "fresh_follow_up",
    outcome_code: text,
    recovery_bucket: recoveryBucket ?? null,
    outcome_group: outcomeGroup ?? null
  });

  const update: Record<string, unknown> = {
    call_outcome: newCallOutcome,
    last_contact_attempt_at: actualNowIso,
    last_contact_attempt_outcome: text,
    follow_up_attempt_count: (Number((order as { follow_up_attempt_count?: number }).follow_up_attempt_count) || 0) + 1
  };
  if (promisedDate) {
    const t = promisedTime && /^\d{2}:\d{2}$/.test(promisedTime) ? promisedTime : "09:00";
    update.next_follow_up_at = `${promisedDate}T${t}:00+01:00`;
  }

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
  slots?: Record<FollowUpSlot, "done" | "todo" | "missed" | "na"> | null;
  entries?: Array<{
    attemptedAt: string;
    outcome: string | null;
    channels: string[];
    reached: boolean;
    slot: FollowUpSlot;
  }>;
};
export type FollowUpGrid = {
  weekStart: string;
  isCurrentWeek: boolean;
  penaltyStartDate: string;
  penaltyActive: boolean;
  missAmount: number;
  days: Array<{ key: string; label: string; isToday: boolean }>;
  summary: { attendedToday: number; dueToday: number; unattendedToday: number; workingDayToday: boolean; atRiskAmount: number };
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
    todayChase: boolean;
    todaySlots: Record<FollowUpSlot, "done" | "todo" | "na"> | null;
    todayReadyGrace: boolean;
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
    workingDayToday: board.workingDay,
    atRiskAmount: board.atRiskAmount
  };

  let orderQuery = supabase
    .from("orders")
    .select("id, assigned_rep_id, customer, phone, status, created_at, updated_at, next_follow_up_at, scheduled_at, scheduled_date, product_name, package_name, amount, currency, location, call_outcome, buyer_health")
    .eq("org_id", orgId)
    .in("status", IN_SCOPE_STATUSES as unknown as string[])
    .not("assigned_rep_id", "is", null);
  if (repId) orderQuery = orderQuery.eq("assigned_rep_id", repId);
  const { data: orders } = await orderQuery;
  const rawOrderRows = (orders ?? []) as Array<{
    id: string; assigned_rep_id: string | null; customer: string | null; phone: string | null;
    status: string; created_at: string; updated_at: string | null; next_follow_up_at: string | null; scheduled_at: string | null; scheduled_date: string | null;
    product_name: string | null; package_name: string | null; amount: number | null; currency: string | null; location: string | null;
    call_outcome: string | null; buyer_health: string | null;
  }>;
  const orderRows = rawOrderRows.filter((o) => !hasTerminalCustomerOutcome(o.call_outcome));
  const penaltyMeta = { penaltyStartDate: FOLLOW_UP_KPI_START_DATE, penaltyActive: todayKey >= FOLLOW_UP_KPI_START_DATE, missAmount: FOLLOW_UP_MISS_AMOUNT };
  if (orderRows.length === 0) return { weekStart, isCurrentWeek, ...penaltyMeta, days, summary, rows: [] };
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
  const byOrderDay = new Map<string, {
    attempts: number;
    calls: number;
    channels: Set<string>;
    reached: boolean;
    outcome: string | null;
    entries: Array<{ attemptedAt: string; outcome: string | null; channels: string[]; reached: boolean; slot: FollowUpSlot }>;
  }>();
  for (const a of (attempts ?? []) as Array<{ order_id: string; channel: string | null; channels: string[] | null; customer_reached: boolean | null; outcome_code: string | null; attempted_at: string }>) {
    const k = `${a.order_id}|${lagosDateKey(a.attempted_at)}`;
    const e = byOrderDay.get(k) ?? { attempts: 0, calls: 0, channels: new Set<string>(), reached: false, outcome: null, entries: [] };
    e.attempts++;
    const chans = Array.isArray(a.channels) && a.channels.length ? a.channels : (a.channel ? [a.channel] : []);
    for (const c of chans) e.channels.add(c);
    if (chans.includes("call")) e.calls++;
    if (a.customer_reached) e.reached = true;
    if (a.outcome_code) e.outcome = a.outcome_code; // ascending → last (latest) wins
    const slot = slotOfHour(lagosHourOf(a.attempted_at));
    e.entries.push({
      attemptedAt: a.attempted_at,
      outcome: a.outcome_code,
      channels: chans,
      reached: Boolean(a.customer_reached),
      slot
    });
    byOrderDay.set(k, e);
  }

  // Recorded misses (the authoritative red cells).
  const { data: misses } = await supabase
    .from("follow_up_misses")
    .select("order_id, miss_date, slot")
    .eq("org_id", orgId)
    .in("order_id", orderIds)
    .gte("miss_date", weekStart > FOLLOW_UP_KPI_START_DATE ? weekStart : FOLLOW_UP_KPI_START_DATE)
    .lte("miss_date", addDays(weekStart, 5));
  const missSet = new Set((misses ?? []).map((m) => `${m.order_id}|${m.miss_date}`));
  const missSlotsByOrderDay = new Map<string, Set<string>>();
  for (const m of (misses ?? []) as Array<{ order_id: string; miss_date: string; slot?: string | null }>) {
    const k = `${m.order_id}|${m.miss_date}`;
    const slots = missSlotsByOrderDay.get(k) ?? new Set<string>();
    slots.add(normalizeMissSlot(m.slot));
    missSlotsByOrderDay.set(k, slots);
  }

  const todayObligation = new Map(board.obligations.map((o) => [o.orderId, o]));

  const rows = orderRows.map((o) => {
    const createdKey = lagosDateKey(o.created_at);
    const cells: Record<string, FollowUpGridCell> = {};
    const todayOb = todayObligation.get(o.id);
    for (const d of days) {
      const k = `${o.id}|${d.key}`;
      const logged = byOrderDay.get(k);
      const missedSlots = missSlotsByOrderDay.get(k);
      const slotStatuses = (() => {
        if (d.isToday && todayOb?.chase && todayOb.slots) return todayOb.slots;
        const doneSlots = new Set((logged?.entries ?? []).map((entry) => entry.slot));
        const hasSlotMiss = Array.from(missedSlots ?? []).some((slot) => slot !== "day");
        const shouldShowSlots = doneSlots.size > 1 || hasSlotMiss || CHASE_HEALTH.has(o.buyer_health ?? "");
        if (!shouldShowSlots) return null;
        return FOLLOW_UP_SLOTS.reduce((acc, slot) => {
          acc[slot] = doneSlots.has(slot)
            ? "done"
            : missedSlots?.has(slot)
              ? "missed"
              : "na";
          return acc;
        }, {} as Record<FollowUpSlot, "done" | "todo" | "missed" | "na">);
      })();
      if (logged) {
        cells[d.key] = {
          state: "logged",
          outcome: logged.outcome,
          channels: Array.from(logged.channels),
          calls: logged.calls,
          attempts: logged.attempts,
          reached: logged.reached,
          slots: slotStatuses,
          entries: logged.entries
        };
      } else if (missSet.has(k)) {
        cells[d.key] = { state: "missed", slots: slotStatuses };
      } else if (d.isToday && todayOb && !todayOb.paused && !todayOb.exempt && !todayOb.readyGrace && !todayOb.attended) {
        cells[d.key] = { state: "today", slots: slotStatuses };
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
      todayChase: todayOb?.chase ?? false,
      todaySlots: todayOb?.slots ?? null,
      todayReadyGrace: todayOb?.readyGrace ?? hasReadySameDayGrace(o, todayKey),
      repId: o.assigned_rep_id,
      repName: o.assigned_rep_id ? repNameById.get(o.assigned_rep_id) ?? null : null,
      status: o.status,
      createdKey,
      cells
    };
  });

  return { weekStart, isCurrentWeek, ...penaltyMeta, days, summary, rows };
}
