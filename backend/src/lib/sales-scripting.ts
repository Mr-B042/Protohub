// Sales Scripting rules (Bright, 1 Oct 2026). Pure, tested in
// sales-scripting.test.ts. The routes only load and save; every number the
// pages show is worked out here.

export type ScriptCategory = "closing" | "upsell" | "cross_sell" | "objection";
export const CORE_CATEGORIES: ScriptCategory[] = ["closing", "upsell", "cross_sell"];
export const CATEGORY_LABEL: Record<ScriptCategory, string> = {
  closing: "Closing", upsell: "Upselling", cross_sell: "Cross-selling", objection: "Objection Handling"
};

export type ScriptSettings = {
  /** Approved scripts each product should have per core category. */
  minPerCategory: number;
  /** Below this many uses in the period a script has "Insufficient data". */
  minUses: number;
  /** Delivered conversion vs the average of the same product + category. */
  highRatio: number;
  performingRatio: number;
  underRatio: number;
  /** A drop of this many percentage points vs the previous period = Needs review. */
  dropPoints: number;
  /** {{delivery_offer}}: the default, and per-product overrides. */
  deliveryOffer: string;
  productDeliveryOffers: Record<string, string>;
  /** Pre-filled on every new script. */
  defaultMustSay: string[];
  defaultNeverSay: string[];
};

export const DEFAULT_SCRIPT_SETTINGS: ScriptSettings = {
  minPerCategory: 5,
  minUses: 20,
  highRatio: 1.2,
  performingRatio: 0.8,
  underRatio: 0.5,
  dropPoints: 5,
  deliveryOffer: "",
  productDeliveryOffers: {},
  defaultMustSay: ["Correct price", "Payment on delivery", "Delivery timeframe", "Correct package quantity"],
  defaultNeverSay: ["Fake scarcity", "A discount that was not approved", "Anything the product cannot do", "A delivery date operations cannot meet"]
};

export function mergeSettings(raw: unknown): ScriptSettings {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<ScriptSettings>;
  const num = (input: unknown, fallback: number) => (typeof input === "number" && Number.isFinite(input) && input >= 0 ? input : fallback);
  const list = (input: unknown, fallback: string[]) => (Array.isArray(input) ? input.map(String).map((item) => item.trim()).filter(Boolean) : fallback);
  return {
    minPerCategory: Math.max(1, Math.round(num(value.minPerCategory, DEFAULT_SCRIPT_SETTINGS.minPerCategory))),
    minUses: Math.max(1, Math.round(num(value.minUses, DEFAULT_SCRIPT_SETTINGS.minUses))),
    highRatio: num(value.highRatio, DEFAULT_SCRIPT_SETTINGS.highRatio),
    performingRatio: num(value.performingRatio, DEFAULT_SCRIPT_SETTINGS.performingRatio),
    underRatio: num(value.underRatio, DEFAULT_SCRIPT_SETTINGS.underRatio),
    dropPoints: num(value.dropPoints, DEFAULT_SCRIPT_SETTINGS.dropPoints),
    deliveryOffer: typeof value.deliveryOffer === "string" ? value.deliveryOffer : "",
    productDeliveryOffers: value.productDeliveryOffers && typeof value.productDeliveryOffers === "object" ? value.productDeliveryOffers as Record<string, string> : {},
    defaultMustSay: list(value.defaultMustSay, DEFAULT_SCRIPT_SETTINGS.defaultMustSay),
    defaultNeverSay: list(value.defaultNeverSay, DEFAULT_SCRIPT_SETTINGS.defaultNeverSay)
  };
}

// ------------------------------------------------------------ price placeholders

/** Placeholders a script can use; the current offer is filled in when a rep reads it. */
export const SCRIPT_VARIABLES = [
  "product_name", "current_price", "upgrade_price", "extra_amount", "from_qty", "to_qty",
  "cross_sell_product", "cross_sell_price", "delivery_offer", "free_gifts"
] as const;

export function fillScriptText(text: string, vars: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const filled = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const key = name.toLowerCase();
    const value = vars[key];
    if (value === undefined || value === "") { missing.add(key); return whole; }
    return value;
  });
  return { text: filled, missing: Array.from(missing) };
}

/** Naira amounts typed into the text (₦39,500 / N39500 / 39,500 naira). */
export function priceMentions(text: string): number[] {
  const found: number[] = [];
  const toNumber = (raw: string) => Number(raw.replace(/,/g, ""));
  for (const match of text.matchAll(/(?:₦|\bNGN\s?|\bN(?=\d))\s?(\d{1,3}(?:,\d{3})+|\d{3,})/gi)) found.push(toNumber(match[1]));
  for (const match of text.matchAll(/\b(\d{1,3}(?:,\d{3})+|\d{4,})\s?naira\b/gi)) found.push(toNumber(match[1]));
  return Array.from(new Set(found.filter((value) => Number.isFinite(value) && value >= 100)));
}

/** Typed prices that are not any current price of the product (or its pairings). */
export function outdatedPrices(text: string, currentPrices: number[]): number[] {
  const valid = new Set(currentPrices.map((value) => Math.round(value)));
  return priceMentions(text).filter((value) => !valid.has(Math.round(value)));
}

// ------------------------------------------------------- near-duplicate scripts

const words = (text: string) => new Set(text.toLowerCase().replace(/\{\{[^}]*\}\}/g, " ").split(/[^a-z0-9]+/).filter((word) => word.length > 2));

export function textSimilarity(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * Five copies of "buy two and save" are one script, not five. Same purpose,
 * or wording that is mostly the same, is flagged so each script has its own
 * situation.
 */
export function nearDuplicates<T extends { id: string; title: string; scenario: string; whatToSay: string }>(
  candidate: { id?: string; scenario: string; whatToSay: string },
  others: T[],
  threshold = 0.6
): Array<{ id: string; title: string; reason: "same_purpose" | "same_wording" }> {
  const scenario = candidate.scenario.trim().toLowerCase();
  const out: Array<{ id: string; title: string; reason: "same_purpose" | "same_wording" }> = [];
  for (const other of others) {
    if (other.id === candidate.id) continue;
    if (scenario && other.scenario.trim().toLowerCase() === scenario) out.push({ id: other.id, title: other.title, reason: "same_purpose" });
    else if (textSimilarity(candidate.whatToSay, other.whatToSay) >= threshold) out.push({ id: other.id, title: other.title, reason: "same_wording" });
  }
  return out;
}

// ------------------------------------------------------------ playbook readiness

export function playbookReadiness(liveCounts: Partial<Record<ScriptCategory, number>>, minPerCategory: number) {
  const min = Math.max(1, minPerCategory);
  const categories = Object.fromEntries((["closing", "upsell", "cross_sell", "objection"] as ScriptCategory[]).map((category) => {
    const count = Math.max(0, liveCounts[category] ?? 0);
    return [category, { count, min: category === "objection" ? 0 : min, ok: category === "objection" ? true : count >= min }];
  })) as Record<ScriptCategory, { count: number; min: number; ok: boolean }>;
  const percent = Math.round(CORE_CATEGORIES.reduce((sum, category) => sum + Math.min(categories[category].count, min) / min, 0) / CORE_CATEGORIES.length * 100);
  return { categories, percent };
}

// ------------------------------------------------------------------- the funnel

export type UseFact = {
  repId: string;
  outcome: "accepted" | "declined";
  delivered: boolean;
  /** Extra revenue this script brought on the order (0 for closing / objection). */
  incrementalRevenue: number;
};

export function funnelOf(uses: UseFact[], views = 0) {
  const used = uses.length;
  const accepted = uses.filter((use) => use.outcome === "accepted").length;
  const delivered = uses.filter((use) => use.outcome === "accepted" && use.delivered).length;
  const incrementalRevenue = uses.filter((use) => use.outcome === "accepted" && use.delivered).reduce((sum, use) => sum + Math.max(0, use.incrementalRevenue), 0);
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
  return { shown: views, used, accepted, delivered, acceptanceRate: pct(accepted, used), deliveredConversion: pct(delivered, used), incrementalRevenue };
}

// --------------------------------------------------------------------- health

export type ScriptHealth = "high" | "performing" | "needs_review" | "underperforming" | "insufficient";
export const HEALTH_LABEL: Record<ScriptHealth, string> = {
  high: "High Performing", performing: "Performing", needs_review: "Needs Review", underperforming: "Underperforming", insufficient: "Insufficient Data"
};

/**
 * Set by the numbers, never by hand. Compared with the average of the same
 * product + category, and with this script's own previous period.
 */
export function scriptHealth(input: {
  uses: number;
  deliveredConversion: number;
  previousUses: number;
  previousDeliveredConversion: number;
  categoryAverage: number;
  outdatedPrice: boolean;
}, settings: Pick<ScriptSettings, "minUses" | "highRatio" | "performingRatio" | "underRatio" | "dropPoints">): { health: ScriptHealth; reason: string } {
  if (input.outdatedPrice) return { health: "needs_review", reason: "The script mentions a price that is not a current price." };
  if (input.uses < settings.minUses) return { health: "insufficient", reason: `Used ${input.uses} time${input.uses === 1 ? "" : "s"}; needs ${settings.minUses} to judge.` };
  const drop = input.previousUses >= settings.minUses ? input.previousDeliveredConversion - input.deliveredConversion : 0;
  if (drop >= settings.dropPoints) {
    return { health: "needs_review", reason: `Delivered conversion ${input.deliveredConversion}%, down ${Math.round(drop * 10) / 10} points on the previous period.` };
  }
  if (input.categoryAverage <= 0) {
    return input.deliveredConversion > 0
      ? { health: "performing", reason: `Delivered conversion ${input.deliveredConversion}%.` }
      : { health: "underperforming", reason: "No delivered sale from this script yet." };
  }
  const ratio = input.deliveredConversion / input.categoryAverage;
  const versus = `${input.deliveredConversion}% vs ${input.categoryAverage}% for similar scripts`;
  if (ratio >= settings.highRatio) return { health: "high", reason: versus };
  if (ratio >= settings.performingRatio) return { health: "performing", reason: versus };
  if (ratio >= settings.underRatio) return { health: "needs_review", reason: versus };
  return { health: "underperforming", reason: versus };
}

/**
 * Bright's distinction: if everyone does badly with a script, the script may
 * be weak; if everyone does well except one rep, that rep may need coaching.
 */
export function repDiagnosis(reps: Array<{ repName: string; used: number; deliveredConversion: number }>, categoryAverage: number, minRepUses = 5): string | null {
  const judged = reps.filter((rep) => rep.used >= minRepUses);
  if (judged.length < 2 || categoryAverage <= 0) return null;
  const low = judged.filter((rep) => rep.deliveredConversion < categoryAverage * 0.8);
  if (low.length === judged.length) return "Every rep does worse with this script than with similar scripts. The script itself may be weak.";
  if (low.length === 1 && judged.length >= 3) return `Most reps do well with this script. ${low[0].repName} may need coaching on it.`;
  if (low.length === 0) return "Every rep does at least as well with this script as with similar scripts.";
  return `${low.map((rep) => rep.repName).join(", ")} do worse with this script than the others.`;
}
