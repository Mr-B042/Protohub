import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { notifyNewAbandonedCart } from "../lib/cart-notifications.js";
import { supabase } from "../lib/supabase.js";

const router = Router();

// Per-IP rate limit. Public endpoint, abused-from-the-internet shape.
// 60 requests / minute is generous given the frontend already debounces
// to one POST per 1.5 s of typing (= max 40/min from a single tab).
const captureRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." }
});

const CaptureSchema = z.object({
  id:           z.string().min(1).max(80).regex(/^[A-Za-z0-9\-_]+$/, "Cart ID must be alphanumeric"),
  customer:     z.string().max(120).optional(),
  phone:        z.string().min(1).max(40),
  whatsapp:     z.string().max(40).optional(),
  email:        z.string().email().optional().or(z.literal("")),
  address:      z.string().max(500).optional(),
  city:         z.string().max(80).optional(),
  state:        z.string().max(80).optional(),
  productId:    z.string().uuid(),  // required — the source of truth for org_id
  packageId:    z.string().uuid().optional(),
  productName:  z.string().min(1).max(160),
  packageName:  z.string().min(1).max(160),
  amount:       z.number().min(0).max(1_000_000_000),
  currency:     z.enum(["NGN", "USD", "GBP"]),
  source:       z.string().max(60).optional(),
  embedLabel:   z.string().max(120).optional(),
  preferredDelivery: z.string().max(160).optional(),
  capturePayload: z.record(z.string(), z.unknown()).optional()
});

const JourneyEventSchema = z.object({
  productId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  state: z.string().max(80).optional(),
  eventType: z.enum([
    "form_opened",
    "first_interaction",
    "package_selected",
    "tier_switched",
    "state_selected",
    "additional_item_preview_opened",
    "additional_item_added",
    "additional_item_removed",
    "image_viewed",
    "field_hesitated",
    "submit_idle",
    "back_button_pressed",
    "submit_attempted",
    "submit_blocked_missing_name",
    "submit_blocked_missing_phone",
    "submit_blocked_invalid_phone",
    "submit_blocked_missing_whatsapp",
    "submit_blocked_invalid_whatsapp",
    "submit_blocked_missing_address",
    "submit_blocked_missing_city",
    "submit_blocked_missing_state",
    "submit_blocked_missing_delivery",
    "submit_blocked_missing_confirmation",
    "submit_blocked_missing_commitment",
    "order_submitted",
    "redirect_triggered",
    "form_exited"
  ]),
  companionProductId: z.string().uuid().optional(),
  companionPackageId: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional()
});

// ── Multi-ad touchpoints ──────────────────────────────────
// One cart = one ad session. When duplicate carts (same phone+product across
// separate ad clicks) are merged, each visit's ad snapshot is preserved here so
// the team can see a lead came back through a different ad/campaign/price.
type CartTouchpoint = {
  at: string; cartId: string; source: string | null;
  utmSource: string | null; utmCampaign: string | null; utmContent: string | null; utmTerm: string | null;
  utmId: string | null; fbclid: string | null; fbc: string | null; fbp: string | null; adId: string | null;
  clientIp: string | null; packageName: string | null; amount: number | null;
};
const tpStr = (v: unknown): string | null =>
  typeof v === "string" ? (v.trim() || null) : v == null ? null : String(v);
function touchpointFromPayload(
  cartId: string, at: string, payload: unknown,
  extra?: { source?: string | null; packageName?: string | null; amount?: number | null }
): CartTouchpoint {
  const cp = (payload && typeof payload === "object" && !Array.isArray(payload)) ? payload as Record<string, any> : {};
  const ctx = (cp.formContext && typeof cp.formContext === "object" && !Array.isArray(cp.formContext)) ? cp.formContext as Record<string, any> : {};
  return {
    at, cartId,
    source: tpStr(extra?.source),
    utmSource: tpStr(cp.utmSource), utmCampaign: tpStr(cp.utmCampaign), utmContent: tpStr(cp.utmContent), utmTerm: tpStr(cp.utmTerm),
    utmId: tpStr(ctx.utmId), fbclid: tpStr(ctx.fbclid), fbc: tpStr(ctx.fbc), fbp: tpStr(ctx.fbp), adId: tpStr(ctx.adId),
    clientIp: tpStr(cp.clientIp ?? ctx.clientIp),
    packageName: tpStr(extra?.packageName ?? cp.packageName),
    amount: typeof extra?.amount === "number" ? extra.amount : null
  };
}
// Combine touchpoint lists, unique by cartId, sorted oldest→newest.
function mergeTouchpoints(...lists: (CartTouchpoint[] | null | undefined)[]): CartTouchpoint[] {
  const byCart = new Map<string, CartTouchpoint>();
  for (const list of lists) {
    for (const tp of (Array.isArray(list) ? list : [])) {
      if (tp && typeof tp.cartId === "string" && !byCart.has(tp.cartId)) byCart.set(tp.cartId, tp);
    }
  }
  return Array.from(byCart.values()).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// ── POST /api/public/carts ────────────────────────────────
// Captures a partially-filled embed-form draft.
// Org context derives from the product's org. No authentication.
router.post("/", captureRateLimit, async (req, res) => {
  const parsed = CaptureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;

  // Derive org_id from the product. If the product doesn't exist, drop the
  // request — we won't accept orphan carts.
  const { data: product } = await supabase
    .from("products")
    .select("id, org_id")
    .eq("id", d.productId)
    .maybeSingle();

  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  const row = {
    id:           d.id,
    org_id:       product.org_id,
    customer:     d.customer ?? "Partial lead",
    phone:        d.phone,
    whatsapp:     d.whatsapp ?? null,
    email:        d.email?.trim() || null,
    address:      d.address?.trim() || null,
    city:         d.city ?? null,
    state:        d.state ?? null,
    product_id:   d.productId,
    package_id:   d.packageId ?? null,
    product_name: d.productName,
    package_name: d.packageName,
    amount:       d.amount,
    currency:     d.currency,
    source:       d.source ?? "Website",
    embed_label:  (d.embedLabel ?? "").trim().slice(0, 120) || null,
    preferred_delivery: d.preferredDelivery?.trim() || null,
    capture_payload: {
      ...(d.capturePayload && typeof d.capturePayload === "object" && !Array.isArray(d.capturePayload)
        ? d.capturePayload : {}),
      // Store client IP for IP-based dedup signal
      clientIp: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || (req as any).ip || null
    },
    last_activity: new Date().toISOString()
  };

  // If the row exists, only allow updates if it belongs to the same org
  // (i.e., the same product chain). Prevents cross-org id collisions.
  const { data: existing } = await supabase
    .from("abandoned_carts")
    .select("id, org_id, status, created_at, touchpoints, capture_payload")
    .eq("id", d.id)
    .maybeSingle();

  let { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", product.org_id)
    .eq("source_cart_id", d.id)
    .maybeSingle();

  // Post-submit race: the embed form's debounced capture can fire AFTER the order
  // was placed, under a fresh cart id. If a recent order already exists for this
  // phone, treat this capture as converted instead of birthing a phantom open cart.
  if (!existingOrder && d.phone) {
    const n = d.phone.replace(/\D/g, "");
    const recentWindow = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data: phoneOrder } = await supabase
      .from("orders")
      .select("id")
      .eq("org_id", product.org_id)
      .or(`phone.eq.${d.phone.trim()},phone.eq.0${n.slice(-10)},phone.eq.${n},phone.eq.234${n.slice(-10)}`)
      .gte("created_at", recentWindow)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (phoneOrder) existingOrder = phoneOrder;
  }

  if (existingOrder) {
    if (existing && existing.org_id === product.org_id && (existing.status !== "Converted" || row.embed_label)) {
      const convertedUpdate: Record<string, unknown> = {
        status: "Converted",
        last_activity: new Date().toISOString()
      };
      if (row.embed_label) convertedUpdate.embed_label = row.embed_label;
      await supabase
        .from("abandoned_carts")
        .update(convertedUpdate)
        .eq("id", d.id)
        .eq("org_id", product.org_id);
    }
    res.status(200).json({ id: d.id, ignored: true, converted: true, orderId: existingOrder.id });
    return;
  }

  if (existing) {
    if (existing.org_id !== product.org_id) {
      res.status(409).json({ error: "Cart id collision." });
      return;
    }
    // Don't overwrite a Converted cart — submission already happened.
    if (existing.status === "Converted") {
      res.status(200).json({ id: d.id, ignored: true });
      return;
    }
    let updateQuery = supabase
      .from("abandoned_carts")
      .update(row)
      .eq("id", d.id)
      .eq("org_id", product.org_id)
      .select()
      .single();
    let { data, error } = await updateQuery;
    if (error?.code === "42703" || /embed_label|email|address|preferred_delivery|capture_payload/i.test(error?.message ?? "")) {
      const legacyRow = { ...row };
      delete (legacyRow as Record<string, unknown>).embed_label;
      delete (legacyRow as Record<string, unknown>).email;
      delete (legacyRow as Record<string, unknown>).address;
      delete (legacyRow as Record<string, unknown>).preferred_delivery;
      delete (legacyRow as Record<string, unknown>).capture_payload;
      updateQuery = supabase
        .from("abandoned_carts")
        .update(legacyRow)
        .eq("id", d.id)
        .eq("org_id", product.org_id)
        .select()
        .single();
      ({ data, error } = await updateQuery);
    }
    if (error) { res.status(500).json({ error: error.message }); return; }

    // ── Late-phone dedupe (the gap that birthed duplicate carts) ──────────
    // The cart is usually first created with "No phone yet" / a half-typed number,
    // so the insert-time dedupe finds nothing. Once the FULL phone lands here (via
    // update), collapse any OLDER open cart for the same phone+product into THIS
    // one — keeping the active session's cart, preserving every ad touch.
    const digits = (d.phone ?? "").replace(/\D/g, "");
    if (data && digits.length >= 10) {
      const window7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: dupes } = await supabase
        .from("abandoned_carts")
        .select("id, created_at, capture_payload, touchpoints, source, package_name, amount")
        .eq("org_id", product.org_id)
        .eq("product_id", d.productId)
        .neq("id", d.id)
        .not("status", "eq", "Converted")
        .is("merged_into", null)
        .lt("created_at", (data as any).created_at)  // only absorb OLDER carts → no ping-pong
        .or(`phone.eq.${d.phone.trim()},phone.eq.0${digits.slice(-10)},phone.eq.${digits},phone.eq.234${digits.slice(-10)}`)
        .gte("last_activity", window7d)
        .limit(10);
      if (dupes && dupes.length) {
        const ownTouch = touchpointFromPayload(d.id, (data as any).created_at ?? new Date().toISOString(), (data as any).capture_payload, { source: row.source, packageName: row.package_name, amount: row.amount });
        const absorbedTouches = dupes.map((c: any) =>
          touchpointFromPayload(c.id, c.created_at ?? new Date().toISOString(), c.capture_payload, { source: c.source, packageName: c.package_name, amount: c.amount })
        );
        const touchpoints = mergeTouchpoints(
          (data as any).touchpoints, [ownTouch], absorbedTouches,
          ...dupes.map((c: any) => c.touchpoints as CartTouchpoint[] | null)
        );
        const mergedFrom = [
          ...((((data as any).dedup_merged_from as string[] | null) ?? [])),
          ...dupes.map((c: any) => c.id)
        ];
        await supabase.from("abandoned_carts")
          .update({ touchpoints, dedup_merged_from: mergedFrom, dedup_signal: "phone" })
          .eq("id", d.id).eq("org_id", product.org_id);
        await supabase.from("abandoned_carts")
          .update({ merged_into: d.id })
          .in("id", dupes.map((c: any) => c.id)).eq("org_id", product.org_id);
        (data as any).touchpoints = touchpoints;
      }
    }

    res.json(data);
    return;
  }

  // ── Multi-signal deduplication ─────────────────────────────
  // Checked in priority order. Merges are tracked so admin can always see
  // which session triggered the merge and undo if wrong.
  {
    const window7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const clientIp = (req.headers["x-forwarded-for"] as string | undefined)
      ?.split(",")[0]?.trim() || (req as any).ip;

    let matchId: string | null = null;
    let dedupSignal: string | null = null;

    // Signal 1 — Phone (strongest)
    if (d.phone?.trim()) {
      const n = d.phone.replace(/\D/g, "");
      const { data: m } = await supabase
        .from("abandoned_carts")
        .select("id")
        .eq("org_id", product.org_id)
        .eq("product_id", d.productId)
        .neq("id", d.id)
        .not("status", "eq", "Converted")
        .is("merged_into", null)
        .or(`phone.eq.${d.phone.trim()},phone.eq.0${n.slice(-10)},phone.eq.${n},phone.eq.234${n.slice(-10)}`)
        .gte("last_activity", window7d)
        .order("last_activity", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (m) { matchId = m.id; dedupSignal = "phone"; }
    }

    // Signal 2 — Email
    if (!matchId && d.email?.trim()) {
      const { data: m } = await supabase
        .from("abandoned_carts")
        .select("id")
        .eq("org_id", product.org_id)
        .eq("product_id", d.productId)
        .neq("id", d.id)
        .not("status", "eq", "Converted")
        .is("merged_into", null)
        .eq("email", d.email.trim())
        .gte("last_activity", window7d)
        .order("last_activity", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (m) { matchId = m.id; dedupSignal = "email"; }
    }

    // Signal 3 — IP (conservative 2h window, skip shared/private IPs)
    if (!matchId && clientIp && !["::1", "127.0.0.1", "::ffff:127.0.0.1"].includes(clientIp)) {
      const ipWindow = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const { data: ipMatches } = await supabase
        .from("abandoned_carts")
        .select("id, capture_payload")
        .eq("org_id", product.org_id)
        .eq("product_id", d.productId)
        .neq("id", d.id)
        .not("status", "eq", "Converted")
        .is("merged_into", null)
        .gte("last_activity", ipWindow)
        .order("last_activity", { ascending: false })
        .limit(5);
      const ipMatch = (ipMatches ?? []).find(c =>
        (c.capture_payload as Record<string, unknown> | null)?.clientIp === clientIp
      );
      if (ipMatch) { matchId = ipMatch.id; dedupSignal = "ip"; }
    }

    if (matchId && dedupSignal) {
      // Safety: fetch the existing cart's merged_from + ORIGINAL attribution before
      // the ...row update overwrites capture_payload, so we keep its own ad touch.
      const { data: existing } = await supabase
        .from("abandoned_carts")
        .select("dedup_merged_from, touchpoints, capture_payload, created_at, source, package_name, amount")
        .eq("id", matchId)
        .single();
      const mergedFrom: string[] = [
        ...((existing?.dedup_merged_from as string[] | null) ?? []),
        d.id  // record the ghost cart ID that was absorbed
      ];
      const survivorTouch = touchpointFromPayload(matchId, (existing as any)?.created_at ?? new Date().toISOString(), (existing as any)?.capture_payload, { source: (existing as any)?.source, packageName: (existing as any)?.package_name, amount: (existing as any)?.amount });
      const ghostTouch = touchpointFromPayload(d.id, new Date().toISOString(), row.capture_payload, { source: row.source, packageName: row.package_name, amount: row.amount });
      const touchpoints = mergeTouchpoints((existing as any)?.touchpoints, [survivorTouch, ghostTouch]);

      const { data: merged } = await supabase
        .from("abandoned_carts")
        .update({
          ...row,
          id: matchId,
          dedup_merged_from: mergedFrom,
          dedup_signal: dedupSignal,
          touchpoints
        })
        .eq("id", matchId)
        .eq("org_id", product.org_id)
        .select()
        .single();
      if (merged) {
        res.json({ ...merged, merged: true, dedupSignal, originalId: d.id });
        return;
      }
    }
  }

  let insertQuery = supabase
    .from("abandoned_carts")
    .insert({ ...row, status: "Open abandoned" })
    .select()
    .single();
  let { data, error } = await insertQuery;
  if (error?.code === "42703" || /embed_label|email|address|preferred_delivery|capture_payload/i.test(error?.message ?? "")) {
    const legacyRow = { ...row };
    delete (legacyRow as Record<string, unknown>).embed_label;
    delete (legacyRow as Record<string, unknown>).email;
    delete (legacyRow as Record<string, unknown>).address;
    delete (legacyRow as Record<string, unknown>).preferred_delivery;
    delete (legacyRow as Record<string, unknown>).capture_payload;
    insertQuery = supabase
      .from("abandoned_carts")
      .insert({ ...legacyRow, status: "Open abandoned" })
      .select()
      .single();
    ({ data, error } = await insertQuery);
  }
  if (error) { res.status(500).json({ error: error.message }); return; }
  void notifyNewAbandonedCart(product.org_id, {
    id: data.id,
    customer: data.customer ?? "Partial lead",
    phone: data.phone,
    product_name: data.product_name ?? "your requested item",
    package_name: data.package_name ?? null,
    amount: Number(data.amount ?? 0),
    currency: data.currency ?? "NGN",
    source: data.source ?? "Website"
  });
  res.status(201).json(data);
});

// ── POST /api/public/carts/:id/heartbeat ─────────────────
// Real-time "customer is typing / scrolling / idle" signal from the embed form.
// Fires every 3s while the customer is active. Writes to live_status (jsonb).
// Rate-limited via the same captureRateLimit (60 req/min per IP).
router.post("/:id/heartbeat", captureRateLimit, async (req, res) => {
  const cartId = String(req.params.id ?? "").trim();
  if (!/^[A-Za-z0-9\-_]+$/.test(cartId)) { res.status(400).json({ error: "Invalid cart id." }); return; }

  const action = String(req.body?.action ?? "active").slice(0, 40);
  const field  = req.body?.field ? String(req.body.field).slice(0, 40) : null;
  const section = req.body?.section ? String(req.body.section).slice(0, 40) : null;

  const liveStatus = {
    action,
    ...(field   ? { field }   : {}),
    ...(section ? { section } : {}),
    ts: new Date().toISOString()
  };

  // Only update if the cart exists — don't create phantom rows
  const { error } = await supabase
    .from("abandoned_carts")
    .update({ live_status: liveStatus, last_activity: new Date().toISOString() })
    .eq("id", cartId);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── POST /api/public/carts/:id/events ────────────────────
// Tracks the customer's journey through the public order form. Works even
// before the abandoned cart row has been fully captured, as long as the
// frontend uses the same cart id later for draft capture / submit.
router.post("/:id/events", captureRateLimit, async (req, res) => {
  const rawCartId = req.params.id;
  const cartId = typeof rawCartId === "string" ? rawCartId.trim() : "";
  if (!/^[A-Za-z0-9\-_]+$/.test(cartId)) {
    res.status(400).json({ error: "Invalid cart id." });
    return;
  }

  const parsed = JourneyEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const event = parsed.data;

  const { data: product } = await supabase
    .from("products")
    .select("id, org_id")
    .eq("id", event.productId)
    .maybeSingle();

  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  const { data: existingCart } = await supabase
    .from("abandoned_carts")
    .select("id, org_id")
    .eq("id", cartId)
    .maybeSingle();

  if (existingCart && existingCart.org_id !== product.org_id) {
    res.status(409).json({ error: "Cart id collision." });
    return;
  }

  const { data, error } = await supabase
    .from("cart_journey_events")
    .insert({
      org_id: product.org_id,
      cart_id: cartId,
      product_id: event.productId,
      package_id: event.packageId ?? null,
      state: event.state ?? null,
      event_type: event.eventType,
      companion_product_id: event.companionProductId ?? null,
      companion_package_id: event.companionPackageId ?? null,
      metadata: event.metadata ?? {}
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  // Keep last_activity fresh so the server-side auto-submit cron uses
  // the real last moment the customer was active, not just the last cart capture.
  if (existingCart) {
    supabase.from("abandoned_carts")
      .update({ last_activity: new Date().toISOString() })
      .eq("id", cartId)
      .eq("org_id", product.org_id)
      .then(() => {});
  }

  res.status(201).json(data);
});

export default router;
