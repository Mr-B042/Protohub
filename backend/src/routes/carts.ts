import { Router } from "express";
import { z } from "zod";
import { notifyNewAbandonedCart } from "../lib/cart-notifications.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendCartAssignedSms } from "../lib/sms.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/carts ───────────────────────────────────────
router.get("/", async (req, res) => {
  let query = supabase
    .from("abandoned_carts")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  // Sales Reps only see carts assigned to them
  if (req.user!.role === "Sales Rep") {
    query = query.eq("assigned_rep_id", req.user!.id);
  }
  const { data, error } = await query;
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

  const { data: existingOrder } = await supabase
    .from("orders")
    .select("id")
    .eq("org_id", req.user!.orgId)
    .eq("source_cart_id", d.id)
    .maybeSingle();

  if (existingOrder) {
    if (existing && existing.status !== "Converted") {
      await supabase
        .from("abandoned_carts")
        .update({ status: "Converted", last_activity: new Date().toISOString() })
        .eq("id", d.id)
        .eq("org_id", req.user!.orgId);
    }
    res.status(200).json({ id: d.id, ignored: true, converted: true, orderId: existingOrder.id });
    return;
  }

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
  void notifyNewAbandonedCart(req.user!.orgId, {
    id: data.id,
    customer: data.customer ?? "Partial lead",
    phone: data.phone,
    product_name: data.product_name ?? "your requested item",
    package_name: data.package_name ?? null,
    amount: Number(data.amount ?? 0),
    currency: data.currency ?? "NGN",
    source: data.source ?? "Website"
  });
  res.status(201).json(data);
});

// ── PATCH /api/carts/:id ─────────────────────────────────
// Update status, assigned rep, etc.
//
// Accepts both snake_case (assigned_rep_id) and camelCase (assignedRepId).
// The frontend hydrates carts as camelCase via the snake→camel normalizer,
// so callers naturally hold camelCase ids — making the schema accept both
// avoids a class of "patch silently noop'd" bugs.
const CartPatchSchema = z.object({
  status:          z.enum(["Open abandoned", "Assigned", "Contacted", "Converted", "Lost"]).optional(),
  assigned_rep_id: z.string().uuid().optional().nullable(),
  assignedRepId:   z.string().uuid().optional().nullable(),
  last_activity:   z.string().optional(),
  lastActivity:    z.string().optional()
}).strict();

router.patch("/:id",
  requireRole("Owner", "Admin", "Sales Rep"),
  async (req, res) => {
    const parsed = CartPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const updates: Record<string, unknown> = {};
    const { data: existing, error: existingError } = await supabase
      .from("abandoned_carts")
      .select("id, customer, phone, product_name, package_name, amount, currency, assigned_rep_id, status")
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .single();
    if (existingError || !existing) {
      res.status(404).json({ error: "Cart not found." });
      return;
    }
    if (parsed.data.status !== undefined) updates.status = parsed.data.status;
    const repId = parsed.data.assigned_rep_id ?? parsed.data.assignedRepId;
    if (repId !== undefined) {
      // Validate assigned rep belongs to this org
      if (repId) {
        const { data: repCheck } = await supabase
          .from("users").select("id").eq("id", repId).eq("org_id", req.user!.orgId).single();
        if (!repCheck) {
          res.status(400).json({ error: "Rep not found in your organization." });
          return;
        }
      }
      updates.assigned_rep_id = repId;
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

    const repChanged = repId !== undefined && repId && repId !== existing.assigned_rep_id;
    const newlyAssigned = data.status === "Assigned" || updates.status === "Assigned";
    if (repChanged && newlyAssigned && data.phone?.trim()) {
      void sendCartAssignedSms(req.user!.orgId, {
        id: data.id,
        customer: data.customer ?? "Customer",
        phone: data.phone,
        product_name: data.product_name ?? "your requested item",
        package_name: data.package_name ?? null,
        amount: Number(data.amount ?? 0),
        currency: data.currency ?? "NGN",
        assignedRepId: data.assigned_rep_id ?? null
      });
    }

    res.json(data);
  }
);

// ── DELETE /api/carts/:id ────────────────────────────────
// Permanent cleanup for abandoned carts. Owner/Admin only so reps cannot
// erase lead history from the pipeline.
router.delete("/:id",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const { error } = await supabase
      .from("abandoned_carts")
      .delete()
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(204).send();
  }
);

export default router;
