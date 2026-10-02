// Reading from Meta (Bright, 2 Oct 2026) with a data source's token (a
// System User token with ads_read / ads_management). Protohub used to only
// SEND to Meta; the Tracking Hub also needs Meta's own numbers: events a
// dataset received, and purchases Meta attributes to each campaign.

// META_GRAPH_BASE lets the local sandbox point at a stand-in Meta; never set in production.
const GRAPH = `${(process.env.META_GRAPH_BASE || "https://graph.facebook.com").replace(/\/+$/, "")}/${(process.env.META_GRAPH_VERSION || "v23.0").replace(/^\/+|\/+$/g, "")}`;

type GraphResult<T> = { ok: true; data: T } | { ok: false; message: string; status?: number };

async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<GraphResult<T>> {
  const url = new URL(`${GRAPH}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("access_token", token);
  try {
    const response = await fetch(url, { method: "GET" });
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok || json?.error) {
      return { ok: false, status: response.status, message: json?.error?.error_user_msg || json?.error?.message || `Meta returned HTTP ${response.status}` };
    }
    return { ok: true, data: json as T };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? "Could not reach Meta." };
  }
}

/** Is the token able to see this dataset? Also returns when it last received an event. */
export async function checkDataset(pixelId: string, token: string) {
  const result = await graphGet<{ id: string; name?: string; last_fired_time?: string; is_unavailable?: boolean }>(pixelId, token, { fields: "id,name,last_fired_time,is_unavailable" });
  if (!result.ok) return { ok: false as const, message: result.message, status: result.status };
  return { ok: true as const, name: result.data.name ?? null, lastFiredAt: result.data.last_fired_time ?? null, unavailable: Boolean(result.data.is_unavailable) };
}

/** Events the dataset received in the last N days, by event name. */
export async function datasetEventCounts(pixelId: string, token: string, days = 7) {
  const start = Math.floor((Date.now() - days * 86_400_000) / 1000);
  const result = await graphGet<{ data?: Array<{ data?: Array<{ value: string; count: number }> }> }>(`${pixelId}/stats`, token, { aggregation: "event", start_time: String(start) });
  if (!result.ok) return { ok: false as const, message: result.message };
  const counts: Record<string, number> = {};
  for (const bucket of result.data.data ?? []) {
    for (const row of bucket.data ?? []) counts[row.value] = (counts[row.value] ?? 0) + Number(row.count || 0);
  }
  return { ok: true as const, counts };
}

const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const pickAction = (rows: Array<{ action_type: string; value: string }> | undefined) => {
  for (const type of PURCHASE_ACTIONS) {
    const row = (rows ?? []).find((item) => item.action_type === type);
    if (row) return Number(row.value) || 0;
  }
  return 0;
};

export type CampaignDay = { day: string; campaignId: string; campaignName: string; purchases: number; purchaseValue: number; spend: number };

/** Purchases Meta attributes to each campaign, per day, for one ad account. */
export async function campaignPurchases(adAccountId: string, token: string, since: string, until: string): Promise<{ ok: true; rows: CampaignDay[] } | { ok: false; message: string }> {
  const account = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const rows: CampaignDay[] = [];
  let path = `${account}/insights`;
  let params: Record<string, string> = {
    level: "campaign", time_increment: "1", limit: "500",
    fields: "campaign_id,campaign_name,spend,actions,action_values,date_start",
    time_range: JSON.stringify({ since, until })
  };
  for (let page = 0; page < 20; page += 1) {
    const result = await graphGet<{ data?: any[]; paging?: { next?: string } }>(path, token, params);
    if (!result.ok) return { ok: false, message: result.message };
    for (const row of result.data.data ?? []) {
      rows.push({
        day: row.date_start, campaignId: String(row.campaign_id), campaignName: String(row.campaign_name ?? ""),
        purchases: pickAction(row.actions), purchaseValue: pickAction(row.action_values), spend: Number(row.spend) || 0
      });
    }
    const next = result.data.paging?.next;
    if (!next) break;
    const nextUrl = new URL(next);
    path = nextUrl.pathname.replace(/^\/v[\d.]+\//, "");
    params = Object.fromEntries(Array.from(nextUrl.searchParams.entries()).filter(([key]) => key !== "access_token"));
  }
  return { ok: true, rows };
}

// ------------------------------------------------- Tracking Hub v2 (2 Oct 2026)

/**
 * Events the dataset received: this week vs the week before, and the last
 * 24 hours vs the 24 before (Data Sources "Events (7d)" and "Recent Events").
 * Meta returns hourly buckets with a start_time.
 */
export async function datasetEventStats(pixelId: string, token: string) {
  const now = Date.now();
  const start = Math.floor((now - 14 * 86_400_000) / 1000);
  const result = await graphGet<{ data?: Array<{ start_time?: string; data?: Array<{ value: string; count: number }> }> }>(`${pixelId}/stats`, token, { aggregation: "event", start_time: String(start) });
  if (!result.ok) return { ok: false as const, message: result.message };
  const bucket = () => ({} as Record<string, number>);
  const counts7d = bucket(); const prev7d = bucket(); const counts24h = bucket(); const prev24h = bucket();
  for (const row of result.data.data ?? []) {
    const at = row.start_time ? Date.parse(row.start_time) : now;
    const age = now - at;
    for (const item of row.data ?? []) {
      const add = (target: Record<string, number>) => { target[item.value] = (target[item.value] ?? 0) + Number(item.count || 0); };
      if (age <= 7 * 86_400_000) add(counts7d); else add(prev7d);
      if (age <= 86_400_000) add(counts24h); else if (age <= 2 * 86_400_000) add(prev24h);
    }
  }
  return { ok: true as const, counts7d, prev7d, counts24h, prev24h };
}

/**
 * Event Match Quality from Meta's Dataset Quality API. Not every token or
 * dataset can read it; then null is returned and the page says so.
 */
export async function datasetQuality(pixelId: string, token: string): Promise<Record<string, number> | null> {
  const result = await graphGet<{ web?: Array<{ event_name?: string; event_match_quality?: { composite_score?: number } }> }>("dataset_quality", token, {
    dataset_id: pixelId, fields: "web{event_name,event_match_quality{composite_score}}"
  });
  if (!result.ok) return null;
  const scores: Record<string, number> = {};
  for (const row of result.data.web ?? []) {
    const score = row.event_match_quality?.composite_score;
    if (row.event_name && typeof score === "number") scores[row.event_name] = Math.round(score * 10) / 10;
  }
  return Object.keys(scores).length ? scores : null;
}

export type AdDay = CampaignDay & { adsetId: string; adsetName: string; adId: string; adName: string };

/** Purchases Meta attributes to each AD per day (Reconciliation views). */
export async function adPurchases(adAccountId: string, token: string, since: string, until: string): Promise<{ ok: true; rows: AdDay[] } | { ok: false; message: string }> {
  const account = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const rows: AdDay[] = [];
  let path = `${account}/insights`;
  let params: Record<string, string> = {
    level: "ad", time_increment: "1", limit: "500",
    fields: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,actions,action_values,date_start",
    time_range: JSON.stringify({ since, until })
  };
  for (let page = 0; page < 40; page += 1) {
    const result = await graphGet<{ data?: any[]; paging?: { next?: string } }>(path, token, params);
    if (!result.ok) return { ok: false, message: result.message };
    for (const row of result.data.data ?? []) {
      rows.push({
        day: row.date_start, campaignId: String(row.campaign_id), campaignName: String(row.campaign_name ?? ""),
        adsetId: String(row.adset_id ?? ""), adsetName: String(row.adset_name ?? ""), adId: String(row.ad_id), adName: String(row.ad_name ?? ""),
        purchases: pickAction(row.actions), purchaseValue: pickAction(row.action_values), spend: Number(row.spend) || 0
      });
    }
    const next = result.data.paging?.next;
    if (!next) break;
    const nextUrl = new URL(next);
    path = nextUrl.pathname.replace(/^\/v[\d.]+\//, "");
    params = Object.fromEntries(Array.from(nextUrl.searchParams.entries()).filter(([key]) => key !== "access_token"));
  }
  return { ok: true, rows };
}

/** Objective, status and dates of an ad account's campaigns. */
export async function campaignInfo(adAccountId: string, token: string) {
  const account = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
  const result = await graphGet<{ data?: Array<{ id: string; name?: string; objective?: string; effective_status?: string; start_time?: string; stop_time?: string }> }>(`${account}/campaigns`, token, {
    fields: "id,name,objective,effective_status,start_time,stop_time", limit: "500"
  });
  if (!result.ok) return { ok: false as const, message: result.message };
  return { ok: true as const, rows: result.data.data ?? [] };
}

/**
 * "Scan Website": load a page and find the Meta Pixel ids it starts
 * (fbq('init', '...')) and whether a Protohub order form is embedded. Only
 * what is in the page's HTML - a Pixel added later by a tag manager is not
 * visible here, so "not found" is reported as such, never as "no Pixel".
 */
export async function scanPage(url: string) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(url, { headers: { "User-Agent": "ProtohubTrackingHub/1.0 (+scan)" }, signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    const html = (await response.text()).slice(0, 2_000_000);
    const pixels = new Set<string>();
    for (const match of html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,25})['"]/g)) pixels.add(match[1]);
    for (const match of html.matchAll(/facebook\.com\/tr\?id=(\d{8,25})/g)) pixels.add(match[1]);
    const usesTagManager = /googletagmanager\.com\/gtm\.js/.test(html);
    return {
      url, ok: response.ok, status: response.status,
      pixels: Array.from(pixels),
      protohubForm: /ordo-order-embed|#\/order-form\/embed/.test(html),
      purchaseOnPage: /fbq\(\s*['"]track['"]\s*,\s*['"]Purchase['"]/.test(html),
      usesTagManager
    };
  } catch (error: any) {
    return { url, ok: false, status: 0, pixels: [] as string[], protohubForm: false, purchaseOnPage: false, usesTagManager: false, error: error?.name === "AbortError" ? "The page took too long to load." : (error?.message ?? "Could not load the page.") };
  }
}

// ------------------------------------------------- Meta Business connections
// (Bright, 2 Oct 2026) Connect a business once, then find its Pixels and ad
// accounts. A Pixel or ad account the System User has not been given shows as
// "no access" - Meta lists it for the business but the token cannot use it.

async function graphAll<T>(path: string, token: string, params: Record<string, string>, max = 500): Promise<GraphResult<T[]>> {
  const rows: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20 && rows.length < max; page += 1) {
    const result = await graphGet<{ data?: T[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, token, { ...params, limit: "100", ...(after ? { after } : {}) });
    if (!result.ok) return result;
    rows.push(...(result.data.data ?? []));
    after = result.data.paging?.next ? result.data.paging?.cursors?.after : undefined;
    if (!after) break;
  }
  return { ok: true, data: rows };
}

/** Who the token belongs to (the System User) and the businesses it can see. */
export async function metaWhoAmI(token: string) {
  const me = await graphGet<{ id: string; name?: string }>("me", token, { fields: "id,name" });
  if (!me.ok) return { ok: false as const, message: me.message, status: me.status };
  const businesses = await graphAll<{ id: string; name?: string }>("me/businesses", token, { fields: "id,name" });
  return {
    ok: true as const, userId: me.data.id, userName: me.data.name ?? null,
    businesses: businesses.ok ? businesses.data.map((row) => ({ id: row.id, name: row.name ?? "" })) : [],
    businessesError: businesses.ok ? null : businesses.message
  };
}

export async function metaBusiness(businessId: string, token: string) {
  const result = await graphGet<{ id: string; name?: string }>(businessId, token, { fields: "id,name" });
  return result.ok ? { ok: true as const, id: result.data.id, name: result.data.name ?? "" } : { ok: false as const, message: result.message };
}

export type DiscoveredPixel = { id: string; name: string; lastFiredAt: string | null; hasAccess: boolean; owned: boolean };
export type DiscoveredAdAccount = { accountId: string; name: string; currency: string | null; timezone: string | null; status: number | null; hasAccess: boolean };

/** The business's Pixels / datasets (owned and shared with it), and whether the token can use each. */
export async function discoverPixels(businessId: string, token: string): Promise<{ ok: true; pixels: DiscoveredPixel[] } | { ok: false; message: string }> {
  const fields = "id,name,last_fired_time";
  const [owned, client] = await Promise.all([graphAll<any>(`${businessId}/owned_pixels`, token, { fields }), graphAll<any>(`${businessId}/client_pixels`, token, { fields })]);
  if (!owned.ok) return { ok: false, message: owned.message };
  const byId = new Map<string, DiscoveredPixel>();
  for (const [rows, isOwned] of [[owned.data, true], [client.ok ? client.data : [], false]] as Array<[any[], boolean]>) {
    for (const row of rows) if (row?.id && !byId.has(String(row.id))) byId.set(String(row.id), { id: String(row.id), name: row.name ?? "", lastFiredAt: row.last_fired_time ?? null, hasAccess: false, owned: isOwned });
  }
  // Access = the token can read the Pixel itself (it has been given to the System User).
  for (const pixel of byId.values()) {
    const check = await graphGet<{ id: string }>(pixel.id, token, { fields: "id" });
    pixel.hasAccess = check.ok;
  }
  return { ok: true, pixels: Array.from(byId.values()) };
}

/** The business's ad accounts, and which ones the token has been given. */
export async function discoverAdAccounts(businessId: string, token: string): Promise<{ ok: true; accounts: DiscoveredAdAccount[] } | { ok: false; message: string }> {
  const fields = "account_id,name,currency,timezone_name,account_status";
  const [owned, client, mine] = await Promise.all([
    graphAll<any>(`${businessId}/owned_ad_accounts`, token, { fields }), graphAll<any>(`${businessId}/client_ad_accounts`, token, { fields }), graphAll<any>("me/adaccounts", token, { fields })
  ]);
  if (!owned.ok && !mine.ok) return { ok: false, message: owned.message };
  const assigned = new Set((mine.ok ? mine.data : []).map((row) => String(row.account_id)));
  const byId = new Map<string, DiscoveredAdAccount>();
  for (const row of [...(owned.ok ? owned.data : []), ...(client.ok ? client.data : []), ...(mine.ok ? mine.data : [])]) {
    const id = String(row?.account_id ?? "");
    if (!id || byId.has(id)) continue;
    byId.set(id, { accountId: id, name: row.name ?? "", currency: row.currency ?? null, timezone: row.timezone_name ?? null, status: typeof row.account_status === "number" ? row.account_status : null, hasAccess: assigned.has(id) });
  }
  return { ok: true, accounts: Array.from(byId.values()) };
}
