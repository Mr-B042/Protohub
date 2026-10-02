import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BookOpen, ChartColumn, CheckCircle2, Copy, Database, ExternalLink, Eye, Link2, Pencil, Percent, Plus, ShoppingCart, TriangleAlert } from "lucide-react";
import { buildEmbedSnippet } from "../../lib/embed-snippet";
import { trackingHubApi, type HubLink, type HubLinksResponse, type HubStrategy } from "../../lib/api";
import {
  LoadState,
  ActionMenu, Card, CheckBox, Delta, EmptyRow, FilterSelect, HubHeader, Kpi, Loading, MenuButton, Modal, Pagination, PanelClose, PlatformIcon, ProductThumb,
  SearchBox, SetupGuide, Sparkline, SplitLayout, STRATEGY_LABEL, StatusPill, UnderlineTabs, ago, copyText, darkButton, dateTime, input, labelCls, naira, nf, outlineButton,
  primaryButton, rowCls, selectCls, shortDay, smallButton, smallBlueButton, listTableCls, tableCls, timeOf, useLoad, LEDGER_TONE, type Toast
} from "./HubParts";

// Tracking Links tab - built to Bright's image (2 Oct 2026).

type PanelTab = "overview" | "campaigns" | "attribution" | "events" | "settings";
type SortKey = "label" | "product" | "website" | "source";
const STATUS_PILL: Record<HubLink["status"], ["green" | "orange" | "red" | "gray", string]> = { healthy: ["green", "Healthy"], needs_review: ["orange", "Needs Review"], low_performance: ["red", "Low Performance"], paused: ["gray", "Paused"] };

export function embedUrlFor(link: HubLink) {
  const params = new URLSearchParams();
  if (link.productId) params.set("product", link.productId);
  if (link.redirectUrl) params.set("redirect_url", link.redirectUrl);
  if (link.strategy !== "landing_page" && link.strategy !== "off") {
    params.set("tracking_mode", link.strategy === "capi_only" ? "protohub" : "hybrid");
    if (link.pixelId) params.set("meta_pixel_id", link.pixelId);
    if (link.testEventCode) { params.set("meta_test", "1"); params.set("meta_test_event_code", link.testEventCode); }
  }
  params.set("meta_tracking_key", link.trackingKey);
  params.set("embed_label", link.formLabel || link.label);
  return `${window.location.origin}${window.location.pathname}#/order-form/embed?${params.toString()}`;
}

export default function LinksTab({ tabBar, onToast, createSignal }: { tabBar: ReactNode; onToast: Toast; createSignal: number }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.links(), []);
  const [filters, setFilters] = useState({ q: "", productId: "", websiteId: "", dataSourceId: "", status: "" });
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "label", dir: 1 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [guide, setGuide] = useState(false);
  useEffect(() => { if (createSignal > 0) setCreating(true); }, [createSignal]);
  useEffect(() => { if (!selected && !closed && data?.links.length) setSelected(data.links[0].id); }, [data]);
  const rows = useMemo(() => {
    const list = (data?.links ?? []).filter((link) =>
      (!filters.q || `${link.label} ${link.landingPageUrl} ${link.productName ?? ""} ${link.formLabel}`.toLowerCase().includes(filters.q.toLowerCase()))
      && (!filters.productId || link.productId === filters.productId) && (!filters.websiteId || link.websiteId === filters.websiteId)
      && (!filters.dataSourceId || link.dataSourceId === filters.dataSourceId) && (!filters.status || link.status === filters.status));
    const value = (link: HubLink) => (sort.key === "label" ? link.label : sort.key === "product" ? link.productName ?? "" : sort.key === "website" ? link.websiteDomain ?? "" : link.dataSourceName ?? "").toLowerCase();
    return list.sort((a, b) => value(a).localeCompare(value(b)) * sort.dir);
  }, [data, filters, sort]);
  useEffect(() => { setPage(1); }, [filters, pageSize]);

  const bulk = async (action: "activate" | "pause" | "delete") => {
    if (checked.length === 0) { onToast("Tick the links first."); return; }
    if (action === "delete" && !window.confirm(`Delete ${checked.length} link${checked.length === 1 ? "" : "s"}? Pages using their code keep working but lose server tracking.`)) return;
    try { await trackingHubApi.bulkLinks(checked, action); setChecked([]); onToast("Done."); reload(); } catch (err: any) { onToast(err?.message ?? "Could not update."); }
  };
  const header = (
    <HubHeader title="Tracking Links" subtitle="Create and manage your campaign links for all landing pages and products."
      actions={<>
        <button type="button" className={outlineButton} onClick={() => setGuide(true)}><BookOpen className="h-4 w-4" /> View Setup Guide</button>
        <MenuButton label={`Bulk Actions${checked.length ? ` (${checked.length})` : ""}`} items={[{ label: "Activate", onClick: () => void bulk("activate") }, { label: "Pause", onClick: () => void bulk("pause") }, { label: "Delete", danger: true, onClick: () => void bulk("delete") }]} />
        <button type="button" className={primaryButton} onClick={() => setCreating(true)}><Plus className="h-5 w-5" /> Create Tracking Link</button>
      </>} />
  );
  const modals = <>
    {guide ? <SetupGuide onClose={() => setGuide(false)} /> : null}
    {creating && data ? <Modal title="Create Tracking Link" subtitle="One link per landing page and form." onClose={() => setCreating(false)} wide>
      <LinkForm link={null} meta={data} onToast={onToast} onSaved={(id) => { setCreating(false); setSelected(id); setClosed(false); reload(); }} onCancel={() => setCreating(false)} />
    </Modal> : null}
  </>;
  if (!data) return <div className="space-y-5">{header}{tabBar}<Loading error={error} onRetry={reload} /></div>;
  const k = data.kpis;
  const current = data.links.find((link) => link.id === selected) ?? null;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const sortHead = (key: SortKey, label: string) => <button type="button" onClick={() => setSort((value) => ({ key, dir: value.key === key ? (value.dir === 1 ? -1 : 1) : 1 }))} className="!min-h-0 inline-flex items-center gap-1 font-semibold">{label}<span className="text-[10px] text-gray-400">{sort.key === key ? (sort.dir === 1 ? "▲" : "▼") : "⇅"}</span></button>;

  return (
    <div className="space-y-5">
      {header}
      {tabBar}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<Link2 className="h-7 w-7" />} tone="blue" label="Total Tracking Links" value={nf(k.total)} delta={<span className="leading-tight"><Delta value={k.newThisMonth} suffix="" /><span className="block text-[11.5px] font-normal text-gray-400">vs last month</span></span>} />
        <Kpi icon={<ShoppingCart className="h-7 w-7" />} tone="red" label="Total Orders" value={nf(k.orders)} delta={<Delta value={k.ordersChange} />} sub="last 7 days" />
        <Kpi icon={<ChartColumn className="h-7 w-7" />} tone="blue" label="Total Page Views" value={nf(k.pageViews)} delta={<Delta value={k.pageViewsChange} />} sub="last 7 days" />
        <Kpi icon={<Percent className="h-7 w-7" />} tone="purple" label="Conversion Rate" value={`${k.conversionRate}%`} delta={<Delta value={k.conversionRateChange} />} sub="orders ÷ page views" />
        <Kpi icon={<CheckCircle2 className="h-7 w-7" />} tone="green" label="Healthy Links" value={`${k.healthy}/${k.total}`} delta={<span className="text-[13px] font-bold text-emerald-600">{k.healthyPct}%</span>} />
      </div>

      <SplitLayout
        list={
          <Card className="p-4">
            <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Search links, landing pages, products or campaigns..." />
            <div className="mt-3 flex flex-wrap gap-2">
              <FilterSelect value={filters.websiteId} onChange={(websiteId) => setFilters({ ...filters, websiteId })} className="w-40"><option value="">All Websites</option>{data.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</FilterSelect>
              <FilterSelect value={filters.productId} onChange={(productId) => setFilters({ ...filters, productId })} className="w-40"><option value="">All Products</option>{data.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</FilterSelect>
              <FilterSelect value={filters.dataSourceId} onChange={(dataSourceId) => setFilters({ ...filters, dataSourceId })} className="w-40"><option value="">All Data Sources</option>{data.dataSources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</FilterSelect>
              <FilterSelect value={filters.status} onChange={(status) => setFilters({ ...filters, status })} className="w-36"><option value="">All Status</option><option value="healthy">Healthy</option><option value="needs_review">Needs Review</option><option value="low_performance">Low Performance</option><option value="paused">Paused</option></FilterSelect>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className={listTableCls}>
                <thead><tr className="bg-gray-50/70 text-gray-500 dark:bg-slate-800/40">
                  <th className="w-8"><CheckBox checked={pageRows.length > 0 && pageRows.every((row) => checked.includes(row.id))} onChange={(value) => setChecked(value ? Array.from(new Set([...checked, ...pageRows.map((row) => row.id)])) : checked.filter((id) => !pageRows.some((row) => row.id === id)))} /></th>
                  <th>{sortHead("label", "Link / Landing Page")}</th><th>{sortHead("product", "Product")}</th><th>{sortHead("website", "Website")}</th><th>{sortHead("source", "Data Source")}</th>
                  <th className="text-center"><span className="block">Stats (Last 7 days)</span><span className="block text-[11px] font-normal text-gray-400">Views | Orders | CR</span></th><th>Status</th><th className="text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {pageRows.map((link) => {
                    const [tone, text] = STATUS_PILL[link.status];
                    return (
                      <tr key={link.id} onClick={() => { setSelected(link.id); setClosed(false); }} className={`${rowCls} cursor-pointer ${selected === link.id ? "bg-blue-50/60 dark:bg-blue-950/20" : "hover:bg-gray-50 dark:hover:bg-slate-800/40"}`}>
                        <td className="py-3"><CheckBox checked={checked.includes(link.id)} onChange={(value) => setChecked((list) => value ? [...list, link.id] : list.filter((id) => id !== link.id))} /></td>
                        <td className="py-3"><span className="flex items-center gap-2.5"><ProductThumb src={link.productImage} size={36} /><span className="min-w-0"><strong className="block max-w-[120px] truncate font-semibold" title={link.label}>{link.label}</strong><span className="block max-w-[120px] truncate text-[11.5px] text-gray-500">{link.landingPath ?? "—"}</span></span></span></td>
                        <td className="max-w-[92px] py-3 text-gray-600"><span className="line-clamp-2 whitespace-normal leading-snug" title={link.productName ?? ""}>{link.productName ?? "—"}</span></td>
                        <td className="max-w-[104px] truncate py-3 text-gray-600" title={link.websiteDomain ?? ""}>{link.websiteDomain ?? "—"}</td>
                        <td className="max-w-[112px] py-3">{link.dataSourceName ? <span className="flex items-center gap-1.5"><PlatformIcon platform={link.dataSourcePlatform} size="sm" /><span className="truncate text-gray-700 dark:text-slate-200" title={link.dataSourceName}>{link.dataSourceName}</span></span> : <span className="text-gray-400">—</span>}</td>
                        <td className="py-3">
                          <span className="grid w-[112px] grid-cols-3 gap-1 text-center font-semibold text-gray-700 dark:text-slate-200"><span>{nf(link.stats.views)}</span><span>{nf(link.stats.orders)}</span><span>{link.stats.conversionRate}%</span></span>
                          <span className="mt-1 flex justify-center"><Sparkline width={104} points={link.stats.spark.map((point) => point.orders)} color={link.status === "healthy" ? "#16a34a" : link.status === "low_performance" ? "#e11d48" : "#f59e0b"} /></span>
                        </td>
                        <td className="py-3" title={link.problems.join(" · ")}><StatusPill size="sm" tone={tone}>{text}</StatusPill></td>
                        <td className="py-3 text-right"><ActionMenu items={[
                          { label: "Open", onClick: () => { setSelected(link.id); setClosed(false); } },
                          { label: "Duplicate", onClick: async () => { try { const r = await trackingHubApi.duplicateLink(link.id); onToast("Duplicated (paused)."); setSelected(r.id); reload(); } catch (err: any) { onToast(err?.message ?? "Could not duplicate."); } } },
                          { label: link.active ? "Pause" : "Activate", onClick: async () => { await trackingHubApi.bulkLinks([link.id], link.active ? "pause" : "activate"); reload(); } },
                          { label: "Delete", danger: true, onClick: async () => { if (!window.confirm("Delete this link? Pages using its code keep working but lose server tracking.")) return; await trackingHubApi.deleteLink(link.id); if (selected === link.id) setSelected(null); reload(); } }
                        ]} /></td>
                      </tr>
                    );
                  })}
                  {pageRows.length === 0 ? <EmptyRow colSpan={8} text={data.links.length === 0 ? <>No tracking link yet. <button type="button" className="!min-h-0 font-bold text-blue-600" onClick={() => setCreating(true)}>Create one</button></> : "No link matches."} /> : null}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={rows.length} noun="links" onPage={setPage} onPageSize={setPageSize} />
          </Card>
        }
        panel={current ? <LinkPanel key={current.id} link={current} meta={data} onClose={() => { setSelected(null); setClosed(true); }} onToast={onToast} onChanged={reload} onSelect={(id) => setSelected(id)} /> : null}
      />
      {modals}
    </div>
  );
}

function LinkPanel({ link, meta, onClose, onToast, onChanged, onSelect }: { link: HubLink; meta: HubLinksResponse; onClose: () => void; onToast: Toast; onChanged: () => void; onSelect: (id: string) => void }) {
  const [days, setDays] = useState(7);
  const { data, error: loadError, reload: reloadLink } = useLoad(() => trackingHubApi.link(link.id, days), [link.id, days, link.updatedAt]);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [tone, text] = STATUS_PILL[link.status];
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <ProductThumb src={link.productImage} size={60} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2"><h2 className="m-0 max-w-full truncate whitespace-nowrap text-[18px] font-black text-gray-900 dark:text-slate-100" title={link.label}>{link.label}</h2><StatusPill tone={tone}>{text}</StatusPill></div>
          {link.landingPageUrl ? <a href={link.landingPageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate text-[12.5px] text-gray-600 hover:text-blue-600">{link.landingPageUrl}<ExternalLink className="h-3 w-3 shrink-0" /></a> : <p className="m-0 text-[12.5px] text-gray-400">No landing page set</p>}
          <p className="m-0 text-[12.5px] text-gray-500">{link.productName ?? ""}</p>
        </div>
        <button type="button" className={smallBlueButton} onClick={() => setTab("settings")}><Pencil className="h-3.5 w-3.5" /> Edit</button>
        <button type="button" aria-label="Duplicate" className={smallButton} onClick={async () => { try { const r = await trackingHubApi.duplicateLink(link.id); onToast("Duplicated (paused)."); onChanged(); onSelect(r.id); } catch (err: any) { onToast(err?.message ?? "Could not duplicate."); } }}><Copy className="h-3.5 w-3.5" /></button>
        <ActionMenu items={[
          { label: link.active ? "Pause" : "Activate", onClick: async () => { await trackingHubApi.bulkLinks([link.id], link.active ? "pause" : "activate"); onChanged(); } },
          { label: "Copy embed code", onClick: () => copyText(buildEmbedSnippet(embedUrlFor(link), `${link.productName ?? link.label} Order Form`), onToast, "Embed code copied.") },
          { label: "Delete", danger: true, onClick: async () => { if (!window.confirm("Delete this link?")) return; await trackingHubApi.deleteLink(link.id); onClose(); onChanged(); } }
        ]} />
        <PanelClose onClose={onClose} />
      </div>
      <UnderlineTabs className="mt-3" value={tab} onChange={setTab} tabs={[{ key: "overview", label: "Overview" }, { key: "campaigns", label: "Campaign URLs" }, { key: "attribution", label: "Attribution" }, { key: "events", label: "Events" }, { key: "settings", label: "Settings" }]} />

      {tab === "overview" ? (!data ? <LoadState compact error={loadError} onRetry={reloadLink} /> : (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-2 min-[1700px]:grid-cols-4">
            <PanelStat icon={<Eye className="h-4 w-4" />} tone="text-blue-600" label="Page Views" value={nf(data.kpis.views)} change={data.kpis.viewsChange} />
            <PanelStat icon={<ShoppingCart className="h-4 w-4" />} tone="text-rose-600" label="Orders" value={nf(data.kpis.orders)} change={data.kpis.ordersChange} />
            <PanelStat icon={<Percent className="h-4 w-4" />} tone="text-violet-600" label="Conversion Rate" value={`${data.kpis.conversionRate}%`} change={data.kpis.conversionRateChange} />
            <PanelStat icon={<Database className="h-4 w-4" />} tone="text-blue-600" label="Revenue" value={naira(data.kpis.revenue)} change={data.kpis.revenueChange} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <div className="flex gap-4 text-[12.5px] text-gray-600"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Page Views</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Orders</span></div>
              <select value={days} onChange={(event) => setDays(Number(event.target.value))} className={`${selectCls} !h-9`}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option></select>
            </div>
            <div className="mt-2 h-[170px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.chart.map((row) => ({ ...row, label: shortDay(row.day) }))}>
                  <CartesianGrid vertical={false} stroke="#eef0f3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={32} allowDecimals={false} />
                  <Tooltip />
                  <Line type="linear" dataKey="views" name="Page Views" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="linear" dataKey="orders" name="Orders" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <p className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Link Details</p>
            <p className="m-0 mt-1 text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Embed URL <span className="font-normal text-gray-500">(Use this in your ads)</span></p>
            <div className="mt-1.5 flex gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-[12px] text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"><span className="min-w-0 flex-1 truncate">{data.adUrl ?? "Add the landing page URL in Settings first"}</span>{data.adUrl ? <button type="button" aria-label="Copy" onClick={() => copyText(data.adUrl!, onToast, "Link copied.")} className="!min-h-0 text-gray-400 hover:text-gray-700"><Copy className="h-4 w-4" /></button> : null}</span>
              {data.adUrl ? <a href={data.adUrl} target="_blank" rel="noreferrer" className={`${smallBlueButton} !px-4`}><ExternalLink className="h-3.5 w-3.5" /> Open</a> : null}
            </div>
            <p className="m-0 mt-1 text-[11.5px] text-gray-500">This link includes automatic campaign tracking parameters (fbclid, utm, etc.) once the ad's URL parameters are added.</p>
            <dl className="m-0 mt-3 grid grid-cols-3 gap-x-4 gap-y-3 text-[12.5px]">
              <Detail label="Product">{data.productName ?? "—"}</Detail>
              <Detail label="Website">{data.websiteDomain ?? "—"}</Detail>
              <Detail label="Data Source">{data.dataSourceName ? <span className="flex items-center gap-1.5"><PlatformIcon platform={link.dataSourcePlatform} size="sm" />{data.dataSourceName}</span> : "—"}</Detail>
              <Detail label="Landing Page">{data.landingPath ?? "—"}</Detail>
              <Detail label="Form">{data.formLabel || "—"}</Detail>
              <Detail label="Thank-you Page">{data.redirectPath || "—"}</Detail>
              <Detail label="Created">{data.createdAt ? dateTime(data.createdAt) : "—"}</Detail>
              <Detail label="Last Updated">{data.updatedAt ? dateTime(data.updatedAt) : "—"}</Detail>
              <Detail label="Total Orders">{nf(data.totalOrders)}</Detail>
            </dl>
          </div>
        </div>
      )) : null}

      {tab === "campaigns" ? (
        <div className="mt-4 space-y-3">
          <div>
            <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">URL parameters for every ad</p>
            <p className="m-0 mt-0.5 text-[12px] text-gray-500">Paste in Meta Ads Manager → Ad → Tracking → URL parameters. Each order then carries its campaign, ad set and ad.</p>
            <div className="mt-2 flex gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-gray-50 p-2 text-[11.5px] text-gray-700 dark:bg-slate-800 dark:text-slate-300">{meta.urlParameters}</code><button type="button" className={smallButton} onClick={() => copyText(meta.urlParameters, onToast)}><Copy className="h-3.5 w-3.5" /></button></div>
          </div>
          <table className={tableCls}>
            <thead><tr className="text-gray-500"><th>Campaign ID</th><th className="text-right">Page views</th><th className="text-right">Orders</th></tr></thead>
            <tbody>
              {(data?.campaigns ?? []).map((row) => <tr key={row.campaignId} className={rowCls}><td className="py-2 font-mono text-[12px]">{row.campaignId}</td><td className="py-2 text-right">{nf(row.views)}</td><td className="py-2 text-right font-semibold">{nf(row.orders)}</td></tr>)}
              {data && data.campaigns.length === 0 ? <EmptyRow colSpan={3} text="No campaign id seen on this link in the period." /> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "attribution" ? (
        <div className="mt-4">
          <p className="m-0 text-[12.5px] text-gray-500">{data?.attributionOrders ? `Captured on ${data.attributionOrders} ad orders from this link` : "No ad orders from this link in the period."}</p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {(data?.attribution ?? []).map((field) => (
              <li key={field.key} className="flex items-center gap-3 text-[13px]">
                {field.pct >= 50 || !data?.attributionOrders ? <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" /> : <TriangleAlert className="h-4 w-4 text-amber-500" />}
                <span className="w-40 text-gray-700 dark:text-slate-300">{field.label}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${field.pct}%` }} /></span>
                <span className="w-12 text-right font-semibold">{field.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tab === "events" ? (
        <table className={`${tableCls} mt-4`}>
          <thead><tr className="text-gray-500"><th>Order</th><th>Time</th><th>Value</th><th>Status</th></tr></thead>
          <tbody>
            {(data?.events ?? []).map((row) => <tr key={row.orderId} className={rowCls}><td className="py-2 font-semibold">{row.orderId}</td><td className="py-2 text-gray-600">{shortDay(row.createdAt.slice(0, 10))} {timeOf(row.createdAt)}</td><td className="py-2">{naira(row.value, row.currency)}</td><td className="py-2"><StatusPill size="sm" tone={LEDGER_TONE[row.status]}>{row.statusLabel}</StatusPill></td></tr>)}
            {data && data.events.length === 0 ? <EmptyRow colSpan={4} text="No orders from this link in the period." /> : null}
          </tbody>
        </table>
      ) : null}

      {tab === "settings" ? <div className="mt-4"><LinkForm link={link} meta={meta} onToast={onToast} onSaved={() => { onChanged(); }} onCancel={() => setTab("overview")} compact /></div> : null}
    </Card>
  );
}

function PanelStat({ icon, tone, label, value, change }: { icon: ReactNode; tone: string; label: string; value: string; change: number }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
      <div className="flex items-start gap-2"><span className={`mt-0.5 ${tone}`}>{icon}</span><span className="min-w-0"><span className="block text-[11.5px] text-gray-500">{label}</span><strong className="block truncate text-[17px] font-black text-gray-900 dark:text-slate-100">{value}</strong><Delta value={change} /></span></div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11.5px] text-gray-500">{label}</dt><dd className="m-0 mt-0.5 truncate font-medium text-gray-800 dark:text-slate-200">{children}</dd></div>;
}

function LinkForm({ link, meta, onToast, onSaved, onCancel, compact }: { link: HubLink | null; meta: HubLinksResponse; onToast: Toast; onSaved: (id: string) => void; onCancel: () => void; compact?: boolean }) {
  const [form, setForm] = useState({
    label: link?.label ?? "", productId: link?.productId ?? "", websiteId: link?.websiteId ?? "", profileId: link?.profileId ?? "",
    dataSourceId: link?.dataSourceId ?? "", strategy: (link?.strategy && link.strategy !== "off" ? link.strategy : meta.defaultStrategy) as HubStrategy,
    landingPageUrl: link?.landingPageUrl ?? "", redirectUrl: link?.redirectUrl ?? "", formLabel: link?.formLabel ?? "", active: link?.active ?? true
  });
  const [checklist, setChecklist] = useState({ thankYouPixelRemoved: Boolean(link?.checklist?.thankYouPixelRemoved), testEventSeen: Boolean(link?.checklist?.testEventSeen) });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const applyProfile = (profileId: string) => {
    const profile = meta.profiles.find((row) => row.id === profileId);
    setForm((current) => ({ ...current, profileId, dataSourceId: profile?.dataSourceId ?? current.dataSourceId, websiteId: profile?.defaultWebsiteId ?? current.websiteId, strategy: profile?.strategy ?? current.strategy }));
  };
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await trackingHubApi.saveLink(link?.id ?? null, { ...form, productId: form.productId || null, websiteId: form.websiteId || null, profileId: form.profileId || null, dataSourceId: form.dataSourceId || null });
      onToast("Tracking link saved.");
      onSaved(result.id);
    } catch (err: any) {
      setError(err?.message ?? "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  const code = link ? buildEmbedSnippet(embedUrlFor(link), `${link.productName ?? link.label} Order Form`) : "";
  const needsChecklist = form.strategy !== "landing_page";
  const cols = compact ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className="space-y-4">
      <div className={`grid gap-3 ${cols}`}>
        <label className={`${labelCls} sm:col-span-2`}>Name<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Shelf Main" className={input} /></label>
        <label className={labelCls}>Product<select value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} className={input}><option value="">Choose…</option>{meta.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={labelCls}>Tracking profile<select value={form.profileId} onChange={(e) => applyProfile(e.target.value)} className={input}><option value="">None</option>{meta.profiles.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={labelCls}>Website<select value={form.websiteId} onChange={(e) => setForm({ ...form, websiteId: e.target.value })} className={input}><option value="">Choose…</option>{meta.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</select></label>
        <label className={labelCls}>Data source<select value={form.dataSourceId} onChange={(e) => setForm({ ...form, dataSourceId: e.target.value })} className={input}><option value="">From profile / website</option>{meta.dataSources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={labelCls}>Landing page URL<input value={form.landingPageUrl} onChange={(e) => setForm({ ...form, landingPageUrl: e.target.value })} placeholder="https://brightpathhubs.com/shelf/" className={input} /></label>
        <label className={labelCls}>Thank-you page URL<input value={form.redirectUrl} onChange={(e) => setForm({ ...form, redirectUrl: e.target.value })} placeholder="https://brightpathhubs.com/order-success/" className={input} /></label>
        <label className={labelCls}>Form name<input value={form.formLabel} onChange={(e) => setForm({ ...form, formLabel: e.target.value })} placeholder="Shelf External Form V4" className={input} /></label>
        <label className={labelCls}>Purchase strategy<select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value as HubStrategy })} className={input}><option value="browser_capi">Browser + CAPI (Protohub fires Purchase)</option><option value="capi_only">CAPI only</option><option value="landing_page">Thank-you page Pixel (Protohub sends nothing)</option></select></label>
        <label className="flex items-center gap-2 pt-6 text-[13px] font-semibold text-gray-700 dark:text-slate-300"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
      </div>
      {error ? <p className="m-0 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      <div className="flex justify-end gap-2"><button type="button" className={smallButton} onClick={onCancel}>Cancel</button><button type="button" disabled={busy} className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} onClick={() => void save()}>{busy ? "Saving…" : link ? "Save changes" : "Create link"}</button></div>

      {link ? (
        <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-slate-800">
          {needsChecklist ? (
            <div className={`rounded-xl border p-4 ${checklist.thankYouPixelRemoved && checklist.testEventSeen ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"} dark:bg-slate-800/50`}>
              <p className="m-0 text-[13px] font-black text-gray-900 dark:text-slate-100">Go-live checklist</p>
              <p className="m-0 mt-0.5 text-[12px] text-gray-600 dark:text-slate-400">Protohub now fires Purchase. Do both before the code goes on the live page, or orders count twice.</p>
              <label className="mt-2 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={checklist.thankYouPixelRemoved} onChange={(e) => setChecklist({ ...checklist, thankYouPixelRemoved: e.target.checked })} className="mt-0.5" />I removed the Purchase Pixel code from the thank-you page{link.redirectUrl ? ` (${link.redirectUrl})` : ""}.</label>
              <label className="mt-1 flex items-start gap-2 text-[13px]"><input type="checkbox" checked={checklist.testEventSeen} onChange={(e) => setChecklist({ ...checklist, testEventSeen: e.target.checked })} className="mt-0.5" />I placed a test order and saw ONE Purchase (browser + server) in Meta Test Events.</label>
              <button type="button" className={`${smallButton} mt-2`} onClick={async () => { try { await trackingHubApi.saveChecklist(link.id, checklist); onSaved(link.id); onToast("Checklist saved."); } catch (err: any) { onToast(err?.message ?? "Could not save."); } }}>Save checklist</button>
              {link.checklist?.confirmedAt ? <p className="m-0 mt-1 text-[11px] text-gray-500">Last confirmed by {link.checklist.confirmedBy ?? "—"}, {ago(link.checklist.confirmedAt)}</p> : null}
            </div>
          ) : null}
          <div>
            <div className="flex items-center justify-between"><p className="m-0 text-[13px] font-black text-gray-900 dark:text-slate-100">Embed code for the landing page</p>
              <button type="button" className={smallButton} onClick={() => copyText(code, onToast, "Embed code copied.")}><Copy className="h-3.5 w-3.5" /> Copy</button></div>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-slate-100">{code}</pre>
            <p className="m-0 mt-1 text-[11px] text-gray-500">No token is in this code. It passes the ad ids and the page address into the form, fires the browser Pixel with the order id, reports it to Protohub, then opens the thank-you page.</p>
          </div>
          {link.problems.length ? <ul className="m-0 list-disc pl-5 text-[12.5px] text-amber-800">{link.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
          <p className="m-0 text-[11px] text-gray-400">Key: {link.trackingKey} · Strategy: {STRATEGY_LABEL[link.strategy]}</p>
        </div>
      ) : null}
    </div>
  );
}

