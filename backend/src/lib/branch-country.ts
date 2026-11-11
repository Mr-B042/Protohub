import { supabase } from "./supabase.js";

/**
 * A branch's country for customer-facing details (Bright, 11 Nov 2026:
 * Zambia branch). Lower-case ISO code, "ng" when unknown, cached for 10 min.
 */
const cache = new Map<string, { at: number; code: string }>();
export async function branchCountry(branchId: string | null | undefined): Promise<string> {
  if (!branchId) return "ng";
  const hit = cache.get(branchId);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.code;
  const { data } = await supabase.from("branches").select("country_code").eq("id", branchId).maybeSingle();
  const code = String((data as any)?.country_code ?? "NG").toLowerCase() || "ng";
  cache.set(branchId, { at: Date.now(), code });
  return code;
}

/** 0971234567 for a Zambian mobile however it was typed (+260 97…, 97…); otherwise as typed. */
export function zambianPhoneForSave<T extends string | null | undefined>(value: T): T | string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("260") && digits.length > 9) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return /^[79]\d{8}$/.test(digits) ? `0${digits}` : value;
}
