import { Router } from "express";
import { humanFieldErrors } from "../lib/validation-message.js";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { fetchPagesTogether } from "../lib/paged-fetch.js";
import { liteOrder } from "../lib/lite-lists.js";
import { inventoryOperationsOrder } from "../lib/inventory-operations-access.js";
import { hideSilentOrders } from "../lib/product-launch.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";

const router = Router();
// The logistics role reads this for Product Trend only (Bright, 1 Nov 2026),
// and gets the same stripped orders as its order list: no amount, customer
// or phone ever leaves the server for it (lib/inventory-operations-access.ts).
const LOGISTICS_ROLE = "Inventory Manager & Logistics Operations";
router.use(requireAuth, requireRole("Owner", "Admin", "Manager", "Viewer", LOGISTICS_ROLE));

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
    res.status(400).json({ error: humanFieldErrors(parsed.error) });
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

  const fetchCohortPage = async (from: number, to: number, withCount: boolean) => {
    let query = supabase
      .from("orders")
      .select("*", withCount ? { count: "exact" } : undefined)
      .eq("org_id", req.user!.orgId)
      .gte("created_at", createdFrom)
      .lte("created_at", createdTo)
      // Exclude held duplicates from the placed-in-period throughput cohort.
      .or("review_hold.is.null,review_hold.eq.false")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (scopeOf(req).role === "Sales Rep") query = query.eq("assigned_rep_id", scopeOf(req).id);
    if (requestedProductIds.length > 0) query = query.in("product_id", requestedProductIds);
    // Silent Test orders (Product Launch) are the Owner's alone.
    query = hideSilentOrders(query, scopeOf(req).role);
    const result = await query.range(from, to);
    return { data: result.data, error: result.error, count: result.count };
  };

  const fetchDeliveredPage = async (from: number, to: number, withCount: boolean) => {
    let query = supabase
      .from("orders")
      .select("*", withCount ? { count: "exact" } : undefined)
      .eq("org_id", req.user!.orgId)
      .eq("status", "Delivered")
      .gte("delivered_date", dateFrom)
      .lte("delivered_date", dateTo)
      .order("delivered_date", { ascending: false })
      .order("id", { ascending: false });
    if (scopeOf(req).role === "Sales Rep") query = query.eq("assigned_rep_id", scopeOf(req).id);
    if (requestedProductIds.length > 0) query = query.in("product_id", requestedProductIds);
    // Silent Test orders (Product Launch) are the Owner's alone.
    query = hideSilentOrders(query, scopeOf(req).role);
    const result = await query.range(from, to);
    return { data: result.data, error: result.error, count: result.count };
  };

  // Pages read together, not one after another (lib/paged-fetch.ts); 50,000
  // is the same ceiling as the orders list. ~8 s and +300 MB a load (31 Oct 2026).
  const [cohortOrdersResult, deliveredOrdersResult] = await Promise.all([
    fetchPagesTogether(fetchCohortPage, { limit: 50_000 }),
    fetchPagesTogether(fetchDeliveredPage, { limit: 50_000 })
  ]);

  if (cohortOrdersResult.error) {
    res.status(500).json({ error: cohortOrdersResult.error.message });
    return;
  }
  if (deliveredOrdersResult.error) {
    res.status(500).json({ error: deliveredOrdersResult.error.message });
    return;
  }

  const shape = scopeOf(req).role === LOGISTICS_ROLE ? inventoryOperationsOrder : liteOrder;
  res.json({
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    // Lite, like every other order list: leaves out the browser/landing-page
    // details only the order detail window shows - a third of each order.
    cohortOrders: cohortOrdersResult.rows.map(shape),
    deliveredOrders: deliveredOrdersResult.rows.map(shape)
  });
});

export default router;
