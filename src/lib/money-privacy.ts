import { spaceNaira } from "./naira-glyph";
// App-wide "hide money" privacy toggle.
//
// ⚠️ The flag is a plain module-level value, NOT React state, so the dozens of
// formatXMoney helpers defined outside any component can mask their output with
// a single check. Components re-render through useSyncExternalStore.
//
// This lives here rather than in App.tsx because the extracted pages need it
// too, and importing from App.tsx would be circular. Every page that formats
// money must use these helpers - a page with its own private `naira()` silently
// ignores the toggle, which is exactly how Cash Flow ended up showing real
// figures with privacy mode on.

export const MONEY_HIDDEN_STORAGE_KEY = "protohub_hide_money";

let moneyHiddenGlobal = (() => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(MONEY_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();

const moneyHiddenListeners = new Set<() => void>();

export const isMoneyHidden = () => moneyHiddenGlobal;

export const setMoneyHiddenGlobal = (value: boolean) => {
  moneyHiddenGlobal = value;
  try {
    window.localStorage.setItem(MONEY_HIDDEN_STORAGE_KEY, value ? "1" : "0");
  } catch {
    // localStorage unavailable (private browsing, etc.) - still works this session.
  }
  moneyHiddenListeners.forEach((listener) => listener());
};

export const subscribeMoneyHidden = (listener: () => void) => {
  moneyHiddenListeners.add(listener);
  return () => moneyHiddenListeners.delete(listener);
};

// ── The money the branch on screen trades in ────────────────────────────────
//
// ⚠️ A PLAIN MODULE VALUE FOR THE SAME REASON AS THE FLAG ABOVE.
// The helpers below are called from outside any component, so they cannot read
// React state. They used to print a naira sign no matter what, which was fine
// while there was one country and wrong the moment Accra traded in cedi - the
// figure was real and the symbol was a lie.
//
// App.tsx pushes the active branch's currency here whenever the branch changes.
// Nothing is ever converted; this only decides the label.

type ActiveCurrency = { code: string; symbol: string; locale: string };

let activeCurrency: ActiveCurrency = { code: "NGN", symbol: "\u20a6", locale: "en-NG" };
const currencyListeners = new Set<() => void>();

export const getActiveCurrency = () => activeCurrency;

export const setActiveCurrency = (next: ActiveCurrency) => {
  if (next.code === activeCurrency.code) return;
  activeCurrency = next;
  currencyListeners.forEach((listener) => listener());
};

export const subscribeActiveCurrency = (listener: () => void) => {
  currencyListeners.add(listener);
  return () => currencyListeners.delete(listener);
};

/**
 * Keeps any leading currency symbol so a masked amount still reads as money,
 * just with the digits hidden.
 */
export const maskFormattedMoney = (formatted: string) => {
  const prefixMatch = formatted.match(/^[^\d-]*/);
  return `${prefixMatch ? prefixMatch[0] : ""}••••`;
};

/**
 * Mask every currency amount inside a free-text string.
 *
 * ⚠️ Needed because notification titles and bodies are built on the SERVER with
 * the amount already baked into the sentence ("Remittance overdue … ₦58,498").
 * No client-side formatter can reach those digits, so the rendered text is
 * rewritten instead.
 *
 * Only digits that FOLLOW a currency marker are touched, so order numbers,
 * quantities, dates and percentages are left intact - masking those would make
 * a notification unreadable without hiding anything worth hiding.
 */
const MONEY_IN_TEXT = /(₦|NGN\s?|\$|£|€)\s?\d[\d,]*(?:\.\d+)?/gi;
export const maskMoneyText = (text: string): string => {
  if (!isMoneyHidden()) return text;
  return String(text ?? "").replace(MONEY_IN_TEXT, (_match, symbol: string) => spaceNaira(`${symbol.trim()}••••`));
};

const moneyDigits = (value: number) =>
  Math.round(Number(value) || 0).toLocaleString(activeCurrency.locale);

/** The symbol of the branch on screen, for column headings and tight labels. */
export const currencySymbol = () => activeCurrency.symbol;

/** ₦1,234,567 in Nigeria, ₵1,234,567 in Ghana — masked when privacy mode is on. */
export const money = (value: number): string => {
  const sym = activeCurrency.symbol;
  return spaceNaira(isMoneyHidden() ? `${sym}••••` : `${sym}${moneyDigits(value)}`);
};

/** Explicitly signed, for variances where the direction is the whole point. */
export const signedMoney = (value: number): string => {
  const sym = activeCurrency.symbol;
  const rounded = Math.round(Number(value) || 0);
  if (isMoneyHidden()) {
    // ⚠️ The SIGN survives masking. Whether money is missing or surplus is not
    // the sensitive part - the amount is - and hiding the direction would make
    // a variance panel useless rather than private.
    if (rounded === 0) return spaceNaira(`${sym}••••`);
    return spaceNaira(`${rounded < 0 ? "−" : "+"}${sym}••••`);
  }
  if (rounded === 0) return spaceNaira(`${sym}0`);
  return spaceNaira(`${rounded < 0 ? "−" : "+"}${sym}${Math.abs(rounded).toLocaleString(activeCurrency.locale)}`);
};

/** ₦1.2M / ₦450K, for axis labels and tight cells. */
export const shortMoney = (value: number): string => {
  const sym = activeCurrency.symbol;
  if (isMoneyHidden()) return spaceNaira(`${sym}••`);
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (abs >= 1_000_000) return spaceNaira(`${sign}${sym}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`);
  if (abs >= 1_000) return spaceNaira(`${sign}${sym}${Math.round(abs / 1_000)}K`);
  return spaceNaira(`${sign}${sym}${Math.round(abs)}`);
};
