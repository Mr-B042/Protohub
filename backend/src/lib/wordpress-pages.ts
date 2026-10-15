import { supabase } from "./supabase.js";

// ── WordPress page pickers (Bright, 15 Oct 2026) ────────────────────────────
// Reads a site's published pages from its public REST API and keeps them in
// website_pages, so tracking links pick their landing and thank-you pages from
// a list. No login: /wp-json/wp/v2/pages is public on a normal WordPress site.
// Security plugins or a firewall can block it; that is reported plainly.

export const WP_REST_BLOCKED = "WordPress REST API is blocked on this site";
const THANK_YOU_PATTERN = /thank|success|confirm|order-received/i;
const MAX_PAGES = 20; // 20 x 100 pages is far more than any of our sites has
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", laquo: "«", raquo: "»" };
/** WordPress returns titles with HTML entities ("Shelf &#8211; Order"). */
export function decodeEntities(text: string) {
  return String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED[name.toLowerCase()] ?? match)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const looksLikeThankYou = (title: string, slug: string) => THANK_YOU_PATTERN.test(title) || THANK_YOU_PATTERN.test(slug);

const isPublicHost = (hostname: string) =>
  !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[::1\]|169\.254\.)/i.test(hostname);

export type WpPage = { wpPageId: number; title: string; slug: string; url: string; modifiedAt: string | null; isThankYou: boolean };

/** Every published page of the site, following X-WP-TotalPages. */
export async function fetchWordPressPages(domain: string): Promise<WpPage[]> {
  const base = new URL(`https://${String(domain).replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`);
  if (!isPublicHost(base.hostname)) throw httpError(400, "That website address cannot be read.");
  const pages: WpPage[] = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page += 1) {
    const url = new URL("/wp-json/wp/v2/pages", base);
    url.search = new URLSearchParams({ status: "publish", per_page: "100", page: String(page), _fields: "id,title,slug,link,modified,modified_gmt" }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json", "User-Agent": "Protohub page picker" } });
    } catch (error: any) {
      throw httpError(502, error?.name === "AbortError" ? `${base.hostname} took too long to answer.` : `Could not reach ${base.hostname}.`);
    } finally {
      clearTimeout(timer);
    }
    if ([401, 403, 404].includes(response.status)) throw httpError(422, WP_REST_BLOCKED);
    // Asking past the last page answers 400 on WordPress; stop there.
    if (response.status === 400 && page > 1) break;
    if (!response.ok) throw httpError(502, `${base.hostname} answered HTTP ${response.status} for its page list.`);
    const body = await response.json().catch(() => null);
    // A firewall page (HTML) instead of JSON means the API is blocked too.
    if (!Array.isArray(body)) throw httpError(422, WP_REST_BLOCKED);
    totalPages = Math.max(1, Number(response.headers.get("x-wp-totalpages") ?? 1) || 1);
    for (const row of body) {
      const title = decodeEntities(row?.title?.rendered ?? row?.title ?? "");
      const slug = String(row?.slug ?? "");
      const link = String(row?.link ?? "");
      if (!row?.id || !link) continue;
      const modified = row?.modified_gmt ? `${row.modified_gmt}Z` : row?.modified ?? null;
      pages.push({ wpPageId: Number(row.id), title: title || slug || link, slug, url: link, modifiedAt: modified, isThankYou: looksLikeThankYou(title, slug) });
    }
  }
  return pages;
}

type Site = { id: string; org_id: string; branch_id: string; domain: string };

/** Fetch, upsert, and remove pages the site no longer publishes. */
export async function syncWebsitePages(site: Site) {
  const pages = await fetchWordPressPages(site.domain);
  const now = new Date().toISOString();
  const rows = pages.map((page) => ({
    org_id: site.org_id, branch_id: site.branch_id, website_id: site.id, wp_page_id: page.wpPageId,
    title: page.title, slug: page.slug, url: page.url, wp_modified_at: page.modifiedAt, is_thank_you: page.isThankYou, last_synced_at: now
  }));
  for (let index = 0; index < rows.length; index += 200) {
    const { error } = await supabase.from("website_pages").upsert(rows.slice(index, index + 200), { onConflict: "website_id,wp_page_id" });
    if (error) throw error;
  }
  const { data: existing, error: existingError } = await supabase.from("website_pages").select("id, wp_page_id").eq("website_id", site.id);
  if (existingError) throw existingError;
  const keep = new Set(pages.map((page) => page.wpPageId));
  const stale = (existing ?? []).filter((row: any) => !keep.has(Number(row.wp_page_id))).map((row: any) => row.id as string);
  // In batches: a long id list in one request is refused ([[project-postgrest-in-list-limit]]).
  for (let index = 0; index < stale.length; index += 200) {
    const { error } = await supabase.from("website_pages").delete().in("id", stale.slice(index, index + 200));
    if (error) throw error;
  }
  return { pages: pages.length, removed: stale.length, syncedAt: now };
}

export async function lastSyncedAt(websiteId: string): Promise<string | null> {
  const { data } = await supabase.from("website_pages").select("last_synced_at").eq("website_id", websiteId).order("last_synced_at", { ascending: false }).limit(1).maybeSingle();
  return (data as any)?.last_synced_at ?? null;
}

export const syncIsStale = (syncedAt: string | null) => !syncedAt || Date.now() - new Date(syncedAt).getTime() > STALE_AFTER_MS;

/** Landing: thank-you pages last. Thank-you: thank-you pages first. Then by title. */
export function sortPages<T extends { is_thank_you: boolean; title: string }>(rows: T[], type: "landing" | "thank_you") {
  return [...rows].sort((a, b) => {
    if (a.is_thank_you !== b.is_thank_you) return (type === "thank_you" ? (a.is_thank_you ? -1 : 1) : (a.is_thank_you ? 1 : -1));
    return a.title.localeCompare(b.title);
  });
}
