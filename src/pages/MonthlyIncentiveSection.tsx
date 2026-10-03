import { BadgeCheck, CalendarClock, Trophy } from "lucide-react";
import type { MonthlyIncentiveReport } from "./weekly-report-model";

// The month's incentive inside the weekly report, shown only in the week the
// month ends (Bright, 3 Oct 2026). Earned reward × delivery-rate tier, one
// block per product. Paid separately - never part of the weekly bonus.

const TIER = {
  100: { label: "Full", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  50: { label: "Half", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  25: { label: "Quarter", chip: "bg-orange-50 text-orange-700 ring-orange-200" },
  0: { label: "Nothing", chip: "bg-rose-50 text-rose-700 ring-rose-200" }
} as Record<number, { label: string; chip: string }>;
const tier = (percent: number) => TIER[percent] ?? TIER[0];
const day = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long" });

export default function MonthlyIncentiveSection({ report, sym, mine = false }: { report: MonthlyIncentiveReport; sym: string; mine?: boolean }) {
  const nf = (value: number) => Math.round(value).toLocaleString("en-NG");
  const products = Array.from(new Set(report.lines.map((line) => line.productName)));
  const total = report.lines.reduce((sum, line) => sum + line.payable, 0);
  const paid = report.lines.filter((line) => line.paidAt).reduce((sum, line) => sum + line.payable, 0);
  return (
    <section className="rounded-2xl border border-violet-200 bg-white shadow-sm dark:border-violet-500/30 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-white px-4 py-3.5 dark:border-slate-800 dark:from-violet-500/10 dark:to-slate-900 sm:px-5">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Trophy className="h-5 w-5" /></span>
          <div>
            <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">{mine ? "Your" : ""} {monthName(report.to)} Monthly Incentive</h2>
            <p className="m-0 text-[12px] text-gray-500 dark:text-slate-400">{day(report.from)} – {day(report.to)} · earned reward × delivery-rate tier</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
          <CalendarClock className="h-3.5 w-3.5" /> Paid {day(report.dueFrom)}–{day(report.dueBy)}
        </span>
      </div>
      <div className="space-y-3 px-3 py-3 sm:px-5 sm:py-4">
        <div className="grid grid-cols-4 gap-1 text-center text-[10.5px] font-semibold">
          {[100, 50, 25, 0].map((percent) => (
            <span key={percent} className={`rounded-md px-1 py-1 leading-tight ring-1 ${tier(percent).chip}`}>
              <span className="block">{tier(percent).label}</span>
              <span className="block text-[10px] font-medium opacity-80">{percent === 100 ? "70%+" : percent === 50 ? "65–70%" : percent === 25 ? "60–65%" : "under 60%"}</span>
            </span>
          ))}
        </div>
        {products.map((product) => (
          <div key={product} className="rounded-xl border border-gray-100 dark:border-slate-800">
            <p className="m-0 border-b border-gray-100 px-3 py-2 text-[12.5px] font-black text-gray-900 dark:border-slate-800 dark:text-slate-100">{product}</p>
            <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
              {report.lines.filter((line) => line.productName === product).map((line) => (
                <li key={`${line.challengeId}${line.kind}${line.personId}`} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-gray-900 dark:text-slate-100">
                      <span className="truncate">{line.personName}</span>
                      {line.kind === "manager" ? <span className="shrink-0 rounded bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-700">Manager</span> : null}
                    </p>
                    <p className="m-0 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-gray-500 dark:text-slate-400">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-bold ring-1 ${tier(line.tierPercent).chip}`}>{line.rate === null ? "—" : `${line.rate}%`} · {tier(line.tierPercent).label}</span>
                      <span className="whitespace-nowrap">{line.delivered} of {line.placed} delivered</span>
                      <span className="whitespace-nowrap">earned {sym}{nf(line.earned)} of {sym}{nf(line.rewardAmount)}</span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-50">{sym}{nf(line.payable)}</p>
                    {line.paidAt
                      ? <p className="m-0 inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600"><BadgeCheck className="h-3.5 w-3.5" />Paid</p>
                      : <p className="m-0 text-[11px] text-gray-400">{line.tierPercent}% of earned</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-slate-900 px-3 py-2.5 text-white dark:bg-slate-100 dark:text-slate-900">
            <span className="block text-[11px] opacity-70">{mine ? "You get" : "Total incentive"}</span>
            <strong className="text-[17px] font-black">{sym}{nf(total)}</strong>
          </div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            <span className="block text-[11px]">Paid so far</span>
            <strong className="text-[17px] font-black">{sym}{nf(paid)}</strong>
          </div>
        </div>
        <p className="m-0 text-[11px] text-gray-500 dark:text-slate-400">Paid separately from the weekly bonus. Rates count {mine ? "your" : "each person's"} orders placed {day(report.from)} – {day(report.to)} and delivered in that time{mine ? "" : "; the manager's rate counts the whole company"}.</p>
      </div>
    </section>
  );
}
