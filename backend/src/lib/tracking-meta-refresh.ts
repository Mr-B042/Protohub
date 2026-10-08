import { supabase } from "./supabase.js";
import { accountAdsetPixels, adPurchases, campaignsByIds } from "./meta-graph.js";
import { humanMetaError } from "./tracking-hub.js";
import type { loadBasics } from "./tracking-hub-data.js";

// Reading Meta's numbers into tracking_meta_ad_insights (moved here unchanged
// from routes/tracking-hub.ts on 8 Oct 2026 so the Ad Spend auto sync can use
// the same code as Reconciliation's Refresh Data).

export type RefreshTarget = { label: string; account: string; token: string; sourceId: string | null; connectionId: string | null };

/** What Refresh Data reads: connections' switched-on ad accounts (their token), then ad account ids typed on manually added Pixels. */
export function refreshTargets(basics: Awaited<ReturnType<typeof loadBasics>>): RefreshTarget[] {
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
export async function refreshAccount(orgId: string, branchId: string, target: RefreshTarget, from: string, to: string) {
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
  // Each ad set's Pixel, so an order goes to the ONE Pixel of the ad clicked
  // without asking Meta while the customer waits (lib/tracking-click-pixel.ts).
  const adsets = await accountAdsetPixels(account, target.token);
  if (adsets.ok && adsets.rows.length) {
    const fetchedAt = new Date().toISOString();
    await supabase.from("tracking_meta_adset_pixels").upsert(adsets.rows.map((row) => ({
      org_id: orgId, adset_id: row.adsetId, campaign_id: row.campaignId, ad_account_id: account, pixel_id: row.pixelId, fetched_at: fetchedAt
    })), { onConflict: "org_id,adset_id" });
  }
  return { source: target.label, account, ok: true, message: info.ok ? "Loaded." : `Loaded; campaign names not read (${humanMetaError(info.message, null).title}).`, rows: result.rows.length };
}
