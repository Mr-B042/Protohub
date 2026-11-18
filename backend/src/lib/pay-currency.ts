import { rateFor } from "./currency-rates.js";

// Staff pay is worked out in naira in every branch (Bright, 18 Nov 2026:
// "same Nigeria value rather than using 200 ZMW for 200 naira").
//
// Rules that pay from an order's MONEY (a % of the upfront payment, a cross-sell
// minimum price, contribution or profit) would otherwise read a K1,180 Zambia
// order as ₦1,180. Every pay module converts the orders it reads with
// ordersInNaira() right after loading them, at the Owner's rate on the Data
// Sources card (currency_rates NGN>ZMW, ₦61 per K1 from 18 Nov 2026).
//
// ⚠️ READ-ONLY COPIES. The converted rows are for working out pay only - never
// write one back to `orders`, or a Zambia order would be saved in naira.
// Count-based rules (per delivered order, per upgrade, fines) need nothing:
// they already pay the same naira amount for any order.

export const PAY_CURRENCY = "NGN";

/** Money fields on an order row. */
const ORDER_MONEY_KEYS = ["amount", "original_amount", "amount_remitted", "logistics_cost", "cogs_snapshot", "delivery_fee"] as const;
/** Line arrays on an order row, and the money keys inside each line. */
const LINE_ARRAY_KEYS = ["cross_sell_lines", "additional_lines", "free_gift_lines"] as const;
const LINE_MONEY_KEYS = ["amount", "price", "unitPrice", "unit_price", "value", "total", "cost", "unitCost", "unit_cost"] as const;

/** Currency code -> naira per ONE unit of it (NGN = 1). */
export type NairaRates = Map<string, number>;

const nairaPer = (currency: unknown, rates: NairaRates) => {
  const code = String(currency ?? PAY_CURRENCY).toUpperCase();
  return code === PAY_CURRENCY ? 1 : rates.get(code) ?? null;
};

const scaled = (value: unknown, factor: number) => {
  if (value === null || value === undefined || value === "") return value;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * factor * 100) / 100 : value;
};

/** Pure: a copy of one order with its money in naira (unchanged when already naira or no rate is known). */
export function orderInNaira<T extends Record<string, any>>(order: T, rates: NairaRates): T {
  const factor = nairaPer(order?.currency, rates);
  if (!order || factor === null || factor === 1) return order;
  const out: Record<string, any> = { ...order, currency: PAY_CURRENCY, pay_source_currency: order.currency };
  for (const key of ORDER_MONEY_KEYS) if (key in out) out[key] = scaled(out[key], factor);
  for (const key of LINE_ARRAY_KEYS) {
    if (!Array.isArray(out[key])) continue;
    out[key] = out[key].map((line: any) => {
      if (!line || typeof line !== "object") return line;
      const next = { ...line };
      for (const k of LINE_MONEY_KEYS) if (k in next) next[k] = scaled(next[k], factor);
      return next;
    });
  }
  return out as T;
}

/** Rates for every non-naira currency in these rows (one lookup each). */
export async function nairaRatesFor(orgId: string, rows: Array<{ currency?: unknown }>): Promise<NairaRates> {
  const codes = new Set(rows.map((row) => String(row?.currency ?? PAY_CURRENCY).toUpperCase()).filter((code) => code !== PAY_CURRENCY));
  const rates: NairaRates = new Map();
  for (const code of codes) {
    const rate = await rateFor(orgId, PAY_CURRENCY, code);
    if (rate && rate.fromPerTo > 0) rates.set(code, rate.fromPerTo);
  }
  return rates;
}

/** Orders as read, with any non-naira order's money converted to naira for pay. */
export async function ordersInNaira<T extends Record<string, any>>(orgId: string, orders: T[] | null | undefined): Promise<T[]> {
  const list = orders ?? [];
  if (!list.some((row) => row?.currency && String(row.currency).toUpperCase() !== PAY_CURRENCY)) return list;
  const rates = await nairaRatesFor(orgId, list);
  return list.map((row) => orderInNaira(row, rates));
}

/** Naira per one unit of this order's currency (1 for naira; null when no rate is known). */
export const nairaFactor = (currency: unknown, rates: NairaRates) => nairaPer(currency, rates);
