// ── Telegram Automation Center: sending, staff links, bot replies, jobs ─────
// (Bright, 6 Nov 2026.) Rules and wording: telegram-rules.ts. Bot API calls:
// telegram-api.ts. Every message is logged in telegram_messages; a dedupe key
// there (unique per person) stops a reminder going out twice.

import { randomBytes, randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { resolvePublicApiBaseUrl } from "./push-branding.js";
import { arrivedAtMs } from "./late-send.js";
import { LATE_SEND_FROM, lateSendWindow, workingMinutesBetween } from "./late-send-rules.js";
import { addDaysToDateKey, lagosDateKey, sundayWeekStartForDateKey } from "./sales-bonus-engine.js";
import {
  tgAnswerCallback, tgDeleteWebhook, tgEscape, tgGetMe, tgSendMessage, tgSetCommands, tgSetWebhook, tgWebhookInfo,
  type TgUpdate
} from "./telegram-api.js";
import {
  COMMANDS, DEFAULT_AUTOMATIONS, FORWARD_GROUPS, TRIGGERS, buildKeyboard, cleanCommandSettings, cleanRecipients, cleanSettings,
  followUpDraft, forwardedDraft, kindForwarded, lowStockDraft, naira, orderDraft, previewOf, reportDraft, seesBusinessMoney, seesCustomer,
  sendOutSoonDraft, type AutomationSettings, type BusinessReport, type CommandKey, type Draft, type LowStockItem, type OrderInfo,
  type Recipients, type TriggerKey
} from "./telegram-rules.js";

// ── Bot row ─────────────────────────────────────────────────────────────────

export type BotSettings = {
  commands?: Partial<Record<CommandKey, boolean>>;
  /** FORWARD_GROUPS keys switched on. */
  forward?: string[];
  /** Low-stock items already announced: key -> usable count and Lagos day. */
  lowStock?: Record<string, { u: number; d: string }>;
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
  const { error } = await supabase.from("telegram_links").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) throw error;
  linkCache.delete(orgId);
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
  if (missing.length) {
    const insert = await supabase.from("telegram_automations").insert(missing.map((row) => ({
      org_id: orgId, trigger: row.trigger, name: row.name, enabled: row.enabled, recipients: row.recipients, settings: row.settings, built_in: true
    })));
    if (insert.error) throw insert.error;
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

async function recipientsOf(orgId: string, recipients: Recipients, assignedRepId: string | null): Promise<Person[]> {
  const people = await peopleOf(orgId);
  const out = new Map<string, Person>();
  for (const person of people.values()) if (recipients.roles.includes(person.role)) out.set(person.userId, person);
  for (const id of recipients.userIds) { const person = people.get(id); if (person) out.set(id, person); }
  if (recipients.assignedRep && assignedRepId) { const person = people.get(assignedRepId); if (person) out.set(assignedRepId, person); }
  return [...out.values()];
}

// ── Sending ─────────────────────────────────────────────────────────────────

type SendInput = {
  orgId: string; bot: BotRow; trigger: string; automationId?: string | null; person: Person; chatId: string;
  draft: Draft; orderId?: string | null; dedupeKey?: string | null; batchId?: string | null;
};
export type SendOutcome = "sent" | "failed" | "duplicate";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendLogged(input: SendInput): Promise<SendOutcome> {
  const { data: logRow, error: logError } = await supabase.from("telegram_messages").insert({
    org_id: input.orgId, automation_id: input.automationId ?? null, trigger: input.trigger, user_id: input.person.userId,
    chat_id: input.chatId, order_id: input.orderId ?? null, dedupe_key: input.dedupeKey ?? null, batch_id: input.batchId ?? null,
    title: input.draft.title.slice(0, 200), preview: previewOf(input.draft.text), status: "sending"
  }).select("id").single();
  if (logError) {
    if ((logError as any).code === "23505") return "duplicate";
    throw logError;
  }
  const keyboard = buildKeyboard(input.draft.keyboard, appBase());
  let result = await tgSendMessage(input.bot.token, input.chatId, input.draft.text, keyboard);
  if (!result.ok && result.retryAfter) {
    await sleep(Math.min(5, result.retryAfter) * 1000);
    result = await tgSendMessage(input.bot.token, input.chatId, input.draft.text, keyboard);
  }
  // A link Telegram will not take (a local address) must not stop the message.
  if (!result.ok && /button|url/i.test(result.error) && keyboard.length) {
    result = await tgSendMessage(input.bot.token, input.chatId, input.draft.text);
  }
  if (result.ok) {
    await supabase.from("telegram_messages").update({ status: "sent", sent_at: new Date().toISOString(), telegram_message_id: result.result.message_id }).eq("id", (logRow as any).id);
    return "sent";
  }
  const blocked = result.code === 403;
  await supabase.from("telegram_messages").update({
    status: "failed", error: blocked ? "They blocked the bot or deleted the chat. They need to connect again." : result.error.slice(0, 300)
  }).eq("id", (logRow as any).id);
  // A blocked chat can never be reached again: show them as not connected.
  if (blocked) await unlinkUser(input.orgId, input.person.userId).catch(() => {});
  return "failed";
}

type TriggerContext = {
  assignedRepId?: string | null;
  orderId?: string | null;
  /** Same event, same person: one message (combined with the trigger). */
  dedupeBase?: string | null;
  /** Owner-only event (a Silent Test order). */
  ownerOnly?: boolean;
  draftFor: (person: Person) => Draft | null;
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
    for (const person of await recipientsOf(orgId, automation.recipients, ctx.assignedRepId ?? null)) {
      if (done.has(person.userId)) continue;
      if (ctx.ownerOnly && person.role !== "Owner") continue;
      const link = links.get(person.userId);
      if (!link) continue;
      const draft = ctx.draftFor(person);
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

const ORDER_SELECT = "id, customer, phone, product_name, package_name, quantity, amount, city, state, status, assigned_rep_id, call_outcome, launch_stage";

async function orderInfo(orgId: string, orderId: string): Promise<(OrderInfo & { assignedRepId: string | null; silent: boolean }) | null> {
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
    silent: row.launch_stage === "silent"
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
      assignedRepId: order.assignedRepId, orderId: order.id, ownerOnly: order.silent,
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
    await runTrigger(orgId, "follow_up_due", {
      assignedRepId: order.assigned_rep_id ?? null, orderId: order.id, dedupeBase: tag,
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
    await sendLogged({
      orgId, bot, trigger: "app_alert", person, chatId: link.chat_id,
      draft: forwardedDraft(payload.title, payload.body, payload.url),
      dedupeKey: payload.tag ? `app_alert:${payload.tag}` : null
    });
  } catch (error) {
    logger.warn("telegram forward failed", { orgId, error: String((error as Error)?.message ?? error) });
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

/** The "/" menu Telegram shows: only switched-on commands. */
export async function pushCommandMenu(orgId: string) {
  const bot = await getBot(orgId, true);
  if (!bot) return;
  const enabled = cleanCommandSettings(bot.settings.commands);
  await tgSetCommands(bot.token, COMMANDS.filter((command) => enabled[command.key]).map((command) => ({ command: command.key, description: command.description })));
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
  await supabase.from("telegram_bots").update({ health, last_health_at: new Date().toISOString(), last_error: lastError }).eq("org_id", orgId);
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
  for (const orgId of await connectedBots()) await checkBotHealth(orgId).catch((error) => logger.warn("telegram health failed", { orgId, error: String(error?.message ?? error) }));
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

export async function lowStockItems(orgId: string, threshold: number): Promise<Array<LowStockItem & { key: string }>> {
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
    .select("id, agent_id, name, state, active, stock:agent_location_stock(product_id, quantity, defective, missing)")
    .in("agent_id", [...agentName.keys()]).eq("active", true);
  if (error) throw error;
  // Only what a hub has been selling: a product it never carries is not "low".
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  // launch-safe: only product + state, to know what a hub sells; no order is shown.
  const { data: recent, error: recentError } = await supabase.from("orders").select("product_id, state")
    .eq("org_id", orgId).gte("created_at", since).limit(20000);
  if (recentError) throw recentError;
  const sold = new Set(((recent ?? []) as any[]).map((row) => `${row.product_id}::${String(row.state ?? "").trim().toLowerCase()}`));
  const out: Array<LowStockItem & { key: string }> = [];
  for (const location of (locations ?? []) as any[]) {
    const state = String(location.state ?? "").trim();
    for (const stock of location.stock ?? []) {
      const name = productName.get(String(stock.product_id));
      if (!name || !sold.has(`${stock.product_id}::${state.toLowerCase()}`)) continue;
      const usable = Math.max(0, Number(stock.quantity ?? 0) - Number(stock.defective ?? 0) - Number(stock.missing ?? 0));
      if (usable > threshold) continue;
      out.push({ key: `${location.id}:${stock.product_id}`, productName: name, hubName: `${agentName.get(String(location.agent_id))}${location.name ? ` (${location.name})` : ""}`, state, usable });
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
        const mine = fresh.filter((item) => item.usable <= (rule.settings.threshold ?? 5));
        if (!mine.length) continue;
        const threshold = rule.settings.threshold ?? 5;
        const draft: Draft = mine.length === 1 ? lowStockDraft(mine[0], threshold) : {
          title: `Low stock: ${mine.length} items at or below ${threshold}`,
          text: [`📦 <b>LOW STOCK · ${mine.length} items</b>`, ...mine.slice(0, 15).map((item) => `• ${tgEscape(item.productName)} – ${tgEscape(item.state)}, ${tgEscape(item.hubName)}: <b>${item.usable}</b> left`), ...(mine.length > 15 ? [`…and ${mine.length - 15} more`] : [])].join("\n"),
          keyboard: [[{ text: "📋 Open Inventory", path: "/dashboard/admin/inventory" }]]
        };
        toldSomeone += await runTrigger(orgId, "low_stock", { dedupeBase: `${rule.id}:${today}:${mine.map((item) => `${item.key}=${item.usable}`).join(",")}`.slice(0, 400), draftFor: () => draft }, rule);
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

export async function businessReport(orgId: string, from: string, to: string): Promise<BusinessReport> {
  const [placed, delivered, statusChanges, sentOut, stillNew, meta, tiktok] = await Promise.all([
    supabase.from("orders").select("id, product_name, review_hold, launch_stage").eq("org_id", orgId).gte("created_at", dayStartIso(from)).lte("created_at", dayEndIso(to)).limit(20000),
    supabase.from("orders").select("id, amount").eq("org_id", orgId).eq("status", "Delivered").gte("delivered_date", from).lte("delivered_date", to).neq("launch_stage", "silent").limit(20000),
    supabase.from("order_audit").select("order_id, to_status").eq("org_id", orgId).in("to_status", ["Failed", "Cancelled"]).gte("created_at", dayStartIso(from)).lte("created_at", dayEndIso(to)).limit(20000),
    supabase.from("orders").select("id, created_at, original_created_at, assigned_at, revealed_at, sent_out_at, assigned_rep_id").eq("org_id", orgId).gte("sent_out_at", dayStartIso(from)).lte("sent_out_at", dayEndIso(to)).not("assigned_rep_id", "is", null).limit(20000),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "New").neq("launch_stage", "silent").or("review_hold.is.null,review_hold.eq.false"),
    supabase.from("tracking_meta_ad_insights").select("spend").eq("org_id", orgId).gte("day", from).lte("day", to).limit(50000),
    supabase.from("tracking_tiktok_ad_insights").select("spend").eq("org_id", orgId).gte("day", from).lte("day", to).limit(50000)
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

export async function sendReport(orgId: string, rule: AutomationRow, kind: "daily_report" | "weekly_report", force = false) {
  const today = lagosDateKey();
  const from = kind === "daily_report" ? addDaysToDateKey(today, -1) : addDaysToDateKey(sundayWeekStartForDateKey(today), -7);
  const to = kind === "daily_report" ? from : addDaysToDateKey(from, 6);
  const report = await businessReport(orgId, from, to);
  return runTrigger(orgId, kind, {
    dedupeBase: force ? null : `${rule.id}:${from}`,
    draftFor: (person) => reportDraft(kind, report, person.role)
  }, rule);
}

export async function runReports(nowMs = Date.now()) {
  const lagos = new Date(nowMs + 60 * 60_000);
  const hour = lagos.getUTCHours();
  const weekday = lagos.getUTCDay();
  let sent = 0;
  for (const orgId of await connectedBots()) {
    try {
      for (const rule of (await automationsFor(orgId)).filter((row) => row.enabled && (row.trigger === "daily_report" || row.trigger === "weekly_report"))) {
        if ((rule.settings.hour ?? 9) !== hour) continue;
        if (rule.trigger === "weekly_report" && (rule.settings.weekday ?? 1) !== weekday) continue;
        sent += await sendReport(orgId, rule, rule.trigger as "daily_report" | "weekly_report");
      }
    } catch (error) {
      logger.warn("telegram reports failed", { orgId, error: String((error as Error)?.message ?? error) });
    }
  }
  return { sent };
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
  // One chat, one person: the same phone linked to someone else moves here.
  await supabase.from("telegram_links").delete().eq("org_id", orgId).eq("chat_id", String(chatId)).neq("user_id", person.userId);
  const upsert = await supabase.from("telegram_links").upsert({
    user_id: person.userId, org_id: orgId, chat_id: String(chatId), bot_id: bot.bot_id,
    telegram_username: from?.username ?? null, telegram_name: [from?.first_name, from?.last_name].filter(Boolean).join(" ") || null,
    linked_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (upsert.error) throw upsert.error;
  await supabase.from("telegram_link_codes").update({ used_at: new Date().toISOString() }).eq("code", code);
  linkCache.delete(orgId);
  await reply(orgId, bot, chatId, `✅ <b>Connected.</b> Hi ${tgEscape(person.name)}, your Protohub alerts will come here.\nType /help to see what you can ask me.`, person, undefined, `${person.name} connected Telegram`);
}

function lagosToday() { return lagosDateKey(); }

async function commandAnswer(orgId: string, bot: BotRow, person: Person, command: CommandKey, args: string): Promise<{ text: string; keyboard?: Draft["keyboard"] }> {
  const enabled = cleanCommandSettings(bot.settings.commands);
  if (!enabled[command]) return { text: "That command is switched off." };
  const leadership = ["Owner", "Admin", "Manager"].includes(person.role);
  const repRole = ["Sales Rep", "Recovery Rep", "Sales Closer"].includes(person.role);
  if (command === "help") {
    return { text: ["<b>What you can ask me</b>", ...COMMANDS.filter((row) => enabled[row.key]).map((row) => `/${row.key} – ${tgEscape(row.description)}`)].join("\n") };
  }
  if (command === "stop") {
    await unlinkUser(orgId, person.userId);
    return { text: "Stopped. Protohub will not message this chat. Connect again any time from Protohub → Notifications." };
  }
  if (command === "myorders") {
    if (!leadership && !repRole) return { text: "This is for sales staff." };
    let query = supabase.from("orders").select("id, customer, product_name, assigned_rep_id").eq("org_id", orgId).eq("status", "New").neq("launch_stage", "silent").order("created_at", { ascending: false }).limit(200);
    if (!leadership) query = query.eq("assigned_rep_id", person.userId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as any[];
    const end = new Date(`${lagosToday()}T23:59:59+01:00`).toISOString();
    let follow = supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).lte("next_follow_up_at", end).not("status", "in", "(Delivered,Cancelled)").neq("launch_stage", "silent");
    if (!leadership) follow = follow.eq("assigned_rep_id", person.userId);
    const followUps = await follow;
    const lines = [
      `<b>${leadership ? "New orders (everyone)" : "Your New orders"}: ${rows.length}</b>`,
      ...rows.slice(0, 10).map((row) => `• #${tgEscape(row.id)} ${tgEscape(row.product_name ?? "")}${seesCustomer(person.role) && row.customer ? ` – ${tgEscape(row.customer)}` : ""}`),
      ...(rows.length > 10 ? [`…and ${rows.length - 10} more`] : []),
      `Follow-ups due by end of today: ${followUps.count ?? 0}`
    ];
    return { text: lines.join("\n"), keyboard: [[{ text: "Open Orders", path: person.role === "Sales Rep" ? "/dashboard/sales-rep" : "/dashboard/admin/orders" }]] };
  }
  if (command === "today") {
    if (!leadership) return { text: "Today's numbers are for the Owner, Admins and Managers." };
    const report = await businessReport(orgId, lagosToday(), lagosToday());
    const money = seesBusinessMoney(person.role);
    return { text: [
      `<b>Today so far · ${tgEscape(report.label)}</b>`,
      `Orders in: <b>${report.ordersIn}</b>`,
      `Delivered: <b>${report.delivered}</b>${money ? ` · ${naira(report.deliveredRevenue)}` : ""}`,
      `Failed: ${report.failed} · Cancelled: ${report.cancelled}`,
      `Sent out late: ${report.lateSendOuts} · Still New: ${report.stillNew}`
    ].join("\n") };
  }
  if (command === "late") {
    if (!leadership && person.role !== "Sales Rep") return { text: "This is for leadership and sales reps." };
    let query = supabase.from("orders").select("id, product_name, assigned_rep_id, created_at, original_created_at, assigned_at, revealed_at, review_hold").eq("org_id", orgId).eq("status", "New").not("assigned_rep_id", "is", null).neq("launch_stage", "silent").limit(500);
    if (!leadership) query = query.eq("assigned_rep_id", person.userId);
    const { data, error } = await query;
    if (error) throw error;
    const now = Date.now();
    const people = await peopleOf(orgId);
    const late = ((data ?? []) as any[]).filter((row) => row.review_hold !== true).map((row) => {
      const arrived = arrivedAtMs(row);
      if (!Number.isFinite(arrived) || arrived < Date.parse(`${LATE_SEND_FROM}T00:00:00+01:00`)) return null;
      const { deadlineMs } = lateSendWindow(arrived);
      return now > deadlineMs ? { row, by: workingMinutesBetween(deadlineMs, now) } : null;
    }).filter(Boolean) as Array<{ row: any; by: number }>;
    if (!late.length) return { text: "✅ No order is past the 15-minute send-out limit." };
    return { text: [`<b>Past the 15-minute limit: ${late.length}</b>`, ...late.sort((a, b) => b.by - a.by).slice(0, 12).map(({ row, by }) => `• #${tgEscape(row.id)} ${tgEscape(row.product_name ?? "")} – ${by} min late${leadership ? ` (${tgEscape(people.get(String(row.assigned_rep_id))?.name ?? "")})` : ""}`)].join("\n") };
  }
  if (command === "stock") {
    if (!leadership && !["Inventory Manager", "Inventory Manager & Logistics Operations"].includes(person.role)) return { text: "Stock is for leadership and inventory staff." };
    const q = args.trim().toLowerCase();
    if (!q) return { text: "Type part of a product name, e.g. /stock edge" };
    const items = (await lowStockItems(orgId, 1_000_000)).filter((item) => item.productName.toLowerCase().includes(q));
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
    await tgAnswerCallback(bot.token, callback.id);
  }
}

export { FORWARD_GROUPS };
