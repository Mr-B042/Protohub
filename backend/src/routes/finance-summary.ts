import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
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

  let cohortOrdersQuery = supabase
    .from("orders")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .gte("created_at", createdFrom)
    .lte("created_at", createdTo)
    .order("created_at", { ascending: false });

  let deliveredOrdersQuery = supabase
    .from("orders")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .eq("status", "Delivered")
    .gte("delivered_date", dateFrom)
    .lte("delivered_date", dateTo)
    .order("delivered_date", { ascending: false });

  if (req.user!.role === "Sales Rep") {
    cohortOrdersQuery = cohortOrdersQuery.eq("assigned_rep_id", req.user!.id);
    deliveredOrdersQuery = deliveredOrdersQuery.eq("assigned_rep_id", req.user!.id);
  }

  if (requestedProductIds.length > 0) {
    cohortOrdersQuery = cohortOrdersQuery.in("product_id", requestedProductIds);
    deliveredOrdersQuery = deliveredOrdersQuery.in("product_id", requestedProductIds);
  }

  const [cohortOrdersResult, deliveredOrdersResult] = await Promise.all([
    cohortOrdersQuery,
    deliveredOrdersQuery
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
