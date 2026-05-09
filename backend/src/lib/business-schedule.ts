const WORKING_DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export type WorkingDayName = (typeof WORKING_DAY_ORDER)[number];

export const DEFAULT_WORKING_DAYS: WorkingDayName[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

export type WorkingSchedule = {
  working_schedule_enabled?: boolean | null;
  working_days?: string[] | null;
  working_day_start?: string | null;
  working_day_end?: string | null;
  timezone?: string | null;
};

const DEFAULT_WORKING_START = "08:00";
const DEFAULT_WORKING_END = "18:00";
const DEFAULT_TIMEZONE = "Africa/Lagos";

export function normalizeWorkingDays(value: unknown): WorkingDayName[] {
  if (!Array.isArray(value)) return [...DEFAULT_WORKING_DAYS];
  const normalized = WORKING_DAY_ORDER.filter((day) => value.includes(day));
  return normalized.length ? normalized : [...DEFAULT_WORKING_DAYS];
}

function parseClockMinutes(value: string | null | undefined, fallback: number) {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return fallback;
  }
  return hour * 60 + minute;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: WorkingDayName;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long"
  }).formatToParts(date);

  const getNumber = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const weekday = (parts.find((part) => part.type === "weekday")?.value ?? "Monday") as WorkingDayName;

  return {
    year: getNumber("year"),
    month: getNumber("month"),
    day: getNumber("day"),
    hour: getNumber("hour"),
    minute: getNumber("minute"),
    weekday
  };
}

function toDateKey(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function shiftDateKey(dateKey: string, offsetDays: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return toDateKey(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

function utcFromLocalDateTime(dateKey: string, time: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute));

  for (let index = 0; index < 5; index += 1) {
    const parts = getZonedParts(guess, timeZone);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
    const actualUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const diff = desiredUtc - actualUtc;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

function normalizedSchedule(schedule: WorkingSchedule) {
  const timeZone = schedule.timezone?.trim() || DEFAULT_TIMEZONE;
  const parsedStart = parseClockMinutes(schedule.working_day_start ?? DEFAULT_WORKING_START, 8 * 60);
  const parsedEnd = parseClockMinutes(schedule.working_day_end ?? DEFAULT_WORKING_END, 18 * 60);
  const sameDayHours = parsedStart < parsedEnd;
  const start = sameDayHours ? parsedStart : 8 * 60;
  const end = sameDayHours ? parsedEnd : 18 * 60;

  return {
    enabled: !!schedule.working_schedule_enabled,
    workingDays: normalizeWorkingDays(schedule.working_days),
    start,
    end,
    sameDayHours,
    timeZone
  };
}

export function isWithinWorkingSchedule(schedule: WorkingSchedule, at = new Date()) {
  const normalized = normalizedSchedule(schedule);
  if (!normalized.enabled) return true;

  const parts = getZonedParts(at, normalized.timeZone);
  if (!normalized.workingDays.includes(parts.weekday)) return false;

  if (!normalized.sameDayHours) {
    return true;
  }

  const nowMinutes = parts.hour * 60 + parts.minute;
  return nowMinutes >= normalized.start && nowMinutes < normalized.end;
}

export function nextWorkingScheduleAt(schedule: WorkingSchedule, from = new Date()) {
  const normalized = normalizedSchedule(schedule);
  if (!normalized.enabled) return null;

  const parts = getZonedParts(from, normalized.timeZone);
  const localDateKey = toDateKey(parts.year, parts.month, parts.day);
  const nowMinutes = parts.hour * 60 + parts.minute;
  const startTime = `${String(Math.floor(normalized.start / 60)).padStart(2, "0")}:${String(normalized.start % 60).padStart(2, "0")}`;

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const candidateDateKey = shiftDateKey(localDateKey, dayOffset);
    const weekdayProbe = utcFromLocalDateTime(candidateDateKey, "12:00", normalized.timeZone);
    const weekday = getZonedParts(weekdayProbe, normalized.timeZone).weekday;
    if (!normalized.workingDays.includes(weekday)) continue;

    if (!normalized.sameDayHours) {
      const midnightProbe = utcFromLocalDateTime(candidateDateKey, "00:00", normalized.timeZone);
      if (dayOffset > 0 || !isWithinWorkingSchedule(schedule, from)) {
        return midnightProbe.toISOString();
      }
      return new Date(from.getTime() + 60 * 1000).toISOString();
    }

    if (dayOffset === 0) {
      if (nowMinutes < normalized.start) {
        return utcFromLocalDateTime(candidateDateKey, startTime, normalized.timeZone).toISOString();
      }
      if (nowMinutes >= normalized.start && nowMinutes < normalized.end) {
        return new Date(from.getTime() + 60 * 1000).toISOString();
      }
      continue;
    }

    return utcFromLocalDateTime(candidateDateKey, startTime, normalized.timeZone).toISOString();
  }

  return new Date(from.getTime() + 24 * 60 * 60 * 1000).toISOString();
}
