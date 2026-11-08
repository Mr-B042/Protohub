import type { EmAudience, EmCampaign, EmCampaignInput, EmDelivery, EmDesigner, EmDesignerProduct, EmOptions, EmPreview } from "../../lib/api";
import { buildTemplateDesign, type CampaignFields, type EmailDesign } from "../../lib/email-render";

/** The Create Campaign window's state and the small rules it shares. */

export type Draft = {
  id: string | null;
  name: string;
  goal: string;
  subject: string;
  subjectB: string;
  preheader: string;
  offerType: string;
  productId: string | null;
  offer: { on: boolean; title: string; benefit: string };
  audience: EmAudience;
  design: EmailDesign;
  delivery: EmDelivery;
  /** One-time only: send the moment it is launched. */
  sendNow: boolean;
  options: EmOptions;
  thumbnailUrl: string | null;
  status: string;
  /** Coupons & Offers: the offer this email carries (lower price when they order from it). */
  offerId: string | null;
  /** Templates tab: the template it started from. */
  templateKey?: string | null;
};

export const GOALS: Array<{ key: string; label: string; hint: string; icon: string }> = [
  { key: "retention", label: "Retention / Re-engagement", hint: "Bring customers back to buy again", icon: "refresh" },
  { key: "upsell", label: "Upsell / Cross-sell", hint: "Recommend related or higher value items", icon: "cart" },
  { key: "promotion", label: "Promotion / Offer", hint: "Drive quick sales with a special offer", icon: "tag" },
  { key: "launch", label: "Product Launch", hint: "Announce a new product", icon: "rocket" },
  { key: "cart", label: "Abandoned Cart Recovery", hint: "Recover incomplete purchases", icon: "cartx" },
  { key: "winback", label: "Win-Back (Inactive Customers)", hint: "Re-engage customers who haven't bought", icon: "box" },
  { key: "appreciation", label: "Customer Appreciation", hint: "Say thank you and build loyalty", icon: "star" },
  { key: "announcement", label: "Announcement / Update", hint: "Share important news or changes", icon: "mail" }
];
export const goalLabel = (key: string) => GOALS.find((row) => row.key === key)?.label ?? key;

export const OFFER_TYPES: Array<{ key: string; label: string; template: string }> = [
  { key: "product", label: "Product Recommendation", template: "product_promo" },
  { key: "discount", label: "Special Discount", template: "product_promo" },
  { key: "bundle", label: "Bundle Offer", template: "upsell_offer" },
  { key: "loyalty", label: "Loyalty Reward", template: "simple_message" },
  { key: "custom", label: "Custom Message", template: "simple_message" }
];

export const DEFAULT_OPTIONS: EmOptions = { abTest: false, plainText: false, utm: true, resendNonOpeners: false, resendHours: 48 };

/** Tomorrow 2:00 PM Lagos (the design's default send time). */
export function defaultSendAt(nowMs = Date.now()) {
  const lagos = new Date(nowMs + 3_600_000);
  const day = new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate() + 1, 13, 0));
  return day.toISOString();
}

export const priceText = (product: EmDesignerProduct | undefined) => {
  if (!product || product.priceMin === null) return "";
  const n = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;
  return product.priceMax !== null && product.priceMax !== product.priceMin ? `${n(product.priceMin)} – ${n(product.priceMax)}` : n(product.priceMin);
};

export function fieldsFor(draft: Draft, designer: EmDesigner | null): CampaignFields {
  const product = designer?.products.find((row) => row.id === draft.productId);
  return {
    brand: designer?.sender.fromName || "Our Store",
    goal: draft.goal,
    offerType: draft.offerType,
    productId: product?.id ?? "",
    productName: product?.name ?? "",
    productImage: product?.image ?? "",
    productLink: product?.links[0]?.url ?? "",
    productPrice: priceText(product),
    offerOn: draft.offer.on,
    offerTitle: draft.offer.title,
    offerBenefit: draft.offer.benefit
  };
}

/** Until the design is edited by hand, it follows the setup step. */
export function syncDesign(draft: Draft, designer: EmDesigner | null): Draft {
  if (draft.design.touched) return draft;
  const template = OFFER_TYPES.find((row) => row.key === draft.offerType)?.template ?? draft.design.template ?? "product_promo";
  const product = designer?.products.find((row) => row.id === draft.productId);
  return { ...draft, design: buildTemplateDesign(template, fieldsFor(draft, designer)), thumbnailUrl: product?.image || null };
}

export function newDraft(designer: EmDesigner | null, preset?: string, segmentId?: string): Draft {
  const presetRow = preset ? designer?.presets.find((row) => row.key === preset) : undefined;
  const goal = preset === "win_back" ? "winback" : preset === "cart_recovery" ? "cart" : preset === "post_purchase" ? "appreciation" : "retention";
  const draft: Draft = {
    id: null, name: presetRow ? presetRow.name : "", goal, subject: "", subjectB: "", preheader: "", offerType: preset === "post_purchase" ? "custom" : "product",
    productId: designer?.products.find((row) => row.image)?.id ?? designer?.products[0]?.id ?? null,
    offer: { on: !preset || preset === "win_back", title: preset === "win_back" ? "Come Back & Save" : "", benefit: preset === "win_back" ? "10% OFF" : "" },
    audience: segmentId ? { source: "segment", segmentId } : { source: "all" },
    design: buildTemplateDesign("product_promo", { brand: "", goal, offerType: "product", productId: "", productName: "", productImage: "", productLink: "", productPrice: "", offerOn: false, offerTitle: "", offerBenefit: "" }),
    delivery: presetRow
      ? { type: "automation", sendAt: null, automation: { preset, trigger: presetRow.trigger, delayHours: presetRow.delayHours, inactiveDays: presetRow.inactiveDays ?? 60, exit: presetRow.exit } }
      : { type: "one_time", sendAt: defaultSendAt() },
    sendNow: false,
    options: { ...DEFAULT_OPTIONS },
    thumbnailUrl: null,
    status: "draft",
    offerId: null
  };
  return syncDesign(draft, designer);
}

export function draftFromCampaign(row: EmCampaign): Draft {
  return {
    id: row.id, name: row.name, goal: row.goal, subject: row.subject, subjectB: row.subjectB, preheader: row.preheader, offerType: row.offerType,
    productId: row.productId, offer: { on: !!row.offer?.on, title: row.offer?.title ?? "", benefit: row.offer?.benefit ?? "" },
    audience: row.audience?.source ? row.audience : { source: "all" },
    design: row.design ?? buildTemplateDesign("product_promo", { brand: "", goal: row.goal, offerType: row.offerType, productId: "", productName: "", productImage: "", productLink: "", productPrice: "", offerOn: false, offerTitle: "", offerBenefit: "" }),
    delivery: row.delivery?.type ? row.delivery : { type: "one_time", sendAt: defaultSendAt() },
    sendNow: false,
    options: { ...DEFAULT_OPTIONS, ...(row.options ?? {}) },
    thumbnailUrl: row.thumbnailUrl,
    status: row.status,
    offerId: row.offerId ?? null
  };
}

export function toInput(draft: Draft): EmCampaignInput {
  return {
    name: draft.name.trim() || "Untitled campaign", goal: draft.goal, subject: draft.subject, subjectB: draft.subjectB, preheader: draft.preheader,
    offerType: draft.offerType, productId: draft.productId, offer: draft.offer, audience: draft.audience, design: draft.design,
    delivery: draft.delivery.type === "one_time" && draft.sendNow ? { ...draft.delivery, sendAt: null } : draft.delivery,
    options: draft.options, thumbnailUrl: draft.thumbnailUrl, offerId: draft.offerId,
    ...(draft.templateKey ? { templateKey: draft.templateKey } : {})
  };
}

/** "Repeat Buyers (2,836)" for the summary bar. */
export function audienceSummary(draft: Draft, designer: EmDesigner | null, preview: EmPreview | null) {
  const a = draft.audience;
  const name = a.source === "all" ? "All Customers"
    : a.source === "custom" ? a.custom?.name?.trim() || "Custom group"
      : a.source === "journey" ? designer?.journeyStages.find((row) => row.key === a.journeyStage)?.name ?? "Customer stage"
        : designer?.segments.find((row) => row.id === (a.source === "list" ? a.listId : a.segmentId))?.name ?? "Not selected";
  if ((a.source === "segment" && !a.segmentId) || (a.source === "list" && !a.listId) || (a.source === "journey" && !a.journeyStage)) return "Not selected";
  return preview ? `${name} (${preview.recipients.toLocaleString("en-NG")})` : name;
}

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const WHEN_LONG = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
export const whenText = (iso: string | null | undefined, long = false) => (iso ? (long ? WHEN_LONG : WHEN).format(new Date(iso)).replace(/, (\d{1,2}:\d{2})/, " at $1") + " (WAT)" : "");

export function delayText(hours: number) {
  if (hours <= 0) return "Straight away";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function sendSummary(draft: Draft) {
  const d = draft.delivery;
  if (d.type === "automation") {
    const trigger = { delivered: "a delivery", ordered: "an order", cart: "a left cart", inactive: "going quiet" }[d.automation?.trigger ?? "delivered"];
    return d.automation?.trigger === "inactive" ? `Automatic, ${d.automation?.inactiveDays ?? 60} days after the last delivery` : `Automatic, ${delayText(d.automation?.delayHours ?? 0).toLowerCase()} after ${trigger}`;
  }
  if (draft.sendNow) return "As soon as you launch";
  if (!d.sendAt) return "Not scheduled";
  return d.type === "recurring" ? `${whenText(d.sendAt)}, every ${d.repeat?.every ?? "week"}` : whenText(d.sendAt);
}
