import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Box, Check, CheckCircle2, ChevronRight, ClipboardList, Download, FileText, Inbox, MessageCircle, MoreVertical,
  RotateCcw, Search, Send, ShoppingCart, Target, Undo2, Wallet, X, Crown, Flag
} from "lucide-react";
import {
  Avatar, AuditTable, ChartLegend, CorrectionForm, CorrectionList, KpiCard, Modal, NoteBox, NumberedHeader, OrderStatusPill,
  OrderTypePill, OrdersRateChart, Panel, ProductDonut, RateBar, RepStatusPill, StepBadge, WeekPicker, WorkflowSteps,
  dailyChartRows, deltaPct, downloadCsv, longDate, nf, pctText, shortDateTime, shortDay, type CorrectionDraft, type WorkflowStep
} from "../components/WeeklyReportParts";
import {
  CORRECTION_SECTION_LABEL, buildCompanySnapshot, type ManagerBonusPreview, type SnapshotDifference, type WeeklyReportSnapshot
} from "./weekly-report-model";
import type {
  WeeklyCompanyReport, WeeklyRepReport, WeeklyReportAuditEntry, WeeklyReportCorrection, WeeklyReportResponseInput
} from "../lib/api";
import { currencySymbol } from "../lib/money-privacy";

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
  rows, company, corrections, audit, managerBonus, canAct, readOnlyReason,
  onApprove, onReturn, onFlag, onSubmitToOwner, onBack, onEditManagerBonus
}: {
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
  const [tab, setTab] = useState<"reps" | "company" | "bonus" | "orders" | "audit">("reps");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [returning, setReturning] = useState<string | null>(null);
  const [flagging, setFlagging] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<{ repId: string; x: number; y: number } | null>(null);
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
  const expectedRows = rows.filter((row) => row.expected || row.report);
  const shown = expectedRows.map(shownSnapshot).filter((snap): snap is WeeklyReportSnapshot => !!snap);
  const companySnap = useMemo(() => buildCompanySnapshot(weekStart, weekEnd, shown), [weekStart, weekEnd, shown]);
  const totals = companySnap.totals;
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
  const repCorrections = corrections.filter((row) => row.repReportId);
  const repNameByReportId = (id: string | null) => rows.find((row) => row.report?.id === id)?.repName ?? "-";
  const repNameById = (id: string | null) => rows.find((row) => row.repId === id)?.repName ?? "-";

  const canSubmit = canAct && allApproved && (companyStatus === "open" || companyStatus === "returned_to_manager")
    && ownerReturns.every((row) => (ownerResponses[row.id] ?? "").trim().length >= 2);
  const submitBlocker = !canAct
    ? readOnlyReason ?? "Only a Manager or Admin can submit."
    : frozenWeek
      ? companyStatus === "locked" ? "This week is approved and locked." : "Submitted. Waiting for the owner."
      : !allApproved
        ? `${total - approvedCount} of ${total} report${total === 1 ? "" : "s"} still need${total - approvedCount === 1 ? "s" : ""} your approval.`
        : ownerReturns.length > 0 && !ownerReturns.every((row) => (ownerResponses[row.id] ?? "").trim())
          ? "Answer the owner's comments first."
          : "";

  const steps: WorkflowStep[] = [
    { title: "Sales Reps Submit", detail: "Reps submit their weekly reports", state: total > 0 && inCount === total ? "done" : "current", badge: <StepBadge tone="green">{inCount} of {total} submitted</StepBadge> },
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

  const submitPanel = (
    <div className="space-y-4">
      <Panel className="p-5">
        <h2 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Approval Workflow</h2>
        <div className="mt-4"><WorkflowSteps steps={steps} /></div>
        {companyStatus === "returned_to_manager" && ownerReturns.length > 0 && (
          <div className="mt-4 space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="m-0 text-[12px] font-bold text-rose-800 dark:text-rose-200">Returned by the owner</p>
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
          onClick={async () => {
            setSubmitting(true);
            setSubmitError("");
            try {
              await onSubmitToOwner(managerNote.trim(), ownerReturns.map((row) => ({ correctionId: row.id, response: (ownerResponses[row.id] ?? "").trim() })));
            } catch (err: any) {
              setSubmitError(err?.message ?? "Could not submit.");
            } finally {
              setSubmitting(false);
            }
          }}
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

  const managerBonusPanel = (
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
              <tr className="bg-violet-50 font-bold text-violet-900 dark:bg-violet-500/10 dark:text-violet-100 [&>td]:[color:inherit]"><td className="whitespace-nowrap px-2 py-3 text-[13px]">Total Manager Bonus</td><td className="py-3 text-[17px]" colSpan={2}>{sym}{nf(managerBonus.total)}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="m-0 text-[12px] text-gray-500">{loading ? "Working out the manager bonus…" : "Manager bonus not available for this week."}</p>
        )}
      </div>
    </Panel>
  );

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <nav className="flex items-center gap-2 text-[12px] text-gray-600 dark:text-slate-400" aria-label="Breadcrumb">
            <button type="button" onClick={onBack} className="!min-h-0 inline-flex items-center gap-1.5 font-medium text-[#1F8FE0] hover:underline">← Manager Dashboard</button>
            <ChevronRight className="h-3.5 w-3.5" />
            <span>Weekly Reports</span>
          </nav>
          <div className="mt-3 flex items-start gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"><ClipboardList className="h-7 w-7" /></span>
            <div>
              <h1 className="m-0 text-2xl font-black tracking-tight text-gray-900 dark:text-slate-50">{mode === "submit" ? "Submit My Report" : "Manager Weekly Report Review"}</h1>
              <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-slate-400">
                {mode === "submit"
                  ? "Check the company week and your own bonus, then submit to the owner."
                  : "Review, verify and approve weekly reports from sales reps. Check for accuracy, request corrections if needed, and submit to owner."}
              </p>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 xl:flex-nowrap">
          <WeekPicker weekStart={weekStart} weekEnd={weekEnd} onShift={onShiftWeek} canGoNext={canGoNext} />
          <label className="relative !min-h-0 inline-flex h-11 cursor-pointer items-center rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-semibold text-gray-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            Change Week
            <input type="date" aria-label="Change week" className="absolute inset-0 cursor-pointer opacity-0" value={weekStart} onChange={(event) => event.target.value && onPickWeek(event.target.value)} />
          </label>
        </div>
      </div>

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <KpiCard tone="blue" icon={ShoppingCart} label="Company Total Orders" value={nf(totals.orders)} delta={deltaPct(totals.orders, prev?.orders)} sub={`vs previous week (${nf(prev?.orders ?? 0)})`} />
            <KpiCard tone="green" icon={Box} label="Delivered Orders" value={nf(totals.delivered)} delta={deltaPct(totals.delivered, prev?.delivered)} sub={`vs previous week (${nf(prev?.delivered ?? 0)})`} />
            <KpiCard tone="orange" icon={Target} label="Delivery Rate" value={pctText(totals.deliveryRate)} delta={prev ? Math.round((totals.deliveryRate - prev.deliveryRate) * 10) / 10 : null} sub={`vs previous week (${pctText(prev?.deliveryRate ?? 0)})`} />
            <KpiCard tone="purple" icon={Wallet} label="Total Bonus Payable" labelTone="text-violet-700 dark:text-violet-300" value={`${sym}${nf(totals.totalBonus)}`} delta={deltaPct(totals.totalBonus, prev?.totalBonus)} sub={`vs previous week (${sym}${nf(prev?.totalBonus ?? 0)})`} />
          </div>

          {mode === "submit" ? (
            <>
              <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Panel>
                  <NumberedHeader n={1} title="Company Breakdown" subtitle="Orders and delivery rate per product, all reps." />
                  <CompanyProductTable products={companySnap.products} totals={totals} />
                </Panel>
                {managerBonusPanel}
              </div>
              <Panel>
                <NumberedHeader n={2} title="Bonus Breakdown" subtitle="Every rep's approved bonus for the week." />
                <RepBonusTable snaps={shown} sym={sym} />
              </Panel>
            </>
          ) : (
            <Panel className="overflow-hidden">
              {/* ── Tabs ─────────────────────────────────────────── */}
              <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-3 pt-3 dark:border-slate-800" role="tablist">
                {([["reps", "Sales Rep Reports"], ["company", "Company Breakdown"], ["bonus", "Bonus Breakdown"], ["orders", "Order Details"], ["audit", "Audit Trail"]] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                    className={`!min-h-0 whitespace-nowrap rounded-t-lg px-5 py-2.5 text-[13px] font-semibold ${tab === key ? "bg-[#1F6FEB] text-white" : "bg-gray-50 text-gray-600 hover:text-gray-900 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === "reps" && (
                <div>
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
                  <div className="overflow-x-auto px-3 pb-3">
                    <table className="w-full !min-w-[820px] text-left text-[12px]">
                      <thead className="text-[11px] text-gray-600 dark:text-slate-400 [&_th]:[color:inherit]">
                        <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                          {["#", "Sales Rep", "Report Status", "Orders", "Delivered", "Delivery Rate", `Cross-Sell (${sym})`, `Upsell (${sym})`, `Base (${sym})`, `Total (${sym})`, "Actions"].map((h) => (
                            <th key={h} className="whitespace-nowrap px-2 py-2.5 font-bold">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {expectedRows.map((row, index) => {
                          const snap = shownSnapshot(row);
                          const status = row.report?.status ?? "draft";
                          return (
                            <tr key={row.repId} className="border-t border-gray-100 dark:border-slate-800">
                              <td className="px-2 py-3 text-gray-600">{index + 1}</td>
                              <td className="px-2 py-3"><span className="flex items-center gap-2 whitespace-nowrap font-semibold text-gray-900 dark:text-slate-100"><Avatar name={row.repName} />{row.repName}</span></td>
                              <td className="px-2 py-3">
                                <RepStatusPill status={status} approvedLabel="Approved" />
                                <span className="mt-0.5 block text-[11px] text-gray-500">{row.report?.submittedAt ? shortDateTime(row.report.submittedAt) : "Not submitted"}</span>
                                {row.differences.length > 0 && <span className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-amber-600"><AlertTriangle className="h-3 w-3" />{row.differences.length} figure{row.differences.length === 1 ? "" : "s"} changed</span>}
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
                                  <button type="button" onClick={() => setReviewing(row.repId)} className="!min-h-0 rounded-lg bg-blue-50 px-2 py-1.5 text-[12px] font-bold text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-200">Review</button>
                                  <button type="button" aria-label={`More for ${row.repName}`} onClick={(event) => {
                                    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                                    setMenuFor(menuFor?.repId === row.repId ? null : { repId: row.repId, x: rect.right, y: rect.bottom });
                                  }} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {expectedRows.length === 0 && (
                          <tr><td colSpan={11} className="px-2 py-8 text-center text-gray-500">{loading ? "Loading reports…" : "No sales rep had orders this week."}</td></tr>
                        )}
                        <tr className="border-t border-gray-200 font-bold text-gray-900 dark:border-slate-700 dark:text-slate-50 [&>td]:[color:inherit]">
                          <td className="px-2 py-3" colSpan={2}>Total</td>
                          <td className="px-2 py-3">-</td>
                          <td className="px-2 py-3">{nf(totals.orders)}</td>
                          <td className="px-2 py-3">{nf(totals.delivered)}</td>
                          <td className="px-2 py-3">{pctText(totals.deliveryRate)}</td>
                          <td className="px-2 py-3">{nf(totals.crossSellBonus)}</td>
                          <td className="px-2 py-3">{nf(totals.upsellBonus)}</td>
                          <td className="px-2 py-3">{nf(totals.baseBonus)}</td>
                          <td className="px-2 py-3">{nf(totals.totalBonus)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === "company" && (
                <div className="grid grid-cols-1 gap-4 p-4 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="rounded-xl border border-gray-100 dark:border-slate-800">
                    <NumberedHeader title="Product Breakdown" subtitle="All reps, orders placed this week." />
                    <CompanyProductTable products={companySnap.products} totals={totals} />
                  </div>
                  <div className="rounded-xl border border-gray-100 dark:border-slate-800">
                    <NumberedHeader title="Daily Orders & Delivery" subtitle="Orders placed each day, and how many delivered." />
                    <ChartLegend items={[{ label: "Orders", color: "#3b82f6" }, { label: "Delivered", color: "#10b981" }, { label: "Delivery Rate", color: "#f97316" }]} />
                    <div className="px-3 pb-4 pt-2"><OrdersRateChart rows={dailyChartRows(companySnap.daily)} ordersColor="#3b82f6" deliveredColor="#10b981" /></div>
                  </div>
                </div>
              )}

              {tab === "bonus" && <RepBonusTable snaps={shown} sym={sym} />}

              {tab === "orders" && (
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
              )}

              {tab === "audit" && <div className="p-2"><AuditTable entries={audit} repName={repNameById} /></div>}
            </Panel>
          )}

          {mode === "review" && tab === "reps" && (
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
        </div>

        {submitPanel}
      </div>

      {/* ── Row menu ────────────────────────────────────────────── */}
      {menuFor && createPortal(
        <div className="fixed inset-0 z-[70]" onClick={() => setMenuFor(null)}>
          <div className="absolute w-52 rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" style={{ top: menuFor.y + 4, left: Math.max(8, menuFor.x - 208) }} onClick={(event) => event.stopPropagation()}>
            <MenuItem icon={ClipboardList} label="Review report" onClick={() => { setReviewing(menuFor.repId); setMenuFor(null); }} />
            {canAct && !frozenWeek && <MenuItem icon={Undo2} label="Return for correction" onClick={() => { setReturning(menuFor.repId); setMenuFor(null); }} />}
            {canAct && companyStatus !== "locked" && <MenuItem icon={Flag} label="Flag issue" onClick={() => { setFlagging(menuFor.repId); setMenuFor(null); }} />}
          </div>
        </div>,
        document.body
      )}

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
          onApprove={async () => { await onApprove(reviewRow.repId); setReviewing(null); }}
          onReturn={() => { setReturning(reviewRow.repId); setReviewing(null); }}
          onFlag={() => { setFlagging(reviewRow.repId); setReviewing(null); }}
        />
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
            {["Sales Rep", "Delivered (bonus)", `Base (${sym})`, `Cross-Sell (${sym})`, `Upsell (${sym})`, `Fines (${sym})`, `Final (${sym})`].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}
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
              <td className="whitespace-nowrap px-3 py-2.5">{longDate(row.date)}</td>
              <td className="px-3 py-2.5">{row.customer}</td>
              <td className="px-3 py-2.5">{row.product}</td>
              <td className="px-3 py-2.5"><OrderTypePill type={row.type} /></td>
              <td className="px-3 py-2.5">{nf(row.amount)}</td>
              <td className="px-3 py-2.5"><OrderStatusPill status={row.status} /></td>
              <td className="px-3 py-2.5">{row.bonus > 0 ? nf(row.bonus) : "-"}{row.bonusManuallyAdjusted && row.bonus > 0 ? <span className="ml-1 text-[10px] font-bold text-amber-600">edited</span> : null}</td>
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
export function RepReviewModal({ row, weekStart, weekEnd, sym, canAct, canFlag, corrections, onClose, onApprove, onReturn, onFlag, ownerView }: {
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
}) {
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");
  const submitted = row.frozen;
  const live = row.live;
  const status = row.report?.status ?? "draft";
  const diffKeys = new Set(row.differences.map((item) => item.key));
  const productDiff = row.differences.some((item) => item.key.startsWith("product:"));
  const lines: Array<{ label: string; submitted: string; now: string; ok: boolean }> = submitted && live ? [
    { label: "System Orders", submitted: nf(submitted.totals.orders), now: nf(live.totals.orders), ok: !diffKeys.has("orders") },
    { label: "Delivered", submitted: nf(submitted.totals.delivered), now: nf(live.totals.delivered), ok: !diffKeys.has("delivered") },
    { label: "Delivery Rate", submitted: pctText(submitted.totals.deliveryRate), now: pctText(live.totals.deliveryRate), ok: !diffKeys.has("deliveryRate") },
    { label: "Product Breakdown", submitted: `${submitted.products.length} products`, now: productDiff ? "Changed" : "Verified", ok: !productDiff },
    { label: "Cross-sells", submitted: `${submitted.totals.crossSellOrders} · ${sym}${nf(submitted.totals.crossSellBonus)}`, now: `${live.totals.crossSellOrders} · ${sym}${nf(live.totals.crossSellBonus)}`, ok: !diffKeys.has("crossSellOrders") && !diffKeys.has("crossSellBonus") },
    { label: "Upsells", submitted: `${submitted.totals.upsellOrders} · ${sym}${nf(submitted.totals.upsellBonus)}`, now: `${live.totals.upsellOrders} · ${sym}${nf(live.totals.upsellBonus)}`, ok: !diffKeys.has("upsellOrders") && !diffKeys.has("upsellBonus") },
    { label: "Base Bonus", submitted: `${sym}${nf(submitted.totals.baseBonus)}`, now: `${sym}${nf(live.totals.baseBonus)}`, ok: !diffKeys.has("baseBonus") },
    { label: "Fines / Deductions", submitted: `${sym}${nf(submitted.totals.fines)}`, now: `${sym}${nf(live.totals.fines)}`, ok: !diffKeys.has("fines") },
    { label: "Final Payable", submitted: `${sym}${nf(submitted.totals.finalBonus)}`, now: `${sym}${nf(live.totals.finalBonus)}`, ok: !diffKeys.has("finalBonus") }
  ] : [];
  const manual = (submitted ?? live)?.totals.manuallyAdjustedOrders ?? 0;
  return (
    <Modal title={`${row.repName} — Weekly Report · ${shortDay(weekStart)} – ${shortDay(weekEnd)}`} subtitle="What the rep submitted, checked against the system's records now." onClose={onClose} wide>
      <div className="space-y-5 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <RepStatusPill status={status} />
          {row.report?.submittedAt && <span className="text-[12px] text-gray-500">Submitted {shortDateTime(row.report.submittedAt)}{(row.report.submitCount ?? 0) > 1 ? ` · submission ${row.report.submitCount}` : ""}</span>}
        </div>

        {!submitted ? (
          <p className="m-0 rounded-xl bg-gray-50 px-4 py-3 text-[13px] text-gray-600 dark:bg-slate-800 dark:text-slate-300">
            {row.repName} has not submitted this week yet. Today's figures: {nf(live?.totals.orders ?? 0)} orders, {nf(live?.totals.delivered ?? 0)} delivered ({pctText(live?.totals.deliveryRate ?? 0)}), bonus {sym}{nf(live?.totals.finalBonus ?? 0)}.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
            <table className="!min-w-0 w-full text-left text-[13px]">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-slate-800/60 dark:text-slate-400 [&_th]:bg-transparent [&_th]:[color:inherit]">
                <tr><th className="px-4 py-2.5">Check</th><th className="px-4 py-2.5">Submitted</th><th className="px-4 py-2.5">System now</th><th className="px-4 py-2.5 text-center">Match</th></tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.label} className={`border-t border-gray-100 dark:border-slate-800 ${line.ok ? "" : "bg-amber-50/60 dark:bg-amber-500/10"}`}>
                    <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{line.label}</td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300">{line.submitted}</td>
                    <td className="px-4 py-2.5 text-gray-700 dark:text-slate-300">{line.now}</td>
                    <td className="px-4 py-2.5 text-center">{line.ok ? <Check className="mx-auto h-4 w-4 text-emerald-600" strokeWidth={3} /> : <X className="mx-auto h-4 w-4 text-amber-600" strokeWidth={3} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(manual > 0 || row.editedAfterSubmit.length > 0) && (
          <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            {manual > 0 && <p className="m-0 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{manual} order{manual === 1 ? " has" : "s have"} a bonus changed by hand.</p>}
            {row.editedAfterSubmit.slice(0, 6).map((edit) => (
              <p key={`${edit.orderId}-${edit.editedAt}-${edit.what}`} className="m-0">Order #{edit.orderId}: {edit.what} after submit ({shortDateTime(edit.editedAt)}{edit.by ? `, ${edit.by}` : ""})</p>
            ))}
            {row.editedAfterSubmit.length > 6 && <p className="m-0">…and {row.editedAfterSubmit.length - 6} more changes.</p>}
          </div>
        )}

        {row.report?.repNote && (
          <div><p className="m-0 text-[12px] font-bold text-gray-700 dark:text-slate-300">Rep's note</p><p className="m-0 mt-1 text-[13px] text-gray-800 dark:text-slate-200">{row.report.repNote}</p></div>
        )}

        {corrections.length > 0 && (
          <div>
            <p className="m-0 mb-2 text-[12px] font-bold text-gray-700 dark:text-slate-300">Returns and flags on this report</p>
            <ul className="m-0 list-none space-y-2 p-0">
              {corrections.map((item) => (
                <li key={item.id} className="rounded-lg border border-gray-100 px-3 py-2 text-[12px] dark:border-slate-800">
                  <span className="font-bold">{item.kind === "flag" ? "Flag" : "Return"} · {CORRECTION_SECTION_LABEL[item.section]}:</span> {item.problem}{item.orderRef ? ` (${item.orderRef})` : ""} — "{item.comment}"
                  <span className="block text-gray-500">{item.raisedByName} · {shortDateTime(item.createdAt)} · {item.status === "open" ? "Open" : `Answered: ${item.response ?? ""}`}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p>}

        {!ownerView && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4 dark:border-slate-800">
            {canFlag && onFlag && (
              <button type="button" onClick={onFlag} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-amber-300 px-4 py-2 text-[13px] font-bold text-amber-700 hover:bg-amber-50 dark:text-amber-200"><Flag className="h-4 w-4" /> Flag Issue</button>
            )}
            {canAct && onReturn && (status === "submitted" || status === "manager_approved") && (
              <button type="button" onClick={onReturn} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-rose-300 px-4 py-2 text-[13px] font-bold text-rose-700 hover:bg-rose-50 dark:text-rose-200"><RotateCcw className="h-4 w-4" /> Return for Correction</button>
            )}
            {canAct && onApprove && status === "submitted" && (
              <button type="button" disabled={approving} onClick={async () => {
                setApproving(true);
                setError("");
                try { await onApprove(); } catch (err: any) { setError(err?.message ?? "Could not approve."); setApproving(false); }
              }} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"><Send className="h-4 w-4" /> {approving ? "Approving…" : "Approve Report"}</button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
