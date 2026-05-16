import { Router } from "express";
import rateLimit from "express-rate-limit";
import { supabase } from "../lib/supabase.js";

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
};
type DbPackageComponent = {
  componentId?: string;
  productId: string;
  quantity: number;
  isFreeGift?: boolean;
  note?: string;
};
type DbPackage = {
  id: string; name: string; description: string | null; quantity: number;
  price: number; currency: string; display_order: number; active: boolean;
  companion_products: DbCompanion[] | null;
  package_components: DbPackageComponent[] | null;
};
type DbProduct = {
  id: string; org_id: string;
  name: string; description: string | null;
  active: boolean; available_states: string[] | null;
  catalog_type?: "standard" | "combo_only" | null;
  can_be_cross_sell: boolean | null; can_be_free_gift: boolean | null;
  cross_sell_product_ids: string[] | null;
  cross_sell_state_restrictions: Record<string, string[]> | null;
  cross_sell_price_overrides: Record<string, number> | null;
  free_gift_product_ids: string[] | null;
  free_gift_state_restrictions: Record<string, string[]> | null;
  form_custom_text: string | null;
  pricings: DbPricing[];
  packages: DbPackage[];
};

const sanitisePricing = (p: DbPricing) => ({
  currency:     p.currency,
  sellingPrice: p.selling_price,
  isPrimary:    p.is_primary
});

const sanitisePackage = (p: DbPackage) => ({
  id:           p.id,
  name:         p.name,
  description:  p.description ?? "",
  quantity:     p.quantity,
  price:        p.price,
  currency:     p.currency,
  displayOrder: p.display_order,
  active:       p.active,
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
    displayMode:       c.displayMode ?? "compact"
  })}),
  packageComponents: (p.package_components ?? []).map((component) => ({
    componentId: component.componentId ?? "",
    productId: component.productId,
    quantity: component.quantity,
    isFreeGift: component.isFreeGift ?? false,
    note: component.note ?? ""
  }))
});

const sanitiseProduct = (p: DbProduct) => ({
  id:                          p.id,
  orgId:                       p.org_id,
  name:                        p.name,
  description:                 p.description ?? "",
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
  formCustomText:              p.form_custom_text ?? "",
  pricings:                    (p.pricings ?? []).map(sanitisePricing),
  packages:                    (p.packages ?? []).filter((pkg) => pkg.active).map(sanitisePackage)
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
    .select(`
      id, org_id, name, description, active, available_states, catalog_type,
      can_be_cross_sell, can_be_free_gift,
      cross_sell_product_ids, cross_sell_state_restrictions, cross_sell_price_overrides,
      free_gift_product_ids, free_gift_state_restrictions,
      form_custom_text,
      pricings: product_pricings!product_pricings_product_id_fkey(currency, selling_price, is_primary),
      packages: product_packages!product_packages_product_id_fkey(id, name, description, quantity, price, currency, display_order, active, companion_products, package_components)
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!rawProduct || !rawProduct.active) {
    res.status(404).json({ error: "Product not found." });
    return;
  }
  const product = rawProduct as unknown as DbProduct;

  // Resolve cross-sells + free gifts in one batched fetch so the form gets a
  // complete payload in one round trip.
  const referenced = new Set<string>([
    ...(product.cross_sell_product_ids ?? []),
    ...(product.free_gift_product_ids ?? []),
    ...((product.packages ?? [])
      .flatMap((pkg) => (pkg.active ? (pkg.companion_products ?? []) : []))
      .map((companion) => companion.productId)
      .filter(Boolean))
  ]);
  let related: DbProduct[] = [];
  if (referenced.size > 0) {
    const { data: rawRelated } = await supabase
      .from("products")
      .select(`
        id, org_id, name, description, active, available_states, catalog_type,
        can_be_cross_sell, can_be_free_gift,
        cross_sell_product_ids, cross_sell_state_restrictions, cross_sell_price_overrides,
        free_gift_product_ids, free_gift_state_restrictions,
        form_custom_text,
        pricings: product_pricings!product_pricings_product_id_fkey(currency, selling_price, is_primary),
        packages: product_packages!product_packages_product_id_fkey(id, name, description, quantity, price, currency, display_order, active, companion_products, package_components)
      `)
      .in("id", Array.from(referenced))
      .eq("active", true);
    related = (rawRelated ?? []) as unknown as DbProduct[];
  }

  res.json({
    product: sanitiseProduct(product),
    related: related.map(sanitiseProduct)
  });
});

export default router;
