import { Router } from "express";
import { supabase } from "../lib/supabase.js";

// ── Receipt picture links (no sign-in) ──────────────────────────────────────
// /api/public/receipts/<id>            a small page showing the picture, with
//                                      a Download button and a WhatsApp preview
// /api/public/receipts/<id>/image.png  the picture itself (?download=1 saves it)
// The id is a random UUID made at upload (order-receipts.ts), so a link cannot
// be guessed from an order number.

export const RECEIPT_BUCKET = "order-receipts";
const PUBLIC_BACKEND_URL = (process.env.PUBLIC_BACKEND_URL || "https://protohub-production.up.railway.app").replace(/\/+$/, "");
export const receiptPageUrl = (id: string) => `${PUBLIC_BACKEND_URL}/api/public/receipts/${id}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();

router.get("/:id/image.png", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID.test(id)) { res.status(404).end(); return; }
  const { data, error } = await supabase.storage.from(RECEIPT_BUCKET).download(`${id}.png`);
  if (error || !data) { res.status(404).send("This receipt is no longer available."); return; }
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.query.download) res.setHeader("Content-Disposition", `attachment; filename="order-receipt-${id.slice(0, 8)}.png"`);
  res.send(Buffer.from(await data.arrayBuffer()));
});

router.get("/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID.test(id)) { res.status(404).end(); return; }
  const image = `${receiptPageUrl(id)}/image.png`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("X-Robots-Tag", "noindex");
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your order receipt</title><meta name="robots" content="noindex">
<meta property="og:title" content="Your order receipt"><meta property="og:description" content="Tap to view or save your receipt.">
<meta property="og:image" content="${image}"><meta property="og:image:type" content="image/png"><meta name="twitter:card" content="summary_large_image">
<style>body{margin:0;background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a}
main{max-width:560px;margin:0 auto;padding:16px}img{display:block;width:100%;height:auto;border-radius:14px;box-shadow:0 6px 20px rgba(15,23,42,.12);background:#fff}
a.btn{display:block;margin:16px 0 8px;padding:14px;border-radius:12px;background:#16a34a;color:#fff;text-align:center;font-weight:700;text-decoration:none;font-size:16px}
p{text-align:center;color:#64748b;font-size:13px;margin:6px 0}</style></head>
<body><main><img src="${image}" alt="Order receipt"><a class="btn" href="${image}?download=1" download>Download receipt</a><p>Or press and hold the picture to save it.</p></main></body></html>`);
});

export default router;
