// Public order-create endpoint for the embed form.
//
// Why a separate route?
//   - /api/orders is gated by requireAuth (admin/sales rep flows).
//   - The embed form is hit by unauthenticated customers.
//
// Trust model: the client sends form data + packageId + cross-sell line ids,
// but the server NEVER trusts the client's `amount`. We recompute it from
// canonical pricing tables (product_packages.price + cross-sell rules).
//
// Org context derives from the package's product (same pattern as public-carts).

import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";
import { notifyOrderEvent } from "../lib/order-notifications.js";
import { readSettings } from "./embed-settings.js";
import {
  sendNewOrderEmail,
  sendInternalNewOrderEmail,
  sendOrderAssignedEmail
} from "../lib/mailer.js";
import { sendNewOrderSms } from "../lib/sms.js";

const router = Router();

// Per-IP rate limit. The embed form is internet-facing.
const submitRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions. Please try again shortly." }
});

const CrossSellLineSchema = z.object({
  productId: z.string().uuid(),
  quantity:  z.number().int().min(1).max(50)
});

const PublicOrderSchema = z.object({
  id:           z.string().min(1).max(50).regex(/^[A-Za-z0-9\-_]+$/).optional(),
  cartId:       z.string().min(1).max(80).regex(/^[A-Za-z0-9\-_]+$/).optional(),
  customer:     z.string().min(1).max(120),
  phone:        z.string().min(1).max(40),
  whatsapp:     z.string().max(40).optional(),
  email:        z.string().email().max(254).optional().or(z.literal("")),
  address:      z.string().max(500).optional(),
  city:         z.string().max(80).optional(),
  state:        z.string().max(80).optional(),
  packageId:    z.string().uuid(),
  crossSellLines:  z.array(CrossSellLineSchema).max(20).optional(),
  utmSource:    z.string().max(80).optional(),
  utmCampaign:  z.string().max(120).optional(),
  utmMedium:    z.string().max(80).optional(),
  utmContent:   z.string().max(160).optional(),
  utmTerm:      z.string().max(160).optional(),
  referrer:     z.string().max(2048).optional(),
  confirmationChecked: z.boolean().optional(),
  preferredDelivery:   z.string().max(80).optional(),
  // Honeypot — must be empty. Bots tend to fill every field they see.
  company:      z.string().max(0).optional()
});

type CompanionOverride = {
  productId: string;
  quantity: number;
  pricingMode: "standard" | "fixed" | "free";
  fixedPrice?: number;
  stateRestrictions?: string[];
  autoInclude?: boolean;
};

const ALLOWED_SOURCES = ["TikTok", "Facebook", "WhatsApp", "Website", "Direct"] as const;
function sourceFromUtm(utm: string | undefined): typeof ALLOWED_SOURCES[number] {
  const s = (utm ?? "").toLowerCase();
  if (s.includes("tiktok"))   return "TikTok";
  if (s.includes("facebook") || s.includes("fb")) return "Facebook";
  if (s.includes("whatsapp") || s.includes("wa")) return "WhatsApp";
  if (s.includes("direct"))   return "Direct";
  return "Website";
}

router.post("/", submitRateLimit, async (req, res) => {
  const parsed = PublicOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  if (parsed.data.company) {
    // Honeypot tripped. Pretend success so the bot doesn't retry.
    logger.warn("public-orders: honeypot tripped", { ip: req.ip });
    res.status(201).json({ id: parsed.data.id ?? null, ignored: true });
    return;
  }
  const d = parsed.data;

  // 1. Resolve package → product → org
  const { data: pkg, error: pkgErr } = await supabase
    .from("product_packages")
    .select("id, product_id, name, price, currency, quantity, companion_products, active")
    .eq("id", d.packageId)
    .maybeSingle();
  if (pkgErr || !pkg || !pkg.active) {
    res.status(404).json({ error: "Package not available." });
    return;
  }

  const { data: product, error: productErr } = await supabase
    .from("products")
    .select("id, org_id, name, active, cross_sell_product_ids, cross_sell_price_overrides, cross_sell_state_restrictions")
    .eq("id", pkg.product_id)
    .maybeSingle();
  if (productErr || !product || !product.active) {
    res.status(404).json({ error: "Product not available." });
    return;
  }

  // Block flagged customers. customer_flags.phone stores digits only.
  const normalizedPhone = d.phone.replace(/\D/g, "");
  const { data: flagged } = await supabase
    .from("customer_flags")
    .select("id")
    .eq("org_id", product.org_id)
    .eq("phone", normalizedPhone)
    .maybeSingle();
  if (flagged) {
    logger.warn("public-orders: flagged customer blocked", { ip: req.ip });
    res.status(403).json({ error: "Order cannot be placed." });
    return;
  }

  const embedSettings = await readSettings(product.org_id);
  const publicOrderAssignmentMode =
    embedSettings.public_order_assignment_mode === "manual_review"
      ? "manual_review"
      : "auto_assign";

  // 2. Recompute amount server-side. Never trust client amount.
  let amount = Number(pkg.price ?? 0);

  const lines = d.crossSellLines ?? [];
  const allowedCrossSellIds: string[] = Array.isArray(product.cross_sell_product_ids)
    ? product.cross_sell_product_ids
    : [];
  const crossSellOverrides: Record<string, number> =
    (product.cross_sell_price_overrides as Record<string, number> | null) ?? {};
  const crossSellStateRestrictions: Record<string, string[]> =
    (product.cross_sell_state_restrictions as Record<string, string[]> | null) ?? {};
  const companions: CompanionOverride[] = Array.isArray(pkg.companion_products)
    ? (pkg.companion_products as CompanionOverride[])
    : [];

  type ResolvedLine = { productId: string; productName: string; quantity: number; amount: number };
  const resolved: ResolvedLine[] = [];

  // Look up all related product names + primary pricings in one go
  const xsProductIds = Array.from(new Set(lines.map((l) => l.productId)));
  const xsProducts = xsProductIds.length
    ? (await supabase.from("products").select("id, name, org_id, active").in("id", xsProductIds)).data ?? []
    : [];
  const xsPricings = xsProductIds.length
    ? (await supabase.from("product_pricings").select("product_id, currency, selling_price, is_primary").in("product_id", xsProductIds)).data ?? []
    : [];

  for (const line of lines) {
    const xsProduct = xsProducts.find((p) => p.id === line.productId);
    if (!xsProduct || !xsProduct.active || xsProduct.org_id !== product.org_id) {
      // Silently drop unknown / cross-org / inactive cross-sells
      continue;
    }
    const companion = companions.find((c) =>
      c.productId === line.productId
      && (!c.stateRestrictions?.length || (d.state && c.stateRestrictions.includes(d.state)))
    );
    let unitPrice = 0;
    if (companion) {
      if (companion.pricingMode === "free")        unitPrice = 0;
      else if (companion.pricingMode === "fixed")  unitPrice = Number(companion.fixedPrice ?? 0);
      else {
        const primary = xsPricings.find((p) => p.product_id === line.productId && p.is_primary)
                     ?? xsPricings.find((p) => p.product_id === line.productId);
        unitPrice = Number(primary?.selling_price ?? 0);
      }
    } else {
      // Standard cross-sell — must be in product.cross_sell_product_ids and pass state restriction
      if (!allowedCrossSellIds.includes(line.productId)) continue;
      const restriction = crossSellStateRestrictions[line.productId];
      if (restriction?.length && d.state && !restriction.includes(d.state)) continue;
      const override = crossSellOverrides[line.productId];
      if (override !== undefined) {
        unitPrice = Number(override);
      } else {
        const primary = xsPricings.find((p) => p.product_id === line.productId && p.is_primary)
                     ?? xsPricings.find((p) => p.product_id === line.productId);
        unitPrice = Number(primary?.selling_price ?? 0);
      }
    }
    const lineTotal = unitPrice * line.quantity;
    amount += lineTotal;
    resolved.push({
      productId:   line.productId,
      productName: xsProduct.name,
      quantity:    line.quantity,
      amount:      lineTotal
    });
  }

  // Auto-include companions (silent bundles) — append even if client didn't list them.
  // Batch-fetch all auto-include companion products + pricings up front to avoid N+1.
  const autoCompanions = companions.filter(
    (c) => c.autoInclude
      && !resolved.some((r) => r.productId === c.productId)
      && (!c.stateRestrictions?.length || (d.state && c.stateRestrictions.includes(d.state)))
  );
  const autoIds = Array.from(new Set(autoCompanions.map((c) => c.productId)));
  const autoProducts = autoIds.length
    ? (await supabase.from("products").select("id, name, org_id, active").in("id", autoIds)).data ?? []
    : [];
  const autoPricings = autoIds.length
    ? (await supabase.from("product_pricings").select("product_id, selling_price, is_primary").in("product_id", autoIds)).data ?? []
    : [];

  for (const c of autoCompanions) {
    const autoProduct = autoProducts.find((p) => p.id === c.productId);
    if (!autoProduct || !autoProduct.active || autoProduct.org_id !== product.org_id) continue;
    let unitPrice = 0;
    if (c.pricingMode === "free")        unitPrice = 0;
    else if (c.pricingMode === "fixed")  unitPrice = Number(c.fixedPrice ?? 0);
    else {
      const primary = autoPricings.find((p) => p.product_id === c.productId && p.is_primary)
                   ?? autoPricings.find((p) => p.product_id === c.productId);
      unitPrice = Number(primary?.selling_price ?? 0);
    }
    const lineTotal = unitPrice * c.quantity;
    amount += lineTotal;
    resolved.push({ productId: c.productId, productName: autoProduct.name, quantity: c.quantity, amount: lineTotal });
  }

  let assignedRepId: string | null = null;

  if (publicOrderAssignmentMode === "auto_assign") {
    // Round-robin assign to the sales rep with the lowest position, then
    // advance that rep to max+1 so the next order goes to the next rep.
    const { data: reps } = await supabase
      .from("users")
      .select("id, round_robin_position")
      .eq("org_id", product.org_id)
      .eq("active", true)
      .eq("role", "Sales Rep")
      .order("round_robin_position", { ascending: true, nullsFirst: false });

    const rep = (reps ?? [])[0] ?? null;
    assignedRepId = rep?.id ?? null;

    if (rep) {
      const maxPos = (reps ?? []).reduce((m, r) => Math.max(m, r.round_robin_position ?? 0), 0);
      supabase.from("users")
        .update({ round_robin_position: maxPos + 1 })
        .eq("id", rep.id)
        .then(() => {});  // fire-and-forget
    }
  }

  const source = sourceFromUtm(d.utmSource);
  const location = [d.city, d.state].filter(Boolean).join(", ") || null;

  // 4. Insert order
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      ...(d.id ? { id: d.id } : {}),
      org_id:            product.org_id,
      customer:          d.customer,
      phone:             d.phone,
      whatsapp:          d.whatsapp ?? null,
      email:             d.email || null,
      address:           d.address ?? null,
      city:              d.city ?? null,
      state:             d.state ?? null,
      product_id:        product.id,
      package_id:        pkg.id,
      product_name:      product.name,
      package_name:      pkg.name,
      quantity:          pkg.quantity,
      amount,
      currency:          pkg.currency,
      source,
      location,
      assigned_rep_id:   assignedRepId,
      utm_source:        d.utmSource ?? null,
      utm_campaign:      d.utmCampaign ?? null,
      utm_medium:        d.utmMedium ?? null,
      utm_content:       d.utmContent ?? null,
      utm_term:          d.utmTerm ?? null,
      referrer:          d.referrer ?? null,
      confirmation_checked: d.confirmationChecked ?? null,
      preferred_delivery:   d.preferredDelivery ?? null,
      status:            "New"
    })
    .select()
    .single();

  if (orderErr) {
    if (orderErr.code === "23505") {
      res.status(409).json({ error: "Duplicate order id." });
      return;
    }
    logger.error("public-orders: insert failed", { error: orderErr.message });
    res.status(500).json({ error: "Could not record order." });
    return;
  }

  // 5. Mark linked abandoned cart as Converted (best-effort).
  if (d.cartId) {
    await supabase
      .from("abandoned_carts")
      .update({ status: "Converted", last_activity: new Date().toISOString() })
      .eq("id", d.cartId)
      .eq("org_id", product.org_id);
  }

  // 6. Audit, in-app notification, emails (fire-and-forget).
  await supabase.from("order_audit").insert({
    order_id:    order.id,
    org_id:      product.org_id,
    changed_by:  null,
    from_status: null,
    to_status:   "New",
    note:        publicOrderAssignmentMode === "manual_review"
      ? "Order created from public embed form and is awaiting owner/admin assignment"
      : "Order created from public embed form and auto-assigned by round-robin"
  });

  await notifyOrderEvent(product.org_id, {
    id: order.id, customer: order.customer, productName: order.product_name, packageName: order.package_name,
    assignedRepId: order.assigned_rep_id
  }, "New");

  sendNewOrderEmail(product.org_id, {
    id: order.id, customer: order.customer, email: order.email,
    phone: order.phone, product_name: order.product_name, package_name: order.package_name,
    amount: order.amount, currency: order.currency, source: order.source
  });
  sendNewOrderSms(product.org_id, {
    id: order.id,
    customer: order.customer,
    phone: order.phone,
    assignedRepId: order.assigned_rep_id,
    product_name: order.product_name,
    package_name: order.package_name,
    amount: order.amount,
    currency: order.currency
  });

  sendInternalNewOrderEmail(product.org_id, {
    id: order.id, customer: order.customer, phone: order.phone,
    product_name: order.product_name, package_name: order.package_name, amount: order.amount,
    currency: order.currency,
    source: order.source,
    rep_name: publicOrderAssignmentMode === "manual_review"
      ? "Awaiting owner/admin assignment"
      : "Auto-assigned from public form"
  });

  if (assignedRepId) {
    sendOrderAssignedEmail(product.org_id, assignedRepId, {
      id: order.id, customer: order.customer, phone: order.phone,
      product_name: order.product_name, package_name: order.package_name, amount: order.amount,
      currency: order.currency, source: order.source
    });
  }

  res.status(201).json({
    id:       order.id,
    amount:   order.amount,
    currency: order.currency,
    crossSellLines: resolved
  });
});

export default router;
