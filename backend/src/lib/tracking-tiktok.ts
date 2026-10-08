import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { sendTikTokConversion } from "./tiktok-events.js";
import { serverEventsAllowed } from "./tracking-credentials.js";
import { loadHubSettings } from "./tracking-hub-data.js";

// TikTok sales from the server (Tracking Hub, Bright 8 Oct 2026). Every order
// that came from a TikTok ad (ttclid or utm_source=tiktok) is sent to TikTok's
// Events API ONCE as CompletePayment, event id = the Protohub order id.
//
// ⚠️ ONE SALE, ONE PIXEL. The Pixel is the branch's default TikTok data
// source (Settings -> default data source per platform), else the one marked
// main, else the only one. Never several - TikTok counts a sale per Pixel.
// ⚠️ A TikTok Pixel on the thank-you page would count the same sale again
// (the Protohub form fires no TikTok Pixel itself). A data source marked
// Testing sends only to TikTok's Test Events until it is switched to live.

export type TikTokTarget = { pixelId: string; token: string; testEventCode: string | null; dataSourceId: string | null; testing: boolean };

/** The ONE TikTok Pixel this branch's sales go to, or why there is none. */
export async function tiktokTargetFor(orgId: string, branchId: string | null, legacy?: { pixelId?: string | null; token?: string | null; testEventCode?: string | null } | null): Promise<TikTokTarget | { skip: string }> {
  if (branchId) {
    const [{ data: sources }, settings] = await Promise.all([
      supabase.from("tracking_data_sources").select("id, pixel_id, access_token, test_event_code, status, active, is_main").eq("org_id", orgId).eq("branch_id", branchId).eq("platform", "tiktok"),
      loadHubSettings(orgId, branchId)
    ]);
    const rows = (sources ?? []) as any[];
    const chosen = rows.find((row) => row.id === settings.defaultDataSources?.tiktok) ?? rows.find((row) => row.is_main) ?? (rows.length === 1 ? rows[0] : null);
    if (chosen) {
      if (chosen.active === false || chosen.status === "paused") return { skip: "The TikTok Pixel is switched off or paused." };
      if (!chosen.access_token) return { skip: "The TikTok Pixel has no Events API token." };
      const testing = chosen.status === "testing";
      // Testing without a test code would count as real sales in TikTok.
      if (testing && !chosen.test_event_code) return { skip: "The TikTok Pixel is in Testing but has no test event code." };
      return { pixelId: String(chosen.pixel_id), token: chosen.access_token, testEventCode: testing ? chosen.test_event_code : null, dataSourceId: chosen.id, testing };
    }
    if (rows.length > 1) return { skip: "Several TikTok Pixels and none is the default. Pick one in Tracking Hub → Settings." };
  }
  // Older links kept their own TikTok Pixel and token.
  if (legacy?.pixelId && legacy?.token) return { pixelId: legacy.pixelId, token: legacy.token, testEventCode: legacy.testEventCode ?? null, dataSourceId: null, testing: Boolean(legacy.testEventCode) };
  return { skip: "No TikTok Pixel in the Tracking Hub." };
}

export type TikTokSaleArgs = {
  orgId: string; branchId: string | null; orderId: string;
  ttclid: string | null; eventSourceUrl: string | null; clientIp: string | null; userAgent: string | null;
  phone: string | null; email: string | null; value: number; currency: string;
  productId: string | null; productName: string | null; packageId: string | null; packageName: string | null; quantity: number;
  legacy?: { pixelId?: string | null; token?: string | null; testEventCode?: string | null } | null;
};

/** Send one TikTok order's sale and record what happened. Never throws. */
export async function sendTikTokSale(args: TikTokSaleArgs): Promise<{ status: string; message?: string }> {
  try {
    if (!(await serverEventsAllowed(args.orgId, args.branchId))) return { status: "off" };
    if (args.branchId && !(await loadHubSettings(args.orgId, args.branchId)).multiPlatform) return { status: "off", message: "Allow Multiple Platforms is off." };
    const target = await tiktokTargetFor(args.orgId, args.branchId, args.legacy);
    if ("skip" in target) return { status: "skipped", message: target.skip };
    // Strict registry: one real sale per order, ever.
    const { data: already } = await supabase.from("tracking_tiktok_events").select("id").eq("org_id", args.orgId).eq("order_id", args.orderId)
      .eq("event_name", "CompletePayment").eq("status", "sent").eq("test_mode", false).limit(1).maybeSingle();
    if (already && !target.testing) return { status: "duplicate" };
    const result = await sendTikTokConversion({
      config: { pixelId: target.pixelId, accessToken: target.token, testEventCode: target.testEventCode },
      eventId: args.orderId, eventSourceUrl: args.eventSourceUrl, clientIp: args.clientIp, userAgent: args.userAgent,
      phone: args.phone, email: args.email, ttclid: args.ttclid, value: args.value, currency: args.currency, orderId: args.orderId,
      productId: args.productId, productName: args.productName, packageId: args.packageId, packageName: args.packageName, quantity: args.quantity
    });
    if (result.status === "duplicate") return result;
    const { error } = await supabase.from("tracking_tiktok_events").insert({
      org_id: args.orgId, branch_id: args.branchId, order_id: args.orderId, event_name: "CompletePayment", event_id: args.orderId,
      pixel_id: target.pixelId, data_source_id: target.dataSourceId, status: result.status, message: result.message ?? null,
      test_mode: target.testing, value: args.value, currency: args.currency
    });
    if (error) logger.warn("tracking-tiktok: could not record the send", { orderId: args.orderId, error: error.message });
    return result;
  } catch (error: any) {
    logger.warn("tracking-tiktok: send crashed", { orderId: args.orderId, error: error?.message ?? String(error) });
    return { status: "failed", message: error?.message };
  }
}
