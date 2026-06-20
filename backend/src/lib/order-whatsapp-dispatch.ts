type InventoryComponentSnapshot = {
  productId?: string | null;
  productName?: string | null;
  quantity?: number | string | null;
  isFreeGift?: boolean | null;
  hiddenFromCustomer?: boolean | null;
};

type CrossSellLine = {
  id?: string | null;
  productName?: string | null;
  packageName?: string | null;
  packageQuantity?: number | string | null;
  packageComponentsSnapshot?: unknown;
  package_components_snapshot?: unknown;
  displayName?: string | null;
  display_name?: string | null;
  displayDescription?: string | null;
  display_description?: string | null;
  quantity?: number | string | null;
  amount?: number | string | null;
};

type FreeGiftLine = {
  productName?: string | null;
  product_name?: string | null;
  quantity?: number | string | null;
};

export type WhatsAppDispatchOrderRow = {
  id: string;
  customer?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  product_name?: string | null;
  package_name?: string | null;
  quantity?: number | string | null;
  amount?: number | string | null;
  currency?: string | null;
  cross_sell_lines?: unknown;
  free_gift_lines?: unknown;
  package_components_snapshot?: unknown;
};

const cleanText = (value: unknown) => String(value ?? "").trim();

const positiveNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const pluralPc = (qty: number) => `${qty} pc${qty === 1 ? "" : "s"}`;

const lineArray = <T>(value: unknown): T[] => Array.isArray(value) ? (value as T[]) : [];

function formatMoney(value: unknown, currency?: string | null) {
  const amount = Math.max(0, Number(value ?? 0) || 0);
  const formatted = amount.toLocaleString("en-NG", { maximumFractionDigits: 0 });
  const code = cleanText(currency || "NGN").toUpperCase();
  return code === "NGN" ? `₦${formatted}` : `${code} ${formatted}`;
}

function visibleComponents(value: unknown) {
  return lineArray<InventoryComponentSnapshot>(value)
    .filter((line) => !line.hiddenFromCustomer)
    .map((line) => ({
      productName: cleanText(line.productName),
      quantity: Math.max(1, Math.round(positiveNumber(line.quantity, 1))),
      isFreeGift: !!line.isFreeGift
    }))
    .filter((line) => line.productName);
}

function componentsDescribeCombo(value: unknown) {
  return visibleComponents(value).filter((line) => !line.isFreeGift).length > 1
    || visibleComponents(value).some((line) => line.isFreeGift);
}

function componentTitle(value: unknown) {
  const visible = visibleComponents(value);
  const paid = visible
    .filter((line) => !line.isFreeGift)
    .map((line) => `${line.quantity}${line.quantity === 1 ? "pc" : "pcs"} Of ${line.productName}`);
  const gifts = visible
    .filter((line) => line.isFreeGift)
    .map((line) => `${line.quantity === 1 ? "One Free Gift Of" : `${line.quantity} Free Gifts Of`} ${line.productName}`);
  const title = [...paid, ...gifts].join(" + ");
  return title && !/\b(combo|bundle|pack|set)\b/i.test(title) ? `${title} Combo` : title;
}

function componentDetail(value: unknown) {
  const visible = visibleComponents(value);
  if (!visible.length) return "";
  const paid = visible
    .filter((line) => !line.isFreeGift)
    .map((line) => `${line.quantity} ${line.quantity === 1 ? "pc" : "pcs"} of ${line.productName}`);
  const gifts = visible
    .filter((line) => line.isFreeGift)
    .map((line) => `FREE ${line.quantity} ${line.quantity === 1 ? "pc" : "pcs"} of ${line.productName}`);
  return [...paid, ...gifts].join(" + ");
}

function displayNameForCrossSell(line: CrossSellLine) {
  const saved = cleanText(line.displayName ?? line.display_name);
  if (saved) return saved;
  const snapshot = line.packageComponentsSnapshot ?? line.package_components_snapshot;
  if (componentsDescribeCombo(snapshot)) {
    const title = componentTitle(snapshot);
    if (title) return title;
  }
  const productName = cleanText(line.productName) || "Item";
  const packageName = cleanText(line.packageName);
  return packageName ? `${productName} · ${packageName}` : productName;
}

function displayDetailForCrossSell(line: CrossSellLine) {
  const saved = cleanText(line.displayDescription ?? line.display_description);
  if (saved) return saved;
  const snapshot = line.packageComponentsSnapshot ?? line.package_components_snapshot;
  const detail = componentDetail(snapshot);
  if (detail) return detail;
  const qty = Math.max(1, Math.round(positiveNumber(line.quantity, 1)));
  return [
    cleanText(line.packageName),
    positiveNumber(line.packageQuantity, 0) ? `${positiveNumber(line.packageQuantity, 0)} unit package` : "",
    pluralPc(qty)
  ].filter(Boolean).join(" · ");
}

function preferredPackageLine(productName: string, packageName: string, quantity: number) {
  const qty = Math.max(1, Math.round(quantity || 1));
  const qtyLabel = `${qty}pc${qty === 1 ? "" : "s"}`;
  if (packageName) {
    if (productName && packageName.toLowerCase().includes(productName.toLowerCase())) {
      return `${qtyLabel} Of ${packageName}`;
    }
    return `${qtyLabel} Of ${packageName}${productName ? ` of ${productName}` : ""}`;
  }
  return `${qtyLabel} Of ${productName || "item"}`;
}

export function formatOrderForWhatsAppDispatch(order: WhatsAppDispatchOrderRow) {
  const crossSellLines = lineArray<CrossSellLine>(order.cross_sell_lines);
  const freeGiftLines = lineArray<FreeGiftLine>(order.free_gift_lines);
  const additionalItemTotal = crossSellLines.reduce((sum, line) => sum + Math.max(0, Number(line.amount ?? 0) || 0), 0);
  const orderTotal = Math.max(0, Number(order.amount ?? 0) || 0);
  const mainOfferTotal = Math.max(0, orderTotal - additionalItemTotal);
  const hasMultiplePricedPackages = crossSellLines.length > 0;
  const deliveryParts = [order.address, order.city, order.state].map(cleanText).filter(Boolean);
  const fullDeliveryLabel = deliveryParts.length > 0 ? deliveryParts.join(", ") : "No delivery address provided";
  const productName = cleanText(order.product_name);
  const packageName = cleanText(order.package_name);
  const mainPackageDispatch = preferredPackageLine(productName, packageName, positiveNumber(order.quantity, 1));

  const lines = [
    `Full Name:  ${cleanText(order.customer) || "—"}`,
    `Active Phone Number:  ${cleanText(order.phone) || "—"}`,
    `Whatsapp Number:  ${cleanText(order.whatsapp) || cleanText(order.phone) || "—"}`,
    `State: ${cleanText(order.state) || "—"}`,
    `City:  ${cleanText(order.city) || "—"}`,
    `Full Delivery: ${fullDeliveryLabel}`,
    hasMultiplePricedPackages
      ? `Preferred Package 1: ${mainPackageDispatch} = ${formatMoney(mainOfferTotal, order.currency)}`
      : `Preferred Package: ${mainPackageDispatch} = ${formatMoney(mainOfferTotal, order.currency)}`
  ];

  crossSellLines.forEach((line, index) => {
    const displayName = displayNameForCrossSell(line);
    const displayDetail = displayDetailForCrossSell(line);
    lines.push(
      `Preferred Package ${index + 2}: ${displayName}${displayDetail ? `\nItems: ${displayDetail}` : ""} = ${formatMoney(line.amount, order.currency)}`
    );
  });

  freeGiftLines.forEach((line, index) => {
    const qty = Math.max(1, Math.round(positiveNumber(line.quantity, 1)));
    const product = cleanText(line.productName ?? line.product_name) || "Item";
    lines.push(`Free Gift ${index + 1}: ${qty}pc${qty === 1 ? "" : "s"} of ${product}`);
  });

  if (hasMultiplePricedPackages) {
    lines.push(`Total = ${formatMoney(order.amount, order.currency)}`);
  }

  return lines.join("\n\n");
}
