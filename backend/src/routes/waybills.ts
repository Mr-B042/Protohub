import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

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
    res.status(201).json(data);
  }
);

router.patch("/:id/status",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const { status, receivedDate } = req.body;
    const valid = ["In Transit", "Received", "Returned", "Cancelled"];
    if (!valid.includes(status)) {
      res.status(400).json({ error: `Status must be one of: ${valid.join(", ")}` });
      return;
    }
    const updates: Record<string, unknown> = { status };
    if (status === "Received" && receivedDate) updates.received_date = receivedDate;
    const { data, error } = await supabase
      .from("waybill_records")
      .update(updates)
      .eq("id", req.params.id).eq("org_id", req.user!.orgId)
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  }
);

export default router;
