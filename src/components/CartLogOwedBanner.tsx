import { AlertTriangle, Lock } from "lucide-react";
import type { CartLogMiss } from "../lib/api";

type Props = {
  misses: CartLogMiss[];
  /** Lagos today. Everything on or after this is the countdown's job, not ours. */
  todayKey: string;
  /** True when the view is scoped to one rep, so it can say "you". */
  personal: boolean;
};

/**
 * What is already owed for days that have CLOSED.
 *
 * ⚠️ Deliberately separate from the countdown banner. That one is about a day
 * a rep can still rescue; this one is about days they cannot. Reps were only
 * told about today, so a Monday that closed with forty carts unlogged showed
 * up as a small grey chip reading "1 day" and nothing about it said "you owe
 * ₦20,000" - which is the fact they needed.
 *
 * ⚠️ Nothing here is money taken. Every row is pending the Owner's decision
 * and says so, because at these amounts an unqualified "you owe" would be a
 * false statement about someone's pay.
 */
export default function CartLogOwedBanner({ misses, todayKey, personal }: Props) {
  // Closed days only, and never a waived one - a waived day is settled and
  // re-listing it would look like the decision had been reversed.
  const closed = (misses ?? []).filter((row) => row.missDate < todayKey && row.status !== "waived");
  if (closed.length === 0) return null;

  const total = closed.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const approved = closed.filter((row) => row.status === "approved");
  const approvedTotal = approved.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const dayCount = new Set(closed.map((row) => row.missDate)).size;
  const money = (value: number) => `₦ ${Math.max(0, Math.round(value)).toLocaleString("en-NG")}`;

  const dayLabel = (key: string) => {
    const date = new Date(`${key}T12:00:00Z`);
    return {
      weekday: date.toLocaleDateString("en-NG", { weekday: "long" }),
      date: date.toLocaleDateString("en-NG", { day: "numeric", month: "short" })
    };
  };

  // Newest first: the most recent closed day is the one still fresh enough to
  // argue about, and the one a rep is most likely to be looking for.
  const rows = [...closed].sort((left, right) => right.missDate.localeCompare(left.missDate));

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border-2 border-rose-300 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-rose-50 to-white px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-sm">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-black uppercase tracking-[0.14em] text-rose-700">
              {personal ? "Already owed — days that have closed" : "Already owed by the team"}
            </p>
            <p className="m-0 mt-0.5 text-2xl font-black leading-tight tracking-tight text-rose-900">
              {money(total)}
              <span className="ml-2 text-sm font-bold text-rose-700">
                across {dayCount} closed day{dayCount === 1 ? "" : "s"}
              </span>
            </p>
          </div>
        </div>
        <p className="m-0 max-w-xs text-[11px] font-semibold leading-relaxed text-rose-800">
          {personal
            ? "These days are finished — logging now cannot clear them. Clear today's board before midnight so tomorrow is not on this list."
            : "These days are finished. Approve or waive each one below."}
        </p>
      </div>

      <ul className="m-0 list-none divide-y divide-rose-100 p-0">
        {rows.map((row) => {
          const label = dayLabel(row.missDate);
          const settled = row.status === "approved";
          return (
            <li key={`${row.repId}-${row.missDate}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0">
                <span className="text-sm font-black text-slate-900">
                  {label.weekday}
                  <span className="ml-1.5 font-bold text-slate-400">{label.date}</span>
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">
                  {!personal && <span className="font-black text-slate-700">{row.repName} · </span>}
                  {row.cartsMissed} of {row.cartsDue} cart{row.cartsDue === 1 ? "" : "s"} left unlogged
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  settled ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-800"}`}>
                  {settled ? "Charged" : "Pending review"}
                </span>
                <span className="text-base font-black tabular-nums text-rose-700">{money(row.amount)}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="m-0 flex items-center gap-2 border-t border-rose-100 bg-rose-50/60 px-4 py-2.5 text-[11px] font-semibold text-rose-900">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        {approvedTotal > 0
          ? `${money(approvedTotal)} has been approved by the Owner. The rest is pending and is not deducted from anyone's pay until they decide.`
          : "Nothing here is deducted from anyone's pay unless the Owner approves it."}
      </p>
    </div>
  );
}
