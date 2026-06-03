// Regenerates the native Android brand icons into the (gitignored) android/ project.
// Run AFTER `npx cap add android`, then add the manifest meta-data in MOBILE-RELEASE.md,
// then rebuild.
//
//   cd "<repo root>" && node scripts/gen-android-icons.mjs
//
// - Launcher icon  = the brand logo (public/brand/company-logo.png), centred on its bg.
// - Status-bar icons = white monochrome silhouettes (Android requires monochrome):
//     * ic_stat_notify  = brand diamond (default fallback for unmapped events)
//     * ic_stat_<event> = per-event glyphs, recoloured from public/icons/notifications/*.svg
//   so native notifications differ per event just like web.
// Also writes res/values/ic_launcher_background.xml.
//
// `sharp` is resolved from backend/node_modules (the only place it's installed).
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { mkdir, writeFile, readFile } from "fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "backend", "package.json"));
const sharp = require("sharp");

const RES = path.join(here, "..", "android", "app", "src", "main", "res");
const LOGO = path.join(here, "..", "public", "brand", "company-logo.png");
const NOTIF_SVG_DIR = path.join(here, "..", "public", "icons", "notifications");

const corner = await sharp(LOGO).extract({ left: 3, top: 3, width: 1, height: 1 }).raw().toBuffer();
const bgHex = `#${[corner[0], corner[1], corner[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const bgRGB = { r: corner[0], g: corner[1], b: corner[2], alpha: 1 };

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const NOTIF = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };

// ── Launcher (the brand logo) ──────────────────────────────────────────────
for (const [d, s] of Object.entries(LAUNCHER)) {
  const inner = Math.round(s * 0.88);
  const logo = await sharp(LOGO).resize(inner, inner, { fit: "contain", background: bgRGB }).png().toBuffer();
  const buf = await sharp({ create: { width: s, height: s, channels: 4, background: bgRGB } })
    .composite([{ input: logo, gravity: "center" }]).png().toBuffer();
  await sharp(buf).toFile(`${RES}/mipmap-${d}/ic_launcher.png`);
  await sharp(buf).toFile(`${RES}/mipmap-${d}/ic_launcher_round.png`);
}
for (const [d, s] of Object.entries(FOREGROUND)) {
  const inner = Math.round(s * 0.78);
  const logo = await sharp(LOGO).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const fg = await sharp({ create: { width: s, height: s, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, gravity: "center" }]).png().toBuffer();
  await sharp(fg).toFile(`${RES}/mipmap-${d}/ic_launcher_foreground.png`);
}

// ── Status-bar small icons (white silhouettes) ─────────────────────────────
async function writeDrawable(name, svg) {
  for (const [d, s] of Object.entries(NOTIF)) {
    await mkdir(`${RES}/drawable-${d}`, { recursive: true });
    await sharp(Buffer.from(svg)).resize(s, s).png().toFile(`${RES}/drawable-${d}/${name}.png`);
  }
}
// Default brand diamond (fallback for events with no per-event glyph).
await writeDrawable("ic_stat_notify",
  `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect x="106" y="106" width="300" height="300" rx="52" fill="#ffffff" transform="rotate(45 256 256)"/></svg>`);

// Per-event glyphs — strip the colour bg + faint decorations from the web SVG and
// render the white glyph (strokes bolded ~1.4x so they read at 24px).
const toWhiteSilhouette = (raw) => raw
  .replace(/<defs>[\s\S]*?<\/defs>/g, "")
  .replace(/<rect\s+width="192"\s+height="192"[^>]*\/>/g, "")
  .replace(/<[a-zA-Z]+[^>]*fill-opacity="[^"]*"[^>]*\/>/g, "")
  .replace(/stroke-width="(\d+(?:\.\d+)?)"/g, (_m, w) => `stroke-width="${(Number(w) * 1.4).toFixed(1)}"`)
  .replace(/#fff(?![0-9a-fA-F])/g, "#ffffff");

const GLYPHS = {
  ic_stat_order_new: "order-new.svg",
  ic_stat_order_confirmed: "order-confirmed.svg",
  ic_stat_order_delivered: "order-delivered.svg",
  ic_stat_order_cancelled: "order-cancelled.svg",
  ic_stat_order_failed: "order-failed.svg",
  ic_stat_order_rescheduled: "order-rescheduled.svg",
  ic_stat_order_assigned: "order-assigned.svg",
  ic_stat_low_stock: "low-stock.svg",
  ic_stat_remittance_overdue: "remittance-overdue.svg",
  ic_stat_stale_carts: "stale-carts.svg",
  ic_stat_waybill: "waybill.svg",
  ic_stat_info: "info.svg"
};
for (const [name, file] of Object.entries(GLYPHS)) {
  const raw = await readFile(path.join(NOTIF_SVG_DIR, file), "utf8");
  await writeDrawable(name, toWhiteSilhouette(raw));
}

await writeFile(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bgHex}</color>\n    <color name="notification_accent">#1F8FE0</color>\n</resources>\n`);

console.log(`Brand + per-event icons regenerated (logo bg ${bgHex}; ${Object.keys(GLYPHS).length} event glyphs).`);
