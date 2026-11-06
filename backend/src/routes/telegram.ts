import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";
import { looksLikeBotToken, tgWebhookInfo } from "../lib/telegram-api.js";
import {
  COMMANDS, FORWARD_GROUPS, PERFORMANCE_GROUPS, TELEGRAM_ROLES, TRIGGERS, TRIGGER_KEYS, announcementDraft, cleanCommandSettings,
  cleanRecipients, cleanSettings, groupOf, isTriggerKey, recipientLabel, successRate, triggerLabel, type CommandKey
} from "../lib/telegram-rules.js";
import {
  automationsFor, checkBotHealth, connectBot, createLinkCode, disconnectBot, ensureDefaultAutomations, forgetAutomations, getBot,
  handleUpdate, linksFor, newBatchId, pushCommandMenu, sampleDraft, saveBotSettings, sendReport, sendToPeople, unlinkUser, uptimeOf,
  webhookUrlFor, type AutomationRow
} from "../lib/telegram.js";

/**
 * Telegram Automation Center (Bright, 6 Nov 2026). The Owner runs the bot;
 * every staff member can link their own Telegram (/me). The webhook router is
 * mounted separately, without login: Telegram calls it, proven by the secret
 * header set with setWebhook.
 */
const router = Router();
router.use(requireAuth);

const fail = (res: any, error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : (error as any)?.message ?? fallback;
  res.status(500).json({ error: String(message || fallback) });
};

// ── Everyone: my own Telegram ───────────────────────────────────────────────

router.get("/me", async (req, res) => {
  try {
    const bot = await getBot(req.user!.orgId);
    const link = bot ? (await linksFor(req.user!.orgId, true)).get(req.user!.id) : undefined;
    res.json({
      bot: bot ? { connected: bot.status === "connected", username: bot.username, name: bot.name } : null,
      link: link ? { linked: true, telegramUsername: link.telegram_username, telegramName: link.telegram_name, linkedAt: link.linked_at } : { linked: false }
    });
  } catch (error) { fail(res, error, "Could not load your Telegram."); }
});

router.post("/me/link", async (req, res) => {
  try { res.json(await createLinkCode(req.user!.orgId, req.user!.id, req.user!.id)); } catch (error) { fail(res, error, "Could not make a connect link."); }
});

router.delete("/me/link", async (req, res) => {
  try { await unlinkUser(req.user!.orgId, req.user!.id); res.json({ ok: true }); } catch (error) { fail(res, error, "Could not disconnect."); }
});

// ── Owner: the center ───────────────────────────────────────────────────────

const owner = requireRole("Owner");

const periodRange = (period: string) => {
  const today = lagosDateKey();
  const days = period === "today" ? 1 : period === "month" ? 30 : 7;
  const from = addDaysToDateKey(today, -(days - 1));
  return { from, to: today, prevFrom: addDaysToDateKey(from, -days), prevTo: addDaysToDateKey(from, -1), days };
};
const startIso = (day: string) => new Date(`${day}T00:00:00+01:00`).toISOString();
const endIso = (day: string) => new Date(`${day}T23:59:59.999+01:00`).toISOString();

async function messagesBetween(orgId: string, from: string, to: string, columns = "id, trigger, status, user_id, order_id, title, created_at, automation_id") {
  const rows: any[] = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await supabase.from("telegram_messages").select(columns).eq("org_id", orgId)
      .gte("created_at", startIso(from)).lte("created_at", endIso(to)).order("created_at", { ascending: false }).range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

async function staffList(orgId: string) {
  const [{ data: users, error }, links] = await Promise.all([
    supabase.from("users").select("id, name, role, active").eq("org_id", orgId).eq("active", true).neq("role", "Delivery Agent").order("name"),
    linksFor(orgId, true)
  ]);
  if (error) throw error;
  return ((users ?? []) as any[]).map((user) => {
    const link = links.get(String(user.id));
    return {
      id: String(user.id), name: String(user.name ?? "Staff"), role: String(user.role ?? ""),
      linked: Boolean(link), telegramUsername: link?.telegram_username ?? null, telegramName: link?.telegram_name ?? null, linkedAt: link?.linked_at ?? null
    };
  });
}

const automationOut = (row: AutomationRow) => ({
  id: row.id, trigger: row.trigger, name: row.name, enabled: row.enabled, builtIn: row.built_in,
  recipients: row.recipients, settings: row.settings,
  triggerLabel: triggerLabel(row.trigger, row.settings), recipientLabel: recipientLabel(row.recipients),
  group: TRIGGERS[row.trigger].group, description: TRIGGERS[row.trigger].description, updatedAt: row.updated_at
});

const botOut = (bot: Awaited<ReturnType<typeof getBot>>) => bot ? {
  connected: bot.status === "connected", name: bot.name, username: bot.username, connectedAt: bot.connected_at,
  lastError: bot.last_error, lastHealthAt: bot.last_health_at, lastUpdateAt: bot.last_update_at,
  webhookActive: Boolean(bot.webhook_url?.startsWith("https://")) && !bot.last_error,
  uptime: uptimeOf(bot.health), tokenHint: `…${bot.token.slice(-4)}`
} : null;

router.get("/overview", owner, async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const bot = await getBot(orgId, true);
    if (bot) await ensureDefaultAutomations(orgId);
    const period = String(req.query.period ?? "week");
    const range = periodRange(period);
    const today = lagosDateKey();
    const yesterday = addDaysToDateKey(today, -1);
    const [messages, previous, staff, automations] = await Promise.all([
      messagesBetween(orgId, addDaysToDateKey(range.from, 0) < yesterday ? range.from : yesterday, today),
      messagesBetween(orgId, range.prevFrom, range.prevTo, "id, status, created_at"),
      staffList(orgId),
      bot ? automationsFor(orgId, true) : Promise.resolve([] as AutomationRow[])
    ]);
    const inRange = messages.filter((row) => row.created_at >= startIso(range.from));
    const dayOf = (iso: string) => lagosDateKey(iso);
    const todays = messages.filter((row) => dayOf(row.created_at) === today);
    const yesterdays = messages.filter((row) => dayOf(row.created_at) === yesterday);
    const count = (rows: any[], status: string) => rows.filter((row) => row.status === status).length;
    const rate = successRate(count(inRange, "sent"), count(inRange, "failed"));
    const prevRate = successRate(count(previous, "sent"), count(previous, "failed"));
    const people = new Map(staff.map((row) => [row.id, row]));
    const performance = PERFORMANCE_GROUPS.map((group) => {
      const rows = inRange.filter((row) => groupOf(String(row.trigger)) === group.key);
      return { key: group.key, label: group.label, sent: count(rows, "sent"), failed: count(rows, "failed"), rate: successRate(count(rows, "sent"), count(rows, "failed")) };
    });
    const linkedInRange = staff.filter((row) => row.linkedAt && row.linkedAt >= startIso(range.from)).length;
    res.json({
      bot: botOut(bot),
      period,
      kpis: {
        connectedStaff: staff.filter((row) => row.linked).length,
        connectedStaffNew: linkedInRange,
        messagesToday: todays.filter((row) => row.status === "sent").length,
        messagesYesterday: yesterdays.filter((row) => row.status === "sent").length,
        successRate: rate,
        successRateBefore: prevRate,
        activeAutomations: automations.filter((row) => row.enabled).length,
        totalAutomations: automations.length,
        failed: count(inRange, "failed"),
        failedBefore: count(previous, "failed")
      },
      performance,
      recent: messages.filter((row) => row.status !== "sending").slice(0, 6).map((row) => ({
        id: row.id, trigger: row.trigger, status: row.status, title: row.title, createdAt: row.created_at,
        orderId: row.order_id, recipient: row.user_id ? people.get(String(row.user_id))?.name ?? "Staff" : null
      })),
      staff: [...staff].sort((a, b) => Number(b.linked) - Number(a.linked) || a.name.localeCompare(b.name)),
      automations: automations.map(automationOut)
    });
  } catch (error) { fail(res, error, "Could not load the Telegram overview."); }
});

// Bot configuration

router.get("/bot", owner, async (req, res) => {
  try {
    const bot = await getBot(req.user!.orgId, true);
    const info = bot ? await tgWebhookInfo(bot.token) : null;
    res.json({
      bot: botOut(bot),
      webhookUrl: webhookUrlFor(req.user!.orgId),
      webhook: info && info.ok ? { url: info.result.url, pending: info.result.pending_update_count, lastErrorAt: info.result.last_error_date ? new Date(info.result.last_error_date * 1000).toISOString() : null, lastErrorMessage: info.result.last_error_message ?? null } : null,
      appUrl: process.env.FRONTEND_URL?.split(",")[0]?.trim() || null
    });
  } catch (error) { fail(res, error, "Could not load the bot."); }
});

router.post("/bot", owner, async (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (!looksLikeBotToken(token)) { res.status(400).json({ error: "That does not look like a bot token. It looks like 123456789:AAE… and comes from @BotFather." }); return; }
  try { res.json({ bot: botOut(await connectBot(req.user!.orgId, token, req.user!.id)) }); } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not connect the bot." }); }
});

router.delete("/bot", owner, async (req, res) => {
  try { await disconnectBot(req.user!.orgId); res.json({ ok: true }); } catch (error) { fail(res, error, "Could not disconnect the bot."); }
});

router.post("/bot/check", owner, async (req, res) => {
  try {
    const result = await checkBotHealth(req.user!.orgId);
    res.json({ ok: result?.ok ?? false, bot: botOut(await getBot(req.user!.orgId, true)) });
  } catch (error) { fail(res, error, "Could not check the bot."); }
});

router.post("/bot/test", owner, async (req, res) => {
  try {
    const result = await sendToPeople(req.user!.orgId, [req.user!.id], "test", {
      title: "Test message", text: "✅ <b>Protohub bot is working.</b>\nThis is a test from the Telegram Automation Center.", keyboard: [[{ text: "Open Protohub", path: "/dashboard" }]]
    });
    if (result.notLinked) { res.status(400).json({ error: "Connect your own Telegram first (Staff & Recipients → Connect my Telegram)." }); return; }
    res.json(result);
  } catch (error) { fail(res, error, "Could not send the test."); }
});

// Automations

const AutomationSchema = z.object({
  trigger: z.string().refine(isTriggerKey, "Pick what starts the message."),
  name: z.string().trim().min(1, "Give it a name.").max(80),
  enabled: z.boolean().optional(),
  recipients: z.unknown().optional(),
  settings: z.unknown().optional()
});

router.get("/automations", owner, async (req, res) => {
  try {
    if (await getBot(req.user!.orgId)) await ensureDefaultAutomations(req.user!.orgId);
    res.json({
      automations: (await automationsFor(req.user!.orgId, true)).map(automationOut),
      triggers: TRIGGER_KEYS.map((key) => ({ key, label: TRIGGERS[key].label, description: TRIGGERS[key].description, settings: TRIGGERS[key].settings, repApplies: TRIGGERS[key].repApplies, group: TRIGGERS[key].group })),
      roles: TELEGRAM_ROLES
    });
  } catch (error) { fail(res, error, "Could not load automations."); }
});

router.post("/automations", owner, async (req, res) => {
  const parsed = AutomationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." }); return; }
  const trigger = parsed.data.trigger as keyof typeof TRIGGERS;
  try {
    const { data, error } = await supabase.from("telegram_automations").insert({
      org_id: req.user!.orgId, trigger, name: parsed.data.name, enabled: parsed.data.enabled ?? true,
      recipients: cleanRecipients(trigger, parsed.data.recipients), settings: cleanSettings(trigger, parsed.data.settings), built_in: false, created_by: req.user!.id
    }).select("*").single();
    if (error) throw error;
    forgetAutomations(req.user!.orgId);
    res.json({ automation: automationOut({ ...(data as any), recipients: cleanRecipients(trigger, (data as any).recipients), settings: cleanSettings(trigger, (data as any).settings) }) });
  } catch (error) { fail(res, error, "Could not create the automation."); }
});

router.patch("/automations/:id", owner, async (req, res) => {
  try {
    const current = (await automationsFor(req.user!.orgId, true)).find((row) => row.id === req.params.id);
    if (!current) { res.status(404).json({ error: "Automation not found." }); return; }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
    if (typeof req.body?.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim().slice(0, 80);
    if (req.body?.recipients !== undefined) patch.recipients = cleanRecipients(current.trigger, req.body.recipients);
    if (req.body?.settings !== undefined) patch.settings = cleanSettings(current.trigger, req.body.settings);
    const { error } = await supabase.from("telegram_automations").update(patch).eq("org_id", req.user!.orgId).eq("id", current.id);
    if (error) throw error;
    forgetAutomations(req.user!.orgId);
    const next = (await automationsFor(req.user!.orgId, true)).find((row) => row.id === current.id)!;
    res.json({ automation: automationOut(next) });
  } catch (error) { fail(res, error, "Could not save the automation."); }
});

router.delete("/automations/:id", owner, async (req, res) => {
  try {
    const current = (await automationsFor(req.user!.orgId, true)).find((row) => row.id === req.params.id);
    if (!current) { res.status(404).json({ error: "Automation not found." }); return; }
    if (current.built_in) { res.status(400).json({ error: "Built-in automations can be paused, not deleted." }); return; }
    const { error } = await supabase.from("telegram_automations").delete().eq("org_id", req.user!.orgId).eq("id", current.id);
    if (error) throw error;
    forgetAutomations(req.user!.orgId);
    res.json({ ok: true });
  } catch (error) { fail(res, error, "Could not delete the automation."); }
});

/** Send yourself what this automation sends (a report is built for real). */
router.post("/automations/:id/test", owner, async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const current = (await automationsFor(orgId, true)).find((row) => row.id === req.params.id);
    if (!current) { res.status(404).json({ error: "Automation not found." }); return; }
    if (current.trigger === "daily_report" || current.trigger === "weekly_report") {
      const sent = await sendReport(orgId, { ...current, recipients: { roles: [], assignedRep: false, userIds: [req.user!.id] } }, current.trigger, true);
      if (!sent) { res.status(400).json({ error: "Connect your own Telegram first (Staff & Recipients → Connect my Telegram)." }); return; }
      res.json({ sent });
      return;
    }
    const draft = await sampleDraft(orgId, current.trigger, req.user!.role);
    const result = await sendToPeople(orgId, [req.user!.id], "test", { ...draft, title: `Sample: ${current.name}` });
    if (result.notLinked) { res.status(400).json({ error: "Connect your own Telegram first (Staff & Recipients → Connect my Telegram)." }); return; }
    res.json(result);
  } catch (error) { fail(res, error, "Could not send the sample."); }
});

// Staff

router.get("/staff", owner, async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const staff = await staffList(orgId);
    const since = addDaysToDateKey(lagosDateKey(), -6);
    const messages = await messagesBetween(orgId, since, lagosDateKey(), "id, user_id, status, created_at");
    const byUser = new Map<string, { sent: number; failed: number; last: string | null }>();
    for (const row of messages) {
      const entry = byUser.get(String(row.user_id)) ?? { sent: 0, failed: 0, last: null };
      if (row.status === "sent") entry.sent += 1;
      if (row.status === "failed") entry.failed += 1;
      if (!entry.last || row.created_at > entry.last) entry.last = row.created_at;
      byUser.set(String(row.user_id), entry);
    }
    const bot = await getBot(orgId);
    res.json({ bot: bot ? { username: bot.username } : null, staff: staff.map((row) => ({ ...row, week: byUser.get(row.id) ?? { sent: 0, failed: 0, last: null } })) });
  } catch (error) { fail(res, error, "Could not load staff."); }
});

router.post("/staff/:userId/link", owner, async (req, res) => {
  try { res.json(await createLinkCode(req.user!.orgId, String(req.params.userId), req.user!.id)); } catch (error) { fail(res, error, "Could not make a connect link."); }
});

router.delete("/staff/:userId/link", owner, async (req, res) => {
  try { await unlinkUser(req.user!.orgId, String(req.params.userId)); res.json({ ok: true }); } catch (error) { fail(res, error, "Could not disconnect."); }
});

// App alerts forwarded to Telegram

router.get("/alerts", owner, async (req, res) => {
  try {
    const bot = await getBot(req.user!.orgId, true);
    const on = new Set(bot?.settings.forward ?? []);
    res.json({ groups: FORWARD_GROUPS.map((group) => ({ key: group.key, label: group.label, hint: group.hint, enabled: on.has(group.key) })) });
  } catch (error) { fail(res, error, "Could not load alerts."); }
});

router.patch("/alerts", owner, async (req, res) => {
  try {
    const keys = new Set(FORWARD_GROUPS.map((group) => group.key));
    const forward = Array.isArray(req.body?.groups) ? [...new Set((req.body.groups as unknown[]).filter((key): key is string => typeof key === "string" && keys.has(key)))] : [];
    await saveBotSettings(req.user!.orgId, { forward });
    res.json({ ok: true, forward });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not save." }); }
});

// Commands

router.get("/commands", owner, async (req, res) => {
  try {
    const bot = await getBot(req.user!.orgId, true);
    const enabled = cleanCommandSettings(bot?.settings.commands);
    const since = addDaysToDateKey(lagosDateKey(), -6);
    const replies = bot ? (await messagesBetween(req.user!.orgId, since, lagosDateKey(), "id, trigger, status")).filter((row) => row.trigger === "command").length : 0;
    res.json({
      username: bot?.username ?? null,
      repliesThisWeek: replies,
      commands: [{ key: "start", description: "Connect this chat to a Protohub account (always on)", who: "Everyone", enabled: true, locked: true },
        ...COMMANDS.map((command) => ({ ...command, enabled: enabled[command.key], locked: command.key === "help" || command.key === "stop" }))]
    });
  } catch (error) { fail(res, error, "Could not load commands."); }
});

router.patch("/commands", owner, async (req, res) => {
  try {
    const commands = cleanCommandSettings(req.body?.commands) as Record<CommandKey, boolean>;
    await saveBotSettings(req.user!.orgId, { commands });
    await pushCommandMenu(req.user!.orgId);
    res.json({ ok: true, commands });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Could not save." }); }
});

// Message Center (announcements)

router.post("/announce", owner, async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  if (!text) { res.status(400).json({ error: "Write the message first." }); return; }
  if (text.length > 3500) { res.status(400).json({ error: "Keep it under 3,500 characters." }); return; }
  try {
    const orgId = req.user!.orgId;
    const staff = await staffList(orgId);
    const roles = new Set(Array.isArray(req.body?.roles) ? (req.body.roles as unknown[]).map(String) : []);
    const userIds = new Set(Array.isArray(req.body?.userIds) ? (req.body.userIds as unknown[]).map(String) : []);
    const everyone = req.body?.everyone === true;
    const targets = staff.filter((row) => everyone || roles.has(row.role) || userIds.has(row.id)).map((row) => row.id);
    if (!targets.length) { res.status(400).json({ error: "Pick who should get it." }); return; }
    const batchId = newBatchId();
    const result = await sendToPeople(orgId, targets, "announcement", announcementDraft(text, req.user!.name || "Protohub"), batchId);
    res.json({ ...result, batchId });
  } catch (error) { fail(res, error, "Could not send the announcement."); }
});

router.get("/announcements", owner, async (req, res) => {
  try {
    const { data, error } = await supabase.from("telegram_messages").select("batch_id, status, preview, created_at, user_id")
      .eq("org_id", req.user!.orgId).eq("trigger", "announcement").order("created_at", { ascending: false }).limit(2000);
    if (error) throw error;
    const batches = new Map<string, { batchId: string; preview: string; createdAt: string; sent: number; failed: number }>();
    for (const row of (data ?? []) as any[]) {
      const key = String(row.batch_id ?? row.created_at);
      const entry = batches.get(key) ?? { batchId: key, preview: String(row.preview ?? "").replace(/^📣 Announcement /, ""), createdAt: row.created_at, sent: 0, failed: 0 };
      if (row.status === "sent") entry.sent += 1; else if (row.status === "failed") entry.failed += 1;
      batches.set(key, entry);
    }
    res.json({ announcements: [...batches.values()].slice(0, 50) });
  } catch (error) { fail(res, error, "Could not load announcements."); }
});

// Logs

router.get("/logs", owner, async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const range = periodRange(String(req.query.period ?? "week"));
    const rows = await messagesBetween(orgId, range.from, range.to, "id, trigger, status, user_id, order_id, title, preview, error, created_at, sent_at");
    const staff = new Map((await staffList(orgId)).map((row) => [row.id, row]));
    const trigger = String(req.query.trigger ?? "all");
    const status = String(req.query.status ?? "all");
    const filtered = rows.filter((row) => (trigger === "all" || row.trigger === trigger) && (status === "all" || row.status === status));
    const byDay = new Map<string, { day: string; sent: number; failed: number }>();
    for (let i = 0; i < range.days; i += 1) { const day = addDaysToDateKey(range.from, i); byDay.set(day, { day, sent: 0, failed: 0 }); }
    for (const row of rows) {
      const entry = byDay.get(lagosDateKey(row.created_at));
      if (!entry) continue;
      if (row.status === "sent") entry.sent += 1;
      if (row.status === "failed") entry.failed += 1;
    }
    const byTrigger = new Map<string, { trigger: string; sent: number; failed: number }>();
    for (const row of rows) {
      const entry = byTrigger.get(row.trigger) ?? { trigger: row.trigger, sent: 0, failed: 0 };
      if (row.status === "sent") entry.sent += 1;
      if (row.status === "failed") entry.failed += 1;
      byTrigger.set(row.trigger, entry);
    }
    const sent = rows.filter((row) => row.status === "sent").length;
    const failed = rows.filter((row) => row.status === "failed").length;
    res.json({
      totals: { sent, failed, rate: successRate(sent, failed), people: new Set(rows.map((row) => row.user_id).filter(Boolean)).size },
      byDay: [...byDay.values()],
      byTrigger: [...byTrigger.values()].sort((a, b) => b.sent + b.failed - (a.sent + a.failed)),
      rows: filtered.slice(0, 300).map((row) => ({
        id: row.id, trigger: row.trigger, status: row.status, title: row.title, preview: row.preview, error: row.error,
        orderId: row.order_id, createdAt: row.created_at, recipient: row.user_id ? staff.get(String(row.user_id))?.name ?? "Former staff" : null,
        role: row.user_id ? staff.get(String(row.user_id))?.role ?? null : null
      })),
      total: filtered.length
    });
  } catch (error) { fail(res, error, "Could not load the log."); }
});

export default router;

// ── Webhook: Telegram → Protohub (no login; secret header) ─────────────────

export const telegramWebhookRouter = Router();

telegramWebhookRouter.post("/:orgId", async (req, res) => {
  const orgId = String(req.params.orgId);
  // Always 200 quickly: Telegram retries anything else.
  try {
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) { res.sendStatus(200); return; }
    const bot = await getBot(orgId);
    const given = String(req.get("X-Telegram-Bot-Api-Secret-Token") ?? "");
    if (!bot || given.length !== bot.webhook_secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(bot.webhook_secret))) {
      res.sendStatus(401);
      return;
    }
    res.sendStatus(200);
    await handleUpdate(orgId, req.body);
  } catch (error) {
    logger.warn("telegram webhook failed", { orgId, error: String((error as Error)?.message ?? error) });
    if (!res.headersSent) res.sendStatus(200);
  }
});
