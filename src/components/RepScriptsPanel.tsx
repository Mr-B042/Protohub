import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Crown, MessageSquareQuote, X } from "lucide-react";
import { byCategory, salesScriptingApi, type RepScript, type ScriptCategory } from "../lib/api";

/**
 * The rep's side of Sales Scripting (Bright, 1 Oct 2026): approved scripts for
 * the order's product, right where the rep is selling (order screen and Call
 * Rep Console). One click shows what to say. The rep records WHICH closing,
 * upsell and cross-sell script they used and whether the customer said yes,
 * so the report can show which script converts.
 */
const SECTIONS: Array<{ key: ScriptCategory; label: string; tone: string }> = [
  { key: "closing", label: "Closing", tone: "text-blue-700 dark:text-blue-300" },
  { key: "upsell", label: "Upsell", tone: "text-emerald-700 dark:text-emerald-300" },
  { key: "cross_sell", label: "Cross-sell", tone: "text-amber-700 dark:text-amber-300" },
  { key: "objection", label: "Objections", tone: "text-rose-700 dark:text-rose-300" }
];

type Data = Awaited<ReturnType<typeof salesScriptingApi.forOrder>>;

export default function RepScriptsPanel({ orderId, version, className = "" }: { orderId: string; version?: string; className?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = () => salesScriptingApi.forOrder(orderId).then(setData).catch(() => setData(null));
  useEffect(() => {
    setOpen(null);
    setError("");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, version]);

  if (!data) return null;
  const total = SECTIONS.reduce((sum, section) => sum + (byCategory(data.sections, section.key)?.length ?? 0), 0);
  if (total === 0) return null;

  const reveal = (script: RepScript) => {
    const next = open === script.id ? null : script.id;
    setOpen(next);
    if (next) void salesScriptingApi.shown(orderId, script.id).catch(() => undefined);
  };
  const record = async (script: RepScript, outcome: "accepted" | "declined" | null) => {
    setBusy(script.id);
    setError("");
    try {
      await salesScriptingApi.use(orderId, script.id, outcome);
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={`rounded-2xl border border-violet-200 bg-white px-4 py-4 shadow-sm dark:border-violet-400/25 dark:bg-white/[0.04] ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 inline-flex items-center gap-2 text-[15px] font-black text-gray-900 dark:text-slate-100">
          <MessageSquareQuote className="h-4 w-4 text-violet-600" /> Recommended Scripts
        </h3>
        <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400">{data.product?.name}{data.quantity ? ` · ${data.quantity} pc${data.quantity === 1 ? "" : "s"}` : ""}</span>
      </div>
      {data.canRecord ? (
        <p className="m-0 mt-1 text-[11px] text-gray-500 dark:text-slate-400">Open a script to see what to say. Record which closing, upsell and cross-sell script you used, and what the customer said.</p>
      ) : null}
      <div className="mt-3 space-y-3">
        {SECTIONS.map((section) => {
          const scripts = byCategory(data.sections, section.key) ?? [];
          if (scripts.length === 0) return null;
          const usedHere = scripts.filter((script) => data.uses[script.id]);
          return (
            <div key={section.key}>
              <p className={`m-0 flex flex-wrap items-center gap-2 text-[11px] font-black uppercase tracking-[0.12em] ${section.tone}`}>
                {section.label}
                {usedHere.length > 0 ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] normal-case tracking-normal text-violet-800">Used: {usedHere.map((script) => script.title).join(", ")}</span> : null}
              </p>
              <ul className="m-0 mt-1 list-none space-y-1 p-0">
                {scripts.map((script) => {
                  const use = data.uses[script.id];
                  const isOpen = open === script.id;
                  return (
                    <li key={script.id} className={`rounded-xl border ${use ? "border-violet-300 bg-violet-50/60 dark:border-violet-400/40 dark:bg-violet-400/10" : "border-gray-200 dark:border-slate-700"}`}>
                      <button type="button" onClick={() => reveal(script)} className="!min-h-0 flex w-full items-center gap-2 px-3 py-2 text-left">
                        {isOpen ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold text-gray-900 dark:text-slate-100">
                            {section.key === "objection" && script.objection ? `“${script.objection}”` : script.title}
                          </span>
                          <span className="block truncate text-[11px] text-gray-500 dark:text-slate-400">
                            {section.key === "upsell" && script.upsellFromQty && script.upsellToQty ? `${script.upsellFromQty} → ${script.upsellToQty} pieces${script.extraAmount ? ` · +${script.extraAmount}` : ""}`
                              : section.key === "cross_sell" && script.crossSellProductName ? `Add ${script.crossSellProductName}`
                              : script.scenario || script.whenToUse}
                          </span>
                        </span>
                        {script.suggested && section.key !== "objection" && section.key !== "closing" ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Fits this order</span> : null}
                        {script.priority === "primary" ? <Crown className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-label="Primary script" /> : null}
                        {use ? <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${use.outcome === "accepted" ? "bg-emerald-100 text-emerald-800" : "bg-gray-200 text-gray-700"}`}>{use.outcome === "accepted" ? "Said yes" : "Said no"}</span> : null}
                      </button>
                      {isOpen ? (
                        <div className="border-t border-gray-100 px-3 pb-3 pt-2 dark:border-slate-700">
                          {script.whenToUse ? <p className="m-0 text-[11px] text-gray-500 dark:text-slate-400"><strong>When:</strong> {script.whenToUse}</p> : null}
                          <blockquote className="m-0 mt-2 whitespace-pre-wrap rounded-lg bg-violet-50 px-3 py-2 text-[13px] leading-relaxed text-gray-900 dark:bg-violet-400/10 dark:text-slate-100">{script.whatToSay}</blockquote>
                          {script.mustSay.length > 0 ? (
                            <ul className="m-0 mt-2 list-none space-y-0.5 p-0 text-[12px]">
                              {script.mustSay.map((item) => <li key={item} className="flex items-start gap-1.5 text-emerald-800 dark:text-emerald-300"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />{item}</li>)}
                            </ul>
                          ) : null}
                          {script.neverSay.length > 0 ? (
                            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[12px]">
                              {script.neverSay.map((item) => <li key={item} className="flex items-start gap-1.5 text-rose-700 dark:text-rose-300"><X className="mt-0.5 h-3.5 w-3.5 shrink-0" />Never: {item}</li>)}
                            </ul>
                          ) : null}
                          {data.canRecord ? (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              {use ? (
                                <>
                                  <span className="text-[12px] font-semibold text-gray-600 dark:text-slate-300">You used this · customer said {use.outcome === "accepted" ? "yes" : "no"}</span>
                                  <button type="button" disabled={busy === script.id} onClick={() => void record(script, use.outcome === "accepted" ? "declined" : "accepted")} className="!min-h-0 rounded-lg border border-gray-200 px-2.5 py-1 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Change to “{use.outcome === "accepted" ? "no" : "yes"}”</button>
                                  <button type="button" disabled={busy === script.id} onClick={() => void record(script, null)} className="!min-h-0 rounded-lg px-2.5 py-1 text-[12px] font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Undo</button>
                                </>
                              ) : (
                                <>
                                  <span className="text-[12px] font-semibold text-gray-600 dark:text-slate-300">I used this script:</span>
                                  <button type="button" disabled={busy === script.id} onClick={() => void record(script, "accepted")} className="!min-h-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50">Customer said yes</button>
                                  <button type="button" disabled={busy === script.id} onClick={() => void record(script, "declined")} className="!min-h-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:bg-transparent dark:text-slate-200">Customer said no</button>
                                  {section.key !== "objection" && usedHere.length > 0 ? <span className="text-[11px] text-gray-500">Replaces “{usedHere[0].title}”</span> : null}
                                </>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {error ? <p className="m-0 mt-2 text-[12px] font-semibold text-rose-700">{error}</p> : null}
    </section>
  );
}
