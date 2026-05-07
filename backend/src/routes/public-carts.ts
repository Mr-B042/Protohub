import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";

const router = Router();

// Per-IP rate limit. Public endpoint, abused-from-the-internet shape.
// 60 requests / minute is generous given the frontend already debounces
// to one POST per 1.5 s of typing (= max 40/min from a single tab).
const captureRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." }
});

const CaptureSchema = z.object({
  id:           z.string().min(1).max(80),
  customer:     z.string().max(120).optional(),
  phone:        z.string().min(1).max(40),
  whatsapp:     z.string().max(40).optional(),
  city:         z.string().max(80).optional(),
  state:        z.string().max(80).optional(),
  productId:    z.string().uuid(),  // required — the source of truth for org_id
  packageId:    z.string().uuid().optional(),
  productName:  z.string().min(1).max(160),
  packageName:  z.string().min(1).max(160),
  amount:       z.number().min(0).max(1_000_000_000),
  currency:     z.enum(["NGN", "USD", "GBP"]),
  source:       z.string().max(60).optional()
});

// ── POST /api/public/carts ────────────────────────────────
// Captures a partially-filled embed-form draft.
// Org context derives from the product's org. No authentication.
router.post("/", captureRateLimit, async (req, res) => {
  const parsed = CaptureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;

  // Derive org_id from the product. If the product doesn't exist, drop the
  // request — we won't accept orphan carts.
  const { data: product } = await supabase
    .from("products")
    .select("id, org_id")
    .eq("id", d.productId)
    .maybeSingle();

  if (!product) {
    res.status(404).json({ error: "Product not found." });
    return;
  }

  const row = {
    id:           d.id,
    org_id:       product.org_id,
    customer:     d.customer ?? "Partial lead",
    phone:        d.phone,
    whatsapp:     d.whatsapp ?? null,
    city:         d.city ?? null,
    state:        d.state ?? null,
    product_id:   d.productId,
    package_id:   d.packageId ?? null,
    product_name: d.productName,
    package_name: d.packageName,
    amount:       d.amount,
    currency:     d.currency,
    source:       d.source ?? "Website",
    last_activity: new Date().toISOString()
  };

  // If the row exists, only allow updates if it belongs to the same org
  // (i.e., the same product chain). Prevents cross-org id collisions.
  const { data: existing } = await supabase
    .from("abandoned_carts")
    .select("id, org_id, status")
    .eq("id", d.id)
    .maybeSingle();

  if (existing) {
    if (existing.org_id !== product.org_id) {
      res.status(409).json({ error: "Cart id collision." });
      return;
    }
    // Don't overwrite a Converted cart — submission already happened.
    if (existing.status === "Converted") {
      res.status(200).json({ id: d.id, ignored: true });
      return;
    }
    const { data, error } = await supabase
      .from("abandoned_carts")
      .update(row)
      .eq("id", d.id)
      .eq("org_id", product.org_id)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
    return;
  }

  const { data, error } = await supabase
    .from("abandoned_carts")
    .insert({ ...row, status: "Open abandoned" })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

export default router;
