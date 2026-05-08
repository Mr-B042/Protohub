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
