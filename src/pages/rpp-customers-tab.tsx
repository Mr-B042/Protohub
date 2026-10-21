import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MoreVertical, RotateCw, ShoppingCart, UserPlus, Users, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../lib/money-privacy";
import { shiftWindow, windowSize } from "../lib/date-window";
import { Avatar, ProductThumb } from "./product-trend/parts";
import type { RepProductOrder } from "./RepProductPerformancePage";
import { Ring } from "./rpp-state-tab";
import { ChartCard, KpiCard, LowerToolbar, MiniSelect, SERIES, StateIcon, WaitingForDesign, change, nf, share, type RppCtx } from "./rpp-ui";

// ── Customer Insights (by Sales Rep) — Bright's design, 21 Oct 2026 ─────────
// ⚠️ HOW CUSTOMERS ARE COUNTED
// - One customer = the Customers page's identity (phone, then WhatsApp, email,
//   name), over the customer's WHOLE history - not just this period.
// - Customers in view = anyone with an order PLACED in the period.
// - New = first order ever is in the period. Returning = ordered before it.
// - List pills: Repeat Buyer = returning; New Customer = first order in the
//   period and more than one order; One-time Buyer = one order ever.
// - High-Value = spent at least twice the average customer in the period.
// - A customer belongs to the rep of their latest order in the period.
// - Spend = delivered order amounts in the period.

export type CustomerTypeFilter = "all" | "new" | "returning" | "one-time" | "high-value";
export const CUSTOMER_TYPES: Array<{ value: CustomerTypeFilter; label: string }> = [
  { value: "all", label: "All Customer Types" }, { value: "new", label: "New Customers" }, { value: "returning", label: "Returning Customers" },
  { value: "one-time", label: "One-time Buyers" }, { value: "high-value", label: "High-Value Customers" }
];
const LOWER = ["Customer List", "Repeat Customers", "High-Value Customers", "Inactive Customers", "Customer Journey", "Customer Feedback", "RFM Analysis"] as const;
type Lower = (typeof LOWER)[number];
const PAGE = 10;

type Customer = {
  key: string; name: string; phone: string; repId: string; state: string; city: string; orders: RepProductOrder[];
  delivered: number; spent: number; isNew: boolean; ordersEver: number; lastKey: string; topProductKey: string; topProductName: string; source: string; highValue: boolean;
};

function customersOf(orders: RepProductOrder[], windowStart: string): Customer[] {
  const map = new Map<string, RepProductOrder[]>();
  for (const o of orders) { const list = map.get(o.customerKey); if (list) list.push(o); else map.set(o.customerKey, [o]); }
  const rows: Customer[] = [...map].map(([key, list]) => {
    const sorted = [...list].sort((a, b) => b.createdKey.localeCompare(a.createdKey) || b.id.localeCompare(a.id));
    const latest = sorted[0], first = sorted[sorted.length - 1];
    const delivered = list.filter((o) => o.status === "Delivered");
    const productCount = new Map<string, { name: string; n: number }>();
    for (const o of list) { const row = productCount.get(o.productKey) ?? { name: o.productName, n: 0 }; row.n += 1; productCount.set(o.productKey, row); }
    const top = [...productCount].sort((a, b) => b[1].n - a[1].n)[0];
    return {
      key, name: latest.customer || "Customer", phone: latest.phone, repId: latest.repId ?? "", state: latest.state, city: latest.city, orders: list,
      delivered: delivered.length, spent: delivered.reduce((s, o) => s + o.amount, 0), isNew: latest.customerFirstKey >= windowStart, ordersEver: latest.customerOrdersEver,
      lastKey: latest.createdKey, topProductKey: top?.[0] ?? "", topProductName: top?.[1].name ?? "", source: first.source, highValue: false
    };
  });
  const spenders = rows.filter((c) => c.spent > 0);
  const avg = spenders.length ? spenders.reduce((s, c) => s + c.spent, 0) / spenders.length : 0;
  for (const c of rows) c.highValue = avg > 0 && c.spent >= avg * 2;
  return rows;
}

const typeOf = (c: Customer) => (!c.isNew ? "Repeat Buyer" : c.ordersEver > 1 ? "New Customer" : "One-time Buyer");
const PILL: Record<string, string> = { "Repeat Buyer": "bg-emerald-50 text-emerald-700", "New Customer": "bg-blue-50 text-blue-700", "One-time Buyer": "bg-gray-100 text-gray-600" };
const sourceLabel = (source: string) => source || "Organic / Others";

export default function RppCustomersTab({ ctx, customerType }: { ctx: RppCtx; customerType: CustomerTypeFilter }) {
  const [lower, setLower] = useState<Lower>("Customer List");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [page, setPage] = useState(1);

  const all = useMemo(() => customersOf(ctx.current, ctx.window.start), [ctx.current, ctx.window.start]);
  // The period before, judged against ITS own start (new then = first order then).
  const previous = useMemo(() => customersOf(ctx.before, shiftWindow(ctx.window, -windowSize(ctx.window)).start), [ctx.before, ctx.window]);
  const customers = useMemo(() => all.filter((c) => customerType === "all" || (customerType === "new" ? c.isNew : customerType === "returning" ? !c.isNew : customerType === "one-time" ? c.ordersEver === 1 : c.highValue)), [all, customerType]);
  const kpis = (list: Customer[]) => {
    const orders = list.reduce((n, c) => n + c.orders.length, 0);
    const spent = list.reduce((s, c) => s + c.spent, 0);
    const fresh = list.filter((c) => c.isNew).length;
    return { total: list.length, fresh, returning: list.length - fresh, perCustomer: list.length ? orders / list.length : null, spend: list.length ? spent / list.length : null };
  };
  const now = kpis(customers);
  const before = kpis(previous.filter((c) => customerType === "all" || (customerType === "new" ? c.isNew : customerType === "returning" ? !c.isNew : customerType === "one-time" ? c.ordersEver === 1 : c.highValue)));

  const repIds = useMemo(() => [...new Set(customers.map((c) => c.repId))].sort((a, b) => customers.filter((c) => c.repId === b).length - customers.filter((c) => c.repId === a).length), [customers]);
  const [repPick, setRepPick] = useState("");
  const rep = repIds.includes(repPick) ? repPick : repIds[0] ?? "";
  const repCustomers = customers.filter((c) => c.repId === rep);
  const byRep = repIds.map((id) => {
    const list = customers.filter((c) => c.repId === id);
    const high = list.filter((c) => c.highValue).length;
    const repeat = list.filter((c) => !c.highValue && c.ordersEver > 1).length;
    const once = list.length - high - repeat;
    const pctOf = (n: number) => (list.length ? Math.round((n / list.length) * 100) : 0);
    return { id, name: ctx.nameOfRep(id), short: ctx.nameOfRep(id).split(" ")[0], new: list.filter((c) => c.isNew).length, returning: list.filter((c) => !c.isNew).length, revenue: list.reduce((s, c) => s + c.spent, 0), once: pctOf(once), repeat: pctOf(repeat), high: pctOf(high) };
  });
  const group = <K extends string>(list: Customer[], key: (c: Customer) => K) => {
    const map = new Map<K, Customer[]>();
    for (const c of list) { const k = key(c); const l = map.get(k); if (l) l.push(c); else map.set(k, [c]); }
    return [...map];
  };
  const stateRows = group(repCustomers, (c) => c.state || "No state").map(([name, list]) => ({ name, total: list.length, fresh: list.filter((c) => c.isNew).length, revenue: list.reduce((s, c) => s + c.spent, 0) }))
    .sort((a, b) => b.total - a.total).slice(0, 5);
  const productRows = (() => {
    const map = new Map<string, { name: string; customers: Set<string>; orders: number; revenue: number }>();
    for (const c of repCustomers) for (const o of c.orders) {
      const row = map.get(o.productKey) ?? { name: o.productName, customers: new Set<string>(), orders: 0, revenue: 0 };
      row.customers.add(c.key); row.orders += 1; if (o.status === "Delivered") row.revenue += o.amount; map.set(o.productKey, row);
    }
    return [...map].map(([key, row]) => ({ key, ...row, count: row.customers.size })).sort((a, b) => b.count - a.count || b.revenue - a.revenue).slice(0, 5);
  })();
  const sources = group(repCustomers, (c) => sourceLabel(c.source)).map(([label, list], index) => ({ label, value: list.length, color: SERIES[index % SERIES.length] })).sort((a, b) => b.value - a.value);

  const needle = search.trim().toLowerCase();
  const listed = customers.filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.phone.includes(needle)).sort((a, b) => b.lastKey.localeCompare(a.lastKey) || b.spent - a.spent);
  const pages = Math.max(1, Math.ceil(listed.length / PAGE));
  const current = Math.min(page, pages);
  const pageRows = listed.slice((current - 1) * PAGE, current * PAGE);
  const th = "px-1.5 py-2.5 text-[10.5px] font-medium leading-tight text-gray-500 dark:text-slate-400";
  const td = "px-1.5 py-2.5 text-center text-[12px] text-gray-800 dark:text-slate-200";
  const repOptions = repIds.map((id) => ({ value: id, label: ctx.nameOfRep(id) }));
  const longDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard icon={<Users className="h-5 w-5" />} tone="bg-violet-100 text-violet-600" value={nf(now.total)} label="Total Customers" compare={ctx.compare} delta={change(now.total, before.total)} />
        <KpiCard icon={<UserPlus className="h-5 w-5" />} tone="bg-emerald-100 text-emerald-600" value={nf(now.fresh)} label="New Customers" compare={ctx.compare} delta={change(now.fresh, before.fresh)} />
        <KpiCard icon={<RotateCw className="h-5 w-5" />} tone="bg-blue-100 text-blue-600" value={nf(now.returning)} label="Returning Customers" compare={ctx.compare} delta={change(now.returning, before.returning)} />
        <KpiCard icon={<ShoppingCart className="h-5 w-5" />} tone="bg-rose-100 text-rose-600" value={now.perCustomer === null ? "—" : now.perCustomer.toFixed(1)} label="Avg Orders per Customer" compare={ctx.compare} delta={now.perCustomer === null || before.perCustomer === null ? null : change(now.perCustomer, before.perCustomer)} />
        <KpiCard icon={<Wallet className="h-5 w-5" />} tone="bg-amber-100 text-amber-600" value={now.spend === null ? "—" : money(now.spend)} label="Avg Customer Spend" compare={ctx.compare} delta={now.spend === null || before.spend === null ? null : change(now.spend, before.spend)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard title="Customers by Sales Rep" legend={[["#3b82f6", "New Customers"], ["#8b5cf6", "Returning Customers"]]}>
          <BarChart data={byRep} margin={{ top: 18, right: 4, left: -22, bottom: 0 }} barGap={2}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="short" tick={{ fontSize: 10 }} interval={0} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} /><Tooltip />
            <Bar dataKey="new" name="New" fill="#3b82f6" radius={[3, 3, 0, 0]}><LabelList dataKey="new" position="top" fontSize={10} /></Bar>
            <Bar dataKey="returning" name="Returning" fill="#8b5cf6" radius={[3, 3, 0, 0]}><LabelList dataKey="returning" position="top" fontSize={10} /></Bar>
          </BarChart>
        </ChartCard>
        <ChartCard title="Customer Type by Sales Rep" legend={[["#3b82f6", "One-time Buyers"], ["#8b5cf6", "Repeat Buyers"], ["#22c55e", "High-Value"]]}>
          <BarChart data={byRep} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="short" tick={{ fontSize: 10 }} interval={0} /><YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" /><Tooltip formatter={(value: number) => `${value}%`} />
            <Bar dataKey="once" name="One-time" stackId="t" fill="#3b82f6"><LabelList dataKey="once" position="center" fontSize={10} fill="#fff" formatter={(v: number) => (v >= 8 ? `${v}%` : "")} /></Bar>
            <Bar dataKey="repeat" name="Repeat" stackId="t" fill="#8b5cf6"><LabelList dataKey="repeat" position="center" fontSize={10} fill="#fff" formatter={(v: number) => (v >= 8 ? `${v}%` : "")} /></Bar>
            <Bar dataKey="high" name="High-value" stackId="t" fill="#22c55e" radius={[3, 3, 0, 0]}><LabelList dataKey="high" position="center" fontSize={10} fill="#fff" formatter={(v: number) => (v >= 8 ? `${v}%` : "")} /></Bar>
          </BarChart>
        </ChartCard>
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="m-0 mb-4 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Total Revenue by Sales Rep (Customers)</h2>
          <ul className="m-0 list-none space-y-3.5 p-0">
            {byRep.map((row, index) => (
              <li key={row.id} className="flex items-center gap-2.5">
                <span className="w-24 shrink-0 truncate text-[12.5px] text-gray-700 dark:text-slate-300" title={row.name}>{row.name}</span>
                <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-slate-800"><div className="h-full rounded" style={{ width: `${(row.revenue / Math.max(1, ...byRep.map((r) => r.revenue))) * 100}%`, background: SERIES[index % SERIES.length] }} /></div>
                <span className="w-[86px] shrink-0 text-right text-[12px] font-semibold text-gray-900 dark:text-slate-100">{money(row.revenue)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <MiniTable title="Top States by Customers (per Sales Rep)" select={<MiniSelect label="Sales rep" value={rep} onChange={setRepPick} options={repOptions} className="w-[140px]" />}
          head={["#", "State", "Total Customers", "New", "Returning", "Avg Spend", "Total Revenue"]}
          rows={stateRows.map((row, index) => [<span key="i" className="text-gray-500">{index + 1}</span>, <span key="s" className="flex items-center gap-2 font-semibold"><StateIcon name={row.name} size={20} />{row.name}</span>, row.total, row.fresh, row.total - row.fresh, row.total ? money(row.revenue / row.total) : "-", money(row.revenue)])} />
        <MiniTable title="Top Products Bought (by Sales Rep)" select={<MiniSelect label="Sales rep" value={rep} onChange={setRepPick} options={repOptions} className="w-[140px]" />}
          head={["#", "Product", "Customers", "% of Rep Customers", "Avg Orders per Customer", "Total Revenue"]}
          rows={productRows.map((row, index) => [<span key="i" className="text-gray-500">{index + 1}</span>, <span key="p" className="flex items-center gap-2 font-semibold"><ProductThumb src={ctx.imageOf(row.key)} name={row.name} size={22} /><span className="max-w-[90px] whitespace-normal leading-tight">{row.name}</span></span>, row.count, `${Math.round(share(row.count, repCustomers.length) ?? 0)}%`, (row.orders / Math.max(1, row.count)).toFixed(1), money(row.revenue)])} />
        <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">Customer Acquisition Source (by Sales Rep)</h2><MiniSelect label="Sales rep" value={rep} onChange={setRepPick} options={repOptions} className="w-[140px]" /></div>
          <Ring slices={sources} center={nf(repCustomers.length)} sub="Customers" />
        </section>
      </div>

      <LowerToolbar tabs={LOWER} active={lower} onTab={(tab) => { setLower(tab); setPage(1); }} search={search} onSearch={(value) => { setSearch(value); setPage(1); }} placeholder="Search customer..." view={view} onView={setView} />
      {lower !== "Customer List" ? <WaitingForDesign what={lower} /> : view === "chart" ? (
        <ChartCard title="Customers by sales rep" height={340} legend={[["#3b82f6", "New"], ["#8b5cf6", "Returning"]]}>
          <BarChart data={byRep} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" /><XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="new" name="New" fill="#3b82f6" radius={[4, 4, 0, 0]} /><Bar dataKey="returning" name="Returning" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1150px] border-collapse">
              <thead><tr className="border-b border-gray-200 dark:border-slate-700">
                {["#", "Customer", "Phone", "Sales Rep", "State", "City", "Total Orders", "Total Spent", "Avg Order Value", "Customer Type", "Last Order Date", "Top Product", "Order Source", "Actions"].map((label, i) => <th key={label} className={`${th} ${[1, 3, 11].includes(i) ? "text-left" : ""}`}>{label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {pageRows.length === 0 && <tr><td colSpan={14} className="px-4 py-8 text-center text-[13px] text-gray-500">No customers match.</td></tr>}
                {pageRows.map((c, index) => (
                  <tr key={c.key} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                    <td className={`${td} text-gray-500`}>{(current - 1) * PAGE + index + 1}</td>
                    <td className="px-2 py-2"><span className="flex items-center gap-2"><Avatar name={c.name} size={26} /><span className="max-w-[120px] truncate text-[12px] font-semibold text-gray-900 dark:text-slate-100">{c.name}</span></span></td>
                    <td className={`${td} whitespace-nowrap`}>{c.phone || "-"}</td>
                    <td className="px-2 py-2"><span className="flex items-center gap-1.5 text-[12px] text-gray-800 dark:text-slate-200"><Avatar name={ctx.nameOfRep(c.repId)} size={22} /><span className="max-w-[100px] truncate">{ctx.nameOfRep(c.repId)}</span></span></td>
                    <td className={td}>{c.state || "-"}</td><td className={td}>{c.city || "-"}</td>
                    <td className={td}>{c.orders.length}</td>
                    <td className={`${td} whitespace-nowrap`}>{money(c.spent)}</td>
                    <td className={`${td} whitespace-nowrap`}>{c.delivered ? money(c.spent / c.delivered) : "-"}</td>
                    <td className={td}><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${PILL[typeOf(c)]}`}>{typeOf(c)}</span></td>
                    <td className={`${td} whitespace-nowrap`}>{longDate(c.lastKey)}</td>
                    <td className="px-2 py-2"><span className="flex items-center gap-1.5"><ProductThumb src={ctx.imageOf(c.topProductKey)} name={c.topProductName} size={22} /><span className="max-w-[120px] truncate text-[12px] text-gray-800 dark:text-slate-200">{c.topProductName}</span></span></td>
                    <td className={td}><span className="whitespace-nowrap rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{sourceLabel(c.source)}</span></td>
                    <td className="px-2 text-center"><button type="button" aria-label={`${c.name}: show orders`} onClick={() => ctx.openList(`${c.name} · orders`, `${c.orders.length} order${c.orders.length === 1 ? "" : "s"} · ${ctx.periodLabel}`, c.orders)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-[12.5px] text-gray-500 dark:border-slate-800">
            <span>Showing {listed.length ? (current - 1) * PAGE + 1 : 0} to {Math.min(current * PAGE, listed.length)} of {nf(listed.length)} customers</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={current === 1} onClick={() => setPage(current - 1)} aria-label="Previous page" className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40 dark:border-slate-700"><ChevronLeft className="h-4 w-4" /></button>
              {pagesAround(current, pages).map((n, i) => n === 0 ? <span key={`gap${i}`} className="px-1">…</span> : (
                <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === current ? "page" : undefined} className={`!min-h-0 h-8 min-w-8 rounded-lg px-2 text-[12.5px] font-semibold ${n === current ? "bg-indigo-600 text-white" : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-200"}`}>{n}</button>
              ))}
              <button type="button" disabled={current === pages} onClick={() => setPage(current + 1)} aria-label="Next page" className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 disabled:opacity-40 dark:border-slate-700"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      )}
      <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">Customers with an order placed {ctx.periodLabel}, matched by phone like the Customers page. New = first order ever in this period; returning = ordered before. High-value = spent at least twice the average customer. Spend = delivered orders. A customer counts under the rep of their latest order.</p>
    </div>
  );
}

function pagesAround(current: number, pages: number): number[] {
  const out = new Set([1, pages, current - 1, current, current + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...out].sort((a, b) => a - b);
  const withGaps: number[] = [];
  sorted.forEach((n, i) => { if (i > 0 && n - sorted[i - 1] > 1) withGaps.push(0); withGaps.push(n); });
  return withGaps;
}

function MiniTable({ title, select, head, rows }: { title: string; select: React.ReactNode; head: string[]; rows: React.ReactNode[][] }) {
  return (
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4"><h2 className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>{select}</div>
      <div className="mt-2 overflow-x-auto px-2 pb-2">
        <table className="w-full !min-w-0 border-collapse">
          <thead><tr className="border-b border-gray-200 dark:border-slate-700">{head.map((label, i) => <th key={label} className={`px-1 py-2 text-[10px] font-medium leading-tight text-gray-500 ${i === 1 ? "text-left" : ""}`}>{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={head.length} className="px-3 py-6 text-center text-[12.5px] text-gray-500">No customers for this rep.</td></tr>}
            {rows.map((cells, r) => <tr key={r}>{cells.map((cell, i) => <td key={i} className={`whitespace-nowrap px-1 py-2 text-[11px] text-gray-800 dark:text-slate-200 ${i === 1 ? "text-left" : "text-center"}`}>{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
