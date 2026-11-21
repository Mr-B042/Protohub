import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, ChevronRight, Compass, Loader2, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart as RLineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trackingHubApi, type CampaignDecisionsView, type CdDayOrder, type CdRow } from "../../lib/api";
import { money } from "../../lib/money-privacy";
import { shortDay, type Toast } from "./HubParts";
import { DECISIONS } from "./CampaignDecisionsTab";
import CampaignOrderCard from "./CampaignOrderCard";

// Campaign detail (Bright's write-up, section 10, 21 Nov 2026; no picture was
// supplied, so it follows the write-up's order in the main page's style):
// header with the final recommendation, then A money, B ad performance,
// C daily table (order date / delivery date), D five trend charts, E three
// plain-English cards. Real and projected figures are always apart.

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const conf = (c: string) => `${c[0].toUpperCase()}${c.slice(1)}`;
const ratingTone = (score: number) => score >= 80 ? "text-emerald-600" : score >= 70 ? "text-blue-600" : score >= 60 ? "text-amber-600" : "text-rose-600";

function Tile({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="m-0 text-[11.5px] font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`m-0 mt-1 text-[18px] font-extrabold leading-6 ${tone ?? "text-gray-900 dark:text-slate-50"}`}>{value}</p>
      {note ? <p className="m-0 mt-0.5 text-[11.5px] text-gray-500">{note}</p> : null}
    </div>
  );
}
// Smart sticky (Bright, 21 Nov 2026: "let all these places have a smart
// sticky"): the panel's own header is measured; each section's title bar
// sticks under it and only casts a shadow once it is actually stuck; the
// daily table's column headings stick under that, and the day you opened
// sticks under them while you read its orders. Below lg the table scrolls
// sideways, which a sticky row cannot cross, so only the bars stick there.
const SECTION_BAR = 52;
const StickyCtx = createContext<{ top: number; scroller: RefObject<HTMLDivElement | null> }>({ top: 0, scroller: { current: null } });

function Section({ letter, title, children, right }: { letter: string; title: string; children: ReactNode; right?: ReactNode }) {
  const { top, scroller } = useContext(StickyCtx);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current, root = scroller.current;
    if (!el || !root || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 1), { root, rootMargin: `-${top + 1}px 0px 0px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [top, scroller]);
  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50 px-4 pb-4 dark:border-slate-800 dark:bg-slate-900">
      <div ref={sentinel} aria-hidden className="h-px" />
      <div style={{ top, height: SECTION_BAR }}
        className={`sticky z-[6] -mx-4 mb-2 flex items-center gap-2 px-4 transition-[background-color,box-shadow] duration-200 ${stuck ? "rounded-none bg-white shadow-[0_6px_16px_-10px_rgba(15,23,42,0.35)] dark:bg-slate-950" : "rounded-t-2xl bg-gray-50 dark:bg-slate-900"}`}>
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-[12px] font-black text-white">{letter}</span>
        <h3 className="m-0 truncate text-[16px] font-extrabold text-gray-900 dark:text-slate-50">{title}</h3>
        {right ? <div className="ml-auto shrink-0">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}
function ChartCard({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <p className="m-0 text-[13px] font-bold text-gray-800 dark:text-slate-200">{title}</p>
      {note ? <p className="m-0 text-[11px] text-gray-500">{note}</p> : null}
      <div className="mt-2 h-[190px]">{children}</div>
    </div>
  );
}
const axis = { tickLine: false, axisLine: false, fontSize: 11 } as const;
const short = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

export default function CampaignDecisionDetail({ row, data, onClose, onToast }: { row: CdRow; data: CampaignDecisionsView; onClose: () => void; onToast: Toast }) {
  const d = DECISIONS[row.decision];
  const [view, setView] = useState<"order" | "delivery">("order");
  const scroller = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [headH, setHeadH] = useState(124);
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setHeadH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const THEAD = 40;
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [dayOrders, setDayOrders] = useState<Record<string, CdDayOrder[] | "loading">>({});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const toggleDay = (day: string) => {
    setOpenDay(openDay === day ? null : day);
    if (dayOrders[day]) return;
    setDayOrders((m) => ({ ...m, [day]: "loading" }));
    trackingHubApi.campaignDayOrders(row.campaignId, day)
      .then((result) => setDayOrders((m) => ({ ...m, [day]: result.orders })))
      .catch((err: Error) => { setDayOrders((m) => { const next = { ...m }; delete next[day]; return next; }); onToast(`Couldn't load that day's orders: ${err.message}`); });
  };

  const m = row.period, T = row.target;
  const full = row.days.filter((day) => day.day < data.today);
  let running = 0;
  const series = row.days.map((day) => {
    running += day.netContribution;
    return { name: shortDay(day.day), Orders: day.orders, Delivered: day.delivered, CPP: day.orders ? Math.round(day.spend / day.orders) : null, Spend: Math.round(day.spend), Contribution: Math.round(day.netContribution + day.spend), DR: day.orders ? Math.round((day.delivered / day.orders) * 100) : null, Cumulative: Math.round(running) };
  });
  const dayVerdict = (spend: number, orders: number) => orders === 0 ? (spend > 0 ? { t: "No order", c: "text-rose-600" } : { t: "Off", c: "text-gray-400" }) : spend / orders <= T * 0.7 ? { t: "Strong", c: "text-emerald-600" } : spend / orders <= T ? { t: "OK", c: "text-blue-600" } : { t: "Costly", c: "text-rose-600" };
  const trend = row.recentCpo !== null && row.priorCpo !== null ? row.recentCpo / row.priorCpo : null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/45 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={scroller} data-smart-sticky="off" role="dialog" aria-label={row.campaignName} onClick={(event) => event.stopPropagation()}
        className="h-full w-full max-w-[1180px] overflow-y-auto bg-white shadow-2xl motion-safe:animate-[cdSlide_.28s_cubic-bezier(.2,.7,.2,1)] dark:bg-slate-950">
        <style>{"@keyframes cdSlide { from { transform: translateX(32px); opacity: .4 } to { transform: none; opacity: 1 } } @keyframes cdCardIn { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } } @media (prefers-reduced-motion: no-preference) { .cd-card-in { animation: cdCardIn .3s cubic-bezier(.2,.7,.2,1) both } }"}</style>
        <StickyCtx.Provider value={{ top: headH, scroller }}>
        {/* Header */}
        <div ref={headRef} className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-6 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-[22px] font-black leading-7 text-gray-900 dark:text-slate-50">{row.campaignName}</h2>
              <p className="m-0 mt-1 text-[13px] text-gray-500">Product: <b className="text-gray-800 dark:text-slate-200">{row.productName ?? "not known"}</b> · {row.accountName} · Status: <b className="text-emerald-700">Active</b></p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="!min-h-0 rounded-lg border border-gray-200 p-2 hover:bg-gray-50 dark:border-slate-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[14px] font-bold ${d.pill}`}><d.Icon className="h-4 w-4" />{row.label}</span>
            <span className="rounded-xl border border-gray-200 px-3 py-1.5 text-[13px] dark:border-slate-700">Campaign health <b className={`text-[15px] ${ratingTone(row.score)}`}>{row.score}/100</b> — {row.rating}</span>
            <span className="rounded-xl border border-gray-200 px-3 py-1.5 text-[13px] dark:border-slate-700">Confidence <b>{conf(row.confidence)}</b></span>
            {row.escalate ? <span className="inline-flex items-center gap-1 rounded-xl bg-rose-600 px-3 py-1.5 text-[13px] font-bold text-white"><AlertTriangle className="h-4 w-4" />Escalate: review today</span> : null}
          </div>
        </div>

        <div className="space-y-4 p-6">
          {/* Final recommendation (write-up §12) */}
          <section className={`rounded-2xl border p-4 ${d.pill}`}>
            <div className="grid gap-3 text-[13.5px] text-gray-800 dark:text-slate-200 md:grid-cols-2">
              <p className="m-0"><b className="block text-[12px] uppercase tracking-wide opacity-80">Why?</b>{row.why}</p>
              <p className="m-0"><b className="block text-[12px] uppercase tracking-wide opacity-80">Recommended action</b>{row.action}</p>
              <p className="m-0"><b className="block text-[12px] uppercase tracking-wide opacity-80">What to monitor</b>{row.monitor}</p>
              <p className="m-0"><b className="block text-[12px] uppercase tracking-wide opacity-80">When to reconsider</b>{row.reconsider}</p>
            </div>
          </section>

          {/* Score breakdown */}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {row.scoreParts.map((part) => (
              <div key={part.key} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900" title={part.note}>
                <p className="m-0 text-[11.5px] font-semibold text-gray-500">{part.label}</p>
                <p className="m-0 mt-0.5 text-[15px] font-extrabold text-gray-900 dark:text-slate-50">{part.points}<span className="text-[12px] font-semibold text-gray-400"> / {part.max}</span></p>
                <span className="mt-1.5 block h-1.5 rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-1.5 rounded-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${(part.points / part.max) * 100}%` }} /></span>
                <p className="m-0 mt-1 line-clamp-2 text-[10.5px] leading-snug text-gray-500">{part.note}</p>
              </div>
            ))}
          </div>

          <Section letter="A" title={`Financial overview — orders placed in the last ${data.periodDays} days`}>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-5">
              <Tile label="Total orders" value={m.orders} />
              <Tile label="Delivered" value={m.delivered} note={`DR ${pct(m.deliveryRate)} so far`} />
              <Tile label="Pending" value={m.pending} note="Not counted as sales" />
              <Tile label="Failed / cancelled" value={m.failed} note={m.failedCost ? `${money(m.failedCost)} failed-delivery fees` : undefined} />
              <Tile label="Delivered revenue" value={money(m.deliveredRevenue)} />
              <Tile label="Gross profit" value={money(m.grossProfit)} note={`After ${money(m.productCost)} product cost`} />
              <Tile label="Contribution before ads" value={money(m.contributionBeforeAds)} note={`After delivery ${money(m.logistics)}, bonuses ${money(m.repBonus)}, failed ${money(m.failedCost)}`} />
              <Tile label="Ad spend" value={money(m.adSpend)} />
              <Tile label="Net contribution" value={money(m.netContribution)} tone={m.netContribution >= 0 ? "text-emerald-600" : "text-rose-600"} note="Real: delivered orders only" />
              <Tile label="Expected final contribution" value={money(m.expectedFinal)} tone={m.expectedFinal >= 0 ? "text-emerald-600" : "text-rose-600"} note={m.pending ? `Projected: ${m.pending} pending at ${pct(row.matureRate)} delivery` : "Nothing pending"} />
            </div>
          </Section>

          <Section letter="B" title="Advertising performance — last 7 full days">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              <Tile label="Ad spend" value={money(row.week.adSpend)} />
              <Tile label="Cost per order" value={row.week.costPerOrder !== null ? money(row.week.costPerOrder) : "—"} />
              <Tile label="Break-even CPP" value={money(T)} note={row.targetKnown ? (row.targetSource === "set_by_you" ? "Your target" : "Worked out from delivered orders") : "Not known: ₦7,500 used"} />
              <Tile label="CPP safety margin" value={row.week.costPerOrder !== null ? pct(1 - row.week.costPerOrder / T) : "—"} tone={row.week.costPerOrder !== null && row.week.costPerOrder > T ? "text-rose-600" : "text-emerald-600"} note="Room left under break-even" />
              <Tile label="Cost per delivered" value={row.week.costPerDelivered !== null ? money(row.week.costPerDelivered) : "—"} />
              <Tile label="Recent CPP trend" value={trend === null ? "—" : trend <= 0.95 ? "Improving" : trend >= 1.05 ? "Getting dearer" : "Steady"} note={row.recentCpo !== null && row.priorCpo !== null ? `${money(row.recentCpo)} last 3 days vs ${money(row.priorCpo)}` : undefined} />
              <Tile label="Conversion rate" value={row.funnel?.conversion != null ? `${(row.funnel.conversion * 100).toFixed(1)}%` : "—"} note="Orders ÷ link clicks" />
              <Tile label="CTR" value={row.funnel?.ctr != null ? `${(row.funnel.ctr * 100).toFixed(2)}%` : "—"} />
              <Tile label="CPC" value={row.funnel?.cpc != null ? money(row.funnel.cpc) : "—"} />
              <Tile label="CPM" value={row.funnel?.cpm != null ? money(row.funnel.cpm) : "—"} />
              <Tile label="Frequency" value="—" note="Not read from Meta yet" />
              <Tile label="Delivery (older orders)" value={pct(row.matureRate)} note={row.deliveryHealth ? `${row.deliveryHealth}${row.matureRateSource === "product" ? " · product's rate" : ` · ${row.matureOrders} orders`}` : "Not enough old orders"} />
            </div>
            <p className="m-0 mt-2 text-[11.5px] text-gray-500">CTR, CPC and CPM only help find a problem; they are never a reason on their own to turn off a campaign that makes money.</p>
          </Section>

          <Section letter="C" title="Daily performance" right={
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-[12.5px] dark:border-slate-700 dark:bg-slate-900">
              {(["order", "delivery"] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={`!min-h-0 rounded-md px-3 py-1 font-semibold ${view === v ? "bg-indigo-600 text-white" : "text-gray-600"}`}>{v === "order" ? "Order date" : "Delivery date"}</button>)}
            </div>
          }>
            {view === "order" ? (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white lg:overflow-visible dark:border-slate-700 dark:bg-slate-900">
                <table className="!min-w-[860px] w-full text-[12.5px] [&_td]:!px-2.5 [&_th]:!px-2.5">
                  <thead style={{ top: headH + SECTION_BAR }} className="text-gray-600 lg:sticky lg:z-[5] [&_th]:bg-gray-50 dark:[&_th]:bg-slate-800 [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl"><tr style={{ height: THEAD }}><th className="w-6" /><th className="py-2 text-left">Date</th><th>Orders</th><th>Delivered</th><th>Pending</th><th>Failed</th><th>Revenue</th><th>Ad spend</th><th>Gross profit</th><th>Net contribution</th><th>Day</th></tr></thead>
                  <tbody>
                    {[...row.days].reverse().map((day) => {
                      const v = dayVerdict(day.spend, day.orders);
                      const list = dayOrders[day.day];
                      return (
                        <Fragment key={day.day}>
                          <tr onClick={() => day.orders && toggleDay(day.day)} style={openDay === day.day ? { top: headH + SECTION_BAR + THEAD } : undefined}
                            className={`border-t border-gray-100 text-center dark:border-slate-800 ${day.orders ? "cursor-pointer hover:bg-indigo-50/40" : ""} ${openDay === day.day ? "lg:sticky lg:z-[4] bg-indigo-50 shadow-[0_6px_14px_-10px_rgba(79,70,229,0.5)] dark:bg-indigo-500/15 [&>td]:bg-indigo-50 dark:[&>td]:bg-transparent" : ""}`}>
                            <td>{day.orders ? <ChevronRight className={`h-3.5 w-3.5 text-gray-400 transition-transform ${openDay === day.day ? "rotate-90" : ""}`} /> : null}</td>
                            <td className="py-2 text-left">{shortDay(day.day)}{day.day === data.today ? <span className="ml-1 text-[11px] text-gray-400">(today)</span> : null}</td>
                            <td className="font-semibold">{day.orders}</td><td>{day.delivered}</td><td>{day.pending}</td><td>{day.failed}</td>
                            <td className="whitespace-nowrap">{money(day.revenue)}</td><td className="whitespace-nowrap">{money(day.spend)}</td><td className="whitespace-nowrap">{money(day.grossProfit)}</td>
                            <td className={`whitespace-nowrap font-bold ${day.netContribution >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{money(day.netContribution)}</td>
                            <td className={`font-semibold ${v.c}`}>{v.t}</td>
                          </tr>
                          {openDay === day.day ? (
                            <tr className="bg-gray-50/80 dark:bg-slate-800/30"><td colSpan={11} className="!px-3 py-3 text-left">
                              {list === "loading" || !list ? <span className="inline-flex items-center gap-2 text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading orders…</span>
                                : list.length === 0 ? <span className="text-gray-500">No order carries this campaign that day.</span>
                                : <div className="space-y-3">
                                    <p className="m-0 text-[12px] font-semibold text-gray-600 dark:text-slate-400">{list.length} order{list.length === 1 ? "" : "s"} placed {shortDay(day.day)} from this campaign{day.orders ? ` · ad cost ${money(day.spend / day.orders)} each (the day's ${money(day.spend)} shared)` : ""}</p>
                                    {list.map((o, i) => <CampaignOrderCard key={o.id} order={o} index={i} today={data.today} adCostShare={day.orders ? day.spend / day.orders : null} />)}
                                  </div>}
                            </td></tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <table className="!min-w-0 w-full text-[12.5px] [&_td]:!px-3 [&_th]:!px-3">
                  <thead className="bg-gray-50 text-gray-600 dark:bg-slate-800/60"><tr><th className="py-2 text-left">Delivered on</th><th>Deliveries</th><th>Revenue</th><th>Contribution before ads</th></tr></thead>
                  <tbody>
                    {row.deliveryDays.length === 0 ? <tr><td colSpan={4} className="py-6 text-center text-gray-500">No delivery recorded in the last 14 days.</td></tr>
                      : [...row.deliveryDays].reverse().map((day) => (
                        <tr key={day.day} className="border-t border-gray-100 text-center dark:border-slate-800"><td className="py-2 text-left">{shortDay(day.day)}</td><td className="font-semibold">{day.delivered}</td><td>{money(day.revenue)}</td><td className="font-semibold text-emerald-600">{money(day.contribution)}</td></tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="m-0 mt-2 text-[11.5px] text-gray-500">{view === "order" ? "Each day = orders placed that day and what has happened to them since; recent days still have pending orders. Open a day to see its orders." : "Each day = deliveries recorded that day, whenever the order was placed."}</p>
          </Section>

          <Section letter="D" title="Performance trends — last 14 days">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <ChartCard title="Orders vs delivered">
                <ResponsiveContainer width="100%" height="100%"><BarChart data={series} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="name" {...axis} interval={2} /><YAxis allowDecimals={false} {...axis} /><Tooltip /><Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Orders" fill="#7c3aed" radius={[3, 3, 0, 0]} /><Bar dataKey="Delivered" fill="#22c55e" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Cost per order vs break-even">
                <ResponsiveContainer width="100%" height="100%"><RLineChart data={series} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="name" {...axis} interval={2} /><YAxis {...axis} tickFormatter={short} domain={[0, (max: number) => Math.ceil(Math.max(max, T) * 1.12)]} /><Tooltip formatter={(v: any) => money(Number(v))} /><ReferenceLine y={T} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "Break-even", fontSize: 10, fill: "#ef4444", position: "insideTopRight" }} /><Line type="monotone" dataKey="CPP" stroke="#4f46e5" strokeWidth={2} dot={{ r: 2.5 }} connectNulls /></RLineChart></ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Ad spend vs contribution before ads">
                <ResponsiveContainer width="100%" height="100%"><ComposedChart data={series} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="name" {...axis} interval={2} /><YAxis {...axis} tickFormatter={short} /><Tooltip formatter={(v: any) => money(Number(v))} /><Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Spend" fill="#f59e0b" radius={[3, 3, 0, 0]} /><Line type="monotone" dataKey="Contribution" stroke="#16a34a" strokeWidth={2} dot={false} /></ComposedChart></ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Delivery rate by order day" note="Recent days are still settling">
                <ResponsiveContainer width="100%" height="100%"><RLineChart data={series} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="name" {...axis} interval={2} /><YAxis domain={[0, 100]} {...axis} unit="%" /><Tooltip formatter={(v: any) => `${v}%`} /><ReferenceLine y={70} stroke="#16a34a" strokeDasharray="4 4" /><Line type="monotone" dataKey="DR" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 2.5 }} connectNulls /></RLineChart></ResponsiveContainer>
              </ChartCard>
              <ChartCard title="Cumulative net contribution">
                <ResponsiveContainer width="100%" height="100%"><RLineChart data={series} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#eef0f3" /><XAxis dataKey="name" {...axis} interval={2} /><YAxis {...axis} tickFormatter={short} /><Tooltip formatter={(v: any) => money(Number(v))} /><ReferenceLine y={0} stroke="#94a3b8" /><Line type="monotone" dataKey="Cumulative" stroke="#16a34a" strokeWidth={2.5} dot={false} /></RLineChart></ResponsiveContainer>
              </ChartCard>
              <div className="flex flex-col justify-center rounded-xl border border-dashed border-gray-300 bg-white p-4 text-[12.5px] text-gray-600 dark:border-slate-700 dark:bg-slate-900">
                <p className="m-0 font-bold text-gray-800 dark:text-slate-200">Delivery of older orders</p>
                {row.deliveryTrend ? <p className="m-0 mt-1">Orders 23–37 days old: <b>{pct(row.deliveryTrend.older)}</b> delivered · 7–22 days old: <b>{pct(row.deliveryTrend.newer)}</b>.</p> : <p className="m-0 mt-1">Not enough older orders to compare yet.</p>}
                <p className="m-0 mt-2 text-gray-500">{full.length} full days shown; today is still running.</p>
              </div>
            </div>
          </Section>

          <Section letter="E" title="What it means">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <p className="m-0 flex items-center gap-2 font-extrabold text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />What's going well?</p>
                <ul className="m-0 mt-2 list-disc space-y-1 pl-4 text-[13px] text-gray-800 dark:text-slate-200">{row.goingWell.length ? row.goingWell.map((t) => <li key={t}>{t}</li>) : <li>Nothing stands out yet.</li>}</ul>
              </div>
              <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 dark:border-rose-500/30 dark:bg-rose-500/10">
                <p className="m-0 flex items-center gap-2 font-extrabold text-rose-800 dark:text-rose-300"><AlertTriangle className="h-4 w-4" />What's going wrong?</p>
                <ul className="m-0 mt-2 list-disc space-y-1 pl-4 text-[13px] text-gray-800 dark:text-slate-200">{row.goingWrong.length ? row.goingWrong.map((t) => <li key={t}>{t}</li>) : <li>Nothing worrying right now.</li>}</ul>
              </div>
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
                <p className="m-0 flex items-center gap-2 font-extrabold text-indigo-800 dark:text-indigo-300"><Compass className="h-4 w-4" />What should we do?</p>
                <p className="m-0 mt-2 text-[13px] text-gray-800 dark:text-slate-200">{row.action}</p>
                <p className="m-0 mt-1.5 text-[12px] text-gray-600 dark:text-slate-400">Watch: {row.monitor}</p>
              </div>
            </div>
          </Section>
        </div>
        </StickyCtx.Provider>
      </div>
    </div>,
    document.body
  );
}
