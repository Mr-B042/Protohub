import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

const QuerySchema = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productIds: z.string().optional()
});

const addDays = (dateKey: string, days: number) => {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toWatUtcIso = (dateKey: string, time: "start" | "end") =>
  new Date(
    `${dateKey}T${time === "start" ? "00:00:00.000" : "23:59:59.999"}+01:00`
  ).toISOString();

const isMissingRemittanceTableError = (error: any) => {
  if (!error) return false;
  const message = typeof error.message === "string" ? error.message : "";
  return error.code === "42P01"
    || error.code === "PGRST205"
    || (
      message.includes("remittance_transactions")
      && message.toLowerCase().includes("schema cache")
    );
};

router.get("/", async (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const { weekStart, productIds } = parsed.data;
  const weekEnd = addDays(weekStart, 6);
  const createdFrom = toWatUtcIso(weekStart, "start");
  const createdTo = toWatUtcIso(weekEnd, "end");
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
    .gte("delivered_date", weekStart)
    .lte("delivered_date", weekEnd)
    .order("delivered_date", { ascending: false });

  if (req.user!.role === "Sales Rep") {
    cohortOrdersQuery = cohortOrdersQuery.eq("assigned_rep_id", req.user!.id);
    deliveredOrdersQuery = deliveredOrdersQuery.eq("assigned_rep_id", req.user!.id);
  }

  if (requestedProductIds.length > 0) {
    cohortOrdersQuery = cohortOrdersQuery.in("product_id", requestedProductIds);
    deliveredOrdersQuery = deliveredOrdersQuery.in("product_id", requestedProductIds);
  }

  const [
    cohortOrdersResult,
    deliveredOrdersResult,
    expensesResult,
    remittanceTxResult
  ] = await Promise.all([
    cohortOrdersQuery,
    deliveredOrdersQuery,
    supabase
      .from("expenses")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .gte("date", weekStart)
      .lte("date", weekEnd)
      .order("date", { ascending: false }),
    supabase
      .from("remittance_transactions")
      .select("*")
      .eq("org_id", req.user!.orgId)
      .gte("received_at", createdFrom)
      .lte("received_at", createdTo)
      .order("received_at", { ascending: false })
  ]);

  if (cohortOrdersResult.error) {
    res.status(500).json({ error: cohortOrdersResult.error.message });
    return;
  }
  if (deliveredOrdersResult.error) {
    res.status(500).json({ error: deliveredOrdersResult.error.message });
    return;
  }
  if (expensesResult.error) {
    res.status(500).json({ error: expensesResult.error.message });
    return;
  }
  if (remittanceTxResult.error && !isMissingRemittanceTableError(remittanceTxResult.error)) {
    res.status(500).json({ error: remittanceTxResult.error.message });
    return;
  }

  const remittanceRows = remittanceTxResult.data ?? [];
  const remittanceOrderIds = Array.from(
    new Set(
      remittanceRows
        .map((row: any) => (typeof row.order_id === "string" ? row.order_id : ""))
        .filter(Boolean)
    )
  );

  let remittanceOrderMap = new Map<string, any>();
  if (remittanceOrderIds.length > 0) {
    let remittanceOrdersQuery = supabase
      .from("orders")
      .select("id, product_id, product_name, package_name, customer, created_at, delivered_date, assigned_rep_id")
      .eq("org_id", req.user!.orgId)
      .in("id", remittanceOrderIds);

    if (req.user!.role === "Sales Rep") {
      remittanceOrdersQuery = remittanceOrdersQuery.eq("assigned_rep_id", req.user!.id);
    }

    const { data: remittanceOrders, error: remittanceOrdersError } = await remittanceOrdersQuery;
    if (remittanceOrdersError) {
      res.status(500).json({ error: remittanceOrdersError.message });
      return;
    }
    remittanceOrderMap = new Map(
      (remittanceOrders ?? []).map((row: any) => [String(row.id), row])
    );
  }

  const remittanceTransactions = remittanceRows
    .map((row: any) => {
      const order = remittanceOrderMap.get(String(row.order_id));
      if (!order) return null;
      if (
        requestedProductIds.length > 0
        && (!order.product_id || !requestedProductIds.includes(String(order.product_id)))
      ) {
        return null;
      }
      return {
        ...row,
        product_id: order.product_id ?? null,
        product_name: order.product_name ?? null,
        package_name: order.package_name ?? null,
        customer: order.customer ?? null,
        order_created_at: order.created_at ?? null,
        order_delivered_date: order.delivered_date ?? null,
        assigned_rep_id: order.assigned_rep_id ?? null
      };
    })
    .filter(Boolean);

  res.json({
    weekStart,
    weekEnd,
    generatedAt: new Date().toISOString(),
    cohortOrders: cohortOrdersResult.data ?? [],
    deliveredOrders: deliveredOrdersResult.data ?? [],
    expenses: expensesResult.data ?? [],
    remittanceTransactions: remittanceTransactions
  });
});

export default router;
