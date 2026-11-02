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

// ── Working out a state from messy address text ───────────────────────
// ⚠️ ONLY FOR ABANDONED CARTS, and only because they have no state box the
// customer had to fill in. Never use it to decide where an order is delivered.
// The one order use is canonicalOrderState below, which only GROUPS orders on
// screens (filters, reports) and falls back to this for an order saved with
// no state at all.
//
// Carts are captured mid-checkout, so the state is blank on most of them while
// the city box holds whatever the person typed: "Uyo,Akwa Ibom State",
// "GRA Enugu", "Ajah Lagos", "PH", "Asaba". Without this they all pile up as
// one unusable "no state" lump and their demand is invisible.
//
// Two steps, in order, and the caller is told which one answered so a guess is
// never mistaken for something the customer typed:
//   1. a real state name inside the text  - safe, it is the state's own name
//   2. a known city                       - a lookup, and it CAN be wrong
//
// The city list is deliberately short. It holds the places this business
// actually ships to, spelled the ways reps actually type them. A city is only
// in here when it belongs to one state beyond argument. Anywhere ambiguous is
// left out on purpose: an unknown state is a row somebody fixes, while a wrong
// state is stock on a lorry to the wrong end of the country.
const CITY_STATE: Record<string, string> = {
  // South-South
  "ph": "Rivers", "portharcourt": "Rivers", "porthacourt": "Rivers", "phc": "Rivers",
  "obiaakpor": "Rivers", "obioakpor": "Rivers", "rumuokoro": "Rivers", "eleme": "Rivers",
  "asaba": "Delta", "warri": "Delta", "ughelli": "Delta", "sapele": "Delta", "agbor": "Delta",
  "benin": "Edo", "benincity": "Edo", "ekpoma": "Edo", "auchi": "Edo",
  "uyo": "Akwa Ibom", "eket": "Akwa Ibom", "ikotekpene": "Akwa Ibom", "ibeno": "Akwa Ibom",
  "calabar": "Cross River", "ikom": "Cross River", "ogoja": "Cross River",
  "yenagoa": "Bayelsa",
  // South-East
  "onitsha": "Anambra", "nnewi": "Anambra", "awka": "Anambra", "ekwulobia": "Anambra", "oba": "Anambra",
  "owerri": "Imo", "orlu": "Imo", "okigwe": "Imo",
  "aba": "Abia", "umuahia": "Abia",
  "abakaliki": "Ebonyi",
  "nsukka": "Enugu",
  // South-West
  "ikeja": "Lagos", "lekki": "Lagos", "ajah": "Lagos", "ikorodu": "Lagos", "badagry": "Lagos",
  "surulere": "Lagos", "yaba": "Lagos", "ojota": "Lagos", "ikotun": "Lagos", "alimosho": "Lagos",
  "festac": "Lagos", "apapa": "Lagos", "epe": "Lagos", "mushin": "Lagos", "oshodi": "Lagos",
  "ibadan": "Oyo", "ogbomoso": "Oyo", "oyotown": "Oyo",
  "abeokuta": "Ogun", "sagamu": "Ogun", "ijebuode": "Ogun", "otta": "Ogun", "ota": "Ogun", "agbado": "Ogun",
  "akure": "Ondo", "ondotown": "Ondo", "owo": "Ondo",
  "osogbo": "Osun", "ileife": "Osun", "ife": "Osun", "ilesa": "Osun",
  "adoekiti": "Ekiti",
  // North-Central
  "makurdi": "Benue", "gboko": "Benue",
  "lokoja": "Kogi", "okene": "Kogi",
  "ilorin": "Kwara",
  "lafia": "Nasarawa", "karu": "Nasarawa",
  "minna": "Niger", "suleja": "Niger",
  "jos": "Plateau",
  "gwagwalada": "FCT Abuja", "kubwa": "FCT Abuja", "wuse": "FCT Abuja", "garki": "FCT Abuja",
  "maitama": "FCT Abuja", "nyanya": "FCT Abuja", "lugbe": "FCT Abuja",
  // North-West / North-East
  "kano": "Kano", "kaduna": "Kaduna", "zaria": "Kaduna", "katsina": "Katsina",
  "sokoto": "Sokoto", "gusau": "Zamfara", "birninkebbi": "Kebbi", "dutse": "Jigawa",
  "maiduguri": "Borno", "yola": "Adamawa", "bauchi": "Bauchi", "gombe": "Gombe",
  "jalingo": "Taraba", "damaturu": "Yobe"
};

const squash = (value?: string) => String(value ?? "").toLowerCase().replace(/[^a-z]+/g, "");

export type StateSource = "given" | "read-from-text" | "guessed-from-city" | "unknown";
export type ResolvedState = { state: string | null; source: StateSource };

/**
 * Best state for a cart, plus how sure we are.
 *
 * `given` is what the customer typed. `read-from-text` found the state's own
 * name inside the address. `guessed-from-city` used the lookup above and is the
 * only one that can be wrong - show it differently so somebody can catch it.
 */
export function resolveStateFromText(state?: string, city?: string): ResolvedState {
  if (zoneForState(state)) {
    const key = zoneKey(state);
    return { state: key === "fct" ? "FCT Abuja" : String(state).replace(/,?\s*Nigeria\s*$/i, "").trim(), source: "given" };
  }

  const haystack = `${state ?? ""} ${city ?? ""}`;
  // Longest names first, so "Akwa Ibom" wins before a stray "Ibom"-like match
  // and "Cross River" is never read as "Rivers".
  const byLength = [...NIGERIA_STATES].sort((a, b) => b.length - a.length);
  for (const name of byLength) {
    const pattern = new RegExp(`\\b${name.replace(/\s+/g, "\\s+").replace("FCT Abuja", "(?:fct|abuja)")}\\b`, "i");
    if (pattern.test(haystack)) return { state: name, source: "read-from-text" };
  }
  if (/\b(?:fct|abuja|federal\s+capital)\b/i.test(haystack)) return { state: "FCT Abuja", source: "read-from-text" };

  // ⚠️ SHORT NAMES ONLY COUNT WHEN THEY ARE THE WHOLE ADDRESS. Four letters or
  // fewer are far too easy to hit by accident once the text is split into
  // words: "Ph.D street" would read as PH -> Rivers, and "Aba Road" - which is
  // in Port Harcourt - would read as Aba -> Abia, sending stock to the wrong
  // end of the country. Written as a length rule rather than a hand-kept list
  // so a short name added later cannot slip past it.
  const wholeKey = squash(city);
  const wholeMatch = CITY_STATE[wholeKey];
  if (wholeMatch) return { state: wholeMatch, source: "guessed-from-city" };

  // Longer names are safe to find inside a longer address, but still only as
  // whole words - a substring match would read "Obani" as "Oba".
  for (const word of String(city ?? "").split(/[^A-Za-z]+/).filter(Boolean)) {
    const key = squash(word);
    if (key.length <= 4) continue;
    const found = CITY_STATE[key];
    if (found) return { state: found, source: "guessed-from-city" };
  }

  // Last try: a long, distinctive name sitting inside a full address, once the
  // spaces are stripped - "No 5 Aba Road, Port Harcourt" holds "portharcourt",
  // which no word-by-word pass can see because the name is two words.
  // Seven letters and up only. Shorter than that and a street name starts
  // swallowing a city by accident.
  for (const [key, found] of Object.entries(CITY_STATE)) {
    if (key.length >= 7 && wholeKey.includes(key)) return { state: found, source: "guessed-from-city" };
  }

  return { state: null, source: "unknown" };
}

// ── One name per state for orders (Bright, 2 Nov 2026) ─────────────────
// An order's state was free text for a while (Edit customer details, some
// website forms), so the same place is stored as "FCT", "FCt", "Abuja" and
// "FCT Abuja", or as a city ("Ibadan"). This gives the official name for the
// Orders location filter and state reports. It does NOT decide delivery:
// routing has its own matching (backend agent-coverage normalizeState).
//
//   1. the state's own name, any capitals / "State" / FCT spelling -> safe
//   2. a short list of spellings, cities and hub labels seen on real orders
//      and hubs ("Ibadan", "Asaba Delta", "Kastina")                  -> a lookup
//   3. no state saved at all: read the city box (cart rules above)
// When step 2 found a city/hub name but the city box names a real state, the
// city box wins: order 4508 said "Ibadan" (the hub that delivered it) with
// city "Ogun" and an Ijebu Ode address - the customer is in Ogun.
const ORDER_STATE_SPELLINGS: Record<string, string> = {
  crossrivers: "Cross River", river: "Rivers", kastina: "Katsina",
  asabadelta: "Delta", enugunsukka: "Enugu", ibadanoyo: "Oyo",
  edobenin: "Edo", edobenincity: "Edo", benin: "Edo", benincity: "Edo",
  ibadan: "Oyo", akure: "Ondo", uyo: "Akwa Ibom", osogbo: "Osun", nsukka: "Enugu",
  asaba: "Delta", warri: "Delta", ph: "Rivers", portharcourt: "Rivers", calabar: "Cross River",
  owerri: "Imo", onitsha: "Anambra", awka: "Anambra", abeokuta: "Ogun", ilorin: "Kwara",
  enugu: "Enugu", aba: "Abia", umuahia: "Abia", makurdi: "Benue", lokoja: "Kogi", jos: "Plateau",
  kaduna: "Kaduna", kano: "Kano", minna: "Niger", yenagoa: "Bayelsa", abakaliki: "Ebonyi", adoekiti: "Ekiti"
};
const OFFICIAL_STATE_BY_KEY = new Map<string, string>(NIGERIA_STATES.map((name) => [zoneKey(name), name]));

export function canonicalOrderState(state?: string | null, city?: string | null): string | null {
  const typed = String(state ?? "").split(",")[0];
  const official = OFFICIAL_STATE_BY_KEY.get(zoneKey(state ?? "")) ?? OFFICIAL_STATE_BY_KEY.get(zoneKey(typed));
  if (official) return official;
  if (!String(state ?? "").trim()) {
    // No state saved: trust the city box only when it names a state outright
    // ("Ogun State", "Abuja FCT") or the WHOLE box is one known city ("Ikeja").
    // A word picked out of a longer address can be wrong - "Agbado Oke Odo
    // LCDA" is in Lagos, but "Agbado" alone reads as Ogun.
    const fromCity = resolveStateFromText(undefined, city ?? undefined);
    if (fromCity.source === "read-from-text") return fromCity.state;
    return CITY_STATE[squash(city ?? "")] ?? null;
  }
  const looked = ORDER_STATE_SPELLINGS[zoneKey(state ?? "")] ?? ORDER_STATE_SPELLINGS[zoneKey(typed)];
  if (!looked) return null;
  const cityNames = byLengthStates().filter((name) =>
    new RegExp(`\\b${name.replace(/\s+/g, "\\s+").replace("FCT Abuja", "(?:fct|abuja)")}\\b`, "i").test(String(city ?? "")));
  if (cityNames.length > 0 && !cityNames.includes(looked)) return cityNames[0];
  return looked;
}

/** Same grouping key the stock pages use (zone key of the official name), so a hub labelled "Ibadan" counts as Oyo. */
export const canonicalStateGroupKey = (value?: string | null) => {
  const name = canonicalOrderState(value);
  return name ? zoneKey(name) : "";
};
const byLengthStates = (): string[] => [...NIGERIA_STATES].sort((a, b) => b.length - a.length);

/** Filter label for orders whose state could not be read at all (none saved, city unclear, or unknown text). */
export const UNPLACED_ORDER_STATE = "State not given";
