import { normalizeState } from "./agent-coverage.js";

// The 36 states plus the Federal Capital Territory, spelled the one way the
// app shows them (src/lib/nigeria.ts NIGERIA_STATES).
export const NIGERIA_STATE_NAMES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe",
  "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara"
] as const;

const OFFICIAL_BY_KEY = new Map<string, string>(NIGERIA_STATE_NAMES.map((name) => [name.toLowerCase(), name]));
const EXTRA_SPELLINGS: Record<string, string> = { "cross rivers": "Cross River", "river": "Rivers" };

/**
 * Tidies the state an order is saved with (Bright, 2 Nov 2026): "lagos" ->
 * "Lagos", "FCt"/"Abuja" -> "FCT Abuja", "Rivers state" -> "Rivers". Uses the
 * same folding routing already matches on (normalizeState), so it never
 * changes where an order goes - only that one state is written one way, and
 * the Orders location filter and state reports stop splitting it. Anything it
 * cannot place is kept exactly as typed.
 */
export const tidyOrderState = <T extends string | null | undefined>(value: T): T | string => {
  if (typeof value !== "string") return value;
  const folded = normalizeState(value);
  if (!folded) return value.trim();
  const key = folded.toLowerCase().replace(/\s+/g, " ");
  return OFFICIAL_BY_KEY.get(key) ?? EXTRA_SPELLINGS[key] ?? folded;
};
