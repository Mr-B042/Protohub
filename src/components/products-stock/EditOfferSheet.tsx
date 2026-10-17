import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown, ArrowUp, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Gift, Image as ImageIcon, Loader2, MapPin,
  Package, Plus, Star, Trash2, Truck, Wallet, X
} from "lucide-react";
import { productsApi } from "../../lib/api";
import type { CatalogProduct } from "./shared";

// Edit Offer (Bright's design, 17 Oct 2026). An offer IS a product package:
// everything marked working here saves to the live package the order form
// shows. Fields the package cannot hold yet (compare-at price, dates, target
// locations, display switches, Mix & Match) sit in their places, locked and
// labelled "Not available yet" — never a control that silently does nothing.
//
// ⚠️ Stock rule (lib/order-inventory.ts): package items REPLACE the main
// product in stock counts unless every item is a free gift. So whenever a
// paid extra is listed, the main product is written as an item too.

type Component = { productId: string; quantity: number; isFreeGift?: boolean; componentId?: string; hiddenFromCustomer?: boolean; note?: string };
type Row = { key: string; productId: string; quantity: number; isFreeGift: boolean; original?: Component };

export type EditablePackage = CatalogProduct["packages"][number];

let rowSeq = 0;
const NOT_YET = "Not available yet";

/** How many complete offers the stock can make: the scarcest item decides. */
export function offerStockFrom(mainId: string, mainQty: number, rows: Array<{ productId: string; quantity: number }>, stockOf: (id: string) => number) {
  const needs = [{ productId: mainId, quantity: Math.max(1, mainQty) }, ...rows.filter((row) => row.productId)];
  return Math.max(0, Math.min(...needs.map((need) => Math.floor(Math.max(0, stockOf(need.productId)) / Math.max(1, need.quantity)))));
}

export function EditOfferSheet({ product, pkg, products, states, gallery, stockOf, stateQty, imageOf, formatMoney, onClose, onSaved, onDeleted, onToast }: {
  product: CatalogProduct;
  pkg: EditablePackage;
  products: CatalogProduct[];
  states: string[];
  gallery: string[];
  stockOf: (productId: string) => number;
  stateQty: (productId: string, state: string) => number;
  imageOf: (productId: string) => string | null;
  formatMoney: (amount: number, currency: string) => string;
  onClose: () => void;
  onSaved: (patch: Record<string, unknown>) => void;
  onDeleted: () => void;
  onToast: (message: string) => void;
}) {
  const startRows = useMemo<Row[]>(() => (pkg.packageComponents ?? [])
    .filter((item) => item.productId !== product.id)
    .map((item) => ({ key: `r${++rowSeq}`, productId: item.productId, quantity: Math.max(1, Number(item.quantity) || 1), isFreeGift: item.isFreeGift === true, original: item as Component })),
  [pkg, product.id]);
  const mainComponent = (pkg.packageComponents ?? []).find((item) => item.productId === product.id) as Component | undefined;

  const [name, setName] = useState(pkg.name);
  const [offerType, setOfferType] = useState<"fixed" | "multi">(pkg.quantity > 1 && startRows.length === 0 ? "multi" : "fixed");
  const [quantity, setQuantity] = useState(Math.max(1, pkg.quantity));
  const [rows, setRows] = useState<Row[]>(startRows);
  const [price, setPrice] = useState(String(pkg.price ?? ""));
  const [stateMode, setStateMode] = useState<"all" | "allow" | "block">((pkg.stateFilterMode as "all" | "allow" | "block") ?? "all");
  const [stateList, setStateList] = useState<string[]>(pkg.stateRestrictions ?? []);
  const [featured, setFeatured] = useState(pkg.featuredComboCard === true);
  const [active, setActive] = useState(pkg.active);
  const [images, setImages] = useState<string[]>(() => Array.from(new Set([pkg.imageUrl, ...(pkg.imageUrls ?? [])].filter(Boolean) as string[])));
  const [slide, setSlide] = useState(0);
  const [picking, setPicking] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose, saving]);

  const nameOf = (id: string) => products.find((entry) => entry.id === id)?.name ?? "Product";
  const gifts = rows.filter((row) => row.isFreeGift && row.productId);
  const extras = rows.filter((row) => !row.isFreeGift && row.productId);
  const giftCount = gifts.reduce((sum, row) => sum + row.quantity, 0);
  const amount = Number(String(price).replace(/[^\d.]/g, ""));
  const bundleStock = offerStockFrom(product.id, quantity, rows, stockOf);
  // Per state, like the total: the scarcest item in that state decides.
  const stateSplit = states.map((state) => ({ state, qty: offerStockFrom(product.id, quantity, rows, (id) => stateQty(id, state)) })).sort((a, b) => b.qty - a.qty);
  const previewImages = images.length ? images : [imageOf(product.id)].filter(Boolean) as string[];
  const typeText = gifts.length ? "Bundle + Gifts" : extras.length ? "Bundle" : quantity > 1 ? "Multi-Pack" : "Single";
  const summary = [`${quantity} × ${product.name}`, ...extras.map((row) => `${row.quantity} × ${nameOf(row.productId)}`)].join(" + ") + (giftCount ? ` + ${giftCount} Free Gift${giftCount === 1 ? "" : "s"}` : "");
  const changed = name !== pkg.name || quantity !== pkg.quantity || amount !== pkg.price || active !== pkg.active || featured !== (pkg.featuredComboCard === true)
    || stateMode !== (pkg.stateFilterMode ?? "all") || JSON.stringify(stateList) !== JSON.stringify(pkg.stateRestrictions ?? [])
    || JSON.stringify(images) !== JSON.stringify(Array.from(new Set([pkg.imageUrl, ...(pkg.imageUrls ?? [])].filter(Boolean))))
    || JSON.stringify(rows.map((row) => [row.productId, row.quantity, row.isFreeGift])) !== JSON.stringify(startRows.map((row) => [row.productId, row.quantity, row.isFreeGift]));

  const move = (index: number, step: number) => setRows((current) => {
    const next = [...current];
    const target = index + step;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const addRow = (productId: string, isFreeGift: boolean) => {
    setRows((current) => [...current, { key: `r${++rowSeq}`, productId, quantity: 1, isFreeGift }]);
    setAdding(false);
    if (offerType === "multi" && !isFreeGift) setOfferType("fixed");
  };

  const save = async () => {
    if (!name.trim()) { onToast("Give the offer a name."); return; }
    if (!Number.isFinite(amount) || amount <= 0) { onToast("Enter the offer price."); return; }
    if (stateMode !== "all" && stateList.length === 0) { onToast("Pick at least one state, or choose All States."); return; }
    const qty = offerType === "multi" ? Math.max(2, quantity) : Math.max(1, quantity);
    const toComponent = (row: Row): Component => ({ ...(row.original ?? {}), productId: row.productId, quantity: row.quantity, isFreeGift: row.isFreeGift });
    const listed = rows.filter((row) => row.productId);
    const hasPaidExtra = listed.some((row) => !row.isFreeGift);
    const packageComponents = hasPaidExtra
      ? [{ ...(mainComponent ?? {}), productId: product.id, quantity: qty, isFreeGift: false }, ...listed.map(toComponent)]
      : listed.map(toComponent);
    const patch = {
      name: name.trim(), quantity: qty, price: amount, active, featuredComboCard: featured,
      stateFilterMode: stateMode, stateRestrictions: stateMode === "all" ? [] : stateList,
      imageUrl: images[0] ?? "", imageUrls: images, packageComponents
    };
    setSaving(true);
    try {
      await productsApi.updatePackage(product.id, pkg.id, patch);
      onSaved(patch);
      onToast(`${name.trim()} saved.${active ? "" : " It is hidden from the order form."}`);
      onClose();
    } catch (error: any) { onToast(error?.message ?? "Could not save the offer."); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete "${pkg.name}"? It disappears from the order form straight away. Past orders keep their details.`)) return;
    setDeleting(true);
    try { await productsApi.deletePackage(product.id, pkg.id); onDeleted(); onToast("Offer deleted."); onClose(); }
    catch (error: any) { onToast(error?.message ?? "Could not delete the offer."); }
    finally { setDeleting(false); }
  };

  const orderFormLink = `${window.location.origin}${window.location.pathname}#/order-form/embed?product=${encodeURIComponent(product.id)}${pkg.packageSet ? `&package_set=${encodeURIComponent(pkg.packageSet)}` : ""}`;
  const input = "h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-[14px] text-gray-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100";
  const locked = "h-11 w-full cursor-not-allowed rounded-xl border border-dashed border-gray-200 bg-gray-50 px-3 text-[13px] text-gray-400 dark:border-slate-700 dark:bg-slate-900";

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-slate-950/50 sm:items-center sm:p-4" onClick={() => { if (!saving) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="Edit offer" onClick={(event) => event.stopPropagation()}
        className="flex h-[96dvh] w-full max-w-[84rem] flex-col overflow-hidden rounded-t-3xl bg-gray-50 shadow-2xl sm:h-auto sm:max-h-[94dvh] sm:rounded-2xl dark:bg-[#08111a]">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
          <div>
            <h2 className="m-0 text-[20px] font-black text-gray-900 dark:text-slate-100">Edit Offer</h2>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">Update the offer details, products, pricing, gifts and display settings.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)_minmax(0,21rem)]">
            {/* ── Offer Preview ───────────────────────── */}
            <Card className="lg:sticky lg:top-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Offer Preview</h3>
                <a href={orderFormLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-[12.5px] font-bold text-[#1F8FE0] dark:bg-blue-500/15">View on website<ExternalLink className="h-3.5 w-3.5" /></a>
              </div>
              <div className="relative mt-3 flex aspect-[16/11] items-center gap-1.5 overflow-hidden rounded-xl bg-gray-50 p-1.5 dark:bg-slate-950">
                <span className="relative h-full flex-[1.5] overflow-hidden rounded-lg bg-white dark:bg-slate-800">
                  {previewImages[slide] ? <img src={previewImages[slide]} alt="" className="h-full w-full object-cover" /> : <Package className="m-auto mt-[30%] h-8 w-8 text-gray-300" />}
                  {quantity > 1 && <span className="absolute bottom-1.5 right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-slate-900/85 text-[13px] font-black text-white">x{quantity}</span>}
                </span>
                {[...extras, ...gifts].slice(0, 2).map((row) => (
                  <span key={row.key} className="flex h-full flex-1 items-center gap-1">
                    <Plus className="h-4 w-4 shrink-0 text-[#1F8FE0]" />
                    <span className="relative h-[75%] w-full overflow-hidden rounded-lg bg-white dark:bg-slate-800">
                      {imageOf(row.productId) ? <img src={imageOf(row.productId)!} alt="" className="h-full w-full object-cover" /> : <Gift className="m-auto mt-[35%] h-6 w-6 text-gray-300" />}
                      {row.isFreeGift && <span className="absolute right-1 top-1 rounded bg-rose-500 px-1 text-[9px] font-black text-white">FREE</span>}
                    </span>
                  </span>
                ))}
                {previewImages.length > 1 && (
                  <>
                    <button type="button" aria-label="Previous picture" onClick={() => setSlide((slide - 1 + previewImages.length) % previewImages.length)} className="!min-h-0 absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow"><ChevronLeft className="h-4 w-4" /></button>
                    <button type="button" aria-label="Next picture" onClick={() => setSlide((slide + 1) % previewImages.length)} className="!min-h-0 absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 shadow"><ChevronRight className="h-4 w-4" /></button>
                  </>
                )}
              </div>
              {previewImages.length > 1 && (
                <div className="mt-2 grid grid-cols-6 gap-1.5">
                  {previewImages.slice(0, 6).map((url, index) => (
                    <button key={url} type="button" onClick={() => setSlide(index)} className={`!min-h-0 aspect-square overflow-hidden rounded-md border-2 ${slide === index ? "border-[#1F8FE0]" : "border-transparent"}`}><img src={url} alt="" className="h-full w-full object-cover" /></button>
                  ))}
                </div>
              )}
              <h4 className="m-0 mt-3 text-[18px] font-black text-gray-900 dark:text-slate-100">{name || "Offer name"}</h4>
              <p className="m-0 mt-0.5 text-[13px] text-gray-500 dark:text-slate-400">{summary}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {featured && <span className="inline-flex items-center gap-1 rounded-full bg-[#1F8FE0] px-2.5 py-1 text-[11.5px] font-black text-white"><Star className="h-3 w-3" />Best Seller</span>}
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11.5px] font-bold text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">{typeText}</span>
                {!active && <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11.5px] font-bold text-gray-500 dark:bg-slate-800">Inactive</span>}
              </div>
              <p className="m-0 mt-3 text-[28px] font-black leading-none text-gray-900 dark:text-slate-100">{Number.isFinite(amount) && amount > 0 ? formatMoney(amount, pkg.currency) : "—"}</p>
              <p className={`m-0 mt-2 flex items-center gap-1.5 text-[13.5px] font-bold ${bundleStock > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600"}`}><span className={`h-2.5 w-2.5 rounded-full ${bundleStock > 0 ? "bg-emerald-500" : "bg-rose-500"}`} />{bundleStock.toLocaleString()} in stock</p>
              <p className="m-0 mt-0.5 text-[11.5px] text-gray-400">{stateSplit.slice(0, 2).map((row) => `${row.state}: ${row.qty}`).join(" | ")}{stateSplit.length > 2 ? ` | Others: ${stateSplit.slice(2).reduce((sum, row) => sum + row.qty, 0)}` : ""}</p>
              <ul className="m-0 mt-3 list-none space-y-1.5 p-0 text-[13px] text-gray-700 dark:text-slate-200">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />{quantity}× {product.name}</li>
                {rows.filter((row) => row.productId).map((row) => (
                  <li key={row.key} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />{row.quantity}× {nameOf(row.productId)}{row.isFreeGift && <span className="font-bold text-rose-600">(FREE)</span>}</li>
                ))}
              </ul>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Perk icon={<Truck className="h-4 w-4" />} text="Free Delivery" locked />
                <Perk icon={<Wallet className="h-4 w-4" />} text="Payment on Delivery" />
                <Perk icon={<Gift className="h-4 w-4" />} text={giftCount ? `${giftCount} Free Gift${giftCount === 1 ? "" : "s"}` : "No gifts"} />
              </div>
              <button type="button" onClick={() => setPicking(true)} className="!min-h-0 mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#1F8FE0] py-2.5 text-[13.5px] font-bold text-[#1F8FE0] hover:bg-blue-50 dark:hover:bg-blue-500/10"><ImageIcon className="h-4 w-4" />Change Preview Images</button>
            </Card>

            <div className="min-w-0 space-y-3">
              {/* ── Basic Information ──────────────────── */}
              <Card>
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Basic Information</h3>
                <Field label="Offer Name" required><input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} className={input} /></Field>
                <p className="m-0 mt-4 text-[13px] font-bold text-gray-800 dark:text-slate-100">Offer Type</p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                  <TypeCard on={offerType === "fixed"} title="Fixed Bundle" hint="Specific products & quantities" onClick={() => setOfferType("fixed")} />
                  <TypeCard on={offerType === "multi"} title="Multi-Pack" hint="Same product in multiple quantities" onClick={() => { setOfferType("multi"); setQuantity((value) => Math.max(2, value)); setRows((current) => current.filter((row) => row.isFreeGift)); }} />
                  <TypeCard on={false} title="Mix & Match" hint="Customer can choose variants" disabled />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <Field label="Main Product" required>
                    <div className={`${input} flex items-center gap-2 bg-gray-50 dark:bg-slate-900`}>
                      {imageOf(product.id) ? <img src={imageOf(product.id)!} alt="" className="h-7 w-7 rounded-md object-cover" /> : <Package className="h-5 w-5 text-gray-300" />}
                      <span className="truncate font-semibold">{product.name}</span>
                    </div>
                  </Field>
                  <Field label="SKU"><div className={`${input} flex items-center bg-gray-50 text-gray-500 dark:bg-slate-900`}>{product.sku}</div></Field>
                </div>
                <p className="m-0 mt-1.5 text-[11.5px] text-gray-400">An offer belongs to its product. To move it, create it on the other product.</p>
              </Card>

              {/* ── Bundle Items ──────────────────────── */}
              <Card>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Bundle Items</h3>
                  <button type="button" onClick={() => setAdding((value) => !value)} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-blue-50 px-3 py-2 text-[13px] font-bold text-[#1F8FE0] dark:bg-blue-500/15"><Plus className="h-4 w-4" />Add Product</button>
                </div>
                {adding && (
                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-500/20 dark:bg-blue-500/5">
                    <p className="m-0 mb-2 text-[12.5px] font-semibold text-gray-600 dark:text-slate-300">Pick a product, then add it as a paid item or a free gift.</p>
                    <div className="max-h-56 space-y-1 overflow-y-auto">
                      {products.filter((entry) => entry.id !== product.id && !rows.some((row) => row.productId === entry.id)).map((entry) => (
                        <div key={entry.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 dark:bg-slate-900">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-800 dark:text-slate-100">{entry.name}</span>
                          <button type="button" onClick={() => addRow(entry.id, false)} className="!min-h-0 rounded-md border border-gray-200 px-2 py-1 text-[11.5px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">Add item</button>
                          <button type="button" onClick={() => addRow(entry.id, true)} className="!min-h-0 rounded-md bg-rose-50 px-2 py-1 text-[11.5px] font-bold text-rose-600 dark:bg-rose-500/15">Free gift</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[30rem] text-left text-[13px] [&_td]:align-middle">
                    <thead className="text-[11.5px] font-bold text-gray-400"><tr><th className="w-14 py-2" /><th className="py-2">Type</th><th className="w-24 py-2">Qty</th><th className="w-32 py-2">Price</th><th className="w-10 py-2" /></tr></thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      <tr>
                        <td className="py-2"><Thumb url={imageOf(product.id)} /></td>
                        <td className="py-2"><span className="block font-semibold text-gray-800 dark:text-slate-100">{product.name}</span><span className="mt-0.5 inline-block rounded-md bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-bold text-gray-500 dark:bg-slate-800">Main Product</span></td>
                        <td className="py-2"><input type="number" min={offerType === "multi" ? 2 : 1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))} className="h-10 w-20 rounded-lg border border-gray-200 px-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" aria-label="Main product quantity" /></td>
                        <td className="py-2 font-semibold text-gray-700 dark:text-slate-200">{Number.isFinite(amount) && amount > 0 ? formatMoney(amount, pkg.currency) : "—"}</td>
                        <td />
                      </tr>
                      {rows.map((row, index) => (
                        <tr key={row.key}>
                          <td className="py-2">
                            <span className="flex items-center gap-1">
                              <span className="flex flex-col">
                                <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} className="!min-h-0 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                                <button type="button" aria-label="Move down" disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="!min-h-0 text-gray-300 hover:text-gray-600 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                              </span>
                              <Thumb url={imageOf(row.productId)} />
                            </span>
                          </td>
                          <td className="py-2">
                            <span className="block font-semibold text-gray-800 dark:text-slate-100">{nameOf(row.productId)}</span>
                            <button type="button" onClick={() => setRows((current) => current.map((entry) => entry.key === row.key ? { ...entry, isFreeGift: !entry.isFreeGift } : entry))}
                              title="Tap to switch between free gift and paid item"
                              className={`!min-h-0 mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${row.isFreeGift ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15" : "bg-blue-50 text-blue-600 dark:bg-blue-500/15"}`}>{row.isFreeGift ? "Free Gift" : "Included item"}</button>
                          </td>
                          <td className="py-2"><input type="number" min={1} value={row.quantity} onChange={(event) => setRows((current) => current.map((entry) => entry.key === row.key ? { ...entry, quantity: Math.max(1, Number(event.target.value) || 1) } : entry))} className="h-10 w-20 rounded-lg border border-gray-200 px-2 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" aria-label={`${nameOf(row.productId)} quantity`} /></td>
                          <td className="py-2 font-black">{row.isFreeGift ? <span className="text-rose-600">FREE</span> : <span className="text-[12px] font-semibold text-gray-500">In the offer price</span>}</td>
                          <td className="py-2"><button type="button" aria-label={`Remove ${nameOf(row.productId)}`} onClick={() => setRows((current) => current.filter((entry) => entry.key !== row.key))} className="!min-h-0 rounded-lg p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="m-0 mt-2 text-[11.5px] text-gray-400">Free gifts and included items come out of stock when the order is delivered.</p>
              </Card>

              {/* ── Pricing ───────────────────────────── */}
              <Card>
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Pricing</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Offer Price (${pkg.currency === "NGN" ? "₦" : pkg.currency})`} required><input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" className={input} /></Field>
                  <Field label="Compare At Price (₦)" note={NOT_YET}><input disabled placeholder="Crossed-out price" className={locked} /></Field>
                </div>
              </Card>
            </div>

            <div className="min-w-0 space-y-3">
              {/* ── Availability & Targeting ─────────────── */}
              <Card>
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Availability &amp; Targeting</h3>
                <Field label="Total Bundle Stock">
                  <div className={`${input} flex items-center justify-between bg-gray-50 dark:bg-slate-900`}><span className="font-semibold">{bundleStock.toLocaleString()}</span><span className="text-gray-400">bundles</span></div>
                </Field>
                <p className="m-0 mt-1 text-[11.5px] text-gray-400">Based on available stock of all items.</p>
                <Field label="Delivery States">
                  <div className="relative">
                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1F8FE0]" />
                    <select value={stateMode} onChange={(event) => setStateMode(event.target.value as "all" | "allow" | "block")} className={`${input} appearance-none pl-9`}>
                      <option value="all">All States</option><option value="allow">Only these states</option><option value="block">All except these states</option>
                    </select>
                  </div>
                </Field>
                {stateMode !== "all" && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {states.map((state) => {
                      const on = stateList.includes(state);
                      return (
                        <button key={state} type="button" onClick={() => setStateList((current) => on ? current.filter((entry) => entry !== state) : [...current, state])}
                          className={`!min-h-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-bold ${on ? "bg-blue-50 text-[#1F8FE0] ring-1 ring-blue-200 dark:bg-blue-500/15" : "bg-gray-100 text-gray-500 dark:bg-slate-800"}`}>
                          {on && <Check className="h-3 w-3" />}{state}
                        </button>
                      );
                    })}
                  </div>
                )}
                <Field label="Target Locations (Optional)" note={NOT_YET}><div className={`${locked} flex items-center`}>Lagos, Abuja, Port Harcourt…</div></Field>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Field label="Start Date" note={NOT_YET}><div className={`${locked} flex items-center gap-2`}><CalendarDays className="h-4 w-4" />—</div></Field>
                  <Field label="End Date" note={NOT_YET}><div className={`${locked} flex items-center gap-2`}><CalendarDays className="h-4 w-4" />Select date</div></Field>
                </div>
              </Card>

              {/* ── Display Settings ─────────────────────── */}
              <Card>
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Display Settings</h3>
                <div className="mt-3 space-y-2.5 text-[13.5px]">
                  <Tick label="Show this offer on product page" locked />
                  <Tick label="Show on offers page" locked />
                  <label className="flex items-center gap-2.5 font-semibold text-gray-800 dark:text-slate-100">
                    <input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} className="h-4 w-4 accent-[#1F8FE0]" />
                    Highlight as "Best Seller"
                    <span className="ml-auto rounded-lg border border-dashed border-gray-200 px-2 py-1 text-[11px] text-gray-400 dark:border-slate-700" title="Badge choices are not available yet">Best Seller</span>
                  </label>
                  <Tick label='Show "FREE" labels on gifts' locked />
                  <Tick label="Show stock count" locked />
                </div>
                <p className="m-0 mt-2 text-[11.5px] text-gray-400">Locked switches are not available yet. "Best Seller" uses the package's featured card on the order form.</p>
              </Card>

              {/* ── Status ───────────────────────────────── */}
              <Card>
                <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Status</h3>
                <div className="mt-3 flex items-start gap-3">
                  <button type="button" role="switch" aria-checked={active} onClick={() => setActive(!active)}
                    className={`!min-h-0 relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition-colors ${active ? "bg-[#1F8FE0]" : "bg-gray-300 dark:bg-slate-600"}`}>
                    <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] ${active ? "left-[1.375rem]" : "left-0.5"}`} />
                  </button>
                  <span><span className="block text-[15px] font-black text-gray-900 dark:text-slate-100">{active ? "Active" : "Inactive"}</span>
                    <span className="block text-[12.5px] text-gray-500 dark:text-slate-400">{active ? "Offer is visible to sales reps and customers on the order form." : "Saved, but hidden from the order form."}</span></span>
                </div>
              </Card>
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-gray-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-slate-800 dark:bg-slate-900">
          <button type="button" disabled={deleting || saving} onClick={remove} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2.5 text-[13.5px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 sm:px-4 dark:border-rose-500/40">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}<span className="hidden sm:inline">Delete Offer</span>
          </button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} disabled={saving} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2.5 text-[13.5px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">Cancel</button>
          <button type="button" onClick={save} disabled={saving || !changed} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#1F8FE0] px-5 py-2.5 text-[13.5px] font-black text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save Changes
          </button>
        </footer>

        {picking && (
          <div className="absolute inset-0 z-10 flex items-end justify-center bg-slate-950/40 sm:items-center" onClick={() => setPicking(false)}>
            <div className="max-h-[80dvh] w-full max-w-2xl overflow-hidden rounded-t-3xl bg-white sm:rounded-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-slate-800">
                <div><p className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">Preview images</p><p className="m-0 text-[12px] text-gray-500">Tap to add or remove. The first one is the main picture. {images.length}/15</p></div>
                <button type="button" aria-label="Close" onClick={() => setPicking(false)} className="!min-h-0 rounded-full p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
              </div>
              <div className="grid max-h-[60dvh] grid-cols-3 gap-2 overflow-y-auto p-4 sm:grid-cols-5">
                {gallery.length === 0 && <p className="col-span-full m-0 py-8 text-center text-[13px] text-gray-400">No photos in this product's gallery yet. Add some in Media Library first.</p>}
                {gallery.map((url) => {
                  const position = images.indexOf(url);
                  return (
                    <button key={url} type="button" onClick={() => setImages((current) => position >= 0 ? current.filter((entry) => entry !== url) : current.length >= 15 ? current : [...current, url])}
                      className={`!min-h-0 relative aspect-square overflow-hidden rounded-xl border-2 ${position >= 0 ? "border-[#1F8FE0]" : "border-transparent"}`}>
                      <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
                      {position >= 0 && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#1F8FE0] text-[11px] font-black text-white">{position + 1}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800">
                <button type="button" onClick={() => { setImages([]); setSlide(0); }} className="!min-h-0 rounded-xl px-3 py-2 text-[13px] font-bold text-gray-500">Clear</button>
                <button type="button" onClick={() => { setPicking(false); setSlide(0); }} className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2 text-[13px] font-black text-white">Done</button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-gray-200/80 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-[#0c1722] ${className}`}>{children}</section>;
}
function Field({ label, required, note, children }: { label: string; required?: boolean; note?: string; children: ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-gray-800 dark:text-slate-100">{label}{required && <span className="text-rose-500">*</span>}
        {note && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-slate-800">{note}</span>}</span>
      {children}
    </label>
  );
}
function TypeCard({ on, title, hint, onClick, disabled }: { on: boolean; title: string; hint: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={disabled ? "Not supported by the order form yet" : undefined}
      className={`!min-h-0 flex items-start gap-2.5 rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-[#1F8FE0] bg-blue-50/60 dark:bg-blue-500/10" : "border-gray-200 dark:border-slate-700"}`}>
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[#1F8FE0] bg-[#1F8FE0]" : "border-gray-300"}`}>{on && <Check className="h-2.5 w-2.5 text-white" />}</span>
      <span><span className={`block text-[13.5px] font-bold ${on ? "text-[#1F8FE0]" : "text-gray-800 dark:text-slate-100"}`}>{title}</span><span className="block text-[11.5px] text-gray-500">{disabled ? "Not available yet" : hint}</span></span>
    </button>
  );
}
function Tick({ label, locked }: { label: string; locked?: boolean }) {
  return (
    <label className={`flex items-center gap-2.5 ${locked ? "cursor-not-allowed text-gray-400" : "font-semibold text-gray-800 dark:text-slate-100"}`} title={locked ? NOT_YET : undefined}>
      <input type="checkbox" checked readOnly disabled className="h-4 w-4 accent-[#1F8FE0]" />{label}{locked && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-slate-800">{NOT_YET}</span>}
    </label>
  );
}
function Perk({ icon, text, locked }: { icon: ReactNode; text: string; locked?: boolean }) {
  return (
    <span className={`flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-center text-[11px] font-semibold ${locked ? "border-dashed border-gray-200 text-gray-400 dark:border-slate-700" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-200"}`} title={locked ? NOT_YET : undefined}>
      <span className={locked ? "text-gray-300" : "text-[#1F8FE0]"}>{icon}</span>{text}
    </span>
  );
}
function Thumb({ url }: { url: string | null }) {
  return <span className="block h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-gray-100 dark:bg-slate-800">{url ? <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}</span>;
}
