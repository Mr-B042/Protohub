// Labels and colours for Issue Management (Bright, 9 Oct 2026). The status
// steps mirror backend/src/lib/issue-rules.ts - keep the two in step.
import type { BugReportKind, BugReportStatus, IssueImpact, IssuePriority } from "./api";

export const BUG_STEPS: BugReportStatus[] = ["new", "triaged", "assigned", "in_progress", "testing", "resolved", "closed", "reopened", "needs_info", "duplicate", "wont_fix", "planned"];
export const FEATURE_STEPS: BugReportStatus[] = ["new", "under_review", "approved", "planned", "in_development", "released", "closed", "needs_info", "duplicate", "wont_fix"];
export const stepsFor = (kind: BugReportKind) => (kind === "feature" ? FEATURE_STEPS : BUG_STEPS);
export const STATUS_LABEL: Record<BugReportStatus, string> = {
  new: "New", triaged: "Triaged", assigned: "Assigned", in_progress: "In Progress", testing: "Testing", resolved: "Resolved",
  closed: "Closed", reopened: "Reopened", needs_info: "Needs More Information", duplicate: "Duplicate", wont_fix: "Won't Fix",
  planned: "Planned", under_review: "Under Review", approved: "Approved", in_development: "In Development", released: "Released"
};
export const STATUS_TONE: Record<BugReportStatus, string> = {
  new: "bg-blue-50 text-blue-700 ring-blue-200", triaged: "bg-indigo-50 text-indigo-700 ring-indigo-200", assigned: "bg-violet-50 text-violet-700 ring-violet-200",
  in_progress: "bg-amber-50 text-amber-800 ring-amber-200", testing: "bg-cyan-50 text-cyan-800 ring-cyan-200", resolved: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  closed: "bg-gray-100 text-gray-600 ring-gray-200", reopened: "bg-rose-50 text-rose-700 ring-rose-200", needs_info: "bg-orange-50 text-orange-800 ring-orange-200",
  duplicate: "bg-gray-100 text-gray-600 ring-gray-200", wont_fix: "bg-gray-100 text-gray-600 ring-gray-200", planned: "bg-sky-50 text-sky-700 ring-sky-200",
  under_review: "bg-indigo-50 text-indigo-700 ring-indigo-200", approved: "bg-violet-50 text-violet-700 ring-violet-200", in_development: "bg-amber-50 text-amber-800 ring-amber-200",
  released: "bg-emerald-50 text-emerald-700 ring-emerald-200"
};
export const DONE: BugReportStatus[] = ["closed", "duplicate", "wont_fix"];
export const AWAITING: BugReportStatus[] = ["resolved", "released"];
export const isOpenStatus = (status: BugReportStatus) => !DONE.includes(status) && !AWAITING.includes(status);
export const KIND_LABEL: Record<BugReportKind, string> = { issue: "Bug", feature: "Feature", ux: "UI/UX", other: "Other" };
export const IMPACT_LABEL: Record<IssueImpact, string> = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
export const IMPACT_TONE: Record<IssueImpact, string> = { low: "text-blue-700", medium: "text-amber-700", high: "text-orange-700", critical: "text-rose-700" };
export const PRIORITY_TONE: Record<IssuePriority, string> = { P0: "bg-rose-600 text-white", P1: "bg-orange-500 text-white", P2: "bg-amber-100 text-amber-800", P3: "bg-gray-100 text-gray-700" };
export const AFFECTED_LABEL: Record<string, string> = { only_me: "Only me", one_customer: "One customer / order", several_users: "Several users", department: "One department", everyone: "Everyone", not_sure: "Not sure" };
export const FREQUENCY_LABEL: Record<string, string> = { first_time: "First time", sometimes: "Sometimes", every_time: "Every time", started_today: "Started today", several_days: "For several days", not_sure: "Not sure" };
export const REF_LABEL: Record<string, string> = { order: "Order", customer: "Customer", product: "Product", delivery: "Delivery", sales_rep: "Sales Rep" };

export function ago(iso: string | null | undefined) {
  if (!iso) return "—";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}
export const stamp = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
