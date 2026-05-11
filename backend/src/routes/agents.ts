import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildCoverageRows } from "../lib/agent-coverage.js";
import { loadAgentLocations, syncAgentLocationsFromCoverage, syncAgentStockAggregate } from "../lib/agent-locations.js";
import { supabase } from "../lib/supabase.js";
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
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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
  stock_capacity: z.number().int().min(1).max(100_000).optional()
}).strict();

router.patch("/:id", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = AgentPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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
  quantity:  z.number().int().min(1)
});

router.post("/:id/stock",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const orgId = Array.isArray(req.user!.orgId) ? String(req.user!.orgId[0] ?? "") : String(req.user!.orgId);
    const parsed = AssignStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
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

    const locations = await loadAgentLocations(orgId, agentId);
    const targetLocation = (parsed.data.locationId
      ? locations.find((location) => location.id === parsed.data.locationId)
      : undefined) ?? locations.find((location) => location.is_primary) ?? locations[0];
    if (!targetLocation) {
      res.status(400).json({ error: "No stock location exists for this agent yet." });
      return;
    }

    // Upsert location stock first
    const { data: existing } = await supabase
      .from("agent_location_stock")
      .select("quantity")
      .eq("agent_location_id", targetLocation.id)
      .eq("product_id", productId)
      .single();

    const newQty = (existing?.quantity ?? 0) + quantity;

    const { error: stockError } = await supabase
      .from("agent_location_stock")
      .upsert({
        org_id: orgId,
        agent_id: agentId,
        agent_location_id: targetLocation.id,
        product_id: productId,
        quantity: newQty
      });
    if (stockError) { res.status(500).json({ error: stockError.message }); return; }

    const totals = await syncAgentStockAggregate(orgId, agentId, productId);

    // Deduct from warehouse
    const { data: product } = await supabase
      .from("products")
      .select("warehouse_stock, agent_stock, name")
      .eq("id", productId)
      .single();
    if (product) {
      await supabase.from("products").update({
        warehouse_stock: Math.max(0, product.warehouse_stock - quantity),
        agent_stock: (product.agent_stock ?? 0) + quantity
      }).eq("id", productId);

      // Log stock movement
      await supabase.from("stock_movements").insert({
        id:           `MOV-${randomUUID()}`,
        org_id:       orgId,
        product_id:   productId,
        product_name: product.name,
        type:         "Distributed to Agent",
        qty:          quantity,
        balance_after: newQty,
        agent_id:     agentId,
        to_agent_location_id: targetLocation.id,
        from_location: "Warehouse",
        to_location: `${targetLocation.name}${targetLocation.city ? "" : ""}`,
        by_name:      req.user!.name,
        by_user_id:   req.user!.id,
        note:         `Assigned to ${agent?.name ?? "agent"} at ${targetLocation.name}`
      });
    }

    res.json({
      agentId,
      productId,
      locationId: targetLocation.id,
      locationName: targetLocation.name,
      newQty,
      aggregateQty: totals.quantity
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
  notes:     z.string().optional()
});

router.post("/:id/reconcile",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const orgId = Array.isArray(req.user!.orgId) ? String(req.user!.orgId[0] ?? "") : String(req.user!.orgId);
    const parsed = ReconcileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { productId, returned, defective, missing, notes } = parsed.data;
    const agentId = Array.isArray(req.params.id) ? String(req.params.id[0] ?? "") : String(req.params.id);
    const totalRemoved = returned + defective + missing;
    if (totalRemoved === 0) {
      res.status(400).json({ error: "Enter at least one quantity to reconcile." });
      return;
    }

    const locations = await loadAgentLocations(orgId, agentId);
    const targetLocation = (parsed.data.locationId
      ? locations.find((location) => location.id === parsed.data.locationId)
      : undefined) ?? locations.find((location) => location.is_primary) ?? locations[0];
    if (!targetLocation) {
      res.status(400).json({ error: "No stock location exists for this agent yet." });
      return;
    }

    // Fetch current agent location stock
    const { data: stock } = await supabase
      .from("agent_location_stock")
      .select("quantity, defective, missing")
      .eq("agent_location_id", targetLocation.id)
      .eq("product_id", productId)
      .single();

    if (!stock || stock.quantity < totalRemoved) {
      res.status(400).json({ error: `Not enough agent stock. Available: ${stock?.quantity ?? 0}` });
      return;
    }

    const nextQty = stock.quantity - totalRemoved;

    // Update agent location stock
    await supabase.from("agent_location_stock").update({
      quantity: nextQty,
      defective: (stock.defective ?? 0) + defective,
      missing: (stock.missing ?? 0) + missing
    }).eq("agent_location_id", targetLocation.id).eq("product_id", productId);

    const totals = await syncAgentStockAggregate(orgId, agentId, productId);

    // Return good stock to warehouse
    if (returned > 0) {
      const { data: product } = await supabase.from("products").select("warehouse_stock, agent_stock, name").eq("id", productId).single();
      if (product) {
        await supabase.from("products").update({
          warehouse_stock: product.warehouse_stock + returned,
          agent_stock: Math.max(0, product.agent_stock - returned)
        }).eq("id", productId);

        await supabase.from("stock_movements").insert({
          id: `MOV-${randomUUID()}`, org_id: orgId,
          product_id: productId, product_name: product.name,
          type: "Return", qty: returned,
          balance_after: product.warehouse_stock + returned,
          from_agent_location_id: targetLocation.id,
          from_location: targetLocation.name,
          to_location: "Warehouse",
          agent_id: agentId, by_name: req.user!.name, by_user_id: req.user!.id,
          note: `${returned} unit${returned !== 1 ? "s" : ""} returned to warehouse from ${targetLocation.name}${notes ? ` — ${notes}` : ""}`
        });
      }
    }

    // Log write-off if defective/missing
    if (defective > 0 || missing > 0) {
      const { data: product } = await supabase.from("products").select("name").eq("id", productId).single();
      const parts: string[] = [];
      if (defective > 0) parts.push(`${defective} defective`);
      if (missing > 0) parts.push(`${missing} missing`);
      await supabase.from("stock_movements").insert({
          id: `MOV-${randomUUID()}`, org_id: orgId,
        product_id: productId, product_name: product?.name ?? productId,
        type: "Correction", qty: -(defective + missing),
        balance_after: nextQty, agent_id: agentId,
        from_agent_location_id: targetLocation.id,
        from_location: targetLocation.name,
        by_name: req.user!.name, by_user_id: req.user!.id,
        note: `${parts.join(", ")} written off at ${targetLocation.name}${notes ? ` — ${notes}` : ""}`
      });
    }

    res.json({ agentId, productId, locationId: targetLocation.id, quantity: nextQty, aggregateQty: totals.quantity });
  }
);

export default router;
