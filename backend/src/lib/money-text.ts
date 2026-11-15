// Money in customer-facing text, in a branch's own currency (pure: safe in rule files and tests).
// Bright, 15 Nov 2026: Zambia's emails in kwacha (K600), Nigeria's in naira (₦39,500).
const SYMBOL: Record<string, string> = { NGN: "₦", ZMW: "K", GHS: "GH₵", KES: "KSh ", USD: "$" };
const NUMBER_LOCALE: Record<string, string> = { NGN: "en-NG", ZMW: "en-ZM", GHS: "en-GH", KES: "en-KE" };
export const currencySymbol = (currency = "NGN") => SYMBOL[String(currency).toUpperCase()] ?? `${currency} `;
export const moneyText = (amount: number, currency = "NGN") =>
  `${currencySymbol(currency)}${Math.round(Number(amount) || 0).toLocaleString(NUMBER_LOCALE[String(currency).toUpperCase()] ?? "en-NG")}`;
/** A round, friendly amount after converting (K6.6 → K7, K152 → K150, K380 → K380). */
export const roundFriendly = (value: number) => {
  if (!(value > 0)) return 0;
  const step = value < 10 ? 1 : value < 100 ? 5 : value < 1000 ? 10 : 50;
  return Math.max(step, Math.round(value / step) * step);
};
