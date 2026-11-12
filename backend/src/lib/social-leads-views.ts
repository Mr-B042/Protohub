import { supabase } from "./supabase.js";
import { hideSilentOrders } from "./product-launch.js";
import { cleanPrefs, cleanSla, messagingWindow, OPEN_STATUSES, workingMsBetween } from "./social-leads-rules.js";
import { LEADERSHIP, hoursFor, loadLeadFor, openNow, settingsFor, type Actor } from "./social-leads.js";

// What the Social Leads Inbox tabs show (Bright, 12 Nov 2026, nine designs).
// A Sales Rep sees only the leads given to them; Owner / Admin / Manager see
// the branch. Every number comes from the leads, their orders and follow-ups:
// nothing is estimated.

const LEAD_COLS = "id, ref, name, profile_pic, platform, status, hot, lead_score, product_id, product_interest, assigned_to, assigned_at, unread_count, last_message_preview, last_message_at, last_customer_message_at, awaiting_reply_since, sla_stage, next_follow_up_at, follow_up_note, order_id, converted_at, created_at, campaign_name, source_label, phone, state, original_comment, first_response_seconds, first_customer_message_at, lost_reason, manychat_contact_id";

const scoped = (actor: Actor, query: any) => {
  query = query.eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
  return LEADERSHIP.has(actor.role) ? query : query.eq("assigned_to", actor.id);
};
const scopedFollowUps = (actor: Actor, query: any) => {
  query = query.eq("org_id", actor.orgId).eq("branch_id", actor.branchId);
  return LEADERSHIP.has(actor.role) ? query : query.eq("rep_id", actor.id);
};

// ── Filters ───────────────────────────────────────────────────────────────

export type Filters = { range: string; from: string | null; to: string; prevFrom: string | null; days: number; source: string; product: string; rep: string; status: string; q: string };
const LAGOS = 3_600_000;
const dayKey = (iso: string | number) => new Date((typeof iso === "number" ? iso : Date.parse(iso)) + LAGOS).toISOString().slice(0, 10);
const lagosMidnight = (key: string) => Date.parse(`${key}T00:00:00+01:00`);

export function filtersOf(q: Record<string, unknown>, fallbackRange = "7d"): Filters {
  const range = typeof q.range === "string" ? q.range : fallbackRange;
  const now = Date.now();
  const today = dayKey(now);
  let fromMs: number | null = null, toMs = now;
  if (range === "custom" && typeof q.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.from)) {
    fromMs = lagosMidnight(q.from);
    if (typeof q.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) toMs = Math.min(now, lagosMidnight(q.to) + 86_400_000 - 1);
  } else if (range === "today") fromMs = lagosMidnight(today);
  else if (range === "yesterday") { fromMs = lagosMidnight(today) - 86_400_000; toMs = lagosMidnight(today) - 1; }
  else if (range !== "all") {
    const days = range === "30d" ? 30 : range === "90d" ? 90 : 7;
    fromMs = lagosMidnight(today) - (days - 1) * 86_400_000;
  }
  const span = fromMs === null ? 0 : toMs - fromMs;
  const str = (k: string) => (typeof q[k] === "string" ? String(q[k]).slice(0, 80) : "all") || "all";
  return {
    range, from: fromMs === null ? null : new Date(fromMs).toISOString(), to: new Date(toMs).toISOString(),
    prevFrom: fromMs === null ? null : new Date(fromMs - span - 1).toISOString(), days: fromMs === null ? 0 : Math.max(1, Math.round(span / 86_400_000)),
    source: str("source"), product: str("product"), rep: str("rep"), status: str("status"), q: typeof q.q === "string" ? q.q.trim().replace(/[%,()]/g, " ").slice(0, 60) : ""
  };
}

/** The chip a lead shows (design labels): waiting for the rep beats its stored status. */
export function statusKey(lead: any): string {
  if (["order_created", "delivered", "lost", "on_hold"].includes(lead.status)) return lead.status;
  if (lead.next_follow_up_at && lead.next_follow_up_at <= new Date().toISOString()) return "follow_up_due";
  if (lead.awaiting_reply_since) return "awaiting_reply";
  if (lead.hot || lead.status === "hot") return "hot";
  return lead.status;
}

const matches = (lead: any, f: Filters, opts: { status?: boolean; q?: boolean } = {}) => {
  if (f.source !== "all" && lead.platform !== f.source) return false;
  if (f.product !== "all" && lead.product_id !== f.product) return false;
  if (f.rep !== "all" && (f.rep === "none" ? lead.assigned_to : lead.assigned_to !== f.rep)) return false;
  if (opts.status && f.status !== "all" && statusKey(lead) !== f.status && lead.status !== f.status) return false;
  if (opts.q && f.q) {
    const hay = `${lead.name} ${lead.ref} ${lead.phone ?? ""} ${lead.product_interest ?? ""} ${lead.last_message_preview ?? ""} ${lead.campaign_name ?? ""} ${lead.order_id ?? ""}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
};

// ── Loading ───────────────────────────────────────────────────────────────

async function loadLeads(actor: Actor, sinceIso?: string | null) {
  const out: any[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    let query = scoped(actor, supabase.from("social_leads").select(LEAD_COLS)).order("created_at", { ascending: false }).range(from, from + 999);
    if (sinceIso) query = query.gte("created_at", sinceIso);
    const { data, error } = await query;
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

type OrderRow = { id: string; status: string; amount: number; currency: string; created_at: string; product_name: string; package_name: string | null; state: string | null; upsell: boolean; customer: string };
async function ordersOf(ids: string[], role: string) {
  const out = new Map<string, OrderRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const query: any = supabase.from("orders").select("id, status, amount, currency, created_at, product_name, package_name, state, upsell_from_qty, upsell_to_qty, cross_sell_lines, customer").in("id", ids.slice(i, i + 200));
    const { data } = await hideSilentOrders(query, role);
    for (const row of (data ?? []) as any[]) {
      const cross = Array.isArray(row.cross_sell_lines) ? row.cross_sell_lines.length > 0 : false;
      out.set(String(row.id), { ...row, amount: Number(row.amount) || 0, upsell: cross || (Number(row.upsell_to_qty) || 0) > (Number(row.upsell_from_qty) || 0) });
    }
  }
  return out;
}

async function namesOf(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (!unique.length) return new Map<string, { name: string; avatar: string | null }>();
  const { data } = await supabase.from("users").select("id, name").in("id", unique);
  return new Map(((data ?? []) as any[]).map((row) => [String(row.id), { name: String(row.name ?? ""), avatar: null }]));
}

async function productInfo(orgId: string, ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  if (!unique.length) return new Map<string, { name: string; image: string | null }>();
  const { data } = await supabase.from("products").select("id, name, image_url").eq("org_id", orgId).in("id", unique);
  return new Map(((data ?? []) as any[]).map((p) => [String(p.id), { name: String(p.name), image: p.image_url ?? null }]));
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);
const pp = (now: number | null, before: number | null) => (now === null || before === null ? null : Math.round((now - before) * 10) / 10);

// ── The shared numbers ─────────────────────────────────────────────────────

function measure(leads: any[], orders: Map<string, OrderRow>) {
  const withOrder = leads.filter((l) => l.order_id && orders.has(String(l.order_id)));
  const delivered = withOrder.filter((l) => orders.get(String(l.order_id))!.status === "Delivered");
  const revenue = delivered.reduce((s, l) => s + orders.get(String(l.order_id))!.amount, 0);
  const responses = leads.map((l) => l.first_response_seconds).filter((s) => typeof s === "number") as number[];
  const upsells = withOrder.filter((l) => orders.get(String(l.order_id))!.upsell).length;
  return {
    total: leads.length,
    captured: leads.filter((l) => l.original_comment || l.status === "comment_captured").length,
    engaged: leads.filter((l) => l.first_customer_message_at).length,
    assigned: leads.filter((l) => l.assigned_to).length,
    qualified: leads.filter((l) => l.phone || l.hot || ["call_requested", "hot", "order_created", "delivered"].includes(l.status)).length,
    orders: withOrder.length,
    delivered: delivered.length,
    revenue,
    aov: delivered.length ? Math.round(revenue / delivered.length) : null,
    conversion: pct(withOrder.length, leads.length),
    deliveryRate: pct(delivered.length, withOrder.length),
    upsells, upsellRate: pct(upsells, withOrder.length),
    resolved: withOrder.length + leads.filter((l) => l.status === "lost").length,
    active: leads.filter((l) => OPEN_STATUSES.includes(l.status) && l.first_customer_message_at).length,
    avgResolutionSeconds: (() => { const xs = withOrder.filter((l) => l.converted_at && l.first_customer_message_at).map((l) => (Date.parse(l.converted_at) - Date.parse(l.first_customer_message_at)) / 1000); return xs.length ? Math.round(xs.reduce((x, y) => x + y, 0) / xs.length) : null; })(),
    avgResponseSeconds: responses.length ? Math.round(responses.reduce((a, b) => a + b, 0) / responses.length) : null
  };
}
type Measure = ReturnType<typeof measure>;
const naira = (n: number) => `₦${Math.round(n).toLocaleString("en-NG")}`;
const signed = (n: number | null, unit: string) => (n === null ? "" : ` (${n >= 0 ? "+" : ""}${n}${unit})`);

/** Everything Overview, Analytics, Team, Converted and the KPI cards need, for one filter. */
export async function stats(actor: Actor, q: Record<string, unknown>) {
  const f = filtersOf(q);
  const all = await loadLeads(actor, f.prevFrom);
  const filtered = all.filter((l) => matches(l, f));
  const orders = await ordersOf([...new Set(filtered.filter((l) => l.order_id).map((l) => String(l.order_id)))], actor.role);
  const now = filtered.filter((l) => !f.from || (l.created_at >= f.from && l.created_at <= f.to));
  const before = f.from ? filtered.filter((l) => l.created_at < f.from! && l.created_at >= f.prevFrom!) : [];
  const a = measure(now, orders), b = measure(before, orders);
  const card = (key: keyof Measure, rate = false) => ({ value: a[key], change: f.from ? (rate ? pp(a[key] as number | null, b[key] as number | null) : change((a[key] as number) ?? 0, (b[key] as number) ?? 0)) : null, unit: rate ? "pp" : "%" });

  const firstDay = f.from ? dayKey(f.from) : now.length ? dayKey(now[now.length - 1].created_at) : dayKey(Date.now());
  const days: Array<{ day: string; leads: number; engaged: number; orders: number; delivered: number }> = [];
  for (let d = lagosMidnight(firstDay); d <= Date.parse(f.to) && days.length < 400; d += 86_400_000) days.push({ day: dayKey(d), leads: 0, engaged: 0, orders: 0, delivered: 0 });
  const dayIndex = new Map(days.map((d, i) => [d.day, i]));
  for (const lead of now) {
    const i = dayIndex.get(dayKey(lead.created_at));
    if (i === undefined) continue;
    days[i].leads += 1;
    if (lead.first_customer_message_at) days[i].engaged += 1;
    const order = lead.order_id ? orders.get(String(lead.order_id)) : null;
    if (order) { days[i].orders += 1; if (order.status === "Delivered") days[i].delivered += 1; }
  }

  const groupBy = (key: (l: any) => string) => {
    const map = new Map<string, any[]>();
    for (const lead of now) map.set(key(lead), [...(map.get(key(lead)) ?? []), lead]);
    return map;
  };
  const sources = ["facebook", "instagram", "messenger"].map((key) => ({ key, count: now.filter((l) => l.platform === key).length }));

  const pinfo = await productInfo(actor.orgId, now.map((l) => l.product_id));
  const products = [...groupBy((l) => l.product_id ?? `name:${l.product_interest ?? ""}`).entries()].map(([key, rows]) => {
    const m = measure(rows, orders);
    const info = key.startsWith("name:") ? null : pinfo.get(key);
    return { id: key.startsWith("name:") ? null : key, name: info?.name ?? (key.slice(5) || "Not known"), image: info?.image ?? null, leads: m.total, engaged: m.engaged, orders: m.orders, delivered: m.delivered, revenue: m.revenue, conversion: m.conversion, pct: pct(m.total, a.total) };
  }).sort((x, y) => y.revenue - x.revenue || y.leads - x.leads);

  const names = await namesOf(now.map((l) => l.assigned_to));
  const { data: fups } = await scopedFollowUps(actor, supabase.from("social_lead_follow_ups").select("lead_id, rep_id, status, due_at, done_at")).gte("created_at", f.from ?? "1970-01-01");
  const fupRows = (fups ?? []) as any[];
  const nowIso = new Date().toISOString();
  const reps = [...groupBy((l) => l.assigned_to ?? "").entries()].filter(([id]) => id).map(([id, rows]) => {
    const m = measure(rows, orders);
    const mine = fupRows.filter((x) => x.rep_id === id);
    const productCounts = new Map<string, number>();
    for (const l of rows) if (l.product_interest) productCounts.set(l.product_interest, (productCounts.get(l.product_interest) ?? 0) + 1);
    return {
      id, name: names.get(id)?.name ?? "Rep", avatar: names.get(id)?.avatar ?? null, assigned: m.total, engaged: m.engaged, qualified: m.qualified, orders: m.orders, delivered: m.delivered,
      conversion: m.conversion, deliveryRate: m.deliveryRate, aov: m.aov, upsells: m.upsells, upsellRate: m.upsellRate, revenue: m.revenue, avgResponseSeconds: m.avgResponseSeconds,
      open: rows.filter((l) => OPEN_STATUSES.includes(l.status)).length, lost: rows.filter((l) => l.status === "lost").length,
      overdue: rows.filter((l) => OPEN_STATUSES.includes(l.status) && ["red", "renotify", "escalate", "reassign"].includes(l.sla_stage)).length,
      sources: { facebook: rows.filter((l) => l.platform === "facebook").length, instagram: rows.filter((l) => l.platform === "instagram").length, messenger: rows.filter((l) => l.platform === "messenger").length },
      followUps: { done: mine.filter((x) => x.status === "done").length, scheduled: mine.filter((x) => x.status === "scheduled").length, overdue: mine.filter((x) => x.status === "scheduled" && x.due_at < nowIso).length },
      products: [...productCounts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([name, count]) => ({ name, count })),
      responseBuckets: [120, 300, 600, Infinity].map((max, i, arr) => rows.filter((l) => typeof l.first_response_seconds === "number" && l.first_response_seconds >= (i ? arr[i - 1] : 0) && l.first_response_seconds < max).length)
    };
  }).sort((x, y) => y.revenue - x.revenue || y.delivered - x.delivered || x.name.localeCompare(y.name));

  const live = now.filter((l) => OPEN_STATUSES.includes(l.status));
  const statusBreakdown = [
    { key: "in_conversation", label: "In Conversation", count: live.filter((l) => l.status === "in_conversation").length },
    { key: "awaiting_customer", label: "Awaiting Customer", count: live.filter((l) => l.status === "awaiting_customer").length },
    { key: "follow_up_due", label: "Follow-up Due", count: live.filter((l) => l.next_follow_up_at && l.next_follow_up_at <= nowIso).length },
    { key: "hot", label: "Hot Leads", count: live.filter((l) => l.hot || l.status === "hot").length },
    { key: "converted", label: "Converted (Orders)", count: a.orders }
  ].map((row) => ({ ...row, pct: pct(row.count, a.total) }));

  const states = [...groupBy((l) => (l.state || (l.order_id ? orders.get(String(l.order_id))?.state : "") || "").trim()).entries()]
    .filter(([state]) => state).map(([state, rows]) => ({ state, count: rows.length, pct: pct(rows.length, a.total) })).sort((x, y) => y.count - x.count).slice(0, 5);
  const campaigns = [...groupBy((l) => l.campaign_name || "").entries()].filter(([c]) => c).map(([name, rows]) => {
    const m = measure(rows, orders);
    const top = rows.find((l) => l.product_id && pinfo.get(l.product_id));
    return { name, image: top ? pinfo.get(top.product_id)!.image : null, leads: m.total, engaged: m.engaged, orders: m.orders, delivered: m.delivered, revenue: m.revenue, conversion: m.conversion };
  }).sort((x, y) => y.revenue - x.revenue || y.leads - x.leads);

  // Converted by product (the Converted tab donut) and the response-time spread.
  const convertedByProduct = products.filter((p) => p.orders > 0).map((p) => ({ name: p.name, image: p.image, count: p.orders, pct: pct(p.orders, a.orders) }));
  const allResponses = now.map((l) => l.first_response_seconds).filter((s) => typeof s === "number") as number[];
  const responseTimes = [{ label: "Under 2 min", max: 120 }, { label: "2–5 min", max: 300 }, { label: "5–10 min", max: 600 }, { label: "10–20 min", max: 1200 }, { label: "Over 20 min", max: Infinity }]
    .map((bucket, i, arr) => ({ label: bucket.label, count: allResponses.filter((s) => s >= (i ? arr[i - 1].max : 0) && s < bucket.max).length }));

  const insights: string[] = [];
  if (f.from && b.total > 0) insights.push(`Leads ${a.total >= b.total ? "increased" : "fell"} by ${Math.abs(change(a.total, b.total) ?? 0)}% (${a.total.toLocaleString()} vs ${b.total.toLocaleString()} the period before).`);
  if (f.from && a.conversion !== null && b.conversion !== null) insights.push(`Lead-to-order conversion is ${a.conversion}%${signed(pp(a.conversion, b.conversion), "pp")}.`);
  if (a.delivered) insights.push(`${a.delivered} delivered order${a.delivered === 1 ? "" : "s"}: ${naira(a.revenue)} revenue${f.from && b.revenue ? signed(change(a.revenue, b.revenue), "%") : ""}.`);
  if (a.deliveryRate !== null) insights.push(`Delivery rate is ${a.deliveryRate}%${f.from ? signed(pp(a.deliveryRate, b.deliveryRate), "pp") : ""}.`);
  if (products[0] && a.revenue > 0 && products[0].revenue > 0) insights.push(`${products[0].name} brought ${pct(products[0].revenue, a.revenue)}% of delivered revenue.`);
  else if (products[0] && a.total) insights.push(`${products[0].name} brought ${products[0].pct}% of all leads (${products[0].leads}).`);
  const bestRep = [...reps].filter((r) => (r.conversion ?? 0) > 0).sort((x, y) => (y.conversion ?? 0) - (x.conversion ?? 0) || y.revenue - x.revenue)[0];
  if (bestRep && LEADERSHIP.has(actor.role)) insights.push(`Best call rep: ${bestRep.name} (${bestRep.conversion}% conversion, ${naira(bestRep.revenue)} delivered).`);

  const activeReps = LEADERSHIP.has(actor.role)
    ? (await supabase.from("users").select("id", { count: "exact", head: true }).eq("org_id", actor.orgId).eq("role", "Sales Rep").eq("active", true).eq("is_demo", false).eq("round_robin_excluded", false)).count ?? 0
    : 1;

  return {
    filters: { range: f.range, from: f.from, to: f.to, days: f.days, source: f.source, product: f.product, rep: f.rep },
    cards: {
      total: card("total"), captured: card("captured"), engaged: card("engaged"), assigned: card("assigned"), qualified: card("qualified"), orders: card("orders"), delivered: card("delivered"), revenue: card("revenue"),
      aov: card("aov"), conversion: card("conversion", true), deliveryRate: card("deliveryRate", true), upsellRate: card("upsellRate", true),
      avgResponseSeconds: { value: a.avgResponseSeconds, change: f.from ? change(a.avgResponseSeconds ?? 0, b.avgResponseSeconds ?? 0) : null, unit: "%" },
      resolved: card("resolved"), active: card("active"),
      avgResolutionSeconds: { value: a.avgResolutionSeconds, change: f.from ? change(a.avgResolutionSeconds ?? 0, b.avgResolutionSeconds ?? 0) : null, unit: "%" }
    },
    funnel: { captured: a.total, engaged: a.engaged, qualified: a.qualified, orders: a.orders, delivered: a.delivered, assigned: a.assigned },
    days, sources, products, convertedByProduct, responseTimes,
    reps: LEADERSHIP.has(actor.role) ? reps : reps.filter((r) => r.id === actor.id),
    unassigned: now.filter((l) => !l.assigned_to).length, activeReps,
    statusBreakdown, states, campaigns, insights,
    nextActions: {
      unread: live.filter((l) => l.unread_count > 0 || l.awaiting_reply_since).length,
      pendingFollowUps: live.filter((l) => l.next_follow_up_at).length,
      hotLeads: live.filter((l) => l.hot || l.status === "hot").length
    }
  };
}

// ── Header / badge ────────────────────────────────────────────────────────

export async function header(actor: Actor) {
  const settings = await settingsFor(actor.orgId, actor.branchId);
  const prefs = cleanPrefs(settings.prefs);
  const nowIso = new Date().toISOString();
  const [{ count: inbox }, { count: followUpsDue }] = await Promise.all([
    scoped(actor, supabase.from("social_leads").select("id", { count: "exact", head: true })).in("status", OPEN_STATUSES).or("unread_count.gt.0,awaiting_reply_since.not.is.null"),
    scoped(actor, supabase.from("social_leads").select("id", { count: "exact", head: true })).in("status", OPEN_STATUSES).lte("next_follow_up_at", nowIso)
  ]);
  return {
    connection: { manychat: Boolean(settings.manychat_api_key && settings.connected_at), pageName: settings.manychat_page_name, facebook: settings.facebook_connected, instagram: settings.instagram_connected, lastEventAt: settings.last_event_at },
    counts: { inbox: inbox ?? 0, followUpsDue: followUpsDue ?? 0 },
    prefs: { inboxName: prefs.inboxName, templates: prefs.templates, allowRepResumeBot: prefs.allowRepResumeBot },
    me: { id: actor.id, role: actor.role, leadership: LEADERSHIP.has(actor.role) }
  };
}

export async function badge(actor: Actor) {
  const { count } = await scoped(actor, supabase.from("social_leads").select("id", { count: "exact", head: true }))
    .in("status", OPEN_STATUSES).or("unread_count.gt.0,awaiting_reply_since.not.is.null");
  return { count: count ?? 0 };
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export const FILTERS = ["all", "mine", "unassigned", "unread", "new", "hot", "awaiting", "awaiting_reply", "follow_up", "overdue", "converted", "closed"] as const;

const listRow = (r: any, names?: Map<string, { name: string; avatar: string | null }>) => ({
  id: r.id, ref: r.ref, name: r.name, profilePic: r.profile_pic, platform: r.platform, status: r.status, chip: statusKey(r), hot: r.hot, score: r.lead_score,
  productId: r.product_id, product: r.product_interest, preview: r.last_message_preview, lastMessageAt: r.last_message_at, unread: r.unread_count,
  awaitingSince: r.awaiting_reply_since, slaStage: r.sla_stage, followUpAt: r.next_follow_up_at, followUpNote: r.follow_up_note, orderId: r.order_id, assignedTo: r.assigned_to,
  assignedName: r.assigned_to ? names?.get(r.assigned_to)?.name ?? "" : null, assignedAvatar: r.assigned_to ? names?.get(r.assigned_to)?.avatar ?? null : null,
  createdAt: r.created_at, campaign: r.campaign_name, source: r.source_label, phone: r.phone, state: r.state, lostReason: r.lost_reason, convertedAt: r.converted_at,
  manual: String(r.manychat_contact_id ?? "").startsWith("manual-")
});

export async function conversations(actor: Actor, filter: unknown, search: unknown) {
  const f = FILTERS.includes(filter as any) ? filter as typeof FILTERS[number] : "all";
  const nowIso = new Date().toISOString();
  let query = scoped(actor, supabase.from("social_leads").select(LEAD_COLS)).order("last_message_at", { ascending: false, nullsFirst: false }).limit(300);
  if (f === "mine") query = query.eq("assigned_to", actor.id);
  if (f === "unassigned") query = query.is("assigned_to", null);
  if (f === "unread") query = query.gt("unread_count", 0);
  if (f === "new") query = query.in("status", ["new", "engaged"]);
  if (f === "hot") query = query.or("hot.eq.true,status.eq.hot").in("status", OPEN_STATUSES);
  if (f === "awaiting") query = query.eq("status", "awaiting_customer");
  if (f === "awaiting_reply") query = query.not("awaiting_reply_since", "is", null);
  if (f === "follow_up") query = query.lte("next_follow_up_at", nowIso);
  if (f === "overdue") query = query.in("sla_stage", ["red", "renotify", "escalate", "reassign"]);
  if (f === "converted") query = query.in("status", ["order_created", "delivered"]);
  if (f === "closed") query = query.eq("status", "lost");
  if (!["converted", "closed"].includes(f)) query = query.neq("status", "lost");
  const q = String(search ?? "").trim().replace(/[%,()]/g, " ").slice(0, 60);
  if (q) query = query.or(`name.ilike.%${q}%,last_message_preview.ilike.%${q}%,product_interest.ilike.%${q}%,ref.ilike.%${q}%,phone.ilike.%${q}%`);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const names = await namesOf(rows.map((r) => r.assigned_to));
  // Settings › Working Hours: a waiting, unassigned lead outside hours reads "Pending (Off-Hours)".
  const sset = await settingsFor(actor.orgId, actor.branchId);
  const h = await hoursFor(sset);
  const closed = h.prefs.pendingOffHours && !openNow(h.rules);
  if (closed) for (const r of rows) if (!r.assigned_to && OPEN_STATUSES.includes(r.status)) r.__offHours = true;
  const all = await loadLeads(actor);
  const live = all.filter((r) => r.status !== "lost");
  const counts = {
    all: live.length, mine: live.filter((r) => r.assigned_to === actor.id).length, unassigned: live.filter((r) => !r.assigned_to).length,
    unread: live.filter((r) => r.unread_count > 0).length, hot: live.filter((r) => (r.hot || r.status === "hot") && OPEN_STATUSES.includes(r.status)).length,
    awaitingReply: live.filter((r) => r.awaiting_reply_since && OPEN_STATUSES.includes(r.status)).length
  };
  return { filter: f, counts, conversations: rows.map((r) => ({ ...listRow(r, names), ...(r.__offHours ? { chip: "pending_off_hours" } : {}) })) };
}

export async function leadDetail(actor: Actor, leadId: string) {
  const lead = await loadLeadFor(actor, leadId);
  const settings = await settingsFor(lead.org_id, lead.branch_id);
  const [messagesRes, hours, names, fups] = await Promise.all([
    supabase.from("social_lead_messages").select("id, direction, kind, body, payload, sender_name, status, error, created_at").eq("lead_id", lead.id).order("created_at", { ascending: true }).limit(1000),
    hoursFor(settings),
    namesOf([lead.assigned_to]),
    supabase.from("social_lead_follow_ups").select("id, due_at, note, status, done_at, created_by_name, auto, created_at").eq("lead_id", lead.id).order("due_at", { ascending: false }).limit(50)
  ]);
  const sla = cleanSla(settings.sla);
  const waitingSeconds = lead.awaiting_reply_since ? Math.round(workingMsBetween(Date.parse(lead.awaiting_reply_since), Date.now(), hours.rules) / 1000) : null;
  const last10 = String(lead.phone ?? "").replace(/\D/g, "").slice(-10);
  let history: any[] = [];
  if (last10.length === 10) {
    const query: any = supabase.from("orders").select("id, status, amount, currency, created_at, product_name, package_name").eq("org_id", lead.org_id).ilike("phone", `%${last10}`);
    const { data } = await hideSilentOrders(query, actor.role).order("created_at", { ascending: false }).limit(20);
    history = data ?? [];
  }
  if (lead.order_id && !history.some((o) => String(o.id) === String(lead.order_id))) {
    const query: any = supabase.from("orders").select("id, status, amount, currency, created_at, product_name, package_name").eq("id", lead.order_id);
    const { data } = await hideSilentOrders(query, actor.role).maybeSingle();
    if (data) history.unshift(data);
  }
  const productRes = lead.product_id ? await supabase.from("products").select("id, name, image_url, description").eq("id", lead.product_id).maybeSingle() : { data: null as any };
  const packagesRes = lead.product_id ? await supabase.from("product_packages").select("id, name, price, currency, quantity").eq("product_id", lead.product_id).eq("active", true).order("display_order") : { data: [] as any[] };
  return {
    lead: {
      ...listRow(lead, names), instagramUsername: lead.instagram_username, whatsapp: lead.whatsapp, email: lead.email, address: lead.address,
      packageId: lead.package_id, offerText: lead.offer_text, adName: lead.ad_name, originalComment: lead.original_comment, botPaused: lead.bot_paused,
      firstSeenAt: lead.created_at, lastCustomerMessageAt: lead.last_customer_message_at, firstResponseSeconds: lead.first_response_seconds,
      manychatUrl: lead.manychat_inbox_url, contactId: lead.manychat_contact_id, tags: lead.tags ?? [], customFields: lead.custom_fields ?? {}
    },
    messages: messagesRes.data ?? [],
    window: messagingWindow(lead.last_customer_message_at, Date.now()),
    clock: { waitingSeconds, sla, stage: lead.sla_stage },
    history: history.map((o) => ({ id: o.id, status: o.status, amount: Number(o.amount) || 0, currency: o.currency, createdAt: o.created_at, product: o.product_name, packageName: o.package_name })),
    followUps: fups.data ?? [],
    product: productRes.data ? { id: productRes.data.id, name: productRes.data.name, image: productRes.data.image_url, description: productRes.data.description } : null,
    packages: (packagesRes.data ?? []).map((p: any) => ({ id: p.id, name: p.name, price: Number(p.price) || 0, currency: p.currency, quantity: p.quantity })),
    connected: Boolean(settings.manychat_api_key)
  };
}

export async function messagesSince(actor: Actor, leadId: string, since: string | null) {
  const lead = await loadLeadFor(actor, leadId);
  let query = supabase.from("social_lead_messages").select("id, direction, kind, body, payload, sender_name, status, error, created_at").eq("lead_id", lead.id).order("created_at", { ascending: true }).limit(200);
  if (since && !Number.isNaN(Date.parse(since))) query = query.gt("created_at", since);
  const { data } = await query;
  return { messages: data ?? [], unread: lead.unread_count, status: lead.status, awaitingSince: lead.awaiting_reply_since };
}

// ── All Leads / Converted lists ─────────────────────────────────────────────

const page = (rows: any[], q: Record<string, unknown>) => {
  const size = [10, 25, 50, 100].includes(Number(q.size)) ? Number(q.size) : 25;
  const p = Math.max(1, Math.min(Math.ceil(rows.length / size) || 1, Number(q.page) || 1));
  return { page: p, size, total: rows.length, slice: rows.slice((p - 1) * size, p * size) };
};

async function leadsMatching(actor: Actor, q: Record<string, unknown>) {
  const f = filtersOf(q);
  const all = await loadLeads(actor, f.from);
  return all.filter((l) => (!f.from || (l.created_at >= f.from && l.created_at <= f.to)) && matches(l, f, { status: true, q: true }));
}

export async function leadsTable(actor: Actor, q: Record<string, unknown>) {
  const rows = await leadsMatching(actor, q);
  const pg = page(rows, q);
  const [names, pinfo] = await Promise.all([namesOf(pg.slice.map((r) => r.assigned_to)), productInfo(actor.orgId, pg.slice.map((r) => r.product_id))]);
  return { page: pg.page, size: pg.size, total: pg.total, leads: pg.slice.map((r) => ({ ...listRow(r, names), productImage: r.product_id ? pinfo.get(r.product_id)?.image ?? null : null })) };
}

export async function leadsExport(actor: Actor, q: Record<string, unknown>) {
  const rows = await leadsMatching(actor, q);
  const names = await namesOf(rows.map((r) => r.assigned_to));
  return { rows: rows.map((r) => listRow(r, names)) };
}

export async function convertedLeads(actor: Actor, q: Record<string, unknown>) {
  const f = filtersOf(q);
  const all = await loadLeads(actor);
  let rows = all.filter((l) => l.order_id && (!f.from || (l.converted_at && l.converted_at >= f.from && l.converted_at <= f.to)) && matches(l, f, { q: true }));
  const orders = await ordersOf(rows.map((r) => String(r.order_id)), actor.role);
  rows = rows.filter((r) => orders.has(String(r.order_id)));
  const tab = q.tab === "delivered" ? "delivered" : q.tab === "pending" ? "pending" : "all";
  const delivered = rows.filter((r) => orders.get(String(r.order_id))!.status === "Delivered");
  const pending = rows.filter((r) => !["Delivered", "Cancelled", "Failed"].includes(orders.get(String(r.order_id))!.status));
  let list = tab === "delivered" ? delivered : tab === "pending" ? pending : rows;
  if (f.status !== "all") list = list.filter((r) => orders.get(String(r.order_id))!.status === f.status);
  list = [...list].sort((x, y) => String(y.converted_at ?? "").localeCompare(String(x.converted_at ?? "")));
  const pg = page(list, q);
  const [names, pinfo] = await Promise.all([namesOf(pg.slice.map((r) => r.assigned_to)), productInfo(actor.orgId, pg.slice.map((r) => r.product_id))]);
  return {
    counts: { all: rows.length, delivered: delivered.length, pending: pending.length },
    page: pg.page, size: pg.size, total: pg.total,
    leads: pg.slice.map((r) => {
      const o = orders.get(String(r.order_id))!;
      return { ...listRow(r, names), productImage: r.product_id ? pinfo.get(r.product_id)?.image ?? null : null, order: { id: o.id, status: o.status, amount: o.amount, currency: o.currency, product: o.product_name, packageName: o.package_name } };
    })
  };
}

// ── Follow-ups ────────────────────────────────────────────────────────────

export async function followUps(actor: Actor, q: Record<string, unknown>) {
  const f = filtersOf(q, "all");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const todayKey = dayKey(nowMs);
  const todayStart = new Date(lagosMidnight(todayKey)).toISOString(), todayEnd = new Date(lagosMidnight(todayKey) + 86_400_000).toISOString();
  const { data, error } = await scopedFollowUps(actor, supabase.from("social_lead_follow_ups").select("id, lead_id, due_at, note, status, done_at, rep_id, created_at, auto")).order("due_at", { ascending: true }).limit(10000);
  if (error) throw error;
  const fups = (data ?? []) as any[];
  const leads = await loadLeads(actor);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const kpi = (from: string | null, to: string) => {
    const set = fups.filter((x) => x.status !== "cancelled" && (!from || (x.created_at >= from && x.created_at <= to)));
    const done = set.filter((x) => x.status === "done");
    return { total: set.length, done: done.length, conversion: pct(done.filter((x) => leadById.get(x.lead_id)?.order_id).length, done.length) };
  };
  const nowK = kpi(f.from, f.to), prevK = f.from ? kpi(f.prevFrom, f.from) : null;
  const open = fups.filter((x) => x.status === "scheduled" && leadById.has(x.lead_id));
  const overdue = open.filter((x) => x.due_at < nowIso);
  const dueToday = open.filter((x) => x.due_at >= nowIso && x.due_at < todayEnd);
  const doneToday = fups.filter((x) => x.status === "done" && x.done_at && x.done_at >= todayStart);
  const scheduled = open.filter((x) => x.due_at >= todayEnd);
  const stateOf = (x: any) => (x.status === "done" ? "completed" : x.due_at < nowIso ? "overdue" : x.due_at < todayEnd ? "due_today" : "scheduled");
  let list = fups.filter((x) => leadById.has(x.lead_id) && (f.status === "completed" ? x.status === "done" : x.status === "scheduled" && (f.status === "all" || stateOf(x) === f.status)));
  if (q.when === "today") list = list.filter((x) => x.due_at < todayEnd);
  if (q.when === "week") list = list.filter((x) => x.due_at < new Date(lagosMidnight(todayKey) + 7 * 86_400_000).toISOString());
  if (typeof q.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.day)) list = list.filter((x) => dayKey(x.due_at) === q.day);
  list = list.filter((x) => matches(leadById.get(x.lead_id), f, { q: true }));
  const pg = page(list, q);
  const [names, pinfo] = await Promise.all([namesOf(pg.slice.map((x) => leadById.get(x.lead_id)?.assigned_to)), productInfo(actor.orgId, pg.slice.map((x) => leadById.get(x.lead_id)?.product_id))]);
  const byDay = new Map<string, number>();
  for (const x of open) byDay.set(dayKey(x.due_at), (byDay.get(dayKey(x.due_at)) ?? 0) + 1);
  return {
    kpis: {
      total: { value: nowK.total, change: prevK ? change(nowK.total, prevK.total) : null },
      dueToday: { value: dueToday.length, change: null },
      overdue: { value: overdue.length, change: null },
      scheduled: { value: scheduled.length, change: null },
      completed: { value: nowK.done, change: prevK ? change(nowK.done, prevK.done) : null },
      conversion: { value: nowK.conversion, change: prevK ? pp(nowK.conversion, prevK.conversion) : null }
    },
    today: { completed: doneToday.length, dueToday: dueToday.length, overdue: overdue.length, total: doneToday.length + dueToday.length + overdue.length },
    upcoming: [...byDay.entries()].filter(([d]) => d > todayKey).sort().slice(0, 5).map(([day, count]) => ({ day, count })),
    calendar: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    page: pg.page, size: pg.size, total: pg.total,
    followUps: pg.slice.map((x) => {
      const lead = leadById.get(x.lead_id);
      return { id: x.id, dueAt: x.due_at, note: x.note, state: stateOf(x), auto: x.auto, doneAt: x.done_at, lead: { ...listRow(lead, names), productImage: lead.product_id ? pinfo.get(lead.product_id)?.image ?? null : null } };
    })
  };
}

// ── Automations ───────────────────────────────────────────────────────────

const slugOf = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "flow";

export async function automations(actor: Actor) {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const prevSince = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const [flowsRes, eventsRes] = await Promise.all([
    supabase.from("social_lead_automations").select("*").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).order("created_at"),
    supabase.from("social_lead_events").select("kind, ok, detail, created_at").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).gte("created_at", prevSince).order("created_at", { ascending: false }).limit(20000)
  ]);
  const events = (eventsRes.data ?? []) as any[];
  const leadIds = [...new Set(events.map((e) => e.detail?.leadId).filter(Boolean))] as string[];
  const leads = new Map<string, any>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await supabase.from("social_leads").select("id, first_customer_message_at, order_id").in("id", leadIds.slice(i, i + 200));
    for (const l of (data ?? []) as any[]) leads.set(l.id, l);
  }
  const perf = (rows: any[]) => {
    const ids = [...new Set(rows.map((e) => e.detail?.leadId).filter(Boolean))] as string[];
    const converted = ids.filter((id) => leads.get(id)?.order_id);
    return { triggered: rows.length, engaged: ids.filter((id) => leads.get(id)?.first_customer_message_at).length, converted: converted.length, conversion: pct(converted.length, ids.length) };
  };
  const recent = events.filter((e) => e.created_at >= since && e.ok);
  const before = events.filter((e) => e.created_at < since && e.ok);
  const flows = ((flowsRes.data ?? []) as any[]).map((flow) => ({
    id: flow.id, key: flow.flow_key, name: flow.name, description: flow.description, trigger: flow.trigger, status: flow.status, template: flow.template, manychatNs: flow.manychat_ns,
    ...perf(recent.filter((e) => e.detail?.flow && slugOf(String(e.detail.flow)) === flow.flow_key))
  }));
  const inbound = (rows: any[]) => rows.filter((e) => String(e.kind).startsWith("inbound.") && !e.detail?.skipped);
  const sent = (rows: any[]) => rows.filter((e) => e.kind === "inbound.bot" || e.kind === "send").length;
  const a = perf(inbound(recent)), b = perf(inbound(before));
  return {
    kpis: {
      active: { value: flows.filter((x) => x.status === "active").length, change: null },
      messagesSent: { value: sent(recent), change: change(sent(recent), sent(before)) },
      engaged: { value: a.engaged, change: change(a.engaged, b.engaged) },
      orders: { value: a.converted, change: change(a.converted, b.converted) },
      conversion: { value: a.conversion, change: pp(a.conversion, b.conversion) }
    },
    flows,
    activity: events.slice(0, 12).map((e) => ({ kind: e.kind, ok: e.ok, at: e.created_at, lead: e.detail?.lead ?? null, name: e.detail?.name ?? null, flow: e.detail?.flow ?? null, error: e.detail?.error ?? null, skipped: e.detail?.skipped ?? null }))
  };
}

export async function events(actor: Actor) {
  const { data } = await supabase.from("social_lead_events").select("id, kind, ok, detail, created_at").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).order("created_at", { ascending: false }).limit(200);
  return { events: data ?? [] };
}

export async function repsForTransfer(actor: Actor) {
  const { data } = await supabase.from("users").select("id, name, role, round_robin_excluded").eq("org_id", actor.orgId).eq("active", true).in("role", ["Sales Rep", "Manager", "Admin"]).eq("is_demo", false).order("name");
  return { reps: ((data ?? []) as any[]).map((u) => ({ id: u.id, name: u.name, role: u.role, avatar: null, inRotation: u.role === "Sales Rep" && !u.round_robin_excluded })) };
}

export async function productsForPicker(actor: Actor) {
  const { data } = await supabase.from("products").select("id, name, image_url").eq("org_id", actor.orgId).eq("branch_id", actor.branchId).eq("active", true).order("name");
  const ids = ((data ?? []) as any[]).map((p) => p.id);
  const { data: packs } = ids.length ? await supabase.from("product_packages").select("id, product_id, name, price, currency, quantity, display_order").in("product_id", ids).eq("active", true).order("display_order") : { data: [] as any[] };
  return {
    products: ((data ?? []) as any[]).map((p) => ({
      id: p.id, name: p.name, image: p.image_url ?? null,
      packages: ((packs ?? []) as any[]).filter((k) => k.product_id === p.id).map((k) => ({ id: k.id, name: k.name, price: Number(k.price) || 0, currency: k.currency, quantity: k.quantity }))
    }))
  };
}
