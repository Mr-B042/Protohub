import { useEffect, useLayoutEffect, useState } from "react";
import { AlertTriangle, Copy, Lock, Monitor, Smartphone, X } from "lucide-react";
import { productsApi } from "../lib/api";
import { LANDING_PREVIEW_LOCKED_MESSAGE, setLandingPreviewFlag } from "../lib/landing-preview";

// Products & Stock "View landing page" (Bright, 17 Oct 2026). The real page,
// shown inside Protohub so staff can study it. Its order form locks itself to
// view-only here - see src/lib/landing-preview.ts for how and why.

export type ProductLandingPage = { productId: string; url: string; label: string };

/** Every product's landing pages, loaded once the page that shows them opens. */
export function useProductLandingPages(enabled: boolean) {
  const [pages, setPages] = useState<ProductLandingPage[] | null>(null);
  useEffect(() => {
    if (!enabled || pages) return;
    let cancelled = false;
    productsApi.landingPages()
      .then((result) => { if (!cancelled) setPages(Array.isArray(result?.pages) ? result.pages : []); })
      .catch(() => { if (!cancelled) setPages([]); });
    return () => { cancelled = true; };
  }, [enabled, pages]);
  return pages;
}

// The form says it is locked within a second or two of loading; a slow page
// on a weak connection gets longer before the window stops waiting.
const LOCK_WAIT_MS = 12000;

type LockState = "waiting" | "locked" | "unconfirmed";

export function LandingPagePreview({ productName, pages, onClose, onToast }: {
  productName: string;
  pages: ProductLandingPage[];
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [url, setUrl] = useState(pages[0]?.url ?? "");
  const [phoneWidth, setPhoneWidth] = useState(true);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [lock, setLock] = useState<LockState>("waiting");

  // ⚠️ Before the page loads, never after: the form reads this as it starts.
  useLayoutEffect(() => {
    setLandingPreviewFlag(true);
    return () => setLandingPreviewFlag(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    setBlocked(null);
    setLock("waiting");
    productsApi.landingPageFrameCheck(url)
      .then((result) => { if (!cancelled) setBlocked(result?.blocked ?? null); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setChecked(true); });
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    if (!checked || blocked) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin === window.location.origin && event.data?.type === LANDING_PREVIEW_LOCKED_MESSAGE) setLock("locked");
    };
    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => setLock((current) => current === "locked" ? current : "unconfirmed"), LOCK_WAIT_MS);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(timer); };
  }, [checked, blocked, url]);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); onToast("Landing page link copied."); }
    catch { onToast("Could not copy. Select the address and copy it yourself."); }
  };

  const banner = blocked ? null
    : lock === "locked"
      ? { tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
          icon: <Lock className="h-4 w-4 shrink-0" />,
          text: "View only. The order form on this page is locked: nothing you type or submit reaches the live app." }
      : lock === "unconfirmed"
        ? { tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
            icon: <AlertTriangle className="h-4 w-4 shrink-0" />,
            text: "Could not confirm the order form is locked. You can read the page, but do not fill in or submit the form." }
        : { tone: "border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
            icon: <Lock className="h-4 w-4 shrink-0" />,
            text: "Loading the page. Wait for the green bar before you try the form." };

  return (
    <div className="fixed inset-0 z-[80] flex items-stretch justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0 flex-1">
            <h3 className="m-0 truncate text-base font-black text-gray-900 dark:text-slate-100">{productName}: landing page</h3>
            <p className="m-0 truncate text-[12px] text-gray-500 dark:text-slate-400">{url}</p>
          </div>
          {pages.length > 1 && (
            <select value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Choose a landing page"
              className="h-9 max-w-[14rem] rounded-lg border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
              {pages.map((page) => <option key={page.url} value={page.url}>{page.label}</option>)}
            </select>
          )}
          <div className="hidden overflow-hidden rounded-lg border border-gray-200 sm:inline-flex dark:border-slate-600">
            {([[true, "Phone", <Smartphone key="i" className="h-3.5 w-3.5" />], [false, "Computer", <Monitor key="i" className="h-3.5 w-3.5" />]] as const).map(([value, label, icon]) => (
              <button key={label} type="button" onClick={() => setPhoneWidth(value)}
                className={`!min-h-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-black ${phoneWidth === value ? "bg-[#1F8FE0] text-white" : "bg-white text-gray-600 hover:bg-gray-50 dark:bg-slate-950 dark:text-slate-300"}`}>
                {icon}{label}
              </button>
            ))}
          </div>
          <button type="button" onClick={copyLink}
            className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-black text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200">
            <Copy className="h-3.5 w-3.5" />Copy link
          </button>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>
        {banner && (
          <div className={`flex items-center gap-2 border-b px-4 py-2 text-xs font-bold ${banner.tone}`}>{banner.icon}{banner.text}</div>
        )}
        <div className="min-h-0 flex-1 overflow-auto bg-gray-100 dark:bg-slate-950">
          {blocked ? (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
              <AlertTriangle className="h-8 w-8 text-amber-500" />
              <p className="m-0 text-sm font-black text-gray-900 dark:text-slate-100">{blocked}</p>
              <p className="m-0 text-xs text-gray-500 dark:text-slate-400">
                Ask the person who manages the website to allow Protohub to show its pages. Opening it in a normal browser tab is not safe for practice: the order form there is live.
              </p>
            </div>
          ) : checked ? (
            <iframe key={url} src={url} title={`${productName} landing page`}
              className={`mx-auto block h-full border-0 bg-white ${phoneWidth ? "w-full sm:w-[390px] sm:shadow-lg" : "w-full"}`} />
          ) : (
            <p className="m-0 py-16 text-center text-sm font-semibold text-gray-400">Opening the page...</p>
          )}
        </div>
      </div>
    </div>
  );
}
