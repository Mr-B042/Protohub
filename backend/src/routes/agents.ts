import { Router } from "express";
import { humanFieldErrors } from "../lib/validation-message.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildCoverageRows } from "../lib/agent-coverage.js";
import { loadAgentLocations, syncAgentLocationsFromCoverage } from "../lib/agent-locations.js";
import { supabase } from "../lib/supabase.js";
import { recordStockLossExpense } from "../lib/stock-loss-expense.js";
import { applyInventoryMovements, InventoryMovementError } from "../lib/inventory-movements.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/agents ───────────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("agents")
    .select(`*, stock: agent_stock(product_id, quantity, defective, missing), coverage: agent_coverage(*), locations: agent_locations(*, stock: agent_location_stock(product_id, quantity, defective, missing))`)
    .eq("org_id", req.user!.orgId)
    .order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/agents ──────────────────────────────────────
const CoverageSchema = z.object({
  state: z.string().min(1),
  city: z.string().max(120).optional(),
  coverageType: z.enum(["local_delivery", "interstate_delivery", "pickup_hub"]).default("local_delivery"),
  priority: z.number().int().min(0).max(9999).default(100),
  active: z.boolean().default(true),
  slaDays: z.number().int().min(0).max(365).default(1),
  deliveryFeeRule: z.string().max(120).optional(),
  notes: z.string().max(500).optional()
});

const AgentSchema = z.object({
  name: z.string().min(1),
  zone: z.string().optional(),
  primaryBaseState: z.string().min(1).optional(),
  phone: z.string().optional(),
  whatsappPhone: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  coverage: z.array(CoverageSchema).default([]),
  status: z.enum(["Active", "Inactive", "Suspended"]).default("Active")
});

router.post("/",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const parsed = AgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }
    const primaryBaseState = (parsed.data.primaryBaseState ?? parsed.data.zone ?? "").trim();
    const coverageRows = buildCoverageRows(primaryBaseState, parsed.data.coverage);

    const { data, error } = await supabase
      .from("agents")
      .insert({
        org_id: req.user!.orgId,
        name: parsed.data.name,
        zone: primaryBaseState,
        primary_base_state: primaryBaseState,
        phone: parsed.data.phone?.trim() || null,
        whatsapp_phone: parsed.data.whatsappPhone?.trim() || null,
        address: parsed.data.address?.trim() || null,
        status: parsed.data.status
      })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }

    if (coverageRows.length > 0) {
      const { error: coverageError } = await supabase
        .from("agent_coverage")
        .insert(coverageRows.map((row) => ({
          agent_id: data.id,
          state: row.state,
          city: row.city,
          coverage_type: row.coverage_type,
          priority: row.priority,
          active: row.active,
          sla_days: row.sla_days,
          delivery_fee_rule: row.delivery_fee_rule,
          notes: row.notes
        })));
      if (coverageError) {
        await supabase.from("agents").delete().eq("id", data.id).eq("org_id", req.user!.orgId);
        res.status(500).json({ error: coverageError.message });
        return;
      }
    }

    await syncAgentLocationsFromCoverage(req.user!.orgId, data.id);

    const { data: fullAgent, error: reloadError } = await supabase
      .from("agents")
      .select(`*, stock: agent_stock(product_id, quantity, defective, missing), coverage: agent_coverage(*), locations: agent_locations(*, stock: agent_location_stock(product_id, quantity, defective, missing))`)
      .eq("org_id", req.user!.orgId)
      .eq("id", data.id)
      .single();
    if (reloadError) { res.status(500).json({ error: reloadError.message }); return; }
    res.status(201).json(fullAgent);
  }
);

// ── PATCH /api/agents/:id ─────────────────────────────────
const AgentPatchSchema = z.object({
  name:           z.string().min(1).max(120).optional(),
  zone:           z.string().min(1).max(80).optional(),
  primaryBaseState: z.string().min(1).max(80).optional(),
  phone:          z.string().max(40).optional(),
  whatsappPhone:  z.string().max(40).optional(),
  address:        z.string().max(500).optional(),
  coverage:       z.array(CoverageSchema).optional(),
  status:         z.enum(["Active", "Inactive", "Suspended"]).optional(),
  stock_capacity: z.number().int().min(1).max(100_000).optional(),
  monthlyRemittance: z.boolean().optional()
}).strict();

router.patch("/:id", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = AgentPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined)           updates.name           = parsed.data.name;
  if (parsed.data.zone !== undefined || parsed.data.primaryBaseState !== undefined) {
    const nextBaseState = (parsed.data.primaryBaseState ?? parsed.data.zone ?? "").trim();
    updates.zone = nextBaseState;
    updates.primary_base_state = nextBaseState;
  }
  if (parsed.data.phone !== undefined)          updates.phone          = parsed.data.phone;
  if (parsed.data.whatsappPhone !== undefined)  updates.whatsapp_phone = parsed.data.whatsappPhone || null;
  if (parsed.data.address !== undefined)        updates.address        = parsed.data.address || null;
  if (parsed.data.status !== undefined)         updates.status         = parsed.data.status;
  if (parsed.data.stock_capacity !== undefined) updates.stock_capacity = parsed.data.stock_capacity;
  if (parsed.data.monthlyRemittance !== undefined) updates.monthly_remittance = parsed.data.monthlyRemittance;

  if (Object.keys(updates).length === 0 && parsed.data.coverage === undefined) {
    res.status(400).json({ error: "No fields to update." });
    return;
  }
  const { data, error } = await supabase
    .from("agents")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data)  { res.status(404).json({ error: "Agent not found." }); return; }

  if (parsed.data.coverage !== undefined) {
    const primaryBaseState = String(data.primary_base_state ?? data.zone ?? "");
    const coverageRows = buildCoverageRows(primaryBaseState, parsed.data.coverage);
    const { error: deleteCoverageError } = await supabase
      .from("agent_coverage")
      .delete()
      .eq("agent_id", data.id);
    if (deleteCoverageError) {
      res.status(500).json({ error: deleteCoverageError.message });
      return;
    }
    if (coverageRows.length > 0) {
      const { error: coverageError } = await supabase
        .from("agent_coverage")
        .insert(coverageRows.map((row) => ({
          agent_id: data.id,
          state: row.state,
          city: row.city,
          coverage_type: row.coverage_type,
          priority: row.priority,
          active: row.active,
          sla_days: row.sla_days,
          delivery_fee_rule: row.delivery_fee_rule,
          notes: row.notes
        })));
      if (coverageError) {
        res.status(500).json({ error: coverageError.message });
        return;
      }
    }
  }

  await syncAgentLocationsFromCoverage(req.user!.orgId, data.id);

  const { data: fullAgent, error: reloadError } = await supabase
    .from("agents")
    .select(`*, stock: agent_stock(product_id, quantity, defective, missing), coverage: agent_coverage(*), locations: agent_locations(*, stock: agent_location_stock(product_id, quantity, defective, missing))`)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .single();
  if (reloadError) { res.status(500).json({ error: reloadError.message }); return; }
  res.json(fullAgent);
});

// ── DELETE /api/agents/:id ────────────────────────────────
router.delete("/:id", requireRole("Owner", "Admin"), async (req, res) => {
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, name, locations:agent_locations(id, name, stock:agent_location_stock(product_id, quantity, defective, missing, product:products(name)))")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .single();
  if (agentError || !agent) { res.status(404).json({ error: "Agent not found." }); return; }

  const stockRows = (agent.locations ?? []).flatMap((location: any) =>
    (location.stock ?? []).map((row: any) => ({ location, row }))
  );
  const unresolved = stockRows.filter(({ row }: any) => Number(row.defective ?? 0) > 0 || Number(row.missing ?? 0) > 0);
  if (unresolved.length > 0) {
    res.status(409).json({
      error: "This agent still has defective or missing stock under investigation. Reconcile those units before deleting the agent.",
      code: "AGENT_HAS_UNRESOLVED_STOCK"
    });
    return;
  }

  const returnLines: Parameters<typeof applyInventoryMovements>[0]["lines"] = stockRows
    .filter(({ row }: any) => Number(row.quantity ?? 0) > 0)
    .map(({ location, row }: any) => ({
      productId: row.product_id,
      productName: row.product?.name ?? row.product_id,
      type: "Return",
      quantity: Number(row.quantity),
      sourceScope: "agent_location" as const,
      sourceAgentLocationId: location.id,
      destinationScope: "warehouse" as const,
      agentId: agent.id,
      fromLocation: location.name,
      toLocation: "Warehouse",
      note: `All available stock returned before agent "${agent.name}" was deleted`,
      idempotencyKey: `agent:${agent.id}:delete-return:${location.id}:${row.product_id}`
    }));
  if (returnLines.length > 100) {
    res.status(409).json({ error: "This agent has too many stock lines to delete safely in one operation. Contact support.", code: "AGENT_DELETE_BATCH_TOO_LARGE" });
    return;
  }
  if (returnLines.length > 0) {
    try {
      await applyInventoryMovements({
        orgId: req.user!.orgId,
        actorUserId: req.user!.id,
        actorName: req.user!.name,
        lines: returnLines
      });
    } catch (error: any) {
      const movementError = error instanceof InventoryMovementError ? error : null;
      res.status(movementError?.status ?? 500).json({
        error: movementError?.message ?? "Agent stock could not be returned safely.",
        code: movementError?.code ?? "INVENTORY_MOVEMENT_FAILED"
      });
      return;
    }
  }

  const { error } = await supabase
    .from("agents")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

// ── GET /api/agents/:id/locations ────────────────────────
router.get("/:id/locations", async (req, res) => {
  try {
    const orgId = Array.isArray(req.user!.orgId) ? String(req.user!.orgId[0] ?? "") : String(req.user!.orgId);
    const locations = await loadAgentLocations(orgId, req.params.id);
    res.json(locations);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load agent locations." });
  }
});

// ── GET /api/agents/:id/stock ─────────────────────────────
router.get("/:id/stock", async (req, res) => {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : "";
  const sourceTable = locationId ? "agent_location_stock" : "agent_stock";
  let query = supabase
    .from(sourceTable)
    .select(locationId
      ? "*, product: products(name, sku), location: agent_locations(id, name, state, city, is_primary)"
      : "*, product: products(name, sku)")
    .eq("agent_id", req.params.id);
  if (locationId) query = query.eq("agent_location_id", locationId);
  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/agents/:id/stock ────────────────────────────
// Assign / top-up stock for an agent
const AssignStockSchema = z.object({
  locationId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  quantity:  z.number().int().min(1),
  requestId: z.string().trim().min(8).max(160).optional()
});

router.post("/:id/stock",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const orgId = Array.isArray(req.user!.orgId) ? String(req.user!.orgId[0] ?? "") : String(req.user!.orgId);
    const parsed = AssignStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }
    const { productId, quantity } = parsed.data;
    const agentId = Array.isArray(req.params.id) ? String(req.params.id[0] ?? "") : String(req.params.id);

    // Capacity check: sum all current stock for this agent
    const { data: agent } = await supabase
      .from("agents").select("name, stock_capacity").eq("id", agentId).single();
    const capacity = agent?.stock_capacity ?? 1000;

    const { data: allStock } = await supabase
      .from("agent_location_stock").select("quantity").eq("agent_id", agentId);
    const currentTotal = (allStock ?? []).reduce((sum, row) => sum + (row.quantity ?? 0), 0);

    if (currentTotal + quantity > capacity) {
      const available = Math.max(0, capacity - currentTotal);
      res.status(400).json({
        error: `Cannot assign — ${agent?.name ?? "Agent"} capacity is ${currentTotal}/${capacity}. Free up ${quantity - available} units first or increase capacity.`
      });
      return;
    }

    let locations = await loadAgentLocations(orgId, agentId);
    if (locations.length === 0) {
      locations = await syncAgentLocationsFromCoverage(orgId, agentId);
    }
    const targetLocation = (parsed.data.locationId
      ? locations.find((location) => location.id === parsed.data.locationId)
      : undefined) ?? locations.find((location) => location.is_primary) ?? locations[0];
    if (!targetLocation) {
      res.status(400).json({ error: "No stock location exists for this agent yet." });
      return;
    }

    const { data: product } = await supabase
      .from("products")
      .select("warehouse_stock, agent_stock, name")
      .eq("org_id", orgId)
      .eq("id", productId)
      .single();
    if (!product) { res.status(404).json({ error: "Product not found." }); return; }

    let movement;
    try {
      [movement] = await applyInventoryMovements({
        orgId,
        actorUserId: req.user!.id,
        actorName: req.user!.name,
        lines: [{
          productId,
          productName: product.name,
          type: "Distributed to Agent",
          quantity,
          sourceScope: "warehouse",
          destinationScope: "agent_location",
          destinationAgentLocationId: targetLocation.id,
          agentId,
          fromLocation: "Warehouse",
          toLocation: targetLocation.name,
          note: `Assigned to ${agent?.name ?? "agent"} at ${targetLocation.name}`,
          idempotencyKey: parsed.data.requestId
            ?? (String(req.get("Idempotency-Key") ?? "").trim() || `agent-assignment:${randomUUID()}`)
        }]
      });
    } catch (error: any) {
      const movementError = error instanceof InventoryMovementError ? error : null;
      res.status(movementError?.status ?? 500).json({
        error: movementError?.message ?? "Agent stock assignment failed.",
        code: movementError?.code ?? "INVENTORY_MOVEMENT_FAILED"
      });
      return;
    }

    const { data: aggregate } = await supabase
      .from("agent_stock")
      .select("quantity")
      .eq("agent_id", agentId)
      .eq("product_id", productId)
      .maybeSingle();
    const newQty = Number(movement?.destinationBalanceAfter ?? 0);

    res.json({
      agentId,
      productId,
      locationId: targetLocation.id,
      locationName: targetLocation.name,
      newQty,
      aggregateQty: Number(aggregate?.quantity ?? newQty)
    });
  }
);

// ── POST /api/agents/:id/reconcile ───────────────────────
// Reconcile agent stock (returned, defective, missing)
const ReconcileSchema = z.object({
  locationId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  returned:  z.number().int().min(0).default(0),
  defective: z.number().int().min(0).default(0),
  missing:   z.number().int().min(0).default(0),
  notes:     z.string().optional(),
  requestId: z.string().trim().min(8).max(160).optional()
});

router.post("/:id/reconcile",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const orgId = Array.isArray(req.user!.orgId) ? String(req.user!.orgId[0] ?? "") : String(req.user!.orgId);
    const parsed = ReconcileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }
    const { productId, returned, defective, missing, notes } = parsed.data;
    const agentId = Array.isArray(req.params.id) ? String(req.params.id[0] ?? "") : String(req.params.id);
    const totalRemoved = returned + defective + missing;
    if (totalRemoved === 0) {
      res.status(400).json({ error: "Enter at least one quantity to reconcile." });
      return;
    }

    let locations = await loadAgentLocations(orgId, agentId);
    if (locations.length === 0) {
      locations = await syncAgentLocationsFromCoverage(orgId, agentId);
    }
    const targetLocation = (parsed.data.locationId
      ? locations.find((location) => location.id === parsed.data.locationId)
      : undefined) ?? locations.find((location) => location.is_primary) ?? locations[0];
    if (!targetLocation) {
      res.status(400).json({ error: "No stock location exists for this agent yet." });
      return;
    }

    const stockAcrossLocations = locations
      .map((location) => {
        const rows = Array.isArray(location.stock) ? location.stock : [];
        const totals = rows.reduce<{ quantity: number; defective: number; missing: number }>((acc, row) => {
          const rowProductId = String(row.product_id ?? row.productId ?? "");
          if (rowProductId !== productId) return acc;
          return {
            quantity: acc.quantity + Math.max(0, Number(row.quantity ?? 0)),
            defective: acc.defective + Math.max(0, Number(row.defective ?? 0)),
            missing: acc.missing + Math.max(0, Number(row.missing ?? 0))
          };
        }, { quantity: 0, defective: 0, missing: 0 });
        return {
          location,
          ...totals
        };
      })
      .filter((row) => row.quantity > 0 || row.defective > 0 || row.missing > 0);
    const stockInOtherLocations = stockAcrossLocations.filter((row) => row.location.id !== targetLocation.id && row.quantity > 0);

    // Fetch current agent location stock
    const { data: currentStockRow, error: stockError } = await supabase
      .from("agent_location_stock")
      .select("quantity, defective, missing")
      .eq("agent_location_id", targetLocation.id)
      .eq("product_id", productId)
      .maybeSingle();
    if (stockError) {
      res.status(500).json({ error: stockError.message });
      return;
    }

    const stock = currentStockRow
      ? {
          quantity: Math.max(0, Number(currentStockRow.quantity ?? 0)),
          defective: Math.max(0, Number(currentStockRow.defective ?? 0)),
          missing: Math.max(0, Number(currentStockRow.missing ?? 0))
        }
      : null;

    const currentQuantity = Number(stock?.quantity ?? 0);

    if (currentQuantity < totalRemoved) {
      if (currentQuantity <= 0 && stockInOtherLocations.length > 0) {
        const otherHubSummary = stockInOtherLocations
          .map((row) => `${row.location.name} (${row.quantity})`)
          .join(", ");
        res.status(400).json({
          error: `No stock is available in ${targetLocation.name}. This item is currently stocked in: ${otherHubSummary}.`
        });
        return;
      }
      res.status(400).json({ error: `Not enough agent stock. Available: ${currentQuantity}` });
      return;
    }

    const nextQty = currentQuantity - totalRemoved;

    const { data: product } = await supabase.from("products")
      .select("name").eq("id", productId).eq("org_id", orgId).single();
    if (!product) { res.status(404).json({ error: "Product not found." }); return; }

    const requestKey = parsed.data.requestId
      ?? (String(req.get("Idempotency-Key") ?? "").trim() || `agent-reconcile:${randomUUID()}`);
    const movementLines: Parameters<typeof applyInventoryMovements>[0]["lines"] = [];

    // Return good stock to warehouse
    if (returned > 0) {
      movementLines.push({
        productId,
        productName: product.name,
        type: "Return",
        quantity: returned,
        sourceScope: "agent_location",
        sourceAgentLocationId: targetLocation.id,
        destinationScope: "warehouse",
        agentId,
        fromLocation: targetLocation.name,
        toLocation: "Warehouse",
        note: `${returned} unit${returned !== 1 ? "s" : ""} returned to warehouse from ${targetLocation.name}${notes ? ` — ${notes}` : ""}`,
        idempotencyKey: `${requestKey}:return`
      });
    }

    // Log write-off if defective/missing
    if (defective > 0 || missing > 0) {
      const parts: string[] = [];
      if (defective > 0) parts.push(`${defective} defective`);
      if (missing > 0) parts.push(`${missing} missing`);
      movementLines.push({
        productId,
        productName: product.name,
        type: "Correction",
        quantity: defective + missing,
        ledgerQuantity: -(defective + missing),
        sourceScope: "agent_location",
        sourceAgentLocationId: targetLocation.id,
        bucketAgentLocationId: targetLocation.id,
        defectiveDelta: defective,
        missingDelta: missing,
        agentId,
        fromLocation: targetLocation.name,
        note: `${parts.join(", ")} written off at ${targetLocation.name}${notes ? ` — ${notes}` : ""}`,
        idempotencyKey: `${requestKey}:loss`
      });
    }

    let movementResults;
    try {
      movementResults = await applyInventoryMovements({
        orgId,
        actorUserId: req.user!.id,
        actorName: req.user!.name,
        lines: movementLines
      });
    } catch (error: any) {
      const movementError = error instanceof InventoryMovementError ? error : null;
      res.status(movementError?.status ?? 500).json({
        error: movementError?.message ?? "Agent stock reconciliation failed.",
        code: movementError?.code ?? "INVENTORY_MOVEMENT_FAILED"
      });
      return;
    }

    // Book the cost only after the atomic inventory transaction succeeds.
    if (defective > 0 || missing > 0) {
      const movementId = movementResults.find((row) => row.idempotencyKey.endsWith(":loss"))?.movementId
        ?? `${requestKey}:loss`;
      // These units are gone and were never sold, so their cost has never been
      // recognised anywhere. Booking it here is what makes shrinkage show up in
      // the P&L instead of quietly flattering net profit. `returned` is excluded
      // above - those units came back and are still ours.
      await recordStockLossExpense({
        orgId,
        reference: movementId,
        productId,
        productName: product.name,
        units: defective + missing,
        reason: defective > 0 && missing > 0 ? "Damaged and missing"
          : defective > 0 ? "Damaged" : "Missing",
        context: `Agent reconcile — ${targetLocation.name}`
      });
    }

    const { data: totals } = await supabase.from("agent_stock")
      .select("quantity").eq("agent_id", agentId).eq("product_id", productId).maybeSingle();
    res.json({ agentId, productId, locationId: targetLocation.id, quantity: nextQty, aggregateQty: Number(totals?.quantity ?? nextQty) });
  }
);

export default router;
