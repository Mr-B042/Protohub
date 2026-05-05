import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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

  // Count delivered orders per rep for the period
  const { data: orders } = await supabase
    .from("orders")
    .select("assigned_rep_id, amount")
    .eq("org_id", orgId)
    .eq("status", "Delivered")
    .ilike("date", `%${period}%`);     // rough period match

  const entries = (reps ?? []).map((rep) => {
    const repOrders  = (orders ?? []).filter((o) => o.assigned_rep_id === rep.id);
    const delivered  = repOrders.length;
    const revenue    = repOrders.reduce((sum, o) => sum + Number(o.amount), 0);
    const structure  = (structures ?? []).find((s) => s.user_id === rep.id);
    const fixed      = structure?.fixed_salary ?? 0;
    const commPct    = structure?.commission_pct ?? 0;
    const commission = Math.round((revenue * commPct) / 100);
    return { userId: rep.id, name: rep.name, delivered, fixedSalary: fixed, commission, total: fixed + commission };
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
