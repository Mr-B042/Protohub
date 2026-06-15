import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cartsApi, embedSettingsApi, productsApi, publicOrdersApi } from "../lib/api";
import { browserSupabaseClient } from "../lib/realtime";
import type { ProductCurrencyCode } from "../types";

type PublicPricing = {
  currency: ProductCurrencyCode;
  sellingPrice: number;
  isPrimary?: boolean;
};

type PublicCompanionSocialProof = {
  buyersTodayCount: number;
  buyersLast24HoursCount: number;
  recentBuyerCount: number;
  allTimeBuyerCount: number;
  lastOrderedAt?: string | null;
  isMostAdded: boolean;
};

type PublicCompanion = {
  companionId?: string;
  productId: string;
  packageId?: string | null;
  active?: boolean;
  quantity: number;
  pricingMode: "free" | "fixed" | "use_product_price" | "standard";
  fixedPrice?: number | null;
  stateFilterMode?: "all" | "allow" | "block";
  stateRestrictions: string[];
  autoInclude: boolean;
  placement?: "inline" | "upsell";
  pitch?: string;
  badgeText?: string;
  headline?: string;
  ctaText?: string;
  declineText?: string;
  imageUrl?: string;
  videoUrl?: string;
  embedHtml?: string;
  priority?: number;
  displayMode?: "compact" | "card" | "showcase";
  proofMode?: "real" | "promo_copy" | "hidden";
  urgencyMode?: "standard" | "price_loss";
  // Admin-typed promo numbers — only rendered when proofMode === "promo_copy".
  // Any null/blank/0 field is silently skipped.
  promoAllTimeBuyerCount?: number | null;
  promoBuyersLast24HoursCount?: number | null;
  promoLastAddedRelative?: string | null;
  promoIsMostAdded?: boolean | null;
  socialProof?: PublicCompanionSocialProof | null;
};

type PublicPackage = {
  id: string;
  name: string;
  description: string;
  quantity: number;
  price: number;
  currency: ProductCurrencyCode;
  displayOrder: number;
  active: boolean;
  packageSet?: string;
  stateFilterMode?: "all" | "allow" | "block";
  stateRestrictions?: string[];
  requiresStateStock?: boolean;
  featuredComboCard?: boolean;
  imageUrl?: string;
  imageUrls?: string[];
  unitSingular?: string;
  unitPlural?: string;
  packageComponents?: PublicPackageComponent[];
  companionProducts?: PublicCompanion[];
  // If set, this package's orders attribute to a different product than
  // its parent (combo bundle sitting under a single-tool parent). The
  // backend overrides product_id/product_name at order create; the
  // frontend uses this id to look up the attribution product's name from
  // the related products list for display. Migration 088.
  attributionProductId?: string | null;
};

type PublicPackageComponent = {
  componentId?: string;
  component_id?: string;
  productId: string;
  product_id?: string;
  quantity: number;
  isFreeGift?: boolean;
  is_free_gift?: boolean;
  hiddenFromCustomer?: boolean;
  hidden_from_customer?: boolean;
  note?: string;
};

type PublicPackageAvailability = {
  packageId: string;
  stateAllowed: boolean;
  stockReady: boolean;
  visible: boolean;
  requiresStateStock: boolean;
};

type PublicProduct = {
  id: string;
  orgId: string;
  name: string;
  description: string;
  packageDescription?: string;
  active: boolean;
  availableStates?: string[];
  freeGiftProductIds?: string[];
  freeGiftStateRestrictions?: Record<string, string[]>;
  crossSellPriceOverrides?: Record<string, number>;
  formCustomText?: string;
  pricings: PublicPricing[];
  packages: PublicPackage[];
};

type PublicEmbedSettings = {
  stateFieldMode: "freetext" | "dropdown";
  publicFormMode: "classic" | "guided_checkout";
  showEmail: boolean;
  showWhatsapp: boolean;
  requireWhatsapp: boolean;
  addressRequired: boolean;
  cityRequired: boolean;
  showPackageName: boolean;
  askDelivery: boolean;
  deliveryInputStyle: "quick" | "range";
  deliveryQuickToday: boolean;
  deliveryQuickTomorrow: boolean;
  deliveryQuickNextTomorrow: boolean;
  deliveryRangeMinDays: number;
  deliveryRangeMaxDays: number;
  requireConfirmation: boolean;
  confirmationText: string;
  showCommitment: boolean;
  commitmentText: string;
  allowDisagree: boolean;
  formOrderSummaryEnabled: boolean;
  formOrderSummaryTitle: string;
  freeDeliverySlotsEnabled?: boolean;
  freeDeliverySlotLimit?: number;
  freeDeliverySlotManualClaimed?: number;
  freeDeliveryResetIntervalMinutes?: number;
};

type PublicFreeDeliverySlotStatus = {
  enabled: boolean;
  limit?: number;
  claimed?: number;
  manualClaimed?: number;
  liveClaimed?: number;
  remaining?: number;
  full?: boolean;
  windowStart?: string;
  nextResetAt?: string;
  resetIntervalMinutes?: number;
};

type CrossSellSelection = {
  companionId?: string;
  productId: string;
  packageId?: string | null;
  quantity: number;
};

type PublicCartJourneyEventType =
  | "form_opened"
  | "first_interaction"
  | "package_selected"
  | "tier_switched"
  | "state_selected"
  | "additional_item_preview_opened"
  | "additional_item_added"
  | "additional_item_removed"
  | "image_viewed"
  | "field_hesitated"
  | "submit_idle"
  | "back_button_pressed"
  | "submit_attempted"
  | "submit_blocked_missing_name"
  | "submit_blocked_missing_phone"
  | "submit_blocked_invalid_phone"
  | "submit_blocked_missing_whatsapp"
  | "submit_blocked_invalid_whatsapp"
  | "submit_blocked_missing_address"
  | "submit_blocked_missing_city"
  | "submit_blocked_missing_state"
  | "submit_blocked_missing_delivery"
  | "submit_blocked_missing_confirmation"
  | "submit_blocked_missing_commitment"
  | "order_submitted"
  | "redirect_triggered"
  | "form_exited";

type PublicOrderFieldKey =
  | "name"
  | "phone"
  | "whatsapp"
  | "address"
  | "city"
  | "state"
  | "delivery"
  | "confirmation"
  | "commitment";

const PUBLIC_ORDER_VALIDATION_ORDER: PublicOrderFieldKey[] = [
  "name",
  "phone",
  "whatsapp",
  "address",
  "city",
  "state",
  "delivery",
  "confirmation",
  "commitment"
];

const sanitizePhoneDigitsInput = (value: string) => value.replace(/\D/g, "").slice(0, 15);

type PendingUpsellOffer = {
  orderId: string;
  customer: string;
  token: string;
  sourceCartId?: string;
  mainPackageId?: string;
  state?: string;
  companion: PublicCompanion;
  product: PublicProduct;
  targetPackage?: PublicPackage | null;
  quantity: number;
  amount: number;
  currency: ProductCurrencyCode;
};

type PublicOrderSubmissionState = {
  orderId: string;
  customer: string;
  mode: "confirmed_order" | "outage_capture" | "browser_queue" | "preview_only" | "local_test" | "held_review";
};

type QueuedPublicOrderSubmission = {
  id: string;
  customer: string;
  body: Record<string, unknown>;
  createdAt: string;
};

const DEFAULT_CONFIRMATION_TEXT =
  "I hereby confirm that I am financially prepared and available to receive this product within the next 1 to 3 days";
const DEFAULT_COMMITMENT_TEXT =
  "Please note that orders outside Lagos and Abuja attract a commitment fee of ₦1500 before dispatch";

const PRODUCT_CURRENCIES: Record<ProductCurrencyCode, { locale: string; currency: string }> = {
  NGN: { locale: "en-NG", currency: "NGN" },
  GHS: { locale: "en-GH", currency: "GHS" },
  USD: { locale: "en-US", currency: "USD" },
  GBP: { locale: "en-GB", currency: "GBP" },
  EUR: { locale: "de-DE", currency: "EUR" },
};

const NIGERIA_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
  "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Gombe", "Imo",
  "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
  "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers",
  "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT Abuja",
];

function normalizeStateName(value: string | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "fct" || normalized === "abuja" || normalized === "fct abuja" || normalized.includes("federal capital")) return "FCT Abuja";
  return (value ?? "").trim();
}

const DEFAULT_SETTINGS: PublicEmbedSettings = {
  stateFieldMode: "freetext",
  publicFormMode: "classic",
  showEmail: false,
  showWhatsapp: true,
  requireWhatsapp: true,
  addressRequired: true,
  cityRequired: true,
  showPackageName: false,
  askDelivery: false,
  deliveryInputStyle: "quick",
  deliveryQuickToday: true,
  deliveryQuickTomorrow: true,
  deliveryQuickNextTomorrow: false,
  deliveryRangeMinDays: 0,
  deliveryRangeMaxDays: 7,
  requireConfirmation: false,
  confirmationText: DEFAULT_CONFIRMATION_TEXT,
  showCommitment: false,
  commitmentText: DEFAULT_COMMITMENT_TEXT,
  allowDisagree: true,
  formOrderSummaryEnabled: true,
  formOrderSummaryTitle: "Your Order Summary",
  freeDeliverySlotsEnabled: false,
  freeDeliverySlotLimit: 15,
  freeDeliverySlotManualClaimed: 0,
  freeDeliveryResetIntervalMinutes: 1440,
};

const PUBLIC_PRODUCT_CACHE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_PRODUCT_FETCH_ATTEMPTS = 8;
const PUBLIC_PRODUCT_RETRY_DELAY_MS = 1200;
const PUBLIC_OUTAGE_QUEUE_KEY = "protohub.publicOrderOutageQueue";
const RECOVERY_AUTO_SUBMIT_IDLE_MS = 12_000;

type CachedSnapshot<T> = {
  cachedAt: number;
  value: T;
};

function readCachedSnapshot<T>(key: string): CachedSnapshot<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; value?: T };
    if (!parsed || typeof parsed.cachedAt !== "number" || !("value" in parsed)) return null;
    return {
      cachedAt: parsed.cachedAt,
      value: parsed.value as T
    };
  } catch {
    return null;
  }
}

function readCachedValue<T>(key: string, maxAgeMs: number): T | null {
  const snapshot = readCachedSnapshot<T>(key);
  if (!snapshot) return null;
  if (Date.now() - snapshot.cachedAt > maxAgeMs) return null;
  return snapshot.value ?? null;
}

function readCachedValueAnyAge<T>(key: string): T | null {
  return readCachedSnapshot<T>(key)?.value ?? null;
}

function writeCachedValue<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), value }));
  } catch {
    // Ignore cache write failures.
  }
}

function publicProductCacheKey(productId: string) {
  return `protohub.publicProduct.${productId}`;
}

function publicSettingsCacheKey(orgId: string) {
  return `protohub.publicEmbedSettings.${orgId}`;
}

function readQueuedPublicOrders() {
  if (typeof window === "undefined") return [] as QueuedPublicOrderSubmission[];
  try {
    const raw = window.localStorage.getItem(PUBLIC_OUTAGE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as QueuedPublicOrderSubmission[] : [];
  } catch {
    return [];
  }
}

function writeQueuedPublicOrders(value: QueuedPublicOrderSubmission[]) {
  if (typeof window === "undefined") return;
  try {
    if (value.length === 0) {
      window.localStorage.removeItem(PUBLIC_OUTAGE_QUEUE_KEY);
      return;
    }
    window.localStorage.setItem(PUBLIC_OUTAGE_QUEUE_KEY, JSON.stringify(value));
  } catch {
    // Ignore queue persistence failures.
  }
}

const makeCartId = () => `CART-${Math.floor(100000 + Math.random() * 900000)}`;

function activeProductPackages(product: PublicProduct) {
  return [...(product.packages ?? [])]
    .filter((item) => item.active)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

function cleanPackageSetLabel(value?: string | null) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function packageSetKey(value?: string | null) {
  return (cleanPackageSetLabel(value) || "Default").toLowerCase();
}

function packageMatchesSet(pkg: PublicPackage, selectedSet?: string | null) {
  const selected = cleanPackageSetLabel(selectedSet);
  return !selected || packageSetKey(pkg.packageSet) === selected.toLowerCase();
}

function packageVisibleInState(pkg: PublicPackage, state: string) {
  const mode = pkg.stateFilterMode ?? "all";
  if (mode === "all") return true;
  const restrictions = pkg.stateRestrictions ?? [];
  if (restrictions.length === 0) return mode === "block";
  if (!state) return false;
  const normalizedState = normalizeStateName(state);
  const matches = restrictions.map(normalizeStateName).includes(normalizedState);
  return mode === "block" ? !matches : matches;
}

// Per-package unit label override (e.g. "set" / "sets" for combo packs).
// Falls back to "pc" / "pcs" when the package doesn't configure a custom unit.
function packageUnitFor(
  pkg: Pick<PublicPackage, "unitSingular" | "unitPlural"> | null | undefined,
  quantity: number
): string {
  const singular = ((pkg?.unitSingular as string | undefined) ?? "").trim() || "pc";
  const plural = ((pkg?.unitPlural as string | undefined) ?? "").trim() || "pcs";
  return quantity === 1 ? singular : plural;
}

function packageComponentSummary(pkg: PublicPackage, products: PublicProduct[]) {
  const components = pkg.packageComponents ?? [];
  if (components.length === 0) return "";
  return components
    .filter((component) => component.productId || component.product_id)
    // Hide components flagged "hidden from customer" — they still deduct
    // stock, but listing them would just confuse the buyer (e.g. a part
    // already implied by the combo name).
    .filter((component) => !(component.hiddenFromCustomer ?? component.hidden_from_customer))
    .slice(0, 4)
    .map((component) => {
      const productId = component.productId || component.product_id || "";
      const isFreeGift = Boolean(component.isFreeGift ?? component.is_free_gift);
      const productName = products.find((product) => product.id === productId)?.name ?? "Item";
      const qty = Math.max(1, Number(component.quantity) || 1);
      return `${isFreeGift ? "FREE " : ""}${qty} ${packageUnitFor(pkg, qty)} of ${productName}`;
    })
    .join(" + ");
}

function packageFreeGiftItems(pkg: PublicPackage, products: PublicProduct[]) {
  return (pkg.packageComponents ?? [])
    .filter((component) => (component.productId || component.product_id) && Boolean(component.isFreeGift ?? component.is_free_gift))
    .map((component) => {
      const productId = component.productId || component.product_id || "";
      const productName = products.find((product) => product.id === productId)?.name ?? "Free gift";
      const qty = Math.max(1, Number(component.quantity) || 1);
      return {
        id: component.componentId || component.component_id || productId,
        name: productName,
        quantity: qty,
        label: `${qty} ${packageUnitFor(pkg, qty)} of ${productName}`
      };
    });
}

function packageIsComboLike(pkg: PublicPackage) {
  const components = (pkg.packageComponents ?? []).filter((component) => component.productId || component.product_id);
  const paidComponentCount = components.filter((component) => !Boolean(component.isFreeGift ?? component.is_free_gift)).length;
  return Boolean(
    pkg.featuredComboCard ||
      pkg.requiresStateStock ||
      (pkg.stateFilterMode && pkg.stateFilterMode !== "all") ||
      paidComponentCount > 1 ||
      /combo/i.test(pkg.name)
  );
}

function packageImageList(pkg: PublicPackage) {
  return Array.from(new Set([...(pkg.imageUrls ?? []), pkg.imageUrl ?? ""].map((url) => url.trim()).filter(Boolean))).slice(0, 15);
}

function primaryPricing(product: PublicProduct) {
  return product.pricings.find((pricing) => pricing.isPrimary) ?? product.pricings[0];
}

function formatProductMoney(amount: number, code: ProductCurrencyCode) {
  const def = PRODUCT_CURRENCIES[code] ?? PRODUCT_CURRENCIES.NGN;
  return new Intl.NumberFormat(def.locale, {
    style: "currency",
    currency: def.currency,
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function orderSourceFromUtm(source: string) {
  const normalized = source.toLowerCase();
  if (normalized.includes("tiktok")) return "TikTok";
  if (normalized.includes("facebook") || normalized.includes("meta")) return "Facebook";
  if (normalized.includes("whatsapp")) return "WhatsApp";
  return "Website";
}

function orderLocationFromFields(city: string, state: string) {
  const value = `${city} ${state}`.trim();
  if (value.toLowerCase().includes("lagos")) return "Lagos";
  if (value.toLowerCase().includes("abuja")) return "Abuja";
  if (value.toLowerCase().includes("port harcourt")) return "Port Harcourt";
  if (value.toLowerCase().includes("ibadan")) return "Ibadan";
  return city.trim() || state.trim() || "Lagos";
}

function crossSellPriceFor(mainProduct: PublicProduct, crossSellProduct: PublicProduct) {
  const override = mainProduct.crossSellPriceOverrides?.[crossSellProduct.id];
  if (typeof override === "number" && override >= 0) return override;
  return primaryPricing(crossSellProduct)?.sellingPrice ?? 0;
}

function targetPackageForCompanion(companion: PublicCompanion, products: PublicProduct[]) {
  if (!companion.packageId) return null;
  for (const product of products) {
    const target = (product.packages ?? []).find((pkg) => pkg.id === companion.packageId);
    if (target) return target;
  }
  return null;
}

function companionUnitPrice(companion: PublicCompanion, product: PublicProduct, targetPackage?: PublicPackage | null) {
  const standard = targetPackage?.price ?? primaryPricing(product)?.sellingPrice ?? 0;
  if (companion.pricingMode === "free") return 0;
  if (companion.pricingMode === "fixed") return companion.fixedPrice ?? 0;
  return standard;
}

function companionLineTotal(companion: PublicCompanion, product: PublicProduct, targetPackage?: PublicPackage | null) {
  const unit = companionUnitPrice(companion, product, targetPackage);
  return companion.pricingMode === "fixed"
    ? unit
    : unit * Math.max(1, Number(companion.quantity) || 1);
}

function companionVisibleInState(companion: PublicCompanion, state: string) {
  const mode = companion.stateFilterMode ?? "all";
  if (mode === "all") return true;
  if (companion.stateRestrictions.length === 0) return mode === "block";
  if (!state) return false;
  const normalizedState = normalizeStateName(state);
  const matches = companion.stateRestrictions.map(normalizeStateName).includes(normalizedState);
  return mode === "block" ? !matches : matches;
}

function companionIsActive(companion: Pick<PublicCompanion, "active"> | null | undefined) {
  return companion?.active !== false;
}

function companionSelectionKey(companion: { companionId?: string; productId: string; packageId?: string | null }) {
  return companion.companionId?.trim() || `${companion.productId}:${companion.packageId ?? ""}`;
}

function companionDisplayName(companion: PublicCompanion, product: PublicProduct, targetPackage?: PublicPackage | null) {
  return targetPackage ? `${product.name} · ${targetPackage.name}` : product.name;
}

function companionDisplayDetail(companion: PublicCompanion, targetPackage?: PublicPackage | null) {
  if (targetPackage) {
    if (targetPackage.description.trim()) {
      return targetPackage.description.trim();
    }
    return `${companion.quantity} ${companion.quantity === 1 ? "bundle" : "bundles"} · ${targetPackage.quantity} ${targetPackage.quantity === 1 ? "pc" : "pcs"} in this add-on`;
  }
  return `${companion.quantity} ${companion.quantity === 1 ? "pc" : "pcs"} in this add-on`;
}

function companionOfferUnits(companion: PublicCompanion, targetPackage?: PublicPackage | null) {
  const qty = Math.max(1, Number(targetPackage?.quantity ?? companion.quantity) || 1);
  return `${qty}${qty === 1 ? "pc" : "pcs"}`;
}

function companionOfferPriceLabel(
  companion: PublicCompanion,
  total: number,
  currency: ProductCurrencyCode,
  targetPackage?: PublicPackage | null
) {
  const units = companionOfferUnits(companion, targetPackage);
  return companion.pricingMode === "free"
    ? `${units} FREE`
    : `${units} for ${formatProductMoney(total, currency)}`;
}

function companionDiscountPercent(standardTotal: number, offerTotal: number) {
  if (standardTotal <= 0 || offerTotal >= standardTotal) return 0;
  return Math.max(0, Math.round(((standardTotal - offerTotal) / standardTotal) * 100));
}

function formatRelativeActivity(value: string | null | undefined) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "just now";
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) return "just now";
  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.round(diffMs / minuteMs));
    return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.round(diffMs / hourMs));
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.max(1, Math.round(diffMs / dayMs));
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function companionSocialProofUi(companion: PublicCompanion | null | undefined) {
  const proofMode = companion?.proofMode ?? "real";
  if (proofMode === "hidden") {
    return { badgeText: "", stats: [] as string[] };
  }
  if (proofMode === "promo_copy") {
    const formatCount = (value: number) => new Intl.NumberFormat("en-NG").format(value);
    const stats: string[] = [];
    const promoAllTime = typeof companion?.promoAllTimeBuyerCount === "number" ? companion.promoAllTimeBuyerCount : 0;
    const promoLast24 = typeof companion?.promoBuyersLast24HoursCount === "number" ? companion.promoBuyersLast24HoursCount : 0;
    const promoLastAdded = typeof companion?.promoLastAddedRelative === "string" ? companion.promoLastAddedRelative.trim() : "";
    if (promoAllTime > 0) stats.push(`Added to ${formatCount(promoAllTime)} orders`);
    if (promoLast24 > 0) stats.push(`${formatCount(promoLast24)} buyers added this in the last 24 hours`);
    if (promoLastAdded) stats.push(`Last added ${promoLastAdded}`);
    if (stats.length === 0) {
      return {
        badgeText: "Popular additional item",
        stats: ["Buyers often add this before they submit their order"]
      };
    }
    return {
      badgeText: companion?.promoIsMostAdded ? "Most buyers add this" : "Popular additional item",
      stats
    };
  }
  const socialProof = companion?.socialProof;
  if (!socialProof) {
    return { badgeText: "", stats: [] as string[] };
  }
  const formatCount = (value: number) => new Intl.NumberFormat("en-NG").format(value);
  const hasStrongLifetimeProof = socialProof.allTimeBuyerCount >= 20;
  const hasStrongVelocityProof = socialProof.buyersLast24HoursCount >= 4;
  const stats: string[] = [];
  if (hasStrongLifetimeProof) {
    stats.push(`Added to ${formatCount(socialProof.allTimeBuyerCount)} orders`);
  }
  if (hasStrongVelocityProof) {
    stats.push(`${formatCount(socialProof.buyersLast24HoursCount)} buyers added this in the last 24 hours`);
  }
  const relativeLastAdded = formatRelativeActivity(socialProof.lastOrderedAt ?? null);
  if (relativeLastAdded && socialProof.lastOrderedAt && Date.now() - Date.parse(socialProof.lastOrderedAt) <= 12 * 60 * 60 * 1000) {
    stats.push(`Last added ${relativeLastAdded}`);
  }
  if (stats.length === 0) {
    return { badgeText: "", stats: [] as string[] };
  }
  return {
    badgeText: socialProof.isMostAdded && (hasStrongLifetimeProof || hasStrongVelocityProof) ? "Most buyers add this" : "",
    stats
  };
}

function fallbackCompanionImageSrc(productName: string) {
  const safeName = productName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#eff6ff" />
          <stop offset="100%" stop-color="#dbeafe" />
        </linearGradient>
      </defs>
      <rect width="900" height="600" rx="36" fill="url(#bg)" />
      <rect x="48" y="48" width="804" height="504" rx="28" fill="#ffffff" opacity="0.92" />
      <text x="450" y="278" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#0f172a">${safeName}</text>
      <text x="450" y="332" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="600" fill="#475569">Quick add-on preview</text>
    </svg>`
  )}`;
}

function normaliseCompanionVideoUrl(url: string) {
  if (!url.trim()) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("youtube.com")) {
      const videoId = parsed.searchParams.get("v");
      return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
    }
    if (host.includes("youtu.be")) {
      const videoId = parsed.pathname.replace("/", "").trim();
      return videoId ? `https://www.youtube.com/embed/${videoId}` : url;
    }
    if (host.includes("vimeo.com")) {
      const videoId = parsed.pathname.split("/").filter(Boolean).pop();
      return videoId ? `https://player.vimeo.com/video/${videoId}` : url;
    }
    return url;
  } catch {
    return url;
  }
}

function companionEmbedPaddingTop(embedHtml: string) {
  const paddingMatch = embedHtml.match(/padding-top\s*:\s*([0-9.]+)%/i);
  if (paddingMatch?.[1]) {
    return `${paddingMatch[1]}%`;
  }
  const aspectMatch = embedHtml.match(/aspect\s*=\s*["']([0-9.]+)["']/i);
  if (aspectMatch?.[1]) {
    const aspect = Number(aspectMatch[1]);
    if (Number.isFinite(aspect) && aspect > 0) {
      return `${(1 / aspect) * 100}%`;
    }
  }
  return "56.25%";
}

function companionWistiaMediaId(embedHtml: string) {
  const playerMatch = embedHtml.match(/wistia-player[^>]*media-id\s*=\s*["']([^"']+)["']/i);
  if (playerMatch?.[1]) return playerMatch[1];
  const scriptMatch = embedHtml.match(/embed\/([a-z0-9]+)\.js/i);
  return scriptMatch?.[1] ?? null;
}

function companionEmbedDocument(embedHtml: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
        overflow: hidden;
      }
      *, *::before, *::after {
        box-sizing: border-box;
      }
      body > * {
        max-width: 100% !important;
      }
      iframe, video, img, wistia-player {
        max-width: 100% !important;
      }
    </style>
  </head>
  <body>${embedHtml}</body>
</html>`;
}

function companionImageSource(companion: PublicCompanion, targetPackage?: PublicPackage | null) {
  const packageImage = targetPackage?.imageUrls?.find((url) => typeof url === "string" && url.trim()) || targetPackage?.imageUrl || "";
  return companion.displayMode === "showcase"
    ? (packageImage || companion.imageUrl || "")
    : (companion.imageUrl || packageImage || "");
}

function companionShowcaseImageList(companion: PublicCompanion, targetPackage?: PublicPackage | null) {
  return Array.from(new Set([
    ...(targetPackage ? packageImageList(targetPackage) : []),
    companion.imageUrl ?? ""
  ].map((url) => url.trim()).filter(Boolean))).slice(0, 15);
}

function renderCompanionMedia(companion: PublicCompanion, productName: string, targetPackage?: PublicPackage | null) {
  const embedHtml = (companion.embedHtml ?? "").trim();
  if (embedHtml) {
    const paddingTop = companionEmbedPaddingTop(embedHtml);
    const wistiaMediaId = companionWistiaMediaId(embedHtml);
    return (
      <div style={{ position: "relative", width: "100%", paddingTop, borderRadius: 14, overflow: "hidden", background: "#f8fafc" }}>
        {wistiaMediaId ? (
          <iframe
            src={`https://fast.wistia.net/embed/iframe/${wistiaMediaId}?videoFoam=true&seo=false`}
            title={`${productName} video`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent" }}
          />
        ) : (
          <iframe
            srcDoc={companionEmbedDocument(embedHtml)}
            title={`${productName} embed`}
            sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "transparent" }}
          />
        )}
      </div>
    );
  }
  const videoUrl = normaliseCompanionVideoUrl(companion.videoUrl ?? "");
  if (videoUrl) {
    const isDirectVideo = /\.(mp4|webm|ogg)(\?.*)?$/i.test(videoUrl);
    if (isDirectVideo) {
      return (
        <video
          controls
          playsInline
          preload="metadata"
          style={{ width: "100%", borderRadius: 14, background: "#000", maxHeight: 260, objectFit: "cover" }}
          src={videoUrl}
        />
      );
    }
    return (
      <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "#0f172a" }}>
        <iframe
          src={videoUrl}
          title={`${productName} video`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
        />
      </div>
    );
  }
  const imageSrc = companionImageSource(companion, targetPackage).trim();
  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={productName}
        onError={(event) => {
          const target = event.currentTarget;
          if (target.dataset.fallbackApplied === "true") return;
          target.dataset.fallbackApplied = "true";
          target.src = fallbackCompanionImageSrc(productName);
        }}
        style={{ width: "100%", borderRadius: 14, maxHeight: 260, objectFit: "cover", display: "block" }}
      />
    );
  }
  return null;
}

function renderCompanionTeaserVisual(companion: PublicCompanion, productName: string, targetPackage?: PublicPackage | null) {
  const src = companionImageSource(companion, targetPackage).trim() || fallbackCompanionImageSrc(productName);
  return (
    <div style={{ position: "relative", width: "100%", aspectRatio: "1 / 1", borderRadius: 22, overflow: "hidden", background: "#ffffff", border: "1px solid rgba(148, 163, 184, 0.18)" }}>
      <img
        src={src}
        alt={productName}
        onError={(event) => {
          const target = event.currentTarget;
          if (target.dataset.fallbackApplied === "true") return;
          target.dataset.fallbackApplied = "true";
          target.src = fallbackCompanionImageSrc(productName);
        }}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </div>
  );
}

function freeGiftVisibleInState(mainProduct: PublicProduct, giftProduct: PublicProduct, state: string) {
  if (!state) return true;
  const normalizedState = normalizeStateName(state);
  const attachmentRule = mainProduct.freeGiftStateRestrictions?.[giftProduct.id];
  if (attachmentRule && attachmentRule.length > 0) return attachmentRule.map(normalizeStateName).includes(normalizedState);
  const productRule = giftProduct.availableStates;
  if (productRule && productRule.length > 0) return productRule.map(normalizeStateName).includes(normalizedState);
  return true;
}

type PublicFormHiddenContext = Record<string, string | number | boolean | null>;

const PUBLIC_FORM_CONTEXT_VERSION = "2026-05-26.hidden-context.v1";
const PUBLIC_FORM_CLICK_PARAM_KEYS = [
  "fbclid",
  "fbp",
  "fbc",
  "_fbp",
  "_fbc",
  "gclid",
  "gbraid",
  "wbraid",
  "ttclid",
  "msclkid",
  "ad_id",
  "adset_id",
  "campaign_id",
  "media_buyer",
  "media_buyer_id",
  "buyer",
  "buyer_id",
  "landing_page",
  "landing_page_url",
  "placement",
  "utm_id",
  "tracking_mode",
  "meta_pixel_id",
  "meta_tracking_key",
  "meta_test",
  "meta_test_mode",
  "meta_test_event_code",
  "test_event_code"
] as const;

type PublicMetaTrackingMode = "off" | "landing_page" | "protohub" | "hybrid";

function safeHiddenContextValue(value: string | null | undefined, maxLength = 180) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function hiddenContextParamKey(key: string) {
  return key.replace(/^_/, "").replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function publicCookieValue(name: string) {
  if (typeof document === "undefined") return "";
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function parsePublicMetaTrackingMode(value: string | null | undefined): PublicMetaTrackingMode {
  const normalized = (value ?? "").trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "off" || normalized === "disabled" || normalized === "none") return "off";
  if (normalized === "protohub" || normalized === "web_app" || normalized === "webapp" || normalized === "app") return "protohub";
  if (normalized === "hybrid" || normalized === "both") return "hybrid";
  return "landing_page";
}

function parsePublicBoolean(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return ["1", "true", "yes", "on", "test", "dry_run", "dry-run"].includes(normalized);
}

function currentFormLandingPath() {
  if (typeof window === "undefined") return null;
  const hashRoute = window.location.hash ? window.location.hash.split("?")[0] : "";
  return safeHiddenContextValue(`${window.location.pathname}${hashRoute}`, 512);
}

function publicFormDeviceType(viewportWidth: number | null) {
  if (!viewportWidth) return "unknown";
  if (viewportWidth < 640) return "mobile";
  if (viewportWidth < 1024) return "tablet";
  return "desktop";
}

function mergedHiddenContextParams(params: URLSearchParams | null) {
  const merged = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  params?.forEach((value, key) => {
    merged.set(key, value);
  });
  return merged;
}

function buildPublicFormHiddenContext(params: URLSearchParams | null): PublicFormHiddenContext {
  const hasWindow = typeof window !== "undefined";
  const hasNavigator = typeof navigator !== "undefined";
  const hiddenParams = mergedHiddenContextParams(params);
  const viewportWidth = hasWindow ? window.innerWidth : null;
  const viewportHeight = hasWindow ? window.innerHeight : null;
  const screenWidth = hasWindow ? window.screen?.width ?? null : null;
  const screenHeight = hasWindow ? window.screen?.height ?? null : null;
  const context: PublicFormHiddenContext = {
    formVersion: PUBLIC_FORM_CONTEXT_VERSION,
    landingUrl: hasWindow ? safeHiddenContextValue(window.location.href, 2048) : null,
    landingPath: currentFormLandingPath(),
    clientTimezone: safeHiddenContextValue(Intl.DateTimeFormat().resolvedOptions().timeZone, 120),
    clientLocale: hasNavigator ? safeHiddenContextValue(navigator.language, 80) : null,
    viewportWidth,
    viewportHeight,
    screenWidth,
    screenHeight,
    deviceType: publicFormDeviceType(viewportWidth),
    platform: hasNavigator ? safeHiddenContextValue(navigator.platform, 120) : null,
    userAgent: hasNavigator ? safeHiddenContextValue(navigator.userAgent, 320) : null,
    touchCapable: hasNavigator ? (navigator.maxTouchPoints ?? 0) > 0 : null
  };

  for (const key of PUBLIC_FORM_CLICK_PARAM_KEYS) {
    context[hiddenContextParamKey(key)] = safeHiddenContextValue(hiddenParams.get(key), 180);
  }
  context.fbp = context.fbp || safeHiddenContextValue(publicCookieValue("_fbp"), 180);
  context.fbc = context.fbc || safeHiddenContextValue(publicCookieValue("_fbc"), 180);

  return context;
}

export default function PublicOrderFormPage() {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const params = useMemo(
    () => (hash.startsWith("#/order-form/embed") ? new URLSearchParams(hash.split("?")[1] ?? "") : null),
    [hash]
  );
  const publicProductId = params?.get("product") ?? "";
  const rawPublicCurrency = params?.get("currency") ?? "NGN";
  const publicCurrency: ProductCurrencyCode = rawPublicCurrency === "USD" || rawPublicCurrency === "GBP" ? rawPublicCurrency : "NGN";
  const publicUtmSource = (params?.get("utm_source") ?? "direct").slice(0, 100);
  const publicUtmCampaign = (params?.get("utm_campaign") ?? "embed").slice(0, 100);
  const publicUtmMedium = (params?.get("utm_medium") ?? "").slice(0, 100);
  const publicUtmContent = (params?.get("utm_content") ?? "").slice(0, 100);
  const publicUtmTerm = (params?.get("utm_term") ?? "").slice(0, 100);
  const publicEmbedLabel = (params?.get("embed_label") ?? "").trim().slice(0, 120);
  const publicPackageSet = cleanPackageSetLabel(params?.get("package_set") ?? params?.get("packageSet") ?? "");
  const publicMetaTrackingMode = parsePublicMetaTrackingMode(params?.get("tracking_mode") ?? params?.get("trackingMode"));
  const publicMetaPixelId = (params?.get("meta_pixel_id") ?? params?.get("metaPixelId") ?? "").trim().slice(0, 80);
  const publicMetaTrackingKey = (params?.get("meta_tracking_key") ?? params?.get("metaTrackingKey") ?? "").trim().slice(0, 120);
  const publicMetaTestEventCode = (params?.get("meta_test_event_code") ?? params?.get("metaTestEventCode") ?? params?.get("test_event_code") ?? params?.get("testEventCode") ?? "").trim().slice(0, 80);
  const publicMetaTestMode = parsePublicBoolean(params?.get("meta_test") ?? params?.get("metaTest") ?? params?.get("meta_test_mode") ?? params?.get("metaTestMode")) || Boolean(publicMetaTestEventCode);
  const publicEmbedIsPreview = params?.get("preview") === "1";
  const publicEmbedIsLocalTest = publicEmbedIsPreview && typeof window !== "undefined" && (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.hostname === "::1"
  );
  const rawPublicRedirect = params?.get("redirect_url") ?? "";
  const publicRedirectUrl = useMemo(() => {
    if (!rawPublicRedirect) return "";
    try {
      const u = new URL(rawPublicRedirect);
      return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
    } catch {
      return "";
    }
  }, [rawPublicRedirect]);

  const cachedProductBundle = publicProductId
    ? readCachedValue<{ products: PublicProduct[]; orgId: string | null }>(
        publicProductCacheKey(publicProductId),
        PUBLIC_PRODUCT_CACHE_TTL_MS
      )
    : null;
  const staleProductBundle = !cachedProductBundle && publicProductId
    ? readCachedValueAnyAge<{ products: PublicProduct[]; orgId: string | null }>(
        publicProductCacheKey(publicProductId)
      )
    : null;
  const bootProductBundle = cachedProductBundle ?? staleProductBundle;
  const cachedSettings = bootProductBundle?.orgId
    ? readCachedValue<PublicEmbedSettings>(
        publicSettingsCacheKey(bootProductBundle.orgId),
        PUBLIC_SETTINGS_CACHE_TTL_MS
      )
    : null;
  const staleSettings = !cachedSettings && bootProductBundle?.orgId
    ? readCachedValueAnyAge<PublicEmbedSettings>(publicSettingsCacheKey(bootProductBundle.orgId))
    : null;
  const bootSettings = cachedSettings ?? staleSettings;

  const [products, setProducts] = useState<PublicProduct[]>(() => bootProductBundle?.products ?? []);
  const [settings, setSettings] = useState<PublicEmbedSettings>(() => ({ ...DEFAULT_SETTINGS, ...(bootSettings ?? {}) }));
  const [loading, setLoading] = useState(Boolean(publicProductId) && !(bootProductBundle?.products?.length));
  const [showLoading, setShowLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [publicOrderSubmitted, setPublicOrderSubmitted] = useState<PublicOrderSubmissionState | null>(null);
  const [publicOrderSubmitting, setPublicOrderSubmitting] = useState(false);
  const [publicUpsellSubmitting, setPublicUpsellSubmitting] = useState(false);
  const [publicUpsellOffer, setPublicUpsellOffer] = useState<PendingUpsellOffer | null>(null);
  const [packageAvailabilityById, setPackageAvailabilityById] = useState<Record<string, PublicPackageAvailability>>({});
  const [packageAvailabilityLoading, setPackageAvailabilityLoading] = useState(false);
  const [freeDeliverySlotStatus, setFreeDeliverySlotStatus] = useState<PublicFreeDeliverySlotStatus | null>(null);
  const [abandonedDraftCartId, setAbandonedDraftCartId] = useState("");
  const [packageCarouselIndexById, setPackageCarouselIndexById] = useState<Record<string, number>>({});
  const [companionCarouselIndexByKey, setCompanionCarouselIndexByKey] = useState<Record<string, number>>({});
  const [isCompactUpsellViewport, setIsCompactUpsellViewport] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 680px)").matches : false
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<PublicOrderFieldKey, string>>>({});
  const [submitRetryArmed, setSubmitRetryArmed] = useState(false);
  const [animatedInvalidField, setAnimatedInvalidField] = useState<PublicOrderFieldKey | null>(null);
  const [submitButtonAttention, setSubmitButtonAttention] = useState(false);

  const [orderFormName, setOrderFormName] = useState("");
  const [orderFormPhone, setOrderFormPhone] = useState("");
  const [orderFormWhatsapp, setOrderFormWhatsapp] = useState("");
  const [orderFormEmail, setOrderFormEmail] = useState("");
  const [orderFormAddress, setOrderFormAddress] = useState("");
  const [orderFormCity, setOrderFormCity] = useState("");
  const [orderFormState, setOrderFormState] = useState("");
  const [orderFormPackageId, setOrderFormPackageId] = useState("");
  const [orderFormCrossSells, setOrderFormCrossSells] = useState<CrossSellSelection[]>([]);
  const [expandedCardCompanionProductId, setExpandedCardCompanionProductId] = useState<string | null>(null);
  const [lastAdditionalItemActionKey, setLastAdditionalItemActionKey] = useState("");
  const [publicHoneypot, setPublicHoneypot] = useState("");
  const [orderFormConfirmed, setOrderFormConfirmed] = useState(false);
  const [orderFormCommitmentAccepted, setOrderFormCommitmentAccepted] = useState(false);
  const [orderFormDeliveryWindow, setOrderFormDeliveryWindow] = useState("");

  const cartSyncTimerRef = useRef<number | null>(null);
  // Tracks the packageId most recently sent to /api/public/carts. When the
  // chosen package shifts (tier hop), the cart-sync effect uses a short
  // debounce so the admin's "Selected Package" pane keeps up with the live
  // journey timeline; field-only edits still get the full 1.5s coalescing.
  const lastSyncedPackageIdRef = useRef<string>("");
  const autoSubmitTimerRef = useRef<number | null>(null);
  const redirectTimerRef = useRef<number | null>(null);
  const publicOrderSubmittingRef = useRef(false);
  const abandonedDraftCartIdRef = useRef("");
  const formOpenedAtRef = useRef(Date.now());
  const journeyDedupRef = useRef<Set<string>>(new Set());
  const metaEventIdsRef = useRef<Record<string, string>>({});
  const metaBrowserEventsSentRef = useRef<Set<string>>(new Set());
  const lastMetaPurchaseEventIdRef = useRef("");
  const previousCrossSellKeysRef = useRef<string[]>([]);
  const lastTrackedPackageIdRef = useRef("");
  const lastTrackedStateRef = useRef("");
  const lastExpandedCardProductIdRef = useRef<string | null>(null);
  const firstInteractionTrackedRef = useRef(false);
  const exitTrackedRef = useRef(false);
  // Next-level journey tracking refs.
  const lastFieldTouchedRef = useRef<string>("");
  const fieldTypingValueRef = useRef<Partial<Record<string, string>>>({});
  // High-water mark of each field's length since it was last empty. Used so
  // field_hesitated still fires when the user backspaces character-by-character
  // (without this, "previous" at the clear-moment is only ~1 char and never
  // satisfies the >= 3 threshold).
  const fieldMaxLengthRef = useRef<Partial<Record<string, number>>>({});
  const fieldHesitationTrackedRef = useRef<Set<string>>(new Set());
  const submitIdleTimerRef = useRef<number | null>(null);
  const submitIdleFiredRef = useRef(false);
  const lastTrackedImageIndexRef = useRef<Record<string, number>>({});
  const imageDwellTimersRef = useRef<Record<string, number>>({});
  const backButtonFiredRef = useRef(false);
  const backSentinelPushedRef = useRef(false);
  const tierSwitchCountRef = useRef(0);
  const fieldRefs = useRef<Partial<Record<PublicOrderFieldKey, HTMLElement | null>>>({});
  const submitActionRef = useRef<HTMLDivElement | null>(null);
  const additionalItemNextStepRef = useRef<HTMLDivElement | null>(null);
  const publicReferrer = (typeof document !== "undefined" ? document.referrer : "") || "";
  const publicJourneyFormContext = useMemo(() => {
    const context = buildPublicFormHiddenContext(params);
    return {
      formVersion: context.formVersion,
      landingUrl: context.landingUrl,
      landingPath: context.landingPath,
      clientTimezone: context.clientTimezone,
      clientLocale: context.clientLocale,
      deviceType: context.deviceType,
      viewportWidth: context.viewportWidth,
      viewportHeight: context.viewportHeight,
      fbclid: context.fbclid,
      gclid: context.gclid,
      gbraid: context.gbraid,
      wbraid: context.wbraid,
      ttclid: context.ttclid,
      msclkid: context.msclkid,
      adId: context.adId,
      adsetId: context.adsetId,
      campaignId: context.campaignId,
      fbp: context.fbp,
      fbc: context.fbc,
      placement: context.placement,
      utmId: context.utmId,
      trackingMode: context.trackingMode,
      metaTrackingKey: context.metaTrackingKey,
      metaTestMode: context.metaTestMode || context.metaTest,
      metaTestEventCode: context.metaTestEventCode || context.testEventCode
    };
  }, [params]);
  const buildPublicFormContext = useCallback((contextEvent: string): PublicFormHiddenContext => ({
    ...buildPublicFormHiddenContext(params),
    contextEvent: safeHiddenContextValue(contextEvent, 80),
    secondsSinceOpen: Math.max(0, Math.round((Date.now() - formOpenedAtRef.current) / 1000))
  }), [params]);
  const getMetaEventId = useCallback((kind: "Lead" | "Purchase", seed?: string) => {
    const key = `${kind}:${seed || "current"}`;
    if (metaEventIdsRef.current[key]) return metaEventIdsRef.current[key];
    const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const cleanSeed = seed ? seed.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) : "current";
    const eventId = `protohub_${kind.toLowerCase()}_${cleanSeed}_${randomPart}`;
    metaEventIdsRef.current[key] = eventId.slice(0, 120);
    return metaEventIdsRef.current[key];
  }, []);
  const postMetaBrowserEvent = useCallback((
    eventName: "Lead" | "Purchase",
    eventId: string,
    customData: Record<string, unknown>
  ) => {
    if (publicEmbedIsPreview || !eventId || publicMetaTrackingMode === "off" || publicMetaTrackingMode === "landing_page") return;
    const dedupeKey = `${eventName}:${eventId}`;
    if (metaBrowserEventsSentRef.current.has(dedupeKey)) return;
    metaBrowserEventsSentRef.current.add(dedupeKey);
    try {
      window.parent?.postMessage({
        type: "ordo-meta-event",
        eventName,
        eventId,
        pixelId: publicMetaPixelId || null,
        trackingMode: publicMetaTrackingMode,
        testMode: publicMetaTestMode,
        testEventCode: publicMetaTestEventCode || null,
        customData
      }, "*");
    } catch {
      // Browser-side Meta bridge is best-effort only.
    }
  }, [publicEmbedIsPreview, publicMetaPixelId, publicMetaTestEventCode, publicMetaTestMode, publicMetaTrackingMode]);
  const publicJourneyAttributionMetadata = useMemo(
    () => ({
      source: orderSourceFromUtm(publicUtmSource),
      utmSource: publicUtmSource || null,
      utmCampaign: publicUtmCampaign || null,
      utmMedium: publicUtmMedium || null,
      utmContent: publicUtmContent || null,
      utmTerm: publicUtmTerm || null,
      referrer: publicReferrer || null,
      embedLabel: publicEmbedLabel || null,
      ...publicJourneyFormContext
    }),
    [
      publicEmbedLabel,
      publicJourneyFormContext,
      publicReferrer,
      publicUtmCampaign,
      publicUtmContent,
      publicUtmMedium,
      publicUtmSource,
      publicUtmTerm
    ]
  );

  const publicProduct = useMemo(
    () => products.find((product) => product.id === publicProductId),
    [products, publicProductId]
  );
  const publicPackages = useMemo(
    () => (publicProduct ? activeProductPackages(publicProduct).filter((pkg) => packageMatchesSet(pkg, publicPackageSet)) : []),
    [publicPackageSet, publicProduct]
  );
  const normalizedSelectedState = normalizeStateName(orderFormState);
  const packagesNeedAvailability = publicPackages.some((pkg) =>
    (pkg.stateFilterMode ?? "all") !== "all" || pkg.requiresStateStock
  );
  const orderablePublicPackages = useMemo(
    () => publicPackages.filter((pkg) => {
      if (!packageVisibleInState(pkg, normalizedSelectedState)) return false;
      if (!pkg.requiresStateStock) return true;
      if (!normalizedSelectedState) return false;
      return packageAvailabilityById[pkg.id]?.visible === true;
    }),
    [normalizedSelectedState, packageAvailabilityById, publicPackages]
  );
  const chosenPackage = orderablePublicPackages.find((item) => item.id === orderFormPackageId)
    ?? orderablePublicPackages[0]
    ?? (packagesNeedAvailability ? undefined : publicPackages[0]);
  const chosenPackagePrice = chosenPackage?.price ?? 0;
  const chosenPackageCurrency = chosenPackage?.currency ?? publicPackages[0]?.currency ?? "NGN";
  // If the chosen package has an attribution_product_id (combo bundle
  // sitting under a single-tool parent), display + cart capture use
  // the attribution product. The backend ALSO overrides product_id/
  // product_name at order create so analytics/inventory/SMS roll up
  // there too. Migration 088.
  const chosenAttributionProduct = chosenPackage?.attributionProductId
    ? products.find((p) => p.id === chosenPackage.attributionProductId) ?? null
    : null;
  const chosenProductName = chosenAttributionProduct?.name ?? publicProduct?.name ?? "";
  const chosenProductId   = chosenAttributionProduct?.id   ?? publicProduct?.id   ?? "";
  // Smart headline: prefix the chosen package with its quantity so the
  // customer reads "10 pcs of Edge Brusher Max · ⭐ MOST POPULAR" instead
  // of just "Edge Brusher Max · ⭐ MOST POPULAR". For combos (qty represents
  // number of sets), it reads "4 sets of Home Cleaning Tools · Best Value 💎".
  const chosenPackageQtyLabel = chosenPackage && chosenPackage.quantity > 0
    ? `${chosenPackage.quantity} ${packageUnitFor(chosenPackage, chosenPackage.quantity)} of ${chosenProductName}`
    : chosenProductName;
  const chosenPackageHeadline = chosenPackage
    ? `${chosenPackageQtyLabel} · ${chosenPackage.name}`
    : "";
  const fieldErrorEntries = Object.entries(fieldErrors).filter((entry): entry is [PublicOrderFieldKey, string] => Boolean(entry[1]));
  const guidedCheckout = settings.publicFormMode === "guided_checkout";
  const phoneDigits = orderFormPhone.replace(/\D/g, "");
  const whatsappDigits = sanitizePhoneDigitsInput(orderFormWhatsapp);
  const phoneValid = phoneDigits.length >= 7 && phoneDigits.length <= 15;
  const whatsappValid = !orderFormWhatsapp.trim() || (whatsappDigits.length >= 7 && whatsappDigits.length <= 15);
  const contactStepComplete = !!orderFormName.trim()
    && phoneValid
    && (!settings.showWhatsapp || !settings.requireWhatsapp || !!whatsappDigits)
    && whatsappValid;
  const deliveryStepComplete = !!orderFormState.trim()
    && (!settings.addressRequired || !!orderFormAddress.trim())
    && (!settings.cityRequired || !!orderFormCity.trim())
    && (!settings.askDelivery || !!orderFormDeliveryWindow.trim())
    && (!settings.requireConfirmation || orderFormConfirmed)
    && (!settings.showCommitment || settings.allowDisagree || orderFormCommitmentAccepted);
  const reviewStepReady = !!chosenPackage && contactStepComplete && deliveryStepComplete;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 680px)");
    const syncViewport = () => setIsCompactUpsellViewport(mediaQuery.matches);
    syncViewport();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncViewport);
      return () => mediaQuery.removeEventListener("change", syncViewport);
    }
    mediaQuery.onchange = syncViewport;
    return () => {
      mediaQuery.onchange = null;
    };
  }, []);

  useEffect(() => {
    if (!publicProductId || !packagesNeedAvailability || !normalizedSelectedState) {
      setPackageAvailabilityById({});
      setPackageAvailabilityLoading(false);
      return;
    }
    let cancelled = false;
    setPackageAvailabilityLoading(true);
    productsApi.publicPackageAvailability(publicProductId, normalizedSelectedState, publicPackageSet)
      .then((response) => {
        if (cancelled) return;
        setPackageAvailabilityById(Object.fromEntries((response.packages ?? []).map((row) => [row.packageId, row])));
      })
      .catch(() => {
        if (cancelled) return;
        setPackageAvailabilityById({});
      })
      .finally(() => {
        if (!cancelled) setPackageAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [normalizedSelectedState, packagesNeedAvailability, publicPackageSet, publicProductId]);

  useEffect(() => {
    if (!publicProductId || !settings.freeDeliverySlotsEnabled) {
      setFreeDeliverySlotStatus(null);
      return;
    }

    let cancelled = false;
    productsApi.publicFreeDeliverySlots(publicProductId)
      .then((status) => {
        if (!cancelled) setFreeDeliverySlotStatus(status);
      })
      .catch(() => {
        if (!cancelled) setFreeDeliverySlotStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, [publicProductId, publicOrderSubmitted?.orderId, settings.freeDeliverySlotsEnabled]);

  const setFieldRef = (field: PublicOrderFieldKey) => (element: HTMLElement | null) => {
    fieldRefs.current[field] = element;
  };

  const clearFieldError = (field: PublicOrderFieldKey) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setAnimatedInvalidField((current) => (current === field ? null : current));
  };

  const buildSubmitValidationErrors = (): Partial<Record<PublicOrderFieldKey, string>> => {
    const phoneDigits = orderFormPhone.replace(/\D/g, "");
    const whatsappDigits = sanitizePhoneDigitsInput(orderFormWhatsapp);
    const nextErrors: Partial<Record<PublicOrderFieldKey, string>> = {};
    if (!orderFormName.trim()) nextErrors.name = "Customer name is required.";
    if (!orderFormPhone.trim()) {
      nextErrors.phone = "Phone number is required.";
    } else if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      nextErrors.phone = "Please enter a valid phone number.";
    }
    if (settings.showWhatsapp && settings.requireWhatsapp && !whatsappDigits) {
      nextErrors.whatsapp = "WhatsApp number is required.";
    } else if (orderFormWhatsapp.trim() && (whatsappDigits.length < 7 || whatsappDigits.length > 15)) {
      nextErrors.whatsapp = "Please enter a valid WhatsApp number.";
    }
    if (settings.addressRequired && !orderFormAddress.trim()) nextErrors.address = "Delivery address is required.";
    if (settings.cityRequired && !orderFormCity.trim()) nextErrors.city = "City is required.";
    if (!orderFormState.trim()) nextErrors.state = "Please select your state.";
    if (settings.askDelivery && !orderFormDeliveryWindow.trim()) nextErrors.delivery = "Please select a delivery time.";
    if (settings.requireConfirmation && !orderFormConfirmed) nextErrors.confirmation = "Please confirm before submitting.";
    if (settings.showCommitment && !settings.allowDisagree && !orderFormCommitmentAccepted) {
      nextErrors.commitment = "Please acknowledge the commitment fee notice.";
    }
    return nextErrors;
  };

  const fieldErrorsEqual = (
    left: Partial<Record<PublicOrderFieldKey, string>>,
    right: Partial<Record<PublicOrderFieldKey, string>>
  ) => {
    const leftKeys = Object.keys(left) as PublicOrderFieldKey[];
    const rightKeys = Object.keys(right) as PublicOrderFieldKey[];
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => left[key] === right[key]);
  };

  const focusField = (field: PublicOrderFieldKey) => {
    const target = fieldRefs.current[field];
    if (!target) return;
    try {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // Ignore scroll errors in embedded browsers.
    }
    window.setTimeout(() => {
      if (typeof (target as any).focus === "function") {
        try {
          (target as any).focus({ preventScroll: true });
        } catch {
          (target as any).focus?.();
        }
      }
    }, 90);
  };

  const scrollAdditionalItemNextStepIntoView = () => {
    window.setTimeout(() => {
      const target = additionalItemNextStepRef.current ?? submitActionRef.current;
      if (!target) return;
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        // Some embedded browsers do not support smooth scroll.
      }
    }, 160);
  };

  const inputErrorStyle = (field: PublicOrderFieldKey) => (
    fieldErrors[field] || animatedInvalidField === field
      ? {
          borderColor: "#ef4444",
          boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.14)",
          background: "#fffafa",
          ...(animatedInvalidField === field
            ? { animation: "publicInvalidFieldAlert 0.7s ease" }
            : {})
        }
      : undefined
  );

  const optionGroupErrorStyle = (field: PublicOrderFieldKey) => (
    fieldErrors[field] || animatedInvalidField === field
      ? {
          borderColor: "#ef4444",
          boxShadow: "0 0 0 3px rgba(239, 68, 68, 0.12)",
          ...(animatedInvalidField === field
            ? { animation: "publicInvalidFieldAlert 0.7s ease" }
            : {})
        }
      : undefined
  );

  const triggerValidationAttention = (field: PublicOrderFieldKey) => {
    setAnimatedInvalidField(null);
    setSubmitButtonAttention(false);
    window.setTimeout(() => {
      setAnimatedInvalidField(field);
      setSubmitButtonAttention(true);
    }, 0);
  };

  const attemptRecoveredAutoSubmit = useCallback(
    (reason: "idle" | "leaving") => {
      if (publicOrderSubmittingRef.current || publicOrderSubmitting) return false;
      const nextErrors = buildSubmitValidationErrors();
      setFieldErrors((current) => (fieldErrorsEqual(current, nextErrors) ? current : nextErrors));
      if (Object.keys(nextErrors).length > 0) {
        return false;
      }
      setSubmitRetryArmed(false);
      if (reason === "idle") {
        showToast("All required fields complete — submitting your order now...");
      }
      void submitPublicOrder();
      return true;
    },
    [
      buildSubmitValidationErrors,
      fieldErrorsEqual,
      publicOrderSubmitting,
      submitPublicOrder
    ]
  );

  useEffect(() => {
    if (!submitRetryArmed) {
      if (autoSubmitTimerRef.current) {
        window.clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      return;
    }
    if (publicOrderSubmitting) return;
    const nextErrors = buildSubmitValidationErrors();
    setFieldErrors((current) => (fieldErrorsEqual(current, nextErrors) ? current : nextErrors));
    if (Object.keys(nextErrors).length > 0) {
      if (autoSubmitTimerRef.current) {
        window.clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
      return;
    }
    if (autoSubmitTimerRef.current) {
      window.clearTimeout(autoSubmitTimerRef.current);
    }
    autoSubmitTimerRef.current = window.setTimeout(() => {
      autoSubmitTimerRef.current = null;
      attemptRecoveredAutoSubmit("idle");
    }, RECOVERY_AUTO_SUBMIT_IDLE_MS);
    return () => {
      if (autoSubmitTimerRef.current) {
        window.clearTimeout(autoSubmitTimerRef.current);
        autoSubmitTimerRef.current = null;
      }
    };
  }, [
    orderFormAddress,
    orderFormCity,
    orderFormCommitmentAccepted,
    orderFormConfirmed,
    orderFormDeliveryWindow,
    orderFormName,
    orderFormPhone,
    orderFormState,
    orderFormWhatsapp,
    publicOrderSubmitting,
    settings.addressRequired,
    settings.allowDisagree,
    settings.askDelivery,
    settings.cityRequired,
    settings.requireConfirmation,
    settings.requireWhatsapp,
    settings.showCommitment,
    settings.showWhatsapp,
    attemptRecoveredAutoSubmit,
    submitRetryArmed
  ]);

  const ensureDraftCartId = () => {
    if (publicEmbedIsPreview) return "";
    if (abandonedDraftCartIdRef.current) return abandonedDraftCartIdRef.current;
    const nextId = makeCartId();
    abandonedDraftCartIdRef.current = nextId;
    setAbandonedDraftCartId(nextId);
    if (publicProduct && chosenPackage) {
      const dedupeKey = `form_opened:${nextId}`;
      journeyDedupRef.current.add(dedupeKey);
      cartsApi.trackPublicJourney(
        nextId,
        {
          productId: publicProduct.id,
          packageId: chosenPackage.id,
          state: orderFormState.trim() || undefined,
          eventType: "form_opened",
          metadata: {
            productName: publicProduct.name,
            packageName: chosenPackage.name,
            ...publicJourneyAttributionMetadata,
            secondsSinceOpen: Math.max(0, Math.round((Date.now() - formOpenedAtRef.current) / 1000))
          }
        }
      ).catch(() => {
        // Journey tracking is best-effort only.
      });
    }
    return nextId;
  };

  const trackCartJourney = (
    eventType: PublicCartJourneyEventType,
    options?: {
      cartId?: string;
      dedupeKey?: string;
      packageId?: string;
      state?: string;
      companionProductId?: string;
      companionPackageId?: string;
      metadata?: Record<string, string | number | boolean | null>;
      keepalive?: boolean;
    }
  ) => {
    if (publicEmbedIsPreview || !publicProduct) return;
    const cartId = options?.cartId ?? ensureDraftCartId();
    if (!cartId) return;
    const dedupeKey = options?.dedupeKey?.trim();
    if (dedupeKey && journeyDedupRef.current.has(dedupeKey)) return;
    if (dedupeKey) journeyDedupRef.current.add(dedupeKey);

    cartsApi.trackPublicJourney(
      cartId,
      {
        productId: publicProduct.id,
        packageId: options?.packageId ?? chosenPackage?.id ?? undefined,
        state: options?.state ?? (orderFormState.trim() || undefined),
        eventType,
        companionProductId: options?.companionProductId,
        companionPackageId: options?.companionPackageId,
        metadata: {
          ...publicJourneyAttributionMetadata,
          secondsSinceOpen: Math.max(0, Math.round((Date.now() - formOpenedAtRef.current) / 1000)),
          ...(options?.metadata ?? {})
        }
      },
      { keepalive: options?.keepalive === true }
    ).catch(() => {
      // Journey tracking is best-effort only.
    });
  };

  const trackSubmitBlocked = (
    eventType:
      | "submit_blocked_missing_name"
      | "submit_blocked_missing_phone"
      | "submit_blocked_invalid_phone"
      | "submit_blocked_missing_whatsapp"
      | "submit_blocked_invalid_whatsapp"
      | "submit_blocked_missing_address"
      | "submit_blocked_missing_city"
      | "submit_blocked_missing_state"
      | "submit_blocked_missing_delivery"
      | "submit_blocked_missing_confirmation"
      | "submit_blocked_missing_commitment",
    message: string
  ) => {
    const cartId = abandonedDraftCartIdRef.current || ensureDraftCartId();
    trackCartJourney(eventType, {
      cartId: cartId || undefined,
      dedupeKey: `${eventType}:${cartId || "draft"}`,
      metadata: {
        customerName: orderFormName.trim() || null,
        message,
        additionalItems: orderFormCrossSells.length
      }
    });
  };

  const companionForSelection = (selection: CrossSellSelection) =>
    chosenPackage?.companionProducts?.find((companion) =>
      companionIsActive(companion)
      && companionSelectionKey(companion) === companionSelectionKey(selection)
      && companionVisibleInState(companion, orderFormState)
    );

  const selectedCrossSellLines = orderFormCrossSells
    .map((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product || !chosenPackage || !publicProduct) return null;
      const companion = companionForSelection(line);
      if (companion) {
        const targetPackage = targetPackageForCompanion(companion, products);
        return {
          productId: product.id,
          packageId: targetPackage?.id ?? companion.packageId ?? undefined,
          packageName: targetPackage?.name ?? undefined,
          name: companionDisplayName(companion, product, targetPackage),
          detail: companionDisplayDetail(companion, targetPackage),
          qty: companion.quantity,
          total: companionLineTotal(companion, product, targetPackage)
        };
      }
      const unit = crossSellPriceFor(publicProduct, product);
      return {
        productId: product.id,
        packageId: line.packageId ?? undefined,
        packageName: undefined,
        name: product.name,
        detail: `${line.quantity} ${line.quantity === 1 ? "pc" : "pcs"} in this additional item`,
        qty: line.quantity,
        total: unit * line.quantity
      };
    })
    .filter(Boolean) as { name: string; detail?: string; qty: number; total: number }[];

  const autoCompanionLines = (chosenPackage?.companionProducts ?? [])
    .filter(companionIsActive)
    .filter((companion) => companion.autoInclude)
    .filter((companion) => companionVisibleInState(companion, orderFormState))
    .map((companion) => {
      const product = products.find((item) => item.id === companion.productId);
      if (!product) return null;
      const targetPackage = targetPackageForCompanion(companion, products);
      return {
        productId: product.id,
        packageId: targetPackage?.id ?? companion.packageId ?? undefined,
        packageName: targetPackage?.name ?? undefined,
        name: `${companionDisplayName(companion, product, targetPackage)} (bundled)`,
        detail: companionDisplayDetail(companion, targetPackage),
        qty: companion.quantity,
        total: companionLineTotal(companion, product, targetPackage)
      };
    })
    .filter(Boolean) as { name: string; detail?: string; qty: number; total: number }[];

  const summaryGiftLines = publicProduct
    ? (publicProduct.freeGiftProductIds ?? [])
        .map((giftId) => products.find((item) => item.id === giftId))
        .filter((gift): gift is PublicProduct => Boolean(gift && freeGiftVisibleInState(publicProduct, gift, orderFormState)))
    : [];

  const summaryTotal = chosenPackagePrice
    + selectedCrossSellLines.reduce((sum, line) => sum + line.total, 0)
    + autoCompanionLines.reduce((sum, line) => sum + line.total, 0);

  useEffect(() => {
    if (publicEmbedIsPreview) {
      setAbandonedDraftCartId("");
      abandonedDraftCartIdRef.current = "";
      firstInteractionTrackedRef.current = false;
    }
  }, [publicEmbedIsPreview, publicProductId]);

  useEffect(() => {
    abandonedDraftCartIdRef.current = abandonedDraftCartId;
  }, [abandonedDraftCartId]);

  useEffect(() => {
    if (!animatedInvalidField && !submitButtonAttention) return;
    const timer = window.setTimeout(() => {
      setAnimatedInvalidField(null);
      setSubmitButtonAttention(false);
    }, 850);
    return () => window.clearTimeout(timer);
  }, [animatedInvalidField, submitButtonAttention]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (publicUpsellOffer || publicOrderSubmittingRef.current) return;
    let cancelled = false;
    const flushQueue = async () => {
      const queued = readQueuedPublicOrders();
      if (!queued.length) return;
      const nextQueue: QueuedPublicOrderSubmission[] = [];
      for (const entry of queued) {
        try {
          const created = await publicOrdersApi.create(entry.body);
          if (
            !cancelled
            && publicOrderSubmitted
            && publicOrderSubmitted.mode === "browser_queue"
            && publicOrderSubmitted.orderId === entry.id
          ) {
            showToast("Your saved request has now been submitted successfully.");
            finishPublicOrderJourney(created.id, entry.customer, { heldForReview: Boolean(created.reviewHold) });
          }
        } catch (error: any) {
          if (shouldCapturePublicOrderOutage(error)) {
            nextQueue.push(entry);
          }
        }
      }
      if (!cancelled) {
        writeQueuedPublicOrders(nextQueue);
      }
    };

    flushQueue();
    const intervalId = window.setInterval(flushQueue, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [publicOrderSubmitted, publicUpsellOffer]);

  useEffect(() => {
    if (!loading || publicProduct) {
      setShowLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShowLoading(true), 900);
    return () => window.clearTimeout(id);
  }, [loading, publicProduct]);

  useEffect(() => {
    if (!params) return;
    const send = () => {
      const height = document.documentElement.scrollHeight;
      try {
        window.parent.postMessage({ type: "ordo-resize", height }, "*");
      } catch {
        // Ignore parent-window messaging errors.
      }
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [params, publicOrderSubmitted, publicUpsellOffer, loading, orderFormCrossSells.length, orderFormPackageId, orderFormState]);

  useEffect(() => {
    if (!publicProductId) {
      setProducts([]);
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      setLoadError("Missing product id.");
      return;
    }

    const freshBundle = readCachedValue<{ products: PublicProduct[]; orgId: string | null }>(
      publicProductCacheKey(publicProductId),
      PUBLIC_PRODUCT_CACHE_TTL_MS
    );
    const staleBundle = !freshBundle
      ? readCachedValueAnyAge<{ products: PublicProduct[]; orgId: string | null }>(publicProductCacheKey(publicProductId))
      : null;
    const bootBundle = freshBundle ?? staleBundle;
    const cachedBundleProducts = bootBundle?.products ?? [];
    const cachedOrgId = bootBundle?.orgId ?? null;
    const freshOrgSettings = cachedOrgId
      ? readCachedValue<PublicEmbedSettings>(publicSettingsCacheKey(cachedOrgId), PUBLIC_SETTINGS_CACHE_TTL_MS)
      : null;
    const staleOrgSettings = !freshOrgSettings && cachedOrgId
      ? readCachedValueAnyAge<PublicEmbedSettings>(publicSettingsCacheKey(cachedOrgId))
      : null;
    const cachedOrgSettings = freshOrgSettings ?? staleOrgSettings;

    let cancelled = false;
    setProducts(cachedBundleProducts);
    setSettings({ ...DEFAULT_SETTINGS, ...(cachedOrgSettings ?? {}) });
    setLoading(cachedBundleProducts.length === 0);
    setLoadError(null);
    setPublicOrderSubmitted(null);
    setPublicUpsellOffer(null);
    setOrderFormPackageId("");
    setOrderFormCrossSells([]);
    setAbandonedDraftCartId("");
    abandonedDraftCartIdRef.current = "";
    journeyDedupRef.current.clear();
    previousCrossSellKeysRef.current = [];
    lastTrackedPackageIdRef.current = "";
    lastSyncedPackageIdRef.current = "";
    lastTrackedStateRef.current = "";
    lastExpandedCardProductIdRef.current = null;
    exitTrackedRef.current = false;

    (async () => {
      let resolvedProduct: PublicProduct | null = null;
      let relatedProducts: PublicProduct[] = [];
      let lastError: any = null;

      for (let attempt = 0; attempt < PUBLIC_PRODUCT_FETCH_ATTEMPTS; attempt += 1) {
        try {
          const res = await productsApi.public(publicProductId);
          if (!res?.product) {
            throw new Error("This embed link does not match a product.");
          }
          resolvedProduct = res.product as PublicProduct;
          relatedProducts = (res.related ?? []) as PublicProduct[];
          break;
        } catch (error: any) {
          lastError = error;
          const status = typeof error?.status === "number" ? error.status : null;
          const retryable = status == null || status === 0 || status === 429 || status >= 500;
          if (!retryable) {
            break;
          }
          if (attempt < PUBLIC_PRODUCT_FETCH_ATTEMPTS - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, PUBLIC_PRODUCT_RETRY_DELAY_MS * (attempt + 1)));
          }
        }
      }

      if (cancelled) return;

      if (!resolvedProduct) {
        if (cachedBundleProducts.length === 0) {
          const status = typeof lastError?.status === "number" ? lastError.status : null;
          const retryable = status == null || status === 0 || status === 429 || status >= 500;
          setLoadError(
            status === 404
              ? "This order form is still being prepared. Please retry in a moment."
              : retryable
                ? "We’re reconnecting to the order form. Please wait a moment and retry."
                : (lastError?.message ?? "Could not load the order form.")
          );
        }
        setLoading(false);
        return;
      }

      const merged = [resolvedProduct, ...relatedProducts] as PublicProduct[];
      setProducts(merged);
      writeCachedValue(publicProductCacheKey(publicProductId), {
        products: merged,
        orgId: resolvedProduct.orgId ?? null,
      });

      const orgId = resolvedProduct.orgId;
      if (orgId) {
        embedSettingsApi.public(orgId)
          .then((next) => {
            if (cancelled || !next) return;
            setSettings((prev) => ({ ...prev, ...next }));
            writeCachedValue(publicSettingsCacheKey(orgId), next as PublicEmbedSettings);
          })
          .catch(() => {
            // Keep defaults if settings fetch fails.
          });
      }

      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [publicProductId]);

  useEffect(() => {
    if (orderablePublicPackages.length === 0) return;
    if (!orderablePublicPackages.some((item) => item.id === orderFormPackageId)) {
      setOrderFormPackageId(orderablePublicPackages[0].id);
    }
  }, [orderFormPackageId, orderablePublicPackages]);

  useEffect(() => {
    const companionKeys = new Set(
      (chosenPackage?.companionProducts ?? [])
        .filter(companionIsActive)
        .filter((companion) => !companion.autoInclude)
        .filter((companion) => companionVisibleInState(companion, orderFormState))
        .map((companion) => companionSelectionKey(companion))
    );
    setOrderFormCrossSells((prev) => prev.filter((line) => companionKeys.has(companionSelectionKey(line))));
  }, [chosenPackage, orderFormState]);

  // Field-level touch + hesitation tracking. Watches all customer-typed
  // fields and (a) records the most recently touched one (for form_exited's
  // lastFieldTouched metadata) and (b) fires "field_hesitated" once per field
  // when the customer types ≥ 3 characters then clears them — a strong
  // indecision signal reps can act on.
  useEffect(() => {
    if (publicEmbedIsPreview) return;
    const fields: Record<string, string> = {
      name: orderFormName,
      phone: orderFormPhone,
      whatsapp: orderFormWhatsapp,
      email: orderFormEmail,
      address: orderFormAddress,
      city: orderFormCity,
      state: orderFormState
    };
    for (const [key, value] of Object.entries(fields)) {
      const previous = fieldTypingValueRef.current[key] ?? "";
      if (previous === value) continue;
      const trimmedLength = value.trim().length;
      if (trimmedLength > 0) {
        lastFieldTouchedRef.current = key;
        const currentMax = fieldMaxLengthRef.current[key] ?? 0;
        if (trimmedLength > currentMax) fieldMaxLengthRef.current[key] = trimmedLength;
      } else if (previous.trim().length > 0) {
        // Field just transitioned to empty — judge hesitation off the
        // high-water mark, not the immediate previous value.
        const maxSeen = fieldMaxLengthRef.current[key] ?? 0;
        if (maxSeen >= 3 && !fieldHesitationTrackedRef.current.has(key)) {
          fieldHesitationTrackedRef.current.add(key);
          trackCartJourney("field_hesitated", {
            dedupeKey: `field_hesitated:${key}`,
            metadata: {
              field: key,
              clearedAfterChars: maxSeen
            }
          });
        }
        fieldMaxLengthRef.current[key] = 0;
      }
      fieldTypingValueRef.current[key] = value;
    }
  }, [orderFormName, orderFormPhone, orderFormWhatsapp, orderFormEmail, orderFormAddress, orderFormCity, orderFormState, publicEmbedIsPreview]);

  // Submit-idle tracking: if the customer scrolls the submit area into view
  // and lingers there 30 seconds without pressing submit, fire submit_idle.
  // High-signal hesitation event — rep knows the customer was right at the
  // finish line but bailed.
  useEffect(() => {
    if (publicEmbedIsPreview || publicOrderSubmitted) return;
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    const node = submitActionRef.current;
    if (!node) return;
    let timer: number | null = null;
    const startTimer = () => {
      if (submitIdleFiredRef.current || timer) return;
      timer = window.setTimeout(() => {
        if (submitIdleFiredRef.current || publicOrderSubmittingRef.current || publicOrderSubmitted) return;
        submitIdleFiredRef.current = true;
        trackCartJourney("submit_idle", {
          metadata: {
            secondsOnPage: Math.max(0, Math.round((Date.now() - formOpenedAtRef.current) / 1000)),
            packageName: chosenPackage?.name ?? null,
            lastFieldTouched: lastFieldTouchedRef.current || null,
            additionalItems: orderFormCrossSells.length
          }
        });
      }, 30_000);
      submitIdleTimerRef.current = timer;
    };
    const stopTimer = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
        submitIdleTimerRef.current = null;
      }
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) startTimer();
        else stopTimer();
      }
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      stopTimer();
    };
  }, [publicEmbedIsPreview, publicOrderSubmitted, chosenPackage?.name, orderFormCrossSells.length]);

  // Carousel image-view tracking. Each time a package's carousel index changes,
  // start a 1.5s dwell timer (per package). If the customer stays on the image
  // long enough, fire "image_viewed" — useful for the rep to know which photo
  // hooked the customer. Each (packageId, imageIndex) only fires once.
  useEffect(() => {
    if (publicEmbedIsPreview || !publicProduct) return;
    const timers = imageDwellTimersRef.current;
    Object.entries(packageCarouselIndexById).forEach(([packageId, currentIndex]) => {
      if (lastTrackedImageIndexRef.current[packageId] === currentIndex) return;
      if (timers[packageId]) {
        window.clearTimeout(timers[packageId]);
        delete timers[packageId];
      }
      timers[packageId] = window.setTimeout(() => {
        lastTrackedImageIndexRef.current[packageId] = currentIndex;
        const pkg = publicPackages.find((p) => p.id === packageId);
        trackCartJourney("image_viewed", {
          dedupeKey: `image_viewed:${packageId}:${currentIndex}`,
          packageId,
          metadata: {
            packageName: pkg?.name ?? null,
            imageIndex: currentIndex,
            totalImages: pkg ? packageImageList(pkg).length : 0
          }
        });
        delete timers[packageId];
      }, 1500);
    });
    return () => {
      Object.values(timers).forEach((handle) => window.clearTimeout(handle));
    };
  }, [packageCarouselIndexById, publicProduct?.id, publicEmbedIsPreview, publicPackages]);

  useEffect(() => {
    const formTouched = Boolean(
      orderFormName.trim() ||
      orderFormPhone.trim() ||
      orderFormWhatsapp.trim() ||
      orderFormEmail.trim() ||
      orderFormAddress.trim() ||
      orderFormCity.trim() ||
      orderFormState.trim()
    );
    const primaryPackageId = orderablePublicPackages[0]?.id ?? publicPackages[0]?.id ?? "";
    const meaningfulInteraction = Boolean(
      formTouched ||
      orderFormCrossSells.length > 0 ||
      expandedCardCompanionProductId ||
      (chosenPackage?.id && primaryPackageId && chosenPackage.id !== primaryPackageId)
    );

    if (!meaningfulInteraction || firstInteractionTrackedRef.current || publicEmbedIsPreview || !publicProduct) return;
    firstInteractionTrackedRef.current = true;
    trackCartJourney("first_interaction", {
      dedupeKey: `first_interaction:${abandonedDraftCartIdRef.current || "draft"}`,
      metadata: {
        productName: publicProduct.name,
        packageName: chosenPackage?.name ?? null,
        source: orderSourceFromUtm(publicUtmSource),
        additionalItems: orderFormCrossSells.length
      }
    });
  }, [
    chosenPackage?.id,
    chosenPackage?.name,
    expandedCardCompanionProductId,
    orderFormAddress,
    orderFormCity,
    orderFormCrossSells.length,
    orderFormEmail,
    orderFormName,
    orderFormPhone,
    orderFormState,
    orderFormWhatsapp,
    publicEmbedIsPreview,
    publicPackages,
    publicProduct,
    publicUtmSource
  ]);

  useEffect(() => {
    if (cartSyncTimerRef.current) {
      window.clearTimeout(cartSyncTimerRef.current);
      cartSyncTimerRef.current = null;
    }

    const formTouched = Boolean(
      orderFormName.trim() ||
      orderFormPhone.trim() ||
      orderFormWhatsapp.trim() ||
      orderFormEmail.trim() ||
      orderFormAddress.trim() ||
      orderFormCity.trim() ||
      orderFormState.trim()
    );
    const primaryPackageId = orderablePublicPackages[0]?.id ?? publicPackages[0]?.id ?? "";
    const meaningfulInteraction = Boolean(
      formTouched ||
      orderFormCrossSells.length > 0 ||
      expandedCardCompanionProductId ||
      (chosenPackage?.id && primaryPackageId && chosenPackage.id !== primaryPackageId)
    );

    if (publicEmbedIsPreview || !meaningfulInteraction || !publicProduct || !chosenPackage) return;

    const cartId = ensureDraftCartId();
    if (!cartId) return;

    // Tier hops use a short debounce so the admin Cart Details "Selected
    // Package" pane catches up with the customer-journey timeline. Field
    // typing keeps the full 1.5s coalescing window to avoid per-keystroke
    // POSTs. The per-IP 60 req/min rate-limit easily survives the worst
    // case of rapid tier hopping (a handful of POSTs over a few seconds).
    const isPackageHop = chosenPackage.id !== lastSyncedPackageIdRef.current;
    const captureDelayMs = isPackageHop ? 250 : 1500;

    cartSyncTimerRef.current = window.setTimeout(() => {
      if (publicOrderSubmittingRef.current) return;
      lastSyncedPackageIdRef.current = chosenPackage.id;
      const whatsappDigits = sanitizePhoneDigitsInput(orderFormWhatsapp);
      cartsApi.capture({
        id: cartId,
        customer: orderFormName.trim() || "Partial lead",
        phone: orderFormPhone.trim() || whatsappDigits || "No phone yet",
        whatsapp: whatsappDigits || undefined,
        email: orderFormEmail.trim() || undefined,
        address: orderFormAddress.trim() || undefined,
        city: orderFormCity.trim() || undefined,
        state: orderFormState.trim() || undefined,
        // If the customer picked a package owned by an alternative product
        // (single-tool vs combo split on the same form), the cart record
        // should reflect that product so abandoned-cart recovery + the
        // eventual order both attribute correctly.
        productId: chosenProductId || publicProduct.id,
        packageId: chosenPackage.id,
        productName: chosenProductName || publicProduct.name,
        packageName: chosenPackage.name,
        amount: summaryTotal,
        currency: chosenPackageCurrency,
        source: orderSourceFromUtm(publicUtmSource),
        embedLabel: publicEmbedLabel || undefined,
        preferredDelivery: orderFormDeliveryWindow.trim() || undefined,
        capturePayload: {
          customerName: orderFormName.trim() || "Partial lead",
          phone: orderFormPhone.trim() || whatsappDigits || "No phone yet",
          whatsapp: whatsappDigits || null,
          email: orderFormEmail.trim() || null,
          address: orderFormAddress.trim() || null,
          city: orderFormCity.trim() || null,
          state: orderFormState.trim() || null,
          packageId: chosenPackage.id,
          packageName: chosenPackage.name,
          packageQuantity: chosenPackage.quantity,
          selectedCrossSellLines,
          autoCompanionLines,
          utmSource: publicUtmSource || null,
          utmCampaign: publicUtmCampaign || null,
          utmMedium: publicUtmMedium || null,
          utmContent: publicUtmContent || null,
          utmTerm: publicUtmTerm || null,
          referrer: publicReferrer || null,
          preferredDelivery: orderFormDeliveryWindow.trim() || null,
          embedLabel: publicEmbedLabel || null,
          formContext: buildPublicFormContext("draft_capture")
        }
      }).catch(() => {
        // Draft capture is best-effort only.
      });
    }, captureDelayMs);

    return () => {
      if (cartSyncTimerRef.current) {
        window.clearTimeout(cartSyncTimerRef.current);
        cartSyncTimerRef.current = null;
      }
    };
  }, [
    abandonedDraftCartId,
    chosenPackage,
    orderFormAddress,
    orderFormCity,
    orderFormDeliveryWindow,
    orderFormEmail,
    orderFormCrossSells,
    orderFormName,
    orderFormPhone,
    orderFormState,
    orderFormWhatsapp,
    expandedCardCompanionProductId,
    publicEmbedIsPreview,
    publicPackages,
    publicProduct,
    publicReferrer,
    buildPublicFormContext,
    publicUtmCampaign,
    publicUtmContent,
    publicUtmMedium,
    publicUtmSource,
    publicUtmTerm,
    publicEmbedLabel,
    summaryTotal,
  ]);

  useEffect(() => {
    if (!abandonedDraftCartId || publicEmbedIsPreview || !publicProduct || !chosenPackage) return;
    trackCartJourney("form_opened", {
      dedupeKey: `form_opened:${abandonedDraftCartId}`,
      packageId: chosenPackage.id,
      metadata: {
        productName: publicProduct.name,
        packageName: chosenPackage.name,
        source: orderSourceFromUtm(publicUtmSource)
      }
    });
  }, [abandonedDraftCartId, chosenPackage, publicEmbedIsPreview, publicProduct, publicUtmSource]);

  useEffect(() => {
    if (!chosenPackage) return;
    const previousPackageId = lastTrackedPackageIdRef.current;
    const firePackageSelected = () => {
      trackCartJourney("package_selected", {
        dedupeKey: `package_selected:${chosenPackage.id}`,
        packageId: chosenPackage.id,
        metadata: {
          packageName: chosenPackage.name,
          packageAmount: chosenPackagePrice,
          source: orderSourceFromUtm(publicUtmSource)
        }
      });
    };
    if (!previousPackageId) {
      // First package selection — keep the package_selected signal so even
      // single-tier customers produce a journey breadcrumb.
      lastTrackedPackageIdRef.current = chosenPackage.id;
      firePackageSelected();
      return;
    }
    if (previousPackageId === chosenPackage.id) return;
    // Every subsequent hop fires tier_switched (no dedupe — we want the full
    // trail so reps can see "looked at 6 sets, dropped to 3 sets, then bailed").
    const previousPkg = publicPackages.find((p) => p.id === previousPackageId);
    tierSwitchCountRef.current += 1;
    lastTrackedPackageIdRef.current = chosenPackage.id;
    const direction = !previousPkg || previousPkg.price === chosenPackagePrice
      ? "lateral"
      : chosenPackagePrice > previousPkg.price
        ? "upgrade"
        : "downgrade";
    trackCartJourney("tier_switched", {
      packageId: chosenPackage.id,
      metadata: {
        switchNumber: tierSwitchCountRef.current,
        fromPackageId: previousPackageId,
        fromPackageName: previousPkg?.name ?? null,
        toPackageId: chosenPackage.id,
        toPackageName: chosenPackage.name,
        fromAmount: previousPkg?.price ?? null,
        toAmount: chosenPackagePrice,
        direction,
        source: orderSourceFromUtm(publicUtmSource)
      }
    });
    // Also stamp a package_selected for the new package (deduped by packageId).
    firePackageSelected();
  }, [chosenPackage, publicUtmSource, publicPackages, chosenPackagePrice]);

  useEffect(() => {
    const normalizedState = normalizeStateName(orderFormState);
    if (!normalizedState) {
      lastTrackedStateRef.current = "";
      return;
    }
    if (lastTrackedStateRef.current === normalizedState) return;
    lastTrackedStateRef.current = normalizedState;
    trackCartJourney("state_selected", {
      dedupeKey: `state_selected:${normalizedState}`,
      state: normalizedState,
      metadata: {
        state: normalizedState,
        source: orderSourceFromUtm(publicUtmSource)
      }
    });
  }, [orderFormState, publicUtmSource]);

  useEffect(() => {
    if (publicEmbedIsPreview) {
      return () => {
        if (cartSyncTimerRef.current) window.clearTimeout(cartSyncTimerRef.current);
        if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
      };
    }

    const handlePageHide = () => {
      if (publicOrderSubmittingRef.current || publicOrderSubmitted) return;
      if (submitRetryArmed && attemptRecoveredAutoSubmit("leaving")) return;
      const cartId = abandonedDraftCartIdRef.current;
      if (!cartId || !publicProduct) return;
      if (exitTrackedRef.current) return;
      exitTrackedRef.current = true;
      cartsApi.trackPublicJourney(
        cartId,
        {
          productId: publicProduct.id,
          packageId: chosenPackage?.id ?? undefined,
          state: orderFormState.trim() || undefined,
          eventType: "form_exited",
          metadata: {
            customerName: orderFormName.trim() || null,
            additionalItems: orderFormCrossSells.length,
            source: orderSourceFromUtm(publicUtmSource),
            secondsOnPage: Math.max(0, Math.round((Date.now() - formOpenedAtRef.current) / 1000)),
            lastFieldTouched: lastFieldTouchedRef.current || null
          }
        },
        { keepalive: true }
      ).catch(() => {
        // Ignore exit-tracking failures.
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") return;
      if (publicOrderSubmittingRef.current || publicOrderSubmitted) return;
      if (submitRetryArmed) {
        attemptRecoveredAutoSubmit("leaving");
      }
    };

    const handlePopState = () => {
      if (publicOrderSubmittingRef.current || publicOrderSubmitted) return;
      if (backButtonFiredRef.current) return;
      backButtonFiredRef.current = true;
      trackCartJourney("back_button_pressed", {
        metadata: {
          packageName: chosenPackage?.name ?? null,
          customerName: orderFormName.trim() || null,
          lastFieldTouched: lastFieldTouchedRef.current || null,
          secondsOnPage: Math.max(0, Math.round((Date.now() - formOpenedAtRef.current) / 1000))
        },
        keepalive: true
      });
    };

    // popstate only fires if there's a state in history to pop. Push a
    // sentinel state once per mount so an in-frame back press lands on the
    // handler before the browser unwinds to the previous page. Skipped if
    // we've already pushed (this effect re-runs often).
    if (!backSentinelPushedRef.current && typeof window !== "undefined" && window.history) {
      try {
        window.history.pushState({ protohubFormSentinel: true }, "");
        backSentinelPushedRef.current = true;
      } catch {
        // Some embed contexts block pushState; popstate falls back to dead.
      }
    }
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("popstate", handlePopState);
    return () => {
      if (cartSyncTimerRef.current) window.clearTimeout(cartSyncTimerRef.current);
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [
    attemptRecoveredAutoSubmit,
    chosenPackage,
    orderFormCrossSells.length,
    orderFormName,
    orderFormState,
    publicEmbedIsPreview,
    publicOrderSubmitted,
    publicProduct,
    publicUtmSource,
    submitRetryArmed
  ]);

  function showToast(message: string) {
    setToast(message);
  }

  function handleAdditionalItemFinishClick() {
    const nextErrors = buildSubmitValidationErrors();
    const firstInvalidField = PUBLIC_ORDER_VALIDATION_ORDER.find((field) => nextErrors[field]);
    if (firstInvalidField) {
      showToast("Your extra item is saved. Finish the highlighted detail so we can submit the order.");
      triggerValidationAttention(firstInvalidField);
      focusField(firstInvalidField);
      void submitPublicOrder();
      return;
    }

    try {
      submitActionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {
      // Ignore scroll errors in embedded browsers.
    }
    setSubmitButtonAttention(true);
    void submitPublicOrder();
  }

  function setOrderFormCrossSellSelection(
    companion: PublicCompanion,
    nextSelected: boolean,
    options?: { exclusiveProduct?: boolean }
  ) {
    const key = companionSelectionKey(companion);
    if (nextSelected) {
      setLastAdditionalItemActionKey(key);
      scrollAdditionalItemNextStepIntoView();
    } else {
      setLastAdditionalItemActionKey((current) => (current === key ? "" : current));
    }
    setOrderFormCrossSells((prev) => {
      const withoutCurrent = prev.filter((line) => companionSelectionKey(line) !== key);
      if (!nextSelected) {
        return withoutCurrent;
      }
      const withoutProductGroup = options?.exclusiveProduct
        ? withoutCurrent.filter((line) => line.productId !== companion.productId)
        : withoutCurrent;
      return [
        ...withoutProductGroup,
        {
          companionId: companion.companionId?.trim() || undefined,
          productId: companion.productId,
          packageId: companion.packageId?.trim() || undefined,
          quantity: companion.quantity
        }
      ];
    });
  }

  function isOrderFormCrossSellSelected(companion: PublicCompanion) {
    const key = companionSelectionKey(companion);
    return orderFormCrossSells.some((line) => companionSelectionKey(line) === key);
  }

  function resetOrderForm() {
    setOrderFormName("");
    setOrderFormPhone("");
    setOrderFormWhatsapp("");
    setOrderFormEmail("");
    setOrderFormAddress("");
    setOrderFormCity("");
    setOrderFormState("");
    setOrderFormDeliveryWindow("");
    setOrderFormConfirmed(false);
    setOrderFormCommitmentAccepted(false);
    setOrderFormCrossSells([]);
    setLastAdditionalItemActionKey("");
    setFieldErrors({});
    setPublicHoneypot("");
    setAbandonedDraftCartId("");
    abandonedDraftCartIdRef.current = "";
    journeyDedupRef.current.clear();
    previousCrossSellKeysRef.current = [];
    lastTrackedPackageIdRef.current = "";
    lastSyncedPackageIdRef.current = "";
    lastTrackedStateRef.current = "";
    lastExpandedCardProductIdRef.current = null;
    firstInteractionTrackedRef.current = false;
    exitTrackedRef.current = false;
    if (orderablePublicPackages[0]) setOrderFormPackageId(orderablePublicPackages[0].id);
    else if (publicPackages[0]) setOrderFormPackageId(publicPackages[0].id);
  }

  function finishPublicOrderJourney(
    orderId: string,
    customer: string,
    options?: { cartId?: string; packageId?: string; state?: string; heldForReview?: boolean }
  ) {
    setPublicUpsellOffer(null);
    exitTrackedRef.current = true;
    // A held (possible-duplicate) order must NOT redirect to the merchant's
    // landing page — that page carries the Facebook pixel, so redirecting would
    // count the duplicate as a "Purchase" conversion (and get charged for it).
    // Show the in-place "order received" thank-you instead; a human confirms it.
    if (options?.heldForReview) {
      setPublicOrderSubmitted({ orderId, customer, mode: "held_review" });
      return;
    }
    if (publicRedirectUrl) {
      trackCartJourney("redirect_triggered", {
        cartId: options?.cartId,
        packageId: options?.packageId,
        state: options?.state,
        dedupeKey: `redirect_triggered:${orderId}`,
        keepalive: true,
        metadata: {
          orderId,
          customerName: customer || "Customer",
          redirectUrl: publicRedirectUrl,
          source: orderSourceFromUtm(publicUtmSource)
        }
      });
      redirectToPublicTarget();
      return;
    }
    setPublicOrderSubmitted({ orderId, customer, mode: "confirmed_order" });
  }

  function redirectToPublicTarget() {
    if (!publicRedirectUrl) return;
    const redirectUrl = (() => {
      if (publicMetaTrackingMode !== "hybrid" || !lastMetaPurchaseEventIdRef.current) return publicRedirectUrl;
      try {
        const url = new URL(publicRedirectUrl);
        url.searchParams.set("ordo_event_id", lastMetaPurchaseEventIdRef.current);
        return url.toString();
      } catch {
        return publicRedirectUrl;
      }
    })();
    if (redirectTimerRef.current) {
      window.clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
    try {
      window.parent?.postMessage({ type: "ordo-redirect", url: redirectUrl }, "*");
    } catch {
      // Direct-link or blocked parent access; the fallback below still runs.
    }
    redirectTimerRef.current = window.setTimeout(() => {
      try {
        (window.top ?? window).location.assign(redirectUrl);
      } catch {
        window.location.assign(redirectUrl);
      }
    }, 350);
  }

  function finishOutageCaptureJourney(orderId: string, customer: string) {
    setPublicUpsellOffer(null);
    exitTrackedRef.current = true;
    if (publicRedirectUrl) {
      redirectToPublicTarget();
      return;
    }
    setPublicOrderSubmitted({ orderId, customer, mode: "outage_capture" });
  }

  function finishBrowserQueuedJourney(orderId: string, customer: string) {
    setPublicUpsellOffer(null);
    exitTrackedRef.current = true;
    setPublicOrderSubmitted({ orderId, customer, mode: "browser_queue" });
  }

  function finishPreviewJourney(customer: string) {
    setPublicUpsellOffer(null);
    exitTrackedRef.current = true;
    if (publicRedirectUrl) {
      redirectToPublicTarget();
      return;
    }
    setPublicOrderSubmitted({ orderId: "Preview only", customer, mode: "preview_only" });
  }

  function finishLocalTestJourney(customer: string) {
    setPublicUpsellOffer(null);
    exitTrackedRef.current = true;
    const testOrderId = `LOCAL-TEST-${Date.now().toString(36).toUpperCase()}`;
    if (publicRedirectUrl) {
      redirectToPublicTarget();
      return;
    }
    setPublicOrderSubmitted({ orderId: testOrderId, customer, mode: "local_test" });
  }

  function shouldCapturePublicOrderOutage(error: any) {
    const status = typeof error?.status === "number" ? error.status : null;
    if (status == null || status === 0 || status === 408 || status === 429 || status === 502 || status === 503 || status === 504) {
      return true;
    }
    const message = String(error?.message ?? "").toLowerCase();
    return message.includes("failed to fetch")
      || message.includes("networkerror")
      || message.includes("load failed")
      || message.includes("unable to reach the server");
  }

  async function saveOutageCapturedCart(options: {
    cartId?: string;
    customerName: string;
    phone: string;
    whatsapp?: string;
  }) {
    if (!browserSupabaseClient || !publicProduct || !chosenPackage) {
      return null;
    }
    const outageCartId = `${options.cartId || makeCartId()}-outage-${Date.now().toString(36)}`;
    const capturedAt = new Date().toISOString();
    const { error } = await browserSupabaseClient
      .from("abandoned_carts")
      .insert({
        id: outageCartId,
        org_id: publicProduct.orgId,
        customer: options.customerName,
        phone: options.phone,
        whatsapp: options.whatsapp || null,
        email: orderFormEmail.trim() || null,
        address: orderFormAddress.trim() || null,
        city: orderFormCity.trim() || null,
        state: orderFormState.trim() || null,
        // Stamp the cart with whichever product owns the chosen package
        // (own or alternative) so the cart record matches what the customer
        // is about to buy. The order at submit time also goes to this
        // product server-side via pkg.product_id.
        product_id: chosenProductId || publicProduct.id,
        package_id: chosenPackage.id,
        product_name: chosenProductName || publicProduct.name,
        package_name: chosenPackage.name,
        amount: summaryTotal,
        currency: chosenPackageCurrency,
        source: orderSourceFromUtm(publicUtmSource),
        embed_label: publicEmbedLabel || null,
        status: "Open abandoned",
        preferred_delivery: orderFormDeliveryWindow.trim() || null,
        outage_captured: true,
        outage_captured_at: capturedAt,
        last_activity: capturedAt,
        capture_payload: {
          customerName: options.customerName,
          phone: options.phone,
          whatsapp: options.whatsapp || null,
          email: orderFormEmail.trim() || null,
          address: orderFormAddress.trim() || null,
          city: orderFormCity.trim() || null,
          state: orderFormState.trim() || null,
          packageId: chosenPackage.id,
          packageName: chosenPackage.name,
          packageQuantity: chosenPackage.quantity,
          selectedCrossSellLines,
          autoCompanionLines,
          utmSource: publicUtmSource || null,
          utmCampaign: publicUtmCampaign || null,
          utmMedium: publicUtmMedium || null,
          utmContent: publicUtmContent || null,
          utmTerm: publicUtmTerm || null,
          embedLabel: publicEmbedLabel || null,
          referrer: publicReferrer || null,
          confirmationChecked: orderFormConfirmed,
          preferredDelivery: orderFormDeliveryWindow.trim() || null,
          redirectedAfterSave: Boolean(publicRedirectUrl),
          formContext: buildPublicFormContext("outage_capture")
        }
      });
    if (error) throw error;
    return outageCartId;
  }

  function queueBrowserOutageSubmission(options: {
    customerName: string;
    body: Record<string, unknown>;
  }) {
    const queuedId = `LOCAL-${Date.now().toString(36)}`;
    const nextQueue = [
      ...readQueuedPublicOrders(),
      {
        id: queuedId,
        customer: options.customerName,
        body: options.body,
        createdAt: new Date().toISOString()
      }
    ];
    writeQueuedPublicOrders(nextQueue);
    return queuedId;
  }

  async function submitPublicOrder() {
    if (publicOrderSubmitting) return;
    if (publicHoneypot) {
      setPublicOrderSubmitted({ orderId: "blocked", customer: orderFormName.trim(), mode: "confirmed_order" });
      return;
    }
    if (!publicProduct || !chosenPackage) {
      showToast("Please choose a package before submitting.");
      return;
    }
    const phoneDigits = orderFormPhone.replace(/\D/g, "");
    const whatsappDigits = sanitizePhoneDigitsInput(orderFormWhatsapp);
    const nextErrors = buildSubmitValidationErrors();
    setFieldErrors(nextErrors);

    const firstInvalidField = PUBLIC_ORDER_VALIDATION_ORDER.find((field) => nextErrors[field]);
    if (firstInvalidField) {
      switch (firstInvalidField) {
        case "name":
          trackSubmitBlocked("submit_blocked_missing_name", "Customer name is required.");
          break;
        case "phone":
          trackSubmitBlocked(
            !orderFormPhone.trim() ? "submit_blocked_missing_phone" : "submit_blocked_invalid_phone",
            !orderFormPhone.trim() ? "Phone number is required." : "Phone number format is invalid."
          );
          break;
        case "whatsapp":
          trackSubmitBlocked(
            !whatsappDigits ? "submit_blocked_missing_whatsapp" : "submit_blocked_invalid_whatsapp",
            !whatsappDigits ? "WhatsApp number is required." : "WhatsApp number format is invalid."
          );
          break;
        case "address":
          trackSubmitBlocked("submit_blocked_missing_address", "Delivery address is required.");
          break;
        case "city":
          trackSubmitBlocked("submit_blocked_missing_city", "City is required.");
          break;
        case "state":
          trackSubmitBlocked("submit_blocked_missing_state", "State selection is required.");
          break;
        case "delivery":
          trackSubmitBlocked("submit_blocked_missing_delivery", "Delivery time selection is required.");
          break;
        case "confirmation":
          trackSubmitBlocked("submit_blocked_missing_confirmation", "Customer confirmation checkbox was not ticked.");
          break;
        case "commitment":
          trackSubmitBlocked("submit_blocked_missing_commitment", "Commitment notice acknowledgement is required.");
          break;
        default:
          break;
      }
      setSubmitRetryArmed(true);
      showToast(`${nextErrors[firstInvalidField] || "Please complete the highlighted fields."} Once completed, we’ll submit automatically after a few seconds.`);
      triggerValidationAttention(firstInvalidField);
      focusField(firstInvalidField);
      return;
    }
    setSubmitRetryArmed(false);

    const customerName = orderFormName.trim();
    const submissionCartId = abandonedDraftCartIdRef.current || ensureDraftCartId();
    const submittedPackageId = chosenPackage.id;
    const submittedPackageName = chosenPackage.name;
    const submittedState = orderFormState.trim();
    const leadEventId = getMetaEventId("Lead", submissionCartId || submittedPackageId);
    const purchaseEventId = getMetaEventId("Purchase", `${submissionCartId || "direct"}_${submittedPackageId}`);
    postMetaBrowserEvent("Lead", leadEventId, {
      content_name: `${publicProduct?.name ?? "Product"} - ${submittedPackageName}`,
      content_ids: [submittedPackageId],
      content_type: "product"
    });
    trackCartJourney("submit_attempted", {
      cartId: submissionCartId || undefined,
      packageId: submittedPackageId,
      state: submittedState || undefined,
      dedupeKey: `submit_attempted:${submissionCartId || "draft"}`,
      metadata: {
        customerName: customerName || "Customer",
        packageName: submittedPackageName,
        additionalItems: orderFormCrossSells.length,
        source: orderSourceFromUtm(publicUtmSource),
        metaEventName: "Lead",
        metaEventId: leadEventId,
        metaTrackingMode: publicMetaTrackingMode,
        metaTestMode: publicMetaTestMode,
        metaTestEventCode: publicMetaTestEventCode || null
      }
    });
    const submissionBody = {
      cartId: publicEmbedIsPreview ? undefined : (submissionCartId || undefined),
      customer: customerName,
      phone: orderFormPhone.trim(),
      whatsapp: whatsappDigits || undefined,
      email: orderFormEmail.trim() || undefined,
      address: orderFormAddress.trim() || undefined,
      city: orderFormCity.trim() || undefined,
      state: orderFormState.trim() || undefined,
      packageId: chosenPackage.id,
      packageSet: publicPackageSet || undefined,
      crossSellLines: orderFormCrossSells
        .filter((line) => line.productId && line.quantity > 0)
        .map((line) => ({
          companionId: line.companionId?.trim() || undefined,
          productId: line.productId,
          packageId: line.packageId?.trim() || undefined,
          quantity: line.quantity
        })),
      utmSource: publicUtmSource || undefined,
      utmCampaign: publicUtmCampaign || undefined,
      utmMedium: publicUtmMedium || undefined,
      utmContent: publicUtmContent || undefined,
      utmTerm: publicUtmTerm || undefined,
      embedLabel: publicEmbedLabel || undefined,
      referrer: publicReferrer || undefined,
      confirmationChecked: orderFormConfirmed,
      preferredDelivery: orderFormDeliveryWindow.trim() || undefined,
      formContext: buildPublicFormContext("submit"),
      company: publicHoneypot,
    };
    Object.assign(submissionBody.formContext, {
      packageSet: publicPackageSet || null,
      metaTrackingMode: publicMetaTrackingMode,
      metaPixelId: publicMetaPixelId || null,
      metaTrackingKey: publicMetaTrackingKey || null,
      metaTestMode: publicMetaTestMode,
      metaTestEventCode: publicMetaTestEventCode || null,
      metaLeadEventId: leadEventId,
      metaPurchaseEventId: purchaseEventId
    });

    if (publicEmbedIsPreview) {
      resetOrderForm();
      if (publicEmbedIsLocalTest) {
        finishLocalTestJourney(customerName);
      } else {
        finishPreviewJourney(customerName);
      }
      return;
    }

    setPublicOrderSubmitting(true);
    publicOrderSubmittingRef.current = true;
    try {
      const created = await publicOrdersApi.create(submissionBody);
      const upsellProductId = created.upsellOffer?.productId;
      const upsellPackageId = created.upsellOffer?.packageId;
      const upsellCompanion = upsellProductId
        ? (chosenPackage.companionProducts ?? [])
            .filter(companionIsActive)
            .filter((companion) => (companion.placement ?? "inline") === "upsell")
            .filter((companion) => companionVisibleInState(companion, submittedState))
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .find((companion) =>
              created.upsellOffer?.companionId
                ? companion.companionId === created.upsellOffer.companionId
                : companion.productId === upsellProductId
                  && (created.upsellOffer?.packageId ? companion.packageId === created.upsellOffer.packageId : true)
            )
        : null;
      const upsellProduct = upsellProductId
        ? products.find((item) => item.id === upsellProductId)
        : null;
      const upsellTargetPackage = upsellPackageId
        ? (products.flatMap((item) => item.packages ?? []).find((pkg) => pkg.id === upsellPackageId) ?? null)
        : null;
      const hasAfterSubmitOffer = Boolean(created.upsellToken && created.upsellOffer && upsellCompanion && upsellProduct);
      if (!created.reviewHold) {
        lastMetaPurchaseEventIdRef.current = purchaseEventId;
        postMetaBrowserEvent("Purchase", purchaseEventId, {
          value: Number(created.amount || 0),
          currency: created.currency || chosenPackageCurrency,
          content_name: `${publicProduct?.name ?? "Product"} - ${submittedPackageName}`,
          content_ids: [publicProduct?.id ?? publicProductId, submittedPackageId].filter(Boolean),
          content_type: "product",
          contents: [{ id: submittedPackageId, quantity: chosenPackage.quantity || 1 }],
          num_items: chosenPackage.quantity || 1,
          order_id: created.id
        });
      }

      trackCartJourney("order_submitted", {
        cartId: submissionCartId || undefined,
        packageId: submittedPackageId,
        state: submittedState || undefined,
        dedupeKey: `order_submitted:${created.id}`,
        metadata: {
          orderId: created.id,
          customerName: customerName || "Customer",
          packageName: submittedPackageName,
          additionalItems: orderFormCrossSells.length,
          source: orderSourceFromUtm(publicUtmSource),
          metaEventName: "Purchase",
          metaEventId: purchaseEventId,
          metaTrackingMode: publicMetaTrackingMode,
          metaTestMode: publicMetaTestMode,
          metaTestEventCode: publicMetaTestEventCode || null
        }
      });

      if (hasAfterSubmitOffer && created.upsellOffer && upsellProduct) {
        trackCartJourney("additional_item_preview_opened", {
          cartId: submissionCartId || undefined,
          packageId: submittedPackageId,
          state: submittedState || undefined,
          companionProductId: created.upsellOffer.productId,
          companionPackageId: created.upsellOffer.packageId ?? undefined,
          metadata: {
            productName: upsellProduct.name,
            packageName: created.upsellOffer.packageName ?? null,
            quantity: created.upsellOffer.quantity,
            placement: "after_submit",
            orderId: created.id,
            offerAmount: created.upsellOffer.amount,
            totalBeforeOffer: created.amount,
            totalIfAccepted: Number(created.amount ?? 0) + Number(created.upsellOffer.amount ?? 0),
            currency: created.currency
          }
        });
      }

      resetOrderForm();
      setPublicOrderSubmitting(false);
      publicOrderSubmittingRef.current = false;
      if (cartSyncTimerRef.current) {
        window.clearTimeout(cartSyncTimerRef.current);
        cartSyncTimerRef.current = null;
      }

      if (created.upsellToken && created.upsellOffer && upsellCompanion && upsellProduct) {
        setPublicUpsellOffer({
          orderId: created.id,
          customer: customerName,
          token: created.upsellToken,
          sourceCartId: submissionCartId || undefined,
          mainPackageId: submittedPackageId,
          state: submittedState || undefined,
          companion: upsellCompanion,
          product: upsellProduct,
          targetPackage: upsellTargetPackage,
          quantity: created.upsellOffer.quantity,
          amount: created.upsellOffer.amount,
          currency: created.currency as ProductCurrencyCode
        });
        return;
      }

      finishPublicOrderJourney(created.id, customerName, {
        cartId: submissionCartId || undefined,
        packageId: submittedPackageId,
        state: submittedState || undefined,
        heldForReview: Boolean(created.reviewHold)
      });
      return;
    } catch (error: any) {
      if (shouldCapturePublicOrderOutage(error)) {
        try {
          const savedCaptureId = await saveOutageCapturedCart({
            cartId: submissionCartId || undefined,
            customerName,
            phone: orderFormPhone.trim(),
            whatsapp: whatsappDigits || undefined
          });
          if (savedCaptureId) {
            resetOrderForm();
            setPublicOrderSubmitting(false);
            publicOrderSubmittingRef.current = false;
            if (cartSyncTimerRef.current) {
              window.clearTimeout(cartSyncTimerRef.current);
              cartSyncTimerRef.current = null;
            }
            showToast("We saved your request while the order system was temporarily offline. Our team will contact you shortly.");
            finishOutageCaptureJourney(savedCaptureId, customerName);
            return;
          }
        } catch {
          // Fall through to the default error path if direct capture also fails.
        }
        const queuedId = queueBrowserOutageSubmission({
          customerName,
          body: submissionBody
        });
        resetOrderForm();
        setPublicOrderSubmitting(false);
        publicOrderSubmittingRef.current = false;
        if (cartSyncTimerRef.current) {
          window.clearTimeout(cartSyncTimerRef.current);
          cartSyncTimerRef.current = null;
        }
        showToast("We saved your request in this browser and will keep retrying automatically while the system is offline.");
        finishBrowserQueuedJourney(queuedId, customerName);
        return;
      }
      setPublicOrderSubmitting(false);
      publicOrderSubmittingRef.current = false;
      showToast(error?.message ?? "Could not submit your order. Please try again.");
      return;
    }
  }

  async function acceptPublicUpsell() {
    if (!publicUpsellOffer || publicUpsellSubmitting) return;
    setPublicUpsellSubmitting(true);
    try {
      await publicOrdersApi.acceptUpsell(publicUpsellOffer.orderId, { token: publicUpsellOffer.token });
      finishPublicOrderJourney(publicUpsellOffer.orderId, publicUpsellOffer.customer, {
        cartId: publicUpsellOffer.sourceCartId,
        packageId: publicUpsellOffer.mainPackageId,
        state: publicUpsellOffer.state
      });
    } catch (error: any) {
      setPublicUpsellSubmitting(false);
      showToast(error?.message ?? "Could not add this offer. Please try again.");
      return;
    }
    setPublicUpsellSubmitting(false);
  }

  function declinePublicUpsell() {
    if (!publicUpsellOffer || publicUpsellSubmitting) return;
    trackCartJourney("additional_item_removed", {
      cartId: publicUpsellOffer.sourceCartId,
      packageId: publicUpsellOffer.mainPackageId,
      state: publicUpsellOffer.state,
      companionProductId: publicUpsellOffer.product.id,
      companionPackageId: publicUpsellOffer.targetPackage?.id ?? undefined,
      keepalive: true,
      metadata: {
        productName: publicUpsellOffer.product.name,
        packageName: publicUpsellOffer.targetPackage?.name ?? null,
        quantity: publicUpsellOffer.quantity,
        placement: "after_submit",
        action: "declined_after_submit",
        orderId: publicUpsellOffer.orderId,
        offerAmount: publicUpsellOffer.amount,
        currency: publicUpsellOffer.currency
      }
    });
    finishPublicOrderJourney(publicUpsellOffer.orderId, publicUpsellOffer.customer, {
      cartId: publicUpsellOffer.sourceCartId,
      packageId: publicUpsellOffer.mainPackageId,
      state: publicUpsellOffer.state
    });
  }

  const allowedStates = useMemo(() => {
    const normalizedAvailableStates = Array.from(new Set((publicProduct?.availableStates ?? []).map(normalizeStateName).filter(Boolean)));
    const treatAsAllNigeriaStates =
      normalizedAvailableStates.length >= NIGERIA_STATES.length - 1 &&
      !normalizedAvailableStates.includes("FCT Abuja");
    return normalizedAvailableStates.length > 0
      ? NIGERIA_STATES.filter(
          (state) =>
            normalizedAvailableStates.includes(normalizeStateName(state)) ||
            (state === "FCT Abuja" && treatAsAllNigeriaStates)
        )
      : NIGERIA_STATES;
  }, [publicProduct]);

  const companionOptions = (chosenPackage?.companionProducts ?? [])
    .filter(companionIsActive)
    .filter((companion) => !companion.autoInclude)
    .filter((companion) => (companion.placement ?? "inline") === "inline")
    .filter((companion) =>
      companion.stateRestrictions.length === 0
        ? true
        : Boolean(normalizedSelectedState) && companionVisibleInState(companion, normalizedSelectedState)
    );

  const cardCompanionGroups = useMemo(
    () => Object.values(
      companionOptions
        .filter((companion) => (companion.displayMode ?? "compact") === "card")
        .reduce<Record<string, { product: PublicProduct | undefined; companions: PublicCompanion[]; priority: number }>>((acc, companion) => {
          const key = companion.productId;
          if (!acc[key]) {
            acc[key] = {
              product: products.find((item) => item.id === companion.productId),
              companions: [],
              priority: companion.priority ?? 0
            };
          }
          acc[key].companions.push(companion);
          acc[key].priority = Math.max(acc[key].priority, companion.priority ?? 0);
          return acc;
        }, {})
    )
      .map((group) => ({
        ...group,
        companions: [...group.companions].sort((a, b) => {
          if (a.quantity !== b.quantity) return a.quantity - b.quantity;
          return (b.priority ?? 0) - (a.priority ?? 0);
        })
      }))
      .sort((a, b) => b.priority - a.priority),
    [companionOptions, products]
  );

  const showcaseCompanionOptions = useMemo(
    () => companionOptions
      .filter((companion) => (companion.displayMode ?? "compact") === "showcase")
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)),
    [companionOptions]
  );

  const compactCompanionOptions = useMemo(
    () => companionOptions.filter((companion) => {
      const mode = companion.displayMode ?? "compact";
      return mode !== "card" && mode !== "showcase";
    }),
    [companionOptions]
  );

  useEffect(() => {
    if (!expandedCardCompanionProductId) {
      lastExpandedCardProductIdRef.current = null;
      return;
    }
    if (lastExpandedCardProductIdRef.current === expandedCardCompanionProductId) return;
    lastExpandedCardProductIdRef.current = expandedCardCompanionProductId;
    const group = cardCompanionGroups.find((entry) => entry.product?.id === expandedCardCompanionProductId);
    if (!group?.product) return;
    const previewCompanion = group.companions[0];
    trackCartJourney("additional_item_preview_opened", {
      companionProductId: group.product.id,
      companionPackageId: previewCompanion?.packageId ?? undefined,
      metadata: {
        productName: group.product.name,
        variants: group.companions.length
      }
    });
  }, [cardCompanionGroups, expandedCardCompanionProductId]);

  useEffect(() => {
    const nextKeys = orderFormCrossSells.map((line) => companionSelectionKey(line)).sort();
    const prevKeys = previousCrossSellKeysRef.current;
    if (prevKeys.length === 0 && nextKeys.length === 0) return;

    const addedKeys = nextKeys.filter((key) => !prevKeys.includes(key));
    const removedKeys = prevKeys.filter((key) => !nextKeys.includes(key));

    for (const key of addedKeys) {
      const selection = orderFormCrossSells.find((line) => companionSelectionKey(line) === key);
      if (!selection) continue;
      const product = products.find((item) => item.id === selection.productId);
      const companion = companionForSelection(selection);
      const targetPackage = companion ? targetPackageForCompanion(companion, products) : null;
      const offerAmount = product && publicProduct
        ? companion
          ? companionLineTotal(companion, product, targetPackage)
          : crossSellPriceFor(publicProduct, product) * Math.max(1, Number(selection.quantity) || 1)
        : 0;
      trackCartJourney("additional_item_added", {
        companionProductId: selection.productId,
        companionPackageId: selection.packageId ?? undefined,
        metadata: {
          productName: product?.name ?? "Additional item",
          quantity: selection.quantity,
          packageName: targetPackage?.name ?? null,
          offerAmount,
          totalAfterAdd: summaryTotal,
          currency: chosenPackageCurrency,
          selectedAdditionalItems: orderFormCrossSells.length
        }
      });
    }

    for (const key of removedKeys) {
      const [productId, packageId] = key.split("::");
      const product = products.find((item) => item.id === productId);
      trackCartJourney("additional_item_removed", {
        companionProductId: productId,
        companionPackageId: packageId || undefined,
        metadata: {
          productName: product?.name ?? "Additional item"
        }
      });
    }

    previousCrossSellKeysRef.current = nextKeys;
  }, [chosenPackage?.name, chosenPackageCurrency, orderFormCrossSells, products, summaryTotal]);

  useEffect(() => {
    if (cardCompanionGroups.length === 0) {
      setExpandedCardCompanionProductId(null);
      return;
    }
    setExpandedCardCompanionProductId((prev) => {
      if (!prev) return null;
      if (cardCompanionGroups.some((group) => group.product?.id === prev)) return prev;
      return null;
    });
  }, [cardCompanionGroups]);

  if (loading && !publicProduct) {
    if (!showLoading) return null;
    return (
      <main className="public-order-page">
        <section className="public-order-shell">
          <article className="panel public-order-empty" aria-busy="true" aria-live="polite">
            <div style={{ fontSize: 40 }}>...</div>
            <h1>Loading order form...</h1>
            <p>Fetching the latest product and package details for this embed link.</p>
          </article>
        </section>
      </main>
    );
  }

  if (!publicProduct) {
    return (
      <main className="public-order-page">
        <section className="public-order-shell">
          <article className="panel public-order-empty">
            <div style={{ fontSize: 40 }}>?</div>
            <h1>Order form unavailable</h1>
            <p>{loadError || "This order form is still being prepared. Please retry in a moment."}</p>
            <button className="primary-button" onClick={() => window.location.reload()}>
              Retry
            </button>
          </article>
        </section>
      </main>
    );
  }

  if (publicPackages.length === 0) {
    return (
      <main className="public-order-page">
        <section className="public-order-shell">
          <article className="panel public-order-empty">
            <div style={{ fontSize: 40 }}>!</div>
            <h1>{publicProduct.name}</h1>
            <p>Create at least one active package for this product before sharing the embed link.</p>
            <button className="primary-button" onClick={() => { window.location.hash = "#"; }}>
              Back
            </button>
          </article>
        </section>
      </main>
    );
  }

  const inlineOrderBreakdownBlock = selectedCrossSellLines.length > 0 ? (
    <div
      style={{
        padding: 14,
        border: "1px solid #dbeafe",
        background: "#f8fbff",
        borderRadius: 16,
        display: "grid",
        gap: 10,
        marginTop: 14
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "grid", gap: 2 }}>
          <strong style={{ fontSize: 15, color: "#0f172a" }}>Order breakdown so far</strong>
          <span style={{ fontSize: 12, color: "#64748b" }}>Each additional item appears here as soon as you add it.</span>
        </div>
        <strong style={{ fontSize: 16, color: "#1F8FE0" }}>{formatProductMoney(summaryTotal, chosenPackageCurrency)}</strong>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 8,
          borderTop: "1px solid #dbeafe"
        }}
      >
        <div style={{ display: "grid", gap: 2 }}>
          <strong style={{ fontSize: 13, color: "#0f172a" }}>{chosenPackageHeadline}</strong>
          <span style={{ fontSize: 12, color: "#64748b" }}>Main offer</span>
        </div>
        <strong style={{ fontSize: 13, color: "#0f172a" }}>{formatProductMoney(chosenPackagePrice, chosenPackageCurrency)}</strong>
      </div>

      {selectedCrossSellLines.map((line, index) => (
        <div
          key={`inline-xs-${index}`}
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            paddingTop: 8,
            borderTop: "1px solid #e2e8f0"
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <strong style={{ fontSize: 13, color: "#92400e" }}>Additional item · {line.name}</strong>
            {line.detail ? <span style={{ fontSize: 12, color: "#64748b" }}>{line.detail}</span> : null}
          </div>
          <strong style={{ fontSize: 13, color: "#92400e" }}>{formatProductMoney(line.total, chosenPackageCurrency)}</strong>
        </div>
      ))}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 10,
          borderTop: "2px solid #bfdbfe"
        }}
      >
        <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>Total so far</span>
        <strong style={{ fontSize: 18, color: "#1F8FE0" }}>{formatProductMoney(summaryTotal, chosenPackageCurrency)}</strong>
      </div>
    </div>
  ) : null;

  // Auto-derived items breakdown — only show when it adds info beyond what
  // the headline already says (i.e. combos that mix multiple products).
  const orderSummaryAutoBreakdown = chosenPackage ? packageComponentSummary(chosenPackage, products) : "";
  const orderSummaryAutoBreakdownLine = orderSummaryAutoBreakdown && orderSummaryAutoBreakdown !== chosenPackageQtyLabel
    ? orderSummaryAutoBreakdown
    : "";
  const orderSummaryManualCopy = (chosenPackage?.description?.trim()
    || (chosenAttributionProduct?.packageDescription ?? publicProduct?.packageDescription ?? "").trim()
    || (chosenAttributionProduct?.description ?? publicProduct?.description ?? "").trim()) || "";
  // Suppress the manual copy when it duplicates the auto-derived breakdown
  // or the headline.
  const orderSummaryFlavorLine = orderSummaryManualCopy
    && orderSummaryManualCopy !== orderSummaryAutoBreakdownLine
    && orderSummaryManualCopy !== chosenPackageQtyLabel
    ? orderSummaryManualCopy
    : "";
  const orderSummaryBlock = settings.formOrderSummaryEnabled && chosenPackage ? (
    <div className="panel public-order-summary-rail" style={{ padding: 16, display: "grid", gap: 6 }}>
      <strong style={{ fontSize: 14 }}>{settings.formOrderSummaryTitle}</strong>
      <div style={{ display: "grid", gap: 4, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
          <span>{chosenPackageHeadline}</span>
          <strong>{formatProductMoney(chosenPackagePrice, chosenPackageCurrency)}</strong>
        </div>
        {orderSummaryAutoBreakdownLine ? (
          <span style={{ fontSize: 12, color: "#475569", lineHeight: 1.4 }}>{orderSummaryAutoBreakdownLine}</span>
        ) : null}
        {orderSummaryFlavorLine ? (
          <span style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4, fontStyle: "italic" }}>{orderSummaryFlavorLine}</span>
        ) : null}
      </div>
      {selectedCrossSellLines.map((line, index) => (
        <div key={`xs-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "4px 0", color: "#92400e" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <span>↳ Additional item · {line.name}</span>
            {line.detail ? <span style={{ color: "#94a3b8", fontSize: 11 }}>{line.detail}</span> : null}
          </div>
          <span>{formatProductMoney(line.total, chosenPackageCurrency)}</span>
        </div>
      ))}
      {autoCompanionLines.map((line, index) => (
        <div key={`auto-${index}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, padding: "4px 0", color: "#1F8FE0" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <span>+ {line.name}</span>
            {line.detail ? <span style={{ color: "#94a3b8", fontSize: 11 }}>{line.detail}</span> : null}
          </div>
          <span>{line.total === 0 ? "FREE" : formatProductMoney(line.total, chosenPackageCurrency)}</span>
        </div>
      ))}
      {summaryGiftLines.map((gift) => (
        <div key={gift.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "#047857" }}>
          <span>🎁 {gift.name}</span>
          <span>FREE</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, padding: "10px 0 0", marginTop: 4, borderTop: "2px solid #1F8FE0", fontWeight: 800 }}>
        <span>Total</span>
        <span style={{ color: "#1F8FE0" }}>{formatProductMoney(summaryTotal, chosenPackageCurrency)}</span>
      </div>
    </div>
  ) : null;
  const guidedSteps = guidedCheckout ? [
    {
      key: "contact",
      label: "Contact",
      helper: "Name, phone, WhatsApp",
      done: contactStepComplete,
      active: !contactStepComplete
    },
    {
      key: "delivery",
      label: "Delivery",
      helper: "Address, state, timing",
      done: deliveryStepComplete,
      active: contactStepComplete && !deliveryStepComplete
    },
    {
      key: "review",
      label: "Review & place",
      helper: "Check total, then place",
      done: reviewStepReady,
      active: contactStepComplete && deliveryStepComplete
    }
  ] : [];
  const guidedReviewPrompt = reviewStepReady
    ? "Your order is ready. Tap Place My Order to confirm it now."
    : contactStepComplete && deliveryStepComplete
      ? "Review the details below, then tap Place My Order to finish."
      : "Complete the steps above and we’ll guide you to the final order button.";
  const guidedReviewBlock = guidedCheckout && chosenPackage ? (
    <div
      style={{
        marginTop: 18,
        padding: 16,
        border: reviewStepReady ? "1px solid #86efac" : "1px solid #bfdbfe",
        background: reviewStepReady ? "#ecfdf5" : "#f8fbff",
        borderRadius: 18,
        display: "grid",
        gap: 12
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <strong style={{ fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: reviewStepReady ? "#047857" : "#1d4ed8" }}>
            Step 3 of 3 · Review and place your order
          </strong>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: reviewStepReady ? "#166534" : "#334155" }}>
            {guidedReviewPrompt}
          </p>
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 11px",
            borderRadius: 999,
            background: reviewStepReady ? "#dcfce7" : "#dbeafe",
            color: reviewStepReady ? "#166534" : "#1d4ed8",
            fontSize: 12,
            fontWeight: 800,
            whiteSpace: "nowrap"
          }}
        >
          {reviewStepReady ? "Ready to submit" : "Almost there"}
        </span>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, paddingBottom: 10, borderBottom: "1px solid #dbeafe" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <strong style={{ fontSize: 14, color: "#0f172a" }}>{chosenPackageHeadline}</strong>
            <span style={{ fontSize: 12, color: "#64748b" }}>Main package</span>
          </div>
          <strong style={{ fontSize: 14, color: "#0f172a" }}>{formatProductMoney(chosenPackagePrice, chosenPackageCurrency)}</strong>
        </div>
        {selectedCrossSellLines.map((line, index) => (
          <div key={`guided-xs-${index}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "grid", gap: 2 }}>
              <strong style={{ fontSize: 13, color: "#92400e" }}>Additional item · {line.name}</strong>
              {line.detail ? <span style={{ fontSize: 12, color: "#64748b" }}>{line.detail}</span> : null}
            </div>
            <strong style={{ fontSize: 13, color: "#92400e" }}>{formatProductMoney(line.total, chosenPackageCurrency)}</strong>
          </div>
        ))}
        <div style={{ display: "grid", gap: 4, paddingTop: 10, borderTop: "1px solid #dbeafe", fontSize: 13, color: "#334155" }}>
          <div><strong>Contact:</strong> {orderFormName.trim() || "Your name"} · +234 {orderFormPhone.trim() || "phone number"}</div>
          <div><strong>Delivery:</strong> {orderFormCity.trim() || "City"}, {orderFormState.trim() || "State"}{orderFormDeliveryWindow.trim() ? ` · ${orderFormDeliveryWindow.trim()}` : ""}</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, paddingTop: 10, borderTop: "2px solid #bfdbfe" }}>
          <span style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>Total to place now</span>
          <strong style={{ fontSize: 20, color: "#1F8FE0" }}>{formatProductMoney(summaryTotal, chosenPackageCurrency)}</strong>
        </div>
      </div>
    </div>
  ) : null;
  const slotStatus = settings.freeDeliverySlotsEnabled && freeDeliverySlotStatus?.enabled ? freeDeliverySlotStatus : null;
  const freeDeliverySlotBanner = slotStatus ? (() => {
    const limit = Math.max(1, Number(slotStatus.limit ?? settings.freeDeliverySlotLimit ?? 15));
    const claimed = Math.max(0, Number(slotStatus.claimed ?? 0));
    const remaining = Math.max(0, Number(slotStatus.remaining ?? Math.max(0, limit - claimed)));
    const full = slotStatus.full === true || remaining <= 0;
    const isDailyOrLonger = Number(slotStatus.resetIntervalMinutes ?? settings.freeDeliveryResetIntervalMinutes ?? 1440) >= 1440;
    const claimedPercent = Math.min(100, Math.max(0, Math.round((Math.min(claimed, limit) / limit) * 100)));
    const remainingLabel = remaining === 1 ? "1 slot left" : `${remaining} slots left`;
    const urgencyHeadline = remaining <= 1
      ? "Last free-delivery slot left"
      : remaining <= 3
        ? `Only ${remaining} free-delivery slots left`
        : "Free-delivery slots are moving fast";

    return (
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          padding: isCompactUpsellViewport ? "15px 14px" : "16px 18px",
          background: full
            ? "linear-gradient(135deg, #fff7ed 0%, #fffbeb 100%)"
            : "linear-gradient(135deg, #fff7ed 0%, #ecfdf5 56%, #eff6ff 100%)",
          border: `1px solid ${full ? "#fdba74" : "#fb923c"}`,
          borderRadius: 18,
          color: full ? "#9a3412" : "#064e3b",
          marginBottom: 12,
          boxShadow: full
            ? "0 14px 34px rgba(154, 52, 18, 0.10)"
            : "0 18px 42px rgba(249, 115, 22, 0.16), 0 8px 22px rgba(16, 185, 129, 0.10)",
          animation: full ? undefined : "publicSlotUrgencyPulse 2.6s ease-in-out infinite"
        }}
      >
        {!full && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: "radial-gradient(circle at 18% 0%, rgba(251, 146, 60, 0.18), transparent 38%)",
              pointerEvents: "none"
            }}
          />
        )}
        <div style={{ position: "relative", display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 14,
              background: full ? "#ffedd5" : "#fed7aa",
              fontSize: 21,
              lineHeight: 1,
              boxShadow: full ? "none" : "0 10px 22px rgba(249, 115, 22, 0.22)",
              animation: full ? undefined : "publicSlotIconSpark 1.7s ease-in-out infinite"
            }}
          >
            {full ? "🚚" : "🔥"}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <p style={{ margin: 0, fontSize: isCompactUpsellViewport ? 18 : 17, fontWeight: 950, lineHeight: 1.18, color: full ? "#9a3412" : "#7c2d12" }}>
                {full
                  ? (isDailyOrLonger ? "Today’s free-delivery slots are full." : "This free-delivery round is full.")
                  : urgencyHeadline}
              </p>
              {!full && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    borderRadius: 999,
                    padding: "5px 10px",
                    background: "#f97316",
                    color: "#fff7ed",
                    fontSize: 12,
                    fontWeight: 950,
                    letterSpacing: "0.02em",
                    boxShadow: "0 8px 18px rgba(249, 115, 22, 0.28)"
                  }}
                >
                  {remainingLabel}
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: isCompactUpsellViewport ? 14 : 13, lineHeight: 1.45, color: full ? "#9a3412" : "#065f46", fontWeight: 800 }}>
              {full
                ? "You can still place your order for normal delivery."
                : `${claimed} of ${limit} claimed already. Finish the form now to hold your free-delivery spot before it disappears.`}
            </p>
            {!full && (
              <div style={{ marginTop: 10 }}>
                <div style={{ position: "relative", height: 9, overflow: "hidden", borderRadius: 999, background: "rgba(15, 23, 42, 0.10)" }}>
                  <div
                    style={{
                      position: "absolute",
                      inset: "0 auto 0 0",
                      width: `${claimedPercent}%`,
                      minWidth: claimedPercent > 0 ? 18 : 0,
                      borderRadius: 999,
                      background: "linear-gradient(90deg, #f59e0b, #f97316, #ef4444)"
                    }}
                  />
                  <div
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      width: "45%",
                      background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.72), transparent)",
                      animation: "publicSlotProgressSweep 1.9s ease-in-out infinite"
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  })() : null;
  const additionalItemValidationPreview = buildSubmitValidationErrors();
  const additionalItemMissingCount = PUBLIC_ORDER_VALIDATION_ORDER.filter((field) => additionalItemValidationPreview[field]).length;
  const lastAdditionalItemStillSelected = Boolean(
    lastAdditionalItemActionKey
    && orderFormCrossSells.some((line) => companionSelectionKey(line) === lastAdditionalItemActionKey)
  );
  const additionalItemNames = selectedCrossSellLines.map((line) => line.name).slice(0, 2).join(", ");
  const additionalItemCompletionBlock = selectedCrossSellLines.length > 0 ? (
    <div
      ref={additionalItemNextStepRef}
      style={{
        marginTop: 14,
        padding: isCompactUpsellViewport ? 16 : 14,
        borderRadius: 18,
        border: "2px solid #22c55e",
        background: "linear-gradient(135deg, #ecfdf5 0%, #f8fbff 100%)",
        display: "grid",
        gap: 12,
        boxShadow: lastAdditionalItemStillSelected ? "0 14px 32px rgba(34, 197, 94, 0.16)" : "none",
        ...(lastAdditionalItemStillSelected ? { animation: "publicAddOnBridgePulse 1.2s ease 2" } : {})
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "grid", gap: 5, minWidth: 0 }}>
          <span style={{ width: "fit-content", padding: "5px 9px", borderRadius: 999, background: "#dcfce7", border: "1px solid #86efac", color: "#15803d", fontSize: 11, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Extra item added
          </span>
          <strong style={{ fontSize: isCompactUpsellViewport ? 20 : 17, color: "#0f172a", lineHeight: 1.2 }}>
            Next step: finish the order
          </strong>
          <span style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}>
            {additionalItemNames || "The extra item"} is saved. Tap the button below. If anything is missing, we will take you straight there.
          </span>
        </div>
        <strong style={{ fontSize: isCompactUpsellViewport ? 21 : 18, color: "#1F8FE0", whiteSpace: "nowrap" }}>
          {formatProductMoney(summaryTotal, chosenPackageCurrency)}
        </strong>
      </div>
      <button
        type="button"
        onClick={handleAdditionalItemFinishClick}
        disabled={publicOrderSubmitting}
        style={{
          width: "100%",
          minHeight: 54,
          border: "none",
          borderRadius: 14,
          background: reviewStepReady ? "#16a34a" : "#111827",
          color: "#ffffff",
          fontSize: 16,
          fontWeight: 900,
          cursor: publicOrderSubmitting ? "not-allowed" : "pointer",
          opacity: publicOrderSubmitting ? 0.75 : 1,
          boxShadow: "0 12px 28px rgba(15, 23, 42, 0.18)"
        }}
      >
        {publicOrderSubmitting
          ? "Submitting..."
          : reviewStepReady
            ? `Place order now - ${formatProductMoney(summaryTotal, chosenPackageCurrency)}`
            : additionalItemMissingCount > 0
              ? `Finish ${additionalItemMissingCount} missing detail${additionalItemMissingCount === 1 ? "" : "s"}`
              : "Continue to finish order"}
      </button>
      <span style={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
        Not sure about the extra item? You can remove it above and still complete the main order.
      </span>
    </div>
  ) : null;

  return (
    <main className="public-order-page">
      <style>{`
        @keyframes publicBumpNudge {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(6px); }
        }
        @keyframes publicBundleArrowBounce {
          0%, 100% { transform: translateY(0); opacity: 0.88; }
          50% { transform: translateY(4px); opacity: 1; }
        }
        @keyframes publicCtaArrowBounce {
          0%, 100% { transform: translateY(0); opacity: 0.82; }
          50% { transform: translateY(5px); opacity: 1; }
        }
        @keyframes publicInvalidFieldAlert {
          0% { transform: translateX(0); box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
          16% { transform: translateX(-6px); box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.08); }
          34% { transform: translateX(5px); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.14); }
          52% { transform: translateX(-4px); box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.12); }
          70% { transform: translateX(3px); box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.08); }
          100% { transform: translateX(0); box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
        }
        @keyframes publicSubmitButtonAlert {
          0%, 100% { transform: translateX(0) scale(1); }
          28% { transform: translateX(-4px) scale(1.01); }
          56% { transform: translateX(4px) scale(1.015); }
          78% { transform: translateX(-2px) scale(1.005); }
        }
        @keyframes publicRemovePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 rgba(239, 68, 68, 0); }
          50% { transform: scale(1.02); box-shadow: 0 10px 24px rgba(239, 68, 68, 0.18); }
        }
        @keyframes publicProofBadgeFloat {
          0%, 100% { transform: translateY(0) scale(1); box-shadow: 0 0 0 rgba(34, 197, 94, 0); }
          50% { transform: translateY(-2px) scale(1.02); box-shadow: 0 10px 24px rgba(34, 197, 94, 0.16); }
        }
        @keyframes publicAddOnBridgePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 14px 32px rgba(34, 197, 94, 0.16); }
          50% { transform: scale(1.01); box-shadow: 0 18px 40px rgba(34, 197, 94, 0.26); }
        }
        @keyframes publicSlotUrgencyPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(249, 115, 22, 0.24); }
          50% { transform: scale(1.04); box-shadow: 0 0 0 8px rgba(249, 115, 22, 0); }
        }
        @keyframes publicSlotProgressSweep {
          0% { transform: translateX(-120%); opacity: 0; }
          28% { opacity: 0.8; }
          100% { transform: translateX(160%); opacity: 0; }
        }
        @keyframes publicSlotIconSpark {
          0%, 100% { transform: rotate(-8deg) scale(1); }
          42% { transform: rotate(7deg) scale(1.12); }
        }
      `}</style>
      <section className="public-order-shell">
        {publicEmbedIsPreview ? (
          <div
            className="panel"
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              borderRadius: 12,
              fontSize: 13,
              color: "#1e3a8a",
              lineHeight: 1.45
            }}
          >
            <strong>{publicEmbedIsLocalTest ? "Local test mode" : "Preview mode"}</strong> · {publicEmbedIsLocalTest ? "Submissions on localhost will show a successful test order ID, but will not create real orders, notifications, stock movements, or abandoned-cart records." : "This form is open for testing only. Submissions here do not create real orders or abandoned-cart records."}
          </div>
        ) : null}
        {publicUpsellOffer ? (
          <div className="public-form-layout">
            <article className="panel public-order-card public-form-main public-form-clean" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: "16px 18px", background: "#ecfdf5", borderBottom: "1px solid #bbf7d0", fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#047857" }}>
                Order received · optional add-on
              </div>
              <div style={{ padding: 20, display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <span style={{ display: "inline-flex", width: "fit-content", padding: "6px 10px", borderRadius: 999, background: "#dcfce7", border: "1px solid #86efac", color: "#15803d", fontSize: 12, fontWeight: 800 }}>
                    Your main order is already saved
                  </span>
                  <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.15, color: "#111827" }}>
                    {publicUpsellOffer.companion.headline?.trim() || `Add ${publicUpsellOffer.product.name} before we call you?`}
                  </h2>
                  <p style={{ margin: 0, fontSize: 15, color: "#4b5563", lineHeight: 1.6 }}>
                    {publicUpsellOffer.companion.pitch?.trim() || "This is optional. If you add it now, we will include it with the order we already received."}
                  </p>
                </div>
                <div style={{ border: "1px solid #dbeafe", borderRadius: 18, background: "#f8fbff", padding: 18, display: "grid", gap: 12 }}>
                  {renderCompanionMedia(publicUpsellOffer.companion, publicUpsellOffer.product.name, publicUpsellOffer.targetPackage)}
                  {publicUpsellOffer.companion.badgeText?.trim() && (
                    <span style={{ display: "inline-flex", width: "fit-content", padding: "6px 10px", borderRadius: 999, background: "#dbeafe", color: "#1d4ed8", fontSize: 12, fontWeight: 800 }}>
                      {publicUpsellOffer.companion.badgeText}
                    </span>
                  )}
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 4 }}>
                      <strong style={{ fontSize: 20, color: "#111827" }}>
                        {companionDisplayName(publicUpsellOffer.companion, publicUpsellOffer.product, publicUpsellOffer.targetPackage)}
                      </strong>
                      <span style={{ fontSize: 13, color: "#6b7280", fontWeight: 700 }}>
                        {companionDisplayDetail(publicUpsellOffer.companion, publicUpsellOffer.targetPackage)}
                      </span>
                      {publicUpsellOffer.product.description && (
                        <span style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>
                          {publicUpsellOffer.product.description}
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280" }}>
                        Optional add-on
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: "#1F8FE0" }}>
                        {formatProductMoney(publicUpsellOffer.amount, publicUpsellOffer.currency)}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={publicUpsellSubmitting}
                      onClick={acceptPublicUpsell}
                      style={{ opacity: publicUpsellSubmitting ? 0.7 : 1, cursor: publicUpsellSubmitting ? "not-allowed" : "pointer" }}
                    >
                      {publicUpsellSubmitting
                        ? "Adding..."
                        : (publicUpsellOffer.companion.ctaText?.trim() || "Yes, add this too")}
                    </button>
                    <button
                      type="button"
                      onClick={declinePublicUpsell}
                      disabled={publicUpsellSubmitting}
                      style={{ border: "none", background: "transparent", color: "#6b7280", fontSize: 14, fontWeight: 700, textDecoration: "underline", cursor: publicUpsellSubmitting ? "not-allowed" : "pointer", opacity: publicUpsellSubmitting ? 0.7 : 1 }}
                    >
                      {publicUpsellOffer.companion.declineText?.trim() || "No thanks, show my order confirmation"}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>
        ) : publicOrderSubmitted ? (
          <div className="public-form-layout">
            <article className="panel public-order-card public-form-main public-form-clean" style={{ textAlign: "center" }}>
              <div style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, lineHeight: 1 }}>✓</div>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#111827", lineHeight: 1.2 }}>
                  Thank you{publicOrderSubmitted.customer ? `, ${publicOrderSubmitted.customer.split(" ")[0]}` : ""}!
                </h1>
                <p style={{ margin: 0, fontSize: 15, color: "#374151", maxWidth: 440, lineHeight: 1.5 }}>
                  {publicOrderSubmitted.mode === "local_test"
                    ? "Localhost test submission completed successfully. No real order, notification, stock movement, or abandoned-cart record was created."
                    : publicOrderSubmitted.mode === "preview_only"
                    ? "This preview submission was processed as a test only. No real order was created and nothing was recorded in your live order list."
                    : publicOrderSubmitted.mode === "browser_queue"
                    ? "We saved your request in this browser and will keep retrying automatically while the order system is offline. Please keep this tab open if possible."
                    : publicOrderSubmitted.mode === "outage_capture"
                    ? "We saved your request while the order system was temporarily offline. Our team will contact you shortly to confirm the details and arrange delivery."
                  : "Your order has been received and is being processed. Our team will contact you shortly to confirm the details and arrange delivery."}
                </p>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#f3f4f6", borderRadius: 999, fontSize: 13, fontWeight: 700, color: "#374151" }}>
                  {publicOrderSubmitted.mode === "local_test" ? "Test Order ID" : publicOrderSubmitted.mode === "preview_only" ? "Mode" : publicOrderSubmitted.mode === "browser_queue" ? "Saved Ref" : publicOrderSubmitted.mode === "outage_capture" ? "Backup Ref" : "Order ID"}: <span style={{ color: "#1F8FE0" }}>{publicOrderSubmitted.orderId}</span>
                </div>
                {publicRedirectUrl && publicOrderSubmitted.mode !== "local_test" && publicOrderSubmitted.mode !== "held_review" ? (
                  <p style={{ margin: 0, fontSize: 13, color: "#6b7280" }}>Redirecting…</p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPublicOrderSubmitted(null)}
                    style={{ marginTop: 8, padding: "10px 20px", background: "#1F8FE0", color: "white", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}
                  >
                    Place another order
                  </button>
                )}
              </div>
            </article>
          </div>
        ) : (
          <div className="public-form-layout">
            <article className="panel public-order-card public-form-main public-form-clean">
              {publicProduct.formCustomText?.trim() && (
                <div style={{ padding: "10px 12px", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 12, fontSize: 13, color: "#075985", whiteSpace: "pre-line", marginBottom: 12 }}>
                  {publicProduct.formCustomText}
                </div>
              )}
              {freeDeliverySlotBanner}

              {guidedCheckout && (
                <div
                  style={{
                    marginBottom: 14,
                    padding: isCompactUpsellViewport ? 16 : 14,
                    border: "1px solid #dbeafe",
                    background: "#f8fbff",
                    borderRadius: 18,
                    display: "grid",
                    gap: isCompactUpsellViewport ? 12 : 10
                  }}
                >
                  <div
                    style={
                      isCompactUpsellViewport
                        ? { display: "grid", gap: 6 }
                        : { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }
                    }
                  >
                    <strong style={{ fontSize: isCompactUpsellViewport ? 18 : 14, color: "#0f172a", lineHeight: 1.2 }}>Guided checkout</strong>
                    <span style={{ fontSize: isCompactUpsellViewport ? 14 : 12, fontWeight: 700, color: "#64748b", lineHeight: 1.45 }}>
                      Finish the 3 steps, then place your order
                    </span>
                  </div>
                  <div
                    style={
                      isCompactUpsellViewport
                        ? { display: "grid", gridTemplateColumns: "1fr", gap: 10 }
                        : { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }
                    }
                  >
                    {guidedSteps.map((step, index) => (
                      <div
                        key={step.key}
                        style={{
                          padding: isCompactUpsellViewport ? "12px 14px" : "12px 12px 10px",
                          borderRadius: 16,
                          border: step.done ? "1px solid #86efac" : step.active ? "1px solid #60a5fa" : "1px solid #e2e8f0",
                          background: step.done ? "#ecfdf5" : step.active ? "#eff6ff" : "#ffffff",
                          display: isCompactUpsellViewport ? "flex" : "grid",
                          gap: isCompactUpsellViewport ? 12 : 4,
                          alignItems: isCompactUpsellViewport ? "center" : undefined
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            color: step.done ? "#047857" : step.active ? "#1d4ed8" : "#94a3b8",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: isCompactUpsellViewport ? 58 : undefined,
                            minHeight: isCompactUpsellViewport ? 58 : undefined,
                            padding: isCompactUpsellViewport ? "0 10px" : undefined,
                            borderRadius: isCompactUpsellViewport ? 14 : undefined,
                            background: isCompactUpsellViewport
                              ? (step.done ? "#dcfce7" : step.active ? "#dbeafe" : "#f8fafc")
                              : undefined,
                            flexShrink: 0
                          }}
                        >
                          Step {index + 1}
                        </span>
                        <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                          <strong style={{ fontSize: isCompactUpsellViewport ? 18 : 14, color: "#0f172a", lineHeight: 1.2 }}>
                            {step.label}
                          </strong>
                          <span style={{ fontSize: isCompactUpsellViewport ? 13 : 12, lineHeight: 1.45, color: "#64748b" }}>
                            {step.helper}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="public-form-clean-grid">
                <input
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  value={publicHoneypot}
                  onChange={(event) => setPublicHoneypot(event.target.value)}
                  style={{ position: "absolute", left: "-9999px", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                />

                <label className="field-full">
                  <input
                    ref={setFieldRef("name") as any}
                    type="text"
                    name="name"
                    autoComplete="shipping name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    value={orderFormName}
                    onChange={(event) => {
                      setOrderFormName(event.target.value);
                      clearFieldError("name");
                    }}
                    placeholder="Your Name *"
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? "public-order-error-name" : undefined}
                    style={inputErrorStyle("name")}
                  />
                  {fieldErrors.name && (
                    <span id="public-order-error-name" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                      {fieldErrors.name}
                    </span>
                  )}
                </label>

                <label className="field-full">
                  <div className="phone-prefix-row" style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 14px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8, fontWeight: 700, fontSize: 14, color: "#111827", minWidth: 70, whiteSpace: "nowrap" }}>
                      +234
                    </span>
                    <input
                      ref={setFieldRef("phone") as any}
                      type="tel"
                      name="tel"
                      value={orderFormPhone}
                      onChange={(event) => {
                        setOrderFormPhone(event.target.value.replace(/[^\d\s\-]/g, ""));
                        clearFieldError("phone");
                      }}
                      placeholder="Your Phone Number *"
                      inputMode="tel"
                      enterKeyHint="next"
                      pattern="[0-9\\s\\-]{7,15}"
                      autoComplete="shipping tel-national"
                      aria-invalid={Boolean(fieldErrors.phone)}
                      aria-describedby={fieldErrors.phone ? "public-order-error-phone" : undefined}
                      style={{ flex: 1, ...inputErrorStyle("phone") }}
                    />
                  </div>
                  {fieldErrors.phone && (
                    <span id="public-order-error-phone" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                      {fieldErrors.phone}
                    </span>
                  )}
                </label>

                {settings.showWhatsapp && (
                  <label className="field-full">
                    <div className="phone-prefix-row" style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 14px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8, fontWeight: 700, fontSize: 14, color: "#111827", minWidth: 70, whiteSpace: "nowrap" }}>
                        +234
                      </span>
                      <input
                        ref={setFieldRef("whatsapp") as any}
                        type="tel"
                        name="mobile"
                        style={{ flex: 1, ...inputErrorStyle("whatsapp") }}
                        value={orderFormWhatsapp}
                        onChange={(event) => {
                          setOrderFormWhatsapp(sanitizePhoneDigitsInput(event.target.value));
                          clearFieldError("whatsapp");
                        }}
                        placeholder={`Your WhatsApp Number${settings.requireWhatsapp ? " *" : ""}`}
                        inputMode="tel"
                        enterKeyHint="next"
                        pattern="[0-9]{7,15}"
                        autoComplete="shipping tel-national"
                        maxLength={15}
                        aria-invalid={Boolean(fieldErrors.whatsapp)}
                        aria-describedby={fieldErrors.whatsapp ? "public-order-error-whatsapp" : undefined}
                      />
                    </div>
                    {orderFormPhone.trim() && sanitizePhoneDigitsInput(orderFormWhatsapp) !== sanitizePhoneDigitsInput(orderFormPhone) && (
                      <button
                        type="button"
                        className="!min-h-0"
                        onClick={() => {
                          setOrderFormWhatsapp(sanitizePhoneDigitsInput(orderFormPhone));
                          clearFieldError("whatsapp");
                        }}
                        style={{
                          marginTop: 8,
                          border: "1px solid #bbf7d0",
                          borderRadius: 999,
                          background: "#f0fdf4",
                          color: "#047857",
                          fontSize: 12,
                          fontWeight: 800,
                          padding: "7px 10px"
                        }}
                      >
                        Use phone number for WhatsApp
                      </button>
                    )}
                    {fieldErrors.whatsapp && (
                      <span id="public-order-error-whatsapp" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                        {fieldErrors.whatsapp}
                      </span>
                    )}
                  </label>
                )}

                {settings.showEmail && (
                  <label className="field-full">
                    <input
                      value={orderFormEmail}
                      onChange={(event) => setOrderFormEmail(event.target.value)}
                      placeholder="Your Email"
                      type="email"
                      name="email"
                      inputMode="email"
                      autoComplete="shipping email"
                      enterKeyHint="next"
                    />
                  </label>
                )}

                <label className="field-full">
                  <input
                    ref={setFieldRef("address") as any}
                    type="text"
                    name="street-address"
                    autoComplete="shipping street-address"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    value={orderFormAddress}
                    onChange={(event) => {
                      setOrderFormAddress(event.target.value);
                      clearFieldError("address");
                    }}
                    placeholder={`Your Address${settings.addressRequired ? " *" : ""}`}
                    aria-invalid={Boolean(fieldErrors.address)}
                    aria-describedby={fieldErrors.address ? "public-order-error-address" : undefined}
                    style={inputErrorStyle("address")}
                  />
                  {fieldErrors.address && (
                    <span id="public-order-error-address" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                      {fieldErrors.address}
                    </span>
                  )}
                </label>

                <label className="field-full">
                  <input
                    ref={setFieldRef("city") as any}
                    type="text"
                    name="address-level2"
                    autoComplete="shipping address-level2"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    value={orderFormCity}
                    onChange={(event) => {
                      setOrderFormCity(event.target.value);
                      clearFieldError("city");
                    }}
                    placeholder={`Your City${settings.cityRequired ? " *" : ""}`}
                    aria-invalid={Boolean(fieldErrors.city)}
                    aria-describedby={fieldErrors.city ? "public-order-error-city" : undefined}
                    style={inputErrorStyle("city")}
                  />
                  {fieldErrors.city && (
                    <span id="public-order-error-city" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                      {fieldErrors.city}
                    </span>
                  )}
                </label>

                <label className="field-full">
                  <select
                    ref={setFieldRef("state") as any}
                    name="address-level1"
                    autoComplete="shipping address-level1"
                    required
                    value={orderFormState}
                    onChange={(event) => {
                      setOrderFormState(event.target.value);
                      clearFieldError("state");
                    }}
                    aria-invalid={Boolean(fieldErrors.state)}
                    aria-describedby={fieldErrors.state ? "public-order-error-state" : undefined}
                    style={inputErrorStyle("state")}
                  >
                    <option value="" disabled>Select your state *</option>
                    {allowedStates.map((state) => (
                      <option key={state} value={state}>{state}</option>
                    ))}
                  </select>
                  {fieldErrors.state && (
                    <span id="public-order-error-state" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                      {fieldErrors.state}
                    </span>
                  )}
                </label>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: "#111827" }}>
                SELECT YOUR PACKAGE *
              </div>
              {publicProduct.packageDescription?.trim() && (
                <p
                  className="public-package-picker-note"
                  style={{
                    margin: "-2px 0 10px",
                    padding: "10px 12px",
                    border: "1px solid #dbeafe",
                    borderRadius: 14,
                    background: "#eff6ff",
                    color: "#1e3a8a",
                    fontSize: 13,
                    lineHeight: 1.45,
                    fontWeight: 700
                  }}
                >
                  {publicProduct.packageDescription.trim()}
                </p>
              )}
              <div className="package-picker package-picker-clean" style={{ display: "grid", gap: 12 }}>
                {orderablePublicPackages.length === 0 ? (
                  <div style={{ border: "1px solid #dbeafe", borderRadius: 18, padding: 16, background: "#eff6ff", color: "#1e3a8a" }}>
                    <strong style={{ display: "block", fontSize: 15 }}>
                      {!normalizedSelectedState
                        ? "Pick your state first"
                        : packageAvailabilityLoading
                          ? `Checking package availability in ${orderFormState}...`
                          : `No package is available in ${orderFormState} right now`}
                    </strong>
                    <span style={{ display: "block", marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
                      {!normalizedSelectedState
                        ? "Some combo packages only show after we know where delivery will happen."
                        : "Please choose another state or contact us so we can help you pick the right option."}
                    </span>
                  </div>
                ) : orderablePublicPackages.map((item) => {
                  const isSelected = orderFormPackageId === item.id;
                  // Packages with attribution_product_id (combo bundles under
                  // a single-tool parent) label with the attribution product's
                  // name, not the form's main product. Migration 088.
                  const itemAttributionProduct = item.attributionProductId
                    ? products.find((p) => p.id === item.attributionProductId)
                    : null;
                  const itemProductName = itemAttributionProduct?.name ?? publicProduct.name;
                  const title = settings.showPackageName ? item.name : `${itemProductName} x${item.quantity}`;
                  const isComboPackage = packageIsComboLike(item);
                  const imageUrls = isComboPackage ? packageImageList(item) : [];
                  const hasCarousel = imageUrls.length > 1;
                  const activeCarouselIndex = imageUrls.length > 0
                    ? Math.min(packageCarouselIndexById[item.id] ?? 0, imageUrls.length - 1)
                    : 0;
                  const activeImageUrl = imageUrls[activeCarouselIndex] ?? imageUrls[0];
                  const updateCarouselIndex = (
                    nextIndex: number,
                    event: { preventDefault: () => void; stopPropagation: () => void }
                  ) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!hasCarousel) return;
                    setPackageCarouselIndexById((prev) => ({
                      ...prev,
                      [item.id]: (nextIndex + imageUrls.length) % imageUrls.length
                    }));
                  };
                  const componentSummary = packageComponentSummary(item, products);
                  const packageDescriptionText = item.description.trim();
                  const packageDetailText = packageDescriptionText || componentSummary || `${item.quantity} ${item.quantity === 1 ? "unit" : "units"}`;
                  const freeGiftItems = packageFreeGiftItems(item, products);
                  const freeGiftQuantity = freeGiftItems.reduce((sum, gift) => sum + gift.quantity, 0);
                  const freeGiftBadge = `${freeGiftQuantity} FREE GIFT${freeGiftQuantity === 1 ? "" : "S"}`;
                  const isFeatured = item.featuredComboCard || (isComboPackage && hasCarousel);
                  return (
                    <div
                      key={item.id}
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={0}
                      className={`public-package-option${isFeatured ? " public-package-option--featured" : " public-package-option--compact"}${imageUrls.length > 0 ? " public-package-option--with-media" : ""}${isSelected ? " public-package-option--selected" : ""}`}
                      onClick={(event) => {
                        if ((event.target as HTMLElement).closest("button")) return;
                        setOrderFormPackageId(item.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        setOrderFormPackageId(item.id);
                      }}
                      style={{
                        display: "grid",
                        gap: 12,
                        padding: 14,
                        cursor: "pointer",
                        border: `2px solid ${isSelected ? "#1F8FE0" : isFeatured ? "#f59e0b" : "#e5e7eb"}`,
                        borderRadius: 20,
                        background: isSelected ? "#eff6ff" : isFeatured ? "#fffbeb" : "#ffffff",
                        boxShadow: isSelected ? "0 16px 38px rgba(31, 143, 224, 0.16)" : "0 10px 30px rgba(15, 23, 42, 0.08)"
                      }}
                    >
                      {imageUrls.length > 0 && (
                        <div className="public-package-option__media" style={{ position: "relative", display: "grid", gap: 8 }}>
                          <div
                            style={{
                              position: "relative",
                              width: "100%",
                              aspectRatio: "1 / 1",
                              borderRadius: 16,
                              overflow: "hidden",
                              border: "1px solid rgba(148, 163, 184, 0.28)",
                              background: "#f8fafc"
                            }}
                          >
                            <img
                              src={activeImageUrl}
                              alt=""
                              aria-hidden="true"
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                filter: "blur(28px) brightness(0.92)",
                                transform: "scale(1.15)",
                                opacity: 0.65
                              }}
                            />
                            <img
                              className="public-package-option__image"
                              src={activeImageUrl}
                              alt={`${title} preview ${activeCarouselIndex + 1}`}
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "contain"
                              }}
                            />
                            {isSelected && isComboPackage && (
                              <span className="public-package-option__selected-ribbon">
                                Selected combo
                              </span>
                            )}
                            {hasCarousel && (
                              <>
                                <button
                                  type="button"
                                  className="public-package-option__side-nav public-package-option__side-nav--prev"
                                  aria-label={`Show previous ${title} photo`}
                                  onClick={(event) => updateCarouselIndex(activeCarouselIndex - 1, event)}
                                />
                                <button
                                  type="button"
                                  className="public-package-option__side-nav public-package-option__side-nav--next"
                                  aria-label={`Show next ${title} photo`}
                                  onClick={(event) => updateCarouselIndex(activeCarouselIndex + 1, event)}
                                />
                              </>
                            )}
                          </div>
                          {hasCarousel && (
                            <>
                              <div className="public-package-option__photo-dots" aria-label={`${title} photo selector`}>
                                {imageUrls.map((_, imageIndex) => (
                                  <button
                                    key={`${item.id}-dot-${imageIndex}`}
                                    type="button"
                                    className={imageIndex === activeCarouselIndex ? "is-active" : ""}
                                    aria-label={`Show ${title} photo ${imageIndex + 1}`}
                                    onClick={(event) => updateCarouselIndex(imageIndex, event)}
                                  />
                                ))}
                              </div>
                              <div className="public-package-option__thumbnails" aria-label={`${title} photos`}>
                                {imageUrls.map((imageUrl, imageIndex) => (
                                  <button
                                    key={`${item.id}-thumb-${imageIndex}`}
                                    type="button"
                                    className={imageIndex === activeCarouselIndex ? "is-active" : ""}
                                    aria-label={`Show ${title} photo ${imageIndex + 1}`}
                                    onClick={(event) => updateCarouselIndex(imageIndex, event)}
                                  >
                                    <img src={imageUrl} alt="" aria-hidden="true" />
                                  </button>
                                ))}
                              </div>
                              <div className="public-package-option__gallery-nav" aria-label={`${title} photo navigation`}>
                                <button
                                  type="button"
                                  aria-label={`Show previous ${title} photo`}
                                  onClick={(event) => updateCarouselIndex(activeCarouselIndex - 1, event)}
                                >
                                  Previous
                                </button>
                                <span>Tap thumbnails or use Next</span>
                                <button
                                  type="button"
                                  aria-label={`Show next ${title} photo`}
                                  onClick={(event) => updateCarouselIndex(activeCarouselIndex + 1, event)}
                                >
                                  Next
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      <div className="public-package-option__meta" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "start", gap: 12 }}>
                        <input
                          type="radio"
                          name="public-package"
                          checked={isSelected}
                          onChange={() => setOrderFormPackageId(item.id)}
                          style={{ marginTop: 4, accentColor: "#1F8FE0" }}
                        />
                        <div className="public-package-option__copy" style={{ display: "grid", gap: 6, minWidth: 0 }}>
                          <div className="public-package-option__badges" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {isSelected && isComboPackage && (
                              <span className="public-package-option__selected-chip">
                                Selected combo
                              </span>
                            )}
                            {freeGiftQuantity > 0 && (
                              <span className="public-package-option__gift-chip">
                                {freeGiftBadge}
                              </span>
                            )}
                            {item.featuredComboCard && (
                              <span style={{ display: "inline-flex", width: "fit-content", borderRadius: 999, padding: "3px 8px", background: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em" }}>
                                FEATURED COMBO
                              </span>
                            )}
                            {item.requiresStateStock && (
                              <span style={{ display: "inline-flex", width: "fit-content", borderRadius: 999, padding: "3px 8px", background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em" }}>
                                STATE STOCK CHECKED
                              </span>
                            )}
                          </div>
                          <div className="public-package-option__title" style={{ fontWeight: 900, fontSize: 17, color: "#111827", lineHeight: 1.2 }}>{title}</div>
                          <div className={`public-package-option__description ${packageDescriptionText ? "public-package-option__description--custom" : "public-package-option__description--fallback"}`} style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.5 }}>
                            {packageDetailText}
                          </div>
                          {componentSummary && packageDescriptionText && (
                            <div className="public-package-option__components" style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.45 }}>{componentSummary}</div>
                          )}
                          {freeGiftItems.length > 0 && (
                            <div className="public-package-option__free-gifts">
                              <strong>Free gift included:</strong>
                              <span>{freeGiftItems.map((gift) => gift.label).join(" + ")}</span>
                            </div>
                          )}
                          {hasCarousel && (
                            <div className="public-package-option__swipe" style={{ fontSize: 12, color: "#92400e", fontWeight: 800 }}>
                              Tap any photo thumbnail to view all {imageUrls.length} pictures
                            </div>
                          )}
                        </div>
                        <strong className="public-package-option__price" style={{ fontSize: 18, color: "#111827", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                          {formatProductMoney(item.price, item.currency)}
                        </strong>
                      </div>
                    </div>
                  );
                })}
              </div>

              {(showcaseCompanionOptions.length > 0 || compactCompanionOptions.length > 0 || cardCompanionGroups.length > 0) && (
                <div style={{ display: "grid", gap: 4, textAlign: "center", marginTop: 16 }}>
                  <strong style={{ fontSize: 22, color: "#111827", lineHeight: 1.25 }}>
                    Before you submit, add these discounted extras to your order
                  </strong>
                  <span style={{ fontSize: 13, color: "#475569", lineHeight: 1.55 }}>
                    Tap any item below to preview the demo, see the bundle choices, and add it to your order.
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: "#b45309",
                      lineHeight: 1.5,
                      fontWeight: 700,
                      background: "#fff7ed",
                      border: "1px solid #fdba74",
                      borderRadius: 12,
                      padding: "8px 10px",
                      maxWidth: 620,
                      margin: "4px auto 0"
                    }}
                  >
                    These discounted additional items only apply when you add them with the main offer. They are not available as stand-alone purchases at this discounted price.
                  </span>
                </div>
              )}

              {showcaseCompanionOptions.length > 0 && (
                <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
                  {showcaseCompanionOptions.map((companion, index) => {
                    const product = products.find((item) => item.id === companion.productId);
                    if (!product) return null;
                    const targetPackage = targetPackageForCompanion(companion, products);
                    const imageUrls = companionShowcaseImageList(companion, targetPackage);
                    const hasCarousel = imageUrls.length > 1;
                    const companionKey = companionSelectionKey(companion);
                    const activeCarouselIndex = imageUrls.length > 0
                      ? Math.min(companionCarouselIndexByKey[companionKey] ?? 0, imageUrls.length - 1)
                      : 0;
                    const activeImageUrl = imageUrls[activeCarouselIndex] ?? imageUrls[0];
                    const updateCarouselIndex = (
                      nextIndex: number,
                      event: { preventDefault: () => void; stopPropagation: () => void }
                    ) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!hasCarousel) return;
                      setCompanionCarouselIndexByKey((prev) => ({
                        ...prev,
                        [companionKey]: (nextIndex + imageUrls.length) % imageUrls.length
                      }));
                    };
                    const selected = isOrderFormCrossSellSelected(companion);
                    const currency = targetPackage?.currency ?? primaryPricing(product)?.currency ?? "NGN";
                    const total = companionLineTotal(companion, product, targetPackage);
                    const standardUnit = targetPackage?.price ?? primaryPricing(product)?.sellingPrice ?? 0;
                    const standardTotal = standardUnit * Math.max(1, Number(companion.quantity) || 1);
                    const savings = Math.max(0, standardTotal - total);
                    const discountPercent = companionDiscountPercent(standardTotal, total);
                    const title = targetPackage?.name || product.name;
                    const componentSummary = targetPackage ? packageComponentSummary(targetPackage, products) : "";
                    const packageDescriptionText = targetPackage?.description.trim() ?? "";
                    const packageDetailText = packageDescriptionText || companion.pitch?.trim() || companionDisplayDetail(companion, targetPackage);
                    const freeGiftItems = targetPackage ? packageFreeGiftItems(targetPackage, products) : [];
                    const freeGiftQuantity = freeGiftItems.reduce((sum, gift) => sum + gift.quantity, 0);
                    const freeGiftBadge = `${freeGiftQuantity} FREE GIFT${freeGiftQuantity === 1 ? "" : "S"}`;
                    const badgeText = companion.badgeText?.trim();
                    const isFeatured = Boolean(targetPackage?.featuredComboCard || badgeText || hasCarousel);
                    const selectOffer = () => setOrderFormCrossSellSelection(companion, !selected, { exclusiveProduct: true });
                    return (
                      <div
                        key={`${companionKey}-${index}`}
                        role="checkbox"
                        aria-checked={selected}
                        tabIndex={0}
                        className={`public-package-option${isFeatured ? " public-package-option--featured" : " public-package-option--compact"}${imageUrls.length > 0 ? " public-package-option--with-media" : ""}${selected ? " public-package-option--selected" : ""}`}
                        onClick={(event) => {
                          if ((event.target as HTMLElement).closest("button,input")) return;
                          selectOffer();
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          selectOffer();
                        }}
                        style={{
                          display: "grid",
                          gap: 12,
                          padding: 14,
                          cursor: "pointer",
                          border: `2px solid ${selected ? "#1F8FE0" : isFeatured ? "#f59e0b" : "#e5e7eb"}`,
                          borderRadius: 20,
                          background: selected ? "#eff6ff" : isFeatured ? "#fffbeb" : "#ffffff",
                          boxShadow: selected ? "0 16px 38px rgba(31, 143, 224, 0.16)" : "0 10px 30px rgba(15, 23, 42, 0.08)"
                        }}
                      >
                        {imageUrls.length > 0 && (
                          <div className="public-package-option__media" style={{ position: "relative", display: "grid", gap: 8 }}>
                            <div
                              style={{
                                position: "relative",
                                width: "100%",
                                aspectRatio: "1 / 1",
                                borderRadius: 16,
                                overflow: "hidden",
                                border: "1px solid rgba(148, 163, 184, 0.28)",
                                background: "#ffffff"
                              }}
                            >
                              <img
                                src={activeImageUrl}
                                alt=""
                                aria-hidden="true"
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                  filter: "blur(28px) brightness(0.96)",
                                  transform: "scale(1.15)",
                                  opacity: 0.48
                                }}
                              />
                              <img
                                className="public-package-option__image"
                                src={activeImageUrl}
                                alt={`${title} add-on preview ${activeCarouselIndex + 1}`}
                                style={{
                                  position: "absolute",
                                  inset: 0,
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "contain"
                                }}
                              />
                              {selected && (
                                <span className="public-package-option__selected-ribbon">
                                  Added to order
                                </span>
                              )}
                              {hasCarousel && (
                                <>
                                  <button
                                    type="button"
                                    className="public-package-option__side-nav public-package-option__side-nav--prev"
                                    aria-label={`Show previous ${title} photo`}
                                    onClick={(event) => updateCarouselIndex(activeCarouselIndex - 1, event)}
                                  />
                                  <button
                                    type="button"
                                    className="public-package-option__side-nav public-package-option__side-nav--next"
                                    aria-label={`Show next ${title} photo`}
                                    onClick={(event) => updateCarouselIndex(activeCarouselIndex + 1, event)}
                                  />
                                </>
                              )}
                            </div>
                            {hasCarousel && (
                              <>
                                <div className="public-package-option__photo-dots" aria-label={`${title} photo selector`}>
                                  {imageUrls.map((_, imageIndex) => (
                                    <button
                                      key={`${companionKey}-dot-${imageIndex}`}
                                      type="button"
                                      className={imageIndex === activeCarouselIndex ? "is-active" : ""}
                                      aria-label={`Show ${title} photo ${imageIndex + 1}`}
                                      onClick={(event) => updateCarouselIndex(imageIndex, event)}
                                    />
                                  ))}
                                </div>
                                <div className="public-package-option__thumbnails" aria-label={`${title} photos`}>
                                  {imageUrls.map((imageUrl, imageIndex) => (
                                    <button
                                      key={`${companionKey}-thumb-${imageIndex}`}
                                      type="button"
                                      className={imageIndex === activeCarouselIndex ? "is-active" : ""}
                                      aria-label={`Show ${title} photo ${imageIndex + 1}`}
                                      onClick={(event) => updateCarouselIndex(imageIndex, event)}
                                    >
                                      <img src={imageUrl} alt="" aria-hidden="true" />
                                    </button>
                                  ))}
                                </div>
                                <div className="public-package-option__gallery-nav" aria-label={`${title} photo navigation`}>
                                  <button
                                    type="button"
                                    aria-label={`Show previous ${title} photo`}
                                    onClick={(event) => updateCarouselIndex(activeCarouselIndex - 1, event)}
                                  >
                                    Previous
                                  </button>
                                  <span>Tap thumbnails or use Next</span>
                                  <button
                                    type="button"
                                    aria-label={`Show next ${title} photo`}
                                    onClick={(event) => updateCarouselIndex(activeCarouselIndex + 1, event)}
                                  >
                                    Next
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                        <div className="public-package-option__meta" style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "start", gap: 12 }}>
                          <input
                            type="radio"
                            name={`public-showcase-addon-${companion.productId}`}
                            checked={selected}
                            readOnly
                            onClick={(event) => {
                              event.stopPropagation();
                              selectOffer();
                            }}
                            style={{ marginTop: 4, accentColor: "#1F8FE0" }}
                          />
                          <div className="public-package-option__copy" style={{ display: "grid", gap: 6, minWidth: 0 }}>
                            <div className="public-package-option__badges" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {selected && (
                                <span className="public-package-option__selected-chip">
                                  Added
                                </span>
                              )}
                              {badgeText ? (
                                <span style={{ display: "inline-flex", width: "fit-content", borderRadius: 999, padding: "3px 8px", background: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                                  {badgeText}
                                </span>
                              ) : targetPackage?.featuredComboCard ? (
                                <span style={{ display: "inline-flex", width: "fit-content", borderRadius: 999, padding: "3px 8px", background: "#fef3c7", color: "#92400e", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em" }}>
                                  FEATURED COMBO
                                </span>
                              ) : null}
                              {targetPackage?.requiresStateStock && (
                                <span style={{ display: "inline-flex", width: "fit-content", borderRadius: 999, padding: "3px 8px", background: "#dcfce7", color: "#166534", fontSize: 11, fontWeight: 900, letterSpacing: "0.04em" }}>
                                  STATE STOCK CHECKED
                                </span>
                              )}
                              {freeGiftQuantity > 0 && (
                                <span className="public-package-option__gift-chip">
                                  {freeGiftBadge}
                                </span>
                              )}
                            </div>
                            <div className="public-package-option__title" style={{ fontWeight: 900, fontSize: 17, color: "#111827", lineHeight: 1.2 }}>{title}</div>
                            <div className={`public-package-option__description ${packageDescriptionText ? "public-package-option__description--custom" : "public-package-option__description--fallback"}`} style={{ fontSize: 13, color: "#4b5563", lineHeight: 1.5 }}>
                              {packageDetailText}
                            </div>
                            {componentSummary && packageDescriptionText && (
                              <div className="public-package-option__components" style={{ fontSize: 12, color: "#6b7280", lineHeight: 1.45 }}>{componentSummary}</div>
                            )}
                            {freeGiftItems.length > 0 && (
                              <div className="public-package-option__free-gifts">
                                <strong>Free gift included:</strong>
                                <span>{freeGiftItems.map((gift) => gift.label).join(" + ")}</span>
                              </div>
                            )}
                            {companion.pitch?.trim() && packageDescriptionText && (
                              <div style={{ fontSize: 12, color: "#92400e", fontWeight: 800, lineHeight: 1.45 }}>
                                {companion.pitch.trim()}
                              </div>
                            )}
                            {hasCarousel && (
                              <div className="public-package-option__swipe" style={{ fontSize: 12, color: "#92400e", fontWeight: 800 }}>
                                Tap any photo thumbnail to view all {imageUrls.length} pictures
                              </div>
                            )}
                          </div>
                          <div style={{ display: "grid", justifyItems: "end", gap: 4, minWidth: 86 }}>
                            <strong className="public-package-option__price" style={{ fontSize: 18, color: "#111827", whiteSpace: "nowrap", lineHeight: 1.2 }}>
                              {companion.pricingMode === "free" ? "FREE" : formatProductMoney(total, currency)}
                            </strong>
                            {savings > 0 && companion.pricingMode !== "free" && (
                              <span style={{ fontSize: 11, fontWeight: 800, color: "#047857", whiteSpace: "nowrap" }}>
                                Save {formatProductMoney(savings, currency)}{discountPercent > 0 ? ` · ${discountPercent}% off` : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {compactCompanionOptions.length > 0 && (
                <div className="cross-sell-picker" style={{ padding: 12, border: "1px solid #1F8FE040", background: "#eff6ff", borderRadius: 12, marginTop: 16 }}>
                  <strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>Add Extra Item to your order</strong>
                  {compactCompanionOptions.map((companion, index) => {
                    const product = products.find((item) => item.id === companion.productId);
                    if (!product) return null;
                    const targetPackage = targetPackageForCompanion(companion, products);
                    const currency = primaryPricing(product)?.currency ?? "NGN";
                    const total = companionLineTotal(companion, product, targetPackage);
                    const selected = isOrderFormCrossSellSelected(companion);
                    const media = renderCompanionMedia(companion, product.name, targetPackage);
                    return (
                      <label
                        key={`${companionSelectionKey(companion)}-${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: media ? "112px 1fr auto" : "1fr auto",
                          alignItems: "center",
                          gap: 12,
                          padding: "10px 0",
                          fontSize: 13,
                          borderTop: index === 0 ? "1px solid #dbeafe" : "1px solid #dbeafe"
                        }}
                      >
                        {media && (
                          <div style={{ width: 112, minWidth: 112 }}>
                            {media}
                          </div>
                        )}
                        <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
                          <strong style={{ fontSize: 16, color: "#111827" }}>{companionDisplayName(companion, product, targetPackage)}</strong>
                          <span style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.45 }}>
                            {companionDisplayDetail(companion, targetPackage)}
                            {companion.pitch?.trim() ? ` · ${companion.pitch.trim()}` : ""}
                          </span>
                          <span style={{ fontSize: 16, fontWeight: 800, color: "#111827" }}>
                            {companion.pricingMode === "free" ? "FREE" : formatProductMoney(total, currency)}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => setOrderFormCrossSellSelection(companion, !selected)}
                          style={{ width: 22, height: 22, accentColor: "#1F8FE0" }}
                        />
                      </label>
                    );
                  })}
                </div>
              )}

              {cardCompanionGroups.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                  <div style={{ border: "2px solid #cbd5e1", borderRadius: 22, background: "#f8fafc", padding: 14, display: "grid", gap: 14 }}>
                    <div style={{ display: "grid", gap: 12 }}>
                      {cardCompanionGroups.map((group, index) => {
                        const product = group.product;
                        if (!product) return null;
                        const hasVariantChoices = group.companions.length > 1;
                        const selectedVariant = group.companions.find((companion) => isOrderFormCrossSellSelected(companion)) ?? null;
                        const previewCompanion = selectedVariant ?? group.companions[0];
                        const previewTargetPackage = targetPackageForCompanion(previewCompanion, products);
                        const currency = primaryPricing(product)?.currency ?? "NGN";
                        const teaserTotal = companionLineTotal(previewCompanion, product, previewTargetPackage);
                        const isExpanded = expandedCardCompanionProductId === product.id;
                        const displayCompanion = selectedVariant ?? group.companions[0];
                        const displayTargetPackage = targetPackageForCompanion(displayCompanion, products);
                        const total = companionLineTotal(displayCompanion, product, displayTargetPackage);
                        const standard = displayTargetPackage?.price ?? primaryPricing(product)?.sellingPrice ?? 0;
                        const standardTotal = standard * displayCompanion.quantity;
                        const savings = Math.max(0, standardTotal - total);
                        const discountPercent = companionDiscountPercent(standardTotal, total);
                        const teaserOfferLabel = companionOfferPriceLabel(previewCompanion, teaserTotal, currency, previewTargetPackage);
                        const displayOfferLabel = companionOfferPriceLabel(displayCompanion, total, currency, displayTargetPackage);
                        const media = renderCompanionMedia(displayCompanion, product.name, displayTargetPackage);
                        const socialProofUi = companionSocialProofUi(displayCompanion);
                        const teaserCtaLabel = selectedVariant
                          ? "Already added"
                          : isExpanded
                            ? "Tap to close preview"
                            : hasVariantChoices
                              ? `Add from ${teaserOfferLabel}`
                              : `Add ${teaserOfferLabel}`;
                        const mobileTeaserCtaLabel = selectedVariant
                          ? "Already added"
                          : isExpanded
                            ? "Close preview"
                            : hasVariantChoices
                              ? "Choose your bundle"
                              : "Add this now";
                        const detailCtaLabel = displayCompanion.pricingMode === "free"
                          ? `Add ${companionOfferUnits(displayCompanion, displayTargetPackage)} FREE`
                          : `Add ${displayOfferLabel}`;
                        return (
                          <div key={`${product.id}-${index}`} style={{ display: "grid", gap: 10 }}>
                            <button
                              type="button"
                              onClick={() => setExpandedCardCompanionProductId((current) => current === product.id ? null : product.id)}
                              style={{
                                width: "100%",
                                border: isExpanded ? "2px solid #1F8FE0" : "1px solid #dbe4ef",
                                background: isExpanded ? "#eef6ff" : "#ffffff",
                                borderRadius: 22,
                                padding: 14,
                                textAlign: "left",
                                cursor: "pointer",
                                display: "grid",
                                gap: 12,
                                boxShadow: isExpanded ? "0 12px 28px rgba(31, 143, 224, 0.12)" : "0 8px 24px rgba(15, 23, 42, 0.06)"
                              }}
                            >
                              <div
                                style={
                                  isCompactUpsellViewport
                                    ? { display: "grid", gap: 14 }
                                    : { display: "grid", gridTemplateColumns: "120px 1fr", gap: 14, alignItems: "center" }
                                }
                              >
                                {isCompactUpsellViewport ? (
                                  <>
                                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                                      <strong style={{ fontSize: 22, lineHeight: 1.08, color: "#111827", flex: 1, minWidth: 0 }}>
                                        {product.name}
                                      </strong>
                                      <span
                                        style={{
                                          flexShrink: 0,
                                          padding: "7px 11px",
                                          borderRadius: 999,
                                          background: "#fef3c7",
                                          color: "#b45309",
                                          fontSize: 11,
                                          fontWeight: 900,
                                          letterSpacing: "0.04em",
                                          textTransform: "uppercase"
                                        }}
                                      >
                                        {(previewCompanion.badgeText?.trim() || "Promo").slice(0, 24)}
                                      </span>
                                    </div>
                                    <span style={{ fontSize: 15, color: "#64748b", lineHeight: 1.55 }}>
                                      {previewCompanion.pitch?.trim() || "Quick extra additional item that fits this order."}
                                    </span>
                                    <div style={{ width: "100%", maxWidth: 240, justifySelf: "center" }}>
                                      {renderCompanionTeaserVisual(previewCompanion, product.name, previewTargetPackage)}
                                    </div>
                                    {(socialProofUi.badgeText || socialProofUi.stats.length > 0) && (
                                      <div style={{ display: "grid", gap: 6 }}>
                                        {socialProofUi.badgeText && (
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              justifySelf: "start",
                                              padding: "7px 12px",
                                              borderRadius: 999,
                                              background: "#ecfdf3",
                                              border: "1px solid #86efac",
                                              color: "#15803d",
                                              fontSize: 11,
                                              fontWeight: 800,
                                              animation: "publicProofBadgeFloat 2.8s ease-in-out infinite"
                                            }}
                                          >
                                            {socialProofUi.badgeText}
                                          </span>
                                        )}
                                        {socialProofUi.stats.length > 0 && (
                                          <span
                                            style={{
                                              display: "block",
                                              fontSize: 11,
                                              fontWeight: 700,
                                              lineHeight: 1.5,
                                              color: "#475569"
                                            }}
                                          >
                                            {socialProofUi.stats.join(" · ")}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    <div style={{ display: "grid", gap: 6 }}>
                                      <strong style={{ fontSize: 19, color: "#111827", lineHeight: 1.2 }}>
                                        {teaserOfferLabel}
                                      </strong>
                                      {savings > 0 && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                          <span style={{ fontSize: 12, color: "#94a3b8", textDecoration: "line-through" }}>
                                            {formatProductMoney(standardTotal, currency)}
                                          </span>
                                          <span style={{ fontSize: 11, fontWeight: 800, color: "#047857" }}>
                                            Save {formatProductMoney(savings, currency)}{discountPercent > 0 ? ` · ${discountPercent}% off` : ""}
                                          </span>
                                        </div>
                                      )}
                                      <span style={{ fontSize: 12, fontWeight: 700, color: "#b45309", lineHeight: 1.5 }}>
                                        {(displayCompanion.urgencyMode ?? "standard") === "price_loss" && savings > 0
                                          ? `If you skip this, it'll cost you ${formatProductMoney(standardTotal, currency)} later. This ${formatProductMoney(teaserTotal, currency)} price disappears the moment you submit.`
                                          : "Special price only when added with the main offer"}
                                      </span>
                                      {group.companions.length > 1 && (
                                        <span style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                          {group.companions.length} bundle choices inside
                                        </span>
                                      )}
                                    </div>
                                    <span style={{ display: "grid", gap: 6, justifyItems: "stretch" }}>
                                      {!selectedVariant && (
                                        <span
                                          aria-hidden="true"
                                          style={{
                                            display: "inline-flex",
                                            justifySelf: "center",
                                            fontSize: 22,
                                            lineHeight: 1,
                                            color: "#f97316",
                                            textShadow: "0 4px 14px rgba(249, 115, 22, 0.28)",
                                            animation: "publicCtaArrowBounce 1.1s ease-in-out infinite"
                                          }}
                                        >
                                          ↓
                                        </span>
                                      )}
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          padding: "14px 18px",
                                          borderRadius: 999,
                                          background: selectedVariant ? "#16a34a" : "#2563eb",
                                          color: "#ffffff",
                                          fontSize: 15,
                                          fontWeight: 800,
                                          minHeight: 58,
                                          width: "100%",
                                          lineHeight: 1.3,
                                          textAlign: "center"
                                        }}
                                      >
                                        {mobileTeaserCtaLabel}
                                      </span>
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <div style={{ width: 120 }}>
                                      {renderCompanionTeaserVisual(previewCompanion, product.name, previewTargetPackage)}
                                    </div>
                                    <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
                                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                                        <strong style={{ fontSize: 19, lineHeight: 1.15, color: "#111827", maxWidth: 220 }}>
                                          {product.name}
                                        </strong>
                                        <span
                                          style={{
                                            flexShrink: 0,
                                            padding: "6px 10px",
                                            borderRadius: 999,
                                            background: "#fef3c7",
                                            color: "#b45309",
                                            fontSize: 11,
                                            fontWeight: 900,
                                            letterSpacing: "0.04em",
                                            textTransform: "uppercase"
                                          }}
                                        >
                                          {(previewCompanion.badgeText?.trim() || "Promo").slice(0, 24)}
                                        </span>
                                      </div>
                                      <span style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5, maxWidth: 360 }}>
                                        {previewCompanion.pitch?.trim() || "Quick extra additional item that fits this order."}
                                      </span>
                                      {(socialProofUi.badgeText || socialProofUi.stats.length > 0) && (
                                        <div style={{ display: "grid", gap: 6 }}>
                                          {socialProofUi.badgeText && (
                                            <span
                                              style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                padding: "5px 9px",
                                                borderRadius: 999,
                                                background: "#ecfdf3",
                                                border: "1px solid #86efac",
                                                color: "#15803d",
                                                fontSize: 11,
                                                fontWeight: 800,
                                                animation: "publicProofBadgeFloat 2.8s ease-in-out infinite"
                                              }}
                                            >
                                              {socialProofUi.badgeText}
                                            </span>
                                          )}
                                          {socialProofUi.stats.length > 0 && (
                                            <span
                                              style={{
                                                display: "block",
                                                fontSize: 11,
                                                fontWeight: 700,
                                                lineHeight: 1.45,
                                                color: "#475569"
                                              }}
                                            >
                                              {socialProofUi.stats.join(" · ")}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                        <div style={{ display: "grid", gap: 4 }}>
                                          <strong style={{ fontSize: 18, color: "#111827" }}>
                                            {teaserOfferLabel}
                                          </strong>
                                          {savings > 0 && (
                                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                              <span style={{ fontSize: 12, color: "#94a3b8", textDecoration: "line-through" }}>
                                                {formatProductMoney(standardTotal, currency)}
                                              </span>
                                              <span style={{ fontSize: 11, fontWeight: 800, color: "#047857" }}>
                                                Save {formatProductMoney(savings, currency)}{discountPercent > 0 ? ` · ${discountPercent}% off` : ""}
                                              </span>
                                            </div>
                                          )}
                                          <span style={{ fontSize: 10, fontWeight: 700, color: "#b45309", lineHeight: 1.45 }}>
                                            {(displayCompanion.urgencyMode ?? "standard") === "price_loss" && savings > 0
                                              ? `If you skip this, it'll cost you ${formatProductMoney(standardTotal, currency)} later. This ${formatProductMoney(teaserTotal, currency)} price disappears the moment you submit.`
                                              : "Special price only when added with the main offer"}
                                          </span>
                                          {group.companions.length > 1 && (
                                            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                              {group.companions.length} bundle choices inside
                                            </span>
                                          )}
                                        </div>
                                        <span style={{ display: "grid", justifyItems: "center", gap: 4 }}>
                                          {!selectedVariant && (
                                            <span
                                              aria-hidden="true"
                                              style={{
                                                display: "inline-flex",
                                                fontSize: 22,
                                                lineHeight: 1,
                                                color: "#f97316",
                                                textShadow: "0 4px 14px rgba(249, 115, 22, 0.28)",
                                                animation: "publicCtaArrowBounce 1.1s ease-in-out infinite"
                                              }}
                                            >
                                              ↓
                                            </span>
                                          )}
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              padding: "11px 18px",
                                              borderRadius: 999,
                                              background: selectedVariant ? "#16a34a" : "#2563eb",
                                              color: "#ffffff",
                                              fontSize: 13,
                                              fontWeight: 800,
                                              minWidth: 170
                                            }}
                                          >
                                            {teaserCtaLabel}
                                          </span>
                                        </span>
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            </button>
                            {isExpanded && (
                              <div style={{ border: "2px solid #1F8FE0", borderRadius: 18, overflow: "hidden", background: "#f8fbff" }}>
                                <div style={{ background: "#1F8FE0", color: "white", padding: "9px 14px", fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                                  {(displayCompanion.badgeText && displayCompanion.badgeText.trim()) || "Add this too"}
                                </div>
                                <div style={{ padding: 16, display: "grid", gap: 12 }}>
                                  {media}
                                  <div style={{ display: "grid", gap: 6 }}>
                                    <strong style={{ fontSize: 18, color: "#111827" }}>
                                      {companionDisplayName(displayCompanion, product, displayTargetPackage)}
                                    </strong>
                                    <span
                                      style={{
                                        fontSize: 13,
                                        color: "#6b7280",
                                        fontWeight: 700,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 8
                                      }}
                                    >
                                      {hasVariantChoices
                                        ? (
                                          <>
                                            <span>Choose the bundle you want below</span>
                                            <span
                                              aria-hidden="true"
                                              style={{
                                                display: "inline-flex",
                                                fontSize: 16,
                                                lineHeight: 1,
                                                color: "#1F8FE0",
                                                animation: "publicBundleArrowBounce 1.1s ease-in-out infinite"
                                              }}
                                            >
                                              ↓
                                            </span>
                                          </>
                                        )
                                        : companionDisplayDetail(displayCompanion, displayTargetPackage)}
                                    </span>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        lineHeight: 1.45,
                                        fontWeight: 700,
                                        color: "#b45309",
                                        background: "#fff7ed",
                                        border: "1px solid #fdba74",
                                        borderRadius: 10,
                                        padding: "8px 10px"
                                      }}
                                    >
                                      {(displayCompanion.urgencyMode ?? "standard") === "price_loss" && savings > 0
                                        ? `If you skip this and come back later, it'll cost you ${formatProductMoney(standardTotal, currency)}. This ${formatProductMoney(total, currency)} price disappears the moment you submit your order.`
                                        : "These discounted additional items only apply when you add them with the main offer."}
                                    </div>
                                    <p style={{ margin: 0, fontSize: 14, color: "#4b5563", lineHeight: 1.5 }}>
                                      {displayCompanion.pitch?.trim() || "Easy extra additional item that fits this order."}
                                    </p>
                                    {(socialProofUi.badgeText || socialProofUi.stats.length > 0) && (
                                      <div style={{ display: "grid", gap: 6 }}>
                                        {socialProofUi.badgeText && (
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              alignItems: "center",
                                              padding: "6px 10px",
                                              borderRadius: 999,
                                              background: "#ecfdf3",
                                              border: "1px solid #86efac",
                                              color: "#15803d",
                                              fontSize: 11,
                                              fontWeight: 800,
                                              animation: "publicProofBadgeFloat 2.8s ease-in-out infinite"
                                            }}
                                          >
                                            {socialProofUi.badgeText}
                                          </span>
                                        )}
                                        {socialProofUi.stats.length > 0 && (
                                          <span
                                            style={{
                                              display: "block",
                                              fontSize: 11,
                                              fontWeight: 700,
                                              lineHeight: 1.5,
                                              color: "#475569"
                                            }}
                                          >
                                            {socialProofUi.stats.join(" · ")}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  {hasVariantChoices && (
                                    <div style={{ display: "grid", gap: 8 }}>
                                      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#475569" }}>
                                        Choose bundle
                                      </div>
                                      <div style={{ borderTop: "1px solid #dbe4ef", borderBottom: "1px solid #dbe4ef" }}>
                                        {group.companions.map((variant) => {
                                          const variantTargetPackage = targetPackageForCompanion(variant, products);
                                          const variantSelected = selectedVariant
                                            ? companionSelectionKey(selectedVariant) === companionSelectionKey(variant)
                                            : false;
                                          const variantPrice = companionLineTotal(variant, product, variantTargetPackage);
                                          return (
                                            <button
                                              key={companionSelectionKey(variant)}
                                              type="button"
                                              onClick={() => setOrderFormCrossSellSelection(variant, true, { exclusiveProduct: true })}
                                              style={{
                                                width: "100%",
                                                border: "none",
                                                borderBottom: "1px solid #e5e7eb",
                                                background: variantSelected ? "#eff6ff" : "transparent",
                                                color: "#0f172a",
                                                padding: "12px 0",
                                                fontSize: 13,
                                                cursor: "pointer",
                                                display: "flex",
                                                alignItems: "flex-start",
                                                gap: 12,
                                                textAlign: "left"
                                              }}
                                            >
                                              <span
                                                aria-hidden="true"
                                                style={{
                                                  marginTop: 4,
                                                  width: 18,
                                                  height: 18,
                                                  borderRadius: "50%",
                                                  border: variantSelected ? "2px solid #1F8FE0" : "2px solid #9ca3af",
                                                  display: "inline-flex",
                                                  alignItems: "center",
                                                  justifyContent: "center",
                                                  flexShrink: 0
                                                }}
                                              >
                                                {variantSelected && (
                                                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1F8FE0", display: "block" }} />
                                                )}
                                              </span>
                                              <span style={{ flex: 1, minWidth: 0 }}>
                                                <span style={{ display: "block", fontWeight: 800, fontSize: 16, color: "#111827" }}>
                                                  {companionDisplayName(variant, product, variantTargetPackage)}
                                                </span>
                                                <span style={{ display: "block", fontSize: 15, fontWeight: 800, color: "#1d4ed8", marginTop: 4 }}>
                                                  {companionOfferPriceLabel(variant, variantPrice, currency, variantTargetPackage)}
                                                </span>
                                                <span style={{ display: "block", fontSize: 13, color: "#475569", marginTop: 4, lineHeight: 1.45 }}>
                                                  {companionDisplayDetail(variant, variantTargetPackage)}
                                                  {variant.pitch?.trim() ? ` · ${variant.pitch.trim()}` : ""}
                                                </span>
                                              </span>
                                              <strong style={{ fontSize: 16, color: "#111827", whiteSpace: "nowrap" }}>
                                                {variant.pricingMode === "free" ? "FREE" : formatProductMoney(variantPrice, currency)}
                                              </strong>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {(!hasVariantChoices || selectedVariant) && (
                                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                                      <strong style={{ fontSize: 24, color: "#1F8FE0" }}>
                                        {displayOfferLabel}
                                      </strong>
                                      {savings > 0 && (
                                        <>
                                          <span style={{ fontSize: 13, color: "#9ca3af", textDecoration: "line-through" }}>
                                            {formatProductMoney(standardTotal, currency)}
                                          </span>
                                          <span style={{ fontSize: 12, fontWeight: 700, color: "#047857" }}>
                                            Save {formatProductMoney(savings, currency)}{discountPercent > 0 ? ` · ${discountPercent}% off` : ""}
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {selectedVariant ? (
                                    <div style={{ display: "grid", gap: 8 }}>
                                      <div
                                        style={{ width: "100%", padding: "13px 16px", background: "#16a34a", color: "white", borderRadius: 12, fontWeight: 800, fontSize: 15, border: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                                      >
                                        <span
                                          aria-hidden="true"
                                          style={{
                                            width: 22,
                                            height: 22,
                                            borderRadius: "50%",
                                            border: "2px solid rgba(255,255,255,0.95)",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            flexShrink: 0
                                          }}
                                        >
                                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "white", display: "block" }} />
                                        </span>
                                        <span style={{ flex: 1, textAlign: "left" }}>
                                          {companionDisplayName(selectedVariant, product, targetPackageForCompanion(selectedVariant, products))} added to your order
                                        </span>
                                        <span aria-hidden="true" style={{ fontSize: 18, fontWeight: 900, lineHeight: 1 }}>✓</span>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={handleAdditionalItemFinishClick}
                                        disabled={publicOrderSubmitting}
                                        style={{
                                          width: "100%",
                                          padding: "13px 16px",
                                          background: reviewStepReady ? "#0f9f6e" : "#111827",
                                          color: "white",
                                          borderRadius: 12,
                                          fontWeight: 900,
                                          fontSize: 15,
                                          border: "none",
                                          cursor: publicOrderSubmitting ? "not-allowed" : "pointer",
                                          opacity: publicOrderSubmitting ? 0.75 : 1,
                                          boxShadow: "0 12px 24px rgba(15, 23, 42, 0.18)"
                                        }}
                                      >
                                        {publicOrderSubmitting
                                          ? "Submitting..."
                                          : reviewStepReady
                                            ? `Place order now - ${formatProductMoney(summaryTotal, chosenPackageCurrency)}`
                                            : "Continue to finish order"}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setOrderFormCrossSellSelection(selectedVariant, false, { exclusiveProduct: true })}
                                        style={{
                                          width: "100%",
                                          padding: "11px 14px",
                                          background: "#fef2f2",
                                          color: "#b91c1c",
                                          borderRadius: 12,
                                          fontWeight: 800,
                                          fontSize: 14,
                                          border: "2px solid #fca5a5",
                                          cursor: "pointer",
                                          animation: "publicRemovePulse 1.6s ease-in-out infinite"
                                        }}
                                      >
                                        Tap here to remove this product from your order
                                      </button>
                                    </div>
                                  ) : !hasVariantChoices ? (
                                    <div style={{ display: "grid", gap: 8 }}>
                                      <button
                                        type="button"
                                        onClick={() => setOrderFormCrossSellSelection(displayCompanion, true, { exclusiveProduct: true })}
                                        style={{ width: "100%", padding: "13px 16px", background: "#1F8FE0", color: "white", borderRadius: 12, fontWeight: 800, fontSize: 15, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 14 }}
                                      >
                                        <span
                                          aria-hidden="true"
                                          style={{ fontSize: 20, fontWeight: 900, lineHeight: 1, animation: "publicBumpNudge 1s ease-in-out infinite", marginRight: 6 }}
                                        >
                                          →
                                        </span>
                                        <span
                                          aria-hidden="true"
                                          style={{
                                            width: 22,
                                            height: 22,
                                            borderRadius: "50%",
                                            border: "2px solid rgba(255,255,255,0.95)",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            flexShrink: 0
                                          }}
                                        >
	                                          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "white", display: "block" }} />
	                                        </span>
	                                        <span style={{ flex: 1, textAlign: "left" }}>
	                                          {detailCtaLabel}
	                                        </span>
	                                      </button>
	                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {inlineOrderBreakdownBlock}
              {additionalItemCompletionBlock}

              {autoCompanionLines.length > 0 && (
                <div style={{ padding: 10, border: "1px solid #10b98140", background: "#ecfdf5", borderRadius: 12, fontSize: 13, marginTop: 12 }}>
                  <strong style={{ display: "block", marginBottom: 6, color: "#047857" }}>🎁 Bundled with your package</strong>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {autoCompanionLines.map((line, index) => (
                      <div key={`bundle-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "#047857" }}>
                        <span>+ {line.name} × {line.qty}</span>
                        <strong>{line.total === 0 ? "FREE" : formatProductMoney(line.total, chosenPackageCurrency)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settings.askDelivery && (
                settings.deliveryInputStyle === "quick" ? (
                  <label style={{ marginTop: 16 }}>
                    <span>When would you like it delivered? *</span>
                    <select
                      ref={setFieldRef("delivery") as any}
                      value={orderFormDeliveryWindow}
                      onChange={(event) => {
                        setOrderFormDeliveryWindow(event.target.value);
                        clearFieldError("delivery");
                      }}
                      aria-invalid={Boolean(fieldErrors.delivery)}
                      aria-describedby={fieldErrors.delivery ? "public-order-error-delivery" : undefined}
                      style={inputErrorStyle("delivery")}
                    >
                      <option value="">Select a delivery time *</option>
                      {settings.deliveryQuickToday && <option value="Today">Today</option>}
                      {settings.deliveryQuickTomorrow && <option value="Tomorrow">Tomorrow</option>}
                      {settings.deliveryQuickNextTomorrow && <option value="Day After">Day After</option>}
                      {!settings.deliveryQuickToday && !settings.deliveryQuickTomorrow && !settings.deliveryQuickNextTomorrow && (
                        <option value="Tomorrow">Tomorrow</option>
                      )}
                    </select>
                    {fieldErrors.delivery && (
                      <span id="public-order-error-delivery" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                        {fieldErrors.delivery}
                      </span>
                    )}
                  </label>
                ) : (
                  <label style={{ marginTop: 16 }}>
                    <span>When would you like it delivered? *</span>
                    <input
                      ref={setFieldRef("delivery") as any}
                      type="date"
                      min={new Date(Date.now() + settings.deliveryRangeMinDays * 86400000).toISOString().slice(0, 10)}
                      max={new Date(Date.now() + settings.deliveryRangeMaxDays * 86400000).toISOString().slice(0, 10)}
                      value={orderFormDeliveryWindow}
                      onChange={(event) => {
                        setOrderFormDeliveryWindow(event.target.value);
                        clearFieldError("delivery");
                      }}
                      aria-invalid={Boolean(fieldErrors.delivery)}
                      aria-describedby={fieldErrors.delivery ? "public-order-error-delivery" : undefined}
                      style={inputErrorStyle("delivery")}
                    />
                    {fieldErrors.delivery && (
                      <span id="public-order-error-delivery" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                        {fieldErrors.delivery}
                      </span>
                    )}
                  </label>
                )
              )}

              {settings.showCommitment && (
                <div
                  ref={setFieldRef("commitment") as any}
                  tabIndex={-1}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                  style={{ marginTop: 16, ...optionGroupErrorStyle("commitment") }}
                >
                  <p className="text-sm leading-5 text-amber-900 m-0">{settings.commitmentText}</p>
                  {settings.allowDisagree ? (
                    <div className="mt-3 flex flex-wrap gap-2" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => {
                          setOrderFormCommitmentAccepted(true);
                          clearFieldError("commitment");
                        }}
                        className={`!min-h-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${orderFormCommitmentAccepted ? "bg-amber-600 text-white border-amber-600" : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100"}`}
                      >
                        ✓ I agree
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setOrderFormCommitmentAccepted(false);
                          clearFieldError("commitment");
                        }}
                        className={`!min-h-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${!orderFormCommitmentAccepted ? "bg-gray-700 text-white border-gray-700" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
                      >
                        ✗ I disagree
                      </button>
                    </div>
                  ) : (
                    <label className="preview-check" style={{ marginTop: 12 }}>
                      <input
                        ref={setFieldRef("commitment") as any}
                        type="checkbox"
                        checked={orderFormCommitmentAccepted}
                        onChange={(event) => {
                          setOrderFormCommitmentAccepted(event.target.checked);
                          clearFieldError("commitment");
                        }}
                        aria-invalid={Boolean(fieldErrors.commitment)}
                        aria-describedby={fieldErrors.commitment ? "public-order-error-commitment" : undefined}
                      /> I agree to the notice above.
                    </label>
                  )}
                  {fieldErrors.commitment && (
                    <span id="public-order-error-commitment" style={{ marginTop: 8, display: "block", fontSize: 12, fontWeight: 700, color: "#b91c1c" }}>
                      {fieldErrors.commitment}
                    </span>
                  )}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", marginTop: 8 }}>
                <input type="radio" name="public-payment" checked readOnly style={{ width: 18, height: 18, accentColor: "#1F8FE0", margin: 0, flexShrink: 0 }} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", background: "#1F8FE0", color: "white", borderRadius: 999, fontWeight: 700, fontSize: 13 }}>
                  💳 Pay On Delivery
                </span>
              </div>

              {settings.requireConfirmation && (
                <div
                  ref={setFieldRef("confirmation") as any}
                  tabIndex={-1}
                  style={{ ...optionGroupErrorStyle("confirmation"), borderRadius: 12, padding: fieldErrors.confirmation ? "8px 10px" : undefined }}
                >
                  <label className="preview-check">
                    <input
                      ref={setFieldRef("confirmation") as any}
                      type="checkbox"
                      checked={orderFormConfirmed}
                      onChange={(event) => {
                        setOrderFormConfirmed(event.target.checked);
                        clearFieldError("confirmation");
                      }}
                      aria-invalid={Boolean(fieldErrors.confirmation)}
                      aria-describedby={fieldErrors.confirmation ? "public-order-error-confirmation" : undefined}
                    /> {settings.confirmationText}
                  </label>
                  {fieldErrors.confirmation && (
                    <span id="public-order-error-confirmation" style={{ marginTop: 6, display: "block", fontSize: 12, fontWeight: 700, color: "#dc2626" }}>
                      {fieldErrors.confirmation}
                    </span>
                  )}
                </div>
              )}

              {fieldErrorEntries.length > 0 && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "12px 14px",
                    borderRadius: 14,
                    border: "1px solid #fecaca",
                    background: "#fff1f2",
                    color: "#991b1b",
                    display: "grid",
                    gap: 6
                  }}
                >
                  <strong style={{ fontSize: 13 }}>Please complete the highlighted fields:</strong>
                  {submitRetryArmed && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: "#b45309" }}>
                      Once the missing fields are completed, we’ll submit the order automatically after about 12 seconds if nothing else happens.
                    </div>
                  )}
                  <div style={{ display: "grid", gap: 4, fontSize: 12, lineHeight: 1.45 }}>
                    {fieldErrorEntries.map(([field, message]) => (
                      <span key={field}>• {message}</span>
                    ))}
                  </div>
                </div>
              )}
              {guidedReviewBlock}

              <div
                ref={submitActionRef}
                style={guidedCheckout ? {
                  position: "sticky",
                  bottom: 12,
                  zIndex: 8,
                  display: "grid",
                  gap: 8,
                  marginTop: 18,
                  paddingTop: 12,
                  background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.92) 28%, rgba(255,255,255,1) 100%)"
                } : { marginTop: 18 }}
              >
                {guidedCheckout && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "10px 14px",
                      borderRadius: 14,
                      background: "#f8fbff",
                      border: "1px solid #dbeafe"
                    }}
                  >
                    <div style={{ display: "grid", gap: 2 }}>
                      <strong style={{ fontSize: 13, color: "#0f172a" }}>Final action</strong>
                      <span style={{ fontSize: 12, color: "#64748b" }}>Tap Place My Order once you’re happy with the review above.</span>
                    </div>
                    <strong style={{ fontSize: 18, color: "#1F8FE0", whiteSpace: "nowrap" }}>{formatProductMoney(summaryTotal, chosenPackageCurrency)}</strong>
                  </div>
                )}
                <button
                  className="primary-button public-order-submit-button"
                  onClick={submitPublicOrder}
                  disabled={publicOrderSubmitting}
                  style={{
                    opacity: publicOrderSubmitting ? 0.78 : 1,
                    cursor: publicOrderSubmitting ? "not-allowed" : "pointer",
                    ...(submitButtonAttention ? { animation: "publicSubmitButtonAlert 0.55s ease" } : {})
                  }}
                >
                  <span className="public-order-submit-button__label">
                    {publicOrderSubmitting ? "Submitting..." : guidedCheckout ? "Place My Order" : "Order Now"}
                  </span>
                  {!publicOrderSubmitting && (
                    <span className="public-order-submit-button__icon" aria-hidden="true">
                      →
                    </span>
                  )}
                </button>
                {guidedCheckout && (
                  <div style={{ fontSize: 12, lineHeight: 1.45, textAlign: "center", color: reviewStepReady ? "#166534" : "#64748b", fontWeight: reviewStepReady ? 700 : 500 }}>
                    {reviewStepReady ? "Your order is ready. Place it now to lock in this offer." : "Still completing details? We’ll keep guiding you until the final submit step."}
                  </div>
                )}
              </div>
            </article>
            {orderSummaryBlock}
          </div>
        )}
      </section>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast}</span>
          <button aria-label="Dismiss message" onClick={() => setToast("")}>×</button>
        </div>
      )}
    </main>
  );
}
