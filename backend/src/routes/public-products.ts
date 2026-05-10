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
  productId: string; quantity: number; pricingMode: string;
  fixedPrice?: number; stateRestrictions?: string[]; autoInclude?: boolean;
};
type DbPackage = {
  id: string; name: string; description: string | null; quantity: number;
  price: number; currency: string; display_order: number; active: boolean;
  companion_products: DbCompanion[] | null;
};
type DbProduct = {
  id: string; org_id: string;
  name: string; description: string | null;
  active: boolean; available_states: string[] | null;
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
  companionProducts: (p.companion_products ?? []).map((c) => ({
    productId:         c.productId,
    quantity:          c.quantity,
    pricingMode:       c.pricingMode,
    fixedPrice:        c.fixedPrice ?? null,
    stateRestrictions: c.stateRestrictions ?? [],
    autoInclude:       c.autoInclude ?? false
  }))
});

const sanitiseProduct = (p: DbProduct) => ({
  id:                          p.id,
  orgId:                       p.org_id,
  name:                        p.name,
  description:                 p.description ?? "",
  active:                      p.active,
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
      id, org_id, name, description, active, available_states,
      can_be_cross_sell, can_be_free_gift,
      cross_sell_product_ids, cross_sell_state_restrictions, cross_sell_price_overrides,
      free_gift_product_ids, free_gift_state_restrictions,
      form_custom_text,
      pricings: product_pricings(currency, selling_price, is_primary),
      packages: product_packages(id, name, description, quantity, price, currency, display_order, active, companion_products)
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
        id, org_id, name, description, active, available_states,
        can_be_cross_sell, can_be_free_gift,
        cross_sell_product_ids, cross_sell_state_restrictions, cross_sell_price_overrides,
        free_gift_product_ids, free_gift_state_restrictions,
        form_custom_text,
        pricings: product_pricings(currency, selling_price, is_primary),
        packages: product_packages(id, name, description, quantity, price, currency, display_order, active, companion_products)
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
