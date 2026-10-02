import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { domainOf } from "../lib/tracking-hub.js";

// The WordPress embed reports each browser Pixel event it fires (Tracking Hub,
// 2 Oct 2026), so the hub can count browser events and see whether a page has
// the Pixel missing or loaded twice. Public, so it only accepts an event for a
// real order whose event id is that order's own id (or its recorded id).
const router = Router();
const beaconLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

const BeaconSchema = z.object({
  orderId: z.string().trim().min(1).max(60),
  eventId: z.string().trim().min(1).max(160),
  eventName: z.enum(["Purchase"]).default("Purchase"),
  pixelId: z.string().trim().max(40).nullable().optional(),
  pageUrl: z.string().trim().max(2048).nullable().optional(),
  pixelsOnPage: z.array(z.string().trim().max(40)).max(10).optional()
});

router.post("/browser-event", beaconLimit, async (req, res) => {
  // sendBeacon posts text/plain; accept both.
  let body: unknown = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const parsed = BeaconSchema.safeParse(body);
  if (!parsed.success) { res.status(400).json({ error: "Bad event." }); return; }
  const event = parsed.data;
  try {
    const { data: order } = await supabase.from("orders").select("id, org_id, branch_id").eq("id", event.orderId).maybeSingle();
    if (!order) { res.status(404).json({ error: "Unknown order." }); return; }
    if (event.eventId !== String(order.id)) {
      const { data: registered } = await supabase.from("meta_capi_events").select("event_id")
        .eq("org_id", order.org_id).eq("order_id", String(order.id)).eq("event_name", "Purchase").maybeSingle();
      if (registered?.event_id !== event.eventId) { res.status(400).json({ error: "Event id does not belong to this order." }); return; }
    }
    if (!order.branch_id) { res.json({ ok: true }); return; }
    await supabase.from("tracking_browser_events").upsert({
      org_id: order.org_id, branch_id: order.branch_id, order_id: String(order.id), event_name: event.eventName, event_id: event.eventId,
      pixel_id: event.pixelId ?? null, page_url: event.pageUrl ?? null, page_domain: domainOf(event.pageUrl),
      pixels_on_page: Array.from(new Set(event.pixelsOnPage ?? []))
    }, { onConflict: "org_id,order_id,event_name", ignoreDuplicates: true });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Could not record." });
  }
});

export default router;
