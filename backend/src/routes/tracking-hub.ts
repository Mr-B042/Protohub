import { Router, type Request } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";
import { sendMetaCapiPurchase, testMetaCapiConnection } from "../lib/meta-capi.js";
import { testTikTokConnection } from "../lib/tiktok-events.js";
import { adPurchases, campaignsByIds, checkDataset, datasetEventStats, datasetQuality, discoverAdAccounts, discoverPixels, metaBusiness, metaWhoAmI, scanPage } from "../lib/meta-graph.js";
import { connectionToken } from "../lib/tracking-credentials.js";
import { ATTRIBUTION_FIELDS, attributionCapture, domainOf, humanMetaError, orderAdIds, pathOf, reconciliationVerdict } from "../lib/tracking-hub.js";
import {
  DEFAULT_HUB_SETTINGS, MODE_OF_STRATEGY, STRATEGY_OF_MODE, assess, change, dayOfIso, daysBetween, eventsFor, formOrders,
  hubAudit, journeyCounts, kpisOf, ledgerRow, loadBasics, loadHubSettings, pct, sumVisits, type HubSettings, type JourneyRow, type LedgerRow
} from "../lib/tracking-hub-data.js";

// Tracking Hub (Bright, 2 Oct 2026; redesigned to his seven tab images the
// same day). Owner only - it holds the Meta tokens. Numbers come from
// lib/tracking-hub-data.ts; rules from lib/tracking-hub.ts; Meta reads from
// lib/meta-graph.ts.
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
const actorOf = (req: Request) => ({ id: req.user!.id, name: req.user!.name ?? null });

function periodOf(query: any, defaultDays = 1) {
  const today = lagosDateKey();
  const to = typeof query.to === "string" && DATE_KEY.test(query.to) ? query.to : today;
  const from = typeof query.from === "string" && DATE_KEY.test(query.from) ? query.from : addDaysToDateKey(to, -(defaultDays - 1));
  if (from > to) throw httpError(400, "The start date is after the end date.");
  const length = daysBetween(from, to);
  const compareTo = typeof query.compareTo === "string" && DATE_KEY.test(query.compareTo) ? query.compareTo : addDaysToDateKey(from, -1);
  const compareFrom = typeof query.compareFrom === "string" && DATE_KEY.test(query.compareFrom) ? query.compareFrom : addDaysToDateKey(compareTo, -(length - 1));
  return { from, to, compareFrom, compareTo, length };
}

const eventsManagerUrl = (pixelId: string) => `https://business.facebook.com/events_manager2/list/pixel/${encodeURIComponent(pixelId)}/overview`;
const adsManagerUrl = (adAccount: string | null, campaignId: string | null) =>
  `https://adsmanager.facebook.com/adsmanager/manage/campaigns${adAccount ? `?act=${encodeURIComponent(adAccount.replace(/^act_/, ""))}` : ""}${campaignId ? `${adAccount ? "&" : "?"}selected_campaign_ids=${encodeURIComponent(campaignId)}` : ""}`;
const lastNDays = (to: string, n: number) => Array.from({ length: n }, (_, index) => addDaysToDateKey(to, index - (n - 1)));

// ================================================================ OVERVIEW

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
    const inRange = (iso: string, from: string, to: string) => { const day = dayOfIso(iso); return day >= from && day <= to; };
    const current = rows.filter((row) => inRange(row.createdAt, period.from, period.to));
    const previous = rows.filter((row) => inRange(row.createdAt, period.compareFrom, period.compareTo));
    const chart = lastNDays(period.to, chartDays).map((day) => {
      const k = kpisOf(rows.filter((row) => dayOfIso(row.createdAt) === day));
      return { day, orders: k.orders, browser: k.browserEvents, server: k.serverEvents };
    });
    const capture = attributionCapture(orders.filter((order) => inRange(order.created_at, period.from, period.to)));
    res.json({
      period, kpis: kpisOf(current), previous: kpisOf(previous), chart,
      health: { score: assessment.score, items: assessment.items },
      attribution: { orders: capture.orders, fields: ATTRIBUTION_FIELDS.map((field) => ({ ...field, pct: capture.fields[field.key] })) },
      dataSources: assessment.sourceRows, websites: assessment.websiteRows,
      recent: current.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8),
      attention: assessment.issues.slice(0, 5), issueCount: assessment.issues.length
    });
  } catch (error: any) { fail(res, error, "Could not load the Tracking Hub."); }
});

// ============================================================ DATA SOURCES

const PLATFORMS = ["meta", "tiktok", "google", "snapchat", "other"] as const;
const presentProfile = (row: any) => ({ id: row.id, name: row.name, dataSourceId: row.data_source_id, defaultWebsiteId: row.default_website_id, strategy: row.strategy, adAccountLabel: row.ad_account_label, status: row.status });

router.get("/data-sources", async (req, res) => {
  try {
    const assessment = await assess(req.user!.orgId, branchOf(req));
    const rows = assessment.sourceRows;
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const live = rows.filter((row: any) => row.active);
    const disconnected = live.filter((row: any) => row.health === "no_token" || row.health === "disconnected" || row.health === "error").length;
    const healthy = live.filter((row: any) => row.health === "healthy").length;
    res.json({
      kpis: {
        total: rows.length, newThisMonth: rows.filter((row: any) => row.createdAt >= monthAgo).length,
        healthy, healthyPct: pct(healthy, rows.length),
        needAttention: live.length - healthy - disconnected, needAttentionPct: pct(live.length - healthy - disconnected, rows.length), off: rows.length - live.length,
        disconnected, disconnectedPct: pct(disconnected, rows.length)
      },
      platformCounts: Object.fromEntries(PLATFORMS.map((platform) => [platform, rows.filter((row: any) => row.platform === platform).length])),
      dataSources: rows,
      connections: assessment.basics.connections.map((connection: any) => presentConnection(connection, rows, assessment.basics.adAccounts)),
      profiles: assessment.basics.profiles.map(presentProfile),
      websites: assessment.basics.websites.map((site: any) => ({ id: site.id, domain: site.domain })),
      issues: assessment.issues.filter((issue) => issue.tab === "sources")
    });
  } catch (error: any) { fail(res, error, "Could not load the data sources."); }
});

router.get("/data-sources/:id", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const assessment = await assess(orgId, branchId);
    const source = assessment.sourceRows.find((row: any) => row.id === String(req.params.id));
    if (!source) throw httpError(404, "Data source not found.");
    const [{ data: lastServer }, { data: lastBrowser }, { data: logs }, { data: sends }, { data: raw }] = await Promise.all([
      supabase.from("meta_capi_events").select("sent_at, status").eq("org_id", orgId).eq("pixel_id", source.pixelId).eq("status", "sent").order("sent_at", { ascending: false }).limit(1),
      supabase.from("tracking_browser_events").select("fired_at").eq("org_id", orgId).eq("pixel_id", source.pixelId).order("fired_at", { ascending: false }).limit(1),
      supabase.from("tracking_audit").select("action, subject_label, detail, actor_name, created_at").eq("org_id", orgId).eq("branch_id", branchId).eq("subject_id", source.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("meta_capi_events").select("order_id, event_name, meta_event_name, status, message, test_mode, sent_at").eq("org_id", orgId).eq("pixel_id", source.pixelId).order("sent_at", { ascending: false }).limit(30),
      supabase.from("tracking_data_sources").select("meta_stats").eq("id", source.id).maybeSingle()
    ]);
    const stats = (raw?.meta_stats ?? {}) as Record<string, any>;
    const recent = ["Purchase", "ViewContent", "InitiateCheckout", "AddToCart"].map((name) => ({
      name, count: Number(stats.counts24h?.[name] ?? 0), change: stats.prev24h ? change(Number(stats.counts24h?.[name] ?? 0), Number(stats.prev24h?.[name] ?? 0)) : null
    }));
    res.json({
      ...source,
      eventsManagerUrl: eventsManagerUrl(source.pixelId),
      browser: { lastEventAt: lastBrowser?.[0]?.fired_at ?? null, receiving: Boolean(lastBrowser?.[0] && Date.parse(lastBrowser[0].fired_at) > Date.now() - 7 * 86_400_000), emq: source.emq?.PageView ?? source.emq?.Purchase ?? null },
      capi: { lastEventAt: lastServer?.[0]?.sent_at ?? null, connected: source.hasToken && source.lastCheckOk !== false, emq: source.emq?.Purchase ?? null },
      counts7d: stats.counts7d ?? null, prev7d: stats.prev7d ?? null, recent, recentLoaded: Boolean(stats.counts24h),
      issues: assessment.issues.filter((issue) => issue.subjectId === source.id),
      logs: (logs ?? []).map((row: any) => ({ at: row.created_at, action: row.action, by: row.actor_name, detail: row.detail })),
      sends: (sends ?? []).map((row: any) => ({ at: row.sent_at, orderId: row.order_id, event: row.meta_event_name, status: row.status, message: row.message, test: row.test_mode }))
    });
  } catch (error: any) { fail(res, error, "Could not load the data source."); }
});

const SourceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  platform: z.enum(PLATFORMS).default("meta"),
  description: z.string().trim().max(200).default(""),
  businessName: z.string().trim().max(160).default(""),
  adAccountIds: z.array(z.string().trim().regex(/^(act_)?\d{5,25}$/, "Ad account ids are numbers (act_ optional).")).max(20).default([]),
  adAccountLabel: z.string().trim().max(160).default(""),
  pixelId: z.string().trim().min(3).max(60),
  accessToken: z.string().trim().max(5000).optional(),
  testEventCode: z.string().trim().max(80).optional().default(""),
  isMain: z.boolean().default(false),
  status: z.enum(["production", "testing", "paused"]).default("production"),
  currency: z.string().trim().max(8).default("NGN"),
  timezone: z.string().trim().max(60).default("Africa/Lagos")
});

async function saveSource(req: Request, id: string | null) {
  const parsed = SourceSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, parsed.error.issues[0]?.message ?? "Check the form.");
  const orgId = req.user!.orgId;
  const branchId = branchOf(req);
  const d = parsed.data;
  if (d.platform === "meta" && !/^\d{8,25}$/.test(d.pixelId)) throw httpError(400, "A Meta Pixel / dataset id is a number.");
  const row: Record<string, unknown> = {
    org_id: orgId, branch_id: branchId, name: d.name, platform: d.platform, description: d.description, business_name: d.businessName,
    ad_account_ids: d.adAccountIds.map((value) => value.replace(/^act_/, "")), ad_account_label: d.adAccountLabel, pixel_id: d.pixelId,
    test_event_code: d.testEventCode || null, is_main: d.isMain, status: d.status, currency: d.currency, timezone: d.timezone, updated_at: new Date().toISOString()
  };
  if (d.accessToken && d.accessToken !== SECRET_MASK) row.access_token = d.accessToken;
  if (d.isMain) await supabase.from("tracking_data_sources").update({ is_main: false }).eq("org_id", orgId).eq("branch_id", branchId).eq("platform", d.platform);
  const result = id
    ? await supabase.from("tracking_data_sources").update(row).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("id, name").single()
    : await supabase.from("tracking_data_sources").insert({ ...row, created_by: req.user!.id }).select("id, name").single();
  if (result.error) throw result.error.code === "23505" ? httpError(409, "This Pixel is already a data source.") : result.error;
  await hubAudit(orgId, branchId, actorOf(req), id ? "data_source_updated" : "data_source_connected", { type: "data_source", id: result.data.id, label: d.name }, { platform: d.platform, tokenChanged: Boolean(row.access_token) });
  return result.data;
}

router.post("/data-sources", async (req, res) => { try { res.status(201).json(await saveSource(req, null)); } catch (error: any) { fail(res, error, "Could not save the data source."); } });
router.put("/data-sources/:id", async (req, res) => { try { res.json(await saveSource(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the data source."); } });
router.delete("/data-sources/:id", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { data } = await supabase.from("tracking_data_sources").select("name").eq("org_id", orgId).eq("branch_id", branchId).eq("id", String(req.params.id)).maybeSingle();
    const { error } = await supabase.from("tracking_data_sources").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", String(req.params.id));
    if (error) throw error;
    await hubAudit(orgId, branchId, actorOf(req), "data_source_deleted", { type: "data_source", id: String(req.params.id), label: data?.name ?? null });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the data source."); }
});

async function loadSource(req: Request) {
  const { data, error } = await supabase.from("tracking_data_sources").select("*").eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id)).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Data source not found.");
  // A Pixel found through a Meta Business connection uses the connection's token.
  return { ...data, access_token: data.access_token || (await connectionToken(data.connection_id)) };
}

/** Disconnect: removes the token (sending and reading stop) and pauses the source. */
router.post("/data-sources/:id/disconnect", async (req, res) => {
  try {
    const source = await loadSource(req);
    await supabase.from("tracking_data_sources").update({ access_token: null, status: "paused", last_check_ok: null, updated_at: new Date().toISOString() }).eq("id", source.id);
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "data_source_disconnected", { type: "data_source", id: source.id, label: source.name });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not disconnect."); }
});

router.post("/data-sources/:id/test", async (req, res) => {
  try {
    const source = await loadSource(req);
    if (!source.access_token) throw httpError(400, source.connection_id ? "The Meta Business connection has no token. Paste one on the connection." : "Add the access token first.");
    let ok = false;
    let message = "";
    let canRead = false;
    let lastFiredAt: string | null = null;
    let datasetName: string | null = null;
    if ((source.platform ?? "meta") === "meta") {
      const [send, read] = await Promise.all([testMetaCapiConnection(source.pixel_id, source.access_token, source.test_event_code ?? undefined), checkDataset(source.pixel_id, source.access_token)]);
      ok = send.ok && read.ok;
      canRead = read.ok;
      lastFiredAt = read.ok ? read.lastFiredAt : null;
      datasetName = read.ok ? read.name : null;
      message = !send.ok ? send.message : !read.ok ? `Sending works, but reading Meta's numbers does not: ${read.message}` : `Connected${read.name ? ` to "${read.name}"` : ""}.`;
    } else if (source.platform === "tiktok") {
      const result = await testTikTokConnection(source.pixel_id, source.access_token, source.test_event_code ?? undefined);
      ok = result.ok;
      message = result.message;
    } else {
      ok = false;
      message = "Saved. Protohub does not send events to this platform yet.";
    }
    await supabase.from("tracking_data_sources").update({ last_check_at: new Date().toISOString(), last_check_ok: ok, last_check_message: message, ...(datasetName ? { dataset_name: datasetName } : {}), ...(source.connection_id ? { has_access: canRead || ok } : {}) }).eq("id", source.id);
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "connection_tested", { type: "data_source", id: source.id, label: source.name }, { ok, message });
    res.json({ ok, message, canRead, lastFiredAt, human: ok ? null : humanMetaError(message, null) });
  } catch (error: any) { fail(res, error, "Could not test the connection."); }
});

/** Refresh from Meta: event counts (this week vs last, 24h vs the 24h before) and match quality. */
router.post("/data-sources/:id/refresh", async (req, res) => {
  try {
    const source = await loadSource(req);
    if (!source.access_token) throw httpError(400, "Add the access token first.");
    if ((source.platform ?? "meta") !== "meta") throw httpError(400, "Event counts are read from Meta only.");
    const [stats, emq] = await Promise.all([datasetEventStats(source.pixel_id, source.access_token), datasetQuality(source.pixel_id, source.access_token)]);
    if (!stats.ok) throw httpError(400, humanMetaError(stats.message, null).title);
    const metaStats = { counts7d: stats.counts7d, prev7d: stats.prev7d, counts24h: stats.counts24h, prev24h: stats.prev24h, emq };
    await supabase.from("tracking_data_sources").update({ meta_stats: metaStats, meta_stats_at: new Date().toISOString() }).eq("id", source.id);
    res.json({ metaStats });
  } catch (error: any) { fail(res, error, "Could not read Meta's numbers."); }
});

// ==================================================== META BUSINESS CONNECTIONS
// (Bright, 2 Oct 2026) Connect a Meta Business once; Sync Assets finds its
// Pixels and ad accounts; each is switched on or off here.

function presentConnection(connection: any, sourceRows: any[], adAccounts: any[]) {
  const pixels = sourceRows.filter((row: any) => row.connectionId === connection.id);
  return {
    id: connection.id, name: connection.name, businessId: connection.business_id, systemUserName: connection.system_user_name,
    hasToken: Boolean(connection.access_token), currency: connection.currency, timezone: connection.timezone,
    lastCheckAt: connection.last_check_at, lastCheckOk: connection.last_check_ok, lastCheckMessage: connection.last_check_message,
    human: connection.last_check_ok === false ? humanMetaError(connection.last_check_message, null) : null,
    lastSyncAt: connection.last_sync_at, lastSyncOk: connection.last_sync_ok, lastSyncMessage: connection.last_sync_message,
    status: !connection.access_token ? "disconnected" : connection.last_check_ok === false ? "error" : connection.last_sync_ok === false ? "sync_failed" : "connected",
    pixels: pixels.map((row: any) => ({ sourceId: row.id, pixelId: row.pixelId, name: row.name, active: row.active, hasAccess: row.hasAccess, lastFiredAt: row.metaLastFiredAt, health: row.health, ownToken: row.ownToken })),
    adAccounts: adAccounts.filter((row: any) => row.connection_id === connection.id).map((row: any) => ({ id: row.id, accountId: row.account_id, name: row.name, currency: row.currency, active: row.active, hasAccess: row.has_access, status: row.account_status }))
  };
}

async function loadConnection(req: Request) {
  const { data, error } = await supabase.from("tracking_meta_connections").select("*").eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id)).maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Connection not found.");
  return data;
}

/** Find the business's Pixels and ad accounts and save them under the connection. */
async function syncConnection(orgId: string, branchId: string, connection: any) {
  if (!connection.access_token) throw httpError(400, "Paste the System User token on this connection first.");
  const [pixels, accounts] = await Promise.all([discoverPixels(connection.business_id, connection.access_token), discoverAdAccounts(connection.business_id, connection.access_token)]);
  const now = new Date().toISOString();
  if (!pixels.ok && !accounts.ok) {
    const type = pixels.message.match(/node type \((\w+)\)/i)?.[1];
    const message = `Meta would not list this business's Pixels or ad accounts: ${type && type.toLowerCase() !== "business" ? `Meta says ID ${connection.business_id} is a ${type}, not a business` : pixels.message.replace(/\.$/, "")}. Check the Business ID (Business Settings → Business info) and that the token has business_management.`;
    await supabase.from("tracking_meta_connections").update({ last_sync_at: now, last_sync_ok: false, last_sync_message: message }).eq("id", connection.id);
    throw httpError(400, `Couldn't sync. ${message}`);
  }
  // First sync switches on everything the token can use; later syncs add new
  // finds switched off, for the Owner to switch on.
  const firstSync = !connection.last_sync_at;
  let newPixels = 0;
  let newAccounts = 0;
  if (pixels.ok) {
    const { data: existing } = await supabase.from("tracking_data_sources").select("id, pixel_id, connection_id, name").eq("org_id", orgId).eq("branch_id", branchId);
    const byPixel = new Map((existing ?? []).map((row: any) => [String(row.pixel_id), row]));
    for (const pixel of pixels.pixels) {
      const found: any = byPixel.get(pixel.id);
      if (found) {
        await supabase.from("tracking_data_sources").update({ connection_id: found.connection_id ?? connection.id, has_access: pixel.hasAccess, meta_last_fired_at: pixel.lastFiredAt, dataset_name: pixel.name || null, updated_at: now }).eq("id", found.id);
      } else {
        newPixels += 1;
        const { error } = await supabase.from("tracking_data_sources").insert({
          org_id: orgId, branch_id: branchId, connection_id: connection.id, name: pixel.name || `Pixel ${pixel.id}`, platform: "meta", pixel_id: pixel.id,
          business_name: connection.name, dataset_name: pixel.name || null, has_access: pixel.hasAccess, meta_last_fired_at: pixel.lastFiredAt,
          active: firstSync && pixel.hasAccess, status: "production", currency: connection.currency, timezone: connection.timezone
        });
        if (error) throw error;
      }
    }
    // Pixels Meta no longer lists for this business can no longer be used.
    const seen = new Set(pixels.pixels.map((pixel) => pixel.id));
    const gone = (existing ?? []).filter((row: any) => row.connection_id === connection.id && !seen.has(String(row.pixel_id))).map((row: any) => row.id);
    if (gone.length) await supabase.from("tracking_data_sources").update({ has_access: false, updated_at: now }).in("id", gone);
  }
  if (accounts.ok) {
    const { data: existing } = await supabase.from("tracking_meta_ad_accounts").select("id, account_id").eq("connection_id", connection.id);
    const byAccount = new Map((existing ?? []).map((row: any) => [String(row.account_id), row]));
    for (const account of accounts.accounts) {
      const fields = { name: account.name, currency: account.currency, timezone: account.timezone, account_status: account.status, has_access: account.hasAccess, last_seen_at: now };
      const found: any = byAccount.get(account.accountId);
      if (found) await supabase.from("tracking_meta_ad_accounts").update(fields).eq("id", found.id);
      else {
        newAccounts += 1;
        const { error } = await supabase.from("tracking_meta_ad_accounts").insert({ org_id: orgId, branch_id: branchId, connection_id: connection.id, account_id: account.accountId, active: firstSync && account.hasAccess, ...fields });
        if (error) throw error;
      }
    }
  }
  const pixelCount = pixels.ok ? pixels.pixels.length : 0;
  const accountCount = accounts.ok ? accounts.accounts.length : 0;
  const noAccess = pixels.ok ? pixels.pixels.filter((pixel) => !pixel.hasAccess).length : 0;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  // Meta's "nonexisting field (owned_pixels) on node type (User)" = the ID is not a business.
  const why = (raw: string) => { const type = raw.match(/node type \((\w+)\)/i)?.[1]; return type && type.toLowerCase() !== "business" ? `Meta says ID ${connection.business_id} is a ${type}, not a business` : raw.replace(/\.$/, ""); };
  const accountsNoAccess = accounts.ok ? accounts.accounts.filter((account) => !account.hasAccess).length : 0;
  const listText = (label: string, list: { ok: true; count: number } | { ok: false; message: string }) => (list.ok ? `${label} ${list.count}` : `${label}: couldn't read (${why(list.message)})`);
  // Say exactly what was and was not read (Bright: messages must be accurate).
  const lines: string[] = [];
  if (!pixels.ok) lines.push(`Meta would not list this business's Pixels: ${why(pixels.message)}. Check the Business ID (Business Settings → Business info) and that the token has business_management.`);
  else {
    const lists = `owned by the business ${pixels.lists.owned.ok ? pixels.lists.owned.count : "?"} · shared with it ${pixels.lists.shared.ok ? pixels.lists.shared.count : "?"}`;
    const unread = [!pixels.lists.owned.ok ? listText("owned list", pixels.lists.owned) : null, !pixels.lists.shared.ok ? listText("shared list", pixels.lists.shared) : null].filter(Boolean).join("; ");
    lines.push(pixelCount === 0 && !unread
      ? "Pixels: none owned by or shared with this business. Give the Pixels to the System User (Business Settings → System Users → Assign assets)."
      : `Pixels: ${plural(pixelCount, "Pixel")} (${lists})${newPixels ? `, ${newPixels} new` : ""}${noAccess ? `; ${noAccess} not given to the System User yet` : ""}${unread ? `. ${unread}` : ""}.`);
  }
  if (!accounts.ok) lines.push(`Meta would not list the ad accounts: ${why(accounts.message)}.`);
  else {
    const all = [listText("owned by the business", accounts.lists.owned), listText("shared with the business", accounts.lists.shared), listText("given to the System User", accounts.lists.assigned)].join(" · ");
    const allRead = accounts.lists.owned.ok && accounts.lists.shared.ok && accounts.lists.assigned.ok;
    if (accountCount === 0 && allRead) lines.push(`Ad accounts: none (${all}). If the business uses an ad account, it is owned elsewhere: in Business Settings → Accounts → Ad accounts, check "Owned by", then give it to the System User (System Users → Assign assets).`);
    else lines.push(`Ad accounts: ${plural(accountCount, "ad account")} (${all})${newAccounts ? `, ${newAccounts} new` : ""}${accountsNoAccess ? `; ${accountsNoAccess === accountCount ? "none" : accountsNoAccess} ${accountsNoAccess === accountCount ? "given" : "not given"} to the System User yet` : ""}.`);
  }
  if (!firstSync && newPixels + newAccounts > 0) lines.push("New finds are switched off until you switch them on.");
  const ok = pixels.ok && accounts.ok && pixels.lists.owned.ok && pixels.lists.shared.ok && accounts.lists.owned.ok && accounts.lists.shared.ok && accounts.lists.assigned.ok;
  const message = lines.join(" ");
  await supabase.from("tracking_meta_connections").update({ last_sync_at: now, last_sync_ok: ok, last_sync_message: message, updated_at: now }).eq("id", connection.id);
  return { ok, message, pixels: pixelCount, newPixels, accounts: accountCount, newAccounts, noAccess };
}

const ConnectionSchema = z.object({
  accessToken: z.string().trim().max(5000).optional(),
  businessId: z.string().trim().regex(/^\d{5,25}$/, "A Business ID is a number (Business Settings → Business info).").optional().or(z.literal("")),
  currency: z.string().trim().max(8).default("NGN"),
  timezone: z.string().trim().max(60).default("Africa/Lagos")
});

/** Connect step 1: who is this token, and which businesses can it see? */
router.post("/connections/lookup", async (req, res) => {
  const parsed = z.object({ accessToken: z.string().trim().min(10).max(5000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Paste the System User token." }); return; }
  try {
    const who = await metaWhoAmI(parsed.data.accessToken);
    if (!who.ok) { const human = humanMetaError(who.message, who.status ?? null); throw httpError(400, `${human.title}. ${human.action}`); }
    res.json({ userName: who.userName, businesses: who.businesses, businessesError: who.businessesError ? humanMetaError(who.businessesError, null).title : null });
  } catch (error: any) { fail(res, error, "Could not check the token."); }
});

router.post("/connections", async (req, res) => {
  const parsed = ConnectionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const token = parsed.data.accessToken ?? "";
    if (!token) throw httpError(400, "Paste the System User token.");
    const who = await metaWhoAmI(token);
    if (!who.ok) { const human = humanMetaError(who.message, who.status ?? null); throw httpError(400, `${human.title}. ${human.action}`); }
    let businessId = parsed.data.businessId || "";
    let businessName = "";
    if (businessId) {
      const business = await metaBusiness(businessId, token);
      if (!business.ok) throw httpError(400, business.notBusiness
        ? `${business.message} Use the Business portfolio ID from Meta Business Settings → Business info.`
        : `This token cannot see business ${businessId}: ${business.message}`);
      businessName = business.name;
    } else if (who.businesses.length === 1) {
      businessId = who.businesses[0].id;
      businessName = who.businesses[0].name;
    } else if (who.businesses.length > 1) {
      res.status(409).json({ error: `This token can see ${who.businesses.length} businesses. Choose which one to connect.`, code: "choose_business", businesses: who.businesses });
      return;
    } else {
      throw httpError(400, "Meta did not say which business this token belongs to. Enter the Business ID (Meta Business Settings → Business info).");
    }
    const now = new Date().toISOString();
    const { data: connection, error } = await supabase.from("tracking_meta_connections").insert({
      org_id: orgId, branch_id: branchId, name: businessName, business_id: businessId, system_user_id: who.userId, system_user_name: who.userName,
      access_token: token, currency: parsed.data.currency, timezone: parsed.data.timezone, last_check_at: now, last_check_ok: true, last_check_message: "Connected", created_by: req.user!.id
    }).select("*").single();
    if (error) throw error.code === "23505" ? httpError(409, "This Meta Business is already connected. Open it and press Sync Assets.") : error;
    await hubAudit(orgId, branchId, actorOf(req), "connection_added", { type: "connection", id: connection.id, label: businessName });
    let sync: Awaited<ReturnType<typeof syncConnection>> | null = null;
    let syncError: string | null = null;
    try { sync = await syncConnection(orgId, branchId, connection); } catch (err: any) { syncError = err?.message ?? "Could not read the business's assets."; }
    res.status(201).json({ id: connection.id, name: businessName, sync, syncError });
  } catch (error: any) { fail(res, error, "Could not connect the business."); }
});

router.put("/connections/:id", async (req, res) => {
  const parsed = ConnectionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the form." }); return; }
  try {
    const connection = await loadConnection(req);
    const update: Record<string, unknown> = { currency: parsed.data.currency, timezone: parsed.data.timezone, updated_at: new Date().toISOString() };
    const newToken = parsed.data.accessToken && parsed.data.accessToken !== SECRET_MASK ? parsed.data.accessToken : "";
    const token = newToken || connection.access_token || "";
    const newBusinessId = parsed.data.businessId && parsed.data.businessId !== connection.business_id ? parsed.data.businessId : "";
    if (newToken) {
      const who = await metaWhoAmI(newToken);
      if (!who.ok) { const human = humanMetaError(who.message, who.status ?? null); throw httpError(400, `${human.title}. ${human.action}`); }
      Object.assign(update, { access_token: newToken, system_user_id: who.userId, system_user_name: who.userName, last_check_at: new Date().toISOString(), last_check_ok: true, last_check_message: "Connected" });
    }
    if (newToken || newBusinessId) {
      if (!token) throw httpError(400, "Paste the System User token too.");
      const businessId = newBusinessId || connection.business_id;
      const business = await metaBusiness(businessId, token);
      if (!business.ok) throw httpError(400, business.notBusiness
        ? `${business.message} Use the Business portfolio ID from Meta Business Settings → Business info.`
        : `This token cannot see business ${businessId}: ${business.message}`);
      // A different business starts fresh: its first sync switches on what the token can use.
      if (newBusinessId) Object.assign(update, { business_id: newBusinessId, name: business.name, last_sync_at: null, last_sync_ok: null, last_sync_message: null });
      Object.assign(update, { last_check_at: new Date().toISOString(), last_check_ok: true, last_check_message: "Connected" });
    }
    const saved = await supabase.from("tracking_meta_connections").update(update).eq("id", connection.id).select("*").single();
    if (saved.error) throw saved.error.code === "23505" ? httpError(409, "That business is already connected on another card.") : saved.error;
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "connection_updated", { type: "connection", id: connection.id, label: saved.data.name }, { tokenChanged: Boolean(newToken), businessChanged: Boolean(newBusinessId) });
    let sync: Awaited<ReturnType<typeof syncConnection>> | null = null;
    let syncError: string | null = null;
    if (newBusinessId || newToken) {
      try { sync = await syncConnection(req.user!.orgId, branchOf(req), saved.data); } catch (err: any) { syncError = err?.message ?? "Couldn't sync."; }
    }
    res.json({ ok: true, name: saved.data.name, sync, syncError });
  } catch (error: any) { fail(res, error, "Could not save the connection."); }
});

router.post("/connections/:id/test", async (req, res) => {
  try {
    const connection = await loadConnection(req);
    if (!connection.access_token) throw httpError(400, "This connection has no token. Paste a System User token first.");
    const who = await metaWhoAmI(connection.access_token);
    const business = who.ok ? await metaBusiness(connection.business_id, connection.access_token) : null;
    const ok = who.ok && Boolean(business?.ok);
    const message = !who.ok ? who.message : !business?.ok ? (business && "notBusiness" in business && business.notBusiness ? `${business.message} Fix the Business ID (Replace token / settings).` : `The token can no longer see business ${connection.business_id}.`) : `Connected as ${who.userName ?? "the System User"}.`;
    await supabase.from("tracking_meta_connections").update({ last_check_at: new Date().toISOString(), last_check_ok: ok, last_check_message: message, ...(who.ok ? { system_user_name: who.userName } : {}) }).eq("id", connection.id);
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "connection_tested", { type: "connection", id: connection.id, label: connection.name }, { ok, message });
    res.json({ ok, message, human: ok ? null : humanMetaError(message, who.ok ? null : who.status ?? null) });
  } catch (error: any) { fail(res, error, "Could not test the connection."); }
});

router.post("/connections/:id/sync", async (req, res) => {
  try {
    const connection = await loadConnection(req);
    const result = await syncConnection(req.user!.orgId, branchOf(req), connection);
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "connection_synced", { type: "connection", id: connection.id, label: connection.name }, { message: result.message });
    res.json(result);
  } catch (error: any) { fail(res, error, "Could not sync."); }
});

/** Disconnect: removes the token. Its Pixels stop sending and reading until a new token is pasted. */
router.post("/connections/:id/disconnect", async (req, res) => {
  try {
    const connection = await loadConnection(req);
    await supabase.from("tracking_meta_connections").update({ access_token: null, last_check_ok: null, last_check_message: "Disconnected", updated_at: new Date().toISOString() }).eq("id", connection.id);
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "connection_disconnected", { type: "connection", id: connection.id, label: connection.name });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not disconnect."); }
});

/** Remove a connection. Its Pixels stay as data sources but no longer have its token. */
router.delete("/connections/:id", async (req, res) => {
  try {
    const connection = await loadConnection(req);
    const { error } = await supabase.from("tracking_meta_connections").delete().eq("id", connection.id);
    if (error) throw error;
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "connection_removed", { type: "connection", id: connection.id, label: connection.name });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not remove the connection."); }
});

router.put("/data-sources/:id/active", async (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "On or off?" }); return; }
  try {
    const source = await loadSource(req);
    await supabase.from("tracking_data_sources").update({ active: parsed.data.active, updated_at: new Date().toISOString() }).eq("id", source.id);
    const { count } = await supabase.from("meta_capi_configs").select("id", { count: "exact", head: true }).eq("org_id", req.user!.orgId).eq("data_source_id", source.id).eq("active", true);
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), parsed.data.active ? "pixel_on" : "pixel_off", { type: "data_source", id: source.id, label: source.name });
    res.json({ ok: true, linksUsing: count ?? 0 });
  } catch (error: any) { fail(res, error, "Could not change the Pixel."); }
});

router.put("/ad-accounts/:id/active", async (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "On or off?" }); return; }
  try {
    const { data, error } = await supabase.from("tracking_meta_ad_accounts").update({ active: parsed.data.active }).eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id)).select("name, account_id").maybeSingle();
    if (error) throw error;
    if (!data) throw httpError(404, "Ad account not found.");
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), parsed.data.active ? "ad_account_on" : "ad_account_off", { type: "ad_account", id: String(req.params.id), label: data.name || `act_${data.account_id}` });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not change the ad account."); }
});

/** Header "Test Event": a test Purchase to Meta's Test Events tab. */
router.post("/test-event", async (req, res) => {
  const parsed = z.object({ dataSourceId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose a data source." }); return; }
  try {
    const { data: found } = await supabase.from("tracking_data_sources").select("*").eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", parsed.data.dataSourceId).maybeSingle();
    if (!found) throw httpError(404, "Data source not found.");
    const source = { ...found, access_token: found.access_token || (await connectionToken(found.connection_id)) };
    if (!source.access_token) throw httpError(400, "Add the access token first.");
    if (!source.test_event_code) throw httpError(400, "Add the Test Event Code (Meta Events Manager → Test Events) to this data source first, so the test does not count as a real sale.");
    const eventId = `protohub_test_${Date.now()}`;
    const result = await sendMetaCapiPurchase({
      config: { mode: "hybrid", pixelId: source.pixel_id, accessToken: source.access_token, testEventCode: source.test_event_code, testMode: false },
      eventId, customer: "Protohub Test", phone: "08000000000", country: "ng", value: 1, currency: source.currency ?? "NGN",
      orderId: eventId, productId: "test", productName: "Tracking Hub test", packageId: "test", packageName: "Test", quantity: 1, eventSourceUrl: "https://protohub.app/tracking-hub-test"
    });
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "test_event_sent", { type: "data_source", id: source.id, label: source.name }, { status: result.status });
    res.json({ ok: result.status === "sent", status: result.status, eventId, message: result.status === "sent" ? `Sent. Look for event id ${eventId} in Meta Test Events.` : humanMetaError(result.message, result.httpStatus).title });
  } catch (error: any) { fail(res, error, "Could not send the test event."); }
});

// ================================================================ WEBSITES

router.get("/websites", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const assessment = await assess(orgId, branchId);
    const rows = assessment.websiteRows;
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const known = new Set(rows.map((site: any) => site.domain));
    const recent = await formOrders(orgId, branchId, addDaysToDateKey(lagosDateKey(), -29), lagosDateKey());
    const detected = new Map<string, number>();
    for (const order of recent) {
      const domain = domainOf(order.form_context?.landingPageUrl) ?? domainOf(order.referrer);
      if (domain && !known.has(domain)) detected.set(domain, (detected.get(domain) ?? 0) + 1);
    }
    const healthy = rows.filter((row: any) => row.status === "healthy").length;
    const wordpress = rows.filter((row: any) => row.platform === "WordPress").length;
    res.json({
      kpis: {
        total: rows.length, newThisMonth: rows.filter((row: any) => row.createdAt >= monthAgo).length,
        wordpress, wordpressPct: pct(wordpress, rows.length),
        healthy, healthyPct: pct(healthy, rows.length), withIssues: rows.length - healthy, withIssuesPct: pct(rows.length - healthy, rows.length),
        landingPages: rows.reduce((sum: number, row: any) => sum + row.landingPages.length, 0),
        externalForms: assessment.basics.links.filter((link: any) => link.active !== false).length
      },
      websites: rows,
      detected: Array.from(detected.entries()).sort((a, b) => b[1] - a[1]).map(([domain, orders]) => ({ domain, orders30d: orders })),
      dataSources: assessment.sourceRows.map((row: any) => ({ id: row.id, name: row.name, platform: row.platform, isMain: row.isMain }))
    });
  } catch (error: any) { fail(res, error, "Could not load the websites."); }
});

router.get("/websites/:id", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const assessment = await assess(orgId, branchId);
    const site = assessment.websiteRows.find((row: any) => row.id === String(req.params.id));
    if (!site) throw httpError(404, "Website not found.");
    const today = lagosDateKey();
    const [orders60, journey2] = await Promise.all([
      formOrders(orgId, branchId, addDaysToDateKey(today, -59), today),
      journeyCounts(orgId, branchId, addDaysToDateKey(today, -1), today).catch(() => [] as JourneyRow[])
    ]);
    const siteOrders = orders60.filter((order) => (domainOf(order.form_context?.landingPageUrl) ?? domainOf(order.referrer)) === site.domain);
    const last30 = siteOrders.filter((order) => dayOfIso(order.created_at) > addDaysToDateKey(today, -30)).length;
    const prev30 = siteOrders.length - last30;
    const source = assessment.sourceRows.find((row: any) => row.id === site.dataSourceId);
    const siteLinks = assessment.basics.links.filter((link: any) => link.website_id === site.id);
    const capture = attributionCapture(siteOrders.filter((order) => dayOfIso(order.created_at) > addDaysToDateKey(today, -7)));
    const usesProtohub = siteLinks.some((link: any) => link.mode === "hybrid" || link.mode === "protohub");
    const yesterday = addDaysToDateKey(today, -1);
    const onSite = (row: JourneyRow) => row.domain === site.domain;
    const dayOrders = (day: string) => siteOrders.filter((order) => dayOfIso(order.created_at) === day).length;
    const recent = [
      { name: "PageView", type: "form_opened" }, { name: "InitiateCheckout", type: "first_interaction" },
      { name: "Purchase", type: "orders" }, { name: "AddToCart", type: "submit_attempted" }
    ].map((item) => {
      const now = item.type === "orders" ? dayOrders(today) : sumVisits(journey2, item.type, (row) => onSite(row) && row.day === today);
      const before = item.type === "orders" ? dayOrders(yesterday) : sumVisits(journey2, item.type, (row) => onSite(row) && row.day === yesterday);
      return { name: item.name, count: now, change: change(now, before) };
    });
    // Conversions API: every Pixel this site's links (or its default) use.
    const capiIds = new Set<string>([...siteLinks.map((link: any) => link.data_source_id).filter(Boolean), site.dataSourceId].filter(Boolean) as string[]);
    const capiPixels = assessment.sourceRows.filter((row: any) => capiIds.has(row.id));
    // Each landing page: its tracking link, the Pixel that link uses, what the
    // page was seen loading (last scan + browser reports), and a verdict.
    const { data: beacons } = await supabase.from("tracking_browser_events").select("page_url, pixel_id, pixels_on_page, fired_at")
      .eq("org_id", orgId).eq("page_domain", site.domain).gte("fired_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).order("fired_at", { ascending: false }).limit(2000);
    const sourceById = new Map(assessment.basics.sources.map((row: any) => [row.id, row]));
    const pixelName = (pixelId: string) => assessment.basics.sources.find((row: any) => row.pixel_id === pixelId)?.name ?? null;
    const landingStats = (site.landingPages as string[]).map((path) => {
      const link: any = siteLinks.find((row: any) => pathOf(row.landing_page_url) === path) ?? null;
      const expected: any = link?.data_source_id ? sourceById.get(link.data_source_id) : source ? sourceById.get(source.id) : null;
      const scanned = (site.lastScan?.pages ?? []).find((page: any) => pathOf(page.url) === path) ?? null;
      const pageBeacons = (beacons ?? []).filter((row: any) => pathOf(row.page_url) === path);
      const seen = Array.from(new Set<string>([...((scanned?.pixels ?? []) as string[]), ...pageBeacons.flatMap((row: any) => (row.pixels_on_page ?? []) as string[])]));
      const extras = ((link?.extra_data_source_ids ?? []) as string[]).map((extraId) => sourceById.get(extraId) as any).filter(Boolean);
      const expectedIds = [expected?.pixel_id, ...extras.map((row: any) => row.pixel_id)].filter(Boolean) as string[];
      const status = !link ? "no_link"
        : seen.length === 0 ? (scanned || pageBeacons.length ? "missing_pixel" : "not_checked")
        : expectedIds.some((id) => !seen.includes(id)) ? "wrong_pixel"
        : seen.some((id) => !expectedIds.includes(id)) && seen.length > 1 ? "two_pixels" : "ok";
      return {
        path, orders30d: siteOrders.filter((order) => pathOf(order.form_context?.landingPageUrl) === path).length,
        link: link?.label ?? null, linkId: link?.id ?? null, strategy: link ? STRATEGY_OF_MODE[link.mode] ?? "landing_page" : null,
        expectedPixel: expected ? { id: expected.pixel_id, name: expected.name, fromDefault: !link?.data_source_id } : null,
        extraPixels: extras.map((row: any) => ({ id: row.pixel_id, name: row.name, seen: seen.includes(row.pixel_id) })),
        foundPixels: seen.map((id) => ({ id, name: pixelName(id) })),
        lastBrowserEvent: pageBeacons[0]?.fired_at ?? null, checkedAt: scanned ? site.lastScanAt : null, status
      };
    });
    const dedup = assessment.items.find((item) => item.key === "dedup");
    const scanPixels = (site.lastScan?.pages ?? []).some((page: any) => page.pixels?.length);
    res.json({
      ...site,
      siteUrl: `https://${site.domain}`,
      dataSource: source ? { id: source.id, name: source.name, isMain: source.isMain, hasToken: source.hasToken, platform: source.platform } : null,
      orders30d: last30, orders30dChange: change(last30, prev30),
      landingStats,
      forms: siteLinks.map((link: any) => ({ id: link.id, label: link.label, landingPath: pathOf(link.landing_page_url), strategy: STRATEGY_OF_MODE[link.mode] ?? "landing_page", active: link.active !== false })),
      checks: [
        { key: "browser", label: "Browser Pixel Detected", ok: site.browserPages === 0 ? Boolean(site.lastBrowserEvent || scanPixels) : site.browserSeenPages === site.browserPages,
          value: site.browserPages === 0 ? (site.lastBrowserEvent || scanPixels ? "Yes" : "Not seen yet") : `On ${site.browserSeenPages} of ${site.browserPages} landing page${site.browserPages === 1 ? "" : "s"}` },
        { key: "capi", label: "Conversions API", ok: capiPixels.length > 0 && capiPixels.every((row: any) => row.hasToken),
          value: capiPixels.length === 0 ? "No Pixel chosen" : capiPixels.every((row: any) => row.hasToken) ? `Connected${capiPixels.length > 1 ? ` (all ${capiPixels.length} Pixels)` : ""}` : `Connected for ${capiPixels.filter((row: any) => row.hasToken).length} of ${capiPixels.length} Pixels` },
        { key: "duplicate", label: "Duplicate Pixel", ok: !site.duplicatePixel, value: site.duplicatePixel ? "Two Pixels on one page" : "None detected" },
        { key: "match", label: "Pixel matches its link", ok: !landingStats.some((row) => row.status === "wrong_pixel"),
          value: landingStats.some((row) => row.status === "wrong_pixel") ? `Wrong Pixel on ${landingStats.filter((row) => row.status === "wrong_pixel").length} of ${landingStats.filter((row) => row.link).length} page(s)`
            : landingStats.some((row) => row.status === "not_checked" && row.link) ? (landingStats.some((row) => row.status === "ok" || row.status === "two_pixels") ? "Yes, on the pages checked" : "Not checked yet") : landingStats.some((row) => row.link) ? "Yes" : "No tracking links yet" },
        { key: "params", label: "Campaign Parameters", ok: capture.orders === 0 || capture.fields.fbclid >= 50, value: capture.orders === 0 ? "No ad orders this week" : capture.fields.fbclid >= 50 ? "Capturing (fbclid, fbp, fbc, utm)" : `Only ${capture.fields.fbclid}% carry fbclid` },
        { key: "purchase", label: "Purchase Event", ok: true, value: usesProtohub ? "Firing from Protohub orders" : "Thank-you page Pixel" },
        { key: "dedup", label: "Event Deduplication", ok: dedup?.healthy === 1, value: dedup?.detail ?? "" }
      ],
      recent,
      issues: assessment.issues.filter((issue) => issue.subjectId === site.id)
    });
  } catch (error: any) { fail(res, error, "Could not load the website."); }
});

const WebsiteSchema = z.object({
  domain: z.string().trim().min(3).max(255),
  label: z.string().trim().max(120).default(""),
  platform: z.enum(["WordPress", "Shopify", "Custom", "Other"]).default("WordPress"),
  dataSourceId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional()
});

async function saveWebsite(req: Request, id: string | null) {
  const parsed = WebsiteSchema.safeParse(req.body);
  if (!parsed.success) throw httpError(400, "Check the website.");
  const domain = domainOf(parsed.data.domain);
  if (!domain) throw httpError(400, "That does not look like a website address.");
  const orgId = req.user!.orgId;
  const branchId = branchOf(req);
  const row = { org_id: orgId, branch_id: branchId, domain, label: parsed.data.label, platform: parsed.data.platform, data_source_id: parsed.data.dataSourceId ?? null, notes: parsed.data.notes ?? null, updated_at: new Date().toISOString() };
  const result = id
    ? await supabase.from("tracking_websites").update(row).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("id").single()
    : await supabase.from("tracking_websites").insert({ ...row, created_by: req.user!.id }).select("id").single();
  if (result.error) throw result.error.code === "23505" ? httpError(409, "This website is already added.") : result.error;
  await hubAudit(orgId, branchId, actorOf(req), id ? "website_updated" : "website_added", { type: "website", id: result.data.id, label: domain });
  return result.data;
}
router.post("/websites", async (req, res) => { try { res.status(201).json(await saveWebsite(req, null)); } catch (error: any) { fail(res, error, "Could not save the website."); } });
router.put("/websites/:id", async (req, res) => { try { res.json(await saveWebsite(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the website."); } });
router.delete("/websites/:id", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { error } = await supabase.from("tracking_websites").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", String(req.params.id));
    if (error) throw error;
    await hubAudit(orgId, branchId, actorOf(req), "website_deleted", { type: "website", id: String(req.params.id) });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the website."); }
});

const isPublicHttpUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    return !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|169\.254\.)/i.test(url.hostname);
  } catch { return false; }
};

/** Scan Website / Test Website: load the home page, each link's landing page and thank-you page. */
router.post("/websites/:id/scan", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { data: site } = await supabase.from("tracking_websites").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("id", String(req.params.id)).maybeSingle();
    if (!site) throw httpError(404, "Website not found.");
    const { data: links } = await supabase.from("meta_capi_configs").select("landing_page_url, redirect_url, mode").eq("org_id", orgId).eq("website_id", site.id);
    const urls = new Map<string, "home" | "landing" | "thank_you">([[`https://${site.domain}/`, "home"]]);
    for (const link of links ?? []) {
      if (link.landing_page_url && domainOf(link.landing_page_url) === site.domain) urls.set(link.landing_page_url, "landing");
      if (link.redirect_url && domainOf(link.redirect_url) === site.domain) urls.set(link.redirect_url, "thank_you");
    }
    const pages = [];
    for (const [url, kind] of Array.from(urls.entries()).slice(0, 12)) {
      if (!isPublicHttpUrl(url)) continue;
      pages.push({ ...(await scanPage(url)), kind });
    }
    const scan = { pages, at: new Date().toISOString() };
    await supabase.from("tracking_websites").update({ last_scan: scan, last_scan_at: scan.at }).eq("id", site.id);
    await hubAudit(orgId, branchId, actorOf(req), "website_scanned", { type: "website", id: site.id, label: site.domain }, { pages: pages.length });
    const allPixels = Array.from(new Set(pages.flatMap((page) => page.pixels)));
    const { data: sourcesForScan } = await supabase.from("tracking_data_sources").select("id, name, pixel_id").eq("org_id", orgId).eq("branch_id", branchId);
    const { data: linksForScan } = await supabase.from("meta_capi_configs").select("landing_page_url, data_source_id, label").eq("org_id", orgId).eq("website_id", site.id);
    const nameOf = (pixelId: string) => (sourcesForScan ?? []).find((row: any) => row.pixel_id === pixelId)?.name ?? pixelId;
    const pageLines = pages.filter((page) => page.kind === "landing").map((page) => {
      const link: any = (linksForScan ?? []).find((row: any) => pathOf(row.landing_page_url) === pathOf(page.url));
      const expected: any = (sourcesForScan ?? []).find((row: any) => row.id === (link?.data_source_id ?? site.data_source_id));
      const path = pathOf(page.url) ?? page.url;
      if (!page.ok) return `${path}: could not load (${page.error ?? `HTTP ${page.status}`}).`;
      if (page.pixels.length > 1) return `${path}: loads ${page.pixels.length} Pixels (${page.pixels.map(nameOf).join(", ")}). Remove the extra one.`;
      if (page.pixels.length === 0) return page.usesTagManager ? `${path}: no Pixel in the page itself (Google Tag Manager may load it).` : `${path}: no Pixel found.`;
      if (expected && page.pixels[0] !== expected.pixel_id) return `${path}: loads ${nameOf(page.pixels[0])}, but its link uses ${expected.name}.`;
      return `${path}: loads ${nameOf(page.pixels[0])}${expected ? " (matches its link)" : ""}.`;
    });
    const usesProtohub = (links ?? []).some((link: any) => link.mode === "hybrid" || link.mode === "protohub");
    const thankYouWithPurchase = pages.filter((page) => page.kind === "thank_you" && page.purchaseOnPage);
    res.json({
      scan,
      summary: [
        allPixels.length === 0 ? (pages.some((page) => page.usesTagManager) ? "No Pixel code in the pages themselves — Google Tag Manager may load it." : "No Meta Pixel found on the scanned pages.") : null,
        ...pageLines,
        pages.some((page) => page.protohubForm) ? "Protohub order form found." : "No Protohub order form found on these pages.",
        usesProtohub && thankYouWithPurchase.length ? `The thank-you page still fires Purchase (${thankYouWithPurchase.map((page) => page.url).join(", ")}) while Protohub also sends it — orders count twice.` : null
      ].filter(Boolean)
    });
  } catch (error: any) { fail(res, error, "Could not scan the website."); }
});

// ---------------------------------------------------------------- profiles

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
  const orgId = req.user!.orgId;
  const branchId = branchOf(req);
  const row = { org_id: orgId, branch_id: branchId, name: d.name, data_source_id: d.dataSourceId ?? null, default_website_id: d.defaultWebsiteId ?? null, strategy: d.strategy, ad_account_label: d.adAccountLabel, status: d.status, updated_at: new Date().toISOString() };
  const result = id
    ? await supabase.from("tracking_profiles").update(row).eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).select("*").single()
    : await supabase.from("tracking_profiles").insert(row).select("*").single();
  if (result.error) throw result.error;
  await hubAudit(orgId, branchId, actorOf(req), id ? "profile_updated" : "profile_created", { type: "profile", id: result.data.id, label: d.name });
  return presentProfile(result.data);
}
router.post("/profiles", async (req, res) => { try { res.status(201).json(await saveProfile(req, null)); } catch (error: any) { fail(res, error, "Could not save the profile."); } });
router.put("/profiles/:id", async (req, res) => { try { res.json(await saveProfile(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the profile."); } });
router.delete("/profiles/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("tracking_profiles").delete().eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", String(req.params.id));
    if (error) throw error;
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "profile_deleted", { type: "profile", id: String(req.params.id) });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the profile."); }
});

// ========================================================== TRACKING LINKS

function linkStats(key: string, rows: LedgerRow[], journey: JourneyRow[], days: string[]) {
  const linkRows = rows.filter((row) => row.trackingKey === key);
  const viewsOf = (day?: string) => sumVisits(journey, "form_opened", (row) => row.tracking_key === key && (!day || row.day === day));
  const views = viewsOf();
  const orders = linkRows.length;
  return {
    views, orders, conversionRate: pct(orders, views), revenue: linkRows.reduce((sum, row) => sum + row.value, 0),
    spark: days.map((day) => ({ day, views: viewsOf(day), orders: linkRows.filter((row) => dayOfIso(row.createdAt) === day).length }))
  };
}

const linkStatusOf = (healthy: boolean, conversionRate: number, views: number, low: number) =>
  !healthy ? "needs_review" : views >= 20 && conversionRate < low ? "low_performance" : "healthy";

const adUrlFor = (link: any) => {
  const base = String(link.landing_page_url ?? "").trim();
  if (!base) return null;
  try { const url = new URL(base); url.searchParams.set("ph_link", link.tracking_key); return url.toString(); } catch { return null; }
};

router.get("/links", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.query, 7);
    const [assessment, settings] = await Promise.all([assess(orgId, branchId), loadHubSettings(orgId, branchId)]);
    const loadFrom = period.compareFrom < period.from ? period.compareFrom : period.from;
    const [orders, journey] = await Promise.all([formOrders(orgId, branchId, loadFrom, period.to), journeyCounts(orgId, branchId, loadFrom, period.to).catch(() => [] as JourneyRow[])]);
    const events = await eventsFor(orgId, orders.map((order) => order.id));
    const allRows = orders.map((order) => ledgerRow(order, events));
    const inPeriod = (from: string, to: string) => (row: { createdAt: string }) => { const day = dayOfIso(row.createdAt); return day >= from && day <= to; };
    const nowRows = allRows.filter(inPeriod(period.from, period.to));
    const prevRows = allRows.filter(inPeriod(period.compareFrom, period.compareTo));
    const nowJourney = journey.filter((row) => row.day >= period.from && row.day <= period.to);
    const prevJourney = journey.filter((row) => row.day >= period.compareFrom && row.day <= period.compareTo);
    const days = lastNDays(period.to, Math.min(period.length, 31));
    const health = new Map(assessment.linkRows.map((row: any) => [row.id, row]));
    const basics = assessment.basics;
    const productOf = new Map(basics.products.map((row: any) => [row.id, row]));
    const links = basics.links.map((link: any) => {
      const key = String(link.tracking_key).toLowerCase();
      const source = basics.sources.find((row: any) => row.id === link.data_source_id);
      const site = basics.websites.find((row: any) => row.id === link.website_id);
      const profile = basics.profiles.find((row: any) => row.id === link.profile_id);
      const product: any = productOf.get(link.product_id);
      const linkHealth: any = health.get(link.id);
      const stats = linkStats(key, nowRows, nowJourney, days);
      const testCode = source?.status === "testing" ? source?.test_event_code ?? "" : link.test_event_code ?? "";
      return {
        id: link.id, trackingKey: link.tracking_key, label: link.label, active: link.active !== false,
        productId: link.product_id, productName: product?.name ?? null, productImage: product?.imageUrl ?? null,
        websiteId: link.website_id, websiteDomain: site?.domain ?? domainOf(link.landing_page_url),
        landingPageUrl: link.landing_page_url ?? "", landingPath: pathOf(link.landing_page_url), redirectUrl: link.redirect_url ?? "", formLabel: link.form_label ?? "",
        packageSet: link.package_set ?? null, currency: link.currency ?? null,
        dataSourceId: link.data_source_id, dataSourceName: source?.name ?? (link.pixel_id ? `Pixel ${link.pixel_id}` : null), dataSourcePlatform: source?.platform ?? "meta", pixelId: source?.pixel_id ?? link.pixel_id ?? null,
        profileId: link.profile_id, profileName: profile?.name ?? null,
        extraPixels: ((link.extra_data_source_ids ?? []) as string[]).map((extraId) => basics.sources.find((row: any) => row.id === extraId)).filter(Boolean).map((row: any) => ({
          id: row.id, name: row.name, pixelId: row.pixel_id, status: row.status, active: row.active !== false, hasToken: Boolean(row.effective_token)
        })),
        strategy: STRATEGY_OF_MODE[link.mode] ?? "landing_page", mode: link.mode, testEventCode: testCode,
        checklist: link.checklist ?? {}, adUrl: adUrlFor(link), createdAt: link.created_at, updatedAt: link.updated_at,
        stats, healthy: Boolean(linkHealth?.healthy), problems: linkHealth?.problems ?? [],
        status: link.active === false ? "paused" : linkStatusOf(Boolean(linkHealth?.healthy), stats.conversionRate, stats.views, settings.lowConversionRate)
      };
    });
    const { data: pageBeacons = [] } = await supabase.from("tracking_browser_events").select("page_domain, page_url, pixels_on_page")
      .eq("org_id", orgId).gte("fired_at", new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(2000) as any;
    // Each product's package sets (the order form shows one set) and their currency.
    const { data: packageRows } = await supabase.from("product_packages").select("product_id, package_set, currency").in("product_id", basics.products.map((row: any) => row.id)).eq("active", true);
    const packageSetsOf = new Map<string, Array<{ name: string; currency: string | null; packages: number }>>();
    for (const pack of packageRows ?? []) {
      const list = packageSetsOf.get(pack.product_id) ?? [];
      const name = String(pack.package_set ?? "").trim() || "Default";
      const found = list.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (found) found.packages += 1; else list.push({ name, currency: pack.currency ?? null, packages: 1 });
      packageSetsOf.set(pack.product_id, list);
    }
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const linkKeys = new Set(links.map((link: any) => String(link.trackingKey).toLowerCase()));
    const ordersNow = nowRows.filter((row) => row.trackingKey && linkKeys.has(row.trackingKey)).length;
    const ordersPrev = prevRows.filter((row) => row.trackingKey && linkKeys.has(row.trackingKey)).length;
    const viewsNow = sumVisits(nowJourney, "form_opened", (row) => Boolean(row.tracking_key && linkKeys.has(row.tracking_key)));
    const viewsPrev = sumVisits(prevJourney, "form_opened", (row) => Boolean(row.tracking_key && linkKeys.has(row.tracking_key)));
    const healthyCount = links.filter((link: any) => link.status === "healthy").length;
    res.json({
      period,
      kpis: {
        total: links.length, newThisMonth: links.filter((link: any) => (link.createdAt ?? "") >= monthAgo).length,
        orders: ordersNow, ordersChange: change(ordersNow, ordersPrev),
        pageViews: viewsNow, pageViewsChange: change(viewsNow, viewsPrev),
        conversionRate: pct(ordersNow, viewsNow), conversionRateChange: Math.round((pct(ordersNow, viewsNow) - pct(ordersPrev, viewsPrev)) * 10) / 10,
        healthy: healthyCount, healthyPct: pct(healthyCount, links.length)
      },
      links,
      products: basics.products.map((row: any) => ({ id: row.id, name: row.name, packageSets: packageSetsOf.get(row.id) ?? [] })).sort((a: any, b: any) => a.name.localeCompare(b.name)),
      // Pixel pickers show the id, business and last event, and recommend Pixels.
      dataSources: assessment.sourceRows.map((row: any) => ({
        id: row.id, name: row.name, pixelId: row.pixelId, status: row.status, platform: row.platform,
        business: row.connectionName || row.businessName || null, active: row.active, hasAccess: row.hasAccess, health: row.health, lastFiredAt: row.metaLastFiredAt
      })),
      // Pixels each landing page was seen loading (last scan + browser reports).
      websites: basics.websites.map((row: any) => {
        const pages: Record<string, string[]> = {};
        const add = (url: string | null | undefined, ids: string[]) => { const path = pathOf(url); if (!path) return; pages[path] = Array.from(new Set([...(pages[path] ?? []), ...ids])); };
        for (const page of ((row.last_scan as any)?.pages ?? [])) add(page.url, page.pixels ?? []);
        for (const beacon of (pageBeacons ?? []).filter((item: any) => item.page_domain === row.domain)) add(beacon.page_url, beacon.pixels_on_page ?? []);
        return { id: row.id, domain: row.domain, dataSourceId: row.data_source_id, pagePixels: pages };
      }),
      profiles: basics.profiles.map(presentProfile),
      defaultStrategy: settings.defaultStrategy,
      urlParameters: settings.urlParameters
    });
  } catch (error: any) { fail(res, error, "Could not load the tracking links."); }
});

router.get("/links/:id", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const days = Math.min(30, Math.max(7, Number(req.query.days) || 7));
    const today = lagosDateKey();
    const from = addDaysToDateKey(today, -(2 * days - 1));
    const basics = await loadBasics(orgId, branchId);
    const link: any = basics.links.find((row: any) => row.id === String(req.params.id));
    if (!link) throw httpError(404, "Tracking link not found.");
    const key = String(link.tracking_key).toLowerCase();
    const [orders, journey, totalRes] = await Promise.all([
      formOrders(orgId, branchId, from, today), journeyCounts(orgId, branchId, from, today).catch(() => [] as JourneyRow[]),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("form_context->>metaTrackingKey", link.tracking_key)
    ]);
    const events = await eventsFor(orgId, orders.map((order) => order.id));
    const rows = orders.map((order) => ledgerRow(order, events)).filter((row) => row.trackingKey === key);
    const split = addDaysToDateKey(today, -days);
    const nowRows = rows.filter((row) => dayOfIso(row.createdAt) > split);
    const prevRows = rows.filter((row) => dayOfIso(row.createdAt) <= split);
    const nowViews = sumVisits(journey, "form_opened", (row) => row.tracking_key === key && row.day > split);
    const prevViews = sumVisits(journey, "form_opened", (row) => row.tracking_key === key && row.day <= split);
    const revenue = (list: LedgerRow[]) => list.reduce((sum, row) => sum + row.value, 0);
    const campaigns = new Map<string, { orders: number; views: number }>();
    for (const row of nowRows) if (row.campaignId) { const entry = campaigns.get(row.campaignId) ?? { orders: 0, views: 0 }; entry.orders += 1; campaigns.set(row.campaignId, entry); }
    for (const row of journey.filter((item) => item.event_type === "form_opened" && item.tracking_key === key && item.day > split && item.campaign_id)) {
      const entry = campaigns.get(row.campaign_id!) ?? { orders: 0, views: 0 }; entry.views += row.visits; campaigns.set(row.campaign_id!, entry);
    }
    const source = basics.sources.find((row: any) => row.id === link.data_source_id);
    const site = basics.websites.find((row: any) => row.id === link.website_id);
    const product: any = basics.products.find((row: any) => row.id === link.product_id);
    const linkOrders = orders.filter((order) => String(order.form_context?.metaTrackingKey ?? "").toLowerCase() === key && dayOfIso(order.created_at) > split);
    const capture = attributionCapture(linkOrders);
    res.json({
      id: link.id, label: link.label, trackingKey: link.tracking_key, adUrl: adUrlFor(link), landingPageUrl: link.landing_page_url ?? "",
      productName: product?.name ?? null, productImage: product?.imageUrl ?? null, websiteDomain: site?.domain ?? domainOf(link.landing_page_url), dataSourceName: source?.name ?? null,
      landingPath: pathOf(link.landing_page_url), formLabel: link.form_label ?? "", redirectPath: pathOf(link.redirect_url) ?? link.redirect_url ?? "",
      createdAt: link.created_at, updatedAt: link.updated_at, totalOrders: totalRes.count ?? rows.length,
      kpis: {
        views: nowViews, viewsChange: change(nowViews, prevViews), orders: nowRows.length, ordersChange: change(nowRows.length, prevRows.length),
        conversionRate: pct(nowRows.length, nowViews), conversionRateChange: Math.round((pct(nowRows.length, nowViews) - pct(prevRows.length, prevViews)) * 10) / 10,
        revenue: revenue(nowRows), revenueChange: change(revenue(nowRows), revenue(prevRows))
      },
      chart: lastNDays(today, days).map((day) => ({ day, views: sumVisits(journey, "form_opened", (row) => row.tracking_key === key && row.day === day), orders: nowRows.filter((row) => dayOfIso(row.createdAt) === day).length })),
      campaigns: Array.from(campaigns.entries()).map(([campaignId, value]) => ({ campaignId, ...value })).sort((a, b) => b.orders - a.orders || b.views - a.views),
      attribution: ATTRIBUTION_FIELDS.map((field) => ({ ...field, pct: capture.fields[field.key] })), attributionOrders: capture.orders,
      events: nowRows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50)
    });
  } catch (error: any) { fail(res, error, "Could not load the link."); }
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
  packageSet: z.string().trim().max(80).default("Default"),
  currency: z.string().trim().max(8).default(""),
  // "Also send to": more Pixels that get every sale (same order id).
  extraDataSourceIds: z.array(z.string().uuid()).max(10).default([]),
  active: z.boolean().default(true)
});

async function saveLink(req: Request, id: string | null, body: unknown = req.body) {
  const parsed = LinkSchema.safeParse(body);
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
  // The links table requires pixel_id / access_token; a hub link keeps the
  // source's Pixel id and an empty token (read from the source when sending).
  let pixelId = "";
  if (dataSourceId) {
    const { data: source } = await supabase.from("tracking_data_sources").select("pixel_id").eq("id", dataSourceId).maybeSingle();
    pixelId = source?.pixel_id ?? "";
  }
  const extraIds = Array.from(new Set(d.extraDataSourceIds.filter((value) => value !== dataSourceId)));
  if (extraIds.length) {
    const { data: extras } = await supabase.from("tracking_data_sources").select("id, platform").eq("org_id", orgId).eq("branch_id", branchId).in("id", extraIds);
    if ((extras ?? []).length !== extraIds.length) throw httpError(400, "One of the extra Pixels was not found.");
    if ((extras ?? []).some((row: any) => (row.platform ?? "meta") !== "meta")) throw httpError(400, "Only Meta Pixels can be added as extra Pixels.");
    if (d.strategy === "landing_page") throw httpError(400, "Extra Pixels need Browser + CAPI or CAPI only.");
  }
  const row: Record<string, unknown> = {
    org_id: orgId, branch_id: branchId, label: d.label, product_id: d.productId ?? null, website_id: websiteId,
    profile_id: d.profileId ?? null, data_source_id: dataSourceId, mode: MODE_OF_STRATEGY[d.strategy], pixel_id: pixelId,
    landing_page_url: d.landingPageUrl || null, redirect_url: d.redirectUrl || null, form_label: d.formLabel || null,
    package_set: d.packageSet || "Default", currency: d.currency || null, extra_data_source_ids: extraIds,
    active: d.active, updated_at: new Date().toISOString()
  };
  if (id) {
    const result = await supabase.from("meta_capi_configs").update(row).eq("org_id", orgId).eq("id", id).select("id, tracking_key").single();
    if (result.error) throw result.error;
    await hubAudit(orgId, branchId, actorOf(req), "link_updated", { type: "link", id, label: d.label }, { strategy: d.strategy });
    return result.data;
  }
  const base = d.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "link";
  const result = await supabase.from("meta_capi_configs").insert({ ...row, access_token: "", tracking_key: `${base}_${Date.now().toString(36)}`, created_by: req.user!.id }).select("id, tracking_key").single();
  if (result.error) throw result.error;
  await hubAudit(orgId, branchId, actorOf(req), "link_created", { type: "link", id: result.data.id, label: d.label }, { strategy: d.strategy });
  return result.data;
}
router.post("/links", async (req, res) => { try { res.status(201).json(await saveLink(req, null)); } catch (error: any) { fail(res, error, "Could not save the link."); } });
router.post("/links/bulk", async (req, res) => {
  const parsed = z.object({ ids: z.array(z.string().uuid()).min(1).max(200), action: z.enum(["activate", "pause", "delete"]) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Choose links and an action." }); return; }
  try {
    const orgId = req.user!.orgId;
    const query = parsed.data.action === "delete"
      ? supabase.from("meta_capi_configs").delete().eq("org_id", orgId).in("id", parsed.data.ids).neq("tracking_key", "__default__")
      : supabase.from("meta_capi_configs").update({ active: parsed.data.action === "activate", updated_at: new Date().toISOString() }).eq("org_id", orgId).in("id", parsed.data.ids);
    const { error } = await query;
    if (error) throw error;
    await hubAudit(orgId, branchOf(req), actorOf(req), `links_${parsed.data.action}`, { type: "link", label: `${parsed.data.ids.length} links` });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not update the links."); }
});
router.put("/links/:id", async (req, res) => { try { res.json(await saveLink(req, String(req.params.id))); } catch (error: any) { fail(res, error, "Could not save the link."); } });
router.post("/links/:id/duplicate", async (req, res) => {
  try {
    const { data: link } = await supabase.from("meta_capi_configs").select("*").eq("org_id", req.user!.orgId).eq("id", String(req.params.id)).maybeSingle();
    if (!link) throw httpError(404, "Tracking link not found.");
    const strategy = STRATEGY_OF_MODE[link.mode];
    res.status(201).json(await saveLink(req, null, {
      label: `${link.label} (copy)`, productId: link.product_id, websiteId: link.website_id, profileId: link.profile_id, dataSourceId: link.data_source_id,
      strategy: !strategy || strategy === "off" ? "landing_page" : strategy,
      landingPageUrl: link.landing_page_url ?? "", redirectUrl: link.redirect_url ?? "", formLabel: link.form_label ?? "", packageSet: link.package_set ?? "Default", currency: link.currency ?? "", extraDataSourceIds: link.extra_data_source_ids ?? [], active: false
    }));
  } catch (error: any) { fail(res, error, "Could not duplicate the link."); }
});
router.put("/links/:id/checklist", async (req, res) => {
  const parsed = z.object({ thankYouPixelRemoved: z.boolean(), testEventSeen: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Tick the checklist items." }); return; }
  try {
    const checklist = { ...parsed.data, confirmedBy: req.user!.name ?? null, confirmedAt: new Date().toISOString() };
    const { error } = await supabase.from("meta_capi_configs").update({ checklist, updated_at: new Date().toISOString() }).eq("org_id", req.user!.orgId).eq("id", String(req.params.id));
    if (error) throw error;
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "link_checklist", { type: "link", id: String(req.params.id) }, parsed.data);
    res.json({ checklist });
  } catch (error: any) { fail(res, error, "Could not save the checklist."); }
});
router.delete("/links/:id", async (req, res) => {
  try {
    const { error } = await supabase.from("meta_capi_configs").delete().eq("org_id", req.user!.orgId).eq("id", String(req.params.id)).neq("tracking_key", "__default__");
    if (error) throw error;
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), "link_deleted", { type: "link", id: String(req.params.id) });
    res.json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not delete the link."); }
});

// ============================================================ EVENT LEDGER

const LEDGER_TABS: Record<string, (row: LedgerRow) => boolean> = {
  all: () => true,
  purchase: (row) => row.browser || row.serverStatus === "sent" || row.serverStatus === "dry_run",
  browser: (row) => row.browser,
  server: (row) => row.serverStatus === "sent" || row.serverStatus === "dry_run",
  deduplicated: (row) => row.status === "deduped",
  failed: (row) => row.status === "capi_failed" || row.status === "not_tracked",
  test: (row) => row.status === "test"
};

async function ledgerQuery(req: Request) {
  const orgId = req.user!.orgId;
  const branchId = branchOf(req);
  const period = periodOf(req.query);
  const loadFrom = period.compareFrom < period.from ? period.compareFrom : period.from;
  const [orders, basics] = await Promise.all([formOrders(orgId, branchId, loadFrom, period.to), loadBasics(orgId, branchId)]);
  const events = await eventsFor(orgId, orders.map((order) => order.id));
  const all = orders.map((order) => ledgerRow(order, events));
  const inRange = (from: string, to: string) => (row: LedgerRow) => { const day = dayOfIso(row.createdAt); return day >= from && day <= to; };
  const current = all.filter(inRange(period.from, period.to));
  const previous = all.filter(inRange(period.compareFrom, period.compareTo));
  const q = String(req.query.q ?? "").trim().toLowerCase();
  const status = String(req.query.status ?? "");
  const tab = String(req.query.tab ?? "all");
  const dataSourceId = String(req.query.dataSourceId ?? "");
  const websiteId = String(req.query.websiteId ?? "");
  const productId = String(req.query.productId ?? "");
  const orderIds = String(req.query.orderIds ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const linkKeysForSource = new Set(basics.links.filter((link: any) => link.data_source_id === dataSourceId).map((link: any) => String(link.tracking_key).toLowerCase()));
  const sourcePixel = basics.sources.find((row: any) => row.id === dataSourceId)?.pixel_id;
  const websiteDomain = basics.websites.find((row: any) => row.id === websiteId)?.domain;
  const filtered = current
    .filter(LEDGER_TABS[tab] ?? LEDGER_TABS.all)
    .filter((row) => !status || row.status === status)
    .filter((row) => !dataSourceId || (row.trackingKey && linkKeysForSource.has(row.trackingKey)) || Boolean(sourcePixel && row.serverPixel === sourcePixel))
    .filter((row) => !websiteId || row.website === websiteDomain)
    .filter((row) => !productId || row.productId === productId)
    .filter((row) => orderIds.length === 0 || orderIds.includes(row.orderId))
    .filter((row) => !q || `${row.orderId} ${row.product} ${row.website ?? ""} ${row.campaignId ?? ""} ${row.adId ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { period, current, previous, filtered, basics };
}

router.get("/ledger", async (req, res) => {
  try {
    const { period, current, previous, filtered, basics } = await ledgerQuery(req);
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 15));
    const productImage = new Map(basics.products.map((row: any) => [row.id, row.imageUrl]));
    const main: any = basics.sources.find((row: any) => row.is_main) ?? basics.sources[0];
    res.json({
      period, kpis: kpisOf(current), previous: kpisOf(previous),
      rows: filtered.slice((page - 1) * pageSize, page * pageSize).map((row) => ({ ...row, productImage: row.productId ? productImage.get(row.productId) ?? null : null })),
      total: filtered.length, page, pageSize,
      tabCounts: Object.fromEntries(Object.entries(LEDGER_TABS).map(([key, test]) => [key, current.filter(test).length])),
      filters: {
        dataSources: basics.sources.map((row: any) => ({ id: row.id, name: row.name })),
        websites: basics.websites.map((row: any) => ({ id: row.id, domain: row.domain })),
        products: basics.products.map((row: any) => ({ id: row.id, name: row.name }))
      },
      mainPixelUrl: main ? eventsManagerUrl(main.pixel_id) : "https://business.facebook.com/events_manager2"
    });
  } catch (error: any) { fail(res, error, "Could not load the event ledger."); }
});

router.get("/ledger/export", async (req, res) => {
  try {
    const { filtered } = await ledgerQuery(req);
    const head = ["Order ID", "Created", "Product", "Website", "Source", "Campaign ID", "Ad Set ID", "Ad ID", "Value", "Currency", "Browser", "CAPI", "Event ID", "Status"];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const body = filtered.map((row) => [row.orderId, row.createdAt, row.product, row.website, row.source, row.campaignId, row.adsetId, row.adId, row.value, row.currency, row.browser ? "yes" : "no", row.serverStatus ?? "", row.eventId ?? "", row.statusLabel].map(escape).join(","));
    res.json({ filename: "event-ledger.csv", csv: [head.map(escape).join(","), ...body].join("\n") });
  } catch (error: any) { fail(res, error, "Could not export."); }
});

router.get("/ledger/:orderId", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { data: order, error } = await supabase.from("orders")
      .select("id, created_at, product_id, product_name, package_name, amount, currency, status, customer, phone, state, city, utm_source, utm_campaign, utm_content, utm_term, utm_medium, referrer, form_context, review_hold, delivered_date")
      .eq("org_id", orgId).eq("branch_id", branchId).eq("id", String(req.params.orderId)).maybeSingle();
    if (error) throw error;
    if (!order) throw httpError(404, "Order not found.");
    const [events, basics, { data: audit }, { data: extraSends }] = await Promise.all([
      eventsFor(orgId, [order.id]), loadBasics(orgId, branchId),
      supabase.from("order_audit").select("to_status, note, created_at").eq("order_id", order.id).order("created_at"),
      supabase.from("tracking_extra_pixel_sends").select("pixel_id, data_source_id, status, message, test_mode, sent_at, attempts, http_status").eq("org_id", orgId).eq("order_id", order.id).eq("event_name", "Purchase")
    ]);
    const ctx = (order.form_context ?? {}) as Record<string, any>;
    const server = events.server.get(order.id) ?? null;
    const browser = events.browser.get(order.id) ?? null;
    const delivered = events.delivered.get(order.id) ?? null;
    const row = ledgerRow(order as any, events);
    const link: any = basics.links.find((item: any) => String(item.tracking_key).toLowerCase() === row.trackingKey);
    const product: any = basics.products.find((item: any) => item.id === order.product_id);
    const fromAddress = (key: string) => { try { const url = new URL(String(ctx.landingUrl ?? "")); return new URLSearchParams(url.hash.split("?")[1] ?? url.search).get(key); } catch { return null; } };
    const timeline = [
      { at: order.created_at, label: "Order created", detail: `Order ${order.id} from ${row.website ?? "the form"}` },
      browser ? { at: browser.fired_at, label: "Browser Pixel Purchase", detail: `Event ${browser.event_id}${(browser.pixels_on_page ?? []).length ? ` · ${(browser.pixels_on_page ?? []).length} Pixel(s) on page` : ""}` } : null,
      server ? { at: server.sent_at, label: `CAPI Purchase ${server.status === "sent" ? "sent" : server.status}`, detail: server.message ?? `Event ${server.event_id}` } : null,
      ...((audit ?? []).filter((entry: any) => entry.to_status && entry.to_status !== "New").map((entry: any) => ({ at: entry.created_at, label: `Status: ${entry.to_status}`, detail: entry.note ?? "" }))),
      delivered ? { at: delivered.sent_at, label: `Delivered sale (${delivered.meta_event_name}) ${delivered.status}`, detail: delivered.message ?? "" } : null
    ].filter(Boolean).sort((a: any, b: any) => String(a.at).localeCompare(String(b.at)));
    res.json({
      ...row,
      productImage: product?.imageUrl ?? null, sku: product?.sku ?? null, packageName: order.package_name ?? null,
      landingPage: ctx.landingPageUrl || link?.landing_page_url || order.referrer || null, referralUrl: order.referrer ?? null, thankYouPage: link?.redirect_url ?? null,
      fbclid: ctx.fbclid ?? fromAddress("fbclid"), fbp: ctx.fbp ?? fromAddress("fbp"), fbc: ctx.fbc ?? fromAddress("fbc"),
      utm: { source: order.utm_source, campaign: order.utm_campaign, content: order.utm_content, term: order.utm_term, medium: order.utm_medium ?? null },
      customer: { name: order.customer, phone: order.phone, state: order.state, city: order.city },
      device: { deviceType: ctx.deviceType ?? null, userAgent: ctx.userAgent ?? null, locale: ctx.clientLocale ?? null },
      browserEvent: browser ? { firedAt: browser.fired_at, eventId: browser.event_id, pixelId: browser.pixel_id, pageUrl: browser.page_url, pixelsOnPage: browser.pixels_on_page } : null,
      serverEvent: server ? { sentAt: server.sent_at, eventId: server.event_id, status: server.status, message: server.message, test: server.test_mode, attempts: server.attempts, human: server.status === "sent" || server.status === "dry_run" ? null : humanMetaError(server.message, server.http_status) } : null,
      // The main Pixel is serverEvent; "Also send to" Pixels are listed here.
      mainPixel: server?.pixel_id ? { pixelId: server.pixel_id, name: (basics.sources as any[]).find((item) => item.pixel_id === server.pixel_id)?.name ?? null } : null,
      extraPixelSends: (extraSends ?? []).map((send: any) => ({
        pixelId: send.pixel_id, name: (basics.sources as any[]).find((item) => item.id === send.data_source_id)?.name ?? null, status: send.status,
        test: Boolean(send.test_mode), sentAt: send.sent_at, attempts: send.attempts, message: send.message,
        human: send.status === "sent" || send.status === "dry_run" ? null : humanMetaError(send.message, send.http_status)
      })),
      deliveredEvent: delivered ? { sentAt: delivered.sent_at, status: delivered.status, metaEventName: delivered.meta_event_name, message: delivered.message } : null,
      deliveredDate: order.delivered_date, timeline
    });
  } catch (error: any) { fail(res, error, "Could not load the order's tracking."); }
});

// ========================================================== RECONCILIATION

type ReconView = "campaign" | "adset" | "ad" | "landing_page" | "product" | "website";
const RECON_VIEWS: ReconView[] = ["campaign", "adset", "ad", "landing_page", "product", "website"];

async function reconData(orgId: string, branchId: string, from: string, to: string) {
  const [orders, basics, insightsRes, campaignsRes, notesRes, journey] = await Promise.all([
    formOrders(orgId, branchId, from, to), loadBasics(orgId, branchId),
    supabase.from("tracking_meta_ad_insights").select("data_source_id, connection_id, ad_account_id, day, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, purchases, purchase_value, spend, fetched_at").eq("org_id", orgId).eq("branch_id", branchId).gte("day", from).lte("day", to).limit(20000),
    supabase.from("tracking_meta_campaigns").select("*").eq("org_id", orgId).eq("branch_id", branchId),
    supabase.from("tracking_reconciliation_notes").select("scope, scope_id, note, resolved, created_by_name, created_at").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }),
    journeyCounts(orgId, branchId, addDaysToDateKey(to, -29), to).catch(() => [] as JourneyRow[])
  ]);
  if (insightsRes.error) throw insightsRes.error;
  const events = await eventsFor(orgId, orders.map((order) => order.id));
  const rows = orders.map((order) => ledgerRow(order, events));
  // Each ad's landing page / product / website, from where its visitors landed (most visits wins).
  const adHome = new Map<string, { key: string | null; productId: string | null; domain: string | null; path: string | null; visits: number }>();
  for (const row of journey.filter((item) => item.event_type === "form_opened" && item.ad_id)) {
    const current = adHome.get(row.ad_id!);
    if (!current || row.visits > current.visits) adHome.set(row.ad_id!, { key: row.tracking_key, productId: row.product_id, domain: row.domain, path: row.path, visits: row.visits });
  }
  for (const row of rows.filter((item) => item.adId && !adHome.has(item.adId))) adHome.set(row.adId!, { key: row.trackingKey, productId: row.productId, domain: row.website, path: row.landingPath, visits: 1 });
  return { orders, basics, insights: insightsRes.data ?? [], campaigns: campaignsRes.data ?? [], notes: notesRes.data ?? [], rows, events, adHome };
}
type ReconData = Awaited<ReturnType<typeof reconData>>;

function reconKey(view: ReconView, order: LedgerRow | null, insight: any | null, adHome: ReconData["adHome"]): { id: string; name: string } | null {
  if (order) {
    if (view === "campaign") return order.campaignId ? { id: order.campaignId, name: "" } : null;
    if (view === "adset") return order.adsetId ? { id: order.adsetId, name: "" } : null;
    if (view === "ad") return order.adId ? { id: order.adId, name: "" } : null;
    if (view === "landing_page") return order.website ? { id: `${order.website}${order.landingPath && order.landingPath !== "/" ? order.landingPath : ""}`, name: "" } : null;
    if (view === "product") return order.productId ? { id: order.productId, name: order.product } : null;
    return order.website ? { id: order.website, name: order.website } : null;
  }
  if (view === "campaign") return { id: insight.campaign_id, name: insight.campaign_name };
  if (view === "adset") return insight.adset_id ? { id: insight.adset_id, name: insight.adset_name } : null;
  if (view === "ad") return { id: insight.ad_id, name: insight.ad_name };
  const home = adHome.get(insight.ad_id);
  if (!home) return null;
  if (view === "landing_page") return home.domain ? { id: `${home.domain}${home.path && home.path !== "/" ? home.path : ""}`, name: "" } : null;
  if (view === "product") return home.productId ? { id: home.productId, name: "" } : null;
  return home.domain ? { id: home.domain, name: home.domain } : null;
}

function reconRows(view: ReconView, data: ReconData, settings: HubSettings) {
  const groups = new Map<string, { id: string; name: string; orders: LedgerRow[]; meta: number; value: number; spend: number; accounts: Set<string>; sourceIds: Set<string> }>();
  const get = (key: { id: string; name: string }) => {
    const entry = groups.get(key.id) ?? { id: key.id, name: key.name, orders: [] as LedgerRow[], meta: 0, value: 0, spend: 0, accounts: new Set<string>(), sourceIds: new Set<string>() };
    if (!entry.name && key.name) entry.name = key.name;
    groups.set(key.id, entry);
    return entry;
  };
  for (const row of data.rows) { const key = reconKey(view, row, null, data.adHome); if (key) get(key).orders.push(row); }
  for (const insight of data.insights) {
    const key = reconKey(view, null, insight, data.adHome);
    if (!key) continue;
    const entry = get(key);
    entry.meta += Number(insight.purchases) || 0; entry.value += Number(insight.purchase_value) || 0; entry.spend += Number(insight.spend) || 0;
    entry.accounts.add(insight.ad_account_id); entry.sourceIds.add(insight.data_source_id);
  }
  const metaLoaded = data.insights.length > 0;
  const productOf = new Map(data.basics.products.map((row: any) => [row.id, row]));
  const resolved = new Set(data.notes.filter((note: any) => note.scope === view && note.resolved).map((note: any) => note.scope_id));
  return Array.from(groups.values()).map((group) => {
    const protohub = group.orders.length;
    const meta = metaLoaded ? Math.round(group.meta) : null;
    const matchRate = meta === null ? null : Math.max(protohub, meta) === 0 ? 100 : Math.round((Math.min(protohub, meta) / Math.max(protohub, meta)) * 1000) / 10;
    const firstAd = group.orders.find((row) => row.adId)?.adId ?? "";
    const productId = view === "product" ? group.id : group.orders.find((row) => row.productId)?.productId ?? data.adHome.get(firstAd)?.productId ?? null;
    const product: any = productId ? productOf.get(productId) : null;
    const source: any = data.basics.sources.find((row: any) => group.sourceIds.has(row.id));
    const accountId = group.accounts.size ? Array.from(group.accounts)[0] : null;
    const adAccount: any = accountId ? (data.basics.adAccounts as any[]).find((row) => row.account_id === accountId) : null;
    const connection: any = adAccount ? (data.basics.connections as any[]).find((row) => row.id === adAccount.connection_id) : null;
    const sent = group.orders.filter((row) => row.serverStatus === "sent" || row.serverStatus === "dry_run").length;
    const duplicates = group.orders.filter((row) => data.events.server.get(row.orderId)?.status === "duplicate").length;
    const verdict = reconciliationVerdict({ protohubOrders: protohub, purchaseEvents: group.orders.filter((row) => row.browser || row.serverStatus === "sent").length, sentToMeta: sent, duplicates, metaPurchases: meta });
    const investigate = matchRate !== null && matchRate < settings.investigateBelowMatchRate && Math.abs((meta ?? 0) - protohub) > 1;
    return {
      id: group.id, name: group.name || (view === "product" ? product?.name : null) || (view === "campaign" ? data.campaigns.find((row: any) => row.campaign_id === group.id)?.name : null) || group.id, view,
      image: product?.imageUrl ?? null, productName: product?.name ?? null,
      account: adAccount?.name || source?.ad_account_label || source?.name || (accountId ? `act_${accountId}` : "—"),
      accountId, dataSourceName: source?.name ?? null, businessName: connection?.name || source?.business_name || null,
      protohub, meta, difference: meta === null ? null : meta - protohub, matchRate, spend: group.spend,
      status: resolved.has(group.id) ? "resolved" : meta === null ? "no_meta" : investigate ? "investigate" : "matched", verdict
    };
  }).sort((a, b) => (b.protohub + (b.meta ?? 0)) - (a.protohub + (a.meta ?? 0)));
}

router.get("/reconciliation", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.query);
    const view = (RECON_VIEWS.includes(String(req.query.view) as ReconView) ? String(req.query.view) : "campaign") as ReconView;
    const [data, previous, settings] = await Promise.all([reconData(orgId, branchId, period.from, period.to), formOrders(orgId, branchId, period.compareFrom, period.compareTo), loadHubSettings(orgId, branchId)]);
    let rows = reconRows(view, data, settings);
    const q = String(req.query.q ?? "").trim().toLowerCase();
    const accountId = String(req.query.accountId ?? "");
    const business = String(req.query.business ?? "");
    const websiteId = String(req.query.websiteId ?? "");
    const websiteDomain = data.basics.websites.find((row: any) => row.id === websiteId)?.domain;
    if (q) rows = rows.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(q));
    if (accountId) rows = rows.filter((row) => row.accountId === accountId);
    if (business) rows = rows.filter((row) => row.businessName === business);
    if (websiteDomain) rows = rows.filter((row) => row.id.startsWith(websiteDomain) || data.rows.some((order) => order.website === websiteDomain && reconKey(view, order, null, data.adHome)?.id === row.id));
    const metaTotal = data.insights.length ? Math.round(data.insights.reduce((sum: number, row: any) => sum + (Number(row.purchases) || 0), 0)) : null;
    const protohub = data.rows.length;
    const lastFetched = data.insights.map((row: any) => row.fetched_at).sort().pop() ?? null;
    res.json({
      period, view, lastFetched,
      kpis: {
        protohub, protohubChange: change(protohub, previous.length),
        meta: metaTotal, difference: metaTotal === null ? null : metaTotal - protohub,
        matchRate: metaTotal === null ? null : Math.max(protohub, metaTotal) === 0 ? 100 : Math.round((Math.min(protohub, metaTotal) / Math.max(protohub, metaTotal)) * 1000) / 10,
        matched: metaTotal === null ? null : Math.min(protohub, metaTotal), matchedOf: metaTotal === null ? null : Math.max(protohub, metaTotal),
        investigate: rows.filter((row) => row.status === "investigate").length
      },
      rows,
      filters: {
        accounts: Array.from(new Map<string, string>([
          ...(data.basics.adAccounts as any[]).filter((row) => row.active).map((row) => [row.account_id, row.name ? `${row.name} (act_${row.account_id})` : `act_${row.account_id}`] as [string, string]),
          ...data.basics.sources.flatMap((row: any) => ((row.ad_account_ids ?? []) as string[]).map((id) => [id, `act_${id}`] as [string, string]))
        ]).entries()).map(([id, label]) => ({ id, label })),
        businesses: Array.from(new Set([...(data.basics.connections as any[]).map((row) => row.name), ...data.basics.sources.map((row: any) => row.business_name)].filter(Boolean))),
        websites: data.basics.websites.map((row: any) => ({ id: row.id, domain: row.domain }))
      },
      sources: [
        ...(data.basics.connections as any[]).map((row) => ({ id: row.id, name: row.name, adAccounts: (data.basics.adAccounts as any[]).filter((account) => account.connection_id === row.id && account.active).length, hasToken: Boolean(row.access_token) })),
        ...data.basics.sources.filter((row: any) => !row.connection_id).map((row: any) => ({ id: row.id, name: row.name, adAccounts: (row.ad_account_ids ?? []).length, hasToken: Boolean(row.effective_token) }))
      ]
    });
  } catch (error: any) { fail(res, error, "Could not load the reconciliation."); }
});

router.get("/reconciliation/item", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const view = (RECON_VIEWS.includes(String(req.query.view) as ReconView) ? String(req.query.view) : "campaign") as ReconView;
    const id = String(req.query.id ?? "");
    if (!id) throw httpError(400, "Which item?");
    const period = periodOf(req.query);
    const chartDays = Math.min(30, Math.max(7, Number(req.query.chartDays) || 7));
    const chartFrom = addDaysToDateKey(period.to, -(chartDays - 1));
    const from = chartFrom < period.from ? chartFrom : period.from;
    const [data, settings] = await Promise.all([reconData(orgId, branchId, from, period.to), loadHubSettings(orgId, branchId)]);
    const inPeriod = (day: string) => day >= period.from && day <= period.to;
    const matchesOrder = (row: LedgerRow) => reconKey(view, row, null, data.adHome)?.id === id;
    const matchesInsight = (row: any) => reconKey(view, null, row, data.adHome)?.id === id;
    const periodData = { ...data, rows: data.rows.filter((row) => inPeriod(dayOfIso(row.createdAt))), insights: data.insights.filter((row: any) => inPeriod(String(row.day))) };
    const item = reconRows(view, periodData, settings).find((row) => row.id === id);
    if (!item) throw httpError(404, "Nothing found for this item in the period.");
    const orders = periodData.rows.filter(matchesOrder);
    const insights = periodData.insights.filter(matchesInsight);
    const firstInsight: any = insights[0] ?? data.insights.find(matchesInsight) ?? null;
    const campaignId = view === "campaign" ? id : firstInsight?.campaign_id ?? orders.find((row) => row.campaignId)?.campaignId ?? null;
    const campaign: any = campaignId ? data.campaigns.find((row: any) => row.campaign_id === campaignId) : null;
    const source: any = data.basics.sources.find((row: any) => row.id === (firstInsight?.data_source_id ?? campaign?.data_source_id));
    const connection: any = (data.basics.connections as any[]).find((row) => row.id === (firstInsight?.connection_id ?? campaign?.connection_id));
    const adAccount: any = firstInsight ? (data.basics.adAccounts as any[]).find((row) => row.account_id === firstInsight.ad_account_id) : null;
    const home = firstInsight ? data.adHome.get(firstInsight.ad_id) : orders[0]?.adId ? data.adHome.get(orders[0].adId) : null;
    const link: any = data.basics.links.find((row: any) => String(row.tracking_key).toLowerCase() === (home?.key ?? orders[0]?.trackingKey));
    res.json({
      ...item,
      chart: lastNDays(period.to, chartDays).map((day) => ({
        day, protohub: data.rows.filter((row) => dayOfIso(row.createdAt) === day && matchesOrder(row)).length,
        meta: Math.round(data.insights.filter((row: any) => String(row.day) === day && matchesInsight(row)).reduce((sum: number, row: any) => sum + (Number(row.purchases) || 0), 0))
      })),
      details: {
        adAccount: adAccount ? `${adAccount.name || "Ad account"} (${adAccount.account_id})` : source ? `${source.ad_account_label || source.name}${firstInsight?.ad_account_id ? ` (${firstInsight.ad_account_id})` : ""}` : firstInsight?.ad_account_id ?? null,
        businessAccount: connection?.name ?? source?.business_name ?? null, campaignId,
        objective: campaign?.objective ? String(campaign.objective).replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c: string) => c.toUpperCase()) : null,
        startDate: campaign?.start_time ?? null, endDate: campaign?.stop_time ?? null, campaignStatus: campaign?.status ?? null,
        landingPage: link?.landing_page_url ?? (home?.domain ? `https://${home.domain}${home.path ?? "/"}` : null),
        dataSource: (data.basics.sources as any[]).find((row) => row.id === link?.data_source_id)?.name ?? source?.name ?? null, form: link?.form_label ?? link?.label ?? null,
        adsManagerUrl: adsManagerUrl(firstInsight?.ad_account_id ?? null, campaignId)
      },
      orders: orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100),
      metaRows: insights.map((row: any) => ({ day: row.day, campaign: row.campaign_name, adset: row.adset_name, ad: row.ad_name, purchases: Number(row.purchases), value: Number(row.purchase_value), spend: Number(row.spend) })),
      breakdown: {
        protohubOrders: orders.length, purchaseEvents: orders.filter((row) => row.browser || row.serverStatus === "sent").length,
        sentToMeta: orders.filter((row) => row.serverStatus === "sent" || row.serverStatus === "dry_run").length,
        notSent: orders.filter((row) => !(row.serverStatus === "sent" || row.serverStatus === "dry_run")).length,
        withoutFbclid: orders.filter((row) => !data.orders.find((order) => order.id === row.orderId)?.form_context?.fbclid).length,
        duplicates: orders.filter((row) => data.events.server.get(row.orderId)?.status === "duplicate").length, metaPurchases: item.meta
      },
      insights: [
        item.spend > 0 && item.meta ? `Meta cost per purchase: ₦${Math.round(item.spend / Math.max(1, item.meta)).toLocaleString("en-NG")}.` : null,
        item.spend > 0 && item.protohub ? `Cost per Protohub order: ₦${Math.round(item.spend / Math.max(1, item.protohub)).toLocaleString("en-NG")}.` : null,
        orders.length ? `${pct(orders.filter((row) => row.status === "deduped").length, orders.length)}% of these orders reached Meta from both browser and server.` : null,
        item.verdict.likely
      ].filter(Boolean),
      notes: data.notes.filter((note: any) => note.scope === view && note.scope_id === id).map((note: any) => ({ note: note.note, resolved: note.resolved, by: note.created_by_name, at: note.created_at }))
    });
  } catch (error: any) { fail(res, error, "Could not load the item."); }
});

router.post("/reconciliation/notes", async (req, res) => {
  const parsed = z.object({ scope: z.enum(["campaign", "adset", "ad", "landing_page", "product", "website"]), scopeId: z.string().min(1).max(300), note: z.string().trim().max(2000).optional(), resolved: z.boolean().default(false) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Write a note." }); return; }
  try {
    if (!parsed.data.resolved && !parsed.data.note) throw httpError(400, "Write a note.");
    const { error } = await supabase.from("tracking_reconciliation_notes").insert({
      org_id: req.user!.orgId, branch_id: branchOf(req), scope: parsed.data.scope, scope_id: parsed.data.scopeId, note: parsed.data.note ?? null, resolved: parsed.data.resolved,
      created_by: req.user!.id, created_by_name: req.user!.name ?? null
    });
    if (error) throw error;
    await hubAudit(req.user!.orgId, branchOf(req), actorOf(req), parsed.data.resolved ? "reconciliation_resolved" : "reconciliation_note", { type: parsed.data.scope, id: parsed.data.scopeId }, { note: parsed.data.note ?? null });
    res.status(201).json({ ok: true });
  } catch (error: any) { fail(res, error, "Could not save."); }
});

type RefreshTarget = { label: string; account: string; token: string; sourceId: string | null; connectionId: string | null };

/** What Refresh Data reads: connections' switched-on ad accounts (their token), then ad account ids typed on manually added Pixels. */
function refreshTargets(basics: Awaited<ReturnType<typeof loadBasics>>): RefreshTarget[] {
  const targets: RefreshTarget[] = [];
  const seen = new Set<string>();
  for (const connection of basics.connections as any[]) {
    if (!connection.access_token) continue;
    for (const account of (basics.adAccounts as any[]).filter((row) => row.connection_id === connection.id && row.active)) {
      if (seen.has(account.account_id)) continue;
      seen.add(account.account_id);
      targets.push({ label: account.name || connection.name, account: account.account_id, token: connection.access_token, sourceId: null, connectionId: connection.id });
    }
  }
  for (const source of (basics.sources as any[]).filter((row) => (row.platform ?? "meta") === "meta" && row.active !== false && row.access_token)) {
    for (const account of (source.ad_account_ids ?? []) as string[]) {
      if (seen.has(account)) continue;
      seen.add(account);
      targets.push({ label: source.name, account, token: source.access_token, sourceId: source.id, connectionId: null });
    }
  }
  return targets;
}

/** One ad account: Meta's purchases per ad per day, then details of only the campaigns in them. */
async function refreshAccount(orgId: string, branchId: string, target: RefreshTarget, from: string, to: string) {
  const account = target.account;
  const result = await adPurchases(account, target.token, from, to);
  if (!result.ok) return { source: target.label, account, ok: false, message: humanMetaError(result.message, null).title, rows: 0 };
  const clear = supabase.from("tracking_meta_ad_insights").delete().eq("ad_account_id", account).gte("day", from).lte("day", to);
  await (target.connectionId ? clear.eq("connection_id", target.connectionId) : clear.eq("data_source_id", target.sourceId!));
  for (let i = 0; i < result.rows.length; i += 500) {
    const insert = await supabase.from("tracking_meta_ad_insights").insert(result.rows.slice(i, i + 500).map((row) => ({
      org_id: orgId, branch_id: branchId, data_source_id: target.sourceId, connection_id: target.connectionId, ad_account_id: account, day: row.day,
      campaign_id: row.campaignId, campaign_name: row.campaignName, adset_id: row.adsetId, adset_name: row.adsetName, ad_id: row.adId, ad_name: row.adName,
      purchases: row.purchases, purchase_value: row.purchaseValue, spend: row.spend
    })));
    if (insert.error) throw insert.error;
  }
  const info = await campaignsByIds(result.rows.map((row) => row.campaignId), target.token);
  if (info.ok && info.rows.length) {
    const fetchedAt = new Date().toISOString();
    const upsert = await supabase.from("tracking_meta_campaigns").upsert(info.rows.map((campaign) => ({
      org_id: orgId, branch_id: branchId, data_source_id: target.sourceId, connection_id: target.connectionId, ad_account_id: account, campaign_id: campaign.id, name: campaign.name ?? "",
      objective: campaign.objective ?? null, status: campaign.effective_status ?? null, start_time: campaign.start_time ?? null, stop_time: campaign.stop_time ?? null, fetched_at: fetchedAt
    })), { onConflict: target.connectionId ? "connection_id,campaign_id" : "data_source_id,campaign_id" });
    if (upsert.error) throw upsert.error;
  }
  return { source: target.label, account, ok: true, message: info.ok ? "Loaded." : `Loaded; campaign names not read (${humanMetaError(info.message, null).title}).`, rows: result.rows.length };
}

/** The ad accounts Refresh Data will read (the page refreshes them one by one to show progress). */
router.get("/reconciliation/targets", async (req, res) => {
  try {
    const targets = refreshTargets(await loadBasics(req.user!.orgId, branchOf(req)));
    res.json({ accounts: targets.map((target) => ({ account: target.account, label: target.label })) });
  } catch (error: any) { fail(res, error, "Could not list the ad accounts."); }
});

router.post("/reconciliation/refresh", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.body ?? {});
    // At least 7 days, so the detail panel's chart has Meta's side too.
    const from = addDaysToDateKey(period.to, -Math.max(6, period.length - 1));
    if (daysBetween(from, period.to) > 92) throw httpError(400, "Refresh at most 92 days at a time.");
    const only = typeof req.body?.account === "string" ? String(req.body.account).replace(/^act_/, "") : "";
    const targets = refreshTargets(await loadBasics(orgId, branchId)).filter((target) => !only || target.account === only);
    if (targets.length === 0) throw httpError(400, only ? `Ad account ${only} is not switched on.` : "No ad account is switched on. Connect your Meta Business in Data Sources and switch on its ad accounts.");
    // Accounts side by side, four at a time.
    const report: Array<Awaited<ReturnType<typeof refreshAccount>>> = [];
    for (let i = 0; i < targets.length; i += 4) {
      report.push(...await Promise.all(targets.slice(i, i + 4).map((target) => refreshAccount(orgId, branchId, target, from, period.to))));
    }
    await hubAudit(orgId, branchId, actorOf(req), "reconciliation_refreshed", { type: "reconciliation" }, { from, to: period.to, accounts: report.length });
    res.json({ report });
  } catch (error: any) { fail(res, error, "Could not read Meta's numbers."); }
});

// ============================================================= DIAGNOSTICS

router.get("/diagnostics", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const period = periodOf(req.query);
    const flowRange = String(req.query.flow ?? "24h");
    const websiteId = String(req.query.websiteId ?? "");
    const flowFrom = flowRange === "7d" ? addDaysToDateKey(period.to, -6) : flowRange === "30d" ? addDaysToDateKey(period.to, -29) : period.from;
    const loadFrom = flowFrom < period.from ? flowFrom : period.from;
    const [assessment, orders, journey, { data: audit }] = await Promise.all([
      assess(orgId, branchId), formOrders(orgId, branchId, loadFrom, period.to), journeyCounts(orgId, branchId, loadFrom, period.to).catch(() => [] as JourneyRow[]),
      supabase.from("tracking_audit").select("action, subject_label, subject_type, detail, actor_name, created_at").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }).limit(100)
    ]);
    const events = await eventsFor(orgId, orders.map((order) => order.id));
    const domain = assessment.basics.websites.find((row: any) => row.id === websiteId)?.domain ?? null;
    const allRows = orders.map((order) => ledgerRow(order, events)).filter((row) => !domain || row.website === domain);
    const rows = allRows.filter((row) => dayOfIso(row.createdAt) >= period.from);
    const flowRows = allRows.filter((row) => dayOfIso(row.createdAt) >= flowFrom);
    const flowJourney = journey.filter((row) => row.day >= flowFrom && (!domain || row.domain === domain));
    const k = kpisOf(rows);
    const views = sumVisits(flowJourney, "form_opened");
    const starts = sumVisits(flowJourney, "first_interaction");
    const fk = kpisOf(flowRows);
    const flow = [
      { key: "landing", label: "Landing Page", value: views, sub: "Page Views", pct: views ? 100 : 0 },
      { key: "form", label: "Form Submitted", value: starts, sub: "Form Starts", pct: pct(starts, views) },
      { key: "order", label: "Order Created", value: fk.orders, sub: "Orders", pct: fk.orders ? 100 : 0 },
      { key: "browser", label: "Browser Pixel", value: fk.browserEvents, sub: "Events Sent", pct: pct(fk.browserEvents, fk.orders) },
      { key: "capi", label: "CAPI Server", value: fk.serverEvents, sub: "Events Sent", pct: pct(fk.serverEvents, fk.orders) },
      { key: "meta", label: "Meta Received", value: fk.deduped || fk.purchaseEvents, sub: "Deduplicated", pct: pct(fk.deduped || fk.purchaseEvents, fk.orders) }
    ];
    const statusCounts = {
      deduplicated: rows.filter((row) => row.status === "deduped").length,
      serverOnly: rows.filter((row) => row.status === "server_only" || row.status === "capi_only").length,
      browserOnly: rows.filter((row) => row.status === "browser_only").length,
      failed: rows.filter((row) => row.status === "capi_failed").length,
      pending: rows.filter((row) => row.status === "sending").length,
      pagePixel: rows.filter((row) => row.status === "page_pixel").length
    };
    const emqSource: any = assessment.sourceRows.find((row: any) => row.emq) ?? null;
    const sitesWithBrowser = assessment.websiteRows.filter((row: any) => row.lastBrowserEvent || (row.lastScan?.pages ?? []).some((page: any) => page.pixels?.length)).length;
    const capture = attributionCapture(orders.filter((order) => dayOfIso(order.created_at) >= period.from));
    const redirects = sumVisits(journey.filter((row) => row.day >= period.from), "redirect_triggered");
    const linksWithForm = assessment.basics.links.filter((link: any) => link.active !== false).length;
    const issues = assessment.issues;
    const pageGroups = new Map<string, { path: string; domain: string; orders: number; issues: number }>();
    for (const row of rows) {
      const key = `${row.website ?? "unknown"}|${row.landingPath ?? "/"}`;
      const entry = pageGroups.get(key) ?? { path: row.landingPath ?? "/", domain: row.website ?? "unknown", orders: 0, issues: 0 };
      entry.orders += 1;
      if (row.status === "capi_failed" || row.status === "browser_only" || (row.trackingMode === "hybrid" && !row.browser)) entry.issues += 1;
      pageGroups.set(key, entry);
    }
    for (const site of assessment.websiteRows) {
      for (const entry of pageGroups.values()) if (entry.domain === site.domain && site.problems.length) entry.issues += site.problems.length;
    }
    const duplicates = [
      ...rows.filter((row) => row.browser && row.serverStatus === "sent" && row.status === "server_only").map((row) => ({ kind: "Different event ids", detail: `Order ${row.orderId}: browser and server used different ids`, orderId: row.orderId as string | null })),
      ...rows.filter((row) => events.server.get(row.orderId)?.status === "duplicate").map((row) => ({ kind: "Repeat blocked", detail: `Order ${row.orderId}: a second send was blocked`, orderId: row.orderId as string | null })),
      ...assessment.websiteRows.filter((row: any) => row.duplicatePixel).map((row: any) => ({ kind: "Pixel loaded twice", detail: row.domain as string, orderId: null as string | null }))
    ];
    const lostParams = orders.filter((order) => /^(fb|ig|facebook|instagram|meta)$/i.test(String(order.utm_source ?? "")) && !orderAdIds(order).campaignId)
      .slice(0, 50).map((order) => ({ orderId: order.id, at: order.created_at, utmSource: order.utm_source, referrer: order.referrer }));
    const dedupItem = assessment.items.find((item) => item.key === "dedup");
    res.json({
      period,
      kpis: {
        score: assessment.score, ordersTracked: k.purchaseEvents, orders: k.orders, trackedPct: k.purchasePct,
        browser: k.browserEvents, browserPct: k.browserPct, browserMissing: Math.max(0, k.orders - k.browserEvents),
        server: k.serverEvents, serverPct: k.serverPct,
        issues: issues.length, critical: issues.filter((issue) => issue.level === "critical").length, warning: issues.filter((issue) => issue.level === "warning").length, info: issues.filter((issue) => issue.level === "info").length
      },
      items: assessment.items,
      flow,
      emq: emqSource ? { source: emqSource.name, scores: emqSource.emq } : null,
      statusCounts, totalEvents: rows.length,
      issues,
      quickChecks: [
        { label: "Meta Dataset Connection", ok: assessment.sourceRows.some((row: any) => row.lastCheckOk), value: assessment.sourceRows.length === 0 ? "No dataset" : assessment.sourceRows.some((row: any) => row.lastCheckOk) ? "Connected" : "Not tested" },
        { label: "CAPI Access Token", ok: assessment.sourceRows.some((row: any) => row.hasToken && row.lastCheckOk !== false), value: assessment.sourceRows.some((row: any) => row.hasToken) ? (assessment.sourceRows.some((row: any) => row.lastCheckOk === false) ? "Problem" : "Valid") : "Missing" },
        { label: "Browser Pixel Detection", ok: sitesWithBrowser === assessment.websiteRows.length && sitesWithBrowser > 0, warn: sitesWithBrowser > 0 && sitesWithBrowser < assessment.websiteRows.length, value: `Detected on ${sitesWithBrowser}/${assessment.websiteRows.length} sites` },
        { label: "Purchase Event Firing", ok: k.purchaseEvents > 0 || k.orders === 0, value: k.orders === 0 ? "No orders yet" : k.purchaseEvents > 0 ? "Working properly" : "Thank-you page only" },
        { label: "Event Deduplication", ok: dedupItem?.healthy === 1, value: `${k.dedupRate}% match rate` },
        { label: "Campaign Parameters", ok: capture.orders === 0 || capture.fields.campaign >= 80, value: capture.orders === 0 ? "No ad orders" : capture.fields.campaign >= 80 ? "Capturing correctly" : `Only ${capture.fields.campaign}% carry a campaign id` },
        { label: "Thank-you Page Redirect", ok: redirects > 0 || k.orders === 0, value: redirects > 0 ? "Working properly" : "No redirects seen" },
        { label: "Form Integration", ok: linksWithForm > 0 || k.orders > 0, value: linksWithForm > 0 ? `${linksWithForm} forms OK` : "Forms send orders" }
      ],
      topPages: Array.from(pageGroups.values()).sort((a, b) => b.issues - a.issues || b.orders - a.orders).slice(0, 20),
      pixelCapi: assessment.sourceRows,
      attribution: ATTRIBUTION_FIELDS.map((field) => ({ ...field, pct: capture.fields[field.key] })), attributionOrders: capture.orders,
      duplicates, lostParams,
      activity: (audit ?? []).map((row: any) => ({ at: row.created_at, action: row.action, subject: row.subject_label, by: row.actor_name, detail: row.detail })),
      websites: assessment.basics.websites.map((row: any) => ({ id: row.id, domain: row.domain }))
    });
  } catch (error: any) { fail(res, error, "Could not run the diagnostics."); }
});

/** Validate URL Parameters: does an ad URL carry what Protohub needs? */
router.post("/diagnostics/validate-url", async (req, res) => {
  const parsed = z.object({ url: z.string().trim().min(5).max(3000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Paste an ad URL." }); return; }
  try {
    const url = new URL(parsed.data.url);
    const params = url.searchParams;
    const looksMeta = (value: string | null) => Boolean(value && /^\d{10,22}$/.test(value));
    const placeholder = (value: string | null) => Boolean(value && /\{\{.+\}\}/.test(value));
    const check = (key: string, label: string, required: boolean, ok?: (value: string | null) => boolean) => {
      const value = params.get(key);
      return { key, label, value, required, ok: value ? (ok ? ok(value) || placeholder(value) : true) : !required };
    };
    const checks = [
      check("utm_source", "UTM source", true), check("utm_medium", "UTM medium", false), check("utm_campaign", "UTM campaign", true),
      check("utm_id", "Campaign ID (utm_id)", true, looksMeta), check("utm_term", "Ad set ID (utm_term)", false, looksMeta), check("utm_content", "Ad ID (utm_content)", false, looksMeta),
      check("campaign_id", "campaign_id", false, looksMeta), check("adset_id", "adset_id", false, looksMeta), check("ad_id", "ad_id", false, looksMeta),
      check("ph_link", "Protohub link (ph_link)", false)
    ];
    res.json({ host: url.hostname, path: url.pathname, checks, ok: checks.every((item) => item.ok), note: "fbclid is added by Meta itself when someone clicks the ad - it is not in the URL you paste into the ad." });
  } catch {
    res.status(400).json({ error: "That is not a full URL (it must start with https://)." });
  }
});

// ================================================================= SETTINGS

const SettingsSchema = z.object({
  enabled: z.boolean(), currency: z.string().trim().max(8), timezone: z.string().trim().max(60),
  sendBrowser: z.boolean(), sendCapi: z.boolean(), multiPlatform: z.boolean(), logAllEvents: z.boolean(),
  trackingMode: z.enum(["order_based", "thank_you", "hybrid"]),
  defaultDataSources: z.record(z.string()).default({}), defaultEventValue: z.literal("order_total").default("order_total"),
  defaultWebsiteId: z.string().uuid().nullable(), defaultProfileId: z.string().uuid().nullable(),
  notifications: z.object({ capiFailures: z.boolean(), connection: z.boolean(), duplicatePixel: z.boolean(), lostParameters: z.boolean(), dailySummary: z.boolean() }),
  urlParameters: z.string().trim().max(1000),
  lowConversionRate: z.number().min(0).max(100), investigateBelowMatchRate: z.number().min(0).max(100)
});

router.get("/settings", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const [settings, assessment, { data: owners }, { data: lastSent }] = await Promise.all([
      loadHubSettings(orgId, branchId), assess(orgId, branchId),
      supabase.from("users").select("name, email").eq("org_id", orgId).eq("role", "Owner").eq("active", true),
      supabase.from("meta_capi_events").select("sent_at").eq("org_id", orgId).eq("status", "sent").order("sent_at", { ascending: false }).limit(1)
    ]);
    const main: any = assessment.sourceRows.find((row: any) => row.id === settings.defaultDataSources.meta) ?? assessment.sourceRows.find((row: any) => row.isMain && row.platform === "meta") ?? assessment.sourceRows[0] ?? null;
    res.json({
      settings,
      dataSources: assessment.sourceRows.map((row: any) => ({ id: row.id, name: row.name, platform: row.platform, pixelId: row.pixelId, health: row.health, isMain: row.isMain })),
      websites: assessment.basics.websites.map((row: any) => ({ id: row.id, domain: row.domain })),
      profiles: assessment.basics.profiles.map(presentProfile),
      health: [
        { label: "Meta Connection", ok: Boolean(main?.lastCheckOk), value: main ? (main.lastCheckOk ? "Healthy" : main.lastCheckOk === false ? "Problem" : "Not tested") : "No dataset" },
        { label: "CAPI Access Token", ok: Boolean(main?.hasToken), value: main?.hasToken ? "Valid" : "Missing" },
        { label: "Default Pixel Detection", ok: assessment.websiteRows.some((row: any) => row.lastBrowserEvent), value: assessment.websiteRows.some((row: any) => row.lastBrowserEvent) ? "Working" : "Not seen yet" },
        { label: "Event Deduplication", ok: true, value: "Enabled" },
        { label: "Campaign Parameter Capture", ok: true, value: "Enabled" }
      ],
      defaultSource: main ? { id: main.id, name: main.name, pixelId: main.pixelId, health: main.health } : null,
      lastSentAt: lastSent?.[0]?.sent_at ?? null,
      owners: owners ?? []
    });
  } catch (error: any) { fail(res, error, "Could not load the settings."); }
});

router.put("/settings", async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the settings." }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const d = parsed.data;
    if (d.trackingMode !== "thank_you" && !d.sendBrowser && !d.sendCapi) throw httpError(400, "Send at least one of browser Pixel events or server events (CAPI).");
    const defaultStrategy = d.trackingMode === "thank_you" ? "landing_page" : d.sendBrowser ? "browser_capi" : "capi_only";
    const settings: HubSettings = { ...DEFAULT_HUB_SETTINGS, ...d, defaultStrategy };
    const { error } = await supabase.from("tracking_settings").upsert({ org_id: orgId, branch_id: branchId, settings, updated_by: req.user!.id, updated_at: new Date().toISOString() }, { onConflict: "org_id,branch_id" });
    if (error) throw error;
    await hubAudit(orgId, branchId, actorOf(req), "settings_changed", { type: "settings" }, { trackingMode: d.trackingMode, enabled: d.enabled });
    res.json({ settings });
  } catch (error: any) { fail(res, error, "Could not save the settings."); }
});

router.get("/audit", async (req, res) => {
  try {
    const { data, error } = await supabase.from("tracking_audit").select("action, subject_type, subject_label, detail, actor_name, created_at").eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    res.json({ entries: (data ?? []).map((row: any) => ({ at: row.created_at, action: row.action, subjectType: row.subject_type, subject: row.subject_label, by: row.actor_name, detail: row.detail })) });
  } catch (error: any) { fail(res, error, "Could not load the audit log."); }
});

export default router;
