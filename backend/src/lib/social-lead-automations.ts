import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { getOrgPushBranding } from "./push-branding.js";
import { sendPushToUser } from "./push.js";
import * as manychat from "./manychat.js";
import { cleanPrefs, messagingWindow } from "./social-leads-rules.js";
import { assignLead, logEvent, settingsFor, systemMessage, LINK } from "./social-leads.js";
import {
  cleanConfig, conditionsPass, fillVariables, firstRunAt, nextOpen, nextScheduled, type Action, type AutomationConfig, type LeadFacts, type TriggerKey
} from "./automation-rules.js";

// Create Automation builder (Bright, 13 Nov 2026): automations Protohub runs
// itself. A trigger starts a run for one lead; the run carries out the
// actions in order (a Wait parks it until later); time-based automations
// start runs for every matching lead on their schedule. Rules: automation-rules.ts.

const leadLink = (id: string) => `${LINK}?lead=${encodeURIComponent(id)}`;
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;

async function factsOf(lead: any, message = ""): Promise<LeadFacts> {
  const last10 = String(lead.phone ?? "").replace(/\D/g, "").slice(-10);
  let orders = lead.order_id ? 1 : 0;
  if (last10.length === 10) {
    // launch-safe: only a count for the "Order Count" condition; nothing is shown.
    const { count } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", lead.org_id).ilike("phone", `%${last10}`).not("status", "in", "(Cancelled,Failed)");
    orders = Math.max(orders, count ?? 0);
  }
  return {
    tags: lead.tags ?? [], message: message || lead.last_message_preview || "", state: lead.state ?? null, productId: lead.product_id ?? null, product: lead.product_interest ?? null,
    status: lead.status, platform: lead.platform === "messenger" ? "facebook" : lead.platform, orders, hot: Boolean(lead.hot || lead.status === "hot"), score: Number(lead.lead_score) || 0
  };
}

/** Limits from step 5: max runs per customer, cool-down, stop after N days. */
async function allowed(auto: any, config: AutomationConfig, leadId: string, nowMs: number) {
  if (config.settings.stopAfterEnabled && Date.parse(auto.created_at) + config.settings.stopAfterDays * 86_400_000 < nowMs) {
    await supabase.from("social_lead_automations").update({ status: "paused", updated_at: new Date(nowMs).toISOString() }).eq("id", auto.id);
    return false;
  }
  const { data: runs } = await supabase.from("social_lead_automation_runs").select("created_at, status").eq("automation_id", auto.id).eq("lead_id", leadId).not("status", "in", "(skipped,cancelled)").order("created_at", { ascending: false }).limit(1000);
  const list = (runs ?? []) as any[];
  if (config.settings.maxRunsPerCustomer > 0 && list.length >= config.settings.maxRunsPerCustomer) return false;
  if (config.settings.coolDownDays > 0 && list[0] && Date.parse(list[0].created_at) > nowMs - config.settings.coolDownDays * 86_400_000) return false;
  return true;
}

async function enqueue(auto: any, config: AutomationConfig, lead: any, nowMs: number, runAtMs?: number) {
  const runAt = runAtMs ?? firstRunAt(config.schedule, nowMs);
  const { data, error } = await supabase.from("social_lead_automation_runs").insert({
    org_id: auto.org_id, branch_id: auto.branch_id, automation_id: auto.id, lead_id: lead.id, run_at: new Date(runAt).toISOString()
  }).select("*").single();
  if (error) throw error;
  if (runAt <= nowMs + 1000) await executeRun(data as any, 0);
}

export type TriggerContext = { message?: string; firstMessage?: boolean; tag?: string; orderStatus?: string };

/** Something happened to a lead: start every matching active automation. */
export async function fireTrigger(key: TriggerKey, lead: any, ctx: TriggerContext = {}, nowMs = Date.now()) {
  try {
    const { data: autos } = await supabase.from("social_lead_automations").select("*").eq("org_id", lead.org_id).eq("branch_id", lead.branch_id)
      .eq("kind", "protohub").eq("status", "active").eq("trigger", key);
    if (!autos?.length) return;
    const prefs = cleanPrefs((await settingsFor(lead.org_id, lead.branch_id)).prefs);
    if (prefs.pauseAllAutomations) return;
    const facts = await factsOf(lead, ctx.message);
    const platform = lead.platform === "messenger" ? "facebook" : lead.platform;
    for (const auto of autos as any[]) {
      const config = cleanConfig(auto.config);
      if (!config.trigger.platforms.includes(platform)) continue;
      if (key === "new_message" && config.trigger.event === "first" && !ctx.firstMessage) continue;
      if (key === "tag_added" && config.trigger.tag && config.trigger.tag.toLowerCase() !== String(ctx.tag ?? "").toLowerCase()) continue;
      if (key === "order_update" && config.trigger.orderStatus && config.trigger.orderStatus !== ctx.orderStatus) continue;
      if (!conditionsPass(config.conditions, facts)) continue;
      if (!(await allowed(auto, config, lead.id, nowMs))) continue;
      await enqueue(auto, config, lead, nowMs);
    }
  } catch (error: any) {
    logger.warn("automation trigger failed", { key, lead: lead?.ref, error: error?.message ?? String(error) });
  }
}

/** Every minute: runs that are due (after a Wait, a delay or outside hours), and time-based automations. */
export async function runAutomationsJob(nowMs = Date.now()) {
  let ran = 0;
  const { data: due } = await supabase.from("social_lead_automation_runs").select("*").eq("status", "pending").lte("run_at", new Date(nowMs).toISOString()).order("run_at").limit(100);
  for (const run of (due ?? []) as any[]) { await executeRun(run, 0, nowMs); ran += 1; }
  const { data: timed } = await supabase.from("social_lead_automations").select("*").eq("kind", "protohub").eq("status", "active").eq("trigger", "time_based");
  for (const auto of (timed ?? []) as any[]) {
    try {
      const config = cleanConfig(auto.config);
      if (!auto.next_run_at) {
        const next = nextScheduled(config.schedule, nowMs - 1, auto.runs_done ?? 0, nowMs);
        if (next) await supabase.from("social_lead_automations").update({ next_run_at: new Date(next).toISOString() }).eq("id", auto.id);
        continue;
      }
      if (Date.parse(auto.next_run_at) > nowMs) continue;
      const prefs = cleanPrefs((await settingsFor(auto.org_id, auto.branch_id)).prefs);
      if (!prefs.pauseAllAutomations) {
        const { data: leads } = await supabase.from("social_leads").select("*").eq("org_id", auto.org_id).eq("branch_id", auto.branch_id)
          .not("status", "in", "(lost,delivered)").order("last_message_at", { ascending: false }).limit(500);
        for (const lead of (leads ?? []) as any[]) {
          const platform = lead.platform === "messenger" ? "facebook" : lead.platform;
          if (!config.trigger.platforms.includes(platform)) continue;
          if (!conditionsPass(config.conditions, await factsOf(lead))) continue;
          if (!(await allowed(auto, config, lead.id, nowMs))) continue;
          await enqueue(auto, config, lead, nowMs, nextOpen(nowMs, config.schedule));
        }
      }
      const done = (auto.runs_done ?? 0) + 1;
      const next = nextScheduled(config.schedule, Date.parse(auto.next_run_at), done, nowMs);
      await supabase.from("social_lead_automations").update({ runs_done: done, next_run_at: next ? new Date(next).toISOString() : null, updated_at: new Date(nowMs).toISOString() }).eq("id", auto.id);
    } catch (error: any) {
      logger.warn("time-based automation failed", { id: auto.id, error: error?.message ?? String(error) });
    }
  }
  return { ran };
}

/** Carry out a run's actions from its step on; a Wait parks it. */
export async function executeRun(run: any, depth = 0, nowMs = Date.now()) {
  const { data: claimed } = await supabase.from("social_lead_automation_runs").update({ status: "running" }).eq("id", run.id).eq("status", "pending").select("*").maybeSingle();
  if (!claimed) return;
  const log: any[] = Array.isArray(claimed.log) ? claimed.log : [];
  try {
    const [{ data: auto }, { data: lead }] = await Promise.all([
      supabase.from("social_lead_automations").select("*").eq("id", run.automation_id).maybeSingle(),
      supabase.from("social_leads").select("*").eq("id", run.lead_id).maybeSingle()
    ]);
    if (!auto || !lead || (auto as any).status !== "active") {
      await supabase.from("social_lead_automation_runs").update({ status: "cancelled", finished_at: new Date().toISOString(), error: !auto ? "Automation removed" : !lead ? "Lead removed" : "Automation paused" }).eq("id", run.id);
      return;
    }
    const config = cleanConfig((auto as any).config);
    const settings = await settingsFor((lead as any).org_id, (lead as any).branch_id);
    let current: any = lead;
    for (let i = claimed.step; i < config.actions.length; i += 1) {
      const action = config.actions[i];
      if (action.type === "wait") {
        const minutes = Math.max(1, Number(action.config.minutes) || Number(action.config.amount) * ({ minutes: 1, hours: 60, days: 1440 } as any)[action.config.unit ?? "minutes"] || 60);
        const at = nextOpen(Date.now() + minutes * 60_000, config.schedule);
        log.push({ step: i, type: "wait", ok: true, note: `Waiting until ${new Date(at).toISOString()}` });
        await supabase.from("social_lead_automation_runs").update({ status: "pending", step: i + 1, run_at: new Date(at).toISOString(), log }).eq("id", run.id);
        return;
      }
      const result = await doAction(action, current, auto, config, settings, depth);
      log.push({ step: i, type: action.type, ok: result.ok, note: result.note });
      if (result.lead) current = result.lead;
    }
    await supabase.from("social_lead_automation_runs").update({ status: "done", step: config.actions.length, log, finished_at: new Date().toISOString(), error: log.some((x) => !x.ok) ? log.filter((x) => !x.ok).map((x) => x.note).join("; ").slice(0, 400) : null }).eq("id", run.id);
    await logEvent((lead as any).org_id, (lead as any).branch_id, "automation", true, { lead: (lead as any).ref, leadId: (lead as any).id, name: (lead as any).name, flow: (auto as any).name, automationId: (auto as any).id });
    await afterRunNotices(auto, config, current, log);
  } catch (error: any) {
    await supabase.from("social_lead_automation_runs").update({ status: "failed", log, error: String(error?.message ?? error).slice(0, 400), finished_at: new Date().toISOString() }).eq("id", run.id);
    logger.warn("automation run failed", { run: run.id, error: error?.message ?? String(error) });
  }
}

async function variablesFor(lead: any, config: AutomationConfig) {
  let price = "";
  if (lead.product_id) {
    const { data } = await supabase.from("product_packages").select("price, currency").eq("product_id", lead.package_id ? lead.product_id : lead.product_id).eq("active", true).order("display_order").limit(1);
    const p = (data ?? [])[0] as any;
    if (p) price = p.currency === "ZMW" ? `K${Math.round(Number(p.price)).toLocaleString()}` : naira(Number(p.price));
  }
  const { data: rep } = lead.assigned_to ? await supabase.from("users").select("name").eq("id", lead.assigned_to).maybeSingle() : { data: null };
  return {
    customer_name: String(lead.name ?? "").replace(/^@/, "").split(/\s+/)[0], name: String(lead.name ?? "").split(/\s+/)[0], phone: lead.phone ?? "", product: lead.product_interest ?? "",
    product_name: lead.product_interest ?? "", price, state: lead.state ?? "", order_id: lead.order_id ? `#${lead.order_id}` : "", rep_name: (rep as any)?.name ?? "",
    delivery_time: "1–3 working days", ...Object.fromEntries(config.settings.params.map((p) => [p.key, p.value]))
  } as Record<string, string>;
}

async function doAction(action: Action, lead: any, auto: any, config: AutomationConfig, settings: any, depth: number): Promise<{ ok: boolean; note: string; lead?: any }> {
  const c = action.config ?? {};
  const now = new Date().toISOString();
  switch (action.type) {
    case "send_message": {
      const prefs = cleanPrefs(settings.prefs);
      const body = c.kind === "template" || c.kind === "quick" ? prefs.templates.find((t) => t.id === c.templateId)?.body ?? "" : String(c.text ?? "");
      const text = fillVariables(body, await variablesFor(lead, config)).trim();
      if (!text) return { ok: false, note: "No message text" };
      if (!settings.manychat_api_key) return { ok: false, note: "ManyChat is not connected" };
      if (String(lead.manychat_contact_id).startsWith("manual-")) return { ok: false, note: "Lead added by hand: no chat" };
      const window = messagingWindow(lead.last_customer_message_at, Date.now());
      if (window.state !== "open") return { ok: false, note: window.state === "none" ? "Customer has not written yet" : "Outside the 24-hour window: automatic messages are not allowed" };
      const sent = await manychat.sendContent(settings.manychat_api_key, { subscriberId: lead.manychat_contact_id, platform: lead.platform, messages: [{ type: "text", text }] });
      await supabase.from("social_lead_messages").insert({ org_id: lead.org_id, branch_id: lead.branch_id, lead_id: lead.id, direction: "bot", kind: "text", body: text, sender_name: `Automation: ${auto.name}`, status: sent.ok ? "ok" : "failed", error: sent.ok ? null : sent.message });
      if (sent.ok) await supabase.from("social_leads").update({ last_message_preview: text.slice(0, 200), last_message_at: now }).eq("id", lead.id);
      return { ok: sent.ok, note: sent.ok ? "Message sent" : sent.message };
    }
    case "assign":
    case "route_lead": {
      let repId: string | null = c.repId ?? null;
      if (action.type === "route_lead" && Array.isArray(c.rules)) {
        const facts = await factsOf(lead);
        const hit = c.rules.find((r: any) => r?.repId && conditionsPass({ enabled: true, match: "all", rules: [{ id: "x", field: r.field ?? "state", op: r.op ?? "is", values: r.values ?? [] }], groups: [] }, facts));
        repId = hit?.repId ?? c.fallbackRepId ?? null;
      }
      if (!repId || c.mode === "rotation") {
        if (lead.assigned_to && c.mode === "rotation") return { ok: true, note: "Already with a rep (kept)" };
        const rep = await assignLead(settings, { ...lead, assigned_to: null }, "auto");
        if (!rep) return { ok: false, note: "No rep available right now" };
        const { data } = await supabase.from("social_leads").select("*").eq("id", lead.id).single();
        return { ok: true, note: `Assigned to ${rep.name}`, lead: data };
      }
      const { data: rep } = await supabase.from("users").select("id, name, active").eq("org_id", lead.org_id).eq("id", repId).maybeSingle();
      if (!rep || !(rep as any).active) return { ok: false, note: "That rep is not active" };
      const { data } = await supabase.from("social_leads").update({ assigned_to: repId, assigned_at: now, assigned_by: `automation:${auto.name}`, updated_at: now }).eq("id", lead.id).select("*").single();
      await systemMessage(lead, `${action.type === "route_lead" ? "Routed" : "Assigned"} to ${(rep as any).name} by automation “${auto.name}”.`);
      return { ok: true, note: `Assigned to ${(rep as any).name}`, lead: data };
    }
    case "add_tag": {
      const tags = [...new Set([...(lead.tags ?? []), ...(Array.isArray(c.tags) ? c.tags : [])].map((t: string) => String(t).trim()).filter(Boolean))].slice(0, 20);
      const { data } = await supabase.from("social_leads").update({ tags, updated_at: now }).eq("id", lead.id).select("*").single();
      return { ok: true, note: `Tags: ${tags.join(", ")}`, lead: data };
    }
    case "update_lead": {
      const patch: Record<string, unknown> = { updated_at: now };
      if (c.status && ["new", "in_conversation", "hot", "call_requested", "awaiting_customer", "follow_up", "on_hold", "lost"].includes(c.status)) patch.status = c.status;
      if (c.status === "lost") { patch.lost_reason = "Closed by automation"; patch.closed_at = now; patch.awaiting_reply_since = null; }
      if (typeof c.hot === "boolean") patch.hot = c.hot;
      if (c.fieldKey) patch.custom_fields = { ...(lead.custom_fields ?? {}), [String(c.fieldKey).toLowerCase().replace(/[^a-z0-9]/g, "")]: String(c.fieldValue ?? "") };
      const { data } = await supabase.from("social_leads").update(patch).eq("id", lead.id).select("*").single();
      return { ok: true, note: "Lead updated", lead: data };
    }
    case "trigger_automation": {
      if (depth >= 3) return { ok: false, note: "Too many automations in a row (stopped at 3)" };
      const { data: next } = await supabase.from("social_lead_automations").select("*").eq("id", String(c.automationId ?? "")).eq("org_id", lead.org_id).maybeSingle();
      if (!next || (next as any).kind !== "protohub" || (next as any).status !== "active") return { ok: false, note: "That automation is not active" };
      const nextConfig = cleanConfig((next as any).config);
      if (!conditionsPass(nextConfig.conditions, await factsOf(lead))) return { ok: true, note: `“${(next as any).name}” conditions not met` };
      const { data: run } = await supabase.from("social_lead_automation_runs").insert({ org_id: lead.org_id, branch_id: lead.branch_id, automation_id: (next as any).id, lead_id: lead.id, run_at: now }).select("*").single();
      if (run) await executeRun(run, depth + 1);
      return { ok: true, note: `Started “${(next as any).name}”` };
    }
    case "notify_team": {
      const text = fillVariables(String(c.message ?? "{{customer_name}} needs attention ({{product}})."), await variablesFor(lead, config));
      const ids = new Set<string>();
      if (c.assignedRep !== false && lead.assigned_to) ids.add(lead.assigned_to);
      const roles: string[] = Array.isArray(c.roles) ? c.roles : [];
      if (roles.length) {
        const { data } = await supabase.from("users").select("id").eq("org_id", lead.org_id).eq("active", true).in("role", roles);
        for (const u of (data ?? []) as any[]) ids.add(u.id);
      }
      if (!ids.size) return { ok: false, note: "Nobody to notify" };
      await notify(lead, [...ids], `${auto.name}: ${lead.name}`, text, c.push !== false);
      return { ok: true, note: `Notified ${ids.size}` };
    }
    case "webhook":
      return { ok: false, note: "Webhook is not available yet" };
    default:
      return { ok: false, note: "Unknown action" };
  }
}

async function notify(lead: any, ids: string[], title: string, message: string, push: boolean) {
  await supabase.from("system_notifications").insert(ids.map((id) => ({ org_id: lead.org_id, branch_id: lead.branch_id, recipient_id: id, type: "info", read: false, link: leadLink(lead.id), title: title.slice(0, 160), message: message.slice(0, 400) })));
  if (!push) return;
  const branding = await getOrgPushBranding(lead.org_id);
  await Promise.all(ids.map((id) => sendPushToUser(lead.org_id, id, { title: title.slice(0, 120), body: message.slice(0, 200), url: leadLink(lead.id), tag: `automation-${lead.id}-${Date.now()}`, kind: "info", brandName: branding.brandName, brandLogo: branding.brandLogo }).catch(() => undefined)));
}

/** Step 5 › Notifications: tell the Owner / Admins and the rep that it ran. */
async function afterRunNotices(auto: any, config: AutomationConfig, lead: any, log: any[]) {
  const ids = new Set<string>();
  if (config.settings.notifyOwner) {
    const { data } = await supabase.from("users").select("id").eq("org_id", lead.org_id).eq("active", true).in("role", ["Owner", "Admin"]);
    for (const u of (data ?? []) as any[]) ids.add(u.id);
  }
  if (config.settings.notifyTeam && lead.assigned_to) ids.add(lead.assigned_to);
  if (!ids.size) return;
  const failed = log.filter((x) => !x.ok);
  await notify(lead, [...ids], `Automation ran: ${auto.name}`, `${lead.name} · ${failed.length ? `${failed.length} step(s) did not work: ${failed.map((x) => x.note).join("; ")}` : "every step done"}`, config.settings.channel === "inapp_push");
}

/** The Automations tab numbers for Protohub automations (last 7 days). */
export async function automationStats(automationIds: string[], sinceIso: string) {
  const out = new Map<string, { triggered: number; engaged: number; converted: number; conversion: number | null }>();
  if (!automationIds.length) return out;
  const { data: runs } = await supabase.from("social_lead_automation_runs").select("automation_id, lead_id, created_at").in("automation_id", automationIds).gte("created_at", sinceIso).limit(20000);
  const leadIds = [...new Set(((runs ?? []) as any[]).map((r) => r.lead_id))];
  const leads = new Map<string, any>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await supabase.from("social_leads").select("id, last_customer_message_at, order_id").in("id", leadIds.slice(i, i + 200));
    for (const l of (data ?? []) as any[]) leads.set(l.id, l);
  }
  for (const id of automationIds) {
    const mine = ((runs ?? []) as any[]).filter((r) => r.automation_id === id);
    const ids = [...new Set(mine.map((r) => r.lead_id))];
    const engaged = ids.filter((lid) => { const l = leads.get(lid); const first = mine.filter((r) => r.lead_id === lid).map((r) => r.created_at).sort()[0]; return l?.last_customer_message_at && l.last_customer_message_at > first; }).length;
    const converted = ids.filter((lid) => leads.get(lid)?.order_id).length;
    out.set(id, { triggered: mine.length, engaged, converted, conversion: ids.length ? Math.round((converted / ids.length) * 1000) / 10 : null });
  }
  return out;
}
