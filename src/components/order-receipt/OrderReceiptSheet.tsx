import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, ClipboardList, Copy, Download, Eye, Lock, Pencil, ShieldAlert, Truck, User, Wallet, X } from "lucide-react";
import { orderReceiptsApi, productMediaApi, type ProductMedia, type ReceiptBranding, type ReceiptPriceVerification } from "../../lib/api";
import { buildReceipt, money, receiptDate, type ReceiptOrderInput } from "./receipt-model";
import { OrderConfirmationReceipt, RECEIPT_WIDTH, ThankYouReceipt, WhatsAppGlyph, type ReceiptBrand } from "./ReceiptTemplates";

// ── Send Order Receipt (Bright's design, 20 Oct 2026) ───────────────────────
// Left: the sending screen (customer, order, PRICE VERIFICATION, payment,
// note). Right / Preview: the receipt image in either design. Built for
// phones first (Bright: 80% of use is on a phone): one column, Preview opens
// the receipt full screen, and Send uses the phone's share sheet so the PNG
// goes straight into WhatsApp. On a computer the PNG downloads and the
// customer's WhatsApp chat opens to attach it (Bright chose download / share,
// not sending from the connected number).
//
// ⚠️ Nothing on the receipt can be typed: every figure is from the order
// record (receipt-model.ts). The note goes as the message text, never on the
// image, so a receipt can never carry a made-up promise.

type Template = "confirmation" | "thankyou";

export type OrderReceiptSheetProps = {
  order: ReceiptOrderInput & { whatsapp?: string };
  onClose: () => void;
  /** Close the sheet and go to the order's own edit fields (normal permissions apply). */
  onEdit?: () => void;
  /** Open the customer's WhatsApp chat with this text (computer fallback). */
  onOpenWhatsApp: (phone: string, text: string) => void;
  showToast: (message: string) => void;
};

const SCRIPT_FONT_HREF = "https://fonts.googleapis.com/css2?family=Kaushan+Script&display=swap";

export default function OrderReceiptSheet({ order, onClose, onEdit, onOpenWhatsApp, showToast }: OrderReceiptSheetProps) {
  const [template, setTemplate] = useState<Template>("confirmation");
  const [branding, setBranding] = useState<ReceiptBranding | null>(null);
  const [verification, setVerification] = useState<ReceiptPriceVerification | null>(null);
  const [verificationError, setVerificationError] = useState("");
  const [images, setImages] = useState<Record<string, string>>({});
  const [note, setNote] = useState("Thank you for your order! 🙏");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The "Thank You" lettering (Google Fonts, allowed host).
    if (!document.querySelector(`link[href="${SCRIPT_FONT_HREF}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet"; link.href = SCRIPT_FONT_HREF;
      document.head.appendChild(link);
    }
    orderReceiptsApi.branding().then(setBranding).catch(() => setBranding({ name: "Protohub", logoUrl: null, tagline: "", helpPhone: "", canEdit: false }));
    orderReceiptsApi.verification(order.id).then(setVerification).catch((err: any) => setVerificationError(err?.message ?? "Could not check the price."));
    // Product photos: the gallery cover of each product on the receipt.
    productMediaApi.list().then((result) => {
      const out: Record<string, string> = {};
      const media = (result?.media ?? []).filter((m: ProductMedia) => m.kind === "image" && m.status === "approved" && (m.url || m.thumbUrl));
      media.sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.displayOrder - b.displayOrder);
      for (const m of media) if (!out[m.productId]) out[m.productId] = (m.url || m.thumbUrl)!;
      if (result?.settings?.defaultMainImageUrl) out.__default = result.settings.defaultMainImageUrl;
      setImages(out);
    }).catch(() => undefined);
  }, [order.id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { if (previewOpen) setPreviewOpen(false); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, previewOpen]);

  const model = useMemo(() => buildReceipt(order), [order]);
  const brand: ReceiptBrand = { name: branding?.name || "Protohub", tagline: branding?.tagline ?? "", logoUrl: branding?.logoUrl ?? null, helpPhone: branding?.helpPhone ?? "" };
  const imageOf = useCallback((productId?: string) => (productId && images[productId]) || null, [images]);
  const main = model.lines[0];
  const phone = order.whatsapp || order.phone;
  const fileName = `receipt-${model.reference}.png`;

  // The PNG is made AHEAD of the tap. Phones only let a page open the share
  // sheet or save a file straight after a tap; drawing the picture takes a
  // few seconds, so doing it inside the tap made phones block Send and Save.
  const renderKey = useMemo(() => JSON.stringify([template, brand, images, model]), [template, brand, images, model]);
  const [prepared, setPrepared] = useState<{ key: string; file: File; url: string } | null>(null);
  const [prepareError, setPrepareError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => { if (!success) return; const t = setTimeout(() => setSuccess(""), 1800); return () => clearTimeout(t); }, [success]);
  const ready = prepared?.key === renderKey ? prepared.file : null;
  const renderPng = async () => {
    if (!exportRef.current) throw new Error("The receipt is not ready yet.");
    if (document.fonts?.ready) await document.fonts.ready;
    const { domToBlob } = await import("modern-screenshot");
    const blob = await domToBlob(exportRef.current, { scale: 1.5, type: "image/png" });
    if (!blob) throw new Error("Could not make the image.");
    return new File([blob], fileName, { type: "image/png" });
  };
  useEffect(() => {
    if (!branding) return;
    let cancelled = false;
    setPrepareError("");
    const timer = setTimeout(() => {
      renderPng().then((file) => {
        if (cancelled) return;
        setPrepared((prev) => { if (prev) URL.revokeObjectURL(prev.url); return { key: renderKey, file, url: URL.createObjectURL(file) }; });
      }).catch((err: any) => { if (!cancelled) setPrepareError(err?.message ?? "Could not make the image."); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, branding]);
  useEffect(() => () => { setPrepared((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; }); }, []);

  const canShareFile = (file: File) => {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    return typeof nav.share === "function" && !!nav.canShare?.({ files: [file] });
  };
  // iPhone/iPad can't save a downloaded file from the app; their share sheet has "Save Image".
  const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const notReady = () => showToast(prepareError ? `Could not make the receipt picture: ${prepareError}` : "The receipt picture is still being made. Try again in a second.");
  const download = (file: File) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(file);
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  };
  // No await before share()/click(): they must run inside the tap.
  const send = () => {
    if (!ready) return notReady();
    const text = note.trim();
    if (canShareFile(ready)) {
      // Picture only: WhatsApp on iPhone drops the picture when text comes with it.
      // The note goes on the clipboard to paste under the picture.
      if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
      navigator.share({ files: [ready] })
        .then(() => { setSuccess("Receipt shared"); if (text) showToast("Your note is copied. Paste it under the picture in WhatsApp."); })
        .catch((err: any) => { if (err?.name !== "AbortError") showToast(`Could not send the receipt: ${err?.message ?? "please try again"}.`); });
    } else {
      download(ready);
      setSuccess("Receipt saved");
      onOpenWhatsApp(phone, text);
      showToast("Receipt saved. Attach it in the WhatsApp chat that just opened.");
    }
  };
  const saveImage = () => {
    if (!ready) return notReady();
    if (isApple && canShareFile(ready)) {
      navigator.share({ files: [ready] })
        .then(() => setSuccess("Receipt saved"))
        .catch((err: any) => { if (err?.name !== "AbortError") showToast(`Could not save the image: ${err?.message ?? "please try again"}.`); });
      return;
    }
    download(ready);
    setSuccess("Receipt saved");
  };
  const busyLabel = !ready && !prepareError;

  const Receipt = template === "confirmation" ? OrderConfirmationReceipt : ThankYouReceipt;
  const templateSwitch = (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Receipt design">
      {([["confirmation", "Order Confirmation"], ["thankyou", "Thank You"]] as const).map(([key, label]) => (
        <button key={key} type="button" aria-pressed={template === key} onClick={() => setTemplate(key)}
          className={`!min-h-0 rounded-lg px-3 py-2 text-[13px] font-semibold ${template === key ? "bg-[#1F8FE0] text-white" : "text-gray-600 dark:text-slate-300"}`}>{label}</button>
      ))}
    </div>
  );
  const actions = (
    <div className="grid grid-cols-[1fr_1.4fr] gap-2.5">
      <button type="button" onClick={() => setPreviewOpen(true)} className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 text-[14px] font-semibold text-[#1F8FE0] lg:hidden dark:border-slate-700 dark:bg-slate-900"><Eye className="h-5 w-5" /> Preview</button>
      <button type="button" onClick={saveImage} disabled={busyLabel} className="!min-h-0 hidden items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 text-[14px] font-semibold text-gray-700 disabled:opacity-50 lg:inline-flex dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><Download className="h-5 w-5" /> {busyLabel ? "Preparing…" : "Download"}</button>
      <button type="button" onClick={send} disabled={busyLabel} className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl bg-[#16a34a] px-3 py-3 text-[14px] font-semibold text-white shadow-sm hover:bg-[#15803d] disabled:opacity-50">
        <WhatsAppGlyph size={22} /> {busyLabel ? "Preparing…" : "Send via WhatsApp"}
      </button>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex bg-slate-900/50" role="dialog" aria-modal="true" aria-label="Send order receipt">
      <div className="flex h-full w-full flex-col bg-[#f4f6fb] lg:flex-row dark:bg-slate-950">
        {/* ── Left: the sending screen ─────────────────────────────── */}
        <div className="flex h-full w-full flex-col lg:w-[460px] lg:shrink-0 lg:border-r lg:border-gray-200 dark:lg:border-slate-800">
          <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900">
            <button type="button" onClick={onClose} aria-label="Back" className="!min-h-0 rounded-lg p-1.5 text-gray-700 hover:bg-gray-100 dark:text-slate-200"><ArrowLeft className="h-6 w-6" /></button>
            <h2 className="m-0 text-[20px] font-bold text-gray-900 dark:text-slate-50">Send Order Receipt</h2>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3.5 sm:px-4">
            <Card icon={<User className="h-5 w-5" />} title="Customer Information" onEdit={onEdit}>
              <Row label="Name">{model.customer.name}</Row>
              <Row label="Phone"><span className="inline-flex items-center gap-2">{model.customer.phone}<WhatsAppGlyph size={22} /></span></Row>
              <Row label="Location">{model.customer.location}</Row>
            </Card>

            <Card icon={<ClipboardList className="h-5 w-5" />} title="Order Details" onEdit={onEdit}>
              <Row label="Order ID"><span className="inline-flex items-center gap-2">{model.reference}
                <button type="button" aria-label="Copy order ID" onClick={() => { void navigator.clipboard?.writeText(model.reference); showToast("Order ID copied."); }} className="!min-h-0 text-[#1F8FE0]"><Copy className="h-4 w-4" /></button></span></Row>
              <Row label="Date">{model.orderDate}</Row>
              <Row label="Product">
                <span className="flex items-center gap-2.5">
                  {imageOf(main.productId) ? <img src={imageOf(main.productId)!} alt="" className="h-12 w-12 rounded-lg object-cover" /> : <span className="h-12 w-12 rounded-lg bg-gray-100 dark:bg-slate-800" />}
                  <span><span className="block font-semibold">{main.name}</span>{main.subtitle && <span className="block text-[12.5px] text-gray-500">{main.subtitle}</span>}</span>
                </span>
              </Row>
              {main.detail && <Row label="Package">{main.detail}</Row>}
              <Row label="Unit Price">{money(main.amount, model.currencySymbol)}</Row>
              <Row label="Quantity">{main.quantity}</Row>
              {model.lines.slice(1).map((line, i) => <Row key={i} label={i === 0 ? "Add-ons" : ""}>{line.name} x{line.quantity} · {money(line.amount, model.currencySymbol)}</Row>)}
              {model.gifts.length > 0 && <Row label="Free gifts">{model.gifts.map((g) => g.name).join(", ")}</Row>}
              <Row label="Subtotal">{money(model.subtotal, model.currencySymbol)}</Row>
              <Row label="Delivery Fee"><span className="inline-flex items-center gap-2"><b>{money(0, model.currencySymbol)}</b><span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700">FREE DELIVERY</span></span></Row>
              <div className="mt-2 flex items-center justify-between rounded-xl bg-blue-50 px-3 py-3 dark:bg-blue-500/10">
                <span className="text-[14px] font-semibold text-[#1F8FE0]">Total Amount</span>
                <span className="text-[22px] font-black text-gray-900 dark:text-slate-50">{money(model.total, model.currencySymbol)}</span>
              </div>
            </Card>

            <PriceVerificationCard model={model} verification={verification} error={verificationError} />

            <Card icon={<Wallet className="h-5 w-5" />} title="Payment Method">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15"><Truck className="h-5 w-5" /></span>
                <div><div className="text-[14px] font-semibold text-gray-900 dark:text-slate-100">Payment on Delivery (POD)</div>
                  <div className="text-[12.5px] text-gray-500">{model.paid ? "Delivered and paid." : "Not yet paid. The customer pays when the order arrives."}</div></div>
              </div>
            </Card>

            {branding?.canEdit && (
              <BrandEditor branding={branding} open={brandOpen} onToggle={() => setBrandOpen((o) => !o)} onSaved={(next) => { setBranding(next); showToast("Receipt details saved for everyone."); }} showToast={showToast} />
            )}

            <div className="rounded-2xl border border-gray-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
              <label className="block text-[14px] font-semibold text-gray-900 dark:text-slate-100" htmlFor="receipt-note">Add Notes (Optional)</label>
              <p className="m-0 mb-2 text-[11.5px] text-gray-500">Sent as the WhatsApp message with the image. It is not printed on the receipt.</p>
              <textarea id="receipt-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={3}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-[14px] dark:border-slate-700 dark:bg-slate-950" />
            </div>
            <div className="lg:hidden">{templateSwitch}</div>
          </div>
          <div className="border-t border-gray-200 bg-white px-3.5 py-3 dark:border-slate-800 dark:bg-slate-900" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>{actions}</div>
        </div>

        {/* ── Right (computer): live preview ───────────────────────── */}
        <div className="hidden min-w-0 flex-1 flex-col lg:flex">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="w-[360px]">{templateSwitch}</div>
            <button type="button" onClick={onClose} aria-label="Close" className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-6"><ScaledReceipt maxWidth={560}><Receipt model={model} brand={brand} imageOf={imageOf} /></ScaledReceipt></div>
        </div>
      </div>

      {/* ── Preview (phone) ─────────────────────────────────────────── */}
      {previewOpen && (
        <div className="fixed inset-0 z-[75] flex flex-col bg-slate-900">
          <div className="flex items-center justify-between gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">{templateSwitch}</div>
            <button type="button" onClick={() => setPreviewOpen(false)} aria-label="Close preview" className="!min-h-0 rounded-lg p-2 text-white"><X className="h-6 w-6" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {prepared?.key === renderKey
              ? <img src={prepared.url} alt="Receipt picture" className="mx-auto block h-auto w-full max-w-[560px] rounded-lg" />
              : <ScaledReceipt maxWidth={560}><Receipt model={model} brand={brand} imageOf={imageOf} /></ScaledReceipt>}
            <p className="mt-2 text-center text-[12px] text-white/60">You can also press and hold the picture to save it.</p>
          </div>
          <div className="px-3 pt-1" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            <button type="button" onClick={send} disabled={busyLabel} className="!min-h-0 flex w-full items-center justify-center gap-2 rounded-xl bg-[#16a34a] px-3 py-3.5 text-[15px] font-semibold text-white disabled:opacity-50">
              <WhatsAppGlyph size={22} /> {busyLabel ? "Preparing…" : "Send via WhatsApp"}
            </button>
            <button type="button" onClick={saveImage} disabled={busyLabel} className="!min-h-0 mt-2 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-[13px] font-semibold text-white/80 disabled:opacity-50"><Download className="h-4 w-4" /> {busyLabel ? "Preparing…" : "Save image"}</button>
          </div>
        </div>
      )}

      {/* Saved / shared pop-up */}
      {success && (
        <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center" role="status" aria-live="polite">
          <style>{`@keyframes receiptPop{0%{opacity:0;transform:scale(.6)}15%{opacity:1;transform:scale(1.05)}25%{transform:scale(1)}85%{opacity:1}100%{opacity:0;transform:scale(.95)}}@keyframes receiptTick{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}`}</style>
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-8 py-6 shadow-2xl dark:bg-slate-800" style={{ animation: "receiptPop 1.8s ease-out forwards" }}>
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#16a34a]">
              <svg viewBox="0 0 24 24" className="h-9 w-9" fill="none" stroke="white" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12.5l4.5 4.5L19 7.5" style={{ strokeDasharray: 24, strokeDashoffset: 24, animation: "receiptTick .4s .2s ease-out forwards" }} />
              </svg>
            </span>
            <span className="text-[16px] font-semibold text-gray-900 dark:text-slate-100">{success}</span>
          </div>
        </div>
      )}

      {/* Full-size copy, off screen: this is what becomes the PNG. */}
      <div aria-hidden style={{ position: "fixed", left: -10000, top: 0, width: RECEIPT_WIDTH, pointerEvents: "none" }}>
        <Receipt ref={exportRef} model={model} brand={brand} imageOf={imageOf} />
      </div>
    </div>,
    document.body
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Card({ icon, title, onEdit, children }: { icon: ReactNode; title: string; onEdit?: () => void; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2.5 text-[16px] font-bold text-gray-900 dark:text-slate-100"><span className="text-gray-700 dark:text-slate-300">{icon}</span>{title}</h3>
        {onEdit && <button type="button" onClick={onEdit} className="!min-h-0 inline-flex items-center gap-1 text-[13.5px] font-semibold text-[#1F8FE0]"><Pencil className="h-3.5 w-3.5" />Edit</button>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[122px_1fr] items-center gap-3 py-1.5 text-[14px]">
      <span className="text-gray-500 dark:text-slate-400">{label}</span>
      <span className="min-w-0 break-words font-medium text-gray-900 dark:text-slate-100">{children}</span>
    </div>
  );
}

function PriceVerificationCard({ model, verification, error }: { model: ReturnType<typeof buildReceipt>; verification: ReceiptPriceVerification | null; error: string }) {
  const s = model.currencySymbol;
  const changed = verification?.status === "changed";
  const shownDiffers = verification?.shownAtCheckout && Math.round(verification.shownAtCheckout.price) !== Math.round(verification.originalAmount);
  return (
    <section className={`rounded-2xl border p-3.5 ${changed ? "border-amber-300 bg-amber-50/60 dark:bg-amber-500/10" : "border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="m-0 flex items-center gap-2.5 text-[16px] font-bold text-gray-900 dark:text-slate-100">{changed ? <ShieldAlert className="h-5 w-5 text-amber-600" /> : <CheckCircle2 className="h-5 w-5 text-emerald-600" />}Price Verification</h3>
        <span className="inline-flex items-center gap-1 text-[11.5px] text-gray-500" title="These come from the order record and cannot be edited here."><Lock className="h-3.5 w-3.5" />Locked</span>
      </div>
      {error && <p className="m-0 text-[13px] text-rose-600">{error}</p>}
      {!verification && !error && <p className="m-0 text-[13px] text-gray-500">Checking the price…</p>}
      {verification && (
        <>
          <Row label="Original amount"><b>{money(verification.originalAmount, s)}</b></Row>
          <Row label="Current amount"><b className={changed ? "text-amber-700" : ""}>{money(verification.currentAmount, s)}</b></Row>
          <Row label="Price captured">{receiptDate(verification.capturedAt)}</Row>
          <Row label="Reference">{model.reference}</Row>
          <Row label="Price source">{verification.sourceLabel}</Row>
          {verification.shownAtCheckout && (
            <Row label="Shown at checkout"><span className={shownDiffers ? "text-amber-700" : ""}>{money(verification.shownAtCheckout.price, s)}{verification.shownAtCheckout.packageName ? ` · ${verification.shownAtCheckout.packageName}` : ""}</span></Row>
          )}
          <Row label="Status"><span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-bold ${verification.status === "original" ? "bg-emerald-50 text-emerald-700" : verification.status === "changed" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"}`}>{verification.statusLabel}</span></Row>
          {changed && <p className="m-0 mt-1 text-[12px] text-amber-800">The receipt shows the current amount the customer will pay. The original stays on record below.</p>}
          {verification.edits.length > 0 && (
            <details className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-[12.5px] dark:bg-slate-950">
              <summary className="cursor-pointer font-semibold text-gray-700 dark:text-slate-200">Changes after the order ({verification.edits.length})</summary>
              <ul className="m-0 mt-1.5 list-none space-y-1 p-0 text-gray-600 dark:text-slate-300">
                {verification.edits.map((e, i) => <li key={i}><b>{e.field.replace(/_/g, " ")}</b>: {e.from || "—"} → {e.to || "—"} · {e.by} · {receiptDate(e.at)}</li>)}
              </ul>
            </details>
          )}
          {!verification.shownAtCheckout && verification.source === "checkout" && (
            <p className="m-0 mt-1.5 text-[11.5px] text-gray-500">This proves the price Protohub recorded. Orders placed from 20 Oct 2026 also keep the price the order form showed.</p>
          )}
        </>
      )}
    </section>
  );
}

function BrandEditor({ branding, open, onToggle, onSaved, showToast }: { branding: ReceiptBranding; open: boolean; onToggle: () => void; onSaved: (next: ReceiptBranding) => void; showToast: (m: string) => void }) {
  const [tagline, setTagline] = useState(branding.tagline);
  const [helpPhone, setHelpPhone] = useState(branding.helpPhone);
  const [saving, setSaving] = useState(false);
  return (
    <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
      <button type="button" onClick={onToggle} className="!min-h-0 flex w-full items-center justify-between text-left text-[14px] font-semibold text-gray-800 dark:text-slate-100">
        Receipt brand details <span className="text-[12px] font-normal text-[#1F8FE0]">{open ? "Close" : "Edit (Owner / Admin)"}</span>
      </button>
      {!open && <p className="m-0 mt-1 text-[12px] text-gray-500">{branding.name}{branding.tagline ? ` · ${branding.tagline}` : ""}{branding.helpPhone ? ` · Help: ${branding.helpPhone}` : " · no help number yet"}</p>}
      {open && (
        <div className="mt-2 space-y-2">
          <p className="m-0 text-[12px] text-gray-500">The name and logo come from Settings. These two lines appear on every receipt.</p>
          <label className="block text-[12.5px] text-gray-600">Tagline<input value={tagline} maxLength={80} onChange={(e) => setTagline(e.target.value)} placeholder="Home Essentials Made Easy" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[14px] dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="block text-[12.5px] text-gray-600">"Need Help?" WhatsApp number<input value={helpPhone} maxLength={30} inputMode="tel" onChange={(e) => setHelpPhone(e.target.value)} placeholder="0803 123 4567" className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-[14px] dark:border-slate-700 dark:bg-slate-950" /></label>
          <button type="button" disabled={saving} onClick={async () => {
            setSaving(true);
            try { await orderReceiptsApi.saveBranding({ tagline: tagline.trim(), helpPhone: helpPhone.trim() }); onSaved({ ...branding, tagline: tagline.trim(), helpPhone: helpPhone.trim() }); onToggle(); }
            catch (err: any) { showToast(`Could not save: ${err?.message ?? "please try again"}.`); }
            finally { setSaving(false); }
          }} className="!min-h-0 rounded-lg bg-[#1F8FE0] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save for everyone"}</button>
        </div>
      )}
    </section>
  );
}

/** The 720px receipt scaled down to the space available (phones included). */
function ScaledReceipt({ children, maxWidth }: { children: ReactNode; maxWidth: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const width = Math.min(maxWidth, outer.current?.clientWidth ?? maxWidth);
      const scale = width / RECEIPT_WIDTH;
      setSize({ scale, height: (inner.current?.offsetHeight ?? 0) * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, [maxWidth]);
  return (
    <div ref={outer} className="mx-auto w-full" style={{ maxWidth }}>
      <div style={{ height: size.height, position: "relative" }}>
        <div ref={inner} style={{ width: RECEIPT_WIDTH, transform: `scale(${size.scale})`, transformOrigin: "top left", position: "absolute", top: 0, left: 0 }}>{children}</div>
      </div>
    </div>
  );
}
