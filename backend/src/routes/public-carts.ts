import { Router } from "express";
import { humanFieldErrors } from "../lib/validation-message.js";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { notifyNewAbandonedCart } from "../lib/cart-notifications.js";
import { isDedupablePhone, uniqueMergedCartIds } from "../lib/cart-dedup.js";
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
    "submit_failed",
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

const CART_CAPTURE_SELECT = "id, org_id, status, created_at, touchpoints, capture_payload, dedup_merged_from, merged_into, source, package_name, amount";

async function resolveCanonicalCart(orgId: string, initialCart: any): Promise<any> {
  let current = initialCart;
  const visited = new Set<string>();

  for (let depth = 0; current && depth < 8; depth += 1) {
    const currentId = typeof current.id === "string" ? current.id.trim() : "";
    const nextId = typeof current.merged_into === "string" ? current.merged_into.trim() : "";
    if (!currentId || !nextId || visited.has(nextId)) return current;
    visited.add(currentId);

    const { data: nextCart } = await supabase
      .from("abandoned_carts")
      .select(CART_CAPTURE_SELECT)
      .eq("id", nextId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!nextCart) return current;
    current = nextCart;
  }

  return current;
}

// ── POST /api/public/carts ────────────────────────────────
// Captures a partially-filled embed-form draft.
// Org context derives from the product's org. No authentication.
router.post("/", captureRateLimit, async (req, res) => {
  const parsed = CaptureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
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
  const { data: requestedCart } = await supabase
    .from("abandoned_carts")
    .select(CART_CAPTURE_SELECT)
    .eq("id", d.id)
    .maybeSingle();

  if (requestedCart && requestedCart.org_id !== product.org_id) {
    res.status(409).json({ error: "Cart id collision." });
    return;
  }

  const existing = requestedCart
    ? await resolveCanonicalCart(product.org_id, requestedCart)
    : null;
  const captureId = existing?.id ?? d.id;
  const wasRekeyed = captureId !== d.id;

  let { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", product.org_id)
    .in("source_cart_id", Array.from(new Set([d.id, captureId])))
    .limit(1)
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
      .eq("product_id", d.productId)
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
        .eq("id", captureId)
        .eq("org_id", product.org_id);
    }
    res.status(200).json({
      id: captureId,
      ignored: true,
      converted: true,
      orderId: existingOrder.id,
      ...(wasRekeyed ? { merged: true, dedupSignal: "canonical", originalId: d.id } : {})
    });
    return;
  }

  if (existing) {
    // Don't overwrite a Converted cart — submission already happened.
    if (existing.status === "Converted") {
      res.status(200).json({
        id: captureId,
        ignored: true,
        converted: true,
        ...(wasRekeyed ? { merged: true, dedupSignal: "canonical", originalId: d.id } : {})
      });
      return;
    }
    const canonicalRow = { ...row, id: captureId };
    let updateQuery = supabase
      .from("abandoned_carts")
      .update(canonicalRow)
      .eq("id", captureId)
      .eq("org_id", product.org_id)
      .select()
      .single();
    let { data, error } = await updateQuery;
    if (error?.code === "42703" || /embed_label|email|address|preferred_delivery|capture_payload/i.test(error?.message ?? "")) {
      const legacyRow = { ...canonicalRow };
      delete (legacyRow as Record<string, unknown>).embed_label;
      delete (legacyRow as Record<string, unknown>).email;
      delete (legacyRow as Record<string, unknown>).address;
      delete (legacyRow as Record<string, unknown>).preferred_delivery;
      delete (legacyRow as Record<string, unknown>).capture_payload;
      updateQuery = supabase
        .from("abandoned_carts")
        .update(legacyRow)
        .eq("id", captureId)
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
        .neq("id", captureId)
        .not("status", "eq", "Converted")
        .is("merged_into", null)
        .lt("created_at", (data as any).created_at)  // only absorb OLDER carts → no ping-pong
        .or(`phone.eq.${d.phone.trim()},phone.eq.0${digits.slice(-10)},phone.eq.${digits},phone.eq.234${digits.slice(-10)}`)
        .gte("last_activity", window7d)
        .limit(10);
      if (dupes && dupes.length) {
        const ownTouch = touchpointFromPayload(captureId, (data as any).created_at ?? new Date().toISOString(), (data as any).capture_payload, { source: row.source, packageName: row.package_name, amount: row.amount });
        const absorbedTouches = dupes.map((c: any) =>
          touchpointFromPayload(c.id, c.created_at ?? new Date().toISOString(), c.capture_payload, { source: c.source, packageName: c.package_name, amount: c.amount })
        );
        const touchpoints = mergeTouchpoints(
          (data as any).touchpoints, [ownTouch], absorbedTouches,
          ...dupes.map((c: any) => c.touchpoints as CartTouchpoint[] | null)
        );
        const mergedFrom = uniqueMergedCartIds([
          ...((((data as any).dedup_merged_from as string[] | null) ?? [])),
          ...dupes.map((c: any) => c.id)
        ], captureId);
        await supabase.from("abandoned_carts")
          .update({ touchpoints, dedup_merged_from: mergedFrom, dedup_signal: "phone" })
          .eq("id", captureId).eq("org_id", product.org_id);
        await supabase.from("abandoned_carts")
          .update({ merged_into: captureId })
          .in("id", dupes.map((c: any) => c.id)).eq("org_id", product.org_id);
        (data as any).touchpoints = touchpoints;
      }
    }

    res.json(wasRekeyed
      ? { id: captureId, merged: true, dedupSignal: "canonical", originalId: d.id }
      : { id: captureId, merged: false });
    return;
  }

  // ── Multi-signal deduplication ─────────────────────────────
  // Checked in priority order. Merges are tracked so admin can always see
  // which session triggered the merge and undo if wrong.
  {
    const window7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    let matchId: string | null = null;
    let dedupSignal: string | null = null;

    // Signal 1 — Phone (strongest)
    // ⚠️ Guarded by isDedupablePhone. A truthy check alone let the literal
    // placeholder "No phone yet" through, and PostgREST happily matched it
    // against every other cart carrying the same sentence - so all phoneless
    // carts collapsed into one "person". The late-phone dedupe below always
    // had this guard; the insert-time path did not, which is where the damage
    // happened.
    if (isDedupablePhone(d.phone)) {
      const n = d.phone!.replace(/\D/g, "");
      const { data: m } = await supabase
        .from("abandoned_carts")
        .select("id")
        .eq("org_id", product.org_id)
        .eq("product_id", d.productId)
        .neq("id", d.id)
        .not("status", "eq", "Converted")
        .is("merged_into", null)
        .or(`phone.eq.${d.phone!.trim()},phone.eq.0${n.slice(-10)},phone.eq.${n},phone.eq.234${n.slice(-10)}`)
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

    // Signal 3 — IP: REMOVED, deliberately.
    //
    // An IP is not a person here. Nigerian mobile carriers put thousands of
    // subscribers behind one carrier-NAT address, and a subscriber's address
    // rotates as they reconnect - so it is unreliable in BOTH directions. Over
    // one 90-day sample of this org's own carts, 76 IPs were used by more than
    // one customer and 29 customers appeared on more than one IP. The cart that
    // exposed this had its own two touches on 102.88.108.52 and 102.89.41.194,
    // 42 minutes apart: IP failed to identify even a single session.
    //
    // It was never worth much either - across the whole database it was the
    // deciding signal on 4 merges, nearly all of which phone matching would
    // have caught anyway. A signal that rarely helps and occasionally fuses two
    // real customers into one record (destroying both their ad attribution and
    // their recovery status) is a bad trade at any frequency.
    //
    // clientIp is still CAPTURED on the touchpoint for investigation; it is
    // simply no longer allowed to decide that two carts are the same person.

    if (matchId && dedupSignal) {
      // Safety: fetch the existing cart's merged_from + ORIGINAL attribution before
      // the ...row update overwrites capture_payload, so we keep its own ad touch.
      const { data: existing } = await supabase
        .from("abandoned_carts")
        .select("dedup_merged_from, touchpoints, capture_payload, created_at, source, package_name, amount")
        .eq("id", matchId)
        .single();
      const mergedFrom = uniqueMergedCartIds([
        ...((existing?.dedup_merged_from as string[] | null) ?? []),
        d.id  // record the ghost cart ID that was absorbed
      ], matchId);
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
        res.json({ id: merged.id, merged: true, dedupSignal, originalId: d.id });
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
  res.status(201).json({ id: data.id, merged: false });
});

// ── POST /api/public/carts/:id/heartbeat ─────────────────
// Real-time "customer is typing / scrolling / idle" signal from the embed form.
// The browser sends this periodically while the customer is active. Suppress
// duplicate writes inside an eight-second window so stale/older clients cannot
// turn one open form into a constant Postgres + Realtime fan-out.
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
  const writeCutoff = new Date(Date.now() - 8_000).toISOString();
  const { error } = await supabase
    .from("abandoned_carts")
    .update({ live_status: liveStatus, last_activity: new Date().toISOString() })
    .eq("id", cartId)
    .or(`last_activity.is.null,last_activity.lt.${writeCutoff}`);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true });
});

// ── POST /api/public/carts/:id/left ──────────────────────
// Fired (via sendBeacon) when the customer leaves/closes the embed form. Stamps
// left_at so the WhatsApp cart-recovery cron can nudge them 3 min after leaving.
router.post("/:id/left", captureRateLimit, async (req, res) => {
  const cartId = String(req.params.id ?? "").trim();
  if (!/^[A-Za-z0-9\-_]+$/.test(cartId)) { res.status(400).json({ error: "Invalid cart id." }); return; }
  await supabase
    .from("abandoned_carts")
    .update({ left_at: new Date().toISOString() })
    .eq("id", cartId)
    .is("left_at", null); // first leave only
  res.json({ ok: true });
});

// ── POST /api/public/carts/:id/events ────────────────────
// Tracks the customer's journey through the public order form. Works even
// before the abandoned cart row has been fully captured, as long as the
// frontend uses the same cart id later for draft capture / submit.
const PRODUCT_ORG_CACHE_TTL_MS = 10 * 60 * 1000;
const publicProductOrgCache = new Map<string, { orgId: string; expiresAt: number }>();

async function publicProductOrgId(productId: string) {
  const cached = publicProductOrgCache.get(productId);
  if (cached && cached.expiresAt > Date.now()) return cached.orgId;
  if (cached) publicProductOrgCache.delete(productId);

  const { data: product } = await supabase
    .from("products")
    .select("id, org_id")
    .eq("id", productId)
    .eq("active", true)
    .maybeSingle();
  if (!product) return null;
  publicProductOrgCache.set(productId, {
    orgId: product.org_id,
    expiresAt: Date.now() + PRODUCT_ORG_CACHE_TTL_MS
  });
  return product.org_id as string;
}

router.post("/:id/events", captureRateLimit, async (req, res) => {
  const rawCartId = req.params.id;
  const cartId = typeof rawCartId === "string" ? rawCartId.trim() : "";
  if (!/^[A-Za-z0-9\-_]+$/.test(cartId)) {
    res.status(400).json({ error: "Invalid cart id." });
    return;
  }

  const parsed = JourneyEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  const event = parsed.data;

  const orgId = await publicProductOrgId(event.productId);
  if (!orgId) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  const { data, error } = await supabase
    .from("cart_journey_events")
    .insert({
      org_id: orgId,
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
  // One scoped update covers both cases: it refreshes a real cart and is a
  // harmless no-op for a pre-capture journey id. The org predicate means a
  // guessed/colliding id can never touch another organisation's cart.
  supabase.from("abandoned_carts")
    .update({ last_activity: new Date().toISOString() })
    .eq("id", cartId)
    .eq("org_id", orgId)
    .then(() => {});

  res.status(201).json({ id: data.id });
});

export default router;
