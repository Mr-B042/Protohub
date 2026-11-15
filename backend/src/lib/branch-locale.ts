import { supabase } from "./supabase.js";

/**
 * Where a branch is, for customer-facing text (Bright, 15 Nov 2026: Zambia's
 * Email Marketing must read like Nigeria's, in kwacha and Lusaka time).
 */
export type BranchLocale = { branchId: string; countryCode: string; country: string; city: string; currency: string; symbol: string; timezone: string; numberLocale: string };

const SYMBOL: Record<string, string> = { NGN: "₦", ZMW: "K", GHS: "GH₵", KES: "KSh ", USD: "$" };
const NUMBER_LOCALE: Record<string, string> = { NGN: "en-NG", ZMW: "en-ZM", GHS: "en-GH", KES: "en-KE" };
const TIMEZONE: Record<string, string> = { NG: "Africa/Lagos", ZM: "Africa/Lusaka", GH: "Africa/Accra", KE: "Africa/Nairobi" };

export const NIGERIA_LOCALE: BranchLocale = { branchId: "", countryCode: "NG", country: "Nigeria", city: "Lagos", currency: "NGN", symbol: "₦", timezone: "Africa/Lagos", numberLocale: "en-NG" };

const cache = new Map<string, { at: number; locale: BranchLocale }>();
export async function branchLocale(branchId: string | null | undefined): Promise<BranchLocale> {
  if (!branchId) return NIGERIA_LOCALE;
  const hit = cache.get(branchId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.locale;
  const { data } = await supabase.from("branches").select("country_code, country_name, city, currency").eq("id", branchId).maybeSingle();
  const row = (data ?? {}) as any;
  const currency = String(row.currency ?? "NGN").toUpperCase();
  const countryCode = String(row.country_code ?? "NG").toUpperCase();
  const locale: BranchLocale = {
    branchId, countryCode, country: row.country_name ?? "Nigeria", city: row.city ?? "",
    currency, symbol: SYMBOL[currency] ?? `${currency} `, timezone: TIMEZONE[countryCode] ?? "Africa/Lagos", numberLocale: NUMBER_LOCALE[currency] ?? "en-NG"
  };
  cache.set(branchId, { at: Date.now(), locale });
  return locale;
}

export { moneyText, currencySymbol } from "./money-text.js";
