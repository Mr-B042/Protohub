// The 36 states plus the Federal Capital Territory.
//
// Shared rather than duplicated: the public agent-application form loads on its
// own, outside the dashboard bundle, so it cannot reach into App.tsx for this.
// Two copies would drift, and a state missing from one of them silently blocks
// whoever lives there.
export const NIGERIA_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
  "FCT Abuja"
] as const;

// ── Geopolitical zones ────────────────────────────────────────────────
// The six zones every Nigerian logistics conversation actually uses. Kept
// beside NIGERIA_STATES for the same reason: one copy, so a state cannot end
// up zoned differently on two screens.
//
// This is a grouping for humans planning shipments - "which neighbouring state
// already has this" - not a routing rule. Stock still routes strictly to the
// in-state hub that can fulfil the order; the zone only ever suggests where to
// look for a donor.
export const NIGERIA_ZONES = [
  "North-Central", "North-East", "North-West",
  "South-East", "South-South", "South-West"
] as const;
export type NigeriaZone = (typeof NIGERIA_ZONES)[number];

const ZONE_MEMBERS: Record<NigeriaZone, string[]> = {
  "North-Central": ["Benue", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "FCT Abuja"],
  "North-East": ["Adamawa", "Bauchi", "Borno", "Gombe", "Taraba", "Yobe"],
  "North-West": ["Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Sokoto", "Zamfara"],
  "South-East": ["Abia", "Anambra", "Ebonyi", "Enugu", "Imo"],
  "South-South": ["Akwa Ibom", "Bayelsa", "Cross River", "Delta", "Edo", "Rivers"],
  "South-West": ["Ekiti", "Lagos", "Ogun", "Ondo", "Osun", "Oyo"]
};

// ⚠️ Matched on the SAME normalisation the stock pages use, because the state a
// hub or an order carries is free text: "Rivers" and "Rivers State" are one
// place, and "Abuja"/"FCT"/"Federal Capital Territory" are another. Zoning off
// the raw string would drop those rows into "Unzoned" - the same label mismatch
// that once skipped stock deduction entirely.
const zoneKey = (value?: string) => {
  const key = String(value ?? "").trim().toLowerCase()
    .replace(/\bnigeria\b/g, "").replace(/\bstate\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return ["abuja", "fct", "fctabuja", "federalcapitalterritory"].includes(key) ? "fct" : key;
};

const ZONE_BY_STATE_KEY = new Map<string, NigeriaZone>(
  (Object.entries(ZONE_MEMBERS) as Array<[NigeriaZone, string[]]>)
    .flatMap(([zone, states]) => states.map((state) => [zoneKey(state), zone] as [string, NigeriaZone]))
);

/** The zone a state belongs to, or null when the state is unrecognised. */
export const zoneForState = (state?: string): NigeriaZone | null =>
  ZONE_BY_STATE_KEY.get(zoneKey(state)) ?? null;
