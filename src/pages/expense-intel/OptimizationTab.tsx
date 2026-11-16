import { useMemo, useState, type ReactNode } from "react";
import { BadgeDollarSign, Boxes, CheckCircle2, ChevronRight, ClipboardList, Cpu, Download, Megaphone, Pencil, Plus, Settings2, Tag, Target, Trash2, TrendingUp, Truck, Zap } from "lucide-react";
import { Bar as ChartBar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { expenseIntelApi, type EiPlan } from "../../lib/api";
import type { TabProps } from "./context";
import { adTotals, forecast, inRange, lastMonths, logisticsTotals, monthEnd, monthLabel, monthStart, opportunities, slowStock, sum, addMonths, type Opportunity } from "./model";
import { useAlerts, useMonthData } from "./data";
import { AlertRow, AlertsModal } from "./alerts";
import { C, Card, Empty, Field, Kpi, Modal, Pill, btn, delta, downloadCsv, input, td, th } from "./ui";

const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));
const PLAN_STATUS: Record<EiPlan["status"], { l: string; tone: "green" | "amber" | "grey" | "blue" }> = {
  in_progress: { l: "In Progress", tone: "green" }, pending: { l: "Pending", tone: "amber" }, not_started: { l: "Not Started", tone: "grey" }, approved: { l: "Approved", tone: "blue" }, done: { l: "Done", tone: "green" }
};
const KIND: Record<Opportunity["kind"], { I: typeof Megaphone; c: string; dept: string }> = {
  ads: { I: Megaphone, c: C.purple, dept: "Marketing & Growth" }, delivery: { I: Truck, c: C.blue, dept: "Operations & Fulfillment" },
  waybill: { I: Tag, c: C.pink, dept: "Operations & Fulfillment" }, stock: { I: Boxes, c: C.pink, dept: "Inventory & Procurement" }
};
const initials = (s: string) => s.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export default function OptimizationTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period, state } = p;
  const money = ctx.money;
  const d = useMonthData(p);
  const alerts = useAlerts(p, d);
  const [planEdit, setPlanEdit] = useState<Partial<EiPlan> | null>(null);
  const [alertsOpen, setAlertsOpen] = useState<string | null | false>(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [view, setView] = useState<"cost" | "savings" | "forecast">("cost");

  const opps = useMemo(() => {
    const past = lastMonths(addMonths(period.month, -1), 6);
    const stats = past.map((m) => { const from = monthStart(m), to = monthEnd(m); return { a: adTotals(ctx.orders, p.expensesIn(from, to), from, to), l: logisticsTotals(ctx.orders, p.expensesIn(from, to), from, to), from, to }; });
    const rateOf = (from: string, to: string) => { const placed = ctx.orders.filter((o) => inRange(o.createdKey, from, to)); return placed.length >= 30 ? (placed.filter((o) => o.status === "Delivered").length / placed.length) * 100 : null; };
    const now = adTotals(ctx.orders, d.exp, period.from, period.to);
    const failedFee = d.log.failedCount ? d.log.failedOrders / d.log.failedCount : 0;
    return opportunities({
      month: period.month, money,
      // Only months whose ad spend was booked on 20+ days: a month with spend missing would set a false target.
      cppByMonth: stats.map((s) => (s.a.placed >= 30 && new Set(p.expensesIn(s.from, s.to).filter((e) => e.category === "Ad Spend").map((e) => e.date)).size >= 20 ? s.a.cpp : null)), placedNow: now.placed, cppNow: now.cpp,
      rateByMonth: stats.map((s) => rateOf(s.from, s.to)), rateNow: rateOf(period.from, period.to),
      // A failed order loses the ad money spent to get it plus any fee the agent charged.
      failedCostPerFail: (now.cpp ?? 0) + failedFee || null,
      waybillByMonth: stats.slice(-3).map((s) => s.l.waybill), waybillNow: d.log.waybill,
      slowStock: slowStock(ctx.products, ctx.orders, ctx.today)
    });
  }, [ctx, p, period, d, money]);

  const identified = sum(opps, (o) => o.savings);
  const plans = state.plans;
  const inReview = plans.filter((x) => x.status === "pending" || x.status === "in_progress");
  const approved = plans.filter((x) => x.status === "approved" || x.status === "in_progress" || x.status === "done");
  const realizedIn = (from: string, to: string) => sum(plans.filter((x) => x.realizedSavings > 0 && inRange(x.updatedAt.slice(0, 10), from, to)), (x) => x.realizedSavings);
  const realizedNow = realizedIn(period.from, period.to), realizedBefore = realizedIn(period.cFrom, period.cTo);
  const series = d.months.map((m) => ({ name: monthLabel(m.m, true), cost: Math.round(m.business), savings: Math.round(realizedIn(m.from, m.to)) }));
  const fc = forecast(d.months.map((m) => m.business), 3);
  const forecastSeries = [...series.map((s) => ({ name: s.name, cost: s.cost, forecast: null as number | null })), ...fc.map((v, i) => ({ name: `${monthLabel(addMonths(period.month, i + 1), true)} (F)`, cost: null as number | null, forecast: v === null ? null : Math.round(v) }))];

  const exportCsv = () => downloadCsv(`cost-optimization-${period.month}.csv`, [
    ["Opportunity", "Current", "Target", "Potential savings"], ...opps.map((o) => [o.title, o.current, o.target, Math.round(o.savings)]), [],
    ["Action item", "Target", "Expected savings", "Realized savings", "Owner", "Due", "Status"], ...plans.map((x) => [x.title, x.target, x.expectedSavings, x.realizedSavings, x.ownerName ?? x.ownerDepartment, x.dueDate ?? "", PLAN_STATUS[x.status].l])
  ]);
  const setStatus = async (x: EiPlan, status: EiPlan["status"]) => { try { await expenseIntelApi.updatePlan(x.id, { status }); p.reload(); } catch (e: any) { ctx.toast(e?.message ?? "Could not save."); } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-[22px] font-black text-gray-900 dark:text-slate-50">Cost Optimization <Pill tone="purple" icon={Zap}>Automatic checks</Pill></h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Where Protohub can save money, worked out from this branch's own best months, and the plans to get there.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.outline} onClick={() => setRulesOpen(true)}><Settings2 className="h-4 w-4" />Optimization Rules</button>
          <button type="button" className={btn.outline} onClick={exportCsv}><Download className="h-4 w-4" />Export</button>
          <button type="button" className={btn.primary} onClick={() => setPlanEdit({ status: "not_started" })}><Plus className="h-4 w-4" />New Optimization Plan</button>
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={ClipboardList} tone={C.blue} label="Total Cost" value={money(d.business)} spark={d.months.map((m) => m.business)} d={delta(d.business, d.cbusiness, { lowerIsBetter: true, label: period.cLabel, beforeText: money(d.cbusiness) })} />
        <Kpi icon={Zap} tone={C.orange} label="Optimization Opportunities" value={String(opps.length)} sub={`≈ ${money(identified)} potential savings`} />
        <Kpi icon={Target} tone={C.green} label="Estimated Savings" value={money(identified)} sub={d.business ? `${((identified / d.business) * 100).toFixed(1)}% of total cost` : ""} />
        <Kpi icon={CheckCircle2} tone={C.green} label="Approved Savings" value={money(sum(approved, (x) => x.expectedSavings))} sub={identified ? `${Math.round((sum(approved, (x) => x.expectedSavings) / identified) * 100)}% of potential savings` : "From approved plans"} />
        <Kpi icon={TrendingUp} tone={C.purple} label="Actual Savings (This Month)" value={money(realizedNow)} spark={series.map((s) => s.savings)} d={delta(realizedNow, realizedBefore, { label: period.cLabel, beforeText: money(realizedBefore) })} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2 min-[1700px]:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
        <Card title={<span className="flex items-center gap-2"><Cpu className="h-5 w-5 text-[#2F6BFF]" />Cost-Saving Recommendations</span>}>
          {opps.length === 0 ? <Empty>No savings found this month: costs are at or below this branch's best months.</Empty> : (
            <ul className="m-0 list-none space-y-2 p-0">{opps.map((o) => { const K = KIND[o.kind]; return (
              <li key={o.key}><button type="button" onClick={() => setPlanEdit({ title: o.title, target: o.target, expectedSavings: Math.round(o.savings), ownerDepartment: K.dept, status: "not_started", sourceKey: o.key })}
                className="!min-h-0 flex w-full items-center gap-3 rounded-xl bg-gray-50 p-3 text-left hover:bg-blue-50/60 dark:bg-slate-800/60">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${K.c}1A`, color: K.c }}><K.I className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1"><b className="block text-[13.5px] text-gray-900 dark:text-slate-50">{o.title}</b><span className="block text-[12px] text-gray-600 dark:text-slate-300">Current: {o.current} → Target: {o.target}</span></span>
                <span className="shrink-0 rounded-lg bg-emerald-50 px-2.5 py-1 text-right dark:bg-emerald-500/10"><span className="block text-[10.5px] font-semibold text-emerald-700">{o.kind === "stock" ? "Cash tied up" : o.kind === "delivery" ? "Money saved" : "Potential Savings"}</span><b className="block text-[15px] text-emerald-700">{money(o.savings)}</b></span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
              </button></li>
            ); })}</ul>
          )}
          <p className="m-0 mt-2 text-[11.5px] text-gray-500">Click one to turn it into a plan with an owner and a due date.</p>
        </Card>

        <Card title="Savings Opportunity Pipeline">
          <div className="flex flex-col items-center gap-1.5 py-1">
            {[
              { l: "Identified", v: identified, n: opps.length, w: "100%", c: "#2F6BFF" }, { l: "In Review", v: sum(inReview, (x) => x.expectedSavings), n: inReview.length, w: "86%", c: "#38A1F6" },
              { l: "Approved", v: sum(approved, (x) => x.expectedSavings), n: approved.length, w: "72%", c: "#22B8A7" }, { l: "Realized", v: sum(plans, (x) => x.realizedSavings), n: plans.filter((x) => x.realizedSavings > 0).length, w: "58%", c: "#16A34A" }
            ].map((s) => (
              <div key={s.l} className="flex flex-col items-center justify-center rounded-xl py-2.5 text-white" style={{ width: s.w, background: s.c, clipPath: "polygon(0 0,100% 0,94% 100%,6% 100%)" }}>
                <span className="text-[12px] font-semibold opacity-90">{s.l}</span><b className="text-[15px]">{money(s.v)} <span className="text-[12px] font-semibold opacity-90">({s.n})</span></b>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Cost Leak Detections" action={alerts.open.length > 0 ? <Pill tone="red">{alerts.open.length} Issue{alerts.open.length === 1 ? "" : "s"}</Pill> : undefined}>
          {alerts.open.length === 0 ? <Empty>No leaks found this month.</Empty> : <div className="space-y-2">{alerts.open.slice(0, 5).map((a) => <AlertRow key={a.key} a={a} assigned={alerts.actionOf(a.key)?.assignedToName} onOpen={() => setAlertsOpen(a.key)} />)}</div>}
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title={<span className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-[#2F6BFF]" />Optimization Action Plan</span>}>
          {plans.length === 0 ? <Empty>No plans yet. Pick a recommendation or press New Optimization Plan.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full !min-w-[720px]">
              <thead><tr className="border-b border-gray-100 dark:border-slate-800"><th className={`${th} w-8`} />{["Action Item", "Target", "Expected Savings", "Owner", "Due Date", "Status", ""].map((h) => <th key={h} className={`${th} ${h === "Expected Savings" ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>{plans.map((x) => (
                <tr key={x.id} className="border-b border-gray-50 dark:border-slate-800">
                  <td className={td}><input type="checkbox" aria-label="Done" checked={x.status === "done"} onChange={() => void setStatus(x, x.status === "done" ? "in_progress" : "done")} /></td>
                  <td className={`${td} font-semibold ${x.status === "done" ? "line-through opacity-70" : ""}`}>{x.title}</td>
                  <td className={td}>{x.target || "—"}</td>
                  <td className={`${td} text-right font-bold`}>{money(x.expectedSavings)}{x.realizedSavings > 0 && <span className="block text-[11px] font-semibold text-emerald-600">saved {money(x.realizedSavings)}</span>}</td>
                  <td className={td}><span className="inline-flex items-center gap-1.5"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-100 text-[10px] font-black text-violet-700">{initials(x.ownerName ?? x.ownerDepartment ?? "?")}</span>{x.ownerName ?? (x.ownerDepartment || "—")}</span></td>
                  <td className={`${td} whitespace-nowrap`}>{x.dueDate ? new Date(`${x.dueDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—"}</td>
                  <td className={td}><Pill tone={PLAN_STATUS[x.status].tone}>{PLAN_STATUS[x.status].l}</Pill></td>
                  <td className={td}><span className="flex gap-1"><button type="button" aria-label="Edit" className={btn.icon} onClick={() => setPlanEdit(x)}><Pencil className="h-4 w-4" /></button><button type="button" aria-label="Delete" className={btn.icon} onClick={() => { if (window.confirm(`Delete "${x.title}"?`)) void expenseIntelApi.deletePlan(x.id).then(p.reload).catch((e: any) => ctx.toast(e?.message ?? "Could not delete.")); }}><Trash2 className="h-4 w-4" /></button></span></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        <Card title={<span className="flex items-center gap-2"><BadgeDollarSign className="h-5 w-5 text-[#2F6BFF]" />Cost Optimization Impact</span>} action={
          <div className="inline-flex rounded-full border border-gray-200 p-0.5 dark:border-slate-700">
            {(["cost", "savings", "forecast"] as const).map((k) => <button key={k} type="button" onClick={() => setView(k)} className={`!min-h-0 rounded-full px-3 py-1 text-[12px] font-bold ${view === k ? "bg-blue-50 text-[#2F6BFF]" : "text-gray-600"}`}>{k === "cost" ? "Cost Trend" : k === "savings" ? "Savings Trend" : "Forecast"}</button>)}
          </div>
        }>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={view === "forecast" ? forecastSeries : series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis yAxisId="c" tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={52} />
                {view !== "forecast" && <YAxis yAxisId="s" orientation="right" tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={48} />}
                <Tooltip formatter={(v: number, k) => [money(v), k === "cost" ? "Total Cost" : k === "forecast" ? "Forecast" : "Actual Savings"]} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="bottom" height={24} formatter={(v) => (v === "cost" ? "Total Cost" : v === "forecast" ? "Forecast" : "Actual Savings")} />
                {view !== "savings" && <ChartBar yAxisId="c" dataKey="cost" fill="#BFD3FF" radius={[6, 6, 0, 0]} barSize={30} />}
                {view === "forecast" && <ChartBar yAxisId="c" dataKey="forecast" fill="#DDD6FE" radius={[6, 6, 0, 0]} barSize={30} />}
                {view !== "forecast" && <Line yAxisId={view === "savings" ? "c" : "s"} dataKey="savings" stroke={C.green} strokeWidth={2} dot={{ r: 4 }} />}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {view === "forecast" && <p className="m-0 text-[11.5px] text-gray-500">Forecast = straight line through the last 6 months. A guide, not a promise.</p>}
          {view !== "forecast" && <p className="m-0 text-[11.5px] text-gray-500">Actual savings = what plan owners typed as saved, by the month they updated it.</p>}
        </Card>
      </div>

      {planEdit && <PlanModal p={p} plan={planEdit} onClose={() => setPlanEdit(null)} />}
      {alertsOpen !== false && <AlertsModal p={p} open={alerts.open} closed={alerts.closed} actionOf={alerts.actionOf} startKey={alertsOpen} onClose={() => setAlertsOpen(false)} />}
      {rulesOpen && (
        <Modal title="Optimization Rules" sub="How each saving is worked out. Nothing here is a guess from outside: every target is this branch's own best month." onClose={() => setRulesOpen(false)}>
          <ul className="m-0 list-disc space-y-2 pl-5 text-[13px] text-gray-800 dark:text-slate-200">
            <li><b>Reduce Advertising CPP</b>: this month's ad cost per placed order vs the lowest of the last 6 months (months with 30+ orders and ad spend booked on 20+ days). Saving = the difference × this month's orders.</li>
            <li><b>Improve Delivery Rate</b>: this month's delivery rate vs the best of the last 6 months. Saving = the failed orders that would be delivered × (ad cost per order + the average failed-delivery fee).</li>
            <li><b>Optimize Waybill Costs</b>: this month's waybill vs the 3-month average, when 5%+ above it.</li>
            <li><b>Review Slow-Moving Inventory</b>: stock beyond 60 days of sales (last 30 days' delivered units), valued at cost: cash tied up in stock.</li>
            <li><b>Cost leaks</b>: the same checks as Smart Cost Alerts (ad spend vs deliveries, failed-delivery share over 10%, waybill up 15%+, incentives growing faster than profit, over-budget categories, same-amount expenses on the same day, a state's delivery cost up ₦1,000+).</li>
          </ul>
        </Modal>
      )}
    </div>
  );
}

function PlanModal({ p, plan, onClose }: { p: TabProps; plan: Partial<EiPlan>; onClose: () => void }) {
  const [d, setD] = useState({
    title: plan.title ?? "", target: plan.target ?? "", expectedSavings: String(plan.expectedSavings ?? ""), realizedSavings: String(plan.realizedSavings ?? ""),
    ownerDepartment: plan.ownerDepartment ?? "", ownerUser: plan.ownerUser ?? "", dueDate: plan.dueDate ?? "", status: plan.status ?? "not_started"
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (d.title.trim().length < 2) { p.ctx.toast("Give the plan a name."); return; }
    const body = {
      title: d.title.trim(), target: d.target.trim(), expectedSavings: Number(d.expectedSavings.replace(/[,₦\s]/g, "")) || 0, realizedSavings: Number(d.realizedSavings.replace(/[,₦\s]/g, "")) || 0,
      ownerDepartment: d.ownerDepartment, ownerUser: d.ownerUser || null, dueDate: d.dueDate || null, status: d.status as EiPlan["status"], sourceKey: plan.sourceKey ?? null
    };
    setBusy(true);
    try { if (plan.id) await expenseIntelApi.updatePlan(plan.id, body); else await expenseIntelApi.createPlan(body); p.ctx.toast("Plan saved."); p.reload(); onClose(); }
    catch (e: any) { p.ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  return (
    <Modal title={plan.id ? "Edit plan" : "New Optimization Plan"} onClose={onClose} footer={<><button type="button" className={btn.outline} onClick={onClose}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={() => void save()}>Save plan</button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Action item"><input className={input} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Renegotiate waybill rates" /></Field></div>
        <Field label="Target"><input className={input} value={d.target} onChange={(e) => setD({ ...d, target: e.target.value })} placeholder="e.g. ≤ ₦7,500 per order" /></Field>
        <Field label="Expected savings"><input inputMode="numeric" className={input} value={d.expectedSavings} onChange={(e) => setD({ ...d, expectedSavings: e.target.value })} /></Field>
        <Field label="Department"><select className={input} value={d.ownerDepartment} onChange={(e) => setD({ ...d, ownerDepartment: e.target.value })}><option value="">—</option>{p.state.departmentsList.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Owner"><select className={input} value={d.ownerUser} onChange={(e) => setD({ ...d, ownerUser: e.target.value })}><option value="">Nobody yet</option>{p.state.people.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.role})</option>)}</select></Field>
        <Field label="Due date"><input type="date" className={input} value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })} /></Field>
        <Field label="Status"><select className={input} value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as EiPlan["status"] })}>{Object.entries(PLAN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select></Field>
        <Field label="Actually saved so far" hint="Type what it really saved, when known."><input inputMode="numeric" className={input} value={d.realizedSavings} onChange={(e) => setD({ ...d, realizedSavings: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
