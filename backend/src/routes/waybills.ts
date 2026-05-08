import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

/** Upsert a linked expense for a waybill's fee. Idempotent — updates if exists, inserts if not. */
async function syncWaybillExpense(
  orgId: string,
  waybill: { id: string; waybill_fee: number; product_name: string; quantity: number; from_location?: string | null; to_location?: string | null; dispatched_date?: string | null }
) {
  if (waybill.waybill_fee <= 0) {
    // Fee is zero — remove any linked expense
    await supabase.from("expenses").delete().eq("waybill_id", waybill.id);
    return;
  }
  const route = [waybill.from_location, waybill.to_location].filter(Boolean).join(" → ") || "—";
  const description = `Waybill #${waybill.id} — ${route} — ${waybill.product_name} x${waybill.quantity}`;
  const date = waybill.dispatched_date ?? new Date().toISOString().split("T")[0];

  // Check if linked expense already exists
  const { data: existing } = await supabase
    .from("expenses").select("id").eq("waybill_id", waybill.id).single();

  if (existing) {
    await supabase.from("expenses").update({
      amount: waybill.waybill_fee, description, date
    }).eq("id", existing.id);
  } else {
    await supabase.from("expenses").insert({
      id:          `EXP-WB-${Date.now()}`,
      org_id:      orgId,
      date,
      category:    "Waybill",
      description,
      amount:      waybill.waybill_fee,
      currency:    "NGN",
      waybill_id:  waybill.id
    });
  }
}

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("waybill_records")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

const WaybillSchema = z.object({
  id:             z.string().min(1),
  productId:      z.string().uuid().optional(),
  productName:    z.string().min(1),
  quantity:       z.number().int().min(1),
  waybillFee:     z.number().min(0).default(0),
  fromLocation:   z.string().optional(),
  toLocation:     z.string().optional(),
  carrier:        z.string().optional(),
  trackingNumber: z.string().optional(),
  agentId:        z.string().uuid().optional(),
  notes:          z.string().optional(),
  dispatchedDate: z.string().optional()
});

router.post("/",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = WaybillSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const d = parsed.data;
    const { data, error } = await supabase
      .from("waybill_records")
      .insert({
        id: d.id, org_id: req.user!.orgId, product_id: d.productId,
        product_name: d.productName, quantity: d.quantity, waybill_fee: d.waybillFee,
        from_location: d.fromLocation, to_location: d.toLocation, carrier: d.carrier,
        tracking_number: d.trackingNumber, agent_id: d.agentId, notes: d.notes,
        dispatched_date: d.dispatchedDate, status: "In Transit"
      })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Auto-create linked expense for waybill fee
    if (d.waybillFee > 0) {
      await syncWaybillExpense(req.user!.orgId, {
        id: d.id, waybill_fee: d.waybillFee, product_name: d.productName,
        quantity: d.quantity, from_location: d.fromLocation, to_location: d.toLocation,
        dispatched_date: d.dispatchedDate
      });
    }

    // Auto-log "Waybill Out" stock movement
    if (d.productId) {
      const { data: product } = await supabase
        .from("products").select("warehouse_stock").eq("id", d.productId).single();
      await supabase.from("stock_movements").insert({
        id:            `MOV-${randomUUID()}`,
        org_id:        req.user!.orgId,
        product_id:    d.productId,
        product_name:  d.productName,
        type:          "Waybill Out",
        qty:           d.quantity,
        balance_after: product?.warehouse_stock ?? 0,
        agent_id:      d.agentId ?? null,
        by_name:       req.user!.name,
        by_user_id:    req.user!.id,
        waybill_id:    d.id,
        from_location: d.fromLocation ?? null,
        to_location:   d.toLocation ?? null,
        note:          `Waybill ${d.id} dispatched${d.carrier ? ` via ${d.carrier}` : ""}`
      });
    }

    res.status(201).json(data);
  }
);

// ── PATCH /api/waybills/:id ───────────────────────────────
const WaybillPatchSchema = z.object({
  waybill_fee:     z.number().min(0).optional(),
  carrier:         z.string().max(120).optional(),
  to_location:     z.string().max(120).optional(),
  from_location:   z.string().max(120).optional(),
  agent_id:        z.string().uuid().nullable().optional(),
  dispatched_date: z.string().optional(),
  notes:           z.string().max(500).nullable().optional(),
  tracking_number: z.string().max(120).optional()
}).strict();

router.patch("/:id",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = WaybillPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const updates: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed.data)) {
      if (val !== undefined) updates[key] = val;
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update." });
      return;
    }
    const { data, error } = await supabase
      .from("waybill_records")
      .update(updates)
      .eq("id", req.params.id).eq("org_id", req.user!.orgId)
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "Waybill not found." }); return; }

    // Sync linked expense if fee was touched
    if (req.body.waybill_fee !== undefined) {
      await syncWaybillExpense(req.user!.orgId, {
        id: data.id, waybill_fee: data.waybill_fee, product_name: data.product_name,
        quantity: data.quantity, from_location: data.from_location, to_location: data.to_location,
        dispatched_date: data.dispatched_date
      });
    }

    res.json(data);
  }
);

const WaybillStatusSchema = z.object({
  status:       z.enum(["In Transit", "Received", "Returned", "Cancelled", "Defective", "Missing"]),
  receivedDate: z.string().optional(),
  notes:        z.string().max(500).optional()
}).strict();

router.patch("/:id/status",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = WaybillStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { status, receivedDate, notes } = parsed.data;
    const updates: Record<string, unknown> = { status };
    if (status === "Received" && receivedDate) updates.received_date = receivedDate;
    if (notes !== undefined) updates.notes = notes;
    const { data, error } = await supabase
      .from("waybill_records")
      .update(updates)
      .eq("id", req.params.id).eq("org_id", req.user!.orgId)
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Auto-log stock movement for terminal statuses
    if (data && data.product_id && ["Received", "Returned", "Defective", "Missing"].includes(status)) {
      const movType = status === "Received" ? "Waybill In"
        : status === "Returned" ? "Waybill In"
        : "Correction";
      const { data: product } = await supabase
        .from("products").select("warehouse_stock").eq("id", data.product_id).single();
      await supabase.from("stock_movements").insert({
        id:            `MOV-${randomUUID()}`,
        org_id:        req.user!.orgId,
        product_id:    data.product_id,
        product_name:  data.product_name,
        type:          movType,
        qty:           data.quantity,
        balance_after: product?.warehouse_stock ?? 0,
        agent_id:      data.agent_id ?? null,
        by_name:       req.user!.name,
        by_user_id:    req.user!.id,
        waybill_id:    data.id,
        from_location: data.from_location ?? null,
        to_location:   data.to_location ?? null,
        note:          `Waybill ${data.id} marked ${status}${notes ? ` — ${notes}` : ""}`
      });
    }

    res.json(data);
  }
);

export default router;
