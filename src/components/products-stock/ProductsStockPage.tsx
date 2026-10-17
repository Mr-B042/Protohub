import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, BellRing, BookOpen, Boxes, Camera, Check, CheckSquare, ChevronDown, CircleX, Database, Download, Filter, FolderOpen,
  Gift, Image as ImageIcon, LayoutGrid, LayoutTemplate, List, Package, Plus, Search, Settings, Square, Tag, Upload, Video, Wallet, X
} from "lucide-react";
import { productMediaApi, type CatalogSettings, type ProductMedia, type ProductMediaUsage } from "../../lib/api";
import { ApprovalQueue } from "./ApprovalQueue";
import { BundlesTab, type OfferProduct } from "./BundlesTab";
import { CategoriesTab, type CategoryStats } from "./CategoriesTab";
import { MediaLibrary } from "./MediaLibrary";
import { MediaGuideSheet, MediaRail, RejectSheet, type UploadMode } from "./MediaRail";
import { MediaViewer, galleryItemsFor, type GalleryItem } from "./MediaViewer";
import { ProductCard, ProductRow, menuIcons, type CardActions, type ProductView } from "./ProductCard";
import { ProductDetailsSheet } from "./ProductDetailsSheet";
import { SettingsTab } from "./SettingsTab";
import { MenuItem, PopoverMenu, Sheet, categoryTone, cardShell, useProductsStockData, type CatalogProduct } from "./shared";
import { DateRangeButton, StockOverviewTab, csvDownload, useDateRange, type StockRow } from "./StockOverviewTab";
import { UploadSheet } from "./UploadSheet";

// ── Products & Stock (Bright's designs, 17 Oct 2026) ────────────────────────
// Seven tabs laid out exactly as the supplied designs: Products, Stock
// Overview, Media Library, Approval Queue, Categories, Bundles & Offers,
// Settings. Built phone-first: most of the team works from a phone.
// The old page's cross-sell helper ("What can I sell to this customer?") is
// kept whole: every Cross-sell button opens it.

type TabKey = "products" | "stock" | "library" | "approvals" | "categories" | "bundles" | "settings";
type StockFilter = "all" | "in" | "low" | "out";
type MediaFilter = "any" | "photos" | "videos" | "none" | "pending";
type SortKey = "best" | "orders" | "name" | "price" | "stock";

const VIEW_KEY = "protohub.productsStock.view";
const MANAGER_ROLES = ["Owner", "Admin", "Manager"];
const NO_SEND_ROLES = ["Viewer", "Delivery Agent"];
const MANAGER_TABS: TabKey[] = ["approvals", "settings"];
const readView = (): "grid" | "list" | null => { try { const value = localStorage.getItem(VIEW_KEY); return value === "list" || value === "grid" ? value : null; } catch { return null; } };

const HEADER: Record<TabKey, { tag?: string; text: string }> = {
  products: { text: "Manage your product catalogue, stock levels, media gallery and what's available for sale." },
  stock: { tag: "Stock Overview", text: "Get a real-time view of your inventory, availability, movement and stock health across all products." },
  library: { tag: "Media Library", text: "Manage product images and videos used in sales, marketing and by your sales reps." },
  approvals: { text: "Review and approve media files submitted by sales reps or team members before they become available." },
  categories: { text: "Organize your products into categories to manage stock, media and sales easily." },
  bundles: { text: "Create and manage product bundles, multi-pack offers and free gift combinations." },
  settings: { text: "Configure settings for product catalogue, stock management, media, approvals and offers." }
};

export type ProductsStockPageProps<P extends CatalogProduct> = {
  products: P[];
  currentUserId: string;
  // The role being shown: the real role, or the person/role in "Viewing as".
  viewerRole: string;
  // "Viewing as" while its Read-only switch is on: nothing on this page writes.
  isPreview: boolean;
  canManageCatalog: boolean;
  // Manage Stock: Owner / Admin / Manager / Inventory roles (Bright, 17 Oct 2026).
  canManageStock: boolean;
  // False for the logistics role: it never sees prices or money (server strips them too).
  showMoney: boolean;
  stockOf: (product: P) => number;
  states: string[];
  stateQty: (product: P, state: string) => number;
  lowStockThreshold: number;
  onLowStockThreshold: (value: number) => void;
  pricingFor: (product: P, currency: string) => { amount: number; currency: string };
  formatMoney: (amount: number, currency: string) => string;
  currencies: string[];
  sellingState: string;
  landingPageCount: (productId: string) => number;
  onOpenLanding: (productId: string) => void;
  onAddProduct: () => void;
  onManageStock: (productId: string) => void;
  onEditProduct: (productId: string) => void;
  onEditPackage: (productId: string, packageId: string) => void;
  onPackageCreated: (productId: string, saved: any) => void;
  onPackagePatched: (productId: string, packageId: string, patch: { active?: boolean }) => void;
  onCrossSell: (productId: string) => void;
  onCategoryAssigned: (productIds: string[], categoryId: string | null) => void;
  renderCrossSellHelper: () => ReactNode;
  showToast: (message: string) => void;
};

export function ProductsStockPage<P extends CatalogProduct>(props: ProductsStockPageProps<P>) {
  const { products, currentUserId, canManageCatalog, stockOf, lowStockThreshold, showToast, showMoney } = props;
  const data = useProductsStockData();
  const { setMedia, categories } = data;
  const settings: CatalogSettings | null = data.settings;
  // ⚠️ Bright, 17 Oct 2026: Approval Queue, Settings and every stock-value
  // figure are Owner / Admin / Manager only. The server answers for the REAL
  // signed-in person, so in "Viewing as" these follow the role being viewed.
  const viewerIsManager = MANAGER_ROLES.includes(props.viewerRole);
  const canApprove = data.canApprove && viewerIsManager;
  const canSend = data.canSend && (viewerIsManager || !NO_SEND_ROLES.includes(props.viewerRole)) && (viewerIsManager || data.repUploadsEnabled);
  const showValue = viewerIsManager;
  const writable = !props.isPreview;
  const canManageStock = props.canManageStock && writable;
  const media = useMemo(() => viewerIsManager ? data.media : data.media.filter((item) => item.status === "approved" || item.uploadedBy === currentUserId),
    [data.media, viewerIsManager, currentUserId]);
  const readOnly = () => { showToast("Viewing as is read-only. Exit preview to make changes."); };

  const [tab, setTab] = useState<TabKey>("products");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("any");
  const [sort, setSort] = useState<SortKey>("best");
  const [view, setView] = useState<"grid" | "list">(() => readView() ?? "grid");
  // Busiest first (Bright, 17 Oct 2026): real orders in the last 30 days.
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});
  useEffect(() => { productMediaApi.orderCounts().then((result) => setOrderCounts(result?.counts ?? {})).catch(() => undefined); }, []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [libraryBulkOpen, setLibraryBulkOpen] = useState(false);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [upload, setUpload] = useState<{ productId?: string; mode: UploadMode } | null>(null);
  const [viewer, setViewer] = useState<{ productName: string; items: GalleryItem[]; index: number } | null>(null);
  const [details, setDetails] = useState<string>("");
  const [rejecting, setRejecting] = useState<{ items: ProductMedia[]; mode: "reject" | "changes" } | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [crossSellOpen, setCrossSellOpen] = useState(false);
  const [categoryAdd, setCategoryAdd] = useState(0);
  const [categoryGuide, setCategoryGuide] = useState(0);
  const [offerCreate, setOfferCreate] = useState(0);
  const [offerTemplates, setOfferTemplates] = useState(0);
  const [offerBulk, setOfferBulk] = useState<{ at: number; anchor: HTMLElement | null }>({ at: 0, anchor: null });
  const { range, setRange } = useDateRange();
  const filtersButton = useRef<HTMLButtonElement | null>(null);
  const bulkButton = useRef<HTMLButtonElement | null>(null);
  const libraryBulkButton = useRef<HTMLButtonElement | null>(null);
  const uploadChevron = useRef<HTMLButtonElement | null>(null);
  const tabMenuButton = useRef<HTMLButtonElement | null>(null);

  // Phones: the tab strip scrolls, so bring the chosen tab into view.
  const firstTabRender = useRef(true);
  useEffect(() => {
    if (firstTabRender.current) { firstTabRender.current = false; return; }
    const button = document.querySelector<HTMLElement>(`[data-ps-tab="${tab}"]`);
    const strip = button?.closest("nav");
    if (button && strip) strip.scrollTo({ left: button.offsetLeft - (strip.clientWidth - button.offsetWidth) / 2, behavior: "smooth" });
  }, [tab]);

  // Switching "Viewing as" to a rep while on a manager-only tab: go back.
  useEffect(() => {
    if ((!viewerIsManager && MANAGER_TABS.includes(tab)) || (!showMoney && tab === "bundles")) setTab("products");
  }, [viewerIsManager, showMoney, tab]);

  // The branch's default view applies until this person picks one.
  useEffect(() => { if (settings && !readView()) setView(settings.defaultView); }, [settings]);

  const unitsWord = settings?.unitsWord === "pcs" ? "pcs" : settings?.unitsWord === "pieces" ? "pieces" : "units";
  const showStockNumbers = canApprove || canManageCatalog || props.canManageStock || settings?.showStockToReps !== false;
  const currency = settings?.preferredCurrency ?? "NGN";
  const formatPrice = useCallback((amount: number, code: string) => {
    if (settings?.priceFormat !== "short" || Math.abs(amount) < 10000) return props.formatMoney(amount, code);
    const symbol = props.formatMoney(0, code).replace(/[\d.,\s]/g, "");
    return `${symbol}${Math.abs(amount) >= 1_000_000 ? `${(amount / 1_000_000).toFixed(1)}M` : `${(amount / 1000).toFixed(1)}K`}`.replace(".0", "");
  }, [settings?.priceFormat, props]);
  const formatValue = useCallback((amount: number) => formatPrice(Math.round(amount), currency), [formatPrice, currency]);

  // Reps see what they can sell (and, if Settings says so, only what is in stock).
  const catalogue = useMemo(() => products.filter((product) => canManageCatalog || canApprove
    || (product.active && !(settings?.hideUnavailableFromReps && stockOf(product) <= 0))), [products, canManageCatalog, canApprove, settings?.hideUnavailableFromReps, stockOf]);
  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const productName = useCallback((id: string) => products.find((product) => product.id === id)?.name ?? "Product", [products]);
  const mediaByProduct = useMemo(() => {
    const map = new Map<string, ProductMedia[]>();
    for (const item of media) map.set(item.productId, [...(map.get(item.productId) ?? []), item]);
    return map;
  }, [media]);
  const priceOf = useCallback((product: P) => props.pricingFor(product, currency), [props, currency]);

  const viewOf = useCallback((product: P): ProductView => {
    const stock = stockOf(product);
    const own = mediaByProduct.get(product.id) ?? [];
    const packageImages = product.packages.flatMap((pkg) => [pkg.imageUrl, ...(pkg.imageUrls ?? [])]).filter(Boolean) as string[];
    const category = product.categoryId ? categoryById.get(product.categoryId) : null;
    const price = priceOf(product);
    const low = stock > 0 && stock <= lowStockThreshold;
    return {
      id: product.id, name: product.name, sku: settings?.showSku === false ? "" : product.sku, description: product.description, active: product.active,
      stock, stockState: stock <= 0 ? "out" : low && settings?.showLowStockWarning !== false ? "low" : "ok",
      priceText: showMoney ? formatPrice(price.amount, price.currency) : "",
      category: category ? { name: category.name, color: category.color } : null,
      items: galleryItemsFor(own, packageImages),
      pendingCount: own.filter((item) => item.status === "pending" && (canApprove || item.uploadedBy === currentUserId)).length,
      landingPageCount: props.landingPageCount(product.id),
      unitsWord, showStockNumbers, fallbackImage: settings?.defaultMainImageUrl ?? null, orders30d: orderCounts[product.id] ?? 0
    };
  }, [stockOf, mediaByProduct, categoryById, priceOf, lowStockThreshold, settings, formatPrice, canApprove, currentUserId, props, unitsWord, showStockNumbers, showMoney, orderCounts]);
  const views = useMemo(() => catalogue.map((product) => ({ product, view: viewOf(product) })), [catalogue, viewOf]);
  const coverOf = useCallback((productId: string) => {
    const row = views.find((entry) => entry.product.id === productId);
    return row?.view.items[0]?.thumbUrl ?? row?.view.items[0]?.url ?? settings?.defaultMainImageUrl ?? null;
  }, [views, settings?.defaultMainImageUrl]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return views.filter(({ product, view: card }) => {
      if (needle && !`${product.name} ${product.sku} ${product.description ?? ""} ${card.category?.name ?? ""}`.toLowerCase().includes(needle)) return false;
      if (categoryFilter === "none" ? product.categoryId : categoryFilter && product.categoryId !== categoryFilter) return false;
      if (statusFilter !== "all" && product.active !== (statusFilter === "active")) return false;
      if (stockFilter === "in" && card.stockState !== "ok") return false;
      if (stockFilter === "low" && card.stockState !== "low") return false;
      if (stockFilter === "out" && card.stockState !== "out") return false;
      const own = card.items.filter((item) => item.media);
      if (mediaFilter === "photos" && !own.some((item) => item.kind === "image")) return false;
      if (mediaFilter === "videos" && !own.some((item) => item.kind === "video")) return false;
      if (mediaFilter === "none" && own.length > 0) return false;
      if (mediaFilter === "pending" && card.pendingCount === 0) return false;
      return true;
    }).sort((a, b) => sort === "name" ? a.product.name.localeCompare(b.product.name)
      : sort === "price" ? priceOf(a.product).amount - priceOf(b.product).amount
      : sort === "stock" ? b.view.stock - a.view.stock
      : sort === "orders" ? b.view.orders30d - a.view.orders30d || a.product.name.localeCompare(b.product.name)
      // Best match: active first, then the most orders in 30 days, then in stock.
      : Number(b.product.active) - Number(a.product.active) || b.view.orders30d - a.view.orders30d || Number(b.view.stock > 0) - Number(a.view.stock > 0) || a.product.name.localeCompare(b.product.name));
  }, [views, search, categoryFilter, statusFilter, stockFilter, mediaFilter, sort, priceOf]);

  // ── Headline numbers ──────────────────────────────────────
  const totalUnits = activeProducts.reduce((sum, product) => sum + Math.max(0, stockOf(product)), 0);
  const totalValue = activeProducts.reduce((sum, product) => sum + Math.max(0, stockOf(product)) * priceOf(product).amount, 0);
  const lowCount = activeProducts.filter((product) => { const stock = stockOf(product); return stock > 0 && stock <= lowStockThreshold; }).length;
  const outCount = activeProducts.filter((product) => stockOf(product) <= 0).length;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const addedThisMonth = activeProducts.filter((product) => new Date(product.createdAt).getTime() >= monthStart).length;
  const outInState = activeProducts.filter((product) => props.stateQty(product, props.sellingState) <= 0).length;

  const [trend, setTrend] = useState<Array<{ day: string; totalUnits: number }>>([]);
  useEffect(() => { productMediaApi.stockTrend().then((result) => setTrend(result?.days ?? [])).catch(() => undefined); }, []);
  // Today's total is saved once, after live stock has had time to load, so
  // the "from last week" line has history to compare against.
  const totalRef = useRef(totalUnits);
  totalRef.current = totalUnits;
  useEffect(() => {
    if (!canApprove) return;
    const timer = window.setTimeout(() => { if (totalRef.current > 0) void productMediaApi.saveStockTotal(totalRef.current).catch(() => undefined); }, 8000);
    return () => window.clearTimeout(timer);
  }, [canApprove]);
  const weekAgo = useMemo(() => {
    const cutoff = new Date(Date.now() - 7 * 86400000 + 3600000).toISOString().slice(0, 10);
    return [...trend].reverse().find((row) => row.day <= cutoff) ?? null;
  }, [trend]);
  const weekChange = weekAgo && weekAgo.totalUnits > 0 ? Math.round(((totalUnits - weekAgo.totalUnits) / weekAgo.totalUnits) * 100) : null;
  const sparkline = [...trend.slice(-13).map((row) => row.totalUnits), totalUnits];
  const unitsHint = weekChange === null ? { text: trend.length ? "Weekly change shows after 7 days" : "Weekly change starts today", tone: "muted" as const }
    : { text: `${weekChange >= 0 ? "+" : ""}${weekChange}% from last week`, tone: weekChange >= 0 ? "up" as const : "down" as const };

  const pendingForMe = media.filter((item) => item.status === "pending" && (canApprove || item.uploadedBy === currentUserId)).length;
  const recent = useMemo(() => media
    .filter((item) => item.status !== "uploading" && (canApprove ? item.reviewedBy !== item.uploadedBy || item.status !== "approved" : item.uploadedBy === currentUserId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [media, canApprove, currentUserId]);

  // ── Media actions ─────────────────────────────────────────
  const replaceMedia = (next: ProductMedia) => setMedia((current) => current.map((item) => item.id === next.id ? next : item));
  const openViewerFor = (productId: string, index: number) => {
    const card = views.find((row) => row.product.id === productId)?.view;
    if (!card || card.items.length === 0) return;
    setViewer({ productName: card.name, items: card.items, index });
  };
  const openMediaPreview = (item: ProductMedia) => {
    if (item.status === "approved") {
      const card = views.find((row) => row.product.id === item.productId)?.view;
      const index = card?.items.findIndex((entry) => entry.key === item.id) ?? -1;
      if (card && index >= 0) { setViewer({ productName: card.name, items: card.items, index }); return; }
    }
    if (!item.url) return;
    setViewer({ productName: productName(item.productId), index: 0, items: [{ key: item.id, kind: item.kind, url: item.url, thumbUrl: item.thumbUrl, labelText: `${item.labelText} · ${item.status === "pending" ? "waiting for approval" : item.status}`, caption: item.caption, byline: item.uploadedByName, durationSeconds: item.durationSeconds, media: null }] });
  };
  const approve = async (item: ProductMedia) => {
    if (!writable) { readOnly(); return; }
    try { const { media: done } = await productMediaApi.approve(item.id); replaceMedia(done); showToast("Approved. It is now in the gallery."); }
    catch (error: any) { showToast(error?.message ?? "Could not approve."); }
  };
  const applyBulk = (done: Array<ProductMedia | { id: string; deleted: true }>) => setMedia((current) => {
    const deleted = new Set(done.filter((entry) => "deleted" in entry).map((entry) => entry.id));
    const updated = new Map(done.filter((entry): entry is ProductMedia => !("deleted" in entry)).map((entry) => [entry.id, entry]));
    return current.filter((item) => !deleted.has(item.id)).map((item) => updated.get(item.id) ?? item);
  });
  const approveMany = async (items: ProductMedia[]) => {
    if (!writable) { readOnly(); return; }
    const ids = items.filter((item) => item.status === "pending").map((item) => item.id);
    if (!ids.length) return;
    try {
      const result = await productMediaApi.bulk(ids, "approve");
      applyBulk(result.done);
      showToast(`${result.done.length} approved${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.`);
    } catch (error: any) { showToast(error?.message ?? "Could not approve."); }
  };
  const decline = async (items: ProductMedia[], reason: string, mode: "reject" | "changes") => {
    if (!writable) { readOnly(); return; }
    try {
      if (mode === "changes") { const { media: done } = await productMediaApi.requestChanges(items[0].id, reason); replaceMedia(done); showToast("Sent. The sender was told what to change."); return; }
      if (items.length === 1) { const { media: done } = await productMediaApi.reject(items[0].id, reason); replaceMedia(done); }
      else { const result = await productMediaApi.bulk(items.map((item) => item.id), "reject", { reason }); applyBulk(result.done); }
      showToast(`Rejected. ${items.length === 1 ? "The file was" : "The files were"} deleted and the sender told why.`);
    } catch (error: any) { showToast(error?.message ?? "Could not save."); throw error; }
  };
  const remove = async (item: ProductMedia) => {
    if (!writable) { readOnly(); return; }
    if (!window.confirm(item.status === "approved" ? "Delete this file from the gallery for everyone?" : "Delete this file?")) return;
    try {
      await productMediaApi.remove(item.id);
      setMedia((current) => current.filter((entry) => entry.id !== item.id));
      setViewer((current) => {
        if (!current) return current;
        const items = current.items.filter((entry) => entry.key !== item.id);
        return items.length ? { ...current, items, index: Math.min(current.index, items.length - 1) } : null;
      });
      showToast("Deleted.");
    } catch (error: any) { showToast(error?.message ?? "Could not delete."); }
  };
  const setCover = async (item: ProductMedia) => {
    if (!writable) { readOnly(); return; }
    try {
      const { media: done } = await productMediaApi.update(item.id, { isCover: true });
      setMedia((current) => current.map((entry) => entry.productId === done.productId ? { ...entry, isCover: entry.id === done.id } : entry));
      setViewer(null);
      showToast("Cover picture set.");
    } catch (error: any) { showToast(error?.message ?? "Could not set the cover."); }
  };
  const updateMedia = async (item: ProductMedia, patch: { tags?: string[]; usage?: ProductMediaUsage[] }) => {
    if (!writable) { readOnly(); return; }
    try { const { media: done } = await productMediaApi.update(item.id, patch); replaceMedia(done); }
    catch (error: any) { showToast(error?.message ?? "Could not save."); }
  };
  const rescan = async (item: ProductMedia) => {
    if (!writable) { readOnly(); return; }
    try { const { media: done } = await productMediaApi.rescan(item.id); replaceMedia(done); showToast("Checked again: passed."); }
    catch (error: any) { showToast(error?.message ?? "Could not check the file."); void data.refresh(); }
  };
  const libraryBulk = async (ids: string[], action: "approve" | "delete" | "tag", extra?: { tag?: string }) => {
    if (!writable) { readOnly(); return; }
    try { const result = await productMediaApi.bulk(ids, action, extra); applyBulk(result.done); showToast(`${result.done.length} file${result.done.length === 1 ? "" : "s"} updated${result.skipped.length ? `, ${result.skipped.length} skipped` : ""}.`); }
    catch (error: any) { showToast(error?.message ?? "Could not change the files."); }
  };
  const startUpload = (mode: UploadMode, productId?: string) => {
    if (!writable) { readOnly(); return; }
    if (!canSend) { showToast(data.repUploadsEnabled ? "Your role cannot add photos or videos." : "Sending media is switched off for now."); return; }
    setUpload({ mode, productId });
  };
  const openCrossSell = (productId: string) => { props.onCrossSell(productId); setCrossSellOpen(true); };

  // ── Products tab actions ──────────────────────────────────
  const toggleSelect = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const bulkAssign = async (categoryId: string | null) => {
    if (!writable) { readOnly(); return; }
    const ids = Array.from(selected);
    try {
      await productMediaApi.assignCategory(ids, categoryId);
      props.onCategoryAssigned(ids, categoryId);
      showToast(`${ids.length} product${ids.length === 1 ? "" : "s"} updated.`);
      setBulkCategoryOpen(false);
      setSelected(new Set());
    } catch (error: any) { showToast(error?.message ?? "Could not set the category."); }
  };
  const exports = {
    products: () => csvDownload(`products-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Product", "SKU", "Category", "Status", "Units in stock", ...(showMoney ? ["Price"] : []), ...(showValue ? ["Stock value"] : []), "Photos", "Videos"],
      views.filter((row) => selected.size === 0 || selected.has(row.product.id) || tab !== "products").map(({ product, view: card }) => {
        const own = card.items.filter((item) => item.media);
        return [product.name, product.sku, card.category?.name ?? "", product.active ? "Active" : "Inactive", card.stock, ...(showMoney ? [priceOf(product).amount] : []),
          ...(showValue ? [Math.max(0, card.stock) * priceOf(product).amount] : []),
          own.filter((item) => item.kind === "image").length, own.filter((item) => item.kind === "video").length];
      })),
    media: () => csvDownload(`media-${new Date().toISOString().slice(0, 10)}.csv`, ["File", "Product", "Type", "Status", "What it shows", "Tags", "Size (KB)", "Sent by", "Sent on", "Link"],
      media.map((item) => [item.name, productName(item.productId), item.kind, item.status, item.labelText, item.tags.join("; "), Math.round(item.sizeBytes / 1024), item.uploadedByName, item.createdAt.slice(0, 10), item.status === "approved" ? item.url : ""])),
    categories: () => csvDownload(`categories-${new Date().toISOString().slice(0, 10)}.csv`, ["Category", "Description", "Products", "Status"],
      categories.map((category) => [category.name, category.description, products.filter((product) => product.categoryId === category.id).length, category.active ? "Active" : "Inactive"])),
    offers: () => csvDownload(`offers-${new Date().toISOString().slice(0, 10)}.csv`, ["Offer", "Product", "Pieces", "Price", "Status"],
      products.flatMap((product) => product.packages.map((pkg) => [pkg.name, product.name, pkg.quantity, pkg.price, pkg.active ? "Active" : "Inactive"])))
  };

  const actionsFor = (product: P, card: ProductView): CardActions => {
    const menu: CardActions["menu"] = [
      { key: "gallery", label: card.items.length ? `Open gallery (${card.items.length})` : "Open gallery", icon: menuIcons.gallery, onClick: () => (card.items.length ? openViewerFor(product.id, 0) : setDetails(product.id)) }
    ];
    if (canSend) menu.push({ key: "upload", label: canApprove ? "Add photos or videos" : "Send photos or videos", icon: menuIcons.upload, onClick: () => startUpload("files", product.id) });
    if (card.landingPageCount > 0) menu.push({ key: "landing", label: "View landing page", icon: menuIcons.landing, onClick: () => props.onOpenLanding(product.id) });
    if (showMoney) menu.push({ key: "crosssell", label: "Cross-sell helper", icon: <ArrowRight />, onClick: () => openCrossSell(product.id) });
    if (canManageStock) menu.push({ key: "stock", label: "Manage stock", icon: menuIcons.stock, onClick: () => props.onManageStock(product.id) });
    if (canApprove) menu.push({ key: "category", label: "Set category", icon: menuIcons.category, onClick: () => { setSelected(new Set([product.id])); setBulkCategoryOpen(true); } });
    return {
      canSelect: canApprove, selected: selected.has(product.id), onToggleSelect: () => toggleSelect(product.id),
      onOpenViewer: (index) => openViewerFor(product.id, index), onViewDetails: () => setDetails(product.id),
      primary: canManageStock ? { label: "Manage Stock", onClick: () => props.onManageStock(product.id) }
        : card.stock <= 0 ? { label: "Check stock", tone: "amber", onClick: () => openCrossSell(product.id) }
        : { label: <>Cross-sell <ArrowRight className="h-3.5 w-3.5" /></>, onClick: () => openCrossSell(product.id) },
      menu
    };
  };

  // ── Rows for the other tabs ───────────────────────────────
  const stockRows = useMemo<StockRow[]>(() => views.filter((row) => row.product.active).map(({ product, view: card }) => ({
    id: product.id, name: product.name, sku: product.sku, thumbUrl: card.items[0]?.thumbUrl ?? card.fallbackImage, categoryId: product.categoryId ?? null,
    categoryName: card.category?.name ?? "", stock: card.stock, value: Math.max(0, card.stock) * priceOf(product).amount,
    stateQty: (state: string) => props.stateQty(product, state), status: card.stockState
  })), [views, priceOf, props]);
  const libraryProducts = useMemo(() => catalogue.map((product) => ({ id: product.id, name: product.name, sku: product.sku, thumbUrl: coverOf(product.id) })), [catalogue, coverOf]);
  const categoryStats = useCallback((categoryId: string | null): CategoryStats => {
    const inCategory = products.filter((product) => (product.categoryId ?? null) === categoryId);
    return {
      products: inCategory.length, units: inCategory.reduce((sum, product) => sum + Math.max(0, stockOf(product)), 0),
      value: inCategory.reduce((sum, product) => sum + Math.max(0, stockOf(product)) * priceOf(product).amount, 0),
      cover: inCategory.map((product) => coverOf(product.id)).find(Boolean) ?? null
    };
  }, [products, stockOf, priceOf, coverOf]);
  const offerCounts = useMemo(() => {
    const live = products.flatMap((product) => product.packages.filter((pkg) => pkg.active).map((pkg) => ({ product, pkg: pkg as OfferProduct["packages"][number] })));
    return { active: live.length, gifts: live.filter(({ pkg }) => (pkg.packageComponents ?? []).some((item) => item.isFreeGift)).length, bundles: live.filter(({ pkg }) => pkg.quantity > 1).length };
  }, [products]);

  const detailsRow = details ? views.find((row) => row.product.id === details) : null;
  const tabs: Array<{ key: TabKey; label: string; icon: ReactNode; badge?: number }> = [
    { key: "products", label: "Products", icon: <Package className="h-4 w-4" /> },
    { key: "stock", label: "Stock Overview", icon: <Boxes className="h-4 w-4" /> },
    { key: "library", label: "Media Library", icon: <ImageIcon className="h-4 w-4" /> },
    { key: "approvals", label: canApprove ? "Approval Queue" : "My Submissions", icon: <BellRing className="h-4 w-4" />, badge: pendingForMe },
    { key: "categories", label: "Categories", icon: <FolderOpen className="h-4 w-4" /> },
    { key: "bundles", label: "Bundles & Offers", icon: <Gift className="h-4 w-4" /> },
    { key: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> }
  ];
  const visibleTabs = tabs.filter((item) => (viewerIsManager || !MANAGER_TABS.includes(item.key)) && (showMoney || item.key !== "bundles"));
  const activeFilterCount = Number(mediaFilter !== "any") + Number(sort !== "best");
  const header = HEADER[tab];
  const outlineButton = "!min-h-0 inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] font-bold text-gray-800 shadow-sm hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100";
  const primaryButton = "!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13.5px] font-black text-white shadow-sm hover:bg-blue-600";

  const statsProducts = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard icon={<Package className="h-6 w-6" />} tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15 dark:text-blue-300" value={activeProducts.length.toLocaleString()} label="Active Products"
        hint={addedThisMonth > 0 ? { text: `+${addedThisMonth} added this month`, tone: "up" } : { text: "No new products this month", tone: "muted" }} />
      <StatCard icon={<Boxes className="h-6 w-6" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" value={showStockNumbers ? totalUnits.toLocaleString() : "—"} label="Total Units in Stock" hint={unitsHint} chart={sparkline.length >= 3 ? <Sparkline values={sparkline} /> : null} />
      <StatCard icon={<AlertTriangle className="h-6 w-6" />} tone="bg-amber-50 text-amber-500 dark:bg-amber-500/15 dark:text-amber-300" value={lowCount.toLocaleString()} label="Low Stock"
        hint={lowCount === 0 ? { text: "All good!", tone: "ok" } : { text: `${lowCount} need restocking soon`, tone: "warn" }} />
      <StatCard icon={<CircleX className="h-6 w-6" />} tone="bg-rose-50 text-rose-500 dark:bg-rose-500/15 dark:text-rose-300" value={outCount.toLocaleString()} label="Out of Stock"
        hint={outCount === 0 ? { text: "Everything is in stock", tone: "ok" } : { text: `${outCount} product${outCount === 1 ? " needs" : "s need"} attention`, tone: "alert" }} />
    </div>
  );
  const statsStock = (
    <div className={`grid grid-cols-2 gap-3 md:grid-cols-3 ${showValue ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
      <StatCard icon={<Package className="h-6 w-6" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15" value={activeProducts.length.toLocaleString()} label="Total Products" hint={addedThisMonth ? { text: `+${addedThisMonth} this month`, tone: "up" } : { text: "None added this month", tone: "muted" }} />
      <StatCard icon={<Database className="h-6 w-6" />} tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" value={totalUnits.toLocaleString()} label="Total Units in Stock" hint={unitsHint} />
      {showValue && <StatCard icon={<Wallet className="h-6 w-6" />} tone="bg-violet-50 text-violet-600 dark:bg-violet-500/15" value={formatValue(totalValue)} label="Total Stock Value" hint={{ text: "At selling price", tone: "muted" }} />}
      <StatCard icon={<AlertTriangle className="h-6 w-6" />} tone="bg-amber-50 text-amber-500 dark:bg-amber-500/15" value={lowCount.toLocaleString()} label="Low Stock Items" hint={{ text: `≤ ${lowStockThreshold} ${unitsWord}`, tone: "muted" }} />
      <StatCard icon={<CircleX className="h-6 w-6" />} tone="bg-rose-50 text-rose-500 dark:bg-rose-500/15" value={outCount.toLocaleString()} label="Out of Stock" hint={{ text: `Unavailable in ${props.sellingState}: ${outInState}`, tone: "muted" }} />
    </div>
  );

  return (
    <div className="space-y-5 pb-24 sm:pb-6">
      {/* ── Title + this tab's actions ───────────────────── */}
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="m-0 flex flex-wrap items-baseline gap-x-2 text-[26px] font-black leading-tight tracking-tight text-gray-900 sm:text-[28px] dark:text-slate-100">
            Products &amp; Stock{tab === "stock" && <span className="text-[17px] font-black text-gray-800 dark:text-slate-200">· Stock Overview</span>}
          </h1>
          {tab === "library" && (
            <button ref={tabMenuButton} type="button" onClick={() => setTabMenuOpen((value) => !value)} className="!min-h-0 mt-0.5 inline-flex items-center gap-1 text-[15px] font-semibold text-gray-700 dark:text-slate-300">
              {header.tag}<ChevronDown className="h-4 w-4 text-gray-400" />
            </button>
          )}
          <p className="m-0 mt-1 text-[14px] text-gray-600 dark:text-slate-400">{header.text}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tab === "products" && canApprove && (
            <button type="button" onClick={() => setTab("approvals")} className={outlineButton}>
              <Package className="h-4 w-4 text-[#1F8FE0]" />Media Approvals
              {pendingForMe > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white">{pendingForMe}</span>}
            </button>
          )}
          {tab === "products" && canManageCatalog && <button type="button" onClick={props.onAddProduct} className={primaryButton}><Plus className="h-4 w-4" />Add Product</button>}
          {tab === "products" && canApprove && (
            <button ref={bulkButton} type="button" onClick={() => setBulkOpen((open) => !open)} className={outlineButton}>
              Bulk Actions{selected.size > 0 && <span className="rounded-full bg-blue-100 px-1.5 text-[11px] font-black text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">{selected.size}</span>}<ChevronDown className="h-4 w-4" />
            </button>
          )}
          {tab === "stock" && (
            <>
              <DateRangeButton range={range} onChange={setRange} />
              <button type="button" onClick={exports.products} className={primaryButton}><Download className="h-4 w-4" />Export</button>
            </>
          )}
          {tab === "library" && (
            <>
              <button type="button" onClick={() => setGuideOpen(true)} className={outlineButton}><BookOpen className="h-4 w-4" />Guidelines</button>
              {canSend && (
                <div className="flex overflow-hidden rounded-xl bg-[#1F8FE0] text-white shadow-sm">
                  <button type="button" onClick={() => startUpload("files")} className="!min-h-0 inline-flex items-center gap-2 px-4 py-2.5 text-[13.5px] font-black hover:bg-blue-600"><Plus className="h-4 w-4" />Upload Media</button>
                  <button ref={uploadChevron} type="button" aria-label="More ways to upload" onClick={() => setUploadMenuOpen((value) => !value)} className="!min-h-0 border-l border-white/25 px-3 hover:bg-blue-600"><ChevronDown className="h-4 w-4" /></button>
                </div>
              )}
              {canApprove && <button ref={libraryBulkButton} type="button" onClick={() => setLibraryBulkOpen((value) => !value)} className={outlineButton}>Bulk Actions<ChevronDown className="h-4 w-4" /></button>}
            </>
          )}
          {tab === "categories" && (
            <>
              <button type="button" onClick={() => setCategoryGuide((value) => value + 1)} className={outlineButton}><BookOpen className="h-4 w-4" />Category Guide</button>
              {canApprove && writable && <button type="button" onClick={() => setCategoryAdd((value) => value + 1)} className={primaryButton}><Plus className="h-4 w-4" />Add Category</button>}
            </>
          )}
          {tab === "bundles" && canManageCatalog && writable && (
            <>
              <button type="button" onClick={() => setOfferTemplates((value) => value + 1)} className={outlineButton}><LayoutTemplate className="h-4 w-4" />Offer Templates</button>
              <button type="button" onClick={(event) => setOfferBulk({ at: Date.now(), anchor: event.currentTarget })} className={outlineButton}>Bulk Actions<ChevronDown className="h-4 w-4" /></button>
              <button type="button" onClick={() => setOfferCreate((value) => value + 1)} className={primaryButton}><Plus className="h-4 w-4" />Create Offer</button>
            </>
          )}
        </div>
      </header>
      <PopoverMenu anchor={tabMenuButton.current} open={tabMenuOpen} onClose={() => setTabMenuOpen(false)} width={210}>
        {visibleTabs.map((item) => <MenuItem key={item.key} icon={item.icon} onClick={() => { setTab(item.key); setTabMenuOpen(false); }}>{item.label}</MenuItem>)}
      </PopoverMenu>
      <PopoverMenu anchor={uploadChevron.current} open={uploadMenuOpen} onClose={() => setUploadMenuOpen(false)} width={210}>
        <MenuItem icon={<ImageIcon />} onClick={() => { setUploadMenuOpen(false); startUpload("files"); }}>Choose from gallery</MenuItem>
        <MenuItem icon={<Camera />} onClick={() => { setUploadMenuOpen(false); startUpload("photo"); }}>Take a photo</MenuItem>
        <MenuItem icon={<Video />} onClick={() => { setUploadMenuOpen(false); startUpload("video"); }}>Record a video</MenuItem>
      </PopoverMenu>
      <PopoverMenu anchor={libraryBulkButton.current} open={libraryBulkOpen} onClose={() => setLibraryBulkOpen(false)} width={240}>
        <MenuItem icon={<Check />} disabled={pendingForMe === 0} onClick={() => { setLibraryBulkOpen(false); void approveMany(media.filter((item) => item.status === "pending")); }}>Approve all waiting ({pendingForMe})</MenuItem>
        <MenuItem icon={<Download />} onClick={() => { setLibraryBulkOpen(false); exports.media(); }}>Download media list (CSV)</MenuItem>
        <p className="m-0 px-3.5 py-2 text-[11.5px] text-gray-400">Tick files in the grid for delete or tag.</p>
      </PopoverMenu>
      <PopoverMenu anchor={bulkButton.current} open={bulkOpen} onClose={() => setBulkOpen(false)} width={240}>
        <p className="m-0 px-3.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">{selected.size ? `${selected.size} selected` : "Tick products on the cards first"}</p>
        <MenuItem icon={<Tag />} disabled={selected.size === 0} onClick={() => { setBulkOpen(false); setBulkCategoryOpen(true); }}>Set category</MenuItem>
        <MenuItem icon={<CheckSquare />} onClick={() => { setBulkOpen(false); setSelected(new Set(filtered.map((row) => row.product.id))); }}>Select all shown ({filtered.length})</MenuItem>
        <MenuItem icon={<Square />} disabled={selected.size === 0} onClick={() => { setBulkOpen(false); setSelected(new Set()); }}>Clear selection</MenuItem>
        <MenuItem icon={<Download />} onClick={() => { setBulkOpen(false); exports.products(); }}>Download list (CSV)</MenuItem>
      </PopoverMenu>

      {tab === "products" && statsProducts}

      <div className={`grid items-start gap-5 ${tab === "products" ? "xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[minmax(0,1fr)_21rem]" : ""}`}>
        <div className="min-w-0 space-y-4">
          <nav className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden" aria-label="Products & Stock sections">
            <div className="flex min-w-max gap-1 border-b border-gray-200 dark:border-slate-700">
              {visibleTabs.map((item) => {
                const on = tab === item.key;
                return (
                  <button key={item.key} type="button" data-ps-tab={item.key} onClick={() => setTab(item.key)} aria-current={on ? "page" : undefined}
                    className={`!min-h-0 -mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-xl border px-3 py-2.5 text-[13px] font-bold transition-colors ${on
                      ? "border-gray-200 border-b-white bg-white text-[#1F8FE0] shadow-[inset_0_-2px_0_#1F8FE0] dark:border-slate-700 dark:border-b-[#0c1722] dark:bg-[#0c1722]"
                      : "border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200"}`}>
                    {item.icon}{item.label}
                    {item.badge ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white">{item.badge}</span> : null}
                  </button>
                );
              })}
            </div>
          </nav>

          {data.error && <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">{data.error}</p>}

          {tab === "products" && (
            <section className="sm:rounded-2xl sm:border sm:border-gray-200/80 sm:bg-white sm:p-4 sm:shadow-sm dark:sm:border-slate-700 dark:sm:bg-[#0c1722]">
              <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
                <label className="relative block min-w-0 flex-1 lg:min-w-[16rem]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products by name, SKU, category..."
                    className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 text-[14px] text-gray-800 placeholder:text-gray-400 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
                  {search && <button type="button" aria-label="Clear search" onClick={() => setSearch("")} className="!min-h-0 absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>}
                </label>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
                  <FilterSelect value={categoryFilter} onChange={setCategoryFilter} label="Category">
                    <option value="">All Categories</option>
                    {categories.filter((category) => category.active || canApprove).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    <option value="none">No category</option>
                  </FilterSelect>
                  {(canManageCatalog || canApprove) && (
                    <FilterSelect value={statusFilter} onChange={(value) => setStatusFilter(value as typeof statusFilter)} label="Status">
                      <option value="all">All Status</option><option value="active">Active</option><option value="inactive">Inactive</option>
                    </FilterSelect>
                  )}
                  <FilterSelect value={stockFilter} onChange={(value) => setStockFilter(value as StockFilter)} label="Stock level">
                    <option value="all">All Stock Levels</option><option value="in">In stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
                  </FilterSelect>
                  <button ref={filtersButton} type="button" onClick={() => setFiltersOpen((open) => !open)}
                    className={`!min-h-0 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-bold ${activeFilterCount ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" : "border-gray-200 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"}`}>
                    <Filter className="h-4 w-4" />Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
                  </button>
                  <div className="hidden h-11 shrink-0 overflow-hidden rounded-xl border border-gray-200 sm:inline-flex dark:border-slate-600">
                    {([["grid", <LayoutGrid key="g" className="h-4 w-4" />, "Grid view"], ["list", <List key="l" className="h-4 w-4" />, "List view"]] as const).map(([key, icon, text]) => (
                      <button key={key} type="button" aria-label={text} aria-pressed={view === key} onClick={() => { setView(key); try { localStorage.setItem(VIEW_KEY, key); } catch { /* private window */ } }}
                        className={`!min-h-0 px-3 ${view === key ? "bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" : "bg-white text-gray-500 dark:bg-slate-950"}`}>{icon}</button>
                    ))}
                  </div>
                </div>
              </div>
              <PopoverMenu anchor={filtersButton.current} open={filtersOpen} onClose={() => setFiltersOpen(false)} width={250}>
                <p className="m-0 px-3.5 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Photos &amp; videos</p>
                {([["any", "Any"], ["photos", "Has photos"], ["videos", "Has videos"], ["none", "No photos or videos yet"], ["pending", "Waiting for approval"]] as const).map(([key, text]) => (
                  <MenuItem key={key} icon={mediaFilter === key ? <Check /> : <span className="block h-4 w-4" />} onClick={() => setMediaFilter(key)}>{text}</MenuItem>
                ))}
                <p className="m-0 mt-1 border-t border-gray-100 px-3.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:border-slate-800">Sort by</p>
                {([["best", "Best match"], ["orders", "Most orders (30 days)"], ["name", "Name A-Z"], ...(showMoney ? [["price", "Price"]] as const : []), ["stock", "Most stock"]] as const).map(([key, text]) => (
                  <MenuItem key={key} icon={sort === key ? <Check /> : <span className="block h-4 w-4" />} onClick={() => setSort(key)}>{text}</MenuItem>
                ))}
              </PopoverMenu>

              {selected.size > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-[13px] font-bold text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
                  {selected.size} selected
                  <button type="button" onClick={() => setBulkCategoryOpen(true)} className="!min-h-0 rounded-lg bg-white px-2.5 py-1 text-[12px] font-black text-[#1F8FE0] shadow-sm dark:bg-slate-900">Set category</button>
                  <button type="button" onClick={() => setSelected(new Set())} className="!min-h-0 ml-auto text-[12px] font-bold text-blue-700 dark:text-blue-300">Clear</button>
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center">
                  <Search className="h-8 w-8 text-gray-300" />
                  <p className="m-0 text-sm font-black text-gray-700 dark:text-slate-200">No products match</p>
                  <button type="button" onClick={() => { setSearch(""); setCategoryFilter(""); setStatusFilter("all"); setStockFilter("all"); setMediaFilter("any"); }} className="!min-h-0 text-[13px] font-bold text-[#1F8FE0]">Clear filters</button>
                </div>
              ) : view === "list" ? (
                <div className={`${cardShell} mt-4 px-2`}>{filtered.map(({ product, view: card }) => <ProductRow key={product.id} view={card} actions={actionsFor(product, card)} />)}</div>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">{filtered.map(({ product, view: card }) => <ProductCard key={product.id} view={card} actions={actionsFor(product, card)} />)}</div>
              )}
              <p className="m-0 mt-4 text-center text-[12px] font-semibold text-gray-400">Showing {filtered.length} of {catalogue.length} products</p>
            </section>
          )}

          {tab === "stock" && (
            <div className="space-y-4">
              {statsStock}
              <StockOverviewTab rows={stockRows} categories={categories} states={props.states} defaultState={props.sellingState} range={range} formatValue={formatValue}
                canManageCatalog={canManageStock} showStockNumbers={showStockNumbers} unitsWord={unitsWord} showValue={showValue}
                onRowAction={(action, productId) => { if (action === "details") setDetails(productId); else if (action === "gallery") openViewerFor(productId, 0); else if (action === "stock") props.onManageStock(productId); else openCrossSell(productId); }} />
            </div>
          )}
          {tab === "library" && (
            <MediaLibrary media={media} products={libraryProducts} canApprove={canApprove} currentUserId={currentUserId} canSend={canSend} onUpload={() => startUpload("files")}
              onOpenViewer={openMediaPreview} onApprove={approve} onReject={(item) => setRejecting({ items: [item], mode: "reject" })} onDelete={remove}
              onBulk={libraryBulk} onUpdate={updateMedia} onSetCover={setCover} onToast={showToast} />
          )}
          {tab === "approvals" && (
            <ApprovalQueue media={media} products={libraryProducts} canApprove={canApprove} currentUserId={currentUserId}
              onApprove={approve} onApproveMany={approveMany} onReject={(items) => { if (items.length) setRejecting({ items, mode: "reject" }); }}
              onRequestChanges={(item) => setRejecting({ items: [item], mode: "changes" })} onDelete={remove} onRescan={rescan} onOpen={openMediaPreview} />
          )}
          {tab === "categories" && (
            <CategoriesTab categories={categories} setCategories={data.setCategories} products={catalogue} statsFor={categoryStats} canManage={canApprove && writable} showValue={showValue} formatValue={formatValue}
              onViewProducts={(categoryId) => { setCategoryFilter(categoryId); setTab("products"); }} onAssigned={props.onCategoryAssigned} onToast={showToast}
              addRequest={categoryAdd} guideRequest={categoryGuide} />
          )}
          {tab === "bundles" && (
            <BundlesTab products={catalogue as unknown as OfferProduct[]} canEdit={canManageCatalog && writable} showValue={showValue}
              stockOf={(productId) => { const product = products.find((entry) => entry.id === productId); return product ? stockOf(product) : 0; }}
              stateQty={(productId, state) => { const product = products.find((entry) => entry.id === productId); return product ? props.stateQty(product, state) : 0; }}
              states={props.states} imageOf={(productId, packageImage) => packageImage || coverOf(productId)} formatMoney={formatPrice}
              onEditPackage={props.onEditPackage} onPackageCreated={props.onPackageCreated} onPackagePatched={props.onPackagePatched} onToast={showToast}
              createRequest={offerCreate} templatesRequest={offerTemplates} bulkRequest={offerBulk} />
          )}
          {tab === "settings" && (
            <SettingsTab settings={settings} onSaved={data.setSettings} canApprove={canApprove && writable} canManageCatalog={canManageCatalog && writable}
              lowStockThreshold={lowStockThreshold} onLowStockThreshold={props.onLowStockThreshold} currencies={props.currencies} offerCounts={offerCounts}
              categoryCount={categories.length} onGoCategories={() => setTab("categories")} onExport={(what) => exports[what]()} onToast={showToast} />
          )}
        </div>

        {tab === "products" && (
          <MediaRail recent={recent} canApprove={canApprove} canSend={canSend} repUploadsEnabled={data.repUploadsEnabled} productName={productName}
            currentUserId={currentUserId} onUpload={(mode) => startUpload(mode)} onViewAll={() => setTab(canApprove ? "approvals" : "library")} onOpenMedia={openMediaPreview}
            onApprove={approve} onReject={(item) => setRejecting({ items: [item], mode: "reject" })} onDelete={remove} onOpenGuide={() => setGuideOpen(true)} />
        )}
      </div>

      {/* Phones: the upload button stays under the thumb wherever you scroll. */}
      {canSend && (tab === "products" || tab === "library") && (
        <button type="button" onClick={() => startUpload("files")} aria-label="Upload media"
          className="!min-h-0 fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 inline-flex items-center gap-2 rounded-full bg-[#1F8FE0] px-5 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-500/30 active:scale-95 xl:hidden">
          <Upload className="h-5 w-5" />Upload
        </button>
      )}

      {upload && (
        <UploadSheet products={catalogue.map((product) => ({ id: product.id, name: product.name }))} initialProductId={upload.productId} initialMode={upload.mode}
          canApprove={canApprove || settings?.requireApproval === false}
          limits={settings ? { maxImageMb: settings.maxImageMb, maxVideoMb: settings.maxVideoMb, imageTypes: settings.allowedImageTypes, videoTypes: settings.allowedVideoTypes } : null}
          onClose={() => setUpload(null)} onToast={showToast}
          onUploaded={(added) => setMedia((current) => [...added, ...current.filter((item) => !added.some((entry) => entry.id === item.id))])} />
      )}
      {viewer && (
        <MediaViewer productName={viewer.productName} items={viewer.items} startIndex={viewer.index} onClose={() => setViewer(null)}
          canManage={canApprove} onSetCover={setCover} onDelete={remove} onToast={showToast} />
      )}
      {detailsRow && (
        <ProductDetailsSheet view={detailsRow.view} sellingState={props.sellingState} canSend={canSend}
          packages={detailsRow.product.packages.filter((pkg) => pkg.active).sort((a, b) => a.displayOrder - b.displayOrder).map((pkg) => ({ id: pkg.id, name: pkg.name, quantity: pkg.quantity, priceText: showMoney ? formatPrice(pkg.price, pkg.currency) : "" }))}
          stockByState={props.states.map((state) => ({ state, quantity: props.stateQty(detailsRow.product, state) }))}
          pairs={(detailsRow.product.crossSellProductIds ?? []).map((id) => productName(id))}
          onClose={() => setDetails("")}
          onOpenViewer={(index) => setViewer({ productName: detailsRow.view.name, items: detailsRow.view.items, index })}
          onUpload={() => startUpload("files", detailsRow.product.id)}
          onOpenLanding={detailsRow.view.landingPageCount > 0 ? () => props.onOpenLanding(detailsRow.product.id) : null}
          primary={canManageStock ? { label: "Manage Stock", onClick: () => props.onManageStock(detailsRow.product.id) }
            : { label: <>Cross-sell <ArrowRight className="h-4 w-4" /></>, onClick: () => { setDetails(""); openCrossSell(detailsRow.product.id); } }}
          secondary={canManageCatalog ? { label: "Edit product", onClick: () => props.onEditProduct(detailsRow.product.id) } : null} />
      )}
      {crossSellOpen && (
        <Sheet wide title="Cross-sell helper" subtitle="What can I sell to this customer? Stock by state, best pairings and alternatives." onClose={() => setCrossSellOpen(false)}>
          {props.renderCrossSellHelper()}
        </Sheet>
      )}
      {rejecting && (
        <RejectSheet media={rejecting.items[0]} count={rejecting.items.length} mode={rejecting.mode} onClose={() => setRejecting(null)}
          onReject={(reason) => decline(rejecting.items, reason, rejecting.mode)} />
      )}
      {guideOpen && <MediaGuideSheet onClose={() => setGuideOpen(false)} />}
      {bulkCategoryOpen && (
        <Sheet title="Set category" subtitle={`${selected.size} product${selected.size === 1 ? "" : "s"}`} onClose={() => setBulkCategoryOpen(false)}>
          <div className="space-y-2">
            {categories.length === 0 && (
              <p className="m-0 text-[13px] text-gray-500">No categories yet. <button type="button" className="!min-h-0 font-bold text-[#1F8FE0]" onClick={() => { setBulkCategoryOpen(false); setTab("categories"); }}>Add some in Categories</button>.</p>
            )}
            {categories.map((category) => (
              <button key={category.id} type="button" onClick={() => bulkAssign(category.id)}
                className="!min-h-0 flex w-full items-center justify-between rounded-xl border border-gray-200 px-3.5 py-3 text-left hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800">
                <span className={`rounded-md px-2 py-0.5 text-[13px] font-bold ${categoryTone(category.color)}`}>{category.name}</span>
                <ArrowRight className="h-4 w-4 text-gray-400" />
              </button>
            ))}
            {categories.length > 0 && <button type="button" onClick={() => bulkAssign(null)} className="!min-h-0 w-full rounded-xl px-3.5 py-3 text-left text-[13px] font-bold text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800">Remove category</button>}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function FilterSelect({ value, onChange, label, children }: { value: string; onChange: (value: string) => void; label: string; children: ReactNode }) {
  return (
    <span className="relative block shrink-0">
      <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}
        className="h-11 appearance-none rounded-xl border border-gray-200 bg-white pl-3.5 pr-9 text-[13px] font-semibold text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
    </span>
  );
}

function StatCard({ icon, tone, value, label, hint, chart }: {
  icon: ReactNode; tone: string; value: ReactNode; label: string;
  hint: { text: string; tone: "up" | "down" | "ok" | "warn" | "alert" | "muted" }; chart?: ReactNode;
}) {
  const hintTone = { up: "text-emerald-600 dark:text-emerald-400", down: "text-rose-600 dark:text-rose-400", ok: "text-emerald-600 dark:text-emerald-400", warn: "text-amber-600 dark:text-amber-400", alert: "text-rose-600 dark:text-rose-400", muted: "text-gray-400 dark:text-slate-500" }[hint.tone];
  const hintIcon = hint.tone === "up" ? <ArrowUp className="h-3.5 w-3.5" /> : hint.tone === "down" ? <ArrowDown className="h-3.5 w-3.5" /> : hint.tone === "ok" ? <Check className="h-3.5 w-3.5" /> : hint.tone === "alert" ? <ArrowUp className="h-3.5 w-3.5" /> : null;
  return (
    <article className={`${cardShell} flex items-center gap-3 p-3.5 sm:gap-4 sm:p-4`}>
      <span className={`hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl sm:flex ${tone}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-[22px] font-black leading-none tracking-tight tabular-nums text-gray-900 sm:text-[24px] dark:text-slate-100">{value}</strong>
        <span className="mt-1 block text-[13px] font-semibold leading-tight text-gray-700 dark:text-slate-300">{label}</span>
        <span className={`mt-0.5 flex items-start gap-1 text-[11.5px] font-semibold leading-tight ${hintTone}`}>{hintIcon ? <span className="mt-px shrink-0">{hintIcon}</span> : null}<span>{hint.text}</span></span>
      </span>
      {chart ? <span className="hidden shrink-0 md:block">{chart}</span> : null}
    </article>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const width = 76;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => [(index / Math.max(1, values.length - 1)) * width, height - 3 - ((value - min) / span) * (height - 6)]);
  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Total units, last ${values.length} days: from ${values[0]} to ${values[values.length - 1]}`}>
      <defs><linearGradient id="ps-spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" /><stop offset="100%" stopColor="#3b82f6" stopOpacity="0" /></linearGradient></defs>
      <polygon points={`0,${height} ${line} ${width},${height}`} fill="url(#ps-spark)" />
      <polyline points={line} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
