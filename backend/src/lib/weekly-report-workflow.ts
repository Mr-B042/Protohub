// Weekly Report approvals: who may do what, and when. Pure, so every rule is
// tested on its own (weekly-report-workflow.test.ts) and the routes only
// load rows, ask here, then write.
//
// Rep report:     draft -> submitted -> manager_approved -> locked
//                                    \-> returned -> submitted (again)
// Company week:   open -> submitted_to_owner -> locked
//                                           \-> returned_to_manager -> submitted_to_owner
//                 locked -> open  (Owner reopens, reason required, logged)
//
// "owner_approved" exists in the table for a future per-rep owner step. Today
// the owner approves the whole week in one action, which locks every report.

export type RepReportStatus = "draft" | "submitted" | "returned" | "manager_approved" | "owner_approved" | "locked";
export type CompanyReportStatus = "open" | "submitted_to_owner" | "returned_to_manager" | "locked";
export type CorrectionSection = "orders" | "delivery" | "product_breakdown" | "upsell_cross_sell" | "bonus" | "funds" | "other";

export const CORRECTION_SECTIONS: CorrectionSection[] = [
  "orders", "delivery", "product_breakdown", "upsell_cross_sell", "bonus", "funds", "other"
];

export const REVIEWER_ROLES = ["Manager", "Admin"] as const;

type Verdict = { ok: true } | { ok: false; error: string };
const ok: Verdict = { ok: true };
const no = (error: string): Verdict => ({ ok: false, error });

/** While the owner holds the week, or once it is locked, nothing below moves. */
const companyFrozen = (company: CompanyReportStatus | null): Verdict | null => {
  if (company === "submitted_to_owner") return no("This week is with the owner for approval. Nothing can change until the owner returns it.");
  if (company === "locked") return no("This week is approved and locked.");
  return null;
};

export function canRepSubmit(rep: RepReportStatus | null, company: CompanyReportStatus | null): Verdict {
  const frozen = companyFrozen(company);
  if (frozen) return frozen;
  const status = rep ?? "draft";
  if (status === "draft" || status === "returned") return ok;
  if (status === "submitted") return no("You have already submitted this week. Your manager is reviewing it.");
  if (status === "manager_approved") return no("Your manager has already approved this week.");
  return no("This week is approved and locked.");
}

export type ManagerAction = "approve" | "return" | "flag";

export function canManagerAct(
  action: ManagerAction,
  rep: RepReportStatus | null,
  company: CompanyReportStatus | null
): Verdict {
  const frozen = companyFrozen(company);
  if (frozen) return frozen;
  const status = rep ?? "draft";
  if (action === "flag") {
    // A flag is a note for the owner. It does not move the report, so it can
    // sit on any report the manager can see, even one not yet submitted.
    return status === "locked" ? no("This week is approved and locked.") : ok;
  }
  if (action === "approve") {
    if (status === "submitted") return ok;
    if (status === "manager_approved") return no("You have already approved this report.");
    if (status === "returned") return no("This report is back with the rep. Wait for them to resubmit.");
    return no("The rep has not submitted this report yet.");
  }
  // return
  if (status === "submitted" || status === "manager_approved") return ok;
  if (status === "returned") return no("This report is already back with the rep.");
  return no("The rep has not submitted this report yet.");
}

/**
 * "Submit to Owner" stays off until EVERY rep expected this week has a report
 * the manager approved. One returned or missing report keeps the whole
 * company week pending (Bright, 1 Oct 2026).
 */
export function canSubmitToOwner(
  company: CompanyReportStatus | null,
  expectedRepIds: string[],
  reports: Array<{ repId: string; status: RepReportStatus }>
): Verdict & { missing?: string[]; notApproved?: string[] } {
  if (company === "submitted_to_owner") return no("This week is already with the owner.");
  if (company === "locked") return no("This week is approved and locked.");
  if (expectedRepIds.length === 0) return no("No sales rep has a report this week.");
  const byRep = new Map(reports.map((report) => [report.repId, report.status]));
  const missing = expectedRepIds.filter((id) => !byRep.has(id) || byRep.get(id) === "draft");
  const notApproved = expectedRepIds.filter((id) => byRep.has(id) && byRep.get(id) !== "draft" && byRep.get(id) !== "manager_approved");
  if (missing.length > 0 || notApproved.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`${missing.length} not submitted`);
    if (notApproved.length > 0) parts.push(`${notApproved.length} not approved`);
    return { ok: false, error: `Every rep's report must be approved first (${parts.join(", ")}).`, missing, notApproved };
  }
  return ok;
}

export type OwnerAction = "approve_lock" | "return" | "reopen";

export function canOwnerAct(action: OwnerAction, company: CompanyReportStatus | null): Verdict {
  const status = company ?? "open";
  if (action === "reopen") {
    return status === "locked" ? ok : no("Only a locked week can be reopened.");
  }
  if (status === "submitted_to_owner") return ok;
  if (status === "locked") return no("This week is already approved and locked.");
  if (status === "returned_to_manager") return no("This week is back with the manager. Wait for them to resubmit.");
  return no("The manager has not submitted this week yet.");
}

/**
 * The first week reps submit (Bright, 3 Oct 2026): Sun 27 Sept - Sat 3 Oct.
 * Earlier weeks are already settled, so no new report is started for them;
 * a report a manager already returned can still be answered.
 */
export const FIRST_REPORT_WEEK = "2026-09-27";

/** The Tuesday after the week (week Sun 20 - Sat 26 Sept -> Tue 29 Sept). */
export const reportDueDate = (weekStart: string) => {
  const date = new Date(`${weekStart}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 9);
  return date.toISOString().slice(0, 10);
};

export const isCorrectionSection = (value: unknown): value is CorrectionSection =>
  typeof value === "string" && (CORRECTION_SECTIONS as string[]).includes(value);
