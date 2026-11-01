import { Router } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { isFrontlineRepRole } from "../lib/roles.js";
import { randomUUID } from "node:crypto";
import { createShortLink } from "../lib/short-links.js";
import { RECEIPT_BUCKET, receiptPageUrl } from "./public-receipts.js";
import { silentFilterFor } from "../lib/product-launch.js";

// ── Order receipts (Bright's design, 20 Oct 2026) ───────────────────────────
// The receipt image is drawn in the browser from the order record; this route
// gives it the brand (name + logo from the organisation, tagline + help number
// set once by the Owner / an Admin) and the PRICE VERIFICATION: the amount
// recorded when the order was placed, any later changes (who, when, from, to)
// and, for orders placed after 20 Oct 2026, the price the order form showed.
// Nothing here can be edited by the person sending the receipt.

const router = Router();
router.use(requireAuth);

router.get("/branding", async (req, res) => {
  const { data, error } = await supabase.from("organizations").select("name, logo_url, receipt_tagline, receipt_help_phone").eq("id", req.user!.orgId).maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({
    name: data?.name ?? "Protohub",
    logoUrl: data?.logo_url ?? null,
    tagline: data?.receipt_tagline ?? "",
    helpPhone: data?.receipt_help_phone ?? "",
    canEdit: ["Owner", "Admin"].includes(req.user!.role)
  });
});

const BrandingSchema = z.object({
  tagline: z.string().trim().max(80).default(""),
  helpPhone: z.string().trim().max(30).regex(/^[0-9+()\s-]*$/, "Use digits, spaces, + or - only.").default("")
});

router.put("/branding", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = BrandingSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { error } = await supabase.from("organizations")
    .update({ receipt_tagline: parsed.data.tagline || null, receipt_help_phone: parsed.data.helpPhone || null })
    .eq("id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ ok: true, ...parsed.data });
});

const PRICE_FIELDS = new Set(["amount", "quantity", "package_id", "package_name", "cross_sell_lines", "additional_lines"]);
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

router.get("/:orderId/verification", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const { data: order, error } = await supabase.from("orders")
      .select("id, amount, original_amount, created_at, original_created_at, assigned_rep_id, form_context, source_cart_id, package_name, currency").neq("launch_stage", silentFilterFor(scopeOf(req).role))
      .eq("org_id", orgId).eq("id", String(req.params.orderId)).maybeSingle();
    if (error) throw error;
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }
    // A frontline rep sees receipts for her own orders only.
    const viewer = scopeOf(req);
    if (isFrontlineRepRole(viewer.role) && order.assigned_rep_id !== viewer.id) {
      res.status(403).json({ error: "This order is not assigned to you." }); return;
    }
    const { data: edits, error: editError } = await supabase.from("order_field_edits")
      .select("field_name, from_value, to_value, changed_by_name, created_at")
      .eq("org_id", orgId).eq("order_id", order.id).order("created_at", { ascending: true }).limit(200);
    if (editError) throw editError;

    const ctx = (order.form_context ?? {}) as Record<string, unknown>;
    const fromForm = typeof ctx.formVersion === "string" || typeof ctx.contextEvent === "string";
    const source = order.source_cart_id && !fromForm ? "cart" : fromForm ? "checkout" : "staff";
    const original = num(order.original_amount);
    const current = num(order.amount) ?? 0;
    const status = original === null ? "no_record" : Math.round(original) !== Math.round(current) ? "changed" : "original";
    const shownPrice = num(ctx.offerShownPrice);
    res.json({
      originalAmount: original ?? current,
      currentAmount: current,
      capturedAt: order.original_created_at ?? order.created_at,
      source,
      sourceLabel: source === "checkout" ? "Original checkout submission" : source === "cart" ? "Abandoned cart, sent automatically" : "Entered by staff",
      status,
      statusLabel: status === "original" ? "Original price recorded" : status === "changed" ? "Price changed after the order was placed" : "No original price on record",
      shownAtCheckout: shownPrice === null ? null : {
        packageName: String(ctx.offerShownPackage ?? order.package_name ?? ""),
        price: shownPrice,
        compareAt: num(ctx.offerShownCompareAt)
      },
      edits: (edits ?? []).filter((row: any) => PRICE_FIELDS.has(String(row.field_name))).map((row: any) => ({
        field: String(row.field_name), from: String(row.from_value ?? ""), to: String(row.to_value ?? ""), by: row.changed_by_name ?? "—", at: row.created_at
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not check the price." });
  }
});

// ── Receipt picture as a link (for the Android app) ─────────────────────────
// The Android app's WebView has no share sheet and cannot save files, so it
// uploads the PNG here and sends the customer a short link to it instead.
const ImageSchema = z.object({ png: z.string().startsWith("data:image/png;base64,").max(12_000_000) });

router.post("/:orderId/image", async (req, res) => {
  const parsed = ImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "The receipt picture could not be read. Try again." }); return; }
  try {
    const orgId = req.user!.orgId;
    const { data: order, error } = await supabase.from("orders").select("id, assigned_rep_id").neq("launch_stage", silentFilterFor(scopeOf(req).role))
      .eq("org_id", orgId).eq("id", String(req.params.orderId)).maybeSingle();
    if (error) throw error;
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }
    const viewer = scopeOf(req);
    if (isFrontlineRepRole(viewer.role) && order.assigned_rep_id !== viewer.id) {
      res.status(403).json({ error: "This order is not assigned to you." }); return;
    }
    const bytes = Buffer.from(parsed.data.png.slice("data:image/png;base64,".length), "base64");
    if (bytes.length < 1000) { res.status(400).json({ error: "The receipt picture is empty. Try again." }); return; }
    const id = randomUUID();
    const { error: uploadError } = await supabase.storage.from(RECEIPT_BUCKET).upload(`${id}.png`, bytes, { contentType: "image/png", upsert: false });
    if (uploadError) throw uploadError;
    const pageUrl = receiptPageUrl(id);
    res.json({ url: await createShortLink(orgId, pageUrl), pageUrl, imageUrl: `${pageUrl}/image.png` });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not upload the receipt picture." });
  }
});

export default router;
