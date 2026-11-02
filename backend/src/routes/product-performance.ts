import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole, scopeOf } from "../middleware/auth.js";
import { lagosDateKey } from "../lib/sales-bonus-engine.js";
import { hideSilentOrders } from "../lib/product-launch.js";
import { endIso, startIso } from "../lib/tracking-hub-data.js";
import { monthBounds, monthNet, monthsEnding, productMonths, type MonthlyExpense, type MonthlyOrder } from "../lib/product-monthly.js";
import { judgeRepMonth, mostCommon, repMonthFigures, repProducts, type RepCarts, type RepMonthStat, type RepOrder, type RepVerdict } from "../lib/rep-monthly.js";
import { repBonusesForPlacedRange } from "../lib/marketing-performance.js";
import { salariedFixed } from "../lib/salary-spread.js";
import { lateSendsFor } from "../lib/late-send.js";
import { LATE_SEND_FROM, lagosDateOf } from "../lib/late-send-rules.js";
import { addDaysToDateKey, sundayWeekStartForDateKey } from "../lib/sales-bonus-engine.js";

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

    // Every expense of the window: Ad Spend for the ads, the rest for net
    // profit (Finance's running costs). Paged - a month can pass 1,000 rows.
    const expenses: MonthlyExpense[] = [];
    for (let page = 0; page < 100; page += 1) {
      const { data, error } = await supabase.from("expenses").select("id, product_id, date, amount, category")
        .eq("org_id", orgId).eq("branch_id", branchId).gte("date", from).lte("date", to)
        .order("id").range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      for (const row of (data ?? []) as any[]) {
        expenses.push({ productId: row.product_id ?? null, month: String(row.date).slice(0, 7), amount: Number(row.amount) || 0, category: String(row.category ?? "") });
      }
      if ((data ?? []).length < PAGE) break;
    }
    const [productsRes, targetsRes] = await Promise.all([
      supabase.from("products").select("id, name, active").eq("org_id", orgId),
      supabase.from("tracking_ad_spend_targets").select("product_id, target_cpa").eq("org_id", orgId).eq("branch_id", branchId)
    ]);
    if (productsRes.error) throw productsRes.error;
    if (targetsRes.error) throw targetsRes.error;
    const adSpend = expenses.filter((row) => row.category === "Ad Spend");
    const ownTarget = new Map(((targetsRes.data ?? []) as any[]).map((row) => [String(row.product_id), Number(row.target_cpa)]));

    const seen = new Set<string>();
    for (const row of orders) if (row.productId) seen.add(row.productId);
    for (const row of adSpend) if (row.productId) seen.add(row.productId);
    const products = ((productsRes.data ?? []) as any[])
      .filter((product) => seen.has(String(product.id)))
      .map((product) => {
        const id = String(product.id);
        const stats = productMonths({ productId: id, months, orders, expenses, ownBreakEven: ownTarget.get(id) ?? null });
        return { id, name: String(product.name ?? "Product"), active: product.active !== false, months: stats };
      })
      .filter((product) => product.months.some((stat) => stat.verdict !== null))
      .sort((a, b) => (b.months[b.months.length - 1].orders - a.months[a.months.length - 1].orders) || (b.months[b.months.length - 1].revenue - a.months[a.months.length - 1].revenue));

    // Ad spend not given to any product: in the month totals, never on a product.
    const unassigned = months.map((key) => adSpend.filter((row) => !row.productId && row.month === key).reduce((sum, row) => sum + row.amount, 0));

    // Net for the whole month, as Finance: every product's margin − every running cost but Delivery.
    const net = months.map((key) => monthNet(key, orders, expenses));

    res.json({ month, months, thisMonth, today, products, unassignedAdSpend: unassigned, net });
  } catch (error: any) {
    console.error("[product-performance]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not load the monthly performance." });
  }
});

// ── Sales reps (Bright, 2 Nov 2026) ──────────────────────────────────────────

/** Worked-out months are kept a few minutes: the bonus rules are slow to read. */
const repCache = new Map<string, { at: number; body: unknown }>();
const REP_CACHE_MS = 5 * 60_000;

async function pagedRows(build: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const rows: any[] = [];
  for (let page = 0; page < 100; page += 1) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) break;
  }
  return rows;
}

router.get("/reps", requireRole("Owner", "Admin"), async (req, res) => {
  try {
    const orgId = req.user!.orgId;
    const branchId = req.user!.branchId;
    if (!branchId) { res.status(400).json({ error: "Open a branch first." }); return; }
    const today = lagosDateKey(new Date().toISOString());
    const thisMonth = today.slice(0, 7);
    const asked = typeof req.query.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month) ? req.query.month : monthsEnding(thisMonth, 2)[0];
    const month = asked > thisMonth ? thisMonth : asked;
    const cacheKey = `${orgId}:${branchId}:${month}:${scopeOf(req).role}`;
    const hit = repCache.get(cacheKey);
    if (hit && Date.now() - hit.at < REP_CACHE_MS) { res.json(hit.body); return; }

    const months = monthsEnding(month, MONTHS_SHOWN);
    const from = monthBounds(months[0]).from;
    const to = monthBounds(month).to;
    const monthOf = (iso: string) => lagosDateKey(iso).slice(0, 7);

    const { data: repRows, error: repError } = await supabase.from("users").select("id, name, active, created_at").eq("org_id", orgId).eq("role", "Sales Rep");
    if (repError) throw repError;
    const reps = new Map(((repRows ?? []) as any[]).map((row) => [String(row.id), row]));

    const orderRows = await pagedRows((a, b) => {
      // `any`: this many columns makes the client's typed select too deep for tsc.
      let query: any = supabase.from("orders")
        .select("id, created_at, assigned_rep_id, product_id, product_name, status, amount, cogs_snapshot, logistics_cost, review_hold, upsell_from_qty, upsell_to_qty, original_amount, cross_sell_lines")
        .eq("org_id", orgId).eq("branch_id", branchId).not("assigned_rep_id", "is", null)
        .gte("created_at", startIso(from)).lte("created_at", endIso(to));
      query = hideSilentOrders(query, scopeOf(req).role);
      return query.order("id").range(a, b);
    });

    const [bonuses, structuresRes, missRows, fineRows, cartRows] = await Promise.all([
      repBonusesForPlacedRange(orgId, branchId, from, to),
      supabase.from("pay_structures").select("user_id, type, fixed_salary").eq("org_id", orgId),
      pagedRows((a, b) => supabase.from("follow_up_misses").select("id, rep_id, miss_date").eq("org_id", orgId).eq("branch_id", branchId).gte("miss_date", from).lte("miss_date", to).order("id").range(a, b)),
      pagedRows((a, b) => supabase.from("rep_penalties").select("id, rep_id, amount, created_at").eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", startIso(from)).lte("created_at", endIso(to)).order("id").range(a, b)),
      pagedRows((a, b) => supabase.from("abandoned_carts").select("id, assigned_rep_id, assigned_at, status").eq("org_id", orgId).eq("branch_id", branchId).is("merged_into", null).not("assigned_rep_id", "is", null).gte("assigned_at", startIso(from)).lte("assigned_at", endIso(to)).order("id").range(a, b))
    ]);
    if (structuresRes.error) throw structuresRes.error;
    const attemptRows = await pagedRows((a, b) => supabase.from("cart_contact_attempts").select("id, cart_id, outcome_code").eq("org_id", orgId).eq("branch_id", branchId).gte("attempted_at", startIso(from)).order("id").range(a, b));

    // Late sends: the existing late-send rules, week by week (they start on LATE_SEND_FROM).
    const lateByRepMonth = new Map<string, number>();
    if (to >= LATE_SEND_FROM) {
      const nowMs = Date.now();
      for (let week = sundayWeekStartForDateKey(from > LATE_SEND_FROM ? from : LATE_SEND_FROM); week <= sundayWeekStartForDateKey(to) && week <= today; week = addDaysToDateKey(week, 7)) {
        const weekly = await lateSendsFor(orgId, week, nowMs);
        for (const [repId, entry] of Object.entries(weekly)) {
          for (const order of entry.orders) {
            const key = `${repId}:${lagosDateOf(Date.parse(order.deadline)).slice(0, 7)}`;
            lateByRepMonth.set(key, (lateByRepMonth.get(key) ?? 0) + 1);
          }
        }
      }
    }

    const salaryOf = new Map(((structuresRes.data ?? []) as any[]).map((row) => [String(row.user_id), salariedFixed(row)]));
    const count = (rows: any[], repKey: string, dateKey: (row: any) => string, value: (row: any) => number = () => 1) => {
      const out = new Map<string, number>();
      for (const row of rows) {
        const key = `${row[repKey]}:${dateKey(row)}`;
        out.set(key, (out.get(key) ?? 0) + value(row));
      }
      return out;
    };
    const missed = count(missRows, "rep_id", (row) => String(row.miss_date).slice(0, 7));
    const fines = count(fineRows, "rep_id", (row) => monthOf(row.created_at), (row) => Number(row.amount) || 0);
    const attemptsByCart = new Map<string, string[]>();
    for (const row of attemptRows) attemptsByCart.set(String(row.cart_id), [...(attemptsByCart.get(String(row.cart_id)) ?? []), String(row.outcome_code ?? "")]);
    const carts = new Map<string, RepCarts>();
    for (const cart of cartRows) {
      const key = `${cart.assigned_rep_id}:${monthOf(cart.assigned_at)}`;
      const entry = carts.get(key) ?? { handed: 0, called: 0, interested: 0, converted: 0 };
      const outcomes = attemptsByCart.get(String(cart.id)) ?? [];
      const converted = cart.status === "Converted";
      entry.handed += 1;
      if (outcomes.length > 0 || cart.status !== "Assigned") entry.called += 1;
      if (converted || outcomes.some((code) => code === "Interested" || code === "Wants to order now")) entry.interested += 1;
      if (converted) entry.converted += 1;
      carts.set(key, entry);
    }

    const orders: RepOrder[] = [];
    for (const row of orderRows) {
      if (row.review_hold === true || !reps.has(String(row.assigned_rep_id))) continue;
      const lines = (Array.isArray(row.cross_sell_lines) ? row.cross_sell_lines : []) as any[];
      const crossSells = lines.map((line) => ({ name: String(line.productName ?? "Product"), amount: Number(line.amount) || 0 }));
      const crossTotal = crossSells.reduce((sum, line) => sum + line.amount, 0);
      const from = Number(row.upsell_from_qty) || 0, toQty = Number(row.upsell_to_qty) || 0;
      const upsold = toQty > from && from > 0;
      orders.push({
        repId: String(row.assigned_rep_id), month: monthOf(row.created_at), productId: row.product_id ?? null, productName: String(row.product_name ?? "Product"),
        status: String(row.status ?? ""), amount: Number(row.amount) || 0, productCost: Number(row.cogs_snapshot) || 0, deliveryFee: Number(row.logistics_cost) || 0,
        bonus: bonuses.byOrderId.get(String(row.id)) ?? 0,
        upsold, upsellValue: upsold && Number(row.original_amount) > 0 ? Math.max(0, (Number(row.amount) || 0) - crossTotal - Number(row.original_amount)) : 0,
        upsellLabel: upsold ? `${row.product_name ?? "Product"} ${from} → ${toQty}` : null,
        crossSells
      });
    }

    // Every rep with anything in the six months.
    const repIds = new Set<string>();
    for (const order of orders) repIds.add(order.repId);
    for (const key of [...missed.keys(), ...lateByRepMonth.keys(), ...carts.keys()]) { const id = key.split(":")[0]; if (reps.has(id)) repIds.add(id); }

    const perMonth: Array<Map<string, RepMonthStat>> = [];
    for (const key of months) {
      const stats = new Map<string, RepMonthStat>();
      for (const repId of repIds) {
        stats.set(repId, repMonthFigures({
          month: key, orders: orders.filter((order) => order.repId === repId && order.month === key), salary: salaryOf.get(repId) ?? 0,
          discipline: { lateSends: lateByRepMonth.get(`${repId}:${key}`) ?? 0, missedFollowUps: missed.get(`${repId}:${key}`) ?? 0, fines: fines.get(`${repId}:${key}`) ?? 0 },
          carts: carts.get(`${repId}:${key}`)
        }));
      }
      const previous = new Map<string, RepVerdict | null>();
      if (perMonth.length) for (const [repId, stat] of perMonth[perMonth.length - 1]) previous.set(repId, stat.verdict);
      judgeRepMonth(stats, previous);
      perMonth.push(stats);
    }

    const last = perMonth[perMonth.length - 1];
    const repList = [...repIds].map((repId) => {
      const user = reps.get(repId);
      const monthOrders = orders.filter((order) => order.repId === repId && order.month === month);
      return {
        id: repId, name: String(user?.name ?? "Sales rep"), active: user?.active !== false, since: user?.created_at ?? null,
        months: perMonth.map((stats) => stats.get(repId)!),
        products: repProducts(monthOrders),
        bestUpsell: mostCommon(monthOrders.map((order) => order.upsellLabel)),
        topCrossSell: mostCommon(monthOrders.flatMap((order) => order.crossSells.map((line) => line.name)))
      };
    }).filter((rep) => rep.months.some((stat) => stat.verdict !== null))
      .sort((a, b) => ((last.get(a.id)?.rank ?? 999) - (last.get(b.id)?.rank ?? 999)) || (last.get(b.id)!.orders - last.get(a.id)!.orders));

    const body = { month, months, thisMonth, today, reps: repList, bonusRulesUnavailable: bonuses.rulesUnavailable, lateSendsFrom: LATE_SEND_FROM };
    repCache.set(cacheKey, { at: Date.now(), body });
    res.json(body);
  } catch (error: any) {
    console.error("[product-performance/reps]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not load the sales reps." });
  }
});

export default router;
