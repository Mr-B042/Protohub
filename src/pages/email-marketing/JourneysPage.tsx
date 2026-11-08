import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive, BadgeCheck, BarChart3, ChevronLeft, ChevronRight, Coins, Filter, Gift, Layers, Mail, Map as MapIcon, Pause, Play, Plus, Search, Send, ShieldCheck, ShoppingCart, Tag,
  Upload, UserPlus, Users, X
} from "lucide-react";
import { emailMarketingApi, type EmAutomationRow, type EmAutomationsPage, type EmDesigner, type EmStage } from "../../lib/api";
import { Card, Delta, ErrorNote, IconTile, Loading, Pill, btn, count, input, naira, pct, select } from "./em-ui";
import FlowDiagram, { TRIGGER_ICON } from "./FlowDiagram";
import { TestFlowModal } from "./NodeEditor";
import { TEMPLATE_ICON } from "./AutomationSteps";
import { AutomationReport, Kpi, RowMenu, STATUS } from "./AutomationsPage";
import { CardHead, Legend, SERIES, TrendChart } from "./health-ui";
import { GOAL_PILL, STAGES, TEMPLATES, allNodes } from "./automation-model";

/**
 * Customer Journey, built to Bright's design 53 (8 Nov 2026): the same
 * automated flows as Automations, grouped by the customer's stage, with the
 * last 30 days' results. New Journey opens the same 4-step window.
 */

const STAGE_ICON: Record<EmStage, typeof Mail> = {
  acquisition: UserPlus, nurture: Tag, conversion: ShieldCheck, retention: BadgeCheck, winback: ShoppingCart, post_purchase: Gift
};
const PER_PAGE = 5;

export default function JourneysPage({ onOpenWizard, onToast, refreshKey }: {
  onOpenWizard: (options: { id?: string; template?: string | null; step?: number }) => void;
  onToast: (message: string) => void;
  refreshKey: number;
}) {
  const [data, setData] = useState<EmAutomationsPage | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<EmStage | "all">("all");
  const [query, setQuery] = useState("");
  const [goal, setGoal] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [testing, setTesting] = useState<EmAutomationRow | null>(null);
  const [designer, setDesigner] = useState<EmDesigner | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await emailMarketingApi.automations();
      setData(next);
      setError("");
      setSelected((current) => (current && next.automations.some((row) => row.id === current) ? current : next.automations.find((row) => row.status === "active")?.id ?? next.automations[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message || "Could not load the journeys.");
    }
  }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { setPage(1); }, [stage, query, goal, status]);

  const live = useMemo(() => (data?.automations ?? []).filter((row) => row.status !== "archived"), [data]);
  const rows = useMemo(() => (data?.automations ?? [])
    .filter((row) => (status ? row.status === status : row.status !== "archived"))
    .filter((row) => stage === "all" || row.stage === stage)
    .filter((row) => !goal || (GOAL_PILL[row.goal]?.label ?? row.goal) === goal)
    .filter((row) => !query.trim() || `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase())), [data, stage, goal, status, query]);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const current = data?.automations.find((row) => row.id === selected) ?? null;
  const goals = [...new Set(Object.values(GOAL_PILL).map((row) => row.label))];

  const act = async (row: EmAutomationRow, action: "launch" | "pause" | "resume" | "archive" | "unarchive" | "duplicate" | "delete") => {
    setBusy(true);
    try {
      if (action === "duplicate") { const { id } = await emailMarketingApi.duplicateAutomation(row.id); onToast(`Copied as a draft: "${row.name} (copy)".`); setSelected(id); }
      else if (action === "delete") {
        if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
        await emailMarketingApi.deleteAutomation(row.id); onToast("Deleted.");
      } else {
        await emailMarketingApi.automationAction(row.id, action);
        onToast(action === "pause" ? "Paused. Customers already in it wait where they are." : action === "archive" ? "Archived." : action === "unarchive" ? "Back from the archive (paused)." : "Running.");
      }
      await load();
    } catch (err) {
      onToast((err as Error).message || "Could not change it.");
    } finally {
      setBusy(false);
    }
  };
  /** The bar over the list: the same change for every ticked row that allows it. */
  const bulk = async (action: "pause" | "resume" | "archive") => {
    const targets = (data?.automations ?? []).filter((row) => checked.includes(row.id) && (action === "pause" ? row.status === "active" : action === "resume" ? row.status === "paused" : row.status !== "archived"));
    if (!targets.length) { onToast(action === "pause" ? "None of the ticked ones is running." : action === "resume" ? "None of the ticked ones is paused." : "Nothing to archive."); return; }
    setBusy(true);
    const failed: string[] = [];
    for (const row of targets) { try { await emailMarketingApi.automationAction(row.id, action); } catch (err) { failed.push(`${row.name}: ${(err as Error).message}`); } }
    setBusy(false);
    setChecked([]);
    onToast(failed.length ? `Done, except: ${failed.join(" ")}` : `${targets.length} ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "archived"}.`);
    await load();
  };
  const openTest = async (row: EmAutomationRow) => {
    if (!designer) { try { setDesigner(await emailMarketingApi.designer()); } catch { /* the test window still works without it */ } }
    setTesting(row);
  };

  const k = data?.kpis;
  const j = data?.journey;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><MapIcon className="h-7 w-7" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Customer Journey</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Design and manage automated customer journeys across the entire customer lifecycle.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenWizard({ template: "post_purchase", step: 1 })} className={`${btn.ghost} !px-5 !py-3`}><Upload className="h-4 w-4 text-[#5B3FD9]" />Journey Templates</button>
          <button type="button" onClick={() => onOpenWizard({ template: null, step: 1 })} className={`${btn.primary} !px-5 !py-3`}><Plus className="h-4 w-4" />New Journey</button>
        </div>
      </div>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {k && j && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi icon={Send} label="Active Journeys" value={count(k.active)} />
          <Kpi icon={Users} label="Customers in Journey" value={count(j.inFlow.value)} chip={<Delta value={j.inFlow.change} />} note="In a flow right now" />
          <Kpi icon={Filter} label="Avg. Conversion Rate" value={pct(k.conversion.value)} chip={<Delta value={k.conversion.changePp} suffix="pp" />} note="Ordered after an email, 30 days" />
          <Kpi icon={ShoppingCart} label="Revenue from Journeys" value={naira(k.revenue.value)} chip={<Delta value={k.revenue.change} />} note="Delivered orders, 30 days" />
        </div>
      )}

      {data && (
        <>
          <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900" aria-label="Customer stages">
            <button type="button" onClick={() => setStage("all")} aria-current={stage === "all" ? "page" : undefined}
              className={`!min-h-0 inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2.5 text-[13.5px] font-semibold xl:flex-auto xl:justify-center ${stage === "all" ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
              <Layers className="h-4 w-4" />All Journeys ({live.length})
            </button>
            {STAGES.map((row) => {
              const Icon = STAGE_ICON[row.key];
              const n = live.filter((item) => item.stage === row.key).length;
              return (
                <button key={row.key} type="button" onClick={() => setStage(row.key)} aria-current={stage === row.key ? "page" : undefined}
                  className={`!min-h-0 inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2.5 text-[13.5px] font-semibold xl:flex-auto xl:justify-center ${stage === row.key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                  <Icon className="h-4 w-4" />{row.label}{n ? <span className={`rounded-md px-1.5 text-[11.5px] ${stage === row.key ? "bg-white/20" : "bg-gray-100 dark:bg-slate-800"}`}>{n}</span> : null}
                </button>
              );
            })}
          </nav>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(0,1fr)]">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 p-4">
                <label className="relative min-w-[200px] flex-[2]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search journeys..." className={`${input} !py-2 !pl-9`} /></label>
                <select value={goal} onChange={(event) => setGoal(event.target.value)} className={`${select} !w-[150px] !py-2`} aria-label="Goal"><option value="">All Goals</option>{goals.map((label) => <option key={label} value={label}>{label}</option>)}</select>
                <select value={status} onChange={(event) => setStatus(event.target.value)} className={`${select} !w-[140px] !py-2`} aria-label="Status">
                  <option value="">All Status</option><option value="active">Active</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="archived">Archived</option>
                </select>
              </div>
              {checked.length > 0 && (
                <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#F5F2FE] px-3 py-2 text-[13px] dark:bg-violet-500/10">
                  <span className="mr-auto font-semibold text-gray-800 dark:text-slate-200">{checked.length} selected</span>
                  <button type="button" disabled={busy} onClick={() => void bulk("pause")} className={btn.outline}><Pause className="h-3.5 w-3.5" />Pause</button>
                  <button type="button" disabled={busy} onClick={() => void bulk("resume")} className={btn.outline}><Play className="h-3.5 w-3.5" />Resume</button>
                  <button type="button" disabled={busy} onClick={() => void bulk("archive")} className={btn.outline}><Archive className="h-3.5 w-3.5" />Archive</button>
                  <button type="button" aria-label="Clear the selection" onClick={() => setChecked([])} className={btn.icon}><X className="h-4 w-4" /></button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="!min-w-0 w-full min-w-[720px] text-left text-[13px]">
                  <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                    <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Select all on this page" className="h-4 w-4 accent-[#5B3FD9]" checked={shown.length > 0 && shown.every((row) => checked.includes(row.id))}
                      onChange={(event) => setChecked(event.target.checked ? [...new Set([...checked, ...shown.map((row) => row.id)])] : checked.filter((id) => !shown.some((row) => row.id === id)))} /></th>
                    <th className="px-2 py-2.5">Journey Name</th><th className="px-2 py-2.5">Goal</th><th className="px-1.5 py-2.5 text-right">Steps</th><th className="px-1.5 py-2.5 text-right">Audience</th>
                    <th className="px-1.5 py-2.5 text-right">Conversion</th><th className="px-2 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Actions</th>
                  </tr></thead>
                  <tbody>
                    {shown.length === 0 && (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600 dark:text-slate-400">
                        {live.length ? "No journey matches." : <>No journeys yet. <button type="button" onClick={() => onOpenWizard({ template: "post_purchase", step: 1 })} className="!min-h-0 font-semibold text-[#5B3FD9] hover:underline">Start from a template</button>.</>}
                      </td></tr>
                    )}
                    {shown.map((row) => {
                      const template = TEMPLATES.find((item) => item.key === row.template);
                      const Icon = (template && TEMPLATE_ICON[template.icon]) || TRIGGER_ICON[row.trigger.kind] || MapIcon;
                      const pill = GOAL_PILL[row.goal] ?? { label: row.goal, tone: "slate" };
                      return (
                        <tr key={row.id} onClick={() => setSelected(row.id)} className={`cursor-pointer border-b border-gray-100 last:border-0 dark:border-slate-800 ${selected === row.id ? "bg-[#F7F4FF] dark:bg-violet-500/10" : "hover:bg-gray-50/60 dark:hover:bg-slate-800/40"}`}>
                          <td className="px-4 py-2.5" onClick={(event) => event.stopPropagation()}>
                            <input type="checkbox" aria-label={`Select ${row.name}`} className="h-4 w-4 accent-[#5B3FD9]" checked={checked.includes(row.id)} onChange={(event) => setChecked(event.target.checked ? [...checked, row.id] : checked.filter((id) => id !== row.id))} />
                          </td>
                          <td className="px-2 py-2.5"><span className="flex items-center gap-2.5"><IconTile size="sm"><Icon className="h-4 w-4" /></IconTile><span className="min-w-0"><span className="block max-w-[200px] truncate font-bold text-gray-900 dark:text-slate-50" title={row.name}>{row.name}</span><span className="block max-w-[200px] truncate text-[12px] text-gray-500">{row.description || STAGES.find((item) => item.key === row.stage)?.label}</span></span></span></td>
                          <td className="px-2 py-2.5"><Pill tone={pill.tone}>{pill.label}</Pill></td>
                          <td className="px-2 py-2.5 text-right font-semibold">{allNodes(row.workflow.nodes).length}</td>
                          <td className="px-2 py-2.5 text-right">{count(row.audienceCount)}</td>
                          <td className="px-2 py-2.5 text-right font-bold">{pct(row.conversion)}</td>
                          <td className="px-2 py-2.5"><Pill tone={STATUS[row.status]?.tone ?? "slate"}>{STATUS[row.status]?.label ?? row.status}</Pill></td>
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
              {rows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px] text-gray-600 dark:text-slate-400">
                  <span>Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, rows.length)} of {rows.length} {rows.length === 1 ? "journey" : "journeys"}</span>
                  <span className="flex items-center gap-1">
                    <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
                    {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.max(0, page - 3) + 5).map((n) => (
                      <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined} className={`!min-h-0 h-9 min-w-9 rounded-lg px-2 text-[13px] font-semibold ${n === page ? "bg-[#5B3FD9] text-white" : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{n}</button>
                    ))}
                    <button type="button" aria-label="Next page" disabled={page === pages} onClick={() => setPage(page + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
                  </span>
                </div>
              )}
            </Card>

            <Card className="p-4">
              <h3 className="m-0 mb-1 text-[18px] font-bold text-gray-900 dark:text-slate-50">Journey Builder Preview</h3>
              <p className="m-0 mb-2 truncate text-[12.5px] text-gray-600 dark:text-slate-400">{current ? current.name : "Pick a journey in the list to see its steps."}</p>
              <div className="max-h-[470px] overflow-auto rounded-xl bg-[radial-gradient(#E4DDFB_1px,transparent_1px)] [background-size:16px_16px] dark:bg-[radial-gradient(#334155_1px,transparent_1px)]">
                {current && <div style={{ zoom: 0.75 }}><FlowDiagram trigger={current.trigger} flow={current.workflow} /></div>}
              </div>
              {current && (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => void openTest(current)} className={btn.ghost}><Send className="h-4 w-4 text-[#5B3FD9]" />Test</button>
                  <button type="button" onClick={() => onOpenWizard({ id: current.id, step: 3 })} className={btn.primary}>Edit Journey</button>
                </div>
              )}
            </Card>
          </div>

          {j && k && (
            <Card className="p-4">
              <CardHead title={<span className="inline-flex items-center gap-2"><BarChart3 className="h-5 w-5 text-[#5B3FD9]" />Journey Performance (Last 30 Days)</span>} />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.5fr)]">
                <Stat icon={Mail} label="Emails Sent" value={count(k.sent.value)} chip={<Delta value={k.sent.change} />} />
                <Stat icon={Users} label="Engaged" value={count(j.engaged.value)} sub={j.engaged.percent === null ? undefined : `(${pct(j.engaged.percent)})`} />
                <Stat icon={ShoppingCart} label="Conversions" value={count(j.conversions.value)} sub={j.conversions.percent === null ? undefined : `(${pct(j.conversions.percent)})`} />
                <Stat icon={Coins} label="Revenue" value={naira(k.revenue.value)} chip={<Delta value={k.revenue.change} />} />
                <div className="sm:col-span-2 xl:col-span-1">
                  <Legend items={[{ label: "Emails sent per day", color: SERIES.a }]} />
                  <TrendChart data={j.daily} series={[{ key: "sent", label: "Emails sent", color: SERIES.a, kind: "area", unit: "count" }]} height={130} empty="Shows once journey emails go out." />
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {report && <AutomationReport id={report} onClose={() => setReport(null)} />}
      {testing && <TestFlowModal name={testing.name} flow={testing.workflow} designer={designer} onClose={() => setTesting(null)} onToast={onToast} />}
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, chip }: { icon: typeof Mail; label: string; value: string; sub?: string; chip?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-100 p-3 dark:border-slate-800">
      <IconTile size="lg"><Icon className="h-6 w-6" /></IconTile>
      <div className="min-w-0">
        <div className="text-[13px] text-gray-600 dark:text-slate-400">{label}</div>
        <div className="text-[22px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value}</div>
        {(sub || chip) && <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-gray-600 dark:text-slate-400">{sub}{chip}</div>}
      </div>
    </div>
  );
}
