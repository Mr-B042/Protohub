import { useEffect, useRef, useState } from "react";
import { BarChart3, Home, Loader2, Maximize2, Minimize2, RotateCw, Store } from "lucide-react";
import { storeActivityApi, type StoreEventKind } from "../lib/api";
import StoreAnalytics from "./StoreAnalytics";

/**
 * Our Store (Bright, 9 Nov 2026): the online store, protoolshardwareventures.com.ng,
 * opened inside Protohub for every role, so nobody has to leave the app.
 * What each person does here is recorded (store-activity, migration 343) and
 * only the Owner sees it, on the Analytics tab.
 *
 * ⚠️ The store is shown in a frame. Browsing works everywhere. Its cart, login
 * and checkout keep the shopper's session in a cookie; browsers only let a
 * framed site use its cookie when the store marks it "SameSite=None; Secure"
 * (the store's SESSION_SAME_SITE setting), and iPhones / the Android app may
 * still refuse. Nothing opens the outside browser (Bright: keep everyone in the app).
 *
 * Inside-store details (which page and product, searches, add to cart,
 * checkout, order) come from a small snippet on the store that tells this
 * page what happened (STORE_SNIPPET in StoreAnalytics). Without it we still
 * know who opened the store, for how long, and how many store pages loaded.
 */
export const STORE_URL = "https://protoolshardwareventures.com.ng/";
const STORE_ORIGINS = ["https://protoolshardwareventures.com.ng", "https://www.protoolshardwareventures.com.ng"];
const STORE_EVENTS: StoreEventKind[] = ["page", "product", "search", "cart", "checkout", "order"];
const newSession = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const device = () => (window.matchMedia("(max-width: 768px)").matches ? "phone" : "computer");

export default function OurStorePage({ isOwner = false }: { isOwner?: boolean }) {
  const [tab, setTab] = useState<"store" | "analytics">("store");
  return (
    <div className="space-y-3">
      {isOwner && (
        <div className="flex gap-1 rounded-2xl border border-amber-300/60 bg-white p-1 dark:border-amber-500/30 dark:bg-slate-900" role="tablist" aria-label="Our Store">
          {([["store", "Store", Store], ["analytics", "Analytics (Owner)", BarChart3]] as const).map(([key, label, Icon]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
              className={`!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[13.5px] font-bold ${tab === key ? "bg-gradient-to-r from-amber-400 to-yellow-400 text-amber-950 shadow-sm" : "text-gray-700 hover:bg-amber-50 dark:text-slate-300"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      )}
      {/* The store stays mounted while the Owner looks at Analytics, so its visit isn't cut short. */}
      <div className={tab === "store" ? "" : "hidden"}><StoreFrame /></div>
      {isOwner && tab === "analytics" && <StoreAnalytics />}
    </div>
  );
}

function StoreFrame() {
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  const session = useRef(newSession());
  const lastStoreMessage = useRef(0);
  const send = (event: StoreEventKind, extra: { url?: string; title?: string; detail?: Record<string, string | number | boolean> } = {}) => {
    void storeActivityApi.record({ sessionId: session.current, event, ...extra }).catch(() => undefined);
  };

  useEffect(() => {
    void storeActivityApi.record({ sessionId: session.current, event: "open", device: device() }).catch(() => undefined);
    // "Still here" every 30 s while the page is on screen: how long people spend in the store.
    const beat = window.setInterval(() => { if (document.visibilityState === "visible") send("heartbeat"); }, 30_000);
    // What the store's snippet reports from inside (page, product, search, cart, checkout, order).
    const onMessage = (message: MessageEvent) => {
      if (!STORE_ORIGINS.includes(message.origin)) return;
      const data = message.data as { type?: string; event?: string; url?: string; title?: string; detail?: Record<string, unknown> } | null;
      if (!data || data.type !== "protohub-store" || !STORE_EVENTS.includes(data.event as StoreEventKind)) return;
      lastStoreMessage.current = Date.now();
      const detail: Record<string, string | number | boolean> = {};
      for (const [k, v] of Object.entries(data.detail ?? {}).slice(0, 8)) if (["string", "number", "boolean"].includes(typeof v)) detail[k] = typeof v === "string" ? v.slice(0, 200) : (v as number | boolean);
      send(data.event as StoreEventKind, { url: String(data.url ?? "").slice(0, 600), title: String(data.title ?? "").slice(0, 200), detail });
    };
    window.addEventListener("message", onMessage);
    return () => { window.clearInterval(beat); window.removeEventListener("message", onMessage); send("heartbeat"); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onFrameLoad = () => {
    setLoading(false);
    // Count each store page that loads; when the store's snippet reports pages itself, it does the counting.
    window.setTimeout(() => { if (Date.now() - lastStoreMessage.current > 3000) send("page"); }, 2500);
  };
  const goHome = () => { setLoading(true); setKey((n) => n + 1); send("home"); };

  return (
    <div className={`flex flex-col overflow-hidden border-amber-300/60 bg-white shadow-sm dark:border-amber-500/30 dark:bg-slate-900 ${full ? "fixed inset-0 z-[90] h-[100dvh] border-0" : "h-[calc(100dvh-7.5rem)] min-h-[520px] rounded-2xl border"}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-200/70 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 px-4 py-2.5 dark:border-amber-500/20 dark:from-amber-500/10 dark:via-yellow-500/5 dark:to-amber-500/10">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-yellow-300 to-amber-600 text-amber-950 shadow-sm"><Store className="h-5 w-5" /></span>
        <div className="mr-auto min-w-0">
          <div className="text-[16px] font-extrabold text-gray-900 dark:text-slate-50">Our Store</div>
          <div className="truncate text-[12px] text-gray-600 dark:text-slate-400">protoolshardwareventures.com.ng</div>
        </div>
        <button type="button" onClick={goHome} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-[13px] font-semibold text-amber-900 hover:bg-amber-50 dark:bg-slate-900 dark:text-amber-200"><Home className="h-4 w-4" />Store Home</button>
        <button type="button" onClick={() => { setLoading(true); setKey((n) => n + 1); }} aria-label="Reload" className="!min-h-0 inline-flex items-center rounded-xl border border-amber-300 bg-white p-2 text-amber-900 hover:bg-amber-50 dark:bg-slate-900 dark:text-amber-200"><RotateCw className="h-4 w-4" /></button>
        {/* Bright, 9 Nov 2026: no "open in the browser" — the store stays inside the app; Full screen gives it the whole window. */}
        <button type="button" onClick={() => { setFull((on) => !on); if (!full) send("full_store"); }} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3 py-2 text-[13px] font-bold text-amber-950 shadow-sm hover:from-amber-600 hover:to-yellow-600">{full ? <><Minimize2 className="h-4 w-4" />Exit full screen</> : <><Maximize2 className="h-4 w-4" />Full screen</>}</button>
      </div>
      <div className="relative flex-1 bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90 text-[14px] font-semibold text-amber-800 dark:bg-slate-900/90 dark:text-amber-200">
            <Loader2 className="h-7 w-7 animate-spin" />Opening the store…
          </div>
        )}
        <iframe
          key={key}
          src={STORE_URL}
          title="Our Store"
          onLoad={onFrameLoad}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads"
          allow="payment; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}
