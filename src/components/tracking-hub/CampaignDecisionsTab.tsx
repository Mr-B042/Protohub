import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AlertOctagon, ArrowDown, ArrowUp, BarChart3, CalendarDays, ChevronDown, ChevronRight, Coins, Download, Eye, Info, Lightbulb, Loader2, PauseCircle, RefreshCw, ShoppingBasket, Target, ThumbsUp, TrendingUp, Truck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { trackingHubApi, type CampaignDecisionsView, type CampaignVerdictKind, type CdRow } from "../../lib/api";
import { money } from "../../lib/money-privacy";
import { HubHeader, LoadState, ProductThumb, shortDay, type Toast } from "./HubParts";
import CampaignDecisionDetail from "./CampaignDecisionDetail";

// Tracking Hub › Campaign Decisions (Bright, 21 Nov 2026), built to his design
// (header + period + Export, 5 money cards, 3 decision banners, filter pills +
// sort, the campaign table, then Daily Breakdown · Orders vs Delivered · Plain
// English Summary). Rules: backend lib/campaign-engine.ts (his "Complete Logic
// & Rating System"). Additions to the picture, from his write-up: Keep and Turn
// off (filter pills; Turn off also inside the Pause banner) and the score +
// confidence under each decision. A row opens the detail view (sections A-E).

type Kind = CampaignVerdictKind;
export const DECISIONS: Record<Kind, { label: string; pill: string; Icon: ComponentType<{ className?: string }> }> = {
  scale: { label: "Scale", pill: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300", Icon: TrendingUp },
  keep: { label: "Keep", pill: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300", Icon: ThumbsUp },
  watch: { label: "Watch", pill: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300", Icon: Eye },
  pause: { label: "Pause", pill: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300", Icon: PauseCircle },
  turn_off: { label: "Turn off", pill: "border-red-300 bg-red-100 text-red-800 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200", Icon: AlertOctagon }
};
const PILL_ORDER: Kind[] = ["scale", "keep", "watch", "pause", "turn_off"];
const PERIODS = [3, 7, 14, 30];
type SortKey = "net_desc" | "net_asc" | "spend_desc" | "orders_desc" | "score_desc" | "decision";
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "net_desc", label: "Net Contribution (High to Low)" }, { key: "net_asc", label: "Net Contribution (Low to High)" },
  { key: "spend_desc", label: "Spend (High to Low)" }, { key: "orders_desc", label: "Orders (High to Low)" },
  { key: "score_desc", label: "Score (High to Low)" }, { key: "decision", label: "Decision (urgent first)" }
];
const URGENT: Kind[] = ["turn_off", "pause", "watch", "scale", "keep"];
const pctText = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
export const drTone = (v: number | null) => v === null ? "bg-gray-100 text-gray-500 dark:bg-slate-800" : v >= 0.65 ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : v >= 0.5 ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
const tip = (text: string) => <span title={text} className="inline-flex cursor-help text-gray-400"><Info className="h-3.5 w-3.5" /></span>;

function Kpi({ icon, tile, title, value, info, foot, valueTone = "text-gray-900 dark:text-slate-50" }: { icon: ReactNode; tile: string; title: string; value: string; info?: string; foot?: ReactNode; valueTone?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tile}`}>{icon}</span>
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-1 text-[13.5px] font-semibold text-gray-700 dark:text-slate-300">{title}{info ? tip(info) : null}</p>
        <p className={`m-0 mt-0.5 text-[26px] font-black leading-8 tracking-tight ${valueTone}`}>{value}</p>
        {foot ? <div className="mt-0.5 text-[12px] text-gray-500 dark:text-slate-400">{foot}</div> : null}
      </div>
    </div>
  );
}

function Banner({ tone, icon, title, text, active, onClick }: { tone: string; icon: ReactNode; title: string; text: ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`!min-h-0 flex items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-shadow hover:shadow-md ${tone} ${active ? "ring-2 ring-indigo-500" : ""}`}>
      {icon}
      <span className="min-w-0"><b className="block text-[19px] font-extrabold leading-6">{title}</b><span className="mt-0.5 block text-[13px] text-gray-700 dark:text-slate-300">{text}</span></span>
    </button>
  );
}

export default function CampaignDecisionsTab({ tabBar, onToast, platform = "all" }: { tabBar: ReactNode; onToast: Toast; platform?: string }) {
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const [days, setDays] = useState(3);
  const [data, setData] = useState<CampaignDecisionsView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState<Kind | "">("");
  const [sort, setSort] = useState<SortKey>("net_desc");
  const [openId, setOpenId] = useState<string | null>(params.get("campaign"));

  useEffect(() => {
    let live = true;
    setBusy(true);
    trackingHubApi.campaignDecisions(days, platform, tick > 0)
      .then((result) => { if (live) { setData(result); setError(""); } })
      .catch((err: Error) => { if (live) setError(err.message || "Could not work out the campaign decisions."); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [days, platform, tick]);

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter((row) => !filter || row.decision === filter);
    const by: Record<SortKey, (a: CdRow, b: CdRow) => number> = {
      net_desc: (a, b) => b.period.netContribution - a.period.netContribution, net_asc: (a, b) => a.period.netContribution - b.period.netContribution,
      spend_desc: (a, b) => b.period.adSpend - a.period.adSpend, orders_desc: (a, b) => b.period.orders - a.period.orders,
      score_desc: (a, b) => b.score - a.score, decision: (a, b) => URGENT.indexOf(a.decision) - URGENT.indexOf(b.decision) || b.period.adSpend - a.period.adSpend
    };
    return [...list].sort(by[sort]);
  }, [data, filter, sort]);

  const header = (
    <HubHeader crumb="Campaign Decisions" title="Campaign Decisions" subtitle="A simple, plain English view of what to Scale, Watch, Pause or Turn Off based on real numbers." actions={
      <>
        <label className="relative flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900">
          <CalendarDays className="h-4 w-4 text-gray-600" />
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="!min-h-0 !h-auto appearance-none !border-0 bg-transparent !p-0 pr-6 text-[14px] font-semibold text-gray-800 !shadow-none outline-none dark:text-slate-200">
            {PERIODS.map((n) => <option key={n} value={n}>Last {n} Days</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-gray-500" />
        </label>
        <button type="button" onClick={() => setTick((n) => n + 1)} disabled={busy} title="Check again with Meta"
          className="!min-h-0 flex items-center gap-2 rounded-xl px-2 text-[13.5px] text-gray-700 hover:text-gray-900 disabled:opacity-60 dark:text-slate-300">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />}
          Updated: {data ? `Today, ${new Date(data.checkedAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" })}` : "…"}
          <RefreshCw className="h-3.5 w-3.5 text-gray-400" />
        </button>
        <button type="button" disabled={!data} onClick={() => data && exportCsv(data, rows)} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <Download className="h-4 w-4" />Export
        </button>
      </>
    } />
  );

  if (!data) return <div className="space-y-5">{header}{tabBar}<LoadState text="Working out each running campaign's money and decision…" error={error} onRetry={() => setTick((n) => n + 1)} /></div>;

  const t = data.totals, p = data.previousTotals;
  const change = p.orders > 0 ? Math.round(((t.orders - p.orders) / p.orders) * 100) : null;
  const count = (k: Kind) => data.rows.filter((row) => row.decision === k).length;
  const open = openId ? data.rows.find((row) => row.campaignId === openId) ?? null : null;
  const chart = data.daily.map((d) => ({ name: shortDay(d.day), Orders: d.orders, Delivered: d.delivered }));
  const dayTotal = data.daily.reduce((acc, d) => ({ orders: acc.orders + d.orders, delivered: acc.delivered + d.delivered, spend: acc.spend + d.spend, gross: acc.gross + d.grossProfit, net: acc.net + d.netContribution }), { orders: 0, delivered: 0, spend: 0, gross: 0, net: 0 });

  return (
    <div className="space-y-5">
      {header}
      {tabBar}

      {data.uncheckedAccounts.length ? (
        <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Couldn't check which campaigns are running for {data.uncheckedAccounts.map((a) => a.name).join(", ")}: {data.unchecked} campaign{data.unchecked === 1 ? " is" : "s are"} left out until Meta answers.
        </p>
      ) : null}

      {/* 5 money cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi icon={<ShoppingBasket className="h-6 w-6" />} tile="bg-violet-100 text-violet-600 dark:bg-violet-500/15" title="Total Orders" value={String(t.orders)}
          foot={<span className="flex items-center gap-2">{change !== null ? <b className={`inline-flex items-center gap-0.5 ${change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{change >= 0 ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}{Math.abs(change)}%</b> : null}(Last {data.periodDays} days)</span>} />
        <Kpi icon={<Truck className="h-6 w-6" />} tile="bg-sky-100 text-sky-600 dark:bg-sky-500/15" title="Total Delivered" value={String(t.delivered)}
          foot={<span className="flex items-center gap-1"><b className="text-gray-800 dark:text-slate-200">DR: {pctText(t.deliveryRate)}</b>{tip(`Of the ${t.orders} orders placed in these days, ${t.delivered} are delivered so far and ${t.pending} are still on the way. Young orders read low until they settle.`)}</span>} />
        <Kpi icon={<Coins className="h-6 w-6" />} tile="bg-amber-100 text-amber-600 dark:bg-amber-500/15" title="Total Ad Spend" value={money(t.adSpend)} foot={t.costPerOrder !== null ? `${money(t.costPerOrder)} an order` : undefined} />
        <Kpi icon={<BarChart3 className="h-6 w-6" />} tile="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15" title="Gross Profit" value={money(t.grossProfit)} valueTone="text-emerald-600 dark:text-emerald-400"
          info="Delivered orders' sales minus their product cost. Ads, delivery and bonuses are not taken off yet." foot="(Delivered sales − product cost)" />
        <Kpi icon={<Target className="h-6 w-6" />} tile="bg-rose-100 text-rose-600 dark:bg-rose-500/15" title="Net Contribution" value={money(t.netContribution)} valueTone={t.netContribution >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}
          info="Gross profit minus delivery fees, rep bonuses, failed-delivery fees and ad spend. Not the company's final profit: salaries and running costs are not in it."
          foot={<>(Profit after ad spend){t.pending ? <span className="block text-gray-400">{money(t.expectedFinal)} expected once {t.pending} pending settle</span> : null}</>} />
      </div>

      {/* 3 decision banners */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Banner active={filter === "scale"} onClick={() => setFilter(filter === "scale" ? "" : "scale")} tone="border-emerald-100 bg-gradient-to-r from-emerald-50 to-emerald-50/40 text-emerald-800 dark:border-emerald-500/20 dark:from-emerald-500/10 dark:to-transparent dark:text-emerald-300"
          icon={<span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white"><TrendingUp className="h-6 w-6" /></span>}
          title={`Scale – ${count("scale")} Campaign${count("scale") === 1 ? "" : "s"}`} text="Performing well below break-even with good delivery." />
        <Banner active={filter === "watch"} onClick={() => setFilter(filter === "watch" ? "" : "watch")} tone="border-amber-100 bg-gradient-to-r from-amber-50 to-amber-50/40 text-amber-800 dark:border-amber-500/20 dark:from-amber-500/10 dark:to-transparent dark:text-amber-300"
          icon={<span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-white"><Eye className="h-6 w-6" /></span>}
          title={`Watch – ${count("watch")} Campaign${count("watch") === 1 ? "" : "s"}`} text="Close to break-even. Keep running with caution." />
        <Banner active={filter === "pause"} onClick={() => setFilter(filter === "pause" ? "" : "pause")} tone="border-rose-100 bg-gradient-to-r from-rose-50 to-rose-50/40 text-rose-800 dark:border-rose-500/20 dark:from-rose-500/10 dark:to-transparent dark:text-rose-300"
          icon={<span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white"><PauseCircle className="h-6 w-6" /></span>}
          title={`Pause – ${count("pause")} Campaign${count("pause") === 1 ? "" : "s"}`}
          text={<>Losing money. Pause, fix and test again.{count("turn_off") ? <b className="ml-1 text-red-700">+ {count("turn_off")} to turn off</b> : null}</>} />
      </div>

      {/* Filter pills + sort */}
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="button" onClick={() => setFilter("")} className={`!min-h-0 rounded-xl px-5 py-2.5 text-[14px] font-semibold ${filter === "" ? "bg-indigo-600 text-white shadow-sm" : "border border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>All Campaigns ({data.rows.length})</button>
        {PILL_ORDER.map((k) => {
          const d = DECISIONS[k];
          return (
            <button key={k} type="button" onClick={() => setFilter(filter === k ? "" : k)} className={`!min-h-0 inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] font-semibold ${d.pill} ${filter === k ? "ring-2 ring-indigo-500" : ""}`}>
              <d.Icon className="h-4 w-4" />{d.label} ({count(k)})
            </button>
          );
        })}
        <label className="relative ml-auto flex items-center rounded-xl border border-gray-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900">
          <span className="text-[13.5px] text-gray-700 dark:text-slate-300">Sort by:&nbsp;</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} className="!min-h-0 !h-auto appearance-none !border-0 bg-transparent !p-0 pr-7 text-[13.5px] font-semibold text-gray-800 !shadow-none outline-none dark:text-slate-200">
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 h-4 w-4 text-gray-500" />
        </label>
      </div>

      {/* Campaign table */}
      <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <table className="!min-w-[980px] w-full text-left text-[13px] [&_td]:!px-3 [&_th]:!px-3">
          <thead className="bg-gray-50 text-[13px] font-semibold text-gray-700 dark:bg-slate-800/60 dark:text-slate-300">
            <tr>
              <th className="py-3">Campaign (Product)</th><th>Spend</th><th>Orders</th><th>Delivered</th><th>DR</th>
              <th><span className="inline-flex items-center gap-1">CPP {tip("Cost per order: ad spend ÷ orders placed")}</span></th>
              <th>Gross Profit</th><th>Net Contribution</th><th className="text-center">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="py-10 text-center text-gray-500">{data.rows.length ? "No campaign has this decision right now." : "No campaign is running right now."}</td></tr>
            ) : rows.map((row) => {
              const d = DECISIONS[row.decision];
              return (
                <tr key={row.campaignId} onClick={() => setOpenId(row.campaignId)} className="cursor-pointer border-t border-gray-100 text-gray-800 transition-colors hover:bg-indigo-50/40 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800/40 [&>td]:[color:inherit]">
                  <td className="py-2.5">
                    <span className="flex items-center gap-3">
                      <ProductThumb src={row.productImage} size={44} />
                      <span className="min-w-0">
                        <b className="block max-w-[260px] truncate text-[13.5px]" title={row.campaignName}>{row.campaignName}</b>
                        <span className="block truncate text-[12px] text-gray-500">{row.productName ?? "Product not known"}{row.platform === "tiktok" ? " · TikTok" : ""}</span>
                        <span className="mt-0.5 inline-block rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">{row.accountName}</span>
                      </span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap font-semibold">{money(row.period.adSpend)}</td>
                  <td className="font-semibold">{row.period.orders}</td>
                  <td className="font-semibold">{row.period.delivered}{row.period.pending ? <span className="block text-[11px] font-normal text-gray-400">{row.period.pending} pending</span> : null}</td>
                  <td><span className={`inline-block rounded-lg px-2.5 py-1 text-[12.5px] font-bold ${drTone(row.period.deliveryRate)}`}>{pctText(row.period.deliveryRate)}</span></td>
                  <td className="whitespace-nowrap">{row.period.costPerOrder !== null ? money(row.period.costPerOrder) : "—"}</td>
                  <td className="whitespace-nowrap">{money(row.period.grossProfit)}</td>
                  <td className={`whitespace-nowrap text-[15px] font-extrabold ${row.period.netContribution >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>
                    {money(row.period.netContribution)}
                    {/* Pay on delivery: young orders are pending, so the real figure reads low. The projection sits apart. */}
                    {row.period.pending ? <span className={`block text-[11px] font-semibold ${row.period.expectedFinal >= 0 ? "text-emerald-600/80" : "text-rose-500/80"}`} title={`Once the ${row.period.pending} pending order${row.period.pending === 1 ? "" : "s"} settle at ${row.matureRate === null ? "the usual" : `${Math.round(row.matureRate * 100)}%`} delivery`}>{money(row.period.expectedFinal)} expected</span> : null}
                  </td>
                  <td className="text-center">
                    <button type="button" onClick={(event) => { event.stopPropagation(); setOpenId(row.campaignId); }} className={`!min-h-0 inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[14px] font-bold ${d.pill}`}>
                      <d.Icon className="h-4 w-4" />{d.label}<ChevronRight className="h-4 w-4" />
                    </button>
                    <span className="mt-1 block whitespace-nowrap text-[11px] text-gray-500">Score {row.score} · {row.confidence[0].toUpperCase()}{row.confidence.slice(1)} confidence</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="m-0 -mt-2 text-[12px] text-gray-500 dark:text-slate-400">
        Money columns: orders placed in the last {data.periodDays} full days and what has happened to them so far (pending orders are not counted as sales). Decisions don't move with this period: they read the last 3 and 7 days, orders old enough to judge delivery, and the campaign's whole life.
        {data.bonusesPartial ? " Some rep bonuses could not be read, so contribution reads a little high." : ""}
      </p>

      {/* Daily breakdown · chart · plain English */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_1fr_1.1fr]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="m-0 mb-3 flex items-center gap-2 text-[17px] font-extrabold text-gray-900 dark:text-slate-50"><CalendarDays className="h-5 w-5 text-indigo-600" />Daily Breakdown <span className="font-semibold text-gray-600">(All Campaigns)</span></h3>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full text-[12.5px] [&_td]:!px-2 [&_th]:!px-2">
              <thead className="bg-gray-50 text-[12px] text-gray-700 dark:bg-slate-800/60 dark:text-slate-300">
                <tr><th className="py-2 text-left">Date</th><th>Orders</th><th>Delivered</th><th>DR</th><th>Ad Spend</th><th>Gross Profit</th><th>Net Contribution</th></tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr key={d.day} className="border-t border-gray-100 text-center text-gray-800 dark:border-slate-800 dark:text-slate-200 [&>td]:[color:inherit]">
                    <td className="py-2 text-left">{shortDay(d.day)}</td><td>{d.orders}</td><td>{d.delivered}</td>
                    <td><span className={`inline-block rounded px-1.5 py-0.5 font-bold ${drTone(d.deliveryRate)}`}>{pctText(d.deliveryRate)}</span></td>
                    <td className="whitespace-nowrap">{money(d.spend)}</td><td className="whitespace-nowrap">{money(d.grossProfit)}</td>
                    <td className={`whitespace-nowrap font-bold ${d.netContribution >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{money(d.netContribution)}</td>
                  </tr>
                ))}
                <tr className="bg-indigo-600 text-center font-bold text-white [&>td]:[color:inherit]">
                  <td className="rounded-l-lg py-2.5 text-left">Total ({data.periodDays} Days)</td><td>{dayTotal.orders}</td><td>{dayTotal.delivered}</td>
                  <td>{dayTotal.orders ? pctText(dayTotal.delivered / dayTotal.orders) : "—"}</td>
                  <td className="whitespace-nowrap">{money(dayTotal.spend)}</td><td className="whitespace-nowrap">{money(dayTotal.gross)}</td><td className="whitespace-nowrap rounded-r-lg">{money(dayTotal.net)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="m-0 mb-2 text-[17px] font-extrabold text-gray-900 dark:text-slate-50">Orders vs Delivered (Daily)</h3>
          <div className="h-[230px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 18, right: 6, left: -18, bottom: 0 }} barGap={4}>
                <CartesianGrid vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip cursor={{ fill: "rgba(99,102,241,0.06)" }} />
                <Legend verticalAlign="top" align="right" iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12, paddingBottom: 6 }} />
                <Bar dataKey="Orders" fill="#7c3aed" radius={[5, 5, 0, 0]} maxBarSize={38}><LabelList dataKey="Orders" position="top" fontSize={11} fontWeight={700} /></Bar>
                <Bar dataKey="Delivered" fill="#22c55e" radius={[5, 5, 0, 0]} maxBarSize={38}><LabelList dataKey="Delivered" position="top" fontSize={11} fontWeight={700} /></Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="m-0 mb-3 flex items-center gap-2 text-[17px] font-extrabold text-gray-900 dark:text-slate-50"><Lightbulb className="h-5 w-5 text-amber-400" />Plain English Summary</h3>
          <PlainSummary rows={data.rows} rules={data.rules} />
        </section>
      </div>

      {open ? <CampaignDecisionDetail row={open} data={data} onClose={() => setOpenId(null)} onToast={onToast} /> : null}
    </div>
  );
}

function PlainSummary({ rows, rules }: { rows: CdRow[]; rules: CampaignDecisionsView["rules"] }) {
  const of = (k: Kind) => rows.filter((row) => row.decision === k);
  const names = (list: CdRow[]) => list.slice(0, 2).map((row) => row.campaignName).join(", ") + (list.length > 2 ? ` and ${list.length - 2} more` : "");
  const lines: Array<{ k: Kind; text: string }> = [];
  if (of("scale").length) lines.push({ k: "scale", text: `${of("scale").length === 1 ? "This campaign is" : `These ${of("scale").length} campaigns are`} making money with good delivery (${Math.round(rules.scaleDeliveryRate * 100)}%+) at ${Math.round(rules.scaleCpoAtMost * 100)}% of break-even or less. Add budget slowly: ${names(of("scale"))}.` });
  if (of("watch").length) lines.push({ k: "watch", text: `${of("watch").length === 1 ? "This one is" : `These ${of("watch").length} are`} close to break-even or slipping. Keep running, don't add budget, and check again in 1–2 days.` });
  const stop = [...of("pause"), ...of("turn_off")];
  if (stop.length) lines.push({ k: of("turn_off").length ? "turn_off" : "pause", text: `${stop.length === 1 ? "This campaign is" : `These ${stop.length} are`} losing money or not bringing orders${of("turn_off").length ? ` (${of("turn_off").length} to turn off)` : ""}. Pause, fix the offer, creative, targeting or tracking, then test again: ${names(stop)}.` });
  const collecting = of("keep").filter((row) => row.collectMoreData).length;
  if (of("keep").length) lines.push({ k: "keep", text: `${of("keep").length} keep running at the same budget${collecting ? `; ${collecting} of them need more orders before they can be judged` : ""}.` });
  if (!lines.length) return <p className="m-0 text-[13px] text-gray-500">No running campaign to sum up.</p>;
  return (
    <ul className="m-0 list-none space-y-3 p-0">
      {lines.map((line) => {
        const d = DECISIONS[line.k];
        return (
          <li key={line.k} className="flex gap-3 border-b border-gray-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800">
            <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${d.pill}`}><d.Icon className="h-4 w-4" /></span>
            <p className="m-0 text-[12.5px] leading-snug text-gray-700 dark:text-slate-300"><b className={d.pill.split(" ").filter((c) => c.startsWith("text-") || c.startsWith("dark:text-")).join(" ")}>{d.label}:</b> {line.text}</p>
          </li>
        );
      })}
    </ul>
  );
}

function exportCsv(data: CampaignDecisionsView, rows: CdRow[]) {
  const head = ["Campaign", "Product", "Ad account", "Spend", "Orders", "Delivered", "Pending", "DR %", "CPP", "Gross profit", "Net contribution", "Expected final", "Decision", "Score", "Rating", "Confidence", "Why", "Action"];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [r.campaignName, r.productName ?? "", r.accountName, Math.round(r.period.adSpend), r.period.orders, r.period.delivered, r.period.pending,
    r.period.deliveryRate === null ? "" : Math.round(r.period.deliveryRate * 100), r.period.costPerOrder === null ? "" : Math.round(r.period.costPerOrder),
    Math.round(r.period.grossProfit), Math.round(r.period.netContribution), Math.round(r.period.expectedFinal), r.label, r.score, r.rating, r.confidence, r.why, r.action].map(esc).join(","));
  const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `campaign-decisions-last-${data.periodDays}-days-${data.today}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
