import { supabase } from "./supabase.js";
import { lagosDateKey } from "./sales-bonus-engine.js";
import { allocate, mappingIndex, type AdPlatform } from "./ad-spend.js";
import { loadAdSpendInputs } from "./ad-spend-data.js";

// Ad Tracking -> Daily Ad Spend filled from the ad platforms (Bright, 9 Oct
// 2026). The Meta (and, once connected, TikTok) spend the Tracking Hub reads
// is written into `expenses` as "Ad Spend", one row per platform, product and
// day - the same rows the hand-typed figures were, so P&L, Marketing
// Performance and every profit page count it with no change.
//
// ⚠️ FROM SUNDAY 4 OCT 2026 ONLY (Bright's choice). Nothing was typed that
// week; earlier weeks keep their typed figures, which may include TikTok.
// ⚠️ UNASSIGNED SPEND COUNTS (Bright's choice): spend with no product yet is
// written with no product ("Not assigned to a product") so totals are whole,
// and moves to the product as soon as it is assigned.
// ⚠️ ids "ads-auto-<platform>-..." are this file's; typed TikTok rows are
// "ads-tiktok-typed-...". The two never overwrite each other.

export const AUTO_AD_SPEND_FROM = "2026-10-04";
export const autoExpenseId = (platform: AdPlatform, branchId: string, productId: string | null, day: string) =>
  `ads-auto-${platform}-${branchId.slice(0, 8)}-${productId ?? "unassigned"}-${day}`;

/**
 * Rewrite the branch's automatic Ad Spend expense rows for the days given
 * (default: the whole period from 4 Oct, used when a product is assigned).
 * ⚠️ The 30-minute sync passes only the days it just read: rebuilding from
 * 4 Oct every half hour loaded weeks of orders each time and doubled the
 * server's memory (Railway bill, 9 Oct 2026).
 */
export async function syncAdSpendExpenses(orgId: string, branchId: string, window: { from?: string; to?: string } = {}) {
  const today = lagosDateKey();
  if (today < AUTO_AD_SPEND_FROM) return { written: 0, removed: 0 };
  const from = window.from && window.from > AUTO_AD_SPEND_FROM ? window.from : AUTO_AD_SPEND_FROM;
  const to = window.to && window.to < today ? window.to : today;
  if (from > to) return { written: 0, removed: 0 };
  const data = await loadAdSpendInputs(orgId, branchId, from, to);
  const pieces = allocate(data.insights, mappingIndex(data.mappings), data.evidence, data.accounts);
  const currencyOf = new Map<string, string>();
  for (const account of data.basics.adAccounts as any[]) if (account.currency) currencyOf.set(String(account.account_id), String(account.currency));
  for (const connection of data.tiktokConnections) for (const adv of (connection.advertisers ?? []) as any[]) if (adv.currency) currencyOf.set(`tt:${adv.id}`, String(adv.currency));
  const productName = new Map(data.basics.products.map((row) => [row.id, row.name]));

  const rows = new Map<string, any>();
  for (const piece of pieces) {
    if (piece.day < from || piece.day > to) continue;
    const id = autoExpenseId(piece.platform, branchId, piece.productId, piece.day);
    const row = rows.get(id) ?? {
      id, org_id: orgId, branch_id: branchId, date: piece.day, category: "Ad Spend", amount: 0,
      currency: currencyOf.get(piece.accountId) ?? "NGN", product_id: piece.productId,
      paid_by: piece.platform === "tiktok" ? "TikTok (automatic)" : "Meta (automatic)",
      description: `${piece.platform === "tiktok" ? "TikTok" : "Meta"} ad spend (automatic) – ${piece.productId ? productName.get(piece.productId) ?? "Product" : "Not assigned to a product"} – ${piece.day}`
    };
    row.amount += piece.spend;
    rows.set(id, row);
  }
  const keep = Array.from(rows.values()).map((row) => ({ ...row, amount: Math.round(row.amount * 100) / 100 })).filter((row) => row.amount > 0);
  for (let i = 0; i < keep.length; i += 200) {
    const { error } = await supabase.from("expenses").upsert(keep.slice(i, i + 200), { onConflict: "id" });
    if (error) throw error;
  }
  // Rows that no longer apply (spend moved to another product, or was zeroed).
  const { data: existing, error: readError } = await supabase.from("expenses").select("id")
    .eq("org_id", orgId).like("id", `ads-auto-%-${branchId.slice(0, 8)}-%`).gte("date", from).lte("date", to);
  if (readError) throw readError;
  const keepIds = new Set(keep.map((row) => row.id));
  const stale = ((existing ?? []) as any[]).map((row) => String(row.id)).filter((id) => !keepIds.has(id));
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await supabase.from("expenses").delete().eq("org_id", orgId).in("id", stale.slice(i, i + 200));
    if (error) throw error;
  }
  return { written: keep.length, removed: stale.length };
}
