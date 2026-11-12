import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import * as manychat from "../lib/manychat.js";
import { cleanPrefs, cleanSla } from "../lib/social-leads-rules.js";
import { cleanConfig, configProblem, nextScheduled } from "../lib/automation-rules.js";
import {
  LEADERSHIP, SocialLeadError, addManualLead, announce, completeFollowUp, markRead, scheduleFollowUp, sendReply, settingsFor, transferLead, updateLead, loadLeadFor, type Actor
} from "../lib/social-leads.js";
import * as views from "../lib/social-leads-views.js";
import * as sections from "../lib/social-leads-settings.js";

/**
 * Social Leads Inbox (Bright, 12 Nov 2026). Owner / Admin / Manager see the
 * branch; a Sales Rep sees and works only the leads given to them. The
 * ManyChat key and the private address are Owner / Admin only.
 */
const router = Router();
router.use(requireAuth);

const VIEW = ["Owner", "Admin", "Manager", "Sales Rep"] as const;
const LEAD = ["Owner", "Admin", "Manager"] as const;
const SETUP = ["Owner", "Admin"] as const;

const actorOf = (req: Request): Actor => {
  if (!req.user!.branchId) throw new SocialLeadError(400, "Open a branch first.");
  return { id: req.user!.id, name: req.user!.name, role: req.user!.role, orgId: req.user!.orgId, branchId: req.user!.branchId };
};

const fail = (res: any, error: unknown, fallback: string) => {
  if (error instanceof SocialLeadError) { res.status(error.status).json({ error: error.message }); return; }
  const message = error instanceof Error ? error.message : (error as any)?.message ?? fallback;
  res.status(500).json({ error: String(message || fallback) });
};
const handle = (fallback: string, fn: (req: Request) => Promise<unknown>) => async (req: Request, res: any) => {
  try { res.json(await fn(req)); } catch (error) { fail(res, error, fallback); }
};
const query = (req: Request) => req.query as Record<string, unknown>;

// Settings › Access & Permissions: which roles may open the inbox (the Owner always can).
router.use(async (req, res, next) => {
  try {
    if (!req.user || req.user.role === "Owner" || !req.user.branchId) return next();
    const row = await settingsFor(req.user.orgId, req.user.branchId);
    if (!cleanPrefs(row.prefs).roles.includes(req.user.role)) { res.status(403).json({ error: "The Owner has not given your role the Social Leads Inbox." }); return; }
    next();
  } catch (error) { fail(res, error, "Could not check access."); }
});

router.get("/header", requireRole(...VIEW), handle("Could not load the inbox.", (req) => views.header(actorOf(req))));
router.get("/badge", requireRole(...VIEW), handle("Could not load the count.", (req) => views.badge(actorOf(req))));
router.get("/stats", requireRole(...VIEW), handle("Could not load the numbers.", (req) => views.stats(actorOf(req), query(req))));
router.get("/conversations", requireRole(...VIEW), handle("Could not load the conversations.", (req) => views.conversations(actorOf(req), req.query.filter, req.query.q)));
router.get("/leads", requireRole(...VIEW), handle("Could not load the leads.", (req) => views.leadsTable(actorOf(req), query(req))));
router.get("/leads/export", requireRole(...VIEW), handle("Could not export the leads.", (req) => views.leadsExport(actorOf(req), query(req))));
router.get("/leads/:id", requireRole(...VIEW), handle("Could not load this lead.", (req) => views.leadDetail(actorOf(req), String(req.params.id))));
router.get("/leads/:id/messages", requireRole(...VIEW), handle("Could not load the messages.", (req) => views.messagesSince(actorOf(req), String(req.params.id), typeof req.query.since === "string" ? req.query.since : null)));
router.get("/follow-ups", requireRole(...VIEW), handle("Could not load the follow-ups.", (req) => views.followUps(actorOf(req), query(req))));
router.get("/converted", requireRole(...VIEW), handle("Could not load the converted leads.", (req) => views.convertedLeads(actorOf(req), query(req))));
router.get("/automations", requireRole(...LEAD), handle("Could not load the automations.", (req) => views.automations(actorOf(req))));
router.get("/reps", requireRole(...VIEW), handle("Could not load the reps.", (req) => views.repsForTransfer(actorOf(req))));
router.get("/products", requireRole(...VIEW), handle("Could not load the products.", (req) => views.productsForPicker(actorOf(req))));

// ── Leads ─────────────────────────────────────────────────────────────────

router.post("/leads", requireRole(...VIEW), handle("Could not add the lead.", (req) => addManualLead(actorOf(req), req.body ?? {})));
router.post("/leads/import", requireRole(...LEAD), handle("Could not import the leads.", async (req) => {
  const actor = actorOf(req);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows.slice(0, 1000) : [];
  if (!rows.length) throw new SocialLeadError(400, "The file has no rows.");
  let added = 0;
  const problems: string[] = [];
  for (const [i, row] of rows.entries()) {
    try { await addManualLead(actor, row ?? {}); added += 1; } catch (error: any) { problems.push(`Row ${i + 2}: ${error?.message ?? "not added"}`); }
  }
  return { added, problems: problems.slice(0, 20) };
}));

const MessageSchema = z.object({
  kind: z.enum(["text", "note", "product", "image"]),
  body: z.string().max(2000).optional(),
  productId: z.string().uuid().optional(),
  packageId: z.string().uuid().optional(),
  imageUrl: z.string().url().max(1000).optional()
});
router.post("/leads/:id/messages", requireRole(...VIEW), async (req, res) => {
  const parsed = MessageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Message not understood." }); return; }
  try { res.json(await sendReply(actorOf(req), String(req.params.id), parsed.data)); } catch (error) { fail(res, error, "Could not send the message."); }
});
router.post("/leads/:id/read", requireRole(...VIEW), handle("Could not mark it read.", (req) => markRead(actorOf(req), String(req.params.id))));
router.patch("/leads/:id", requireRole(...VIEW), handle("Could not save the lead.", (req) => updateLead(actorOf(req), String(req.params.id), req.body ?? {})));
router.post("/leads/:id/transfer", requireRole(...VIEW), handle("Could not transfer the lead.", (req) => transferLead(actorOf(req), String(req.params.id), String(req.body?.repId ?? ""))));
router.post("/leads/:id/follow-up/done", requireRole(...VIEW), handle("Could not mark it done.", (req) => completeFollowUp(actorOf(req), String(req.params.id), typeof req.body?.outcome === "string" ? req.body.outcome : null)));

/** Bulk Schedule: one time for several leads. */
router.post("/follow-ups/bulk", requireRole(...VIEW), handle("Could not schedule the follow-ups.", async (req) => {
  const actor = actorOf(req);
  const ids = Array.isArray(req.body?.leadIds) ? req.body.leadIds.filter((x: unknown) => typeof x === "string").slice(0, 200) : [];
  const at = new Date(String(req.body?.dueAt ?? ""));
  if (!ids.length) throw new SocialLeadError(400, "Tick the leads first.");
  if (Number.isNaN(at.getTime())) throw new SocialLeadError(400, "Pick a valid follow-up time.");
  const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 300) || null : null;
  let done = 0;
  for (const id of ids) { const lead = await loadLeadFor(actor, id); await scheduleFollowUp(lead, at.toISOString(), note, actor.name); done += 1; }
  return { scheduled: done };
}));

/** Bulk actions on All Leads: assign, status. */
router.post("/leads/bulk", requireRole(...LEAD), handle("Could not update the leads.", async (req) => {
  const actor = actorOf(req);
  const ids = Array.isArray(req.body?.leadIds) ? req.body.leadIds.filter((x: unknown) => typeof x === "string").slice(0, 500) : [];
  if (!ids.length) throw new SocialLeadError(400, "Tick the leads first.");
  let changed = 0;
  for (const id of ids) {
    if (typeof req.body?.repId === "string") await transferLead(actor, id, req.body.repId);
    else if (typeof req.body?.status === "string") await updateLead(actor, id, { status: req.body.status, lostReason: req.body.lostReason });
    changed += 1;
  }
  return { changed };
}));

// ── Automations ───────────────────────────────────────────────────────────

const TRIGGERS = ["comment", "keyword", "time_delay", "inactivity", "after_reply", "order_created", "other", "new_message", "new_lead", "tag_added", "order_update", "assigned", "time_based"] as const;
const AutomationSchema = z.object({
  name: z.string().min(1).max(100), description: z.string().max(500).optional(), trigger: z.enum(TRIGGERS).optional(),
  status: z.enum(["active", "paused", "draft"]).optional(), template: z.string().max(40).optional(),
  // Create Automation builder (13 Nov 2026): the 5-step setup of an automation Protohub runs.
  kind: z.enum(["manychat", "protohub"]).optional(), config: z.record(z.unknown()).optional()
});
/** A Protohub automation: clean its setup; refuse to switch on an incomplete one; work out its next scheduled run. */
function builderFields(d: { name?: string; status?: string; config?: Record<string, unknown> }, current?: any) {
  const config = cleanConfig(d.config ?? current?.config);
  const status = d.status ?? current?.status ?? "draft";
  if (status === "active") { const problem = configProblem(config, d.name ?? current?.name ?? ""); if (problem) throw new SocialLeadError(400, problem); }
  const next = config.trigger.key === "time_based" ? nextScheduled(config.schedule, Date.now() - 1, current?.runs_done ?? 0, Date.now()) : null;
  return { config, trigger: config.trigger.key, next_run_at: next ? new Date(next).toISOString() : null };
}
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "flow";
router.post("/automations", requireRole(...SETUP), async (req, res) => {
  const parsed = AutomationSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Give the automation a name." }); return; }
  try {
    const actor = actorOf(req);
    const d = parsed.data;
    const built = d.kind === "protohub" ? { kind: "protohub", ...builderFields(d) } : {};
    const { data, error } = await supabase.from("social_lead_automations").upsert({
      org_id: actor.orgId, branch_id: actor.branchId, flow_key: d.kind === "protohub" ? `ph-${slug(d.name)}-${Date.now().toString(36)}` : slug(d.name), name: d.name, description: d.description ?? null,
      trigger: d.trigger ?? "comment", status: d.status ?? "draft", template: d.template ?? null, updated_at: new Date().toISOString(), ...built
    }, { onConflict: "org_id,branch_id,flow_key" }).select("*").single();
    if (error) throw error;
    res.json({ automation: data });
  } catch (error) { fail(res, error, "Could not save the automation."); }
});
router.patch("/automations/:id", requireRole(...SETUP), async (req, res) => {
  const parsed = AutomationSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Not understood." }); return; }
  try {
    const actor = actorOf(req);
    const d = parsed.data;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (d.name) patch.name = d.name;
    if (d.description !== undefined) patch.description = d.description;
    if (d.trigger) patch.trigger = d.trigger;
    if (d.status) patch.status = d.status;
    const { data: current } = await supabase.from("social_lead_automations").select("*").eq("org_id", actor.orgId).eq("id", String(req.params.id)).maybeSingle();
    if (current?.kind === "protohub") Object.assign(patch, builderFields({ name: d.name, status: d.status, config: d.config }, current));
    const { data, error } = await supabase.from("social_lead_automations").update(patch).eq("org_id", actor.orgId).eq("id", String(req.params.id)).select("*").single();
    if (error) throw error;
    res.json({ automation: data });
  } catch (error) { fail(res, error, "Could not save the automation."); }
});
router.delete("/automations/:id", requireRole(...SETUP), handle("Could not remove it.", async (req) => {
  const actor = actorOf(req);
  const { error } = await supabase.from("social_lead_automations").delete().eq("org_id", actor.orgId).eq("id", String(req.params.id));
  if (error) throw error;
  return { ok: true };
}));
/** Sync from ManyChat: the Page's flows appear on the list (numbers come from ?flow= in each flow's request). */
router.post("/automations/sync", requireRole(...SETUP), handle("Could not read ManyChat's flows.", async (req) => {
  const actor = actorOf(req);
  const row = await settingsFor(actor.orgId, actor.branchId);
  if (!row.manychat_api_key) throw new SocialLeadError(400, "Connect ManyChat first (Settings › Integrations).");
  const result = await manychat.pageFlows(row.manychat_api_key);
  if (!result.ok) throw new SocialLeadError(502, result.message);
  const flows = (result.data.flows ?? []).slice(0, 300);
  for (const flow of flows) {
    await supabase.from("social_lead_automations").upsert({
      org_id: actor.orgId, branch_id: actor.branchId, flow_key: slug(flow.name), manychat_ns: flow.ns, name: flow.name, status: "active", updated_at: new Date().toISOString()
    }, { onConflict: "org_id,branch_id,flow_key" });
  }
  return { synced: flows.length };
}));

// ── Settings (Owner / Admin) ──────────────────────────────────────────────

const publicBase = () => (process.env.PUBLIC_BACKEND_URL || "https://protohub-production.up.railway.app").replace(/\/+$/, "");

async function settingsView(req: Request) {
  const actor = actorOf(req);
  const row = await settingsFor(actor.orgId, actor.branchId);
  const key = row.manychat_api_key ?? "";
  const { data: hours } = await supabase.from("cart_assignment_settings").select("work_start_minute, work_end_minute").eq("branch_id", actor.branchId).maybeSingle();
  return {
    connected: Boolean(key && row.connected_at), keyHint: key ? `••••${key.slice(-4)}` : null, pageName: row.manychat_page_name, connectedAt: row.connected_at,
    connectionError: row.connection_error, facebook: row.facebook_connected, instagram: row.instagram_connected, lastEventAt: row.last_event_at,
    webhookUrl: `${publicBase()}/api/public/social-leads/manychat/${row.webhook_secret}`,
    autoAssign: row.auto_assign, telegramAlerts: row.telegram_alerts, sla: cleanSla(row.sla), maxOpenPerRep: row.max_open_per_rep,
    prefs: cleanPrefs(row.prefs),
    hours: { start: (hours as any)?.work_start_minute ?? 510, end: (hours as any)?.work_end_minute ?? 1020 }
  };
}
router.get("/settings", requireRole(...SETUP), handle("Could not load the settings.", settingsView));

const SettingsSchema = z.object({
  apiKey: z.string().max(400).optional(),
  autoAssign: z.boolean().optional(),
  telegramAlerts: z.boolean().optional(),
  sla: z.record(z.unknown()).optional(),
  maxOpenPerRep: z.number().int().min(0).max(500).optional(),
  prefs: z.record(z.unknown()).optional(),
  disconnect: z.boolean().optional()
});
router.put("/settings", requireRole(...SETUP), async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Settings not understood." }); return; }
  try {
    const actor = actorOf(req);
    const current = await settingsFor(actor.orgId, actor.branchId);
    const d = parsed.data;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (d.disconnect) Object.assign(patch, { manychat_api_key: null, connected_at: null, manychat_page_name: null, manychat_page_id: null, connection_error: null });
    if (d.apiKey !== undefined && d.apiKey.trim()) {
      const key = d.apiKey.trim();
      const check = await manychat.pageInfo(key);
      if (!check.ok) { res.status(400).json({ error: check.message }); return; }
      Object.assign(patch, { manychat_api_key: key, connected_at: new Date().toISOString(), manychat_page_name: check.data.name ?? null, manychat_page_id: String(check.data.id ?? ""), connection_error: null });
    }
    if (d.autoAssign !== undefined) patch.auto_assign = d.autoAssign;
    if (d.telegramAlerts !== undefined) patch.telegram_alerts = d.telegramAlerts;
    if (d.sla) patch.sla = cleanSla(d.sla);
    if (d.maxOpenPerRep !== undefined) patch.max_open_per_rep = d.maxOpenPerRep;
    if (d.prefs) patch.prefs = cleanPrefs({ ...cleanPrefs(current.prefs), ...d.prefs });
    const { error } = await supabase.from("social_lead_settings").update(patch).eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
    if (error) throw error;
    res.json(await settingsView(req));
  } catch (error) { fail(res, error, "Could not save the settings."); }
});
router.post("/settings/new-address", requireRole(...SETUP), handle("Could not make a new address.", async (req) => {
  const actor = actorOf(req);
  await settingsFor(actor.orgId, actor.branchId);
  const secret = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const { error } = await supabase.from("social_lead_settings").update({ webhook_secret: secret, updated_at: new Date().toISOString() }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
  if (error) throw error;
  return settingsView(req);
}));
router.post("/settings/test", requireRole(...SETUP), handle("Could not test ManyChat.", async (req) => {
  const actor = actorOf(req);
  const row = await settingsFor(actor.orgId, actor.branchId);
  if (!row.manychat_api_key) throw new SocialLeadError(400, "Add the ManyChat API key first.");
  const check = await manychat.pageInfo(row.manychat_api_key);
  await supabase.from("social_lead_settings").update(check.ok ? { connection_error: null, manychat_page_name: check.data.name ?? row.manychat_page_name } : { connection_error: check.message }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
  if (!check.ok) throw new SocialLeadError(400, check.message);
  return { ok: true, pageName: check.data.name };
}));
router.get("/events", requireRole(...SETUP), handle("Could not load the activity log.", (req) => views.events(actorOf(req))));

const SECTIONS: Record<string, (actor: Actor, req: Request) => Promise<unknown>> = {
  team: (a) => sections.teamSection(a), sla: (a) => sections.slaSection(a), integrations: (a) => sections.integrationsSection(a),
  notifications: (a, req) => sections.notificationsSection(a, String(req.query.category ?? "all")), templates: (a) => sections.templatesSection(a),
  access: (a) => sections.accessSection(a), advanced: (a) => sections.advancedSection(a)
};
router.get("/settings/section/:name", requireRole(...SETUP), handle("Could not load this section.", (req) => {
  const fn = SECTIONS[String(req.params.name)];
  if (!fn) throw new SocialLeadError(404, "Unknown section.");
  return fn(actorOf(req), req);
}));
router.post("/settings/notifications/read", requireRole(...VIEW), handle("Could not mark them read.", (req) => sections.markNotificationsRead(actorOf(req), Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string") : "all")));
router.post("/announcements", requireRole(...SETUP), handle("Could not send it.", (req) => announce(actorOf(req), req.body ?? {})));
router.post("/templates/:id/used", requireRole(...VIEW), handle("Could not count it.", (req) => sections.templateUsed(actorOf(req), String(req.params.id))));
/** Developer Tools › Test Webhook: posts a test event to this branch's own address. */
router.post("/settings/test-webhook", requireRole(...SETUP), handle("The test did not reach Protohub.", async (req) => {
  const actor = actorOf(req);
  const row = await settingsFor(actor.orgId, actor.branchId);
  const port = process.env.PORT || "4000";
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${port}/api/public/social-leads/manychat/${row.webhook_secret}?event=test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) throw new SocialLeadError(502, json.error || `The address answered ${response.status}.`);
  return { ok: true, ms: Date.now() - started };
}));

export { LEADERSHIP };
export default router;
