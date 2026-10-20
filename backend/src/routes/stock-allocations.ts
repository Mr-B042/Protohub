import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { deliver, leadershipRecipients } from "../lib/weekly-report-notifications.js";

// ── Stock allocation decisions (Product Trend › Stock Recommendation) ───────
// Bright's brief, 21 Oct 2026: the system recommends how a product's
// WAREHOUSE stock is shared across states -> a Manager / Admin adjusts and
// sends it -> the Owner approves or rejects -> transfers are made with the
// normal Create Waybill form (NOTHING moves from here) -> the page follows
// what happened. Every action is written to stock_allocation_events
// (append-only, migration 307).
//
// Guards:
// - never more units than the product's warehouse stock, checked on send AND
//   again on approval (stock may have moved in between);
// - one open decision per product (unique index), so the same units are never
//   promised twice;
// - only the Owner approves or rejects.

const router = Router();
router.use(requireAuth);

const PROPOSERS = ["Owner", "Admin", "Manager"] as const;
const LINK = "/dashboard/admin/product-trend";

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (res: Response, error: any, fallback: string) => {
  if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
  console.error("[stock-allocations]", error?.message ?? error);
  res.status(500).json({ error: error?.message ?? fallback });
};
const branchOf = (req: Request) => {
  const branchId = req.user!.branchId;
  if (!branchId) throw new HttpError(400, "Open a branch first.");
  return branchId;
};

const LineSchema = z.object({
  state: z.string().trim().min(1).max(80),
  units: z.number().int().min(0).max(1_000_000),
  recommended: z.number().int().min(0).max(1_000_000).optional(),
  need: z.number().min(0).optional(),
  priority: z.string().max(20).optional(),
  stock: z.number().min(0).optional(),
  waiting: z.number().min(0).optional(),
  forecast: z.number().min(0).optional(),
  rate: z.number().min(0).max(100).optional(),
  agentId: z.string().uuid().nullable().optional(),
  agentLocationId: z.string().uuid().nullable().optional()
});

const ProposeSchema = z.object({
  productId: z.string().uuid(),
  lines: z.array(LineSchema).min(1).max(40),
  recommended: z.array(LineSchema).max(40).default([]),
  horizonDays: z.number().int().min(1).max(365).default(30),
  confidence: z.string().max(40).optional(),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  expected: z.record(z.unknown()).default({}),
  reason: z.string().trim().max(1000).optional(),
  // The Owner sending her own plan can approve it in the same step.
  approveNow: z.boolean().optional()
});

const total = (lines: Array<{ units: number }>) => lines.reduce((sum, line) => sum + line.units, 0);

async function warehouseOf(orgId: string, productId: string) {
  const { data, error } = await supabase.from("products").select("id, name, warehouse_stock").eq("org_id", orgId).eq("id", productId).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Product not found.");
  return { name: String(data.name ?? "Product"), stock: Math.max(0, Number(data.warehouse_stock ?? 0)) };
}

async function event(req: Request, branchId: string, decisionId: string, action: string, detail: Record<string, unknown> = {}) {
  const { error } = await supabase.from("stock_allocation_events").insert({
    org_id: req.user!.orgId, branch_id: branchId, decision_id: decisionId, action,
    actor_id: req.user!.id, actor_name: req.user!.name ?? null, actor_role: req.user!.role, detail
  });
  if (error) throw error;
}

async function load(req: Request, id: string) {
  const { data, error } = await supabase.from("stock_allocation_decisions").select("*")
    .eq("org_id", req.user!.orgId).eq("branch_id", branchOf(req)).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "That decision was not found.");
  return data as any;
}

/** Alerts never fail the action. */
async function notify(orgId: string, branchId: string, to: Array<{ id: string; role: string }>, title: string, message: string, tag: string) {
  try { await deliver(orgId, branchId, to, { title, message, kind: "stock_allocation", tag, link: LINK }); }
  catch (error: any) { console.warn("[stock-allocations] alert failed:", error?.message ?? error); }
}

// ── GET /api/stock-allocations ──────────────────────────────────────────────
// Every decision of the branch, its record, and the waybills sent since each
// approval (the page matches them to states).
router.get("/", requireRole(...PROPOSERS), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const { data: decisions, error } = await supabase.from("stock_allocation_decisions").select("*")
      .eq("org_id", orgId).eq("branch_id", branchId).order("proposed_at", { ascending: false }).limit(200);
    if (error) throw error;
    const ids = (decisions ?? []).map((row: any) => row.id);
    const { data: events, error: eventsError } = ids.length > 0
      ? await supabase.from("stock_allocation_events").select("*").eq("org_id", orgId).in("decision_id", ids).order("created_at", { ascending: true })
      : { data: [], error: null };
    if (eventsError) throw eventsError;
    const approvedAt = (decisions ?? []).map((row: any) => row.decided_at as string | null).filter((at): at is string => Boolean(at)).sort()[0];
    let waybills: any[] = [];
    if (approvedAt) {
      const { data, error: waybillError } = await supabase.from("waybill_records")
        .select("id, product_id, product_name, quantity, items, to_agent_id, to_agent_location_id, to_location, status, created_at, received_date")
        .eq("org_id", orgId).or(`branch_id.eq.${branchId},branch_id.is.null`).gte("created_at", approvedAt)
        .order("created_at", { ascending: true }).limit(2000);
      if (waybillError) throw waybillError;
      waybills = data ?? [];
    }
    res.json({
      decisions: (decisions ?? []).map((row: any) => ({ ...row, events: (events ?? []).filter((e: any) => e.decision_id === row.id) })),
      waybills,
      canApprove: req.user!.role === "Owner"
    });
  } catch (error) { fail(res, error, "Could not load stock decisions."); }
});

// ── POST /api/stock-allocations — send a plan (or the Owner approves her own) ──
router.post("/", requireRole(...PROPOSERS), async (req, res) => {
  const parsed = ProposeSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const orgId = req.user!.orgId;
    const branchId = branchOf(req);
    const body = parsed.data;
    const lines = body.lines.filter((line) => line.units > 0);
    if (lines.length === 0) throw new HttpError(400, "Give at least one state some units.");
    const product = await warehouseOf(orgId, body.productId);
    const units = total(lines);
    if (units > product.stock) throw new HttpError(409, `Only ${product.stock} units of ${product.name} are in the warehouse - this plan sends ${units}.`);
    const approveNow = Boolean(body.approveNow) && req.user!.role === "Owner";
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("stock_allocation_decisions").insert({
      org_id: orgId, branch_id: branchId, product_id: body.productId,
      status: approveNow ? "approved" : "proposed",
      recommended: body.recommended, final_lines: lines, warehouse_available: product.stock,
      horizon_days: body.horizonDays, confidence: body.confidence ?? null,
      period_from: body.periodFrom ?? null, period_to: body.periodTo ?? null, expected: body.expected,
      reason: body.reason ?? null, proposed_by: req.user!.id, proposed_by_name: req.user!.name ?? null, proposed_at: now,
      ...(approveNow ? { decided_by: req.user!.id, decided_by_name: req.user!.name ?? null, decided_at: now, decision_note: "Approved when sent (Owner)" } : {}),
      updated_at: now
    }).select("*").single();
    if (error) {
      if ((error as any).code === "23505") throw new HttpError(409, `${product.name} already has a plan waiting or approved. Finish or cancel it first.`);
      throw error;
    }
    await event(req, branchId, data.id, approveNow ? "proposed_and_approved" : "proposed", { units, states: lines.map((l) => `${l.state}:${l.units}`), reason: body.reason ?? null });
    if (!approveNow) {
      const owners = await leadershipRecipients(orgId, branchId, ["Owner"]).catch(() => []);
      await notify(orgId, branchId, owners, "Stock plan needs your approval", `${req.user!.name ?? "A manager"} wants to send ${units} units of ${product.name} to ${lines.length} state${lines.length === 1 ? "" : "s"}.`, `stock-plan-${data.id}`);
    }
    res.status(201).json({ decision: data });
  } catch (error) { fail(res, error, "Could not send the plan."); }
});

const DecideSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  // The Owner may change the units before approving.
  lines: z.array(LineSchema).max(40).optional()
});

// ── POST /:id/approve (Owner) ───────────────────────────────────────────────
router.post("/:id/approve", requireRole("Owner"), async (req, res) => {
  const parsed = DecideSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = branchOf(req);
    const decision = await load(req, String(req.params.id));
    if (decision.status !== "proposed") throw new HttpError(409, `This plan is already ${decision.status}.`);
    const lines = (parsed.data.lines ?? decision.final_lines).filter((line: any) => Number(line.units) > 0);
    if (lines.length === 0) throw new HttpError(400, "Give at least one state some units.");
    const product = await warehouseOf(req.user!.orgId, decision.product_id);
    const units = total(lines);
    if (units > product.stock) throw new HttpError(409, `Only ${product.stock} units are in the warehouse now - the plan sends ${units}. Change the units first.`);
    const now = new Date().toISOString();
    const changed = parsed.data.lines ? JSON.stringify(parsed.data.lines) !== JSON.stringify(decision.final_lines) : false;
    const { data, error } = await supabase.from("stock_allocation_decisions").update({
      status: "approved", final_lines: lines, decided_by: req.user!.id, decided_by_name: req.user!.name ?? null, decided_at: now,
      decision_note: parsed.data.note ?? null, warehouse_available: product.stock, updated_at: now
    }).eq("id", decision.id).eq("status", "proposed").select("*").single();
    if (error) throw error;
    await event(req, branchId, decision.id, "approved", { units, changedByOwner: changed, before: changed ? decision.final_lines : undefined, note: parsed.data.note ?? null });
    if (decision.proposed_by) await notify(req.user!.orgId, branchId, [{ id: decision.proposed_by, role: "Manager" }], "Stock plan approved", `${units} units of ${product.name} approved. Create the transfers from Product Trend.`, `stock-plan-${decision.id}`);
    res.json({ decision: data });
  } catch (error) { fail(res, error, "Could not approve the plan."); }
});

// ── POST /:id/reject (Owner) ────────────────────────────────────────────────
router.post("/:id/reject", requireRole("Owner"), async (req, res) => {
  const parsed = z.object({ note: z.string().trim().min(1, "Say why.").max(1000) }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = branchOf(req);
    const decision = await load(req, String(req.params.id));
    if (decision.status !== "proposed") throw new HttpError(409, `This plan is already ${decision.status}.`);
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("stock_allocation_decisions").update({
      status: "rejected", decided_by: req.user!.id, decided_by_name: req.user!.name ?? null, decided_at: now, decision_note: parsed.data.note, closed_at: now, updated_at: now
    }).eq("id", decision.id).eq("status", "proposed").select("*").single();
    if (error) throw error;
    await event(req, branchId, decision.id, "rejected", { note: parsed.data.note });
    if (decision.proposed_by) await notify(req.user!.orgId, branchId, [{ id: decision.proposed_by, role: "Manager" }], "Stock plan not approved", parsed.data.note, `stock-plan-${decision.id}`);
    res.json({ decision: data });
  } catch (error) { fail(res, error, "Could not reject the plan."); }
});

// ── POST /:id/cancel (Owner / Admin, or whoever sent it) ────────────────────
router.post("/:id/cancel", requireRole(...PROPOSERS), async (req, res) => {
  const parsed = z.object({ note: z.string().trim().max(1000).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = branchOf(req);
    const decision = await load(req, String(req.params.id));
    if (!["proposed", "approved"].includes(decision.status)) throw new HttpError(409, `This plan is already ${decision.status}.`);
    if (req.user!.role === "Manager" && decision.proposed_by !== req.user!.id) throw new HttpError(403, "Only the person who sent it, an Admin or the Owner can cancel it.");
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("stock_allocation_decisions").update({ status: "cancelled", closed_at: now, updated_at: now })
      .eq("id", decision.id).in("status", ["proposed", "approved"]).select("*").single();
    if (error) throw error;
    await event(req, branchId, decision.id, "cancelled", { note: parsed.data.note ?? null, was: decision.status });
    res.json({ decision: data });
  } catch (error) { fail(res, error, "Could not cancel the plan."); }
});

// ── POST /:id/complete (Owner / Admin): transfers done, start following results ──
router.post("/:id/complete", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = z.object({ note: z.string().trim().max(1000).optional(), transferredUnits: z.number().int().min(0).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: humanFieldErrors(parsed.error) }); return; }
  try {
    const branchId = branchOf(req);
    const decision = await load(req, String(req.params.id));
    if (decision.status !== "approved") throw new HttpError(409, "Only an approved plan can be marked done.");
    const now = new Date().toISOString();
    const { data, error } = await supabase.from("stock_allocation_decisions").update({ status: "completed", closed_at: now, updated_at: now })
      .eq("id", decision.id).eq("status", "approved").select("*").single();
    if (error) throw error;
    await event(req, branchId, decision.id, "completed", { note: parsed.data.note ?? null, transferredUnits: parsed.data.transferredUnits ?? null });
    res.json({ decision: data });
  } catch (error) { fail(res, error, "Could not mark the plan done."); }
});

export default router;
