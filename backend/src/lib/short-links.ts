import { randomBytes } from "node:crypto";
import { supabase } from "./supabase.js";

const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || "https://protohub-production.up.railway.app").replace(/\/+$/, "");

function genCode(): string {
  return randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 7) || randomBytes(6).toString("hex").slice(0, 7);
}

export function shortLinkUrl(code: string): string {
  return `${PUBLIC_BACKEND_URL}/r/${code}`;
}

// Create (or reuse) a short link for a target URL. Returns the full short URL, or
// the original URL if anything fails (so the customer always gets a working link).
export async function createShortLink(orgId: string | null, targetUrl: string): Promise<string> {
  if (!targetUrl) return targetUrl;
  const { data: existing } = await supabase
    .from("short_links")
    .select("code")
    .eq("target_url", targetUrl)
    .limit(1)
    .maybeSingle();
  if (existing?.code) return shortLinkUrl(existing.code);
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const { error } = await supabase.from("short_links").insert({ org_id: orgId, code, target_url: targetUrl });
    if (!error) return shortLinkUrl(code);
  }
  return targetUrl;
}

// Resolve a short code to its target URL (and bump the click count, fire-and-forget).
export async function resolveShortLink(code: string): Promise<string | null> {
  const { data } = await supabase
    .from("short_links")
    .select("id, target_url, click_count")
    .eq("code", code)
    .maybeSingle();
  if (!data?.target_url) return null;
  void supabase.from("short_links").update({ click_count: (data.click_count ?? 0) + 1 }).eq("id", data.id).then(() => {});
  return data.target_url;
}
