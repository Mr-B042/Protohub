/**
 * Marketing Performance Center — ad spend through to real profit.
 *
 * ⚠️ AD SPEND LIVES IN TWO PLACES, AND THE BIG ONE IS `expenses`.
 *
 * marketing_spend_records is the MEDIA BUYER's own book: a buyer is handed a
 * budget, enters what they spent, and it is matched. Bright has no media buyers
 * today, so that table has four rows from June and nothing since.
 *
 * The company's own advertising is entered from the Ad Spend page and lands in
 * `expenses` under the category "Ad Spend" - 263 entries and N20.1m between May
 * and September, one row per product per day. Reading only the buyer table made
 * this page report "not recorded" while N3.9m of September spend sat in plain
 * sight. That was wrong, and it is the reason both are read here.
 *
 * ⚠️ NOT RECORDED IS STILL NOT THE SAME AS ZERO. Where neither book has spend
 * for a period, everything that divides by it returns NULL and the screen says
 * so. A page showing N0 spent and an infinite return would look authoritative
 * and be false.
 *
 * ⚠️ BUDGET GIVEN IS NOT MONEY SPENT. A buyer row with no actual_spent falls
 * back to budget_given so the page works, but the basis is reported and
 * flagged: handing somebody N50,000 is not evidence they spent it.
 *
 * ⚠️ THE TWO ARE ADDED, NOT MAXED. A buyer's spend and the company's own
 * advertising are different money. Company rows are credited to the product
 * they name rather than to a person, because nobody is running them.
 */

import { supabase } from "./supabase.js";

const DELIVERED = "Delivered";
const CONFIRMED_STATUSES = ["Confirmed", "In Process", "Dispatched", "Delivered"];
const LOST_STATUSES = ["Cancelled", "Failed"];

export type SpendBasis = "actual" | "budget" | "mixed" | "none";

export type PerformanceTotals = {
  adSpend: number | null;
  spendBasis: SpendBasis;
  spendRecords: number;
  /** The company's own advertising, from the Ad Spend page. */
  companySpend: number;
  /** What media buyers recorded against their own budgets. */
  buyerSpend: number;
  /** Days in the period with no spend row at all - the honesty signal. */
  daysWithoutSpend: number;
  periodDays: number;

  ordersPlaced: number;
  confirmed: number;
  delivered: number;
  lost: number;
  deliveredRevenue: number;
  productCost: number;
  deliveryCost: number;
  /** Revenue less product cost, delivery and ad spend. Null without spend. */
  trueNetProfit: number | null;

  confirmationRate: number | null;
  deliveryRate: number | null;
  costPerOrder: number | null;
  costPerDeliveredOrder: number | null;
  deliveredAov: number | null;
  placedAov: number | null;
  roas: number | null;
  /** The most you can pay per delivered order and still break even. */
  breakEvenCostPerDelivered: number | null;
};

export type BuyerRow = {
  key: string;
  label: string;
  ordersPlaced: number;
  confirmed: number;
  delivered: number;
  deliveredRevenue: number;
  adSpend: number | null;
  trueNetProfit: number | null;
  margin: number | null;
  roas: number | null;
  costPerDeliveredOrder: number | null;
  deliveryRate: number | null;
};

const ratio = (top: number, bottom: number): number | null =>
  bottom > 0 ? top / bottom : null;

const money = (value: unknown) => Number(value ?? 0) || 0;

/** The label an order is credited to. Falls back rather than dropping the order. */
const buyerKeyFor = (order: any): { key: string; label: string } => {
  const context = order.form_context ?? {};
  const tagged = ["media_buyer", "mediaBuyer", "buyer"]
    .map((key) => String(context?.[key] ?? "").trim())
    .find(Boolean);
  if (tagged) return { key: tagged.toLowerCase(), label: tagged };

  const source = String(order.utm_source ?? "").trim();
  if (source) return { key: source.toLowerCase(), label: source };

  // ⚠️ SHOWN, NOT HIDDEN. Orders nobody can credit are the ones worth arguing
  // about - dropping them would quietly flatter every buyer's numbers.
  return { key: "__unattributed__", label: "Not tagged" };
};

const daysBetween = (from: string, to: string) => {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
};

export async function loadMarketingPerformance(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string
): Promise<{ totals: PerformanceTotals; buyers: BuyerRow[] }> {
  let orderQuery = supabase
    .from("orders")
    .select("id, status, amount, logistics_cost, cogs_snapshot, utm_source, utm_campaign, form_context, created_at, delivered_date")
    .eq("org_id", orgId)
    .gte("created_at", `${from}T00:00:00Z`)
    .lte("created_at", `${to}T23:59:59Z`);
  if (branchId) orderQuery = orderQuery.eq("branch_id", branchId);

  let spendQuery = supabase
    .from("marketing_spend_records")
    .select("spend_date, marketer_tag, platform, budget_given, actual_spent")
    .eq("org_id", orgId)
    .gte("spend_date", from)
    .lte("spend_date", to);
  if (branchId) spendQuery = spendQuery.eq("branch_id", branchId);

  // The company's own advertising, entered from the Ad Spend page.
  let companySpendQuery = supabase
    .from("expenses")
    .select("date, amount, product_id, description")
    .eq("org_id", orgId)
    .eq("category", "Ad Spend")
    .gte("date", from)
    .lte("date", to);
  if (branchId) companySpendQuery = companySpendQuery.eq("branch_id", branchId);

  const [{ data: orders }, { data: spendRows }, { data: companyRows }] =
    await Promise.all([orderQuery, spendQuery, companySpendQuery]);
  const orderRows = orders ?? [];
  const spend = spendRows ?? [];
  const companySpend = companyRows ?? [];

  // ── Spend, and how much of it we actually believe ──────────────────────────
  let actualTotal = 0;
  let budgetOnlyTotal = 0;
  const spendDays = new Set<string>();
  const spendByBuyer = new Map<string, number>();

  for (const row of spend as any[]) {
    const actual = money(row.actual_spent);
    const budget = money(row.budget_given);
    const amount = actual > 0 ? actual : budget;
    if (actual > 0) actualTotal += actual;
    else if (budget > 0) budgetOnlyTotal += budget;
    if (amount > 0) {
      spendDays.add(String(row.spend_date));
      const key = String(row.marketer_tag ?? "").trim().toLowerCase() || "__unattributed__";
      spendByBuyer.set(key, (spendByBuyer.get(key) ?? 0) + amount);
    }
  }

  // ⚠️ COMPANY ADVERTISING COUNTS AS MONEY ACTUALLY SPENT. It is an expense
  // already paid, not a budget handed to somebody, so it does not weaken the
  // basis the way an unmatched buyer budget does.
  let companyTotal = 0;
  const companyByProduct = new Map<string, number>();
  for (const row of companySpend as any[]) {
    const amount = money(row.amount);
    if (amount <= 0) continue;
    companyTotal += amount;
    spendDays.add(String(row.date));
    const key = String(row.product_id ?? "").trim();
    if (key) companyByProduct.set(key, (companyByProduct.get(key) ?? 0) + amount);
  }
  actualTotal += companyTotal;

  const adSpendTotal = actualTotal + budgetOnlyTotal;
  const spendBasis: SpendBasis =
    adSpendTotal === 0 ? "none"
      : budgetOnlyTotal === 0 ? "actual"
      : actualTotal === 0 ? "budget"
      : "mixed";
  // ⚠️ NULL, NOT ZERO. Nothing downstream may divide by a spend nobody entered.
  const adSpend = spendBasis === "none" ? null : adSpendTotal;

  // ── Orders ────────────────────────────────────────────────────────────────
  let ordersPlaced = 0, confirmed = 0, delivered = 0, lost = 0;
  let deliveredRevenue = 0, productCost = 0, deliveryCost = 0;
  const buyers = new Map<string, BuyerRow>();

  for (const order of orderRows as any[]) {
    const status = String(order.status ?? "");
    const { key, label } = buyerKeyFor(order);
    if (!buyers.has(key)) {
      buyers.set(key, {
        key, label, ordersPlaced: 0, confirmed: 0, delivered: 0, deliveredRevenue: 0,
        adSpend: null, trueNetProfit: null, margin: null, roas: null,
        costPerDeliveredOrder: null, deliveryRate: null
      });
    }
    const buyer = buyers.get(key)!;

    ordersPlaced += 1;
    buyer.ordersPlaced += 1;
    if (CONFIRMED_STATUSES.includes(status)) { confirmed += 1; buyer.confirmed += 1; }
    if (LOST_STATUSES.includes(status)) lost += 1;

    if (status === DELIVERED) {
      delivered += 1;
      buyer.delivered += 1;
      const revenue = money(order.amount);
      deliveredRevenue += revenue;
      buyer.deliveredRevenue += revenue;
      // ⚠️ THE FROZEN COST, NOT TODAY'S. cogs_snapshot is what the order really
      // cost when it shipped; reading live product cost would restate history
      // every time somebody edits a price.
      productCost += money(order.cogs_snapshot);
      deliveryCost += money(order.logistics_cost);
    }
  }

  const buyerRows = [...buyers.values()].map((buyer) => {
    const buyerSpend = spendByBuyer.get(buyer.key) ?? null;
    const spendKnown = buyerSpend !== null && buyerSpend > 0;
    // A buyer's own costs are not split out per order here, so their profit is
    // revenue less their ads only when we know what they spent.
    const profit = spendKnown ? buyer.deliveredRevenue - buyerSpend! : null;
    return {
      ...buyer,
      adSpend: spendKnown ? buyerSpend : null,
      trueNetProfit: profit,
      margin: profit !== null ? ratio(profit, buyer.deliveredRevenue) : null,
      roas: spendKnown ? ratio(buyer.deliveredRevenue, buyerSpend!) : null,
      costPerDeliveredOrder: spendKnown ? ratio(buyerSpend!, buyer.delivered) : null,
      deliveryRate: ratio(buyer.delivered, buyer.ordersPlaced)
    };
  }).sort((a, b) =>
    (b.trueNetProfit ?? Number.NEGATIVE_INFINITY) - (a.trueNetProfit ?? Number.NEGATIVE_INFINITY)
    || b.deliveredRevenue - a.deliveredRevenue);

  const grossAfterCosts = deliveredRevenue - productCost - deliveryCost;
  const trueNetProfit = adSpend === null ? null : grossAfterCosts - adSpend;
  const periodDays = daysBetween(from, to);

  return {
    totals: {
      adSpend,
      spendBasis,
      spendRecords: spend.length + companySpend.length,
      companySpend: companyTotal,
      buyerSpend: adSpendTotal - companyTotal,
      daysWithoutSpend: Math.max(0, periodDays - spendDays.size),
      periodDays,

      ordersPlaced, confirmed, delivered, lost,
      deliveredRevenue, productCost, deliveryCost,
      trueNetProfit,

      confirmationRate: ratio(confirmed, ordersPlaced),
      deliveryRate: ratio(delivered, ordersPlaced),
      costPerOrder: adSpend === null ? null : ratio(adSpend, ordersPlaced),
      costPerDeliveredOrder: adSpend === null ? null : ratio(adSpend, delivered),
      deliveredAov: ratio(deliveredRevenue, delivered),
      placedAov: ratio(deliveredRevenue, ordersPlaced),
      roas: adSpend === null ? null : ratio(deliveredRevenue, adSpend),
      // What one delivered order can cost in ads before the period stops paying.
      breakEvenCostPerDelivered: ratio(grossAfterCosts, delivered)
    },
    buyers: buyerRows
  };
}
