import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin"));

// ── GET /api/penalties ───────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("rep_penalties")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/penalties ──────────────────────────────────
const PenaltySchema = z.object({
  repId:            z.string().uuid(),
  repName:          z.string().min(1),
  type:             z.string().min(1),
  amount:           z.number().min(0).default(0),
  removeAllBonuses: z.boolean().default(false),
  orderId:          z.string().optional(),
  reason:           z.string().optional(),
  byName:           z.string().optional()
});

router.post("/", async (req, res) => {
  const parsed = PenaltySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;
  const { data, error } = await supabase
    .from("rep_penalties")
    .insert({
      org_id: req.user!.orgId,
      rep_id: d.repId,
      rep_name: d.repName,
      type: d.type,
      amount: d.amount,
      remove_all_bonuses: d.removeAllBonuses,
      order_id: d.orderId ?? null,
      reason: d.reason ?? null,
      by_name: d.byName ?? req.user!.name
    })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// ── DELETE /api/penalties/:id ────────────────────────────
router.delete("/:id", async (req, res) => {
  const { error } = await supabase
    .from("rep_penalties")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
