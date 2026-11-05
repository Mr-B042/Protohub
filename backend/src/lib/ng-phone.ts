// ── Nigerian phone numbers are saved one way (Bright, 5 Nov 2026) ──────────
// The order form accepts +23408012345678, 08012345678, +2348012345678 and
// 8012345678, but saved them as typed: order 5918 came in as 8168580493 and
// 32% of the month's orders had no leading 0. A number without its 0 does not
// ring from a Nigerian line. A real mobile number is now saved as 080...
// (11 digits). Anything else (a half-typed number, "No phone yet") is kept as
// typed. Same rule as src/lib/ng-phone.ts nigerianPhoneCore.

/** The 10-digit number without +234 or the leading 0. */
export function nigerianPhoneCore(value: string | null | undefined) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("234") && digits.length > 10) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

/** 08012345678 for a Nigerian mobile number; otherwise the value as typed. */
export function nigerianPhoneForSave<T extends string | null | undefined>(value: T): T | string {
  const core = nigerianPhoneCore(value);
  return /^[789]\d{9}$/.test(core) ? `0${core}` : value;
}
