import { useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Columns3, Download, Grid2X2, List, Plus, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Upload, Wallet, X
} from "lucide-react";
import { expenseIntelApi } from "../../lib/api";
import DateWindowNav from "../../components/DateWindowNav";
import { PRESET_LABEL, presetRange, type DateWindow, type PresetKey } from "../../lib/date-window";
import type { TabProps } from "./context";
import { budgetRows, inRange, labelOf, monthEnd, monthKey, monthStart, sum, type EExpense } from "./model";
import { spentFor } from "./data";
import { CategoryPill, ExpenseDrawer, SourcePill, StatusPill, dateTime, useRowFacts } from "./rows";
import { RequestForm } from "./ApprovalsTab";
import { C, Card, Empty, Field, Kpi, Modal, btn, delta, downloadCsv, input, select, td, th } from "./ui";

type Row = EExpense & { pendingRequestId?: string };
// The same date bar as My Orders: shortcuts with counts, then the day stepper.
const SHORTCUTS: PresetKey[] = ["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth"];
const COLUMNS = ["Date & Time", "Expense ID", "Category", "Product / Reference", "Amount", "Payment Source", "Description", "Status"] as const;
type Col = (typeof COLUMNS)[number];
const addDays = (day: string, n: number) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function AllExpensesTab(p: TabProps & { focus: Record<string, string> }) {
  const { ctx, state } = p;
  const facts = useRowFacts(ctx);
  const full = state.me.full;
  const approver = state.me.approver;
  const isAccountant = ctx.role === "Accountant";
  const today = ctx.today;
  // Opens on This Month, as before. "All Expenses" is not a range, so it is its own toggle.
  const [win, setWin] = useState<DateWindow>(() => presetRange("thisMonth", today));
  const [showAll, setShowAll] = useState(false);
  const firstDay = useMemo(() => ctx.expenses.reduce((m, e) => (e.date && e.date < m ? e.date : m), today), [ctx.expenses, today]);
  const lastDay = useMemo(() => ctx.expenses.reduce((m, e) => (e.date && e.date > m ? e.date : m), today), [ctx.expenses, today]);
  // Days after today hold nothing yet; stopping at today keeps "vs the same days before" like for like.
  const range = useMemo(() => showAll ? { from: firstDay, to: lastDay }
    : { from: win.start, to: win.start <= today && win.end > today ? today : win.end }, [showAll, firstDay, lastDay, win, today]);
  const [f, setF] = useState({ search: "", category: p.focus.category ?? "", product: "", source: "", status: p.focus.status ?? "", person: "", state: "", min: "", max: "", receipt: "" });
  const [advanced, setAdvanced] = useState(false);
  const [sort, setSort] = useState<"new" | "old" | "high" | "low">("new");
  const [view, setView] = useState<"list" | "grid">("list");
  const [cols, setCols] = useState<Set<Col>>(new Set(COLUMNS));
  const [colsOpen, setColsOpen] = useState(false);
  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<EExpense | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pendingIn = (from: string, to: string) => state.requests.filter((r) => r.status === "pending" && inRange(r.expenseDate, from, to)).length;
  // Counted as LINES, like the list below, so a button never promises more rows than it shows.
  const countFor = (from: string, to: string) => ctx.mergeWaybills(p.expensesIn(from, to)).length + pendingIn(from, to);

  const inPeriod = useMemo(() => p.expensesIn(range.from, range.to), [p, range]);
  const lines: Row[] = useMemo(() => {
    const merged = ctx.mergeWaybills(inPeriod) as Row[];
    // Requests still waiting are shown with the expenses, marked Pending.
    const pending: Row[] = state.requests.filter((r) => r.status === "pending" && inRange(r.expenseDate, range.from, range.to)).map((r) => ({
      id: r.code, category: r.category, amount: r.amount, date: r.expenseDate, createdAt: r.createdAt, productId: r.productId ?? undefined,
      productName: ctx.products.find((x) => x.id === r.productId)?.name ?? "", description: r.purpose, paidBy: r.paymentSource,
      checkStatus: "unchecked", recordedByName: r.requestedByName, pendingRequestId: r.id
    }));
    return [...pending, ...merged];
  }, [ctx, inPeriod, state.requests, range]);

  const people = useMemo(() => [...new Set(lines.map((e) => facts(e).person).filter(Boolean))].sort(), [lines, facts]);
  const states = useMemo(() => [...new Set(lines.map((e) => facts(e).state).filter(Boolean))].sort(), [lines, facts]);
  const categories = useMemo(() => [...new Set(lines.map((e) => e.category))].sort(), [lines]);

  const filtered = useMemo(() => {
    const s = f.search.trim().toLowerCase();
    const min = Number(f.min.replace(/[,₦\s]/g, "")) || 0, max = Number(f.max.replace(/[,₦\s]/g, "")) || Infinity;
    const out = lines.filter((e) => {
      const x = facts(e);
      const status = e.pendingRequestId ? "pending" : e.checkStatus;
      return (!f.category || e.category === f.category) && (!f.product || e.productId === f.product) && (!f.source || (e.pendingRequestId ? e.paidBy : x.source) === f.source)
        && (!f.status || status === f.status) && (!f.person || x.person === f.person) && (!f.state || x.state === f.state)
        && e.amount >= min && e.amount <= max && (!f.receipt || (f.receipt === "yes") === Boolean(e.receiptUrl))
        && (!s || `${e.id} ${e.category} ${e.productName} ${e.description} ${x.person} ${x.state}`.toLowerCase().includes(s));
    });
    const key = (e: Row) => e.createdAt && e.createdAt.slice(0, 10) >= e.date ? `${e.date}|${e.createdAt}` : `${e.date}|`;
    return out.sort((a, b) => sort === "new" ? key(b).localeCompare(key(a)) : sort === "old" ? key(a).localeCompare(key(b)) : sort === "high" ? b.amount - a.amount : a.amount - b.amount);
  }, [lines, f, sort, facts]);

  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const at = Math.min(page, pages);
  const shown = filtered.slice((at - 1) * perPage, at * perPage);
  const advancedCount = [f.min, f.max, f.receipt, f.person, f.state].filter(Boolean).length;
  const chipCount = [f.category, f.product, f.source, f.status].filter(Boolean).length;

  // KPIs over the chosen dates (records, not lines).
  const total = sum(inPeriod, (e) => e.amount);
  const verified = sum(inPeriod.filter((e) => e.checkStatus !== "unchecked"), (e) => e.amount);
  const unchecked = sum(inPeriod.filter((e) => e.checkStatus === "unchecked"), (e) => e.amount);
  const pendingSum = sum(state.requests.filter((r) => r.status === "pending"), (r) => r.amount);
  const span = Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1;
  const prevTo = addDays(range.from, -1), prevFrom = addDays(range.from, -span);
  const prevTotal = sum(p.expensesIn(prevFrom, prevTo), (e) => e.amount);
  const m = monthKey(range.to);
  const monthRows = p.expensesIn(monthStart(m), monthEnd(m));
  const overBudget = full ? budgetRows(m, state.budgets, (c) => { const s = ctx.profit(monthStart(m), monthEnd(m)); return spentFor(c, monthRows, s.cogs, s.recognizedLogistics); }).filter((b) => b.status === "Over Budget").length : null;
  const dailyTotals = Array.from({ length: Math.min(span, 31) }, (_, i) => sum(inPeriod.filter((e) => e.date === addDays(range.to, i - Math.min(span, 31) + 1)), (e) => e.amount));

  const exportRows = (rows: Row[]) => downloadCsv(`expenses-${range.from}-to-${range.to}.csv`, [
    ["Date", "Recorded at", "Expense ID", "Category", "Product", "Amount", "Payment source", "Agent / staff", "State", "Description", "Status"],
    ...rows.map((e) => { const x = facts(e); return [e.date, e.createdAt ?? "", e.id, labelOf(e.category), e.productName, e.amount, e.pendingRequestId ? e.paidBy : x.source, x.person, x.state, e.description, e.pendingRequestId ? "Pending" : e.checkStatus === "auto" ? "Reconciled" : e.checkStatus === "verified" ? "Verified" : "Not checked"]; })
  ]);
  const verify = async (ids: string[]) => {
    setBusy(true);
    try { const { checked } = await expenseIntelApi.checkExpenses(ids); ctx.toast(`${checked} expense${checked === 1 ? "" : "s"} marked verified.`); setPicked(new Set()); ctx.refresh(); }
    catch (e: any) { ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  const open = (e: Row) => (e.pendingRequestId ? p.go("approvals", { request: e.pendingRequestId }) : setDrawer(e));
  const pickedRows = filtered.filter((e) => picked.has(e.id) && !e.pendingRequestId);
  const pickedIds = pickedRows.flatMap((e) => (e.partIds ?? [e.id]));
  const clear = () => { setF({ search: "", category: "", product: "", source: "", status: "", person: "", state: "", min: "", max: "", receipt: "" }); setPage(1); };
  const chip = (label: string, value: string, set: (v: string) => void, options: Array<[string, string]>) => (
    <label className="inline-flex h-10 items-center gap-1 rounded-xl border border-gray-200 bg-white pl-3 text-[12.5px] font-semibold text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      {label}:
      <select value={value} onChange={(e) => { set(e.target.value); setPage(1); }} className="h-full max-w-[170px] rounded-xl border-0 bg-transparent pr-2 text-[12.5px] font-bold text-gray-900 outline-none dark:text-slate-50">
        <option value="">All</option>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">All Expenses</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Complete record of all business expenses with search, filters and checks.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {full && <button type="button" className={btn.outline} onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" />Import Expenses</button>}
          <button type="button" className={btn.outline} onClick={() => exportRows(filtered)}><Download className="h-4 w-4" />Export</button>
          {isAccountant ? <button type="button" className={btn.primary} onClick={() => setRequestOpen(true)}><Plus className="h-4 w-4" />New Expense Request</button>
            : approver ? <button type="button" className={btn.primary} onClick={ctx.onAddExpense}><Plus className="h-4 w-4" />Add Expense</button> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Wallet} tone={C.blue} label="Total Expenses" value={ctx.money(total)} spark={dailyTotals} d={delta(total, prevTotal, { lowerIsBetter: true, label: "the same days before", beforeText: ctx.money(prevTotal) })} />
        <Kpi icon={CheckCircle2} tone={C.green} label="Verified Expenses" value={ctx.money(verified)} sub={`${total ? ((verified / total) * 100).toFixed(1) : "0"}% of total (checked or matched to source)`} onClick={() => setF({ ...f, status: "verified" })} />
        <Kpi icon={Clock3} tone={C.orange} label="Pending Approval" value={ctx.money(pendingSum)} sub={`${state.requests.filter((r) => r.status === "pending").length} request(s) waiting`} onClick={() => p.go("approvals")} />
        <Kpi icon={RefreshCw} tone={C.purple} label="Unreconciled" value={ctx.money(unchecked)} sub={`${total ? ((unchecked / total) * 100).toFixed(1) : "0"}% of total · not checked yet`} onClick={() => setF({ ...f, status: "unchecked" })} />
        {overBudget !== null && <Kpi icon={AlertTriangle} tone={C.red} label="Over Budget" value={`${overBudget} categor${overBudget === 1 ? "y" : "ies"}`} sub={`In ${new Date(`${m}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })}`} onClick={() => p.go("budgets")} />}
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200/80 bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          {SHORTCUTS.map((preset) => {
            const r = presetRange(preset, today);
            const on = !showAll && win.start === r.start && win.end === r.end;
            return (
              <button key={preset} type="button" onClick={() => { setShowAll(false); setWin(r); setPage(1); }}
                className={`!min-h-0 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all ${on ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-slate-300"}`}>
                {PRESET_LABEL[preset]}
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-black tabular-nums ${on ? "bg-emerald-100 text-emerald-800" : "bg-slate-200/70 text-slate-600"}`}>{countFor(r.start, r.end)}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => { setShowAll(true); setPage(1); }}
            className={`!min-h-0 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all ${showAll ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "text-slate-500 hover:bg-white hover:text-slate-900 dark:text-slate-300"}`}>
            All Expenses
            <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-black tabular-nums ${showAll ? "bg-emerald-100 text-emerald-800" : "bg-slate-200/70 text-slate-600"}`}>{countFor(firstDay, lastDay)}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200/80 bg-slate-50/60 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
          <label className="relative w-full sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${input} !pl-9`} placeholder="Search ID, description, product, agent…" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} /></label>
          <select aria-label="Status" value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }} className={`${select} min-w-[150px]`}>
            <option value="">All Statuses</option><option value="verified">Verified</option><option value="auto">Reconciled</option><option value="unchecked">Not checked</option><option value="pending">Pending approval</option>
          </select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={`${select} min-w-[170px]`}>
            <option value="new">Newest First</option><option value="old">Oldest First</option><option value="high">Highest Amount</option><option value="low">Lowest Amount</option>
          </select>
        </div>
        {!showAll && (
          <div className="bg-slate-50/60 px-4 py-3 dark:bg-slate-900">
            <DateWindowNav value={win} onChange={(next) => { setWin(next); setPage(1); }} todayKey={today} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn.outline} onClick={() => setAdvanced(true)}><SlidersHorizontal className="h-4 w-4" />Advanced Filters{advancedCount > 0 && <span className="rounded-full bg-[#2F6BFF] px-1.5 text-[11px] text-white">{advancedCount}</span>}</button>
        {chip("Category", f.category, (v) => setF({ ...f, category: v }), categories.map((c) => [c, labelOf(c)]))}
        {chip("Product", f.product, (v) => setF({ ...f, product: v }), ctx.products.map((x) => [x.id, x.name]))}
        {chip("Payment Source", f.source, (v) => setF({ ...f, source: v }), state.paymentSources.map((x) => [x, x]))}
        {chip("Agent/Staff", f.person, (v) => setF({ ...f, person: v }), people.map((x) => [x, x]))}
        {chip("State", f.state, (v) => setF({ ...f, state: v }), states.map((x) => [x, x]))}
        {(chipCount + advancedCount > 0 || f.search) && <button type="button" className={`${btn.link} !text-[13px]`} onClick={clear}><X className="h-4 w-4" />Clear Filters</button>}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13.5px] font-bold text-gray-800 dark:text-slate-200">Showing {filtered.length ? (at - 1) * perPage + 1 : 0} – {Math.min(at * perPage, filtered.length)} of {filtered.length} expenses
            {lines.length !== inPeriod.length + pendingIn(range.from, range.to) && <span className="ml-1 text-[12px] font-normal text-gray-500">(a product's waybill payments in one week show as one line)</span>}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {picked.size > 0 && (
              <>
                <span className="text-[12.5px] font-semibold text-gray-600">{picked.size} selected</span>
                {approver && <button type="button" disabled={busy} className={btn.outline} onClick={() => void verify(pickedIds)}><ShieldCheck className="h-4 w-4" />Mark verified</button>}
                <button type="button" className={btn.outline} onClick={() => exportRows(pickedRows)}><Download className="h-4 w-4" />Export selected</button>
              </>
            )}
            <div className="inline-flex rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
              <button type="button" aria-label="List view" onClick={() => setView("list")} className={`${btn.icon} ${view === "list" ? "!bg-blue-50 !text-[#2F6BFF]" : ""}`}><List className="h-4 w-4" /></button>
              <button type="button" aria-label="Grid view" onClick={() => setView("grid")} className={`${btn.icon} ${view === "grid" ? "!bg-blue-50 !text-[#2F6BFF]" : ""}`}><Grid2X2 className="h-4 w-4" /></button>
            </div>
            <div className="relative">
              <button type="button" className={btn.outline} onClick={() => setColsOpen(!colsOpen)}><Columns3 className="h-4 w-4" />Columns</button>
              {colsOpen && (
                <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {COLUMNS.map((c) => <label key={c} className="flex items-center gap-2 px-2 py-1 text-[13px] text-gray-800 dark:text-slate-200"><input type="checkbox" checked={cols.has(c)} disabled={c === "Amount"} onChange={() => { const n = new Set(cols); if (n.has(c)) n.delete(c); else n.add(c); setCols(n); }} />{c}</label>)}
                </div>
              )}
            </div>
          </div>
        </div>

        {shown.length === 0 ? <Empty>No expenses for these dates and filters.</Empty> : view === "grid" ? (
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((e) => { const x = facts(e); return (
              <li key={e.id}><button type="button" onClick={() => open(e)} className="!min-h-0 w-full rounded-xl border border-gray-200 p-3 text-left hover:border-[#2F6BFF]/50 dark:border-slate-700">
                <span className="flex items-start justify-between gap-2"><CategoryPill category={e.category} />{e.pendingRequestId ? <StatusPill status="pending" /> : <StatusPill status={e.checkStatus} />}</span>
                <b className="mt-2 block text-[18px] font-black text-gray-900 dark:text-slate-50">{ctx.money(e.amount)}</b>
                <span className="block truncate text-[13px] font-semibold text-gray-800 dark:text-slate-200">{e.productName || "—"}</span>
                <span className="block truncate text-[12px] text-gray-500">{e.description}</span>
                <span className="mt-2 flex items-center justify-between text-[11.5px] text-gray-500"><span>{dateTime(e)}</span><SourcePill source={e.pendingRequestId ? e.paidBy ?? "" : x.source} /></span>
              </button></li>
            ); })}
          </ul>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full !min-w-[980px]">
              <thead><tr className="border-b border-gray-100 dark:border-slate-800">
                <th className={`${th} w-8`}><input type="checkbox" aria-label="Select page" checked={shown.length > 0 && shown.every((e) => picked.has(e.id))} onChange={(ev) => { const n = new Set(picked); shown.forEach((e) => (ev.target.checked ? n.add(e.id) : n.delete(e.id))); setPicked(n); }} /></th>
                {COLUMNS.filter((c) => cols.has(c)).map((c) => <th key={c} className={`${th} ${c === "Amount" ? "!text-right" : ""}`}>{c}</th>)}
              </tr></thead>
              <tbody>{shown.map((e) => { const x = facts(e); return (
                <tr key={e.id} className="cursor-pointer border-b border-gray-50 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50" onClick={() => open(e)}>
                  <td className={td} onClick={(ev) => ev.stopPropagation()}><input type="checkbox" aria-label={`Select ${e.id}`} checked={picked.has(e.id)} disabled={Boolean(e.pendingRequestId)} onChange={() => { const n = new Set(picked); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); setPicked(n); }} /></td>
                  {cols.has("Date & Time") && <td className={`${td} whitespace-nowrap`}>{dateTime(e)}</td>}
                  {cols.has("Expense ID") && <td className={`${td} max-w-[160px] truncate font-mono text-[12px]`} title={e.id}>{e.id}</td>}
                  {cols.has("Category") && <td className={td}><CategoryPill category={e.category} /></td>}
                  {cols.has("Product / Reference") && <td className={td}>{e.productName || x.person || "—"}</td>}
                  {cols.has("Amount") && <td className={`${td} text-right font-bold`}>{ctx.money(e.amount)}</td>}
                  {cols.has("Payment Source") && <td className={td}><SourcePill source={e.pendingRequestId ? e.paidBy ?? "" : x.source} /></td>}
                  {cols.has("Description") && <td className={`${td} max-w-[340px]`}><span className="line-clamp-2">{e.description}{e.partIds ? ` (${ctx.money(e.amount)} – ${e.partIds.length} payments)` : ""}{x.order ? ` · ${x.order.agentName}${x.state ? `, ${x.state}` : ""}` : ""}</span></td>}
                  {cols.has("Status") && <td className={td}>{e.pendingRequestId ? <StatusPill status="pending" /> : <StatusPill status={e.checkStatus} />}</td>}
                </tr>
              ); })}</tbody>
            </table>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">Rows per page:
            <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} className="border-0 bg-transparent font-bold outline-none">{[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <div className="flex items-center gap-1">
            <span className="mr-2 text-[12.5px] text-gray-600">Showing {filtered.length ? (at - 1) * perPage + 1 : 0} – {Math.min(at * perPage, filtered.length)} of {filtered.length}</span>
            <button type="button" aria-label="Previous page" disabled={at <= 1} onClick={() => setPage(at - 1)} className={`${btn.outline} !h-9 !px-2`}><ChevronLeft className="h-4 w-4" /></button>
            {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - at) <= 2).map((n, i, arr) => (
              <span key={n} className="inline-flex items-center gap-1">{i > 0 && n - arr[i - 1] > 1 && <span className="px-1 text-gray-400">…</span>}
                <button type="button" onClick={() => setPage(n)} className={`!min-h-0 h-9 min-w-9 rounded-lg px-2 text-[13px] font-bold ${n === at ? "bg-[#2F6BFF] text-white" : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-200"}`}>{n}</button></span>
            ))}
            <button type="button" aria-label="Next page" disabled={at >= pages} onClick={() => setPage(at + 1)} className={`${btn.outline} !h-9 !px-2`}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </Card>

      {advanced && (
        <Modal title="Advanced Filters" onClose={() => setAdvanced(false)} footer={<><button type="button" className={btn.outline} onClick={() => setF({ ...f, min: "", max: "", receipt: "", person: "", state: "" })}>Reset</button><button type="button" className={btn.primary} onClick={() => { setPage(1); setAdvanced(false); }}>Apply</button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount from"><input inputMode="numeric" className={input} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} placeholder="0" /></Field>
            <Field label="Amount to"><input inputMode="numeric" className={input} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} placeholder="Any" /></Field>
            <Field label="Receipt"><select className={input} value={f.receipt} onChange={(e) => setF({ ...f, receipt: e.target.value })}><option value="">Any</option><option value="yes">Has receipt</option><option value="no">No receipt</option></select></Field>
            <Field label="Agent / staff"><select className={input} value={f.person} onChange={(e) => setF({ ...f, person: e.target.value })}><option value="">Any</option>{people.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="State"><select className={input} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Any</option>{states.map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
        </Modal>
      )}
      {importOpen && <ImportModal p={p} onClose={() => setImportOpen(false)} />}
      {requestOpen && <RequestForm p={p} onClose={() => setRequestOpen(false)} />}
      {drawer && <ExpenseDrawer ctx={ctx} row={drawer} onClose={() => setDrawer(null)} onChanged={() => { ctx.refresh(); setDrawer(null); }} />}
    </div>
  );
}

function ImportModal({ p, onClose }: { p: TabProps; onClose: () => void }) {
  const [text, setText] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true); setProblems([]);
    try {
      const r = await expenseIntelApi.importCsv(text);
      p.ctx.toast(`${r.imported} expenses imported (${p.ctx.money(r.total)}).`); p.ctx.refresh(); onClose();
    } catch (e: any) {
      setProblems(String(e?.message ?? "Could not import.").split(" · "));
    } finally { setBusy(false); }
  };
  return (
    <Modal wide title="Import Expenses" sub="One line per expense: date, category, amount, description, product (optional), paid by (optional)." onClose={onClose}
      footer={<><button type="button" className={btn.outline} onClick={() => downloadCsv("expense-import-template.csv", [["date", "category", "amount", "description", "product", "paid by"], ["2026-11-14", "Airtime & Data", "5000", "Team data bundle", "", "Company"]])}><Download className="h-4 w-4" />Template</button><button type="button" disabled={busy || !text.trim()} className={btn.primary} onClick={() => void send()}>{busy ? "Importing…" : "Import"}</button></>}>
      <label className={`${btn.outline} mb-3 cursor-pointer`}><Upload className="h-4 w-4" />Choose CSV file
        <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then(setText); e.target.value = ""; }} />
      </label>
      <textarea className={`${input} !h-48 py-2 font-mono text-[12px]`} value={text} onChange={(e) => setText(e.target.value)} placeholder={"date,category,amount,description,product,paid by\n2026-11-14,Waybill,63700,Shelf to Abuja,Multi Corner Storage Shelf,Company"} />
      <p className="m-0 mt-2 text-[12px] text-gray-500">Nothing is saved if any line has a problem. Dates as YYYY-MM-DD or DD/MM/YYYY. Products spelled as in Products &amp; Stock. Imported lines count as verified.</p>
      {problems.length > 0 && <ul className="m-0 mt-2 list-disc space-y-0.5 rounded-lg bg-rose-50 py-2 pl-7 pr-3 text-[12.5px] text-rose-800">{problems.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </Modal>
  );
}
