import { useEffect, useState } from "react";
import { Banknote, CheckCircle2, Copy, Download, Eye, Filter, Loader2, MoreHorizontal, PieChart as PieIcon, RefreshCw, Search, Tag, Truck, Users, LineChart as TrendIcon, Clock } from "lucide-react";
import { socialLeadsApi } from "../../lib/api";
import { Avatar, Bar, CHART, Card, CardTitle, DateRange, Donut, Empty, Kpi, Pager, Pill, ProductThumb, Select, TrendChart, btn, dayLabel, downloadCsv, fromChange, lagosDateTime, money, num } from "./sl-ui";
import { useLoad, useStats } from "./sl-data";
import type { Shared } from "./SocialLeadsPage";

const th = "whitespace-nowrap px-3 py-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400";
const DONUT = ["#6E3FF3", "#22C55E", "#F5A524", "#3B82F6", "#EC4899", "#94A3B8"];
const ORDER_STATUSES = ["New", "Confirmed", "Scheduled", "Out for Delivery", "Delivered", "Cancelled", "Failed"];

export default function ConvertedTab({ shared }: { shared: Shared }) {
  const [range, setRange] = useState<{ range: string; from?: string; to?: string }>({ range: "7d" });
  const [tab, setTab] = useState<"all" | "delivered" | "pending">("all");
  const [product, setProduct] = useState("all"), [rep, setRep] = useState("all"), [source, setSource] = useState("all"), [status, setStatus] = useState("all");
  const [search, setSearch] = useState(""), [q, setQ] = useState("");
  const [page, setPage] = useState(1), [size, setSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [range, tab, product, rep, source, status, q, size]);
  const stats = useStats({ ...range, product, rep, source });
  const params = { ...range, tab, product, rep, source, status, q, page, size };
  const list = useLoad(() => socialLeadsApi.converted(params), JSON.stringify(params));
  const s = stats.data, c = s?.cards;
  const rows = list.data?.leads ?? [];
  const data = (s?.days ?? []).map((d) => ({ ...d, label: dayLabel(d.day) }));
  const byProduct = (s?.convertedByProduct ?? []).slice(0, 3);
  const rest = (s?.convertedByProduct ?? []).slice(3).reduce((n, p) => n + p.count, 0);
  const totalConv = s?.cards.orders.value ?? 0;

  const exportCsv = () => downloadCsv(`converted-leads-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Lead ID", "Customer", "Phone", "Product", "Package", "Order ID", "Order amount", "Converted on", "Delivery status", "Assigned to"],
    rows.map((r) => [r.ref, r.name, r.phone, r.order.product, r.order.packageName, r.order.id, r.order.amount, r.convertedAt ? lagosDateTime(r.convertedAt) : "", r.order.status, r.assignedName]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={CheckCircle2} tone="green" value={num(c?.orders.value)} label="Converted Leads" {...fromChange(c?.orders)} />
        <Kpi icon={Truck} tone="red" value={num(c?.delivered.value)} label="Delivered Orders" {...fromChange(c?.delivered)} />
        <Kpi icon={Banknote} tone="indigo" value={money(c?.revenue.value)} label="Delivered Revenue" {...fromChange(c?.revenue)} />
        <Kpi icon={Tag} tone="purple" value={money(c?.aov.value)} label="Avg. Order Value (AOV)" {...fromChange(c?.aov)} />
        <Kpi icon={RefreshCw} tone="green" value={c?.conversion.value !== null && c ? `${c.conversion.value}%` : "—"} label="Lead-to-Order Conversion" {...fromChange(c?.conversion)} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4"><CardTitle icon={TrendIcon} title="Conversion Trend" /><div className="mt-2">{data.length ? <TrendChart data={data} series={[{ key: "orders", label: "Orders Created", color: CHART.purple, fill: true }, { key: "delivered", label: "Delivered Orders", color: CHART.green }]} /> : <Empty>No orders in these dates.</Empty>}</div></Card>
        <Card className="p-4">
          <CardTitle icon={PieIcon} title="Converted by Product" />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-5">
            <Donut data={[...byProduct.map((p, i) => ({ label: p.name, value: p.count, color: DONUT[i] })), { label: "Others", value: rest, color: "#C4B5FD" }]} center={totalConv} sub="Converted" />
            <div className="min-w-[200px] flex-1 space-y-3">
              {byProduct.length === 0 && <p className="m-0 text-[13px] text-gray-500">No converted lead yet.</p>}
              {byProduct.map((p, i) => <div key={p.name} className="flex items-center gap-2 text-[13.5px]"><ProductThumb src={p.image} name={p.name} size={26} /><b className="min-w-0 flex-1 truncate" style={{ borderLeft: `3px solid ${DONUT[i]}`, paddingLeft: 6 }}>{p.name}</b><span className="w-14 text-right text-gray-600">{p.pct ?? 0}%</span><b className="w-10 text-right">{p.count}</b></div>)}
              {rest > 0 && <div className="flex items-center gap-2 text-[13.5px]"><span className="inline-flex h-[26px] w-[26px] items-center justify-center"><span className="h-3 w-3 rounded-full bg-violet-300" /></span><b className="flex-1">Others</b><span className="w-14 text-right text-gray-600">{Math.round((rest / Number(totalConv)) * 1000) / 10}%</span><b className="w-10 text-right">{rest}</b></div>}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <CardTitle icon={Users} title="Conversion by Call Rep" />
          <div className="mt-4 space-y-4">
            {(s?.reps ?? []).length === 0 && <p className="m-0 text-[13px] text-gray-500">No lead has been given to a rep yet.</p>}
            {(s?.reps ?? []).slice(0, 5).map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 text-[14px]"><Avatar name={r.name} src={r.avatar} size={30} /><b className="w-24 truncate">{r.name}</b><span className="flex-1"><Bar pct={r.conversion} color={["#6E3FF3", "#7C5CF5", "#A08BF8", "#C4B5FD", "#DDD6FE"][i] ?? "#C4B5FD"} /></span><b className="w-14 text-right">{r.conversion ?? 0}%</b></div>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <div className="flex flex-wrap items-start gap-3 px-5 pt-4">
          <div className="mr-auto">
            <h2 className="m-0 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">Conversion Leads ({list.data?.counts.all ?? 0})</h2>
            <p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Leads that were successfully converted to orders.</p>
          </div>
          {([["all", `All Converted (${list.data?.counts.all ?? 0})`], ["delivered", `Delivered (${list.data?.counts.delivered ?? 0})`], ["pending", `Pending Delivery (${list.data?.counts.pending ?? 0})`]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`!min-h-0 rounded-xl px-4 py-2.5 text-[14px] font-semibold ${tab === k ? "bg-[#5B3FD9] text-white" : "border border-gray-200 bg-white text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{label}</button>
          ))}
          <button type="button" onClick={exportCsv} className={btn.ghost}><Download className="h-4 w-4" />Export</button>
          <button type="button" aria-label="Clear filters" onClick={() => { setProduct("all"); setRep("all"); setSource("all"); setStatus("all"); setSearch(""); }} className={`${btn.icon} !text-[#5B3FD9]`}><Filter className="h-[18px] w-[18px]" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <span className="relative min-w-[220px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, order ID, or product..." className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" /></span>
          <DateRange compact range={range.range} onChange={setRange} />
          <Select label="Product" className="w-[160px]" value={product} onChange={setProduct} options={[{ value: "all", label: "All Products" }, ...shared.products.map((p) => ({ value: p.id, label: p.name }))]} />
          {shared.leadership && <Select label="Call rep" className="w-[160px]" value={rep} onChange={setRep} options={[{ value: "all", label: "All Call Reps" }, ...shared.reps.filter((r) => r.role === "Sales Rep").map((r) => ({ value: r.id, label: r.name }))]} />}
          <Select label="Source" className="w-[150px]" value={source} onChange={setSource} options={[{ value: "all", label: "All Sources" }, { value: "facebook", label: "Facebook" }, { value: "instagram", label: "Instagram" }, { value: "messenger", label: "Messenger" }]} />
          <Select label="Order status" className="w-[150px]" value={status} onChange={setStatus} options={[{ value: "all", label: "All Status" }, ...ORDER_STATUSES.map((x) => ({ value: x, label: x }))]} />
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[1180px] w-full border-collapse">
            <thead className="bg-gray-50/80 dark:bg-slate-800/50">
              <tr>
                <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onChange={() => setSelected((x) => (rows.every((r) => x.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))))} /></th>
                <th className={th}>Lead ID</th><th className={th}>Customer</th><th className={th}>Product / Package</th><th className={th}>Order ID</th><th className={th}>Order Amount</th><th className={th}>Status</th><th className={th}>Converted On</th><th className={th}>Delivery Status</th><th className={th}>Assigned To</th><th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.error && <tr><td colSpan={11}><Empty>{list.error}</Empty></td></tr>}
              {!list.data && !list.error && <tr><td colSpan={11}><Empty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Empty></td></tr>}
              {list.data && rows.length === 0 && <tr><td colSpan={11}><Empty>No converted lead here yet. A lead shows here once Create Order is used in its conversation.</Empty></td></tr>}
              {rows.map((r) => {
                const delivered = r.order.status === "Delivered", failed = ["Cancelled", "Failed"].includes(r.order.status);
                return (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                    <td className="!px-4"><input type="checkbox" aria-label={`Select ${r.ref}`} checked={selected.has(r.id)} onChange={() => setSelected((x) => { const n = new Set(x); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} /></td>
                    <td><span className="whitespace-nowrap rounded-lg bg-[#EEEBFC] px-2 py-1 text-[12.5px] font-bold text-[#5B3FD9]">{r.ref}</span></td>
                    <td><span className="flex items-center gap-2.5"><Avatar name={r.name} src={r.profilePic} size={36} /><span><b className="block">{r.name}</b><span className="text-[12.5px] text-gray-500">{r.phone ?? "—"}</span></span></span></td>
                    <td><span className="flex items-center gap-2"><ProductThumb src={r.productImage} name={r.order.product} size={34} /><span><b className="block leading-tight">{r.order.product}</b><span className="text-[12.5px] text-gray-500">{r.order.packageName ?? ""}</span></span></span></td>
                    <td><button type="button" onClick={() => shared.onOpenOrder?.(r.order.id)} className="!min-h-0 inline-flex items-center gap-1.5 font-bold text-[#5B3FD9]">#{r.order.id}<Copy className="h-3.5 w-3.5" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(String(r.order.id)); shared.onToast("Order ID copied."); }} /></button></td>
                    <td className="font-semibold">{money(r.order.amount, r.order.currency)}</td>
                    <td><Pill tone="green"><CheckCircle2 className="h-3.5 w-3.5" />Converted</Pill></td>
                    <td className="whitespace-nowrap">{r.convertedAt ? lagosDateTime(r.convertedAt) : "—"}</td>
                    <td><Pill tone={delivered ? "green" : failed ? "red" : "amber"}>{delivered ? <Truck className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}{delivered ? "Delivered" : failed ? r.order.status : r.order.status === "New" ? "Pending" : r.order.status}</Pill></td>
                    <td>{r.assignedName ? <span className="flex items-center gap-2"><Avatar name={r.assignedName} src={r.assignedAvatar} size={28} /><b className="font-semibold">{r.assignedName}</b></span> : "—"}</td>
                    <td>
                      <span className="relative flex items-center gap-1">
                        <button type="button" aria-label="Open order" onClick={() => shared.onOpenOrder?.(r.order.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B3FD9] hover:bg-[#F1EEFD]"><Eye className="h-[18px] w-[18px]" /></button>
                        <button type="button" aria-label="More" onClick={() => setMenuFor(menuFor === r.id ? null : r.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-[18px] w-[18px]" /></button>
                        {menuFor === r.id && <div className="absolute right-0 top-9 z-20 w-48 rounded-xl border border-gray-200 bg-white p-1 text-[13px] shadow-lg dark:border-slate-700 dark:bg-slate-900" onMouseLeave={() => setMenuFor(null)}><button type="button" className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); shared.openLead(r.id); }}>Open conversation</button></div>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={list.data?.page ?? 1} size={size} total={list.data?.total ?? 0} onPage={setPage} onSize={setSize} noun="converted leads" />
      </Card>
    </div>
  );
}
