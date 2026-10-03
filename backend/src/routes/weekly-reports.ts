import { Router, type Request } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { expectedRepIdsForWeek } from "../lib/weekly-report-data.js";
import { notifyWeeklyReport } from "../lib/weekly-report-notifications.js";
import { branchFundManagers, loadFundWeek } from "./manager-funds.js";
import { disputesForWeek, logMissesForWeek } from "./log-misses.js";
import { addDaysToDateKey, sundayWeekStartForDateKey, lagosDateKey, weekEndFromStart } from "../lib/sales-bonus-engine.js";
import { FIRST_REPORT_WEEK,
  CORRECTION_SECTIONS,
  canManagerAct,
  canOwnerAct,
  canRepSubmit,
  canSubmitToOwner,
  reportDueDate,
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
  orderRef: z.string().trim().max(60).optional(),
  // The owner can return the week over one Funds & Expenses entry.
  fundTransactionId: z.string().uuid().optional()
});

/** Every manager wallet's money side for the week (only the ones with anything in them). */
async function fundsForWeek(orgId: string, branchId: string, weekStart: string) {
  const managers = await branchFundManagers(orgId, branchId);
  const weeks = await Promise.all(managers.map(async (manager) => ({ manager, fund: await loadFundWeek(orgId, branchId, manager.id, weekStart) })));
  return weeks.filter((item) => item.fund.hasActivity);
}

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
const CORRECTION_COLUMNS = "id, week_start, rep_report_id, company_report_id, fund_transaction_id, kind, section, problem, comment, order_ref, raised_by, raised_by_name, raised_by_role, status, response, resolved_by, resolved_at, created_at";
const AUDIT_COLUMNS = "id, week_start, rep_report_id, company_report_id, rep_id, actor_id, actor_name, actor_role, action, detail, created_at";

const BONUS_QUERY_COLUMNS = "id, rep_id, week_start, order_refs, rep_message, check_verdict, check_result, sent_despite_accurate, status, manager_response, correction_amount, correction_week_start, resolved_by, resolved_by_name, resolved_at, created_at";

const mapBonusQuery = (row: any) => ({
  id: row.id,
  repId: row.rep_id,
  weekStart: row.week_start,
  orderRefs: row.order_refs ?? [],
  repMessage: row.rep_message ?? null,
  checkVerdict: row.check_verdict,
  checkResult: row.check_result ?? {},
  sentDespiteAccurate: !!row.sent_despite_accurate,
  status: row.status,
  managerResponse: row.manager_response ?? null,
  correctionAmount: Number(row.correction_amount ?? 0),
  correctionWeekStart: row.correction_week_start ?? null,
  resolvedBy: row.resolved_by ?? null,
  resolvedByName: row.resolved_by_name ?? null,
  resolvedAt: row.resolved_at ?? null,
  createdAt: row.created_at
});

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
  section: row.fund_transaction_id ? "funds" : row.section,
  fundTransactionId: row.fund_transaction_id ?? null,
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
    // Missed follow-up fines are counted by the day they were MISSED (from
    // follow_up_misses), not the day the Owner approved them - so their
    // rep_penalties rows are left out here or they would count twice.
    .neq("type", "follow_up_miss")
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

/**
 * Reading "my report": a Sales Rep, or the Owner/Admin using View As on one.
 * requireRole checks the REAL role, so with it the Owner previewing a rep got
 * "Requires one of: Sales Rep" (Bright, 1 Oct 2026). Reads go through
 * scopeOf(req), the same effective user every other rep screen uses. Writes
 * stay real-rep only: a preview is read-only.
 */
export function requireScopedRep(req: Request, res: any, next: () => void) {
  if (scopeOf(req).role !== "Sales Rep") {
    res.status(403).json({ error: "Only a sales rep has a weekly report." });
    return;
  }
  next();
}

/**
 * Fines still owed from last week: the previous week's report froze how much
 * was left over after the bonus hit N0 (Bright: "carry the rest to next week").
 * Read from what the rep submitted, so a figure the manager approved never moves.
 */
async function carriedFinesFor(orgId: string, branchId: string, repIds: string[] | null, weekStart: string) {
  let query = supabase.from("rep_weekly_reports").select("rep_id, status, snapshot")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", addDaysToDateKey(weekStart, -7)).neq("status", "draft");
  if (repIds) query = query.in("rep_id", repIds);
  const { data, error } = await query;
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const unpaid = Number((row.snapshot as any)?.totals?.unpaidFines ?? 0);
    if (unpaid > 0) out[row.rep_id] = unpaid;
  }
  return out;
}

/** Bonus corrections paid IN this week (from resolved bonus queries). */
async function adjustmentsForWeek(orgId: string, branchId: string, repIds: string[] | null, weekStart: string) {
  let query = supabase.from("weekly_bonus_queries")
    .select("id, rep_id, week_start, correction_amount, manager_response")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("status", "corrected").eq("correction_week_start", weekStart)
    .order("resolved_at", { ascending: true });
  if (repIds) query = query.in("rep_id", repIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    id: row.id,
    repId: row.rep_id,
    label: `Bonus correction for week of ${row.week_start}${row.manager_response ? ` - ${row.manager_response}` : ""}`,
    amount: Number(row.correction_amount ?? 0)
  }));
}

const sendError = (res: any, error: any, fallback: string) => {
  res.status(error?.status ?? 500).json({ error: error?.message ?? fallback });
};

// ── Sales Rep: my report ─────────────────────────────────────────────────────

router.get("/mine", requireScopedRep, async (req, res) => {
  const parsed = z.object({ weekStart: weekStartSchema.optional() }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const repId = scopeOf(req).id;
    const weekStart = parsed.data.weekStart ?? sundayWeekStartForDateKey(lagosDateKey());
    const [report, company, fines, previousFines, adjustments, previousAdjustments, bonusQueries] = await Promise.all([
      loadRepReport(orgId, branchId, repId, weekStart),
      loadCompanyReport(orgId, branchId, weekStart),
      finesForWeek(orgId, [repId], weekStart),
      finesForWeek(orgId, [repId], addDaysToDateKey(weekStart, -7)),
      adjustmentsForWeek(orgId, branchId, [repId], weekStart),
      adjustmentsForWeek(orgId, branchId, [repId], addDaysToDateKey(weekStart, -7)),
      supabase.from("weekly_bonus_queries").select(BONUS_QUERY_COLUMNS)
        .eq("org_id", orgId).eq("branch_id", branchId).eq("rep_id", repId)
        .order("created_at", { ascending: false }).limit(50)
    ]);
    if (bonusQueries.error) throw bonusQueries.error;
    const [logMisses, previousLogMisses, logMissDisputes, carried] = await Promise.all([
      logMissesForWeek(orgId, [repId], weekStart),
      logMissesForWeek(orgId, [repId], addDaysToDateKey(weekStart, -7)),
      disputesForWeek(orgId, branchId, [repId], weekStart),
      carriedFinesFor(orgId, branchId, [repId], weekStart)
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
      adjustments,
      previousAdjustments,
      bonusQueries: (bonusQueries.data ?? []).map(mapBonusQuery),
      logMisses,
      previousLogMisses,
      logMissDisputes,
      carriedFines: carried[repId] ?? 0,
      // Flags are for the owner. The rep sees returns, not flags.
      corrections: (corrections.data ?? []).filter((row: any) => row.kind === "return").map(mapCorrection),
      audit: (auditRows.data ?? []).filter((row: any) => row.action !== "rep_flagged").map(mapAudit)
    });
  } catch (error: any) {
    sendError(res, error, "Could not load your weekly report.");
  }
});

router.get("/mine/history", requireScopedRep, async (req, res) => {
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const repId = scopeOf(req).id;
    const { data, error } = await supabase
      .from("rep_weekly_reports")
      .select(REP_COLUMNS)
      .eq("org_id", orgId)
      .eq("branch_id", branchId)
      .eq("rep_id", repId)
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
    // Reports open on the TUESDAY after the week (Bright, 1 Oct 2026), so the
    // weekend's orders are attended to before the week is reported. Due by
    // the end of that Tuesday; later is allowed but recorded as late.
    const existing = await loadRepReport(orgId, branchId, req.user!.id, weekStart);
    if (weekStart < FIRST_REPORT_WEEK && existing?.status !== "returned") {
      throw httpError(400, "Weekly reports start with the week of 27 Sept - 3 Oct 2026. Earlier weeks are already settled, so there is nothing to submit.");
    }
    const dueDate = reportDueDate(weekStart);
    if (today < dueDate) throw httpError(400, `This week's report opens on Tuesday ${dueDate}. Submit it that day.`);
    const late = today > dueDate;

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
        answered: (openReturns ?? []).length,
        dueDate,
        late: isResubmit ? false : late
      }
    });
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "rep_submitted", repId: req.user!.id, repName: req.user!.name ?? "A sales rep", resubmitted: isResubmit, late: !isResubmit && late });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not submit your weekly report.");
  }
});

// ── Bonus queries (Bright, 1 Oct 2026) ─────────────────────────────────────
// The rep's "Check My Bonus" runs in the browser (the bonus maths lives
// there, see the header note). Its result is posted here:
// - verdict "issues"                 -> a query goes to the manager
// - verdict "accurate"               -> recorded in the audit trail only...
// - "accurate" + sendDespiteAccurate -> ...unless the rep still disagrees and
//                                       gives a reason; the query is marked so.

const CheckFindingSchema = z.object({
  level: z.enum(["issue", "info", "ok"]),
  text: z.string().max(400),
  orderId: z.string().max(60).optional()
});

const BonusQuerySchema = z.object({
  weekStart: weekStartSchema,
  orderRefs: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  message: z.string().trim().max(1000).optional(),
  check: z.object({
    verdict: z.enum(["accurate", "issues"]),
    findings: z.array(CheckFindingSchema).max(200),
    checkedFinalBonus: z.number().optional()
  }),
  sendDespiteAccurate: z.boolean().optional()
});

router.post("/mine/bonus-queries", requireRole("Sales Rep"), async (req, res) => {
  const parsed = BonusQuerySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { weekStart, orderRefs, message, check, sendDespiteAccurate } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const checkResult = { ...check, checkedAt: new Date().toISOString() };

    if (check.verdict === "accurate" && !sendDespiteAccurate) {
      await audit(req, { branchId, weekStart, action: "bonus_check_accurate", repId: req.user!.id, detail: { orderRefs, findings: check.findings.length } });
      res.json({ sent: false });
      return;
    }
    if (check.verdict === "accurate" && (!message || message.length < 5)) {
      throw httpError(400, "Say why you still think your bonus is wrong.");
    }

    const { data: row, error } = await supabase.from("weekly_bonus_queries").insert({
      org_id: orgId,
      branch_id: branchId,
      rep_id: req.user!.id,
      week_start: weekStart,
      order_refs: orderRefs,
      rep_message: message || null,
      check_verdict: check.verdict,
      check_result: checkResult,
      sent_despite_accurate: check.verdict === "accurate"
    }).select("id").single();
    if (error) throw error;
    await audit(req, {
      branchId, weekStart, action: "bonus_query_opened", repId: req.user!.id,
      detail: { queryId: row.id, verdict: check.verdict, orderRefs, note: message || null, issues: check.findings.filter((f) => f.level === "issue").length }
    });
    void notifyWeeklyReport(orgId, branchId, weekStart, {
      kind: "bonus_query_opened",
      repName: req.user!.name ?? "A sales rep",
      despiteAccurate: check.verdict === "accurate",
      findings: check.findings.filter((f) => f.level === "issue").length
    });
    res.status(201).json({ sent: true, id: row.id });
  } catch (error: any) {
    sendError(res, error, "Could not send your bonus query.");
  }
});

const ResolveQuerySchema = z.object({
  outcome: z.enum(["corrected", "no_change"]),
  response: z.string().trim().min(3, "Tell the rep what you found.").max(1000),
  amount: z.number().positive().max(10_000_000).optional()
}).refine((value) => value.outcome !== "corrected" || (value.amount ?? 0) > 0, { message: "Enter the amount to add." });

router.post("/bonus-queries/:id/resolve", requireRole("Manager", "Admin", "Owner"), async (req, res) => {
  const parsed = ResolveQuerySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { outcome, response, amount } = parsed.data;
  try {
    const branchId = requireBranch(req);
    const orgId = req.user!.orgId;
    const { data: query, error: loadError } = await supabase.from("weekly_bonus_queries").select(BONUS_QUERY_COLUMNS)
      .eq("id", String(req.params.id)).eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
    if (loadError) throw loadError;
    if (!query) throw httpError(404, "That bonus query was not found.");
    if (query.status !== "open") throw httpError(409, "This bonus query has already been answered.");

    // A correction is never written into a locked week: it is paid with the
    // week that is running now, and shows on that week's report.
    const paidWeekStart = outcome === "corrected" ? sundayWeekStartForDateKey(lagosDateKey()) : null;
    const now = new Date().toISOString();
    const { data: updated, error } = await supabase.from("weekly_bonus_queries").update({
      status: outcome,
      manager_response: response,
      correction_amount: outcome === "corrected" ? amount : 0,
      correction_week_start: paidWeekStart,
      resolved_by: req.user!.id,
      resolved_by_name: req.user!.name ?? null,
      resolved_at: now,
      updated_at: now
    }).eq("id", query.id).eq("status", "open").select("id");
    if (error) throw error;
    if (!updated || updated.length === 0) throw httpError(409, "This bonus query changed while you were answering it. Reload and try again.");

    await audit(req, {
      branchId, weekStart: query.week_start, action: "bonus_query_resolved", repId: query.rep_id,
      detail: { queryId: query.id, outcome, amount: outcome === "corrected" ? amount : 0, paidWeekStart, note: response }
    });
    void notifyWeeklyReport(orgId, branchId, query.week_start, {
      kind: "bonus_query_resolved", repId: query.rep_id, corrected: outcome === "corrected", amount: amount ?? 0, paidWeekStart
    });
    res.json({ ok: true, paidWeekStart });
  } catch (error: any) {
    sendError(res, error, "Could not answer this bonus query.");
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
    const [company, repReports, corrections, auditRows, expectedRepIds, fines, previousFines, adjustments, previousAdjustments, bonusQueries] = await Promise.all([
      loadCompanyReport(orgId, branchId, weekStart),
      supabase.from("rep_weekly_reports").select(REP_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart),
      supabase.from("weekly_report_corrections").select(CORRECTION_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).order("created_at", { ascending: true }),
      supabase.from("weekly_report_audit").select(AUDIT_COLUMNS).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).order("created_at", { ascending: true }),
      expectedRepIdsForWeek(orgId, branchId, weekStart),
      finesForWeek(orgId, null, weekStart),
      finesForWeek(orgId, null, addDaysToDateKey(weekStart, -7)),
      adjustmentsForWeek(orgId, branchId, null, weekStart),
      adjustmentsForWeek(orgId, branchId, null, addDaysToDateKey(weekStart, -7)),
      // Every open query, plus this week's answered ones.
      supabase.from("weekly_bonus_queries").select(BONUS_QUERY_COLUMNS)
        .eq("org_id", orgId).eq("branch_id", branchId)
        .or(`status.eq.open,week_start.eq.${weekStart},correction_week_start.eq.${weekStart}`)
        .order("created_at", { ascending: false }).limit(200)
    ]);
    if (repReports.error) throw repReports.error;
    if (bonusQueries.error) throw bonusQueries.error;
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
      previousFines,
      adjustments,
      previousAdjustments,
      bonusQueries: (bonusQueries.data ?? []).map(mapBonusQuery),
      logMisses: await logMissesForWeek(orgId, null, weekStart),
      previousLogMisses: await logMissesForWeek(orgId, null, addDaysToDateKey(weekStart, -7)),
      logMissDisputes: await disputesForWeek(orgId, branchId, null, weekStart),
      carriedFines: await carriedFinesFor(orgId, branchId, null, weekStart),
      funds: (await fundsForWeek(orgId, branchId, weekStart)).map(({ manager, fund }) => ({
        managerId: manager.id,
        managerName: manager.name,
        totals: fund.totals,
        readiness: fund.readiness,
        locked: fund.locked,
        varianceExplanation: fund.week?.variance_explanation ?? null,
        notes: fund.week?.notes ?? null,
        returned: fund.rows.filter((row: any) => row.status === "returned").length
      }))
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
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "manager_approved", repId });
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
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "manager_returned", repId, problem, orderRef: orderRef || null });
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
    const { data: flaggedRep } = await supabase.from("users").select("name").eq("id", repId).eq("org_id", orgId).maybeSingle();
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "rep_flagged", repName: flaggedRep?.name ?? "a rep", problem });
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
    // The money side must be ready too: counted balance, any variance
    // explained, every required proof attached, nothing still returned.
    const funds = await fundsForWeek(orgId, branchId, weekStart);
    const fundProblems = funds.filter(({ fund }) => fund.readiness.length > 0)
      .map(({ manager, fund }) => `${manager.name}: ${fund.readiness.join(" ")}`);
    if (fundProblems.length > 0) throw httpError(409, `Funds & Expenses is not ready. ${fundProblems.join(" ")}`);

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
        // The money side is worked out on the server, so it is frozen from there.
        company_snapshot: {
          ...companySnapshot,
          funds: funds.map(({ manager, fund }) => ({ managerId: manager.id, managerName: manager.name, totals: fund.totals, varianceExplanation: fund.week?.variance_explanation ?? null }))
        },
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
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "company_submitted", resubmitted: company.status === "returned_to_manager" });
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
      .select("id, rep_id");
    if (repError) throw repError;
    await audit(req, {
      branchId, weekStart, action: "owner_approved_locked", companyReportId: company.id,
      detail: { note: note ?? null, repReportsLocked: (lockedReps ?? []).length }
    });
    // Freeze each wallet's week. Its counted closing opens next week.
    for (const { manager, fund } of await fundsForWeek(orgId, branchId, weekStart)) {
      if (!fund.wallet) continue;
      const { error: fundError } = await supabase.from("manager_fund_weeks").upsert({
        org_id: orgId, branch_id: branchId, manager_id: manager.id, wallet_account_id: fund.wallet.id, week_start: weekStart,
        opening_balance: fund.totals.opening, opening_source: fund.openingSource,
        actual_closing: fund.totals.actual, closing_snapshot: fund.totals, locked_at: now, updated_at: now
      }, { onConflict: "branch_id,manager_id,week_start" });
      if (fundError) throw fundError;
    }
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "owner_locked", repIds: (lockedReps ?? []).map((row: any) => row.rep_id as string) });
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
    const fundTransactionId = parsed.data.fundTransactionId;
    if (fundTransactionId) {
      const { data: txn, error: txnError } = await supabase.from("manager_fund_transactions").update({
        status: "returned", return_reason: comment, updated_at: new Date().toISOString()
      }).eq("id", fundTransactionId).eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart).neq("status", "voided").select("id");
      if (txnError) throw txnError;
      if (!txn || txn.length === 0) throw httpError(404, "That Funds & Expenses entry is not in this week.");
    }
    const { data: correction, error: correctionError } = await supabase.from("weekly_report_corrections").insert({
      org_id: orgId, branch_id: branchId, week_start: weekStart, company_report_id: company.id,
      // The table's section list predates Funds; the link is what marks it.
      kind: "return", section: section === "funds" ? "other" : section, problem, comment, order_ref: orderRef || null,
      fund_transaction_id: fundTransactionId ?? null,
      raised_by: req.user!.id, raised_by_name: req.user!.name ?? null, raised_by_role: req.user!.role
    }).select("id").single();
    if (correctionError) throw correctionError;
    await audit(req, {
      branchId, weekStart, action: "owner_returned", companyReportId: company.id,
      detail: { correctionId: correction.id, section, problem, comment, orderRef: orderRef || null }
    });
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "owner_returned", problem });
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
    const { error: fundError } = await supabase.from("manager_fund_weeks").update({ locked_at: null, updated_at: now })
      .eq("org_id", orgId).eq("branch_id", branchId).eq("week_start", weekStart);
    if (fundError) throw fundError;
    await audit(req, { branchId, weekStart, action: "owner_reopened", companyReportId: company.id, detail: { reason } });
    void notifyWeeklyReport(orgId, branchId, weekStart, { kind: "owner_reopened", reason });
    res.json({ ok: true });
  } catch (error: any) {
    sendError(res, error, "Could not reopen this week.");
  }
});

export default router;
