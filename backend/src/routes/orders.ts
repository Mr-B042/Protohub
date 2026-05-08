import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  sendOrderStatusEmail, sendNewOrderEmail,
  sendInternalNewOrderEmail, sendOrderAssignedEmail,
  sendInternalDeliveredEmail
} from "../lib/mailer.js";
import { notifyOrderEvent } from "../lib/order-notifications.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/orders ───────────────────────────────────────
// Supports: ?status=Delivered&source=TikTok&search=Kemi&page=1&limit=25
router.get("/", async (req, res) => {
  const { status, source, search, page = "1", limit = "25", repId, since, updatedSince, dateFrom, dateTo } = req.query;
  const pageNum  = Math.max(1, parseInt(page as string, 10));
  const pageSize = Math.min(2000, parseInt(limit as string, 10));
  const from = (pageNum - 1) * pageSize;
  const to   = from + pageSize - 1;

  // updatedSince polling needs the result sorted by updated_at so the client
  // can read result.data[0].updated_at as the next high-water mark. Default
  // listing keeps newest-by-created_at order for the UI table.
  const sortColumn = updatedSince ? "updated_at" : "created_at";

  let query = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("org_id", req.user!.orgId)
    .order(sortColumn, { ascending: false })
    .range(from, to);

  // Sales Reps only see their own orders
  if (req.user!.role === "Sales Rep") {
    query = query.eq("assigned_rep_id", req.user!.id);
  } else if (repId) {
    query = query.eq("assigned_rep_id", repId as string);
  }

  if (status && status !== "All Orders") query = query.eq("status", status);
  if (source && source !== "All Sources") query = query.eq("source", source);
  if (search) {
    // Escape PostgREST filter special characters to prevent filter injection
    const safe = (search as string).replace(/[.,()"\\%_]/g, (ch) => `\\${ch}`);
    query = query.or(`customer.ilike.%${safe}%,phone.ilike.%${safe}%,id.ilike.%${safe}%`);
  }
  // since=ISO8601 — orders created after this timestamp (initial new-order polling).
  if (since) query = query.gt("created_at", since as string);
  // updatedSince=ISO8601 — orders changed after this timestamp. Catches status
  // updates and edits that don't bump created_at, so collaborating reps see
  // each other's changes within the poll interval instead of waiting for a
  // full reload. orders.updated_at is auto-bumped by the set_updated_at trigger.
  if (updatedSince) query = query.gt("updated_at", updatedSince as string);
  // dateFrom / dateTo — server-side date range filter (YYYY-MM-DD)
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo)   query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data, total: count ?? 0, page: pageNum, pageSize });
});

// ── POST /api/orders ──────────────────────────────────────
const OrderSchema = z.object({
  id:             z.string().min(1).max(50).regex(/^[A-Za-z0-9\-_]+$/, "Order ID must be alphanumeric (hyphens and underscores allowed)"),
  customer:       z.string().min(1),
  phone:          z.string().min(1),
  whatsapp:       z.string().optional(),
  email:          z.string().email().optional().or(z.literal("")),
  address:        z.string().optional(),
  city:           z.string().optional(),
  state:          z.string().optional(),
  productId:      z.string().uuid().optional(),
  packageId:      z.string().uuid().optional(),
  productName:    z.string().min(1),
  packageName:    z.string().optional(),
  quantity:       z.number().int().min(1).default(1),
  amount:         z.number().min(0),
  currency:       z.enum(["NGN", "USD", "GBP"]).default("NGN"),
  source:         z.enum(["TikTok", "Facebook", "WhatsApp", "Website", "Direct"]).optional(),
  location:       z.string().optional(),
  assignedRepId:  z.string().uuid().optional(),
  utmSource:      z.string().optional(),
  utmCampaign:    z.string().optional(),
  utmMedium:      z.string().optional(),
  utmContent:     z.string().optional(),
  utmTerm:        z.string().optional(),
  referrer:       z.string().optional(),
  confirmationChecked: z.boolean().optional(),
  preferredDelivery:   z.string().optional(),
  date:           z.string().optional(),
  response:       z.string().optional()
});

router.post("/", async (req, res) => {
  const parsed = OrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const d = parsed.data;

  // Validate productId belongs to this org
  if (d.productId) {
    const { data: productCheck } = await supabase
      .from("products").select("id").eq("id", d.productId).eq("org_id", req.user!.orgId).single();
    if (!productCheck) {
      res.status(400).json({ error: "Product not found in your organization." });
      return;
    }
  }

  // Validate packageId belongs to this org (via its parent product)
  if (d.packageId) {
    const { data: pkgCheck } = await supabase
      .from("product_packages")
      .select("id, product_id")
      .eq("id", d.packageId)
      .single();
    if (!pkgCheck) {
      res.status(400).json({ error: "Package not found." });
      return;
    }
    // Verify the package's product belongs to this org
    const { data: pkgProductCheck } = await supabase
      .from("products").select("id").eq("id", pkgCheck.product_id).eq("org_id", req.user!.orgId).single();
    if (!pkgProductCheck) {
      res.status(400).json({ error: "Package does not belong to your organization." });
      return;
    }
  }

  // Validate assignedRepId belongs to this org
  if (d.assignedRepId) {
    const { data: repCheck } = await supabase
      .from("users").select("id").eq("id", d.assignedRepId).eq("org_id", req.user!.orgId).single();
    if (!repCheck) {
      res.status(400).json({ error: "Assigned rep not found in your organization." });
      return;
    }
  }

  const { data, error } = await supabase
    .from("orders")
    .insert({
      id:              d.id,
      org_id:          req.user!.orgId,
      customer:        d.customer,
      phone:           d.phone,
      whatsapp:        d.whatsapp,
      email:           d.email || null,
      address:         d.address,
      city:            d.city,
      state:           d.state,
      product_id:      d.productId,
      package_id:      d.packageId,
      product_name:    d.productName,
      package_name:    d.packageName,
      quantity:          d.quantity,
      original_quantity: d.quantity,
      amount:          d.amount,
      original_amount: d.amount,
      currency:        d.currency,
      source:          d.source,
      location:        d.location,
      assigned_rep_id: d.assignedRepId ?? req.user!.id,
      utm_source:      d.utmSource,
      utm_campaign:    d.utmCampaign,
      utm_medium:      d.utmMedium,
      utm_content:     d.utmContent,
      utm_term:        d.utmTerm,
      referrer:        d.referrer,
      confirmation_checked: d.confirmationChecked ?? null,
      preferred_delivery:   d.preferredDelivery ?? null,
      date:            d.date,
      response:        d.response,
      status:          "New"
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      res.status(409).json({ error: `Order ID "${d.id}" already exists.` });
    } else {
      res.status(500).json({ error: error.message });
    }
    return;
  }

  // Audit: creation event
  await supabase.from("order_audit").insert({
    order_id:    data.id,
    org_id:      req.user!.orgId,
    changed_by:  req.user!.id,
    from_status: null,
    to_status:   "New",
    note:        "Order created"
  });

  // In-app notifications
  await notifyOrderEvent(req.user!.orgId, {
    id: data.id, customer: data.customer, productName: data.product_name,
    assignedRepId: data.assigned_rep_id
  }, "New");

  // Fire-and-forget emails
  // Customer confirmation (only if email in order form)
  sendNewOrderEmail(req.user!.orgId, {
    id: data.id, customer: data.customer, email: data.email,
    phone: data.phone, product_name: data.product_name,
    amount: data.amount, currency: data.currency, source: data.source
  });

  // Internal: notify owner + admins
  sendInternalNewOrderEmail(req.user!.orgId, {
    id: data.id, customer: data.customer, phone: data.phone,
    product_name: data.product_name, amount: data.amount,
    currency: data.currency, source: data.source, rep_name: req.user!.name
  });

  // Internal: notify assigned rep (only if someone else assigned the order)
  if (data.assigned_rep_id && data.assigned_rep_id !== req.user!.id) {
    sendOrderAssignedEmail(req.user!.orgId, data.assigned_rep_id, {
      id: data.id, customer: data.customer, phone: data.phone,
      product_name: data.product_name, amount: data.amount,
      currency: data.currency, source: data.source
    });
  }

  res.status(201).json(data);
});

// ── PATCH /api/orders/:id/status ──────────────────────────
const StatusSchema = z.object({
  status:      z.enum(["New","Confirmed","In Process","Dispatched","Delivered","Cancelled","Postponed","Failed"]),
  callOutcome: z.enum(["Confirmed","No Answer","Wrong Number","Refused","Scheduled Callback","Not Reached"]).optional(),
  response:    z.string().optional(),
  agentId:     z.string().uuid().optional().nullable()
});

router.patch("/:id/status", async (req, res) => {
  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { status, callOutcome, response, agentId } = parsed.data;

  // Fetch current order for audit trail + delivery logic
  const { data: existing } = await supabase
    .from("orders")
    .select("status, org_id, agent_id, product_id, product_name, quantity, customer, state, city, assigned_rep_id, stock_deducted")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .single();

  if (!existing) { res.status(404).json({ error: "Order not found." }); return; }

  // Cancelled orders cannot be re-opened
  if (existing.status === "Cancelled") {
    res.status(400).json({ error: "Cannot change status of a Cancelled order." });
    return;
  }

  // Sales Reps can only change status on their own orders
  if (req.user!.role === "Sales Rep" && existing.assigned_rep_id !== req.user!.id) {
    res.status(403).json({ error: "You can only update orders assigned to you." });
    return;
  }

  // Validate agentId belongs to this org
  if (agentId) {
    const { data: agentCheck } = await supabase
      .from("agents").select("id").eq("id", agentId).eq("org_id", req.user!.orgId).single();
    if (!agentCheck) {
      res.status(400).json({ error: "Agent not found in your organization." });
      return;
    }
  }

  // Resolve the effective agent (request may override)
  const effectiveAgentId = agentId !== undefined ? agentId : existing?.agent_id;
  const orderQty = existing?.quantity ?? 1;

  // Pre-check: if marking Delivered and an agent is assigned, verify stock
  if (status === "Delivered" && effectiveAgentId && existing?.product_id) {
    const { data: agentStockRow } = await supabase
      .from("agent_stock")
      .select("quantity")
      .eq("agent_id", effectiveAgentId)
      .eq("product_id", existing.product_id)
      .single();

    const available = agentStockRow?.quantity ?? 0;
    if (available < orderQty) {
      // Fetch agent name for a clear error message
      const { data: agentRow } = await supabase
        .from("agents").select("name").eq("id", effectiveAgentId).single();
      const agentName = agentRow?.name ?? effectiveAgentId;
      res.status(400).json({
        error: `Cannot mark delivered — agent ${agentName} only has ${available} units of ${existing.product_name}.`
      });
      return;
    }
  }

  const updates: Record<string, unknown> = { status };
  if (callOutcome)  updates.call_outcome    = callOutcome;
  if (response)     updates.response        = response;
  if (agentId !== undefined) updates.agent_id = agentId;

  if (status === "Delivered") {
    // Use WAT (UTC+1) so the date is correct for Nigeria even near midnight UTC
    const watDate = new Date(Date.now() + 60 * 60 * 1000);
    updates.delivered_date  = watDate.toISOString().split("T")[0];
    updates.stock_deducted  = true;
  } else if (existing?.status === "Delivered") {
    updates.delivered_date    = null;
    updates.stock_deducted    = false;
    // Clear remittance so a un-delivered order is not flagged as overdue by
    // the remittance cron or shown as outstanding in the finance dashboard.
    updates.amount_remitted   = 0;
    updates.logistics_cost    = 0;
    updates.remittance_status = "Pending";
  }

  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data)  { res.status(404).json({ error: "Order not found." }); return; }

  // ── Delivery side-effects: deduct agent stock, create waybill, log movement ──
  if (status === "Delivered" && effectiveAgentId && existing?.product_id) {
    const today = new Date().toISOString().split("T")[0];

    // 1. Deduct agent stock
    const { data: currentStock } = await supabase
      .from("agent_stock")
      .select("quantity")
      .eq("agent_id", effectiveAgentId)
      .eq("product_id", existing.product_id)
      .single();
    const newAgentQty = Math.max(0, (currentStock?.quantity ?? 0) - orderQty);
    await supabase.from("agent_stock")
      .update({ quantity: newAgentQty })
      .eq("agent_id", effectiveAgentId)
      .eq("product_id", existing.product_id);

    // Fetch agent name/zone for waybill
    const { data: agentInfo } = await supabase
      .from("agents").select("name, zone").eq("id", effectiveAgentId).single();
    const agentName = agentInfo?.name ?? "Agent";
    const agentZone = agentInfo?.zone ?? "";

    // 2. Create waybill record (agent → customer)
    const waybillId = `WB-${Date.now()}`;
    const customerLocation = [existing.city, existing.state].filter(Boolean).join(", ") || "Customer";
    await supabase.from("waybill_records").insert({
      id:              waybillId,
      org_id:          req.user!.orgId,
      product_id:      existing.product_id,
      product_name:    existing.product_name,
      quantity:        orderQty,
      waybill_fee:     0,
      from_location:   agentZone,
      to_location:     `Customer:${req.params.id}`,
      agent_id:        effectiveAgentId,
      status:          "Received",
      dispatched_date: today,
      received_date:   today,
      notes:           `Auto-created on order delivery (${existing.customer})`
    });

    // 3. Log stock movement
    await supabase.from("stock_movements").insert({
      id:            `MOV-${randomUUID()}`,
      org_id:        req.user!.orgId,
      product_id:    existing.product_id,
      product_name:  existing.product_name,
      type:          "Order Fulfilled",
      qty:           orderQty,
      balance_after: newAgentQty,
      agent_id:      effectiveAgentId,
      order_id:      req.params.id,
      by_name:       req.user!.name,
      by_user_id:    req.user!.id,
      waybill_id:    waybillId,
      from_location: agentZone,
      to_location:   customerLocation,
      note:          `Delivered to ${existing.customer} — agent ${agentName} stock ${(currentStock?.quantity ?? 0)} → ${newAgentQty}`
    });
  }

  // ── Un-delivery side-effects: restore agent stock, delete waybill, log reversal ──
  if (existing?.status === "Delivered" && status !== "Delivered" && existing?.stock_deducted && existing?.agent_id && existing?.product_id) {
    const orderQty = existing.quantity ?? 1;
    const { data: currentStock } = await supabase
      .from("agent_stock").select("quantity")
      .eq("agent_id", existing.agent_id).eq("product_id", existing.product_id).single();
    const restoredQty = (currentStock?.quantity ?? 0) + orderQty;
    await supabase.from("agent_stock")
      .update({ quantity: restoredQty })
      .eq("agent_id", existing.agent_id).eq("product_id", existing.product_id);

    const { data: agentInfo } = await supabase
      .from("agents").select("name").eq("id", existing.agent_id).single();
    await supabase.from("stock_movements").insert({
      id:            `MOV-${randomUUID()}`,
      org_id:        req.user!.orgId,
      product_id:    existing.product_id,
      product_name:  existing.product_name,
      type:          "Status Reversal",
      qty:           orderQty,
      balance_after: restoredQty,
      agent_id:      existing.agent_id,
      order_id:      req.params.id,
      by_name:       req.user!.name,
      by_user_id:    req.user!.id,
      note:          `Delivery reversed — order ${req.params.id} changed to ${status} (agent ${agentInfo?.name ?? existing.agent_id} stock ${currentStock?.quantity ?? 0} → ${restoredQty})`
    });

    await supabase.from("waybill_records")
      .delete()
      .eq("org_id", req.user!.orgId)
      .eq("to_location", `Customer:${req.params.id}`);
  }

  // Audit log — awaited so failures are visible
  const { error: auditErr } = await supabase.from("order_audit").insert({
    order_id:    req.params.id,
    org_id:      req.user!.orgId,
    changed_by:  req.user!.id,
    from_status: existing?.status ?? null,
    to_status:   status,
    note:        req.body.reason ?? null
  });
  if (auditErr) console.error("Audit insert failed:", auditErr.message);

  // In-app notifications
  await notifyOrderEvent(req.user!.orgId, {
    id: data.id, customer: data.customer, productName: data.product_name,
    assignedRepId: data.assigned_rep_id
  }, status);

  // Customer: status change email
  sendOrderStatusEmail(req.user!.orgId, {
    id: data.id, customer: data.customer, email: data.email,
    product_name: data.product_name, amount: data.amount, currency: data.currency
  }, existing?.status ?? null, status);

  // Internal: notify owner + admins when delivered
  if (status === "Delivered") {
    sendInternalDeliveredEmail(req.user!.orgId, {
      id: data.id, customer: data.customer,
      product_name: data.product_name, amount: data.amount, currency: data.currency
    }, req.user!.name);
  }

  res.json(data);
});

// ── GET /api/orders/:id/audit ─────────────────────────────
router.get("/:id/audit", async (req, res) => {
  const { data, error } = await supabase
    .from("order_audit")
    .select("id, from_status, to_status, note, created_at, changed_by")
    .eq("order_id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

// ── PATCH /api/orders/:id ─────────────────────────────────
router.patch("/:id", async (req, res) => {
  // Guard: terminal statuses cannot be edited
  const { data: current } = await supabase
    .from("orders").select("status").eq("id", req.params.id).eq("org_id", req.user!.orgId).single();
  if (!current) { res.status(404).json({ error: "Order not found." }); return; }
  if (current.status === "Delivered" || current.status === "Cancelled") {
    res.status(403).json({ error: "This order is in a terminal state and cannot be edited." });
    return;
  }

  // DB column → list of accepted input keys (snake + common camel aliases).
  // The frontend's snake_case-only call sites still work; new camelCase
  // payloads (which are natural after the snake→camel normalize boundary in
  // api.ts) no longer silently no-op.
  const allowed: Record<string, string[]> = {
    customer:                  ["customer"],
    phone:                     ["phone"],
    whatsapp:                  ["whatsapp"],
    email:                     ["email"],
    address:                   ["address"],
    city:                      ["city"],
    state:                     ["state"],
    response:                  ["response"],
    notes:                     ["notes"],
    assigned_rep_id:           ["assigned_rep_id", "assignedRepId"],
    agent_id:                  ["agent_id", "agentId"],
    call_outcome:              ["call_outcome", "callOutcome"],
    scheduled_date:            ["scheduled_date", "scheduledDate"],
    amount:                    ["amount"],
    quantity:                  ["quantity"],
    product_id:                ["product_id", "productId"],
    package_id:                ["package_id", "packageId"],
    product_name:              ["product_name", "productName"],
    package_name:              ["package_name", "packageName"],
    source:                    ["source"],
    location:                  ["location"],
    currency:                  ["currency"],
    logistics_cost:            ["logistics_cost", "logisticsCost"],
    amount_remitted:           ["amount_remitted", "amountRemitted"],
    remittance_status:         ["remittance_status", "remittanceStatus"],
    upsell_from_qty:           ["upsell_from_qty", "upsellFromQty"],
    upsell_to_qty:             ["upsell_to_qty", "upsellToQty"],
    upsell_note:               ["upsell_note", "upsellNote"],
    manual_bonus_override:     ["manual_bonus_override", "manualBonusOverride"],
    manual_bonus_reason:       ["manual_bonus_reason", "manualBonusReason"],
    bonus_manually_adjusted:   ["bonus_manually_adjusted", "bonusManuallyAdjusted"],
    cross_sell_lines:          ["cross_sell_lines", "crossSellLines"],
    free_gift_lines:           ["free_gift_lines", "freeGiftLines"]
  };
  const updates: Record<string, unknown> = {};
  for (const [dbKey, inputKeys] of Object.entries(allowed)) {
    for (const inKey of inputKeys) {
      if (req.body[inKey] !== undefined) { updates[dbKey] = req.body[inKey]; break; }
    }
  }

  // Validate cross-org references
  if (updates.agent_id) {
    const { data: agentCheck } = await supabase.from("agents").select("id").eq("id", updates.agent_id).eq("org_id", req.user!.orgId).single();
    if (!agentCheck) { res.status(400).json({ error: "Agent not found in your organization." }); return; }
  }
  if (updates.assigned_rep_id) {
    const { data: repCheck } = await supabase.from("users").select("id").eq("id", updates.assigned_rep_id).eq("org_id", req.user!.orgId).single();
    if (!repCheck) { res.status(400).json({ error: "Rep not found in your organization." }); return; }
  }
  if (updates.product_id) {
    const { data: productCheck } = await supabase.from("products").select("id").eq("id", updates.product_id).eq("org_id", req.user!.orgId).single();
    if (!productCheck) { res.status(400).json({ error: "Product not found in your organization." }); return; }
  }

  const { data, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data)  { res.status(404).json({ error: "Order not found." }); return; }
  res.json(data);
});

// ── DELETE /api/orders/:id ────────────────────────────────
router.delete("/:id", requireRole("Owner", "Admin"), async (req, res) => {
  // Fetch before deleting so we can log context and reverse side-effects
  const { data: existing } = await supabase
    .from("orders").select("status, customer, product_name, product_id, amount, agent_id, quantity, stock_deducted")
    .eq("id", req.params.id).eq("org_id", req.user!.orgId).single();

  if (!existing) { res.status(404).json({ error: "Order not found." }); return; }

  // Reverse stock deduction if order was Delivered with an agent
  if (existing.status === "Delivered" && existing.stock_deducted && existing.agent_id && existing.product_id) {
    const orderQty = existing.quantity ?? 1;

    // Restore agent stock
    const { data: currentStock } = await supabase
      .from("agent_stock").select("quantity")
      .eq("agent_id", existing.agent_id).eq("product_id", existing.product_id).single();
    const restoredQty = (currentStock?.quantity ?? 0) + orderQty;
    await supabase.from("agent_stock")
      .update({ quantity: restoredQty })
      .eq("agent_id", existing.agent_id).eq("product_id", existing.product_id);

    // Log reversal stock movement
    const { data: agentInfo } = await supabase
      .from("agents").select("name").eq("id", existing.agent_id).single();
    await supabase.from("stock_movements").insert({
      id:            `MOV-${randomUUID()}`,
      org_id:        req.user!.orgId,
      product_id:    existing.product_id,
      product_name:  existing.product_name,
      type:          "Delete Reversal",
      qty:           orderQty,
      balance_after: restoredQty,
      agent_id:      existing.agent_id,
      order_id:      req.params.id,
      by_name:       req.user!.name,
      by_user_id:    req.user!.id,
      note:          `Stock restored — order ${req.params.id} deleted (agent ${agentInfo?.name ?? existing.agent_id} stock ${currentStock?.quantity ?? 0} → ${restoredQty})`
    });

    // Remove the auto-created waybill for this order
    await supabase.from("waybill_records")
      .delete()
      .eq("org_id", req.user!.orgId)
      .eq("to_location", `Customer:${req.params.id}`);
  }

  // Audit log before delete (so FK is still valid)
  await supabase.from("order_audit").insert({
    order_id:    req.params.id,
    org_id:      req.user!.orgId,
    changed_by:  req.user!.id,
    from_status: existing.status,
    to_status:   "Deleted",
    note:        `Order deleted (was ${existing.status}). Customer: ${existing.customer}, Product: ${existing.product_name}, Amount: ${existing.amount}`
  });

  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.status(204).send();
});

export default router;
