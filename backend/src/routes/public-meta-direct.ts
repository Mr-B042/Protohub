import express, { Router } from "express";
import { logger } from "../lib/logger.js";
import { SocialLeadError } from "../lib/social-leads.js";
import { connectCallback, receiveMeta, verifyWebhook } from "../lib/meta-direct.js";

/**
 * Direct Meta (Social Leads, 13 Nov 2026). Mounted BEFORE express.json so the
 * exact bytes Meta signed can be checked (X-Hub-Signature-256).
 *   GET  /connect/callback   Facebook login comes back here
 *   GET  /:secret            Meta's one-time address check (hub.challenge)
 *   POST /:secret            comments + messages
 */
const router = Router();

router.get("/connect/callback", async (req, res) => {
  try {
    res.redirect(302, await connectCallback(req.query as Record<string, unknown>));
  } catch (error: any) {
    logger.warn("meta connect callback failed", { error: error?.message ?? String(error) });
    res.status(500).send("Could not finish connecting. Go back to Protohub and try again.");
  }
});

router.get("/:secret", async (req, res) => {
  try {
    const challenge = await verifyWebhook(String(req.params.secret), req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
    if (challenge === null) { res.status(403).send("Verify token does not match."); return; }
    res.type("text/plain").send(challenge);
  } catch {
    res.status(500).send("Could not check.");
  }
});

router.post("/:secret", express.raw({ type: "*/*", limit: "2mb" }), async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    const result = await receiveMeta(String(req.params.secret), raw, req.get("x-hub-signature-256") ?? undefined);
    res.json(result);
  } catch (error: any) {
    if (error instanceof SocialLeadError) { res.status(error.status).json({ ok: false, error: error.message }); return; }
    logger.warn("meta inbound failed", { error: error?.message ?? String(error) });
    // 200 would make Meta drop it; 500 makes Meta retry later.
    res.status(500).json({ ok: false });
  }
});

export default router;
