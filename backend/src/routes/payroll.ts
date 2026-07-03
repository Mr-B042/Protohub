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

// ── Salary → weekly-spread expense ────────────────────────────────────────
// Salary is a MONTHLY cost but the business closes out profit WEEKLY (same
// cadence ad spend is entered at) — a single end-of-month lump meant salary
// never showed up in a given week's break-even/net-profit view except the one
// week it happened to land in. Instead, the company's total monthly salary
// (sum of every active user's fixed_salary) is split into 4 equal weekly
// slices, each recorded as its own Salary expense dated the first day (Sunday)
// of that week — so it counts toward weekly fixed costs exactly like Ad Spend
// already does, every week, not just the pay week.
const salaryMonthKey = (input?: unknown): string => {
  if (typeof input === "string" && /^\d{4}-\d{2}$/.test(input)) return input;
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 7); // Lagos (UTC+1) month
};
const salaryMonthLabel = (monthKey: string): string =>
  new Date(`${monthKey}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

const salariedFixed = (structure: { type?: string | null; fixed_salary?: number | null } | null | undefined): number =>
  structure && structure.type !== "Per Delivered Order" ? Number(structure.fixed_salary ?? 0) : 0;

async function totalMonthlySalary(orgId: string): Promise<number> {
  const [{ data: users }, { data: structures }] = await Promise.all([
    supabase.from("users").select("id").eq("org_id", orgId).eq("active", true),
    supabase.from("pay_structures").select("user_id, type, fixed_salary").eq("org_id", orgId)
  ]);
  const activeIds = new Set((users ?? []).map((u: any) => u.id as string));
  return (structures ?? [])
    .filter((s: any) => activeIds.has(s.user_id))
    .reduce((sum: number, s: any) => sum + salariedFixed(s), 0);
}

// 4 consecutive Sunday-anchored weeks covering "the month" — week 1 starts on
// the Sunday on/before the 1st, so dating an expense there lands inside the
// same Sun–Sat week bucket the rest of Finance/break-even already use.
function weekStartsForMonth(monthKey: string): string[] {
  const [y, m] = monthKey.split("-").map(Number);
  const firstOfMonth = new Date(Date.UTC(y, (m || 1) - 1, 1, 12));
  const week1Start = new Date(firstOfMonth);
  week1Start.setUTCDate(week1Start.getUTCDate() - firstOfMonth.getUTCDay());
  return [0, 1, 2, 3].map((i) => {
    const d = new Date(week1Start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });
}

// Once ANY week of a month has been spread, its amount is LOCKED for the whole
// month — every other week (already spread or not yet) reuses that exact
// figure instead of recomputing from the live payroll total. Otherwise hiring
// a new staffer or changing someone's salary mid-month would silently shift
// the weeks spread afterward away from the weeks already spread, breaking the
// "spread evenly" guarantee. Only the FIRST week spread for a month computes
// fresh from totalMonthlySalary(); every subsequent week just copies it.
async function lockedWeeklySalaryAmount(orgId: string, monthKey: string): Promise<number | null> {
  const ids = [1, 2, 3, 4].map((w) => `SAL-WEEKLY-${monthKey}-W${w}`);
  const { data } = await supabase.from("expenses").select("amount").eq("org_id", orgId).in("id", ids).limit(1);
  return data && data.length > 0 ? Number(data[0].amount) : null;
}

router.post("/spread-weekly-salary", async (req, res) => {
  const week = Number(req.body?.week);
  if (![1, 2, 3, 4].includes(week)) { res.status(400).json({ error: "week must be 1, 2, 3, or 4." }); return; }
  const monthKey = salaryMonthKey(req.body?.month);
  const orgId = req.user!.orgId;
  const id = `SAL-WEEKLY-${monthKey}-W${week}`;
  const weekStart = weekStartsForMonth(monthKey)[week - 1];

  const { data: existing } = await supabase.from("expenses").select("id, amount").eq("id", id).maybeSingle();
  if (existing) { res.json({ status: "already_spread", id, amount: Number(existing.amount), weekStart, monthKey, week }); return; }

  let amount = await lockedWeeklySalaryAmount(orgId, monthKey);
  if (amount == null) {
    const total = await totalMonthlySalary(orgId);
    if (total <= 0) { res.status(400).json({ error: "No active users have a monthly salary set in their pay structure." }); return; }
    amount = Math.round(total / 4);
  }

  const { error } = await supabase.from("expenses").insert({
    id, org_id: orgId, date: weekStart, category: "Salary",
    description: `Weekly salary spread · Week ${week} · ${salaryMonthLabel(monthKey)}`,
    amount, currency: "NGN", paid_by: req.user!.name
  });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ status: "spread", id, amount, weekStart, monthKey, week });
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
