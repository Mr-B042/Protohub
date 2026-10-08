// Reading TikTok Ads Manager (Bright, 8 Oct 2026): spend per ad per day from
// TikTok's Marketing API, with a token from a TikTok for Business developer
// app that the advertiser accounts were authorised to. Meta's equivalent is
// lib/meta-graph.ts.

// TIKTOK_ADS_BASE lets the local sandbox point at a stand-in; never set in production.
const BASE = (process.env.TIKTOK_ADS_BASE || "https://business-api.tiktok.com/open_api/v1.3").replace(/\/+$/, "");

type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function apiGet<T>(path: string, token: string, params: Record<string, string>): Promise<ApiResult<T>> {
  const url = new URL(`${BASE}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { headers: { "Access-Token": token } });
    const json: any = await response.json().catch(() => ({}));
    // TikTok answers HTTP 200 with { code: 0 } on success; any other code is a refusal.
    if (!response.ok || (json?.code !== undefined && json.code !== 0)) return { ok: false, message: json?.message || `TikTok returned HTTP ${response.status}` };
    return { ok: true, data: json?.data as T };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? "Could not reach TikTok." };
  }
}

export type TikTokAdvertiser = { id: string; name: string; currency: string | null; timezone: string | null; hasAccess: boolean };

/** Names, currency and timezone of these advertiser accounts; an id the token can't read comes back without access. */
export async function tiktokAdvertisers(token: string, ids: string[]): Promise<ApiResult<TikTokAdvertiser[]>> {
  const unique = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (!unique.length) return { ok: false, message: "Add at least one advertiser ID." };
  const result = await apiGet<{ list?: Array<{ advertiser_id?: string | number; name?: string; currency?: string; timezone?: string }> }>("advertiser/info/", token, {
    advertiser_ids: JSON.stringify(unique), fields: JSON.stringify(["advertiser_id", "name", "currency", "timezone"])
  });
  if (!result.ok) return result;
  const found = new Map((result.data?.list ?? []).map((row) => [String(row.advertiser_id), row]));
  return { ok: true, data: unique.map((id) => {
    const row = found.get(id);
    return { id, name: row?.name ?? "", currency: row?.currency ?? null, timezone: row?.timezone ?? null, hasAccess: Boolean(row) };
  }) };
}

export type TikTokAdDay = { day: string; campaignId: string; campaignName: string; adgroupId: string; adgroupName: string; adId: string; adName: string; spend: number; conversions: number };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Spend per ad per day for one advertiser (TikTok allows 30 days per daily report, so longer spans are read in pieces). */
export async function tiktokAdSpend(token: string, advertiserId: string, since: string, until: string): Promise<ApiResult<TikTokAdDay[]>> {
  const rows: TikTokAdDay[] = [];
  for (let start = since; start <= until; start = addDays(start, 30)) {
    const end = addDays(start, 29) < until ? addDays(start, 29) : until;
    for (let page = 1; page <= 50; page += 1) {
      const result = await apiGet<{ list?: Array<{ dimensions?: Record<string, string>; metrics?: Record<string, string> }>; page_info?: { total_page?: number } }>("report/integrated/get/", token, {
        advertiser_id: advertiserId, report_type: "BASIC", data_level: "AUCTION_AD",
        dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
        metrics: JSON.stringify(["spend", "conversion", "campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "ad_name"]),
        start_date: start, end_date: end, page: String(page), page_size: "1000"
      });
      if (!result.ok) return result;
      for (const row of result.data?.list ?? []) {
        const d = row.dimensions ?? {};
        const m = row.metrics ?? {};
        rows.push({
          day: String(d.stat_time_day ?? "").slice(0, 10), adId: String(d.ad_id ?? ""),
          campaignId: String(m.campaign_id ?? ""), campaignName: String(m.campaign_name ?? ""), adgroupId: String(m.adgroup_id ?? ""), adgroupName: String(m.adgroup_name ?? ""), adName: String(m.ad_name ?? ""),
          spend: Number(m.spend) || 0, conversions: Number(m.conversion) || 0
        });
      }
      if (page >= Number(result.data?.page_info?.total_page ?? 1)) break;
    }
  }
  return { ok: true, data: rows.filter((row) => row.adId && row.day) };
}

/** The URL parameters to paste on every TikTok ad, so each order carries its campaign, ad group and ad. */
export const TIKTOK_URL_PARAMETERS = "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_id=__CAMPAIGN_ID__&utm_term=__AID__&utm_content=__CID__";

export type TikTokAdLifetime = { campaignId: string; campaignName: string; adgroupId: string; adgroupName: string; adId: string; adName: string; spend: number; impressions: number; clicks: number; video2s: number; videoFull: number; conversions: number };

/** Each ad's numbers over its whole life (query_lifetime). TikTok's hook is 2-second views. */
export async function tiktokAdLifetime(token: string, advertiserId: string): Promise<ApiResult<TikTokAdLifetime[]>> {
  const rows: TikTokAdLifetime[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await apiGet<{ list?: Array<{ dimensions?: Record<string, string>; metrics?: Record<string, string> }>; page_info?: { total_page?: number } }>("report/integrated/get/", token, {
      advertiser_id: advertiserId, report_type: "BASIC", data_level: "AUCTION_AD", query_lifetime: "true",
      dimensions: JSON.stringify(["ad_id"]),
      metrics: JSON.stringify(["spend", "impressions", "clicks", "video_watched_2s", "video_views_p100", "conversion", "campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "ad_name"]),
      page: String(page), page_size: "1000"
    });
    if (!result.ok) return result;
    for (const row of result.data?.list ?? []) {
      const m = row.metrics ?? {};
      rows.push({
        adId: String(row.dimensions?.ad_id ?? ""), campaignId: String(m.campaign_id ?? ""), campaignName: String(m.campaign_name ?? ""), adgroupId: String(m.adgroup_id ?? ""), adgroupName: String(m.adgroup_name ?? ""), adName: String(m.ad_name ?? ""),
        spend: Number(m.spend) || 0, impressions: Number(m.impressions) || 0, clicks: Number(m.clicks) || 0, video2s: Number(m.video_watched_2s) || 0, videoFull: Number(m.video_views_p100) || 0, conversions: Number(m.conversion) || 0
      });
    }
    if (page >= Number(result.data?.page_info?.total_page ?? 1)) break;
  }
  return { ok: true, data: rows.filter((row) => row.adId && row.spend > 0) };
}

/** When each campaign was created (TikTok's "start"). */
export async function tiktokCampaignStarts(token: string, advertiserId: string): Promise<ApiResult<Array<{ campaignId: string; createdAt: string | null; status: string | null }>>> {
  const rows: Array<{ campaignId: string; createdAt: string | null; status: string | null }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await apiGet<{ list?: Array<{ campaign_id?: string; create_time?: string; operation_status?: string; secondary_status?: string }>; page_info?: { total_page?: number } }>("campaign/get/", token, {
      advertiser_id: advertiserId, page: String(page), page_size: "1000", fields: JSON.stringify(["campaign_id", "create_time", "operation_status", "secondary_status"])
    });
    if (!result.ok) return result;
    for (const row of result.data?.list ?? []) rows.push({ campaignId: String(row.campaign_id ?? ""), createdAt: row.create_time ?? null, status: row.operation_status === "ENABLE" ? "ACTIVE" : row.operation_status === "DISABLE" ? "PAUSED" : row.secondary_status ?? null });
    if (page >= Number(result.data?.page_info?.total_page ?? 1)) break;
  }
  return { ok: true, data: rows };
}
