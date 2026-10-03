import { supabase } from "./supabase.js";
import { adsetPixel } from "./meta-graph.js";
import { extraPixelsForLink } from "./tracking-extra-pixels.js";
import type { MetaTrackingConfig } from "./meta-capi.js";

// ONE PIXEL PER SALE (Bright, 3 Oct 2026). "Also send to" used to send each
// sale to every Pixel on the tracking link, and Meta counted it once per Pixel:
// purchases that never happened, which the ads then optimised on. A sale now
// goes to ONE Pixel only - the one the ad set the customer clicked optimises
// on, when it is one of the link's Pixels - and otherwise to the link's main
// Pixel. The browser fires that same Pixel with the same event id, so browser
// + server stay one Purchase on one Pixel.

const CACHE_DAYS = 7;

/** The Pixel an ad set optimises on: remembered, else asked of Meta once. */
async function pixelOfAdset(orgId: string, branchId: string | null, adsetId: string): Promise<string | null> {
  const { data: cached } = await supabase.from("tracking_meta_adset_pixels").select("pixel_id, fetched_at")
    .eq("org_id", orgId).eq("adset_id", adsetId).maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < CACHE_DAYS * 86_400_000) return cached.pixel_id ?? null;
  let query = supabase.from("tracking_meta_connections").select("access_token").eq("org_id", orgId).not("access_token", "is", null);
  if (branchId) query = query.eq("branch_id", branchId);
  const { data: connections } = await query;
  // At most two tries (2.5s each): this runs while the customer's order saves.
  for (const connection of (connections ?? []).slice(0, 2)) {
    const result = await adsetPixel(adsetId, String(connection.access_token));
    if (!result.ok) continue;
    await supabase.from("tracking_meta_adset_pixels").upsert({
      org_id: orgId, adset_id: adsetId, campaign_id: result.campaignId, ad_account_id: result.accountId,
      pixel_id: result.pixelId, fetched_at: new Date().toISOString()
    }, { onConflict: "org_id,adset_id" });
    return result.pixelId;
  }
  return cached?.pixel_id ?? null;
}

/**
 * Where this sale's Purchase goes. `config` is the link's resolved config;
 * the answer is that config, or the same config pointed at the clicked ad
 * set's Pixel (with that Pixel's token and test settings).
 */
export async function purchasePixelFor(input: {
  orgId: string; branchId: string | null; trackingKey: string | null | undefined; config: MetaTrackingConfig; adsetId: string | null | undefined;
}): Promise<{ config: MetaTrackingConfig; pixelId: string | null; reason: "clicked_ad" | "main" }> {
  const main = { config: input.config, pixelId: input.config.pixelId ?? null, reason: "main" as const };
  try {
    if (!input.adsetId || !input.trackingKey) return main;
    const extras = await extraPixelsForLink(input.orgId, input.trackingKey, input.config.pixelId ?? null);
    if (extras.length === 0) return main;
    const clicked = await pixelOfAdset(input.orgId, input.branchId, input.adsetId);
    if (!clicked || clicked === input.config.pixelId) return main;
    const extra = extras.find((pixel) => pixel.pixelId === clicked);
    if (!extra || !extra.token || extra.paused) return main;
    return {
      config: { ...input.config, pixelId: extra.pixelId, accessToken: extra.token, testMode: extra.testing, testEventCode: extra.testEventCode ?? undefined },
      pixelId: extra.pixelId,
      reason: "clicked_ad"
    };
  } catch {
    return main;
  }
}
