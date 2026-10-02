import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Sparkles } from "lucide-react";
import type { HubPixelOption } from "../../lib/api";
import { ago } from "./HubParts";

// Pixel picker for tracking links (Bright, 2 Oct 2026): Pixels often share a
// name ("Corner Rack" / "5-In-1 Corner Rack"), so every row shows the ID,
// business and last event, and the likely Pixels are recommended at the top
// instead of scrolling a list of 87.

export type PixelHints = {
  productName?: string | null; linkName?: string | null;
  pagePixelIds?: string[];          // Pixels the landing page was seen loading
  productPixelIds?: string[];       // Pixels other links for this product use
};

const STOP = new Set(["the", "and", "for", "with", "pack", "pcs", "piece", "pieces", "main", "page", "form", "link", "new", "pixel", "sales", "campaign"]);
const words = (text: string | null | undefined) => (String(text ?? "").toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => (word.length >= 3 || /^\d+$/.test(word)) && !STOP.has(word));

function score(option: HubPixelOption, hints: PixelHints) {
  const reasons: string[] = [];
  let points = 0;
  if (hints.pagePixelIds?.includes(option.pixelId)) { points += 100; reasons.push("Loaded on this page"); }
  if (hints.productPixelIds?.includes(option.pixelId)) { points += 60; reasons.push("Used for this product"); }
  const wanted = new Set([...words(hints.productName), ...words(hints.linkName)]);
  const matched = words(option.name).filter((word) => wanted.has(word));
  if (matched.length) { points += 20 * matched.length; reasons.push(`Name matches "${matched.join(" ")}"`); }
  const recent = option.lastFiredAt && Date.now() - Date.parse(option.lastFiredAt) < 7 * 86_400_000;
  if (recent && points > 0) { points += 10; reasons.push("Active this week"); }
  if (!option.active || option.hasAccess === false) points -= 50;
  return { points, reasons };
}

function Row({ option, reasons, selected, onPick }: { option: HubPixelOption; reasons?: string[]; selected: boolean; onPick: () => void }) {
  const warn = !option.active ? "Off" : option.hasAccess === false ? "No access" : option.status === "testing" ? "Testing" : option.status === "paused" ? "Paused" : null;
  return (
    <button type="button" onClick={onPick} className={`!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-blue-50 dark:hover:bg-slate-800 ${selected ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[13.5px] font-semibold text-gray-900 dark:text-slate-100">{option.name}</span>
        {warn ? <span className="shrink-0 rounded bg-amber-50 px-1.5 text-[10.5px] font-semibold text-amber-700">{warn}</span> : null}
      </span>
      <span className="block truncate text-[11.5px] text-gray-500">
        ID {option.pixelId}{option.business ? ` · ${option.business}` : ""}{option.lastFiredAt ? ` · last event ${ago(option.lastFiredAt)}` : " · no events seen"}
      </span>
      {reasons?.length ? <span className="mt-0.5 flex flex-wrap gap-1">{reasons.map((reason) => <span key={reason} className="rounded bg-emerald-50 px-1.5 text-[10.5px] font-semibold text-emerald-700">{reason}</span>)}</span> : null}
    </button>
  );
}

/** Single Pixel (value) or "add one more" (multi: pick adds, value ignored). */
export default function PixelPicker({ options, value, onPick, hints, exclude = [], placeholder, emptyLabel }: {
  options: HubPixelOption[]; value: string | null; onPick: (id: string | null) => void; hints: PixelHints; exclude?: string[]; placeholder: string; emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (box.current && !box.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const choices = useMemo(() => options.filter((row) => (row.platform ?? "meta") === "meta" && !exclude.includes(row.id)), [options, exclude]);
  const scored = useMemo(() => choices.map((option) => ({ option, ...score(option, hints) })), [choices, hints]);
  const recommended = useMemo(() => scored.filter((row) => row.points >= 20).sort((a, b) => b.points - a.points).slice(0, 6), [scored]);
  const needle = q.trim().toLowerCase();
  const all = scored.filter((row) => !needle || `${row.option.name} ${row.option.pixelId} ${row.option.business ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => a.option.name.localeCompare(b.option.name));
  const current = options.find((row) => row.id === value) ?? null;
  const pick = (id: string | null) => { onPick(id); setOpen(false); setQ(""); };
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((state) => !state)} className="!min-h-0 mt-1 flex h-auto min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-left dark:border-slate-700 dark:bg-slate-900">
        <span className="min-w-0">
          {current ? <><span className="block truncate text-[13.5px] font-semibold text-gray-900 dark:text-slate-100">{current.name}</span><span className="block truncate text-[11px] font-normal text-gray-500">ID {current.pixelId}{current.business ? ` · ${current.business}` : ""}</span></>
            : <span className="text-[13.5px] font-normal text-gray-500">{placeholder}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
      </button>
      {open ? (
        <div className="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by name, Pixel ID or business" className="h-9 w-full rounded-lg border border-gray-200 pl-8 pr-3 text-[13px] font-normal dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <div className="mt-2 max-h-80 overflow-y-auto">
            {emptyLabel && !needle ? <button type="button" onClick={() => pick(null)} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[13px] font-normal text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800">{emptyLabel}</button> : null}
            {!needle && recommended.length ? (
              <>
                <p className="m-0 flex items-center gap-1 px-3 pb-1 pt-2 text-[11px] font-black uppercase tracking-wider text-emerald-700"><Sparkles className="h-3.5 w-3.5" /> Recommended</p>
                {recommended.map((row) => <Row key={`r${row.option.id}`} option={row.option} reasons={row.reasons} selected={row.option.id === value} onPick={() => pick(row.option.id)} />)}
                <p className="m-0 px-3 pb-1 pt-3 text-[11px] font-black uppercase tracking-wider text-gray-500">All Pixels ({all.length})</p>
              </>
            ) : null}
            {all.map((row) => <Row key={row.option.id} option={row.option} reasons={needle ? row.reasons : undefined} selected={row.option.id === value} onPick={() => pick(row.option.id)} />)}
            {all.length === 0 ? <p className="m-0 px-3 py-4 text-center text-[13px] text-gray-500">No Pixel matches "{q}".</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
