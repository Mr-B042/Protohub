/**
 * Which product an ad sells, without mapping by hand (Bright, 15 Nov 2026:
 * "smart enough to indicate which exact product ... unless there is no other
 * way to be sure"). Used only where no manual mapping and no form/order
 * evidence exists, most certain first:
 *   ad_link   the ad's destination page sells one product (≥90% of that page's orders)
 *   siblings  every other ad in its campaign points to one product
 *   name      the campaign (else ad set, else ad) name names exactly one product
 *             (Bright chose: use it automatically, marked "from the name").
 */

export type AutoSource = "ad_link" | "siblings" | "name";
export type AutoProduct = { productId: string; source: AutoSource };

/** "https://brightpathhubs.com/shelf/?utm=x" -> "brightpathhubs.com/shelf". null for Facebook/WhatsApp/Instagram links. */
export function pageKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(String(url).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (/(^|\.)(facebook|fb|instagram|whatsapp|wa|messenger|m\.me)\.(com|me)$|^wa\.me$|^fb\.me$|^m\.me$/.test(host)) return null;
    // Protohub's own order form carries the product in the address.
    const product = (u.hash.match(/[?&]product=([0-9a-f-]{36})/i) ?? u.search.match(/[?&]product=([0-9a-f-]{36})/i))?.[1];
    if (product) return `product:${product.toLowerCase()}`;
    return `${host}${u.pathname.toLowerCase().replace(/\/+$/, "")}`;
  } catch { return null; }
}

/** Page -> product, when at least 90% of the page's orders (min 3) were for one product. */
export function pageProducts(rows: Array<{ page: string | null; productId: string | null }>): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!row.page || !row.productId) continue;
    const m = counts.get(row.page) ?? new Map<string, number>();
    m.set(row.productId, (m.get(row.productId) ?? 0) + 1);
    counts.set(row.page, m);
  }
  const out = new Map<string, string>();
  for (const [page, m] of counts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [best, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 3 && n / total >= 0.9) out.set(page, best);
  }
  return out;
}

const STOP = new Set(["the", "and", "for", "with", "of", "a", "an", "new", "sales", "sale", "campaign", "ad", "ads", "copy", "set", "video", "image", "promo", "offer", "test"]);
const tokens = (text: string) => text.toLowerCase()
  .replace(/(\d+)\s*-\s*in\s*-\s*(\d+)/g, "$1in$2")
  .split(/[^a-z0-9]+/).filter(Boolean)
  .map((t) => (t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t))
  .filter((t) => !STOP.has(t) && !/^\d{1,4}$/.test(t));

/**
 * The one product a name names: every word of the product's name appears in
 * it (a 3+ word name may miss one word), and no other product fits as well.
 */
export function productByName(name: string, products: Array<{ id: string; name: string }>): string | null {
  const have = new Set(tokens(name));
  if (!have.size) return null;
  const scored = products.map((p) => {
    const want = [...new Set(tokens(p.name))];
    const hit = want.filter((t) => have.has(t)).length;
    const ok = want.length > 0 && (hit === want.length || (want.length >= 3 && hit === want.length - 1));
    return { id: p.id, ok, hit, score: want.length ? hit / want.length : 0 };
  }).filter((s) => s.ok).sort((a, b) => b.score - a.score || b.hit - a.hit);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score && scored[1].hit === scored[0].hit) return null;
  return scored[0].id;
}

export function autoProducts(input: {
  ads: Array<{ adId: string; campaignId: string; campaignName: string; adsetName: string; adName: string }>;
  /** Ads already known from form visits / orders. */
  linkEvidence: Map<string, string>;
  adPage: Map<string, string | null>;
  pageProduct: Map<string, string>;
  products: Array<{ id: string; name: string }>;
}): Map<string, AutoProduct> {
  const out = new Map<string, AutoProduct>();
  const productIds = new Set(input.products.map((p) => p.id));
  const ads = [...new Map(input.ads.map((a) => [a.adId, a])).values()];
  for (const ad of ads) {
    if (input.linkEvidence.has(ad.adId)) continue;
    const page = input.adPage.get(ad.adId);
    if (!page) continue;
    const direct = page.startsWith("product:") ? page.slice(8) : input.pageProduct.get(page);
    if (direct && productIds.has(direct)) out.set(ad.adId, { productId: direct, source: "ad_link" });
  }
  const byCampaign = new Map<string, Set<string>>();
  for (const ad of ads) {
    const p = input.linkEvidence.get(ad.adId) ?? out.get(ad.adId)?.productId;
    if (!p) continue;
    const set = byCampaign.get(ad.campaignId) ?? new Set<string>();
    set.add(p); byCampaign.set(ad.campaignId, set);
  }
  for (const ad of ads) {
    if (input.linkEvidence.has(ad.adId) || out.has(ad.adId)) continue;
    const set = byCampaign.get(ad.campaignId);
    if (set && set.size === 1) { out.set(ad.adId, { productId: [...set][0], source: "siblings" }); continue; }
    if (set && set.size > 1) continue; // the campaign sells several products: don't guess by name
    const named = productByName(ad.campaignName, input.products) ?? productByName(ad.adsetName, input.products) ?? productByName(ad.adName, input.products);
    if (named) out.set(ad.adId, { productId: named, source: "name" });
  }
  return out;
}
