import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { productPerformanceApi, type MonthlyVerdict, type ProductMonthStat, type ProductMonthly } from "../../lib/api";
import { Delta, ProductThumb, nf } from "./parts";
import { RepMonthlyView } from "./TabRepMonthly";

/**
 * Product Trend › Monthly Performance (Bright, 2 Nov 2026; design approved
 * from the preview). Each product judged month by month like a campaign in
 * Ad Spend › Since Start. Rules and maths: backend lib/product-monthly.ts.
 */

const VERDICTS: Record<MonthlyVerdict, { label: string; rule: string; stripe: string; pill: string; dot: string; card: string }> = {
  scale: { label: "Scale", rule: "Making money after ads and delivery rate 65% or higher. Spend more on it.", stripe: "bg-emerald-600", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-600", card: "bg-emerald-50 dark:bg-emerald-500/10" },
  keep: { label: "Keep", rule: "Making money after ads, delivery rate 60–64%. Keep spend steady.", stripe: "bg-cyan-700", pill: "bg-cyan-50 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300", dot: "bg-cyan-700", card: "bg-cyan-50 dark:bg-cyan-500/10" },
  fix: { label: "Fix", rule: "Delivery rate under 60%, profit after ads under 10% of revenue, or one losing month.", stripe: "bg-amber-600", pill: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-600", card: "bg-amber-50 dark:bg-amber-500/10" },
  stop: { label: "Stop", rule: "Lost money after ads two months in a row. Turn its ads off.", stripe: "bg-rose-600", pill: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", dot: "bg-rose-600", card: "bg-rose-50 dark:bg-rose-500/10" },
  new: { label: "Too new", rule: "Fewer than 10 orders in the month. Not judged yet.", stripe: "bg-gray-400", pill: "bg-gray-100 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300", dot: "bg-gray-400", card: "bg-gray-100 dark:bg-slate-800" }
};
const ORDER: MonthlyVerdict[] = ["scale", "keep", "fix", "stop", "new"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longMonth = (key: string) => `${MONTH_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const shortMonth = (key: string) => MONTH_LONG[Number(key.slice(5, 7)) - 1].slice(0, 3);
const shiftMonth = (key: string, by: number) => {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};
const lastDay = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();
const rate1 = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);
const growth = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

type Product = ProductMonthly["products"][number];

export function MonthlyPerformanceTab(props: { money: (value: number) => string; imageOf: (productId: string) => string | null; onShowStates: () => void }) {
  // Products | Sales reps (Bright, 2 Nov 2026). Each view keeps its own month.
  const [view, setView] = useState<"products" | "reps">("products");
  const switcher = (
    <div className="inline-flex gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="tablist" aria-label="Monthly Performance view">
      {([["products", "Products"], ["reps", "Sales reps"]] as const).map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
          className={`!min-h-0 rounded-lg px-4 py-2 text-[13px] font-bold ${view === key ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-gray-500 hover:bg-gray-50 dark:text-slate-400 dark:hover:bg-slate-800"}`}>{label}</button>
      ))}
    </div>
  );
  if (view === "reps") return <RepMonthlyView money={props.money} switcher={switcher} startMonth={null} />;
  return <ProductMonthlyView {...props} switcher={switcher} />;
}

function ProductMonthlyView({ money, imageOf, onShowStates, switcher }: { money: (value: number) => string; imageOf: (productId: string) => string | null; onShowStates: () => void; switcher: React.ReactNode }) {
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<ProductMonthly | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<MonthlyVerdict | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    productPerformanceApi.monthly(month ?? "")
      .then((result) => { if (live) setData(result); })
      .catch((err: Error) => { if (live) setError(err.message || "Could not load the months."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [month, tick]);

  const signed = (value: number) => (value < 0 ? `−${money(Math.abs(value))}` : money(value));
  const index = data ? data.months.length - 1 : 0;
  const rows = useMemo(() => (data?.products ?? []).filter((product) => product.months[index]?.verdict), [data, index]);
  const shown = rows.filter((product) => filter === "all" || product.months[index].verdict === filter);
  const current = rows.find((product) => product.id === selected) ?? rows[0] ?? null;

  if (!data) {
    return (
      <div className="space-y-4"><div className="flex">{switcher}</div>
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-[13px] text-gray-500 shadow-sm dark:border-slate-800">
        {error ? <><p className="m-0 text-rose-700">Could not load the months: {error}</p><button type="button" onClick={() => setTick((n) => n + 1)} className="!min-h-0 mt-3 rounded-lg border border-gray-300 px-3 py-1.5 font-semibold">Try again</button></>
          : <><Loader2 className="mx-auto h-5 w-5 animate-spin" /><p className="m-0 mt-2">Working out each month…</p></>}
      </div></div>
    );
  }

  const isOpen = data.month === data.thisMonth;
  const unassigned = data.unassignedAdSpend;
  // The month before covers products that sold then too, judged or not.
  const prevTot = (() => {
    const i = index - 1;
    if (i < 0) return null;
    const all = data.products;
    const orders = all.reduce((t, p) => t + p.months[i].orders, 0), delivered = all.reduce((t, p) => t + p.months[i].delivered, 0);
    return {
      revenue: all.reduce((t, p) => t + p.months[i].revenue, 0), adSpend: all.reduce((t, p) => t + p.months[i].adSpend, 0) + (unassigned[i] ?? 0),
      profit: all.reduce((t, p) => t + p.months[i].profit, 0) - (unassigned[i] ?? 0), rate: orders ? (delivered / orders) * 100 : null, orders, delivered
    };
  })();
  const now = (() => {
    const all = data.products;
    const orders = all.reduce((t, p) => t + p.months[index].orders, 0), delivered = all.reduce((t, p) => t + p.months[index].delivered, 0);
    return {
      revenue: all.reduce((t, p) => t + p.months[index].revenue, 0), adSpend: all.reduce((t, p) => t + p.months[index].adSpend, 0) + (unassigned[index] ?? 0),
      profit: all.reduce((t, p) => t + p.months[index].profit, 0) - (unassigned[index] ?? 0), rate: orders ? (delivered / orders) * 100 : null, orders, delivered
    };
  })();
  const prevName = longMonth(shiftMonth(data.month, -1));
  const counts = Object.fromEntries(ORDER.map((key) => [key, rows.filter((product) => product.months[index].verdict === key).length])) as Record<MonthlyVerdict, number>;

  const tiles = [
    { label: "Delivered revenue", value: money(now.revenue), delta: prevTot ? growth(now.revenue, prevTot.revenue) : null, invert: false, points: false },
    { label: "Delivered orders", value: `${nf(now.delivered)} of ${nf(now.orders)}`, delta: prevTot ? growth(now.delivered, prevTot.delivered) : null, invert: false, points: false },
    { label: "Ad spend", value: money(now.adSpend), delta: prevTot ? growth(now.adSpend, prevTot.adSpend) : null, invert: true, points: false },
    { label: "Profit after ads", value: signed(now.profit), delta: prevTot && prevTot.profit > 0 ? growth(now.profit, prevTot.profit) : null, invert: false, points: false },
    { label: "Net profit", value: signed(data.net[index] ?? 0), delta: index > 0 && (data.net[index - 1] ?? 0) > 0 ? growth(data.net[index] ?? 0, data.net[index - 1]) : null, invert: false, points: false },
    { label: "Delivery rate", value: rate1(now.rate), delta: prevTot && now.rate !== null && prevTot.rate !== null ? now.rate - prevTot.rate : null, invert: false, points: true }
  ];

  return (
    <div className="space-y-4">
      {/* Month picker */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800">
        <div className="flex flex-wrap items-center gap-3">
        {switcher}
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Month before" onClick={() => { setMonth(shiftMonth(data.month, -1)); setSelected(null); }}
            className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
          <div className="min-w-[170px] text-center">
            <div className="text-[18px] font-extrabold tracking-tight">{longMonth(data.month)}</div>
            <div className="text-[12px] text-gray-500 dark:text-slate-400">{isOpen ? `So far · 1–${Number(data.today.slice(8, 10))} ${shortMonth(data.month)}` : `Closed month · 1–${lastDay(data.month)} ${shortMonth(data.month)}`}</div>
          </div>
          <button type="button" aria-label="Month after" disabled={isOpen} onClick={() => { setMonth(shiftMonth(data.month, 1)); setSelected(null); }}
            className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
          {loading && <Loader2 className="ml-1 h-4 w-4 animate-spin text-gray-400" />}
        </div>
        </div>
        <div className="text-[13px] text-gray-500 dark:text-slate-400">Compared with <b className="text-gray-900 dark:text-slate-100">{prevName}</b> · orders counted by the day they were placed</div>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">Could not load that month: {error}</div>}

      {/* Month totals */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm dark:border-slate-800">
            <div className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">{tile.label}</div>
            <div className={`mt-1 text-[24px] font-extrabold tracking-tight tabular-nums ${(tile.label === "Profit after ads" && now.profit < 0) || (tile.label === "Net profit" && (data.net[index] ?? 0) < 0) ? "text-rose-600" : "text-gray-900 dark:text-slate-50"}`}>{tile.value}</div>
            <div className="mt-1 flex items-center gap-1 text-[12px] text-gray-500 dark:text-slate-400">
              <Delta value={tile.delta} invert={tile.invert} points={tile.points} /><span>vs {prevName.split(" ")[0]}</span>
            </div>
          </div>
        ))}
      </section>
      {(unassigned[index] ?? 0) > 0 && (
        <p className="m-0 -mt-1 text-[12px] text-gray-500 dark:text-slate-400">Includes {money(unassigned[index])} of ad spend not given to a product. It counts in the totals but on no product below.</p>
      )}

      {/* Verdict chips */}
      <section className="flex flex-wrap items-center gap-2" aria-label="Filter by verdict">
        <span className="mr-1 text-[13px] font-semibold text-gray-500 dark:text-slate-400">Verdicts</span>
        <Chip on={filter === "all"} onClick={() => setFilter("all")}>All products <span className="tabular-nums">{rows.length}</span></Chip>
        {ORDER.map((key) => (
          <Chip key={key} on={filter === key} onClick={() => setFilter(key)}><span className={`h-2 w-2 rounded-full ${VERDICTS[key].dot}`} />{VERDICTS[key].label} <span className="tabular-nums">{counts[key]}</span></Chip>
        ))}
      </section>

      {/* Product check */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3.5 dark:border-slate-800">
          <h2 className="m-0 text-[16px] font-extrabold">Product check for {longMonth(data.month).split(" ")[0]}{isOpen ? " so far" : ""}</h2>
          <span className="text-[13px] text-gray-500 dark:text-slate-400">Click a product to see its month-by-month record.</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1370px]">
            <div className="grid grid-cols-[minmax(170px,1.4fr)_140px_60px_74px_104px_115px_100px_145px_120px_120px_96px] items-center gap-2.5 bg-gray-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800/60 dark:text-slate-400">
              <span>Product</span><span>Verdict</span><span>Orders</span><span>Delivered</span><span>Delivery rate</span><span>Delivered revenue</span><span>Ad spend</span><span>Ad cost per order</span><span>Profit after ads</span><span>Net profit</span><span>Last 6 months</span>
            </div>
            {shown.length === 0 && <div className="border-t border-gray-200 px-4 py-6 text-[13px] text-gray-500 dark:border-slate-800">{rows.length === 0 ? "No product sold or spent on ads this month." : "No product has this verdict this month."}</div>}
            {shown.map((product) => {
              const stat = product.months[index];
              const verdict = VERDICTS[stat.verdict!];
              const isSel = current?.id === product.id;
              const rate = stat.rate ?? 0;
              return (
                <div key={product.id} role="button" tabIndex={0} onClick={() => setSelected(product.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(product.id); } }}
                  className={`relative grid cursor-pointer grid-cols-[minmax(170px,1.4fr)_140px_60px_74px_104px_115px_100px_145px_120px_120px_96px] items-center gap-2.5 border-t border-gray-200 px-4 py-3 dark:border-slate-800 ${isSel ? "bg-blue-50/70 dark:bg-blue-500/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/50"}`}>
                  <span className={`absolute inset-y-0 left-0 w-1 ${verdict.stripe}`} />
                  <span className="flex min-w-0 items-center gap-3">
                    <ProductThumb src={imageOf(product.id)} name={product.name} />
                    <span className="min-w-0"><b className="block truncate text-[14px]" title={product.name}>{product.name}</b><small className="text-[12px] text-gray-500 dark:text-slate-400">{nf(stat.delivered)} delivered of {nf(stat.orders)}</small></span>
                  </span>
                  <span>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-extrabold ${verdict.pill}`}>{verdict.label}</span>
                    <span className="mt-1 block text-[11.5px] leading-snug text-gray-500 dark:text-slate-400">{stat.reason}</span>
                  </span>
                  <span className="text-[14px] font-extrabold tabular-nums">{nf(stat.orders)}</span>
                  <span className="text-[14px] font-extrabold tabular-nums">{nf(stat.delivered)}</span>
                  <span>
                    <b className="text-[14px] tabular-nums">{rate1(stat.rate)}</b>
                    <span className="relative mt-1.5 block h-1.5 rounded-full bg-gray-200 dark:bg-slate-700">
                      <i className={`absolute inset-y-0 left-0 rounded-full ${rate >= 65 ? "bg-emerald-600" : rate >= 60 ? "bg-cyan-700" : "bg-amber-600"}`} style={{ width: `${Math.min(rate, 100)}%` }} />
                      <u className="absolute -top-[3px] -bottom-[3px] left-[65%] w-0.5 bg-gray-700/60 dark:bg-slate-200/60" title="65% target" />
                    </span>
                  </span>
                  <span className="text-[14px] font-extrabold tabular-nums">{money(stat.revenue)}</span>
                  <span className="text-[14px] font-extrabold tabular-nums">{money(stat.adSpend)}</span>
                  <span className="tabular-nums">
                    {stat.costPerOrder === null ? <><b className="text-[14px]">—</b><small className="block text-[11.5px] text-gray-500 dark:text-slate-400">{stat.adSpend > 0 ? "No orders yet" : "No ad spend"}</small></>
                      : <><b className={`text-[14px] ${stat.breakEven !== null && stat.costPerOrder > stat.breakEven ? "text-rose-600" : ""}`}>{money(stat.costPerOrder)}</b>
                        <small className="block text-[11.5px] text-gray-500 dark:text-slate-400">{stat.breakEven !== null ? `Break-even ${money(stat.breakEven)} · ${Math.round((stat.costPerOrder / stat.breakEven) * 100)}%` : "No break-even yet"}</small></>}
                  </span>
                  <span className="tabular-nums">
                    <b className={`text-[14px] ${stat.profit < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}`}>{signed(stat.profit)}</b>
                    {stat.delivered > 0 && <small className="block text-[11.5px] text-gray-500 dark:text-slate-400">{signed(stat.profit / stat.delivered)} per delivered</small>}
                  </span>
                  <span className="tabular-nums">
                    <b className={`text-[14px] ${stat.net < 0 ? "text-rose-600" : "text-gray-900 dark:text-slate-100"}`}>{signed(stat.net)}</b>
                    <small className="block text-[11.5px] text-gray-500 dark:text-slate-400">after {money(stat.otherCosts)} other costs</small>
                  </span>
                  <span><ProfitSpark values={product.months.map((m) => m.profit)} /></span>
                </div>
              );
            })}
            {shown.length > 1 && (() => {
              const pick = (f: (stat: ProductMonthStat) => number) => shown.reduce((t, p) => t + f(p.months[index]), 0);
              const o = pick((st) => st.orders), d = pick((st) => st.delivered), ads = pick((st) => st.adSpend), profit = pick((st) => st.profit), net = pick((st) => st.net);
              return (
                <div className="grid grid-cols-[minmax(170px,1.4fr)_140px_60px_74px_104px_115px_100px_145px_120px_120px_96px] items-center gap-2.5 border-t-2 border-gray-300 bg-gray-50 px-4 py-3 text-[14px] font-extrabold tabular-nums dark:border-slate-600 dark:bg-slate-800/60">
                  <span>Total{filter !== "all" ? ` (${VERDICTS[filter].label})` : ""} · {shown.length} products</span>
                  <span />
                  <span>{nf(o)}</span>
                  <span>{nf(d)}</span>
                  <span>{rate1(o ? (d / o) * 100 : null)}</span>
                  <span>{money(pick((st) => st.revenue))}</span>
                  <span>{money(ads)}</span>
                  <span>{o && ads ? money(ads / o) : "—"}</span>
                  <span className={profit < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}>{signed(profit)}</span>
                  <span className={net < 0 ? "text-rose-600" : ""}>{signed(net)}</span>
                  <span />
                </div>
              );
            })()}
          </div>
        </div>
      </section>

      {/* Selected product */}
      {current && (
        <section className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-3.5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800">
            <div>
              <h3 className="m-0 text-[16px] font-extrabold">{current.name} · month by month</h3>
              <p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">Each month's verdict on its own. Two losing months in a row turn the verdict to Stop.</p>
            </div>
            <MonthChart product={current} />
          </div>
          <div className="space-y-3 self-start rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800">
            <div>
              <h3 className="m-0 text-[16px] font-extrabold">What to do next month</h3>
              <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-[13px] text-gray-500 dark:text-slate-400">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-extrabold ${VERDICTS[current.months[index].verdict!].pill}`}>{VERDICTS[current.months[index].verdict!].label}</span>{current.months[index].reason}
              </p>
            </div>
            <ol className="m-0 grid list-none gap-2.5 p-0">
              {advice(current, index, money, signed).map((line, i) => (
                <li key={i} className="grid grid-cols-[26px_1fr] items-start gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 text-[13px] dark:bg-slate-800/60">
                  <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg border border-gray-200 bg-white text-[12px] font-extrabold dark:border-slate-700 dark:bg-slate-900">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
            {(current.months[index].verdict === "fix") && (current.months[index].rate ?? 100) < 60 && (
              <button type="button" onClick={onShowStates} className="!min-h-0 text-[13px] font-semibold text-[#1F8FE0] hover:underline">Open State Breakdown →</button>
            )}
          </div>
        </section>
      )}

      {current && (
        <section className="space-y-2 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800">
          <h3 className="m-0 text-[15px] font-extrabold">{current.name} · each month's figures</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">
              {["Month", "Orders", "Delivered", "Rate", "Revenue", "Ad spend", "Profit after ads", "Net profit", "Verdict"].map((label, i) => <th key={label} className={`whitespace-nowrap border-b border-gray-200 px-2 py-2 font-bold dark:border-slate-800 ${i === 0 ? "text-left" : "text-right"}`}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {[...current.months].reverse().map((stat) => {
              const isCur = stat.month === data.month;
              const cell = `whitespace-nowrap border-b border-gray-200 px-2 py-2.5 text-right tabular-nums dark:border-slate-800 ${isCur ? "bg-blue-50/70 font-bold dark:bg-blue-500/10" : ""}`;
              return stat.verdict === null ? (
                <tr key={stat.month}><td className={`${cell} !text-left`}>{longMonth(stat.month)}</td><td colSpan={8} className={`${cell} !text-left text-gray-400`}>No orders or ad spend</td></tr>
              ) : (
                <tr key={stat.month}>
            <td className={`${cell} !text-left`}>{longMonth(stat.month)}{isCur && isOpen ? " (so far)" : ""}</td>
            <td className={cell}>{nf(stat.orders)}</td><td className={cell}>{nf(stat.delivered)}</td><td className={cell}>{rate1(stat.rate)}</td>
            <td className={cell}>{money(stat.revenue)}</td><td className={cell}>{money(stat.adSpend)}</td>
            <td className={`${cell} ${stat.profit < 0 ? "text-rose-600" : ""}`}>{signed(stat.profit)}</td>
            <td className={`${cell} ${stat.net < 0 ? "text-rose-600" : ""}`}>{signed(stat.net)}</td>
            <td className={cell}><span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-extrabold ${VERDICTS[stat.verdict].pill}`}>{VERDICTS[stat.verdict].label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
        </section>
      )}

      {/* Rules */}
      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800">
        <h3 className="m-0 text-[15px] font-extrabold">How the verdict is decided</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
          {ORDER.map((key) => (
            <div key={key} className={`rounded-xl p-3 ${VERDICTS[key].card}`}>
              <b className={`mb-1 block text-[13px] font-extrabold ${VERDICTS[key].pill.split(" ").filter((c) => c.includes("text-")).join(" ")}`}>{VERDICTS[key].label}</b>
              <p className="m-0 text-[12.5px] text-gray-800 dark:text-slate-200">{VERDICTS[key].rule}</p>
            </div>
          ))}
        </div>
        <p className="m-0 text-[12.5px] text-gray-500 dark:text-slate-400">
          Profit after ads = delivered revenue − product cost − delivery fees − ad spend, the same figure as Ad Spend in the Tracking Hub. Ad spend comes from Daily Ad Spend. Net profit = profit after ads − every other running cost of the month (salaries, waybill, airtime…, not Delivery), the same as Finance: costs tagged to a product stay with it, the rest is shared by each product's share of delivered revenue. The verdict uses profit after ads. Delivery rate = delivered ÷ orders placed in the month. Break-even is the campaign check's: what a delivered order leaves after product cost and delivery fee, times the share delivered (or the figure you set in Ad Spend). Orders still on the way can still be delivered, so a month that has not ended is marked "so far".
        </p>
      </section>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`!min-h-0 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-[13px] font-bold dark:bg-slate-900 ${on ? "border-gray-900 ring-1 ring-gray-900 dark:border-slate-100 dark:ring-slate-100" : "border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
      {children}
    </button>
  );
}

/** Profit after ads over the six months: area, line, emphasised last point. */
function ProfitSpark({ values }: { values: number[] }) {
  const w = 96, h = 30;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const x = (i: number) => 3 + (i * (w - 6)) / Math.max(values.length - 1, 1);
  const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const color = last < 0 ? "#e11d48" : "#1F8FE0";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Profit after ads, last 6 months" className="block">
      {min < 0 && <line x1={0} x2={w} y1={y(0)} y2={y(0)} className="stroke-gray-300 dark:stroke-slate-600" strokeDasharray="2 2" />}
      <polygon points={`${x(0)},${h} ${pts} ${x(values.length - 1)},${h}`} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3} fill={color} />
    </svg>
  );
}

/** Bars: profit after ads. Line: delivery rate against the 65% mark. */
function MonthChart({ product }: { product: Product }) {
  const W = 640, H = 190, L = 60, R = 44, T = 14, B = 26;
  const months = product.months;
  const live = months.map((stat, i) => ({ stat, i })).filter((item) => item.stat.verdict !== null);
  const profits = live.map((item) => item.stat.profit);
  const top = Math.max(...profits, 0), bot = Math.min(...profits, 0);
  const step = (W - L - R) / months.length;
  const yP = (v: number) => T + ((top - v) / ((top - bot) || 1)) * (H - T - B);
  const yR = (v: number) => T + ((100 - v) / 60) * (H - T - B);
  const cx = (i: number) => L + step * i + step / 2;
  const short = (v: number) => `${v < 0 ? "−" : ""}₦${Math.abs(v) >= 1e6 ? `${(Math.abs(v) / 1e6).toFixed(1)}m` : `${Math.round(Math.abs(v) / 1000)}k`}`;
  const ticks = Array.from(new Set([top, (top + bot) / 2, bot]));
  const ratePoints = live.filter((item) => item.stat.rate !== null);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit after ads (bars) and delivery rate (line) by month" className="block h-auto w-full">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={yP(t)} y2={yP(t)} className="stroke-gray-200 dark:stroke-slate-700" /><text x={L - 8} y={yP(t) + 4} textAnchor="end" fontSize={11} className="fill-gray-500 dark:fill-slate-400">{short(t)}</text></g>)}
        {[40, 65, 100].map((t) => <text key={t} x={W - R + 8} y={yR(t) + 4} fontSize={11} className="fill-gray-500 dark:fill-slate-400">{t}%</text>)}
        <line x1={L} x2={W - R} y1={yR(65)} y2={yR(65)} stroke="#059669" strokeDasharray="4 4" opacity={0.7} />
        {months.map((stat, i) => (
          <g key={stat.month}>
            <text x={cx(i)} y={H - 8} textAnchor="middle" fontSize={11} className="fill-gray-500 dark:fill-slate-400">{shortMonth(stat.month)}</text>
            {stat.verdict !== null && <rect x={cx(i) - 16} y={Math.min(yP(0), yP(stat.profit))} width={32} height={Math.max(Math.abs(yP(stat.profit) - yP(0)), 1)} rx={4} fill={stat.profit < 0 ? "#e11d48" : "#1F8FE0"} opacity={i === months.length - 1 ? 1 : 0.55} />}
          </g>
        ))}
        {ratePoints.length > 1 && <polyline points={ratePoints.map((item) => `${cx(item.i)},${yR(Math.max(item.stat.rate!, 40))}`).join(" ")} fill="none" stroke="#d97706" strokeWidth={2} />}
        {ratePoints.map((item) => <circle key={item.i} cx={cx(item.i)} cy={yR(Math.max(item.stat.rate!, 40))} r={item.i === months.length - 1 ? 4 : 3} fill="#d97706" />)}
      </svg>
      <div className="mt-1.5 flex flex-wrap gap-4 text-[12px] text-gray-500 dark:text-slate-400">
        <span><b className="text-[#1F8FE0]">■</b> Profit after ads</span><span><b className="text-amber-600">●</b> Delivery rate</span><span><b className="text-emerald-600">- -</b> 65% target</span>
      </div>
    </div>
  );
}

/** Three plain next steps from the month's own figures. */
function advice(product: Product, index: number, money: (v: number) => string, signed: (v: number) => string): string[] {
  const stat = product.months[index];
  const prev = index > 0 ? product.months[index - 1] : null;
  const rate = stat.rate ?? 0;
  const prevRate = prev && prev.orders > 0 && prev.rate !== null ? `${prev.rate.toFixed(1)}%` : null;
  const perDelivered = stat.delivered > 0 ? stat.profit / stat.delivered : null;
  const costLine = stat.costPerOrder !== null && stat.breakEven !== null
    ? `Ad cost per order is ${money(stat.costPerOrder)} against a break-even of ${money(stat.breakEven)} (${Math.round((stat.costPerOrder / stat.breakEven) * 100)}%).`
    : stat.adSpend === 0 ? "No ad spend recorded for it this month: its orders came without its own ads." : null;
  const lines: Array<string | null> = [];
  switch (stat.verdict) {
    case "scale":
      lines.push(`Delivery rate ${rate.toFixed(1)}% and ${perDelivered !== null ? `${signed(perDelivered)} profit after ads per delivered order` : "making money after ads"}. Raise ad spend step by step and watch the cost per order.`);
      lines.push(costLine);
      lines.push("Check its stock before raising spend: Stock Recommendation tab.");
      break;
    case "keep":
      lines.push(`${(65 - rate).toFixed(1)} points of delivery rate from Scale${prevRate ? ` (it was ${prevRate} in ${MONTH_LONG[Number(prev!.month.slice(5, 7)) - 1]})` : ""}.`);
      lines.push("Hold ad spend steady until the delivery rate reaches 65%.");
      lines.push(costLine);
      break;
    case "fix":
      if (stat.profit < 0) lines.push(`Lost ${money(Math.abs(stat.profit))} after ads. Another losing month turns this to Stop.`);
      if (rate < 60) lines.push(`Delivery rate ${rate.toFixed(1)}%${prevRate ? ` (${prevRate} the month before)` : ""}. See which states and agents fail its orders on State Breakdown.`);
      if (stat.profit >= 0 && stat.revenue > 0 && stat.profit / stat.revenue < 0.1) lines.push(`Profit after ads is only ${((stat.profit / stat.revenue) * 100).toFixed(1)}% of its delivered revenue.`);
      lines.push(costLine);
      if (stat.profit >= 0) lines.push("It still makes money after ads, so do not turn it off. Hold spend until the problem above is fixed.");
      break;
    case "stop":
      lines.push(`Lost ${money(Math.abs(stat.profit))} after ads this month${prev ? ` and ${money(Math.abs(prev.profit))} the month before` : ""}. Turn its ads off, or cut spend until it makes money.`);
      lines.push(costLine);
      lines.push("If you keep selling it, offer it as an add-on to a product that is making money instead of running its own ads.");
      break;
    case "new":
      lines.push(`Only ${stat.orders} order${stat.orders === 1 ? "" : "s"} this month. It gets a verdict at 10.`);
      if (stat.adSpend > 0) lines.push(`${money(stat.adSpend)} spent on its ads so far, ${signed(stat.profit)} after ads.`);
      else lines.push("No ad spend recorded for it: it is selling from the form or as an add-on.");
      break;
  }
  return lines.filter((line): line is string => Boolean(line)).slice(0, 3);
}
