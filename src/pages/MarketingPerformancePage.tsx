import { useEffect, useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  AlertTriangle, CalendarDays, CheckCircle2, Coins, Megaphone, Package,
  Scale, ShoppingCart, Target, TrendingUp, Truck, Users
} from "lucide-react";
import { marketingSpendApi, type MarketingPerformance } from "../lib/api";
// ⚠️ Shared formatters, NOT a local ₦ one. A private formatter ignores both the
// branch's currency and the topbar "hide money" toggle.
import { money, currencySymbol } from "../lib/money-privacy";
import { LoadingState } from "../components/ui/loading-state";

/**
 * Marketing Performance Center — ad spend through to real profit.
 *
 * ⚠️ THIS PAGE REFUSES TO INVENT A NUMBER. Everything here divides by ad spend,
 * and Bright's spend table had four rows, all from June, none with an actual
 * amount. A page that showed ₦0 spent and an infinite return would look
 * authoritative and be false - worse than no page.
 *
 * So a figure that needs spend nobody entered reads "Not recorded", and the
 * banner says how many days of the period have no spend against them. The
 * honest blank is the feature, not a gap in it.
 */

type Period = "today" | "week" | "month" | "last" | "year" | "custom";

const todayKey = () => new Date().toISOString().slice(0, 10);
const shift = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const monthStart = (offset = 0) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
};
const monthEnd = (offset = 0) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 0)).toISOString().slice(0, 10);
};

const RANGES: Record<Exclude<Period, "custom">, { label: string; from: string; to: string }> = {
  today: { label: "Today", from: todayKey(), to: todayKey() },
  week: { label: "This week", from: shift(6), to: todayKey() },
  month: { label: "This month", from: monthStart(), to: todayKey() },
  last: { label: "Last month", from: monthStart(-1), to: monthEnd(-1) },
  year: { label: "This year", from: `${new Date().getUTCFullYear()}-01-01`, to: todayKey() }
};

/** The one rule this page lives by: unknown is shown, never drawn as zero. */
const NOT_RECORDED = "Not recorded";
const asMoney = (value: number | null) => (value === null ? NOT_RECORDED : money(value));
const asMultiple = (value: number | null) => (value === null ? NOT_RECORDED : `${value.toFixed(2)}x`);
const asPercent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

const SPEND_BASIS_NOTE: Record<string, string | null> = {
  none: null,
  actual: null,
  budget: "These figures use the budget handed out, not money proven spent.",
  mixed: "Part of this uses budget handed out rather than money proven spent."
};

export type MarketingPerformancePageProps = {
  canEnterSpend: boolean;
  onEnterSpend: () => void;
};

export default function MarketingPerformancePage({ canEnterSpend, onEnterSpend }: MarketingPerformancePageProps) {
  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState(monthStart());
  const [customTo, setCustomTo] = useState(todayKey());
  const [view, setView] = useState<MarketingPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const range = period === "custom"
    ? { from: customFrom, to: customTo }
    : { from: RANGES[period].from, to: RANGES[period].to };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    marketingSpendApi.performance(range.from, range.to)
      .then((data) => { if (!cancelled) setView(data); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  const totals = view?.totals;
  const spendMissing = !!totals && totals.spendBasis === "none";
  const partialSpend = !!totals && totals.spendBasis !== "none" && totals.daysWithoutSpend > 0;

  const statusSlices = useMemo(() => {
    if (!totals) return [];
    const pending = Math.max(0, totals.confirmed - totals.delivered);
    return [
      { name: "Delivered", value: totals.delivered, fill: "#10b981" },
      { name: "Confirmed, not yet delivered", value: pending, fill: "#38bdf8" },
      { name: "Failed or cancelled", value: totals.lost, fill: "#fbbf24" }
    ].filter((slice) => slice.value > 0);
  }, [totals]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-2xl font-bold text-[#1F8FE0]">Marketing Performance Center</h1>
        <p className="m-0 text-sm font-medium text-gray-500">
          Every stage from ad spend to profit — which buyer, campaign and product actually makes money.
        </p>
      </header>

      {/* Period */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(RANGES) as Array<Exclude<Period, "custom">>).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPeriod(key)}
            className={`!min-h-0 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
              period === key ? "bg-[#1F8FE0] text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
          >{RANGES[key].label}</button>
        ))}
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1">
          <CalendarDays className="h-3.5 w-3.5 text-gray-400" />
          <input type="date" value={customFrom}
            onChange={(e) => { setCustomFrom(e.target.value); setPeriod("custom"); }}
            className="!min-h-0 border-0 bg-transparent p-0 text-xs text-gray-700 outline-none" />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={customTo}
            onChange={(e) => { setCustomTo(e.target.value); setPeriod("custom"); }}
            className="!min-h-0 border-0 bg-transparent p-0 text-xs text-gray-700 outline-none" />
        </div>
      </div>

      {loading && <LoadingState label="Working out marketing performance…" />}

      {failed && !loading && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-900">
          Could not load these figures. Try the period again in a moment.
        </p>
      )}

      {totals && !loading && (
        <>
          {/* ⚠️ THE MOST IMPORTANT THING ON THE PAGE WHEN IT APPLIES.
              Without it, every blank below reads as a bug rather than as a
              question nobody has answered. */}
          {spendMissing && (
            <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
              <h2 className="m-0 flex items-center gap-2 text-sm font-black text-amber-900">
                <AlertTriangle className="h-4 w-4" />No ad spend recorded for this period
              </h2>
              <p className="m-0 mt-1 text-[13px] leading-5 text-amber-900">
                Orders, revenue and delivery below are real. Anything that needs to know what the ads cost —
                cost per order, return on ad spend, true profit — cannot be worked out, so it says so rather
                than showing a zero that would read as free advertising. This reads both your own Ad Spend
                entries and anything media buyers recorded, so an empty period means neither has anything for
                these dates.
              </p>
              {canEnterSpend && (
                <button
                  type="button"
                  onClick={onEnterSpend}
                  className="!min-h-0 mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-amber-700"
                >
                  <Coins className="h-3.5 w-3.5" />Record what you spent
                </button>
              )}
            </section>
          )}

          {partialSpend && (
            <p className="m-0 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-[13px] font-semibold leading-5 text-amber-900">
              Spend is recorded on only {totals.periodDays - totals.daysWithoutSpend} of {totals.periodDays} days
              in this period. Cost and return figures are calculated against those days alone, so they will look
              better than reality until the rest is filled in.
              {SPEND_BASIS_NOTE[totals.spendBasis] ? ` ${SPEND_BASIS_NOTE[totals.spendBasis]}` : ""}
            </p>
          )}

          {/* Headline */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { title: "Ad spend", value: asMoney(totals.adSpend), icon: Megaphone, tone: "blue" as const,
                // ⚠️ SAYS WHICH BOOK IT CAME FROM. The company's own ads and a
                // media buyer's budget are different money, and reading only
                // the buyer book is how this page first reported "not
                // recorded" while N3.9m sat in expenses.
                helper: totals.spendRecords === 0 ? "nothing entered"
                  : totals.buyerSpend > 0 && totals.companySpend > 0
                    ? `${money(totals.companySpend)} company · ${money(totals.buyerSpend)} buyers`
                    : totals.buyerSpend > 0 ? "entered by media buyers" : "your own ad spend entries" },
              { title: "Orders placed", value: String(totals.ordersPlaced), icon: ShoppingCart, tone: "blue" as const,
                helper: `${asPercent(totals.confirmationRate)} confirmed` },
              { title: "Delivered", value: String(totals.delivered), icon: Truck, tone: "green" as const,
                helper: `${asPercent(totals.deliveryRate)} of orders placed` },
              { title: "Delivered revenue", value: money(totals.deliveredRevenue), icon: Coins, tone: "green" as const,
                helper: "money actually collected" },
              { title: "Product + delivery cost", value: money(totals.productCost + totals.deliveryCost), icon: Package, tone: "purple" as const,
                helper: "what those deliveries cost" },
              { title: "True net profit", value: asMoney(totals.trueNetProfit), icon: TrendingUp,
                tone: totals.trueNetProfit === null ? "purple" as const : totals.trueNetProfit >= 0 ? "green" as const : "rose" as const,
                helper: totals.trueNetProfit === null ? "needs ad spend" : "after product, delivery and ads" }
            ].map(({ title, value, helper, icon: Icon, tone }) => (
              <article key={title} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <span className={`mb-2 flex h-10 w-10 items-center justify-center rounded-full ${
                  tone === "blue" ? "bg-blue-50 text-blue-500"
                    : tone === "green" ? "bg-emerald-50 text-emerald-500"
                    : tone === "rose" ? "bg-rose-50 text-rose-500"
                    : "bg-purple-50 text-purple-500"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h2>
                <strong className={`my-1 block text-2xl font-bold ${value === NOT_RECORDED ? "text-gray-400" : "text-gray-900"}`}>{value}</strong>
                <p className="m-0 text-[10px] font-medium text-gray-400">{helper}</p>
              </article>
            ))}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Funnel */}
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
              <h2 className="m-0 text-sm font-bold text-gray-800">From spend to profit</h2>
              <p className="m-0 mt-0.5 text-xs text-gray-400">Where the money goes at every stage</p>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {[
                  { label: "Ad spend", value: asMoney(totals.adSpend) },
                  { label: "Orders placed", value: String(totals.ordersPlaced) },
                  { label: "Confirmed", value: String(totals.confirmed) },
                  { label: "Delivered", value: String(totals.delivered) },
                  { label: "Revenue", value: money(totals.deliveredRevenue) }
                ].map((step) => (
                  <div key={step.label} className="rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">{step.label}</p>
                    <p className={`m-0 mt-1 text-sm font-black ${step.value === NOT_RECORDED ? "text-gray-400" : "text-gray-900"}`}>{step.value}</p>
                  </div>
                ))}
              </div>

              <h3 className="m-0 mt-5 text-xs font-bold uppercase tracking-wider text-gray-400">What each order costs and returns</h3>
              <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
                {[
                  { label: "Cost per order", value: asMoney(totals.costPerOrder), icon: Target },
                  { label: "Cost per delivered order", value: asMoney(totals.costPerDeliveredOrder), icon: Truck },
                  { label: "Return on ad spend", value: asMultiple(totals.roas), icon: TrendingUp },
                  { label: "Average delivered order", value: asMoney(totals.deliveredAov), icon: ShoppingCart },
                  { label: "Revenue per order placed", value: asMoney(totals.placedAov), icon: Users },
                  { label: "Break-even per delivered", value: asMoney(totals.breakEvenCostPerDelivered), icon: Scale }
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="flex items-start gap-2 rounded-lg border border-gray-100 p-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#1F8FE0]" />
                    <div className="min-w-0">
                      <p className="m-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
                      <p className={`m-0 mt-0.5 text-sm font-black ${value === NOT_RECORDED ? "text-gray-400" : "text-gray-900"}`}>{value}</p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="m-0 mt-3 text-[11px] leading-4 text-gray-500">
                Break-even per delivered is the most you can pay in ads for one delivered order before this
                period stops making money. Anything under it is profit; over it is a loss.
              </p>
            </section>

            {/* Status */}
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <h2 className="m-0 text-sm font-bold text-gray-800">What happened to the orders</h2>
              <p className="m-0 mt-0.5 text-xs text-gray-400">{totals.ordersPlaced} placed in this period</p>
              {statusSlices.length === 0 ? (
                <p className="m-0 mt-6 text-sm text-gray-500">No orders in this period.</p>
              ) : (
                <>
                  <div style={{ height: 180 }} className="mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={statusSlices} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={2}>
                          {statusSlices.map((slice) => <Cell key={slice.name} fill={slice.fill} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                    {statusSlices.map((slice) => (
                      <li key={slice.name} className="flex items-center gap-2 text-[12px]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.fill }} />
                        <span className="min-w-0 flex-1 truncate text-gray-700">{slice.name}</span>
                        <span className="shrink-0 font-bold text-gray-900">{slice.value}</span>
                        <span className="w-12 shrink-0 text-right text-gray-400">
                          {Math.round((slice.value / totals.ordersPlaced) * 100)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>

          {/* Leaderboard */}
          <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="m-0 text-base font-bold text-gray-900">Where the orders came from</h2>
              <p className="m-0 mt-0.5 text-xs text-gray-400">
                Ranked by profit after ads. A row with no spend recorded cannot be ranked honestly, so it sits at the bottom.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <th className="px-4 py-3 text-left">Source / buyer</th>
                    <th className="px-4 py-3 text-right">Placed</th>
                    <th className="px-4 py-3 text-right">Delivered</th>
                    <th className="px-4 py-3 text-right">Delivery rate</th>
                    <th className="px-4 py-3 text-right">Revenue</th>
                    <th className="px-4 py-3 text-right">Ad spend</th>
                    <th className="px-4 py-3 text-right">Profit after ads</th>
                    <th className="px-4 py-3 text-right">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {view!.buyers.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-gray-500">No orders in this period.</td></tr>
                  )}
                  {view!.buyers.map((buyer) => (
                    <tr key={buyer.key} className="border-t border-gray-100">
                      <td className="px-4 py-3">
                        <span className="font-semibold text-gray-900">{buyer.label}</span>
                        {buyer.key === "__unattributed__" && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800">
                            No tag
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{buyer.ordersPlaced}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{buyer.delivered}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{asPercent(buyer.deliveryRate)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{money(buyer.deliveredRevenue)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${buyer.adSpend === null ? "text-gray-400" : "text-gray-700"}`}>
                        {asMoney(buyer.adSpend)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-bold ${
                        buyer.trueNetProfit === null ? "text-gray-400"
                          : buyer.trueNetProfit >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {asMoney(buyer.trueNetProfit)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${buyer.roas === null ? "text-gray-400" : "text-gray-700"}`}>
                        {asMultiple(buyer.roas)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 border-t border-gray-100 px-5 py-3 text-[11px] leading-4 text-gray-500">
              <CheckCircle2 className="mr-1 inline h-3 w-3 text-emerald-500" />
              Revenue and delivery counts are real for every row. Only the ad spend column, and what depends on
              it, needs someone to enter what was spent — spend is matched to a buyer by their tag, so an entry
              with no tag cannot be credited to anyone.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
