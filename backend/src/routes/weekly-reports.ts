import { Router, type Request } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { addDaysToDateKey, sundayWeekStartForDateKey, lagosDateKey, weekEndFromStart } from "../lib/sales-bonus-engine.js";
import {
  CORRECTION_SECTIONS,
  canManagerAct,
  canOwnerAct,
  canRepSubmit,
  canSubmitToOwner,
  type CompanyReportStatus,
  type RepReportStatus
} from "../lib/weekly-report-workflow.js";

// Weekly Report approvals (Bright, 1 Oct 2026). See migration 269 and
// lib/weekly-report-workflow.ts for the rules.
//
// ⚠️ THE FIGURES ARE WORKED OUT IN THE BROWSER, the same maths as the Manager
// Dashboard's bonus table (buildManagerBonusRepRows). This route freezes what
// the rep submitted; the review pages recompute live and flag any difference.
// Bright chose that over moving the bonus maths to the server (1 Oct 2026).
const router = Router();
router.use(requireAuth);

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const REVIEWERS = ["Manager", "Admin"] as const;
const LEADERSHIP = ["Owner", "Manager", "Admin"] as const;
// A snapshot is a few hundred orders at most. Anything bigger is a mistake.
const MAX_SNAPSHOT_CHARS = 600_000;

const lagosDayStartIso = (dateKey: string) => new Date(`${dateKey}T00:00:00+01:00`).toISOString();
const lagosDayEndIso = (dateKey: string) => new Date(`${dateKey}T23:59:59.999+01:00`).toISOString();

const weekStartSchema = z.string().regex(DATE_KEY).refine(
  (value) => sundayWeekStartForDateKey(value) === value,
  { message: "The week must start on a Sunday." }
);

const snapshotSchema = z.record(z.string(), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= MAX_SNAPSHOT_CHARS,
  { message: "The report is too large to save." }
);

const correctionBodySchema = z.object({
  weekStart: weekStartSchema,
  section: z.enum(CORRECTION_SECTIONS as [string, ...string[]]),
  problem: z.string().trim().min(3, "Say what the problem is.").max(300),
  comment: z.string().trim().min(3, "Add a comment.").max(2000),
  orderRef: z.string().trim().max(60).optional()
});

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

const requireBranch = (req: Request) => {
  const branchId = req.user!.branchId;
  if (!branchId) throw httpError(400, "Open a branch first.");
  return branchId;
};

async function audit(req: Request, entry: {
  branchId: string;
  weekStart: string;
  action: string;
  repReportId?: string | null;
  companyReportId?: string | null;
  repId?: string | null;
  detail?: Record<string, unknown> | null;
}) {
  const { error } = await supabase.from("weekly_report_audit").insert({
    org_id: req.user!.orgId,
    branch_id: entry.branchId,
    week_start: entry.weekStart,
    rep_report_id: entry.repReportId ?? null,
    company_report_id: entry.companyReportId ?? null,
    rep_id: entry.repId ?? null,
    actor_id: req.user!.id,
    actor_name: req.user!.name ?? null,
    actor_role: req.user!.role,
    action: entry.action,
    detail: entry.detail ?? null
  });
  if (error) throw error;
}

const REP_COLUMNS = "id, rep_id, week_start, status, snapshot, rep_note, submit_count, submitted_at, manager_reviewed_by, manager_reviewed_at, owner_approved_by, owner_approved_at, locked_at, created_at, updated_at";
const COMPANY_COLUMNS = "id, week_start, status, manager_note, owner_note, company_snapshot, manager_bonus_snapshot, submit_count, submitted_by, submitted_at, locked_by, locked_at, reopened_by, reopened_at, reopen_reason, created_at, updated_at";
const CORRECTION_COLUMNS = "id, week_start, rep_report_id, company_report_id, kind, section, problem, comment, order_ref, raised_by, raised_by_name, raised_by_role, status, response, resolved_by, resolved_at, created_at";
const AUDIT_COLUMNS = "id, week_start, rep_report_id, company_report_id, rep_id, actor_id, actor_name, actor_role, action, detail, created_at";

const mapRep = (row: any) => row ? ({
  id: row.id,
  repId: row.rep_id,
  weekStart: row.week_start,
  status: row.status as RepReportStatus,
  snapshot: row.snapshot ?? null,
  repNote: row.rep_note ?? null,
  submitCount: Number(row.submit_count ?? 0),
  submittedAt: row.submitted_at ?? null,
  managerReviewedBy: row.manager_reviewed_by ?? null,
  managerReviewedAt: row.manager_reviewed_at ?? null,
  ownerApprovedBy: row.owner_approved_by ?? null,
  ownerApprovedAt: row.owner_approved_at ?? null,
  lockedAt: row.locked_at ?? null,
  updatedAt: row.updated_at ?? null
}) : null;

const mapCompany = (row: any) => row ? ({
  id: row.id,
  weekStart: row.week_start,
  status: row.status as CompanyReportStatus,
  managerNote: row.manager_note ?? null,
  ownerNote: row.owner_note ?? null,
  companySnapshot: row.company_snapshot ?? null,
  managerBonusSnapshot: row.manager_bonus_snapshot ?? null,
  submitCount: Number(row.submit_count ?? 0),
  submittedBy: row.submitted_by ?? null,
  submittedAt: row.submitted_at ?? null,
  lockedBy: row.locked_by ?? null,
  lockedAt: row.locked_at ?? null,
  reopenedBy: row.reopened_by ?? null,
  reopenedAt: row.reopened_at ?? null,
  reopenReason: row.reopen_reason ?? null
}) : null;

const mapCorrection = (row: any) => ({
  id: row.id,
  weekStart: row.week_start,
  repReportId: row.rep_report_id ?? null,
  companyReportId: row.company_report_id ?? null,
  kind: row.kind,
  section: row.section,
  problem: row.problem,
  comment: row.comment,
  orderRef: row.order_ref ?? null,
  raisedBy: row.raised_by ?? null,
  raisedByName: row.raised_by_name ?? null,
  raisedByRole: row.raised_by_role ?? null,
  status: row.status,
  response: row.response ?? null,
  resolvedBy: row.resolved_by ?? null,
  resolvedAt: row.resolved_at ?? null,
  createdAt: row.created_at
});

const mapAudit = (row: any) => ({
  id: row.id,
  weekStart: row.week_start,
  repReportId: row.rep_report_id ?? null,
  companyReportId: row.company_report_id ?? null,
  repId: row.rep_id ?? null,
  actorId: row.actor_id ?? null,
  actorName: row.actor_name ?? null,
  actorRole: row.actor_role ?? null,
  action: row.action,
  detail: row.detail ?? null,
  createdAt: row.created_at
});

async function loadRepReport(orgId: string, branchId: string, repId: string, weekStart: string) {
  const { data, error } = await supabase
    .from("rep_weekly_reports")
    .select(REP_COLUMNS)
    .eq("org_id", orgId)
    .eq("branch_id", branchId)
    .eq("rep_id", repId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadCompanyReport(orgId: string, branchId: string, weekStart: string) {
  const { data, error } = await supabase
    .from("company_weekly_reports")
    .select(COMPANY_COLUMNS)
    .eq("org_id", orgId)
    .eq("branch_id", branchId)
    .eq("week_start", weekStart)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureCompanyReport(orgId: string, branchId: string, weekStart: string) {
  const existing = await loadCompanyReport(orgId, branchId, weekStart);
  if (existing) return existing;
  const { data, error } = await supabase
    .from("company_weekly_reports")
    .upsert({ org_id: orgId, branch_id: branchId, week_start: weekStart }, { onConflict: "branch_id,week_start", ignoreDuplicates: true })
    .select(COMPANY_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ?? await loadCompanyReport(orgId, branchId, weekStart);
}

async function ensureRepReport(orgId: string, branchId: string, repId: string, weekStart: string) {
  const existing = await loadRepReport(orgId, branchId, repId, weekStart);
  if (existing) return existing;
  const { data, error } = await supabase
    .from("rep_weekly_reports")
    .upsert({ org_id: orgId, branch_id: branchId, rep_id: repId, week_start: weekStart }, { onConflict: "branch_id,rep_id,week_start", ignoreDuplicates: true })
    .select(REP_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ?? await loadRepReport(orgId, branchId, repId, weekStart);
}

/**
 * The reps whose report the week needs: active Sales Reps in this branch who
 * had at least one order placed or delivered that week. A rep with no orders
 * has nothing to report and must not block the week.
 */
async function expectedRepIdsForWeek(orgId: string, branchId: string, weekStart: string) {
  const weekEnd = weekEndFromStart(weekStart);
  const [{ data: members, error: membersError }, { data: reps, error: repsError }] = await Promise.all([
    supabase.from("branch_memberships").select("user_id").eq("branch_id", branchId),
    supabase.from("users").select("id").eq("org_id", orgId).eq("role", "Sales Rep").eq("active", true).eq("is_demo", false)
  ]);
  if (membersError) throw membersError;
  if (repsError) throw repsError;
  const memberIds = new Set((members ?? []).map((row: any) => row.user_id));
  const repIds = (reps ?? []).map((row: any) => row.id as string).filter((id) => memberIds.has(id));
  if (repIds.length === 0) return [];

  const [{ data: placed, error: placedError }, { data: delivered, error: deliveredError }] = await Promise.all([
    supabase.from("orders").select("assigned_rep_id")
      .eq("org_id", orgId).in("assigned_rep_id", repIds)
      .gte("created_at", lagosDayStartIso(weekStart)).lte("created_at", lagosDayEndIso(weekEnd))
      .limit(20000),
    supabase.from("orders").select("assigned_rep_id")
      .eq("org_id", orgId).in("assigned_rep_id", repIds)
      .gte("delivered_date", weekStart).lte("delivered_date", weekEnd)
      .limit(20000)
  ]);
  if (placedError) throw placedError;
  if (deliveredError) throw deliveredError;
  const active = new Set([...(placed ?? []), ...(delivered ?? [])].map((row: any) => row.assigned_rep_id as string));
  return repIds.filter((id) => active.has(id));
}

/**
 * Orders changed after the rep submitted. The owner's red flags list these:
 * a figure frozen at submit can be wrong if an order moved afterwards.
 */
async function ordersEditedAfterSubmit(orgId: string, reports: any[]) {
  const results: Array<{ repId: string; orderId: string; editedAt: string; what: string; by: string | null }> = [];
  for (const report of reports) {
    if (!report.submitted_at) continue;
    const orderIds: string[] = Array.isArray(report.snapshot?.orderIds)
      ? report.snapshot.orderIds.map((id: unknown) => String(id)).slice(0, 2000)
      : [];
    for (let index = 0; index < orderIds.length; index += 150) {
      const chunk = orderIds.slice(index, index + 150);
      const [{ data: edits, error: editsError }, { data: statusChanges, error: statusError }] = await Promise.all([
        supabase.from("order_field_edits").select("order_id, field_name, changed_by_name, created_at")
          .eq("org_id", orgId).in("order_id", chunk).gt("created_at", report.submitted_at).limit(1000),
        supabase.from("order_audit").select("order_id, from_status, to_status, created_at")
          .eq("org_id", orgId).in("order_id", chunk).gt("created_at", report.submitted_at).limit(1000)
      ]);
      if (editsError) throw editsError;
      if (statusError) throw statusError;
      for (const row of edits ?? []) {
        results.push({ repId: report.rep_id, orderId: row.order_id, editedAt: row.created_at, what: `${row.field_name} changed`, by: row.changed_by_name ?? null });
      }
      for (const row of statusChanges ?? []) {
        if (row.from_status === row.to_status) continue;
        results.push({ repId: report.rep_id, orderId: row.order_id, editedAt: row.created_at, what: `Status ${row.from_status ?? "?"} → ${row.to_status ?? "?"}`, by: null });
      }
    }
  }
  return results.sort((a, b) => b.editedAt.localeCompare(a.editedAt));
}

/**
 * Fines logged against reps during the week (by the day they were logged).
 * Served from here because the browser only loads penalties for admins - a
 * rep's own report would otherwise show no deduction and then disagree with
 * the manager's view of the same week.
 */
async function finesForWeek(orgId: string, repIds: string[] | null, weekStart: string) {
  let query = supabase.from("rep_penalties")
    .select("id, rep_id, type, amount, reason, remove_all_bonuses, created_at")
    .eq("org_id", orgId)
    .gte("created_at", lagosDayStartIso(weekStart))
    .lte("created_at", lagosDayEndIso(weekEndFromStart(weekStart)))
    .order("created_at", { ascending: true })
    .limit(2000);
  if (repIds) query = query.in("rep_id", repIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    repId: row.rep_id,
    label: [row.type, row.reason].filter(Boolean).join(" - ") + (row.remove_all_bonuses ? " (removes all bonuses at payroll)" : ""),
    amount: Number(row.amount ?? 0),
    date: String(row.created_at ?? "").slice(0, 10)
  }));
}

const sendError = (res: any, error: any, fallback: string) => {
  res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
};

// ── Sales Rep: my report ─────────────────────────────────────────────────────

router.get("/mine", requireRole("Sales Rep"), async (req, res) => {
  const parsed = z.object({ weekStart: weekStartSchema.optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const [report, company, fines, previousFines] = await Promise.all([
      loadRepReport(orgId, branchId, req.user!.id, weekStart),
      loadCompanyReport(orgId, branchId, weekStart),
      finesForWeek(orgId, [req.user!.id], weekStart),
      finesForWeek(orgId, [req.user!.id], addDaysToDateKey(weekStart, -7))
    ]);
    const [corrections, auditRows] = report
      ? await Promise.all([
          supabase.from("weekly_report_corrections").select(CORRECTION_COLUMNS)
            .eq("org_id", orgId).eq("rep_report_id", report.id).order("created_at", { ascending: true }),
          supabase.from("weekly_report_audit").select(AUDIT_COLUMNS)
            .eq("org_id", orgId).eq("rep_report_id", report.id).order("created_at", { ascending: true })
        ])
      : [{ data: [], error: null }, { data: [], error: null }];
    if (corrections.error) throw corrections.error;
    if (auditRows.error) throw auditRows.error;
    res.json({
      weekStart,
      weekEnd: weekEndFromStart(weekStart),
      report: mapRep(report),
      companyStatus: (company?.status ?? "open") as CompanyReportStatus,
      fines,
      previousFines,
      // Flags are for the owner. The rep sees returns, not flags.
      corrections: (corrections.data ?? []).filter((row: any) => row.kind === "return").map(mapCorrection),
      audit: (auditRows.data ?? []).filter((row: any) => row.action !== "rep_flagged").map(mapAudit)
    });
  } catch (error: any) {
    sendError(res, error, "Could not load your weekly report.");
  }
});

router.get("/mine/history", requireRole("Sales Rep"), async (req, res) => {
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const { data, error } = await supabase
      .from("rep_weekly_reports")
      .select(REP_COLUMNS)
      .eq("org_id", orgId)
      .eq("branch_id", branchId)
      .eq("rep_id", req.user!.id)
      .order("week_start", { ascending: false })
      .limit(104);
    if (error) throw error;
    const ids = (data ?? []).map((row: any) => row.id);
    const { data: openReturns, error: returnsError } = ids.length > 0
      ? await supabase.from("weekly_report_corrections").select("rep_report_id")
          .eq("org_id", orgId).in("rep_report_id", ids).eq("kind", "return").eq("status", "open")
      : { data: [], error: null };
    if (returnsError) throw returnsError;
    const openByReport = new Map<string, number>();
    for (const row of openReturns ?? []) openByReport.set(row.rep_report_id, (openByReport.get(row.rep_report_id) ?? 0) + 1);
    res.json({
      rows: (data ?? []).map((row: any) => ({ ...mapRep(row), openReturns: openByReport.get(row.id) ?? 0 }))
    });
  } catch (error: any) {
    sendError(res, error, "Could not load your report history.");
  }
});

const SubmitMineSchema = z.object({
  weekStart: weekStartSchema,
  snapshot: snapshotSchema,
  note: z.string().trim().max(500).optional(),
  responses: z.array(z.object({ correctionId: z.string().uuid(), response: z.string().trim().min(2).max(2000) })).optional()
});

router.post("/mine/submit", requireRole("Sales Rep"), async (req, res) => {
  const parsed = SubmitMineSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, snapshot, note, responses = [] } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const today = lagosDateKey();
    // A report covers a whole week, so it opens on the week's last day.
    if (weekEndFromStart(weekStart) > today) throw httpError(400, "You can submit this week's report from Saturday, the last day of the week.");

    const company = await loadCompanyReport(orgId, branchId, weekStart);
    const report = await ensureRepReport(orgId, branchId, req.user!.id, weekStart);
    if (!report) throw httpError(500, "Could not start your report.");
    const verdict = canRepSubmit(report.status, company?.status ?? null);
    if (!verdict.ok) throw httpError(409, verdict.error);

    // A returned report needs an answer to every open return before it goes back.
    const { data: openReturns, error: openError } = await supabase
      .from("weekly_report_corrections").select("id")
      .eq("org_id", orgId).eq("rep_report_id", report.id).eq("kind", "return").eq("status", "open");
    if (openError) throw openError;
    const responseById = new Map(responses.map((item) => [item.correctionId, item.response]));
    const unanswered = (openReturns ?? []).filter((row: any) => !responseById.get(row.id));
    if (unanswered.length > 0) {
      throw httpError(400, `Answer the manager's ${unanswered.length === 1 ? "comment" : `${unanswered.length} comments`} before you resubmit.`);
    }

    const now = new Date().toISOString();
    const isResubmit = report.status === "returned";
    const { data: updated, error: updateError } = await supabase
      .from("rep_weekly_reports")
      .update({
        status: "submitted",
        snapshot,
        rep_note: note ?? null,
        submit_count: Number(report.submit_count ?? 0) + 1,
        submitted_at: now,
        manager_reviewed_by: null,
        manager_reviewed_at: null,
        updated_at: now
      })
      .eq("id", report.id)
      .eq("status", report.status)
      .select("id");
    if (updateError) throw updateError;
    if (!updated || updated.length === 0) throw httpError(409, "Your report changed while you were submitting. Reload and try again.");

    for (const row of openReturns ?? []) {
      const { error: resolveError } = await supabase.from("weekly_report_corrections")
        .update({ status: "resolved", response: responseById.get(row.id), resolved_by: req.user!.id, resolved_at: now })
        .eq("id", row.id).eq("status", "open");
      if (resolveError) throw resolveError;
    }

    const totals = (snapshot as any)?.totals ?? {};
    await audit(req, {
      branchId, weekStart, action: isResubmit ? "rep_resubmitted" : "rep_submitted",
      repReportId: report.id, repId: req.user!.id,
      detail: {
        orders: totals.orders ?? null,
        delivered: totals.delivered ?? null,
        deliveryRate: totals.deliveryRate ?? null,
        finalBonus: totals.finalBonus ?? null,
        note: note ?? null,
        answered: (openReturns ?? []).length
      }
    });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not submit your weekly report.");
  }
});

// ── Manager / Admin / Owner: the week ────────────────────────────────────────

router.get("/week", requireRole(...LEADERSHIP), async (req, res) => {
  const parsed = z.object({ weekStart: weekStartSchema.optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const [company, repReports, corrections, auditRows, expectedRepIds, fines, previousFines] = await Promise.all([
      loadCompanyReport(orgId, branchId, weekStart),
      supabase.from("rep_weekly_reports").select(REP_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart),
      supabase.from("weekly_report_corrections").select(CORRECTION_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).order("created_at", { ascending: true }),
      supabase.from("weekly_report_audit").select(AUDIT_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).order("created_at", { ascending: true }),
      expectedRepIdsForWeek(orgId, branchId, weekStart),
      finesForWeek(orgId, null, weekStart),
      finesForWeek(orgId, null, addDaysToDateKey(weekStart, -7))
    ]);
    if (repReports.error) throw repReports.error;
    if (corrections.error) throw corrections.error;
    if (auditRows.error) throw auditRows.error;
    const editedAfterSubmit = await ordersEditedAfterSubmit(orgId, repReports.data ?? []);
    res.json({
      weekStart,
      weekEnd: weekEndFromStart(weekStart),
      company: mapCompany(company),
      repReports: (repReports.data ?? []).map(mapRep),
      corrections: (corrections.data ?? []).map(mapCorrection),
      audit: (auditRows.data ?? []).map(mapAudit),
      expectedRepIds,
      editedAfterSubmit,
      fines,
      previousFines
    });
  } catch (error: any) {
    sendError(res, error, "Could not load this week's reports.");
  }
});

router.get("/history", requireRole(...LEADERSHIP), async (req, res) => {
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const [{ data: companies, error: companyError }, { data: reps, error: repError }] = await Promise.all([
      supabase.from("company_weekly_reports").select(COMPANY_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId)
        .order("week_start", { ascending: false }).limit(104),
      supabase.from("rep_weekly_reports").select("week_start, status").eq("org_id", orgId).eq("branch_id", branchId)
        .order("week_start", { ascending: false }).limit(2000)
    ]);
    if (companyError) throw companyError;
    if (repError) throw repError;
    const byWeek = new Map<string, Record<string, number>>();
    for (const row of reps ?? []) {
      const counts = byWeek.get(row.week_start) ?? {};
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      byWeek.set(row.week_start, counts);
    }
    const weeks = new Set<string>([...(companies ?? []).map((row: any) => row.week_start), ...byWeek.keys()]);
    const companyByWeek = new Map((companies ?? []).map((row: any) => [row.week_start, row]));
    res.json({
      rows: Array.from(weeks).sort((a, b) => b.localeCompare(a)).map((week) => ({
        weekStart: week,
        weekEnd: weekEndFromStart(week),
        company: mapCompany(companyByWeek.get(week) ?? null),
        repStatusCounts: byWeek.get(week) ?? {}
      }))
    });
  } catch (error: any) {
    sendError(res, error, "Could not load the report history.");
  }
});

const RepActionSchema = z.object({ weekStart: weekStartSchema, note: z.string().trim().max(1000).optional() });

router.post("/rep/:repId/approve", requireRole(...REVIEWERS), async (req, res) => {
  const parsed = RepActionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, note } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const repId = String(req.params.repId);
    const [report, company] = await Promise.all([
      loadRepReport(orgId, branchId, repId, weekStart),
      loadCompanyReport(orgId, branchId, weekStart)
    ]);
    const verdict = canManagerAct("approve", report?.status ?? null, company?.status ?? null);
    if (!verdict.ok || !report) throw httpError(409, verdict.ok ? "The rep has not submitted this report yet." : verdict.error);

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from("rep_weekly_reports")
      .update({ status: "manager_approved", manager_reviewed_by: req.user!.id, manager_reviewed_at: now, updated_at: now })
      .eq("id", report.id).eq("status", "submitted").select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This report changed while you were approving it. Reload and try again.");
    await audit(req, { branchId, weekStart, action: "manager_approved", repReportId: report.id, repId, detail: { note: note ?? null } });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not approve this report.");
  }
});

router.post("/rep/:repId/return", requireRole(...REVIEWERS), async (req, res) => {
  const parsed = correctionBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, section, problem, comment, orderRef } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const repId = String(req.params.repId);
    const [report, company] = await Promise.all([
      loadRepReport(orgId, branchId, repId, weekStart),
      loadCompanyReport(orgId, branchId, weekStart)
    ]);
    const verdict = canManagerAct("return", report?.status ?? null, company?.status ?? null);
    if (!verdict.ok || !report) throw httpError(409, verdict.ok ? "The rep has not submitted this report yet." : verdict.error);

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from("rep_weekly_reports")
      .update({ status: "returned", manager_reviewed_by: req.user!.id, manager_reviewed_at: now, updated_at: now })
      .eq("id", report.id).eq("status", report.status).select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This report changed while you were returning it. Reload and try again.");

    const { data: correction, error: correctionError } = await supabase.from("weekly_report_corrections").insert({
      org_id: orgId, branch_id: branchId, week_start: weekStart, rep_report_id: report.id,
      kind: "return", section, problem, comment, order_ref: orderRef || null,
      raised_by: req.user!.id, raised_by_name: req.user!.name ?? null, raised_by_role: req.user!.role
    }).select("id").single();
    if (correctionError) throw correctionError;
    await audit(req, {
      branchId, weekStart, action: "manager_returned", repReportId: report.id, repId,
      detail: { correctionId: correction.id, section, problem, comment, orderRef: orderRef || null, previousStatus: report.status }
    });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not return this report.");
  }
});

router.post("/rep/:repId/flag", requireRole(...REVIEWERS), async (req, res) => {
  const parsed = correctionBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, section, problem, comment, orderRef } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const repId = String(req.params.repId);
    const company = await loadCompanyReport(orgId, branchId, weekStart);
    const existing = await loadRepReport(orgId, branchId, repId, weekStart);
    const verdict = canManagerAct("flag", existing?.status ?? null, company?.status ?? null);
    if (!verdict.ok) throw httpError(409, verdict.error);
    const report = existing ?? await ensureRepReport(orgId, branchId, repId, weekStart);
    if (!report) throw httpError(500, "Could not open this rep's report.");

    const { data: correction, error } = await supabase.from("weekly_report_corrections").insert({
      org_id: orgId, branch_id: branchId, week_start: weekStart, rep_report_id: report.id,
      kind: "flag", section, problem, comment, order_ref: orderRef || null,
      raised_by: req.user!.id, raised_by_name: req.user!.name ?? null, raised_by_role: req.user!.role
    }).select("id").single();
    if (error) throw error;
    await audit(req, {
      branchId, weekStart, action: "rep_flagged", repReportId: report.id, repId,
      detail: { correctionId: correction.id, section, problem, comment, orderRef: orderRef || null }
    });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not flag this report.");
  }
});

const CompanySubmitSchema = z.object({
  weekStart: weekStartSchema,
  managerNote: z.string().trim().max(500).optional(),
  companySnapshot: snapshotSchema,
  managerBonusSnapshot: snapshotSchema.nullable().optional(),
  responses: z.array(z.object({ correctionId: z.string().uuid(), response: z.string().trim().min(2).max(2000) })).optional()
});

router.post("/company/submit", requireRole(...REVIEWERS), async (req, res) => {
  const parsed = CompanySubmitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, managerNote, companySnapshot, managerBonusSnapshot, responses = [] } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const company = await ensureCompanyReport(orgId, branchId, weekStart);
    if (!company) throw httpError(500, "Could not open this week.");
    const [expectedRepIds, { data: reports, error: reportsError }] = await Promise.all([
      expectedRepIdsForWeek(orgId, branchId, weekStart),
      supabase.from("rep_weekly_reports").select("rep_id, status").eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart)
    ]);
    if (reportsError) throw reportsError;
    const verdict = canSubmitToOwner(company.status, expectedRepIds, (reports ?? []).map((row: any) => ({ repId: row.rep_id, status: row.status })));
    if (!verdict.ok) throw httpError(409, verdict.error);

    const { data: openReturns, error: openError } = await supabase.from("weekly_report_corrections").select("id")
      .eq("org_id", orgId).eq("company_report_id", company.id).eq("kind", "return").eq("status", "open");
    if (openError) throw openError;
    const responseById = new Map(responses.map((item) => [item.correctionId, item.response]));
    const unanswered = (openReturns ?? []).filter((row: any) => !responseById.get(row.id));
    if (unanswered.length > 0) throw httpError(400, "Answer the owner's comments before you resubmit.");

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from("company_weekly_reports")
      .update({
        status: "submitted_to_owner",
        manager_note: managerNote ?? null,
        company_snapshot: companySnapshot,
        manager_bonus_snapshot: managerBonusSnapshot ?? null,
        submit_count: Number(company.submit_count ?? 0) + 1,
        submitted_by: req.user!.id,
        submitted_at: now,
        updated_at: now
      })
      .eq("id", company.id).eq("status", company.status).select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This week changed while you were submitting. Reload and try again.");

    for (const row of openReturns ?? []) {
      const { error: resolveError } = await supabase.from("weekly_report_corrections")
        .update({ status: "resolved", response: responseById.get(row.id), resolved_by: req.user!.id, resolved_at: now })
        .eq("id", row.id).eq("status", "open");
      if (resolveError) throw resolveError;
    }
    const totals = (companySnapshot as any)?.totals ?? {};
    await audit(req, {
      branchId, weekStart, action: company.status === "returned_to_manager" ? "company_resubmitted" : "company_submitted",
      companyReportId: company.id,
      detail: { orders: totals.orders ?? null, delivered: totals.delivered ?? null, totalBonus: totals.totalBonus ?? null, note: managerNote ?? null }
    });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not submit this week to the owner.");
  }
});

router.post("/company/approve-lock", requireRole("Owner"), async (req, res) => {
  const parsed = RepActionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, note } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const company = await loadCompanyReport(orgId, branchId, weekStart);
    const verdict = canOwnerAct("approve_lock", company?.status ?? null);
    if (!verdict.ok || !company) throw httpError(409, verdict.ok ? "The manager has not submitted this week yet." : verdict.error);

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from("company_weekly_reports")
      .update({ status: "locked", owner_note: note ?? null, locked_by: req.user!.id, locked_at: now, updated_at: now })
      .eq("id", company.id).eq("status", "submitted_to_owner").select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This week changed while you were approving it. Reload and try again.");

    const { data: lockedReps, error: repError } = await supabase.from("rep_weekly_reports")
      .update({ status: "locked", owner_approved_by: req.user!.id, owner_approved_at: now, locked_at: now, updated_at: now })
      .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).eq("status", "manager_approved")
      .select("id");
    if (repError) throw repError;
    await audit(req, {
      branchId, weekStart, action: "owner_approved_locked", companyReportId: company.id,
      detail: { note: note ?? null, repReportsLocked: (lockedReps ?? []).length }
    });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not approve and lock this week.");
  }
});

router.post("/company/return", requireRole("Owner"), async (req, res) => {
  const parsed = correctionBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, section, problem, comment, orderRef } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const company = await loadCompanyReport(orgId, branchId, weekStart);
    const verdict = canOwnerAct("return", company?.status ?? null);
    if (!verdict.ok || !company) throw httpError(409, verdict.ok ? "The manager has not submitted this week yet." : verdict.error);

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from("company_weekly_reports")
      .update({ status: "returned_to_manager", updated_at: now })
      .eq("id", company.id).eq("status", "submitted_to_owner").select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This week changed while you were returning it. Reload and try again.");
    const { data: correction, error: correctionError } = await supabase.from("weekly_report_corrections").insert({
      org_id: orgId, branch_id: branchId, week_start: weekStart, company_report_id: company.id,
      kind: "return", section, problem, comment, order_ref: orderRef || null,
      raised_by: req.user!.id, raised_by_name: req.user!.name ?? null, raised_by_role: req.user!.role
    }).select("id").single();
    if (correctionError) throw correctionError;
    await audit(req, {
      branchId, weekStart, action: "owner_returned", companyReportId: company.id,
      detail: { correctionId: correction.id, section, problem, comment, orderRef: orderRef || null }
    });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not return this week to the manager.");
  }
});

router.post("/company/reopen", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ weekStart: weekStartSchema, reason: z.string().trim().min(5, "Say why the week is being reopened.").max(1000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, reason } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const company = await loadCompanyReport(orgId, branchId, weekStart);
    const verdict = canOwnerAct("reopen", company?.status ?? null);
    if (!verdict.ok || !company) throw httpError(409, verdict.ok ? "Only a locked week can be reopened." : verdict.error);

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from("company_weekly_reports")
      .update({ status: "open", reopened_by: req.user!.id, reopened_at: now, reopen_reason: reason, updated_at: now })
      .eq("id", company.id).eq("status", "locked").select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This week changed while you were reopening it. Reload and try again.");
    // Back to "approved by the manager", so the manager can return just the
    // report that needs fixing without every rep starting again.
    const { error: repError } = await supabase.from("rep_weekly_reports")
      .update({ status: "manager_approved", locked_at: null, owner_approved_by: null, owner_approved_at: null, updated_at: now })
      .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).eq("status", "locked");
    if (repError) throw repError;
    await audit(req, { branchId, weekStart, action: "owner_reopened", companyReportId: company.id, detail: { reason } });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not reopen this week.");
  }
});

export default router;
