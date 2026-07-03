import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendToUser } from "../lib/mailer.js";
import { calculatePayrollPreview, payrollPeriodKey } from "../lib/payroll-calculator.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin"));

router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json((data ?? []).map((run) => {
    const entries = Array.isArray(run.entries) ? run.entries : [];
    const total = entries.reduce((sum: number, entry: unknown) => sum + Number((entry as Record<string, unknown>).total ?? 0), 0);
    return {
      ...run,
      rows: entries,
      total
    };
  }));
});

// Generate a payroll run for a given period
const PayrollSchema = z.object({
  period: z.string().min(1),    // e.g. "May 2026" or "2026-05"
  label: z.string().optional(),
  notes: z.string().optional()
});

router.post("/preview", async (req, res) => {
  const parsed = PayrollSchema.pick({ period: true }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const preview = await calculatePayrollPreview(req.user!.orgId, parsed.data.period);
    res.json(preview);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to calculate payroll preview." });
  }
});

router.post("/generate", async (req, res) => {
  const parsed = PayrollSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { period, label, notes } = parsed.data;
  const orgId = req.user!.orgId;

  // Guard against duplicate runs for the same period, even if one side used YYYY-MM.
  const normalizedPeriodKey = payrollPeriodKey(period);
  const { data: existingRuns, error: existingError } = await supabase
    .from("payroll_runs")
    .select("id, period")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });
  if (existingError) {
    res.status(500).json({ error: existingError.message });
    return;
  }
  const existingRun = (existingRuns ?? []).find((run) =>
    normalizedPeriodKey ? payrollPeriodKey(run.period ?? "") === normalizedPeriodKey : run.period === period
  );
  if (existingRun) {
    res.status(409).json({ error: `A payroll run for "${period}" already exists.` });
    return;
  }

  let preview;
  try {
    preview = await calculatePayrollPreview(orgId, period);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Failed to calculate payroll." });
    return;
  }

  const { data: run, error } = await supabase
    .from("payroll_runs")
    .insert({
      org_id: orgId,
      period,
      label: label ?? period,
      notes: notes ?? "",
      entries: preview.rows,
      top_performer: preview.topPerformer ?? null,
      status: "Draft"
    })
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({
    ...run,
    label: label ?? period,
    notes: notes ?? "",
    rows: preview.rows,
    total: preview.total,
    topPerformer: preview.topPerformer
  });
});

router.patch("/:id/approve", async (req, res) => {
  const { data, error } = await supabase
    .from("payroll_runs")
    .update({ status: "Approved", approved_at: new Date().toISOString() })
    .eq("id", req.params.id).eq("org_id", req.user!.orgId)
    .select().single();
  if (error) {
    if (error.code === "PGRST116") { res.status(404).json({ error: "Payroll run not found." }); return; }
    res.status(500).json({ error: error.message }); return;
  }

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

// ── Salary → monthly expense ──────────────────────────────────────────────
// Record a user's monthly salary as a Salary expense so it flows into the P&L /
// net profit (previously salaries were never tracked as expenses). The expense id
// is deterministic — SAL-<userId>-<YYYY-MM> — so paying the same user for the same
// month twice is a no-op (idempotent), no schema change needed.
const salaryMonthKey = (input?: unknown): string => {
  if (typeof input === "string" && /^\d{4}-\d{2}$/.test(input)) return input;
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 7); // Lagos (UTC+1) month
};
const salaryMonthLabel = (monthKey: string): string =>
  new Date(`${monthKey}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function recordSalaryExpense(
  orgId: string, paidByName: string,
  user: { id: string; name: string }, fixedSalary: number, monthKey: string
): Promise<{ status: "paid" | "already_paid"; id: string; amount: number }> {
  const id = `SAL-${user.id}-${monthKey}`;
  const { data: existing } = await supabase.from("expenses").select("id").eq("id", id).maybeSingle();
  if (existing) return { status: "already_paid", id, amount: fixedSalary };
  // Date the expense on the LAST DAY of the month it's for — so back-paying (e.g.
  // June salary recorded in July) lands in June's P&L, not the month you clicked.
  const [y, m] = monthKey.split("-").map(Number);
  const expenseDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const { error } = await supabase.from("expenses").insert({
    id, org_id: orgId, date: expenseDate, category: "Salary",
    description: `Monthly salary · ${user.name} · ${salaryMonthLabel(monthKey)}`,
    amount: fixedSalary, currency: "NGN", paid_by: paidByName
  });
  if (error) throw new Error(error.message);
  return { status: "paid", id, amount: fixedSalary };
}

const salariedFixed = (structure: { type?: string | null; fixed_salary?: number | null } | null | undefined): number =>
  structure && structure.type !== "Per Delivered Order" ? Number(structure.fixed_salary ?? 0) : 0;

router.post("/pay-salary", async (req, res) => {
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const monthKey = salaryMonthKey(req.body?.month);
  if (!userId) { res.status(400).json({ error: "userId is required." }); return; }
  const orgId = req.user!.orgId;
  const [{ data: user }, { data: structure }] = await Promise.all([
    supabase.from("users").select("id, name, active").eq("org_id", orgId).eq("id", userId).maybeSingle(),
    supabase.from("pay_structures").select("type, fixed_salary").eq("org_id", orgId).eq("user_id", userId).maybeSingle()
  ]);
  if (!user) { res.status(404).json({ error: "User not found." }); return; }
  if (!user.active) { res.status(400).json({ error: "User is not active." }); return; }
  const fixedSalary = salariedFixed(structure);
  if (fixedSalary <= 0) { res.status(400).json({ error: "This user has no monthly salary set in their pay structure." }); return; }
  try {
    const result = await recordSalaryExpense(orgId, req.user!.name, { id: user.id, name: user.name }, fixedSalary, monthKey);
    res.status(result.status === "paid" ? 201 : 200).json({ ...result, monthKey, userId });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

router.post("/pay-all-salaries", async (req, res) => {
  const monthKey = salaryMonthKey(req.body?.month);
  const orgId = req.user!.orgId;
  const [{ data: users }, { data: structures }] = await Promise.all([
    supabase.from("users").select("id, name").eq("org_id", orgId).eq("active", true),
    supabase.from("pay_structures").select("user_id, type, fixed_salary").eq("org_id", orgId)
  ]);
  const structByUser = new Map((structures ?? []).map((s: any) => [s.user_id, s]));
  let paid = 0, skipped = 0, totalAmount = 0;
  const errors: string[] = [];
  for (const u of (users ?? []) as { id: string; name: string }[]) {
    const fixedSalary = salariedFixed(structByUser.get(u.id));
    if (fixedSalary <= 0) continue;
    try {
      const result = await recordSalaryExpense(orgId, req.user!.name, u, fixedSalary, monthKey);
      if (result.status === "paid") { paid++; totalAmount += fixedSalary; } else skipped++;
    } catch (e: any) { errors.push(`${u.name}: ${e.message}`); }
  }
  res.json({ paid, skipped, totalAmount, monthKey, errors });
});

router.patch("/:id/mark-paid", async (req, res) => {
  const { data, error } = await supabase
    .from("payroll_runs")
    .update({ status: "Paid" })
    .eq("id", req.params.id).eq("org_id", req.user!.orgId)
    .select().single();
  if (error) {
    if (error.code === "PGRST116") { res.status(404).json({ error: "Payroll run not found." }); return; }
    res.status(500).json({ error: error.message }); return;
  }
  res.json(data);
});

export default router;
