import { useMemo, useState } from "react";
import { Phone, RefreshCw, CheckSquare, Target, Info } from "lucide-react";
import type { RecoveryCalendarDay, RecoveryCalendarView } from "../lib/api";

type Props = {
  view: RecoveryCalendarView;
  loading?: boolean;
  formatMoney: (value: number) => string;
};

/** One class set per status, so a colour is never spelled out twice. */
const STATUS_STYLE: Record<RecoveryCalendarDay["status"], { cell: string; date: string }> = {
  above: { cell: "border-emerald-200 bg-emerald-50/70", date: "text-gray-900" },
  below: { cell: "border-amber-300 bg-amber-50/70", date: "text-amber-700" },
  critical: { cell: "border-rose-300 bg-rose-50/70", date: "text-rose-700" },
  // ⚠️ Sundays are a rest day across this business, so they are neutral rather
  // than red. Colouring one as a miss would invent a failure against a target
  // the rep was never set.
  rest: { cell: "border-gray-200 bg-gray-50/60", date: "text-gray-400" },
  none: { cell: "border-gray-100 bg-white", date: "text-gray-300" }
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const dayNumber = (key: string) => Number(key.slice(8, 10));
const monthTitle = (key: string) => new Date(`${key}T12:00:00Z`)
  .toLocaleDateString("en-NG", { month: "long", year: "numeric" }).toUpperCase();

export default function RecoveryBonusCalendar({ view, loading, formatMoney }: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Lead the first row with blanks so day 1 lands under its real weekday.
  // Without this every month renders as a straight run and the week columns
  // mean nothing.
  const grid = useMemo(() => {
    if (view.days.length === 0) return { lead: 0, days: [] as RecoveryCalendarDay[] };
    const first = new Date(`${view.days[0].day}T00:00:00Z`);
    return { lead: first.getUTCDay(), days: view.days };
  }, [view.days]);

  const selected = view.days.find((row) => row.day === selectedDay) ?? null;
  const targets = view.targets ?? { followUp: 0, retention: 0, delivered: 0 };

  const metric = (icon: React.ReactNode, label: string, value: number, hint: string, tone: string) => (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">{label}</p>
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      </div>
      <p className="m-0 mt-1.5 text-3xl font-black tabular-nums text-gray-900">{value.toLocaleString("en-NG")}</p>
      <p className="m-0 mt-1 text-[11px] font-semibold text-gray-500">{hint}</p>
    </div>
  );

  return (
    <div className={`transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metric(<Phone className="h-3.5 w-3.5 text-emerald-600" />, "Picked · follow-up",
          view.followUpTotal, "Counted per day over the range", "bg-emerald-50")}
        {metric(<RefreshCw className="h-3.5 w-3.5 text-sky-600" />, "Picked · retention",
          view.retentionTotal, "Counted per day over the range", "bg-sky-50")}
        {metric(<CheckSquare className="h-3.5 w-3.5 text-violet-600" />, "Delivered recovery",
          view.deliveredTotal,
          view.monthlyRecoveredTarget > 0
            ? `${view.deliveredTotal} / ${view.monthlyRecoveredTarget} (${Math.round((view.deliveredTotal / view.monthlyRecoveredTarget) * 100)}%)`
            : "No monthly target set",
          "bg-violet-50")}
        {metric(<Target className="h-3.5 w-3.5 text-amber-600" />, "Below target days",
          view.belowTargetDays, `${view.belowTargetDays} day${view.belowTargetDays === 1 ? "" : "s"}`, "bg-amber-50")}
        {metric(<Target className="h-3.5 w-3.5 text-emerald-600" />, "Above target days",
          view.aboveTargetDays, `${view.aboveTargetDays} day${view.aboveTargetDays === 1 ? "" : "s"}`, "bg-emerald-50")}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="m-0 text-sm font-black tracking-wide text-gray-900">
            {view.days.length > 0 ? monthTitle(view.days[0].day) : "NO DAYS IN RANGE"}
          </p>
          <div className="mt-3 overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-7 gap-px rounded-lg bg-gray-200">
              {WEEKDAYS.map((name) => (
                <div key={name} className="bg-gray-50 px-2 py-2 text-center text-[11px] font-black text-gray-500">{name}</div>
              ))}
              {Array.from({ length: grid.lead }).map((_, index) => (
                <div key={`lead-${index}`} className="bg-white px-2 py-3" />
              ))}
              {grid.days.map((row) => {
                const style = STATUS_STYLE[row.status];
                const isSelected = row.day === selectedDay;
                const empty = row.status === "none";
                return (
                  <button
                    key={row.day}
                    type="button"
                    onClick={() => setSelectedDay(isSelected ? null : row.day)}
                    className={`!min-h-0 border-l-2 px-2 py-2 text-left transition-colors ${style.cell} ${
                      isSelected ? "ring-2 ring-inset ring-sky-500" : ""}`}
                  >
                    <span className={`block text-[12px] font-black ${style.date}`}>{dayNumber(row.day)}</span>
                    <span className="mt-1 block space-y-0.5 text-[10px] font-bold tabular-nums text-gray-600">
                      <span className="block">F: {empty ? "–" : row.followUp}</span>
                      <span className="block">R: {empty ? "–" : row.retention}</span>
                      <span className="block">D: {empty ? "–" : row.delivered}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selected && (
            <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
              <p className="m-0 text-[11px] font-black uppercase tracking-wider text-sky-800">
                {new Date(`${selected.day}T12:00:00Z`).toLocaleDateString("en-NG",
                  { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              </p>
              <div className="mt-2 flex flex-wrap gap-4 text-[12px] font-bold text-gray-800">
                <span>Follow-up picks: <span className="tabular-nums">{selected.followUp}</span>
                  {targets.followUp > 0 && <span className="font-semibold text-gray-400"> / {targets.followUp}</span>}</span>
                <span>Retention picks: <span className="tabular-nums">{selected.retention}</span>
                  {targets.retention > 0 && <span className="font-semibold text-gray-400"> / {targets.retention}</span>}</span>
                <span>Delivered: <span className="tabular-nums">{selected.delivered}</span>
                  {targets.delivered > 0 && <span className="font-semibold text-gray-400"> / {targets.delivered}</span>}</span>
              </div>
              <p className="m-0 mt-1.5 text-[11px] font-semibold text-gray-600">
                {selected.status === "rest" ? "Sunday — a rest day, so no target applied and it counts against nothing."
                  : selected.status === "none" ? "Nothing recorded for this day yet."
                    : selected.status === "above" ? "Every target met."
                      : `Short of target${selected.attainment !== null ? ` — reached ${Math.round(selected.attainment * 100)}% of the weakest one` : ""}.`}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">Calendar legend</p>
            <ul className="m-0 mt-2 list-none space-y-1.5 p-0 text-[12px] font-semibold text-gray-700">
              <li className="flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-emerald-600" /> F — Picked, follow-up</li>
              <li className="flex items-center gap-2"><RefreshCw className="h-3.5 w-3.5 text-sky-600" /> R — Picked, retention</li>
              <li className="flex items-center gap-2"><CheckSquare className="h-3.5 w-3.5 text-violet-600" /> D — Delivered recovery orders</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-rose-300 bg-rose-50" /> Critical — under half of target</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-amber-300 bg-amber-50" /> Below target</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-emerald-200 bg-emerald-50" /> Above target</li>
              <li className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm border border-gray-200 bg-gray-50" /> Sunday — rest day</li>
            </ul>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4">
            <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-gray-500">Target guide</p>
            <dl className="m-0 mt-2 space-y-1.5 text-[12px]">
              {[
                ["Daily target (picked – follow-up)", String(targets.followUp)],
                ["Daily target (picked – retention)", String(targets.retention)],
                ["Daily target (delivered recovery)", String(targets.delivered)],
                ["Bonus per recovered order", formatMoney(view.bonusPerRecoveredOrder)]
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <dt className="m-0 font-semibold text-gray-600">{label}</dt>
                  <dd className="m-0 font-black tabular-nums text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="m-0 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/60 px-3 py-2.5 text-[11px] font-semibold text-sky-900">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Click any day to see its breakdown. Counts are per day, so an order
            worked on three days counts three times — that is what a daily
            target measures.
          </p>
        </div>
      </div>

      <p className="m-0 mt-3 text-[11px] font-semibold text-gray-500">
        Counts are based on your selected range: {view.from} to {view.to}.
      </p>
    </div>
  );
}
