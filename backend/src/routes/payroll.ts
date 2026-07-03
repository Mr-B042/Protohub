import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendToUser } from "../lib/mailer.js";
import { calculatePayrollPreview, payrollPeriodKey } from "../lib/payroll-calculator.js";
import {
  elapsedDayIndices, lagosTodayKey, salaryMonthKey, salaryMonthLabel, totalMonthlySalary,
  weekdaySpreadDates, weekdaySpreadIds, WEEKDAY_SPREAD_LABELS
} from "../lib/salary-spread.js";

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

// ── Salary → weekly-spread, daily-drip expense ────────────────────────────
// See backend/src/lib/salary-spread.ts for the full model. In short: clicking
// "Spread Week N" is the manual on/off switch — it catches up any days of
// that week which have already elapsed (Mon..today), but never writes a
// FUTURE day. Once Monday exists, the daily cron
// (dropDueDailySalaryForAllOrgs) takes over and drops Tue/Wed/Thu
// automatically, one per day, on that actual day.
router.post("/spread-weekly-salary", async (req, res) => {
  const week = Number(req.body?.week);
  if (![1, 2, 3, 4].includes(week)) { res.status(400).json({ error: "week must be 1, 2, 3, or 4." }); return; }
  const monthKey = salaryMonthKey(req.body?.month);
  const orgId = req.user!.orgId;
  const ids = weekdaySpreadIds(monthKey, week);
  const dayDates = weekdaySpreadDates(monthKey, week);
  const todayKey = lagosTodayKey();

  const { data: existingRows } = await supabase.from("expenses").select("id, amount").eq("org_id", orgId).in("id", ids);
  const existingById = new Map((existingRows ?? []).map((r: any) => [r.id as string, Number(r.amount)]));
  if (existingById.size === 4) {
    const amount = ids.reduce((s, i) => s + (existingById.get(i) ?? 0), 0);
    res.json({ status: "already_spread", ids, amount, dailyAmount: Math.round(amount / 4), dayDates, monthKey, week });
    return;
  }

  const elapsed = elapsedDayIndices(dayDates, todayKey);
  if (elapsed.length === 0) {
    res.status(400).json({ error: `Week ${week} hasn't started yet — it begins ${dayDates[0]}.` });
    return;
  }

  // Computed fresh from the CURRENTLY active payroll every time a catch-up
  // click happens — not locked to whatever an earlier week in this month
  // used. Deliberate: hiring a new salaried staffer (or changing someone's pay)
  // mid-month should be covered starting from the next day/week you spread,
  // not wait until next month.
  const total = await totalMonthlySalary(orgId);
  if (total <= 0) { res.status(400).json({ error: "No active users have a monthly salary set in their pay structure." }); return; }
  const dailyAmount = Math.round(Math.round(total / 4) / 4);

  // Insert only the elapsed days not already recorded — never a future day
  // (the cron drops those on their own date), and idempotent completion if a
  // prior attempt partially failed.
  let created = 0;
  for (const i of elapsed) {
    if (existingById.has(ids[i])) continue;
    const { error } = await supabase.from("expenses").insert({
      id: ids[i], org_id: orgId, date: dayDates[i], category: "Salary",
      description: `Weekly salary spread · Week ${week}, ${WEEKDAY_SPREAD_LABELS[i]} · ${salaryMonthLabel(monthKey)}`,
      amount: dailyAmount, currency: "NGN", paid_by: req.user!.name
    });
    if (error) { res.status(500).json({ error: error.message }); return; }
    created++;
  }
  res.status(201).json({ status: "spread", ids, dailyAmount, created, dayDates, monthKey, week });
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
