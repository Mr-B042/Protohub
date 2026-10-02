import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { trackingHubApi, type HubLink } from "../lib/api";

/**
 * Tracking on an Embed Form (Tracking Hub, 2 Oct 2026). Bright: staff making
 * a form should not need to understand CAPI - no Pixel IDs, no tokens. Pick
 * the product's Tracking Link (profile + website + strategy, managed in the
 * Tracking Hub); the generated form then carries it.
 */
const STRATEGY: Record<string, string> = { browser_capi: "Browser + CAPI", capi_only: "CAPI only", landing_page: "Thank-you page Pixel", off: "Off" };

export default function EmbedTrackingChoice({ productId, currentKey, canManage, onApply, onOpenHub }: {
  productId: string;
  currentKey: string;
  canManage: boolean;
  onApply: (link: HubLink | null) => void;
  onOpenHub: () => void;
}) {
  const [links, setLinks] = useState<HubLink[] | null>(null);
  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    trackingHubApi.links().then((result) => { if (!cancelled) setLinks(result.links.filter((link) => link.productId === productId)); }).catch(() => { if (!cancelled) setLinks([]); });
    return () => { cancelled = true; };
  }, [productId, canManage]);
  const current = links?.find((link) => link.trackingKey.toLowerCase() === currentKey.trim().toLowerCase()) ?? null;
  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 flex items-center gap-2 text-sm font-bold text-slate-900"><ShieldCheck className="h-4 w-4 text-[#1F8FE0]" /> TRACKING</p>
        <button type="button" onClick={onOpenHub} className="!min-h-0 inline-flex items-center gap-1 text-xs font-bold text-[#1F8FE0] hover:underline">Manage in Tracking Hub <ArrowRight className="h-3.5 w-3.5" /></button>
      </div>
      {!canManage ? (
        <p className="m-0 text-xs text-slate-500">Tracking (Pixel, CAPI, campaign capture) is set by the Owner in the Tracking Hub.</p>
      ) : links === null ? (
        <p className="m-0 text-xs text-slate-500">Loading tracking links…</p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Tracking link</span>
            <select value={current?.id ?? ""} onChange={(event) => onApply(links.find((link) => link.id === event.target.value) ?? null)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800">
              <option value="">None — the thank-you page Pixel tracks this form</option>
              {links.map((link) => <option key={link.id} value={link.id}>{link.label}{link.profileName ? ` · ${link.profileName}` : ""} — {STRATEGY[link.strategy]}</option>)}
            </select>
          </label>
          {current ? (
            <div className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <span>Website: <strong>{current.websiteDomain ?? "—"}</strong></span>
              <span>Data source: <strong>{current.dataSourceName ?? "—"}</strong></span>
              <span className="sm:col-span-2 flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Capture campaign attribution automatically</span>
              {!current.healthy ? <span className="sm:col-span-2 text-amber-700">{current.problems.join(" · ")}</span> : null}
            </div>
          ) : links.length === 0 ? (
            <p className="m-0 text-xs text-slate-500">No tracking link for this product yet. Create one in the Tracking Hub.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
