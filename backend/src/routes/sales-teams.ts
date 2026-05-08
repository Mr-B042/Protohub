import { Router } from "express";
import { z } from "zod";
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

// ── POST /api/sales-teams ────────────────────────────────
const TeamSchema = z.object({
  name:       z.string().min(1).max(120),
  leadId:     z.string().uuid().optional(),
  productIds: z.array(z.string().uuid()).default([]),
  memberIds:  z.array(z.string().uuid()).default([])
});

router.post("/", async (req, res) => {
  const parsed = TeamSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }
  const { name, leadId, productIds, memberIds } = parsed.data;
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
