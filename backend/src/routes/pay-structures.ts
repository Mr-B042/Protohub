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
const BonusTierSchema = z.object({
  threshold: z.number().int().min(1),
  amount:    z.number().min(0)
});

const PayStructureSchema = z.object({
  userId:         z.string().uuid(),
  type:           z.enum(["Per Delivered Order", "Fixed Salary", "Hybrid", "Performance Bonus"]),
  fixedSalary:    z.number().min(0).default(0),
  commissionRate: z.number().min(0).default(0),
  bonusTiers:     z.array(BonusTierSchema).default([])
});

router.post("/", async (req, res) => {
  const parsed = PayStructureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { userId, type, fixedSalary, commissionRate, bonusTiers } = parsed.data;

  // Validate user belongs to this org
  const { data: userCheck } = await supabase.from("users").select("id").eq("id", userId).eq("org_id", req.user!.orgId).single();
  if (!userCheck) { res.status(400).json({ error: "User not found in your organization." }); return; }

  const { data, error } = await supabase
    .from("pay_structures")
    .upsert({
      org_id:         req.user!.orgId,
      user_id:        userId,
      type,
      fixed_salary:   fixedSalary,
      commission_pct: commissionRate,
      bonus_tiers:    bonusTiers,
      updated_at:     new Date().toISOString()
    }, { onConflict: "org_id,user_id" })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
