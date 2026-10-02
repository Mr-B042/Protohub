import { useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import {
  Activity, ArrowRight, BadgeCheck, CheckCircle2, ChevronRight, CircleCheck, CircleX, Copy, Gauge, Info, Link2, ListChecks, Monitor, RefreshCw, ScanLine, Server, Timer,
  TriangleAlert, Wrench
} from "lucide-react";
import { trackingHubApi, type HubDiagnostics, type HubIssue } from "../../lib/api";
import {
  ActionMenu, Card, DateRangeButton, EmptyRow, HubHeader, Kpi, Loading, Modal, PlatformIcon, StatusPill, UnderlineTabs, ago, darkButton, input, nf, outlineButton,
  rowCls, selectCls, smallBlueButton, smallButton, sourceTone, tableCls, timeOf, useLoad, type HubTab, type Range, type Toast
} from "./HubParts";
import { auditLabel } from "./DataSourcesTab";

// Diagnostics tab - built to Bright's image (2 Oct 2026).

type SubTab = "health" | "flow" | "issues" | "pixel" | "attribution" | "duplicates" | "url" | "activity";
const LEVEL_PILL: Record<HubIssue["level"], ["red" | "orange" | "blue", string]> = { critical: ["red", "Critical"], warning: ["orange", "Warning"], info: ["blue", "Info"] };

export default function DiagnosticsTab({ tabBar, onToast, range, onRange, onTab, onOpenLedger }: {
  tabBar: ReactNode; onToast: Toast; range: Range; onRange: (range: Range) => void; onTab: (tab: HubTab) => void; onOpenLedger: (filter: { orderIds?: string[] }) => void;
}) {
  const [sub, setSub] = useState<SubTab>("health");
  const [flow, setFlow] = useState("24h");
  const [websiteId, setWebsiteId] = useState("");
  const [running, setRunning] = useState(false);
  const [validating, setValidating] = useState(false);
  const { data, reload } = useLoad(() => trackingHubApi.diagnostics({ ...range, flow, websiteId }), [range.from, range.to, flow, websiteId], onToast);

  /** Run Full Diagnostics: test every data source, read Meta's numbers, scan every website, then reload. */
  const runAll = async () => {
    if (!data) return;
    setRunning(true);
    let problems = 0;
    try {
      for (const source of data.pixelCapi.filter((row) => row.hasToken)) {
        try { const r = await trackingHubApi.testDataSource(source.id); if (!r.ok) problems += 1; if (source.platform === "meta") await trackingHubApi.refreshDataSource(source.id).catch(() => undefined); } catch { problems += 1; }
      }
      for (const site of data.websites) { try { await trackingHubApi.scanWebsite(site.id); } catch { problems += 1; } }
      onToast(problems ? `Diagnostics finished: ${problems} check${problems === 1 ? "" : "s"} failed.` : "Diagnostics finished. Everything answered.");
      reload();
    } finally {
      setRunning(false);
    }
  };
  const issueAction = (issue: HubIssue) => {
    if (issue.orderIds?.length) onOpenLedger({ orderIds: issue.orderIds });
    else onTab((issue.tab === "diagnostics" ? "sources" : issue.tab) as HubTab);
  };
  const header = (
    <HubHeader title="Diagnostics" subtitle="Monitor the health of your tracking setup, detect issues, and get actionable solutions."
      actions={<>
        <DateRangeButton range={range} onChange={onRange} />
        <button type="button" className={outlineButton} onClick={reload}><RefreshCw className="h-4 w-4" /> Refresh Data</button>
        <button type="button" className={darkButton} disabled={running || !data} onClick={() => void runAll()}><Timer className={`h-4 w-4 ${running ? "animate-spin" : ""}`} /> {running ? "Running…" : "Run Full Diagnostics"}</button>
      </>} />
  );
  if (!data) return <div className="space-y-5">{header}{tabBar}<Loading text="Running diagnostics…" /></div>;
  const k = data.kpis;
  const scoreOk = k.score >= 90;

  return (
    <div className="space-y-5">
      {header}
      {tabBar}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<CircleCheck className="h-8 w-8" />} tone={scoreOk ? "green" : "orange"} label="Overall Health" value={`${k.score}%`} delta={<StatusPill size="sm" tone={scoreOk ? "green" : k.score >= 70 ? "orange" : "red"}>{scoreOk ? "Healthy" : k.score >= 70 ? "Needs work" : "Unhealthy"}</StatusPill>} sub={k.issues === 0 ? "All systems working properly" : `${k.issues} issue${k.issues === 1 ? "" : "s"} to look at`} />
        <Kpi icon={<Activity className="h-7 w-7" />} tone="blue" label="Orders Tracked" value={`${nf(k.ordersTracked)} / ${nf(k.orders)}`} delta={<Pct value={k.trackedPct} />} sub={k.orders === k.ordersTracked ? "All orders sent to Meta" : `${nf(k.orders - k.ordersTracked)} not sent`} />
        <Kpi icon={<Monitor className="h-7 w-7" />} tone="blue" label="Browser Events" value={`${nf(k.browser)} / ${nf(k.orders)}`} delta={<Pct value={k.browserPct} />} sub={k.browserMissing ? `${nf(k.browserMissing)} missing (see below)` : "None missing"} />
        <Kpi icon={<Server className="h-7 w-7" />} tone="purple" label="Server Events (CAPI)" value={`${nf(k.server)} / ${nf(k.orders)}`} delta={<Pct value={k.serverPct} />} sub={k.server === k.orders ? "All events delivered" : `${nf(k.orders - k.server)} not delivered`} />
        <Kpi icon={<TriangleAlert className="h-7 w-7" />} tone="red" label="Issues Detected" value={nf(k.issues)} sub={<><span className="text-rose-600">{k.critical} critical</span> • <span className="text-amber-600">{k.warning} warning</span> • {k.info} info</>} onClick={() => setSub("issues")} />
      </div>

      <Card className="px-2">
        <UnderlineTabs className="!border-b-0" value={sub} onChange={setSub} tabs={[
          { key: "health", label: "System Health", icon: sub === "health" ? <BadgeCheck className="h-4 w-4" /> : undefined }, { key: "flow", label: "Event Flow" }, { key: "issues", label: "Issue Analysis" },
          { key: "pixel", label: "Pixel & CAPI" }, { key: "attribution", label: "Campaign Attribution" }, { key: "duplicates", label: "Duplicate Detection" },
          { key: "url", label: "URL & Parameters" }, { key: "activity", label: "Activity Logs" }
        ]} />
      </Card>

      {sub === "health" ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.55fr)_minmax(380px,1fr)]">
          <div className="space-y-4">
            <FlowCard data={data} flow={flow} setFlow={setFlow} websiteId={websiteId} setWebsiteId={setWebsiteId} />
            <div className="grid gap-4 lg:grid-cols-2">
              <EmqCard data={data} />
              <StatusDonut data={data} />
            </div>
            <IssuesCard issues={data.issues.slice(0, 5)} onAction={issueAction} onViewAll={() => setSub("issues")} />
          </div>
          <div className="space-y-4">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <CardTitle icon={<Gauge className="h-5 w-5" />} title="Quick Diagnostics" sub="Run instant checks on your tracking setup" />
                <button type="button" className="!min-h-0 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-50" disabled={running} onClick={() => void runAll()}><ArrowRight className="h-3.5 w-3.5" /> {running ? "Running…" : "Run All Checks"}</button>
              </div>
              <ul className="m-0 mt-3 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
                {data.quickChecks.map((check) => (
                  <li key={check.label} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                    <span className="flex items-center gap-2 text-gray-700 dark:text-slate-300">{check.ok ? <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" /> : check.warn ? <TriangleAlert className="h-4 w-4 text-amber-500" /> : <CircleX className="h-4 w-4 fill-rose-500 text-white" />}{check.label}</span>
                    <span className={`flex items-center gap-1.5 font-semibold ${check.ok ? "text-emerald-600" : check.warn ? "text-amber-600" : "text-rose-600"}`}><span className={`h-2 w-2 rounded-full ${check.ok ? "bg-emerald-500" : check.warn ? "bg-amber-500" : "bg-rose-500"}`} />{check.value}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <CardTitle icon={<ListChecks className="h-5 w-5" />} title="Top Affected Pages" sub="Pages with tracking issues" />
                <button type="button" className={smallBlueButton} onClick={() => onTab("websites")}>View All Pages <ArrowRight className="h-3.5 w-3.5" /></button>
              </div>
              <table className={`${tableCls} mt-2`}>
                <thead><tr className="text-gray-500"><th>Landing Page</th><th className="text-center">Issues</th><th className="text-center">Orders</th><th>Status</th></tr></thead>
                <tbody>
                  {data.topPages.slice(0, 6).map((page) => {
                    const tone = page.issues >= 3 ? "red" : page.issues > 0 ? "orange" : "green";
                    return (
                      <tr key={`${page.domain}${page.path}`} className={rowCls}>
                        <td className="py-2"><span className="flex items-center gap-2">{tone === "green" ? <CheckCircle2 className="h-4 w-4 shrink-0 fill-emerald-500 text-white" /> : <CircleX className={`h-4 w-4 shrink-0 text-white ${tone === "red" ? "fill-rose-500" : "fill-amber-500"}`} />}<span className="truncate"><strong className="font-semibold">{page.path}</strong> <span className="text-[11.5px] text-gray-500">({page.domain})</span></span></span></td>
                        <td className={`py-2 text-center font-semibold ${page.issues ? "text-rose-600" : "text-gray-500"}`}>{page.issues}</td>
                        <td className="py-2 text-center">{nf(page.orders)}</td>
                        <td className="py-2"><StatusPill size="sm" tone={tone}>{tone === "red" ? "Critical" : tone === "orange" ? "Warning" : "Healthy"}</StatusPill></td>
                      </tr>
                    );
                  })}
                  {data.topPages.length === 0 ? <EmptyRow colSpan={4} text="No orders in this period." /> : null}
                </tbody>
              </table>
            </Card>
            <Card className="p-4">
              <CardTitle icon={<Wrench className="h-5 w-5" />} title="Tools & Actions" sub="Useful tools to fix common issues" />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Tool icon={<Monitor className="h-5 w-5" />} title="Test Pixel on Page" sub="Check if pixel is detected" onClick={() => onTab("websites")} />
                <Tool icon={<Server className="h-5 w-5" />} title="Test CAPI Connection" sub="Send a test event" onClick={() => onTab("sources")} />
                <Tool icon={<Link2 className="h-5 w-5" />} title="Validate URL Parameters" sub="Check fbclid, utm, etc." onClick={() => setValidating(true)} />
                <Tool icon={<Copy className="h-5 w-5" />} title="Check Duplicate Events" sub="Find potential duplicates" onClick={() => setSub("duplicates")} />
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      {sub === "flow" ? <div className="space-y-4"><FlowCard data={data} flow={flow} setFlow={setFlow} websiteId={websiteId} setWebsiteId={setWebsiteId} /><StatusDonut data={data} /></div> : null}
      {sub === "issues" ? <IssuesCard issues={data.issues} onAction={issueAction} full /> : null}

      {sub === "pixel" ? (
        <Card className="p-4">
          <CardTitle icon={<Server className="h-5 w-5" />} title="Pixel & CAPI" sub="Each data source: token, last check and events" />
          <table className={`${tableCls} mt-3`}>
            <thead><tr className="text-gray-500"><th>Data source</th><th>Pixel ID</th><th>CAPI token</th><th>Last check</th><th className="text-right">Events (7d)</th><th>Status</th></tr></thead>
            <tbody>
              {data.pixelCapi.map((source) => { const [tone, text] = sourceTone(source); return (
                <tr key={source.id} className={rowCls}><td className="py-2.5"><span className="flex items-center gap-2"><PlatformIcon platform={source.platform} size="sm" /><strong className="font-semibold">{source.name}</strong></span></td><td className="py-2.5 font-mono text-[12px] text-gray-600">{source.pixelId}</td><td className="py-2.5">{source.hasToken ? "Saved" : <span className="text-rose-600">Missing</span>}</td><td className="py-2.5 text-gray-600" title={source.lastCheckMessage ?? ""}>{source.lastCheckAt ? ago(source.lastCheckAt) : "Never"}</td><td className="py-2.5 text-right">{nf(source.events7d ?? source.sentByProtohub7d)}</td><td className="py-2.5"><StatusPill size="sm" tone={tone}>{text}</StatusPill></td></tr>
              ); })}
              {data.pixelCapi.length === 0 ? <EmptyRow colSpan={6} text="No data source connected." /> : null}
            </tbody>
          </table>
          <EmqCard data={data} bare />
        </Card>
      ) : null}

      {sub === "attribution" ? (
        <Card className="p-4">
          <CardTitle icon={<Link2 className="h-5 w-5" />} title="Campaign Attribution" sub={data.attributionOrders ? `Share of ${nf(data.attributionOrders)} ad orders in the period that carried each piece` : "No ad orders in the period"} />
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
            {data.attribution.map((field) => (
              <li key={field.key} className="flex items-center gap-3 text-[13px]">
                <span className="w-44 text-gray-700 dark:text-slate-300">{field.label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700"><span className={`block h-full rounded-full ${field.pct >= 80 ? "bg-emerald-500" : field.pct >= 50 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${field.pct}%` }} /></span>
                <span className="w-14 text-right font-semibold">{field.pct}%</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {sub === "duplicates" ? (
        <Card className="p-4">
          <CardTitle icon={<Copy className="h-5 w-5" />} title="Duplicate Detection" sub="Orders that could count twice in Meta, and pages loading the Pixel more than once" />
          <table className={`${tableCls} mt-3`}>
            <thead><tr className="text-gray-500"><th>Kind</th><th>Detail</th><th /></tr></thead>
            <tbody>
              {data.duplicates.map((row, index) => <tr key={index} className={rowCls}><td className="py-2.5 font-semibold">{row.kind}</td><td className="py-2.5 text-gray-600">{row.detail}</td><td className="py-2.5 text-right">{row.orderId ? <button type="button" className={smallButton} onClick={() => onOpenLedger({ orderIds: [row.orderId!] })}>View order</button> : <button type="button" className={smallButton} onClick={() => onTab("websites")}>Check page</button>}</td></tr>)}
              {data.duplicates.length === 0 ? <EmptyRow colSpan={3} text={<><CheckCircle2 className="mx-auto mb-1 h-6 w-6 fill-emerald-500 text-white" />No duplicates found.</>} /> : null}
            </tbody>
          </table>
        </Card>
      ) : null}

      {sub === "url" ? (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-start justify-between gap-2"><CardTitle icon={<Link2 className="h-5 w-5" />} title="URL & Parameters" sub="Ad orders that arrived without a campaign id (the ad is missing the URL parameters)" /><button type="button" className={smallBlueButton} onClick={() => setValidating(true)}>Validate an ad URL</button></div>
            <table className={`${tableCls} mt-3`}>
              <thead><tr className="text-gray-500"><th>Order</th><th>Time</th><th>UTM source</th><th>Came from</th></tr></thead>
              <tbody>
                {data.lostParams.map((row) => <tr key={row.orderId} className={rowCls}><td className="py-2 font-semibold">{row.orderId}</td><td className="py-2 text-gray-600">{ago(row.at)}</td><td className="py-2">{row.utmSource ?? "—"}</td><td className="py-2 text-gray-600">{row.referrer ?? "—"}</td></tr>)}
                {data.lostParams.length === 0 ? <EmptyRow colSpan={4} text="Every ad order carried its campaign id." /> : null}
              </tbody>
            </table>
            {data.lostParams.length ? <button type="button" className={`${smallButton} mt-2`} onClick={() => onOpenLedger({ orderIds: data.lostParams.map((row) => row.orderId) })}>Open in the Event Ledger</button> : null}
          </Card>
        </div>
      ) : null}

      {sub === "activity" ? (
        <Card className="p-4">
          <CardTitle icon={<Activity className="h-5 w-5" />} title="Activity Logs" sub="Every change made in the Tracking Hub" />
          <table className={`${tableCls} mt-3`}>
            <thead><tr className="text-gray-500"><th>When</th><th>What</th><th>On</th><th>By</th></tr></thead>
            <tbody>
              {data.activity.map((row, index) => <tr key={index} className={rowCls}><td className="py-2 text-gray-600">{ago(row.at)} · {timeOf(row.at)}</td><td className="py-2 font-semibold">{auditLabel(row.action)}</td><td className="py-2 text-gray-600">{row.subject ?? "—"}</td><td className="py-2 text-gray-600">{row.by ?? "System"}</td></tr>)}
              {data.activity.length === 0 ? <EmptyRow colSpan={4} text="No changes yet." /> : null}
            </tbody>
          </table>
        </Card>
      ) : null}

      {validating ? <ValidateUrlModal onClose={() => setValidating(false)} onToast={onToast} /> : null}
    </div>
  );
}

function Pct({ value }: { value: number }) {
  const tone = value >= 99 ? "bg-emerald-50 text-emerald-700" : value >= 90 ? "bg-emerald-50 text-emerald-700" : value >= 70 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";
  return <span className={`rounded-md px-2 py-0.5 text-[12px] font-bold ${tone}`}>{value}%</span>;
}

function CardTitle({ icon, title, sub, right }: { icon: ReactNode; title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40">{icon}</span>
      <div className="min-w-0 flex-1"><h2 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">{title}</h2>{sub ? <p className="m-0 text-[12.5px] text-gray-500">{sub}</p> : null}</div>
      {right}
    </div>
  );
}

function FlowCard({ data, flow, setFlow, websiteId, setWebsiteId }: { data: HubDiagnostics; flow: string; setFlow: (value: string) => void; websiteId: string; setWebsiteId: (value: string) => void }) {
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">Tracking Flow Health</h2><p className="m-0 text-[13px] text-gray-500">See how orders move from your website to Meta</p></div>
        <div className="flex gap-2">
          <select value={websiteId} onChange={(event) => setWebsiteId(event.target.value)} className={`${selectCls} !h-9 w-36`}><option value="">All Websites</option>{data.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</select>
          <select value={flow} onChange={(event) => setFlow(event.target.value)} className={`${selectCls} !h-9 w-32`}><option value="24h">This period</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select>
        </div>
      </div>
      <div className="mt-4 flex items-stretch gap-1 overflow-x-auto pb-1">
        {data.flow.map((step, index) => {
          const ok = step.pct >= 95 || (index < 2 && step.value > 0) || step.key === "order";
          const warn = !ok && step.pct >= 70;
          return (
            <div key={step.key} className="flex min-w-[104px] flex-1 items-center gap-1">
              <div className="flex-1 text-center">
                <div className="rounded-xl border border-gray-200 px-2 py-3 dark:border-slate-700">
                  <span className={`mx-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-white ${ok ? "bg-emerald-500" : warn ? "bg-amber-500" : "bg-rose-500"}`}>{ok ? <CheckCircle2 className="h-5 w-5" /> : <TriangleAlert className="h-4 w-4" />}</span>
                  <p className="m-0 mt-2 whitespace-nowrap text-[12px] text-gray-700 dark:text-slate-300">{step.label}</p>
                  <strong className="block text-[19px] font-black text-gray-900 dark:text-slate-100">{nf(step.value)}</strong>
                  <p className="m-0 whitespace-nowrap text-[11px] text-gray-500">{step.sub}{step.key === "meta" ? <Info className="ml-1 inline h-3 w-3" /> : null}</p>
                </div>
                <p className={`m-0 mt-2 text-[13px] font-bold ${ok ? "text-emerald-600" : warn ? "text-amber-600" : "text-rose-600"}`}>{step.pct}%</p>
              </div>
              {index < data.flow.length - 1 ? <ChevronRight className="mb-6 h-4 w-4 shrink-0 text-gray-400" /> : null}
            </div>
          );
        })}
      </div>
      <p className="m-0 mt-1 text-[11px] text-gray-400">Landing page and form numbers are distinct visits to the order form. Browser, CAPI and Meta are shares of orders.</p>
    </Card>
  );
}

function EmqCard({ data, bare }: { data: HubDiagnostics; bare?: boolean }) {
  const order = ["Overall", "Purchase", "ViewContent", "InitiateCheckout", "AddToCart", "PageView", "Lead"];
  const scores = data.emq?.scores ?? {};
  const entries = Object.entries(scores);
  const overall = entries.length ? Math.round((entries.reduce((sum, [, value]) => sum + Number(value), 0) / entries.length) * 10) / 10 : null;
  const rows: Array<[string, number]> = [...(overall !== null && !("Overall" in scores) ? [["Overall", overall] as [string, number]] : []), ...entries.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])) as Array<[string, number]>];
  const body = (
    <>
      <ul className="m-0 mt-3 list-none space-y-3 p-0">
        {rows.map(([name, value]) => (
          <li key={name} className="flex items-center gap-3 text-[13px]">
            <span className="w-32 text-gray-700 dark:text-slate-300">{name}</span>
            <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700"><span className={`block h-full rounded-full ${value >= 8 ? "bg-emerald-500" : value >= 6 ? "bg-amber-400" : "bg-rose-500"}`} style={{ width: `${Math.min(100, value * 10)}%` }} /></span>
            <span className="w-12 text-right font-semibold text-gray-800 dark:text-slate-200">{value}/10</span>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="m-0 mt-3 text-[12.5px] text-gray-500">Not loaded yet. Press Run Full Diagnostics (reads Meta's match quality for each data source).</p> : null}
    </>
  );
  if (bare) return <div className="mt-4"><p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-100">Event Match Quality{data.emq ? ` · ${data.emq.source}` : ""}</p>{body}</div>;
  return <Card className="p-4"><CardTitle icon={<BadgeCheck className="h-5 w-5" />} title="Event Match Quality" sub={`Meta's match quality for your events${data.emq ? ` (${data.emq.source})` : ""}`} />{body}</Card>;
}

function StatusDonut({ data }: { data: HubDiagnostics }) {
  const s = data.statusCounts;
  const total = Math.max(0, data.totalEvents);
  const parts = [
    { key: "Deduplicated", value: s.deduplicated, color: "#16a34a" }, { key: "Server only", value: s.serverOnly, color: "#2563eb" }, { key: "Browser only", value: s.browserOnly, color: "#f59e0b" },
    { key: "Failed", value: s.failed, color: "#e11d48" }, { key: "Pending", value: s.pending, color: "#94a3b8" }, ...(s.pagePixel ? [{ key: "Thank-you page", value: s.pagePixel, color: "#cbd5e1" }] : [])
  ];
  const chart = parts.filter((part) => part.value > 0);
  return (
    <Card className="p-4">
      <CardTitle icon={<ListChecks className="h-5 w-5" />} title="Events by Status" />
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="relative h-[150px] w-[150px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart><Pie data={chart.length ? chart : [{ key: "none", value: 1, color: "#e5e7eb" }]} dataKey="value" innerRadius={52} outerRadius={70} startAngle={90} endAngle={-270} stroke="none">{(chart.length ? chart : [{ key: "none", value: 1, color: "#e5e7eb" }]).map((part) => <Cell key={part.key} fill={part.color} />)}</Pie></PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center"><strong className="text-[22px] font-black text-gray-900 dark:text-slate-100">{nf(total)}</strong><span className="text-[11.5px] text-gray-500">Total Events</span></div>
        </div>
        <ul className="m-0 min-w-[180px] flex-1 list-none space-y-2.5 p-0 text-[13px]">
          {parts.map((part) => (
            <li key={part.key} className="grid grid-cols-[1fr_auto_auto] items-center gap-3">
              <span className="flex items-center gap-2 text-gray-700 dark:text-slate-300"><span className="h-2.5 w-2.5 rounded-full" style={{ background: part.color }} />{part.key}</span>
              <strong className="text-right">{nf(part.value)}</strong>
              <span className="w-12 text-right text-gray-500">{total ? `${Math.round((part.value / total) * 1000) / 10}%` : "0%"}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function IssuesCard({ issues, onAction, onViewAll, full }: { issues: HubIssue[]; onAction: (issue: HubIssue) => void; onViewAll?: () => void; full?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <CardTitle icon={<TriangleAlert className="h-5 w-5" />} title={full ? "Issue Analysis" : "Recent Issues"} sub="Issues that need your attention" />
        {onViewAll ? <button type="button" className={smallBlueButton} onClick={onViewAll}>View All Issues <ArrowRight className="h-3.5 w-3.5" /></button> : null}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className={tableCls}>
          <thead><tr className="text-gray-500"><th>Issue</th><th>Affected</th><th>Severity</th><th>Detected</th><th>Status</th><th>Action</th><th /></tr></thead>
          <tbody>
            {issues.map((issue) => {
              const [tone, text] = LEVEL_PILL[issue.level];
              return (
                <tr key={issue.key} className={rowCls}>
                  <td className="py-2"><span className="flex items-start gap-2">{issue.level === "critical" ? <CircleX className="mt-0.5 h-4 w-4 shrink-0 fill-rose-500 text-white" /> : issue.level === "warning" ? <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 fill-blue-500 text-white" />}<span className="min-w-0"><strong className="block font-semibold">{issue.title}</strong><span className="block max-w-[260px] truncate text-[11.5px] text-gray-500" title={`${issue.detail} — ${issue.action}`}>{issue.detail}</span>{full ? <span className="block text-[11.5px] text-gray-500">{issue.action}</span> : null}</span></span></td>
                  <td className="whitespace-nowrap py-2 text-gray-600">{issue.affected}</td>
                  <td className="py-2"><StatusPill size="sm" tone={tone}>{text}</StatusPill></td>
                  <td className="whitespace-nowrap py-2 text-gray-600">{issue.at ? ago(issue.at) : "—"}</td>
                  <td className="py-2"><span className="rounded-md bg-rose-50 px-2 py-0.5 text-[11.5px] font-semibold text-rose-600">Open</span></td>
                  <td className="py-2"><button type="button" className={`${smallBlueButton} whitespace-nowrap`} onClick={() => onAction(issue)}>{issue.actionLabel}</button></td>
                  <td className="py-2 text-right"><ActionMenu items={[{ label: issue.actionLabel, onClick: () => onAction(issue) }]} /></td>
                </tr>
              );
            })}
            {issues.length === 0 ? <EmptyRow colSpan={7} text={<><CheckCircle2 className="mx-auto mb-1 h-6 w-6 fill-emerald-500 text-white" />No issues found.</>} /> : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Tool({ icon, title, sub, onClick }: { icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="!min-h-0 flex items-center gap-3 rounded-xl border border-gray-200 p-3 text-left hover:border-blue-300 dark:border-slate-700">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40">{icon}</span>
      <span><strong className="block text-[13px] text-gray-900 dark:text-slate-100">{title}</strong><span className="block text-[11.5px] text-gray-500">{sub}</span></span>
    </button>
  );
}

function ValidateUrlModal({ onClose, onToast }: { onClose: () => void; onToast: Toast }) {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof trackingHubApi.validateUrl>> | null>(null);
  return (
    <Modal title="Validate URL Parameters" subtitle="Paste the full URL an ad sends people to (with its parameters)." onClose={onClose}>
      <div className="flex gap-2"><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://brightpathhubs.com/shelf/?utm_source=fb&utm_id={{campaign.id}}…" className={`${input} !mt-0`} />
        <button type="button" className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} onClick={async () => { try { setResult(await trackingHubApi.validateUrl(url)); } catch (err: any) { onToast(err?.message ?? "Could not check."); } }}><ScanLine className="h-4 w-4" /> Check</button></div>
      {result ? (
        <div className="mt-3">
          <p className={`m-0 text-[13px] font-bold ${result.ok ? "text-emerald-700" : "text-amber-700"}`}>{result.ok ? "All required parameters are there." : "Some required parameters are missing."}</p>
          <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12.5px]">
            {result.checks.map((check) => <li key={check.key} className="flex items-center justify-between gap-2"><span className="flex items-center gap-1.5">{check.ok ? <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" /> : <CircleX className="h-4 w-4 fill-rose-500 text-white" />}{check.label}{check.required ? <span className="text-[10.5px] text-gray-400">required</span> : null}</span><span className="max-w-[220px] truncate font-mono text-[11.5px] text-gray-500">{check.value ?? "missing"}</span></li>)}
          </ul>
          <p className="m-0 mt-2 text-[11.5px] text-gray-500">{result.note}</p>
        </div>
      ) : null}
    </Modal>
  );
}
