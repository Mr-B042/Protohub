import { useEffect, useState } from "react";
import { formatCountdownWords, msUntilLagosHour } from "../lib/cart-log-countdown";

type Props = {
  /** Small caps kicker, e.g. "Cart log charge risk". */
  label: string;
  /** The money on the line right now. */
  amount: number;
  /** The sentence under the headline: what is owed and how to clear it. */
  detail: string;
  /** Hour of the Lagos day the window shuts. 24 = midnight. */
  cutoffHour: number;
  /** How that hour reads to a person, e.g. "midnight" or "10:00 PM". */
  cutoffLabel: string;
  /** Before go-live: same banner, but nothing can actually be charged. */
  rehearsal?: boolean;
};

/**
 * The full-width "you are about to be charged" banner.
 *
 * ⚠️ Deliberately the same shape as the follow-up charge-risk banner rather
 * than a second design. Reps meet both, and two different-looking warnings for
 * the same kind of money is how people learn to read neither.
 *
 * The clock is here, inside its own component, so a per-second tick re-renders
 * the banner alone and never the table beneath it.
 */
export default function ChargeRiskBanner({
  label, amount, detail, cutoffHour, cutoffLabel, rehearsal
}: Props) {
  const [remaining, setRemaining] = useState(() => msUntilLagosHour(Date.now(), cutoffHour));

  useEffect(() => {
    const tick = () => setRemaining(msUntilLagosHour(Date.now(), cutoffHour));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [cutoffHour]);

  const closed = remaining <= 0;
  // The last hour pulses. Anything earlier does not - a banner that flashes all
  // day is one nobody sees by mid-morning.
  const urgent = !rehearsal && !closed && remaining <= 60 * 60 * 1000;

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${
      rehearsal
        ? "border-amber-200 bg-gradient-to-r from-amber-50 via-orange-50 to-yellow-50 dark:border-amber-400/25 dark:from-amber-500/15 dark:via-orange-500/10 dark:to-yellow-500/10"
        : "border-rose-200 bg-gradient-to-r from-rose-50 via-orange-50 to-amber-50 dark:border-rose-400/25 dark:from-rose-500/15 dark:via-orange-500/10 dark:to-amber-500/10"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-lg font-black text-white shadow-sm ${
            rehearsal ? "bg-amber-500" : "bg-rose-600"}`}>₦</span>
          <div className="min-w-0">
            <p className={`m-0 text-sm font-black uppercase tracking-wide ${
              rehearsal ? "text-amber-700 dark:text-amber-200" : "text-rose-700 dark:text-rose-200"}`}>
              {label}
            </p>
            <h3 className="m-0 mt-1 text-2xl font-black text-gray-950 dark:text-slate-100">
              ₦{Math.max(0, Math.round(amount)).toLocaleString("en-NG")}{rehearsal ? " would be charged today" : " can be charged today"}
            </h3>
            <p className={`m-0 mt-1 text-xs font-semibold leading-relaxed ${
              rehearsal ? "text-amber-800 dark:text-amber-100" : "text-rose-800 dark:text-rose-100"}`}>
              {detail}
            </p>
          </div>
        </div>
        <div className={`rounded-2xl border border-white/70 bg-white/90 px-4 py-3 text-center shadow-sm lg:min-w-[210px] dark:border-slate-700 dark:bg-slate-950/80 ${
          urgent ? "cart-countdown-critical" : ""}`}>
          <p className="m-0 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 dark:text-slate-500">
            Countdown to charge
          </p>
          <p className={`m-0 mt-1 text-2xl font-black tabular-nums ${
            closed ? "text-rose-700 dark:text-rose-200" : "text-gray-950 dark:text-slate-100"}`}>
            {closed ? "charge window reached" : formatCountdownWords(remaining)}
          </p>
          <p className="m-0 mt-1 text-[11px] font-semibold text-gray-500 dark:text-slate-400">
            {closed
              ? (rehearsal ? "Practice only — nothing is recorded." : "Pending fees can now be recorded.")
              : `Closes at ${cutoffLabel} today.`}
          </p>
        </div>
      </div>
    </div>
  );
}
