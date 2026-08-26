import { useEffect, useMemo, useState } from "react";
import { Phone, RefreshCw, CheckSquare, Inbox, TrendingUp, TrendingDown, Info, X, Search, ChevronDown, ChevronUp, Lightbulb } from "lucide-react";
import type { RecoveryCalendarDay, RecoveryCalendarView, RecoveryDayActivity } from "../lib/api";
// Reused, not re-derived: the console already owns one outcome vocabulary and
// one set of tones for it, and a second copy here would drift.
import { classifyFrontendFollowUpOutcome, followUpOutcomeToneClass } from "../lib/followUpOutcomes";

type Props = {
  view: RecoveryCalendarView;
  /** The SELECTED window inside the month(s) on screen. Null = whole payload. */
  range?: { start: string; end: string } | null;
  loading?: boolean;
  formatMoney: (value: number) => string;
  /** Fetches what a day's counts are actually made of. */
  loadDayActivity?: (day: string) => Promise<RecoveryDayActivity>;
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
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const longDate = (key: string) =>
  new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/**
 * Every stored value that can reach this panel, named and toned exactly once.
 *
 * ⚠️ The lists used to print the column straight out of the database, so a
 * supervisor's screen read "not_reached", "not_reachable", "no_response". Those
 * are schema, not English, and nobody outside the codebase can tell
 * "not_reached" (nobody picked up) from "not_reachable" (the line is dead) -
 * which is the difference between calling again and correcting the number.
 *
 * Covered here: reach_status, retention_outcome, satisfaction_outcome and
 * customer_response, i.e. every column the day-activity endpoint folds into its
 * single `outcome` field. Anything unrecognised is still de-cased rather than
 * shown raw, so a value added later degrades to "Some new code", never to
 * some_new_code.
 */
const CHIP_TONE = {
  good: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  bad: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  quiet: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"
};

type ActivityChip = { label: string; tone: string };

const OUTCOME_CHIPS: Record<string, ActivityChip> = {
  // reach_status
  reached: { label: "Reached", tone: CHIP_TONE.good },
  not_reached: { label: "Not reached", tone: CHIP_TONE.warn },
  not_reachable: { label: "Not reachable", tone: CHIP_TONE.bad },
  wrong_number: { label: "Wrong number", tone: CHIP_TONE.bad },
  // retention_outcome
  accepted: { label: "Accepted", tone: CHIP_TONE.good },
  declined: { label: "Declined", tone: CHIP_TONE.bad },
  no_response: { label: "No response", tone: CHIP_TONE.warn },
  // satisfaction_outcome
  satisfied: { label: "Satisfied", tone: CHIP_TONE.good },
  has_not_used_it: { label: "Not used yet", tone: CHIP_TONE.quiet },
  needs_usage_guidance: { label: "Needs guidance", tone: CHIP_TONE.info },
  wrong_damaged_or_incomplete: { label: "Wrong / damaged", tone: CHIP_TONE.bad },
  not_satisfied: { label: "Not satisfied", tone: CHIP_TONE.bad },
  potential_repeat_buyer: { label: "Repeat buyer", tone: CHIP_TONE.good },
  potential_referral_customer: { label: "Referral lead", tone: CHIP_TONE.good },
  // customer_response
  neutral: { label: "Neutral", tone: CHIP_TONE.quiet },
  complaint: { label: "Complaint", tone: CHIP_TONE.bad }
};

/** Last resort: de-case an unknown code rather than print the column value. */
const humaniseCode = (value: string) => {
  const words = value.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : "Logged";
};

const outcomeChip = (value: string): ActivityChip => {
  const key = value.trim().toLowerCase();
  if (!key) return { label: "Logged", tone: CHIP_TONE.quiet };
  return OUTCOME_CHIPS[key] ?? { label: humaniseCode(value), tone: CHIP_TONE.quiet };
};

/** An order status, toned the way the rest of the console tones it. */
const statusChip = (status: string): ActivityChip => {
  const key = status.trim().toLowerCase();
  if (!key) return { label: "No status", tone: CHIP_TONE.quiet };
  if (key === "delivered") return { label: status, tone: CHIP_TONE.good };
  if (key === "failed" || key === "cancelled") return { label: status, tone: CHIP_TONE.bad };
  if (key === "dispatched" || key === "in process") return { label: status, tone: CHIP_TONE.info };
  return { label: status, tone: CHIP_TONE.quiet };
};

/**
 * ⚠️ A follow-up's chip says what the rep RECORDED, not what a keyword search
 * guessed they meant. Reps type prose into "Describe the outcome", and reading
 * a disposition out of a sentence ("not really serious" -> Not interested) is
 * an inference that lands on a page the rep is judged by. So: the app's own
 * outcome vocabulary first, where the text IS one of the known labels, then the
 * customer_reached flag the rep actually ticked. The sentence itself is still
 * printed in full underneath, which is where the nuance belongs.
 */
const followUpChip = (row: { outcome: string; note: string; reached: boolean }): ActivityChip => {
  const definition = classifyFrontendFollowUpOutcome({ outcomeCode: row.outcome || row.note });
  if (definition?.bucket) return { label: definition.label, tone: followUpOutcomeToneClass(definition.group) };
  return row.reached
    ? { label: "Reached", tone: CHIP_TONE.good }
    : { label: "Not reached", tone: CHIP_TONE.warn };
};

/**
 * One vocabulary for the filter bar, so "Not reached" means the same thing in
 * a follow-up, a retention touch and a claim. Claims and deliveries are not
 * contact attempts at all - they answer "failed" or nothing.
 */
type ActivityReach = "reached" | "not_reached" | "failed" | "none";

const ACTIVITY_FILTERS = [
  { key: "all" as const, label: "All", on: "border-[#1F8FE0] bg-[#1F8FE0] text-white" },
  { key: "reached" as const, label: "Reached", on: "border-emerald-500 bg-emerald-500 text-white" },
  { key: "not_reached" as const, label: "Not reached", on: "border-amber-500 bg-amber-500 text-white" },
  { key: "failed" as const, label: "Failed", on: "border-rose-500 bg-rose-500 text-white" }
];

/** Rows shown per stack before "View all". */
const ACTIVITY_PREVIEW = 5;

export default function RecoveryBonusCalendar({ view, range, loading, formatMoney, loadDayActivity }: Props) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [activity, setActivity] = useState<RecoveryDayActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // ── The day's activity, as one interrogable list ──────────
  const [activitySearch, setActivitySearch] = useState("");
  const [activityFilter, setActivityFilter] = useState<typeof ACTIVITY_FILTERS[number]["key"]>("all");
  // Exactly one stack open at a time. This panel lives inside a day cell, and
  // four expanded lists is the wall of text it is replacing.
  const [openStack, setOpenStack] = useState("followUps");
  const [activityShowAll, setActivityShowAll] = useState("");
  const [activityRefresh, setActivityRefresh] = useState(0);
  const openActivityStack = (key: string) => { setOpenStack(key); setActivityShowAll(""); };

  // Loaded per day, on demand. A month of activity fetched up front would be
  // thousands of rows for a panel that shows one day at a time.
  useEffect(() => {
    if (!selectedDay || !loadDayActivity) { setActivity(null); return; }
    let cancelled = false;
    setActivityLoading(true);
    setActivity(null);
    loadDayActivity(selectedDay)
      .then((result) => { if (!cancelled) setActivity(result); })
      .catch(() => { if (!cancelled) setActivity(null); })
      .finally(() => { if (!cancelled) setActivityLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDay, activityRefresh]);

  // A new day, search or filter is a new list, so the preview starts over
  // rather than leaving a stack expanded from whatever was on screen before.
  useEffect(() => { setActivityShowAll(""); }, [selectedDay, activitySearch, activityFilter]);

  /**
   * Every logged thing on this day, normalised to ONE row shape - who, what was
   * said, which outcome, when - so the search box, the filter chips and the
   * four stacks all read the same rows. Four lists with four shapes is how a
   * filter ends up meaning something different in each section.
   */
  const activityGroups = useMemo(() => {
    const needle = activitySearch.trim().toLowerCase();
    type Row = {
      key: string; orderId: string; customer: string; phone: string;
      detail: string; at: string; chip: ActivityChip; reach: ActivityReach; repeats: number;
    };
    const build = (rows: Row[]) => rows.filter((row) => {
      if (activityFilter !== "all" && row.reach !== activityFilter) return false;
      if (!needle) return true;
      return `${row.customer} ${row.orderId}`.toLowerCase().includes(needle);
    });

    const followUps: Row[] = (activity?.followUps ?? []).map((row, index) => ({
      key: `f-${row.orderId}-${row.at}-${index}`,
      orderId: row.orderId, customer: row.customer, phone: row.phone,
      detail: row.outcome || row.note, at: row.at,
      chip: followUpChip(row),
      reach: row.reached ? "reached" : "not_reached",
      repeats: row.repeats
    }));
    const retention: Row[] = (activity?.retention ?? []).map((row, index) => {
      const chip = outcomeChip(row.outcome);
      // ⚠️ Reach is read from the STORED code, not from the chip's wording: the
      // chip is for the eye, the filter has to agree with the database.
      const code = row.outcome.trim().toLowerCase();
      return {
        key: `r-${row.orderId}-${row.at}-${index}`,
        orderId: row.orderId, customer: row.customer, phone: "",
        detail: row.response || humaniseCode(row.stage), at: row.at, chip,
        reach: (code === "not_reached" || code === "not_reachable" || code === "wrong_number" || code === "no_response"
          ? "not_reached" : "reached") as ActivityReach,
        repeats: 1
      };
    });
    const claimed: Row[] = (activity?.claimed ?? []).map((row, index) => ({
      key: `c-${row.orderId}-${index}`,
      orderId: row.orderId, customer: row.customer, phone: row.phone,
      detail: formatMoney(row.amount), at: "", chip: statusChip(row.status),
      // A claim is not a contact attempt: it answers the Failed filter or none
      // of them, rather than pretending somebody was or was not reached.
      reach: (row.status.trim().toLowerCase() === "failed" ? "failed" : "none") as ActivityReach,
      repeats: 1
    }));
    const delivered: Row[] = (activity?.delivered ?? []).map((row, index) => ({
      key: `d-${row.orderId}-${index}`,
      orderId: row.orderId, customer: row.customer, phone: "",
      detail: formatMoney(row.amount), at: "",
      chip: { label: "Delivered", tone: CHIP_TONE.good }, reach: "none" as ActivityReach, repeats: 1
    }));

    const countOf = (rows: Row[], reach: ActivityReach) => rows.filter((row) => row.reach === reach).length;
    /**
     * ⚠️ DISTINCT ORDERS, not rows - because that is what the four metric cards
     * directly above this panel count, and what the calendar cell counts. Five
     * calls to one customer is one order followed up, and a headline here that
     * counted touches would sit inches from a card counting orders, under the
     * same word. `order_contact_attempts` also carries ~119 genuine duplicate
     * submissions, so rows are the wrong unit twice over. Every touch is still
     * listed underneath; the count just stops disagreeing with its neighbour.
     */
    const distinctOrders = (rows: Row[]) => new Set(rows.map((row) => row.orderId)).size;
    return [
      { key: "followUps", label: "Follow-ups", noun: "follow-ups", hint: "Customers that needed a touch today",
        icon: <Phone className="h-3.5 w-3.5 text-emerald-600" />, iconTone: "bg-emerald-50 dark:bg-emerald-500/15",
        openBorder: "border-emerald-200", openHead: "bg-emerald-50/70 dark:bg-emerald-500/10",
        chipOn: "border-emerald-500 bg-emerald-500 text-white",
        all: followUps, rows: build(followUps), orders: distinctOrders(followUps),
        summary: [
          { label: "reached", count: countOf(followUps, "reached"), tone: CHIP_TONE.good },
          { label: "not reached", count: countOf(followUps, "not_reached"), tone: CHIP_TONE.warn }
        ].filter((chip) => chip.count > 0) },
      { key: "retention", label: "Retention touches", noun: "retention touches", hint: "Customers being re-engaged",
        icon: <RefreshCw className="h-3.5 w-3.5 text-sky-600" />, iconTone: "bg-sky-50 dark:bg-sky-500/15",
        openBorder: "border-sky-200", openHead: "bg-sky-50/70 dark:bg-sky-500/10",
        chipOn: "border-sky-500 bg-sky-500 text-white",
        all: retention, rows: build(retention), orders: distinctOrders(retention),
        summary: [
          { label: "reached", count: countOf(retention, "reached"), tone: CHIP_TONE.good },
          { label: "not reached", count: countOf(retention, "not_reached"), tone: CHIP_TONE.warn }
        ].filter((chip) => chip.count > 0) },
      { key: "claimed", label: "Claimed", noun: "claims", hint: "Orders taken on today",
        icon: <Inbox className="h-3.5 w-3.5 text-amber-600" />, iconTone: "bg-amber-50 dark:bg-amber-500/15",
        openBorder: "border-amber-200", openHead: "bg-amber-50/70 dark:bg-amber-500/10",
        chipOn: "border-amber-500 bg-amber-500 text-white",
        all: claimed, rows: build(claimed), orders: distinctOrders(claimed),
        summary: [{ label: "failed", count: countOf(claimed, "failed"), tone: CHIP_TONE.bad }].filter((chip) => chip.count > 0) },
      { key: "delivered", label: "Delivered", noun: "deliveries", hint: "Recovered and delivered today",
        icon: <CheckSquare className="h-3.5 w-3.5 text-violet-600" />, iconTone: "bg-violet-50 dark:bg-violet-500/15",
        openBorder: "border-violet-200", openHead: "bg-violet-50/70 dark:bg-violet-500/10",
        chipOn: "border-violet-500 bg-violet-500 text-white",
        all: delivered, rows: build(delivered), orders: distinctOrders(delivered),
        summary: [] as { label: string; count: number; tone: string }[] }
    ].filter((group) => group.all.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, activitySearch, activityFilter]);

  const activityTotal = activityGroups.reduce((sum, group) => sum + group.orders, 0);

  const targets = view.targets ?? { followUp: 0, retention: 0, delivered: 0, claimed: 0 };
  const todayKey = new Date().toISOString().slice(0, 10);

  // Lead the first row with blanks so day 1 lands under its real weekday.
  // Without it every month renders as a straight run and the columns lie.
  const lead = useMemo(() => {
    if (view.days.length === 0) return 0;
    return new Date(`${view.days[0].day}T00:00:00Z`).getUTCDay();
  }, [view.days]);

  const selected = view.days.find((row) => row.day === selectedDay) ?? null;

  const inRange = (day: string) => !range || (day >= range.start && day <= range.end);

  /**
   * ⚠️ Every headline figure is recomputed from the SELECTED days.
   *
   * The payload now covers the whole month so the grid can be a grid, but the
   * cards must still answer for the window the rep chose. Both are derived from
   * the same day rows, so a card can never disagree with the cells above it.
   */
  const scoped = useMemo(() => {
    const days = view.days.filter((row) => inRange(row.day));
    const judgedDays = days.filter((row) => row.status !== "rest" && row.status !== "none");
    const claimTarget = view.targets?.claimed ?? 0;
    return {
      followUp: days.reduce((sum, row) => sum + row.followUp, 0),
      retention: days.reduce((sum, row) => sum + row.retention, 0),
      delivered: days.reduce((sum, row) => sum + row.delivered, 0),
      claimed: days.reduce((sum, row) => sum + row.claimed, 0),
      above: days.filter((row) => row.status === "above").length,
      below: days.filter((row) => row.status === "below" || row.status === "critical").length,
      claimMet: claimTarget > 0 ? judgedDays.filter((row) => row.claimed >= claimTarget).length : 0,
      claimMissed: claimTarget > 0
        ? judgedDays.filter((row) => !row.claimCapped && row.claimed < claimTarget).length : 0,
      claimAtCap: judgedDays.filter((row) => row.claimCapped).length
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.days, view.targets, range?.start, range?.end]);

  const judged = scoped.below + scoped.above;
  const hitRate = judged > 0 ? Math.round((scoped.above / judged) * 100) : null;

  // One grid per calendar month, so a range spanning months reads as months
  // rather than one continuous run of numbers under the wrong weekday columns.
  const monthGroups = useMemo(() => {
    const byMonth = new Map<string, typeof view.days>();
    view.days.forEach((row) => {
      const monthKey = row.day.slice(0, 7);
      const bucket = byMonth.get(monthKey);
      if (bucket) bucket.push(row); else byMonth.set(monthKey, [row]);
    });
    return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [view.days]);

  const ratio = (value: number, target: number) => (target > 0 ? Math.min(1, value / target) : 0);

  return (
    <div className={`transition-opacity duration-200 ${loading ? "opacity-40" : "opacity-100"}`}>
      {/* ── Metric strip ─────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {METRICS.map((metric) => {
          const total = scoped[metric.key];
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
                  ? `${scoped.claimMet} of ${scoped.claimMet + scoped.claimMissed} days hit ${perDayTarget}${
                      scoped.claimAtCap > 0 ? ` · ${scoped.claimAtCap} excused at cap` : ""}`
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
            {scoped.above}<span className="text-xl text-slate-500"> / {judged}</span>
          </p>
          {/* One bar, both figures. Two separate cards for "above" and "below"
              made a reader do the division themselves. */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500"
              style={{ width: `${hitRate ?? 0}%` }} />
          </div>
          <p className="m-0 mt-1.5 text-[11px] font-semibold text-slate-400">
            {hitRate === null ? "Nothing judged yet" : `${hitRate}% of judged days · ${scoped.below} short`}
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

          <div className="mt-4 space-y-6 overflow-x-auto">
            {monthGroups.map(([monthKey, monthDays]) => (
            <div key={monthKey} className="min-w-[560px]">
              {monthGroups.length > 1 && (
                <p className="m-0 mb-2 text-xs font-black tracking-tight text-slate-700">{monthTitle(monthDays[0].day)}</p>
              )}
              <div className="grid grid-cols-7 gap-1.5">
                {WEEKDAYS.map((initial, index) => (
                  <div key={`${monthKey}-${index}`} title={WEEKDAY_FULL[index]}
                    className="pb-1 text-center text-[10px] font-black uppercase tracking-wider text-slate-400">
                    {initial}
                  </div>
                ))}
                {Array.from({ length: new Date(`${monthDays[0].day}T00:00:00Z`).getUTCDay() })
                  .map((_, index) => <div key={`lead-${monthKey}-${index}`} />)}
                {monthDays.map((row) => {
                  const tone = STATUS[row.status];
                  const isSelected = row.day === selectedDay;
                  const isToday = row.day === todayKey;
                  const empty = row.status === "none";
                  // Outside the chosen window: still shown, so the month reads
                  // as a month, but visibly not part of what the cards count.
                  const outside = !inRange(row.day);
                  return (
                    <button
                      key={row.day}
                      type="button"
                      onClick={() => setSelectedDay(isSelected ? null : row.day)}
                      title={`${longDate(row.day)} — ${tone.label}`}
                      className={`!min-h-0 group relative flex flex-col gap-1.5 rounded-xl border p-2 text-left ring-2 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-md ${tone.cell} ${tone.ring} ${
                        outside ? "opacity-40 saturate-50" : ""} ${
                        isToday ? "calendar-today !border-violet-400" : ""} ${
                        isSelected ? "!ring-sky-500 shadow-md -translate-y-0.5" : ""}`}
                    >
                      <span className="flex items-center justify-between">
                        <span className={`text-[13px] font-black tabular-nums ${
                          isToday ? "text-violet-700 dark:text-violet-300" : "text-slate-700 dark:text-slate-200"}`}>
                          {dayNumber(row.day)}
                        </span>
                        {/* Today is marked even when it is outside the window,
                            so a rep stepping back through the month never loses
                            track of where "now" is. */}
                        {isToday
                          ? <span className="h-2 w-2 rounded-full bg-violet-500 ring-2 ring-violet-200" title="Today" />
                          : <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />}
                      </span>

                      {/* ⚠️ A rest day draws NO bars and NO zeros. Rendering
                          "0 0 0 0" in the same shape as a worked day is exactly
                          why Sundays read as missed days - the cell looked like
                          a failure that happened to be grey. It says Rest on a
                          hatch instead, which cannot be mistaken for a blank
                          no-data cell either. */}
                      {row.status === "rest" ? (
                        <span className="flex h-[42px] items-center justify-center">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                            Rest
                          </span>
                        </span>
                      ) : (
                      <>
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
                      </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            ))}
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

              {/* ── What the numbers are made of ─────────── */}
              {loadDayActivity && selected.status !== "rest" && (
                <div className="mt-4 border-t border-sky-200/70 pt-3">
                  {activityLoading ? (
                    <p className="m-0 py-3 text-center text-xs font-semibold text-slate-400">Loading the day's activity…</p>
                  ) : !activity || activityTotal === 0 ? (
                    <p className="m-0 py-3 text-center text-xs font-semibold text-slate-400">Nothing was logged on this day.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {/* Summary first: how much work this was, and what kind.
                          ⚠️ Deliberately a one-line chip row, NOT a second set
                          of stat tiles - the four cards directly above already
                          carry these counts against their targets, and two
                          panels of the same numbers is how 3 and 26 got
                          compared on this very page. */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="m-0 flex items-baseline gap-2">
                          <span className="text-[13px] font-black text-slate-900 dark:text-slate-100">Follow-up Activity</span>
                          <span className="text-[11px] font-bold text-slate-400">
                            {activityTotal} activit{activityTotal === 1 ? "y" : "ies"}
                          </span>
                        </p>
                        <button type="button" onClick={() => setActivityRefresh((tick) => tick + 1)}
                          className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 transition-colors hover:bg-slate-50">
                          <RefreshCw className="h-3 w-3" /> Refresh
                        </button>
                      </div>
                      {/* Each chip is also the way into its stack, so the
                          summary and the navigation are the same control. */}
                      <div className="flex flex-wrap gap-1.5">
                        {activityGroups.map((group) => (
                          <button key={group.key} type="button" onClick={() => openActivityStack(group.key)}
                            className={`!min-h-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                              openStack === group.key ? group.chipOn : "border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50"}`}>
                            {group.label}
                            <span className="font-black tabular-nums">{group.orders}</span>
                          </button>
                        ))}
                      </div>

                      {/* Turns an activity dump into something a supervisor can
                          interrogate: which customer, and which outcome. */}
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                        <div className="relative min-w-0 flex-1">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                          <input type="search" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)}
                            placeholder="Search customer or order #…"
                            className="!min-h-0 h-8 w-full rounded-lg border border-slate-200/80 bg-white pl-8 pr-2 text-[12px] text-slate-700 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200" />
                        </div>
                        <div className="inline-flex flex-wrap gap-1">
                          {ACTIVITY_FILTERS.map((filter) => (
                            <button key={filter.key} type="button" onClick={() => setActivityFilter(filter.key)}
                              className={`!min-h-0 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                                activityFilter === filter.key ? filter.on : "border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50"}`}>
                              {filter.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* One stack per activity type. Only one is open at a
                          time: this panel sits inside a day cell, and four
                          expanded lists is the wall of text it replaced. */}
                      {activityGroups.map((group) => {
                        const open = openStack === group.key;
                        const shown = group.rows.slice(0, activityShowAll === group.key ? group.rows.length : ACTIVITY_PREVIEW);
                        const hidden = group.rows.length - shown.length;
                        return (
                          <div key={group.key} className={`overflow-hidden rounded-xl border ${open ? group.openBorder : "border-slate-200/80"} bg-white dark:border-slate-700 dark:bg-slate-900`}>
                            <button type="button" onClick={() => (open ? setOpenStack("") : openActivityStack(group.key))}
                              className={`!min-h-0 flex w-full items-center gap-2 px-2.5 py-2 text-left transition-colors ${open ? group.openHead : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}>
                              <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${group.iconTone}`}>{group.icon}</span>
                              <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-baseline gap-1.5">
                                  <span className="text-[12px] font-black text-slate-900 dark:text-slate-100">{group.label}</span>
                                  <span className="text-[11px] font-black tabular-nums text-slate-400">{group.orders}</span>
                                  {/* Touches only get their own number when a
                                      customer was contacted more than once, so
                                      the extra work is visible without the
                                      headline drifting from the cards above. */}
                                  {group.all.length > group.orders && (
                                    <span className="text-[10px] font-bold text-slate-400">{group.all.length} touches</span>
                                  )}
                                  {group.rows.length !== group.all.length && (
                                    <span className="text-[10px] font-bold text-slate-400">{group.rows.length} shown</span>
                                  )}
                                </span>
                                <span className="block text-[10px] font-semibold text-slate-400">{group.hint}</span>
                              </span>
                              {/* The shape of the pile, readable while closed. */}
                              <span className="hidden flex-wrap items-center gap-1 sm:flex">
                                {group.summary.map((chip) => (
                                  <span key={chip.label} className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${chip.tone}`}>
                                    {chip.count} {chip.label}
                                  </span>
                                ))}
                              </span>
                              <span className="shrink-0 text-slate-400">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                            </button>

                            {open && (group.rows.length === 0 ? (
                              <p className="m-0 border-t border-slate-100 px-2.5 py-4 text-center text-[11px] font-semibold text-slate-400 dark:border-slate-700">
                                Nothing here matches that search or filter.
                              </p>
                            ) : (
                              <>
                                <ul className="m-0 list-none border-t border-slate-100 p-0 dark:border-slate-700">
                                  {shown.map((row) => (
                                    <li key={row.key} className="flex items-start gap-2.5 border-b border-slate-50 px-2.5 py-2 last:border-b-0 dark:border-slate-800">
                                      <span className="min-w-0 flex-1">
                                        <span className="block text-[12px] font-black text-slate-900 dark:text-slate-100">
                                          <span className="text-[#1F8FE0]">#{row.orderId}</span> {row.customer}
                                          {row.repeats > 1 && (
                                            <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-black text-amber-800"
                                              title="Identical saves collapsed - the same log was submitted more than once">
                                              ×{row.repeats} duplicate
                                            </span>
                                          )}
                                        </span>
                                        {row.detail && (
                                          <span className="mt-0.5 block text-[11px] font-medium leading-snug text-slate-600 dark:text-slate-300">{row.detail}</span>
                                        )}
                                      </span>
                                      {/* ⚠️ A CHIP, never the stored value. This
                                          list used to print reach_status
                                          straight out of the database, so a
                                          supervisor's page read "not_reachable". */}
                                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${row.chip.tone}`}>{row.chip.label}</span>
                                      <span className="w-14 shrink-0 text-right text-[10px] font-bold tabular-nums text-slate-400">{row.at ? clock(row.at) : ""}</span>
                                      {row.phone ? (
                                        <a href={`tel:${row.phone}`} title={`Call ${row.customer}`}
                                          className="!min-h-0 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-[#1F8FE0] transition-colors hover:bg-blue-50">
                                          <Phone className="h-3 w-3" />
                                        </a>
                                      ) : <span className="w-6 shrink-0" />}
                                    </li>
                                  ))}
                                </ul>
                                {hidden > 0 ? (
                                  <button type="button" onClick={() => setActivityShowAll(group.key)}
                                    className="!min-h-0 flex w-full items-center justify-center gap-1 border-t border-slate-100 px-2.5 py-2 text-[11px] font-bold text-[#1F8FE0] transition-colors hover:bg-blue-50/60 dark:border-slate-700">
                                    View all {group.rows.length} {group.noun} <ChevronDown className="h-3.5 w-3.5" />
                                  </button>
                                ) : group.rows.length > ACTIVITY_PREVIEW ? (
                                  <button type="button" onClick={() => setActivityShowAll("")}
                                    className="!min-h-0 flex w-full items-center justify-center gap-1 border-t border-slate-100 px-2.5 py-2 text-[11px] font-bold text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700">
                                    Show less <ChevronUp className="h-3.5 w-3.5" />
                                  </button>
                                ) : null}
                              </>
                            ))}
                          </div>
                        );
                      })}

                      <p className="m-0 flex items-start gap-1.5 rounded-xl bg-sky-50/80 px-2.5 py-2 text-[11px] font-semibold text-slate-500 dark:bg-slate-800/60">
                        <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" />
                        Work Follow-ups first - those customers are waiting on this rep today. Retention touches and claims can follow.
                      </p>
                    </div>
                  )}
                </div>
              )}
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
