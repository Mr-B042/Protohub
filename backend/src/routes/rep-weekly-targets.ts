import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// Weekly per-sales-rep upsell/cross-sell % targets, so the Upselling &
// Cross-Selling Growth Bonus tab is a real coaching tool, not just a payout
// number. Attainment (each rep's actual Delivered Sales Expansion Rate for
// the same week) is computed client-side from already-loaded orders, same
// reasoning as the bonus math itself - this route only owns the target value.
const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const QuerySchema = z.object({
  weekStart: z.string().regex(DATE_KEY_PATTERN)
});

const UpsertSchema = z.object({
  weekStart: z.string().regex(DATE_KEY_PATTERN),
  targets: z.array(z.object({
    repId: z.string().uuid(),
    targetPct: z.coerce.number().min(0).max(100),
    notes: z.string().trim().max(500).optional()
  })).min(1).max(200)
});

router.get("/", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  try {
    const { data, error } = await supabase
      .from("rep_weekly_targets")
      .select("id, rep_id, week_start, target_pct, notes, created_by, updated_at")
      .eq("org_id", req.user!.orgId)
      .eq("week_start", parsed.data.weekStart);
    if (error) throw error;
    res.json({
      weekStart: parsed.data.weekStart,
      targets: (data ?? []).map((row) => ({
        id: row.id,
        repId: row.rep_id,
        weekStart: row.week_start,
        targetPct: Number(row.target_pct ?? 0),
        notes: row.notes ?? "",
        updatedAt: row.updated_at
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load weekly rep targets." });
  }
});

router.patch("/", async (req, res) => {
  const parsed = UpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { weekStart, targets } = parsed.data;
  try {
    const rows = targets.map((t) => ({
      org_id: req.user!.orgId,
      rep_id: t.repId,
      week_start: weekStart,
      target_pct: t.targetPct,
      notes: t.notes ?? null,
      created_by: req.user!.id,
      updated_at: new Date().toISOString()
    }));
    const { data, error } = await supabase
      .from("rep_weekly_targets")
      .upsert(rows, { onConflict: "org_id,rep_id,week_start" })
      .select("id, rep_id, week_start, target_pct, notes, updated_at");
    if (error) throw error;
    res.json({
      weekStart,
      targets: (data ?? []).map((row) => ({
        id: row.id,
        repId: row.rep_id,
        weekStart: row.week_start,
        targetPct: Number(row.target_pct ?? 0),
        notes: row.notes ?? "",
        updatedAt: row.updated_at
      }))
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not save weekly rep targets." });
  }
});

export default router;
