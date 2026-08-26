import { useMemo, useState } from "react";
import { Phone, RefreshCw, CheckSquare, Inbox, TrendingUp, TrendingDown, Info, X } from "lucide-react";
import type { RecoveryCalendarDay, RecoveryCalendarView } from "../lib/api";

type Props = {
  view: RecoveryCalendarView;
  loading?: boolean;
  formatMoney: (value: number) => string;
};

/**
 * One entry per status. Every colour the calendar uses is declared here, so a
 * tone can never be spelled differently in two places and drift apart.
 *
 * ⚠️ "rest" is deliberately neutral. Sundays are off across this business - the
 * order follow-up KPI and the cart log penalty both skip them - so colouring
 * one as a miss would invent a failure against a target never set.
 */
const STATUS: Record<RecoveryCalendarDay["status"], {
  cell: string; ring: string; dot: string; label: string;
}> = {
  above: {
    cell: "border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-white dark:border-emerald-400/20 dark:from-emerald-500/10 dark:to-transparent",
    ring: "hover:ring-emerald-300", dot: "bg-emerald-500", label: "On target"
  },
  below: {
    cell: "border-amber-200/80 bg-gradient-to-br from-amber-50 to-white dark:border-amber-400/20 dark:from-amber-500/10 dark:to-transparent",
    ring: "hover:ring-amber-300", dot: "bg-amber-500", label: "Below target"
  },
  critical: {
    cell: "border-rose-200/80 bg-gradient-to-br from-rose-50 to-white dark:border-rose-400/20 dark:from-rose-500/10 dark:to-transparent",
    ring: "hover:ring-rose-300", dot: "bg-rose-500", label: "Critical"
  },
  rest: {
    cell: "border-slate-200/70 bg-slate-50/70 dark:border-slate-700/60 dark:bg-slate-800/40",
    ring: "hover:ring-slate-300", dot: "bg-slate-300", label: "Rest day"
  },
  none: {
    cell: "border-dashed border-slate-200 bg-white/40 dark:border-slate-700/50 dark:bg-transparent",
    ring: "hover:ring-slate-200", dot: "bg-slate-200", label: "No data"
  }
};

const METRICS = [
  { key: "claimed" as const, short: "C", name: "Claimed", bar: "bg-amber-500", soft: "bg-amber-100 dark:bg-amber-500/20", text: "text-amber-600 dark:text-amber-400" },
  { key: "followUp" as const, short: "F", name: "Follow-up", bar: "bg-emerald-500", soft: "bg-emerald-100 dark:bg-emerald-500/20", text: "text-emerald-600 dark:text-emerald-400" },
  { key: "retention" as const, short: "R", name: "Retention", bar: "bg-sky-500", soft: "bg-sky-100 dark:bg-sky-500/20", text: "text-sky-600 dark:text-sky-400" },
  { key: "delivered" as const, short: "D", name: "Delivered", bar: "bg-violet-500", soft: "bg-violet-100 dark:bg-violet-500/20", text: "text-violet-600 dark:text-violet-400" }
];

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const dayNumber = (key: string) => Number(key.slice(8, 10));
const monthTitle = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
const longDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export default function RecoveryBonusCalendar({ view, loading, formatMoney }: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const targets = view.targets ?? { followUp: 0, retention: 0, delivered: 0, claimed: 0 };
  const todayKey = new Date().toISOString().slice(0, 10);

  // Lead the first row with blanks so day 1 lands under its real weekday.
  // Without it every month renders as a straight run and the columns lie.
  const lead = useMemo(() => {
    if (view.days.length === 0) return 0;
    return new Date(`${view.days[0].day}T00:00:00Z`).getUTCDay();
  }, [view.days]);

  const selected = view.days.find((row) => row.day === selectedDay) ?? null;
  const judged = view.belowTargetDays + view.aboveTargetDays;
  const hitRate = judged > 0 ? Math.round((view.aboveTargetDays / judged) * 100) : null;

  const ratio = (value: number, target: number) => (target > 0 ? Math.min(1, value / target) : 0);

  return (
    <div className={`transition-opacity duration-200 ${loading ? "opacity-40" : "opacity-100"}`}>
      {/* ── Metric strip ─────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {METRICS.map((metric) => {
          const total = metric.key === "followUp" ? view.followUpTotal
            : metric.key === "retention" ? view.retentionTotal
              : metric.key === "claimed" ? view.claimedTotal : view.deliveredTotal;
          const perDayTarget = targets[metric.key];
          const Icon = metric.key === "followUp" ? Phone
            : metric.key === "retention" ? RefreshCw
              : metric.key === "claimed" ? Inbox : CheckSquare;
          return (
            <div key={metric.key}
              className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.02] transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-slate-700/70 dark:bg-slate-900">
              <span className={`absolute inset-x-0 top-0 h-1 ${metric.bar}`} />
              <div className="flex items-start justify-between gap-2">
                {/* ⚠️ "Worked", not "picked". The list below counts orders
                    CLAIMED on a day; this counts orders TOUCHED on a day. They
                    are different numbers and must not share a word. */}
                <p className="m-0 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Worked · {metric.name}
                </p>
                <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${metric.soft}`}>
                  <Icon className={`h-4 w-4 ${metric.text}`} />
                </span>
              </div>
              <p className="m-0 mt-2 text-4xl font-black leading-none tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                {total.toLocaleString("en-NG")}
              </p>
              <p className="m-0 mt-2 text-[11px] font-semibold text-slate-500">
                {metric.key === "claimed" && perDayTarget > 0
                  ? `${view.claimDaysMet} of ${view.claimDaysMet + view.claimDaysMissed} days hit ${perDayTarget}${
                      view.claimDaysAtCap > 0 ? ` · ${view.claimDaysAtCap} excused at cap` : ""}`
                  : perDayTarget > 0 ? `${perDayTarget} a day is target` : "No daily target set"}
              </p>
            </div>
          );
        })}

        {/* Consistency, as one figure rather than two competing counts. */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-900 to-slate-800 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <p className="m-0 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Days on target</p>
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/10">
              {hitRate !== null && hitRate >= 50
                ? <TrendingUp className="h-4 w-4 text-emerald-400" />
                : <TrendingDown className="h-4 w-4 text-rose-400" />}
            </span>
          </div>
          <p className="m-0 mt-2 text-4xl font-black leading-none tracking-tight tabular-nums text-white">
            {view.aboveTargetDays}<span className="text-xl text-slate-500"> / {judged}</span>
          </p>
          {/* One bar, both figures. Two separate cards for "above" and "below"
              made a reader do the division themselves. */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
              style={{ width: `${hitRate ?? 0}%` }} />
          </div>
          <p className="m-0 mt-1.5 text-[11px] font-semibold text-slate-400">
            {hitRate === null ? "Nothing judged yet" : `${hitRate}% of judged days · ${view.belowTargetDays} short`}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        {/* ── Calendar ───────────────────────────────────── */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="m-0 text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
              {view.days.length > 0 ? monthTitle(view.days[0].day) : "No days in range"}
            </h4>
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-500">
              {METRICS.map((metric) => (
                <span key={metric.key} className="inline-flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${metric.bar}`} />{metric.short} — {metric.name}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((initial, index) => (
                  <div key={index} title={WEEKDAY_FULL[index]}
                    className="pb-1 text-center text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {initial}
                  </div>
                ))}
                {Array.from({ length: lead }).map((_, index) => <div key={`lead-${index}`} />)}
                {view.days.map((row) => {
                  const tone = STATUS[row.status];
                  const isSelected = row.day === selectedDay;
                  const isToday = row.day === todayKey;
                  const empty = row.status === "none";
                  return (
                    <button
                      key={row.day}
                      type="button"
                      onClick={() => setSelectedDay(isSelected ? null : row.day)}
                      title={`${longDate(row.day)} — ${tone.label}`}
                      className={`!min-h-0 group relative flex flex-col gap-1.5 rounded-xl border p-2 text-left ring-2 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-md ${tone.cell} ${tone.ring} ${
                        isSelected ? "!ring-sky-500 shadow-md -translate-y-0.5" : ""}`}
                    >
                      <span className="flex items-center justify-between">
                        <span className={`text-[13px] font-black tabular-nums ${
                          isToday ? "text-sky-600 dark:text-sky-400" : "text-slate-700 dark:text-slate-200"}`}>
                          {dayNumber(row.day)}
                        </span>
                        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                      </span>

                      {/* Three micro-bars instead of "F: 4 R: 7 D: 1". The
                          shape of a day is readable at a glance across a whole
                          month; the raw triplet needed reading one cell at a
                          time. Numbers stay underneath rather than being lost. */}
                      <span className="flex h-6 items-end gap-1">
                        {METRICS.map((metric) => {
                          const value = row[metric.key];
                          const pct = empty ? 0 : ratio(value, targets[metric.key]) * 100;
                          return (
                            <span key={metric.key} className="relative flex h-full flex-1 items-end overflow-hidden rounded-[3px] bg-slate-200/60 dark:bg-slate-700/50">
                              <span className={`w-full rounded-[3px] transition-all ${metric.bar}`}
                                style={{ height: `${empty ? 0 : Math.max(value > 0 ? 12 : 0, pct)}%` }} />
                            </span>
                          );
                        })}
                      </span>

                      <span className="flex items-center justify-between text-[10px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
                        {empty
                          ? <span className="text-slate-300">—</span>
                          : METRICS.map((metric) => (
                            <span key={metric.key} className={metric.text}>{row[metric.key]}</span>
                          ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Selected day ─────────────────────────────── */}
          {selected && (
            <div className="mt-4 rounded-xl border border-sky-200/80 bg-gradient-to-br from-sky-50 to-white p-4 dark:border-sky-400/20 dark:from-sky-500/10 dark:to-transparent">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 text-[13px] font-black text-slate-900 dark:text-slate-100">{longDate(selected.day)}</p>
                  <p className="m-0 mt-0.5 text-[11px] font-bold text-slate-500">
                    {selected.claimCapped ? `Board was full (${selected.heldAtStart ?? 0} of ${view.claimCap} held) — no claim was possible, so claiming is not judged today.`
                      : selected.status === "rest" ? "Sunday — a rest day. No target applied, and it counts against nothing."
                      : selected.status === "none" ? "Nothing recorded for this day yet."
                        : selected.status === "above" ? "Every target met."
                          : `Short of target${selected.attainment !== null ? ` — reached ${Math.round(selected.attainment * 100)}% of the weakest one` : ""}.`}
                  </p>
                </div>
                <button type="button" onClick={() => setSelectedDay(null)}
                  className="!min-h-0 shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {METRICS.map((metric) => {
                  const value = selected[metric.key];
                  const target = targets[metric.key];
                  const met = target > 0 && value >= target;
                  return (
                    <div key={metric.key} className="rounded-lg border border-white/80 bg-white/80 p-2.5 dark:border-slate-700 dark:bg-slate-900/60">
                      <p className="m-0 text-[10px] font-black uppercase tracking-wider text-slate-400">{metric.name}</p>
                      <p className="m-0 mt-0.5 text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                        {value}
                        {target > 0 && <span className="text-sm font-bold text-slate-400"> / {target}</span>}
                      </p>
                      {target > 0 && (
                        <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/70">
                          <div className={`h-full rounded-full ${met ? "bg-emerald-500" : metric.bar}`}
                            style={{ width: `${ratio(value, target) * 100}%` }} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Side rail ──────────────────────────────────── */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900">
            <p className="m-0 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Target guide</p>
            <dl className="m-0 mt-3 space-y-2.5">
              {METRICS.map((metric) => (
                <div key={metric.key} className="flex items-center justify-between gap-3">
                  <dt className="m-0 inline-flex items-center gap-2 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                    <span className={`h-2 w-2 rounded-full ${metric.bar}`} />{metric.name}
                  </dt>
                  <dd className="m-0 text-[13px] font-black tabular-nums text-slate-900 dark:text-slate-100">
                    {targets[metric.key] || "—"}<span className="text-[11px] font-bold text-slate-400"> /day</span>
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2.5 dark:border-slate-700">
                <dt className="m-0 text-[12px] font-semibold text-slate-600 dark:text-slate-300">Per recovered order</dt>
                <dd className="m-0 text-[13px] font-black text-emerald-600 dark:text-emerald-400">
                  {formatMoney(view.bonusPerRecoveredOrder)}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900">
            <p className="m-0 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Day status</p>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {(["above", "below", "critical", "rest", "none"] as const).map((key) => (
                <li key={key} className="flex items-center gap-2 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS[key].dot}`} />
                  {STATUS[key].label}
                  {key === "critical" && <span className="text-[10px] font-bold text-slate-400">under half</span>}
                  {key === "rest" && <span className="text-[10px] font-bold text-slate-400">Sundays</span>}
                </li>
              ))}
            </ul>
          </div>

          <p className="m-0 flex items-start gap-2 rounded-2xl border border-sky-200/70 bg-sky-50/60 px-3 py-3 text-[11px] font-semibold leading-relaxed text-sky-900 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Tap a day for its breakdown. This counts orders you WORKED that
            day, not orders you claimed — an order worked on three days counts
            three times, which is what a daily target measures.
          </p>
        </div>
      </div>

      <p className="m-0 mt-3 text-[11px] font-semibold text-slate-400">
        Range: {view.from} to {view.to}
      </p>
    </div>
  );
}
