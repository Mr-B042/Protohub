import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { sendLowSmsBalanceEmail } from "./mailer.js";
import { DEFAULT_WORKING_DAYS, isWithinWorkingSchedule, nextWorkingScheduleAt, normalizeWorkingDays } from "./business-schedule.js";

export type SmsProvider = "multitexter";
export type SmsTrigger =
  | "order_new"
  | "order_status_change"
  | "order_delivered"
  | "order_failed"
  | "order_cancelled"
  | "order_rescheduled"
  | "order_not_picking"
  | "order_not_ready"
  | "order_follow_up"
  | "order_follow_up_rep"
  | "cart_assigned"
  | "cart_follow_up";

export const DEFAULT_SMS_TRIGGERS: Record<SmsTrigger, boolean> = {
  order_new: true,
  order_status_change: false,
  order_delivered: true,
  order_failed: true,
  order_cancelled: true,
  order_rescheduled: true,
  order_not_picking: true,
  order_not_ready: true,
  order_follow_up: false,
  order_follow_up_rep: true,
  cart_assigned: false,
  cart_follow_up: false
};

export const DEFAULT_SMS_TEMPLATES: Record<SmsTrigger, { body: string }> = {
  order_new: {
    body: "Hello {{customer}}, your Protohub order {{order_id}} has been received for {{product_name}}. Order value: {{currency}} {{amount}}. Our team will contact you shortly to confirm the next step."
  },
  order_status_change: {
    body: "Hello {{customer}}, your order {{order_id}} for {{product_name}} is now {{status}}. Current order value: {{currency}} {{amount}}. Thank you for choosing Protohub."
  },
  order_delivered: {
    body: "Hello {{customer}}, your order {{order_id}} for {{product_name}} has been delivered successfully. Total paid: {{currency}} {{amount}}. Thank you for choosing Protohub."
  },
  order_failed: {
    body: "Hello {{customer}}, we could not complete delivery for order {{order_id}} ({{product_name}}, {{currency}} {{amount}}). Our team will follow up with you shortly."
  },
  order_cancelled: {
    body: "Hello {{customer}}, your order {{order_id}} for {{product_name}} has been cancelled. Order value: {{currency}} {{amount}}. If this was unexpected, please contact Protohub."
  },
  order_rescheduled: {
    body: "Hello {{customer}}, your order {{order_id}} for {{product_name}} has been rescheduled to {{scheduled_date}}. Order value: {{currency}} {{amount}}. We will follow up again as scheduled."
  },
  order_not_picking: {
    body: "Hello {{customer}}, we tried reaching you regarding order {{order_id}} for {{product_name}} ({{currency}} {{amount}}) but could not get through. Please expect another follow-up from Protohub."
  },
  order_not_ready: {
    body: "Hello {{customer}}, we understand you are not ready yet for order {{order_id}} ({{product_name}}, {{currency}} {{amount}}). We will follow up again on {{scheduled_date}}."
  },
  order_follow_up: {
    body: "Hello {{customer}}, this is a follow-up on your order {{order_id}} for {{product_name}} valued at {{currency}} {{amount}}. Next follow-up: {{scheduled_date}}. {{note_text}}"
  },
  order_follow_up_rep: {
    body: "Protohub reminder: follow up on order {{order_id}} for {{customer}} ({{phone}}) about {{product_name}} worth {{currency}} {{amount}}. Due: {{scheduled_date}}. Outcome: {{call_outcome}}. {{note_text}}"
  },
  cart_assigned: {
    body: "Hello {{customer}}, your Protohub request for {{product_name}} is now with our team. Estimated order value: {{currency}} {{amount}}. {{rep_contact}}"
  },
  cart_follow_up: {
    body: "Hello {{customer}}, we're still holding your interest in {{product_name}} for you. Estimated order value: {{currency}} {{amount}}. {{rep_contact}}"
  }
};

interface SmsSettings {
  enabled: boolean;
  provider: SmsProvider;
  api_key: string;
  sender_name: string;
  triggers: Record<string, boolean>;
  templates: Record<string, { body: string }>;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  low_balance_threshold: number;
  auto_retry_enabled: boolean;
  max_retry_attempts: number;
  retry_backoff_minutes: number;
  inbound_webhook_secret: string;
  timezone?: string;
  working_schedule_enabled?: boolean;
  working_days?: string[];
  working_day_start?: string;
  working_day_end?: string;
}

type SendSmsOptions = {
  orderId?: string | null;
  cartId?: string | null;
  audience?: "customer" | "staff";
  recipientName?: string;
  sendAt?: string | null;
  repContactLine?: string;
  metadata?: Record<string, unknown>;
  ignoreEnabled?: boolean;
  ignoreTrigger?: boolean;
  ignoreCompliance?: boolean;
};

type SmsDispatchResult = {
  provider: SmsProvider;
  providerMessageId?: string;
  providerStatus?: string;
  units?: number;
  balance?: number;
  segments: number;
  normalizedPhone: string;
};

class SmsDispatchError extends Error {
  provider: SmsProvider;
  statusCode?: number;
  code?: string;
  raw?: unknown;

  constructor(
    provider: SmsProvider,
    message: string,
    opts?: { statusCode?: number; code?: string; raw?: unknown }
  ) {
    super(message);
    this.name = "SmsDispatchError";
    this.provider = provider;
    this.statusCode = opts?.statusCode;
    this.code = opts?.code;
    this.raw = opts?.raw;
  }
}

const DEFAULT_SMS_PROVIDER: SmsProvider = "multitexter";
const MULTITEXTER_SEND_URL = "https://app.multitexter.com/v2/app/sendsms";
const MULTITEXTER_BALANCE_URL = "https://app.multitexter.com/v2/app/balance";
const MULTITEXTER_REPORT_URL = "https://app.multitexter.com/v2/app/message/report";

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
    out[normalizedKey] = {
      body: typeof template.body === "string" ? template.body : defaults[normalizedKey].body
    };
  }
  return out;
}

function applyEnvFallbacks(settings: SmsSettings): SmsSettings {
  return {
    ...settings,
    provider: settings.provider ?? DEFAULT_SMS_PROVIDER,
    api_key: settings.api_key || process.env.MULTITEXTER_API_KEY || "",
    sender_name: settings.sender_name || process.env.SMS_SENDER_NAME || "Protohub",
    quiet_hours_enabled: Boolean(settings.quiet_hours_enabled),
    quiet_hours_start: settings.quiet_hours_start || "21:00",
    quiet_hours_end: settings.quiet_hours_end || "08:00",
    low_balance_threshold: Number(settings.low_balance_threshold ?? 200) || 200,
    auto_retry_enabled: settings.auto_retry_enabled !== false,
    max_retry_attempts: Math.max(0, Number(settings.max_retry_attempts ?? 2) || 0),
    retry_backoff_minutes: Math.max(5, Number(settings.retry_backoff_minutes ?? 30) || 30),
    inbound_webhook_secret: settings.inbound_webhook_secret || "",
    timezone: settings.timezone?.trim() || "Africa/Lagos",
    working_schedule_enabled: !!settings.working_schedule_enabled,
    working_days: normalizeWorkingDays(settings.working_days ?? DEFAULT_WORKING_DAYS),
    working_day_start: settings.working_day_start || "08:00",
    working_day_end: settings.working_day_end || "18:00",
    triggers: normalizeBooleanMap(settings.triggers, DEFAULT_SMS_TRIGGERS),
    templates: normalizeTemplateMap(settings.templates, DEFAULT_SMS_TEMPLATES)
  };
}

function interpolate(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function fieldFromRecord(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null) return record[name];
  }
  const lowered = names.map((name) => name.toLowerCase());
  for (const [key, value] of Object.entries(record)) {
    if (lowered.includes(key.toLowerCase()) && value !== undefined && value !== null) return value;
  }
  return undefined;
}

function extractBalanceValue(record: Record<string, unknown>) {
  const direct = Number(fieldFromRecord(record, "balance", "Balance", "amount", "Amount"));
  if (Number.isFinite(direct)) return direct;

  const nested = record.userbalance;
  if (nested && typeof nested === "object") {
    const nestedAmount = Number(fieldFromRecord(nested as Record<string, unknown>, "balance", "Balance", "amount", "Amount"));
    if (Number.isFinite(nestedAmount)) return nestedAmount;
  }

  return null;
}

function normalizePhoneForSms(phone: string): string | null {
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

function estimateSmsSegments(message: string) {
  const isUnicode = /[^\u0000-\u007f]/.test(message);
  const single = isUnicode ? 70 : 160;
  const multi = isUnicode ? 67 : 153;
  if (message.length <= single) return 1;
  return Math.ceil(message.length / multi);
}

type AssignedRepContact = {
  name: string;
  phone: string;
  role: string;
  contactLine: string;
};

function formatPhoneForDisplay(phone: string) {
  const trimmed = phone.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;
  const normalized = normalizePhoneForSms(trimmed);
  return normalized?.startsWith("234") ? `+${normalized}` : trimmed;
}

function normalizePhoneDigitsOnly(phone: string) {
  return phone.replace(/\D/g, "");
}

function parseClockMinutes(value: string, fallback: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return hour * 60 + minute;
}

function getTimezoneMinutes(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

function isWithinQuietHours(settings: SmsSettings, at = new Date()) {
  if (!settings.quiet_hours_enabled) return false;
  const start = parseClockMinutes(settings.quiet_hours_start, 21 * 60);
  const end = parseClockMinutes(settings.quiet_hours_end, 8 * 60);
  if (start === end) return false;
  const nowMinutes = getTimezoneMinutes(at, settings.timezone ?? "Africa/Lagos");
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end;
}

function nextAllowedSendAt(settings: SmsSettings, from = new Date()) {
  if (!settings.quiet_hours_enabled && !settings.working_schedule_enabled) return null;
  let probe = new Date(from.getTime() + 60 * 1000);
  if (settings.working_schedule_enabled && !isWithinWorkingSchedule(settings, from)) {
    const nextWorkingAt = nextWorkingScheduleAt(settings, from);
    if (nextWorkingAt) probe = new Date(nextWorkingAt);
  }
  for (let i = 0; i < 10 * 24 * 60; i += 1) {
    if (isSmsAllowedNow(settings, probe)) return probe.toISOString();
    probe = new Date(probe.getTime() + 60 * 1000);
  }
  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString();
}

function isSmsAllowedNow(settings: SmsSettings, at = new Date()) {
  return isWithinWorkingSchedule(settings, at) && !isWithinQuietHours(settings, at);
}

function isRetryableSmsError(error: SmsDispatchError) {
  if (error.statusCode && error.statusCode >= 500) return true;
  const retryableCodes = new Set(["-7", "-10"]);
  if (error.code && retryableCodes.has(error.code)) return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout")
    || message.includes("network")
    || message.includes("temporar")
    || message.includes("try again")
    || message.includes("unavailable")
    || message.includes("insufficient")
  );
}

async function isSmsOptedOut(orgId: string, normalizedPhone: string) {
  const { data, error } = await supabase
    .from("sms_opt_outs")
    .select("id")
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .limit(1);

  if (error) {
    logger.warn("sms opt-out check failed", { orgId, normalizedPhone, error: error.message });
    return false;
  }

  return (data?.length ?? 0) > 0;
}

async function notifyLowBalance(orgId: string, balance: number, threshold: number) {
  if (!Number.isFinite(balance) || threshold <= 0 || balance > threshold) return;

  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("system_notifications")
    .select("id")
    .eq("org_id", orgId)
    .eq("type", "info")
    .ilike("title", "Low SMS Balance")
    .gte("created_at", since)
    .limit(1);

  if (existingError) {
    logger.warn("sms low-balance alert dedupe failed", { orgId, error: existingError.message });
    return;
  }
  if ((existing?.length ?? 0) > 0) return;

  const message = `SMS balance is low: ${balance} unit${balance === 1 ? "" : "s"} remaining. Top up Multitexter credits soon to avoid customer update failures.`;
  const { error } = await supabase.from("system_notifications").insert({
    org_id: orgId,
    type: "info",
    title: "Low SMS Balance",
    message,
    link: "/dashboard/admin/settings"
  });
  if (error) {
    logger.warn("sms low-balance alert insert failed", { orgId, error: error.message });
  }

  const settings = await loadSettings(orgId);
  if (settings) {
    await Promise.allSettled([
      sendLowSmsBalanceEmail(orgId, { balance, threshold }),
      sendLowBalanceStaffSms(orgId, settings, balance, threshold)
    ]);
  }
}

async function sendLowBalanceStaffSms(
  orgId: string,
  settings: SmsSettings,
  balance: number,
  threshold: number
) {
  if (!hasValidSettings(settings)) return;
  if (balance < 4) return;

  const { data, error } = await supabase
    .from("users")
    .select("name, phone")
    .eq("org_id", orgId)
    .eq("active", true)
    .in("role", ["Owner", "Admin"])
    .not("phone", "is", null);

  if (error) {
    logger.warn("low-balance sms recipient lookup failed", { orgId, error: error.message });
    return;
  }

  const unitLabel = balance === 1 ? "unit" : "units";
  const thresholdLabel = threshold === 1 ? "unit" : "units";
  const body = `Protohub alert: Multitexter SMS balance is low (${balance} ${unitLabel} left, threshold ${threshold} ${thresholdLabel}). Top up soon to avoid failed customer updates.`;

  for (const recipient of data ?? []) {
    if (!recipient?.phone) continue;
    const normalizedPhone = normalizePhoneForSms(recipient.phone);
    if (!normalizedPhone) continue;

    const logId = await insertSmsLog({
      org_id: orgId,
      order_id: null,
      cart_id: null,
      trigger: "internal_low_balance",
      audience: "staff",
      recipient_name: recipient.name ?? null,
      recipient_phone: recipient.phone,
      normalized_phone: normalizedPhone,
      body,
      sender_name: settings.sender_name,
      provider: settings.provider,
      segments: estimateSmsSegments(body),
      metadata: { alertType: "low_sms_balance", balance, threshold },
      status: "queued"
    });

    try {
      await deliverLoggedSms(orgId, settings, logId, normalizedPhone, body, null);
    } catch (err) {
      const normalized = normalizeSmsError(err);
      await updateSmsLog(logId, {
        status: "failed",
        error_code: normalized.code ?? null,
        error_message: normalized.message,
        provider_status: normalized.message
      });
      logger.warn("low-balance sms send failed", {
        orgId,
        to: normalizedPhone,
        error: normalized.message
      });
    }
  }
}

async function loadAssignedRepContact(orgId: string, assignedRepId?: string | null): Promise<AssignedRepContact | null> {
  if (!assignedRepId) return null;

  const { data, error } = await supabase
    .from("users")
    .select("name, phone, role")
    .eq("org_id", orgId)
    .eq("id", assignedRepId)
    .single();

  if (error || !data) {
    if (error) {
      logger.warn("sms assigned rep lookup failed", {
        orgId,
        assignedRepId,
        error: error.message
      });
    }
    return null;
  }

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const role = typeof data.role === "string" ? data.role.trim() : "";
  const phone = typeof data.phone === "string" ? formatPhoneForDisplay(data.phone) : "";
  if (!name) return null;

  const displayName = role ? `${name} (${role})` : name;
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

async function loadSettings(orgId: string): Promise<SmsSettings | null> {
  const [{ data, error }, { data: org }] = await Promise.all([
    supabase
      .from("sms_settings")
      .select("*")
      .eq("org_id", orgId)
      .single(),
    supabase
      .from("organizations")
      .select("timezone, working_schedule_enabled, working_days, working_day_start, working_day_end")
      .eq("id", orgId)
      .single()
  ]);

  if (error || !data) return null;
  return applyEnvFallbacks({
    ...(data as SmsSettings),
    timezone: typeof org?.timezone === "string" && org.timezone.trim() ? org.timezone.trim() : "Africa/Lagos",
    working_schedule_enabled: !!org?.working_schedule_enabled,
    working_days: normalizeWorkingDays(org?.working_days),
    working_day_start: typeof org?.working_day_start === "string" && org.working_day_start.trim() ? org.working_day_start.trim() : "08:00",
    working_day_end: typeof org?.working_day_end === "string" && org.working_day_end.trim() ? org.working_day_end.trim() : "18:00"
  });
}

function hasValidSettings(settings: SmsSettings | null): settings is SmsSettings {
  return !!settings?.api_key && !!settings.sender_name;
}

async function insertSmsLog(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from("sms_messages")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    logger.warn("sms log insert failed", { error: error.message });
    return null;
  }

  return data?.id as string | null;
}

async function updateSmsLog(id: string | null, payload: Record<string, unknown>) {
  if (!id) return;
  const { error } = await supabase.from("sms_messages").update(payload).eq("id", id);
  if (error) logger.warn("sms log update failed", { id, error: error.message });
}

function normalizeSmsError(err: unknown): SmsDispatchError {
  if (err instanceof SmsDispatchError) return err;
  const record = (typeof err === "object" && err) ? err as Record<string, unknown> : {};
  const message = String(
    fieldFromRecord(record, "msg", "message", "error", "ErrorMessage")
    ?? (err instanceof Error ? err.message : "SMS send failed.")
  );
  const statusCode = Number(fieldFromRecord(record, "statusCode", "status")) || undefined;
  const codeValue = fieldFromRecord(record, "code", "ErrorCode");
  return new SmsDispatchError(DEFAULT_SMS_PROVIDER, message, {
    statusCode,
    code: codeValue ? String(codeValue) : undefined,
    raw: err
  });
}

async function sendViaMultitexter(
  settings: SmsSettings,
  phone: string,
  body: string,
  sendAt?: string | null
): Promise<{
  providerMessageId?: string;
  providerStatus?: string;
  units?: number;
  balance?: number;
}> {
  const payload: Record<string, unknown> = {
    Message: body,
    message: body,
    Sender_name: settings.sender_name,
    sender_name: settings.sender_name,
    Recipients: phone,
    recipients: phone
  };
  if (sendAt) payload.sendtime = sendAt;

  const response = await fetch(MULTITEXTER_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.api_key}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const rawText = await response.text();
  const parsed = safeJsonParse<Record<string, unknown>>(rawText) ?? { raw: rawText };

  if (!response.ok) {
    throw new SmsDispatchError("multitexter", String(fieldFromRecord(parsed, "msg", "message", "error") ?? response.statusText), {
      statusCode: response.status,
      raw: parsed
    });
  }

  const statusValue = Number(fieldFromRecord(parsed, "status"));
  if (statusValue !== 1) {
    throw new SmsDispatchError("multitexter", String(fieldFromRecord(parsed, "msg", "message", "error") ?? "SMS send failed."), {
      statusCode: response.status,
      code: Number.isFinite(statusValue) ? String(statusValue) : undefined,
      raw: parsed
    });
  }

  return {
    providerMessageId: fieldFromRecord(parsed, "msgid", "Msgid", "message_id", "messageid")
      ? String(fieldFromRecord(parsed, "msgid", "Msgid", "message_id", "messageid"))
      : undefined,
    providerStatus: String(fieldFromRecord(parsed, "msg", "message") ?? "Sent"),
    units: Number(fieldFromRecord(parsed, "units", "Units")) || undefined,
    balance: extractBalanceValue(parsed) ?? undefined
  };
}

async function deliverLoggedSms(
  orgId: string,
  settings: SmsSettings,
  logId: string | null,
  normalizedPhone: string,
  body: string,
  sendAt?: string | null
): Promise<SmsDispatchResult> {
  const result = await sendViaMultitexter(settings, normalizedPhone, body, sendAt);
  await updateSmsLog(logId, {
    status: "sent",
    provider_message_id: result.providerMessageId ?? null,
    provider_status: result.providerStatus ?? null,
    units: result.units ?? 0,
    sent_at: new Date().toISOString(),
    next_retry_at: null
  });
  await notifyLowBalance(orgId, result.balance ?? Number.NaN, settings.low_balance_threshold);
  return {
    provider: settings.provider,
    providerMessageId: result.providerMessageId,
    providerStatus: result.providerStatus,
    units: result.units,
    balance: result.balance,
    segments: estimateSmsSegments(body),
    normalizedPhone
  };
}

async function dispatchSms(
  orgId: string,
  trigger: SmsTrigger,
  vars: Record<string, string>,
  recipientPhone: string,
  options: SendSmsOptions = {}
): Promise<SmsDispatchResult | null> {
  const settings = await loadSettings(orgId);
  if (!settings) return null;
  if (!options.ignoreEnabled && !settings.enabled) return null;
  if (!options.ignoreTrigger && !settings.triggers?.[trigger]) return null;
  if (!hasValidSettings(settings)) return null;

  const normalizedPhone = normalizePhoneForSms(recipientPhone);
  if (!normalizedPhone) {
    logger.warn("sms skipped: invalid phone", { orgId, trigger, phone: recipientPhone });
    return null;
  }

  const template = settings.templates?.[trigger];
  if (!template?.body) return null;

  const hasRepContactPlaceholder =
    /\{\{rep_contact\}\}/.test(template.body)
    || (/\{\{rep_name\}\}/.test(template.body) && /\{\{rep_phone\}\}/.test(template.body));
  let messageBody = interpolate(template.body, vars).trim();
  if (options.repContactLine && !hasRepContactPlaceholder && !messageBody.includes(options.repContactLine)) {
    messageBody = `${messageBody} ${options.repContactLine}`.trim();
  }
  if (!messageBody) return null;

  const segments = estimateSmsSegments(messageBody);
  const metadata = options.metadata ?? {};
  const baseLogPayload = {
    org_id: orgId,
    order_id: options.orderId ?? null,
    cart_id: options.cartId ?? null,
    trigger,
    audience: options.audience ?? "customer",
    recipient_name: options.recipientName ?? null,
    recipient_phone: recipientPhone,
    normalized_phone: normalizedPhone,
    body: messageBody,
    sender_name: settings.sender_name,
    provider: settings.provider,
    segments,
    metadata
  };

  if (!options.ignoreCompliance && options.audience !== "staff") {
    if (await isSmsOptedOut(orgId, normalizedPhone)) {
      await insertSmsLog({
        ...baseLogPayload,
        status: "blocked",
        error_message: "Recipient opted out of SMS updates.",
        provider_status: "Opted out"
      });
      logger.info("sms blocked: opted out", { orgId, trigger, normalizedPhone });
      return null;
    }

    if (!isSmsAllowedNow(settings)) {
      const scheduledFor = nextAllowedSendAt(settings) ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await insertSmsLog({
        ...baseLogPayload,
        status: "deferred",
        scheduled_for: scheduledFor,
        provider_status: settings.working_schedule_enabled && !isWithinWorkingSchedule(settings)
          ? "Deferred for next working slot"
          : "Deferred for quiet hours"
      });
      logger.info("sms deferred", {
        orgId,
        trigger,
        normalizedPhone,
        scheduledFor,
        reason: settings.working_schedule_enabled && !isWithinWorkingSchedule(settings) ? "working_schedule" : "quiet_hours"
      });
      return null;
    }
  }

  const logId = await insertSmsLog({
    ...baseLogPayload,
    status: "queued",
    segments,
    scheduled_for: options.sendAt ?? null,
    metadata
  });

  try {
    const result = await deliverLoggedSms(orgId, settings, logId, normalizedPhone, messageBody, options.sendAt);
    logger.info("sms sent", {
      orgId,
      trigger,
      provider: settings.provider,
      to: normalizedPhone,
      providerMessageId: result.providerMessageId ?? null
    });
    return result;
  } catch (err) {
    const normalized = normalizeSmsError(err);
    const retryable = settings.auto_retry_enabled && isRetryableSmsError(normalized) && settings.max_retry_attempts > 0;
    const nextRetryAt = retryable
      ? new Date(Date.now() + settings.retry_backoff_minutes * 60 * 1000).toISOString()
      : null;
    await updateSmsLog(logId, {
      status: "failed",
      error_code: normalized.code ?? null,
      error_message: normalized.message,
      provider_status: normalized.message,
      next_retry_at: nextRetryAt
    });
    if (normalized.code === "-7" || normalized.message.toLowerCase().includes("insufficient")) {
      await notifyLowBalance(orgId, 0, settings.low_balance_threshold);
    }
    logger.error("sms send failed", {
      orgId,
      trigger,
      to: normalizedPhone,
      statusCode: normalized.statusCode,
      code: normalized.code,
      error: normalized.message,
      retryScheduled: !!nextRetryAt
    });
    if (options.ignoreEnabled) throw normalized;
    return null;
  }
}

function resolvePostponedTrigger(callOutcome?: string | null, response?: string | null): SmsTrigger {
  const combined = `${callOutcome ?? ""} ${response ?? ""}`.toLowerCase();
  if (
    combined.includes("not ready")
    || combined.includes("later")
    || combined.includes("travel")
    || combined.includes("travell")
  ) {
    return "order_not_ready";
  }
  if (
    combined.includes("no answer")
    || combined.includes("not reached")
    || combined.includes("not picking")
    || combined.includes("switched off")
    || combined.includes("busy")
    || combined.includes("unreachable")
  ) {
    return "order_not_picking";
  }
  return "order_rescheduled";
}

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
  scheduled_date?: string | null;
  scheduled_at?: string | null;
  call_outcome?: string | null;
  response?: string | null;
  notes?: unknown;
  timeline_notes?: unknown;
};

const orderDisplayName = (value: { product_name: string; package_name?: string | null }) =>
  value.package_name?.trim()
    ? `${value.product_name} — ${value.package_name}`
    : value.product_name;

const cartDisplayName = (value: { product_name: string; package_name?: string | null }) =>
  value.package_name?.trim()
    ? `${value.product_name} — ${value.package_name}`
    : value.product_name;

type TimelineReminderNote = {
  id: string;
  text: string;
  followUpDate?: string;
  followUpAt?: string;
};

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

async function reminderAlreadyLogged(
  orgId: string,
  orderId: string,
  dedupeKey: string,
  trigger: SmsTrigger = "order_follow_up"
) {
  const { data, error } = await supabase
    .from("sms_messages")
    .select("id")
    .eq("org_id", orgId)
    .eq("order_id", orderId)
    .eq("trigger", trigger)
    .neq("status", "failed")
    .contains("metadata", { dedupeKey })
    .limit(1);

  if (error) {
    logger.warn("sms reminder dedupe check failed", { orgId, orderId, dedupeKey, trigger, error: error.message });
    return false;
  }

  return (data?.length ?? 0) > 0;
}

async function sendFollowUpReminderSms(
  orgId: string,
  order: DueReminderOrder,
  options: {
    dedupeKey: string;
    scheduledLabel: string;
    noteText?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const assignedRep = await loadAssignedRepContact(orgId, order.assigned_rep_id);
  return dispatchSms(
    orgId,
    "order_follow_up",
    {
      order_id: order.id,
      customer: order.customer,
      product_name: orderDisplayName(order),
      amount: typeof order.amount === "number" ? String(order.amount) : "0",
      currency: order.currency ?? "NGN",
      from_status: order.status ?? "—",
      status: order.status ?? "—",
      scheduled_date: options.scheduledLabel,
      call_outcome: order.call_outcome ?? "—",
      response: order.response ?? "Follow-up reminder",
      note_text: options.noteText ?? "",
      rep_name: assignedRep?.name ?? "",
      rep_phone: assignedRep?.phone ?? "",
      rep_contact: assignedRep?.contactLine ?? ""
    },
    order.phone ?? "",
    {
      orderId: order.id,
      audience: "customer",
      recipientName: order.customer,
      repContactLine: assignedRep?.contactLine,
      metadata: {
        event: "order_follow_up",
        assignedRepId: order.assigned_rep_id ?? null,
        assignedRepName: assignedRep?.name ?? null,
        assignedRepPhone: assignedRep?.phone ?? null,
        dedupeKey: options.dedupeKey,
        ...(options.metadata ?? {})
      }
    }
  );
}

export async function sendAssignedRepFollowUpReminderSms(
  orgId: string,
  order: DueReminderOrder,
  options: {
    dedupeKey: string;
    scheduledLabel: string;
    noteText?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const assignedRep = await loadAssignedRepContact(orgId, order.assigned_rep_id);
  if (!assignedRep?.phone?.trim()) return null;
  if (await reminderAlreadyLogged(orgId, order.id, options.dedupeKey, "order_follow_up_rep")) {
    return null;
  }

  return dispatchSms(
    orgId,
    "order_follow_up_rep",
    {
      order_id: order.id,
      customer: order.customer,
      phone: order.phone ?? "No phone recorded",
      product_name: orderDisplayName(order),
      amount: typeof order.amount === "number" ? String(order.amount) : "0",
      currency: order.currency ?? "NGN",
      from_status: order.status ?? "—",
      status: order.status ?? "—",
      scheduled_date: options.scheduledLabel,
      call_outcome: order.call_outcome ?? "—",
      response: order.response ?? "Follow-up reminder",
      note_text: options.noteText ?? "",
      rep_name: assignedRep.name,
      rep_phone: assignedRep.phone,
      rep_contact: assignedRep.contactLine
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

export async function getSmsBalance(orgId: string): Promise<{ balance: number | null; raw?: unknown }> {
  const settings = await loadSettings(orgId);
  if (!hasValidSettings(settings)) {
    throw new SmsDispatchError("multitexter", "SMS provider is not configured yet.");
  }

  const response = await fetch(MULTITEXTER_BALANCE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.api_key}`,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });

  const rawText = await response.text();
  const parsed = safeJsonParse<Record<string, unknown>>(rawText) ?? { raw: rawText };
  if (!response.ok) {
    throw new SmsDispatchError("multitexter", String(fieldFromRecord(parsed, "msg", "message", "error") ?? response.statusText), {
      statusCode: response.status,
      raw: parsed
    });
  }

  const balance = extractBalanceValue(parsed);
  if (balance !== null) {
    await notifyLowBalance(orgId, balance, settings.low_balance_threshold);
  }
  return { balance, raw: parsed };
}

export async function sendTestSms(orgId: string, phone: string) {
  const settings = await loadSettings(orgId);
  if (!settings) return { ok: false, error: "SMS settings not configured." };
  if (!hasValidSettings(settings)) return { ok: false, error: "Add your Multitexter API key first." };

  const result = await dispatchSms(
    orgId,
    "order_status_change",
    {
      customer: "Protohub Test",
      order_id: "TEST-SMS",
      from_status: "Pending",
      status: "Connected",
      product_name: "SMS Diagnostics",
      amount: "0",
      currency: "NGN"
    },
    phone,
    {
      ignoreEnabled: true,
      ignoreTrigger: true,
      ignoreCompliance: true,
      audience: "customer",
      recipientName: "Protohub Test",
      metadata: { kind: "test_sms" }
    }
  ).catch((err: unknown) => {
    const normalized = normalizeSmsError(err);
    return { error: normalized.message };
  });

  if (!result || "error" in result) {
    return { ok: false, error: result?.error ?? "SMS test failed." };
  }

  return {
    ok: true,
    provider: result.provider,
    providerMessageId: result.providerMessageId ?? null,
    units: result.units ?? 0,
    segments: result.segments
  };
}

export async function sendNewOrderSms(
  orgId: string,
  order: {
    id: string;
    customer: string;
    phone: string;
    assignedRepId?: string | null;
    product_name: string;
    package_name?: string | null;
    amount: number;
    currency: string;
  }
) {
  const assignedRep = await loadAssignedRepContact(orgId, order.assignedRepId);
  return dispatchSms(
    orgId,
    "order_new",
    {
      order_id: order.id,
      customer: order.customer,
      product_name: orderDisplayName(order),
      amount: String(order.amount),
      currency: order.currency,
      rep_name: assignedRep?.name ?? "",
      rep_phone: assignedRep?.phone ?? "",
      rep_contact: assignedRep?.contactLine ?? ""
    },
    order.phone,
    {
      orderId: order.id,
      audience: "customer",
      recipientName: order.customer,
      repContactLine: assignedRep?.contactLine,
      metadata: {
        event: "order_new",
        assignedRepId: order.assignedRepId ?? null,
        assignedRepName: assignedRep?.name ?? null,
        assignedRepPhone: assignedRep?.phone ?? null
      }
    }
  );
}

export async function sendOrderStatusSms(
  orgId: string,
  order: {
    id: string;
    customer: string;
    phone: string;
    assignedRepId?: string | null;
    product_name: string;
    package_name?: string | null;
    amount: number;
    currency: string;
    scheduled_date?: string | null;
    call_outcome?: string | null;
    response?: string | null;
  },
  fromStatus: string | null,
  toStatus: string
) {
  let trigger: SmsTrigger;
  if (toStatus === "Delivered") trigger = "order_delivered";
  else if (toStatus === "Failed") trigger = "order_failed";
  else if (toStatus === "Cancelled") trigger = "order_cancelled";
  else if (toStatus === "Postponed") trigger = resolvePostponedTrigger(order.call_outcome, order.response);
  else trigger = "order_status_change";

  const assignedRep = await loadAssignedRepContact(orgId, order.assignedRepId);

  return dispatchSms(
    orgId,
    trigger,
    {
      order_id: order.id,
      customer: order.customer,
      product_name: orderDisplayName(order),
      amount: String(order.amount),
      currency: order.currency,
      from_status: fromStatus ?? "—",
      status: toStatus,
      scheduled_date: order.scheduled_date ?? "soon",
      call_outcome: order.call_outcome ?? "—",
      response: order.response ?? "—",
      rep_name: assignedRep?.name ?? "",
      rep_phone: assignedRep?.phone ?? "",
      rep_contact: assignedRep?.contactLine ?? ""
    },
    order.phone,
    {
      orderId: order.id,
      audience: "customer",
      recipientName: order.customer,
      repContactLine: assignedRep?.contactLine,
      metadata: {
        event: "order_status",
        fromStatus,
        toStatus,
        trigger,
        assignedRepId: order.assignedRepId ?? null,
        assignedRepName: assignedRep?.name ?? null,
        assignedRepPhone: assignedRep?.phone ?? null
      }
    }
  );
}

type CartSmsContext = {
  id: string;
  customer: string;
  phone: string;
  product_name: string;
  package_name?: string | null;
  amount: number;
  currency: string;
  assignedRepId?: string | null;
};

type SmsOptOutRecord = {
  id: string;
  org_id: string;
  phone: string;
  normalized_phone: string;
  keyword?: string | null;
  source: string;
  note?: string | null;
  created_at: string;
};

type SmsInboundRecord = {
  id: string;
  org_id?: string | null;
  provider: string;
  sender_phone: string;
  normalized_phone: string;
  receiver?: string | null;
  sender_name?: string | null;
  body: string;
  keyword?: string | null;
  action?: string | null;
  linked_order_id?: string | null;
  metadata?: Record<string, unknown>;
  processed: boolean;
  processed_at?: string | null;
  received_at: string;
  created_at: string;
};

async function getRecentOrderForPhone(orgId: string, normalizedPhone: string) {
  const { data } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", orgId)
    .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-10)}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

export async function listSmsOptOuts(orgId: string) {
  const { data, error } = await supabase
    .from("sms_opt_outs")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SmsOptOutRecord[];
}

export async function addSmsOptOut(
  orgId: string,
  phone: string,
  source = "manual",
  keyword?: string | null,
  note?: string | null
) {
  const normalizedPhone = normalizePhoneForSms(phone);
  if (!normalizedPhone) throw new Error("Enter a valid phone number.");

  const payload = {
    org_id: orgId,
    phone: phone.trim(),
    normalized_phone: normalizedPhone,
    source,
    keyword: keyword?.trim() || null,
    note: note?.trim() || null
  };

  const { data, error } = await supabase
    .from("sms_opt_outs")
    .upsert(payload, { onConflict: "org_id,normalized_phone" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as SmsOptOutRecord;
}

export async function removeSmsOptOut(orgId: string, phone: string) {
  const normalizedPhone = normalizePhoneForSms(phone) ?? normalizePhoneDigitsOnly(phone);
  const { error } = await supabase
    .from("sms_opt_outs")
    .delete()
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone);
  if (error) throw new Error(error.message);
  return normalizedPhone;
}

export async function listSmsInboundMessages(orgId: string, limit = 50) {
  const { data, error } = await supabase
    .from("sms_inbound_messages")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as SmsInboundRecord[];
}

export async function rotateSmsInboundWebhookSecret(orgId: string) {
  const secret = crypto.randomUUID().replace(/-/g, "");
  const { data, error } = await supabase
    .from("sms_settings")
    .upsert({
      org_id: orgId,
      inbound_webhook_secret: secret,
      updated_at: new Date().toISOString()
    }, { onConflict: "org_id" })
    .select("inbound_webhook_secret")
    .single();
  if (error) throw new Error(error.message);
  return data?.inbound_webhook_secret ?? secret;
}

export async function sendCartAssignedSms(orgId: string, cart: CartSmsContext) {
  const assignedRep = await loadAssignedRepContact(orgId, cart.assignedRepId);
  return dispatchSms(
    orgId,
    "cart_assigned",
    {
      cart_id: cart.id,
      customer: cart.customer,
      product_name: cartDisplayName(cart),
      amount: String(cart.amount),
      currency: cart.currency,
      rep_name: assignedRep?.name ?? "",
      rep_phone: assignedRep?.phone ?? "",
      rep_contact: assignedRep?.contactLine ?? ""
    },
    cart.phone,
    {
      cartId: cart.id,
      audience: "customer",
      recipientName: cart.customer,
      repContactLine: assignedRep?.contactLine,
      metadata: {
        event: "cart_assigned",
        assignedRepId: cart.assignedRepId ?? null,
        assignedRepName: assignedRep?.name ?? null,
        assignedRepPhone: assignedRep?.phone ?? null
      }
    }
  );
}

async function sendCartFollowUpSms(orgId: string, cart: CartSmsContext, dedupeKey: string) {
  const assignedRep = await loadAssignedRepContact(orgId, cart.assignedRepId);
  return dispatchSms(
    orgId,
    "cart_follow_up",
    {
      cart_id: cart.id,
      customer: cart.customer,
      product_name: cartDisplayName(cart),
      amount: String(cart.amount),
      currency: cart.currency,
      rep_name: assignedRep?.name ?? "",
      rep_phone: assignedRep?.phone ?? "",
      rep_contact: assignedRep?.contactLine ?? ""
    },
    cart.phone,
    {
      cartId: cart.id,
      audience: "customer",
      recipientName: cart.customer,
      repContactLine: assignedRep?.contactLine,
      metadata: {
        event: "cart_follow_up",
        dedupeKey,
        assignedRepId: cart.assignedRepId ?? null,
        assignedRepName: assignedRep?.name ?? null,
        assignedRepPhone: assignedRep?.phone ?? null
      }
    }
  );
}

async function cartReminderAlreadyLogged(orgId: string, cartId: string, dedupeKey: string) {
  const { data, error } = await supabase
    .from("sms_messages")
    .select("id")
    .eq("org_id", orgId)
    .eq("cart_id", cartId)
    .eq("trigger", "cart_follow_up")
    .neq("status", "failed")
    .contains("metadata", { dedupeKey })
    .limit(1);

  if (error) {
    logger.warn("cart sms reminder dedupe failed", { orgId, cartId, dedupeKey, error: error.message });
    return false;
  }
  return (data?.length ?? 0) > 0;
}

export async function resendSmsMessage(orgId: string, messageId: string) {
  const settings = await loadSettings(orgId);
  if (!hasValidSettings(settings)) throw new Error("SMS settings not configured.");

  const { data: message, error } = await supabase
    .from("sms_messages")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", messageId)
    .single();
  if (error || !message) throw new Error("SMS message not found.");

  const body = String(message.body ?? "").trim();
  const recipientPhone = String(message.recipient_phone ?? "").trim();
  const normalizedPhone = normalizePhoneForSms(recipientPhone);
  if (!body || !normalizedPhone) throw new Error("SMS body or recipient is invalid.");

  if (await isSmsOptedOut(orgId, normalizedPhone)) {
    throw new Error("This customer has opted out of SMS updates.");
  }

  const resendLogId = await insertSmsLog({
    org_id: orgId,
    order_id: message.order_id ?? null,
    cart_id: message.cart_id ?? null,
    trigger: message.trigger ?? "order_status_change",
    audience: message.audience ?? "customer",
    recipient_name: message.recipient_name ?? null,
    recipient_phone: recipientPhone,
    normalized_phone: normalizedPhone,
    body,
    sender_name: settings.sender_name,
    provider: settings.provider,
    status: isWithinQuietHours(settings) ? "deferred" : "queued",
    segments: estimateSmsSegments(body),
    scheduled_for: isWithinQuietHours(settings) ? nextAllowedSendAt(settings) : null,
    metadata: {
      ...(typeof message.metadata === "object" && message.metadata ? message.metadata : {}),
      resendOf: message.id
    }
  });

  if (isWithinQuietHours(settings)) {
    return { deferred: true, logId: resendLogId };
  }

  try {
    const result = await deliverLoggedSms(orgId, settings, resendLogId, normalizedPhone, body, null);
    return { deferred: false, logId: resendLogId, result };
  } catch (error) {
    const normalized = normalizeSmsError(error);
    await updateSmsLog(resendLogId, {
      status: "failed",
      error_code: normalized.code ?? null,
      error_message: normalized.message,
      provider_status: normalized.message
    });
    throw normalized;
  }
}

export async function receiveInboundSms(
  orgId: string,
  secret: string,
  payload: Record<string, unknown>
) {
  const { data: settings, error } = await supabase
    .from("sms_settings")
    .select("inbound_webhook_secret")
    .eq("org_id", orgId)
    .single();

  if (error || !settings?.inbound_webhook_secret || settings.inbound_webhook_secret !== secret) {
    throw new Error("Invalid inbound SMS signature.");
  }

  const senderPhone =
    String(
      fieldFromRecord(payload, "from", "sender", "msisdn", "phone", "mobile", "sender_phone")
      ?? ""
    ).trim();
  const body = String(fieldFromRecord(payload, "message", "text", "body", "msg") ?? "").trim();
  if (!senderPhone || !body) {
    throw new Error("Inbound SMS payload is missing sender or message.");
  }

  const normalizedPhone = normalizePhoneForSms(senderPhone) ?? normalizePhoneDigitsOnly(senderPhone);
  const keyword = body.split(/\s+/)[0]?.toUpperCase() ?? "";
  const receiver = String(fieldFromRecord(payload, "to", "receiver", "shortcode", "recipient") ?? "").trim() || null;
  const senderName = String(fieldFromRecord(payload, "sender_name", "name") ?? "").trim() || null;
  let action = "logged";

  if (["STOP", "UNSUBSCRIBE", "END", "CANCEL", "QUIT", "STOPALL"].includes(keyword)) {
    await addSmsOptOut(orgId, senderPhone, "inbound", keyword, "Customer opted out by SMS reply.");
    action = "opted_out";
  } else if (["START", "UNSTOP", "RESUME", "YES"].includes(keyword)) {
    await removeSmsOptOut(orgId, senderPhone);
    action = "opted_in";
  }

  const linkedOrderId = normalizedPhone ? await getRecentOrderForPhone(orgId, normalizedPhone) : null;
  const insertPayload = {
    org_id: orgId,
    provider: "multitexter",
    sender_phone: senderPhone,
    normalized_phone: normalizedPhone,
    receiver,
    sender_name: senderName,
    body,
    keyword: keyword || null,
    action,
    linked_order_id: linkedOrderId,
    metadata: payload,
    processed: true,
    processed_at: new Date().toISOString()
  };

  const { data, error: insertError } = await supabase
    .from("sms_inbound_messages")
    .insert(insertPayload)
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);

  return data as SmsInboundRecord;
}

function normalizeDeliveryStatus(rawStatus: unknown): "sent" | "delivered" | "failed" | null {
  const value = String(rawStatus ?? "").toLowerCase();
  if (!value) return null;
  if (value.includes("deliver")) return "delivered";
  if (value.includes("fail") || value.includes("undeliver") || value.includes("reject")) return "failed";
  if (value.includes("sent") || value.includes("submit") || value.includes("queued") || value.includes("pending")) return "sent";
  return null;
}

export async function syncSmsDeliveryReports(limit = 200) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: messages, error } = await supabase
    .from("sms_messages")
    .select("id, org_id, provider_message_id")
    .eq("provider", "multitexter")
    .in("status", ["queued", "sent"])
    .not("provider_message_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    logger.error("sms DLR query failed", { error: error.message });
    return;
  }

  const groups = new Map<string, { id: string; providerMessageId: string }[]>();
  for (const row of messages ?? []) {
    if (!row.provider_message_id) continue;
    const current = groups.get(row.org_id) ?? [];
    current.push({ id: row.id, providerMessageId: row.provider_message_id });
    groups.set(row.org_id, current);
  }

  for (const [orgId, rows] of groups.entries()) {
    const settings = await loadSettings(orgId);
    if (!hasValidSettings(settings)) continue;

    const msgIds = rows.map((row) => row.providerMessageId);
    try {
      const response = await fetch(MULTITEXTER_REPORT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${settings.api_key}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          Msgids: msgIds.join(","),
          msgids: msgIds.join(",")
        })
      });

      const rawText = await response.text();
      const parsed = safeJsonParse<Record<string, unknown>>(rawText) ?? { raw: rawText };
      if (!response.ok) {
        logger.warn("sms DLR request failed", { orgId, status: response.status, body: parsed });
        continue;
      }

      const data = fieldFromRecord(parsed, "data");
      const reports = Array.isArray(data) ? data : [];
      for (const report of reports) {
        if (!report || typeof report !== "object") continue;
        const record = report as Record<string, unknown>;
        const providerMessageId = fieldFromRecord(record, "msgid", "Msgid", "message_id", "messageid", "msg_id");
        const nextStatus = normalizeDeliveryStatus(fieldFromRecord(record, "status", "delivery_status", "dlr_status", "message_status"));
        if (!providerMessageId || !nextStatus) continue;

        const local = rows.find((row) => row.providerMessageId === String(providerMessageId));
        if (!local) continue;

        await updateSmsLog(local.id, {
          status: nextStatus,
          provider_status: String(fieldFromRecord(record, "status", "delivery_status", "dlr_status", "message_status") ?? nextStatus),
          delivered_at: nextStatus === "delivered" ? new Date().toISOString() : null
        });
      }
    } catch (err) {
      logger.warn("sms DLR sync failed", {
        orgId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

export async function syncDueFollowUpSms(limitPerOrg = 300) {
  const { data: settingsRows, error } = await supabase
    .from("sms_settings")
    .select("org_id, enabled, triggers");

  if (error) {
    logger.error("sms follow-up sync settings query failed", { error: error.message });
    return;
  }

  const eligibleOrgIds = (settingsRows ?? [])
    .filter((row) => {
      const triggers = normalizeBooleanMap((row as Record<string, unknown>).triggers, DEFAULT_SMS_TRIGGERS);
      return !!row.enabled && !!triggers.order_follow_up;
    })
    .map((row) => row.org_id as string)
    .filter(Boolean);

  if (!eligibleOrgIds.length) return;

  const now = new Date();

  for (const orgId of eligibleOrgIds) {
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, org_id, customer, phone, assigned_rep_id, product_name, package_name, amount, currency, status, scheduled_date, scheduled_at, call_outcome, response, notes, timeline_notes")
      .eq("org_id", orgId)
      .in("status", ["Confirmed", "In Process", "Dispatched", "Postponed"])
      .limit(limitPerOrg);

    if (ordersError) {
      logger.warn("sms follow-up sync order query failed", { orgId, error: ordersError.message });
      continue;
    }

    for (const order of (orders ?? []) as DueReminderOrder[]) {
      if (!order.phone?.trim()) continue;

      const scheduledDue = dueIsoMoment(order.scheduled_at ?? order.scheduled_date ?? null, now);
      if (scheduledDue && withinReminderWindow(scheduledDue, now)) {
        const dedupeKey = `scheduled:${order.scheduled_at ?? order.scheduled_date}`;
        if (!(await reminderAlreadyLogged(orgId, order.id, dedupeKey))) {
          await sendFollowUpReminderSms(orgId, order, {
            dedupeKey,
            scheduledLabel: order.scheduled_at ?? order.scheduled_date ?? toDateKey(scheduledDue),
            metadata: {
              kind: "scheduled_delivery_reminder",
              scheduledAt: order.scheduled_at ?? null,
              scheduledDate: order.scheduled_date ?? null
            }
          });
        }
      }

      for (const note of normalizeTimelineReminderNotes(order)) {
        const noteDue = dueIsoMoment(note.followUpAt ?? note.followUpDate ?? null, now);
        if (!noteDue || !withinReminderWindow(noteDue, now)) continue;

        const dedupeKey = `note:${note.id}:${note.followUpAt ?? note.followUpDate}`;
        if (await reminderAlreadyLogged(orgId, order.id, dedupeKey)) continue;

        await sendFollowUpReminderSms(orgId, order, {
          dedupeKey,
          scheduledLabel: note.followUpAt ?? note.followUpDate ?? toDateKey(noteDue),
          noteText: note.text,
          metadata: {
            kind: "timeline_follow_up",
            noteId: note.id,
            followUpAt: note.followUpAt ?? null,
            followUpDate: note.followUpDate ?? null
          }
        });
      }
    }
  }
}

export async function syncDueAbandonedCartSms(limitPerOrg = 300) {
  const { data: settingsRows, error } = await supabase
    .from("sms_settings")
    .select("org_id, enabled, triggers");

  if (error) {
    logger.error("sms cart sync settings query failed", { error: error.message });
    return;
  }

  const eligibleOrgIds = (settingsRows ?? [])
    .filter((row) => {
      const triggers = normalizeBooleanMap((row as Record<string, unknown>).triggers, DEFAULT_SMS_TRIGGERS);
      return !!row.enabled && !!triggers.cart_follow_up;
    })
    .map((row) => row.org_id as string)
    .filter(Boolean);

  if (!eligibleOrgIds.length) return;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const todayKey = new Date().toISOString().slice(0, 10);

  for (const orgId of eligibleOrgIds) {
    const { data: carts, error: cartsError } = await supabase
      .from("abandoned_carts")
      .select("id, customer, phone, product_name, package_name, amount, currency, assigned_rep_id, status, last_activity")
      .eq("org_id", orgId)
      .in("status", ["Open abandoned", "Assigned", "Contacted"])
      .lt("last_activity", cutoff)
      .order("last_activity", { ascending: true })
      .limit(limitPerOrg);

    if (cartsError) {
      logger.warn("sms cart sync query failed", { orgId, error: cartsError.message });
      continue;
    }

    for (const cart of carts ?? []) {
      if (!cart.phone?.trim()) continue;
      const dedupeKey = `cart-follow-up:${todayKey}`;
      if (await cartReminderAlreadyLogged(orgId, cart.id, dedupeKey)) continue;
      await sendCartFollowUpSms(orgId, {
        id: cart.id,
        customer: cart.customer ?? "Customer",
        phone: cart.phone,
        product_name: cart.product_name ?? "your requested item",
        package_name: cart.package_name ?? null,
        amount: Number(cart.amount ?? 0),
        currency: cart.currency ?? "NGN",
        assignedRepId: cart.assigned_rep_id ?? null
      }, dedupeKey);
    }
  }
}

export async function processQueuedSms(limit = 150) {
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("sms_messages")
    .select("id, org_id, recipient_phone, normalized_phone, body, provider, status, retry_count, next_retry_at, scheduled_for")
    .or(`and(status.eq.deferred,scheduled_for.lte.${nowIso}),and(status.eq.failed,next_retry_at.lte.${nowIso})`)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    logger.error("sms queue query failed", { error: error.message });
    return;
  }

  for (const row of rows ?? []) {
    const settings = await loadSettings(row.org_id);
    if (!hasValidSettings(settings)) continue;
    const nextRetryCount = Number(row.retry_count ?? 0) + 1;
    if (row.status === "failed" && nextRetryCount > settings.max_retry_attempts) {
      continue;
    }

    if (await isSmsOptedOut(row.org_id, row.normalized_phone)) {
      await updateSmsLog(row.id, {
        status: "blocked",
        error_message: "Recipient opted out of SMS updates.",
        provider_status: "Opted out",
        next_retry_at: null
      });
      continue;
    }

    if (!isSmsAllowedNow(settings)) {
      await updateSmsLog(row.id, {
        status: "deferred",
        scheduled_for: nextAllowedSendAt(settings),
        next_retry_at: null,
        provider_status: settings.working_schedule_enabled && !isWithinWorkingSchedule(settings)
          ? "Deferred for next working slot"
          : "Deferred for quiet hours"
      });
      continue;
    }

    try {
      await updateSmsLog(row.id, {
        retry_count: nextRetryCount,
        last_retry_at: new Date().toISOString(),
        error_message: null,
        error_code: null
      });
      await deliverLoggedSms(row.org_id, settings, row.id, row.normalized_phone, row.body, null);
    } catch (error) {
      const normalized = normalizeSmsError(error);
      const retryable = settings.auto_retry_enabled && isRetryableSmsError(normalized) && nextRetryCount <= settings.max_retry_attempts;
      const nextRetryAt = retryable
        ? new Date(Date.now() + settings.retry_backoff_minutes * 60 * 1000).toISOString()
        : null;
      await updateSmsLog(row.id, {
        status: "failed",
        retry_count: nextRetryCount,
        last_retry_at: new Date().toISOString(),
        next_retry_at: nextRetryAt,
        error_code: normalized.code ?? null,
        error_message: normalized.message,
        provider_status: normalized.message
      });
      if (normalized.code === "-7" || normalized.message.toLowerCase().includes("insufficient")) {
        await notifyLowBalance(row.org_id, 0, settings.low_balance_threshold);
      }
    }
  }
}
