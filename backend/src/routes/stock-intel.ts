import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { loadStockIntel } from "../lib/stock-intel-data.js";
import { loadStockSold } from "../lib/stock-sold.js";

// ── Stock Intelligence (Product Trend › Stock Intelligence) ─────────────────
// GET  /api/stock-intel            the whole tab, worked out on the server
//                                  (stock-intel-model.ts) so the alerts read
//                                  the same figures.
// GET  /api/stock-intel/sold       pieces sold per day/product/state/agent
// PUT  /api/stock-intel/routes     Owner: where one state's restock comes from
// PUT  /api/stock-intel/settings   Owner: lead time / safety days for a hub
//
// Recommends only. Every "Plan Restock" opens the normal Create Waybill form;
// nothing here moves stock. No money and no customer details are sent, so the
// logistics roles see the same page.

const router = Router();
router.use(requireAuth);

const VIEWERS = ["Owner", "Admin", "Manager", "Inventory Manager", "Inventory Manager & Logistics Operations"] as const;
const ZERO = "00000000-0000-0000-0000-000000000000";

const branchOf = (req: Request, res: Response) => {
  const branchId = req.user!.branchId;
  if (!branchId) { res.status(400).json({ error: "Open a branch first." }); return null; }
  return branchId;
};

router.get("/", requireRole(...VIEWERS), async (req, res) => {
  const branchId = branchOf(req, res);
  if (!branchId) return;
  try {
    const productId = typeof req.query.productId === "string" && /^[0-9a-f-]{36}$/i.test(req.query.productId) ? req.query.productId : null;
    const windowDays = Number(req.query.windowDays ?? 7);
    const data = await loadStockIntel({ orgId: req.user!.orgId, branchId, windowDays, productId });
    res.json({ ...data, canEdit: req.user!.role === "Owner" });
  } catch (error: any) {
    console.error("[stock-intel]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not work out the stock figures." });
  }
});

// GET /api/stock-intel/sold?start=YYYY-MM-DD&end=YYYY-MM-DD&productId=
// Pieces delivered per day x product x state x agent (Overview › Pieces Sold).
router.get("/sold", requireRole(...VIEWERS), async (req, res) => {
  const branchId = branchOf(req, res);
  if (!branchId) return;
  try {
    const productId = typeof req.query.productId === "string" && /^[0-9a-f-]{36}$/i.test(req.query.productId) ? req.query.productId : null;
    res.json(await loadStockSold({ orgId: req.user!.orgId, branchId, start: req.query.start, end: req.query.end, productId }));
  } catch (error: any) {
    console.error("[stock-intel sold]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not count the pieces sold." });
  }
});

const RoutesSchema = z.object({
  destState: z.string().trim().min(1).max(80),
  productId: z.string().uuid().nullable().default(null),
  // Up to three sources, first = primary. null source = main warehouse.
  sources: z.array(z.string().trim().min(1).max(80).nullable()).max(3)
});

router.put("/routes", requireRole("Owner"), async (req, res) => {
  const branchId = branchOf(req, res);
  if (!branchId) return;
  const parsed = RoutesSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { destState, productId, sources } = parsed.data;
  const cleaned = sources.filter((source, i) => source !== destState && sources.indexOf(source) === i);
  try {
    let del = supabase.from("stock_supply_routes").delete().eq("org_id", req.user!.orgId).eq("branch_id", branchId).eq("dest_state", destState);
    del = productId ? del.eq("product_id", productId) : del.is("product_id", null);
    const { error: delError } = await del;
    if (delError) throw delError;
    if (cleaned.length > 0) {
      const { error } = await supabase.from("stock_supply_routes").insert(cleaned.map((sourceState, i) => ({
        org_id: req.user!.orgId, branch_id: branchId, dest_state: destState, product_id: productId, source_state: sourceState, priority: i + 1, updated_by: req.user!.id
      })));
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (error: any) {
    console.error("[stock-intel routes]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not save the route." });
  }
});

const SettingSchema = z.object({
  locationId: z.string().uuid().nullable().default(null),
  productId: z.string().uuid().nullable().default(null),
  leadTimeDays: z.number().gt(0).max(60).nullable().default(null),
  safetyDays: z.number().min(0).max(30).nullable().default(null)
});

router.put("/settings", requireRole("Owner"), async (req, res) => {
  const branchId = branchOf(req, res);
  if (!branchId) return;
  const parsed = SettingSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  const { locationId, productId, leadTimeDays, safetyDays } = parsed.data;
  try {
    // The unique index is on coalesce(...) so PostgREST cannot upsert on it:
    // find the row, then update / insert / delete.
    const { data: existing, error: findError } = await supabase.from("stock_lead_time_settings").select("id, agent_location_id, product_id")
      .eq("org_id", req.user!.orgId).eq("branch_id", branchId).limit(5000);
    if (findError) throw findError;
    const match = (existing ?? []).find((row: any) => (row.agent_location_id ?? ZERO) === (locationId ?? ZERO) && (row.product_id ?? ZERO) === (productId ?? ZERO)) as { id: string } | undefined;
    if (leadTimeDays === null && safetyDays === null) {
      if (match) { const { error } = await supabase.from("stock_lead_time_settings").delete().eq("id", match.id).eq("org_id", req.user!.orgId); if (error) throw error; }
    } else if (match) {
      const { error } = await supabase.from("stock_lead_time_settings").update({ lead_time_days: leadTimeDays, safety_days: safetyDays, updated_by: req.user!.id, updated_at: new Date().toISOString() })
        .eq("id", match.id).eq("org_id", req.user!.orgId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("stock_lead_time_settings").insert({
        org_id: req.user!.orgId, branch_id: branchId, agent_location_id: locationId, product_id: productId, lead_time_days: leadTimeDays, safety_days: safetyDays, updated_by: req.user!.id
      });
      if (error) throw error;
    }
    res.json({ ok: true });
  } catch (error: any) {
    console.error("[stock-intel settings]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not save the setting." });
  }
});

export default router;
