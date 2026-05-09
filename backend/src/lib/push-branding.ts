import { supabase } from "./supabase.js";

type OrgPushBranding = {
  brandName?: string;
  brandLogo?: string;
};

function normalizeLogoForPush(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return trimmed;
  }
  return undefined;
}

export async function getOrgPushBranding(orgId: string): Promise<OrgPushBranding> {
  const { data } = await supabase
    .from("organizations")
    .select("name, logo_url")
    .eq("id", orgId)
    .single();

  return {
    brandName: typeof data?.name === "string" && data.name.trim() ? data.name.trim() : "Protohub",
    brandLogo: normalizeLogoForPush(data?.logo_url)
  };
}
