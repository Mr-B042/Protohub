import { Router } from "express";
import { orderInventoryLinesFromRow } from "../lib/order-inventory.js";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

// Manager Dashboard "Needs Attention" tab. Everything except this one check is
// computed client-side from already-loaded orders (review holds, stuck-in-New,
// thin failed-delivery notes, per-rep fee spread) - this route only covers the
// one thing that genuinely needs data the frontend doesn't have loaded:
// stock_movements, to detect a delivered order whose deduction only partially
// went through (as opposed to being skipped entirely, which is already visible
// client-side via orders.stock_deducted = false).
const router = Router();
router.use(requireAuth, requireRole("Owner", "Admin", "Manager"));

const WINDOW_DAYS = 60;

router.get("/stock-mismatches", async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, quantity, product_id, product_name, package_components_snapshot, cross_sell_lines, free_gift_lines, delivered_date")
      .eq("org_id", orgId)
      .eq("status", "Delivered")
      .eq("stock_deducted", true)
      .gte("delivered_date", since);
    if (ordersError) throw ordersError;
    if (!orders || orders.length === 0) {
      res.json({ rows: [] });
      return;
    }

    const orderIds = orders.map((order) => order.id);
    const { data: movements, error: movementsError } = await supabase
      .from("stock_movements")
      .select("order_id, product_id, type, qty")
      .eq("org_id", orgId)
      .in("order_id", orderIds)
      .in("type", ["Order Fulfilled", "Status Reversal", "Delete Reversal"]);
    if (movementsError) throw movementsError;

    const netDeductedByOrderProduct = new Map<string, number>();
    for (const movement of movements ?? []) {
      const key = `${movement.order_id}::${movement.product_id}`;
      const qty = Number(movement.qty ?? 0);
      const delta = movement.type === "Order Fulfilled" ? qty : -qty;
      netDeductedByOrderProduct.set(key, (netDeductedByOrderProduct.get(key) ?? 0) + delta);
    }

    const rows: Array<{ orderId: string; productId: string; productName: string; expectedQty: number; deductedQty: number; deliveredDate: string }> = [];
    for (const order of orders) {
      const lines = orderInventoryLinesFromRow(order);
      for (const line of lines) {
        const deductedQty = netDeductedByOrderProduct.get(`${order.id}::${line.productId}`) ?? 0;
        if (deductedQty < line.quantity) {
          rows.push({
            orderId: order.id,
            productId: line.productId,
            productName: line.productName,
            expectedQty: line.quantity,
            deductedQty: Math.max(0, deductedQty),
            deliveredDate: order.delivered_date
          });
        }
      }
    }

    res.json({ rows });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? "Could not load stock deduction mismatches." });
  }
});

export default router;
