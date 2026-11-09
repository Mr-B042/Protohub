import { useState, type ReactNode } from "react";
import {
  CalendarDays, Check, ChevronDown, ChevronRight, Clock, Crown, Filter, Flag, Gift, GripVertical, Layers, LogOut, Mail, Map as MapIcon, Maximize2, Minimize2, Play, Plus, Redo2, RefreshCw,
  Rocket, Settings, ShoppingCart, Star, Tag, Target, Undo2, UserCheck, Users, Zap
} from "lucide-react";
import type { EmAudience, EmDesigner, EmTrigger } from "../../lib/api";
import { Card, IconTile, Toggle, input, select } from "./em-ui";
import SegmentBuilder from "./SegmentBuilder";
import FlowDiagram, { DRAG_TYPE, TRIGGER_ICON } from "./FlowDiagram";
import { ACTION_GROUPS } from "./NodeEditor";
import {
  DAY_NAMES, GOAL_OPTIONS, STAGES, TEMPLATES, QUIET_REASON_OPTIONS, TRIGGER_OPTIONS, allNodes, stageText, durationDays, durationText, goalText, hourText, howItWorks, launchProblems, triggerText, windowText,
  type ActionKey, type AutoDraft, type Slot
} from "./automation-model";

/** The four steps of Create New Automation (Bright's designs 51, A, B, C). */

export const TEMPLATE_ICON: Record<string, typeof Mail> = { cart: ShoppingCart, refresh: RefreshCw, cartx: ShoppingCart, mail: Mail, star: Star, gift: Gift, crown: Crown, tag: Tag };

type StepProps = { draft: AutoDraft; designer: EmDesigner | null; onChange: (patch: Partial<AutoDraft>) => void };

const label = "block text-[13px] font-semibold text-gray-800 dark:text-slate-200";
const Req = () => <span className="text-rose-500">*</span>;

function Panel({ icon: Icon, title, sub, children, className = "" }: { icon?: typeof Mail; title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="mb-3 flex items-start gap-2.5">
        {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#5B3FD9]" />}
        <div className="min-w-0"><h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">{title}</h3>{sub && <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">{sub}</p>}</div>
      </div>
      {children}
    </Card>
  );
}

const audienceValue = (audience: EmAudience) => (audience.source === "segment" && audience.segmentId ? `segment:${audience.segmentId}` : audience.source === "list" && audience.listId ? `list:${audience.listId}` : "all");
const audienceFrom = (value: string): EmAudience => {
  const [kind, id] = value.split(":");
  return kind === "segment" ? { source: "segment", segmentId: id } : kind === "list" ? { source: "list", listId: id } : { source: "all" };
};
export function audienceName(audience: EmAudience, designer: EmDesigner | null) {
  if (audience.source === "segment") return designer?.segments.find((row) => row.id === audience.segmentId)?.name ?? "A segment";
  if (audience.source === "list") return designer?.segments.find((row) => row.id === audience.listId)?.name ?? "A list";
  return "All Customers";
}

function AudienceSelect({ draft, designer, onChange }: StepProps) {
  const segments = (designer?.segments ?? []).filter((row) => row.status !== "archived");
  return (
    <div className="relative mt-1.5">
      <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B3FD9]" />
      <select value={audienceValue(draft.audience)} onChange={(event) => onChange({ audience: audienceFrom(event.target.value) })} className={`${select} !pl-9`} aria-label="Audience">
        <option value="all">All Customers</option>
        <optgroup label="Segments">{segments.filter((row) => !row.list).map((row) => <option key={row.id} value={`segment:${row.id}`}>{row.name}</option>)}</optgroup>
        <optgroup label="Lists">{segments.filter((row) => row.list && row.kind === "fixed").map((row) => <option key={row.id} value={`list:${row.id}`}>{row.name}</option>)}</optgroup>
      </select>
    </div>
  );
}

function GoalSelect({ draft, onChange }: Pick<StepProps, "draft" | "onChange">) {
  return (
    <div className="relative mt-1.5">
      <Target className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B3FD9]" />
      <select value={draft.goal} onChange={(event) => onChange({ goal: event.target.value })} className={`${select} !pl-9`} aria-label="Goal">
        {GOAL_OPTIONS.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
      </select>
    </div>
  );
}

/** The trigger picker plus the one setting each trigger needs. */
function TriggerFields({ draft, designer, onChange, hint = false }: StepProps & { hint?: boolean }) {
  const t = draft.trigger;
  const Icon = TRIGGER_ICON[t.kind] ?? ShoppingCart;
  const set = (patch: Partial<EmTrigger>) => onChange({ trigger: { ...t, ...patch } });
  const dateFields = (designer?.fields ?? []).filter((field) => field.type === "date");
  const option = TRIGGER_OPTIONS.find((row) => row.kind === t.kind);
  return (
    <>
      <div className="relative mt-1.5">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B3FD9]" />
        <select value={t.kind} onChange={(event) => {
          const kind = event.target.value as EmTrigger["kind"];
          onChange({ trigger: { kind, ...(kind === "cart_abandoned" ? { cartMinutes: 60 } : kind === "inactive" ? { inactiveDays: 60 } : kind === "vip" ? { vipOrders: 3 } : kind === "reorder" ? { reorderDays: 30, productId: null } : kind === "went_quiet" ? { quietDays: 1, quietReasons: [] } : kind === "in_segment" ? { segmentId: (designer?.segments ?? []).find((row) => !row.list)?.id ?? "", rank: 50 } : kind === "date_field" ? { fieldKey: dateFields[0]?.key ?? "birthday" } : { productId: null }) } });
        }} className={`${select} !pl-9`} aria-label="Trigger">
          {TRIGGER_OPTIONS.map((row) => <option key={row.kind} value={row.kind}>{row.label}</option>)}
        </select>
      </div>
      {hint && option && <p className="m-0 mt-1 text-[12px] text-gray-500">This automation will start when {option.when}.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {(t.kind === "order_delivered" || t.kind === "order_placed" || t.kind === "reorder") && (
          <select value={t.productId ?? ""} onChange={(event) => set({ productId: event.target.value || null })} className={`${select} !w-auto min-w-[170px] flex-1 !py-2 !text-[13px]`} aria-label="Product">
            <option value="">Any product</option>{(designer?.products ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        )}
        {t.kind === "cart_abandoned" && (
          <select value={String(t.cartMinutes ?? 60)} onChange={(event) => set({ cartMinutes: Number(event.target.value) })} className={`${select} !w-auto !py-2 !text-[13px]`} aria-label="After">
            {[30, 60, 120, 240, 1440].map((n) => <option key={n} value={n}>{n < 60 ? `${n} minutes after` : n === 1440 ? "1 day after" : `${n / 60} ${n === 60 ? "hour" : "hours"} after`}</option>)}
          </select>
        )}
        {t.kind === "inactive" && (
          <select value={String(t.inactiveDays ?? 60)} onChange={(event) => set({ inactiveDays: Number(event.target.value) })} className={`${select} !w-auto !py-2 !text-[13px]`} aria-label="Days">
            {[30, 45, 60, 90, 120, 180].map((n) => <option key={n} value={n}>{n} days without a purchase</option>)}
          </select>
        )}
        {t.kind === "vip" && (
          <select value={String(t.vipOrders ?? 3)} onChange={(event) => set({ vipOrders: Number(event.target.value) })} className={`${select} !w-auto !py-2 !text-[13px]`} aria-label="Orders">
            {[2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n} delivered orders</option>)}
          </select>
        )}
        {t.kind === "reorder" && (
          <select value={String(t.reorderDays ?? 30)} onChange={(event) => set({ reorderDays: Number(event.target.value) })} className={`${select} !w-auto !py-2 !text-[13px]`} aria-label="Days after delivery">
            {[14, 21, 30, 45, 60, 90].map((n) => <option key={n} value={n}>{n} days after delivery</option>)}
          </select>
        )}
        {t.kind === "in_segment" && (
          <select value={t.segmentId ?? ""} onChange={(event) => set({ segmentId: event.target.value })} className={`${select} !w-auto min-w-[200px] flex-1 !py-2 !text-[13px]`} aria-label="Segment">
            <option value="">Pick a segment…</option>{(designer?.segments ?? []).filter((row) => row.status !== "archived").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        )}
        {t.kind === "went_quiet" && (
          <select value={String(t.quietDays ?? 1)} onChange={(event) => set({ quietDays: Number(event.target.value) })} className={`${select} !w-auto !py-2 !text-[13px]`} aria-label="Days after the order">
            {[1, 2, 3, 7, 14, 31].map((n) => <option key={n} value={n}>{n === 1 ? "1 day" : `${n} days`} after the order</option>)}
          </select>
        )}
        {t.kind === "date_field" && (dateFields.length ? (
          <select value={t.fieldKey ?? ""} onChange={(event) => set({ fieldKey: event.target.value })} className={`${select} !w-auto min-w-[170px] !py-2 !text-[13px]`} aria-label="Date field">
            {dateFields.map((field) => <option key={field.key} value={field.key}>{field.name}</option>)}
          </select>
        ) : <p className="m-0 text-[12px] text-amber-700">No date field yet. Add one in Audience &amp; Segments › Custom Fields (type Date), e.g. Birthday.</p>)}
      </div>
      {t.kind === "went_quiet" && (
        <div className="mt-2 space-y-1">
          <p className="m-0 text-[12px] font-semibold text-gray-700 dark:text-slate-300">Why they went quiet (from the rep's last call note). None ticked = everyone.</p>
          {QUIET_REASON_OPTIONS.map((row) => {
            const on = (t.quietReasons ?? []).includes(row.key);
            return (
              <label key={row.key} className="flex items-center gap-2 text-[12.5px] text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={on} onChange={() => set({ quietReasons: on ? (t.quietReasons ?? []).filter((key) => key !== row.key) : [...(t.quietReasons ?? []), row.key] })} />
                {row.label}
              </label>
            );
          })}
          <p className="m-0 text-[11.5px] text-gray-500">Includes customers who went quiet before the automation started. It stops for a customer when they order again, their order is delivered, or they unsubscribe.</p>
        </div>
      )}
      {(t.kind === "inactive" || t.kind === "reorder" || t.kind === "vip") && <p className="m-0 mt-1 text-[11.5px] text-gray-500">Counts from launch: customers who reach this after the automation starts. To reach everyone already there, send a campaign.</p>}
    </>
  );
}

// ── Step 1: Choose a Template (design 51) ─────────────────────────────

export function Zoombar({ zoom, setZoom, full, setFull, undo, redo, onTest, extra }: {
  zoom: number; setZoom: (zoom: number) => void; full: boolean; setFull: (full: boolean) => void;
  undo?: (() => void) | null; redo?: (() => void) | null; onTest?: () => void; extra?: ReactNode;
}) {
  const tool = "!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex gap-1">
        <button type="button" aria-label="Undo" disabled={!undo} onClick={() => undo?.()} className={tool}><Undo2 className="h-4 w-4" /></button>
        <button type="button" aria-label="Redo" disabled={!redo} onClick={() => redo?.()} className={tool}><Redo2 className="h-4 w-4" /></button>
      </div>
      <select value={String(zoom)} onChange={(event) => setZoom(Number(event.target.value))} className={`${select} !h-9 !w-auto !py-1 !text-[13px]`} aria-label="Zoom">
        {[0.5, 0.75, 1, 1.25].map((z) => <option key={z} value={z}>Zoom {Math.round(z * 100)}%</option>)}
      </select>
      <button type="button" aria-label={full ? "Exit full screen" : "Full screen"} onClick={() => setFull(!full)} className={tool}>{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
      {extra}
      {onTest && <button type="button" onClick={onTest} className="!min-h-0 ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><Play className="h-4 w-4 text-[#5B3FD9]" />Test Flow</button>}
    </div>
  );
}

export function Canvas({ children, full, onExit }: { children: ReactNode; full: boolean; onExit: () => void }) {
  return (
    <div className={full ? "fixed inset-0 z-[96] flex flex-col bg-white p-4 dark:bg-slate-950" : ""}>
      {full && <div className="mb-2 flex justify-end"><button type="button" onClick={onExit} className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[13px] font-semibold"><Minimize2 className="h-4 w-4" />Exit full screen</button></div>}
      <div className={`overflow-auto rounded-xl border border-dashed border-[#D9D2F7] bg-[radial-gradient(#E4DDFB_1px,transparent_1px)] [background-size:16px_16px] dark:border-slate-700 dark:bg-[radial-gradient(#334155_1px,transparent_1px)] ${full ? "flex-1" : "h-[470px]"}`}>
        {children}
      </div>
    </div>
  );
}

export function StepChoose({ draft, designer, onChange, onPickTemplate }: StepProps & { onPickTemplate: (key: string | null) => void }) {
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const template = TEMPLATES.find((row) => row.key === draft.template);
  const HeadIcon = TEMPLATE_ICON[template?.icon ?? "mail"] ?? Zap;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,300px)]">
      <Card className="p-4">
        <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Choose a Template</h3>
        <p className="m-0 mb-3 text-[13px] text-gray-600 dark:text-slate-400">Start with a ready-made automation or build from scratch.</p>
        <div className="space-y-2">
          {TEMPLATES.map((row) => {
            const Icon = TEMPLATE_ICON[row.icon] ?? Mail;
            const on = draft.template === row.key;
            return (
              <button key={row.key} type="button" onClick={() => onPickTemplate(row.key)} aria-pressed={on}
                className={`!min-h-0 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${on ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-100 hover:border-[#C9BEF5] dark:border-slate-800"}`}>
                <Icon className="h-6 w-6 shrink-0 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{row.hint}</span></span>
                {on && <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5B3FD9] text-white"><Check className="h-3 w-3" /></span>}
              </button>
            );
          })}
          <button type="button" onClick={() => onPickTemplate(null)} className={`!min-h-0 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-[14px] font-bold text-[#5B3FD9] ${draft.template === null ? "border-[#5B3FD9] bg-[#F5F2FE]" : "border-[#C9BEF5] hover:bg-[#F7F4FF]"}`}>
            <Plus className="h-4 w-4" />Build From Scratch
          </button>
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-start gap-3">
          <IconTile><HeadIcon className="h-5 w-5" /></IconTile>
          <div className="min-w-0"><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">{template?.name ?? "Build From Scratch"}</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">{template?.hint ?? "Pick a trigger, then add the steps yourself in Build Workflow."}</p></div>
        </div>
        <div className="mb-2"><Zoombar zoom={zoom} setZoom={setZoom} full={full} setFull={setFull} /></div>
        <Canvas full={full} onExit={() => setFull(false)}>
          <div style={{ zoom }}><FlowDiagram trigger={draft.trigger} flow={draft.workflow} /></div>
        </Canvas>
      </Card>

      <Card className="p-4">
        <h3 className="m-0 mb-3 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><Settings className="h-5 w-5 text-[#5B3FD9]" />Automation Details</h3>
        <div className="space-y-3">
          <label className={label}>Automation Name <Req /><input value={draft.name} maxLength={160} onChange={(event) => onChange({ name: event.target.value })} placeholder="e.g. Post-Purchase Follow-Up" className={`${input} mt-1.5`} /></label>
          <div className={label}>Goal <Req /><GoalSelect draft={draft} onChange={onChange} /></div>
          <div className={label}>Trigger <Req /><TriggerFields draft={draft} designer={designer} onChange={onChange} /></div>
          <div className={label}>Audience<AudienceSelect draft={draft} designer={designer} onChange={onChange} /></div>
          <div className="border-t border-gray-100 pt-3 dark:border-slate-800">
            <div className="mb-2 flex items-center gap-2 text-[15px] font-bold text-gray-900 dark:text-slate-50"><Clock className="h-5 w-5 text-[#5B3FD9]" />Timing &amp; Frequency</div>
            <label className={label}>Time Zone<select disabled className={`${select} mt-1.5`} aria-label="Time zone"><option>(WAT) West Africa Time</option></select></label>
            <label className="mt-3 flex items-start gap-2 text-[13px] text-gray-800 dark:text-slate-200">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5B3FD9]" checked={draft.settings.reentry} onChange={(event) => onChange({ settings: { ...draft.settings, reentry: event.target.checked } })} />
              <span><b>Allow customers to re-enter</b> (e.g. a new order)</span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-[13px] text-gray-800 dark:text-slate-200">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#5B3FD9]" checked={draft.settings.exit.onUnsubscribe} onChange={(event) => onChange({ settings: { ...draft.settings, exit: { ...draft.settings.exit, onUnsubscribe: event.target.checked } } })} />
              <span>Stop if customer unsubscribes or opts out</span>
            </label>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ── Step 2: Automation Details (design A) ─────────────────────────────

const Setting = ({ icon: Icon, title, hint, children }: { icon: typeof Mail; title: string; hint: string; children: ReactNode }) => (
  <div className="flex items-start gap-3 border-b border-gray-100 py-3 last:border-0 dark:border-slate-800">
    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#5B3FD9]" />
    <div className="min-w-0 flex-1"><div className="text-[14px] font-bold text-gray-900 dark:text-slate-50">{title}</div><div className="text-[12.5px] text-gray-600 dark:text-slate-400">{hint}</div></div>
    <div className="shrink-0">{children}</div>
  </div>
);

export function StepDetails({ draft, designer, onChange }: StepProps) {
  const s = draft.settings;
  const set = (patch: Partial<typeof s>) => onChange({ settings: { ...s, ...patch } });
  const exitSet = (patch: Partial<typeof s.exit>) => set({ exit: { ...s.exit, ...patch } });
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel icon={Layers} title="Automation Overview" sub="Define the core details, audience, and conditions for this automation.">
        <div className="space-y-3">
          <label className={label}>Automation Name <Req /><input value={draft.name} maxLength={160} onChange={(event) => onChange({ name: event.target.value })} className={`${input} mt-1.5`} /></label>
          <label className={label}>Description (Optional)
            <textarea value={draft.description} maxLength={200} rows={3} onChange={(event) => onChange({ description: event.target.value })} className={`${input} mt-1.5 resize-none`} />
            <span className="block text-right text-[11.5px] font-normal text-gray-500">{draft.description.length} / 200</span>
          </label>
          <div className={label}>Audience / Segment <Req /><AudienceSelect draft={draft} designer={designer} onChange={onChange} /></div>
          <div className={label}>Trigger / Start Event <Req /><TriggerFields hint draft={draft} designer={designer} onChange={onChange} /></div>
          <div className={label}>Goal (What you want to achieve) <Req /><GoalSelect draft={draft} onChange={onChange} /></div>
          <div className={label}>Customer Stage
            <div className="relative mt-1.5">
              <MapIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B3FD9]" />
              <select value={draft.stage} onChange={(event) => onChange({ stage: event.target.value as AutoDraft["stage"] })} className={`${select} !pl-9`} aria-label="Customer stage">
                {STAGES.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
              </select>
            </div>
            <span className="block text-[11.5px] font-normal text-gray-500">Where it sits on the Customer Journey page.</span>
          </div>
        </div>
      </Panel>

      <Panel icon={Settings} title="Automation Settings" sub="Configure how this automation behaves.">
        <Setting icon={UserCheck} title="Status" hint="Turn this automation on or off.">
          <span className="inline-flex items-center gap-2"><Toggle on={draft.active} label="Status" onChange={(active) => onChange({ active })} /><span className={`text-[13px] font-semibold ${draft.active ? "text-emerald-600" : "text-gray-500"}`}>{draft.active ? "Active" : "Off"}</span></span>
        </Setting>
        <Setting icon={RefreshCw} title="Re-entry" hint="Allow customers to enter this automation again in the future.">
          <Toggle on={s.reentry} label="Re-entry" onChange={(reentry) => set({ reentry })} />
        </Setting>
        <div className="py-3">
          <div className="flex items-center gap-3"><CalendarDays className="h-5 w-5 text-[#5B3FD9]" /><span className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Re-entry Wait Period</span></div>
          <select disabled={!s.reentry} value={String(s.reentryDays)} onChange={(event) => set({ reentryDays: Number(event.target.value) })} className={`${select} mt-1.5 disabled:opacity-50`} aria-label="Re-entry wait period">
            {[0, 7, 14, 30, 60, 90, 180, 300, 365].map((n) => <option key={n} value={n}>{n === 0 ? "No wait" : `${n} Days`}</option>)}
          </select>
          <p className="m-0 mt-1 text-[12px] text-gray-500">Minimum time before a customer can re-enter.</p>
        </div>
        <div className="py-3">
          <div className="flex items-center gap-3"><Layers className="h-5 w-5 text-[#5B3FD9]" /><span className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Frequency Limit</span></div>
          <p className="m-0 text-[12px] text-gray-500">Maximum times a customer can receive this automation.</p>
          <select value={s.frequency} onChange={(event) => set({ frequency: event.target.value as typeof s.frequency })} className={`${select} mt-1.5`} aria-label="Frequency limit">
            <option value="per_event">Once per {draft.trigger.kind === "cart_abandoned" ? "Cart" : draft.trigger.kind.startsWith("order") || draft.trigger.kind === "reorder" ? "Order" : "Event"}</option>
            <option value="max_2">Up to 2 Times</option><option value="max_3">Up to 3 Times</option><option value="unlimited">No Limit</option>
          </select>
        </div>
        <div className="py-3">
          <div className="flex items-center gap-3"><Flag className="h-5 w-5 text-[#5B3FD9]" /><span className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Priority</span></div>
          <p className="m-0 text-[12px] text-gray-500">If a customer qualifies for multiple automations: someone in a higher-priority one doesn't enter this one until that ends.</p>
          <select value={s.priority} onChange={(event) => set({ priority: event.target.value as typeof s.priority })} className={`${select} mt-1.5`} aria-label="Priority">
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        </div>
        <div className="py-3">
          <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={!!s.payday} onChange={(event) => set({ payday: event.target.checked })} />
            <span className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Send in payday weeks only</span></label>
          <p className="m-0 mt-1 text-[12px] text-gray-500">An email due between the 8th and 24th waits until the 25th at 9am, when most customers have been paid. For selling emails, not for order or cart follow-ups.</p>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel icon={Filter} title="Enrollment Rules (Optional)" sub="Add conditions to refine who enters this automation.">
          {designer && (
            <SegmentBuilder compact match={draft.enrollment.match} conditions={draft.enrollment.conditions} fields={designer.conditionFields} products={designer.products} states={designer.states} tags={designer.tags}
              onChange={(next) => onChange({ enrollment: { on: next.conditions.length > 0, match: next.match, conditions: next.conditions } })} />
          )}
        </Panel>
        <Panel icon={LogOut} title="Exit Rules (Optional)" sub="Define when a customer should exit this automation.">
          <div className="space-y-2 text-[13.5px] text-gray-800 dark:text-slate-200">
            <label className="flex items-center gap-2 opacity-80"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked disabled readOnly />Exit after completing the full sequence</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={s.exit.onUnsubscribe} onChange={(event) => exitSet({ onUnsubscribe: event.target.checked })} />Exit if customer unsubscribes from emails</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={s.exit.onPurchase} onChange={(event) => exitSet({ onPurchase: event.target.checked })} />Exit if customer makes a new purchase</label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={s.exit.afterDays !== null} onChange={(event) => exitSet({ afterDays: event.target.checked ? 30 : null })} />Exit after</label>
              <select disabled={s.exit.afterDays === null} value={String(s.exit.afterDays ?? 30)} onChange={(event) => exitSet({ afterDays: Number(event.target.value) })} className={`${select} !h-9 !w-[90px] !py-1 disabled:opacity-50`} aria-label="Days">
                {[7, 14, 30, 60, 90].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span>days</span>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ── Step 3: Build Workflow (design B) ─────────────────────────────────

export function Summary({ draft, designer, children }: StepProps & { children?: ReactNode }) {
  const rows: Array<[string, string]> = [
    ["Trigger", triggerText(draft.trigger)],
    ["Total Steps", String(allNodes(draft.workflow.nodes).length)],
    ["Duration", durationText(durationDays(draft.workflow.nodes))],
    ["Audience", audienceName(draft.audience, designer)],
    ["Goal", goalText(draft.goal)]
  ];
  return (
    <div className="space-y-2">
      {rows.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2 text-[13px] last:border-0 dark:border-slate-800">
          <span className="text-gray-600 dark:text-slate-400">{key}:</span><span className="text-right font-semibold text-gray-900 dark:text-slate-50">{value}</span>
        </div>
      ))}
      {children}
    </div>
  );
}

export function StepBuild({ draft, designer, onChange, onAddAt, onDropAt, onMenu, onSelect, undo, redo, onTest }: StepProps & {
  onAddAt: (slot: Slot) => void; onDropAt: (slot: Slot, action: ActionKey) => void; onMenu: (id: string, action: "edit" | "up" | "down" | "delete") => void; onSelect: (id: string) => void;
  undo: (() => void) | null; redo: (() => void) | null; onTest: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const [openGroup, setOpenGroup] = useState("messaging");
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,250px)_minmax(0,1fr)_minmax(0,290px)]">
      <Card className="p-4">
        <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Workflow Actions</h3>
        <p className="m-0 mb-3 text-[12.5px] text-gray-600 dark:text-slate-400">Drag and drop actions to build your automation, or click one to add it at the end.</p>
        <div className="space-y-1.5">
          {ACTION_GROUPS.map((group) => (
            <div key={group.key} className="rounded-xl border border-gray-100 dark:border-slate-800">
              <button type="button" onClick={() => setOpenGroup(openGroup === group.key ? "" : group.key)} className="!min-h-0 flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13.5px] font-bold text-gray-900 dark:text-slate-50">
                <group.icon className="h-4 w-4 text-[#5B3FD9]" /><span className="flex-1">{group.label}</span>{openGroup === group.key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {openGroup === group.key && (
                <div className="space-y-1 px-2 pb-2">
                  {!group.items.length && <p className="m-0 px-1 text-[12px] text-gray-500">Nothing to connect yet.</p>}
                  {group.items.map((item) => (
                    <div key={item.key} draggable={!item.off} title={item.off}
                      onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, item.key); event.dataTransfer.effectAllowed = "copy"; }}
                      onClick={() => { if (!item.off) onDropAt({ parentId: null, branch: null, index: draft.workflow.nodes.length }, item.key as ActionKey); }}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] font-semibold ${item.off ? "cursor-not-allowed border-gray-100 text-gray-400 dark:border-slate-800" : "cursor-grab border-gray-200 bg-white text-gray-800 hover:border-[#8B74EE] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
                      <item.icon className={`h-4 w-4 ${item.key === "whatsapp" && !item.off ? "text-emerald-600" : "text-[#5B3FD9]"}`} /><span className="flex-1">{item.label}</span>
                      {item.off ? <span className="text-[10.5px] font-normal">Email only</span> : <GripVertical className="h-4 w-4 text-gray-400" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-2"><Zoombar zoom={zoom} setZoom={setZoom} full={full} setFull={setFull} undo={undo} redo={redo} onTest={onTest} /></div>
        <Canvas full={full} onExit={() => setFull(false)}>
          <div style={{ zoom }}>
            <FlowDiagram editable trigger={draft.trigger} flow={draft.workflow} onAdd={onAddAt} onDropAction={onDropAt} onMenu={onMenu} onSelect={onSelect} />
          </div>
        </Canvas>
      </Card>

      <Card className="p-4">
        <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Workflow Summary</h3>
        <p className="m-0 mb-3 text-[13px] font-semibold text-[#5B3FD9]">{draft.name || "New automation"}</p>
        <Summary draft={draft} designer={designer} onChange={onChange}>
          <div className="mt-3 rounded-xl bg-[#F5F2FE] p-3 dark:bg-violet-500/10">
            <div className="mb-1.5 text-[13.5px] font-bold text-gray-900 dark:text-slate-50">How it works</div>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {howItWorks(draft).map((line, index) => <li key={index} className="flex items-start gap-1.5 text-[12.5px] text-gray-700 dark:text-slate-300"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{line}</li>)}
            </ul>
          </div>
        </Summary>
      </Card>
    </div>
  );
}

// ── Step 4: Settings & Launch (design C) ──────────────────────────────

export function StepLaunch({ draft, designer, onChange }: StepProps) {
  const s = draft.settings;
  const set = (patch: Partial<typeof s>) => onChange({ settings: { ...s, ...patch } });
  const w = s.sendWindow;
  const setWindow = (patch: Partial<typeof w>) => set({ sendWindow: { ...w, ...patch } });
  const problems = launchProblems(draft, designer);
  const sender = designer?.sender;
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <IconTile><Settings className="h-5 w-5" /></IconTile>
        <div><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Settings &amp; Launch</h3><p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Finalize your automation settings, review the summary, and launch.</p></div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,300px)]">
        <div className="space-y-4">
          <Panel title="General Settings">
            <div className="space-y-3">
              <label className={label}>Automation Name <Req /><input value={draft.name} maxLength={160} onChange={(event) => onChange({ name: event.target.value })} className={`${input} mt-1.5`} /></label>
              <div className="flex items-center justify-between gap-3"><span className={label}>Status</span><span className="inline-flex items-center gap-2"><Toggle on={draft.active} label="Status" onChange={(active) => onChange({ active })} /><span className={`text-[13px] font-semibold ${draft.active ? "text-emerald-600" : "text-gray-500"}`}>{draft.active ? "Active" : "Off"}</span></span></div>
              <label className={label}>Description (Optional)
                <textarea value={draft.description} maxLength={200} rows={3} onChange={(event) => onChange({ description: event.target.value })} className={`${input} mt-1.5 resize-none`} />
                <span className="block text-right text-[11.5px] font-normal text-gray-500">{draft.description.length} / 200</span>
              </label>
            </div>
          </Panel>
          <Panel icon={Mail} title="Delivery Settings">
            <div className="space-y-3">
              <label className={label}>Send From <Req />
                <select disabled className={`${select} mt-1.5`} aria-label="Send from"><option>{sender?.fromEmail ? `${sender.fromName || "Your shop"} <${sender.fromEmail}>` : "Not set up"}</option></select>
                <span className="block text-[11.5px] font-normal text-gray-500">Change it in Settings › Email.</span>
              </label>
              <label className={label}>Reply To
                <input value={s.replyTo} onChange={(event) => set({ replyTo: event.target.value.trim().toLowerCase() })} placeholder="Same as Settings › Email" className={`${input} mt-1.5`} />
              </label>
              <div className="flex items-center justify-between gap-3">
                <span><span className={label}>UTM Tracking</span><span className="block text-[12px] text-gray-500">Add campaign tracking to links</span></span>
                <Toggle on={s.utm} label="UTM tracking" onChange={(utm) => set({ utm })} />
              </div>
            </div>
          </Panel>
        </div>
        <div className="space-y-4">
          <Panel icon={Clock} title="Schedule & Timing">
            <div className="space-y-3">
              <label className={label}>Time Zone<select disabled className={`${select} mt-1.5`} aria-label="Time zone"><option>(WAT) West Africa Time</option></select></label>
              <div className="flex items-center justify-between gap-3">
                <span><span className={label}>Send Window</span><span className="block text-[12px] text-gray-500">Send only within specific hours</span></span>
                <Toggle on={w.on} label="Send window" onChange={(on) => setWindow({ on })} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-gray-600">From</span>
                <select disabled={!w.on} value={String(w.from)} onChange={(event) => setWindow({ from: Number(event.target.value), to: Math.max(Number(event.target.value) + 1, w.to) })} className={`${select} !py-2 disabled:opacity-50`} aria-label="From">
                  {Array.from({ length: 23 }, (_, h) => h).map((h) => <option key={h} value={h}>{hourText(h)}</option>)}
                </select>
                <span className="text-[13px] text-gray-600">To</span>
                <select disabled={!w.on} value={String(w.to)} onChange={(event) => setWindow({ to: Number(event.target.value) })} className={`${select} !py-2 disabled:opacity-50`} aria-label="To">
                  {Array.from({ length: 24 }, (_, h) => h + 1).filter((h) => h > w.from).map((h) => <option key={h} value={h}>{h === 24 ? "12:00 AM (midnight)" : hourText(h)}</option>)}
                </select>
              </div>
              <div>
                <span className={label}>Active Days</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 0].map((day) => {
                    const on = w.days.includes(day);
                    return <button key={day} type="button" disabled={!w.on} aria-pressed={on} onClick={() => setWindow({ days: on ? w.days.filter((d) => d !== day) : [...w.days, day] })}
                      className={`!min-h-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${on ? "bg-[#5B3FD9] text-white" : "border border-[#C9BEF5] text-[#5B3FD9]"}`}>{DAY_NAMES[day]}</button>;
                  })}
                </div>
              </div>
            </div>
          </Panel>
          <Panel icon={Target} title="Goal & Tracking">
            <div className="space-y-3">
              <div className={label}>Goal (Primary) <Req /><GoalSelect draft={draft} onChange={onChange} /></div>
              <div className="flex items-center justify-between gap-3">
                <span><span className={label}>Track Performance</span><span className="block text-[12px] text-gray-500">Measure opens, clicks, conversions, and revenue</span></span>
                <Toggle on={s.track} label="Track performance" onChange={(track) => set({ track })} />
              </div>
              {!s.track && <p className="m-0 text-[12px] text-amber-700">Off: opens, clicks and orders from these emails are not counted, and checks on opens or clicks always say No.</p>}
            </div>
          </Panel>
        </div>
        <Card className="h-fit p-4">
          <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Automation Summary</h3>
          <p className="m-0 mb-3 text-[12.5px] text-gray-600 dark:text-slate-400">Review your setup before launching.</p>
          <div className="space-y-2">
            {([
              ["Name", draft.name || "—"], ["Trigger", triggerText(draft.trigger)], ["Goal", goalText(draft.goal)], ["Stage", stageText(draft.stage)], ["Audience", audienceName(draft.audience, designer)],
              ["Total Steps", String(allNodes(draft.workflow.nodes).length)], ["Duration", durationText(durationDays(draft.workflow.nodes))],
              ["Send Window", windowText(s)], ["Tracking", s.track ? (s.utm ? "Enabled (UTM + Performance)" : "Performance only") : s.utm ? "UTM only" : "Off"]
            ] as Array<[string, string]>).map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-3 border-b border-gray-100 pb-2 text-[13px] last:border-0 dark:border-slate-800">
                <span className="text-gray-600 dark:text-slate-400">{key}:</span><span className="text-right font-semibold text-gray-900 dark:text-slate-50">{value}</span>
              </div>
            ))}
          </div>
          {problems.length ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <div className="mb-1 font-bold">Before launching</div>
              <ul className="m-0 list-disc space-y-0.5 pl-4">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
            </div>
          ) : (
            <div className="mt-3 flex gap-3 rounded-xl bg-[#F5F2FE] p-3 dark:bg-violet-500/10">
              <Rocket className="h-6 w-6 shrink-0 text-[#5B3FD9]" />
              <div><div className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Ready to Launch?</div><div className="text-[12.5px] text-gray-700 dark:text-slate-300">Your automation is set up and will run automatically once activated.</div></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
