import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use(requireAuth);
router.use((req, _res, next) => {
  const logBody = req.method === "POST" && !req.path.includes("/package-images/upload");
  logger.info("products route hit", { method: req.method, path: req.path, body: logBody ? req.body : undefined });
  next();
});

const IMAGE_DATA_URL_MAX_LENGTH = 14_200_000;
const mediaImageSchema = z.union([
  z.string().url().max(2048),
  // A 10 MB uploaded file expands when encoded as a data URL.
  z.string().regex(/^data:image\//).max(IMAGE_DATA_URL_MAX_LENGTH),
  z.literal("")
]).optional();
const packageMediaImageSchema = z.union([
  z.string().url().max(2048),
  // A 10 MB uploaded file expands when encoded as a data URL.
  z.string().regex(/^data:image\//).max(IMAGE_DATA_URL_MAX_LENGTH),
  z.literal("")
]).optional();

const productForMarketer = (product: any) => ({
  id: product.id,
  name: product.name,
  description: product.description ?? "",
  sku: "",
  active: product.active !== false,
  reorder_point: 0,
  warehouse_stock: 0,
  agent_stock: 0,
  units_sold: 0,
  package_description: product.package_description ?? "",
  available_states: product.available_states ?? [],
  catalog_type: product.catalog_type ?? "standard",
  form_custom_text: product.form_custom_text ?? "",
  created_at: product.created_at,
  pricings: [],
  packages: (Array.isArray(product.packages) ? product.packages : [])
    .filter((pkg: any) => pkg?.active !== false)
    .map((pkg: any) => ({
      id: pkg.id,
      name: pkg.name,
      package_set: pkg.package_set ?? "Default",
      description: pkg.description ?? "",
      quantity: Number(pkg.quantity ?? 1),
      price: Number(pkg.price ?? 0),
      currency: pkg.currency ?? "NGN",
      display_order: Number(pkg.display_order ?? 0),
      active: pkg.active !== false,
      state_filter_mode: pkg.state_filter_mode ?? "all",
      state_restrictions: Array.isArray(pkg.state_restrictions) ? pkg.state_restrictions : [],
      requires_state_stock: pkg.requires_state_stock === true,
      featured_combo_card: pkg.featured_combo_card === true,
      unit_singular: pkg.unit_singular ?? "",
      unit_plural: pkg.unit_plural ?? "",
      attribution_product_id: pkg.attribution_product_id ?? null
    }))
});

// ── GET /api/products ─────────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("products")
    .select(`
      *,
      pricings: product_pricings!product_pricings_product_id_fkey(*),
      packages: product_packages!product_packages_product_id_fkey(*)
    `)
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(req.user!.role === "Marketer" ? (data ?? []).map(productForMarketer) : data);
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
                     "public_order_assignment_mode",
                     "dedicated_handler_user_id",
                     "dedicated_handler_user_ids",
                     "whatsapp_footage_image_url",
                     "image_url",
                     "can_be_cross_sell", "can_be_free_gift",
                     "cross_sell_product_ids", "cross_sell_price_overrides",
                     "cross_sell_state_restrictions",
                     "free_gift_product_ids", "free_gift_state_restrictions",
                     "alternative_product_ids",
                     "form_custom_text", "package_description"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (
      updates.public_order_assignment_mode !== undefined
      && !["inherit", "auto_assign", "manual_review"].includes(String(updates.public_order_assignment_mode))
    ) {
      res.status(400).json({ error: "Invalid public order assignment mode." });
      return;
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

const isMissingPackageOfferSyncColumnError = (
  error: { message?: string; details?: string; hint?: string } | null | undefined
) => /offer_sync_/i.test(`${error?.message ?? ""} ${error?.details ?? ""} ${error?.hint ?? ""}`);

const withoutPackageOfferSyncColumns = (payload: Record<string, unknown>) => {
  const {
    offer_sync_enabled,
    offer_sync_source_product_id,
    offer_sync_source_package_id,
    ...fallback
  } = payload;
  return fallback;
};

const cleanPackageSetLabel = (value: unknown) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || "Default";

// ── GET /api/products/:id/pricings ────────────────────────
router.get("/:id/pricings", async (req, res) => {
  if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
  if (req.user!.role === "Marketer") {
    res.json([]);
    return;
  }
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
  if (!await checkProductOrg(req.params.id, req.user!.orgId, res)) return;
  const { data, error } = await supabase
    .from("product_packages")
    .select("*")
    .eq("product_id", req.params.id)
    .order("display_order");
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (req.user!.role === "Marketer") {
    res.json((data ?? []).filter((pkg: any) => pkg?.active !== false).map((pkg: any) => productForMarketer({ packages: [pkg] }).packages[0]));
    return;
  }
  res.json(data);
});

// ── POST /api/products/package-images/upload ─────────────
// Accepts a base64 data URL from the inventory editor and uploads it to the
// `package-images` Supabase Storage bucket. Returns the public CDN URL so the
// frontend can store just the URL on the package row (instead of inline base64).
const PackageImageUploadSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/i),
  filename: z.string().max(200).optional()
});
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg"
};
router.post("/package-images/upload",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = PackageImageUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const match = parsed.data.dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match) {
      res.status(400).json({ error: "Invalid image data URL." });
      return;
    }
    const mime = match[1].toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) {
      res.status(400).json({ error: `Unsupported image type: ${mime}.` });
      return;
    }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 10 * 1024 * 1024) {
      res.status(413).json({ error: "Image exceeds 10 MB limit." });
      return;
    }
    const orgId = req.user!.orgId;
    const objectName = `${orgId}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("package-images")
      .upload(objectName, buffer, { contentType: mime, upsert: false });
    if (uploadError) {
      logger.error("package image upload failed", { orgId, objectName, error: uploadError.message });
      res.status(500).json({ error: uploadError.message });
      return;
    }
    const { data: publicData } = supabase.storage.from("package-images").getPublicUrl(objectName);
    res.status(201).json({ url: publicData.publicUrl, path: objectName });
  }
);

// ── POST /api/products/product-videos/upload ──────────────
// Short product/usage videos (e.g. WhatsApp upsell). Uploaded to the public
// `product-videos` bucket; returns the CDN URL to store on the offer.
const VIDEO_MIME_EXT: Record<string, string> = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov" };
router.post("/product-videos/upload",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const dataUrl = typeof req.body?.dataUrl === "string" ? req.body.dataUrl : "";
    const match = dataUrl.match(/^data:(video\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match) { res.status(400).json({ error: "Invalid video data URL (mp4 / webm / mov)." }); return; }
    const mime = match[1].toLowerCase();
    const ext = VIDEO_MIME_EXT[mime];
    if (!ext) { res.status(400).json({ error: `Unsupported video type: ${mime}. Use MP4, WebM or MOV.` }); return; }
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 50 * 1024 * 1024) { res.status(413).json({ error: "Video exceeds 50 MB. Keep it a short clip, or paste a YouTube link instead." }); return; }
    const orgId = req.user!.orgId;
    const objectName = `${orgId}/${randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("product-videos")
      .upload(objectName, buffer, { contentType: mime, upsert: false });
    if (uploadError) {
      logger.error("product video upload failed", { orgId, objectName, error: uploadError.message });
      res.status(500).json({ error: uploadError.message });
      return;
    }
    const { data: publicData } = supabase.storage.from("product-videos").getPublicUrl(objectName);
    res.status(201).json({ url: publicData.publicUrl, path: objectName });
  }
);

// ── POST /api/products/:id/packages ──────────────────────
const PackageComponentSchema = z.object({
  componentId: z.string().min(1).max(120).optional(),
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).default(1),
  isFreeGift: z.boolean().default(false),
  // When true, this component still deducts stock on delivery but is hidden
  // from the customer-facing breakdown on the order form (e.g. a part already
  // implied by the combo name, so listing it would just confuse the buyer).
  hiddenFromCustomer: z.boolean().optional(),
  note: z.string().max(160).optional()
});

const CompanionSchema = z.object({
  companionId:        z.string().min(1).max(120).optional(),
  productId:         z.string().uuid(),
  packageId:         z.string().uuid().optional(),
  bundleComponents:  z.array(PackageComponentSchema).default([]),
  hideSiblingSingleAddOns: z.boolean().optional(),
  active:            z.boolean().default(true),
  quantity:          z.number().int().min(1).default(1),
  pricingMode:       z.enum(["free", "fixed", "use_product_price"]).default("free"),
  fixedPrice:        z.number().min(0).optional(),
  stateFilterMode:   z.enum(["all", "allow", "block"]).default("all"),
  stateRestrictions: z.array(z.string()).default([]),
  requiresStateStock: z.boolean().default(false),
  autoInclude:       z.boolean().default(false),
  placement:         z.enum(["inline", "upsell"]).default("inline"),
  // Cross-sell display extras (optional — for big card-mode bumps before submit)
  pitch:             z.string().max(160).optional(),
  badgeText:         z.string().max(60).optional(),
  headline:          z.string().max(120).optional(),
  summaryOverride:   z.string().max(220).optional(),
  ctaText:           z.string().max(50).optional(),
  declineText:       z.string().max(80).optional(),
  imageUrl:          mediaImageSchema,
  videoUrl:          z.string().url().max(2048).optional().or(z.literal("")),
  embedHtml:         z.string().max(20000).optional().or(z.literal("")),
  priority:          z.number().int().optional(),
  displayMode:       z.enum(["compact", "card", "showcase"]).optional(),
  proofMode:         z.enum(["real", "promo_copy", "hidden"]).optional(),
  urgencyMode:       z.enum(["standard", "price_loss"]).optional(),
  promoAllTimeBuyerCount:       z.number().int().min(0).max(10_000_000).optional(),
  promoBuyersLast24HoursCount:  z.number().int().min(0).max(10_000).optional(),
  promoLastAddedRelative:       z.string().max(60).optional(),
  promoIsMostAdded:             z.boolean().optional()
});
const PackageSchema = z.object({
  name:         z.string().min(1),
  packageSet:   z.string().trim().max(80).optional(),
  description:  z.string().optional(),
  quantity:     z.number().int().min(1),
  price:        z.number().min(0),
  currency:     z.enum(["NGN", "USD", "GBP"]).default("NGN"),
  displayOrder: z.number().int().default(0),
  active:       z.boolean().default(false),
  stateFilterMode:   z.enum(["all", "allow", "block"]).default("all"),
  stateRestrictions: z.array(z.string()).default([]),
  requiresStateStock: z.boolean().default(false),
  featuredComboCard: z.boolean().default(false),
  imageUrl:          packageMediaImageSchema,
  imageUrls:         z.array(packageMediaImageSchema.unwrap()).max(15).default([]),
  videoUrl:          z.string().url().max(2048).nullable().optional().or(z.literal("")),
  unitSingular:     z.string().trim().max(20).nullable().optional(),
  unitPlural:       z.string().trim().max(20).nullable().optional(),
  attributionProductId: z.string().uuid().nullable().optional(),
  companionProducts: z.array(CompanionSchema).default([]),
  packageComponents: z.array(PackageComponentSchema).default([]),
  offerSyncEnabled: z.boolean().default(false),
  offerSyncSourceProductId: z.string().uuid().nullable().optional(),
  offerSyncSourcePackageId: z.string().uuid().nullable().optional()
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
    const {
      name,
      packageSet,
      description,
      quantity,
      price,
      currency,
      displayOrder,
      active,
      stateFilterMode,
      stateRestrictions,
      requiresStateStock,
      featuredComboCard,
      imageUrl,
      imageUrls,
      videoUrl,
      unitSingular,
      unitPlural,
      attributionProductId,
      companionProducts,
      packageComponents,
      offerSyncEnabled,
      offerSyncSourceProductId,
      offerSyncSourcePackageId
    } = parsed.data;
    const insertPayload = {
      product_id: req.params.id,
      name,
      package_set: cleanPackageSetLabel(packageSet),
      description,
      quantity,
      price,
      currency,
      display_order: displayOrder,
      active,
      state_filter_mode: stateFilterMode,
      state_restrictions: stateFilterMode === "all" ? [] : stateRestrictions,
      requires_state_stock: requiresStateStock,
      featured_combo_card: featuredComboCard,
      image_url: imageUrl ?? null,
      image_urls: imageUrls.filter((url) => url && url.trim()),
      video_url: videoUrl?.trim() || null,
      unit_singular: unitSingular?.trim() || null,
      unit_plural: unitPlural?.trim() || null,
      attribution_product_id: attributionProductId ?? null,
      companion_products: companionProducts,
      package_components: packageComponents,
      offer_sync_enabled: offerSyncEnabled,
      offer_sync_source_product_id: offerSyncEnabled ? offerSyncSourceProductId ?? null : null,
      offer_sync_source_package_id: offerSyncEnabled ? offerSyncSourcePackageId ?? null : null
    };
    let { data, error } = await supabase
      .from("product_packages")
      .insert(insertPayload)
      .select()
      .single();
    if (error && isMissingPackageOfferSyncColumnError(error)) {
      ({ data, error } = await supabase
        .from("product_packages")
        .insert(withoutPackageOfferSyncColumns(insertPayload))
        .select()
        .single());
    }
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  }
);

// ── PATCH /api/products/:id/packages/:pkgId ─────────────
const PackageUpdateSchema = z.object({
  name:         z.string().min(1).optional(),
  packageSet:   z.string().trim().max(80).optional(),
  description:  z.string().optional(),
  quantity:     z.number().int().min(1).optional(),
  price:        z.number().min(0).optional(),
  currency:     z.enum(["NGN", "USD", "GBP"]).optional(),
  displayOrder: z.number().int().optional(),
  active:       z.boolean().optional(),
  stateFilterMode:   z.enum(["all", "allow", "block"]).optional(),
  stateRestrictions: z.array(z.string()).optional(),
  requiresStateStock: z.boolean().optional(),
  featuredComboCard: z.boolean().optional(),
  imageUrl:          packageMediaImageSchema,
  imageUrls:         z.array(packageMediaImageSchema.unwrap()).max(15).optional(),
  videoUrl:          z.string().url().max(2048).nullable().optional().or(z.literal("")),
  unitSingular:     z.string().trim().max(20).nullable().optional(),
  unitPlural:       z.string().trim().max(20).nullable().optional(),
  attributionProductId: z.string().uuid().nullable().optional(),
  companionProducts: z.array(CompanionSchema).optional(),
  packageComponents: z.array(PackageComponentSchema).optional(),
  offerSyncEnabled: z.boolean().optional(),
  offerSyncSourceProductId: z.string().uuid().nullable().optional(),
  offerSyncSourcePackageId: z.string().uuid().nullable().optional()
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
    if (parsed.data.packageSet !== undefined) updates.package_set = cleanPackageSetLabel(parsed.data.packageSet);
    if (parsed.data.description !== undefined) updates.description = parsed.data.description;
    if (parsed.data.quantity !== undefined) updates.quantity = parsed.data.quantity;
    if (parsed.data.price !== undefined) updates.price = parsed.data.price;
    if (parsed.data.currency !== undefined) updates.currency = parsed.data.currency;
    if (parsed.data.displayOrder !== undefined) updates.display_order = parsed.data.displayOrder;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    if (parsed.data.stateFilterMode !== undefined) updates.state_filter_mode = parsed.data.stateFilterMode;
    if (parsed.data.stateRestrictions !== undefined) updates.state_restrictions = parsed.data.stateFilterMode === "all" ? [] : parsed.data.stateRestrictions;
    if (parsed.data.requiresStateStock !== undefined) updates.requires_state_stock = parsed.data.requiresStateStock;
    if (parsed.data.featuredComboCard !== undefined) updates.featured_combo_card = parsed.data.featuredComboCard;
    if (parsed.data.imageUrl !== undefined) updates.image_url = parsed.data.imageUrl || null;
    if (parsed.data.imageUrls !== undefined) updates.image_urls = parsed.data.imageUrls.filter((url) => url && url.trim());
    if (parsed.data.videoUrl !== undefined) updates.video_url = parsed.data.videoUrl?.trim() || null;
    if (parsed.data.unitSingular !== undefined) updates.unit_singular = parsed.data.unitSingular ? parsed.data.unitSingular.trim() : null;
    if (parsed.data.unitPlural !== undefined) updates.unit_plural = parsed.data.unitPlural ? parsed.data.unitPlural.trim() : null;
    if (parsed.data.attributionProductId !== undefined) updates.attribution_product_id = parsed.data.attributionProductId ?? null;
    if (parsed.data.companionProducts !== undefined) updates.companion_products = parsed.data.companionProducts;
    if (parsed.data.packageComponents !== undefined) updates.package_components = parsed.data.packageComponents;
    if (parsed.data.offerSyncEnabled !== undefined) updates.offer_sync_enabled = parsed.data.offerSyncEnabled;
    if (parsed.data.offerSyncSourceProductId !== undefined) updates.offer_sync_source_product_id = parsed.data.offerSyncEnabled === false ? null : parsed.data.offerSyncSourceProductId;
    if (parsed.data.offerSyncSourcePackageId !== undefined) updates.offer_sync_source_package_id = parsed.data.offerSyncEnabled === false ? null : parsed.data.offerSyncSourcePackageId;

    let { data, error } = await supabase
      .from("product_packages")
      .update(updates)
      .eq("id", req.params.pkgId)
      .eq("product_id", req.params.id)
      .select()
      .single();
    if (error && isMissingPackageOfferSyncColumnError(error)) {
      const fallbackUpdates = withoutPackageOfferSyncColumns(updates);
      if (Object.keys(fallbackUpdates).length > 0) {
        ({ data, error } = await supabase
          .from("product_packages")
          .update(fallbackUpdates)
          .eq("id", req.params.pkgId)
          .eq("product_id", req.params.id)
          .select()
          .single());
      }
    }
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Package not found." }); return; }

    if (parsed.data.companionProducts !== undefined) {
      const { error: linkedUpdateError } = await supabase
        .from("product_packages")
        .update({ companion_products: parsed.data.companionProducts })
        .eq("product_id", req.params.id)
        .eq("offer_sync_enabled", true)
        .eq("offer_sync_source_product_id", req.params.id)
        .eq("offer_sync_source_package_id", req.params.pkgId)
        .neq("id", req.params.pkgId);
      if (linkedUpdateError && !isMissingPackageOfferSyncColumnError(linkedUpdateError)) {
        logger.error("package offer sync propagation failed", {
          productId: req.params.id,
          packageId: req.params.pkgId,
          error: linkedUpdateError.message
        });
      }
    }

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
