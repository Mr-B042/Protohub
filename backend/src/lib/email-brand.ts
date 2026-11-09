import crypto from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

/**
 * The business's brand on every customer email (Bright, 9 Nov 2026: "all
 * our emails to have our branding and logo… our branding colour is from our
 * logo colour"). Colours were read from the Protohub logo: charcoal, sky
 * blue, light grey.
 *
 * The logo is saved in Settings as a picture inside the database (a data
 * link). Gmail and most email apps block those, so a copy is put in the
 * public email-assets store once and its normal web link is used.
 */

export const BRAND_COLORS = {
  charcoal: "#26262E",
  ink: "#1C1C22",
  blue: "#2A98DE",
  blueLight: "#37ADFC",
  blueDark: "#1F7FC0",
  grey: "#BFC2C7",
  mist: "#EEF5FC",
  page: "#F2F4F7"
} as const;

export type EmailBrand = { name: string; logoUrl: string | null; tagline: string; helpPhone: string };

const cache = new Map<string, { at: number; brand: Promise<EmailBrand> }>();
const TTL_MS = 10 * 60_000;

async function hostedLogo(orgId: string, logo: string | null): Promise<string | null> {
  const value = String(logo ?? "").trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  const match = /^data:(image\/(png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[3], "base64");
  const hash = crypto.createHash("sha1").update(bytes).digest("hex").slice(0, 12);
  const ext = match[2] === "jpeg" || match[2] === "jpg" ? "jpg" : match[2];
  const path = `${orgId}/brand/logo-${hash}.${ext}`;
  // Same picture = same name: uploading again only happens when the logo changes (or after a restart).
  const { error } = await supabase.storage.from("email-assets").upload(path, bytes, { contentType: match[1], upsert: true, cacheControl: "31536000" });
  if (error) { logger.warn("email logo upload failed", { orgId, error: error.message }); return null; }
  return supabase.storage.from("email-assets").getPublicUrl(path).data.publicUrl;
}

/** Name, logo (a normal web link), receipt tagline and help phone of an organisation. Never throws. */
export function emailBrand(orgId: string): Promise<EmailBrand> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.brand;
  const brand = (async (): Promise<EmailBrand> => {
    try {
      const { data } = await supabase.from("organizations").select("name, logo_url, receipt_tagline, receipt_help_phone").eq("id", orgId).maybeSingle();
      return {
        name: String(data?.name ?? "").trim() || "Protohub",
        logoUrl: await hostedLogo(orgId, data?.logo_url ?? null),
        tagline: String(data?.receipt_tagline ?? "").trim(),
        helpPhone: String(data?.receipt_help_phone ?? "").trim()
      };
    } catch (error) {
      logger.warn("email brand lookup failed", { orgId, error: (error as Error).message });
      return { name: "Protohub", logoUrl: null, tagline: "", helpPhone: "" };
    }
  })();
  cache.set(orgId, { at: Date.now(), brand });
  return brand;
}
