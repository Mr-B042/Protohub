import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use(requireAuth);
router.use((req, _res, next) => { logger.info("products route hit", { method: req.method, path: req.path, body: req.method === "POST" ? req.body : undefined }); next(); });

const mediaImageSchema = z.union([
  z.string().url().max(2048),
  z.string().regex(/^data:image\//).max(800000),
  z.literal("")
]).optional();

// ── GET /api/products ─────────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select(`
      *,
      pricings: product_pricings(*),
      packages: product_packages(*)
    `)
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/products ────────────────────────────────────
const ProductSchema = z.object({
  name:         z.string().min(1),
  sku:          z.string().min(1),
  description:  z.string().optional(),
  reorderPoint: z.number().int().min(0).default(10),
  active:       z.boolean().default(true),
  catalogType:  z.enum(["standard", "combo_only"]).default("standard")
});

router.post("/",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = ProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { name, sku, description, reorderPoint, active, catalogType } = parsed.data;

    const { data, error } = await supabase
      .from("products")
      .insert({ org_id: req.user!.orgId, name, sku, description, reorder_point: reorderPoint, active, catalog_type: catalogType })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: `SKU "${sku}" already exists.` });
      } else {
        res.status(500).json({ error: error.message });
      }
      return;
    }
    res.status(201).json(data);
  }
);

// ── PATCH /api/products/:id ───────────────────────────────
router.patch("/:id",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const { id } = req.params;
    // Stock fields (warehouse_stock / agent_stock) are intentionally excluded.
    // All stock changes must go through /api/stock/* or /api/agents/:id/stock so
    // they generate stock_movements rows for the audit trail.
    const allowed = ["name", "sku", "description", "reorder_point", "active",
                     "units_sold",
                     "bonus_config", "available_states", "role",
                     "catalog_type",
                     "can_be_cross_sell", "can_be_free_gift",
                     "cross_sell_product_ids", "cross_sell_price_overrides",
                     "cross_sell_state_restrictions",
                     "free_gift_product_ids", "free_gift_state_restrictions",
                     "form_custom_text", "package_description"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const { data, error } = await supabase
      .from("products")
      .update(updates)
      .eq("id", id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data)  { res.status(404).json({ error: "Product not found." }); return; }
    res.json(data);
  }
);

// ── DELETE /api/products/:id ──────────────────────────────
router.delete("/:id",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const { error } = await supabase
      .from("products")
      .delete()
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(204).send();
  }
);

/** Verify a product ID belongs to the caller's org. Returns false and sends 404 if not. */
async function checkProductOrg(productId: string | string[], orgId: string, res: import("express").Response): Promise<boolean> {
  const id = Array.isArray(productId) ? productId[0]! : productId;
  const { data } = await supabase.from("products").select("id").eq("id", id).eq("org_id", orgId).single();
  if (!data) { res.status(404).json({ error: "Product not found." }); return false; }
  return true;
}

// ── GET /api/products/:id/pricings ────────────────────────
router.get("/:id/pricings", async (req, res) => {
  if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
  const { data, error } = await supabase
    .from("product_pricings")
    .select("*")
    .eq("product_id", req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/products/:id/pricings ──────────────────────
const PricingSchema = z.object({
  currency:     z.enum(["NGN", "USD", "GBP"]),
  sellingPrice: z.number().min(0),
  unitCost:     z.number().min(0),
  isPrimary:    z.boolean().default(false)
});

router.post("/:id/pricings",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
    const parsed = PricingSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.error("createPricing validation failed", { body: req.body, errors: parsed.error.flatten().fieldErrors });
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { currency, sellingPrice, unitCost, isPrimary } = parsed.data;
    logger.info("createPricing", { productId: req.params.id, currency, sellingPrice, unitCost, isPrimary });

    // If setting as primary, clear other primaries first
    if (isPrimary) {
      await supabase
        .from("product_pricings")
        .update({ is_primary: false })
        .eq("product_id", req.params.id);
    }

    const { data, error } = await supabase
      .from("product_pricings")
      .upsert({
        product_id: req.params.id,
        currency,
        selling_price: sellingPrice,
        unit_cost: unitCost,
        is_primary: isPrimary
      }, { onConflict: "product_id,currency" })
      .select()
      .single();

    if (error) {
      logger.error("createPricing db error", { error: error.message });
      res.status(500).json({ error: error.message });
      return;
    }
    logger.info("createPricing saved", { id: data?.id });
    res.status(201).json(data);
  }
);

// ── GET /api/products/:id/packages ───────────────────────
router.get("/:id/packages", async (req, res) => {
  const { data, error } = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", req.params.id)
    .order("display_order");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/products/:id/packages ──────────────────────
const CompanionSchema = z.object({
  companionId:        z.string().min(1).max(120).optional(),
  productId:         z.string().uuid(),
  packageId:         z.string().uuid().optional(),
  quantity:          z.number().int().min(1).default(1),
  pricingMode:       z.enum(["free", "fixed", "use_product_price"]).default("free"),
  fixedPrice:        z.number().min(0).optional(),
  stateFilterMode:   z.enum(["all", "allow", "block"]).default("all"),
  stateRestrictions: z.array(z.string()).default([]),
  autoInclude:       z.boolean().default(false),
  placement:         z.enum(["inline", "upsell"]).default("inline"),
  // Cross-sell display extras (optional — for big card-mode bumps before submit)
  pitch:             z.string().max(160).optional(),
  badgeText:         z.string().max(60).optional(),
  headline:          z.string().max(120).optional(),
  ctaText:           z.string().max(50).optional(),
  declineText:       z.string().max(80).optional(),
  imageUrl:          mediaImageSchema,
  videoUrl:          z.string().url().max(2048).optional().or(z.literal("")),
  embedHtml:         z.string().max(20000).optional().or(z.literal("")),
  priority:          z.number().int().optional(),
  displayMode:       z.enum(["compact", "card"]).optional()
});
const PackageComponentSchema = z.object({
  componentId: z.string().min(1).max(120).optional(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
  isFreeGift: z.boolean().default(false),
  note: z.string().max(160).optional()
});
const PackageSchema = z.object({
  name:         z.string().min(1),
  description:  z.string().optional(),
  quantity:     z.number().int().min(1),
  price:        z.number().min(0),
  currency:     z.enum(["NGN", "USD", "GBP"]).default("NGN"),
  displayOrder: z.number().int().default(0),
  active:       z.boolean().default(true),
  companionProducts: z.array(CompanionSchema).default([]),
  packageComponents: z.array(PackageComponentSchema).default([])
});

router.post("/:id/packages",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
    const parsed = PackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { name, description, quantity, price, currency, displayOrder, active, companionProducts, packageComponents } = parsed.data;
    const { data, error } = await supabase
      .from("product_packages")
      .insert({
        product_id: req.params.id,
        name,
        description,
        quantity,
        price,
        currency,
        display_order: displayOrder,
        active,
        companion_products: companionProducts,
        package_components: packageComponents
      })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  }
);

// ── PATCH /api/products/:id/packages/:pkgId ─────────────
const PackageUpdateSchema = z.object({
  name:         z.string().min(1).optional(),
  description:  z.string().optional(),
  quantity:     z.number().int().min(1).optional(),
  price:        z.number().min(0).optional(),
  currency:     z.enum(["NGN", "USD", "GBP"]).optional(),
  displayOrder: z.number().int().optional(),
  active:       z.boolean().optional(),
  companionProducts: z.array(CompanionSchema).optional(),
  packageComponents: z.array(PackageComponentSchema).optional()
});

router.patch("/:id/packages/:pkgId",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
    const parsed = PackageUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.quantity !== undefined) updates.quantity = parsed.data.quantity;
    if (parsed.data.price !== undefined) updates.price = parsed.data.price;
    if (parsed.data.currency !== undefined) updates.currency = parsed.data.currency;
    if (parsed.data.displayOrder !== undefined) updates.display_order = parsed.data.displayOrder;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    if (parsed.data.companionProducts !== undefined) updates.companion_products = parsed.data.companionProducts;
    if (parsed.data.packageComponents !== undefined) updates.package_components = parsed.data.packageComponents;

    const { data, error } = await supabase
      .from("product_packages")
      .update(updates)
      .eq("id", req.params.pkgId)
      .eq("product_id", req.params.id)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Package not found." }); return; }
    res.json(data);
  }
);

// ── DELETE /api/products/:id/packages/:pkgId ────────────
router.delete("/:id/packages/:pkgId",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
    const { error } = await supabase
      .from("product_packages")
      .delete()
      .eq("id", req.params.pkgId)
      .eq("product_id", req.params.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(204).send();
  }
);

// ── DELETE /api/products/:id/pricings/:currency ─────────
router.delete("/:id/pricings/:currency",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
    const { error } = await supabase
      .from("product_pricings")
      .delete()
      .eq("product_id", req.params.id)
      .eq("currency", (req.params.currency as string).toUpperCase());
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(204).send();
  }
);

export default router;
