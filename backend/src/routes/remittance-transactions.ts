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

const BackfillSchema = z.object({
  dryRun: z.boolean().optional(),
  dateMode: z.enum(["updated_at", "delivered_date", "created_at"]).optional()
});

const toWatUtcIso = (dateKey: string, time: "start" | "end") =>
  new Date(
    `${dateKey}T${time === "start" ? "00:00:00.000" : "23:59:59.999"}+01:00`
  ).toISOString();

const toWatNoonIso = (dateKey: string) =>
  new Date(`${dateKey}T12:00:00+01:00`).toISOString();

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const coerceIsoLike = (value: unknown) => {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const trimmed = value.trim();
  if (DATE_KEY_PATTERN.test(trimmed)) {
    return toWatNoonIso(trimmed);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const chunk = <T>(items: T[], size: number) => {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
};

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

const inferBackfillReceivedAt = (
  order: Record<string, any>,
  mode: "updated_at" | "delivered_date" | "created_at"
) => {
  const fields =
    mode === "updated_at"
      ? ["updated_at", "delivered_date", "created_at"]
      : mode === "delivered_date"
        ? ["delivered_date", "updated_at", "created_at"]
        : ["created_at", "updated_at", "delivered_date"];
  for (const field of fields) {
    const iso = coerceIsoLike(order[field]);
    if (iso) {
      return { iso, source: field };
    }
  }
  return null;
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

  const ordersQuery = supabase
    .from("orders")
    .select("id, product_id, product_name, package_name, customer, created_at, delivered_date, assigned_rep_id, agent_id, agent_name_snapshot, amount, logistics_cost, amount_remitted, remittance_status")
    .eq("org_id", req.user!.orgId)
    .in("id", orderIds);

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
      const productId = row.product_id_snapshot ?? order?.product_id ?? null;
      const assignedRepId = row.assigned_rep_id_snapshot ?? order?.assigned_rep_id ?? null;
      if (req.user!.role === "Sales Rep" && assignedRepId !== req.user!.id) return null;
      if (requestedProductIds.length > 0 && (!productId || !requestedProductIds.includes(String(productId)))) return null;
      if (!order && !productId && !row.customer_snapshot && !row.product_name_snapshot) return null;
      const orderAmount = row.order_amount_snapshot != null ? numericAmount(row.order_amount_snapshot) : numericAmount(order?.amount);
      const logisticsCost = row.logistics_cost_snapshot != null ? numericAmount(row.logistics_cost_snapshot) : numericAmount(order?.logistics_cost);
      const currentAmountRemitted = numericAmount(order?.amount_remitted ?? row.running_amount_remitted);
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
        productId,
        productName: row.product_name_snapshot ?? order?.product_name ?? null,
        packageName: row.package_name_snapshot ?? order?.package_name ?? null,
        customer: row.customer_snapshot ?? order?.customer ?? null,
        orderCreatedAt: row.order_created_at_snapshot ?? order?.created_at ?? null,
        orderDeliveredDate: row.order_delivered_date_snapshot ?? order?.delivered_date ?? null,
        assignedRepId,
        agentId: row.agent_id_snapshot ?? order?.agent_id ?? null,
        agentName: order.agent_name_snapshot ?? null,
        orderAmount,
        logisticsCost,
        currentAmountRemitted,
        currentExpectedRemittance,
        currentOutstanding,
        remittanceStatus: order?.remittance_status ?? (currentOutstanding <= 0 ? "Paid" : currentAmountRemitted > 0 ? "Partially Paid" : "Pending")
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

router.post("/backfill", async (req, res) => {
  if (!req.user || !["Owner", "Admin"].includes(req.user.role)) {
    res.status(403).json({ error: "Only Owner or Admin can backfill remittance history." });
    return;
  }

  const parsed = BackfillSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten().fieldErrors });
    return;
  }

  const dryRun = parsed.data.dryRun === true;
  const dateMode = parsed.data.dateMode ?? "updated_at";

  const existingResult = await supabase
    .from("remittance_transactions")
    .select("order_id")
    .eq("org_id", req.user.orgId);

  if (existingResult.error) {
    if (isMissingRemittanceTableError(existingResult.error)) {
      res.status(409).json({ error: "Remittance transaction ledger is not available yet. Apply migration 061 first." });
      return;
    }
    res.status(500).json({ error: existingResult.error.message });
    return;
  }

  const existingOrderIds = new Set(
    (existingResult.data ?? [])
      .map((row: any) => (typeof row.order_id === "string" ? row.order_id : ""))
      .filter(Boolean)
  );

  const ordersResult = await supabase
    .from("orders")
    .select("id, customer, product_id, product_name, package_name, assigned_rep_id, agent_id, amount, logistics_cost, amount_remitted, remittance_status, created_at, updated_at, delivered_date")
    .eq("org_id", req.user.orgId)
    .gt("amount_remitted", 0);

  if (ordersResult.error) {
    res.status(500).json({ error: ordersResult.error.message });
    return;
  }

  const orders = ordersResult.data ?? [];
  const candidates = orders.filter((order: any) => !existingOrderIds.has(String(order.id)));
  const skippedNoDate: string[] = [];
  const prepared = candidates
    .map((order: any) => {
      const amountRemitted = Number(order.amount_remitted ?? 0);
      if (!(amountRemitted > 0)) return null;
      const inferred = inferBackfillReceivedAt(order, dateMode);
      if (!inferred) {
        skippedNoDate.push(String(order.id));
        return null;
      }
      return {
        org_id: req.user!.orgId,
        order_id: String(order.id),
        delta_amount: amountRemitted,
        previous_amount_remitted: 0,
        running_amount_remitted: amountRemitted,
        received_at: inferred.iso,
        logged_by_user_id: req.user!.id,
        logged_by_name: req.user!.name,
        reason: `Historical remittance bootstrap (${dateMode}/${inferred.source})`,
        order_created_at_snapshot: order.created_at ?? null,
        order_delivered_date_snapshot: order.delivered_date ?? null,
        product_id_snapshot: order.product_id ?? null,
        product_name_snapshot: order.product_name ?? null,
        package_name_snapshot: order.package_name ?? null,
        customer_snapshot: order.customer ?? null,
        assigned_rep_id_snapshot: order.assigned_rep_id ?? null,
        agent_id_snapshot: order.agent_id ?? null,
        order_amount_snapshot: numericAmount(order.amount),
        logistics_cost_snapshot: numericAmount(order.logistics_cost),
        expected_remittance_snapshot: Math.max(0, numericAmount(order.amount) - numericAmount(order.logistics_cost)),
        customer: order.customer ?? null
      };
    })
    .filter(Boolean) as Array<Record<string, unknown> & { order_id: string; customer?: string | null }>;

  if (!dryRun) {
    for (const batch of chunk(prepared, 500)) {
      const insertRows = batch.map(({ customer: _customer, ...row }) => row);
      let insertResult = await supabase.from("remittance_transactions").insert(insertRows);
      if (insertResult.error && isMissingRemittanceTableError(insertResult.error)) {
        res.status(409).json({ error: "Remittance transaction ledger is not available yet. Apply migration 061 first." });
        return;
      }
      if (insertResult.error && /order_created_at_snapshot|order_delivered_date_snapshot|product_id_snapshot|product_name_snapshot|package_name_snapshot|customer_snapshot|assigned_rep_id_snapshot|agent_id_snapshot|order_amount_snapshot|logistics_cost_snapshot|expected_remittance_snapshot/i.test(insertResult.error.message ?? "")) {
        const legacyRows = insertRows.map((row) => {
          const clone = { ...row };
          delete clone.order_created_at_snapshot;
          delete clone.order_delivered_date_snapshot;
          delete clone.product_id_snapshot;
          delete clone.product_name_snapshot;
          delete clone.package_name_snapshot;
          delete clone.customer_snapshot;
          delete clone.assigned_rep_id_snapshot;
          delete clone.agent_id_snapshot;
          delete clone.order_amount_snapshot;
          delete clone.logistics_cost_snapshot;
          delete clone.expected_remittance_snapshot;
          return clone;
        });
        insertResult = await supabase.from("remittance_transactions").insert(legacyRows);
      }
      if (insertResult.error) {
        res.status(500).json({ error: insertResult.error.message });
        return;
      }
    }
  }

  res.json({
    dryRun,
    dateMode,
    candidateCount: candidates.length,
    insertedCount: prepared.length,
    skippedExistingCount: orders.length - candidates.length,
    skippedNoDateCount: skippedNoDate.length,
    sample: prepared.slice(0, 5).map((row) => ({
      orderId: row.order_id,
      customer: row.customer ?? null,
      receivedAt: row.received_at
    })),
    generatedAt: new Date().toISOString()
  });
});

export default router;
