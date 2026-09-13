import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { applyBranchScope, requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);
// ⚠️ BOTH INVENTORY ROLES. "Inventory Manager" is a legacy enum value that
// editableUserRoles no longer offers - the role an inventory person can
// actually be given is "Inventory Manager & Logistics Operations", and this
// page lives inside that role's own sidebar. Listing only the legacy value
// would 403 the very person the workflow was built for, the moment Bright
// creates the account. Both are kept so existing holders are not locked out.
router.use(requireRole("Owner", "Admin", "Inventory Manager", "Inventory Manager & Logistics Operations"));

const SelectionSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1).max(100)
});
const FlagSchema = SelectionSchema.extend({
  note: z.string().trim().min(3).max(500)
});

const databaseFailure = (message: string) => {
  if (message.startsWith("INVENTORY_CONFLICT|")) {
    return { status: 409, code: "INVENTORY_CONFLICT", message: message.split("|").slice(1).join("|") };
  }
  if (message.startsWith("INSUFFICIENT_STOCK|")) {
    return { status: 409, code: "INSUFFICIENT_STOCK", message: message.split("|").slice(1).join("|") };
  }
  if (message.startsWith("INVALID_INVENTORY|")) {
    return { status: 400, code: "INVALID_INVENTORY", message: message.split("|").slice(1).join("|") };
  }
  return { status: 500, code: "RECONCILIATION_FAILED", message: message || "Could not reconcile delivered stock." };
};

router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  const orgId = req.user!.orgId;
  const { data: lines, error } = await applyBranchScope(supabase
    .from("delivered_stock_reconciliation_lines")
    .select("id, order_id, agent_id, agent_location_id, state_snapshot, agent_name_snapshot, customer_snapshot, product_id, product_name_snapshot, quantity, status, delivered_at, reconciled_at, reconciled_by_name, movement_id, issue_note")
    .eq("org_id", orgId)
    .in("status", ["pending", "exception", "reconciled"])
    .order("delivered_at", { ascending: false })
    .limit(5000), req);
  if (error) { res.status(500).json({ error: error.message }); return; }

  const locationIds = Array.from(new Set((lines ?? []).map((row: any) => String(row.agent_location_id)).filter(Boolean)));
  const productIds = Array.from(new Set((lines ?? []).map((row: any) => String(row.product_id)).filter(Boolean)));
  let stockRows: any[] = [];
  if (locationIds.length > 0 && productIds.length > 0) {
    const stockResult = await supabase
      .from("agent_location_stock")
      .select("agent_location_id, product_id, quantity, defective, missing")
      .eq("org_id", orgId)
      .in("agent_location_id", locationIds)
      .in("product_id", productIds);
    if (stockResult.error) { res.status(500).json({ error: stockResult.error.message }); return; }
    stockRows = stockResult.data ?? [];
  }
  const currentByLocationProduct = new Map(stockRows.map((row: any) => [
    `${row.agent_location_id}:${row.product_id}`,
    Math.max(0, Number(row.quantity ?? 0) - Number(row.defective ?? 0) - Number(row.missing ?? 0))
  ]));

  res.json({
    generatedAt: new Date().toISOString(),
    rows: (lines ?? []).map((row: any) => ({
      id: row.id,
      orderId: row.order_id,
      agentId: row.agent_id,
      agentLocationId: row.agent_location_id,
      state: row.state_snapshot || "Unassigned",
      agentName: row.agent_name_snapshot || "Unknown agent",
      customer: row.customer_snapshot || "Unknown customer",
      productId: row.product_id,
      productName: row.product_name_snapshot,
      quantity: Number(row.quantity ?? 0),
      status: row.status,
      deliveredAt: row.delivered_at,
      reconciledAt: row.reconciled_at,
      reconciledBy: row.reconciled_by_name,
      movementId: row.movement_id,
      issueNote: row.issue_note,
      currentStock: currentByLocationProduct.get(`${row.agent_location_id}:${row.product_id}`) ?? 0
    }))
  });
});

router.post("/reconcile", async (req, res) => {
  const parsed = SelectionSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Select between 1 and 100 eligible delivered orders." }); return; }
  const { data, error } = await supabase.rpc("reconcile_delivered_stock", {
    p_org_id: req.user!.orgId,
    p_line_ids: parsed.data.lineIds,
    p_actor_user_id: req.user!.id,
    p_actor_name: req.user!.name
  });
  if (error) {
    const failure = databaseFailure(error.message);
    res.status(failure.status).json({ error: failure.message, code: failure.code });
    return;
  }
  res.json(data);
});

router.post("/flag", async (req, res) => {
  const parsed = FlagSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Select eligible orders and provide a short issue description." }); return; }
  const { data, error } = await supabase.rpc("flag_delivered_stock_issue", {
    p_org_id: req.user!.orgId,
    p_line_ids: parsed.data.lineIds,
    p_note: parsed.data.note,
    p_actor_user_id: req.user!.id
  });
  if (error) {
    const failure = databaseFailure(error.message);
    res.status(failure.status).json({ error: failure.message, code: failure.code });
    return;
  }
  res.json({ flagged: Number(data ?? 0) });
});

router.post("/:lineId/resolve", async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.lineId);
  if (!parsed.success) { res.status(400).json({ error: "Invalid delivered stock line." }); return; }
  const { data, error } = await supabase.rpc("resolve_delivered_stock_issue", {
    p_org_id: req.user!.orgId,
    p_line_id: parsed.data
  });
  if (error) {
    const failure = databaseFailure(error.message);
    res.status(failure.status).json({ error: failure.message, code: failure.code });
    return;
  }
  res.json({ resolved: data === true });
});

export default router;
