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
