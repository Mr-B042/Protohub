// ── How an item and its count are written (Bright, 14 Oct 2026) ─────────────
// "1 pc of 8pc of kitchen knife Set" read wrongly: the unit word was borrowed
// from the main package, so a gift that is itself a set got "pc" in front.
//   1. The product's own unit word, when set:    "1 set of Kitchen Knives"
//   2. A name that already says what it is (set, kit, pack, pair, bundle,
//      combo, box, "8pc"): no unit word.    "8pc Kitchen Knife Set",
//                                                "2 × 8pc Kitchen Knife Set"
//   3. Otherwise, as before:                     "1 pc of Toothpaste Dispenser"
// Mirrored in src/lib and backend/src/lib - keep the two the same.

const SELF_DESCRIBING = [
  /\b(sets?|kits?|packs?|pairs?|bundles?|combos?|boxes?|dozens?)\b/i,
  /\b\d+\s*-?\s*(pc|pcs|piece|pieces)\b/i
  // Not "3-in-1": that says how many jobs one tool does ("2-in-1 Window
  // Groove" is one tool, so "4 pcs of 2-in-1 Window Groove" is right).
];

/** True when the name already says what one of it is ("8pc Knife Set", "3-In-1 Brush"). */
export const nameSaysWhatItIs = (name: string) => SELF_DESCRIBING.some((pattern) => pattern.test(name));

export type ItemUnit = { unitSingular?: string | null; unitPlural?: string | null } | null | undefined;

/**
 * "1 set of X", "8pc Kitchen Knife Set", "2 × 8pc Kitchen Knife Set" or
 * "1 pc of X". `fallback` is the unit word used when the product has none and
 * its name does not describe itself (the main package's word, else pc / pcs).
 */
export function itemCountLabel(quantity: number, name: string, unit?: ItemUnit, fallback?: { singular?: string | null; plural?: string | null }) {
  const qty = Math.max(1, Math.round(Number(quantity) || 1));
  const cleanName = String(name ?? "").trim() || "Item";
  const ownSingular = String(unit?.unitSingular ?? "").trim();
  const ownPlural = String(unit?.unitPlural ?? "").trim();
  if (ownSingular || ownPlural) {
    const word = qty === 1 ? (ownSingular || ownPlural) : (ownPlural || `${ownSingular}s`);
    return `${qty} ${word} of ${cleanName}`;
  }
  if (nameSaysWhatItIs(cleanName)) return qty === 1 ? cleanName : `${qty} × ${cleanName}`;
  const singular = String(fallback?.singular ?? "").trim() || "pc";
  const plural = String(fallback?.plural ?? "").trim() || "pcs";
  return `${qty} ${qty === 1 ? singular : plural} of ${cleanName}`;
}
