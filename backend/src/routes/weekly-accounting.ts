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

const numericAmount = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
    const remittanceOrdersQuery = supabase
      .from("orders")
      .select("id, product_id, product_name, package_name, customer, created_at, delivered_date, assigned_rep_id")
      .eq("org_id", req.user!.orgId)
      .in("id", remittanceOrderIds);

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
      const productId = row.product_id_snapshot ?? order?.product_id ?? null;
      const assignedRepId = row.assigned_rep_id_snapshot ?? order?.assigned_rep_id ?? null;
      if (req.user!.role === "Sales Rep" && assignedRepId !== req.user!.id) return null;
      if (
        requestedProductIds.length > 0
        && (!productId || !requestedProductIds.includes(String(productId)))
      ) {
        return null;
      }
      if (!order && !productId && !row.customer_snapshot && !row.product_name_snapshot) return null;
      return {
        ...row,
        product_id: productId,
        product_name: row.product_name_snapshot ?? order?.product_name ?? null,
        package_name: row.package_name_snapshot ?? order?.package_name ?? null,
        customer: row.customer_snapshot ?? order?.customer ?? null,
        order_created_at: row.order_created_at_snapshot ?? order?.created_at ?? null,
        order_delivered_date: row.order_delivered_date_snapshot ?? order?.delivered_date ?? null,
        assigned_rep_id: assignedRepId,
        expected_remittance_snapshot: row.expected_remittance_snapshot != null
          ? numericAmount(row.expected_remittance_snapshot)
          : null
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
