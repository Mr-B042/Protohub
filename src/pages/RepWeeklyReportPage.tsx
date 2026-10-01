import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, Box, Download, FileSpreadsheet, MoreVertical, Search, Send, ShoppingCart, Target, Wallet } from "lucide-react";
import {
  ChartLegend, KpiCard, NoteBox, NumberedHeader, OrderStatusPill, OrderTypePill, OrdersRateChart, Panel, RateBar,
  RepStatusPill, StepBadge, WeekPicker, WorkflowSteps, dailyChartRows, dateTimeText, deltaPct, downloadCsv, longDate, nf,
  pctText, shortDateTime, topProductsWithOthers, type WorkflowStep
} from "../components/WeeklyReportParts";
import { CORRECTION_SECTION_LABEL, type WeeklyReportSnapshot } from "./weekly-report-model";
import type { WeeklyReportCorrection, WeeklyRepReport, WeeklyCompanyReportStatus, WeeklyReportResponseInput } from "../lib/api";
import { currencySymbol } from "../lib/money-privacy";

/**
 * Sales Rep -> Send Weekly Report (Bright's image 1, 1 Oct 2026).
 *
 * The rep reviews and submits; they never type a figure. Before submitting
 * (and after a return) the page shows the figures worked out NOW. Once
 * submitted it shows the frozen copy the manager is reviewing, so the rep
 * and the manager look at the same numbers.
 */
export default function RepWeeklyReportPage({
  weekStart, weekEnd, onShiftWeek, onPickWeek, canGoNext,
  live, report, companyStatus, corrections, loading, error, canSubmitNow, productImageByKey,
  onSubmit, onOpenOrder, onBack
}: {
  weekStart: string;
  weekEnd: string;
  onShiftWeek: (weeks: number) => void;
  onPickWeek: (dateKey: string) => void;
  canGoNext: boolean;
  live: WeeklyReportSnapshot | null;
  report: WeeklyRepReport | null;
  companyStatus: WeeklyCompanyReportStatus;
  corrections: WeeklyReportCorrection[];
  loading: boolean;
  error: string;
  /** False until the week's last day (Saturday). */
  canSubmitNow: boolean;
  productImageByKey: Record<string, string | undefined>;
  onSubmit: (note: string, responses: WeeklyReportResponseInput[]) => Promise<void>;
  onOpenOrder?: (orderId: string) => void;
  onBack: () => void;
}) {
  const status = report?.status ?? "draft";
  const showingFrozen = status !== "draft" && status !== "returned" && !!report?.snapshot;
  const snap: WeeklyReportSnapshot | null = showingFrozen ? (report!.snapshot as WeeklyReportSnapshot) : live;
  const openReturns = corrections.filter((row) => row.kind === "return" && row.status === "open");
  const [note, setNote] = useState(report?.repNote ?? "");
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [menuFor, setMenuFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const [orderPage, setOrderPage] = useState(0);
  const PAGE_SIZE = 10;

  useEffect(() => { setNote(report?.repNote ?? ""); setResponses({}); setSubmitError(""); }, [report?.id, report?.status, weekStart]);
  useEffect(() => { setOrderPage(0); }, [search, productFilter, statusFilter, typeFilter, weekStart]);

  const canSubmit = (status === "draft" || status === "returned")
    && companyStatus !== "submitted_to_owner" && companyStatus !== "locked"
    && canSubmitNow && !!live && !loading
    && openReturns.every((row) => (responses[row.id] ?? "").trim().length >= 2);

  const steps: WorkflowStep[] = [
    { title: "Fill & Review", detail: status === "draft" ? "Your data is ready" : "Reviewed", state: "done" },
    {
      title: "Submit to Manager",
      detail: status === "returned" ? "Returned. Fix what was asked, answer, then resubmit" : "Manager will review and provide feedback",
      state: status === "draft" || status === "returned" ? "current" : "done"
    },
    {
      title: "Manager Approval",
      detail: "Once approved, it goes to the owner",
      state: status === "manager_approved" || status === "owner_approved" || status === "locked" ? "done" : status === "submitted" ? "current" : "pending"
    },
    {
      title: "Owner Final Approval",
      detail: "Final confirmation and bonus lock",
      state: status === "locked" || status === "owner_approved" ? "done" : status === "manager_approved" ? "current" : "pending"
    }
  ];

  const orders = snap?.orders ?? [];
  const productOptions = useMemo(() => Array.from(new Set(orders.map((row) => row.product.split(" – ")[0]))).sort(), [orders]);
  const filteredOrders = orders.filter((row) => {
    const q = search.trim().toLowerCase();
    if (q && !`${row.id} ${row.customer}`.toLowerCase().includes(q)) return false;
    if (productFilter && row.product.split(" – ")[0] !== productFilter) return false;
    if (statusFilter && row.status !== statusFilter) return false;
    if (typeFilter && row.type !== typeFilter) return false;
    return true;
  });

  const totals = snap?.totals;
  const prev = snap?.previous ?? null;
  const productRows = snap ? topProductsWithOthers(snap.products) : [];
  const sym = currencySymbol();

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <button type="button" onClick={onBack} className="!min-h-0 inline-flex items-center gap-2 text-[13px] font-medium text-gray-700 hover:text-gray-900 dark:text-slate-300">
            <ArrowLeft className="h-4 w-4 text-[#1F8FE0]" /> Send Weekly Report
          </button>
          <div className="mt-3 flex items-start gap-3">
            <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300">
              <FileSpreadsheet className="h-7 w-7" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 text-2xl font-black tracking-tight text-gray-900 dark:text-slate-50">My Weekly Report</h1>
                <RepStatusPill status={status} />
              </div>
              <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-slate-400">Select the week, review your data, confirm and submit for manager review.</p>
            </div>
          </div>
        </div>
        <WeekPicker weekStart={weekStart} weekEnd={weekEnd} onShift={onShiftWeek} canGoNext={canGoNext} onPick={onPickWeek} />
      </div>

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-semibold text-rose-700">{error}</p>}

      {/* Returned: the exact issue, and a box to answer each one. */}
      {status === "returned" && openReturns.length > 0 && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
          <p className="m-0 flex items-center gap-2 text-[14px] font-bold text-rose-800 dark:text-rose-200">
            <AlertTriangle className="h-4 w-4" /> Returned by {openReturns[0].raisedByRole ?? "Manager"}
          </p>
          <ul className="m-0 mt-3 list-none space-y-3 p-0">
            {openReturns.map((row) => (
              <li key={row.id} className="rounded-xl bg-white p-3 dark:bg-slate-900">
                <p className="m-0 text-[13px] font-semibold text-gray-900 dark:text-slate-100">
                  {CORRECTION_SECTION_LABEL[row.section] ?? row.section} — {row.problem}{row.orderRef ? ` (${row.orderRef})` : ""}
                </p>
                <p className="m-0 mt-1 text-[12px] text-gray-600 dark:text-slate-300">"{row.comment}" — {row.raisedByName ?? "Manager"}, {shortDateTime(row.createdAt)}</p>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={responses[row.id] ?? ""}
                  onChange={(event) => setResponses({ ...responses, [row.id]: event.target.value })}
                  placeholder="Say what you corrected, or explain the figure"
                  className="mt-2 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[12px] text-rose-700 dark:text-rose-300">Fix the order record if you are allowed to, then answer each comment and resubmit. The figures below update by themselves.</p>
        </section>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          {/* ── KPI cards ───────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <KpiCard tone="blue" icon={ShoppingCart} label="Total Orders" value={nf(totals?.orders ?? 0)} delta={deltaPct(totals?.orders ?? 0, prev?.orders)} sub={`vs previous week (${nf(prev?.orders ?? 0)})`} />
            <KpiCard tone="green" icon={Box} label="Delivered Orders" value={nf(totals?.delivered ?? 0)} delta={deltaPct(totals?.delivered ?? 0, prev?.delivered)} sub={`vs previous week (${nf(prev?.delivered ?? 0)})`} />
            <KpiCard tone="orange" icon={Target} label="Delivery Rate" value={pctText(totals?.deliveryRate ?? 0)} delta={prev ? Math.round(((totals?.deliveryRate ?? 0) - prev.deliveryRate) * 10) / 10 : null} sub={`vs previous week (${pctText(prev?.deliveryRate ?? 0)})`} />
            <KpiCard tone="purple" icon={Wallet} label="Total Bonus Earned" labelTone="text-violet-700 dark:text-violet-300" value={`${sym}${nf(totals?.finalBonus ?? 0)}`} delta={null} sub="Calculated automatically" />
          </div>

          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            {/* ── 1 Product Breakdown ─────────────────────────────── */}
            <Panel>
              <NumberedHeader n={1} title="Product Breakdown" subtitle="Your orders and delivery rate per product." />
              <div className="overflow-x-auto px-3 pb-4 pt-3">
                <table className="!min-w-0 w-full table-fixed text-left text-[12px]">
                  <colgroup><col /><col className="w-14" /><col className="w-[72px]" /><col className="w-14" /><col className="w-[72px]" /></colgroup>
                  <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
                    <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                      <th className="px-2 py-2.5 font-bold">Product</th>
                      <th className="px-2 py-2.5 text-center font-bold">Orders</th>
                      <th className="px-2 py-2.5 text-center font-bold">Delivered</th>
                      <th className="px-2 py-2.5 font-bold" colSpan={2}>Delivery Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productRows.map((row) => (
                      <tr key={row.key} className="border-t border-gray-100 dark:border-slate-800">
                        <td className="px-2 py-2.5">
                          <span className="flex min-w-0 items-center gap-2.5 text-gray-800 dark:text-slate-200">
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
                              {productImageByKey[row.key]
                                ? <img src={productImageByKey[row.key]} alt="" className="h-full w-full object-cover" />
                                : <Box className="h-4 w-4 text-gray-400" />}
                            </span>
                            <span className="truncate" title={row.name}>{row.name}</span>
                          </span>
                        </td>
                        <td className="px-2 py-2.5 text-center text-gray-800 dark:text-slate-200">{nf(row.orders)}</td>
                        <td className="px-2 py-2.5 text-center text-gray-800 dark:text-slate-200">{nf(row.delivered)}</td>
                        <td className="px-2 py-2.5 text-right text-gray-800 dark:text-slate-200">{pctText(row.deliveryRate)}</td>
                        <td className="py-2.5 pr-2"><RateBar value={row.deliveryRate} tone={row.deliveryRate >= 75 ? "green" : "blue"} /></td>
                      </tr>
                    ))}
                    {productRows.length === 0 && (
                      <tr><td colSpan={5} className="px-2 py-6 text-center text-gray-500">No orders this week.</td></tr>
                    )}
                    <tr className="border-t border-gray-200 font-bold text-gray-900 dark:border-slate-700 dark:text-slate-50 [&>td]:[color:inherit]">
                      <td className="px-2 py-2.5">Total</td>
                      <td className="px-2 py-2.5 text-center">{nf(totals?.orders ?? 0)}</td>
                      <td className="px-2 py-2.5 text-center">{nf(totals?.delivered ?? 0)}</td>
                      <td className="px-2 py-2.5 text-right">{pctText(totals?.deliveryRate ?? 0)}</td>
                      <td className="py-2.5 pr-2"><RateBar value={totals?.deliveryRate ?? 0} tone="blue" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* ── 2 Order Trend ──────────────────────────────────── */}
            <Panel>
              <NumberedHeader n={2} title="Order Trend" subtitle="Your daily orders and delivery rate for the week." />
              <ChartLegend items={[{ label: "Orders", color: "#10b981" }, { label: "Delivered", color: "#3b82f6" }, { label: "Delivery Rate", color: "#f97316" }]} />
              <div className="px-3 pb-4 pt-2">
                <OrdersRateChart rows={dailyChartRows(snap?.daily ?? [])} ordersColor="#10b981" deliveredColor="#3b82f6" height={240} />
              </div>
            </Panel>

            {/* ── 3 Upsell & Cross-Sell Summary ───────────────────── */}
            <Panel>
              <NumberedHeader n={3} title="Upsell & Cross-Sell Summary" subtitle="Orders where you successfully upsold or cross-sold." />
              <div className="overflow-x-auto px-3 pb-4 pt-3">
                <table className="!min-w-0 w-full table-fixed text-left text-[12px]">
                  <colgroup><col /><col className="w-14" /><col className="w-[72px]" /><col className="w-12" /><col className="w-14" /><col className="w-[72px]" /></colgroup>
                  <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
                    <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                      <th className="px-2 py-2.5 font-bold">Type</th>
                      <th className="px-2 py-2.5 text-center font-bold">Orders</th>
                      <th className="px-2 py-2.5 text-center font-bold">Delivered</th>
                      <th className="px-2 py-2.5 font-bold" colSpan={2}>Delivery Rate</th>
                      <th className="whitespace-nowrap px-2 py-2.5 text-right font-bold">Bonus ({sym})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap && ([["Cross-Sell", snap.expansion.crossSell], ["Upsell", snap.expansion.upsell]] as const).map(([label, row]) => (
                      <tr key={label} className="border-t border-gray-100 dark:border-slate-800">
                        <td className="whitespace-nowrap px-2 py-3 font-semibold text-gray-900 dark:text-slate-100">{label}</td>
                        <td className="px-2 py-3 text-center text-gray-800 dark:text-slate-200">{nf(row.orders)}</td>
                        <td className="px-2 py-3 text-center text-gray-800 dark:text-slate-200">{nf(row.delivered)}</td>
                        <td className="px-2 py-3 text-gray-800 dark:text-slate-200">{pctText(row.deliveryRate, 0)}</td>
                        <td className="py-3 pr-2"><RateBar value={row.deliveryRate} tone="green" /></td>
                        <td className="px-2 py-3 text-right text-gray-800 dark:text-slate-200">{nf(row.bonus)}</td>
                      </tr>
                    ))}
                    {snap && (() => {
                      const orders = snap.expansion.crossSell.orders + snap.expansion.upsell.orders;
                      const delivered = snap.expansion.crossSell.delivered + snap.expansion.upsell.delivered;
                      const rate = orders > 0 ? (delivered / orders) * 100 : 0;
                      return (
                        <tr className="border-t border-gray-200 font-bold text-gray-900 dark:border-slate-700 dark:text-slate-50 [&>td]:[color:inherit]">
                          <td className="px-2 py-3">Total</td>
                          <td className="px-2 py-3 text-center">{nf(orders)}</td>
                          <td className="px-2 py-3 text-center">{nf(delivered)}</td>
                          <td className="px-2 py-3" colSpan={2}>{pctText(rate, 0)}</td>
                          <td className="px-2 py-3 text-right">{nf(snap.expansion.crossSell.bonus + snap.expansion.upsell.bonus)}</td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
              </div>
            </Panel>

            {/* ── 4 Bonus Breakdown ──────────────────────────────── */}
            <Panel>
              <NumberedHeader n={4} title="Bonus Breakdown" subtitle="Calculated from your orders, upsells and cross-sells." />
              <div className="px-3 pb-4 pt-3">
                <table className="!min-w-0 w-full text-left text-[12px]">
                  <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
                    <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                      <th className="px-3 py-2.5 font-bold">Detail</th>
                      <th className="px-3 py-2.5 text-right font-bold">Amount ({sym})</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-800 dark:text-slate-200 [&_td]:[color:inherit]">
                    <tr className="border-t border-gray-100 dark:border-slate-800"><td className="px-3 py-2">Base Bonus</td><td className="px-3 py-2 text-right">{nf(totals?.baseBonus ?? 0)}</td></tr>
                    <tr className="border-t border-gray-100 dark:border-slate-800"><td className="px-3 py-2">Cross-Sell Bonus ({nf(totals?.crossSellOrders ?? 0)} order{totals?.crossSellOrders === 1 ? "" : "s"})</td><td className="px-3 py-2 text-right">{nf(totals?.crossSellBonus ?? 0)}</td></tr>
                    <tr className="border-t border-gray-100 dark:border-slate-800"><td className="px-3 py-2">Upsell Bonus ({nf(totals?.upsellOrders ?? 0)} order{totals?.upsellOrders === 1 ? "" : "s"})</td><td className="px-3 py-2 text-right">{nf(totals?.upsellBonus ?? 0)}</td></tr>
                    <tr className="border-t border-gray-100 dark:border-slate-800">
                      <td className="px-3 py-2">Fines / Deductions{snap?.fines?.length ? <span className="block text-[11px] text-gray-500">{snap.fines.map((fine) => fine.label).join("; ")}</span> : null}</td>
                      <td className="px-3 py-2 text-right">{nf(totals?.fines ?? 0)}</td>
                    </tr>
                    <tr className="bg-emerald-50 font-bold text-gray-900 dark:bg-emerald-500/10 dark:text-slate-50 [&>td]:[color:inherit]">
                      <td className="px-3 py-2.5">Final Bonus Payable</td>
                      <td className="px-3 py-2.5 text-right text-[15px] text-emerald-700 dark:text-emerald-300">{sym}{nf(totals?.finalBonus ?? 0)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="m-0 mt-2 px-1 text-[11px] text-gray-500 dark:text-slate-400">
                  Bonus is paid on the {nf(totals?.deliveredForBonus ?? 0)} orders delivered between {longDate(weekStart)} and {longDate(weekEnd)}.
                </p>
              </div>
            </Panel>
          </div>
        </div>

        {/* ── Right column: Report Submission ─────────────────────── */}
        <div className="space-y-4">
          <Panel className="p-5">
            <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Report Submission</h2>
            <p className="m-0 mt-1 text-[12px] text-gray-500 dark:text-slate-400">Review your report and submit to your manager.</p>
            <div className="mt-5"><WorkflowSteps steps={steps} /></div>
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={async () => {
                setSubmitting(true);
                setSubmitError("");
                try {
                  await onSubmit(note.trim(), openReturns.map((row) => ({ correctionId: row.id, response: (responses[row.id] ?? "").trim() })));
                } catch (err: any) {
                  setSubmitError(err?.message ?? "Could not submit.");
                } finally {
                  setSubmitting(false);
                }
              }}
              className="!min-h-0 mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-[13px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" /> {submitting ? "Submitting…" : status === "returned" ? "Resubmit to Manager" : "Submit to Manager"}
            </button>
            {!canSubmitNow && (status === "draft" || status === "returned") && (
              <p className="m-0 mt-2 text-[11px] text-gray-500">You can submit from Saturday, {longDate(weekEnd)}.</p>
            )}
            {status === "returned" && openReturns.some((row) => !(responses[row.id] ?? "").trim()) && (
              <p className="m-0 mt-2 text-[11px] text-rose-600">Answer each comment above before you resubmit.</p>
            )}
            {submitError && <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{submitError}</p>}
          </Panel>

          <Panel className="p-5">
            <h3 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-50">Current Status</h3>
            <div className="mt-2.5"><StepBadge tone={status === "returned" ? "gray" : "green"}><RepStatusPill status={status} /></StepBadge></div>
            <p className="m-0 mt-2 text-[12px] text-gray-500 dark:text-slate-400">
              {report?.submittedAt
                ? `Last submitted: ${dateTimeText(report.submittedAt)}`
                : snap ? `Figures worked out: ${dateTimeText(snap.generatedAt)}` : loading ? "Working out your figures…" : ""}
            </p>
            <div className="mt-4">
              <NoteBox
                label="Add a Note (Optional)"
                value={note}
                onChange={setNote}
                disabled={!(status === "draft" || status === "returned")}
                placeholder="Write a note for your manager..."
              />
            </div>
          </Panel>
        </div>
      </div>

      {/* ── 5 Order Details ───────────────────────────────────────── */}
      <Panel>
        <div className="flex flex-col gap-3 pb-1 xl:flex-row xl:items-start xl:justify-between">
          <NumberedHeader n={5} title="Order Details" subtitle="All your orders for this week. Filter, search and verify." />
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4 xl:pl-0">
            <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-gray-200 px-3 dark:border-slate-700">
              <Search className="h-4 w-4 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order ID, customer name or phone..." className="w-full border-0 bg-transparent text-[12px] outline-none dark:text-slate-100" />
            </label>
            <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <option value="">All Products</option>
              {productOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <option value="">All Status</option>
              {Array.from(new Set(orders.map((row) => row.status))).sort().map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[12px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              <option value="">All Types</option>
              {["Upsell", "Cross-Sell", "Upsell + Cross-Sell", "Standard"].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <button
              type="button"
              onClick={() => downloadCsv(`weekly-report-${weekStart}.csv`,
                ["#", "Order ID", "Date", "Customer", "Product", "Type", "Amount", "Status", "Bonus"],
                filteredOrders.map((row, index) => [index + 1, row.id, row.date, row.customer, row.product, row.type, row.amount, row.status, row.bonus]))}
              className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 px-4 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-100"
            >
              <Download className="h-4 w-4" /> Export
            </button>
          </div>
        </div>
        <div className="overflow-x-auto px-3 pb-4 pt-3">
          <table className="w-full !min-w-[960px] text-left text-[12px]">
            <thead className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 [&_th]:[color:inherit]">
              <tr className="bg-gray-50 dark:bg-slate-800/60 [&>th]:bg-transparent [&>th]:[color:inherit]">
                <th className="px-3 py-2.5 font-bold">#</th>
                <th className="px-3 py-2.5 font-bold">Order ID</th>
                <th className="px-3 py-2.5 font-bold">Date</th>
                <th className="px-3 py-2.5 font-bold">Customer</th>
                <th className="px-3 py-2.5 font-bold">Product</th>
                <th className="px-3 py-2.5 font-bold">Type</th>
                <th className="px-3 py-2.5 font-bold">Amount ({sym})</th>
                <th className="px-3 py-2.5 font-bold">Status</th>
                <th className="px-3 py-2.5 font-bold">Bonus ({sym})</th>
                <th className="w-8 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filteredOrders.slice(orderPage * PAGE_SIZE, orderPage * PAGE_SIZE + PAGE_SIZE).map((row, rowIndex) => { const index = orderPage * PAGE_SIZE + rowIndex; return (
                <tr key={row.id} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="px-3 py-2.5 text-gray-600 dark:text-slate-300">{index + 1}</td>
                  <td className="px-3 py-2.5 font-bold text-gray-900 dark:text-slate-100">#{row.id}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-gray-700 dark:text-slate-300">{longDate(row.date)}</td>
                  <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{row.customer}</td>
                  <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{row.product}</td>
                  <td className="px-3 py-2.5"><OrderTypePill type={row.type} /></td>
                  <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{nf(row.amount)}</td>
                  <td className="px-3 py-2.5"><OrderStatusPill status={row.status} /></td>
                  <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{row.bonus > 0 ? nf(row.bonus) : "-"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      aria-label={`More for order ${row.id}`}
                      onClick={(event) => {
                        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuFor(menuFor?.id === row.id ? null : { id: row.id, x: rect.right, y: rect.bottom });
                      }}
                      className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ); })}
              {filteredOrders.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-500">{loading ? "Loading your orders…" : "No orders match."}</td></tr>
              )}
            </tbody>
          </table>
          {filteredOrders.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 px-3 pt-3 text-[12px] text-gray-600 dark:text-slate-300">
              <span>Showing {orderPage * PAGE_SIZE + 1}–{Math.min(filteredOrders.length, (orderPage + 1) * PAGE_SIZE)} of {filteredOrders.length} orders</span>
              <span className="flex gap-1">
                <button type="button" disabled={orderPage === 0} onClick={() => setOrderPage(orderPage - 1)} className="!min-h-0 rounded-lg border border-gray-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700">Previous</button>
                <button type="button" disabled={(orderPage + 1) * PAGE_SIZE >= filteredOrders.length} onClick={() => setOrderPage(orderPage + 1)} className="!min-h-0 rounded-lg border border-gray-200 px-3 py-1.5 font-semibold disabled:opacity-40 dark:border-slate-700">Next</button>
              </span>
            </div>
          )}
        </div>
      </Panel>

      {menuFor && createPortal(
        <div className="fixed inset-0 z-[70]" onClick={() => setMenuFor(null)}>
          <div
            className="absolute w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={{ top: menuFor.y + 4, left: Math.max(8, menuFor.x - 176) }}
            onClick={(event) => event.stopPropagation()}
          >
            {onOpenOrder && (
              <button type="button" className="!min-h-0 block w-full px-4 py-2 text-left text-[13px] hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800" onClick={() => { onOpenOrder(menuFor.id); setMenuFor(null); }}>
                Open order
              </button>
            )}
            <button type="button" className="!min-h-0 block w-full px-4 py-2 text-left text-[13px] hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800" onClick={() => { void navigator.clipboard?.writeText(menuFor.id); setMenuFor(null); }}>
              Copy order ID
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
