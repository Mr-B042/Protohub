import { useState } from "react";
import { ArrowRight, Banknote, BarChart2, Clock, Download, Expand, Eye, Filter, Gauge, Layers, MoreHorizontal, PieChart as PieIcon, RefreshCw, ShoppingCart, Tag, Trophy, Truck, Users, Zap, LineChart as TrendIcon, Medal } from "lucide-react";
import type { SlRep } from "../../lib/api";
import { Avatar, Bar, CHART, Card, CardTitle, DateRange, Donut, Empty, Kpi, Modal, Pill, RateChip, Select, TrendChart, btn, dayLabel, downloadCsv, duration, fromChange, money, num } from "./sl-ui";
import { useStats } from "./sl-data";
import { FunnelCard } from "./OverviewTab";
import type { Shared } from "./SocialLeadsPage";

const th = "whitespace-nowrap px-2.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400";
const row = "border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:px-2.5 [&>td]:py-2.5 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200";
const REP_COLORS = ["#6E3FF3", "#3B82F6", "#22C1C3", "#22C55E", "#F5A524", "#EC4899", "#A06CF7", "#0EA5E9"];
const medal = (i: number) => ["bg-amber-400 text-white", "bg-gray-300 text-gray-800", "bg-orange-400 text-white"][i] ?? "bg-sky-100 text-sky-700";

export default function TeamTab({ shared }: { shared: Shared }) {
  const [range, setRange] = useState<{ range: string; from?: string; to?: string }>({ range: "7d" });
  const [product, setProduct] = useState("all");
  const [detailTab, setDetailTab] = useState<"summary" | "products" | "source" | "follow" | "response">("summary");
  const [expanded, setExpanded] = useState(false);
  const [rep, setRep] = useState<SlRep | null>(null);
  const stats = useStats({ ...range, product });
  const s = stats.data, c = s?.cards;
  const reps = s?.reps ?? [];
  const best = (key: keyof SlRep, low = false) => reps.filter((r) => r[key] !== null && r[key] !== undefined && (typeof r[key] !== "number" || (r[key] as number) > 0)).sort((a, b) => low ? (a[key] as number) - (b[key] as number) : (b[key] as number) - (a[key] as number))[0] ?? null;
  const summary = [
    { Icon: Trophy, label: "Best Conversion", r: best("conversion"), v: (r: SlRep) => `${r.conversion}%`, tone: "text-amber-500" },
    { Icon: Banknote, label: "Highest Revenue", r: best("revenue"), v: (r: SlRep) => money(r.revenue), tone: "text-emerald-600" },
    { Icon: ShoppingCart, label: "Most Orders", r: best("orders"), v: (r: SlRep) => String(r.orders), tone: "text-rose-500" },
    { Icon: Zap, label: "Fastest Response", r: best("avgResponseSeconds", true), v: (r: SlRep) => duration(r.avgResponseSeconds), tone: "text-violet-600" },
    { Icon: Truck, label: "Best Delivery Rate", r: best("deliveryRate"), v: (r: SlRep) => `${r.deliveryRate}%`, tone: "text-sky-600" }
  ];
  const assignedTotal = Number(c?.assigned.value ?? 0) + Number(s?.unassigned ?? 0);
  const kpm = [
    { Icon: Clock, label: "Avg. First Response Time", value: duration(c?.avgResponseSeconds.value), pct: c?.avgResponseSeconds.value ? Math.max(5, 100 - (Number(c.avgResponseSeconds.value) / 600) * 100) : 0 },
    { Icon: Filter, label: "Lead-to-Order Conversion", value: c?.conversion.value !== null && c ? `${c.conversion.value}%` : "—", pct: Number(c?.conversion.value ?? 0) },
    { Icon: Truck, label: "Delivery Rate (DR)", value: c?.deliveryRate.value !== null && c ? `${c.deliveryRate.value}%` : "—", pct: Number(c?.deliveryRate.value ?? 0) },
    { Icon: Tag, label: "Average Order Value (AOV)", value: money(c?.aov.value), pct: c?.aov.value ? 50 : 0 },
    { Icon: Layers, label: "Upsell / Cross-sell Rate", value: c?.upsellRate.value !== null && c ? `${c.upsellRate.value}%` : "—", pct: Number(c?.upsellRate.value ?? 0) }
  ];
  const exportCsv = () => downloadCsv(`social-leads-team-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Call rep", "Assigned", "Engaged", "Orders", "Delivered", "Delivery rate %", "Conversion %", "AOV", "Upsells", "Revenue", "Avg first response (s)"],
    reps.map((r) => [r.name, r.assigned, r.engaged, r.orders, r.delivered, r.deliveryRate, r.conversion, r.aov, r.upsells, r.revenue, r.avgResponseSeconds]));

  const detail = (
    <table className="!min-w-[1000px] w-full border-collapse">
      {detailTab === "summary" && <>
        <thead><tr>{["Call Rep", "Assigned Leads", "Engaged", "Orders", "Delivered", "DR", "Conversion", "AOV", "Upsells", "Revenue", "Avg. Response", "Actions"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{reps.map((r) => <tr key={r.id} className={row}><td><RepCell r={r} /></td><td>{r.assigned}</td><td>{r.engaged}</td><td>{r.orders}</td><td>{r.delivered}</td><td><RateChip value={r.deliveryRate} /></td><td><RateChip value={r.conversion} /></td><td>{money(r.aov)}</td><td>{r.upsells} ({r.upsellRate ?? 0}%)</td><td className="font-semibold">{money(r.revenue)}</td><td>{duration(r.avgResponseSeconds)}</td><td><RepActions r={r} onOpen={() => setRep(r)} /></td></tr>)}</tbody>
      </>}
      {detailTab === "products" && <>
        <thead><tr>{["Call Rep", "Top products (leads)", "Orders", "Delivered", "Revenue"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{reps.map((r) => <tr key={r.id} className={row}><td><RepCell r={r} /></td><td>{r.products.length ? r.products.map((p) => `${p.name} (${p.count})`).join(" · ") : "—"}</td><td>{r.orders}</td><td>{r.delivered}</td><td className="font-semibold">{money(r.revenue)}</td></tr>)}</tbody>
      </>}
      {detailTab === "source" && <>
        <thead><tr>{["Call Rep", "Facebook", "Instagram", "Messenger", "Total"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{reps.map((r) => <tr key={r.id} className={row}><td><RepCell r={r} /></td><td>{r.sources.facebook}</td><td>{r.sources.instagram}</td><td>{r.sources.messenger}</td><td className="font-semibold">{r.assigned}</td></tr>)}</tbody>
      </>}
      {detailTab === "follow" && <>
        <thead><tr>{["Call Rep", "Scheduled", "Done", "Overdue", "Open leads", "Lost"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{reps.map((r) => <tr key={r.id} className={row}><td><RepCell r={r} /></td><td>{r.followUps.scheduled}</td><td>{r.followUps.done}</td><td className={r.followUps.overdue ? "!text-rose-600 font-semibold" : ""}>{r.followUps.overdue}</td><td>{r.open}</td><td>{r.lost}</td></tr>)}</tbody>
      </>}
      {detailTab === "response" && <>
        <thead><tr>{["Call Rep", "Avg. first response", "Under 2 min", "2–5 min", "5–10 min", "Over 10 min", "Late now"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>{reps.map((r) => <tr key={r.id} className={row}><td><RepCell r={r} /></td><td className="font-semibold">{duration(r.avgResponseSeconds)}</td>{r.responseBuckets.map((n, i) => <td key={i}>{n}</td>)}<td className={r.overdue ? "!text-rose-600 font-semibold" : ""}>{r.overdue}</td></tr>)}</tbody>
      </>}
      {!reps.length && <tbody><tr><td colSpan={12}><Empty>No lead has been given to a rep in these dates.</Empty></td></tr></tbody>}
    </table>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="m-0 text-[24px] font-extrabold text-gray-900 dark:text-slate-50">Team Performance</h2>
          <p className="m-0 text-[14px] text-gray-600 dark:text-slate-400">Track your call reps' social lead performance, conversions and revenue.</p>
        </div>
        <DateRange range={range.range} from={s?.filters.from} to={s?.filters.to} onChange={setRange} />
        <Select label="Product" className="w-[220px]" value={product} onChange={setProduct} options={[{ value: "all", label: "All Products" }, ...shared.products.map((p) => ({ value: p.id, label: p.name }))]} />
        <button type="button" onClick={exportCsv} className={btn.ghost}><Download className="h-4 w-4" />Export</button>
        <button type="button" aria-label="Refresh" onClick={stats.reload} className={btn.icon}><RefreshCw className="h-[18px] w-[18px]" /></button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={Users} tone="purple" value={num(s?.activeReps)} label="Active Call Reps" />
        <Kpi icon={Users} tone="blue" value={num(c?.assigned.value)} label="Assigned Leads" {...fromChange(c?.assigned)} />
        <Kpi icon={ShoppingCart} tone="red" value={num(c?.orders.value)} label="Orders Created" {...fromChange(c?.orders)} />
        <Kpi icon={Truck} tone="green" value={num(c?.delivered.value)} label="Delivered Orders" {...fromChange(c?.delivered)} />
        <Kpi icon={Banknote} tone="green" value={money(c?.revenue.value)} label="Delivered Revenue" {...fromChange(c?.revenue)} />
        <Kpi icon={RefreshCw} tone="green" value={c?.conversion.value !== null && c ? `${c.conversion.value}%` : "—"} label="Lead-to-Order Conversion" {...fromChange(c?.conversion)} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <CardTitle icon={Trophy} title="Team Leaderboard" right={<button type="button" onClick={() => document.getElementById("sl-team-detail")?.scrollIntoView({ behavior: "smooth" })} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2F5BEA] underline">View Details<ArrowRight className="h-4 w-4" /></button>} />
          <div className="mt-2 overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead><tr>{["#", "Call Rep", "Assigned", "Orders", "Delivered", "Conversion", "Revenue"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {!reps.length && <tr><td colSpan={7}><Empty>No rep data yet.</Empty></td></tr>}
                {reps.slice(0, 6).map((r, i) => (
                  <tr key={r.id} className={`${row} ${i === 0 ? "bg-amber-50/60 dark:bg-amber-500/10" : ""}`}>
                    <td><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${medal(i)}`}>{i + 1}</span></td>
                    <td><RepCell r={r} /></td><td>{r.assigned}</td><td>{r.orders}</td><td>{r.delivered}</td><td><RateChip value={r.conversion} /></td><td className="font-semibold">{money(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <FunnelCard stats={s} title="Conversion Funnel (Team)" team />
        <Card className="p-4">
          <CardTitle icon={BarChart2} title="Performance Summary" />
          <div className="mt-3 space-y-2.5">
            {summary.map((x) => (
              <div key={x.label} className="flex items-center gap-2.5 text-[13.5px]">
                <x.Icon className={`h-5 w-5 ${x.tone}`} /><span className="flex-1">{x.label}</span>
                <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-[13px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{x.r ? `${x.r.name} – ${x.v(x.r)}` : "—"}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4"><CardTitle icon={TrendIcon} title="Orders & Delivered Trend" /><div className="mt-2">{(s?.days ?? []).length ? <TrendChart data={(s?.days ?? []).map((d) => ({ ...d, label: dayLabel(d.day) }))} series={[{ key: "orders", label: "Orders Created", color: CHART.purple, fill: true }, { key: "delivered", label: "Delivered Orders", color: CHART.green }]} /> : <Empty>No orders yet.</Empty>}</div></Card>
        <Card className="p-4">
          <CardTitle icon={PieIcon} title="Lead Distribution by Call Rep" />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-5">
            <Donut data={[...reps.map((r, i) => ({ label: r.name, value: r.assigned, color: REP_COLORS[i % REP_COLORS.length] })), { label: "Unassigned", value: s?.unassigned ?? 0, color: "#CBD5E1" }]} center={num(assignedTotal)} sub="Assigned Leads" />
            <div className="min-w-[170px] flex-1 space-y-2 text-[13.5px]">
              {reps.slice(0, 6).map((r, i) => <div key={r.id} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: REP_COLORS[i % REP_COLORS.length] }} /><span className="flex-1 truncate">{r.name}</span><span className="text-gray-600">{assignedTotal ? Math.round((r.assigned / assignedTotal) * 1000) / 10 : 0}% ({r.assigned})</span></div>)}
              <div className="flex items-center gap-2"><span className="h-3 w-3 rounded-full bg-slate-300" /><span className="flex-1">Unassigned</span><span className="text-gray-600">{assignedTotal ? Math.round(((s?.unassigned ?? 0) / assignedTotal) * 1000) / 10 : 0}% ({s?.unassigned ?? 0})</span></div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <CardTitle icon={Gauge} title="Key Performance Metrics" />
          <div className="mt-3 space-y-3">
            {kpm.map((m) => <div key={m.label} className="flex items-center gap-2.5 text-[13.5px]"><m.Icon className="h-4 w-4 text-[#5B3FD9]" /><span className="w-[190px] shrink-0">{m.label}</span><span className="flex-1"><Bar pct={m.pct} /></span><b className="w-20 text-right">{m.value}</b></div>)}
          </div>
        </Card>
      </div>
      <Card id="sl-team-detail" className="p-4">
        <CardTitle icon={BarChart2} title="Individual Performance (Detailed)" right={
          <span className="flex flex-wrap items-center gap-1.5">
            {([["summary", "Summary"], ["products", "Products"], ["source", "Source (FB/IG)"], ["follow", "Follow-ups"], ["response", "Response Time"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setDetailTab(k)} className={`!min-h-0 rounded-xl px-3.5 py-2 text-[13px] font-semibold ${detailTab === k ? "bg-[#5B3FD9] text-white" : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-200"}`}>{label}</button>
            ))}
            <button type="button" aria-label="Full screen" onClick={() => setExpanded(true)} className={`${btn.icon} !h-9 !w-9`}><Expand className="h-4 w-4" /></button>
          </span>
        } />
        <div className="mt-3 overflow-x-auto">{detail}</div>
      </Card>
      {expanded && <Modal title="Individual Performance (Detailed)" onClose={() => setExpanded(false)} width="max-w-[1300px]"><div className="overflow-x-auto">{detail}</div></Modal>}
      {rep && <RepModal r={rep} onClose={() => setRep(null)} />}
    </div>
  );
}

function RepCell({ r }: { r: SlRep }) {
  return <span className="flex items-center gap-2"><Avatar name={r.name} src={r.avatar} size={30} /><b className="whitespace-nowrap">{r.name}</b></span>;
}
function RepActions({ r, onOpen }: { r: SlRep; onOpen: () => void }) {
  return <span className="flex items-center gap-1"><button type="button" aria-label={`View ${r.name}`} onClick={onOpen} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B3FD9] hover:bg-[#F1EEFD]"><Eye className="h-[18px] w-[18px]" /></button><button type="button" aria-label="Chart" onClick={onOpen} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B3FD9] hover:bg-[#F1EEFD]"><BarChart2 className="h-[18px] w-[18px]" /></button><button type="button" aria-label="More" onClick={onOpen} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><MoreHorizontal className="h-[18px] w-[18px]" /></button></span>;
}
function RepModal({ r, onClose }: { r: SlRep; onClose: () => void }) {
  const items: Array<[string, string]> = [["Assigned", String(r.assigned)], ["Engaged", String(r.engaged)], ["Qualified", String(r.qualified)], ["Orders", String(r.orders)], ["Delivered", String(r.delivered)], ["Delivery rate", r.deliveryRate !== null ? `${r.deliveryRate}%` : "—"], ["Conversion", r.conversion !== null ? `${r.conversion}%` : "—"], ["AOV", money(r.aov)], ["Upsells", `${r.upsells} (${r.upsellRate ?? 0}%)`], ["Revenue", money(r.revenue)], ["Avg. first response", duration(r.avgResponseSeconds)], ["Open now", String(r.open)], ["Late replies now", String(r.overdue)], ["Follow-ups done", String(r.followUps.done)], ["Follow-ups overdue", String(r.followUps.overdue)], ["Lost", String(r.lost)]];
  return (
    <Modal title={r.name} sub="Social leads only, for the dates picked." icon={Medal} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{items.map(([k, v]) => <div key={k} className="rounded-xl border border-gray-200 p-2.5 dark:border-slate-700"><span className="block text-[11.5px] text-gray-500">{k}</span><b className="text-[15px]">{v}</b></div>)}</div>
      {r.products.length > 0 && <p className="m-0 mt-3 text-[13px]"><b>Top products:</b> {r.products.map((p) => `${p.name} (${p.count})`).join(" · ")}</p>}
      <p className="m-0 mt-2 flex gap-2 text-[13px]"><Pill tone="blue">Facebook {r.sources.facebook}</Pill><Pill tone="red">Instagram {r.sources.instagram}</Pill><Pill tone="purple">Messenger {r.sources.messenger}</Pill></p>
    </Modal>
  );
}
