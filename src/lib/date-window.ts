// A sliding date window: a RANGE that can be moved through time, a SIZE that
// says how wide it is, and a LABEL derived from both.
//
// ⚠️ These are three separate things and must never be collapsed into one.
// A preset ("Last Week") produces a range; the range is the source of truth;
// the label is computed back FROM the range. Storing the preset as the truth is
// what makes a shifted window keep calling itself "Last Week" when it is no
// longer last week - which is a date control that lies to the person reading it.

export type DateWindow = { start: string; end: string };

const DAY_MS = 86_400_000;
const key = (date: Date) => date.toISOString().slice(0, 10);
const parse = (value: string) => new Date(`${value}T00:00:00Z`);
const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

export function shiftDay(dateKey: string, days: number): string {
  if (!valid(dateKey)) return dateKey;
  const date = parse(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return key(date);
}

/** Inclusive width. Aug 16–Aug 22 is 7 days, not 6. */
export function windowSize(window: DateWindow): number {
  if (!valid(window.start) || !valid(window.end)) return 0;
  return Math.round((parse(window.end).getTime() - parse(window.start).getTime()) / DAY_MS) + 1;
}

/** Move the whole window, keeping its width. The arrows' entire job. */
export function shiftWindow(window: DateWindow, days: number): DateWindow {
  return { start: shiftDay(window.start, days), end: shiftDay(window.end, days) };
}

/**
 * Change the width, keeping the END fixed.
 *
 * Anchoring on the end rather than the start is deliberate: narrowing from a
 * week to three days should land on the three most RECENT days, which is what
 * someone narrowing their view is looking for. Anchoring on the start would
 * walk them backwards in time for no reason they asked for.
 */
export function resizeWindow(window: DateWindow, days: number): DateWindow {
  const size = Math.max(1, Math.round(days));
  return { start: shiftDay(window.end, -(size - 1)), end: window.end };
}

// ── Presets ───────────────────────────────────────────────

export type PresetKey =
  | "today" | "yesterday" | "last7" | "last14" | "last30"
  | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";

export const PRESET_LABEL: Record<PresetKey, string> = {
  today: "Today", yesterday: "Yesterday",
  last7: "Last 7 Days", last14: "Last 14 Days", last30: "Last 30 Days",
  thisWeek: "This Week", lastWeek: "Last Week",
  thisMonth: "This Month", lastMonth: "Last Month"
};

/** Quick-range order, as it appears in the picker. */
export const PRESET_ORDER: PresetKey[] = [
  "today", "yesterday", "last7", "last14", "last30",
  "thisWeek", "lastWeek", "thisMonth", "lastMonth"
];

/** Sunday-anchored, matching every other week in this app. */
export function weekStart(dateKey: string): string {
  const date = parse(dateKey);
  return shiftDay(dateKey, -date.getUTCDay());
}

export function presetRange(preset: PresetKey, todayKey: string): DateWindow {
  switch (preset) {
    case "today": return { start: todayKey, end: todayKey };
    case "yesterday": return { start: shiftDay(todayKey, -1), end: shiftDay(todayKey, -1) };
    // ⚠️ "Last 7 Days" INCLUDES today, so it is today minus six - not minus
    // seven, which would be eight days once both ends are counted.
    case "last7": return { start: shiftDay(todayKey, -6), end: todayKey };
    case "last14": return { start: shiftDay(todayKey, -13), end: todayKey };
    case "last30": return { start: shiftDay(todayKey, -29), end: todayKey };
    case "thisWeek": {
      const start = weekStart(todayKey);
      return { start, end: shiftDay(start, 6) };
    }
    case "lastWeek": {
      const start = shiftDay(weekStart(todayKey), -7);
      return { start, end: shiftDay(start, 6) };
    }
    case "thisMonth": {
      const start = `${todayKey.slice(0, 7)}-01`;
      const date = parse(start);
      const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
      return { start, end: key(end) };
    }
    case "lastMonth":
    default: {
      const first = parse(`${todayKey.slice(0, 7)}-01`);
      const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 0));
      return { start: `${key(end).slice(0, 7)}-01`, end: key(end) };
    }
  }
}

/** Which preset, if any, this exact range corresponds to today. */
export function matchPreset(window: DateWindow, todayKey: string): PresetKey | null {
  return PRESET_ORDER.find((preset) => {
    const range = presetRange(preset, todayKey);
    return range.start === window.start && range.end === window.end;
  }) ?? null;
}

/**
 * What to call the current window.
 *
 * ⚠️ A window nudged off a preset must STOP using that preset's name. Calling
 * Aug 17–23 "Last Week" is worse than calling it nothing: the reader trusts the
 * label over the dates and draws the wrong conclusion.
 */
export function windowLabel(window: DateWindow, todayKey: string): string {
  const preset = matchPreset(window, todayKey);
  if (preset) return PRESET_LABEL[preset];
  const size = windowSize(window);
  if (size <= 0) return "Custom range";
  return size === 1 ? "Custom 1 Day" : `Custom ${size} Days`;
}

// ── Window sizes ──────────────────────────────────────────

export const WINDOW_SIZES: Array<{ days: number; label: string }> = [
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" }
];

/** "1 week" rather than "7 days" where a named size exists. */
export function windowSizeLabel(days: number): string {
  return WINDOW_SIZES.find((size) => size.days === days)?.label
    ?? (days === 1 ? "1 day" : `${days} days`);
}

/** Human range text for the toolbar. */
export function formatWindow(window: DateWindow): string {
  if (!valid(window.start) || !valid(window.end)) return "—";
  const fmt = (value: string) => parse(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
  return window.start === window.end ? fmt(window.start) : `${fmt(window.start)} – ${fmt(window.end)}`;
}

/** True when a day falls inside the window, inclusive at both ends. */
export function windowContains(window: DateWindow, dateKey: string): boolean {
  if (!valid(dateKey)) return false;
  return dateKey >= window.start && dateKey <= window.end;
}

/** Start after end is a user typo, not a crash. Swap rather than reject. */
export function normaliseWindow(window: DateWindow): DateWindow {
  if (!valid(window.start) || !valid(window.end)) return window;
  return window.start <= window.end ? window : { start: window.end, end: window.start };
}
