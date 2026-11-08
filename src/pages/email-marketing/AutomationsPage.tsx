import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive, BarChart3, ChevronRight, Clock, Coins, Copy, Filter, LayoutGrid, Layers, List, Mail, MoreHorizontal, Pause, Pencil, Play, Plus, Search, Send, Target, Trash2, Undo2, Users, Zap
} from "lucide-react";
import { emailMarketingApi, type EmAutomationReport, type EmAutomationRow, type EmAutomationsPage, type EmDesigner } from "../../lib/api";
import { ModalShell } from "./AudiencePage";
import { Card, Delta, ErrorNote, IconTile, Loading, Pill, Toggle, btn, count, input, lagosDate, naira, pct, select } from "./em-ui";
import FlowDiagram, { TRIGGER_ICON } from "./FlowDiagram";
import { TestFlowModal } from "./NodeEditor";
import { TEMPLATE_ICON } from "./AutomationSteps";
import { TEMPLATES, USE_CASES, draftFromTemplate, durationText, goalText, triggerText } from "./automation-model";

/** Automations, built to Bright's design 50 (8 Nov 2026). */

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "green" }, paused: { label: "Paused", tone: "amber" }, draft: { label: "Draft", tone: "slate" }, archived: { label: "Archived", tone: "slate" }
};

export default function AutomationsPage({ onOpenWizard, onToast, refreshKey }: {
  onOpenWizard: (options: { id?: string; template?: string | null; step?: number }) => void;
  onToast: (message: string) => void;
  refreshKey: number;
}) {
  const [data, setData] = useState<EmAutomationsPage | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"all" | "uses">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState("post_purchase");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [report, setReport] = useState<string | null>(null);
  const [testing, setTesting] = useState<EmAutomationRow | null>(null);
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const page = await emailMarketingApi.automations();
      setData(page);
      setError("");
      setSelected((current) => (current && page.automations.some((row) => row.id === current) ? current : page.automations.find((row) => row.status === "active")?.id ?? page.automations[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message || "Could not load the automations.");
    }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const rows = useMemo(() => (data?.automations ?? [])
    .filter((row) => (status ? row.status === status : row.status !== "archived"))
    .filter((row) => !query.trim() || `${row.name} ${row.description} ${triggerText(row.trigger)}`.toLowerCase().includes(query.trim().toLowerCase())), [data, query, status]);
  const current = data?.automations.find((row) => row.id === selected) ?? null;
  const previewDraft = useMemo(() => draftFromTemplate(preview, null), [preview]);

  const act = async (row: EmAutomationRow, action: "launch" | "pause" | "resume" | "archive" | "unarchive" | "duplicate" | "delete") => {
    setBusy(true);
    try {
      if (action === "duplicate") { const { id } = await emailMarketingApi.duplicateAutomation(row.id); onToast(`Copied as a draft: "${row.name} (copy)".`); setSelected(id); }
      else if (action === "delete") {
        if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
        await emailMarketingApi.deleteAutomation(row.id); onToast("Automation deleted.");
      } else {
        await emailMarketingApi.automationAction(row.id, action);
        onToast(action === "pause" ? "Paused. Customers already in it wait where they are." : action === "archive" ? "Archived. Customers still in it were taken out." : action === "unarchive" ? "Back from the archive (paused)." : "Running.");
      }
      await load();
    } catch (err) {
      onToast((err as Error).message || "Could not change the automation.");
    } finally {
      setBusy(false);
    }
  };
  const openTest = async (row: EmAutomationRow) => {
    if (!designer) { try { setDesigner(await emailMarketingApi.designer()); } catch { /* the test window still works without it */ } }
    setTesting(row);
  };

  const k = data?.kpis;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Zap className="h-7 w-7" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Automations</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Set up automatic emails that run on customer actions to increase retention, repeat purchase, and LTV.</p>
        </div>
        <button type="button" onClick={() => onOpenWizard({ template: "post_purchase" })} className={`${btn.primary} !px-5 !py-3`}><Plus className="h-4 w-4" />New Automation</button>
      </div>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {k && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Kpi icon={Play} label="Active Automations" value={count(k.active)} />
          <Kpi icon={Mail} label="Emails Sent" value={count(k.sent.value)} chip={<Delta value={k.sent.change} />} note="Last 30 days" />
          <Kpi icon={Users} label="Customers Reached" value={count(k.reached.value)} chip={<Delta value={k.reached.change} />} note="Entered in 30 days" />
          <Kpi icon={Filter} label="Conversion Rate" value={pct(k.conversion.value)} chip={<Delta value={k.conversion.changePp} suffix="pp" />} note="Ordered after an email" />
          <Kpi icon={Coins} label="Revenue from Automations" value={naira(k.revenue.value)} chip={<Delta value={k.revenue.change} />} note="Delivered orders, 30 days" />
        </div>
      )}

      {data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
          <Card className="p-4">
            <h3 className="m-0 mb-3 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Layers className="h-5 w-5 text-[#5B3FD9]" />Automation Templates</h3>
            <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
              {([["all", "All Templates"], ["uses", "Use Cases"]] as const).map(([key, text]) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={`!min-h-0 rounded-lg py-2 text-[13.5px] font-semibold ${tab === key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 dark:text-slate-300"}`}>{text}</button>
              ))}
            </div>
            {tab === "all" ? (
              <div className="space-y-1">{TEMPLATES.map((row) => <TemplateRow key={row.key} row={row} on={!current && preview === row.key} onPreview={() => { setPreview(row.key); setSelected(null); }} onUse={() => onOpenWizard({ template: row.key })} />)}</div>
            ) : (
              <div className="space-y-3">
                {USE_CASES.map((useCase) => (
                  <div key={useCase.key}>
                    <div className="mb-1 text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{useCase.label}</div>
                    {TEMPLATES.filter((row) => row.useCase === useCase.key).map((row) => <TemplateRow key={row.key} row={row} on={!current && preview === row.key} onPreview={() => { setPreview(row.key); setSelected(null); }} onUse={() => onOpenWizard({ template: row.key })} />)}
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={() => onOpenWizard({ template: null })} className="!min-h-0 mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#C9BEF5] px-3 py-3 text-[14px] font-bold text-[#5B3FD9] hover:bg-[#F7F4FF]">
              <Plus className="h-4 w-4" />Create From Scratch
            </button>
          </Card>

          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-start gap-3">
              <IconTile><Zap className="h-5 w-5" /></IconTile>
              <div className="mr-auto min-w-0"><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Automation Builder</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Visualize and build your customer automation workflow.</p></div>
              {current ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onOpenWizard({ id: current.id, step: 3 })} className={btn.ghost}><Pencil className="h-4 w-4 text-[#5B3FD9]" />Edit</button>
                  <button type="button" onClick={() => void openTest(current)} className={btn.ghost}><Send className="h-4 w-4 text-[#5B3FD9]" />Test</button>
                  {current.status !== "archived" && (
                    <span className="inline-flex items-center gap-2 rounded-xl bg-[#5B3FD9] px-3 py-2 text-[14px] font-semibold text-white">
                      {current.status === "active" ? "Active" : current.status === "draft" ? "Draft" : "Paused"}
                      <Toggle on={current.status === "active"} label="Active" disabled={busy} onChange={(on) => void act(current, on ? (current.status === "draft" ? "launch" : "resume") : "pause")} />
                    </span>
                  )}
                </div>
              ) : <button type="button" onClick={() => onOpenWizard({ template: preview })} className={btn.primary}>Use This Template</button>}
            </div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,290px)]">
              <div className="max-h-[520px] overflow-auto rounded-xl bg-[radial-gradient(#E4DDFB_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(#334155_1px,transparent_1px)]">
                {current ? <FlowDiagram trigger={current.trigger} flow={current.workflow} /> : <FlowDiagram trigger={previewDraft.trigger} flow={previewDraft.workflow} />}
              </div>
              <div className="rounded-xl border border-gray-100 p-3 dark:border-slate-800">
                <h4 className="m-0 mb-2 flex items-center gap-2 text-[15.5px] font-bold text-gray-900 dark:text-slate-50"><Zap className="h-4 w-4 text-[#5B3FD9]" />Automation Details</h4>
                {current ? (
                  <div className="space-y-2.5">
                    <Detail label="Name" value={current.name} />
                    <Detail label="Goal" icon={Target} value={goalText(current.goal)} />
                    <Detail label="Trigger" value={triggerText(current.trigger)} icon={TRIGGER_ICON[current.trigger.kind]} />
                    <Detail label="Audience" icon={Users} value={`${current.audienceLabel}`} />
                    <div className="flex items-center justify-between gap-2 text-[13px]"><span className="font-semibold text-gray-700 dark:text-slate-300">Status</span><Pill tone={STATUS[current.status]?.tone ?? "slate"}>{STATUS[current.status]?.label ?? current.status}</Pill></div>
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <Mini icon={Mail} label="Emails in Flow" value={String(current.emails)} />
                      <Mini icon={Clock} label="Total Duration" value={durationText(current.durationDays)} />
                      <Mini icon={BarChart3} label="Conversion" value={pct(current.conversion)} />
                    </div>
                  </div>
                ) : (
                  <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">
                    {data.automations.length ? "Pick an automation below to see it here." : "No automations yet. This is the ready-made flow you picked on the left: press Use This Template to set it up."}
                  </p>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {data && (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <h3 className="m-0 mr-auto flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Users className="h-5 w-5 text-[#5B3FD9]" />Your Automations ({data.automations.filter((row) => row.status !== "archived").length})</h3>
            <label className="relative min-w-[200px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search automations..." className={`${input} !py-2 !pl-9`} /></label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className={`${select} !w-[150px] !py-2`} aria-label="Status">
              <option value="">All Status</option><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="archived">Archived</option>
            </select>
            <span className="inline-flex rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
              <button type="button" aria-label="List view" onClick={() => setView("list")} className={`!min-h-0 rounded-lg p-2 ${view === "list" ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><List className="h-4 w-4" /></button>
              <button type="button" aria-label="Grid view" onClick={() => setView("grid")} className={`!min-h-0 rounded-lg p-2 ${view === "grid" ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><LayoutGrid className="h-4 w-4" /></button>
            </span>
          </div>
          {rows.length === 0 && (
            <div className="px-4 pb-6 text-center text-[13.5px] text-gray-600 dark:text-slate-400">
              {data.automations.length ? "No automation matches." : "No automations yet. Pick a template on the left, or create one from scratch."}
            </div>
          )}
          {rows.length > 0 && view === "list" && (
            <div className="overflow-x-auto">
              <table className="!min-w-0 w-full min-w-[1000px] text-left text-[13px]">
                <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                  <th className="px-4 py-2.5">Automation Name</th><th className="px-2 py-2.5">Trigger</th><th className="px-2 py-2.5">Audience</th><th className="px-2 py-2.5">Emails</th>
                  <th className="px-2 py-2.5">Status</th><th className="px-2 py-2.5">Performance</th><th className="px-2 py-2.5 text-right">Revenue</th><th className="px-4 py-2.5 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {rows.map((row) => {
                    const Icon = TRIGGER_ICON[row.trigger.kind] ?? Zap;
                    return (
                      <tr key={row.id} onClick={() => setSelected(row.id)} className={`cursor-pointer border-b border-gray-100 last:border-0 dark:border-slate-800 ${selected === row.id ? "bg-[#F7F4FF] dark:bg-violet-500/10" : "hover:bg-gray-50/60 dark:hover:bg-slate-800/40"}`}>
                        <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><Icon className="h-5 w-5 shrink-0 text-[#5B3FD9]" /><span className="min-w-0"><span className="block max-w-[260px] truncate font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block max-w-[260px] truncate text-[12px] text-gray-500">{row.description || `${row.emails} ${row.emails === 1 ? "email" : "emails"}${row.durationDays > 0 ? ` over ${durationText(row.durationDays).toLowerCase()}` : ", all on the same day"}`}</span></span></span></td>
                        <td className="px-2 py-2.5"><Pill tone="purple">{triggerText(row.trigger)}</Pill></td>
                        <td className="px-2 py-2.5"><span className="block font-semibold text-gray-800 dark:text-slate-200">{row.audienceLabel}</span><span className="text-[12px] text-gray-500">({count(row.audienceCount)})</span></td>
                        <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1 font-semibold"><Mail className="h-4 w-4 text-[#5B3FD9]" />{row.emails}</span></td>
                        <td className="px-2 py-2.5"><Pill tone={STATUS[row.status]?.tone ?? "slate"}>{STATUS[row.status]?.label ?? row.status}</Pill></td>
                        <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1.5 font-bold">{pct(row.conversion)}<Delta value={row.conversionChangePp} suffix="pp" /></span><span className="block text-[11.5px] text-gray-500">{count(row.reached)} entered</span></td>
                        <td className="px-2 py-2.5 text-right font-bold">{naira(row.revenue)}</td>
                        <td className="px-4 py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                          <span className="inline-flex items-center gap-1">
                            <button type="button" aria-label={`Results of ${row.name}`} onClick={() => setReport(row.id)} className={btn.icon}><BarChart3 className="h-4 w-4 text-[#5B3FD9]" /></button>
                            <RowMenu row={row} disabled={busy} onEdit={() => onOpenWizard({ id: row.id })} onTest={() => void openTest(row)} onAct={(action) => void act(row, action)} />
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && view === "grid" && (
            <div className="grid gap-3 p-4 pt-0 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => {
                const Icon = TRIGGER_ICON[row.trigger.kind] ?? Zap;
                return (
                  <div key={row.id} onClick={() => setSelected(row.id)} className={`cursor-pointer rounded-xl border p-3 ${selected === row.id ? "border-[#8B74EE] bg-[#F7F4FF] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                    <div className="flex items-start gap-2"><Icon className="h-5 w-5 text-[#5B3FD9]" /><span className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-slate-50">{row.name}</span><Pill tone={STATUS[row.status]?.tone ?? "slate"}>{STATUS[row.status]?.label}</Pill></div>
                    <div className="mt-2 flex flex-wrap gap-1.5"><Pill tone="purple">{triggerText(row.trigger)}</Pill><Pill tone="slate">{row.emails} emails</Pill></div>
                    <div className="mt-2 flex items-center justify-between text-[12.5px] text-gray-600 dark:text-slate-400"><span>{count(row.reached)} entered · {pct(row.conversion)} converted</span><span className="font-bold text-gray-900 dark:text-slate-50">{naira(row.revenue)}</span></div>
                    <div className="mt-2 flex justify-end gap-1" onClick={(event) => event.stopPropagation()}>
                      <button type="button" aria-label={`Results of ${row.name}`} onClick={() => setReport(row.id)} className={btn.icon}><BarChart3 className="h-4 w-4 text-[#5B3FD9]" /></button>
                      <RowMenu row={row} disabled={busy} onEdit={() => onOpenWizard({ id: row.id })} onTest={() => void openTest(row)} onAct={(action) => void act(row, action)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {report && <AutomationReport id={report} onClose={() => setReport(null)} />}
      {testing && <TestFlowModal name={testing.name} flow={testing.workflow} designer={designer} onClose={() => setTesting(null)} onToast={onToast} />}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, chip, note }: { icon: typeof Mail; label: string; value: string; chip?: React.ReactNode; note?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <IconTile size="lg"><Icon className="h-6 w-6" /></IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug text-gray-600 dark:text-slate-400">{label}</div>
        <div className="flex flex-wrap items-center gap-x-2"><span className="text-[23px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value}</span>{chip}</div>
        {note && <div className="text-[11.5px] text-gray-500">{note}</div>}
      </div>
    </Card>
  );
}

function TemplateRow({ row, on, onPreview, onUse }: { row: (typeof TEMPLATES)[number]; on: boolean; onPreview: () => void; onUse: () => void }) {
  const Icon = TEMPLATE_ICON[row.icon] ?? Mail;
  return (
    <div className={`flex items-center gap-1 rounded-xl ${on ? "bg-[#F5F2FE] dark:bg-violet-500/10" : ""}`}>
      <button type="button" onClick={onPreview} className="!min-h-0 flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left">
        <Icon className="h-6 w-6 shrink-0 text-[#5B3FD9]" />
        <span className="min-w-0"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{row.hint}</span></span>
      </button>
      <button type="button" aria-label={`Use ${row.name}`} onClick={onUse} className="!min-h-0 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-[#EEEBFC] hover:text-[#5B3FD9]"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

const Detail = ({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof Mail }) => (
  <div className="text-[13px]">
    <div className="font-semibold text-gray-700 dark:text-slate-300">{label}</div>
    <div className="mt-0.5 flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-gray-900 dark:border-slate-700 dark:text-slate-100">{Icon && <Icon className="h-4 w-4 text-[#5B3FD9]" />}<span className="truncate">{value}</span></div>
  </div>
);
const Mini = ({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) => (
  <div className="rounded-lg border border-gray-100 px-1.5 py-2 text-center dark:border-slate-800">
    <Icon className="mx-auto h-4 w-4 text-[#5B3FD9]" /><div className="mt-0.5 text-[10.5px] leading-tight text-gray-600 dark:text-slate-400">{label}</div><div className="text-[15px] font-extrabold text-gray-900 dark:text-slate-50">{value}</div>
  </div>
);

function RowMenu({ row, disabled, onEdit, onTest, onAct }: { row: EmAutomationRow; disabled: boolean; onEdit: () => void; onTest: () => void; onAct: (action: "launch" | "pause" | "resume" | "archive" | "unarchive" | "duplicate" | "delete") => void }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [at]);
  const items: Array<{ key: string; label: string; icon: typeof Mail; run: () => void; danger?: boolean }> = [
    { key: "edit", label: "Edit", icon: Pencil, run: onEdit },
    { key: "test", label: "Test Flow", icon: Send, run: onTest },
    { key: "copy", label: "Duplicate", icon: Copy, run: () => onAct("duplicate") },
    ...(row.status === "active" ? [{ key: "pause", label: "Pause", icon: Pause, run: () => onAct("pause") }] : []),
    ...(row.status === "paused" ? [{ key: "resume", label: "Resume", icon: Play, run: () => onAct("resume") }] : []),
    ...(row.status === "draft" ? [{ key: "launch", label: "Launch", icon: Play, run: () => onAct("launch") }] : []),
    ...(row.status !== "archived" ? [{ key: "archive", label: "Archive", icon: Archive, run: () => onAct("archive") }] : [{ key: "unarchive", label: "Unarchive", icon: Undo2, run: () => onAct("unarchive") }]),
    ...(row.reached === 0 ? [{ key: "delete", label: "Delete", icon: Trash2, run: () => onAct("delete"), danger: true }] : [])
  ];
  return (
    <>
      <button ref={button} type="button" disabled={disabled} aria-label={`More for ${row.name}`} onClick={(event) => {
        event.stopPropagation();
        const rect = button.current!.getBoundingClientRect();
        setAt(at ? null : { top: rect.bottom + 4, left: Math.min(window.innerWidth - 190, rect.right - 180) });
      }} className={btn.icon}><MoreHorizontal className="h-4 w-4" /></button>
      {at && createPortal(
        <div style={{ top: at.top, left: at.left }} className="fixed z-[80] w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
          {items.map((item) => (
            <button key={item.key} type="button" onClick={() => { setAt(null); item.run(); }} className={`!min-h-0 flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800 ${item.danger ? "text-rose-600" : "text-gray-700 dark:text-slate-200"}`}>
              <item.icon className="h-4 w-4" />{item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

/** The results of one automation: who is where, and each email's numbers. */
function AutomationReport({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<EmAutomationReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { emailMarketingApi.automationReport(id).then(setData).catch((err) => setError((err as Error).message || "Could not load the results.")); }, [id]);
  return (
    <ModalShell wide title={data ? `Results: ${data.automation.name}` : "Results"} sub={data ? `${triggerText(data.automation.trigger)} · ${goalText(data.automation.goal)}` : undefined} onClose={onClose}
      footer={<button type="button" onClick={onClose} className={btn.primary}>Close</button>}>
      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([["Entered", data.runs.total], ["In the flow now", data.runs.active], ["Finished", data.runs.completed], ["Left early", data.runs.exited]] as Array<[string, number]>).map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-100 p-3 text-center dark:border-slate-800"><div className="text-[22px] font-extrabold text-gray-900 dark:text-slate-50">{count(value)}</div><div className="text-[12px] text-gray-600 dark:text-slate-400">{label}</div></div>
            ))}
          </div>
          {data.exitReasons.length > 0 && <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Left early: {data.exitReasons.map((row) => `${row.reason} (${row.count})`).join(" · ")}</p>}
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[640px] text-left text-[13px]">
              <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40">
                <th className="px-3 py-2">Email</th><th className="px-2 py-2 text-right">Sent</th><th className="px-2 py-2 text-right">Waiting</th><th className="px-2 py-2 text-right">Opened</th><th className="px-2 py-2 text-right">Clicked</th><th className="px-2 py-2 text-right">Orders</th><th className="px-3 py-2 text-right">Revenue</th>
              </tr></thead>
              <tbody>
                {data.emails.map((row) => (
                  <tr key={row.stepId} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2"><span className="block font-semibold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block max-w-[260px] truncate text-[12px] text-gray-500">{row.subject}</span></td>
                    <td className="px-2 py-2 text-right">{count(row.sent)}</td><td className="px-2 py-2 text-right">{count(row.waiting)}</td>
                    <td className="px-2 py-2 text-right">{pct(row.openRate)}</td><td className="px-2 py-2 text-right">{pct(row.clickRate)}</td>
                    <td className="px-2 py-2 text-right">{count(row.orders)}</td><td className="px-3 py-2 text-right font-bold">{naira(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h4 className="m-0 mb-1.5 text-[14px] font-bold text-gray-900 dark:text-slate-50">Latest customers</h4>
            {!data.recent.length && <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Nobody has entered yet. Customers enter when the trigger happens after launch.</p>}
            <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
              {data.recent.map((row, index) => (
                <li key={index} className="flex flex-wrap items-center gap-2 py-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate font-semibold text-gray-900 dark:text-slate-50">{row.name || row.email}<span className="ml-1.5 font-normal text-gray-500">{row.email}</span></span>
                  <span className="text-gray-600 dark:text-slate-400">{row.status === "active" ? `Next: ${row.stepName ?? "—"}${row.nextAt ? ` (${lagosDate(row.nextAt, true)})` : ""}` : row.status === "completed" ? "Finished" : `Left: ${row.exitReason ?? "—"}`}</span>
                  <span className="text-[12px] text-gray-500">entered {lagosDate(row.enteredAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
