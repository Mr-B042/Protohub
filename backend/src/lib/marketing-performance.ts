/**
 * Marketing Performance Center — ad spend through to real profit.
 *
 * ⚠️ AD SPEND LIVES IN TWO PLACES, AND THE BIG ONE IS `expenses`.
 * marketing_spend_records is the MEDIA BUYER's own book (a budget handed out,
 * then what was spent). Bright has no media buyers today, so it is nearly empty.
 * The company's own advertising is entered from the Ad Spend page and lands in
 * `expenses` under "Ad Spend" - one row per product per day. Reading only the
 * buyer book once made this page report "not recorded" while N3.9m of September
 * spend sat in plain sight. Both are read.
 *
 * ⚠️ NOT RECORDED IS NOT ZERO. Anything that divides by spend returns NULL when
 * spend is unknown, and the screen says so. N0 spent and an infinite return
 * would look authoritative and be false.
 *
 * ⚠️ COMPANY SPEND IS RECORDED PER PRODUCT, NEVER PER PLATFORM OR CAMPAIGN.
 * So it can follow a product filter exactly, but it cannot be split by platform,
 * campaign or buyer. Under those filters, and on each paid platform's row of
 * the leaderboard, the honest answer is "not recorded" - dividing it up by order
 * share would print a precise-looking number nobody measured.
 *
 * ⚠️ BUDGET GIVEN IS NOT MONEY SPENT. A buyer row with no actual_spent falls back
 * to budget_given so the page works, but the basis is reported and flagged.
 */

import { supabase } from "./supabase.js";
import {
  buildProductBonusConfigMap, buildWeeklyBonusContextMap, computeOrderBonus, sundayWeekStartForDateKey,
  weeklyBonusContextForOrder, type PayrollOrder
} from "./payroll-calculator.js";
import {
  SALES_BONUS_LAUNCH_WEEK_START, attributeRuleSettlementToOrders, getSalesBonusProgress
} from "./sales-bonus-engine.js";

const DELIVERED = "Delivered";
const CONFIRMED_STATUSES = ["Confirmed", "In Process", "Dispatched", "Delivered"];
const LOST_STATUSES = ["Cancelled", "Failed"];

/**
 * Platforms nobody pays to advertise on. Their ad spend is a KNOWN zero rather
 * than an unknown, so their profit can be stated in full.
 */
const ORGANIC_SOURCES = new Set(["website", "direct", "whatsapp", "organic", "referral"]);

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook Ads",
  fb: "Facebook Ads",
  "fb-sitelink": "Facebook Ads",
  instagram: "Instagram Ads",
  ig: "Instagram Ads",
  tiktok: "TikTok Ads",
  google: "Google Ads",
  "audience network": "Audience Network",
  an: "Audience Network",
  threads: "Threads",
  th: "Threads",
  website: "Website Organic",
  direct: "Direct",
  whatsapp: "WhatsApp"
};

export type PerformanceFilters = {
  productId?: string | null;
  campaign?: string | null;
  source?: string | null;
  mediaBuyer?: string | null;
};

export type SpendBasis = "actual" | "budget" | "mixed" | "none";

export type PerformanceTotals = {
  adSpend: number | null;
  spendBasis: SpendBasis;
  spendRecords: number;
  companySpend: number;
  buyerSpend: number;
  /** True when a filter asks for a split the spend was never recorded at. */
  spendNotSplittable: boolean;
  daysWithoutSpend: number;
  periodDays: number;

  leads: number | null;
  ordersPlaced: number;
  placedValue: number;
  confirmed: number;
  delivered: number;
  confirmedPending: number;
  awaitingConfirmation: number;
  lost: number;
  deliveredRevenue: number;
  productCost: number;
  deliveryCost: number;
  trueNetProfit: number | null;
  profitMargin: number | null;

  costPerLead: number | null;
  costPerOrder: number | null;
  costPerConfirmed: number | null;
  costPerDeliveredOrder: number | null;
  placedAov: number | null;
  deliveredAov: number | null;
  roas: number | null;
  breakEvenCostPerDelivered: number | null;
  /** How far under break-even the current cost per delivered order sits. */
  breakEvenHeadroom: number | null;
  /** Logistics paid per successful delivery. Known without any ad spend. */
  avgDeliveryCost: number | null;
  /**
   * What it costs to put one delivered order in a customer's hands: the ads
   * that won it plus the delivery that carried it. CPDO alone is ads only, so
   * it understated this by the whole delivery fee.
   */
  totalCostToDeliver: number | null;
  /**
   * The break-even that Total Cost to Deliver should be read against.
   *
   * ⚠️ NOT breakEvenCostPerDelivered. That one already has delivery taken out -
   * it is the most the ADS can cost. Setting ads-plus-delivery beside it counts
   * delivery twice and shows less room than there really is. This is revenue
   * less product cost per delivered order: the most ads and delivery together
   * can cost. The gap to it is the same naira either way.
   */
  breakEvenTotalCostToDeliver: number | null;
  /** Delivered orders whose delivery fee was never entered. */
  deliveredWithoutFee: number;
  /** Delivery fees paid on orders that FAILED - money spent, nothing sold. */
  failedDeliveryCost: number;
  /**
   * Average profit per delivered order (APDO) - contribution profit, BEFORE
   * salaries, rent and running costs. Revenue less product cost (free gifts
   * included), ads, delivery and failed-delivery fees, per delivered order.
   * Null when the ads are unknown, for the same reason every other figure
   * that needs them is.
   */
  profitPerDeliveredOrder: number | null;
  /** Rep bonuses earned on these delivered orders - both bonus systems. */
  repBonuses: number;
  /**
   * Running costs dated in the period: salaries, waybill, airtime, other - every
   * expense except ads, delivery and failed delivery, which are already in
   * contribution. Under a filter, this selection's share only (see overheadShared).
   */
  overheadByCategory: Array<{ category: string; amount: number }>;
  overheadCost: number;
  /** True when running costs were split by share of delivered revenue. */
  overheadShared: boolean;
  /** True when the bonus rules could not be worked out; net is then unknown. */
  bonusesUnavailable: boolean;
  /** Contribution profit less rep bonuses and running costs. */
  netProfit: number | null;
  /** Average net profit per delivered order - after salaries and running costs. */
  netProfitPerDeliveredOrder: number | null;

  /** Placed as a share of leads - the funnel's first conversion. */
  leadToOrderRate: number | null;
  confirmationRate: number | null;
  /** Delivered as a share of CONFIRMED, as the design's top card reads it. */
  deliveryRateOfConfirmed: number | null;
  /**
   * DELIVERY RATE: delivered as a share of orders PLACED in the period - the
   * Orders page's "X delivered of Y", not a new kind of rate. Orders here are
   * counted by the day they were placed, so a recent period reads low until its
   * orders finish; `inProgress` says how many still could.
   */
  deliveryRate: number | null;
  inProgress: number;
};

export type LeaderboardStatus = "profitable" | "losing" | "high_value" | "check_tag" | "spend_unknown";

export type LeaderboardRow = {
  key: string;
  label: string;
  kind: "paid" | "organic" | "unattributed";
  campaigns: number;
  products: number;
  ordersPlaced: number;
  confirmed: number;
  confirmationRate: number | null;
  delivered: number;
  /** Delivered as a share of orders PLACED, as the design's table reads it. */
  deliveryRate: number | null;
  adSpend: number | null;
  costPerDeliveredOrder: number | null;
  deliveredAov: number | null;
  deliveredRevenue: number;
  netProfit: number | null;
  margin: number | null;
  roas: number | null;
  status: LeaderboardStatus;
};

export type FilterOptions = {
  products: Array<{ id: string; name: string }>;
  campaigns: string[];
  sources: string[];
  mediaBuyers: string[];
};

export type PerformanceDeltas = {
  adSpend: number | null;
  ordersPlaced: number | null;
  deliveredRevenue: number | null;
  costPerOrder: number | null;
  costPerDeliveredOrder: number | null;
  placedAov: number | null;
  deliveredAov: number | null;
  roas: number | null;
  avgDeliveryCost: number | null;
  totalCostToDeliver: number | null;
  profitPerDeliveredOrder: number | null;
  netProfitPerDeliveredOrder: number | null;
  /** Percentage POINTS, not a percent of a percent: 55% -> 60% is +0.05. */
  deliveryRate: number | null;
};

const ratio = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null);
const money = (value: unknown) => Number(value ?? 0) || 0;
const clean = (value: unknown) => String(value ?? "").trim();

const sourceKeyOf = (order: any) => {
  const source = clean(order.source) || clean(order.utm_source);
  return source.toLowerCase();
};
const platformLabel = (key: string) =>
  PLATFORM_LABELS[key] ?? (key ? key.replace(/\b\w/g, (c) => c.toUpperCase()) : "Unattributed");
const mediaBuyerOf = (order: any) => clean(order.form_context?.media_buyer ?? order.form_context?.mediaBuyer);

// Lagos is UTC+1 year-round. A day belongs to Lagos, not to the server's clock.
const lagosStart = (day: string) => `${day}T00:00:00+01:00`;
const lagosEnd = (day: string) => `${day}T23:59:59.999+01:00`;

const daysBetween = (from: string, to: string) => {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86_400_000) + 1;
};

/** The same number of days immediately before `from`. */
export const previousPeriod = (from: string, to: string) => {
  const days = daysBetween(from, to);
  const start = new Date(Date.parse(`${from}T00:00:00Z`) - days * 86_400_000);
  const end = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000);
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
};

type PeriodData = {
  orders: any[];
  companySpend: any[];
  buyerSpend: any[];
  carts: any[];
  /** Failed-delivery fees in the period, each joined to the order it was for. */
  failedDeliveries: Array<{ amount: number; order: any | null }>;
  /** Every other expense in the period - the running costs. */
  overhead: Array<{ category: string; amount: number }>;
  /** Every order in the Sunday weeks the period touches - see fetchPeriod. */
  weekOrders: PayrollOrder[];
  /** Rep bonus per order id, filled in by the loader. */
  bonusByOrderId: Map<string, number>;
  bonusesUnavailable?: boolean;
};

/** Expenses already inside contribution, so never counted as running costs. */
const CONTRIBUTION_CATEGORIES = ["Ad Spend", "Delivery", "Failed Delivery"];

const BONUS_ORDER_COLUMNS =
  "id, assigned_rep_id, status, amount, product_id, quantity, source, upsell_from_qty, upsell_to_qty, "
  + "manual_bonus_override, bonus_manually_adjusted, cross_sell_lines, free_gift_lines, delivered_date, created_at, date";

const addDays = (dateKey: string, days: number) =>
  new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * ⚠️ "Delivery" EXPENSES ARE NOT READ, ON PURPOSE. Each one is the same money
 * as the fee on a delivered order - "Delivery cost for 1188 - FRANCIS
 * BAMIDELE" - so reading them as well would count every delivery twice. Only
 * "Failed Delivery" is separate money: a fee paid on an order that never sold.
 * Its id carries the order (EXP-DEL-4002 -> order 4002), which is what lets it
 * follow the page's filters like any other order cost.
 */
const FAILED_DELIVERY_ORDER = /^EXP-DEL-(.+)$/;

async function fetchPeriod(orgId: string, branchId: string | null, from: string, to: string): Promise<PeriodData> {
  let orders = supabase
    .from("orders")
    .select("id, status, amount, logistics_cost, cogs_snapshot, utm_source, utm_campaign, source, form_context, product_id, product_name")
    .eq("org_id", orgId)
    .gte("created_at", lagosStart(from))
    .lte("created_at", lagosEnd(to));
  let company = supabase
    .from("expenses")
    .select("date, amount, product_id")
    .eq("org_id", orgId)
    .eq("category", "Ad Spend")
    .gte("date", from)
    .lte("date", to);
  let buyer = supabase
    .from("marketing_spend_records")
    .select("spend_date, marketer_tag, platform, campaign, product_id, budget_given, actual_spent")
    .eq("org_id", orgId)
    .gte("spend_date", from)
    .lte("spend_date", to);
  let carts = supabase
    .from("abandoned_carts")
    .select("id, product_id")
    .eq("org_id", orgId)
    .is("merged_into", null)
    .gte("created_at", lagosStart(from))
    .lte("created_at", lagosEnd(to));
  if (branchId) {
    orders = orders.eq("branch_id", branchId);
    company = company.eq("branch_id", branchId);
    buyer = buyer.eq("branch_id", branchId);
    carts = carts.eq("branch_id", branchId);
  }
  let failed = supabase
    .from("expenses")
    .select("id, amount, product_id")
    .eq("org_id", orgId)
    .eq("category", "Failed Delivery")
    .gte("date", from)
    .lte("date", to);
  if (branchId) failed = failed.eq("branch_id", branchId);

  // Running costs. A null category is still money spent, so it is kept -
  // `not.in` alone would silently drop it.
  let overhead = supabase
    .from("expenses")
    .select("category, amount")
    .eq("org_id", orgId)
    .or(`category.is.null,category.not.in.(${CONTRIBUTION_CATEGORIES.map((c) => `"${c}"`).join(",")})`)
    .gte("date", from)
    .lte("date", to);
  if (branchId) overhead = overhead.eq("branch_id", branchId);

  // ⚠️ WHOLE WEEKS, NOT THE PERIOD. The per-product bonus depends on the rep's
  // delivery rate for the Sunday week the order was placed in - the same rule
  // payroll pays on. An order placed on the 1st shares its week with orders
  // from the month before, so the period's orders alone would give the wrong
  // rate and the wrong bonus. A day either side covers the Lagos/UTC shift.
  const weekFrom = sundayWeekStartForDateKey(addDays(from, -1));
  const weekTo = addDays(sundayWeekStartForDateKey(addDays(to, 1)), 7);
  let weekOrders = supabase
    .from("orders")
    .select(BONUS_ORDER_COLUMNS)
    .eq("org_id", orgId)
    .gte("created_at", `${weekFrom}T00:00:00.000Z`)
    .lt("created_at", `${weekTo}T00:00:00.000Z`);
  if (branchId) weekOrders = weekOrders.eq("branch_id", branchId);

  const [o, c, b, k, f, h, w] = await Promise.all([orders, company, buyer, carts, failed, overhead, weekOrders]);
  for (const result of [o, c, b, k, f, h, w]) if (result.error) throw new Error(result.error.message);

  // The failed order may have been placed before the period began, so it is
  // looked up by id rather than found among this period's orders.
  const failedRows = (f.data ?? []) as any[];
  const orderIds = [...new Set(failedRows
    .map((row) => FAILED_DELIVERY_ORDER.exec(String(row.id))?.[1])
    .filter((id): id is string => Boolean(id)))];
  const failedOrders = new Map<string, any>();
  if (orderIds.length > 0) {
    const { data } = await supabase
      .from("orders")
      .select("id, product_id, source, utm_source, utm_campaign, form_context")
      .eq("org_id", orgId)
      .in("id", orderIds);
    for (const row of data ?? []) failedOrders.set(String((row as any).id), row);
  }

  return {
    orders: o.data ?? [],
    companySpend: c.data ?? [],
    buyerSpend: b.data ?? [],
    carts: k.data ?? [],
    failedDeliveries: failedRows.map((row) => {
      const orderId = FAILED_DELIVERY_ORDER.exec(String(row.id))?.[1];
      const order = orderId ? failedOrders.get(orderId) ?? null : null;
      // An order that has since been deleted still cost the fee; keep the
      // product the expense itself recorded so a product filter still finds it.
      return { amount: money(row.amount), order: order ?? { product_id: row.product_id } };
    }),
    overhead: ((h.data ?? []) as any[]).map((row) => ({
      category: String(row.category ?? "").trim() || "Uncategorised",
      amount: money(row.amount)
    })),
    weekOrders: (w.data ?? []) as unknown as PayrollOrder[],
    bonusByOrderId: new Map()
  };
}

const matchesFilters = (order: any, f: PerformanceFilters) =>
  (!f.productId || order.product_id === f.productId)
  && (!f.campaign || clean(order.utm_campaign) === f.campaign)
  && (!f.source || sourceKeyOf(order) === f.source.toLowerCase())
  && (!f.mediaBuyer || mediaBuyerOf(order).toLowerCase() === f.mediaBuyer.toLowerCase());

function computeTotals(data: PeriodData, from: string, to: string, f: PerformanceFilters): PerformanceTotals {
  const orders = data.orders.filter((order) => matchesFilters(order, f));
  const splitFilter = Boolean(f.campaign || f.source || f.mediaBuyer);
  const organicSourceFilter = Boolean(f.source && ORGANIC_SOURCES.has(f.source.toLowerCase()));

  // ── Spend ─────────────────────────────────────────────────────────────────
  const spendDays = new Set<string>();
  let companyTotal = 0;
  for (const row of data.companySpend) {
    if (f.productId && row.product_id !== f.productId) continue;
    const amount = money(row.amount);
    if (amount <= 0) continue;
    companyTotal += amount;
    spendDays.add(String(row.date));
  }

  let buyerActual = 0;
  let buyerBudgetOnly = 0;
  let buyerRows = 0;
  for (const row of data.buyerSpend) {
    if (f.productId && row.product_id && row.product_id !== f.productId) continue;
    if (f.campaign && clean(row.campaign) !== f.campaign) continue;
    if (f.mediaBuyer && clean(row.marketer_tag).toLowerCase() !== f.mediaBuyer.toLowerCase()) continue;
    if (f.source && clean(row.platform).toLowerCase() !== f.source.toLowerCase()) continue;
    const actual = money(row.actual_spent);
    const budget = money(row.budget_given);
    if (actual > 0) buyerActual += actual;
    else if (budget > 0) buyerBudgetOnly += budget;
    else continue;
    buyerRows += 1;
    spendDays.add(String(row.spend_date));
  }

  // Company spend cannot be split by platform, campaign or buyer, so under one
  // of those filters its share is unknown - unless the filter is an organic
  // source, whose ad spend is genuinely nothing.
  const spendNotSplittable = splitFilter && !organicSourceFilter && companyTotal > 0;
  const usableCompany = splitFilter ? 0 : companyTotal;
  const buyerSpendTotal = buyerActual + buyerBudgetOnly;
  const knownTotal = usableCompany + buyerSpendTotal;

  let adSpend: number | null;
  let spendBasis: SpendBasis;
  if (organicSourceFilter) {
    adSpend = 0;
    spendBasis = "actual";
  } else if (spendNotSplittable || knownTotal <= 0) {
    adSpend = null;
    spendBasis = "none";
  } else {
    adSpend = knownTotal;
    const actualPart = usableCompany + buyerActual;
    spendBasis = buyerBudgetOnly === 0 ? "actual" : actualPart === 0 ? "budget" : "mixed";
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  let confirmed = 0, delivered = 0, lost = 0, deliveredWithoutFee = 0;
  let placedValue = 0, deliveredRevenue = 0, productCost = 0, deliveryCost = 0;
  for (const order of orders) {
    const status = String(order.status ?? "");
    placedValue += money(order.amount);
    if (CONFIRMED_STATUSES.includes(status)) confirmed += 1;
    if (LOST_STATUSES.includes(status)) lost += 1;
    if (status === DELIVERED) {
      delivered += 1;
      deliveredRevenue += money(order.amount);
      // ⚠️ THE FROZEN COST. cogs_snapshot is what the order cost when it
      // shipped; live product cost would restate history on every price edit.
      productCost += money(order.cogs_snapshot);
      deliveryCost += money(order.logistics_cost);
      if (money(order.logistics_cost) <= 0) deliveredWithoutFee += 1;
    }
  }
  const ordersPlaced = orders.length;

  // ── Net: rep bonuses and running costs ────────────────────────────────────
  let repBonuses = 0;
  for (const order of orders) {
    if (String(order.status ?? "") === DELIVERED) repBonuses += data.bonusByOrderId.get(String(order.id)) ?? 0;
  }
  // ⚠️ RUNNING COSTS BELONG TO THE WHOLE BUSINESS. Salaries and rent are not
  // spent per product or per campaign, so a filtered view carries its share by
  // delivered revenue - the same split the rep leaderboard's Net Profit uses.
  const overheadShared = Boolean(f.productId || f.campaign || f.source || f.mediaBuyer);
  const allDeliveredRevenue = data.orders
    .filter((order) => String(order.status ?? "") === DELIVERED)
    .reduce((sum, order) => sum + money(order.amount), 0);
  const overheadShare = !overheadShared ? 1 : allDeliveredRevenue > 0 ? deliveredRevenue / allDeliveredRevenue : 0;
  const byCategory = new Map<string, number>();
  for (const row of data.overhead) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.amount);
  const overheadByCategory = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount: amount * overheadShare }))
    .filter((row) => row.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  const overheadCost = overheadByCategory.reduce((sum, row) => sum + row.amount, 0);

  const confirmedPending = Math.max(0, confirmed - delivered);
  const awaitingConfirmation = Math.max(0, ordersPlaced - confirmed - lost);

  // ── Leads: checkouts started ──────────────────────────────────────────────
  // A cart knows its product, so leads follow a product filter. It does not
  // reliably carry a campaign, platform or buyer, so under those filters the
  // count is unknown rather than wrong.
  const leads = splitFilter
    ? null
    : data.carts.filter((cart) => !f.productId || cart.product_id === f.productId).length;

  // Failed-delivery fees under the same filters as the orders.
  const failedDeliveryCost = data.failedDeliveries
    .filter((row) => row.order && matchesFilters(row.order, f))
    .reduce((sum, row) => sum + row.amount, 0);

  // ⚠️ FAILED DELIVERIES ARE A COST OF THE DELIVERED ONES. Every figure built on
  // this - true profit, both break-evens, profit per delivered order - takes
  // them out, so the cards cannot disagree with each other.
  const grossAfterCosts = deliveredRevenue - productCost - deliveryCost - failedDeliveryCost;
  const trueNetProfit = adSpend === null ? null : grossAfterCosts - adSpend;
  // Unknown bonuses make net unknown - a guess here would read as a real figure.
  const netProfit = trueNetProfit === null || data.bonusesUnavailable ? null : trueNetProfit - repBonuses - overheadCost;
  const costPerDeliveredOrder = adSpend === null ? null : ratio(adSpend, delivered);
  const breakEvenCostPerDelivered = ratio(grossAfterCosts, delivered);
  const avgDeliveryCost = ratio(deliveryCost, delivered);
  // ⚠️ NULL WHEN THE ADS ARE UNKNOWN, not "delivery cost alone". Showing just
  // the delivery half under this name would read as the full cost and look
  // far cheaper than it is.
  const totalCostToDeliver =
    costPerDeliveredOrder === null || avgDeliveryCost === null ? null : costPerDeliveredOrder + avgDeliveryCost;
  const periodDays = daysBetween(from, to);

  return {
    adSpend,
    spendBasis,
    spendRecords: data.companySpend.length + buyerRows,
    companySpend: usableCompany,
    buyerSpend: buyerSpendTotal,
    spendNotSplittable,
    daysWithoutSpend: Math.max(0, periodDays - spendDays.size),
    periodDays,

    leads,
    ordersPlaced,
    placedValue,
    confirmed,
    delivered,
    confirmedPending,
    awaitingConfirmation,
    lost,
    deliveredRevenue,
    productCost,
    deliveryCost,
    trueNetProfit,
    profitMargin: trueNetProfit === null ? null : ratio(trueNetProfit, deliveredRevenue),

    costPerLead: adSpend === null || leads === null ? null : ratio(adSpend, leads),
    costPerOrder: adSpend === null ? null : ratio(adSpend, ordersPlaced),
    costPerConfirmed: adSpend === null ? null : ratio(adSpend, confirmed),
    costPerDeliveredOrder,
    placedAov: ratio(placedValue, ordersPlaced),
    deliveredAov: ratio(deliveredRevenue, delivered),
    roas: adSpend === null || adSpend === 0 ? null : ratio(deliveredRevenue, adSpend),
    breakEvenCostPerDelivered,
    breakEvenHeadroom:
      costPerDeliveredOrder !== null && breakEvenCostPerDelivered !== null && breakEvenCostPerDelivered > 0
        ? (breakEvenCostPerDelivered - costPerDeliveredOrder) / breakEvenCostPerDelivered
        : null,

    avgDeliveryCost,
    totalCostToDeliver,
    // Its own break-even: everything but the ads and the successful delivery
    // fee, so the room it shows matches Break-even CPDO to the naira.
    breakEvenTotalCostToDeliver: ratio(deliveredRevenue - productCost - failedDeliveryCost, delivered),
    deliveredWithoutFee,
    failedDeliveryCost,
    profitPerDeliveredOrder: trueNetProfit === null ? null : ratio(trueNetProfit, delivered),
    repBonuses,
    overheadByCategory,
    overheadCost,
    overheadShared,
    bonusesUnavailable: data.bonusesUnavailable === true,
    netProfit,
    netProfitPerDeliveredOrder: netProfit === null ? null : ratio(netProfit, delivered),

    leadToOrderRate: leads === null ? null : ratio(ordersPlaced, leads),
    confirmationRate: ratio(confirmed, ordersPlaced),
    deliveryRateOfConfirmed: ratio(delivered, confirmed),
    deliveryRate: ratio(delivered, ordersPlaced),
    inProgress: confirmedPending + awaitingConfirmation
  };
}

function computeLeaderboard(data: PeriodData, f: PerformanceFilters): LeaderboardRow[] {
  const orders = data.orders.filter((order) => matchesFilters(order, f));
  const companySpendInPeriod = data.companySpend.some((row) => money(row.amount) > 0);

  const buyerSpendByPlatform = new Map<string, number>();
  for (const row of data.buyerSpend) {
    const amount = money(row.actual_spent) || money(row.budget_given);
    if (amount <= 0) continue;
    const key = clean(row.platform).toLowerCase();
    buyerSpendByPlatform.set(key, (buyerSpendByPlatform.get(key) ?? 0) + amount);
  }

  type Acc = {
    key: string; campaigns: Set<string>; products: Set<string>;
    placed: number; confirmed: number; delivered: number;
    revenue: number; productCost: number; deliveryCost: number;
  };
  const groups = new Map<string, Acc>();
  for (const order of orders) {
    const key = sourceKeyOf(order);
    if (!groups.has(key)) {
      groups.set(key, {
        key, campaigns: new Set(), products: new Set(),
        placed: 0, confirmed: 0, delivered: 0, revenue: 0, productCost: 0, deliveryCost: 0
      });
    }
    const g = groups.get(key)!;
    const status = String(order.status ?? "");
    g.placed += 1;
    if (clean(order.utm_campaign)) g.campaigns.add(clean(order.utm_campaign));
    if (order.product_id) g.products.add(order.product_id);
    if (CONFIRMED_STATUSES.includes(status)) g.confirmed += 1;
    if (status === DELIVERED) {
      g.delivered += 1;
      g.revenue += money(order.amount);
      g.productCost += money(order.cogs_snapshot);
      g.deliveryCost += money(order.logistics_cost);
    }
  }

  const rows: LeaderboardRow[] = [...groups.values()].map((g) => {
    const kind: LeaderboardRow["kind"] = !g.key ? "unattributed" : ORGANIC_SOURCES.has(g.key) ? "organic" : "paid";

    // Organic spend is a known zero. A paid platform's spend is only known when
    // it was recorded against that platform AND no unsplit company spend exists
    // for the period - otherwise part of the company's money is theirs and
    // nobody wrote down how much.
    let adSpend: number | null = null;
    if (kind === "organic") adSpend = 0;
    else if (kind === "paid" && !companySpendInPeriod) {
      const recorded = buyerSpendByPlatform.get(g.key) ?? buyerSpendByPlatform.get(platformLabel(g.key).toLowerCase());
      adSpend = recorded && recorded > 0 ? recorded : null;
    }

    const failedHere = data.failedDeliveries
      .filter((row) => row.order && matchesFilters(row.order, f) && sourceKeyOf(row.order) === g.key)
      .reduce((sum, row) => sum + row.amount, 0);
    const netProfit = adSpend === null ? null : g.revenue - g.productCost - g.deliveryCost - failedHere - adSpend;
    const status: LeaderboardStatus =
      kind === "unattributed" ? "check_tag"
        : kind === "organic" ? "high_value"
        : adSpend === null ? "spend_unknown"
        : (netProfit ?? 0) > 0 ? "profitable" : "losing";

    return {
      key: g.key || "__unattributed__",
      label: platformLabel(g.key),
      kind,
      campaigns: g.campaigns.size,
      products: g.products.size,
      ordersPlaced: g.placed,
      confirmed: g.confirmed,
      confirmationRate: ratio(g.confirmed, g.placed),
      delivered: g.delivered,
      deliveryRate: ratio(g.delivered, g.placed),
      adSpend,
      costPerDeliveredOrder: adSpend === null ? null : adSpend === 0 ? 0 : ratio(adSpend, g.delivered),
      deliveredAov: ratio(g.revenue, g.delivered),
      deliveredRevenue: g.revenue,
      netProfit,
      margin: netProfit === null ? null : ratio(netProfit, g.revenue),
      roas: adSpend ? ratio(g.revenue, adSpend) : null,
      status
    };
  });

  // Ranked by delivered revenue: it is known for every row, whereas profit is
  // known only where ad spend is. Unattributed always sits last - it is a row
  // to fix, not a row to rank.
  return rows.sort((a, b) =>
    (a.kind === "unattributed" ? 1 : 0) - (b.kind === "unattributed" ? 1 : 0)
    || b.deliveredRevenue - a.deliveredRevenue);
}

function filterOptions(data: PeriodData): FilterOptions {
  const products = new Map<string, string>();
  const campaigns = new Set<string>();
  const sources = new Set<string>();
  const buyers = new Set<string>();
  for (const order of data.orders) {
    if (order.product_id) products.set(order.product_id, clean(order.product_name) || "Unnamed product");
    if (clean(order.utm_campaign)) campaigns.add(clean(order.utm_campaign));
    const source = clean(order.source) || clean(order.utm_source);
    if (source) sources.add(source);
    const buyer = mediaBuyerOf(order);
    if (buyer) buyers.add(buyer);
  }
  return {
    products: [...products.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    campaigns: [...campaigns].sort(),
    sources: [...sources].sort(),
    mediaBuyers: [...buyers].sort()
  };
}

const change = (now: number | null, before: number | null) =>
  now === null || before === null || before === 0 ? null : (now - before) / Math.abs(before);

/**
 * The bonus rules for one Sunday week, kept for a few minutes.
 *
 * ⚠️ WHY A CACHE. Working out a week's rules takes about 1.5s, and this page
 * asks again on every filter and date change - while the answer depends on
 * neither. Five minutes keeps a fresh delivery from waiting long to show. The
 * promise itself is kept, so two requests at once share one calculation.
 */
const RULE_WEEK_TTL_MS = 5 * 60_000;
const ruleWeekCache = new Map<string, { at: number; progress: ReturnType<typeof getSalesBonusProgress> }>();

function ruleWeekProgress(orgId: string, weekStart: string) {
  const key = `${orgId}:${weekStart}`;
  const now = Date.now();
  const hit = ruleWeekCache.get(key);
  if (hit && now - hit.at < RULE_WEEK_TTL_MS) return hit.progress;
  for (const [cachedKey, entry] of ruleWeekCache) {
    if (now - entry.at >= RULE_WEEK_TTL_MS) ruleWeekCache.delete(cachedKey);
  }
  const progress = getSalesBonusProgress(orgId, weekStart);
  progress.catch(() => ruleWeekCache.delete(key));
  ruleWeekCache.set(key, { at: now, progress });
  return progress;
}

type RuleWeeks = Awaited<ReturnType<typeof getSalesBonusProgress>>[];

/**
 * The bonus rules for every Sunday week the periods touch, worked out from the
 * dates alone - so it runs while the orders are still being fetched rather than
 * after. Order dates are UTC days and a Lagos day starts at 23:00 UTC the day
 * before, hence the day's margin at the start.
 */
async function ruleWeeksFor(orgId: string, periods: Array<{ from: string; to: string }>): Promise<RuleWeeks> {
  const weeks = new Set<string>();
  for (const period of periods) {
    const last = sundayWeekStartForDateKey(period.to);
    for (let week = sundayWeekStartForDateKey(addDays(period.from, -1)); week <= last; week = addDays(week, 7)) {
      if (week >= SALES_BONUS_LAUNCH_WEEK_START) weeks.add(week);
    }
  }
  const list = [...weeks];
  const progresses: RuleWeeks = [];
  // Four at a time: quick enough, without a burst of queries at the database.
  for (let i = 0; i < list.length; i += 4) {
    progresses.push(...await Promise.all(list.slice(i, i + 4).map((week) => ruleWeekProgress(orgId, week))));
  }
  return progresses;
}

/**
 * Rep bonus per delivered order, from BOTH bonus systems - what the Dashboard's
 * net profit takes out:
 *   - the per-product bonus (products.bonus_config), on the rep's week, exactly
 *     as payroll pays it;
 *   - the newer bonus rules, attributed to the orders that earned them, by the
 *     same split as perOrderBonusMapForDeliveredRange.
 *
 * ⚠️ ONLY THE WEEKS THIS PAGE'S ORDERS WERE PLACED IN. A rule's bonus belongs
 * to the week the order was placed, so those weeks are all that is needed.
 * Asking by delivery date instead meant every week since July - 87 seconds for
 * one month on the first try.
 *
 * ⚠️ THE MANAGER'S WEEKLY BONUS IS NOT HERE. It is decided per week on the whole
 * company's profit and delivery rate by delivery date, which this page, counting
 * orders by the day they were placed, does not have. The card says so.
 */
async function attachRepBonuses(orgId: string, periods: PeriodData[], ruleWeeks: RuleWeeks | null) {
  const { data: products, error } = await supabase.from("products").select("id, bonus_config").eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const productMap = buildProductBonusConfigMap((products ?? []) as any[]);

  // Delivered orders placed in either period - the only ones a bonus is kept for.
  const amountById = new Map<string, number>();
  for (const period of periods) {
    const inPeriod = new Set(period.orders.map((order) => String(order.id)));
    for (const order of period.weekOrders) {
      if (order.status !== DELIVERED || !inPeriod.has(String(order.id))) continue;
      amountById.set(String(order.id), Math.max(0, Number(order.amount ?? 0) || 0));
    }
  }

  const ruleBonuses: Map<string, number> | null = ruleWeeks ? new Map() : null;
  if (ruleBonuses && ruleWeeks) {
    for (const progress of ruleWeeks) {
      for (const rep of progress.reps) {
        for (const rule of rep.rules) {
          for (const [orderId, settlement] of attributeRuleSettlementToOrders(rule, amountById)) {
            if (!amountById.has(orderId)) continue;
            ruleBonuses.set(orderId, (ruleBonuses.get(orderId) ?? 0) + settlement.payable);
          }
        }
      }
    }
  }

  for (const period of periods) {
    if (ruleBonuses === null) period.bonusesUnavailable = true;
    const contexts = buildWeeklyBonusContextMap(period.weekOrders);
    for (const order of period.weekOrders) {
      if (order.status !== DELIVERED) continue;
      const week = weeklyBonusContextForOrder(order, contexts);
      const bonus = computeOrderBonus(order, productMap, week.rate, week.aov, week.count)
        + (ruleBonuses?.get(String(order.id)) ?? 0);
      if (bonus) period.bonusByOrderId.set(String(order.id), bonus);
    }
  }
}

/** Today's date in Lagos (UTC+1, no daylight saving). */
export const lagosToday = () => new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);

export async function loadMarketingPerformance(
  orgId: string,
  branchId: string | null,
  from: string,
  requestedTo: string,
  filters: PerformanceFilters = {}
) {
  // ⚠️ COUNT TO TODAY, NOT TO THE END OF THE WINDOW. The shared date presets
  // return whole periods - "This Month" is the 1st to the 30th, days that have
  // not happened yet included. That is right for listing orders and wrong here:
  // 28 real days would be compared with 30 full ones, every "vs previous
  // period" would read as a fall, and the empty future days would count as
  // days with no ad spend. So the period stops at today, and the comparison is
  // the same number of days just before it.
  const today = lagosToday();
  const to = requestedTo > today && from <= today ? today : requestedTo;
  const prev = previousPeriod(from, to);
  const [current, before, ruleWeeks] = await Promise.all([
    fetchPeriod(orgId, branchId, from, to),
    fetchPeriod(orgId, branchId, prev.from, prev.to),
    // A failure here blanks net profit only, never the whole page.
    ruleWeeksFor(orgId, [{ from, to }, prev]).catch(() => null)
  ]);

  await attachRepBonuses(orgId, [current, before], ruleWeeks);

  const totals = computeTotals(current, from, to, filters);
  const previous = computeTotals(before, prev.from, prev.to, filters);

  const deltas: PerformanceDeltas = {
    adSpend: change(totals.adSpend, previous.adSpend),
    ordersPlaced: change(totals.ordersPlaced, previous.ordersPlaced),
    deliveredRevenue: change(totals.deliveredRevenue, previous.deliveredRevenue),
    costPerOrder: change(totals.costPerOrder, previous.costPerOrder),
    costPerDeliveredOrder: change(totals.costPerDeliveredOrder, previous.costPerDeliveredOrder),
    placedAov: change(totals.placedAov, previous.placedAov),
    deliveredAov: change(totals.deliveredAov, previous.deliveredAov),
    roas: change(totals.roas, previous.roas),
    avgDeliveryCost: change(totals.avgDeliveryCost, previous.avgDeliveryCost),
    totalCostToDeliver: change(totals.totalCostToDeliver, previous.totalCostToDeliver),
    profitPerDeliveredOrder: change(totals.profitPerDeliveredOrder, previous.profitPerDeliveredOrder),
    netProfitPerDeliveredOrder: change(totals.netProfitPerDeliveredOrder, previous.netProfitPerDeliveredOrder),
    deliveryRate: totals.deliveryRate === null || previous.deliveryRate === null
      ? null
      : totals.deliveryRate - previous.deliveryRate
  };

  return {
    countedTo: to,
    previousFrom: prev.from,
    previousTo: prev.to,
    totals,
    deltas,
    leaderboard: computeLeaderboard(current, filters),
    options: filterOptions(current)
  };
}


/**
 * Orders placed per Lagos day, under the same filters as the page.
 *
 * Feeds the counts on the period shortcuts. The server returns plain days and
 * the screen adds them up per shortcut, so what "This Week" or "Last Month"
 * means is defined in ONE place - the shared date presets - and cannot drift
 * between the count on the button and the period the button opens.
 */
export async function loadDailyOrderCounts(
  orgId: string,
  branchId: string | null,
  from: string,
  to: string,
  filters: PerformanceFilters = {}
): Promise<Record<string, number>> {
  let query = supabase
    .from("orders")
    .select("created_at, product_id, source, utm_source, utm_campaign, media_buyer:form_context->>media_buyer")
    .eq("org_id", orgId)
    .gte("created_at", lagosStart(from))
    .lte("created_at", lagosEnd(to));
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const days: Record<string, number> = {};
  for (const row of (data ?? []) as any[]) {
    const order = { ...row, form_context: { media_buyer: row.media_buyer } };
    if (!matchesFilters(order, filters)) continue;
    const day = new Date(Date.parse(row.created_at) + 60 * 60 * 1000).toISOString().slice(0, 10);
    days[day] = (days[day] ?? 0) + 1;
  }
  return days;
}
