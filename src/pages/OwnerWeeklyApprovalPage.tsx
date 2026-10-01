import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, BarChart3, Box, ChevronDown, ChevronRight, ClipboardList, Download, Eye, Lock, MoreVertical, RotateCcw,
  ShieldAlert, ShoppingCart, Target, Unlock, Wallet, CheckCircle2, Clock3
} from "lucide-react";
import {
  AuditTable, Avatar, ChartLegend, CompanyStatusPill, CorrectionForm, CorrectionList, KpiCard, Modal, NoteBox, NumberedHeader,
  OrdersRateChart, Panel, ProductDonut, RateBar, RepStatusPill, StepBadge, WeekPicker, WorkflowSteps, dailyChartRows, deltaPct,
  downloadCsv, longDate, nf, pctText, shortDateTime, type CorrectionDraft, type WorkflowStep
} from "../components/WeeklyReportParts";
import { CompanyProductTable, OrdersTable, RepBonusTable, RepReviewModal, shownSnapshot, type ReviewRepRow } from "./ManagerWeeklyReviewPage";
import { LogMissDisputesPanel } from "../components/LogMissParts";
import { HeadOfSalesBadge, headOfSalesBonusStatus } from "../components/HeadOfSalesParts";
import { buildCompanySnapshot, type CompanyWeeklySnapshot, type ManagerBonusPreview, type WeeklyReportSnapshot } from "./weekly-report-model";
import type { HeadOfSalesReview, LogMissDispute, WeeklyLogMissRow, ManagerFundTotals, WeeklyBonusQuery, WeeklyCompanyReport, WeeklyReportAuditEntry, WeeklyReportCorrection } from "../lib/api";
import { currencySymbol } from "../lib/money-privacy";

export type WeeklyFinancialSummary = {
  revenue: number;
  cogs: number;
  logistics: number;
  adSpend: number;
  staffBonuses: number;
  otherExpenses: number;
  contributionProfit: number;
  netProfit: number;
  previousNetProfit: number | null;
};

type RedFlag = { severity: "high" | "medium"; title: string; detail: string; repId?: string };

/**
 * Owner Weekly Report Approval (Bright's image 3, 1 Oct 2026).
 *
 * The final control layer: verification, exceptions, money, and Approve &
 * Lock. Nothing is calculated by hand here. The "Exceptions & Red Flags"
 * panel at the top was Bright's addition, so he does not have to read every
 * line to find what needs him.
 *
 * Approve & Lock freezes the week's figures. Reopening needs a reason and is
 * written to the audit trail for good.
 */
export default function OwnerWeeklyApprovalPage({
  weekStart, weekEnd, onShiftWeek, onPickWeek, canGoNext, loading, error,
  rows, company, corrections, audit, managerBonus, managerName, financial, lowRateThreshold, dueDate, bonusQueries = [],
  funds = [], renderFunds, logMisses = [], logMissDisputes = [], onDecideLogMiss,
  headOfSales = null, renderHeadOfSales,
  onApproveLock, onReturnToManager, onReopen, onBack
}: {
  weekStart: string;
  weekEnd: string;
  onShiftWeek: (weeks: number) => void;
  onPickWeek: (dateKey: string) => void;
  canGoNext: boolean;
  loading: boolean;
  error: string;
  rows: ReviewRepRow[];
  company: WeeklyCompanyReport | null;
  corrections: WeeklyReportCorrection[];
  audit: WeeklyReportAuditEntry[];
  managerBonus: ManagerBonusPreview | null;
  managerName: string | null;
  financial: WeeklyFinancialSummary | null;
  lowRateThreshold: number;
  /** The Tuesday the reps' reports are due. */
  dueDate?: string;
  bonusQueries?: WeeklyBonusQuery[];
  logMisses?: WeeklyLogMissRow[];
  logMissDisputes?: LogMissDispute[];
  onDecideLogMiss?: (id: string, outcome: "cancel" | "keep", note: string) => Promise<void>;
  /** Each manager wallet's week (Funds & Expenses). */
  funds?: Array<{ managerName: string; totals: ManagerFundTotals; readiness: string[]; varianceExplanation: string | null; returned: number }>;
  /** The Funds & Expenses tab (transactions, receipts, return, adjustments). */
  renderFunds?: () => ReactNode;
  /** The Head of Sales bonus review for this week (for the red flags). */
  headOfSales?: HeadOfSalesReview | null;
  /** The Head of Sales tab: her bonus, the script, who it helped, release/withhold. */
  renderHeadOfSales?: () => ReactNode;
  onApproveLock: (note: string) => Promise<void>;
  onReturnToManager: (draft: CorrectionDraft) => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
  onBack: () => void;
}) {
  const sym = currencySymbol();
  const [tab, setTab] = useState<"overview" | "reps" | "manager" | "headOfSales" | "bonus" | "funds" | "products" | "audit">("overview");
  const [viewing, setViewing] = useState<string | null>(null);
  const [requestChanges, setRequestChanges] = useState("");
  const [returning, setReturning] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [flagsOpen, setFlagsOpen] = useState(true);

  useEffect(() => { setRequestChanges(""); setActionError(""); }, [weekStart, company?.status]);

  const status = company?.status ?? "open";
  const expectedRows = rows.filter((row) => row.expected || row.report);
  const shown = expectedRows.map(shownSnapshot).filter((snap): snap is WeeklyReportSnapshot => !!snap);
  // What the owner approves is what the manager submitted. Until then, the
  // reps' figures as they stand.
  const frozenCompany = (company?.companySnapshot as CompanyWeeklySnapshot | null) ?? null;
  const liveCompany = useMemo(() => buildCompanySnapshot(weekStart, weekEnd, shown), [weekStart, weekEnd, shown]);
  const companySnap = frozenCompany ?? liveCompany;
  const totals = companySnap.totals;
  const prev = companySnap.previous;
  const frozenManagerBonus = (company?.managerBonusSnapshot as ManagerBonusPreview | null) ?? managerBonus;

  // ── Exceptions & Red Flags ───────────────────────────────────────────────
  const redFlags = useMemo<RedFlag[]>(() => {
    const flags: RedFlag[] = [];
    const missing = rows.filter((row) => row.expected && (!row.report || row.report.status === "draft"));
    const overdue = missing.filter((row) => row.overdue);
    if (overdue.length > 0) flags.push({ severity: "high", title: `${overdue.length} report${overdue.length === 1 ? "" : "s"} overdue`, detail: `${overdue.map((row) => row.repName).join(", ")}: not submitted by the end of Tuesday${dueDate ? `, ${longDate(dueDate)}` : ""}.` });
    else if (missing.length > 0) flags.push({ severity: "high", title: `${missing.length} report${missing.length === 1 ? "" : "s"} missing`, detail: missing.map((row) => row.repName).join(", ") });
    const late = rows.filter((row) => row.submittedLate);
    if (late.length > 0) flags.push({ severity: "medium", title: `${late.length} report${late.length === 1 ? "" : "s"} submitted late`, detail: `${late.map((row) => row.repName).join(", ")}: after the end of Tuesday${dueDate ? `, ${longDate(dueDate)}` : ""}.` });
    for (const row of expectedRows) {
      if (row.differences.length > 0) {
        flags.push({
          severity: "high", repId: row.repId,
          title: `${row.repName}: submitted figures no longer match the system`,
          detail: row.differences.slice(0, 4).map((item) => `${item.label} ${item.money ? sym + nf(item.submitted) : item.percent ? pctText(item.submitted) : nf(item.submitted)} → ${item.money ? sym + nf(item.now) : item.percent ? pctText(item.now) : nf(item.now)}`).join(" · ")
        });
      }
      if (row.editedAfterSubmit.length > 0) {
        flags.push({ severity: "medium", repId: row.repId, title: `${row.repName}: ${row.editedAfterSubmit.length} order change${row.editedAfterSubmit.length === 1 ? "" : "s"} after submission`, detail: Array.from(new Set(row.editedAfterSubmit.map((edit) => `#${edit.orderId}`))).slice(0, 8).join(", ") });
      }
      const snap = shownSnapshot(row);
      if (!snap) continue;
      if (snap.totals.manuallyAdjustedOrders > 0) {
        flags.push({ severity: "medium", repId: row.repId, title: `${row.repName}: bonus changed by hand on ${snap.totals.manuallyAdjustedOrders} order${snap.totals.manuallyAdjustedOrders === 1 ? "" : "s"}`, detail: snap.orders.filter((order) => order.bonusManuallyAdjusted && order.bonus > 0).map((order) => `#${order.id}`).slice(0, 8).join(", ") });
      }
      if (snap.totals.orders >= 5 && snap.totals.deliveryRate < lowRateThreshold) {
        flags.push({ severity: "medium", repId: row.repId, title: `${row.repName}: low delivery rate ${pctText(snap.totals.deliveryRate)}`, detail: `Below ${lowRateThreshold}% on ${snap.totals.orders} orders.` });
      }
      const before = snap.previous?.finalBonus ?? null;
      if (before !== null && Math.abs(snap.totals.finalBonus - before) >= 2000 && (before === 0 || Math.abs(snap.totals.finalBonus - before) / before >= 0.5)) {
        flags.push({ severity: "medium", repId: row.repId, title: `${row.repName}: bonus ${snap.totals.finalBonus > before ? "up" : "down"} sharply`, detail: `${sym}${nf(before)} last week → ${sym}${nf(snap.totals.finalBonus)} this week.` });
      }
    }
    const openFlags = corrections.filter((item) => item.kind === "flag" && item.status === "open");
    for (const item of openFlags) {
      const row = rows.find((candidate) => candidate.report?.id === item.repReportId);
      flags.push({ severity: item.section === "upsell_cross_sell" || item.section === "bonus" ? "high" : "medium", repId: row?.repId, title: `Flagged by ${item.raisedByName ?? "manager"}${row ? ` on ${row.repName}` : ""}: ${item.problem}`, detail: `${item.comment}${item.orderRef ? ` (${item.orderRef})` : ""}` });
    }
    const repNameOf = (id: string) => rows.find((row) => row.repId === id)?.repName ?? "a rep";
    const openQueries = bonusQueries.filter((query) => query.status === "open");
    if (openQueries.length > 0) {
      flags.push({ severity: "high", title: `${openQueries.length} bonus quer${openQueries.length === 1 ? "y" : "ies"} waiting for the manager`, detail: openQueries.map((query) => `${repNameOf(query.repId)} (week of ${longDate(query.weekStart)})`).join(", ") });
    }
    const paidHere = rows.filter((row) => (shownSnapshot(row)?.totals.adjustments ?? 0) > 0);
    for (const row of paidHere) {
      flags.push({ severity: "medium", repId: row.repId, title: `${row.repName}: bonus correction of ${sym}${nf(shownSnapshot(row)?.totals.adjustments ?? 0)} paid this week`, detail: (shownSnapshot(row)?.adjustments ?? []).map((item) => item.label).join("; ") });
    }
    const pendingMisses = logMisses.filter((miss) => miss.status === "pending");
    if (pendingMisses.length > 0) {
      const byRep = new Map<string, number>();
      for (const miss of pendingMisses) byRep.set(miss.repId, (byRep.get(miss.repId) ?? 0) + miss.amount);
      flags.push({ severity: "medium", title: `${sym}${nf(pendingMisses.reduce((sum, miss) => sum + miss.amount, 0))} of missed-log charges wait for your approval`, detail: `${Array.from(byRep.entries()).map(([repId, amount]) => `${rows.find((row) => row.repId === repId)?.repName ?? "a rep"} ${sym}${nf(amount)}`).join(", ")}. Not deducted until you approve them (Follow-up Queue / Abandoned Carts).` });
    }
    const ownerDisputes = logMissDisputes.filter((dispute) => dispute.status === "awaiting_owner");
    if (ownerDisputes.length > 0) {
      flags.push({ severity: "high", title: `${ownerDisputes.length} approved charge${ownerDisputes.length === 1 ? "" : "s"}: the manager asks you to cancel`, detail: "Only you can cancel a charge you already approved. See Sales Rep Reports → Missed-Log Disputes." });
    }
    for (const item of funds) {
      const variance = item.totals.variance;
      if (variance !== null && Math.abs(variance) >= 0.01) {
        flags.push({ severity: "high", title: `${item.managerName}'s wallet is ${variance < 0 ? "short" : "over"} by ${sym}${nf(Math.abs(variance))}`, detail: item.varianceExplanation ? `Her explanation: "${item.varianceExplanation}"` : "No explanation given yet." });
      }
      if (item.totals.actual === null) flags.push({ severity: "medium", title: `${item.managerName} has not counted her wallet balance`, detail: `Expected ${sym}${nf(item.totals.expected)}.` });
      if (item.totals.pending > 0) flags.push({ severity: "medium", title: `${item.managerName}: ${item.totals.pending} wallet entr${item.totals.pending === 1 ? "y needs" : "ies need"} proof or a correction`, detail: item.readiness.join(" ") });
      if (item.totals.otherIn > 0) flags.push({ severity: "medium", title: `${item.managerName}: ${sym}${nf(item.totals.otherIn)} of "other money in"`, detail: "Not a customer payment or company transfer. Check the proof." });
    }
    const hosStatus = headOfSalesBonusStatus(headOfSales);
    if (headOfSales?.head && hosStatus?.key === "held") {
      flags.push({ severity: "high", title: `${headOfSales.head.name}'s Head of Sales bonus (${sym}${nf(headOfSales.evaluation?.amount ?? 0)}) is on hold`, detail: `${(headOfSales.hold?.reasons ?? []).join(" ")} Release or withhold it in the Head of Sales tab.` });
    } else if (headOfSales?.head && hosStatus?.key === "ready" && headOfSales.weekOver) {
      flags.push({ severity: "medium", title: `${headOfSales.head.name}'s Head of Sales bonus (${sym}${nf(headOfSales.evaluation?.amount ?? 0)}) waits for your release`, detail: `Script submitted; used on ${nf(headOfSales.scriptUses ?? 0)} order${headOfSales.scriptUses === 1 ? "" : "s"} by other reps. See the Head of Sales tab.` });
    }
    if (frozenCompany) {
      const liveTotal = liveCompany.totals.totalBonus;
      if (Math.abs(liveTotal - frozenCompany.totals.totalBonus) > 0.5 || liveCompany.totals.orders !== frozenCompany.totals.orders) {
        flags.push({ severity: "high", title: "Company totals changed since the manager submitted", detail: `Orders ${nf(frozenCompany.totals.orders)} → ${nf(liveCompany.totals.orders)} · bonus ${sym}${nf(frozenCompany.totals.totalBonus)} → ${sym}${nf(liveTotal)}` });
      }
    }
    return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  }, [rows, expectedRows, corrections, frozenCompany, liveCompany, lowRateThreshold, sym, dueDate, bonusQueries, funds, logMisses, logMissDisputes, headOfSales]);

  const approvedCount = expectedRows.filter((row) => row.report && ["manager_approved", "owner_approved", "locked"].includes(row.report.status)).length;
  const submittedCount = expectedRows.filter((row) => row.report && row.report.status !== "draft").length;
  const steps: WorkflowStep[] = [
    { title: "Sales Reps Submit", detail: `${submittedCount} of ${expectedRows.length} reports submitted`, state: expectedRows.length > 0 && submittedCount === expectedRows.length ? "done" : "current" },
    { title: "Manager Review", detail: `${approvedCount} of ${expectedRows.length} reports approved`, state: status === "submitted_to_owner" || status === "locked" ? "done" : "current" },
    { title: "Owner Final Approval", detail: "Review complete report, verify data and approve", state: status === "locked" ? "done" : status === "submitted_to_owner" ? "current" : "pending", badge: status === "submitted_to_owner" ? <StepBadge tone="blue">In Progress</StepBadge> : status === "returned_to_manager" ? <StepBadge tone="gray">Returned to manager</StepBadge> : undefined },
    { title: "Week Locked", detail: "Reports locked and bonuses released", state: status === "locked" ? "done" : "pending", badge: status === "locked" && company?.lockedAt ? <StepBadge tone="green">{shortDateTime(company.lockedAt)}</StepBadge> : undefined }
  ];

  const statusMenuLabel = status === "submitted_to_owner" ? "Pending Approval" : status === "locked" ? "Approved & Locked" : status === "returned_to_manager" ? "Returned to Manager" : "With Manager";
  const viewingRow = rows.find((row) => row.repId === viewing) ?? null;
  const repNameById = (id: string | null) => rows.find((row) => row.repId === id)?.repName ?? "-";
  const repNameByReportId = (id: string | null) => rows.find((row) => row.report?.id === id)?.repName ?? "-";
  const allOrders = expectedRows.flatMap((row) => (shownSnapshot(row)?.orders ?? []).map((order) => ({ ...order, repName: row.repName })));

  const repTable = (
    <div className="overflow-x-auto px-3 pb-4 pt-3">
      <table className="w-full !min-w-[820px] text-left text-[12px]">
        <thead className="text-[11px] text-gray-600 dark:text-slate-400 [&_th]:[color:inherit]">
          <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
            {["#", "Sales Rep", "Report Status", "Orders", "Delivered", "Delivery Rate", `Cross-Sell (${sym})`, `Upsell (${sym})`, `Base (${sym})`, `Final (${sym})`, "Actions"].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2.5 font-bold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {expectedRows.map((row, index) => {
            const snap = shownSnapshot(row);
            const rowStatus = row.report?.status ?? "draft";
            return (
              <tr key={row.repId} className="border-t border-gray-100 dark:border-slate-800">
                <td className="px-2 py-3 text-gray-600">{index + 1}</td>
                <td className="px-2 py-3"><span className="flex items-center gap-2 whitespace-nowrap font-semibold text-gray-900 dark:text-slate-100"><Avatar name={row.repName} />{row.repName}{row.isHeadOfSales ? <HeadOfSalesBadge /> : null}</span></td>
                <td className="px-2 py-3">
                  <RepStatusPill status={rowStatus} approvedLabel="Approved" />
                  <span className="mt-0.5 block text-[11px] text-gray-500">{row.report?.managerReviewedAt ? shortDateTime(row.report.managerReviewedAt) : row.report?.submittedAt ? shortDateTime(row.report.submittedAt) : "Not submitted"}</span>
                  {row.submittedLate && <span className="mt-0.5 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Late</span>}
                  {row.overdue && <span className="mt-0.5 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Overdue</span>}
                </td>
                <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap?.totals.orders ?? 0)}</td>
                <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap?.totals.delivered ?? 0)}</td>
                <td className="px-2 py-3"><span className="flex items-center gap-2 text-gray-800 dark:text-slate-200"><span className="w-11">{pctText(snap?.totals.deliveryRate ?? 0)}</span><span className="w-14"><RateBar value={snap?.totals.deliveryRate ?? 0} /></span></span></td>
                <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap?.totals.crossSellBonus ?? 0)}</td>
                <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap?.totals.upsellBonus ?? 0)}</td>
                <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap?.totals.baseBonus ?? 0)}</td>
                <td className="px-2 py-3 font-bold text-gray-900 dark:text-slate-100">{nf(snap?.totals.finalBonus ?? 0)}</td>
                <td className="px-2 py-3">
                  <span className="flex items-center gap-1">
                    <button type="button" onClick={() => setViewing(row.repId)} className="!min-h-0 rounded-lg bg-blue-50 px-2 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-200">View</button>
                    <button type="button" aria-label={`Open ${row.repName}`} onClick={() => setViewing(row.repId)} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
                  </span>
                </td>
              </tr>
            );
          })}
          {expectedRows.length === 0 && <tr><td colSpan={11} className="px-2 py-8 text-center text-gray-500">{loading ? "Loading reports…" : "No sales rep had orders this week."}</td></tr>}
          <tr className="border-t border-gray-200 font-bold text-gray-900 dark:border-slate-700 dark:text-slate-50 [&>td]:[color:inherit]">
            <td className="px-2 py-3" colSpan={2}>Total</td><td className="px-2 py-3">-</td>
            <td className="px-2 py-3">{nf(totals.orders)}</td><td className="px-2 py-3">{nf(totals.delivered)}</td>
            <td className="px-2 py-3"><span className="flex items-center gap-2"><span className="w-11">{pctText(totals.deliveryRate)}</span><span className="w-14"><RateBar value={totals.deliveryRate} tone="green" /></span></span></td>
            <td className="px-2 py-3">{nf(totals.crossSellBonus)}</td><td className="px-2 py-3">{nf(totals.upsellBonus)}</td>
            <td className="px-2 py-3">{nf(totals.baseBonus)}</td><td className="px-2 py-3">{nf(totals.totalBonus)}</td><td />
          </tr>
        </tbody>
      </table>
    </div>
  );

  const exportReps = () => downloadCsv(`weekly-report-${weekStart}.csv`,
    ["Sales Rep", "Status", "Orders", "Delivered", "Delivery Rate", "Cross-Sell Bonus", "Upsell Bonus", "Base Bonus", "Fines", "Final Bonus"],
    expectedRows.map((row) => {
      const snap = shownSnapshot(row);
      return [row.repName, row.report?.status ?? "draft", snap?.totals.orders ?? 0, snap?.totals.delivered ?? 0, snap?.totals.deliveryRate ?? 0, snap?.totals.crossSellBonus ?? 0, snap?.totals.upsellBonus ?? 0, snap?.totals.baseBonus ?? 0, snap?.totals.fines ?? 0, snap?.totals.finalBonus ?? 0];
    }));

  const managerReportPanel = (
    <Panel>
      <NumberedHeader n={3} title="Manager Report" right={<button type="button" onClick={() => setTab("manager")} className="!min-h-0 mr-5 mt-4 inline-flex items-center gap-1.5 rounded-lg border border-blue-200 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-200"><Eye className="h-3.5 w-3.5" /> View Details</button>} />
      <div className="px-5 pb-5 pt-3">
        <div className="flex items-center gap-3">
          <Avatar name={managerName ?? "Manager"} size={40} />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">{managerName ?? "Manager"}</p>
            <p className="m-0 text-[12px] text-gray-500">{company?.submittedAt ? `Submitted: ${shortDateTime(company.submittedAt)}` : "Not submitted yet"}</p>
          </div>
          {status === "submitted_to_owner" || status === "locked"
            ? <RepStatusPill status="manager_approved" approvedLabel="Approved" />
            : <CompanyStatusPill status={status} />}
        </div>
        {company?.managerNote && <p className="m-0 mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-700 dark:bg-slate-800 dark:text-slate-200">"{company.managerNote}"</p>}
        <table className="!min-w-0 mt-3 w-full text-[12px]">
          <tbody className="text-gray-800 dark:text-slate-200 [&_td]:[color:inherit]">
            <tr className="border-b border-gray-100 dark:border-slate-800"><td className="whitespace-nowrap py-2 pr-3">Manager Bonus</td><td className="py-2 font-bold">{sym}{nf(frozenManagerBonus?.performanceBonus ?? 0)}</td><td className="min-w-[140px] py-2 text-[11px] text-gray-500">{frozenManagerBonus?.performanceNote ?? ""}</td></tr>
            <tr className="border-b border-gray-100 dark:border-slate-800"><td className="whitespace-nowrap py-2 pr-3">Weekly Support Bonus</td><td className="py-2 font-bold">{sym}{nf(frozenManagerBonus?.supportBonus ?? 0)}</td><td className="min-w-[140px] py-2 text-[11px] text-gray-500">{frozenManagerBonus?.supportNote ?? ""}</td></tr>
            <tr className="bg-violet-50 font-bold text-violet-900 dark:bg-violet-500/10 dark:text-violet-100 [&>td]:[color:inherit]"><td className="whitespace-nowrap px-2 py-2.5 text-[13px]">Total Manager Bonus</td><td className="py-2.5 text-[16px]" colSpan={2}>{sym}{nf(frozenManagerBonus?.total ?? 0)}</td></tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );

  // Manager Funds & Expenses, as Bright drew it in his notes: the six lines,
  // and a way into the transactions only when something looks wrong.
  const fundsCard = funds.length === 0 ? null : (
    <Panel>
      <NumberedHeader n={5} title="Manager Funds & Expenses" right={
        <button type="button" onClick={() => setTab("funds")} className="!min-h-0 mr-5 mt-4 rounded-lg border border-blue-200 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-200">View transactions & receipts</button>
      } />
      <div className="grid grid-cols-1 gap-3 px-5 pb-5 pt-3 lg:grid-cols-2">
        {funds.map((item) => (
          <div key={item.managerName} className="rounded-xl border border-gray-100 p-3 text-[12px] dark:border-slate-800">
            <p className="m-0 font-bold text-gray-900 dark:text-slate-100">{item.managerName}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700 dark:text-slate-300">
              <span>Opening</span><span className="text-right">{sym}{nf(item.totals.opening)}</span>
              <span>Received</span><span className="text-right">{sym}{nf(item.totals.received)}</span>
              <span>Spent</span><span className="text-right">{sym}{nf(item.totals.spent)}</span>
              <span>Remitted</span><span className="text-right">{sym}{nf(item.totals.remitted)}</span>
              <span className="font-bold">Expected Balance</span><span className="text-right font-bold">{sym}{nf(item.totals.expected)}</span>
              <span>Actual Balance</span><span className="text-right">{item.totals.actual === null ? "Not counted" : `${sym}${nf(item.totals.actual)}`}</span>
              <span className="font-bold">Variance</span>
              <span className={`text-right font-bold ${item.totals.variance === null ? "text-gray-400" : Math.abs(item.totals.variance) < 0.01 ? "text-emerald-700" : "text-rose-600"}`}>{item.totals.variance === null ? "—" : Math.abs(item.totals.variance) < 0.01 ? `${sym}0 ✓` : `${item.totals.variance < 0 ? "−" : "+"}${sym}${nf(Math.abs(item.totals.variance))}`}</span>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );

  const financialPanel = (
    <Panel>
      <NumberedHeader n={4} title="Financial Summary (Estimated)" right={<button type="button" onClick={() => setTab("bonus")} className="!min-h-0 mr-5 mt-4 rounded-lg border border-blue-200 px-3 py-1.5 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 dark:border-blue-500/30 dark:text-blue-200">View Details</button>} />
      <div className="px-5 pb-5 pt-3">
        {financial ? (
          <table className="!min-w-0 w-full text-[12px]">
            <tbody className="text-gray-800 dark:text-slate-200 [&_td]:[color:inherit]">
              {([
                ["Total Revenue", financial.revenue],
                ["Cost of Goods Sold (COGS)", financial.cogs],
                ["Delivery & Logistics", financial.logistics],
                ["Facebook Ads", financial.adSpend],
                ["Staff Bonuses (Sales Reps + Manager)", financial.staffBonuses],
                ["Other Expenses", financial.otherExpenses]
              ] as const).map(([label, value]) => (
                <tr key={label} className="border-b border-gray-100 dark:border-slate-800"><td className="py-2">{label}</td><td className="py-2 text-right font-semibold">{sym}{nf(value)}</td></tr>
              ))}
              <tr className="bg-emerald-50 font-bold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200 [&>td]:[color:inherit]"><td className="px-2 py-2.5 text-[13px]">Estimated Net Profit</td><td className="px-2 py-2.5 text-right text-[16px]">{sym}{nf(financial.netProfit)}</td></tr>
            </tbody>
          </table>
        ) : <p className="m-0 text-[12px] text-gray-500">Working out the week's money…</p>}
        <p className="m-0 mt-2 text-[11px] text-gray-500">From orders delivered and expenses dated {longDate(weekStart)} – {longDate(weekEnd)}. Same maths as Finance & Accounting.</p>
      </div>
    </Panel>
  );

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <nav className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-slate-400" aria-label="Breadcrumb">
            <button type="button" onClick={onBack} className="!min-h-0 font-medium text-[#1F8FE0] hover:underline">← Owner Dashboard</button>
            <ChevronRight className="h-3.5 w-3.5" /><span className="font-medium text-[#1F8FE0]">Weekly Reports</span>
            <ChevronRight className="h-3.5 w-3.5" /><span>Approval</span>
          </nav>
          <div className="mt-3 flex items-start gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"><ClipboardList className="h-7 w-7" /></span>
            <div>
              <h1 className="m-0 text-2xl font-black tracking-tight text-gray-900 dark:text-slate-50">Weekly Report Approval</h1>
              <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-slate-400">Review the complete weekly report, verify all data, and approve for final payment and lock.</p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 xl:flex-nowrap">
          <WeekPicker weekStart={weekStart} weekEnd={weekEnd} onShift={onShiftWeek} canGoNext={canGoNext} onPick={onPickWeek} />
          <span className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-[13px] font-bold ${status === "locked" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "submitted_to_owner" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
            {status === "locked" ? <Lock className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}{statusMenuLabel}<ChevronDown className="h-4 w-4 opacity-60" />
          </span>
        </div>
      </div>

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}

      {/* ── Exceptions & Red Flags (Bright's addition) ───────────── */}
      <section className={`rounded-2xl border shadow-sm ${redFlags.length > 0 ? "border-rose-200 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-500/5" : "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/5"}`}>
        <button type="button" onClick={() => setFlagsOpen(!flagsOpen)} className="!min-h-0 flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left">
          <span className="flex items-center gap-2.5">
            {redFlags.length > 0 ? <ShieldAlert className="h-5 w-5 text-rose-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
            <span className="text-[15px] font-bold text-gray-900 dark:text-slate-50">Exceptions &amp; Red Flags</span>
            <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${redFlags.length > 0 ? "bg-rose-500" : "bg-emerald-500"}`}>{redFlags.length}</span>
          </span>
          <span className="text-[12px] text-gray-600 dark:text-slate-300">{redFlags.length > 0 ? "Where your attention is needed this week" : "Nothing needs your attention this week"}<ChevronDown className={`ml-1 inline h-4 w-4 transition-transform ${flagsOpen ? "rotate-180" : ""}`} /></span>
        </button>
        {flagsOpen && redFlags.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-1 gap-2 px-5 pb-4 pt-0 lg:grid-cols-2">
            {redFlags.map((flag, index) => (
              <li key={`${flag.title}-${index}`} className="flex items-start gap-2.5 rounded-xl bg-white p-3 dark:bg-slate-900">
                <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${flag.severity === "high" ? "text-rose-600" : "text-amber-500"}`} />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13px] font-semibold text-gray-900 dark:text-slate-100">{flag.title}</p>
                  {flag.detail && <p className="m-0 mt-0.5 text-[12px] text-gray-600 dark:text-slate-300">{flag.detail}</p>}
                </div>
                {flag.repId && <button type="button" onClick={() => setViewing(flag.repId!)} className="!min-h-0 shrink-0 text-[12px] font-bold text-blue-700 hover:underline dark:text-blue-300">View</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── KPI cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        <KpiCard tone="blue" icon={ShoppingCart} label="Total Orders" value={nf(totals.orders)} delta={deltaPct(totals.orders, prev?.orders)} sub={`vs previous week (${nf(prev?.orders ?? 0)})`} />
        <KpiCard tone="green" icon={Box} label="Delivered Orders" value={nf(totals.delivered)} delta={deltaPct(totals.delivered, prev?.delivered)} sub={`vs previous week (${nf(prev?.delivered ?? 0)})`} />
        <KpiCard tone="orange" icon={Target} label="Delivery Rate" value={pctText(totals.deliveryRate)} delta={prev ? Math.round((totals.deliveryRate - prev.deliveryRate) * 10) / 10 : null} sub={`vs previous week (${pctText(prev?.deliveryRate ?? 0)})`} />
        <KpiCard tone="purple" icon={Wallet} label="Total Bonus Payable" labelTone="text-violet-700 dark:text-violet-300" value={`${sym}${nf(totals.totalBonus)}`} delta={deltaPct(totals.totalBonus, prev?.totalBonus)} sub={`vs previous week (${sym}${nf(prev?.totalBonus ?? 0)})`} />
        <KpiCard tone="red" icon={BarChart3} label="Net Profit (Est.)" value={`${sym}${nf(financial?.netProfit ?? 0)}`} delta={financial ? deltaPct(financial.netProfit, financial.previousNetProfit) : null} sub="After bonuses, ads & logistics" />
      </div>

      {/* ── Tabs ───────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {([["overview", "Company Overview"], ["reps", "Sales Rep Reports"], ["manager", "Manager Report"], ...(renderHeadOfSales ? [["headOfSales", "Head of Sales"]] as const : []), ["bonus", "Bonus Breakdown"], ["funds", "Funds & Expenses"], ["products", "Product Performance"], ["audit", "Audit Trail"]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`!min-h-0 whitespace-nowrap rounded-lg px-5 py-2.5 text-[13px] font-semibold ${tab === key ? "bg-[#1F6FEB] text-white shadow-sm" : "bg-white text-gray-600 hover:text-gray-900 dark:bg-slate-900 dark:text-slate-300"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1fr)]">
        <Panel>
          <div className="px-5 pt-4">
            <h2 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Weekly Company Summary</h2>
            <p className="m-0 mt-0.5 text-[12px] text-gray-500">Overall performance for {longDate(weekStart).replace(/ \d{4}$/, "")} – {longDate(weekEnd)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
            <MiniTile tone="blue" icon={ShoppingCart} label="Total Orders" value={nf(totals.orders)} />
            <MiniTile tone="green" icon={Box} label="Delivered Orders" value={nf(totals.delivered)} />
            <MiniTile tone="orange" icon={Target} label="Delivery Rate" value={pctText(totals.deliveryRate)} />
            <MiniTile tone="red" icon={BarChart3} label="Total Revenue" value={`${sym}${nf(financial?.revenue ?? 0)}`} />
            <MiniTile tone="green" icon={Box} label="Contribution Profit (Est.)" value={`${sym}${nf(financial?.contributionProfit ?? 0)}`} />
            <MiniTile tone="purple" icon={Wallet} label="Total Bonus Payable" value={`${sym}${nf(totals.totalBonus)}`} />
          </div>
        </Panel>
        <Panel>
          <NumberedHeader n={2} title="Orders & Delivery Trend" />
          <ChartLegend items={[{ label: "Orders", color: "#3b82f6" }, { label: "Delivered", color: "#10b981" }, { label: "Delivery Rate", color: "#f97316" }]} />
          <div className="px-3 pb-4 pt-2"><OrdersRateChart rows={dailyChartRows(companySnap.daily)} ordersColor="#3b82f6" deliveredColor="#10b981" height={210} /></div>
        </Panel>
        <Panel>
          <div className="flex items-center gap-2 px-5 pt-4"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600"><Box className="h-4 w-4" /></span><h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Product Breakdown (Orders)</h2></div>
          <ProductDonut products={companySnap.products} compact />
        </Panel>
      </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          {tab === "overview" && (
            <>
              <Panel>
                <NumberedHeader n={1} title="Sales Rep Reports" subtitle="Review each sales rep report. All must be approved before final submission." right={
                  <button type="button" onClick={exportReps} className="!min-h-0 mr-5 mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-100"><Download className="h-4 w-4" /> Export</button>
                } />
                {repTable}
              </Panel>

              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                {managerReportPanel}
                {financialPanel}
              </div>
              {fundsCard}
            </>
          )}

          {tab === "reps" && (
            <Panel>
              <NumberedHeader title="Sales Rep Reports" subtitle="Each rep's report as approved by the manager." right={
                <button type="button" onClick={exportReps} className="!min-h-0 mr-5 mt-4 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-800 dark:border-slate-700 dark:text-slate-100"><Download className="h-4 w-4" /> Export</button>
              } />
              {repTable}
              {onDecideLogMiss && (
                <div className="border-t border-gray-100 p-3 dark:border-slate-800">
                  <LogMissDisputesPanel disputes={logMissDisputes} repName={(id) => rows.find((row) => row.repId === id)?.repName ?? "A rep"} canDecide isOwner onDecide={onDecideLogMiss} />
                </div>
              )}
              <div className="border-t border-gray-100 pt-3 dark:border-slate-800">
                <p className="m-0 px-5 text-[13px] font-bold text-gray-900 dark:text-slate-100">Returns, flags and answers</p>
                <div className="pt-2"><CorrectionList corrections={corrections.filter((item) => item.repReportId)} repNameById={repNameByReportId} empty={<p className="m-0 px-5 pb-5 text-[12px] text-gray-500">No returns or flags this week.</p>} /></div>
              </div>
            </Panel>
          )}

          {tab === "manager" && (
            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {managerReportPanel}
              <Panel>
                <NumberedHeader title="Returns to the manager" subtitle="Every time this week came back to the manager, and their answer." />
                <div className="pt-3"><CorrectionList corrections={corrections.filter((item) => item.companyReportId)} empty={<p className="m-0 px-5 pb-5 text-[12px] text-gray-500">Not returned this week.</p>} /></div>
              </Panel>
            </div>
          )}

          {tab === "bonus" && (
            <div className="space-y-5">
              <Panel><NumberedHeader title="Bonus Breakdown" subtitle="Each rep's bonus, as approved." /><RepBonusTable snaps={shown} sym={sym} /></Panel>
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">{managerReportPanel}{financialPanel}</div>
            </div>
          )}

          {tab === "products" && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Panel><NumberedHeader title="Product Performance" subtitle="Orders placed this week and how many delivered." /><CompanyProductTable products={companySnap.products} totals={totals} /></Panel>
                <Panel><NumberedHeader title="Product Breakdown (Orders)" /><ProductDonut products={companySnap.products} /></Panel>
              </div>
              <Panel><NumberedHeader title="All Orders" subtitle="Every order in the reps' reports." /><div className="px-3 pb-4 pt-3"><OrdersTable rows={allOrders} sym={sym} /></div></Panel>
            </div>
          )}

          {tab === "funds" && (renderFunds ? renderFunds() : null)}

          {tab === "headOfSales" && (renderHeadOfSales ? renderHeadOfSales() : null)}

          {tab === "audit" && <Panel className="p-2"><AuditTable entries={audit} repName={repNameById} /></Panel>}
        </div>

        {/* ── Right column ─────────────────────────────────────── */}
        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Approval Workflow</h2>
            <div className="mt-4"><WorkflowSteps steps={steps} /></div>
            {status === "locked" ? (
              <>
                <p className="m-0 mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"><Lock className="h-4 w-4" /> Locked {shortDateTime(company?.lockedAt)}. Figures are frozen.</p>
                <button type="button" onClick={() => setReopening(true)} className="!min-h-0 mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 px-4 py-2.5 text-[13px] font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200"><Unlock className="h-4 w-4" /> Reopen Week</button>
              </>
            ) : (
              <>
                <button type="button" disabled={status !== "submitted_to_owner" || busy} onClick={async () => {
                  setBusy(true); setActionError("");
                  try { await onApproveLock(requestChanges.trim()); } catch (err: any) { setActionError(err?.message ?? "Could not approve."); } finally { setBusy(false); }
                }} className="!min-h-0 mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-[13px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">
                  <Lock className="h-4 w-4" /> {busy ? "Locking…" : "Approve & Lock Weekly Report"}
                </button>
                <button type="button" disabled={status !== "submitted_to_owner" || busy} onClick={() => setReturning(true)}
                  className="!min-h-0 mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2.5 text-[13px] font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-900">
                  <RotateCcw className="h-4 w-4" /> Return to Manager
                </button>
                {status !== "submitted_to_owner" && <p className="m-0 mt-2 text-[11px] text-gray-500">{status === "returned_to_manager" ? "Back with the manager for corrections." : "The manager has not submitted this week yet."}</p>}
              </>
            )}
            {actionError && <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{actionError}</p>}
          </Panel>
          {status !== "locked" && (
            <Panel className="p-5">
              <p className="m-0 mb-2 text-[14px] font-bold text-gray-900 dark:text-slate-50">Request Changes</p>
              <NoteBox label="" value={requestChanges} onChange={setRequestChanges} disabled={status !== "submitted_to_owner"} placeholder="Send back to manager with comments..." />
              <p className="m-0 text-[11px] text-gray-500">Used as the comment when you press Return to Manager, or as your approval note.</p>
            </Panel>
          )}
          {company?.reopenedAt && (
            <Panel className="p-5">
              <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-50">Reopened</p>
              <p className="m-0 mt-1 text-[12px] text-gray-600 dark:text-slate-300">{shortDateTime(company.reopenedAt)} — {company.reopenReason}</p>
            </Panel>
          )}
        </div>
      </div>

      {viewingRow && (
        <RepReviewModal row={viewingRow} weekStart={weekStart} weekEnd={weekEnd} sym={sym} canAct={false} canFlag={false} ownerView
          corrections={corrections.filter((item) => viewingRow.report && item.repReportId === viewingRow.report.id)} onClose={() => setViewing(null)} />
      )}
      {returning && (
        <CorrectionForm title="Return to Manager" subtitle="Say exactly what needs fixing. The manager must answer before resubmitting." submitLabel="Return to Manager" tone="rose"
          initialComment={requestChanges} onCancel={() => setReturning(false)}
          onSubmit={async (draft) => { await onReturnToManager(draft); setReturning(false); setRequestChanges(""); }} />
      )}
      {reopening && (
        <Modal title="Reopen this week" subtitle="Reopening unlocks the figures. The reason is kept in the audit trail for good." onClose={() => setReopening(false)}>
          <div className="space-y-3 px-6 py-5">
            <textarea rows={4} value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="Why does this week need reopening?"
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            {actionError && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setReopening(false)} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="button" disabled={reopenReason.trim().length < 5 || busy} onClick={async () => {
                setBusy(true); setActionError("");
                try { await onReopen(reopenReason.trim()); setReopening(false); setReopenReason(""); } catch (err: any) { setActionError(err?.message ?? "Could not reopen."); } finally { setBusy(false); }
              }} className="!min-h-0 rounded-xl bg-gray-900 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">Reopen Week</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function MiniTile({ tone, icon: Icon, label, value }: { tone: "blue" | "green" | "orange" | "red" | "purple"; icon: typeof Box; label: string; value: string }) {
  const tile = { blue: "bg-blue-100 text-blue-600", green: "bg-emerald-100 text-emerald-600", orange: "bg-orange-100 text-orange-500", red: "bg-rose-100 text-rose-500", purple: "bg-violet-100 text-violet-600" }[tone];
  return (
    <div className="min-w-0 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tile}`}><Icon className="h-3.5 w-3.5" /></span>
        <p className="m-0 text-[11px] leading-tight text-gray-600 dark:text-slate-400">{label}</p>
      </div>
      <p className="m-0 mt-2 whitespace-nowrap text-[15px] font-black text-gray-900 dark:text-slate-50">{value}</p>
    </div>
  );
}
