import { Fragment, useEffect, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronRight, Lightbulb, Target } from "lucide-react";
import { trackingHubApi, type HubSinceStart, type HubSinceStartRow, type HubVerdict2 } from "../../lib/api";
import { Card, LoadState, Modal, PlatformIcon, SearchBox, ago, longDay, naira, nf, outlineButton, primaryButton, rowCls, selectCls, smallButton, tableCls, useLoad, type Toast } from "./HubParts";

// Ad Spend -> Since Start (Bright, 8 Oct 2026): every campaign judged over
// its WHOLE life by fixed rules (backend lib/ad-since-start.ts), so the
// question "which ones win, which need time, which to turn off now" is
// answered by the numbers, not by feel. The date filter does not apply here.

const VERDICTS: Array<{ key: HubVerdict2; label: string; tone: string; dot: string }> = [
  { key: "turn_off", label: "Turn off", tone: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30", dot: "bg-rose-500" },
  { key: "check_tracking", label: "Check tracking", tone: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30", dot: "bg-orange-500" },
  { key: "winning", label: "Winning, scale it", tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30", dot: "bg-emerald-500" },
  { key: "keep", label: "Keep running", tone: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30", dot: "bg-blue-500" },
  { key: "learning", label: "Needs more time", tone: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800", dot: "bg-gray-400" },
  { key: "no_target", label: "No target yet", tone: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30", dot: "bg-violet-500" }
];
const verdictOf = (key: HubVerdict2) => VERDICTS.find((row) => row.key === key)!;
const DAY_BANDS = [
  { key: "", label: "Any length", test: () => true },
  { key: "1-3", label: "1–3 days", test: (d: number) => d <= 3 },
  { key: "4-7", label: "4–7 days", test: (d: number) => d >= 4 && d <= 7 },
  { key: "8-14", label: "8–14 days", test: (d: number) => d >= 8 && d <= 14 },
  { key: "15-30", label: "15–30 days", test: (d: number) => d >= 15 && d <= 30 },
  { key: "31+", label: "31+ days", test: (d: number) => d >= 31 }
];
const rate = (value: number | null) => (value === null ? "—" : `${Number(value.toFixed(1))}%`);
const money = (value: number | null) => (value === null ? "—" : naira(value));
type SortKey = "verdict" | "start" | "days" | "spend" | "orders" | "cpa" | "hookRate";

function TargetsModal({ data, onClose, onSaved, onToast }: { data: HubSinceStart; onClose: () => void; onSaved: () => void; onToast: Toast }) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      for (const [productId, value] of Object.entries(edits)) {
        const amount = value.trim() === "" ? null : Number(value.replace(/[^\d.]/g, ""));
        if (amount !== null && !(amount > 0)) throw new Error("Type a cost per order above ₦0, or leave it empty.");
        await trackingHubApi.setAdSpendTarget(productId, amount);
      }
      onToast("Targets saved. Verdicts use them now.");
      onSaved();
    } catch (err: any) { onToast(`Couldn't save the targets: ${err?.message ?? "try again."}`); } finally { setBusy(false); }
  };
  return (
    <Modal wide title="Target cost per order" subtitle="Above this, an order loses money on ads. Worked out per product; type your own to replace it." onClose={onClose}>
      <p className="m-0 mb-3 text-[12.5px] text-gray-600 dark:text-slate-300">Worked out = what a delivered order leaves after product cost and delivery fee × the share of orders that get delivered, from orders placed 7–37 days ago (at least {data.rules.breakEvenMinOrders}).</p>
      <div className="overflow-x-auto">
        <table className={tableCls}>
          <thead className="text-gray-600"><tr><th>Product</th><th>Left per delivered order</th><th>Delivered</th><th>Worked out</th><th>Your target</th></tr></thead>
          <tbody>
            {data.targets.map((row) => (
              <tr key={row.productId} className={rowCls}>
                <td className="font-semibold">{row.name}</td>
                <td>{money(row.margin)}</td>
                <td>{row.deliveryRate === null ? "—" : `${Math.round(row.deliveryRate * 100)}% of ${nf(row.basedOn)}`}</td>
                <td className="font-semibold">{row.breakEven === null ? <span className="text-gray-400">Not enough orders</span> : naira(row.breakEven)}</td>
                <td>
                  <input inputMode="numeric" value={edits[row.productId] ?? (row.own === null ? "" : String(row.own))} onChange={(event) => setEdits({ ...edits, [row.productId]: event.target.value })} placeholder="Use worked out"
                    className="h-9 w-36 rounded-lg border border-gray-200 bg-white px-2.5 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
                  {row.ownBy && edits[row.productId] === undefined ? <span className="ml-2 text-[11px] text-gray-400">by {row.ownBy}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={outlineButton}>Cancel</button>
        <button type="button" disabled={busy || Object.keys(edits).length === 0} onClick={save} className={primaryButton}>{busy ? "Saving…" : "Save targets"}</button>
      </div>
    </Modal>
  );
}

export default function SinceStartView({ platform, refreshKey, onToast }: { platform: string; refreshKey: string; onToast: Toast }) {
  // refreshKey changes after Sync Now; it also reloads every 10 minutes while open (the auto sync runs every 30).
  const { data, error, reload } = useLoad(() => trackingHubApi.sinceStart(platform), [platform, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 10 * 60_000);
    return () => clearInterval(timer);
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps
  const [verdict, setVerdict] = useState<HubVerdict2 | "">("");
  const [band, setBand] = useState("");
  const [startFrom, setStartFrom] = useState("");
  const [startTo, setStartTo] = useState("");
  const [status, setStatus] = useState<"" | "running" | "off">("running");
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "verdict", dir: 1 });
  const [targetsOpen, setTargetsOpen] = useState(false);
  if (!data) return <LoadState text="Judging every campaign since it started…" error={error} onRetry={reload} />;

  const bandTest = DAY_BANDS.find((row) => row.key === band)!.test;
  const base = data.rows.filter((row) =>
    (status === "" || (status === "running" ? row.running : !row.running))
    && bandTest(row.days)
    && (!startFrom || (row.start ?? "") >= startFrom) && (!startTo || (row.start ?? "") <= startTo)
    && (!productId || row.productId === productId)
    && (!search.trim() || `${row.campaignName} ${row.productName ?? ""} ${row.accountName}`.toLowerCase().includes(search.trim().toLowerCase())));
  const counts = new Map<HubVerdict2, number>();
  for (const row of base) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  const order = VERDICTS.map((row) => row.key);
  const value = (row: HubSinceStartRow): number => sort.key === "verdict" ? order.indexOf(row.verdict) : sort.key === "start" ? Date.parse(row.start ?? "1970-01-01") : (row as any)[sort.key] ?? -1;
  const rows = base.filter((row) => !verdict || row.verdict === verdict).sort((a, b) => (value(a) - value(b)) * sort.dir || b.spend - a.spend);
  const productOptions = Array.from(new Map(data.rows.filter((row) => row.productId).map((row) => [row.productId!, row.productName ?? ""])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const th = (key: SortKey, label: string, title?: string) => (
    <th key={key} title={title} className="cursor-pointer select-none whitespace-nowrap" onClick={() => setSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "verdict" || key === "cpa" ? 1 : -1 })}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className={`h-3 w-3 ${sort.key === key ? "text-gray-700" : "text-gray-300"}`} /></span>
    </th>
  );
  const toggle = (id: string) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next); };
  const hookTone = (value: number | null) => (value === null ? "text-gray-400" : value < data.rules.hookWeak ? "text-rose-600 font-semibold" : value >= data.rules.hookStrong ? "text-emerald-600 font-semibold" : "");

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {VERDICTS.map((item) => (
          <button key={item.key} type="button" onClick={() => setVerdict(verdict === item.key ? "" : item.key)}
            className={`!min-h-0 rounded-xl border px-3 py-2.5 text-left ${item.tone} ${verdict === item.key ? "ring-2 ring-blue-500" : ""}`}>
            <span className="flex items-center gap-1.5 text-[12px] font-semibold"><span className={`h-2 w-2 rounded-full ${item.dot}`} />{item.label}</span>
            <strong className="mt-0.5 block text-[22px] font-black leading-tight">{nf(counts.get(item.key) ?? 0)}</strong>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchBox value={search} onChange={setSearch} placeholder="Search campaigns…" className="min-w-[180px] flex-1 xl:max-w-[240px]" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-gray-600 dark:text-slate-300">Started
          <input type="date" value={startFrom} onChange={(event) => setStartFrom(event.target.value)} className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
          to <input type="date" value={startTo} onChange={(event) => setStartTo(event.target.value)} className="h-10 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <select value={band} onChange={(event) => setBand(event.target.value)} className={`${selectCls} w-[140px]`}>{DAY_BANDS.map((row) => <option key={row.key} value={row.key}>{row.key ? `Running ${row.label}` : "Any length"}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className={`${selectCls} w-[150px]`}><option value="running">Running now</option><option value="off">Switched off</option><option value="">Running or off</option></select>
        <select value={productId} onChange={(event) => setProductId(event.target.value)} className={`${selectCls} w-[160px]`}><option value="">All Products</option>{productOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button type="button" onClick={() => setTargetsOpen(true)} className={`${smallButton} ml-auto !h-10`}><Target className="h-4 w-4" /> Targets</button>
      </div>

      <p className="m-0 text-[12px] text-gray-500">
        Each campaign is judged over its whole life, not the date filter: needs {data.rules.minDays} days and 2× its target spent before a verdict; winning at {Math.round(data.rules.winningBelow * 100)}% of break-even or less; hook rate under {data.rules.hookWeak}% is weak.
        {data.linkedShare !== null && data.linkedShare < 0.97 ? ` ${Math.round(data.linkedShare * 100)}% of Meta orders carry their campaign, so cost per order here runs about ${Math.round((1 / data.linkedShare - 1) * 100)}% high.` : ""}
        {data.lastLifetimeAt ? ` Numbers read ${ago(data.lastLifetimeAt)}.` : " Not read from Meta yet: press Sync Now."}
      </p>

      <Card className="overflow-x-auto">
        <table className={`${tableCls} [&_td]:!px-1.5 [&_th]:!px-1.5`}>
          <thead className="text-gray-600 dark:text-slate-400">
            <tr>
              <th className="w-6" />
              <th>Campaign</th>
              {th("start", "Started")}{th("days", "Days")}{th("spend", "Spend")}{th("orders", "Orders")}{th("cpa", "CPA", "Spend ÷ orders since it started")}
              <th title="Break-even cost per order (or your own target)">Target</th>
              <th title="Spend ÷ delivered orders">CPDO</th>
              {th("hookRate", "Hook", "3-second plays ÷ views (TikTok: 2-second)")}
              <th title="Full plays ÷ 3-second plays">Hold</th>
              <th title="Link clicks ÷ views">CTR</th>
              <th title="Purchases the ad platform itself reports">Platform buys</th>
              {th("verdict", "Verdict")}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={14} className="py-10 text-center text-[13px] text-gray-500">{data.rows.length ? "No campaign matches these filters." : "Nothing read yet. Press Sync Now to read every campaign since it started."}</td></tr> : rows.map((row) => {
              const v = verdictOf(row.verdict);
              const expanded = open.has(row.campaignId);
              return (
                <Fragment key={row.campaignId}>
                  <tr onClick={() => toggle(row.campaignId)} className={`${rowCls} cursor-pointer align-top hover:bg-gray-50 dark:hover:bg-slate-800/40`}>
                    <td className="pt-3 text-gray-400">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    <td className="min-w-[170px] max-w-[220px]">
                      <span className="flex items-start gap-2">
                        <PlatformIcon platform={row.platform} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{row.campaignName || row.campaignId}</span>
                          <span className="block truncate text-[11.5px] text-gray-500">{row.accountName} • {row.productName ?? "No product"}{row.products > 1 ? ` +${row.products - 1}` : ""}{row.running ? "" : " • off"}</span>
                        </span>
                      </span>
                    </td>
                    <td className="whitespace-nowrap">{row.start ? longDay(row.start) : "—"}</td>
                    <td className="font-semibold">{row.days || "—"}</td>
                    <td className="whitespace-nowrap font-semibold">{naira(row.spend)}</td>
                    <td>{nf(row.orders)}{row.ordersCountedFrom ? <span className="block text-[10.5px] text-gray-400">from {longDay(row.ordersCountedFrom)}</span> : null}</td>
                    <td className="whitespace-nowrap font-semibold">{money(row.cpa)}</td>
                    <td className="whitespace-nowrap text-gray-600">{money(row.target)}{row.targetSource === "set_by_you" ? <span className="block text-[10.5px] text-gray-400">yours</span> : null}</td>
                    <td className="whitespace-nowrap">{money(row.cpdo)}</td>
                    <td className={hookTone(row.hookRate)}>{rate(row.hookRate)}</td>
                    <td>{rate(row.holdRate)}</td>
                    <td>{rate(row.ctr)}</td>
                    <td>{nf(row.platformPurchases)}</td>
                    <td className="min-w-[190px] max-w-[230px]">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${v.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />{v.label}</span>
                      <span className="mt-1 block whitespace-normal text-[11.5px] leading-snug text-gray-600 dark:text-slate-300">{row.reason}</span>
                      {row.advice.map((line) => <span key={line} className="mt-1 flex items-start gap-1 whitespace-normal text-[11.5px] leading-snug text-amber-700 dark:text-amber-400"><Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />{line}</span>)}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="bg-gray-50/70 dark:bg-slate-800/30">
                      <td />
                      <td colSpan={13} className="pb-3">
                        <table className={`${tableCls} !text-[12px]`}>
                          <thead className="text-gray-500"><tr><th>Ad</th><th>Spend</th><th>Orders</th><th>CPA</th><th>Hook</th><th>Hold</th><th>CTR</th><th>Platform buys</th></tr></thead>
                          <tbody>
                            {row.ads.map((ad) => (
                              <tr key={ad.adId} className="border-t border-gray-200/70 dark:border-slate-700">
                                <td className="max-w-[260px]"><span className="block truncate font-semibold">{ad.adName || ad.adId}</span><span className="block truncate text-[11px] text-gray-500">{ad.adsetName}</span></td>
                                <td>{naira(ad.spend)}</td><td>{nf(ad.orders)}</td><td>{money(ad.cpa)}</td>
                                <td className={hookTone(ad.hookRate)}>{rate(ad.hookRate)}</td><td>{rate(ad.holdRate)}</td><td>{rate(ad.ctr)}</td><td>{nf(ad.platformPurchases)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
      <p className="m-0 px-1 text-[12.5px] text-gray-500">Showing {rows.length} of {base.length} campaign{base.length === 1 ? "" : "s"}.</p>
      {targetsOpen ? <TargetsModal data={data} onToast={onToast} onClose={() => setTargetsOpen(false)} onSaved={() => { setTargetsOpen(false); reload(); }} /> : null}
    </div>
  );
}
