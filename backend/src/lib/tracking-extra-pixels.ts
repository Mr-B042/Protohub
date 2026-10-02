import { supabase } from "./supabase.js";
import { sendMetaCapiPurchase, type MetaCapiSendResult } from "./meta-capi.js";
import { connectionToken } from "./tracking-credentials.js";

// "Also send to" Pixels on a tracking link (Bright, 2 Oct 2026). The Racks
// page is advertised from two businesses that optimise on different Pixels,
// so each sale goes to the link's main Pixel (meta_capi_events, unchanged)
// and to every extra Pixel here, with the same event id (the order id) so
// each Pixel counts the sale once. One row per order per extra Pixel
// (tracking_extra_pixel_sends); a sent Pixel is never sent again.

type SendArgs = Omit<Parameters<typeof sendMetaCapiPurchase>[0], "config" | "eventId">;

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

/** Send one order's Purchase to each extra Pixel and record each result. */
export async function sendPurchaseToExtraPixels(input: {
  orgId: string; branchId: string | null | undefined; trackingKey: string | null | undefined; mainPixelId?: string | null;
  orderId: string; eventId: string; args: SendArgs;
}) {
  if (!input.branchId) return [];
  const pixels = await extraPixelsForLink(input.orgId, input.trackingKey, input.mainPixelId);
  if (pixels.length === 0) return [];
  const { data: done } = await supabase.from("tracking_extra_pixel_sends").select("pixel_id, status, attempts, id")
    .eq("org_id", input.orgId).eq("order_id", input.orderId).eq("event_name", "Purchase");
  const results: Array<{ pixelId: string; status: string }> = [];
  await Promise.all(pixels.map(async (pixel) => {
    const previous = (done ?? []).find((row: any) => String(row.pixel_id) === pixel.pixelId);
    if (previous && (previous.status === "sent" || previous.status === "dry_run")) return;
    let result: MetaCapiSendResult;
    if (pixel.paused) result = { status: "off", message: "Pixel paused in the Tracking Hub." };
    else if (!pixel.token) result = { status: "missing_config", message: "No token for this Pixel (connect its Meta Business or give it its own token)." };
    else {
      result = await sendMetaCapiPurchase({
        ...input.args,
        config: { mode: "hybrid", pixelId: pixel.pixelId, accessToken: pixel.token, testEventCode: pixel.testEventCode ?? undefined, testMode: pixel.testing },
        eventId: input.eventId
      }).catch((error: any) => ({ status: "failed" as const, message: error?.message ?? "Send failed." }));
    }
    if (result.status === "duplicate") return;
    const row = {
      org_id: input.orgId, branch_id: input.branchId, order_id: input.orderId, event_name: "Purchase", data_source_id: pixel.dataSourceId,
      pixel_id: pixel.pixelId, event_id: input.eventId, status: result.status, http_status: result.httpStatus ?? null, message: result.message ?? null,
      test_mode: pixel.testing, value: input.args.value ?? null, currency: input.args.currency ?? null, sent_at: new Date().toISOString()
    };
    if (previous) await supabase.from("tracking_extra_pixel_sends").update({ ...row, attempts: Number(previous.attempts ?? 1) + 1 }).eq("id", previous.id);
    else await supabase.from("tracking_extra_pixel_sends").insert(row);
    results.push({ pixelId: pixel.pixelId, status: result.status });
  }));
  return results;
}
