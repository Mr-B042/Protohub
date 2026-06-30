import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { FOLLOW_UP_KPI_START_DATE, getFollowUpBoard, getFollowUpGrid, logFollowUpEntry, runFollowUpClose } from "../lib/follow-up-kpi.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/follow-up-kpi/board ─────────────────────────
// Daily scoreboard: attended / due / unattended today, with the per-order Day-N and
// the 3-call requirement. Sales Reps always see their own; Owner/Admin/Manager may
// scope to a rep via ?repId= (omit for the whole org).
router.get("/board", async (req, res) => {
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  const isPrivileged = role === "Owner" || role === "Admin" || role === "Manager";
  const repId = isPrivileged ? (typeof req.query.repId === "string" ? req.query.repId : null) : userId;
  const date = typeof req.query.date === "string" ? req.query.date : undefined;
  try {
    const board = await getFollowUpBoard(req.user!.orgId, repId, date);
    res.json(board);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/follow-up-kpi/grid ──────────────────────────
// Day-by-day log grid (orders × the week's working days). Sales Reps see their own;
// Owner/Admin/Manager may scope to a rep via ?repId=. ?weekStart=YYYY-MM-DD (Monday)
// for older weeks; defaults to the current week.
router.get("/grid", async (req, res) => {
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  const isPrivileged = role === "Owner" || role === "Admin" || role === "Manager";
  const repId = isPrivileged ? (typeof req.query.repId === "string" ? req.query.repId : null) : userId;
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : undefined;
  try {
    const grid = await getFollowUpGrid(req.user!.orgId, repId, weekStart);
    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/follow-up-kpi/log ──────────────────────────
// Grid cell logging: append a dated line to the order's call_outcome + record a
// structured attempt + optional promised date (auto-schedules the next follow-up).
router.post("/log", requireRole("Owner", "Admin", "Manager", "Sales Rep"), async (req, res) => {
  const orderId = typeof req.body?.orderId === "string" ? req.body.orderId : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const channels = Array.isArray(req.body?.channels) ? req.body.channels.filter((c: unknown) => typeof c === "string") : [];
  const promisedDate = typeof req.body?.promisedDate === "string" && req.body.promisedDate ? req.body.promisedDate : null;
  const promisedTime = typeof req.body?.promisedTime === "string" && /^\d{2}:\d{2}$/.test(req.body.promisedTime) ? req.body.promisedTime : null;
  const VALID_BUCKETS = ["ready_now", "call_tomorrow", "call_in_2_3_days", "salary_wait", "spouse_approval", "wants_discount", "asked_for_whatsapp", "no_answer", "switched_off", "line_busy", "not_interested", "wrong_number", "out_of_coverage"];
  const VALID_GROUPS = ["progress", "recoverable", "unreachable", "closed_loss", "other"];
  const recoveryBucket = typeof req.body?.recoveryBucket === "string" && VALID_BUCKETS.includes(req.body.recoveryBucket) ? req.body.recoveryBucket : null;
  const outcomeGroup = typeof req.body?.outcomeGroup === "string" && VALID_GROUPS.includes(req.body.outcomeGroup) ? req.body.outcomeGroup : null;
  if (!orderId || !text) { res.status(400).json({ error: "Order and a note are required." }); return; }

  const { data: order } = await supabase
    .from("orders")
    .select("id, assigned_rep_id")
    .eq("id", orderId)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();
  if (!order) { res.status(404).json({ error: "Order not found." }); return; }
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  if (role === "Sales Rep" && order.assigned_rep_id !== userId) {
    res.status(403).json({ error: "You can only log follow-ups on your own orders." });
    return;
  }
  try {
    const repId = role === "Sales Rep" ? userId : (order.assigned_rep_id ?? userId);
    await logFollowUpEntry(req.user!.orgId, orderId, repId, text, channels, promisedDate, recoveryBucket, outcomeGroup, promisedTime);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ── GET /api/follow-up-kpi/misses ────────────────────────
// Miss queue. Owner/Admin can review everyone; Sales Reps can only see their
// own pending/approved/waived misses so their personal debt is visible.
router.get("/misses", requireRole("Owner", "Admin", "Sales Rep"), async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "pending";
  const role = req.user!.effectiveUserRole ?? req.user!.role;
  const userId = req.user!.effectiveUserId ?? req.user!.id;
  let query = supabase
    .from("follow_up_misses")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .gte("miss_date", FOLLOW_UP_KPI_START_DATE) // never surface pre-go-live misses
    .order("miss_date", { ascending: false })
    .order("rep_name", { ascending: true });
  if (state !== "all") query = query.eq("state", state);
  if (role === "Sales Rep") query = query.eq("rep_id", userId);
  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

// ── POST /api/follow-up-kpi/misses/:id/approve ───────────
// Materialise the ₦50 charge as a rep_penalties row (the existing payroll/bonus
// deduction path), in the payroll month of the miss.
router.post("/misses/:id/approve", requireRole("Owner", "Admin"), async (req, res) => {
  const { data: miss, error: loadErr } = await supabase
    .from("follow_up_misses")
    .select("*")
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .maybeSingle();
  if (loadErr) { res.status(500).json({ error: loadErr.message }); return; }
  if (!miss) { res.status(404).json({ error: "Miss not found." }); return; }
  if (miss.state !== "pending") { res.status(409).json({ error: `Already ${miss.state}.` }); return; }
  if (!miss.rep_id) { res.status(400).json({ error: "Miss has no rep to charge." }); return; }

  const period = String(miss.miss_date).slice(0, 7); // YYYY-MM → payroll month
  const { data: penalty, error: penErr } = await supabase
    .from("rep_penalties")
    .insert({
      org_id: req.user!.orgId,
      rep_id: miss.rep_id,
      rep_name: miss.rep_name,
      type: "follow_up_miss",
      amount: miss.amount,
      remove_all_bonuses: false,
      period,
      order_id: miss.order_id,
      reason: `Missed follow-up on ${miss.miss_date} (order ${miss.order_id})`,
      by_name: req.user!.name
    })
    .select("id")
    .single();
  if (penErr) { res.status(500).json({ error: penErr.message }); return; }

  const { data: updated, error: updErr } = await supabase
    .from("follow_up_misses")
    .update({ state: "approved", penalty_id: penalty.id, reviewed_by: req.user!.name, reviewed_at: new Date().toISOString() })
    .eq("id", miss.id)
    .eq("org_id", req.user!.orgId)
    .select()
    .single();
  if (updErr) { res.status(500).json({ error: updErr.message }); return; }
  res.json(updated);
});

// ── POST /api/follow-up-kpi/misses/:id/waive ─────────────
router.post("/misses/:id/waive", requireRole("Owner", "Admin"), async (req, res) => {
  const { data, error } = await supabase
    .from("follow_up_misses")
    .update({ state: "waived", reviewed_by: req.user!.name, reviewed_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("org_id", req.user!.orgId)
    .eq("state", "pending")
    .select()
    .maybeSingle();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(409).json({ error: "Nothing to waive (not pending or not found)." }); return; }
  res.json(data);
});

// ── POST /api/follow-up-kpi/close ────────────────────────
// Manual trigger of the nightly close for a date (Owner/Admin; mainly for testing).
router.post("/close", requireRole("Owner", "Admin"), async (req, res) => {
  const date = typeof req.body?.date === "string" ? req.body.date : undefined;
  const result = await runFollowUpClose(req.user!.orgId, date);
  res.json(result);
});

export default router;
