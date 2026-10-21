import { useMemo, useState } from "react";
import { Lightbulb } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "../lib/money-privacy";
import { Avatar } from "./product-trend/parts";
import { rateTone } from "./RepProductPerformancePage";
import type { RepProductOrder } from "./RepProductPerformancePage";
import { ChartCard, LowerToolbar, MiniSelect, OTHERS_COLOR, RankBadge, SERIES, StateIcon, WaitingForDesign, nf, share, type RppCtx } from "./rpp-ui";

// ── State Breakdown tab (Bright's design, 21 Oct 2026) ──────────────────────
// States are the customer's delivery state, cleaned to one name per state.
// Best / worst state only rank states with at least MIN orders.

const LOWER = ["State Performance by Sales Rep", "State Product Breakdown", "State Delivery Rate", "State Revenue & Profit", "State Comparison"] as const;
type Lower = (typeof LOWER)[number];
const MIN = 5;
const OTHERS = "__others";
const NO_STATE = "No state";

type StateRow = { key: string; name: string; orders: RepProductOrder[]; placed: number; delivered: number; revenue: number };

export default function RppStateTab({ ctx }: { ctx: RppCtx }) {
  const [lower, setLower] = useState<Lower>("State Performance by Sales Rep");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"table" | "chart">("table");
  const [pick, setPick] = useState("all");

  const states = useMemo<StateRow[]>(() => {
    const map = new Map<string, RepProductOrder[]>();
    for (const order of ctx.current) {
      const key = order.state || NO_STATE;
      const list = map.get(key);
      if (list) list.push(order); else map.set(key, [order]);
    }
    return [...map].map(([key, orders]) => {
      const delivered = orders.filter((order) => order.status === "Delivered");
      return { key, name: key, orders, placed: orders.length, delivered: delivered.length, revenue: delivered.reduce((sum, order) => sum + order.amount, 0) };
    }).sort((a, b) => b.placed - a.placed || b.revenue - a.revenue);
  }, [ctx.current]);
  const total = useMemo(() => states.reduce((t, s) => ({ placed: t.placed + s.placed, delivered: t.delivered + s.delivered, revenue: t.revenue + s.revenue }), { placed: 0, delivered: 0, revenue: 0 }), [states]);
  const group = (rows: StateRow[], limit = 5): StateRow[] => {
    if (rows.length <= limit + 1) return rows;
    const rest = rows.slice(limit);
    return [...rows.slice(0, limit), { key: OTHERS, name: "Others", orders: rest.flatMap((s) => s.orders), placed: rest.reduce((n, s) => n + s.placed, 0), delivered: rest.reduce((n, s) => n + s.delivered, 0), revenue: rest.reduce((n, s) => n + s.revenue, 0) }];
  };
  const byOrders = group(states);
  const byRevenue = group([...states].sort((a, b) => b.revenue - a.revenue));
  const rate = (row: { placed: number; delivered: number }) => share(row.delivered, row.placed);
  const judged = states.filter((s) => s.placed >= MIN && s.key !== NO_STATE);
  const best = [...judged].sort((a, b) => (rate(b) ?? 0) - (rate(a) ?? 0) || b.revenue - a.revenue)[0];
  const worst = judged.length > 1 ? [...judged].sort((a, b) => (rate(a) ?? 0) - (rate(b) ?? 0) || a.revenue - b.revenue)[0] : undefined;
  const topRevenue = [...states].filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  const picked = pick === "all" ? null : states.find((s) => s.key === pick) ?? null;
  const colorOf = (index: number, key: string) => (key === OTHERS ? OTHERS_COLOR : SERIES[index % SERIES.length]);
  const needle = search.trim().toLowerCase();
  const tableRows = needle ? states.filter((s) => s.name.toLowerCase().includes(needle)) : byOrders;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="min-w-0 space-y-4">
        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard title={`Orders by State (${ctx.periodName})`}>
            <BarChart data={byOrders.map((s) => ({ name: s.name, orders: s.placed }))} margin={{ top: 18, right: 4, left: -22, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="orders" name="Orders" fill="#a78bfa" radius={[3, 3, 0, 0]}><LabelList dataKey="orders" position="top" fontSize={10} /></Bar>
            </BarChart>
          </ChartCard>
          <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="m-0 mb-3 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Orders by State</h2>
            <Ring slices={byOrders.map((s, index) => ({ label: s.name, value: s.placed, color: colorOf(index, s.key) }))} center={nf(total.placed)} sub="Total Orders" />
          </section>
          <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="m-0 mb-4 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">Top States by Revenue (Delivered)</h2>
            <ul className="m-0 list-none space-y-3.5 p-0">
              {byRevenue.map((s, index) => (
                <li key={s.key} className="flex items-center gap-2.5">
                  <span className="w-20 shrink-0 truncate text-[12.5px] text-gray-700 dark:text-slate-300" title={s.name}>{s.name}</span>
                  <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded bg-gray-100 dark:bg-slate-800"><div className="h-full rounded" style={{ width: `${(s.revenue / Math.max(1, byRevenue[0]?.revenue ?? 1)) * 100}%`, background: colorOf(index, s.key) }} /></div>
                  <span className="w-[82px] shrink-0 text-right text-[12px] font-semibold text-gray-900 dark:text-slate-100">{money(s.revenue)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <LowerToolbar tabs={LOWER} active={lower} onTab={setLower} search={search} onSearch={setSearch} placeholder="Search state..." view={view} onView={setView} />

        {lower !== "State Performance by Sales Rep" ? <WaitingForDesign what={lower} /> : view === "chart" ? (
          <ChartCard title="Delivery rate by state and rep" height={340}>
            <BarChart data={tableRows.map((s) => {
              const entry: Record<string, string | number | null> = { state: s.name };
              for (const id of ctx.repIds) { const list = s.orders.filter((o) => (o.repId ?? "") === id); entry[id] = list.length ? Math.round((list.filter((o) => o.status === "Delivered").length / list.length) * 100) : null; }
              return entry;
            })} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
              <XAxis dataKey="state" tick={{ fontSize: 11 }} interval={0} />
              <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} unit="%" />
              <Tooltip formatter={(value: number, name: string) => [`${value}%`, ctx.nameOfRep(name)]} />
              <Legend formatter={(value: string) => ctx.nameOfRep(value)} wrapperStyle={{ fontSize: 12 }} />
              {ctx.repIds.map((id, index) => <Bar key={id} dataKey={id} fill={SERIES[index % SERIES.length]} radius={[4, 4, 0, 0]} />)}
            </BarChart>
          </ChartCard>
        ) : (
          <StateRepTable rows={tableRows} total={{ key: "total", name: "Total", orders: ctx.current, ...total }} ctx={ctx} />
        )}
        <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">Orders placed {ctx.periodLabel}, by the customer's delivery state. Delivered = of those orders, delivered now; DR = delivered ÷ orders. Best / worst state need at least {MIN} orders. Tap a rep's figures to see the orders.</p>
      </div>

      {/* ── Right column ─────────────────────────────────────────────────── */}
      <aside className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="m-0 mb-2 text-[14.5px] font-bold text-gray-900 dark:text-slate-100">State Performance</h2>
          <MiniSelect label="State" value={pick} onChange={setPick} className="w-full" options={[{ value: "all", label: "All States" }, ...states.map((s) => ({ value: s.key, label: s.name }))]} />
        </div>
        {picked ? <StateCard label="Selected State" tag={null} row={picked} rate={rate(picked)} ctx={ctx} /> : (<>
          {best ? <StateCard label="Best Performing State" tag={["Top State", "bg-emerald-50 text-emerald-700"]} row={best} rate={rate(best)} ctx={ctx} /> : <p className="m-0 text-[12.5px] text-gray-500">No state has {MIN} or more orders yet.</p>}
          {worst && worst.key !== best?.key && <StateCard label="Worst Performing State" tag={["Lowest", "bg-rose-50 text-rose-700"]} row={worst} rate={rate(worst)} ctx={ctx} />}
        </>)}
        <div>
          <h3 className="m-0 mb-2 text-[13px] font-bold text-gray-900 dark:text-slate-100">Top 5 States by Revenue</h3>
          <ol className="m-0 list-none space-y-2.5 p-0">
            {topRevenue.map((s, index) => (
              <li key={s.key} className="flex items-center gap-2 text-[12.5px]">
                <RankBadge rank={index + 1} /><StateIcon name={s.name} size={24} />
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-slate-200">{s.name}</span>
                <span className="font-semibold text-gray-900 dark:text-slate-100">{money(s.revenue)}</span>
                <span className="w-9 text-right text-[11px] text-gray-400">{Math.round(share(s.revenue, total.revenue) ?? 0)}%</span>
              </li>
            ))}
            {topRevenue.length === 0 && <li className="text-[12.5px] text-gray-500">No delivered revenue yet.</li>}
          </ol>
        </div>
        {topRevenue[0] && (
          <div className="flex gap-2.5 rounded-xl border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-500/20 dark:bg-violet-500/5">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-600"><Lightbulb className="h-4 w-4" /></span>
            <div className="text-[12px] leading-relaxed text-gray-700 dark:text-slate-300">
              <div className="mb-0.5 text-[13px] font-bold text-gray-900 dark:text-slate-100">Insight</div>
              {topRevenue[0].name} has the highest revenue ({Math.round(share(topRevenue[0].revenue, total.revenue) ?? 0)}%) with {Math.round(rate(topRevenue[0]) ?? 0)}% delivery rate.
              {worst && worst.key !== topRevenue[0].key ? ` Focus on improving ${worst.name}'s delivery rate (${Math.round(rate(worst) ?? 0)}%) to increase overall revenue.` : ""}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function StateCard({ label, tag, row, rate, ctx }: { label: string; tag: [string, string] | null; row: StateRow; rate: number | null; ctx: RppCtx }) {
  return (
    <button type="button" onClick={() => ctx.openList(`${row.name} · orders`, `${row.placed} orders · ${ctx.periodLabel}`, row.orders)}
      className="!min-h-0 block w-full rounded-xl border border-gray-200 p-3 text-left hover:border-indigo-300 dark:border-slate-700">
      <div className="mb-2 flex items-center justify-between gap-2"><span className="text-[12px] font-bold text-gray-900 dark:text-slate-100">{label}</span>{tag && <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${tag[1]}`}>{tag[0]}</span>}</div>
      <div className="flex items-center gap-2.5">
        <StateIcon name={row.name} size={34} />
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold text-gray-900 dark:text-slate-100">{row.name}</div>
          <div className="text-[11.5px] text-gray-500">{row.placed} orders · <span className={`font-semibold ${rateTone(rate, row.placed, ctx.target)}`}>{Math.round(rate ?? 0)}% DR</span></div>
          <div className="text-[11.5px] text-gray-500">{money(row.revenue)} revenue</div>
        </div>
      </div>
    </button>
  );
}

function StateRepTable({ rows, total, ctx }: { rows: StateRow[]; total: StateRow; ctx: RppCtx }) {
  const th = "px-1.5 py-2 text-[10.5px] font-medium leading-tight text-gray-500 dark:text-slate-400";
  const td = "px-1.5 py-2.5 text-center text-[12px] text-gray-800 dark:text-slate-200";
  const cells = (orders: RepProductOrder[], open: (() => void) | null, bold: boolean, last: "aov" | "revenue", shade = false) => {
    const delivered = orders.filter((o) => o.status === "Delivered");
    const revenue = delivered.reduce((sum, o) => sum + o.amount, 0);
    const r = share(delivered.length, orders.length);
    const click = open && orders.length ? { onClick: open, className: "cursor-pointer hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10", title: "Show the orders" } : { className: "" };
    const bg = shade ? "bg-slate-50 dark:bg-slate-800/50" : "";
    return (
      <>
        <td {...click} className={`${td} border-l border-gray-100 dark:border-slate-800 ${bold ? "font-bold" : ""} ${bg} ${click.className}`}>{orders.length}</td>
        <td {...click} className={`${td} ${bold ? "font-bold" : ""} ${bg} ${click.className}`}>{delivered.length}</td>
        <td {...click} className={`px-1.5 py-2.5 text-center text-[12px] font-bold ${rateTone(r, orders.length, ctx.target)} ${bg} ${click.className}`}>{r === null ? "-" : `${Math.round(r)}%`}</td>
        <td {...click} className={`${td} whitespace-nowrap ${bold ? "font-bold" : ""} ${bg} ${click.className}`}>{last === "revenue" ? money(revenue) : delivered.length ? money(revenue / delivered.length) : "-"}</td>
      </>
    );
  };
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full min-w-max border-collapse">
          <thead className="sticky top-0 z-20 bg-white dark:bg-slate-900">
            <tr className="border-b border-gray-100 dark:border-slate-800">
              <th rowSpan={2} className="sticky left-0 z-30 min-w-[120px] bg-white px-3 text-left text-[12px] font-medium text-gray-600 dark:bg-slate-900 dark:text-slate-300">State</th>
              {ctx.repIds.map((id) => <th key={id} colSpan={4} className="border-l border-gray-100 px-2 py-2.5 dark:border-slate-800"><span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-gray-900 dark:text-slate-100"><Avatar name={ctx.nameOfRep(id)} size={22} />{ctx.nameOfRep(id)}</span></th>)}
              <th colSpan={4} className="border-l border-gray-200 bg-slate-50 px-2 py-2.5 text-[12.5px] font-bold text-gray-900 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-100">Total (All Reps)</th>
            </tr>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {ctx.repIds.map((id) => <Cells key={id}><th className={`${th} border-l border-gray-100 dark:border-slate-800`}>Orders</th><th className={th}>Delivered</th><th className={th}>DR %</th><th className={th}>AOV</th></Cells>)}
              <th className={`${th} border-l border-gray-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50`}>Orders</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>Delivered</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>DR %</th><th className={`${th} bg-slate-50 dark:bg-slate-800/50`}>Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={5 + ctx.repIds.length * 4} className="px-4 py-8 text-center text-[13px] text-gray-500">No state matches your search.</td></tr>}
            {rows.map((row) => (
              <tr key={row.key} className="hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-2 text-left dark:bg-slate-900"><span className="flex items-center gap-2 text-[12.5px] font-semibold text-gray-900 dark:text-slate-100"><StateIcon name={row.name} size={22} />{row.name}</span></th>
                {ctx.repIds.map((id) => { const list = row.orders.filter((o) => (o.repId ?? "") === id); return <Cells key={id}>{cells(list, () => ctx.openList(`${ctx.nameOfRep(id)} · ${row.name}`, `${list.length} orders · ${ctx.periodLabel}`, list), false, "aov")}</Cells>; })}
                {cells(row.orders, null, true, "revenue", true)}
              </tr>
            ))}
            <tr className="border-t-2 border-gray-200 dark:border-slate-700">
              <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-3 text-left text-[13px] font-bold text-gray-900 dark:bg-slate-900 dark:text-slate-100">Total</th>
              {ctx.repIds.map((id) => <Cells key={id}>{cells(total.orders.filter((o) => (o.repId ?? "") === id), null, true, "aov")}</Cells>)}
              {cells(total.orders, null, true, "revenue", true)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cells({ children }: { children: React.ReactNode }) { return <>{children}</>; }

/** Ring chart with a legend, as in the design. */
export function Ring({ slices, center, sub }: { slices: Array<{ label: string; value: number; color: string; extra?: string }>; center: string; sub: string }) {
  const sum = slices.reduce((s, slice) => s + slice.value, 0);
  const r = 40, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-[150px] w-[150px] shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={sub}>
          <circle cx={50} cy={50} r={r} fill="none" stroke="#eef2f7" strokeWidth={16} />
          {sum > 0 && slices.filter((slice) => slice.value > 0).map((slice) => {
            const length = (slice.value / sum) * c;
            const el = <circle key={slice.label} cx={50} cy={50} r={r} fill="none" stroke={slice.color} strokeWidth={16} strokeDasharray={`${Math.max(0, length - 0.8)} ${c}`} strokeDashoffset={-offset}><title>{`${slice.label}: ${slice.value}`}</title></circle>;
            offset += length;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="text-[20px] font-black leading-none text-gray-900 dark:text-slate-50">{center}</div>
          <div className="mt-1 max-w-[80px] text-[10.5px] leading-tight text-gray-500">{sub}</div>
        </div>
      </div>
      <ul className="m-0 w-full list-none space-y-1.5 p-0">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-start gap-2 text-[12px]">
            <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
            <span className="min-w-0"><span className="block truncate text-gray-700 dark:text-slate-300">{slice.label}</span>
              <span className="text-gray-900 dark:text-slate-100">{sum > 0 ? Math.round((slice.value / sum) * 100) : 0}% ({slice.extra ?? nf(slice.value)})</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
