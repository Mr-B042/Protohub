import { Router } from "express";
import { getOrgBrandingRecord } from "../lib/push-branding.js";

const router = Router();

function parseDataUrlImage(value: string): { contentType: string; buffer: Buffer } | null {
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  try {
    return {
      contentType: match[1],
      buffer: Buffer.from(match[2], "base64")
    };
  } catch {
    return null;
  }
}

async function remoteImageResponse(rawLogoUrl: string): Promise<Response | null> {
  if (!/^https?:\/\//i.test(rawLogoUrl)) return null;
  try {
    const response = await fetch(rawLogoUrl);
    if (!response.ok) return null;
    return response;
  } catch {
    return null;
  }
}

function frontendRelativeLogoUrl(rawLogoUrl: string): string | null {
  if (!rawLogoUrl.startsWith("/")) return null;
  const frontendUrl = process.env.FRONTEND_URL?.trim();
  if (!frontendUrl) return null;
  return `${frontendUrl.replace(/\/+$/, "")}${rawLogoUrl}`;
}

router.get("/manifest", async (req, res) => {
  const orgId = typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
  const version = typeof req.query.v === "string" ? req.query.v.trim() : "";

  let brandName = "Protohub";
  let hasBrandLogo = false;

  if (orgId) {
    try {
      const branding = await getOrgBrandingRecord(orgId);
      brandName = branding.brandName || "Protohub";
      hasBrandLogo = Boolean(branding.rawLogoUrl);
    } catch {
      // Fallback to default manifest metadata when org branding cannot be read.
    }
  }

  const iconQuery = `orgId=${encodeURIComponent(orgId)}${version ? `&v=${encodeURIComponent(version)}` : ""}`;
  const manifest = {
    name: brandName,
    short_name: brandName.slice(0, 32) || "Protohub",
    description: "Nigerian POD CRM for managing orders, agents, inventory, and deliveries",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1F8FE0",
    orientation: "portrait-primary",
    categories: ["business", "productivity"],
    prefer_related_applications: false,
    icons: hasBrandLogo
      ? [
          { src: `/org-icons/app-192.png?${iconQuery}`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `/org-icons/app-192.png?${iconQuery}`, sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: `/org-icons/app-512.png?${iconQuery}`, sizes: "512x512", type: "image/png", purpose: "any" },
          { src: `/org-icons/app-512.png?${iconQuery}`, sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      : [
          { src: "/icons/icon-72.png", sizes: "72x72", type: "image/png" },
          { src: "/icons/icon-96.png", sizes: "96x96", type: "image/png" },
          { src: "/icons/icon-128.png", sizes: "128x128", type: "image/png" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
  };

  res.set("Access-Control-Allow-Origin", "*");
  res.set("Cache-Control", "public, max-age=300");
  res.type("application/manifest+json").send(JSON.stringify(manifest));
});

router.get("/icons/:name", async (req, res) => {
  const orgId = typeof req.query.orgId === "string" ? req.query.orgId.trim() : "";
  if (!orgId) {
    res.status(400).json({ error: "orgId is required." });
    return;
  }

  try {
    const branding = await getOrgBrandingRecord(orgId);
    if (!branding.rawLogoUrl) {
      res.status(404).json({ error: "Organization logo not found." });
      return;
    }

    const dataUrl = parseDataUrlImage(branding.rawLogoUrl);
    if (dataUrl) {
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.set("Cache-Control", "public, max-age=300");
      res.type(dataUrl.contentType).send(dataUrl.buffer);
      return;
    }

    const remote = await remoteImageResponse(branding.rawLogoUrl);
    if (remote) {
      const arrayBuffer = await remote.arrayBuffer();
      res.set("Access-Control-Allow-Origin", "*");
      res.set("Cross-Origin-Resource-Policy", "cross-origin");
      res.set("Cache-Control", "public, max-age=300");
      res.type(remote.headers.get("content-type") || "image/png").send(Buffer.from(arrayBuffer));
      return;
    }

    const relativeUrl = frontendRelativeLogoUrl(branding.rawLogoUrl);
    if (relativeUrl) {
      res.redirect(302, relativeUrl);
      return;
    }

    res.status(404).json({ error: "Organization logo is not a fetchable image." });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load branded icon." });
  }
});

export default router;
