import { Router } from "express";
import { humanFieldErrors } from "../lib/validation-message.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { recordStockLossExpense } from "../lib/stock-loss-expense.js";
import { applyBranchScope, requireAuth, requireRole } from "../middleware/auth.js";
import { sendLowStockEmail } from "../lib/mailer.js";
import { getOrgPushBranding } from "../lib/push-branding.js";
import { sendPushToRoles } from "../lib/push.js";
import { runSmartStockAlerts } from "../lib/smart-stock-alerts.js";
import { applyInventoryMovements, InventoryMovementError } from "../lib/inventory-movements.js";

const movementId = () => `MOV-${randomUUID()}`;

const router = Router();
router.use(requireAuth);

// ── GET /api/stock/movements ──────────────────────────────
router.get("/movements", async (req, res) => {
  const { productId, agentId, type, from, to, page = "1", limit = "50" } = req.query;
  const pageNum  = Math.max(1, parseInt(page as string, 10));
  // 1000 (not 200): a query scoped to one agent is naturally small - the
  // busiest agent today has 251 lifetime rows - while the unscoped org-wide
  // fetch used to silently truncate to the newest 200 rows company-wide,
  // which for a busy org could be as little as a few days of history.
  const pageSize = Math.min(1000, parseInt(limit as string, 10));
  const offset   = (pageNum - 1) * pageSize;

  let query = applyBranchScope(supabase
    .from("stock_movements")
    .select("*", { count: "exact" })
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false })
    .range(offset, offset + pageSize - 1), req);

  if (productId) query = query.eq("product_id", productId as string);
  if (agentId)   query = query.eq("agent_id", agentId as string);
  if (type && type !== "All Types") query = query.eq("type", type);
  if (from) query = query.gte("created_at", from as string);
  if (to)   query = query.lte("created_at", to as string);

  const { data, error, count } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ data, total: count ?? 0, page: pageNum, pageSize });
});

// Live invariant check used by operations and deployment verification.
router.get("/reconciliation",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const orgId = req.user!.orgId;
    const [balances, aggregates, personalAgents] = await Promise.all([
      supabase.from("inventory_balance_reconciliation").select("*").eq("org_id", orgId),
      supabase.from("inventory_aggregate_reconciliation").select("*").eq("org_id", orgId),
      supabase.from("pda_inventory_reconciliation").select("*").eq("org_id", orgId)
    ]);
    const error = balances.error ?? aggregates.error ?? personalAgents.error;
    if (error) { res.status(500).json({ error: error.message }); return; }
    const balanceDrift = (balances.data ?? []).filter((row: any) => Number(row.drift ?? 0) !== 0);
    const aggregateDrift = (aggregates.data ?? []).filter((row: any) =>
      [row.quantity_drift, row.defective_drift, row.missing_drift, row.product_cache_drift]
        .some((value) => Number(value ?? 0) !== 0)
    );
    const personalAgentDrift = (personalAgents.data ?? []).filter((row: any) =>
      [row.available_drift, row.reserved_drift, row.out_for_delivery_drift,
        row.damaged_drift, row.missing_drift, row.awaiting_investigation_drift]
        .some((value) => Number(value ?? 0) !== 0)
    );
    res.json({
      ok: balanceDrift.length + aggregateDrift.length + personalAgentDrift.length === 0,
      checked: {
        balances: balances.data?.length ?? 0,
        aggregates: aggregates.data?.length ?? 0,
        personalAgents: personalAgents.data?.length ?? 0
      },
      drift: { balances: balanceDrift, aggregates: aggregateDrift, personalAgents: personalAgentDrift }
    });
  }
);

// ── POST /api/stock/update ────────────────────────────────
// Manual warehouse stock update (add or remove)
const UpdateSchema = z.object({
  productId: z.string().uuid(),
  change:    z.number().int(),            // positive = add, negative = remove
  note:      z.string().trim().min(3, "Reason is required.").max(300, "Reason is too long."),
  requestId: z.string().trim().min(8).max(160).optional()
});

router.post("/update",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }
    const { productId, change, note } = parsed.data;

    const { data: product, error: fetchError } = await supabase
      .from("products")
      .select("warehouse_stock, agent_stock, reorder_point, name")
      .eq("id", productId)
      .eq("org_id", req.user!.orgId)
      .single();

    if (fetchError || !product) {
      res.status(404).json({ error: "Product not found." });
      return;
    }

    const agentHeld = Number(product.agent_stock ?? 0);

    if (change < 0 && Math.abs(change) > product.warehouse_stock) {
      res.status(400).json({
        error: `You can only remove up to ${product.warehouse_stock} unit${product.warehouse_stock === 1 ? "" : "s"} currently available in the warehouse. ${agentHeld > 0 ? `${agentHeld} unit${agentHeld === 1 ? "" : "s"} are already with agents and cannot be adjusted here.` : "Agent stock cannot be adjusted here."}`
      });
      return;
    }

    const movType = change > 0 ? "Stock Added" : "Correction";
    let movementResult;
    try {
      [movementResult] = await applyInventoryMovements({
        orgId: req.user!.orgId,
        actorUserId: req.user!.id,
        actorName: req.user!.name,
        lines: [{
          productId,
          productName: product.name,
          type: movType,
          quantity: Math.abs(change),
          ledgerQuantity: change,
          sourceScope: change < 0 ? "warehouse" : null,
          destinationScope: change > 0 ? "warehouse" : null,
          note,
          idempotencyKey: parsed.data.requestId
            ?? (String(req.get("Idempotency-Key") ?? "").trim() || `warehouse-adjustment:${randomUUID()}`)
        }]
      });
    } catch (error: any) {
      const movementError = error instanceof InventoryMovementError ? error : null;
      res.status(movementError?.status ?? 500).json({
        error: movementError?.message ?? "Warehouse stock could not be updated.",
        code: movementError?.code ?? "INVENTORY_MOVEMENT_FAILED"
      });
      return;
    }
    if (!movementResult) {
      res.status(500).json({ error: "Warehouse stock update returned no result.", code: "INVENTORY_MOVEMENT_FAILED" });
      return;
    }
    const newStock = Number(
      change > 0 ? movementResult?.destinationBalanceAfter : movementResult?.sourceBalanceAfter
    );

    const { data: movement } = await supabase
      .from("stock_movements")
      .select("*")
      .eq("id", movementResult.movementId)
      .single();

    const movementLabel = change > 0 ? "added to" : "removed from";
    const movementMessage = `Warehouse stock ${movementLabel} ${product.name}: ${change > 0 ? "+" : "−"}${Math.abs(change)} unit${Math.abs(change) === 1 ? "" : "s"} · warehouse ${product.warehouse_stock} → ${newStock}${agentHeld > 0 ? ` · with agents ${agentHeld}` : ""} · reason: ${note} · by ${req.user!.name}`;
    const branding = await getOrgPushBranding(req.user!.orgId);
    await Promise.allSettled([
      supabase.from("system_notifications").insert({
        org_id: req.user!.orgId,
        type: "info",
        message: movementMessage,
        product_id: productId,
        title: "Warehouse stock adjusted",
        link: "/dashboard/admin/inventory"
      }),
      sendPushToRoles(req.user!.orgId, ["Owner", "Admin"], {
        title: "Warehouse stock adjusted",
        body: movementMessage,
        kind: "info",
        url: "/dashboard/admin/inventory",
        tag: `warehouse-stock-${productId}`,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
      })
    ]);

    // Check low stock threshold
    const wasAbove = product.warehouse_stock > product.reorder_point;
    const nowBelow = newStock <= product.reorder_point;
    if (change < 0 && wasAbove && nowBelow) {
      const message = `Low stock: ${product.name} — warehouse down to ${newStock} unit${newStock === 1 ? "" : "s"} (reorder point: ${product.reorder_point})`;
      await supabase.from("system_notifications").insert({
        org_id:     req.user!.orgId,
        type:       "low_stock",
        message,
        product_id: productId,
        title:      "Low Stock Alert",
        link:       "/dashboard/admin/inventory/state-stock"
      });
      await sendPushToRoles(req.user!.orgId, ["Owner", "Admin", "Inventory Manager", "Inventory Manager & Logistics Operations"], {
        title: "Low Stock Alert",
        body: message,
        kind: "low_stock",
        url: "/dashboard/admin/inventory",
        tag: `low-stock-${productId}`,
        brandName: branding.brandName,
        brandLogo: branding.brandLogo
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
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }
    res.status(410).json({
      error: "Ledger-only stock entries are disabled. Use the warehouse adjustment, agent stock, order delivery, or waybill action so the balance and ledger are committed together.",
      code: "LEDGER_ONLY_MOVEMENT_DISABLED"
    });
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
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
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

    // Build entries from the actual hub rows, not the legacy per-agent cache.
    // A physical count is tied to one place; changing the cache alone was a
    // direct source of cache-vs-hub drift.
    const { data: stocks } = await supabase
      .from("agent_location_stock")
      .select("agent_id, agent_location_id, product_id, quantity, agent:agents(name), location:agent_locations(name), product:products(name)")
      .in("agent_id", agentIds)
      .gt("quantity", 0);

    if (stocks && stocks.length > 0) {
      const entries = stocks.map((s: any) => ({
        session_id:   session.id,
        product_id:   s.product_id,
        product_name: s.product?.name ?? s.product_id,
        agent_id:     s.agent_id,
        agent_name:   s.agent?.name ?? s.agent_id,
        agent_location_id: s.agent_location_id,
        agent_location_name: s.location?.name ?? "Hub",
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
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
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
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
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

    const reasonLabel = writeoffReason === "Other" && writeoffCustom?.trim()
      ? writeoffCustom.trim()
      : writeoffReason;

    let locationId = entry.agent_location_id as string | null;
    let locationName = String(entry.agent_location_name ?? "").trim();
    if (!locationId) {
      const { data: locations } = await supabase
        .from("agent_locations")
        .select("id, name, is_primary")
        .eq("org_id", req.user!.orgId)
        .eq("agent_id", entry.agent_id)
        .eq("active", true)
        .order("is_primary", { ascending: false });
      if (!locations || locations.length !== 1) {
        res.status(409).json({
          error: "This older stock count is not tied to one hub. Start a new count so the correction is applied to the exact location.",
          code: "STOCK_COUNT_LOCATION_REQUIRED"
        });
        return;
      }
      locationId = locations[0].id;
      locationName = locations[0].name;
    }
    if (!entry.product_id) {
      res.status(409).json({ error: "The counted product no longer exists.", code: "STOCK_COUNT_PRODUCT_MISSING" });
      return;
    }

    const { data: liveStock, error: liveStockError } = await supabase
      .from("agent_location_stock")
      .select("quantity")
      .eq("org_id", req.user!.orgId)
      .eq("agent_location_id", locationId)
      .eq("product_id", entry.product_id)
      .maybeSingle();
    if (liveStockError) { res.status(500).json({ error: liveStockError.message }); return; }
    const liveQuantity = Number(liveStock?.quantity ?? 0);
    if (liveQuantity !== Number(entry.system_qty ?? 0)) {
      res.status(409).json({
        error: `Stock changed after this count started (${entry.system_qty} → ${liveQuantity}). Start a new count instead of overwriting newer movements.`,
        code: "STALE_STOCK_COUNT"
      });
      return;
    }

    const delta = Number(entry.agent_count) - liveQuantity;
    if (delta !== 0) {
      try {
        await applyInventoryMovements({
          orgId: req.user!.orgId,
          actorUserId: req.user!.id,
          actorName: req.user!.name,
          lines: [{
            productId: entry.product_id,
            productName: entry.product_name,
            type: delta > 0 ? "Correction" : (writeoffReason === "Return to Warehouse" ? "Return" : "Correction"),
            quantity: Math.abs(delta),
            ledgerQuantity: delta,
            sourceScope: delta < 0 ? "agent_location" : null,
            sourceAgentLocationId: delta < 0 ? locationId : null,
            destinationScope: delta > 0
              ? "agent_location"
              : (writeoffReason === "Return to Warehouse" ? "warehouse" : null),
            destinationAgentLocationId: delta > 0 ? locationId : null,
            agentId: entry.agent_id,
            fromLocation: delta < 0 ? locationName : null,
            toLocation: delta > 0 ? locationName : (writeoffReason === "Return to Warehouse" ? "Warehouse" : null),
            note: `Stock count: ${delta >= 0 ? "+" : ""}${delta} units — ${reasonLabel}`,
            idempotencyKey: `stock-count:${entry.id}:adjust:${entry.agent_count}`
          }]
        });
      } catch (error: any) {
        const movementError = error instanceof InventoryMovementError ? error : null;
        res.status(movementError?.status ?? 500).json({
          error: movementError?.message ?? "Stock count correction failed.",
          code: movementError?.code ?? "INVENTORY_MOVEMENT_FAILED"
        });
        return;
      }
    }

    // Book the cost of what went missing. Adjusting the quantity alone left the
    // loss invisible in the P&L - the write-off reason was recorded but never
    // cost anything. Only a shortfall (delta < 0) is a loss; a surplus means
    // the count found MORE than the system knew, which is not an expense.
    if (delta < 0) {
      await recordStockLossExpense({
        orgId: req.user!.orgId,
        reference: String(req.params.entryId),
        productId: entry.product_id,
        productName: entry.product_name ?? "Unknown product",
        units: Math.abs(delta),
        reason: reasonLabel,
        context: `Stock count — ${entry.agent_name ?? "agent"} · ${locationName}`
      });
    }

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

// ── POST /api/stock/smart-alerts/run ─────────────────────
// Manual trigger for the smart low-stock alert scan. Same logic as the
// hourly cron. Useful for owners/admins to refresh alerts on demand.
router.post("/smart-alerts/run",
  requireRole("Owner", "Admin"),
  async (_req, res) => {
    try {
      const summary = await runSmartStockAlerts();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err?.message ?? "Smart stock alert scan failed." });
    }
  }
);

export default router;
