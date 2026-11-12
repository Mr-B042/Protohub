import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  ArrowLeft, ArrowRight, Bell, Bookmark, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronUp, Clock, Code2, Copy, ExternalLink, Gauge, Globe, GripVertical, Hash,
  Info, Layers, Loader2, Lock, MapPin, Maximize2, MessageSquareText, Minimize2, Package, Pencil, Play, Plus, RefreshCw, Repeat, Settings, ShieldCheck, ShoppingCart, Smile, Tag, Timer,
  Trash2, UserCheck, UserPlus, Users, X, Zap, Flame, Bookmark as BookmarkIcon, Route, Workflow, Send, Sparkles
} from "lucide-react";
import { socialLeadsApi, type SlAutomation, type SlSettings } from "../../lib/api";
import { FacebookIcon, InstagramIcon } from "../../components/SocialIcons";
import { WhatsAppIcon } from "../../components/WhatsAppIcon";
import { STATUS, Switch, btn, field } from "./sl-ui";
import type { Shared } from "./SocialLeadsPage";

/**
 * Create Automation (Bright's 5 designs, 13 Nov 2026): Trigger → Conditions
 * → Actions → Schedule → Settings. Protohub runs these itself and sends the
 * messages through ManyChat. Server rules: backend lib/automation-rules.ts.
 */

type Cond = { id: string; field: string; op: string; values: string[] };
type Act = { id: string; type: string; config: Record<string, any> };
export type BuilderConfig = {
  trigger: { key: string; platforms: string[]; event: string; tag?: string; orderStatus?: string };
  conditions: { enabled: boolean; match: "all" | "any" | "custom"; rules: Cond[]; groups: Array<{ id: string; match: "all" | "any"; rules: Cond[] }> };
  actions: Act[];
  schedule: { mode: "immediate" | "scheduled" | "delay" | "recurring"; date?: string; time?: string; delayMinutes: number; repeat: boolean; frequency: "daily" | "weekly" | "monthly"; every: number; ends: "never" | "on_date" | "after"; endDate?: string; endAfter: number; workingHoursOnly: boolean; days: number[]; startMinute: number; endMinute: number };
  settings: { notifyOwner: boolean; notifyTeam: boolean; channel: "inapp" | "inapp_push"; maxRunsPerCustomer: number; coolDownDays: number; stopAfterEnabled: boolean; stopAfterDays: number; language: string; trackPerformance: boolean; params: Array<{ key: string; value: string }> };
};
const uid = () => Math.random().toString(36).slice(2, 9);
const todayPlus = (days: number) => new Date(Date.now() + 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
export const EMPTY_CONFIG: BuilderConfig = {
  trigger: { key: "new_message", platforms: ["facebook", "instagram"], event: "first" },
  conditions: { enabled: false, match: "all", rules: [], groups: [] },
  actions: [],
  schedule: { mode: "immediate", delayMinutes: 60, repeat: false, frequency: "daily", every: 1, ends: "never", endAfter: 10, workingHoursOnly: false, days: [1, 2, 3, 4, 5, 6], startMinute: 510, endMinute: 1020, date: todayPlus(1), time: "10:00" },
  settings: { notifyOwner: false, notifyTeam: false, channel: "inapp", maxRunsPerCustomer: 1, coolDownDays: 1, stopAfterEnabled: false, stopAfterDays: 30, language: "en-NG", trackPerformance: true, params: [] }
};

// ── Labels ────────────────────────────────────────────────────────────────

const TRIGGERS: Array<{ key: string; title: string; sub: string; Icon: ComponentType<{ className?: string }> }> = [
  { key: "new_message", title: "New Message", sub: "When a customer sends a new message", Icon: MessageSquareText },
  { key: "new_lead", title: "New Lead", sub: "When a new lead is captured", Icon: ShoppingCart },
  { key: "tag_added", title: "Tag Added", sub: "When a specific tag is applied", Icon: Tag },
  { key: "order_update", title: "Order Update", sub: "When an order status changes", Icon: Package },
  { key: "assigned", title: "Assigned to Team", sub: "When a lead is assigned to a team or rep", Icon: UserPlus },
  { key: "time_based", title: "Time-Based", sub: "Run at a specific time or date", Icon: Clock }
];
const ORDER_STATUSES = ["New", "Confirmed", "Scheduled", "Out for Delivery", "Delivered", "Cancelled", "Failed"];
export const triggerSummary = (c: BuilderConfig) => {
  const t = c.trigger;
  if (t.key === "new_message") return t.event === "any" ? "Any Incoming Message" : "Incoming Message (First Message)";
  if (t.key === "new_lead") return "New Lead Captured";
  if (t.key === "tag_added") return t.tag ? `Tag Added: ${t.tag}` : "Any Tag Added";
  if (t.key === "order_update") return t.orderStatus ? `Order becomes ${t.orderStatus}` : "Any Order Status Change";
  if (t.key === "assigned") return "Assigned to a Rep";
  return "Time-Based";
};

const FIELDS: Record<string, { label: string; Icon: ComponentType<{ className?: string }>; ops: Array<[string, string]>; kind: "tags" | "free" | "list" | "number" | "none" }> = {
  tag: { label: "Lead Tag", Icon: UserCheck, ops: [["is", "Is"], ["is_not", "Is Not"]], kind: "list" },
  message: { label: "Message Contains", Icon: MessageSquareText, ops: [["any", "Keywords (Any)"], ["all", "Keywords (All)"], ["none", "None of"]], kind: "free" },
  state: { label: "State", Icon: MapPin, ops: [["is", "Is"], ["is_not", "Is Not"]], kind: "list" },
  product: { label: "Product", Icon: Package, ops: [["is", "Is"], ["is_not", "Is Not"]], kind: "list" },
  status: { label: "Lead Status", Icon: Sparkles, ops: [["is", "Is"], ["is_not", "Is Not"]], kind: "list" },
  platform: { label: "Platform", Icon: Globe, ops: [["is", "Is"], ["is_not", "Is Not"]], kind: "list" },
  orders: { label: "Order Count", Icon: Hash, ops: [["is", "Is"], ["gt", "More than"], ["lt", "Less than"]], kind: "number" },
  hot: { label: "Hot Lead", Icon: Flame, ops: [["is", "Is hot"], ["is_not", "Is not hot"]], kind: "none" },
  score: { label: "Lead Score", Icon: Gauge, ops: [["gte", "At least"], ["lt", "Below"]], kind: "number" }
};
const NG_STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"];

const ACTIONS: Array<{ type: string; title: string; sub: string; Icon: ComponentType<{ className?: string }>; unavailable?: boolean }> = [
  { type: "send_message", title: "Send Message", sub: "Send a text, template, or quick reply", Icon: MessageSquareText },
  { type: "assign", title: "Assign to Team", sub: "Assign the lead to a team or sales rep", Icon: UserPlus },
  { type: "add_tag", title: "Add Tag", sub: "Apply one or more tags to the lead", Icon: Tag },
  { type: "update_lead", title: "Update Lead", sub: "Change lead status, stage, or custom fields", Icon: BookmarkIcon },
  { type: "trigger_automation", title: "Trigger Automation", sub: "Start another automation workflow", Icon: Zap },
  { type: "notify_team", title: "Notify Team", sub: "Send an in-app, phone or Telegram alert", Icon: Bell },
  { type: "wait", title: "Wait / Delay", sub: "Pause for a set time before next action", Icon: Clock },
  { type: "route_lead", title: "Route Lead", sub: "Send to a specific rep based on rules", Icon: Route },
  { type: "webhook", title: "Webhook (Advanced)", sub: "Send lead data to an external app (API)", Icon: ExternalLink, unavailable: true }
];
const VARIABLES = ["{{customer_name}}", "{{phone}}", "{{product}}", "{{price}}", "{{state}}", "{{order_id}}", "{{rep_name}}"];
const EMOJI = ["👋", "😊", "🙏", "🎉", "✅", "📦", "🚚", "🔥", "💯", "❤️"];
const minuteLabel = (m: number) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const TIMES = Array.from({ length: 48 }, (_, i) => i * 30);
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const daysText = (days: number[]) => { const s = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).join(); return s === "1,2,3,4,5" ? "Mon – Fri" : s === "1,2,3,4,5,6" ? "Mon – Sat" : days.length === 7 ? "Every day" : [...days].sort().map((d) => DAY_NAMES[d]).join(", "); };

export function actionSummary(a: Act, ctx: { reps: Shared["reps"]; templates: SlSettings["prefs"]["templates"]; automations: SlAutomation[] }) {
  const c = a.config;
  switch (a.type) {
    case "send_message": return c.kind === "template" || c.kind === "quick" ? (ctx.templates.find((t) => t.id === c.templateId)?.title ?? "Pick a template") : (String(c.text ?? "").split("\n")[0].slice(0, 40) || "Write the message");
    case "assign": return c.mode === "rep" ? (ctx.reps.find((r) => r.id === c.repId)?.name ?? "Pick a rep") : "Sales Rep Team (next in turn)";
    case "add_tag": return (c.tags ?? []).join(", ") || "Pick tags";
    case "update_lead": return [c.status ? `Status: ${STATUS[c.status]?.label ?? c.status}` : "", typeof c.hot === "boolean" ? (c.hot ? "Mark hot" : "Not hot") : "", c.fieldKey ? `${c.fieldKey} = ${c.fieldValue ?? ""}` : ""].filter(Boolean).join(" · ") || "Choose what to change";
    case "trigger_automation": return ctx.automations.find((x) => x.id === c.automationId)?.name ?? "Pick an automation";
    case "notify_team": return [c.assignedRep !== false ? "Assigned rep" : "", ...(c.roles ?? [])].filter(Boolean).join(", ") || "Pick who";
    case "wait": return `${c.amount ?? 1} ${c.unit ?? "hours"}`;
    case "route_lead": return `${(c.rules ?? []).length} rule(s)`;
    default: return "Not available yet";
  }
}

// ── The window ────────────────────────────────────────────────────────────

export default function AutomationWizard({ shared, existing, preset, automations, onClose, onSaved }: {
  shared: Shared; existing?: SlAutomation | null; preset?: { name: string; description: string; config: BuilderConfig } | null; automations: SlAutomation[]; onClose: () => void; onSaved: () => void;
}) {
  const start: BuilderConfig = useMemo(() => {
    const base = (existing?.config && Object.keys(existing.config).length ? existing.config : preset?.config) as BuilderConfig | undefined;
    return JSON.parse(JSON.stringify({ ...EMPTY_CONFIG, ...(base ?? {}), schedule: { ...EMPTY_CONFIG.schedule, ...(base?.schedule ?? {}) }, settings: { ...EMPTY_CONFIG.settings, ...(base?.settings ?? {}) }, conditions: { ...EMPTY_CONFIG.conditions, ...(base?.conditions ?? {}) }, trigger: { ...EMPTY_CONFIG.trigger, ...(base?.trigger ?? {}) } }));
  }, [existing, preset]);
  const [cfg, setCfg] = useState<BuilderConfig>(start);
  const [name, setName] = useState(existing?.name ?? preset?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? preset?.description ?? "");
  const [status, setStatus] = useState<"active" | "paused" | "draft">(existing?.status ?? "draft");
  const [step, setStep] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [settings, setSettings] = useState<SlSettings | null>(null);
  const [selected, setSelected] = useState<string | null>(start.actions[0]?.id ?? null);
  const dirty = useRef(false);
  useEffect(() => { socialLeadsApi.settings().then(setSettings).catch(() => undefined); }, []);
  useEffect(() => { const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; document.addEventListener("keydown", key); return () => document.removeEventListener("keydown", key); });
  const update = (fn: (c: BuilderConfig) => BuilderConfig) => { dirty.current = true; setCfg((c) => fn(JSON.parse(JSON.stringify(c)))); };
  const close = () => { if (dirty.current && !window.confirm("Close without saving? Your changes will be lost.")) return; onClose(); };
  const templates = settings?.prefs.templates ?? [];
  const ctx = { reps: shared.reps, templates, automations };
  const ruleCount = cfg.conditions.rules.length + cfg.conditions.groups.reduce((n, g) => n + g.rules.length, 0);
  const steps = [
    { n: 1, title: "Trigger", sub: "Choose what starts this automation", done: triggerSummary(cfg) },
    { n: 2, title: "Conditions", sub: "Add rules to filter leads (optional)", done: cfg.conditions.enabled ? `${ruleCount} rule${ruleCount === 1 ? "" : "s"} defined` : "No conditions (every lead)" },
    { n: 3, title: "Actions", sub: "Define what happens automatically", done: `${cfg.actions.length} action${cfg.actions.length === 1 ? "" : "s"} added` },
    { n: 4, title: "Schedule", sub: "Set timing and frequency", done: cfg.schedule.mode === "immediate" ? "Run immediately" : cfg.schedule.mode === "delay" ? `After ${cfg.schedule.delayMinutes} min` : "Scheduled" },
    { n: 5, title: "Settings", sub: "Name, status and save", done: name || "Name, status and save" }
  ];
  const save = async () => {
    setSaving(true); setProblem("");
    try {
      const body = { kind: "protohub" as const, name: name.trim(), description: description.trim(), status, trigger: cfg.trigger.key, config: cfg as unknown as Record<string, unknown> };
      if (existing?.id) await socialLeadsApi.updateAutomation(existing.id, body); else await socialLeadsApi.saveAutomation(body as any);
      shared.onToast(status === "active" ? `“${name}” is on.` : `“${name}” saved as ${status}.`);
      dirty.current = false; onSaved();
    } catch (e) {
      const msg = (e as Error).message || "Could not save.";
      setProblem(msg);
      const m = msg.match(/step (\d)/); if (m) setStep(Number(m[1]));
    } finally { setSaving(false); }
  };
  const nextLabel = ["", "Next: Conditions", "Next: Actions", "Next: Schedule", "Next: Settings"][step];

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/45 p-2 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-label="Create Automation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`flex max-h-[96vh] w-full flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl dark:bg-slate-950 ${expanded ? "h-[96vh] max-w-[1700px]" : "max-w-[1460px]"}`}>
        <div className="flex items-center gap-4 border-b border-gray-100 px-7 py-5 dark:border-slate-800">
          <span className="inline-flex h-[70px] w-[70px] shrink-0 items-center justify-center rounded-full bg-[#F1EEFD] text-[#6E3FF3] dark:bg-violet-500/15"><Zap className="h-9 w-9" fill="currentColor" /></span>
          <div className="mr-auto min-w-0"><h2 className="m-0 text-[30px] font-extrabold tracking-tight text-gray-900 dark:text-slate-50">{existing ? "Edit Automation" : "Create Automation"}</h2><p className="m-0 text-[17px] text-gray-600 dark:text-slate-400">Automate your customer communication, assignments, and follow-ups.</p></div>
          <span className={`rounded-full px-4 py-2 text-[16px] font-semibold ${status === "active" ? "bg-emerald-50 text-emerald-700" : status === "paused" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200"}`}>{status === "active" ? "Active" : status === "paused" ? "Paused" : "Draft"}</span>
          <button type="button" aria-label={expanded ? "Smaller" : "Full screen"} onClick={() => setExpanded((v) => !v)} className="!min-h-0 inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-800 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800">{expanded ? <Minimize2 className="h-6 w-6" /> : <Maximize2 className="h-6 w-6" />}</button>
          <button type="button" aria-label="Close" onClick={close} className="!min-h-0 inline-flex h-11 w-11 items-center justify-center rounded-xl text-gray-800 hover:bg-gray-100 dark:text-slate-200 dark:hover:bg-slate-800"><X className="h-7 w-7" /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[330px_minmax(0,1fr)]">
          <nav className="space-y-1 border-r border-gray-100 p-4 dark:border-slate-800" aria-label="Steps">
            {steps.map((s) => {
              const done = s.n < step || (existing && s.n !== step);
              const active = s.n === step;
              return (
                <button key={s.n} type="button" onClick={() => setStep(s.n)} className={`!min-h-0 flex w-full items-start gap-3.5 rounded-2xl px-4 py-4 text-left ${active ? "bg-[#F1EEFD] dark:bg-violet-500/15" : "hover:bg-gray-50 dark:hover:bg-slate-800"} ${s.n > 1 ? "border-t border-gray-100 dark:border-slate-800" : ""}`}>
                  <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[17px] font-bold ${active ? "bg-[#5B21E6] text-white" : done ? "bg-emerald-500 text-white" : "bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200"}`}>{done && !active ? <Check className="h-5 w-5" strokeWidth={3} /> : s.n}</span>
                  <span className="min-w-0"><b className={`block text-[19px] ${active ? "text-[#5B21E6] dark:text-violet-200" : "text-gray-900 dark:text-slate-100"}`}>{s.title}</b><span className={`block text-[14.5px] ${active ? "text-[#5B21E6] dark:text-violet-300" : "text-gray-600 dark:text-slate-400"}`}>{done && !active ? s.done : s.sub}</span></span>
                </button>
              );
            })}
          </nav>
          <div className="flex min-h-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
              {step === 1 && <TriggerStep cfg={cfg} update={update} tags={settings?.prefs.tagOptions ?? []} />}
              {step === 2 && <ConditionsStep cfg={cfg} update={update} shared={shared} settings={settings} />}
              {step === 3 && <ActionsStep cfg={cfg} update={update} shared={shared} settings={settings} automations={automations.filter((a) => a.kind === "protohub" && a.id !== existing?.id)} selected={selected} setSelected={setSelected} ctx={ctx} />}
              {step === 4 && <ScheduleStep cfg={cfg} update={update} />}
              {step === 5 && <SettingsStep cfg={cfg} update={update} name={name} setName={(v) => { dirty.current = true; setName(v); }} description={description} setDescription={(v) => { dirty.current = true; setDescription(v); }} status={status} setStatus={(v) => { dirty.current = true; setStatus(v); }} />}
              {problem && <p className="m-0 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[14px] text-rose-800">{problem}</p>}
            </div>
            <div className="flex items-center gap-3 border-t border-gray-100 px-7 py-5 dark:border-slate-800">
              <button type="button" onClick={close} className="!min-h-0 rounded-xl border-2 border-gray-200 bg-white px-8 py-3 text-[17px] font-semibold text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">Cancel</button>
              <span className="flex-1" />
              <button type="button" disabled={step === 1} onClick={() => setStep((s) => s - 1)} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 bg-white px-7 py-3 text-[17px] font-semibold text-gray-900 hover:bg-gray-50 disabled:text-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><ArrowLeft className="h-5 w-5" />Previous</button>
              {step < 5
                ? <button type="button" onClick={() => setStep((s) => s + 1)} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#5B21E6] px-8 py-3 text-[17px] font-semibold text-white hover:bg-[#4C1BC4]">{nextLabel}<ArrowRight className="h-5 w-5" /></button>
                : <button type="button" disabled={saving} onClick={save} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#5B21E6] px-8 py-3 text-[17px] font-semibold text-white hover:bg-[#4C1BC4] disabled:opacity-60">{saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}Save Automation</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────

function StepHead({ icon: Icon, title, sub, right }: { icon: ComponentType<{ className?: string }>; title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#F1EEFD] text-[#5B21E6] dark:bg-violet-500/15"><Icon className="h-8 w-8" /></span>
      <div className="mr-auto"><h3 className="m-0 text-[26px] font-extrabold text-gray-900 dark:text-slate-50">{title}</h3><p className="m-0 text-[16.5px] text-gray-700 dark:text-slate-300">{sub}</p></div>
      {right}
    </div>
  );
}
const Panel = ({ children, className = "" }: { children: ReactNode; className?: string }) => <div className={`rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 ${className}`}>{children}</div>;
const Info2 = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex items-start gap-3 rounded-2xl bg-[#F4F0FE] px-5 py-4 dark:bg-violet-500/10">
    <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#5B21E6] dark:bg-slate-900"><Info className="h-5 w-5" /></span>
    <div><b className="block text-[16.5px] text-[#2E1A6E] dark:text-violet-200">{title}</b><div className="text-[15px] text-[#2E1A6E] dark:text-violet-200">{children}</div></div>
  </div>
);
function Card2({ on, onClick, icon: Icon, title, sub, disabled, note }: { on: boolean; onClick: () => void; icon: ComponentType<{ className?: string }>; title: string; sub: string; disabled?: boolean; note?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={note} className={`!min-h-0 relative flex flex-col items-center rounded-2xl border-2 px-3 py-4 text-center transition disabled:cursor-not-allowed disabled:opacity-45 ${on ? "border-[#8B5CF6] bg-[#F4F0FE] dark:bg-violet-500/15" : "border-gray-200 bg-white hover:border-[#C4B5FD] dark:border-slate-700 dark:bg-slate-900"}`}>
      {on && <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#5B21E6] text-white"><Check className="h-4 w-4" strokeWidth={3} /></span>}
      <Icon className="h-9 w-9 text-[#5B21E6]" />
      <b className="mt-2 text-[17px] text-gray-900 dark:text-slate-100">{title}</b>
      <span className="text-[14px] leading-snug text-gray-600 dark:text-slate-400">{sub}</span>
      {note && disabled && <span className="mt-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-gray-500"><Lock className="h-3 w-3" />{note}</span>}
    </button>
  );
}
function Chips({ values, onChange, options, placeholder }: { values: string[]; onChange: (v: string[]) => void; options?: string[]; placeholder?: string }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const add = (v: string) => { const t = v.trim(); if (t && !values.includes(t)) onChange([...values, t]); setText(""); };
  const left = (options ?? []).filter((o) => !values.includes(o) && (!text || o.toLowerCase().includes(text.toLowerCase())));
  return (
    <div className="relative">
      <div className="flex min-h-[50px] flex-wrap items-center gap-1.5 rounded-xl border-2 border-gray-200 bg-white px-2 py-1.5 pr-9 dark:border-slate-700 dark:bg-slate-900" onClick={() => setOpen(true)}>
        {values.map((v) => <span key={v} className="inline-flex items-center gap-1.5 rounded-lg bg-[#EDE7FD] px-2.5 py-1 text-[15px] font-medium text-[#3B1F95] dark:bg-violet-500/20 dark:text-violet-200">{v}<button type="button" aria-label={`Remove ${v}`} className="!min-h-0" onClick={(e) => { e.stopPropagation(); onChange(values.filter((x) => x !== v)); }}><X className="h-4 w-4" /></button></span>)}
        <input value={text} onChange={(e) => { setText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && text.trim()) { e.preventDefault(); add(text); } if (e.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1)); }}
          placeholder={values.length ? "" : placeholder ?? "Type and press Enter"} className="min-w-[90px] flex-1 border-0 bg-transparent px-1 py-1 text-[15px] focus:outline-none" />
      </div>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-600" />
      {open && left.length > 0 && <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">{left.slice(0, 40).map((o) => <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); add(o); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[14px] hover:bg-gray-50 dark:hover:bg-slate-800">{o}</button>)}</div>}
    </div>
  );
}
const Sel = ({ value, onChange, children, className = "", icon }: { value: string; onChange: (v: string) => void; children: ReactNode; className?: string; icon?: ReactNode }) => (
  <span className={`relative inline-flex ${className}`}>
    {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-700">{icon}</span>}
    <select value={value} onChange={(e) => onChange(e.target.value)} className={`!min-h-0 !h-[52px] w-full appearance-none rounded-xl border-2 border-gray-200 bg-white py-0 !leading-normal pr-10 text-[16px] font-medium text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 ${icon ? "pl-11" : "pl-4"}`}>{children}</select>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-700" />
  </span>
);

// ── 1. Trigger ────────────────────────────────────────────────────────────

function TriggerStep({ cfg, update, tags }: { cfg: BuilderConfig; update: (fn: (c: BuilderConfig) => BuilderConfig) => void; tags: string[] }) {
  const t = cfg.trigger;
  const plat = (key: string) => t.platforms.includes(key);
  const toggle = (key: string) => update((c) => { c.trigger.platforms = plat(key) ? c.trigger.platforms.filter((p) => p !== key) : [...c.trigger.platforms, key]; return c; });
  const how: Record<string, string> = {
    new_message: t.event === "any" ? "This automation will start every time a customer sends you a message on the selected platform(s)." : "This automation will start whenever a customer sends you a new message on the selected platform(s).",
    new_lead: "This automation will start when a new lead is captured: a comment on your ad or a first message.",
    tag_added: `This automation will start when ${t.tag ? `the “${t.tag}” tag` : "any tag"} is added to a lead.`,
    order_update: `This automation will start when an order made from a lead ${t.orderStatus ? `becomes ${t.orderStatus}` : "changes status"}.`,
    assigned: "This automation will start when a lead is given to a rep (by turn, transfer or another automation).",
    time_based: "This automation will run on the schedule you set in step 4, for every lead that meets your conditions."
  };
  return (
    <>
      <StepHead icon={Play} title="1. Choose a Trigger" sub="A trigger is the event that starts this automation." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {TRIGGERS.map((x) => <Card2 key={x.key} on={t.key === x.key} onClick={() => update((c) => { c.trigger.key = x.key; if (x.key === "time_based" && c.schedule.mode !== "scheduled" && c.schedule.mode !== "recurring") c.schedule.mode = "scheduled"; if (x.key !== "time_based" && (c.schedule.mode === "scheduled" || c.schedule.mode === "recurring")) c.schedule.mode = "immediate"; return c; })} icon={x.Icon} title={x.title} sub={x.sub} />)}
      </div>
      <Panel className="mt-5 space-y-5">
        <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[150px_1fr]">
          <b className="text-[17px]">Platform</b>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-gray-200 px-5 py-4 dark:border-slate-700">
            {[{ k: "facebook", label: "Facebook", Icon: <FacebookIcon className="h-7 w-7" /> }, { k: "instagram", label: "Instagram", Icon: <InstagramIcon className="h-7 w-7" /> }].map((p) => (
              <label key={p.k} className="flex cursor-pointer items-center gap-3 text-[17px]"><input type="checkbox" className="h-5 w-5 accent-[#5B21E6]" checked={plat(p.k)} onChange={() => toggle(p.k)} />{p.Icon}{p.label}</label>
            ))}
            {[{ k: "telegram", label: "Telegram", Icon: <Send className="h-6 w-6 text-sky-500" /> }, { k: "whatsapp", label: "WhatsApp", Icon: <WhatsAppIcon className="h-7 w-7 text-[#25D366]" /> }].map((p) => (
              <label key={p.k} className="flex cursor-not-allowed items-center gap-3 text-[17px] opacity-50" title="Customer messages only reach Protohub from Facebook and Instagram (ManyChat)"><input type="checkbox" disabled className="h-5 w-5" />{p.Icon}{p.label}<span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">Not available yet</span></label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[150px_1fr]">
          <b className="text-[17px]">Trigger Event</b>
          {t.key === "new_message" && <Sel value={t.event} onChange={(v) => update((c) => { c.trigger.event = v; return c; })}><option value="first">Incoming Message (First Message)</option><option value="any">Any Incoming Message</option></Sel>}
          {t.key === "new_lead" && <Sel value="lead" onChange={() => undefined}><option value="lead">New Lead Captured (comment or first message)</option></Sel>}
          {t.key === "tag_added" && <Sel value={t.tag ?? ""} onChange={(v) => update((c) => { c.trigger.tag = v || undefined; return c; })}><option value="">Any tag</option>{tags.map((x) => <option key={x} value={x}>{x}</option>)}</Sel>}
          {t.key === "order_update" && <Sel value={t.orderStatus ?? ""} onChange={(v) => update((c) => { c.trigger.orderStatus = v || undefined; return c; })}><option value="">Any status change</option>{ORDER_STATUSES.map((x) => <option key={x} value={x}>{x === "New" ? "Order created (New)" : `Order becomes ${x}`}</option>)}</Sel>}
          {t.key === "assigned" && <Sel value="assigned" onChange={() => undefined}><option value="assigned">Lead assigned or transferred to a rep</option></Sel>}
          {t.key === "time_based" && <Sel value="time" onChange={() => undefined}><option value="time">On the schedule set in step 4</option></Sel>}
        </div>
        <Info2 title="How it works">{how[t.key]}</Info2>
      </Panel>
    </>
  );
}

// ── 2. Conditions ─────────────────────────────────────────────────────────

function optionsFor(fieldKey: string, shared: Shared, settings: SlSettings | null) {
  if (fieldKey === "tag") return [...new Set(["New Lead", ...(settings?.prefs.tagOptions ?? [])])];
  if (fieldKey === "state") return NG_STATES;
  if (fieldKey === "product") return shared.products.map((p) => p.name);
  if (fieldKey === "status") return Object.keys(STATUS).filter((k) => !["follow_up_due", "awaiting_reply", "pending_off_hours"].includes(k));
  if (fieldKey === "platform") return ["facebook", "instagram"];
  return undefined;
}

function RuleRow({ rule, onChange, onDelete, shared, settings, dragProps }: { rule: Cond; onChange: (r: Cond) => void; onDelete: () => void; shared: Shared; settings: SlSettings | null; dragProps: Record<string, any> }) {
  const def = FIELDS[rule.field] ?? FIELDS.tag;
  return (
    <div className="grid grid-cols-[28px_minmax(170px,1fr)_minmax(150px,0.8fr)_minmax(220px,1.6fr)_44px] items-center gap-3" {...dragProps}>
      <GripVertical className="h-6 w-6 cursor-grab text-gray-500" />
      <Sel value={rule.field} onChange={(v) => onChange({ ...rule, field: v, op: FIELDS[v].ops[0][0], values: [] })} icon={<def.Icon className="h-5 w-5" />}>{Object.entries(FIELDS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}</Sel>
      <Sel value={rule.op} onChange={(v) => onChange({ ...rule, op: v })}>{def.ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Sel>
      {def.kind === "none" ? <span className="text-[14px] text-gray-500">No value needed</span>
        : def.kind === "number" ? <input type="number" className={`${field} !py-3 !text-[16px]`} value={rule.values[0] ?? ""} onChange={(e) => onChange({ ...rule, values: [e.target.value] })} placeholder="0" />
          : <Chips values={rule.field === "status" ? rule.values.map((v) => STATUS[v]?.label ?? v) : rule.values} onChange={(vals) => onChange({ ...rule, values: rule.field === "status" ? vals.map((v) => Object.keys(STATUS).find((k) => STATUS[k].label === v) ?? v) : vals })}
            options={rule.field === "status" ? optionsFor("status", shared, settings)!.map((k) => STATUS[k]?.label ?? k) : optionsFor(rule.field, shared, settings)} placeholder={rule.field === "message" ? "Type a word, press Enter" : "Pick or type"} />}
      <button type="button" aria-label="Delete rule" onClick={onDelete} className="!min-h-0 inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-700 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-6 w-6" /></button>
    </div>
  );
}

function RuleList({ rules, setRules, shared, settings }: { rules: Cond[]; setRules: (r: Cond[]) => void; shared: Shared; settings: SlSettings | null }) {
  const [drag, setDrag] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {rules.map((r, i) => (
        <RuleRow key={r.id} rule={r} shared={shared} settings={settings} onChange={(nr) => setRules(rules.map((x) => (x.id === r.id ? nr : x)))} onDelete={() => setRules(rules.filter((x) => x.id !== r.id))}
          dragProps={{ draggable: true, onDragStart: () => setDrag(i), onDragOver: (e: any) => e.preventDefault(), onDrop: () => { if (drag === null || drag === i) return; const next = [...rules]; const [m] = next.splice(drag, 1); next.splice(i, 0, m); setRules(next); setDrag(null); } }} />
      ))}
      {!rules.length && <p className="m-0 rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center text-[15px] text-gray-500 dark:border-slate-700">No rule yet: every lead from the trigger continues.</p>}
    </div>
  );
}

function ConditionsStep({ cfg, update, shared, settings }: { cfg: BuilderConfig; update: (fn: (c: BuilderConfig) => BuilderConfig) => void; shared: Shared; settings: SlSettings | null }) {
  const c = cfg.conditions;
  const [saved, setSaved] = useState<Array<{ name: string; rules: Cond[] }>>(() => { try { return JSON.parse(localStorage.getItem("sl-saved-conditions") ?? "[]"); } catch { return []; } });
  const [savedOpen, setSavedOpen] = useState(false);
  const newRule = (): Cond => ({ id: uid(), field: "message", op: "any", values: [] });
  const keepSaved = (list: typeof saved) => { setSaved(list); try { localStorage.setItem("sl-saved-conditions", JSON.stringify(list)); } catch { /* private window */ } };
  return (
    <>
      <StepHead icon={ShoppingCart} title="2. Conditions" sub="Add rules to determine which leads should continue in this automation." right={<div className="flex items-center gap-3 text-[18px] font-bold">Enable Conditions<Switch on={c.enabled} onChange={(v) => update((x) => { x.conditions.enabled = v; if (v && !x.conditions.rules.length && !x.conditions.groups.length) x.conditions.rules = [newRule()]; return x; })} label="Enable conditions" /></div>} />
      <div className={c.enabled ? "" : "pointer-events-none opacity-50"}>
        <div className="grid grid-cols-1 items-center gap-3 border-t border-gray-100 pt-5 dark:border-slate-800 lg:grid-cols-[150px_1fr_1fr_1fr]">
          <b className="flex items-center gap-1.5 text-[18px]">Match Type<Info className="h-5 w-5 text-gray-500" /></b>
          {([["all", "All Conditions (AND)", "Lead must meet all the rules", CheckCircle2], ["any", "Any Condition (OR)", "Lead can meet at least one rule", null], ["custom", "Custom Logic", "Build advanced conditions", Code2]] as const).map(([k, title, sub, Icon]) => (
            <button key={k} type="button" onClick={() => update((x) => { x.conditions.match = k; if (k === "custom" && !x.conditions.groups.length) x.conditions.groups = [{ id: uid(), match: "any", rules: [] }]; return x; })} className={`!min-h-0 flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left ${c.match === k ? "border-[#8B5CF6] bg-[#F4F0FE] dark:bg-violet-500/15" : "border-gray-200 dark:border-slate-700"}`}>
              {k === "custom" ? <Code2 className="h-7 w-7 text-[#5B21E6]" /> : c.match === k ? <CheckCircle2 className="h-7 w-7 text-[#5B21E6]" fill="#5B21E6" stroke="white" /> : <span className="h-6 w-6 rounded-full border-2 border-gray-300" />}
              <span><b className={`block text-[17px] ${c.match === k ? "text-[#5B21E6]" : "text-gray-900 dark:text-slate-100"}`}>{title}</b><span className={`text-[14.5px] ${c.match === k ? "text-[#5B21E6]" : "text-gray-600"}`}>{sub}</span></span>
            </button>
          ))}
        </div>
        <Panel className="mt-5">
          <b className="mb-4 block text-[20px]">Condition Rules{c.match === "custom" && <span className="ml-2 text-[14px] font-normal text-gray-500">All of these, and every group below</span>}</b>
          <RuleList rules={c.rules} setRules={(r) => update((x) => { x.conditions.rules = r; return x; })} shared={shared} settings={settings} />
          {c.match === "custom" && c.groups.map((g, gi) => (
            <div key={g.id} className="mt-4 rounded-2xl border-2 border-dashed border-[#C4B5FD] p-4">
              <div className="mb-3 flex items-center gap-3"><b className="text-[16px]">Group {gi + 1}</b><Sel value={g.match} onChange={(v) => update((x) => { x.conditions.groups[gi].match = v as any; return x; })} className="w-[230px]"><option value="any">Any rule in this group</option><option value="all">All rules in this group</option></Sel>
                <button type="button" onClick={() => update((x) => { x.conditions.groups[gi].rules.push(newRule()); return x; })} className={`${btn.ghost} !py-2 !text-[14px]`}><Plus className="h-4 w-4" />Rule</button>
                <button type="button" aria-label="Delete group" onClick={() => update((x) => { x.conditions.groups.splice(gi, 1); return x; })} className="!min-h-0 ml-auto text-gray-500 hover:text-rose-600"><Trash2 className="h-5 w-5" /></button></div>
              <RuleList rules={g.rules} setRules={(r) => update((x) => { x.conditions.groups[gi].rules = r; return x; })} shared={shared} settings={settings} />
            </div>
          ))}
          <div className="relative mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => update((x) => { x.conditions.rules.push(newRule()); return x; })} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#5B21E6] px-5 py-3 text-[17px] font-semibold text-white"><Plus className="h-5 w-5" />Add Condition</button>
            <button type="button" onClick={() => update((x) => { x.conditions.match = "custom"; x.conditions.groups.push({ id: uid(), match: "any", rules: [newRule()] }); return x; })} className={`${btn.ghost} !border-2 !py-3 !text-[17px]`}><Layers className="h-5 w-5" />Add Condition Group</button>
            <button type="button" onClick={() => setSavedOpen((v) => !v)} className={`${btn.ghost} !border-2 !py-3 !text-[17px]`}><Bookmark className="h-5 w-5" />Use Saved Condition</button>
            {savedOpen && (
              <div className="absolute left-0 top-full z-30 mt-2 w-[380px] rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                {saved.length === 0 && <p className="m-0 px-3 py-2 text-[13.5px] text-gray-500">Nothing saved yet.</p>}
                {saved.map((s) => <div key={s.name} className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800"><button type="button" className="!min-h-0 flex-1 text-left text-[14px] font-semibold" onClick={() => { update((x) => { x.conditions.enabled = true; x.conditions.rules = [...x.conditions.rules, ...s.rules.map((r) => ({ ...r, id: uid() }))]; return x; }); setSavedOpen(false); }}>{s.name} <span className="font-normal text-gray-500">({s.rules.length})</span></button><button type="button" aria-label="Delete" className="!min-h-0 text-gray-400" onClick={() => keepSaved(saved.filter((x) => x.name !== s.name))}><X className="h-4 w-4" /></button></div>)}
                <button type="button" disabled={!c.rules.length} onClick={() => { const n = window.prompt("Name these rules"); if (n?.trim()) keepSaved([...saved.filter((x) => x.name !== n.trim()), { name: n.trim(), rules: c.rules }]); }} className={`${btn.soft} mt-1 w-full !py-2 !text-[13.5px]`}><Plus className="h-4 w-4" />Save the current rules</button>
                <p className="m-0 px-3 pt-1 text-[11.5px] text-gray-400">Saved on this browser.</p>
              </div>
            )}
          </div>
        </Panel>
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#F4F0FE] px-5 py-4 dark:bg-violet-500/10">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#5B21E6]"><Info className="h-5 w-5" /></span>
        <div><b className="block text-[16.5px] text-[#2E1A6E] dark:text-violet-200">Condition Examples</b><span className="flex flex-wrap gap-x-8 text-[15px] text-[#2E1A6E] dark:text-violet-200"><span>• Lead Tag is New Lead</span><span>• Message contains “price”</span><span>• State is not in [Zamfara, Sokoto]</span><span>• Order Count is 0</span></span></div>
      </div>
    </>
  );
}

// ── 3. Actions ────────────────────────────────────────────────────────────

function ActionsStep({ cfg, update, shared, settings, automations, selected, setSelected, ctx }: {
  cfg: BuilderConfig; update: (fn: (c: BuilderConfig) => BuilderConfig) => void; shared: Shared; settings: SlSettings | null; automations: SlAutomation[];
  selected: string | null; setSelected: (id: string | null) => void; ctx: Parameters<typeof actionSummary>[1];
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const current = cfg.actions.find((a) => a.id === selected) ?? null;
  const add = (type: string) => {
    const defaults: Record<string, Record<string, any>> = {
      send_message: { kind: "text", text: "Hi {{customer_name}}, 👋\nThanks for reaching out to ProtoHub!\nOne of our sales reps will contact you shortly to assist you." },
      assign: { mode: "rotation" }, add_tag: { tags: [] }, update_lead: {}, trigger_automation: {}, notify_team: { assignedRep: true, roles: [], push: true, message: "{{customer_name}} needs attention ({{product}})." },
      wait: { amount: 1, unit: "hours" }, route_lead: { rules: [{ field: "state", values: [], repId: "" }] }, webhook: {}
    };
    const a = { id: uid(), type, config: defaults[type] ?? {} };
    update((c) => { c.actions.push(a); return c; });
    setSelected(a.id);
  };
  const setConfig = (patch: Record<string, any>) => update((c) => { const a = c.actions.find((x) => x.id === selected); if (a) a.config = { ...a.config, ...patch }; return c; });
  const def = (type: string) => ACTIONS.find((x) => x.type === type)!;
  return (
    <>
      <StepHead icon={Play} title="3. Actions" sub="Choose the actions to run when the conditions are met." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,1fr)]">
        <Panel>
          <b className="mb-3 block text-[19px]">Choose Action(s)</b>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {ACTIONS.map((x) => <Card2 key={x.type} on={current?.type === x.type} onClick={() => add(x.type)} icon={x.Icon} title={x.title} sub={x.sub} disabled={x.unavailable} note={x.unavailable ? "Not available yet" : undefined} />)}
          </div>
        </Panel>
        <Panel>
          <div className="flex items-center gap-3"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#F1EEFD] text-[#5B21E6]"><MessageSquareText className="h-5 w-5" /></span><b className="text-[19px]">Action Configuration</b></div>
          {!current ? <p className="m-0 mt-6 text-[15px] text-gray-500">Click an action on the left to add it, or a step below to change it.</p> : (
            <div className="mt-4 space-y-4">
              <b className="block text-[17px]">Action: <span className="font-semibold">{def(current.type).title}</span></b>
              <ActionConfig action={current} setConfig={setConfig} shared={shared} settings={settings} automations={automations} />
            </div>
          )}
        </Panel>
      </div>
      <Panel className="mt-5">
        <div className="mb-3 flex items-center justify-between"><b className="text-[19px]">Selected Actions (in order)</b><button type="button" onClick={() => document.querySelector("#sl-wizard-actions")?.scrollIntoView({ behavior: "smooth" })} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border-2 border-[#C4B5FD] px-4 py-2 text-[15.5px] font-semibold text-[#5B21E6]" onMouseDown={() => setSelected(null)}><Plus className="h-5 w-5" />Add Another Action</button></div>
        <div id="sl-wizard-actions" className="space-y-2">
          {!cfg.actions.length && <p className="m-0 rounded-xl border border-dashed border-gray-300 px-4 py-5 text-center text-[15px] text-gray-500 dark:border-slate-700">No action yet. Pick one above.</p>}
          {cfg.actions.map((a, i) => {
            const d = def(a.type);
            return (
              <div key={a.id} draggable onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag === null || drag === i) return; update((c) => { const [m] = c.actions.splice(drag, 1); c.actions.splice(i, 0, m); return c; }); setDrag(null); }}
                className={`flex items-center gap-3 ${selected === a.id ? "" : ""}`}>
                <GripVertical className="h-6 w-6 cursor-grab text-gray-500" />
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[16px] font-bold dark:bg-slate-800">{i + 1}</span>
                <button type="button" onClick={() => setSelected(a.id)} className={`!min-h-0 flex flex-1 items-center gap-3 rounded-xl border-2 px-4 py-2.5 text-left ${selected === a.id ? "border-[#8B5CF6] bg-[#FAF8FF] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                  <d.Icon className="h-6 w-6 text-[#5B21E6]" /><span className="text-[16.5px]"><b>{d.title}</b> – {actionSummary(a, ctx)}</span>
                </button>
                <span className="flex flex-col"><button type="button" aria-label="Move up" disabled={i === 0} onClick={() => update((c) => { [c.actions[i - 1], c.actions[i]] = [c.actions[i], c.actions[i - 1]]; return c; })} className="!min-h-0 text-gray-400 disabled:opacity-30"><ChevronUp className="h-4 w-4" /></button><button type="button" aria-label="Move down" disabled={i === cfg.actions.length - 1} onClick={() => update((c) => { [c.actions[i + 1], c.actions[i]] = [c.actions[i], c.actions[i + 1]]; return c; })} className="!min-h-0 text-gray-400 disabled:opacity-30"><ChevronDown className="h-4 w-4" /></button></span>
                <button type="button" aria-label="Edit" onClick={() => setSelected(a.id)} className="!min-h-0 inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"><Pencil className="h-5 w-5" /></button>
                <button type="button" aria-label="Delete" onClick={() => { update((c) => { c.actions = c.actions.filter((x) => x.id !== a.id); return c; }); if (selected === a.id) setSelected(null); }} className="!min-h-0 inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-5 w-5" /></button>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}

function ActionConfig({ action, setConfig, shared, settings, automations }: { action: Act; setConfig: (p: Record<string, any>) => void; shared: Shared; settings: SlSettings | null; automations: SlAutomation[] }) {
  const c = action.config;
  const [more, setMore] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const insert = (v: string) => { const el = textRef.current; const t = String(c.text ?? ""); const at = el ? el.selectionStart : t.length; setConfig({ text: t.slice(0, at) + v + t.slice(at) }); };
  const templates = settings?.prefs.templates ?? [];
  const reps = shared.reps.filter((r) => r.role === "Sales Rep");
  const radio = (key: string, label: string, on: boolean, onClick: () => void) => (
    <button key={key} type="button" onClick={onClick} className={`!min-h-0 inline-flex items-center gap-2.5 rounded-xl border-2 px-4 py-2.5 text-[15.5px] font-medium ${on ? "border-[#8B5CF6] bg-[#F4F0FE] text-gray-900 dark:bg-violet-500/15 dark:text-slate-100" : "border-gray-200 text-gray-800 dark:border-slate-700 dark:text-slate-200"}`}>
      {on ? <CheckCircle2 className="h-5 w-5 text-[#5B21E6]" fill="#5B21E6" stroke="white" /> : <span className="h-5 w-5 rounded-full border-2 border-gray-300" />}{label}
    </button>
  );
  switch (action.type) {
    case "send_message": return (
      <>
        <b className="block text-[16px]">Message Type</b>
        <div className="flex flex-wrap gap-2">{radio("t", "Text Message", (c.kind ?? "text") === "text", () => setConfig({ kind: "text" }))}{radio("tp", "Template", c.kind === "template", () => setConfig({ kind: "template" }))}{radio("q", "Quick Reply", c.kind === "quick", () => setConfig({ kind: "quick" }))}</div>
        {(c.kind ?? "text") === "text" ? (
          <>
            <b className="block text-[16px]">Message Content <span className="text-rose-500">*</span></b>
            <div className="relative">
              <textarea ref={textRef} rows={5} value={c.text ?? ""} onChange={(e) => setConfig({ text: e.target.value })} className={`${field} !rounded-2xl !border-2 !text-[16px]`} />
              <button type="button" aria-label="Emoji" onClick={() => setEmoji((v) => !v)} className="!min-h-0 absolute bottom-3 right-3 text-gray-600"><Smile className="h-6 w-6" /></button>
              {emoji && <div className="absolute bottom-12 right-2 z-20 grid grid-cols-5 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">{EMOJI.map((e) => <button key={e} type="button" onClick={() => { insert(e); setEmoji(false); }} className="!min-h-0 rounded-lg p-1 text-[20px] hover:bg-gray-100">{e}</button>)}</div>}
            </div>
            <b className="block text-[16px]">Insert Variable</b>
            <div className="flex flex-wrap items-center gap-2">
              {(more ? VARIABLES : VARIABLES.slice(0, 3)).map((v) => <button key={v} type="button" onClick={() => insert(v)} className="!min-h-0 rounded-xl border border-gray-200 bg-[#F4F0FE] px-3 py-1.5 text-[14.5px] font-semibold text-[#3B1F95] dark:border-slate-700 dark:bg-violet-500/15 dark:text-violet-200">{v}</button>)}
              <button type="button" aria-label="More variables" onClick={() => setMore((v) => !v)} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 dark:border-slate-700">{more ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}</button>
            </div>
          </>
        ) : (
          <>
            <Sel value={c.templateId ?? ""} onChange={(v) => setConfig({ templateId: v })}><option value="">Pick a {c.kind === "quick" ? "quick reply" : "template"}</option>{templates.filter((t) => (c.kind === "quick" ? t.kind === "quick" : t.kind !== "quick")).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Sel>
            {c.templateId && <p className="m-0 whitespace-pre-wrap rounded-2xl bg-[#F3F0FE] px-4 py-3 text-[15px] dark:bg-violet-500/10">{templates.find((t) => t.id === c.templateId)?.body}</p>}
          </>
        )}
        <p className="m-0 text-[12.5px] text-gray-500">Sent through ManyChat while the customer's 24-hour window is open (Meta does not allow automatic messages after that).</p>
      </>
    );
    case "assign": return (
      <>
        <div className="flex flex-wrap gap-2">{radio("r", "Sales Rep Team (next in turn)", (c.mode ?? "rotation") === "rotation", () => setConfig({ mode: "rotation" }))}{radio("p", "A specific rep", c.mode === "rep", () => setConfig({ mode: "rep" }))}</div>
        {c.mode === "rep" && <Sel value={c.repId ?? ""} onChange={(v) => setConfig({ repId: v })}><option value="">Pick a rep</option>{shared.reps.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.role === "Sales Rep" ? "Call Rep" : r.role})</option>)}</Sel>}
        <p className="m-0 text-[12.5px] text-gray-500">{(c.mode ?? "rotation") === "rotation" ? "Follows the hand-out rules (turn order, working hours, paused reps skipped). A lead already with a rep stays with them." : "Moves the lead to this rep even if someone has it."}</p>
      </>
    );
    case "add_tag": return <><b className="block text-[16px]">Tags</b><Chips values={c.tags ?? []} onChange={(tags) => setConfig({ tags })} options={settings?.prefs.tagOptions ?? []} placeholder="Pick or type a tag" /></>;
    case "update_lead": return (
      <>
        <b className="block text-[16px]">Status</b>
        <Sel value={c.status ?? ""} onChange={(v) => setConfig({ status: v || undefined })}><option value="">Leave as it is</option>{["new", "in_conversation", "hot", "call_requested", "awaiting_customer", "follow_up", "on_hold", "lost"].map((s) => <option key={s} value={s}>{STATUS[s]?.label ?? s}</option>)}</Sel>
        <b className="block text-[16px]">Hot lead</b>
        <Sel value={c.hot === true ? "yes" : c.hot === false ? "no" : ""} onChange={(v) => setConfig({ hot: v === "yes" ? true : v === "no" ? false : undefined })}><option value="">Leave as it is</option><option value="yes">Mark as hot</option><option value="no">Not hot</option></Sel>
        <b className="block text-[16px]">Custom field</b>
        <div className="grid grid-cols-2 gap-2"><Sel value={c.fieldKey ?? ""} onChange={(v) => setConfig({ fieldKey: v || undefined })}><option value="">None</option>{(settings?.prefs.customFields ?? []).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</Sel><input className={`${field} !border-2 !py-3`} placeholder="Value" value={c.fieldValue ?? ""} onChange={(e) => setConfig({ fieldValue: e.target.value })} /></div>
      </>
    );
    case "trigger_automation": return (
      <>
        <Sel value={c.automationId ?? ""} onChange={(v) => setConfig({ automationId: v })}><option value="">Pick an automation</option>{automations.map((a) => <option key={a.id} value={a.id}>{a.name}{a.status !== "active" ? ` (${a.status})` : ""}</option>)}</Sel>
        <p className="m-0 text-[12.5px] text-gray-500">It runs only if it is active and its own conditions are met. At most 3 automations start each other in a row.</p>
      </>
    );
    case "notify_team": return (
      <>
        <label className="flex items-center gap-2 text-[15.5px]"><input type="checkbox" className="h-5 w-5 accent-[#5B21E6]" checked={c.assignedRep !== false} onChange={(e) => setConfig({ assignedRep: e.target.checked })} />The rep on the lead</label>
        <div className="flex flex-wrap gap-3">{["Owner", "Admin", "Manager", "Sales Closer"].map((r) => <label key={r} className="flex items-center gap-2 text-[15.5px]"><input type="checkbox" className="h-5 w-5 accent-[#5B21E6]" checked={(c.roles ?? []).includes(r)} onChange={() => setConfig({ roles: (c.roles ?? []).includes(r) ? c.roles.filter((x: string) => x !== r) : [...(c.roles ?? []), r] })} />{r}s</label>)}</div>
        <b className="block text-[16px]">Message</b>
        <textarea rows={3} className={`${field} !border-2`} value={c.message ?? ""} onChange={(e) => setConfig({ message: e.target.value })} />
        <div className="flex items-center gap-3"><Switch on={c.push !== false} onChange={(v) => setConfig({ push: v })} label="Phone pop-up" /><span className="text-[15px]">In-app + phone pop-up (copied to Telegram when that is on)</span></div>
        <p className="m-0 text-[12.5px] text-gray-500">Email alerts: not available yet.</p>
      </>
    );
    case "wait": return (
      <div className="grid grid-cols-2 gap-2"><input type="number" min={1} className={`${field} !border-2 !py-3`} value={c.amount ?? 1} onChange={(e) => setConfig({ amount: Math.max(1, Number(e.target.value) || 1) })} /><Sel value={c.unit ?? "hours"} onChange={(v) => setConfig({ unit: v })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></Sel></div>
    );
    case "route_lead": return (
      <>
        {(c.rules ?? []).map((r: any, i: number) => (
          <div key={i} className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
            <div className="grid grid-cols-2 gap-2">
              <Sel value={r.field ?? "state"} onChange={(v) => setConfig({ rules: c.rules.map((x: any, j: number) => (j === i ? { ...x, field: v, values: [] } : x)) })}><option value="state">State is</option><option value="product">Product is</option><option value="platform">Platform is</option></Sel>
              <Sel value={r.repId ?? ""} onChange={(v) => setConfig({ rules: c.rules.map((x: any, j: number) => (j === i ? { ...x, repId: v } : x)) })}><option value="">→ Pick a rep</option>{reps.map((p) => <option key={p.id} value={p.id}>→ {p.name}</option>)}</Sel>
            </div>
            <Chips values={r.values ?? []} onChange={(vals) => setConfig({ rules: c.rules.map((x: any, j: number) => (j === i ? { ...x, values: vals } : x)) })} options={r.field === "product" ? shared.products.map((p) => p.name) : r.field === "platform" ? ["facebook", "instagram"] : NG_STATES} />
            <button type="button" className="!min-h-0 text-[13px] text-rose-600" onClick={() => setConfig({ rules: c.rules.filter((_: any, j: number) => j !== i) })}>Remove rule</button>
          </div>
        ))}
        <button type="button" onClick={() => setConfig({ rules: [...(c.rules ?? []), { field: "state", values: [], repId: "" }] })} className={`${btn.ghost} !py-2 !text-[14px]`}><Plus className="h-4 w-4" />Add rule</button>
        <b className="block text-[15px]">If no rule matches</b>
        <Sel value={c.fallbackRepId ?? ""} onChange={(v) => setConfig({ fallbackRepId: v || undefined })}><option value="">Next rep in turn</option>{reps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Sel>
      </>
    );
    default: return <p className="m-0 flex items-center gap-2 rounded-xl bg-gray-50 px-4 py-3 text-[15px] text-gray-600 dark:bg-slate-800"><Lock className="h-4 w-4" />Sending lead data to another app is not available yet. Remove this step.</p>;
  }
}

// ── 4. Schedule ───────────────────────────────────────────────────────────

function ScheduleStep({ cfg, update }: { cfg: BuilderConfig; update: (fn: (c: BuilderConfig) => BuilderConfig) => void }) {
  const s = cfg.schedule;
  const timed = cfg.trigger.key === "time_based";
  const [editHours, setEditHours] = useState(false);
  const set = (patch: Partial<BuilderConfig["schedule"]>) => update((c) => { c.schedule = { ...c.schedule, ...patch }; return c; });
  const modes = [
    { k: "immediate", title: "Run Immediately", sub: "Run as soon as conditions are met", Icon: Zap, disabled: timed, note: "Not for Time-Based" },
    { k: "scheduled", title: "Scheduled Time", sub: "Run at a specific date and time", Icon: CalendarDays, disabled: !timed, note: "Only for Time-Based" },
    { k: "delay", title: "Delay", sub: "Wait for a period, then run", Icon: Clock, disabled: timed, note: "Not for Time-Based" },
    { k: "recurring", title: "Recurring", sub: "Run at regular intervals", Icon: RefreshCw, disabled: !timed, note: "Only for Time-Based" }
  ] as const;
  const firstRun = s.date ? `${new Date(`${s.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} at ${minuteLabel(Number((s.time ?? "10:00").slice(0, 2)) * 60 + Number((s.time ?? "10:00").slice(3)))} (WAT)` : "—";
  const delayParts = s.delayMinutes % 1440 === 0 ? [s.delayMinutes / 1440, "days"] : s.delayMinutes % 60 === 0 ? [s.delayMinutes / 60, "hours"] : [s.delayMinutes, "minutes"];
  return (
    <>
      <StepHead icon={CalendarDays} title="4. Schedule" sub="Set when and how often this automation should run." />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {modes.map((m) => (
          <button key={m.k} type="button" disabled={m.disabled} title={m.disabled ? m.note : undefined} onClick={() => set({ mode: m.k, repeat: m.k === "recurring" ? true : m.k === "scheduled" ? s.repeat : false })}
            className={`!min-h-0 flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left disabled:cursor-not-allowed disabled:opacity-40 ${s.mode === m.k ? "border-[#8B5CF6] bg-[#F4F0FE] dark:bg-violet-500/15" : "border-gray-200 dark:border-slate-700"}`}>
            <m.Icon className="h-8 w-8 shrink-0 text-[#5B21E6]" /><span><b className={`block text-[16.5px] ${s.mode === m.k ? "text-[#5B21E6]" : ""}`}>{m.title}</b><span className="text-[13.5px] text-gray-600">{m.disabled ? m.note : m.sub}</span></span>
          </button>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,1fr)]">
        <Panel>
          <b className="block text-[19px]">Schedule Details</b>
          <label className="mt-3 block"><span className="mb-1 block text-[15px] font-semibold">When to Run</span>
            <Sel value={s.mode} onChange={(v) => set({ mode: v as any })} icon={<CalendarDays className="h-5 w-5" />} className="w-full">{modes.filter((m) => !m.disabled).map((m) => <option key={m.k} value={m.k}>{m.title}</option>)}</Sel>
          </label>
          {s.mode === "delay" && (
            <div className="mt-3 grid grid-cols-2 gap-3"><label><span className="mb-1 block text-[15px] font-semibold">Wait</span><input type="number" min={1} className={`${field} !border-2 !py-3`} value={delayParts[0]} onChange={(e) => set({ delayMinutes: Math.max(1, Number(e.target.value) || 1) * (delayParts[1] === "days" ? 1440 : delayParts[1] === "hours" ? 60 : 1) })} /></label>
              <label><span className="mb-1 block text-[15px] font-semibold">Unit</span><Sel value={String(delayParts[1])} onChange={(v) => set({ delayMinutes: Number(delayParts[0]) * (v === "days" ? 1440 : v === "hours" ? 60 : 1) })} className="w-full"><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></Sel></label></div>
          )}
          {(s.mode === "scheduled" || s.mode === "recurring") && (
            <>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <label><span className="mb-1 block text-[15px] font-semibold">Date <span className="text-rose-500">*</span></span><input type="date" className={`${field} !border-2 !py-3`} value={s.date ?? ""} onChange={(e) => set({ date: e.target.value })} /></label>
                <label><span className="mb-1 block text-[15px] font-semibold">Time <span className="text-rose-500">*</span></span><input type="time" className={`${field} !border-2 !py-3`} value={s.time ?? "10:00"} onChange={(e) => set({ time: e.target.value })} /></label>
              </div>
              <label className="mt-3 block"><span className="mb-1 block text-[15px] font-semibold">Timezone</span><Sel value="lagos" onChange={() => undefined} icon={<Globe className="h-5 w-5" />} className="w-full"><option value="lagos">(GMT+01:00) West Africa Time – Lagos</option></Sel></label>
              <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-800">
                <div className="flex items-start gap-3"><Switch on={s.repeat || s.mode === "recurring"} onChange={(v) => set({ repeat: v, mode: v ? s.mode : "scheduled" })} label="Repeat" /><span><b className="block text-[16px]">Repeat (Optional)</b><span className="text-[14px] text-gray-600">Run this automation on a recurring basis.</span></span></div>
                {(s.repeat || s.mode === "recurring") && (
                  <>
                    <div className="mt-3 grid grid-cols-[1fr_120px_auto] items-end gap-3">
                      <label><span className="mb-1 block text-[15px] font-semibold">Frequency</span><Sel value={s.frequency} onChange={(v) => set({ frequency: v as any })} className="w-full"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly (every 30 days)</option></Sel></label>
                      <label><span className="mb-1 block text-[15px] font-semibold">Every</span><Sel value={String(s.every)} onChange={(v) => set({ every: Number(v) })} className="w-full">{[1, 2, 3, 4, 5, 6, 7, 14, 30].map((n) => <option key={n} value={n}>{n}</option>)}</Sel></label>
                      <span className="pb-3 text-[15px]">{s.frequency === "weekly" ? "week(s)" : s.frequency === "monthly" ? "month(s)" : "day(s)"}</span>
                    </div>
                    <span className="mt-3 block text-[15px] font-semibold">Ends</span>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {([["never", "Never"], ["on_date", "On a date"], ["after", "After"]] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => set({ ends: k })} className={`!min-h-0 inline-flex items-center gap-2 rounded-xl border-2 px-4 py-2.5 text-[15px] ${s.ends === k ? "border-[#8B5CF6] bg-[#F4F0FE] dark:bg-violet-500/15" : "border-gray-200 dark:border-slate-700"}`}>
                          {s.ends === k ? <CheckCircle2 className="h-5 w-5 text-[#5B21E6]" fill="#5B21E6" stroke="white" /> : <span className="h-5 w-5 rounded-full border-2 border-gray-300" />}{l}
                          {k === "on_date" && s.ends === "on_date" && <input type="date" className="rounded-lg border border-gray-200 px-2 py-1 text-[14px] dark:border-slate-700 dark:bg-slate-900" value={s.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value })} onClick={(e) => e.stopPropagation()} />}
                          {k === "after" && <><input type="number" min={1} className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-[14px] dark:border-slate-700 dark:bg-slate-900" value={s.endAfter} onChange={(e) => set({ endAfter: Math.max(1, Number(e.target.value) || 1), ends: "after" })} onClick={(e) => e.stopPropagation()} />runs</>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
          {s.mode === "immediate" && <p className="m-0 mt-3 text-[14.5px] text-gray-600">Runs the moment the trigger happens and the conditions are met.</p>}
        </Panel>
        <div className="space-y-5">
          <Panel>
            <div className="flex items-start gap-3"><span className="flex-1"><b className="block text-[18px]">Working Hours (Optional)</b><span className="text-[14px] text-gray-600">Only run this automation within your business hours.</span></span><Switch on={s.workingHoursOnly} onChange={(v) => set({ workingHoursOnly: v })} label="Working hours only" /></div>
            <div className="mt-3 flex items-center gap-2">
              <span className="flex flex-1 items-center gap-2 rounded-xl bg-[#F4F0FE] px-4 py-3 text-[16px] font-semibold dark:bg-violet-500/10"><Clock className="h-5 w-5 text-[#5B21E6]" />{daysText(s.days)}, {minuteLabel(s.startMinute)} – {minuteLabel(s.endMinute)}</span>
              <button type="button" onClick={() => setEditHours((v) => !v)} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border-2 border-gray-200 px-4 py-2.5 text-[15.5px] font-semibold dark:border-slate-700"><Pencil className="h-4 w-4" />Edit</button>
            </div>
            {editHours && (
              <div className="mt-3 space-y-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap gap-3">{[1, 2, 3, 4, 5, 6, 0].map((d) => <label key={d} className="flex items-center gap-1.5 text-[14.5px]"><input type="checkbox" className="h-4 w-4 accent-[#5B21E6]" checked={s.days.includes(d)} onChange={() => set({ days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] })} />{DAY_NAMES[d]}</label>)}</div>
                <div className="flex items-center gap-2"><Sel value={String(s.startMinute)} onChange={(v) => set({ startMinute: Number(v) })} className="flex-1">{TIMES.map((m) => <option key={m} value={m}>{minuteLabel(m)}</option>)}</Sel>–<Sel value={String(s.endMinute)} onChange={(v) => set({ endMinute: Number(v) })} className="flex-1">{[...TIMES.slice(1), 1440].map((m) => <option key={m} value={m}>{m === 1440 ? "Midnight" : minuteLabel(m)}</option>)}</Sel></div>
              </div>
            )}
          </Panel>
          <Panel>
            <div className="flex items-center gap-3"><span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#F1EEFD] text-[#5B21E6]"><CalendarDays className="h-6 w-6" /></span><span><b className="block text-[18px]">Schedule Preview</b><span className="text-[14px] text-gray-600">A summary of when this automation will run.</span></span></div>
            <div className="mt-3 space-y-4 rounded-2xl bg-[#F4F0FE] px-5 py-4 dark:bg-violet-500/10">
              {[
                { Icon: Play, title: timed ? "First Run" : "Starts", text: timed ? firstRun : s.mode === "delay" ? `${delayParts[0]} ${delayParts[1]} after the trigger` : "As soon as the trigger happens" },
                ...(timed && (s.repeat || s.mode === "recurring") ? [{ Icon: Repeat, title: "Then Repeats", text: `${s.frequency === "daily" ? "Daily" : s.frequency === "weekly" ? "Weekly" : "Monthly"}, every ${s.every} ${s.frequency === "weekly" ? "week" : s.frequency === "monthly" ? "month" : "day"}${s.every === 1 ? "" : "s"}${s.ends === "after" ? `, ${s.endAfter} runs` : s.ends === "on_date" && s.endDate ? `, until ${s.endDate}` : ""}` }] : []),
                { Icon: Clock, title: "Runs Within", text: s.workingHoursOnly ? `${daysText(s.days)}, ${minuteLabel(s.startMinute)} – ${minuteLabel(s.endMinute)}` : "Any time" }
              ].map((x, i, arr) => (
                <div key={x.title} className="relative flex items-start gap-4 pl-6">
                  <span className="absolute left-0 top-2 h-3 w-3 rounded-full bg-[#5B21E6]" />{i < arr.length - 1 && <span className="absolute left-[5px] top-5 h-[calc(100%+4px)] w-0.5 bg-[#5B21E6]/60" />}
                  <x.Icon className="mt-0.5 h-6 w-6 text-[#5B21E6]" /><span><b className="block text-[16px]">{x.title}</b><span className="text-[15px]">{x.text}</span></span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

// ── 5. Settings ───────────────────────────────────────────────────────────

function Box2({ icon: Icon, title, sub, children }: { icon: ComponentType<{ className?: string }>; title: string; sub: string; children: ReactNode }) {
  return <Panel><div className="flex items-center gap-3"><span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#F1EEFD] text-[#5B21E6]"><Icon className="h-6 w-6" /></span><span><b className="block text-[19px]">{title}</b><span className="text-[14.5px] text-gray-600">{sub}</span></span></div><div className="mt-4">{children}</div></Panel>;
}

function SettingsStep({ cfg, update, name, setName, description, setDescription, status, setStatus }: {
  cfg: BuilderConfig; update: (fn: (c: BuilderConfig) => BuilderConfig) => void; name: string; setName: (v: string) => void; description: string; setDescription: (v: string) => void;
  status: "active" | "paused" | "draft"; setStatus: (v: "active" | "paused" | "draft") => void;
}) {
  const g = cfg.settings;
  const set = (patch: Partial<BuilderConfig["settings"]>) => update((c) => { c.settings = { ...c.settings, ...patch }; return c; });
  return (
    <>
      <StepHead icon={Settings} title="5. Settings" sub="Configure advanced settings for this automation." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Box2 icon={Settings} title="General Settings" sub="Customize the basic behavior.">
          <label className="block"><span className="mb-1 block text-[16px] font-semibold">Automation Name <span className="text-rose-500">*</span></span>
            <span className="relative block"><input maxLength={100} className={`${field} !border-2 !py-3 !pr-16 !text-[16px]`} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Welcome New Customer" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-[14px] text-gray-500">{name.length}/100</span></span></label>
          <label className="mt-3 block"><span className="mb-1 block text-[16px] font-semibold">Description (Optional)</span>
            <span className="relative block"><textarea maxLength={500} rows={2} className={`${field} !border-2 !text-[16px]`} value={description} onChange={(e) => setDescription(e.target.value)} /><span className="absolute bottom-2 right-3 text-[13px] text-gray-500">{description.length}/500</span></span></label>
          <span className="mt-3 block text-[16px] font-semibold">Status</span>
          <div className="mt-1 flex items-center gap-3"><Switch on={status === "active"} onChange={(v) => setStatus(v ? "active" : "paused")} label="Active" />
            <Sel value={status} onChange={(v) => setStatus(v as any)} className="w-[170px]"><option value="active">● Active</option><option value="paused">Paused</option><option value="draft">Draft</option></Sel></div>
        </Box2>
        <Box2 icon={Bell} title="Notifications" sub="Get notified when this automation runs.">
          <div className="flex items-start gap-3 py-2"><Switch on={g.notifyOwner} onChange={(v) => set({ notifyOwner: v })} label="Notify me" /><span><b className="block text-[16px]">Notify Me (Owner/Admin)</b><span className="text-[14px] text-gray-600">Receive an alert each time it runs</span></span></div>
          <div className="flex items-start gap-3 py-2"><Switch on={g.notifyTeam} onChange={(v) => set({ notifyTeam: v })} label="Notify sales team" /><span><b className="block text-[16px]">Notify Sales Team</b><span className="text-[14px] text-gray-600">Alert the rep on the lead</span></span></div>
          <div className="mt-2 flex items-center gap-3 border-t border-gray-100 pt-3 dark:border-slate-800"><span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-[#5B21E6] dark:border-slate-700"><Bell className="h-5 w-5" /></span>
            <Sel value={g.channel} onChange={(v) => set({ channel: v as any })} className="flex-1"><option value="inapp">In-App</option><option value="inapp_push">In-App & Phone pop-up</option><option value="email" disabled>Email & In-App (email not available yet)</option></Sel></div>
        </Box2>
        <Box2 icon={ShieldCheck} title="Limits & Controls" sub="Set limits to avoid misuse.">
          <div className="grid grid-cols-[1fr_170px_auto] items-center gap-3">
            <span className="flex items-center gap-1.5 text-[16px] font-semibold">Max Runs Per Customer<Info className="h-4 w-4 text-gray-500" /></span><input type="number" min={0} className={`${field} !border-2 !py-2.5`} value={g.maxRunsPerCustomer} onChange={(e) => set({ maxRunsPerCustomer: Math.max(0, Number(e.target.value) || 0) })} /><span className="text-[15px]">times</span>
            <span className="flex items-center gap-1.5 text-[16px] font-semibold">Cool Down Period<Info className="h-4 w-4 text-gray-500" /></span><input type="number" min={0} className={`${field} !border-2 !py-2.5`} value={g.coolDownDays} onChange={(e) => set({ coolDownDays: Math.max(0, Number(e.target.value) || 0) })} /><span className="text-[15px]">day(s)</span>
            <span className="flex items-center gap-1.5 text-[16px] font-semibold">Stop After<Info className="h-4 w-4 text-gray-500" /></span><span className="flex items-center gap-2"><Switch on={g.stopAfterEnabled} onChange={(v) => set({ stopAfterEnabled: v })} label="Stop after" /><input type="number" min={1} disabled={!g.stopAfterEnabled} className="w-20 rounded-lg border-2 border-gray-200 px-2 py-1.5 text-[15px] disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900" value={g.stopAfterDays} onChange={(e) => set({ stopAfterDays: Math.max(1, Number(e.target.value) || 1) })} /></span><span className="text-[15px]">days</span>
          </div>
          <p className="m-0 mt-2 text-[12.5px] text-gray-500">0 runs = no limit. Stop After pauses the automation that many days after it was made.</p>
        </Box2>
        <Box2 icon={Globe} title="Language & Advanced" sub="Set language and advanced options.">
          <div className="grid grid-cols-[150px_1fr] items-center gap-3">
            <b className="text-[16px]">Language</b><Sel value="en-NG" onChange={() => undefined}><option value="en-NG">🇳🇬 English (Nigeria)</option></Sel>
            <b className="flex items-center gap-1.5 text-[16px]">Track Performance<Info className="h-4 w-4 text-gray-500" /></b><span className="flex items-center gap-3"><Switch on={g.trackPerformance} onChange={(v) => set({ trackPerformance: v })} label="Track performance" /><span className="text-[14.5px]">Track replies and conversions</span></span>
            <b className="flex items-center gap-1.5 self-start pt-2 text-[16px]">Custom Parameters<Info className="h-4 w-4 text-gray-500" /></b>
            <div className="space-y-2">
              {g.params.map((p, i) => <div key={i} className="flex items-center gap-2"><input className={`${field} !py-2`} placeholder="name" value={p.key} onChange={(e) => set({ params: g.params.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/[^\w]/g, "") } : x)) })} /><input className={`${field} !py-2`} placeholder="value" value={p.value} onChange={(e) => set({ params: g.params.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} /><button type="button" aria-label="Remove" onClick={() => set({ params: g.params.filter((_, j) => j !== i) })} className="!min-h-0 text-gray-400 hover:text-rose-600"><X className="h-5 w-5" /></button></div>)}
              <button type="button" onClick={() => set({ params: [...g.params, { key: "", value: "" }] })} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border-2 border-gray-200 px-4 py-2 text-[15px] font-semibold text-[#5B21E6] dark:border-slate-700"><Plus className="h-4 w-4" />Add Parameter</button>
              {g.params.some((p) => p.key) && <p className="m-0 text-[12.5px] text-gray-500">Use in messages as {g.params.filter((p) => p.key).map((p) => `{{${p.key}}}`).join(", ")}.</p>}
            </div>
          </div>
        </Box2>
      </div>
    </>
  );
}

