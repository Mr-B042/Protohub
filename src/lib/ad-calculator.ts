/**
 * Ad break-even calculator (Bright's ad framework, part 6, 16 Nov 2026).
 * Judges an ad on profit per DELIVERED order, never on CPC.
 *
 * All money is per order. "Cost per placed order" (CPP) is ad spend divided by
 * Protohub orders placed, not Meta's purchases.
 *  - left per delivery = price − product − delivery − commission − other
 *  - break-even CPP    = rate × left per delivery − (1 − rate) × cost per failed order
 *  - ad cost per delivery = CPP ÷ rate
 *  - profit per delivered order = (rate × left − (1 − rate) × failed − CPP) ÷ rate
 * Status uses the same steps as Campaign decisions: scale at 70% of
 * break-even or less, watch from 85%, turn off above break-even.
 */

export type AdCalcInput = {
  price: number; productCost: number; deliveryCost: number; commission: number; otherCost: number;
  failedCost: number; cpp: number;
  /** 0-100 */
  deliveryRate: number;
};

export type AdCalcStatus = "scale" | "keep" | "watch" | "turn_off" | "no_profit";

export type AdCalcResult = {
  leftPerDelivery: number;
  breakEvenCpp: number;
  adCostPerDelivery: number | null;
  profitPerDelivered: number | null;
  profitPerPlaced: number;
  marginPct: number | null;
  /** CPP as a share of break-even (1 = exactly break-even). */
  shareOfBreakEven: number | null;
  status: AdCalcStatus;
};

const n = (value: number) => (Number.isFinite(value) ? value : 0);

export function adCalc(input: AdCalcInput): AdCalcResult {
  const rate = Math.min(100, Math.max(0, n(input.deliveryRate))) / 100;
  const cpp = Math.max(0, n(input.cpp));
  const failed = Math.max(0, n(input.failedCost));
  const leftPerDelivery = n(input.price) - n(input.productCost) - n(input.deliveryCost) - n(input.commission) - n(input.otherCost);
  const breakEvenCpp = rate * leftPerDelivery - (1 - rate) * failed;
  const profitPerPlaced = breakEvenCpp - cpp;
  const profitPerDelivered = rate > 0 ? profitPerPlaced / rate : null;
  const shareOfBreakEven = breakEvenCpp > 0 ? cpp / breakEvenCpp : null;
  const status: AdCalcStatus = breakEvenCpp <= 0 ? "no_profit"
    : shareOfBreakEven! > 1 ? "turn_off"
    : shareOfBreakEven! >= 0.85 ? "watch"
    : shareOfBreakEven! <= 0.7 ? "scale" : "keep";
  return {
    leftPerDelivery, breakEvenCpp, profitPerPlaced, profitPerDelivered, shareOfBreakEven, status,
    adCostPerDelivery: rate > 0 ? cpp / rate : null,
    marginPct: profitPerDelivered !== null && n(input.price) > 0 ? (profitPerDelivered / input.price) * 100 : null
  };
}
