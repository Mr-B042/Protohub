import { supabase } from "./supabase.js";

// Exchange rates for booking (Bright, 15 Nov 2026): Zambia books naira ad spend
// in kwacha with the naira shown underneath. Defaults until the Owner sets one.
export const DEFAULT_RATES: Record<string, { fromPerTo: number; source: string }> = {
  "NGN>ZMW": { fromPerTo: 65.8, source: "Mid-market rate, 10–12 Nov 2026 (about 0.0152 kwacha per naira: exchange-rates.org, World Forex Rates, XE)" }
};

export type Rate = { from: string; to: string; fromPerTo: number; source: string; setBy: string | null; updatedAt: string | null; isDefault: boolean };

export async function rateFor(orgId: string, from: string, to: string): Promise<Rate | null> {
  if (from === to) return { from, to, fromPerTo: 1, source: "same currency", setBy: null, updatedAt: null, isDefault: true };
  const { data } = await supabase.from("currency_rates").select("from_per_to, source, updated_by_name, updated_at").eq("org_id", orgId).eq("from_currency", from).eq("to_currency", to).maybeSingle();
  if (data) return { from, to, fromPerTo: Number((data as any).from_per_to), source: (data as any).source ?? "Set by you", setBy: (data as any).updated_by_name ?? null, updatedAt: (data as any).updated_at, isDefault: false };
  const d = DEFAULT_RATES[`${from}>${to}`];
  return d ? { from, to, fromPerTo: d.fromPerTo, source: d.source, setBy: null, updatedAt: null, isDefault: true } : null;
}

/** Pure: an amount in `from` booked in `to`. */
export const convert = (amount: number, rate: Pick<Rate, "fromPerTo">) => Math.round((amount / rate.fromPerTo) * 100) / 100;
