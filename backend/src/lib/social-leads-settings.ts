import { supabase } from "./supabase.js";
import { hideSilentOrders } from "./product-launch.js";
import { eligibleReps } from "./cart-assignment.js";
import { cleanPrefs, cleanSla, slaFor, slaRuleFor, workingMsBetween } from "./social-leads-rules.js";
import { hoursFor, settingsFor, type Actor } from "./social-leads.js";

// Numbers for the Settings sections (Bright's ten Settings designs, 12 Nov
// 2026). Everything here is measured; a tool Protohub does not have is
// reported as not available, never as connected.

const DAY = 86_400_000;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const pp = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((a - b) * 10) / 10);
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

async function leadsSince(actor: Actor, sinceIso: string, cols: string) {
  const out: any[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await supabase.from("social_leads").select(cols).eq("org_id", actor.orgId).eq("branch_id", actor.branchId).gte("created_at", sinceIso).range(from, from + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}
async function orderStatuses(ids: string[], role: string) {
  const out = new Map<string, { status: string; amount: number }>();
  for (let i = 0; i < ids.length; i += 200) {
    const query: any = supabase.from("orders").select("id, status, amount").in("id", ids.slice(i, i + 200));
    const { data } = await hideSilentOrders(query, role);
    for (const o of (data ?? []) as any[]) out.set(String(o.id), { status: o.status, amount: Number(o.amount) || 0 });
  }
  return out;
}

// ── Team & Assignment ─────────────────────────────────────────────────────

const TEAM_ROLES = ["Sales Rep", "Recovery Rep", "Sales Closer", "Manager", "Admin", "Owner"];
export async function teamSection(actor: Actor) {
  const now = Date.now();
  const since = new Date(now - 60 * DAY).toISOString(), mid = new Date(now - 30 * DAY).toISOString();
  const [usersRes, leads, reps] = await Promise.all([
    supabase.from("users").select("id, name, role, active, created_at, round_robin_excluded, is_head_of_sales_rep").eq("org_id", actor.orgId).eq("is_demo", false).in("role", TEAM_ROLES).order("name"),
    leadsSince(actor, since, "id, assigned_to, assigned_at, created_at, order_id, status, first_customer_message_at, first_response_at"),
    eligibleReps(actor.orgId, actor.branchId)
  ]);
  const users = ((usersRes.data ?? []) as any[]).filter((u) => u.active);
  const orders = await orderStatuses([...new Set(leads.filter((l) => l.order_id).map((l) => String(l.order_id)))], actor.role);
  const recent = leads.filter((l) => l.created_at >= mid), older = leads.filter((l) => l.created_at < mid);
  const measure = (rows: any[]) => {
    const engaged = rows.filter((l) => l.first_customer_message_at && l.assigned_to);
    const delivered = rows.filter((l) => l.order_id && orders.get(String(l.order_id))?.status === "Delivered");
    return {
      assigned: rows.filter((l) => l.assigned_to).length,
      response: pct(engaged.filter((l) => l.first_response_at).length, engaged.length),
      revenue: delivered.reduce((s, l) => s + (orders.get(String(l.order_id))?.amount ?? 0), 0)
    };
  };
  const a = measure(recent), b = measure(older);
  const members = users.map((u) => {
    const mine = recent.filter((l) => l.assigned_to === u.id);
    const withOrder = mine.filter((l) => l.order_id && orders.has(String(l.order_id)));
    const delivered = withOrder.filter((l) => orders.get(String(l.order_id))!.status === "Delivered");
    return { id: u.id, name: u.name, role: u.is_head_of_sales_rep ? "Head of Sales" : u.role, avatar: null, active: u.active, inRotation: u.role === "Sales Rep" && !u.round_robin_excluded, assigned: mine.length, converted: withOrder.length, deliveryRate: pct(delivered.length, withOrder.length) };
  }).sort((x, y) => y.assigned - x.assigned || x.name.localeCompare(y.name));
  const monthStart = new Date(new Date(now + 3_600_000).toISOString().slice(0, 7) + "-01T00:00:00+01:00").toISOString();
  const roles = ["Admin", "Manager", "Sales Rep", "Recovery Rep", "Sales Closer"].map((role) => ({ role, count: users.filter((u) => u.role === role).length }));
  const openByRep = new Map<string, number>();
  for (const l of leads) if (l.assigned_to && !["order_created", "delivered", "lost"].includes(l.status)) openByRep.set(l.assigned_to, (openByRep.get(l.assigned_to) ?? 0) + 1);
  const totalOpen = reps.reduce((s, r) => s + (openByRep.get(r.id) ?? 0), 0);
  return {
    kpis: {
      members: { value: users.length, change: users.filter((u) => u.created_at >= monthStart).length },
      activeReps: { value: reps.length },
      assigned: { value: a.assigned, change: change(a.assigned, b.assigned) },
      responseRate: { value: a.response, change: pp(a.response, b.response) },
      revenue: { value: a.revenue, change: change(a.revenue, b.revenue) }
    },
    members, roles,
    workload: reps.map((r) => ({ id: r.id, name: r.name, open: openByRep.get(r.id) ?? 0, pct: pct(openByRep.get(r.id) ?? 0, totalOpen) })).sort((x, y) => y.open - x.open)
  };
}

// ── Response & SLA ────────────────────────────────────────────────────────

export async function slaSection(actor: Actor) {
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const { rules, prefs } = await hoursFor(settings);
  const global = cleanSla(settings.sla);
  const now = Date.now();
  const since = new Date(now - 14 * DAY).toISOString(), mid = new Date(now - 7 * DAY).toISOString();
  const { data: leadRows } = await supabase.from("social_leads").select("id, hot, status, next_follow_up_at, converted_at, assigned_to, first_response_seconds, first_response_at")
    .eq("org_id", actor.orgId).eq("branch_id", actor.branchId).gte("last_message_at", since).limit(5000);
  const leads = new Map(((leadRows ?? []) as any[]).map((l) => [l.id, l]));
  const ids = [...leads.keys()];
  const msgs: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("social_lead_messages").select("lead_id, direction, sender_id, created_at").in("lead_id", ids.slice(i, i + 200)).in("direction", ["in", "out"]).gte("created_at", since).order("created_at").limit(20000);
    msgs.push(...(data ?? []));
  }
  // Each unanswered customer message → the rep's next reply.
  type Pair = { leadId: string; at: string; seconds: number; within: boolean; first: boolean; rep: string | null };
  const pairs: Pair[] = [];
  const byLead = new Map<string, any[]>();
  for (const m of msgs) byLead.set(m.lead_id, [...(byLead.get(m.lead_id) ?? []), m]);
  for (const [leadId, list] of byLead) {
    const lead = leads.get(leadId);
    let waitingSince: string | null = null, answered = false;
    for (const m of list) {
      if (m.direction === "in") { if (!waitingSince) waitingSince = m.created_at; continue; }
      if (!waitingSince) { answered = true; continue; }
      const seconds = Math.round(workingMsBetween(Date.parse(waitingSince), Date.parse(m.created_at), rules) / 1000);
      const sla = slaFor(slaRuleFor({ ...lead, returning: Boolean(lead?.converted_at) }, prefs.slaRules), answered, global);
      pairs.push({ leadId, at: m.created_at, seconds, within: seconds <= sla.red * 60, first: !answered, rep: m.sender_id ?? lead?.assigned_to ?? null });
      answered = true; waitingSince = null;
    }
  }
  const sum = (from: string, to: string) => {
    const set = pairs.filter((p) => p.at >= from && p.at < to);
    const leadIds = [...new Set(set.map((p) => p.leadId))];
    return {
      first: avg(set.filter((p) => p.first).map((p) => p.seconds)), total: avg(set.map((p) => p.seconds)),
      compliance: pct(set.filter((p) => p.within).length, set.length), within: set.filter((p) => p.within).length, breached: set.filter((p) => !p.within).length,
      convWithin: leadIds.filter((id) => set.filter((p) => p.leadId === id).every((p) => p.within)).length, conversations: leadIds.length
    };
  };
  const a = sum(mid, new Date(now + 1000).toISOString()), b = sum(since, mid);
  const days: Array<{ day: string; compliance: number | null }> = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now + 3_600_000 - i * DAY).toISOString().slice(0, 10);
    const set = pairs.filter((p) => new Date(Date.parse(p.at) + 3_600_000).toISOString().slice(0, 10) === d);
    days.push({ day: d, compliance: pct(set.filter((p) => p.within).length, set.length) });
  }
  const repIds = [...new Set(pairs.filter((p) => p.at >= mid && p.rep).map((p) => p.rep!))];
  const { data: users } = repIds.length ? await supabase.from("users").select("id, name, role").in("id", repIds) : { data: [] as any[] };
  const reps = ((users ?? []) as any[]).map((u) => {
    const set = pairs.filter((p) => p.at >= mid && p.rep === u.id);
    return { id: u.id, name: u.name, role: u.role, avatar: null, first: avg(set.filter((p) => p.first).map((p) => p.seconds)), total: avg(set.map((p) => p.seconds)), compliance: pct(set.filter((p) => p.within).length, set.length), conversations: new Set(set.map((p) => p.leadId)).size };
  }).sort((x, y) => (y.compliance ?? -1) - (x.compliance ?? -1));
  return {
    kpis: {
      firstResponse: { value: a.first, change: change(a.first ?? 0, b.first ?? 0) },
      totalResponse: { value: a.total, change: change(a.total ?? 0, b.total ?? 0) },
      compliance: { value: a.compliance, change: pp(a.compliance, b.compliance) },
      withinSla: { value: a.convWithin, of: a.conversations, change: b.conversations ? a.convWithin - b.convWithin : null }
    },
    within: a.within, breached: a.breached, days, reps
  };
}

// ── Integrations ──────────────────────────────────────────────────────────

export async function integrationsSection(actor: Actor) {
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const since = new Date(Date.now() - 7 * DAY).toISOString(), prev = new Date(Date.now() - 14 * DAY).toISOString();
  const [wa, tg, em, capi, ev, evPrev, evFail, lastCapi] = await Promise.all([
    supabase.from("whatsapp_settings").select("enabled, provider, connection_status, last_connected_at, cloud_api_verified_at").eq("org_id", actor.orgId).limit(5),
    supabase.from("telegram_bots").select("status, username, last_update_at, connected_at").eq("org_id", actor.orgId).maybeSingle(),
    supabase.from("email_settings").select("enabled, provider, api_key_public, updated_at").eq("org_id", actor.orgId).limit(5),
    supabase.from("meta_capi_configs").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("active", true),
    supabase.from("social_lead_events").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId).gte("created_at", since),
    supabase.from("social_lead_events").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId).gte("created_at", prev).lt("created_at", since),
    supabase.from("social_lead_events").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId).eq("ok", false).gte("created_at", since),
    supabase.from("meta_capi_events").select("created_at").eq("org_id", actor.orgId).order("created_at", { ascending: false }).limit(1).maybeSingle()
  ]);
  const waRow = ((wa.data ?? []) as any[]).find((r) => r.enabled) ?? (wa.data ?? [])[0] as any;
  const emRow = ((em.data ?? []) as any[]).find((r) => r.enabled) ?? (em.data ?? [])[0] as any;
  const tgRow = tg.data as any;
  const emailOn = Boolean(emRow?.enabled && (emRow?.api_key_public || process.env.MAILJET_API_PUBLIC));
  const cards = [
    { key: "manychat", name: "ManyChat", connected: Boolean(settings.manychat_api_key && settings.connected_at), description: "Capture & manage leads from Facebook & Instagram.", lastSync: settings.last_event_at, manage: "settings:integrations" },
    { key: "facebook", name: "Facebook (Meta)", connected: settings.facebook_connected, description: "Leads from Facebook comments and Messenger (Direct Meta or ManyChat).", lastSync: settings.last_event_at, manage: "settings:integrations" },
    { key: "instagram", name: "Instagram", connected: settings.instagram_connected, description: "Leads from Instagram DMs & comments (Direct Meta or ManyChat).", lastSync: settings.last_event_at, manage: "settings:integrations" },
    { key: "whatsapp", name: "WhatsApp", connected: waRow?.connection_status === "connected", description: waRow?.cloud_api_verified_at ? "WhatsApp Cloud API: order updates & reminders." : "Protohub's WhatsApp line: order updates & reminders (Cloud API not set up).", lastSync: waRow?.last_connected_at ?? null, manage: "page:WhatsApp" },
    { key: "telegram", name: "Telegram Bot", connected: tgRow?.status === "connected" || tgRow?.status === "active", description: "Internal alerts, task reminders & team updates.", lastSync: tgRow?.last_update_at ?? tgRow?.connected_at ?? null, manage: "page:Telegram Bot" },
    { key: "mailjet", name: emRow?.provider === "resend" ? "Resend" : "Mailjet", connected: emailOn, description: "Email marketing, automation & customer retention.", lastSync: emRow?.updated_at ?? null, manage: "page:Email Marketing" },
    { key: "sheets", name: "Google Sheets", connected: false, unavailable: true, description: "Sync orders, leads & performance. Not available in Protohub yet.", lastSync: null, manage: null },
    { key: "capi", name: "Meta Pixel & CAPI", connected: (capi.count ?? 0) > 0, description: "Track conversions, delivered orders & ad performance.", lastSync: (lastCapi.data as any)?.created_at ?? null, manage: "page:Tracking Hub" }
  ];
  const events7 = ev.count ?? 0, fails = evFail.count ?? 0;
  return {
    kpis: {
      connected: { value: cards.filter((c) => c.connected).length },
      available: { value: cards.filter((c) => !c.connected).length },
      dataSync: { value: events7, change: change(events7, evPrev.count ?? 0) },
      health: { value: events7 ? pct(events7 - fails, events7) : null, failed: fails }
    },
    cards,
    webhookUrl: `${(process.env.PUBLIC_BACKEND_URL || "https://protohub-production.up.railway.app").replace(/\/+$/, "")}/api/public/social-leads/manychat/${settings.webhook_secret}`,
    keyHint: settings.manychat_api_key ? `••••••••${settings.manychat_api_key.slice(-4)}` : null
  };
}

// ── Notifications (this person's) ─────────────────────────────────────────

const categoryOf = (type: string) => /overdue|failed|cancel|late|no_orders|low_funds|issue|stock/.test(type) ? "alerts" : /follow_up/.test(type) ? "reminders" : /order_|delivered|social_lead_new|social_lead_reply|cart|waybill/.test(type) ? "updates" : "announcements";
export async function notificationsSection(actor: Actor, category: string) {
  const since = new Date(Date.now() - 7 * DAY).toISOString(), prev = new Date(Date.now() - 14 * DAY).toISOString();
  const [listRes, unreadRes, weekRes, prevRes, tg] = await Promise.all([
    supabase.from("system_notifications").select("id, type, title, message, link, read, created_at").eq("recipient_id", actor.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("system_notifications").select("type").eq("recipient_id", actor.id).eq("read", false).limit(2000),
    supabase.from("system_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", actor.id).gte("created_at", since),
    supabase.from("system_notifications").select("id", { count: "exact", head: true }).eq("recipient_id", actor.id).gte("created_at", prev).lt("created_at", since),
    supabase.from("telegram_links").select("user_id").eq("user_id", actor.id).limit(1)
  ]);
  const unread = (unreadRes.data ?? []) as any[];
  const counts = { all: unread.length, alerts: 0, reminders: 0, updates: 0, announcements: 0 } as Record<string, number>;
  for (const n of unread) counts[categoryOf(String(n.type))] += 1;
  const items = ((listRes.data ?? []) as any[]).map((n) => ({ ...n, category: categoryOf(String(n.type)) })).filter((n) => category === "all" || n.category === category).slice(0, 60);
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const prefs = cleanPrefs(settings.prefs);
  const channels = [prefs.notifyInApp, prefs.notifyPush, (tg.data ?? []).length > 0].filter(Boolean).length;
  return {
    kpis: { unread: unread.length, week: { value: weekRes.count ?? 0, change: change(weekRes.count ?? 0, prevRes.count ?? 0) }, channels, telegramLinked: (tg.data ?? []).length > 0 },
    counts, items
  };
}
export async function markNotificationsRead(actor: Actor, ids: string[] | "all") {
  let q = supabase.from("system_notifications").update({ read: true }).eq("recipient_id", actor.id).eq("read", false);
  if (ids !== "all") q = q.in("id", ids.slice(0, 500));
  const { error } = await q;
  if (error) throw error;
  return { ok: true };
}

// ── Templates ─────────────────────────────────────────────────────────────

export async function templatesSection(actor: Actor) {
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const prefs = cleanPrefs(settings.prefs);
  const since = new Date(Date.now() - 7 * DAY).toISOString();
  const [{ count: sent }, { data: firsts }] = await Promise.all([
    supabase.from("social_lead_messages").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId).eq("direction", "out").gte("created_at", since),
    supabase.from("social_leads").select("first_response_seconds").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).gte("first_response_at", since).not("first_response_seconds", "is", null).limit(5000)
  ]);
  const usedWeek = Object.values(prefs.templateUsage).filter((u) => u.lastUsedAt && u.lastUsedAt >= since).reduce((s, u) => s + 0 + (u.count > 0 ? 1 : 0), 0);
  const usesWeek = Object.values(prefs.templateUsage).reduce((s, u) => s + (u.lastUsedAt && u.lastUsedAt >= since ? u.count : 0), 0);
  return {
    kpis: {
      total: prefs.templates.filter((t) => t.kind === "template").length,
      quick: prefs.templates.filter((t) => t.kind === "quick").length,
      categories: prefs.templateCategories.length,
      usageRate: pct(Math.min(usesWeek, sent ?? 0), sent ?? 0), usedWeek,
      avgResponse: avg(((firsts ?? []) as any[]).map((r) => Number(r.first_response_seconds)))
    },
    templates: prefs.templates.map((t) => ({ ...t, usage: prefs.templateUsage[t.id]?.count ?? 0, lastUsedAt: prefs.templateUsage[t.id]?.lastUsedAt ?? null })),
    categories: prefs.templateCategories
  };
}
export async function templateUsed(actor: Actor, id: string) {
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const prefs = cleanPrefs(settings.prefs);
  if (!prefs.templates.some((t) => t.id === id)) return { ok: false };
  const prev = prefs.templateUsage[id] ?? { count: 0, lastUsedAt: null };
  prefs.templateUsage[id] = { count: prev.count + 1, lastUsedAt: new Date().toISOString() };
  await supabase.from("social_lead_settings").update({ prefs }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
  return { ok: true };
}

// ── Access & Permissions ──────────────────────────────────────────────────

/** What each role can do in the Social Leads Inbox (enforced in routes/social-leads.ts). */
export const ROLE_PERMISSIONS: Record<string, Record<string, [boolean, boolean, boolean, boolean, boolean]>> = {
  "Sales Rep": { conversations: [true, true, true, false, false], status: [true, true, true, false, false], orders: [true, true, true, false, false], followUps: [true, true, true, false, false], customers: [true, false, false, false, false], notes: [true, true, true, false, false], products: [false, false, false, false, false], reports: [false, false, false, false, false], team: [false, false, false, false, false], settings: [false, false, false, false, false] },
  Manager: { conversations: [true, true, true, false, true], status: [true, true, true, false, true], orders: [true, true, true, false, true], followUps: [true, true, true, false, true], customers: [true, true, true, false, true], notes: [true, true, true, false, false], products: [true, false, false, false, false], reports: [true, false, false, false, true], team: [true, false, true, false, false], settings: [false, false, false, false, false] },
  Admin: { conversations: [true, true, true, true, true], status: [true, true, true, true, true], orders: [true, true, true, false, true], followUps: [true, true, true, true, true], customers: [true, true, true, false, true], notes: [true, true, true, true, false], products: [true, false, false, false, false], reports: [true, false, false, false, true], team: [true, true, true, false, true], settings: [true, true, true, false, true] },
  Owner: { conversations: [true, true, true, true, true], status: [true, true, true, true, true], orders: [true, true, true, true, true], followUps: [true, true, true, true, true], customers: [true, true, true, true, true], notes: [true, true, true, true, true], products: [true, true, true, true, true], reports: [true, true, true, true, true], team: [true, true, true, true, true], settings: [true, true, true, true, true] }
};
export async function accessSection(actor: Actor) {
  const { data } = await supabase.from("users").select("id, name, email, role, active, is_head_of_sales_rep, created_at").eq("org_id", actor.orgId).eq("is_demo", false).order("name");
  const users = (data ?? []) as any[];
  const roleNames = [...new Set(users.map((u) => u.role))].sort((a, b) => users.filter((u) => u.role === b).length - users.filter((u) => u.role === a).length);
  const settings = await settingsFor(actor.orgId, actor.branchId);
  return {
    kpis: { total: users.length, roles: roleNames.length, active: users.filter((u) => u.active).length, inactive: users.filter((u) => !u.active).length },
    roles: roleNames.map((role) => ({ role, count: users.filter((u) => u.role === role).length, canOpen: role === "Owner" || cleanPrefs(settings.prefs).roles.includes(role), permissions: ROLE_PERMISSIONS[role] ?? null })),
    users: users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, avatar: null, headOfSales: Boolean(u.is_head_of_sales_rep) }))
  };
}

// ── Advanced ──────────────────────────────────────────────────────────────

export async function advancedSection(actor: Actor) {
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const [leads, messages, events, integrations] = await Promise.all([
    supabase.from("social_leads").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId),
    supabase.from("social_lead_messages").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("branch_id", actor.branchId),
    supabase.from("social_lead_events").select("kind").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).gte("created_at", new Date(Date.now() - 7 * DAY).toISOString()).limit(5000),
    integrationsSection(actor)
  ]);
  const kinds = [...new Set(((events.data ?? []) as any[]).map((e) => String(e.kind)))];
  return {
    kpis: { integrations: integrations.kpis.connected.value, webhooks: settings.last_event_at ? 1 : 0, lastSync: settings.last_event_at, records: (leads.count ?? 0) + (messages.count ?? 0) },
    webhookUrl: integrations.webhookUrl,
    eventsSeen: kinds
  };
}
