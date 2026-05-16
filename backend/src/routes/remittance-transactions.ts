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

  const { dateFrom, dateTo, productIds } = parsed.data;
  const requestedProductIds = Array.from(
    new Set(
      (productIds ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );

  const receivedFrom = toWatUtcIso(dateFrom, "start");
  const receivedTo = toWatUtcIso(dateTo, "end");

  const txResult = await supabase
    .from("remittance_transactions")
    .select("*")
    .eq("org_id", req.user!.orgId)
    .gte("received_at", receivedFrom)
    .lte("received_at", receivedTo)
    .order("received_at", { ascending: false });

  if (txResult.error) {
    if (isMissingRemittanceTableError(txResult.error)) {
      res.json({
        dateFrom,
        dateTo,
        generatedAt: new Date().toISOString(),
        transactions: []
      });
      return;
    }
    res.status(500).json({ error: txResult.error.message });
    return;
  }

  const rows = txResult.data ?? [];
  const orderIds = Array.from(
    new Set(
      rows
        .map((row: any) => (typeof row.order_id === "string" ? row.order_id : ""))
        .filter(Boolean)
    )
  );

  if (orderIds.length === 0) {
    res.json({
      dateFrom,
      dateTo,
      generatedAt: new Date().toISOString(),
      transactions: []
    });
    return;
  }

  let ordersQuery = supabase
    .from("orders")
    .select("id, product_id, product_name, package_name, customer, created_at, delivered_date, assigned_rep_id, agent_id, agent_name_snapshot, amount, logistics_cost, amount_remitted, remittance_status")
    .eq("org_id", req.user!.orgId)
    .in("id", orderIds);

  if (req.user!.role === "Sales Rep") {
    ordersQuery = ordersQuery.eq("assigned_rep_id", req.user!.id);
  }

  if (requestedProductIds.length > 0) {
    ordersQuery = ordersQuery.in("product_id", requestedProductIds);
  }

  const ordersResult = await ordersQuery;
  if (ordersResult.error) {
    res.status(500).json({ error: ordersResult.error.message });
    return;
  }

  const orderMap = new Map(
    (ordersResult.data ?? []).map((order: any) => [String(order.id), order])
  );

  const transactions = rows
    .map((row: any) => {
      const order = orderMap.get(String(row.order_id));
      if (!order) return null;
      const orderAmount = Number(order.amount ?? 0);
      const logisticsCost = Number(order.logistics_cost ?? 0);
      const currentAmountRemitted = Number(order.amount_remitted ?? 0);
      const currentExpectedRemittance = Math.max(0, orderAmount - logisticsCost);
      const currentOutstanding = Math.max(0, currentExpectedRemittance - currentAmountRemitted);
      return {
        id: row.id,
        orderId: row.order_id,
        deltaAmount: Number(row.delta_amount ?? 0),
        previousAmountRemitted: Number(row.previous_amount_remitted ?? 0),
        runningAmountRemitted: Number(row.running_amount_remitted ?? 0),
        receivedAt: row.received_at,
        loggedByName: row.logged_by_name ?? null,
        reason: row.reason ?? null,
        productId: order.product_id ?? null,
        productName: order.product_name ?? null,
        packageName: order.package_name ?? null,
        customer: order.customer ?? null,
        orderCreatedAt: order.created_at ?? null,
        orderDeliveredDate: order.delivered_date ?? null,
        assignedRepId: order.assigned_rep_id ?? null,
        agentId: order.agent_id ?? null,
        agentName: order.agent_name_snapshot ?? null,
        orderAmount,
        logisticsCost,
        currentAmountRemitted,
        currentExpectedRemittance,
        currentOutstanding,
        remittanceStatus: order.remittance_status ?? null
      };
    })
    .filter(Boolean);

  res.json({
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    transactions
  });
});

export default router;
