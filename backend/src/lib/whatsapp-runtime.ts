import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DisconnectReason, Browsers, useMultiFileAuthState, initAuthCreds, BufferJSON } from "@whiskeysockets/baileys";
import makeWASocket from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import { nextWorkingScheduleAt, normalizeWorkingDays, type WorkingDayName, type WorkingSchedule } from "./business-schedule.js";
import { recordContactAttemptAndNextAction, recordFollowUpProgressNote } from "./follow-up-workflow.js";
import { logger } from "./logger.js";
import { supabase } from "./supabase.js";

export type WhatsAppPairingMode = "qr" | "pairing_code";

type RuntimeRow = {
  org_id: string;
  enabled?: boolean | null;
  connection_status?: string | null;
  pairing_mode?: WhatsAppPairingMode | null;
  pairing_phone?: string | null;
};

type UserRuntimeRow = RuntimeRow & {
  user_id: string;
};

type RuntimeConnection = {
  orgId: string;
  socket: ReturnType<typeof makeWASocket> | null;
  connecting: Promise<void> | null;
  disconnecting: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  mode: WhatsAppPairingMode;
  pairingPhone: string | null;
};

type UserRuntimeConnection = RuntimeConnection & {
  userId: string;
  runtimeKey: string;
};

const quietLogger = pino({ level: "silent" });
const runtimeConnections = new Map<string, RuntimeConnection>();
const userRuntimeConnections = new Map<string, UserRuntimeConnection>();
const defaultSessionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.runtime/whatsapp");
const sessionRoot = path.resolve(process.env.WHATSAPP_SESSION_DIR?.trim() || defaultSessionRoot);
const WHATSAPP_READY_TIMEOUT_MS = 20_000;

const normalizeDigits = (value: string | null | undefined) => String(value ?? "").replace(/\D/g, "");

type InboundAutomationDirective =
  | { kind: "confirm"; label: string; outcomeCode: string; replyNote: string }
  | {
      kind: "callback";
      label: string;
      outcomeCode: string;
      replyNote: string;
      timingMode: "fallback" | "later" | "tomorrow";
      nextActionType: "callback" | "payment_check";
    }
  | { kind: "manager_help"; label: string; replyNote: string }
  | { kind: "owner_help"; label: string; replyNote: string }
  | null;

type StaffActor = {
  id: string;
  name: string;
  role: string;
  normalizedPhone: string;
};

type LinkedOrderAutomationRecord = {
  id: string;
  customer?: string | null;
  phone?: string | null;
  state?: string | null;
  assigned_rep_id?: string | null;
  product_name?: string | null;
  package_name?: string | null;
  amount?: number | null;
  currency?: string | null;
  status?: string | null;
  scheduled_date?: string | null;
  scheduled_at?: string | null;
  call_outcome?: string | null;
  response?: string | null;
  notes?: unknown;
  timeline_notes?: unknown;
};

type LocalDateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: WorkingDayName;
};

type ParsedReplyClock = {
  clock24: string;
  minutes: number;
  label: string;
};

type ParsedReplyOffset = {
  minutes: number;
  label: string;
};

type ParsedReplyWeekday = {
  weekday: WorkingDayName;
  label: string;
};

type RecentReplyContext = {
  lastOutcomeCode?: string | null;
  lastNextActionType?: "callback" | "payment_check" | null;
  lastNextActionAt?: string | null;
  pendingClarification?: {
    sourceBody: string;
    nextActionType?: "callback" | "payment_check" | null;
  } | null;
  pendingConfirmation?: {
    sourceBody: string;
    label: string;
    outcomeCode: string;
    nextActionType?: "callback" | "payment_check" | null;
    timingMode?: "fallback" | "later" | "tomorrow";
    previewNextActionAt?: string | null;
  } | null;
};

type RecentThreadMessage = {
  body: string;
  receivedAt: string;
};

type LinkedOrderResolution = {
  linkedOrderId: string | null;
  mode: "explicit_ref" | "single_recent" | "ambiguous" | "not_found";
  candidateOrderIds: string[];
  explicitOrderId?: string | null;
};

const DEFAULT_WORKING_START = "08:00";
const DEFAULT_WORKING_END = "18:00";
const DEFAULT_TIMEZONE = "Africa/Lagos";
const WEEKDAY_ALIASES: Array<{ pattern: RegExp; weekday: WorkingDayName; label: string }> = [
  { pattern: /\bMON(?:DAY)?\b/, weekday: "Monday", label: "Monday" },
  { pattern: /\bTUE(?:S|SDAY)?\b/, weekday: "Tuesday", label: "Tuesday" },
  { pattern: /\bWED(?:NESDAY)?\b/, weekday: "Wednesday", label: "Wednesday" },
  { pattern: /\bTHU(?:R|RSDAY)?\b/, weekday: "Thursday", label: "Thursday" },
  { pattern: /\bFRI(?:DAY)?\b/, weekday: "Friday", label: "Friday" },
  { pattern: /\bSAT(?:URDAY)?\b/, weekday: "Saturday", label: "Saturday" },
  { pattern: /\bSUN(?:DAY)?\b/, weekday: "Sunday", label: "Sunday" }
];

function hasPersistedWhatsAppSession(creds: any) {
  return !!creds?.me?.id && !!creds?.account;
}

function toDbPhone(value: string | null | undefined) {
  const digits = normalizeDigits(value);
  return digits || null;
}

function parsePhoneFromJid(value: string | null | undefined) {
  if (!value) return null;
  const beforeAt = value.split("@")[0] ?? "";
  const beforeDevice = beforeAt.split(":")[0] ?? "";
  return normalizeDigits(beforeDevice) || null;
}

function getTimeZone(schedule?: WorkingSchedule | null) {
  return schedule?.timezone?.trim() || DEFAULT_TIMEZONE;
}

function parseClockMinutes(value: string | null | undefined, fallback: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return hour * 60 + minute;
}

function getLocalDateParts(date: Date, timeZone: string): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long"
  }).formatToParts(date);

  const getNumber = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "Monday") as WorkingDayName;

  return {
    year: getNumber("year"),
    month: getNumber("month"),
    day: getNumber("day"),
    hour: getNumber("hour"),
    minute: getNumber("minute"),
    weekday
  };
}

function toDateKey(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDateKey(dateKey: string, offsetDays: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return toDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripExplicitOrderReference(body: string, orderId?: string | null) {
  const cleanOrderId = orderId?.trim();
  if (!cleanOrderId) return body.trim();
  const pattern = new RegExp(`^\\s*${escapeRegExp(cleanOrderId)}(?:\\s*[:\\-–—]\\s*|\\s+)`, "i");
  return body.replace(pattern, "").trim();
}

function utcFromLocalDateTime(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));

  for (let index = 0; index < 5; index += 1) {
    const parts = getLocalDateParts(guess, timeZone);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
    const actualUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const diff = desiredUtc - actualUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

function parseReplyClock(text: string): ParsedReplyClock | null {
  const normalized = text.trim().toUpperCase();
  if (!normalized) return null;

  if (/\bMORNING\b/.test(normalized)) {
    return { clock24: "10:00", minutes: 10 * 60, label: "10am" };
  }
  if (/\bAFTERNOON\b/.test(normalized)) {
    return { clock24: "14:00", minutes: 14 * 60, label: "2pm" };
  }
  if (/\bEVENING\b/.test(normalized) || /\bTONIGHT\b/.test(normalized)) {
    return { clock24: "17:00", minutes: 17 * 60, label: "5pm" };
  }

  const amPmMatch = normalized.match(/(?:^|\b)(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2] ?? "0");
    const meridiem = amPmMatch[3];
    if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }
    if (meridiem === "AM") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
    const clock24 = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const labelHour = hour % 12 || 12;
    const labelMinute = minute ? `:${String(minute).padStart(2, "0")}` : "";
    return {
      clock24,
      minutes: hour * 60 + minute,
      label: `${labelHour}${labelMinute}${meridiem.toLowerCase()}`
    };
  }

  const twentyFourMatch = normalized.match(/(?:^|\b)([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourMatch) {
    const hour = Number(twentyFourMatch[1]);
    const minute = Number(twentyFourMatch[2]);
    const clock24 = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const meridiem = hour >= 12 ? "pm" : "am";
    const labelHour = hour % 12 || 12;
    const labelMinute = minute ? `:${String(minute).padStart(2, "0")}` : "";
    return {
      clock24,
      minutes: hour * 60 + minute,
      label: `${labelHour}${labelMinute}${meridiem}`
    };
  }

  return null;
}

function parseReplyOffset(text: string): ParsedReplyOffset | null {
  const normalized = text.trim().toUpperCase();
  if (!normalized) return null;

  const match = normalized.match(/(?:^|\b)(\d{1,3})\s*(M|MIN|MINS|MINUTE|MINUTES|H|HR|HRS|HOUR|HOURS)\b/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const unit = match[2];
  const minutes = unit.startsWith("H") ? amount * 60 : amount;
  return {
    minutes,
    label: unit.startsWith("H")
      ? `${amount} hour${amount === 1 ? "" : "s"}`
      : `${amount} min`
  };
}

function parseReplyWeekday(text: string): ParsedReplyWeekday | null {
  const normalized = text.trim().toUpperCase();
  if (!normalized) return null;
  for (const entry of WEEKDAY_ALIASES) {
    if (entry.pattern.test(normalized)) {
      return {
        weekday: entry.weekday,
        label: entry.label
      };
    }
  }
  return null;
}

function workingWindow(schedule?: WorkingSchedule | null) {
  const start = parseClockMinutes(schedule?.working_day_start ?? DEFAULT_WORKING_START, 8 * 60);
  const end = parseClockMinutes(schedule?.working_day_end ?? DEFAULT_WORKING_END, 18 * 60);
  const sameDayHours = start < end;
  return {
    enabled: !!schedule?.working_schedule_enabled,
    start: sameDayHours ? start : 8 * 60,
    end: sameDayHours ? end : 18 * 60,
    sameDayHours
  };
}

function nextAllowedWorkingDate(dateKey: string, workingDays: WorkingDayName[], timeZone: string) {
  for (let offset = 0; offset <= 14; offset += 1) {
    const candidateDateKey = shiftDateKey(dateKey, offset);
    const weekday = getLocalDateParts(utcFromLocalDateTime(candidateDateKey, "12:00", timeZone), timeZone).weekday;
    if (workingDays.includes(weekday)) {
      return candidateDateKey;
    }
  }
  return dateKey;
}

function inferTimingModeFromText(normalized: string): Extract<InboundAutomationDirective, { kind: "callback" }>["timingMode"] {
  if (/\bTOMORROW\b/.test(normalized)) return "tomorrow";
  if (/\bLATER\b/.test(normalized)) return "later";
  return "fallback";
}

function isAffirmativeReply(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ").toUpperCase();
  return ["YES", "Y", "OK", "OKEY", "SAVE", "CONFIRM"].includes(normalized);
}

function isNegativeReply(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ").toUpperCase();
  return ["NO", "N", "CHANGE", "EDIT", "CANCEL"].includes(normalized);
}

function startsWithExplicitDirective(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ").toUpperCase();
  return /^(DONE|HANDLED|CONFIRMED|RESOLVED|CLEAR|WRONG NUMBER|REFUSED|OUT OF STOCK|NO ANSWER|NOT PICKING|LINE BUSY|BUSY|SWITCHED OFF|NOT REACHED|LATER|CALL BACK|CALLBACK|WILL CALL BACK|NOT READY|TOMORROW|TRAVELLED|PENDING|PAY|PAYMENT|AWAITING PAYMENT|RESCHEDULE|CALL|CHECK BACK|FOLLOW UP|NEED HELP|HELP|ESCALATE|OWNER HELP|OWNER|SUPERVISOR)\b/.test(normalized);
}

function looksLikeNaturalCallbackSentence(normalized: string) {
  const hasCallbackVerb =
    /\b(RESCHEDULE|CALL\s*BACK|CALLBACK|CHECK\s*BACK|FOLLOW[\s-]*UP)\b/.test(normalized)
    || (/\bCALL\b/.test(normalized) && /\b(TODAY|TOMORROW|MON|TUE|WED|THU|FRI|SAT|SUN|MORNING|AFTERNOON|EVENING|\d{1,2}(?::\d{2})?\s*(AM|PM)?)\b/.test(normalized));
  const hasContactHint = /\b(WIFE|HUSBAND|MUM|MOM|MOTHER|DAD|FATHER|BROTHER|SISTER|AUNTY|UNCLE)\b/.test(normalized);
  return hasCallbackVerb || (hasContactHint && /\b(TODAY|TOMORROW|MON|TUE|WED|THU|FRI|SAT|SUN|\d{1,2}(?::\d{2})?\s*(AM|PM)?)\b/.test(normalized));
}

function hasExplicitSchedulingCue(text: string) {
  const normalized = text.trim().toUpperCase();
  if (!normalized) return false;
  return !!(
    parseReplyOffset(text)
    || parseReplyClock(text)
    || parseReplyWeekday(text)
    || /\b(TOMORROW|LATER|TODAY|MORNING|AFTERNOON|EVENING|TONIGHT)\b/.test(normalized)
  );
}

function shortenReplyNote(note: string, maxLength = 80) {
  const clean = note.trim().replace(/\s+/g, " ");
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function buildThreadSummary(
  currentBody: string,
  recentMessages: RecentThreadMessage[],
  directive: NonNullable<InboundAutomationDirective>
) {
  const cleanCurrent = shortenReplyNote(currentBody, 120);
  const priorBodies = recentMessages
    .map((entry) => shortenReplyNote(entry.body, 90))
    .filter(Boolean)
    .filter((body, index, list) => list.indexOf(body) === index)
    .filter((body) => body.toUpperCase() !== cleanCurrent.toUpperCase())
    .slice(0, 2)
    .reverse();

  if (!priorBodies.length) return cleanCurrent;

  const needsSummary =
    cleanCurrent.split(" ").length <= 6
    || directive.kind === "callback"
    || directive.kind === "manager_help"
    || directive.kind === "owner_help";

  if (!needsSummary) return cleanCurrent;

  const summary = [...priorBodies, cleanCurrent].join(" -> ");
  return summary.length <= 220 ? summary : `${summary.slice(0, 217).trimEnd()}...`;
}

function isLikelyPaymentContext(context?: RecentReplyContext | null) {
  return context?.lastNextActionType === "payment_check" || context?.lastOutcomeCode === "Awaiting payment";
}

function looksLikeContextualReschedule(normalized: string) {
  return /\b(SAME TIME|SAME DAY|MAKE IT|MOVE IT|SHIFT IT|SHIFT TO|INSTEAD|TOMORROW|MON|TUE|WED|THU|FRI|SAT|SUN|MORNING|AFTERNOON|EVENING|\d{1,2}(?::\d{2})?\s*(AM|PM)?)\b/.test(normalized);
}

function buildContextualDirective(body: string, context?: RecentReplyContext | null): InboundAutomationDirective {
  const normalized = body.trim().replace(/\s+/g, " ").toUpperCase();
  if (!normalized || !context) return null;

  if (context.pendingClarification && hasExplicitSchedulingCue(normalized)) {
    const combinedBody = `${context.pendingClarification.sourceBody} ${body.trim()}`.trim();
    const combinedNormalized = combinedBody.replace(/\s+/g, " ").toUpperCase();
    const nextActionType: "callback" | "payment_check" = context.pendingClarification.nextActionType ?? (isLikelyPaymentContext(context) ? "payment_check" : "callback");
    return {
      kind: "callback",
      label: nextActionType === "payment_check" ? "Scheduled payment check" : "Scheduled another callback",
      outcomeCode: nextActionType === "payment_check" ? "Awaiting payment" : "Scheduled Callback",
      replyNote: combinedBody,
      timingMode: inferTimingModeFromText(combinedNormalized),
      nextActionType
    };
  }

  if (!looksLikeContextualReschedule(normalized)) return null;

  const nextActionType: "callback" | "payment_check" = isLikelyPaymentContext(context) ? "payment_check" : "callback";
  return {
    kind: "callback",
    label: nextActionType === "payment_check" ? "Scheduled payment check" : "Scheduled another callback",
    outcomeCode: nextActionType === "payment_check" ? "Awaiting payment" : "Scheduled Callback",
    replyNote: body.trim(),
    timingMode: inferTimingModeFromText(normalized),
    nextActionType
  };
}

function buildClarificationQuestion(
  body: string,
  directive: Extract<InboundAutomationDirective, { kind: "callback" }> | null,
  context?: RecentReplyContext | null
) {
  const nextActionType = directive?.nextActionType
    ?? context?.pendingClarification?.nextActionType
    ?? (isLikelyPaymentContext(context) ? "payment_check" : "callback");
  const sourceBody = body.trim() || context?.pendingClarification?.sourceBody || "";
  const examples = nextActionType === "payment_check"
    ? "Reply with something like `PAY FRIDAY 5PM` or `customer said pay tomorrow 10am`."
    : "Reply with something like `CALL FRIDAY 5PM` or `RESCHEDULE SATURDAY 11AM`.";
  return {
    question: `I can help with that, but I still need a clearer time. ${examples}`,
    pendingClarification: {
      sourceBody,
      nextActionType
    }
  };
}

function shouldRequireConfirmation(
  body: string,
  directive: Extract<InboundAutomationDirective, { kind: "callback" }>,
  context?: RecentReplyContext | null
) {
  if (startsWithExplicitDirective(body)) return false;
  if (context?.pendingClarification) return false;
  return directive.nextActionType === "payment_check" || looksLikeNaturalCallbackSentence(body.trim().replace(/\s+/g, " ").toUpperCase());
}

function buildConfirmationQuestion(
  directive: Extract<InboundAutomationDirective, { kind: "callback" }>,
  previewNextActionAt: string | null,
  schedule: WorkingSchedule | null
) {
  const actionText = directive.nextActionType === "payment_check" ? "payment check" : "callback";
  const whenText = previewNextActionAt ? formatAutomationMoment(previewNextActionAt, schedule) : "the next safe slot";
  return `I understood this as a ${actionText} for ${whenText}. Reply YES to save it or NO to change it.`;
}

function formatAutomationMoment(value: string | null | undefined, schedule?: WorkingSchedule | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: getTimeZone(schedule),
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

async function sendAutomationAcknowledgement(orgId: string, normalizedPhone: string, body: string) {
  try {
    await sendConnectedWhatsApp(orgId, normalizedPhone, body);
  } catch (error) {
    logger.warn("whatsapp automation acknowledgement failed", {
      orgId,
      normalizedPhone,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function parseInboundDirective(body: string): InboundAutomationDirective {
  const trimmed = body.trim();
  const normalized = trimmed.replace(/\s+/g, " ").toUpperCase();
  if (!normalized) return null;

  const stripCommand = (source: string, command: string) =>
    source.slice(command.length).trim().replace(/^[-:,\s]+/, "").trim();

  for (const command of ["DONE", "HANDLED", "CONFIRMED", "RESOLVED", "CLEAR"]) {
    if (normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}:`)) {
      return {
        kind: "confirm",
        label: "Marked handled",
        outcomeCode: "Confirmed",
        replyNote: stripCommand(trimmed, command)
      };
    }
  }

  for (const command of ["WRONG NUMBER", "REFUSED", "OUT OF STOCK"]) {
    if (normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}:`)) {
      return {
        kind: "confirm",
        label: "Marked as closed",
        outcomeCode: command === "OUT OF STOCK" ? "Out of Stock" : command
          .toLowerCase()
          .replace(/\b\w/g, (letter) => letter.toUpperCase()),
        replyNote: stripCommand(trimmed, command)
      };
    }
  }

  for (const command of ["NO ANSWER", "NOT PICKING", "LINE BUSY", "BUSY", "SWITCHED OFF", "NOT REACHED"]) {
    if (normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}:`)) {
      const outcomeCode =
        command === "BUSY" || command === "LINE BUSY"
          ? "No Answer"
          : command === "SWITCHED OFF"
            ? "Not Reached"
            : command;
      return {
        kind: "callback",
        label: "Logged callback retry",
        outcomeCode,
        replyNote: stripCommand(trimmed, command),
        timingMode: "fallback",
        nextActionType: "callback"
      };
    }
  }

  for (const command of ["LATER", "CALL BACK", "CALLBACK", "WILL CALL BACK", "NOT READY", "TOMORROW"]) {
    if (normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}:`)) {
      return {
        kind: "callback",
        label: "Scheduled another callback",
        outcomeCode: command === "NOT READY" ? "Not Ready" : "Will Call Back",
        replyNote: stripCommand(trimmed, command),
        timingMode: command === "TOMORROW" ? "tomorrow" : "later",
        nextActionType: "callback"
      };
    }
  }

  for (const command of ["TRAVELLED", "PENDING"]) {
    if (normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}:`)) {
      return {
        kind: "callback",
        label: "Scheduled another callback",
        outcomeCode: command === "TRAVELLED" ? "Travelled" : "Pending",
        replyNote: stripCommand(trimmed, command),
        timingMode: "fallback",
        nextActionType: "callback"
      };
    }
  }

  if (/^(?:PAY|PAYMENT|AWAITING PAYMENT)\b/.test(normalized) || /\bPAY(?:MENT)?\b/.test(normalized)) {
    return {
      kind: "callback",
      label: "Scheduled payment check",
      outcomeCode: "Awaiting payment",
      replyNote: trimmed,
      timingMode: inferTimingModeFromText(normalized),
      nextActionType: "payment_check"
    };
  }

  if (/^(?:RESCHEDULE|CALL|CALLBACK|CHECK BACK|FOLLOW UP)\b/.test(normalized) || looksLikeNaturalCallbackSentence(normalized)) {
    return {
      kind: "callback",
      label: "Scheduled another callback",
      outcomeCode: "Scheduled Callback",
      replyNote: trimmed,
      timingMode: inferTimingModeFromText(normalized),
      nextActionType: "callback"
    };
  }

  for (const command of ["NEED HELP", "HELP", "ESCALATE"]) {
    if (normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}:`)) {
      return {
        kind: "manager_help",
        label: "Asked manager to step in",
        replyNote: stripCommand(trimmed, command)
      };
    }
  }

  for (const command of ["OWNER HELP", "OWNER", "SUPERVISOR"]) {
    if (normalized === command || normalized.startsWith(`${command} `) || normalized.startsWith(`${command}:`)) {
      return {
        kind: "owner_help",
        label: "Asked owner to step in",
        replyNote: stripCommand(trimmed, command)
      };
    }
  }

  return null;
}

function extractIncomingMessageBody(message: any): string {
  const payload = message?.message;
  if (!payload || typeof payload !== "object") return "";
  return (
    payload.conversation
    ?? payload.extendedTextMessage?.text
    ?? payload.imageMessage?.caption
    ?? payload.videoMessage?.caption
    ?? payload.buttonsResponseMessage?.selectedDisplayText
    ?? payload.listResponseMessage?.title
    ?? payload.templateButtonReplyMessage?.selectedDisplayText
    ?? payload.documentMessage?.caption
    ?? ""
  );
}

function inferIncomingMessageType(message: any):
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "button"
  | "list"
  | "unknown" {
  const payload = message?.message;
  if (!payload || typeof payload !== "object") return "unknown";
  if (payload.conversation || payload.extendedTextMessage) return "text";
  if (payload.imageMessage) return "image";
  if (payload.videoMessage) return "video";
  if (payload.audioMessage) return "audio";
  if (payload.documentMessage) return "document";
  if (payload.buttonsResponseMessage || payload.templateButtonReplyMessage) return "button";
  if (payload.listResponseMessage) return "list";
  return "unknown";
}

function getConnection(orgId: string) {
  let existing = runtimeConnections.get(orgId);
  if (!existing) {
    existing = {
      orgId,
      socket: null,
      connecting: null,
      disconnecting: false,
      reconnectTimer: null,
      mode: "qr",
      pairingPhone: null
    };
    runtimeConnections.set(orgId, existing);
  }
  return existing;
}

async function getSessionDir(orgId: string) {
  const dir = path.join(sessionRoot, orgId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function clearSessionDir(orgId: string) {
  await rm(path.join(sessionRoot, orgId), { recursive: true, force: true }).catch(() => undefined);
  // Also wipe Supabase creds so stale credentials don't cause instant re-logout on next pair
  await supabase.from("whatsapp_settings")
    .update({ baileys_creds: null, baileys_keys: null })
    .eq("org_id", orgId)
    .then(() => undefined, () => undefined);
}

// Supabase-backed auth state for org connections.
// Stores Baileys credentials + signal keys in the whatsapp_settings row so
// sessions survive Railway deploys (ephemeral filesystem).
async function useOrgSupabaseAuthState(orgId: string) {
  const { data } = await supabase
    .from("whatsapp_settings")
    .select("baileys_creds, baileys_keys")
    .eq("org_id", orgId)
    .maybeSingle();

  const creds = data?.baileys_creds
    ? JSON.parse(JSON.stringify(data.baileys_creds), BufferJSON.reviver)
    : initAuthCreds();
  const keysMap: Record<string, Record<string, unknown>> = data?.baileys_keys
    ? JSON.parse(JSON.stringify(data.baileys_keys), BufferJSON.reviver)
    : {};

  const saveState = async () => {
    await supabase.from("whatsapp_settings").upsert({
      org_id: orgId,
      baileys_creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      baileys_keys:  JSON.parse(JSON.stringify(keysMap, BufferJSON.replacer)),
      updated_at: new Date().toISOString()
    }, { onConflict: "org_id" });
  };

  const state = {
    creds,
    keys: {
      get: (type: string, ids: string[]) => {
        const bucket = keysMap[type] ?? {};
        return Object.fromEntries(ids.map((id) => [id, (bucket[id] ?? null) as any]));
      },
      set: async (data: Record<string, Record<string, unknown> | null>) => {
        for (const [type, values] of Object.entries(data)) {
          if (!values) continue;
          if (!keysMap[type]) keysMap[type] = {};
          for (const [id, val] of Object.entries(values)) {
            if (val == null) delete keysMap[type][id];
            else keysMap[type][id] = val;
          }
        }
        await saveState();
      }
    }
  };

  return { state, saveCreds: saveState };
}

// Supabase-backed auth state for per-user personal dispatch accounts.
async function useUserSupabaseAuthState(orgId: string, userId: string) {
  const { data } = await supabase
    .from("whatsapp_user_accounts")
    .select("baileys_creds, baileys_keys")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  const creds = data?.baileys_creds
    ? JSON.parse(JSON.stringify(data.baileys_creds), BufferJSON.reviver)
    : initAuthCreds();
  const keysMap: Record<string, Record<string, unknown>> = data?.baileys_keys
    ? JSON.parse(JSON.stringify(data.baileys_keys), BufferJSON.reviver)
    : {};

  const saveState = async () => {
    await supabase.from("whatsapp_user_accounts").upsert({
      org_id: orgId,
      user_id: userId,
      baileys_creds: JSON.parse(JSON.stringify(creds, BufferJSON.replacer)),
      baileys_keys:  JSON.parse(JSON.stringify(keysMap, BufferJSON.replacer)),
      updated_at: new Date().toISOString()
    }, { onConflict: "org_id,user_id" });
  };

  const state = {
    creds,
    keys: {
      get: (type: string, ids: string[]) => {
        const bucket = keysMap[type] ?? {};
        return Object.fromEntries(ids.map((id) => [id, (bucket[id] ?? null) as any]));
      },
      set: async (data: Record<string, Record<string, unknown> | null>) => {
        for (const [type, values] of Object.entries(data)) {
          if (!values) continue;
          if (!keysMap[type]) keysMap[type] = {};
          for (const [id, val] of Object.entries(values)) {
            if (val == null) delete keysMap[type][id];
            else keysMap[type][id] = val;
          }
        }
        await saveState();
      }
    }
  };

  return { state, saveCreds: saveState };
}

async function updateConnectionRow(orgId: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from("whatsapp_settings")
    .upsert(
      {
        org_id: orgId,
        provider: "baileys",
        updated_at: new Date().toISOString(),
        ...payload
      },
      { onConflict: "org_id" }
    );

  if (error) {
    logger.warn("whatsapp runtime state update failed", { orgId, error: error.message });
  }
}

async function bootstrapSettings(orgId: string) {
  const { data, error } = await supabase
    .from("whatsapp_settings")
    .select("enabled, connection_status, pairing_mode, pairing_phone")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    logger.warn("whatsapp runtime settings lookup failed", { orgId, error: error.message });
    return null;
  }
  return (data ?? null) as RuntimeRow | null;
}

async function isReplyAssistantEnabled(orgId: string) {
  const { data, error } = await supabase
    .from("whatsapp_settings")
    .select("assistant_outcome_autofill_enabled")
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    logger.warn("whatsapp reply assistant setting lookup failed", { orgId, error: error.message });
    return true;
  }

  return data?.assistant_outcome_autofill_enabled !== false;
}

async function markDisconnected(orgId: string, lastError: string | null = null) {
  await updateConnectionRow(orgId, {
    connection_status: "disconnected",
    connected_phone: null,
    connected_name: null,
    last_error: lastError,
    pairing_code: null,
    qr_code_data_url: null
  });
}

function userRuntimeKey(orgId: string, userId: string) {
  return `${orgId}:${userId}`;
}

function getUserConnection(orgId: string, userId: string) {
  const runtimeKey = userRuntimeKey(orgId, userId);
  let existing = userRuntimeConnections.get(runtimeKey);
  if (!existing) {
    existing = {
      orgId,
      userId,
      runtimeKey,
      socket: null,
      connecting: null,
      disconnecting: false,
      reconnectTimer: null,
      mode: "qr",
      pairingPhone: null
    };
    userRuntimeConnections.set(runtimeKey, existing);
  }
  return existing;
}

async function getUserSessionDir(orgId: string, userId: string) {
  const dir = path.join(sessionRoot, "users", orgId, userId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function clearUserSessionDir(orgId: string, userId: string) {
  await rm(path.join(sessionRoot, "users", orgId, userId), { recursive: true, force: true }).catch(() => undefined);
  // Also wipe Supabase creds so stale credentials don't cause instant re-logout on next pair
  await supabase.from("whatsapp_user_accounts")
    .update({ baileys_creds: null, baileys_keys: null })
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .then(() => undefined, () => undefined);
}

async function updateUserConnectionRow(orgId: string, userId: string, payload: Record<string, unknown>) {
  const { error } = await supabase
    .from("whatsapp_user_accounts")
    .upsert(
      {
        org_id: orgId,
        user_id: userId,
        provider: "baileys",
        updated_at: new Date().toISOString(),
        ...payload
      },
      { onConflict: "org_id,user_id" }
    );

  if (error) {
    logger.warn("user whatsapp runtime state update failed", { orgId, userId, error: error.message });
  }
}

async function bootstrapUserSettings(orgId: string, userId: string) {
  const { data, error } = await supabase
    .from("whatsapp_user_accounts")
    .select("org_id, user_id, enabled, connection_status, pairing_mode, pairing_phone")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    logger.warn("user whatsapp runtime settings lookup failed", { orgId, userId, error: error.message });
    return null;
  }
  return (data ?? null) as UserRuntimeRow | null;
}

async function markUserDisconnected(orgId: string, userId: string, lastError: string | null = null) {
  await updateUserConnectionRow(orgId, userId, {
    enabled: false,
    connection_status: "disconnected",
    connected_phone: null,
    connected_name: null,
    last_error: lastError,
    pairing_code: null,
    qr_code_data_url: null
  });
}

function extractExplicitOrderId(body: string, candidateOrderIds: readonly string[]) {
  const normalizedBody = body.trim().replace(/\s+/g, " ").toUpperCase();
  for (const orderId of candidateOrderIds) {
    const clean = orderId.trim();
    if (!clean) continue;
    const pattern = new RegExp(`(?:^|[^A-Z0-9])${escapeRegExp(clean.toUpperCase())}(?:[^A-Z0-9]|$)`);
    if (pattern.test(normalizedBody)) return clean;
  }
  return null;
}

async function resolveLinkedOrder(orgId: string, normalizedPhone: string, body: string): Promise<LinkedOrderResolution> {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("order_id, created_at")
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .not("order_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    logger.warn("whatsapp inbox order match failed", { orgId, normalizedPhone, error: error.message });
    return { linkedOrderId: null, mode: "not_found", candidateOrderIds: [] };
  }

  const candidateOrderIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) => (typeof row.order_id === "string" ? row.order_id.trim() : ""))
        .filter(Boolean)
    )
  );
  const explicitOrderId = extractExplicitOrderId(body, candidateOrderIds);
  if (explicitOrderId) {
    return {
      linkedOrderId: explicitOrderId,
      mode: "explicit_ref",
      candidateOrderIds,
      explicitOrderId
    };
  }
  if (candidateOrderIds.length === 1) {
    return {
      linkedOrderId: candidateOrderIds[0] ?? null,
      mode: "single_recent",
      candidateOrderIds
    };
  }
  return {
    linkedOrderId: null,
    mode: candidateOrderIds.length > 1 ? "ambiguous" : "not_found",
    candidateOrderIds
  };
}

async function markLatestDeliveredForPhone(orgId: string, normalizedPhone: string, providerStatus: string) {
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .in("status", ["queued", "sent"])
    .is("delivered_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn("whatsapp delivered-by-phone lookup failed", { orgId, normalizedPhone, error: error.message });
    return;
  }

  if (!data?.id) return;

  const { error: updateError } = await supabase
    .from("whatsapp_messages")
    .update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
      provider_status: providerStatus
    })
    .eq("id", data.id);

  if (updateError) {
    logger.warn("whatsapp delivered-by-phone update failed", { orgId, normalizedPhone, error: updateError.message });
  }
}

async function loadStaffActorByPhone(orgId: string, normalizedPhone: string): Promise<StaffActor | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, name, role, phone, active")
    .eq("org_id", orgId)
    .eq("active", true);

  if (error || !data?.length) return null;
  const match = data.find((user) => normalizeDigits(user.phone) === normalizedPhone);
  if (!match?.id) return null;
  return {
    id: match.id as string,
    name: typeof match.name === "string" && match.name.trim() ? match.name.trim() : "Protohub team member",
    role: typeof match.role === "string" ? match.role : "Sales Rep",
    normalizedPhone
  };
}

function buildOrderReferencePrompt(resolution: LinkedOrderResolution) {
  const examples = resolution.candidateOrderIds.slice(0, 3).join(", ");
  if (resolution.mode === "ambiguous" && examples) {
    return `I found more than one active Protohub order on this WhatsApp. After you call the customer, reply with the order code first, for example ${resolution.candidateOrderIds[0]} DONE or ${resolution.candidateOrderIds[0]} PAY FRIDAY 5PM. Open refs: ${examples}.`;
  }
  return "I could not safely match this reply to one Protohub order. After you call the customer, reply with the order code first, for example ORD-123 DONE or ORD-123 LATER 3PM.";
}

function formatCustomerStateDescriptor(order?: Pick<LinkedOrderAutomationRecord, "customer" | "state"> | null) {
  const customerName = typeof order?.customer === "string" && order.customer.trim() ? order.customer.trim() : "this customer";
  const stateName = typeof order?.state === "string" && order.state.trim() ? order.state.trim() : "";
  return stateName ? `${customerName} (${stateName})` : customerName;
}

async function loadOrderForInboundAutomation(orgId: string, orderId: string): Promise<LinkedOrderAutomationRecord | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, customer, phone, state, assigned_rep_id, product_name, package_name, amount, currency, status, scheduled_date, scheduled_at, call_outcome, response, notes, timeline_notes")
    .eq("org_id", orgId)
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data?.id) return null;
  return data as LinkedOrderAutomationRecord;
}

async function loadRecentReplyContext(
  orgId: string,
  normalizedPhone: string,
  linkedOrderId: string,
  currentInboxId: string
): Promise<RecentReplyContext | null> {
  const { data, error } = await supabase
    .from("whatsapp_inbox_messages")
    .select("id, metadata, received_at")
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .eq("linked_order_id", linkedOrderId)
    .neq("id", currentInboxId)
    .order("received_at", { ascending: false })
    .limit(8);

  if (error || !data?.length) return null;

  for (const row of data) {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : null;
    const automation = metadata?.automation && typeof metadata.automation === "object" && !Array.isArray(metadata.automation)
      ? (metadata.automation as Record<string, unknown>)
      : null;
    if (!automation) continue;
    return {
      lastOutcomeCode: typeof automation.outcomeCode === "string" ? automation.outcomeCode : null,
      lastNextActionType:
        automation.nextActionType === "payment_check" || automation.nextActionType === "callback"
          ? automation.nextActionType
          : null,
      lastNextActionAt: typeof automation.nextActionAt === "string" ? automation.nextActionAt : null,
      pendingClarification:
        automation.status === "clarification_needed" && typeof automation.sourceBody === "string"
          ? {
              sourceBody: automation.sourceBody,
              nextActionType:
                automation.nextActionType === "payment_check" || automation.nextActionType === "callback"
                  ? automation.nextActionType
                  : null
            }
          : null,
      pendingConfirmation:
        automation.status === "confirmation_needed" && typeof automation.sourceBody === "string"
          ? {
              sourceBody: automation.sourceBody,
              label: typeof automation.label === "string" ? automation.label : "Waiting for YES",
              outcomeCode: typeof automation.outcomeCode === "string" ? automation.outcomeCode : "Scheduled Callback",
              nextActionType:
                automation.nextActionType === "payment_check" || automation.nextActionType === "callback"
                  ? automation.nextActionType
                  : null,
              timingMode:
                automation.timingMode === "tomorrow" || automation.timingMode === "later" || automation.timingMode === "fallback"
                  ? automation.timingMode
                  : "fallback",
              previewNextActionAt: typeof automation.previewNextActionAt === "string" ? automation.previewNextActionAt : null
            }
          : null
    };
  }

  return null;
}

async function loadRecentThreadMessages(
  orgId: string,
  normalizedPhone: string,
  linkedOrderId: string,
  currentInboxId: string
): Promise<RecentThreadMessage[]> {
  const { data, error } = await supabase
    .from("whatsapp_inbox_messages")
    .select("body, received_at")
    .eq("org_id", orgId)
    .eq("normalized_phone", normalizedPhone)
    .eq("linked_order_id", linkedOrderId)
    .neq("id", currentInboxId)
    .order("received_at", { ascending: false })
    .limit(4);

  if (error || !data?.length) return [];
  return (data ?? [])
    .map((row) => ({
      body: typeof row.body === "string" ? row.body.trim() : "",
      receivedAt: typeof row.received_at === "string" ? row.received_at : ""
    }))
    .filter((row) => row.body);
}

async function loadWorkingSchedule(orgId: string): Promise<WorkingSchedule | null> {
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

async function nextCallbackFromReply(
  orgId: string,
  directive: Extract<InboundAutomationDirective, { kind: "callback" }>,
  context?: RecentReplyContext | null
) {
  const schedule = await loadWorkingSchedule(orgId);
  const base = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const parsedOffset = parseReplyOffset(directive.replyNote);
  const parsedWeekday = parseReplyWeekday(directive.replyNote);
  const parsedClock = parseReplyClock(directive.replyNote);
  if (parsedOffset) {
    const offsetBase = new Date(Date.now() + parsedOffset.minutes * 60 * 1000);
    return nextWorkingScheduleAt(schedule ?? { working_schedule_enabled: false }, offsetBase) ?? offsetBase.toISOString();
  }

  const timeZone = getTimeZone(schedule);
  const localNow = getLocalDateParts(new Date(), timeZone);
  const localDateKey = toDateKey(localNow.year, localNow.month, localNow.day);
  const nowMinutes = localNow.hour * 60 + localNow.minute;
  let targetDateKey = directive.timingMode === "tomorrow" ? shiftDateKey(localDateKey, 1) : localDateKey;

  if (parsedWeekday) {
    for (let offset = 0; offset <= 14; offset += 1) {
      const candidateDateKey = shiftDateKey(localDateKey, offset);
      const candidateWeekday = getLocalDateParts(utcFromLocalDateTime(candidateDateKey, "12:00", timeZone), timeZone).weekday;
      if (candidateWeekday === parsedWeekday.weekday) {
        const isSameDay = offset === 0;
        if (!parsedClock || !isSameDay || parsedClock.minutes > nowMinutes) {
          targetDateKey = candidateDateKey;
          break;
        }
      }
    }
  } else if (!parsedClock && !context?.lastNextActionAt) {
    return nextWorkingScheduleAt(schedule ?? { working_schedule_enabled: false }, base) ?? base.toISOString();
  }

  if (!parsedWeekday && parsedClock && directive.timingMode !== "tomorrow" && parsedClock.minutes <= nowMinutes) {
    targetDateKey = shiftDateKey(targetDateKey, 1);
  }

  const window = workingWindow(schedule);
  if (!window.enabled) {
    return utcFromLocalDateTime(targetDateKey, parsedClock?.clock24 ?? "10:00", timeZone).toISOString();
  }

  const workingDays = normalizeWorkingDays(schedule?.working_days);
  targetDateKey = nextAllowedWorkingDate(targetDateKey, workingDays, timeZone);

  const contextClock = context?.lastNextActionAt
    ? (() => {
        const parts = getLocalDateParts(new Date(context.lastNextActionAt), timeZone);
        return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
      })()
    : null;

  let finalClock = parsedClock?.clock24
    ?? contextClock
    ?? `${String(Math.floor(window.start / 60)).padStart(2, "0")}:${String(window.start % 60).padStart(2, "0")}`;
  const effectiveMinutes = parsedClock?.minutes
    ?? (contextClock
      ? (() => {
          const [hour, minute] = contextClock.split(":").map(Number);
          return hour * 60 + minute;
        })()
      : window.start);
  if (window.sameDayHours) {
    if (effectiveMinutes < window.start) {
      finalClock = `${String(Math.floor(window.start / 60)).padStart(2, "0")}:${String(window.start % 60).padStart(2, "0")}`;
    } else if (effectiveMinutes >= window.end) {
      targetDateKey = nextAllowedWorkingDate(shiftDateKey(targetDateKey, 1), workingDays, timeZone);
      finalClock = `${String(Math.floor(window.start / 60)).padStart(2, "0")}:${String(window.start % 60).padStart(2, "0")}`;
    }
  }

  return utcFromLocalDateTime(targetDateKey, finalClock, timeZone).toISOString();
}

async function annotateInboxAutomation(orgId: string, inboxId: string, payload: Record<string, unknown>) {
  const { data } = await supabase
    .from("whatsapp_inbox_messages")
    .select("metadata")
    .eq("org_id", orgId)
    .eq("id", inboxId)
    .maybeSingle();

  const metadata = data?.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
    ? { ...(data.metadata as Record<string, unknown>) }
    : {};

  metadata.automation = {
    ...(metadata.automation && typeof metadata.automation === "object" && !Array.isArray(metadata.automation)
      ? metadata.automation as Record<string, unknown>
      : {}),
    ...payload,
    processedAt: new Date().toISOString()
  };

  const { error } = await supabase
    .from("whatsapp_inbox_messages")
    .update({ metadata })
    .eq("org_id", orgId)
    .eq("id", inboxId);

  if (error) {
    logger.warn("whatsapp inbox automation annotation failed", { orgId, inboxId, error: error.message });
  }
}

async function logRepHelpRequest(orgId: string, order: LinkedOrderAutomationRecord, actor: StaffActor, note: string) {
  const { data: team } = await supabase
    .from("sales_teams")
    .select("id, lead_id")
    .eq("org_id", orgId)
    .contains("member_ids", [actor.id])
    .limit(1)
    .maybeSingle();

  if (!team?.id) return;

  const { error } = await supabase
    .from("manager_activity_logs")
    .insert({
      org_id: orgId,
      team_id: team.id,
      manager_id: team.lead_id ?? null,
      actor_id: actor.id,
      actor_name: actor.name,
      order_id: order.id,
      rep_id: actor.id,
      action_type: "escalated_order",
      note: note || "Rep asked for help through WhatsApp."
    });

  if (error) {
    logger.warn("whatsapp rep help activity log failed", { orgId, orderId: order.id, error: error.message });
  }
}

async function processInboundReplyAutomation(
  orgId: string,
  inboxId: string,
  normalizedPhone: string,
  body: string,
  linkedOrder: LinkedOrderResolution
) {
  const replyAssistantEnabled = await isReplyAssistantEnabled(orgId);
  const linkedOrderId = linkedOrder.linkedOrderId;
  const recentThreadMessages = linkedOrderId
    ? await loadRecentThreadMessages(orgId, normalizedPhone, linkedOrderId, inboxId)
    : [];
  const recentContext = linkedOrderId
    ? await loadRecentReplyContext(orgId, normalizedPhone, linkedOrderId, inboxId)
    : null;
  const strippedBody = stripExplicitOrderReference(body, linkedOrder.explicitOrderId ?? linkedOrderId);
  const normalizedBody = strippedBody.trim().replace(/\s+/g, " ").toUpperCase();
  let directive = parseInboundDirective(strippedBody) ?? buildContextualDirective(strippedBody, recentContext);

  if (!replyAssistantEnabled) {
    if (!linkedOrderId) {
      const question = buildOrderReferencePrompt(linkedOrder);
      await annotateInboxAutomation(orgId, inboxId, {
        status: "captured_only",
        label: directive?.label ?? "Manual app update required",
        linkedOrderId: null,
        question,
        reason: "WhatsApp reply automation is turned off for this workspace."
      });
      await sendAutomationAcknowledgement(
        orgId,
        normalizedPhone,
        `I can still help you keep the reply clear. ${question} After that, please record the outcome in Protohub. 📝`
      );
      return;
    }

    const order = await loadOrderForInboundAutomation(orgId, linkedOrderId);
    const customerLabel = formatCustomerStateDescriptor(order);
    const ref = linkedOrder.explicitOrderId ?? linkedOrderId;
    const previewNextActionAt = directive?.kind === "callback" ? await nextCallbackFromReply(orgId, directive, recentContext) : null;
    const callbackVerb = directive?.kind === "callback" && directive.nextActionType === "payment_check" ? "payment check" : "callback";
    const noteSummary = strippedBody.trim() ? shortenReplyNote(strippedBody.trim()) : "";
    const manualQuestion = !directive
      ? `Thank you. I captured your update for ${customerLabel} under ${ref}. Please open Protohub and update that order record when you are ready. 📝`
      : directive.kind === "confirm"
        ? `Thank you. I understood this as "${directive.outcomeCode}" for ${customerLabel} under ${ref}. Please open Protohub and update the order record accordingly. ✅`
        : directive.kind === "callback"
          ? `Thank you. I understood this as "${directive.outcomeCode}" for ${customerLabel} under ${ref}${previewNextActionAt ? `, with the next ${callbackVerb} at ${formatAutomationMoment(previewNextActionAt, await loadWorkingSchedule(orgId))}` : ""}. Please open Protohub and record that follow-up update. 📝`
          : directive.kind === "manager_help"
            ? `Thank you. I understood this as a manager-support request for ${customerLabel} under ${ref}. Please open Protohub and escalate it there. 🚨`
            : `Thank you. I understood this as an owner-level support request for ${customerLabel} under ${ref}. Please open Protohub and escalate it there. 🚨`;
    await annotateInboxAutomation(orgId, inboxId, {
      status: "captured_only",
      label: directive?.label ?? "Manual app update required",
      linkedOrderId: linkedOrderId,
      reason: "WhatsApp reply automation is turned off for this workspace.",
      outcomeCode: directive?.kind === "confirm" || directive?.kind === "callback" ? directive.outcomeCode : null,
      nextActionAt: previewNextActionAt,
      nextActionType: directive?.kind === "callback" ? directive.nextActionType : null,
      threadSummary: noteSummary
    });
    await sendAutomationAcknowledgement(orgId, normalizedPhone, manualQuestion);
    return;
  }

  if (!directive && recentContext?.pendingConfirmation) {
    if (isAffirmativeReply(strippedBody)) {
      directive = {
        kind: "callback",
        label: recentContext.pendingConfirmation.label,
        outcomeCode: recentContext.pendingConfirmation.outcomeCode,
        replyNote: recentContext.pendingConfirmation.sourceBody,
        timingMode: recentContext.pendingConfirmation.timingMode ?? "fallback",
        nextActionType: recentContext.pendingConfirmation.nextActionType ?? "callback"
      };
    } else if (isNegativeReply(strippedBody)) {
      const clarification = buildClarificationQuestion(
        recentContext.pendingConfirmation.sourceBody,
        {
          kind: "callback",
          label: recentContext.pendingConfirmation.label,
          outcomeCode: recentContext.pendingConfirmation.outcomeCode,
          replyNote: recentContext.pendingConfirmation.sourceBody,
          timingMode: recentContext.pendingConfirmation.timingMode ?? "fallback",
          nextActionType: recentContext.pendingConfirmation.nextActionType ?? "callback"
        },
        recentContext
      );
      await annotateInboxAutomation(orgId, inboxId, {
        status: "clarification_needed",
        label: "Need clearer time",
        question: clarification.question,
        sourceBody: clarification.pendingClarification.sourceBody,
        nextActionType: clarification.pendingClarification.nextActionType
      });
      await sendAutomationAcknowledgement(orgId, normalizedPhone, `No problem. ${clarification.question}`);
      return;
    }
  }

  if (!directive) {
    if (looksLikeNaturalCallbackSentence(normalizedBody) || hasExplicitSchedulingCue(strippedBody) || recentContext?.pendingConfirmation) {
      const clarification = buildClarificationQuestion(strippedBody, null, recentContext);
      await annotateInboxAutomation(orgId, inboxId, {
        status: "clarification_needed",
        label: "Need clearer time",
        question: clarification.question,
        sourceBody: clarification.pendingClarification.sourceBody,
        nextActionType: clarification.pendingClarification.nextActionType
      });
      await sendAutomationAcknowledgement(orgId, normalizedPhone, clarification.question);
      return;
    }
    await annotateInboxAutomation(orgId, inboxId, {
      status: "captured_only",
      label: "No quick action matched"
    });
    return;
  }

  if (!linkedOrderId) {
    const question = buildOrderReferencePrompt(linkedOrder);
    await annotateInboxAutomation(orgId, inboxId, {
      status: "clarification_needed",
      label: directive.label,
      question,
      reason: linkedOrder.mode === "ambiguous"
        ? "Multiple active orders are tied to this WhatsApp. Protohub needs the order code before it saves an action."
        : "No linked order was found for this reply."
    });
    await sendAutomationAcknowledgement(orgId, normalizedPhone, question);
    return;
  }

  const actor = await loadStaffActorByPhone(orgId, normalizedPhone);
  if (!actor) {
    await annotateInboxAutomation(orgId, inboxId, {
      status: "captured_only",
      label: directive.label,
      reason: "Reply came from a number that is not mapped to an active staff user."
    });
    return;
  }

  const order = await loadOrderForInboundAutomation(orgId, linkedOrderId);
  if (!order?.id) {
    await annotateInboxAutomation(orgId, inboxId, {
      status: "captured_only",
      label: directive.label,
      reason: "Linked order could not be found."
    });
    return;
  }

  if (!directive && linkedOrder.explicitOrderId && strippedBody.trim()) {
    const customNote = strippedBody.trim();
    await recordFollowUpProgressNote({
      orgId,
      orderId: order.id,
      repId: actor.id,
      actorName: actor.name,
      channel: "whatsapp",
      noteText: customNote,
      attemptType: recentContext?.lastNextActionType === "payment_check" ? "payment_follow_up" : "scheduled_callback"
    });

    await annotateInboxAutomation(orgId, inboxId, {
      status: "processed",
      label: "Progress update saved",
      action: "custom_note",
      actorName: actor.name,
      linkedOrderId: order.id,
      usedConversationMemory: !!recentContext,
      threadSummary: customNote,
      threadMessageCount: recentThreadMessages.length + 1
    });

    const customerName = typeof order.customer === "string" && order.customer.trim() ? order.customer.trim() : "this customer";
    const ref = linkedOrder.explicitOrderId;
    await sendAutomationAcknowledgement(
      orgId,
      normalizedPhone,
      `Got it. I saved your update on ${customerName} under ${ref}. If you want Protohub to close or reschedule it, reply with ${ref} DONE, ${ref} LATER 3PM, or ${ref} PAY FRIDAY 5PM.`
    );
    return;
  }

  if (directive.kind === "confirm" || directive.kind === "callback") {
    if (order.assigned_rep_id !== actor.id) {
      await annotateInboxAutomation(orgId, inboxId, {
        status: "captured_only",
        label: directive.label,
        reason: "Only the assigned rep can use quick reply automation for this order."
      });
      return;
    }

    if (
      directive.kind === "callback"
      && !hasExplicitSchedulingCue(directive.replyNote)
      && !recentContext?.lastNextActionAt
      && !recentContext?.pendingClarification
      && !recentContext?.pendingConfirmation
    ) {
      const clarification = buildClarificationQuestion(strippedBody, directive, recentContext);
      await annotateInboxAutomation(orgId, inboxId, {
        status: "clarification_needed",
        label: "Need clearer time",
        question: clarification.question,
        sourceBody: clarification.pendingClarification.sourceBody,
        nextActionType: clarification.pendingClarification.nextActionType
      });
      await sendAutomationAcknowledgement(orgId, normalizedPhone, clarification.question);
      return;
    }

    const schedule = directive.kind === "callback" ? await loadWorkingSchedule(orgId) : null;
    if (
      directive.kind === "callback"
      && shouldRequireConfirmation(strippedBody, directive, recentContext)
      && !isAffirmativeReply(strippedBody)
      && !recentContext?.pendingConfirmation
    ) {
      const previewNextActionAt = await nextCallbackFromReply(orgId, directive, recentContext);
      const question = buildConfirmationQuestion(directive, previewNextActionAt, schedule);
      await annotateInboxAutomation(orgId, inboxId, {
        status: "confirmation_needed",
        label: "Waiting for YES",
        question,
        sourceBody: directive.replyNote,
        outcomeCode: directive.outcomeCode,
        nextActionType: directive.nextActionType,
        timingMode: directive.timingMode,
        previewNextActionAt
      });
      await sendAutomationAcknowledgement(orgId, normalizedPhone, question);
      return;
    }

    const nextActionAt = directive.kind === "callback" ? await nextCallbackFromReply(orgId, directive, recentContext) : null;
    const attemptType = directive.kind === "callback" && directive.nextActionType === "payment_check"
      ? "payment_follow_up"
      : "scheduled_callback";
    const synthesizedNote = buildThreadSummary(strippedBody, recentThreadMessages, directive);
    await recordContactAttemptAndNextAction({
      orgId,
      orderId: order.id,
      repId: actor.id,
      actorName: actor.name,
      channel: "whatsapp",
      attemptType,
      outcomeCode: directive.outcomeCode,
      outcomeNote: synthesizedNote || directive.replyNote || `Quick reply from WhatsApp: ${strippedBody.trim()}`,
      nextActionType: directive.kind === "callback" ? directive.nextActionType : null,
      nextActionAt,
      nextActionNote: directive.kind === "callback" ? `Auto-created from WhatsApp quick reply. ${synthesizedNote}`.trim() : null
    });

    await annotateInboxAutomation(orgId, inboxId, {
      status: "processed",
      label: directive.label,
      action: directive.kind,
      actorName: actor.name,
      linkedOrderId: order.id,
      outcomeCode: directive.outcomeCode,
      nextActionAt,
      nextActionType: directive.kind === "callback" ? directive.nextActionType : null,
      usedConversationMemory: !!recentContext,
      threadSummary: synthesizedNote,
      threadMessageCount: recentThreadMessages.length + 1
    });

    const customerName = typeof order.customer === "string" && order.customer.trim() ? order.customer.trim() : "this customer";
    const callbackVerb = directive.outcomeCode === "Awaiting payment"
      ? "set the next payment check for"
      : "moved the next callback to";
    const noteSnippet = synthesizedNote ? shortenReplyNote(synthesizedNote) : directive.replyNote ? shortenReplyNote(directive.replyNote) : "";
    const ackBody = directive.kind === "callback"
      ? `Got it. I logged "${directive.outcomeCode}" for ${customerName} and ${callbackVerb} ${formatAutomationMoment(nextActionAt, schedule)}.${noteSnippet ? ` I also saved your note: "${noteSnippet}".` : ""}`
      : `Got it. I logged "${directive.outcomeCode}" for ${customerName} and marked the current follow-up handled.${noteSnippet ? ` I also saved your note: "${noteSnippet}".` : ""}`;
    await sendAutomationAcknowledgement(orgId, normalizedPhone, ackBody);
    return;
  }

  if (directive.kind === "manager_help" && order.assigned_rep_id === actor.id) {
    await logRepHelpRequest(orgId, order, actor, directive.replyNote || "Rep asked for help through WhatsApp.");
    const { sendManagerFollowUpReminderWhatsApp } = await import("./whatsapp.js");
    await sendManagerFollowUpReminderWhatsApp(orgId, order as any, {
      dedupeKey: `reply-help:${inboxId}:manager`,
      scheduledLabel: order.scheduled_at ?? order.scheduled_date ?? "ASAP",
      noteText: directive.replyNote || "Rep asked for help through WhatsApp.",
      metadata: {
        kind: "reply_help_manager_alert",
        sourceInboxId: inboxId,
        sourceReplyPhone: normalizedPhone,
        overdueMinutes: 0
      }
    });

    await annotateInboxAutomation(orgId, inboxId, {
      status: "processed",
      label: directive.label,
      action: "manager_help",
      actorName: actor.name,
      linkedOrderId: order.id
    });
    await sendAutomationAcknowledgement(
      orgId,
      normalizedPhone,
      `Got it. I’ve alerted your manager to step in on ${order.customer?.trim() || "this order"}.`
    );
    return;
  }

  if (directive.kind === "owner_help" && (actor.role === "Admin" || actor.role === "Manager" || actor.role === "Owner")) {
    const { sendOwnerFollowUpReminderWhatsApp } = await import("./whatsapp.js");
    await sendOwnerFollowUpReminderWhatsApp(orgId, order as any, {
      dedupeKey: `reply-help:${inboxId}:owner`,
      scheduledLabel: order.scheduled_at ?? order.scheduled_date ?? "ASAP",
      noteText: directive.replyNote || "Manager asked for owner help through WhatsApp.",
      metadata: {
        kind: "reply_help_owner_alert",
        sourceInboxId: inboxId,
        sourceReplyPhone: normalizedPhone,
        overdueMinutes: 0
      }
    });

    await annotateInboxAutomation(orgId, inboxId, {
      status: "processed",
      label: directive.label,
      action: "owner_help",
      actorName: actor.name,
      linkedOrderId: order.id
    });
    await sendAutomationAcknowledgement(
      orgId,
      normalizedPhone,
      `Got it. I’ve escalated ${order.customer?.trim() || "this order"} to owner level.`
    );
    return;
  }

  await annotateInboxAutomation(orgId, inboxId, {
    status: "captured_only",
    label: directive.label,
    reason: "This reply was captured, but no safe auto-action matched this sender role."
  });
}

async function logInboundMessage(orgId: string, message: any, receiverPhone: string | null) {
  const providerMessageId = typeof message?.key?.id === "string" ? message.key.id : null;
  if (providerMessageId) {
    const { data: existing } = await supabase
      .from("whatsapp_inbox_messages")
      .select("id")
      .eq("org_id", orgId)
      .eq("provider_message_id", providerMessageId)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return;
  }

  const senderPhone = parsePhoneFromJid(message?.key?.participant) ?? parsePhoneFromJid(message?.key?.remoteJid);
  const normalizedPhone = normalizeDigits(senderPhone);
  const body = extractIncomingMessageBody(message).trim();
  if (!normalizedPhone || !body) return;

  const linkedOrder = await resolveLinkedOrder(orgId, normalizedPhone, body);
  const payload = {
    org_id: orgId,
    provider: "baileys",
    provider_message_id: providerMessageId,
    sender_name: typeof message?.pushName === "string" ? message.pushName : null,
    sender_phone: senderPhone ?? normalizedPhone,
    normalized_phone: normalizedPhone,
    receiver_phone: receiverPhone,
    message_type: inferIncomingMessageType(message),
    body,
    linked_order_id: linkedOrder.linkedOrderId,
    received_at: new Date(
      typeof message?.messageTimestamp === "number"
        ? message.messageTimestamp * 1000
        : Date.now()
    ).toISOString(),
    metadata: {
      remoteJid: message?.key?.remoteJid ?? null,
      participant: message?.key?.participant ?? null,
      pushName: message?.pushName ?? null,
      linkedOrderMode: linkedOrder.mode,
      candidateOrderIds: linkedOrder.candidateOrderIds,
      explicitOrderId: linkedOrder.explicitOrderId ?? null
    }
  };

  const { data: inserted, error } = await supabase
    .from("whatsapp_inbox_messages")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    logger.warn("whatsapp inbox insert failed", { orgId, normalizedPhone, error: error.message });
    return;
  }

  if (inserted?.id) {
    await processInboundReplyAutomation(orgId, String(inserted.id), normalizedPhone, body, linkedOrder).catch((error) => {
      logger.warn("whatsapp inbound automation failed", {
        orgId,
        inboxId: inserted.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  // A real reply from the same phone means the latest pending outbound message reached the recipient.
  await markLatestDeliveredForPhone(orgId, normalizedPhone, "reply:received");
}

async function syncMessageReceipt(orgId: string, update: any) {
  const providerMessageId = typeof update?.key?.id === "string" ? update.key.id : "";
  if (!providerMessageId) return;
  const statusValue = Number(update?.update?.status ?? update?.status ?? 0);
  const isDelivered = Number.isFinite(statusValue) && statusValue >= 3;
  const providerStatus = statusValue === 4
    ? "ack:read"
    : statusValue === 3
      ? "ack:delivered"
      : statusValue === 2
        ? "ack:server"
        : Number.isFinite(statusValue)
          ? `ack:${statusValue}`
          : "updated";
  const payload: Record<string, unknown> = {
    provider_status: providerStatus
  };
  if (isDelivered) {
    payload.status = "delivered";
    payload.delivered_at = new Date().toISOString();
  }

  let query = supabase
    .from("whatsapp_messages")
    .update(payload)
    .eq("org_id", orgId)
    .eq("provider_message_id", providerMessageId);

  if (isDelivered) {
    query = query.is("delivered_at", null);
  }

  const { error } = await query;

  if (error) {
    logger.warn("whatsapp delivery receipt sync failed", { orgId, providerMessageId, error: error.message });
  }
}

async function syncGroupedMessageReceipt(orgId: string, update: any) {
  const providerMessageId = typeof update?.key?.id === "string" ? update.key.id : "";
  if (!providerMessageId) return;
  const receiptTimestamp = Number(update?.receipt?.receiptTimestamp ?? 0);
  const readTimestamp = Number(update?.receipt?.readTimestamp ?? 0);
  const timestamp = readTimestamp || receiptTimestamp || Date.now() / 1000;
  const providerStatus = readTimestamp ? "receipt:read" : "receipt:delivered";

  const { error } = await supabase
    .from("whatsapp_messages")
    .update({
      status: "delivered",
      delivered_at: new Date(timestamp * 1000).toISOString(),
      provider_status: providerStatus
    })
    .eq("org_id", orgId)
    .eq("provider_message_id", providerMessageId)
    .is("delivered_at", null);

  if (error) {
    logger.warn("whatsapp grouped receipt sync failed", { orgId, providerMessageId, error: error.message });
  }
}

function clearReconnectTimer(connection: RuntimeConnection) {
  if (connection.reconnectTimer) {
    clearTimeout(connection.reconnectTimer);
    connection.reconnectTimer = null;
  }
}

function scheduleReconnect(connection: RuntimeConnection, delayMs: number, orgId: string) {
  clearReconnectTimer(connection);
  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = null;
    void ensureConnection(orgId).catch((error) => {
      logger.warn("whatsapp reconnect failed", {
        orgId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, delayMs);
}

function clearUserReconnectTimer(connection: UserRuntimeConnection) {
  if (connection.reconnectTimer) {
    clearTimeout(connection.reconnectTimer);
    connection.reconnectTimer = null;
  }
}

function scheduleUserReconnect(connection: UserRuntimeConnection, delayMs: number) {
  clearUserReconnectTimer(connection);
  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = null;
    void ensureUserConnection(connection.orgId, connection.userId).catch((error) => {
      logger.warn("user whatsapp reconnect failed", {
        orgId: connection.orgId,
        userId: connection.userId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, delayMs);
}

async function waitForConnectedSocket(orgId: string, timeoutMs = WHATSAPP_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connection = getConnection(orgId);
    const socket = connection.socket;
    if (socket?.user?.id) return socket;

    const current = await bootstrapSettings(orgId);
    if (current?.connection_status === "errored") {
      throw new Error("WhatsApp connection failed before it became ready.");
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error("WhatsApp is still pairing. Wait a moment and try again.");
}

async function waitForConnectedUserSocket(orgId: string, userId: string, timeoutMs = WHATSAPP_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connection = getUserConnection(orgId, userId);
    const socket = connection.socket;
    if (socket?.user?.id) return socket;

    const current = await bootstrapUserSettings(orgId, userId);
    if (current?.connection_status === "errored") {
      throw new Error("Your WhatsApp connection failed before it became ready.");
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error("Your WhatsApp is still pairing. Wait a moment and try again.");
}

export async function ensureWhatsAppReady(orgId: string, timeoutMs = WHATSAPP_READY_TIMEOUT_MS) {
  await ensureConnection(orgId);
  return waitForConnectedSocket(orgId, timeoutMs);
}

export async function ensureUserWhatsAppReady(orgId: string, userId: string, timeoutMs = WHATSAPP_READY_TIMEOUT_MS) {
  await ensureUserConnection(orgId, userId);
  return waitForConnectedUserSocket(orgId, userId, timeoutMs);
}

async function ensureConnection(orgId: string, requestedMode?: WhatsAppPairingMode, requestedPhone?: string | null) {
  const connection = getConnection(orgId);
  if (connection.connecting) return connection.connecting;

  connection.connecting = (async () => {
    const current = await bootstrapSettings(orgId);
    if (!current?.enabled) return;

    connection.mode = requestedMode ?? current.pairing_mode ?? "qr";
    connection.pairingPhone = requestedPhone ?? current.pairing_phone ?? null;
    if (connection.socket && !connection.disconnecting) {
      return;
    }

    clearReconnectTimer(connection);
    // Use Supabase-backed auth so sessions survive Railway restarts.
    // Keep disk session dir as fallback migration path but no longer primary.
    const { state, saveCreds } = await useOrgSupabaseAuthState(orgId);

    const sock = makeWASocket({
      auth: state,
      browser: Browsers.macOS("Protohub"),
      printQRInTerminal: false,
      logger: quietLogger
    });

    connection.socket = sock;
    connection.disconnecting = false;
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("messages.upsert", (event: any) => {
      const receiverPhone = parsePhoneFromJid(sock.user?.id);
      for (const message of event?.messages ?? []) {
        if (message?.key?.fromMe) continue;
        void logInboundMessage(orgId, message, receiverPhone).catch((error) => {
          logger.warn("whatsapp inbound handler failed", {
            orgId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    });
    sock.ev.on("messages.update", (updates: any[]) => {
      for (const update of updates ?? []) {
        void syncMessageReceipt(orgId, update).catch((error) => {
          logger.warn("whatsapp receipt handler failed", {
            orgId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    });
    sock.ev.on("message-receipt.update", (updates: any[]) => {
      for (const update of updates ?? []) {
        void syncGroupedMessageReceipt(orgId, update).catch((error) => {
          logger.warn("whatsapp grouped receipt handler failed", {
            orgId,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
    });

    sock.ev.on("connection.update", async (update) => {
      try {
        if (update.qr && connection.mode === "qr") {
          const qrDataUrl = await QRCode.toDataURL(update.qr, { errorCorrectionLevel: "M", margin: 1, scale: 6 });
          await updateConnectionRow(orgId, {
            connection_status: "pairing",
            qr_code_data_url: qrDataUrl,
            pairing_code: null,
            last_error: null,
            pairing_mode: "qr",
            pairing_phone: null
          });
        }

        if (update.connection === "open") {
          clearReconnectTimer(connection);
          await updateConnectionRow(orgId, {
            connection_status: "connected",
            connected_phone: parsePhoneFromJid(sock.user?.id) ?? connection.pairingPhone,
            connected_name: sock.user?.name ?? null,
            last_connected_at: new Date().toISOString(),
            last_error: null,
            pairing_code: null,
            qr_code_data_url: null
          });
        }

        if (update.connection === "close") {
          connection.socket = null;
          const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const isConflict = statusCode === DisconnectReason.connectionReplaced;
          const reason = update.lastDisconnect?.error instanceof Error ? update.lastDisconnect.error.message : "WhatsApp connection closed.";
          const qrExpired = /QR refs attempts ended/i.test(reason);

          if (connection.disconnecting || loggedOut) {
            clearReconnectTimer(connection);
            await clearSessionDir(orgId);
            await markDisconnected(orgId, loggedOut ? "WhatsApp session logged out. Pair again to continue." : null);
            connection.disconnecting = false;
            return;
          }

          connection.connecting = null;

          // Conflict = another instance connected with the same session (e.g. a Railway deploy).
          // Wait 30s for the new instance to stabilise, then reconnect quietly.
          if (isConflict) {
            await updateConnectionRow(orgId, {
              connection_status: "connecting",
              last_error: null,
              qr_code_data_url: null,
              pairing_code: null
            });
            scheduleReconnect(connection, 30_000, orgId);
            return;
          }

          if (qrExpired && !state.creds.registered && connection.mode === "qr") {
            await updateConnectionRow(orgId, {
              connection_status: "pairing",
              last_error: null,
              qr_code_data_url: null,
              pairing_code: null
            });
            scheduleReconnect(connection, 800, orgId);
            return;
          }

          await updateConnectionRow(orgId, {
            connection_status: "errored",
            last_error: reason,
            qr_code_data_url: null,
            pairing_code: null
          });
          scheduleReconnect(connection, 5000, orgId);
        }
      } catch (error) {
        logger.warn("whatsapp connection update handler failed", {
          orgId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    if (!state.creds.registered && !hasPersistedWhatsAppSession(state.creds)) {
      if (connection.mode === "pairing_code" && connection.pairingPhone) {
        const code = await sock.requestPairingCode(connection.pairingPhone);
        await updateConnectionRow(orgId, {
          connection_status: "pairing",
          pairing_mode: "pairing_code",
          pairing_phone: connection.pairingPhone,
          pairing_code: code,
          qr_code_data_url: null,
          last_error: null
        });
      } else {
        await updateConnectionRow(orgId, {
          connection_status: "pairing",
          pairing_mode: "qr",
          pairing_phone: null,
          pairing_code: null,
          qr_code_data_url: null,
          last_error: null
        });
      }
    }
  })().finally(() => {
    connection.connecting = null;
  });

  return connection.connecting;
}

async function ensureUserConnection(orgId: string, userId: string, requestedMode?: WhatsAppPairingMode, requestedPhone?: string | null) {
  const connection = getUserConnection(orgId, userId);
  if (connection.connecting) return connection.connecting;

  connection.connecting = (async () => {
    const current = await bootstrapUserSettings(orgId, userId);
    if (!current?.enabled) return;

    connection.mode = requestedMode ?? current.pairing_mode ?? "qr";
    connection.pairingPhone = requestedPhone ?? current.pairing_phone ?? null;
    if (connection.socket && !connection.disconnecting) {
      return;
    }

    clearUserReconnectTimer(connection);
    const { state, saveCreds } = await useUserSupabaseAuthState(orgId, userId);

    const sock = makeWASocket({
      auth: state,
      browser: Browsers.macOS("Protohub User"),
      printQRInTerminal: false,
      logger: quietLogger
    });

    connection.socket = sock;
    connection.disconnecting = false;
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      try {
        if (update.qr && connection.mode === "qr") {
          const qrDataUrl = await QRCode.toDataURL(update.qr, { errorCorrectionLevel: "M", margin: 1, scale: 6 });
          await updateUserConnectionRow(orgId, userId, {
            connection_status: "pairing",
            qr_code_data_url: qrDataUrl,
            pairing_code: null,
            last_error: null,
            pairing_mode: "qr",
            pairing_phone: null
          });
        }

        if (update.connection === "open") {
          clearUserReconnectTimer(connection);
          await updateUserConnectionRow(orgId, userId, {
            connection_status: "connected",
            connected_phone: parsePhoneFromJid(sock.user?.id) ?? connection.pairingPhone,
            connected_name: sock.user?.name ?? null,
            last_connected_at: new Date().toISOString(),
            last_error: null,
            pairing_code: null,
            qr_code_data_url: null
          });
        }

        if (update.connection === "close") {
          connection.socket = null;
          const statusCode = (update.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const isConflict = statusCode === DisconnectReason.connectionReplaced;
          const reason = update.lastDisconnect?.error instanceof Error ? update.lastDisconnect.error.message : "WhatsApp connection closed.";
          const qrExpired = /QR refs attempts ended/i.test(reason);

          if (connection.disconnecting || loggedOut) {
            clearUserReconnectTimer(connection);
            await clearUserSessionDir(orgId, userId);
            await markUserDisconnected(orgId, userId, loggedOut ? "WhatsApp session logged out. Pair again to continue." : null);
            connection.disconnecting = false;
            return;
          }

          connection.connecting = null;

          if (isConflict) {
            await updateUserConnectionRow(orgId, userId, {
              connection_status: "connecting",
              last_error: null,
              qr_code_data_url: null,
              pairing_code: null
            });
            scheduleUserReconnect(connection, 30_000);
            return;
          }

          if (qrExpired && !state.creds.registered && connection.mode === "qr") {
            await updateUserConnectionRow(orgId, userId, {
              connection_status: "pairing",
              last_error: null,
              qr_code_data_url: null,
              pairing_code: null
            });
            scheduleUserReconnect(connection, 800);
            return;
          }

          await updateUserConnectionRow(orgId, userId, {
            connection_status: "errored",
            last_error: reason,
            qr_code_data_url: null,
            pairing_code: null
          });
          scheduleUserReconnect(connection, 5000);
        }
      } catch (error) {
        logger.warn("user whatsapp connection update handler failed", {
          orgId,
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });

    if (!state.creds.registered && !hasPersistedWhatsAppSession(state.creds)) {
      if (connection.mode === "pairing_code" && connection.pairingPhone) {
        const code = await sock.requestPairingCode(connection.pairingPhone);
        await updateUserConnectionRow(orgId, userId, {
          connection_status: "pairing",
          pairing_mode: "pairing_code",
          pairing_phone: connection.pairingPhone,
          pairing_code: code,
          qr_code_data_url: null,
          last_error: null
        });
      } else {
        await updateUserConnectionRow(orgId, userId, {
          connection_status: "pairing",
          pairing_mode: "qr",
          pairing_phone: null,
          pairing_code: null,
          qr_code_data_url: null,
          last_error: null
        });
      }
    }
  })().finally(() => {
    connection.connecting = null;
  });

  return connection.connecting;
}

export async function startWhatsAppRuntime() {
  await mkdir(sessionRoot, { recursive: true });
  const { data, error } = await supabase
    .from("whatsapp_settings")
    .select("org_id, enabled, connection_status, pairing_mode, pairing_phone")
    .eq("enabled", true)
    .in("connection_status", ["pairing", "connected", "errored"]);

  if (error) {
    logger.warn("whatsapp runtime bootstrap failed", { error: error.message });
    return;
  }

  for (const row of (data ?? []) as RuntimeRow[]) {
    void ensureConnection(row.org_id, row.pairing_mode ?? "qr", row.pairing_phone ?? null).catch((bootstrapError) => {
      logger.warn("whatsapp org bootstrap failed", {
        orgId: row.org_id,
        error: bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError)
      });
    });
  }

  const { data: userData, error: userError } = await supabase
    .from("whatsapp_user_accounts")
    .select("org_id, user_id, enabled, connection_status, pairing_mode, pairing_phone")
    .eq("enabled", true)
    .in("connection_status", ["pairing", "connected", "errored"]);

  if (userError) {
    logger.warn("user whatsapp runtime bootstrap failed", { error: userError.message });
    return;
  }

  for (const row of (userData ?? []) as UserRuntimeRow[]) {
    void ensureUserConnection(row.org_id, row.user_id, row.pairing_mode ?? "qr", row.pairing_phone ?? null).catch((bootstrapError) => {
      logger.warn("user whatsapp bootstrap failed", {
        orgId: row.org_id,
        userId: row.user_id,
        error: bootstrapError instanceof Error ? bootstrapError.message : String(bootstrapError)
      });
    });
  }
}

export async function beginWhatsAppConnection(orgId: string, mode: WhatsAppPairingMode, phone?: string | null) {
  const pairingPhone = mode === "pairing_code" ? toDbPhone(phone) : null;
  if (mode === "pairing_code" && !pairingPhone) {
    throw new Error("Enter the WhatsApp number with country code for pairing code mode.");
  }

  const connection = getConnection(orgId);
  const current = await bootstrapSettings(orgId);
  clearReconnectTimer(connection);

  if (connection.socket && !connection.disconnecting) {
    if (current?.connection_status === "connected") {
      throw new Error("WhatsApp is already connected. Disconnect it first before starting a new pairing.");
    }
    if (
      current?.connection_status === "pairing" &&
      (current.pairing_mode ?? "qr") === mode &&
      (mode !== "pairing_code" || (current.pairing_phone ?? null) === pairingPhone)
    ) {
      return;
    }
    throw new Error("A WhatsApp pairing is already in progress. Disconnect it first before starting a new one.");
  }

  await updateConnectionRow(orgId, {
    enabled: true,
    connection_status: "pairing",
    pairing_mode: mode,
    pairing_phone: pairingPhone,
    pairing_code: null,
    qr_code_data_url: null,
    last_error: null
  });

  await ensureConnection(orgId, mode, pairingPhone);
}

export async function disconnectWhatsAppConnection(orgId: string) {
  const connection = getConnection(orgId);
  connection.disconnecting = true;
  clearReconnectTimer(connection);
  const socket = connection.socket;
  connection.socket = null;
  connection.connecting = null;
  if (socket) {
    try {
      await socket.logout();
    } catch {
      try {
        socket.end(new Error("Protohub requested WhatsApp disconnect"));
      } catch {
        // ignore close errors during cleanup
      }
    }
  }
  await clearSessionDir(orgId);
  await markDisconnected(orgId, null);
}

export async function beginUserWhatsAppConnection(orgId: string, userId: string, mode: WhatsAppPairingMode, phone?: string | null) {
  const pairingPhone = mode === "pairing_code" ? toDbPhone(phone) : null;
  if (mode === "pairing_code" && !pairingPhone) {
    throw new Error("Enter your WhatsApp number with country code for pairing code mode.");
  }

  const connection = getUserConnection(orgId, userId);
  const current = await bootstrapUserSettings(orgId, userId);
  clearUserReconnectTimer(connection);

  if (connection.socket && !connection.disconnecting) {
    if (current?.connection_status === "connected") {
      throw new Error("Your WhatsApp is already connected. Disconnect it first before starting a new pairing.");
    }
    if (
      current?.connection_status === "pairing" &&
      (current.pairing_mode ?? "qr") === mode &&
      (mode !== "pairing_code" || (current.pairing_phone ?? null) === pairingPhone)
    ) {
      return;
    }
    throw new Error("A WhatsApp pairing is already in progress. Disconnect it first before starting a new one.");
  }

  await updateUserConnectionRow(orgId, userId, {
    enabled: true,
    connection_status: "pairing",
    pairing_mode: mode,
    pairing_phone: pairingPhone,
    pairing_code: null,
    qr_code_data_url: null,
    last_error: null
  });

  await ensureUserConnection(orgId, userId, mode, pairingPhone);
}

export async function disconnectUserWhatsAppConnection(orgId: string, userId: string) {
  const connection = getUserConnection(orgId, userId);
  connection.disconnecting = true;
  clearUserReconnectTimer(connection);
  const socket = connection.socket;
  connection.socket = null;
  connection.connecting = null;
  if (socket) {
    try {
      await socket.logout();
    } catch {
      try {
        socket.end(new Error("Protohub requested personal WhatsApp disconnect"));
      } catch {
        // ignore close errors during cleanup
      }
    }
  }
  await clearUserSessionDir(orgId, userId);
  await markUserDisconnected(orgId, userId, null);
}

export async function sendConnectedWhatsApp(
  orgId: string,
  normalizedPhone: string,
  body: string,
  media?: { imageUrl?: string; videoUrl?: string; pdfBuffer?: Buffer; pdfFileName?: string }
) {
  const socket = await ensureWhatsAppReady(orgId);
  if (!socket) {
    throw new Error("WhatsApp is not connected yet.");
  }

  const jid = `${normalizeDigits(normalizedPhone)}@s.whatsapp.net`;

  // Anti-ban jitter: random 800ms – 2500ms delay before sending customer messages
  // so multiple order confirmations don't fire in a burst pattern.
  const jitterMs = 800 + Math.floor(Math.random() * 1700);
  await new Promise((resolve) => setTimeout(resolve, jitterMs));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sent: any;

  if (media?.pdfBuffer) {
    // Send PDF receipt as document with text as caption.
    // If there's also an image/video, send it as a second message after.
    try {
      sent = await socket.sendMessage(jid, {
        document: media.pdfBuffer,
        mimetype: "application/pdf",
        fileName: media.pdfFileName ?? "Order-Receipt.pdf",
        caption: body
      } as any);
    } catch {
      sent = await socket.sendMessage(jid, { text: body });
    }
    // Send product image/video as a follow-up if available
    if (media.videoUrl?.trim()) {
      await new Promise((r) => setTimeout(r, 600));
      await socket.sendMessage(jid, { video: { url: media.videoUrl.trim() }, mimetype: "video/mp4" } as any).catch(() => {});
    } else if (media.imageUrl?.trim()) {
      await new Promise((r) => setTimeout(r, 600));
      await socket.sendMessage(jid, { image: { url: media.imageUrl.trim() } } as any).catch(() => {});
    }
  } else if (media?.videoUrl?.trim()) {
    try {
      sent = await socket.sendMessage(jid, {
        video: { url: media.videoUrl.trim() },
        caption: body,
        mimetype: "video/mp4"
      } as any);
    } catch {
      sent = await socket.sendMessage(jid, { text: body });
    }
  } else if (media?.imageUrl?.trim()) {
    try {
      sent = await socket.sendMessage(jid, {
        image: { url: media.imageUrl.trim() },
        caption: body
      } as any);
    } catch {
      sent = await socket.sendMessage(jid, { text: body });
    }
  } else {
    sent = await socket.sendMessage(jid, { text: body });
  }

  return {
    providerMessageId: (sent?.key?.id as string | null | undefined) ?? undefined,
    providerStatus: "sent"
  };
}

export async function listUserWhatsAppGroups(orgId: string, userId: string) {
  const socket = await ensureUserWhatsAppReady(orgId, userId);
  if (!socket) {
    throw new Error("Your WhatsApp is not connected yet.");
  }

  const fetchGroups = (socket as any).groupFetchAllParticipating;
  if (typeof fetchGroups !== "function") {
    return [];
  }

  const groups = await fetchGroups.call(socket);
  return Object.entries(groups ?? {}).map(([jid, meta]) => {
    const record = (meta ?? {}) as Record<string, any>;
    return {
      jid,
      subject: typeof record.subject === "string" && record.subject.trim() ? record.subject.trim() : jid,
      participants: Array.isArray(record.participants) ? record.participants.length : null
    };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
}

export async function sendConnectedUserWhatsAppToJid(orgId: string, userId: string, destination: string, body: string) {
  const socket = await ensureUserWhatsAppReady(orgId, userId);
  if (!socket) {
    throw new Error("Your WhatsApp is not connected yet.");
  }

  const cleanDestination = destination.trim();
  const jid = cleanDestination.includes("@")
    ? cleanDestination
    : `${normalizeDigits(cleanDestination)}@s.whatsapp.net`;
  if (!jid.endsWith("@g.us") && !jid.endsWith("@s.whatsapp.net")) {
    throw new Error("Choose a WhatsApp group or phone destination before direct sending.");
  }

  const sent = await socket.sendMessage(jid, { text: body });
  return {
    providerMessageId: sent?.key?.id ?? undefined,
    providerStatus: "sent"
  };
}
