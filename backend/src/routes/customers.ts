import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { isFrontlineRepRole } from "../lib/roles.js";

const router = Router();
router.use(requireAuth);

// ── GET /api/customers ────────────────────────────────────
// Customers are derived from orders — one row per unique phone number
router.get("/", async (req, res) => {
  let query = supabase
    .from("orders")
    .select("phone, customer, city, state, amount, status, created_at, assigned_rep_id")
    .eq("org_id", req.user!.orgId)
    .order("created_at", { ascending: false });
  // Sales Reps only see customers from their own orders (spy mode: use effective role/id)
  const scopeRole = req.user!.effectiveUserRole ?? req.user!.role;
  const scopeId   = req.user!.effectiveUserId   ?? req.user!.id;
  if (isFrontlineRepRole(scopeRole)) {
    query = query.eq("assigned_rep_id", scopeId);
  }
  const { data, error } = await query;

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Aggregate by phone
  const map = new Map<string, {
    phone: string; name: string; city: string; state: string;
    totalOrders: number; totalSpend: number; lastOrderAt: string;
    delivered: number;
  }>();

  for (const o of data ?? []) {
    // Normalize to digits-only so "+234 801..." and "0801..." group together
    // and flag lookups (which use the same normalization) always match.
    const key = o.phone.replace(/\D/g, "");
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        phone: o.phone, name: o.customer, city: o.city, state: o.state,
        totalOrders: 1, totalSpend: o.status === "Delivered" ? Number(o.amount) : 0,
        delivered: o.status === "Delivered" ? 1 : 0,
        lastOrderAt: o.created_at
      });
    } else {
      existing.totalOrders++;
      if (o.status === "Delivered") { existing.totalSpend += Number(o.amount); existing.delivered++; }
      if (o.created_at > existing.lastOrderAt) existing.lastOrderAt = o.created_at;
    }
  }

  // Fetch flags (high-risk + consent/opt-out - two independent flags on the
  // same phone-keyed row)
  const { data: flags } = await supabase
    .from("customer_flags")
    .select("phone, reason, flagged_at, blocks_followup, blocks_followup_reason, blocks_followup_at")
    .eq("org_id", req.user!.orgId);

  const flagMap = new Map((flags ?? []).map((f) => [f.phone, f]));

  const customers = Array.from(map.values()).map((c) => ({
    ...c,
    flag: flagMap.get(c.phone.replace(/\D/g, "")) ?? null
  }));

  res.json(customers);
});

// ── GET /api/customers/flags ──────────────────────────────
// Returns all flag rows for the org. Used to hydrate the frontend's
// local flag map on mount so flagged numbers appear on every device.
router.get("/flags", async (req, res) => {
  const { data, error } = await supabase
    .from("customer_flags")
    .select("phone, reason, flagged_at, flagged_by, blocks_followup, blocks_followup_reason, blocks_followup_at, blocks_followup_by")
    .eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data ?? []);
});

// ── POST /api/customers/flags ─────────────────────────────
const FlagSchema = z.object({
  phone:  z.string().min(1),
  reason: z.string().min(1)
});

router.post("/flags",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const parsed = FlagSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const normalized = parsed.data.phone.replace(/\D/g, "");
    const { data, error } = await supabase
      .from("customer_flags")
      .upsert({ org_id: req.user!.orgId, phone: normalized, reason: parsed.data.reason, flagged_by: req.user!.id })
      .select().single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  }
);

// ── DELETE /api/customers/flags/:phone ────────────────────
// Clears the high-risk flag only. A phone's row also carries the
// independent consent/opt-out flag (blocks_followup) - if that's still
// set, null out just the high-risk columns rather than deleting the row
// out from under the opt-out. Only fully delete once neither flag is set.
router.delete("/flags/:phone",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const normalized = String(req.params.phone).replace(/\D/g, "");
    const { data: existing } = await supabase
      .from("customer_flags")
      .select("blocks_followup")
      .eq("org_id", req.user!.orgId)
      .eq("phone", normalized)
      .maybeSingle();

    if (existing?.blocks_followup) {
      const { error } = await supabase
        .from("customer_flags")
        .update({ reason: null, flagged_by: null })
        .eq("org_id", req.user!.orgId)
        .eq("phone", normalized);
      if (error) { res.status(500).json({ error: error.message }); return; }
    } else {
      const { error } = await supabase
        .from("customer_flags")
        .delete()
        .eq("org_id", req.user!.orgId)
        .eq("phone", normalized);
      if (error) { res.status(500).json({ error: error.message }); return; }
    }
    res.status(204).send();
  }
);

// ── POST /api/customers/opt-out ───────────────────────────
// Marks a phone as having asked to stop being contacted - removes it from
// the daily Follow-up KPI obligation set (see follow-up-kpi.ts) without
// touching the separate high-risk flag on the same row. Broader than the
// high-risk flag's Owner/Admin-only gate since the rep on the phone with
// the customer is who actually receives this request.
const OptOutSchema = z.object({
  phone:  z.string().min(1),
  reason: z.string().max(1000).optional()
});

router.post("/opt-out",
  requireRole("Owner", "Admin", "Manager", "Recovery Rep"),
  async (req, res) => {
    const parsed = OptOutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors });
      return;
    }
    const normalized = parsed.data.phone.replace(/\D/g, "");
    const { data, error } = await supabase
      .from("customer_flags")
      .upsert({
        org_id: req.user!.orgId,
        phone: normalized,
        blocks_followup: true,
        blocks_followup_reason: parsed.data.reason ?? null,
        blocks_followup_by: req.user!.id,
        blocks_followup_at: new Date().toISOString()
      }, { onConflict: "org_id,phone" })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(201).json(data);
  }
);

// ── DELETE /api/customers/opt-out/:phone ──────────────────
// Clears the opt-out only - mirrors the high-risk DELETE above, never
// deleting the row out from under a separately-set high-risk flag.
router.delete("/opt-out/:phone",
  requireRole("Owner", "Admin", "Manager", "Recovery Rep"),
  async (req, res) => {
    const normalized = String(req.params.phone).replace(/\D/g, "");
    const { data: existing } = await supabase
      .from("customer_flags")
      .select("reason")
      .eq("org_id", req.user!.orgId)
      .eq("phone", normalized)
      .maybeSingle();

    if (existing?.reason) {
      const { error } = await supabase
        .from("customer_flags")
        .update({ blocks_followup: false, blocks_followup_reason: null, blocks_followup_by: null, blocks_followup_at: null })
        .eq("org_id", req.user!.orgId)
        .eq("phone", normalized);
      if (error) { res.status(500).json({ error: error.message }); return; }
    } else {
      const { error } = await supabase
        .from("customer_flags")
        .delete()
        .eq("org_id", req.user!.orgId)
        .eq("phone", normalized);
      if (error) { res.status(500).json({ error: error.message }); return; }
    }
    res.status(204).send();
  }
);

export default router;
