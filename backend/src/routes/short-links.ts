import { Router } from "express";
import { resolveShortLink } from "../lib/short-links.js";

// Public, unauthenticated redirector for short links (mounted at /r). A 302 keeps
// every tracking param (utm_*, fbclid, fbp, fbc) intact as the browser follows
// through to the full embed URL.
const router = Router();

router.get("/:code", async (req, res) => {
  const code = String(req.params.code || "").trim();
  if (!code) { res.status(404).send("Not found."); return; }
  try {
    const target = await resolveShortLink(code);
    if (!target) { res.status(404).send("This link has expired or is invalid."); return; }
    res.redirect(302, target);
  } catch {
    res.status(500).send("Could not open this link.");
  }
});

export default router;
