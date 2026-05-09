import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { sendLowStockEmail } from "../lib/mailer.js";
import { sendPushToRoles } from "../lib/push.js";

const movementId = () => `MOV-${randomUUID()}`;

const router = Router();
router.use(requireAuth);

// ── GET /api/stock/movements ──────────────────────────────
router.get("/movements", async (req, res) => {
  const { productId, type, from, to, page = "1", limit = "50" } = req.query;
  const pageNum  = Math.max(1, parseInt(page as string, 10));
  const pageSize = Math.min(200, parseInt(limit as string, 10));
  const offset   = (pageNum - 1) * pageSize;

  let query = supabase
    .from("stock_movements")
    .select("*", { count: "exact" })
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (productId) query = query.eq("product_id", productId as string);
  if (type && type !== "All Types") query = query.eq("type", type);
  if (from) query = query.gte("created_at", from as string);
  if (to)   query = query.lte("created_at", to as string);

  const { data, error, count } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data, total: count ?? 0, page: pageNum, pageSize });
});

// ── POST /api/stock/update ────────────────────────────────
// Manual warehouse stock update (add or remove)
const UpdateSchema = z.object({
  productId: z.string().uuid(),
  change:    z.number().int(),            // positive = add, negative = remove
  note:      z.string().optional()
});

router.post("/update",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { productId, change, note } = parsed.data;

    const { data: product, error: fetchError } = await supabase
      .from("products")
      .select("warehouse_stock, reorder_point, name")
      .eq("id", productId)
      .eq("org_id", req.user!.orgId)
      .single();

    if (fetchError || !product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }

    // Atomic single-statement update via DB function (migration_004).
    const { data: newStockVal, error: rpcError } = await supabase.rpc("adjust_warehouse_stock", {
      p_product_id: productId,
      p_org_id:     req.user!.orgId,
      p_delta:      change
    });
    if (rpcError) { res.status(500).json({ error: rpcError.message }); return; }
    const newStock: number = typeof newStockVal === "number" ? newStockVal : Number(newStockVal);

    // Log the movement
    const movType = change > 0 ? "Stock Added" : "Correction";
    const { data: movement, error: movError } = await supabase
      .from("stock_movements")
      .insert({
        id:           movementId(),
        org_id:       req.user!.orgId,
        product_id:   productId,
        product_name: product.name,
        type:         movType,
        qty:          change,
        balance_after: newStock,
        by_name:      req.user!.name,
        by_user_id:   req.user!.id,
        note:         note || (change > 0 ? "Manual stock addition" : "Manual stock correction")
      })
      .select()
      .single();

    if (movError) { res.status(500).json({ error: movError.message }); return; }

    // Check low stock threshold
    const wasAbove = product.warehouse_stock > product.reorder_point;
    const nowBelow = newStock <= product.reorder_point;
    if (change < 0 && wasAbove && nowBelow) {
      const message = `Low stock: ${product.name} — warehouse down to ${newStock} unit${newStock === 1 ? "" : "s"} (reorder point: ${product.reorder_point})`;
      await supabase.from("system_notifications").insert({
        org_id:     req.user!.orgId,
        type:       "low_stock",
        message,
        product_id: productId
      });
      await sendPushToRoles(req.user!.orgId, ["Owner", "Admin", "Inventory Manager"], {
        title: "Low Stock Alert",
        body: message,
        url: "/dashboard/admin/inventory",
        tag: `low-stock-${productId}`,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-72.png"
      });
      sendLowStockEmail(req.user!.orgId, {
        name:         product.name,
        currentStock: newStock,
        reorderPoint: product.reorder_point
      });
    }

    res.json({ newStock, movement });
  }
);

// ── POST /api/stock/movements ─────────────────────────────
// Create a stock movement record (for order delivery, waybill, etc.)
const MovementSchema = z.object({
  productId:    z.string().uuid(),
  productName:  z.string().min(1),
  type:         z.string().min(1),
  qty:          z.number().int(),
  balanceAfter: z.number().int().min(0),
  agentId:      z.string().uuid().optional(),
  agentName:    z.string().optional(),
  orderId:      z.string().optional(),
  note:         z.string().optional()
});

router.post("/movements",
  requireRole("Owner", "Admin", "Inventory Manager", "Sales Rep"),
  async (req, res) => {
    const parsed = MovementSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const d = parsed.data;

    // Trust boundary: balance_after must be derived from authoritative state,
    // not whatever the client posted. Look up current stock for this scope.
    let balanceAfter = 0;
    if (d.agentId) {
      const { data: ag } = await supabase
        .from("agent_stock")
        .select("quantity")
        .eq("agent_id", d.agentId)
        .eq("product_id", d.productId)
        .maybeSingle();
      balanceAfter = ag?.quantity ?? 0;
    } else {
      const { data: prod } = await supabase
        .from("products")
        .select("warehouse_stock")
        .eq("id", d.productId)
        .eq("org_id", req.user!.orgId)
        .maybeSingle();
      balanceAfter = prod?.warehouse_stock ?? 0;
    }

    const { data, error } = await supabase
      .from("stock_movements")
      .insert({
        id:            movementId(),
        org_id:        req.user!.orgId,
        product_id:    d.productId,
        product_name:  d.productName,
        type:          d.type,
        qty:           d.qty,
        balance_after: balanceAfter,
        agent_id:      d.agentId ?? null,
        order_id:      d.orderId ?? null,
        by_name:       req.user!.name,
        by_user_id:    req.user!.id,
        note:          d.note ?? null
      })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  }
);

// ── GET /api/stock/count-sessions ────────────────────────
router.get("/count-sessions", async (req, res) => {
  const { data, error } = await supabase
    .from("stock_count_sessions")
    .select("*, entries: stock_count_entries(*)")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/stock/count-sessions ───────────────────────
router.post("/count-sessions",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const Schema = z.object({
      title:    z.string().min(1),
      agentIds: z.array(z.string().uuid()).min(1)
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { title, agentIds } = parsed.data;

    // Create session
    const { data: session, error: sessError } = await supabase
      .from("stock_count_sessions")
      .insert({ org_id: req.user!.orgId, title, created_by: req.user!.id })
      .select()
      .single();
    if (sessError || !session) {
      res.status(500).json({ error: sessError?.message ?? "Failed to create session." });
      return;
    }

    // Build entries from current agent stock
    const { data: stocks } = await supabase
      .from("agent_stock")
      .select("agent_id, product_id, quantity, agents(name), products(name)")
      .in("agent_id", agentIds)
      .gt("quantity", 0);

    if (stocks && stocks.length > 0) {
      const entries = stocks.map((s: any) => ({
        session_id:   session.id,
        product_id:   s.product_id,
        product_name: s.products?.name ?? s.product_id,
        agent_id:     s.agent_id,
        agent_name:   s.agents?.name ?? s.agent_id,
        system_qty:   s.quantity,
        status:       "Pending"
      }));
      await supabase.from("stock_count_entries").insert(entries);
    }

    const { data: full } = await supabase
      .from("stock_count_sessions")
      .select("*, entries: stock_count_entries(*)")
      .eq("id", session.id)
      .single();

    res.status(201).json(full);
  }
);

// ── PATCH /api/stock/count-entries/:entryId ───────────────
router.patch("/count-entries/:entryId",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const Schema = z.object({
      agentCount:  z.number().int().min(0).optional(),
      adminCount:  z.number().int().min(0).optional(),
      notes:       z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { agentCount, adminCount, notes } = parsed.data;

    // Determine status
    let status = "Pending";
    let variance: number | undefined;
    let verifiedAt: string | undefined;
    if (agentCount !== undefined && adminCount !== undefined) {
      status    = agentCount === adminCount ? "Verified" : "Discrepancy";
      variance  = agentCount - adminCount;
      if (status === "Verified") verifiedAt = new Date().toISOString();
    } else if (agentCount !== undefined) {
      status = "Agent Submitted";
    } else if (adminCount !== undefined) {
      status = "Admin Confirmed";
    }

    const updates: Record<string, unknown> = { status };
    if (agentCount !== undefined) { updates.agent_count = agentCount; updates.agent_submitted_at = new Date().toISOString(); }
    if (adminCount !== undefined) { updates.admin_count = adminCount; updates.admin_confirmed_at = new Date().toISOString(); }
    if (variance !== undefined)   updates.variance    = variance;
    if (verifiedAt)               updates.verified_at = verifiedAt;
    if (notes !== undefined)      updates.notes       = notes;

    // Verify the entry belongs to this org via its parent session.
    const { data: ownership } = await supabase
      .from("stock_count_entries")
      .select("id, session: stock_count_sessions!inner(org_id)")
      .eq("id", req.params.entryId)
      .eq("session.org_id", req.user!.orgId)
      .maybeSingle();
    if (!ownership) { res.status(404).json({ error: "Entry not found." }); return; }

    const { data, error } = await supabase
      .from("stock_count_entries")
      .update(updates)
      .eq("id", req.params.entryId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  }
);

// ── POST /api/stock/count-entries/:entryId/adjust ─────────
// Adjust agent stock to match count and log write-off
router.post("/count-entries/:entryId/adjust",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const Schema = z.object({
      writeoffReason: z.enum(["Damaged", "Theft", "Unreported Sale", "Return to Warehouse", "Other"]),
      writeoffCustom: z.string().optional()
    });
    const parsed = Schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { writeoffReason, writeoffCustom } = parsed.data;

    const { data: entry, error: fetchError } = await supabase
      .from("stock_count_entries")
      .select("*, session: stock_count_sessions!inner(org_id)")
      .eq("id", req.params.entryId)
      .eq("session.org_id", req.user!.orgId)
      .single();
    if (fetchError || !entry || entry.agent_count == null) {
      res.status(404).json({ error: "Entry not found or agent count not submitted." });
      return;
    }

    const delta      = entry.agent_count - entry.system_qty;
    const reasonLabel = writeoffReason === "Other" && writeoffCustom?.trim()
      ? writeoffCustom.trim()
      : writeoffReason;

    // Update agent_stock
    await supabase
      .from("agent_stock")
      .update({ quantity: entry.agent_count })
      .eq("agent_id", entry.agent_id)
      .eq("product_id", entry.product_id);

    // Sync denormalized total on the products row
    const { data: allAgentStock } = await supabase
      .from("agent_stock").select("quantity").eq("product_id", entry.product_id);
    const newAgentTotal = (allAgentStock ?? []).reduce((sum, r) => sum + (r.quantity ?? 0), 0);
    await supabase.from("products").update({ agent_stock: newAgentTotal }).eq("id", entry.product_id);

    // Log movement
    await supabase.from("stock_movements").insert({
      id:           movementId(),
      org_id:       req.user!.orgId,
      product_id:   entry.product_id,
      product_name: entry.product_name,
      type:         "Correction",
      qty:          delta,
      balance_after: entry.agent_count,
      agent_id:     entry.agent_id,
      by_name:      req.user!.name,
      by_user_id:   req.user!.id,
      note:         `Write-off: ${delta >= 0 ? "+" : ""}${delta} units — ${reasonLabel}. (Stock count reconciliation)`
    });

    // Mark entry verified
    const { data: updated, error: updateError } = await supabase
      .from("stock_count_entries")
      .update({
        status:          "Verified",
        system_qty:      entry.agent_count,
        variance:        0,
        verified_at:     new Date().toISOString(),
        writeoff_reason: writeoffReason,
        writeoff_custom: writeoffCustom ?? null
      })
      .eq("id", req.params.entryId)
      .select()
      .single();

    if (updateError) { res.status(500).json({ error: updateError.message }); return; }
    res.json(updated);
  }
);

// ── PATCH /api/stock/count-sessions/:id/close ─────────────
router.patch("/count-sessions/:id/close",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const { data, error } = await supabase
      .from("stock_count_sessions")
      .update({ status: "Closed", closed_at: new Date().toISOString() })
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  }
);

export default router;
