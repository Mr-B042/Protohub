import { logger } from "./logger.js";
import { supabase } from "./supabase.js";
import { addDaysToDateKey, lagosDateKey } from "./sales-bonus-engine.js";
import { orderAdIds, otherAdPlatform, productFromName } from "./tracking-hub.js";
import { dayOfIso, endIso, journeyCounts, loadBasics, startIso, type Basics } from "./tracking-hub-data.js";
import { refreshAccount, refreshTargets } from "./tracking-meta-refresh.js";
import { TIKTOK_PREFIX, linkEvidence, nameKey, tiktokOrderIds, type AccountInfo, type AdPlatform, type Evidence, type SpendInsight, type SpendMapping, type SpendOrder } from "./ad-spend.js";
import { tiktokAdLifetime, tiktokAdSpend, tiktokCampaignStarts } from "./tiktok-ads.js";
import { pixelAdAccounts, adLifetime, adLinks, campaignsByIds, deliveringCampaigns } from "./meta-graph.js";
import { autoProducts, pageKey, pageProducts } from "./ad-auto-product.js";
import { branchShareView } from "./ad-account-shares.js";
import { sharedOnlyFrom } from "./ad-account-shares-rules.js";
import { breakEvenCpa, sinceStart, type LifetimeRow } from "./ad-since-start.js";
import { mappingIndex, resolveSplits } from "./ad-spend.js";
import { STREAK_RULES, campaignStreaks, orderStreaks, type StreakAd } from "./ad-streaks.js";

// Loading and syncing for Tracking Hub -> Ad Spend (Bright, 8 Oct 2026). The
// maths is in ad-spend.ts; this file reads the database and Meta.

const PAGE = 1000;

async function insightsBetween(orgId: string, branchId: string, from: string, to: string, ignoreShares = false): Promise<SpendInsight[]> {
  // Shared ad accounts (Bright, 15 Nov 2026): each campaign counts in ONE branch.
  // Booked expenses ignore sharing: they stay in the home branch in its currency.
  const share = ignoreShares ? null : await branchShareView(orgId, branchId);
  const own = await insightRows(orgId, branchId, from, to);
  if (!share) return own;
  const rows = own.filter((row) => !share.claimedAway.has(row.campaign_id));
  if (share.claimedHere.length) {
    for (const { homeBranchId } of share.sharedIn.filter((s, i, all) => all.findIndex((x) => x.homeBranchId === s.homeBranchId) === i)) {
      for (let i = 0; i < share.claimedHere.length; i += 200) rows.push(...await insightRows(orgId, homeBranchId, from, to, share.claimedHere.slice(i, i + 200)));
    }
  }
  return rows;
}

async function insightRows(orgId: string, branchId: string, from: string, to: string, campaignIds?: string[]): Promise<SpendInsight[]> {
  const rows: SpendInsight[] = [];
  for (let page = 0; page < 60; page += 1) {
    let query = supabase.from("tracking_meta_ad_insights")
      .select("id, day, spend, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name, link_clicks, impressions, purchases, landing_page_views")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("day", from).lte("day", to);
    if (campaignIds) query = query.in("campaign_id", campaignIds);
    const { data, error } = await query.order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as any[]).map((row) => ({
      ...row, platform: "meta" as const, day: String(row.day).slice(0, 10), spend: Number(row.spend) || 0,
      linkClicks: row.link_clicks === null || row.link_clicks === undefined ? null : Number(row.link_clicks),
      impressions: row.impressions === null || row.impressions === undefined ? null : Number(row.impressions),
      purchases: row.purchases === null || row.purchases === undefined ? null : Number(row.purchases),
      landingPageViews: row.landing_page_views === null || row.landing_page_views === undefined ? null : Number(row.landing_page_views)
    })));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** TikTok spend rows in the same shape, every id as "tt:<id>" so it can never meet a Meta id. */
async function tiktokInsightsBetween(orgId: string, branchId: string, from: string, to: string): Promise<SpendInsight[]> {
  const rows: SpendInsight[] = [];
  const tt = (id: unknown) => (id ? `${TIKTOK_PREFIX}${id}` : "");
  for (let page = 0; page < 60; page += 1) {
    const { data, error } = await supabase.from("tracking_tiktok_ad_insights")
      .select("id, day, spend, advertiser_id, campaign_id, campaign_name, adgroup_id, adgroup_name, ad_id, ad_name")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("day", from).lte("day", to)
      .order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    for (const row of (data ?? []) as any[]) rows.push({
      platform: "tiktok", day: String(row.day).slice(0, 10), spend: Number(row.spend) || 0, ad_account_id: tt(row.advertiser_id),
      campaign_id: tt(row.campaign_id), campaign_name: row.campaign_name ?? "", adset_id: tt(row.adgroup_id), adset_name: row.adgroup_name ?? "", ad_id: tt(row.ad_id), ad_name: row.ad_name ?? ""
    });
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

async function ordersBetween(orgId: string, branchId: string, from: string, to: string, campaignByName: Map<string, string | null> = new Map()): Promise<SpendOrder[]> {
  const rows: SpendOrder[] = [];
  for (let page = 0; page < 60; page += 1) {
    // launch-safe: Owner-only Tracking Hub ad spend.
    const { data, error } = await supabase.from("orders")
      .select("id, created_at, product_id, status, amount, cogs_snapshot, logistics_cost, form_context, utm_source, utm_campaign, utm_content, utm_term, review_hold")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", startIso(from)).lte("created_at", endIso(to))
      .order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    for (const order of (data ?? []) as any[]) {
      if (order.review_hold === true) continue;
      const otherPlatform = otherAdPlatform(order);
      const ids = otherPlatform === "TikTok" ? tiktokOrderIds(order, campaignByName) : orderAdIds(order);
      rows.push({
        id: String(order.id), day: dayOfIso(order.created_at), productId: order.product_id ?? null, status: String(order.status ?? ""),
        amount: Number(order.amount) || 0, productCost: Number(order.cogs_snapshot) || 0, deliveryFee: Number(order.logistics_cost) || 0,
        campaignId: ids.campaignId, adsetId: ids.adsetId, adId: ids.adId, otherPlatform
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

/** Ad account -> its name and Meta Business (a connection, or a Pixel added by hand). */
export function accountsOf(basics: Basics): Map<string, AccountInfo> {
  const map = new Map<string, AccountInfo>();
  const connections = new Map((basics.connections as any[]).map((row) => [row.id, row]));
  for (const account of basics.adAccounts as any[]) {
    const connection: any = connections.get(account.connection_id);
    map.set(String(account.account_id), { accountId: String(account.account_id), name: account.name || `act_${account.account_id}`, businessKey: account.connection_id ?? "", businessName: connection?.name || "Meta Business" });
  }
  for (const source of basics.sources as any[]) {
    for (const raw of (source.ad_account_ids ?? []) as string[]) {
      const id = String(raw).replace(/^act_/, "");
      if (!map.has(id)) map.set(id, { accountId: id, name: source.ad_account_label || `act_${id}`, businessKey: `src:${source.id}`, businessName: source.business_name || source.name || "Ad accounts added by hand" });
    }
  }
  return map;
}

/** TikTok advertisers as ad accounts ("tt:<id>"), their connection as the business. */
function addTikTokAccounts(map: Map<string, AccountInfo>, connections: any[]) {
  for (const connection of connections) {
    for (const advertiser of (connection.advertisers ?? []) as any[]) {
      map.set(`${TIKTOK_PREFIX}${advertiser.id}`, { accountId: `${TIKTOK_PREFIX}${advertiser.id}`, name: advertiser.name || `TikTok ${advertiser.id}`, businessKey: `tt-conn:${connection.id}`, businessName: connection.name || "TikTok Ads" });
    }
  }
  return map;
}

export async function loadTikTokConnections(orgId: string, branchId: string) {
  const { data, error } = await supabase.from("tracking_tiktok_connections").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at");
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function loadAdSpendInputs(orgId: string, branchId: string, from: string, to: string, opts: { ignoreShares?: boolean } = {}) {
  const [tiktokInsights, tiktokConnections] = await Promise.all([tiktokInsightsBetween(orgId, branchId, from, to), loadTikTokConnections(orgId, branchId)]);
  // TikTok campaign name -> id (null when two campaigns share a name: then no match).
  const campaignByName = new Map<string, string | null>();
  for (const row of tiktokInsights) {
    const key = nameKey(row.campaign_name);
    if (!key) continue;
    const seen = campaignByName.get(key);
    campaignByName.set(key, seen === undefined || seen === row.campaign_id ? row.campaign_id : null);
  }
  const [basics, metaInsights, orders, mappingsRes, stateRes, daysRes, journey] = await Promise.all([
    loadBasics(orgId, branchId), insightsBetween(orgId, branchId, from, to, opts.ignoreShares), ordersBetween(orgId, branchId, from, to, campaignByName),
    supabase.from("tracking_ad_spend_mappings").select("level, meta_id, ad_account_id, label, splits, created_by_name, updated_at").eq("org_id", orgId).eq("branch_id", branchId),
    supabase.from("tracking_ad_spend_state").select("*").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle(),
    supabase.from("tracking_ad_spend_days").select("day").eq("org_id", orgId).eq("branch_id", branchId).gte("day", from).lte("day", to),
    // Where each ad's visitors landed (last 30 days of form opens).
    journeyCounts(orgId, branchId, addDaysToDateKey(to, -29), to).catch(() => [])
  ]);
  if (mappingsRes.error) throw mappingsRes.error;
  if (stateRes.error) throw stateRes.error;
  if (daysRes.error) throw daysRes.error;
  const visits = journey.filter((row) => row.event_type === "form_opened" && row.ad_id).map((row) => ({ adId: row.ad_id!, productId: row.product_id, visits: row.visits }));
  for (const order of orders) if (order.adId && order.productId) visits.push({ adId: order.adId, productId: order.productId, visits: 1 });
  const insights = [...metaInsights, ...tiktokInsights];
  // Products worked out without mapping (Bright, 15 Nov 2026): the ad's page, its campaign's other ads, its name.
  const evidence: Evidence = linkEvidence(visits);
  try {
    const metaAds = [...new Set(metaInsights.map((row) => row.ad_id))];
    const adPage = new Map<string, string | null>();
    for (let i = 0; i < metaAds.length; i += 300) {
      const { data } = await supabase.from("tracking_meta_ad_links").select("ad_id, page").eq("org_id", orgId).eq("branch_id", branchId).in("ad_id", metaAds.slice(i, i + 300));
      for (const row of (data ?? []) as any[]) adPage.set(String(row.ad_id), row.page ?? null);
    }
    const auto = autoProducts({
      ads: insights.map((row) => ({ adId: row.ad_id, campaignId: row.campaign_id, campaignName: row.campaign_name, adsetName: row.adset_name, adName: row.ad_name })),
      linkEvidence: evidence as Map<string, string>, adPage, pageProduct: adPage.size ? await learnedPages(orgId, branchId, to) : new Map(),
      products: basics.products.map((p: any) => ({ id: p.id, name: p.name }))
    });
    for (const [adId, found] of auto) if (!evidence.has(adId)) evidence.set(adId, found);
  } catch (err: any) { logger.warn("ad auto product failed", { orgId, error: err?.message ?? String(err) }); }
  const connected: AdPlatform[] = ["meta"];
  if (tiktokConnections.some((row) => row.access_token && (row.advertisers ?? []).some((adv: any) => adv.active !== false))) connected.push("tiktok");
  return {
    tiktokConnections, connected,
    basics, insights, orders, mappings: (mappingsRes.data ?? []) as Array<SpendMapping & { ad_account_id: string | null; label: string; created_by_name: string | null; updated_at: string }>,
    state: stateRes.data as any, finalDays: new Set((daysRes.data ?? []).map((row: any) => String(row.day).slice(0, 10))),
    evidence, accounts: addTikTokAccounts(await withSharedAccounts(orgId, branchId, basics, opts.ignoreShares), tiktokConnections)
  };
}

/** A name match, offered in the assign box only - never used to give spend a product. */
export const suggestProduct = (names: string[], products: Array<{ id: string; name: string }>) => {
  for (const name of names) { const id = productFromName(name, products); if (id) return id; }
  return null;
};

// ---------------------------------------------------------------- sync

/**
 * Read Meta's spend for the days given, for every switched-on ad account of
 * the branch. A day is final once it is synced after 06:00 the next morning
 * (Lagos); the auto sync stops re-reading final days.
 */
/** One TikTok advertiser: its spend per ad per day for the days given replaces what was stored. */
export async function refreshTikTokAdvertiser(orgId: string, branchId: string, connection: any, advertiser: { id: string; name?: string }, from: string, to: string) {
  const label = advertiser.name || `TikTok ${advertiser.id}`;
  const result = await tiktokAdSpend(connection.access_token, advertiser.id, from, to);
  if (!result.ok) return { source: label, account: advertiser.id, ok: false, message: result.message, rows: 0 };
  const clear = await supabase.from("tracking_tiktok_ad_insights").delete().eq("connection_id", connection.id).eq("advertiser_id", advertiser.id).gte("day", from).lte("day", to);
  if (clear.error) throw clear.error;
  const fetchedAt = new Date().toISOString();
  for (let i = 0; i < result.data.length; i += 500) {
    const insert = await supabase.from("tracking_tiktok_ad_insights").insert(result.data.slice(i, i + 500).map((row) => ({
      org_id: orgId, branch_id: branchId, connection_id: connection.id, advertiser_id: advertiser.id, day: row.day,
      campaign_id: row.campaignId, campaign_name: row.campaignName, adgroup_id: row.adgroupId, adgroup_name: row.adgroupName, ad_id: row.adId, ad_name: row.adName,
      spend: row.spend, conversions: row.conversions, fetched_at: fetchedAt
    })));
    if (insert.error) throw insert.error;
  }
  return { source: label, account: advertiser.id, ok: true, message: "Loaded.", rows: result.data.length };
}

export async function syncAdSpend(orgId: string, branchId: string, opts: { from: string; to: string; trigger: "auto" | "manual"; now?: Date }) {
  const now = opts.now ?? new Date();
  const [basics, tiktokConnections] = await Promise.all([loadBasics(orgId, branchId), loadTikTokConnections(orgId, branchId)]);
  const targets = refreshTargets(basics);
  const tiktokTargets = tiktokConnections.filter((row) => row.access_token).flatMap((connection) => ((connection.advertisers ?? []) as any[]).filter((adv) => adv.active !== false).map((advertiser) => ({ connection, advertiser })));
  if (targets.length + tiktokTargets.length === 0) {
    // Only accounts shared in from another branch (Zambia, 18 Nov 2026): the
    // home branch reads Meta; this branch still books its claimed campaigns as
    // expenses. Before, it stopped here and that spend was booked nowhere.
    const { data: shares } = await supabase.from("tracking_ad_account_shares").select("created_at").eq("org_id", orgId).eq("branch_id", branchId);
    if (!(shares ?? []).length) return { ok: false, accounts: 0, failed: [] as string[], message: "No ad account is switched on. Connect your Meta Business or TikTok Ads in Data Sources and switch on its ad accounts." };
    const { data: state } = await supabase.from("tracking_ad_spend_state").select("last_sync_at").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
    const sharedSince = ((shares ?? []) as any[]).map((row) => lagosDateKey(String(row.created_at))).sort()[0] ?? null;
    const from = sharedOnlyFrom(opts.from, (state as any)?.last_sync_at, sharedSince);
    const { syncAdSpendExpenses } = await import("./ad-spend-expenses.js");
    await syncAdSpendExpenses(orgId, branchId, { from, to: opts.to });
    const message = `Booked spend from ${shares!.length} shared ad account${shares!.length === 1 ? "" : "s"} (read by the home branch).`;
    const { error } = await supabase.from("tracking_ad_spend_state").upsert({
      org_id: orgId, branch_id: branchId, last_sync_at: now.toISOString(), last_sync_ok: true, last_sync_message: message, last_sync_trigger: opts.trigger, updated_at: now.toISOString()
    }, { onConflict: "org_id,branch_id" });
    if (error) throw error;
    return { ok: true, accounts: shares!.length, failed: [] as string[], message };
  }
  const jobs: Array<() => Promise<{ source: string; account: string; ok: boolean; message: string; rows: number }>> = [
    ...targets.map((target) => () => refreshAccount(orgId, branchId, target, opts.from, opts.to)),
    ...tiktokTargets.map(({ connection, advertiser }) => () => refreshTikTokAdvertiser(orgId, branchId, connection, advertiser, opts.from, opts.to))
  ];
  const labels = [...targets.map((target) => [target.label, target.account]), ...tiktokTargets.map(({ advertiser }) => [advertiser.name || `TikTok ${advertiser.id}`, advertiser.id])];
  const report: Array<{ source: string; account: string; ok: boolean; message: string; rows: number }> = [];
  for (let i = 0; i < jobs.length; i += 4) {
    report.push(...await Promise.all(jobs.slice(i, i + 4).map((job, index) =>
      job().catch((error: any) => ({ source: labels[i + index][0], account: labels[i + index][1], ok: false, message: error?.message ?? "Failed", rows: 0 }))
    )));
  }
  const failed = report.filter((row) => !row.ok);
  const ok = failed.length === 0;
  if (ok) {
    const today = lagosDateKey(now.toISOString());
    const hour = Number(now.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Lagos" }));
    const lastFinal = hour >= 6 ? addDaysToDateKey(today, -1) : addDaysToDateKey(today, -2);
    const days: string[] = [];
    for (let day = opts.from; day <= opts.to && day <= lastFinal; day = addDaysToDateKey(day, 1)) days.push(day);
    if (days.length) {
      const { error } = await supabase.from("tracking_ad_spend_days").upsert(days.map((day) => ({ org_id: orgId, branch_id: branchId, day, finalized_at: now.toISOString() })), { onConflict: "org_id,branch_id,day", ignoreDuplicates: true });
      if (error) throw error;
    }
  }
  const message = ok ? `Synced ${report.length} ad account${report.length === 1 ? "" : "s"}.` : `Couldn't read ${failed.length} of ${report.length} ad account${report.length === 1 ? "" : "s"}: ${failed.map((row) => `${row.source} (${row.message})`).join("; ")}`;
  const { error } = await supabase.from("tracking_ad_spend_state").upsert({
    org_id: orgId, branch_id: branchId, last_sync_at: now.toISOString(), last_sync_ok: ok, last_sync_message: message, last_sync_trigger: opts.trigger, updated_at: now.toISOString()
  }, { onConflict: "org_id,branch_id" });
  if (error) throw error;
  // Whole-life numbers (Since Start): on every Sync Now, and at most every 6 hours by itself
  // (was 3: each read loads every campaign's ads, and memory is the Railway bill).
  const { data: state } = await supabase.from("tracking_ad_spend_state").select("last_lifetime_at").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  if (opts.trigger === "manual" || !state?.last_lifetime_at || Date.parse(state.last_lifetime_at) < now.getTime() - 6 * 3_600_000) {
    await syncLifetime(orgId, branchId, { targets, tiktokTargets, now }).catch((err: any) => console.warn("[ad-spend] since-start read failed:", err?.message ?? err));
  }
  // Daily Ad Spend (expenses) follows what was just read (lib/ad-spend-expenses.ts).
  const { syncAdSpendExpenses } = await import("./ad-spend-expenses.js");
  await syncAdSpendExpenses(orgId, branchId, { from: opts.from, to: opts.to }).catch((err: any) => console.warn("[ad-spend] expense rows failed:", err?.message ?? err));
  return { ok, accounts: report.length, failed: failed.map((row) => row.source), message };
}

/** Account names for accounts shared into this branch from their home branch. */
async function withSharedAccounts(orgId: string, branchId: string, basics: Basics, ignore?: boolean) {
  const own = accountsOf(basics);
  if (ignore) return own;
  const share = await branchShareView(orgId, branchId);
  if (!share?.sharedIn.length) return own;
  for (const home of new Set(share.sharedIn.map((s) => s.homeBranchId))) {
    const ids = new Set(share.sharedIn.filter((s) => s.homeBranchId === home).map((s) => s.accountId));
    for (const [id, info] of accountsOf(await loadBasics(orgId, home))) if (ids.has(String(id).replace(/^act_/, "")) && !own.has(id)) own.set(id, info);
  }
  return own;
}

/** Each ad's landing page, read once per ad (re-read after 14 days), at most 500 a run. */
async function saveAdLinks(orgId: string, branchId: string, target: { account: string; token: string }, adIds: string[]) {
  if (!adIds.length) return;
  const known = new Set<string>();
  const freshAfter = new Date(Date.now() - 14 * 86_400_000).toISOString();
  for (let i = 0; i < adIds.length; i += 300) {
    const { data, error } = await supabase.from("tracking_meta_ad_links").select("ad_id").eq("org_id", orgId).eq("branch_id", branchId).in("ad_id", adIds.slice(i, i + 300)).gte("fetched_at", freshAfter);
    if (error) throw error;
    for (const row of (data ?? []) as any[]) known.add(String(row.ad_id));
  }
  const missing = adIds.filter((id) => !known.has(id)).slice(0, 500);
  if (!missing.length) return;
  const result = await adLinks(missing, target.token);
  if (!result.ok) { console.warn("[ad-spend] ad links:", result.message); return; }
  const now = new Date().toISOString();
  const rows = missing.map((adId) => { const link = result.links.get(adId) ?? null; return { org_id: orgId, branch_id: branchId, ad_id: adId, account_id: String(target.account), link: link ? link.slice(0, 1000) : null, page: pageKey(link), fetched_at: now }; });
  const { error } = await supabase.from("tracking_meta_ad_links").upsert(rows, { onConflict: "org_id,branch_id,ad_id" });
  if (error) throw error;
}

/** Landing page -> product, learned from the last 60 days of orders (form_context.landingPageUrl). */
async function learnedPages(orgId: string, branchId: string, to: string) {
  const rows: Array<{ page: string | null; productId: string | null }> = [];
  for (let page = 0; page < 30; page += 1) {
    // launch-safe: Owner-only ad spend, product of each order's landing page.
    const { data, error } = await supabase.from("orders").select("id, product_id, lp:form_context->>landingPageUrl")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", startIso(addDaysToDateKey(to, -59))).not("product_id", "is", null)
      .order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    for (const row of (data ?? []) as any[]) rows.push({ page: pageKey(row.lp), productId: row.product_id });
    if ((data ?? []).length < PAGE) break;
  }
  return pageProducts(rows);
}

const lagosDay = (iso: string | null | undefined) => (iso ? lagosDateKey(new Date(iso).toISOString()) : null);

/**
 * Each running campaign's (and each campaign that spent in the last 30 days)
 * numbers since it started, per ad, into tracking_ad_lifetime.
 */
async function syncLifetime(orgId: string, branchId: string, opts: { targets: ReturnType<typeof refreshTargets>; tiktokTargets: Array<{ connection: any; advertiser: any }>; now: Date }) {
  const since = addDaysToDateKey(lagosDateKey(opts.now.toISOString()), -30);
  const fetchedAt = opts.now.toISOString();
  const save = async (platform: "meta" | "tiktok", rows: LifetimeRow[], campaignIds: string[]) => {
    for (let i = 0; i < campaignIds.length; i += 200) {
      const clear = await supabase.from("tracking_ad_lifetime").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("platform", platform).in("campaign_id", campaignIds.slice(i, i + 200));
      if (clear.error) throw clear.error;
    }
    for (let i = 0; i < rows.length; i += 500) {
      const insert = await supabase.from("tracking_ad_lifetime").insert(rows.slice(i, i + 500).map((row) => ({ ...row, org_id: orgId, branch_id: branchId, fetched_at: fetchedAt })));
      if (insert.error) throw insert.error;
    }
  };
  for (const target of opts.targets) {
    const [{ data: campaigns }, { data: spent }] = await Promise.all([
      supabase.from("tracking_meta_campaigns").select("campaign_id, status, start_time").eq("org_id", orgId).eq("branch_id", branchId).eq("ad_account_id", target.account),
      supabase.from("tracking_meta_ad_insights").select("campaign_id").eq("org_id", orgId).eq("branch_id", branchId).eq("ad_account_id", target.account).gte("day", since).gt("spend", 0).limit(20000)
    ]);
    const info = new Map(((campaigns ?? []) as any[]).map((row) => [String(row.campaign_id), row]));
    const ids = Array.from(new Set([...((campaigns ?? []) as any[]).filter((row) => String(row.status ?? "").toUpperCase() === "ACTIVE").map((row) => String(row.campaign_id)), ...((spent ?? []) as any[]).map((row) => String(row.campaign_id))]));
    if (!ids.length) continue;
    const result = await adLifetime(target.account, target.token, ids);
    if (!result.ok) { console.warn("[ad-spend] since-start:", target.label, result.message); continue; }
    // Campaigns Protohub never saved details for (they spent, but not in a recent
    // daily read): ask Meta for their status and start date, and keep them.
    const missing = Array.from(new Set(result.rows.map((row) => row.campaignId))).filter((id) => !info.get(id)?.status || !info.get(id)?.start_time);
    if (missing.length) {
      const details = await campaignsByIds(missing, target.token);
      if (details.ok && details.rows.length) {
        const fetched = new Date().toISOString();
        const upsert = await supabase.from("tracking_meta_campaigns").upsert(details.rows.map((campaign) => ({
          org_id: orgId, branch_id: branchId, data_source_id: target.sourceId, connection_id: target.connectionId, ad_account_id: target.account, campaign_id: campaign.id, name: campaign.name ?? "",
          objective: campaign.objective ?? null, status: campaign.effective_status ?? null, start_time: campaign.start_time ?? null, stop_time: campaign.stop_time ?? null, fetched_at: fetched
        })), { onConflict: target.connectionId ? "connection_id,campaign_id" : "data_source_id,campaign_id" });
        if (upsert.error) console.warn("[ad-spend] since-start: could not save campaign details", upsert.error.message);
        for (const campaign of details.rows) info.set(String(campaign.id), { campaign_id: campaign.id, status: campaign.effective_status ?? null, start_time: campaign.start_time ?? null });
      } else if (!details.ok) console.warn("[ad-spend] since-start: campaign details", target.label, details.message);
    }
    await save("meta", result.rows.map((row) => ({
      platform: "meta", account_id: target.account, campaign_id: row.campaignId, campaign_name: row.campaignName,
      campaign_status: info.get(row.campaignId)?.status ?? null, campaign_start: lagosDay(info.get(row.campaignId)?.start_time),
      adset_id: row.adsetId, adset_name: row.adsetName, ad_id: row.adId, ad_name: row.adName, first_day: row.firstDay, last_day: row.lastDay,
      spend: row.spend, impressions: row.impressions, link_clicks: row.linkClicks, video_hook: row.video3s, video_full: row.thruplays, platform_purchases: row.purchases
    })), ids);
    await saveAdLinks(orgId, branchId, target, [...new Set(result.rows.map((row) => row.adId))]).catch((err: any) => console.warn("[ad-spend] ad links:", target.label, err?.message ?? err));
  }
  for (const { connection, advertiser } of opts.tiktokTargets) {
    const [ads, starts] = await Promise.all([tiktokAdLifetime(connection.access_token, advertiser.id), tiktokCampaignStarts(connection.access_token, advertiser.id)]);
    if (!ads.ok) { console.warn("[ad-spend] since-start TikTok:", advertiser.id, ads.message); continue; }
    const startOf = new Map((starts.ok ? starts.data : []).map((row) => [row.campaignId, row]));
    const tt = (id: string) => (id ? `${TIKTOK_PREFIX}${id}` : "");
    const rows: LifetimeRow[] = ads.data.map((row) => ({
      platform: "tiktok", account_id: tt(advertiser.id), campaign_id: tt(row.campaignId), campaign_name: row.campaignName,
      campaign_status: startOf.get(row.campaignId)?.status ?? null, campaign_start: startOf.get(row.campaignId)?.createdAt ? String(startOf.get(row.campaignId)!.createdAt).slice(0, 10) : null,
      adset_id: tt(row.adgroupId), adset_name: row.adgroupName, ad_id: tt(row.adId), ad_name: row.adName, first_day: null, last_day: null,
      spend: row.spend, impressions: row.impressions, link_clicks: row.clicks, video_hook: row.video2s, video_full: row.videoFull, platform_purchases: row.conversions
    }));
    await save("tiktok", rows, Array.from(new Set(rows.map((row) => row.campaign_id))));
  }
  await supabase.from("tracking_ad_spend_state").update({ last_lifetime_at: fetchedAt }).eq("org_id", orgId).eq("branch_id", branchId);
}

/** Since Start: every campaign judged over its whole life (lib/ad-since-start.ts). */
export async function loadSinceStart(orgId: string, branchId: string, today: string) {
  const { data: _inputs, ...result } = await sinceStartCore(orgId, branchId, today);
  return result;
}

/**
 * Break-even cost per order per product (Since Start, Campaign Decisions and
 * Order Streaks share it): from orders placed 7-37 days ago (old enough to be
 * settled), or the Owner's own target. `orders` must cover those days.
 */
async function productTargets(orgId: string, branchId: string, today: string, orders: SpendOrder[], productRows: Array<{ id: string; name: string }>) {
  const { data: overrides, error: overrideError } = await supabase.from("tracking_ad_spend_targets").select("product_id, target_cpa, updated_by_name, updated_at").eq("org_id", orgId).eq("branch_id", branchId);
  if (overrideError) throw overrideError;
  const settledFrom = addDaysToDateKey(today, -37);
  const settledTo = addDaysToDateKey(today, -7);
  const byProduct = new Map<string, SpendOrder[]>();
  for (const order of orders) if (order.productId && order.day >= settledFrom && order.day <= settledTo) byProduct.set(order.productId, [...(byProduct.get(order.productId) ?? []), order]);
  const overrideOf = new Map(((overrides ?? []) as any[]).map((row) => [row.product_id, row]));
  const targets = new Map<string, { cpa: number; source: "worked_out" | "set_by_you" }>();
  const targetList = productRows.map((product) => {
    const be = breakEvenCpa(byProduct.get(product.id) ?? []);
    const own = overrideOf.get(product.id);
    if (own) targets.set(product.id, { cpa: Number(own.target_cpa), source: "set_by_you" });
    else if (be.cpa) targets.set(product.id, { cpa: be.cpa, source: "worked_out" });
    return { productId: product.id, name: product.name, breakEven: be.cpa, deliveryRate: be.deliveryRate, margin: be.margin, basedOn: be.orders, averages: be.averages, deliveredRate: byProduct.get(product.id)?.length ? (byProduct.get(product.id) ?? []).filter((o) => o.status === "Delivered").length / (byProduct.get(product.id) ?? []).length : null, own: own ? Number(own.target_cpa) : null, ownBy: own?.updated_by_name ?? null };
  });
  return { targets, targetList };
}

/**
 * Order Streaks (Bright, 20 Nov 2026): every ad that ran in the last 7 days,
 * how steadily it gets orders, and whether it is cheap enough to scale.
 * Rules: ad-streaks.ts. Loads 37 days so break-even matches Since Start.
 */
export async function loadOrderStreaks(orgId: string, branchId: string, today: string) {
  const data = await loadAdSpendInputs(orgId, branchId, addDaysToDateKey(today, -37), today);
  const { targets, targetList } = await productTargets(orgId, branchId, today, data.orders, data.basics.products);
  const index = mappingIndex(data.mappings);
  const productName = new Map(data.basics.products.map((row) => [row.id, row.name]));
  const windowFrom = addDaysToDateKey(today, -STREAK_RULES.window);
  const spend = new Map<string, Map<string, number>>();
  const ads = new Map<string, StreakAd>();
  const namedOn = new Map<string, string>();
  for (const row of data.insights) {
    if (row.day < windowFrom || !row.ad_id) continue;
    const byDay = spend.get(row.ad_id) ?? new Map<string, number>();
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + (Number(row.spend) || 0));
    spend.set(row.ad_id, byDay);
    // Newest row gives the names (a renamed ad keeps its id).
    if ((namedOn.get(row.ad_id) ?? "") > row.day) continue;
    namedOn.set(row.ad_id, row.day);
    // One product only: an ad split across products has no single break-even.
    const { splits } = resolveSplits(row, index, data.evidence);
    const productId = splits.length === 1 ? splits[0].productId : null;
    ads.set(row.ad_id, {
      adId: row.ad_id, adName: row.ad_name || row.ad_id, campaignId: row.campaign_id, campaignName: row.campaign_name, adsetId: row.adset_id, adsetName: row.adset_name,
      accountId: row.ad_account_id, accountName: data.accounts.get(row.ad_account_id)?.name ?? row.ad_account_id, platform: row.platform ?? "meta",
      productId, productName: productId ? productName.get(productId) ?? null : null
    });
  }
  // Live or off right now (Bright, 21 Nov 2026): one Meta call per ad account, as Since Start.
  const accountNames = new Map(Array.from(data.accounts.values()).map((row) => [row.accountId, row.name]));
  const metaAccounts = new Set([...ads.values()].filter((ad) => ad.platform === "meta").map((ad) => String(ad.accountId).replace(/^act_/, "")));
  const { live, liveFailures } = await liveDelivering(orgId, data.basics, await branchShareView(orgId, branchId), metaAccounts, accountNames);
  for (const ad of ads.values()) {
    const checked = ad.platform === "meta" && live.accounts.has(String(ad.accountId).replace(/^act_/, ""));
    ad.campaignStatus = !checked ? "unknown" : live.delivering.has(ad.campaignId) ? "live" : "off";
    ad.adLive = checked ? live.deliveringAds.has(ad.adId) : null;
  }
  const streakInput = {
    today, ads: [...ads.values()], spend,
    orders: data.orders.filter((order) => order.day >= windowFrom).map((order) => ({ day: order.day, adId: order.adId, campaignId: order.campaignId, status: order.status })),
    targets: new Map([...targets].map(([id, target]) => [id, target.cpa]))
  };
  const rows = orderStreaks(streakInput);
  // By campaign (21 Nov 2026): the campaign's verdict, each ad's own action inside it.
  const campaigns = campaignStreaks(streakInput);
  return {
    rows, campaigns, today, rules: STREAK_RULES, lastSyncAt: (data.state as any)?.last_sync_at ?? null, liveFailures, liveCheckedAt: new Date().toISOString(),
    targets: targetList.filter((row) => rows.some((ad) => ad.productId === row.productId)).map((row) => ({ productId: row.productId, name: row.name, target: row.own ?? row.breakEven, own: row.own !== null }))
  };
}

/**
 * Which campaigns and ads are delivering right now, asked live per Meta ad
 * account (one call each; shared-in accounts use the home branch's token).
 * Accounts Meta did not answer for are listed in liveFailures (was silent
 * before 15 Nov 2026: "40 could not be checked"). Since Start + Order Streaks.
 */
async function liveDelivering(orgId: string, basics: Basics, share: Awaited<ReturnType<typeof branchShareView>>, accountIds: Set<string>, accountNames: Map<string, string>) {
  const live = { delivering: new Set<string>(), deliveringAds: new Set<string>(), accounts: new Set<string>() };
  const liveFailures: Array<{ accountId: string; name: string; message: string }> = [];
  const liveTargets = refreshTargets(basics);
  if (share) for (const home of new Set(share.sharedIn.map((s) => s.homeBranchId))) {
    const shared = new Set(share.sharedIn.filter((s) => s.homeBranchId === home).map((s) => s.accountId));
    liveTargets.push(...refreshTargets(await loadBasics(orgId, home)).filter((t) => shared.has(String(t.account).replace(/^act_/, ""))));
  }
  await Promise.all(liveTargets.filter((target) => accountIds.has(String(target.account).replace(/^act_/, ""))).map(async (target) => {
    const result = await deliveringCampaigns(target.account, target.token).catch((err: any) => ({ ok: false as const, message: String(err?.message ?? "no answer") }));
    const accountId = String(target.account).replace(/^act_/, "");
    if (!result.ok) {
      liveFailures.push({ accountId, name: accountNames.get(accountId) ?? accountNames.get(`act_${accountId}`) ?? accountId, message: result.message });
      logger.warn("live delivering check failed", { orgId, accountId, message: result.message });
      return;
    }
    live.accounts.add(accountId);
    for (const id of result.ids) live.delivering.add(id);
    for (const id of result.adIds) live.deliveringAds.add(id);
  }));
  return { live, liveFailures };
}

/** Since Start plus the inputs it was built from (the no-order alerts need the orders and daily spend). */
export async function sinceStartCore(orgId: string, branchId: string, today: string) {
  const { data: ownLifetime, error } = await supabase.from("tracking_ad_lifetime").select("*").eq("org_id", orgId).eq("branch_id", branchId).limit(20000);
  // Shared ad accounts: drop campaigns another branch claims, add the ones claimed here.
  const share = await branchShareView(orgId, branchId);
  let lifetimeRows = (ownLifetime ?? []) as any[];
  if (share) {
    lifetimeRows = lifetimeRows.filter((row) => !share.claimedAway.has(String(row.campaign_id)));
    for (const home of new Set(share.sharedIn.map((s) => s.homeBranchId))) {
      for (let i = 0; i < share.claimedHere.length; i += 200) {
        const { data } = await supabase.from("tracking_ad_lifetime").select("*").eq("org_id", orgId).eq("branch_id", home).in("campaign_id", share.claimedHere.slice(i, i + 200));
        lifetimeRows.push(...((data ?? []) as any[]));
      }
    }
  }
  if (error) throw error;
  const lifetime = ((lifetimeRows ?? []) as any[]).map((row) => ({ ...row, campaign_start: row.campaign_start ? String(row.campaign_start).slice(0, 10) : null, first_day: row.first_day ? String(row.first_day).slice(0, 10) : null, last_day: row.last_day ? String(row.last_day).slice(0, 10) : null, spend: Number(row.spend) || 0, platform_purchases: Number(row.platform_purchases) || 0, impressions: Number(row.impressions) || 0, link_clicks: Number(row.link_clicks) || 0, video_hook: Number(row.video_hook) || 0, video_full: Number(row.video_full) || 0 })) as LifetimeRow[];
  // Orders from each campaign's start, but at most 180 days back.
  const earliest = lifetime.map((row) => row.campaign_start ?? row.first_day).filter((day): day is string => Boolean(day) && day! > "2015-01-01").sort()[0] ?? today;
  const ordersFrom = [earliest, addDaysToDateKey(today, -180)].sort().pop()!;
  const loadFrom = [ordersFrom, addDaysToDateKey(today, -37)].sort()[0];
  const data = await loadAdSpendInputs(orgId, branchId, loadFrom, today);
  const products = new Map(data.basics.products.map((row) => [row.id, { name: row.name }]));
  const { targets, targetList } = await productTargets(orgId, branchId, today, data.orders, data.basics.products);
  const accountNames = new Map(Array.from(data.accounts.values()).map((row) => [row.accountId, row.name]));
  // Running = an ad delivering right now, asked live per ad account (one call each).
  const lifetimeAccounts = new Set(lifetime.filter((row) => row.platform === "meta").map((row) => String(row.account_id ?? "").replace(/^act_/, "")));
  const { live, liveFailures } = await liveDelivering(orgId, data.basics, share, lifetimeAccounts, accountNames);
  const rows = sinceStart({ today, ordersFrom, lifetime, orders: data.orders, mappings: mappingIndex(data.mappings), evidence: data.evidence, targets, products, accountNames, live });
  // How many Meta-side orders carry their campaign (orders without one can't be counted on a campaign).
  const recent = data.orders.filter((order) => order.day >= addDaysToDateKey(today, -29) && !order.otherPlatform);
  const linked = recent.filter((order) => order.campaignId).length;
  const { data: state } = await supabase.from("tracking_ad_spend_state").select("last_lifetime_at").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  return { rows, ordersFrom, targets: targetList.filter((row) => row.breakEven !== null || row.own !== null || rows.some((campaign) => campaign.productId === row.productId)), linkedShare: recent.length ? linked / recent.length : null, lastLifetimeAt: state?.last_lifetime_at ?? null, data, liveFailures };
}

/**
 * Every 30 minutes: today's spend so far (and yesterday until it is final)
 * for each branch with a switched-on ad account and auto sync on.
 */
export async function runAdSpendAutoSync(now = new Date()) {
  const [accounts, sources, states, tiktok] = await Promise.all([
    supabase.from("tracking_meta_ad_accounts").select("org_id, branch_id").eq("active", true),
    supabase.from("tracking_data_sources").select("org_id, branch_id, ad_account_ids"),
    supabase.from("tracking_ad_spend_state").select("org_id, branch_id, auto_sync"),
    supabase.from("tracking_tiktok_connections").select("org_id, branch_id").not("access_token", "is", null)
  ]);
  for (const result of [accounts, sources, states, tiktok]) if (result.error) throw result.error;
  const off = new Set((states.data ?? []).filter((row: any) => row.auto_sync === false).map((row: any) => `${row.org_id}|${row.branch_id}`));
  const branches = new Map<string, { orgId: string; branchId: string }>();
  const shared = await supabase.from("tracking_ad_account_shares").select("org_id, branch_id");
  for (const row of [...(accounts.data ?? []), ...(tiktok.data ?? []), ...(shared.data ?? []), ...(sources.data ?? []).filter((item: any) => (item.ad_account_ids ?? []).length)] as any[]) {
    const key = `${row.org_id}|${row.branch_id}`;
    if (!off.has(key)) branches.set(key, { orgId: row.org_id, branchId: row.branch_id });
  }
  const today = lagosDateKey(now.toISOString());
  const yesterday = addDaysToDateKey(today, -1);
  let synced = 0;
  for (const { orgId, branchId } of branches.values()) {
    try {
      const { data: final } = await supabase.from("tracking_ad_spend_days").select("day").eq("org_id", orgId).eq("branch_id", branchId).eq("day", yesterday).maybeSingle();
      const result = await syncAdSpend(orgId, branchId, { from: final ? today : yesterday, to: today, trigger: "auto", now });
      if (result.accounts) synced += 1;
    } catch (error: any) {
      console.warn("[ad-spend] auto sync failed:", branchId, error?.message ?? error);
    }
  }
  await refreshPixelAdAccounts(now).catch((error) => console.warn("[ad-spend] pixel ad accounts failed:", error?.message ?? error));
  return { synced };
}

/**
 * Each Pixel's ad accounts from Meta (shared with / owner), at most every 6
 * hours per Pixel and 40 Pixels per run, so the 30-minute sync stays light.
 */
const pixelAccountsRunning = new Set<string>();
/** Unchecked Pixels of one org, all at once (opening Tracking Links calls this; Bright: "I want all to show now"). */
export async function refreshPixelAdAccountsNow(orgId: string) {
  if (pixelAccountsRunning.has(orgId)) return;
  pixelAccountsRunning.add(orgId);
  try { await refreshPixelAdAccounts(new Date(), { orgId, onlyNew: true, limit: 300 }); } finally { pixelAccountsRunning.delete(orgId); }
}

async function refreshPixelAdAccounts(now: Date, opts: { orgId?: string; onlyNew?: boolean; limit?: number } = {}) {
  const stale = new Date(now.getTime() - 6 * 3_600_000).toISOString();
  let query = supabase.from("tracking_data_sources").select("id, pixel_id, connection_id, ad_accounts_at")
    .or("platform.is.null,platform.eq.meta").not("connection_id", "is", null).not("pixel_id", "is", null);
  if (opts.orgId) query = query.eq("org_id", opts.orgId);
  query = opts.onlyNew ? query.is("ad_accounts_at", null) : query.or(`ad_accounts_at.is.null,ad_accounts_at.lt.${stale}`);
  const { data: pixels, error } = await query.order("ad_accounts_at", { ascending: true, nullsFirst: true }).limit(opts.limit ?? 120);
  if (error) throw error;
  if (!pixels?.length) return;
  const ids = [...new Set(pixels.map((row: any) => row.connection_id))];
  const { data: connections } = await supabase.from("tracking_meta_connections").select("id, business_id, access_token").in("id", ids);
  const connectionOf = new Map((connections ?? []).map((row: any) => [row.id, row]));
  // Five at a time: quick, and gentle on Meta.
  const list = pixels as any[];
  for (let i = 0; i < list.length; i += 5) {
    await Promise.all(list.slice(i, i + 5).map(async (pixel) => {
      const connection: any = connectionOf.get(pixel.connection_id);
      if (!connection?.access_token) return;
      const result = await pixelAdAccounts(String(pixel.pixel_id), connection.business_id ?? null, String(connection.access_token));
      await supabase.from("tracking_data_sources").update(result.ok
        ? { ad_accounts: result.accounts, ad_accounts_at: new Date().toISOString(), ad_accounts_error: null }
        : { ad_accounts_at: new Date().toISOString(), ad_accounts_error: result.message.slice(0, 300) }).eq("id", pixel.id);
    }));
  }
}
