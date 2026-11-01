import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { alertRecipients } from "./notification-routing.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import { weekEndFromStart, addDaysToDateKey } from "./sales-bonus-engine.js";
import { LATE_SEND_FROM, LATE_SEND_MINUTES, lagosDateOf, lateSendWindow, minutesLate, workingMinutesBetween } from "./late-send-rules.js";

// ── Order not sent out within 15 working minutes (Bright, 23 Oct 2026) ─────
// Rules (hours, Monday 11am, what "sent" means): late-send-rules.ts.
//   - The alert job tells Admin / Manager / Owner once per late order
//     (Settings → Alert routing, key order_late_send).
//   - The weekly review lists each rep's late orders. NOTHING is charged by
//     the system: Admin / Manager / Owner type an amount and press Fine, which
//     saves an ordinary rep_penalties row (type LATE_SEND_FINE_TYPE).

export const LATE_SEND_ALERT_TYPE = "order_late_send";
export const LATE_SEND_FINE_TYPE = "late_order_send";

export type LateSendOrder = {
  orderId: string; customer: string; arrivedAt: string; clockStart: string; deadline: string;
  sentAt: string | null; sentStatus: string | null; minutesLate: number;
  product: string; quantity: number; amount: number; state: string;
  /** When the customer placed it, and when it was given to this rep (null = never re-assigned). */
  placedAt: string; assignedAt: string | null;
  /** Who moved it out of New (may not be the rep). */
  sentByName: string | null; sentByRep: boolean;
  /** Working time only (nights and Sundays skipped): from clock start to sent out (or now), and past the 15 minutes. */
  workingMinutesTaken: number; workingMinutesLate: number;
};

/**
 * When the order reached the rep: the latest of when it was placed, when it
 * was (re)assigned, and when it was revealed (Product Launch: a Silent Test
 * order only reaches its rep at the switch to Soft Launch).
 */
function arrivedAtMs(order: any) {
  const placed = Date.parse(order.original_created_at ?? order.created_at);
  const assigned = order.assigned_at ? Date.parse(order.assigned_at) : NaN;
  const revealed = order.revealed_at ? Date.parse(order.revealed_at) : NaN;
  return Math.max(placed, Number.isFinite(assigned) ? assigned : placed, Number.isFinite(revealed) ? revealed : placed);
}

/** Placed in the window, or revealed in it (a Silent Test order placed earlier). */
const placedOrRevealedBetween = (fromIso: string, toIso?: string) => {
  const from = new Date(fromIso).toISOString();
  if (!toIso) return `created_at.gte.${from},revealed_at.gte.${from}`;
  const to = new Date(toIso).toISOString();
  return `and(created_at.gte.${from},created_at.lte.${to}),and(revealed_at.gte.${from},revealed_at.lte.${to})`;
};

const fromIso = () => `${LATE_SEND_FROM}T00:00:00+01:00`;

/** Only Sales Reps are timed (an order sitting with an Admin is not a rep's lateness). */
async function salesRepIds(orgId: string) {
  const { data, error } = await supabase.from("users").select("id").eq("org_id", orgId).eq("role", "Sales Rep");
  if (error) throw error;
  return new Set((data ?? []).map((row: any) => String(row.id)));
}

// ── Alert job ───────────────────────────────────────────────────────────────

export async function runLateSendAlerts(nowMs = Date.now()) {
  const { data: orgs, error } = await supabase.from("organizations").select("id");
  if (error) throw error;
  let sent = 0;
  const since = new Date(Math.max(Date.parse(fromIso()), nowMs - 4 * 24 * 3600_000)).toISOString();
  for (const org of orgs ?? []) {
    const orgId = String(org.id);
    const { data: orders, error: orderError } = await supabase.from("orders")
      .select("id, customer, product_name, assigned_rep_id, created_at, original_created_at, assigned_at, revealed_at")
      .eq("org_id", orgId).eq("status", "New").not("assigned_rep_id", "is", null)
      // Silent Test orders are hidden from the rep, so they are never late.
      .neq("launch_stage", "silent")
      .or(placedOrRevealedBetween(since)).limit(1000);
    if (orderError) { logger.warn("late-send order query failed", { orgId, error: orderError.message }); continue; }
    const salesReps = await salesRepIds(orgId);
    const late = (orders ?? []).filter((order: any) => {
      if (!salesReps.has(String(order.assigned_rep_id))) return false;
      const arrived = arrivedAtMs(order);
      return arrived >= Date.parse(fromIso()) && lateSendWindow(arrived).deadlineMs < nowMs;
    });
    if (late.length === 0) continue;

    // Once per order: skip any already announced.
    const told = new Set<string>();
    const ids = late.map((order: any) => String(order.id));
    for (let i = 0; i < ids.length; i += 200) {
      const { data: rows } = await supabase.from("system_notifications").select("order_id")
        .eq("org_id", orgId).eq("type", LATE_SEND_ALERT_TYPE).in("order_id", ids.slice(i, i + 200));
      for (const row of rows ?? []) told.add(String(row.order_id));
    }
    const fresh = late.filter((order: any) => !told.has(String(order.id)));
    if (fresh.length === 0) continue;

    const repIds = [...new Set(fresh.map((order: any) => String(order.assigned_rep_id)))];
    const { data: reps } = await supabase.from("users").select("id, name").eq("org_id", orgId).in("id", repIds);
    const repName = new Map((reps ?? []).map((rep: any) => [String(rep.id), String(rep.name ?? "A sales rep")]));
    const branding = await getOrgPushBranding(orgId);

    for (const order of fresh as any[]) {
      const repId = String(order.assigned_rep_id);
      const { recipients, push } = await alertRecipients(orgId, LATE_SEND_ALERT_TYPE, repId);
      if (recipients.size === 0) continue;
      const deadline = lateSendWindow(arrivedAtMs(order)).deadlineMs;
      const name = repName.get(repId) ?? "A sales rep";
      const title = `Order #${order.id} not sent out in ${LATE_SEND_MINUTES} min`;
      const message = `${name} has not moved this order from New. ${order.customer ?? ""}${order.product_name ? ` · ${order.product_name}` : ""} · ${minutesLate(deadline, null, nowMs)} min late`;
      const link = (role: string) => role === "Sales Rep" ? `/dashboard/sales-rep/orders/${order.id}` : `/dashboard/admin/orders/${order.id}`;
      const { error: insertError } = await supabase.from("system_notifications").insert([...recipients.entries()].map(([recipientId, role]) => ({
        org_id: orgId, recipient_id: recipientId, type: LATE_SEND_ALERT_TYPE, title, message, link: link(role), order_id: String(order.id), read: false
      })));
      if (insertError) { logger.warn("late-send alert insert failed", { orgId, orderId: order.id, error: insertError.message }); continue; }
      sent += 1;
      if (push) await Promise.all([...recipients.entries()].map(([recipientId, role]) =>
        sendPushToUser(orgId, recipientId, {
          title, body: message, kind: LATE_SEND_ALERT_TYPE, url: link(role), tag: `late-send-${order.id}`,
          brandName: branding.brandName, brandLogo: branding.brandLogo
        }).catch((pushError) => logger.warn("late-send push failed", { orgId, orderId: order.id, error: String(pushError) }))
      ));
    }
  }
  return { sent };
}

// ── Weekly review list ──────────────────────────────────────────────────────

/** Per rep: orders whose deadline fell in this week and that left New late, or have not left it yet. */
export async function lateSendsFor(orgId: string, weekStart: string, nowMs = Date.now()) {
  const weekEnd = weekEndFromStart(weekStart);
  const out: Record<string, { orders: LateSendOrder[]; fines: Array<{ id: string; amount: number; reason: string; byName: string; createdAt: string }> }> = {};
  if (weekEnd < LATE_SEND_FROM) return out;
  // A night order placed up to 3 days earlier (Saturday night → Monday) can fall due this week.
  const placedFrom = `${addDaysToDateKey(weekStart, -3)}T00:00:00+01:00`;
  const { data: orders, error } = await supabase.from("orders")
    .select("id, customer, status, assigned_rep_id, created_at, original_created_at, assigned_at, revealed_at, product_name, quantity, amount, state")
    .eq("org_id", orgId).not("assigned_rep_id", "is", null)
    .neq("launch_stage", "silent")
    .or(placedOrRevealedBetween(placedFrom, `${weekEnd}T23:59:59+01:00`))
    .limit(5000);
  if (error) throw error;
  const reps = await salesRepIds(orgId);
  const inWeek = (orders ?? []).filter((order: any) => reps.has(String(order.assigned_rep_id))).map((order: any) => ({ order, window: lateSendWindow(arrivedAtMs(order)), arrived: arrivedAtMs(order) }))
    .filter(({ window, arrived }) => {
      const day = lagosDateOf(window.deadlineMs);
      return arrived >= Date.parse(fromIso()) && day >= weekStart && day <= weekEnd && window.deadlineMs < nowMs;
    });

  // First status change of each order.
  const audit = new Map<string, Array<{ from: string | null; to: string | null; at: string; by: string | null }>>();
  const ids = inWeek.map(({ order }) => String(order.id));
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows, error: auditError } = await supabase.from("order_audit").select("order_id, from_status, to_status, created_at, changed_by")
      .eq("org_id", orgId).in("order_id", ids.slice(i, i + 200)).order("created_at", { ascending: true }).limit(10000);
    if (auditError) throw auditError;
    for (const row of rows ?? []) {
      const list = audit.get(String(row.order_id)) ?? [];
      list.push({ from: row.from_status ?? null, to: row.to_status ?? null, at: String(row.created_at), by: row.changed_by ? String(row.changed_by) : null });
      audit.set(String(row.order_id), list);
    }
  }

  const senders = new Set<string>();
  for (const rows of audit.values()) for (const row of rows) if (row.by) senders.add(row.by);
  const { data: senderRows, error: senderError } = senders.size
    ? await supabase.from("users").select("id, name").in("id", [...senders])
    : { data: [], error: null };
  if (senderError) throw senderError;
  const senderName = new Map((senderRows ?? []).map((row: any) => [String(row.id), String(row.name ?? "")]));

  for (const { order, window } of inWeek) {
    const rows = audit.get(String(order.id)) ?? [];
    // Created straight into another status (e.g. a rep typed in a confirmed order): nothing to send.
    const created = rows.find((row) => row.from === null);
    if (created && created.to && created.to !== "New") continue;
    const left = rows.find((row) => row.from === "New" && row.to && row.to !== "New");
    if (!left && order.status !== "New") continue; // left New with no record: cannot judge
    const sentAtMs = left ? Date.parse(left.at) : null;
    const late = minutesLate(window.deadlineMs, sentAtMs, nowMs);
    if (late <= 0) continue;
    const repId = String(order.assigned_rep_id);
    (out[repId] ?? (out[repId] = { orders: [], fines: [] })).orders.push({
      orderId: String(order.id), customer: String(order.customer ?? ""),
      arrivedAt: new Date(arrivedAtMs(order)).toISOString(),
      clockStart: new Date(window.startMs).toISOString(), deadline: new Date(window.deadlineMs).toISOString(),
      sentAt: left ? left.at : null, sentStatus: left?.to ?? null, minutesLate: late,
      product: String(order.product_name ?? ""), quantity: Number(order.quantity ?? 0), amount: Number(order.amount ?? 0), state: String(order.state ?? ""),
      placedAt: new Date(Date.parse(order.original_created_at ?? order.created_at)).toISOString(),
      // When the clock started, if not at placing: a reassignment or a Product Launch reveal.
      assignedAt: arrivedAtMs(order) > Date.parse(order.original_created_at ?? order.created_at) ? new Date(arrivedAtMs(order)).toISOString() : null,
      sentByName: left?.by ? senderName.get(left.by) ?? null : null,
      sentByRep: !left?.by || left.by === repId,
      workingMinutesTaken: workingMinutesBetween(window.startMs, sentAtMs ?? nowMs),
      workingMinutesLate: workingMinutesBetween(window.deadlineMs, sentAtMs ?? nowMs)
    });
  }
  for (const entry of Object.values(out)) entry.orders.sort((a, b) => a.deadline.localeCompare(b.deadline));

  const { data: fines, error: fineError } = await supabase.from("rep_penalties")
    .select("id, rep_id, amount, reason, by_name, created_at")
    .eq("org_id", orgId).eq("type", LATE_SEND_FINE_TYPE).eq("week_start", weekStart);
  if (fineError) throw fineError;
  for (const fine of fines ?? []) {
    const repId = String(fine.rep_id);
    (out[repId] ?? (out[repId] = { orders: [], fines: [] })).fines.push({
      id: String(fine.id), amount: Number(fine.amount ?? 0), reason: String(fine.reason ?? ""), byName: String(fine.by_name ?? ""), createdAt: String(fine.created_at)
    });
  }
  return out;
}
