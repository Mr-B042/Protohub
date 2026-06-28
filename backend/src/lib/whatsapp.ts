import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { ensureWhatsAppReady, sendConnectedWhatsApp } from "./whatsapp-runtime.js";
import { isWithinWorkingSchedule, nextWorkingScheduleAt, type WorkingSchedule } from "./business-schedule.js";
import { generateOrderReceiptPdf } from "./order-receipt-pdf.js";
import { createShortLink } from "./short-links.js";

export type WhatsAppProvider = "baileys" | "cloud_api";
export type WhatsAppTrigger =
  | "order_follow_up_rep"
  | "order_follow_up_manager"
  | "order_follow_up_owner"
  // Customer-facing order event messages (via org automation account)
  | "order_new"            // Customer: order received confirmation + product image/video
  | "order_new_rep"        // Rep: new order alert with customer details (assisted handling)
  | "order_scheduled"      // Customer: scheduled delivery date confirmed
  | "order_failed"         // Customer: delivery failed, contact rep
  | "order_delivered"      // Customer: delivery confirmed, thank you
  | "order_upsell"         // Customer: post-order add-on offer (sent ~5 min after confirmation)
  | "cart_recovery";       // Customer: abandoned-cart recovery with a continue-where-you-left link
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
  order_delivered: false,
  order_upsell: false,
  cart_recovery: false
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
    body: "Dear {{customer}},\n\nThank you for your order. We have received it and it is now being processed.\n\nOrder Details:\nRef: #{{order_id}}\nProduct: {{product_name}}\nPackage: {{package_name}}\nQuantity: {{quantity}}\n{{addons_line}}Amount: {{currency}} {{amount}}\nDelivery to: {{city}}, {{state}}\n\nOur team will contact you shortly to confirm your delivery. For any enquiries, please reply to this message.\n\nWarm regards,\nProtohub Team"
  },
  order_new_rep: {
    body: "*New Order — Action Required*\n\nRef: #{{order_id}}\nCustomer: {{customer}}\nPhone: {{phone}}\nLocation: {{city}}, {{state}}\nProduct: {{product_name}} — {{package_name}}\nQuantity: {{quantity}}\n{{addons_line}}Amount: {{currency}} {{amount}}\nSource: {{source}}\n\nPlease call the customer to confirm the order and arrange delivery. Update the order status after contact."
  },
  order_scheduled: {
    body: "Dear {{customer}},\n\nYour delivery has been scheduled.\n\nOrder Details:\nRef: #{{order_id}}\nProduct: {{product_name}}\nPackage: {{package_name}}\n{{addons_line}}Scheduled Date: {{scheduled_date}}\n\nPlease ensure you or a representative is available to receive the package on the scheduled date. Our delivery partner will contact you before arrival.\n\nFor any enquiries, please reply to this message.\n\nWarm regards,\nProtohub Team"
  },
  order_failed: {
    body: "Dear {{customer}},\n\nWe regret to inform you that we were unable to complete your delivery today.\n\nOrder Details:\nRef: #{{order_id}}\nProduct: {{product_name}}\nPackage: {{package_name}}\n{{addons_line}}Amount: {{currency}} {{amount}}\n\nOur team will reach out to you shortly to reschedule your delivery at a convenient time. You may also contact us directly: {{rep_contact}}\n\nWe apologise for the inconvenience and appreciate your patience.\n\nWarm regards,\nProtohub Team"
  },
  order_delivered: {
    body: "Dear {{customer}},\n\nYour order has been successfully delivered. ✅\n\nOrder Details:\nRef: #{{order_id}}\nProduct: {{product_name}}\nPackage: {{package_name}}\n{{addons_line}}Amount Paid: {{currency}} {{amount}}\n\nWe hope you are satisfied with your purchase. If you have any concerns about the product or delivery, please reply to this message and our team will assist you promptly.\n\nThank you for choosing us. We look forward to serving you again.\n\nWarm regards,\nProtohub Team"
  },
  order_upsell: {
    body: "Hi {{first_name}}! 🎉\n\nThank you for ordering — we are preparing your delivery now.\n\nQuick question — would you like to add *{{upsell_name}}* to your order?\n{{strike_line}}Just *{{upsell_currency}} {{upsell_price}}* — ships in the same delivery.\n\nReply *YES* to add it or *NO* to skip. 😊"
  },
  cart_recovery: {
    body: "Hi {{first_name}}! 🛒\n\nYou were almost done ordering *{{product_name}}*.\n{{addons_line}}Your details are still saved — tap here to finish in a few seconds 👉 {{recovery_link}}\n\nReply here if you need any help. 😊"
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
  cloud_api_phone_number_id?: string | null;
  cloud_api_waba_id?: string | null;
  cloud_api_access_token?: string | null;
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
const WHATSAPP_RATE_LIMIT_PER_MINUTE = Math.max(1, Number(process.env.WHATSAPP_RATE_LIMIT_PER_MINUTE ?? 4) || 4);
const WHATSAPP_RATE_LIMIT_PER_DAY = Math.max(1, Number(process.env.WHATSAPP_RATE_LIMIT_PER_DAY ?? 150) || 150);
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
  // Stray leading digit before a Nigerian 0-number (e.g. a customer typed "1" then
  // "08065440878" → "108065440878"). Drop the junk digit + leading 0 → 234 + 10 digits.
  // Without this it fell into the international catch-all below and went to a dead JID.
  if (digits.length === 12 && /^0[789]\d{9}$/.test(digits.slice(1))) {
    return `234${digits.slice(2)}`;
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
    templates: normalizeTemplateMap(data.templates, DEFAULT_WHATSAPP_TEMPLATES),
    cloud_api_phone_number_id: (data as any).cloud_api_phone_number_id ?? null,
    cloud_api_waba_id: (data as any).cloud_api_waba_id ?? null,
    cloud_api_access_token: (data as any).cloud_api_access_token ?? null
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

// Cloud API has no persistent socket — it's "connected" whenever the
// Phone Number ID + access token are configured and the org has WhatsApp enabled.
function cloudApiConfigured(settings: WhatsAppSettings | null) {
  return Boolean(settings?.cloud_api_phone_number_id?.trim() && settings?.cloud_api_access_token?.trim());
}

function isConnected(settings: WhatsAppSettings | null) {
  if (!settings?.enabled) return false;
  if (settings.provider === "cloud_api") return cloudApiConfigured(settings);
  return settings.connection_status === "connected";
}

function canAttemptWhatsAppResume(settings: WhatsAppSettings | null) {
  if (!settings?.enabled) return false;
  if (settings.provider === "cloud_api") return cloudApiConfigured(settings);
  return settings.connection_status !== "disconnected";
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
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string; extraImageUrls?: string[] }
): Promise<{ providerMessageId?: string; providerStatus?: string }> {
  try {
    await ensureWhatsAppReady(orgId);
    return await sendConnectedWhatsApp(orgId, phone, body, media);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Baileys send failed.";
    throw new WhatsAppDispatchError("baileys", message);
  }
}

const META_WA_GRAPH_VERSION = (process.env.META_WA_GRAPH_VERSION || process.env.META_GRAPH_VERSION || "v23.0").replace(/^\/+|\/+$/g, "");

// Official Meta WhatsApp Cloud API sender.
// Sends free-form text (works inside the 24h customer-service window) or an
// image with caption. Business-initiated sends outside 24h require approved
// templates — that path is handled separately by sendCloudApiTemplate.
async function sendViaCloudApi(
  settings: WhatsAppSettings,
  phone: string,
  body: string,
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string; extraImageUrls?: string[] }
): Promise<{ providerMessageId?: string; providerStatus?: string }> {
  const phoneNumberId = settings.cloud_api_phone_number_id?.trim();
  const token = settings.cloud_api_access_token?.trim();
  if (!phoneNumberId || !token) {
    throw new WhatsAppDispatchError("cloud_api", "Meta Cloud API is not configured — add the Phone Number ID and access token.");
  }
  const url = `https://graph.facebook.com/${META_WA_GRAPH_VERSION}/${phoneNumberId}/messages`;

  let payload: Record<string, unknown>;
  if (media?.imageUrl) {
    payload = { messaging_product: "whatsapp", to: phone, type: "image", image: { link: media.imageUrl, caption: body } };
  } else if (media?.videoUrl) {
    payload = { messaging_product: "whatsapp", to: phone, type: "video", video: { link: media.videoUrl, caption: body } };
  } else {
    payload = { messaging_product: "whatsapp", to: phone, type: "text", text: { preview_url: true, body } };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw new WhatsAppDispatchError("cloud_api", err instanceof Error ? err.message : "Cloud API request failed.");
  }

  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || json?.error?.error_user_msg || `Cloud API returned ${res.status}`;
    throw new WhatsAppDispatchError("cloud_api", msg);
  }
  return { providerMessageId: json?.messages?.[0]?.id, providerStatus: "sent" };
}

// Dispatch through whichever provider the org has configured.
async function sendViaProvider(
  orgId: string,
  settings: WhatsAppSettings,
  phone: string,
  body: string,
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string; extraImageUrls?: string[] }
): Promise<{ providerMessageId?: string; providerStatus?: string }> {
  if (settings.provider === "cloud_api") {
    return sendViaCloudApi(settings, phone, body, media);
  }
  return sendViaBaileys(orgId, settings, phone, body, media);
}

// ── Global human-like send pacer ──────────────────────────────────────────────
// Serializes ALL outbound WhatsApp sends and spaces consecutive ones by a random
// 30–90s gap so the automations never blast a burst (WhatsApp flags robotic
// high-rate sending — that is what got the number restricted). An ISOLATED send
// still goes out right away: the wait only applies when another send happened within
// the last gap window. Covers every trigger and both the immediate and queued paths,
// since they all funnel through deliverLoggedWhatsApp.
const WHATSAPP_SEND_PACING_MIN_MS = 30_000;
const WHATSAPP_SEND_PACING_MAX_MS = 90_000;
let whatsappSendChain: Promise<void> = Promise.resolve();
let lastWhatsAppSendAt = 0;
function paceWhatsAppSend(): Promise<void> {
  const run = whatsappSendChain.then(async () => {
    const span = WHATSAPP_SEND_PACING_MAX_MS - WHATSAPP_SEND_PACING_MIN_MS;
    const gapMs = WHATSAPP_SEND_PACING_MIN_MS + Math.floor(Math.random() * (span + 1));
    const waitMs = Math.max(0, lastWhatsAppSendAt + gapMs - Date.now());
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    lastWhatsAppSendAt = Date.now();
  });
  // Keep the chain alive regardless of any single send's outcome.
  whatsappSendChain = run.catch(() => {});
  return run;
}

async function deliverLoggedWhatsApp(
  orgId: string,
  settings: WhatsAppSettings,
  logId: string | null,
  normalizedPhone: string,
  body: string,
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string; extraImageUrls?: string[] }
) {
  // Human-like pacing so bunched sends never go out as a rapid burst.
  await paceWhatsAppSend();
  const result = await sendViaProvider(orgId, settings, normalizedPhone, body, media);
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

// Customer/rep order-lifecycle triggers that must fire at most ONCE per order per
// trigger. Re-marking a status (e.g. Delivered twice), a status re-save, or two
// overlapping triggers must never re-send and spam the recipient. Follow-up
// reminders are intentionally repeatable, and manual sends use other triggers — both
// are deliberately excluded. cart_recovery has its own atomic recovery_sent_at claim.
const ONE_SHOT_ORDER_TRIGGERS = new Set<WhatsAppMessageEvent>([
  "order_new", "order_new_rep", "order_scheduled", "order_failed", "order_delivered", "order_upsell"
]);

async function queueOrSendWhatsApp(
  orgId: string,
  trigger: WhatsAppMessageEvent,
  vars: Record<string, string>,
  recipientPhone: string,
  options: SendWhatsAppOptions = {},
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string; extraImageUrls?: string[] }
): Promise<QueueOrSendWhatsAppResult | null> {
  const settings = await loadSettings(orgId);
  if (!settings) return null;
  if (!options.ignoreEnabled && !settings.enabled) return null;
  if (!options.ignoreTrigger && !settings.triggers?.[trigger]) return null;
  if (!options.ignoreEnabled && !canAttemptWhatsAppResume(settings)) return null;

  // Universal one-shot guard: never send the same order-lifecycle message twice for
  // the same order. A non-failed prior message for this exact (order, trigger) means
  // it already went out — skip, so re-saving / re-marking an order can't double-fire.
  if (options.orderId && ONE_SHOT_ORDER_TRIGGERS.has(trigger)) {
    const { count } = await supabase
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("order_id", options.orderId)
      .eq("trigger", trigger)
      .in("status", ["sent", "queued", "deferred", "delivered"]);
    if ((count ?? 0) > 0) {
      logger.info("whatsapp skipped: order event already messaged", { orgId, trigger, orderId: options.orderId });
      return null;
    }
  }

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

  // Pacing/jitter is handled globally in deliverLoggedWhatsApp (paceWhatsAppSend).
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
  if (settings.provider === "cloud_api") {
    if (!cloudApiConfigured(settings)) {
      return { ok: false, error: "Add your Meta Phone Number ID and access token before testing." };
    }
  } else if (settings.connection_status === "disconnected") {
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

    // Claim the row BEFORE the paced send. The per-send 30–90s pacing can make a
    // drain outlast the cron interval, so without a claim an overlapping run would
    // re-select the still-deferred row and double-send it. Move it to the in-flight
    // 'queued' state (which this processor does not select); only one run wins.
    const { data: claimedRow } = await supabase
      .from("whatsapp_messages")
      .update({ status: "queued" })
      .eq("id", row.id)
      .in("status", ["deferred", "failed"])
      .select("id");
    if (!claimedRow || claimedRow.length === 0) continue;

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
  productId?: string | null;
  customer?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  productName?: string | null;
  packageName?: string | null;
  quantity?: number | null;
  amount?: number | null;
  currency?: string | null;
  source?: string | null;
  city?: string | null;
  state?: string | null;
  scheduledDate?: string | null;
  assignedRepId?: string | null;
  crossSellLines?: Array<{ productName?: string | null; displayName?: string | null; quantity?: number | null; amount?: number | null }> | null;
  // The main package's included items (components + free gifts) — so the order
  // breakdown lists what's inside the package, not just its name.
  packageComponentsSnapshot?: Array<{ productName?: string | null; quantity?: number | null; isFreeGift?: boolean | null; hiddenFromCustomer?: boolean | null }> | null;
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

// Build the addon lines string for template interpolation.
// Returns empty string when no addons so the template line collapses cleanly.
function buildAddonsLine(order: OrderEventPayload, currency?: string): string {
  const cur = currency ?? order.currency ?? "NGN";
  const parts: string[] = [];
  // What's inside the main package (components + free gifts), customer-visible only.
  for (const c of (order.packageComponentsSnapshot ?? [])) {
    if (c?.hiddenFromCustomer) continue;
    const name = (c?.productName ?? "").trim();
    if (!name) continue;
    const qty = Math.max(1, Math.round(Number(c?.quantity ?? 1) || 1));
    parts.push(`  + ${c?.isFreeGift ? "FREE " : ""}${qty} pc${qty === 1 ? "" : "s"} of ${name}`);
  }
  // Cross-sell add-ons (priced).
  for (const l of (order.crossSellLines ?? [])) {
    const name = l.displayName ?? l.productName ?? "Add-on";
    const qty  = l.quantity ? ` ${l.quantity} pc${l.quantity === 1 ? "" : "s"}` : "";
    const amt  = l.amount != null ? ` — ${cur} ${l.amount.toLocaleString("en-NG")}` : "";
    parts.push(`  + ${name}${qty}${amt}`);
  }
  return parts.length ? parts.join("\n") + "\n" : "";
}

// A product can carry a "real footage" image sent as an EXTRA photo in the
// new-order confirmation (after the invoice + catalog image). One per product,
// so it applies to all of its packages. Returns the URL only if set.
async function resolveProductFootageImage(orgId: string, productId?: string | null): Promise<string | null> {
  if (!productId) return null;
  const { data } = await supabase
    .from("products")
    .select("whatsapp_footage_image_url")
    .eq("id", productId)
    .eq("org_id", orgId)
    .maybeSingle();
  const url = (data as { whatsapp_footage_image_url?: string | null } | null)?.whatsapp_footage_image_url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

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

  // Build addon lines for the text message using the shared helper
  const addonsLine = buildAddonsLine(order, currency);

  // Stage 1: plain text first — lands in customer's main chat (not Message Requests).
  // Unknown senders who send attachments as the FIRST message get routed to spam.
  const textResult = await queueOrSendWhatsApp(
    orgId, "order_new",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      phone: order.phone?.trim() || targetPhone,
      product_name: order.productName ?? "your order",
      package_name: order.packageName ?? "",
      quantity: order.quantity != null ? `${order.quantity} pc${order.quantity === 1 ? "" : "s"}` : "—",
      addons_line: addonsLine,
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
  );

  // Stage 2: after a 3s delay, send PDF receipt + product image/video + any
  // real-footage photos. Now that the text established the thread, media messages
  // go straight through.
  if (textResult && !textResult.deferred) {
    const footageImageUrl = await resolveProductFootageImage(orgId, order.productId);
    const hasMedia = order.productImageUrl || order.productVideoUrl || footageImageUrl;
    const shouldSendPdf = true; // always send receipt
    if (hasMedia || shouldSendPdf) {
      setTimeout(async () => {
        try {
          let pdfBuffer: Buffer | undefined;
          try {
            pdfBuffer = await generateOrderReceiptPdf({
              id: order.id,
              customer: order.customer,
              phone: order.phone,
              productName: order.productName,
              packageName: order.packageName,
              quantity: order.quantity ?? null,
              amount: order.amount,
              currency: order.currency,
              city: order.city,
              state: order.state,
              source: order.source,
              crossSellLines: order.crossSellLines?.map(l => ({
                productName: (l.displayName ?? l.productName) ?? undefined,
                quantity: l.quantity ?? undefined,
                amount: l.amount ?? undefined
              })) ?? null,
              packageComponentsSnapshot: order.packageComponentsSnapshot ?? null
            });
          } catch (err) {
            logger.warn("wa order_new: pdf generation failed for follow-up", {
              orderId: order.id, error: (err as Error).message
            });
          }

          if (pdfBuffer || hasMedia) {
            await queueOrSendWhatsApp(
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
                ignoreTrigger: true,    // already checked above
                ignoreRateLimit: true,  // same order, follow-up only
                bodyOverride: pdfBuffer ? `📋 Order Receipt — #${order.id}` : undefined
              },
              {
                imageUrl: order.productImageUrl ?? undefined,
                videoUrl: order.productVideoUrl ?? undefined,
                extraImageUrls: footageImageUrl ? [footageImageUrl] : undefined,
                pdfBuffer,
                pdfFileName: `Order-Receipt-${order.id}.pdf`
              }
            );
          }
        } catch (err) {
          logger.warn("wa order_new: follow-up media send failed", {
            orderId: order.id, error: (err as Error).message
          });
        }
      }, 3000);
    }
  }

  return textResult;
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

  const repCurrency = order.currency ?? "NGN";
  await queueOrSendWhatsApp(
    orgId, "order_new_rep",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      phone: order.phone ?? "—",
      product_name: order.productName ?? "—",
      package_name: order.packageName ?? "—",
      quantity: order.quantity != null ? `${order.quantity} pc${order.quantity === 1 ? "" : "s"}` : "—",
      addons_line: buildAddonsLine(order, repCurrency),
      amount: typeof order.amount === "number" ? order.amount.toLocaleString("en-NG") : "0",
      currency: repCurrency,
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

  const schedCurrency = order.currency ?? "NGN";
  return queueOrSendWhatsApp(
    orgId, "order_scheduled",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      product_name: order.productName ?? "your order",
      package_name: order.packageName ?? "",
      addons_line: buildAddonsLine(order, schedCurrency),
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

  const failedCurrency = order.currency ?? "NGN";
  return queueOrSendWhatsApp(
    orgId, "order_failed",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      product_name: order.productName ?? "your order",
      package_name: order.packageName ?? "",
      addons_line: buildAddonsLine(order, failedCurrency),
      amount: typeof order.amount === "number" ? order.amount.toLocaleString("en-NG") : "0",
      currency: failedCurrency,
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

  const delivCurrency = order.currency ?? "NGN";
  return queueOrSendWhatsApp(
    orgId, "order_delivered",
    {
      order_id: order.id,
      customer: order.customer ?? "Customer",
      product_name: order.productName ?? "your order",
      package_name: order.packageName ?? "",
      addons_line: buildAddonsLine(order, delivCurrency),
      amount: typeof order.amount === "number" ? order.amount.toLocaleString("en-NG") : "0",
      currency: delivCurrency
    },
    targetPhone,
    { orderId: order.id, audience: "customer", recipientName: order.customer ?? undefined }
  );
}

// ── Post-order upsell ────────────────────────────────────────────────────────
type UpsellConfig = {
  id?: string;
  enabled?: boolean;
  name: string;
  price: number;
  strikePrice?: number | null;
  currency: string;
  imageUrl?: string | null;
  productId?: string | null;
  packageId?: string | null;
  delayMinutes?: number;
};

export async function sendOrderUpsellWhatsApp(
  orgId: string,
  order: OrderEventPayload
): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings)) return;
  if (!settings?.triggers?.order_upsell) return;

  const targetPhone = customerWhatsAppTarget(order);
  if (!targetPhone) return;
  const normalizedPhone = normalizePhoneForWhatsApp(targetPhone);
  if (!normalizedPhone) return;
  if (await customerAlreadyMessagedToday(orgId, normalizedPhone, "order_upsell")) return;

  // Support both array (new) and single object (legacy) config formats
  const rawCfg = (settings as any).upsell_config;
  const allConfigs: UpsellConfig[] = Array.isArray(rawCfg)
    ? rawCfg
    : (rawCfg && typeof rawCfg === "object" ? [rawCfg] : []);

  // Only consider enabled configs with a name
  const enabledConfigs = allConfigs.filter((c: any) => c.enabled !== false && c.name);
  if (enabledConfigs.length === 0) return;

  // Pick the first config that passes stock check + not already in order
  // (tries each in order until one qualifies)
  let upsellCfg: UpsellConfig | null = null;
  for (const cfg of enabledConfigs) {
    if (!cfg.name) continue;
    // Check not already in order
    if (cfg.productId) {
      const { data: orderRow } = await supabase
        .from("orders").select("cross_sell_lines, product_id").eq("id", order.id).eq("org_id", orgId).maybeSingle();
      if (orderRow?.product_id === cfg.productId) continue;
      const lines = Array.isArray(orderRow?.cross_sell_lines) ? orderRow.cross_sell_lines : [];
      if (lines.some((l: any) => l.productId === cfg.productId || l.product_id === cfg.productId)) continue;
    }
    upsellCfg = cfg;
    break;
  }
  if (!upsellCfg) return;

  const upsellCfgFull = upsellCfg as UpsellConfig & { strikePrice?: number | null };
  if (!upsellCfgFull.name) return;

  // Stock check for the selected config
  const customerState = order.state?.trim();
  if (customerState && upsellCfgFull.productId) {
    const { data: agentStock } = await supabase
      .from("agent_location_stock").select("quantity")
      .eq("org_id", orgId).eq("product_id", upsellCfgFull.productId).gt("quantity", 0).limit(1).maybeSingle();
    if (!agentStock) {
      logger.info("wa order_upsell: skipped — no agent stock for upsell product", { orgId, orderId: order.id, state: customerState });
      return;
    }
  }

  const currency = upsellCfgFull.currency ?? "NGN";
  const firstName = (order.customer ?? "").split(" ")[0] || "there";
  const delayMs = ((upsellCfgFull.delayMinutes ?? 5) * 60 * 1000);
  const imageUrl = upsellCfgFull.imageUrl?.trim() || undefined;
  const videoUrl = (upsellCfgFull as { videoUrl?: string | null }).videoUrl?.trim() || undefined;
  // Additional offer images (a gallery) — sent right after the primary image.
  const extraImages = ((upsellCfgFull as { imageUrls?: string[] | null }).imageUrls ?? [])
    .map((u) => (u ?? "").trim())
    .filter((u) => u && u !== imageUrl);

  setTimeout(async () => {
    try {
      // Offer goes with the image (+ any extra gallery images), or the video if
      // there's no image. When image AND video are set, the video follows after.
      const primaryMedia = imageUrl
        ? { imageUrl, extraImageUrls: extraImages.length ? extraImages : undefined }
        : videoUrl ? { videoUrl } : undefined;
      const sent = await queueOrSendWhatsApp(
        orgId, "order_upsell",
        {
          first_name: firstName,
          order_id: order.id,
          upsell_name: upsellCfgFull.name,
          upsell_price: upsellCfgFull.price.toLocaleString("en-NG"),
          upsell_currency: currency,
          strike_line: upsellCfgFull.strikePrice
            ? `~~${currency} ${Number(upsellCfgFull.strikePrice).toLocaleString("en-NG")}~~ → `
            : ""
        },
        targetPhone,
        { orderId: order.id, audience: "customer", recipientName: firstName },
        primaryMedia
      );
      if (sent && !sent.deferred && imageUrl && videoUrl) {
        setTimeout(() => {
          void queueOrSendWhatsApp(
            orgId, "order_upsell",
            { first_name: firstName, order_id: order.id, upsell_name: upsellCfgFull.name, upsell_price: "", upsell_currency: currency, strike_line: "" },
            targetPhone,
            { orderId: order.id, audience: "customer", recipientName: firstName, ignoreTrigger: true, ignoreRateLimit: true, bodyOverride: `👀 See ${upsellCfgFull.name} in action` },
            { videoUrl }
          ).catch(() => {});
        }, 1500);
      }
    } catch (err) {
      logger.warn("wa order_upsell: send failed", { orgId, orderId: order.id, error: (err as Error).message });
    }
  }, delayMs);
}

// Build a "free gifts" line from a package's components (e.g. the 5-in-1's bundled
// gifts) for the cart-recovery message. Empty string when there are none.
async function buildCartRecoveryAddonsLine(orgId: string, components: any[] | null | undefined): Promise<string> {
  const list = Array.isArray(components) ? components.filter((c) => c && c.hiddenFromCustomer !== true && c.productId) : [];
  if (list.length === 0) return "";
  const ids = Array.from(new Set(list.map((c) => String(c.productId))));
  const nameById = new Map<string, string>();
  const { data: prods } = await supabase.from("products").select("id, name").eq("org_id", orgId).in("id", ids);
  for (const p of (prods ?? []) as Array<{ id: string; name: string }>) nameById.set(p.id, p.name);
  const items = list.map((c) => {
    const name = nameById.get(String(c.productId)) ?? "item";
    const qty = Math.max(1, Math.round(Number(c.quantity ?? 1) || 1));
    return `${qty} pc${qty === 1 ? "" : "s"} of ${name}`;
  });
  return `🎁 Plus your FREE gifts: ${items.join(", ")}\n`;
}

/**
 * Abandoned-cart recovery to the CUSTOMER on WhatsApp — the product image + a short,
 * tracked link back to the exact form they left (pre-filled, continues where they
 * stopped). Marked sent for dedupe.
 */
export async function sendCartRecoveryWhatsApp(orgId: string, cart: Record<string, any>): Promise<void> {
  const settings = await loadSettings(orgId);
  if (!isConnected(settings)) return;
  if (!settings?.triggers?.cart_recovery) return;
  if (cart.recovery_sent_at) return;

  const targetPhone = (cart.whatsapp ?? cart.phone ?? "").toString().trim();
  if (!targetPhone) return;
  const normalizedPhone = normalizePhoneForWhatsApp(targetPhone);
  if (!normalizedPhone) return;
  if (await customerAlreadyMessagedToday(orgId, normalizedPhone, "cart_recovery")) return;

  // Recovery link = the exact tracked form URL the customer landed on.
  const payload = (cart.capture_payload ?? {}) as Record<string, any>;
  const landingUrl: string | null = payload?.formContext?.landingUrl ?? payload?.landingUrl ?? null;
  if (!landingUrl) return;

  // Atomically CLAIM this cart before doing any send work. Concurrent recovery runs
  // (multiple instances, or a rolling deploy where two instances briefly overlap)
  // each SELECTed the same recovery_sent_at=null cart and ALL dispatched — spamming
  // the customer 2-3x within the same second. A conditional update only matches for
  // ONE run; the rest update 0 rows and bail. Idempotent under any concurrency.
  const { data: claimed } = await supabase
    .from("abandoned_carts")
    .update({ recovery_sent_at: new Date().toISOString() })
    .eq("id", cart.id).eq("org_id", orgId)
    .is("recovery_sent_at", null)
    .select("id");
  if (!claimed || claimed.length === 0) return;

  const recoveryLink = await createShortLink(orgId, landingUrl);

  const firstName = (cart.customer ?? "").toString().split(" ")[0] || "there";
  // Prefer the captured product name, then the cart's own product/package name, so
  // the message reads "…ordering Edge Brusher Max" — not a generic "your order" —
  // whenever capture_payload.productName wasn't recorded.
  const productName = (payload?.productName ?? cart.product_name ?? cart.package_name ?? "your order").toString();

  // Fetch the cart's package once — for the image fallback AND its included gifts.
  let pkg: { image_url?: string | null; image_urls?: string[] | null; package_components?: any[] | null } | null = null;
  if (cart.package_id) {
    const { data } = await supabase
      .from("product_packages").select("image_url, image_urls, package_components")
      .eq("id", cart.package_id).maybeSingle();
    pkg = (data as { image_url?: string | null; image_urls?: string[] | null; package_components?: any[] | null } | null) ?? null;
  }

  // Image (converts better). Chain: dedicated recovery creative → the cart's package
  // image → the product's catalog image. The "real footage" image is kept SEPARATE.
  let imageUrl: string | undefined = (settings as { cart_recovery_image_url?: string | null }).cart_recovery_image_url?.trim() || undefined;
  if (!imageUrl && pkg) {
    const arr = pkg.image_urls;
    imageUrl = (pkg.image_url ?? (Array.isArray(arr) ? arr[0] : undefined)) || undefined;
  }
  if (!imageUrl && cart.product_id) {
    const { data: prod } = await supabase
      .from("products").select("image_url")
      .eq("id", cart.product_id).maybeSingle();
    imageUrl = (prod as { image_url?: string | null } | null)?.image_url?.trim() || undefined;
  }

  // Free gifts / bundled items (e.g. the 5-in-1's gifts) — listed in the message.
  const addonsLine = await buildCartRecoveryAddonsLine(orgId, pkg?.package_components);

  // Mark sent before dispatching so an overlapping cron can't double-send.
  await supabase.from("abandoned_carts").update({ recovery_sent_at: new Date().toISOString() }).eq("id", cart.id).eq("org_id", orgId);

  await queueOrSendWhatsApp(
    orgId, "cart_recovery",
    { first_name: firstName, product_name: productName, addons_line: addonsLine, recovery_link: recoveryLink, cart_id: String(cart.id) },
    targetPhone,
    { audience: "customer", recipientName: firstName, metadata: { event: "cart_recovery", cartId: cart.id } },
    imageUrl ? { imageUrl } : undefined
  );
}

/**
 * Cron: WhatsApp abandoned-cart recovery. Any not-yet-converted cart with a phone
 * that hasn't been recovered, which either left the form 3+ min ago or has been idle
 * 5+ min — AND was abandoned within the last hour. (Complete carts usually auto-submit
 * to orders first and skip this.)
 */
const CART_RECOVERY_RECENCY_MINUTES = 60;
export async function runCartRecoveryWhatsApp(): Promise<void> {
  const now = Date.now();
  const idleCutoff = new Date(now - 5 * 60 * 1000).toISOString();
  const leftCutoff = new Date(now - 3 * 60 * 1000).toISOString();
  // Recency FLOOR: only message carts abandoned within the last hour. Without a lower
  // age bound, every old open cart with no recovery stamp stays eligible forever — so
  // when the feature first turns on (or after any downtime) the cron blasts days/weeks
  // of old carts in one burst, which is exactly what got the WhatsApp number
  // restricted. A recovery nudge is only relevant right after the customer leaves; a
  // week-old cart should never get a "you were almost done" message.
  const recencyFloor = new Date(now - CART_RECOVERY_RECENCY_MINUTES * 60 * 1000).toISOString();
  const { data: carts, error } = await supabase
    .from("abandoned_carts")
    .select("id, org_id, customer, phone, whatsapp, product_id, package_id, capture_payload, last_activity, left_at, recovery_sent_at, status")
    .in("status", ["Open abandoned", "In progress"])
    .is("recovery_sent_at", null)
    .not("phone", "is", null)
    .not("customer", "eq", "Partial lead")
    .or(`and(left_at.lte.${leftCutoff},left_at.gte.${recencyFloor}),and(last_activity.lte.${idleCutoff},last_activity.gte.${recencyFloor})`)
    .limit(100);
  if (error) { logger.error("cart_recovery: query failed", { error: error.message }); return; }
  if (!carts?.length) return;
  for (const cart of carts as Array<Record<string, any>>) {
    try { await sendCartRecoveryWhatsApp(cart.org_id, cart); }
    catch (e) { logger.warn("cart_recovery: send failed", { cartId: cart.id, error: (e as Error).message }); }
  }
}
