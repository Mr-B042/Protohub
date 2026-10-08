import { useEffect, useState, type ReactNode } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, LabelList, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AlertTriangle, ArrowUpDown, BarChart3, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Columns3, Database, Download, Filter, Plus, RefreshCw, ShoppingCart, Trash2, Truck, Users, Wallet, X
} from "lucide-react";
import { trackingHubApi, type HubAdSpend, type HubAdSpendLevel, type HubAdSpendRow, type HubAdSpendView, type HubSpendSplit, type HubUnmappedCampaign } from "../../lib/api";
import {
  ActionMenu, Card, CheckBox, DateRangeButton, Delta, EmptyRow, HubHeader, LoadState, Modal, PRESETS, ProductThumb, SearchBox, Sparkline, Toggle,
  compareWord, daysBetween, downloadCsv, labelCls, lagosToday, longDay, naira, nf, presetLabel, primaryButton, outlineButton, rowCls, selectCls, shift, shortDay, smallButton, tableCls,
  useLoad, type HubTab, type Range, type Toast
} from "./HubParts";

// Tracking Hub -> Ad Spend & Performance (Bright's image, 8 Oct 2026). Meta
// gives the spend, Protohub the orders, deliveries and money. Spend follows
// Meta IDs to products (backend lib/ad-spend.ts); anything without a product
// is shown as "Not assigned", never guessed.

const UNMAPPED = "__unmapped__";
const VIEWS: Array<{ key: HubAdSpendView; label: string; noun: string; plural: string }> = [
  { key: "product", label: "Product View", noun: "Product", plural: "products" },
  { key: "campaign", label: "Campaign View", noun: "Campaign", plural: "campaigns" },
  { key: "adset", label: "Ad Set View", noun: "Ad Set", plural: "ad sets" },
  { key: "ad", label: "Ad View", noun: "Ad", plural: "ads" },
  { key: "account", label: "Ad Account View", noun: "Ad Account", plural: "ad accounts" },
  { key: "business", label: "Business Account View", noun: "Business Account", plural: "business accounts" }
];
const LEVEL_OF_VIEW: Partial<Record<HubAdSpendView, HubAdSpendLevel>> = { campaign: "campaign", adset: "adset", ad: "ad", account: "account" };
const LEVEL_LABEL: Record<HubAdSpendLevel, string> = { campaign: "Campaign", adset: "Ad set", ad: "Ad", account: "Ad account" };
const DONUT_COLORS = ["#2563eb", "#22c55e", "#f59e0b", "#8b5cf6", "#f43f5e", "#06b6d4", "#94a3b8"];

type ColumnKey = "orders" | "delivered" | "cpa" | "cpdo" | "deliveredAov" | "roas" | "profit" | "trend";
const COLUMNS: Array<{ key: ColumnKey; label: string; title: string }> = [
  { key: "orders", label: "Orders", title: "Orders placed in the period" },
  { key: "delivered", label: "Delivered", title: "Orders placed in the period that are now delivered" },
  { key: "cpa", label: "CPA", title: "Cost per order: ad spend ÷ orders" },
  { key: "cpdo", label: "CPDO", title: "Cost per delivered order: ad spend ÷ delivered orders" },
  { key: "deliveredAov", label: "Delivered AOV", title: "Average value of a delivered order" },
  { key: "roas", label: "ROAS", title: "Delivered revenue ÷ ad spend" },
  { key: "profit", label: "Profit (After Ads)", title: "Delivered revenue − product cost − delivery fees − ad spend" },
  { key: "trend", label: "Trend", title: "Ad spend, last 7 days" }
];
const COLUMN_STORE = "protohub.adSpend.columns";

const compact = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₦${Number((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1000) return `₦${Math.round(value / 1000)}K`;
  return `₦${Math.round(value)}`;
};
const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : naira(value));
const roasText = (value: number | null) => (value === null ? "—" : `${Number(value.toFixed(1))}x`);
const pctChange = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : ((now - before) / before) * 100);
const sourceText = (row: HubAdSpendRow) =>
  row.mappingSource === "link" ? "from tracking link" : row.mappingSource === "mixed" ? "mixed" : row.mappingSource ? "set by you" : null;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const monthStart = (day: string) => `${day.slice(0, 8)}01`;

// ---------------------------------------------------------------- small parts

function KpiCard({ icon, tone, label, value, delta, invert, sub, note }: { icon: ReactNode; tone: string; label: string; value: string; delta: number | null; invert?: boolean; sub: string; note?: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-4 dark:border-slate-800 dark:bg-slate-900">
      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold leading-tight text-gray-600 dark:text-slate-400">{label}</span>
        <strong className="mt-1 block whitespace-nowrap text-[22px] font-black leading-none text-gray-900 dark:text-slate-50">{value}</strong>
        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 leading-tight">
          <Delta value={delta === null ? null : Math.round(delta)} invert={invert} />
          <span className="whitespace-nowrap text-[10.5px] text-gray-400">{sub}</span>
        </span>
        {note ? <span className="mt-1 block text-[10.5px] font-semibold leading-tight text-amber-700 dark:text-amber-400">{note}</span> : null}
      </div>
    </div>
  );
}

function Popover({ button, children, align = "right", width = "w-64" }: { button: (toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right"; width?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      {button(() => setOpen((value) => !value))}
      {open ? (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-20 mt-1 ${width} rounded-xl border border-gray-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900`}>{children(() => setOpen(false))}</div>
        </>
      ) : null}
    </div>
  );
}

const filterButton = "!min-h-0 inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";

// ---------------------------------------------------------------- product picker (one product or a split)

function MappingModal({ target, products, current, onClose, onSaved, onToast }: {
  target: { level: HubAdSpendLevel; metaId: string; name: string; adAccountId?: string | null; spend?: number };
  products: HubAdSpend["filters"]["products"]; current: HubSpendSplit[] | null; onClose: () => void; onSaved: () => void; onToast: Toast;
}) {
  const [splits, setSplits] = useState<HubSpendSplit[]>(current?.length ? current : [{ productId: "", share: 100 }]);
  const [busy, setBusy] = useState(false);
  const total = splits.reduce((sum, split) => sum + (Number(split.share) || 0), 0);
  const split = splits.length > 1;
  const save = async () => {
    setBusy(true);
    try {
      await trackingHubApi.saveAdSpendMapping({ level: target.level, metaId: target.metaId, adAccountId: target.adAccountId ?? null, label: target.name, splits: splits.map((row) => ({ productId: row.productId, share: split ? Number(row.share) : 100 })) });
      onToast(`Saved. ${LEVEL_LABEL[target.level]} "${target.name}" now counts for ${split ? `${splits.length} products` : products.find((row) => row.id === splits[0].productId)?.name ?? "the product"}.`);
      onSaved();
    } catch (err: any) {
      onToast(`Couldn't save: ${err?.message ?? "try again."}`);
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Which product is this spend for?" subtitle={`${LEVEL_LABEL[target.level]}: ${target.name}${target.spend !== undefined ? ` · ${naira(target.spend)} in this period` : ""}`} onClose={onClose}>
      <p className="m-0 text-[13px] text-gray-600 dark:text-slate-300">Saved by its Meta ID, so renaming it in Meta won't break it. An ad's own product beats its ad set's, an ad set's beats its campaign's, and a campaign's beats the ad account's.</p>
      <div className="mt-4 space-y-2">
        {splits.map((row, index) => (
          <div key={index} className="flex items-center gap-2">
            <select value={row.productId} onChange={(event) => setSplits(splits.map((item, i) => (i === index ? { ...item, productId: event.target.value } : item)))} className={`${selectCls} min-w-0 flex-1`}>
              <option value="">Pick a product…</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
            {split ? (
              <>
                <label className="relative">
                  <input type="number" min={1} max={100} value={row.share} onChange={(event) => setSplits(splits.map((item, i) => (i === index ? { ...item, share: Number(event.target.value) } : item)))} className="h-10 w-20 rounded-lg border border-gray-200 bg-white pl-3 pr-6 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-gray-400">%</span>
                </label>
                {target.spend !== undefined ? <span className="w-24 text-right text-[12px] text-gray-500">{naira((target.spend * (Number(row.share) || 0)) / 100)}</span> : null}
                <button type="button" aria-label="Remove" onClick={() => setSplits(splits.filter((_, i) => i !== index))} className="!min-h-0 rounded p-1 text-gray-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setSplits(split ? [...splits, { productId: "", share: 0 }] : [{ ...splits[0], share: 50 }, { productId: "", share: 50 }])} className={smallButton}><Plus className="h-3.5 w-3.5" />{split ? "Add product" : "Split across products"}</button>
        {split ? <span className={`text-[12.5px] font-bold ${Math.abs(total - 100) < 0.01 ? "text-emerald-600" : "text-rose-600"}`}>Total {Number(total.toFixed(2))}% {Math.abs(total - 100) < 0.01 ? "" : "(must be 100%)"}</span> : null}
      </div>
      {split ? <p className="m-0 mt-2 text-[12px] text-gray-500">Only split when one ad really sells several products. Setting a product on each ad set or ad is more exact.</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={outlineButton}>Cancel</button>
        <button type="button" disabled={busy || splits.some((row) => !row.productId) || (split && Math.abs(total - 100) > 0.01)} onClick={save} className={primaryButton}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- unassigned spend

function UnmappedModal({ range, products, onClose, onSaved, onSplit, onToast }: {
  range: Range; products: HubAdSpend["filters"]["products"]; onClose: () => void; onSaved: () => void; onToast: Toast;
  onSplit: (target: { level: HubAdSpendLevel; metaId: string; name: string; adAccountId: string; spend: number }) => void;
}) {
  const { data, error, reload } = useLoad(() => trackingHubApi.adSpendUnmapped(range), [range.from, range.to]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    const suggested: Record<string, string> = {};
    for (const campaign of data.campaigns) if (campaign.suggestion) suggested[`campaign:${campaign.campaignId}`] = campaign.suggestion;
    setPicked((value) => ({ ...suggested, ...value }));
  }, [data]);
  const choices = Object.entries(picked).filter(([, productId]) => productId);
  const save = async () => {
    if (!data) return;
    setBusy(true);
    let saved = 0;
    try {
      for (const [key, productId] of choices) {
        const [level, metaId] = key.split(":") as [HubAdSpendLevel, string];
        const campaign = data.campaigns.find((row) => (level === "campaign" ? row.campaignId === metaId : row.adsets.some((adset) => adset.adsetId === metaId)));
        const name = level === "campaign" ? campaign?.campaignName ?? metaId : campaign?.adsets.find((adset) => adset.adsetId === metaId)?.adsetName ?? metaId;
        await trackingHubApi.saveAdSpendMapping({ level, metaId, adAccountId: campaign?.accountId ?? null, label: name, splits: [{ productId, share: 100 }] });
        saved += 1;
      }
      onToast(`Saved ${plural(saved, "product choice")}.`);
      onSaved();
    } catch (err: any) {
      onToast(`Couldn't save (${saved} saved): ${err?.message ?? "try again."}`);
    } finally { setBusy(false); }
  };
  const productSelect = (key: string, suggestion?: string | null) => (
    <div className="min-w-[200px]">
      <select value={picked[key] ?? ""} onChange={(event) => setPicked({ ...picked, [key]: event.target.value })} className={`${selectCls} w-full`}>
        <option value="">Pick a product…</option>
        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select>
      {suggestion && picked[key] === suggestion ? <span className="mt-0.5 block text-[11px] text-amber-700">Picked from the name. Check before saving.</span> : null}
    </div>
  );
  return (
    <Modal wide title="Spend not assigned to a product" subtitle={`${longDay(range.from)}${range.from === range.to ? "" : ` – ${longDay(range.to)}`}. Pick the product once; Protohub remembers it by the Meta ID.`} onClose={onClose}>
      {!data ? <LoadState compact error={error} onRetry={reload} /> : data.campaigns.length === 0 ? (
        <p className="m-0 py-6 text-center text-[13.5px] text-gray-500">All spend in this period has a product.</p>
      ) : (
        <div className="space-y-3">
          {data.campaigns.map((campaign: HubUnmappedCampaign) => {
            const key = `campaign:${campaign.campaignId}`;
            const bySet = open[campaign.campaignId];
            return (
              <div key={campaign.campaignId} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <strong className="block text-[14px] text-gray-900 dark:text-slate-100">{campaign.campaignName || campaign.campaignId}</strong>
                    <span className="block text-[12px] text-gray-500">{campaign.accountName} · {plural(campaign.adsets.length, "ad set")} · <strong className="text-gray-800 dark:text-slate-200">{naira(campaign.spend)}</strong></span>
                  </div>
                  {bySet ? null : productSelect(key, campaign.suggestion)}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {campaign.adsets.length > 1 ? <button type="button" onClick={() => { setOpen({ ...open, [campaign.campaignId]: !bySet }); setPicked({ ...picked, [key]: "" }); }} className={smallButton}>{bySet ? "One product for the whole campaign" : "Different products per ad set"}</button> : null}
                  <button type="button" onClick={() => onSplit({ level: "campaign", metaId: campaign.campaignId, name: campaign.campaignName, adAccountId: campaign.accountId, spend: campaign.spend })} className={smallButton}>Split by %</button>
                </div>
                {bySet ? (
                  <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-slate-800">
                    {campaign.adsets.map((adset) => (
                      <div key={adset.adsetId} className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-[13px] text-gray-700 dark:text-slate-300">{adset.adsetName || adset.adsetId} · <strong>{naira(adset.spend)}</strong> <span className="text-gray-400">({plural(adset.ads.length, "ad")})</span></span>
                        {productSelect(`adset:${adset.adsetId}`)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={outlineButton}>Cancel</button>
            <button type="button" disabled={busy || choices.length === 0} onClick={save} className={primaryButton}>{busy ? "Saving…" : `Save ${choices.length || ""}`.trim()}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- the tab

export default function AdSpendTab({ tabBar, range, onRange, onToast, onTab }: { tabBar: ReactNode; range: Range; onRange: (range: Range) => void; onToast: Toast; onTab: (tab: HubTab) => void }) {
  const [compare, setCompare] = useState<"previous" | "none">("previous");
  const [view, setView] = useState<HubAdSpendView>("product");
  const [chartDays, setChartDays] = useState(7);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [business, setBusiness] = useState("");
  const [accountId, setAccountId] = useState("");
  const [productId, setProductId] = useState("");
  const [campaign, setCampaign] = useState<{ id: string; name: string } | null>(null);
  const [adset, setAdset] = useState<{ id: string; name: string } | null>(null);
  const [assigned, setAssigned] = useState<"all" | "assigned" | "unassigned">("all");
  const [showCharts, setShowCharts] = useState(true);
  const [sort, setSort] = useState<{ key: "spend" | ColumnKey; dir: 1 | -1 }>({ key: "spend", dir: -1 });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [mapping, setMapping] = useState<{ level: HubAdSpendLevel; metaId: string; name: string; adAccountId?: string | null; spend?: number } | null>(null);
  const [unmappedOpen, setUnmappedOpen] = useState(false);
  const [columns, setColumns] = useState<Set<ColumnKey>>(() => {
    try { const saved = JSON.parse(localStorage.getItem(COLUMN_STORE) ?? "null"); if (Array.isArray(saved)) return new Set(saved as ColumnKey[]); } catch { /* storage off */ }
    return new Set(COLUMNS.map((column) => column.key));
  });
  useEffect(() => { const timer = setTimeout(() => setQ(search), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); setSelected(new Set()); }, [view, q, business, accountId, productId, campaign?.id, adset?.id, assigned, range.from, range.to]);
  const toggleColumn = (key: ColumnKey) => {
    const next = new Set(columns);
    if (next.has(key)) next.delete(key); else next.add(key);
    setColumns(next);
    try { localStorage.setItem(COLUMN_STORE, JSON.stringify(Array.from(next))); } catch { /* storage off */ }
  };

  const length = daysBetween(range.from, range.to);
  const query = {
    from: range.from, to: range.to, compareFrom: shift(range.from, -length), compareTo: shift(range.from, -1), view, chartDays,
    q: q || undefined, business: business || undefined, accountId: accountId || undefined, productId: productId || undefined, campaignId: campaign?.id, adsetId: adset?.id
  };
  const { data, error, reload, setData } = useLoad(() => trackingHubApi.adSpend(query), [JSON.stringify(query)]);

  const sync = async () => {
    setSyncing(true);
    try {
      const result = await trackingHubApi.syncAdSpend(range);
      onToast(result.ok ? `${result.message} Spend is up to date.` : result.message);
      reload();
    } catch (err: any) {
      onToast(`Couldn't sync: ${err?.message ?? "try again."}`);
    } finally { setSyncing(false); }
  };
  const toggleAutoSync = async () => {
    if (!data) return;
    const on = !data.autoSync;
    try {
      await trackingHubApi.setAdSpendAutoSync(on);
      setData({ ...data, autoSync: on });
      onToast(on ? "Auto Sync is on. Protohub reads Meta's spend every 30 minutes." : "Auto Sync is off. Press Sync Now to read Meta's spend.");
    } catch (err: any) { onToast(`Couldn't change Auto Sync: ${err?.message ?? "try again."}`); }
  };

  const sub = compareWord(range);
  const header = (
    <HubHeader crumb="Ad Spend" title="Ad Spend & Performance" subtitle="Automatically track daily ad spend from Meta and see performance by product, campaign and ad." actions={
      <>
        <DateRangeButton range={range} onChange={onRange} />
        <label className="relative flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900">
          <span>
            <span className="block text-[12px] text-gray-500">Compare with</span>
            <select value={compare} onChange={(event) => setCompare(event.target.value as "previous" | "none")} className="!min-h-0 !h-auto appearance-none !border-0 bg-transparent !p-0 pr-7 text-[13px] font-semibold text-gray-800 !shadow-none outline-none dark:text-slate-200">
              <option value="previous">Previous period</option>
              <option value="none">No comparison</option>
            </select>
          </span>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-gray-500" />
        </label>
        <button type="button" onClick={toggleAutoSync} disabled={!data} title={data?.lastSync?.message ?? undefined}
          className="!min-h-0 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-left dark:border-slate-700 dark:bg-slate-900">
          <span className={`h-3 w-3 shrink-0 rounded-full ${!data?.autoSync ? "bg-gray-300" : data.lastSync && !data.lastSync.ok ? "bg-rose-500" : "bg-emerald-500"}`} />
          <span>
            <span className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Auto Sync {data && !data.autoSync ? "off" : ""}</span>
            <span className="block text-[11.5px] text-gray-500">{data?.lastSync ? `Last sync: ${new Date(data.lastSync.at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" })}${data.lastSync.ok ? "" : " (failed)"}` : "Not synced yet"}</span>
          </span>
        </button>
        <button type="button" onClick={sync} disabled={syncing} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-[14px] font-bold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900">
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync Now"}
        </button>
      </>
    } />
  );
  if (!data) return <div className="space-y-5">{header}{tabBar}<LoadState text="Loading ad spend…" error={error} onRetry={reload} /></div>;

  const k = data.kpis;
  const p = data.previous;
  const delta = (now: number | null, before: number | null) => (compare === "none" ? null : pctChange(now, before));
  // Today's orders aren't delivered yet, so ROAS waits for deliveries rather than showing 0x.
  const roasOf = (m: { roas: number | null; delivered: number }) => (m.delivered > 0 ? m.roas : null);
  const viewInfo = VIEWS.find((item) => item.key === view)!;
  const productOptions = data.filters.products;
  const mappingAt = (level: HubAdSpendLevel, id: string) => data.mappings.find((row) => row.level === level && row.metaId === id) ?? null;

  let rows = data.rows;
  if (assigned === "assigned") rows = rows.filter((row) => row.id !== UNMAPPED && row.unassignedSpend < row.spend);
  if (assigned === "unassigned") rows = rows.filter((row) => row.id === UNMAPPED || row.unassignedSpend > 0);
  const sortValue = (row: HubAdSpendRow) => (sort.key === "trend" ? row.trend.reduce((a, b) => a + b, 0) : sort.key === "roas" ? roasOf(row) ?? -1 : (row as any)[sort.key] ?? -1);
  rows = [...rows].sort((a, b) => (a.id === UNMAPPED ? 1 : b.id === UNMAPPED ? -1 : (sortValue(a) - sortValue(b)) * sort.dir));
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const shown = rows.slice((page - 1) * pageSize, page * pageSize);

  const drill = (row: HubAdSpendRow) => {
    if (row.id === UNMAPPED) { setUnmappedOpen(true); return; }
    if (view === "product") { setProductId(row.id); setView("campaign"); }
    else if (view === "campaign") { setCampaign({ id: row.id, name: row.name }); setView("adset"); }
    else if (view === "adset") { setAdset({ id: row.id, name: row.name }); setView("ad"); }
    else if (view === "account") { setAccountId(row.id); setView("campaign"); }
    else if (view === "business") { setBusiness(row.id); setView("account"); }
  };
  const subLine = (row: HubAdSpendRow) => {
    if (row.id === UNMAPPED) return `${plural(row.campaigns, "campaign")} need a product`;
    const product = row.products.length === 0 ? "Not assigned" : row.products.length === 1 ? row.products[0].name : `${row.products.length} products`;
    const source = sourceText(row);
    const productBit = `${product}${source && row.products.length ? ` (${source})` : ""}`;
    if (view === "product") return `${plural(row.campaigns, "campaign")} • ${plural(row.accounts, "ad account")}`;
    if (view === "campaign") return `${row.accountName ?? ""} • ${productBit}`;
    if (view === "adset") return `${row.campaignName ?? ""} • ${productBit}`;
    if (view === "ad") return `${row.adsetName || row.campaignName || ""} • ${productBit}`;
    if (view === "account") return `${plural(row.campaigns, "campaign")} • ${productBit}`;
    return `${plural(row.accounts, "ad account")} • ${plural(row.campaigns, "campaign")}`;
  };
  const actions = (row: HubAdSpendRow) => {
    if (row.id === UNMAPPED) return [{ label: "Assign products", onClick: () => setUnmappedOpen(true) }];
    const items: Array<{ label: string; onClick: () => void; danger?: boolean }> = [];
    const level = LEVEL_OF_VIEW[view];
    if (view === "product") items.push({ label: "See campaigns", onClick: () => drill(row) }, { label: "See ads", onClick: () => { setProductId(row.id); setView("ad"); } });
    if (view === "campaign") items.push({ label: "See ad sets", onClick: () => drill(row) });
    if (view === "adset") items.push({ label: "See ads", onClick: () => drill(row) });
    if (view === "account") items.push({ label: "See campaigns", onClick: () => drill(row) });
    if (view === "business") items.push({ label: "See ad accounts", onClick: () => drill(row) });
    if (level) {
      const existing = mappingAt(level, row.id);
      items.push({ label: level === "account" ? (existing ? "Change default product…" : "Set default product…") : existing ? "Change product…" : "Set product…", onClick: () => setMapping({ level, metaId: row.id, name: row.name, adAccountId: row.accountId, spend: row.spend }) });
      if (existing) items.push({ label: level === "account" ? "Remove default product" : "Remove product set here", danger: true, onClick: async () => {
        try { await trackingHubApi.clearAdSpendMapping({ level, metaId: row.id, label: row.name }); onToast("Removed. The spend now follows the next rule up (or shows as not assigned)."); reload(); }
        catch (err: any) { onToast(`Couldn't remove: ${err?.message ?? "try again."}`); }
      } });
      if (level !== "account" && row.accountId) {
        const param = level === "campaign" ? "selected_campaign_ids" : level === "adset" ? "selected_adset_ids" : "selected_ad_ids";
        items.push({ label: "Open in Ads Manager", onClick: () => window.open(`https://adsmanager.facebook.com/adsmanager/manage/${level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : "ads"}?act=${encodeURIComponent(row.accountId!)}&${param}=${encodeURIComponent(row.id)}`, "_blank", "noopener") });
      }
    }
    return items;
  };
  const exportCsv = () => {
    const list = selected.size ? rows.filter((row) => selected.has(row.id)) : rows;
    const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [[viewInfo.noun, "Meta ID", "Ad spend", "Orders", "Delivered", "Cost per order", "Cost per delivered order", "Delivered average order", "Return on ad spend", "Profit after ads"].map(cell).join(",")];
    for (const row of list) lines.push([row.name, row.id === UNMAPPED ? "" : row.id, Math.round(row.spend), row.orders, row.delivered, row.cpa === null ? "" : Math.round(row.cpa), row.cpdo === null ? "" : Math.round(row.cpdo), row.deliveredAov === null ? "" : Math.round(row.deliveredAov), roasOf(row) === null ? "" : roasOf(row)!.toFixed(2), row.delivered ? Math.round(row.profit) : ""].map(cell).join(","));
    downloadCsv(`ad-spend-${view}-${range.from}${range.from === range.to ? "" : `-to-${range.to}`}.csv`, lines.join("\n"));
  };
  const dayWeekMonth = (kind: "day" | "week" | "month") => {
    const to = range.to;
    onRange(kind === "day" ? { from: to, to } : kind === "week" ? { from: shift(to, -6), to } : { from: monthStart(to), to });
  };
  const periodKind = range.from === range.to ? "day" : range.from === shift(range.to, -6) ? "week" : range.from === monthStart(range.to) ? "month" : null;
  const th = (key: "spend" | ColumnKey, label: string, title?: string) => (
    <th key={key} title={title} className="cursor-pointer select-none whitespace-nowrap" onClick={() => setSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: -1 })}>
      <span className="inline-flex items-center gap-1">{label}{sort.key === key || key === "spend" ? <ArrowUpDown className={`h-3 w-3 ${sort.key === key ? "text-gray-700" : "text-gray-300"}`} /> : null}</span>
    </th>
  );
  const on = (key: ColumnKey) => columns.has(key);
  const colSpan = 3 + COLUMNS.filter((column) => on(column.key)).length;
  const donut = data.byProduct.length > 6 ? [...data.byProduct.slice(0, 5), { id: "others", name: "Others", spend: data.byProduct.slice(5).reduce((sum, row) => sum + row.spend, 0), share: data.byProduct.slice(5).reduce((sum, row) => sum + row.share, 0) }] : data.byProduct;
  // Products take the palette in order; "Not assigned" is always grey.
  const colorAt = new Map(donut.filter((row) => row.id !== UNMAPPED).map((row, index) => [row.id, DONUT_COLORS[index % (DONUT_COLORS.length - 1)]]));
  const donutColor = (id: string, _index: number) => (id === UNMAPPED ? "#cbd5e1" : colorAt.get(id) ?? "#94a3b8");
  const chartMax = Math.max(1, ...data.chart.map((row) => row.spend));
  const dateLabel = range.from === range.to ? longDay(range.from) : `${shortDay(range.from)} – ${shortDay(range.to)}`;
  const trendColor = (row: HubAdSpendRow) => (row.spend === 0 ? "#94a3b8" : row.delivered === 0 ? "#f59e0b" : row.profit >= 0 ? "#16a34a" : "#e11d48");

  return (
    <div className="space-y-5">
      {header}
      {tabBar}

      {!data.hasAccounts ? (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-200 bg-amber-50/60 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/20">
          <span className="text-[13.5px] text-amber-900 dark:text-amber-200"><strong>No Meta ad account is switched on.</strong> Connect your Meta Business in Data Sources and switch on its ad accounts; their spend then arrives here by itself.</span>
          <button type="button" onClick={() => onTab("sources")} className={smallButton}>Open Data Sources</button>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <KpiCard icon={<Wallet className="h-6 w-6" />} tone="bg-blue-50 text-blue-600 dark:bg-blue-950/40" label="Total Ad Spend" value={naira(k.spend)} delta={delta(k.spend, p.spend)} sub={sub} />
        <KpiCard icon={<ShoppingCart className="h-6 w-6" />} tone="bg-rose-50 text-rose-600 dark:bg-rose-950/40" label="Total Orders" value={nf(k.orders)} delta={delta(k.orders, p.orders)} sub={sub}
          note={data.leftOut.length ? `${data.leftOut.map((row) => `${nf(row.orders)} ${row.platform}`).join(", ")} order${data.leftOut.reduce((total, row) => total + row.orders, 0) === 1 ? "" : "s"} left out (not Meta)` : null} />
        <KpiCard icon={<Truck className="h-6 w-6" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40" label="Delivered Orders" value={nf(k.delivered)} delta={delta(k.delivered, p.delivered)} sub={sub} />
        <KpiCard icon={<Users className="h-6 w-6" />} tone="bg-violet-50 text-violet-600 dark:bg-violet-950/40" label="Cost Per Order (CPA)" value={money(k.cpa)} delta={delta(k.cpa, p.cpa)} invert sub={sub} />
        <KpiCard icon={<BarChart3 className="h-6 w-6" />} tone="bg-blue-50 text-blue-600 dark:bg-blue-950/40" label="Cost Per Delivered Order" value={money(k.cpdo)} delta={delta(k.cpdo, p.cpdo)} invert sub={sub} />
        <KpiCard icon={<Database className="h-6 w-6" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40" label="ROAS (Revenue)" value={roasText(roasOf(k))} delta={delta(roasOf(k), roasOf(p))} sub={sub} />
      </div>

      {showCharts ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Ad Spend Trend</h2>
              <select value={chartDays} onChange={(event) => setChartDays(Number(event.target.value))} className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900">
                <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-5 text-[12px] text-gray-600 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-blue-600" />Ad Spend</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Orders</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Delivered Orders</span>
            </div>
            <div className="mt-3 h-[230px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.chart.map((row) => ({ ...row, label: shortDay(row.day) }))} margin={{ top: 22, right: 4, left: 0, bottom: 0 }} barCategoryGap="38%">
                  <CartesianGrid vertical={false} stroke="#eef0f3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11.5, fill: "#6b7280" }} />
                  <YAxis yAxisId="spend" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={46} tickFormatter={(value: number) => compact(value)} domain={[0, Math.ceil((chartMax * 1.25) / 1000) * 1000]} />
                  <YAxis yAxisId="orders" orientation="right" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#6b7280" }} width={30} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} formatter={(value: any, name: any) => (name === "Ad Spend" ? naira(Number(value)) : nf(Number(value)))} />
                  <Bar yAxisId="spend" dataKey="spend" name="Ad Spend" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={44}>
                    {chartDays <= 14 ? <LabelList dataKey="spend" position="top" formatter={(value: any) => (Number(value) > 0 ? compact(Number(value)) : "")} style={{ fontSize: 11, fontWeight: 700, fill: "#374151" }} /> : null}
                  </Bar>
                  <Line yAxisId="orders" type="linear" dataKey="orders" name="Orders" stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: "#22c55e" }} />
                  <Line yAxisId="orders" type="linear" dataKey="delivered" name="Delivered Orders" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3, fill: "#f59e0b" }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Ad Spend by Product</h2>
            {donut.length === 0 ? <p className="m-0 py-16 text-center text-[13px] text-gray-500">No ad spend in this period.</p> : (
              <div className="mt-2 flex flex-col items-center gap-5 sm:flex-row">
                <div className="relative h-[210px] w-[210px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="spend" nameKey="name" innerRadius={66} outerRadius={100} startAngle={90} endAngle={-270} stroke="none" paddingAngle={1}>
                        {donut.map((row, index) => <Cell key={row.id} fill={donutColor(row.id, index)} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <strong className="text-[19px] font-black text-gray-900 dark:text-slate-50">{naira(k.spend)}</strong>
                    <span className="text-[12px] text-gray-500">Total Spend</span>
                  </div>
                </div>
                <div className="w-full min-w-0 flex-1 space-y-3">
                  {donut.map((row, index) => (
                    <button key={row.id} type="button" onClick={() => (row.id === UNMAPPED ? setUnmappedOpen(true) : row.id !== "others" ? (setProductId(row.id), setView("campaign")) : undefined)}
                      className="!min-h-0 grid w-full grid-cols-[minmax(0,1fr)_56px_96px] items-center gap-2 text-left text-[13px] hover:opacity-80">
                      <span className="flex min-w-0 items-center gap-2.5"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: donutColor(row.id, index) }} /><span className="truncate text-gray-700 dark:text-slate-300">{row.name}</span></span>
                      <span className="text-right text-gray-500">{Number(row.share.toFixed(1))}%</span>
                      <strong className="text-right text-gray-900 dark:text-slate-100">{naira(row.spend)}</strong>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {data.unmapped.spend > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
          <span className="flex items-center gap-2.5 text-[13.5px] text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
            <span><strong>{naira(data.unmapped.spend)} Unmapped Spend.</strong> {plural(data.unmapped.campaigns, "campaign")} {data.unmapped.campaigns === 1 ? "needs" : "need"} a product. Protohub won't guess.</span>
          </span>
          <button type="button" onClick={() => setUnmappedOpen(true)} className={smallButton}>Assign products</button>
        </div>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchBox value={search} onChange={setSearch} placeholder="Search products, campaigns or ad accounts…" className="min-w-[200px] flex-1 xl:max-w-[290px]" />
          <Popover align="left" width="w-72" button={(toggle) => <button type="button" onClick={toggle} className={filterButton}>Date: {dateLabel}<ChevronDown className="h-4 w-4 text-gray-500" /></button>}>
            {(close) => (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESETS.map((item) => (
                    <button key={item.key} type="button" onClick={() => { onRange(item.range()); close(); }}
                      className={`!min-h-0 rounded-lg px-3 py-2 text-[13px] font-semibold ${presetLabel(range) === item.label ? "bg-blue-600 text-white" : "bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-200"}`}>{item.label}</button>
                  ))}
                </div>
                <label className="mt-3 block text-[12px]"><span className={labelCls}><CalendarDays className="mr-1 inline h-3.5 w-3.5" />One day</span>
                  <input type="date" value={range.to} max={lagosToday()} onChange={(event) => { onRange({ from: event.target.value, to: event.target.value }); close(); }} className="mt-1 h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
                </label>
              </>
            )}
          </Popover>
          <select value={business} onChange={(event) => { setBusiness(event.target.value); setAccountId(""); }} className={`${selectCls} w-[195px]`}>
            <option value="">All Business Accounts</option>
            {data.filters.businesses.map((row) => <option key={row.key} value={row.key}>{row.name}</option>)}
          </select>
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} className={`${selectCls} w-[170px]`}>
            <option value="">All Ad Accounts</option>
            {data.filters.accounts.filter((row) => !business || row.businessKey === business).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <select value={productId} onChange={(event) => setProductId(event.target.value)} className={`${selectCls} w-[140px]`}>
            <option value="">All Products</option>
            <option value={UNMAPPED}>Not assigned to a product</option>
            {productOptions.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-2.5">
            <Popover width="w-64" button={(toggle) => <button type="button" onClick={toggle} className={filterButton}><Filter className="h-4 w-4" />More Filters{assigned !== "all" ? <span className="h-2 w-2 rounded-full bg-blue-600" /> : null}</button>}>
              {() => (
                <div className="space-y-1.5 text-[13px]">
                  <span className={labelCls}>Product</span>
                  {([["all", "All spend"], ["assigned", "Has a product"], ["unassigned", "Not assigned to a product"]] as const).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2"><input type="radio" checked={assigned === key} onChange={() => setAssigned(key)} className="accent-blue-600" />{label}</label>
                  ))}
                </div>
              )}
            </Popover>
            <button type="button" onClick={exportCsv} className={filterButton}><Download className="h-4 w-4" />Export</button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-b border-gray-200 dark:border-slate-800">
          <div className="-mb-px flex min-w-0 overflow-x-auto">
            {VIEWS.map((item) => (
              <button key={item.key} type="button" onClick={() => setView(item.key)}
                className={`!min-h-0 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-semibold ${view === item.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-300"}`}>{item.label}</button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3 pb-2">
            <span className="flex items-center gap-2 text-[13px] text-gray-700 dark:text-slate-300">Show Charts <Toggle checked={showCharts} onChange={setShowCharts} /></span>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-slate-700">
              {(["day", "week", "month"] as const).map((kind) => (
                <button key={kind} type="button" onClick={() => dayWeekMonth(kind)} className={`!min-h-0 rounded-md px-3.5 py-1.5 text-[13px] font-semibold capitalize ${periodKind === kind ? "border border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/40" : "text-gray-600 dark:text-slate-300"}`}>{kind}</button>
              ))}
            </div>
            <Popover width="w-56" button={(toggle) => <button type="button" onClick={toggle} className={`${filterButton} !h-9`}><Columns3 className="h-4 w-4" />Columns<ChevronDown className="h-4 w-4 text-gray-500" /></button>}>
              {() => (
                <div className="space-y-1.5 text-[13px]">
                  {COLUMNS.map((column) => <label key={column.key} className="flex items-center gap-2"><input type="checkbox" checked={on(column.key)} onChange={() => toggleColumn(column.key)} className="accent-blue-600" />{column.label}</label>)}
                </div>
              )}
            </Popover>
          </div>
        </div>

        {productId || campaign || adset || accountId || business ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="text-gray-500">Showing only:</span>
            {business ? <Chip onClear={() => setBusiness("")}>{data.filters.businesses.find((row) => row.key === business)?.name ?? "Business"}</Chip> : null}
            {accountId ? <Chip onClear={() => setAccountId("")}>{data.filters.accounts.find((row) => row.id === accountId)?.name ?? `act_${accountId}`}</Chip> : null}
            {productId ? <Chip onClear={() => setProductId("")}>{productId === UNMAPPED ? "Not assigned" : productOptions.find((row) => row.id === productId)?.name ?? "Product"}</Chip> : null}
            {campaign ? <Chip onClear={() => { setCampaign(null); setAdset(null); }}>{campaign.name}</Chip> : null}
            {adset ? <Chip onClear={() => setAdset(null)}>{adset.name}</Chip> : null}
            {view !== "product" && !(productId === UNMAPPED) ? <span className="text-gray-400">· orders here are the ones carrying these Meta IDs</span> : null}
          </div>
        ) : null}

        <div className="mt-2 overflow-x-auto">
          <table className={tableCls}>
            <thead className="text-gray-600 dark:text-slate-400">
              <tr>
                <th className="w-8"><CheckBox checked={shown.length > 0 && shown.every((row) => selected.has(row.id))} onChange={(checked) => { const next = new Set(selected); for (const row of shown) { if (checked) next.add(row.id); else next.delete(row.id); } setSelected(next); }} /></th>
                <th>{viewInfo.noun}</th>
                {th("spend", "Ad Spend")}
                {COLUMNS.filter((column) => on(column.key)).map((column) => (column.key === "trend" ? <th key={column.key} title={column.title}>{column.label}</th> : th(column.key, column.label, column.title)))}
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? <EmptyRow colSpan={colSpan} text={data.lastSync ? `No ${viewInfo.plural} with ad spend or orders in this period.` : "No spend loaded yet. Press Sync Now to read Meta's spend."} /> : shown.map((row) => {
                const unmapped = row.id === UNMAPPED;
                const waiting = row.delivered === 0;
                return (
                  <tr key={row.id} onClick={() => drill(row)} className={`${rowCls} ${view !== "ad" ? "cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40" : ""} ${unmapped ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>
                    <td onClick={(event) => event.stopPropagation()}><CheckBox checked={selected.has(row.id)} onChange={(checked) => { const next = new Set(selected); if (checked) next.add(row.id); else next.delete(row.id); setSelected(next); }} /></td>
                    <td className="min-w-[200px] max-w-[300px]">
                      <span className="flex items-center gap-2.5">
                        {view === "product" ? (unmapped ? <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600"><AlertTriangle className="h-5 w-5" /></span> : <ProductThumb src={row.image} size={40} />) : null}
                        <span className="min-w-0">
                          <span className={`block truncate text-[13px] font-semibold ${unmapped ? "text-amber-800 dark:text-amber-300" : "text-gray-900 dark:text-slate-100"}`}>{row.name}</span>
                          <span className="block truncate text-[11.5px] text-gray-500">{subLine(row)}</span>
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <strong className="block text-[13px] text-gray-900 dark:text-slate-100">{naira(row.spend)}</strong>
                      {compare === "previous" ? <Delta value={row.spendChange === null ? null : Math.round(row.spendChange)} /> : null}
                    </td>
                    {on("orders") ? <td>{unmapped ? "—" : nf(row.orders)}</td> : null}
                    {on("delivered") ? <td>{unmapped ? "—" : nf(row.delivered)}</td> : null}
                    {on("cpa") ? <td className="whitespace-nowrap">{money(row.cpa)}</td> : null}
                    {on("cpdo") ? <td className="whitespace-nowrap">{money(row.cpdo)}</td> : null}
                    {on("deliveredAov") ? <td className="whitespace-nowrap">{money(row.deliveredAov)}</td> : null}
                    {on("roas") ? <td className={`whitespace-nowrap font-semibold ${roasOf(row) === null ? "text-gray-400" : "text-emerald-600"}`}>{roasText(roasOf(row))}</td> : null}
                    {on("profit") ? (
                      <td className={`whitespace-nowrap font-semibold ${unmapped || waiting ? "text-gray-400" : row.profit >= 0 ? "text-emerald-600" : "text-rose-600"}`} title={waiting && !unmapped ? "No delivered orders yet" : undefined}>
                        {unmapped || waiting ? "—" : `${row.profit < 0 ? "−" : ""}${naira(Math.abs(row.profit))}`}
                      </td>
                    ) : null}
                    {on("trend") ? <td><Sparkline points={row.trend} width={64} height={24} color={trendColor(row)} /></td> : null}
                    <td className="text-center" onClick={(event) => event.stopPropagation()}><ActionMenu items={actions(row)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-1 pt-4">
          <span className="text-[13px] text-gray-500">Showing {rows.length ? (page - 1) * pageSize + 1 : 0} – {Math.min(rows.length, page * pageSize)} of {rows.length} {viewInfo.plural}{data.final ? " · final figures" : range.to === lagosToday() ? " · today's spend is still coming in" : ""}</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous" disabled={page <= 1} onClick={() => setPage(page - 1)} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 disabled:opacity-40 dark:border-slate-700"><ChevronLeft className="h-4 w-4" /></button>
            {Array.from({ length: pages }, (_, index) => index + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1).map((n) => (
              <button key={n} type="button" onClick={() => setPage(n)} className={`!min-h-0 inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-[13px] font-semibold ${n === page ? "border-blue-500 text-blue-600" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{n}</button>
            ))}
            <button type="button" aria-label="Next" disabled={page >= pages} onClick={() => setPage(page + 1)} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 disabled:opacity-40 dark:border-slate-700"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </Card>

      {mapping ? (
        <MappingModal target={mapping} products={productOptions} current={mappingAt(mapping.level, mapping.metaId)?.splits ?? null} onToast={onToast}
          onClose={() => setMapping(null)} onSaved={() => { setMapping(null); reload(); }} />
      ) : null}
      {unmappedOpen ? (
        <UnmappedModal range={range} products={productOptions} onToast={onToast} onClose={() => setUnmappedOpen(false)}
          onSaved={() => { setUnmappedOpen(false); reload(); }} onSplit={(target) => { setUnmappedOpen(false); setMapping(target); }} />
      ) : null}
    </div>
  );
}

function Chip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2.5 pr-1 font-semibold text-blue-700 dark:bg-blue-950/40">
      {children}
      <button type="button" aria-label="Clear" onClick={onClear} className="!min-h-0 rounded-full p-0.5 hover:bg-blue-100"><X className="h-3 w-3" /></button>
    </span>
  );
}
