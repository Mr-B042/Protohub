import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";

type DueReminderOrder = {
  id: string;
  org_id: string;
  customer: string;
  phone?: string | null;
  assigned_rep_id?: string | null;
  product_name: string;
  package_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  status: string;
  outcome_code?: string | null;
  outcome_category?: string | null;
  scheduled_date?: string | null;
  scheduled_at?: string | null;
  next_action_type?: string | null;
  next_action_at?: string | null;
  next_action_note?: string | null;
  response?: string | null;
  notes?: unknown;
  timeline_notes?: unknown;
};

type TimelineReminderNote = {
  id: string;
  text: string;
  followUpDate?: string;
  followUpAt?: string;
};

const ACTIVE_ORDER_STATUSES = ["Confirmed", "In Process", "Dispatched", "Postponed"] as const;
const ORDER_FOLLOW_UP_TYPE = "order_follow_up";

const orderDisplayName = (order: Pick<DueReminderOrder, "product_name" | "package_name">) =>
  order.package_name?.trim()
    ? `${order.product_name} — ${order.package_name}`
    : order.product_name;

const formatNotificationMoney = (amount?: number | null, currency?: string | null) => {
  if (typeof amount !== "number" || Number.isNaN(amount)) return null;
  const safeCurrency = currency?.trim() || "NGN";
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${safeCurrency} ${Math.round(amount).toLocaleString("en-NG")}`;
  }
};

const orderLinkForRole = (role: string, orderId: string) =>
  role === "Sales Rep"
    ? `/dashboard/sales-rep/orders/${orderId}`
    : `/dashboard/admin/orders/${orderId}`;

const toDateKey = (value: string) => value.slice(0, 10);

const formatReminderLabel = (value?: string | null) => {
  if (!value) return "today";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`).toLocaleDateString("en-NG", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(parsed);
};

const trimText = (value: string, max = 120) =>
  value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;

function parseLegacyPlannedMetadata(value: unknown): { timelineNotes?: unknown[] } {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return { timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined };
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    return { timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined };
  } catch {
    return {};
  }
}

function normalizeTimelineReminderNotes(order: DueReminderOrder): TimelineReminderNote[] {
  const source = Array.isArray(order.timeline_notes)
    ? order.timeline_notes
    : parseLegacyPlannedMetadata(order.notes).timelineNotes ?? [];

  return source
    .filter((note): note is Record<string, unknown> => !!note && typeof note === "object" && !Array.isArray(note))
    .map((note, index) => ({
      id: typeof note.id === "string" && note.id ? note.id : `note-${index + 1}`,
      text: typeof note.text === "string" ? note.text : "",
      followUpDate: typeof note.followUpDate === "string" ? note.followUpDate : undefined,
      followUpAt: typeof note.followUpAt === "string" ? note.followUpAt : undefined
    }))
    .filter((note) => Boolean(note.followUpAt || note.followUpDate));
}

function dueIsoMoment(value: string | null | undefined, now: Date): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.getTime() <= now.getTime() ? parsed.toISOString() : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value <= toDateKey(now.toISOString())) {
    return `${value}T08:00:00.000Z`;
  }
  return null;
}

function withinReminderWindow(iso: string, now: Date, maxAgeHours = 36) {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return false;
  return ts <= now.getTime() && ts >= now.getTime() - maxAgeHours * 60 * 60 * 1000;
}

async function buildRecipients(orgId: string, assignedRepId?: string | null) {
  const recipients = new Map<string, string>();

  const { data: roleUsers, error } = await supabase
    .from("users")
    .select("id, role")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("role", ["Owner", "Admin"]);

  if (error) {
    logger.warn("follow-up notification recipient query failed", { orgId, error: error.message });
  }

  if (roleUsers) {
    for (const user of roleUsers) {
      recipients.set(user.id, user.role);
    }
  }

  if (assignedRepId && !recipients.has(assignedRepId)) {
    const { data: repUser, error: repError } = await supabase
      .from("users")
      .select("id, role")
      .eq("org_id", orgId)
      .eq("active", true)
      .eq("id", assignedRepId)
      .maybeSingle();

    if (repError) {
      logger.warn("follow-up notification rep query failed", { orgId, assignedRepId, error: repError.message });
    } else if (repUser?.id) {
      recipients.set(repUser.id, repUser.role);
    }
  }

  return recipients;
}

async function reminderAlreadyNotified(
  orgId: string,
  recipientId: string,
  orderId: string,
  title: string,
  message: string
) {
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("system_notifications")
    .select("id")
    .eq("org_id", orgId)
    .eq("recipient_id", recipientId)
    .eq("order_id", orderId)
    .eq("type", ORDER_FOLLOW_UP_TYPE)
    .eq("title", title)
    .eq("message", message)
    .gte("created_at", since)
    .limit(1);

  if (error) {
    logger.warn("follow-up notification dedupe failed", {
      orgId,
      recipientId,
      orderId,
      error: error.message
    });
    return false;
  }

  return (data?.length ?? 0) > 0;
}

async function notifyRecipients(
  orgId: string,
  order: DueReminderOrder,
  title: string,
  message: string,
  tag: string
) {
  const recipients = await buildRecipients(orgId, order.assigned_rep_id);
  if (recipients.size === 0) return;

  const branding = await getOrgPushBranding(orgId);
  const rows: Array<{
    org_id: string;
    recipient_id: string;
    type: string;
    title: string;
    message: string;
    link: string;
    order_id: string;
    read: boolean;
  }> = [];
  const pushQueue: Array<{ recipientId: string; role: string }> = [];

  for (const [recipientId, role] of recipients.entries()) {
    const exists = await reminderAlreadyNotified(orgId, recipientId, order.id, title, message);
    if (exists) continue;
    rows.push({
      org_id: orgId,
      recipient_id: recipientId,
      type: ORDER_FOLLOW_UP_TYPE,
      title,
      message,
      link: orderLinkForRole(role, order.id),
      order_id: order.id,
      read: false
    });
    pushQueue.push({ recipientId, role });
  }

  if (rows.length === 0) return;

  const { error } = await supabase.from("system_notifications").insert(rows);
  if (error) {
    logger.warn("follow-up notification insert failed", { orgId, orderId: order.id, error: error.message });
    return;
  }

  await Promise.all(
    pushQueue.map(({ recipientId, role }) =>
      sendPushToUser(orgId, recipientId, {
        title,
        body: message,
        kind: ORDER_FOLLOW_UP_TYPE,
        url: orderLinkForRole(role, order.id),
        tag,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
      }).catch((pushError) => {
        logger.warn("follow-up notification push failed", {
          orgId,
          orderId: order.id,
          recipientId,
          error: pushError instanceof Error ? pushError.message : String(pushError)
        });
      })
    )
  );
}

async function notifyScheduledReminder(orgId: string, order: DueReminderOrder, scheduledLabel: string) {
  const title = `Follow-up Due #${order.id}`;
  const message = trimText(
    [
      order.customer,
      orderDisplayName(order),
      order.next_action_type === "deliver" ? `delivery set for ${scheduledLabel}` : `follow-up at ${scheduledLabel}`,
      order.outcome_code?.trim() || null,
      order.next_action_note?.trim() || order.response?.trim() || null,
      formatNotificationMoney(order.amount, order.currency)
    ].filter(Boolean).join(" · ")
  );
  await notifyRecipients(orgId, order, title, message, `follow-up-scheduled-${order.id}-${scheduledLabel}`);
}

async function notifyTimelineReminder(orgId: string, order: DueReminderOrder, note: TimelineReminderNote, scheduledLabel: string) {
  const title = `Follow-up Due #${order.id}`;
  const message = trimText(
    [
      order.customer,
      orderDisplayName(order),
      `follow-up at ${scheduledLabel}`,
      note.text.trim() || null
    ].filter(Boolean).join(" · ")
  );
  await notifyRecipients(orgId, order, title, message, `follow-up-note-${order.id}-${note.id}-${scheduledLabel}`);
}

export async function syncDueOrderFollowUpNotifications(limitPerOrg = 300) {
  const { data: orgRows, error } = await supabase
    .from("organizations")
    .select("id");

  if (error) {
    logger.error("follow-up notification org query failed", { error: error.message });
    return;
  }

  const now = new Date();

  for (const org of orgRows ?? []) {
    const orgId = org.id as string;
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, org_id, customer, phone, assigned_rep_id, product_name, package_name, amount, currency, status, outcome_code, outcome_category, scheduled_date, scheduled_at, next_action_type, next_action_at, next_action_note, response, notes, timeline_notes")
      .eq("org_id", orgId)
      .in("status", [...ACTIVE_ORDER_STATUSES])
      .limit(limitPerOrg);

    if (ordersError) {
      logger.warn("follow-up notification order query failed", { orgId, error: ordersError.message });
      continue;
    }

    for (const order of (orders ?? []) as DueReminderOrder[]) {
      const scheduledDue = dueIsoMoment(order.next_action_at ?? order.scheduled_at ?? order.scheduled_date ?? null, now);
      if (scheduledDue && withinReminderWindow(scheduledDue, now)) {
        await notifyScheduledReminder(orgId, order, formatReminderLabel(order.next_action_at ?? order.scheduled_at ?? order.scheduled_date ?? scheduledDue));
      }

      for (const note of normalizeTimelineReminderNotes(order)) {
        const noteDue = dueIsoMoment(note.followUpAt ?? note.followUpDate ?? null, now);
        if (!noteDue || !withinReminderWindow(noteDue, now)) continue;
        await notifyTimelineReminder(orgId, order, note, formatReminderLabel(note.followUpAt ?? note.followUpDate ?? noteDue));
      }
    }
  }
}
