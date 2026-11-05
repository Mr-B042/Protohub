import { useEffect, useState } from "react";
import { AlarmClock, Moon, Timer } from "lucide-react";
import { LATE_SEND_MINUTES, lagosTimeText, sendOutTimer, type SendOutTimerInput } from "../lib/late-send-clock";

/**
 * Live send-out countdown on a New order (Bright, 5 Nov 2026). Same clock as
 * the late-send fine: 15 working minutes, nights and Sundays paused. Ticks
 * every second while it runs; a ring and a bar drain as the time goes.
 * The caller decides whether the order is timed at all (New, a Sales Rep's).
 */

const FULL_MS = LATE_SEND_MINUTES * 60_000;

type Mood = "calm" | "soon" | "now" | "late" | "rest";

const MOOD: Record<Mood, { box: string; ring: string; track: string; bar: string; label: string; clock: string; chip: string }> = {
  calm: {
    box: "border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 dark:border-sky-400/25 dark:from-sky-500/12 dark:via-[#0c1722] dark:to-cyan-500/10",
    ring: "stroke-sky-500", track: "stroke-sky-100 dark:stroke-sky-500/20", bar: "bg-gradient-to-r from-sky-400 to-cyan-400",
    label: "text-sky-700 dark:text-sky-300", clock: "text-sky-950 dark:text-sky-50",
    chip: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-400/30 dark:bg-sky-500/12 dark:text-sky-100"
  },
  soon: {
    box: "border-amber-300 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:border-amber-400/35 dark:from-amber-500/15 dark:via-[#0c1722] dark:to-orange-500/10",
    ring: "stroke-amber-500", track: "stroke-amber-100 dark:stroke-amber-500/20", bar: "bg-gradient-to-r from-amber-400 to-orange-400",
    label: "text-amber-700 dark:text-amber-300", clock: "text-amber-950 dark:text-amber-50",
    chip: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/40 dark:bg-amber-500/15 dark:text-amber-50"
  },
  now: {
    box: "border-orange-400 bg-gradient-to-br from-orange-50 via-white to-rose-50 shadow-[0_0_0_3px_rgba(251,146,60,0.18)] dark:border-orange-400/50 dark:from-orange-500/18 dark:via-[#0c1722] dark:to-rose-500/12",
    ring: "stroke-orange-500", track: "stroke-orange-100 dark:stroke-orange-500/20", bar: "bg-gradient-to-r from-orange-500 to-rose-500",
    label: "text-orange-700 dark:text-orange-300", clock: "text-orange-950 dark:text-orange-50",
    chip: "border-orange-400 bg-orange-50 text-orange-900 dark:border-orange-400/50 dark:bg-orange-500/18 dark:text-orange-50"
  },
  late: {
    box: "border-rose-300 bg-gradient-to-br from-rose-50 via-white to-red-50 dark:border-rose-400/40 dark:from-rose-500/15 dark:via-[#0c1722] dark:to-red-500/10",
    ring: "stroke-rose-500", track: "stroke-rose-100 dark:stroke-rose-500/20", bar: "bg-gradient-to-r from-rose-500 to-red-500",
    label: "text-rose-700 dark:text-rose-300", clock: "text-rose-900 dark:text-rose-50",
    chip: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-400/40 dark:bg-rose-500/15 dark:text-rose-50"
  },
  rest: {
    box: "border-slate-200 bg-gradient-to-br from-slate-50 via-white to-indigo-50/60 dark:border-slate-700 dark:from-slate-800/60 dark:via-[#0c1722] dark:to-indigo-500/10",
    ring: "stroke-indigo-400", track: "stroke-slate-200 dark:stroke-slate-700", bar: "bg-gradient-to-r from-indigo-300 to-slate-300",
    label: "text-slate-500 dark:text-slate-400", clock: "text-slate-800 dark:text-slate-100",
    chip: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200"
  }
};

const pad = (value: number) => String(value).padStart(2, "0");

/** Split into units: 10m 47s, or 1h 02m past an hour. Never "10:47", which reads as a time of day. */
function clockParts(ms: number): Array<[string, string]> {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? [[String(hours), "h"], [pad(minutes), "m"]] : [[String(minutes), "m"], [pad(seconds), "s"]];
}
const clockText = (ms: number) => clockParts(ms).map(([n, u]) => `${n}${u}`).join(" ");

function useNow(everySecond: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), everySecond ? 1000 : 30_000);
    return () => window.clearInterval(id);
  }, [everySecond]);
  return now;
}

type View = { mood: Mood; label: string; clock: string; clockMs: number; fraction: number; detail: string; chip: string; ticking: boolean; icon: "timer" | "moon" | "alarm" };

function describe(input: SendOutTimerInput, now: number): View | null {
  const timer = sendOutTimer(input, now);
  if (!timer) return null;
  if (timer.state === "waiting") {
    return {
      mood: "rest", icon: "moon", ticking: false, fraction: 1,
      label: `Starts at ${lagosTimeText(timer.startMs, now)}`, clock: clockText(FULL_MS), clockMs: FULL_MS,
      detail: `Came in after work hours. Send it out by ${lagosTimeText(timer.deadlineMs, now)}.`,
      chip: `Starts ${lagosTimeText(timer.startMs, now)}`
    };
  }
  if (timer.state === "running") {
    const fraction = Math.min(1, timer.leftMs / FULL_MS);
    if (timer.paused) {
      return {
        mood: "rest", icon: "moon", ticking: false, fraction,
        label: "Paused for the night", clock: clockText(timer.leftMs), clockMs: timer.leftMs,
        detail: `Clock starts again at opening. Send it out by ${lagosTimeText(timer.deadlineMs, now)}.`,
        chip: `${clockText(timer.leftMs)} · paused`
      };
    }
    const mood: Mood = timer.leftMs <= 60_000 ? "now" : timer.leftMs <= 5 * 60_000 ? "soon" : "calm";
    return {
      mood, icon: mood === "calm" ? "timer" : "alarm", ticking: true, fraction,
      label: "Send out in", clock: clockText(timer.leftMs), clockMs: timer.leftMs,
      detail: `By ${lagosTimeText(timer.deadlineMs, now)}. After that it counts as late.`,
      chip: `${clockText(timer.leftMs)} left`
    };
  }
  return {
    mood: "late", icon: "alarm", ticking: true, fraction: 0,
    label: "Late by", clock: clockText(timer.lateMs), clockMs: timer.lateMs,
    detail: `It was due at ${lagosTimeText(timer.deadlineMs, now)}. Send it out now.`,
    chip: `Late ${clockText(timer.lateMs)}`
  };
}

function Ring({ fraction, size, stroke, mood, children }: { fraction: number; size: number; stroke: number; mood: Mood; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className={MOOD[mood].track} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={`${MOOD[mood].ring} transition-[stroke-dashoffset] duration-1000 ease-linear`}
          strokeDasharray={c} strokeDashoffset={mood === "late" ? 0 : c * (1 - fraction)} />
      </svg>
      {children && <span className="absolute inset-0 flex items-center justify-center">{children}</span>}
    </span>
  );
}

export function SendOutTimer({ input, variant = "card" }: { input: SendOutTimerInput; variant?: "card" | "inline" }) {
  const [ticking, setTicking] = useState(true);
  const now = useNow(ticking);
  const view = describe(input, now);
  useEffect(() => { if (view && view.ticking !== ticking) setTicking(view.ticking); }, [view?.ticking, ticking]);
  if (!view) return null;
  const tone = MOOD[view.mood];
  const Icon = view.icon === "moon" ? Moon : view.icon === "alarm" ? AlarmClock : Timer;
  const urgent = view.mood === "now" || view.mood === "late";

  if (variant === "inline") {
    return (
      <span title={`${view.label} ${view.clock}. ${view.detail}`}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border py-0.5 pl-1 pr-2.5 text-[11px] font-black tabular-nums ${tone.chip}`}>
        <Ring fraction={view.fraction} size={16} stroke={2.5} mood={view.mood} />
        {view.chip}
      </span>
    );
  }

  return (
    <div className={`relative mt-3 overflow-hidden rounded-2xl border px-3.5 py-3 ${tone.box}`} role="timer" aria-live="off"
      aria-label={`${view.label} ${view.clock}. ${view.detail}`}>
      <div className="flex items-center gap-3">
        <Ring fraction={view.fraction} size={48} stroke={4} mood={view.mood}>
          <Icon className={`h-[18px] w-[18px] ${tone.label} ${urgent ? "animate-pulse" : ""}`} aria-hidden="true" />
        </Ring>
        <div className="min-w-0 flex-1">
          <div className={`flex items-center gap-1.5 text-[10.5px] font-black uppercase tracking-[0.14em] ${tone.label}`}>
            {view.ticking && (
              <span className="relative flex h-1.5 w-1.5">
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${tone.bar}`} />
                <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${tone.bar}`} />
              </span>
            )}
            {view.label}
          </div>
          <div className={`flex items-baseline gap-1.5 font-black tabular-nums ${tone.clock}`}>
            {clockParts(view.clockMs).map(([value, unit]) => (
              <span key={unit} className="inline-flex items-baseline">
                <span className="text-[28px] leading-8 tracking-[-0.02em]">{value}</span>
                <span className="ml-0.5 text-[13px] font-bold opacity-60">{unit}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className={`h-full rounded-full ${tone.bar} transition-[width] duration-1000 ease-linear`}
          style={{ width: `${view.mood === "late" ? 100 : Math.max(2, view.fraction * 100)}%` }} />
      </div>
      <p className={`m-0 mt-2 text-[11.5px] font-semibold leading-4 ${tone.clock} opacity-80`}>{view.detail}</p>
    </div>
  );
}
