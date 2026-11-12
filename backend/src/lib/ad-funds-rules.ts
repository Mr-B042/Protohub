// Low ad account funds (Bright, 12 Nov 2026: "alert whenever my ads account is
// low of funds like minimum of 5000 so I can fund it"). Pure rules, no database.

export const FUNDS_DEFAULTS = { enabled: true, threshold: 5000 };
/** While still low, remind again after this long, only in the day (Lagos). */
export const REMIND_HOURS = 6;
export const REMIND_FROM_HOUR = 7;
export const REMIND_TO_HOUR = 21;
/** Meta: 3 = unsettled (a payment failed, ads stop until it is paid). */
export const UNSETTLED_STATUS = 3;

export type FundsSettings = { enabled: boolean; threshold: number };
export function cleanFundsSettings(raw: unknown): FundsSettings {
  const r = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const threshold = Number(r.threshold);
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : FUNDS_DEFAULTS.enabled,
    threshold: Number.isFinite(threshold) && threshold >= 0 && threshold <= 100_000_000 ? Math.round(threshold) : FUNDS_DEFAULTS.threshold
  };
}

/** What Meta sends for an ad account (fields read in meta-graph adAccountFunds). */
export type MetaFundsRaw = {
  currency?: string; is_prepay_account?: boolean; account_status?: number; disable_reason?: number;
  balance?: string; amount_spent?: string; spend_cap?: string;
  funding_source_details?: { id?: string; display_string?: string; type?: number } | null;
};

/** Meta money fields are in the currency's smallest unit (kobo for NGN). */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "PYG", "ISK", "HUF", "TWD", "UGX", "IDR", "COP", "CRC"]);
export const minorToMajor = (value: string | number | undefined | null, currency: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? n : n / 100;
};

/** "Available balance (NGN 4,500.00)" → 4500. Null when no amount is in the words. */
export function amountInWords(text: string | undefined | null): number | null {
  const matches = String(text ?? "").match(/-?\d[\d,]*(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const n = Number(matches[matches.length - 1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export type FundsLeft = { left: number | null; source: "prepaid" | "spend_limit" | null };

/**
 * Money the account can still spend:
 * - prepaid ("Add funds") accounts: the "Available balance" Meta shows, the
 *   same figure as Ads Manager. Meta also sets a limit on these accounts, but
 *   limit minus spent is that balance without the 7.5% VAT (₦22,000 → ₦20,465
 *   on 12 Nov 2026), so the balance wins;
 * - otherwise, an account spending limit set: limit minus spent so far;
 * - a card that is charged after (no limit): nothing to run out of, null.
 */
export function fundsLeft(raw: MetaFundsRaw): FundsLeft {
  const currency = String(raw.currency ?? "NGN");
  const details = raw.funding_source_details ?? null;
  const prepaidWords = details && (details.type === 20 || /balance|fund/i.test(String(details.display_string ?? "")));
  const prepaid = raw.is_prepay_account || prepaidWords ? amountInWords(details?.display_string) : null;
  const cap = minorToMajor(raw.spend_cap, currency);
  const spent = minorToMajor(raw.amount_spent, currency) ?? 0;
  const limitLeft = cap && cap > 0 ? Math.max(0, cap - spent) : null;
  const cents = (n: number) => Math.round(n * 100) / 100;
  if (prepaid !== null) return { left: cents(prepaid), source: "prepaid" };
  if (limitLeft !== null) return { left: cents(limitLeft), source: "spend_limit" };
  return { left: null, source: null };
}

export type LowReason = "low" | "unpaid";
/** Low when below the level (naira accounts only: the level is in naira), or Meta stopped it for an unpaid bill. */
export function lowReason(input: { left: number | null; currency: string; accountStatus: number | null; threshold: number }): LowReason | null {
  if (input.accountStatus === UNSETTLED_STATUS) return "unpaid";
  if (input.left === null || input.currency.toUpperCase() !== "NGN") return null;
  return input.left < input.threshold ? "low" : null;
}

const lagosHour = (ms: number) => Number(new Date(ms).toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Lagos" })) % 24;

/**
 * Alert the moment an account goes low (any hour: ads stop when it runs out),
 * then remind every REMIND_HOURS while still low, in the day only.
 * Funded back above the level ends the spell; the next drop alerts again.
 */
export function alertDue(input: { low: boolean; lowSince: string | null; lastAlertAt: string | null; nowMs: number }): "first" | "remind" | null {
  if (!input.low) return null;
  if (!input.lowSince || !input.lastAlertAt) return "first";
  const hour = lagosHour(input.nowMs);
  if (hour < REMIND_FROM_HOUR || hour >= REMIND_TO_HOUR) return null;
  return input.nowMs - Date.parse(input.lastAlertAt) >= REMIND_HOURS * 3_600_000 ? "remind" : null;
}

export const naira = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
