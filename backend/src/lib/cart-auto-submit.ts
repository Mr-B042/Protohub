/**
 * Server-side cart auto-submit.
 *
 * Runs every 2 minutes. Finds abandoned carts where:
 *   – All 6 required fields are captured (name, phone, address, city, state + product/package)
 *   – last_activity was between 2 and 15 minutes ago (idle but recent)
 *   – Status is still Open abandoned / In progress (not yet converted)
 *   – No order already exists with source_cart_id = cart.id
 *
 * Creates the order, fires WhatsApp + upsell, marks cart Converted.
 * This catches customers who closed the tab before the client-side countdown fired.
 */

import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { sendOrderNewCustomerWhatsApp, sendOrderNewRepWhatsApp, sendOrderUpsellWhatsApp } from "./whatsapp.js";
import { resolveMetaTrackingConfig, sendMetaCapiPurchase } from "./meta-capi.js";
import { sendTikTokConversion } from "./tiktok-events.js";
import { assignOrderRep } from "./order-assignment.js";
import { notifyOutageRecoveredOrder } from "./order-notifications.js";

const MIN_IDLE_MS = 2 * 60 * 1000;   // must be idle at least 2 min
const MAX_IDLE_MS = 15 * 60 * 1000;  // give up after 15 min

export async function runCartAutoSubmit(): Promise<void> {
  const now = Date.now();
  const minCutoff = new Date(now - MAX_IDLE_MS).toISOString();
  const maxCutoff = new Date(now - MIN_IDLE_MS).toISOString();

  const { data: carts, error } = await supabase
    .from("abandoned_carts")
    .select("*")
    .in("status", ["Open abandoned", "In progress"])
    .not("customer", "eq", "Partial lead")
    .not("phone", "is", null)
    .not("city", "is", null)
    .not("state", "is", null)
    .not("product_id", "is", null)
    .not("package_id", "is", null)
    .gte("last_activity", minCutoff)
    .lte("last_activity", maxCutoff)
    .limit(50);

  if (error) { logger.error("cart-auto-submit: query failed", { error: error.message }); return; }

  // Outage captures are CONFIRMED customer submissions saved straight to Supabase when
  // the API was unreachable. They must be reconciled regardless of the 2–15 min idle
  // window — a Railway outage longer than 15 min would otherwise age them out and lose
  // the order entirely. Settle at least MIN_IDLE so a timed-out-but-actually-successful
  // original order has had time to land (processCart dedupes against it). No upper age
  // bound, so a long outage's backlog is always drained once the API is back.
  const { data: outageCarts } = await supabase
    .from("abandoned_carts")
    .select("*")
    .in("status", ["Open abandoned", "In progress"])
    .eq("outage_captured", true)
    .not("phone", "is", null)
    .not("city", "is", null)
    .not("state", "is", null)
    .not("product_id", "is", null)
    .not("package_id", "is", null)
    .lte("outage_captured_at", new Date(now - MIN_IDLE_MS).toISOString())
    .limit(50);

  const mergedCarts: any[] = [...((carts as any[]) ?? [])];
  const seenCartIds = new Set(mergedCarts.map((c: any) => c.id));
  for (const oc of (outageCarts as any[]) ?? []) {
    if (!seenCartIds.has(oc.id)) { mergedCarts.push(oc); seenCartIds.add(oc.id); }
  }
  if (!mergedCarts.length) return;

  // Group by org to check each org's auto_submit_mode
  const orgIds = [...new Set(mergedCarts.map((c: any) => c.org_id))];
  const { data: embedRows } = await supabase
    .from("embed_settings")
    .select("org_id, auto_submit_mode")
    .in("org_id", orgIds);
  const orgMode = Object.fromEntries((embedRows ?? []).map((r: any) => [r.org_id, r.auto_submit_mode ?? "full"]));

  logger.info("cart-auto-submit: checking carts", { count: mergedCarts.length });

  for (const cart of mergedCarts) {
    const isOutage = Boolean((cart as any).outage_captured);
    const mode = orgMode[(cart as any).org_id] ?? "full";
    // Outage captures are confirmed submissions — reconcile them even when the org has
    // speculative auto-submit turned off; that setting only governs INCOMPLETE carts.
    if (!isOutage && mode === "off") continue;
    try {
      await processCart(cart, isOutage ? "full" : mode);
    } catch (err) {
      logger.error("cart-auto-submit: cart failed", { cartId: cart.id, error: (err as Error).message });
    }
  }
}

async function processCart(cart: Record<string, any>, mode: "full"|"cart" = "full"): Promise<void> {
  const orgId: string = cart.org_id;
  const cartId: string = cart.id;

  // 1. Skip if an order already exists for this cart. An OUTAGE capture has id
  //    "<originalCartId>-outage-<ts>"; if the original submit actually reached the
  //    server (its response just timed out), the real order carries source_cart_id =
  //    <originalCartId>. Check BOTH so a recovered outage never duplicates that order.
  const originalCartId = cartId.replace(/-outage-[a-z0-9]+$/i, "");
  const dedupeCartIds = originalCartId !== cartId ? [cartId, originalCartId] : [cartId];
  const { data: existingOrders } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", orgId)
    .in("source_cart_id", dedupeCartIds)
    .limit(1);
  if (existingOrders && existingOrders.length > 0) return;

  // 2. Load product (NOTE: packages live in the product_packages table, NOT a column
  //    on products — selecting a non-existent `packages` column previously errored the
  //    whole query and silently aborted every auto-submit).
  const { data: product } = await supabase
    .from("products")
    .select("id, org_id, name, active")
    .eq("id", cart.product_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!product || product.active === false) return;

  // Load the chosen package from product_packages for quantity/price. The cart already
  // stores package_name, amount and currency, so we only need quantity (and price as fallback).
  const { data: pkgRow } = await supabase
    .from("product_packages")
    .select("id, quantity, price")
    .eq("id", cart.package_id)
    .maybeSingle();
  if (!pkgRow) return;
  const pkg = {
    id: pkgRow.id,
    name: cart.package_name ?? "",
    quantity: pkgRow.quantity ?? 1,
    price: Number(pkgRow.price ?? cart.amount ?? 0),
    currency: cart.currency ?? "NGN"
  };

  // 3. Assign — a product can restrict its orders to a weighted set of dedicated
  //    handlers (see migration 148); otherwise the global round-robin.
  const assignment = await assignOrderRep(orgId, product.id);
  const assignedRepId: string | null = assignment.assignedRepId;
  const assignedByLabel: string | null = assignment.assignedByLabel;

  // 4. Build order payload
  const capturePayload = (cart.capture_payload ?? {}) as Record<string, any>;
  const formContext = (capturePayload.formContext ?? {}) as Record<string, any>;

  const location = [cart.city, cart.state].filter(Boolean).join(", ") || null;
  const utmSource = capturePayload.utm_source ?? capturePayload.utmSource ?? cart.source ?? null;
  const source = utmSource === "tiktok" || utmSource === "TikTok" ? "TikTok"
    : utmSource === "facebook" || utmSource === "Facebook" ? "Facebook"
    : "Website";

  const amount = Number(cart.amount ?? pkg.price ?? 0);

  const orderPayload = {
    org_id:           orgId,
    source_cart_id:   cartId,
    customer:         cart.customer,
    phone:            cart.phone,
    whatsapp:         cart.whatsapp ?? null,
    address:          cart.address ?? null,
    city:             cart.city ?? null,
    state:            cart.state ?? null,
    product_id:       product.id,
    package_id:       pkg.id,
    product_name:     product.name,
    package_name:     pkg.name,
    quantity:         pkg.quantity ?? 1,
    amount,
    currency:         cart.currency ?? pkg.currency ?? "NGN",
    cross_sell_lines: [],
    source,
    location,
    assigned_rep_id:  assignedRepId,
    assigned_by_name_snapshot: assignedByLabel,
    utm_source:       capturePayload.utm_source ?? capturePayload.utmSource ?? null,
    utm_campaign:     capturePayload.utm_campaign ?? capturePayload.utmCampaign ?? null,
    utm_medium:       capturePayload.utm_medium ?? capturePayload.utmMedium ?? null,
    embed_label:      capturePayload.embedLabel ?? capturePayload.embed_label ?? null,
    referrer:         capturePayload.landingUrl ?? capturePayload.referrer ?? null,
    form_context:     { ...formContext, autoSubmitted: "true", autoSubmitSource: "server", outageRecovered: Boolean(cart.outage_captured) },
    // Confirmed submission that came in while the API was down and was reconciled
    // from a Supabase outage capture — flag it so the team can verify these.
    outage_recovered: Boolean(cart.outage_captured),
    status:           "New"
  };

  // "cart" mode: just mark the cart as ready-to-convert without creating an order
  if (mode === "cart") {
    await supabase.from("abandoned_carts")
      .update({ status: "In progress", last_activity: new Date().toISOString() })
      .eq("id", cartId);
    logger.info("cart-auto-submit: cart-mode — marked In progress", { cartId, customer: cart.customer });
    return;
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert(orderPayload)
    .select()
    .single();

  if (orderErr) {
    logger.error("cart-auto-submit: order insert failed", { cartId, error: orderErr.message });
    return;
  }

  logger.info("cart-auto-submit: order created", { cartId, orderId: order.id, customer: cart.customer });

  // 5. Mark cart Converted
  await supabase
    .from("abandoned_carts")
    .update({ status: "Converted", last_activity: new Date().toISOString() })
    .eq("id", cartId);

  // 6. Audit note
  await supabase.from("order_audit").insert({
    order_id: order.id,
    org_id:   orgId,
    changed_by: null,
    note: `Order auto-submitted by server after customer went idle with a complete form. Cart: ${cartId}`
  }).then(() => {});

  // 7. WhatsApp notifications (fire-and-forget)
  const orderForWa = {
    id: order.id,
    productId: product.id,
    customer: cart.customer,
    phone: cart.phone,
    whatsapp: cart.whatsapp ?? cart.phone,
    address: cart.address,
    city: cart.city,
    state: cart.state,
    productName: product.name,
    packageName: pkg.name,
    amount,
    currency: cart.currency ?? "NGN",
    quantity: pkg.quantity ?? 1,
    assignedRepId,
    crossSellLines: [],
    embedLabel: capturePayload.embedLabel ?? null,
    createdAt: new Date().toISOString()
  };

  // Confirmed submission recovered from an outage — alert Owners/Admins (+ rep) to
  // verify it, since it landed with no live confirmation at submit time.
  if (cart.outage_captured) {
    void notifyOutageRecoveredOrder(orgId, {
      id: order.id,
      customer: cart.customer,
      productName: product.name,
      packageName: pkg.name,
      phone: cart.phone,
      amount,
      currency: cart.currency ?? pkg.currency ?? "NGN",
      assignedRepId
    }).catch(() => {});
  }

  void sendOrderNewCustomerWhatsApp(orgId, orderForWa).catch(() => {});
  // Look up the assigned rep's phone for the rep-alert WhatsApp
  if (assignedRepId) {
    const { data: repUser } = await supabase.from("users").select("name, phone").eq("id", assignedRepId).maybeSingle();
    if (repUser?.phone) {
      void sendOrderNewRepWhatsApp(orgId, orderForWa, { name: repUser.name ?? "", phone: repUser.phone }).catch(() => {});
    }
  }

  // Upsell (delayed via setTimeout so the initial WhatsApp goes first)
  const upsellDelay = 5 * 60 * 1000;
  setTimeout(() => {
    void sendOrderUpsellWhatsApp(orgId, orderForWa).catch(() => {});
  }, upsellDelay);

  // 8. Meta CAPI (best-effort)
  // For server-side submits, the landing page pixel can't fire (no browser).
  // Fall back to __default__ org config so CAPI always fires if credentials are set.
  try {
    const metaTrackingKey = capturePayload.metaTrackingKey ?? capturePayload.meta_tracking_key ?? null;

    // Try the cart's tracking key first, then fall back to org default
    const { data: specificConfig } = metaTrackingKey
      ? await supabase.from("meta_capi_configs").select("*").eq("org_id", orgId).eq("tracking_key", metaTrackingKey).maybeSingle()
      : { data: null };

    const { data: defaultConfig } = !specificConfig
      ? await supabase.from("meta_capi_configs").select("*").eq("org_id", orgId).eq("tracking_key", "__default__").maybeSingle()
      : { data: null };

    const storedMetaConfig = specificConfig ?? defaultConfig ?? null;

    // Force hybrid mode for server-side submits so CAPI always fires when credentials exist
    const metaConfig = resolveMetaTrackingConfig({
      productId: product.id,
      trackingKey: storedMetaConfig?.tracking_key ?? metaTrackingKey,
      configOverride: storedMetaConfig,
      modeOverride: storedMetaConfig ? "hybrid" : (capturePayload.trackingMode ?? capturePayload.metaTrackingMode ?? null),
      pixelIdOverride: capturePayload.metaPixelId ?? capturePayload.pixelId ?? null,
    });

    void sendMetaCapiPurchase({
      config: metaConfig,
      eventId: `protohub_purchase_${order.id}`,
      eventSourceUrl: capturePayload.landingUrl ?? null,
      clientIp: null,
      userAgent: null,
      customer: cart.customer,
      phone: cart.phone,
      email: null,
      city: cart.city ?? null,
      state: cart.state ?? null,
      country: "ng",
      fbp: capturePayload.fbp ?? null,
      fbc: capturePayload.fbc ?? null,
      fbclid: capturePayload.fbclid ?? null,
      value: amount,
      currency: cart.currency ?? "NGN",
      orderId: String(order.id),
      productId: product.id,
      productName: product.name,
      packageId: pkg.id,
      packageName: pkg.name,
      quantity: pkg.quantity ?? 1
    }).catch(() => {});

    // TikTok Events API — fire for TikTok-sourced orders (customer left, no pixel).
    // Uses the same config row's TikTok credentials + the captured ttclid.
    const ttclid = capturePayload.ttclid ?? formContext.ttclid ?? null;
    const isTikTok = source === "TikTok"
      || String(capturePayload.utm_source ?? capturePayload.utmSource ?? "").toLowerCase() === "tiktok"
      || Boolean(ttclid);
    if (isTikTok && storedMetaConfig?.tiktok_pixel_id && storedMetaConfig?.tiktok_access_token) {
      void sendTikTokConversion({
        config: { pixelId: storedMetaConfig.tiktok_pixel_id, accessToken: storedMetaConfig.tiktok_access_token, testEventCode: storedMetaConfig.test_event_code ?? null },
        eventId: `protohub_purchase_${order.id}`,
        eventSourceUrl: capturePayload.landingUrl ?? null,
        clientIp: null,
        userAgent: null,
        phone: cart.phone,
        email: null,
        ttclid,
        value: amount,
        currency: cart.currency ?? "NGN",
        orderId: String(order.id),
        productId: product.id,
        productName: product.name,
        packageId: pkg.id,
        packageName: pkg.name,
        quantity: pkg.quantity ?? 1
      }).catch(() => {});
    }
  } catch { /* tracking failure never blocks */ }
}
