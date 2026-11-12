import { useState } from "react";
import { ArrowRight, BarChart3, CheckCircle2, Download, MapPin, Package, Megaphone, Target, TrendingUp, Truck, Banknote, Star, Users } from "lucide-react";
import { Bar, Card, CardTitle, ChangeLine, Empty, Modal, ProductThumb, RateChip, btn, downloadCsv, money } from "./sl-ui";
import { KpiRow, useStats } from "./sl-data";
import { DEFAULT_FILTERS, FilterBar, FunnelCard, SourcesCard, TrendCard, paramsOf, type StatFilters } from "./OverviewTab";
import type { Shared } from "./SocialLeadsPage";

const th = "whitespace-nowrap px-2.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400";
const row = "border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:px-2.5 [&>td]:py-2.5 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200";
const INSIGHT_ICONS = [TrendingUp, Truck, Banknote, Target, Star, Users];

export default function AnalyticsTab({ shared }: { shared: Shared }) {
  const [filters, setFilters] = useState<StatFilters>(DEFAULT_FILTERS);
  const [allCampaigns, setAllCampaigns] = useState(false);
  const stats = useStats(paramsOf(filters));
  const s = stats.data, c = s?.cards;
  const products = s?.products ?? [];
  const topProducts = products.slice(0, 3);
  const otherLeads = products.slice(3).reduce((n, p) => n + p.leads, 0);
  const total = Number(c?.total.value ?? 0);
  const exportCsv = () => {
    if (!s) return;
    downloadCsv(`social-leads-analytics-${new Date().toISOString().slice(0, 10)}.csv`, ["Section", "Name", "Leads", "Engaged", "Orders", "Delivered", "Revenue", "Conversion %"], [
      ...products.map((p) => ["Product", p.name, p.leads, p.engaged, p.orders, p.delivered, p.revenue, p.conversion]),
      ...s.campaigns.map((x) => ["Campaign", x.name, x.leads, x.engaged, x.orders, x.delivered, x.revenue, x.conversion]),
      ...s.states.map((x) => ["State", x.state, x.count, "", "", "", "", ""]),
      ...s.days.map((d) => ["Day", d.day, d.leads, d.engaged, d.orders, d.delivered, "", ""])
    ]);
  };
  const metric = (label: string, value: string, change: number | null | undefined, unit = "pp") => (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
      <span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{label}</span>
      <b className="block text-[22px] font-extrabold text-gray-900 dark:text-slate-50">{value}</b>
      <ChangeLine change={change ?? null} unit={unit} />
    </div>
  );
  const campaignTable = (list: NonNullable<typeof s>["campaigns"]) => (
    <table className="!min-w-0 w-full border-collapse">
      <thead><tr>{["Campaign", "Leads", "Engaged", "Orders", "Delivered", "Revenue", "Conversion"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
      <tbody>
        {!list.length && <tr><td colSpan={7}><Empty>No campaign names yet. They come from ManyChat (add &campaign= to the request address, or a "campaign" field).</Empty></td></tr>}
        {list.map((x) => <tr key={x.name} className={row}><td><span className="flex items-center gap-2"><ProductThumb src={x.image} name={x.name} size={30} /><b>{x.name}</b></span></td><td>{x.leads}</td><td>{x.engaged}</td><td>{x.orders}</td><td>{x.delivered}</td><td className="font-semibold">{money(x.revenue)}</td><td><RateChip value={x.conversion} /></td></tr>)}
      </tbody>
    </table>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="m-0 text-[24px] font-extrabold text-gray-900 dark:text-slate-50">Analytics</h2>
          <p className="m-0 text-[14px] text-gray-600 dark:text-slate-400">Deep insights into your social leads, conversions, team performance and revenue.</p>
        </div>
        <FilterBar shared={shared} filters={filters} setFilters={setFilters} stats={s} show={{ source: true, product: true }} extra={<button type="button" onClick={exportCsv} className={btn.ghost}><Download className="h-4 w-4" />Export</button>} />
      </div>
      <KpiRow stats={s} first="total" labelOnTop />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FunnelCard stats={s} />
        <TrendCard stats={s} series="leads" />
        <SourcesCard stats={s} withOther />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <CardTitle icon={Target} title="Conversion Metrics" />
          <div className="mt-3 grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {metric("Lead → Order", c?.conversion.value !== null && c ? `${c.conversion.value}%` : "—", c?.conversion.change)}
            {metric("Order → Delivery", c?.deliveryRate.value !== null && c ? `${c.deliveryRate.value}%` : "—", c?.deliveryRate.change)}
            {metric("Avg. Order Value", money(c?.aov.value), c?.aov.change, "%")}
            {metric("Upsell / Cross-sell", c?.upsellRate.value !== null && c ? `${c.upsellRate.value}%` : "—", c?.upsellRate.change)}
          </div>
        </Card>
        <Card className="p-4">
          <CardTitle icon={Package} title="Leads by Product" />
          <div className="mt-3 space-y-3">
            {!products.length && <Empty>No leads yet.</Empty>}
            {topProducts.map((p, i) => <div key={p.name} className="flex items-center gap-2.5 text-[13.5px]"><ProductThumb src={p.image} name={p.name} size={26} /><span className="w-[140px] shrink-0 truncate font-medium">{p.name}</span><span className="flex-1"><Bar pct={p.pct} color={["#6E3FF3", "#8B7CF6", "#A99BF8"][i]} /></span><span className="w-12 text-right text-gray-600">{p.pct ?? 0}%</span><b className="w-10 text-right">{p.leads}</b></div>)}
            {otherLeads > 0 && <div className="flex items-center gap-2.5 text-[13.5px]"><span className="inline-flex h-[26px] w-[26px] items-center justify-center"><span className="h-3 w-3 rounded-full bg-violet-200" /></span><span className="w-[140px] shrink-0">Others</span><span className="flex-1"><Bar pct={(otherLeads / Math.max(1, total)) * 100} color="#DDD6FE" /></span><span className="w-12 text-right text-gray-600">{Math.round((otherLeads / Math.max(1, total)) * 1000) / 10}%</span><b className="w-10 text-right">{otherLeads}</b></div>}
          </div>
        </Card>
        <Card className="p-4">
          <CardTitle icon={MapPin} title="Leads by State (Top 5)" />
          <div className="mt-3 space-y-3">
            {!(s?.states ?? []).length && <Empty>No states yet: they come from the customer's messages, their order, or the rep.</Empty>}
            {(s?.states ?? []).map((x) => <div key={x.state} className="flex items-center gap-2.5 text-[13.5px]"><span className="w-[110px] shrink-0 font-medium">{x.state}</span><span className="flex-1"><Bar pct={x.pct} /></span><span className="w-12 text-right text-gray-600">{x.pct ?? 0}%</span><b className="w-10 text-right">{x.count}</b></div>)}
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-4">
          <CardTitle icon={Megaphone} title="Performance by Campaign" right={<button type="button" onClick={() => setAllCampaigns(true)} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2F5BEA] underline">View All Campaigns<ArrowRight className="h-4 w-4" /></button>} />
          <div className="mt-2 overflow-x-auto">{campaignTable((s?.campaigns ?? []).slice(0, 4))}</div>
        </Card>
        <section className="rounded-2xl border border-violet-100 bg-[#F7F5FF] p-4 dark:border-violet-500/20 dark:bg-violet-500/10">
          <CardTitle icon={BarChart3} title="Key Insights" />
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
            {!(s?.insights ?? []).length && <li className="text-[13.5px] text-gray-600">Insights appear once leads come in.</li>}
            {(s?.insights ?? []).map((line, i) => { const Icon = INSIGHT_ICONS[i] ?? CheckCircle2; return <li key={line} className="flex items-start gap-2.5 text-[13.5px] text-gray-800 dark:text-slate-200"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" />{line}</li>; })}
          </ul>
        </section>
      </div>
      {allCampaigns && <Modal title="All Campaigns" onClose={() => setAllCampaigns(false)} width="max-w-[1000px]"><div className="overflow-x-auto">{campaignTable(s?.campaigns ?? [])}</div></Modal>}
    </div>
  );
}

