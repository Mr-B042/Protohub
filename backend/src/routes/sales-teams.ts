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
    .select("id, name, active, last_seen_at")
    .eq("org_id", req.user!.orgId);
  if (usersError) { res.status(500).json({ error: usersError.message }); return; }

  let ordersQuery = supabase
    .from("orders")
    .select("id, customer, assigned_rep_id, product_id, status, call_outcome, buyer_health, created_at, date, scheduled_date, scheduled_at, next_follow_up_at, last_contact_attempt_at, last_contact_attempt_outcome, notes, timeline_notes")
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
  const teamIds = (teams ?? []).map((team) => team.id);
  const tasksQuery = supabase
    .from("follow_up_tasks")
    .select("id, order_id, status, due_at, sla_minutes, completed_at")
    .eq("org_id", req.user!.orgId);
  const attemptsQuery = supabase
    .from("order_contact_attempts")
    .select("id, order_id, rep_id, attempted_at, outcome_code")
    .eq("org_id", req.user!.orgId);
  const managerActivitiesQuery = supabase
    .from("manager_activity_logs")
    .select("id, team_id, manager_id, actor_id, actor_name, order_id, rep_id, action_type, note, created_at")
    .eq("org_id", req.user!.orgId)
    .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  const whatsappMessagesQuery = supabase
    .from("whatsapp_messages")
    .select("id, order_id, trigger, status, created_at, sent_at, delivered_at")
    .eq("org_id", req.user!.orgId)
    .in("trigger", ["order_follow_up_rep", "order_follow_up_manager", "order_follow_up_owner"]);

  const { data: tasks, error: tasksError } = orderIds.length > 0
    ? await tasksQuery.in("order_id", orderIds)
    : { data: [], error: null };
  if (tasksError) { res.status(500).json({ error: tasksError.message }); return; }

  const { data: attempts, error: attemptsError } = orderIds.length > 0
    ? await attemptsQuery.in("order_id", orderIds)
    : { data: [], error: null };
  if (attemptsError) { res.status(500).json({ error: attemptsError.message }); return; }

  const { data: managerActivities, error: managerActivitiesError } = teamIds.length > 0
    ? await managerActivitiesQuery.in("team_id", teamIds)
    : { data: [], error: null };
  if (managerActivitiesError) { res.status(500).json({ error: managerActivitiesError.message }); return; }
  const { data: whatsappMessages, error: whatsappMessagesError } = orderIds.length > 0
    ? await whatsappMessagesQuery.in("order_id", orderIds)
    : { data: [], error: null };
  if (whatsappMessagesError) { res.status(500).json({ error: whatsappMessagesError.message }); return; }

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
      active: !!user.active,
      lastSeenAt: user.last_seen_at ?? undefined
    })),
    (orders ?? []).map((order) => ({
      id: order.id,
      customer: order.customer ?? undefined,
      assignedRepId: order.assigned_rep_id ?? undefined,
      productId: order.product_id ?? undefined,
      status: order.status ?? undefined,
      callOutcome: order.call_outcome ?? undefined,
      buyerHealth: order.buyer_health ?? undefined,
      createdAt: order.created_at ?? undefined,
      date: order.date ?? undefined,
      scheduledDate: order.scheduled_date ?? undefined,
      scheduledAt: order.scheduled_at ?? undefined,
      nextFollowUpAt: order.next_follow_up_at ?? undefined,
      lastContactAttemptAt: order.last_contact_attempt_at ?? undefined,
      lastContactAttemptOutcome: order.last_contact_attempt_outcome ?? undefined,
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
    })),
    (managerActivities ?? []).map((activity) => ({
      id: activity.id,
      teamId: activity.team_id,
      managerId: activity.manager_id ?? undefined,
      actorId: activity.actor_id ?? undefined,
      actorName: activity.actor_name ?? undefined,
      orderId: activity.order_id ?? undefined,
      repId: activity.rep_id ?? undefined,
      actionType: activity.action_type,
      note: activity.note ?? undefined,
      createdAt: activity.created_at
    })),
    (whatsappMessages ?? []).map((message) => ({
      id: message.id,
      orderId: message.order_id ?? undefined,
      trigger: message.trigger,
      status: message.status,
      createdAt: message.created_at,
      sentAt: message.sent_at ?? undefined,
      deliveredAt: message.delivered_at ?? undefined
    }))
  );

  res.json(result);
});

const ManagerActionSchema = z.object({
  orderId: z.string().min(1).optional().nullable(),
  actionType: z.enum(["reviewed_queue", "nudged_rep", "escalated_order", "manager_note"]),
  note: z.string().trim().max(1000).optional().nullable()
});

router.post("/:id/manager-actions", async (req, res) => {
  const parsed = ManagerActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { data: team, error: teamError } = await supabase
    .from("sales_teams")
    .select("id, name, lead_id, product_ids, member_ids")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();

  if (teamError) { res.status(500).json({ error: teamError.message }); return; }
  if (!team) { res.status(404).json({ error: "Team not found." }); return; }

  let orderId: string | null = parsed.data.orderId ?? null;
  let repId: string | null = null;
  if (orderId) {
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, assigned_rep_id, product_id")
      .eq("id", orderId)
      .eq("org_id", req.user!.orgId)
      .maybeSingle();
    if (orderError) { res.status(500).json({ error: orderError.message }); return; }
    if (!order) { res.status(404).json({ error: "Order not found." }); return; }

    const teamMemberIds = Array.isArray(team.member_ids) ? team.member_ids : [];
    const scopedProductIds = Array.isArray(team.product_ids) ? team.product_ids : [];
    if (!order.assigned_rep_id || !teamMemberIds.includes(order.assigned_rep_id)) {
      res.status(400).json({ error: "This order is not assigned to a rep in the selected team." });
      return;
    }
    if (scopedProductIds.length > 0 && (!order.product_id || !scopedProductIds.includes(order.product_id))) {
      res.status(400).json({ error: "This order is outside the team's product scope." });
      return;
    }
    repId = order.assigned_rep_id;
  }

  const managerId = team.lead_id ?? null;
  const { data, error } = await supabase
    .from("manager_activity_logs")
    .insert({
      org_id: req.user!.orgId,
      team_id: team.id,
      manager_id: managerId,
      actor_id: req.user!.id,
      actor_name: req.user!.name,
      order_id: orderId,
      rep_id: repId,
      action_type: parsed.data.actionType,
      note: parsed.data.note?.trim() || null
    })
    .select()
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
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

router.post("/:id/sync-agent-assignments", async (req, res) => {
  const { data: team, error: teamError } = await supabase
    .from("sales_teams")
    .select("id, name, lead_id, product_ids, member_ids")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();
  if (teamError) { res.status(500).json({ error: teamError.message }); return; }
  if (!team) { res.status(404).json({ error: "Team not found." }); return; }

  const userIds = [...new Set([...(team.lead_id ? [team.lead_id] : []), ...(Array.isArray(team.member_ids) ? team.member_ids : [])])];
  if (userIds.length === 0) {
    res.status(400).json({ error: "This team has no lead or members yet." });
    return;
  }

  const scopedProductIds = Array.isArray(team.product_ids) ? team.product_ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0) : [];
  const { data: agents, error: agentsError } = await supabase
    .from("agents")
    .select("id, locations:agent_locations(stock:agent_location_stock(product_id, quantity))")
    .eq("org_id", req.user!.orgId);
  if (agentsError) { res.status(500).json({ error: agentsError.message }); return; }

  const agentIds = (agents ?? [])
    .filter((agent: any) => {
      if (scopedProductIds.length === 0) return true;
      return (agent.locations ?? []).some((location: any) =>
        (location.stock ?? []).some((row: any) =>
          scopedProductIds.includes(String(row.product_id ?? ""))
          && Number(row.quantity ?? 0) > 0
        )
      );
    })
    .map((agent: any) => agent.id)
    .filter((id: unknown): id is string => typeof id === "string" && id.trim().length > 0);

  const { error: deleteError } = await supabase
    .from("user_agent_assignments")
    .delete()
    .eq("org_id", req.user!.orgId)
    .in("user_id", userIds);
  if (deleteError) { res.status(500).json({ error: deleteError.message }); return; }

  if (agentIds.length > 0) {
    const rows = userIds.flatMap((userId) => agentIds.map((agentId) => ({
      org_id: req.user!.orgId,
      user_id: userId,
      agent_id: agentId
    })));
    const { error: insertError } = await supabase
      .from("user_agent_assignments")
      .insert(rows);
    if (insertError) { res.status(500).json({ error: insertError.message }); return; }
  }

  res.json({
    teamId: team.id,
    teamName: team.name,
    userIds,
    agentIds,
    userCount: userIds.length,
    agentCount: agentIds.length,
    mode: scopedProductIds.length === 0 ? "all_products" : "team_products"
  });
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
