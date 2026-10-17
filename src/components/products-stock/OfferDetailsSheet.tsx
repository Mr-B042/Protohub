import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, ArrowUp, BarChart3, CalendarDays, Check, ChevronDown, ChevronRight, Copy, ExternalLink, Gift, Loader2, MapPin, MoreVertical,
  Package, Pencil, Power, Share2, Star, Truck, User, Wallet, X
} from "lucide-react";
import { productMediaApi, productsApi } from "../../lib/api";
import { offerStockFrom } from "./EditOfferSheet";
import { MenuItem, PopoverMenu, type CatalogProduct } from "./shared";

// Offer Details (Bright's design, 17 Oct 2026). Read-only view of one offer
// (= one product package). Availability breaks each state down to the agents
// holding the stock — Bright: "breakdown to agent in the states, cause will
// give us exact info we need". An agent's offer count is the scarcest item
// AT THAT AGENT, so a hub with racks but no gift hooks shows 0.

export type StockHub = { key: string; agentName: string; place: string; state: string; qtyOf: (productId: string) => number };

const NOT_YET = "Not available yet";

export function OfferDetailsSheet({ product, pkg, products, states, hubs, stockOf, stateQty, imageOf, formatMoney, showValue, canEdit, onClose, onEdit, onViewProduct, onChanged, onCreated, onToast }: {
  product: CatalogProduct;
  pkg: CatalogProduct["packages"][number] & { description?: string; createdAt?: string };
  products: CatalogProduct[];
  states: string[];
  hubs: StockHub[];
  stockOf: (productId: string) => number;
  stateQty: (productId: string, state: string) => number;
  imageOf: (productId: string, packageImage?: string | null) => string | null;
  formatMoney: (amount: number, currency: string) => string;
  showValue: boolean;
  canEdit: boolean;
  onClose: () => void;
  onEdit: () => void;
  onViewProduct: () => void;
  onChanged: (patch: Record<string, unknown>) => void;
  onCreated: (saved: any) => void;
  onToast: (message: string) => void;
}) {
  const components = (pkg.packageComponents ?? []).filter((item) => item.productId !== product.id);
  const gifts = components.filter((item) => item.isFreeGift);
  const extras = components.filter((item) => !item.isFreeGift);
  const giftCount = gifts.reduce((sum, item) => sum + item.quantity, 0);
  const qty = Math.max(1, pkg.quantity);
  const nameOf = (id: string) => products.find((entry) => entry.id === id)?.name ?? "Product";
  const images = Array.from(new Set([pkg.imageUrl, ...(pkg.imageUrls ?? []), imageOf(product.id)].filter(Boolean) as string[]));
  const [slide, setSlide] = useState(0);
  const [tab, setTab] = useState<"state" | "agent">("state");
  const [openState, setOpenState] = useState<string>("");
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState("");
  const [perf, setPerf] = useState<Awaited<ReturnType<typeof productMediaApi.offerPerformance>> | null>(null);
  const [perfError, setPerfError] = useState("");

  useEffect(() => {
    productMediaApi.offerPerformance(pkg.id).then(setPerf).catch((error: any) => setPerfError(error?.message ?? "Could not load."));
  }, [pkg.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  const totalStock = offerStockFrom(product.id, qty, components, stockOf);
  const byState = useMemo(() => states.map((state) => {
    const agents = hubs.filter((hub) => hub.state === state).map((hub) => ({
      hub,
      offers: offerStockFrom(product.id, qty, components, hub.qtyOf),
      mainUnits: Math.max(0, hub.qtyOf(product.id))
    })).sort((a, b) => b.offers - a.offers || b.mainUnits - a.mainUnits || a.hub.agentName.localeCompare(b.hub.agentName));
    return { state, offers: offerStockFrom(product.id, qty, components, (id) => stateQty(id, state)), agents };
  }).sort((a, b) => b.offers - a.offers || b.agents.length - a.agents.length), [states, hubs, product.id, qty, components, stateQty]);
  const allAgents = byState.flatMap((row) => row.agents).sort((a, b) => b.offers - a.offers || b.mainUnits - a.mainUnits);
  const topStates = byState.slice(0, 3);
  const otherOffers = byState.slice(3).reduce((sum, row) => sum + row.offers, 0);
  const typeText = gifts.length ? "Bundle + Gifts" : extras.length ? "Bundle" : qty > 1 ? "Multi-Pack" : "Single";
  const summary = [`${qty} × ${product.name}`, ...extras.map((item) => `${item.quantity} × ${nameOf(item.productId)}`)].join(" + ") + (giftCount ? ` + ${giftCount} Free Gift${giftCount === 1 ? "" : "s"}` : "");
  const link = `${window.location.origin}${window.location.pathname}#/order-form/embed?product=${encodeURIComponent(product.id)}${pkg.packageSet ? `&package_set=${encodeURIComponent(pkg.packageSet)}` : ""}`;
  const change = (now: number, before: number) => before > 0 ? Math.round(((now - before) / before) * 100) : null;

  const copyText = async (text: string, done: string) => {
    try { await navigator.clipboard.writeText(text); onToast(done); } catch { onToast("Could not copy. Select it and copy it yourself."); }
  };
  const share = async () => {
    const text = `${pkg.name} - ${formatMoney(pkg.price, pkg.currency)}${giftCount ? ` with ${giftCount} free gift${giftCount === 1 ? "" : "s"}` : ""}. Order here: ${link}`;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) { try { await nav.share({ title: pkg.name, text }); return; } catch { return; } }
    await copyText(text, "Offer text copied. Paste it into WhatsApp.");
  };
  const duplicate = async () => {
    setBusy("duplicate");
    try {
      const saved = await productsApi.createPackage(product.id, {
        name: `${pkg.name} (copy)`.slice(0, 80), quantity: qty, price: pkg.price, currency: ["NGN", "USD", "GBP"].includes(pkg.currency) ? pkg.currency : "NGN",
        active: false, displayOrder: product.packages.length, featuredComboCard: pkg.featuredComboCard === true,
        stateFilterMode: pkg.stateFilterMode ?? "all", stateRestrictions: pkg.stateRestrictions ?? [],
        imageUrl: pkg.imageUrl ?? "", imageUrls: pkg.imageUrls ?? [], packageComponents: pkg.packageComponents ?? []
      });
      onCreated(saved);
      onToast("Copy created (inactive). Edit it, then switch it on.");
    } catch (error: any) { onToast(error?.message ?? "Could not duplicate."); }
    finally { setBusy(""); }
  };
  const toggleActive = async () => {
    if (!window.confirm(pkg.active ? "Hide this offer from the order form?" : "Show this offer on the order form?")) return;
    setBusy("active");
    try { await productsApi.updatePackage(product.id, pkg.id, { active: !pkg.active }); onChanged({ active: !pkg.active }); onToast(pkg.active ? "Offer hidden from the order form." : "Offer now shows on the order form."); }
    catch (error: any) { onToast(error?.message ?? "Could not save."); }
    finally { setBusy(""); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="Offer details" onClick={(event) => event.stopPropagation()}
        className="flex h-[96dvh] w-full max-w-[84rem] flex-col overflow-hidden rounded-t-3xl bg-gray-50 shadow-2xl sm:h-auto sm:max-h-[94dvh] sm:rounded-2xl dark:bg-[#08111a]">
        <header className="flex shrink-0 items-start gap-2 border-b border-gray-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[20px] font-black text-gray-900 dark:text-slate-100">Offer Details</h2>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">View full information about this bundle offer, including products, pricing, gifts and availability.</p>
          </div>
          {canEdit && (
            <div className="hidden items-center gap-2 sm:flex">
              <button type="button" onClick={onEdit} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-[13px] font-bold text-gray-800 dark:border-slate-600 dark:text-slate-100"><Pencil className="h-4 w-4" />Edit Offer</button>
              <button type="button" disabled={busy === "duplicate"} onClick={duplicate} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-3.5 py-2 text-[13px] font-bold text-gray-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100">{busy === "duplicate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}Duplicate</button>
            </div>
          )}
          <button type="button" aria-label="More" onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)} className="!min-h-0 rounded-xl border border-gray-200 p-2 text-gray-600 dark:border-slate-600 dark:text-slate-300"><MoreVertical className="h-4 w-4" /></button>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </header>
        <PopoverMenu anchor={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)} width={210}>
          {canEdit && <MenuItem icon={<Pencil />} onClick={() => { setMenuAnchor(null); onEdit(); }}>Edit offer</MenuItem>}
          {canEdit && <MenuItem icon={<Copy />} onClick={() => { setMenuAnchor(null); void duplicate(); }}>Duplicate</MenuItem>}
          <MenuItem icon={<Copy />} onClick={() => { setMenuAnchor(null); void copyText(link, "Order form link copied."); }}>Copy link</MenuItem>
          <MenuItem icon={<Share2 />} onClick={() => { setMenuAnchor(null); void share(); }}>Share offer</MenuItem>
          {canEdit && <MenuItem icon={<Power />} tone={pkg.active ? "danger" : "success"} onClick={() => { setMenuAnchor(null); void toggleActive(); }}>{pkg.active ? "Deactivate" : "Activate"}</MenuItem>}
        </PopoverMenu>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_23rem]">
            <div className="min-w-0 space-y-3">
              {/* ── Hero ─────────────────────────────── */}
              <Card>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div>
                    <div className="flex aspect-[4/3] gap-1.5 overflow-hidden rounded-xl bg-gray-50 dark:bg-slate-950">
                      <span className="relative h-full flex-[1.6] overflow-hidden rounded-xl bg-white dark:bg-slate-800">
                        {images[slide] ? <img src={images[slide]} alt="" className="h-full w-full object-cover" /> : <Package className="m-auto mt-[30%] h-10 w-10 text-gray-300" />}
                        {qty > 1 && <span className="absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-900/85 text-[14px] font-black text-white">x{qty}</span>}
                      </span>
                      {[...extras, ...gifts].length > 0 && (
                        <span className="flex h-full flex-1 flex-col gap-1.5">
                          {[...extras, ...gifts].slice(0, 2).map((item, index) => (
                            <span key={`${item.productId}-${index}`} className="relative flex-1 overflow-hidden rounded-xl bg-white dark:bg-slate-800">
                              {imageOf(item.productId) ? <img src={imageOf(item.productId)!} alt="" className="h-full w-full object-cover" /> : <Gift className="m-auto mt-[30%] h-7 w-7 text-gray-300" />}
                              {item.isFreeGift && <span className="absolute right-1.5 top-1.5 rounded-md bg-rose-500 px-1.5 py-0.5 text-[10px] font-black text-white">FREE</span>}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    {images.length > 1 && (
                      <div className="mt-2 grid grid-cols-6 gap-1.5">
                        {images.slice(0, 6).map((url, index) => (
                          <button key={url} type="button" onClick={() => setSlide(index)} className={`!min-h-0 relative aspect-square overflow-hidden rounded-lg border-2 ${slide === index ? "border-[#1F8FE0]" : "border-transparent"}`}>
                            <img src={url} alt="" className="h-full w-full object-cover" />
                            {index === 5 && images.length > 6 && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-sm font-black text-white">+{images.length - 5}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold ${pkg.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-slate-800"}`}><Check className="h-3 w-3" />{pkg.active ? "Active" : "Inactive"}</span>
                      {pkg.featuredComboCard && <span className="inline-flex items-center gap-1 rounded-full bg-[#1F8FE0] px-2.5 py-1 text-[11.5px] font-black text-white"><Star className="h-3 w-3" />Best Seller</span>}
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-bold text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">{typeText}</span>
                    </div>
                    <h3 className="m-0 mt-2 text-[24px] font-black leading-tight text-gray-900 dark:text-slate-100">{pkg.name}</h3>
                    <p className="m-0 mt-1 text-[15px] text-gray-500 dark:text-slate-400">{summary}</p>
                    <p className="m-0 mt-2 inline-flex items-center gap-1.5 text-[13px] text-gray-500">SKU: {product.sku}
                      <button type="button" aria-label="Copy SKU" onClick={() => copyText(product.sku, "SKU copied.")} className="!min-h-0 text-gray-400 hover:text-gray-700"><Copy className="h-3.5 w-3.5" /></button></p>
                    {(pkg.description || product.description) && <p className="m-0 mt-3 text-[14px] leading-relaxed text-gray-600 dark:text-slate-300">{pkg.description || product.description}</p>}
                    <div className="mt-4 grid grid-cols-2 gap-3 border-y border-gray-100 py-3 dark:border-slate-800">
                      <div><p className="m-0 text-[13px] font-bold text-gray-700 dark:text-slate-200">Offer Price</p><p className="m-0 mt-1 text-[28px] font-black leading-none text-gray-900 dark:text-slate-100">{formatMoney(pkg.price, pkg.currency)}</p></div>
                      <div><p className="m-0 flex items-center gap-1.5 text-[13px] text-gray-500">Compare At Price<span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-slate-800">{NOT_YET}</span></p><p className="m-0 mt-1 text-[18px] font-bold text-gray-300">—</p></div>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Perk icon={<Truck className="h-4 w-4" />} title="Free Delivery" sub={NOT_YET} locked />
                      <Perk icon={<Wallet className="h-4 w-4" />} title="Payment" sub="on Delivery" />
                      <Perk icon={<Gift className="h-4 w-4" />} title={giftCount ? `${giftCount} Free Gift${giftCount === 1 ? "" : "s"}` : "No gifts"} sub={giftCount ? "Included" : "—"} />
                    </div>
                  </div>
                </div>
              </Card>

              {/* ── Bundle Contents ─────────────────────── */}
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/15"><Gift className="h-5 w-5" /></span>
                    <div><h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Bundle Contents</h3><p className="m-0 text-[12.5px] text-gray-500">Products included in this offer</p></div>
                  </div>
                  <button type="button" onClick={onViewProduct} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-[#1F8FE0] px-3.5 py-2 text-[13px] font-bold text-[#1F8FE0]">View Main Product<ArrowRight className="h-4 w-4" /></button>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-left text-[13px] [&_td]:align-middle">
                    <thead className="bg-gray-50 text-[11.5px] font-bold text-gray-500 dark:bg-slate-900"><tr><th className="px-3 py-2.5">#</th><th className="py-2.5">Product</th><th className="py-2.5">Type</th><th className="py-2.5">Qty</th><th className="py-2.5">Price</th><th className="px-3 py-2.5 text-right">Total</th></tr></thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      <tr>
                        <td className="px-3 py-2.5 text-gray-400">1</td>
                        <td className="py-2.5"><span className="flex items-center gap-2.5 font-semibold text-gray-900 dark:text-slate-100"><Thumb url={imageOf(product.id)} />{product.name}</span></td>
                        <td className="py-2.5"><Pill tone="blue">Main Product</Pill></td>
                        <td className="py-2.5">{qty}</td>
                        <td className="py-2.5">{formatMoney(pkg.price, pkg.currency)}</td>
                        <td className="px-3 py-2.5 text-right font-bold">{formatMoney(pkg.price, pkg.currency)}</td>
                      </tr>
                      {components.map((item, index) => (
                        <tr key={`${item.productId}-${index}`}>
                          <td className="px-3 py-2.5 text-gray-400">{index + 2}</td>
                          <td className="py-2.5"><span className="flex items-center gap-2.5 font-semibold text-gray-900 dark:text-slate-100"><Thumb url={imageOf(item.productId)} />{nameOf(item.productId)}</span></td>
                          <td className="py-2.5">{item.isFreeGift ? <Pill tone="violet">Free Gift</Pill> : <Pill tone="gray">Included item</Pill>}</td>
                          <td className="py-2.5">{item.quantity}</td>
                          <td className="py-2.5 font-black">{item.isFreeGift ? <span className="text-rose-600">FREE</span> : <span className="text-[12px] font-semibold text-gray-500">In the offer price</span>}</td>
                          <td className="px-3 py-2.5 text-right font-bold">{item.isFreeGift ? formatMoney(0, pkg.currency) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {gifts.length > 0 && (
                  <div className="mt-3 flex items-start gap-3 rounded-xl bg-blue-50/70 p-3 dark:bg-blue-500/10">
                    <Gift className="mt-0.5 h-5 w-5 shrink-0 text-[#1F8FE0]" />
                    <div className="min-w-0">
                      <p className="m-0 text-[13.5px] font-black text-gray-900 dark:text-slate-100">Free Gifts Details</p>
                      <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">Includes {gifts.map((item) => `${item.quantity} × ${nameOf(item.productId)}`).join(" and ")}. They come out of stock when the order is delivered.</p>
                      <ul className="m-0 mt-1.5 list-none space-y-1 p-0 text-[12.5px] text-gray-700 dark:text-slate-200">
                        {gifts.map((item, index) => <li key={index} className="flex items-center gap-1.5"><Check className="h-4 w-4 rounded-full bg-emerald-500 p-0.5 text-white" />{item.quantity} × {nameOf(item.productId)}</li>)}
                      </ul>
                    </div>
                  </div>
                )}
              </Card>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                {/* ── Offer Period ──────────────────────── */}
                <Card>
                  <h3 className="m-0 flex items-center gap-2 text-[15px] font-black text-gray-900 dark:text-slate-100"><CalendarDays className="h-5 w-5 text-rose-500" />Offer Period</h3>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
                    <Fact label="Start Date" value="—" note={NOT_YET} />
                    <Fact label="End Date" value="—" note={NOT_YET} />
                    <Fact label="Created At" value={pkg.createdAt ? new Date(pkg.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—"} />
                  </div>
                </Card>
                {/* ── Performance ───────────────────────── */}
                <Card>
                  <h3 className="m-0 flex items-center gap-2 text-[15px] font-black text-gray-900 dark:text-slate-100"><BarChart3 className="h-5 w-5 text-[#1F8FE0]" />Performance (Last 30 Days)</h3>
                  {perfError ? <p className="m-0 mt-3 text-[12.5px] text-rose-600">{perfError}</p> : !perf ? <p className="m-0 mt-3 flex items-center gap-2 text-[12.5px] text-gray-400"><Loader2 className="h-4 w-4 animate-spin" />Loading...</p> : (
                    <div className={`mt-3 grid gap-2 ${showValue && perf.revenue !== null ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
                      <Stat label="Orders" value={perf.orders.toLocaleString()} change={change(perf.orders, perf.previous.orders)} />
                      <Stat label="Delivered" value={perf.delivered.toLocaleString()} change={change(perf.delivered, perf.previous.delivered)} />
                      <Stat label="Delivery Rate" value={perf.deliveryRate === null ? "—" : `${perf.deliveryRate}%`} hint="Of these orders" />
                      {showValue && perf.revenue !== null && <Stat label="Revenue" value={formatMoney(perf.revenue, pkg.currency)} change={perf.previous.revenue !== null ? change(perf.revenue, perf.previous.revenue) : null} hint="Delivered" />}
                    </div>
                  )}
                </Card>
              </div>
            </div>

            <div className="min-w-0 space-y-3">
              {/* ── Stock & Availability ─────────────────── */}
              <Card>
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Stock &amp; Availability</h3>
                <p className="m-0 mt-2 text-[12.5px] text-gray-500">Total Bundle Stock</p>
                <p className="m-0 text-[28px] font-black leading-tight text-gray-900 dark:text-slate-100">{totalStock.toLocaleString()} <span className="text-[16px] font-bold text-gray-500">offers</span></p>
                <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                  {totalStock > 0 && byState.filter((row) => row.offers > 0).map((row, index) => (
                    <span key={row.state} title={`${row.state}: ${row.offers}`} className={`h-full ${index > 0 ? "border-l-2 border-white dark:border-[#0c1722]" : ""} bg-emerald-500`} style={{ width: `${(row.offers / Math.max(1, byState.reduce((sum, entry) => sum + entry.offers, 0))) * 100}%`, opacity: 1 - index * 0.15 }} />
                  ))}
                </div>
                <p className="m-0 mt-1 text-[11px] text-gray-400">The scarcest item decides. Gifts count too.</p>
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {topStates.map((row) => <Box key={row.state} label={row.state} value={row.offers} />)}
                  <Box label="Others" value={otherOffers} />
                </div>
              </Card>

              {/* ── Offer Status ─────────────────────────── */}
              <Card>
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Offer Status</h3>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-black ${pkg.active ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-slate-800"}`}><Check className="h-4 w-4" />{pkg.active ? "Active" : "Inactive"}</span>
                  <span className="text-[12.5px] text-gray-500">{pkg.active ? "Visible to sales reps and customers." : "Hidden from the order form."}</span>
                </div>
                <h4 className="m-0 mt-4 border-t border-gray-100 pt-3 text-[13.5px] font-black text-gray-900 dark:border-slate-800 dark:text-slate-100">Offer Type</h4>
                <div className="mt-2 flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-500 dark:bg-rose-500/15"><Gift className="h-5 w-5" /></span>
                  <span><span className="block text-[14px] font-black text-gray-900 dark:text-slate-100">{extras.length || gifts.length ? "Fixed Bundle" : qty > 1 ? "Multi-Pack" : "Single"}</span>
                    <span className="block text-[12px] text-gray-500">{extras.length || gifts.length ? "Specific products and quantities" : qty > 1 ? "Same product in multiple quantities" : "One piece of the product"}</span></span>
                </div>
              </Card>

              {/* ── Availability & Delivery (by agent) ─────── */}
              <Card>
                <h3 className="m-0 flex items-center gap-2 text-[16px] font-black text-gray-900 dark:text-slate-100"><MapPin className="h-5 w-5 text-[#1F8FE0]" />Availability &amp; Delivery</h3>
                <p className="m-0 mt-1 text-[12px] text-gray-500">
                  {pkg.stateFilterMode === "allow" ? `Delivered only to: ${(pkg.stateRestrictions ?? []).join(", ") || "—"}` : pkg.stateFilterMode === "block" ? `Not delivered to: ${(pkg.stateRestrictions ?? []).join(", ") || "—"}` : "Delivered to all states"}
                </p>
                <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
                  {([["state", "By State"], ["agent", "By Agent"]] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setTab(key)} className={`!min-h-0 py-2 text-[13px] font-bold ${tab === key ? "bg-[#1F8FE0] text-white" : "text-gray-600 dark:text-slate-300"}`}>{label}</button>
                  ))}
                </div>
                {tab === "state" ? (
                  <div className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-slate-800 dark:border-slate-800">
                    <div className="grid grid-cols-[minmax(0,1fr)_4rem] bg-gray-50 px-3 py-2 text-[11.5px] font-bold text-gray-500 dark:bg-slate-900"><span>State / Agent</span><span className="text-right">Offers</span></div>
                    {byState.map((row) => {
                      const open = openState === row.state;
                      return (
                        <div key={row.state}>
                          <button type="button" onClick={() => setOpenState(open ? "" : row.state)} aria-expanded={open}
                            className="!min-h-0 grid w-full grid-cols-[minmax(0,1fr)_4rem] items-center px-3 py-2.5 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-slate-900">
                            <span className="flex min-w-0 items-center gap-1.5 font-semibold text-gray-800 dark:text-slate-100">
                              {open ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
                              <span className="truncate">{row.state}</span><span className="shrink-0 text-[11px] font-normal text-gray-400">{row.agents.length} agent{row.agents.length === 1 ? "" : "s"}</span>
                            </span>
                            <span className={`text-right font-black tabular-nums ${row.offers > 0 ? "text-gray-900 dark:text-slate-100" : "text-gray-300"}`}>{row.offers}</span>
                          </button>
                          {open && (
                            <div className="bg-gray-50/70 pb-1 dark:bg-slate-900/50">
                              {row.agents.length === 0 && <p className="m-0 px-9 py-2 text-[12px] text-gray-400">No agent holds stock here.</p>}
                              {row.agents.map(({ hub, offers, mainUnits }) => <AgentRow key={hub.key} name={hub.agentName} place={hub.place} offers={offers} detail={`${mainUnits} × ${product.name}${components.length ? missingAt(hub, components, nameOf) : ""}`} indent />)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3 divide-y divide-gray-100 rounded-xl border border-gray-100 dark:divide-slate-800 dark:border-slate-800">
                    <div className="grid grid-cols-[minmax(0,1fr)_4rem] bg-gray-50 px-3 py-2 text-[11.5px] font-bold text-gray-500 dark:bg-slate-900"><span>Agent</span><span className="text-right">Offers</span></div>
                    {allAgents.length === 0 && <p className="m-0 px-3 py-4 text-center text-[12.5px] text-gray-400">No agents hold stock yet.</p>}
                    {allAgents.map(({ hub, offers, mainUnits }) => <AgentRow key={hub.key} name={hub.agentName} place={`${hub.place} · ${hub.state}`} offers={offers} detail={`${mainUnits} × ${product.name}${components.length ? missingAt(hub, components, nameOf) : ""}`} />)}
                  </div>
                )}
                <p className="m-0 mt-2 text-[11px] text-gray-400">"Offers" = complete offers that agent can deliver now, counting every item and gift.</p>
              </Card>

              {/* ── Quick Actions ─────────────────────────── */}
              <Card>
                <h3 className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-100">Quick Actions</h3>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {canEdit && <Quick icon={<Pencil className="h-4 w-4" />} label="Edit Offer" onClick={onEdit} />}
                  {canEdit && <Quick icon={<Copy className="h-4 w-4" />} label="Duplicate" onClick={duplicate} busy={busy === "duplicate"} />}
                  <Quick icon={<Copy className="h-4 w-4" />} label="Copy Link" onClick={() => copyText(link, "Order form link copied.")} />
                  <Quick icon={<ExternalLink className="h-4 w-4" />} label="View on Website" onClick={() => window.open(link, "_blank", "noopener")} />
                  <Quick icon={<Share2 className="h-4 w-4" />} label="Share Offer" onClick={share} />
                  {canEdit && <Quick icon={<Power className="h-4 w-4" />} label={pkg.active ? "Deactivate" : "Activate"} onClick={toggleActive} busy={busy === "active"} danger={pkg.active} />}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

/** What an agent is short of for a full offer, e.g. " · no Adhesive Hook". */
function missingAt(hub: StockHub, components: Array<{ productId: string; quantity: number }>, nameOf: (id: string) => string) {
  const short = components.filter((item) => hub.qtyOf(item.productId) < item.quantity).map((item) => nameOf(item.productId));
  return short.length ? ` · short of ${short.join(", ")}` : "";
}

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-[#0c1722]">{children}</section>;
}
function Pill({ tone, children }: { tone: "blue" | "violet" | "gray"; children: ReactNode }) {
  const color = tone === "blue" ? "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" : tone === "violet" ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300" : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300";
  return <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-bold ${color}`}>{children}</span>;
}
function Thumb({ url }: { url: string | null }) {
  return <span className="block h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800">{url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</span>;
}
function Perk({ icon, title, sub, locked }: { icon: ReactNode; title: string; sub: string; locked?: boolean }) {
  return (
    <span className={`flex items-center gap-2 rounded-xl border px-2.5 py-2 ${locked ? "border-dashed border-gray-200 text-gray-400 dark:border-slate-700" : "border-gray-200 dark:border-slate-700"}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${locked ? "bg-gray-50 text-gray-300 dark:bg-slate-900" : "bg-orange-50 text-orange-500 dark:bg-orange-500/15"}`}>{icon}</span>
      <span className="min-w-0"><span className={`block truncate text-[12px] font-bold ${locked ? "" : "text-gray-800 dark:text-slate-100"}`}>{title}</span><span className="block truncate text-[11px] text-gray-400">{sub}</span></span>
    </span>
  );
}
function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 p-2.5 dark:border-slate-800">
      <p className="m-0 font-bold text-gray-600 dark:text-slate-300">{label}</p>
      <p className="m-0 mt-0.5 text-gray-400">{value}</p>
      {note && <p className="m-0 mt-0.5 text-[10px] font-bold text-gray-400">{note}</p>}
    </div>
  );
}
function Stat({ label, value, change, hint }: { label: string; value: string; change?: number | null; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 p-2.5 dark:border-slate-800">
      <p className="m-0 text-[11.5px] text-gray-500">{label}</p>
      <p className="m-0 mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[18px] font-black text-gray-900 dark:text-slate-100">{value}
        {change !== undefined && change !== null && <span className={`inline-flex items-center text-[11px] font-bold ${change >= 0 ? "text-emerald-600" : "text-rose-600"}`}><ArrowUp className={`h-3 w-3 ${change < 0 ? "rotate-180" : ""}`} />{Math.abs(change)}%</span>}</p>
      {hint && <p className="m-0 text-[10.5px] text-gray-400">{hint}</p>}
    </div>
  );
}
function Box({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-gray-50 p-2.5 dark:bg-slate-900"><p className="m-0 truncate text-[11.5px] text-gray-500">{label}</p><p className="m-0 mt-0.5 text-[17px] font-black text-gray-900 dark:text-slate-100">{value.toLocaleString()}</p></div>;
}
function AgentRow({ name, place, offers, detail, indent }: { name: string; place: string; offers: number; detail: string; indent?: boolean }) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_4rem] items-center py-2 pr-3 text-[12.5px] ${indent ? "pl-9" : "pl-3"}`}>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-slate-100"><User className="h-3.5 w-3.5 shrink-0 text-gray-400" /><span className="truncate">{name}</span></span>
        <span className="block truncate text-[11px] text-gray-400">{place} · {detail}</span>
      </span>
      <span className={`text-right font-black tabular-nums ${offers > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-gray-300"}`}>{offers}</span>
    </div>
  );
}
function Quick({ icon, label, onClick, busy, danger }: { icon: ReactNode; label: string; onClick: () => void; busy?: boolean; danger?: boolean }) {
  return (
    <button type="button" disabled={busy} onClick={onClick}
      className={`!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[12px] font-bold disabled:opacity-50 ${danger ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10" : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200"}`}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}{label}
    </button>
  );
}
