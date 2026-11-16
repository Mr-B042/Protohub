import { useMemo, useState, type ReactNode } from "react";
import { Building2, Download, Layers, Megaphone, Package, Percent, Plus, Settings2, Truck, Users, Warehouse, MoreHorizontal } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { expenseIntelApi } from "../../lib/api";
import type { TabProps } from "./context";
import { COST_GROUPS, labelOf, monthLabel, share, sum } from "./model";
import { useMonthData, useProductRows } from "./data";
import { GROUP_COLOR, GROUP_LABEL } from "./OverviewTab";
import { Bar, C, Card, Donut, Empty, Field, Kpi, LinkAction, Modal, btn, delta, downloadCsv, input, td, th } from "./ui";

const DEPT_ICON: Record<string, typeof Truck> = {
  "Operations & Fulfillment": Truck, "Marketing & Growth": Megaphone, "Sales & Customer Support": Users, Administration: Building2, "Inventory & Procurement": Warehouse, Others: MoreHorizontal
};
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${Math.round(v / 1e3)}K` : String(Math.round(v)));

/** Default department of a category; Owner can change it (Departments). Browser copy of backend departmentOf. */
export function departmentOf(category: string, overrides: Record<string, string>) {
  if (overrides[category]) return overrides[category];
  const c = category.toLowerCase();
  if (/delivery|waybill|logistic|pickup/.test(c)) return "Operations & Fulfillment";
  if (/ad spend|advert|marketing/.test(c)) return "Marketing & Growth";
  if (/salary|bonus|incentive|commission/.test(c)) return "Sales & Customer Support";
  if (/clearing|shipping|stock|cogs|procure|purchase/.test(c)) return "Inventory & Procurement";
  if (/airtime|data|office|utilit|software|subscription|rent/.test(c)) return "Administration";
  return "Others";
}

export default function BreakdownTab(p: TabProps & { picker: ReactNode }) {
  const { ctx, period, state } = p;
  const d = useMonthData(p);
  const products = useProductRows(p);
  const [deptOpen, setDeptOpen] = useState(false);
  const money = ctx.money;
  const groupTotal = sum(d.groups, (g) => g.amount);
  const g = (group: (typeof COST_GROUPS)[number], rows = d.groups) => rows.find((x) => x.group === group)?.amount ?? 0;
  const opex = d.now.operatingExpense, copex = d.before.operatingExpense;

  // Departments: business costs by who spends them (COGS → procurement, logistics → operations, bonuses → sales).
  const depts = useMemo(() => {
    const m = new Map<string, number>(state.departmentsList.map((x) => [x, 0]));
    const add = (k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    add(departmentOf("COGS", state.settings.departments), d.now.cogs);
    add(departmentOf("Delivery", state.settings.departments), d.now.recognizedLogistics);
    add(departmentOf("Bonuses & Incentives", state.settings.departments), d.now.totalBonusExpense);
    for (const e of d.exp) if (e.category !== "Delivery") add(departmentOf(e.category, state.settings.departments), e.amount);
    const total = sum([...m.values()], (v) => v);
    return [...m.entries()].map(([name, amount]) => ({ name, amount, share: share(amount, total) })).sort((a, b) => b.amount - a.amount);
  }, [d, state]);
  const deptMax = Math.max(1, ...depts.map((x) => x.amount));
  const productTotal = sum(products, (r) => r.totalCost);

  const exportCsv = () => downloadCsv(`expense-breakdown-${period.month}.csv`, [
    ["Cost group", "Amount", "Share %"], ...d.groups.map((x) => [GROUP_LABEL[x.group], Math.round(x.amount), share(x.amount, groupTotal).toFixed(1)]),
    [], ["Product", "Total cost", "COGS", "Logistics", "Advertising", "Waybill", "Incentives", "Other"], ...products.map((r) => [r.name, Math.round(r.totalCost), Math.round(r.cogs), Math.round(r.logistics), Math.round(r.advertising), Math.round(r.waybill), Math.round(r.incentives), Math.round(r.other)]),
    [], ["Department", "Amount", "Share %"], ...depts.map((x) => [x.name, Math.round(x.amount), x.share.toFixed(1)])
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Expense Breakdown</h2>
          <p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">Where the money goes, by category, product and department.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} onClick={ctx.onAddExpense}><Plus className="h-4 w-4" />Add Expense</button>
          <button type="button" className={btn.outline} onClick={exportCsv}><Download className="h-4 w-4" />Export</button>
          {ctx.role === "Owner" && <button type="button" className={btn.outline} onClick={() => setDeptOpen(true)}><Settings2 className="h-4 w-4" />Departments</button>}
        </div>
      </div>
      {p.picker}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Layers} tone={C.blue} label="Total Expenses" value={money(d.recorded)} spark={d.months.map((m) => m.recorded)} d={delta(d.recorded, d.crecorded, { lowerIsBetter: true, label: period.cLabel, beforeText: money(d.crecorded) })} />
        <Kpi icon={Percent} tone={C.green} label="Operating Expenses" value={money(opex)} d={delta(opex, copex, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={Package} tone={C.purple} label="Cost of Goods (COGS)" value={money(d.now.cogs)} d={delta(d.now.cogs, d.before.cogs, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={Truck} tone={C.orange} label="Logistics" value={money(d.now.recognizedLogistics)} d={delta(d.now.recognizedLogistics, d.before.recognizedLogistics, { lowerIsBetter: true, label: period.cLabel })} />
        <Kpi icon={Megaphone} tone={C.pink} label="Advertising" value={money(g("Advertising"))} d={delta(g("Advertising"), g("Advertising", d.cgroups), { lowerIsBetter: true, label: period.cLabel })} />
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Expenses by Category" sub="All business costs: they add up to the Overview's Total Business Costs">
          <div className="flex flex-col items-center gap-5 md:flex-row">
            <Donut data={d.groups.map((x) => ({ name: GROUP_LABEL[x.group], value: x.amount, color: GROUP_COLOR[x.group] }))} center={money(groupTotal)} sub="Total Business Costs" size={210} />
            <table className="!min-w-0 w-full">
              <thead><tr><th className={th}>Category</th><th className={`${th} !text-right`}>Amount</th><th className={`${th} !text-right`}>Share</th></tr></thead>
              <tbody>{d.groups.map((x) => (
                <tr key={x.group} className="border-b border-gray-50 dark:border-slate-800"><td className={td}><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[x.group] }} />{GROUP_LABEL[x.group]}</span></td><td className={`${td} text-right font-bold`}>{money(x.amount)}</td><td className={`${td} text-right`}>{share(x.amount, groupTotal).toFixed(1)}%</td></tr>
              ))}</tbody>
            </table>
          </div>
        </Card>

        <Card title="Expense Trend by Category" sub="Last 6 months">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={d.months.map((m) => ({ name: monthLabel(m.m, true), ...Object.fromEntries(m.groups.map((x) => [x.group, Math.round(x.amount)])) }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(v) => `₦${compact(v)}`} tickLine={false} axisLine={false} fontSize={11} width={56} />
                <Tooltip formatter={(v: number, n) => [money(v), GROUP_LABEL[n as keyof typeof GROUP_LABEL] ?? n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" height={28} formatter={(v) => GROUP_LABEL[v as keyof typeof GROUP_LABEL] ?? v} />
                {[...COST_GROUPS].reverse().map((k) => <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={GROUP_COLOR[k]} fill={GROUP_COLOR[k]} fillOpacity={0.35} />)}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Expense Breakdown by Product" action={<LinkAction onClick={() => p.go("product")}>View Details</LinkAction>}>
          {products.length === 0 ? <Empty>No product costs this month.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full !min-w-[720px]">
                <thead><tr className="border-b border-gray-100 dark:border-slate-800">{["Product", "Total Cost", "% of Total", "COGS", "Logistics", "Advertising", "Operating"].map((h) => <th key={h} className={`${th} ${h !== "Product" ? "!text-right" : ""}`}>{h}</th>)}</tr></thead>
                <tbody>{products.map((r) => {
                  const img = ctx.products.find((x) => x.id === r.productId)?.image;
                  const chip = (v: number, cls: string) => <span className={`inline-block rounded-md px-2 py-0.5 text-[12px] font-bold ${cls}`}>{money(v)}</span>;
                  return (
                    <tr key={r.productId} className="border-b border-gray-50 dark:border-slate-800">
                      <td className={td}><span className="flex items-center gap-2">{img ? <img src={img} alt="" className="h-8 w-8 rounded-lg object-cover" /> : <span className="h-8 w-8 rounded-lg bg-gray-100 dark:bg-slate-800" />}<b className="text-gray-900 dark:text-slate-50">{r.name}</b></span></td>
                      <td className={`${td} text-right font-bold`}>{money(r.totalCost)}</td>
                      <td className={`${td} text-right`}>{share(r.totalCost, productTotal).toFixed(1)}%</td>
                      <td className={`${td} text-right`}>{chip(r.cogs, "bg-blue-50 text-blue-700")}</td>
                      <td className={`${td} text-right`}>{chip(r.logistics, "bg-orange-50 text-orange-700")}</td>
                      <td className={`${td} text-right`}>{chip(r.advertising, "bg-emerald-50 text-emerald-700")}</td>
                      <td className={`${td} text-right`}>{chip(r.waybill + r.incentives + r.other, "bg-violet-50 text-violet-700")}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <p className="m-0 mt-2 text-[11.5px] text-gray-500">Operating = the product's waybill, incentives and bonuses, and other costs recorded against it. Costs not tied to a product (salaries, airtime…) stay out of this table.</p>
            </div>
          )}
        </Card>

        <Card title="Expense Breakdown by Department" action={ctx.role === "Owner" ? <LinkAction onClick={() => setDeptOpen(true)}>Change departments</LinkAction> : undefined}>
          <ul className="m-0 list-none space-y-3 p-0">
            {depts.map((x) => { const I = DEPT_ICON[x.name] ?? MoreHorizontal; return (
              <li key={x.name} className="flex items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-[#2F6BFF] dark:bg-blue-500/10"><I className="h-4 w-4" /></span>
                <span className="w-44 shrink-0 text-[13px] font-semibold text-gray-800 dark:text-slate-200">{x.name}</span>
                <span className="min-w-0 flex-1"><Bar value={x.amount} max={deptMax} /></span>
                <b className="w-28 shrink-0 text-right text-[13px] text-gray-900 dark:text-slate-50">{money(x.amount)}</b>
                <span className="w-12 shrink-0 text-right text-[12px] text-gray-500">{x.share.toFixed(1)}%</span>
              </li>
            ); })}
          </ul>
        </Card>
      </div>

      {deptOpen && <DepartmentsModal p={p} categories={[...new Set(["COGS", "Delivery", "Bonuses & Incentives", ...ctx.expenses.map((e) => e.category)])]} onClose={() => setDeptOpen(false)} />}
    </div>
  );
}

function DepartmentsModal({ p, categories, onClose }: { p: TabProps; categories: string[]; onClose: () => void }) {
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((c) => [c, departmentOf(c, p.state.settings.departments)])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await expenseIntelApi.saveSettings({ departments: map }); p.ctx.toast("Departments saved."); p.reload(); onClose(); }
    catch (e: any) { p.ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  return (
    <Modal title="Departments" sub="Which department each kind of cost belongs to." onClose={onClose} footer={<><button type="button" className={btn.outline} onClick={onClose}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={() => void save()}>Save</button></>}>
      <div className="space-y-2">
        {categories.map((c) => (
          <Field key={c} label={c === "COGS" ? "Cost of goods" : c === "Delivery" ? "Delivery fees" : c === "Bonuses & Incentives" ? "Bonuses & incentives" : labelOf(c)}>
            <select className={input} value={map[c]} onChange={(e) => setMap({ ...map, [c]: e.target.value })}>{p.state.departmentsList.map((x) => <option key={x}>{x}</option>)}</select>
          </Field>
        ))}
      </div>
    </Modal>
  );
}
