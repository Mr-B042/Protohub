import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  sendOrderStatusEmail, sendNewOrderEmail,
  sendInternalNewOrderEmail, sendOrderAssignedEmail,
  sendInternalDeliveredEmail
} from "../lib/mailer.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/orders ───────────────────────────────────────
// Supports: ?status=Delivered&source=TikTok&search=Kemi&page=1&limit=25
router.get("/", async (req, res) => {
  const { status, source, search, page = "1", limit = "25", repId } = req.query;
  const pageNum  = Math.max(1, parseInt(page as string, 10));
  const pageSize = Math.min(100, parseInt(limit as string, 10));
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

  // Fetch current status for audit trail
  const { data: existing } = await supabase
    .from("orders").select("status, org_id").eq("id", req.params.id).single();

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

  // Fire-and-forget audit log
  supabase.from("order_audit").insert({
    order_id:    req.params.id,
    org_id:      req.user!.orgId,
    changed_by:  req.user!.id,
    from_status: existing?.status ?? null,
    to_status:   status,
    note:        req.body.reason ?? null
  });

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
  const allowed = ["customer","phone","whatsapp","email","address","city","state",
                   "response","notes","assigned_rep_id","agent_id","call_outcome",
                   "scheduled_date","amount","quantity"];
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
  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
