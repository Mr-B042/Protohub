import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/agents ───────────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("agents")
    .select(`*, stock: agent_stock(product_id, quantity)`)
    .eq("org_id", req.user!.orgId)
    .order("name");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/agents ──────────────────────────────────────
const AgentSchema = z.object({
  name:   z.string().min(1),
  zone:   z.string().min(1),
  phone:  z.string().optional(),
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
    const { data, error } = await supabase
      .from("agents")
      .insert({ org_id: req.user!.orgId, ...parsed.data })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  }
);

// ── PATCH /api/agents/:id ─────────────────────────────────
const AgentPatchSchema = z.object({
  name:           z.string().min(1).max(120).optional(),
  zone:           z.string().min(1).max(80).optional(),
  phone:          z.string().max(40).optional(),
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
  if (parsed.data.zone !== undefined)           updates.zone           = parsed.data.zone;
  if (parsed.data.phone !== undefined)          updates.phone          = parsed.data.phone;
  if (parsed.data.status !== undefined)         updates.status         = parsed.data.status;
  if (parsed.data.stock_capacity !== undefined) updates.stock_capacity = parsed.data.stock_capacity;

  if (Object.keys(updates).length === 0) {
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
  res.json(data);
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

// ── GET /api/agents/:id/stock ─────────────────────────────
router.get("/:id/stock", async (req, res) => {
  const { data, error } = await supabase
    .from("agent_stock")
    .select("*, product: products(name, sku)")
    .eq("agent_id", req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ── POST /api/agents/:id/stock ────────────────────────────
// Assign / top-up stock for an agent
const AssignStockSchema = z.object({
  productId: z.string().uuid(),
  quantity:  z.number().int().min(1)
});

router.post("/:id/stock",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = AssignStockSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { productId, quantity } = parsed.data;
    const agentId = req.params.id;

    // Capacity check: sum all current stock for this agent
    const { data: agent } = await supabase
      .from("agents").select("name, stock_capacity").eq("id", agentId).single();
    const capacity = agent?.stock_capacity ?? 1000;

    const { data: allStock } = await supabase
      .from("agent_stock").select("quantity").eq("agent_id", agentId);
    const currentTotal = (allStock ?? []).reduce((sum, row) => sum + (row.quantity ?? 0), 0);

    if (currentTotal + quantity > capacity) {
      const available = Math.max(0, capacity - currentTotal);
      res.status(400).json({
        error: `Cannot assign — ${agent?.name ?? "Agent"} capacity is ${currentTotal}/${capacity}. Free up ${quantity - available} units first or increase capacity.`
      });
      return;
    }

    // Upsert agent stock
    const { data: existing } = await supabase
      .from("agent_stock")
      .select("quantity")
      .eq("agent_id", agentId)
      .eq("product_id", productId)
      .single();

    const newQty = (existing?.quantity ?? 0) + quantity;

    const { error: stockError } = await supabase
      .from("agent_stock")
      .upsert({ agent_id: agentId, product_id: productId, quantity: newQty });
    if (stockError) { res.status(500).json({ error: stockError.message }); return; }

    // Deduct from warehouse
    const { data: product } = await supabase
      .from("products")
      .select("warehouse_stock, name")
      .eq("id", productId)
      .single();
    if (product) {
      await supabase.from("products").update({
        warehouse_stock: Math.max(0, product.warehouse_stock - quantity),
        agent_stock: supabase.rpc("increment_agent_stock" as never, { x: quantity, product_id: productId } as never)
      }).eq("id", productId);

      // Log stock movement
      await supabase.from("stock_movements").insert({
        id:           `MOV-${randomUUID()}`,
        org_id:       req.user!.orgId,
        product_id:   productId,
        product_name: product.name,
        type:         "Distributed to Agent",
        qty:          quantity,
        balance_after: newQty,
        agent_id:     agentId,
        by_name:      req.user!.name,
        by_user_id:   req.user!.id,
        note:         `Assigned to agent`
      });
    }

    res.json({ agentId, productId, newQty });
  }
);

// ── POST /api/agents/:id/reconcile ───────────────────────
// Reconcile agent stock (returned, defective, missing)
const ReconcileSchema = z.object({
  productId: z.string().uuid(),
  returned:  z.number().int().min(0).default(0),
  defective: z.number().int().min(0).default(0),
  missing:   z.number().int().min(0).default(0),
  notes:     z.string().optional()
});

router.post("/:id/reconcile",
  requireRole("Owner", "Admin", "Inventory Manager"),
  async (req, res) => {
    const parsed = ReconcileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const { productId, returned, defective, missing, notes } = parsed.data;
    const agentId = req.params.id;
    const totalRemoved = returned + defective + missing;
    if (totalRemoved === 0) {
      res.status(400).json({ error: "Enter at least one quantity to reconcile." });
      return;
    }

    // Fetch current agent stock
    const { data: stock } = await supabase
      .from("agent_stock")
      .select("quantity, defective, missing")
      .eq("agent_id", agentId)
      .eq("product_id", productId)
      .single();

    if (!stock || stock.quantity < totalRemoved) {
      res.status(400).json({ error: `Not enough agent stock. Available: ${stock?.quantity ?? 0}` });
      return;
    }

    const nextQty = stock.quantity - totalRemoved;

    // Update agent stock
    await supabase.from("agent_stock").update({
      quantity: nextQty,
      defective: (stock.defective ?? 0) + defective,
      missing: (stock.missing ?? 0) + missing
    }).eq("agent_id", agentId).eq("product_id", productId);

    // Return good stock to warehouse
    if (returned > 0) {
      const { data: product } = await supabase.from("products").select("warehouse_stock, agent_stock, name").eq("id", productId).single();
      if (product) {
        await supabase.from("products").update({
          warehouse_stock: product.warehouse_stock + returned,
          agent_stock: Math.max(0, product.agent_stock - returned)
        }).eq("id", productId);

        await supabase.from("stock_movements").insert({
          id: `MOV-${randomUUID()}`, org_id: req.user!.orgId,
          product_id: productId, product_name: product.name,
          type: "Return", qty: returned,
          balance_after: product.warehouse_stock + returned,
          agent_id: agentId, by_name: req.user!.name, by_user_id: req.user!.id,
          note: `${returned} unit${returned !== 1 ? "s" : ""} returned to warehouse${notes ? ` — ${notes}` : ""}`
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
        id: `MOV-${randomUUID()}`, org_id: req.user!.orgId,
        product_id: productId, product_name: product?.name ?? productId,
        type: "Correction", qty: -(defective + missing),
        balance_after: nextQty, agent_id: agentId,
        by_name: req.user!.name, by_user_id: req.user!.id,
        note: `${parts.join(", ")} written off${notes ? ` — ${notes}` : ""}`
      });
    }

    res.json({ agentId, productId, quantity: nextQty });
  }
);

export default router;
