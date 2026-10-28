import MonthlyIncentiveSection from "./MonthlyIncentiveSection";
import WeeklyRepReportModal from "../components/WeeklyRepReportModal";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Box, Check, CheckCircle2, ChevronRight, ClipboardList, Download, FileText, Inbox, MessageCircle, MoreVertical,
  Pencil, RotateCcw, Search, Send, ShoppingCart, Target, Undo2, Wallet, X, Crown, Flag, History, Users, BarChart3, ChevronLeft
} from "lucide-react";
import {
  Avatar, AuditTable, BonusInitialCells, ChartLegend, CorrectionForm, CorrectionList, KpiCard, Modal, NoteBox, NumberedHeader, OrderStatusPill, PayoutChangeForm, PayoutChangeNote, MissingFeeNote, LateSendNote, type LateSendWeek,
  OrderTypePill, OrdersRateChart, Panel, ProductDonut, RateBar, RepStatusPill, StepBadge, WeekPicker, WorkflowSteps,
  dailyChartRows, deltaPct, downloadCsv, longDate, nf, pctText, shortDateTime, shortDay, type CorrectionDraft, type WorkflowStep
} from "../components/WeeklyReportParts";
import { LogMissDisputesPanel } from "../components/LogMissParts";
import { OrderDecisionsModal, undecidedCount, type DecisionKind } from "../components/OrderDecisionsModal";
import { HeadOfSalesBadge } from "../components/HeadOfSalesParts";
import {
  CORRECTION_SECTION_LABEL, bonusComponentsFull, bonusInitialFinal, buildCompanySnapshot, type ManagerBonusPreview, type MonthlyIncentiveReport, type SnapshotDifference, type WeeklyReportSnapshot
} from "./weekly-report-model";
import type {
  LogMissDispute, ManagerFundTotals, WeeklyBonusQuery, WeeklyPayoutChange, WeeklyCompanyReport, WeeklyRepReport, WeeklyReportAuditEntry, WeeklyReportCorrection, WeeklyReportResponseInput
} from "../lib/api";
import { currencySymbol } from "../lib/money-privacy";

type RepFilter = "all" | "pending" | "sent" | "awaiting" | "approved" | "returned";

export type TopTab = "overview" | "reps" | "bonus" | "headOfSales" | "funds" | "financial" | "orders" | "audit";

export type ReviewRepRow = {
  repId: string;
  repName: string;
  /** Had orders this week, so the week needs their report. */
  expected: boolean;
  report: WeeklyRepReport | null;
  /** Worked out now from today's records. */
  live: WeeklyReportSnapshot | null;
  /** What the rep submitted (null until they submit). */
  frozen: WeeklyReportSnapshot | null;
  /** Frozen vs live. Empty = everything still matches. */
  differences: SnapshotDifference[];
  editedAfterSubmit: Array<{ orderId: string; editedAt: string; what: string; by: string | null }>;
  /** First submitted after the end of the due Tuesday. */
  submittedLate?: boolean;
  /** Expected, still not submitted, and the due Tuesday has passed. */
  overdue?: boolean;
  /** The Head of Sales Rep: shown with the lilac crown badge. */
  isHeadOfSales?: boolean;
  /** The manager's change to this rep's final payout (already laid over live/frozen). */
  payoutChange?: WeeklyPayoutChange | null;
  /** Orders not sent out in 15 working minutes, and fines added for them (leadership only). */
  lateSend?: LateSendWeek | null;
};

/** The figures a row shows: what was submitted, or today's if not submitted yet. */
export const shownSnapshot = (row: ReviewRepRow) => row.frozen ?? row.live;

const isApproved = (status?: string) => status === "manager_approved" || status === "owner_approved" || status === "locked";
const isSubmittedish = (status?: string) => status === "submitted" || isApproved(status);

/**
 * Manager Weekly Report Review (Bright's image 2, 1 Oct 2026).
 *
 * The manager reviews, checks exceptions and approves - never recalculates.
 * "Submit to Owner" stays off until EVERY rep expected this week is approved
 * (the server enforces the same rule in canSubmitToOwner).
 *
 * mode "submit" is the manager's own "Submit My Report" view: the company
 * summary, their own bonus and the submit panel, without the rep table.
 */
export default function ManagerWeeklyReviewPage({
  mode, weekStart, weekEnd, onShiftWeek, onPickWeek, canGoNext, loading, error,
  rows, company, corrections, audit, managerBonus, canAct, readOnlyReason, dueDate, onOpenHistory,
  bonusQueries = [], canResolveQueries = false, onResolveBonusQuery,
  renderFunds, fundsPending, fundsSummary, onSaveDraftNote, initialTab, logMissDisputes = [], onDecideLogMiss,
  renderHeadOfSales, headOfSalesAttention = false,
  onApprove, onReturn, onFlag, onSubmitToOwner, onBack, onEditManagerBonus, monthlyIncentive = null,
  onSavePayoutChange, onRemovePayoutChange, repsWaiting = false, waitingWeeks = [], onDecideOrder, onUndoOrderDecision, onRemoveLateSendFine, orderDecisionsReady = true
}: {
  /** false until the decisions table exists on the database: Approve is not held. */
  orderDecisionsReady?: boolean;
  /** Charge or skip one "No fee" / "Late send" order (Admin / Manager / Owner). Every one needs a decision before Approve. */
  onDecideOrder?: (repId: string, kind: DecisionKind, orderId: string, decision: "charged" | "skipped", amount: number | undefined, reason: string) => Promise<void>;
  onUndoOrderDecision?: (id: string) => Promise<void>;
  /** Remove a lump late-send fine added before order-by-order decisions. */
  onRemoveLateSendFine?: (id: string) => Promise<void>;
  /** Weeks with reports waiting on the manager (any week, not only the one on screen). */
  waitingWeeks?: Array<{ weekStart: string; toApprove: number; approved: number; returned: number }>;
  /** Add to or take off a rep's final payout (signed amount), with a reason. */
  onSavePayoutChange?: (repId: string, amount: number, reason: string) => Promise<void>;
  onRemovePayoutChange?: (repId: string) => Promise<void>;
  /** Reps cannot send THIS week's report yet: last week is not with the owner. */
  repsWaiting?: boolean;
  /** The month's incentive, only in the week the month ends. */
  monthlyIncentive?: MonthlyIncentiveReport | null;
  bonusQueries?: WeeklyBonusQuery[];
  logMissDisputes?: LogMissDispute[];
  onDecideLogMiss?: (id: string, outcome: "cancel" | "keep", note: string) => Promise<void>;
  /** The Funds & Expenses tab, rendered by the parent; receives the notes/submit bar. */
  renderFunds?: (footer: ReactNode) => ReactNode;
  /** The Head of Sales tab: her bonus, the week's script and who it helped. */
  renderHeadOfSales?: () => ReactNode;
  /** Her bonus is on hold for the Owner (dot on the tab). */
  headOfSalesAttention?: boolean;
  /** Funds entries needing proof or a correction (badge on the tab). */
  fundsPending?: number;
  /** One line per manager wallet for the summary card. */
  fundsSummary?: Array<{ managerName: string; totals: ManagerFundTotals; readiness: string[] }>;
  onSaveDraftNote?: (note: string) => Promise<void>;
  initialTab?: TopTab;
  canResolveQueries?: boolean;
  onResolveBonusQuery?: (id: string, body: { outcome: "corrected" | "no_change"; response: string; amount?: number }) => Promise<void>;
  /** The Tuesday the reps' reports are due. */
  dueDate?: string;
  onOpenHistory?: () => void;
  mode: "review" | "submit";
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
  canAct: boolean;
  readOnlyReason?: string;
  onApprove: (repId: string, note?: string) => Promise<void>;
  onReturn: (repId: string, draft: CorrectionDraft) => Promise<void>;
  onFlag: (repId: string, draft: CorrectionDraft) => Promise<void>;
  onSubmitToOwner: (note: string, responses: WeeklyReportResponseInput[]) => Promise<void>;
  onBack: () => void;
  onEditManagerBonus?: () => void;
}) {
  const sym = currencySymbol();
  const [topTab, setTopTab] = useState<TopTab>(initialTab ?? "overview");
  const [answering, setAnswering] = useState<WeeklyBonusQuery | null>(null);
  const openQueries = bonusQueries.filter((query) => query.status === "open").length;
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [changingPayout, setChangingPayout] = useState<string | null>(null);
  // The "orders to decide" window: which rep, and which tab it opens on.
  const [decisionsFor, setDecisionsFor] = useState<{ repId: string; kind: DecisionKind } | null>(null);
  // The "is this the bonus to be paid?" window (Bright, 13 Oct 2026).
  const [approving, setApproving] = useState<string | null>(null);
  const [approveBusy, setApproveBusy] = useState(false);
  const [approveError, setApproveError] = useState("");
  // Came to the payout change from that window: go back to it after saving.
  const [backToApprove, setBackToApprove] = useState(false);
  const [repFilter, setRepFilter] = useState<RepFilter>("all");
  // `up`: the row is near the bottom of the screen, so the menu opens upward.
  const [menuFor, setMenuFor] = useState<{ repId: string; x: number; y: number; up?: boolean } | null>(null);
  const [managerNote, setManagerNote] = useState(company?.managerNote ?? "");
  const [ownerResponses, setOwnerResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [chartMode, setChartMode] = useState<"bar" | "rate">("bar");
  const [donutMetric, setDonutMetric] = useState<"orders" | "delivered">("orders");
  const [orderSearch, setOrderSearch] = useState("");

  useEffect(() => { setManagerNote(company?.managerNote ?? ""); setOwnerResponses({}); setSubmitError(""); }, [company?.id, company?.status, weekStart]);

  const companyStatus = company?.status ?? "open";
  const frozenWeek = companyStatus === "submitted_to_owner" || companyStatus === "locked";
  // A payout is changed on a submitted report, while the week is still with the manager.
  const canChangePayout = (row: ReviewRepRow) => canAct && !frozenWeek && !!onSavePayoutChange && !!row.frozen
    && (row.report?.status === "submitted" || row.report?.status === "manager_approved");
  const payoutRow = changingPayout ? rows.find((row) => row.repId === changingPayout) ?? null : null;
  // "This Week" (Bright, 12 Oct 2026): one press back to the current week.
  const todayKey = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
  const onThisWeek = todayKey >= weekStart && todayKey <= weekEnd;
  const thisWeekLabel = (() => {
    const today = new Date(`${todayKey}T12:00:00Z`);
    const start = new Date(today); start.setUTCDate(today.getUTCDate() - today.getUTCDay());
    const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
    return `${shortDay(start.toISOString().slice(0, 10))} – ${shortDay(end.toISOString().slice(0, 10))}`;
  })();
  // Filter the rep list by where each report stands (Bright, 12 Oct 2026).
  const repFilters: Array<{ key: RepFilter; label: string; test: (status: string) => boolean }> = [
    { key: "all", label: "All", test: () => true },
    { key: "pending", label: "Pending", test: (status) => status === "draft" },
    { key: "sent", label: "Sent", test: (status) => status !== "draft" },
    { key: "awaiting", label: "Awaiting approval", test: (status) => status === "submitted" },
    { key: "approved", label: "Approved", test: (status) => isApproved(status) },
    { key: "returned", label: "Returned", test: (status) => status === "returned" }
  ];
  const statusOf = (row: ReviewRepRow) => row.report?.status ?? "draft";
  const activeRepFilter = repFilters.find((item) => item.key === repFilter) ?? repFilters[0];
  // The pinned Actions column. `!` because the app's table styles set every
  // cell's background, and a see-through pinned cell shows the figures under it.
  const pinnedCell = "sticky right-0 z-[1] !bg-white shadow-[-10px_0_10px_-10px_rgba(15,23,42,0.18)] dark:!bg-slate-900";
  const pinnedHead = "sticky right-0 z-[1] !bg-gray-50 shadow-[-10px_0_10px_-10px_rgba(15,23,42,0.18)] dark:!bg-slate-800";
  // Approve straight from the list (Bright, 12 Oct 2026). Approving is the main
  // thing a manager does here, and it lived only at the bottom of the Review
  // window, where the Admin did not find it. Same rule as that window: only a
  // report that is Submitted, while the week is still with the manager.
  const canApproveFromList = (row: ReviewRepRow) => canAct && !frozenWeek && row.report?.status === "submitted";
  // Approve asks one question first, in its own window: is this the bonus to
  // be paid? Yes approves. No opens the payout change, and saving it comes
  // back here with the new figure (Bright, 13 Oct 2026). It replaced a plain
  // browser prompt, which could not offer "adjust it".
  const approveFromList = (row: ReviewRepRow) => { setApproveError(""); setApproving(row.repId); };
  const approveRow = approving ? rows.find((row) => row.repId === approving) ?? null : null;
  const confirmApprove = async () => {
    if (!approveRow) return;
    setApproveBusy(true);
    setApproveError("");
    try { await onApprove(approveRow.repId); setApproving(null); }
    catch (err: any) { setApproveError(err?.message ?? "The report was not approved. Please try again."); }
    finally { setApproveBusy(false); }
  };
  const closePayoutChange = () => {
    if (backToApprove && changingPayout) { setApproveError(""); setApproving(changingPayout); }
    setBackToApprove(false);
    setChangingPayout(null);
  };
  const expectedRows = rows.filter((row) => row.expected || row.report);
  const shown = expectedRows.map(shownSnapshot).filter((snap): snap is WeeklyReportSnapshot => !!snap);
  const companySnap = useMemo(
    () => buildCompanySnapshot(weekStart, weekEnd, shown, new Date(), null, managerBonus?.deliveryRate),
    [weekStart, weekEnd, shown, managerBonus?.deliveryRate]
  );
  const totals = companySnap.totals;
  // Initial / Taken off / Final for every rep shown in the total row.
  const splitTotals = shown.map(bonusInitialFinal).reduce(
    (sum, item) => ({
      initial: sum.initial + item.initial, takenOff: sum.takenOff + item.takenOff, final: sum.final + item.final,
      base: sum.base + item.full.base, upsell: sum.upsell + item.full.upsell, crossSell: sum.crossSell + item.full.crossSell
    }),
    { initial: 0, takenOff: 0, final: 0, base: 0, upsell: 0, crossSell: 0 }
  );
  // Orders placed in an earlier week, delivered and paid in this one, across
  // every rep shown (Bright, 3 Oct 2026). Older reports have no figure: 0.
  const carryOver = expectedRows.reduce((sum, row) => {
    const snap = shownSnapshot(row);
    return { orders: sum.orders + (snap?.totals.carryOverOrders ?? 0), bonus: sum.bonus + (snap?.totals.carryOverBonus ?? 0) };
  }, { orders: 0, bonus: 0 });
  const prev = companySnap.previous;

  const count = (pick: (row: ReviewRepRow) => boolean) => expectedRows.filter(pick).length;
  const submittedCount = count((row) => row.report?.status === "submitted");
  const draftCount = count((row) => !row.report || row.report.status === "draft");
  const returnedCount = count((row) => row.report?.status === "returned");
  const approvedCount = count((row) => isApproved(row.report?.status));
  const inCount = count((row) => isSubmittedish(row.report?.status));
  const total = expectedRows.length;
  const allApproved = total > 0 && approvedCount === total;
  const ownerReturns = corrections.filter((row) => row.companyReportId && row.kind === "return" && row.status === "open");
  // The reps the owner sent back on their own (Bright, 13 Oct 2026): from the
  // newest owner return, while their report still waits for approval again.
  const lastOwnerReturn = [...audit].filter((entry) => entry.action === "owner_returned").sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))[0];
  const ownerSentBackIds = new Set<string>(companyStatus === "returned_to_manager" && Array.isArray(lastOwnerReturn?.detail?.repIds) ? lastOwnerReturn.detail.repIds : []);
  const ownerSentBack = (row: ReviewRepRow) => ownerSentBackIds.has(row.repId) && row.report?.status === "submitted";
  const ownerSentBackRows = rows.filter(ownerSentBack);
  const repCorrections = corrections.filter((row) => row.repReportId);
  const repNameByReportId = (id: string | null) => rows.find((row) => row.report?.id === id)?.repName ?? "-";
  const repNameById = (id: string | null) => rows.find((row) => row.repId === id)?.repName ?? "-";

  const fundsProblems = (fundsSummary ?? []).filter((item) => item.readiness.length > 0);
  const canSubmit = canAct && allApproved && fundsProblems.length === 0 && (companyStatus === "open" || companyStatus === "returned_to_manager")
    && ownerReturns.every((row) => (ownerResponses[row.id] ?? "").trim().length >= 2);
  const submitBlocker = !canAct
    ? readOnlyReason ?? "Only a Manager or Admin can submit."
    : frozenWeek
      ? companyStatus === "locked" ? "This week is approved and locked." : "Submitted. Waiting for the owner."
      : !allApproved
        ? `${total - approvedCount} of ${total} report${total === 1 ? "" : "s"} still need${total - approvedCount === 1 ? "s" : ""} your approval.`
        : fundsProblems.length > 0
          ? `Funds & Expenses: ${fundsProblems.map((item) => `${item.managerName}: ${item.readiness.join(" ")}`).join(" ")}`
        : ownerReturns.length > 0 && !ownerReturns.every((row) => (ownerResponses[row.id] ?? "").trim().length >= 2)
          ? "Answer the owner's comments first: write what you changed in the box under \"Returned by the owner\"."
          : "";

  const steps: WorkflowStep[] = [
    { title: "Sales Reps Submit", detail: dueDate ? `Due by the end of ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(`${dueDate}T12:00:00Z`).getUTCDay()]}, ${longDate(dueDate)}` : "Reps submit their weekly reports", state: total > 0 && inCount === total ? "done" : "current", badge: <StepBadge tone="green">{inCount} of {total} submitted</StepBadge> },
    { title: "Manager Review", detail: "Review all reports, verify data and request corrections if needed", state: frozenWeek || (allApproved && companyStatus !== "returned_to_manager") ? "done" : "current", badge: frozenWeek ? <StepBadge tone="green">Done</StepBadge> : <StepBadge tone="blue">In Progress</StepBadge> },
    { title: "Submit to Owner", detail: "Send complete weekly report to owner", state: frozenWeek ? "done" : allApproved ? "current" : "pending", badge: <StepBadge tone={frozenWeek ? "green" : "gray"}>{frozenWeek ? "Submitted" : "Pending"}</StepBadge> },
    { title: "Owner Approval", detail: "Final approval and bonus lock", state: companyStatus === "locked" ? "done" : companyStatus === "submitted_to_owner" ? "current" : "pending", badge: <StepBadge tone={companyStatus === "locked" ? "green" : companyStatus === "submitted_to_owner" ? "blue" : "gray"}>{companyStatus === "locked" ? "Approved" : companyStatus === "submitted_to_owner" ? "In Progress" : "Pending"}</StepBadge> }
  ];

  const reviewRow = rows.find((row) => row.repId === reviewing) ?? null;
  const allOrders = expectedRows.flatMap((row) => (shownSnapshot(row)?.orders ?? []).map((order) => ({ ...order, repName: row.repName })));
  const filteredOrders = allOrders.filter((order) => {
    const q = orderSearch.trim().toLowerCase();
    return !q || `${order.id} ${order.customer} ${order.repName} ${order.product}`.toLowerCase().includes(q);
  });
  const repChartRows = shown.map((snap) => ({ label: snap.repName.split(" ")[0], orders: snap.totals.orders, delivered: snap.totals.delivered, deliveryRate: snap.totals.deliveryRate }));

  const submitToOwner = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      await onSubmitToOwner(managerNote.trim(), ownerReturns.map((row) => ({ correctionId: row.id, response: (ownerResponses[row.id] ?? "").trim() })));
    } catch (err: any) {
      setSubmitError(err?.message ?? "Could not submit.");
    } finally {
      setSubmitting(false);
    }
  };

  // The money side, one card for every manager wallet (Funds & Expenses).
  const fundsSummaryPanel = (
    <Panel>
      <NumberedHeader icon={Wallet} title="Manager Funds & Expenses" subtitle="Opening + received − spent − remitted = expected; actual − expected = variance." />
      <div className="space-y-3 px-5 pb-5 pt-3">
        {(fundsSummary ?? []).length === 0 && <p className="m-0 text-[12px] text-gray-500">No manager wallet activity this week.</p>}
        {(fundsSummary ?? []).map((item) => (
          <div key={item.managerName} className="rounded-xl border border-gray-100 p-3 text-[12px] dark:border-slate-800">
            <p className="m-0 font-bold text-gray-900 dark:text-slate-100">{item.managerName}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-gray-700 dark:text-slate-300">
              <span>Opening</span><span className="text-right">{sym}{nf(item.totals.opening)}</span>
              <span>Received</span><span className="text-right text-emerald-700">+{sym}{nf(item.totals.received)}</span>
              <span>Spent</span><span className="text-right text-rose-600">−{sym}{nf(item.totals.spent)}</span>
              <span>Remitted</span><span className="text-right text-violet-700">−{sym}{nf(item.totals.remitted)}</span>
              <span className="font-bold">Expected balance</span><span className="text-right font-bold">{sym}{nf(item.totals.expected)}</span>
              <span>Actual balance</span><span className="text-right">{item.totals.actual === null ? "Not counted" : `${sym}${nf(item.totals.actual)}`}</span>
              <span className="font-bold">Variance</span>
              <span className={`text-right font-bold ${item.totals.variance === null ? "text-gray-400" : Math.abs(item.totals.variance) < 0.01 ? "text-emerald-700" : "text-rose-600"}`}>{item.totals.variance === null ? "—" : Math.abs(item.totals.variance) < 0.01 ? `${sym}0 ✓` : `${item.totals.variance < 0 ? "−" : "+"}${sym}${nf(Math.abs(item.totals.variance))}`}</span>
            </div>
            {item.readiness.length > 0 && <p className="m-0 mt-2 text-[11px] font-semibold text-rose-600">{item.readiness.join(" ")}</p>}
          </div>
        ))}
      </div>
    </Panel>
  );

  const submitPanel = (
    <div className="space-y-4">
      <Panel className="p-5">
        <h2 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Approval Workflow</h2>
        <div className="mt-4"><WorkflowSteps steps={steps} /></div>
        {companyStatus === "returned_to_manager" && ownerReturns.length > 0 && (
          <div className="mt-4 space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="m-0 text-[12px] font-bold text-rose-800 dark:text-rose-200">Returned by the owner</p>
            {ownerSentBackRows.length > 0 && (
              <p className="m-0 rounded-lg bg-white px-2.5 py-2 text-[12px] text-rose-900 dark:bg-slate-900 dark:text-rose-100">
                Put the actual bonus to be paid for <strong>{ownerSentBackRows.map((row) => row.repName).join(", ")}</strong>, then approve {ownerSentBackRows.length === 1 ? "that report" : "those reports"} again. The other reports stay approved.
              </p>
            )}
            {ownerReturns.map((row) => (
              <div key={row.id}>
                <p className="m-0 text-[12px] text-rose-900 dark:text-rose-100"><strong>{CORRECTION_SECTION_LABEL[row.section]}:</strong> {row.problem}{row.orderRef ? ` (${row.orderRef})` : ""} — "{row.comment}"</p>
                <textarea rows={2} value={ownerResponses[row.id] ?? ""} onChange={(event) => setOwnerResponses({ ...ownerResponses, [row.id]: event.target.value })}
                  placeholder="What did you change?" className="mt-1 w-full resize-none rounded-lg border border-rose-200 bg-white px-2.5 py-1.5 text-[12px] outline-none dark:border-rose-500/30 dark:bg-slate-900 dark:text-slate-100" />
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={!canSubmit || submitting}
          onClick={submitToOwner}
          className="!min-h-0 mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1F6FEB] px-4 py-3 text-[13px] font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Submitting…" : companyStatus === "returned_to_manager" ? "Resubmit to Owner for Final Approval" : "Submit to Owner for Final Approval"}
        </button>
        {submitBlocker && <p className="m-0 mt-2 text-[11px] text-gray-500 dark:text-slate-400">{submitBlocker}</p>}
        {submitError && <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{submitError}</p>}
      </Panel>
      <Panel className="p-5">
        <NoteBox label="Manager Notes (Optional)" value={managerNote} onChange={setManagerNote} disabled={!canAct || frozenWeek} placeholder="Add a general note for the owner..." />
      </Panel>
    </div>
  );

  const shownIncentive = ((company?.companySnapshot as { monthlyIncentive?: MonthlyIncentiveReport | null } | null)?.monthlyIncentive) ?? monthlyIncentive;
  const managerBonusPanel = (
    <>
    <Panel>
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold text-gray-900 dark:text-slate-50"><Crown className="h-5 w-5 text-violet-600" /> Manager Bonus Preview</h2>
        {onEditManagerBonus && (
          <button type="button" onClick={onEditManagerBonus} className="!min-h-0 rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-200">Edit</button>
        )}
      </div>
      <div className="px-5 pb-5 pt-3">
        {managerBonus ? (
          <table className="!min-w-0 w-full text-[12px]">
            <tbody className="text-gray-800 dark:text-slate-200 [&_td]:[color:inherit]">
              <tr className="border-b border-gray-100 dark:border-slate-800"><td className="whitespace-nowrap py-2.5 pr-2">Performance Bonus</td><td className="whitespace-nowrap py-2.5 pr-3 font-bold">{sym}{nf(managerBonus.performanceBonus)}</td><td className="py-2.5 min-w-[100px] text-[11px] text-gray-500 dark:text-slate-400">{managerBonus.performanceNote}</td></tr>
              <tr className="border-b border-gray-100 dark:border-slate-800"><td className="whitespace-nowrap py-2.5 pr-2">Weekly Support Bonus</td><td className="whitespace-nowrap py-2.5 pr-3 font-bold">{sym}{nf(managerBonus.supportBonus)}</td><td className="py-2.5 min-w-[100px] text-[11px] text-gray-500 dark:text-slate-400">{managerBonus.supportNote}</td></tr>
              {managerBonus.upsellBonus !== undefined || managerBonus.upsellNote ? <tr className="border-b border-gray-100 dark:border-slate-800"><td className="whitespace-nowrap py-2.5 pr-2">Manager Upsell Bonus</td><td className="whitespace-nowrap py-2.5 pr-3 font-bold">{sym}{nf(managerBonus.upsellBonus ?? 0)}</td><td className="py-2.5 min-w-[100px] text-[11px] text-gray-500 dark:text-slate-400">{managerBonus.upsellNote}</td></tr> : null}
              <tr className="bg-violet-50 font-bold text-violet-900 dark:bg-violet-500/10 dark:text-violet-100 [&>td]:[color:inherit]"><td className="whitespace-nowrap px-2 py-3 text-[13px]">Total Manager Bonus</td><td className="py-3 text-[17px]" colSpan={2}>{sym}{nf(managerBonus.total)}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="m-0 text-[12px] text-gray-500">{loading ? "Working out the manager bonus…" : "Manager bonus not available for this week."}</p>
        )}
      </div>
    </Panel>
    {shownIncentive ? <MonthlyIncentiveSection report={shownIncentive} sym={sym} /> : null}
    </>
  );

  const TOP_TABS: Array<{ key: TopTab; label: string; icon: typeof Check }> = [
    { key: "overview", label: "Overview", icon: ClipboardList },
    { key: "reps", label: "Sales Reps", icon: Users },
    { key: "bonus", label: "Manager Bonus", icon: Crown },
    ...(renderHeadOfSales ? [{ key: "headOfSales" as TopTab, label: "Head of Sales", icon: Crown }] : []),
    { key: "funds", label: "Funds & Expenses", icon: Wallet },
    { key: "financial", label: "Financial Summary", icon: BarChart3 },
    { key: "orders", label: "Order Details", icon: FileText },
    { key: "audit", label: "Audit Trail", icon: History }
  ];
  const statusLabel = companyStatus === "locked" ? "Locked" : companyStatus === "submitted_to_owner" ? "With Owner" : companyStatus === "returned_to_manager" ? "Correction Required" : "In Progress";
  const statusTone = companyStatus === "locked" ? "bg-slate-100 text-slate-700" : companyStatus === "submitted_to_owner" ? "bg-amber-50 text-amber-700" : companyStatus === "returned_to_manager" ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700";

  const fundsFooter = (
    <Panel className="p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        <div className="flex-1">
          <NoteBox label="Manager Notes (Optional)" value={managerNote} onChange={setManagerNote} disabled={!canAct || frozenWeek} placeholder="Add any notes about this week's income and expenses..." />
        </div>
        <div className="flex shrink-0 flex-col gap-2 pb-6 sm:flex-row">
          {onSaveDraftNote && (
            <button type="button" disabled={!canAct || frozenWeek} onClick={() => void onSaveDraftNote(managerNote.trim())}
              className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white px-5 py-3 text-[13px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:bg-slate-900">
              <FileText className="h-4 w-4" /> Save as Draft
            </button>
          )}
          <button type="button" disabled={!canSubmit || submitting} onClick={submitToOwner}
            className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#1F6FEB] px-5 py-3 text-[13px] font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
            <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit to Owner for Final Approval"}
          </button>
        </div>
      </div>
      {submitBlocker && <p className="m-0 text-right text-[11px] text-gray-500">{submitBlocker}</p>}
      {submitError && <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{submitError}</p>}
    </Panel>
  );

  return (
    <div className="space-y-5">
      {/* ── Header (Bright's Manager Weekly Report design) ───────── */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <nav className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-slate-400" aria-label="Breadcrumb">
            <button type="button" onClick={onBack} className="!min-h-0 inline-flex items-center gap-1.5 font-medium text-[#1F8FE0] hover:underline">← Manager Dashboard</button>
            <ChevronRight className="h-3.5 w-3.5" /><span>Weekly Reports</span>
            <ChevronRight className="h-3.5 w-3.5" /><span>Manager Review</span>
          </nav>
          <div className="mt-3 flex items-start gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"><ClipboardList className="h-7 w-7" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="m-0 text-2xl font-black tracking-tight text-gray-900 dark:text-slate-50">Manager Weekly Report</h1>
                <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-[12px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200">Week: {longDate(weekStart)} – {longDate(weekEnd)}</span>
                {/* Say plainly whether this is the current week. */}
                {onThisWeek
                  ? <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200">This week</span>
                  : weekStart < todayKey ? <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-[12px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">Past week</span> : null}
                <span className={`rounded-lg px-2.5 py-1 text-[12px] font-bold ${statusTone}`}>{statusLabel}</span>
              </div>
              <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-slate-400">Review all sections, verify data, manage expenses, and submit to owner for final approval.</p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" onClick={() => onShiftWeek(-1)} className="!min-h-0 inline-flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><ChevronLeft className="h-4 w-4" /> Previous Week</button>
          {/* "This Week" read as a selected tab: blue while a PAST week was open,
              grey on the current one - a manager recorded in the wrong week
              because of it (Bright, 16 Oct 2026). Now it reads as an action on
              a past week, and as a plain confirmation on this week. */}
          {onThisWeek ? (
            <span className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-[13px] font-bold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
              <Check className="h-4 w-4" /> This week
            </span>
          ) : (
            <button type="button" onClick={() => onPickWeek(todayKey)} title="Go to the current week"
              className="!min-h-0 inline-flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              Go to this week <span className="font-normal text-gray-500">({thisWeekLabel})</span>
            </button>
          )}
          <button type="button" disabled={!canGoNext} onClick={() => onShiftWeek(1)} className="!min-h-0 inline-flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">Next Week <ChevronRight className="h-4 w-4" /></button>
          {onOpenHistory && (
            <button type="button" onClick={onOpenHistory} className="!min-h-0 inline-flex h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <History className="h-4 w-4" /> Report History
            </button>
          )}
        </div>
      </div>

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}
      {/* ── Work waiting in ANOTHER week (Bright, 12 Oct 2026) ─────
          The page opens on the most recent week. An Admin spent a morning on a
          week nobody had submitted, looking for an Approve button, while four
          reports waited in the week before. Say it wherever she is. */}
      {canAct && waitingWeeks.filter((item) => item.weekStart !== weekStart).map((item) => {
        const end = new Date(`${item.weekStart}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
        const label = `${shortDay(item.weekStart)} – ${shortDay(end.toISOString().slice(0, 10))}`;
        const parts = [
          item.toApprove > 0 ? `${item.toApprove} report${item.toApprove === 1 ? "" : "s"} to approve` : null,
          item.returned > 0 ? `${item.returned} back with the rep` : null,
          item.toApprove === 0 && item.returned === 0 ? `all ${item.approved} approved: ready to send to the owner` : item.approved > 0 ? `${item.approved} approved` : null
        ].filter(Boolean).join(" · ");
        return (
          <div key={item.weekStart} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-rose-300 bg-rose-50 px-4 py-3 text-[14px] text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-100">
            <span><strong>Waiting for you: week of {label}.</strong> {parts}. You are looking at a different week.</span>
            <button type="button" onClick={() => onPickWeek(item.weekStart)} className="!min-h-0 rounded-lg bg-rose-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-rose-700">Open week of {label}</button>
          </div>
        );
      })}
      {repsWaiting && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <span><strong>Reps cannot send this week's report yet.</strong> Last week has not been sent to the owner. Once it is sent, they can submit, and they will not be marked late for the wait.</span>
          <button type="button" onClick={() => onShiftWeek(-1)} className="!min-h-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-700">Go to last week</button>
        </div>
      )}

      {/* ── Top tabs ──────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto rounded-2xl bg-gray-100 p-1 dark:bg-slate-800" role="tablist">
        {TOP_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={topTab === key} onClick={() => setTopTab(key)}
            className={`!min-h-0 inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-[13px] font-semibold ${topTab === key ? "bg-[#1F6FEB] text-white shadow-sm" : "text-gray-600 hover:text-gray-900 dark:text-slate-300"}`}>
            <Icon className="h-4 w-4" />{label}
            {key === "reps" && openQueries + logMissDisputes.filter((item) => item.status === "open").length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">{openQueries + logMissDisputes.filter((item) => item.status === "open").length}</span>}
            {key === "headOfSales" && headOfSalesAttention && <span className="inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" aria-label="Needs a decision" />}
            {key === "funds" && (fundsPending ?? 0) > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{fundsPending}</span>}
          </button>
        ))}
      </div>

      {topTab === "headOfSales" && renderHeadOfSales ? (
        renderHeadOfSales()
      ) : topTab === "funds" ? (
        renderFunds ? renderFunds(fundsFooter) : <p className="m-0 text-[13px] text-gray-500">Funds & Expenses is not available.</p>
      ) : (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          {(topTab === "overview" || topTab === "reps") && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <KpiCard tone="blue" icon={ShoppingCart} label="Company Total Orders" value={nf(totals.orders)} delta={deltaPct(totals.orders, prev?.orders)} sub={`vs previous week (${nf(prev?.orders ?? 0)})`} />
            <KpiCard tone="green" icon={Box} label="Delivered Orders" value={nf(totals.delivered)} delta={deltaPct(totals.delivered, prev?.delivered)} sub={`vs previous week (${nf(prev?.delivered ?? 0)})`} />
            <KpiCard tone="orange" icon={Target} label="Delivery Rate" value={pctText(totals.deliveryRate)} delta={prev ? Math.round(totals.deliveryRate - prev.deliveryRate) : null} sub={`vs previous week (${pctText(prev?.deliveryRate ?? 0)})`} />
            <KpiCard tone="purple" icon={Wallet} label="Total Bonus Payable" labelTone="text-violet-700 dark:text-violet-300" value={`${sym}${nf(totals.totalBonus)}`} delta={deltaPct(totals.totalBonus, prev?.totalBonus)} sub={`vs previous week (${sym}${nf(prev?.totalBonus ?? 0)})`} />
          </div>
          )}

          {topTab === "overview" && (
            <>
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Panel>
                  <NumberedHeader n={1} title="Delivery Rate by Sales Rep" right={
                    <select value={chartMode} onChange={(event) => setChartMode(event.target.value as "bar" | "rate")} style={{ width: "auto" }} className="mr-5 mt-4 !h-9 !w-auto shrink-0 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                      <option value="bar">Bar Chart</option>
                      <option value="rate">Delivery Rate Only</option>
                    </select>
                  } />
                  <ChartLegend items={chartMode === "bar"
                    ? [{ label: "Orders", color: "#3b82f6" }, { label: "Delivered", color: "#10b981" }, { label: "Delivery Rate", color: "#f97316" }]
                    : [{ label: "Delivery Rate", color: "#f97316" }]} />
                  <div className="px-3 pb-4 pt-2">
                    <OrdersRateChart rows={chartMode === "bar" ? repChartRows : repChartRows.map((row) => ({ ...row, orders: 0, delivered: 0 }))} ordersColor="#3b82f6" deliveredColor="#10b981" />
                  </div>
                </Panel>
                <Panel>
                  <NumberedHeader n={2} title="Orders by Product" right={
                    <select value={donutMetric} onChange={(event) => setDonutMetric(event.target.value as "orders" | "delivered")} style={{ width: "auto" }} className="mr-5 mt-4 !h-9 !w-auto shrink-0 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                      <option value="orders">Orders</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  } />
                  <ProductDonut products={companySnap.products} metric={donutMetric} />
                </Panel>
              </div>
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <Panel>
                  <div className="flex items-center gap-2 px-5 pt-4">
                    <MessageCircle className="h-5 w-5 text-violet-600" />
                    <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Reported Issues &amp; Corrections</h2>
                    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white ${repCorrections.filter((row) => row.status === "open").length > 0 ? "bg-rose-500" : "bg-rose-500"}`}>{repCorrections.filter((row) => row.status === "open").length}</span>
                  </div>
                  <div className="pt-3">
                    <CorrectionList corrections={repCorrections} repNameById={repNameByReportId} empty={
                      <div className="flex flex-col items-center px-5 pb-8 pt-6 text-center">
                        <FileText className="h-8 w-8 text-gray-400" />
                        <p className="m-0 mt-2 text-[13px] font-semibold text-gray-800 dark:text-slate-200">No issues or corrections</p>
                        <p className="m-0 mt-0.5 text-[12px] text-gray-500">All reports are clear and ready for final submission.</p>
                      </div>
                    } />
                  </div>
                </Panel>
                {managerBonusPanel}
              </div>
            </>
          )}

          {topTab === "reps" && (
            <>
              <Panel className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.6fr)]">
                    <StatusTile tone="green" icon={ShoppingCart} n={submittedCount} label="Submitted" sub="Waiting for review" />
                    <StatusTile tone="gray" icon={Inbox} n={draftCount} label="Draft" sub="Not yet submitted" />
                    <StatusTile tone="orange" icon={AlertTriangle} n={returnedCount} label="Returned" sub="Needs correction" />
                    <StatusTile tone="purple" icon={CheckCircle2} n={approvedCount} label="Approved" sub="Ready for owner" />
                    <div className="col-span-2 rounded-xl border border-gray-200 p-4 lg:col-span-1 dark:border-slate-700">
                      <p className="m-0 text-[13px] font-semibold text-gray-900 dark:text-slate-100">Review Progress</p>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="flex-1"><RateBar value={total > 0 ? (approvedCount / total) * 100 : 0} tone="green" /></span>
                        <span className="text-[12px] font-bold text-gray-800 dark:text-slate-200">{total > 0 ? Math.round((approvedCount / total) * 100) : 0}%</span>
                      </div>
                      <p className="m-0 mt-2 text-[11px] text-gray-500">{approvedCount} of {total} reports reviewed</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                    <span className="text-[12px] font-bold text-gray-600 dark:text-slate-300">Show:</span>
                    {repFilters.filter((item) => item.key !== "returned" || expectedRows.some((row) => statusOf(row) === "returned")).map((item) => {
                      const count = expectedRows.filter((row) => item.test(statusOf(row))).length;
                      const active = repFilter === item.key;
                      return (
                        <button key={item.key} type="button" onClick={() => setRepFilter(item.key)}
                          className={`!min-h-0 rounded-full px-3 py-1.5 text-[12px] font-bold ${active ? "bg-[#1F6FEB] text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-200"}`}>
                          {item.label} <span className={active ? "opacity-90" : "text-gray-500"}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mx-3 overflow-x-auto pb-3">
                    <table className="w-full !min-w-[820px] text-left text-[12px]">
                      <thead className="text-[11px] text-gray-600 dark:text-slate-400 [&_th]:[color:inherit]">
                        <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                          {["#", "Sales Rep", "Report Status", "Orders", "Delivered", "Delivery Rate", `Cross-Sell (${sym})`, `Upsell (${sym})`, `Base (${sym})`, `Initial (${sym})`, `Taken off (${sym})`, `Final (${sym})`, "Actions"].map((h) => (
                            // ⚠️ Actions stays pinned to the right edge (12 Oct 2026). On a
                            // laptop the table is wider than its box, and Review / Approve
                            // sat past the edge where nobody scrolled to.
                            <th key={h} className={`whitespace-nowrap px-2 py-2.5 font-bold ${h === "Actions" ? pinnedHead : ""}`}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {expectedRows.filter((row) => activeRepFilter.test(statusOf(row))).map((row, index) => {
                          const snap = shownSnapshot(row);
                          const status = row.report?.status ?? "draft";
                          return (
                            <tr key={row.repId} className="border-t border-gray-100 dark:border-slate-800">
                              <td className="px-2 py-3 text-gray-600">{index + 1}</td>
                              <td className="px-2 py-3"><span className="flex items-center gap-2 whitespace-nowrap font-semibold text-gray-900 dark:text-slate-100"><Avatar name={row.repName} />{row.repName}{row.isHeadOfSales ? <HeadOfSalesBadge /> : null}</span></td>
                              <td className="px-2 py-3">
                                <RepStatusPill status={status} approvedLabel="Approved" />
                                <span className="mt-0.5 block text-[11px] text-gray-500">{row.report?.submittedAt ? shortDateTime(row.report.submittedAt) : "Not submitted"}</span>
                                {row.submittedLate && <span className="mt-0.5 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Late</span>}
                                {row.overdue && <span className="mt-0.5 inline-block rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Overdue</span>}
                                {ownerSentBack(row) && <span className="mt-0.5 block w-fit rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Owner sent back: check bonus</span>}
                                {row.differences.length > 0 && <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-amber-600"><AlertTriangle className="h-3 w-3" />{row.differences.length} figure{row.differences.length === 1 ? "" : "s"} changed</span>}
                              </td>
                              <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap?.totals.orders ?? 0)}</td>
                              <td className="px-2 py-3 text-gray-800 dark:text-slate-200">
                                {nf(snap?.totals.delivered ?? 0)}
                                {(snap?.totals.carryOverOrders ?? 0) > 0 && <span className="mt-0.5 block whitespace-nowrap text-[10.5px] font-semibold text-blue-700 dark:text-blue-300">+{nf(snap?.totals.carryOverOrders ?? 0)} carried over · {sym}{nf(snap?.totals.carryOverBonus ?? 0)}</span>}
                              </td>
                              <td className="px-2 py-3"><span className="flex items-center gap-2 text-gray-800 dark:text-slate-200"><span className="w-11">{pctText(snap?.totals.deliveryRate ?? 0)}</span><span className="w-14"><RateBar value={snap?.totals.deliveryRate ?? 0} /></span></span></td>
                              <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap ? bonusComponentsFull(snap).crossSell : 0)}</td>
                              <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap ? bonusComponentsFull(snap).upsell : 0)}</td>
                              <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{nf(snap ? bonusComponentsFull(snap).base : 0)}</td>
                              {snap ? <BonusInitialCells info={bonusInitialFinal(snap)} sym={sym} /> : <><td className="px-2 py-3">-</td><td className="px-2 py-3">-</td></>}
                              <td className="px-2 py-3 font-bold text-gray-900 dark:text-slate-100">
                                <span className="flex items-center gap-1">
                                  {nf(snap ? bonusInitialFinal(snap).final : 0)}
                                  {canChangePayout(row) && (
                                    <button type="button" aria-label={`Change ${row.repName}'s payout`} title="Change payout" onClick={() => setChangingPayout(row.repId)}
                                      className="!min-h-0 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-[#1F8FE0] dark:hover:bg-slate-800"><Pencil className="h-3 w-3" /></button>
                                  )}
                                </span>
                                {row.payoutChange && <PayoutChangeNote change={row.payoutChange} sym={sym} />}
                                {snap?.missingFeeDetail && <MissingFeeNote detail={snap.missingFeeDetail} sym={sym} onOpen={() => setDecisionsFor({ repId: row.repId, kind: "missing_fee" })} />}
                                <LateSendNote detail={row.lateSend} sym={sym} onOpen={() => setDecisionsFor({ repId: row.repId, kind: "late_send" })} />
                              </td>
                              <td className={`px-2 py-3 ${pinnedCell}`}>
                                <span className="flex items-center gap-1">
                                  <button type="button" onClick={() => setReviewing(row.repId)} className="!min-h-0 rounded-lg bg-blue-50 px-2 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-200">Review</button>
                                  {canApproveFromList(row) && (
                                    <button type="button" onClick={() => approveFromList(row)} className="!min-h-0 rounded-lg bg-emerald-600 px-2 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700">Approve</button>
                                  )}
                                  <button type="button" aria-label={`More for ${row.repName}`} onClick={(event) => {
                                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                                    // ⚠️ The menu cannot scroll. Opened downward from a row near the
                                    // bottom of the screen, its lower items ran off the edge and could
                                    // not be seen or pressed (the Admin saw 3 of 5). Open upward there.
                                    const up = window.innerHeight - rect.bottom < 240 && rect.top > 240;
                                    setMenuFor(menuFor?.repId === row.repId ? null : { repId: row.repId, x: rect.right, y: up ? window.innerHeight - rect.top : rect.bottom, up });
                                  }} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {expectedRows.length === 0 && (
                          <tr><td colSpan={13} className="px-2 py-8 text-center text-gray-500">{loading ? "Loading reports…" : "No sales rep had orders this week."}</td></tr>
                        )}
                        {expectedRows.length > 0 && expectedRows.every((row) => !activeRepFilter.test(statusOf(row))) && (
                          <tr><td colSpan={13} className="px-2 py-8 text-center text-gray-500">No report is "{activeRepFilter.label}" this week. <button type="button" onClick={() => setRepFilter("all")} className="!min-h-0 font-bold text-blue-700 underline">Show all</button></td></tr>
                        )}
                        <tr className="border-t border-gray-200 font-bold text-gray-900 dark:border-slate-700 dark:text-slate-50 [&>td]:[color:inherit]">
                          <td className="px-2 py-3" colSpan={2}>Total{repFilter !== "all" ? <span className="block text-[10.5px] font-semibold text-gray-500">all reps, not only the ones shown</span> : null}</td>
                          <td className="px-2 py-3">-</td>
                          <td className="px-2 py-3">{nf(totals.orders)}</td>
                          <td className="px-2 py-3">
                            {nf(totals.delivered)}
                            {carryOver.orders > 0 && <span className="mt-0.5 block whitespace-nowrap text-[10.5px] font-semibold text-blue-700 dark:text-blue-300">+{nf(carryOver.orders)} carried over · {sym}{nf(carryOver.bonus)}</span>}
                          </td>
                          <td className="px-2 py-3">{pctText(totals.deliveryRate)}</td>
                          <td className="px-2 py-3">{nf(splitTotals.crossSell)}</td>
                          <td className="px-2 py-3">{nf(splitTotals.upsell)}</td>
                          <td className="px-2 py-3">{nf(splitTotals.base)}</td>
                          <td className="px-2 py-3">{nf(splitTotals.initial)}</td>
                          <td className="px-2 py-3 text-rose-600">{splitTotals.takenOff > 0 ? `-${nf(splitTotals.takenOff)}` : "0"}</td>
                          <td className="px-2 py-3">
                            {nf(splitTotals.final)}
                            {(totals.payoutChanges ?? 0) !== 0 && <span className="mt-0.5 block whitespace-nowrap text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">incl. {(totals.payoutChanges ?? 0) < 0 ? "-" : "+"}{sym}{nf(Math.abs(totals.payoutChanges ?? 0))} payout changes</span>}
                          </td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
              </Panel>
              {onDecideLogMiss && (
                <LogMissDisputesPanel disputes={logMissDisputes} repName={(id) => repNameById(id)} canDecide={canResolveQueries} isOwner={!canAct && canResolveQueries}
                  onDecide={onDecideLogMiss} />
              )}
              <Panel>
                <NumberedHeader title="Bonus Queries" subtitle="Reps who ran Check My Bonus and still need an answer." />
                <div className="space-y-3 p-4">
                  <p className="m-0 text-[12px] text-gray-500 dark:text-slate-400">Reps who feel underpaid run "Check My Bonus". Anything the system finds, or anything a rep still disputes, lands here. A correction is paid with the week that is running now, never written into a locked week.</p>
                  {bonusQueries.length === 0 && <p className="m-0 rounded-xl bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500 dark:bg-slate-800">No bonus queries.</p>}
                  {bonusQueries.map((query) => {
                    const issues = (query.checkResult?.findings ?? []).filter((finding) => finding.level === "issue");
                    return (
                      <div key={query.id} className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><Avatar name={repNameById(query.repId)} size={28} />{repNameById(query.repId)} <span className="text-[12px] font-normal text-gray-500">· week of {longDate(query.weekStart)} · {shortDateTime(query.createdAt)}</span></span>
                          <span className="flex items-center gap-2">
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${query.sentDespiteAccurate ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{query.sentDespiteAccurate ? "System says accurate · rep disagrees" : `System found ${issues.length} problem${issues.length === 1 ? "" : "s"}`}</span>
                            <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${query.status === "open" ? "bg-rose-50 text-rose-700" : query.status === "corrected" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{query.status === "open" ? "Open" : query.status === "corrected" ? `Corrected +${sym}${nf(query.correctionAmount)}` : "No change"}</span>
                          </span>
                        </div>
                        {query.orderRefs.length > 0 && <p className="m-0 mt-2 text-[12px] text-gray-600 dark:text-slate-300">Orders named: {query.orderRefs.map((ref) => `#${ref}`).join(", ")}</p>}
                        {query.repMessage && <p className="m-0 mt-1 text-[13px] text-gray-800 dark:text-slate-200">"{query.repMessage}"</p>}
                        {(query.checkResult?.findings ?? []).filter((finding) => finding.level !== "ok").length > 0 && (
                          <ul className="m-0 mt-2 list-none space-y-1 p-0">
                            {(query.checkResult?.findings ?? []).filter((finding) => finding.level !== "ok").map((finding, index) => (
                              <li key={index} className="flex items-start gap-1.5 text-[12px] text-gray-700 dark:text-slate-300">
                                {finding.level === "issue" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                                {finding.text}
                              </li>
                            ))}
                          </ul>
                        )}
                        {query.managerResponse && <p className="m-0 mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[12px] text-gray-700 dark:bg-slate-800 dark:text-slate-200">Answer from {query.resolvedByName ?? "manager"}: "{query.managerResponse}"{query.correctionWeekStart ? ` · paid with the week of ${longDate(query.correctionWeekStart)}` : ""}</p>}
                        {query.status === "open" && canResolveQueries && onResolveBonusQuery && (
                          <div className="mt-3 flex justify-end">
                            <button type="button" onClick={() => setAnswering(query)} className="!min-h-0 rounded-lg bg-[#1F6FEB] px-4 py-2 text-[12px] font-bold text-white hover:bg-blue-700">Answer</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            </>
          )}

          {topTab === "bonus" && (
            <>
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                {managerBonusPanel}
                {fundsSummaryPanel}
              </div>
              <Panel>
                <NumberedHeader title="Sales Rep Bonus Breakdown" subtitle="Every rep's bonus for the week." />
                <RepBonusTable snaps={shown} sym={sym} />
              </Panel>
            </>
          )}

          {topTab === "financial" && (
            <>
              {fundsSummaryPanel}
              <Panel>
                <div className="grid grid-cols-1 gap-4 p-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="rounded-xl border border-gray-100 dark:border-slate-800">
                    <NumberedHeader title="Product Breakdown" subtitle="All reps, orders placed and delivered this week." />
                    <CompanyProductTable products={companySnap.products} totals={totals} />
                  </div>
                  <div className="rounded-xl border border-gray-100 dark:border-slate-800">
                    <NumberedHeader title="Daily Orders & Delivery" subtitle="Orders placed each day, and how many delivered." />
                    <ChartLegend items={[{ label: "Orders", color: "#3b82f6" }, { label: "Delivered", color: "#10b981" }, { label: "Delivery Rate", color: "#f97316" }]} />
                    <div className="px-3 pb-4 pt-2"><OrdersRateChart rows={dailyChartRows(companySnap.daily)} ordersColor="#3b82f6" deliveredColor="#10b981" /></div>
                  </div>
                </div>
              </Panel>
            </>
          )}

          {topTab === "orders" && (
            <Panel>
                <div className="p-4">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <label className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-gray-200 px-3 dark:border-slate-700">
                      <Search className="h-4 w-4 text-gray-400" />
                      <input value={orderSearch} onChange={(event) => setOrderSearch(event.target.value)} placeholder="Search order ID, customer, rep or product..." className="w-full border-0 bg-transparent text-[12px] outline-none dark:text-slate-100" />
                    </label>
                    <button type="button" onClick={() => downloadCsv(`weekly-orders-${weekStart}.csv`, ["Order ID", "Rep", "Date", "Customer", "Product", "Type", "Amount", "Status", "Bonus"], filteredOrders.map((row) => [row.id, row.repName, row.date, row.customer, row.product, row.type, row.amount, row.status, row.bonus]))}
                      className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 px-4 text-[13px] font-semibold text-gray-800 dark:border-slate-700 dark:text-slate-100"><Download className="h-4 w-4" /> Export</button>
                  </div>
                  <OrdersTable rows={filteredOrders} sym={sym} />
                </div>
            </Panel>
          )}

          {topTab === "audit" && <Panel className="p-2"><AuditTable entries={audit} repName={repNameById} /></Panel>}
        </div>

        {submitPanel}
      </div>
      )}

      {/* ── Row menu ────────────────────────────────────────────── */}
      {menuFor && createPortal(
        <div className="fixed inset-0 z-[70]" onClick={() => setMenuFor(null)}>
          <div className="absolute w-52 rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" style={menuFor.up ? { bottom: menuFor.y + 4, left: Math.max(8, menuFor.x - 208) } : { top: menuFor.y + 4, left: Math.max(8, menuFor.x - 208) }} onClick={(event) => event.stopPropagation()}>
            <MenuItem icon={ClipboardList} label="Review report" onClick={() => { setReviewing(menuFor.repId); setMenuFor(null); }} />
            {(() => {
              const menuRow = rows.find((row) => row.repId === menuFor.repId);
              return menuRow && canApproveFromList(menuRow)
                ? <MenuItem icon={Check} label="Approve report" onClick={() => { setMenuFor(null); approveFromList(menuRow); }} />
                : null;
            })()}
            {canAct && !frozenWeek && <MenuItem icon={Undo2} label="Return for correction" onClick={() => { setReturning(menuFor.repId); setMenuFor(null); }} />}
            {canAct && companyStatus !== "locked" && <MenuItem icon={Flag} label="Flag issue" onClick={() => { setFlagging(menuFor.repId); setMenuFor(null); }} />}
            {(() => {
              const menuRow = rows.find((row) => row.repId === menuFor.repId);
              return menuRow && canChangePayout(menuRow)
                ? <MenuItem icon={Pencil} label={menuRow.payoutChange ? "Edit payout change" : "Change payout"} onClick={() => { setChangingPayout(menuFor.repId); setMenuFor(null); }} />
                : null;
            })()}
          </div>
        </div>,
        document.body
      )}

      {/* ── "No fee" / "Late send" orders: charge or skip each one ── */}
      {(() => {
        const decisionRow = decisionsFor ? rows.find((row) => row.repId === decisionsFor.repId) ?? null : null;
        if (!decisionRow) return null;
        return (
          <OrderDecisionsModal
            repName={decisionRow.repName}
            weekLabel={`${longDate(weekStart)} to ${longDate(weekEnd)}`}
            sym={sym}
            lateSend={decisionRow.lateSend}
            missingFee={shownSnapshot(decisionRow)?.missingFeeDetail}
            startOn={decisionsFor?.kind}
            onClose={() => setDecisionsFor(null)}
            onDecide={onDecideOrder && !frozenWeek ? (kind, orderId, decision, amount, reason) => onDecideOrder(decisionRow.repId, kind, orderId, decision, amount, reason) : undefined}
            onUndo={onUndoOrderDecision && !frozenWeek && !isApproved(decisionRow.report?.status) ? onUndoOrderDecision : undefined}
            onRemoveOldFine={frozenWeek ? undefined : onRemoveLateSendFine}
          />
        );
      })()}

      {/* ── Change a rep's payout ───────────────────────────────── */}
      {payoutRow && onSavePayoutChange && (
        <PayoutChangeForm
          repName={payoutRow.repName}
          sym={sym}
          systemAmount={payoutRow.frozen?.totals.systemFinalBonus ?? payoutRow.frozen?.totals.finalBonus ?? 0}
          existing={payoutRow.payoutChange ? { amount: payoutRow.payoutChange.amount, reason: payoutRow.payoutChange.reason } : null}
          onCancel={closePayoutChange}
          onSave={async (amount, reason) => { await onSavePayoutChange(payoutRow.repId, amount, reason); closePayoutChange(); }}
          onRemove={onRemovePayoutChange ? async () => { await onRemovePayoutChange(payoutRow.repId); closePayoutChange(); } : undefined}
        />
      )}

      {/* ── Approve: is this the bonus to be paid? ──────────────── */}
      {approveRow && !changingPayout && (() => {
        const snap = shownSnapshot(approveRow);
        const t = snap?.totals;
        const finalBonus = t?.finalBonus ?? 0;
        const change = t?.payoutChange ?? 0;
        const takenOff = (t?.fines ?? 0) + (t?.carriedFines ?? 0);
        const lines: Array<{ label: string; value: number; minus?: boolean }> = [
          { label: "Base bonus", value: t?.baseBonus ?? 0 },
          { label: "Upsell bonus", value: t?.upsellBonus ?? 0 },
          { label: "Cross-sell bonus", value: t?.crossSellBonus ?? 0 },
          ...((t?.adjustments ?? 0) !== 0 ? [{ label: "Bonus corrections", value: Math.abs(t?.adjustments ?? 0), minus: (t?.adjustments ?? 0) < 0 }] : []),
          ...(takenOff > 0 ? [{ label: "Fines taken off", value: takenOff, minus: true }] : []),
          ...(change !== 0 ? [{ label: change < 0 ? "Taken off by manager" : "Added by manager", value: Math.abs(change), minus: change < 0 }] : [])
        ];
        const canAdjust = canChangePayout(approveRow);
        // Every "No fee" / "Late send" order needs a charge or skip first (Bright, 28 Oct 2026).
        const toDecide = orderDecisionsReady ? undecidedCount(approveRow.lateSend, snap?.missingFeeDetail) : 0;
        return (
          <Modal title="Approve report" subtitle={`${approveRow.repName} · ${longDate(weekStart)} to ${longDate(weekEnd)}`} onClose={() => { if (!approveBusy) setApproving(null); }}>
            <div className="space-y-4 px-6 py-5">
              <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 px-5 py-5 text-center ring-1 ring-emerald-100 dark:from-emerald-500/10 dark:to-teal-500/10 dark:ring-emerald-500/20">
                <div className="mx-auto mb-2 flex w-fit items-center gap-2">
                  <Avatar name={approveRow.repName} />
                  <span className="text-[13px] font-bold text-gray-800 dark:text-slate-100">{approveRow.repName}</span>
                </div>
                <p className="m-0 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Bonus to be paid</p>
                <p className="m-0 mt-1 text-[34px] font-extrabold leading-none text-gray-900 dark:text-slate-50">{sym}{nf(finalBonus)}</p>
                <p className="m-0 mt-2 text-[12px] text-gray-600 dark:text-slate-300">{nf(t?.delivered ?? 0)} delivered of {nf(t?.orders ?? 0)} orders · {pctText(t?.deliveryRate ?? 0)} delivery rate</p>
              </div>

              <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-slate-800 dark:border-slate-800">
                {lines.map((line) => (
                  <div key={line.label} className="flex items-center justify-between px-4 py-2.5 text-[13px]">
                    <span className="text-gray-600 dark:text-slate-300">{line.label}</span>
                    <span className={`font-bold ${line.minus ? "text-rose-600" : "text-gray-900 dark:text-slate-100"}`}>{line.minus ? "-" : ""}{sym}{nf(line.value)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5 text-[13px] dark:bg-slate-800/60">
                  <span className="font-bold text-gray-800 dark:text-slate-100">Bonus to be paid</span>
                  <span className="font-extrabold text-emerald-700 dark:text-emerald-300">{sym}{nf(finalBonus)}</span>
                </div>
              </div>

              {approveRow.payoutChange && <PayoutChangeNote change={approveRow.payoutChange} sym={sym} />}

              {approveRow.differences.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-[12px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    <strong>{approveRow.differences.length} figure{approveRow.differences.length === 1 ? " has" : "s have"} changed</strong> since {approveRow.repName} submitted.{" "}
                    <button type="button" onClick={() => { setApproving(null); setReviewing(approveRow.repId); }} className="!min-h-0 font-bold underline">Open the review</button> if you have not looked at them.
                  </span>
                </div>
              )}

              {toDecide > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12.5px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><strong>{toDecide} order{toDecide === 1 ? " needs" : "s need"} your decision first.</strong> Sent late or delivery fee missing: charge or don't charge, then approve.</span>
                  </span>
                  <button type="button" onClick={() => { const repId = approveRow.repId; setApproving(null); setDecisionsFor({ repId, kind: undecidedCount(approveRow.lateSend, null) > 0 ? "late_send" : "missing_fee" }); }}
                    className="!min-h-0 rounded-lg bg-rose-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-rose-700">Decide now</button>
                </div>
              )}

              <p className="m-0 text-center text-[15px] font-bold text-gray-900 dark:text-slate-50">Is this the actual bonus to be paid?</p>
              {approveError && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-center text-[12px] font-semibold text-rose-700">{approveError}</p>}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" disabled={approveBusy || !canAdjust}
                  title={canAdjust ? undefined : "The payout cannot be changed on this report."}
                  onClick={() => { setBackToApprove(true); setChangingPayout(approveRow.repId); }}
                  className="!min-h-0 flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13px] font-bold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                  <Pencil className="h-4 w-4" /> No, adjust it
                </button>
                <button type="button" disabled={approveBusy || toDecide > 0} title={toDecide > 0 ? "Decide on every flagged order first." : undefined} onClick={() => void confirmApprove()}
                  className="!min-h-0 flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-[13px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60">
                  <Check className="h-4 w-4" /> {approveBusy ? "Approving..." : "Yes, approve"}
                </button>
              </div>
              <p className="m-0 text-center text-[11px] text-gray-500 dark:text-slate-400">Nothing is paid yet. The owner still gives the final approval.</p>
            </div>
          </Modal>
        );
      })()}

      {/* ── Sales Rep Report Review (side-by-side check) ───────── */}
      {reviewRow && (
        <RepReviewModal
          row={reviewRow}
          weekStart={weekStart}
          weekEnd={weekEnd}
          sym={sym}
          canAct={canAct && !frozenWeek}
          canFlag={canAct && companyStatus !== "locked"}
          corrections={corrections.filter((row) => reviewRow.report && row.repReportId === reviewRow.report.id)}
          onClose={() => setReviewing(null)}
          // Every Approve asks the same question first (Bright, 13 Oct 2026):
          // the Review window's button opens it too, so the payout can still
          // be adjusted before the report is approved.
          onApprove={async () => { const row = reviewRow; setReviewing(null); approveFromList(row); }}
          onReturn={() => { setReturning(reviewRow.repId); setReviewing(null); }}
          onFlag={() => { setFlagging(reviewRow.repId); setReviewing(null); }}
          // Charge / skip opens on top of the report, which stays open behind it.
          onOpenDecisions={(kind) => setDecisionsFor({ repId: reviewRow.repId, kind })}
          escapePaused={!!decisionsFor}
        />
      )}

      {answering && onResolveBonusQuery && (
        <ResolveQueryModal query={answering} repName={repNameById(answering.repId)} sym={sym}
          onCancel={() => setAnswering(null)}
          onSubmit={async (body) => { await onResolveBonusQuery(answering.id, body); setAnswering(null); }} />
      )}

      {returning && (
        <CorrectionForm
          title={`Return for Correction — ${repNameById(returning)}`}
          subtitle="Say exactly what needs fixing. The rep sees this and must answer before resubmitting."
          submitLabel="Return to Rep"
          tone="rose"
          onCancel={() => setReturning(null)}
          onSubmit={async (draft) => { await onReturn(returning, draft); setReturning(null); }}
        />
      )}
      {flagging && (
        <CorrectionForm
          title={`Flag Issue — ${repNameById(flagging)}`}
          subtitle="A flag does not send the report back. It is shown to the owner as something to look at."
          submitLabel="Flag Issue"
          tone="amber"
          onCancel={() => setFlagging(null)}
          onSubmit={async (draft) => { await onFlag(flagging, draft); setFlagging(null); }}
        />
      )}
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick }: { icon: typeof Check; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="!min-h-0 flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800">
      <Icon className="h-4 w-4 text-gray-500" />{label}
    </button>
  );
}

function StatusTile({ tone, icon: Icon, n, label, sub }: { tone: "green" | "gray" | "orange" | "purple"; icon: typeof Check; n: number; label: string; sub: string }) {
  const styles = {
    green: "border-emerald-100 bg-emerald-50/50 [&_.tile]:bg-emerald-100 [&_.tile]:text-emerald-600",
    gray: "border-gray-200 bg-white [&_.tile]:bg-gray-100 [&_.tile]:text-gray-500",
    orange: "border-orange-100 bg-orange-50/50 [&_.tile]:bg-orange-100 [&_.tile]:text-orange-500",
    purple: "border-violet-100 bg-violet-50/50 [&_.tile]:bg-violet-100 [&_.tile]:text-violet-600"
  }[tone];
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 dark:border-slate-700 dark:bg-slate-900 ${styles}`}>
      <span className="tile inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"><Icon className="h-5 w-5" /></span>
      <div>
        <p className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-50">{n}</p>
        <p className="m-0 text-[12px] font-semibold text-gray-800 dark:text-slate-200">{label}</p>
        <p className="m-0 text-[11px] text-gray-500">{sub}</p>
      </div>
    </div>
  );
}

export function CompanyProductTable({ products, totals }: { products: WeeklyReportSnapshot["products"]; totals: { orders: number; delivered: number; deliveryRate: number } }) {
  return (
    <div className="overflow-x-auto px-3 pb-4 pt-3">
      <table className="w-full !min-w-[460px] text-left text-[12px]">
        <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
          <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
            <th className="px-3 py-2.5 font-bold">Product</th>
            <th className="px-3 py-2.5 text-center font-bold">Orders</th>
            <th className="px-3 py-2.5 text-center font-bold">Delivered</th>
            <th className="px-3 py-2.5 font-bold" colSpan={2}>Delivery Rate</th>
          </tr>
        </thead>
        <tbody>
          {products.map((row) => (
            <tr key={row.key} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200">
              <td className="px-3 py-2.5">{row.name}</td>
              <td className="px-3 py-2.5 text-center">{nf(row.orders)}</td>
              <td className="px-3 py-2.5 text-center">{nf(row.delivered)}</td>
              <td className="w-16 px-3 py-2.5 text-right">{pctText(row.deliveryRate)}</td>
              <td className="w-28 px-3 py-2.5"><RateBar value={row.deliveryRate} tone="blue" /></td>
            </tr>
          ))}
          <tr className="border-t border-gray-200 font-bold text-gray-900 dark:border-slate-700 dark:text-slate-50 [&>td]:[color:inherit]">
            <td className="px-3 py-2.5">Total</td>
            <td className="px-3 py-2.5 text-center">{nf(totals.orders)}</td>
            <td className="px-3 py-2.5 text-center">{nf(totals.delivered)}</td>
            <td className="px-3 py-2.5 text-right">{pctText(totals.deliveryRate)}</td>
            <td className="px-3 py-2.5"><RateBar value={totals.deliveryRate} tone="blue" /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function RepBonusTable({ snaps, sym }: { snaps: WeeklyReportSnapshot[]; sym: string }) {
  const sum = (pick: (snap: WeeklyReportSnapshot) => number) => snaps.reduce((total, snap) => total + pick(snap), 0);
  return (
    <div className="overflow-x-auto px-3 pb-4 pt-3">
      <table className="w-full !min-w-[640px] text-left text-[12px]">
        <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
          <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
            {["Sales Rep", "Delivered (bonus)", `Base (${sym})`, `Cross-Sell (${sym})`, `Upsell (${sym})`, `Corrections (${sym})`, `Fines (${sym})`, `Final (${sym})`].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {snaps.map((snap) => (
            <tr key={snap.repId} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200">
              <td className="px-3 py-2.5 font-semibold">{snap.repName}</td>
              <td className="px-3 py-2.5">{nf(snap.totals.deliveredForBonus)}</td>
              <td className="px-3 py-2.5">{nf(snap.totals.baseBonus)}</td>
              <td className="px-3 py-2.5">{nf(snap.totals.crossSellBonus)}</td>
              <td className="px-3 py-2.5">{nf(snap.totals.upsellBonus)}</td>
              <td className="px-3 py-2.5">{(snap.totals.adjustments ?? 0) > 0 ? `+${nf(snap.totals.adjustments ?? 0)}` : "0"}</td>
              <td className="px-3 py-2.5">{snap.totals.fines > 0 ? `-${nf(snap.totals.fines)}` : "0"}</td>
              <td className="px-3 py-2.5 font-bold">{nf(snap.totals.finalBonus)}</td>
            </tr>
          ))}
          <tr className="border-t border-gray-200 font-bold text-gray-900 dark:border-slate-700 dark:text-slate-50 [&>td]:[color:inherit]">
            <td className="px-3 py-2.5">Total</td>
            <td className="px-3 py-2.5">{nf(sum((snap) => snap.totals.deliveredForBonus))}</td>
            <td className="px-3 py-2.5">{nf(sum((snap) => snap.totals.baseBonus))}</td>
            <td className="px-3 py-2.5">{nf(sum((snap) => snap.totals.crossSellBonus))}</td>
            <td className="px-3 py-2.5">{nf(sum((snap) => snap.totals.upsellBonus))}</td>
            <td className="px-3 py-2.5">{nf(sum((snap) => snap.totals.adjustments ?? 0))}</td>
            <td className="px-3 py-2.5">{nf(sum((snap) => snap.totals.fines))}</td>
            <td className="px-3 py-2.5">{nf(sum((snap) => snap.totals.finalBonus))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function OrdersTable({ rows, sym }: { rows: Array<WeeklyReportSnapshot["orders"][number] & { repName?: string }>; sym: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full !min-w-[960px] text-left text-[12px]">
        <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
          <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
            {["#", "Order ID", "Rep", "Date", "Customer", "Product", "Type", `Amount (${sym})`, "Status", `Bonus (${sym})`].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.repName}-${row.id}`} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200">
              <td className="px-3 py-2.5 text-gray-500">{index + 1}</td>
              <td className="px-3 py-2.5 font-bold">#{row.id}</td>
              <td className="px-3 py-2.5">{row.repName ?? "-"}</td>
              <td className="whitespace-nowrap px-3 py-2.5">
                {longDate(row.date)}
                {/* Placed in an earlier week, delivered (and paid) in this one (Bright, 3 Oct 2026). */}
                {row.placedThisWeek === false && <span className="mt-0.5 block text-[10px] font-bold text-blue-700 dark:text-blue-300">Carried over · delivered {row.deliveredDate ? longDate(row.deliveredDate) : ""}</span>}
              </td>
              <td className="px-3 py-2.5">{row.customer}</td>
              <td className="px-3 py-2.5">{row.product}</td>
              <td className="px-3 py-2.5"><OrderTypePill type={row.type} /></td>
              <td className="px-3 py-2.5">{nf(row.amount)}</td>
              <td className="px-3 py-2.5"><OrderStatusPill status={row.status} /></td>
              <td className="px-3 py-2.5">
                {row.bonus > 0 ? nf(row.bonus) : "-"}{row.bonusManuallyAdjusted && row.bonus > 0 ? <span className="ml-1 text-[10px] font-bold text-amber-600">edited</span> : null}
                {row.bonusNote ? <span className="mt-0.5 block max-w-[220px] text-[10px] font-semibold leading-snug text-amber-700 dark:text-amber-300">{row.bonusNote}</span> : null}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">No orders.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The side-by-side check Bright described: each figure the rep submitted next
 * to what the system shows now, with a tick when they agree.
 */
export function RepReviewModal({ row, weekStart, weekEnd, sym, canAct, canFlag, corrections, onClose, onApprove, onReturn, onFlag, ownerView, onOpenDecisions, escapePaused }: {
  row: ReviewRepRow;
  weekStart: string;
  weekEnd: string;
  sym: string;
  canAct: boolean;
  canFlag: boolean;
  corrections: WeeklyReportCorrection[];
  onClose: () => void;
  onApprove?: () => Promise<void>;
  onReturn?: () => void;
  onFlag?: () => void;
  ownerView?: boolean;
  onOpenDecisions?: (kind: DecisionKind) => void;
  escapePaused?: boolean;
}) {
  // Bright's report-window design (8 Oct 2026), in components/WeeklyRepReportModal.tsx.
  return (
    <WeeklyRepReportModal repName={row.repName} report={row.report} frozen={row.frozen} live={row.live} differences={row.differences}
      editedAfterSubmit={row.editedAfterSubmit} weekStart={weekStart} weekEnd={weekEnd} sym={sym} canAct={canAct} canFlag={canFlag}
      corrections={corrections} onClose={onClose} onApprove={onApprove} onReturn={onReturn} onFlag={onFlag} ownerView={ownerView}
      lateSend={row.lateSend} onOpenDecisions={onOpenDecisions} escapePaused={escapePaused} />
  );
}

function ResolveQueryModal({ query, repName, sym, onCancel, onSubmit }: {
  query: WeeklyBonusQuery;
  repName: string;
  sym: string;
  onCancel: () => void;
  onSubmit: (body: { outcome: "corrected" | "no_change"; response: string; amount?: number }) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState<"corrected" | "no_change">("corrected");
  const [amount, setAmount] = useState("");
  const [response, setResponse] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const value = Number(amount.replace(/[^0-9.]/g, ""));
  const ready = response.trim().length >= 3 && (outcome === "no_change" || value > 0);
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
  return (
    <Modal title={`Answer ${repName}'s bonus query`} subtitle={`Week of ${longDate(query.weekStart)}. The rep is notified of your answer.`} onClose={onCancel}>
      <div className="space-y-4 px-6 py-5">
        <div className="grid grid-cols-2 gap-2">
          {([["corrected", "Add a correction"], ["no_change", "No change needed"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setOutcome(key)}
              className={`!min-h-0 rounded-xl border px-3 py-2.5 text-[13px] font-bold ${outcome === key ? "border-[#1F6FEB] bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200" : "border-gray-200 text-gray-600 dark:border-slate-700 dark:text-slate-300"}`}>
              {label}
            </button>
          ))}
        </div>
        {outcome === "corrected" && (
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">Amount to add ({sym})</span>
            <input className={field} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 745" />
            <span className="mt-1 block text-[11px] text-gray-500">Paid with the week that is running now and shown on that week's report. The week asked about is not changed.</span>
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-bold text-gray-700 dark:text-slate-300">What you found</span>
          <textarea className={`${field} resize-none`} rows={3} maxLength={1000} value={response} onChange={(event) => setResponse(event.target.value)}
            placeholder={outcome === "corrected" ? "e.g. Cross-sell on #4307 was missed; adding the ₦745" : "e.g. #4307 was delivered on 29 Sept, so it is paid in next week's report"} />
        </label>
        {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">Cancel</button>
          <button type="button" disabled={!ready || saving} onClick={async () => {
            setSaving(true);
            setError("");
            try { await onSubmit({ outcome, response: response.trim(), ...(outcome === "corrected" ? { amount: value } : {}) }); }
            catch (err: any) { setError(err?.message ?? "Could not save."); setSaving(false); }
          }} className="!min-h-0 rounded-xl bg-[#1F6FEB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-40">{saving ? "Saving…" : "Send answer"}</button>
        </div>
      </div>
    </Modal>
  );
}
