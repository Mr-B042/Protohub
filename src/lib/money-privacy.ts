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
  return String(text ?? "").replace(MONEY_IN_TEXT, (_match, symbol: string) => `${symbol.trim()}••••`);
};

const nairaDigits = (value: number) => Math.round(Number(value) || 0).toLocaleString("en-NG");

/** ₦1,234,567 — masked to ₦•••• when privacy mode is on. */
export const naira = (value: number): string =>
  isMoneyHidden() ? "₦••••" : `₦${nairaDigits(value)}`;

/** Explicitly signed, for variances where the direction is the whole point. */
export const signedNaira = (value: number): string => {
  const rounded = Math.round(Number(value) || 0);
  if (isMoneyHidden()) {
    // ⚠️ The SIGN survives masking. Whether money is missing or surplus is not
    // the sensitive part - the amount is - and hiding the direction would make
    // a variance panel useless rather than private.
    if (rounded === 0) return "₦••••";
    return `${rounded < 0 ? "−" : "+"}₦••••`;
  }
  if (rounded === 0) return "₦0";
  return `${rounded < 0 ? "−" : "+"}₦${Math.abs(rounded).toLocaleString("en-NG")}`;
};

/** ₦1.2M / ₦450K, for axis labels and tight cells. */
export const shortNaira = (value: number): string => {
  if (isMoneyHidden()) return "₦••";
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}₦${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}₦${Math.round(abs / 1_000)}K`;
  return `${sign}₦${Math.round(abs)}`;
};
