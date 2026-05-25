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
