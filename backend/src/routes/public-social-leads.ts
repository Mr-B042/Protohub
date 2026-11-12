import { Router } from "express";
import { logger } from "../lib/logger.js";
import { SocialLeadError, receiveManychat } from "../lib/social-leads.js";

/**
 * ManyChat posts here (External Request in a flow, Bright 12 Nov 2026). The
 * long secret in the address is the only key, so it is shown to the Owner /
 * Admin only and can be replaced in Settings.
 */
const router = Router();

router.post("/manychat/:secret", async (req, res) => {
  try {
    const result = await receiveManychat(String(req.params.secret), req.body, req.query as Record<string, unknown>);
    res.json(result);
  } catch (error: any) {
    if (error instanceof SocialLeadError) { res.status(error.status).json({ ok: false, error: error.message }); return; }
    logger.warn("manychat inbound failed", { error: error?.message ?? String(error) });
    res.status(500).json({ ok: false, error: "Could not save this event." });
  }
});

export default router;
