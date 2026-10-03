import { useState } from "react";
import { BadgeCheck, CalendarClock, CheckCircle2, ChevronDown, Info, Trophy, Undo2 } from "lucide-react";

// Monthly incentive for one product challenge (Bright, 3 Oct 2026).
// The reward each person earned from the challenge's milestones is paid in the
// first week after the month, cut by their delivery rate for the month:
//   70%+ full · 65–69% half · 60–64% quarter · under 60% nothing. Whole
//   percents, rounded like the Manager Dashboard (64.7% counts as 65%).
// Reps see their own line and where they stand on the ladder; Manager, Admin
// and Owner see everyone and mark payments. Built for phones first.

export type IncentiveLine = {
  kind: "rep" | "manager";
  personId: string | null;
  personName: string;
  rewardAmount: number;
  earned: number;
  placed: number;
  delivered: number;
  rate: number | null;
  tier: { percent: number; label: string; minRate: number | null; nextPercent: number | null; nextMinRate: number | null; pointsToNext: number | null };
  payable: number;
  paid: { paidAt: string; paidBy: string | null; amount: number; earned: number; rate: number | null; tierPercent: number; personName: string | null; note: string | null } | null;
};

export type ChallengeIncentive = {
  from: string; to: string; rateFrom?: string; rateTo?: string; dueFrom: string; dueBy: string;
  status: "accruing" | "due" | "overdue";
  manager: IncentiveLine | null;
  reps: IncentiveLine[];
};

const TIERS = [
  { min: 0, max: 60, percent: 0, label: "Nothing", bar: "bg-rose-400", soft: "bg-rose-50 text-rose-700 ring-rose-200" },
  { min: 60, max: 65, percent: 25, label: "Quarter", bar: "bg-orange-400", soft: "bg-orange-50 text-orange-700 ring-orange-200" },
  { min: 65, max: 70, percent: 50, label: "Half", bar: "bg-amber-400", soft: "bg-amber-50 text-amber-800 ring-amber-200" },
  { min: 70, max: 100, percent: 100, label: "Full", bar: "bg-emerald-500", soft: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
];
const tierOf = (percent: number) => TIERS.find((tier) => tier.percent === percent) ?? TIERS[0];
const day = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

/** The 60 / 65 / 70 doors on a bar zoomed to 50–80% so they are readable on a phone; a rate outside sits at the end. */
function TierLadder({ rate, compact = false }: { rate: number | null; compact?: boolean }) {
  const lo = 50;
  const hi = 80;
  const pos = (value: number) => `${Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className={compact ? "mt-2" : "mt-3"}>
      <div className="relative h-3 overflow-hidden rounded-full">
        {TIERS.map((tier) => (
          <span key={tier.label} className={`absolute top-0 h-full ${tier.bar} opacity-80`} style={{ left: pos(tier.min), width: `calc(${pos(tier.max)} - ${pos(tier.min)})` }} />
        ))}
      </div>
      <div className="relative h-5">
        {rate !== null ? (
          <span className="absolute -top-[19px] -ml-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full border-[3px] border-white bg-slate-900 shadow" style={{ left: `clamp(9px, ${pos(rate)}, calc(100% - 9px))` }} aria-label={`Delivery rate ${rate}%`} />
        ) : null}
        {[60, 65, 70].map((mark) => (
          <span key={mark} className="absolute top-0.5 -translate-x-1/2 text-[10.5px] font-bold text-gray-500" style={{ left: pos(mark) }}>{mark}%</span>
        ))}
      </div>
      {!compact ? (
        <div className="mt-1 grid grid-cols-4 gap-1 text-center text-[10.5px] font-semibold">
          {TIERS.map((tier) => (
            <span key={tier.label} className={`rounded-md px-1 py-1 leading-tight ring-1 ${tier.soft}`}>
              <span className="block">{tier.label}</span>
              <span className="block text-[10px] font-medium opacity-80">{tier.min === 0 ? "under 60%" : tier.max === 100 ? "70%+" : `${tier.min}–${tier.max - 1}%`}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatusChip({ incentive, allPaid }: { incentive: ChallengeIncentive; allPaid: boolean }) {
  if (allPaid) return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />All paid</span>;
  if (incentive.status === "accruing") return <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-bold text-violet-700"><CalendarClock className="h-3.5 w-3.5" />Paid {day(incentive.dueFrom)}–{day(incentive.dueBy)}</span>;
  if (incentive.status === "due") return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11.5px] font-bold text-amber-800"><CalendarClock className="h-3.5 w-3.5" />Due · pay by {day(incentive.dueBy)}</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-[11.5px] font-bold text-rose-700"><CalendarClock className="h-3.5 w-3.5" />Overdue since {day(incentive.dueBy)}</span>;
}

/** The rep's own view: one big card, where they stand and what it pays. */
function MyIncentive({ line, incentive, money }: { line: IncentiveLine; incentive: ChallengeIncentive; money: (n: number) => string }) {
  const tier = tierOf(line.paid?.tierPercent ?? line.tier.percent);
  const rate = line.paid?.rate ?? line.rate;
  return (
    <div className="rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50/70 via-white to-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-violet-700">Your monthly incentive</p>
          <p className="m-0 mt-0.5 text-[12px] text-gray-500">Pieces {day(incentive.from)} – {day(incentive.to)} · delivery rate {day(incentive.rateFrom ?? incentive.from)} – {day(incentive.rateTo ?? incentive.to)} · paid the first week after</p>
        </div>
        {line.paid ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" />Paid {when(line.paid.paidAt)}</span> : <StatusChip incentive={incentive} allPaid={false} />}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-white p-2.5 ring-1 ring-gray-100"><span className="block text-[11px] text-gray-500">Earned</span><strong className="block text-[16px] font-black text-gray-900 sm:text-[18px]">{money(line.paid?.earned ?? line.earned)}</strong><span className="block text-[10.5px] text-gray-400">of {money(line.rewardAmount)}</span></div>
        <div className={`rounded-xl p-2.5 ring-1 ${tier.soft}`}><span className="block text-[11px]">Delivery rate</span><strong className="block text-[16px] font-black sm:text-[18px]">{rate === null ? "—" : `${rate}%`}</strong><span className="block text-[10.5px]">{tier.label} · {tier.percent}%</span></div>
        <div className="rounded-xl bg-slate-900 p-2.5 text-white"><span className="block text-[11px] text-slate-300">{line.paid ? "Paid" : "You get"}</span><strong className="block text-[16px] font-black sm:text-[18px]">{money(line.paid?.amount ?? line.payable)}</strong><span className="block text-[10.5px] text-slate-400">{line.delivered} of {line.placed} delivered</span></div>
      </div>
      <TierLadder rate={rate} />
      {!line.paid ? (
        <p className="m-0 mt-2 flex items-start gap-1.5 rounded-lg bg-white p-2.5 text-[12.5px] text-gray-700 ring-1 ring-gray-100">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
          {line.rate === null ? "No orders placed yet this month."
            : line.tier.nextPercent === null ? "You're at the top tier: you get your full earned reward."
            : `Get to ${line.tier.nextMinRate}% (${line.tier.pointsToNext} points more) to get ${line.tier.nextPercent}% of your earned reward.`}
        </p>
      ) : null}
    </div>
  );
}

function PersonRow({ line, canPay, canUndo, busy, onPay, onUndo, money }: { line: IncentiveLine; canPay: boolean; canUndo: boolean; busy: boolean; onPay: () => void; onUndo: () => void; money: (n: number) => string }) {
  const [open, setOpen] = useState(false);
  const tier = tierOf(line.paid?.tierPercent ?? line.tier.percent);
  const rate = line.paid?.rate ?? line.rate;
  return (
    <li className="rounded-xl border border-gray-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={() => setOpen((value) => !value)} className="!min-h-0 flex w-full items-center gap-3 text-left">
        <span className={`hidden h-10 w-10 sm:inline-flex shrink-0 items-center justify-center rounded-full text-[14px] font-black ${line.kind === "manager" ? "bg-indigo-100 text-indigo-700" : "bg-violet-100 text-violet-700"}`}>{line.personName.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5"><strong className="min-w-0 truncate text-[14px] text-gray-900 dark:text-slate-100">{line.personName}</strong>{line.kind === "manager" ? <span className="shrink-0 rounded bg-indigo-50 px-1.5 text-[10px] font-bold text-indigo-700">Manager</span> : null}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-gray-500">
            <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-bold ring-1 ${tier.soft}`}>{rate === null ? "—" : `${rate}%`} · {tier.label}</span>
            <span className="whitespace-nowrap">earned {money(line.paid?.earned ?? line.earned)}</span>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <strong className="block text-[15px] font-black text-gray-900 dark:text-slate-100">{money(line.paid?.amount ?? line.payable)}</strong>
          {line.paid ? <span className="text-[11px] font-semibold text-emerald-600">Paid {when(line.paid.paidAt)}</span> : <span className="text-[11px] text-gray-400">to pay</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mt-2 border-t border-gray-100 pt-2 dark:border-slate-800">
          <TierLadder rate={rate} compact />
          <p className="m-0 mt-1 text-[12px] text-gray-600 dark:text-slate-300">
            {line.kind === "manager" ? "Company" : "Own"} orders this month: {line.delivered} delivered of {line.placed} placed. Earned {money(line.paid?.earned ?? line.earned)} of {money(line.rewardAmount)} × {tier.percent}% = <strong>{money(line.paid?.amount ?? line.payable)}</strong>.
            {line.paid ? ` Marked paid by ${line.paid.paidBy ?? "—"} on ${when(line.paid.paidAt)}${line.paid.note ? ` · "${line.paid.note}"` : ""}.` : ""}
          </p>
        </div>
      ) : null}
      {canPay && !line.paid && line.payable <= 0 ? (
        <p className="m-0 mt-2 rounded-lg bg-gray-50 px-3 py-2 text-center text-[12px] text-gray-500 dark:bg-slate-800">Nothing to pay: {line.earned <= 0 ? "no milestone reached" : "delivery rate under 60%"}.</p>
      ) : null}
      {canPay && !line.paid && line.payable > 0 ? (
        <button type="button" disabled={busy} onClick={onPay} className="mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-[14px] font-bold text-white active:scale-[0.99] disabled:opacity-50">
          <CheckCircle2 className="h-5 w-5" /> {busy ? "Saving…" : `Mark ${money(line.payable)} paid`}
        </button>
      ) : null}
      {canUndo && line.paid ? (
        <button type="button" disabled={busy} onClick={onUndo} className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-4 text-[13px] font-semibold text-gray-600 disabled:opacity-50"><Undo2 className="h-4 w-4" /> Undo paid</button>
      ) : null}
    </li>
  );
}

export function ChallengeIncentivePanel({ incentive, currency, role, repMode, formatMoney, onMarkPaid, onUndoPaid }: {
  incentive: ChallengeIncentive;
  currency: string;
  role: string;
  repMode: boolean;
  formatMoney: (amount: number, currency: string) => string;
  onMarkPaid?: (lines: IncentiveLine[]) => Promise<void>;
  onUndoPaid?: (line: IncentiveLine) => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const money = (value: number) => formatMoney(value, currency);
  if (repMode) {
    const mine = incentive.reps[0];
    return mine ? <MyIncentive line={mine} incentive={incentive} money={money} /> : null;
  }
  const lines = [...(incentive.manager ? [incentive.manager] : []), ...incentive.reps];
  const canPay = ["Manager", "Admin", "Owner"].includes(role) && incentive.status !== "accruing" && Boolean(onMarkPaid);
  const canUndo = role === "Owner" && Boolean(onUndoPaid);
  const unpaid = lines.filter((line) => !line.paid && line.payable > 0);
  const totalPayable = lines.reduce((sum, line) => sum + (line.paid?.amount ?? line.payable), 0);
  const totalPaid = lines.reduce((sum, line) => sum + (line.paid?.amount ?? 0), 0);
  const allPaid = lines.length > 0 && lines.every((line) => line.paid || line.payable <= 0) && incentive.status !== "accruing";
  const run = async (key: string, action: () => Promise<void>) => { setBusy(key); try { await action(); } finally { setBusy(""); } };
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700"><Trophy className="h-5 w-5" /></span>
          <div>
            <h3 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Monthly incentive</h3>
            <p className="m-0 text-[12px] text-gray-500">Pieces {day(incentive.from)} – {day(incentive.to)} · delivery rate {day(incentive.rateFrom ?? incentive.from)} – {day(incentive.rateTo ?? incentive.to)}</p>
          </div>
        </div>
        <StatusChip incentive={incentive} allPaid={allPaid} />
      </div>
      <TierLadder rate={null} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800"><span className="block text-[11px] text-gray-500">To pay for the month</span><strong className="text-[17px] font-black text-gray-900 dark:text-slate-100">{money(totalPayable)}</strong></div>
        <div className="rounded-xl bg-emerald-50 p-3"><span className="block text-[11px] text-emerald-700">Paid so far</span><strong className="text-[17px] font-black text-emerald-800">{money(totalPaid)}</strong></div>
      </div>
      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {lines.map((line) => (
          <PersonRow key={`${line.kind}${line.personId}`} line={line} canPay={canPay} canUndo={canUndo} busy={busy === `${line.kind}${line.personId}`} money={money}
            onPay={() => void run(`${line.kind}${line.personId}`, () => onMarkPaid!([line]))} onUndo={() => void run(`${line.kind}${line.personId}`, () => onUndoPaid!(line))} />
        ))}
      </ul>
      {canPay && unpaid.length > 1 ? (
        <button type="button" disabled={Boolean(busy)} onClick={() => { if (window.confirm(`Mark ${unpaid.length} people paid, ${money(unpaid.reduce((sum, line) => sum + line.payable, 0))} in total? It will be recorded as a Bonuses & Incentives expense, shared across the challenge weeks.`)) void run("all", () => onMarkPaid!(unpaid)); }}
          className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-[14px] font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
          <BadgeCheck className="h-5 w-5" /> {busy === "all" ? "Saving…" : `Mark all ${unpaid.length} paid`}
        </button>
      ) : null}
      {canPay ? (
        <p className="m-0 mt-2 text-center text-[11.5px] text-gray-500">
          Marking someone paid records it as a <strong>Bonuses &amp; Incentives</strong> expense, shared equally across the challenge weeks ({day(incentive.from)} – {day(incentive.to)}), so no single week carries it all.
        </p>
      ) : null}
      {incentive.status === "accruing" ? <p className="m-0 mt-2 text-center text-[11.5px] text-gray-400">Payments open on {day(incentive.dueFrom)}, after the month ends. Rates and amounts update until then.</p> : null}
    </section>
  );
}
