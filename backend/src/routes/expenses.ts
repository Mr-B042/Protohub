import { Router } from "express";
import { fetchAllRowsOrThrow } from "../lib/query-limits.js";
import { humanFieldErrors } from "../lib/validation-message.js";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", requireRole("Owner", "Admin"), async (req, res) => {
  const { from, to } = req.query;
  // Rebuilt per page: a PostgREST query builder is single-use, so the paging
  // helper needs a fresh one for every .range() call.
  const buildExpenseQuery = () => {
    let query = supabase
      .from("expenses")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .order("date", { ascending: false })
      .order("id", { ascending: false });
    if (from) query = query.gte("date", from as string);
    if (to)   query = query.lte("date", to as string);
    return query;
  };

  // ⚠️ PAGED, NOT .limit(). An explicit ceiling did NOT get past PostgREST's
  // own max-rows cap: this route asked for REPORT_ROW_CEILING and was still
  // handed the newest 1,000, which cut the expense ledger off at 2026-07-18
  // and made every ad cost before that date look deleted. Only .range() walks
  // past a server-side cap.
  //
  // The secondary sort on id matters: paging a query whose sort has ties can
  // repeat or skip rows across page boundaries, and "date" alone has hundreds
  // of ties per day.
  try {
    const rows = await fetchAllRowsOrThrow<any>(buildExpenseQuery);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Failed to load expenses." });
  }
});

const ExpenseSchema = z.object({
  id:          z.string().min(1),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category:    z.string().min(1),
  description: z.string().optional(),
  amount:      z.number().min(0),
  currency:    z.enum(["NGN", "USD", "GBP"]).default("NGN"),
  paidBy:      z.string().optional(),
  productId:   z.string().optional()
});

const AdSpendBatchEntrySchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productId: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().min(0),
  currency: z.enum(["NGN", "USD", "GBP"]).default("NGN")
});

const AdSpendBatchSchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scopeProductIds: z.array(z.string().min(1)).min(1).max(1000),
  entries: z.array(AdSpendBatchEntrySchema).max(5000)
});

router.post("/", requireRole("Owner", "Admin", "Sales Rep"), async (req, res) => {
  const parsed = ExpenseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  const d = parsed.data;

  // Guard against cross-org id collision: if this id already exists for a
  // different org, reject it so we don't silently overwrite their data.
  const { data: existing } = await supabase
    .from("expenses").select("org_id").eq("id", d.id).maybeSingle();
  if (existing && existing.org_id !== req.user!.orgId) {
    res.status(409).json({ error: "Expense ID already exists." });
    return;
  }

  // Upsert by id so callers (e.g. order delivery-fee sync, waybill creation)
  // can call this repeatedly with the same id when state changes.
  const { data, error } = await supabase
    .from("expenses")
    .upsert(
      { id: d.id, org_id: req.user!.orgId, date: d.date, category: d.category, description: d.description, amount: d.amount, currency: d.currency, paid_by: d.paidBy, product_id: d.productId ?? null },
      { onConflict: "id" }
    )
    .select().single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

router.post("/batch-ad-spend", requireRole("Owner", "Admin"), async (req, res) => {
  const parsed = AdSpendBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }

  const { weekStart, weekEnd, scopeProductIds, entries } = parsed.data;
  const orgId = req.user!.orgId;
  const positiveEntries = entries.filter((entry) => entry.amount > 0);

  const { error: deleteError } = await supabase
    .from("expenses")
    .delete()
    .eq("org_id", orgId)
    .eq("category", "Ad Spend")
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .in("product_id", scopeProductIds);
  if (deleteError) {
    res.status(500).json({ error: deleteError.message });
    return;
  }

  if (positiveEntries.length === 0) {
    res.status(200).json({ savedCount: 0, totalAmount: 0, rows: [] });
    return;
  }

  const rows = positiveEntries.map((entry) => ({
    id: entry.id,
    org_id: orgId,
    date: entry.date,
    category: "Ad Spend",
    description: entry.description,
    amount: entry.amount,
    currency: entry.currency,
    product_id: entry.productId
  }));

  const { data, error } = await supabase
    .from("expenses")
    .upsert(rows, { onConflict: "id" })
    .select("*");
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({
    savedCount: positiveEntries.length,
    totalAmount: positiveEntries.reduce((sum, entry) => sum + entry.amount, 0),
    rows: data ?? []
  });
});

router.delete("/:id", requireRole("Owner", "Admin"), async (req, res) => {
  const { error } = await supabase
    .from("expenses").delete()
    .eq("id", req.params.id).eq("org_id", req.user!.orgId);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(204).send();
});

export default router;
