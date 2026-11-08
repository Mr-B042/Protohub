import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, ArrowRight, Check, ClipboardList, FileText, LayoutGrid, Layers, Lock, Megaphone, Monitor, Rocket, Save, Search, Send, Settings, Smartphone, Tag, Users, X,
  type LucideIcon
} from "lucide-react";
import { emailMarketingApi, type EmDesigner, type EmTemplateType } from "../../lib/api";
import { STARTER_LAYOUTS, STARTER_TEMPLATES, TEMPLATE_CATEGORIES, buildStarterDesign, type EmailDesign } from "../../lib/email-render";
import type { StartTemplate } from "./CampaignWizard";
import EmailFrame from "./EmailFrame";
import TemplateCover from "./TemplateCover";
import StepDesign from "./StepDesign";
import { ErrorNote, btn, input, select } from "./em-ui";

import { fieldsFor, newDraft, type Draft } from "./wizard-model";

/**
 * Create Custom Template (Bright's design, 8 Nov 2026): details, layout,
 * design (the same editor as Create Campaign) and settings. A template is a
 * saved email design with a category, a default subject and who can use it.
 * No AI (Bright's rule).
 */

export type TemplateWizardStart = {
  id: string | null; name: string; category: string; description: string; templateType: EmTemplateType; visibility: "team" | "private";
  subject: string; preheader: string; design: EmailDesign | null; layout: string | null; step: 1 | 3;
};

const STEPS = ["Template Details", "Choose Layout", "Design Content", "Settings & Save"];
const TYPES: Array<{ key: EmTemplateType; label: string; hint: string; icon: LucideIcon }> = [
  { key: "promotional", label: "Promotional", hint: "Product offers, deals, and sales", icon: Tag },
  { key: "retention", label: "Retention", hint: "Re-engage and keep customers active", icon: Users },
  { key: "transactional", label: "Transactional", hint: "Order, delivery, and account updates", icon: ClipboardList },
  { key: "announcement", label: "Announcement", hint: "News, updates, and important information", icon: Megaphone }
];
const QUICK = ["promo_offer", "order_confirmation", "cart_reminder", "win_back_offer", "welcome_email", "new_arrival"];
const typeOf = (layout: string) => STARTER_TEMPLATES.find((row) => row.key === layout)?.type ?? "promotional";

export default function TemplateWizard({ start, designer, onClose, onDone, onToast, onDesignerChanged }: {
  start: TemplateWizardStart; designer: EmDesigner; onClose: () => void; onToast: (message: string) => void; onDesignerChanged: () => Promise<void>;
  onDone: (message: string, createCampaign?: StartTemplate) => Promise<void>;
}) {
  const fields = useMemo(() => fieldsFor(newDraft(designer), designer), [designer]);
  const [step, setStep] = useState<number>(start.step);
  const [form, setForm] = useState({ name: start.name, category: start.category, description: start.description, templateType: start.templateType, visibility: start.visibility, subject: start.subject, preheader: start.preheader });
  const [layout, setLayout] = useState<string | null>(start.layout);
  const [draft, setDraft] = useState<Draft>(() => ({ ...newDraft(designer), design: start.design ?? buildStarterDesign(start.layout ?? "promo_offer", fields) }));
  const [designLayout, setDesignLayout] = useState<string | null>(start.design ? null : start.layout);
  const [quickTab, setQuickTab] = useState<"template" | "blank">(start.layout === "blank" ? "blank" : "template");
  const [layoutTab, setLayoutTab] = useState<string>("all");
  const [layoutQuery, setLayoutQuery] = useState("");
  const [saveAs, setSaveAs] = useState<"template" | "draft" | "campaign">("template");
  const [mobile, setMobile] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((current) => ({ ...current, ...patch }));
  const label = "block text-[14px] font-bold text-gray-900 dark:text-slate-100";

  const pickLayout = (key: string) => {
    setLayout(key);
    if (!start.id && !form.name) set({ templateType: typeOf(key) });
  };
  const go = (next: number) => {
    setError("");
    if (next > 1 && (!form.name.trim() || !form.category)) { setError("Give the template a name and a category."); setStep(1); return; }
    // A new layout replaces the design (after a warning if it was changed by hand).
    if (next === 3 && layout && layout !== designLayout) {
      if (designLayout !== null && draft.design.touched && step === 2 && !window.confirm("Switch layout? Changes made in Design Content will be replaced.")) { setLayout(designLayout); }
      else { setDraft((current) => ({ ...current, design: buildStarterDesign(layout, fields) })); setDesignLayout(layout); }
    }
    setStep(next);
  };

  const save = async () => {
    setError("");
    if (!form.name.trim()) { setError("Give the template a name."); return; }
    setBusy(true);
    try {
      const body = { ...form, name: form.name.trim(), status: saveAs === "draft" ? "draft" as const : "ready" as const, design: draft.design };
      const id = start.id ? (await emailMarketingApi.updateTemplate(start.id, body)).id : (await emailMarketingApi.createTemplate(body)).id;
      await onDone(saveAs === "draft" ? "Saved as a draft." : start.id ? "Template saved." : `"${body.name}" saved to your templates.`,
        saveAs === "campaign" ? { key: `saved:${id}`, name: body.name, design: draft.design, subject: body.subject, preheader: body.preheader } : undefined);
    } catch (err) { setError((err as Error).message || "Could not save the template."); setBusy(false); }
  };

  const layouts = STARTER_LAYOUTS
    .filter((row) => layoutTab === "all" || typeOf(row.key) === layoutTab)
    .filter((row) => !layoutQuery.trim() || `${row.name} ${row.hint}`.toLowerCase().includes(layoutQuery.trim().toLowerCase()));
  const thumb = (key: string, height = 120) => <div className="overflow-hidden rounded-lg"><TemplateCover design={buildStarterDesign(key, fields)} name={key} brand={fields.brand} height={height} small={height < 130} /></div>;

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/55 p-2 sm:p-5">
      <div className="flex h-full max-h-[940px] w-full max-w-[1320px] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center gap-4 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#7C5CFF] to-[#5B3FD9] text-white"><Layers className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[24px] font-extrabold text-gray-900 dark:text-slate-50">{start.id ? "Edit Template" : "Create Custom Template"}</h2>
            <p className="m-0 text-[14px] text-gray-600 dark:text-slate-400">Design and save a reusable email template for your campaigns, automations, and follow-ups.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={btn.icon}><X className="h-5 w-5" /></button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="shrink-0 border-b border-gray-100 p-4 md:w-[230px] md:border-b-0 md:border-r dark:border-slate-800">
            <h3 className="m-0 mb-3 hidden text-[18px] font-bold text-gray-900 md:block dark:text-slate-50">Template Setup</h3>
            <ol className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 md:flex-col">
              {STEPS.map((name, index) => {
                const n = index + 1, on = step === n, done = step > n;
                return (
                  <li key={name}>
                    <button type="button" onClick={() => go(n)} className={`!min-h-0 flex w-full items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-[14px] font-bold ${on ? "bg-[#5B3FD9] text-white" : "text-gray-800 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                      <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] ${on ? "bg-white text-[#5B3FD9]" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300"}`}>{n}</span>
                      <span className="flex-1">{name}</span>
                      {done && <Check className="h-4 w-4 text-[#5B3FD9]" />}
                    </button>
                  </li>
                );
              })}
            </ol>
          </aside>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <ErrorNote message={error} />
            {step === 1 && (
              <div className="grid gap-4 xl:grid-cols-2">
                <section className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                  <div><h3 className="m-0 text-[20px] font-bold text-gray-900 dark:text-slate-50">Template Details</h3><p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Set the basic information for your template.</p></div>
                  <label className={label}>Template Name <span className="text-rose-500">*</span><input value={form.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} placeholder="e.g., Product Promotion, Order Follow-up" className={`${input} mt-1.5`} /></label>
                  <label className={label}>Category <span className="text-rose-500">*</span>
                    <select value={form.category} onChange={(event) => set({ category: event.target.value })} className={`${select} mt-1.5`}>
                      {TEMPLATE_CATEGORIES.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}<option value="custom">Other</option>
                    </select>
                  </label>
                  <label className={label}>Description (Optional)
                    <textarea rows={3} value={form.description} maxLength={200} onChange={(event) => set({ description: event.target.value })} placeholder="A short note about this template (e.g., Used for product offers and promotions)." className={`${input} mt-1.5`} />
                    <span className="block text-right text-[12px] font-normal text-gray-500">{form.description.length}/200</span>
                  </label>
                  <div>
                    <div className={label}>Template Type</div>
                    <p className="m-0 mb-2 text-[13px] text-gray-600 dark:text-slate-400">Choose what this template is mainly for.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {TYPES.map((row) => {
                        const on = form.templateType === row.key;
                        return (
                          <button key={row.key} type="button" aria-pressed={on} onClick={() => set({ templateType: row.key })} className={`!min-h-0 flex items-start gap-2.5 rounded-xl border p-3 text-left ${on ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                            <row.icon className="mt-0.5 h-5 w-5 shrink-0 text-[#5B3FD9]" />
                            <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.label}</span><span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{row.hint}</span></span>
                            <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 rounded-full border-2 ${on ? "border-[#5B3FD9] bg-[#5B3FD9] shadow-[inset_0_0_0_2px_white]" : "border-gray-300"}`} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
                <section className="space-y-3 rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                  <div><h3 className="m-0 text-[20px] font-bold text-gray-900 dark:text-slate-50">Quick Start <span className="text-[14px] font-normal text-gray-500">(Optional)</span></h3><p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Use a starting point to speed up your design.</p></div>
                  <div className="grid grid-cols-2 rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
                    <button type="button" onClick={() => { setQuickTab("template"); if (layout === "blank") pickLayout("promo_offer"); }} className={`!min-h-0 rounded-lg py-2 text-[14px] font-semibold ${quickTab === "template" ? "bg-[#5B3FD9] text-white" : "text-gray-700 dark:text-slate-300"}`}>Start from Template</button>
                    <button type="button" onClick={() => { setQuickTab("blank"); pickLayout("blank"); }} className={`!min-h-0 rounded-lg py-2 text-[14px] font-semibold ${quickTab === "blank" ? "bg-[#5B3FD9] text-white" : "text-gray-700 dark:text-slate-300"}`}>Start Blank</button>
                  </div>
                  {start.id && <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Picking a starting point here replaces this template's current design.</p>}
                  {quickTab === "template" ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {QUICK.map((key) => {
                        const row = STARTER_TEMPLATES.find((item) => item.key === key)!;
                        const on = layout === key;
                        return (
                          <button key={key} type="button" aria-pressed={on} onClick={() => pickLayout(key)} className={`!min-h-0 relative rounded-xl border p-1.5 text-center ${on ? "border-[#5B3FD9] ring-2 ring-[#5B3FD9]/20" : "border-gray-200 dark:border-slate-700"}`}>
                            {on && <span className="absolute right-2 top-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#5B3FD9] text-white"><Check className="h-3 w-3" /></span>}
                            {thumb(key, 110)}
                            <span className={`mt-1.5 block text-[12.5px] font-bold ${on ? "text-[#5B3FD9]" : "text-gray-800 dark:text-slate-200"}`}>{row.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : <p className="m-0 rounded-xl bg-gray-50 px-3 py-6 text-center text-[13.5px] text-gray-600 dark:bg-slate-800/50 dark:text-slate-400">You'll start with just your logo, one line of text and the footer.</p>}
                </section>
              </div>
            )}

            {step === 2 && (
              <section>
                <div className="mb-3 flex items-center gap-3"><LayoutGrid className="h-8 w-8 text-[#5B3FD9]" /><div><h3 className="m-0 text-[22px] font-bold text-gray-900 dark:text-slate-50">Choose Layout</h3><p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Select a pre-designed layout that fits your message, or start with a blank canvas.</p></div></div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {[{ key: "all", label: "All Layouts" }, ...TYPES.map((row) => ({ key: row.key, label: row.label }))].map((row) => {
                    const n = STARTER_LAYOUTS.filter((item) => row.key === "all" || typeOf(item.key) === row.key).length;
                    return <button key={row.key} type="button" onClick={() => setLayoutTab(row.key)} className={`!min-h-0 rounded-xl border px-3 py-2 text-[13px] font-semibold ${layoutTab === row.key ? "border-[#5B3FD9] bg-[#5B3FD9] text-white" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{row.label} ({n})</button>;
                  })}
                  <label className="relative ml-auto min-w-[200px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={layoutQuery} onChange={(event) => setLayoutQuery(event.target.value)} placeholder="Search layouts..." className={`${input} !py-2 !pl-9`} /></label>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {layouts.map((row) => {
                    const on = layout === row.key;
                    return (
                      <button key={row.key} type="button" aria-pressed={on} onClick={() => pickLayout(row.key)} className={`!min-h-0 relative rounded-2xl border p-2 text-left ${on ? "border-[#5B3FD9] ring-2 ring-[#5B3FD9]/20" : "border-gray-200 dark:border-slate-700"}`}>
                        <span className={`absolute right-3 top-3 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border-2 ${on ? "border-[#5B3FD9] bg-[#5B3FD9] text-white" : "border-gray-300 bg-white"}`}>{on && <Check className="h-3 w-3" />}</span>
                        {thumb(row.key, 150)}
                        <span className="mt-2 block text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.name}</span>
                        <span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{row.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {step === 3 && (
              <StepDesign draft={draft} designer={designer} onToast={onToast} onDesignerChanged={onDesignerChanged}
                onChange={(patch) => setDraft((current) => ({ ...current, ...patch, design: patch.design ? { ...patch.design, touched: true } : current.design }))}
                onSendTest={() => onToast("Save the template, then use it in a campaign to send yourself a test.")} />
            )}

            {step === 4 && (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                <section className="space-y-4 rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                  <h3 className="m-0 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Settings className="h-5 w-5 text-[#5B3FD9]" />Template Settings</h3>
                  <label className={label}>Template Name <span className="text-rose-500">*</span><input value={form.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} className={`${input} mt-1.5`} /></label>
                  <label className={label}>Template Category <span className="text-rose-500">*</span>
                    <select value={form.category} onChange={(event) => set({ category: event.target.value })} className={`${select} mt-1.5`}>{TEMPLATE_CATEGORIES.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}<option value="custom">Other</option></select>
                  </label>
                  <div>
                    <div className={label}>Template Visibility</div>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                      {([["team", "Team (Shared)", "Available for all team members", Users], ["private", "Private", "Only you can use and edit", Lock]] as const).map(([key, title, hint, Icon]) => {
                        const on = form.visibility === key;
                        return (
                          <button key={key} type="button" aria-pressed={on} onClick={() => set({ visibility: key })} className={`!min-h-0 flex items-start gap-2.5 rounded-xl border p-3 text-left ${on ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#5B3FD9]" /><span className="flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{title}</span><span className="block text-[12px] text-gray-600 dark:text-slate-400">{hint}</span></span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className={label}>Default Subject Line (Optional)
                    <input value={form.subject} maxLength={200} onChange={(event) => set({ subject: event.target.value })} placeholder="e.g., Upgrade your home today, {{First Name}}" className={`${input} mt-1.5`} />
                    <span className="block text-[12px] font-normal text-gray-500">{"{{First Name}}"} and {"{{Product}}"} are filled in for each campaign.</span>
                  </label>
                  <div className="border-t border-gray-100 pt-3 dark:border-slate-800">
                    <div className={label}>Email Preferences</div>
                    {[["Mobile Optimization", "Every email fits phones by itself."], ["Track Performance", "Opens, clicks and orders are counted for every campaign."], ["Unsubscribe Link", "Always added: the law requires it and it keeps you out of spam."]].map(([title, hint]) => (
                      <div key={title} className="mt-2 flex items-center gap-3"><span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold text-gray-900 dark:text-slate-100">{title}</span><span className="block text-[12px] text-gray-600 dark:text-slate-400">{hint}</span></span><span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[12px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Always on</span></div>
                    ))}
                    <label className={`${label} mt-3`}>Preheader Text <span className="font-normal text-gray-500">(shown next to the subject in the inbox)</span>
                      <span className="mt-1.5 flex items-center gap-2"><input value={form.preheader} maxLength={120} onChange={(event) => set({ preheader: event.target.value })} placeholder="e.g., Order today and pay when it arrives" className={input} /><span className="w-14 shrink-0 text-right text-[12px] font-normal text-gray-500">{form.preheader.length}/120</span></span>
                    </label>
                  </div>
                </section>
                <div className="space-y-4">
                  <section className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="m-0 mr-auto text-[18px] font-bold text-gray-900 dark:text-slate-50">Template Preview</h3>
                      <button type="button" aria-label="Desktop" onClick={() => setMobile(false)} className={`!min-h-0 rounded-lg p-2 ${!mobile ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><Monitor className="h-4 w-4" /></button>
                      <button type="button" aria-label="Phone" onClick={() => setMobile(true)} className={`!min-h-0 rounded-lg p-2 ${mobile ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><Smartphone className="h-4 w-4" /></button>
                    </div>
                    <div className={`max-h-[360px] overflow-y-auto rounded-xl bg-[#F4F1FE] dark:bg-slate-800 ${mobile ? "mx-auto max-w-[360px]" : ""}`}><EmailFrame design={draft.design} mobile={mobile} fit brand={fields.brand} preheader={form.preheader} /></div>
                  </section>
                  <section className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                    <h3 className="m-0 mb-2 text-[18px] font-bold text-gray-900 dark:text-slate-50">Save Options</h3>
                    {([["template", Save, "Save as Template", "Save and use this template for future campaigns."], ["draft", FileText, "Save as Draft", "Keep as a draft to edit later."], ["campaign", Send, "Save & Create Campaign", "Save this template and start a new campaign with it."]] as const).map(([key, Icon, title, hint]) => {
                      const on = saveAs === key;
                      return (
                        <button key={key} type="button" aria-pressed={on} onClick={() => setSaveAs(key)} className={`!min-h-0 mb-2 flex w-full items-center gap-3 rounded-xl border p-3 text-left ${on ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                          <Icon className="h-5 w-5 shrink-0 text-[#5B3FD9]" /><span><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{title}</span><span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{hint}</span></span>
                        </button>
                      );
                    })}
                  </section>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-3.5 dark:border-slate-800">
          <button type="button" onClick={onClose} className={`${btn.ghost} mr-auto !px-6`}>Cancel</button>
          <button type="button" disabled={step === 1} onClick={() => go(step - 1)} className={`${btn.ghost} !px-5`}><ArrowLeft className="h-4 w-4" />Previous</button>
          {step < 4 ? (
            <button type="button" onClick={() => go(step + 1)} className={`${btn.primary} !px-6`}>{step === 3 ? "Continue to Settings" : "Continue to " + (step === 1 ? "Layout" : "Design")}<ArrowRight className="h-4 w-4" /></button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void save()} className={`${btn.primary} !px-6`}>
              {saveAs === "campaign" ? <Rocket className="h-4 w-4" /> : saveAs === "draft" ? <FileText className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {busy ? "Saving…" : saveAs === "campaign" ? "Save & Create Campaign" : saveAs === "draft" ? "Save Draft" : "Save Template"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
