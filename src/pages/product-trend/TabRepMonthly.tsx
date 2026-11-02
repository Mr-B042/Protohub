import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { productPerformanceApi, type RepMonthStat, type RepMonthly, type RepVerdict } from "../../lib/api";
import { Delta, nf } from "./parts";

/**
 * Monthly Performance › Sales reps (Bright, 2 Nov 2026; design approved from
 * the preview). Who brings the company the most money, who needs teaching,
 * who should be reviewed. Rules and maths: backend lib/rep-monthly.ts.
 */

const VERDICTS: Record<RepVerdict, { label: string; rule: string; stripe: string; pill: string; dot: string; card: string; text: string }> = {
  star: { label: "Star", rule: "In the top half on money after their pay AND delivery rate 65% or higher. Keep them on the best leads.", stripe: "bg-emerald-600", pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", dot: "bg-emerald-600", card: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-300" },
  solid: { label: "Solid", rule: "Making money for the company, delivery rate 60% or more. Steady; push one thing to reach Star.", stripe: "bg-cyan-700", pill: "bg-cyan-50 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300", dot: "bg-cyan-700", card: "bg-cyan-50 dark:bg-cyan-500/10", text: "text-cyan-800 dark:text-cyan-300" },
  coach: { label: "Coach", rule: "Delivery rate 55–59%, or upsell + cross-sell under half the team's rate. Teach them.", stripe: "bg-blue-600", pill: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300", dot: "bg-blue-600", card: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-700 dark:text-blue-300" },
  watch: { label: "Watch", rule: "Delivery rate under 55%, or the bottom quarter of the team on money. Set a target for next month.", stripe: "bg-amber-600", pill: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", dot: "bg-amber-600", card: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-800 dark:text-amber-300" },
  review: { label: "Review to let go", rule: "Watch two months running, or 12+ late order sends or 20+ missed follow-ups in the month.", stripe: "bg-rose-600", pill: "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300", dot: "bg-rose-600", card: "bg-rose-50 dark:bg-rose-500/10", text: "text-rose-700 dark:text-rose-300" },
  new: { label: "Too new", rule: "Fewer than 10 orders in the month. Not judged yet.", stripe: "bg-gray-400", pill: "bg-gray-100 text-gray-600 dark:bg-slate-700/60 dark:text-slate-300", dot: "bg-gray-400", card: "bg-gray-100 dark:bg-slate-800", text: "text-gray-600 dark:text-slate-300" }
};
const ORDER: RepVerdict[] = ["star", "solid", "coach", "watch", "review", "new"];
const AVATAR = ["#2563eb", "#0e7490", "#7c3aed", "#b45309", "#be123c", "#15803d", "#a21caf", "#0f766e"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longMonth = (key: string) => `${MONTH_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const shortMonth = (key: string) => MONTH_LONG[Number(key.slice(5, 7)) - 1].slice(0, 3);
const shiftMonth = (key: string, by: number) => {
  const index = Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1 + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};
const lastDay = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).getUTCDate();
const rate1 = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);
const pct = (part: number, whole: number) => (whole ? (part / whole) * 100 : 0);
const growth = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);
const COLS = "grid-cols-[34px_minmax(130px,1fr)_140px_52px_52px_96px_108px_84px_74px_74px_104px_124px_104px_84px]";

type Rep = RepMonthly["reps"][number];

export function RepMonthlyView({ money, switcher, startMonth }: { money: (value: number) => string; switcher: ReactNode; startMonth: string | null }) {
  const [month, setMonth] = useState<string | null>(startMonth);
  const [data, setData] = useState<RepMonthly | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<RepVerdict | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    productPerformanceApi.reps(month ?? "")
      .then((result) => { if (live) setData(result); })
      .catch((err: Error) => { if (live) setError(err.message || "Could not load the sales reps."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [month, tick]);

  const signed = (value: number) => (value < 0 ? `−${money(Math.abs(value))}` : money(value));
  const index = data ? data.months.length - 1 : 0;
  const rows = useMemo(() => (data?.reps ?? []).filter((rep) => rep.months[index]?.verdict), [data, index]);
  const shown = rows.filter((rep) => filter === "all" || rep.months[index].verdict === filter);
  const current = rows.find((rep) => rep.id === selected) ?? rows[0] ?? null;
  const colorOf = (id: string) => AVATAR[Math.max(0, (data?.reps ?? []).findIndex((rep) => rep.id === id)) % AVATAR.length];

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="flex">{switcher}</div>
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-[13px] text-gray-500 shadow-sm dark:border-slate-800">
          {error ? <><p className="m-0 text-rose-700">Could not load the sales reps: {error}</p><button type="button" onClick={() => setTick((n) => n + 1)} className="!min-h-0 mt-3 rounded-lg border border-gray-300 px-3 py-1.5 font-semibold">Try again</button></>
            : <><Loader2 className="mx-auto h-5 w-5 animate-spin" /><p className="m-0 mt-2">Working out each rep's month (bonuses take a moment)…</p></>}
        </div>
      </div>
    );
  }

  const isOpen = data.month === data.thisMonth;
  const prevName = longMonth(shiftMonth(data.month, -1));
  const team = (i: number) => {
    const list = data.reps.map((rep) => rep.months[i]).filter(Boolean);
    const sum = (f: (s: RepMonthStat) => number) => list.reduce((t, s) => t + f(s), 0);
    const orders = sum((s) => s.orders), delivered = sum((s) => s.delivered), revenue = sum((s) => s.revenue);
    return {
      orders, delivered, revenue, aov: delivered ? revenue / delivered : 0, ups: sum((s) => s.upsells), xs: sum((s) => s.crossSells),
      pay: sum((s) => s.pay), money: sum((s) => s.money), late: sum((s) => s.lateSends), missed: sum((s) => s.missedFollowUps)
    };
  };
  const now = team(index), before = index > 0 ? team(index - 1) : null;
  const counts = Object.fromEntries(ORDER.map((key) => [key, rows.filter((rep) => rep.months[index].verdict === key).length])) as Record<RepVerdict, number>;
  const tiles = [
    { label: "Delivered revenue", value: money(now.revenue), delta: before ? growth(now.revenue, before.revenue) : null, points: false },
    { label: "Delivered orders", value: `${nf(now.delivered)} of ${nf(now.orders)}`, delta: before ? growth(now.delivered, before.delivered) : null, points: false },
    { label: "Average order value", value: money(now.aov), delta: before ? growth(now.aov, before.aov) : null, points: false },
    { label: "Upsell rate", value: rate1(pct(now.ups, now.orders)), delta: before ? pct(now.ups, now.orders) - pct(before.ups, before.orders) : null, points: true },
    { label: "Cross-sell rate", value: rate1(pct(now.xs, now.orders)), delta: before ? pct(now.xs, now.orders) - pct(before.xs, before.orders) : null, points: true },
    { label: "Money after their pay", value: signed(now.money), delta: before && before.money > 0 ? growth(now.money, before.money) : null, points: false }
  ];

  return (
    <div className="space-y-4">
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
      {data.bonusRulesUnavailable && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">The newer bonus rules could not be read just now, so bonuses here only include the per-product bonus. Reload in a minute.</div>}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm dark:border-slate-800">
            <div className="text-[13px] font-semibold text-gray-500 dark:text-slate-400">{tile.label}</div>
            <div className={`mt-1 text-[22px] font-extrabold tracking-tight tabular-nums ${tile.label === "Money after their pay" && now.money < 0 ? "text-rose-600" : "text-gray-900 dark:text-slate-50"}`}>{tile.value}</div>
            <div className="mt-1 flex items-center gap-1 text-[12px] text-gray-500 dark:text-slate-400"><Delta value={tile.delta} points={tile.points} /><span>vs {prevName.split(" ")[0]}</span></div>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-2" aria-label="Filter by verdict">
        <span className="mr-1 text-[13px] font-semibold text-gray-500 dark:text-slate-400">Verdicts</span>
        <Chip on={filter === "all"} onClick={() => setFilter("all")}>All reps <span className="tabular-nums">{rows.length}</span></Chip>
        {ORDER.map((key) => <Chip key={key} on={filter === key} onClick={() => setFilter(key)}><span className={`h-2 w-2 rounded-full ${VERDICTS[key].dot}`} />{VERDICTS[key].label} <span className="tabular-nums">{counts[key]}</span></Chip>)}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3.5 dark:border-slate-800">
          <h2 className="m-0 text-[16px] font-extrabold">Who brings in the most money · {longMonth(data.month).split(" ")[0]}{isOpen ? " so far" : ""}</h2>
          <span className="text-[13px] text-gray-500 dark:text-slate-400">Ranked by money after their pay. Click a rep for the full breakdown.</span>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1430px]">
            <div className={`grid ${COLS} items-center gap-2.5 bg-gray-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800/60 dark:text-slate-400`}>
              <span>#</span><span>Sales rep</span><span>Verdict</span><span>Orders</span><span>Deliv.</span><span>Delivery rate</span><span>Delivered revenue</span><span>AOV</span><span>Upsell</span><span>Cross-sell</span><span>Their pay</span><span>Money after their pay</span><span>Discipline</span><span>6 months</span>
            </div>
            {shown.length === 0 && <div className="border-t border-gray-200 px-4 py-6 text-[13px] text-gray-500 dark:border-slate-800">{rows.length === 0 ? "No sales rep had orders this month." : "No rep has this verdict this month."}</div>}
            {shown.map((rep) => {
              const s = rep.months[index];
              const v = VERDICTS[s.verdict!];
              const rate = s.rate ?? 0;
              return (
                <div key={rep.id} role="button" tabIndex={0} onClick={() => setSelected(rep.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(rep.id); } }}
                  className={`relative grid ${COLS} cursor-pointer items-center gap-2.5 border-t border-gray-200 px-4 py-3 dark:border-slate-800 ${current?.id === rep.id ? "bg-blue-50/70 dark:bg-blue-500/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/50"}`}>
                  <span className={`absolute inset-y-0 left-0 w-1 ${v.stripe}`} />
                  <span className={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border text-[13px] font-extrabold ${s.rank === 1 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800"}`}>{s.rank ?? "–"}</span>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-extrabold text-white" style={{ background: colorOf(rep.id) }}>{rep.name.slice(0, 1)}</span>
                    <span className="min-w-0"><b className="block truncate text-[14px]">{rep.name}</b>{!rep.active && <small className="text-[11.5px] text-gray-500">No longer active</small>}</span>
                  </span>
                  <span>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-extrabold ${v.pill}`}>{v.label}</span>
                    <span className="mt-1 block text-[11.5px] leading-snug text-gray-500 dark:text-slate-400">{s.reason}</span>
                  </span>
                  <b className="text-[14px] tabular-nums">{nf(s.orders)}</b>
                  <b className="text-[14px] tabular-nums">{nf(s.delivered)}</b>
                  <span>
                    <b className="text-[14px] tabular-nums">{rate1(s.rate)}</b>
                    <span className="relative mt-1.5 block h-1.5 rounded-full bg-gray-200 dark:bg-slate-700">
                      <i className={`absolute inset-y-0 left-0 rounded-full ${rate >= 65 ? "bg-emerald-600" : rate >= 60 ? "bg-cyan-700" : rate >= 55 ? "bg-blue-600" : "bg-amber-600"}`} style={{ width: `${Math.min(rate, 100)}%` }} />
                      <u className="absolute -top-[3px] -bottom-[3px] left-[65%] w-0.5 bg-gray-700/60 dark:bg-slate-200/60" title="65% for Star" />
                    </span>
                  </span>
                  <b className="text-[14px] tabular-nums">{money(s.revenue)}</b>
                  <b className="text-[14px] tabular-nums">{s.aov === null ? "—" : money(s.aov)}</b>
                  <span className="tabular-nums"><b className="text-[14px]">{rate1(pct(s.upsells, s.orders))}</b><small className="block text-[11.5px] text-gray-500 dark:text-slate-400">{s.upsells} orders</small></span>
                  <span className="tabular-nums"><b className="text-[14px]">{rate1(pct(s.crossSells, s.orders))}</b><small className="block text-[11.5px] text-gray-500 dark:text-slate-400">{s.crossSells} orders</small></span>
                  <span className="tabular-nums"><b className="text-[14px]">{money(s.pay)}</b><small className="block text-[11.5px] text-gray-500 dark:text-slate-400">bonus {money(s.bonus)}</small></span>
                  <span className="tabular-nums"><b className={`text-[14px] ${s.money < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}`}>{signed(s.money)}</b>{s.delivered > 0 && <small className="block text-[11.5px] text-gray-500 dark:text-slate-400">{signed(s.money / s.delivered)} per delivered</small>}</span>
                  <span className="flex flex-wrap gap-1">
                    <Tag level={s.lateSends >= 12 ? "bad" : s.lateSends >= 6 ? "warn" : "ok"}>{s.lateSends} late sends</Tag>
                    <Tag level={s.missedFollowUps >= 20 ? "bad" : s.missedFollowUps >= 10 ? "warn" : "ok"}>{s.missedFollowUps} missed</Tag>
                  </span>
                  <MoneySpark values={rep.months.map((m) => m.money)} />
                </div>
              );
            })}
            {filter === "all" && rows.length > 1 && (
              <div className={`grid ${COLS} items-center gap-2.5 border-t-2 border-gray-300 bg-gray-50 px-4 py-3 text-[14px] font-extrabold tabular-nums dark:border-slate-600 dark:bg-slate-800/60`}>
                <span /><span>Team · {data.reps.length} reps</span><span />
                <span>{nf(now.orders)}</span><span>{nf(now.delivered)}</span><span>{rate1(pct(now.delivered, now.orders))}</span><span>{money(now.revenue)}</span><span>{money(now.aov)}</span>
                <span>{rate1(pct(now.ups, now.orders))}</span><span>{rate1(pct(now.xs, now.orders))}</span><span>{money(now.pay)}</span>
                <span className={now.money < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}>{signed(now.money)}</span>
                <span className="text-[12px]">{now.late} late · {now.missed} missed</span><span />
              </div>
            )}
          </div>
        </div>
      </section>

      {current && <RepDetail rep={current} index={index} data={data} money={money} signed={signed} color={colorOf(current.id)} teamRate={pct(now.delivered, now.orders)} teamAov={now.aov} teamExtra={pct(now.ups + now.xs, now.orders)} teamXs={pct(now.xs, now.orders)} />}

      <section className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800">
        <h3 className="m-0 text-[15px] font-extrabold">How the verdict is decided</h3>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
          {ORDER.map((key) => (
            <div key={key} className={`rounded-xl p-3 ${VERDICTS[key].card}`}>
              <b className={`mb-1 block text-[13px] font-extrabold ${VERDICTS[key].text}`}>{VERDICTS[key].label}</b>
              <p className="m-0 text-[12.5px] text-gray-800 dark:text-slate-200">{VERDICTS[key].rule}</p>
            </div>
          ))}
        </div>
        <p className="m-0 text-[12.5px] text-gray-500 dark:text-slate-400">
          Money after their pay = delivered revenue − product cost − delivery fees − their bonus − their salary for the month. Bonus = both bonus systems, as Marketing Performance takes them out. Salary = their current monthly salary in Pay Rates, counted for months they had orders. Ad spend and office costs are shared by the whole team, so they are not split by rep. Upsell = the customer moved to a bigger package on the call; cross-sell = the rep added another product. "Top half on money" compares with the team's middle rep. Late order sends count from {new Date(`${data.lateSendsFrom}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, when they started being timed.
        </p>
      </section>
    </div>
  );
}

function RepDetail({ rep, index, data, money, signed, color, teamRate, teamAov, teamExtra, teamXs }: {
  rep: Rep; index: number; data: RepMonthly; money: (v: number) => string; signed: (v: number) => string; color: string;
  teamRate: number; teamAov: number; teamExtra: number; teamXs: number;
}) {
  const s = rep.months[index];
  const v = VERDICTS[s.verdict!];
  const ranked = rep.products.filter((p) => p.orders >= 5).sort((a, b) => b.rate - a.rate);
  const best = ranked[0] ?? null, worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  const judgedCount = data.reps.filter((r) => r.months[index].rank !== null).length;
  const kv = (pairs: Array<[string, ReactNode]>) => (
    <div className="grid grid-cols-[1fr_auto] gap-x-3.5 gap-y-2 text-[13px]">
      {pairs.map(([a, b]) => <Fragment key={a}><span className="text-gray-500 dark:text-slate-400">{a}</span><b className="text-right tabular-nums">{b}</b></Fragment>)}
    </div>
  );
  const team = (text: string) => <small className="ml-1 font-medium text-gray-500 dark:text-slate-400">{text}</small>;
  const advice = adviceFor(rep, index, money, signed, { teamRate, teamXs, worst, judgedCount });
  const card = "space-y-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800";
  const th = "whitespace-nowrap border-b border-gray-200 px-2 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:border-slate-800 dark:text-slate-400";
  const td = "whitespace-nowrap border-b border-gray-200 px-2 py-2.5 text-right tabular-nums dark:border-slate-800";
  return (
    <section className="space-y-3.5" aria-label="Selected rep">
      <div className="flex flex-wrap items-center gap-3.5 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800">
        <span className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full text-[20px] font-extrabold text-white" style={{ background: color }}>{rep.name.slice(0, 1)}</span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[20px] font-extrabold">{rep.name} · {longMonth(s.month)}</h3>
          <p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">{s.rank ? `Rank ${s.rank} of ${judgedCount} on money after pay · ` : ""}{s.reason}</p>
        </div>
        <span className={`inline-flex rounded-full px-3 py-1 text-[12.5px] font-extrabold ${v.pill}`}>{v.label}</span>
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-3">
        <div className={card}><h4 className="m-0 text-[15px] font-extrabold">Money</h4>{kv([
          ["Orders / delivered", `${nf(s.orders)} / ${nf(s.delivered)}`],
          ["Delivery rate", <>{rate1(s.rate)}{team(`team ${rate1(teamRate)}`)}</>],
          ["Delivered revenue", money(s.revenue)],
          ["Average order value", <>{s.aov === null ? "—" : money(s.aov)}{team(`team ${money(teamAov)}`)}</>],
          ["Product cost + delivery", money(s.productCost + s.deliveryFees)],
          ["Their pay", <>{money(s.pay)}{team(`salary ${money(s.salary)} + bonus ${money(s.bonus)}`)}</>],
          ["Money after their pay", <span className={s.money < 0 ? "text-rose-600" : "text-emerald-700 dark:text-emerald-400"}>{signed(s.money)}</span>]
        ])}</div>
        <div className={card}><h4 className="m-0 text-[15px] font-extrabold">Upsell &amp; cross-sell</h4>{kv([
          ["Upsell orders", `${s.upsells} (${rate1(pct(s.upsells, s.orders))})`],
          ["Upsell value added (delivered)", money(s.upsellValue)],
          ["Best upsell", rep.bestUpsell ? `${rep.bestUpsell.name} (${rep.bestUpsell.count}×)` : "—"],
          ["Cross-sell orders", `${s.crossSells} (${rate1(pct(s.crossSells, s.orders))})`],
          ["Cross-sell value added (delivered)", money(s.crossSellValue)],
          ["Most added product", rep.topCrossSell ? `${rep.topCrossSell.name} (${rep.topCrossSell.count}×)` : "—"],
          ["Upsell + cross-sell vs team", `${rate1(s.extraRate)} vs ${rate1(teamExtra)}`]
        ])}</div>
        <div className={card}><h4 className="m-0 text-[15px] font-extrabold">Discipline &amp; speed</h4>{kv([
          ["Late order sends", <span className={s.lateSends >= 12 ? "text-rose-600" : ""}>{s.lateSends}</span>],
          ["Missed follow-ups", <span className={s.missedFollowUps >= 20 ? "text-rose-600" : ""}>{s.missedFollowUps}</span>],
          ["Fines this month", money(s.fines)],
          ["Carts handed to them", nf(s.carts.handed)],
          ["Carts turned into orders", `${s.carts.converted} of ${s.carts.handed} (${rate1(pct(s.carts.converted, s.carts.handed))})`],
          ["Failed + cancelled orders", nf(s.orders - s.delivered)]
        ])}</div>
      </div>

      <div className={card}>
        <div><h4 className="m-0 text-[15px] font-extrabold">Product by product</h4><p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">Where this rep sells well and where they lose orders. Money here is before salary (salary is not split by product).</p></div>
        {best && (
          <div className="flex flex-wrap gap-2.5">
            <div className="min-w-[200px] flex-1 rounded-xl bg-emerald-50 px-3 py-2.5 dark:bg-emerald-500/10"><small className="text-[12px] text-gray-500">Best product</small><b className="block text-[14px]">{best.name}</b><small className="text-[12px] text-gray-500">{rate1(best.rate)} delivered · {signed(best.moneyBeforeSalary)}</small></div>
            {worst && worst !== best && <div className="min-w-[200px] flex-1 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-500/10"><small className="text-[12px] text-gray-500">Weakest product</small><b className="block text-[14px]">{worst.name}</b><small className="text-[12px] text-gray-500">{rate1(worst.rate)} delivered · {worst.orders - worst.delivered} orders lost</small></div>}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full border-collapse text-[13px]">
            <thead><tr><th className={`${th} !text-left`}>Product</th><th className={th}>Orders</th><th className={th}>Delivered</th><th className={th}>Rate</th><th className={th}>Revenue</th><th className={th}>AOV</th><th className={th}>Upsells</th><th className={th}>Cross-sells</th><th className={th}>Money before salary</th></tr></thead>
            <tbody>
              {rep.products.length === 0 && <tr><td colSpan={9} className={`${td} !text-left text-gray-400`}>No orders this month.</td></tr>}
              {rep.products.map((p) => (
                <tr key={p.productId ?? p.name}>
                  <td className={`${td} !text-left`}>{p.name}</td><td className={td}>{nf(p.orders)}</td><td className={td}>{nf(p.delivered)}</td>
                  <td className={`${td} ${p.rate < 55 && p.orders >= 5 ? "text-rose-600" : ""}`}>{rate1(p.rate)}</td><td className={td}>{money(p.revenue)}</td>
                  <td className={td}>{p.aov === null ? "—" : money(p.aov)}</td><td className={td}>{p.upsells}</td><td className={td}>{p.crossSells}</td>
                  <td className={`${td} ${p.moneyBeforeSalary < 0 ? "text-rose-600" : ""}`}>{signed(p.moneyBeforeSalary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className={card}>
          <h4 className="m-0 text-[15px] font-extrabold">What to do with this rep</h4>
          <ol className="m-0 grid list-none gap-2.5 p-0">
            {advice.map((line, i) => (
              <li key={i} className="grid grid-cols-[26px_1fr] items-start gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 text-[13px] dark:bg-slate-800/60">
                <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-lg border border-gray-200 bg-white text-[12px] font-extrabold dark:border-slate-700 dark:bg-slate-900">{i + 1}</span><span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className={card}>
          <div><h4 className="m-0 text-[15px] font-extrabold">Carts handed to them</h4><p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">Abandoned carts the rotation gave this rep this month.</p></div>
          {s.carts.handed === 0 ? <p className="m-0 text-[13px] text-gray-400">No carts this month.</p> : (
            <div className="grid gap-2">
              {([["Carts handed", s.carts.handed], ["Called", s.carts.called], ["Interested", s.carts.interested], ["Became orders", s.carts.converted]] as Array<[string, number]>).map(([label, n]) => (
                <div key={label} className="grid grid-cols-[110px_1fr_48px] items-center gap-2.5 text-[13px]">
                  <span>{label}</span><span className="h-5 rounded-md bg-[#1F8FE0]/85" style={{ width: `${Math.max(2, (n / s.carts.handed) * 100)}%` }} /><b className="tabular-nums">{n}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={card}>
        <div><h4 className="m-0 text-[15px] font-extrabold">Month by month</h4><p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">Each month's verdict on its own. Watch two months running turns to Review to let go.</p></div>
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full border-collapse text-[13px]">
            <thead><tr>{["Month", "Orders", "Delivered", "Rate", "Revenue", "AOV", "Their pay", "After pay", "Late sends", "Missed", "Verdict"].map((h, i) => <th key={h} className={`${th} ${i === 0 ? "!text-left" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>
              {[...rep.months].reverse().map((m) => {
                const cur = m.month === data.month;
                const cell = `${td} ${cur ? "bg-blue-50/70 font-bold dark:bg-blue-500/10" : ""}`;
                return m.verdict === null ? (
                  <tr key={m.month}><td className={`${cell} !text-left`}>{longMonth(m.month)}</td><td colSpan={10} className={`${cell} !text-left text-gray-400`}>No orders</td></tr>
                ) : (
                  <tr key={m.month}>
                    <td className={`${cell} !text-left`}>{longMonth(m.month)}{cur && data.month === data.thisMonth ? " (so far)" : ""}</td>
                    <td className={cell}>{nf(m.orders)}</td><td className={cell}>{nf(m.delivered)}</td><td className={cell}>{rate1(m.rate)}</td>
                    <td className={cell}>{money(m.revenue)}</td><td className={cell}>{m.aov === null ? "—" : money(m.aov)}</td><td className={cell}>{money(m.pay)}</td>
                    <td className={`${cell} ${m.money < 0 ? "text-rose-600" : ""}`}>{signed(m.money)}</td><td className={cell}>{m.lateSends}</td><td className={cell}>{m.missedFollowUps}</td>
                    <td className={cell}><span className={`inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-extrabold ${VERDICTS[m.verdict].pill}`}>{VERDICTS[m.verdict].label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Three plain next steps from the rep's own month. */
function adviceFor(rep: Rep, index: number, money: (v: number) => string, signed: (v: number) => string,
  ctx: { teamRate: number; teamXs: number; worst: Rep["products"][number] | null; judgedCount: number }): string[] {
  const s = rep.months[index];
  const rate = s.rate ?? 0;
  const worst = ctx.worst;
  const lost = worst ? `${worst.name} is where most orders are lost (${worst.orders - worst.delivered} of ${worst.orders}, ${rate1(worst.rate)} delivered).` : null;
  const lines: Array<string | null> = [];
  switch (s.verdict) {
    case "star":
      lines.push(`Top earner: ${signed(s.money)} after their pay. Give them first pick of new leads.`);
      lines.push(`Ask ${rep.name} to show the team how they sell${pct(s.crossSells, s.orders) > ctx.teamXs ? ` and cross-sell (${rate1(pct(s.crossSells, s.orders))} of orders vs team ${rate1(ctx.teamXs)})` : ""}.`);
      lines.push(worst ? `Keep an eye on ${worst.name}: ${rate1(worst.rate)} delivered.` : null);
      break;
    case "solid":
      lines.push(rate < 65 ? `${(65 - rate).toFixed(1)} points of delivery rate from Star.` : "Delivery rate is there; more money after pay moves them to Star.");
      lines.push(lost ? `${lost} Listen to 3 of their calls on it.` : null);
      lines.push(`${s.upsells} upsells and ${s.crossSells} cross-sells this month. Ask for one more of each a week.`);
      break;
    case "coach":
      lines.push(rate < 60 ? `Delivery rate ${rate1(rate)} against the team's ${rate1(ctx.teamRate)}. Teach confirming the address and delivery day on the first call.` : `Upsell + cross-sell is ${rate1(s.extraRate)}, under half the team's. Practise the upgrade pitch with them.`);
      lines.push(lost ? `${lost} Pair them with the Star rep for a week.` : null);
      lines.push("Target for next month: 60% delivery rate.");
      break;
    case "watch":
      lines.push(`Delivery rate ${rate1(rate)}${s.rank ? `, rank ${s.rank} of ${ctx.judgedCount} on money` : ""}. Set a written target for next month.`);
      lines.push(`${s.lateSends} late sends and ${s.missedFollowUps} missed follow-ups. Check their daily log every evening.`);
      lines.push("If next month is also Watch, the verdict turns to Review to let go.");
      break;
    case "review":
      lines.push(`${signed(s.money)} after their pay${s.rank ? `, rank ${s.rank} of ${ctx.judgedCount}` : ""}.`);
      lines.push(`${s.lateSends} late order sends and ${s.missedFollowUps} missed follow-ups this month (${money(s.fines)} in fines).`);
      lines.push(`${s.carts.handed ? `${s.carts.converted} of ${s.carts.handed} carts became orders. ` : ""}Hold a review meeting: improve in 30 days, or let go.`);
      break;
    case "new":
      lines.push(`Only ${s.orders} order${s.orders === 1 ? "" : "s"} this month. Judged from 10.`);
      lines.push(s.orders > 0 ? `${rate1(rate)} delivered so far.` : null);
      break;
  }
  return lines.filter((line): line is string => Boolean(line)).slice(0, 3);
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`!min-h-0 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-[13px] font-bold dark:bg-slate-900 ${on ? "border-gray-900 ring-1 ring-gray-900 dark:border-slate-100 dark:ring-slate-100" : "border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
      {children}
    </button>
  );
}

function Tag({ level, children }: { level: "ok" | "warn" | "bad"; children: ReactNode }) {
  const tone = level === "bad" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : level === "warn" ? "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300";
  return <span className={`whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-bold ${tone}`}>{children}</span>;
}

function MoneySpark({ values }: { values: number[] }) {
  const w = 84, h = 28;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const x = (i: number) => 3 + (i * (w - 6)) / Math.max(values.length - 1, 1);
  const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1];
  const color = last < 0 ? "#e11d48" : "#1F8FE0";
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Money after their pay, last 6 months" className="block">
      <polygon points={`${x(0)},${h} ${pts} ${x(values.length - 1)},${h}`} fill={color} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={3} fill={color} />
    </svg>
  );
}
