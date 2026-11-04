// Fine appeals: the pure parts (Bright, 4 Nov 2026). Route: routes/fine-appeals.ts.

export type AppealStatus = "open" | "awaiting_owner" | "kept" | "cancelled";
export const HELD: AppealStatus[] = ["open", "awaiting_owner"];

/** A rep can appeal until the week's report is with the Owner. */
export function canStillAppeal(companyStatus: string | null | undefined): boolean {
  return !companyStatus || companyStatus === "open" || companyStatus === "returned_to_manager";
}

/**
 * Cancelling: the Manager/Admin decides, except a fine the Owner charged -
 * cancelling that goes to the Owner. Keeping is always theirs to decide.
 */
export function cancelOutcome(chargedByOwner: boolean, deciderIsOwner: boolean): "cancelled" | "awaiting_owner" {
  return chargedByOwner && !deciderIsOwner ? "awaiting_owner" : "cancelled";
}

type Totals = Record<string, any>;
type Fine = { id: string; label: string; amount: number; date: string };

/**
 * A sent report's figures with one fine taken out (appeal opened) or put
 * back (appeal lost). Same sums as buildRepWeeklySnapshot: final = earned +
 * corrections - fines - carried fines, never below 0; what is left over
 * carries to next week.
 */
export function snapshotWithFine(snapshot: any, fine: Fine, include: boolean): any {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.totals) return snapshot;
  const fines: Fine[] = Array.isArray(snapshot.fines) ? snapshot.fines : [];
  const has = fines.some((item) => item.id === fine.id);
  if (include === has) return snapshot;
  const nextFines = include ? [...fines, fine] : fines.filter((item) => item.id !== fine.id);
  const t: Totals = snapshot.totals;
  const earned = Math.round(Number(t.baseBonus ?? 0) + Number(t.upsellBonus ?? 0) + Number(t.crossSellBonus ?? 0) + Number(t.deliveryBonus ?? 0));
  const adjustments = Math.round(Number(t.adjustments ?? 0));
  const carried = Math.round(Number(t.carriedFines ?? 0));
  const fineTotal = Math.max(0, Math.round(Number(t.fines ?? 0) + (include ? fine.amount : -fine.amount)));
  return {
    ...snapshot,
    fines: nextFines,
    totals: {
      ...t,
      fines: fineTotal,
      finalBonus: Math.max(0, earned + adjustments - fineTotal - carried),
      unpaidFines: Math.max(0, fineTotal + carried - earned - adjustments)
    }
  };
}
