import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

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
  // Sales Reps only see customers from their own orders
  if (req.user!.role === "Sales Rep") {
    query = query.eq("assigned_rep_id", req.user!.id);
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
    const existing = map.get(o.phone);
    if (!existing) {
      map.set(o.phone, {
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

  // Fetch flags
  const { data: flags } = await supabase
    .from("customer_flags")
    .select("phone, reason, flagged_at")
    .eq("org_id", req.user!.orgId);

  const flagMap = new Map((flags ?? []).map((f) => [f.phone, f]));

  const customers = Array.from(map.values()).map((c) => ({
    ...c,
    flag: flagMap.get(c.phone.replace(/\D/g, "")) ?? null
  }));

  res.json(customers);
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
router.delete("/flags/:phone",
  requireRole("Owner", "Admin"),
  async (req, res) => {
    const normalized = String(req.params.phone).replace(/\D/g, "");
    const { error } = await supabase
      .from("customer_flags")
      .delete()
      .eq("org_id", req.user!.orgId)
      .eq("phone", normalized);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.status(204).send();
  }
);

export default router;
