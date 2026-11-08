/**
 * Coupons & Offers (Bright's design 54, 8 Nov 2026): when an offer applies to
 * an order and how much it takes off. Pure; tested in email-offers-rules.test.ts.
 * The same rules run when the order form shows the price and when the
 * server saves the order, so the customer pays what they were shown.
 */

export const OFFER_TYPES = ["discount", "fixed", "flash", "loyalty"] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export type Offer = {
  id: string;
  name: string;
  type: OfferType;
  benefit: "percent" | "fixed";
  value: number;
  code: string;
  minOrder: number;
  productIds: string[];
  minDelivered: number;
  startsMs: number | null;
  endsMs: number | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  status: "draft" | "active" | "paused" | "archived";
};

export type OfferState = "draft" | "live" | "scheduled" | "expired" | "paused" | "archived";

export function offerState(offer: Pick<Offer, "status" | "startsMs" | "endsMs">, nowMs: number): OfferState {
  if (offer.status !== "active") return offer.status;
  if (offer.endsMs !== null && nowMs >= offer.endsMs) return "expired";
  if (offer.startsMs !== null && nowMs < offer.startsMs) return "scheduled";
  return "live";
}

/** Naira off an order of `amount` (rounded, never more than the order). */
export function discountFor(offer: Pick<Offer, "benefit" | "value">, amount: number) {
  if (!(amount > 0) || !(offer.value > 0)) return 0;
  const raw = offer.benefit === "percent" ? (amount * Math.min(100, offer.value)) / 100 : offer.value;
  return Math.max(0, Math.min(amount, Math.round(raw)));
}

export const benefitText = (offer: Pick<Offer, "benefit" | "value">) => (offer.benefit === "percent" ? `${offer.value}% OFF` : `₦${Math.round(offer.value).toLocaleString("en-NG")} OFF`);

export type OfferCheck = {
  productId: string | null;
  /** The order before the discount (main package and add-ons). */
  amount: number;
  nowMs: number;
  usedTotal: number;
  usedByCustomer: number;
  usedBySend: boolean;
  deliveredOrders: number;
};

/** Why an offer does not apply to this order, in plain words; null = it applies. */
export function offerProblem(offer: Offer, check: OfferCheck): string | null {
  const state = offerState(offer, check.nowMs);
  if (state === "expired") return "The offer has ended.";
  if (state === "scheduled") return "The offer has not started yet.";
  if (state !== "live") return "The offer is not running.";
  if (offer.productIds.length && (!check.productId || !offer.productIds.includes(check.productId))) return "The offer is for other products.";
  if (offer.minOrder > 0 && check.amount < offer.minOrder) return `The offer needs an order of ₦${Math.round(offer.minOrder).toLocaleString("en-NG")} or more.`;
  if (check.usedBySend) return "This email's offer was already used.";
  if (offer.usageLimit !== null && check.usedTotal >= offer.usageLimit) return "The offer has been used up.";
  if (check.usedByCustomer >= offer.perCustomerLimit) return "The customer already used this offer.";
  if (offer.minDelivered > 0 && check.deliveredOrders < offer.minDelivered) return `The offer is for customers with ${offer.minDelivered}+ delivered orders.`;
  return null;
}

/** "Weekend Flash Sale" → "WEEKENDFLASH". Letters, digits, - and _, 3 to 24 long. */
export function codeFrom(raw: unknown) {
  const code = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
  return code.length >= 3 ? code : null;
}

/** The send token an email click puts in utm_content (see email-marketing.ts recordClick). */
export const SEND_TOKEN = /^[A-Za-z0-9_-]{16,40}$/;
