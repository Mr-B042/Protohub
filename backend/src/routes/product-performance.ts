import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { lagosDateKey } from "../lib/sales-bonus-engine.js";
import { hideSilentOrders } from "../lib/product-launch.js";
import { endIso, startIso } from "../lib/tracking-hub-data.js";
import { monthBounds, monthsEnding, productMonths, type MonthlyAdSpend, type MonthlyOrder } from "../lib/product-monthly.js";

/**
 * Product Trend › Monthly Performance (Bright, 2 Nov 2026). Owner / Admin
 * only: it is built on profit after ads (Manager has no Finance page).
 * Maths and verdict rules: lib/product-monthly.ts.
 */
const router = Router();
router.use(requireAuth);

const PAGE = 1000;
const MONTHS_SHOWN = 6;

router.get("/monthly", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = req.user!.branchId;
    if (!branchId) { res.status(400).json({ error: "Open a branch first." }); return; }
    const today = lagosDateKey(new Date().toISOString());
    const thisMonth = today.slice(0, 7);
    // No month asked: the last closed month (a new month's first days say little).
    const asked = typeof req.query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : monthsEnding(thisMonth, 2)[0];
    const month = asked > thisMonth ? thisMonth : asked;
    const months = monthsEnding(month, MONTHS_SHOWN);
    const from = monthBounds(months[0]).from;
    const to = monthBounds(month).to;

    const orders: MonthlyOrder[] = [];
    for (let page = 0; page < 100; page += 1) {
      let query = supabase.from("orders")
        .select("id, created_at, product_id, status, amount, cogs_snapshot, logistics_cost, review_hold")
        .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", startIso(from)).lte("created_at", endIso(to));
      query = hideSilentOrders(query, scopeOf(req).role);
      const { data, error } = await query.order("id").range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      for (const row of (data ?? []) as any[]) {
        // Held duplicates are left out, as everywhere else on Product Trend.
        if (row.review_hold === true) continue;
        orders.push({
          productId: row.product_id ?? null, month: lagosDateKey(row.created_at).slice(0, 7), status: String(row.status ?? ""),
          amount: Number(row.amount) || 0, productCost: Number(row.cogs_snapshot) || 0, deliveryFee: Number(row.logistics_cost) || 0
        });
      }
      if ((data ?? []).length < PAGE) break;
    }

    const [spendRes, productsRes, targetsRes] = await Promise.all([
      // The Daily Ad Spend rows: Meta filled in by itself, TikTok typed (lib/ad-spend-expenses.ts).
      supabase.from("expenses").select("product_id, date, amount").eq("org_id", orgId).eq("branch_id", branchId).eq("category", "Ad Spend").gte("date", from).lte("date", to).limit(20000),
      supabase.from("products").select("id, name, active").eq("org_id", orgId),
      supabase.from("tracking_ad_spend_targets").select("product_id, target_cpa").eq("org_id", orgId).eq("branch_id", branchId)
    ]);
    if (spendRes.error) throw spendRes.error;
    if (productsRes.error) throw productsRes.error;
    if (targetsRes.error) throw targetsRes.error;
    const adSpend: MonthlyAdSpend[] = ((spendRes.data ?? []) as any[]).map((row) => ({ productId: row.product_id ?? null, month: String(row.date).slice(0, 7), amount: Number(row.amount) || 0 }));
    const ownTarget = new Map(((targetsRes.data ?? []) as any[]).map((row) => [String(row.product_id), Number(row.target_cpa)]));

    const seen = new Set<string>();
    for (const row of orders) if (row.productId) seen.add(row.productId);
    for (const row of adSpend) if (row.productId) seen.add(row.productId);
    const products = ((productsRes.data ?? []) as any[])
      .filter((product) => seen.has(String(product.id)))
      .map((product) => {
        const id = String(product.id);
        const stats = productMonths({ productId: id, months, orders, adSpend, ownBreakEven: ownTarget.get(id) ?? null });
        return { id, name: String(product.name ?? "Product"), active: product.active !== false, months: stats };
      })
      .filter((product) => product.months.some((stat) => stat.verdict !== null))
      .sort((a, b) => (b.months[b.months.length - 1].orders - a.months[a.months.length - 1].orders) || (b.months[b.months.length - 1].revenue - a.months[a.months.length - 1].revenue));

    // Ad spend not given to any product: in the month totals, never on a product.
    const unassigned = months.map((key) => adSpend.filter((row) => !row.productId && row.month === key).reduce((sum, row) => sum + row.amount, 0));

    res.json({ month, months, thisMonth, today, products, unassignedAdSpend: unassigned });
  } catch (error: any) {
    console.error("[product-performance]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not load the monthly performance." });
  }
});

export default router;
