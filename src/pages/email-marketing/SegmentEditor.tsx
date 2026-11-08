import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Check, CheckCircle2, ChevronDown, Code2, Diamond, Filter, Info, Layers, ListChecks, Lock, Plus, ShoppingCart, Users, X, Zap } from "lucide-react";
import { emailMarketingApi, type EmCondition, type EmDesigner, type EmSegment, type EmSegmentPreview } from "../../lib/api";
import SegmentBuilder, { ConditionRow, defaultValue } from "./SegmentBuilder";
import { Card, Toggle, btn, count, input, naira } from "./em-ui";

/** Create Segment, built to Bright's design (8 Nov 2026, "Create Segment" window). */

export default function SegmentEditor({ segment, designer, onClose, onDone }: {
  segment?: EmSegment;
  designer: EmDesigner;
  onClose: () => void;
  onDone: (message: string) => Promise<void> | void;
}) {
  const fixed = segment?.kind === "fixed";
  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [kind, setKind] = useState<"auto" | "fixed">(segment?.kind ?? "auto");
  const [rule, setRule] = useState<{ match: "all" | "any"; conditions: EmCondition[] }>({
    match: segment?.match ?? "all",
    conditions: segment?.conditions?.length ? segment.conditions : [{ field: "purchase_count", op: "gte", value: 2 }, { field: "last_purchase_days", op: "within", value: 30 }]
  });
  const [excludeOn, setExcludeOn] = useState(segment ? segment.excludeOn : true);
  const [exclude, setExclude] = useState<EmCondition[]>(segment?.exclude?.length ? segment.exclude : [{ field: "contact_status", op: "is", value: "unsubscribed" }]);
  const [tab, setTab] = useState<"rules" | "sql">("rules");
  const [preview, setPreview] = useState<EmSegmentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = { fields: designer.conditionFields, products: designer.products, states: designer.states, tags: designer.tags };

  useEffect(() => {
    if (fixed || !rule.conditions.length) { setPreview(null); return; }
    const timer = window.setTimeout(() => {
      emailMarketingApi.segmentPreview({ ...rule, excludeOn, exclude }).then(setPreview).catch(() => setPreview(null));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [JSON.stringify(rule), excludeOn, JSON.stringify(exclude), fixed]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!name.trim()) { setError("Give the segment a name."); return; }
    if (!fixed && !rule.conditions.length) { setError("Add at least one condition."); return; }
    setBusy(true);
    setError("");
    try {
      if (segment) {
        await emailMarketingApi.updateSegment(segment.id, fixed ? { name, description } : { name, description, ...rule, excludeOn, exclude });
        await onDone("Segment saved.");
      } else {
        await emailMarketingApi.createSegment({ name, description, kind, ...rule, excludeOn, exclude, icon: kind === "fixed" ? "layers" : "users" });
        await onDone(kind === "fixed" ? "Static segment made. It keeps today's people." : "Segment created. It updates by itself.");
      }
    } catch (err) {
      setError((err as Error).message || "Could not save the segment.");
      setBusy(false);
    }
  };

  const fieldLabel = (key: string) => designer.conditionFields.find((row) => row.field === key)?.label ?? key;
  const sqlText = [
    "-- Read-only: the rules above, written out",
    "SELECT customers",
    `WHERE ${rule.conditions.map((c) => `${fieldLabel(c.field).replace(/\s+/g, "_").toLowerCase()} ${c.op.toUpperCase()} ${JSON.stringify(c.value)}`).join(rule.match === "all" ? "\n  AND " : "\n  OR ") || "TRUE"}`,
    ...(excludeOn && exclude.length ? [`  AND NOT (${exclude.map((c) => `${fieldLabel(c.field).replace(/\s+/g, "_").toLowerCase()} ${c.op.toUpperCase()} ${JSON.stringify(c.value)}`).join(" OR ")})`] : [])
  ].join("\n");

  return createPortal(
    <div className="fixed inset-0 z-[88] flex items-stretch justify-center bg-slate-900/55 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-full w-full max-w-[1260px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[94vh] sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-4 px-6 pb-3 pt-5">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Users className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[26px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{segment ? "Edit Segment" : "Create Segment"}</h2>
            <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Define rules to group your audience for targeted marketing, automations, and campaigns.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4">
          {error && <p className="m-0 mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.7fr)_minmax(0,0.85fr)]">
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2.5 bg-[#F5F2FE] px-4 py-3 dark:bg-violet-500/10"><ListChecks className="h-5 w-5 text-[#5B3FD9]" /><h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Segment Details</h3></div>
              <div className="space-y-4 p-4">
                <label className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Segment Name <span className="text-rose-500">*</span>
                  <input value={name} onChange={(event) => setName(event.target.value.slice(0, 120))} placeholder="e.g. Repeat Buyers (30 Days)" className={`${input} mt-1.5`} />
                </label>
                <div>
                  <label className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Description <span className="font-normal text-gray-500">(Optional)</span>
                    <textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 200))} rows={4} className={`${input} mt-1.5 resize-none`} placeholder="Who is in this group, in one line." />
                  </label>
                  <p className="m-0 mt-1 text-right text-[12px] text-gray-500">{description.length} / 200</p>
                </div>
                <div>
                  <p className="m-0 mb-2 text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Segment Type</p>
                  {([
                    { key: "auto", icon: Zap, title: "Dynamic", hint: "Updates by itself as customers meet the rules" },
                    { key: "fixed", icon: Layers, title: "Static", hint: "One-time list, won't update" }
                  ] as const).map(({ key, icon: Icon, title, hint }) => {
                    const on = kind === key;
                    return (
                      <button key={key} type="button" disabled={!!segment} onClick={() => setKind(key)}
                        className={`!min-h-0 mb-2 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left disabled:cursor-default ${on ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"} ${segment && !on ? "opacity-50" : ""}`}>
                        <Icon className="h-6 w-6 shrink-0 text-[#5B3FD9]" />
                        <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{title}</span><span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{hint}</span></span>
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-[#5B3FD9]" : "border-gray-300"}`}>{on && <span className="h-2.5 w-2.5 rounded-full bg-[#5B3FD9]" />}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <Filter className="mt-0.5 h-6 w-6 text-[#5B3FD9]" />
                <div className="min-w-0 flex-1"><h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Segment Rules</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Add conditions to define who belongs in this segment.</p></div>
                <div className="inline-flex overflow-hidden rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
                  <button type="button" onClick={() => setTab("rules")} className={`!min-h-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold ${tab === "rules" ? "bg-[#5B3FD9] text-white" : "text-gray-700 dark:text-slate-300"}`}><ListChecks className="h-3.5 w-3.5" />Rule Builder</button>
                  <button type="button" onClick={() => setTab("sql")} className={`!min-h-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold ${tab === "sql" ? "bg-[#5B3FD9] text-white" : "text-gray-700 dark:text-slate-300"}`}><Code2 className="h-3.5 w-3.5" />Advanced (SQL)</button>
                </div>
              </div>
              {fixed && <p className="m-0 mt-3 flex items-center gap-2 rounded-xl bg-[#F7F4FF] px-3 py-2 text-[12.5px] text-gray-700 dark:bg-slate-800 dark:text-slate-300"><Lock className="h-4 w-4 text-[#5B3FD9]" />A static segment keeps the {count(segment!.contactIds.length)} people it had when it was made. Its rules can't change.</p>}
              {tab === "sql" ? (
                <div className="mt-3 space-y-2">
                  <pre className="m-0 overflow-x-auto rounded-xl bg-slate-900 p-4 text-[12.5px] leading-relaxed text-violet-100">{sqlText}</pre>
                  <p className="m-0 text-[12px] leading-snug text-gray-500">This view is read-only. Typing SQL straight into the database is switched off on purpose: one wrong line could read or change any record. Use the Rule Builder to change the rules.</p>
                </div>
              ) : (
                <fieldset disabled={fixed} className={`m-0 mt-3 space-y-3 border-0 p-0 ${fixed ? "opacity-60" : ""}`}>
                  <SegmentBuilder dropdownMatch match={rule.match} conditions={rule.conditions} fields={options.fields} products={options.products} states={options.states} tags={options.tags} onChange={setRule} />
                  <div className="rounded-xl border border-gray-200 p-4 dark:border-slate-700">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-gray-900 dark:text-slate-50"><Users className="h-4 w-4" />And</span>
                      <span className="inline-flex items-center gap-1 text-[14px] font-bold text-gray-900 dark:text-slate-50">Exclude Customers <span className="font-normal text-gray-500">(Optional)</span><ChevronDown className="h-4 w-4" /></span>
                      <span className="ml-auto"><Toggle on={excludeOn} label="Exclude customers" onChange={setExcludeOn} /></span>
                    </div>
                    <div className={`mt-3 space-y-2 ${excludeOn ? "" : "pointer-events-none opacity-50"}`}>
                      {exclude.map((condition, index) => (
                        <ConditionRow key={index} condition={condition} options={options} iconTile exclusion
                          onChange={(next) => setExclude(exclude.map((row, i) => (i === index ? next : row)))} onRemove={() => setExclude(exclude.filter((_, i) => i !== index))} />
                      ))}
                      <button type="button" onClick={() => { const field = options.fields.find((row) => row.field === "tag") ?? options.fields[0]; setExclude([...exclude, { field: field.field, op: field.ops[0].op, value: defaultValue(field, options) }]); }}
                        className="!min-h-0 mx-auto flex items-center justify-center gap-2 rounded-xl border border-[#B9A8F5] bg-white px-5 py-2.5 text-[13.5px] font-bold text-[#5B3FD9] hover:bg-[#F3EFFE] dark:bg-slate-900">
                        <Plus className="h-4 w-4" />Add Exclusion
                      </button>
                    </div>
                  </div>
                </fieldset>
              )}
            </Card>

            <div className="min-w-0 space-y-4">
              <Card className="p-4">
                <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><BarChart3 className="h-5 w-5 text-[#5B3FD9]" />Audience Preview</h3>
                <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Estimated audience that matches your rules.</p>
                <div className="mt-3 rounded-xl bg-gradient-to-br from-[#EFEAFF] to-[#E3DBFF] px-4 py-4 dark:from-violet-500/15 dark:to-violet-500/5">
                  <div className="flex items-center gap-3"><Users className="h-8 w-8 text-[#5B3FD9]" /><span className="text-[30px] font-extrabold leading-none text-gray-900 dark:text-slate-50">{fixed ? count(segment!.contactIds.length) : preview ? count(preview.size) : "—"}</span></div>
                  <p className="m-0 mt-2 text-[12.5px] text-gray-700 dark:text-slate-300">{preview ? `≈ ${preview.percentOfAudience}% of total audience (${count(preview.totalAudience)})` : fixed ? "People kept in this list" : "Counting…"}</p>
                </div>
                {preview && <p className="m-0 mt-2 text-[12px] leading-snug text-gray-600 dark:text-slate-400">{count(preview.customers)} customers match. {preview.withoutEmail ? `${count(preview.withoutEmail)} gave no email yet, so they are not counted above.` : ""}</p>}
              </Card>
              <Card className="p-4">
                <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><Diamond className="h-5 w-5 text-[#5B3FD9]" />Segment Insights</h3>
                <div className="mt-2 divide-y divide-gray-100 text-[13px] dark:divide-slate-800">
                  {[
                    { icon: ShoppingCart, label: "Avg. Orders per Customer", value: preview ? preview.avgOrders.toFixed(1) : "—" },
                    { icon: Layers, label: "Avg. Order Value (AOV)", value: preview ? naira(preview.avgOrderValue) : "—" },
                    { icon: BarChart3, label: "Total Value So Far", value: preview ? naira(preview.totalValue) : "—" }
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center gap-2 py-2.5"><Icon className="h-4 w-4 text-[#5B3FD9]" /><span className="flex-1 text-gray-700 dark:text-slate-300">{label}</span><span className="font-bold text-gray-900 dark:text-slate-50">{value}</span></div>
                  ))}
                </div>
              </Card>
              {kind === "auto" ? (
                <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                  <p className="m-0 flex items-center gap-2 text-[14px] font-bold text-gray-900 dark:text-slate-50"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Segment will auto-update</p>
                  <p className="m-0 mt-1 text-[12.5px] leading-snug text-gray-700 dark:text-slate-300">Customers are added or removed by themselves as they meet (or no longer meet) these conditions.</p>
                </div>
              ) : (
                <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 dark:border-sky-500/20 dark:bg-sky-500/10">
                  <p className="m-0 flex items-center gap-2 text-[14px] font-bold text-gray-900 dark:text-slate-50"><Lock className="h-5 w-5 text-sky-600" />Segment stays as it is</p>
                  <p className="m-0 mt-1 text-[12.5px] leading-snug text-gray-700 dark:text-slate-300">It keeps the people who match when you save it. New customers won't join it.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 px-6 py-4 dark:border-slate-800">
          <p className="m-0 flex min-w-[260px] flex-1 items-start gap-2.5 rounded-xl bg-[#F7F4FF] px-4 py-2.5 text-[13px] text-gray-700 dark:bg-violet-500/10 dark:text-slate-300">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#5B3FD9]" /><span><strong>Tip:</strong> Use dynamic segments for ongoing campaigns (e.g., repeat buyers, high spenders) and static segments for one-off campaigns (e.g., event or promo lists).</span>
          </p>
          <button type="button" onClick={onClose} className={`${btn.ghost} !px-6 !py-3`}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void save()} className={`${btn.primary} !px-6 !py-3`}><Check className="h-4 w-4" />{busy ? "Saving…" : segment ? "Save Segment" : "Create Segment"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
