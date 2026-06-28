import { supabase } from "./supabase.js";

export type PackageComponent = {
  componentId?: string;
  productId: string;
  quantity: number;
  isFreeGift?: boolean;
  hiddenFromCustomer?: boolean;
  note?: string;
};

export type OrderInventoryLine = {
  componentId?: string;
  productId: string;
  productName: string;
  quantity: number;
  isFreeGift?: boolean;
  hiddenFromCustomer?: boolean;
  note?: string;
  sourceType: "base_product" | "package_component" | "cross_sell" | "free_gift";
};

type OrderInventoryLike = {
  product_id?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  package_components_snapshot?: unknown;
  cross_sell_lines?: unknown;
  free_gift_lines?: unknown;
};

type ProductNameRow = { id: string; name: string };

const normalizePositiveInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
};

export const normalizePackageComponents = (value: unknown): PackageComponent[] => {
  if (!Array.isArray(value)) return [];
  const out: PackageComponent[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const productId = String(record.productId ?? record.product_id ?? "").trim();
    const quantity = normalizePositiveInt(record.quantity, 0);
    if (!productId || quantity < 1) continue;
    out.push({
      componentId: typeof record.componentId === "string"
        ? record.componentId
        : typeof record.component_id === "string"
          ? record.component_id
          : undefined,
      productId,
      quantity,
      isFreeGift: Boolean(record.isFreeGift ?? record.is_free_gift),
      hiddenFromCustomer: Boolean(record.hiddenFromCustomer ?? record.hidden_from_customer),
      note: typeof record.note === "string" ? record.note.trim() || undefined : undefined
    });
  }
  return out;
};

const normalizeSnapshotLines = (value: unknown): OrderInventoryLine[] => {
  if (!Array.isArray(value)) return [];
  const out: OrderInventoryLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const productId = String(record.productId ?? record.product_id ?? "").trim();
    const productName = String(record.productName ?? record.product_name ?? "").trim();
    const quantity = normalizePositiveInt(record.quantity, 0);
    if (!productId || !productName || quantity < 1) continue;
    const sourceRaw = String(record.sourceType ?? record.source_type ?? "package_component");
    const sourceType: OrderInventoryLine["sourceType"] =
      sourceRaw === "base_product" || sourceRaw === "cross_sell" || sourceRaw === "free_gift"
        ? sourceRaw
        : "package_component";
    out.push({
      componentId: typeof record.componentId === "string"
        ? record.componentId
        : typeof record.component_id === "string"
          ? record.component_id
          : undefined,
      productId,
      productName,
      quantity,
      isFreeGift: Boolean(record.isFreeGift ?? record.is_free_gift),
      hiddenFromCustomer: Boolean(record.hiddenFromCustomer ?? record.hidden_from_customer),
      note: typeof record.note === "string" ? record.note.trim() || undefined : undefined,
      sourceType
    });
  }
  return out;
};

const normalizedCrossSellLines = (value: unknown): OrderInventoryLine[] => {
  if (!Array.isArray(value)) return [];
  const out: OrderInventoryLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const snapshotLines = normalizeSnapshotLines(
      record.packageComponentsSnapshot ?? record.package_components_snapshot
    );
    if (snapshotLines.length > 0) {
      for (const line of snapshotLines) {
        out.push({
          ...line,
          sourceType: "cross_sell"
        });
      }
      continue;
    }
    const productId = String(record.productId ?? record.product_id ?? "").trim();
    const productName = String(record.productName ?? record.product_name ?? "").trim();
    const quantity = normalizePositiveInt(record.quantity, 0);
    if (!productId || !productName || quantity < 1) continue;
    out.push({
      productId,
      productName,
      quantity,
      sourceType: "cross_sell",
      isFreeGift: false
    });
  }
  return out;
};

const normalizedFreeGiftLines = (value: unknown): OrderInventoryLine[] => {
  if (!Array.isArray(value)) return [];
  const out: OrderInventoryLine[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const productId = String(record.productId ?? record.product_id ?? "").trim();
    const productName = String(record.productName ?? record.product_name ?? "").trim();
    const quantity = normalizePositiveInt(record.quantity, 0);
    if (!productId || !productName || quantity < 1) continue;
    out.push({
      productId,
      productName,
      quantity,
      sourceType: "free_gift",
      isFreeGift: true
    });
  }
  return out;
};

export async function buildPackageComponentSnapshot(orgId: string, value: unknown) {
  const components = normalizePackageComponents(value);
  if (components.length === 0) return [] as OrderInventoryLine[];

  const productIds = Array.from(new Set(components.map((entry) => entry.productId)));
  const { data } = await supabase
    .from("products")
    .select("id, name")
    .eq("org_id", orgId)
    .in("id", productIds);

  const names = new Map<string, string>(
    ((data ?? []) as ProductNameRow[]).map((row) => [row.id, row.name])
  );

  return components.map((entry) => ({
    componentId: entry.componentId,
    productId: entry.productId,
    productName: names.get(entry.productId) ?? entry.productId,
    quantity: entry.quantity,
    isFreeGift: entry.isFreeGift ?? false,
    hiddenFromCustomer: entry.hiddenFromCustomer ?? false,
    note: entry.note,
    sourceType: "package_component"
  })) satisfies OrderInventoryLine[];
}

export const collapseOrderInventoryLines = (lines: OrderInventoryLine[]) => {
  const grouped = new Map<string, OrderInventoryLine>();
  for (const line of lines) {
    const existing = grouped.get(line.productId);
    if (existing) {
      existing.quantity += line.quantity;
      existing.isFreeGift = Boolean(existing.isFreeGift || line.isFreeGift);
      existing.hiddenFromCustomer = Boolean(existing.hiddenFromCustomer || line.hiddenFromCustomer);
      if (!existing.note && line.note) existing.note = line.note;
      if (existing.sourceType !== line.sourceType) existing.sourceType = "package_component";
    } else {
      grouped.set(line.productId, { ...line });
    }
  }
  return Array.from(grouped.values());
};

export const orderInventoryLinesFromRow = (order: OrderInventoryLike) => {
  const packageLines = normalizeSnapshotLines(order.package_components_snapshot);
  const baseProductLine = order.product_id && order.product_name && normalizePositiveInt(order.quantity, 0) > 0
    ? {
        productId: order.product_id,
        productName: order.product_name,
        quantity: normalizePositiveInt(order.quantity, 1),
        sourceType: "base_product" as const,
        isFreeGift: false
      }
    : null;
  const packageSnapshotOnlyContainsGifts =
    packageLines.length > 0 && packageLines.every((line) => Boolean(line.isFreeGift));
  const baseLines = packageLines.length > 0
    ? [
        ...(packageSnapshotOnlyContainsGifts && baseProductLine ? [baseProductLine] : []),
        ...packageLines
      ]
    : (baseProductLine ? [baseProductLine] : []);

  return collapseOrderInventoryLines([
    ...baseLines,
    ...normalizedCrossSellLines(order.cross_sell_lines),
    ...normalizedFreeGiftLines(order.free_gift_lines)
  ]);
};

export const primaryInventoryProductId = (
  lines: OrderInventoryLine[],
  fallback?: string | null
) => lines[0]?.productId ?? fallback ?? null;
