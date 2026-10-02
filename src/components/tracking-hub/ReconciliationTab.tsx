import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight, ArrowRight, CalendarDays, Check, ChevronRight, CircleDot, Download, ExternalLink, RefreshCw, ShoppingCart, TriangleAlert } from "lucide-react";
import { trackingHubApi, type HubReconRow, type HubReconView } from "../../lib/api";
import {
  ActionMenu, Card, CheckBox, CopyButton, DateRangeButton, Delta, EmptyRow, FilterSelect, HubHeader, Kpi, LEDGER_TONE, Modal, Pagination, PanelClose, PlatformIcon,
  ProductThumb, Ring, SearchBox, SplitLayout, StatusPill, UnderlineTabs, ago, compareWord, darkButton, downloadCsv, input, longDay, naira, nf, rowCls, selectCls,
  shortDay, smallButton, listTableCls, tableCls, timeOf, useLoad, type Range, type Toast
} from "./HubParts";

// Reconciliation tab - built to Bright's image (2 Oct 2026). Protohub orders vs
// Meta's attributed purchases, by campaign / ad set / ad / landing page /
// product / website. A difference starts an investigation; it is not
// automatically a Pixel error (Meta applies its own attribution).

type PanelTab = "overview" | "orders" | "meta" | "discrepancies" | "insights";
const VIEW_TABS: Array<{ key: HubReconView; label: string; noun: string; head: string }> = [
  { key: "campaign", label: "Campaign View", noun: "campaigns", head: "Campaign" }, { key: "adset", label: "Ad Set View", noun: "ad sets", head: "Ad Set" },
  { key: "ad", label: "Ad View", noun: "ads", head: "Ad" }, { key: "landing_page", label: "Landing Page View", noun: "landing pages", head: "Landing Page" },
  { key: "product", label: "Product View", noun: "products", head: "Product" }, { key: "website", label: "Website View", noun: "websites", head: "Website" }
];
const STATUS_PILL: Record<HubReconRow["status"], ["green" | "red" | "blue" | "gray", string]> = { matched: ["green", "Matched"], investigate: ["red", "Investigate"], resolved: ["blue", "Resolved"], no_meta: ["gray", "No Meta data"] };
const rateColor = (rate: number | null) => (rate === null ? "text-gray-400" : rate >= 90 ? "text-emerald-600" : rate >= 75 ? "text-amber-600" : "text-rose-600");
const diffColor = (diff: number | null) => (diff === null ? "text-gray-400" : Math.abs(diff) <= 1 ? "text-emerald-600" : "text-rose-600");
const signed = (value: number | null) => (value === null ? "—" : `${value > 0 ? "+" : ""}${value}`);

export default function ReconciliationTab({ tabBar, onToast, range, onRange, onOpenLedger }: { tabBar: ReactNode; onToast: Toast; range: Range; onRange: (range: Range) => void; onOpenLedger: (filter: { orderIds?: string[] }) => void }) {
  const [view, setView] = useState<HubReconView>("campaign");
  const [filters, setFilters] = useState({ q: "", accountId: "", business: "", websiteId: "", status: "" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { data, reload } = useLoad(() => trackingHubApi.reconciliation({ ...range, view, q: filters.q, accountId: filters.accountId, business: filters.business, websiteId: filters.websiteId }), [range.from, range.to, view, filters.q, filters.accountId, filters.business, filters.websiteId], onToast);
  const rows = useMemo(() => (data?.rows ?? []).filter((row) => !filters.status || row.status === filters.status), [data, filters.status]);
  useEffect(() => { setPage(1); setSelected(null); setClosed(false); }, [view]);
  useEffect(() => { setPage(1); }, [filters, pageSize]);
  useEffect(() => { if (!closed && rows.length && (!selected || !rows.some((row) => row.id === selected))) setSelected((rows.find((row) => row.status === "investigate") ?? rows[0]).id); }, [rows]);

  const refresh = async () => {
    setBusy(true);
    try {
      const result = await trackingHubApi.refreshReconciliation(range);
      const failed = result.report.filter((row) => !row.ok);
      onToast(failed.length ? `${failed[0].source}: ${failed[0].message}` : `Loaded Meta's numbers for ${result.report.length} ad account${result.report.length === 1 ? "" : "s"}.`);
      reload();
    } catch (err: any) {
      onToast(err?.message ?? "Could not read Meta.");
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = () => {
    const head = ["Name", "ID", "Account", "Protohub Orders", "Meta Purchases", "Difference", "Match Rate", "Spend", "Status"];
    const esc = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    downloadCsv(`reconciliation-${view}-${range.from}-${range.to}.csv`, [head.map(esc).join(","), ...rows.map((row) => [row.name, row.id, row.account, row.protohub, row.meta ?? "", row.difference ?? "", row.matchRate ?? "", row.spend, STATUS_PILL[row.status][1]].map(esc).join(","))].join("\n"));
  };
  const viewInfo = VIEW_TABS.find((item) => item.key === view)!;
  const k = data?.kpis;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const current = rows.find((row) => row.id === selected) ?? null;
  const rating = (rate: number | null) => (rate === null ? "—" : rate >= 90 ? "Good" : rate >= 75 ? "Fair" : "Poor");

  return (
    <div className="space-y-5">
      <HubHeader title="Reconciliation" subtitle="Compare Protohub orders with Meta (and other platforms) to check tracking accuracy and find discrepancies."
        actions={<>
          <DateRangeButton range={range} onChange={onRange} />
          <label className="relative flex flex-col justify-center rounded-xl border border-gray-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[11.5px] text-gray-500">Compare with</span>
            <select defaultValue="meta" className="!min-h-0 appearance-none bg-transparent pr-8 text-[14px] font-semibold text-gray-800 outline-none dark:text-slate-200"><option value="meta">Meta (Facebook)</option><option value="tiktok" disabled>TikTok (not yet)</option><option value="google" disabled>Google Ads (not yet)</option></select>
          </label>
          <button type="button" className={darkButton} disabled={busy} onClick={() => void refresh()}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> {busy ? "Reading Meta…" : "Refresh Data"}</button>
        </>} />
      {tabBar}
      {k ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi icon={<ShoppingCart className="h-7 w-7" />} tone="green" label="Protohub Orders" value={nf(k.protohub)} delta={<span className="leading-tight"><Delta value={k.protohubChange} /><span className="block text-[11px] font-normal text-gray-400">{compareWord(range)}</span></span>} />
          <Kpi icon={<PlatformIcon platform="meta" />} tone="blue" label="Meta Purchases" value={k.meta === null ? "—" : nf(k.meta)} delta={<span className="text-[11px] text-gray-400">{k.meta === null ? "press Refresh Data" : "(Meta's own attribution)"}</span>} />
          <Kpi icon={<ArrowLeftRight className="h-7 w-7" />} tone="orange" label="Difference" value={<span className={k.difference === null ? "" : k.difference === 0 ? "text-emerald-600" : "text-amber-600"}>{signed(k.difference)}</span>} sub={k.difference === null ? "" : k.difference > 0 ? "Meta higher" : k.difference < 0 ? "Protohub higher" : "Same"} />
          <Kpi icon={<Ring value={k.matchRate ?? 0} size={60} stroke={6}><span className="text-[12px] font-black text-gray-900 dark:text-slate-100">{k.matchRate === null ? "—" : `${k.matchRate}%`}</span></Ring>} tone="gray" label="Match Rate" value={<span className={rateColor(k.matchRate)}>{rating(k.matchRate)}</span>} sub={k.matched === null ? "" : `${nf(k.matched)} / ${nf(k.matchedOf ?? 0)} matched`} />
          <Kpi icon={<TriangleAlert className="h-7 w-7" />} tone="red" label="Needs Investigation" value={nf(k.investigate)} delta={<span className="text-[12px] text-gray-500">{viewInfo.noun}</span>} right={<ChevronRight className="h-5 w-5 text-gray-400" />} onClick={() => setFilters({ ...filters, status: filters.status === "investigate" ? "" : "investigate" })} />
        </div>
      ) : null}
      {data && data.kpis.meta === null ? (
        <Card className="border-amber-200 bg-amber-50/60 p-3 text-[13px] text-amber-900">
          {data.sources.some((row) => row.hasToken && row.adAccounts > 0) ? "Meta's purchases are not loaded for these dates. Press Refresh Data." : "Add a token and the ad account IDs to a Meta data source (Data Sources tab), then press Refresh Data."}
          {data.lastFetched ? ` Last loaded ${ago(data.lastFetched)}.` : ""}
        </Card>
      ) : null}

      <Card className="px-2">
        <UnderlineTabs className="!border-b-0" value={view} onChange={setView} tabs={VIEW_TABS.map((item) => ({ key: item.key, label: item.label, icon: item.key === view ? <CircleDot className="h-4 w-4" /> : undefined }))} />
      </Card>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder={`Search ${viewInfo.noun}...`} className="min-w-[200px] flex-1" />
          <FilterSelect value={filters.accountId} onChange={(accountId) => setFilters({ ...filters, accountId })} className="w-44"><option value="">All Ad Accounts</option>{data?.filters.accounts.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}</FilterSelect>
          <FilterSelect value={filters.business} onChange={(business) => setFilters({ ...filters, business })} className="w-48"><option value="">All Business Accounts</option>{data?.filters.businesses.map((row) => <option key={row} value={row}>{row}</option>)}</FilterSelect>
          <FilterSelect value={filters.websiteId} onChange={(websiteId) => setFilters({ ...filters, websiteId })} className="w-44"><option value="">All Websites</option>{data?.filters.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</FilterSelect>
          <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 text-[13px] text-gray-700 dark:border-slate-700 dark:text-slate-300"><CalendarDays className="h-4 w-4 text-gray-500" />{longDay(range.from)} – {longDay(range.to)}</span>
          <button type="button" className={`${smallButton} !h-10 !px-4 ml-auto`} onClick={exportCsv}><Download className="h-4 w-4" /> Export</button>
        </div>
        <div className="mt-3">
          <SplitLayout
            list={
              <div>
                <div className="overflow-x-auto">
                  <table className={listTableCls}>
                    <thead><tr className="text-gray-500">
                      <th className="w-8"><CheckBox checked={pageRows.length > 0 && pageRows.every((row) => checked.includes(row.id))} onChange={(value) => setChecked(value ? pageRows.map((row) => row.id) : [])} /></th>
                      <th>{viewInfo.head}</th><th>Account</th><th className="text-center">Protohub<br />Orders</th><th className="text-center">Meta<br />Purchases</th><th className="text-center">Difference</th><th className="text-center underline underline-offset-4">Match Rate</th><th>Status</th><th className="text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {pageRows.map((row) => {
                        const [tone, text] = STATUS_PILL[row.status];
                        return (
                          <tr key={row.id} onClick={() => { setSelected(row.id); setClosed(false); }} className={`${rowCls} cursor-pointer ${selected === row.id ? "bg-blue-50/60 dark:bg-blue-950/20" : "hover:bg-gray-50 dark:hover:bg-slate-800/40"}`}>
                            <td className="py-3"><CheckBox checked={checked.includes(row.id)} onChange={(value) => setChecked((list) => value ? [...list, row.id] : list.filter((id) => id !== row.id))} /></td>
                            <td className="py-3"><span className="flex items-center gap-2.5"><ProductThumb src={row.image} size={38} /><span className="min-w-0"><strong className="block max-w-[150px] truncate font-semibold" title={row.name}>{row.name}</strong>{row.name !== row.id ? <span className="block max-w-[150px] truncate text-[11.5px] text-gray-500">ID: {row.id}</span> : null}</span></span></td>
                            <td className="max-w-[90px] truncate py-3 text-gray-600" title={row.account}>{row.account}</td>
                            <td className="py-3 text-center font-semibold">{nf(row.protohub)}</td>
                            <td className="py-3 text-center">{row.meta === null ? "—" : nf(row.meta)}</td>
                            <td className={`py-3 text-center font-semibold ${diffColor(row.difference)}`}>{signed(row.difference)}</td>
                            <td className={`py-3 text-center font-semibold ${rateColor(row.matchRate)}`}>{row.matchRate === null ? "—" : `${row.matchRate}%`}</td>
                            <td className="py-3"><StatusPill size="sm" tone={tone}>{text}</StatusPill></td>
                            <td className="py-3 text-right"><ActionMenu items={[
                              { label: "Open", onClick: () => { setSelected(row.id); setClosed(false); } },
                              { label: "Mark as resolved", onClick: async () => { await trackingHubApi.reconciliationNote({ scope: view, scopeId: row.id, resolved: true }); onToast("Marked as resolved."); reload(); } }
                            ]} /></td>
                          </tr>
                        );
                      })}
                      {data && pageRows.length === 0 ? <EmptyRow colSpan={9} text={`No ${viewInfo.noun} in this period.`} /> : null}
                      {!data ? <EmptyRow colSpan={9} text="Loading…" /> : null}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} pageSize={pageSize} total={rows.length} noun={viewInfo.noun} onPage={setPage} onPageSize={setPageSize} />
              </div>
            }
            panel={current ? <ReconPanel key={`${view}:${current.id}`} view={view} row={current} range={range} onClose={() => { setSelected(null); setClosed(true); }} onToast={onToast} onChanged={reload} onOpenLedger={onOpenLedger} /> : null}
          />
        </div>
      </Card>
    </div>
  );
}

function ReconPanel({ view, row, range, onClose, onToast, onChanged, onOpenLedger }: { view: HubReconView; row: HubReconRow; range: Range; onClose: () => void; onToast: Toast; onChanged: () => void; onOpenLedger: (filter: { orderIds?: string[] }) => void }) {
  const [chartDays, setChartDays] = useState(7);
  const { data, reload } = useLoad(() => trackingHubApi.reconciliationItem({ ...range, view, id: row.id, chartDays }), [view, row.id, range.from, range.to, chartDays, row.status]);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const [tone, text] = STATUS_PILL[row.status];
  const saveNote = async (resolved: boolean) => {
    try {
      await trackingHubApi.reconciliationNote({ scope: view, scopeId: row.id, note: note.trim() || undefined, resolved });
      setNote("");
      setNoting(false);
      onToast(resolved ? "Marked as resolved." : "Note saved.");
      reload();
      onChanged();
    } catch (err: any) {
      onToast(err?.message ?? "Could not save.");
    }
  };
  const d = data?.details;
  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
      <div className="flex items-start gap-3">
        <ProductThumb src={row.image} size={56} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">{row.name}</h2><StatusPill tone={tone}>{row.status === "investigate" ? "Needs Investigation" : text}</StatusPill></div>
          {row.name !== row.id ? <p className="m-0 text-[12.5px] text-gray-500">ID: {row.id}</p> : null}
          <p className="m-0 text-[12.5px] text-gray-500">{row.account}{d?.landingPage ? ` • ${d.landingPage.replace(/^https?:\/\//, "")}` : ""}</p>
        </div>
        <PanelClose onClose={onClose} />
      </div>
      <UnderlineTabs className="mt-2" value={tab} onChange={setTab} tabs={[{ key: "overview", label: "Overview" }, { key: "orders", label: "Orders" }, { key: "meta", label: "Meta Data" }, { key: "discrepancies", label: "Discrepancies" }, { key: "insights", label: "Insights" }]} />
      {!data ? <p className="m-0 mt-4 text-sm text-gray-500">Loading…</p> : null}

      {data && tab === "overview" ? (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 gap-2 min-[1700px]:grid-cols-4">
            <SmallTile icon={<ShoppingCart className="h-5 w-5 text-rose-500" />} label="Protohub Orders" value={nf(data.protohub)} />
            <SmallTile icon={<PlatformIcon platform="meta" size="sm" />} label="Meta Purchases" value={data.meta === null ? "—" : nf(data.meta)} />
            <SmallTile icon={<ArrowLeftRight className="h-5 w-5 text-rose-500" />} label="Difference" value={<span className={diffColor(data.difference)}>{signed(data.difference)}</span>} />
            <div className="flex items-center gap-2 rounded-xl border border-gray-200 p-2.5 dark:border-slate-700"><Ring value={data.matchRate ?? 0} size={40} stroke={5} /><span><span className="block text-[11px] text-gray-500">Match Rate</span><strong className="text-[17px] font-black text-gray-900 dark:text-slate-100">{data.matchRate === null ? "—" : `${data.matchRate}%`}</strong></span></div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-100">Orders vs Meta Purchases</p>
              <select value={chartDays} onChange={(event) => setChartDays(Number(event.target.value))} className={`${selectCls} !h-9`}><option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option></select>
            </div>
            <div className="mt-1 flex gap-4 text-[12px] text-gray-600"><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm bg-blue-600" />Protohub Orders</span><span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-3.5 rounded-sm bg-emerald-400" />Meta Purchases</span></div>
            <div className="mt-2 h-[150px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.chart.map((point) => ({ ...point, label: shortDay(point.day) }))} barGap={4} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="#eef0f3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={28} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} />
                  <Bar dataKey="protohub" name="Protohub Orders" fill="#2563eb" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="meta" name="Meta Purchases" fill="#34d399" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="grid gap-3 min-[1700px]:grid-cols-[1.35fr_1fr]">
            <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
              <p className="m-0 mb-1.5 text-[13.5px] font-black text-gray-900 dark:text-slate-100">{view === "campaign" ? "Campaign" : "Item"} Details</p>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                <InfoRow label="Ad Account" copy={d?.adAccount} onToast={onToast}>{d?.adAccount ?? "—"}</InfoRow>
                <InfoRow label="Business Account" copy={d?.businessAccount} onToast={onToast}>{d?.businessAccount ?? "—"}</InfoRow>
                <InfoRow label="Campaign ID" copy={d?.campaignId} onToast={onToast}>{d?.campaignId ?? "—"}</InfoRow>
                <InfoRow label="Objective">{d?.objective ?? "—"}</InfoRow>
                <InfoRow label="Start Date">{d?.startDate ? longDay(d.startDate.slice(0, 10)) : "—"}</InfoRow>
                <InfoRow label="End Date">{d?.endDate ? longDay(d.endDate.slice(0, 10)) : d?.startDate ? "Ongoing" : "—"}</InfoRow>
                <InfoRow label="Landing Page">{d?.landingPage ? <a href={d.landingPage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600">{d.landingPage.replace(/^https?:\/\//, "")}<ExternalLink className="h-3 w-3" /></a> : "—"}</InfoRow>
                <InfoRow label="Primary Data Source">{d?.dataSource ? <span className="inline-flex items-center gap-1"><PlatformIcon platform="meta" size="sm" />{d.dataSource}</span> : "—"}</InfoRow>
                <InfoRow label="Form">{d?.form ?? "—"}</InfoRow>
              </dl>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
              <p className="m-0 mb-1.5 text-[13.5px] font-black text-gray-900 dark:text-slate-100">Quick Actions</p>
              <div className="space-y-1.5">
                <QuickAction onClick={() => setTab("orders")}>View Orders</QuickAction>
                <QuickAction href={d?.adsManagerUrl}>Open in Ads Manager <ExternalLink className="h-3 w-3" /></QuickAction>
                <QuickAction onClick={() => onOpenLedger({ orderIds: data.orders.map((order) => order.orderId) })}>Check Event Ledger</QuickAction>
                <QuickAction onClick={() => setTab("discrepancies")}>View Discrepancies</QuickAction>
                <QuickAction onClick={() => setNoting(true)}>Add Note</QuickAction>
                <button type="button" disabled={row.status === "resolved"} onClick={() => void saveNote(true)} className="!min-h-0 flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-600 hover:bg-rose-100 disabled:opacity-50"><Check className="h-3.5 w-3.5" /> {row.status === "resolved" ? "Resolved" : "Mark as Resolved"}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {data && tab === "orders" ? (
        <div className="mt-3 overflow-x-auto">
          <table className={tableCls}>
            <thead><tr className="text-gray-500"><th>Order</th><th>Time</th><th>Value</th><th>Status</th></tr></thead>
            <tbody>
              {data.orders.map((order) => <tr key={order.orderId} className={rowCls}><td className="py-2 font-semibold">{order.orderId}</td><td className="py-2 text-gray-600">{shortDay(order.createdAt.slice(0, 10))} {timeOf(order.createdAt)}</td><td className="py-2">{naira(order.value, order.currency)}</td><td className="py-2"><StatusPill size="sm" tone={LEDGER_TONE[order.status]}>{order.statusLabel}</StatusPill></td></tr>)}
              {data.orders.length === 0 ? <EmptyRow colSpan={4} text="No Protohub orders carried this id in the period." /> : null}
            </tbody>
          </table>
          {data.orders.length ? <button type="button" className={`${smallButton} mt-2`} onClick={() => onOpenLedger({ orderIds: data.orders.map((order) => order.orderId) })}>Open these in the Event Ledger <ArrowRight className="h-3.5 w-3.5" /></button> : null}
        </div>
      ) : null}

      {data && tab === "meta" ? (
        <div className="mt-3 overflow-x-auto">
          <table className={tableCls}>
            <thead><tr className="text-gray-500"><th>Day</th><th>Ad</th><th className="text-right">Purchases</th><th className="text-right">Value</th><th className="text-right">Spend</th></tr></thead>
            <tbody>
              {data.metaRows.map((meta, index) => <tr key={index} className={rowCls}><td className="py-2 text-gray-600">{shortDay(meta.day)}</td><td className="max-w-[180px] truncate py-2" title={`${meta.campaign} › ${meta.adset} › ${meta.ad}`}>{meta.ad || meta.adset || meta.campaign}</td><td className="py-2 text-right font-semibold">{nf(meta.purchases)}</td><td className="py-2 text-right">{naira(meta.value)}</td><td className="py-2 text-right">{naira(meta.spend)}</td></tr>)}
              {data.metaRows.length === 0 ? <EmptyRow colSpan={5} text="Meta reported nothing for this item in the period (or it is not loaded — press Refresh Data)." /> : null}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && tab === "discrepancies" ? (
        <div className="mt-3 space-y-3">
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
            <dt>Protohub orders</dt><dd className="m-0 font-bold">{data.breakdown.protohubOrders}</dd>
            <dt>Purchase events (browser or server)</dt><dd className="m-0 font-bold">{data.breakdown.purchaseEvents}</dd>
            <dt>Sent to Meta by the server</dt><dd className="m-0 font-bold">{data.breakdown.sentToMeta}</dd>
            <dt>Not sent by the server</dt><dd className="m-0 font-bold">{data.breakdown.notSent}</dd>
            <dt>Orders without fbclid</dt><dd className="m-0 font-bold">{data.breakdown.withoutFbclid}</dd>
            <dt>Repeat sends blocked</dt><dd className="m-0 font-bold">{data.breakdown.duplicates}</dd>
            <dt>Meta attributed purchases</dt><dd className="m-0 font-bold">{data.breakdown.metaPurchases ?? "—"}</dd>
          </dl>
          <div className={`rounded-lg p-3 text-[13px] ${data.verdict.tone === "ok" ? "bg-emerald-50 text-emerald-900" : data.verdict.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-gray-50 text-gray-800"}`}>
            <strong className="block">Conclusion:</strong>{data.verdict.conclusion}
            <strong className="mt-2 block">Likely area:</strong>{data.verdict.likely}
          </div>
        </div>
      ) : null}

      {data && tab === "insights" ? (
        <div className="mt-3 space-y-3">
          <ul className="m-0 list-disc space-y-1 pl-5 text-[13px] text-gray-700 dark:text-slate-300">{data.insights.map((line) => <li key={line}>{line}</li>)}</ul>
          <div>
            <div className="flex items-center justify-between"><p className="m-0 text-[13.5px] font-black text-gray-900 dark:text-slate-100">Notes</p><button type="button" className={smallButton} onClick={() => setNoting(true)}>Add Note</button></div>
            <ul className="m-0 mt-2 list-none space-y-2 p-0">
              {data.notes.map((item, index) => <li key={index} className="rounded-lg bg-gray-50 p-2.5 text-[12.5px] dark:bg-slate-800"><p className="m-0 text-gray-800 dark:text-slate-200">{item.resolved ? <strong className="text-emerald-700">Marked as resolved. </strong> : null}{item.note}</p><p className="m-0 mt-0.5 text-[11px] text-gray-400">{item.by ?? "—"} · {ago(item.at)}</p></li>)}
              {data.notes.length === 0 ? <li className="text-[12.5px] text-gray-500">No notes yet.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}

      {noting ? (
        <Modal title="Add note" subtitle={row.name} onClose={() => setNoting(false)}>
          <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you find?" className={`${input} h-auto py-2`} />
          <div className="mt-3 flex justify-end gap-2"><button type="button" className={smallButton} onClick={() => setNoting(false)}>Cancel</button><button type="button" className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} disabled={!note.trim()} onClick={() => void saveNote(false)}>Save note</button></div>
        </Modal>
      ) : null}
    </div>
  );
}

function SmallTile({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return <div className="flex items-center gap-2 rounded-xl border border-gray-200 p-2.5 dark:border-slate-700"><span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50 dark:bg-slate-800">{icon}</span><span><span className="block text-[11px] text-gray-500">{label}</span><strong className="text-[18px] font-black text-gray-900 dark:text-slate-100">{value}</strong></span></div>;
}

function InfoRow({ label, children, copy, onToast }: { label: string; children: ReactNode; copy?: string | null; onToast?: Toast }) {
  return <><dt className="text-gray-500">{label}</dt><dd className="m-0 flex min-w-0 items-center justify-between gap-1 font-medium text-gray-800 dark:text-slate-200"><span className="min-w-0 truncate">{children}</span>{copy && onToast ? <CopyButton text={copy} onToast={onToast} /> : null}</dd></>;
}

function QuickAction({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const cls = "!min-h-0 flex w-full items-center justify-between gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 px-3 py-2 text-left text-[12.5px] font-semibold text-blue-600 hover:bg-blue-50 dark:border-slate-700";
  if (href) return <a href={href} target="_blank" rel="noreferrer" className={cls}><span className="inline-flex items-center gap-1">{children}</span><ArrowRight className="h-3.5 w-3.5" /></a>;
  return <button type="button" onClick={onClick} className={cls}><span className="inline-flex items-center gap-1">{children}</span><ArrowRight className="h-3.5 w-3.5" /></button>;
}
