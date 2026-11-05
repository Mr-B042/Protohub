import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Loader2, PackageX, Wrench } from "lucide-react";
import { productPerformanceApi, type ProductWeek, type ProductWeekly, type WeeklyVerdict } from "../../lib/api";
import { ProductThumb, Sparkline, nf } from "./parts";

/**
 * Product Trend › Weekly Check-up (Bright, 5 Nov 2026): why each product had
 * a good or bad week and what to fix. Compared with the average of the 4
 * weeks before, like for like. Rules and maths: backend lib/product-weekly.ts.
 */

const VERDICTS: Record<WeeklyVerdict, { label: string; pill: string; stripe: string; dot: string }> = {
  weak: { label: "Weak week", pill: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", stripe: "bg-rose-500", dot: "bg-rose-500" },
  strong: { label: "Strong week", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", stripe: "bg-emerald-500", dot: "bg-emerald-500" },
  steady: { label: "Steady", pill: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300", stripe: "bg-sky-500", dot: "bg-sky-500" },
  new: { label: "Too new to compare", pill: "bg-gray-100 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300", stripe: "bg-gray-400", dot: "bg-gray-400" },
  small: { label: "Too few orders", pill: "bg-gray-100 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300", stripe: "bg-gray-300", dot: "bg-gray-300" }
};
const FILTERS: Array<WeeklyVerdict | "all"> = ["all", "weak", "strong", "steady", "new", "small"];
const SORT_RANK: Record<WeeklyVerdict, number> = { weak: 0, strong: 1, steady: 2, new: 3, small: 4 };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
const addDays = (key: string, days: number) => { const d = new Date(`${key}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

export function WeeklyCheckupTab({ money, imageOf }: { money: (value: number) => string; imageOf: (productId: string) => string | null }) {
  const [week, setWeek] = useState("");
  const [data, setData] = useState<ProductWeekly | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<WeeklyVerdict | "all">("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    productPerformanceApi.weekly(week)
      .then((result) => { if (live) setData(result); })
      .catch((err: Error) => { if (live) setError(err.message || "Could not load the week."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [week, tick]);

  const signed = (value: number) => (value < 0 ? `−${money(Math.abs(value))}` : `+${money(value)}`);
  const products = useMemo(() => [...(data?.products ?? [])].sort((a, b) =>
    SORT_RANK[a.verdict] - SORT_RANK[b.verdict] || Math.abs(b.week.profit - (b.usual?.profit ?? 0)) - Math.abs(a.week.profit - (a.usual?.profit ?? 0))), [data]);

  if (!data) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-[13px] text-gray-500 shadow-sm dark:border-slate-800">
        {error ? <><p className="m-0 text-rose-700">Could not load the week: {error}</p><button type="button" onClick={() => setTick((n) => n + 1)} className="!min-h-0 mt-3 rounded-lg border border-gray-300 px-3 py-1.5 font-semibold">Try again</button></>
          : <><Loader2 className="mx-auto h-5 w-5 animate-spin" /><p className="m-0 mt-2">Checking each product's week…</p></>}
      </div>
    );
  }

  const isOpen = data.week === data.thisWeek;
  const counts = Object.fromEntries(FILTERS.map((key) => [key, key === "all" ? products.length : products.filter((p) => p.verdict === key).length])) as Record<WeeklyVerdict | "all", number>;
  const shown = products.filter((p) => filter === "all" || p.verdict === filter);
  const totalNow = products.reduce((sum, p) => sum + p.week.profit, 0);
  const totalUsual = products.reduce((sum, p) => sum + (p.usual?.profit ?? 0), 0);
  const allFixes = products.filter((p) => p.verdict === "weak").flatMap((p) => p.fixes.slice(0, 1).map((fix) => ({ name: p.name, fix })));

  return (
    <div className="space-y-4">
      {/* Week picker */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800">
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Week before" onClick={() => setWeek(addDays(data.week, -7))}
            className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"><ChevronLeft className="h-4 w-4" /></button>
          <select aria-label="Week" value={data.week} onChange={(event) => setWeek(event.target.value)}
            className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[14px] font-extrabold dark:border-slate-700 dark:bg-slate-900">
            {[...new Set([data.week, ...data.recentWeeks])].sort().reverse().map((key) => (
              <option key={key} value={key}>{dayLabel(key)} – {dayLabel(addDays(key, 6))}{key === data.thisWeek ? " (this week)" : ""}</option>
            ))}
          </select>
          <button type="button" aria-label="Week after" disabled={isOpen} onClick={() => setWeek(addDays(data.week, 7))}
            className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"><ChevronRight className="h-4 w-4" /></button>
          {loading && <Loader2 className="ml-1 h-4 w-4 animate-spin text-gray-400" />}
        </div>
        <p className="m-0 max-w-xl text-[12.5px] text-gray-500 dark:text-slate-400">
          Compared with the <b className="text-gray-800 dark:text-slate-200">average of the 4 weeks before</b>. Every week counted {data.ageDays} day{data.ageDays === 1 ? "" : "s"} after it ended, so recent orders still on the way don't make this week look worse.
          {isOpen ? " This week is not over yet." : ""}
        </p>
      </section>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">Could not load that week: {error}</div>}

      {/* Week totals */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm dark:border-slate-800">
          <div className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">Profit after ads, all products</div>
          <div className={`mt-1 text-[24px] font-extrabold tabular-nums ${totalNow < 0 ? "text-rose-600" : "text-gray-900 dark:text-slate-50"}`}>{signed(totalNow).replace(/^\+/, "")}</div>
          <div className="mt-1 text-[12px] text-gray-500 dark:text-slate-400">Usual week {signed(totalUsual).replace(/^\+/, "")} · <b className={totalNow - totalUsual < 0 ? "text-rose-600" : "text-emerald-600"}>{signed(totalNow - totalUsual)}</b></div>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm dark:border-slate-800">
          <div className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">Products this week</div>
          <div className="mt-1.5 flex flex-wrap gap-2 text-[13px] font-bold">
            <span className="text-rose-600">{counts.weak} weak</span><span className="text-emerald-600">{counts.strong} strong</span><span className="text-sky-600">{counts.steady} steady</span>
            {counts.new + counts.small > 0 && <span className="text-gray-500">{counts.new + counts.small} not judged</span>}
          </div>
          <div className="mt-1 text-[12px] text-gray-500 dark:text-slate-400">Weak or strong = profit after ads moved 15% (at least ₦10,000) from the usual week.</div>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3.5 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-amber-800 dark:text-amber-200"><Wrench className="h-4 w-4" />Fix first</div>
          {allFixes.length === 0 ? <p className="m-0 mt-1.5 text-[13px] text-amber-900/80 dark:text-amber-100">No weak products this week.</p> : (
            <ul className="m-0 mt-1.5 list-none space-y-1 p-0 text-[12.5px] text-amber-950 dark:text-amber-50">
              {allFixes.slice(0, 3).map((row) => <li key={row.name}><b>{row.name}:</b> {row.fix}</li>)}
            </ul>
          )}
        </div>
      </section>

      {/* Filter */}
      <section className="flex flex-wrap items-center gap-2" aria-label="Filter by verdict">
        {FILTERS.filter((key) => key === "all" || counts[key] > 0).map((key) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`!min-h-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-bold ${filter === key ? "border-gray-900 bg-gray-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
            {key !== "all" && <span className={`h-2 w-2 rounded-full ${VERDICTS[key].dot}`} />}{key === "all" ? "All products" : VERDICTS[key].label} <span className="tabular-nums opacity-70">{counts[key]}</span>
          </button>
        ))}
      </section>

      {shown.length === 0 && <div className="rounded-2xl border border-gray-200 bg-white px-4 py-6 text-[13px] text-gray-500 dark:border-slate-800">No product sold or spent on ads in this week.</div>}
      <section className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {shown.map((product) => <ProductCard key={product.id} product={product} money={money} signed={signed} image={product.image ?? imageOf(product.id)} clicksSince={data.clicksSince} />)}
      </section>
    </div>
  );
}

function ProductCard({ product, money, signed, image, clicksSince }: { product: ProductWeek; money: (value: number) => string; signed: (value: number) => string; image: string | null; clicksSince: string }) {
  const [open, setOpen] = useState<string | null>(product.verdict === "weak" ? product.drivers.find((d) => d.impact < 0)?.key ?? null : null);
  const verdict = VERDICTS[product.verdict];
  const w = product.week;
  const u = product.usual;
  const biggest = Math.max(1, ...product.drivers.map((d) => Math.abs(d.impact)));
  const rate = (value: number | null) => (value === null ? "-" : `${Math.round(value)}%`);
  const tiles = [
    { label: "Profit after ads", now: signed(w.profit).replace(/^\+/, ""), usual: u ? signed(u.profit).replace(/^\+/, "") : null, bad: w.profit < 0 },
    { label: "Orders", now: nf(w.orders), usual: u ? nf(u.orders) : null, bad: false },
    { label: "Delivered", now: rate(w.rate), usual: u ? rate(u.rate) : null, bad: false },
    { label: "Cost per order", now: w.costPerOrder === null ? "-" : money(w.costPerOrder), usual: u?.costPerOrder ? money(u.costPerOrder) : u ? "-" : null, bad: false },
    { label: "CPC", now: w.cpc === null ? "-" : money(w.cpc), usual: u ? (u.cpc === null ? "-" : money(u.cpc)) : null, bad: false }
  ];

  return (
    <article className="relative overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800">
      <span className={`absolute inset-y-0 left-0 w-1 ${verdict.stripe}`} />
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb src={image} name={product.name} />
          <div className="min-w-0">
            <h3 className="m-0 truncate text-[15.5px] font-extrabold text-gray-900 dark:text-slate-50" title={product.name}>{product.name}</h3>
            <span className={`mt-1 inline-flex rounded-full px-2.5 py-0.5 text-[11.5px] font-extrabold ${verdict.pill}`}>{verdict.label}</span>
          </div>
        </div>
        <div className="text-right">
          <Sparkline values={product.history.map((row) => row.profit)} color={product.verdict === "weak" ? "#e11d48" : product.verdict === "strong" ? "#059669" : "#1d4ed8"} width={96} />
          <div className="text-[10.5px] text-gray-400">profit after ads, last 5 weeks</div>
        </div>
      </header>
      <p className="m-0 px-5 pt-2 text-[13px] text-gray-700 dark:text-slate-300">{product.summary}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 px-5 sm:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800/60">
            <div className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">{tile.label}</div>
            <div className={`text-[15px] font-extrabold tabular-nums ${tile.bad ? "text-rose-600" : "text-gray-900 dark:text-slate-50"}`}>{tile.now}</div>
            {tile.usual !== null && <div className="text-[11px] text-gray-400">usual {tile.usual}</div>}
          </div>
        ))}
      </div>
      {w.cpc === null && w.week < clicksSince && w.adSpend > 0 && <p className="m-0 px-5 pt-1.5 text-[11px] text-gray-400">CPC shows from {dayLabel(clicksSince)}, when clicks started being saved.</p>}

      {product.drivers.length > 0 && (
        <div className="mt-4 px-5">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400">Why - what each part added or cost vs the usual week</div>
          <ul className="m-0 list-none divide-y divide-gray-100 rounded-xl border border-gray-200 p-0 dark:divide-slate-800 dark:border-slate-800">
            {product.drivers.map((driver) => {
              const isOpen = open === driver.key;
              const width = `${Math.max(4, (Math.abs(driver.impact) / biggest) * 100)}%`;
              return (
                <li key={driver.key}>
                  <button type="button" onClick={() => setOpen(isOpen ? null : driver.key)} aria-expanded={isOpen}
                    className="!min-h-0 grid w-full grid-cols-[1fr_auto_16px] items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <span className="min-w-0">
                      <b className="block text-[13px] text-gray-900 dark:text-slate-100">{driver.label}</b>
                      <span className="block truncate text-[12px] text-gray-500 dark:text-slate-400">{driver.headline}</span>
                      <span className="mt-1 block h-1.5 rounded-full bg-gray-100 dark:bg-slate-800">
                        <i className={`block h-full rounded-full ${driver.impact < 0 ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width }} />
                      </span>
                    </span>
                    <span className={`text-[13.5px] font-extrabold tabular-nums ${driver.impact < 0 ? "text-rose-600" : "text-emerald-600"}`}>{signed(driver.impact)}</span>
                    <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isOpen && (
                    <ul className="m-0 list-disc space-y-1 px-8 pb-3 text-[12.5px] text-gray-700 dark:text-slate-300">
                      {driver.details.map((line) => <li key={line}>{line}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {product.stockOuts.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 px-5">
          <PackageX className="h-4 w-4 text-amber-600" />
          {product.stockOuts.map((row) => (
            <span key={row.state} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11.5px] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
              {row.state}: {row.noHub ? "no hub has it" : `out ${row.daysOut} day${row.daysOut === 1 ? "" : "s"}`}{row.ordersWhileOut ? ` · ${row.ordersWhileOut} order${row.ordersWhileOut === 1 ? "" : "s"} then` : ""}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 px-5 pb-5 md:grid-cols-2">
        {product.fixes.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />What to fix</div>
            <ol className="m-0 mt-1.5 list-decimal space-y-1 pl-5 text-[12.5px] text-amber-950 dark:text-amber-50">{product.fixes.map((fix) => <li key={fix}>{fix}</li>)}</ol>
          </div>
        )}
        {product.wins.length > 0 && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4" />What went right</div>
            <ul className="m-0 mt-1.5 list-disc space-y-1 pl-5 text-[12.5px] text-emerald-950 dark:text-emerald-50">{product.wins.map((win) => <li key={win}>{win}</li>)}</ul>
          </div>
        )}
      </div>
    </article>
  );
}
