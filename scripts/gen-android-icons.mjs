// Regenerates the native Android brand icons into the (gitignored) android/ project.
// Run AFTER `npx cap add android`, then add the manifest meta-data documented in
// MOBILE-RELEASE.md, then rebuild.
//
//   cd "<repo root>" && node scripts/gen-android-icons.mjs
//
// Launcher icon  = the real brand logo (public/brand/company-logo.png), centred on
//                  its own background colour.
// Status-bar icon = a white diamond silhouette (a full-colour logo can't be the
//                  monochrome small icon Android requires; the diamond echoes the logo).
// Also writes res/values/ic_launcher_background.xml (adaptive bg + accent colour).
//
// Resolves `sharp` from backend/node_modules (the only place it's installed).
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { mkdir, writeFile } from "fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "backend", "package.json"));
const sharp = require("sharp");

const RES = path.join(here, "..", "android", "app", "src", "main", "res");
const LOGO = path.join(here, "..", "public", "brand", "company-logo.png");

// Sample the logo's background colour (a corner pixel) so the icon padding blends.
const corner = await sharp(LOGO).extract({ left: 3, top: 3, width: 1, height: 1 }).raw().toBuffer();
const bgHex = `#${[corner[0], corner[1], corner[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
const bgRGB = { r: corner[0], g: corner[1], b: corner[2], alpha: 1 };

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const NOTIF = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };

// Legacy square icon: logo at ~88% on the brand-gray background.
for (const [d, s] of Object.entries(LAUNCHER)) {
  const inner = Math.round(s * 0.88);
  const logo = await sharp(LOGO).resize(inner, inner, { fit: "contain", background: bgRGB }).png().toBuffer();
  const buf = await sharp({ create: { width: s, height: s, channels: 4, background: bgRGB } })
    .composite([{ input: logo, gravity: "center" }]).png().toBuffer();
  await sharp(buf).toFile(`${RES}/mipmap-${d}/ic_launcher.png`);
  await sharp(buf).toFile(`${RES}/mipmap-${d}/ic_launcher_round.png`);
}
// Adaptive foreground: logo at ~78% centred on transparent (safe-zone inset so the
// launcher mask never clips the logo); the adaptive background colour fills the rest.
for (const [d, s] of Object.entries(FOREGROUND)) {
  const inner = Math.round(s * 0.78);
  const logo = await sharp(LOGO).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const fg = await sharp({ create: { width: s, height: s, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, gravity: "center" }]).png().toBuffer();
  await sharp(fg).toFile(`${RES}/mipmap-${d}/ic_launcher_foreground.png`);
}
// Status-bar small icon: white diamond silhouette (monochrome; required by Android).
const silhouetteSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect x="106" y="106" width="300" height="300" rx="52" fill="#ffffff" transform="rotate(45 256 256)"/></svg>`;
for (const [d, s] of Object.entries(NOTIF)) {
  await mkdir(`${RES}/drawable-${d}`, { recursive: true });
  await sharp(Buffer.from(silhouetteSvg)).resize(s, s).png().toFile(`${RES}/drawable-${d}/ic_stat_notify.png`);
}
// Adaptive background colour (matches the logo bg) + notification accent.
await writeFile(`${RES}/values/ic_launcher_background.xml`,
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bgHex}</color>\n    <color name="notification_accent">#1F8FE0</color>\n</resources>\n`);

console.log(`Brand icons regenerated (logo bg ${bgHex}).`);
