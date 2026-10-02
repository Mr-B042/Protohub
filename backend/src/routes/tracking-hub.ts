import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";
import { testMetaCapiConnection } from "../lib/meta-capi.js";
import { campaignPurchases, checkDataset, datasetEventCounts } from "../lib/meta-graph.js";
import {
  ATTRIBUTION_FIELDS, PURCHASE_STATUS_LABEL, attributionCapture, domainOf, healthScore, humanMetaError, orderAdIds,
  pathOf, purchaseStatus, reconciliationVerdict, type HealthItem, type PurchaseStatus
} from "../lib/tracking-hub.js";

// Tracking Hub (Bright, 2 Oct 2026): data sources (Meta datasets), websites,
// tracking profiles, tracking links, the purchase event ledger, Meta-vs-
// Protohub reconciliation, diagnostics and settings. Owner only - it holds
// the Meta tokens. Rules in lib/tracking-hub.ts; Meta reads in lib/meta-graph.ts.
const router = Router();
router.use(requireAuth, requireRole("Owner"));

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const SECRET_MASK = "••••••••";
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const fail = (res: any, error: any, fallback: string) => res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
const branchOf = (req: Request) => {
  const branchId = req.user!.branchId;
  if (!branchId) throw httpError(400, "Open a branch first.");
  return branchId;
};
const startIso = (day: string) => new Date(`${day}T00:00:00+01:00`).toISOString();
const endIso = (day: string) => new Date(`${day}T23:59:59.999+01:00`).toISOString();
const dayOfIso = (iso: string) => lagosDateKey(iso);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

function periodOf(query: any) {
  const today = lagosDateKey();
  const to = typeof query.to === "string" && DATE_KEY.test(query.to) ? query.to : today;
  const from = typeof query.from === "string" && DATE_KEY.test(query.from) ? query.from : to;
  if (from > to) throw httpError(400, "The start date is after the end date.");
  const length = daysBetween(from, to);
  const compareTo = typeof query.compareTo === "string" && DATE_KEY.test(query.compareTo) ? query.compareTo : addDaysToDateKey(from, -1);
  const compareFrom = typeof query.compareFrom === "string" && DATE_KEY.test(query.compareFrom) ? query.compareFrom : addDaysToDateKey(compareTo, -(length - 1));
  return { from, to, compareFrom, compareTo };
}

// ---------------------------------------------------------------- loading

type OrderRow = {
  id: string; created_at: string; product_id: string | null; product_name: string | null; amount: number | null; currency: string | null; status: string | null;
  utm_source: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; referrer: string | null;
  form_context: Record<string, any> | null; review_hold: boolean | null;
};

/** Orders that came through a Protohub form (they carry the ad ids and tracking mode). */
async function formOrders(orgId: string, branchId: string, from: string, to: string): Promise<OrderRow[]> {
  const rows: OrderRow[] = [];
  for (let page = 0; page < 40; page += 1) {
    const { data, error } = await supabase.from("orders")
      .select("id, created_at, product_id, product_name, amount, currency, status, utm_source, utm_campaign, utm_content, utm_term, referrer, form_context, review_hold")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", startIso(from)).lte("created_at", endIso(to))
      .not("form_context", "is", null).order("id").range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as OrderRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows.filter((row) => row.form_context && Object.keys(row.form_context).length > 0 && row.review_hold !== true);
}

async function eventsFor(orgId: string, orderIds: string[]) {
  const server = new Map<string, any>();
  const delivered = new Map<string, any>();
  const browser = new Map<string, any>();
  for (let i = 0; i < orderIds.length; i += 300) {
    const chunk = orderIds.slice(i, i + 300);
    const [serverRes, browserRes] = await Promise.all([
      supabase.from("meta_capi_events").select("order_id, event_name, meta_event_name, event_id, status, http_status, message, test_mode, sent_at, attempts").eq("org_id", orgId).in("order_id", chunk),
      supabase.from("tracking_browser_events").select("order_id, event_id, pixel_id, page_url, page_domain, pixels_on_page, fired_at").eq("org_id", orgId).in("order_id", chunk)
    ]);
    if (serverRes.error) throw serverRes.error;
    if (browserRes.error) throw browserRes.error;
    for (const row of serverRes.data ?? []) (row.event_name === "Delivered" ? delivered : server).set(String(row.order_id), row);
    for (const row of browserRes.data ?? []) browser.set(String(row.order_id), row);
  }
  return { server, delivered, browser };
}

type LedgerStatus = PurchaseStatus | "page_pixel";
const LEDGER_LABEL: Record<LedgerStatus, string> = { ...PURCHASE_STATUS_LABEL, page_pixel: "Thank-you page" };

function ledgerRow(order: OrderRow, events: Awaited<ReturnType<typeof eventsFor>>) {
  const server = events.server.get(order.id) ?? null;
  const browser = events.browser.get(order.id) ?? null;
  const ctx = order.form_context ?? {};
  const mode = String(ctx.metaTrackingMode ?? "landing_page");
  let status: LedgerStatus = purchaseStatus({ serverStatus: server?.status ?? null, serverEventId: server?.event_id ?? null, browserEventId: browser?.event_id ?? null, serverTest: Boolean(server?.test_mode) });
  if (status === "not_tracked" && (mode === "landing_page" || mode === "")) status = "page_pixel";
  const ids = orderAdIds(order);
  return {
    orderId: order.id, createdAt: order.created_at, product: order.product_name ?? "", productId: order.product_id,
    website: domainOf(order.referrer) ?? domainOf(ctx.landingPageUrl) ?? null, source: order.utm_source ?? null,
    campaignId: ids.campaignId, adsetId: ids.adsetId, adId: ids.adId,
    value: Number(order.amount) || 0, currency: order.currency ?? "NGN", orderStatus: order.status,
    trackingMode: mode, trackingKey: ctx.metaTrackingKey ? String(ctx.metaTrackingKey) : null,
    browser: Boolean(browser), serverStatus: server?.status ?? null, serverTest: Boolean(server?.test_mode),
    eventId: server?.event_id ?? browser?.event_id ?? null,
    status, statusLabel: LEDGER_LABEL[status]
  };
}

function kpisOf(rows: ReturnType<typeof ledgerRow>[]) {
  const orders = rows.length;
  const purchaseEvents = rows.filter((row) => row.browser || (row.serverStatus && ["sent", "dry_run"].includes(row.serverStatus))).length;
  const browserEvents = rows.filter((row) => row.browser).length;
  const serverEvents = rows.filter((row) => row.serverStatus === "sent" || row.serverStatus === "dry_run").length;
  const deduped = rows.filter((row) => row.status === "deduped").length;
  // Orders on a Protohub-tracked link (browser / CAPI) with no Purchase at all.
  const unmatched = rows.filter((row) => row.trackingMode !== "landing_page" && row.trackingMode !== "" && row.status === "not_tracked").length;
  const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
  return {
    orders, purchaseEvents, browserEvents, serverEvents, deduped, unmatched,
    browserPct: pct(browserEvents, orders), serverPct: pct(serverEvents, orders), dedupRate: pct(deduped, purchaseEvents), unmatchedPct: pct(unmatched, orders)
  };
}

const presentSource = (row: any) => ({
  id: row.id, name: row.name, businessName: row.business_name, adAccountIds: row.ad_account_ids ?? [], pixelId: row.pixel_id,
  hasToken: Boolean(row.access_token), accessToken: row.access_token ? SECRET_MASK : "", testEventCode: row.test_event_code ?? "",
  isMain: row.is_main, status: row.status, lastCheckAt: row.last_check_at, lastCheckOk: row.last_check_ok, lastCheckMessage: row.last_check_message,
  metaStats: row.meta_stats ?? {}, metaStatsAt: row.meta_stats_at
});

async function loadBasics(orgId: string, branchId: string) {
  const [sources, websites, profiles, links] = await Promise.all([
    supabase.from("tracking_data_sources").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("is_main", { ascending: false }).order("name"),
    supabase.from("tracking_websites").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("domain"),
    supabase.from("tracking_profiles").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("name"),
    supabase.from("meta_capi_configs").select("*").eq("org_id", orgId).order("label")
  ]);
  for (const result of [sources, websites, profiles, links]) if (result.error) throw result.error;
  return { sources: sources.data ?? [], websites: websites.data ?? [], profiles: profiles.data ?? [], links: (links.data ?? []).filter((row: any) => !row.branch_id || row.branch_id === branchId) };
}

const STRATEGY_OF_MODE: Record<string, string> = { hybrid: "browser_capi", protohub: "capi_only", landing_page: "landing_page", off: "off" };
const MODE_OF_STRATEGY: Record<string, string> = { browser_capi: "hybrid", capi_only: "protohub", landing_page: "landing_page" };

// Health of each data source / website / link, shared by Overview + Diagnostics.
async function assess(orgId: string, branchId: string) {
  const basics = await loadBasics(orgId, branchId);
  const today = lagosDateKey();
  const weekAgo = addDaysToDateKey(today, -6);
  const orders = await formOrders(orgId, branchId, weekAgo, today);
  const events = await eventsFor(orgId, orders.map((order) => order.id));
  const rows = orders.map((order) => ledgerRow(order, events));
  const browserRows = Array.from(events.browser.values());

  const sourceRows = basics.sources.map((source: any) => {
    const serverForPixel = Array.from(events.server.values()).filter((row: any) => row.status === "sent");
    const healthy = Boolean(source.access_token) && source.last_check_ok !== false && source.status !== "paused";
    const events7d = typeof source.meta_stats?.counts === "object" ? Object.values(source.meta_stats.counts as Record<string, number>).reduce((sum: number, value) => sum + Number(value || 0), 0) : null;
    return {
      ...presentSource(source),
      events7d, eventsFromMeta: events7d !== null, sentByProtohub7d: serverForPixel.length,
      health: !source.access_token ? "no_token" : source.last_check_ok === false ? "error" : source.status === "testing" ? "testing" : source.last_check_ok === true ? "healthy" : "unchecked",
      healthy
    };
  });

  const websiteRows = basics.websites.map((site: any) => {
    const beacons = browserRows.filter((row: any) => row.page_domain === site.domain);
    const lastBeacon = beacons.map((row: any) => row.fired_at).sort().pop() ?? null;
    const duplicatePixel = beacons.some((row: any) => (row.pixels_on_page ?? []).length > 1);
    const forms = basics.links.filter((link: any) => link.website_id === site.id).length;
    const orders7d = rows.filter((row) => row.website === site.domain).length;
    const source = basics.sources.find((row: any) => row.id === site.data_source_id);
    const usesBrowser = basics.links.some((link: any) => link.website_id === site.id && link.mode === "hybrid");
    const problems: string[] = [];
    if (!source) problems.push("No data source chosen");
    if (usesBrowser && !lastBeacon) problems.push("Browser Pixel not detected");
    if (duplicatePixel) problems.push("More than one Pixel on the page");
    return {
      id: site.id, domain: site.domain, platform: site.platform, dataSourceId: site.data_source_id, dataSourceName: source?.name ?? null, notes: site.notes,
      forms, orders7d, lastBrowserEvent: lastBeacon, duplicatePixel,
      landingPages: Array.from(new Set(rows.filter((row) => row.website === site.domain).map((row) => pathOf(orders.find((order) => order.id === row.orderId)?.referrer)).filter(Boolean))) as string[],
      status: problems.length === 0 ? "healthy" : "warning", problems
    };
  });

  const linkRows = basics.links.filter((link: any) => link.tracking_key !== "__default__").map((link: any) => {
    const linkOrders = rows.filter((row) => row.trackingKey && row.trackingKey.toLowerCase() === String(link.tracking_key).toLowerCase());
    const failures = linkOrders.filter((row) => row.status === "capi_failed").length;
    const strategy = STRATEGY_OF_MODE[link.mode] ?? "landing_page";
    const checklist = link.checklist ?? {};
    const problems: string[] = [];
    if (!link.data_source_id && !link.pixel_id) problems.push("No data source");
    if (strategy !== "landing_page" && !(checklist.thankYouPixelRemoved && checklist.testEventSeen)) problems.push("Go-live checklist not finished");
    if (failures > 0) problems.push(`${failures} CAPI failure${failures === 1 ? "" : "s"} this week`);
    return { id: link.id, problems, healthy: problems.length === 0 && link.active !== false };
  });

  const differentIds = rows.filter((row) => row.browser && row.serverStatus === "sent" && row.status === "server_only").length;
  const capiFailures24h = rows.filter((row) => row.status === "capi_failed" && Date.parse(row.createdAt) > Date.now() - 86_400_000).length;
  const items: HealthItem[] = [
    { key: "sources", label: "Data Sources", total: sourceRows.length, healthy: sourceRows.filter((row: any) => row.healthy).length, detail: "" },
    { key: "websites", label: "Websites", total: websiteRows.length, healthy: websiteRows.filter((row: any) => row.status === "healthy").length, detail: "" },
    { key: "links", label: "Tracking Links", total: linkRows.length, healthy: linkRows.filter((row: any) => row.healthy).length, detail: "" },
    { key: "dedup", label: "Event Deduplication", total: 1, healthy: differentIds === 0 ? 1 : 0, detail: differentIds === 0 ? "Working properly" : `${differentIds} order${differentIds === 1 ? "" : "s"} with mismatched ids` },
    { key: "capi", label: "CAPI Connection", total: 1, healthy: capiFailures24h === 0 && sourceRows.some((row: any) => row.hasToken) ? 1 : 0,
      detail: !sourceRows.some((row: any) => row.hasToken) ? "No token connected" : capiFailures24h === 0 ? "All active" : `${capiFailures24h} failure${capiFailures24h === 1 ? "" : "s"} in 24h` }
  ];
  for (const item of items.slice(0, 3)) item.detail = `${item.healthy} Healthy`;
  return { basics, rows, orders, events, sourceRows, websiteRows, linkRows, items, score: healthScore(items) };
}

// ------------------------------------------------------------- diagnostics

type Issue = { severity: "red" | "orange" | "yellow"; title: string; detail: string; action: string; at: string | null; tab: string; orderIds?: string[] };

async function buildIssues(orgId: string, branchId: string, assessment: Awaited<ReturnType<typeof assess>>): Promise<Issue[]> {
  const issues: Issue[] = [];
  const { rows, sourceRows, websiteRows, basics } = assessment;

  // CAPI failures, grouped by Meta's reason, in plain words.
  const failed = rows.filter((row) => row.status === "capi_failed");
  const byReason = new Map<string, { rows: ReturnType<typeof ledgerRow>[]; message: string; http: number | null; at: string }>();
  for (const row of failed) {
    const event = assessment.events.server.get(row.orderId);
    const key = String(event?.message ?? "");
    const entry = byReason.get(key) ?? { rows: [] as ReturnType<typeof ledgerRow>[], message: key, http: event?.http_status ?? null, at: event?.sent_at ?? row.createdAt };
    entry.rows.push(row);
    if ((event?.sent_at ?? "") > entry.at) entry.at = event.sent_at;
    byReason.set(key, entry);
  }
  for (const entry of byReason.values()) {
    const human = humanMetaError(entry.message, entry.http);
    issues.push({ severity: "red", title: human.title, detail: `${entry.rows.length} Purchase event${entry.rows.length === 1 ? " has" : "s have"} not been delivered to Meta.`, action: human.action, at: entry.at, tab: "ledger", orderIds: entry.rows.map((row) => row.orderId) });
  }
  for (const source of sourceRows) {
    if (source.health === "no_token") issues.push({ severity: "orange", title: `${source.name}: no Conversions API token`, detail: "Server Purchase events cannot be sent and Meta's numbers cannot be read.", action: "Add a System User token on the data source.", at: null, tab: "sources" });
    else if (source.health === "error") {
      const human = humanMetaError(source.lastCheckMessage, null);
      issues.push({ severity: "red", title: `${source.name}: ${human.title}`, detail: `Pixel ${source.pixelId}.`, action: human.action, at: source.lastCheckAt, tab: "sources" });
    } else if (source.health === "unchecked") issues.push({ severity: "yellow", title: `${source.name}: connection not tested`, detail: `Pixel ${source.pixelId}.`, action: "Press Test Connection on the data source.", at: null, tab: "sources" });
  }
  for (const site of websiteRows) {
    for (const problem of site.problems) {
      issues.push({ severity: problem.startsWith("More than one") ? "orange" : problem.startsWith("Browser") ? "orange" : "yellow", title: site.domain, detail: problem, action: problem.startsWith("Browser") ? "Re-copy the embed code from Tracking Links onto the page; the new code reports each browser Purchase." : problem.startsWith("More than one") ? "Remove the extra Pixel code (theme, plugin or a second snippet) so each Purchase is counted once." : "Choose the data source this website should use.", at: site.lastBrowserEvent, tab: "websites" });
    }
  }
  const linkById = new Map(basics.links.map((link: any) => [link.id, link]));
  for (const link of assessment.linkRows) {
    for (const problem of link.problems) {
      const row: any = linkById.get(link.id);
      issues.push({ severity: problem.startsWith("Go-live") ? "orange" : problem.includes("CAPI") ? "red" : "yellow", title: row?.label ?? "Tracking link", detail: problem, action: problem.startsWith("Go-live") ? "Remove the Purchase Pixel from the thank-you page and run a test event, then tick the checklist." : "Open the link in Tracking Links.", at: null, tab: "links" });
    }
  }
  // Visitors who arrived from ads but lost their campaign ids.
  const adOrders = assessment.orders.filter((order) => /^(fb|ig|facebook|instagram|meta|an|msg)$/i.test(String(order.utm_source ?? "")));
  const lost = adOrders.filter((order) => !orderAdIds(order).campaignId).length;
  if (lost > 0) issues.push({ severity: "yellow", title: `${lost} visitor${lost === 1 ? "" : "s"} lost campaign parameters`, detail: "Orders from Meta ads with no campaign id this week.", action: "Add the URL parameters from Settings to every ad (campaign_id={{campaign.id}} ...).", at: null, tab: "settings" });
  const capture = attributionCapture(assessment.orders);
  if (capture.orders >= 10 && capture.fields.fbp_fbc < 50) issues.push({ severity: "yellow", title: "CAPI Match Quality", detail: `Meta's browser id (_fbp/_fbc) captured on only ${capture.fields.fbp_fbc}% of ad orders.`, action: "Re-copy the embed code onto each landing page so the browser id is passed in.", at: null, tab: "diagnostics" });
  // Meta vs Protohub, from the last reconciliation refresh (today).
  const today = lagosDateKey();
  const { data: insights } = await supabase.from("tracking_meta_insights").select("campaign_id, campaign_name, purchases").eq("org_id", orgId).eq("branch_id", branchId).eq("day", today);
  const metaByCampaign = new Map<string, { name: string; purchases: number }>();
  for (const row of insights ?? []) {
    const entry = metaByCampaign.get(row.campaign_id) ?? { name: row.campaign_name, purchases: 0 };
    entry.purchases += Number(row.purchases) || 0;
    metaByCampaign.set(row.campaign_id, entry);
  }
  const todayRows = rows.filter((row) => dayOfIso(row.createdAt) === today);
  for (const [campaignId, meta] of metaByCampaign) {
    const ours = todayRows.filter((row) => row.campaignId === campaignId).length;
    const verdict = reconciliationVerdict({ protohubOrders: ours, purchaseEvents: ours, sentToMeta: ours, duplicates: 0, metaPurchases: meta.purchases });
    if (verdict.tone === "warn") issues.push({ severity: "orange", title: `Campaign ${campaignId}`, detail: `${meta.purchases} Meta purchases / ${ours} Protohub orders today.`, action: verdict.likely, at: null, tab: "reconciliation" });
  }
  const order = { red: 0, orange: 1, yellow: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ------------------------------------------------------------------ overview

router.get("/overview", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.query);
    const chartDays = Math.min(30, Math.max(7, Number(req.query.chartDays) || 7));
    const chartFrom = addDaysToDateKey(period.to, -(chartDays - 1));
    const loadFrom = [period.from, period.compareFrom, chartFrom].sort()[0];
    const [assessment, orders] = await Promise.all([assess(orgId, branchId), formOrders(orgId, branchId, loadFrom, period.to)]);
    const events = await eventsFor(orgId, orders.map((order) => order.id));
    const rows = orders.map((order) => ledgerRow(order, events));
    const inRange = (row: { createdAt: string }, from: string, to: string) => { const day = dayOfIso(row.createdAt); return day >= from && day <= to; };
    const current = rows.filter((row) => inRange(row, period.from, period.to));
    const previous = rows.filter((row) => inRange(row, period.compareFrom, period.compareTo));
    const chart = Array.from({ length: chartDays }, (_, index) => {
      const day = addDaysToDateKey(chartFrom, index);
      const dayRows = rows.filter((row) => dayOfIso(row.createdAt) === day);
      const k = kpisOf(dayRows);
      return { day, orders: k.orders, browser: k.browserEvents, server: k.serverEvents };
    });
    const issues = await buildIssues(orgId, branchId, assessment);
    const capture = attributionCapture(orders.filter((order) => inRange({ createdAt: order.created_at }, period.from, period.to)));
    res.json({
      period,
      kpis: kpisOf(current),
      previous: kpisOf(previous),
      chart,
      health: { score: assessment.score, items: assessment.items },
      attribution: { orders: capture.orders, fields: ATTRIBUTION_FIELDS.map((field) => ({ ...field, pct: capture.fields[field.key] })) },
      dataSources: assessment.sourceRows,
      websites: assessment.websiteRows,
      recent: current.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
      attention: issues.slice(0, 5),
      issueCount: issues.length
    });
  } catch (error: any) {
    fail(res, error, "Could not load the Tracking Hub.");
  }
});

router.get("/diagnostics", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const assessment = await assess(orgId, branchId);
    const today = lagosDateKey();
    const todayRows = assessment.rows.filter((row) => dayOfIso(row.createdAt) === today);
    const k = kpisOf(todayRows);
    const eventIds = todayRows.map((row) => row.eventId).filter(Boolean) as string[];
    res.json({
      score: assessment.score,
      items: assessment.items,
      checks: [
        { ok: true, text: `${k.orders} form order${k.orders === 1 ? "" : "s"} created today` },
        { ok: new Set(eventIds).size === eventIds.length, text: `${new Set(eventIds).size} unique event IDs` },
        { ok: k.serverEvents > 0 || k.orders === 0, text: `${k.serverEvents} server Purchase events` },
        { ok: k.browserEvents > 0 || k.orders === 0, text: `${k.browserEvents} browser Purchase events` },
        { ok: new Set(todayRows.map((row) => row.orderId)).size === todayRows.length, text: "No duplicate Order IDs" }
      ],
      issues: await buildIssues(orgId, branchId, assessment)
    });
  } catch (error: any) {
    fail(res, error, "Could not run the diagnostics.");
  }
});

// ------------------------------------------------------------------- ledger

router.get("/ledger", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.query);
    const orders = await formOrders(orgId, branchId, period.from, period.to);
    const events = await eventsFor(orgId, orders.map((order) => order.id));
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const status = String(req.query.status ?? "");
    const rows = orders.map((order) => ledgerRow(order, events))
      .filter((row) => !status || row.status === status)
      .filter((row) => !q || `${row.orderId} ${row.product} ${row.website ?? ""} ${row.campaignId ?? ""} ${row.adId ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ period, kpis: kpisOf(rows), rows: rows.slice(0, 1000), total: rows.length });
  } catch (error: any) {
    fail(res, error, "Could not load the event ledger.");
  }
});

router.get("/ledger/:orderId", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { data: order, error } = await supabase.from("orders")
      .select("id, created_at, product_id, product_name, amount, currency, status, utm_source, utm_campaign, utm_content, utm_term, referrer, form_context, review_hold, delivered_date")
      .eq("org_id", orgId).eq("branch_id", branchId).eq("id", String(req.params.orderId)).maybeSingle();
    if (error) throw error;
    if (!order) throw httpError(404, "Order not found.");
    const events = await eventsFor(orgId, [order.id]);
    const ctx = (order.form_context ?? {}) as Record<string, any>;
    const server = events.server.get(order.id) ?? null;
    const browser = events.browser.get(order.id) ?? null;
    const delivered = events.delivered.get(order.id) ?? null;
    const row = ledgerRow(order as OrderRow, events);
    const fromAddress = (key: string) => { try { const url = new URL(String(ctx.landingUrl ?? "")); return new URLSearchParams(url.hash.split("?")[1] ?? url.search).get(key); } catch { return null; } };
    res.json({
      ...row,
      landingPage: order.referrer ?? ctx.landingPageUrl ?? null,
      fbclid: ctx.fbclid ?? fromAddress("fbclid"), fbp: ctx.fbp ?? fromAddress("fbp"), fbc: ctx.fbc ?? fromAddress("fbc"),
      utm: { source: order.utm_source, campaign: order.utm_campaign, content: order.utm_content, term: order.utm_term },
      device: { deviceType: ctx.deviceType ?? null, userAgent: ctx.userAgent ?? null, locale: ctx.clientLocale ?? null },
      browserEvent: browser ? { firedAt: browser.fired_at, eventId: browser.event_id, pixelId: browser.pixel_id, pageUrl: browser.page_url, pixelsOnPage: browser.pixels_on_page } : null,
      serverEvent: server ? { sentAt: server.sent_at, eventId: server.event_id, status: server.status, message: server.message, test: server.test_mode, attempts: server.attempts, human: server.status === "sent" || server.status === "dry_run" ? null : humanMetaError(server.message, server.http_status) } : null,
      deliveredEvent: delivered ? { sentAt: delivered.sent_at, status: delivered.status, metaEventName: delivered.meta_event_name, message: delivered.message } : null,
      deliveredDate: order.delivered_date
    });
  } catch (error: any) {
    fail(res, error, "Could not load the order's tracking.");
  }
});

// ------------------------------------------------------------ data sources

const SourceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  businessName: z.string().trim().max(160).default(""),
  adAccountIds: z.array(z.string().trim().regex(/^(act_)?\d{5,25}$/, "Ad account ids are numbers (act_ optional).")).max(20).default([]),
  pixelId: z.string().trim().regex(/^\d{8,25}$/, "The Pixel / dataset id is a number."),
  accessToken: z.string().trim().max(5000).optional(),
  testEventCode: z.string().trim().max(80).optional().default(""),
  isMain: z.boolean().default(false),
  status: z.enum(["production", "testing", "paused"]).default("production")
});

router.get("/data-sources", async (req, res) => {
  try {
    const assessment = await assess(req.user!.orgId, branchOf(req));
    res.json({ dataSources: assessment.sourceRows, profiles: assessment.basics.profiles.map(presentProfile), websites: assessment.basics.websites.map((site: any) => ({ id: site.id, domain: site.domain })) });
  } catch (error: any) {
    fail(res, error, "Could not load the data sources.");
  }
});

async function saveSource(req: Request, id: string | null) {
  const parsed = SourceSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "Check the form.");
  const orgId = req.user!.orgId;
  const branchId = branchOf(req);
  const d = parsed.data;
  const row: Record<string, unknown> = {
    org_id: orgId, branch_id: branchId, name: d.name, business_name: d.businessName,
    ad_account_ids: d.adAccountIds.map((value) => value.replace(/^act_/, "")), pixel_id: d.pixelId,
    test_event_code: d.testEventCode || null, is_main: d.isMain, status: d.status, updated_at: new Date().toISOString()
  };
  if (d.accessToken && d.accessToken !== SECRET_MASK) row.access_token = d.accessToken;
  if (d.isMain) await supabase.from("tracking_data_sources").update({ is_main: false }).eq("org_id", orgId).eq("branch_id", branchId);
  const result = id
    ? await supabase.from("tracking_data_sources").update(row).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("*").single()
    : await supabase.from("tracking_data_sources").insert({ ...row, created_by: req.user!.id }).select("*").single();
  if (result.error) throw result.error.code === "23505" ? httpError(409, "This Pixel is already a data source.") : result.error;
  return presentSource(result.data);
}

router.post("/data-sources", async (req, res) => {
  try { res.status(201).json(await saveSource(req, null)); } catch (error: any) { fail(res, error, "Could not save the data source."); }
});
router.put("/data-sources/:id", async (req, res) => {
  try { res.json(await saveSource(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the data source."); }
});
router.delete("/data-sources/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("tracking_data_sources").delete().eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id));
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the data source."); }
});

async function loadSource(req: Request) {
  const { data, error } = await supabase.from("tracking_data_sources").select("*").eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id)).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Data source not found.");
  return data;
}

/** Test both: Meta accepts a test server event, and the token can read the dataset. */
router.post("/data-sources/:id/test", async (req, res) => {
  try {
    const source = await loadSource(req);
    if (!source.access_token) throw httpError(400, "Add the access token first.");
    const [send, read] = await Promise.all([
      testMetaCapiConnection(source.pixel_id, source.access_token, source.test_event_code ?? undefined),
      checkDataset(source.pixel_id, source.access_token)
    ]);
    const ok = send.ok && read.ok;
    const message = !send.ok ? send.message : !read.ok ? `Sending works, but reading Meta's numbers does not: ${read.message}` : `Connected${read.name ? ` to "${read.name}"` : ""}.`;
    await supabase.from("tracking_data_sources").update({ last_check_at: new Date().toISOString(), last_check_ok: ok, last_check_message: message }).eq("id", source.id);
    res.json({ ok, message, canSend: send.ok, canRead: read.ok, lastFiredAt: read.ok ? read.lastFiredAt : null, human: ok ? null : humanMetaError(message, null) });
  } catch (error: any) { fail(res, error, "Could not test the connection."); }
});

/** Events Meta received in the last 7 days, by name. */
router.post("/data-sources/:id/refresh", async (req, res) => {
  try {
    const source = await loadSource(req);
    if (!source.access_token) throw httpError(400, "Add the access token first.");
    const result = await datasetEventCounts(source.pixel_id, source.access_token, 7);
    if (!result.ok) throw httpError(400, humanMetaError(result.message, null).title);
    const stats = { counts: result.counts, days: 7 };
    await supabase.from("tracking_data_sources").update({ meta_stats: stats, meta_stats_at: new Date().toISOString() }).eq("id", source.id);
    res.json({ metaStats: stats });
  } catch (error: any) { fail(res, error, "Could not read Meta's numbers."); }
});

// ---------------------------------------------------------------- websites

const WebsiteSchema = z.object({
  domain: z.string().trim().min(3).max(255),
  platform: z.enum(["WordPress", "Shopify", "Custom", "Other"]).default("WordPress"),
  dataSourceId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

router.get("/websites", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const assessment = await assess(orgId, branchId);
    const known = new Set(assessment.websiteRows.map((site: any) => site.domain));
    const recent = await formOrders(orgId, branchId, addDaysToDateKey(lagosDateKey(), -29), lagosDateKey());
    const detected = new Map<string, number>();
    for (const order of recent) {
      const domain = domainOf(order.referrer);
      if (domain && !known.has(domain)) detected.set(domain, (detected.get(domain) ?? 0) + 1);
    }
    res.json({
      websites: assessment.websiteRows,
      detected: Array.from(detected.entries()).sort((a, b) => b[1] - a[1]).map(([domain, orders]) => ({ domain, orders30d: orders })),
      dataSources: assessment.sourceRows.map((row: any) => ({ id: row.id, name: row.name }))
    });
  } catch (error: any) { fail(res, error, "Could not load the websites."); }
});

async function saveWebsite(req: Request, id: string | null) {
  const parsed = WebsiteSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Check the website.");
  const domain = domainOf(parsed.data.domain);
  if (!domain) throw httpError(400, "That does not look like a website address.");
  const row = { org_id: req.user!.orgId, branch_id: branchOf(req), domain, platform: parsed.data.platform, data_source_id: parsed.data.dataSourceId ?? null, notes: parsed.data.notes ?? null, updated_at: new Date().toISOString() };
  const result = id
    ? await supabase.from("tracking_websites").update(row).eq("org_id", row.org_id).eq("branch_id", row.branch_id).eq("id", id).select("id").single()
    : await supabase.from("tracking_websites").insert({ ...row, created_by: req.user!.id }).select("id").single();
  if (result.error) throw result.error.code === "23505" ? httpError(409, "This website is already added.") : result.error;
  return result.data;
}
router.post("/websites", async (req, res) => { try { res.status(201).json(await saveWebsite(req, null)); } catch (error: any) { fail(res, error, "Could not save the website."); } });
router.put("/websites/:id", async (req, res) => { try { res.json(await saveWebsite(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the website."); } });
router.delete("/websites/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("tracking_websites").delete().eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id));
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the website."); }
});

// ---------------------------------------------------------------- profiles

const presentProfile = (row: any) => ({ id: row.id, name: row.name, dataSourceId: row.data_source_id, defaultWebsiteId: row.default_website_id, strategy: row.strategy, adAccountLabel: row.ad_account_label, status: row.status });
const ProfileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  dataSourceId: z.string().uuid().nullable().optional(),
  defaultWebsiteId: z.string().uuid().nullable().optional(),
  strategy: z.enum(["browser_capi", "capi_only", "landing_page"]).default("browser_capi"),
  adAccountLabel: z.string().trim().max(160).default(""),
  status: z.enum(["production", "testing"]).default("production")
});
async function saveProfile(req: Request, id: string | null) {
  const parsed = ProfileSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Check the profile.");
  const d = parsed.data;
  const row = { org_id: req.user!.orgId, branch_id: branchOf(req), name: d.name, data_source_id: d.dataSourceId ?? null, default_website_id: d.defaultWebsiteId ?? null, strategy: d.strategy, ad_account_label: d.adAccountLabel, status: d.status, updated_at: new Date().toISOString() };
  const result = id
    ? await supabase.from("tracking_profiles").update(row).eq("org_id", row.org_id).eq("branch_id", row.branch_id).eq("id", id).select("*").single()
    : await supabase.from("tracking_profiles").insert(row).select("*").single();
  if (result.error) throw result.error;
  return presentProfile(result.data);
}
router.post("/profiles", async (req, res) => { try { res.status(201).json(await saveProfile(req, null)); } catch (error: any) { fail(res, error, "Could not save the profile."); } });
router.put("/profiles/:id", async (req, res) => { try { res.json(await saveProfile(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the profile."); } });
router.delete("/profiles/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("tracking_profiles").delete().eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id));
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the profile."); }
});

// ------------------------------------------------------------ tracking links

router.get("/links", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const assessment = await assess(orgId, branchId);
    const since = addDaysToDateKey(lagosDateKey(), -29);
    const orders = await formOrders(orgId, branchId, since, lagosDateKey());
    const { data: products } = await supabase.from("products").select("id, name").eq("org_id", orgId);
    const productName = new Map((products ?? []).map((row: any) => [row.id, row.name]));
    const health = new Map(assessment.linkRows.map((row: any) => [row.id, row]));
    const links = assessment.basics.links.filter((link: any) => link.tracking_key !== "__default__").map((link: any) => {
      const source = assessment.basics.sources.find((row: any) => row.id === link.data_source_id);
      const site = assessment.basics.websites.find((row: any) => row.id === link.website_id);
      const profile = assessment.basics.profiles.find((row: any) => row.id === link.profile_id);
      const linkHealth: any = health.get(link.id);
      return {
        id: link.id, trackingKey: link.tracking_key, label: link.label, active: link.active !== false,
        productId: link.product_id, productName: productName.get(link.product_id) ?? null,
        websiteId: link.website_id, websiteDomain: site?.domain ?? domainOf(link.landing_page_url),
        landingPageUrl: link.landing_page_url ?? "", landingPath: pathOf(link.landing_page_url),
        redirectUrl: link.redirect_url ?? "", formLabel: link.form_label ?? "",
        dataSourceId: link.data_source_id, dataSourceName: source?.name ?? (link.pixel_id ? `Pixel ${link.pixel_id}` : null), pixelId: source?.pixel_id ?? link.pixel_id ?? null,
        profileId: link.profile_id, profileName: profile?.name ?? null,
        strategy: STRATEGY_OF_MODE[link.mode] ?? "landing_page", mode: link.mode,
        testEventCode: source?.status === "testing" ? source?.test_event_code ?? "" : link.test_event_code ?? "",
        checklist: link.checklist ?? {},
        orders30d: orders.filter((order) => String(order.form_context?.metaTrackingKey ?? "").toLowerCase() === String(link.tracking_key).toLowerCase()).length,
        healthy: Boolean(linkHealth?.healthy), problems: linkHealth?.problems ?? []
      };
    });
    res.json({
      links,
      products: (products ?? []).map((row: any) => ({ id: row.id, name: row.name })).sort((a: any, b: any) => a.name.localeCompare(b.name)),
      dataSources: assessment.sourceRows.map((row: any) => ({ id: row.id, name: row.name, pixelId: row.pixelId, status: row.status })),
      websites: assessment.basics.websites.map((row: any) => ({ id: row.id, domain: row.domain, dataSourceId: row.data_source_id })),
      profiles: assessment.basics.profiles.map(presentProfile),
      defaultStrategy: (await loadSettings(orgId, branchId)).defaultStrategy
    });
  } catch (error: any) { fail(res, error, "Could not load the tracking links."); }
});

const LinkSchema = z.object({
  label: z.string().trim().min(2).max(200),
  productId: z.string().uuid().nullable().optional(),
  websiteId: z.string().uuid().nullable().optional(),
  profileId: z.string().uuid().nullable().optional(),
  dataSourceId: z.string().uuid().nullable().optional(),
  strategy: z.enum(["browser_capi", "capi_only", "landing_page"]),
  landingPageUrl: z.string().trim().max(2000).default(""),
  redirectUrl: z.string().trim().max(2000).default(""),
  formLabel: z.string().trim().max(200).default(""),
  active: z.boolean().default(true)
});

async function saveLink(req: Request, id: string | null) {
  const parsed = LinkSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "Check the link.");
  const orgId = req.user!.orgId;
  const branchId = branchOf(req);
  const d = parsed.data;
  let dataSourceId = d.dataSourceId ?? null;
  let websiteId = d.websiteId ?? null;
  if (d.profileId && (!dataSourceId || !websiteId)) {
    const { data: profile } = await supabase.from("tracking_profiles").select("data_source_id, default_website_id").eq("id", d.profileId).maybeSingle();
    dataSourceId = dataSourceId ?? profile?.data_source_id ?? null;
    websiteId = websiteId ?? profile?.default_website_id ?? null;
  }
  if (!dataSourceId && websiteId) {
    const { data: site } = await supabase.from("tracking_websites").select("data_source_id").eq("id", websiteId).maybeSingle();
    dataSourceId = site?.data_source_id ?? null;
  }
  if (d.strategy !== "landing_page" && !dataSourceId) throw httpError(400, "Choose a data source (or a profile / website that has one) for Browser + CAPI.");
  // The links table requires pixel_id / access_token (it used to hold them).
  // A hub link keeps the source's Pixel id for the embed code and an empty
  // token; the real token is read from the data source when sending.
  let pixelId = "";
  if (dataSourceId) {
    const { data: source } = await supabase.from("tracking_data_sources").select("pixel_id").eq("id", dataSourceId).maybeSingle();
    pixelId = source?.pixel_id ?? "";
  }
  const row: Record<string, unknown> = {
    org_id: orgId, branch_id: branchId, label: d.label, product_id: d.productId ?? null, website_id: websiteId,
    profile_id: d.profileId ?? null, data_source_id: dataSourceId, mode: MODE_OF_STRATEGY[d.strategy], pixel_id: pixelId,
    landing_page_url: d.landingPageUrl || null, redirect_url: d.redirectUrl || null, form_label: d.formLabel || null,
    active: d.active, updated_at: new Date().toISOString()
  };
  if (id) {
    const result = await supabase.from("meta_capi_configs").update(row).eq("org_id", orgId).eq("id", id).select("id, tracking_key").single();
    if (result.error) throw result.error;
    return result.data;
  }
  const base = d.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "link";
  const result = await supabase.from("meta_capi_configs").insert({ ...row, access_token: "", tracking_key: `${base}_${Date.now().toString(36)}`, created_by: req.user!.id }).select("id, tracking_key").single();
  if (result.error) throw result.error;
  return result.data;
}
router.post("/links", async (req, res) => { try { res.status(201).json(await saveLink(req, null)); } catch (error: any) { fail(res, error, "Could not save the link."); } });
router.put("/links/:id", async (req, res) => { try { res.json(await saveLink(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the link."); } });
router.put("/links/:id/checklist", async (req, res) => {
  const parsed = z.object({ thankYouPixelRemoved: z.boolean(), testEventSeen: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Tick the checklist items." }); return; }
  try {
    const checklist = { ...parsed.data, confirmedBy: req.user!.name ?? null, confirmedAt: new Date().toISOString() };
    const { error } = await supabase.from("meta_capi_configs").update({ checklist, updated_at: new Date().toISOString() }).eq("org_id", req.user!.orgId).eq("id", String(req.params.id));
    if (error) throw error;
    res.json({ checklist });
  } catch (error: any) { fail(res, error, "Could not save the checklist."); }
});
router.delete("/links/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("meta_capi_configs").delete().eq("org_id", req.user!.orgId).eq("id", String(req.params.id)).neq("tracking_key", "__default__");
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the link."); }
});

// ----------------------------------------------------------- reconciliation

router.get("/reconciliation", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.query);
    const [orders, insightsRes, sourcesRes] = await Promise.all([
      formOrders(orgId, branchId, period.from, period.to),
      supabase.from("tracking_meta_insights").select("data_source_id, campaign_id, campaign_name, purchases, purchase_value, spend, fetched_at, day")
        .eq("org_id", orgId).eq("branch_id", branchId).gte("day", period.from).lte("day", period.to),
      supabase.from("tracking_data_sources").select("id, name, ad_account_ids, access_token").eq("org_id", orgId).eq("branch_id", branchId)
    ]);
    if (insightsRes.error) throw insightsRes.error;
    if (sourcesRes.error) throw sourcesRes.error;
    const events = await eventsFor(orgId, orders.map((order) => order.id));
    const rows = orders.map((order) => ledgerRow(order, events));
    const meta = new Map<string, { name: string; purchases: number; value: number; spend: number }>();
    let lastFetched: string | null = null;
    for (const row of insightsRes.data ?? []) {
      const entry = meta.get(row.campaign_id) ?? { name: row.campaign_name, purchases: 0, value: 0, spend: 0 };
      entry.purchases += Number(row.purchases) || 0;
      entry.value += Number(row.purchase_value) || 0;
      entry.spend += Number(row.spend) || 0;
      meta.set(row.campaign_id, entry);
      if (!lastFetched || row.fetched_at > lastFetched) lastFetched = row.fetched_at;
    }
    const campaignIds = new Set<string>([...meta.keys(), ...rows.map((row) => row.campaignId).filter(Boolean) as string[]]);
    const campaigns = Array.from(campaignIds).map((campaignId) => {
      const ours = rows.filter((row) => row.campaignId === campaignId);
      const sent = ours.filter((row) => row.serverStatus === "sent" || row.serverStatus === "dry_run").length;
      const purchaseEvents = ours.filter((row) => row.browser || row.serverStatus === "sent" || row.serverStatus === "dry_run").length;
      const duplicates = ours.filter((row) => events.server.get(row.orderId)?.status === "duplicate").length;
      const m = meta.get(campaignId);
      const metaPurchases = meta.size > 0 ? Math.round(m?.purchases ?? 0) : null;
      return {
        campaignId, campaignName: m?.name ?? null,
        protohubOrders: ours.length, purchaseEvents, sentToMeta: sent, duplicates,
        metaPurchases, difference: metaPurchases === null ? null : metaPurchases - ours.length,
        spend: m?.spend ?? 0, verdict: reconciliationVerdict({ protohubOrders: ours.length, purchaseEvents, sentToMeta: sent, duplicates, metaPurchases })
      };
    }).sort((a, b) => (b.protohubOrders + (b.metaPurchases ?? 0)) - (a.protohubOrders + (a.metaPurchases ?? 0)));
    const noCampaign = rows.filter((row) => !row.campaignId).length;
    res.json({
      period, campaigns, noCampaign, lastFetched,
      sources: (sourcesRes.data ?? []).map((row: any) => ({ id: row.id, name: row.name, adAccounts: (row.ad_account_ids ?? []).length, hasToken: Boolean(row.access_token) }))
    });
  } catch (error: any) { fail(res, error, "Could not load the reconciliation."); }
});

router.post("/reconciliation/refresh", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.body ?? {});
    if (daysBetween(period.from, period.to) > 92) throw httpError(400, "Refresh at most 92 days at a time.");
    const { data: sources, error } = await supabase.from("tracking_data_sources").select("id, name, ad_account_ids, access_token").eq("org_id", orgId).eq("branch_id", branchId);
    if (error) throw error;
    const report: Array<{ source: string; account: string; ok: boolean; message: string; rows: number }> = [];
    for (const source of sources ?? []) {
      if (!source.access_token) continue;
      for (const account of source.ad_account_ids ?? []) {
        const result = await campaignPurchases(account, source.access_token, period.from, period.to);
        if (!result.ok) { report.push({ source: source.name, account, ok: false, message: humanMetaError(result.message, null).title, rows: 0 }); continue; }
        await supabase.from("tracking_meta_insights").delete().eq("data_source_id", source.id).eq("ad_account_id", account).gte("day", period.from).lte("day", period.to);
        if (result.rows.length > 0) {
          const insert = await supabase.from("tracking_meta_insights").insert(result.rows.map((row) => ({
            org_id: orgId, branch_id: branchId, data_source_id: source.id, ad_account_id: account, day: row.day,
            campaign_id: row.campaignId, campaign_name: row.campaignName, purchases: row.purchases, purchase_value: row.purchaseValue, spend: row.spend
          })));
          if (insert.error) throw insert.error;
        }
        report.push({ source: source.name, account, ok: true, message: "Loaded.", rows: result.rows.length });
      }
    }
    if (report.length === 0) throw httpError(400, "No data source has a token and an ad account id. Add them in Data Sources.");
    res.json({ report });
  } catch (error: any) { fail(res, error, "Could not read Meta's numbers."); }
});

// ----------------------------------------------------------------- settings

const DEFAULT_SETTINGS = {
  // Bright, 2 Oct 2026: new links default to Browser + CAPI, behind a go-live checklist.
  defaultStrategy: "browser_capi" as "browser_capi" | "capi_only" | "landing_page",
  urlParameters: "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}"
};
async function loadSettings(orgId: string, branchId: string) {
  const { data } = await supabase.from("tracking_settings").select("settings").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...((data?.settings ?? {}) as Record<string, unknown>) } as typeof DEFAULT_SETTINGS;
}
router.get("/settings", async (req, res) => {
  try { res.json({ settings: await loadSettings(req.user!.orgId, branchOf(req)) }); } catch (error: any) { fail(res, error, "Could not load the settings."); }
});
router.put("/settings", async (req, res) => {
  const parsed = z.object({
    defaultStrategy: z.enum(["browser_capi", "capi_only", "landing_page"]), urlParameters: z.string().trim().max(1000)
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Check the settings." }); return; }
  try {
    const settings = parsed.data;
    const { error } = await supabase.from("tracking_settings").upsert({ org_id: req.user!.orgId, branch_id: branchOf(req), settings, updated_by: req.user!.id, updated_at: new Date().toISOString() }, { onConflict: "org_id,branch_id" });
    if (error) throw error;
    res.json({ settings: { ...DEFAULT_SETTINGS, ...settings } });
  } catch (error: any) { fail(res, error, "Could not save the settings."); }
});

export default router;
