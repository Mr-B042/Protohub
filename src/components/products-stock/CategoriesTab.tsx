import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight, Baby, Bath, Box, Check, ChevronDown, CookingPot, Download, Filter, Gift, HeartPulse, House, LayoutGrid, Loader2, MoreVertical,
  Package, Pencil, Power, Search, Shirt, Sparkles, SprayCan, Table2, Trash2, Wrench
} from "lucide-react";
import { productMediaApi, type ProductCategory } from "../../lib/api";
import { MiniStat } from "./MediaLibrary";
import { CATEGORY_HEX, MenuItem, OTHERS_HEX, PopoverMenu, Sheet, cardShell, type CatalogProduct } from "./shared";
import { csvDownload } from "./StockOverviewTab";

// Categories (Bright's design, 17 Oct 2026). Cover pictures come from the
// products inside each category, so there is nothing extra to upload.

export const CATEGORY_ICONS: Record<string, (props: { className?: string }) => ReactNode> = {
  grid: LayoutGrid, bath: Bath, brush: SprayCan, kitchen: CookingPot, shirt: Shirt, heart: HeartPulse,
  home: House, gift: Gift, box: Box, sparkles: Sparkles, wrench: Wrench, baby: Baby
};
const ICON_NAMES = Object.keys(CATEGORY_ICONS);
const COLOR_NAMES = Object.keys(CATEGORY_HEX);

export function CategoryIcon({ category, size = "h-10 w-10", iconSize = "h-5 w-5" }: { category: Pick<ProductCategory, "icon" | "color">; size?: string; iconSize?: string }) {
  const Icon = CATEGORY_ICONS[category.icon] ?? LayoutGrid;
  const hex = CATEGORY_HEX[category.color] ?? OTHERS_HEX;
  return <span className={`flex shrink-0 items-center justify-center rounded-xl ${size}`} style={{ background: `${hex}1f`, color: hex }}><Icon className={iconSize} /></span>;
}

export type CategoryStats = { products: number; units: number; value: number; cover: string | null };

function MiniBars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  const bars = values.slice(0, 8);
  if (bars.length < 2) return null;
  return (
    <span className="flex h-9 items-end gap-[3px]" aria-hidden="true">
      {bars.map((value, index) => <span key={index} className="w-[6px] rounded-t-[2px]" style={{ height: `${Math.max(12, (value / max) * 100)}%`, background: color, opacity: 0.35 + (index / bars.length) * 0.5 }} />)}
    </span>
  );
}

export function CategoriesTab({ categories, setCategories, products, statsFor, canManage, showValue, formatValue, onViewProducts, onAssigned, onToast, addRequest, guideRequest }: {
  categories: ProductCategory[];
  setCategories: (next: ProductCategory[]) => void;
  products: CatalogProduct[];
  statsFor: (categoryId: string | null) => CategoryStats;
  canManage: boolean;
  // Owner / Admin / Manager only (Bright, 17 Oct 2026).
  showValue: boolean;
  formatValue: (amount: number) => string;
  onViewProducts: (categoryId: string) => void;
  onAssigned: (productIds: string[], categoryId: string | null) => void;
  onToast: (message: string) => void;
  addRequest: number;
  guideRequest: number;
}) {
  const [search, setSearch] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [sort, setSort] = useState<"products" | "name" | "units" | "value">("products");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [onlyEmpty, setOnlyEmpty] = useState<"all" | "with" | "empty">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editing, setEditing] = useState<ProductCategory | "new" | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<{ category: ProductCategory; el: HTMLElement } | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const filtersButton = useRef<HTMLButtonElement | null>(null);
  // The page header's "Add Category" / "Category Guide" buttons bump these.
  useEffect(() => { if (addRequest > 0 && canManage) setEditing("new"); }, [addRequest, canManage]);
  useEffect(() => { if (guideRequest > 0) setGuideOpen(true); }, [guideRequest]);

  const rows = useMemo(() => categories.map((category) => ({ category, stats: statsFor(category.id) })), [categories, statsFor]);
  const uncategorised = statsFor(null);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const totals = {
    count: categories.length, newThisMonth: categories.filter((category) => category.createdAt >= monthStart).length,
    products: rows.reduce((sum, row) => sum + row.stats.products, 0), units: rows.reduce((sum, row) => sum + row.stats.units, 0), value: rows.reduce((sum, row) => sum + row.stats.value, 0)
  };
  const filtered = rows
    .filter(({ category, stats }) => (!search.trim() || `${category.name} ${category.description}`.toLowerCase().includes(search.trim().toLowerCase()))
      && (status === "all" || category.active === (status === "active")) && (onlyEmpty === "all" || (onlyEmpty === "empty" ? stats.products === 0 : stats.products > 0)))
    .sort((a, b) => sort === "name" ? a.category.name.localeCompare(b.category.name) : sort === "units" ? b.stats.units - a.stats.units : sort === "value" ? b.stats.value - a.stats.value : b.stats.products - a.stats.products);
  const tableRows = rows.filter(({ category }) => !tableSearch.trim() || `${category.name} ${category.description}`.toLowerCase().includes(tableSearch.trim().toLowerCase()));

  const toggleActive = async (category: ProductCategory) => {
    try {
      const { category: next } = await productMediaApi.updateCategory(category.id, { active: !category.active });
      setCategories(categories.map((entry) => entry.id === next.id ? next : entry));
    } catch (error: any) { onToast(error?.message ?? "Could not save."); }
  };
  const remove = async (category: ProductCategory) => {
    const count = statsFor(category.id).products;
    if (!window.confirm(`Delete "${category.name}"?${count ? ` ${count} product${count === 1 ? "" : "s"} will have no category.` : ""}`)) return;
    try {
      await productMediaApi.removeCategory(category.id);
      setCategories(categories.filter((entry) => entry.id !== category.id));
      onAssigned(products.filter((product) => product.categoryId === category.id).map((product) => product.id), null);
      onToast("Category deleted.");
    } catch (error: any) { onToast(error?.message ?? "Could not delete."); }
  };
  const exportCsv = () => csvDownload(`categories-${new Date().toISOString().slice(0, 10)}.csv`, ["Category", "Description", "Products", "Units in stock", ...(showValue ? ["Stock value"] : []), "Status", "Created"],
    rows.map(({ category, stats }) => [category.name, category.description, stats.products, stats.units, ...(showValue ? [Math.round(stats.value)] : []), category.active ? "Active" : "Inactive", category.createdAt?.slice(0, 10)]));
  const bars = rows.map((row) => row.stats);

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 gap-3 ${showValue ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        <MiniStat icon={<LayoutGrid className="h-5 w-5" />} tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" value={totals.count} label="Total Categories" hint={totals.newThisMonth ? `+${totals.newThisMonth} this month` : undefined} chart={<MiniBars values={bars.map((row) => row.products)} color="#a855f7" />} />
        <MiniStat icon={<Box className="h-5 w-5" />} tone="bg-teal-50 text-teal-600 dark:bg-teal-500/15" value={totals.products} label="Total Products" sub={uncategorised.products ? `${uncategorised.products} without a category` : "Across all categories"} chart={<MiniBars values={bars.map((row) => row.products)} color="#3b82f6" />} />
        <MiniStat icon={<Package className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15" value={totals.units.toLocaleString()} label="Total Units in Stock" chart={<MiniBars values={bars.map((row) => row.units)} color="#16a34a" />} />
        {showValue && <MiniStat icon={<Gift className="h-5 w-5" />} tone="bg-rose-50 text-rose-500 dark:bg-rose-500/15" value={formatValue(totals.value)} label="Total Stock Value" chart={<MiniBars values={bars.map((row) => row.value)} color="#ec4899" />} />}
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 flex-1 lg:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search categories..."
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[14px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>
        <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 lg:ml-auto [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
          <div className="inline-flex shrink-0 gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-slate-600 dark:bg-slate-950">
            {([["grid", "Grid", <LayoutGrid key="g" className="h-4 w-4" />], ["table", "Table", <Table2 key="t" className="h-4 w-4" />]] as const).map(([key, label, icon]) => (
              <button key={key} type="button" onClick={() => setView(key)} className={`!min-h-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-bold ${view === key ? "bg-[#1F8FE0] text-white" : "text-gray-600 dark:text-slate-300"}`}>{icon}{label}</button>
            ))}
          </div>
          <span className="shrink-0 text-[13px] text-gray-500">Sort by</span>
          <Pick value={sort} onChange={(value) => setSort(value as typeof sort)} label="Sort"><option value="products">Product count</option><option value="name">Name</option><option value="units">Units in stock</option>{showValue && <option value="value">Stock value</option>}</Pick>
          <span className="shrink-0 text-[13px] text-gray-500">Status</span>
          <Pick value={status} onChange={(value) => setStatus(value as typeof status)} label="Status"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></Pick>
          <button ref={filtersButton} type="button" onClick={() => setFiltersOpen((value) => !value)} className="!min-h-0 inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 text-[13px] font-bold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"><Filter className="h-4 w-4" />Filters</button>
        </div>
      </div>
      <PopoverMenu anchor={filtersButton.current} open={filtersOpen} onClose={() => setFiltersOpen(false)} width={210}>
        {([["all", "All categories"], ["with", "With products"], ["empty", "Empty categories"]] as const).map(([key, label]) => (
          <MenuItem key={key} icon={onlyEmpty === key ? <Check /> : <span className="block h-4 w-4" />} onClick={() => { setOnlyEmpty(key); setFiltersOpen(false); }}>{label}</MenuItem>
        ))}
      </PopoverMenu>

      {uncategorised.products > 0 && canManage && (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          {uncategorised.products} product{uncategorised.products === 1 ? " has" : "s have"} no category yet.
          <button type="button" onClick={() => setEditing(categories[0] ?? "new")} className="!min-h-0 font-black underline">Assign them</button>
        </p>
      )}

      {view === "grid" ? (
        filtered.length === 0 ? (
          <div className={`${cardShell} flex flex-col items-center gap-2 px-6 py-12 text-center`}>
            <LayoutGrid className="h-10 w-10 text-gray-300" />
            <p className="m-0 text-sm font-black text-gray-700 dark:text-slate-200">{categories.length === 0 ? "No categories yet" : "No categories match"}</p>
            <p className="m-0 max-w-sm text-[13px] text-gray-500">Group products (Bathroom Storage, Cleaning Tools...) so everyone finds them fast.</p>
            {canManage && categories.length === 0 && <button type="button" onClick={() => setEditing("new")} className="!min-h-0 mt-2 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-sm font-black text-white">Add the first category</button>}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            {filtered.map(({ category, stats }) => (
              <article key={category.id} className={`${cardShell} flex flex-col overflow-hidden p-2`}>
                <div className="relative aspect-[16/7] overflow-hidden rounded-xl" style={{ background: `${CATEGORY_HEX[category.color] ?? OTHERS_HEX}1a` }}>
                  {stats.cover ? <img src={stats.cover} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center"><CategoryIcon category={category} size="h-14 w-14" iconSize="h-7 w-7" /></span>}
                  <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold shadow-sm dark:bg-slate-900/90">
                    <span className={`h-2 w-2 rounded-full ${category.active ? "bg-emerald-500" : "bg-rose-500"}`} /><span className={category.active ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600"}>{category.active ? "Active" : "Inactive"}</span>
                  </span>
                </div>
                <div className="flex items-center gap-2.5 px-1.5 pt-3">
                  <CategoryIcon category={category} />
                  <div className="min-w-0"><h3 className="m-0 truncate text-[14.5px] font-black text-gray-900 dark:text-slate-100">{category.name}</h3><p className="m-0 text-[11.5px] text-gray-400">{stats.products} product{stats.products === 1 ? "" : "s"}</p></div>
                </div>
                <div className="flex items-center justify-between gap-2 px-1.5 pt-3">
                  <span className={`text-[13px] font-bold ${stats.units > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}>{stats.units.toLocaleString()} units in stock</span>
                  {showValue && <strong className="text-[14px] font-black text-gray-900 dark:text-slate-100">{formatValue(stats.value)}</strong>}
                </div>
                <div className="mt-3 flex gap-2 px-1.5 pb-1.5">
                  <button type="button" onClick={() => onViewProducts(category.id)} className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 py-2 text-[13px] font-bold text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100">View Products <ArrowRight className="h-3.5 w-3.5" /></button>
                  {canManage && <button type="button" aria-label={`More for ${category.name}`} onClick={(event) => setMenuFor({ category, el: event.currentTarget })} className="!min-h-0 rounded-xl border border-gray-200 px-2.5 text-gray-600 dark:border-slate-600 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button>}
                </div>
              </article>
            ))}
          </div>
        )
      ) : null}

      <section className={`${cardShell} overflow-hidden`}>
        <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
          <h2 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">All Categories <span className="text-gray-400">({categories.length})</span></h2>
          <div className="flex gap-2 sm:ml-auto">
            <label className="relative block min-w-0 flex-1 sm:w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Search categories..." className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-2 text-[13px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
            </label>
            <button type="button" onClick={exportCsv} className="!min-h-0 inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1F8FE0] px-3.5 text-[13px] font-bold text-white"><Download className="h-4 w-4" />Export</button>
          </div>
        </div>
        <div className="divide-y divide-gray-100 border-t border-gray-100 md:hidden dark:divide-slate-800 dark:border-slate-800">
          {tableRows.map(({ category, stats }) => (
            <div key={category.id} className="flex items-center gap-3 px-4 py-3">
              <CategoryIcon category={category} size="h-9 w-9" iconSize="h-4 w-4" />
              <button type="button" onClick={() => onViewProducts(category.id)} className="!min-h-0 min-w-0 flex-1 text-left">
                <span className="block truncate text-[13.5px] font-bold text-gray-900 dark:text-slate-100">{category.name}</span>
                <span className="block text-[11.5px] text-gray-500">{stats.products} products · {stats.units.toLocaleString()} units{showValue ? ` · ${formatValue(stats.value)}` : ""}</span>
              </button>
              <ActivePill active={category.active} />
              {canManage && <button type="button" aria-label="More" onClick={(event) => setMenuFor({ category, el: event.currentTarget })} className="!min-h-0 rounded-lg p-1.5 text-gray-500"><MoreVertical className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto border-t border-gray-100 md:block dark:border-slate-800">
          <table className="w-full [&_td]:align-middle min-w-[54rem] text-left text-[13px]">
            <thead className="bg-gray-50 text-[11.5px] font-bold text-gray-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Select all" checked={tableRows.length > 0 && tableRows.every((row) => ticked.has(row.category.id))} onChange={(event) => setTicked(event.target.checked ? new Set(tableRows.map((row) => row.category.id)) : new Set())} className="accent-[#1F8FE0]" /></th>
                <th className="w-8 py-2.5">#</th><th className="py-2.5">Category</th><th className="py-2.5">Description</th><th className="py-2.5 text-right">Products</th>
                <th className="py-2.5 text-right">Units in Stock</th>{showValue && <th className="py-2.5 text-right">Stock Value</th>}<th className="py-2.5 pl-8">Status</th><th className="py-2.5">Created At</th><th className="px-4 py-2.5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {tableRows.map(({ category, stats }, index) => (
                <tr key={category.id} className="hover:bg-gray-50/70 dark:hover:bg-slate-900/50">
                  <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Select ${category.name}`} checked={ticked.has(category.id)} onChange={() => setTicked((current) => { const next = new Set(current); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })} className="accent-[#1F8FE0]" /></td>
                  <td className="py-2.5 text-gray-400">{index + 1}</td>
                  <td className="py-2.5"><button type="button" onClick={() => onViewProducts(category.id)} className="!min-h-0 flex items-center gap-2.5 font-bold text-gray-900 hover:text-[#1F8FE0] dark:text-slate-100"><CategoryIcon category={category} size="h-8 w-8" iconSize="h-4 w-4" />{category.name}</button></td>
                  <td className="max-w-[18rem] truncate py-2.5 text-gray-500 dark:text-slate-400">{category.description || "—"}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{stats.products}</td>
                  <td className="py-2.5 text-right tabular-nums">{stats.units.toLocaleString()}</td>
                  {showValue && <td className="py-2.5 text-right font-semibold tabular-nums">{formatValue(stats.value)}</td>}
                  <td className="py-2.5 pl-8"><ActivePill active={category.active} /></td>
                  <td className="py-2.5 text-[12px] text-gray-500">{category.createdAt ? new Date(category.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"}<span className="block text-gray-400">{category.createdAt ? new Date(category.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : ""}</span></td>
                  <td className="px-4 py-2.5 text-center">{canManage ? <button type="button" aria-label={`Actions for ${category.name}`} onClick={(event) => setMenuFor({ category, el: event.currentTarget })} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 dark:border-slate-600 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {categories.length === 0 && <p className="m-0 py-8 text-center text-[13px] text-gray-400">No categories yet.</p>}
      </section>

      <PopoverMenu anchor={menuFor?.el ?? null} open={Boolean(menuFor)} onClose={() => setMenuFor(null)} width={200}>
        {menuFor && (
          <>
            <MenuItem icon={<ArrowRight />} onClick={() => { onViewProducts(menuFor.category.id); setMenuFor(null); }}>View products</MenuItem>
            <MenuItem icon={<Pencil />} onClick={() => { setEditing(menuFor.category); setMenuFor(null); }}>Edit</MenuItem>
            <MenuItem icon={<Power />} onClick={() => { void toggleActive(menuFor.category); setMenuFor(null); }}>{menuFor.category.active ? "Make inactive" : "Make active"}</MenuItem>
            <MenuItem icon={<Trash2 />} tone="danger" onClick={() => { void remove(menuFor.category); setMenuFor(null); }}>Delete</MenuItem>
          </>
        )}
      </PopoverMenu>

      {editing && (
        <CategorySheet category={editing === "new" ? null : editing} products={products} onClose={() => setEditing(null)} onToast={onToast}
          onSaved={(saved, assigned, unassigned) => {
            setCategories(editing === "new" ? [...categories, saved] : categories.map((entry) => entry.id === saved.id ? saved : entry));
            if (assigned.length) onAssigned(assigned, saved.id);
            if (unassigned.length) onAssigned(unassigned, null);
            setEditing(null);
          }} />
      )}
      {guideOpen && (
        <Sheet title="Category guide" subtitle="How to group products so the team finds them fast." onClose={() => setGuideOpen(false)}>
          <div className="space-y-3 text-[14px] leading-relaxed text-gray-700 dark:text-slate-200">
            {[["Group by where it is used", "Bathroom Storage, Kitchen & Home, Cleaning Tools. Reps think about the customer's room, not the SKU."],
              ["Keep it to 5–10 categories", "Too many and nothing is ever where you look. 'Others' is fine for one-offs."],
              ["One category per product", "A product sits in exactly one place, so stock and value never count twice."],
              ["Make a category inactive instead of deleting it", "Its products stay put; the category just stops being offered in filters."],
              ["Covers come from the products", "Add good photos to a product's gallery and its category card picks one up."]].map(([title, body]) => (
              <div key={title}><p className="m-0 font-black text-gray-900 dark:text-slate-100">{title}</p><p className="m-0 text-[13px] text-gray-500 dark:text-slate-400">{body}</p></div>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

const ActivePill = ({ active }: { active: boolean }) => (
  <span className={`rounded-md px-2 py-1 text-[11px] font-bold ${active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-slate-800"}`}>{active ? "Active" : "Inactive"}</span>
);

function Pick({ value, onChange, label, children }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode }) {
  return (
    <span className="relative block shrink-0">
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} className="h-10 appearance-none rounded-xl border border-gray-200 bg-white pl-3 pr-9 text-[13px] font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </span>
  );
}

function CategorySheet({ category, products, onClose, onSaved, onToast }: {
  category: ProductCategory | null; products: CatalogProduct[]; onClose: () => void;
  onSaved: (category: ProductCategory, assigned: string[], unassigned: string[]) => void; onToast: (message: string) => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [icon, setIcon] = useState(category?.icon ?? "grid");
  const [color, setColor] = useState(category?.color ?? "blue");
  const [active, setActive] = useState(category?.active ?? true);
  const initial = useMemo(() => new Set(category ? products.filter((product) => product.categoryId === category.id).map((product) => product.id) : []), [category, products]);
  const [chosen, setChosen] = useState<Set<string>>(initial);
  const [productSearch, setProductSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) { onToast("Give the category a name."); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim(), icon, color, active };
      const { category: saved } = category ? await productMediaApi.updateCategory(category.id, body) : await productMediaApi.addCategory(body);
      const assigned = Array.from(chosen).filter((id) => !initial.has(id));
      const unassigned = Array.from(initial).filter((id) => !chosen.has(id));
      if (assigned.length) await productMediaApi.assignCategory(assigned, saved.id);
      if (unassigned.length) await productMediaApi.assignCategory(unassigned, null);
      onSaved(saved, assigned, unassigned);
      onToast(category ? "Category saved." : "Category added.");
    } catch (error: any) { onToast(error?.message ?? "Could not save the category."); }
    finally { setBusy(false); }
  };
  const list = products.filter((product) => !productSearch.trim() || product.name.toLowerCase().includes(productSearch.trim().toLowerCase()));
  return (
    <Sheet wide title={category ? "Edit category" : "Add category"} onClose={onClose}
      footer={<div className="flex gap-2"><button type="button" onClick={onClose} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
        <button type="button" disabled={busy || !name.trim()} onClick={save} className="!min-h-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1F8FE0] px-4 py-3 text-sm font-black text-white disabled:opacity-50">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{category ? "Save category" : "Add category"}</button></div>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">Name *</span>
            <input value={name} onChange={(event) => setName(event.target.value.slice(0, 40))} placeholder="e.g. Bathroom Storage" className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-[15px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <label className="block"><span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">Description</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 200))} rows={2} placeholder="e.g. Racks, shelves, corner storage and bathroom organizers." className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" /></label>
          <div><span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">Icon</span>
            <div className="grid grid-cols-6 gap-1.5">{ICON_NAMES.map((key) => { const Icon = CATEGORY_ICONS[key]; return (
              <button key={key} type="button" aria-label={key} onClick={() => setIcon(key)} className={`!min-h-0 flex h-11 items-center justify-center rounded-xl border ${icon === key ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" : "border-gray-200 text-gray-500 dark:border-slate-600"}`}><Icon className="h-5 w-5" /></button>
            ); })}</div></div>
          <div><span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">Colour</span>
            <div className="flex flex-wrap gap-2">{COLOR_NAMES.map((key) => (
              <button key={key} type="button" aria-label={key} onClick={() => setColor(key)} className={`!min-h-0 h-9 w-9 rounded-full ring-offset-2 dark:ring-offset-slate-900 ${color === key ? "ring-2 ring-gray-900 dark:ring-white" : ""}`} style={{ background: CATEGORY_HEX[key] }} />
            ))}</div></div>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-950">
            <span><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-100">Active</span><span className="block text-[12px] text-gray-500">Inactive categories stay, but are not offered in filters.</span></span>
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="h-5 w-5 accent-[#1F8FE0]" />
          </label>
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200">Products in this category <span className="font-semibold text-gray-400">({chosen.size})</span></span>
          <input value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Search products..." className="mb-2 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-[13px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
          <div className="max-h-[22rem] divide-y divide-gray-100 overflow-y-auto rounded-xl border border-gray-100 dark:divide-slate-800 dark:border-slate-800">
            {list.map((product) => (
              <label key={product.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-slate-900">
                <input type="checkbox" checked={chosen.has(product.id)} onChange={() => setChosen((current) => { const next = new Set(current); if (next.has(product.id)) next.delete(product.id); else next.add(product.id); return next; })} className="h-4 w-4 accent-[#1F8FE0]" />
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{product.name}</span>
                  {product.categoryId && product.categoryId !== category?.id && <span className="block text-[11px] text-amber-600">Moves from its current category</span>}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
