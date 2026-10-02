// Reading from Meta (Bright, 2 Oct 2026) with a data source's token (a
// System User token with ads_read / ads_management). Protohub used to only
// SEND to Meta; the Tracking Hub also needs Meta's own numbers: events a
// dataset received, and purchases Meta attributes to each campaign.

const GRAPH = `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || "v23.0").replace(/^\/+|\/+$/g, "")}`;

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
