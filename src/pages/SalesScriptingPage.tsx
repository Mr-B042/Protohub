import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, Clock, Eye, FileText, History, Lightbulb, MessageSquare, MoreVertical,
  Package, Plus, Search, Send, X
} from "lucide-react";
import { Modal, shortDateTime } from "../components/WeeklyReportParts";
import {
  byCategory, salesScriptingApi, type ScriptAuditEntry, type ScriptCategory, type ScriptFields, type ScriptLibrary,
  type ScriptProduct, type ScriptSummary, type ScriptVersion, type ScriptWarnings
} from "../lib/api";

/**
 * Head of Sales Rep -> Sales Scripting (Bright, 1 Oct 2026; replaces
 * Initiatives). Built to Bright's design: KPI cards, products on the left,
 * the product's scripts by type in the middle, the selected script's preview
 * on the right, and the manager approval workflow + feedback underneath.
 *
 * Head of Sales writes and submits; Manager / Admin / Owner approve, return
 * (comment required) or reject. Editing a live script makes a new version;
 * reps keep the live one until the new one is approved.
 */

const TABS: Array<{ key: ScriptCategory; label: string }> = [
  { key: "upsell", label: "Upselling Scripts" },
  { key: "cross_sell", label: "Cross-Selling Scripts" },
  { key: "closing", label: "Closing Scripts" },
  { key: "objection", label: "Objection Handling" }
];
const TYPE_LABEL: Record<ScriptCategory, string> = { closing: "Closing", upsell: "Upsell", cross_sell: "Cross-sell", objection: "Objection" };
const STATUS_PILL: Record<ScriptSummary["status"], { label: string; tone: string }> = {
  approved: { label: "Approved", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  pending: { label: "Pending", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  draft: { label: "Draft", tone: "bg-gray-100 text-gray-600 ring-gray-200" },
  returned: { label: "Returned", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  rejected: { label: "Rejected", tone: "bg-rose-50 text-rose-700 ring-rose-200" },
  deactivated: { label: "Deactivated", tone: "bg-gray-100 text-gray-500 ring-gray-200" },
  archived: { label: "Archived", tone: "bg-gray-100 text-gray-500 ring-gray-200" }
};
const IMPACT_PILL: Record<ScriptVersion["impact"], { label: string; tone: string }> = {
  high: { label: "High Impact", tone: "bg-rose-50 text-rose-600 ring-rose-200" },
  medium: { label: "Medium", tone: "bg-amber-50 text-amber-700 ring-amber-200" },
  low: { label: "Low", tone: "bg-gray-100 text-gray-600 ring-gray-200" }
};
const CLOSING_STYLES: Array<{ key: NonNullable<ScriptVersion["closingStyle"]>; label: string; hint: string }> = [
  { key: "direct", label: "Direct close", hint: "“Should I put you down for the 2-piece package?”" },
  { key: "choice", label: "Choice close", hint: "“Would you prefer the 1-piece or 2-piece package?”" },
  { key: "delivery", label: "Delivery close", hint: "“What location should we send yours to?”" },
  { key: "urgency", label: "Urgency close", hint: "Only when there is a real active promotion." },
  { key: "confirmation", label: "Confirmation close", hint: "The customer is convinced and just needs to finish the order." }
];
const OBJECTION_PRESETS = ["It's expensive", "Let me think about it", "I'll call you back", "I saw it cheaper somewhere", "I only need one"];
const PLACEHOLDERS = [
  { key: "product_name", label: "Product name" }, { key: "current_price", label: "Current price" },
  { key: "upgrade_price", label: "Upgrade price" }, { key: "extra_amount", label: "Extra amount" },
  { key: "cross_sell_product", label: "Cross-sell product" }, { key: "cross_sell_price", label: "Cross-sell price" },
  { key: "delivery_offer", label: "Delivery offer" }, { key: "free_gifts", label: "Free gifts" }
];
const AUDIT_LABEL: Record<string, string> = {
  created: "Created", edited: "Edited", new_version: "New version started", submitted: "Submitted for approval",
  approved_published: "Approved & published", approved_replaced: "Approved & replaced the live version", returned: "Returned for correction",
  rejected: "Rejected", deactivated: "Deactivated", reactivated: "Reactivated", archived: "Archived", draft_deleted: "Draft deleted", settings_changed: "Settings changed"
};

const money = (value: number, currency = "NGN") => `${currency === "NGN" ? "₦" : ""}${Math.round(value).toLocaleString("en-NG")}`;
const shownVersion = (script: ScriptSummary) => script.latest && (script.status !== "approved" || !script.live) ? script.latest : (script.live ?? script.latest);

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${tone}`}>{children}</span>;
}

function ProductImage({ product, size = 44 }: { product: { name: string; imageUrl: string | null } | undefined; size?: number }) {
  if (product?.imageUrl) return <img src={product.imageUrl} alt="" className="shrink-0 rounded-lg border border-gray-200 bg-white object-cover dark:border-slate-700" style={{ width: size, height: size }} />;
  return <span className="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-400 dark:border-slate-700 dark:bg-slate-800" style={{ width: size, height: size }}><Package className="h-5 w-5" /></span>;
}

export default function SalesScriptingPage({ onToast }: { onToast: (message: string) => void }) {
  const [library, setLibrary] = useState<ScriptLibrary | null>(null);
  const [error, setError] = useState("");
  const [productId, setProductId] = useState<string>("");
  const [tab, setTab] = useState<ScriptCategory>("upsell");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [editing, setEditing] = useState<{ script: ScriptSummary | null; category: ScriptCategory } | null>(null);
  const [previewAll, setPreviewAll] = useState(false);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<{ script: ScriptSummary; action: "approve" | "return" | "reject" | "deactivate" | "archive" } | null>(null);
  const [preview, setPreview] = useState<ScriptWarnings | null>(null);

  const load = async () => {
    try {
      const data = await salesScriptingApi.library();
      setLibrary(data);
      setError("");
      setProductId((current) => current && data.products.some((product) => product.id === current) ? current : data.products[0]?.id ?? "");
    } catch (err: any) {
      setError(err?.message ?? "Could not load the script library.");
    }
  };
  useEffect(() => { void load(); }, []);

  const product = library?.products.find((row) => row.id === productId);
  const productScripts = useMemo(() => (library?.scripts ?? []).filter((script) => script.productId === productId), [library, productId]);
  const pendingScripts = useMemo(() => (library?.scripts ?? []).filter((script) => script.latest?.status === "submitted"), [library]);
  const listed = pendingOnly ? pendingScripts : productScripts.filter((script) => script.category === tab);
  const selected = (library?.scripts ?? []).find((script) => script.id === selectedId) ?? listed[0] ?? null;

  useEffect(() => {
    setPreview(null);
    const version = selected ? shownVersion(selected) : null;
    if (!selected || !version) return;
    let cancelled = false;
    salesScriptingApi.preview({ scriptId: selected.id, productId: selected.productId, category: selected.category, fields: fieldsOf(version) })
      .then((result) => { if (!cancelled) setPreview(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [selected?.id, selected?.latest?.id, selected?.live?.id]);

  if (error && !library) {
    return <section className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-10 text-center text-sm font-semibold text-rose-800">{error}<button type="button" onClick={() => void load()} className="!min-h-0 ml-3 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-bold">Try again</button></section>;
  }
  if (!library) return <section className="rounded-xl border border-gray-200 bg-white px-5 py-16 text-center text-sm text-gray-500">Loading the script library…</section>;

  const filteredProducts = library.products.filter((row) => row.name.toLowerCase().includes(search.trim().toLowerCase()));
  const tabCount = (category: ScriptCategory) => productScripts.filter((script) => script.category === category && !script.deactivatedAt).length;
  const shownSelected = selected ? shownVersion(selected) : null;

  const runDecision = async (script: ScriptSummary, action: "approve" | "return" | "reject" | "deactivate" | "archive" | "reactivate", note?: string) => {
    if (action === "approve" || action === "return" || action === "reject") await salesScriptingApi.decide(script.id, action, note);
    else await salesScriptingApi.retire(script.id, action, note);
    onToast(action === "approve" ? "Approved and published to the sales reps." : action === "return" ? "Returned to the Head of Sales." : action === "reject" ? "Script rejected." : action === "deactivate" ? "Script switched off for reps." : action === "archive" ? "Script archived." : "Script switched back on.");
    await load();
  };

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total Scripts", value: library.kpis.total, sub: "Across all products and types", icon: FileText, tone: "bg-blue-50 text-blue-600", card: "border-blue-100 bg-blue-50/40" },
          { label: "Approved Scripts", value: library.kpis.approved, sub: "Ready for team use", icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-600", card: "border-emerald-100 bg-emerald-50/40", delta: library.kpis.approvedLast7 },
          { label: "Pending Approval", value: library.kpis.pending, sub: "Awaiting manager review", icon: Clock, tone: "bg-amber-100 text-amber-600", card: "border-amber-100 bg-amber-50/40" },
          { label: "Draft Scripts", value: library.kpis.drafts, sub: "In progress", icon: FileText, tone: "bg-violet-100 text-violet-600", card: "border-violet-100 bg-violet-50/40" }
        ].map((card) => (
          <div key={card.label} className={`flex items-center gap-4 rounded-xl border px-5 py-4 dark:border-slate-800 dark:bg-slate-900 ${card.card}`}>
            <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${card.tone}`}><card.icon className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-gray-700 dark:text-slate-300">{card.label}</span>
              <strong className="block text-2xl font-black text-gray-900 dark:text-slate-50">{card.value}</strong>
              <span className="block text-[12px] text-gray-500">{card.sub}</span>
            </div>
            {card.delta ? <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700" title="Approved in the last 7 days">↑ {card.delta}</span> : null}
          </div>
        ))}
      </div>

      {library.canApprove && pendingScripts.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <span><strong>{pendingScripts.length} script{pendingScripts.length === 1 ? "" : "s"}</strong> waiting for your approval. Reps only see a script after it is approved.</span>
          <button type="button" onClick={() => { setPendingOnly((value) => !value); setSelectedId(null); }} className="!min-h-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">
            {pendingOnly ? "Back to products" : "Review them"}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* Products */}
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Products</h2>
          <label className="relative mt-3 flex items-center">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <ul className="m-0 mt-3 max-h-[560px] list-none space-y-1.5 overflow-y-auto p-0">
            {filteredProducts.map((row) => {
              const active = row.id === productId && !pendingOnly;
              return (
                <li key={row.id}>
                  <button type="button" onClick={() => { setProductId(row.id); setPendingOnly(false); setSelectedId(null); }}
                    className={`!min-h-0 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${active ? "border-blue-200 bg-blue-50 dark:border-blue-400/30 dark:bg-blue-400/10" : "border-transparent hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
                    <ProductImage product={row} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold text-gray-900 dark:text-slate-100">{row.name}</span>
                      <span className={`block text-[12px] ${active ? "text-blue-600" : "text-gray-500"}`}>{row.scriptCount} script{row.scriptCount === 1 ? "" : "s"} · {row.readiness.percent}% ready</span>
                    </span>
                    <span className="text-gray-400">›</span>
                  </button>
                </li>
              );
            })}
            {filteredProducts.length === 0 ? <li className="px-2 py-6 text-center text-sm text-gray-500">No products match.</li> : null}
          </ul>
        </section>

        {/* Scripts + preview */}
        <section className="min-w-0 rounded-xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
            {pendingOnly ? (
              <div>
                <h2 className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">Waiting for approval</h2>
                <p className="m-0 mt-0.5 text-[13px] text-gray-500">Every product. Approve, return with a comment, or reject.</p>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <ProductImage product={product} size={52} />
                <div>
                  <h2 className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">{product?.name ?? "No products yet"}</h2>
                  <p className="m-0 mt-0.5 text-[13px] text-gray-500">Manage all sales scripts for {product?.name ?? "this product"}. Create at least {library.settings.minPerCategory} scripts for each category.</p>
                </div>
              </div>
            )}
            {!pendingOnly && product ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPreviewAll(true)} className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><Eye className="h-4 w-4" /> Preview All</button>
                {library.canAuthor ? <button type="button" onClick={() => setEditing({ script: null, category: tab })} className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-[#1F8FE0] px-4 py-2 text-sm font-bold text-white hover:bg-[#1a7cc4]"><Plus className="h-4 w-4" /> Add Script</button> : null}
              </div>
            ) : null}
          </div>

          {!pendingOnly && product ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-gray-100 px-5 py-2.5 text-[12px] dark:border-slate-800">
              {(["closing", "upsell", "cross_sell"] as ScriptCategory[]).map((category) => {
                const entry = byCategory(product.readiness.categories, category) ?? { count: 0, min: library.settings.minPerCategory, ok: false };
                return <span key={category} className={entry.ok ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>{TYPE_LABEL[category] === "Upsell" ? "Upselling" : TYPE_LABEL[category] === "Cross-sell" ? "Cross-Selling" : "Closing"} {entry.count}/{entry.min} {entry.ok ? "✓" : "⚠"}</span>;
              })}
              <span className="font-semibold text-gray-600">Objections {byCategory(product.readiness.categories, "objection")?.count ?? 0}</span>
              <span className={`ml-auto rounded-full px-2.5 py-0.5 font-bold ${product.readiness.percent >= 100 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>Sales Playbook: {product.readiness.percent}% Ready</span>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-0 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 p-4">
              {!pendingOnly ? (
                <div className="flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
                  {TABS.map((item) => (
                    <button key={item.key} type="button" onClick={() => { setTab(item.key); setSelectedId(null); }}
                      className={`!min-h-0 flex-1 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] font-bold ${tab === item.key ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-600 hover:text-gray-900 dark:text-slate-300"}`}>
                      {item.label} ({tabCount(item.key)})
                    </button>
                  ))}
                </div>
              ) : null}
              <ol className="m-0 mt-3 list-none space-y-2.5 p-0">
                {listed.map((script, index) => {
                  const version = shownVersion(script);
                  const isSelected = selected?.id === script.id;
                  return (
                    <li key={script.id} className={`relative flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-3 ${isSelected ? "border-blue-300 ring-1 ring-blue-200 dark:border-blue-400/40" : "border-gray-200 dark:border-slate-700"}`}>
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-200 text-[12px] font-bold text-gray-600 dark:border-slate-600">{index + 1}</span>
                      <button type="button" onClick={() => setSelectedId(script.id)} className="!min-h-0 min-w-[180px] flex-1 text-left">
                        <span className="block text-[14px] font-bold leading-snug text-gray-900 dark:text-slate-100">{version?.title}</span>
                        <span className="line-clamp-1 block text-[12px] text-gray-500">
                          {pendingOnly ? `${library.products.find((row) => row.id === script.productId)?.name ?? ""} · ` : ""}{version?.objective || version?.scenario || version?.whenToUse}
                        </span>
                      </button>
                      <span className="hidden flex-wrap items-center gap-1.5 md:flex">
                        <Pill tone={STATUS_PILL[script.status].tone}>{STATUS_PILL[script.status].label}</Pill>
                        {script.hasPendingChange ? <Pill tone="bg-sky-50 text-sky-700 ring-sky-200">v{script.latest?.versionNo} {script.latest?.status === "submitted" ? "pending" : script.latest?.status}</Pill> : null}
                        <Pill tone="bg-blue-50 text-blue-700 ring-blue-200">{TYPE_LABEL[script.category]}</Pill>
                        {version ? <Pill tone={IMPACT_PILL[version.impact].tone}>{IMPACT_PILL[version.impact].label}</Pill> : null}
                        {script.outdatedPrices.length > 0 ? <Pill tone="bg-rose-50 text-rose-700 ring-rose-200">Old price</Pill> : null}
                      </span>
                      <button type="button" onClick={() => setSelectedId(script.id)} className="!min-h-0 rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-bold text-blue-600 hover:bg-blue-50 dark:border-slate-700">View</button>
                      <button type="button" aria-label="More" onClick={() => setMenuFor(menuFor === script.id ? null : script.id)} className="!min-h-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreVertical className="h-4 w-4" /></button>
                      {menuFor === script.id ? (
                        <ScriptMenu script={script} library={library} onClose={() => setMenuFor(null)}
                          onEdit={() => setEditing({ script, category: script.category })}
                          onHistory={() => setHistoryFor(script.id)}
                          onSubmit={async () => { await salesScriptingApi.submit(script.id); onToast("Submitted for approval."); await load(); }}
                          onDelete={async () => { await salesScriptingApi.remove(script.id); onToast("Draft deleted."); setSelectedId(null); await load(); }}
                          onRetire={(action) => action === "reactivate" ? void runDecision(script, "reactivate") : setDeciding({ script, action })}
                          onError={(message) => onToast(message)} />
                      ) : null}
                    </li>
                  );
                })}
                {listed.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-slate-700">
                    {pendingOnly ? "Nothing is waiting for approval." : `No ${TABS.find((item) => item.key === tab)?.label.toLowerCase()} for ${product?.name ?? "this product"} yet.`}
                    {!pendingOnly && library.canAuthor && product ? <button type="button" onClick={() => setEditing({ script: null, category: tab })} className="!min-h-0 ml-2 font-bold text-[#1F8FE0] hover:underline">Add the first one</button> : null}
                  </li>
                ) : null}
              </ol>
            </div>

            {/* Script preview */}
            <aside className="border-t border-gray-100 p-4 2xl:border-l 2xl:border-t-0 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <h3 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Script Preview</h3>
                {selected ? <Pill tone={STATUS_PILL[selected.status].tone}>{selected.status === "approved" ? <><Check className="mr-1 h-3 w-3" />Approved</> : STATUS_PILL[selected.status].label}</Pill> : null}
              </div>
              {selected && shownSelected ? (
                <ScriptPreview script={selected} version={shownSelected} preview={preview} library={library}
                  onDecide={(action) => setDeciding({ script: selected, action })} />
              ) : <p className="m-0 mt-6 text-center text-sm text-gray-500">Choose a script to see it here.</p>}
            </aside>
          </div>
        </section>
      </div>

      {selected && shownSelected ? <WorkflowStrip script={selected} version={selected.latest ?? shownSelected} onHistory={() => setHistoryFor(selected.id)} /> : null}

      {editing && product ? (
        <ScriptEditor library={library} product={library.products.find((row) => row.id === (editing.script?.productId ?? productId)) ?? product} script={editing.script} category={editing.category}
          onClose={() => setEditing(null)}
          onSaved={async (id, submitted) => { setEditing(null); onToast(submitted ? "Submitted for approval. The manager has been told." : "Draft saved."); await load(); setSelectedId(id); }} />
      ) : null}
      {previewAll && product ? <PreviewAllModal product={product} scripts={productScripts} onClose={() => setPreviewAll(false)} /> : null}
      {historyFor ? <HistoryModal scriptId={historyFor} onClose={() => setHistoryFor(null)} /> : null}
      {deciding ? (
        <DecisionModal script={deciding.script} action={deciding.action} onClose={() => setDeciding(null)}
          onConfirm={async (note) => { await runDecision(deciding.script, deciding.action, note); setDeciding(null); }} />
      ) : null}
    </div>
  );
}

const fieldsOf = (version: ScriptVersion): ScriptFields => ({
  title: version.title, scenario: version.scenario, objective: version.objective, whenToUse: version.whenToUse, trigger: version.trigger,
  whatToSay: version.whatToSay, keyPoints: version.keyPoints, mustSay: version.mustSay, neverSay: version.neverSay,
  desiredAction: version.desiredAction, priority: version.priority, impact: version.impact,
  closingStyle: version.closingStyle, objection: version.objection,
  upsellFromQty: version.upsellFromQty, upsellToQty: version.upsellToQty, crossSellProductId: version.crossSellProductId
});

function ScriptMenu({ script, library, onClose, onEdit, onHistory, onSubmit, onDelete, onRetire, onError }: {
  script: ScriptSummary; library: ScriptLibrary; onClose: () => void; onEdit: () => void; onHistory: () => void;
  onSubmit: () => Promise<void>; onDelete: () => Promise<void>; onRetire: (action: "deactivate" | "reactivate" | "archive") => void; onError: (message: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) onClose(); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);
  const latest = script.latest;
  const canEdit = library.canAuthor && latest?.status !== "submitted" && !script.archivedAt;
  const canSubmit = library.canAuthor && latest && ["draft", "returned"].includes(latest.status);
  const canDelete = library.canAuthor && script.versionsCount === 1 && latest?.status === "draft" && !latest.submittedAt;
  const run = (fn: () => Promise<void> | void) => async () => { onClose(); try { await fn(); } catch (err: any) { onError(err?.message ?? "Something went wrong."); } };
  const item = "!min-h-0 block w-full rounded-md px-3 py-2 text-left text-[13px] font-semibold text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800";
  return (
    <div ref={ref} className="absolute right-2 top-12 z-20 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {canEdit ? <button type="button" className={item} onClick={run(onEdit)}>{script.live ? "Edit (makes a new version)" : "Edit"}</button> : null}
      {canSubmit ? <button type="button" className={item} onClick={run(onSubmit)}>Submit for approval</button> : null}
      <button type="button" className={item} onClick={run(onHistory)}>Version history &amp; audit</button>
      {library.canApprove && script.live && !script.deactivatedAt ? <button type="button" className={item} onClick={run(() => onRetire("deactivate"))}>Deactivate</button> : null}
      {library.canApprove && script.deactivatedAt && !script.archivedAt ? <button type="button" className={item} onClick={run(() => onRetire("reactivate"))}>Reactivate</button> : null}
      {library.canApprove && !script.archivedAt ? <button type="button" className={`${item} !text-rose-700`} onClick={run(() => onRetire("archive"))}>Archive</button> : null}
      {canDelete ? <button type="button" className={`${item} !text-rose-700`} onClick={run(onDelete)}>Delete draft</button> : null}
    </div>
  );
}

function ScriptPreview({ script, version, preview, library, onDecide }: {
  script: ScriptSummary; version: ScriptVersion; preview: ScriptWarnings | null; library: ScriptLibrary;
  onDecide: (action: "approve" | "return" | "reject") => void;
}) {
  const crossName = version.crossSellProductId ? library.allProducts.find((row) => row.id === version.crossSellProductId)?.name : null;
  const showingDraftOverLive = script.live && version.id !== script.live.id;
  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
        <h4 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">{version.title}</h4>
        {version.objective ? <p className="m-0 mt-1 text-[13px] text-gray-600 dark:text-slate-300">{version.objective}</p> : null}
        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          {version.upsellFromQty && version.upsellToQty ? <Pill tone="bg-emerald-50 text-emerald-700 ring-emerald-200">{version.upsellFromQty} → {version.upsellToQty} pieces</Pill> : null}
          {crossName ? <Pill tone="bg-amber-50 text-amber-700 ring-amber-200">Add {crossName}</Pill> : null}
          {version.closingStyle ? <Pill tone="bg-blue-50 text-blue-700 ring-blue-200">{CLOSING_STYLES.find((style) => style.key === version.closingStyle)?.label}</Pill> : null}
          {version.objection ? <Pill tone="bg-rose-50 text-rose-700 ring-rose-200">“{version.objection}”</Pill> : null}
          <Pill tone="bg-gray-100 text-gray-600 ring-gray-200">{version.priority[0].toUpperCase() + version.priority.slice(1)} · v{version.versionNo}</Pill>
        </div>
        {(version.whenToUse || version.trigger) ? (
          <div className="mt-3 flex gap-3 rounded-lg border border-blue-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white"><Lightbulb className="h-4 w-4" /></span>
            <div className="text-[13px]">
              <strong className="block text-gray-900 dark:text-slate-100">When to use:</strong>
              <span className="text-gray-600 dark:text-slate-300">{[version.whenToUse, version.trigger].filter(Boolean).join(" ")}</span>
            </div>
          </div>
        ) : null}
      </div>
      {showingDraftOverLive ? <p className="m-0 rounded-lg bg-sky-50 px-3 py-2 text-[12px] text-sky-800">Showing version {version.versionNo} ({version.status === "submitted" ? "waiting for approval" : version.status}). Reps still see version {script.live!.versionNo} until this one is approved.</p> : null}
      <div>
        <p className="m-0 text-[13px] font-black text-gray-900 dark:text-slate-100">Script (What to Say)</p>
        <blockquote className="m-0 mt-2 whitespace-pre-wrap rounded-xl border border-gray-200 bg-white p-3.5 text-[13px] leading-relaxed text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">“{preview?.preview.whatToSay ?? version.whatToSay}”</blockquote>
        {preview && preview.missingPlaceholders.length > 0 ? <p className="m-0 mt-1 text-[11px] text-amber-700">Not set yet: {preview.missingPlaceholders.map((key) => `{{${key}}}`).join(", ")}. Reps will see the placeholder text.</p> : null}
      </div>
      {(preview?.outdatedPrices.length ?? script.outdatedPrices.length) > 0 ? (
        <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-[12px] text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Script contains outdated pricing: {(preview?.outdatedPrices ?? script.outdatedPrices).map((value) => money(value)).join(", ")} is not a current price. Use {"{{current_price}}"} or {"{{upgrade_price}}"} instead.</span>
        </div>
      ) : null}
      {version.keyPoints.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
          <p className="m-0 flex items-center gap-1.5 text-[13px] font-black text-amber-800"><Lightbulb className="h-4 w-4" /> Key Points to Highlight</p>
          <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-gray-800">{(preview?.preview.keyPoints ?? version.keyPoints).map((point) => <li key={point}>{point}</li>)}</ul>
        </div>
      ) : null}
      {(version.mustSay.length > 0 || version.neverSay.length > 0) ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-[12px]">
            <p className="m-0 font-black text-emerald-800">Must communicate</p>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0">{version.mustSay.map((item) => <li key={item} className="flex gap-1 text-emerald-900"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />{item}</li>)}</ul>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-[12px]">
            <p className="m-0 font-black text-rose-800">Never say</p>
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0">{version.neverSay.map((item) => <li key={item} className="flex gap-1 text-rose-900"><X className="mt-0.5 h-3.5 w-3.5 shrink-0" />{item}</li>)}</ul>
          </div>
        </div>
      ) : null}
      {version.desiredAction ? <p className="m-0 text-[12px] text-gray-600 dark:text-slate-300"><strong>Desired customer action:</strong> {version.desiredAction}</p> : null}
      {script.deactivatedAt ? <p className="m-0 rounded-lg bg-gray-100 px-3 py-2 text-[12px] text-gray-700">Switched off by {script.deactivatedByName ?? "a manager"} on {shortDateTime(script.deactivatedAt)}{script.deactivationNote ? `: “${script.deactivationNote}”` : ""}.</p> : null}
      {library.canApprove && script.latest?.status === "submitted" ? (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-slate-800">
          <button type="button" onClick={() => onDecide("approve")} className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[13px] font-bold text-white hover:bg-emerald-700"><Check className="h-4 w-4" /> Approve &amp; Publish</button>
          <button type="button" onClick={() => onDecide("return")} className="!min-h-0 flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-[13px] font-bold text-amber-800 hover:bg-amber-50">Return for Correction</button>
          <button type="button" onClick={() => onDecide("reject")} className="!min-h-0 rounded-lg border border-rose-200 bg-white px-3 py-2 text-[13px] font-bold text-rose-700 hover:bg-rose-50">Reject</button>
        </div>
      ) : null}
    </div>
  );
}

function WorkflowStrip({ script, version, onHistory }: { script: ScriptSummary; version: ScriptVersion; onHistory: () => void }) {
  const submitted = Boolean(version.submittedAt);
  const decided = Boolean(version.decidedAt);
  const approved = version.status === "approved" || version.status === "archived";
  const steps = [
    { title: "Script Created", when: version.createdAt, by: version.createdByName, state: "done" as const },
    { title: "Submitted for Approval", when: version.submittedAt, by: submitted ? version.createdByName : null, state: submitted ? "done" as const : "todo" as const },
    { title: "Manager Review", when: decided ? version.decidedAt : null, by: decided ? version.decidedByName : "Manager", state: decided ? "done" as const : submitted ? "active" as const : "todo" as const,
      tag: !decided && submitted ? "In Progress" : version.status === "returned" ? "Returned" : version.status === "rejected" ? "Rejected" : null },
    { title: "Approved", when: approved ? version.approvedAt : null, by: approved ? version.decidedByName : null, state: approved ? "done" as const : "todo" as const, tag: approved ? null : "Pending" }
  ];
  const feedback = version.decisionNote && (version.status === "returned" || version.status === "rejected" || version.status === "approved" || version.status === "archived") ? version : null;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-base font-black text-gray-900 dark:text-slate-100">Manager Approval Workflow</h3>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500">Track approval status and comments for this script{script.versionsCount > 1 ? ` (version ${version.versionNo})` : ""}.</p>
          </div>
          <button type="button" onClick={onHistory} className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"><History className="h-4 w-4" /> View Full History</button>
        </div>
        <ol className="m-0 mt-5 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="flex items-center">
                <span className={`relative z-10 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${step.state === "done" ? "bg-emerald-500 text-white" : step.state === "active" ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-500 dark:bg-slate-900"}`}>
                  {step.state === "done" ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                {index < steps.length - 1 ? <span className={`ml-2 hidden h-0.5 flex-1 sm:block ${step.state === "done" ? "bg-emerald-400" : "bg-gray-200"}`} /> : null}
              </div>
              <p className="m-0 mt-2 text-[13px] font-bold text-gray-900 dark:text-slate-100">{step.title}</p>
              {step.tag ? <span className={`mt-0.5 inline-block rounded px-1.5 text-[12px] font-semibold ${step.tag === "In Progress" ? "bg-blue-50 text-blue-700" : step.tag === "Returned" || step.tag === "Rejected" ? "bg-rose-50 text-rose-700" : "text-gray-500"}`}>{step.tag}</span> : null}
              {step.when ? <p className="m-0 text-[12px] text-gray-500">{shortDateTime(step.when)}</p> : null}
              {step.by ? <p className="m-0 text-[12px] text-gray-600 dark:text-slate-300">{step.by}</p> : null}
            </li>
          ))}
        </ol>
      </section>
      <section className="rounded-xl border border-rose-200 bg-rose-50/50 p-5 dark:border-rose-400/20 dark:bg-rose-400/[0.05]">
        <h3 className="m-0 flex items-center gap-2 text-base font-black text-gray-900 dark:text-slate-100"><MessageSquare className="h-4 w-4 text-rose-600" /> Manager Feedback (if any)</h3>
        {feedback ? (
          <div className="mt-3 rounded-lg border border-rose-100 bg-white p-3.5 dark:border-slate-700 dark:bg-slate-900">
            <p className="m-0 text-[13px] text-gray-800 dark:text-slate-200">{feedback.decisionNote}</p>
            <p className="m-0 mt-2 text-[12px] text-gray-500">{shortDateTime(feedback.decidedAt)} · <strong>{feedback.decidedByName ?? "Manager"}</strong></p>
          </div>
        ) : <p className="m-0 mt-3 text-[13px] text-gray-500">No comments on this version.</p>}
      </section>
    </div>
  );
}

function ListInput({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (items: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = () => { const value = draft.trim(); if (value && !items.includes(value)) onChange([...items, value]); setDraft(""); };
  return (
    <div>
      <span className="text-[12px] font-bold text-gray-700 dark:text-slate-300">{label}</span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[12px] text-gray-800 dark:bg-slate-800 dark:text-slate-200">
            {item}<button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((other) => other !== item))} className="!min-h-0 text-gray-500 hover:text-rose-600"><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        <input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} placeholder={placeholder}
          className="h-9 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900" />
        <button type="button" onClick={add} className="!min-h-0 rounded-lg border border-gray-200 px-3 text-[12px] font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200">Add</button>
      </div>
    </div>
  );
}

const field = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const labelText = "text-[12px] font-bold text-gray-700 dark:text-slate-300";

function ScriptEditor({ library, product, script, category: initialCategory, onClose, onSaved }: {
  library: ScriptLibrary; product: ScriptProduct; script: ScriptSummary | null; category: ScriptCategory;
  onClose: () => void; onSaved: (id: string, submitted: boolean) => Promise<void>;
}) {
  const base = script ? (script.latest && ["draft", "returned"].includes(script.latest.status) ? script.latest : script.live ?? script.latest) : null;
  const [category, setCategory] = useState<ScriptCategory>(script?.category ?? initialCategory);
  const startFields = (): ScriptFields => base ? fieldsOf(base) : {
    title: "", scenario: "", objective: "", whenToUse: "", trigger: "", whatToSay: "", keyPoints: [],
    mustSay: library.settings.defaultMustSay, neverSay: library.settings.defaultNeverSay, desiredAction: "",
    priority: "primary", impact: "medium", closingStyle: initialCategory === "closing" ? "direct" : null, objection: null,
    upsellFromQty: null, upsellToQty: null, crossSellProductId: null
  };
  // ⚠️ UNSAVED WRITING IS KEPT IN THE BROWSER (Bright, 8 Oct 2026: writers lost
  // their text "after a while" - a reload after a new version, or the page
  // being swapped out, wiped what was only in memory). Saved every 1.5s, put
  // back when the same script is opened again, cleared once saved. The key is
  // deliberately NOT "protohub.*": the cache-version reset wipes those.
  const draftKey = `ph-script-draft:${script?.id ?? `new:${product.id}:${initialCategory}`}`;
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [fields, setFields] = useState<ScriptFields>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(draftKey) ?? "null");
      if (saved?.fields && JSON.stringify(saved.fields) !== JSON.stringify(startFields())) return { ...startFields(), ...saved.fields };
    } catch { /* storage off or unreadable */ }
    return startFields();
  });
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(draftKey) ?? "null");
      if (saved?.fields && saved.at && JSON.stringify(saved.fields) !== JSON.stringify(startFields())) {
        setRestoredAt(saved.at);
        if (!script && saved.category) setCategory(saved.category);
      }
    } catch { /* storage off */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (JSON.stringify(fields) === JSON.stringify(startFields())) window.localStorage.removeItem(draftKey);
        else window.localStorage.setItem(draftKey, JSON.stringify({ fields, category, at: new Date().toISOString() }));
      } catch { /* storage full or off: the text still lives on screen */ }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [fields, category]); // eslint-disable-line react-hooks/exhaustive-deps
  const discardRestored = () => {
    try { window.localStorage.removeItem(draftKey); } catch { /* storage off */ }
    setFields(startFields());
    setRestoredAt(null);
  };
  const [warnings, setWarnings] = useState<ScriptWarnings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sayRef = useRef<HTMLTextAreaElement>(null);
  const set = <K extends keyof ScriptFields>(key: K, value: ScriptFields[K]) => setFields((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    const timer = window.setTimeout(() => {
      salesScriptingApi.preview({ scriptId: script?.id ?? null, productId: product.id, category, fields }).then(setWarnings).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [fields, category, product.id, script?.id]);

  const quantities = Array.from(new Set(product.packages.map((pack) => pack.quantity))).sort((a, b) => a - b);
  const priceOf = (qty: number) => product.packages.filter((pack) => pack.quantity === qty).map((pack) => pack.price).sort((a, b) => a - b)[0];
  const crossOptions = product.crossSellProducts.length > 0 ? product.crossSellProducts : library.allProducts.filter((row) => row.id !== product.id);
  const insert = (key: string) => {
    const el = sayRef.current;
    const token = `{{${key}}}`;
    if (!el) { set("whatToSay", `${fields.whatToSay}${token}`); return; }
    const start = el.selectionStart ?? fields.whatToSay.length;
    const end = el.selectionEnd ?? start;
    set("whatToSay", fields.whatToSay.slice(0, start) + token + fields.whatToSay.slice(end));
    window.setTimeout(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); }, 0);
  };

  const save = async (submit: boolean) => {
    setBusy(true);
    setError("");
    try {
      const body = { fields, submit };
      const result = script ? await salesScriptingApi.update(script.id, body) : await salesScriptingApi.create({ productId: product.id, category, ...body });
      // Saved on the server: the browser copy is no longer needed.
      try { window.localStorage.removeItem(draftKey); } catch { /* storage off */ }
      await onSaved(result.id, submit);
    } catch (err: any) {
      setError(err?.message ?? "Could not save the script.");
    } finally {
      setBusy(false);
    }
  };

  const upgradeExtra = fields.upsellFromQty && fields.upsellToQty ? (priceOf(fields.upsellToQty) ?? 0) - (priceOf(fields.upsellFromQty) ?? 0) : 0;
  return (
    <Modal title={script ? `Edit script${script.live ? ` (new version ${(script.latest?.versionNo ?? 1) + (script.latest && ["draft", "returned"].includes(script.latest.status) ? 0 : 1)})` : ""}` : "Add Script"}
      subtitle={script?.live ? "Reps keep seeing the approved version until this one is approved." : "Every script goes to the manager for approval before reps can see it."} onClose={onClose} wide>
      {restoredAt ? (
        <div className="mx-6 mt-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          <span>Restored your unsaved writing from {new Date(restoredAt).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}. Save the draft to keep it.</span>
          <button type="button" onClick={discardRestored} className="!min-h-0 rounded-lg border border-amber-300 bg-white px-3 py-1 text-[12px] font-bold text-amber-800">Discard it</button>
        </div>
      ) : null}
      <div className="grid gap-5 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={labelText}>Product</span><input value={product.name} disabled className={`${field} bg-gray-50`} /></label>
            <label className="block"><span className={labelText}>Script type</span>
              <select value={category} disabled={Boolean(script)} onChange={(event) => { const next = event.target.value as ScriptCategory; setCategory(next); if (next === "closing" && !fields.closingStyle) set("closingStyle", "direct"); }} className={field}>
                {TABS.map((item) => <option key={item.key} value={item.key}>{TYPE_LABEL[item.key]}</option>)}
              </select>
            </label>
            <label className="block"><span className={labelText}>Script name</span><input value={fields.title} onChange={(event) => set("title", event.target.value)} placeholder="Upgrade to 2 Pieces" className={field} /></label>
            <label className="block"><span className={labelText}>Purpose / situation</span><input value={fields.scenario} onChange={(event) => set("scenario", event.target.value)} placeholder="Value upgrade, Household need, Delivery savings…" className={field} /></label>
          </div>

          {category === "upsell" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <span className={labelText}>Upgrade path</span>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                From <select value={fields.upsellFromQty ?? ""} onChange={(event) => set("upsellFromQty", event.target.value ? Number(event.target.value) : null)} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                  <option value="">pieces…</option>{quantities.map((qty) => <option key={qty} value={qty}>{qty} pc{qty === 1 ? "" : "s"} — {money(priceOf(qty) ?? 0, product.currency)}</option>)}
                </select>
                to <select value={fields.upsellToQty ?? ""} onChange={(event) => set("upsellToQty", event.target.value ? Number(event.target.value) : null)} className="rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                  <option value="">pieces…</option>{quantities.map((qty) => <option key={qty} value={qty}>{qty} pcs — {money(priceOf(qty) ?? 0, product.currency)}</option>)}
                </select>
                {upgradeExtra > 0 ? <strong className="text-emerald-700">+{money(upgradeExtra, product.currency)} order value</strong> : null}
              </div>
            </div>
          ) : null}
          {category === "cross_sell" ? (
            <label className="block rounded-lg border border-amber-200 bg-amber-50/50 p-3"><span className={labelText}>Cross-sell product ({product.name} → ?)</span>
              <select value={fields.crossSellProductId ?? ""} onChange={(event) => set("crossSellProductId", event.target.value || null)} className={field}>
                <option value="">Choose…</option>{crossOptions.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              {product.crossSellProducts.length === 0 ? <span className="mt-1 block text-[11px] text-gray-500">This product has no recommended cross-sells set on Products &amp; Stock, so every product is listed.</span> : null}
            </label>
          ) : null}
          {category === "closing" ? (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3">
              <span className={labelText}>Closing style</span>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                {CLOSING_STYLES.map((style) => (
                  <label key={style.key} className={`flex cursor-pointer gap-2 rounded-lg border px-2.5 py-2 text-[12px] ${fields.closingStyle === style.key ? "border-blue-400 bg-white" : "border-transparent"}`}>
                    <input type="radio" checked={fields.closingStyle === style.key} onChange={() => set("closingStyle", style.key)} className="mt-0.5" />
                    <span><strong className="block text-gray-900">{style.label}</strong><span className="text-gray-500">{style.hint}</span></span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {category === "objection" ? (
            <label className="block rounded-lg border border-rose-200 bg-rose-50/50 p-3"><span className={labelText}>The customer says…</span>
              <input value={fields.objection ?? ""} onChange={(event) => set("objection", event.target.value)} placeholder="It's expensive" className={field} />
              <span className="mt-1.5 flex flex-wrap gap-1.5">{OBJECTION_PRESETS.map((preset) => <button key={preset} type="button" onClick={() => set("objection", preset)} className="!min-h-0 rounded-full border border-rose-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-rose-700">“{preset}”</button>)}</span>
            </label>
          ) : null}

          <label className="block"><span className={labelText}>Objective</span><input value={fields.objective} onChange={(event) => set("objective", event.target.value)} placeholder="Move customer from 1 Rack → 2 Racks" className={field} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className={labelText}>When to use</span><textarea rows={2} value={fields.whenToUse} onChange={(event) => set("whenToUse", event.target.value)} placeholder="Customer has shown interest in buying one piece." className={field} /></label>
            <label className="block"><span className={labelText}>Customer situation / trigger</span><textarea rows={2} value={fields.trigger} onChange={(event) => set("trigger", event.target.value)} placeholder="Customer asks about price or confirms one piece." className={field} /></label>
          </div>
          <div>
            <span className={labelText}>What to say</span>
            <div className="mt-1 flex flex-wrap gap-1">{PLACEHOLDERS.map((item) => <button key={item.key} type="button" onClick={() => insert(item.key)} className="!min-h-0 rounded-md border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 hover:bg-violet-100" title={`Insert {{${item.key}}}`}>+ {item.label}</button>)}</div>
            <textarea ref={sayRef} rows={6} value={fields.whatToSay} onChange={(event) => set("whatToSay", event.target.value)}
              placeholder="Since you're already taking one, most customers prefer taking two. Two goes for {{upgrade_price}}…" className={field} />
            <span className="block text-[11px] text-gray-500">Use the buttons for prices instead of typing them, so reps always quote the current offer.</span>
          </div>
          <ListInput label="Key points to communicate" items={fields.keyPoints} onChange={(items) => set("keyPoints", items)} placeholder="Better value" />
          <div className="grid gap-3 sm:grid-cols-2">
            <ListInput label="Must communicate" items={fields.mustSay} onChange={(items) => set("mustSay", items)} placeholder="Payment on delivery" />
            <ListInput label="Never say" items={fields.neverSay} onChange={(items) => set("neverSay", items)} placeholder="Fake scarcity" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block sm:col-span-1"><span className={labelText}>Desired customer action</span><input value={fields.desiredAction} onChange={(event) => set("desiredAction", event.target.value)} placeholder="Upgrade from 1 → 2 pieces" className={field} /></label>
            <label className="block"><span className={labelText}>Priority</span>
              <select value={fields.priority} onChange={(event) => set("priority", event.target.value as ScriptFields["priority"])} className={field}><option value="primary">Primary</option><option value="alternative">Alternative</option><option value="experimental">Experimental</option></select>
            </label>
            <label className="block"><span className={labelText}>Expected impact</span>
              <select value={fields.impact} onChange={(event) => set("impact", event.target.value as ScriptFields["impact"])} className={field}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
            </label>
          </div>
        </div>

        <aside className="space-y-3">
          <p className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-500">What reps will see</p>
          <blockquote className="m-0 min-h-[120px] whitespace-pre-wrap rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-[13px] leading-relaxed text-gray-900">{warnings?.preview.whatToSay || fields.whatToSay || "Start writing the script…"}</blockquote>
          {warnings && warnings.missingPlaceholders.length > 0 ? <p className="m-0 text-[11px] text-amber-700">Not set yet: {warnings.missingPlaceholders.map((key) => `{{${key}}}`).join(", ")}{warnings.missingPlaceholders.includes("delivery_offer") ? " (a manager sets the delivery offer in the usage report settings)" : ""}.</p> : null}
          {warnings && warnings.outdatedPrices.length > 0 ? <div className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[12px] text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warnings.outdatedPrices.map((value) => money(value, product.currency)).join(", ")} is not a current price for {product.name}.</div> : null}
          {warnings && warnings.duplicates.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] text-amber-900">
              <strong className="block">Looks like a script you already have:</strong>
              {warnings.duplicates.map((item) => <span key={item.id} className="block">“{item.title}” ({item.reason === "same_purpose" ? "same purpose" : "almost the same wording"})</span>)}
              <span className="mt-1 block">Give each script its own situation so reps know when to use which.</span>
            </div>
          ) : null}
          {error ? <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">{error}</p> : null}
          <div className="flex flex-col gap-2 pt-2">
            <button type="button" disabled={busy} onClick={() => void save(true)} className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg bg-[#1F8FE0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a7cc4] disabled:opacity-50"><Send className="h-4 w-4" /> Submit for Approval</button>
            <button type="button" disabled={busy} onClick={() => void save(false)} className="!min-h-0 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">Save Draft</button>
          </div>
        </aside>
      </div>
    </Modal>
  );
}

function PreviewAllModal({ product, scripts, onClose }: { product: ScriptProduct; scripts: ScriptSummary[]; onClose: () => void }) {
  const live = scripts.filter((script) => script.live && !script.deactivatedAt);
  return (
    <Modal title={`${product.name} — what reps see`} subtitle="Only approved, switched-on scripts. Prices are filled in when a rep opens a script on an order." onClose={onClose} wide>
      <div className="space-y-4 px-6 py-5">
        {TABS.map((item) => {
          const rows = live.filter((script) => script.category === item.key);
          return (
            <div key={item.key}>
              <p className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-500">{item.label} ({rows.length})</p>
              {rows.length === 0 ? <p className="m-0 mt-1 text-[13px] text-gray-400">None approved yet.</p> : (
                <ul className="m-0 mt-1.5 list-none space-y-2 p-0">
                  {rows.map((script) => (
                    <li key={script.id} className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
                      <strong className="text-[13px] text-gray-900 dark:text-slate-100">{script.live!.objection ? `“${script.live!.objection}”` : script.live!.title}</strong>
                      <p className="m-0 mt-1 whitespace-pre-wrap text-[13px] text-gray-700 dark:text-slate-300">{script.live!.whatToSay}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function HistoryModal({ scriptId, onClose }: { scriptId: string; onClose: () => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof salesScriptingApi.script>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { salesScriptingApi.script(scriptId).then(setData).catch((err: any) => setError(err?.message ?? "Could not load the history.")); }, [scriptId]);
  const versionNo = (id: string | null) => data?.versions.find((version) => version.id === id)?.versionNo;
  return (
    <Modal title="Version history & audit trail" subtitle={data?.script.latest?.title ?? ""} onClose={onClose} wide>
      <div className="grid gap-5 px-6 py-5 lg:grid-cols-2">
        {error ? <p className="m-0 text-sm text-rose-700">{error}</p> : null}
        <div>
          <p className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-500">Versions</p>
          <ul className="m-0 mt-2 list-none space-y-2 p-0">
            {(data?.versions ?? []).map((version) => (
              <li key={version.id} className="rounded-lg border border-gray-200 p-3 text-[13px] dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-gray-900 dark:text-slate-100">Version {version.versionNo} — {version.title}</strong>
                  <Pill tone={version.status === "approved" ? STATUS_PILL.approved.tone : version.status === "submitted" ? STATUS_PILL.pending.tone : version.status === "returned" || version.status === "rejected" ? STATUS_PILL.returned.tone : STATUS_PILL.draft.tone}>
                    {version.status === "approved" ? "Live" : version.status === "submitted" ? "Pending" : version.status[0].toUpperCase() + version.status.slice(1)}
                  </Pill>
                </div>
                <p className="m-0 mt-1 text-[12px] text-gray-500">
                  Written by {version.createdByName ?? "—"} · {shortDateTime(version.createdAt)}
                  {version.approvedAt ? ` · approved ${shortDateTime(version.approvedAt)} by ${version.decidedByName ?? "—"}` : ""}
                  {version.archivedAt ? ` · archived ${shortDateTime(version.archivedAt)}` : ""}
                  {version.replacedByVersionId ? ` · replaced by version ${versionNo(version.replacedByVersionId) ?? "?"}` : ""}
                </p>
                <p className="m-0 mt-1 text-[12px] text-gray-600">Used {version.used} time{version.used === 1 ? "" : "s"} · customer said yes {version.accepted}</p>
                {version.decisionNote ? <p className="m-0 mt-1 text-[12px] italic text-gray-600">“{version.decisionNote}”</p> : null}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="m-0 text-[12px] font-black uppercase tracking-wide text-gray-500">Audit trail</p>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {(data?.audit ?? []).map((entry: ScriptAuditEntry, index) => (
              <li key={index} className="border-l-2 border-gray-200 pl-3 text-[12px] dark:border-slate-700">
                <strong className="text-gray-900 dark:text-slate-100">{AUDIT_LABEL[entry.action] ?? entry.action}</strong>
                {versionNo(entry.versionId) ? ` · v${versionNo(entry.versionId)}` : ""}
                <span className="block text-gray-500">{shortDateTime(entry.at)} · {entry.actorName ?? "—"}{entry.actorRole ? ` (${entry.actorRole})` : ""}</span>
                {entry.detail?.note ? <span className="block italic text-gray-600">“{entry.detail.note}”</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}

function DecisionModal({ script, action, onClose, onConfirm }: {
  script: ScriptSummary; action: "approve" | "return" | "reject" | "deactivate" | "archive"; onClose: () => void; onConfirm: (note?: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const needsNote = action !== "approve";
  const copy = {
    approve: { title: "Approve & publish", body: "Reps will see this script on their orders straight away.", button: "Approve & Publish", placeholder: "Optional comment for the Head of Sales" },
    return: { title: "Return for correction", body: "The Head of Sales gets your exact comment and can resubmit.", button: "Return", placeholder: "e.g. Too aggressive. Rewrite the price objection part and don't promise free delivery unless the offer includes it." },
    reject: { title: "Reject", body: "The script will not be published.", button: "Reject", placeholder: "Why is it rejected?" },
    deactivate: { title: "Deactivate", body: "Reps stop seeing it. History and past orders stay linked.", button: "Deactivate", placeholder: "Why switch it off?" },
    archive: { title: "Archive", body: "Retired for good. History and past orders stay linked to it.", button: "Archive", placeholder: "Why archive it?" }
  }[action];
  return (
    <Modal title={copy.title} subtitle={shownVersion(script)?.title ?? ""} onClose={onClose}>
      <div className="space-y-3 px-6 py-5">
        <p className="m-0 text-[13px] text-gray-600">{copy.body}</p>
        <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder={copy.placeholder} className={field} />
        {error ? <p className="m-0 text-[12px] font-semibold text-rose-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="!min-h-0 rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">Cancel</button>
          <button type="button" disabled={busy} onClick={async () => {
            if (needsNote && note.trim().length < 5) { setError("Write a short comment (5 characters or more)."); return; }
            setBusy(true);
            try { await onConfirm(note.trim() || undefined); } catch (err: any) { setError(err?.message ?? "Could not save."); setBusy(false); }
          }} className={`!min-h-0 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${action === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : action === "return" ? "bg-amber-600 hover:bg-amber-700" : "bg-rose-600 hover:bg-rose-700"}`}>{copy.button}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Small Sales Scripting summary for the Head of Sales Overview page. */
export function SalesScriptingOverviewCard({ onOpen }: { onOpen: () => void }) {
  const [library, setLibrary] = useState<ScriptLibrary | null>(null);
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof salesScriptingApi.usage>> | null>(null);
  useEffect(() => {
    salesScriptingApi.library().then(setLibrary).catch(() => undefined);
    salesScriptingApi.usage().then(setUsage).catch(() => undefined);
  }, []);
  const notReady = (library?.products ?? []).filter((product) => product.readiness.percent < 100).length;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 xl:col-span-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-base font-bold text-gray-900">Sales Scripting</h2>
        <button type="button" className="!min-h-0 text-xs font-bold text-[#1F8FE0] hover:underline" onClick={onOpen}>View All →</button>
      </div>
      {library ? (
        <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm">
          <li className="flex justify-between"><span className="text-gray-600">Approved scripts live</span><strong>{library.kpis.approved}</strong></li>
          <li className="flex justify-between"><span className="text-gray-600">Waiting for approval</span><strong>{library.kpis.pending}</strong></li>
          <li className="flex justify-between"><span className="text-gray-600">Drafts</span><strong>{library.kpis.drafts}</strong></li>
          <li className="flex justify-between"><span className="text-gray-600">Products below the playbook minimum</span><strong>{notReady}</strong></li>
          {usage ? <li className="flex justify-between"><span className="text-gray-600">Used in the last 4 weeks</span><strong>{usage.kpis.used}</strong></li> : null}
          {usage ? <li className="flex justify-between"><span className="text-gray-600">Scripts needing review</span><strong className={usage.kpis.needsReview > 0 ? "text-amber-700" : ""}>{usage.kpis.needsReview}</strong></li> : null}
        </ul>
      ) : <p className="m-0 mt-3 text-sm italic text-gray-400">Loading…</p>}
      <button type="button" className="!min-h-0 mt-3 text-xs font-bold text-[#1F8FE0] hover:underline" onClick={onOpen}>+ Add Script</button>
    </section>
  );
}
