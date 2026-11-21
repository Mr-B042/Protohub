/**
 * "Did you mean …@gmail.com?" for the public order form (21 Nov 2026).
 * 5% of our emails bounced, mostly typos like gamil.com, gmail..com, yahoo.con.
 * Bounces lower our sender score, so more of the good emails land in spam.
 * Only ever SUGGESTS: the order is never blocked over an email address.
 */

const DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];
// Real providers one letter away from a big one: never "correct" these.
const REAL = new Set([...DOMAINS, "mail.com", "ymail.com", "gmx.com", "live.com", "aol.com", "msn.com", "me.com", "yahoo.co.uk", "rocketmail.com", "protonmail.com", "proton.me"]);

// Typos seen on our list + the usual ones.
const KNOWN: Record<string, string> = {
  "gamil.com": "gmail.com", "gmial.com": "gmail.com", "gmai.com": "gmail.com", "gmal.com": "gmail.com", "gmil.com": "gmail.com",
  "gmaill.com": "gmail.com", "gnail.com": "gmail.com", "gmail.co": "gmail.com", "gmail.cm": "gmail.com", "gmail.om": "gmail.com",
  "gmail.con": "gmail.com", "gmail.comm": "gmail.com", "gmail.cim": "gmail.com", "gmail.vom": "gmail.com", "gmail.xom": "gmail.com",
  "gmail.ng": "gmail.com", "gmail.com.ng": "gmail.com", "g.mail.com": "gmail.com", "gemail.com": "gmail.com", "gimail.com": "gmail.com",
  "yahoo.con": "yahoo.com", "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yhoo.com": "yahoo.com", "yahoo.co": "yahoo.com", "yahoo.cm": "yahoo.com",
  "hotmial.com": "hotmail.com", "hotmai.com": "hotmail.com", "hotmail.con": "hotmail.com", "outlok.com": "outlook.com", "outlet.com": "outlook.com",
  "icloud.con": "icloud.com", "iclod.com": "icloud.com", "icoud.com": "icloud.com"
};

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

/** The corrected address, or null when it looks fine (or can't be guessed). */
export function suggestEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  const local = value.slice(0, at);
  let domain = value.slice(at + 1).replace(/\.{2,}/g, ".").replace(/^\.+|\.+$/g, "").replace(/,/g, ".");
  if (!domain.includes(".") && ["gmail", "yahoo", "hotmail", "outlook", "icloud"].includes(domain)) domain = `${domain}.com`;
  if (KNOWN[domain]) domain = KNOWN[domain];
  else if (!REAL.has(domain)) {
    const close = DOMAINS.find((good) => distance(domain, good) === 1);
    if (close) domain = close;
  }
  const fixed = `${local}@${domain}`;
  return fixed !== value ? fixed : null;
}
