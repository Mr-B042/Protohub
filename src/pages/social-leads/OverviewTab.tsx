import { useState } from "react";
import { ArrowRight, CalendarDays, CheckCircle2, CircleCheckBig, Flame, Hourglass, Info, LineChart as TrendIcon, MessagesSquare, Package, PieChart as PieIcon, RefreshCw, Sparkles, Target, Users, Zap, Filter as FunnelIcon, ListChecks, MessageSquareText, UserCheck } from "lucide-react";
import { FacebookIcon, InstagramIcon, MessengerIcon } from "../../components/SocialIcons";
import type { SlStats } from "../../lib/api";
import { Avatar, Bar, CHART, Card, CardTitle, DateRange, Donut, Funnel, Pill, ProductThumb, RateChip, Select, TrendChart, btn, dayLabel, money } from "./sl-ui";
import { KpiRow, useStats } from "./sl-data";
import type { Shared } from "./SocialLeadsPage";

export type StatFilters = { range: string; from?: string; to?: string; source: string; product: string; rep: string };
export const DEFAULT_FILTERS: StatFilters = { range: "7d", source: "all", product: "all", rep: "all" };

export function FilterBar({ shared, filters, setFilters, stats, onRefresh, show = { source: true, product: true, rep: true }, extra }: {
  shared: Shared; filters: StatFilters; setFilters: (f: StatFilters) => void; stats: SlStats | null; onRefresh?: () => void; show?: { source?: boolean; product?: boolean; rep?: boolean }; extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <DateRange range={filters.range} from={stats?.filters.from} to={stats?.filters.to} onChange={(r) => setFilters({ ...filters, range: r.range, from: r.from, to: r.to })} />
      <span className="hidden flex-1 md:block" />
      {show.source && <Select label="Source" className="w-[190px]" value={filters.source} onChange={(v) => setFilters({ ...filters, source: v })} options={[{ value: "all", label: "All Sources" }, { value: "facebook", label: "Facebook" }, { value: "instagram", label: "Instagram" }, { value: "messenger", label: "Messenger" }]} />}
      {show.product && <Select label="Product" className="w-[190px]" value={filters.product} onChange={(v) => setFilters({ ...filters, product: v })} options={[{ value: "all", label: "All Products" }, ...shared.products.map((p) => ({ value: p.id, label: p.name }))]} />}
      {show.rep && shared.leadership && <Select label="Call rep" className="w-[190px]" value={filters.rep} onChange={(v) => setFilters({ ...filters, rep: v })} options={[{ value: "all", label: "All Call Reps" }, { value: "none", label: "Unassigned" }, ...shared.reps.filter((r) => r.role === "Sales Rep").map((r) => ({ value: r.id, label: r.name }))]} />}
      {extra}
      {onRefresh && <button type="button" aria-label="Refresh" onClick={onRefresh} className={btn.icon}><RefreshCw className="h-[18px] w-[18px]" /></button>}
    </div>
  );
}

export const paramsOf = (f: StatFilters) => ({ range: f.range, from: f.from, to: f.to, source: f.source, product: f.product, rep: f.rep });

export function FunnelCard({ stats, title = "Lead Conversion Funnel", team }: { stats: SlStats | null; title?: string; team?: boolean }) {
  const f = stats?.funnel;
  const steps = team
    ? [{ label: "Assigned Leads", value: f?.assigned ?? 0, color: "#6E3FF3" }, { label: "Qualified Leads", value: f?.qualified ?? 0, color: "#7B6CF6" }, { label: "Orders Created", value: f?.orders ?? 0, color: "#3B82F6" }, { label: "Delivered Orders", value: f?.delivered ?? 0, color: "#22C55E" }]
    : [{ label: "Comments Captured", value: f?.captured ?? 0, color: "#6E3FF3" }, { label: "Engaged Leads", value: f?.engaged ?? 0, color: "#8B7CF6" }, { label: "Qualified Leads", value: f?.qualified ?? 0, color: "#4F7DF3" }, { label: "Orders Created", value: f?.orders ?? 0, color: "#22C1C3" }, { label: "Delivered Orders", value: f?.delivered ?? 0, color: "#22C55E" }];
  return (
    <Card className="p-4">
      <CardTitle icon={FunnelIcon} title={<span className="inline-flex items-center gap-1.5">{title}<Info className="h-4 w-4 text-gray-400" /></span>}
        right={!team && <Pill tone="purple">Conversion Rate: {stats?.cards.conversion.value ?? "—"}{stats?.cards.conversion.value !== null && stats ? "%" : ""}</Pill>} />
      <div className="mt-4"><Funnel steps={steps} /></div>
    </Card>
  );
}

export function TrendCard({ stats, title = "Leads & Orders Trend", series = "engaged" }: { stats: SlStats | null; title?: string; series?: "engaged" | "leads" | "orders" }) {
  const data = (stats?.days ?? []).map((d) => ({ ...d, label: dayLabel(d.day) }));
  const lines = series === "orders"
    ? [{ key: "orders", label: "Orders Created", color: CHART.purple, fill: true }, { key: "delivered", label: "Delivered Orders", color: CHART.green }]
    : [{ key: series === "leads" ? "leads" : "engaged", label: series === "leads" ? "Leads" : "Engaged Leads", color: CHART.purple, fill: true }, { key: "orders", label: series === "leads" ? "Orders" : "Orders Created", color: CHART.blue }, { key: "delivered", label: series === "leads" ? "Delivered" : "Delivered Orders", color: CHART.green }];
  return (
    <Card className="p-4">
      <CardTitle icon={TrendIcon} title={title} />
      <div className="mt-2">{data.length ? <TrendChart data={data} series={lines} /> : <p className="py-16 text-center text-[13px] text-gray-500">No leads in these dates.</p>}</div>
    </Card>
  );
}

export function SourcesCard({ stats, withOther }: { stats: SlStats | null; withOther?: boolean }) {
  const total = stats?.cards.total.value ?? 0;
  const by = (k: string) => stats?.sources.find((s) => s.key === k)?.count ?? 0;
  const rows = [
    { key: "facebook", label: "Facebook", value: by("facebook"), color: CHART.blue, Icon: FacebookIcon },
    { key: "instagram", label: "Instagram", value: by("instagram"), color: "#F0457A", Icon: InstagramIcon },
    { key: "messenger", label: "Messenger", value: by("messenger"), color: "#A06CF7", Icon: MessengerIcon }
  ];
  const other = Math.max(0, Number(total) - rows.reduce((s, r) => s + r.value, 0));
  return (
    <Card className="p-4">
      <CardTitle icon={PieIcon} title="Leads by Source" />
      <div className="mt-3 flex flex-wrap items-center justify-center gap-5">
        <Donut data={[...rows, ...(withOther ? [{ key: "other", label: "Other", value: other, color: CHART.slate }] : [])].map((r) => ({ label: r.label, value: r.value, color: r.color }))} center={Number(total).toLocaleString()} sub="Total Leads" />
        <div className="min-w-[180px] flex-1 space-y-3.5">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center gap-2 text-[14px]">
              <r.Icon className="h-5 w-5" /><span className="flex-1 text-gray-800 dark:text-slate-200">{r.label}</span>
              <span className="w-14 text-right text-gray-600">{total ? `${Math.round((r.value / Number(total)) * 1000) / 10}%` : "—"}</span><b className="w-12 text-right">{r.value.toLocaleString()}</b>
            </div>
          ))}
          {withOther && <div className="flex items-center gap-2 text-[14px]"><span className="h-4 w-4 rounded-full bg-slate-300" /><span className="flex-1">Other</span><span className="w-14 text-right text-gray-600">{total ? `${Math.round((other / Number(total)) * 1000) / 10}%` : "—"}</span><b className="w-12 text-right">{other}</b></div>}
        </div>
      </div>
    </Card>
  );
}

const th = "px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400";
const td = "[&>td]:px-2 [&>td]:py-2.5 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200";

export default function OverviewTab({ shared }: { shared: Shared }) {
  const [filters, setFilters] = useState<StatFilters>(DEFAULT_FILTERS);
  const stats = useStats(paramsOf(filters));
  const s = stats.data;
  const top = (s?.products ?? []).slice(0, 3);
  const others = (s?.products ?? []).slice(3);
  const otherRow = others.length ? others.reduce((a, p) => ({ leads: a.leads + p.leads, orders: a.orders + p.orders, delivered: a.delivered + p.delivered, revenue: a.revenue + p.revenue }), { leads: 0, orders: 0, delivered: 0, revenue: 0 }) : null;
  const total = s?.cards.total.value ?? 0;
  const statusIcons: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string; tile: string }> = {
    in_conversation: { Icon: MessagesSquare, color: "#6E3FF3", tile: "bg-violet-50 text-violet-600" },
    awaiting_customer: { Icon: Hourglass, color: "#3B82F6", tile: "bg-sky-50 text-sky-600" },
    follow_up_due: { Icon: CalendarDays, color: "#F5A524", tile: "bg-amber-50 text-amber-600" },
    hot: { Icon: Flame, color: "#EF4444", tile: "bg-rose-50 text-rose-500" },
    converted: { Icon: CircleCheckBig, color: "#22C55E", tile: "bg-emerald-50 text-emerald-600" }
  };
  return (
    <div className="space-y-4">
      <FilterBar shared={shared} filters={filters} setFilters={setFilters} stats={s} onRefresh={stats.reload} />
      {stats.error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{stats.error}</p>}
      <KpiRow stats={s} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FunnelCard stats={s} />
        <TrendCard stats={s} />
        <SourcesCard stats={s} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <CardTitle icon={Package} title="Top Performing Products" />
          <div className="mt-2 overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead><tr><th className={th}>Product</th><th className={`${th} text-right`}>Leads</th><th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>Delivered</th><th className={`${th} text-right`}>Revenue</th></tr></thead>
              <tbody>
                {top.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[13px] text-gray-500">No leads yet.</td></tr>}
                {top.map((p) => (
                  <tr key={p.name} className={td}>
                    <td><span className="flex items-center gap-2"><ProductThumb src={p.image} name={p.name} size={30} /><b className="text-[13px]">{p.name}</b></span></td>
                    <td className="text-right">{p.leads}</td><td className="text-right">{p.orders}</td><td className="text-right">{p.delivered}</td><td className="text-right font-semibold">{money(p.revenue)}</td>
                  </tr>
                ))}
                {otherRow && <tr className={td}><td><span className="flex items-center gap-2"><span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-slate-800">…</span>Others</span></td><td className="text-right">{otherRow.leads}</td><td className="text-right">{otherRow.orders}</td><td className="text-right">{otherRow.delivered}</td><td className="text-right font-semibold">{money(otherRow.revenue)}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="p-4">
          <CardTitle icon={Users} title="Call Rep Performance (Social Leads)" right={shared.leadership && <button type="button" onClick={() => shared.goTab("team")} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2F5BEA] underline">View Team<ArrowRight className="h-4 w-4" /></button>} />
          <div className="mt-2 overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead><tr><th className={th}>Rep</th><th className={`${th} text-right`}>Assigned</th><th className={`${th} text-right`}>Orders</th><th className={`${th} text-right`}>Delivered</th><th className={`${th} text-right`}>Conversion</th></tr></thead>
              <tbody>
                {(s?.reps ?? []).length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[13px] text-gray-500">No lead has been given to a rep yet.</td></tr>}
                {(s?.reps ?? []).slice(0, 5).map((r) => (
                  <tr key={r.id} className={td}>
                    <td><span className="flex items-center gap-2"><Avatar name={r.name} src={r.avatar} size={28} /><b>{r.name}</b></span></td>
                    <td className="text-right">{r.assigned}</td><td className="text-right">{r.orders}</td><td className="text-right">{r.delivered}</td><td className="text-right"><RateChip value={r.conversion} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="p-4">
          <CardTitle icon={ListChecks} title="Lead Status Breakdown" />
          <div className="mt-3 space-y-3">
            {(s?.statusBreakdown ?? []).map((row) => {
              const look = statusIcons[row.key];
              return (
                <div key={row.key} className="flex items-center gap-2.5 text-[13.5px]">
                  <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full dark:bg-slate-800 ${look.tile}`}><look.Icon className="h-4 w-4" /></span>
                  <span className="w-[140px] shrink-0 text-gray-800 dark:text-slate-200">{row.label}</span>
                  <span className="flex-1"><Bar pct={total ? (row.count / Number(total)) * 100 : 0} color={look.color} /></span>
                  <b className="w-10 text-right">{row.count}</b><span className="w-12 text-right text-gray-500">{row.pct ?? 0}%</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
          <div className="flex items-start gap-3">
            <Target className="mt-0.5 h-8 w-8 shrink-0 text-emerald-600" />
            <div>
              <b className="text-[16px] text-gray-900 dark:text-slate-50">Key Insights <span className="font-medium">({s ? (filters.range === "all" ? "all time" : filters.range === "custom" ? "these dates" : filters.range === "today" ? "today" : `last ${s.filters.days} days`) : "…"})</span></b>
              <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                {(s?.insights ?? []).length === 0 && <li className="text-[13.5px] text-gray-600">Insights appear once leads come in.</li>}
                {(s?.insights ?? []).slice(0, 4).map((line) => <li key={line} className="flex items-start gap-2 text-[13.5px] text-gray-800 dark:text-slate-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />{line}</li>)}
              </ul>
            </div>
          </div>
        </section>
        <Card className="p-4">
          <CardTitle icon={Zap} title="Next Actions" />
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              { Icon: MessageSquareText, text: <>Reply to <b>{s?.nextActions.unread ?? 0}</b> unread conversations</>, go: () => shared.goTab("inbox") },
              { Icon: CalendarDays, text: <>Follow up with <b>{s?.nextActions.pendingFollowUps ?? 0}</b> pending leads</>, go: () => shared.goTab("follow-ups") },
              { Icon: UserCheck, text: <>Convert <b>{s?.nextActions.hotLeads ?? 0}</b> hot leads</>, go: () => shared.goTab("inbox") }
            ].map((a, i) => (
              <button key={i} type="button" onClick={a.go} className="!min-h-0 flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left text-[13.5px] text-gray-800 shadow-sm hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F1EEFD] text-[#5B3FD9]"><a.Icon className="h-5 w-5" /></span>
                <span className="flex-1">{a.text}</span><ArrowRight className="h-4 w-4 shrink-0 text-gray-400" />
              </button>
            ))}
          </div>
        </Card>
      </div>
      <p className="m-0 flex items-center gap-1.5 text-[12px] text-gray-500"><Sparkles className="h-3.5 w-3.5" />Counted from the leads created in the dates picked; delivered and revenue follow those leads' orders.</p>
    </div>
  );
}
