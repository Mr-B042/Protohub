// ── Product media safety rules (Bright, 17 Oct 2026) ────────────────────────
// Anyone with Products & Stock can send photos and videos, so a file is never
// trusted by its name or by the type the phone claims. What it really is comes
// from its first bytes; anything that is not a plain photo or video is refused.
// Photos are then redrawn as fresh copies (product-media route), so whatever
// was hidden inside the original is thrown away.

import type { UserRole } from "../types/index.js";

export type MediaKind = "image" | "video";
export type RealMediaType = "image/jpeg" | "image/png" | "image/webp" | "video/mp4" | "video/quicktime" | "video/webm";

export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
export const SNIFF_BYTES = 64 * 1024;

/** The types a phone may claim when asking for an upload link. */
export const ACCEPTED_TYPES: Record<string, MediaKind> = {
  "image/jpeg": "image", "image/jpg": "image", "image/png": "image", "image/webp": "image",
  "video/mp4": "video", "video/quicktime": "video", "video/webm": "video"
};

export const MEDIA_LABELS = ["product_in_use", "customer_review", "unboxing", "size", "packaging", "other"] as const;
export type MediaLabel = typeof MEDIA_LABELS[number];

/** Owner, Admin and Manager add straight to the gallery and approve others. */
export const MEDIA_APPROVER_ROLES: UserRole[] = ["Owner", "Admin", "Manager"];
/** Everyone else who works with products sends for approval. */
const NO_UPLOAD_ROLES = new Set<string>(["Viewer", "Delivery Agent"]);

export const canApproveMedia = (role: string | undefined) => MEDIA_APPROVER_ROLES.includes(role as UserRole);
export const canSendMedia = (role: string | undefined) => Boolean(role) && !NO_UPLOAD_ROLES.has(String(role));

// Per person, so nobody can flood the gallery or the approval queue.
export const UPLOADS_PER_HOUR = 40;
export const MAX_PENDING_PER_PERSON = 30;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));

/**
 * What the file really is, read from its first bytes, or null when it is not
 * a photo or video we accept. An app, a web page or an SVG renamed to
 * photo.jpg comes back null.
 */
export function sniffMediaType(input: Uint8Array): RealMediaType | null {
  const bytes = input;
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && ascii(bytes, 1, 3) === "PNG" && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // Matroska and WebM share this header; only WebM is accepted.
    return ascii(bytes, 0, Math.min(bytes.length, 64)).includes("webm") ? "video/webm" : null;
  }
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "qt  ") return "video/quicktime";
    // Still pictures use ftyp too (HEIC, AVIF): never treat them as video.
    if (/^(heic|heix|hevc|hevx|mif1|msf1|avif|avis)$/.test(brand)) return null;
    if (/^(isom|iso[2-9]|mp4[12v]|M4V |M4VP|avc1|dash|f4v |3gp[4-9]|3g2[a-c]|MSNV|NDAS|XAVC|mmp4)$/.test(brand)) return "video/mp4";
    return null;
  }
  return null;
}

export const kindOf = (type: RealMediaType): MediaKind => type.startsWith("image/") ? "image" : "video";
export const extensionOf = (type: RealMediaType) =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" } as const)[type];
export const maxBytesFor = (kind: MediaKind) => kind === "image" ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;

/** File names are shown back to staff; keep them short and plain. */
export function cleanFileName(name: unknown) {
  return String(name ?? "")
    .replace(/[\u0000-\u001f\u007f<>"'`\\/]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "file";
}

/** The short name Settings uses for a type ("jpg", "mov"), so a branch can switch types off. */
export const TYPE_KEYS: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm"
};
export const IMAGE_TYPE_KEYS = ["jpg", "png", "webp"];
export const VIDEO_TYPE_KEYS = ["mp4", "mov", "webm"];
export const MEDIA_USAGE = ["product_page", "sales_workspace", "whatsapp", "ads"] as const;

// ── "Add from links" (Bright, 17 Oct 2026) ──────────────────────────────────
// The server fetches a pasted picture link, so the link must point at the
// public internet: never at this server, the database or a home/office
// network (that would let anyone use Protohub to reach inside them).

/** An address on a private, local or reserved network. */
export function isPrivateAddress(ip: string): boolean {
  const address = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  const v4 = address.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)   // carrier-grade NAT
      || (a === 169 && b === 254)             // link-local, cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (address.includes(":")) {
    return address === "::" || address === "::1" || /^f[cd]/.test(address) || /^fe[89ab]/.test(address) || address.startsWith("ff");
  }
  return true; // not an address we understand: refuse
}

/** A pasted link we are willing to fetch, or null. */
export function cleanImportUrl(raw: unknown): URL | null {
  try {
    const url = new URL(String(raw ?? "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^[\d.]+$/.test(host) || host.startsWith("[")) {
      if (isPrivateAddress(host)) return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** A readable file name from a link: the last part of its path. */
export function nameFromUrl(url: URL) {
  const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "") || url.hostname;
  return cleanFileName(last);
}

/**
 * A picture fetched from a link. Same as an upload, plus AVIF: shops' image
 * servers often send AVIF (Temu links ending "format/avif"). It is safe to
 * take because every picture is redrawn as a fresh WebP copy anyway.
 * iPhone HEIC stays out: the picture library cannot read it.
 */
export function sniffLinkPicture(bytes: Uint8Array): "jpg" | "png" | "webp" | "avif" | null {
  const real = sniffMediaType(bytes);
  if (real && kindOf(real) === "image") return TYPE_KEYS[real] as "jpg" | "png" | "webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && /^(avif|avis)$/.test(ascii(bytes, 8, 4))) return "avif";
  return null;
}

/** What a link sent back when it was not a picture we can use, in plain words. */
export function describeNotPicture(bytes: Uint8Array, contentType: string | null): string {
  const type = String(contentType ?? "").toLowerCase();
  const start = ascii(bytes, 0, Math.min(bytes.length, 64)).trimStart().toLowerCase();
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp" && /^(heic|heix|hevc|hevx|mif1|msf1)$/.test(ascii(bytes, 8, 4))) return "That link sent an iPhone HEIC picture, which can't be read yet. Use a JPG, PNG or WEBP link.";
  if (start.startsWith("<svg") || type.includes("svg")) return "That link sent an SVG drawing, which isn't allowed. Use a JPG, PNG or WEBP link.";
  if (start.startsWith("gif8")) return "That link sent a GIF, which isn't allowed. Use a JPG, PNG or WEBP link.";
  if (start.startsWith("<") || type.includes("html")) return "That link opened a web page, not a picture. Open the picture itself and copy its link.";
  if (type.startsWith("video/") || (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp")) return "That link is a video. Videos can't be added from links; upload them from your phone.";
  if (type.startsWith("image/")) return `That link sent a ${type.replace("image/", "").toUpperCase()} picture, which isn't supported. Use a JPG, PNG, WEBP or AVIF link.`;
  return "That link didn't send a picture, so it was refused.";
}
