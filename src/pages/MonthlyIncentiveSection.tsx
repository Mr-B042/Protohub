import { useState } from "react";
import { BadgeCheck, CalendarClock, Check, ChevronDown, Clock, Package, Trophy, X } from "lucide-react";
import type { IncentiveMilestone, MonthlyIncentiveLine, MonthlyIncentiveReport } from "./weekly-report-model";

// The month's incentive inside the weekly report, shown only in the week the
// month ends (Bright, 3 Oct 2026). Earned reward × delivery-rate tier.
// Laid out as: the month at a glance (orders, delivered, rate, money), each
// product's pieces against target, then every person's earnings broken down
// product by product and week by week. Paid separately from the weekly bonus.

const TIER: Record<number, { label: string; chip: string }> = {
  100: { label: "Full", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  50: { label: "Half", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  25: { label: "Quarter", chip: "bg-orange-50 text-orange-700 ring-orange-200" },
  0: { label: "Nothing", chip: "bg-rose-50 text-rose-700 ring-rose-200" }
};
const tier = (percent: number) => TIER[percent] ?? TIER[0];
const day = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long" });
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

const MILESTONE_TONE: Record<string, { box: string; icon: typeof Check }> = {
  Earned: { box: "border-emerald-200 bg-emerald-50 text-emerald-800", icon: Check },
  Missed: { box: "border-rose-200 bg-rose-50 text-rose-700", icon: X },
  "In Progress": { box: "border-blue-200 bg-blue-50 text-blue-800", icon: Clock },
  Upcoming: { box: "border-gray-200 bg-gray-50 text-gray-500", icon: Clock },
  Behind: { box: "border-amber-200 bg-amber-50 text-amber-800", icon: Clock }
};
const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });

type Person = { key: string; kind: "rep" | "manager"; name: string; lines: MonthlyIncentiveLine[] };

function Stat({ label, value, sub, tone = "bg-gray-50 text-gray-900 dark:bg-slate-800 dark:text-slate-100" }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${tone}`}>
      <span className="block text-[11px] opacity-70">{label}</span>
      <strong className="block text-[17px] font-black leading-tight">{value}</strong>
      {sub ? <span className="block text-[10.5px] opacity-70">{sub}</span> : null}
    </div>
  );
}

function Milestones({ milestones, money }: { milestones: IncentiveMilestone[]; money: (n: number) => string }) {
  if (milestones.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {milestones.map((milestone) => {
        // Weeks are a running total: a week that has ended short can still be
        // earned by catching up before the month ends.
        const behind = milestone.status === "In Progress" && milestone.endDate < todayKey;
        const label = behind ? "Behind" : milestone.status;
        const tone = behind ? MILESTONE_TONE.Behind : MILESTONE_TONE[milestone.status] ?? MILESTONE_TONE.Upcoming;
        const Icon = tone.icon;
        return (
          <div key={milestone.index} className={`rounded-lg border px-2 py-1.5 ${tone.box}`}>
            <p className="m-0 flex items-center justify-between gap-1 text-[11px] font-bold">
              <span>Week {milestone.index}</span>
              <span className="inline-flex items-center gap-0.5"><Icon className="h-3 w-3" />{label}</span>
            </p>
            <p className="m-0 text-[10.5px] opacity-80">{day(milestone.startDate)} – {day(milestone.endDate)}</p>
            <p className="m-0 mt-0.5 text-[11.5px] font-semibold">{milestone.progressUnits}/{milestone.targetUnits} pcs</p>
            <p className="m-0 text-[11.5px] font-black">{milestone.status === "Earned" ? money(milestone.earnedRewardAmount) : `${money(0)} of ${money(milestone.rewardAmount)}`}</p>
            {behind ? <p className="m-0 text-[10px] opacity-80">can still catch up</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function PersonCard({ person, money, startOpen }: { person: Person; money: (n: number) => string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const first = person.lines[0];
  const earned = person.lines.reduce((sum, line) => sum + line.earned, 0);
  const max = person.lines.reduce((sum, line) => sum + line.rewardAmount, 0);
  const payable = person.lines.reduce((sum, line) => sum + line.payable, 0);
  const allPaid = person.lines.every((line) => line.paidAt || line.payable <= 0) && person.lines.some((line) => line.paidAt);
  const t = tier(first.tierPercent);
  return (
    <li className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <button type="button" onClick={() => setOpen((value) => !value)} className="!min-h-[56px] flex w-full items-center gap-3 px-3 py-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <strong className="min-w-0 truncate text-[14px] text-gray-900 dark:text-slate-100">{person.name}</strong>
            {person.kind === "manager" ? <span className="shrink-0 rounded bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-700">Manager</span> : null}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-gray-500 dark:text-slate-400">
            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-bold ring-1 ${t.chip}`}>{first.rate === null ? "—" : `${first.rate}%`} · {t.label}</span>
            <span className="whitespace-nowrap">{first.delivered} of {first.placed} orders delivered</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <strong className="block text-[16px] font-black text-gray-900 dark:text-slate-50">{money(payable)}</strong>
          {allPaid ? <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-600"><BadgeCheck className="h-3.5 w-3.5" />Paid</span> : <span className="text-[11px] text-gray-400">to be paid</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className="m-0 border-t border-gray-100 bg-gray-50/70 px-3 py-2 text-[12px] text-gray-700 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-200">
        Earned <strong>{money(earned)}</strong> of {money(max)} × <strong>{first.tierPercent}%</strong> ({t.label}) = <strong className="text-gray-950 dark:text-white">{money(payable)}</strong>
      </p>
      {open ? (
        <div className="space-y-2.5 border-t border-gray-100 px-3 py-3 dark:border-slate-800">
          {person.lines.map((line) => (
            <div key={line.challengeId} className="rounded-lg border border-gray-100 p-2.5 dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="m-0 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100"><Package className="h-4 w-4 text-violet-500" />{line.productName}</p>
                <p className="m-0 text-right text-[12px] text-gray-600 dark:text-slate-300">
                  {money(line.earned)} of {money(line.rewardAmount)} × {line.tierPercent}% = <strong className="text-gray-950 dark:text-white">{money(line.payable)}</strong>
                  {line.paidAt ? <span className="ml-1 font-semibold text-emerald-600">· Paid</span> : null}
                </p>
              </div>
              {(line.targetUnits ?? 0) > 0 ? (
                <div className="mt-1.5">
                  <div className="flex justify-between text-[11px] text-gray-500 dark:text-slate-400">
                    <span>{person.kind === "manager" ? "Team pieces delivered" : "Pieces delivered"}</span>
                    <span className="font-semibold text-gray-700 dark:text-slate-200">{line.deliveredUnits ?? 0} / {line.targetUnits} pcs · {pctOf(line.deliveredUnits ?? 0, line.targetUnits ?? 0)}%</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400" style={{ width: `${pctOf(line.deliveredUnits ?? 0, line.targetUnits ?? 0)}%` }} /></div>
                </div>
              ) : null}
              <Milestones milestones={line.milestones ?? []} money={money} />
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export default function MonthlyIncentiveSection({ report, sym, mine = false }: { report: MonthlyIncentiveReport; sym: string; mine?: boolean }) {
  const money = (value: number) => `${sym}${Math.round(value).toLocaleString("en-NG")}`;
  const products = Array.from(new Set(report.lines.map((line) => line.productName)));

  // One card per person, holding their line for each product.
  const people = new Map<string, Person>();
  for (const line of report.lines) {
    const key = `${line.kind}:${line.personId ?? line.personName}`;
    const person = people.get(key) ?? { key, kind: line.kind, name: line.personName, lines: [] };
    person.lines.push(line);
    people.set(key, person);
  }
  const personList = Array.from(people.values()).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "manager" ? -1 : 1;
    const pay = (person: Person) => person.lines.reduce((sum, line) => sum + line.payable, 0);
    return pay(b) - pay(a) || a.name.localeCompare(b.name);
  });

  // The month at a glance: the company's orders (the manager line counts the
  // whole company), or the rep's own on their report.
  const headline = report.lines.find((line) => line.kind === "manager") ?? report.lines[0];
  const earned = report.lines.reduce((sum, line) => sum + line.earned, 0);
  const max = report.lines.reduce((sum, line) => sum + line.rewardAmount, 0);
  const payable = report.lines.reduce((sum, line) => sum + line.payable, 0);
  const paid = report.lines.filter((line) => line.paidAt).reduce((sum, line) => sum + line.payable, 0);
  const headTier = tier(headline.tierPercent);

  return (
    <section className="rounded-2xl border border-violet-200 bg-white shadow-sm dark:border-violet-500/30 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-violet-100 bg-gradient-to-r from-violet-50 to-white px-4 py-3.5 dark:border-slate-800 dark:from-violet-500/10 dark:to-slate-900 sm:px-5">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Trophy className="h-5 w-5" /></span>
          <div>
            <h2 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">{mine ? "Your " : ""}{monthName(report.to)} Monthly Incentive</h2>
            <p className="m-0 text-[12px] text-gray-500 dark:text-slate-400">{day(report.from)} – {day(report.to)} · earned reward × delivery-rate tier</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
          <CalendarClock className="h-3.5 w-3.5" /> Paid {day(report.dueFrom)}–{day(report.dueBy)}
        </span>
      </div>

      <div className="space-y-4 px-3 py-3 sm:px-5 sm:py-4">
        {/* ── Month at a glance ── */}
        <div>
          <p className="m-0 mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">{mine ? "Your month" : "Company month"} at a glance</p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Orders placed" value={headline.placed.toLocaleString()} sub={`${day(report.from)} – ${day(report.to)}`} />
            <Stat label="Orders delivered" value={headline.delivered.toLocaleString()} sub="in the month" />
            <Stat label="Delivery rate" value={headline.rate === null ? "—" : `${headline.rate}%`} sub={`${headTier.label} tier · ${headline.tierPercent}% paid`}
              tone={`${headTier.chip} ring-1`} />
            <Stat label={mine ? "You get" : "Total to pay"} value={money(payable)} sub={`earned ${money(earned)} of ${money(max)}`} tone="bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
            <span>Paid so far: <strong>{money(paid)}</strong></span>
            <span>Still to pay: <strong>{money(Math.max(0, payable - paid))}</strong></span>
          </div>
        </div>

        {/* ── Each product ── */}
        <div>
          <p className="m-0 mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">By product</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {products.map((product) => {
              const lines = report.lines.filter((line) => line.productName === product);
              const lead = (mine ? lines[0] : lines.find((line) => line.kind === "manager")) ?? lines[0];
              const repLines = lines.filter((line) => line.kind === "rep");
              const done = (lead.milestones ?? []).filter((milestone) => milestone.status === "Earned").length;
              const percent = pctOf(lead.deliveredUnits ?? 0, lead.targetUnits ?? 0);
              return (
                <div key={product} className="rounded-xl border border-gray-100 p-3 dark:border-slate-800">
                  <p className="m-0 truncate text-[13px] font-black text-gray-900 dark:text-slate-100">{product}</p>
                  {(lead.targetUnits ?? 0) > 0 ? (
                    <>
                      <p className="m-0 mt-1 text-[20px] font-black text-violet-700">{lead.deliveredUnits ?? 0}<span className="text-[13px] font-semibold text-gray-400"> / {lead.targetUnits} pcs</span></p>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400" style={{ width: `${percent}%` }} /></div>
                      <p className="m-0 mt-1 text-[11px] text-gray-500">{percent}% of {mine ? "your" : "the team"} target · {done} of {(lead.milestones ?? []).length} weeks reached</p>
                    </>
                  ) : null}
                  <div className="mt-2 space-y-0.5 border-t border-gray-100 pt-2 text-[11.5px] text-gray-600 dark:border-slate-800 dark:text-slate-300">
                    {!mine && repLines.length > 0 ? (
                      <p className="m-0 flex justify-between"><span>Reps earned</span><strong>{money(repLines.reduce((sum, line) => sum + line.earned, 0))} / {money(repLines.reduce((sum, line) => sum + line.rewardAmount, 0))}</strong></p>
                    ) : null}
                    <p className="m-0 flex justify-between"><span>{mine ? "You earned" : "Paying out"}</span><strong>{money(mine ? lead.earned : lines.reduce((sum, line) => sum + line.payable, 0))}</strong></p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── The tiers ── */}
        <div className="grid grid-cols-4 gap-1 text-center text-[10.5px] font-semibold">
          {[100, 50, 25, 0].map((percent) => (
            <span key={percent} className={`rounded-md px-1 py-1 leading-tight ring-1 ${tier(percent).chip}`}>
              <span className="block">{tier(percent).label}</span>
              <span className="block text-[10px] font-medium opacity-80">{percent === 100 ? "70%+" : percent === 50 ? "65–70%" : percent === 25 ? "60–65%" : "under 60%"}</span>
            </span>
          ))}
        </div>

        {/* ── Each person's earnings ── */}
        <div>
          <p className="m-0 mb-2 text-[11px] font-black uppercase tracking-[0.12em] text-gray-500">{mine ? "How your incentive was worked out" : "Earnings by person"}</p>
          <ul className="m-0 list-none space-y-2 p-0">
            {personList.map((person) => <PersonCard key={person.key} person={person} money={money} startOpen={mine || personList.length === 1} />)}
          </ul>
        </div>

        <p className="m-0 text-[11px] text-gray-500 dark:text-slate-400">
          Paid separately from the weekly bonus. A week is earned when the pieces delivered reach that week's running target. The delivery rate counts {mine ? "your" : "each rep's"} orders placed {day(report.from)} – {day(report.to)} and the orders delivered in that time{mine ? "" : "; the manager's rate counts the whole company"}.
        </p>
      </div>
    </section>
  );
}
