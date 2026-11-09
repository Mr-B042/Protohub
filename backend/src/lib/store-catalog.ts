import { logger } from "./logger.js";

/**
 * Our Store's products for emails (Bright, 9 Nov 2026: offers from the store to
 * delivered customers, "draft the product image offer from our store"). The
 * store (FleetCart) answers its product list as JSON; Protohub keeps a light
 * copy (name, price, photo, link, stock), refreshed every 12 hours, and picks
 * from it when an email is SENT, so prices, photos and stock are always the
 * store's current ones.
 *
 * The store's own search mixes topics, so picks are matched here by the words
 * in product names.
 */

export const STORE_BASE = "https://protoolshardwareventures.com.ng";
export type StoreItem = { id: number; name: string; price: number; wasPrice: number | null; image: string; url: string; inStock: boolean };
export type StorePickMode = "related" | "value" | "new" | "again";

const REFRESH_MS = 12 * 60 * 60_000;
let cache: { at: number; items: StoreItem[] } | null = null;
let loading: Promise<StoreItem[]> | null = null;

const num = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const tidyName = (value: string) => value.replace(/\s+/g, " ").replace(/\s+—\s+[A-Z0-9]{1,6}$/, "").trim();

function toItem(raw: any): StoreItem | null {
  const price = num(raw?.selling_price?.amount ?? raw?.price?.amount);
  const image = String(raw?.base_image?.path ?? "");
  if (!raw?.slug || !price || !/^https:\/\//.test(image)) return null;
  const was = num(raw?.price?.amount);
  return { id: num(raw.id), name: tidyName(String(raw.name ?? "")), price, wasPrice: was > price ? was : null, image, url: `${STORE_BASE}/products/${raw.slug}`, inStock: !!raw.is_in_stock || !!raw.in_stock };
}

async function fetchPage(page: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${STORE_BASE}/products?perPage=50&sort=latest&page=${page}`, { headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", "User-Agent": "Protohub-Email" }, signal: controller.signal });
    if (!res.ok) throw new Error(`store answered ${res.status}`);
    const body: any = await res.json();
    return { items: (body?.products?.data ?? []).map(toItem).filter(Boolean) as StoreItem[], last: num(body?.products?.last_page) || 1 };
  } finally { clearTimeout(timer); }
}

/** Every store product (newest first). Kept 12 hours; an old copy is used if the store can't be reached. */
export async function storeCatalog(): Promise<StoreItem[]> {
  if (cache && Date.now() - cache.at < REFRESH_MS) return cache.items;
  if (loading) return loading;
  loading = (async () => {
    try {
      const first = await fetchPage(1);
      const items = [...first.items];
      for (let page = 2; page <= Math.min(first.last, 60); page += 1) {
        try { items.push(...(await fetchPage(page)).items); } catch (error) { logger.warn("store catalog page failed", { page, error: (error as Error).message }); }
      }
      const unique = [...new Map(items.map((item) => [item.id, item])).values()];
      cache = { at: Date.now(), items: unique };
      return unique;
    } catch (error) {
      logger.warn("store catalog unavailable", { error: (error as Error).message });
      return cache?.items ?? [];
    } finally { loading = null; }
  })();
  return loading;
}

const STOP = new Set(["and", "the", "for", "with", "of", "in", "to", "a", "an", "pcs", "set", "pack", "big", "small", "high", "quality", "new", "original", "max", "plus", "pro", "1", "2", "3", "4", "5", "in1"]);
const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
/** Words that belong together for a home-goods shop (a rack buyer is shown storage, a brush buyer cleaning). */
const FAMILY: Array<string[]> = [
  ["shelf", "shelves", "rack", "racks", "corner", "storage", "organizer", "organiser", "holder", "stand", "bathroom", "toilet", "wall", "hook", "hooks", "adhesive", "caddy"],
  ["brush", "brusher", "cleaning", "cleaner", "clean", "mop", "broom", "vacuum", "duster", "scrub", "sponge", "wiper"],
  ["kitchen", "cooking", "pot", "pan", "pans", "knife", "chopper", "blender", "spice", "plate", "cup", "utensil", "cutlery", "dicer"]
];
const expand = (list: string[]) => { const out = new Set(list); for (const family of FAMILY) if (list.some((w) => family.includes(w))) for (const w of family) out.add(w); return out; };

/** A steady shuffle per customer and week, so each person sees their own mix and it changes weekly. */
function seeded<T>(list: T[], seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return [...list].map((item, i) => ({ item, r: Math.abs(Math.sin(h + i * 997)) })).sort((a, b) => a.r - b.r).map((row) => row.item);
}
const weekOf = (ms: number) => Math.floor(ms / (7 * 86_400_000));

/** Store products for one email to one customer. `product` = what they bought (for related / again). */
export async function storePicks(mode: StorePickMode, count: number, opts: { product?: string | null; seed?: string; nowMs?: number } = {}): Promise<StoreItem[]> {
  const all = (await storeCatalog()).filter((item) => item.inStock);
  if (!all.length) return [];
  const n = Math.max(1, Math.min(6, count));
  const seed = `${opts.seed ?? ""}:${weekOf(opts.nowMs ?? Date.now())}:${mode}`;
  const mine = words(opts.product ?? "");
  const score = (item: StoreItem, set: Set<string>) => words(item.name).filter((w) => set.has(w)).length;
  if (mode === "again") {
    if (!mine.length) return [];
    const best = all.map((item) => ({ item, s: score(item, new Set(mine)) / Math.max(1, mine.length) })).sort((a, b) => b.s - a.s)[0];
    // Only the same product ("buy it again"), never a look-alike.
    return best && best.s >= 0.85 ? [best.item] : [];
  }
  if (mode === "new") return seeded(all.slice(0, 40), seed).slice(0, n);
  if (mode === "value") return seeded(all.filter((item) => item.price <= 15000), seed).slice(0, n);
  // related: things that go with what they bought (not the same product), else good buys.
  const set = expand(mine);
  const same = new Set(mine);
  const related = all.map((item) => ({ item, s: score(item, set), same: score(item, same) / Math.max(1, mine.length) }))
    .filter((row) => row.s > 0 && row.same < 0.6).sort((a, b) => b.s - a.s).slice(0, 24).map((row) => row.item);
  const pool = related.length >= n ? related : [...related, ...all.filter((item) => item.price <= 15000 && !related.includes(item))];
  return seeded(pool.slice(0, Math.max(n * 3, 12)), seed).slice(0, n);
}
