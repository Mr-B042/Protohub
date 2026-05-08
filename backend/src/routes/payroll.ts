import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendToUser } from "../lib/mailer.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin"));

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// Generate a payroll run for a given period
const PayrollSchema = z.object({
  period: z.string().min(1)    // e.g. "May 2026"
});

router.post("/generate", async (req, res) => {
  const parsed = PayrollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { period } = parsed.data;
  const orgId = req.user!.orgId;

  // Fetch all Sales Reps in the org
  const { data: reps } = await supabase
    .from("users")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("role", "Sales Rep")
    .eq("active", true);

  // Fetch pay structures
  const { data: structures } = await supabase
    .from("pay_structures")
    .select("*")
    .eq("org_id", orgId);

  // Count delivered orders per rep for the period (e.g. "May 2026")
  // Parse "Month Year" into a proper date range
  const periodDate = new Date(`${period} 1`);
  const periodStart = `${periodDate.getFullYear()}-${String(periodDate.getMonth() + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 1);
  const periodEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;

  const { data: orders } = await supabase
    .from("orders")
    .select("assigned_rep_id, amount")
    .eq("org_id", orgId)
    .eq("status", "Delivered")
    .gte("delivered_date", periodStart)
    .lt("delivered_date", periodEnd);

  const entries = (reps ?? []).map((rep) => {
    const repOrders  = (orders ?? []).filter((o) => o.assigned_rep_id === rep.id);
    const delivered  = repOrders.length;
    const structure  = (structures ?? []).find((s) => s.user_id === rep.id);
    const type       = structure?.type ?? "Per Delivered Order";
    const fixed      = type === "Per Delivered Order" ? 0 : Number(structure?.fixed_salary ?? 0);
    const rate       = Number(structure?.commission_pct ?? 0); // stores flat rate per order
    const commission = (type === "Per Delivered Order" || type === "Hybrid") ? rate * delivered : 0;

    // Performance tier bonus: highest matching tier
    let tierBonus = 0;
    if (type === "Performance Bonus" && Array.isArray(structure?.bonus_tiers)) {
      const matched = (structure.bonus_tiers as { threshold: number; amount: number }[])
        .filter((t) => delivered >= t.threshold)
        .sort((a, b) => b.threshold - a.threshold);
      tierBonus = matched[0]?.amount ?? 0;
    }

    const total = Math.max(0, fixed + commission + tierBonus);
    return { userId: rep.id, name: rep.name, delivered, fixedSalary: fixed, commission, autoBonus: tierBonus, total };
  });

  const { data: run, error } = await supabase
    .from("payroll_runs")
    .insert({ org_id: orgId, period, entries, status: "Draft" })
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(run);
});

router.patch("/:id/approve", async (req, res) => {
  const { data, error } = await supabase
    .from("payroll_runs")
    .update({ status: "Approved", approved_at: new Date().toISOString() })
    .eq("id", req.params.id).eq("org_id", req.user!.orgId)
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }

  // Fire-and-forget: notify each rep their payroll was approved
  if (data?.entries && Array.isArray(data.entries)) {
    for (const entry of data.entries as { userId: string; name: string; total: number }[]) {
      sendToUser(req.user!.orgId, entry.userId, "payroll_approved", {
        period: data.period,
        name:   entry.name,
        amount: String(entry.total),
        currency: ""
      });
    }
  }

  res.json(data);
});

router.patch("/:id/mark-paid", async (req, res) => {
  const { data, error } = await supabase
    .from("payroll_runs")
    .update({ status: "Paid" })
    .eq("id", req.params.id).eq("org_id", req.user!.orgId)
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

export default router;
