import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { fetchAllRows } from "../lib/paginated-query.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const QuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productIds: z.string().optional()
});

const toWatUtcIso = (dateKey: string, time: "start" | "end") =>
  new Date(
    `${dateKey}T${time === "start" ? "00:00:00.000" : "23:59:59.999"}+01:00`
  ).toISOString();

router.get("/", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { dateFrom, dateTo, productIds } = parsed.data;
  const createdFrom = toWatUtcIso(dateFrom, "start");
  const createdTo = toWatUtcIso(dateTo, "end");
  const requestedProductIds = Array.from(
    new Set(
      (productIds ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

  const fetchCohortPage = async (from: number, to: number) => {
    let query = supabase
      .from("orders")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .gte("created_at", createdFrom)
      .lte("created_at", createdTo)
      // Exclude held duplicates from the placed-in-period throughput cohort.
      .or("review_hold.is.null,review_hold.eq.false")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (req.user!.role === "Sales Rep") query = query.eq("assigned_rep_id", req.user!.id);
    if (requestedProductIds.length > 0) query = query.in("product_id", requestedProductIds);
    const result = await query.range(from, to);
    return { data: result.data, error: result.error };
  };

  const fetchDeliveredPage = async (from: number, to: number) => {
    let query = supabase
      .from("orders")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .eq("status", "Delivered")
      .gte("delivered_date", dateFrom)
      .lte("delivered_date", dateTo)
      .order("delivered_date", { ascending: false })
      .order("id", { ascending: false });
    if (req.user!.role === "Sales Rep") query = query.eq("assigned_rep_id", req.user!.id);
    if (requestedProductIds.length > 0) query = query.in("product_id", requestedProductIds);
    const result = await query.range(from, to);
    return { data: result.data, error: result.error };
  };

  const [cohortOrdersResult, deliveredOrdersResult] = await Promise.all([
    fetchAllRows<any>(fetchCohortPage),
    fetchAllRows<any>(fetchDeliveredPage)
  ]);

  if (cohortOrdersResult.error) {
    res.status(500).json({ error: cohortOrdersResult.error.message });
    return;
  }
  if (deliveredOrdersResult.error) {
    res.status(500).json({ error: deliveredOrdersResult.error.message });
    return;
  }

  res.json({
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    cohortOrders: cohortOrdersResult.data ?? [],
    deliveredOrders: deliveredOrdersResult.data ?? []
  });
});

export default router;
