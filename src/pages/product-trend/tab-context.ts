import type { MutableRefObject } from "react";
import {
  bucketKeys, bucketOf, isDelivered, type CostBook, type Granularity, type ProductRow, type StateRow, type TrendAgent, type TrendHub, type TrendOrder, type TrendProduct
} from "./product-trend-model";

// What every Product Trend tab gets from the page.

export type TrendModel = {
  costs: CostBook; previousCosts: CostBook;
  orders: TrendOrder[]; previous: TrendOrder[];
  productRows: ProductRow[]; stateRows: StateRow[];
};

export type TransferRequest = { productId?: string; quantity: number; toState?: string; toAgentId?: string; toAgentLocationId?: string };

export type TabCtx = {
  model: TrendModel;
  products: TrendProduct[];
  hubs: TrendHub[];
  agents: TrendAgent[];
  canSeeProfit: boolean;
  money: (value: number) => string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  days: number;
  exportRef: MutableRefObject<() => void>;
  imageOf: (productId: string) => string | null;
  onViewProduct: (productId: string) => void;
  /** Applied filters the tabs read. */
  productId: string;
  state: string;
  metric: string;
  grain: Granularity;
  stockStatus: string;
  canCreateTransfer: boolean;
  onCreateTransfer?: (request: TransferRequest) => void;
  onOpenReplenishment?: () => void;
  onOnlyAgent: (agentId: string) => void;
  /** Who is looking (view-as aware), for the send / approve buttons. */
  role: string;
  userId: string | null;
  /** Orders placed in [from, to] (for following a decision after approval). */
  loadOrders: (from: string, to: string) => Promise<TrendOrder[]>;
  /** Today in Lagos, YYYY-MM-DD. */
  today: string;
};

/** One value per day (or week, for long periods) for a KPI's little line. */
export function sparkOf(orders: TrendOrder[], from: string, to: string, days: number, value: (bucket: TrendOrder[]) => number) {
  const grain: Granularity = days > 62 ? "weekly" : "daily";
  const groups = new Map<string, TrendOrder[]>();
  for (const order of orders) {
    const key = bucketOf(order.createdKey, grain);
    const list = groups.get(key);
    if (list) list.push(order); else groups.set(key, [order]);
  }
  return bucketKeys(from, to, grain).map((key) => value(groups.get(key) ?? []));
}

/** Net profit of delivered orders in a bucket (each carries its share of running costs). */
export const netOf = (orders: TrendOrder[], costs: CostBook) =>
  orders.filter(isDelivered).reduce((sum, order) => sum + order.amount - order.cogs - order.logisticsCost - (costs.perOrder.get(order.id) ?? 0), 0);

export const rateOf = (orders: TrendOrder[]) => (orders.length > 0 ? (orders.filter(isDelivered).length / orders.length) * 100 : 0);

/** All 36 states + FCT (for "Active States 26 / 37"). */
export const STATE_COUNT = 37;

/** Map name -> value for the map, keyed the map's way ("FCT"). */
export const mapKey = (state: string) => (state === "FCT Abuja" ? "FCT" : state);

/** Heat colour for a share of the table's highest value (design: green high → pink low). */
export function heatColor(share: number) {
  if (share >= 0.6) return { bg: "#86efac", fg: "#14532d" };
  if (share >= 0.4) return { bg: "#bbf7d0", fg: "#14532d" };
  if (share >= 0.25) return { bg: "#fef08a", fg: "#713f12" };
  if (share >= 0.1) return { bg: "#fed7aa", fg: "#7c2d12" };
  if (share > 0) return { bg: "#fecdd3", fg: "#881337" };
  return { bg: "#fde2e4", fg: "#9f1239" };
}

/** Bar colour for a delivery rate (green good, amber middling, red weak). */
export const rateTone = (rate: number) => (rate >= 65 ? "#16a34a" : rate >= 55 ? "#f59e0b" : "#ef4444");
