// POD batch unit-economics — a PURE, configurable, N-tier calculation engine.
//
// A batch's economics use manual cost assumptions (ad_spend total, product cost per
// set, delivery cost per order) and a CONFIGURABLE set of cost tiers. Each order's
// status maps to a tier; each tier declares its own cost rules (earns revenue? charge
// ad / product / delivery?). The engine just sums per the tier flags, so adding a
// 4th/5th tier (e.g. "Returned — restocked": no revenue, no product, charge delivery)
// needs NO code change here.
//
// Worst-case (HEADLINE): every non-delivered order is treated as failed in its tier —
// the honest floor. Best-case (ceiling): orders whose status is "open" (could still
// deliver) are re-tiered to the revenue-earning tier. Revenue is recognised ONLY on
// tiers that earn it. Ad spend is a batch-level sunk cost across ALL orders.
//
// Everything is zero-safe (no divide-by-zero). Money is NGN, whole naira at display time.

export interface CostTier {
  tierKey: string;
  label: string;
  earnsRevenue: boolean;
  chargeAd: boolean;        // informational; ad is a batch-level sunk total (see adCost)
  chargeProduct: boolean;
  chargeDelivery: boolean;
  sortOrder?: number;
}

export interface StatusTierEntry {
  orderStatus: string;
  tierKey: string;
  isOpen: boolean;          // order could still deliver -> counted as delivered in best-case
}

export interface BatchInputs {
  adSpend: number;
  productCostPerSet: number;
  deliveryCostPerOrder: number;
  status: "open" | "closed";
}

export interface BatchOrder {
  status: string;
  amount: number;           // FULL order revenue (already includes any add-on money) — recognised if its tier earns revenue
  sets: number;             // sets/packs in this order (single=1, double=2, ...)
  addonCost?: number;       // REAL COGS of this order's cross-sell add-ons + free gifts
                            // (priced from product costs). Charged on product-charging tiers,
                            // on top of productCostPerSet × sets. 0 / absent when none.
  addonRevenue?: number;    // the add-on/cross-sell PORTION already inside `amount` (bonus order
                            // value that rode along — no extra ad/delivery). Split out for display.
}

export interface ScenarioResult {
  totalOrders: number;
  deliveredOrders: number;
  setsDelivered: number;
  revenue: number;          // total delivered revenue (includes addonRevenue)
  addonRevenue: number;     // the cross-sell/gift portion of revenue (bonus order value)
  adCost: number;
  productCost: number;
  addonCost: number;        // real cross-sell/free-gift COGS on product-charging orders
  deliveredDelivery: number;
  wastedDelivery: number;
  totalCost: number;
  netProfit: number;
  profitPerOrder: number;
  trueDeliveryRate: number; // 0..1
  failureRate: number;      // 0..1
  aovSets: number;          // avg sets per delivered order
  aovValue: number;         // avg revenue per delivered order (NGN)
  cpp: number;              // ad spend / total orders
  tierCounts: Record<string, number>;
}

export interface BatchEconomics {
  worstCase: ScenarioResult;
  bestCase: ScenarioResult;
  breakevenAovValue: number | null; // min avg revenue per delivered order for net >= 0 (worst-case)
  writeOffCount: number;            // orders that never delivered (the headline floor's failures)
  closed: boolean;
}

const num = (n: unknown): number => {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : 0;
};

const tiersByKey = (tiers: CostTier[]): Map<string, CostTier> =>
  new Map(tiers.map((t) => [t.tierKey, t]));

const statusMapByStatus = (statusMap: StatusTierEntry[]): Map<string, StatusTierEntry> =>
  new Map(statusMap.map((e) => [e.orderStatus, e]));

// The primary revenue-earning tier — where best-case re-tiers open orders.
const deliveredTierKey = (tiers: CostTier[]): string | null => {
  const earners = tiers
    .filter((t) => t.earnsRevenue)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return earners.length > 0 ? earners[0].tierKey : null;
};

function runScenario(
  orders: BatchOrder[],
  batch: BatchInputs,
  tiers: Map<string, CostTier>,
  statuses: Map<string, StatusTierEntry>,
  deliveredKey: string | null,
  treatOpenAsDelivered: boolean
): ScenarioResult {
  let revenue = 0, addonRevenue = 0, productCost = 0, addonCost = 0, deliveredDelivery = 0, wastedDelivery = 0;
  let deliveredOrders = 0, setsDelivered = 0;
  const tierCounts: Record<string, number> = {};

  for (const o of orders) {
    const sets = Math.max(0, num(o.sets));
    const entry = statuses.get(o.status);
    let tierKey = entry?.tierKey;
    if (treatOpenAsDelivered && entry?.isOpen && deliveredKey) tierKey = deliveredKey;

    const countKey = tierKey ?? "unmapped";
    tierCounts[countKey] = (tierCounts[countKey] ?? 0) + 1;

    const tier = tierKey ? tiers.get(tierKey) : undefined;
    if (!tier) continue; // unmapped/unknown status earns nothing, costs nothing but ad

    if (tier.earnsRevenue) {
      revenue += num(o.amount);
      addonRevenue += Math.min(num(o.addonRevenue), num(o.amount)); // bonus portion, never above the order total
      deliveredOrders += 1;
      setsDelivered += sets;
    }
    if (tier.chargeProduct) {
      productCost += sets * num(batch.productCostPerSet);
      addonCost += num(o.addonCost); // add-on/gift stock leaves only when the order is fulfilled
    }
    if (tier.chargeDelivery) {
      if (tier.earnsRevenue) deliveredDelivery += num(batch.deliveryCostPerOrder);
      else wastedDelivery += num(batch.deliveryCostPerOrder);
    }
  }

  const totalOrders = orders.length;
  const adCost = num(batch.adSpend); // sunk on the whole batch, regardless of delivery
  const totalCost = adCost + productCost + addonCost + deliveredDelivery + wastedDelivery;
  const netProfit = revenue - totalCost;

  return {
    totalOrders,
    deliveredOrders,
    setsDelivered,
    revenue,
    addonRevenue,
    adCost,
    productCost,
    addonCost,
    deliveredDelivery,
    wastedDelivery,
    totalCost,
    netProfit,
    profitPerOrder: totalOrders > 0 ? netProfit / totalOrders : 0,
    trueDeliveryRate: totalOrders > 0 ? deliveredOrders / totalOrders : 0,
    failureRate: totalOrders > 0 ? 1 - deliveredOrders / totalOrders : 0,
    aovSets: deliveredOrders > 0 ? setsDelivered / deliveredOrders : 0,
    aovValue: deliveredOrders > 0 ? revenue / deliveredOrders : 0,
    cpp: totalOrders > 0 ? adCost / totalOrders : 0,
    tierCounts
  };
}

export function computeBatchEconomics(
  orders: BatchOrder[],
  batch: BatchInputs,
  tiers: CostTier[],
  statusMap: StatusTierEntry[]
): BatchEconomics {
  const tiersMap = tiersByKey(tiers);
  const statuses = statusMapByStatus(statusMap);
  const deliveredKey = deliveredTierKey(tiers);

  const worstCase = runScenario(orders, batch, tiersMap, statuses, deliveredKey, false);
  const bestCase = runScenario(orders, batch, tiersMap, statuses, deliveredKey, true);

  // Min avg revenue per delivered order to reach net >= 0 (worst-case). Costs are
  // independent of revenue here, so it's exact: revenue_be = totalCost.
  const breakevenAovValue =
    worstCase.deliveredOrders > 0 ? worstCase.totalCost / worstCase.deliveredOrders : null;

  return {
    worstCase,
    bestCase,
    breakevenAovValue,
    writeOffCount: worstCase.totalOrders - worstCase.deliveredOrders,
    closed: batch.status === "closed"
  };
}
