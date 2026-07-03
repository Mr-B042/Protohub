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

// A week's amount lands as ONE lump on its Sunday, which reads as a shock on
// any DAILY expense/profit view (₦0 for six days, then a spike). Smoothed
// instead across the 4 WORKING days of that week — Monday through Thursday —
// a quarter of the week's amount each day. Friday, Saturday, and the week's
// own Sunday anchor carry none.
const WEEKDAY_SPREAD_LABELS = ["Mon", "Tue", "Wed", "Thu"] as const;
function weekdaySpreadDates(monthKey: string, week: number): string[] {
  const sunday = weekStartsForMonth(monthKey)[week - 1];
  const [y, m, d] = sunday.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m || 1) - 1, d, 12));
  return [1, 2, 3, 4].map((offset) => {
    const dt = new Date(base);
    dt.setUTCDate(dt.getUTCDate() + offset);
    return dt.toISOString().slice(0, 10);
  });
}
const weekdaySpreadIds = (monthKey: string, week: number) => [1, 2, 3, 4].map((d) => `SAL-WEEKLY-${monthKey}-W${week}-D${d}`);

router.post("/spread-weekly-salary", async (req, res) => {
  const week = Number(req.body?.week);
  if (![1, 2, 3, 4].includes(week)) { res.status(400).json({ error: "week must be 1, 2, 3, or 4." }); return; }
  const monthKey = salaryMonthKey(req.body?.month);
  const orgId = req.user!.orgId;
  const ids = weekdaySpreadIds(monthKey, week);
  const dayDates = weekdaySpreadDates(monthKey, week);

  const { data: existingRows } = await supabase.from("expenses").select("id, amount").eq("org_id", orgId).in("id", ids);
  const existingById = new Map((existingRows ?? []).map((r: any) => [r.id as string, Number(r.amount)]));
  if (existingById.size === 4) {
    const amount = ids.reduce((s, i) => s + (existingById.get(i) ?? 0), 0);
    res.json({ status: "already_spread", ids, amount, dailyAmount: Math.round(amount / 4), dayDates, monthKey, week });
    return;
  }

  // Computed fresh from the CURRENTLY active payroll every time a NOT-yet-spread
  // week is clicked — not locked to whatever an earlier week in this month
  // used. Deliberate: hiring a new salaried staffer (or changing someone's pay)
  // mid-month should be covered starting from the next week you spread, not
  // wait until next month.
  const total = await totalMonthlySalary(orgId);
  if (total <= 0) { res.status(400).json({ error: "No active users have a monthly salary set in their pay structure." }); return; }
  const dailyAmount = Math.round(Math.round(total / 4) / 4);

  // Insert only the days not already recorded — idempotent completion if a
  // prior attempt partially failed, rather than duplicating or erroring.
  for (let i = 0; i < 4; i++) {
    if (existingById.has(ids[i])) continue;
    const { error } = await supabase.from("expenses").insert({
      id: ids[i], org_id: orgId, date: dayDates[i], category: "Salary",
      description: `Weekly salary spread · Week ${week}, ${WEEKDAY_SPREAD_LABELS[i]} · ${salaryMonthLabel(monthKey)}`,
      amount: dailyAmount, currency: "NGN", paid_by: req.user!.name
    });
    if (error) { res.status(500).json({ error: error.message }); return; }
  }
  res.status(201).json({ status: "spread", ids, amount: dailyAmount * 4, dailyAmount, dayDates, monthKey, week });
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
