import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

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
  active:       z.boolean().default(true)
});

router.post("/",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = ProductSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { name, sku, description, reorderPoint, active } = parsed.data;

    const { data, error } = await supabase
      .from("products")
      .insert({ org_id: req.user!.orgId, name, sku, description, reorder_point: reorderPoint, active })
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
    const allowed = ["name", "sku", "description", "reorder_point", "active",
                     "warehouse_stock", "agent_stock", "units_sold"];
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

// ── GET /api/products/:id/pricings ────────────────────────
router.get("/:id/pricings", async (req, res) => {
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
    const parsed = PricingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { currency, sellingPrice, unitCost, isPrimary } = parsed.data;

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
      })
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
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
const PackageSchema = z.object({
  name:         z.string().min(1),
  description:  z.string().optional(),
  quantity:     z.number().int().min(1),
  price:        z.number().min(0),
  currency:     z.enum(["NGN", "USD", "GBP"]).default("NGN"),
  displayOrder: z.number().int().default(0),
  active:       z.boolean().default(true)
});

router.post("/:id/packages",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = PackageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { name, description, quantity, price, currency, displayOrder, active } = parsed.data;
    const { data, error } = await supabase
      .from("product_packages")
      .insert({ product_id: req.params.id, name, description, quantity, price, currency, display_order: displayOrder, active })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  }
);

export default router;
