import { looksLikeThankYou } from "./wordpress-pages.js";

// ── Products & Stock "View landing page" (Bright, 17 Oct 2026) ──────────────
// Each product's landing pages come from its Tracking Hub links
// (meta_capi_configs.product_id + landing_page_url), so nobody types a link
// twice. Staff open them inside Protohub, where the order form turns itself
// view-only (src/lib/landing-preview.ts).

export type LandingPage = { productId: string; url: string; label: string };

type LinkRow = { product_id: string | null; landing_page_url: string | null; label: string | null; active: boolean | null };

const cleanUrl = (raw: string | null) => {
  try {
    const url = new URL(String(raw ?? "").trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
};
// One page reached by several links (one per ad set) is still one page.
const pageKey = (url: URL) => `${url.host.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "")}`;

/** Active links with a product and a real page; thank-you pages left out. */
export function landingPagesFromLinks(rows: LinkRow[]): LandingPage[] {
  const seen = new Set<string>();
  const pages: LandingPage[] = [];
  for (const row of rows) {
    if (row.active === false || !row.product_id) continue;
    const url = cleanUrl(row.landing_page_url);
    if (!url || looksLikeThankYou("", url.pathname)) continue;
    const key = `${row.product_id}|${pageKey(url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push({ productId: row.product_id, url: url.toString(), label: String(row.label ?? "").trim() || url.pathname });
  }
  return pages.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Why the site refuses to be shown inside Protohub, or null when it allows it.
 * Some WordPress security plugins send these headers; the browser then shows
 * an empty box, so the preview says it in words instead.
 */
export function frameBlockReason(headers: { get(name: string): string | null }, appOrigin: string | null): string | null {
  const xfo = String(headers.get("x-frame-options") ?? "").trim().toLowerCase();
  if (xfo === "deny" || xfo === "sameorigin") return "This website does not allow its pages to be shown inside another app.";
  const csp = String(headers.get("content-security-policy") ?? "");
  const directive = csp.split(";").map((part) => part.trim()).find((part) => /^frame-ancestors\b/i.test(part));
  if (!directive) return null;
  const sources = directive.split(/\s+/).slice(1).map((source) => source.replace(/^'|'$/g, "").toLowerCase());
  if (sources.includes("*")) return null;
  const app = String(appOrigin ?? "").toLowerCase();
  const appHost = app.replace(/^https?:\/\//, "");
  const allowed = sources.some((source) => {
    if (source === app || source === appHost) return true;
    const wildcard = source.replace(/^https?:\/\//, "").match(/^\*\.(.+)$/);
    return Boolean(wildcard && appHost.endsWith(`.${wildcard[1]}`));
  });
  return allowed ? null : "This website does not allow its pages to be shown inside another app.";
}
