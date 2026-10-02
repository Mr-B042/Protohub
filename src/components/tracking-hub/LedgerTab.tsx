import { Fragment, useEffect, useState, type ReactNode } from "react";
import { BadgeCheck, CheckCircle2, CircleCheck, Download, ExternalLink, FileText, Globe, Server, ShoppingCart, Shuffle, FlaskConical, TriangleAlert, X } from "lucide-react";
import { trackingHubApi, type HubLedgerDetail } from "../../lib/api";
import {
  ActionMenu, Card, CheckBox, CheckDot, CopyButton, DateRangeButton, Delta, EmptyRow, FilterSelect, HubHeader, Kpi, LEDGER_TONE, MenuButton, Pagination, PanelClose,
  PlatformIcon, PRESETS, ProductThumb, SearchBox, SplitLayout, StatusPill, UnderlineTabs, compareWord, darkButton, dateTime, downloadCsv, nf, naira,
  presetLabel, rowCls, shortDay, smallBlueButton, smallButton, listTableCls, tableCls, timeOf, timeWithSeconds, useLoad, type Range, type Toast
} from "./HubParts";

// Event Ledger tab - built to Bright's image (2 Oct 2026). One row per order.

type LedgerTabKey = "all" | "purchase" | "browser" | "server" | "deduplicated" | "failed" | "test";
type PanelTab = "details" | "events" | "attribution" | "customer" | "timeline";

export default function LedgerTab({ tabBar, onToast, range, onRange, initial, onOpenOrder }: {
  tabBar: ReactNode; onToast: Toast; range: Range; onRange: (range: Range) => void; initial: { status?: string; orderIds?: string[] }; onOpenOrder?: (orderId: string) => void;
}) {
  const [tab, setTab] = useState<LedgerTabKey>("all");
  const [filters, setFilters] = useState({ q: "", status: initial.status ?? "", dataSourceId: "", websiteId: "", productId: "" });
  const [only, setOnly] = useState<string[] | null>(initial.orderIds ?? null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const query = { ...range, tab, ...filters, orderIds: only?.join(",") ?? "" };
  const { data } = useLoad(() => trackingHubApi.ledger({ ...query, page, pageSize }), [range.from, range.to, tab, filters.q, filters.status, filters.dataSourceId, filters.websiteId, filters.productId, only?.join(","), page, pageSize], onToast);
  useEffect(() => { setPage(1); }, [range.from, range.to, tab, filters, only, pageSize]);
  useEffect(() => { if (!closed && data?.rows.length && (!selected || !data.rows.some((row) => row.orderId === selected))) setSelected(data.rows[0].orderId); }, [data]);

  const exportCsv = async () => {
    try { const result = await trackingHubApi.ledgerExport(query); downloadCsv(result.filename, result.csv); } catch (err: any) { onToast(err?.message ?? "Could not export."); }
  };
  const k = data?.kpis;
  const p = data?.previous;
  const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : now > 0 ? 100 : 0);
  const clear = () => { setFilters({ q: "", status: "", dataSourceId: "", websiteId: "", productId: "" }); setOnly(null); };
  const tc = data?.tabCounts ?? {};

  return (
    <div className="space-y-5">
      <HubHeader title="Event Ledger" subtitle="All conversion events sent to advertising platforms. One record per order with full tracking details."
        actions={<>
          <DateRangeButton range={range} onChange={onRange} />
          <MenuButton label="Export" icon={<Download className="h-4 w-4" />} items={[{ label: "Download CSV (these filters)", onClick: () => void exportCsv() }]} />
          <a href={data?.mainPixelUrl ?? "https://business.facebook.com/events_manager2"} target="_blank" rel="noreferrer" className={darkButton}>View in Meta Events Manager <ExternalLink className="h-4 w-4" /></a>
        </>} />
      {tabBar}
      <Card className="px-2">
        <UnderlineTabs className="!border-b-0" value={tab} onChange={setTab} tabs={[
          { key: "all", label: "All Events", icon: <FileText className="h-4 w-4" />, count: tc.all }, { key: "purchase", label: "Purchase Events", icon: <ShoppingCart className="h-4 w-4" />, count: tc.purchase },
          { key: "browser", label: "Browser Events", icon: <Globe className="h-4 w-4" />, count: tc.browser }, { key: "server", label: "Server Events (CAPI)", icon: <Server className="h-4 w-4" />, count: tc.server },
          { key: "deduplicated", label: "Deduplicated", icon: <BadgeCheck className="h-4 w-4" />, count: tc.deduplicated }, { key: "failed", label: "Failed Events", icon: <TriangleAlert className="h-4 w-4" />, count: tc.failed },
          { key: "test", label: "Test Events", icon: <FlaskConical className="h-4 w-4" />, count: tc.test }
        ]} />
      </Card>
      {k && p ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <Kpi icon={<ShoppingCart className="h-7 w-7" />} tone="red" label="Total Orders" value={nf(k.orders)} delta={<span className="leading-tight"><Delta value={change(k.orders, p.orders)} /><span className="block text-[11px] font-normal text-gray-400">{compareWord(range)}</span></span>} />
          <Kpi icon={<Shuffle className="h-7 w-7" />} tone="blue" label="Purchase Events" value={nf(k.purchaseEvents)} delta={<span className="leading-tight"><Delta value={change(k.purchaseEvents, p.purchaseEvents)} /><span className="block text-[11px] font-normal text-gray-400">{k.purchasePct}% of orders</span></span>} />
          <Kpi icon={<Globe className="h-7 w-7" />} tone="green" label="Browser Events" value={nf(k.browserEvents)} delta={<span className="text-[11px] text-gray-400">{k.browserPct}% coverage</span>} />
          <Kpi icon={<Server className="h-7 w-7" />} tone="blue" label="Server Events (CAPI)" value={nf(k.serverEvents)} delta={<span className="text-[11px] text-gray-400">{k.serverPct}% coverage</span>} />
          <Kpi icon={<CircleCheck className="h-7 w-7" />} tone="green" label="Deduplicated" value={nf(k.deduped)} delta={<span className="text-[11px] text-gray-400">{k.dedupRate}% match rate</span>} />
          <Kpi icon={<TriangleAlert className="h-7 w-7" />} tone="red" label="Failed Events" value={nf(k.failed)} onClick={() => setTab("failed")} />
        </div>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={filters.q} onChange={(q) => setFilters({ ...filters, q })} placeholder="Search by Order ID, product, campaign, ad ID..." className="min-w-[220px] flex-1" />
          <FilterSelect value={PRESETS.find((item) => item.label === presetLabel(range))?.key ?? "custom"} onChange={(key) => { const preset = PRESETS.find((item) => item.key === key); if (preset) onRange(preset.range()); }} className="w-40">
            {PRESETS.map((item) => <option key={item.key} value={item.key}>Date: {item.label}</option>)}{presetLabel(range) === "Custom" ? <option value="custom">Date: Custom</option> : null}
          </FilterSelect>
          <FilterSelect value={filters.status} onChange={(status) => setFilters({ ...filters, status })} className="w-36"><option value="">Status: All</option><option value="deduped">Deduped</option><option value="server_only">Server only</option><option value="capi_only">CAPI only</option><option value="browser_only">Browser only</option><option value="capi_failed">CAPI failed</option><option value="sending">Sending</option><option value="test">Test</option><option value="not_tracked">Not tracked</option><option value="page_pixel">Thank-you page</option></FilterSelect>
          <FilterSelect value={filters.dataSourceId} onChange={(dataSourceId) => setFilters({ ...filters, dataSourceId })} className="w-44"><option value="">Data Source: All</option>{data?.filters.dataSources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</FilterSelect>
          <FilterSelect value={filters.websiteId} onChange={(websiteId) => setFilters({ ...filters, websiteId })} className="w-40"><option value="">Website: All</option>{data?.filters.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</FilterSelect>
          <FilterSelect value={filters.productId} onChange={(productId) => setFilters({ ...filters, productId })} className="w-36"><option value="">Product: All</option>{data?.filters.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</FilterSelect>
          <button type="button" className={`${smallButton} !h-10 !px-4`} onClick={clear}>Clear</button>
          {only ? <span className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700">Showing {only.length} affected orders</span> : null}
          {selected && !closed ? <button type="button" aria-label="Close details" className="!min-h-0 ml-auto rounded-md p-1.5 text-gray-500 hover:bg-gray-100" onClick={() => { setSelected(null); setClosed(true); }}><X className="h-5 w-5" /></button> : null}
        </div>

        <div className="mt-3">
          <SplitLayout
            list={
              <div>
                <div className="overflow-x-auto">
                  <table className={listTableCls}>
                    <thead><tr className="text-gray-500">
                      <th className="w-8"><CheckBox checked={Boolean(data?.rows.length) && data!.rows.every((row) => checked.includes(row.orderId))} onChange={(value) => setChecked(value ? (data?.rows ?? []).map((row) => row.orderId) : [])} /></th>
                      {["Order ID", "Product", "Website", "Source", "Campaign / Ad", "Value", "Browser", "CAPI", "Status", "Time"].map((head) => <th key={head} className="underline decoration-gray-300 underline-offset-4">{head}</th>)}<th className="text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {(data?.rows ?? []).map((row) => {
                        const sent = row.serverStatus === "sent" || row.serverStatus === "dry_run";
                        const failed = row.status === "capi_failed";
                        return (
                          <tr key={row.orderId} onClick={() => { setSelected(row.orderId); setClosed(false); }} className={`${rowCls} cursor-pointer ${selected === row.orderId ? "bg-blue-50/60 dark:bg-blue-950/20" : "hover:bg-gray-50 dark:hover:bg-slate-800/40"}`}>
                            <td className="py-2.5"><CheckBox checked={checked.includes(row.orderId)} onChange={(value) => setChecked((list) => value ? [...list, row.orderId] : list.filter((id) => id !== row.orderId))} /></td>
                            <td className="py-2.5 font-bold">{row.orderId}</td>
                            <td className="max-w-[76px] truncate py-2.5 text-gray-600" title={row.product}>{row.product}</td>
                            <td className="max-w-[104px] truncate py-2.5 text-gray-600" title={row.website ?? ""}>{row.website ?? "—"}</td>
                            <td className="py-2.5 text-gray-600">{sourceLabel(row.source)}</td>
                            <td className="whitespace-nowrap py-2.5 text-gray-600" title={row.campaignId ? `Campaign ${row.campaignId}${row.adsetId ? ` · Ad set ${row.adsetId}` : ""}${row.adId ? ` · Ad ${row.adId}` : ""}` : ""}>{row.campaignId ? `${row.campaignId.slice(0, 9)}${row.adId ? ` / Ad ${row.adId.slice(-2)}` : ""}` : "—"}</td>
                            <td className="whitespace-nowrap py-2.5 text-gray-700 dark:text-slate-200">{naira(row.value, row.currency)}</td>
                            <td className="py-2.5"><CheckDot state={row.browser ? "ok" : row.status === "sending" ? "pending" : row.trackingMode === "hybrid" ? "fail" : "off"} /></td>
                            <td className="py-2.5"><CheckDot state={sent ? "ok" : failed ? "fail" : row.status === "sending" ? "pending" : "off"} /></td>
                            <td className="py-2.5"><StatusPill size="sm" tone={LEDGER_TONE[row.status]}>{row.statusLabel}</StatusPill></td>
                            <td className="whitespace-nowrap py-2.5 text-gray-600">{presetLabel(range) === "Today" ? timeOf(row.createdAt) : `${shortDay(row.createdAt.slice(0, 10))} ${timeOf(row.createdAt)}`}</td>
                            <td className="py-2.5 text-right"><ActionMenu items={[{ label: "Tracking details", onClick: () => { setSelected(row.orderId); setClosed(false); } }, ...(onOpenOrder ? [{ label: "Open order", onClick: () => onOpenOrder(row.orderId) }] : [])]} /></td>
                          </tr>
                        );
                      })}
                      {data && data.rows.length === 0 ? <EmptyRow colSpan={12} text="No form orders match." /> : null}
                      {!data ? <EmptyRow colSpan={12} text="Loading…" /> : null}
                    </tbody>
                  </table>
                </div>
                <Pagination page={page} pageSize={pageSize} total={data?.total ?? 0} noun="events" onPage={setPage} onPageSize={setPageSize} sizes={[15, 25, 50, 100]} />
              </div>
            }
            narrow
            panel={selected && !closed ? <LedgerPanel key={selected} orderId={selected} onClose={() => { setSelected(null); setClosed(true); }} onToast={onToast} onOpenOrder={onOpenOrder} /> : null}
          />
        </div>
      </Card>
    </div>
  );
}

const sourceLabel = (source: string | null) => {
  if (!source) return "—";
  if (/^(fb|ig|facebook|instagram|meta|an|msg)$/i.test(source)) return "Meta";
  if (/tiktok/i.test(source)) return "TikTok";
  if (/google/i.test(source)) return "Google";
  return source;
};

function LedgerPanel({ orderId, onClose, onToast, onOpenOrder }: { orderId: string; onClose: () => void; onToast: Toast; onOpenOrder?: (orderId: string) => void }) {
  const { data, error } = useLoad(() => trackingHubApi.ledgerDetail(orderId), [orderId]);
  const [tab, setTab] = useState<PanelTab>("details");
  if (error) return <div className="rounded-xl border border-gray-200 p-6 text-sm text-rose-700 dark:border-slate-700">{error}</div>;
  if (!data) return <div className="rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-500 dark:border-slate-700">Loading…</div>;
  const healthy = data.status === "deduped" || data.status === "server_only" || data.status === "capi_only";
  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">Order {data.orderId}</h2><StatusPill tone={LEDGER_TONE[data.status]}>{data.statusLabel}</StatusPill></div>
          <p className="m-0 mt-0.5 text-[13px] text-gray-500">{data.product} • {naira(data.value, data.currency)}</p>
        </div>
        {onOpenOrder ? <button type="button" className={smallBlueButton} onClick={() => onOpenOrder(data.orderId)}>View Order <ExternalLink className="h-3.5 w-3.5" /></button> : null}
        <PanelClose onClose={onClose} />
      </div>
      <UnderlineTabs className="mt-2" value={tab} onChange={setTab} tabs={[{ key: "details", label: "Details" }, { key: "events", label: "Events" }, { key: "attribution", label: "Attribution" }, { key: "customer", label: "Customer" }, { key: "timeline", label: "Timeline" }]} />

      {tab === "details" ? (
        <div className="mt-3 space-y-4">
          <div className="flex items-center gap-3">
            <ProductThumb src={data.productImage} size={64} />
            <div className="min-w-0 flex-1"><p className="m-0 text-[14px] font-bold text-gray-900 dark:text-slate-100">{data.product}</p>{data.sku ? <p className="m-0 text-[12.5px] text-gray-500">SKU: {data.sku}</p> : null}{data.packageName ? <p className="m-0 text-[12.5px] text-gray-500">Package: {data.packageName}</p> : null}</div>
            <strong className="text-[17px] font-black text-gray-900 dark:text-slate-100">{naira(data.value, data.currency)}</strong>
          </div>
          <div>
            <div className="flex items-center justify-between"><p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-100">Tracking Summary</p><StatusPill size="sm" tone={healthy ? "green" : LEDGER_TONE[data.status]}>{healthy ? "Healthy" : data.statusLabel}</StatusPill></div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <SummaryBox ok={Boolean(data.browserEvent)} title="Browser Pixel" line={data.browserEvent ? "Sent" : data.trackingMode === "hybrid" ? "Not reported" : "Not used"} at={data.browserEvent?.firedAt ?? null} />
              <SummaryBox ok={data.serverEvent?.status === "sent" || data.serverEvent?.status === "dry_run"} failed={Boolean(data.serverEvent && !["sent", "dry_run"].includes(data.serverEvent.status))} title="Conversions API" line={data.serverEvent ? (data.serverEvent.status === "sent" ? "Sent" : data.serverEvent.status) : "Not sent"} at={data.serverEvent?.sentAt ?? null} />
              <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700"><p className="m-0 text-[12px] font-bold text-gray-800 dark:text-slate-200">Event ID</p><p className="m-0 mt-1 truncate text-[12px] text-gray-600" title={data.eventId ?? ""}>{data.eventId ?? "—"}</p></div>
            </div>
            {data.serverEvent?.human ? <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12.5px] text-rose-800"><strong className="block">{data.serverEvent.human.title}</strong>{data.serverEvent.human.action}</div> : null}
          </div>
          <div>
            <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-100">Event Details</p>
            <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[12.5px] min-[1700px]:grid-cols-[auto_1fr_auto_1fr]">
              <Dt>Event Name</Dt><Dd>Purchase</Dd><Dt>Event Value</Dt><Dd>{naira(data.value, data.currency)}</Dd>
              <Dt>Event ID</Dt><Dd>{data.eventId ? <span className="flex items-center gap-1"><span className="truncate">{data.eventId}</span><CopyButton text={data.eventId} onToast={onToast} /></span> : "—"}</Dd><Dt>Currency</Dt><Dd>{data.currency}</Dd>
              <Dt>Event Time</Dt><Dd>{dateTime(data.serverEvent?.sentAt ?? data.browserEvent?.firedAt ?? data.createdAt).replace(" •", "")}</Dd><Dt>Status</Dt><Dd><StatusPill size="sm" tone={LEDGER_TONE[data.status]}>{data.statusLabel}</StatusPill></Dd>
              <Dt>Deduplication</Dt><Dd>{data.status === "deduped" ? "Browser + Server matched" : data.browserEvent && data.serverEvent ? "Different event ids" : "One source only"}</Dd><Dt>Sent to Meta</Dt><Dd>{data.browserEvent && data.serverEvent?.status === "sent" ? "Yes (Browser + CAPI)" : data.serverEvent?.status === "sent" ? "Yes (CAPI)" : data.browserEvent ? "Yes (Browser)" : "No"}</Dd>
            </dl>
          </div>
          <AttributionGrid data={data} onToast={onToast} />
          <div className="grid grid-cols-2 gap-2">
            <PageBox label="Landing Page" url={data.landingPage} />
            <PageBox label="Thank-you Page" url={data.thankYouPage} pathOnly />
          </div>
        </div>
      ) : null}

      {tab === "events" ? (
        <div className="mt-3 space-y-3 text-[12.5px]">
          <EventCard title="Browser Pixel Purchase" rows={data.browserEvent ? [["Fired", dateTime(data.browserEvent.firedAt)], ["Event ID", data.browserEvent.eventId], ["Pixel", data.browserEvent.pixelId ?? "—"], ["Page", data.browserEvent.pageUrl ?? "—"], ["Pixels on page", data.browserEvent.pixelsOnPage.join(", ") || "—"]] : null} empty={data.trackingMode === "hybrid" ? "Not reported by the page. Re-copy the embed code from Tracking Links." : "This form does not fire the browser Purchase."} />
          <EventCard title="Conversions API Purchase" rows={data.serverEvent ? [["Sent", dateTime(data.serverEvent.sentAt)], ["Event ID", data.serverEvent.eventId], ["Status", `${data.serverEvent.status}${data.serverEvent.test ? " (test)" : ""}`], ["Attempts", String(data.serverEvent.attempts ?? 1)], ["Meta said", data.serverEvent.message ?? "—"]] : null} empty="Not sent by the server." />
          <EventCard title="Delivered sale" rows={data.deliveredEvent ? [["Sent", dateTime(data.deliveredEvent.sentAt)], ["Event", data.deliveredEvent.metaEventName], ["Status", data.deliveredEvent.status], ["Meta said", data.deliveredEvent.message ?? "—"]] : null} empty={data.deliveredDate ? "Delivered, event not sent yet." : "Not delivered yet."} />
        </div>
      ) : null}

      {tab === "attribution" ? (
        <div className="mt-3 space-y-3">
          <AttributionGrid data={data} onToast={onToast} />
          <dl className="m-0 grid grid-cols-[110px_1fr] gap-y-1.5 text-[12.5px]">
            <Dt>_fbp</Dt><Dd>{data.fbp ?? "—"}</Dd><Dt>_fbc</Dt><Dd>{data.fbc ?? "—"}</Dd><Dt>UTM Term</Dt><Dd>{data.utm.term ?? "—"}</Dd><Dt>Device</Dt><Dd>{data.device.deviceType ?? "—"}</Dd>
          </dl>
        </div>
      ) : null}

      {tab === "customer" ? (
        <dl className="m-0 mt-3 grid grid-cols-[110px_1fr] gap-y-2 text-[13px]">
          <Dt>Name</Dt><Dd>{data.customer.name ?? "—"}</Dd><Dt>Phone</Dt><Dd>{data.customer.phone ?? "—"}</Dd><Dt>State</Dt><Dd>{data.customer.state ?? "—"}</Dd><Dt>City</Dt><Dd>{data.customer.city ?? "—"}</Dd>
          <Dt>Device</Dt><Dd>{data.device.deviceType ?? "—"}</Dd><Dt>Language</Dt><Dd>{data.device.locale ?? "—"}</Dd><Dt>Browser</Dt><Dd><span className="break-all text-[11.5px]">{data.device.userAgent ?? "—"}</span></Dd>
          <Dt>Order status</Dt><Dd>{data.orderStatus ?? "—"}</Dd>
        </dl>
      ) : null}

      {tab === "timeline" ? (
        <ol className="m-0 mt-3 list-none space-y-3 border-l-2 border-gray-100 p-0 pl-4 dark:border-slate-800">
          {data.timeline.map((item, index) => (
            <li key={index} className="relative"><span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-blue-500" /><p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-100">{item.label}</p><p className="m-0 text-[12px] text-gray-500">{dateTime(item.at)}{item.detail ? ` · ${item.detail}` : ""}</p></li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const Dt = ({ children }: { children: ReactNode }) => <dt className="text-gray-500">{children}</dt>;
const Dd = ({ children }: { children: ReactNode }) => <dd className="m-0 min-w-0 truncate font-medium text-gray-800 dark:text-slate-200">{children}</dd>;

function SummaryBox({ ok, failed, title, line, at }: { ok: boolean; failed?: boolean; title: string; line: string; at: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
      {ok ? <CheckCircle2 className="h-5 w-5 shrink-0 fill-emerald-500 text-white" /> : failed ? <TriangleAlert className="h-5 w-5 shrink-0 text-rose-500" /> : <span className="h-5 w-5 shrink-0 rounded-full border-2 border-gray-200" />}
      <div className="min-w-0"><p className="m-0 text-[12px] font-bold text-gray-800 dark:text-slate-200">{title}</p><p className={`m-0 text-[12px] ${ok ? "text-emerald-600" : failed ? "text-rose-600" : "text-gray-500"}`}>{line}</p>{at ? <p className="m-0 text-[11.5px] text-gray-400">{timeWithSeconds(at)}</p> : null}</div>
    </div>
  );
}

function AttributionGrid({ data, onToast }: { data: HubLedgerDetail; onToast: Toast }) {
  const source = sourceLabel(data.source);
  return (
    <div>
      <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-100">Attribution</p>
      <dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px] min-[1700px]:grid-cols-[auto_1fr_auto_1fr]">
        <Dt>Source</Dt><Dd>{source === "Meta" ? <span className="flex items-center gap-1"><PlatformIcon platform="meta" size="sm" />Meta</span> : source}</Dd><Dt>UTM Source</Dt><Dd>{data.utm.source ?? "—"}</Dd>
        <Dt>Campaign ID</Dt><Dd>{data.campaignId ?? "—"}</Dd><Dt>UTM Campaign</Dt><Dd>{data.utm.campaign ?? "—"}</Dd>
        <Dt>Ad Set ID</Dt><Dd>{data.adsetId ?? "—"}</Dd><Dt>UTM Content</Dt><Dd>{data.utm.content ?? "—"}</Dd>
        <Dt>Ad ID</Dt><Dd>{data.adId ?? "—"}</Dd><Dt>UTM Medium</Dt><Dd>{data.utm.medium ?? "—"}</Dd>
        <Dt>fbclid</Dt><Dd>{data.fbclid ? <span className="flex items-center gap-1"><span className="truncate">{data.fbclid.slice(0, 5)}…{data.fbclid.slice(-4)}</span><CopyButton text={data.fbclid} onToast={onToast} /></span> : "—"}</Dd>
        <Dt>Referral URL</Dt><Dd>{data.referralUrl ? <span className="flex items-center gap-1"><span className="truncate">{data.referralUrl.replace(/^https?:\/\//, "")}</span><CopyButton text={data.referralUrl} onToast={onToast} /></span> : "—"}</Dd>
      </dl>
    </div>
  );
}

function PageBox({ label, url, pathOnly }: { label: string; url: string | null; pathOnly?: boolean }) {
  let shown = url ?? "—";
  if (url && pathOnly) { try { shown = new URL(url).pathname; } catch { shown = url; } }
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
      <p className="m-0 text-[11.5px] text-gray-500">{label}</p>
      {url ? <a href={url} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1 truncate text-[12.5px] text-blue-600">{shown}<ExternalLink className="h-3 w-3 shrink-0" /></a> : <p className="m-0 mt-1 text-[12.5px] text-gray-400">—</p>}
    </div>
  );
}

function EventCard({ title, rows, empty }: { title: string; rows: Array<[string, string]> | null; empty: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
      <p className="m-0 font-bold text-gray-900 dark:text-slate-100">{title}</p>
      {rows ? <dl className="m-0 mt-1.5 grid grid-cols-[110px_1fr] gap-y-1">{rows.map(([label, value]) => <Fragment key={label}><Dt>{label}</Dt><dd className="m-0 break-all text-gray-800 dark:text-slate-200">{value}</dd></Fragment>)}</dl> : <p className="m-0 mt-1 text-gray-500">{empty}</p>}
    </div>
  );
}

