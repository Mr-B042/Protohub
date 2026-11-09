import { useRef, useState } from "react";
import { ExternalLink, Home, Loader2, RotateCw, Store } from "lucide-react";

/**
 * Our Store (Bright, 9 Nov 2026): the online store, protoolshardwareventures.com.ng,
 * opened inside Protohub for every role, so nobody has to leave the app.
 *
 * ⚠️ The store is shown in a frame. Browsing works everywhere. Its cart, login
 * and checkout keep the shopper's session in a cookie; browsers only let a
 * framed site use its cookie when the store marks it "SameSite=None; Secure"
 * (the store's SESSION_SAME_SITE setting), and iPhones / the Android app may
 * still refuse. "Open full store" is there for checkout in that case.
 */
export const STORE_URL = "https://protoolshardwareventures.com.ng/";

export default function OurStorePage() {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState(0);
  const goHome = () => { setLoading(true); setKey((n) => n + 1); };
  const reload = () => {
    setLoading(true);
    // A framed site from another address can't be reloaded from here, so draw it again.
    setKey((n) => n + 1);
  };
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-amber-300/60 bg-white shadow-sm dark:border-amber-500/30 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2 border-b border-amber-200/70 bg-gradient-to-r from-amber-50 via-yellow-50 to-amber-100 px-4 py-2.5 dark:border-amber-500/20 dark:from-amber-500/10 dark:via-yellow-500/5 dark:to-amber-500/10">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 via-yellow-300 to-amber-600 text-amber-950 shadow-sm"><Store className="h-5 w-5" /></span>
        <div className="mr-auto min-w-0">
          <div className="text-[16px] font-extrabold text-gray-900 dark:text-slate-50">Our Store</div>
          <div className="truncate text-[12px] text-gray-600 dark:text-slate-400">protoolshardwareventures.com.ng</div>
        </div>
        <button type="button" onClick={goHome} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-white px-3 py-2 text-[13px] font-semibold text-amber-900 hover:bg-amber-50 dark:bg-slate-900 dark:text-amber-200"><Home className="h-4 w-4" />Store Home</button>
        <button type="button" onClick={reload} aria-label="Reload" className="!min-h-0 inline-flex items-center rounded-xl border border-amber-300 bg-white p-2 text-amber-900 hover:bg-amber-50 dark:bg-slate-900 dark:text-amber-200"><RotateCw className="h-4 w-4" /></button>
        <a href={STORE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-3 py-2 text-[13px] font-bold text-amber-950 shadow-sm hover:from-amber-600 hover:to-yellow-600"><ExternalLink className="h-4 w-4" />Open full store</a>
      </div>
      <div className="relative flex-1 bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/90 text-[14px] font-semibold text-amber-800 dark:bg-slate-900/90 dark:text-amber-200">
            <Loader2 className="h-7 w-7 animate-spin" />Opening the store…
          </div>
        )}
        <iframe
          key={key}
          ref={frame}
          src={STORE_URL}
          title="Our Store"
          onLoad={() => setLoading(false)}
          className="h-full w-full border-0"
          // The store's own pages, forms and checkout pop-ups (payment) keep working inside the frame.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-top-navigation-by-user-activation"
          allow="payment; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
}
