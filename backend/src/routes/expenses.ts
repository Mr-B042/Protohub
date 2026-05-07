import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin"));

router.get("/", async (req, res) => {
  const { from, to } = req.query;
  let query = supabase
    .from("expenses")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("date", { ascending: false });
  if (from) query = query.gte("date", from as string);
  if (to)   query = query.lte("date", to as string);
  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

const ExpenseSchema = z.object({
  id:          z.string().min(1),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category:    z.string().min(1),
  description: z.string().optional(),
  amount:      z.number().min(0),
  currency:    z.enum(["NGN", "USD", "GBP"]).default("NGN"),
  paidBy:      z.string().optional(),
  productId:   z.string().optional()
});

router.post("/", async (req, res) => {
  const parsed = ExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;
  // Upsert by id so callers (e.g. order delivery-fee sync, waybill creation)
  // can call this repeatedly with the same id when state changes — category
  // and amount get updated instead of failing on duplicate key.
  const { data, error } = await supabase
    .from("expenses")
    .upsert(
      { id: d.id, org_id: req.user!.orgId, date: d.date, category: d.category, description: d.description, amount: d.amount, currency: d.currency, paid_by: d.paidBy, product_id: d.productId ?? null },
      { onConflict: "id" }
    )
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

router.delete("/:id", async (req, res) => {
  const { error } = await supabase
    .from("expenses").delete()
    .eq("id", req.params.id).eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
