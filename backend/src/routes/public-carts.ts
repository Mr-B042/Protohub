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
    .select("id, org_id, status")
    .eq("id", d.id)
    .maybeSingle();

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", product.org_id)
    .eq("source_cart_id", d.id)
    .maybeSingle();

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
        .gte("last_activity", ipWindow)
        .order("last_activity", { ascending: false })
        .limit(5);
      const ipMatch = (ipMatches ?? []).find(c =>
        (c.capture_payload as Record<string, unknown> | null)?.clientIp === clientIp
      );
      if (ipMatch) { matchId = ipMatch.id; dedupSignal = "ip"; }
    }

    if (matchId && dedupSignal) {
      // Safety: fetch the existing cart's current merged_from list before updating
      const { data: existing } = await supabase
        .from("abandoned_carts")
        .select("dedup_merged_from")
        .eq("id", matchId)
        .single();
      const mergedFrom: string[] = [
        ...((existing?.dedup_merged_from as string[] | null) ?? []),
        d.id  // record the ghost cart ID that was absorbed
      ];

      const { data: merged } = await supabase
        .from("abandoned_carts")
        .update({
          ...row,
          id: matchId,
          dedup_merged_from: mergedFrom,
          dedup_signal: dedupSignal
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

  res.status(201).json(data);
});

export default router;
