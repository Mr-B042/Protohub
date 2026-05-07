import { 
  Period, 
  DateRange, 
  TrackedOrder, 
  CurrencyCode, 
  ProductCurrencyCode,
  Product,
  ExpenseRecord
} from "../types";

export const todayKey = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const normalizeDateKey = (value?: string) => {
  if (!value) return todayKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return todayKey();
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const isInPeriod = (dateKey: string | undefined, activePeriod: Period, range: DateRange) => {
  const value = normalizeDateKey(dateKey);
  const now = new Date();
  const today = normalizeDateKey(now.toISOString());
  
  if (activePeriod === "Custom") {
    return Boolean(range.start && range.end && value >= range.start && value <= range.end);
  }

  if (activePeriod === "Today") {
    return value === today;
  }

  if (activePeriod === "This Week") {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    return value >= normalizeDateKey(weekStart.toISOString()) && value <= today;
  }

  if (activePeriod === "This Month") {
    return value.slice(0, 7) === today.slice(0, 7);
  }

  if (activePeriod === "This Year") {
    return value.slice(0, 4) === today.slice(0, 4);
  }

  return false;
};

export const formatMoney = (amount: number, currency: CurrencyCode, currencies: any) => {
  const selectedCurrency = currencies[currency] || currencies.NGN;
  return new Intl.NumberFormat(selectedCurrency.locale, {
    style: "currency",
    currency: selectedCurrency.currency,
    maximumFractionDigits: 0
  }).format(amount || 0);
};

export const formatProductMoney = (amount: number, code: ProductCurrencyCode, productCurrencies: any) => {
  const def = productCurrencies[code] ?? productCurrencies.NGN;
  return new Intl.NumberFormat(def.locale, {
    style: "currency",
    currency: def.currency,
    maximumFractionDigits: 0
  }).format(amount || 0);
};

export const primaryPricing = (product: Product) => 
  product.pricings.find((pricing) => pricing.isPrimary) ?? product.pricings[0];

export const totalProductStock = (product: Product) => 
  product.warehouseStock + product.agentStock;

export const productInventoryValue = (product: Product) => 
  totalProductStock(product) * (primaryPricing(product)?.sellingPrice ?? 0);

export const activeProductPackages = (product: Product) => 
  product.packages.filter((item) => item.active).sort((a, b) => a.displayOrder - b.displayOrder);

export const statusBadgeClasses = (status: string): string => {
  const map: Record<string, string> = {
    "New":        "bg-blue-50 text-blue-700 border-blue-200",
    "Confirmed":  "bg-amber-50 text-amber-800 border-amber-400",
    "In Process": "bg-amber-50 text-amber-800 border-amber-400",
    "Dispatched": "bg-purple-50 text-purple-800 border-purple-300",
    "Delivered":  "bg-green-50 text-green-800 border-green-400",
    "Cancelled":  "bg-red-50 text-red-800 border-red-300",
    "Postponed":  "bg-stone-50 text-stone-700 border-stone-300",
    "Failed":     "bg-orange-50 text-orange-900 border-orange-300",
  };
  return map[status] ?? "bg-stone-50 text-stone-700 border-stone-300";
};

export const displayDateFromKey = (value?: string) =>
  new Date(`${normalizeDateKey(value)}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
