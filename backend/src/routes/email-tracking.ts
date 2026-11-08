import { Router } from "express";
import { logger } from "../lib/logger.js";
import { recordClick, recordOpen, unsubscribeToken } from "../lib/email-marketing.js";

/**
 * The links inside campaign emails (Email Marketing, Bright 8 Nov 2026).
 * Public, no sign-in: the random token in the link is the only key.
 *   /e/o/<token>.gif      the invisible picture that counts an open
 *   /e/c/<token>/<n>      counts a click, then opens the real page
 *   /e/u/<token>          unsubscribe (a page with a button; mail apps'
 *                         own Unsubscribe button POSTs straight here)
 */
const router = Router();

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const TOKEN = /^[A-Za-z0-9_-]{16,40}$/;

const page = (title: string, body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#F4F2FB;color:#1F2937}main{max-width:440px;margin:12vh auto;background:#fff;border-radius:16px;padding:32px 28px;text-align:center;box-shadow:0 2px 10px rgba(16,24,40,.08)}h1{font-size:22px;margin:0 0 10px}p{font-size:15px;line-height:1.5;color:#4B5563;margin:0 0 18px}button{border:0;border-radius:10px;background:#5B3FD9;color:#fff;font-size:16px;font-weight:700;padding:13px 26px;cursor:pointer}</style></head>
<body><main>${body}</main></body></html>`;

router.get("/o/:file", (req, res) => {
  const token = String(req.params.file ?? "").replace(/\.gif$/i, "");
  res.set({ "Content-Type": "image/gif", "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache" });
  res.end(PIXEL);
  if (TOKEN.test(token)) void recordOpen(token).catch((error) => logger.warn("email open record failed", { error: (error as Error).message }));
});

router.get("/c/:token/:index", async (req, res) => {
  const token = String(req.params.token ?? "");
  const index = Number(req.params.index);
  if (!TOKEN.test(token) || !Number.isInteger(index) || index < 0 || index > 200) { res.status(404).send(page("Link not found", "<h1>Link not found</h1><p>This link is not valid any more.</p>")); return; }
  try {
    const url = await recordClick(token, index);
    if (!url) { res.status(404).send(page("Link not found", "<h1>Link not found</h1><p>This link is not valid any more.</p>")); return; }
    res.redirect(302, url);
  } catch (error) {
    logger.warn("email click record failed", { error: (error as Error).message });
    res.status(500).send(page("Something went wrong", "<h1>Something went wrong</h1><p>Please try the link again in a minute.</p>"));
  }
});

router.get("/u/:token", (req, res) => {
  const token = String(req.params.token ?? "");
  if (token === "test") { res.send(page("Test email", "<h1>This was a test email</h1><p>Unsubscribe works in real campaign emails. Nothing was changed.</p>")); return; }
  if (!TOKEN.test(token)) { res.status(404).send(page("Link not found", "<h1>Link not found</h1><p>This link is not valid any more.</p>")); return; }
  // A button, not an instant unsubscribe: email security scanners open every
  // link in an email, and would otherwise unsubscribe people who never asked.
  res.send(page("Unsubscribe", `<h1>Stop these emails?</h1><p>Tap the button and we will not send you offers by email again.</p><form method="post"><button type="submit">Unsubscribe</button></form>`));
});

router.post("/u/:token", async (req, res) => {
  const token = String(req.params.token ?? "");
  if (!TOKEN.test(token)) { res.status(404).send(page("Link not found", "<h1>Link not found</h1><p>This link is not valid any more.</p>")); return; }
  try {
    const result = await unsubscribeToken(token);
    if (!result) { res.status(404).send(page("Link not found", "<h1>Link not found</h1><p>This link is not valid any more.</p>")); return; }
    res.send(page("Unsubscribed", "<h1>You are unsubscribed</h1><p>We will not email you offers again. Your orders are not affected.</p>"));
  } catch (error) {
    logger.warn("email unsubscribe failed", { error: (error as Error).message });
    res.status(500).send(page("Something went wrong", "<h1>Something went wrong</h1><p>Please try again in a minute.</p>"));
  }
});

export default router;
