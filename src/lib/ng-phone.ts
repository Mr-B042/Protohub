// ── Nigerian phone check for the order form (Bright, 5 Nov 2026) ────────────
// Order 5914 came in as 0803546892: ten digits, one missing. Nobody could call
// or WhatsApp the customer. The form only asked for 7-15 digits.
//
// Every way a customer writes the same number is fine:
//   +23408012345678   08012345678   +2348012345678   8012345678
// They all come down to the same 10 digits after the country code and the
// leading 0: 8012345678. That core must be exactly 10 digits and start with
// 7, 8 or 9 (Nigerian mobile numbers).

export const PHONE_EXAMPLE = "0801 234 5678";

/** The 10-digit number without +234 or the leading 0. */
export function nigerianPhoneCore(value: string) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("234") && digits.length > 10) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

/** What is wrong with the number, in the customer's words; null when it is fine. */
export function nigerianPhoneProblem(value: string): string | null {
  const core = nigerianPhoneCore(value);
  if (!core) return null;
  if (core.length < 10) return `This number is too short. Nigerian numbers have 11 digits, like ${PHONE_EXAMPLE}.`;
  if (core.length > 10) return `This number is too long. Nigerian numbers have 11 digits, like ${PHONE_EXAMPLE}.`;
  if (!/^[789]/.test(core)) return `Please check this number. It should look like ${PHONE_EXAMPLE}.`;
  return null;
}
