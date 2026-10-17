import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3, Check, ChevronDown, Download, Filter, Gift, LayoutGrid, Layers, Loader2, MoreVertical, Package, Pencil, Plus, Power, Search, Star, Table2, X
} from "lucide-react";
import { productsApi } from "../../lib/api";
import { EditOfferSheet, offerStockFrom } from "./EditOfferSheet";
import { MiniStat } from "./MediaLibrary";
import { OfferDetailsSheet, type StockHub } from "./OfferDetailsSheet";
import { MenuItem, PopoverMenu, Sheet, cardShell, type CatalogProduct } from "./shared";
import { csvDownload } from "./StockOverviewTab";

// Bundles & Offers (Bright's design, 17 Oct 2026). An "offer" here IS a
// product package - the thing the live order form shows - so there is one
// source of truth. Creating an offer creates a real package; editing opens the
// package in Inventory, where every package option already lives.
// ⚠️ Stock rule (lib/order-inventory.ts): when a package lists items, those
// items REPLACE the main product in stock counts unless every item is a free
// gift. So a bundle with paid extras must list the main product itself too.

export type OfferProduct = CatalogProduct;

type Offer = {
  key: string; productId: string; packageId: string; name: string; product: OfferProduct; quantity: number; price: number; currency: string;
  active: boolean; featured: boolean; gifts: Array<{ productId: string; quantity: number }>; extras: Array<{ productId: string; quantity: number }>;
  type: "bundle_gifts" | "multi_pack" | "bundle" | "single" | "combo"; image: string | null; inStock: number; stateSplit: Array<{ state: string; qty: number }>;
};

const TYPE_TEXT: Record<Offer["type"], string> = { bundle_gifts: "Bundle + Gifts", multi_pack: "Multi-Pack", bundle: "Bundle", single: "Single", combo: "Combo" };
const TYPE_TONE: Record<Offer["type"], string> = {
  bundle_gifts: "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300", multi_pack: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  bundle: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300", single: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300", combo: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
};

export function BundlesTab({ products, canEdit, showValue, stockOf, stateQty, states, hubs, imageOf, galleryFor, formatMoney, onEditPackage, onPackageCreated, onPackagePatched, onPackageDeleted, onViewProduct, onToast, createRequest, templatesRequest, bulkRequest }: {
  products: OfferProduct[];
  canEdit: boolean;
  // Owner / Admin / Manager only (Bright, 17 Oct 2026).
  showValue: boolean;
  stockOf: (productId: string) => number;
  stateQty: (productId: string, state: string) => number;
  states: string[];
  imageOf: (productId: string, packageImage?: string | null) => string | null;
  // Every approved photo of a product (plus its package pictures), for the offer's preview images.
  galleryFor: (productId: string) => string[];
  // Every agent location holding stock, for the per-agent availability breakdown.
  hubs: StockHub[];
  onViewProduct: (productId: string) => void;
  formatMoney: (amount: number, currency: string) => string;
  onEditPackage: (productId: string, packageId: string) => void;
  onPackageCreated: (productId: string, saved: any) => void;
  onPackagePatched: (productId: string, packageId: string, patch: Record<string, unknown>) => void;
  onPackageDeleted: (productId: string, packageId: string) => void;
  onToast: (message: string) => void;
  createRequest: number;
  templatesRequest: number;
  bulkRequest: { at: number; anchor: HTMLElement | null };
}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"" | Offer["type"]>("");
  const [status, setStatus] = useState<"" | "active" | "inactive">("");
  const [productId, setProductId] = useState("");
  const [view, setView] = useState<"grid" | "table" | "analytics">("grid");
  const [sort, setSort] = useState<"product" | "price" | "stock">("product");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<{ productId: string; packageId: string } | null>(null);
  const [menuFor, setMenuFor] = useState<{ offer: Offer; el: HTMLElement } | null>(null);
  const [tableSearch, setTableSearch] = useState("");
  const [template, setTemplate] = useState<Template | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editing, setEditing] = useState<{ productId: string; packageId: string } | null>(null);
  const filtersButton = useRef<HTMLButtonElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);
  // The page header's Create Offer / Offer Templates / Bulk Actions bump these.
  useEffect(() => {
    if (createRequest === 0) return;
    setTemplate(null);
    setFormKey((key) => key + 1);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [createRequest]);
  useEffect(() => { if (templatesRequest > 0) setTemplatesOpen(true); }, [templatesRequest]);
  useEffect(() => { if (bulkRequest.at > 0) setBulkOpen(true); }, [bulkRequest.at]);

  const nameOf = useMemo(() => new Map(products.map((product) => [product.id, product.name])), [products]);
  const offers = useMemo<Offer[]>(() => products.flatMap((product) => product.packages.map((pkg) => {
    const components = pkg.packageComponents ?? [];
    const gifts = components.filter((item) => item.isFreeGift && item.productId !== product.id).map((item) => ({ productId: item.productId, quantity: item.quantity }));
    const extras = components.filter((item) => !item.isFreeGift && item.productId !== product.id).map((item) => ({ productId: item.productId, quantity: item.quantity }));
    const offerType: Offer["type"] = product.catalogType === "combo_only" ? "combo" : gifts.length ? "bundle_gifts" : extras.length ? "bundle" : pkg.quantity > 1 ? "multi_pack" : "single";
    const perOffer = Math.max(1, pkg.quantity);
    const split = states.map((state) => ({ state, qty: offerStockFrom(product.id, perOffer, [...extras, ...gifts], (id) => stateQty(id, state)) })).sort((a, b) => b.qty - a.qty);
    return {
      key: `${product.id}:${pkg.id}`, productId: product.id, packageId: pkg.id, name: pkg.name || product.name, product, quantity: pkg.quantity, price: pkg.price, currency: pkg.currency,
      active: pkg.active, featured: pkg.featuredComboCard === true, gifts, extras, type: offerType, image: imageOf(product.id, pkg.imageUrl ?? pkg.imageUrls?.[0] ?? null),
      inStock: offerStockFrom(product.id, perOffer, [...extras, ...gifts], stockOf), stateSplit: split
    };
  })), [products, states, stateQty, stockOf, imageOf]);

  const stats = {
    active: offers.filter((offer) => offer.active).length, products: new Set(offers.filter((offer) => offer.active).map((offer) => offer.productId)).size,
    bundles: offers.filter((offer) => offer.type === "multi_pack" || offer.type === "bundle").length,
    gifts: offers.filter((offer) => offer.type === "bundle_gifts").length, inactive: offers.filter((offer) => !offer.active).length
  };
  const needle = search.trim().toLowerCase();
  const filtered = offers.filter((offer) => (!needle || `${offer.name} ${offer.product.name} ${offer.product.sku}`.toLowerCase().includes(needle))
    && (!type || offer.type === type) && (!status || offer.active === (status === "active")) && (!productId || offer.productId === productId))
    .sort((a, b) => sort === "price" ? b.price - a.price : sort === "stock" ? b.inStock - a.inStock : a.product.name.localeCompare(b.product.name) || a.quantity - b.quantity);
  const tableRows = offers.filter((offer) => !tableSearch.trim() || `${offer.name} ${offer.product.name}`.toLowerCase().includes(tableSearch.trim().toLowerCase()));

  const setActive = async (list: Offer[], active: boolean) => {
    if (!canEdit || list.length === 0) return;
    if (!window.confirm(`${active ? "Show" : "Hide"} ${list.length} offer${list.length === 1 ? "" : "s"} ${active ? "on" : "from"} the live order form?`)) return;
    let done = 0;
    for (const offer of list) {
      try { await productsApi.updatePackage(offer.productId, offer.packageId, { active }); onPackagePatched(offer.productId, offer.packageId, { active }); done += 1; }
      catch (error: any) { onToast(`${offer.name}: ${error?.message ?? "could not save"}`); }
    }
    if (done) onToast(`${done} offer${done === 1 ? "" : "s"} ${active ? "now show on" : "hidden from"} the order form.`);
    setTicked(new Set());
  };
  const exportCsv = () => csvDownload(`offers-${new Date().toISOString().slice(0, 10)}.csv`, ["Offer", "Main product", "SKU", "Type", "Pieces", "Price", "Offers in stock", "Status"],
    offers.map((offer) => [offer.name, offer.product.name, offer.product.sku, TYPE_TEXT[offer.type], offer.quantity, offer.price, offer.inStock, offer.active ? "Active" : "Inactive"]));
  const singlePrice = (offer: Offer) => offer.product.packages.filter((pkg) => pkg.quantity === 1 && pkg.price > 0).sort((a, b) => a.price - b.price)[0]?.price ?? null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MiniStat icon={<Layers className="h-5 w-5" />} tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" value={stats.active} label="Active Offers" sub={`Across ${stats.products} product${stats.products === 1 ? "" : "s"}`} onClick={() => setStatus("active")} />
        <MiniStat icon={<Package className="h-5 w-5" />} tone="bg-violet-50 text-violet-600 dark:bg-violet-500/15" value={stats.bundles} label="Bundle Offers" sub="Multi-pack offers" onClick={() => setType("multi_pack")} />
        <MiniStat icon={<Gift className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15" value={stats.gifts} label="Free Gift Offers" sub="With add-on gifts" onClick={() => setType("bundle_gifts")} />
        <MiniStat icon={<Power className="h-5 w-5" />} tone="bg-amber-50 text-amber-500 dark:bg-amber-500/15" value={stats.inactive} label="Inactive Offers" sub="Not shown on the form" onClick={() => setStatus("inactive")} />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search offers by name or product..." className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[14px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <OfferPick value={type} onChange={(value) => setType(value as "" | Offer["type"])} label="Offer type"><option value="">All Offer Types</option>{Object.entries(TYPE_TEXT).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</OfferPick>
          <OfferPick value={status} onChange={(value) => setStatus(value as "" | "active" | "inactive")} label="Status"><option value="">All Statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></OfferPick>
          <OfferPick value={productId} onChange={setProductId} label="Product"><option value="">All Products</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</OfferPick>
          <button ref={filtersButton} type="button" onClick={() => setFiltersOpen((value) => !value)} className="!min-h-0 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 text-[13px] font-bold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"><Filter className="h-4 w-4" />Filters</button>
          {([["grid", "Grid", <LayoutGrid key="g" className="h-4 w-4" />], ["table", "Table", <Table2 key="t" className="h-4 w-4" />], ["analytics", "Analytics", <BarChart3 key="a" className="h-4 w-4" />]] as const).map(([key, label, icon]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={`!min-h-0 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-bold ${view === key ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"}`}>{icon}{label}</button>
          ))}
        </div>
      </div>
      <PopoverMenu anchor={filtersButton.current} open={filtersOpen} onClose={() => setFiltersOpen(false)} width={200}>
        <p className="m-0 px-3.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Sort by</p>
        {([["product", "Product"], ["price", "Highest price"], ["stock", "Most in stock"]] as const).map(([key, label]) => (
          <MenuItem key={key} icon={sort === key ? <Check /> : <span className="block h-4 w-4" />} onClick={() => { setSort(key); setFiltersOpen(false); }}>{label}</MenuItem>
        ))}
      </PopoverMenu>
      <PopoverMenu anchor={bulkRequest.anchor} open={bulkOpen} onClose={() => setBulkOpen(false)} width={240}>
        <p className="m-0 px-3.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">{ticked.size ? `${ticked.size} selected` : "Tick offers in the table first"}</p>
        <MenuItem icon={<Power />} disabled={!ticked.size || !canEdit} onClick={() => { setBulkOpen(false); void setActive(offers.filter((offer) => ticked.has(offer.key)), true); }}>Show on order form</MenuItem>
        <MenuItem icon={<Power />} disabled={!ticked.size || !canEdit} onClick={() => { setBulkOpen(false); void setActive(offers.filter((offer) => ticked.has(offer.key)), false); }}>Hide from order form</MenuItem>
        <MenuItem icon={<Download />} onClick={() => { setBulkOpen(false); exportCsv(); }}>Download list (CSV)</MenuItem>
      </PopoverMenu>

      <div className={`grid items-start gap-4 ${canEdit ? "xl:grid-cols-[minmax(0,1fr)_19rem]" : ""}`}>
        <div className="min-w-0">
          {filtered.length === 0 ? (
            <div className={`${cardShell} flex flex-col items-center gap-2 px-6 py-12 text-center`}><Layers className="h-10 w-10 text-gray-300" /><p className="m-0 text-sm font-black text-gray-700 dark:text-slate-200">No offers match</p></div>
          ) : view === "grid" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((offer) => (
                <article key={offer.key} className={`flex flex-col rounded-2xl border bg-white p-3 shadow-sm dark:bg-[#0c1722] ${offer.featured ? "border-blue-300 ring-1 ring-blue-200 dark:ring-blue-500/30" : "border-gray-200/80 dark:border-slate-700"}`}>
                  <div className="relative flex aspect-[16/9] items-center gap-1.5 overflow-hidden rounded-xl bg-gray-50 p-1.5 dark:bg-slate-900">
                    <span className="relative h-full flex-[1.4] overflow-hidden rounded-lg bg-white dark:bg-slate-800">
                      {offer.image ? <img src={offer.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Package className="m-auto mt-[20%] h-8 w-8 text-gray-300" />}
                      {offer.quantity > 1 && <span className="absolute bottom-1.5 right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/85 text-[13px] font-black text-white">x{offer.quantity}</span>}
                    </span>
                    {[...offer.extras, ...offer.gifts].slice(0, 2).map((item, index) => {
                      const isGift = offer.gifts.includes(item);
                      return (
                        <span key={`${item.productId}-${index}`} className="flex h-full flex-1 items-center gap-1.5">
                          <Plus className="h-4 w-4 shrink-0 text-[#1F8FE0]" />
                          <span className="relative h-[78%] w-full overflow-hidden rounded-lg bg-white dark:bg-slate-800">
                            {imageOf(item.productId) ? <img src={imageOf(item.productId)!} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Gift className="m-auto mt-[30%] h-6 w-6 text-gray-300" />}
                            {isGift && <span className="absolute right-1 top-1 rounded bg-rose-500 px-1 text-[9px] font-black text-white">FREE</span>}
                            {item.quantity > 1 && <span className="absolute bottom-1 right-1 rounded bg-slate-900/80 px-1 text-[9px] font-black text-white">x{item.quantity}</span>}
                          </span>
                        </span>
                      );
                    })}
                    <span className={`absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold shadow-sm dark:bg-slate-900/90 ${offer.active ? "text-emerald-700 dark:text-emerald-300" : "text-gray-500"}`}><span className={`h-2 w-2 rounded-full ${offer.active ? "bg-emerald-500" : "bg-gray-400"}`} />{offer.active ? "Active" : "Inactive"}</span>
                    {offer.featured && <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-[#1F8FE0] px-2 py-0.5 text-[10.5px] font-black text-white"><Star className="h-3 w-3" />Featured</span>}
                  </div>
                  <div className="mt-3 flex items-start justify-between gap-2">
                    <h3 className="m-0 text-[15px] font-black leading-tight text-gray-900 dark:text-slate-100">{offer.name}</h3>
                    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${TYPE_TONE[offer.type]}`}>{TYPE_TEXT[offer.type]}</span>
                  </div>
                  <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-300">{offerLine(offer, nameOf)}</p>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span className="text-[11.5px] text-gray-400">SKU: {offer.product.sku}</span>
                    <strong className="text-[20px] font-black leading-none text-gray-900 dark:text-slate-100">{formatMoney(offer.price, offer.currency)}</strong>
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px]">
                    <span className={`inline-flex items-center gap-1.5 font-bold ${offer.inStock > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}><span className={`h-2 w-2 rounded-full ${offer.inStock > 0 ? "bg-emerald-500" : "bg-rose-500"}`} />{offer.inStock.toLocaleString()} in stock</span>
                    <span className="text-gray-400">{offer.stateSplit.slice(0, 2).map((row) => `${row.state}: ${row.qty}`).join(" | ")}{offer.stateSplit.length > 2 ? ` | Others: ${offer.stateSplit.slice(2).reduce((sum, row) => sum + row.qty, 0)}` : ""}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                    {canEdit ? <button type="button" onClick={() => setEditing({ productId: offer.productId, packageId: offer.packageId })} className="!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2 text-[13px] font-bold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100"><Pencil className="h-3.5 w-3.5" />Edit Offer</button> : <span />}
                    <button type="button" onClick={() => setDetails({ productId: offer.productId, packageId: offer.packageId })} className="!min-h-0 rounded-xl border border-gray-200 py-2 text-[13px] font-bold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100">View Details</button>
                    <button type="button" aria-label="More" onClick={(event) => setMenuFor({ offer, el: event.currentTarget })} className="!min-h-0 rounded-xl border border-gray-200 px-2.5 text-gray-600 dark:border-slate-600 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button>
                  </div>
                </article>
              ))}
            </div>
          ) : view === "analytics" ? (
            <section className={`${cardShell} overflow-x-auto`}>
              <table className="w-full [&_td]:align-middle min-w-[46rem] text-left text-[13px]">
                <thead className="bg-gray-50 text-[11.5px] font-bold text-gray-500 dark:bg-slate-900 dark:text-slate-400"><tr><th className="px-4 py-2.5">Offer</th><th className="py-2.5 text-right">Price</th><th className="py-2.5 text-right">Per piece</th><th className="py-2.5 text-right">Saving vs single</th><th className="py-2.5 text-right">Offers in stock</th>{showValue && <th className="px-4 py-2.5 text-right">Value in stock</th>}</tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {filtered.map((offer) => {
                    const single = singlePrice(offer);
                    const saving = single && offer.quantity > 1 ? single * offer.quantity - offer.price : null;
                    return (
                      <tr key={offer.key}><td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{offer.name}<span className="block text-[11px] font-normal text-gray-400">{offer.product.name}</span></td>
                        <td className="py-2.5 text-right">{formatMoney(offer.price, offer.currency)}</td>
                        <td className="py-2.5 text-right">{formatMoney(Math.round(offer.price / Math.max(1, offer.quantity)), offer.currency)}</td>
                        <td className={`py-2.5 text-right font-semibold ${saving && saving > 0 ? "text-emerald-600" : "text-gray-400"}`}>{saving === null ? "—" : formatMoney(saving, offer.currency)}</td>
                        <td className="py-2.5 text-right">{offer.inStock.toLocaleString()}</td>
                        {showValue && <td className="px-4 py-2.5 text-right font-semibold">{formatMoney(offer.inStock * offer.price, offer.currency)}</td>}</tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="m-0 px-4 py-3 text-[11.5px] text-gray-400">"Saving vs single" compares with the cheapest 1-piece package of the same product.</p>
            </section>
          ) : null}

          <section className={`${cardShell} mt-4 overflow-hidden`}>
            <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <h2 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">All Offers <span className="text-gray-400">({offers.length})</span></h2>
              <div className="flex gap-2 sm:ml-auto">
                <label className="relative block min-w-0 flex-1 sm:w-56"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Search offers..." className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-2 text-[13px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
                <button type="button" onClick={exportCsv} className="!min-h-0 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1F8FE0] px-3.5 text-[13px] font-bold text-white"><Download className="h-4 w-4" />Export</button>
              </div>
            </div>
            <div className="overflow-x-auto border-t border-gray-100 dark:border-slate-800">
              <table className="w-full [&_td]:align-middle min-w-[58rem] text-left text-[13px]">
                <thead className="bg-gray-50 text-[11.5px] font-bold text-gray-500 dark:bg-slate-900 dark:text-slate-400">
                  <tr><th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Select all" checked={tableRows.length > 0 && tableRows.every((offer) => ticked.has(offer.key))} onChange={(event) => setTicked(event.target.checked ? new Set(tableRows.map((offer) => offer.key)) : new Set())} className="accent-[#1F8FE0]" /></th>
                    <th className="w-8 py-2.5">#</th><th className="py-2.5">Offer Name</th><th className="py-2.5">Main Product</th><th className="py-2.5">Type</th><th className="py-2.5 text-right">Price</th><th className="py-2.5 text-right">Total Stock</th><th className="py-2.5 pl-6">Status</th><th className="py-2.5" title="Offers have no start or end dates yet">Start Date</th><th className="py-2.5" title="Offers have no start or end dates yet">End Date</th><th className="px-4 py-2.5 text-center">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {tableRows.map((offer, index) => (
                    <tr key={offer.key} className="hover:bg-gray-50/70 dark:hover:bg-slate-900/50">
                      <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Select ${offer.name}`} checked={ticked.has(offer.key)} onChange={() => setTicked((current) => { const next = new Set(current); if (next.has(offer.key)) next.delete(offer.key); else next.add(offer.key); return next; })} className="accent-[#1F8FE0]" /></td>
                      <td className="py-2.5 text-gray-400">{index + 1}</td>
                      <td className="py-2.5"><span className="flex items-center gap-2.5 whitespace-nowrap font-bold text-gray-900 dark:text-slate-100"><span className="h-8 w-8 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800">{offer.image ? <img src={offer.image} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</span>{offer.name}</span></td>
                      <td className="py-2.5 text-gray-600 dark:text-slate-300">{offer.product.name} <span className="text-gray-400">({offer.product.sku})</span></td>
                      <td className="py-2.5"><span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold ${TYPE_TONE[offer.type]}`}>{TYPE_TEXT[offer.type]}</span></td>
                      <td className="py-2.5 text-right font-semibold">{formatMoney(offer.price, offer.currency)}</td>
                      <td className="py-2.5 text-right tabular-nums">{offer.inStock.toLocaleString()}</td>
                      <td className="py-2.5 pl-6"><span className={`rounded-md px-2 py-1 text-[11px] font-bold ${offer.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-slate-800"}`}>{offer.active ? "Active" : "Inactive"}</span></td>
                      <td className="py-2.5 text-gray-400">—</td><td className="py-2.5 text-gray-400">—</td>
                      <td className="px-4 py-2.5 text-center"><button type="button" aria-label="Actions" onClick={(event) => setMenuFor({ offer, el: event.currentTarget })} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {canEdit && (
          <div ref={formRef} className="scroll-mt-20">
            <CreateOfferPanel key={formKey} products={products} template={template} onToast={onToast} onCreated={(id, saved) => { onPackageCreated(id, saved); setFormKey((key) => key + 1); setTemplate(null); }} />
          </div>
        )}
      </div>

      <PopoverMenu anchor={menuFor?.el ?? null} open={Boolean(menuFor)} onClose={() => setMenuFor(null)} width={210}>
        {menuFor && (
          <>
            <MenuItem onClick={() => { setDetails({ productId: menuFor.offer.productId, packageId: menuFor.offer.packageId }); setMenuFor(null); }}>View details</MenuItem>
            {canEdit && <MenuItem icon={<Pencil />} onClick={() => { setEditing({ productId: menuFor.offer.productId, packageId: menuFor.offer.packageId }); setMenuFor(null); }}>Edit offer</MenuItem>}
            {canEdit && <MenuItem icon={<Pencil />} onClick={() => { onEditPackage(menuFor.offer.productId, menuFor.offer.packageId); setMenuFor(null); }}>More options in Inventory</MenuItem>}
            {canEdit && <MenuItem icon={<Power />} onClick={() => { void setActive([menuFor.offer], !menuFor.offer.active); setMenuFor(null); }}>{menuFor.offer.active ? "Hide from order form" : "Show on order form"}</MenuItem>}
          </>
        )}
      </PopoverMenu>

      {details && (() => {
        const product = products.find((entry) => entry.id === details.productId);
        const pkg = product?.packages.find((entry) => entry.id === details.packageId);
        if (!product || !pkg) return null;
        return (
          <OfferDetailsSheet product={product} pkg={pkg} products={products} states={states} hubs={hubs}
            stockOf={stockOf} stateQty={stateQty} imageOf={imageOf} formatMoney={formatMoney} showValue={showValue} canEdit={canEdit} onToast={onToast}
            onClose={() => setDetails(null)}
            onEdit={() => { setDetails(null); setEditing({ productId: product.id, packageId: pkg.id }); }}
            onViewProduct={() => { setDetails(null); onViewProduct(product.id); }}
            onChanged={(patch) => onPackagePatched(product.id, pkg.id, patch)}
            onCreated={(saved) => onPackageCreated(product.id, saved)} />
        );
      })()}
      {editing && (() => {
        const product = products.find((entry) => entry.id === editing.productId);
        const pkg = product?.packages.find((entry) => entry.id === editing.packageId);
        if (!product || !pkg) return null;
        return (
          <EditOfferSheet product={product} pkg={pkg} products={products} states={states} gallery={galleryFor(product.id)}
            stockOf={stockOf} stateQty={stateQty} imageOf={(id) => imageOf(id)} formatMoney={formatMoney} onToast={onToast}
            onClose={() => setEditing(null)}
            onSaved={(patch) => onPackagePatched(product.id, pkg.id, patch)}
            onDeleted={() => onPackageDeleted(product.id, pkg.id)} />
        );
      })()}
      {templatesOpen && (
        <Sheet title="Offer templates" subtitle="Start from a common offer, then pick the product." onClose={() => setTemplatesOpen(false)}>
          <div className="space-y-2">
            {TEMPLATES.map((entry) => (
              <button key={entry.id} type="button" onClick={() => { setTemplate(entry); setFormKey((key) => key + 1); setTemplatesOpen(false); formRef.current?.scrollIntoView({ behavior: "smooth" }); }}
                className="!min-h-0 flex w-full items-center gap-3 rounded-xl border border-gray-200 p-3 text-left hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15">{entry.mode === "gift" ? <Gift className="h-5 w-5" /> : <Layers className="h-5 w-5" />}</span>
                <span><span className="block text-[14px] font-black text-gray-900 dark:text-slate-100">{entry.title}</span><span className="block text-[12px] text-gray-500">{entry.body}</span></span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-gray-50 p-2.5 dark:bg-slate-950"><dt className="text-[11px] font-bold text-gray-400">{label}</dt><dd className="m-0 font-semibold text-gray-900 dark:text-slate-100">{value}</dd></div>
);

function offerLine(offer: Offer, nameOf: Map<string, string>) {
  const parts = [`${offer.quantity} × ${offer.product.name.split(" ").slice(0, 3).join(" ")}`];
  for (const item of offer.extras) parts.push(`${item.quantity} × ${(nameOf.get(item.productId) ?? "item").split(" ").slice(0, 3).join(" ")}`);
  const gifts = offer.gifts.reduce((sum, gift) => sum + gift.quantity, 0);
  if (gifts) parts.push(`${gifts} Free Gift${gifts === 1 ? "" : "s"}`);
  return parts.join(" + ");
}

function OfferPick({ value, onChange, label, children }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode }) {
  return (
    <span className="relative block shrink-0">
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="h-11 appearance-none rounded-xl border border-gray-200 bg-white pl-3.5 pr-9 text-[13px] font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </span>
  );
}

type Template = { id: string; title: string; body: string; mode: "bundle" | "gift"; offerType: "fixed" | "multi"; quantity: number; gifts: number; namePattern: string };
const TEMPLATES: Template[] = [
  { id: "buy1gift1", title: "1 product + 1 free gift", body: "The classic: one main item and a small free add-on.", mode: "gift", offerType: "fixed", quantity: 1, gifts: 1, namePattern: "{p} + Free Gift" },
  { id: "buy1gift2", title: "1 product + 2 free gifts", body: "A bigger push on the main product.", mode: "gift", offerType: "fixed", quantity: 1, gifts: 2, namePattern: "{p} + 2 Free Gifts" },
  { id: "pack2", title: "2-pack", body: "Two of the same product at a better price.", mode: "bundle", offerType: "multi", quantity: 2, gifts: 0, namePattern: "{p} (2 Sets)" },
  { id: "pack3", title: "3-pack", body: "Three of the same product.", mode: "bundle", offerType: "multi", quantity: 3, gifts: 0, namePattern: "{p} (3 Sets)" },
  { id: "pack2gifts", title: "2 sets + 2 free gifts", body: "Multi-pack with gifts, for higher order values.", mode: "gift", offerType: "multi", quantity: 2, gifts: 2, namePattern: "{p} (2 Sets) + 2 Free Gifts" }
];

function CreateOfferPanel({ products, template, onCreated, onToast }: { products: OfferProduct[]; template: Template | null; onCreated: (productId: string, saved: any) => void; onToast: (message: string) => void }) {
  const [mode, setMode] = useState<"bundle" | "gift">(template?.mode ?? "bundle");
  const [name, setName] = useState("");
  const [mainId, setMainId] = useState("");
  const [price, setPrice] = useState("");
  const [offerType, setOfferType] = useState<"fixed" | "multi">(template?.offerType ?? "fixed");
  const [quantity, setQuantity] = useState(template?.quantity ?? 1);
  const [extras, setExtras] = useState<Array<{ productId: string; quantity: number }>>([]);
  const [gifts, setGifts] = useState<Array<{ productId: string; quantity: number }>>(Array.from({ length: template?.gifts ?? 0 }, () => ({ productId: "", quantity: 1 })));
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const main = products.find((product) => product.id === mainId);
  const pickMain = (id: string) => {
    setMainId(id);
    const product = products.find((entry) => entry.id === id);
    if (product && (!name.trim() || template)) setName((template?.namePattern ?? "{p}").replace("{p}", product.name));
  };
  const create = async () => {
    if (!name.trim() || !main) { onToast("Give the offer a name and choose the main product."); return; }
    const amount = Number(price.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) { onToast("Enter the offer price."); return; }
    const qty = Math.max(1, offerType === "multi" ? Math.max(2, quantity) : quantity);
    const giftItems = (mode === "gift" ? gifts : []).filter((item) => item.productId);
    const extraItems = (mode === "bundle" && offerType === "fixed" ? extras : []).filter((item) => item.productId);
    // ⚠️ Paid extras replace the main product in stock counts unless listed too.
    const components = extraItems.length
      ? [{ productId: main.id, quantity: qty, isFreeGift: false }, ...extraItems.map((item) => ({ ...item, isFreeGift: false })), ...giftItems.map((item) => ({ ...item, isFreeGift: true }))]
      : giftItems.map((item) => ({ ...item, isFreeGift: true }));
    const currency = ["NGN", "USD", "GBP"].includes(main.packages[0]?.currency ?? "NGN") ? (main.packages[0]?.currency ?? "NGN") : "NGN";
    setBusy(true);
    try {
      const saved = await productsApi.createPackage(main.id, {
        name: name.trim(), quantity: qty, price: amount, currency, active, displayOrder: main.packages.length,
        packageComponents: components
      });
      onCreated(main.id, saved);
      onToast(active ? `${name.trim()} created and now shows on the order form.` : `${name.trim()} created (inactive). Switch it on when ready.`);
    } catch (error: any) { onToast(error?.message ?? "Could not create the offer."); }
    finally { setBusy(false); }
  };
  const itemRows = (rows: Array<{ productId: string; quantity: number }>, setRows: (next: Array<{ productId: string; quantity: number }>) => void, placeholder: string) => rows.map((row, index) => (
    <div key={index} className="flex gap-1.5">
      <select value={row.productId} onChange={(event) => setRows(rows.map((entry, i) => i === index ? { ...entry, productId: event.target.value } : entry))} aria-label={placeholder}
        className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-2 text-[12.5px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
        <option value="">{placeholder}</option>{products.filter((product) => product.id !== mainId).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select>
      <input type="number" min={1} value={row.quantity} onChange={(event) => setRows(rows.map((entry, i) => i === index ? { ...entry, quantity: Math.max(1, Number(event.target.value) || 1) } : entry))} aria-label="Quantity"
        className="h-10 w-14 rounded-lg border border-gray-200 px-2 text-[12.5px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
      <button type="button" aria-label="Remove" onClick={() => setRows(rows.filter((_, i) => i !== index))} className="!min-h-0 rounded-lg px-2 text-gray-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
    </div>
  ));
  return (
    <section className="rounded-2xl border border-blue-200 bg-white p-4 shadow-sm dark:border-blue-500/30 dark:bg-[#0c1722]">
      <h2 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Create New Bundle / Offer</h2>
      <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-600">
        {([["bundle", "Bundle Offer"], ["gift", "Free Gift Offer"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setMode(key)} className={`!min-h-0 py-2 text-[13px] font-bold ${mode === key ? "bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" : "text-gray-600 dark:text-slate-300"}`}>{label}</button>
        ))}
      </div>
      <div className="mt-3 space-y-3 text-[13px]">
        <label className="block"><span className="mb-1 block font-semibold text-gray-700 dark:text-slate-200">Offer Name <span className="text-rose-500">*</span></span>
          <input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="e.g. 5-in-1 Corner Rack + 2 Free Gifts" className="h-10 w-full rounded-lg border border-gray-200 px-3 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        <label className="block"><span className="mb-1 block font-semibold text-gray-700 dark:text-slate-200">Main Product <span className="text-rose-500">*</span></span>
          <select value={mainId} onChange={(event) => pickMain(event.target.value)} className="h-10 w-full rounded-lg border border-gray-200 bg-white px-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"><option value="">Select main product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
        <label className="block"><span className="mb-1 block font-semibold text-gray-700 dark:text-slate-200">Offer Price <span className="text-rose-500">*</span></span>
          <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="e.g. 39500" className="h-10 w-full rounded-lg border border-gray-200 px-3 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        {mode === "bundle" && offerType === "fixed" && (
          <div>
            <div className="flex items-center justify-between"><span className="font-semibold text-gray-700 dark:text-slate-200">Bundle Items</span>
              <button type="button" onClick={() => setExtras([...extras, { productId: "", quantity: 1 }])} className="!min-h-0 inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[12px] font-bold text-[#1F8FE0] dark:bg-blue-500/15"><Plus className="h-3.5 w-3.5" />Add Product</button></div>
            <p className="m-0 mb-1.5 text-[11.5px] text-gray-400">Add additional products included in this offer.</p>
            <div className="space-y-1.5">{itemRows(extras, setExtras, "Choose product")}</div>
          </div>
        )}
        {mode === "gift" && (
          <div>
            <div className="flex items-center justify-between"><span className="font-semibold text-gray-700 dark:text-slate-200">Free Gifts</span>
              <button type="button" onClick={() => setGifts([...gifts, { productId: "", quantity: 1 }])} className="!min-h-0 inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-[12px] font-bold text-[#1F8FE0] dark:bg-blue-500/15"><Plus className="h-3.5 w-3.5" />Add Gift</button></div>
            <p className="m-0 mb-1.5 text-[11.5px] text-gray-400">Free gift items for this offer. They come out of stock on delivery.</p>
            <div className="space-y-1.5">{itemRows(gifts, setGifts, "Choose gift")}</div>
          </div>
        )}
        <div>
          <span className="mb-1.5 block font-semibold text-gray-700 dark:text-slate-200">Offer Type</span>
          {([["fixed", "Fixed Bundle", "Specific products and quantities"], ["multi", "Multi-Pack", "Same product in multiple quantities"]] as const).map(([key, label, hint]) => (
            <label key={key} className="flex cursor-pointer items-start gap-2.5 py-1.5">
              <input type="radio" name="offer-type" checked={offerType === key} onChange={() => { setOfferType(key); if (key === "multi" && quantity < 2) setQuantity(2); }} className="mt-0.5 h-4 w-4 accent-[#1F8FE0]" />
              <span><span className="block font-semibold text-gray-800 dark:text-slate-100">{label}</span><span className="block text-[11.5px] text-gray-400">{hint}</span></span>
            </label>
          ))}
          <label className="flex items-start gap-2.5 py-1.5 opacity-50"><input type="radio" disabled className="mt-0.5 h-4 w-4" /><span><span className="block font-semibold text-gray-800 dark:text-slate-100">Mix &amp; Match</span><span className="block text-[11.5px] text-gray-400">Not supported by the order form yet</span></span></label>
          <label className="mt-1 flex items-center gap-2"><span className="text-gray-600 dark:text-slate-300">Pieces of main product</span>
            <input type="number" min={offerType === "multi" ? 2 : 1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} className="h-9 w-16 rounded-lg border border-gray-200 px-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
        </div>
        <label className="block"><span className="mb-1 block font-semibold text-gray-700 dark:text-slate-200">Offer Status</span>
          <select value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")} className={`h-10 w-full rounded-lg border px-2 font-semibold ${active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-gray-200 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"}`}>
            <option value="inactive">Inactive (saved, not on the form)</option><option value="active">Active (shows on the order form now)</option>
          </select></label>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button type="button" onClick={() => { setName(""); setMainId(""); setPrice(""); setExtras([]); setGifts([]); }} className="!min-h-0 rounded-xl border border-gray-200 py-2.5 font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
          <button type="button" disabled={busy} onClick={create} className="!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#1F8FE0] py-2.5 font-black text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Create Offer</button>
        </div>
      </div>
    </section>
  );
}

