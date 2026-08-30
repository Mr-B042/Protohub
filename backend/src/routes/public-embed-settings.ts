import { Router } from "express";
import rateLimit from "express-rate-limit";
import { readSettings } from "./embed-settings.js";

const router = Router();

// 60 reads/minute per IP. Customer embed forms call this on load — generous
// enough for legitimate traffic, blocks abusive scrapers.
const readRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." }
});

// GET /api/public/embed-settings/:orgId — unauthenticated, used by the
// customer-facing public embed form to know which fields to render.
router.get("/:orgId", readRateLimit, async (req, res) => {
  try {
    const settings = await readSettings(req.params.orgId as string);
    // Same window as public-products: these two are fetched together by the
    // order form, so caching them differently would leave the page showing a
    // new price with old branding, or the reverse.
    res.setHeader("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=120");
    res.json(settings);
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "Failed to load embed settings." });
  }
});

export default router;
