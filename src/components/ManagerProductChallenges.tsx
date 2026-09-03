import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Eye,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDollarSign,
  Gauge,
  Gift,
  Info,
  Package,
  Pencil,
  Plus,
  Target,
  MoreVertical,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  XCircle
} from "lucide-react";
import { LoadingState } from "./ui/loading-state";

export type ManagerChallengeMilestone = {
  index: number;
  startDate: string;
  endDate: string;
  targetUnits: number;
  progressUnits: number;
  progressPercent: number;
  rewardAmount: number;
  earnedRewardAmount: number;
  status: "Earned" | "Missed" | "In Progress" | "Upcoming" | "Paused" | "Draft";
};

export type ManagerProductChallenge = {
  id: string;
  productId: string;
  name: string;
  cadence: "weekly" | "monthly" | "quarterly";
  targetUnits: number;
  startDate: string;
  endDate: string;
  rewardAmount: number;
  currency: string;
  milestoneMode: "none" | "weekly";
  milestoneDistribution: "even" | "custom";
  milestoneTargets: number[];
  milestones: ManagerChallengeMilestone[];
  earnedRewardAmount: number;
  status: "draft" | "active" | "paused" | "completed";
  description: string;
  managerRewardAmount?: number;
  managerEarnedRewardAmount?: number;
  progressUnits: number;
  progressPercent: number;
  expectedPercent: number;
  daysLeft: number;
  computedStatus: string;
  qualifiedOrders: number;
  teamTargetUnits?: number;
  confirmedPieces?: number;
  deliveredPieces?: number;
  awaitingDeliveryPieces?: number;
  teamProgressUnits?: number;
  teamQualifiedOrders?: number;
  teamRewardAmount?: number;
  allocationMode?: "manager_allocated" | "equal_split_fallback";
  allocations?: ChallengeAllocation[];
  currentWeekTarget?: number;
  currentWeekDelivered?: number;
  currentWeekRemaining?: number;
  currentWeekDaysLeft?: number;
  /** Which checkpoint the figures above belong to, and when it closes.
   *  Milestones are cumulative, so these are month-to-date against a running
   *  total - not one week measured on its own. */
  currentWeekIndex?: number;
  currentWeekEndDate?: string | null;
  todayDeliveredPieces?: number;
  /** The rep's own day-by-day, for the calendar under their target.
   *  ⚠️ dailyTargetPace is the server's flat target ÷ days and is a DECIMAL.
   *  The calendar no longer reads it - it splits the target into whole pieces
   *  per day itself (see dailyQuotas), because a cell cannot ask for 1.3 pcs.
   *  Still sent, still correct, just not what the days are judged against. */
  dailyTargetPace?: number;
  dailyProgress?: Array<{ dateKey: string; pieces: number }>;
  // The dashboard's period filter. Additive only - target, progress and pace
  // stay challenge-to-date so a one-day window never reads as "Behind".
  windowFrom?: string | null;
  windowTo?: string | null;
  windowDeliveredPieces?: number;
  windowQualifiedOrders?: number;
  /** Server's today, so the calendar marks the same day the progress maths did. */
  today?: string;
  /** Whose figures these are. A "team" payload has no currentWeek* fields at
   *  all, so a rep panel rendering one shows zeros that look like a maths bug. */
  scope?: "rep" | "team";
};

export type ChallengeAllocation = {
  repId: string;
  repName: string;
  targetUnits: number;
  rewardAmount: number;
  milestoneTargets: number[];
  deliveredPieces: number;
  confirmedPieces: number;
  awaitingDeliveryPieces: number;
  qualifiedOrders: number;
  progressPercent: number;
  requiredPace: number;
  currentWeekTarget: number;
  currentWeekDelivered: number;
  currentWeekRemaining: number;
  currentWeekDaysLeft: number;
  currentWeekIndex?: number;
  currentWeekEndDate?: string | null;
  todayDeliveredPieces: number;
  /** The flat pace the challenge was set at: target ÷ days in the window.
   *  NOT requiredPace, which rises as days are missed and so cannot be used to
   *  judge a day that has already happened.
   *  ⚠️ A DECIMAL, and so no longer what the calendar judges a day by - see
   *  dailyQuotas, which splits the same target into whole pieces per day. */
  dailyTargetPace?: number;
  /** Every day of the challenge window, including days with nothing. */
  dailyProgress?: Array<{ dateKey: string; pieces: number }>;
  /** What this rep did inside the dashboard's period filter. Additive only -
   *  it never rescopes targetUnits, progressPercent or requiredPace. */
  windowDeliveredPieces?: number;
  windowQualifiedOrders?: number;
  persisted: boolean;
};

export type ManagerChallengeDraft = Pick<
  ManagerProductChallenge,
  | "productId"
  | "name"
  | "cadence"
  | "targetUnits"
  | "startDate"
  | "endDate"
  | "rewardAmount"
  | "currency"
  | "milestoneMode"
  | "milestoneDistribution"
  | "milestoneTargets"
  | "status"
  | "description"
  | "managerRewardAmount"
>;

type ChallengeProduct = { id: string; name: string; imageUrl?: string; active?: boolean };

type Props = {
  role: string;
  products: ChallengeProduct[];
  challenges: ManagerProductChallenge[];
  loading: boolean;
  error: string;
  formatMoney: (amount: number, currency: string) => string;
  onSave: (draft: ManagerChallengeDraft, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSaveAllocations?: (challengeId: string, allocations: Array<Pick<ChallengeAllocation, "repId" | "targetUnits" | "rewardAmount" | "milestoneTargets">>) => Promise<void>;
  onOpenBonusRules: () => void;
};

const fieldControlClass = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

const DAY_MS = 86_400_000;

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value: string) => new Date(`${value}T12:00:00`);

const formatDateShort = (value: string) => {
  const date = parseDateKey(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-NG", { month: "short", day: "numeric" });
};

const endForCadence = (startDate: string, cadence: ManagerChallengeDraft["cadence"]) => {
  const start = parseDateKey(startDate);
  if (Number.isNaN(start.getTime())) return startDate;
  const end = new Date(start);
  if (cadence === "weekly") end.setDate(end.getDate() + 6);
  if (cadence === "monthly") end.setMonth(end.getMonth() + 1, 0);
  if (cadence === "quarterly") end.setMonth(end.getMonth() + 3, 0);
  return dateKey(end);
};

const milestoneCount = (cadence: ManagerChallengeDraft["cadence"]) =>
  cadence === "monthly" ? 4 : cadence === "quarterly" ? 12 : 1;

const distributeWholeNumber = (total: number, count: number) => {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeCount = Math.max(1, Math.trunc(count));
  const base = Math.floor(safeTotal / safeCount);
  const remainder = safeTotal - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) => base + (index < remainder ? 1 : 0));
};

const milestoneRanges = (startDate: string, endDate: string, count: number) => {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const windowDays = Math.max(1, Math.floor(days / Math.max(1, count)));
  return Array.from({ length: count }, (_, index) => {
    const rangeStart = new Date(start);
    rangeStart.setDate(rangeStart.getDate() + index * windowDays);
    const rangeEnd = index === count - 1 ? new Date(end) : new Date(rangeStart);
    if (index !== count - 1) rangeEnd.setDate(rangeEnd.getDate() + windowDays - 1);
    return { startDate: dateKey(rangeStart), endDate: dateKey(rangeEnd) };
  });
};

const defaultDraft = (products: ChallengeProduct[]): ManagerChallengeDraft => {
  const today = new Date();
  const startDate = dateKey(new Date(today.getFullYear(), today.getMonth(), 1, 12));
  const product = products.find((item) => item.active !== false) ?? products[0];
  return {
    productId: product?.id ?? "",
    name: product ? `${product.name} - Monthly Challenge` : "Monthly Product Challenge",
    cadence: "monthly",
    targetUnits: 1_000,
    startDate,
    endDate: endForCadence(startDate, "monthly"),
    rewardAmount: 0,
    currency: "NGN",
    milestoneMode: "weekly",
    milestoneDistribution: "even",
    milestoneTargets: [],
    status: "active",
    description: "Complete each weekly milestone to earn that portion of the monthly product reward.",
    managerRewardAmount: 0
  };
};

const statusStyle = (status: string) => {
  if (["Achieved", "On Track", "Completed", "Earned"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["At Risk", "Upcoming", "In Progress"].includes(status)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (["Behind", "Ended", "Missed"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-gray-200 bg-gray-50 text-gray-600";
};

const milestoneTone = (status: ManagerChallengeMilestone["status"]) => {
  if (status === "Earned") return { card: "border-emerald-200 bg-emerald-50/50", bar: "bg-violet-600", value: "text-violet-700", footer: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircle2 };
  if (status === "Missed") return { card: "border-rose-200 bg-rose-50/50", bar: "bg-orange-500", value: "text-orange-600", footer: "border-rose-200 bg-rose-50 text-rose-700", Icon: XCircle };
  return { card: "border-blue-200 bg-blue-50/40", bar: "bg-blue-600", value: "text-blue-700", footer: "border-blue-200 bg-blue-50 text-blue-700", Icon: Circle };
};

const CARD_ACCENTS = [
  { bar: "bg-violet-500", label: "text-violet-600" },
  { bar: "bg-emerald-500", label: "text-emerald-600" },
  { bar: "bg-blue-500", label: "text-blue-600" },
  { bar: "bg-amber-500", label: "text-amber-600" }
];


/**
 * Day-by-day view of one challenge, as a month calendar.
 *
 * ⚠️ EVERY DAY IS JUDGED AGAINST THE PACE THAT WAS TRUE THAT DAY - the flat
 * target ÷ window - not against requiredPace, which rises each time a day is
 * missed. Using the live pace would mark Monday behind because Monday was
 * missed, then mark Tuesday behind harder for the same miss.
 *
 * The running total is the honest headline: a rep can miss a Tuesday and still
 * be ahead, and a calendar of green squares that never says so is decoration.
 */

const CHALLENGE_DAY_TONE = {
  over: { cell: "border-emerald-200 bg-emerald-50/80", dot: "bg-emerald-500", bar: "bg-emerald-500", value: "text-emerald-700", label: "Over target" },
  met: { cell: "border-sky-200 bg-sky-50/80", dot: "bg-sky-500", bar: "bg-sky-500", value: "text-sky-700", label: "Target met" },
  short: { cell: "border-amber-200 bg-amber-50/80", dot: "bg-amber-500", bar: "bg-amber-500", value: "text-amber-700", label: "Behind target" },
  missed: { cell: "border-rose-200 bg-rose-50/70", dot: "bg-rose-500", bar: "bg-rose-300", value: "text-rose-600", label: "Nothing delivered" },
  upcoming: { cell: "border-dashed border-gray-200 bg-white", dot: "bg-gray-200", bar: "bg-gray-200", value: "text-gray-300", label: "Still to come" },
  none: { cell: "border-gray-200 bg-gray-50", dot: "bg-gray-300", bar: "bg-gray-300", value: "text-gray-500", label: "No target set" }
} as const;

type ChallengeDayStatus = keyof typeof CHALLENGE_DAY_TONE;

type ChallengeDayRow = {
  dateKey: string;
  pieces: number;
  /** Whole pieces this day asks for. The quotas sum to the target exactly. */
  quota: number;
  running: number;
  /** Cumulative quota to this day - a whole number, like everything else here. */
  expected: number;
  status: ChallengeDayStatus;
  future: boolean;
};

const utcDay = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`);

/**
 * The target broken into WHOLE PIECES PER DAY that add up to the target exactly.
 *
 * ⚠️ NO DECIMAL DAILY TARGET. A flat target ÷ days gives 41 / 32 = 1.28, and a
 * day cell asking for "1.3 pcs" is asking for something nobody can deliver -
 * Bright: "1.3 is not right, it is neither 1 nor 2 nor 3". Worse, one piece
 * against 1.28 coloured itself Behind target, so a rep who did exactly what the
 * cell asked was marked short.
 *
 * Each day gets the whole number that keeps the RUNNING total on the line:
 *
 *   quota[i] = floor(target x (i+1) / days) - floor(target x i / days)
 *
 * For 41 over 32 days that is nine 2s and twenty-three 1s, spread evenly rather
 * than stacked at the front, and they sum to exactly 41 by construction - the
 * last cumulative term is floor(target x days / days) = target. Every figure the
 * calendar shows is now a whole number a rep can actually deliver, and the
 * cumulative expectation behind the ahead/behind headline is a whole number too.
 */
const dailyQuotas = (target: number, dayCount: number) => {
  const total = Math.max(0, Math.round(target));
  const count = Math.max(1, dayCount);
  let previous = 0;
  return Array.from({ length: count }, (_, index) => {
    const cumulative = Math.floor((total * (index + 1)) / count);
    const quota = cumulative - previous;
    previous = cumulative;
    return quota;
  });
};

const buildChallengeDays = (
  days: Array<{ dateKey: string; pieces: number }>,
  target: number,
  today: string
): ChallengeDayRow[] => {
  const quotas = dailyQuotas(target, days.length);
  let running = 0;
  let expected = 0;
  return days.map((day, index) => {
    const quota = quotas[index] ?? 0;
    running += day.pieces;
    expected += quota;
    const future = day.dateKey > today;
    // Whole numbers on both sides, so the comparison needs no tolerance band
    // and no multiplier to explain: you cleared the day's pieces, you matched
    // them, you fell short, or you delivered nothing.
    const status: ChallengeDayStatus = future ? "upcoming"
      : quota <= 0 ? "none"
      : day.pieces > quota ? "over"
      : day.pieces === quota ? "met"
      : day.pieces > 0 ? "short"
      : "missed";
    return { ...day, quota, running, expected, status, future };
  });
};

/**
 * The calendar itself. Rendered inline under a rep's own target and inside the
 * manager's per-rep modal, so both are reading the same grid rather than two
 * drifting copies of it.
 */
function ChallengeDayCalendar({
  days, today, target, delivered, heading
}: {
  days: Array<{ dateKey: string; pieces: number }>;
  today: string;
  target: number;
  delivered: number;
  heading?: string;
}) {
  const rows = useMemo(() => buildChallengeDays(days, target, today), [days, target, today]);

  const done = rows.filter((row) => !row.future);
  const last = done[done.length - 1];
  // Both sides are whole numbers now, so the gap is one too - no more "4.4 pcs
  // behind pace" against a target measured in pieces.
  const aheadBy = last ? last.running - last.expected : 0;
  const spread = useMemo(() => {
    const quotas = rows.map((row) => row.quota);
    const min = quotas.length > 0 ? Math.min(...quotas) : 0;
    const max = quotas.length > 0 ? Math.max(...quotas) : 0;
    return { min, max, heavier: quotas.filter((quota) => quota === max).length };
  }, [rows]);
  const quotaLabel = spread.max <= 0
    ? ""
    : spread.min === spread.max
      ? `${spread.min.toLocaleString()} pcs/day`
      : `${spread.min.toLocaleString()}-${spread.max.toLocaleString()} pcs/day`;
  const judged = done.filter((row) => row.status !== "none").length;
  const onTarget = done.filter((row) => row.status === "over" || row.status === "met").length;

  // A challenge can start in one month and end in the next (this one runs
  // 30 Aug - 30 Sept), so the grid is drawn per month. One grid spanning the
  // boundary would put a September date under an August weekday.
  const months = useMemo(() => {
    const groups = new Map<string, ChallengeDayRow[]>();
    rows.forEach((row) => {
      const key = row.dateKey.slice(0, 7);
      const bucket = groups.get(key);
      if (bucket) bucket.push(row); else groups.set(key, [row]);
    });
    return Array.from(groups.entries());
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-center text-xs font-bold text-gray-400">
        No days to show for this challenge yet.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="m-0 text-lg font-black tracking-tight text-gray-950">
            {heading ?? utcDay(rows[0].dateKey).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" })}
          </h4>
          <p className="m-0 mt-0.5 text-[11px] font-bold text-gray-500">
            {delivered.toLocaleString()} of {target.toLocaleString()} pcs
            {quotaLabel && <> · {quotaLabel}</>}
            {judged > 0 && <> · {onTarget} of {judged} days on target</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-bold text-gray-500">
          {(["over", "met", "short", "missed", "upcoming"] as const).map((key) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${CHALLENGE_DAY_TONE[key].dot}`} />{CHALLENGE_DAY_TONE[key].label}
            </span>
          ))}
        </div>
      </div>

      {/* Ahead or behind overall, in pieces. A month of mixed squares does not
          answer "am I winning" on its own. */}
      {done.length > 0 && target > 0 && last && (
        <div className={`mt-4 rounded-xl border px-4 py-3 ${aheadBy >= 0 ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
          <p className={`m-0 text-[13px] font-black ${aheadBy >= 0 ? "text-emerald-900" : "text-rose-900"}`}>
            {aheadBy >= 0 ? `${aheadBy} pcs ahead of pace` : `${Math.abs(aheadBy)} pcs behind pace`}
          </p>
          <p className="m-0 mt-0.5 text-[11px] font-medium text-gray-600">
            {last.running.toLocaleString()} delivered by {utcDay(last.dateKey).toLocaleDateString("en-NG", { day: "numeric", month: "short", timeZone: "UTC" })}, against {Math.round(last.expected).toLocaleString()} expected by then.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-5 overflow-x-auto">
        {months.map(([monthKey, monthRows]) => (
          <div key={monthKey} className="min-w-[560px]">
            {months.length > 1 && (
              <p className="m-0 mb-2 text-xs font-black tracking-tight text-gray-700">
                {utcDay(monthRows[0].dateKey).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" })}
              </p>
            )}
            <div className="grid grid-cols-7 gap-1.5">
              {["S", "M", "T", "W", "T", "F", "S"].map((initial, index) => (
                <div key={`${monthKey}-${index}`} className="pb-1 text-center text-[10px] font-black uppercase tracking-wider text-gray-400">{initial}</div>
              ))}
              {/* Lead blanks so the first day sits under its real weekday. */}
              {Array.from({ length: utcDay(monthRows[0].dateKey).getUTCDay() }, (_, index) => (
                <div key={`lead-${monthKey}-${index}`} />
              ))}
              {monthRows.map((row) => {
                const tone = CHALLENGE_DAY_TONE[row.status];
                const isToday = row.dateKey === today;
                const fill = row.quota > 0 ? Math.min(100, Math.round((row.pieces / row.quota) * 100)) : 0;
                return (
                  <div
                    key={row.dateKey}
                    title={`${utcDay(row.dateKey).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })} — ${row.future ? "still to come" : `${row.pieces} of ${row.quota} pcs · ${tone.label}`}`}
                    className={`flex flex-col gap-1.5 rounded-xl border p-2 ${tone.cell} ${isToday ? "ring-2 ring-violet-400" : ""}`}
                  >
                    <span className="flex items-center justify-between">
                      <span className={`text-[13px] font-black tabular-nums ${row.future ? "text-gray-300" : isToday ? "text-violet-700" : "text-gray-700"}`}>
                        {utcDay(row.dateKey).getUTCDate()}
                      </span>
                      {isToday
                        ? <span className="h-2 w-2 rounded-full bg-violet-500 ring-2 ring-violet-200" title="Today" />
                        : <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />}
                    </span>
                    {/* One bar against the daily pace. Empty days draw an empty
                        track rather than nothing, so a missed day is visible
                        instead of merely blank. */}
                    <span className="block h-1.5 overflow-hidden rounded-full bg-white/70">
                      <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${row.future ? 0 : Math.max(row.pieces > 0 ? 8 : 0, fill)}%` }} />
                    </span>
                    <span className="flex items-baseline justify-between">
                      <strong className={`text-[13px] font-black leading-none tabular-nums ${tone.value}`}>{row.future ? "—" : row.pieces}</strong>
                      {!row.future && row.quota > 0 && (
                        <span className="text-[10px] font-bold tabular-nums text-gray-400">/ {row.quota}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="m-0 mt-3 text-[10px] font-medium leading-relaxed text-gray-400">
        The {target.toLocaleString()} pcs are split into whole pieces per day that add
        up to exactly {target.toLocaleString()}
        {spread.min !== spread.max ? <> — most days ask for {spread.min.toLocaleString()}, and {spread.heavier.toLocaleString()} of them ask for {spread.max.toLocaleString()}</> : null}.
        Each day is measured against its own number, not against the catch-up pace on
        the card above — that one rises every time a day is missed, so it would mark the
        same miss twice. Only delivered and verified pieces count.
      </p>
      <p className="m-0 mt-1 text-[10px] font-bold text-gray-400">
        Range: {rows[0].dateKey} to {rows[rows.length - 1].dateKey}
      </p>
    </div>
  );
}

function RepChallengeCalendar({
  allocation, currency, today, onClose, formatMoney
}: {
  allocation: ChallengeAllocation;
  currency: string;
  today: string;
  onClose: () => void;
  formatMoney: (amount: number, currency: string) => string;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[220] flex items-end justify-center bg-slate-950/50 p-2 sm:items-center sm:p-6" onClick={onClose}>
      <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-black uppercase tracking-widest text-violet-600">Day by day</p>
            <h2 className="m-0 mt-1 text-xl font-black text-gray-950">{allocation.repName}</h2>
            <p className="m-0 mt-1 text-xs font-semibold text-gray-500">
              Reward at target: {formatMoney(allocation.rewardAmount, currency)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="!min-h-0 rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4">
          <ChallengeDayCalendar
            days={allocation.dailyProgress ?? []}
            today={today}
            target={allocation.targetUnits}
            delivered={allocation.deliveredPieces}
          />
        </div>
      </section>
    </div>,
    document.body
  );
}

function windowLabel(from?: string | null, to?: string | null) {
  if (!from || !to) return "";
  return from === to ? formatDateShort(from) : `${formatDateShort(from)} - ${formatDateShort(to)}`;
}

export function ManagerProductChallenges({
  role,
  products,
  challenges,
  loading,
  error,
  formatMoney,
  onSave,
  onDelete,
  onSaveAllocations,
  onOpenBonusRules
}: Props) {
  const canEdit = role === "Owner";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"Challenges" | "Bonus Rules">("Challenges");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draft, setDraft] = useState<ManagerChallengeDraft>(() => defaultDraft(products));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [showAllProducts, setShowAllProducts] = useState(false);

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  useEffect(() => {
    if (!challenges.some((challenge) => challenge.id === selectedChallengeId)) setSelectedChallengeId(challenges[0]?.id ?? null);
  }, [challenges, selectedChallengeId]);
  const orderedChallenges = useMemo(() => [...challenges].sort((a, b) => {
    const rank = (challenge: ManagerProductChallenge) => {
      if (challenge.progressUnits >= challenge.targetUnits) return 3;
      const totalDays = Math.max(1, Math.ceil((parseDateKey(challenge.endDate).getTime() - parseDateKey(challenge.startDate).getTime()) / DAY_MS) + 1);
      const elapsed = Math.max(0, totalDays - Math.max(0, challenge.daysLeft));
      if (elapsed <= 1 && challenge.progressUnits === 0) return 2;
      const expected = (elapsed / totalDays) * challenge.targetUnits;
      const pace = expected > 0 ? challenge.progressUnits / expected : 1;
      return pace < 0.8 ? 0 : pace < 0.95 ? 1 : 2;
    };
    return rank(a) - rank(b);
  }), [challenges]);
  const previewProduct = productMap.get(draft.productId);
  const draftCount = milestoneCount(draft.cadence);
  const visibleTargets = draft.milestoneDistribution === "custom"
    ? draft.milestoneTargets
    : distributeWholeNumber(draft.targetUnits, draftCount);
  const visibleRanges = milestoneRanges(draft.startDate, draft.endDate, draftCount);

  const openNew = () => {
    setEditingId(undefined);
    setDraft(defaultDraft(products));
    setFormError("");
    setDrawerTab("Challenges");
    setDrawerOpen(true);
  };

  const openEdit = (challenge: ManagerProductChallenge) => {
    setEditingId(challenge.id);
    setDraft({
      productId: challenge.productId,
      name: challenge.name,
      cadence: challenge.cadence,
      targetUnits: challenge.targetUnits,
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      rewardAmount: challenge.rewardAmount,
      currency: challenge.currency,
      milestoneMode: challenge.milestoneMode ?? "none",
      milestoneDistribution: challenge.milestoneDistribution ?? "even",
      milestoneTargets: challenge.milestoneTargets ?? [],
      status: challenge.status,
      description: challenge.description,
      managerRewardAmount: challenge.managerRewardAmount ?? 0
    });
    setFormError("");
    setDrawerTab("Challenges");
    setDrawerOpen(true);
  };

  const setCadence = (cadence: ManagerChallengeDraft["cadence"]) => {
    setDraft((current) => ({
      ...current,
      cadence,
      milestoneMode: cadence === "weekly" ? "none" : current.milestoneMode,
      endDate: endForCadence(current.startDate, cadence),
      milestoneTargets: current.milestoneDistribution === "custom"
        ? distributeWholeNumber(current.targetUnits, milestoneCount(cadence))
        : []
    }));
  };

  const chooseDistribution = (distribution: ManagerChallengeDraft["milestoneDistribution"]) => {
    setDraft((current) => ({
      ...current,
      milestoneDistribution: distribution,
      milestoneTargets: distribution === "custom"
        ? distributeWholeNumber(current.targetUnits, milestoneCount(current.cadence))
        : []
    }));
  };

  const save = async () => {
    if (!draft.productId) return setFormError("Choose a product.");
    if (!draft.name.trim()) return setFormError("Enter a challenge name.");
    if (draft.targetUnits < 1) return setFormError("Target pieces must be at least 1.");
    if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) return setFormError("Choose a valid date range.");
    if (draft.milestoneMode === "weekly" && draft.milestoneDistribution === "custom") {
      if (draft.milestoneTargets.length !== draftCount) return setFormError(`Enter all ${draftCount} milestone targets.`);
      const total = draft.milestoneTargets.reduce((sum, target) => sum + Number(target || 0), 0);
      if (total !== draft.targetUnits) {
        return setFormError(`Milestone targets total ${total.toLocaleString()} pcs, but the challenge target is ${draft.targetUnits.toLocaleString()} pcs.`);
      }
    }
    setSaving(true);
    setFormError("");
    try {
      await onSave(draft, editingId);
      setDrawerOpen(false);
    } catch (saveError: any) {
      setFormError(saveError?.message ?? "Could not save this challenge.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId || !window.confirm("Remove this challenge? Existing orders will not be changed.")) return;
    setSaving(true);
    setFormError("");
    try {
      await onDelete(editingId);
      setDrawerOpen(false);
    } catch (deleteError: any) {
      setFormError(deleteError?.message ?? "Could not remove this challenge.");
    } finally {
      setSaving(false);
    }
  };

  const drawer = drawerOpen && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[130] flex justify-end bg-slate-950/30" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setDrawerOpen(false);
    }}>
      <aside className="flex h-full w-full max-w-[480px] flex-col border-l border-gray-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Owner settings">
        <header className="flex items-start justify-between border-b border-gray-100 px-5 py-5">
          <div>
            <h2 className="text-xl font-black text-gray-950">Owner Settings</h2>
            <p className="mt-1 text-sm font-medium text-gray-500">Create and manage product challenges.</p>
          </div>
          <button type="button" className="!min-h-0 flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setDrawerOpen(false)} title="Close owner settings">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex gap-2 border-b border-gray-100 px-5 py-3">
          {(["Challenges", "Bonus Rules"] as const).map((tab) => (
            <button key={tab} type="button" className={`!min-h-0 rounded-lg px-3 py-2 text-sm font-black ${drawerTab === tab ? "bg-violet-50 text-violet-700 shadow-sm" : "text-gray-600"}`} onClick={() => setDrawerTab(tab)}>
              {tab}
            </button>
          ))}
        </div>

        {drawerTab === "Challenges" ? (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-4 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-gray-900">{editingId ? "Edit Challenge" : "Create Challenge"}</h3>
                  <p className="mt-1 text-xs font-medium text-gray-400">Cancelled, failed, and held orders do not count.</p>
                </div>
                {editingId && (
                  <button type="button" className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-2 text-xs font-black text-rose-600" disabled={saving} onClick={remove}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>

              <FieldLabel label="Choose product">
                <select className={fieldControlClass} value={draft.productId} onChange={(event) => {
                  const productId = event.target.value;
                  const product = productMap.get(productId);
                  setDraft((current) => ({ ...current, productId, name: editingId ? current.name : `${product?.name ?? "Product"} - Monthly Challenge` }));
                }}>
                  <option value="">Choose product</option>
                  {products.filter((product) => product.active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </FieldLabel>

              <FieldLabel label="Challenge name">
                <input className={fieldControlClass} maxLength={160} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </FieldLabel>

              <div>
                <p className="text-xs font-black text-gray-500">Challenge type</p>
                <div className="mt-1.5 grid grid-cols-3 overflow-hidden rounded-lg border border-gray-200">
                  {(["weekly", "monthly", "quarterly"] as const).map((cadence) => (
                    <button key={cadence} type="button" className={`!min-h-0 border-r border-gray-200 px-2 py-2.5 text-xs font-black capitalize last:border-r-0 ${draft.cadence === cadence ? "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-300" : "bg-white text-gray-500"}`} onClick={() => setCadence(cadence)}>
                      {cadence}
                    </button>
                  ))}
                </div>
              </div>

              {draft.cadence !== "weekly" && (
                <div>
                  <p className="text-xs font-black text-violet-700">Milestone structure</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" className={`!min-h-0 rounded-lg border p-3 text-left ${draft.milestoneMode === "weekly" ? "border-violet-300 bg-violet-50 text-violet-800" : "border-gray-200 bg-white text-gray-600"}`} onClick={() => setDraft((current) => ({ ...current, milestoneMode: "weekly" }))}>
                      <span className="flex items-center gap-2 text-xs font-black"><CheckCircle2 className="h-4 w-4" /> Weekly milestones</span>
                      <span className="mt-1 block text-[10px] font-semibold leading-4 text-gray-500">Split the full reward into independently earned weeks.</span>
                    </button>
                    <button type="button" className={`!min-h-0 rounded-lg border p-3 text-left ${draft.milestoneMode === "none" ? "border-violet-300 bg-violet-50 text-violet-800" : "border-gray-200 bg-white text-gray-600"}`} onClick={() => setDraft((current) => ({ ...current, milestoneMode: "none", milestoneTargets: [] }))}>
                      <span className="text-xs font-black">No milestones</span>
                      <span className="mt-1 block text-[10px] font-semibold leading-4 text-gray-500">Pay only when the full target is reached.</span>
                    </button>
                  </div>
                </div>
              )}

              <FieldLabel label={`${draft.cadence === "monthly" ? "Monthly" : draft.cadence === "quarterly" ? "Quarterly" : "Weekly"} target (pcs)`}>
                <div className="relative">
                  <input type="number" min="1" className={`${fieldControlClass} pr-12`} value={draft.targetUnits} onChange={(event) => setDraft((current) => ({ ...current, targetUnits: Math.max(0, Number(event.target.value) || 0) }))} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">pcs</span>
                </div>
              </FieldLabel>

              {draft.milestoneMode === "weekly" && draft.cadence !== "weekly" && (
                <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
                  <p className="text-xs font-black text-violet-700">Weekly milestone setup</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <ChoiceButton selected={draft.milestoneDistribution === "even"} onClick={() => chooseDistribution("even")}>Auto-distribute evenly</ChoiceButton>
                    <ChoiceButton selected={draft.milestoneDistribution === "custom"} onClick={() => chooseDistribution("custom")}>Custom weekly targets</ChoiceButton>
                  </div>
                  <div className={`mt-3 grid gap-2 ${draftCount <= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
                    {Array.from({ length: draftCount }, (_, index) => (
                      <label key={index} className="text-[10px] font-black text-gray-500">
                        Week {index + 1}
                        <input
                          type="number"
                          min="1"
                          readOnly={draft.milestoneDistribution === "even"}
                          className={`mt-1 w-full rounded-lg border px-2 py-2 text-center text-xs font-black ${draft.milestoneDistribution === "even" ? "border-gray-100 bg-gray-100 text-gray-500" : "border-violet-200 bg-white text-gray-900"}`}
                          value={visibleTargets[index] ?? 0}
                          onChange={(event) => setDraft((current) => {
                            const targets = [...current.milestoneTargets];
                            targets[index] = Math.max(0, Number(event.target.value) || 0);
                            return { ...current, milestoneTargets: targets };
                          })}
                        />
                        <span className="mt-1 block truncate text-[9px] font-semibold text-gray-400">
                          {visibleRanges[index] ? `${formatDateShort(visibleRanges[index].startDate)}-${formatDateShort(visibleRanges[index].endDate)}` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-right text-[10px] font-bold text-gray-500">Total: {visibleTargets.reduce((sum, target) => sum + Number(target || 0), 0).toLocaleString()} pcs</p>
                </div>
              )}

              <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                <p className="text-xs font-black text-gray-700">Independent bonus allocations</p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <MoneyField label="Manager / team reward" value={draft.managerRewardAmount ?? 0} onChange={(value) => setDraft((current) => ({ ...current, managerRewardAmount: value }))} />
                  <MoneyField label="Sales-rep bonus pool" value={draft.rewardAmount} onChange={(value) => setDraft((current) => ({ ...current, rewardAmount: value }))} />
                </div>
                <p className="mt-2 text-[10px] font-semibold leading-4 text-gray-500">The manager reward follows team progress. The sales-rep pool is divided into editable personal rewards under Manage allocations.</p>
              </div>

              <div>
                <p className="text-xs font-black text-gray-500">Challenge period</p>
                <div className="mt-1.5 grid grid-cols-2 gap-3">
                  <FieldLabel label="Start date" small>
                    <input type="date" className={`${fieldControlClass} text-xs`} value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value, endDate: endForCadence(event.target.value, current.cadence) }))} />
                  </FieldLabel>
                  <FieldLabel label="End date" small>
                    <input type="date" className={`${fieldControlClass} text-xs`} value={draft.endDate} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))} />
                  </FieldLabel>
                </div>
              </div>

              <FieldLabel label="Description (optional)">
                <textarea className={`${fieldControlClass} min-h-[72px] resize-y`} maxLength={1000} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
              </FieldLabel>

              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-3">
                <span>
                  <strong className="block text-xs text-gray-900">Active challenge</strong>
                  <span className="mt-1 block text-[10px] font-semibold text-gray-500">Challenge is live and counting qualified orders.</span>
                </span>
                <input type="checkbox" className="h-5 w-5 accent-violet-600" checked={draft.status === "active"} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.checked ? "active" : "paused" }))} />
              </label>

              <div>
                <p className="mb-2 text-xs font-black text-violet-600">Preview</p>
                <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">{draft.cadence} challenge</p>
                  <div className="mt-3 flex items-center gap-3">
                    {previewProduct?.imageUrl
                      ? <img src={previewProduct.imageUrl} alt="" className="h-12 w-12 rounded-lg border border-gray-100 object-cover" />
                      : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-violet-500"><Package className="h-5 w-5" /></span>}
                    <div className="min-w-0">
                      <h4 className="break-words text-base font-black text-gray-950">{previewProduct?.name ?? "Choose a product"}</h4>
                      <p className="mt-1 text-xs font-semibold text-gray-500">{draft.targetUnits.toLocaleString()} pcs target</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-500">Challenge reward</span>
                    <strong className="text-violet-700">{formatMoney(draft.rewardAmount, draft.currency)}</strong>
                  </div>
                </div>
              </div>

              {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{formError}</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><CircleDollarSign className="h-7 w-7" /></span>
            <h3 className="mt-4 text-lg font-black text-gray-900">Manager bonus rules</h3>
            <p className="mt-2 max-w-sm text-sm font-medium leading-6 text-gray-500">Profit gates and delivery-rate tiers remain in the full Bonus & Performance editor so there is one source of truth.</p>
            <button type="button" className="!min-h-0 mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-3 text-sm font-black text-white" onClick={() => { setDrawerOpen(false); onOpenBonusRules(); }}>
              Open bonus rules <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {drawerTab === "Challenges" && (
          <footer className="flex items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-4">
            <button type="button" className="!min-h-0 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-black text-gray-600" onClick={() => setDrawerOpen(false)}>Cancel</button>
            <button type="button" className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-200 disabled:opacity-50" disabled={saving} onClick={save}>
              {saving ? "Saving..." : <><Check className="h-4 w-4" /> Save Challenge</>}
            </button>
          </footer>
        )}
      </aside>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <section className="manager-product-challenges overflow-hidden rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/70 shadow-sm" aria-label="Product challenges">
        <header className="flex flex-col gap-3 border-b border-indigo-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-rose-600 shadow-sm"><Target className="h-5 w-5" /></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Product challenges</p>
              <p className="mt-1 text-sm font-medium text-gray-500">Complete weekly milestones to earn the full monthly reward. Each successful milestone is earned independently.</p>
            </div>
          </div>
          {canEdit && <button type="button" className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-200" onClick={openNew}><Plus className="h-4 w-4" /> Add Challenge</button>}
        </header>

        <div className="space-y-4 p-3 sm:p-4">
          {loading ? (
            <LoadingState label="Loading product challenges" />
          ) : error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-bold text-rose-700">{error}</div>
          ) : challenges.length === 0 ? (
            <div className="manager-product-challenges-empty flex flex-col items-center justify-center rounded-lg border border-dashed border-indigo-200 bg-white/70 px-5 py-8 text-center">
              <Target className="h-7 w-7 text-indigo-300" />
              <h3 className="mt-3 text-sm font-black text-gray-900">No product challenge is active right now</h3>
              <p className="mt-1 max-w-lg text-xs font-medium leading-5 text-gray-500">
                {canEdit
                  ? "Create a monthly challenge and split its reward across weekly milestones."
                  : "The Owner has not set up a product challenge yet."}
              </p>
              {canEdit && <button type="button" className="!min-h-0 mt-4 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700" onClick={openNew}><Plus className="h-3.5 w-3.5" /> Create first challenge</button>}
            </div>
          ) : challenges.length >= 2 ? (
            <>
              <ChallengeSummaryStrip challenges={challenges} formatMoney={formatMoney} />
              <div className="relative rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <button type="button" aria-label="Previous products" className="!min-h-0 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 sm:flex" onClick={() => document.querySelector('.challenge-selector-track')?.scrollBy({ left: -320, behavior: 'smooth' })}>‹</button>
                  <div className="challenge-selector-track flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1">
                  {orderedChallenges.map((challenge, index) => <ChallengeSelector key={challenge.id} challenge={challenge} product={productMap.get(challenge.productId)} selected={selectedChallengeId === challenge.id} onClick={() => setSelectedChallengeId(challenge.id)} accent={CARD_ACCENTS[index % CARD_ACCENTS.length]} />)}
                  </div>
                  <button type="button" aria-label="Next products" className="!min-h-0 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 sm:flex" onClick={() => document.querySelector('.challenge-selector-track')?.scrollBy({ left: 320, behavior: 'smooth' })}>›</button>
                  <button type="button" className="!min-h-0 hidden shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 xl:block" onClick={() => setShowAllProducts(true)}>View all products</button>
                </div>
              </div>
              {(() => { const selected = challenges.find((challenge) => challenge.id === selectedChallengeId) ?? orderedChallenges[0]; return selected ? <ChallengeCard key={selected.id} challenge={selected} product={productMap.get(selected.productId)} canEdit={canEdit} repMode={role === "Sales Rep"} formatMoney={formatMoney} onEdit={() => openEdit(selected)} onDelete={() => void onDelete(selected.id)} onToggleStatus={() => void onSave({ ...selected, status: selected.status === "active" ? "paused" : "active" }, selected.id)} onSaveAllocations={onSaveAllocations} /> : null; })()}
            </>
          ) : (
            challenges.map((challenge) => (
              <ChallengeCard
                key={challenge.id}
                challenge={challenge}
                product={productMap.get(challenge.productId)}
                canEdit={canEdit}
                repMode={role === "Sales Rep"}
                formatMoney={formatMoney}
                onEdit={() => openEdit(challenge)}
                onDelete={() => void onDelete(challenge.id)}
                onToggleStatus={() => void onSave({ ...challenge, status: challenge.status === "active" ? "paused" : "active" }, challenge.id)}
                onSaveAllocations={onSaveAllocations}
              />
            ))
          )}
        </div>
      </section>
      {drawer}
      {showAllProducts && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[125] flex justify-end bg-slate-950/30" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowAllProducts(false); }}><aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black text-gray-900">All product challenges</h2><p className="text-xs text-gray-500">Prioritized by attention needed.</p></div><button type="button" className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100" onClick={() => setShowAllProducts(false)}><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-3">{orderedChallenges.map((challenge, index) => <ChallengeSelector key={challenge.id} challenge={challenge} product={productMap.get(challenge.productId)} selected={selectedChallengeId === challenge.id} onClick={() => { setSelectedChallengeId(challenge.id); setShowAllProducts(false); }} accent={CARD_ACCENTS[index % CARD_ACCENTS.length]} />)}</div></aside></div>, document.body)}
    </>
  );
}

function ChallengeCard({
  challenge,
  product,
  canEdit,
  repMode,
  formatMoney,
  onEdit,
  onDelete,
  onToggleStatus,
  onSaveAllocations
}: {
  challenge: ManagerProductChallenge;
  product?: ChallengeProduct;
  canEdit: boolean;
  repMode: boolean;
  formatMoney: Props["formatMoney"];
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
  onSaveAllocations?: Props["onSaveAllocations"];
}) {
  const hasMilestones = challenge.milestoneMode === "weekly" && challenge.milestones?.length > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article className="relative overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
      <div className="h-1 bg-violet-500" />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {product?.imageUrl
              ? <img src={product.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-gray-100 object-cover sm:h-20 sm:w-20" />
              : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500 sm:h-20 sm:w-20"><Package className="h-7 w-7" /></span>}
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">{repMode ? "My product target" : "Sales team challenge"}</p>
              <h3 className="mt-2 break-words text-xl font-black leading-tight text-gray-950">{product?.name ?? challenge.name}</h3>
              <p className="mt-1 text-sm font-semibold text-gray-500">{challenge.name}</p>
              <p className="mt-2 text-xs font-semibold text-gray-400">{challenge.qualifiedOrders} delivered order{challenge.qualifiedOrders === 1 ? "" : "s"}{challenge.confirmedPieces !== undefined ? ` · ${challenge.confirmedPieces} pcs awaiting delivery` : ""}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="min-w-[180px] rounded-lg border border-violet-100 bg-violet-50/70 px-5 py-4 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">{repMode ? "My maximum reward" : "Manager reward"}</p>
              <p className="mt-2 text-2xl font-black text-violet-700">{formatMoney(repMode ? challenge.rewardAmount : (challenge.managerRewardAmount ?? 0), challenge.currency)}</p>
              <p className="mt-1 text-[10px] font-semibold text-gray-500">{hasMilestones ? "Paid through weekly milestones" : "Paid when the full target is met"}</p>
              {!repMode && <p className="mt-2 text-[10px] font-bold text-emerald-700">Sales-rep pool: {formatMoney(challenge.rewardAmount, challenge.currency)}</p>}
              {!repMode && canEdit && (
                <button type="button" className="!min-h-0 mt-3 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-100" onClick={onEdit}>
                  {(challenge.managerRewardAmount ?? 0) > 0 ? "Edit manager bonus" : "Set manager bonus"}
                </button>
              )}
            </div>
            {canEdit && <div className="relative"><button type="button" className="!min-h-0 flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-violet-700" onClick={() => setMenuOpen((open) => !open)} title="Challenge options"><MoreVertical className="h-4 w-4" /></button>{menuOpen && <div className="absolute right-0 top-10 z-10 w-32 rounded-lg border border-gray-200 bg-white p-1 text-left shadow-lg"><button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50" onClick={() => { setMenuOpen(false); onEdit(); }}>Edit</button><button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs font-bold text-amber-700 hover:bg-amber-50" onClick={() => { setMenuOpen(false); onToggleStatus(); }}>{challenge.status === "active" ? "Pause" : "Resume"}</button><button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs font-bold text-rose-600 hover:bg-rose-50" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button></div>}</div>}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 border-y border-gray-100 py-4 sm:grid-cols-3">
          <Metric label={`${challenge.cadence} target`} value={`${challenge.targetUnits.toLocaleString()} pcs`} detail="Total for this challenge" />
          <Metric label="Overall progress" value={`${challenge.progressUnits.toLocaleString()} pcs`} detail={`${challenge.progressPercent}% complete`} />
          {challenge.windowFrom && challenge.windowTo ? (
            <Metric
              label="In this window"
              value={`${(challenge.windowDeliveredPieces ?? 0).toLocaleString()} pcs`}
              detail={`${windowLabel(challenge.windowFrom, challenge.windowTo)} · ${(challenge.windowQualifiedOrders ?? 0).toLocaleString()} order${(challenge.windowQualifiedOrders ?? 0) === 1 ? "" : "s"}`}
            />
          ) : null}
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">Time remaining</p>
            <p className="mt-2 flex items-center gap-2 text-xl font-black text-gray-900"><CalendarDays className="h-5 w-5 text-gray-400" /> {challenge.daysLeft} day{challenge.daysLeft === 1 ? "" : "s"}</p>
            <p className="mt-1 text-xs font-semibold text-gray-500">Until {formatDateShort(challenge.endDate)}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <AnimatedProgress percent={challenge.progressPercent} track="h-2.5" fill="bg-gradient-to-r from-violet-700 to-violet-400" />
          <span className="shrink-0 text-xs font-black text-gray-500">{challenge.progressUnits.toLocaleString()} / {challenge.targetUnits.toLocaleString()} pcs</span>
        </div>

        {repMode && challenge.teamTargetUnits !== undefined && (
          <div className="mt-4 grid gap-3 rounded-lg border border-violet-100 bg-violet-50/60 px-4 py-3 sm:grid-cols-3">
            <Metric label="Shared team target" value={`${(challenge.teamProgressUnits ?? 0).toLocaleString()} / ${challenge.teamTargetUnits.toLocaleString()} pcs`} detail={`${challenge.teamQualifiedOrders ?? 0} team deliveries`} />
            <Metric label="My delivered pieces" value={`${(challenge.deliveredPieces ?? challenge.progressUnits).toLocaleString()} pcs`} detail="Delivered and verified only" />
            <Metric label="Awaiting delivery" value={`${(challenge.awaitingDeliveryPieces ?? 0).toLocaleString()} pcs`} detail="Does not count yet" />
          </div>
        )}

        {repMode && <RepFocusPanel challenge={challenge} formatMoney={formatMoney} />}

        {/* The rep's own day-by-day. The manager has had this behind the eye
            icon on each rep card; the rep it describes could not see it. */}
        {repMode && (challenge.dailyProgress?.length ?? 0) > 0 && (
          <div className="mt-4">
            <ChallengeDayCalendar
              days={challenge.dailyProgress ?? []}
              today={challenge.today ?? dateKey(new Date())}
              target={challenge.targetUnits}
              delivered={challenge.deliveredPieces ?? challenge.progressUnits}
            />
          </div>
        )}

        {!repMode && challenge.allocations && challenge.allocations.length > 0 && (
          <AllocationPanel challenge={challenge} canEdit={canEdit} formatMoney={formatMoney} onSave={onSaveAllocations} />
        )}

        {hasMilestones ? (
          <div className="mt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-black uppercase tracking-[0.1em] text-violet-700">Weekly milestones <span className="normal-case tracking-normal text-gray-500">(reward split across {challenge.milestones.length} weeks)</span></p>
              <p className="text-sm font-black text-emerald-700">Earned: {formatMoney(challenge.earnedRewardAmount, challenge.currency)} / {formatMoney(challenge.rewardAmount, challenge.currency)}</p>
            </div>
            <div className={`mt-3 grid gap-3 ${challenge.milestones.length <= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
              {challenge.milestones.map((milestone) => <MilestoneCard key={milestone.index} milestone={milestone} currency={challenge.currency} formatMoney={formatMoney} />)}
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-xs font-semibold leading-5 text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Each week earns independently. A missed week pays zero, while successful milestone rewards remain earned.</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusStyle(challenge.computedStatus)}`}>{challenge.computedStatus}</span>
            <span className="text-xs font-bold text-gray-500">Full target challenge - no weekly milestones</span>
          </div>
        )}
      </div>
    </article>
  );
}

function AllocationPanel({ challenge, canEdit, formatMoney, onSave }: {
  challenge: ManagerProductChallenge;
  canEdit: boolean;
  formatMoney: Props["formatMoney"];
  onSave?: Props["onSaveAllocations"];
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ChallengeAllocation[]>(challenge.allocations ?? []);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedRepId, setSelectedRepId] = useState(challenge.allocations?.[0]?.repId ?? "");
  // Which rep's day-by-day calendar is open. Null = none.
  const [calendarRepId, setCalendarRepId] = useState<string | null>(null);
  useEffect(() => setRows(challenge.allocations ?? []), [challenge.id, challenge.allocations]);
  useEffect(() => setSelectedRepId(challenge.allocations?.[0]?.repId ?? ""), [challenge.id, challenge.allocations]);
  const targetTotal = rows.reduce((sum, row) => sum + Number(row.targetUnits || 0), 0);
  const rewardTotal = rows.reduce((sum, row) => sum + Number(row.rewardAmount || 0), 0);
  const piecesBalanced = targetTotal === challenge.targetUnits;
  const rewardBalanced = Math.abs(rewardTotal - challenge.rewardAmount) < 0.01;
  const balanced = piecesBalanced && rewardBalanced;
  // Name the half that blocks the save and by how much. The line used to print
  // both totals and leave the manager to work out which one was wrong - pieces
  // can balance exactly while a reward is 1,000 short, and the button just sat
  // there greyed with no reason given.
  const gapNote = (() => {
    const notes: string[] = [];
    if (!piecesBalanced) {
      const diff = targetTotal - challenge.targetUnits;
      notes.push(`${Math.abs(diff).toLocaleString()} pcs ${diff > 0 ? "over" : "short"}`);
    }
    if (!rewardBalanced) {
      const diff = rewardTotal - challenge.rewardAmount;
      notes.push(`${formatMoney(Math.abs(diff), challenge.currency)} ${diff > 0 ? "over" : "short"}`);
    }
    return notes.join(" · ");
  })();
  const save = async () => {
    if (!onSave || !balanced) return;
    setSaving(true); setMessage("");
    try {
      await onSave(challenge.id, rows.map(({ repId, targetUnits, rewardAmount, milestoneTargets }) => ({ repId, targetUnits, rewardAmount, milestoneTargets })));
      setEditing(false); setMessage("Rep allocations saved.");
    } catch (error: any) { setMessage(error?.message ?? "Could not save allocations."); }
    finally { setSaving(false); }
  };
  return (
    <section className="mt-5 rounded-xl border border-violet-100 bg-gradient-to-br from-violet-50/70 to-white p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-black uppercase tracking-[0.12em] text-violet-700">Target allocation — {rows.length} sales reps</p><p className="mt-1 text-xs font-semibold text-gray-500">One shared manager target, divided into personal rep targets.</p></div>
        {canEdit && <button type="button" className="!min-h-0 rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700" onClick={() => { setEditing((value) => !value); setMessage(""); }}>{editing ? "Cancel changes" : "Manage allocations"}</button>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((allocation, index) => (
          <article key={allocation.repId} onClick={() => !editing && setSelectedRepId(allocation.repId)} className={`rounded-lg border bg-white p-3 shadow-sm transition ${selectedRepId === allocation.repId ? "border-violet-500 ring-2 ring-violet-100" : "border-gray-200"} ${editing ? "" : "cursor-pointer hover:border-violet-300"}`}>
            <div className="flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-black text-violet-700">{allocation.repName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><div className="min-w-0"><p className="truncate text-sm font-black text-gray-950">{allocation.repName}</p><p className="text-[10px] font-bold text-violet-600">Individual share</p></div></div><div className="flex shrink-0 items-center gap-1.5"><span className="text-xs font-black text-gray-500">{allocation.progressPercent}%</span>{!editing && (allocation.dailyProgress?.length ?? 0) > 0 && (
              <button type="button" title={`Day-by-day for ${allocation.repName}`} aria-label={`Day-by-day for ${allocation.repName}`}
                onClick={(event) => { event.stopPropagation(); setCalendarRepId(allocation.repId); }}
                className="!min-h-0 rounded-lg border border-gray-200 bg-white p-1.5 text-violet-600 transition-colors hover:border-violet-300 hover:bg-violet-50">
                <Eye className="h-3.5 w-3.5" />
              </button>
            )}</div></div>
            {editing ? <div className="mt-3 grid grid-cols-2 gap-2"><label className="text-[9px] font-black uppercase text-gray-400">Pieces<input type="number" min="1" value={allocation.targetUnits} onChange={(event) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, targetUnits: Number(event.target.value) } : row))} className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm font-black text-gray-900" /></label><label className="text-[9px] font-black uppercase text-gray-400">Reward<input type="number" min="0" value={allocation.rewardAmount} onChange={(event) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, rewardAmount: Number(event.target.value) } : row))} className="mt-1 w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm font-black text-gray-900" /></label></div> : <p className="mt-3 text-lg font-black text-violet-700">{allocation.deliveredPieces.toLocaleString()} <span className="text-xs text-gray-400">/ {allocation.targetUnits.toLocaleString()} pcs</span></p>}
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100"><div className="h-full rounded-full bg-violet-600" style={{ width: `${Math.min(100, allocation.progressPercent)}%` }} /></div>
            <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-gray-500"><span>Needs {allocation.requiredPace.toLocaleString()} pcs/day</span><span className="text-emerald-700">{formatMoney(allocation.rewardAmount, challenge.currency)}</span></div>
            {/* ⚠️ The period filter's only effect on this card. It is stated as
                a separate line rather than replacing the numbers above, because
                scoping a month-long target to "Today" would read 0 / N and
                "Behind" - a false alarm, not information. */}
            {challenge.windowFrom && challenge.windowTo && (
              <div className="mt-1.5 flex items-center justify-between rounded-md bg-violet-50/70 px-2 py-1 text-[10px] font-bold text-violet-800">
                <span className="truncate">{windowLabel(challenge.windowFrom, challenge.windowTo)}</span>
                <span className="shrink-0 tabular-nums">
                  {(allocation.windowDeliveredPieces ?? 0).toLocaleString()} pcs
                  <span className="ml-1 font-semibold text-violet-500">
                    · {(allocation.windowQualifiedOrders ?? 0).toLocaleString()} order{(allocation.windowQualifiedOrders ?? 0) === 1 ? "" : "s"}
                  </span>
                </span>
              </div>
            )}
          </article>
        ))}
      </div>

      {calendarRepId && (() => {
        const target = rows.find((row) => row.repId === calendarRepId);
        if (!target) return null;
        return (
          <RepChallengeCalendar
            allocation={target}
            currency={challenge.currency}
            today={challenge.today ?? new Date().toISOString().slice(0, 10)}
            formatMoney={formatMoney}
            onClose={() => setCalendarRepId(null)}
          />
        );
      })()}
      {!editing && (() => {
        const selected = rows.find((row) => row.repId === selectedRepId) ?? rows[0];
        if (!selected) return null;
        const daily = selected.currentWeekDaysLeft > 0 ? Math.ceil(selected.currentWeekRemaining / selected.currentWeekDaysLeft) : 0;
        return <div className="mt-4 grid gap-3 border-t border-violet-100 pt-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,.6fr)]">
          <div className="rounded-lg border border-violet-200 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-700">{selected.repName}&apos;s {selected.currentWeekIndex ? `week ${selected.currentWeekIndex} checkpoint` : "target this week"}</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Checkpoint target" value={`${selected.currentWeekTarget.toLocaleString()} pcs`} detail={selected.currentWeekEndDate ? `Total by ${formatDateShort(selected.currentWeekEndDate)}` : "Total by this date"} />
              <Metric label="Counted so far" value={`${selected.currentWeekDelivered.toLocaleString()} pcs`} detail="Delivered and verified" />
              <Metric label="Still needed" value={`${selected.currentWeekRemaining.toLocaleString()} pcs`} detail={`${selected.currentWeekDaysLeft} days left`} />
              <Metric label="Required pace" value={`${daily.toLocaleString()} pcs/day`} detail={`${selected.todayDeliveredPieces} delivered today`} />
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-700">How the rep qualifies</p>
            <ol className="mt-3 space-y-2 text-xs font-semibold text-gray-700"><li>1. Team reaches the weekly milestone</li><li>2. Rep reaches this personal share</li><li>3. Orders are delivered and verified</li></ol>
            <p className="mt-3 rounded-md bg-violet-50 px-3 py-2 text-sm font-black text-violet-700">Projected reward: {formatMoney(selected.rewardAmount / Math.max(1, challenge.milestones.length || 1), challenge.currency)}</p>
          </div>
        </div>;
      })()}
      <div className="mt-3 flex flex-col gap-2 border-t border-violet-100 pt-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-col gap-0.5"><p className={`text-xs font-bold ${balanced ? "text-emerald-700" : "text-rose-600"}`}>Allocated: <span className={piecesBalanced ? "text-emerald-700" : "text-rose-600"}>{targetTotal.toLocaleString()} / {challenge.targetUnits.toLocaleString()} pcs</span> · <span className={rewardBalanced ? "text-emerald-700" : "text-rose-600"}>{formatMoney(rewardTotal, challenge.currency)} / {formatMoney(challenge.rewardAmount, challenge.currency)}</span></p>{editing && !balanced && <p className="text-[11px] font-semibold text-rose-600">{gapNote} - the whole target and the whole reward must be shared out before you can save.</p>}</div>{editing && <button type="button" disabled={!balanced || saving} title={balanced ? undefined : `Cannot save: ${gapNote}.`} onClick={() => void save()} className="!min-h-0 rounded-lg bg-violet-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40 disabled:cursor-not-allowed">{saving ? "Saving..." : "Save rep targets"}</button>}</div>
      {message && <p className={`mt-2 text-xs font-bold ${message.includes("saved") ? "text-emerald-700" : "text-rose-600"}`}>{message}</p>}
    </section>
  );
}

function RepFocusPanel({ challenge, formatMoney }: { challenge: ManagerProductChallenge; formatMoney: Props["formatMoney"] }) {
  const weeklyTarget = challenge.currentWeekTarget ?? 0;
  const weeklyDelivered = challenge.currentWeekDelivered ?? 0;
  const remaining = challenge.currentWeekRemaining ?? Math.max(0, weeklyTarget - weeklyDelivered);
  const daysLeft = challenge.currentWeekDaysLeft ?? 0;
  const neededDaily = daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0;
  const average = challenge.qualifiedOrders > 0 ? (challenge.progressUnits / challenge.qualifiedOrders).toFixed(1) : "0";
  const milestoneReward = challenge.rewardAmount / Math.max(1, challenge.milestones.length || 1);
  // ⚠️ THESE FIGURES ARE CUMULATIVE, and the labels have to say so. A milestone
  // is a running checkpoint, not a self-contained week: it is Earned when
  // everything delivered since the challenge began clears it. Calling the
  // target "this week" while the number covers the whole month to date is how
  // a rep reads a catch-up figure as a fresh weekly quota.
  const checkpointIndex = challenge.currentWeekIndex ?? 0;
  const checkpointEnds = challenge.currentWeekEndDate ?? "";
  // ⚠️ NEVER PRINT A TEAM PAYLOAD AS THIS REP'S WEEK. The checkpoint fields
  // are only in the rep-scoped response; a team payload has none, so every
  // figure here would read 0 and look like the checkpoint maths had broken
  // again. Say what is actually happening instead.
  if (challenge.scope === "team") {
    return <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <p className="m-0 text-xs font-black uppercase tracking-[0.12em] text-amber-800">This week</p>
      <p className="m-0 mt-1.5 text-sm font-bold text-amber-900">Your personal figures are still loading.</p>
      <p className="m-0 mt-1 text-xs font-semibold text-amber-700">The numbers above are the team&apos;s totals for this challenge, not yours. Reopen this page if it does not refresh on its own.</p>
    </section>;
  }
  return <section className="mt-4 grid gap-3 lg:grid-cols-2">
    <div className="rounded-xl border border-violet-100 bg-white p-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-violet-700">
        {checkpointIndex > 0 ? `Week ${checkpointIndex} checkpoint` : "This week"}
        {checkpointEnds && <span className="ml-1.5 normal-case tracking-normal text-gray-500">closes {formatDateShort(checkpointEnds)}</span>}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="Checkpoint target" value={`${weeklyTarget.toLocaleString()} pcs`} detail="Total by this date" /><Metric label="Counted so far" value={`${weeklyDelivered.toLocaleString()} pcs`} detail="Delivered and verified" /><Metric label="Still needed" value={`${remaining.toLocaleString()} pcs`} detail="To clear this checkpoint" /><Metric label="Days left" value={daysLeft.toLocaleString()} detail="Today included" /></div>
      <div className="mt-3 flex items-center gap-3"><span className="text-xs font-black text-gray-700">Needed daily {neededDaily.toLocaleString()} pcs/day</span><AnimatedProgress percent={weeklyTarget > 0 ? Math.round((weeklyDelivered / weeklyTarget) * 100) : 0} track="h-2" fill="bg-violet-600" /></div>
      <p className="mt-2 text-[11px] font-semibold leading-relaxed text-gray-500">Checkpoints run on from each other: a shortfall from an earlier week is still owed here, and anything extra you delivered already counts towards it.</p>
      {(challenge.awaitingDeliveryPieces ?? 0) > 0 && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">{challenge.awaitingDeliveryPieces?.toLocaleString()} pieces are awaiting delivery and do not count yet.</p>}
    </div>
    <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-4">
      <p className="text-xs font-black uppercase tracking-[0.12em] text-violet-700">Today&apos;s focus</p>
      <ul className="mt-3 space-y-2 text-sm font-semibold text-gray-700"><li>Sell and deliver {neededDaily.toLocaleString()} pieces to maintain pace</li><li>Follow up {(challenge.awaitingDeliveryPieces ?? 0).toLocaleString()} pieces awaiting delivery</li><li>Current average: {average} pcs per delivered order</li></ul>
      <div className="mt-4 grid grid-cols-2 gap-2 border-t border-violet-100 pt-3"><Metric label="Delivered today" value={`${(challenge.todayDeliveredPieces ?? 0).toLocaleString()} pcs`} detail="Verified today" /><Metric label="Projected weekly reward" value={formatMoney(milestoneReward, challenge.currency)} detail="If both milestones are met" /></div>
    </div>
  </section>;
}

function MilestoneCard({ milestone, currency, formatMoney }: { milestone: ManagerChallengeMilestone; currency: string; formatMoney: Props["formatMoney"] }) {
  const tone = milestoneTone(milestone.status);
  const Icon = tone.Icon;
  const shownReward = milestone.status === "Missed" ? 0 : milestone.rewardAmount;
  const rewardState = milestone.status === "Earned" ? "Earned" : milestone.status === "Missed" ? "Missed" : "Available";
  const remainingUnits = Math.max(0, milestone.targetUnits - milestone.progressUnits);
  const today = new Date();
  const end = parseDateKey(milestone.endDate);
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime()) / DAY_MS) + 1);
  const start = parseDateKey(milestone.startDate);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime() - start.getTime()) / DAY_MS) + 1));
  const dailyTarget = Math.ceil(milestone.targetUnits / totalDays);
  const expectedByToday = dailyTarget * elapsedDays;
  const requiredPace = daysRemaining > 0 ? Math.ceil(remainingUnits / daysRemaining) : remainingUnits;
  const paceVariance = milestone.progressUnits - expectedByToday;
  const dailyPaceStatus = milestone.status === "Upcoming" ? `Starts ${formatDateShort(milestone.startDate)}` : paceVariance > 0 ? `Ahead by ${paceVariance.toLocaleString()} pcs` : paceVariance === 0 ? "On pace" : `${Math.abs(paceVariance).toLocaleString()} pcs to catch up`;
  const paceGuidance = milestone.status === "Upcoming" ? "Prepare for this week" : paceVariance >= 0 ? "Keep this pace" : `Need ${Math.max(requiredPace, dailyTarget).toLocaleString()} pcs/day`;
  return (
    <div className={`rounded-lg border p-3 ${tone.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase text-violet-700">Week {milestone.index}</p>
          <p className="mt-1 text-[10px] font-semibold text-gray-500">{formatDateShort(milestone.startDate)} - {formatDateShort(milestone.endDate)}</p>
        </div>
        <Icon className={`h-5 w-5 ${milestone.status === "Earned" ? "text-emerald-600" : milestone.status === "Missed" ? "text-rose-500" : "text-blue-600"}`} />
      </div>
      <p className={`mt-4 text-xl font-black ${tone.value}`}>{milestone.progressUnits.toLocaleString()} <span className="text-sm text-gray-400">/ {milestone.targetUnits.toLocaleString()} pcs</span></p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, milestone.progressPercent)}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md bg-white/70 px-2 py-1.5"><p className="font-bold uppercase text-gray-400">Remaining</p><p className="mt-0.5 text-sm font-black text-gray-900">{remainingUnits.toLocaleString()} pcs</p></div>
        <div className="rounded-md bg-white/70 px-2 py-1.5"><p className="font-bold uppercase text-gray-400">Needed daily</p><p className="mt-0.5 text-sm font-black text-gray-900">{requiredPace.toLocaleString()} pcs</p></div>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1.5 text-[10px]">
        <span><span className="font-bold uppercase text-gray-400">Daily target</span> <b className="ml-1 text-gray-900">{dailyTarget.toLocaleString()} pcs/day</b></span>
        <span className={`text-right font-black ${paceVariance > 0 ? "text-emerald-600" : paceVariance < 0 ? "text-rose-600" : "text-gray-500"}`}>{dailyPaceStatus}<span className="ml-1 font-semibold text-gray-500">· {paceGuidance}</span></span>
      </div>
      <p className={`mt-2 text-[10px] font-black ${milestone.status === "Missed" ? "text-rose-600" : milestone.status === "Earned" ? "text-emerald-600" : "text-blue-600"}`}>{milestone.status === "Earned" ? "Target met" : milestone.status === "Missed" ? "Target missed" : milestone.status}</p>
      <div className={`mt-3 flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-black ${tone.footer}`}>
        <span>{formatMoney(shownReward, currency)}</span><span>{rewardState}</span>
      </div>
    </div>
  );
}

function ChallengeSelector({ challenge, product, selected, onClick, accent }: { challenge: ManagerProductChallenge; product?: ChallengeProduct; selected: boolean; onClick: () => void; accent: (typeof CARD_ACCENTS)[number] }) {
  const completed = challenge.progressUnits >= challenge.targetUnits;
  const totalDays = Math.max(1, Math.ceil((parseDateKey(challenge.endDate).getTime() - parseDateKey(challenge.startDate).getTime()) / DAY_MS) + 1);
  const elapsed = Math.max(0, totalDays - Math.max(0, challenge.daysLeft));
  const expected = (elapsed / totalDays) * challenge.targetUnits;
  const ratio = expected > 0 ? challenge.progressUnits / expected : 1;
  const status = completed ? "Completed" : elapsed <= 1 && challenge.progressUnits === 0 ? "Just Started" : ratio < 0.8 ? "Behind" : ratio < 0.95 ? "At Risk" : "On Track";
  return <button type="button" onClick={onClick} className={`min-w-[270px] flex-1 rounded-xl border p-2.5 text-left transition ${selected ? "border-violet-500 bg-violet-50/70 ring-2 ring-violet-200" : "border-gray-200 bg-white hover:border-violet-300"}`}><div className="flex items-center gap-3">{product?.imageUrl ? <img src={product.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-100 object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500"><Package className="h-5 w-5" /></span>}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className={`truncate text-sm ${selected ? "font-black text-gray-950" : "font-bold text-gray-800"}`}>{product?.name ?? challenge.name}</span><span className="text-xs font-black text-gray-500">{challenge.progressPercent}%</span></div><p className="mt-1 text-xs font-black text-violet-700">{challenge.progressUnits.toLocaleString()} <span className="font-semibold text-gray-400">/ {challenge.targetUnits.toLocaleString()} pcs</span></p><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={`h-full rounded-full ${accent.bar}`} style={{ width: `${Math.min(100, challenge.progressPercent)}%` }} /></div><div className="mt-1.5 flex items-center justify-between gap-2">{challenge.windowFrom && challenge.windowTo ? <span className="truncate text-[9px] font-bold text-gray-500">{(challenge.windowDeliveredPieces ?? 0).toLocaleString()} pcs in window</span> : <span />}<span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${statusStyle(status)}`}>{status}</span></div></div></div></button>;
}

function CompactChallengeCard({
  challenge,
  product,
  canEdit,
  formatMoney,
  accent,
  onEdit
}: {
  challenge: ManagerProductChallenge;
  product?: ChallengeProduct;
  canEdit: boolean;
  formatMoney: Props["formatMoney"];
  accent: (typeof CARD_ACCENTS)[number];
  onEdit: () => void;
}) {
  const hasMilestones = challenge.milestoneMode === "weekly" && challenge.milestones?.length > 0;
  const cadenceLabel = challenge.cadence.charAt(0).toUpperCase() + challenge.cadence.slice(1);
  return (
    <article className="relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className={`h-1 ${accent.bar}`} />
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-[9px] font-black uppercase tracking-[0.12em] ${accent.label}`}>{cadenceLabel} challenge</p>
            <h4 className="mt-1 truncate text-sm font-black text-gray-950">{product?.name ?? challenge.name}</h4>
          </div>
          {canEdit && (
            <button type="button" className="!min-h-0 flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></button>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-2">
          <p className="text-xl font-black text-gray-950">
            {challenge.progressUnits.toLocaleString()} <span className="text-xs font-bold text-gray-400">/ {challenge.targetUnits.toLocaleString()} pcs</span>
          </p>
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-600">{challenge.progressPercent}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div className={`h-full rounded-full ${accent.bar}`} style={{ width: `${Math.min(100, challenge.progressPercent)}%` }} />
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-gray-500">
          <span>{challenge.daysLeft} day{challenge.daysLeft === 1 ? "" : "s"} left</span>
          <span className={`inline-flex rounded-full border px-2 py-0.5 font-black ${statusStyle(challenge.computedStatus)}`}>{challenge.computedStatus}</span>
        </div>

        {hasMilestones ? (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="text-[9px] font-black uppercase tracking-[0.1em] text-gray-400">Weekly milestones</p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {challenge.milestones.map((milestone) => {
                const tone = milestoneTone(milestone.status);
                const Icon = tone.Icon;
                const label = milestone.status === "Earned"
                  ? formatMoney(milestone.rewardAmount, challenge.currency)
                  : milestone.status === "Missed"
                  ? formatMoney(0, challenge.currency)
                  : milestone.status === "In Progress"
                  ? "Current"
                  : "Pending";
                const labelTone = milestone.status === "Earned" ? "text-emerald-600" : milestone.status === "Missed" ? "text-rose-500" : milestone.status === "In Progress" ? "text-blue-600" : "text-gray-400";
                return (
                  <div key={milestone.index} className="rounded-md border border-gray-100 bg-gray-50/70 px-1 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-0.5 text-[8px] font-black text-gray-400">
                      W{milestone.index}
                      <Icon className={`h-2.5 w-2.5 ${milestone.status === "Earned" ? "text-emerald-600" : milestone.status === "Missed" ? "text-rose-500" : "text-blue-500"}`} />
                    </div>
                    <p className="mt-0.5 text-[11px] font-black text-gray-900">{milestone.progressUnits.toLocaleString()}</p>
                    <p className={`truncate text-[8px] font-bold ${labelTone}`}>{label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusStyle(challenge.computedStatus)}`}>Full target - no weekly milestones</span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs">
          <div>
            <p className="text-[9px] font-black uppercase text-gray-400">Earned so far</p>
            <p className="mt-0.5 font-black text-emerald-700">{formatMoney(challenge.earnedRewardAmount, challenge.currency)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black uppercase text-gray-400">{cadenceLabel} bonus</p>
            <p className="mt-0.5 font-black text-violet-700">{formatMoney(challenge.rewardAmount, challenge.currency)}</p>
          </div>
        </div>
        <p className="mt-2 text-[9px] font-semibold leading-4 text-gray-400">{cadenceLabel} completion bonus unlocked at {challenge.targetUnits.toLocaleString()} pcs</p>
      </div>
    </article>
  );
}

function ChallengeSummaryStrip({ challenges, formatMoney }: { challenges: ManagerProductChallenge[]; formatMoney: Props["formatMoney"] }) {
  const stats = useMemo(() => {
    const totalTarget = challenges.reduce((sum, item) => sum + item.targetUnits, 0);
    const totalProgress = challenges.reduce((sum, item) => sum + item.progressUnits, 0);
    const hasWindow = challenges.some((item) => Boolean(item.windowFrom && item.windowTo));
    const windowProgress = challenges.reduce((sum, item) => sum + (item.windowDeliveredPieces ?? 0), 0);
    const totalProgressPercent = totalTarget > 0 ? Math.round((totalProgress / totalTarget) * 100) : 0;
    const totalEarned = challenges.reduce((sum, item) => sum + item.earnedRewardAmount, 0);
    const totalPotential = challenges.reduce((sum, item) => sum + item.rewardAmount, 0);
    const daysRemaining = challenges.reduce((min, item) => Math.min(min, item.daysLeft), Infinity);
    const requiredPace = challenges.reduce((sum, item) => {
      const remaining = Math.max(0, item.targetUnits - item.progressUnits);
      return sum + (item.daysLeft > 0 ? remaining / item.daysLeft : 0);
    }, 0);
    return {
      hasWindow,
      windowProgress,
      windowLabelText: windowLabel(challenges[0]?.windowFrom, challenges[0]?.windowTo),
      totalTarget,
      totalProgress,
      totalProgressPercent,
      totalEarned,
      totalPotential,
      daysRemaining: Number.isFinite(daysRemaining) ? daysRemaining : 0,
      requiredPace: Math.round(requiredPace),
      currency: challenges[0]?.currency ?? "NGN"
    };
  }, [challenges]);

  const items = [
    { icon: Target, label: "Active Targets", value: String(challenges.filter((item) => item.status === "active").length), detail: "Active challenges" },
    { icon: TrendingUp, label: "Total Progress", value: `${stats.totalProgress.toLocaleString()} / ${stats.totalTarget.toLocaleString()} pcs`, detail: stats.hasWindow ? `${stats.windowProgress.toLocaleString()} pcs in ${stats.windowLabelText}` : "Across all challenges" },
    { icon: Gift, label: "Total Earned", value: `${formatMoney(stats.totalEarned, stats.currency)} / ${formatMoney(stats.totalPotential, stats.currency)}`, detail: "Across all challenges" },
    { icon: Gauge, label: "Required Pace", value: `${stats.requiredPace.toLocaleString()} pcs/day`, detail: "To hit all targets" }
  ];

  return (
    <div className="grid grid-cols-1 gap-0 rounded-xl border border-indigo-100 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 border-b border-gray-100 p-3 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><item.icon className="h-3.5 w-3.5" /></span>
          <div><p className="text-[9px] font-black uppercase tracking-[0.08em] text-gray-400">{item.label}</p><p className="mt-1 text-sm font-black text-gray-950">{item.value}</p><p className="mt-0.5 text-[9px] font-semibold text-gray-400">{item.detail}</p></div>
        </div>
      ))}
    </div>
  );
}

/**
 * A progress bar that travels to its value instead of appearing at it.
 *
 * ⚠️ IT STARTS AT ZERO ON PURPOSE. The width is rendered as 0 on the first
 * paint and set to the real figure on the next frame, so the CSS transition
 * has something to animate from. Rendering the final width immediately would
 * show a bar that was simply always there - Bright's point was that a rep
 * should SEE the ground they have covered, and see that there is more of it
 * to take. The same effect re-runs when the number changes, so a fresh
 * delivery slides the bar forward rather than teleporting it.
 *
 * Motion is disabled wholesale under prefers-reduced-motion in styles.css;
 * the bar still shows the right width, it just arrives there.
 */
function AnimatedProgress({ percent, track, fill }: { percent: number; track: string; fill: string }) {
  const target = Math.max(0, Math.min(100, percent));
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return (
    <div className={`flex-1 overflow-hidden rounded-full bg-gray-100 ${track}`}>
      <div className={`challenge-progress-fill h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">{label}</p><p className="mt-2 text-2xl font-black text-violet-700">{value}</p><p className="mt-1 text-xs font-semibold text-gray-500">{detail}</p></div>;
}

function FieldLabel({ label, small = false, children }: { label: string; small?: boolean; children: ReactNode }) {
  return <label className={`block font-black text-gray-500 ${small ? "text-[10px]" : "text-xs"}`}><span>{label}</span><div className="mt-1.5">{children}</div></label>;
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`!min-h-0 rounded-lg border px-3 py-2 text-xs font-black ${selected ? "border-violet-300 bg-white text-violet-700" : "border-gray-200 bg-white text-gray-500"}`} onClick={onClick}>{children}</button>;
}

function MoneyField({ label, value, readOnly = false, onChange }: { label: string; value: number; readOnly?: boolean; onChange?: (value: number) => void }) {
  return (
    <label className="block text-[10px] font-black text-gray-500">
      {label}
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-gray-400">N</span>
        <input
          type="number"
          min="0"
          readOnly={readOnly}
          className={`w-full rounded-lg border py-2.5 pl-7 pr-3 text-sm font-bold ${readOnly ? "border-gray-100 bg-gray-100 text-gray-500" : "border-gray-200 bg-white text-gray-900"}`}
          value={readOnly ? Math.round(value) : value}
          onChange={(event) => onChange?.(Math.max(0, Number(event.target.value) || 0))}
        />
      </div>
    </label>
  );
}
