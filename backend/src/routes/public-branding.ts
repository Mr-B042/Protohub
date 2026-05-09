import { Router } from "express";
import { supabase } from "../lib/supabase.js";

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

function resolveRedirectTarget(value: string): string | null {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/")) {
    const frontendUrl = process.env.FRONTEND_URL?.trim();
    if (!frontendUrl) return null;
    return `${frontendUrl.replace(/\/+$/, "")}${value}`;
  }
  return null;
}

router.get("/:orgId/logo", async (req, res) => {
  const orgId = String(req.params.orgId ?? "").trim();
  if (!orgId) {
    res.status(400).json({ error: "orgId is required." });
    return;
  }

  const { data, error } = await supabase
    .from("organizations")
    .select("logo_url")
    .eq("id", orgId)
    .single();

  if (error || !data) {
    res.status(404).json({ error: "Organization not found." });
    return;
  }

  const raw = typeof data.logo_url === "string" ? data.logo_url.trim() : "";
  if (!raw) {
    res.status(404).json({ error: "Organization logo not found." });
    return;
  }

  const dataUrl = parseDataUrlImage(raw);
  if (dataUrl) {
    res.set("Content-Type", dataUrl.contentType);
    res.set("Cache-Control", "public, max-age=300");
    res.send(dataUrl.buffer);
    return;
  }

  const redirectTarget = resolveRedirectTarget(raw);
  if (redirectTarget) {
    res.redirect(302, redirectTarget);
    return;
  }

  res.status(404).json({ error: "Organization logo is not a fetchable image." });
});

export default router;
