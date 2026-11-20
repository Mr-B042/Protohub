import { Fragment, useEffect, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronRight, Flame } from "lucide-react";
import { trackingHubApi, type HubStreakRow, type HubStreakVerdict } from "../../lib/api";
import { LoadState, PlatformIcon, SearchBox, ago, naira, nf, rowCls, selectCls, shortDay, tableCls, useLoad } from "./HubParts";

// Ad Spend -> Order Streaks (Bright, 20 Nov 2026: "ads that are consistently
// getting orders ... will give us an edge to scale it"). Every ad that ran in
// the last 7 days: how steadily it gets orders, and whether it is cheap enough
// to scale. Rules: backend lib/ad-streaks.ts.

const VERDICTS: Array<{ key: HubStreakVerdict; label: string; tone: string; dot: string }> = [
  { key: "scale", label: "Scale it", tone: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30", dot: "bg-emerald-500" },
  { key: "steady_ok", label: "Steady, near break-even", tone: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30", dot: "bg-blue-500" },
  { key: "steady_no_target", label: "Steady, no break-even", tone: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30", dot: "bg-violet-500" },
  { key: "steady_costly", label: "Steady, but costly", tone: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30", dot: "bg-rose-500" },
  { key: "building", label: "Building", tone: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30", dot: "bg-amber-500" },
  { key: "patchy", label: "Patchy", tone: "bg-gray-100 text-gray-700 border-gray-200 dark:bg-slate-800", dot: "bg-gray-400" }
];
const verdictOf = (key: HubStreakVerdict) => VERDICTS.find((row) => row.key === key)!;
type SortKey = "verdict" | "run" | "share14" | "share7" | "orders14" | "cost";

/** 14 squares, oldest left: green = an order that day, grey = ran with no order, blank = off. */
function Strip({ days }: { days: HubStreakRow["days"] }) {
  return (
    <span className="inline-flex gap-[3px]" aria-label="Last 14 days">
      {days.map((cell) => {
        const tone = cell.orders > 0
          ? cell.orders >= 3 ? "bg-emerald-600" : "bg-emerald-400"
          : cell.spend > 0 ? "bg-gray-300 dark:bg-slate-600" : "border border-dashed border-gray-300 bg-transparent dark:border-slate-600";
        const words = cell.orders > 0 ? `${cell.orders} order${cell.orders === 1 ? "" : "s"}` : cell.spend > 0 ? "ran, no order" : "off";
        return <span key={cell.day} title={`${shortDay(cell.day)}: ${words}${cell.spend > 0 ? ` · ${naira(cell.spend)} spent` : ""}`} className={`h-4 w-3 rounded-[3px] ${tone}`} />;
      })}
    </span>
  );
}

function Share({ part, whole }: { part: number; whole: number }) {
  if (whole === 0) return <span className="text-gray-400">—</span>;
  const pct = Math.round((part / whole) * 100);
  return (
    <span className="whitespace-nowrap">
      <b className={pct >= 70 ? "text-emerald-700 dark:text-emerald-300" : pct >= 50 ? "text-amber-700 dark:text-amber-300" : "text-gray-600 dark:text-slate-300"}>{part} of {whole}</b>
      <span className="ml-1 text-[11px] text-gray-500">{pct}%</span>
    </span>
  );
}

function CostCell({ row }: { row: HubStreakRow }) {
  if (row.costPerOrder14 === null) return <span className="text-gray-400">No order</span>;
  if (row.target === null) return <span>{naira(row.costPerOrder14)}<span className="block text-[11px] text-gray-400">break-even not known</span></span>;
  const ratio = row.costPerOrder14 / row.target;
  const tone = ratio <= 0.7 ? "bg-emerald-500" : ratio <= 1 ? "bg-amber-500" : "bg-rose-500";
  return (
    <span className="block min-w-[120px]">
      <b>{naira(row.costPerOrder14)}</b><span className="ml-1 text-[11px] text-gray-500">of {naira(row.target)}</span>
      <span className="mt-1 block h-1.5 w-full rounded-full bg-gray-100 dark:bg-slate-800"><span className={`block h-1.5 rounded-full ${tone}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></span>
    </span>
  );
}

export default function OrderStreaksView({ platform, refreshKey }: { platform: string; refreshKey: string }) {
  const { data, error, reload } = useLoad(() => trackingHubApi.orderStreaks(platform), [platform, refreshKey]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 10 * 60_000);
    return () => clearInterval(timer);
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps
  const [verdict, setVerdict] = useState<HubStreakVerdict | "">("");
  const [productId, setProductId] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "verdict", dir: 1 });
  if (!data) return <LoadState text="Checking which ads get orders day after day…" error={error} onRetry={reload} />;

  const base = data.rows.filter((row) => (!productId || row.productId === productId)
    && (!search.trim() || `${row.adName} ${row.adsetName} ${row.campaignName} ${row.accountName} ${row.productName ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const counts = new Map<HubStreakVerdict, number>();
  for (const row of base) counts.set(row.verdict, (counts.get(row.verdict) ?? 0) + 1);
  const order = VERDICTS.map((row) => row.key);
  const value = (row: HubStreakRow): number => sort.key === "verdict" ? order.indexOf(row.verdict)
    : sort.key === "cost" ? row.costPerOrder14 ?? Number.MAX_SAFE_INTEGER : sort.key === "share14" ? row.share14 ?? -1 : sort.key === "share7" ? row.share7 ?? -1 : row[sort.key];
  const rows = base.filter((row) => !verdict || row.verdict === verdict)
    .sort((a, b) => (value(a) - value(b)) * sort.dir || (b.share14 ?? 0) - (a.share14 ?? 0) || b.orders14 - a.orders14);
  const productOptions = Array.from(new Map(data.rows.filter((row) => row.productId).map((row) => [row.productId!, row.productName ?? ""])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const th = (key: SortKey, label: string, title?: string) => (
    <th key={key} title={title} className="cursor-pointer select-none whitespace-nowrap" onClick={() => setSort(sort.key === key ? { key, dir: sort.dir === 1 ? -1 : 1 } : { key, dir: key === "verdict" || key === "cost" ? 1 : -1 })}>
      <span className="inline-flex items-center gap-1">{label}<ArrowUpDown className={`h-3 w-3 ${sort.key === key ? "text-gray-700" : "text-gray-300"}`} /></span>
    </th>
  );
  const toggle = (id: string) => { const next = new Set(open); if (next.has(id)) next.delete(id); else next.add(id); setOpen(next); };
  const r = data.rules;

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
        <SearchBox value={search} onChange={setSearch} placeholder="Search ads, ad sets, campaigns…" className="min-w-[200px] flex-1 xl:max-w-[280px]" />
        <select value={productId} onChange={(event) => setProductId(event.target.value)} className={`${selectCls} w-[170px]`}><option value="">All Products</option>{productOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <span className="ml-auto flex flex-wrap items-center gap-3 text-[11.5px] text-gray-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[2px] bg-emerald-400" />order</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[2px] bg-gray-300 dark:bg-slate-600" />ran, no order</span>
          <span className="inline-flex items-center gap-1"><span className="h-3 w-2.5 rounded-[2px] border border-dashed border-gray-300" />off</span>
          {data.lastSyncAt ? <span>Spend read {ago(data.lastSyncAt)}</span> : null}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className={tableCls}>
          <thead className="bg-gray-50 text-gray-600 dark:bg-slate-800/60 dark:text-slate-300">
            <tr>
              <th className="w-6" />
              <th>Ad</th>
              <th className="whitespace-nowrap">Last 14 days</th>
              {th("run", "Run", "Days in a row with an order, back from yesterday. Days the ad was off are skipped.")}
              {th("share14", "14 days", "Days with an order ÷ days the ad ran")}
              {th("share7", "7 days", "Days with an order ÷ days the ad ran, this past week")}
              {th("orders14", "Orders")}
              {th("cost", "Cost / order", "14-day spend ÷ orders, against the product's break-even")}
              <th className="whitespace-nowrap">Today</th>
              {th("verdict", "Verdict")}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="py-10 text-center text-gray-500">{data.rows.length ? "No ad matches these filters." : "No ad ran in the last 7 days."}</td></tr>
            ) : rows.map((row) => {
              const v = verdictOf(row.verdict);
              const isOpen = open.has(row.adId);
              return (
                <Fragment key={row.adId}>
                  <tr className={`${rowCls} cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/40`} onClick={() => toggle(row.adId)}>
                    <td>{isOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}</td>
                    <td className="min-w-[230px] max-w-[320px]">
                      <span className="flex items-center gap-2">
                        <PlatformIcon platform={row.platform} size="sm" />
                        <span className="min-w-0">
                          {/* Campaign first: most ads are named alike ("New Sales ad"). */}
                          <b className="block truncate" title={row.campaignName}>{row.campaignName}</b>
                          <span className="block truncate text-[11.5px] text-gray-500" title={`${row.adsetName} › ${row.adName}`}>{row.adsetName} › {row.adName}</span>
                          <span className="block truncate text-[11px] text-gray-400">{row.accountName}{row.productName ? ` · ${row.productName}` : " · product not known"}</span>
                        </span>
                      </span>
                    </td>
                    <td><Strip days={row.days} /></td>
                    <td className="whitespace-nowrap">{row.run > 0 ? <span className="inline-flex items-center gap-1 font-bold text-orange-600"><Flame className="h-3.5 w-3.5" />{row.run} day{row.run === 1 ? "" : "s"}</span> : <span className="text-gray-400">0</span>}</td>
                    <td><Share part={row.orderDays14} whole={row.activeDays14} /></td>
                    <td><Share part={row.orderDays7} whole={row.activeDays7} /></td>
                    <td className="whitespace-nowrap"><b>{nf(row.orders14)}</b><span className="block text-[11px] text-gray-500">{nf(row.confirmed14)} confirmed</span></td>
                    <td><CostCell row={row} /></td>
                    <td className="whitespace-nowrap">{row.ordersToday > 0 ? <b className="text-emerald-700">{row.ordersToday} so far</b> : <span className="text-gray-400">{row.spendToday > 0 ? "none yet" : "—"}</span>}</td>
                    <td><span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${v.tone}`}><span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />{v.label}</span></td>
                  </tr>
                  {isOpen ? (
                    <tr className="border-t border-gray-100 bg-gray-50/70 dark:border-slate-800 dark:bg-slate-800/30">
                      <td />
                      <td colSpan={9} className="py-3 text-[12.5px] text-gray-700 dark:text-slate-300">
                        <p className="m-0 font-semibold">{row.reason}</p>
                        <p className="m-0 mt-1 text-gray-500">Spent {naira(row.spend14)} over the 14 days. Ad id {row.adId}.</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {row.days.map((cell) => (
                            <span key={cell.day} className="rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                              <b>{shortDay(cell.day)}</b> · {cell.spend > 0 || cell.orders > 0 ? `${cell.orders} order${cell.orders === 1 ? "" : "s"} · ${naira(cell.spend)}` : "off"}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="m-0 text-[12px] text-gray-500 dark:text-slate-400">
        Steady = an order on at least {Math.round(r.steadyShare * 100)}% of the days the ad ran, over the last {r.window} days and the last {r.recent}, after at least {r.minActiveDays} days running.
        {" "}Scale it = steady and costing at most {Math.round(r.scaleBelow * 100)}% of the product's break-even per order (the same target as Since Start).
        {" "}Days the ad was off don't count against it. Today is shown on its own until the day is over.
      </p>
    </div>
  );
}
