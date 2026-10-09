import { supabase } from "./supabase.js";
import { addDaysToDateKey, sundayWeekStartForDateKey } from "./sales-bonus-engine.js";

// Waybill costs counted once (Bright, 9 Oct 2026).
//
// The team types each product's COMBINED weekly waybill total on the Expenses
// page ("COST OF WAYBILL INCURRED ON RACK", ₦45,000). The manager may have
// paid part of it (₦8,000) from her wallet during the week. The total is the
// cost; the wallet payment is how part of it was paid. So:
//   * a wallet "Waybill" payment is always booked as a cost (if nobody ever
//     types the total, nothing is lost);
//   * a typed "Waybill" total books only what the wallet has not already paid
//     that week: declared_total − wallet payments (₦45,000 − ₦8,000 = ₦37,000).
// Order does not matter: the week is recomputed whenever either side changes.
// A typed total with a product absorbs that product's wallet payments first;
// one with no product (most typed totals so far) absorbs whatever is left.

// From the week of 27 Sep (Bright, 9 Oct 2026): that week's Rack/Shelf totals were
// typed on 3 Oct and its wallet waybills were still being logged after the fix.
export const WAYBILL_ONCE_FROM = "2026-09-27";
const NOTE = " · [";

export type TypedTotal = { id: string; declared: number; productId: string | null };
export type WalletPayment = { id: string; amount: number; productId: string | null };

export function allocateWaybillWeek(typed: TypedTotal[], wallet: WalletPayment[]) {
  const left = new Map<string, number>(); // product key -> wallet money not yet absorbed
  const key = (productId: string | null) => productId ?? "";
  for (const pay of wallet) left.set(key(pay.productId), (left.get(key(pay.productId)) ?? 0) + pay.amount);
  const absorbed = new Map<string, number>();
  const take = (row: TypedTotal, from: string) => {
    const room = row.declared - (absorbed.get(row.id) ?? 0);
    const available = left.get(from) ?? 0;
    const used = Math.max(0, Math.min(room, available));
    if (used > 0) { absorbed.set(row.id, (absorbed.get(row.id) ?? 0) + used); left.set(from, available - used); }
  };
  const byDeclared = [...typed].sort((a, b) => b.declared - a.declared);
  // 1. Totals for a product take that product's wallet payments.
  for (const row of byDeclared.filter((item) => item.productId)) take(row, key(row.productId));
  // 2. Totals with no product take whatever wallet money is still left, any product.
  for (const row of byDeclared.filter((item) => !item.productId)) for (const from of Array.from(left.keys())) take(row, from);
  const booked = new Map(typed.map((row) => [row.id, Math.max(0, Math.round((row.declared - (absorbed.get(row.id) ?? 0)) * 100) / 100)]));
  const unmatchedWallet = Array.from(left.values()).reduce((sum, value) => sum + value, 0);
  return { booked, absorbed, unmatchedWallet };
}

const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
const baseText = (description: string | null) => String(description ?? "").split(NOTE)[0];

async function weekRows(orgId: string, branchId: string, weekStart: string) {
  const weekEnd = addDaysToDateKey(weekStart, 6);
  const { data, error } = await supabase.from("expenses").select("id, amount, declared_total, product_id, description, waybill_id")
    .eq("org_id", orgId).eq("branch_id", branchId).eq("category", "Waybill").gte("date", weekStart).lte("date", weekEnd);
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const wallet = rows.filter((row) => String(row.id).startsWith("MGRF-"));
  // Typed totals: not a wallet entry, not the waybill page's own per-waybill row.
  const typed = rows.filter((row) => !String(row.id).startsWith("MGRF-") && !String(row.id).startsWith("EXP-WB-") && !row.waybill_id);
  return { wallet, typed };
}

/** Recompute one branch-week: each typed total books only what the wallet has not paid. */
export async function recomputeWaybillWeek(orgId: string, branchId: string | null, dateInWeek: string) {
  if (!branchId) return null;
  const weekStart = sundayWeekStartForDateKey(dateInWeek);
  if (addDaysToDateKey(weekStart, 6) < WAYBILL_ONCE_FROM) return null;
  const { wallet, typed } = await weekRows(orgId, branchId, weekStart);
  const totals: TypedTotal[] = typed.map((row) => ({ id: String(row.id), declared: Number(row.declared_total ?? row.amount) || 0, productId: row.product_id ?? null }));
  const payments: WalletPayment[] = wallet.map((row) => ({ id: String(row.id), amount: Number(row.amount) || 0, productId: row.product_id ?? null }));
  const result = allocateWaybillWeek(totals, payments);
  for (const row of typed) {
    const declared = Number(row.declared_total ?? row.amount) || 0;
    const used = result.absorbed.get(String(row.id)) ?? 0;
    const description = `${baseText(row.description)}${used > 0 ? `${NOTE}total ${naira(declared)}; ${naira(used)} already paid from the manager's wallet]` : ""}`.slice(0, 500);
    const amount = result.booked.get(String(row.id)) ?? declared;
    if (Number(row.amount) === amount && Number(row.declared_total) === declared && row.description === description) continue;
    const { error } = await supabase.from("expenses").update({ amount, declared_total: declared, description }).eq("id", row.id).eq("org_id", orgId);
    if (error) throw error;
  }
  return { weekStart, typedTotal: totals.reduce((sum, row) => sum + row.declared, 0), walletPaid: payments.reduce((sum, row) => sum + row.amount, 0), unmatchedWallet: result.unmatchedWallet };
}

/** What the wallet has already paid toward a week's waybills (for the Expenses form and the wallet form). */
export async function waybillWeekPosition(orgId: string, branchId: string, dateInWeek: string, productId: string | null) {
  const weekStart = sundayWeekStartForDateKey(dateInWeek);
  const { wallet, typed } = await weekRows(orgId, branchId, weekStart);
  const forProduct = (row: any) => !productId || !row.product_id || row.product_id === productId;
  return {
    weekStart, weekEnd: addDaysToDateKey(weekStart, 6), active: addDaysToDateKey(weekStart, 6) >= WAYBILL_ONCE_FROM,
    walletPayments: wallet.filter(forProduct).map((row) => ({ id: row.id, amount: Number(row.amount) || 0, productId: row.product_id ?? null, description: baseText(row.description) })),
    typedTotals: typed.filter(forProduct).map((row) => ({ id: row.id, declared: Number(row.declared_total ?? row.amount) || 0, booked: Number(row.amount) || 0, productId: row.product_id ?? null, description: baseText(row.description) }))
  };
}
