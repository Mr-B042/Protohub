// The WordPress embed code: the form iframe plus one line loading
// public/protohub-embed.js, which passes ad ids into the form, forwards Meta
// Pixel events (with advanced matching), reports each browser Purchase back to
// Protohub and redirects to the thank-you page. Shared by Embed Form and
// Tracking Hub so both produce the same code. Landing pages still carrying the
// older inline copy keep working; they just don't get later fixes.

const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export function buildEmbedSnippet(url: string, title: string, beaconUrl: string = `${API_BASE}/api/public/tracking/browser-event`) {
  // The script lives at /protohub-embed.js on the same site as the form
  // (Bright, 10 Oct 2026), so later fixes reach every landing page without
  // re-pasting this code. Its logic used to be pasted inline here.
  let origin = "";
  try { origin = new URL(url).origin; } catch { origin = typeof window !== "undefined" ? window.location.origin : ""; }
  return `<iframe
  id="ordo-order-embed"
  src="${url}"
  width="100%"
  height="800"
  frameborder="0"
  scrolling="no"
  style="border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;"
  title="${title}"
></iframe>
<script src="${origin}/protohub-embed.js" data-iframe="ordo-order-embed" data-beacon="${beaconUrl}"></script>`;
}
