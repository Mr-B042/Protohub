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

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { notifyOrderEvent } from "../lib/order-notifications.js";
import { buildPackageComponentSnapshot } from "../lib/order-inventory.js";
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

type CompanionOverride = {
  companionId?: string;
  productId: string;
  packageId?: string;
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
  displayMode?: "compact" | "card";
};

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
};

const PublicUpsellAcceptSchema = z.object({
  token: z.string().min(24)
});

const ALLOWED_SOURCES = ["TikTok", "Facebook", "WhatsApp", "Website", "Direct"] as const;
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

function sourceFromUtm(utm: string | undefined): typeof ALLOWED_SOURCES[number] {
  const s = (utm ?? "").toLowerCase();
  if (s.includes("tiktok"))   return "TikTok";
  if (s.includes("facebook") || s.includes("fb")) return "Facebook";
  if (s.includes("whatsapp") || s.includes("wa")) return "WhatsApp";
  if (s.includes("direct"))   return "Direct";
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
    quantity: Math.max(1, Number(targetPackage.quantity) || 1) * normalizedBundleCount,
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
  error?.code === "42703" || /confirmation_checked|preferred_delivery|referrer|embed_label|form_context|assigned_by_user_id|assigned_by_name_snapshot/i.test(error?.message ?? "");

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

  // 1. Resolve package → product → org
  const { data: pkg, error: pkgErr } = await supabase
    .from("product_packages")
    .select("id, product_id, name, price, currency, quantity, companion_products, package_components, active")
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
    ? (pkg.companion_products as CompanionOverride[])
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

  if (publicOrderAssignmentMode === "auto_assign") {
    // Round-robin assign to the sales rep with the lowest position, then
    // advance that rep to max+1 so the next order goes to the next rep.
    const { data: reps } = await supabase
      .from("users")
      .select("id, round_robin_position")
      .eq("org_id", product.org_id)
      .eq("active", true)
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
    product_id:        product.id,
    package_id:        pkg.id,
    product_name:      product.name,
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

  let { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert(baseInsert)
    .select()
    .single();

  if (orderErr && isMissingPublicOrderOptionalColumnsError(orderErr)) {
    ({ data: order, error: orderErr } = await supabase
      .from("orders")
      .insert(legacyInsert)
      .select()
      .single());
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
    await supabase
      .from("abandoned_carts")
      .update({ status: "Converted", last_activity: new Date().toISOString() })
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

  // 6. Audit, in-app notification, emails (fire-and-forget).
  await supabase.from("order_audit").insert({
    order_id:    order.id,
    org_id:      product.org_id,
    changed_by:  null,
    from_status: null,
    to_status:   "New",
    note:        publicOrderAssignmentMode === "manual_review"
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
    amount: order.amount,
    currency: order.currency
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
    upsellOffer,
    upsellToken
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
    ? (pkg.companion_products as CompanionOverride[])
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
