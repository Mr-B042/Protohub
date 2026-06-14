// Public order-create endpoint for the embed form.
//
// Why a separate route?
//   - /api/orders is gated by requireAuth (admin/sales rep flows).
//   - The embed form is hit by unauthenticated customers.
//
// Trust model: the client sends form data + packageId + cross-sell line ids,
// but the server NEVER trusts the client's `amount`. We recompute it from
// canonical pricing tables (product_packages.price + cross-sell rules).
//
// Org context derives from the package's product (same pattern as public-carts).

import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { notifyOrderEvent } from "../lib/order-notifications.js";
import { buildPackageComponentSnapshot } from "../lib/order-inventory.js";
import { packageAllowsState, packageHasAgentStateStock } from "../lib/package-availability.js";
import { resolveMetaTrackingConfig, sendMetaCapiPurchase } from "../lib/meta-capi.js";
import { readSettings } from "./embed-settings.js";
import {
  sendNewOrderEmail,
  sendInternalNewOrderEmail,
  sendOrderAssignedEmail
} from "../lib/mailer.js";
import { sendNewOrderSms } from "../lib/sms.js";

const router = Router();

// Per-IP rate limit. The embed form is internet-facing.
const submitRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again shortly." }
});

const CrossSellLineSchema = z.object({
  companionId: z.string().min(1).max(120).optional(),
  productId: z.string().uuid(),
  packageId: z.string().uuid().optional(),
  quantity:  z.number().int().min(1).max(50)
});
const PublicFormContextSchema = z.record(
  z.string(),
  z.union([z.string().max(2048), z.number(), z.boolean(), z.null()])
);

const PublicOrderSchema = z.object({
  id:           z.string().min(1).max(50).regex(/^[A-Za-z0-9\-_]+$/).optional(),
  cartId:       z.string().min(1).max(80).regex(/^[A-Za-z0-9\-_]+$/).optional(),
  customer:     z.string().min(1).max(120),
  phone:        z.string().min(1).max(40),
  whatsapp:     z.string().regex(/^\d{7,15}$/).optional(),
  email:        z.string().email().max(254).optional().or(z.literal("")),
  address:      z.string().max(500).optional(),
  city:         z.string().max(80).optional(),
  state:        z.string().max(80).optional(),
  packageId:    z.string().uuid(),
  packageSet:   z.string().trim().max(80).optional(),
  crossSellLines:  z.array(CrossSellLineSchema).max(20).optional(),
  utmSource:    z.string().max(80).optional(),
  utmCampaign:  z.string().max(120).optional(),
  utmMedium:    z.string().max(80).optional(),
  utmContent:   z.string().max(160).optional(),
  utmTerm:      z.string().max(160).optional(),
  embedLabel:   z.string().max(120).optional(),
  referrer:     z.string().max(2048).optional(),
  confirmationChecked: z.boolean().optional(),
  preferredDelivery:   z.string().max(80).optional(),
  formContext:  PublicFormContextSchema.optional(),
  // Honeypot — must be empty. Bots tend to fill every field they see.
  company:      z.string().max(0).optional()
});

const contextString = (context: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const value = context?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const clientIpFromRequest = (req: Request) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (Array.isArray(forwarded)) return forwarded[0]?.split(",")[0]?.trim() || req.ip;
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0]?.trim();
  return req.ip;
};

type CompanionOverride = {
  companionId?: string;
  productId: string;
  packageId?: string;
  active?: boolean;
  quantity: number;
  pricingMode: "standard" | "fixed" | "free" | "use_product_price";
  fixedPrice?: number;
  stateFilterMode?: "all" | "allow" | "block";
  stateRestrictions?: string[];
  autoInclude?: boolean;
  placement?: "inline" | "upsell";
  pitch?: string;
  badgeText?: string;
  headline?: string;
  ctaText?: string;
  declineText?: string;
  embedHtml?: string;
  priority?: number;
  displayMode?: "compact" | "card" | "showcase";
};

const companionIsActive = (companion: Pick<CompanionOverride, "active"> | null | undefined) => companion?.active !== false;

type ResolvedLine = {
  productId: string;
  productName: string;
  quantity: number;
  amount: number;
  packageId?: string;
  packageName?: string;
  packageQuantity?: number;
  packageComponentsSnapshot?: Awaited<ReturnType<typeof buildPackageComponentSnapshot>>;
  selectionSource?: "public_form" | "public_upsell" | "manual_rep" | "auto_include";
  addedById?: string;
  addedByName?: string;
  addedByRole?: string;
  addedAt?: string;
};

const PublicUpsellAcceptSchema = z.object({
  token: z.string().min(24)
});

const ALLOWED_SOURCES = ["TikTok", "Facebook", "Instagram", "Messenger", "Audience Network", "Threads", "WhatsApp", "Website", "Direct"] as const;
const PUBLIC_UPSELL_TTL_MS = 4 * 60 * 60 * 1000;

const normalizeStateName = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "fct" || normalized === "abuja" || normalized === "fct abuja" || normalized.includes("federal capital")) return "FCT Abuja";
  return (value ?? "").trim();
};

const cleanEmbedLabel = (value: string | undefined) => {
  const normalized = (value ?? "").trim().slice(0, 120);
  return normalized || null;
};

// Map a UTM source to an order source. Meta ads run across placements — the
// utm_source carries Facebook's {{site_source_name}} macro: fb=Facebook,
// ig=Instagram, an=Audience Network, th=Threads, ms=Messenger. Recognise each
// (exact short code first, then full names) so paid-ad orders aren't all
// collapsed into "Website". Mirrors the frontend orderSourceFromUtm.
function sourceFromUtm(utm: string | undefined): typeof ALLOWED_SOURCES[number] {
  const s = (utm ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (s === "tt" || s.includes("tiktok")) return "TikTok";
  if (s === "ig" || s.includes("instagram") || s.includes("insta")) return "Instagram";
  if (s === "an" || s.includes("audience network")) return "Audience Network";
  if (s === "ms" || s.includes("messenger")) return "Messenger";
  if (s === "th" || s.includes("threads")) return "Threads";
  if (s === "wa" || s.includes("whatsapp")) return "WhatsApp";
  if (s === "fb" || s.includes("facebook") || s.includes("meta")) return "Facebook";
  if (s.includes("web") || s.includes("organic") || s.includes("embed")) return "Website";
  if (!s || s === "direct" || s === "none") return "Direct";
  return "Website";
}

const stateAllowsCompanion = (companion: CompanionOverride, state: string | undefined) =>
  (() => {
    const mode = companion.stateFilterMode ?? "all";
    const restrictions = companion.stateRestrictions ?? [];
    if (mode === "all") return true;
    if (!restrictions.length) return mode === "block";
    if (!state) return false;
    const normalizedState = normalizeStateName(state);
    const restrictedStates = restrictions.map(normalizeStateName);
    return mode === "block"
      ? !restrictedStates.includes(normalizedState)
      : restrictedStates.includes(normalizedState);
  })();

const companionUnitPrice = (
  companion: CompanionOverride,
  standardPrice: number
) => {
  if (companion.pricingMode === "free") return 0;
  if (companion.pricingMode === "fixed") return Number(companion.fixedPrice ?? 0);
  return standardPrice;
};

const companionLineAmount = (
  companion: CompanionOverride,
  standardPrice: number,
  quantity: number
) => {
  const unitPrice = companionUnitPrice(companion, standardPrice);
  return companion.pricingMode === "fixed"
    ? unitPrice
    : unitPrice * Math.max(1, Number(quantity) || 1);
};

const packageOfferKey = (productId: string, packageId?: string | null) =>
  `${productId}:${packageId ?? ""}`;

const buildResolvedPackageSnapshot = async (
  orgId: string,
  targetPackage: ResolvedPackageRow,
  productId: string,
  productName: string,
  bundleCount: number
) => {
  const normalizedBundleCount = Math.max(1, bundleCount);
  const snapshot = await buildPackageComponentSnapshot(orgId, targetPackage.package_components ?? []);
  if (snapshot.length > 0) {
    return snapshot.map((line) => ({
      ...line,
      quantity: line.quantity * normalizedBundleCount,
      sourceType: "cross_sell" as const
    }));
  }
  return [{
    productId,
    productName,
    // A component-less cross-sell add-on is ordered + priced PER PIECE
    // (bundleCount = the pieces the customer chose, line.amount = unitPrice ×
    // bundleCount). Deduct exactly that many pieces of the add-on product.
    // Previously this multiplied by units_per_pack (targetPackage.quantity),
    // inflating e.g. 3 → 12 for a "Starter Pack" (units_per_pack 4) and
    // over-deducting inventory + showing "12pcs" in the Copy Summary.
    quantity: normalizedBundleCount,
    isFreeGift: false,
    sourceType: "cross_sell" as const
  }];
};

type PublicUpsellTokenPayload = {
  orderId: string;
  orgId: string;
  packageId: string;
  companionId?: string;
  productId: string;
  companionPackageId?: string;
  quantity: number;
  amount: number;
  issuedAt: number;
};

type ResolvedPackageRow = {
  id: string;
  product_id: string;
  name: string;
  price: number;
  quantity: number;
  package_components: unknown;
  active: boolean;
};

const publicUpsellSecret = () =>
  process.env.PUBLIC_ORDER_UPSELL_SECRET
  || process.env.JWT_SECRET
  || process.env.SUPABASE_JWT_SECRET
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || "protohub-public-upsell-dev";

const encodeTokenPart = (value: string) => Buffer.from(value).toString("base64url");
const decodeTokenPart = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const signPublicUpsellToken = (payload: PublicUpsellTokenPayload) => {
  const encodedPayload = encodeTokenPart(JSON.stringify(payload));
  const signature = createHmac("sha256", publicUpsellSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
};

const verifyPublicUpsellToken = (token: string): PublicUpsellTokenPayload | null => {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = createHmac("sha256", publicUpsellSecret()).update(encodedPayload).digest("base64url");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null;
  try {
    const payload = JSON.parse(decodeTokenPart(encodedPayload)) as PublicUpsellTokenPayload;
    if (!payload?.orderId || !payload?.orgId || !payload?.packageId || !payload?.productId) return null;
    if (!Number.isFinite(Number(payload.quantity)) || Number(payload.quantity) < 1) return null;
    if (!Number.isFinite(Number(payload.amount)) || Number(payload.amount) < 0) return null;
    if (Date.now() - payload.issuedAt > PUBLIC_UPSELL_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
};

const formatNotificationMoney = (amount: number, currency: string | null | undefined) => {
  const safeCurrency = currency?.trim() || "NGN";
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);
  } catch {
    return `${safeCurrency} ${Math.round(amount || 0).toLocaleString("en-NG")}`;
  }
};

const notifyAfterSubmitUpsellAccepted = async (
  orgId: string,
  order: {
    id: string;
    customer?: string | null;
    assigned_rep_id?: string | null;
  },
  line: { productName: string; amount: number },
  nextAmount: number,
  currency: string | null | undefined
) => {
  try {
    const recipients = new Set<string>();
    const { data: staff } = await supabase
      .from("users")
      .select("id")
      .eq("org_id", orgId)
      .eq("active", true)
      .in("role", ["Owner", "Admin"]);
    for (const user of staff ?? []) {
      if (user.id) recipients.add(user.id);
    }
    if (order.assigned_rep_id) recipients.add(order.assigned_rep_id);
    if (recipients.size === 0) return;

    const lineAmount = formatNotificationMoney(line.amount, currency);
    const total = formatNotificationMoney(nextAmount, currency);
    const rows = [...recipients].map((recipientId) => ({
      org_id: orgId,
      recipient_id: recipientId,
      type: "info",
      title: `After-submit add-on accepted #${order.id}`,
      message: `${order.customer || "Customer"} added ${line.productName} (${lineAmount}). New order total: ${total}.`,
      link: `/dashboard/admin/orders/${order.id}`,
      order_id: order.id,
      read: false
    }));

    const { error } = await supabase.from("system_notifications").insert(rows);
    if (error) {
      logger.warn("public-orders: after-submit upsell notification failed", { orderId: order.id, error: error.message });
    }
  } catch (error) {
    logger.warn("public-orders: after-submit upsell notification crashed", {
      orderId: order.id,
      error: (error as Error).message
    });
  }
};

const isMissingPublicOrderOptionalColumnsError = (error: { code?: string; message?: string } | null | undefined) =>
  error?.code === "42703" || /confirmation_checked|preferred_delivery|referrer|embed_label|form_context|assigned_by_user_id|assigned_by_name_snapshot|review_hold|review_reason/i.test(error?.message ?? "");

const PUBLIC_ORDER_OPTIONAL_INSERT_COLUMNS = [
  "confirmation_checked",
  "preferred_delivery",
  "referrer",
  "embed_label",
  "form_context",
  "assigned_by_user_id",
  "assigned_by_name_snapshot",
  "review_hold",
  "review_reason"
] as const;

const missingPublicOrderOptionalColumn = (error: { message?: string } | null | undefined, payload: Record<string, unknown>) =>
  PUBLIC_ORDER_OPTIONAL_INSERT_COLUMNS.find((column) =>
    Object.prototype.hasOwnProperty.call(payload, column)
    && new RegExp(`\\b${column}\\b`, "i").test(error?.message ?? "")
  );

router.post("/", submitRateLimit, async (req, res) => {
  const parsed = PublicOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  if (parsed.data.company) {
    // Honeypot tripped. Pretend success so the bot doesn't retry.
    logger.warn("public-orders: honeypot tripped", { ip: req.ip });
    res.status(201).json({ id: parsed.data.id ?? null, ignored: true });
    return;
  }
  const d = parsed.data;
  const requestedPackageSet = String(d.packageSet ?? "").trim().replace(/\s+/g, " ").slice(0, 80);

  // 1. Resolve package → product → org
  const { data: pkg, error: pkgErr } = await supabase
    .from("product_packages")
    .select("id, product_id, name, package_set, price, currency, quantity, companion_products, package_components, active, state_filter_mode, state_restrictions, requires_state_stock, attribution_product_id")
    .eq("id", d.packageId)
    .maybeSingle();
  if (pkgErr || !pkg || !pkg.active) {
    res.status(404).json({ error: "Package not available." });
    return;
  }

  const { data: product, error: productErr } = await supabase
    .from("products")
    .select("id, org_id, name, active, cross_sell_product_ids, cross_sell_price_overrides, cross_sell_state_restrictions")
    .eq("id", pkg.product_id)
    .maybeSingle();
  if (productErr || !product || !product.active) {
    res.status(404).json({ error: "Product not available." });
    return;
  }

  if (requestedPackageSet && String((pkg as { package_set?: string | null }).package_set ?? "Default").trim().toLowerCase() !== requestedPackageSet.toLowerCase()) {
    res.status(400).json({ error: "This package is not available on this order form. Please refresh and choose an available package." });
    return;
  }

  // Attribution override: if this package rolls up to a DIFFERENT product (a combo
  // bundle sitting under a single-tool parent — set via "Attribute orders to a
  // different product"), stamp the order with that attribution product so orders,
  // analytics, inventory rollup, SMS and the WhatsApp dispatch all read correctly —
  // mirroring the authenticated create path (orders.ts). The public form previously
  // skipped this, so combo orders kept the parent product's name. Stock still
  // deducts by the package's components, and cross-sell config stays keyed to the
  // owner `product`, so ONLY the order's product_id/product_name change here.
  let stampProductId = product.id;
  let stampProductName = product.name;
  const attributionId = (pkg as { attribution_product_id?: string | null }).attribution_product_id ?? null;
  if (attributionId && attributionId !== pkg.product_id) {
    const { data: attribProduct } = await supabase
      .from("products")
      .select("id, name")
      .eq("id", attributionId)
      .eq("org_id", product.org_id)
      .maybeSingle();
    if (attribProduct) {
      stampProductId = attribProduct.id;
      stampProductName = attribProduct.name;
    }
  }

  if (!packageAllowsState(pkg, d.state)) {
    res.status(400).json({ error: "This package is not available in your selected state. Please choose another package." });
    return;
  }
  try {
    const stockReady = await packageHasAgentStateStock(product.org_id, product.id, pkg, d.state);
    if (!stockReady) {
      res.status(409).json({ error: "This combo is no longer available in your state. Please choose the single set." });
      return;
    }
  } catch (availabilityError: any) {
    logger.warn("public-orders: package stock gate failed", {
      packageId: pkg.id,
      state: d.state,
      error: availabilityError?.message
    });
    res.status(500).json({ error: "Could not confirm package availability. Please try again." });
    return;
  }

  // Block flagged customers. customer_flags.phone stores digits only.
  const normalizedPhone = d.phone.replace(/\D/g, "");
  const { data: flagged } = await supabase
    .from("customer_flags")
    .select("id")
    .eq("org_id", product.org_id)
    .eq("phone", normalizedPhone)
    .maybeSingle();
  if (flagged) {
    logger.warn("public-orders: flagged customer blocked", { ip: req.ip });
    res.status(403).json({ error: "Order cannot be placed." });
    return;
  }

  // Repeat-order guard: only the FIRST order from a phone in a rolling 7-day
  // window auto-completes. Every later order from the same number is HELD for
  // review and NOT redirected to the landing page — the redirect is what fires
  // the Facebook pixel "Purchase", so skipping it means Facebook never counts a
  // duplicate as a conversion (and never charges for it). A genuine re-order
  // still arrives; it just waits, parked, for a human to confirm.
  //
  // 7 days mirrors Facebook's click-attribution window — beyond it a re-order
  // is a real fresh conversion again. Identity is matched on the last 10 digits
  // (the unique Nigerian national number) so 080..., 234... and +234... of the
  // same line all match, while two genuinely different customers never collide.
  // We require a full 10-digit number before matching so a malformed / partial
  // entry can never flag the wrong person.
  const phoneLast10 = normalizedPhone.slice(-10);
  let reviewHold = false;
  let reviewReason: string | null = null;
  if (phoneLast10.length >= 10) {
    const windowStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const { data: recentOrders } = await supabase
      .from("orders")
      .select("phone")
      .eq("org_id", product.org_id)
      .gte("created_at", windowStart.toISOString());
    const priorInWindow = (recentOrders ?? []).filter(
      (o) => String(o.phone ?? "").replace(/\D/g, "").slice(-10) === phoneLast10
    ).length;
    // One order auto-completes; any other within the window is held.
    if (priorInWindow >= 1) {
      reviewHold = true;
      reviewReason = `Possible duplicate: ${priorInWindow + 1} orders from this number in the last 7 days — held for review.`;
      logger.warn("public-orders: order held for review (repeat customer)", { priorInWindow, ip: req.ip });
    }
  }

  const embedSettings = await readSettings(product.org_id);
  const publicOrderAssignmentMode =
    embedSettings.public_order_assignment_mode === "manual_review"
      ? "manual_review"
      : "auto_assign";

  // 2. Recompute amount server-side. Never trust client amount.
  let amount = Number(pkg.price ?? 0);
  const packageComponentsSnapshot = await buildPackageComponentSnapshot(product.org_id, pkg.package_components ?? []);

  const lines = d.crossSellLines ?? [];
  const allowedCrossSellIds: string[] = Array.isArray(product.cross_sell_product_ids)
    ? product.cross_sell_product_ids
    : [];
  const crossSellOverrides: Record<string, number> =
    (product.cross_sell_price_overrides as Record<string, number> | null) ?? {};
  const crossSellStateRestrictions: Record<string, string[]> =
    (product.cross_sell_state_restrictions as Record<string, string[]> | null) ?? {};
  const companions: CompanionOverride[] = Array.isArray(pkg.companion_products)
    ? (pkg.companion_products as CompanionOverride[]).filter(companionIsActive)
    : [];

  const targetPackageIds = Array.from(new Set([
    ...lines.map((line) => line.packageId).filter(Boolean),
    ...companions.map((companion) => companion.packageId).filter(Boolean)
  ])) as string[];
  const targetPackages = targetPackageIds.length
    ? (await supabase
        .from("product_packages")
        .select("id, product_id, name, price, quantity, package_components, active")
        .in("id", targetPackageIds)).data ?? []
    : [];

  const resolved: ResolvedLine[] = [];

  // Look up all related product names + primary pricings in one go
  const xsProductIds = Array.from(new Set(lines.map((l) => l.productId)));
  const xsProducts = xsProductIds.length
    ? (await supabase.from("products").select("id, name, org_id, active").in("id", xsProductIds)).data ?? []
    : [];
  const xsPricings = xsProductIds.length
    ? (await supabase.from("product_pricings").select("product_id, currency, selling_price, is_primary").in("product_id", xsProductIds)).data ?? []
    : [];

  for (const line of lines) {
    const xsProduct = xsProducts.find((p) => p.id === line.productId);
    if (!xsProduct || !xsProduct.active || xsProduct.org_id !== product.org_id) {
      // Silently drop unknown / cross-org / inactive cross-sells
      continue;
    }
    const companion = companions.find((c) =>
      (line.companionId
        ? c.companionId === line.companionId
        : c.productId === line.productId)
      && stateAllowsCompanion(c, d.state)
    );
    // If the client submitted a package companion id, it must still be an
    // active companion for this package. Do not downgrade hidden add-ons into
    // generic product-level cross-sells from stale browser sessions.
    if (line.companionId && !companion) continue;
    const targetPackageId = companion?.packageId ?? line.packageId;
    const targetPackage = targetPackageId
      ? (targetPackages.find((entry) => entry.id === targetPackageId) as ResolvedPackageRow | undefined)
      : undefined;
    if (targetPackage && (!targetPackage.active || targetPackage.product_id !== line.productId)) {
      continue;
    }
    let unitPrice = 0;
    if (companion) {
      if (companion.pricingMode === "free")        unitPrice = 0;
      else if (companion.pricingMode === "fixed")  unitPrice = Number(companion.fixedPrice ?? 0);
      else if (targetPackage) {
        unitPrice = Number(targetPackage.price ?? 0);
      }
      else {
        const primary = xsPricings.find((p) => p.product_id === line.productId && p.is_primary)
                     ?? xsPricings.find((p) => p.product_id === line.productId);
        unitPrice = Number(primary?.selling_price ?? 0);
      }
    } else {
      // Standard cross-sell — must be in product.cross_sell_product_ids and pass state restriction
      if (!allowedCrossSellIds.includes(line.productId)) continue;
      const restriction = crossSellStateRestrictions[line.productId];
      if (restriction?.length && d.state && !restriction.includes(d.state)) continue;
      const override = crossSellOverrides[line.productId];
      if (targetPackage) {
        unitPrice = Number(targetPackage.price ?? 0);
      } else if (override !== undefined) {
        unitPrice = Number(override);
      } else {
        const primary = xsPricings.find((p) => p.product_id === line.productId && p.is_primary)
                     ?? xsPricings.find((p) => p.product_id === line.productId);
        unitPrice = Number(primary?.selling_price ?? 0);
      }
    }
    const lineTotal = companion && companion.pricingMode === "fixed"
      ? companionLineAmount(companion, unitPrice, line.quantity)
      : unitPrice * line.quantity;
    const packageComponentsSnapshot = targetPackage
      ? await buildResolvedPackageSnapshot(product.org_id, targetPackage, line.productId, xsProduct.name, line.quantity)
      : undefined;
    amount += lineTotal;
    resolved.push({
      productId:   line.productId,
      productName: targetPackage ? `${xsProduct.name} · ${targetPackage.name}` : xsProduct.name,
      quantity:    line.quantity,
      amount:      lineTotal,
      packageId:   targetPackage?.id,
      packageName: targetPackage?.name,
      packageQuantity: targetPackage?.quantity,
      packageComponentsSnapshot,
      selectionSource: "public_form"
    });
  }

  // Auto-include companions (silent bundles) — append even if client didn't list them.
  // Batch-fetch all auto-include companion products + pricings up front to avoid N+1.
  const autoCompanions = companions.filter(
    (c) => c.autoInclude
      && !resolved.some((r) => r.productId === c.productId)
      && stateAllowsCompanion(c, d.state)
  );
  const autoIds = Array.from(new Set(autoCompanions.map((c) => c.productId)));
  const autoProducts = autoIds.length
    ? (await supabase.from("products").select("id, name, org_id, active").in("id", autoIds)).data ?? []
    : [];
  const autoPricings = autoIds.length
    ? (await supabase.from("product_pricings").select("product_id, selling_price, is_primary").in("product_id", autoIds)).data ?? []
    : [];

  for (const c of autoCompanions) {
    const autoProduct = autoProducts.find((p) => p.id === c.productId);
    if (!autoProduct || !autoProduct.active || autoProduct.org_id !== product.org_id) continue;
    const targetPackage = c.packageId
      ? (targetPackages.find((entry) => entry.id === c.packageId) as ResolvedPackageRow | undefined)
      : undefined;
    if (targetPackage && (!targetPackage.active || targetPackage.product_id !== c.productId)) continue;
    let unitPrice = 0;
    if (c.pricingMode === "free")        unitPrice = 0;
    else if (c.pricingMode === "fixed")  unitPrice = Number(c.fixedPrice ?? 0);
    else if (targetPackage)              unitPrice = Number(targetPackage.price ?? 0);
    else {
      const primary = autoPricings.find((p) => p.product_id === c.productId && p.is_primary)
                   ?? autoPricings.find((p) => p.product_id === c.productId);
      unitPrice = Number(primary?.selling_price ?? 0);
    }
    const lineTotal = companionLineAmount(c, unitPrice, c.quantity);
    const packageComponentsSnapshot = targetPackage
      ? await buildResolvedPackageSnapshot(product.org_id, targetPackage, c.productId, autoProduct.name, c.quantity)
      : undefined;
    amount += lineTotal;
    resolved.push({
      productId: c.productId,
      productName: targetPackage ? `${autoProduct.name} · ${targetPackage.name}` : autoProduct.name,
      quantity: c.quantity,
      amount: lineTotal,
      packageId: targetPackage?.id,
      packageName: targetPackage?.name,
      packageQuantity: targetPackage?.quantity,
      packageComponentsSnapshot,
      selectionSource: "auto_include"
    });
  }

  const selectedOfferKeys = new Set(
    resolved.map((line) => packageOfferKey(line.productId, line.packageId))
  );
  const upsellCompanion = [...companions]
    .filter((companion) =>
      !companion.autoInclude
      && (companion.placement ?? "inline") === "upsell"
      && !selectedOfferKeys.has(packageOfferKey(companion.productId, companion.packageId))
      && stateAllowsCompanion(companion, d.state)
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];

  let upsellOffer:
    | { companionId?: string; productId: string; packageId?: string; packageName?: string; packageQuantity?: number; quantity: number; unitPrice: number; amount: number }
    | null = null;
  let upsellToken: string | null = null;

  if (upsellCompanion) {
    const { data: upsellProduct } = await supabase
      .from("products")
      .select("id, org_id, active")
      .eq("id", upsellCompanion.productId)
      .maybeSingle();
    if (upsellProduct && upsellProduct.active && upsellProduct.org_id === product.org_id) {
      const targetPackage = upsellCompanion.packageId
        ? (targetPackages.find((entry) => entry.id === upsellCompanion.packageId) as ResolvedPackageRow | undefined)
        : undefined;
      let standard = 0;
      if (!targetPackage) {
        const { data: upsellPricings } = await supabase
          .from("product_pricings")
          .select("selling_price, is_primary")
          .eq("product_id", upsellCompanion.productId);
        standard = upsellPricings?.find((pricing) => pricing.is_primary)?.selling_price
          ?? upsellPricings?.[0]?.selling_price
          ?? 0;
      } else if (!targetPackage.active || targetPackage.product_id !== upsellCompanion.productId) {
        standard = -1;
      } else {
        standard = Number(targetPackage.price ?? 0);
      }
      if (standard < 0) {
        upsellOffer = null;
      } else {
        const unitPrice = companionUnitPrice(upsellCompanion, Number(standard));
        const total = companionLineAmount(upsellCompanion, Number(standard), upsellCompanion.quantity);
        upsellOffer = {
          companionId: upsellCompanion.companionId,
          productId: upsellCompanion.productId,
          packageId: targetPackage?.id,
          packageName: targetPackage?.name,
          packageQuantity: targetPackage?.quantity,
          quantity: upsellCompanion.quantity,
          unitPrice,
          amount: total
        };
      }
    }
  }

  let assignedRepId: string | null = null;

  // Held orders are never auto-assigned — they wait, parked, for a human.
  if (publicOrderAssignmentMode === "auto_assign" && !reviewHold) {
    // Round-robin assign to the sales rep with the lowest position, then
    // advance that rep to max+1 so the next order goes to the next rep.
    const { data: reps } = await supabase
      .from("users")
      .select("id, round_robin_position")
      .eq("org_id", product.org_id)
      .eq("active", true)
      // Paused-from-rotation reps are skipped by auto-assign (but keep their
      // login — `active` is untouched). Source of truth for the round-robin.
      .eq("round_robin_excluded", false)
      .eq("role", "Sales Rep")
      .order("round_robin_position", { ascending: true, nullsFirst: false });

    const rep = (reps ?? [])[0] ?? null;
    assignedRepId = rep?.id ?? null;

    if (rep) {
      const maxPos = (reps ?? []).reduce((m, r) => Math.max(m, r.round_robin_position ?? 0), 0);
      supabase.from("users")
        .update({ round_robin_position: maxPos + 1 })
        .eq("id", rep.id)
        .then(() => {});  // fire-and-forget
    }
  }

  const source = sourceFromUtm(d.utmSource);
  const location = [d.city, d.state].filter(Boolean).join(", ") || null;

  // 4. Insert order
  const baseInsert = {
    ...(d.id ? { id: d.id } : {}),
    org_id:            product.org_id,
    source_cart_id:    d.cartId ?? null,
    customer:          d.customer,
    phone:             d.phone,
    whatsapp:          d.whatsapp ?? null,
    email:             d.email || null,
    address:           d.address ?? null,
    city:              d.city ?? null,
    state:             d.state ?? null,
    product_id:        stampProductId,
    package_id:        pkg.id,
    product_name:      stampProductName,
    package_name:      pkg.name,
    quantity:          pkg.quantity,
    amount,
    currency:          pkg.currency,
    package_components_snapshot: packageComponentsSnapshot,
    cross_sell_lines:  resolved.length > 0 ? resolved : [],
    source,
    location,
    assigned_rep_id:   assignedRepId,
    assigned_by_user_id: null,
    assigned_by_name_snapshot: assignedRepId ? "Round-robin" : null,
    utm_source:        d.utmSource ?? null,
    utm_campaign:      d.utmCampaign ?? null,
    utm_medium:        d.utmMedium ?? null,
    utm_content:       d.utmContent ?? null,
    utm_term:          d.utmTerm ?? null,
    embed_label:       cleanEmbedLabel(d.embedLabel),
    referrer:          d.referrer ?? null,
    confirmation_checked: d.confirmationChecked ?? null,
    preferred_delivery:   d.preferredDelivery ?? null,
    form_context:      d.formContext ?? {},
    review_hold:       reviewHold,
    review_reason:     reviewReason,
    status:            "New"
  } as Record<string, unknown>;
  const legacyInsert = { ...baseInsert };
  delete legacyInsert.confirmation_checked;
  delete legacyInsert.preferred_delivery;
  delete legacyInsert.referrer;
  delete legacyInsert.embed_label;
  delete legacyInsert.form_context;
  delete legacyInsert.assigned_by_user_id;
  delete legacyInsert.assigned_by_name_snapshot;
  delete legacyInsert.review_hold;
  delete legacyInsert.review_reason;

  let order: any = null;
  let orderErr: any = null;
  let insertPayload = { ...baseInsert };
  for (let attempt = 0; attempt <= PUBLIC_ORDER_OPTIONAL_INSERT_COLUMNS.length; attempt += 1) {
    const result = await supabase
      .from("orders")
      .insert(insertPayload)
      .select()
      .single();
    order = result.data;
    orderErr = result.error;
    if (!orderErr || !isMissingPublicOrderOptionalColumnsError(orderErr)) break;
    const missingColumn = missingPublicOrderOptionalColumn(orderErr, insertPayload);
    if (!missingColumn) {
      insertPayload = { ...legacyInsert };
      continue;
    }
    const nextPayload = { ...insertPayload };
    delete nextPayload[missingColumn];
    if (Object.keys(nextPayload).length === Object.keys(insertPayload).length) break;
    insertPayload = nextPayload;
  }

  if (orderErr) {
    if (orderErr.code === "23505") {
      res.status(409).json({ error: "Duplicate order id." });
      return;
    }
    logger.error("public-orders: insert failed", { error: orderErr.message });
    res.status(500).json({ error: "Could not record order." });
    return;
  }

  // 5. Mark linked abandoned cart as Converted (best-effort).
  if (d.cartId) {
    const submittedEmbedLabel = cleanEmbedLabel(d.embedLabel);
    const cartUpdate: Record<string, unknown> = {
      status: "Converted",
      last_activity: new Date().toISOString()
    };
    if (submittedEmbedLabel) {
      cartUpdate.embed_label = submittedEmbedLabel;
    }
    await supabase
      .from("abandoned_carts")
      .update(cartUpdate)
      .eq("id", d.cartId)
      .eq("org_id", product.org_id);

    const { error: journeyInsertError } = await supabase
      .from("cart_journey_events")
      .insert({
        org_id: product.org_id,
        cart_id: d.cartId,
        product_id: product.id,
        package_id: pkg.id,
        state: d.state ?? null,
        event_type: "order_submitted",
        metadata: {
          orderId: order.id,
          customerName: d.customer,
          additionalItems: resolved.length,
          source,
          embedLabel: cleanEmbedLabel(d.embedLabel)
        }
      });
    if (journeyInsertError) {
      logger.warn("public-orders: failed to record order_submitted journey event", {
        orderId: order.id,
        cartId: d.cartId,
        error: journeyInsertError.message
      });
    }
  }

  // Optional Meta Conversions API Purchase. This is deliberately opt-in per
  // generated link/package-set: the safe default is landing-page tracking only,
  // so Protohub never starts a second Purchase sender silently.
  const formContext = (d.formContext ?? {}) as Record<string, unknown>;
  const metaPurchaseEventId = contextString(formContext, "metaPurchaseEventId", "metaEventId")
    || `protohub_purchase_${order.id}`;
  const metaConfig = resolveMetaTrackingConfig({
    productId: product.id,
    packageSet: requestedPackageSet || (pkg as { package_set?: string | null }).package_set || null,
    trackingKey: contextString(formContext, "metaTrackingKey", "trackingKey"),
    modeOverride: contextString(formContext, "metaTrackingMode", "trackingMode"),
    pixelIdOverride: contextString(formContext, "metaPixelId", "pixelId"),
    testModeOverride: contextString(formContext, "metaTestMode", "metaTest", "trackingTestMode"),
    testEventCodeOverride: contextString(formContext, "metaTestEventCode", "testEventCode", "meta_test_event_code", "test_event_code")
  });
  if (!reviewHold) {
    void sendMetaCapiPurchase({
      config: metaConfig,
      eventId: metaPurchaseEventId,
      eventSourceUrl: contextString(formContext, "landingUrl") || d.referrer || null,
      clientIp: clientIpFromRequest(req),
      userAgent: contextString(formContext, "userAgent") || String(req.headers["user-agent"] ?? ""),
      customer: d.customer,
      phone: d.phone,
      email: d.email || null,
      city: d.city || null,
      state: d.state || null,
      country: "ng",
      fbp: contextString(formContext, "fbp", "_fbp", "Fbp") || null,
      fbc: contextString(formContext, "fbc", "_fbc", "Fbc") || null,
      fbclid: contextString(formContext, "fbclid") || null,
      value: Number(order.amount ?? amount),
      currency: String(order.currency ?? pkg.currency),
      orderId: String(order.id),
      productId: String(stampProductId),
      productName: String(stampProductName),
      packageId: String(pkg.id),
      packageName: String(pkg.name),
      quantity: Number(pkg.quantity ?? 1)
    });
  }

  // 6. Audit, in-app notification, emails (fire-and-forget).
  await supabase.from("order_audit").insert({
    order_id:    order.id,
    org_id:      product.org_id,
    changed_by:  null,
    from_status: null,
    to_status:   "New",
    note:        reviewHold
      ? "Order created from public embed form and HELD FOR REVIEW (possible duplicate — repeat order from this number; not redirected/tracked)"
      : publicOrderAssignmentMode === "manual_review"
        ? "Order created from public embed form and is awaiting owner/admin assignment"
        : "Order created from public embed form and auto-assigned by round-robin"
  });

  await notifyOrderEvent(product.org_id, {
    id: order.id, customer: order.customer, phone: order.phone, amount: order.amount, currency: order.currency,
    productName: order.product_name, packageName: order.package_name,
    assignedRepId: order.assigned_rep_id
  }, "New");

  sendNewOrderEmail(product.org_id, {
    id: order.id, customer: order.customer, email: order.email,
    phone: order.phone, product_name: order.product_name, package_name: order.package_name,
    amount: order.amount, currency: order.currency, source: order.source
  });
  sendNewOrderSms(product.org_id, {
    id: order.id,
    customer: order.customer,
    phone: order.phone,
    assignedRepId: order.assigned_rep_id,
    product_name: order.product_name,
    package_name: order.package_name,
    package_id: order.package_id,
    amount: order.amount,
    currency: order.currency,
    quantity: order.quantity,
    cross_sell_lines: order.cross_sell_lines
  });

  sendInternalNewOrderEmail(product.org_id, {
    id: order.id, customer: order.customer, phone: order.phone,
    product_name: order.product_name, package_name: order.package_name, amount: order.amount,
    currency: order.currency,
    source: order.source,
    rep_name: publicOrderAssignmentMode === "manual_review"
      ? "Awaiting owner/admin assignment"
      : "Auto-assigned from public form"
  });

  if (assignedRepId) {
    sendOrderAssignedEmail(product.org_id, assignedRepId, {
      id: order.id, customer: order.customer, phone: order.phone,
      product_name: order.product_name, package_name: order.package_name, amount: order.amount,
      currency: order.currency, source: order.source
    });
  }

  if (upsellOffer) {
    upsellToken = signPublicUpsellToken({
      orderId: order.id,
      orgId: product.org_id,
      packageId: pkg.id,
      companionId: upsellOffer.companionId,
      productId: upsellOffer.productId,
      companionPackageId: upsellOffer.packageId,
      quantity: upsellOffer.quantity,
      amount: upsellOffer.amount,
      issuedAt: Date.now()
    });
  }

  res.status(201).json({
    id:       order.id,
    amount:   order.amount,
    currency: order.currency,
    crossSellLines: resolved,
    // Held orders skip the upsell — accepting one would also redirect to the
    // landing page and fire the Facebook pixel, which is exactly what we're
    // avoiding for a possible duplicate.
    upsellOffer: reviewHold ? null : upsellOffer,
    upsellToken: reviewHold ? null : upsellToken,
    // Tells the form NOT to redirect (so no pixel/Purchase) and to show an
    // in-place "order received" thank-you instead.
    reviewHold
  });
});

router.post("/:id/upsell", submitRateLimit, async (req, res) => {
  const orderId = req.params.id;
  if (!orderId) {
    res.status(400).json({ error: "Order id required." });
    return;
  }
  const parsed = PublicUpsellAcceptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const tokenPayload = verifyPublicUpsellToken(parsed.data.token);
  if (!tokenPayload || tokenPayload.orderId !== orderId) {
    res.status(403).json({ error: "Upsell offer is no longer available." });
    return;
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, org_id, source_cart_id, product_id, product_name, package_id, package_name, state, customer, assigned_rep_id, status, amount, currency, cross_sell_lines")
    .eq("id", orderId)
    .maybeSingle();
  if (orderErr || !order) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (order.org_id !== tokenPayload.orgId || order.package_id !== tokenPayload.packageId) {
    res.status(403).json({ error: "Upsell offer does not match this order." });
    return;
  }

  const { data: pkg } = await supabase
    .from("product_packages")
    .select("id, product_id, companion_products")
    .eq("id", order.package_id)
    .maybeSingle();
  if (!pkg) {
    res.status(404).json({ error: "Package not found." });
    return;
  }
  const companions: CompanionOverride[] = Array.isArray(pkg.companion_products)
    ? (pkg.companion_products as CompanionOverride[]).filter(companionIsActive)
    : [];
  const companion = companions.find((entry) =>
    (tokenPayload.companionId
      ? entry.companionId === tokenPayload.companionId
      : entry.productId === tokenPayload.productId)
    && (tokenPayload.companionPackageId ? entry.packageId === tokenPayload.companionPackageId : true)
    && (entry.placement ?? "inline") === "upsell"
    && !entry.autoInclude
    && stateAllowsCompanion(entry, order.state ?? undefined)
  );
  if (!companion) {
    res.status(400).json({ error: "This upsell is no longer available." });
    return;
  }

  const existingLines = Array.isArray(order.cross_sell_lines)
    ? (order.cross_sell_lines as ResolvedLine[])
    : [];
  if (existingLines.some((line) =>
    packageOfferKey(line.productId, line.packageId) === packageOfferKey(tokenPayload.productId, tokenPayload.companionPackageId)
  )) {
    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      crossSellLines: existingLines
    });
    return;
  }

  const { data: upsellProduct } = await supabase
    .from("products")
    .select("id, org_id, name, active")
    .eq("id", tokenPayload.productId)
    .maybeSingle();
  if (!upsellProduct || !upsellProduct.active || upsellProduct.org_id !== order.org_id) {
    res.status(404).json({ error: "Upsell product not available." });
    return;
  }
  const targetPackage = tokenPayload.companionPackageId
    ? (await supabase
        .from("product_packages")
        .select("id, product_id, name, price, quantity, package_components, active")
        .eq("id", tokenPayload.companionPackageId)
        .maybeSingle()).data as ResolvedPackageRow | null
    : null;
  if (targetPackage && (!targetPackage.active || targetPackage.product_id !== tokenPayload.productId)) {
    res.status(400).json({ error: "This upsell bundle is no longer available." });
    return;
  }
  const acceptedQuantity = Math.max(1, Number(tokenPayload.quantity) || companion.quantity || 1);
  const lineAmount = Math.max(0, Number(tokenPayload.amount) || 0);
  const lineProductName = targetPackage ? `${upsellProduct.name} · ${targetPackage.name}` : upsellProduct.name;
  const packageComponentsSnapshot = targetPackage
    ? await buildResolvedPackageSnapshot(order.org_id, targetPackage, tokenPayload.productId, upsellProduct.name, acceptedQuantity)
    : undefined;
  const nextLines = [
    ...existingLines,
    {
      productId: tokenPayload.productId,
      productName: lineProductName,
      quantity: acceptedQuantity,
      amount: lineAmount,
      packageId: targetPackage?.id,
      packageName: targetPackage?.name,
      packageQuantity: targetPackage?.quantity,
      packageComponentsSnapshot,
      selectionSource: "public_upsell"
    }
  ];
  const nextAmount = Number(order.amount ?? 0) + lineAmount;

  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      amount: nextAmount,
      cross_sell_lines: nextLines
    })
    .eq("id", order.id)
    .eq("org_id", order.org_id);
  if (updateErr) {
    logger.error("public-orders: upsell accept failed", { error: updateErr.message, orderId });
    res.status(500).json({ error: "Could not add this offer to the order." });
    return;
  }

  await supabase.from("order_audit").insert({
    order_id: order.id,
    org_id: order.org_id,
    changed_by: null,
    from_status: order.status ?? "New",
    to_status: order.status ?? "New",
    note: `Customer accepted after-submit offer: ${lineProductName} × ${acceptedQuantity} (${formatNotificationMoney(lineAmount, order.currency)}). New order total: ${formatNotificationMoney(nextAmount, order.currency)}`
  });

  if (order.source_cart_id) {
    const { error: journeyError } = await supabase
      .from("cart_journey_events")
      .insert({
        org_id: order.org_id,
        cart_id: order.source_cart_id,
        product_id: order.product_id ?? null,
        package_id: order.package_id ?? null,
        state: order.state ?? null,
        event_type: "additional_item_added",
        companion_product_id: tokenPayload.productId,
        companion_package_id: targetPackage?.id ?? tokenPayload.companionPackageId ?? null,
        metadata: {
          customerName: order.customer ?? "Customer",
          productName: lineProductName,
          packageName: targetPackage?.name ?? null,
          quantity: acceptedQuantity,
          placement: "after_submit",
          selectionSource: "public_upsell",
          orderId: order.id,
          offerAmount: lineAmount,
          totalAfterAdd: nextAmount,
          currency: order.currency
        }
      });
    if (journeyError) {
      logger.warn("public-orders: failed to record after-submit upsell journey event", {
        orderId: order.id,
        cartId: order.source_cart_id,
        error: journeyError.message
      });
    }
  }

  await notifyAfterSubmitUpsellAccepted(
    order.org_id,
    order,
    { productName: lineProductName, amount: lineAmount },
    nextAmount,
    order.currency
  );

  res.json({
    id: order.id,
    amount: nextAmount,
    currency: order.currency,
    crossSellLines: nextLines
  });
});

export default router;
