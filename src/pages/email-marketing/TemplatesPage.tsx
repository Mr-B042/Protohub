import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bookmark, Calendar, Copy, Eye, LayoutGrid, Layers, List, Megaphone, Monitor, Package, PartyPopper, Pencil, Plus, Repeat, Rocket, Search, ShoppingCart, Smartphone,
  Sparkles, Tag, Trash2, Zap, type LucideIcon
} from "lucide-react";
import { emailMarketingApi, type EmDesigner, type EmTemplate } from "../../lib/api";
import { STARTER_TEMPLATES, TEMPLATE_CATEGORIES, buildStarterDesign, type CampaignFields, type EmailDesign } from "../../lib/email-render";
import { ModalShell } from "./AudiencePage";
import type { StartTemplate } from "./CampaignWizard";
import EmailFrame from "./EmailFrame";
import TemplateCover from "./TemplateCover";
import { Card, ErrorNote, Loading, btn, count, input, lagosDate, select } from "./em-ui";
import { RowMenu } from "./loyalty-ui";
import TemplateWizard, { type TemplateWizardStart } from "./TemplateWizard";
import { fieldsFor, newDraft } from "./wizard-model";

/**
 * Templates tab (Bright's design, 8 Nov 2026). Ready-made emails are built
 * from the business's own brand and products (shown as they will be sent),
 * next to the team's saved templates. "Use Template" opens Create Campaign
 * with the design filled in. No AI (Bright's rule): no generate buttons.
 */

export const CATEGORY_ICON: Record<string, LucideIcon> = {
  promotional: Tag, retention: Repeat, post_purchase: Package, cart: ShoppingCart, welcome: Sparkles, launch: Rocket, reengagement: Zap, announcement: Megaphone,
  seasonal: Calendar, custom: Bookmark
};
export const categoryLabel = (key: string) => TEMPLATE_CATEGORIES.find((row) => row.key === key)?.label ?? "Custom / Saved";
const CATEGORY_TONE: Record<string, string> = {
  promotional: "bg-emerald-100 text-emerald-800", retention: "bg-violet-100 text-violet-800", post_purchase: "bg-sky-100 text-sky-800", cart: "bg-rose-100 text-rose-700",
  welcome: "bg-blue-100 text-blue-800", launch: "bg-amber-100 text-amber-800", reengagement: "bg-orange-100 text-orange-800", announcement: "bg-fuchsia-100 text-fuchsia-800",
  seasonal: "bg-teal-100 text-teal-800", custom: "bg-gray-100 text-gray-700"
};
const TYPE_LABEL: Record<string, string> = { promotional: "Promotional", retention: "Retention", transactional: "Transactional", announcement: "Announcement" };

/** The brand and the first product with a picture fill every preview. */
export function previewFields(designer: EmDesigner | null): CampaignFields {
  return fieldsFor(newDraft(designer), designer);
}

type TCard = {
  key: string; name: string; hint: string; category: string; type: string; design: EmailDesign; subject: string; preheader: string; used: number;
  saved: EmTemplate | null; updatedAt: string | null;
};

export default function TemplatesPage({ onToast, refreshKey, onUseTemplate, onCreateFromScratch }: {
  onToast: (message: string) => void; refreshKey: number; onUseTemplate: (template: StartTemplate) => void; onCreateFromScratch: () => void;
}) {
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [data, setData] = useState<{ saved: EmTemplate[]; usage: Array<{ key: string; count: number }> } | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"used" | "newest" | "name">("used");
  const [type, setType] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [preview, setPreview] = useState<TCard | null>(null);
  const [wizard, setWizard] = useState<TemplateWizardStart | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedDesigner, loaded] = await Promise.all([designer ? Promise.resolve(designer) : emailMarketingApi.designer(), emailMarketingApi.templates()]);
      setDesigner(loadedDesigner); setData(loaded); setError("");
    } catch (err) { setError((err as Error).message || "Could not load the templates."); }
  }, [designer]);
  useEffect(() => { void load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = useMemo(() => previewFields(designer), [designer]);
  const cards = useMemo<TCard[]>(() => {
    if (!data) return [];
    const used = new Map(data.usage.map((row) => [row.key, row.count]));
    const starters = STARTER_TEMPLATES.filter((row) => row.key !== "blank").map((row) => ({
      key: `starter:${row.key}`, name: row.name, hint: row.hint, category: row.category, type: row.type, design: buildStarterDesign(row.key, fields),
      subject: row.subject, preheader: row.preheader, used: used.get(`starter:${row.key}`) ?? 0, saved: null, updatedAt: null
    }));
    const saved = data.saved.map((row) => ({
      key: `saved:${row.id}`, name: row.name, hint: row.description || `Saved by ${row.createdByName || "the team"}`, category: row.category, type: row.templateType, design: row.design,
      subject: row.subject, preheader: row.preheader, used: used.get(`saved:${row.id}`) ?? 0, saved: row, updatedAt: row.updatedAt
    }));
    return [...saved, ...starters];
  }, [data, fields]);

  const inCategory = (card: TCard, key: string) => key === "all" || (key === "custom" ? !!card.saved : card.category === key);
  const shown = cards
    .filter((card) => inCategory(card, category))
    .filter((card) => !type || card.type === type)
    .filter((card) => !query.trim() || `${card.name} ${card.hint}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "newest" ? (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") : b.used - a.used || Number(!!b.saved) - Number(!!a.saved)));

  const use = (card: TCard) => {
    if (card.saved?.status === "draft") { onToast("This template is a draft. Open it, finish it and save it as a template first."); return; }
    onUseTemplate({ key: card.key, name: card.saved ? card.name : "", design: card.design, subject: card.subject, preheader: card.preheader });
  };
  const remove = async (card: TCard) => {
    if (!card.saved || !window.confirm(`Delete "${card.name}"? Campaigns already made from it keep their design.`)) return;
    try { await emailMarketingApi.deleteTemplate(card.saved.id); onToast("Template deleted."); await load(); }
    catch (err) { onToast((err as Error).message || "Could not delete the template."); }
  };
  const asNew = (card: TCard): TemplateWizardStart => ({
    id: null, name: card.saved ? `${card.name} (copy)` : card.name, category: card.category === "custom" ? "promotional" : card.category, description: card.saved ? card.saved.description : card.hint,
    templateType: card.type as TemplateWizardStart["templateType"], visibility: "team", subject: card.subject, preheader: card.preheader, design: card.design, layout: null, step: 3
  });
  const menu = (card: TCard) => (
    <RowMenu label={`More for ${card.name}`} items={card.saved ? [
      { key: "edit", label: "Edit", icon: Pencil, run: () => setWizard({ id: card.saved!.id, name: card.saved!.name, category: card.saved!.category, description: card.saved!.description, templateType: card.saved!.templateType, visibility: card.saved!.visibility, subject: card.saved!.subject, preheader: card.saved!.preheader, design: card.saved!.design, layout: null, step: 1 }) },
      { key: "copy", label: "Duplicate", icon: Copy, run: () => setWizard(asNew(card)) },
      { key: "delete", label: "Delete", icon: Trash2, run: () => void remove(card), danger: true }
    ] : [
      { key: "copy", label: "Make My Own Copy", icon: Copy, run: () => setWizard(asNew(card)) }
    ]} />
  );

  const savedCount = cards.filter((card) => card.saved).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center text-[#5B3FD9]"><Layers className="h-10 w-10" strokeWidth={1.6} /></span>
        <div className="min-w-[240px] flex-1">
          <h2 className="m-0 text-[26px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Email Templates</h2>
          <p className="m-0 text-[14.5px] text-gray-600 dark:text-slate-400">Use ready-made email templates for promotions, follow-ups, retention, and more.</p>
        </div>
        <label className="relative w-full sm:w-[260px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates..." className={`${input} !pl-9`} /></label>
        <button type="button" onClick={onCreateFromScratch} className={`${btn.ghost} !border-[#8B74EE] !px-5 !text-[#5B3FD9]`}><Plus className="h-4 w-4" />Create from Scratch</button>
      </div>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card className="p-2">
              {[{ key: "all", label: "All Templates" }, ...TEMPLATE_CATEGORIES, { key: "custom", label: "Custom / Saved" }].map((row) => {
                const Icon = row.key === "all" ? Layers : CATEGORY_ICON[row.key] ?? Bookmark;
                const n = row.key === "all" ? cards.length : row.key === "custom" ? savedCount : cards.filter((card) => card.category === row.key).length;
                const on = category === row.key;
                return (
                  <button key={row.key} type="button" onClick={() => setCategory(row.key)} aria-current={on ? "true" : undefined}
                    className={`!min-h-0 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold ${on ? "border border-[#8B74EE] bg-[#F5F2FE] text-[#3B2A99] dark:bg-violet-500/15 dark:text-violet-100" : "text-gray-800 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                    <Icon className="h-5 w-5 shrink-0" /><span className="flex-1">{row.label}</span>
                    <span className={`rounded-md px-2 py-0.5 text-[12px] font-bold ${on ? "bg-[#E3DEFA] text-[#3B2A99]" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300"}`}>{count(n)}</span>
                  </button>
                );
              })}
            </Card>
            <Card className="p-4">
              <div className="flex gap-3"><Sparkles className="h-6 w-6 shrink-0 text-[#5B3FD9]" /><div><div className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Need a custom design?</div><p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Create a template from scratch or duplicate an existing one.</p></div></div>
              <button type="button" onClick={() => setWizard({ id: null, name: "", category: "promotional", description: "", templateType: "promotional", visibility: "team", subject: "", preheader: "", design: null, layout: "promo_offer", step: 1 })}
                className={`${btn.primary} mt-3 w-full`}><Plus className="h-4 w-4" />Create Custom Template</button>
            </Card>
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 mr-auto text-[19px] font-bold text-gray-900 dark:text-slate-50">{category === "all" ? "All Templates" : categoryLabel(category)} ({count(shown.length)})</h3>
              <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className={`${select} !w-[170px] !py-2`} aria-label="Sort">
                <option value="used">Sort: Most Used</option><option value="newest">Sort: Newest</option><option value="name">Sort: A–Z</option>
              </select>
              <select value={type} onChange={(event) => setType(event.target.value)} className={`${select} !w-[170px] !py-2`} aria-label="Type">
                <option value="">Layout: All</option>{Object.entries(TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <span className="inline-flex rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
                <button type="button" aria-label="Grid view" onClick={() => setView("grid")} className={`!min-h-0 rounded-lg p-2 ${view === "grid" ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><LayoutGrid className="h-4 w-4" /></button>
                <button type="button" aria-label="List view" onClick={() => setView("list")} className={`!min-h-0 rounded-lg p-2 ${view === "list" ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><List className="h-4 w-4" /></button>
              </span>
            </div>
            {shown.length === 0 && (
              <Card className="px-6 py-12 text-center text-[14px] text-gray-600 dark:text-slate-400">
                {category === "custom" ? "No saved templates yet. Create a custom template, or save a design from Create Campaign." : "No template matches."}
              </Card>
            )}
            {view === "grid" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 min-[1760px]:grid-cols-4">
                {shown.map((card) => (
                  <Card key={card.key} className="flex flex-col overflow-hidden p-2.5">
                    <button type="button" onClick={() => setPreview(card)} aria-label={`Preview ${card.name}`} className="!min-h-0 relative block h-[220px] overflow-hidden rounded-xl bg-[#F4F1FE] text-left dark:bg-slate-800">
                      <span className={`absolute left-2 top-2 z-10 rounded-md px-2 py-0.5 text-[11.5px] font-bold ${CATEGORY_TONE[card.saved ? "custom" : card.category] ?? CATEGORY_TONE.custom}`}>
                        {card.saved ? (card.saved.status === "draft" ? "Draft" : card.saved.visibility === "private" ? "Private" : "Saved") : categoryLabel(card.category)}
                      </span>
                      <TemplateCover starterKey={card.saved ? null : card.key.replace("starter:", "")} design={card.design} name={card.name} brand={fields.brand} photo={fields.productImage} />
                    </button>
                    <div className="mt-2.5 flex-1 px-1">
                      <div className="text-[16px] font-bold text-gray-900 dark:text-slate-50">{card.name}</div>
                      <p className="m-0 mt-0.5 line-clamp-2 text-[13px] text-gray-600 dark:text-slate-400">{card.hint}</p>
                      {card.used > 0 && <p className="m-0 mt-1 text-[11.5px] font-semibold text-gray-500">Used in {count(card.used)} {card.used === 1 ? "campaign" : "campaigns"}</p>}
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      <button type="button" onClick={() => setPreview(card)} className={`${btn.ghost} flex-1 whitespace-nowrap !px-2 !py-2 !text-[13px]`}><Eye className="h-4 w-4" />Preview</button>
                      <button type="button" onClick={() => use(card)} className={`${btn.primary} flex-1 whitespace-nowrap !px-2 !py-2 !text-[13px]`}>Use Template</button>
                      {menu(card)}
                    </div>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="overflow-x-auto">
                <table className="!min-w-0 w-full min-w-[680px] text-left text-[13px]">
                  <thead><tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                    <th className="px-4 py-2.5">Template</th><th className="px-2 py-2.5">Category</th><th className="px-2 py-2.5">Type</th><th className="px-2 py-2.5 text-right">Used In</th><th className="px-2 py-2.5">Updated</th><th className="px-3 py-2.5 text-right">Actions</th>
                  </tr></thead>
                  <tbody>
                    {shown.map((card) => (
                      <tr key={card.key} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                        <td className="px-4 py-2.5"><span className="block font-bold text-gray-900 dark:text-slate-50">{card.name}</span><span className="block max-w-[320px] truncate text-[12px] text-gray-500">{card.hint}</span></td>
                        <td className="px-2 py-2.5">{card.saved ? "Custom / Saved" : categoryLabel(card.category)}</td>
                        <td className="px-2 py-2.5">{TYPE_LABEL[card.type] ?? card.type}</td>
                        <td className="px-2 py-2.5 text-right">{count(card.used)}</td>
                        <td className="px-2 py-2.5">{card.updatedAt ? lagosDate(card.updatedAt) : "Ready-made"}</td>
                        <td className="px-3 py-2.5"><span className="flex justify-end gap-1.5"><button type="button" onClick={() => setPreview(card)} className={btn.outline}>Preview</button><button type="button" onClick={() => use(card)} className={btn.outline}>Use</button>{menu(card)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </div>
        </div>
      )}

      {preview && <PreviewModal card={preview} brand={fields.brand} footerNote={designer?.settings.footerNote} onClose={() => setPreview(null)} onUse={() => { setPreview(null); use(preview); }} />}
      {wizard && designer && (
        <TemplateWizard start={wizard} designer={designer} onClose={() => setWizard(null)} onToast={onToast}
          onDesignerChanged={async () => setDesigner(await emailMarketingApi.designer())}
          onDone={async (message, createCampaign) => {
            setWizard(null); onToast(message); await load();
            if (createCampaign) onUseTemplate(createCampaign);
          }} />
      )}
    </div>
  );
}

function PreviewModal({ card, brand, footerNote, onClose, onUse }: { card: TCard; brand: string; footerNote?: string; onClose: () => void; onUse: () => void }) {
  const [mobile, setMobile] = useState(false);
  return (
    <ModalShell wide title={card.name} sub={card.subject ? `Subject: ${card.subject}` : card.hint} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Close</button><button type="button" onClick={onUse} className={btn.primary}>Use Template</button></>}>
      <div className="mb-3 flex items-center justify-center gap-1">
        <button type="button" aria-label="Desktop" onClick={() => setMobile(false)} className={`!min-h-0 rounded-lg p-2 ${!mobile ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><Monitor className="h-4 w-4" /></button>
        <button type="button" aria-label="Phone" onClick={() => setMobile(true)} className={`!min-h-0 rounded-lg p-2 ${mobile ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><Smartphone className="h-4 w-4" /></button>
      </div>
      <div className={`mx-auto ${mobile ? "max-w-[390px]" : ""}`}><EmailFrame design={card.design} mobile={mobile} fit brand={brand} footerNote={footerNote} preheader={card.preheader} /></div>
      <p className="m-0 mt-3 flex items-center justify-center gap-1.5 text-[12px] text-gray-500"><PartyPopper className="h-3.5 w-3.5" />Pictures and names come from your own products. Everything can be changed after Use Template.</p>
    </ModalShell>
  );
}
