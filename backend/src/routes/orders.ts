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
  const { status, source, search, page = "1", limit = "25", repId, since, dateFrom, dateTo } = req.query;
  const pageNum  = Math.max(1, parseInt(page as string, 10));
  const pageSize = Math.min(2000, parseInt(limit as string, 10));
  const from = (pageNum - 1) * pageSize;
  const to   = from + pageSize - 1;

  let query = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false })
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
    query = query.or(`customer.ilike.%${search}%,phone.ilike.%${search}%,id.ilike.%${search}%`);
  }
  // since=ISO8601 — only orders newer than this timestamp (used for polling)
  if (since) query = query.gt("created_at", since as string);
  // dateFrom / dateTo — server-side date range filter (YYYY-MM-DD)
  if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
  if (dateTo)   query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data, total: count ?? 0, page: pageNum, pageSize });
});

// ── POST /api/orders ──────────────────────────────────────
const OrderSchema = z.object({
  id:             z.string().min(1),
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
      quantity:        d.quantity,
      amount:          d.amount,
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
    .select("status, org_id, agent_id, product_id, product_name, quantity, customer, state, city")
    .eq("id", req.params.id).single();

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
    updates.delivered_date  = new Date().toISOString().split("T")[0];
    updates.stock_deducted  = true;
  } else if (existing?.status === "Delivered") {
    updates.delivered_date = null;
    updates.stock_deducted = false;
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

  const allowed = ["customer","phone","whatsapp","email","address","city","state",
                   "response","notes","assigned_rep_id","agent_id","call_outcome",
                   "scheduled_date","amount","quantity","product_id","package_id",
                   "product_name","package_name","source","location","currency",
                   "logistics_cost","amount_remitted","remittance_status",
                   "upsell_from_qty","upsell_to_qty","upsell_note",
                   "manual_bonus_override","manual_bonus_reason","bonus_manually_adjusted",
                   "cross_sell_lines","free_gift_lines"];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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
  // Fetch before deleting so we can log context
  const { data: existing } = await supabase
    .from("orders").select("status, customer, product_name, amount")
    .eq("id", req.params.id).eq("org_id", req.user!.orgId).single();

  // Audit log before delete (so FK is still valid)
  if (existing) {
    await supabase.from("order_audit").insert({
      order_id:    req.params.id,
      org_id:      req.user!.orgId,
      changed_by:  req.user!.id,
      from_status: existing.status,
      to_status:   "Deleted",
      note:        `Order deleted (was ${existing.status}). Customer: ${existing.customer}, Product: ${existing.product_name}, Amount: ${existing.amount}`
    });
  }

  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }

  res.status(204).send();
});

export default router;
