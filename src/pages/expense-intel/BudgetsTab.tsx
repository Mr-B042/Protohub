import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Copy, Download, Gauge, Layers, Pencil, Plus, Search, ShieldCheck, SlidersHorizontal, Target, Trash2, Wallet } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { expenseIntelApi } from "../../lib/api";
import type { TabProps } from "./context";
import { BUDGET_COGS, BUDGET_LOGISTICS, addMonths, budgetRows, budgetsFor, labelOf, lastMonths, logisticsTotals, monthEnd, monthLabel, monthStart, sum, type BudgetRow } from "./model";
import { spentFor, useMonthData } from "./data";
import { departmentOf } from "./BreakdownTab";
import { Bar, C, Card, Donut, Empty, Field, Kpi, Modal, Pill, SERIES, btn, delta, downloadCsv, input, select, td, th } from "./ui";

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
const STATUS_TONE: Record<BudgetRow["status"], "green" | "amber" | "red"> = { "On Track": "green", "At Risk": "amber", "Over Budget": "red" };
const label = (c: string) => (c === BUDGET_COGS || c === BUDGET_LOGISTICS ? c : labelOf(c));

export default function BudgetsTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period, state } = p;
  const money = ctx.money;
  const d = useMonthData(p);
  const [q, setQ] = useState({ search: "", status: "", dept: "" });
  const [edit, setEdit] = useState<null | { category?: string }>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rows = d.budgets;
  const totalBudget = sum(rows, (r) => r.budget), totalSpent = sum(rows, (r) => r.spent);
  const cRows = useMemo(() => {
    const s = d.before;
    const log = d.clog;
    return budgetRows(period.compare, state.budgets, (c) => spentFor(c, d.cexp, s.cogs, s.recognizedLogistics + log.failedCost));
  }, [d, period.compare, state.budgets]);
  const cBudget = sum(cRows, (r) => r.budget), cSpent = sum(cRows, (r) => r.spent);
  const util = totalBudget ? (totalSpent / totalBudget) * 100 : null, cutil = cBudget ? (cSpent / cBudget) * 100 : null;
  const trend = useMemo(() => lastMonths(period.month, 6).map((m) => {
    const from = monthStart(m), to = monthEnd(m);
    const rowsM = p.expensesIn(from, to); const s = ctx.profit(from, to); const log = logisticsTotals(ctx.orders, rowsM, from, to);
    const br = budgetRows(m, state.budgets, (c) => spentFor(c, rowsM, s.cogs, s.recognizedLogistics + log.failedCost));
    return { name: monthLabel(m, true), budget: Math.round(sum(br, (r) => r.budget)), spent: Math.round(sum(br, (r) => r.spent)) };
  }), [ctx, p, period.month, state.budgets]);
  const listed = rows.filter((r) => (!q.search.trim() || label(r.category).toLowerCase().includes(q.search.trim().toLowerCase())) && (!q.status || r.status === q.status)
    && (!q.dept || departmentOf(r.category === BUDGET_COGS ? "COGS" : r.category === BUDGET_LOGISTICS ? "Delivery" : r.category, state.settings.departments) === q.dept));
  const steps = state.settings.budgetAlertSteps;
  const alerts = rows.flatMap((r) => {
    if (r.usage === null) return [];
    if (r.status === "Over Budget" && r.usage > 100) return [{ tone: "red", text: `${label(r.category)} is ${r.usage.toFixed(1)}% of budget (${money(-r.remaining)} over).` }];
    if (r.usage >= 100) return [{ tone: "amber", text: `${label(r.category)} has reached 100% of its budget.` }];
    const crossed = steps.filter((s2) => s2 < 100 && r.usage! >= s2).pop();
    if (crossed && crossed >= 75) return [{ tone: "amber", text: `${label(r.category)} is at ${r.usage.toFixed(1)}% (past the ${crossed}% step).` }];
    return [{ tone: "green", text: `${label(r.category)} is on track at ${r.usage.toFixed(1)}%.` }];
  }).sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "red" ? -1 : b.tone === "red" ? 1 : a.tone === "amber" ? -1 : 1));

  const copyLast = async () => {
    const last = budgetsFor(addMonths(period.month, -1), state.budgets);
    if (!last.length) { ctx.toast("Last month has no budgets to copy."); return; }
    setBusy(true);
    try { await expenseIntelApi.saveBudgets(period.month, last.map((b) => ({ category: b.category, amount: b.amount, recurring: b.recurring }))); ctx.toast(`${last.length} budgets copied from ${monthLabel(addMonths(period.month, -1))}.`); p.reload(); }
    catch (e: any) { ctx.toast(e?.message ?? "Could not copy."); } finally { setBusy(false); }
  };
  const remove = async (category: string) => {
    if (!window.confirm(`Remove the ${label(category)} budget for ${monthLabel(period.month)}?`)) return;
    try { await expenseIntelApi.saveBudgets(period.month, [], [category]); ctx.toast("Budget removed."); p.reload(); } catch (e: any) { ctx.toast(e?.message ?? "Could not remove."); }
  };
  const exportCsv = () => downloadCsv(`budgets-${period.month}.csv`, [["Category", "Budget", "Spent", "Remaining", "Utilization %", "Status", "Repeats monthly"], ...rows.map((r) => [label(r.category), r.budget, Math.round(r.spent), Math.round(r.remaining), r.usage?.toFixed(1), r.status, r.recurring ? "Yes" : "No"])]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Budgets &amp; Limits</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Set spending budgets, track how much is used and get alerts before overspending.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={btn.outline} onClick={() => void copyLast()}><Copy className="h-4 w-4" />Budget Templates</button>
          <button type="button" className={btn.outline} onClick={exportCsv}><Download className="h-4 w-4" />Export</button>
          <button type="button" className={btn.primary} onClick={() => setEdit({})}><Plus className="h-4 w-4" />Create Budget</button>
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Layers} tone={C.blue} label="Total Budget" value={money(totalBudget)} spark={trend.map((x) => x.budget)} d={delta(totalBudget, cBudget, { label: period.cLabel, beforeText: money(cBudget) })} />
        <Kpi icon={Wallet} tone={C.orange} label="Total Spent" value={money(totalSpent)} spark={trend.map((x) => x.spent)} d={delta(totalSpent, cSpent, { lowerIsBetter: true, label: period.cLabel, beforeText: money(cSpent) })} />
        <Kpi icon={Gauge} tone={C.green} label="Budget Utilization" value={util === null ? "—" : `${util.toFixed(1)}%`} d={delta(util, cutil, { points: true, lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={ShieldCheck} tone={C.green} label="Within Budget" value={`${rows.filter((r) => r.status !== "Over Budget").length} categories`} />
        <Kpi icon={AlertTriangle} tone={C.red} label="Over Budget" value={`${rows.filter((r) => r.status === "Over Budget").length} categories`} />
      </div>

      {rows.length === 0 ? (
        <Card><Empty>No budgets for {monthLabel(period.month)} yet. <button type="button" className={btn.link} onClick={() => setEdit({})}>Create budgets</button> or <button type="button" className={btn.link} onClick={() => void copyLast()}>copy last month's</button>.</Empty></Card>
      ) : (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Card title="Budget Utilization by Category">
            <div className="flex flex-col items-stretch gap-4 min-[1700px]:flex-row min-[1700px]:items-center">
              <Donut data={rows.map((r, i) => ({ name: label(r.category), value: r.spent, color: SERIES[i % SERIES.length] }))} center={money(totalSpent)} sub={util === null ? "Total spent" : `${util.toFixed(1)}% of budget`} size={200} />
              <table className="!min-w-0 w-full">
                <thead><tr><th className={th}>Category</th><th className={`${th} !text-right`}>Budget</th><th className={`${th} !text-right`}>Spent</th><th className={`${th} !text-right`}>Utilization</th></tr></thead>
                <tbody>{rows.map((r, i) => <tr key={r.category}><td className={`${td} !py-1.5`}><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: SERIES[i % SERIES.length] }} />{label(r.category)}</span></td><td className={`${td} !py-1.5 text-right`}>{money(r.budget)}</td><td className={`${td} !py-1.5 text-right font-semibold`}>{money(r.spent)}</td><td className={`${td} !py-1.5 text-right`}><Pill tone={STATUS_TONE[r.status]}>{r.usage === null ? "—" : `${r.usage.toFixed(1)}%`}</Pill></td></tr>)}</tbody>
              </table>
            </div>
          </Card>
          <Card title="Budget vs Actual Trend" sub="Last 6 months">
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#eef2f7" vertical={false} />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={56} />
                  <Tooltip formatter={(v: number, k) => [money(v), k === "budget" ? "Budget" : "Actual Spend"]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} formatter={(v) => (v === "budget" ? "Budget" : "Actual Spend")} />
                  <Area dataKey="budget" stroke={C.blue} fill={C.blue} fillOpacity={0.1} strokeWidth={2} dot={{ r: 3 }} />
                  <Area dataKey="spent" stroke={C.purple} fill={C.purple} fillOpacity={0.15} strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="m-0 text-[11.5px] text-gray-500">Actual spend counts only the categories that had a budget that month.</p>
          </Card>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card title="Budget Details" action={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-gray-400" /><input className={`${input} !pl-9 w-[200px]`} placeholder="Search category or budget…" value={q.search} onChange={(e) => setQ({ ...q, search: e.target.value })} /></label>
            <select className={select} value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value })}><option value="">All Status</option><option>On Track</option><option>At Risk</option><option>Over Budget</option></select>
            <select className={select} value={q.dept} onChange={(e) => setQ({ ...q, dept: e.target.value })}><option value="">All Departments</option>{state.departmentsList.map((x) => <option key={x}>{x}</option>)}</select>
          </div>
        }>
          {listed.length === 0 ? <Empty>No budgets match.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full !min-w-[760px]">
              <thead><tr className="border-b border-gray-100 dark:border-slate-800">{["Category", "Budget", "Spent", "Remaining", "Utilization", "Status", "Actions"].map((h) => <th key={h} className={`${th} ${["Budget", "Spent", "Remaining"].includes(h) ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>
                {listed.map((r) => (
                  <tr key={r.category} className="border-b border-gray-50 dark:border-slate-800">
                    <td className={`${td} font-semibold`}>{label(r.category)}{r.recurring && <span className="ml-1.5 text-[11px] font-normal text-gray-500">repeats{r.carried ? " (carried)" : ""}</span>}</td>
                    <td className={`${td} text-right`}>{money(r.budget)}</td><td className={`${td} text-right font-semibold`}>{money(r.spent)}</td>
                    <td className={`${td} text-right ${r.remaining < 0 ? "!text-rose-600 font-bold" : ""}`}>{money(r.remaining)}</td>
                    <td className={td}><span className="flex items-center gap-2"><span className="w-12 shrink-0 text-[12px]">{r.usage === null ? "—" : `${r.usage.toFixed(1)}%`}</span><Bar value={r.spent} max={r.budget} color={r.status === "Over Budget" ? C.red : r.status === "At Risk" ? C.orange : C.green} /></span></td>
                    <td className={td}><Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill></td>
                    <td className={td}><span className="flex gap-1"><button type="button" aria-label="Adjust" className={btn.icon} onClick={() => setEdit({ category: r.category })}><Pencil className="h-4 w-4" /></button><button type="button" aria-label="Remove" className={btn.icon} onClick={() => void remove(r.category)}><Trash2 className="h-4 w-4" /></button></span></td>
                  </tr>
                ))}
                <tr className="bg-gray-50 dark:bg-slate-800/60"><td className={`${td} font-black`}>Total</td><td className={`${td} text-right font-black`}>{money(totalBudget)}</td><td className={`${td} text-right font-black`}>{money(totalSpent)}</td><td className={`${td} text-right font-black`}>{money(totalBudget - totalSpent)}</td><td className={td}><span className="flex items-center gap-2"><span className="w-12 shrink-0 text-[12px] font-bold">{util === null ? "—" : `${util.toFixed(1)}%`}</span><Bar value={totalSpent} max={totalBudget} color={C.green} /></span></td><td className={td} /><td className={td} /></tr>
              </tbody>
            </table></div>
          )}
        </Card>
        <div className="space-y-3">
          <Card title="Budget Alerts & Insights">
            {alerts.length === 0 ? <Empty>Set budgets to get alerts.</Empty> : <ul className="m-0 list-none space-y-2 p-0">{alerts.slice(0, 6).map((a, i) => <li key={i} className="flex items-start gap-2 text-[12.5px] text-gray-800 dark:text-slate-200">{a.tone === "green" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.tone === "red" ? "text-rose-600" : "text-amber-500"}`} />}{a.text}</li>)}</ul>}
          </Card>
          <Card title="Budget Actions">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { I: Target, t: "Create Budget", s: "Set a new budget for a category", on: () => setEdit({}) },
                { I: SlidersHorizontal, t: "Adjust Limit", s: "Increase or reduce a budget", on: () => setEdit({ category: rows[0]?.category }) },
                { I: CalendarClock, t: "Recurring Budget", s: "Repeat a budget every month", on: () => setEdit({}) },
                { I: Gauge, t: "Budget Rules", s: "When to warn (50%, 75%, 90%…)", on: () => setRulesOpen(true) }
              ].map((a) => (
                <button key={a.t} type="button" onClick={a.on} className="!min-h-0 flex items-start gap-2.5 rounded-xl border border-gray-200 p-3 text-left hover:border-[#2F6BFF]/50 dark:border-slate-700">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#2F6BFF] dark:bg-blue-500/10"><a.I className="h-4 w-4" /></span>
                  <span><b className="block text-[13px] text-gray-900 dark:text-slate-50">{a.t}</b><span className="block text-[11.5px] text-gray-500">{a.s}</span></span>
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {edit && <BudgetEditor p={p} start={edit.category} onClose={() => setEdit(null)} />}
      {rulesOpen && <RulesModal p={p} onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

function BudgetEditor({ p, start, onClose }: { p: TabProps; start?: string; onClose: () => void }) {
  const { ctx, period, state } = p;
  const current = budgetsFor(period.month, state.budgets);
  const categories = [...new Set([BUDGET_COGS, BUDGET_LOGISTICS, "Ad Spend", "Waybill", "Salary", "Bonuses & Incentives", "Clearing & Shipping", "Airtime & Data", "Other", ...ctx.expenses.map((e) => e.category).filter((c) => c !== "Delivery" && c !== "Failed Delivery"), ...current.map((b) => b.category)])];
  const [rows, setRows] = useState(() => categories.map((c) => { const b = current.find((x) => x.category === c); return { category: c, amount: b ? String(b.amount) : "", recurring: b?.recurring ?? false, focus: c === start }; }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const items = rows.filter((r) => r.amount.trim() !== "").map((r) => ({ category: r.category, amount: Number(r.amount.replace(/[,₦\s]/g, "")), recurring: r.recurring }));
    if (items.some((i) => !(i.amount >= 0))) { ctx.toast("Amounts must be numbers."); return; }
    const remove = rows.filter((r) => r.amount.trim() === "" && state.budgets.some((b) => b.month === period.month && b.category === r.category)).map((r) => r.category);
    setBusy(true);
    try { await expenseIntelApi.saveBudgets(period.month, items, remove); ctx.toast(`Budgets for ${monthLabel(period.month)} saved.`); p.reload(); onClose(); }
    catch (e: any) { ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={`Budgets for ${monthLabel(period.month)}`} sub="Leave a box empty for no budget. Tick 'Repeat' to carry it into the next months until you change it." onClose={onClose}
      footer={<><button type="button" className={btn.outline} onClick={onClose}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={() => void save()}>Save budgets</button></>}>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.category} className={`grid grid-cols-[minmax(0,1fr)_160px_auto] items-center gap-2 rounded-lg px-2 py-1 ${r.focus ? "bg-blue-50 dark:bg-blue-500/10" : ""}`}>
            <span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">{label(r.category)}</span>
            <input inputMode="numeric" autoFocus={r.focus} className={input} value={r.amount} placeholder="No budget" onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, amount: e.target.value } : x)))} />
            <label className="flex items-center gap-1.5 text-[12.5px] text-gray-700 dark:text-slate-300"><input type="checkbox" checked={r.recurring} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, recurring: e.target.checked } : x)))} />Repeat</label>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function RulesModal({ p, onClose }: { p: TabProps; onClose: () => void }) {
  const [text, setText] = useState(p.state.settings.budgetAlertSteps.join(", "));
  const [busy, setBusy] = useState(false);
  const owner = p.ctx.role === "Owner";
  const save = async () => {
    const steps = text.split(/[,\s]+/).map((x) => Number(x.replace("%", ""))).filter((n) => n > 0);
    if (!steps.length || steps.some((n) => !Number.isInteger(n) || n > 200)) { p.ctx.toast("Type whole percentages, e.g. 50, 75, 90, 100."); return; }
    setBusy(true);
    try { await expenseIntelApi.saveSettings({ budgetAlertSteps: steps }); p.ctx.toast("Budget rules saved."); p.reload(); onClose(); }
    catch (e: any) { p.ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  return (
    <Modal title="Budget Rules" sub="When a category's spending passes one of these steps, it shows on this page and in Smart Cost Alerts." onClose={onClose}
      footer={owner ? <><button type="button" className={btn.outline} onClick={onClose}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={() => void save()}>Save</button></> : undefined}>
      <Field label="Warning steps (% of budget)" hint="50% informational · 75% notice · 90% warning · 100% exceeded. Over 100% is always flagged."><input className={input} value={text} disabled={!owner} onChange={(e) => setText(e.target.value)} /></Field>
      {!owner && <p className="m-0 mt-2 text-[12px] text-gray-500">Only the Owner can change these.</p>}
    </Modal>
  );
}
