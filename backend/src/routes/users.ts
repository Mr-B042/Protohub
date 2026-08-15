import { Router } from "express";
import { humanFieldErrors } from "../lib/validation-message.js";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, invalidateUserProfile } from "../middleware/auth.js";
import { loadAssignedAgentIdsByUser } from "../lib/user-agent-assignments.js";
import { sanitizeMarketingAttributionTags } from "../lib/marketing-attribution.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/users ───────────────────────────────────────
// Returns all users in the caller's org.
router.get("/", async (req, res) => {
  let query = supabase
    .from("users")
    .select("id, name, email, phone, role, active, round_robin_excluded, is_demo, is_head_of_sales_rep, head_of_sales_rep_appointed_at, created_at, last_seen_at, agent_balance_scope_mode, agent_balance_state_scope, agent_balance_agent_ids, marketing_attribution_tags")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: true });

  if (req.user!.role === "Marketer") {
    query = query.eq("id", req.user!.id);
  }

  const { data, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }
  try {
    const assignedAgentIdsByUser = await loadAssignedAgentIdsByUser(req.user!.orgId, (data ?? []).map((row) => row.id));
    res.json((data ?? []).map((row) => ({
      ...row,
      marketing_attribution_tags: sanitizeMarketingAttributionTags(row.marketing_attribution_tags),
      assigned_agent_ids: assignedAgentIdsByUser.get(row.id) ?? []
    })));
  } catch (assignmentError: any) {
    res.status(500).json({ error: assignmentError?.message ?? "Failed to load assigned agents." });
  }
});

// ── GET /api/users/presence ──────────────────────────────
// Compact presence snapshot for the management screen. Keeping this separate
// from GET /api/users avoids repeatedly sending profiles, permissions, and
// agent assignments just to recover from a missed realtime event.
router.get("/presence", requireRole("Owner", "Admin", "Manager"), async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("id, active, last_seen_at")
    .eq("org_id", req.user!.orgId)
    .order("last_seen_at", { ascending: false, nullsFirst: false });

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.setHeader("Cache-Control", "private, no-store");
  res.json({
    serverTime: new Date().toISOString(),
    users: data ?? []
  });
});

// ── PATCH /api/users/:id ─────────────────────────────────
// Owner/Admin can update name, email, active status of any org member.
const UserPatchSchema = z.object({
  name:   z.string().min(1).max(120).optional(),
  email:  z.string().email().optional(),
  phone:  z.string().trim().max(40).optional(),
  active: z.boolean().optional(),
  // Marks an account as a testing one: still fully usable in-app, removed from
  // payroll, round-robin, bonuses, leaderboards, assignment and headcounts.
  isDemo: z.boolean().optional(),
  // Org-wide leadership oversight of ALL sales reps, independent of
  // sales_teams.lead_id. Owner only - unlocks the Head of Sales Rep dashboard.
  isHeadOfSalesRep: z.boolean().optional()
}).strict();

router.patch("/:id",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const parsed = UserPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: humanFieldErrors(parsed.error) });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined)   updates.name   = parsed.data.name;
    if (parsed.data.email !== undefined)  updates.email  = parsed.data.email;
    if (parsed.data.phone !== undefined)  updates.phone  = parsed.data.phone.trim() || null;
    if (parsed.data.active !== undefined) updates.active = parsed.data.active;
    // Owner only. Turning a real person into a demo account would silently take
    // them out of payroll and their own bonuses, so an Admin cannot do it.
    if (parsed.data.isDemo !== undefined) {
      if (req.user!.role !== "Owner") {
        res.status(403).json({ error: "Only the Owner can mark an account as a demo account." });
        return;
      }
      updates.is_demo = parsed.data.isDemo;
    }
    // Owner only, and only ever granted to a Sales Rep - the whole dashboard
    // this unlocks assumes the person is one of the reps being led.
    // head_of_sales_rep_appointed_at is set once, on the false->true edge, and
    // never touched again while the flag stays true, so re-toggling later
    // cannot quietly restart someone's 90-day appointment clock.
    if (parsed.data.isHeadOfSalesRep !== undefined) {
      if (req.user!.role !== "Owner") {
        res.status(403).json({ error: "Only the Owner can grant or remove Head of Sales Rep." });
        return;
      }
      const { data: target, error: targetError } = await supabase
        .from("users")
        .select("role, is_head_of_sales_rep, head_of_sales_rep_appointed_at")
        .eq("id", req.params.id)
        .eq("org_id", req.user!.orgId)
        .maybeSingle();
      if (targetError) { res.status(500).json({ error: targetError.message }); return; }
      if (!target) { res.status(404).json({ error: "User not found." }); return; }
      if (parsed.data.isHeadOfSalesRep && target.role !== "Sales Rep") {
        res.status(400).json({ error: "Only a Sales Rep can be made Head of Sales Rep." });
        return;
      }
      updates.is_head_of_sales_rep = parsed.data.isHeadOfSalesRep;
      if (parsed.data.isHeadOfSalesRep && !target.is_head_of_sales_rep && !target.head_of_sales_rep_appointed_at) {
        updates.head_of_sales_rep_appointed_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update." });
      return;
    }

    // Ensure target user belongs to caller's org
    const { data, error } = await supabase
      .from("users")
      .update(updates)
      .eq("id", req.params.id)
      .eq("org_id", req.user!.orgId)
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    if (!data) { res.status(404).json({ error: "User not found." }); return; }
    // Role/permission edits must bite now, not after the profile cache expires.
    invalidateUserProfile(String(req.params.id));
    res.json(data);
  }
);

export default router;
