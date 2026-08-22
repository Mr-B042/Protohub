import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import {
  AlertTriangle, ArrowDownLeft, ArrowDownRight, ArrowUpRight, Banknote, CalendarDays,
  CheckCircle2, ChevronLeft, ChevronRight, Download, HelpCircle, Info, Landmark,
  Lock, TrendingUp, Users, Wallet
} from "lucide-react";
import type { WeeklyOverviewView, WeekMovement } from "../lib/api";

// The whole week's financial position on one screen.
//
// ⚠️ Every figure is sourced from the tab that owns it and none is recomputed
// with different rules. An overview that quietly disagrees with the page it
// summarises is worse than no overview at all.

const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;
const signedNaira = (value: number) => {
  const rounded = Math.round(Number(value) || 0);
  if (rounded === 0) return "₦0";
  return `${rounded < 0 ? "−" : "+"}₦${Math.abs(rounded).toLocaleString("en-NG")}`;
};
const shortNaira = (value: number) => {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}₦${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}₦${Math.round(abs / 1_000)}K`;
  return `${sign}₦${Math.round(abs)}`;
};
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
const fullDay = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
const addDays = (key: string, days: number) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const sundayOf = (key: string) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
};
const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

const RATING_STYLE = {
  good: { label: "Good", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  fair: { label: "Fair", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  poor: { label: "Needs Attention", chip: "bg-rose-50 text-rose-700 border-rose-200" },
  unknown: { label: "Unknown", chip: "bg-gray-100 text-gray-600 border-gray-200" }
} as const;

/** A percentage cell that says "new" rather than printing 0% or ∞%. */
function MovementCell({ movement, invert }: { movement: WeekMovement; invert?: boolean }) {
  if (movement.pct === null) {
    return <span className="text-[12px] font-black text-gray-400">{movement.delta === 0 ? "—" : "new"}</span>;
  }
  // For cash OUT, going up is bad, so the colour is inverted deliberately.
  const good = invert ? movement.pct <= 0 : movement.pct >= 0;
  const Icon = movement.pct >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[12px] font-black ${movement.pct === 0 ? "text-gray-400" : good ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon className="h-3 w-3" /> {Math.abs(movement.pct).toFixed(2)}%
    </span>
  );
}

export type WeeklyOverviewTabProps = {
  view: WeeklyOverviewView | null;
  loading: boolean;
  error: string;
  weekStart: string;
  onWeekChange: (weekStart: string) => void;
  onExport: () => void;
  onOpenClose: () => void;
};

export default function WeeklyOverviewTab(props: WeeklyOverviewTabProps) {
  const { view, loading, error, weekStart } = props;
  const isThisWeek = sundayOf(todayKey()) === weekStart;

  const cards = [
    { label: "Net Profit (This Week)", movement: view?.headline.netProfit, icon: TrendingUp, tone: "bg-emerald-50 text-emerald-600" },
    { label: "Cash In (Received)", movement: view?.headline.cashIn, icon: ArrowDownLeft, tone: "bg-emerald-50 text-emerald-600" },
    { label: "Cash Out (Spent)", movement: view?.headline.cashOut, icon: ArrowUpRight, tone: "bg-rose-50 text-rose-600", invert: true },
    { label: "Closing Cash (Expected)", movement: view?.headline.expectedClosing, icon: Wallet, tone: "bg-blue-50 text-blue-600" }
  ];

  const trendPoints = (view?.varianceTrend ?? []).map((point) => ({
    name: dayLabel(point.weekStart),
    variance: point.variance,
    counted: point.counted
  }));
  const countedPoints = trendPoints.filter((point) => point.variance !== null).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-2xl font-black text-gray-900">
            Weekly Financial Control Overview
            <span title="Every figure here comes from the tab that owns it — nothing is recalculated with different rules."
              className="cursor-help text-gray-300 hover:text-gray-500"><Info className="h-4 w-4" /></span>
          </h2>
          <p className="m-0 mt-1 text-sm text-gray-500">A complete summary of your business financial position and performance for the selected week.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-1.5">
            <button type="button" aria-label="Previous week" onClick={() => props.onWeekChange(addDays(weekStart, -7))}
              className="!min-h-0 rounded-lg bg-transparent p-1.5 text-gray-500 hover:bg-gray-50">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="inline-flex items-center gap-1.5 px-1">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              <span className="text-[13px] font-black text-gray-900">
                {view ? `${dayLabel(view.weekStart)} – ${fullDay(view.weekEnd)}` : "—"}
              </span>
              {isThisWeek && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">This Week</span>}
            </span>
            <button type="button" aria-label="Next week" disabled={isThisWeek}
              onClick={() => props.onWeekChange(addDays(weekStart, 7))}
              className="!min-h-0 rounded-lg bg-transparent p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </span>
          <button type="button" onClick={props.onExport}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" /> Download Report
          </button>
          <button type="button" onClick={props.onOpenClose}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2.5 text-sm font-bold text-white hover:bg-violet-700">
            <Lock className="h-4 w-4" /> Weekly Close
          </button>
        </div>
      </div>

      {error && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p>
      )}

      {view && !view.openingCounted && (
        <p className="m-0 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] font-bold text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          This week's opening cash was derived, not counted. Every closing figure below inherits that assumption.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="m-0 mt-2.5 text-[11px] font-black uppercase tracking-wide text-gray-500">{card.label}</p>
              <p className="m-0 mt-0.5 text-xl font-black text-gray-900">{naira(card.movement?.current ?? 0)}</p>
              <p className="m-0 mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400">
                Vs last week{" "}
                {card.movement ? <MovementCell movement={card.movement} invert={card.invert} /> : "—"}
              </p>
            </div>
          );
        })}
        <div className={`rounded-2xl border px-4 py-4 ${
          !view?.headline.varianceVerified ? "border-gray-200 bg-white"
            : Math.abs(view.headline.cashVariance) <= 0.5 ? "border-emerald-200 bg-emerald-50/40"
              : "border-rose-200 bg-rose-50/40"}`}>
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${
            !view?.headline.varianceVerified ? "bg-gray-100 text-gray-500" : "bg-rose-50 text-rose-600"}`}>
            <AlertTriangle className="h-5 w-5" />
          </span>
          <p className="m-0 mt-2.5 text-[11px] font-black uppercase tracking-wide text-gray-500">Cash Variance</p>
          <p className={`m-0 mt-0.5 text-xl font-black ${
            !view?.headline.varianceVerified ? "text-gray-400"
              : Math.abs(view.headline.cashVariance) <= 0.5 ? "text-emerald-600" : "text-rose-600"}`}>
            {view?.headline.varianceVerified ? signedNaira(view.headline.cashVariance) : "Not counted"}
          </p>
          <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-400">
            {view?.headline.varianceVerified
              ? Math.abs(view.headline.cashVariance) <= 0.5 ? "The week balances" : "Unexplained"
              : "Verify closing cash to see it"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white">
          <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
            Weekly Financial Summary
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-2.5">Description</th>
                  <th className="px-5 py-2.5 text-right">This Week</th>
                  <th className="px-5 py-2.5 text-right">Last Week</th>
                  <th className="px-5 py-2.5 text-right">Change (₦)</th>
                  <th className="px-5 py-2.5 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {(view?.summary ?? []).map((row) => {
                  const isVariance = row.label === "Cash Variance";
                  return (
                    <tr key={row.label} className={`border-b border-gray-50 last:border-0 ${isVariance ? "bg-rose-50/40" : ""}`}>
                      <td className="px-5 py-3 text-[13px] font-bold text-gray-900">{row.label}</td>
                      <td className={`px-5 py-3 text-right text-[13px] font-black ${isVariance ? "text-rose-600" : "text-gray-900"}`}>
                        {isVariance ? signedNaira(row.current) : naira(row.current)}
                      </td>
                      <td className="px-5 py-3 text-right text-[13px] font-semibold text-gray-500">
                        {isVariance ? signedNaira(row.previous) : naira(row.previous)}
                      </td>
                      <td className={`px-5 py-3 text-right text-[13px] font-black ${row.delta === 0 ? "text-gray-400" : row.delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                        {signedNaira(row.delta)}
                      </td>
                      <td className="px-5 py-3 text-right"><MovementCell movement={row} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Cash Position Breakdown
            </h3>
            <dl className="m-0 space-y-2 px-5 py-4">
              {[
                { label: "Business Bank Accounts", value: view?.cashPosition.bankAccounts ?? 0, icon: Landmark },
                { label: "Cash in Hand", value: view?.cashPosition.cashInHand ?? 0, icon: Banknote },
                { label: "Cash with Delivery Agents (COD)", value: view?.cashPosition.codWithAgents ?? 0, icon: Users },
                { label: "Restricted / Reserved", value: view?.cashPosition.reservedCash ?? 0, icon: Lock }
              ].map((row) => {
                const Icon = row.icon;
                return (
                  <div key={row.label} className="flex items-center justify-between gap-2">
                    <dt className="m-0 inline-flex min-w-0 items-center gap-1.5 text-[12px] font-semibold text-gray-600">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      <span className="truncate">{row.label}</span>
                    </dt>
                    <dd className="m-0 shrink-0 text-[12px] font-black text-gray-900">{naira(row.value)}</dd>
                  </div>
                );
              })}
              <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                <dt className="m-0 text-[12px] font-black text-gray-900">Free Operating Cash</dt>
                <dd className={`m-0 text-base font-black ${(view?.cashPosition.freeOperatingCash ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {signedNaira(view?.cashPosition.freeOperatingCash ?? 0)}
                </dd>
              </div>
              <p className="m-0 text-[11px] font-semibold text-gray-400">
                Bank and cash less reserves. Agent COD is shown but excluded — it cannot pay a bill this week.
              </p>
            </dl>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Quick Health Check
            </h3>
            <ul className="m-0 list-none space-y-2 p-0 px-5 py-4">
              {(view?.health ?? []).map((check) => (
                <li key={check.key} className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-bold text-gray-900">{check.label}</span>
                    <span className="block truncate text-[11px] font-medium text-gray-400" title={check.detail}>{check.detail}</span>
                  </span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-black ${RATING_STYLE[check.rating].chip}`}>
                    {RATING_STYLE[check.rating].label}
                  </span>
                </li>
              ))}
              {(view?.health.length ?? 0) === 0 && !loading && (
                <li className="text-[12px] font-semibold text-gray-500">Nothing to assess yet.</li>
              )}
            </ul>
          </section>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-5 py-4">
          <h3 className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-700">Variance Trend (Last 6 Weeks)</h3>
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400">
            <HelpCircle className="h-3.5 w-3.5" /> Only counted weeks are plotted
          </span>
        </div>
        <div className="px-5 py-4">
          {countedPoints === 0 ? (
            <p className="m-0 py-8 text-center text-[13px] font-semibold text-gray-500">
              No week in the last six has had its closing cash counted, so there is no variance to plot.
            </p>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendPoints} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={shortNaira} tick={{ fontSize: 11, fill: "#94A3B8" }} axisLine={false} tickLine={false} width={56} />
                  <ReferenceLine y={0} stroke="#CBD5E1" />
                  <Tooltip formatter={(value: number) => signedNaira(value)} />
                  {/* connectNulls is OFF: an uncounted week must leave a gap in
                      the line rather than being bridged as if it were checked. */}
                  <Line type="monotone" dataKey="variance" stroke="#EF4444" strokeWidth={2}
                    dot={{ r: 3, fill: "#EF4444" }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white">
        <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
          Financial Highlights
        </h3>
        <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 xl:grid-cols-5">
          {(view?.highlights ?? []).map((highlight) => (
            <div key={highlight.key} className="rounded-xl border border-gray-200 px-3 py-3">
              <p className="m-0 text-[11px] font-bold text-gray-500">{highlight.label}</p>
              <p className="m-0 mt-1 text-base font-black text-gray-900">
                {highlight.format === "pct" ? `${highlight.value.toFixed(2)}%` : naira(highlight.value)}
              </p>
              <p className="m-0 mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-400">
                Vs last week <MovementCell movement={highlight.movement}
                  invert={highlight.key === "avg_daily_expenses" || highlight.key === "opex_ratio"} />
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {[
          { title: "Top Cash In Sources", rows: view?.topCashIn ?? [], bar: "bg-emerald-500", empty: "No cash came in this week." },
          { title: "Top Cash Out Categories", rows: view?.topCashOut ?? [], bar: "bg-rose-500", empty: "Nothing was spent this week." }
        ].map((panel) => (
          <section key={panel.title} className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              {panel.title}
            </h3>
            <ul className="m-0 list-none space-y-2.5 p-0 px-5 py-4">
              {panel.rows.map((row) => (
                <li key={row.label}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-bold text-gray-700">{row.label}</span>
                    <span className="shrink-0 text-[12px] font-black text-gray-900">
                      {naira(row.amount)} <span className="font-semibold text-gray-400">({row.sharePct.toFixed(2)}%)</span>
                    </span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-100">
                    <span className={`block h-full rounded-full ${panel.bar}`} style={{ width: `${Math.min(row.sharePct, 100)}%` }} />
                  </span>
                </li>
              ))}
              {panel.rows.length === 0 && (
                <li className="text-[12px] font-semibold text-gray-500">{panel.empty}</li>
              )}
            </ul>
          </section>
        ))}
      </div>

      <p className="m-0 flex gap-2 rounded-xl bg-gray-50 px-3.5 py-3 text-[12px] font-semibold text-gray-500">
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
        Review all variances and outstanding items before closing the week. Net profit is accrual (recognised on
        delivery); cash figures are what actually moved — the two will not match, and that gap is the point.
      </p>
    </div>
  );
}
