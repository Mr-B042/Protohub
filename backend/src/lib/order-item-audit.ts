type OrderItemLine = Record<string, unknown>;

type OrderItemAuditInput = {
  beforeLines: unknown;
  afterLines: unknown;
  beforeAmount?: unknown;
  afterAmount?: unknown;
  currency?: unknown;
  kind?: "add-on" | "free gift";
};

const asLines = (value: unknown): OrderItemLine[] =>
  Array.isArray(value)
    ? value.filter((line): line is OrderItemLine => Boolean(line) && typeof line === "object" && !Array.isArray(line))
    : [];

const text = (line: OrderItemLine, ...keys: string[]) => {
  for (const key of keys) {
    const value = line[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const number = (line: OrderItemLine, ...keys: string[]) => {
  for (const key of keys) {
    const value = Number(line[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
};

const lineName = (line: OrderItemLine) =>
  text(line, "displayName", "display_name", "productName", "product_name") || "Unnamed item";

const lineQuantity = (line: OrderItemLine) => Math.max(1, number(line, "quantity") || 1);
const lineAmount = (line: OrderItemLine) => Math.max(0, number(line, "amount"));

const stableLineKey = (line: OrderItemLine, index: number) => {
  const id = text(line, "id");
  if (id) return `id:${id}`;
  const productId = text(line, "productId", "product_id");
  const packageId = text(line, "packageId", "package_id");
  const companionId = text(line, "companionId", "companion_id");
  if (productId || packageId || companionId) {
    return `item:${productId}:${packageId}:${companionId}`;
  }
  return `index:${index}:${lineName(line)}`;
};

const money = (value: unknown, currency: unknown) => {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const code = typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : "NGN";
  if (code === "NGN") return `₦${safeAmount.toLocaleString("en-NG")}`;
  return `${code} ${safeAmount.toLocaleString("en-NG")}`;
};

const totalChange = (beforeAmount: unknown, afterAmount: unknown, currency: unknown) => {
  const before = Number(beforeAmount);
  const after = Number(afterAmount);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) return "";
  return ` Order total changed from ${money(before, currency)} to ${money(after, currency)}.`;
};

export const describeOrderItemChanges = (input: OrderItemAuditInput): string[] => {
  const before = asLines(input.beforeLines);
  const after = asLines(input.afterLines);
  if (JSON.stringify(before) === JSON.stringify(after)) return [];

  const kind = input.kind ?? "add-on";
  const kindLabel = kind === "free gift" ? "Free gift" : "Add-on";
  const beforeByKey = new Map(before.map((line, index) => [stableLineKey(line, index), line]));
  const afterByKey = new Map(after.map((line, index) => [stableLineKey(line, index), line]));
  const notes: string[] = [];
  const amountSuffix = totalChange(input.beforeAmount, input.afterAmount, input.currency);

  for (const [key, line] of beforeByKey) {
    if (afterByKey.has(key)) continue;
    const price = kind === "free gift" ? "" : ` for ${money(lineAmount(line), input.currency)}`;
    notes.push(`${kindLabel} removed: ${lineName(line)} x ${lineQuantity(line)}${price}.${amountSuffix}`);
  }

  for (const [key, line] of afterByKey) {
    if (beforeByKey.has(key)) continue;
    const price = kind === "free gift" ? "" : ` for ${money(lineAmount(line), input.currency)}`;
    notes.push(`${kindLabel} added: ${lineName(line)} x ${lineQuantity(line)}${price}.${amountSuffix}`);
  }

  for (const [key, beforeLine] of beforeByKey) {
    const afterLine = afterByKey.get(key);
    if (!afterLine || JSON.stringify(beforeLine) === JSON.stringify(afterLine)) continue;
    const changes: string[] = [];
    if (lineName(beforeLine) !== lineName(afterLine)) {
      changes.push(`item ${lineName(beforeLine)} to ${lineName(afterLine)}`);
    }
    if (lineQuantity(beforeLine) !== lineQuantity(afterLine)) {
      changes.push(`quantity ${lineQuantity(beforeLine)} to ${lineQuantity(afterLine)}`);
    }
    if (kind !== "free gift" && lineAmount(beforeLine) !== lineAmount(afterLine)) {
      changes.push(`price ${money(lineAmount(beforeLine), input.currency)} to ${money(lineAmount(afterLine), input.currency)}`);
    }
    if (changes.length === 0) changes.push("details updated");
    notes.push(`${kindLabel} changed: ${lineName(afterLine)}, ${changes.join(", ")}.${amountSuffix}`);
  }

  return notes.length > 0 ? notes : [`${kindLabel} list updated.${amountSuffix}`];
};
