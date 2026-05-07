import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/carts ───────────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("abandoned_carts")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/carts ──────────────────────────────────────
// Upsert a draft from the embed order form. Called every time the
// customer touches a field (the frontend debounces). Idempotent on `id`.
const CartUpsertSchema = z.object({
  id:           z.string().min(1),
  customer:     z.string().optional(),
  phone:        z.string().min(1),
  whatsapp:     z.string().optional(),
  city:         z.string().optional(),
  state:        z.string().optional(),
  productId:    z.string().uuid().optional(),
  packageId:    z.string().uuid().optional(),
  productName:  z.string().min(1),
  packageName:  z.string().min(1),
  amount:       z.number().min(0),
  currency:     z.enum(["NGN", "USD", "GBP"]),
  source:       z.string().optional(),
  status:       z.string().optional()  // accepted iff present in cart_status enum (DB will reject otherwise)
});

// DB enum only allows: Open abandoned | Assigned | Contacted | Converted | Lost.
// Frontend draft states ("In progress", "Abandoned") are coerced to "Open abandoned".
router.post("/", async (req, res) => {
  const parsed = CartUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;

  const row = {
    id:           d.id,
    org_id:       req.user!.orgId,
    customer:     d.customer ?? "Partial lead",
    phone:        d.phone,
    whatsapp:     d.whatsapp ?? null,
    city:         d.city ?? null,
    state:        d.state ?? null,
    product_id:   d.productId ?? null,
    package_id:   d.packageId ?? null,
    product_name: d.productName,
    package_name: d.packageName,
    amount:       d.amount,
    currency:     d.currency,
    source:       d.source ?? "Website",
    last_activity: new Date().toISOString()
  };

  // Insert if new, update fields (preserve original status / created_at) if it
  // already exists for this org.
  const { data: existing } = await supabase
    .from("abandoned_carts")
    .select("id, status")
    .eq("id", d.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();

  if (existing) {
    const { data, error } = await supabase
      .from("abandoned_carts")
      .update(row)
      .eq("id", d.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
    return;
  }

  const { data, error } = await supabase
    .from("abandoned_carts")
    .insert({ ...row, status: "Open abandoned" })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// ── PATCH /api/carts/:id ─────────────────────────────────
// Update status, assigned rep, etc.
router.patch("/:id",
  requireRole("Owner", "Admin", "Sales Rep"),
  async (req, res) => {
    const allowed = ["status", "assigned_rep_id", "last_activity"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    updates.last_activity = new Date().toISOString();

    const { data, error } = await supabase
      .from("abandoned_carts")
      .update(updates)
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Cart not found." }); return; }
    res.json(data);
  }
);

export default router;
