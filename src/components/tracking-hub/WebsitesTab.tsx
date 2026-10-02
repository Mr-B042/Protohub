import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ChevronRight, ExternalLink, FileText, Globe, Layers, Link2, Plus, ScanLine, ShoppingCart, TriangleAlert, XCircle } from "lucide-react";
import { trackingHubApi, type HubWebsite, type HubWebsiteDetail } from "../../lib/api";
import {
  LoadState,
  ActionMenu, Card, CheckBox, Delta, EmptyRow, FilterSelect, HubHeader, Kpi, Loading, MenuButton, MiniStat, Modal, PanelClose, PlatformIcon, SearchBox, SetupGuide,
  SiteIcon, SplitLayout, STRATEGY_LABEL, StatusPill, UnderlineTabs, ago, darkButton, input, labelCls, nf, outlineButton, primaryButton, rowCls, smallButton,
  listTableCls, tableCls, useLoad, type Toast
} from "./HubParts";

// Websites tab - built to Bright's image (2 Oct 2026).

type PanelTab = "overview" | "pages" | "forms" | "tracking" | "diagnostics" | "settings";
const PAGE_STATUS: Record<HubWebsiteDetail["landingStats"][number]["status"], ["green" | "orange" | "red" | "gray", string]> = {
  ok: ["green", "Matches"], no_link: ["gray", "No link"], not_checked: ["gray", "Not checked"], missing_pixel: ["red", "No Pixel"], two_pixels: ["orange", "Two Pixels"], wrong_pixel: ["red", "Wrong Pixel"]
};
const PAGE_HELP: Record<HubWebsiteDetail["landingStats"][number]["status"], string> = {
  ok: "The page loads the Pixel its tracking link uses.", no_link: "No tracking link names this page yet: create one in Tracking Links.",
  not_checked: "Press Test Website, or wait for a browser report from the new embed code.", missing_pixel: "The page loads no Meta Pixel: add the Pixel's base code to this page.",
  two_pixels: "The page loads more than one Pixel: remove the extra (often a site-wide theme or plugin Pixel).", wrong_pixel: "The page does not load every Pixel its tracking link uses (the link's code loads a missing one when a sale happens, but page views go uncounted)."
};
const STATUS_PILL: Record<HubWebsite["status"], ["green" | "orange" | "red", string]> = { healthy: ["green", "Healthy"], warning: ["orange", "Warning"], disconnected: ["red", "Disconnected"] };

export default function WebsitesTab({ tabBar, onToast }: { tabBar: ReactNode; onToast: Toast }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.websites(), []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [editing, setEditing] = useState<HubWebsite | { domain: string } | null>(null);
  const [guide, setGuide] = useState(false);
  const [scanTick, setScanTick] = useState(0);
  useEffect(() => { if (!selected && !closed && data?.websites.length) setSelected(data.websites[0].id); }, [data]);
  const rows = useMemo(() => (data?.websites ?? []).filter((site) =>
    (!status || site.status === status) && (!q || `${site.domain} ${site.label} ${site.dataSourceName ?? ""} ${site.landingPages.join(" ")}`.toLowerCase().includes(q.toLowerCase()))), [data, q, status]);

  const scan = (site: HubWebsite) => {
    setSelected(site.id);
    setClosed(false);
    setScanTick((value) => value + 1);
  };
  const header = (
    <HubHeader title="Websites" subtitle="Manage your websites, landing pages and tracking configurations."
      actions={<>
        <button type="button" className={outlineButton} onClick={() => setGuide(true)}><BookOpen className="h-4 w-4" /> View Setup Guide</button>
        <MenuButton label="Scan Website" icon={<ScanLine className="h-4 w-4" />} items={(data?.websites ?? []).map((site) => ({ label: site.domain, onClick: () => scan(site) }))} />
        <button type="button" className={primaryButton} onClick={() => setEditing({ domain: "" })}><Plus className="h-5 w-5" /> Add Website</button>
      </>} />
  );
  const modals = <>
    {guide ? <SetupGuide onClose={() => setGuide(false)} /> : null}
    {editing && data ? <Modal title={"id" in editing ? `Edit ${editing.domain}` : "Add Website"} onClose={() => setEditing(null)}>
      <WebsiteForm site={editing} sources={data.dataSources} detected={data.detected} onCancel={() => setEditing(null)} onSaved={(id) => { setEditing(null); onToast("Website saved."); setSelected(id); reload(); }} />
    </Modal> : null}
  </>;
  if (!data) return <div className="space-y-5">{header}{tabBar}<Loading error={error} onRetry={reload} /></div>;
  const k = data.kpis;
  const current = data.websites.find((site) => site.id === selected) ?? null;

  return (
    <div className="space-y-5">
      {header}
      {tabBar}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Kpi icon={<Link2 className="h-6 w-6" />} tone="blue" label="Total Websites" value={nf(k.total)} delta={<span className="leading-tight"><Delta value={k.newThisMonth} suffix="" /><span className="block text-[11.5px] font-normal text-gray-400">vs last month</span></span>} />
        <Kpi icon={<Globe className="h-6 w-6" />} tone="blue" label="WordPress Sites" value={nf(k.wordpress)} sub={`${k.wordpressPct}%`} />
        <Kpi icon={<Link2 className="h-6 w-6" />} tone="green" label="Healthy Sites" value={nf(k.healthy)} sub={`${k.healthyPct}%`} />
        <Kpi icon={<TriangleAlert className="h-6 w-6" />} tone="orange" label="With Issues" value={nf(k.withIssues)} sub={`${k.withIssuesPct}%`} />
        <Kpi icon={<Layers className="h-6 w-6" />} tone="blue" label="Landing Pages" value={nf(k.landingPages)} sub="across all sites" />
        <Kpi icon={<FileText className="h-6 w-6" />} tone="purple" label="External Forms" value={nf(k.externalForms)} sub="active" />
      </div>

      <SplitLayout
        list={
          <Card className="p-4">
            <h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">All Websites</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <SearchBox value={q} onChange={setQ} placeholder="Search websites, domains or products..." className="min-w-[220px] flex-1" />
              <FilterSelect value={status} onChange={setStatus} className="w-40"><option value="">All Status</option><option value="healthy">Healthy</option><option value="warning">Warning</option><option value="disconnected">Disconnected</option></FilterSelect>
              <button type="button" className={`${primaryButton} !py-2.5`} onClick={() => setEditing({ domain: "" })}><Plus className="h-4 w-4" /> Add Website</button>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className={listTableCls}>
                <thead><tr className="bg-gray-50/70 text-gray-500 dark:bg-slate-800/40">
                  <th className="w-8"><CheckBox checked={rows.length > 0 && checked.length === rows.length} onChange={(value) => setChecked(value ? rows.map((row) => row.id) : [])} /></th>
                  <th>Website / Domain</th><th>Platform</th><th>Default Pixel</th><th className="text-center">Landing<br />Pages</th><th className="text-center">Forms</th><th>Status</th><th>Last Event</th><th className="text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {rows.map((site) => {
                    const [tone, text] = STATUS_PILL[site.status];
                    return (
                      <tr key={site.id} onClick={() => { setSelected(site.id); setClosed(false); }} className={`${rowCls} cursor-pointer ${selected === site.id ? "bg-blue-50/60 dark:bg-blue-950/20" : "hover:bg-gray-50 dark:hover:bg-slate-800/40"}`}>
                        <td className="py-3.5"><CheckBox checked={checked.includes(site.id) || selected === site.id} onChange={(value) => setChecked((list) => value ? [...list, site.id] : list.filter((id) => id !== site.id))} /></td>
                        <td className="py-3.5"><span className="flex items-center gap-2.5"><SiteIcon platform={site.platform} /><span><strong className="block font-semibold">{site.domain}</strong><span className="text-[11.5px] text-gray-500">{site.label || site.notes || "—"}</span></span></span></td>
                        <td className="py-3.5 text-gray-600">{site.platform}</td>
                        <td className="max-w-[120px] py-3.5">{site.dataSourceName ? <span className="flex items-center gap-2"><PlatformIcon platform={site.dataSourcePlatform} size="sm" /><span className="min-w-0"><span className="block truncate text-gray-700 dark:text-slate-200" title={site.dataSourceName}>{site.dataSourceName}</span>{site.dataSourceIsMain ? <span className="inline-block rounded bg-blue-50 px-1.5 text-[10.5px] font-semibold text-blue-700">Default</span> : null}</span></span> : <span className="text-gray-400">—</span>}</td>
                        <td className="py-3.5 text-center text-gray-600">{site.landingPages.length}</td>
                        <td className="py-3.5 text-center text-gray-600">{site.forms}</td>
                        <td className="py-3.5" title={site.problems.join(" · ")}><StatusPill tone={tone}>{text}</StatusPill></td>
                        <td className="py-3.5 text-gray-500">{site.lastEvent ? ago(site.lastEvent) : "-"}</td>
                        <td className="py-3.5 text-right"><ActionMenu items={[
                          { label: "Open", onClick: () => { setSelected(site.id); setClosed(false); } },
                          { label: "Scan website", onClick: () => scan(site) },
                          { label: "Edit", onClick: () => setEditing(site) },
                          { label: "Delete", danger: true, onClick: async () => { if (!window.confirm(`Delete ${site.domain}?`)) return; await trackingHubApi.deleteWebsite(site.id); if (selected === site.id) setSelected(null); reload(); } }
                        ]} /></td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 ? <EmptyRow colSpan={9} text={data.websites.length === 0 ? <>No website added yet. <button type="button" className="!min-h-0 font-bold text-blue-600" onClick={() => setEditing({ domain: "" })}>Add one</button></> : "No website matches."} /> : null}
                </tbody>
              </table>
            </div>
          </Card>
        }
        panel={current ? <WebsitePanel key={current.id} id={current.id} scanTick={scanTick} onClose={() => { setSelected(null); setClosed(true); }} onToast={onToast} onChanged={reload} onEdit={() => setEditing(current)}
          sources={data.dataSources} onDeleted={() => { setSelected(null); reload(); }} /> : null}
      />
      {modals}
    </div>
  );
}

function WebsitePanel({ id, scanTick, onClose, onToast, onChanged, onEdit, onDeleted, sources }: { id: string; scanTick: number; onClose: () => void; onToast: Toast; onChanged: () => void; onEdit: () => void; onDeleted: () => void; sources: Array<{ id: string; name: string; platform: string; isMain: boolean }> }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.website(id), [id]);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [scanning, setScanning] = useState(false);
  const [summary, setSummary] = useState<string[]>([]);
  const scan = async () => {
    setScanning(true);
    try {
      const result = await trackingHubApi.scanWebsite(id);
      setSummary(result.summary);
      onToast("Website scanned.");
      reload();
      onChanged();
    } catch (err: any) {
      onToast(err?.message ?? "Could not scan.");
    } finally {
      setScanning(false);
    }
  };
  const [lastTick, setLastTick] = useState(scanTick);
  useEffect(() => { if (scanTick !== lastTick) { setLastTick(scanTick); setTab("tracking"); void scan(); } }, [scanTick]);
  if (!data) return <LoadState error={error} onRetry={reload} />;
  const [tone, text] = STATUS_PILL[data.status];
  const failing = data.checks.filter((check) => !check.ok).length;
  const tones: Array<"green" | "blue" | "green" | "purple"> = ["green", "blue", "green", "purple"];
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <SiteIcon platform={data.platform} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 truncate text-[17px] font-black text-gray-900 dark:text-slate-100">{data.domain}</h2><StatusPill size="sm" tone={tone}>{text}</StatusPill></div>
          <p className="m-0 text-[12px] text-gray-600">{data.domain}</p>
          <p className="m-0 line-clamp-1 text-[11.5px] text-gray-400">{data.notes || data.label || ""}</p>
        </div>
        <a href={data.siteUrl} target="_blank" rel="noreferrer" className={`${smallButton} !border-blue-200 !text-blue-600`}>Open Site <ExternalLink className="h-3.5 w-3.5" /></a>
        <ActionMenu items={[{ label: "Edit", onClick: onEdit }, { label: "Scan website", onClick: () => void scan() }, { label: "Delete", danger: true, onClick: async () => { if (!window.confirm(`Delete ${data.domain}?`)) return; await trackingHubApi.deleteWebsite(data.id); onDeleted(); } }]} />
        <PanelClose onClose={onClose} />
      </div>
      <UnderlineTabs className="mt-3" value={tab} onChange={setTab} tabs={[{ key: "overview", label: "Overview" }, { key: "pages", label: "Landing Pages" }, { key: "forms", label: "Forms" }, { key: "tracking", label: "Tracking" }, { key: "diagnostics", label: "Diagnostics" }, { key: "settings", label: "Settings" }]} />

      {tab === "overview" ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700"><SiteIcon platform={data.platform} /><div className="min-w-0"><p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">Platform</p><p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">{data.platform}</p><p className="m-0 text-[11.5px] text-gray-400">{data.lastScanAt ? "Checked by the last scan" : "Set when the site was added"}</p></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
              <PlatformIcon platform={data.dataSource?.platform ?? "meta"} />
              <div className="min-w-0"><p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">Pixels on this site</p>
                <p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">{data.pixelCount} Pixel{data.pixelCount === 1 ? "" : "s"} <button type="button" className="!min-h-0 text-[12px] font-semibold text-blue-600" onClick={() => setTab("pages")}>by page →</button></p>
                <p className="m-0 truncate text-[11.5px] text-gray-400">{data.dataSource ? `Default: ${data.dataSource.name}` : "No default: each link chooses"}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-gray-200 p-3 dark:border-slate-700"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600"><Layers className="h-5 w-5" /></span><div className="min-w-0"><p className="m-0 whitespace-nowrap text-[11.5px] text-gray-500">Landing Pages</p><strong className="block text-[22px] font-black text-gray-900 dark:text-slate-100">{data.landingPages.length}</strong><button type="button" className="!min-h-0 inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-blue-600" onClick={() => setTab("pages")}>View pages <ArrowRight className="h-3 w-3" /></button></div></div>
            <div className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-gray-200 p-3 dark:border-slate-700"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><FileText className="h-5 w-5" /></span><div className="min-w-0"><p className="m-0 whitespace-nowrap text-[11.5px] text-gray-500">Active Forms</p><strong className="block text-[22px] font-black text-gray-900 dark:text-slate-100">{data.activeForms}</strong><button type="button" className="!min-h-0 inline-flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-blue-600" onClick={() => setTab("forms")}>View forms <ArrowRight className="h-3 w-3" /></button></div></div>
            <div className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl border border-gray-200 p-3 dark:border-slate-700"><span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600"><ShoppingCart className="h-5 w-5" /></span><div className="min-w-0"><p className="m-0 whitespace-nowrap text-[11.5px] text-gray-500">Total Orders (30d)</p><strong className="block text-[22px] font-black text-gray-900 dark:text-slate-100">{nf(data.orders30d)}</strong><Delta value={data.orders30dChange} /></div></div>
          </div>
          <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
            <div className="flex items-start gap-3">
              {failing === 0 ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 fill-emerald-500 text-white" /> : <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-amber-500" />}
              <div className="flex-1"><p className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">Tracking Status</p><p className="m-0 text-[12.5px] text-gray-600">{failing === 0 ? "All systems working properly" : `${failing} check${failing === 1 ? "" : "s"} need${failing === 1 ? "s" : ""} attention`}</p><p className="m-0 text-[11.5px] text-gray-400">{data.lastScanAt ? `Last checked: ${ago(data.lastScanAt)}` : "Not scanned yet"}</p></div>
              <button type="button" className={smallButton} disabled={scanning} onClick={() => void scan()}><ScanLine className="h-3.5 w-3.5" /> {scanning ? "Testing…" : "Test Website"}</button>
            </div>
            <ul className="m-0 mt-3 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
              {data.checks.map((check) => (
                <li key={check.key}><button type="button" onClick={() => setTab(check.key === "browser" || check.key === "duplicate" ? "tracking" : "diagnostics")} className="!min-h-0 flex w-full items-center justify-between gap-3 py-2 text-left text-[13px]">
                  <span className="text-gray-700 dark:text-slate-300">{check.label}</span>
                  <span className={`flex items-center gap-1.5 text-right font-semibold ${check.ok ? "text-emerald-600" : "text-amber-600"}`}>{check.ok ? <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" /> : <TriangleAlert className="h-4 w-4" />}{check.value}<ChevronRight className="h-4 w-4 text-gray-400" /></span>
                </button></li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex items-center justify-between"><p className="m-0 text-[13.5px] font-bold text-gray-900 dark:text-slate-100">Recent Events <span className="font-normal text-gray-500">(Last 24 hours)</span></p><button type="button" className="!min-h-0 text-[13px] font-semibold text-blue-600" onClick={() => setTab("tracking")}>View all →</button></div>
            <div className="mt-2 grid grid-cols-2 gap-2 min-[1700px]:grid-cols-4">{data.recent.map((item, index) => <MiniStat key={item.name} tone={tones[index]} value={nf(item.count)} label={item.name} change={item.change} />)}</div>
            <p className="m-0 mt-1 text-[11px] text-gray-400">PageView = form views, InitiateCheckout = form starts, AddToCart = order button presses, Purchase = orders. Today vs yesterday.</p>
          </div>
        </div>
      ) : null}

      {tab === "pages" ? (
        <div className="mt-4">
          <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
            {data.landingStats.map((row) => {
              const [tone, text] = PAGE_STATUS[row.status];
              return (
                <li key={row.path} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0"><a href={`${data.siteUrl}${row.path}`} target="_blank" rel="noreferrer" className="text-[13.5px] font-semibold text-blue-600">{row.path}</a><span className="block truncate text-[11.5px] text-gray-500">{row.link ?? "No tracking link"} · {nf(row.orders30d)} orders (30d)</span></span>
                    <span title={PAGE_HELP[row.status]}><StatusPill size="sm" tone={tone}>{text}</StatusPill></span>
                  </div>
                  <dl className="m-0 mt-1.5 grid grid-cols-[86px_1fr] gap-y-0.5 text-[12px]">
                    <dt className="text-gray-500">Link uses</dt><dd className="m-0 text-gray-800 dark:text-slate-200">{row.expectedPixel ? `${row.expectedPixel.name}${row.expectedPixel.fromDefault ? " (site default)" : ""}` : "—"}</dd>
                    {row.extraPixels.length ? <><dt className="text-gray-500">Also sends to</dt><dd className="m-0 text-gray-800 dark:text-slate-200">{row.extraPixels.map((pixel) => `${pixel.name}${row.status === "not_checked" ? "" : pixel.seen ? " ✓" : " (not loaded)"}`).join(", ")}</dd></> : null}
                    {row.extraPixels.length ? <><dt className="text-gray-500">Also sends to</dt><dd className="m-0 text-gray-800 dark:text-slate-200">{row.extraPixels.map((pixel) => `${pixel.name}${row.status === "not_checked" ? "" : pixel.seen ? " ✓" : " (not loaded)"}`).join(", ")}</dd></> : null}
                    <dt className="text-gray-500">Page loads</dt><dd className="m-0 break-all text-gray-800 dark:text-slate-200">{row.foundPixels.length ? row.foundPixels.map((pixel) => pixel.name ?? pixel.id).join(", ") : row.status === "not_checked" ? <span className="text-gray-400">Not checked yet</span> : "None"}{row.lastBrowserEvent ? <span className="text-gray-400"> · browser report {ago(row.lastBrowserEvent)}</span> : null}</dd>
                  </dl>
                  {row.status !== "ok" ? <p className="m-0 mt-1 text-[11.5px] text-gray-500">{PAGE_HELP[row.status]}</p> : null}
                </li>
              );
            })}
            {data.landingStats.length === 0 ? <li className="py-8 text-center text-[13px] text-gray-500">No landing page seen yet. Pages appear once the new embed code reports them, or when a tracking link names one.</li> : null}
          </ul>
          {data.landingStats.some((row) => row.status === "not_checked") ? <p className="m-0 mt-2 text-[11.5px] text-gray-500">Press Test Website to check what each page loads.</p> : null}
        </div>
      ) : null}

      {tab === "forms" ? (
        <table className={`${tableCls} mt-4`}>
          <thead><tr className="text-gray-500"><th>Tracking link / form</th><th>Landing page</th><th>Strategy</th><th>Status</th></tr></thead>
          <tbody>
            {data.forms.map((form) => <tr key={form.id} className={rowCls}><td className="py-2.5 font-semibold">{form.label}</td><td className="py-2.5 text-gray-600">{form.landingPath ?? "—"}</td><td className="py-2.5 text-gray-600">{STRATEGY_LABEL[form.strategy]}</td><td className="py-2.5"><StatusPill size="sm" tone={form.active ? "green" : "gray"}>{form.active ? "Active" : "Paused"}</StatusPill></td></tr>)}
            {data.forms.length === 0 ? <EmptyRow colSpan={4} text="No tracking link points at this website yet." /> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "tracking" ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between"><p className="m-0 text-[12.5px] text-gray-500">{data.lastScanAt ? `Last scan ${ago(data.lastScanAt)}` : "Not scanned yet."}</p><button type="button" className={smallButton} disabled={scanning} onClick={() => void scan()}><ScanLine className="h-3.5 w-3.5" /> {scanning ? "Scanning…" : "Scan now"}</button></div>
          {summary.length ? <ul className="m-0 list-disc rounded-lg bg-blue-50/60 py-2 pl-6 pr-3 text-[12.5px] text-blue-900">{summary.map((line) => <li key={line}>{line}</li>)}</ul> : null}
          <table className={tableCls}>
            <thead><tr className="text-gray-500"><th>Page</th><th>Pixel(s) found</th><th>Protohub form</th><th>Purchase on page</th></tr></thead>
            <tbody>
              {(data.lastScan?.pages ?? []).map((page) => (
                <tr key={page.url} className={rowCls}>
                  <td className="max-w-[220px] truncate py-2.5" title={page.url}><span className="block text-[11px] uppercase text-gray-400">{page.kind.replace("_", "-")}</span>{page.ok ? page.url.replace(/^https?:\/\//, "") : <span className="text-rose-600">{page.url.replace(/^https?:\/\//, "")} — {page.error ?? `HTTP ${page.status}`}</span>}</td>
                  <td className="py-2.5 text-gray-600">{page.pixels.length ? page.pixels.join(", ") : page.usesTagManager ? "Tag Manager" : "None"}</td>
                  <td className="py-2.5">{page.protohubForm ? <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" /> : <XCircle className="h-4 w-4 text-gray-300" />}</td>
                  <td className="py-2.5">{page.purchaseOnPage ? <span className="font-semibold text-amber-600">Yes</span> : "No"}</td>
                </tr>
              ))}
              {!data.lastScan?.pages?.length ? <EmptyRow colSpan={4} text="Press Scan now to load this website's pages and look for the Pixel." /> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "diagnostics" ? (
        <ul className="m-0 mt-4 list-none space-y-2 p-0">
          {data.issues.map((issue) => <li key={issue.key} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700"><p className="m-0 text-[13.5px] font-bold text-gray-900 dark:text-slate-100">{issue.title}</p><p className="m-0 mt-1 text-[12.5px] text-gray-600">{issue.detail}</p><p className="m-0 mt-1 text-[12px] text-gray-500">{issue.action}</p></li>)}
          {data.problems.length === 0 && data.issues.length === 0 ? <li className="py-8 text-center text-[13px] text-gray-500"><CheckCircle2 className="mx-auto mb-2 h-7 w-7 fill-emerald-500 text-white" />No problems found for this website.</li> : null}
        </ul>
      ) : null}

      {tab === "settings" ? <div className="mt-4"><WebsiteForm site={data} sources={sources} detected={[]} onCancel={() => setTab("overview")} onSaved={() => { onToast("Website saved."); reload(); onChanged(); setTab("overview"); }} /></div> : null}
    </Card>
  );
}

export function WebsiteForm({ site, sources, detected, onCancel, onSaved }: { site: HubWebsite | { domain: string }; sources: Array<{ id: string; name: string }>; detected: Array<{ domain: string; orders30d: number }>; onCancel: () => void; onSaved: (id: string) => void }) {
  const existing = "id" in site ? site : null;
  const [form, setForm] = useState({ domain: site.domain, label: existing?.label ?? "", platform: existing?.platform ?? "WordPress", dataSourceId: existing?.dataSourceId ?? "", notes: existing?.notes ?? "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div>
      {!existing && detected.length ? (
        <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
          <p className="m-0 text-[12.5px] font-semibold text-blue-900">Found in your orders (last 30 days), not added yet:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{detected.map((row) => <button key={row.domain} type="button" className={smallButton} onClick={() => setForm((value) => ({ ...value, domain: row.domain }))}>{row.domain} · {row.orders30d}</button>)}</div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelCls}>Domain<input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="brightpathhubs.com" className={input} /></label>
        <label className={labelCls}>Name<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Main Store" className={input} /></label>
        <label className={labelCls}>Platform<select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} className={input}><option>WordPress</option><option>Shopify</option><option>Custom</option><option>Other</option></select></label>
        <label className={labelCls}>Default Pixel <span className="font-normal text-gray-400">(optional)</span><select value={form.dataSourceId} onChange={(e) => setForm({ ...form, dataSourceId: e.target.value })} className={input}><option value="">None: each landing page's link chooses</option>{sources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><span className="mt-1 block text-[11.5px] font-normal text-gray-500">One site can sell many products: each landing page's tracking link can use its own Pixel. This is only used when a link doesn't name one.</span></label>
        <label className={`${labelCls} sm:col-span-2`}>Description<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Main store for household products and bathroom accessories" className={input} /></label>
      </div>
      {error ? <p className="m-0 mt-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-4 flex justify-end gap-2"><button type="button" className={smallButton} onClick={onCancel}>Cancel</button>
        <button type="button" disabled={busy} className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} onClick={async () => {
          setBusy(true);
          setError("");
          try { const result = await trackingHubApi.saveWebsite(existing?.id ?? null, { ...form, dataSourceId: form.dataSourceId || null, notes: form.notes || null }); onSaved(result.id); } catch (err: any) { setError(err?.message ?? "Could not save."); setBusy(false); }
        }}>{busy ? "Saving…" : "Save"}</button></div>
    </div>
  );
}

