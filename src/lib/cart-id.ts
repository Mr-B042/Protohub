// Cart identifiers for the public order form.
//
// ⚠️ These used to be `CART-${100000 + Math.random() * 900000}` — a 6-digit
// number, so only 900,000 possible ids ever. That is nowhere near enough. By
// the birthday paradox, 2,719 carts against a 900,000-value space gives a
// 98.4% chance of at least one collision and about 4 expected collisions —
// and that is exactly what happened:
//
//   CART-347458 was issued twice. Philip Gbasin (Sapele, Delta, Infinix X6836,
//   Android 13) got it on 19 Aug and ordered; Alidu (Anyigba, Kogi, Infinix
//   X6816, Android 11) got the same id two days later and ordered too. Two
//   different people on two different phones, one cart record — so the cart
//   showed Philip's name while carrying Alidu's latest activity, and both
//   orders pointed at the same cart for attribution.
//
// It was not a shared device and not a stale id in browser storage: the public
// form holds its cart id only in a ref, which starts empty on every page load.
// The generator was simply too small, and it got worse with every cart added.
//
// The replacement pairs a millisecond timestamp with a cryptographically
// random suffix. Two ids can only collide if they are generated in the SAME
// millisecond AND draw the same 8 characters from a 36-character alphabet
// (~2.8 x 10^12 combinations), which will not happen at this volume.
//
// Randomness comes from crypto rather than Math.random deliberately: cart ids
// are accepted by public endpoints, and a 6-digit predictable id was small
// enough to enumerate.

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SUFFIX_LENGTH = 8;

function randomSuffix(): string {
  const bytes = new Uint8Array(SUFFIX_LENGTH);
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    webCrypto.getRandomValues(bytes);
  } else {
    // Older WebView without crypto. Still far larger than the old id space.
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    out += ID_ALPHABET[bytes[index] % ID_ALPHABET.length];
  }
  return out;
}

/**
 * A new cart id, e.g. `CART-M9K2P4XQ-7B3ZQ1MD`.
 *
 * The timestamp prefix is deliberate: ids sort roughly by creation time, which
 * makes a collision investigation possible at all. Old six-digit ids keep
 * working — nothing parses the suffix, and the API only requires
 * `[A-Za-z0-9\-_]{1,80}`.
 */
export const makeCartId = (): string =>
  `CART-${Date.now().toString(36).toUpperCase()}-${randomSuffix()}`;
