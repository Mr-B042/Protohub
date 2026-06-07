import { Router } from "express";
import rateLimit from "express-rate-limit";
import { supabase } from "../lib/supabase.js";
import { packageAvailabilityForState } from "../lib/package-availability.js";
import { readSettings } from "./embed-settings.js";

const router = Router();

// 120 req/min per IP — read-only, embed forms may legitimately call on load.
const readRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." }
});

// ── Sanitisation helpers ─────────────────────────────────
// Strip internal fields (cost, inventory, bonus config, org_id, …) before
// shipping a product to an unauthenticated visitor.
type DbPricing = { currency: string; selling_price: number; is_primary: boolean };
type DbCompanion = {
  companionId?: string;
  productId: string; packageId?: string; quantity: number; pricingMode: string;
  fixedPrice?: number; stateFilterMode?: "all" | "allow" | "block"; stateRestrictions?: string[]; autoInclude?: boolean;
  placement?: "inline" | "upsell";
  pitch?: string;
  badgeText?: string;
  headline?: string;
  ctaText?: string;
  declineText?: string;
  imageUrl?: string;
  videoUrl?: string;
  embedHtml?: string;
  priority?: number;
  displayMode?: "compact" | "card";
  proofMode?: "real" | "promo_copy" | "hidden";
  urgencyMode?: "standard" | "price_loss";
  promoAllTimeBuyerCount?: number;
  promoBuyersLast24HoursCount?: number;
  promoLastAddedRelative?: string;
  promoIsMostAdded?: boolean;
};
type CompanionSocialProof = {
  buyersTodayCount: number;
  buyersLast24HoursCount: number;
  recentBuyerCount: number;
  allTimeBuyerCount: number;
  lastOrderedAt: string | null;
  isMostAdded: boolean;
};
type DbPackageComponent = {
  componentId?: string;
  component_id?: string;
  productId: string;
  product_id?: string;
  quantity: number;
  isFreeGift?: boolean;
  is_free_gift?: boolean;
  hiddenFromCustomer?: boolean;
  hidden_from_customer?: boolean;
  note?: string;
};
type DbPackage = {
  id: string; name: string; description: string | null; quantity: number;
  price: number; currency: string; display_order: number; active: boolean;
  state_filter_mode?: "all" | "allow" | "block" | null;
  state_restrictions?: string[] | null;
  requires_state_stock?: boolean | null;
  featured_combo_card?: boolean | null;
  image_url?: string | null;
  image_urls?: string[] | null;
  unit_singular?: string | null;
  unit_plural?: string | null;
  attribution_product_id?: string | null;
  companion_products: DbCompanion[] | null;
  package_components: DbPackageComponent[] | null;
};
type DbProduct = {
  id: string; org_id: string;
  name: string; description: string | null;
  package_description?: string | null;
  active: boolean; available_states: string[] | null;
  catalog_type?: "standard" | "combo_only" | null;
  can_be_cross_sell: boolean | null; can_be_free_gift: boolean | null;
  cross_sell_product_ids: string[] | null;
  cross_sell_state_restrictions: Record<string, string[]> | null;
  cross_sell_price_overrides: Record<string, number> | null;
  free_gift_product_ids: string[] | null;
  free_gift_state_restrictions: Record<string, string[]> | null;
  alternative_product_ids: string[] | null;
  form_custom_text: string | null;
  pricings: DbPricing[];
  packages: DbPackage[];
};

const sanitisePricing = (p: DbPricing) => ({
  currency:     p.currency,
  sellingPrice: p.selling_price,
  isPrimary:    p.is_primary
});

const sanitisePackage = (p: DbPackage, companionSocialProofByProductId?: Record<string, CompanionSocialProof>) => ({
  id:           p.id,
  name:         p.name,
  description:  p.description ?? "",
  quantity:     p.quantity,
  price:        p.price,
  currency:     p.currency,
  displayOrder: p.display_order,
  active:       p.active,
  stateFilterMode: p.state_filter_mode ?? "all",
  stateRestrictions: p.state_restrictions ?? [],
  requiresStateStock: p.requires_state_stock === true,
  featuredComboCard: p.featured_combo_card === true,
  imageUrl: p.image_url ?? "",
  imageUrls: p.image_urls ?? [],
  unitSingular: p.unit_singular ?? null,
  unitPlural: p.unit_plural ?? null,
  attributionProductId: p.attribution_product_id ?? null,
  companionProducts: (p.companion_products ?? []).map((c) => {
    const restrictions = c.stateRestrictions ?? [];
    const stateFilterMode =
      c.stateFilterMode === "block"
        ? "block"
        : c.stateFilterMode === "allow"
          ? (restrictions.length > 0 ? "allow" : "all")
          : "all";
    return ({
    companionId:       c.companionId ?? "",
    productId:         c.productId,
    packageId:         c.packageId ?? null,
    quantity:          c.quantity,
    pricingMode:       c.pricingMode,
    fixedPrice:        c.fixedPrice ?? null,
    stateFilterMode,
    stateRestrictions: restrictions,
    autoInclude:       c.autoInclude ?? false,
    placement:         c.placement ?? "inline",
    pitch:             c.pitch ?? "",
    badgeText:         c.badgeText ?? "",
    headline:          c.headline ?? "",
    ctaText:           c.ctaText ?? "",
    declineText:       c.declineText ?? "",
    imageUrl:          c.imageUrl ?? "",
    videoUrl:          c.videoUrl ?? "",
    embedHtml:         c.embedHtml ?? "",
    priority:          c.priority ?? 0,
    displayMode:       c.displayMode ?? "compact",
    proofMode:         c.proofMode === "promo_copy" || c.proofMode === "hidden" ? c.proofMode : "real",
    urgencyMode:       c.urgencyMode === "price_loss" ? "price_loss" : "standard",
    promoAllTimeBuyerCount:
      typeof c.promoAllTimeBuyerCount === "number" && c.promoAllTimeBuyerCount > 0
        ? Math.floor(c.promoAllTimeBuyerCount)
        : null,
    promoBuyersLast24HoursCount:
      typeof c.promoBuyersLast24HoursCount === "number" && c.promoBuyersLast24HoursCount > 0
        ? Math.floor(c.promoBuyersLast24HoursCount)
        : null,
    promoLastAddedRelative:
      typeof c.promoLastAddedRelative === "string" && c.promoLastAddedRelative.trim()
        ? c.promoLastAddedRelative.trim()
        : null,
    promoIsMostAdded: c.promoIsMostAdded === true,
    socialProof: companionSocialProofByProductId?.[c.productId] ?? null
  })}),
  packageComponents: (p.package_components ?? []).map((component) => {
    const productId = component.productId ?? component.product_id ?? "";
    return {
      componentId: component.componentId ?? component.component_id ?? "",
      productId,
      quantity: component.quantity,
      isFreeGift: component.isFreeGift ?? component.is_free_gift ?? false,
      hiddenFromCustomer: component.hiddenFromCustomer ?? component.hidden_from_customer ?? false,
      note: component.note ?? ""
    };
  })
});

const sanitiseProduct = (p: DbProduct, companionSocialProofByProductId?: Record<string, CompanionSocialProof>) => ({
  id:                          p.id,
  orgId:                       p.org_id,
  name:                        p.name,
  description:                 p.description ?? "",
  packageDescription:          p.package_description ?? "",
  active:                      p.active,
  catalogType:                 p.catalog_type ?? "standard",
  availableStates:             p.available_states ?? [],
  canBeCrossSell:              p.can_be_cross_sell ?? false,
  canBeFreeGift:               p.can_be_free_gift ?? false,
  crossSellProductIds:         p.cross_sell_product_ids ?? [],
  crossSellStateRestrictions:  p.cross_sell_state_restrictions ?? {},
  crossSellPriceOverrides:     p.cross_sell_price_overrides ?? {},
  freeGiftProductIds:          p.free_gift_product_ids ?? [],
  freeGiftStateRestrictions:   p.free_gift_state_restrictions ?? {},
  alternativeProductIds:       p.alternative_product_ids ?? [],
  formCustomText:              p.form_custom_text ?? "",
  pricings:                    (p.pricings ?? []).map(sanitisePricing),
  packages:                    (p.packages ?? []).filter((pkg) => pkg.active).map((pkg) => sanitisePackage(pkg, companionSocialProofByProductId))
});

type DbCrossSellLine = {
  productId?: string;
  selectionSource?: string;
};

const LAGOS_OFFSET_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const lagosDayStartUtcIso = (date: Date) => {
  const lagosNow = new Date(date.getTime() + LAGOS_OFFSET_MS);
  const year = lagosNow.getUTCFullYear();
  const month = lagosNow.getUTCMonth();
  const day = lagosNow.getUTCDate();
  return new Date(Date.UTC(year, month, day) - LAGOS_OFFSET_MS).toISOString();
};

const currentLagosResetWindow = (date: Date, intervalMinutes: number) => {
  const safeIntervalMinutes = Math.min(10080, Math.max(10, Math.floor(intervalMinutes || 1440)));
  const intervalMs = safeIntervalMinutes * 60 * 1000;
  const dayStartMs = new Date(lagosDayStartUtcIso(date)).getTime();
  const elapsedMs = Math.max(0, date.getTime() - dayStartMs);
  const windowStartMs = dayStartMs + Math.floor(elapsedMs / intervalMs) * intervalMs;
  return {
    resetIntervalMinutes: safeIntervalMinutes,
    windowStartIso: new Date(windowStartMs).toISOString(),
    nextResetAtIso: new Date(windowStartMs + intervalMs).toISOString()
  };
};

const buildCompanionSocialProof = async (product: DbProduct) => {
  const companionProductIds = Array.from(
    new Set(
      (product.packages ?? [])
        .flatMap((pkg) => (pkg.active ? (pkg.companion_products ?? []) : []))
        .filter((companion) => !companion.autoInclude)
        .filter((companion) => Boolean(companion.productId))
        .map((companion) => companion.productId)
    )
  );
  if (companionProductIds.length === 0) return {};

  const todayStartIso = lagosDayStartUtcIso(new Date());
  const last24HoursStartIso = new Date(Date.now() - DAY_MS).toISOString();
  const recentWindowStartIso = new Date(new Date(todayStartIso).getTime() - (6 * DAY_MS)).toISOString();

  const { data: recentOrders, error } = await supabase
    .from("orders")
    .select("created_at, cross_sell_lines")
    .eq("org_id", product.org_id)
    .eq("product_id", product.id)
    .order("created_at", { ascending: false });
  if (error || !recentOrders) return {};

  const proofByProductId = Object.fromEntries(
    companionProductIds.map((productId) => [productId, {
      buyersTodayCount: 0,
      buyersLast24HoursCount: 0,
      recentBuyerCount: 0,
      allTimeBuyerCount: 0,
      lastOrderedAt: null,
      isMostAdded: false
    } satisfies CompanionSocialProof])
  ) as Record<string, CompanionSocialProof>;

  recentOrders.forEach((order) => {
    const createdAt = typeof order.created_at === "string" ? order.created_at : "";
    if (!createdAt) return;
    const lines = Array.isArray(order.cross_sell_lines)
      ? (order.cross_sell_lines as DbCrossSellLine[])
      : [];
    const seenCompanionProductIds = new Set<string>();
    lines.forEach((line) => {
      if (!line || typeof line.productId !== "string") return;
      if (line.selectionSource !== "public_form" && line.selectionSource !== "public_upsell") return;
      if (!proofByProductId[line.productId]) return;
      seenCompanionProductIds.add(line.productId);
    });
    seenCompanionProductIds.forEach((productId) => {
      const entry = proofByProductId[productId];
      entry.allTimeBuyerCount += 1;
      if (createdAt >= recentWindowStartIso) entry.recentBuyerCount += 1;
      if (createdAt >= todayStartIso) entry.buyersTodayCount += 1;
      if (createdAt >= last24HoursStartIso) entry.buyersLast24HoursCount += 1;
      if (!entry.lastOrderedAt || createdAt > entry.lastOrderedAt) {
        entry.lastOrderedAt = createdAt;
      }
    });
  });

  const mostAddedRecentCount = Math.max(...Object.values(proofByProductId).map((entry) => entry.allTimeBuyerCount), 0);
  if (mostAddedRecentCount > 0) {
    Object.values(proofByProductId).forEach((entry) => {
      entry.isMostAdded = entry.recentBuyerCount === mostAddedRecentCount;
    });
  }
  return proofByProductId;
};

const PUBLIC_PRODUCT_SELECT = `
  id, org_id, name, description, package_description, active, available_states, catalog_type,
  can_be_cross_sell, can_be_free_gift,
  cross_sell_product_ids, cross_sell_state_restrictions, cross_sell_price_overrides,
  free_gift_product_ids, free_gift_state_restrictions,
  alternative_product_ids,
  form_custom_text,
  pricings: product_pricings!product_pricings_product_id_fkey(currency, selling_price, is_primary),
  packages: product_packages!product_packages_product_id_fkey(id, name, description, quantity, price, currency, display_order, active, state_filter_mode, state_restrictions, requires_state_stock, featured_combo_card, image_url, image_urls, unit_singular, unit_plural, attribution_product_id, companion_products, package_components)
`;

router.get("/:id/package-availability", readRateLimit, async (req, res) => {
  const { id } = req.params;
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const { data: rawProduct, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!rawProduct || !rawProduct.active) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  try {
    const product = rawProduct as unknown as DbProduct;
    const packages = (product.packages ?? []).filter((pkg) => pkg.active);
    const availability = await packageAvailabilityForState(product.org_id, product.id, packages, state);
    res.json({ packages: availability });
  } catch (availabilityError: any) {
    res.status(500).json({ error: availabilityError?.message ?? "Could not check package availability." });
  }
});

router.get("/:id/free-delivery-slots", readRateLimit, async (req, res) => {
  const { id } = req.params;
  if (!id) { res.status(400).json({ error: "id required" }); return; }

  const { data: product, error } = await supabase
    .from("products")
    .select("id, org_id, active")
    .eq("id", id)
    .maybeSingle();

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!product || !product.active) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  const settings = await readSettings(product.org_id);
  if (!settings.free_delivery_slots_enabled) {
    res.json({ enabled: false });
    return;
  }

  const limit = Math.min(500, Math.max(1, Math.floor(Number(settings.free_delivery_slot_limit ?? 15))));
  const manualClaimed = Math.min(limit, Math.max(0, Math.floor(Number(settings.free_delivery_slot_manual_claimed ?? 0))));
  const window = currentLagosResetWindow(new Date(), Number(settings.free_delivery_reset_interval_minutes ?? 1440));

  const { data: packageRows, error: packageError } = await supabase
    .from("product_packages")
    .select("id")
    .eq("product_id", product.id);
  if (packageError) { res.status(500).json({ error: packageError.message }); return; }

  const packageIds = (packageRows ?? []).map((row) => row.id).filter(Boolean);
  let query = supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("org_id", product.org_id)
    .gte("created_at", window.windowStartIso)
    .not("status", "eq", "Cancelled");

  if (packageIds.length > 0) {
    query = query.in("package_id", packageIds);
  } else {
    query = query.eq("product_id", product.id);
  }

  const { count, error: countError } = await query;
  if (countError) { res.status(500).json({ error: countError.message }); return; }

  const liveClaimed = Math.max(0, count ?? 0);
  const claimed = Math.min(limit, manualClaimed + liveClaimed);
  const remaining = Math.max(0, limit - claimed);
  res.json({
    enabled: true,
    limit,
    claimed,
    manualClaimed,
    liveClaimed,
    remaining,
    full: remaining <= 0,
    windowStart: window.windowStartIso,
    nextResetAt: window.nextResetAtIso,
    resetIntervalMinutes: window.resetIntervalMinutes
  });
});

// ── GET /api/public/products/:id ──────────────────────────
// Storefront-safe view of a single product, plus eagerly-loaded cross-sell
// and free-gift products so the embed form can render add-ons without
// extra round trips. Inactive products 404. Internal fields (cost,
// inventory, bonus config, org_id) are stripped.
router.get("/:id", readRateLimit, async (req, res) => {
  const { id } = req.params;
  if (!id) { res.status(400).json({ error: "id required" }); return; }

  const { data: rawProduct, error } = await supabase
    .from("products")
    .select(PUBLIC_PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!rawProduct || !rawProduct.active) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const product = rawProduct as unknown as DbProduct;
  const companionSocialProofByProductId = await buildCompanionSocialProof(product);

  // Resolve cross-sells + free gifts + alternative products in one batched
  // fetch so the form gets a complete payload in one round trip. Alternative
  // products' packages are surfaced on this product's package picker as
  // either/or choices (single tool vs combo bundle), not add-ons.
  const referenced = new Set<string>([
    ...(product.cross_sell_product_ids ?? []),
    ...(product.free_gift_product_ids ?? []),
    ...(product.alternative_product_ids ?? []),
    ...((product.packages ?? [])
      .map((pkg) => pkg.attribution_product_id)
      .filter((id): id is string => Boolean(id))),
    ...((product.packages ?? [])
      .flatMap((pkg) => (pkg.active ? (pkg.companion_products ?? []) : []))
      .map((companion) => companion.productId)
      .filter(Boolean)),
    ...((product.packages ?? [])
      .flatMap((pkg) => (pkg.active ? (pkg.package_components ?? []) : []))
      .map((component) => component.productId ?? component.product_id)
      .filter(Boolean))
  ]);
  let related: DbProduct[] = [];
  if (referenced.size > 0) {
    const { data: rawRelated } = await supabase
      .from("products")
      .select(PUBLIC_PRODUCT_SELECT)
      .in("id", Array.from(referenced))
      .eq("active", true);
    related = (rawRelated ?? []) as unknown as DbProduct[];
  }

  res.json({
    product: sanitiseProduct(product, companionSocialProofByProductId),
    related: related.map((item) => sanitiseProduct(item))
  });
});

export default router;
