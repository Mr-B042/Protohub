import { supabase } from "./supabase.js";

type OrgPushBranding = {
  brandName?: string;
  brandLogo?: string;
};

function resolvePublicApiBaseUrl(): string | undefined {
  const explicit = process.env.PUBLIC_API_URL?.trim() || process.env.VITE_API_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) {
    return `https://${railwayDomain.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}`;
  }

  if (process.env.NODE_ENV !== "production") {
    const port = process.env.PORT?.trim() || "4000";
    return `http://localhost:${port}`;
  }

  return undefined;
}

function normalizeLogoForPush(orgId: string, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
    return trimmed;
  }
  if (trimmed.startsWith("data:image/")) {
    const apiBase = resolvePublicApiBaseUrl();
    if (!apiBase) return undefined;
    return `${apiBase}/api/public/branding/${orgId}/logo`;
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
    brandLogo: normalizeLogoForPush(orgId, data?.logo_url)
  };
}
