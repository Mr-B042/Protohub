import { Router } from "express";
import { z } from "zod";
import { humanFieldErrors } from "../lib/validation-message.js";
import { supabase } from "../lib/supabase.js";
import { fetchAllRowsOrThrow } from "../lib/query-limits.js";
import { latestTargetsByRep, performanceLogRowFromAttempt } from "../lib/upsell-performance.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// Upsell & Cross-Selling Performance (Manager Dashboard). The same people who
// can open the Upsell & Cross-Sell Bonus tab.
const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const QuerySchema = z.object({
  dateFrom: z.string().regex(DATE_KEY_PATTERN),
  dateTo: z.string().regex(DATE_KEY_PATTERN)
}).refine((value) => value.dateFrom <= value.dateTo, { message: "The start date must be on or before the end date." });

// Lagos days, not UTC days: a call at 00:30 in Lagos belongs to that day.
const lagosDayStartIso = (dateKey: string) => new Date(`${dateKey}T00:00:00+01:00`).toISOString();
const lagosDayEndIso = (dateKey: string) => new Date(`${dateKey}T23:59:59.999+01:00`).toISOString();

router.get("/log", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
    return;
  }
  const { dateFrom, dateTo } = parsed.data;
  try {
    // ⚠️ Paged, never one .limit() read: a year is ~6,000 calls and PostgREST
    // silently hands back only the first page of a single read.
    const [attempts, targetRows] = await Promise.all([
      fetchAllRowsOrThrow<any>(() => supabase
        .from("order_sales_expansion_attempts")
        .select("id, order_id, rep_id, attempted_at, eligibility, exemption_reason, original_product_id, original_product_name, original_quantity, offer_lines:order_sales_expansion_offer_lines(offer_type, response, refusal_reason, offered_quantity, offered_package_name, offered_product_name)")
        .eq("org_id", req.user!.orgId)
        .eq("record_status", "active")
        .gte("attempted_at", lagosDayStartIso(dateFrom))
        .lte("attempted_at", lagosDayEndIso(dateTo))
        .order("attempted_at", { ascending: true })
        .order("id", { ascending: true })),
      fetchAllRowsOrThrow<any>(() => supabase
        .from("rep_weekly_targets")
        .select("rep_id, week_start, target_pct")
        .eq("org_id", req.user!.orgId)
        .lte("week_start", dateTo)
        .order("week_start", { ascending: true })
        .order("rep_id", { ascending: true }))
    ]);
    res.json({
      dateFrom,
      dateTo,
      attempts: attempts.map(performanceLogRowFromAttempt),
      targets: latestTargetsByRep(targetRows, dateTo)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load the upsell call log." });
  }
});

export default router;
