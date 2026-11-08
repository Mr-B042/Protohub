import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRight, BarChart3, CalendarDays, CalendarClock, Cake, ChevronRight, Coins, Crown, FileText, Image as ImageIcon, Layers, Mail, MoreHorizontal, RefreshCw, Send,
  ShieldCheck, ShoppingCart, Sparkles, UserPlus, Users, Zap
} from "lucide-react";
import type { EmCampaign, EmOverview } from "../../lib/api";
import {
  Card, Delta, GOAL_TYPES, IconTile, KpiCard, Pill, STATUS_LOOK, SegmentIcon, Thumb, count, lagosDate, lagosTime, naira, pct, rate, type EmSection
} from "./em-ui";

/** Overview tab, built to Bright's design (image 43, 8 Nov 2026). */

const CHIPS: Array<{ key: string; label: string; goals: string[] }> = [
  { key: "all", label: "All", goals: [] },
  { key: "promotions", label: "Promotions", goals: ["promotion"] },
  { key: "retention", label: "Retention", goals: ["retention", "winback", "appreciation"] },
  { key: "upsell", label: "Upsell/Cross-sell", goals: ["upsell"] },
  { key: "launch", label: "Product Launch", goals: ["launch"] },
  { key: "announcements", label: "Announcements", goals: ["announcement"] }
];

const SEGMENT_TONE: Record<string, string> = {
  all: "text-[#5B3FD9]", repeat: "text-emerald-600", high_value: "text-amber-500", inactive30: "text-rose-500", new7: "text-sky-600"
};

const FLOW_LOOK: Record<string, { icon: typeof Mail; tone: string }> = {
  post_purchase: { icon: ShoppingCart, tone: "text-[#5B3FD9]" },
  cart_abandonment: { icon: Mail, tone: "text-[#5B3FD9]" },
  win_back: { icon: RefreshCw, tone: "text-[#5B3FD9]" },
  vip_loyalty: { icon: Crown, tone: "text-amber-500" },
  birthday: { icon: Cake, tone: "text-[#5B3FD9]" }
};

export function CampaignRows({ rows, onOpen }: { rows: EmCampaign[]; onOpen: (row: EmCampaign) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="!min-w-0 w-full min-w-[720px] text-left text-[12.5px]">
        <thead>
          <tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
            <th className="px-4 py-2.5">Campaign</th><th className="px-2 py-2.5">Type</th><th className="px-2 py-2.5">Audience</th><th className="px-2 py-2.5 text-right">Sent</th>
            <th className="whitespace-nowrap px-2 py-2.5 text-right">Open Rate</th><th className="whitespace-nowrap px-2 py-2.5 text-right">Click Rate</th><th className="px-2 py-2.5 text-right">Conversion</th>
            <th className="px-2 py-2.5 text-right">Revenue</th><th className="px-2 py-2.5">Status</th><th className="px-2 py-2.5" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const type = GOAL_TYPES[row.goal] ?? GOAL_TYPES.retention;
            const status = STATUS_LOOK[row.status] ?? STATUS_LOOK.draft;
            const s = row.stats;
            return (
              <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                <td className="px-4 py-2.5">
                  <button type="button" onClick={() => onOpen(row)} className="!min-h-0 flex items-center gap-3 text-left">
                    <Thumb src={row.thumbnailUrl} goal={row.goal} size={48} />
                    <span className="min-w-0">
                      <span className="block max-w-[150px] truncate font-bold text-gray-900 dark:text-slate-50" title={row.name}>{row.name}</span>
                      <span className="block text-[12px] text-gray-500">{lagosDate(s.lastSentAt ?? row.sendAt ?? row.createdAt, true)}</span>
                    </span>
                  </button>
                </td>
                <td className="px-2 py-2.5"><Pill tone={type.tone}>{type.label}</Pill></td>
                <td className="max-w-[120px] truncate px-2 py-2.5" title={row.audienceLabel}>{row.audienceLabel ?? "—"}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{count(s.sent)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{pct(rate(s.opened, s.sent))}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{pct(rate(s.clicked, s.sent))}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{pct(rate(s.orders, s.sent))}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-bold tabular-nums">{naira(s.revenue)}</td>
                <td className="px-2 py-2.5"><Pill tone={status.tone}>{status.label}</Pill></td>
                <td className="px-2 py-2.5"><button type="button" aria-label="Open" onClick={() => onOpen(row)} className="!min-h-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-4 w-4" /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TabOverview({ data, onNavigate, onCreate, onCreateAutomation, onOpenCampaign, onQuick }: {
  data: EmOverview;
  onNavigate: (section: EmSection) => void;
  onCreate: () => void;
  /** Opens Create New Automation on a template (Automations page, 8 Nov 2026). */
  onCreateAutomation: (template?: string) => void;
  onOpenCampaign: (row: EmCampaign) => void;
  onQuick: (action: "add-subscribers" | "create-segment") => void;
}) {
  const [chip, setChip] = useState("all");
  const k = data.kpis;
  const recent = useMemo(() => {
    const goals = CHIPS.find((row) => row.key === chip)?.goals ?? [];
    return goals.length ? data.recent.filter((row) => goals.includes(row.goal)) : data.recent;
  }, [chip, data.recent]);
  const funnel = [
    { label: "Total Customers", value: data.funnel.total, color: "bg-[#6D4AFF]" },
    { label: "Engaged (Opened/Clicked)", value: data.funnel.engaged, color: "bg-[#5B8DEF]" },
    { label: "Repeat Purchase", value: data.funnel.repeat, color: "bg-[#2EB872]" },
    { label: "High-Value (Top 20%)", value: data.funnel.highValue, color: "bg-[#F5B000]" }
  ];
  const quick: Array<{ label: string; icon: typeof Send; run: () => void }> = [
    { label: "Create Campaign", icon: Send, run: () => onCreate() },
    { label: "Build Automation", icon: Zap, run: () => onCreateAutomation("post_purchase") },
    { label: "Add Subscribers", icon: UserPlus, run: () => onQuick("add-subscribers") },
    { label: "Create Segment", icon: Layers, run: () => onQuick("create-segment") },
    { label: "Design Template", icon: ImageIcon, run: () => onNavigate("templates") },
    { label: "Create Sign-up Form", icon: FileText, run: () => onNavigate("forms") }
  ];
  const ltvMax = Math.max(1, ...data.trend.map((row) => row.ltv));
  const retentionMax = Math.max(1, ...data.trend.map((row) => row.retention));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard icon={Send} value={count(k.subscribers.value)} label="Total Subscribers"><Delta value={k.subscribers.change} note="New list" /><span className="text-[11px] text-gray-500">(30 days)</span></KpiCard>
        <KpiCard icon={Users} value={count(k.activeCustomers.value)} label="Active Customers"><Delta value={k.activeCustomers.change} /></KpiCard>
        <KpiCard icon={ShoppingCart} value={count(k.repeatCustomers.value)} label="Repeat Customers"><Delta value={k.repeatCustomers.change} note="vs 30 days ago" /></KpiCard>
        <KpiCard icon={RefreshCw} value={`${k.frequency.value.toFixed(2)}x`} label="Purchase Frequency">
          <span className="inline-flex whitespace-nowrap rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">vs {k.frequency.before.toFixed(2)}x</span><span className="text-[11px] text-gray-500">(30 days ago)</span>
        </KpiCard>
        <KpiCard icon={Coins} value={naira(k.ltv.value)} label="Customer LTV (Avg)"><Delta value={k.ltv.change} /></KpiCard>
        <KpiCard icon={ShieldCheck} tone="green" value={pct(k.retention.value)} label="Retention Rate"><Delta value={k.retention.changePp} suffix="pp" /></KpiCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <Card className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Customer Retention &amp; LTV Trend</h3>
                <div className="flex items-center gap-4 text-[12.5px] text-gray-600 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#6D4AFF]" />LTV (₦)</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#2F6BFF]" />Retention Rate</span>
                </div>
              </div>
              <div className="mt-3 h-[210px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.trend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="emLtvFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8B6CF2" stopOpacity={0.35} /><stop offset="100%" stopColor="#8B6CF2" stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="ltv" domain={[0, Math.ceil(ltvMax * 1.15)]} tickFormatter={(v: number) => `₦${v >= 1000 ? `${Math.round(v / 1000)}K` : v}`} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={48} />
                    <YAxis yAxisId="ret" orientation="right" domain={[0, Math.max(5, Math.ceil(retentionMax * 1.2))]} tickFormatter={(v: number) => `${v}%`} tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip formatter={(value: number, name: string) => (name === "ltv" ? [naira(value), "LTV"] : [`${value}%`, "Retention"])} labelFormatter={(label: string) => { const row = data.trend.find((item) => item.label === label); return row ? `${label} ${row.key.slice(0, 4)}` : label; }} />
                    <Area yAxisId="ltv" type="monotone" dataKey="ltv" stroke="#6D4AFF" strokeWidth={2.5} fill="url(#emLtvFill)" dot={{ r: 3.5, fill: "#fff", stroke: "#6D4AFF", strokeWidth: 2 }} />
                    <Line yAxisId="ret" type="monotone" dataKey="retention" stroke="#2F6BFF" strokeWidth={2.5} dot={{ r: 3.5, fill: "#fff", stroke: "#2F6BFF", strokeWidth: 2 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Quick Actions</h3>
              <div className="mt-3 grid grid-cols-3 gap-2.5">
                {quick.map(({ label, icon: Icon, run }) => (
                  <button key={label} type="button" onClick={run}
                    className="!min-h-0 flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-2 py-4 text-center text-[13px] font-bold text-gray-800 shadow-[0_1px_2px_rgba(16,24,40,0.04)] hover:border-[#C9BEF5] hover:bg-[#F8F6FF] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <Icon className="h-6 w-6 text-[#5B3FD9]" />{label}
                  </button>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card className="border-[#E4DDFB] bg-[#F7F4FF] p-5 dark:bg-slate-900">
              <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Automation Workflows <span className="font-semibold text-gray-600 dark:text-slate-400">(Retention Engine)</span></h3>
              <div className="mt-3 flex items-stretch gap-1 overflow-x-auto pb-1">
                {data.automations.map((flow, index) => {
                  const look = FLOW_LOOK[flow.key] ?? FLOW_LOOK.post_purchase;
                  const Icon = look.icon;
                  const pill = flow.state === "active" ? <Pill tone="green">Active</Pill> : flow.state === "paused" ? <Pill tone="slate">Paused</Pill> : <Pill tone="slate">Off</Pill>;
                  return (
                    <div key={flow.key} className="flex min-w-[78px] flex-1 items-center gap-1">
                      <button type="button" onClick={() => (flow.state === "off" ? onCreateAutomation(flow.key) : onNavigate("automations"))}
                        title={flow.state === "off" ? "Set it up" : "Open Automations"}
                        className="!min-h-0 flex h-full min-w-0 flex-1 flex-col items-center gap-1 rounded-xl border border-gray-200 bg-white px-1.5 py-3 text-center hover:border-[#C9BEF5] disabled:cursor-default dark:border-slate-700 dark:bg-slate-900">
                        <Icon className={`h-6 w-6 ${look.tone}`} />
                        <span className="text-[12.5px] font-bold leading-tight text-gray-900 dark:text-slate-50">{flow.name}</span>
                        <span className="text-[10.5px] leading-tight text-gray-500">{flow.hint}</span>
                        <span className="mt-auto pt-1">{pill}</span>
                      </button>
                      {index < data.automations.length - 1 && <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#5B3FD9]" />}
                    </div>
                  );
                })}
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Audience Segments</h3>
                <button type="button" onClick={() => onNavigate("audience")} className="!min-h-0 text-[13px] font-semibold text-[#5B3FD9] hover:underline">View All</button>
              </div>
              <ul className="m-0 mt-2 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
                {data.segments.map((segment) => (
                  <li key={segment.key}>
                    <button type="button" onClick={() => onNavigate("audience")} className="!min-h-0 flex w-full items-center gap-2.5 py-2 text-left text-[13.5px]" title={`${count(segment.customers)} customers match; ${count(segment.count)} have an email`}>
                      <SegmentIcon name={segment.icon} className={`h-4 w-4 ${SEGMENT_TONE[segment.key] ?? "text-[#5B3FD9]"}`} />
                      <span className="flex-1 text-gray-800 dark:text-slate-200">{segment.name}</span>
                      <span className="font-bold tabular-nums text-gray-900 dark:text-slate-50">{count(segment.count)}</span>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
              <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Recent Campaigns</h3>
              <button type="button" onClick={() => onNavigate("campaigns")} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#5B3FD9] hover:underline">View All Campaigns <ArrowRight className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex flex-wrap gap-2 px-5 py-3">
              {CHIPS.map((row) => (
                <button key={row.key} type="button" onClick={() => setChip(row.key)}
                  className={`!min-h-0 rounded-full border px-3.5 py-1 text-[12.5px] font-semibold ${chip === row.key ? "border-[#5B3FD9] bg-[#5B3FD9] text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>
                  {row.label}
                </button>
              ))}
            </div>
            {recent.length
              ? <CampaignRows rows={recent} onOpen={onOpenCampaign} />
              : (
                <div className="flex flex-col items-center gap-2 border-t border-gray-100 px-5 py-10 text-center dark:border-slate-800">
                  <Mail className="h-8 w-8 text-[#B9A8F5]" />
                  <p className="m-0 text-[14px] font-semibold text-gray-800 dark:text-slate-200">{data.recent.length ? "No campaigns of this type yet." : "No campaigns yet."}</p>
                  <button type="button" onClick={() => onCreate()} className="!min-h-0 text-[13px] font-semibold text-[#5B3FD9] hover:underline">Create your first campaign</button>
                </div>
              )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Customer Lifetime Value (LTV)</h3>
            <div className="mt-3 flex items-center gap-4">
              <div className="relative h-[112px] w-[112px] shrink-0">
                <svg viewBox="0 0 132 132" className="h-full w-full -rotate-90">
                  <defs><linearGradient id="emLtvRing" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#6D4AFF" /><stop offset="100%" stopColor="#22C55E" /></linearGradient></defs>
                  <circle cx="66" cy="66" r="56" fill="none" stroke="#EEEBFC" strokeWidth="12" />
                  <circle cx="66" cy="66" r="56" fill="none" stroke="url(#emLtvRing)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${2 * Math.PI * 56 * 0.86} ${2 * Math.PI * 56}`} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <span className="text-[16px] font-extrabold text-gray-900 dark:text-slate-50">{naira(data.ltv.value)}</span>
                  <span className="text-[12px] text-gray-600 dark:text-slate-400">Avg. LTV</span>
                  <Delta value={data.ltv.change} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="m-0 mb-2 text-[13.5px] font-bold text-gray-900 dark:text-slate-50">LTV Breakdown</p>
                {[
                  { icon: ShoppingCart, label: "Avg. Order Value", value: naira(data.ltv.aov) },
                  { icon: RefreshCw, label: "Purchase Frequency", value: `${data.ltv.frequency.toFixed(2)}x` },
                  { icon: CalendarDays, label: "Avg. Customer Age", value: `${data.ltv.ageMonths.toFixed(1)} months` }
                ].map(({ icon: Icon, label, value }) => (
                  <div key={label} className="flex items-center gap-2 py-1.5 text-[12px]">
                    <Icon className="h-4 w-4 shrink-0 text-[#5B3FD9]" />
                    <span className="flex-1 leading-tight text-gray-600 dark:text-slate-400">{label}</span>
                    <span className="whitespace-nowrap font-bold text-gray-900 dark:text-slate-50">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Retention Funnel</h3>
            <div className="mt-3 space-y-2">
              {funnel.map((step, index) => {
                const share = data.funnel.total ? (step.value / data.funnel.total) * 100 : 0;
                // A funnel shape, as in the design; the real counts and shares sit beside it.
                const width = [100, 94, 88, 82][index];
                return (
                  <div key={step.label} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1" style={{ paddingLeft: index * 4 }}>
                      <div className={`truncate rounded-md px-2 py-1.5 text-[11.5px] font-semibold text-white ${step.color}`} style={{ width: `${width}%` }} title={step.label}>{step.label}</div>
                    </div>
                    <span className="w-10 text-right text-[14px] font-bold tabular-nums text-gray-900 dark:text-slate-50">{count(step.value)}</span>
                    <span className="w-11 text-right text-[11.5px] tabular-nums text-gray-600 dark:text-slate-400">{pct(index === 0 ? (data.funnel.total ? 100 : null) : data.funnel.total ? share : null)}</span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Top Automation Workflows</h3>
              <button type="button" onClick={() => onNavigate("automations")} className="!min-h-0 text-[13px] font-semibold text-[#5B3FD9] hover:underline">View All</button>
            </div>
            <ul className="m-0 mt-2 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
              {(data.topAutomations.length ? data.topAutomations.map((row) => ({ key: row.id, name: row.name, sub: `${count(row.customers)} customers`, on: row.status === "active", run: () => onNavigate("automations"), trigger: row.trigger }))
                : [
                  { key: "post_purchase", name: "Post-Purchase Follow-Up", sub: "Not running yet", on: false, run: () => onCreateAutomation("post_purchase"), trigger: "order_delivered" },
                  { key: "win_back", name: "Win-Back (Inactive 60+ Days)", sub: "Not running yet", on: false, run: () => onCreateAutomation("win_back"), trigger: "inactive" },
                  { key: "cart_abandonment", name: "Abandoned Cart Recovery", sub: "Not running yet", on: false, run: () => onCreateAutomation("cart_abandonment"), trigger: "cart_abandoned" }
                ]).map((row) => {
                const Icon = row.trigger === "inactive" ? RefreshCw : row.trigger === "cart_abandoned" ? ShoppingCart : row.trigger === "order_placed" || row.trigger === "new_subscriber" ? Sparkles : ShoppingCart;
                return (
                  <li key={row.key}>
                    <button type="button" onClick={row.run} className="!min-h-0 flex w-full items-center gap-3 py-2.5 text-left">
                      <IconTile size="sm"><Icon className="h-4 w-4" /></IconTile>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{row.name}</span>
                        <span className="block text-[12px] text-gray-500">{row.sub}</span>
                      </span>
                      {row.on ? <Pill tone="green">Active</Pill> : <Pill tone="slate">Off</Pill>}
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card className="p-5">
            <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><CalendarClock className="h-5 w-5 text-[#5B3FD9]" />Next Scheduled (Today)</h3>
            {data.scheduledToday.length ? (
              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                {data.scheduledToday.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 dark:border-slate-800">
                    <span className="w-[72px] shrink-0 text-[14px] font-bold text-gray-900 dark:text-slate-50">{lagosTime(row.at)}</span>
                    <span className="min-w-0 flex-1 text-[13px] text-gray-800 dark:text-slate-200"><span className="block truncate font-semibold">{row.name}</span><span className="block truncate text-[12px] text-gray-500">({row.audienceLabel})</span></span>
                    <Pill tone="amber">Scheduled</Pill>
                  </li>
                ))}
              </ul>
            ) : <p className="m-0 mt-3 text-[13px] text-gray-500">Nothing is scheduled for today.</p>}
          </Card>

          <p className="m-0 flex items-start gap-2 px-1 text-[11.5px] leading-snug text-gray-500"><BarChart3 className="mt-0.5 h-3.5 w-3.5 shrink-0" />A purchase is a delivered order. Customers are counted by phone number; the list counts emails.</p>
        </div>
      </div>
    </div>
  );
}
