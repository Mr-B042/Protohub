// ── Telegram Automation Center: sending, staff links, bot replies, jobs ─────
// (Bright, 6 Nov 2026.) Rules and wording: telegram-rules.ts. Bot API calls:
// telegram-api.ts. Every message is logged in telegram_messages; a dedupe key
// there (unique per person) stops a reminder going out twice.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { resolvePublicApiBaseUrl } from "./push-branding.js";
import { arrivedAtMs } from "./late-send.js";
import { LATE_SEND_FROM, lateSendWindow, workingMinutesBetween } from "./late-send-rules.js";
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey } from "./sales-bonus-engine.js";
import { tidyOrderState } from "./order-state.js";
import { sendPushToUser } from "./push.js";
import {
  tgAnswerCallback, tgDeleteCommands, tgDeleteWebhook, tgEscape, tgGetMe, tgSendMessage, tgSetCommands, tgSetWebhook, tgWebhookInfo,
  type TgUpdate
} from "./telegram-api.js";
import {
  COMMANDS, DEFAULT_AUTOMATIONS, FORWARD_GROUPS, LEADERSHIP_ROLES, TRIGGERS, buildKeyboard, cartDraft, cleanCommandSettings, cleanQuiet,
  cleanRecipients, cleanSettings, commandAllowed, commandDeniedText, commandsFor, followUpDraft, forwardDedupeKey, forwardedDraft, isQuietTime,
  kindForwarded, lowStockDraft, naira, orderDraft,
  myOrdersDraft, previewOf, repTodayDraft, repWeekNoteDraft, reportDraft, waybillDueDraft, waybillMissedDraft, lagosClock, type WaybillLine, roleMayReceive, seesCustomer, seesRevenue, sendOutSoonDraft, forwardCheck, isRepRole, lateTodayDraft,
  type AutomationSettings, type BusinessReport, type CartInfo, type CommandKey, type Draft, type LowStockItem, type OrderInfo,
  type QuietHours, type Recipients, type RepDay, type TriggerKey
} from "./telegram-rules.js";
import { insightAnswer } from "./telegram-insights.js";

// ── Bot row ─────────────────────────────────────────────────────────────────

export type BotSettings = {
  commands?: Partial<Record<CommandKey, boolean>>;
  /** FORWARD_GROUPS keys switched on. */
  forward?: string[];
  /** Low-stock items already announced: key -> usable count and Lagos day. */
  lowStock?: Record<string, { u: number; d: string }>;
  /** Night messages arrive without a sound. */
  quiet?: Partial<QuietHours>;
  /** Webhook checks failed in a row, and when the Owner was last told. */
  healthFails?: number;
  healthAlertAt?: string | null;
  /** What the "/" menus were last set to (commands, switches, each linked chat's role). */
  menuKey?: string;
};

export type BotRow = {
  org_id: string; token: string; bot_id: number | null; username: string | null; name: string | null;
  webhook_secret: string; webhook_url: string | null; status: string; last_error: string | null;
  connected_at: string; settings: BotSettings; health: Record<string, { ok: number; total: number }>;
  last_health_at: string | null; last_update_at: string | null;
};

const BOT_CACHE_MS = 60_000;
const botCache = new Map<string, { at: number; bot: BotRow | null }>();

export async function getBot(orgId: string, fresh = false): Promise<BotRow | null> {
  const hit = botCache.get(orgId);
  if (!fresh && hit && Date.now() - hit.at < BOT_CACHE_MS) return hit.bot;
  const { data, error } = await supabase.from("telegram_bots").select("*").eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  const bot = data ? { ...(data as any), settings: (data as any).settings ?? {}, health: (data as any).health ?? {} } as BotRow : null;
  botCache.set(orgId, { at: Date.now(), bot });
  return bot;
}

export function forgetBot(orgId: string) {
  botCache.delete(orgId);
  linkCache.delete(orgId);
  automationCache.delete(orgId);
}

const appBase = () => {
  const base = (process.env.FRONTEND_URL ?? "").split(",")[0]?.trim().replace(/\/+$/, "");
  return base || null;
};

export const webhookUrlFor = (orgId: string) => {
  const base = resolvePublicApiBaseUrl();
  return base ? `${base}/api/telegram/webhook/${orgId}` : null;
};

// ── Staff links ─────────────────────────────────────────────────────────────

export type LinkRow = { user_id: string; org_id: string; chat_id: string; bot_id: number | null; telegram_username: string | null; telegram_name: string | null; linked_at: string };
const linkCache = new Map<string, { at: number; links: Map<string, LinkRow> }>();

export async function linksFor(orgId: string, fresh = false): Promise<Map<string, LinkRow>> {
  const hit = linkCache.get(orgId);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.links;
  const bot = await getBot(orgId);
  const { data, error } = await supabase.from("telegram_links").select("*").eq("org_id", orgId);
  if (error) throw error;
  // A chat that started an earlier bot cannot be reached by this one.
  const links = new Map(((data ?? []) as LinkRow[]).filter((row) => !bot?.bot_id || !row.bot_id || Number(row.bot_id) === Number(bot.bot_id)).map((row) => [row.user_id, row]));
  linkCache.set(orgId, { at: Date.now(), links });
  return links;
}

export async function createLinkCode(orgId: string, userId: string, createdBy: string) {
  const bot = await getBot(orgId, true);
  if (!bot?.username) throw new Error("Connect the bot first (Bot Configuration).");
  const code = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  const { error } = await supabase.from("telegram_link_codes").insert({ code, org_id: orgId, user_id: userId, created_by: createdBy, expires_at: expiresAt });
  if (error) throw error;
  return { url: `https://t.me/${bot.username}?start=${code}`, expiresAt };
}

export async function unlinkUser(orgId: string, userId: string) {
  const link = (await linksFor(orgId, true)).get(userId);
  const { error } = await supabase.from("telegram_links").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) throw error;
  linkCache.delete(orgId);
  // Their own "/" menu goes too (a chat that blocked the bot cannot be changed: ignored).
  const bot = link ? await getBot(orgId) : null;
  if (bot && link) await tgDeleteCommands(bot.token, link.chat_id);
}

// ── Automations ─────────────────────────────────────────────────────────────

export type AutomationRow = {
  id: string; org_id: string; trigger: TriggerKey; name: string; enabled: boolean; recipients: Recipients;
  settings: AutomationSettings; built_in: boolean; created_at: string; updated_at: string;
};
const automationCache = new Map<string, { at: number; rows: AutomationRow[] }>();

export async function ensureDefaultAutomations(orgId: string) {
  const { data, error } = await supabase.from("telegram_automations").select("trigger").eq("org_id", orgId).eq("built_in", true);
  if (error) throw error;
  const have = new Set(((data ?? []) as any[]).map((row) => String(row.trigger)));
  const missing = DEFAULT_AUTOMATIONS.filter((row) => !have.has(row.trigger));
  // One at a time: two page loads at once both try, and the database lets
  // only one ready-made per trigger in (migration 327); the other is skipped.
  for (const row of missing) {
    const insert = await supabase.from("telegram_automations").insert({
      org_id: orgId, trigger: row.trigger, name: row.name, enabled: row.enabled, recipients: row.recipients, settings: row.settings, built_in: true
    });
    if (insert.error && (insert.error as any).code !== "23505") throw insert.error;
  }
  automationCache.delete(orgId);
}

export async function automationsFor(orgId: string, fresh = false): Promise<AutomationRow[]> {
  const hit = automationCache.get(orgId);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.rows;
  const { data, error } = await supabase.from("telegram_automations").select("*").eq("org_id", orgId).order("created_at", { ascending: true });
  if (error) throw error;
  const rows = ((data ?? []) as any[]).filter((row) => row.trigger in TRIGGERS).map((row) => ({
    ...row,
    recipients: cleanRecipients(row.trigger, row.recipients),
    settings: cleanSettings(row.trigger, row.settings)
  })) as AutomationRow[];
  automationCache.set(orgId, { at: Date.now(), rows });
  return rows;
}

export const forgetAutomations = (orgId: string) => automationCache.delete(orgId);

// ── People ──────────────────────────────────────────────────────────────────

type Person = { userId: string; role: string; name: string };
const peopleCache = new Map<string, { at: number; people: Map<string, Person> }>();

async function peopleOf(orgId: string): Promise<Map<string, Person>> {
  const hit = peopleCache.get(orgId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.people;
  const { data, error } = await supabase.from("users").select("id, name, role, active").eq("org_id", orgId).eq("active", true);
  if (error) throw error;
  const people = new Map(((data ?? []) as any[]).map((row) => [String(row.id), { userId: String(row.id), role: String(row.role ?? ""), name: String(row.name ?? "Staff") }]));
  peopleCache.set(orgId, { at: Date.now(), people });
  return people;
}

// ── Branches: a person only hears about the branches they work in ──────────
// The Owner covers every branch. Everyone else is limited to their
// branch_memberships (an account with none cannot use the app at all).
const branchCache = new Map<string, { at: number; byUser: Map<string, Set<string>> }>();

async function branchesOf(orgId: string): Promise<Map<string, Set<string>>> {
  const hit = branchCache.get(orgId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.byUser;
  const people = await peopleOf(orgId);
  const ids = [...people.keys()];
  const byUser = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from("branch_memberships").select("user_id, branch_id").in("user_id", ids.slice(i, i + 200));
    if (error) throw error;
    for (const row of (data ?? []) as any[]) {
      const set = byUser.get(String(row.user_id)) ?? new Set<string>();
      set.add(String(row.branch_id));
      byUser.set(String(row.user_id), set);
    }
  }
  branchCache.set(orgId, { at: Date.now(), byUser });
  return byUser;
}

/** null = every branch (the Owner); otherwise the branch ids this person works in. */
async function branchIdsFor(orgId: string, person: Person): Promise<string[] | null> {
  if (person.role === "Owner") return null;
  return [...((await branchesOf(orgId)).get(person.userId) ?? new Set<string>())];
}

async function inBranch(orgId: string, person: Person, branchId: string | null | undefined) {
  if (!branchId || person.role === "Owner") return true;
  return (await branchesOf(orgId)).get(person.userId)?.has(branchId) ?? false;
}

async function recipientsOf(orgId: string, recipients: Recipients, assignedRepId: string | null, branchId?: string | null): Promise<Person[]> {
  const people = await peopleOf(orgId);
  const out = new Map<string, Person>();
  for (const person of people.values()) if (recipients.roles.includes(person.role)) out.set(person.userId, person);
  for (const id of recipients.userIds) { const person = people.get(id); if (person) out.set(id, person); }
  // Branch: everyone named by role or by hand must work in the event's branch.
  for (const [id, person] of out) if (!(await inBranch(orgId, person, branchId))) out.delete(id);
  // The order's own rep always hears about their order.
  if (recipients.assignedRep && assignedRepId) { const person = people.get(assignedRepId); if (person) out.set(assignedRepId, person); }
  return [...out.values()];
}

// ── Telling the Owner (in the app and by phone alert; Telegram may be the thing that broke) ──

async function noticeOwners(orgId: string, title: string, message: string, type: "info" | "needs_attention") {
  const owners = [...(await peopleOf(orgId)).values()].filter((person) => person.role === "Owner");
  if (!owners.length) return;
  const link = "/dashboard/admin/telegram-bot?tab=staff";
  const { error } = await supabase.from("system_notifications").insert(owners.map((owner) => ({
    org_id: orgId, recipient_id: owner.userId, type, title, message, link, read: false
  })));
  if (error) logger.warn("telegram notice insert failed", { orgId, error: error.message });
  // kind telegram_notice is never copied back into Telegram.
  await Promise.all(owners.map((owner) => sendPushToUser(orgId, owner.userId, { title, body: message, kind: "telegram_notice", url: link, tag: `telegram-notice-${title}` }).catch(() => null)));
}

// ── Sending ─────────────────────────────────────────────────────────────────

type SendInput = {
  orgId: string; bot: BotRow; trigger: string; automationId?: string | null; person: Person; chatId: string;
  draft: Draft; orderId?: string | null; dedupeKey?: string | null; batchId?: string | null;
};
export type SendOutcome = "sent" | "failed" | "duplicate";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const quietOf = (bot: BotRow) => cleanQuiet(bot.settings.quiet);

/** One attempt at Telegram, with the fallbacks that never need a person. */
async function deliver(bot: BotRow, chatId: string, text: string, keyboard: ReturnType<typeof buildKeyboard>) {
  const silent = isQuietTime(Date.now(), quietOf(bot));
  let result = await tgSendMessage(bot.token, chatId, text, keyboard, silent);
  if (!result.ok && result.retryAfter) {
    await sleep(Math.min(5, result.retryAfter) * 1000);
    result = await tgSendMessage(bot.token, chatId, text, keyboard, silent);
  }
  // A link Telegram will not take (a local address) must not stop the message.
  if (!result.ok && /button|url/i.test(result.error) && keyboard.length) {
    result = await tgSendMessage(bot.token, chatId, text, undefined, silent);
  }
  return result;
}

/** Network trouble, Telegram busy or down: worth trying again. A refusal is not. */
const worthRetrying = (code: number | undefined) => code === undefined || code === 429 || code >= 500;

async function afterSend(orgId: string, logId: string, person: Person, result: Awaited<ReturnType<typeof deliver>>, attempts: number): Promise<SendOutcome> {
  if (result.ok) {
    await supabase.from("telegram_messages").update({ status: "sent", sent_at: new Date().toISOString(), telegram_message_id: result.result.message_id, attempts, error: null, retryable: false }).eq("id", logId);
    return "sent";
  }
  const blocked = result.code === 403;
  await supabase.from("telegram_messages").update({
    status: "failed", attempts, retryable: !blocked && worthRetrying(result.code) && attempts < 3,
    error: blocked ? "They blocked the bot or deleted the chat. They need to connect again." : result.error.slice(0, 300)
  }).eq("id", logId);
  // A blocked chat can never be reached again: show them as not connected, and tell the Owner.
  if (blocked) {
    const wasLinked = (await linksFor(orgId, true)).has(person.userId);
    await unlinkUser(orgId, person.userId).catch(() => {});
    if (wasLinked) await noticeOwners(orgId, `${person.name} stopped the Telegram bot`, `${person.name} blocked the Protohub bot or deleted the chat, so they are disconnected and get no Telegram alerts until they connect again.`, "needs_attention").catch(() => null);
  }
  return "failed";
}

export async function sendLogged(input: SendInput): Promise<SendOutcome> {
  const keyboard = buildKeyboard(input.draft.keyboard, appBase());
  const { data: logRow, error: logError } = await supabase.from("telegram_messages").insert({
    org_id: input.orgId, automation_id: input.automationId ?? null, trigger: input.trigger, user_id: input.person.userId,
    chat_id: input.chatId, order_id: input.orderId ?? null, dedupe_key: input.dedupeKey ?? null, batch_id: input.batchId ?? null,
    title: input.draft.title.slice(0, 200), preview: previewOf(input.draft.text), status: "sending",
    // Kept so a message that did not go through can be sent again exactly.
    payload: { text: input.draft.text, keyboard }
  }).select("id").single();
  if (logError) {
    if ((logError as any).code === "23505") return "duplicate";
    throw logError;
  }
  const result = await deliver(input.bot, input.chatId, input.draft.text, keyboard);
  return afterSend(input.orgId, String((logRow as any).id), input.person, result, 1);
}

/**
 * Every 5 minutes: send again what did not go through. "sending" for over 10
 * minutes = the server stopped mid-send; failed for a passing reason = try
 * again, up to 3 times, within 6 hours (an old reminder is no use).
 */
export async function runRetries(nowMs = Date.now()) {
  let resent = 0;
  const { data, error } = await supabase.from("telegram_messages")
    .select("id, org_id, user_id, chat_id, payload, attempts, status, created_at, retryable")
    .or(`and(status.eq.sending,created_at.lt.${new Date(nowMs - 10 * 60_000).toISOString()}),and(status.eq.failed,retryable.eq.true)`)
    .gte("created_at", new Date(nowMs - 6 * 3_600_000).toISOString())
    .order("created_at", { ascending: true }).limit(200);
  if (error) throw error;
  for (const row of (data ?? []) as any[]) {
    const bot = await getBot(String(row.org_id));
    const person = (await peopleOf(String(row.org_id))).get(String(row.user_id));
    const payload = row.payload as { text?: string; keyboard?: ReturnType<typeof buildKeyboard> } | null;
    if (!bot || bot.status !== "connected" || !person || !payload?.text || !row.chat_id) {
      await supabase.from("telegram_messages").update({ status: "failed", retryable: false, error: "Could not be sent again (bot or person no longer connected)." }).eq("id", row.id);
      continue;
    }
    const attempts = Number(row.attempts ?? 1) + 1;
    await supabase.from("telegram_messages").update({ status: "sending", attempts }).eq("id", row.id);
    const outcome = await afterSend(String(row.org_id), String(row.id), person, await deliver(bot, String(row.chat_id), payload.text, payload.keyboard ?? []), attempts);
    if (outcome === "sent") resent += 1;
  }
  // Older than 6 hours and still not through: stop trying, say so.
  await supabase.from("telegram_messages").update({ status: "failed", retryable: false, error: "Not delivered: Telegram could not be reached for 6 hours." })
    .or("status.eq.sending,and(status.eq.failed,retryable.eq.true)").lt("created_at", new Date(nowMs - 6 * 3_600_000).toISOString());
  return { resent };
}

/** Once a day: message records older than 90 days, used or expired connect codes older than 7. */
export async function runTelegramCleanup(nowMs = Date.now()) {
  await supabase.from("telegram_messages").delete().lt("created_at", new Date(nowMs - 90 * 86_400_000).toISOString());
  await supabase.from("telegram_link_codes").delete().lt("created_at", new Date(nowMs - 7 * 86_400_000).toISOString());
}

type TriggerContext = {
  assignedRepId?: string | null;
  orderId?: string | null;
  /** Same event, same person: one message (combined with the trigger). */
  dedupeBase?: string | null;
  /** Owner-only event (a Silent Test order). */
  ownerOnly?: boolean;
  /** The branch the event belongs to (null = organisation-wide). */
  branchId?: string | null;
  draftFor: (person: Person) => Draft | null | Promise<Draft | null>;
};

/** Send one event to everyone its enabled automations name (linked people only). */
export async function runTrigger(orgId: string, trigger: TriggerKey, ctx: TriggerContext, only?: AutomationRow): Promise<number> {
  const bot = await getBot(orgId);
  if (!bot || bot.status !== "connected") return 0;
  const automations = only ? [only] : (await automationsFor(orgId)).filter((row) => row.trigger === trigger && row.enabled);
  if (automations.length === 0) return 0;
  const links = await linksFor(orgId);
  if (links.size === 0) return 0;
  let sent = 0;
  const done = new Set<string>();
  for (const automation of automations) {
    for (const person of await recipientsOf(orgId, automation.recipients, ctx.assignedRepId ?? null, ctx.branchId)) {
      if (done.has(person.userId)) continue;
      if (ctx.ownerOnly && person.role !== "Owner") continue;
      // Reports are leadership only; a rep only ever gets their OWN order or cart
      // (as "the order's own rep"), whatever an older setting says.
      const ownEvent = ctx.assignedRepId === person.userId && automation.recipients.assignedRep;
      if (!roleMayReceive(trigger, person.role) && !ownEvent) continue;
      if (isRepRole(person.role) && trigger !== "weekly_rep_note" && !ownEvent) continue;
      const link = links.get(person.userId);
      if (!link) continue;
      const draft = await ctx.draftFor(person);
      if (!draft) continue;
      done.add(person.userId);
      const outcome = await sendLogged({
        orgId, bot, trigger, automationId: automation.id, person, chatId: link.chat_id, draft,
        orderId: ctx.orderId ?? null, dedupeKey: ctx.dedupeBase ? `${trigger}:${ctx.dedupeBase}` : null
      }).catch((error) => { logger.warn("telegram send failed", { orgId, trigger, error: String(error?.message ?? error) }); return "failed" as const; });
      if (outcome === "sent") sent += 1;
    }
  }
  return sent;
}

// ── Order events ────────────────────────────────────────────────────────────

const ORDER_SELECT = "id, customer, phone, product_name, package_name, quantity, amount, city, state, status, assigned_rep_id, call_outcome, launch_stage, review_hold, branch_id";

async function orderInfo(orgId: string, orderId: string): Promise<(OrderInfo & { assignedRepId: string | null; silent: boolean; branchId: string | null }) | null> {
  const { data, error } = await supabase.from("orders").select(ORDER_SELECT).eq("org_id", orgId).eq("id", orderId).maybeSingle();
  if (error || !data) return null;
  const row = data as any;
  const people = await peopleOf(orgId);
  return {
    id: String(row.id), customer: row.customer ?? null, phone: row.phone ?? null, productName: row.product_name ?? null,
    packageName: row.package_name ?? null, quantity: row.quantity == null ? null : Number(row.quantity), amount: row.amount == null ? null : Number(row.amount),
    city: row.city ?? null, state: row.state ?? null, status: row.status ?? null, callOutcome: row.call_outcome ?? null,
    repName: row.assigned_rep_id ? people.get(String(row.assigned_rep_id))?.name ?? null : null,
    assignedRepId: row.assigned_rep_id ? String(row.assigned_rep_id) : null,
    silent: row.launch_stage === "silent",
    held: row.review_hold === true,
    branchId: row.branch_id ? String(row.branch_id) : null
  };
}

const STATUS_TRIGGER: Record<string, TriggerKey> = {
  New: "order_new", Assigned: "order_assigned", Confirmed: "order_confirmed", Delivered: "order_delivered",
  Failed: "order_failed", Cancelled: "order_cancelled", Rescheduled: "order_rescheduled"
};

/** Called where the app announces an order event (order-notifications.ts). Never throws. */
export async function telegramOrderEvent(orgId: string, orderId: string, status: string) {
  try {
    const trigger = STATUS_TRIGGER[status];
    if (!trigger) return;
    const bot = await getBot(orgId);
    if (!bot || bot.status !== "connected") return;
    if (!(await automationsFor(orgId)).some((row) => row.trigger === trigger && row.enabled)) return;
    const order = await orderInfo(orgId, orderId);
    if (!order) return;
    await runTrigger(orgId, trigger, {
      assignedRepId: order.assignedRepId, orderId: order.id, ownerOnly: order.silent, branchId: order.branchId,
      // New/assigned once per order; later status changes once per day.
      dedupeBase: trigger === "order_new" ? order.id : `${order.id}:${status}:${lagosDateKey()}`,
      draftFor: (person) => orderDraft(trigger, order, person.role)
    });
  } catch (error) {
    logger.warn("telegram order event failed", { orgId, orderId, status, error: String((error as Error)?.message ?? error) });
  }
}

/** A follow-up came due (order-follow-up-notifications.ts). Never throws. */
export async function telegramFollowUpDue(orgId: string, order: { id: string; assigned_rep_id?: string | null }, title: string, message: string, tag: string) {
  try {
    const bot = await getBot(orgId);
    if (!bot || bot.status !== "connected") return;
    if (!(await automationsFor(orgId)).some((row) => row.trigger === "follow_up_due" && row.enabled)) return;
    // launch-safe: only the branch of an order the follow-up job already picked (it skips Silent Test orders).
    const { data: row } = await supabase.from("orders").select("branch_id").eq("org_id", orgId).eq("id", order.id).maybeSingle();
    await runTrigger(orgId, "follow_up_due", {
      assignedRepId: order.assigned_rep_id ?? null, orderId: order.id, dedupeBase: tag, branchId: (row as any)?.branch_id ?? null,
      draftFor: (person) => followUpDraft(order.id, title, message, person.role)
    });
  } catch (error) {
    logger.warn("telegram follow-up failed", { orgId, orderId: order.id, error: String((error as Error)?.message ?? error) });
  }
}

/** A phone alert, copied to Telegram when the Owner switched its group on (push.ts). Never throws. */
export async function forwardPushToTelegram(orgId: string, userId: string, payload: { title: string; body: string; kind?: string; url?: string; tag?: string }) {
  try {
    const bot = await getBot(orgId);
    if (!bot || bot.status !== "connected") return;
    const groups = new Set(bot.settings.forward ?? []);
    if (!groups.size || !kindForwarded(payload.kind, groups)) return;
    const link = (await linksFor(orgId)).get(userId);
    if (!link) return;
    const person = (await peopleOf(orgId)).get(userId);
    if (!person) return;
    // A rep only gets alerts about their own orders, never company-wide ones.
    const check = forwardCheck(person.role, payload.kind, payload.tag);
    if (!check.allowed) return;
    if (check.ownOrderId) {
      // launch-safe: only who the order belongs to is read, to decide; nothing of it is shown.
      const { data: own } = await supabase.from("orders").select("assigned_rep_id").eq("org_id", orgId).eq("id", check.ownOrderId).maybeSingle();
      if (String((own as any)?.assigned_rep_id ?? "") !== person.userId) return;
    }
    await sendLogged({
      orgId, bot, trigger: "app_alert", person, chatId: link.chat_id,
      draft: forwardedDraft(payload.title, payload.body, payload.url),
      // An order alert shares its key with the matching automation: one message, not two.
      dedupeKey: forwardDedupeKey(payload.kind, payload.tag, lagosDateKey())
    });
  } catch (error) {
    logger.warn("telegram forward failed", { orgId, error: String((error as Error)?.message ?? error) });
  }
}

/** A cart was handed to a rep (cart-notifications.ts notifyCartAssignedToRep). Never throws. */
export async function telegramCartAssigned(orgId: string, cartId: string, repId: string) {
  try {
    const bot = await getBot(orgId);
    if (!bot || bot.status !== "connected") return;
    if (!(await automationsFor(orgId)).some((row) => row.trigger === "cart_assigned" && row.enabled)) return;
    const { data, error } = await supabase.from("abandoned_carts").select("id, customer, product_name, package_name, amount, city, state, branch_id").eq("org_id", orgId).eq("id", cartId).maybeSingle();
    if (error || !data) return;
    const row = data as any;
    const cart: CartInfo = {
      id: String(row.id), customer: row.customer ?? null, productName: row.product_name ?? null, packageName: row.package_name ?? null,
      amount: row.amount == null ? null : Number(row.amount), city: row.city ?? null, state: row.state ?? null,
      repName: (await peopleOf(orgId)).get(repId)?.name ?? null
    };
    await runTrigger(orgId, "cart_assigned", {
      assignedRepId: repId, dedupeBase: `${cart.id}:${repId}`, branchId: row.branch_id ?? null,
      draftFor: (person) => cartDraft(cart, person.role)
    });
  } catch (error) {
    logger.warn("telegram cart assigned failed", { orgId, cartId, error: String((error as Error)?.message ?? error) });
  }
}

// ── Connecting the bot ──────────────────────────────────────────────────────

export async function connectBot(orgId: string, token: string, userId: string) {
  const me = await tgGetMe(token);
  if (!me.ok) throw new Error(me.code === 401 ? "Telegram did not accept this token. Copy it again from @BotFather." : me.error);
  if (!me.result.is_bot) throw new Error("This token is not for a bot.");
  const previous = await getBot(orgId, true);
  const secret = randomBytes(24).toString("hex");
  const url = webhookUrlFor(orgId);
  let lastError: string | null = null;
  if (url && url.startsWith("https://")) {
    const hook = await tgSetWebhook(token, url, secret);
    if (!hook.ok) lastError = `Telegram could not reach Protohub: ${hook.error}`;
  } else {
    lastError = "Replies and the Connect button need Protohub's public https address (works on the live site).";
  }
  const row = {
    org_id: orgId, token, bot_id: me.result.id, username: me.result.username ?? null,
    name: [me.result.first_name, me.result.last_name].filter(Boolean).join(" ") || me.result.username || "Bot",
    webhook_secret: secret, webhook_url: url, status: "connected", last_error: lastError,
    connected_at: new Date().toISOString(), connected_by: userId, updated_at: new Date().toISOString(),
    settings: previous?.settings ?? {}
  };
  const { error } = await supabase.from("telegram_bots").upsert(row, { onConflict: "org_id" });
  if (error) throw error;
  // A different bot: chats that started the old one cannot be reached.
  if (previous?.bot_id && Number(previous.bot_id) !== Number(me.result.id)) {
    await supabase.from("telegram_links").delete().eq("org_id", orgId);
  }
  forgetBot(orgId);
  await ensureDefaultAutomations(orgId);
  await pushCommandMenu(orgId);
  return getBot(orgId, true);
}

export async function disconnectBot(orgId: string) {
  const bot = await getBot(orgId, true);
  if (bot) await tgDeleteWebhook(bot.token).catch(() => null);
  const { error } = await supabase.from("telegram_bots").delete().eq("org_id", orgId);
  if (error) throw error;
  forgetBot(orgId);
}

export async function saveBotSettings(orgId: string, patch: BotSettings) {
  const bot = await getBot(orgId, true);
  if (!bot) throw new Error("Connect the bot first.");
  const settings = { ...bot.settings, ...patch };
  const { error } = await supabase.from("telegram_bots").update({ settings, updated_at: new Date().toISOString() }).eq("org_id", orgId);
  if (error) throw error;
  forgetBot(orgId);
  return settings;
}

const menuOf = (commands: typeof COMMANDS) => commands.map((command) => ({ command: command.key, description: command.description }));

/** What every "/" menu should be now, and one key for it: a new command, a switch, a new link or a role change all change the key. */
async function menuPlan(orgId: string, bot: BotRow) {
  const enabled = cleanCommandSettings(bot.settings.commands);
  const people = await peopleOf(orgId);
  // role "" = the account was switched off: its chat loses its menu.
  const chats = [...(await linksFor(orgId, true)).values()]
    .map((link) => ({ chatId: link.chat_id, role: people.get(link.user_id)?.role ?? "" }))
    .sort((a, b) => a.chatId.localeCompare(b.chatId));
  const key = createHash("sha1").update(JSON.stringify({ commands: COMMANDS.map((command) => [command.key, command.description]), enabled, chats })).digest("hex").slice(0, 16);
  return { enabled, chats, key };
}

/**
 * The "/" menus Telegram shows (Bright, 6 Nov 2026: the new commands are
 * strictly for leadership). A chat not linked to anyone sees only /help;
 * each linked person gets their own menu with what their role can use.
 */
export async function pushCommandMenu(orgId: string) {
  const bot = await getBot(orgId, true);
  if (!bot) return;
  const plan = await menuPlan(orgId, bot);
  await tgSetCommands(bot.token, menuOf(COMMANDS.filter((command) => command.key === "help")));
  for (let i = 0; i < plan.chats.length; i += 5) {
    await Promise.all(plan.chats.slice(i, i + 5).map((chat) => chat.role
      ? tgSetCommands(bot.token, menuOf(commandsFor(chat.role, plan.enabled)), chat.chatId)
      : tgDeleteCommands(bot.token, chat.chatId)));
  }
  await saveBotSettings(orgId, { menuKey: plan.key });
}

/** Every 15 minutes: the menus follow a deploy with new commands, or a role change, without anyone pressing anything. */
async function syncCommandMenus(orgId: string) {
  const bot = await getBot(orgId, true);
  if (!bot) return;
  if ((await menuPlan(orgId, bot)).key !== bot.settings.menuKey) await pushCommandMenu(orgId);
}

/** Webhook check (every 15 min): Telegram can reach us and has no fresh error. */
export async function checkBotHealth(orgId: string) {
  const bot = await getBot(orgId, true);
  if (!bot) return null;
  const expected = webhookUrlFor(orgId);
  const info = await tgWebhookInfo(bot.token);
  let ok = info.ok;
  let lastError: string | null = info.ok ? null : info.error;
  if (info.ok && expected?.startsWith("https://")) {
    if (info.result.url !== expected) {
      const hook = await tgSetWebhook(bot.token, expected, bot.webhook_secret);
      ok = hook.ok;
      lastError = hook.ok ? null : `Telegram could not reach Protohub: ${hook.error}`;
    } else if (info.result.last_error_date && Date.now() - info.result.last_error_date * 1000 < 15 * 60_000) {
      ok = false;
      lastError = info.result.last_error_message ?? "Telegram could not deliver a reply to Protohub.";
    }
  }
  const day = lagosDateKey();
  const health = { ...bot.health };
  const today = health[day] ?? { ok: 0, total: 0 };
  health[day] = { ok: today.ok + (ok ? 1 : 0), total: today.total + 1 };
  const keep = addDaysToDateKey(day, -8);
  for (const key of Object.keys(health)) if (key < keep) delete health[key];
  // Broken for an hour (4 checks in a row): tell the Owner once; and once more when it works again.
  const fails = ok ? 0 : (bot.settings.healthFails ?? 0) + 1;
  let healthAlertAt = bot.settings.healthAlertAt ?? null;
  if (fails >= 4 && !healthAlertAt) {
    healthAlertAt = new Date().toISOString();
    await noticeOwners(orgId, "The Telegram bot is not working", `For the last hour Protohub could not reach the Telegram bot (${lastError ?? "no answer"}). Staff are not getting Telegram alerts. Open Telegram Bot → Bot Configuration → Check now.`, "needs_attention").catch(() => null);
  } else if (ok && healthAlertAt) {
    healthAlertAt = null;
    await noticeOwners(orgId, "The Telegram bot is working again", "Protohub can reach the Telegram bot again. Alerts are going out.", "info").catch(() => null);
  }
  await supabase.from("telegram_bots").update({
    health, last_health_at: new Date().toISOString(), last_error: lastError,
    settings: { ...bot.settings, healthFails: fails, healthAlertAt }
  }).eq("org_id", orgId);
  forgetBot(orgId);
  return { ok, info: info.ok ? info.result : null };
}

export function uptimeOf(health: Record<string, { ok: number; total: number }>, days = 7) {
  const from = addDaysToDateKey(lagosDateKey(), -(days - 1));
  let ok = 0; let total = 0;
  for (const [day, value] of Object.entries(health ?? {})) if (day >= from) { ok += value.ok; total += value.total; }
  return total ? Math.round((ok / total) * 1000) / 10 : null;
}

async function connectedBots() {
  const { data, error } = await supabase.from("telegram_bots").select("org_id").eq("status", "connected");
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => String(row.org_id));
}

export async function runBotHealthChecks() {
  for (const orgId of await connectedBots()) {
    await checkBotHealth(orgId).catch((error) => logger.warn("telegram health failed", { orgId, error: String(error?.message ?? error) }));
    await syncCommandMenus(orgId).catch((error) => logger.warn("telegram menu sync failed", { orgId, error: String(error?.message ?? error) }));
  }
}

// ── Job: "5 minutes left" before the 15-minute send-out limit ──────────────

export async function runSendOutSoon(nowMs = Date.now()) {
  let sent = 0;
  for (const orgId of await connectedBots()) {
    try {
      const rules = (await automationsFor(orgId)).filter((row) => row.trigger === "send_out_soon" && row.enabled);
      if (!rules.length) continue;
      const since = new Date(nowMs - 4 * 86_400_000).toISOString();
      const { data, error } = await supabase.from("orders")
        .select(`${ORDER_SELECT}, created_at, original_created_at, assigned_at, revealed_at, review_hold`)
        .eq("org_id", orgId).eq("status", "New").not("assigned_rep_id", "is", null).neq("launch_stage", "silent")
        .or(`created_at.gte.${since},assigned_at.gte.${since},revealed_at.gte.${since}`).limit(1000);
      if (error) throw error;
      const people = await peopleOf(orgId);
      for (const row of (data ?? []) as any[]) {
        if (row.review_hold === true) continue;
        const rep = people.get(String(row.assigned_rep_id));
        if (!rep || rep.role !== "Sales Rep") continue; // only Sales Reps are timed
        const arrived = arrivedAtMs(row);
        if (!Number.isFinite(arrived) || arrived < Date.parse(`${LATE_SEND_FROM}T00:00:00+01:00`)) continue;
        const { startMs, deadlineMs } = lateSendWindow(arrived);
        if (nowMs < startMs || nowMs >= deadlineMs) continue;
        const left = workingMinutesBetween(nowMs, deadlineMs);
        for (const rule of rules) {
          if (left > (rule.settings.minutesBefore ?? 5)) continue;
          const order: OrderInfo = {
            id: String(row.id), customer: row.customer, phone: row.phone, productName: row.product_name, packageName: row.package_name,
            quantity: row.quantity, amount: row.amount, city: row.city, state: row.state, status: row.status, repName: rep.name, callOutcome: null
          };
          sent += await runTrigger(orgId, "send_out_soon", {
            assignedRepId: String(row.assigned_rep_id), orderId: order.id, dedupeBase: `${order.id}:${deadlineMs}`,
            draftFor: (person) => sendOutSoonDraft(order, left, person.role)
          }, rule);
        }
      }
    } catch (error) {
      logger.warn("telegram send-out reminders failed", { orgId, error: String((error as Error)?.message ?? error) });
    }
  }
  return { sent };
}

// ── Job: low stock at a hub ─────────────────────────────────────────────────

/** One spelling per state, so a hub typed "Asaba Delta", "Ibadan" or "Kwara State" meets its state's orders. */
const stateKey = (value: unknown) => String(tidyOrderState(String(value ?? "")) ?? "").trim().toLowerCase();

export async function lowStockItems(orgId: string, threshold: number, onlySelling = true): Promise<Array<LowStockItem & { key: string; branchId: string | null }>> {
  const [agentsRes, productsRes] = await Promise.all([
    supabase.from("agents").select("id, name, status").eq("org_id", orgId).eq("status", "Active"),
    supabase.from("products").select("id, name, active").eq("org_id", orgId)
  ]);
  if (agentsRes.error) throw agentsRes.error;
  if (productsRes.error) throw productsRes.error;
  const agentName = new Map(((agentsRes.data ?? []) as any[]).map((row) => [String(row.id), String(row.name ?? "Agent")]));
  const productName = new Map(((productsRes.data ?? []) as any[]).filter((row) => row.active !== false).map((row) => [String(row.id), String(row.name ?? "Product")]));
  if (!agentName.size) return [];
  const { data: locations, error } = await supabase.from("agent_locations")
    .select("id, agent_id, name, state, active, branch_id, stock:agent_location_stock(product_id, quantity, defective, missing)")
    .in("agent_id", [...agentName.keys()]).eq("active", true);
  if (error) throw error;
  // Only what a hub has been selling: a product it never carries is not "low".
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  // launch-safe: only product + state, to know what a hub sells; no order is shown.
  const { data: recent, error: recentError } = await supabase.from("orders").select("product_id, state")
    .eq("org_id", orgId).gte("created_at", since).limit(20000);
  if (recentError) throw recentError;
  const sold = new Set(((recent ?? []) as any[]).map((row) => `${row.product_id}::${stateKey(row.state)}`));
  const out: Array<LowStockItem & { key: string; branchId: string | null }> = [];
  for (const location of (locations ?? []) as any[]) {
    const state = String(tidyOrderState(String(location.state ?? "")) ?? "").trim();
    for (const stock of location.stock ?? []) {
      const name = productName.get(String(stock.product_id));
      if (!name || (onlySelling && !sold.has(`${stock.product_id}::${stateKey(location.state)}`))) continue;
      const usable = Math.max(0, Number(stock.quantity ?? 0) - Number(stock.defective ?? 0) - Number(stock.missing ?? 0));
      if (usable > threshold) continue;
      out.push({ key: `${location.id}:${stock.product_id}`, productName: name, hubName: `${agentName.get(String(location.agent_id))}${location.name ? ` (${location.name})` : ""}`, state, usable, branchId: location.branch_id ? String(location.branch_id) : null });
    }
  }
  return out.sort((a, b) => a.usable - b.usable);
}

export async function runLowStock() {
  let sent = 0;
  for (const orgId of await connectedBots()) {
    try {
      const rules = (await automationsFor(orgId)).filter((row) => row.trigger === "low_stock" && row.enabled);
      if (!rules.length) continue;
      const bot = await getBot(orgId, true);
      if (!bot) continue;
      const today = lagosDateKey();
      const seen = { ...(bot.settings.lowStock ?? {}) };
      const maxThreshold = Math.max(...rules.map((rule) => rule.settings.threshold ?? 5));
      const items = await lowStockItems(orgId, maxThreshold);
      const lowKeys = new Set(items.map((item) => item.key));
      // Back above the limit: the next drop is news again.
      for (const key of Object.keys(seen)) if (!lowKeys.has(key)) delete seen[key];
      // News = not told yet, dropped further, or told 3+ days ago.
      const fresh = items.filter((item) => {
        const before = seen[item.key];
        return !before || item.usable < before.u || before.d <= addDaysToDateKey(today, -3);
      });
      let toldSomeone = 0;
      for (const rule of rules) {
        const threshold = rule.settings.threshold ?? 5;
        const forRule = fresh.filter((item) => item.usable <= threshold);
        if (!forRule.length) continue;
        toldSomeone += await runTrigger(orgId, "low_stock", {
          dedupeBase: `${rule.id}:${today}:${forRule.map((item) => `${item.key}=${item.usable}`).join(",")}`.slice(0, 400),
          // Each person only hears about hubs in the branches they work in.
          draftFor: async (person) => {
            const branches = await branchIdsFor(orgId, person);
            const mine = branches === null ? forRule : forRule.filter((item) => !item.branchId || branches.includes(item.branchId));
            if (!mine.length) return null;
            return mine.length === 1 ? lowStockDraft(mine[0], threshold) : {
              title: `Low stock: ${mine.length} items at or below ${threshold}`,
              text: [`📦 <b>LOW STOCK · ${mine.length} items</b>`, ...mine.slice(0, 15).map((item) => `• ${tgEscape(item.productName)} – ${tgEscape(item.state)}, ${tgEscape(item.hubName)}: <b>${item.usable}</b> left`), ...(mine.length > 15 ? [`…and ${mine.length - 15} more`] : [])].join("\n"),
              keyboard: [[{ text: "📋 Open Inventory", path: "/dashboard/admin/inventory" }]]
            };
          }
        }, rule);
      }
      sent += toldSomeone;
      // Nobody linked yet: keep it news, so whoever links later is still told.
      if (toldSomeone) for (const item of fresh) seen[item.key] = { u: item.usable, d: today };
      await supabase.from("telegram_bots").update({ settings: { ...bot.settings, lowStock: seen } }).eq("org_id", orgId);
      forgetBot(orgId);
    } catch (error) {
      logger.warn("telegram low stock failed", { orgId, error: String((error as Error)?.message ?? error) });
    }
  }
  return { sent };
}

// ── Job: daily and weekly business reports ─────────────────────────────────

const dayStartIso = (day: string) => new Date(`${day}T00:00:00+01:00`).toISOString();
const dayEndIso = (day: string) => new Date(`${day}T23:59:59.999+01:00`).toISOString();
const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

const NO_BRANCH = "00000000-0000-0000-0000-000000000000";

/** Business figures for [from, to]; branchIds null = every branch (the Owner), else only those branches. */
export async function businessReport(orgId: string, from: string, to: string, branchIds: string[] | null = null): Promise<BusinessReport> {
  // (any: the query builder's types are too deep to pass through a helper.)
  const scope = (query: any): any => branchIds === null ? query : query.in("branch_id", branchIds.length ? branchIds : [NO_BRANCH]);
  const [placed, delivered, statusChanges, sentOut, stillNew, meta, tiktok] = await Promise.all([
    scope(supabase.from("orders").select("id, product_name, review_hold, launch_stage").eq("org_id", orgId).gte("created_at", dayStartIso(from)).lte("created_at", dayEndIso(to))).limit(20000),
    scope(supabase.from("orders").select("id, amount").eq("org_id", orgId).eq("status", "Delivered").gte("delivered_date", from).lte("delivered_date", to).neq("launch_stage", "silent")).limit(20000),
    scope(supabase.from("order_audit").select("order_id, to_status").eq("org_id", orgId).in("to_status", ["Failed", "Cancelled"]).gte("created_at", dayStartIso(from)).lte("created_at", dayEndIso(to))).limit(20000),
    scope(supabase.from("orders").select("id, created_at, original_created_at, assigned_at, revealed_at, sent_out_at, assigned_rep_id").eq("org_id", orgId).gte("sent_out_at", dayStartIso(from)).lte("sent_out_at", dayEndIso(to)).not("assigned_rep_id", "is", null)).limit(20000),
    scope(supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "New").neq("launch_stage", "silent").or("review_hold.is.null,review_hold.eq.false")),
    scope(supabase.from("tracking_meta_ad_insights").select("spend").eq("org_id", orgId).gte("day", from).lte("day", to)).limit(50000),
    scope(supabase.from("tracking_tiktok_ad_insights").select("spend").eq("org_id", orgId).gte("day", from).lte("day", to)).limit(50000)
  ]);
  for (const result of [placed, delivered, statusChanges, sentOut, stillNew]) if (result.error) throw result.error;
  const people = await peopleOf(orgId);
  const placedRows = ((placed.data ?? []) as any[]).filter((row) => row.review_hold !== true && row.launch_stage !== "silent");
  const byProduct = new Map<string, number>();
  for (const row of placedRows) byProduct.set(String(row.product_name ?? "Other"), (byProduct.get(String(row.product_name ?? "Other")) ?? 0) + 1);
  const changes = (statusChanges.data ?? []) as any[];
  const distinct = (status: string) => new Set(changes.filter((row) => row.to_status === status).map((row) => String(row.order_id))).size;
  const late = ((sentOut.data ?? []) as any[]).filter((row) => {
    if (people.get(String(row.assigned_rep_id))?.role !== "Sales Rep") return false;
    const arrived = arrivedAtMs(row);
    if (!Number.isFinite(arrived) || arrived < Date.parse(`${LATE_SEND_FROM}T00:00:00+01:00`)) return false;
    return Date.parse(row.sent_out_at) > lateSendWindow(arrived).deadlineMs;
  }).length;
  const spendRows = [...((meta.error ? [] : meta.data) ?? []), ...((tiktok.error ? [] : tiktok.data) ?? [])] as any[];
  return {
    label: from === to ? shortDay(from) : `${shortDay(from)} – ${shortDay(to)}`,
    ordersIn: placedRows.length,
    topProducts: [...byProduct.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, orders]) => ({ name, orders })),
    delivered: (delivered.data ?? []).length,
    deliveredRevenue: ((delivered.data ?? []) as any[]).reduce((sum, row) => sum + (Number(row.amount) || 0), 0),
    failed: distinct("Failed"),
    cancelled: distinct("Cancelled"),
    stillNew: stillNew.count ?? 0,
    lateSendOuts: late,
    adSpend: spendRows.length ? spendRows.reduce((sum, row) => sum + (Number(row.spend) || 0), 0) : null
  };
}

const reportRange = (kind: "daily_report" | "weekly_report" | "weekly_rep_note") => {
  const today = lagosDateKey();
  const from = kind === "daily_report" ? addDaysToDateKey(today, -1) : addDaysToDateKey(sundayWeekStartForDateKey(today), -7);
  return { from, to: kind === "daily_report" ? from : addDaysToDateKey(from, 6) };
};

export async function sendReport(orgId: string, rule: AutomationRow, kind: "daily_report" | "weekly_report", force = false) {
  const { from, to } = reportRange(kind);
  // One report per branch set: the Owner sees every branch, others their own.
  const reports = new Map<string, Promise<BusinessReport>>();
  return runTrigger(orgId, kind, {
    dedupeBase: force ? null : `${rule.id}:${from}`,
    draftFor: async (person) => {
      if (!LEADERSHIP_ROLES.includes(person.role)) return null;
      const branches = await branchIdsFor(orgId, person);
      const key = branches === null ? "all" : [...branches].sort().join(",");
      if (!reports.has(key)) reports.set(key, businessReport(orgId, from, to, branches));
      return reportDraft(kind, await reports.get(key)!, person.role);
    }
  }, rule);
}

/** Monday's note to each sales rep: their own late send-outs and fines last week. */
export async function sendRepWeekNotes(orgId: string, rule: AutomationRow, force = false) {
  const { from, to } = reportRange("weekly_rep_note");
  const { lateSendsFor } = await import("./late-send.js");
  const late = await lateSendsFor(orgId, from).catch(() => ({} as Awaited<ReturnType<typeof lateSendsFor>>));
  const { data: fines, error } = await supabase.from("rep_penalties").select("rep_id, amount, reason, week_start, created_at")
    .eq("org_id", orgId).or(`week_start.eq.${from},and(week_start.is.null,created_at.gte.${dayStartIso(from)},created_at.lte.${dayEndIso(to)})`).limit(5000);
  if (error) throw error;
  const label = `${shortDay(from)} – ${shortDay(to)}`;
  return runTrigger(orgId, "weekly_rep_note", {
    dedupeBase: force ? null : `${rule.id}:${from}`,
    draftFor: (person) => {
      if (person.role !== "Sales Rep") return null;
      const mine = late[person.userId]?.orders ?? [];
      return repWeekNoteDraft({
        label,
        lateSendOuts: mine.length,
        lateExamples: [...mine].sort((a, b) => b.minutesLate - a.minutesLate).map((row) => ({ orderId: row.orderId, minutesLate: row.minutesLate })),
        fines: ((fines ?? []) as any[]).filter((row) => String(row.rep_id) === person.userId).map((row) => ({ amount: Number(row.amount) || 0, reason: String(row.reason ?? "") }))
      });
    }
  }, rule);
}

export async function runReports(nowMs = Date.now()) {
  const lagos = new Date(nowMs + 60 * 60_000);
  const hour = lagos.getUTCHours();
  const weekday = lagos.getUTCDay();
  let sent = 0;
  for (const orgId of await connectedBots()) {
    try {
      for (const rule of (await automationsFor(orgId)).filter((row) => row.enabled && (row.trigger === "daily_report" || row.trigger === "weekly_report" || row.trigger === "weekly_rep_note"))) {
        if ((rule.settings.hour ?? 9) !== hour) continue;
        if (rule.trigger !== "daily_report" && (rule.settings.weekday ?? 1) !== weekday) continue;
        sent += rule.trigger === "weekly_rep_note"
          ? await sendRepWeekNotes(orgId, rule)
          : await sendReport(orgId, rule, rule.trigger as "daily_report" | "weekly_report");
      }
    } catch (error) {
      logger.warn("telegram reports failed", { orgId, error: String((error as Error)?.message ?? error) });
    }
  }
  return { sent };
}

// ── Waybill Follow-Up Center (Bright, 7 Nov 2026) ───────────────────────────

/** Ten minutes before a session: to whoever the "Waybill Follow-Up Due" automation names (once per session). */
export async function telegramWaybillReminder(orgId: string, input: {
  dateKey: string; sessionKey: string; label: string; timeLabel: string; openMs: number; closeMs: number; waybills: WaybillLine[]; amount: number; charged: boolean;
}) {
  return runTrigger(orgId, "waybill_follow_up_due", {
    dedupeBase: `${input.dateKey}:${input.sessionKey}`,
    draftFor: () => waybillDueDraft({
      label: input.label, timeLabel: input.timeLabel, opens: lagosClock(input.openMs), closes: lagosClock(input.closeMs),
      waybills: input.waybills, amount: input.amount, charged: input.charged
    })
  });
}

/** A session closed with waybills not followed up: who missed, and the charge. */
export async function telegramWaybillMissed(orgId: string, input: {
  dateKey: string; sessionKey: string; timeLabel: string; dayLabel: string; waybills: WaybillLine[]; amount: number; charged: boolean;
  responsibleUserId: string | null; responsibleName: string | null;
}) {
  return runTrigger(orgId, "waybill_follow_up_missed", {
    dedupeBase: `${input.dateKey}:${input.sessionKey}`,
    draftFor: (person) => waybillMissedDraft({
      timeLabel: input.timeLabel, dayLabel: input.dayLabel, waybills: input.waybills, amount: input.amount, charged: input.charged,
      responsibleName: input.responsibleName, forResponsible: person.userId === input.responsibleUserId
    })
  });
}

// ── Announcements and samples ───────────────────────────────────────────────

export async function sendToPeople(orgId: string, userIds: string[], trigger: string, draft: Draft, batchId: string | null = null) {
  const bot = await getBot(orgId, true);
  if (!bot) throw new Error("Connect the bot first.");
  const links = await linksFor(orgId, true);
  const people = await peopleOf(orgId);
  let sent = 0; let failed = 0; let notLinked = 0;
  for (const userId of userIds) {
    const link = links.get(userId);
    const person = people.get(userId);
    if (!link || !person) { notLinked += 1; continue; }
    const outcome = await sendLogged({ orgId, bot, trigger, person, chatId: link.chat_id, draft, batchId });
    if (outcome === "sent") sent += 1; else if (outcome === "failed") failed += 1;
  }
  return { sent, failed, notLinked };
}

export const newBatchId = () => randomUUID();

/** A sample of what an automation sends, built from a recent real order where it needs one. */
export async function sampleDraft(orgId: string, trigger: TriggerKey, role: string): Promise<Draft> {
  if (trigger === "daily_report" || trigger === "weekly_report") {
    const today = lagosDateKey();
    const from = trigger === "daily_report" ? addDaysToDateKey(today, -1) : addDaysToDateKey(sundayWeekStartForDateKey(today), -7);
    const report = await businessReport(orgId, from, trigger === "daily_report" ? from : addDaysToDateKey(from, 6));
    return reportDraft(trigger, report, role);
  }
  if (trigger === "low_stock") {
    const items = await lowStockItems(orgId, 5);
    return lowStockDraft(items[0] ?? { productName: "Edge Brusher Max", hubName: "Sample hub", state: "Lagos", usable: 3 }, 5);
  }
  if (trigger === "weekly_rep_note") {
    const { from, to } = reportRange("weekly_rep_note");
    return repWeekNoteDraft({ label: `${shortDay(from)} – ${shortDay(to)} (sample)`, lateSendOuts: 2, lateExamples: [{ orderId: "SAMPLE-1", minutesLate: 12 }, { orderId: "SAMPLE-2", minutesLate: 4 }], fines: [{ amount: 500, reason: "Order not sent out in 15 min (sample)" }] });
  }
  if (trigger === "cart_assigned") {
    const { data: cart } = await supabase.from("abandoned_carts").select("id, customer, product_name, package_name, amount, city, state").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const row = cart as any;
    return cartDraft({ id: row?.id ?? "SAMPLE", customer: row?.customer ?? "Sample Customer", productName: row?.product_name ?? "5-in-1 Corner Racks", packageName: row?.package_name ?? null, amount: row?.amount ?? 39_500, city: row?.city ?? "Ikeja", state: row?.state ?? "Lagos", repName: "Sample Rep" }, role);
  }
  const { data } = await supabase.from("orders").select("id").eq("org_id", orgId).neq("launch_stage", "silent").order("created_at", { ascending: false }).limit(1);
  const order = data?.[0] ? await orderInfo(orgId, String((data[0] as any).id)) : null;
  const info: OrderInfo = order ?? { id: "SAMPLE", customer: "Sample Customer", phone: null, productName: "5-in-1 Corner Racks", packageName: null, quantity: 1, amount: 39_500, city: "Ikeja", state: "Lagos", status: "New", repName: "Sample Rep", callOutcome: null };
  if (trigger === "send_out_soon") return sendOutSoonDraft(info, 5, role);
  if (trigger === "follow_up_due") return followUpDraft(info.id, `Follow-up Due #${info.id}`, [info.customer, info.productName].filter(Boolean).join(" · "), role);
  return orderDraft(trigger, info, role);
}

// ── The bot answering people (webhook) ──────────────────────────────────────

async function reply(orgId: string, bot: BotRow, chatId: number, text: string, person?: Person, keyboard?: Draft["keyboard"], title = "Bot reply") {
  const draft: Draft = { title, text, keyboard: keyboard ?? [] };
  if (person) {
    await sendLogged({ orgId, bot, trigger: "command", person, chatId: String(chatId), draft }).catch(() => null);
    return;
  }
  await tgSendMessage(bot.token, chatId, text, buildKeyboard(draft.keyboard, appBase()));
}

const CONNECT_HINT = "To get your Protohub alerts here, open Protohub → Notifications → <b>Connect Telegram</b>, then tap Start.";

async function linkFromCode(orgId: string, bot: BotRow, code: string, chatId: number, from: { username?: string; first_name?: string; last_name?: string } | undefined) {
  const { data, error } = await supabase.from("telegram_link_codes").select("*").eq("code", code).eq("org_id", orgId).maybeSingle();
  if (error) throw error;
  const row = data as any;
  if (!row || row.used_at || Date.parse(row.expires_at) < Date.now()) {
    await reply(orgId, bot, chatId, `This connect link has expired or was already used. ${CONNECT_HINT}`);
    return;
  }
  const person = (await peopleOf(orgId)).get(String(row.user_id));
  if (!person) { await reply(orgId, bot, chatId, "This Protohub account is no longer active."); return; }
  // Claim the code first: two taps on the same link cannot both connect.
  const { data: claimed } = await supabase.from("telegram_link_codes").update({ used_at: new Date().toISOString() }).eq("code", code).is("used_at", null).select("code");
  if (!claimed?.length) { await reply(orgId, bot, chatId, `This connect link was already used. ${CONNECT_HINT}`); return; }
  // One chat, one person: the same phone linked to someone else moves here.
  await supabase.from("telegram_links").delete().eq("org_id", orgId).eq("chat_id", String(chatId)).neq("user_id", person.userId);
  const upsert = await supabase.from("telegram_links").upsert({
    user_id: person.userId, org_id: orgId, chat_id: String(chatId), bot_id: bot.bot_id,
    telegram_username: from?.username ?? null, telegram_name: [from?.first_name, from?.last_name].filter(Boolean).join(" ") || null,
    linked_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (upsert.error) throw upsert.error;
  linkCache.delete(orgId);
  // Their own "/" menu straight away (the 15-minute sync then records it).
  await tgSetCommands(bot.token, menuOf(commandsFor(person.role, cleanCommandSettings(bot.settings.commands))), chatId);
  await reply(orgId, bot, chatId, `✅ <b>Connected.</b> Hi ${tgEscape(person.name)}, your Protohub alerts will come here.\nType /help to see what you can ask me.`, person, undefined, `${person.name} connected Telegram`);
  // Tell the Owner who is behind this chat: a link sent to the wrong person shows at once.
  if (person.role !== "Owner") {
    const who = [from?.first_name, from?.last_name].filter(Boolean).join(" ") || "no name";
    await noticeOwners(orgId, `${person.name} connected Telegram`, `${person.name} (${person.role}) now gets Protohub alerts on the Telegram account "${who}"${from?.username ? ` (@${from.username})` : ""}. If that is not them, disconnect it in Telegram Bot → Staff & Recipients.`, "info").catch(() => null);
  }
}

function lagosToday() { return lagosDateKey(); }

/** A sales rep's own day so far, and their bonus this week as the Bonuses screen shows it. */
async function repDay(orgId: string, repId: string, withBonus = true): Promise<RepDay> {
  const today = lagosToday();
  const start = dayStartIso(today);
  const end = dayEndIso(today);
  const [given, sent, delivered, stillNew] = await Promise.all([
    supabase.from("orders").select("id, review_hold").eq("org_id", orgId).eq("assigned_rep_id", repId).neq("launch_stage", "silent").gte("created_at", start).lte("created_at", end).limit(2000),
    supabase.from("orders").select("id, created_at, original_created_at, assigned_at, revealed_at, sent_out_at").eq("org_id", orgId).eq("assigned_rep_id", repId).neq("launch_stage", "silent").gte("sent_out_at", start).lte("sent_out_at", end).limit(2000),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("assigned_rep_id", repId).eq("status", "Delivered").eq("delivered_date", today).neq("launch_stage", "silent"),
    supabase.from("orders").select("id, created_at, original_created_at, assigned_at, revealed_at, review_hold").eq("org_id", orgId).eq("assigned_rep_id", repId).eq("status", "New").neq("launch_stage", "silent").limit(2000)
  ]);
  for (const result of [given, sent, delivered, stillNew]) if (result.error) throw result.error;
  const deadlineOf = (row: any) => {
    const arrived = arrivedAtMs(row);
    if (!Number.isFinite(arrived) || arrived < Date.parse(`${LATE_SEND_FROM}T00:00:00+01:00`)) return null;
    return lateSendWindow(arrived).deadlineMs;
  };
  const sentRows = (sent.data ?? []) as any[];
  const newRows = ((stillNew.data ?? []) as any[]).filter((row) => row.review_hold !== true);
  let bonus: RepDay["bonus"] = withBonus ? null : undefined;
  if (withBonus) try {
    // Same source as the rep's Bonuses screen ("Bonus earned", /api/bonus-coach/me).
    const [{ getRepBonusCoach }, { currentSalesBonusWeekStart }] = await Promise.all([import("./bonus-coach.js"), import("./sales-bonus-engine.js")]);
    const coach = await getRepBonusCoach(orgId, repId, currentSalesBonusWeekStart());
    bonus = { earned: coach.snapshot.currentBonusEarned, deliveredCount: coach.snapshot.deliveredCount };
  } catch (error) {
    logger.warn("telegram /today bonus failed", { orgId, error: String((error as Error)?.message ?? error) });
  }
  return {
    label: new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }),
    ordersIn: ((given.data ?? []) as any[]).filter((row) => row.review_hold !== true).length,
    sentOut: sentRows.length,
    sentLate: sentRows.filter((row) => { const deadline = deadlineOf(row); return deadline != null && Date.parse(row.sent_out_at) > deadline; }).length,
    delivered: delivered.count ?? 0,
    stillNew: newRows.length,
    lateNow: newRows.filter((row) => { const deadline = deadlineOf(row); return deadline != null && Date.now() > deadline; }).length,
    bonus
  };
}

async function commandAnswer(orgId: string, bot: BotRow, person: Person, command: CommandKey, args: string): Promise<{ text: string; keyboard?: Draft["keyboard"] }> {
  const enabled = cleanCommandSettings(bot.settings.commands);
  if (!enabled[command]) return { text: "That command is switched off." };
  if (!commandAllowed(person.role, command)) return { text: commandDeniedText(command) };
  const leadership = ["Owner", "Admin", "Manager"].includes(person.role);
  const repRole = ["Sales Rep", "Recovery Rep", "Sales Closer"].includes(person.role);
  // Leadership other than the Owner only sees the branches they work in.
  const branches = await branchIdsFor(orgId, person);
  const inMyBranches = (query: any): any => branches === null || !leadership ? query : query.in("branch_id", branches.length ? branches : [NO_BRANCH]);
  if (command === "help") {
    // Only what this person can use.
    return { text: ["<b>What you can ask me</b>", ...commandsFor(person.role, enabled).map((row) => `/${row.key} – ${tgEscape(row.description)}`)].join("\n") };
  }
  // This week, last week, side by side, reps, upsells, products, trends; fines (Bright, 6 Nov 2026).
  const insight = await insightAnswer({
    orgId, person, branches, people: await peopleOf(orgId), memberships: await branchesOf(orgId), businessReport
  }, command, args);
  if (insight) return insight;
  if (command === "stop") {
    await unlinkUser(orgId, person.userId);
    return { text: "Stopped. Protohub will not message this chat. Connect again any time from Protohub → Notifications." };
  }
  if (command === "myorders") {
    if (!leadership && !repRole) return { text: "This is for sales staff." };
    let query = inMyBranches(supabase.from("orders").select("id, customer, product_name, assigned_rep_id, review_hold").eq("org_id", orgId).eq("status", "New").neq("launch_stage", "silent")).order("created_at", { ascending: false }).limit(200);
    if (!leadership) query = query.eq("assigned_rep_id", person.userId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as any[];
    const end = new Date(`${lagosToday()}T23:59:59+01:00`).toISOString();
    let follow = inMyBranches(supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).lte("next_follow_up_at", end).not("status", "in", "(Delivered,Cancelled)").neq("launch_stage", "silent"));
    if (!leadership) follow = follow.eq("assigned_rep_id", person.userId);
    const followUps = await follow;
    const text = myOrdersDraft({
      leadership,
      role: person.role,
      orders: rows.filter((row) => row.review_hold !== true).map((row) => ({ id: String(row.id), product: row.product_name ?? null, customer: row.customer ?? null })),
      held: rows.filter((row) => row.review_hold === true).map((row) => String(row.id)),
      followUps: followUps.count ?? 0
    });
    return { text, keyboard: [[{ text: "Open Orders", path: person.role === "Sales Rep" ? "/dashboard/sales-rep" : "/dashboard/admin/orders" }]] };
  }
  if (command === "today") {
    // Bright, 6 Nov 2026: revenue is strictly for the Owner, Admins and
    // Managers; a sales rep sees their own day and their own bonus instead.
    if (person.role === "Sales Rep") return { text: repTodayDraft(await repDay(orgId, person.userId)), keyboard: [[{ text: "Open my Bonuses", path: "/dashboard/sales-rep" }]] };
    // Recovery Reps and Sales Closers: their own day (their pay is not the sales bonus).
    if (person.role === "Recovery Rep" || person.role === "Sales Closer") return { text: repTodayDraft(await repDay(orgId, person.userId, false)) };
    if (!leadership) return { text: "Today's numbers are for leadership and sales staff." };
    const report = await businessReport(orgId, lagosToday(), lagosToday(), branches);
    const revenue = seesRevenue(person.role);
    return { text: [
      `<b>Today so far · ${tgEscape(report.label)}</b>`,
      `Orders in: <b>${report.ordersIn}</b>`,
      `Delivered: <b>${report.delivered}</b>${revenue ? ` · ${naira(report.deliveredRevenue)}` : ""}`,
      `Failed: ${report.failed} · Cancelled: ${report.cancelled}`,
      `Sent out late: ${report.lateSendOuts} · Still New: ${report.stillNew}`
    ].join("\n") };
  }
  if (command === "late") {
    if (!leadership && person.role !== "Sales Rep") return { text: "This is for leadership and sales reps." };
    // Today's late send-outs AND what is still late in New right now: the
    // same orders the fine counts (Sales Reps only, from the order's arrival).
    const today = lagosToday();
    const columns = "id, product_name, assigned_rep_id, created_at, original_created_at, assigned_at, revealed_at, sent_out_at, review_hold";
    let sentQuery = inMyBranches(supabase.from("orders").select(columns).eq("org_id", orgId).not("assigned_rep_id", "is", null).neq("launch_stage", "silent")
      .gte("sent_out_at", dayStartIso(today)).lte("sent_out_at", dayEndIso(today))).limit(2000);
    let newQuery = inMyBranches(supabase.from("orders").select(columns).eq("org_id", orgId).eq("status", "New").not("assigned_rep_id", "is", null).neq("launch_stage", "silent")).limit(500);
    if (!leadership) { sentQuery = sentQuery.eq("assigned_rep_id", person.userId); newQuery = newQuery.eq("assigned_rep_id", person.userId); }
    const [sent, waiting] = await Promise.all([sentQuery, newQuery]);
    if (sent.error) throw sent.error;
    if (waiting.error) throw waiting.error;
    const now = Date.now();
    const people = await peopleOf(orgId);
    const timed = (row: any) => {
      if (people.get(String(row.assigned_rep_id))?.role !== "Sales Rep") return null; // only Sales Reps are timed
      const arrived = arrivedAtMs(row);
      if (!Number.isFinite(arrived) || arrived < Date.parse(`${LATE_SEND_FROM}T00:00:00+01:00`)) return null;
      return lateSendWindow(arrived);
    };
    const repName = (row: any) => leadership ? people.get(String(row.assigned_rep_id))?.name ?? null : null;
    const sentLate = ((sent.data ?? []) as any[]).flatMap((row) => {
      const window = timed(row);
      const sentMs = Date.parse(row.sent_out_at);
      if (!window || !(sentMs > window.deadlineMs)) return [];
      return [{ orderId: String(row.id), product: row.product_name ?? null, repName: repName(row), limitMs: window.deadlineMs, sentMs, took: workingMinutesBetween(window.startMs, sentMs) }];
    });
    const stillNew = ((waiting.data ?? []) as any[]).filter((row) => row.review_hold !== true).flatMap((row) => {
      const window = timed(row);
      if (!window || !(now > window.deadlineMs)) return [];
      return [{ orderId: String(row.id), product: row.product_name ?? null, repName: repName(row), limitMs: window.deadlineMs, waited: workingMinutesBetween(window.startMs, now) }];
    });
    const label = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    return { text: lateTodayDraft({ label, sentLate, stillNew }) };
  }
  if (command === "stock") {
    if (!leadership && !["Inventory Manager", "Inventory Manager & Logistics Operations"].includes(person.role)) return { text: "Stock is for leadership and inventory staff." };
    const q = args.trim().toLowerCase();
    if (!q) return { text: "Type part of a product name, e.g. /stock edge" };
    const items = (await lowStockItems(orgId, 1_000_000, false)).filter((item) => item.productName.toLowerCase().includes(q) && (branches === null || !item.branchId || branches.includes(item.branchId)));
    if (!items.length) return { text: `No hub stock found for "${tgEscape(q)}".` };
    return { text: [`<b>Usable stock: ${tgEscape(items[0].productName)}</b>`, ...items.slice(0, 20).map((item) => `• ${tgEscape(item.state)} – ${tgEscape(item.hubName)}: <b>${item.usable}</b>`)].join("\n") };
  }
  return { text: "I did not understand that. Type /help." };
}

async function personForChat(orgId: string, chatId: number): Promise<Person | null> {
  const links = await linksFor(orgId, true);
  const link = [...links.values()].find((row) => row.chat_id === String(chatId));
  if (!link) return null;
  return (await peopleOf(orgId)).get(link.user_id) ?? null;
}

export async function handleUpdate(orgId: string, update: TgUpdate) {
  const bot = await getBot(orgId);
  if (!bot) return;
  await supabase.from("telegram_bots").update({ last_update_at: new Date().toISOString() }).eq("org_id", orgId);
  const message = update.message;
  if (message?.text && message.chat.type === "private") {
    const [rawCommand, ...rest] = message.text.trim().split(/\s+/);
    const command = rawCommand.startsWith("/") ? rawCommand.slice(1).split("@")[0].toLowerCase() : "";
    const args = rest.join(" ");
    if (command === "start") {
      if (args) { await linkFromCode(orgId, bot, args, message.chat.id, message.from); return; }
      const person = await personForChat(orgId, message.chat.id);
      await reply(orgId, bot, message.chat.id, person ? `You are connected as <b>${tgEscape(person.name)}</b>. Type /help.` : CONNECT_HINT, person ?? undefined);
      return;
    }
    const person = await personForChat(orgId, message.chat.id);
    if (!person) { await reply(orgId, bot, message.chat.id, CONNECT_HINT); return; }
    if (!command || !COMMANDS.some((row) => row.key === command)) {
      await reply(orgId, bot, message.chat.id, "I send your Protohub alerts here. Type /help to see what you can ask me.", person);
      return;
    }
    const answer = await commandAnswer(orgId, bot, person, command as CommandKey, args);
    if (command === "stop") { await tgSendMessage(bot.token, message.chat.id, answer.text); return; }
    await reply(orgId, bot, message.chat.id, answer.text, person, answer.keyboard, `Replied to /${command}`);
    return;
  }
  const callback = update.callback_query;
  if (callback?.data && callback.message) {
    const person = await personForChat(orgId, callback.message.chat.id);
    const [action, orderId] = callback.data.split(":");
    if (!person) { await tgAnswerCallback(bot.token, callback.id, "Connect your Protohub account first."); return; }
    if (action === "call" && orderId) {
      // launch-safe: a Silent Test order is the Owner's alone; anyone else gets .neq below.
      let lookup = supabase.from("orders").select("id, customer, phone, assigned_rep_id").eq("org_id", orgId).eq("id", orderId);
      if (person.role !== "Owner") lookup = lookup.neq("launch_stage", "silent");
      const { data } = await lookup.maybeSingle();
      const order = data as any;
      const allowed = order && seesCustomer(person.role) && (!["Sales Rep", "Recovery Rep", "Sales Closer"].includes(person.role) || String(order.assigned_rep_id) === person.userId);
      if (!allowed || !order.phone) { await tgAnswerCallback(bot.token, callback.id, "You cannot see this customer's number."); return; }
      await tgAnswerCallback(bot.token, callback.id);
      await reply(orgId, bot, callback.message.chat.id, `📞 <b>${tgEscape(order.customer ?? "Customer")}</b> (#${tgEscape(order.id)})\nTap to call: ${tgEscape(order.phone)}`, person, undefined, `Customer number sent #${order.id}`);
      return;
    }
    if (action === "callcart" && orderId) {
      const { data } = await supabase.from("abandoned_carts").select("id, customer, phone, assigned_rep_id").eq("org_id", orgId).eq("id", orderId).maybeSingle();
      const cart = data as any;
      const allowed = cart && seesCustomer(person.role) && (!["Sales Rep", "Recovery Rep", "Sales Closer"].includes(person.role) || String(cart.assigned_rep_id) === person.userId);
      if (!allowed || !cart.phone) { await tgAnswerCallback(bot.token, callback.id, "You cannot see this customer's number."); return; }
      await tgAnswerCallback(bot.token, callback.id);
      await reply(orgId, bot, callback.message.chat.id, `📞 <b>${tgEscape(cart.customer ?? "Customer")}</b> (cart)\nTap to call: ${tgEscape(cart.phone)}`, person, undefined, "Cart customer number sent");
      return;
    }
    await tgAnswerCallback(bot.token, callback.id);
  }
}

export { FORWARD_GROUPS };
