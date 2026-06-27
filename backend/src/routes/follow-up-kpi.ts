import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getFollowUpBoard, getFollowUpGrid, runFollowUpClose } from "../lib/follow-up-kpi.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/follow-up-kpi/board ─────────────────────────
// Daily scoreboard: attended / due / unattended today, with the per-order Day-N and
// the 3-call requirement. Sales Reps always see their own; Owner/Admin/Manager may
// scope to a rep via ?repId= (omit for the whole org).
router.get("/board", async (req, res) => {
  const role = req.user!.role;
  const isPrivileged = role === "Owner" || role === "Admin" || role === "Manager";
  const repId = isPrivileged ? (typeof req.query.repId === "string" ? req.query.repId : null) : req.user!.id;
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
  const role = req.user!.role;
  const isPrivileged = role === "Owner" || role === "Admin" || role === "Manager";
  const repId = isPrivileged ? (typeof req.query.repId === "string" ? req.query.repId : null) : req.user!.id;
  const weekStart = typeof req.query.weekStart === "string" ? req.query.weekStart : undefined;
  try {
    const grid = await getFollowUpGrid(req.user!.orgId, repId, weekStart);
    res.json(grid);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/follow-up-kpi/misses ────────────────────────
// Owner/Admin review queue. ?state=pending|approved|waived (default pending).
router.get("/misses", requireRole("Owner", "Admin"), async (req, res) => {
  const state = typeof req.query.state === "string" ? req.query.state : "pending";
  let query = supabase
    .from("follow_up_misses")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .order("miss_date", { ascending: false })
    .order("rep_name", { ascending: true });
  if (state !== "all") query = query.eq("state", state);
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
