import { Router } from "express";
import { z } from "zod";
import { buildManagerPerformance } from "../lib/manager-performance.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin"));

// ── GET /api/sales-teams ─────────────────────────────────
router.get("/", async (req, res) => {
  const { data, error } = await supabase
    .from("sales_teams")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

const PerformanceQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  productIds: z.string().optional()
});

router.get("/performance", async (req, res) => {
  const parsed = PerformanceQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const productIds = (parsed.data.productIds ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const { data: teams, error: teamsError } = await supabase
    .from("sales_teams")
    .select("id, name, lead_id, product_ids, member_ids")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  if (teamsError) { res.status(500).json({ error: teamsError.message }); return; }

  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, name, active")
    .eq("org_id", req.user!.orgId);
  if (usersError) { res.status(500).json({ error: usersError.message }); return; }

  let ordersQuery = supabase
    .from("orders")
    .select("id, assigned_rep_id, product_id, status, call_outcome, buyer_health, created_at, date, scheduled_date, scheduled_at, notes, timeline_notes")
    .eq("org_id", req.user!.orgId);

  if (parsed.data.dateFrom) {
    ordersQuery = ordersQuery.gte("created_at", `${parsed.data.dateFrom}T00:00:00.000Z`);
  }
  if (parsed.data.dateTo) {
    ordersQuery = ordersQuery.lte("created_at", `${parsed.data.dateTo}T23:59:59.999Z`);
  }
  if (productIds.length > 0) {
    ordersQuery = ordersQuery.in("product_id", productIds);
  }

  const { data: orders, error: ordersError } = await ordersQuery;
  if (ordersError) { res.status(500).json({ error: ordersError.message }); return; }

  const orderIds = (orders ?? []).map((order) => order.id);
  const tasksQuery = supabase
    .from("follow_up_tasks")
    .select("id, order_id, status, due_at, sla_minutes, completed_at")
    .eq("org_id", req.user!.orgId);
  const attemptsQuery = supabase
    .from("order_contact_attempts")
    .select("id, order_id, rep_id, attempted_at, outcome_code")
    .eq("org_id", req.user!.orgId);

  const { data: tasks, error: tasksError } = orderIds.length > 0
    ? await tasksQuery.in("order_id", orderIds)
    : { data: [], error: null };
  if (tasksError) { res.status(500).json({ error: tasksError.message }); return; }

  const { data: attempts, error: attemptsError } = orderIds.length > 0
    ? await attemptsQuery.in("order_id", orderIds)
    : { data: [], error: null };
  if (attemptsError) { res.status(500).json({ error: attemptsError.message }); return; }

  const result = buildManagerPerformance(
    (teams ?? []).map((team) => ({
      id: team.id,
      name: team.name,
      leadId: team.lead_id ?? undefined,
      productIds: Array.isArray(team.product_ids) ? team.product_ids : [],
      memberIds: Array.isArray(team.member_ids) ? team.member_ids : []
    })),
    (users ?? []).map((user) => ({
      id: user.id,
      name: user.name,
      active: !!user.active
    })),
    (orders ?? []).map((order) => ({
      id: order.id,
      assignedRepId: order.assigned_rep_id ?? undefined,
      productId: order.product_id ?? undefined,
      status: order.status ?? undefined,
      callOutcome: order.call_outcome ?? undefined,
      buyerHealth: order.buyer_health ?? undefined,
      createdAt: order.created_at ?? undefined,
      date: order.date ?? undefined,
      scheduledDate: order.scheduled_date ?? undefined,
      scheduledAt: order.scheduled_at ?? undefined,
      notes: order.notes,
      timeline_notes: order.timeline_notes
    })),
    (tasks ?? []).map((task) => ({
      id: task.id,
      orderId: task.order_id,
      status: task.status,
      dueAt: task.due_at,
      slaMinutes: task.sla_minutes,
      completedAt: task.completed_at
    })),
    (attempts ?? []).map((attempt) => ({
      id: attempt.id,
      orderId: attempt.order_id,
      repId: attempt.rep_id ?? undefined,
      attemptedAt: attempt.attempted_at,
      outcomeCode: attempt.outcome_code
    }))
  );

  res.json(result);
});

// ── POST /api/sales-teams ────────────────────────────────
const TeamSchema = z.object({
  name:       z.string().min(1).max(120),
  leadId:     z.string().uuid().optional(),
  productIds: z.array(z.string().uuid()).default([]),
  memberIds:  z.array(z.string().uuid()).default([])
});

/** Verify every UUID in `ids` belongs to a row in `table` for the caller's org. */
async function checkOrgUuids(table: "users" | "products", ids: string[], orgId: string): Promise<string | null> {
  if (ids.length === 0) return null;
  const { data } = await supabase.from(table).select("id").in("id", ids).eq("org_id", orgId);
  const found = new Set((data ?? []).map((r) => r.id));
  const missing = ids.filter((id) => !found.has(id));
  return missing.length ? `Cross-org reference: ${missing.length} ${table} id(s) not in your organization.` : null;
}

router.post("/", async (req, res) => {
  const parsed = TeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, leadId, productIds, memberIds } = parsed.data;

  const allUserIds = [...new Set([...(leadId ? [leadId] : []), ...memberIds])];
  const userErr    = await checkOrgUuids("users", allUserIds, req.user!.orgId);
  if (userErr) { res.status(400).json({ error: userErr }); return; }
  const productErr = await checkOrgUuids("products", productIds, req.user!.orgId);
  if (productErr) { res.status(400).json({ error: productErr }); return; }

  const { data, error } = await supabase
    .from("sales_teams")
    .insert({ org_id: req.user!.orgId, name, lead_id: leadId ?? null, product_ids: productIds, member_ids: memberIds })
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// ── PATCH /api/sales-teams/:id ───────────────────────────
const TeamPatchSchema = z.object({
  name:       z.string().min(1).max(120).optional(),
  lead_id:    z.string().uuid().nullable().optional(),
  product_ids: z.array(z.string().uuid()).optional(),
  member_ids:  z.array(z.string().uuid()).optional()
}).strict();

router.patch("/:id", async (req, res) => {
  const parsed = TeamPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const userIdsToCheck = [
    ...(parsed.data.lead_id ? [parsed.data.lead_id] : []),
    ...(parsed.data.member_ids ?? [])
  ];
  if (userIdsToCheck.length) {
    const userErr = await checkOrgUuids("users", [...new Set(userIdsToCheck)], req.user!.orgId);
    if (userErr) { res.status(400).json({ error: userErr }); return; }
  }
  if (parsed.data.product_ids?.length) {
    const productErr = await checkOrgUuids("products", parsed.data.product_ids, req.user!.orgId);
    if (productErr) { res.status(400).json({ error: productErr }); return; }
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined)        updates.name        = parsed.data.name;
  if (parsed.data.lead_id !== undefined)     updates.lead_id     = parsed.data.lead_id;
  if (parsed.data.product_ids !== undefined) updates.product_ids = parsed.data.product_ids;
  if (parsed.data.member_ids !== undefined)  updates.member_ids  = parsed.data.member_ids;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update." });
    return;
  }

  const { data, error } = await supabase
    .from("sales_teams")
    .update(updates)
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Team not found." }); return; }
  res.json(data);
});

// ── DELETE /api/sales-teams/:id ──────────────────────────
router.delete("/:id", async (req, res) => {
  const { error } = await supabase
    .from("sales_teams")
    .delete()
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
