import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, ArrowRight, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, Link2, Monitor, Plus, Server, ShoppingCart, XCircle } from "lucide-react";
import { trackingHubApi, type HubIssue, type HubOverview } from "../../lib/api";
import {
  ActionMenu, Card, CheckDot, DateRangeButton, LEDGER_TONE, PlatformIcon, SiteIcon, StatusPill, ago, compareWord, daysBetween, naira, nf, shift, shortDay, sourceTone, timeOf,
  type HubTab, type Range, type Toast
} from "./HubParts";

// Tracking Hub Overview (Bright's first image, 2 Oct 2026).

const pctChange = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : now > 0 ? 100 : 0);
const lightButton = "!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
const darkButton = "!min-h-0 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-[13px] font-bold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900";

// ---------------------------------------------------------------- overview

function KpiCard({ icon: Icon, tone, label, value, delta, sub }: { icon: typeof Monitor; tone: string; label: string; value: string; delta?: number | null; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-4 dark:border-slate-800 dark:bg-slate-900">
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tone}`}><Icon className="h-6 w-6" /></span>
      <div className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-tight text-gray-600 dark:text-slate-400">{label}</span>
        <div className="mt-1.5 flex items-center gap-2">
          <strong className="text-[24px] font-black leading-none text-gray-900 dark:text-slate-50">{value}</strong>
          <span className="min-w-0 leading-tight">
            {delta !== undefined && delta !== null ? <span className={`flex items-center gap-0.5 whitespace-nowrap text-[12px] font-bold ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}><ArrowUp className={`h-3 w-3 ${delta < 0 ? "rotate-180" : ""}`} />{Math.abs(delta)}%</span> : null}
            <span className="block whitespace-nowrap text-[10.5px] text-gray-400">{sub}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function HealthRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 90 ? "#16a34a" : score >= 70 ? "#f59e0b" : "#e11d48";
  return (
    <div className="relative h-[120px] w-[120px] shrink-0">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="12" />
        <circle cx="70" cy="70" r={radius} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(100, score) / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-[22px] font-black text-gray-900 dark:text-slate-50">{score.toFixed(1)}%</strong>
        <span className="text-[13px] font-bold" style={{ color }}>{score >= 90 ? "Healthy" : score >= 70 ? "Needs work" : "Unhealthy"}</span>
      </div>
    </div>
  );
}

const ISSUE_TONE: Record<HubIssue["severity"], string> = { red: "bg-rose-600", orange: "bg-orange-500", yellow: "bg-amber-400" };

export default function OverviewTab({ tabBar, range, onRange, onTab, onToast, onOpenLedger, onCreateLink }: {
  tabBar: ReactNode; range: Range; onRange: (range: Range) => void; onTab: (tab: HubTab) => void; onToast: Toast;
  onOpenLedger: (filter: { status?: string; orderIds?: string[] }) => void; onCreateLink: () => void;
}) {
  const [compare, setCompare] = useState<"previous" | "none">("previous");
  const length = daysBetween(range.from, range.to);
  const comparePeriod = { compareFrom: shift(range.from, -length), compareTo: shift(range.from, -1) };
  const compareLabel = compareWord(range);
  const [data, setData] = useState<HubOverview | null>(null);
  const [error, setError] = useState("");
  const [chartDays, setChartDays] = useState(7);
  useEffect(() => {
    let cancelled = false;
    setError("");
    trackingHubApi.overview({ ...range, ...comparePeriod, chartDays }).then((result) => { if (!cancelled) setData(result); }).catch((err: any) => { if (!cancelled) setError(err?.message ?? "Could not load the Tracking Hub."); });
    return () => { cancelled = true; };
  }, [range.from, range.to, chartDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="m-0 text-[28px] font-black tracking-tight text-gray-900 dark:text-slate-50">Tracking Hub</h1>
        <p className="m-0 mt-1 text-[15px] text-gray-500 dark:text-slate-400">Centralized tracking for all ads, websites, forms and conversion events.</p>
      </div>
      <div className="flex flex-wrap items-stretch gap-3">
        <DateRangeButton range={range} onChange={onRange} />
        <label className="relative flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900">
          <span>
            <span className="block text-[12px] font-semibold text-gray-500">Compare</span>
            <select value={compare} onChange={(event) => setCompare(event.target.value as "previous" | "none")} className="!min-h-0 appearance-none bg-transparent pr-6 text-[13px] font-semibold text-gray-800 outline-none dark:text-slate-200">
              <option value="previous">Previous period</option>
              <option value="none">No comparison</option>
            </select>
          </span>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-gray-500" />
        </label>
        <button type="button" onClick={onCreateLink} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-[15px] font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900">
          <Plus className="h-5 w-5" /> Create Tracking Link
        </button>
      </div>
    </div>
  );
  if (error && !data) return <div className="space-y-5">{header}{tabBar}<Card className="p-6 text-sm font-semibold text-rose-700">{error}</Card></div>;
  if (!data) return <div className="space-y-5">{header}{tabBar}<Card className="p-10 text-center text-sm text-gray-500">Loading the Tracking Hub…</Card></div>;
  const k = data.kpis;
  const p = data.previous;
  const delta = (now: number, before: number) => (compare === "none" ? null : pctChange(now, before));
  const items = Object.fromEntries(data.health.items.map((item) => [item.key, item]));
  const healthRows = [
    { title: `${items.sources?.total ?? 0} Data Sources`, sub: `${items.sources?.healthy ?? 0} Healthy`, ok: (items.sources?.healthy ?? 0) === (items.sources?.total ?? 0) && (items.sources?.total ?? 0) > 0 },
    { title: `${items.websites?.total ?? 0} Websites`, sub: `${items.websites?.healthy ?? 0} Healthy`, ok: (items.websites?.healthy ?? 0) === (items.websites?.total ?? 0) && (items.websites?.total ?? 0) > 0 },
    { title: `${items.links?.total ?? 0} Tracking Links`, sub: `${items.links?.healthy ?? 0} Healthy`, ok: (items.links?.healthy ?? 0) === (items.links?.total ?? 0) && (items.links?.total ?? 0) > 0 },
    { title: "Event Deduplication", sub: items.dedup?.detail ?? "", ok: (items.dedup?.healthy ?? 0) > 0 },
    { title: "CAPI Connection", sub: items.capi?.detail ?? "", ok: (items.capi?.healthy ?? 0) > 0 }
  ];

  return (
    <div className="space-y-5">
      {header}
      {tabBar}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={ShoppingCart} tone="bg-rose-50 text-rose-600" label="Protohub Orders" value={nf(k.orders)} delta={delta(k.orders, p.orders)} sub={compareLabel} />
        <KpiCard icon={Activity} tone="bg-blue-50 text-blue-600" label="Purchase Events" value={nf(k.purchaseEvents)} delta={delta(k.purchaseEvents, p.purchaseEvents)} sub="all sources" />
        <KpiCard icon={Monitor} tone="bg-emerald-50 text-emerald-600" label="Browser Events (Pixel)" value={nf(k.browserEvents)} delta={delta(k.browserEvents, p.browserEvents)} sub={`${k.browserPct}% of orders`} />
        <KpiCard icon={Server} tone="bg-blue-50 text-blue-600" label="Server Events (CAPI)" value={nf(k.serverEvents)} delta={delta(k.serverEvents, p.serverEvents)} sub={`${k.serverPct}% of orders`} />
        <KpiCard icon={Link2} tone="bg-emerald-50 text-emerald-600" label="Deduplicated Events" value={nf(k.deduped)} sub={`${k.dedupRate}% match rate`} />
        <KpiCard icon={AlertTriangle} tone="bg-rose-50 text-rose-600" label="Unmatched Events" value={nf(k.unmatched)} sub={`${k.unmatchedPct}% of orders`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.15fr)_minmax(0,1fr)_minmax(0,0.78fr)]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Orders vs Purchase Events</h2>
            <select value={chartDays} onChange={(event) => setChartDays(Number(event.target.value))} className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900">
              <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
            </select>
          </div>
          <div className="mt-2 flex flex-wrap gap-5 text-[12px] text-gray-600">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Protohub Orders</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-300" />Browser Events</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Server Events</span>
          </div>
          <div className="mt-3 h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.chart.map((row) => ({ ...row, label: shortDay(row.day) }))} barGap={2} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="#eef0f3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#6b7280" }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={32} allowDecimals={false} />
                <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} />
                <Bar dataKey="orders" name="Protohub Orders" fill="#2563eb" radius={[3, 3, 0, 0]} />
                <Bar dataKey="browser" name="Browser Events" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                <Bar dataKey="server" name="Server Events" fill="#4ade80" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Tracking Health</h2>
          <div className="mt-4 flex items-center gap-3">
            <HealthRing score={data.health.score} />
            <ul className="m-0 flex-1 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
              {healthRows.map((row) => (
                <li key={row.title} className="flex items-center gap-2.5 py-2">
                  {row.ok ? <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-500 text-white" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />}
                  <span className="min-w-0"><span className="block whitespace-nowrap text-[12.5px] font-semibold text-gray-800 dark:text-slate-200">{row.title}</span><span className="block whitespace-nowrap text-[11px] text-gray-400">{row.sub}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <button type="button" onClick={() => onTab("diagnostics")} className="!min-h-0 mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-200">View Diagnostics <ArrowRight className="h-4 w-4" /></button>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Attribution Capture</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active</span>
          </div>
          <p className="m-0 mt-1 text-[13px] text-gray-500">We capture and store all campaign data automatically.</p>
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
            {data.attribution.fields.map((field) => (
              <li key={field.key} className="flex items-center gap-2.5 text-[14px] text-gray-800 dark:text-slate-200" title={data.attribution.orders ? `Captured on ${field.pct}% of ${data.attribution.orders} ad orders in this period` : "No ad orders in this period"}>
                {field.pct >= 50 || data.attribution.orders === 0 ? <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-500 text-white" /> : field.pct > 0 ? <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" /> : <XCircle className="h-5 w-5 shrink-0 fill-rose-500 text-white" />}
                {field.label}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Data Sources (Meta Datasets)</h2>
            <div className="flex gap-2"><button type="button" className={lightButton} onClick={() => onTab("sources")}>View all</button><button type="button" className={darkButton} onClick={() => onTab("sources")}><Plus className="h-4 w-4" /> Connect Dataset</button></div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-0 w-full whitespace-nowrap text-left text-[12px] [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:!py-2 [&_th]:!text-[12px] [&_th]:!font-semibold">
              <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Name</th><th className="py-2 font-semibold">Business Account</th><th className="py-2 font-semibold">Pixel ID</th><th className="py-2 font-semibold">CAPI</th><th className="py-2 font-semibold">Events (7d)</th><th className="py-2 font-semibold">Status</th><th /></tr></thead>
              <tbody>
                {data.dataSources.map((source) => {
                  const [tone, text] = sourceTone(source);
                  return (
                    <tr key={source.id} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                      <td className="py-2.5"><span className="flex items-center gap-2 font-semibold"><PlatformIcon platform={source.platform} size="sm" />{source.name}{source.isMain ? <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-700">Main</span> : null}</span></td>
                      <td className="max-w-[104px] truncate py-2.5 text-gray-600" title={source.businessName}>{source.businessName || "—"}</td>
                      <td className="py-2.5 text-[12px] text-gray-600">{source.pixelId}</td>
                      <td className="py-2.5"><CheckDot ok={source.hasToken} /></td>
                      <td className="py-2.5 text-gray-600" title={source.eventsFromMeta ? "From Meta" : "Sent by Protohub (refresh in Data Sources for Meta's count)"}>{nf(source.events7d ?? source.sentByProtohub7d)}</td>
                      <td className="py-2.5"><StatusPill tone={tone}>{text}</StatusPill></td>
                      <td className="py-2.5 text-right"><ActionMenu items={[{ label: "Open in Data Sources", onClick: () => onTab("sources") }]} /></td>
                    </tr>
                  );
                })}
                {data.dataSources.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-gray-500">No dataset connected yet. <button type="button" className="!min-h-0 font-bold text-blue-600" onClick={() => onTab("sources")}>Connect one</button></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Websites</h2>
            <div className="flex gap-2"><button type="button" className={lightButton} onClick={() => onTab("websites")}>View all</button><button type="button" className={darkButton} onClick={() => onTab("websites")}><Plus className="h-4 w-4" /> Add Website</button></div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-0 w-full whitespace-nowrap text-left text-[12px] [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:!py-2 [&_th]:!text-[12px] [&_th]:!font-semibold">
              <thead><tr className="text-[12px] text-gray-500"><th className="py-2 font-semibold">Domain</th><th className="py-2 font-semibold">Platform</th><th className="py-2 font-semibold">Data Source</th><th className="py-2 font-semibold">Forms</th><th className="py-2 font-semibold">Status</th><th /></tr></thead>
              <tbody>
                {data.websites.map((site) => (
                  <tr key={site.id} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                    <td className="py-2.5"><span className="flex items-center gap-2"><SiteIcon platform={site.platform} />{site.domain}</span></td>
                    <td className="py-2.5 text-gray-600">{site.platform}</td>
                    <td className="py-2.5 text-gray-600">{site.dataSourceName ?? "—"}</td>
                    <td className="py-2.5 text-gray-600">{site.forms}</td>
                    <td className="py-2.5" title={site.problems.join(" · ")}><StatusPill tone={site.status === "healthy" ? "green" : "orange"}>{site.status === "healthy" ? "Healthy" : site.status === "disconnected" ? "Disconnected" : "Warning"}</StatusPill></td>
                    <td className="py-2.5 text-right"><ActionMenu items={[{ label: "Open in Websites", onClick: () => onTab("websites") }]} /></td>
                  </tr>
                ))}
                {data.websites.length === 0 ? <tr><td colSpan={6} className="py-6 text-center text-gray-500">No website added yet. <button type="button" className="!min-h-0 font-bold text-blue-600" onClick={() => onTab("websites")}>Add one</button></td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,0.75fr)]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Recent Purchase Events</h2>
            <button type="button" className={lightButton} onClick={() => onOpenLedger({})}>View all</button>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-0 w-full whitespace-nowrap text-left text-[12px] [&_td]:!px-1.5 [&_th]:!px-1.5 [&_th]:!py-2 [&_th]:!text-[12px] [&_th]:!font-semibold">
              <thead><tr className="text-[12px] text-gray-500">
                {["Order ID", "Product", "Website", "Source", "Campaign / Ad", "Value", "Browser", "CAPI", "Status", "Time"].map((head) => <th key={head} className="py-2 font-semibold">{head}</th>)}
              </tr></thead>
              <tbody>
                {data.recent.map((row) => (
                  <tr key={row.orderId} className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                    <td className="py-2.5 font-bold">{row.orderId}</td>
                    <td className="max-w-[86px] truncate py-2.5 text-gray-600" title={row.product}>{row.product}</td>
                    <td className="max-w-[104px] truncate py-2.5 text-gray-600" title={row.website ?? ""}>{row.website ?? "—"}</td>
                    <td className="py-2.5 text-gray-600">{row.source ?? "—"}</td>
                    <td className="py-2.5 text-gray-600" title={row.campaignId ? `Campaign ${row.campaignId}${row.adId ? ` · Ad ${row.adId}` : ""}` : ""}>{row.campaignId ? `${row.campaignId.slice(0, 9)}${row.adId ? ` / Ad ${row.adId.slice(-2)}` : ""}` : "—"}</td>
                    <td className="py-2.5 text-gray-600">{naira(row.value, row.currency)}</td>
                    <td className="py-2.5"><CheckDot ok={row.browser} /></td>
                    <td className="py-2.5"><CheckDot ok={row.serverStatus === "sent" || row.serverStatus === "dry_run"} /></td>
                    <td className="py-2.5"><StatusPill tone={LEDGER_TONE[row.status]}>{row.statusLabel}</StatusPill></td>
                    <td className="py-2.5 text-gray-600">{timeOf(row.createdAt)}</td>
                  </tr>
                ))}
                {data.recent.length === 0 ? <tr><td colSpan={10} className="py-6 text-center text-gray-500">No form orders in this period.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 flex items-center gap-2 text-[17px] font-black text-gray-900 dark:text-slate-100">Needs Attention {data.issueCount > 0 ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-600"><span className="h-1.5 w-1.5 rounded-full bg-rose-500" />{data.issueCount} issue{data.issueCount === 1 ? "" : "s"}</span> : null}</h2>
            <button type="button" className={lightButton} onClick={() => onTab("diagnostics")}>View all</button>
          </div>
          <ul className="m-0 mt-3 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
            {data.attention.map((issue, index) => (
              <li key={index}>
                <button type="button" onClick={() => (issue.orderIds?.length ? onOpenLedger({ orderIds: issue.orderIds }) : onTab(issue.tab as HubTab))} className="!min-h-0 flex w-full items-center gap-3 py-2.5 text-left">
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${ISSUE_TONE[issue.severity]} text-white`}><AlertTriangle className="h-3 w-3" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">{issue.title}</span><span className="block truncate text-[11px] text-gray-500">{issue.detail}</span></span>
                  {issue.at ? <span className="shrink-0 text-[11px] text-gray-400">{ago(issue.at)}</span> : null}
                  <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                </button>
              </li>
            ))}
            {data.attention.length === 0 ? <li className="py-6 text-center text-[13px] text-gray-500"><CheckCircle2 className="mx-auto mb-1 h-6 w-6 fill-emerald-500 text-white" />Nothing needs attention.</li> : null}
          </ul>
        </Card>
      </div>
    </div>
  );
}
