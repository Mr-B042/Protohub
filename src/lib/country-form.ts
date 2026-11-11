/**
 * The order form by country (Bright, 11 Nov 2026: Zambia branch). The form
 * learns the country from the product's branch; Nigeria stays exactly as it
 * was, Zambia gets +260 phones, its 10 provinces and main towns.
 */
import { nigerianPhoneProblem } from "./ng-phone";

export type FormCountry = "NG" | "ZM";
export const formCountryOf = (code: string | null | undefined): FormCountry => (String(code ?? "").toUpperCase() === "ZM" ? "ZM" : "NG");

export const DIAL_CODE: Record<FormCountry, string> = { NG: "+234", ZM: "+260" };
export const META_COUNTRY: Record<FormCountry, string> = { NG: "ng", ZM: "zm" };

// ── Zambia ──────────────────────────────────────────────────────────

export const ZAMBIA_PROVINCES = [
  "Lusaka", "Copperbelt", "Central", "Southern", "Eastern", "Northern", "Luapula", "Muchinga", "North-Western", "Western"
] as const;

/** Main towns and Lusaka/Copperbelt areas, for the area hints. Customers can still type any place. */
export const ZAMBIA_TOWNS: Record<string, string[]> = {
  Lusaka: ["Lusaka CBD", "Kabulonga", "Woodlands", "Roma", "Chelston", "Kalingalinga", "Matero", "Chilenje", "Emmasdale", "Kabwata", "Libala", "Chawama", "Mtendere", "Kafue", "Chongwe", "Chilanga"],
  Copperbelt: ["Ndola", "Kitwe", "Chingola", "Mufulira", "Luanshya", "Chililabombwe", "Kalulushi"],
  Central: ["Kabwe", "Kapiri Mposhi", "Mkushi", "Serenje", "Mumbwa"],
  Southern: ["Livingstone", "Choma", "Mazabuka", "Monze", "Kalomo", "Siavonga"],
  Eastern: ["Chipata", "Petauke", "Katete", "Lundazi"],
  Northern: ["Kasama", "Mbala", "Mpulungu", "Luwingu"],
  Luapula: ["Mansa", "Kawambwa", "Samfya", "Nchelenge"],
  Muchinga: ["Chinsali", "Mpika", "Nakonde", "Isoka"],
  "North-Western": ["Solwezi", "Kasempa", "Mwinilunga", "Zambezi"],
  Western: ["Mongu", "Kaoma", "Senanga", "Sesheke"]
};
export const ZAMBIA_KNOWN_AREAS: readonly string[] = Object.values(ZAMBIA_TOWNS).flat();

const fold = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
export function zambiaAreaSuggestions(province: string, typed: string, limit = 8): string[] {
  const towns = ZAMBIA_TOWNS[province] ?? [];
  const query = fold(typed);
  if (!query) return towns.slice(0, limit);
  if (towns.some((town) => fold(town) === query)) return [];
  return towns.filter((town) => fold(town).includes(query)).slice(0, limit);
}
export const zambiaAddressExample = (province: string) =>
  province === "Copperbelt" ? "Plot 12, Broadway, near Ndola Central Hospital" : "Plot 12, Great East Road, near Arcades Mall";

const ZM_PHONE_EXAMPLE = "0971234567";
/** The 9-digit Zambian number without +260 or the leading 0. */
export function zambianPhoneCore(value: string | null | undefined) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("260") && digits.length > 9) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}
/** What is wrong with a Zambian number, in the customer's words; null when it is fine. */
export function zambianPhoneProblem(value: string): string | null {
  const core = zambianPhoneCore(value);
  if (!core) return null;
  if (core.length < 9) return `This number is too short. Zambian numbers have 10 digits, like ${ZM_PHONE_EXAMPLE}.`;
  if (core.length > 9) return `This number is too long. Zambian numbers have 10 digits, like ${ZM_PHONE_EXAMPLE}.`;
  if (!/^[79]/.test(core)) return `Please check this number. It should look like ${ZM_PHONE_EXAMPLE}.`;
  return null;
}

// ── Either country ──────────────────────────────────────────────────

export const phoneProblemFor = (country: FormCountry, value: string) => (country === "ZM" ? zambianPhoneProblem(value) : nigerianPhoneProblem(value));
export const phonePlaceholderFor = (country: FormCountry) => (country === "ZM" ? ZM_PHONE_EXAMPLE : null);

/** Full international digits for Meta's matching (234… or 260…). */
export function metaPhoneDigits(country: FormCountry, value: string) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  const code = country === "ZM" ? "260" : "234";
  if (digits.startsWith(code)) return digits;
  if (digits.startsWith("0")) return `${code}${digits.slice(1)}`;
  return (country === "ZM" ? digits.length === 9 : digits.length === 10) ? `${code}${digits}` : digits;
}
