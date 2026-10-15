import { useEffect, useRef, useState } from "react";
import { ChevronDown, ClipboardPaste, FileText, ListFilter, Loader2, RefreshCw, Search, TriangleAlert } from "lucide-react";
import { trackingHubApi, type HubWebsitePage } from "../../lib/api";
import { input } from "./HubParts";

// ── WordPress page picker (Bright, 15 Oct 2026) ─────────────────────────────
// Picks a page from the website chosen in the same form instead of typing
// its address. The value is still a plain URL, so links saved before keep
// working, and "Paste custom URL" is always one press away (a page on another
// site, a blocked site, or a URL with extras).

const normalise = (url: string) => url.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();

export default function WordPressPagePicker({ websiteId, websiteIsWordPress, type, value, onChange, placeholder, hint }: {
  websiteId: string;
  websiteIsWordPress: boolean;
  type: "landing" | "thank_you";
  value: string;
  onChange: (url: string) => void;
  placeholder: string;
  /** A suggestion shown under the field (e.g. the thank-you page another link uses). */
  hint?: string | null;
}) {
  const canPick = Boolean(websiteId) && websiteIsWordPress;
  const [custom, setCustom] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pages, setPages] = useState<HubWebsitePage[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [loadedFor, setLoadedFor] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Load (and, on the server, re-read when older than 6 hours) when the list
  // opens, the search changes, or the website changes.
  useEffect(() => {
    if (!canPick || (!open && loadedFor === websiteId)) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await trackingHubApi.websitePages(websiteId, { q: q.trim() || undefined, type });
        if (cancelled) return;
        setPages(result.pages);
        setError(result.syncError ?? "");
        setLoadedFor(websiteId);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? "Could not load the pages.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, q ? 250 : 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [canPick, open, q, websiteId, type]);

  // A saved URL that is not one of the site's pages opens as a custom URL.
  useEffect(() => {
    if (!canPick || !value || loadedFor !== websiteId || q) return;
    if (pages.length > 0 && !pages.some((page) => normalise(page.url) === normalise(value))) setCustom(true);
  }, [pages, loadedFor, websiteId, canPick, value, q]);

  const refresh = async () => {
    setSyncing(true);
    setError("");
    try {
      await trackingHubApi.syncWebsitePages(websiteId);
      const result = await trackingHubApi.websitePages(websiteId, { q: q.trim() || undefined, type });
      setPages(result.pages);
      setError(result.syncError ?? "");
    } catch (err: any) {
      setError(err?.message ?? "Could not read the website's pages.");
    } finally {
      setSyncing(false);
    }
  };

  const hintLine = hint ? <span className="mt-1 block text-[11px] font-normal text-emerald-700 dark:text-emerald-300">{hint}</span> : null;

  // No WordPress site chosen, or "Paste custom URL": a plain address box.
  if (!canPick || custom) {
    return (
      <>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={input} />
        {canPick ? (
          <button type="button" onClick={() => { setCustom(false); setOpen(true); }} className="!min-h-0 mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue-700 hover:underline dark:text-blue-300">
            <ListFilter className="h-3.5 w-3.5" /> Pick from the website's pages
          </button>
        ) : websiteId && !websiteIsWordPress ? null : (
          <span className="mt-1 block text-[11px] font-normal text-gray-500">Choose the website above to pick from its pages.</span>
        )}
        {hintLine}
      </>
    );
  }

  const current = pages.find((page) => normalise(page.url) === normalise(value)) ?? null;
  const pick = (url: string) => { onChange(url); setOpen(false); setQ(""); };
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((state) => !state)} className="!min-h-0 mt-1 flex h-auto min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left dark:border-slate-700 dark:bg-slate-900">
        <span className="min-w-0">
          {current ? (
            <><span className="block truncate text-[13.5px] font-semibold text-gray-900 dark:text-slate-100">{current.title}</span><span className="block truncate text-[11px] font-normal text-gray-500">/{current.slug}/</span></>
          ) : value ? (
            <span className="block truncate text-[13px] font-normal text-gray-800 dark:text-slate-200">{value}</span>
          ) : <span className="text-[13.5px] font-normal text-gray-500">{type === "thank_you" ? "Choose the thank-you page" : "Choose the landing page"}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center gap-1.5">
            <label className="relative block flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search pages by title or address" className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-[13px] font-normal dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <button type="button" title="Read the website's pages again" aria-label="Refresh pages" disabled={syncing} onClick={() => void refresh()}
              className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300">
              <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            </button>
          </div>
          {error ? (
            <p className="m-0 mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[12px] font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}{/blocked/i.test(error) ? ". Paste the address instead, or allow /wp-json/wp/v2/pages in the site's security plugin." : ""}</span>
            </p>
          ) : null}
          <div className="mt-2 max-h-72 overflow-y-auto">
            {loading || syncing ? (
              <p className="m-0 flex items-center justify-center gap-2 px-3 py-5 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> {syncing ? "Reading the website's pages…" : "Loading pages…"}</p>
            ) : pages.length === 0 ? (
              <p className="m-0 px-3 py-5 text-center text-[13px] text-gray-500">{q ? `No page matches "${q}".` : "No pages found yet. Press refresh to read them."}</p>
            ) : pages.map((page) => (
              <button key={page.id} type="button" onClick={() => pick(page.url)}
                className={`!min-h-0 flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800 ${current?.id === page.id ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}>
                <FileText className={`mt-0.5 h-4 w-4 shrink-0 ${page.isThankYou ? "text-emerald-600" : "text-gray-400"}`} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{page.title}</span>
                  <span className="block truncate text-[11px] text-gray-500">/{page.slug}/{page.isThankYou ? " · looks like a thank-you page" : ""}</span>
                </span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setCustom(true); setOpen(false); }} className="!min-h-0 mt-1 flex w-full items-center gap-2 rounded-lg border-t border-gray-100 px-3 py-2 text-left text-[12.5px] font-semibold text-blue-700 hover:bg-gray-50 dark:border-slate-800 dark:text-blue-300 dark:hover:bg-slate-800">
            <ClipboardPaste className="h-4 w-4" /> Paste custom URL
          </button>
        </div>
      ) : null}
      {hintLine}
    </div>
  );
}
