import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  computeBatchEconomics,
  type CostTier,
  type StatusTierEntry,
  type BatchInputs,
  type BatchOrder
} from "../lib/batch-economics.js";

const router = Router();
// Finance-sensitive (ad spend, costs, margins) — Owner/Admin only, like the rest of finance.
router.use(requireAuth, requireRole("Owner", "Admin"));

// Defaults for orgs created AFTER migration 097 (which seeded existing orgs).
const DEFAULT_TIERS = [
  { tier_key: "delivered",           label: "Delivered",             earns_revenue: true,  charge_ad: true, charge_product: true,  charge_delivery: true,  sort_order: 0 },
  { tier_key: "dispatched_failed",   label: "Dispatched — failed",   earns_revenue: false, charge_ad: true, charge_product: false, charge_delivery: true,  sort_order: 1 },
  { tier_key: "pre_dispatch_failed", label: "Pre-dispatch — failed", earns_revenue: false, charge_ad: true, charge_product: false, charge_delivery: false, sort_order: 2 }
];
const DEFAULT_STATUS_MAP = [
  { order_status: "Delivered",  tier_key: "delivered",           is_open: false },
  { order_status: "Dispatched", tier_key: "dispatched_failed",   is_open: true },
  { order_status: "Failed",     tier_key: "dispatched_failed",   is_open: false },
  { order_status: "New",        tier_key: "pre_dispatch_failed", is_open: true },
  { order_status: "Confirmed",  tier_key: "pre_dispatch_failed", is_open: true },
  { order_status: "In Process", tier_key: "pre_dispatch_failed", is_open: true },
  { order_status: "Postponed",  tier_key: "pre_dispatch_failed", is_open: true },
  { order_status: "Cancelled",  tier_key: "pre_dispatch_failed", is_open: false }
];

async function ensureOrgTierDefaults(orgId: string): Promise<void> {
  const { data: existing } = await supabase
    .from("batch_cost_tiers").select("id").eq("org_id", orgId).limit(1);
  if (existing && existing.length > 0) return;
  await supabase.from("batch_cost_tiers").insert(DEFAULT_TIERS.map((t) => ({ ...t, org_id: orgId })));
  await supabase.from("batch_status_tier_map").insert(DEFAULT_STATUS_MAP.map((m) => ({ ...m, org_id: orgId })));
}

const tierRowToLib = (r: any): CostTier => ({
  tierKey: r.tier_key, label: r.label, earnsRevenue: !!r.earns_revenue, chargeAd: !!r.charge_ad,
  chargeProduct: !!r.charge_product, chargeDelivery: !!r.charge_delivery, sortOrder: r.sort_order ?? 0
});
const statusRowToLib = (r: any): StatusTierEntry => ({
  orderStatus: r.order_status, tierKey: r.tier_key, isOpen: !!r.is_open
});
const batchInputs = (b: any): BatchInputs => ({
  adSpend: Number(b.ad_spend) || 0,
  productCostPerSet: Number(b.product_cost_per_set) || 0,
  deliveryCostPerOrder: Number(b.delivery_cost_per_order) || 0,
  status: b.status === "closed" ? "closed" : "open"
});
// Sets per order = the pack/set count of the package (single=1, double=2, ...).
const orderToBatchOrder = (o: any): BatchOrder => ({
  status: o.status ?? "New",
  amount: Number(o.amount) || 0,
  sets: Math.max(1, Number(o.quantity) || 1)
});

async function loadTierConfig(orgId: string): Promise<{ tiers: CostTier[]; statusMap: StatusTierEntry[] }> {
  await ensureOrgTierDefaults(orgId);
  const [{ data: tiers }, { data: map }] = await Promise.all([
    supabase.from("batch_cost_tiers").select("*").eq("org_id", orgId).order("sort_order"),
    supabase.from("batch_status_tier_map").select("*").eq("org_id", orgId)
  ]);
  return { tiers: (tiers ?? []).map(tierRowToLib), statusMap: (map ?? []).map(statusRowToLib) };
}

// ── Batches list (with worst-case net each) ───────────────────────────────────
router.get("/", async (req, res) => {
  const orgId = req.user!.orgId;
  const { data: batches, error } = await supabase
    .from("batch_economics").select("*").eq("org_id", orgId).order("created_at", { ascending: false });
  if (error) { res.status(500).json({ error: error.message }); return; }
  const { tiers, statusMap } = await loadTierConfig(orgId);

  const rows = await Promise.all((batches ?? []).map(async (b) => {
    const { data: orders } = await supabase
      .from("orders").select("status, amount, quantity").eq("org_id", orgId).eq("batch_id", b.id);
    const econ = computeBatchEconomics((orders ?? []).map(orderToBatchOrder), batchInputs(b), tiers, statusMap);
    return {
      id: b.id, label: b.label, periodStart: b.period_start, periodEnd: b.period_end, status: b.status,
      adSpend: Number(b.ad_spend) || 0, productCostPerSet: Number(b.product_cost_per_set) || 0,
      deliveryCostPerOrder: Number(b.delivery_cost_per_order) || 0,
      totalOrders: econ.worstCase.totalOrders,
      worstCaseNet: econ.worstCase.netProfit,
      bestCaseNet: econ.bestCase.netProfit,
      trueDeliveryRate: econ.worstCase.trueDeliveryRate
    };
  }));
  res.json(rows);
});

const CreateSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  adSpend: z.number().nonnegative().optional(),
  productCostPerSet: z.number().nonnegative().optional(),
  deliveryCostPerOrder: z.number().nonnegative().optional()
});

router.post("/", async (req, res) => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const d = parsed.data;
  const { data, error } = await supabase.from("batch_economics").insert({
    org_id: req.user!.orgId,
    label: d.label ?? "Untitled batch",
    period_start: d.periodStart ?? null,
    period_end: d.periodEnd ?? null,
    ad_spend: d.adSpend ?? 0,
    product_cost_per_set: d.productCostPerSet ?? 0,
    delivery_cost_per_order: d.deliveryCostPerOrder ?? 0
  }).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

const UpdateSchema = CreateSchema.extend({ status: z.enum(["open", "closed"]).optional() });

router.patch("/:id", async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const d = parsed.data;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (d.label !== undefined) updates.label = d.label;
  if (d.periodStart !== undefined) updates.period_start = d.periodStart || null;
  if (d.periodEnd !== undefined) updates.period_end = d.periodEnd || null;
  if (d.adSpend !== undefined) updates.ad_spend = d.adSpend;
  if (d.productCostPerSet !== undefined) updates.product_cost_per_set = d.productCostPerSet;
  if (d.deliveryCostPerOrder !== undefined) updates.delivery_cost_per_order = d.deliveryCostPerOrder;
  if (d.status !== undefined) updates.status = d.status;
  const { data, error } = await supabase
    .from("batch_economics").update(updates).eq("id", req.params.id).eq("org_id", req.user!.orgId).select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  if (!data) { res.status(404).json({ error: "Batch not found." }); return; }
  res.json(data);
});

router.delete("/:id", async (req, res) => {
  const { error } = await supabase
    .from("batch_economics").delete().eq("id", req.params.id).eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: "Batch deleted." });
});

// ── Assign orders (by explicit ids OR a placed-date range, optional product filter) ──
const AssignSchema = z.object({
  orderIds: z.array(z.string()).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  productIds: z.array(z.string().uuid()).optional()
}).refine((d) => (d.orderIds && d.orderIds.length) || (d.dateFrom && d.dateTo), {
  message: "Provide orderIds, or a dateFrom + dateTo range."
});

router.post("/:id/assign-orders", async (req, res) => {
  const orgId = req.user!.orgId;
  const parsed = AssignSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const d = parsed.data;
  // Verify the batch belongs to this org.
  const { data: batch } = await supabase
    .from("batch_economics").select("id").eq("id", req.params.id).eq("org_id", orgId).single();
  if (!batch) { res.status(404).json({ error: "Batch not found." }); return; }

  let q = supabase.from("orders").update({ batch_id: req.params.id }).eq("org_id", orgId);
  if (d.orderIds && d.orderIds.length) {
    q = q.in("id", d.orderIds);
  } else {
    q = q.gte("created_at", `${d.dateFrom}T00:00:00`).lte("created_at", `${d.dateTo}T23:59:59`);
    if (d.productIds && d.productIds.length) q = q.in("product_id", d.productIds);
  }
  const { data, error } = await q.select("id");
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ assigned: (data ?? []).length });
});

// ── Full economics (worst + best case) ────────────────────────────────────────
router.get("/:id/economics", async (req, res) => {
  const orgId = req.user!.orgId;
  const { data: batch, error } = await supabase
    .from("batch_economics").select("*").eq("id", req.params.id).eq("org_id", orgId).single();
  if (error || !batch) { res.status(404).json({ error: "Batch not found." }); return; }
  const { tiers, statusMap } = await loadTierConfig(orgId);
  const { data: orders } = await supabase
    .from("orders").select("status, amount, quantity").eq("org_id", orgId).eq("batch_id", req.params.id);
  const econ = computeBatchEconomics((orders ?? []).map(orderToBatchOrder), batchInputs(batch), tiers, statusMap);
  res.json({
    batch: {
      id: batch.id, label: batch.label, periodStart: batch.period_start, periodEnd: batch.period_end,
      status: batch.status, adSpend: Number(batch.ad_spend) || 0,
      productCostPerSet: Number(batch.product_cost_per_set) || 0,
      deliveryCostPerOrder: Number(batch.delivery_cost_per_order) || 0
    },
    economics: econ
  });
});

// ── Tier config (the N-tier cost model + status->tier map) ─────────────────────
router.get("/config/tiers", async (req, res) => {
  const { tiers, statusMap } = await loadTierConfig(req.user!.orgId);
  res.json({ tiers, statusMap });
});

const ConfigSchema = z.object({
  tiers: z.array(z.object({
    tierKey: z.string().min(1).max(60),
    label: z.string().min(1).max(120),
    earnsRevenue: z.boolean(),
    chargeAd: z.boolean(),
    chargeProduct: z.boolean(),
    chargeDelivery: z.boolean(),
    sortOrder: z.number().int().optional()
  })).optional(),
  statusMap: z.array(z.object({
    orderStatus: z.string().min(1).max(60),
    tierKey: z.string().min(1).max(60),
    isOpen: z.boolean()
  })).optional()
});

router.patch("/config/tiers", async (req, res) => {
  const orgId = req.user!.orgId;
  const parsed = ConfigSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten().fieldErrors }); return; }
  const d = parsed.data;
  if (d.tiers) {
    const rows = d.tiers.map((t, i) => ({
      org_id: orgId, tier_key: t.tierKey, label: t.label, earns_revenue: t.earnsRevenue,
      charge_ad: t.chargeAd, charge_product: t.chargeProduct, charge_delivery: t.chargeDelivery,
      sort_order: t.sortOrder ?? i, updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from("batch_cost_tiers").upsert(rows, { onConflict: "org_id,tier_key" });
    if (error) { res.status(500).json({ error: error.message }); return; }
  }
  if (d.statusMap) {
    const rows = d.statusMap.map((m) => ({
      org_id: orgId, order_status: m.orderStatus, tier_key: m.tierKey, is_open: m.isOpen,
      updated_at: new Date().toISOString()
    }));
    const { error } = await supabase.from("batch_status_tier_map").upsert(rows, { onConflict: "org_id,order_status" });
    if (error) { res.status(500).json({ error: error.message }); return; }
  }
  const config = await loadTierConfig(orgId);
  res.json(config);
});

export default router;
