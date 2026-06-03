// Regenerates the native Android brand icons from the SVG source below into the
// (gitignored) android/ project. Run AFTER `npx cap add android`, then apply the
// two manifest/background edits documented in MOBILE-RELEASE.md, then rebuild.
//
//   cd "<repo root>" && node scripts/gen-android-icons.mjs
//
// Resolves `sharp` from backend/node_modules (the only place it's installed).
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import { mkdir } from "fs/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "backend", "package.json"));
const sharp = require("sharp");

const RES = path.join(here, "..", "android", "app", "src", "main", "res");

const DEFS = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#1b2027"/><stop offset="1" stop-color="#2d3744"/>
  </linearGradient>
  <linearGradient id="blue" x1="0" y1="0" x2="0" y2="1024" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="#36a3ec"/><stop offset="1" stop-color="#1377c9"/>
  </linearGradient>
</defs>`;
const MARK = `<g transform="translate(512 512) rotate(45)">
  <rect x="-268" y="-268" width="536" height="536" rx="64" fill="url(#blue)"/>
  <rect x="-158" y="-158" width="316" height="316" rx="40" fill="#f4f7fb"/>
  <rect x="-74" y="-74" width="148" height="148" rx="22" fill="url(#blue)"/>
</g>`;

const iconFullSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">${DEFS}<rect width="1024" height="1024" rx="224" fill="url(#bg)"/>${MARK}</svg>`;
const foregroundSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">${DEFS}<g transform="translate(512 512) scale(0.82) translate(-512 -512)">${MARK}</g></svg>`;
const silhouetteSvg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><rect x="106" y="106" width="300" height="300" rx="52" fill="#ffffff" transform="rotate(45 256 256)"/></svg>`;

const LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const NOTIF = { mdpi: 24, hdpi: 36, xhdpi: 48, xxhdpi: 72, xxxhdpi: 96 };

for (const [d, s] of Object.entries(LAUNCHER)) {
  const buf = await sharp(Buffer.from(iconFullSvg)).resize(s, s).png().toBuffer();
  await sharp(buf).toFile(`${RES}/mipmap-${d}/ic_launcher.png`);
  await sharp(buf).toFile(`${RES}/mipmap-${d}/ic_launcher_round.png`);
}
for (const [d, s] of Object.entries(FOREGROUND)) {
  await sharp(Buffer.from(foregroundSvg)).resize(s, s).png().toFile(`${RES}/mipmap-${d}/ic_launcher_foreground.png`);
}
for (const [d, s] of Object.entries(NOTIF)) {
  await mkdir(`${RES}/drawable-${d}`, { recursive: true });
  await sharp(Buffer.from(silhouetteSvg)).resize(s, s).png().toFile(`${RES}/drawable-${d}/ic_stat_notify.png`);
}
console.log("Brand icons regenerated into android/app/src/main/res/");
