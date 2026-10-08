import { supabase } from "./supabase.js";
import { addDaysToDateKey, lagosDateKey } from "./sales-bonus-engine.js";
import { orderAdIds, otherAdPlatform, productFromName } from "./tracking-hub.js";
import { dayOfIso, endIso, journeyCounts, loadBasics, startIso, type Basics } from "./tracking-hub-data.js";
import { refreshAccount, refreshTargets } from "./tracking-meta-refresh.js";
import { TIKTOK_PREFIX, linkEvidence, nameKey, tiktokOrderIds, type AccountInfo, type AdPlatform, type SpendInsight, type SpendMapping, type SpendOrder } from "./ad-spend.js";
import { tiktokAdSpend } from "./tiktok-ads.js";

// Loading and syncing for Tracking Hub -> Ad Spend (Bright, 8 Oct 2026). The
// maths is in ad-spend.ts; this file reads the database and Meta.

const PAGE = 1000;

async function insightsBetween(orgId: string, branchId: string, from: string, to: string): Promise<SpendInsight[]> {
  const rows: SpendInsight[] = [];
  for (let page = 0; page < 60; page += 1) {
    const { data, error } = await supabase.from("tracking_meta_ad_insights")
      .select("id, day, spend, ad_account_id, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name")
      .eq("org_id", orgId).eq("branch_id", branchId).gte("day", from).lte("day", to)
      .order("id").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as any[]).map((row) => ({ ...row, platform: "meta" as const, day: String(row.day).slice(0, 10), spend: Number(row.spend) || 0 })));
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

export async function loadAdSpendInputs(orgId: string, branchId: string, from: string, to: string) {
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
    loadBasics(orgId, branchId), insightsBetween(orgId, branchId, from, to), ordersBetween(orgId, branchId, from, to, campaignByName),
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
  const connected: AdPlatform[] = ["meta"];
  if (tiktokConnections.some((row) => row.access_token && (row.advertisers ?? []).some((adv: any) => adv.active !== false))) connected.push("tiktok");
  return {
    tiktokConnections, connected,
    basics, insights, orders, mappings: (mappingsRes.data ?? []) as Array<SpendMapping & { ad_account_id: string | null; label: string; created_by_name: string | null; updated_at: string }>,
    state: stateRes.data as any, finalDays: new Set((daysRes.data ?? []).map((row: any) => String(row.day).slice(0, 10))),
    evidence: linkEvidence(visits), accounts: addTikTokAccounts(accountsOf(basics), tiktokConnections)
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
  if (targets.length + tiktokTargets.length === 0) return { ok: false, accounts: 0, failed: [] as string[], message: "No ad account is switched on. Connect your Meta Business or TikTok Ads in Data Sources and switch on its ad accounts." };
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
  return { ok, accounts: report.length, failed: failed.map((row) => row.source), message };
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
  for (const row of [...(accounts.data ?? []), ...(tiktok.data ?? []), ...(sources.data ?? []).filter((item: any) => (item.ad_account_ids ?? []).length)] as any[]) {
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
  return { synced };
}
