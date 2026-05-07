import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin"));

// ── GET /api/pay-structures ──────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("pay_structures")
    .select("*")
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/pay-structures ─────────────────────────────
// Upsert pay structure for a user
const PayStructureSchema = z.object({
  userId:         z.string().uuid(),
  type:           z.enum(["Commission", "Fixed Salary", "Fixed + Commission"]),
  fixedSalary:    z.number().min(0).default(0),
  commissionRate: z.number().min(0).default(0)
});

router.post("/", async (req, res) => {
  const parsed = PayStructureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { userId, type, fixedSalary, commissionRate } = parsed.data;

  const { data, error } = await supabase
    .from("pay_structures")
    .upsert({
      org_id:         req.user!.orgId,
      user_id:        userId,
      type,
      fixed_salary:   fixedSalary,
      commission_pct: commissionRate,
      updated_at:     new Date().toISOString()
    }, { onConflict: "org_id,user_id" })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
