import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";
import { REPORT_ROW_CEILING } from "../lib/query-limits.js";
import { notifyOrderEvent } from "../lib/order-notifications.js";
import { sendNewOrderEmail } from "../lib/mailer.js";
import { sendNewOrderSms } from "../lib/sms.js";
import { sendOrderNewCustomerWhatsApp, sendOrderNewRepWhatsApp } from "../lib/whatsapp.js";
import { closeHeldCarts, handOutHeldCarts } from "../lib/cart-assignment.js";
import {
  LAUNCH_STAGE_LABEL, isAllowedSwitch, isLaunchStage, launchSettingsOf, switchRevealsOrders,
  type LaunchSettings, type LaunchStage
} from "../lib/product-launch.js";

/**
 * Product Launch page (Bright, 1 Nov 2026) - Owner only. Lists every product
 * with its stage, the test orders so far, and the history of switches; moves a
 * product between Silent Test, Soft Launch and Live. See lib/product-launch.ts.
 */
const router = Router();
router.use(requireAuth, requireRole("Owner"));

const ORDER_FIELDS = "id, product_id, launch_stage, status, assigned_rep_id, created_at, revealed_at, delivered_date, amount, quantity";

// ── GET / ── every product, its stage, its test orders, its history ─────────
router.get("/", async (req, res) => {
  const orgId = req.user!.orgId;
  const [products, orders, reps, events] = await Promise.all([
    supabase.from("products").select("id, name, sku, active, image_url, launch_stage, launch_settings").eq("org_id", orgId).order("name"),
    supabase.from("orders").select(ORDER_FIELDS).eq("org_id", orgId).neq("launch_stage", "live").limit(REPORT_ROW_CEILING),
    supabase.from("users").select("id, name, role, active").eq("org_id", orgId).in("role", ["Sales Rep", "Sales Closer", "Recovery Rep", "Admin", "Manager", "Owner"]),
    supabase.from("product_launch_events").select("id, product_id, from_stage, to_stage, orders_revealed, ended_with, orders_cancelled, carts_handed_out, carts_closed, note, changed_by_name, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200)
  ]);
  const failed = products.error ?? orders.error ?? reps.error ?? events.error;
  if (failed) { res.status(500).json({ error: failed.message }); return; }

  // Abandoned carts of every product that has been tested, since its first switch.
  const testStart = new Map<string, string>();
  for (const event of events.data ?? []) {
    const at = String((event as any).created_at);
    const current = testStart.get((event as any).product_id);
    if (!current || at < current) testStart.set((event as any).product_id, at);
  }
  for (const product of products.data ?? []) {
    if ((product as any).launch_stage !== "live" && !testStart.has((product as any).id)) testStart.set((product as any).id, "1970-01-01T00:00:00Z");
  }
  const testedIds = [...testStart.keys()];
  const earliest = [...testStart.values()].sort()[0];
  const { data: cartRows, error: cartError } = testedIds.length === 0 ? { data: [] as any[], error: null } : await supabase.from("abandoned_carts")
    .select("id, product_id, status, assigned_rep_id, created_at")
    .eq("org_id", orgId).in("product_id", testedIds).is("merged_into", null).gte("created_at", earliest).limit(REPORT_ROW_CEILING);
  if (cartError) { res.status(500).json({ error: cartError.message }); return; }

  const repName = new Map((reps.data ?? []).map((user: any) => [String(user.id), String(user.name ?? "")]));
  res.json({
    products: (products.data ?? []).map((product: any) => ({
      id: product.id,
      name: product.name,
      sku: product.sku ?? null,
      active: product.active !== false,
      imageUrl: product.image_url ?? null,
      stage: isLaunchStage(product.launch_stage) ? product.launch_stage : "live",
      settings: launchSettingsOf(product.launch_settings)
    })),
    orders: (orders.data ?? []).map((order: any) => ({
      id: String(order.id),
      productId: order.product_id,
      stage: order.launch_stage,
      status: order.status ?? "New",
      repId: order.assigned_rep_id ?? null,
      repName: order.assigned_rep_id ? repName.get(String(order.assigned_rep_id)) ?? "Unknown" : null,
      createdAt: order.created_at,
      revealedAt: order.revealed_at ?? null,
      deliveredDate: order.delivered_date ?? null,
      amount: Number(order.amount ?? 0),
      quantity: Number(order.quantity ?? 1)
    })),
    carts: (cartRows ?? [])
      .filter((cart: any) => String(cart.created_at) >= (testStart.get(cart.product_id) ?? ""))
      .map((cart: any) => ({
        id: String(cart.id),
        productId: cart.product_id,
        status: String(cart.status ?? "Open abandoned"),
        repId: cart.assigned_rep_id ?? null,
        repName: cart.assigned_rep_id ? repName.get(String(cart.assigned_rep_id)) ?? "Unknown" : null,
        createdAt: cart.created_at
      })),
    events: (events.data ?? []).map((event: any) => ({
      id: event.id,
      productId: event.product_id,
      from: event.from_stage,
      to: event.to_stage,
      ordersRevealed: event.orders_revealed ?? 0,
      endedWith: event.ended_with ?? null,
      ordersCancelled: event.orders_cancelled ?? 0,
      cartsHandedOut: event.carts_handed_out ?? 0,
      cartsClosed: event.carts_closed ?? 0,
      note: event.note ?? null,
      by: event.changed_by_name ?? null,
      at: event.created_at
    }))
  });
});

// ── PUT /:productId/stage ── switch a product's stage ───────────────────────
const StageSchema = z.object({
  stage: z.enum(["live", "silent", "soft"]),
  note: z.string().trim().max(500).optional()
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Tell everyone about orders that have just appeared, one order at a time and
 * a few seconds apart: WhatsApp goes out straight away, and a burst of fifty
 * messages from one number in a second invites a ban.
 */
async function announceRevealedOrders(orgId: string, orders: any[], settings: LaunchSettings) {
  const repPhones = new Map<string, { name: string; phone: string } | null>();
  for (const order of orders) {
    try {
      if (settings.revealRepAlerts) {
        await notifyOrderEvent(orgId, {
          id: order.id, customer: order.customer, phone: order.phone, amount: order.amount, currency: order.currency,
          productName: order.product_name, packageName: order.package_name, assignedRepId: order.assigned_rep_id,
          launchStage: "soft"
        }, "New");
      }
      const waPayload = {
        id: order.id,
        productId: order.product_id ?? null,
        customer: order.customer,
        phone: order.phone,
        whatsapp: order.whatsapp ?? null,
        productName: order.product_name,
        packageName: order.package_name,
        quantity: typeof order.quantity === "number" ? order.quantity : null,
        amount: Number(order.amount ?? 0),
        currency: order.currency ?? "NGN",
        source: order.source ?? null,
        city: order.city ?? null,
        state: order.state ?? null,
        crossSellLines: Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : null,
        packageComponentsSnapshot: Array.isArray(order.package_components_snapshot) ? order.package_components_snapshot : null,
        productImageUrl: null as string | null,
        productVideoUrl: null as string | null
      };
      if (settings.revealRepAlerts && order.assigned_rep_id) {
        if (!repPhones.has(order.assigned_rep_id)) {
          const { data } = await supabase.from("users").select("name, phone").eq("id", order.assigned_rep_id).maybeSingle();
          repPhones.set(order.assigned_rep_id, (data as any)?.phone ? { name: (data as any).name ?? "Rep", phone: (data as any).phone } : null);
        }
        const rep = repPhones.get(order.assigned_rep_id);
        if (rep) await sendOrderNewRepWhatsApp(orgId, waPayload, rep);
      }
      // The customer heard nothing during Silent Test (unless its settings
      // said so); they get their confirmation now.
      if (settings.revealCustomerMessages && !settings.silentCustomerMessages) {
        await sendOrderNewCustomerWhatsApp(orgId, waPayload);
        sendNewOrderSms(orgId, {
          id: order.id, customer: order.customer, phone: order.phone, assignedRepId: order.assigned_rep_id,
          product_name: order.product_name, package_name: order.package_name, package_id: order.package_id,
          amount: order.amount, currency: order.currency, quantity: order.quantity, cross_sell_lines: order.cross_sell_lines
        });
        sendNewOrderEmail(orgId, {
          id: order.id, customer: order.customer, email: order.email, phone: order.phone,
          product_name: order.product_name, package_name: order.package_name, amount: order.amount,
          currency: order.currency, source: order.source,
          cross_sell_lines: Array.isArray(order.cross_sell_lines) ? order.cross_sell_lines : null
        });
      }
    } catch (error) {
      logger.warn("product-launch: announcing a revealed order failed", { orderId: order.id, error: (error as Error).message });
    }
    await pause(4000);
  }
}

const REVEAL_FIELDS = "id, customer, phone, whatsapp, email, amount, currency, product_id, product_name, package_id, package_name, quantity, assigned_rep_id, cross_sell_lines, package_components_snapshot, source, city, state, status";

/**
 * Every hidden order of a product appears for its rep now. They stay marked as
 * test orders (Soft Launch), so the weekly report keeps them out of the
 * delivery rate even after the product goes Live or the test ends.
 */
async function revealSilentOrders(orgId: string, productId: string) {
  const now = new Date().toISOString();
  return supabase.from("orders")
    .update({ launch_stage: "soft", revealed_at: now, updated_at: now })
    .eq("org_id", orgId).eq("product_id", productId).eq("launch_stage", "silent")
    .select(REVEAL_FIELDS);
}

/**
 * Hand out a test's held carts in the background (each one alerts its rep),
 * then record how many went out on the history row.
 */
function handOutHeldCartsLater(orgId: string, productId: string, sinceIso: string, eventId: string | null) {
  void handOutHeldCarts(orgId, productId, sinceIso)
    .then(async (count) => {
      if (eventId && count > 0) await supabase.from("product_launch_events").update({ carts_handed_out: count }).eq("id", eventId);
    })
    .catch((error) => logger.warn("product-launch: handing out held carts failed", { productId, error: (error as Error).message }));
}

/** When the product last went into Silent Test: held carts are the ones since then. */
async function silentSince(orgId: string, productId: string): Promise<string> {
  const { data } = await supabase.from("product_launch_events").select("created_at")
    .eq("org_id", orgId).eq("product_id", productId).eq("to_stage", "silent")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  // No record of the start (should not happen): fall back to the regular 48 hours.
  return (data as any)?.created_at ?? new Date(Date.now() - 48 * 3600_000).toISOString();
}

const stillOpen = (order: any) => !["Delivered", "Failed", "Cancelled"].includes(String(order.status ?? "New"));

router.put("/:productId/stage", async (req, res) => {
  const parsed = StageSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId;
  const { data: product, error: productError } = await supabase.from("products")
    .select("id, name, launch_stage, launch_settings").eq("org_id", orgId).eq("id", req.params.productId).maybeSingle();
  if (productError) { res.status(500).json({ error: productError.message }); return; }
  if (!product) { res.status(404).json({ error: "That product does not exist here." }); return; }

  const from: LaunchStage = isLaunchStage((product as any).launch_stage) ? (product as any).launch_stage : "live";
  const to = parsed.data.stage as LaunchStage;
  if (!isAllowedSwitch(from, to)) { res.status(409).json({ error: `${product.name} is already in ${LAUNCH_STAGE_LABEL[to]}.` }); return; }
  const settings = launchSettingsOf((product as any).launch_settings);

  const { error: updateError } = await supabase.from("products").update({ launch_stage: to }).eq("org_id", orgId).eq("id", product.id);
  if (updateError) { res.status(500).json({ error: updateError.message }); return; }

  // Leaving Silent Test: every hidden order appears for its rep now. They stay
  // marked as test orders (Soft Launch), so the weekly report keeps them out of
  // the delivery rate even if the product goes straight to Live.
  let revealed: any[] = [];
  if (switchRevealsOrders(from, to)) {
    const { data, error } = await revealSilentOrders(orgId, product.id);
    if (error) {
      // Put the product back so it never sits in a stage its orders are not in.
      await supabase.from("products").update({ launch_stage: from }).eq("org_id", orgId).eq("id", product.id);
      res.status(500).json({ error: error.message });
      return;
    }
    revealed = data ?? [];
  }

  const { data: eventRow, error: eventError } = await supabase.from("product_launch_events").insert({
    org_id: orgId, product_id: product.id, from_stage: from, to_stage: to,
    orders_revealed: revealed.length, note: parsed.data.note ?? null,
    changed_by: req.user!.id, changed_by_name: req.user!.name ?? null
  }).select("id").maybeSingle();
  if (eventError) logger.warn("product-launch: history row failed", { productId: product.id, error: eventError.message });

  res.json({ productId: product.id, from, to, revealed: revealed.length });

  // Leaving Silent Test: the carts it held back go out to reps now, whatever their age.
  if (switchRevealsOrders(from, to) && settings.silentHoldCarts) handOutHeldCartsLater(orgId, product.id, await silentSince(orgId, product.id), (eventRow as any)?.id ?? null);

  // Only orders still being worked are announced; a cancelled one stays quiet.
  const toAnnounce = revealed.filter(stillOpen);
  if (toAnnounce.length > 0) {
    void announceRevealedOrders(orgId, toAnnounce, settings).catch((error) =>
      logger.warn("product-launch: announcing revealed orders crashed", { productId: product.id, error: (error as Error).message }));
  }
});

// ── POST /:productId/end ── a test that did not sell ────────────────────────
// The product is switched off (its order form stops taking orders) and goes
// back to a normal stage; the test stays on the page with its numbers. The
// Owner chooses, each time, what happens to the orders that came in hidden.
const EndSchema = z.object({
  orders: z.enum(["cancel", "deliver"]),
  note: z.string().trim().max(500).optional()
});

router.post("/:productId/end", async (req, res) => {
  const parsed = EndSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId;
  const { data: product, error: productError } = await supabase.from("products")
    .select("id, name, launch_stage, launch_settings").eq("org_id", orgId).eq("id", req.params.productId).maybeSingle();
  if (productError) { res.status(500).json({ error: productError.message }); return; }
  if (!product) { res.status(404).json({ error: "That product does not exist here." }); return; }
  const from: LaunchStage = isLaunchStage((product as any).launch_stage) ? (product as any).launch_stage : "live";
  if (from === "live") { res.status(409).json({ error: `${product.name} is not being tested.` }); return; }
  const settings = launchSettingsOf((product as any).launch_settings);

  const { error: offError } = await supabase.from("products").update({ launch_stage: "live", active: false }).eq("org_id", orgId).eq("id", product.id);
  if (offError) { res.status(500).json({ error: offError.message }); return; }

  let cancelled = 0;
  let cartsClosed = 0;
  let revealed: any[] = [];
  const heldCarts = from === "silent" && settings.silentHoldCarts;
  const heldSince = heldCarts ? await silentSince(orgId, product.id) : "";
  if (parsed.data.orders === "cancel") {
    // The carts it held back are closed as Lost, unassigned and unannounced.
    if (heldCarts) {
      try { cartsClosed = await closeHeldCarts(orgId, product.id, heldSince); }
      catch (error) { logger.warn("product-launch: closing held carts failed", { productId: product.id, error: (error as Error).message }); }
    }
    // Quietly: they stay Silent Test (hidden from the team, out of every rate),
    // nobody is alerted, and the customer gets no message. The audit says why.
    const { data, error } = await supabase.from("orders")
      .update({ status: "Cancelled", updated_at: new Date().toISOString() })
      .eq("org_id", orgId).eq("product_id", product.id).eq("launch_stage", "silent")
      .not("status", "in", "(Delivered,Failed,Cancelled)")
      .select("id, status");
    if (error) { res.status(500).json({ error: error.message }); return; }
    cancelled = (data ?? []).length;
    if (cancelled > 0) {
      await supabase.from("order_audit").insert((data ?? []).map((order: any) => ({
        order_id: order.id, org_id: orgId, changed_by: req.user!.id, from_status: null, to_status: "Cancelled",
        note: `Product Launch: test ended - ${product.name} did not go ahead${parsed.data.note ? ` (${parsed.data.note})` : ""}`
      })));
    }
  } else {
    const { data, error } = await revealSilentOrders(orgId, product.id);
    if (error) { res.status(500).json({ error: error.message }); return; }
    revealed = data ?? [];
  }

  const { data: eventRow, error: eventError } = await supabase.from("product_launch_events").insert({
    org_id: orgId, product_id: product.id, from_stage: from, to_stage: "live",
    ended_with: parsed.data.orders === "cancel" ? "cancelled" : "delivered",
    orders_revealed: revealed.length, orders_cancelled: cancelled, carts_closed: cartsClosed, note: parsed.data.note ?? null,
    changed_by: req.user!.id, changed_by_name: req.user!.name ?? null
  }).select("id").maybeSingle();
  if (eventError) logger.warn("product-launch: end history row failed", { productId: product.id, error: eventError.message });

  res.json({ productId: product.id, ended: true, cancelled, revealed: revealed.length, cartsClosed });

  // "Let the team deliver": its held carts go out to reps too.
  if (parsed.data.orders === "deliver" && heldCarts) handOutHeldCartsLater(orgId, product.id, heldSince, (eventRow as any)?.id ?? null);

  const toAnnounce = revealed.filter(stillOpen);
  if (toAnnounce.length > 0) {
    void announceRevealedOrders(orgId, toAnnounce, settings).catch((error) =>
      logger.warn("product-launch: announcing orders after end crashed", { productId: product.id, error: (error as Error).message }));
  }
});

// ── PUT /:productId/settings ── the product's launch settings ───────────────
const SettingsSchema = z.object({
  silentCustomerMessages: z.boolean(),
  silentHoldCarts: z.boolean(),
  revealCustomerMessages: z.boolean(),
  revealRepAlerts: z.boolean(),
  softLeaveOutOfRate: z.boolean()
}).partial();

router.put("/:productId/settings", async (req, res) => {
  const parsed = SettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const orgId = req.user!.orgId;
  const { data: product } = await supabase.from("products").select("id, launch_settings").eq("org_id", orgId).eq("id", req.params.productId).maybeSingle();
  if (!product) { res.status(404).json({ error: "That product does not exist here." }); return; }
  const next = { ...launchSettingsOf((product as any).launch_settings), ...parsed.data };
  const { error } = await supabase.from("products").update({ launch_settings: next }).eq("org_id", orgId).eq("id", product.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ productId: product.id, settings: next });
});

export default router;
