import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { ensureWhatsAppReady, sendConnectedWhatsApp } from "./whatsapp-runtime.js";
import { isWithinWorkingSchedule, nextWorkingScheduleAt, type WorkingSchedule } from "./business-schedule.js";
import { generateOrderReceiptPdf } from "./order-receipt-pdf.js";

export type WhatsAppProvider = "baileys";
export type WhatsAppTrigger =
  | "order_follow_up_rep"
  | "order_follow_up_manager"
  | "order_follow_up_owner"
  // Customer-facing order event messages (via org automation account)
  | "order_new"            // Customer: order received confirmation + product image/video
  | "order_new_rep"        // Rep: new order alert with customer details (assisted handling)
  | "order_scheduled"      // Customer: scheduled delivery date confirmed
  | "order_failed"         // Customer: delivery failed, contact rep
  | "order_delivered";     // Customer: delivery confirmed, thank you
export type WhatsAppMessageEvent =
  | WhatsAppTrigger
  | "manual_test"
  | "manual_custom_send";

export const DEFAULT_WHATSAPP_TRIGGERS: Record<WhatsAppTrigger, boolean> = {
  // All triggers default OFF — owner must explicitly enable each one.
  order_follow_up_rep: false,
  order_follow_up_manager: false,
  order_follow_up_owner: false,
  order_new: false,
  order_new_rep: false,
  order_scheduled: false,
  order_failed: false,
  order_delivered: false
};

export const LEGACY_WHATSAPP_TEMPLATE_BODIES: Record<Extract<WhatsAppTrigger, "order_follow_up_rep" | "order_follow_up_manager">, string> = {
  order_follow_up_rep:
    "Protohub WhatsApp reminder: follow up on order {{order_id}} for {{customer}} ({{phone}}) about {{product_name}} worth {{currency}} {{amount}}. Due: {{scheduled_date}}. Outcome: {{call_outcome}}. {{note_text}}",
  order_follow_up_manager:
    "Protohub manager alert: order {{order_id}} for {{customer}} ({{phone}}) still needs follow-up. Assigned rep: {{rep_name}} ({{rep_phone}}). Due: {{scheduled_date}}. Outcome: {{call_outcome}}. {{note_text}}"
};

export const PREVIOUS_DEFAULT_WHATSAPP_TEMPLATE_BODIES: Partial<Record<WhatsAppTrigger, string>> = {
  order_follow_up_rep:
    "Hi {{rep_name}}, {{stage_line}}\n{{customer}} is waiting on {{product_name}}.\nCustomer: {{phone}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}",
  order_follow_up_manager:
    "Hi {{manager_name}}, {{stage_line}}\n{{customer}} is still waiting on {{product_name}} and {{rep_name}} has not cleared it yet.\nRep: {{rep_name}} {{rep_phone}}\nCustomer: {{phone}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}",
  order_follow_up_owner:
    "Hi {{owner_name}}, {{stage_line}}\n{{customer}} is still unresolved after both rep and manager nudges.\nProduct: {{product_name}}\nRep: {{rep_name}} {{rep_phone}}\nManager: {{manager_name}} {{manager_phone}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}"
};

export const PREVIOUS_REFINED_WHATSAPP_TEMPLATE_BODIES: Partial<Record<WhatsAppTrigger, string>> = {
  order_follow_up_rep:
    "Ref: {{order_id}}\nHi {{rep_name}}, {{stage_line}}\nCustomer: {{customer}} · {{phone}}\nOrder: {{product_name}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}",
  order_follow_up_manager:
    "Ref: {{order_id}}\nHi {{manager_name}}, {{stage_line}}\nCustomer: {{customer}} · {{phone}}\nOrder: {{product_name}}\nRep: {{rep_name}} {{rep_phone}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}",
  order_follow_up_owner:
    "Ref: {{order_id}}\nHi {{owner_name}}, {{stage_line}}\nCustomer: {{customer}} · {{phone}}\nOrder: {{product_name}}\nRep: {{rep_name}} {{rep_phone}}\nManager: {{manager_name}} {{manager_phone}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}"
};

export const DEFAULT_WHATSAPP_TEMPLATES: Record<WhatsAppTrigger, { body: string }> = {
  order_follow_up_rep: {
    body: "Ref: {{order_id}}\nHi {{rep_name}}, {{stage_line}}\nCustomer: {{customer}} · {{phone}}\n{{state_line}}\nOrder: {{product_name}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}"
  },
  order_follow_up_manager: {
    body: "Ref: {{order_id}}\nHi {{manager_name}}, {{stage_line}}\nCustomer: {{customer}} · {{phone}}\n{{state_line}}\nOrder: {{product_name}}\nRep: {{rep_name}} {{rep_phone}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}"
  },
  order_follow_up_owner: {
    body: "Ref: {{order_id}}\nHi {{owner_name}}, {{stage_line}}\nCustomer: {{customer}} · {{phone}}\n{{state_line}}\nOrder: {{product_name}}\nRep: {{rep_name}} {{rep_phone}}\nManager: {{manager_name}} {{manager_phone}}\nDue: {{scheduled_date}}\n{{amount_line}}\n{{note_text}}\n{{action_prompt}}"
  },
  // Customer-facing order event templates
  order_new: {
    body: "Hi {{customer}}, your order has been received! 🎉\n\nOrder: #{{order_id}}\nProduct: {{product_name}}\nPackage: {{package_name}}\nAmount: {{currency}} {{amount}}\nDelivery to: {{city}}, {{state}}\n\nOur delivery team will contact you to arrange delivery. For enquiries call or reply to this message.\n\nThank you for your order! 🛍️"
  },
  order_new_rep: {
    body: "📦 *New Order Assigned to You*\n\nRef: #{{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nLocation: {{city}}, {{state}}\nProduct: {{product_name}} · {{package_name}}\nAmount: {{currency}} {{amount}}\nSource: {{source}}\n\nCall the customer to confirm and arrange delivery. Update the order status after contact."
  },
  order_scheduled: {
    body: "Hi {{customer}}, your delivery has been scheduled! 📅\n\nOrder: #{{order_id}}\nProduct: {{product_name}}\nScheduled for: {{scheduled_date}}\n\nOur delivery partner will arrive at your address. Please ensure you are available to receive the package.\n\nFor enquiries, reply to this message."
  },
  order_failed: {
    body: "Hi {{customer}}, we were unable to complete your delivery today. 😔\n\nOrder: #{{order_id}}\nProduct: {{product_name}}\n\nPlease contact us to reschedule your delivery. Our team will reach out to you shortly.\n\nCall us: {{rep_contact}}"
  },
  order_delivered: {
    body: "Hi {{customer}}, your order has been delivered! ✅\n\nOrder: #{{order_id}}\nProduct: {{product_name}}\n\nThank you for your purchase! We hope you enjoy your {{product_name}}. Please leave us a review — your feedback means a lot to us! 🌟"
  }
};

type WhatsAppSettings = {
  enabled: boolean;
  provider: WhatsAppProvider;
  connection_status: "disconnected" | "pairing" | "connected" | "errored";
  connected_phone?: string | null;
  connected_name?: string | null;
  last_connected_at?: string | null;
  last_error?: string | null;
  triggers: Record<string, boolean>;
  templates: Record<string, { body: string }>;
};

type OrgWhatsAppPolicy = WorkingSchedule & {
  timezone?: string | null;
};

type SendWhatsAppOptions = {
  orderId?: string | null;
  audience?: "customer" | "staff";
  recipientName?: string;
  metadata?: Record<string, unknown>;
  bodyOverride?: string;
  ignoreEnabled?: boolean;
  ignoreTrigger?: boolean;
  ignoreSchedule?: boolean;
  ignoreRateLimit?: boolean;
  throwOnFailure?: boolean;
};

type AssignedRepContact = {
  name: string;
  phone: string;
  role: string;
  contactLine: string;
};

type QueueOrSendWhatsAppResult = {
  provider: WhatsAppProvider;
  normalizedPhone: string;
  providerMessageId?: string;
  providerStatus?: string;
  deferred?: boolean;
  scheduledFor?: string | null;
};

export type WhatsAppOptOutRecord = {
  id: string;
  org_id: string;
  phone: string;
  normalized_phone: string;
  source: string;
  keyword?: string | null;
  note?: string | null;
  created_at: string;
  updated_at: string;
};

type DueReminderOrder = {
  id: string;
  org_id: string;
  customer: string;
  phone?: string | null;
  state?: string | null;
  assigned_rep_id?: string | null;
  product_name: string;
  package_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  status: string;
  scheduled_date?: string | null;
  scheduled_at?: string | null;
  call_outcome?: string | null;
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

class WhatsAppDispatchError extends Error {
  provider: WhatsAppProvider;

  constructor(provider: WhatsAppProvider, message: string) {
    super(message);
    this.name = "WhatsAppDispatchError";
    this.provider = provider;
  }
}

const DEFAULT_WHATSAPP_PROVIDER: WhatsAppProvider = "baileys";
const WHATSAPP_RETRY_BACKOFF_MINUTES = Math.max(2, Number(process.env.WHATSAPP_RETRY_BACKOFF_MINUTES ?? 10) || 10);
const WHATSAPP_MAX_RETRY_ATTEMPTS = Math.max(0, Number(process.env.WHATSAPP_MAX_RETRY_ATTEMPTS ?? 4) || 4);
const WHATSAPP_RATE_LIMIT_PER_MINUTE = Math.max(1, Number(process.env.WHATSAPP_RATE_LIMIT_PER_MINUTE ?? 20) || 20);
const WHATSAPP_RATE_LIMIT_PER_DAY = Math.max(1, Number(process.env.WHATSAPP_RATE_LIMIT_PER_DAY ?? 300) || 300);
const WHATSAPP_MANAGER_ESCALATION_DELAY_MINUTES = Math.max(5, Number(process.env.WHATSAPP_MANAGER_ESCALATION_DELAY_MINUTES ?? 30) || 30);
const WHATSAPP_OWNER_ESCALATION_DELAY_MINUTES = Math.max(10, Number(process.env.WHATSAPP_OWNER_ESCALATION_DELAY_MINUTES ?? 60) || 60);

const toSnakeKey = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

function normalizeBooleanMap(value: unknown, defaults: Record<string, boolean>) {
  const out = { ...defaults };
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = toSnakeKey(key);
    if (normalizedKey in defaults) out[normalizedKey] = !!entry;
  }
  return out;
}

function normalizeTemplateMap(value: unknown, defaults: Record<string, { body: string }>) {
  const out = { ...defaults };
  if (!value || typeof value !== "object") return out;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = toSnakeKey(key);
    if (!(normalizedKey in defaults) || !entry || typeof entry !== "object") continue;
    const template = entry as Record<string, unknown>;
    const incomingBody = typeof template.body === "string" ? template.body : defaults[normalizedKey].body;
    const maybeLegacyBody =
      normalizedKey in LEGACY_WHATSAPP_TEMPLATE_BODIES
      && incomingBody === LEGACY_WHATSAPP_TEMPLATE_BODIES[normalizedKey as keyof typeof LEGACY_WHATSAPP_TEMPLATE_BODIES]
        ? defaults[normalizedKey].body
        : normalizedKey in PREVIOUS_DEFAULT_WHATSAPP_TEMPLATE_BODIES
          && incomingBody === PREVIOUS_DEFAULT_WHATSAPP_TEMPLATE_BODIES[normalizedKey as WhatsAppTrigger]
            ? defaults[normalizedKey].body
          : normalizedKey in PREVIOUS_REFINED_WHATSAPP_TEMPLATE_BODIES
            && incomingBody === PREVIOUS_REFINED_WHATSAPP_TEMPLATE_BODIES[normalizedKey as WhatsAppTrigger]
              ? defaults[normalizedKey].body
            : incomingBody;
    out[normalizedKey] = {
      body: maybeLegacyBody
    };
  }
  return out;
}

function interpolate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function normalizePhoneForWhatsApp(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("234") && digits.length >= 13 && digits.length <= 15) {
    return digits;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return `234${digits.slice(1)}`;
  }
  if (!digits.startsWith("0") && digits.length === 10) {
    return `234${digits}`;
  }
  if (!digits.startsWith("0") && digits.length >= 11 && digits.length <= 15) {
    return digits;
  }
  return null;
}

function formatPhoneForDisplay(phone: string) {
  const trimmed = phone.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  const normalized = normalizePhoneForWhatsApp(trimmed);
  return normalized?.startsWith("234") ? `+${normalized}` : trimmed;
}

function compactLine(value?: string | null) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function formatAmountLine(order: Pick<DueReminderOrder, "amount" | "currency">) {
  if (typeof order.amount !== "number" || Number.isNaN(order.amount) || order.amount <= 0) return "";
  return `Value: ${order.currency ?? "NGN"} ${order.amount.toLocaleString()}`;
}

function formatNoteLine(noteText?: string | null) {
  const clean = compactLine(noteText);
  return clean ? `Last note: ${clean}` : "";
}

function formatStateLine(state?: string | null) {
  const clean = compactLine(state);
  return clean ? `State: ${clean}` : "State: Not captured yet";
}

function formatPhoneTag(value?: string | null) {
  const clean = compactLine(value);
  return clean ? `(${clean})` : "";
}

function buildRepConversationContext(overdueMinutes = 0) {
  const replyHint = "After you call, reply with the order code like {{order_id}} DONE, {{order_id}} LATER 3PM, or {{order_id}} NEED HELP.";
  if (overdueMinutes > 0) {
    return {
      stageLine: `this one is already ${overdueMinutes} min${overdueMinutes === 1 ? "" : "s"} late.`,
      actionPrompt: `Please check it now and log the outcome in Protohub. ${replyHint}`
    };
  }
  return {
    stageLine: "quick heads-up before this slips.",
    actionPrompt: `Please handle it now and update Protohub as soon as you finish. ${replyHint}`
  };
}

function buildManagerConversationContext(overdueMinutes = 0) {
  const replyHint = "After you step in, reply with the order code like {{order_id}} DONE, {{order_id}} LATER 3PM, or {{order_id}} OWNER HELP.";
  if (overdueMinutes > 0) {
    return {
      stageLine: `this follow-up is ${overdueMinutes} min${overdueMinutes === 1 ? "" : "s"} overdue.`,
      actionPrompt: `Please step in now, nudge the rep, and make sure Protohub is updated. ${replyHint}`
    };
  }
  return {
    stageLine: "rep support is needed on this follow-up.",
    actionPrompt: `Please keep an eye on it and step in if it stalls. ${replyHint}`
  };
}

function buildOwnerConversationContext(overdueMinutes = 0) {
  const replyHint = "After you decide the next move, reply with the order code like {{order_id}} DONE or {{order_id}} OWNER HELP.";
  if (overdueMinutes > 0) {
    return {
      stageLine: `this follow-up is still open after ${overdueMinutes} min${overdueMinutes === 1 ? "" : "s"} overdue.`,
      actionPrompt: `Please review it now and unblock the team if this needs owner attention. ${replyHint}`
    };
  }
  return {
    stageLine: "this follow-up still needs owner visibility.",
    actionPrompt: `Please review and decide the next step. ${replyHint}`
  };
}

async function isWhatsAppOptedOut(orgId: string, normalizedPhone: string) {
  const { data } = await supabase
    .from("whatsapp_opt_outs")
    .select("id")
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .maybeSingle();
  return !!data?.id;
}

const orderDisplayName = (value: { product_name: string; package_name?: string | null }) =>
  value.package_name?.trim()
    ? `${value.product_name} — ${value.package_name}`
    : value.product_name;

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

function toDateKey(value: string) {
  return value.slice(0, 10);
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

async function loadSettings(orgId: string): Promise<WhatsAppSettings | null> {
  const { data, error } = await supabase
    .from("whatsapp_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    ...(data as WhatsAppSettings),
    provider: (data.provider as WhatsAppProvider) ?? DEFAULT_WHATSAPP_PROVIDER,
    connection_status: (data.connection_status as WhatsAppSettings["connection_status"]) ?? "disconnected",
    triggers: normalizeBooleanMap(data.triggers, DEFAULT_WHATSAPP_TRIGGERS),
    templates: normalizeTemplateMap(data.templates, DEFAULT_WHATSAPP_TEMPLATES)
  };
}

async function loadOrgWhatsAppPolicy(orgId: string): Promise<OrgWhatsAppPolicy | null> {
  const { data, error } = await supabase
    .from("organizations")
    .select("timezone, working_schedule_enabled, working_days, working_day_start, working_day_end")
    .eq("id", orgId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    timezone: typeof data.timezone === "string" ? data.timezone : "Africa/Lagos",
    working_schedule_enabled: !!data.working_schedule_enabled,
    working_days: Array.isArray(data.working_days) ? data.working_days : null,
    working_day_start: typeof data.working_day_start === "string" ? data.working_day_start : "08:00",
    working_day_end: typeof data.working_day_end === "string" ? data.working_day_end : "18:00"
  };
}

function isConnected(settings: WhatsAppSettings | null) {
  return !!settings?.enabled && settings.connection_status === "connected";
}

function canAttemptWhatsAppResume(settings: WhatsAppSettings | null) {
  return !!settings?.enabled && settings.connection_status !== "disconnected";
}

function isWhatsAppAllowedNow(policy: OrgWhatsAppPolicy | null, at = new Date()) {
  if (!policy?.working_schedule_enabled) return true;
  return isWithinWorkingSchedule(policy, at);
}

function nextAllowedWhatsAppAt(policy: OrgWhatsAppPolicy | null, from = new Date()) {
  if (!policy?.working_schedule_enabled) {
    return new Date(from.getTime() + 60 * 1000).toISOString();
  }
  return nextWorkingScheduleAt(policy, from) ?? new Date(from.getTime() + 60 * 1000).toISOString();
}

async function loadWhatsAppRateWindow(orgId: string, now = new Date()) {
  const minuteSince = new Date(now.getTime() - 60 * 1000).toISOString();
  const daySince = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [{ count: minuteCount }, { count: dayCount }] = await Promise.all([
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .not("sent_at", "is", null)
      .gte("sent_at", minuteSince),
    supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .not("sent_at", "is", null)
      .gte("sent_at", daySince)
  ]);

  return {
    minuteCount: minuteCount ?? 0,
    dayCount: dayCount ?? 0
  };
}

function nextRateLimitedSendAt(policy: OrgWhatsAppPolicy | null, now = new Date(), scope: "minute" | "day" = "minute") {
  const base = scope === "day"
    ? new Date(now.getTime() + 24 * 60 * 60 * 1000)
    : new Date(now.getTime() + 60 * 1000);
  return nextAllowedWhatsAppAt(policy, base);
}

function computeRetryAt(retryCount: number, from = new Date()) {
  const multiplier = Math.max(0, retryCount - 1);
  const delayMinutes = Math.min(12 * 60, WHATSAPP_RETRY_BACKOFF_MINUTES * (2 ** multiplier));
  return new Date(from.getTime() + delayMinutes * 60 * 1000).toISOString();
}

function isRetryableWhatsAppError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("timeout")
    || normalized.includes("network")
    || normalized.includes("temporar")
    || normalized.includes("closed")
    || normalized.includes("stream errored")
    || normalized.includes("connection")
    || normalized.includes("rate")
    || normalized.includes("again")
  );
}

async function insertWhatsAppLog(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    logger.warn("whatsapp log insert failed", { error: error.message });
    return null;
  }

  return data?.id as string | null;
}

async function updateWhatsAppLog(id: string | null, payload: Record<string, unknown>) {
  if (!id) return;
  const { error } = await supabase.from("whatsapp_messages").update(payload).eq("id", id);
  if (error) logger.warn("whatsapp log update failed", { id, error: error.message });
}

async function loadAssignedRepContact(orgId: string, assignedRepId?: string | null): Promise<AssignedRepContact | null> {
  if (!assignedRepId) return null;
  const { data, error } = await supabase
    .from("users")
    .select("name, phone, role")
    .eq("org_id", orgId)
    .eq("id", assignedRepId)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;

  const displayName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "your Protohub rep";
  const phone = typeof data.phone === "string" ? formatPhoneForDisplay(data.phone) : "";
  const role = typeof data.role === "string" ? data.role : "Sales Rep";
  const contactLine = phone
    ? `Your assigned contact is ${displayName}. Reach them on ${phone}.`
    : `Your assigned contact is ${displayName}.`;

  return {
    name: displayName,
    phone,
    role,
    contactLine
  };
}

async function loadManagerContactForRep(orgId: string, assignedRepId?: string | null): Promise<AssignedRepContact | null> {
  if (!assignedRepId) return null;
  const { data: team, error: teamError } = await supabase
    .from("sales_teams")
    .select("lead_id")
    .eq("org_id", orgId)
    .contains("member_ids", [assignedRepId])
    .limit(1)
    .maybeSingle();

  if (teamError || !team?.lead_id) return null;

  const { data, error } = await supabase
    .from("users")
    .select("name, phone, role")
    .eq("org_id", orgId)
    .eq("id", team.lead_id)
    .eq("active", true)
    .maybeSingle();

  if (error || !data) return null;

  const displayName = typeof data.name === "string" && data.name.trim() ? data.name.trim() : "your team lead";
  const phone = typeof data.phone === "string" ? formatPhoneForDisplay(data.phone) : "";
  const role = typeof data.role === "string" ? data.role : "Admin";
  const contactLine = phone
    ? `Your team lead is ${displayName}. Reach them on ${phone}.`
    : `Your team lead is ${displayName}.`;

  return {
    name: displayName,
    phone,
    role,
    contactLine
  };
}

async function loadTeamContextForRep(orgId: string, assignedRepId?: string | null) {
  if (!assignedRepId) return null;
  const { data, error } = await supabase
    .from("sales_teams")
    .select("id, lead_id")
    .eq("org_id", orgId)
    .contains("member_ids", [assignedRepId])
    .limit(1)
    .maybeSingle();

  if (error || !data?.id) return null;
  return {
    teamId: data.id as string,
    leadId: typeof data.lead_id === "string" ? data.lead_id : null
  };
}

async function loadOwnerContactForOrg(orgId: string): Promise<AssignedRepContact | null> {
  const { data, error } = await supabase
    .from("users")
    .select("name, phone, role")
    .eq("org_id", orgId)
    .in("role", ["Owner", "Admin"])
    .eq("active", true);

  if (error || !data?.length) return null;
  const candidate = [...data].sort((a, b) => {
    if (a.role === b.role) return 0;
    if (a.role === "Owner") return -1;
    if (b.role === "Owner") return 1;
    return 0;
  })[0];

  const displayName = typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : "the owner";
  const phone = typeof candidate.phone === "string" ? formatPhoneForDisplay(candidate.phone) : "";
  const role = typeof candidate.role === "string" ? candidate.role : "Owner";
  const contactLine = phone
    ? `${displayName} can be reached on ${phone}.`
    : `${displayName} is the fallback owner contact.`;

  return {
    name: displayName,
    phone,
    role,
    contactLine
  };
}

async function recordOwnerEscalationActivity(orgId: string, order: DueReminderOrder, noteText?: string | null) {
  const team = await loadTeamContextForRep(orgId, order.assigned_rep_id);
  if (!team?.teamId) return;
  const note = [compactLine(noteText), "WhatsApp owner rescue alert sent because the follow-up stayed unresolved."]
    .filter(Boolean)
    .join(" ");
  const { error } = await supabase.from("manager_activity_logs").insert({
    org_id: orgId,
    team_id: team.teamId,
    manager_id: team.leadId,
    actor_id: null,
    actor_name: "Protohub WhatsApp",
    order_id: order.id,
    rep_id: order.assigned_rep_id ?? null,
    action_type: "owner_escalation_alert",
    note: note || null
  });
  if (error) {
    logger.warn("whatsapp owner escalation activity log failed", { orgId, orderId: order.id, error: error.message });
  }
}

async function reminderAlreadyLogged(
  orgId: string,
  orderId: string,
  dedupeKey: string,
  trigger: WhatsAppTrigger = "order_follow_up_rep"
) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("org_id", orgId)
    .eq("order_id", orderId)
    .eq("trigger", trigger)
    .neq("status", "failed")
    .contains("metadata", { dedupeKey })
    .limit(1);

  if (error) {
    logger.warn("whatsapp reminder dedupe check failed", { orgId, orderId, dedupeKey, trigger, error: error.message });
    return false;
  }

  return (data?.length ?? 0) > 0;
}

async function sendViaBaileys(
  orgId: string,
  settings: WhatsAppSettings,
  phone: string,
  body: string,
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string }
): Promise<{ providerMessageId?: string; providerStatus?: string }> {
  try {
    await ensureWhatsAppReady(orgId);
    return await sendConnectedWhatsApp(orgId, phone, body, media);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Baileys send failed.";
    throw new WhatsAppDispatchError("baileys", message);
  }
}

async function deliverLoggedWhatsApp(
  orgId: string,
  settings: WhatsAppSettings,
  logId: string | null,
  normalizedPhone: string,
  body: string,
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string }
) {
  const result = await sendViaBaileys(orgId, settings, normalizedPhone, body, media);
  await updateWhatsAppLog(logId, {
    status: "sent",
    provider_message_id: result.providerMessageId ?? null,
    provider_status: result.providerStatus ?? null,
    sent_at: new Date().toISOString(),
    next_retry_at: null
  });
  return {
    provider: settings.provider,
    providerMessageId: result.providerMessageId,
    providerStatus: result.providerStatus,
    normalizedPhone,
    deferred: false,
    scheduledFor: null
  } satisfies QueueOrSendWhatsAppResult;
}

async function queueOrSendWhatsApp(
  orgId: string,
  trigger: WhatsAppMessageEvent,
  vars: Record<string, string>,
  recipientPhone: string,
  options: SendWhatsAppOptions = {},
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string }
): Promise<QueueOrSendWhatsAppResult | null> {
  const settings = await loadSettings(orgId);
  if (!settings) return null;
  if (!options.ignoreEnabled && !settings.enabled) return null;
  if (!options.ignoreTrigger && !settings.triggers?.[trigger]) return null;
  if (!options.ignoreEnabled && !canAttemptWhatsAppResume(settings)) return null;

  const normalizedPhone = normalizePhoneForWhatsApp(recipientPhone);
  if (!normalizedPhone) {
    logger.warn("whatsapp skipped: invalid phone", { orgId, trigger, phone: recipientPhone });
    return null;
  }

  const template = trigger in DEFAULT_WHATSAPP_TEMPLATES
    ? settings.templates?.[trigger as WhatsAppTrigger]
    : null;
  const rawBody = typeof options.bodyOverride === "string"
    ? options.bodyOverride
    : template?.body
      ? interpolate(template.body, vars)
      : "";
  const messageBody = rawBody.trim();
  if (!messageBody) return null;

  const policy = await loadOrgWhatsAppPolicy(orgId);

  const metadata = options.metadata ?? {};
  const baseLogPayload = {
    org_id: orgId,
    order_id: options.orderId ?? null,
    trigger,
    audience: options.audience ?? "staff",
    recipient_name: options.recipientName ?? null,
    recipient_phone: recipientPhone,
    normalized_phone: normalizedPhone,
    body: messageBody,
    provider: settings.provider,
    metadata
  };

  if (options.audience === "customer" && await isWhatsAppOptedOut(orgId, normalizedPhone)) {
    await insertWhatsAppLog({
      ...baseLogPayload,
      status: "blocked",
      provider_status: "Recipient opted out of WhatsApp customer updates"
    });
    logger.info("whatsapp blocked by opt out", { orgId, trigger, normalizedPhone });
    return null;
  }

  if (!options.ignoreSchedule && !isWhatsAppAllowedNow(policy)) {
    const scheduledFor = nextAllowedWhatsAppAt(policy);
    const providerStatus = "Deferred for next working slot";
    await insertWhatsAppLog({
      ...baseLogPayload,
      status: "deferred",
      scheduled_for: scheduledFor,
      provider_status: providerStatus
    });
    logger.info("whatsapp deferred", { orgId, trigger, normalizedPhone, scheduledFor, reason: "working_schedule" });
    return {
      provider: settings.provider,
      normalizedPhone,
      deferred: true,
      scheduledFor,
      providerStatus
    } satisfies QueueOrSendWhatsAppResult;
  }

  if (!options.ignoreRateLimit) {
    const rateWindow = await loadWhatsAppRateWindow(orgId);
    if (rateWindow.minuteCount >= WHATSAPP_RATE_LIMIT_PER_MINUTE || rateWindow.dayCount >= WHATSAPP_RATE_LIMIT_PER_DAY) {
      const scope = rateWindow.dayCount >= WHATSAPP_RATE_LIMIT_PER_DAY ? "day" : "minute";
      const scheduledFor = nextRateLimitedSendAt(policy, new Date(), scope);
      const providerStatus = scope === "day" ? "Deferred for daily rate limit" : "Deferred for minute rate limit";
      await insertWhatsAppLog({
        ...baseLogPayload,
        status: "deferred",
        scheduled_for: scheduledFor,
        provider_status: providerStatus
      });
      logger.warn("whatsapp rate limited", {
        orgId,
        trigger,
        normalizedPhone,
        scope,
        minuteCount: rateWindow.minuteCount,
        dayCount: rateWindow.dayCount,
        scheduledFor
      });
      return {
        provider: settings.provider,
        normalizedPhone,
        deferred: true,
        scheduledFor,
        providerStatus
      } satisfies QueueOrSendWhatsAppResult;
    }
  }

  const logId = await insertWhatsAppLog({
    ...baseLogPayload,
    status: "queued"
  });

  try {
    const result = await deliverLoggedWhatsApp(orgId, settings, logId, normalizedPhone, messageBody, media);
    logger.info("whatsapp sent", {
      orgId,
      trigger,
      provider: settings.provider,
      to: normalizedPhone,
      providerMessageId: result.providerMessageId ?? null,
      hasMedia: Boolean(media?.imageUrl || media?.videoUrl)
    });
    return result satisfies QueueOrSendWhatsAppResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "WhatsApp send failed.";
    const retryable = isRetryableWhatsAppError(message) && WHATSAPP_MAX_RETRY_ATTEMPTS > 0;
    await updateWhatsAppLog(logId, {
      status: "failed",
      error_message: message,
      provider_status: message,
      next_retry_at: retryable ? computeRetryAt(1) : null
    });
    logger.error("whatsapp send failed", { orgId, trigger, to: normalizedPhone, error: message });
    if (options.ignoreEnabled || options.throwOnFailure) throw error;
    return null;
  }
}

export async function sendAssignedRepFollowUpReminderWhatsApp(
  orgId: string,
  order: DueReminderOrder,
  options: {
    dedupeKey: string;
    scheduledLabel: string;
    noteText?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings) || !settings?.triggers?.order_follow_up_rep) return null;

  const assignedRep = await loadAssignedRepContact(orgId, order.assigned_rep_id);
  if (!assignedRep?.phone?.trim()) return null;
  if (await reminderAlreadyLogged(orgId, order.id, options.dedupeKey, "order_follow_up_rep")) {
    return null;
  }

  const overdueMinutes = Math.max(0, Number(options.metadata?.overdueMinutes ?? 0) || 0);
  const convo = buildRepConversationContext(overdueMinutes);

  return queueOrSendWhatsApp(
    orgId,
    "order_follow_up_rep",
    {
      order_id: order.id,
      customer: order.customer,
      phone: order.phone ?? "No phone recorded",
      state_line: formatStateLine(order.state),
      product_name: orderDisplayName(order),
      amount: typeof order.amount === "number" ? String(order.amount) : "0",
      currency: order.currency ?? "NGN",
      status: order.status ?? "—",
      scheduled_date: options.scheduledLabel,
      call_outcome: order.call_outcome ?? "—",
      note_text: formatNoteLine(options.noteText),
      amount_line: formatAmountLine(order),
      stage_line: convo.stageLine,
      action_prompt: convo.actionPrompt,
      rep_name: assignedRep.name,
      rep_phone: assignedRep.phone
    },
    assignedRep.phone,
    {
      orderId: order.id,
      audience: "staff",
      recipientName: assignedRep.name,
      metadata: {
        event: "order_follow_up_rep",
        assignedRepId: order.assigned_rep_id ?? null,
        assignedRepName: assignedRep.name,
        assignedRepPhone: assignedRep.phone,
        dedupeKey: options.dedupeKey,
        ...(options.metadata ?? {})
      }
    }
  );
}

export async function sendManagerFollowUpReminderWhatsApp(
  orgId: string,
  order: DueReminderOrder,
  options: {
    dedupeKey: string;
    scheduledLabel: string;
    noteText?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings) || !settings?.triggers?.order_follow_up_manager) return null;

  const assignedRep = await loadAssignedRepContact(orgId, order.assigned_rep_id);
  const manager = await loadManagerContactForRep(orgId, order.assigned_rep_id);
  if (!manager?.phone?.trim()) return null;
  if (await reminderAlreadyLogged(orgId, order.id, options.dedupeKey, "order_follow_up_manager")) {
    return null;
  }

  const overdueMinutes = Math.max(0, Number(options.metadata?.overdueMinutes ?? 0) || 0);
  const convo = buildManagerConversationContext(overdueMinutes);

  return queueOrSendWhatsApp(
    orgId,
    "order_follow_up_manager",
    {
      order_id: order.id,
      customer: order.customer,
      phone: order.phone ?? "No phone recorded",
      state_line: formatStateLine(order.state),
      product_name: orderDisplayName(order),
      amount: typeof order.amount === "number" ? String(order.amount) : "0",
      currency: order.currency ?? "NGN",
      status: order.status ?? "—",
      scheduled_date: options.scheduledLabel,
      call_outcome: order.call_outcome ?? "—",
      note_text: formatNoteLine(options.noteText),
      amount_line: formatAmountLine(order),
      stage_line: convo.stageLine,
      action_prompt: convo.actionPrompt,
      rep_name: assignedRep?.name ?? "Unassigned rep",
      rep_phone: [assignedRep?.name ?? "", formatPhoneTag(assignedRep?.phone ?? "")].filter(Boolean).join(" ").trim() || "No rep phone",
      manager_name: manager.name,
      manager_phone: manager.phone
    },
    manager.phone,
    {
      orderId: order.id,
      audience: "staff",
      recipientName: manager.name,
      metadata: {
        event: "order_follow_up_manager",
        assignedRepId: order.assigned_rep_id ?? null,
        assignedRepName: assignedRep?.name ?? null,
        assignedRepPhone: assignedRep?.phone ?? null,
        managerName: manager.name,
        managerPhone: manager.phone,
        dedupeKey: options.dedupeKey,
        ...(options.metadata ?? {})
      }
    }
  );
}

export async function sendOwnerFollowUpReminderWhatsApp(
  orgId: string,
  order: DueReminderOrder,
  options: {
    dedupeKey: string;
    scheduledLabel: string;
    noteText?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings) || !settings?.triggers?.order_follow_up_owner) return null;

  const assignedRep = await loadAssignedRepContact(orgId, order.assigned_rep_id);
  const manager = await loadManagerContactForRep(orgId, order.assigned_rep_id);
  const owner = await loadOwnerContactForOrg(orgId);
  if (!owner?.phone?.trim()) return null;
  if (await reminderAlreadyLogged(orgId, order.id, options.dedupeKey, "order_follow_up_owner")) {
    return null;
  }

  const overdueMinutes = Math.max(0, Number(options.metadata?.overdueMinutes ?? 0) || 0);
  const convo = buildOwnerConversationContext(overdueMinutes);

  const result = await queueOrSendWhatsApp(
    orgId,
    "order_follow_up_owner",
    {
      order_id: order.id,
      customer: order.customer,
      phone: order.phone ?? "No phone recorded",
      state_line: formatStateLine(order.state),
      product_name: orderDisplayName(order),
      amount: typeof order.amount === "number" ? String(order.amount) : "0",
      currency: order.currency ?? "NGN",
      status: order.status ?? "—",
      scheduled_date: options.scheduledLabel,
      call_outcome: order.call_outcome ?? "—",
      note_text: formatNoteLine(options.noteText),
      amount_line: formatAmountLine(order),
      stage_line: convo.stageLine,
      action_prompt: convo.actionPrompt,
      rep_name: assignedRep?.name ?? "Unassigned rep",
      rep_phone: assignedRep?.phone ? formatPhoneTag(assignedRep.phone) : "",
      manager_name: manager?.name ?? "No team lead assigned",
      manager_phone: manager?.phone ? formatPhoneTag(manager.phone) : "",
      owner_name: owner.name,
      owner_phone: owner.phone
    },
    owner.phone,
    {
      orderId: order.id,
      audience: "staff",
      recipientName: owner.name,
      metadata: {
        event: "order_follow_up_owner",
        assignedRepId: order.assigned_rep_id ?? null,
        assignedRepName: assignedRep?.name ?? null,
        assignedRepPhone: assignedRep?.phone ?? null,
        managerName: manager?.name ?? null,
        managerPhone: manager?.phone ?? null,
        ownerName: owner.name,
        ownerPhone: owner.phone,
        dedupeKey: options.dedupeKey,
        ...(options.metadata ?? {})
      }
    }
  );
  if (result && !result.deferred) {
    await recordOwnerEscalationActivity(orgId, order, options.noteText);
  }
  return result;
}

export async function sendTestWhatsApp(orgId: string, phone: string) {
  const settings = await loadSettings(orgId);
  if (!settings) return { ok: false, error: "WhatsApp settings not configured yet." };
  if (settings.connection_status === "disconnected") {
    return { ok: false, error: "Connect Baileys first before sending a WhatsApp test." };
  }

  const result = await queueOrSendWhatsApp(
    orgId,
    "manual_test",
    {
      order_id: "TEST-WA",
      customer: "Protohub Test",
      phone: phone,
      product_name: "WhatsApp Diagnostics",
      amount: "0",
      currency: "NGN",
      status: "Connected",
      scheduled_date: "Now",
      call_outcome: "Test",
      note_text: "This is a Protohub WhatsApp test.",
      rep_name: "Protohub",
      rep_phone: settings.connected_phone ?? ""
    },
    phone,
    {
      bodyOverride: "Protohub WhatsApp test: your connection is active and ready to send follow-up reminders.",
      ignoreEnabled: true,
      ignoreTrigger: true,
      audience: "staff",
      recipientName: "Protohub Test",
      metadata: { kind: "test_whatsapp" }
    }
  ).catch((err: unknown) => {
    return { error: err instanceof Error ? err.message : "WhatsApp test failed." };
  });

  if (!result || "error" in result) {
    return { ok: false, error: result?.error ?? "WhatsApp test failed." };
  }

  return {
    ok: true,
    provider: result.provider,
    providerMessageId: result.providerMessageId ?? null,
    deferred: !!result.deferred,
    scheduledFor: result.deferred ? (result.scheduledFor ?? null) : null
  };
}

export async function sendCustomWhatsApp(
  orgId: string,
  phone: string,
  body: string,
  options: {
    recipientName?: string;
    orderId?: string | null;
    metadata?: Record<string, unknown>;
  } = {}
) {
  const settings = await loadSettings(orgId);
  if (!settings) return { ok: false, error: "WhatsApp settings not configured yet." };
  if (!settings.enabled) return { ok: false, error: "Enable WhatsApp reminders first before sending custom messages." };
  if (settings.connection_status === "disconnected") {
    return { ok: false, error: "Connect Baileys first before sending a custom WhatsApp." };
  }

  const result = await queueOrSendWhatsApp(
    orgId,
    "manual_custom_send",
    {},
    phone,
    {
      bodyOverride: body,
      ignoreTrigger: true,
      audience: "staff",
      recipientName: options.recipientName?.trim() || "Manual WhatsApp send",
      orderId: options.orderId ?? null,
      metadata: {
        kind: "manual_custom_send",
        ...(options.metadata ?? {})
      }
    }
  ).catch((err: unknown) => ({ error: err instanceof Error ? err.message : "Custom WhatsApp send failed." }));

  if (!result || "error" in result) {
    return { ok: false, error: result?.error ?? "Custom WhatsApp send failed." };
  }

  return {
    ok: true,
    provider: result.provider,
    providerMessageId: result.providerMessageId ?? null,
    deferred: !!result.deferred,
    scheduledFor: result.deferred ? (result.scheduledFor ?? null) : null
  };
}

export async function getWhatsAppSummary(orgId: string) {
  const settings = await loadSettings(orgId);
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();

  const [
    { count: sentToday },
    { count: deliveredToday },
    { count: failedToday },
    { count: queuedNow },
    { count: deferredNow },
    { count: inboundToday }
  ] = await Promise.all([
    supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).not("sent_at", "is", null).gte("sent_at", dayStartIso),
    supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).not("delivered_at", "is", null).gte("delivered_at", dayStartIso),
    supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "failed").gte("created_at", dayStartIso),
    supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "queued"),
    supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "deferred"),
    supabase.from("whatsapp_inbox_messages").select("id", { count: "exact", head: true }).eq("org_id", orgId).gte("received_at", dayStartIso)
  ]);

  return {
    connectionStatus: settings?.connection_status ?? "disconnected",
    sentToday: sentToday ?? 0,
    deliveredToday: deliveredToday ?? 0,
    failedToday: failedToday ?? 0,
    queuedNow: queuedNow ?? 0,
    deferredNow: deferredNow ?? 0,
    inboundToday: inboundToday ?? 0
  };
}

export async function listWhatsAppInboxMessages(orgId: string, limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, limit));
  const { data, error } = await supabase
    .from("whatsapp_inbox_messages")
    .select("*")
    .eq("org_id", orgId)
    .order("received_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listWhatsAppOptOuts(orgId: string) {
  const { data, error } = await supabase
    .from("whatsapp_opt_outs")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WhatsAppOptOutRecord[];
}

export async function addWhatsAppOptOut(
  orgId: string,
  phone: string,
  source = "manual",
  keyword?: string | null,
  note?: string | null
) {
  const normalizedPhone = normalizePhoneForWhatsApp(phone);
  if (!normalizedPhone) throw new Error("Enter a valid WhatsApp phone number.");

  const payload = {
    org_id: orgId,
    phone: phone.trim(),
    normalized_phone: normalizedPhone,
    source,
    keyword: keyword?.trim() || null,
    note: note?.trim() || null
  };

  const { data, error } = await supabase
    .from("whatsapp_opt_outs")
    .upsert(payload, { onConflict: "org_id,normalized_phone" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as WhatsAppOptOutRecord;
}

export async function removeWhatsAppOptOut(orgId: string, phone: string) {
  const normalizedPhone = normalizePhoneForWhatsApp(phone) ?? phone.replace(/\D/g, "");
  const { error } = await supabase
    .from("whatsapp_opt_outs")
    .delete()
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone);
  if (error) throw new Error(error.message);
  return normalizedPhone;
}

export async function syncDueFollowUpWhatsApp(limitPerOrg = 300) {
  const { data: settingsRows, error } = await supabase
    .from("whatsapp_settings")
    .select("org_id, enabled, connection_status, triggers");

  if (error) {
    logger.error("whatsapp follow-up sync settings query failed", { error: error.message });
    return;
  }

  const eligibleOrgIds = (settingsRows ?? [])
    .filter((row) => {
      const triggers = normalizeBooleanMap((row as Record<string, unknown>).triggers, DEFAULT_WHATSAPP_TRIGGERS);
      return !!row.enabled
        && row.connection_status === "connected"
        && (!!triggers.order_follow_up_rep || !!triggers.order_follow_up_manager || !!triggers.order_follow_up_owner);
    })
    .map((row) => row.org_id as string)
    .filter(Boolean);

  if (!eligibleOrgIds.length) return;

  const now = new Date();

  for (const orgId of eligibleOrgIds) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, org_id, customer, phone, state, assigned_rep_id, product_name, package_name, amount, currency, status, scheduled_date, scheduled_at, call_outcome, response, notes, timeline_notes")
      .eq("org_id", orgId)
      .in("status", ["Confirmed", "In Process", "Dispatched", "Postponed"])
      .limit(limitPerOrg);

    if (ordersError) {
      logger.warn("whatsapp follow-up sync order query failed", { orgId, error: ordersError.message });
      continue;
    }

    for (const order of (orders ?? []) as DueReminderOrder[]) {
      const scheduledDue = dueIsoMoment(order.scheduled_at ?? order.scheduled_date ?? null, now);
      if (scheduledDue && withinReminderWindow(scheduledDue, now)) {
        const overdueMinutes = Math.max(0, Math.round((now.getTime() - new Date(scheduledDue).getTime()) / 60000));
        const dedupeKey = `scheduled:${order.scheduled_at ?? order.scheduled_date}`;
        await sendAssignedRepFollowUpReminderWhatsApp(orgId, order, {
          dedupeKey,
          scheduledLabel: order.scheduled_at ?? order.scheduled_date ?? toDateKey(scheduledDue),
          metadata: {
            kind: "scheduled_delivery_reminder",
            overdueMinutes,
            scheduledAt: order.scheduled_at ?? null,
            scheduledDate: order.scheduled_date ?? null
          }
        });
        if (overdueMinutes >= WHATSAPP_MANAGER_ESCALATION_DELAY_MINUTES) {
          await sendManagerFollowUpReminderWhatsApp(orgId, order, {
            dedupeKey: `${dedupeKey}:manager`,
            scheduledLabel: order.scheduled_at ?? order.scheduled_date ?? toDateKey(scheduledDue),
            metadata: {
              kind: "scheduled_delivery_manager_alert",
              overdueMinutes,
              scheduledAt: order.scheduled_at ?? null,
              scheduledDate: order.scheduled_date ?? null
            }
          });
        }
        if (overdueMinutes >= WHATSAPP_OWNER_ESCALATION_DELAY_MINUTES) {
          await sendOwnerFollowUpReminderWhatsApp(orgId, order, {
            dedupeKey: `${dedupeKey}:owner`,
            scheduledLabel: order.scheduled_at ?? order.scheduled_date ?? toDateKey(scheduledDue),
            metadata: {
              kind: "scheduled_delivery_owner_alert",
              overdueMinutes,
              scheduledAt: order.scheduled_at ?? null,
              scheduledDate: order.scheduled_date ?? null
            }
          });
        }
      }

      for (const note of normalizeTimelineReminderNotes(order)) {
        const noteDue = dueIsoMoment(note.followUpAt ?? note.followUpDate ?? null, now);
        if (!noteDue || !withinReminderWindow(noteDue, now)) continue;
        const overdueMinutes = Math.max(0, Math.round((now.getTime() - new Date(noteDue).getTime()) / 60000));

        await sendAssignedRepFollowUpReminderWhatsApp(orgId, order, {
          dedupeKey: `note:${note.id}:${note.followUpAt ?? note.followUpDate}`,
          scheduledLabel: note.followUpAt ?? note.followUpDate ?? toDateKey(noteDue),
          noteText: note.text,
          metadata: {
            kind: "timeline_follow_up",
            noteId: note.id,
            overdueMinutes,
            followUpAt: note.followUpAt ?? null,
            followUpDate: note.followUpDate ?? null
          }
        });
        if (overdueMinutes >= WHATSAPP_MANAGER_ESCALATION_DELAY_MINUTES) {
          await sendManagerFollowUpReminderWhatsApp(orgId, order, {
            dedupeKey: `note:${note.id}:${note.followUpAt ?? note.followUpDate}:manager`,
            scheduledLabel: note.followUpAt ?? note.followUpDate ?? toDateKey(noteDue),
            noteText: note.text,
            metadata: {
              kind: "timeline_follow_up_manager_alert",
              noteId: note.id,
              overdueMinutes,
              followUpAt: note.followUpAt ?? null,
              followUpDate: note.followUpDate ?? null
            }
          });
        }
        if (overdueMinutes >= WHATSAPP_OWNER_ESCALATION_DELAY_MINUTES) {
          await sendOwnerFollowUpReminderWhatsApp(orgId, order, {
            dedupeKey: `note:${note.id}:${note.followUpAt ?? note.followUpDate}:owner`,
            scheduledLabel: note.followUpAt ?? note.followUpDate ?? toDateKey(noteDue),
            noteText: note.text,
            metadata: {
              kind: "timeline_follow_up_owner_alert",
              noteId: note.id,
              overdueMinutes,
              followUpAt: note.followUpAt ?? null,
              followUpDate: note.followUpDate ?? null
            }
          });
        }
      }
    }
  }
}

export async function processQueuedWhatsApp(limit = 100) {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("whatsapp_messages")
    .select("id, org_id, recipient_phone, normalized_phone, body, provider, status, retry_count, next_retry_at, scheduled_for")
    .or(`and(status.eq.deferred,scheduled_for.lte.${nowIso}),and(status.eq.failed,next_retry_at.lte.${nowIso})`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("whatsapp queue query failed", { error: error.message });
    return;
  }

  for (const row of rows ?? []) {
    const settings = await loadSettings(row.org_id);
    if (!settings || !canAttemptWhatsAppResume(settings)) continue;
    const nextRetryCount = Number(row.retry_count ?? 0) + 1;
    if (row.status === "failed" && nextRetryCount > WHATSAPP_MAX_RETRY_ATTEMPTS) {
      continue;
    }

    const policy = await loadOrgWhatsAppPolicy(row.org_id);
    if (!isWhatsAppAllowedNow(policy)) {
      await updateWhatsAppLog(row.id, {
        status: "deferred",
        scheduled_for: nextAllowedWhatsAppAt(policy),
        next_retry_at: null,
        provider_status: "Deferred for next working slot"
      });
      continue;
    }

    const rateWindow = await loadWhatsAppRateWindow(row.org_id);
    if (rateWindow.minuteCount >= WHATSAPP_RATE_LIMIT_PER_MINUTE || rateWindow.dayCount >= WHATSAPP_RATE_LIMIT_PER_DAY) {
      const scope = rateWindow.dayCount >= WHATSAPP_RATE_LIMIT_PER_DAY ? "day" : "minute";
      await updateWhatsAppLog(row.id, {
        status: "deferred",
        scheduled_for: nextRateLimitedSendAt(policy, new Date(), scope),
        next_retry_at: null,
        provider_status: scope === "day" ? "Deferred for daily rate limit" : "Deferred for minute rate limit"
      });
      continue;
    }

    try {
      await updateWhatsAppLog(row.id, {
        retry_count: nextRetryCount,
        last_retry_at: new Date().toISOString(),
        error_message: null
      });
      await deliverLoggedWhatsApp(row.org_id, settings, row.id, row.normalized_phone, row.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp retry failed.";
      const retryable = isRetryableWhatsAppError(message) && nextRetryCount <= WHATSAPP_MAX_RETRY_ATTEMPTS;
      await updateWhatsAppLog(row.id, {
        status: "failed",
        retry_count: nextRetryCount,
        last_retry_at: new Date().toISOString(),
        next_retry_at: retryable ? computeRetryAt(nextRetryCount + 1) : null,
        error_message: message,
        provider_status: message
      });
    }
  }
}
// ── Order-event WhatsApp notifications (org automation account) ──────────────

type OrderEventPayload = {
  id: string;
  customer?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  productName?: string | null;
  packageName?: string | null;
  amount?: number | null;
  currency?: string | null;
  source?: string | null;
  city?: string | null;
  state?: string | null;
  scheduledDate?: string | null;
  assignedRepId?: string | null;
  // For media (product images / videos passed from the product catalogue)
  productImageUrl?: string | null;
  productVideoUrl?: string | null;
};

type OrderEventRepContact = {
  name: string;
  phone: string;
};

const customerWhatsAppTarget = (order: Pick<OrderEventPayload, "phone" | "whatsapp">) =>
  order.whatsapp?.trim() || order.phone?.trim() || "";

/** Anti-ban: customer messages have a tighter per-recipient daily cap */
const CUSTOMER_WHATSAPP_DAY_CAP = 1; // max 1 message per customer per event type per day

async function customerAlreadyMessagedToday(
  orgId: string,
  normalizedPhone: string,
  trigger: WhatsAppTrigger
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("whatsapp_messages")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .eq("trigger", trigger)
    .in("status", ["sent", "queued", "deferred"])
    .gte("created_at", since);
  return (count ?? 0) >= CUSTOMER_WHATSAPP_DAY_CAP;
}

/**
 * Send new-order confirmation to the CUSTOMER.
 * Includes product image or video if available.
 * Anti-ban: checked for opt-out, rate limited, business-hours aware.
 */
export async function sendOrderNewCustomerWhatsApp(
  orgId: string,
  order: OrderEventPayload,
  options: { ignoreCustomerDedupe?: boolean; throwOnFailure?: boolean } = {}
): Promise<QueueOrSendWhatsAppResult | null> {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings)) return null;
  if (!settings?.triggers?.order_new) return null;
  const targetPhone = customerWhatsAppTarget(order);
  if (!targetPhone) return null;
  const normalizedPhone = normalizePhoneForWhatsApp(targetPhone);
  if (!normalizedPhone) return null;
  if (!options.ignoreCustomerDedupe && await customerAlreadyMessagedToday(orgId, normalizedPhone, "order_new")) return null;

  const currency = order.currency ?? "NGN";
  const amount = typeof order.amount === "number" ? order.amount.toLocaleString("en-NG") : "0";

  // NOTE: PDF and media are intentionally excluded from the first customer message.
  // Sending a document/image as the first ever message from an unknown number
  // triggers WhatsApp's spam filter — the message lands in "Message Requests"
  // instead of the customer's main chat. Plain text first messages reach the inbox.
  return queueOrSendWhatsApp(
    orgId, "order_new",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      phone: order.phone?.trim() || targetPhone,
      product_name: order.productName ?? "your order",
      package_name: order.packageName ?? "",
      amount,
      currency,
      city: order.city ?? "",
      state: order.state ?? ""
    },
    targetPhone,
    {
      orderId: order.id,
      audience: "customer",
      recipientName: order.customer ?? undefined,
      throwOnFailure: options.throwOnFailure
    }
    // No media on first message — avoid spam filter
  );
}

/**
 * Send new-order alert to the ASSIGNED REP (assisted call handling).
 * Gives the rep full customer + order details so they can call immediately.
 */
export async function sendOrderNewRepWhatsApp(
  orgId: string,
  order: OrderEventPayload,
  rep: OrderEventRepContact
): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings)) return;
  if (!settings?.triggers?.order_new_rep) return;
  if (!rep.phone?.trim()) return;

  await queueOrSendWhatsApp(
    orgId, "order_new_rep",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      phone: order.phone ?? "—",
      product_name: order.productName ?? "—",
      package_name: order.packageName ?? "—",
      amount: typeof order.amount === "number" ? order.amount.toLocaleString("en-NG") : "0",
      currency: order.currency ?? "NGN",
      city: order.city ?? "—",
      state: order.state ?? "—",
      source: order.source ?? "—",
      rep_name: rep.name,
      rep_phone: rep.phone
    },
    rep.phone,
    {
      orderId: order.id,
      audience: "staff",
      recipientName: rep.name,
      ignoreSchedule: true  // Rep alerts fire immediately regardless of business hours
    }
  );
}

/**
 * Notify the customer when their order is scheduled for delivery.
 */
export async function sendOrderScheduledCustomerWhatsApp(
  orgId: string,
  order: OrderEventPayload
): Promise<QueueOrSendWhatsAppResult | null> {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings)) return null;
  if (!settings?.triggers?.order_scheduled) return null;
  const targetPhone = customerWhatsAppTarget(order);
  if (!targetPhone) return null;
  const normalizedPhone = normalizePhoneForWhatsApp(targetPhone);
  if (!normalizedPhone) return null;
  if (await customerAlreadyMessagedToday(orgId, normalizedPhone, "order_scheduled")) return null;

  return queueOrSendWhatsApp(
    orgId, "order_scheduled",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      product_name: order.productName ?? "your order",
      scheduled_date: order.scheduledDate ?? "soon"
    },
    targetPhone,
    { orderId: order.id, audience: "customer", recipientName: order.customer ?? undefined }
  );
}

/**
 * Notify the customer when a delivery attempt has failed.
 */
export async function sendOrderFailedCustomerWhatsApp(
  orgId: string,
  order: OrderEventPayload,
  rep?: OrderEventRepContact | null
): Promise<QueueOrSendWhatsAppResult | null> {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings)) return null;
  if (!settings?.triggers?.order_failed) return null;
  const targetPhone = customerWhatsAppTarget(order);
  if (!targetPhone) return null;
  const normalizedPhone = normalizePhoneForWhatsApp(targetPhone);
  if (!normalizedPhone) return null;
  if (await customerAlreadyMessagedToday(orgId, normalizedPhone, "order_failed")) return null;

  return queueOrSendWhatsApp(
    orgId, "order_failed",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      product_name: order.productName ?? "your order",
      rep_contact: rep?.phone ?? "our team"
    },
    targetPhone,
    { orderId: order.id, audience: "customer", recipientName: order.customer ?? undefined }
  );
}

/**
 * Send a delivery confirmation to the customer.
 */
export async function sendOrderDeliveredCustomerWhatsApp(
  orgId: string,
  order: OrderEventPayload
): Promise<QueueOrSendWhatsAppResult | null> {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings)) return null;
  if (!settings?.triggers?.order_delivered) return null;
  const targetPhone = customerWhatsAppTarget(order);
  if (!targetPhone) return null;
  const normalizedPhone = normalizePhoneForWhatsApp(targetPhone);
  if (!normalizedPhone) return null;
  if (await customerAlreadyMessagedToday(orgId, normalizedPhone, "order_delivered")) return null;

  return queueOrSendWhatsApp(
    orgId, "order_delivered",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      product_name: order.productName ?? "your order"
    },
    targetPhone,
    { orderId: order.id, audience: "customer", recipientName: order.customer ?? undefined }
  );
}
