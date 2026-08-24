import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import {
  COUNTDOWN_TIER_STYLE, countdownMessage, countdownTier, formatCountdown, msUntilEndOfLagosDay
} from "../lib/cart-log-countdown";

type Props = {
  cartsRemaining: number;
  amountAtRisk: number;
  /** Before go-live: the same clock, but no money is actually at stake. */
  rehearsal?: boolean;
};

/**
 * The deadline, as a clock, at a size a rep cannot miss on a phone.
 *
 * ⚠️ Ticks once a SECOND rather than once a minute. A minute-resolution timer
 * looks frozen, and a frozen clock is one people stop believing. The interval
 * is the only thing re-rendering - this component owns its own state so a
 * one-second tick never re-renders the cart table beside it.
 */
export default function CartLogCountdown({ cartsRemaining, amountAtRisk, rehearsal }: Props) {
  const [remaining, setRemaining] = useState(() => msUntilEndOfLagosDay(Date.now()));

  useEffect(() => {
    const timer = window.setInterval(() => setRemaining(msUntilEndOfLagosDay(Date.now())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (cartsRemaining <= 0) return null;

  const tier = countdownTier(remaining);
  // A rehearsal must never wear the critical pulse: the day is not costing
  // anyone anything yet, and crying wolf now spends the alarm early.
  const style = COUNTDOWN_TIER_STYLE[rehearsal ? "calm" : tier];

  return (
    <div className={`flex shrink-0 items-center gap-2.5 rounded-lg border px-3 py-2 ${style.chip}`}
      role="timer" aria-live="off"
      title={`Clears at midnight Lagos time. ${cartsRemaining} cart${cartsRemaining === 1 ? "" : "s"} still unlogged.`}>
      <Timer className={`h-5 w-5 shrink-0 ${style.digits}`} />
      <span className="min-w-0">
        <span className={`block font-mono text-2xl font-black leading-none tabular-nums tracking-tight ${style.digits}`}>
          {formatCountdown(remaining)}
        </span>
        <span className={`mt-0.5 block text-[11px] font-bold leading-tight ${style.note}`}>
          {rehearsal
            ? `practice — ${cartsRemaining} cart${cartsRemaining === 1 ? "" : "s"} would cost ₦${Math.max(0, amountAtRisk).toLocaleString("en-NG")}`
            : countdownMessage(remaining, cartsRemaining, amountAtRisk)}
        </span>
      </span>
    </div>
  );
}
