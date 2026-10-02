import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, CheckCircle2, ExternalLink, Globe, Infinity as InfinityIcon, Play, Plus, RefreshCw, Server, Trash2, TriangleAlert, X } from "lucide-react";
import { ConnectModal, ConnectionsSection } from "./MetaConnections";
import { trackingHubApi, type HubDataSource, type HubPlatform } from "../../lib/api";
import {
  LoadState,
  ActionMenu, Card, CheckBox, CheckDot, DetailRow, Delta, EmptyRow, HubHeader, Kpi, Loading, MiniStat, Modal, PLATFORM_LABEL, PanelClose, PlatformIcon,
  SearchBox, SetupGuide, SplitLayout, StatusPill, UnderlineTabs, ago, darkButton, input, labelCls, nf, outlineButton, primaryButton, rowCls, smallButton,
  sourceTone, listTableCls, tableCls, useLoad, type Toast
} from "./HubParts";

// Data Sources tab - built to Bright's image (2 Oct 2026).

type Filter = "all" | "meta" | "tiktok" | "google" | "other";
type PanelTab = "overview" | "settings" | "events" | "diagnostics" | "logs";

export default function DataSourcesTab({ tabBar, onToast }: { tabBar: ReactNode; onToast: Toast }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.dataSources(), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [editing, setEditing] = useState<HubDataSource | "new" | null>(null);
  const [guide, setGuide] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const rows = useMemo(() => (data?.dataSources ?? []).filter((row) =>
    (filter === "all" || (filter === "other" ? row.platform === "other" || row.platform === "snapchat" : row.platform === filter))
    && (!q || `${row.name} ${row.businessName} ${row.pixelId}`.toLowerCase().includes(q.toLowerCase()))), [data, filter, q]);
  useEffect(() => { if (!selected && !closed && data?.dataSources.length) setSelected(data.dataSources[0].id); }, [data]);

  const header = (
    <HubHeader title="Data Sources" subtitle="Connect and manage all your advertising data sources (Meta, TikTok, Google etc.)"
      actions={<>
        <button type="button" className={outlineButton} onClick={() => setGuide(true)}><BookOpen className="h-4 w-4" /> Docs &amp; Setup Guide</button>
        <button type="button" className={outlineButton} onClick={() => setTesting(true)}><Play className="h-4 w-4" /> Test Event</button>
        <button type="button" className={primaryButton} onClick={() => setConnecting(true)}><Plus className="h-5 w-5" /> Connect Meta Business</button>
      </>} />
  );
  const modals = <>
    {guide ? <SetupGuide onClose={() => setGuide(false)} /> : null}
    {testing && data ? <TestEventModal sources={data.dataSources} onClose={() => setTesting(false)} onToast={onToast} /> : null}
    {connecting ? <ConnectModal onClose={() => setConnecting(false)} onToast={onToast} onDone={() => { setConnecting(false); reload(); }} /> : null}
    {editing ? <Modal title={editing === "new" ? "Add a Pixel manually" : `Edit ${editing.name}`} subtitle={editing === "new" ? "For a Pixel your Meta Business connection cannot see, e.g. one owned by a partner. It needs its own token." : "From Meta Events Manager → Data Sources, and Business Settings → System Users."} onClose={() => setEditing(null)} wide>
      <SourceForm source={editing === "new" ? null : editing} onCancel={() => setEditing(null)} onSaved={(id) => { setEditing(null); onToast("Data source saved."); setSelected(id); reload(); }} />
    </Modal> : null}
  </>;
  if (!data) return <div className="space-y-5">{header}{tabBar}<Loading error={error} onRetry={reload} />{modals}</div>;

  const k = data.kpis;
  const counts = data.platformCounts;
  const chips: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "All", count: k.total }, { key: "meta", label: "Meta", count: counts.meta ?? 0 }, { key: "tiktok", label: "TikTok", count: counts.tiktok ?? 0 },
    { key: "google", label: "Google", count: counts.google ?? 0 }, { key: "other", label: "Other", count: (counts.other ?? 0) + (counts.snapchat ?? 0) }
  ];
  const current = data.dataSources.find((row) => row.id === selected) ?? null;

  return (
    <div className="space-y-5">
      {header}
      {tabBar}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<InfinityIcon className="h-7 w-7" />} tone="blue" label="Total Data Sources" value={nf(k.total)} delta={<span className="leading-tight"><Delta value={k.newThisMonth} suffix="" /><span className="block text-[11.5px] font-normal text-gray-400">vs last month</span></span>} />
        <Kpi icon={<CheckCircle2 className="h-7 w-7" />} tone="green" label="Healthy" value={nf(k.healthy)} sub={`${k.healthyPct}%`} />
        <Kpi icon={<TriangleAlert className="h-7 w-7" />} tone="orange" label="Need Attention" value={nf(k.needAttention)} sub={`${k.needAttentionPct}%`} />
        <Kpi icon={<X className="h-8 w-8" strokeWidth={3} />} tone="red" label="Disconnected" value={nf(k.disconnected)} sub={`${k.disconnectedPct}%`} />
      </div>

      <ConnectionsSection connections={data.connections} onToast={onToast} onChanged={reload} onConnect={() => setConnecting(true)} onAddManually={() => setEditing("new")} onOpenPixel={(id) => { setSelected(id); setClosed(false); }} />

      <SplitLayout
        list={
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                {chips.map((chip) => (
                  <button key={chip.key} type="button" onClick={() => setFilter(chip.key)}
                    className={`!min-h-0 rounded-lg border px-4 py-2 text-[13px] font-semibold ${filter === chip.key ? "border-blue-600 bg-blue-600 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{chip.label} ({chip.count})</button>
                ))}
              </div>
              <SearchBox value={q} onChange={setQ} placeholder="Search data sources..." className="w-full sm:w-64" />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className={listTableCls}>
                <thead><tr className="bg-gray-50/70 text-gray-500 dark:bg-slate-800/40">
                  <th className="w-8"><CheckBox checked={rows.length > 0 && checked.length === rows.length} onChange={(value) => setChecked(value ? rows.map((row) => row.id) : [])} /></th>
                  <th>Name</th><th>Platform</th><th>Business Account</th><th>Dataset / Pixel ID</th><th>CAPI</th><th>Events (7d)</th><th>Status</th><th className="text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {rows.map((source) => {
                    const [tone, text] = sourceTone(source);
                    const events = source.events7d ?? source.sentByProtohub7d;
                    return (
                      <tr key={source.id} onClick={() => { setSelected(source.id); setClosed(false); }} className={`${rowCls} cursor-pointer ${selected === source.id ? "bg-blue-50/60 dark:bg-blue-950/20" : "hover:bg-gray-50 dark:hover:bg-slate-800/40"}`}>
                        <td className="py-3"><CheckBox checked={checked.includes(source.id)} onChange={(value) => setChecked((list) => value ? [...list, source.id] : list.filter((id) => id !== source.id))} /></td>
                        <td className="py-3"><span className="flex items-center gap-2.5"><PlatformIcon platform={source.platform} /><span><strong className="block font-semibold">{source.name}</strong>{source.isMain ? <span className="mt-0.5 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-blue-700">Default</span> : null}</span></span></td>
                        <td className="py-3 text-gray-600">{PLATFORM_LABEL[source.platform] ?? source.platform}</td>
                        <td className="max-w-[100px] truncate py-3 text-gray-600" title={source.businessName}>{source.businessName || "—"}</td>
                        <td className="max-w-[112px] truncate py-3 text-gray-600" title={source.pixelId}>{source.pixelId}</td>
                        <td className="py-3"><CheckDot ok={source.hasToken} /></td>
                        <td className="py-3" title={source.eventsFromMeta ? "From Meta (last 7 days)" : "Sent by Protohub — open the source and press Refresh from Meta for Meta's count"}>
                          <span className="block font-semibold text-gray-700 dark:text-slate-200">{nf(events)}{source.eventsFromMeta ? "" : "*"}</span>
                          {source.events7dChange !== null ? <Delta value={source.events7dChange} /> : null}
                        </td>
                        <td className="py-3"><StatusPill tone={tone}>{text}</StatusPill></td>
                        <td className="py-3 text-right"><ActionMenu items={[
                          { label: "Open", onClick: () => { setSelected(source.id); setClosed(false); } },
                          { label: "Edit", onClick: () => setEditing(source) },
                          { label: "Delete", danger: true, onClick: async () => { if (!window.confirm(`Delete ${source.name}? Links using it stop sending server events.`)) return; await trackingHubApi.deleteDataSource(source.id); if (selected === source.id) setSelected(null); reload(); } }
                        ]} /></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 ? <EmptyRow colSpan={9} text={data.dataSources.length === 0 ? <>No data source yet. <button type="button" className="!min-h-0 font-bold text-blue-600" onClick={() => setConnecting(true)}>Connect your Meta Business</button></> : "No data source matches."} /> : null}
                </tbody>
              </table>
              {data.dataSources.some((row) => !row.eventsFromMeta) ? <p className="m-0 mt-2 text-[11px] text-gray-400">* Sent by Protohub. Open a data source → Events → Refresh from Meta for Meta's own count.</p> : null}
            </div>
          </Card>
        }
        panel={current ? <SourcePanel key={current.id} id={current.id} onClose={() => { setSelected(null); setClosed(true); }} onToast={onToast} onChanged={reload} onEdit={() => setEditing(current)} /> : null}
      />
      {modals}
    </div>
  );
}

function SourcePanel({ id, onClose, onToast, onChanged, onEdit }: { id: string; onClose: () => void; onToast: Toast; onChanged: () => void; onEdit: () => void }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.dataSource(id), [id]);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [busy, setBusy] = useState("");
  if (!data) return <LoadState error={error} onRetry={reload} />;
  const [tone, text] = sourceTone(data);
  const run = async (key: string, action: () => Promise<void>) => { setBusy(key); try { await action(); } catch (err: any) { onToast(err?.message ?? "Something went wrong."); } finally { setBusy(""); } };
  const test = () => run("test", async () => { const r = await trackingHubApi.testDataSource(data.id); onToast(r.ok ? r.message : r.human?.title ?? r.message); reload(); onChanged(); });
  const refresh = () => run("refresh", async () => { await trackingHubApi.refreshDataSource(data.id); onToast("Loaded Meta's numbers."); reload(); onChanged(); });
  const connected = data.hasToken && data.lastCheckOk === true;
  const emqBar = (score: number | null) => (
    <div className="mt-1.5 flex items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (score ?? 0) * 10)}%` }} /></span>
      <span className="text-[12px] font-semibold text-gray-600">{score === null ? "—" : `${score}/10`}</span>
    </div>
  );
  const tones: Array<"green" | "blue" | "orange" | "purple"> = ["green", "blue", "orange", "purple"];
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <PlatformIcon platform={data.platform} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">{data.name}</h2><StatusPill tone={tone}>{text}</StatusPill></div>
          <p className="m-0 mt-0.5 text-[13px] text-gray-500">{data.description || `${PLATFORM_LABEL[data.platform]} data source${data.isMain ? " · default" : ""}`}</p>
        </div>
        <PanelClose onClose={onClose} />
      </div>
      <UnderlineTabs className="mt-3" value={tab} onChange={setTab} tabs={[{ key: "overview", label: "Overview" }, { key: "settings", label: "Settings" }, { key: "events", label: "Events" }, { key: "diagnostics", label: "Diagnostics" }, { key: "logs", label: "Logs" }]} />

      {tab === "overview" ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-gray-200 p-4 dark:border-slate-700">
            {connected ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 fill-emerald-500 text-white" /> : <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />}
            <div className="min-w-0 flex-1">
              <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">Connection Status</p>
              <p className="m-0 text-[13px] text-gray-600">{connected ? <><span className="font-semibold text-emerald-600">Connected</span> and working properly</> : !data.hasToken ? <span className="font-semibold text-rose-600">No access token saved</span> : data.lastCheckOk === false ? <span className="font-semibold text-rose-600">{data.lastCheckMessage ?? "Connection problem"}</span> : "Not tested yet"}</p>
              <p className="m-0 text-[12px] text-gray-400">{data.lastCheckAt ? `Last checked: ${ago(data.lastCheckAt)}` : "Never checked"}</p>
            </div>
            <button type="button" className={smallButton} disabled={Boolean(busy) || !data.hasToken} onClick={() => void test()}><RefreshCw className={`h-3.5 w-3.5 ${busy === "test" ? "animate-spin" : ""}`} /> Test Connection</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
              <div className="flex items-start gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Globe className="h-5 w-5" /></span>
                <div><p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">Browser Pixel</p><p className={`m-0 text-[12.5px] font-semibold ${data.browser.receiving ? "text-emerald-600" : "text-amber-600"}`}>{data.browser.receiving ? "Receiving events" : "No browser report yet"}</p><p className="m-0 text-[11.5px] text-gray-400">{data.browser.lastEventAt ? `Last event: ${ago(data.browser.lastEventAt)}` : "Re-copy the embed code to report browser events"}</p></div></div>
              <p className="m-0 mt-3 text-[12.5px] text-gray-600">Event Match Quality</p>{emqBar(data.browser.emq)}
            </div>
            <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
              <div className="flex items-start gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Server className="h-5 w-5" /></span>
                <div><p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">Conversions API</p><p className={`m-0 text-[12.5px] font-semibold ${data.capi.connected ? "text-emerald-600" : "text-rose-600"}`}>{data.capi.connected ? "Connected" : data.hasToken ? "Problem" : "Not connected"}</p><p className="m-0 text-[11.5px] text-gray-400">{data.capi.lastEventAt ? `Last event: ${ago(data.capi.lastEventAt)}` : "No server event sent yet"}</p></div></div>
              <p className="m-0 mt-3 text-[12.5px] text-gray-600">Event Match Quality</p>{emqBar(data.capi.emq)}
            </div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
            <p className="m-0 mb-2 text-[13px] font-bold text-gray-900 dark:text-slate-100">Dataset Information</p>
            {data.connectionName ? <DetailRow label="Connected through">{data.connectionName}{data.ownToken ? " (own token)" : ""}</DetailRow> : null}
            <DetailRow label="Pixel ID" copy={data.pixelId} onToast={onToast}>{data.pixelId}</DetailRow>
            <DetailRow label="Business Account" copy={data.businessName || null} onToast={onToast}>{data.businessName || "—"}</DetailRow>
            <DetailRow label="Ad Account" copy={data.adAccountIds[0] ?? null} onToast={onToast}>{data.adAccountLabel || data.adAccountIds.length ? `${data.adAccountLabel || "Ad account"}${data.adAccountIds.length ? ` (${data.adAccountIds.join(", ")})` : ""}` : "—"}</DetailRow>
            <DetailRow label="Dataset Name" copy={data.datasetName} onToast={onToast}>{data.datasetName ?? "— (Test Connection reads it)"}</DetailRow>
            <DetailRow label="Currency" copy={data.currency} onToast={onToast}>{data.currency}</DetailRow>
            <DetailRow label="Timezone" copy={data.timezone} onToast={onToast}>{data.timezone}</DetailRow>
          </div>
          <div>
            <div className="flex items-center justify-between"><p className="m-0 text-[13.5px] font-bold text-gray-900 dark:text-slate-100">Recent Events <span className="font-normal text-gray-500">(Last 24 hours)</span></p><button type="button" className="!min-h-0 text-[13px] font-semibold text-blue-600" onClick={() => setTab("events")}>View all →</button></div>
            {data.recentLoaded ? (
              <div className="mt-2 grid grid-cols-2 gap-2 min-[1700px]:grid-cols-4">{data.recent.map((item, index) => <MiniStat key={item.name} tone={tones[index]} value={nf(item.count)} label={item.name} change={item.change} />)}</div>
            ) : (
              <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 p-3 text-[12.5px] text-gray-500 dark:border-slate-700">Meta's event counts are not loaded yet.<button type="button" className={smallButton} disabled={Boolean(busy) || !data.hasToken} onClick={() => void refresh()}><RefreshCw className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} /> Refresh from Meta</button></div>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
            <a href={data.eventsManagerUrl} target="_blank" rel="noreferrer" className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg border border-blue-500 px-4 py-2.5 text-[13.5px] font-semibold text-blue-600 hover:bg-blue-50">Open in Meta Events Manager <ExternalLink className="h-4 w-4" /></a>
            <button type="button" disabled={!data.hasToken && data.status === "paused"} className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg border border-rose-300 bg-rose-50/40 px-4 py-2.5 text-[13.5px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40"
              onClick={() => { if (!window.confirm(`Disconnect ${data.name}? The token is removed: server events stop and Meta's numbers cannot be read until you paste a token again.`)) return; void run("disconnect", async () => { await trackingHubApi.disconnectDataSource(data.id); onToast("Disconnected."); reload(); onChanged(); }); }}><Trash2 className="h-4 w-4" /> Disconnect</button>
          </div>
        </div>
      ) : null}

      {tab === "settings" ? <div className="mt-4"><SourceForm source={data} onCancel={() => setTab("overview")} onSaved={() => { onToast("Data source saved."); reload(); onChanged(); setTab("overview"); }} /><button type="button" className={`${smallButton} mt-3`} onClick={onEdit}>Open in a larger window</button></div> : null}

      {tab === "events" ? (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-[12.5px] text-gray-500">{data.metaStatsAt ? `Meta's numbers loaded ${ago(data.metaStatsAt)}` : "Meta's numbers not loaded yet."}</p>
            <button type="button" className={smallButton} disabled={Boolean(busy) || !data.hasToken || data.platform !== "meta"} onClick={() => void refresh()}><RefreshCw className={`h-3.5 w-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} /> Refresh from Meta</button>
          </div>
          <table className={tableCls}>
            <thead><tr className="text-gray-500"><th>Event (Meta, last 7 days)</th><th className="text-right">This week</th><th className="text-right">Week before</th><th className="text-right">Change</th></tr></thead>
            <tbody>
              {Object.entries(data.counts7d ?? {}).sort((a, b) => b[1] - a[1]).map(([name, count]) => {
                const before = Number(data.prev7d?.[name] ?? 0);
                return <tr key={name} className={rowCls}><td className="py-2">{name}</td><td className="py-2 text-right font-semibold">{nf(count)}</td><td className="py-2 text-right text-gray-500">{data.prev7d ? nf(before) : "—"}</td><td className="py-2 text-right">{data.prev7d ? <Delta value={before > 0 ? ((count - before) / before) * 100 : count > 0 ? 100 : 0} /> : "—"}</td></tr>;
              })}
              {!data.counts7d ? <EmptyRow colSpan={4} text="Press Refresh from Meta." /> : null}
            </tbody>
          </table>
          <div>
            <p className="m-0 mb-1 text-[13px] font-bold text-gray-900 dark:text-slate-100">Server events sent by Protohub</p>
            <table className={tableCls}>
              <thead><tr className="text-gray-500"><th>Time</th><th>Order</th><th>Event</th><th>Status</th></tr></thead>
              <tbody>
                {data.sends.map((row) => <tr key={`${row.orderId}${row.event}${row.at}`} className={rowCls}><td className="py-2 text-gray-600">{ago(row.at)}</td><td className="py-2 font-semibold">{row.orderId}</td><td className="py-2">{row.event}</td><td className="py-2" title={row.message ?? ""}><StatusPill size="sm" tone={row.status === "sent" ? "green" : row.status === "dry_run" ? "blue" : "red"}>{row.test ? "Test" : row.status}</StatusPill></td></tr>)}
                {data.sends.length === 0 ? <EmptyRow colSpan={4} text="Nothing sent to this Pixel yet." /> : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "diagnostics" ? (
        <ul className="m-0 mt-4 list-none space-y-2 p-0">
          {data.issues.map((issue) => (
            <li key={issue.key} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
              <p className="m-0 flex items-center gap-2 text-[13.5px] font-bold text-gray-900 dark:text-slate-100"><StatusPill size="sm" tone={issue.level === "critical" ? "red" : issue.level === "warning" ? "orange" : "blue"}>{issue.level === "critical" ? "Critical" : issue.level === "warning" ? "Warning" : "Info"}</StatusPill>{issue.title}</p>
              <p className="m-0 mt-1 text-[12.5px] text-gray-600">{issue.detail}</p>
              <p className="m-0 mt-1 text-[12px] text-gray-500">{issue.action}</p>
            </li>
          ))}
          {data.issues.length === 0 ? <li className="py-8 text-center text-[13px] text-gray-500"><CheckCircle2 className="mx-auto mb-2 h-7 w-7 fill-emerald-500 text-white" />No problems found for this data source.</li> : null}
        </ul>
      ) : null}

      {tab === "logs" ? (
        <ul className="m-0 mt-4 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
          {data.logs.map((log, index) => (
            <li key={index} className="flex items-start justify-between gap-3 py-2.5 text-[13px]">
              <span><strong className="block text-gray-800 dark:text-slate-200">{auditLabel(log.action)}</strong><span className="text-[12px] text-gray-500">{log.by ?? "System"}{log.detail && (log.detail as any).message ? ` · ${(log.detail as any).message}` : ""}</span></span>
              <span className="shrink-0 text-[12px] text-gray-400">{ago(log.at)}</span>
            </li>
          ))}
          {data.logs.length === 0 ? <li className="py-8 text-center text-[13px] text-gray-500">No changes recorded yet.</li> : null}
        </ul>
      ) : null}
    </Card>
  );
}

export const auditLabel = (action: string) => ({
  data_source_connected: "Data source connected", data_source_updated: "Data source changed", data_source_deleted: "Data source deleted", data_source_disconnected: "Disconnected",
  connection_tested: "Connection tested", test_event_sent: "Test event sent", website_added: "Website added", website_updated: "Website changed", website_deleted: "Website deleted",
  website_scanned: "Website scanned", profile_created: "Profile created", profile_updated: "Profile changed", profile_deleted: "Profile deleted", link_created: "Tracking link created",
  link_updated: "Tracking link changed", link_deleted: "Tracking link deleted", link_checklist: "Go-live checklist ticked", links_activate: "Links activated", links_pause: "Links paused",
  links_delete: "Links deleted", reconciliation_note: "Reconciliation note", reconciliation_resolved: "Marked as resolved", reconciliation_refreshed: "Meta numbers refreshed", settings_changed: "Settings changed"
} as Record<string, string>)[action] ?? action.replace(/_/g, " ");

export function SourceForm({ source, onCancel, onSaved }: { source: HubDataSource | null; onCancel: () => void; onSaved: (id: string) => void }) {
  const [form, setForm] = useState({
    name: source?.name ?? "", platform: (source?.platform ?? "meta") as HubPlatform, description: source?.description ?? "", businessName: source?.businessName ?? "",
    pixelId: source?.pixelId ?? "", accessToken: "", adAccounts: (source?.adAccountIds ?? []).join(", "), adAccountLabel: source?.adAccountLabel ?? "",
    testEventCode: source?.testEventCode ?? "", isMain: source?.isMain ?? false, status: source?.status ?? "production", currency: source?.currency ?? "NGN", timezone: source?.timezone ?? "Africa/Lagos"
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await trackingHubApi.saveDataSource(source?.id ?? null, {
        name: form.name, platform: form.platform, description: form.description, businessName: form.businessName, pixelId: form.pixelId.trim(),
        accessToken: form.accessToken.trim() || undefined, adAccountIds: form.adAccounts.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
        adAccountLabel: form.adAccountLabel, testEventCode: form.testEventCode.trim(), isMain: form.isMain, status: form.status, currency: form.currency, timezone: form.timezone
      });
      onSaved(result.id);
    } catch (err: any) {
      setError(err?.message ?? "Could not save.");
      setBusy(false);
    }
  };
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Name<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Household Pixel" className={input} /></label>
        <label className={labelCls}>Platform<select value={form.platform} onChange={(e) => set({ platform: e.target.value as HubPlatform })} className={input}><option value="meta">Meta</option><option value="tiktok">TikTok</option><option value="google">Google</option><option value="snapchat">Snapchat</option><option value="other">Other</option></select></label>
        <label className={`${labelCls} sm:col-span-2`}>Description<input value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="Main pixel for household products campaigns" className={input} /></label>
        <label className={labelCls}>Business account<input value={form.businessName} onChange={(e) => set({ businessName: e.target.value })} placeholder="Protools Household" className={input} /></label>
        <label className={labelCls}>Dataset / Pixel ID<input value={form.pixelId} onChange={(e) => set({ pixelId: e.target.value })} placeholder="985124764502331" className={`${input} font-mono`} /></label>
        <label className={`${labelCls} sm:col-span-2`}>{source?.connectionId ? <>Own token <span className="font-normal text-gray-400">(optional: otherwise uses the {source.connectionName ?? "connection"} token)</span></> : "Access token (System User, with ads_read)"}<input type="password" autoComplete="off" value={form.accessToken} onChange={(e) => set({ accessToken: e.target.value })} placeholder={source?.ownToken ? "Own token saved: paste to replace" : source?.connectionId ? "Leave empty to use the connection's token" : "Paste from Meta Business Settings"} className={`${input} font-mono`} /></label>
        <label className={labelCls}>Ad account name<input value={form.adAccountLabel} onChange={(e) => set({ adAccountLabel: e.target.value })} placeholder="Household Ads" className={input} /></label>
        <label className={labelCls}>Ad account IDs (for Reconciliation)<input value={form.adAccounts} onChange={(e) => set({ adAccounts: e.target.value })} placeholder="act_238746321" className={`${input} font-mono`} /></label>
        <label className={labelCls}>Test Event Code (optional)<input value={form.testEventCode} onChange={(e) => set({ testEventCode: e.target.value })} placeholder="TEST12345" className={`${input} font-mono`} /></label>
        <label className={labelCls}>Status<select value={form.status} onChange={(e) => set({ status: e.target.value as HubDataSource["status"] })} className={input}><option value="production">Production</option><option value="testing">Testing (sends to Test Events)</option><option value="paused">Paused</option></select></label>
        <label className={labelCls}>Currency<select value={form.currency} onChange={(e) => set({ currency: e.target.value })} className={input}><option value="NGN">NGN</option><option value="USD">USD</option><option value="GHS">GHS</option><option value="KES">KES</option></select></label>
        <label className={labelCls}>Timezone<select value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} className={input}><option>Africa/Lagos</option><option>Africa/Accra</option><option>Africa/Nairobi</option><option>UTC</option></select></label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-gray-700 dark:text-slate-300 sm:col-span-2"><input type="checkbox" checked={form.isMain} onChange={(e) => set({ isMain: e.target.checked })} /> Default data source for {form.platform === "meta" ? "Meta" : PLATFORM_LABEL[form.platform]}</label>
      </div>
      {form.platform !== "meta" ? <p className="m-0 mt-2 text-[12px] text-amber-700">Protohub sends server events to Meta and TikTok. Google, Snapchat and other platforms are saved for reference only.</p> : null}
      {error ? <p className="m-0 mt-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className={smallButton} onClick={onCancel}>Cancel</button><button type="button" className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></div>
    </div>
  );
}

function TestEventModal({ sources, onClose, onToast }: { sources: HubDataSource[]; onClose: () => void; onToast: Toast }) {
  const meta = sources.filter((row) => row.platform === "meta");
  const [id, setId] = useState(meta.find((row) => row.testEventCode)?.id ?? meta[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const chosen = meta.find((row) => row.id === id);
  return (
    <Modal title="Send a test event" subtitle="A test Purchase goes to Meta Events Manager → Test Events. It does not count as a sale." onClose={onClose}>
      <label className={labelCls}>Data source<select value={id} onChange={(e) => setId(e.target.value)} className={input}>{meta.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.pixelId})</option>)}</select></label>
      {chosen && !chosen.testEventCode ? <p className="m-0 mt-2 text-[12.5px] text-amber-700">Add the Test Event Code to this data source first (Meta Events Manager → Test Events).</p> : null}
      {result ? <p className="m-0 mt-3 rounded-lg bg-gray-50 p-3 text-[13px] text-gray-800 dark:bg-slate-800 dark:text-slate-200">{result}</p> : null}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={smallButton} onClick={onClose}>Close</button>
        <button type="button" className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} disabled={busy || !chosen?.testEventCode || !chosen?.hasToken} onClick={async () => {
          setBusy(true);
          try { const r = await trackingHubApi.testEvent(id); setResult(r.message); } catch (err: any) { onToast(err?.message ?? "Could not send."); } finally { setBusy(false); }
        }}><Play className="h-4 w-4" /> {busy ? "Sending…" : "Send test Purchase"}</button>
      </div>
    </Modal>
  );
}
