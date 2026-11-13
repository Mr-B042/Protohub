import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  Bell, Building2, CheckCircle2, ChevronDown, Clock, Code2, Copy, ExternalLink, Eye, FileText, Headphones, Infinity as InfinityIcon, KeyRound, Layers, Link2, Loader2, MessageSquareText,
  MoreHorizontal, Plug, Plus, RefreshCw, Save, Search, Settings, Settings2, ShieldCheck, Sparkles, Star, Undo2, UserCog, Users, Zap, RotateCcw, Puzzle, Activity, Send, Mail, FileSpreadsheet,
  Target, LineChart as LineIcon, Workflow, Shield, UserPlus, Lock, ShieldAlert, X, CircleCheck
} from "lucide-react";
import { socialLeadsApi, type SlPrefs, type SlSettings } from "../../lib/api";
import { FacebookIcon, InstagramIcon } from "../../components/SocialIcons";
import { WhatsAppIcon } from "../../components/WhatsAppIcon";
import { Avatar, Bar, Card, ChangeLine, Empty, IconTile, Modal, Pill, RateChip, Select, Switch, btn, field, money, timeAgo } from "./sl-ui";
import { useLoad } from "./sl-data";
import { LogsModal } from "./AutomationsTab";
import { SlaSection, LeadConversationSection, NotificationsSection, TemplatesSection, WorkingHoursSection, AccessSection, AdvancedSection } from "./SettingsSections";
import type { Shared } from "./SocialLeadsPage";
import DirectMetaPanel from "./DirectMetaPanel";

/** Settings: ten sections, each to Bright's design (12 Nov 2026). */

export type Draft = { prefs: SlPrefs; sla: SlSettings["sla"]; autoAssign: boolean; telegramAlerts: boolean; maxOpenPerRep: number };
export type Ctx = {
  s: SlSettings; d: Draft; set: (fn: (d: Draft) => Draft) => void; setPrefs: (patch: Partial<SlPrefs>) => void;
  save: () => Promise<void>; discard: () => void; dirty: boolean; saving: boolean; shared: Shared; reload: () => void; replace: (s: SlSettings) => void;
  go: (section: SectionKey) => void;
};
export type SectionKey = "general" | "integrations" | "team" | "sla" | "lead" | "notifications" | "templates" | "hours" | "access" | "advanced";

const NAV: Array<{ key: SectionKey; title: string; sub: string; Icon: ComponentType<{ className?: string }> }> = [
  { key: "general", title: "General", sub: "Basic inbox and business settings", Icon: Settings },
  { key: "integrations", title: "Integrations", sub: "Direct Meta, ManyChat & social accounts", Icon: Puzzle },
  { key: "team", title: "Team & Assignment", sub: "Manage call reps and lead routing", Icon: Users },
  { key: "sla", title: "Response & SLA", sub: "Set response time and escalations", Icon: MessageSquareText },
  { key: "lead", title: "Lead & Conversation", sub: "Statuses, tags and custom fields", Icon: Sparkles },
  { key: "notifications", title: "Notifications", sub: "In-app, email and Telegram alerts", Icon: Bell },
  { key: "templates", title: "Templates & Quick Replies", sub: "Saved replies, offers and scripts", Icon: FileText },
  { key: "hours", title: "Working Hours", sub: "Set business hours and auto-replies", Icon: Clock },
  { key: "access", title: "Access & Permissions", sub: "Role access and team controls", Icon: UserCog },
  { key: "advanced", title: "Advanced", sub: "Webhooks, API and data sync", Icon: Settings2 }
];

const draftOf = (s: SlSettings): Draft => JSON.parse(JSON.stringify({ prefs: s.prefs, sla: s.sla, autoAssign: s.autoAssign, telegramAlerts: s.telegramAlerts, maxOpenPerRep: s.maxOpenPerRep }));

export default function SettingsTab({ shared }: { shared: Shared }) {
  const initial = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("section") as SectionKey | null;
  const [section, setSection] = useState<SectionKey>(initial && NAV.some((n) => n.key === initial) ? initial : "general");
  const loaded = useLoad(() => socialLeadsApi.settings(), "settings");
  const [s, setS] = useState<SlSettings | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (loaded.data) { setS(loaded.data); setD(draftOf(loaded.data)); } }, [loaded.data]);
  const dirty = useMemo(() => Boolean(s && d && JSON.stringify(draftOf(s)) !== JSON.stringify(d)), [s, d]);
  if (loaded.error) return <Card className="p-6 text-[14px] text-rose-700">{loaded.error}</Card>;
  if (!s || !d) return <Card className="flex items-center justify-center p-10 text-[14px] text-gray-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading settings…</Card>;

  const replace = (next: SlSettings) => { setS(next); setD(draftOf(next)); shared.refreshHeader(); };
  const ctx: Ctx = {
    s, d, dirty, saving, shared,
    set: (fn) => setD((cur) => (cur ? fn(cur) : cur)),
    setPrefs: (patch) => setD((cur) => (cur ? { ...cur, prefs: { ...cur.prefs, ...patch } } : cur)),
    discard: () => setD(draftOf(s)),
    save: async () => {
      setSaving(true);
      try { replace(await socialLeadsApi.saveSettings({ prefs: d.prefs, sla: d.sla, autoAssign: d.autoAssign, telegramAlerts: d.telegramAlerts, maxOpenPerRep: d.maxOpenPerRep })); shared.onToast("Settings saved."); }
      catch (e) { shared.onToast((e as Error).message || "Could not save."); } finally { setSaving(false); }
    },
    reload: loaded.reload, replace,
    go: (k) => { setSection(k); window.scrollTo({ top: 0, behavior: "smooth" }); }
  };
  const go = (k: SectionKey) => { setSection(k); const [path, q = ""] = window.location.hash.split("?"); const p = new URLSearchParams(q); p.set("section", k); window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${path}?${p.toString()}`); };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
      <Card className="h-fit p-3 lg:sticky lg:top-4">
        <div className="px-2 pb-3 pt-1">
          <h2 className="m-0 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">Settings</h2>
          <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Configure your social leads inbox, integrations, team, and workflows.</p>
        </div>
        <nav className="space-y-1" aria-label="Settings sections">
          {NAV.map((n) => (
            <button key={n.key} type="button" onClick={() => go(n.key)} className={`!min-h-0 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ${section === n.key ? "bg-[#F1EEFD] dark:bg-violet-500/15" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
              <n.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${section === n.key ? "text-[#5B3FD9]" : "text-gray-600 dark:text-slate-400"}`} />
              <span className="leading-snug"><b className={`block text-[14px] ${section === n.key ? "text-[#5B3FD9] dark:text-violet-200" : "text-gray-900 dark:text-slate-100"}`}>{n.title}</b><span className="text-[12px] text-gray-500 dark:text-slate-400">{n.sub}</span></span>
            </button>
          ))}
        </nav>
      </Card>
      <div className="min-w-0 space-y-4">
        {section === "general" && <GeneralSection ctx={ctx} />}
        {section === "integrations" && <IntegrationsSection ctx={ctx} />}
        {section === "team" && <TeamSection ctx={ctx} />}
        {section === "sla" && <SlaSection ctx={ctx} />}
        {section === "lead" && <LeadConversationSection ctx={ctx} />}
        {section === "notifications" && <NotificationsSection ctx={ctx} />}
        {section === "templates" && <TemplatesSection ctx={ctx} />}
        {section === "hours" && <WorkingHoursSection ctx={ctx} />}
        {section === "access" && <AccessSection ctx={ctx} />}
        {section === "advanced" && <AdvancedSection ctx={ctx} />}
        {dirty && (
          <div className="sticky bottom-3 z-10 flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[13.5px] text-gray-700 dark:text-slate-300">You have changes that are not saved.</span>
            <span className="flex gap-2"><button type="button" onClick={ctx.discard} className={btn.ghost}>Discard Changes</button><button type="button" onClick={() => void ctx.save()} disabled={saving} className={btn.primary}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save Changes</button></span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Shared pieces for the sections ────────────────────────────────────────

export function SectionHeader({ icon, title, sub, right }: { icon: ComponentType<{ className?: string }>; title: string; sub: string; right?: ReactNode }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 px-4 py-3">
      <IconTile icon={icon} />
      <div className="min-w-[240px] flex-1"><h2 className="m-0 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">{title}</h2><p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">{sub}</p></div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </Card>
  );
}
export function Box({ icon, title, sub, right, children, className = "" }: { icon?: ComponentType<{ className?: string }>; title: ReactNode; sub?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && <IconTile icon={icon} size="md" />}
          <div className="min-w-0"><h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">{title}</h3>{sub && <p className="m-0 text-[12.5px] text-gray-500 dark:text-slate-400">{sub}</p>}</div>
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </Card>
  );
}
export function ToggleRow({ label, sub, on, onChange, disabled, note, icon }: { label: ReactNode; sub?: ReactNode; on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; note?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      {icon}
      <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-medium text-gray-800 dark:text-slate-200">{label}</span>{sub && <span className="block text-[12px] text-gray-500 dark:text-slate-400">{sub}</span>}{note && <span className="block text-[11.5px] text-amber-700 dark:text-amber-300">{note}</span>}</span>
      <Switch on={on} onChange={(v) => onChange?.(v)} label={typeof label === "string" ? label : "Setting"} disabled={disabled || !onChange} />
    </div>
  );
}
export const NotYet = ({ children = "Not available yet" }: { children?: ReactNode }) => <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-[11.5px] font-semibold text-gray-500 dark:bg-slate-800 dark:text-slate-400"><Lock className="h-3 w-3" />{children}</span>;
export const KpiTile = ({ icon, tone = "purple", value, label, change, unit, extra }: { icon: ComponentType<{ className?: string }>; tone?: string; value: ReactNode; label: string; change?: number | null; unit?: string; extra?: ReactNode }) => (
  <Card className="flex min-w-0 items-center gap-3 px-4 py-3.5">
    <IconTile icon={icon} tone={tone} />
    <div className="min-w-0"><b className="block text-[21px] font-extrabold leading-7 text-gray-900 dark:text-slate-50">{value}</b><span className="block text-[12.5px] font-medium leading-tight text-gray-600 dark:text-slate-400">{label}</span>{change !== undefined && <ChangeLine change={change} unit={unit} />}{extra}</div>
  </Card>
);
export const minuteLabel = (m: number) => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
export const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => ({ value: String(i * 30), label: minuteLabel(i * 30) }));
export const DAYS = [{ n: 1, l: "Mon" }, { n: 2, l: "Tue" }, { n: 3, l: "Wed" }, { n: 4, l: "Thu" }, { n: 5, l: "Fri" }, { n: 6, l: "Sat" }, { n: 0, l: "Sun" }];
export const daysLabel = (days: number[]) => {
  const set = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (set.join() === "1,2,3,4,5,6") return "Mon – Sat";
  if (set.join() === "1,2,3,4,5") return "Mon – Fri";
  if (set.length === 7) return "Every day";
  return set.map((n) => DAYS.find((d) => d.n === n)?.l).join(", ");
};
export function DayChecks({ days, onChange }: { days: number[]; onChange: (d: number[]) => void }) {
  return (
    <span className="flex flex-wrap gap-3">
      {DAYS.map((d) => (
        <label key={d.n} className="flex cursor-pointer items-center gap-1.5 text-[13.5px]"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={days.includes(d.n)} onChange={() => onChange(days.includes(d.n) ? days.filter((x) => x !== d.n) : [...days, d.n])} />{d.l}</label>
      ))}
    </span>
  );
}
export const copyText = (shared: Shared, text: string, what = "Copied.") => { void navigator.clipboard?.writeText(text); shared.onToast(what); };
export const openAppPage = (hash: string) => { window.location.hash = hash; };

// ── General ───────────────────────────────────────────────────────────────

function GeneralSection({ ctx }: { ctx: Ctx }) {
  const { s, d, setPrefs, shared } = ctx;
  const p = d.prefs;
  const [kw, setKw] = useState("");
  const reps = shared.reps.filter((r) => r.role === "Sales Rep");
  return (
    <>
      <SectionHeader icon={Settings} title="General Settings" sub="Manage your inbox preferences and core social leads configurations." right={<>
        <button type="button" onClick={ctx.discard} disabled={!ctx.dirty} className={btn.ghost}>Discard Changes</button>
        <button type="button" onClick={() => void ctx.save()} disabled={!ctx.dirty || ctx.saving} className={btn.primary}>{ctx.saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save Changes</button>
      </>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Box icon={Layers} title="Inbox Information">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold">Inbox Name</span><input className={field} value={p.inboxName} onChange={(e) => setPrefs({ inboxName: e.target.value })} /></label>
          <label className="mt-3 block"><span className="mb-1 block text-[13px] font-semibold">Description</span><textarea rows={3} className={field} value={p.description} onChange={(e) => setPrefs({ description: e.target.value })} /></label>
        </Box>
        <Box icon={Building2} title="Business & Timezone">
          <label className="block"><span className="mb-1 block text-[13px] font-semibold">Business Name</span><input className={field} value={p.businessName} onChange={(e) => setPrefs({ businessName: e.target.value })} /></label>
          <label className="mt-3 block"><span className="mb-1 block text-[13px] font-semibold">Timezone</span><select className={field} value={p.timezone} onChange={(e) => setPrefs({ timezone: e.target.value })}><option value="Africa/Lagos">(GMT+01:00) West Africa Time – Lagos</option></select><span className="text-[11.5px] text-gray-500">Protohub counts every branch's hours in Lagos time for now.</span></label>
          <div className="mt-3"><span className="mb-1.5 block text-[13px] font-semibold">Working Days</span><DayChecks days={p.workingDays} onChange={(days) => setPrefs({ workingDays: days })} /></div>
        </Box>
        <Box icon={Link2} title="Social Integrations (Manychat)" sub="Connect and manage your Manychat and social media accounts.">
          {[
            { icon: <InfinityIcon className="h-7 w-7 text-[#2F5BEA]" />, name: "Manychat Workspace", sub: s.pageName ?? "Not connected", on: s.connected },
            { icon: <FacebookIcon className="h-7 w-7" />, name: "Facebook Page", sub: s.facebook ? "Leads arriving" : "No Facebook event yet", on: s.facebook },
            { icon: <InstagramIcon className="h-7 w-7" />, name: "Instagram Account", sub: s.instagram ? "Leads arriving" : "No Instagram event yet", on: s.instagram }
          ].map((r) => (
            <div key={r.name} className="flex items-center gap-3 border-b border-gray-100 py-2.5 last:border-0 dark:border-slate-800">
              {r.icon}<span className="min-w-0 flex-1"><b className="block text-[14px]">{r.name}</b><span className="text-[12.5px] text-gray-500">{r.sub}</span></span>
              <Pill tone={r.on ? "green" : "slate"}>{r.on ? "Connected" : "Not connected"}</Pill>
              <button type="button" onClick={() => ctx.go("integrations")} className={`${btn.ghost} !py-1.5 !text-[13px]`}>Manage<ExternalLink className="h-3.5 w-3.5" /></button>
            </div>
          ))}
        </Box>
        <Box icon={RefreshCw} title="Lead Capture & Sync" sub="Control how leads are captured from comments/messages and synced to OSM.">
          <ToggleRow label="Capture Facebook ad comments as leads" on={p.captureFacebookComments} onChange={(v) => setPrefs({ captureFacebookComments: v })} />
          <ToggleRow label="Capture Instagram comments as leads" on={p.captureInstagramComments} onChange={(v) => setPrefs({ captureInstagramComments: v })} />
          <ToggleRow label="Capture Messenger DMs as leads" on={p.captureMessenger} onChange={(v) => setPrefs({ captureMessenger: v })} />
          <ToggleRow label="Create leads automatically in OSM" on={p.autoCreate} onChange={(v) => setPrefs({ autoCreate: v })} />
          <ToggleRow label="Prevent duplicate leads (same user)" sub="One lead per ManyChat contact, always on. Matching by phone too: Advanced." on={true} />
        </Box>
        <Box icon={Users} title="Lead Assignment" sub="How new leads are assigned to call reps.">
          <div className="grid grid-cols-[150px_1fr] items-center gap-3 text-[13.5px]">
            <span className="font-medium">Assignment Method</span>
            <Select label="Assignment method" value={p.distributeByWorkload ? "workload" : "turn"} onChange={(v) => setPrefs({ distributeByWorkload: v === "workload" })} options={[{ value: "turn", label: "Smart Round-Robin (Recommended)" }, { value: "workload", label: "Fewest open leads first" }]} />
            <span className="font-medium">Eligible Reps</span>
            <span className="flex flex-wrap gap-1.5">
              {reps.length === 0 && <span className="text-gray-500">No active Sales Rep.</span>}
              {reps.map((r) => {
                const on = !p.eligibleRepIds.length || p.eligibleRepIds.includes(r.id);
                return <button key={r.id} type="button" onClick={() => { const cur = p.eligibleRepIds.length ? p.eligibleRepIds : reps.map((x) => x.id); const next = on ? cur.filter((x) => x !== r.id) : [...cur, r.id]; setPrefs({ eligibleRepIds: next.length === reps.length ? [] : next }); }}
                  className={`!min-h-0 inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[12.5px] font-semibold ${on ? "border-[#C9BEF5] bg-[#F5F2FE] text-gray-900 dark:bg-violet-500/15 dark:text-slate-100" : "border-gray-200 text-gray-400 line-through"}`}><Avatar name={r.name} src={r.avatar} size={20} />{r.name}{on && <X className="h-3 w-3" />}</button>;
              })}
            </span>
            <span className="font-medium">Max Open Leads per Rep</span>
            <span className="flex items-center gap-2"><input type="number" min={0} max={500} className={`${field} !w-28`} value={d.maxOpenPerRep} onChange={(e) => ctx.set((x) => ({ ...x, maxOpenPerRep: Math.max(0, Number(e.target.value) || 0) }))} /><Switch on={p.maxOpenEnabled} onChange={(v) => setPrefs({ maxOpenEnabled: v })} label="Use max open leads" /><span className="text-[12px] text-gray-500">{p.maxOpenEnabled ? "On" : "Off"}</span></span>
          </div>
          <div className="mt-2 border-t border-gray-100 pt-2 dark:border-slate-800"><ToggleRow label="Keep returning customers with the same rep (Sticky Assignment)" on={p.sticky} onChange={(v) => setPrefs({ sticky: v })} /></div>
          <p className="m-0 mt-1 text-[12px] text-gray-500">Paused reps (Round-Robin) never get social leads, the same as carts.</p>
        </Box>
        <Box icon={Zap} title="Response & Automation Controls" sub="Control automation and human handover for conversations.">
          <ToggleRow label="Pause automation when assigned to a call rep" sub="Sets the protohub_human field in ManyChat so your flows stay quiet." on={p.pauseBotOnAssign} onChange={(v) => setPrefs({ pauseBotOnAssign: v })} />
          <ToggleRow label="Auto-assign new leads during working hours only" on={p.assignInHoursOnly} onChange={(v) => setPrefs({ assignInHoursOnly: v })} />
          <ToggleRow label="Allow reps to resume automation after conversation" on={p.allowRepResumeBot} onChange={(v) => setPrefs({ allowRepResumeBot: v })} />
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Auto-close inactive conversations after</span><Select label="Auto-close after" className="w-[150px]" value={String(p.autoCloseDays)} onChange={(v) => setPrefs({ autoCloseDays: Number(v) })} options={[{ value: "0", label: "Never" }, ...[3, 7, 14, 30].map((n) => ({ value: String(n), label: `${n} Days` }))]} /></div>
          <div className="py-2">
            <span className="block text-[13.5px] font-medium">Set lead as “Hot” when keyword is detected</span>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 p-2 dark:border-slate-700">
              {p.hotKeywords.map((k) => <span key={k} className="inline-flex items-center gap-1 rounded-lg bg-[#F1EEFD] px-2 py-1 text-[12.5px] font-semibold text-[#5B3FD9]">{k}<button type="button" aria-label={`Remove ${k}`} className="!min-h-0" onClick={() => setPrefs({ hotKeywords: p.hotKeywords.filter((x) => x !== k) })}><X className="h-3 w-3" /></button></span>)}
              <input value={kw} onChange={(e) => setKw(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && kw.trim()) { e.preventDefault(); setPrefs({ hotKeywords: [...new Set([...p.hotKeywords, kw.trim().toLowerCase()])] }); setKw(""); } }} placeholder="Type a word, press Enter" className="min-w-[160px] flex-1 border-0 bg-transparent px-1 py-1 text-[13px] focus:outline-none" />
            </div>
          </div>
        </Box>
      </div>
    </>
  );
}

// ── Integrations ──────────────────────────────────────────────────────────

type IntegrationData = {
  kpis: { connected: { value: number }; available: { value: number }; dataSync: { value: number; change: number | null }; health: { value: number | null; failed: number } };
  cards: Array<{ key: string; name: string; connected: boolean; unavailable?: boolean; description: string; lastSync: string | null; manage: string | null }>;
  webhookUrl: string; keyHint: string | null;
};
const CARD_ICON: Record<string, ReactNode> = {
  manychat: <InfinityIcon className="h-8 w-8 text-[#2F5BEA]" />, facebook: <FacebookIcon className="h-8 w-8" />, instagram: <InstagramIcon className="h-8 w-8" />,
  whatsapp: <WhatsAppIcon className="h-8 w-8 text-[#25D366]" />, telegram: <Send className="h-7 w-7 text-sky-500" />, mailjet: <Mail className="h-7 w-7 text-violet-500" />,
  sheets: <FileSpreadsheet className="h-7 w-7 text-emerald-600" />, capi: <InfinityIcon className="h-8 w-8 text-[#0866FF]" />
};
const PAGE_HASH: Record<string, string> = { "WhatsApp": "#/dashboard/admin/whatsapp", "Telegram Bot": "#/dashboard/admin/telegram-bot", "Email Marketing": "#/dashboard/admin/email-marketing", "Tracking Hub": "#/dashboard/admin/tracking-hub" };
const AVAILABLE = [
  { name: "Shopify", cat: "E-commerce", text: "Connect your store, orders and products.", color: "text-emerald-600" },
  { name: "Paystack", cat: "Payments", text: "Accept online payments and confirm orders.", color: "text-sky-500" },
  { name: "Flutterwave", cat: "Payments", text: "Receive payments and auto-update orders.", color: "text-amber-500" },
  { name: "Zapier", cat: "Automation", text: "Automate workflows between your tools.", color: "text-orange-500" },
  { name: "Google Drive", cat: "Storage", text: "Store product media, reports and backup files.", color: "text-yellow-500" }
];

export function SetupGuide({ webhookUrl, onCopy }: { webhookUrl: string; onCopy: (t: string) => void }) {
  const steps = [
    "ManyChat › Settings › API: copy the API key (a Pro plan is needed) and paste it under ManyChat below.",
    "ManyChat › Settings › Fields: create a custom field “protohub_human” (Yes/No). In your Default Reply flow add a condition “protohub_human is not Yes” so the bot stays quiet while a rep chats.",
    "In your comment flow (trigger: user comments on your ad), after the private message add Action › External Request: POST to the address below with ?event=comment&flow=<flow name>&product=<product>. Body: Add Full Contact Data.",
    "In the Default Reply flow (every customer message) add the same External Request with ?event=message. That brings each message into the Inbox.",
    "Optional: after a bot message add ?event=bot so the bot's words show in the conversation too."
  ];
  return (
    <div className="space-y-2">
      <ol className="m-0 space-y-1.5 pl-5 text-[13px] text-gray-800 dark:text-slate-200">{steps.map((x) => <li key={x}>{x}</li>)}</ol>
      <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-800">{webhookUrl}</code><button type="button" className={`${btn.ghost} !py-1.5`} onClick={() => onCopy(webhookUrl)}><Copy className="h-4 w-4" />Copy</button></div>
      <p className="m-0 text-[12px] text-gray-500">Keep this address private: anyone with it can add leads to your inbox. Make a new one under Advanced if it leaks.</p>
    </div>
  );
}

function IntegrationsSection({ ctx }: { ctx: Ctx }) {
  const { s, d, setPrefs, shared } = ctx;
  const data = useLoad(() => socialLeadsApi.section<IntegrationData>("integrations"), `integrations-${s.connectedAt}`);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState("");
  const [modal, setModal] = useState<"" | "logs" | "docs">("");
  const [q, setQ] = useState(""), [cat, setCat] = useState("all");
  const i = data.data;
  const connect = async () => {
    setBusy("connect");
    try { ctx.replace(await socialLeadsApi.saveSettings({ apiKey: key })); setKey(""); shared.onToast("ManyChat connected."); data.reload(); }
    catch (e) { shared.onToast((e as Error).message); } finally { setBusy(""); }
  };
  const cards = (i?.cards ?? []).filter((c) => (!q || c.name.toLowerCase().includes(q.toLowerCase())) && (cat === "all" || (cat === "social" ? ["manychat", "facebook", "instagram", "whatsapp", "telegram"].includes(c.key) : cat === "marketing" ? ["mailjet", "capi"].includes(c.key) : c.key === "sheets")));
  const toggleFor = (k: string): { on: boolean; set?: (v: boolean) => void } => {
    if (k === "manychat") return { on: d.prefs.autoCreate, set: (v) => setPrefs({ autoCreate: v }) };
    if (k === "facebook") return { on: d.prefs.captureFacebookComments || d.prefs.captureMessenger, set: (v) => setPrefs({ captureFacebookComments: v, captureMessenger: v }) };
    if (k === "instagram") return { on: d.prefs.captureInstagramComments, set: (v) => setPrefs({ captureInstagramComments: v }) };
    return { on: Boolean(i?.cards.find((c) => c.key === k)?.connected) };
  };
  return (
    <>
      <SectionHeader icon={Puzzle} title="Integrations" sub="Connect ProtoHub OSM with your favourite tools to capture leads, communicate, automate and grow sales." right={<>
        <button type="button" onClick={() => setModal("logs")} className={btn.ghost}><FileText className="h-4 w-4" />Integration Logs</button>
        <button type="button" onClick={() => document.getElementById("sl-available")?.scrollIntoView({ behavior: "smooth" })} className={btn.primary}><Plus className="h-4 w-4" />Browse Integrations</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile icon={Layers} value={i?.kpis.connected.value ?? "—"} label="Connected Integrations" />
        <KpiTile icon={Link2} value={i?.kpis.available.value ?? "—"} label="Not Connected" />
        <KpiTile icon={RefreshCw} tone="green" value={(i?.kpis.dataSync.value ?? 0).toLocaleString()} label="Data Sync (Last 7 Days)" change={i?.kpis.dataSync.change ?? null} />
        <KpiTile icon={Zap} value={i?.kpis.health.value !== null && i ? `${i.kpis.health.value}%` : "—"} label="System Health" extra={i && <span className={`text-[12px] font-semibold ${i.kpis.health.failed ? "text-amber-600" : "text-emerald-600"}`}>{i.kpis.health.failed ? `${i.kpis.health.failed} event(s) failed this week` : i.kpis.dataSync.value ? "No failed event this week" : "No event yet"}</span>} />
      </div>
      <DirectMetaPanel shared={shared} />
      <Box icon={InfinityIcon} title="ManyChat connection" sub={s.connected ? `Connected to ${s.pageName ?? "your Page"} · key ${s.keyHint}` : "Paste your ManyChat API key to send replies and read flows."} right={s.connected && <span className="flex gap-2">
        <button type="button" className={`${btn.ghost} !py-2`} onClick={async () => { try { const r = await socialLeadsApi.testConnection(); shared.onToast(`ManyChat answered: ${r.pageName}.`); } catch (e) { shared.onToast((e as Error).message); } }}>Test</button>
        <button type="button" className={`${btn.ghost} !py-2 !text-rose-600`} onClick={async () => { if (!window.confirm("Disconnect ManyChat? Replies stop until you connect it again.")) return; ctx.replace(await socialLeadsApi.saveSettings({ disconnect: true })); data.reload(); }}>Disconnect</button>
      </span>}>
        {s.connectionError && <p className="m-0 mb-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{s.connectionError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input type="password" autoComplete="off" className={`${field} !w-auto min-w-[260px] flex-1`} placeholder={s.connected ? "Paste a new key to replace it" : "ManyChat API key"} value={key} onChange={(e) => setKey(e.target.value)} />
          <button type="button" disabled={!key.trim() || busy === "connect"} onClick={connect} className={btn.primary}>{busy === "connect" && <Loader2 className="h-4 w-4 animate-spin" />}{s.connected ? "Replace key" : "Connect ManyChat"}</button>
          <button type="button" onClick={() => setModal("docs")} className={btn.ghost}><FileText className="h-4 w-4" />How to set up</button>
        </div>
      </Box>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Box icon={MessageSquareText} title={`Connected Integrations (${i?.kpis.connected.value ?? 0})`} sub={i && i.kpis.connected.value ? "● Active and working properly." : "Nothing connected yet."} right={<span className="flex gap-2">
          <span className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search integrations..." className="w-[200px] rounded-xl border border-gray-200 py-2 pl-9 pr-2 text-[13px] dark:border-slate-700 dark:bg-slate-900" /></span>
          <Select label="Category" className="w-[150px]" value={cat} onChange={setCat} options={[{ value: "all", label: "All Categories" }, { value: "social", label: "Social & messaging" }, { value: "marketing", label: "Marketing" }, { value: "data", label: "Data" }]} />
        </span>}>
          {!i && <Empty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Empty>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {cards.map((c) => {
              const t = toggleFor(c.key);
              return (
                <div key={c.key} className="flex flex-col rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                  <div className="flex items-start gap-2">{CARD_ICON[c.key]}<span className="min-w-0 flex-1"><b className="block text-[14px]">{c.name}</b>{c.unavailable ? <NotYet /> : <Pill tone={c.connected ? "green" : "slate"}>{c.connected ? "Connected" : "Not connected"}</Pill>}</span></div>
                  <p className="m-0 mt-2 flex-1 text-[12.5px] text-gray-600 dark:text-slate-400">{c.description}</p>
                  <span className="mt-2 text-[12px] text-gray-500">📅 Last sync: {c.lastSync ? timeAgo(c.lastSync) : "—"}</span>
                  <div className="mt-2 flex items-center justify-between">
                    <Switch on={t.on} onChange={(v) => t.set?.(v)} label={`${c.name} on`} disabled={!t.set} />
                    {c.manage && <button type="button" onClick={() => c.manage!.startsWith("page:") ? openAppPage(PAGE_HASH[c.manage!.slice(5)] ?? "#/dashboard/admin/settings") : setModal("docs")} className={`${btn.ghost} !px-3 !py-1.5 !text-[12.5px]`}>Manage<ExternalLink className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        </Box>
        <div className="space-y-4">
          <Box icon={Code2} title="Webhooks & API" sub="Connect external apps and automate data exchange.">
            <span className="text-[12.5px] font-semibold">Webhook URL (ManyChat posts here)</span>
            <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 px-2 py-2 text-[12px] dark:border-slate-700">{s.webhookUrl}</code><button type="button" aria-label="Copy" onClick={() => copyText(shared, s.webhookUrl)} className={`${btn.icon} !h-9 !w-9`}><Copy className="h-4 w-4" /></button></div>
            <span className="mt-3 block text-[12.5px] font-semibold">ManyChat API Key</span>
            <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 px-2 py-2 text-[12px] dark:border-slate-700">{i?.keyHint ?? "Not added"}</code><button type="button" disabled className={`${btn.icon} !h-9 !w-9`} title="The key is never shown again after saving"><Copy className="h-4 w-4" /></button></div>
            <div className="mt-3 flex gap-2"><button type="button" onClick={() => setModal("docs")} className={`${btn.ghost} flex-1 !py-2 !text-[13px]`}><FileText className="h-4 w-4" />API Docs</button><button type="button" onClick={async () => { if (!window.confirm("Make a new address? The old one stops working, so update it in every ManyChat flow.")) return; ctx.replace(await socialLeadsApi.newAddress()); data.reload(); shared.onToast("New address made. Paste it into ManyChat."); }} className={`${btn.primary} flex-1 !py-2 !text-[13px]`}><RotateCcw className="h-4 w-4" />Regenerate</button></div>
          </Box>
          <Box icon={RefreshCw} title="Sync & Automation" sub="Control how data syncs across your tools.">
            <ToggleRow label="Auto-sync new leads" on={d.prefs.autoCreate} onChange={(v) => setPrefs({ autoCreate: v })} />
            <ToggleRow label="Sync order & delivery updates" sub="Always on: a delivered order marks its lead Delivered." on={true} />
            <ToggleRow label="Sync customer data (CRM)" on={false} note={<NotYet />} />
            <ToggleRow label="Retry failed syncs automatically" sub="ManyChat retries a request that failed; Protohub keeps the first copy only." on={false} note={<NotYet />} />
          </Box>
        </div>
      </div>
      <Box className="scroll-mt-4" icon={Plug} title="Available Integrations" sub="Discover more tools to supercharge your sales and operations.">
        <div id="sl-available" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {AVAILABLE.map((a) => (
            <div key={a.name} className="flex flex-col items-start rounded-xl border border-gray-200 p-3 dark:border-slate-700">
              <span className="flex items-center gap-2"><Star className={`h-6 w-6 ${a.color}`} /><b className="text-[14px]">{a.name}</b></span>
              <Pill tone="purple" className="mt-1">{a.cat}</Pill>
              <p className="m-0 mt-2 flex-1 text-[12.5px] text-gray-600 dark:text-slate-400">{a.text}</p>
              <button type="button" disabled className={`${btn.primary} mt-3 w-full !py-2 !text-[13px]`}>Not available yet</button>
            </div>
          ))}
          <div className="flex flex-col items-start rounded-xl border border-dashed border-gray-300 p-3 dark:border-slate-700">
            <b className="flex items-center gap-1 text-[14px]"><Plus className="h-4 w-4" />Request Integration</b>
            <p className="m-0 mt-2 flex-1 text-[12.5px] text-gray-600 dark:text-slate-400">Can't find the tool you need? Tell us and we'll add it.</p>
            <button type="button" onClick={() => openAppPage("#/dashboard/admin/report-a-bug")} className={`${btn.ghost} mt-3 w-full !py-2 !text-[13px]`}>Request Now</button>
          </div>
        </div>
      </Box>
      {modal === "logs" && <LogsModal onClose={() => setModal("")} />}
      {modal === "docs" && <Modal title="Set up ManyChat" icon={FileText} onClose={() => setModal("")} width="max-w-[720px]"><SetupGuide webhookUrl={s.webhookUrl} onCopy={(t) => copyText(shared, t)} /></Modal>}
    </>
  );
}

// ── Team & Assignment ─────────────────────────────────────────────────────

type TeamData = {
  kpis: { members: { value: number; change: number }; activeReps: { value: number }; assigned: { value: number; change: number | null }; responseRate: { value: number | null; change: number | null }; revenue: { value: number; change: number | null } };
  members: Array<{ id: string; name: string; role: string; avatar: string | null; active: boolean; inRotation: boolean; assigned: number; converted: number; deliveryRate: number | null }>;
  roles: Array<{ role: string; count: number }>;
  workload: Array<{ id: string; name: string; open: number; pct: number | null }>;
};
const ROLE_CHIP: Record<string, string> = { "Sales Rep": "purple", "Head of Sales": "purple", "Recovery Rep": "blue", "Sales Closer": "green", Manager: "amber", Admin: "slate", Owner: "slate" };
const ROLE_LABEL: Record<string, string> = { "Sales Rep": "Call Rep", "Recovery Rep": "Recovery" };

function TeamSection({ ctx }: { ctx: Ctx }) {
  const { d, setPrefs, shared } = ctx;
  const data = useLoad(() => socialLeadsApi.section<TeamData>("team"), "team");
  const [q, setQ] = useState(""), [role, setRole] = useState("all");
  const [member, setMember] = useState<TeamData["members"][number] | null>(null);
  const t = data.data;
  const members = (t?.members ?? []).filter((m) => (role === "all" || m.role === role) && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  const ROLE_TILES: Array<{ role: string; label: string; sub: string; Icon: ComponentType<{ className?: string }> }> = [
    { role: "Admin", label: "Admin", sub: "Full system access", Icon: Users }, { role: "Manager", label: "Manager", sub: "Team, leads & reports", Icon: Users },
    { role: "Sales Rep", label: "Call Rep", sub: "Handle, follow-up & convert leads", Icon: Headphones }, { role: "Recovery Rep", label: "Recovery", sub: "Follow-up & win back leads", Icon: ShieldCheck },
    { role: "Sales Closer", label: "Sales Closer", sub: "Close qualified & high-value leads", Icon: Target }
  ];
  return (
    <>
      <SectionHeader icon={Users} title="Team & Assignment" sub="Manage your team, roles, lead assignment, and workload distribution." right={<>
        <button type="button" onClick={() => document.getElementById("sl-assign")?.scrollIntoView({ behavior: "smooth" })} className={btn.ghost}><Settings className="h-4 w-4 text-[#5B3FD9]" />Assignment Rules</button>
        <button type="button" onClick={() => openAppPage("#/dashboard/admin/user-management")} className={btn.primary}><Plus className="h-4 w-4" />Add Team Member</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile icon={Users} value={t?.kpis.members.value ?? "—"} label="Team Members" extra={t && t.kpis.members.change > 0 ? <span className="text-[12px] font-bold text-emerald-600">↑ +{t.kpis.members.change} this month</span> : undefined} />
        <KpiTile icon={Headphones} tone="indigo" value={t?.kpis.activeReps.value ?? "—"} label="Active Call Reps" />
        <KpiTile icon={Layers} value={(t?.kpis.assigned.value ?? 0).toLocaleString()} label="Assigned Leads (30 days)" change={t?.kpis.assigned.change ?? null} />
        <KpiTile icon={RefreshCw} tone="green" value={t?.kpis.responseRate.value !== null && t ? `${t.kpis.responseRate.value}%` : "—"} label="Team Response Rate" change={t?.kpis.responseRate.change ?? null} unit="pp" />
        <KpiTile icon={Star} tone="amber" value={money(t?.kpis.revenue.value)} label="Team Converted Revenue" change={t?.kpis.revenue.change ?? null} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Box icon={Users} title={`Team Members (${t?.members.length ?? 0})`} right={<span className="flex gap-2"><span className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search team members..." className="w-[200px] rounded-xl border border-gray-200 py-2 pl-9 pr-2 text-[13px] dark:border-slate-700 dark:bg-slate-900" /></span><Select label="Role" className="w-[140px]" value={role} onChange={setRole} options={[{ value: "all", label: "All Roles" }, ...[...new Set((t?.members ?? []).map((m) => m.role))].map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))]} /></span>}>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead><tr>{["#", "Member", "Role", "Status", "Assigned", "Converted", "DR", "Actions"].map((h) => <th key={h} className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">{h}</th>)}</tr></thead>
              <tbody>
                {!t && <tr><td colSpan={8}><Empty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Empty></td></tr>}
                {members.map((m, i) => (
                  <tr key={m.id} className="border-t border-gray-100 dark:border-slate-800 [&>td]:px-2 [&>td]:py-2 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                    <td><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${i === 0 && m.assigned ? "bg-amber-400 text-white" : "bg-gray-100 text-gray-600 dark:bg-slate-800"}`}>{i + 1}</span></td>
                    <td><span className="flex items-center gap-2"><Avatar name={m.name} src={m.avatar} size={30} /><b>{m.name}</b></span></td>
                    <td><Pill tone={ROLE_CHIP[m.role] ?? "slate"}>{ROLE_LABEL[m.role] ?? m.role}</Pill></td>
                    <td><span className={`inline-flex items-center gap-1 text-[13px] font-semibold ${m.role === "Sales Rep" && !m.inRotation ? "text-amber-600" : "text-emerald-600"}`}><span className={`h-2 w-2 rounded-full ${m.role === "Sales Rep" && !m.inRotation ? "bg-amber-500" : "bg-emerald-500"}`} />{m.role === "Sales Rep" && !m.inRotation ? "Paused" : "Active"}</span></td>
                    <td>{m.assigned}</td><td>{m.assigned ? m.converted : "—"}</td><td>{m.deliveryRate !== null ? <RateChip value={m.deliveryRate} /> : "—"}</td>
                    <td><span className="flex gap-1"><button type="button" aria-label={`View ${m.name}`} onClick={() => setMember(m)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"><Eye className="h-[18px] w-[18px]" /></button><button type="button" aria-label="More" onClick={() => openAppPage("#/dashboard/admin/user-management")} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-[18px] w-[18px]" /></button></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
        <Card id="sl-assign" className="p-4">
          <div className="flex items-center gap-2.5"><IconTile icon={Layers} size="md" /><h3 className="m-0 text-[16px] font-bold">Lead Assignment Settings</h3></div>
          <div className="mt-3 flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Assignment Method</span><Select label="Assignment method" className="w-[230px]" value={d.prefs.distributeByWorkload ? "workload" : "turn"} onChange={(v) => setPrefs({ distributeByWorkload: v === "workload" })} options={[{ value: "turn", label: "Smart Round-Robin (Recommended)" }, { value: "workload", label: "Fewest open leads first" }]} /></div>
          <ToggleRow label="Auto-assign new leads to call reps" on={d.autoAssign} onChange={(v) => ctx.set((x) => ({ ...x, autoAssign: v }))} />
          <ToggleRow label="Distribute leads equally by workload" on={d.prefs.distributeByWorkload} onChange={(v) => setPrefs({ distributeByWorkload: v })} />
          <ToggleRow label="Skip inactive reps" sub="Always: paused or deactivated reps get no lead." on={true} />
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Reassign unresponded leads after</span><Select label="Reassign after" className="w-[140px]" value={String(d.sla.reassign)} onChange={(v) => ctx.set((x) => ({ ...x, sla: { ...x.sla, reassign: Number(v) } }))} options={[10, 15, 20, 30, 45, 60].map((n) => ({ value: String(n), label: `${n} Minutes` }))} /><Switch on={d.prefs.reassignEnabled} onChange={(v) => setPrefs({ reassignEnabled: v })} label="Reassign on" /></div>
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Set max active leads per rep</span><input type="number" min={0} max={500} className={`${field} !w-24`} value={d.maxOpenPerRep} onChange={(e) => ctx.set((x) => ({ ...x, maxOpenPerRep: Math.max(0, Number(e.target.value) || 0) }))} /><Switch on={d.prefs.maxOpenEnabled} onChange={(v) => setPrefs({ maxOpenEnabled: v })} label="Max leads on" /></div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Box icon={Shield} title="Role & Permissions" sub="Manage team roles and what each member can access." right={<button type="button" onClick={() => ctx.go("access")} className="!min-h-0 text-[13px] font-semibold text-[#2F5BEA] underline">Manage Roles →</button>}>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-5">
            {ROLE_TILES.map((r) => {
              const count = t?.roles.find((x) => x.role === r.role)?.count ?? 0;
              return <div key={r.role} className="rounded-xl border border-gray-200 p-3 text-center dark:border-slate-700"><span className="inline-flex items-center gap-1 rounded-lg bg-[#F1EEFD] px-2 py-1 text-[#5B3FD9]"><r.Icon className="h-4 w-4" />{count}</span><b className="mt-2 block text-[14px]">{r.label}</b><span className="block text-[11.5px] text-gray-500">{r.sub}</span><span className="mt-1 block text-[12.5px] font-semibold">{count} {count === 1 ? "person" : "people"}</span></div>;
            })}
          </div>
        </Box>
        <Box icon={LineIcon} title="Workload Distribution (Call Reps)" sub="Open leads per active call rep.">
          <div className="space-y-3">
            {(t?.workload ?? []).length === 0 && <p className="m-0 text-[13px] text-gray-500">No active call rep.</p>}
            {(t?.workload ?? []).map((w) => <div key={w.id} className="flex items-center gap-2.5 text-[13.5px]"><Avatar name={w.name} size={26} /><span className="w-24 truncate font-medium">{w.name}</span><b className="w-10 text-right">{w.open}</b><span className="flex-1"><Bar pct={w.pct} /></span><span className="w-12 text-right text-gray-500">{w.pct ?? 0}%</span></div>)}
          </div>
        </Box>
      </div>
      {member && <Modal title={member.name} sub={ROLE_LABEL[member.role] ?? member.role} onClose={() => setMember(null)}>
        <div className="grid grid-cols-3 gap-2">{[["Assigned (30 days)", member.assigned], ["Converted", member.converted], ["Delivery rate", member.deliveryRate !== null ? `${member.deliveryRate}%` : "—"]].map(([k, v]) => <div key={String(k)} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700"><span className="block text-[12px] text-gray-500">{k}</span><b className="text-[18px]">{v}</b></div>)}</div>
        <p className="m-0 mt-3 text-[13px] text-gray-600">{member.role === "Sales Rep" ? (member.inRotation ? "In the hand-out turn order." : "Paused from hand-out (Round-Robin page).") : "Not in the hand-out turn order: leads reach them by transfer."}</p>
      </Modal>}
    </>
  );
}

