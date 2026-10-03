import { supabase } from "./supabase.js";
import { connectionToken } from "./tracking-credentials.js";

// "Also send to" Pixels on a tracking link (Bright, 2 Oct 2026): the other
// Pixels this link's ads optimise on (the Racks page is advertised from two
// businesses).
// ⚠️ A SALE GOES TO ONE PIXEL ONLY (3 Oct 2026). Sending it to every Pixel
// here made Meta count it once per Pixel - purchases that never happened.
// These Pixels are now only the candidates lib/tracking-click-pixel.ts picks
// from: the clicked ad set's Pixel, else the link's main Pixel. Never re-add
// a "send to all extras" path. tracking_extra_pixel_sends keeps the history.

/** The link's extra Pixels, each with the token and test setting it sends with. */
export async function extraPixelsForLink(orgId: string, trackingKey: string | null | undefined, mainPixelId?: string | null) {
  const key = String(trackingKey ?? "").trim().toLowerCase();
  if (!key) return [];
  const { data: link } = await supabase.from("meta_capi_configs").select("extra_data_source_ids, active").eq("org_id", orgId).eq("tracking_key", key).maybeSingle();
  const ids = ((link?.active === false ? [] : link?.extra_data_source_ids) ?? []) as string[];
  if (ids.length === 0) return [];
  const { data: sources } = await supabase.from("tracking_data_sources")
    .select("id, name, pixel_id, access_token, connection_id, test_event_code, status, active, platform").eq("org_id", orgId).in("id", ids);
  const pixels = [];
  for (const source of sources ?? []) {
    if (source.active === false || (source.platform ?? "meta") !== "meta") continue;
    if (mainPixelId && String(source.pixel_id) === String(mainPixelId)) continue;
    const token = source.access_token || (await connectionToken(source.connection_id));
    const testing = source.status === "testing";
    pixels.push({
      dataSourceId: source.id as string, name: source.name as string, pixelId: String(source.pixel_id), token: token ?? null,
      testing, testEventCode: testing ? source.test_event_code ?? null : null, paused: source.status === "paused"
    });
  }
  return pixels;
}
