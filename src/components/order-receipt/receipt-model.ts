// Order receipt (Bright's design, 20 Oct 2026): what goes on the image.
//
// ⚠️ EVERY figure comes from the order record. Nothing on the receipt can be
// typed by the person sending it (Bright's brief: no misleading receipts).
// The only free text, the note, travels as the WhatsApp message text, never
// on the image.

export type ReceiptLineInput = { productId?: string; productName: string; quantity: number; amount: number; packageName?: string };
export type ReceiptGiftInput = { productId?: string; productName: string; quantity: number; isFreeGift?: boolean; hiddenFromCustomer?: boolean };

export type ReceiptOrderInput = {
  id: string;
  customer: string;
  phone: string;
  whatsapp?: string;
  address?: string;
  city?: string;
  state?: string;
  location?: string;
  productId?: string;
  productName: string;
  /** A short line under the product name (its category), when there is one. */
  productSubtitle?: string;
  packageName?: string;
  quantity?: number;
  amount: number;
  originalAmount?: number;
  currency?: string;
  status?: string;
  /** Delivery day: the date set for it, the day it was delivered, or what the customer asked for. */
  scheduledDate?: string;
  deliveredDate?: string;
  preferredDelivery?: string;
  createdAt?: string;
  originalCreatedAt?: string;
  crossSellLines?: ReceiptLineInput[];
  additionalLines?: ReceiptLineInput[];
  packageComponentsSnapshot?: ReceiptGiftInput[];
};

export type ReceiptLine = { productId?: string; name: string; subtitle?: string; detail: string; quantity: number; amount: number; kind: "main" | "addon" };
export type ReceiptGift = { productId?: string; name: string; quantity: number };

export type ReceiptModel = {
  reference: string;
  orderDate: string;
  customer: {
    name: string; phone: string;
    /** Shown only when it differs from the phone number. */
    whatsapp: string | null;
    /** The full street address the rider goes to. */
    address: string | null;
    /** City, State. */
    location: string;
    delivery: { label: string; value: string } | null;
  };
  lines: ReceiptLine[];
  gifts: ReceiptGift[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  currencySymbol: string;
  paid: boolean;
};

const SYMBOLS: Record<string, string> = { NGN: "₦", USD: "$", GBP: "£", GHS: "GH₵", KES: "KSh" };

/** Lagos date of an ISO time, as DDMMYY. */
const lagosParts = (iso: string) => {
  const date = new Date(iso);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "2-digit", year: "2-digit" })
    .formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.day}${parts.month}${parts.year}`;
};

/** PH-ddmmyy-<order number>: the day placed plus the real order number (Bright's choice). */
export function receiptReference(orderId: string, placedAt?: string) {
  const id = String(orderId).replace(/^#/, "");
  return placedAt && !Number.isNaN(new Date(placedAt).getTime()) ? `PH-${lagosParts(placedAt)}-${id}` : `PH-${id}`;
}

/** "01 Oct 2026, 10:24 AM", Lagos time. */
export function receiptDate(iso?: string) {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return "—";
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/\bam\b/, "AM").replace(/\bpm\b/, "PM");
}

export function money(value: number, symbol = "₦") {
  return `${symbol}${Math.round(value).toLocaleString("en-NG")}`;
}

/** "Tue, 21 Oct 2026" from a plain YYYY-MM-DD (no time-zone shift). */
export function receiptDay(value?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(/^(\w+) /, "$1, ");
}

function deliveryLine(order: ReceiptOrderInput): { label: string; value: string } | null {
  const delivered = order.status === "Delivered" ? receiptDay(order.deliveredDate) : null;
  if (delivered) return { label: "Delivered on", value: delivered };
  const scheduled = receiptDay(order.scheduledDate);
  if (scheduled) return { label: "Delivery date", value: scheduled };
  const preferred = order.preferredDelivery?.trim();
  if (preferred) return { label: "Preferred delivery", value: receiptDay(preferred) ?? preferred };
  return null;
}

export function buildReceipt(order: ReceiptOrderInput): ReceiptModel {
  const addons = [...(order.crossSellLines ?? []), ...(order.additionalLines ?? [])].filter((line) => Number(line.amount) > 0 || line.productName);
  const addonTotal = addons.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  // The main line is the order amount less its add-ons (never original_amount):
  // that keeps the lines adding up to the total the customer pays.
  const main = Math.max(0, (Number(order.amount) || 0) - addonTotal);
  const placedAt = order.originalCreatedAt || order.createdAt;
  const location = [order.city, order.state].filter(Boolean).join(", ") || order.location || "—";
  const address = (order.address ?? "").trim() || null;
  const digits = (value?: string) => (value ?? "").replace(/\D/g, "").replace(/^234/, "0").replace(/^(?!0)/, "0");
  const whatsapp = order.whatsapp?.trim() && digits(order.whatsapp) !== digits(order.phone) ? order.whatsapp.trim() : null;
  const lines: ReceiptLine[] = [
    { productId: order.productId, name: order.productName, subtitle: order.productSubtitle && order.productSubtitle !== order.packageName ? order.productSubtitle : undefined, detail: order.packageName || "", quantity: 1, amount: main, kind: "main" },
    ...addons.map((line) => ({ productId: line.productId, name: line.productName, detail: line.packageName || "", quantity: Number(line.quantity) || 1, amount: Number(line.amount) || 0, kind: "addon" as const }))
  ];
  const gifts = (order.packageComponentsSnapshot ?? [])
    .filter((c) => c.isFreeGift && !c.hiddenFromCustomer && c.productName)
    .map((c) => ({ productId: c.productId, name: c.productName, quantity: Number(c.quantity) || 1 }));
  const total = Number(order.amount) || 0;
  return {
    reference: receiptReference(order.id, placedAt),
    orderDate: receiptDate(placedAt),
    customer: { name: order.customer || "—", phone: order.phone || "—", whatsapp, address, location, delivery: deliveryLine(order) },
    lines,
    gifts,
    subtotal: total,
    deliveryFee: 0,
    total,
    currencySymbol: SYMBOLS[order.currency ?? "NGN"] ?? "₦",
    paid: order.status === "Delivered"
  };
}

// ── Price verification (shown to staff, never on the image) ─────────────────

export type PriceVerification = {
  originalAmount: number;
  currentAmount: number;
  capturedAt: string;
  reference: string;
  source: "checkout" | "cart" | "staff";
  sourceLabel: string;
  status: "original" | "changed" | "no_record";
  statusLabel: string;
  shownAtCheckout: { packageName: string; price: number; compareAt: number | null } | null;
  edits: Array<{ field: string; from: string; to: string; by: string; at: string }>;
};
