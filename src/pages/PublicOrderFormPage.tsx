import { useEffect, useRef, useState } from "react";
import { cartsApi, embedSettingsApi, productsApi, publicOrdersApi } from "../lib/api";
import type { ProductCurrencyCode } from "../types";

type PublicPricing = {
  currency: ProductCurrencyCode;
  sellingPrice: number;
  isPrimary?: boolean;
};

type PublicCompanion = {
  productId: string;
  quantity: number;
  pricingMode: "free" | "fixed" | "use_product_price" | "standard";
  fixedPrice?: number | null;
  stateRestrictions: string[];
  autoInclude: boolean;
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
  companionProducts?: PublicCompanion[];
};

type PublicProduct = {
  id: string;
  orgId: string;
  name: string;
  description: string;
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
};

type CrossSellSelection = {
  productId: string;
  quantity: number;
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
  "Sokoto", "Taraba", "Yobe", "Zamfara", "FCT",
];

const DEFAULT_SETTINGS: PublicEmbedSettings = {
  stateFieldMode: "freetext",
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
};

const PUBLIC_PRODUCT_CACHE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_SETTINGS_CACHE_TTL_MS = 10 * 60 * 1000;
const PUBLIC_PRODUCT_FETCH_ATTEMPTS = 5;
const PUBLIC_PRODUCT_RETRY_DELAY_MS = 700;

function readCachedValue<T>(key: string, maxAgeMs: number): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { cachedAt?: number; value?: T };
    if (!parsed || typeof parsed.cachedAt !== "number" || !("value" in parsed)) return null;
    if (Date.now() - parsed.cachedAt > maxAgeMs) return null;
    return parsed.value ?? null;
  } catch {
    return null;
  }
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

const makeCartId = () => `CART-${Math.floor(100000 + Math.random() * 900000)}`;

function activeProductPackages(product: PublicProduct) {
  return [...(product.packages ?? [])]
    .filter((item) => item.active)
    .sort((a, b) => a.displayOrder - b.displayOrder);
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

function freeGiftVisibleInState(mainProduct: PublicProduct, giftProduct: PublicProduct, state: string) {
  if (!state) return true;
  const attachmentRule = mainProduct.freeGiftStateRestrictions?.[giftProduct.id];
  if (attachmentRule && attachmentRule.length > 0) return attachmentRule.includes(state);
  const productRule = giftProduct.availableStates;
  if (productRule && productRule.length > 0) return productRule.includes(state);
  return true;
}

export default function PublicOrderFormPage() {
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  const params = hash.startsWith("#/order-form/embed") ? new URLSearchParams(hash.split("?")[1] ?? "") : null;
  const publicProductId = params?.get("product") ?? "";
  const rawPublicCurrency = params?.get("currency") ?? "NGN";
  const publicCurrency: ProductCurrencyCode = rawPublicCurrency === "USD" || rawPublicCurrency === "GBP" ? rawPublicCurrency : "NGN";
  const publicUtmSource = (params?.get("utm_source") ?? "direct").slice(0, 100);
  const publicUtmCampaign = (params?.get("utm_campaign") ?? "embed").slice(0, 100);
  const publicUtmMedium = (params?.get("utm_medium") ?? "").slice(0, 100);
  const publicUtmContent = (params?.get("utm_content") ?? "").slice(0, 100);
  const publicUtmTerm = (params?.get("utm_term") ?? "").slice(0, 100);
  const rawPublicRedirect = params?.get("redirect_url") ?? "";
  const publicRedirectUrl = (() => {
    if (!rawPublicRedirect) return "";
    try {
      const u = new URL(rawPublicRedirect);
      return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : "";
    } catch {
      return "";
    }
  })();

  const cachedProductBundle = publicProductId
    ? readCachedValue<{ products: PublicProduct[]; orgId: string | null }>(
        publicProductCacheKey(publicProductId),
        PUBLIC_PRODUCT_CACHE_TTL_MS
      )
    : null;
  const cachedSettings = cachedProductBundle?.orgId
    ? readCachedValue<PublicEmbedSettings>(
        publicSettingsCacheKey(cachedProductBundle.orgId),
        PUBLIC_SETTINGS_CACHE_TTL_MS
      )
    : null;

  const [products, setProducts] = useState<PublicProduct[]>(() => cachedProductBundle?.products ?? []);
  const [settings, setSettings] = useState<PublicEmbedSettings>(() => ({ ...DEFAULT_SETTINGS, ...(cachedSettings ?? {}) }));
  const [loading, setLoading] = useState(Boolean(publicProductId) && !(cachedProductBundle?.products?.length));
  const [showLoading, setShowLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [publicOrderSubmitted, setPublicOrderSubmitted] = useState<{ orderId: string; customer: string } | null>(null);
  const [publicOrderSubmitting, setPublicOrderSubmitting] = useState(false);
  const [abandonedDraftCartId, setAbandonedDraftCartId] = useState("");

  const [orderFormName, setOrderFormName] = useState("");
  const [orderFormPhone, setOrderFormPhone] = useState("");
  const [orderFormWhatsapp, setOrderFormWhatsapp] = useState("");
  const [orderFormEmail, setOrderFormEmail] = useState("");
  const [orderFormAddress, setOrderFormAddress] = useState("");
  const [orderFormCity, setOrderFormCity] = useState("");
  const [orderFormState, setOrderFormState] = useState("");
  const [orderFormPackageId, setOrderFormPackageId] = useState("");
  const [orderFormCrossSells, setOrderFormCrossSells] = useState<CrossSellSelection[]>([]);
  const [publicHoneypot, setPublicHoneypot] = useState("");
  const [orderFormConfirmed, setOrderFormConfirmed] = useState(false);
  const [orderFormCommitmentAccepted, setOrderFormCommitmentAccepted] = useState(false);
  const [orderFormDeliveryWindow, setOrderFormDeliveryWindow] = useState("");

  const cartSyncTimerRef = useRef<number | null>(null);
  const redirectTimerRef = useRef<number | null>(null);
  const publicReferrer = (typeof document !== "undefined" ? document.referrer : "") || "";

  const publicProduct = products.find((product) => product.id === publicProductId);
  const publicPackages = publicProduct ? activeProductPackages(publicProduct) : [];
  const chosenPackage = publicPackages.find((item) => item.id === orderFormPackageId) ?? publicPackages[0];

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(id);
  }, [toast]);

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
  }, [params, publicOrderSubmitted, loading, orderFormCrossSells.length, orderFormPackageId, orderFormState]);

  useEffect(() => {
    if (!publicProductId) {
      setProducts([]);
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      setLoadError("Missing product id.");
      return;
    }

    const cachedBundle = readCachedValue<{ products: PublicProduct[]; orgId: string | null }>(
      publicProductCacheKey(publicProductId),
      PUBLIC_PRODUCT_CACHE_TTL_MS
    );
    const cachedBundleProducts = cachedBundle?.products ?? [];
    const cachedOrgId = cachedBundle?.orgId ?? null;
    const cachedOrgSettings = cachedOrgId
      ? readCachedValue<PublicEmbedSettings>(publicSettingsCacheKey(cachedOrgId), PUBLIC_SETTINGS_CACHE_TTL_MS)
      : null;

    let cancelled = false;
    setProducts(cachedBundleProducts);
    setSettings({ ...DEFAULT_SETTINGS, ...(cachedOrgSettings ?? {}) });
    setLoading(cachedBundleProducts.length === 0);
    setLoadError(null);
    setPublicOrderSubmitted(null);
    setOrderFormPackageId("");
    setOrderFormCrossSells([]);
    setAbandonedDraftCartId("");

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
          if (attempt < PUBLIC_PRODUCT_FETCH_ATTEMPTS - 1) {
            await new Promise((resolve) => window.setTimeout(resolve, PUBLIC_PRODUCT_RETRY_DELAY_MS * (attempt + 1)));
          }
        }
      }

      if (cancelled) return;

      if (!resolvedProduct) {
        if (cachedBundleProducts.length === 0) {
          const status = typeof lastError?.status === "number" ? lastError.status : null;
          setLoadError(
            status === 404
              ? "This order form is still being prepared. Please retry in a moment."
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
    if (publicPackages.length === 0) return;
    if (!publicPackages.some((item) => item.id === orderFormPackageId)) {
      setOrderFormPackageId(publicPackages[0].id);
    }
  }, [orderFormPackageId, publicPackages]);

  useEffect(() => {
    const companionIds = new Set(
      (chosenPackage?.companionProducts ?? [])
        .filter((companion) => !companion.autoInclude)
        .filter((companion) => companion.stateRestrictions.length === 0 || (orderFormState && companion.stateRestrictions.includes(orderFormState)))
        .map((companion) => companion.productId)
    );
    setOrderFormCrossSells((prev) => prev.filter((line) => companionIds.has(line.productId)));
  }, [chosenPackage, orderFormState]);

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

    if (!formTouched || !publicProduct || !chosenPackage) return;

    const cartId = abandonedDraftCartId || makeCartId();
    if (!abandonedDraftCartId) {
      setAbandonedDraftCartId(cartId);
    }

    cartSyncTimerRef.current = window.setTimeout(() => {
      cartsApi.capture({
        id: cartId,
        customer: orderFormName.trim() || "Partial lead",
        phone: orderFormPhone.trim() || orderFormWhatsapp.trim() || "No phone yet",
        whatsapp: orderFormWhatsapp.trim() || undefined,
        city: orderFormCity.trim() || undefined,
        state: orderFormState.trim() || undefined,
        productId: publicProduct.id,
        packageId: chosenPackage.id,
        productName: publicProduct.name,
        packageName: chosenPackage.name,
        amount: chosenPackage.price,
        currency: chosenPackage.currency,
        source: orderSourceFromUtm(publicUtmSource),
      }).catch(() => {
        // Draft capture is best-effort only.
      });
    }, 1500);

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
    orderFormEmail,
    orderFormName,
    orderFormPhone,
    orderFormState,
    orderFormWhatsapp,
    publicProduct,
    publicUtmSource,
  ]);

  useEffect(() => {
    return () => {
      if (cartSyncTimerRef.current) window.clearTimeout(cartSyncTimerRef.current);
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
  }

  function toggleOrderFormCrossSell(productId: string) {
    setOrderFormCrossSells((prev) =>
      prev.some((line) => line.productId === productId)
        ? prev.filter((line) => line.productId !== productId)
        : [...prev, { productId, quantity: 1 }]
    );
  }

  function shouldUseStateDropdown() {
    return settings.stateFieldMode === "dropdown" && publicCurrency === "NGN";
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
    setPublicHoneypot("");
    setAbandonedDraftCartId("");
    if (publicPackages[0]) setOrderFormPackageId(publicPackages[0].id);
  }

  async function submitPublicOrder() {
    if (publicOrderSubmitting) return;
    if (publicHoneypot) {
      setPublicOrderSubmitted({ orderId: "blocked", customer: orderFormName.trim() });
      return;
    }
    if (!publicProduct || !chosenPackage || !orderFormName.trim() || !orderFormPhone.trim()) {
      showToast("Customer name and phone are required.");
      return;
    }

    const phoneDigits = orderFormPhone.replace(/\D/g, "");
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      showToast("Please enter a valid phone number.");
      return;
    }

    if (settings.showWhatsapp && settings.requireWhatsapp && !orderFormWhatsapp.trim()) {
      showToast("WhatsApp number is required.");
      return;
    }

    if (settings.addressRequired && !orderFormAddress.trim()) {
      showToast("Delivery address is required.");
      return;
    }

    if (settings.cityRequired && !orderFormCity.trim()) {
      showToast("City is required.");
      return;
    }

    if (settings.askDelivery && !orderFormDeliveryWindow.trim()) {
      showToast("Please select a delivery time.");
      return;
    }

    if (settings.requireConfirmation && !orderFormConfirmed) {
      showToast("Please confirm before submitting.");
      return;
    }

    if (settings.showCommitment && !settings.allowDisagree && !orderFormCommitmentAccepted) {
      showToast("Please acknowledge the commitment fee notice.");
      return;
    }

    const customerName = orderFormName.trim();

    setPublicOrderSubmitting(true);
    try {
      const created = await publicOrdersApi.create({
        cartId: abandonedDraftCartId || undefined,
        customer: customerName,
        phone: orderFormPhone.trim(),
        whatsapp: orderFormWhatsapp.trim() || undefined,
        email: orderFormEmail.trim() || undefined,
        address: orderFormAddress.trim() || undefined,
        city: orderFormCity.trim() || undefined,
        state: orderFormState.trim() || undefined,
        packageId: chosenPackage.id,
        crossSellLines: orderFormCrossSells
          .filter((line) => line.productId && line.quantity > 0)
          .map((line) => ({ productId: line.productId, quantity: line.quantity })),
        utmSource: publicUtmSource || undefined,
        utmCampaign: publicUtmCampaign || undefined,
        utmMedium: publicUtmMedium || undefined,
        utmContent: publicUtmContent || undefined,
        utmTerm: publicUtmTerm || undefined,
        referrer: publicReferrer || undefined,
        confirmationChecked: orderFormConfirmed,
        preferredDelivery: orderFormDeliveryWindow.trim() || undefined,
        company: publicHoneypot,
      });
      setPublicOrderSubmitted({ orderId: created.id, customer: customerName });
    } catch (error: any) {
      setPublicOrderSubmitting(false);
      showToast(error?.message ?? "Could not submit your order. Please try again.");
      return;
    }

    setPublicOrderSubmitting(false);
    resetOrderForm();

    if (publicRedirectUrl) {
      redirectTimerRef.current = window.setTimeout(() => {
        try {
          (window.top ?? window).location.href = publicRedirectUrl;
        } catch {
          window.location.href = publicRedirectUrl;
        }
      }, 800);
    }
  }

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

  const companionForProductId = (productId: string) =>
    chosenPackage?.companionProducts?.find((companion) =>
      companion.productId === productId
      && (companion.stateRestrictions.length === 0 || (orderFormState && companion.stateRestrictions.includes(orderFormState)))
    );

  const selectedCrossSellLines = orderFormCrossSells
    .map((line) => {
      const product = products.find((item) => item.id === line.productId);
      if (!product || !chosenPackage) return null;
      const companion = companionForProductId(line.productId);
      if (companion) {
        const standard = primaryPricing(product)?.sellingPrice ?? 0;
        const unit = companion.pricingMode === "free"
          ? 0
          : companion.pricingMode === "fixed"
            ? (companion.fixedPrice ?? 0)
            : standard;
        return { name: product.name, qty: companion.quantity, total: unit * companion.quantity };
      }
      const unit = crossSellPriceFor(publicProduct, product);
      return { name: product.name, qty: line.quantity, total: unit * line.quantity };
    })
    .filter(Boolean) as { name: string; qty: number; total: number }[];

  const autoCompanionLines = (chosenPackage?.companionProducts ?? [])
    .filter((companion) => companion.autoInclude)
    .filter((companion) => companion.stateRestrictions.length === 0 || (orderFormState && companion.stateRestrictions.includes(orderFormState)))
    .map((companion) => {
      const product = products.find((item) => item.id === companion.productId);
      if (!product) return null;
      const standard = primaryPricing(product)?.sellingPrice ?? 0;
      const unit = companion.pricingMode === "free"
        ? 0
        : companion.pricingMode === "fixed"
          ? (companion.fixedPrice ?? 0)
          : standard;
      return { name: `${product.name} (bundled)`, qty: companion.quantity, total: unit * companion.quantity };
    })
    .filter(Boolean) as { name: string; qty: number; total: number }[];

  const summaryGiftLines = (publicProduct.freeGiftProductIds ?? [])
    .map((giftId) => products.find((item) => item.id === giftId))
    .filter((gift): gift is PublicProduct => Boolean(gift && freeGiftVisibleInState(publicProduct, gift, orderFormState)));

  const summaryTotal = chosenPackage.price
    + selectedCrossSellLines.reduce((sum, line) => sum + line.total, 0)
    + autoCompanionLines.reduce((sum, line) => sum + line.total, 0);

  const orderSummaryBlock = settings.formOrderSummaryEnabled ? (
    <div className="panel public-order-summary-rail" style={{ padding: 16, display: "grid", gap: 6 }}>
      <strong style={{ fontSize: 14 }}>{settings.formOrderSummaryTitle}</strong>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
        <span>{publicProduct.name} · {chosenPackage.name}</span>
        <strong>{formatProductMoney(chosenPackage.price, chosenPackage.currency)}</strong>
      </div>
      {selectedCrossSellLines.map((line, index) => (
        <div key={`xs-${index}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "#92400e" }}>
          <span>↳ {line.name} × {line.qty}</span>
          <span>{formatProductMoney(line.total, chosenPackage.currency)}</span>
        </div>
      ))}
      {autoCompanionLines.map((line, index) => (
        <div key={`auto-${index}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0", color: "#1F8FE0" }}>
          <span>+ {line.name} × {line.qty}</span>
          <span>{line.total === 0 ? "FREE" : formatProductMoney(line.total, chosenPackage.currency)}</span>
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
        <span style={{ color: "#1F8FE0" }}>{formatProductMoney(summaryTotal, chosenPackage.currency)}</span>
      </div>
    </div>
  ) : null;

  const allowedStates = publicProduct.availableStates && publicProduct.availableStates.length > 0
    ? NIGERIA_STATES.filter((state) => publicProduct.availableStates?.includes(state))
    : NIGERIA_STATES;

  const companionOptions = (chosenPackage?.companionProducts ?? [])
    .filter((companion) => !companion.autoInclude)
    .filter((companion) => companion.stateRestrictions.length === 0 || (orderFormState && companion.stateRestrictions.includes(orderFormState)));

  return (
    <main className="public-order-page">
      <section className="public-order-shell">
        {publicOrderSubmitted ? (
          <div className="public-form-layout">
            <article className="panel public-order-card public-form-main public-form-clean" style={{ textAlign: "center" }}>
              <div style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#dcfce7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40, lineHeight: 1 }}>✓</div>
                <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#111827", lineHeight: 1.2 }}>
                  Thank you{publicOrderSubmitted.customer ? `, ${publicOrderSubmitted.customer.split(" ")[0]}` : ""}!
                </h1>
                <p style={{ margin: 0, fontSize: 15, color: "#374151", maxWidth: 440, lineHeight: 1.5 }}>
                  Your order has been received and is being processed. Our team will contact you shortly to confirm the details and arrange delivery.
                </p>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#f3f4f6", borderRadius: 999, fontSize: 13, fontWeight: 700, color: "#374151" }}>
                  Order ID: <span style={{ color: "#1F8FE0" }}>{publicOrderSubmitted.orderId}</span>
                </div>
                {publicRedirectUrl ? (
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
                  <input value={orderFormName} onChange={(event) => setOrderFormName(event.target.value)} placeholder="Your Name *" />
                </label>

                <label className="field-full">
                  <div className="phone-prefix-row" style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 14px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8, fontWeight: 700, fontSize: 14, color: "#111827", minWidth: 70, whiteSpace: "nowrap" }}>
                      +234
                    </span>
                    <input
                      style={{ flex: 1 }}
                      value={orderFormPhone}
                      onChange={(event) => setOrderFormPhone(event.target.value.replace(/[^\d\s\-]/g, ""))}
                      placeholder="Your Phone Number *"
                      inputMode="tel"
                      pattern="[0-9\\s\\-]{7,15}"
                      autoComplete="tel-national"
                    />
                  </div>
                </label>

                {settings.showWhatsapp && (
                  <label className="field-full">
                    <div className="phone-prefix-row" style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 14px", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 8, fontWeight: 700, fontSize: 14, color: "#111827", minWidth: 70, whiteSpace: "nowrap" }}>
                        +234
                      </span>
                      <input
                        style={{ flex: 1 }}
                        value={orderFormWhatsapp}
                        onChange={(event) => setOrderFormWhatsapp(event.target.value)}
                        placeholder={`Your WhatsApp Number${settings.requireWhatsapp ? " *" : ""}`}
                        inputMode="tel"
                      />
                    </div>
                  </label>
                )}

                {settings.showEmail && (
                  <label className="field-full">
                    <input value={orderFormEmail} onChange={(event) => setOrderFormEmail(event.target.value)} placeholder="Your Email" type="email" />
                  </label>
                )}

                <label className="field-full">
                  <input value={orderFormAddress} onChange={(event) => setOrderFormAddress(event.target.value)} placeholder={`Your Address${settings.addressRequired ? " *" : ""}`} />
                </label>

                <label className="field-full">
                  <input value={orderFormCity} onChange={(event) => setOrderFormCity(event.target.value)} placeholder={`Your City${settings.cityRequired ? " *" : ""}`} />
                </label>

                <label className="field-full">
                  {shouldUseStateDropdown() ? (
                    <select required value={orderFormState} onChange={(event) => setOrderFormState(event.target.value)}>
                      <option value="" disabled>Select your state *</option>
                      {allowedStates.map((state) => (
                        <option key={state} value={state}>{state}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={orderFormState} onChange={(event) => setOrderFormState(event.target.value)} placeholder="Your State *" />
                  )}
                </label>
              </div>

              <div style={{ marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", color: "#111827" }}>
                SELECT YOUR PACKAGE *
              </div>
              <div className="package-picker package-picker-clean" style={{ borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontWeight: 700, fontSize: 14, borderBottom: "1px solid #e5e7eb" }}>
                  <span>Product</span>
                  <span>Price</span>
                </div>
                {publicPackages.map((item) => {
                  const isSelected = orderFormPackageId === item.id;
                  const title = settings.showPackageName ? item.name : `${publicProduct.name} x${item.quantity}`;
                  return (
                    <label key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 0", cursor: "pointer", borderBottom: "1px solid #f3f4f6" }}>
                      <input
                        type="radio"
                        name="public-package"
                        checked={isSelected}
                        onChange={() => setOrderFormPackageId(item.id)}
                        style={{ marginTop: 4, accentColor: "#1F8FE0" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{title}</div>
                        {item.description && (
                          <div style={{ fontSize: 13, color: "#374151", marginTop: 4, lineHeight: 1.5 }}>{item.description}</div>
                        )}
                      </div>
                      <strong style={{ fontSize: 14, color: "#111827", whiteSpace: "nowrap" }}>
                        {formatProductMoney(item.price, item.currency)}
                      </strong>
                    </label>
                  );
                })}
              </div>

              {companionOptions.length > 0 && (
                <div className="cross-sell-picker" style={{ padding: 12, border: "1px solid #1F8FE040", background: "#eff6ff", borderRadius: 12, marginTop: 16 }}>
                  <strong style={{ fontSize: 14, display: "block", marginBottom: 8 }}>Add to your order</strong>
                  {companionOptions.map((companion, index) => {
                    const product = products.find((item) => item.id === companion.productId);
                    if (!product) return null;
                    const productPrice = primaryPricing(product)?.sellingPrice ?? 0;
                    const currency = primaryPricing(product)?.currency ?? "NGN";
                    const unit = companion.pricingMode === "free"
                      ? 0
                      : companion.pricingMode === "fixed"
                        ? (companion.fixedPrice ?? 0)
                        : productPrice;
                    const total = unit * companion.quantity;
                    const selected = orderFormCrossSells.some((item) => item.productId === companion.productId);
                    return (
                      <label key={`${companion.productId}-${index}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 13 }}>
                        <input type="checkbox" checked={selected} onChange={() => toggleOrderFormCrossSell(companion.productId)} />
                        <span style={{ flex: 1 }}>
                          <strong>{product.name}</strong> × {companion.quantity} · {companion.pricingMode === "free" ? "FREE" : formatProductMoney(total, currency)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {autoCompanionLines.length > 0 && (
                <div style={{ padding: 10, border: "1px solid #10b98140", background: "#ecfdf5", borderRadius: 12, fontSize: 13, marginTop: 12 }}>
                  <strong style={{ display: "block", marginBottom: 6, color: "#047857" }}>🎁 Bundled with your package</strong>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {autoCompanionLines.map((line, index) => (
                      <div key={`bundle-${index}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, color: "#047857" }}>
                        <span>+ {line.name} × {line.qty}</span>
                        <strong>{line.total === 0 ? "FREE" : formatProductMoney(line.total, chosenPackage.currency)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settings.askDelivery && (
                settings.deliveryInputStyle === "quick" ? (
                  <label style={{ marginTop: 16 }}>
                    <span>When would you like it delivered? *</span>
                    <select value={orderFormDeliveryWindow} onChange={(event) => setOrderFormDeliveryWindow(event.target.value)}>
                      <option value="">Select a delivery time *</option>
                      {settings.deliveryQuickToday && <option value="Today">Today</option>}
                      {settings.deliveryQuickTomorrow && <option value="Tomorrow">Tomorrow</option>}
                      {settings.deliveryQuickNextTomorrow && <option value="Day After">Day After</option>}
                      {!settings.deliveryQuickToday && !settings.deliveryQuickTomorrow && !settings.deliveryQuickNextTomorrow && (
                        <option value="Tomorrow">Tomorrow</option>
                      )}
                    </select>
                  </label>
                ) : (
                  <label style={{ marginTop: 16 }}>
                    <span>When would you like it delivered? *</span>
                    <input
                      type="date"
                      min={new Date(Date.now() + settings.deliveryRangeMinDays * 86400000).toISOString().slice(0, 10)}
                      max={new Date(Date.now() + settings.deliveryRangeMaxDays * 86400000).toISOString().slice(0, 10)}
                      value={orderFormDeliveryWindow}
                      onChange={(event) => setOrderFormDeliveryWindow(event.target.value)}
                    />
                  </label>
                )
              )}

              {settings.showCommitment && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" style={{ marginTop: 16 }}>
                  <p className="text-sm leading-5 text-amber-900 m-0">{settings.commitmentText}</p>
                  {settings.allowDisagree ? (
                    <div className="mt-3 flex flex-wrap gap-2" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        onClick={() => setOrderFormCommitmentAccepted(true)}
                        className={`!min-h-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${orderFormCommitmentAccepted ? "bg-amber-600 text-white border-amber-600" : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100"}`}
                      >
                        ✓ I agree
                      </button>
                      <button
                        type="button"
                        onClick={() => setOrderFormCommitmentAccepted(false)}
                        className={`!min-h-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${!orderFormCommitmentAccepted ? "bg-gray-700 text-white border-gray-700" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"}`}
                      >
                        ✗ I disagree
                      </button>
                    </div>
                  ) : (
                    <label className="preview-check" style={{ marginTop: 12 }}>
                      <input type="checkbox" checked={orderFormCommitmentAccepted} onChange={(event) => setOrderFormCommitmentAccepted(event.target.checked)} /> I agree to the notice above.
                    </label>
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
                <label className="preview-check">
                  <input type="checkbox" checked={orderFormConfirmed} onChange={(event) => setOrderFormConfirmed(event.target.checked)} /> {settings.confirmationText}
                </label>
              )}

              <button
                className="primary-button"
                onClick={submitPublicOrder}
                disabled={publicOrderSubmitting}
                style={{ opacity: publicOrderSubmitting ? 0.65 : 1, cursor: publicOrderSubmitting ? "not-allowed" : "pointer" }}
              >
                {publicOrderSubmitting ? "Submitting..." : "Order Now"}
              </button>
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
