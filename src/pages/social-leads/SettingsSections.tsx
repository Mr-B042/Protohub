import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, BarChart3, Bell, BellRing, BookOpen, CalendarDays, CalendarPlus, CheckCircle2, Clock, Code2, Copy, Database, Download, FileText, Filter, Flame, Gauge, Globe2, Headphones,
  Layers, Lock, Mail, MessageSquareText, MoreHorizontal, Pause, PencilLine, Phone, Play, Plus, RefreshCw, RotateCcw, Search, Send, Server, Settings2, Shield, ShieldCheck, Smartphone, Sparkles, Store,
  Tag, Timer, Upload, UserPlus, Users, X, Zap, Eye, Repeat, Copy as CopyIcon, MonitorSmartphone, Package
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { socialLeadsApi, type SlLeadDetail, type SlLeadRow, type SlTemplate } from "../../lib/api";
import { PlatformIcon } from "../../components/SocialIcons";
import { WhatsAppIcon } from "../../components/WhatsAppIcon";
import { Avatar, Card, Empty, Modal, Pill, RateChip, STATUS, Select, StatusChip, Switch, btn, downloadCsv, duration, field, lagosDateTime, lagosTime, money, shortAgo, timeAgo } from "./sl-ui";
import { useLoad, useStats } from "./sl-data";
import { LogsModal } from "./AutomationsTab";
import { Box, DAYS, DayChecks, KpiTile, NotYet, SectionHeader, SetupGuide, TIME_OPTIONS, ToggleRow, copyText, daysLabel, minuteLabel, openAppPage, type Ctx } from "./SettingsTab";
import { fillTemplate } from "./InboxTab";

// ── Response & SLA ────────────────────────────────────────────────────────

type SlaData = {
  kpis: { firstResponse: { value: number | null; change: number | null }; totalResponse: { value: number | null; change: number | null }; compliance: { value: number | null; change: number | null }; withinSla: { value: number; of: number; change: number | null } };
  within: number; breached: number; days: Array<{ day: string; compliance: number | null }>;
  reps: Array<{ id: string; name: string; role: string; avatar: string | null; first: number | null; total: number | null; compliance: number | null; conversations: number }>;
};
const RULE_ICON = { new: Users, follow_up: MessageSquareText, hot: Flame, returning: Repeat } as const;
const ESCALATE = ["Manager", "Admin", "Owner", "Sales Closer", "Head of Sales"];

export function SlaSection({ ctx }: { ctx: Ctx }) {
  const { d, setPrefs, shared } = ctx;
  const data = useLoad(() => socialLeadsApi.section<SlaData>("sla"), "sla");
  const [modal, setModal] = useState<"" | "logs" | "message">("");
  const k = data.data?.kpis;
  const setRule = (key: string, patch: Record<string, unknown>) => setPrefs({ slaRules: d.prefs.slaRules.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const chart = (data.data?.days ?? []).map((x) => ({ label: new Date(`${x.day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }), compliance: x.compliance }));
  const total = (data.data?.within ?? 0) + (data.data?.breached ?? 0);
  return (
    <>
      <SectionHeader icon={Clock} title="Response & SLA" sub="Set response targets, working hours, and escalation rules for faster lead engagement." right={<>
        <button type="button" onClick={() => setModal("logs")} className={btn.ghost}><FileText className="h-4 w-4" />SLA Logs</button>
        <button type="button" onClick={() => { document.getElementById("sl-sla-rules")?.scrollIntoView({ behavior: "smooth" }); shared.onToast("Every lead falls under one of these four rules; change their minutes here."); }} className={btn.primary}><Plus className="h-4 w-4" />Add SLA Rule</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile icon={Zap} value={duration(k?.firstResponse.value)} label="Avg. First Response" change={k?.firstResponse.change ?? null} />
        <KpiTile icon={Clock} value={duration(k?.totalResponse.value)} label="Avg. Total Response" change={k?.totalResponse.change ?? null} />
        <KpiTile icon={Gauge} value={k?.compliance.value !== null && k ? `${k.compliance.value}%` : "—"} label="SLA Compliance" change={k?.compliance.change ?? null} unit="pp" />
        <KpiTile icon={Users} value={k ? `${k.withinSla.value} / ${k.withinSla.of}` : "—"} label="Conversations Within SLA" extra={k?.withinSla.change !== null && k ? <span className={`text-[12px] font-bold ${k.withinSla.change! >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{k.withinSla.change! >= 0 ? "↑ +" : "↓ "}{k.withinSla.change} from last 7 days</span> : undefined} />
      </div>
      <p className="m-0 text-[12px] text-gray-500">Response times count working minutes only (a message at night counts from opening). Faster is better, so a fall shows in green.</p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card id="sl-sla-rules" className="p-4">
          <div className="flex items-center gap-2.5"><Timer className="h-6 w-6 text-[#5B3FD9]" /><div><h3 className="m-0 text-[16px] font-bold">SLA Rules</h3><p className="m-0 text-[12.5px] text-gray-500">Define response targets and actions when SLAs are not met.</p></div></div>
          <div className="mt-3 overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead className="bg-gray-50/80 dark:bg-slate-800/50"><tr>{["#", "Rule / Lead type", "First response", "Next response", "Escalation", "Status"].map((h) => <th key={h} className="px-2 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">{h}</th>)}</tr></thead>
              <tbody>
                {d.prefs.slaRules.map((r, i) => {
                  const Icon = RULE_ICON[r.key];
                  return (
                    <tr key={r.key} className="border-t border-gray-100 dark:border-slate-800 [&>td]:px-2 [&>td]:py-2 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                      <td><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${i === 0 ? "bg-amber-400 text-white" : "bg-gray-100 text-gray-600 dark:bg-slate-800"}`}>{i + 1}</span></td>
                      <td><span className="flex items-center gap-2"><Icon className={`h-4 w-4 ${r.key === "hot" ? "text-rose-500" : "text-[#5B3FD9]"}`} /><b className="font-semibold">{r.label}</b></span></td>
                      <td><span className="flex items-center gap-1">≤<input type="number" min={1} max={1440} value={r.first} onChange={(e) => setRule(r.key, { first: Math.max(1, Number(e.target.value) || 1) })} className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-[13px] dark:border-slate-700 dark:bg-slate-900" />minutes</span></td>
                      <td><span className="flex items-center gap-1">≤<input type="number" min={1} max={1440} value={r.next} onChange={(e) => setRule(r.key, { next: Math.max(1, Number(e.target.value) || 1) })} className="w-16 rounded-lg border border-gray-200 px-2 py-1 text-[13px] dark:border-slate-700 dark:bg-slate-900" />minutes</span></td>
                      <td><select value={r.escalateTo} onChange={(e) => setRule(r.key, { escalateTo: e.target.value })} className="rounded-lg border border-gray-200 px-2 py-1 text-[13px] dark:border-slate-700 dark:bg-slate-900">{ESCALATE.map((x) => <option key={x} value={x}>To {x}</option>)}</select></td>
                      <td><Switch on={r.enabled} onChange={(v) => setRule(r.key, { enabled: v })} label={`${r.label} on`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="m-0 mt-2 text-[12px] text-gray-500">At half the time the chat turns yellow, at the target red, at 1.5× the rep is reminded, at 2× the escalation goes out. A switched-off rule falls back to New Lead.</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between"><span className="flex items-center gap-2.5"><CalendarDays className="h-6 w-6 text-[#5B3FD9]" /><span><h3 className="m-0 text-[16px] font-bold">Working Hours</h3><span className="text-[12.5px] text-gray-500">Set when your team should respond to leads.</span></span></span><Pill tone={d.prefs.hoursEnabled ? "green" : "slate"}><CheckCircle2 className="h-3.5 w-3.5" />{d.prefs.hoursEnabled ? "Active" : "Off"}</Pill></div>
          <div className="mt-3 space-y-3 text-[13.5px]">
            <div className="flex items-center gap-3"><span className="w-[130px] font-medium">Business Days</span><button type="button" onClick={() => ctx.go("hours")} className={`${btn.ghost} flex-1 !justify-between !py-2 !text-[13.5px]`}>{daysLabel(d.prefs.workingDays)}<Settings2 className="h-4 w-4" /></button></div>
            <div className="flex items-center gap-3"><span className="w-[130px] font-medium">Working Hours</span><button type="button" onClick={() => ctx.go("hours")} className={`${btn.ghost} flex-1 !justify-between !py-2 !text-[13.5px]`}>{minuteLabel(d.prefs.startMinute)} – {minuteLabel(d.prefs.endMinute)}<Clock className="h-4 w-4" /></button></div>
            <div className="flex items-center gap-3"><span className="flex-1 font-medium">Auto-Reply (Off Hours)</span><Switch on={d.prefs.offHoursReply} onChange={(v) => setPrefs({ offHoursReply: v })} label="Off-hours auto-reply" /></div>
            <div className="flex items-center gap-3"><span className="flex-1 font-medium">Off-Hours Message</span><button type="button" onClick={() => setModal("message")} className={`${btn.ghost} !py-1.5 !text-[13px]`}><PencilLine className="h-4 w-4" />View / Edit</button></div>
          </div>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card className="p-4">
          <div className="flex items-center justify-between"><span className="flex items-center gap-2.5"><BarChart3 className="h-6 w-6 text-[#5B3FD9]" /><span><h3 className="m-0 text-[16px] font-bold">SLA Performance</h3><span className="text-[12.5px] text-gray-500">Your team's response performance against SLA targets.</span></span></span><Pill tone="slate">Last 7 Days</Pill></div>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_200px]">
            <div style={{ height: 190 }}>
              {chart.some((x) => x.compliance !== null) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <defs><linearGradient id="sl-sla" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6E55E8" stopOpacity={0.25} /><stop offset="1" stopColor="#6E55E8" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke="#E5E7EB" strokeOpacity={0.6} />
                    <XAxis dataKey="label" tick={{ fontSize: 11.5, fill: "#6B7280" }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11.5, fill: "#6B7280" }} tickLine={false} axisLine={false} width={44} />
                    <Tooltip formatter={(v) => `${v}%`} contentStyle={{ borderRadius: 12, fontSize: 12.5 }} />
                    <Area type="monotone" dataKey="compliance" name="SLA compliance" stroke="#6E55E8" strokeWidth={2} fill="url(#sl-sla)" connectNulls dot={{ r: 3.5, fill: "#fff", strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <Empty>No replies in the last 7 days.</Empty>}
            </div>
            <div className="rounded-xl bg-[#F7F5FF] p-3 dark:bg-violet-500/10">
              <span className="text-[12.5px] font-semibold">SLA Compliance</span>
              <b className="block text-[26px] font-extrabold">{k?.compliance.value !== null && k ? `${k.compliance.value}%` : "—"}</b>
              {k?.compliance.change !== null && k && <span className={`text-[12.5px] font-bold ${k.compliance.change! >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{k.compliance.change! >= 0 ? "↑ +" : "↓ "}{k.compliance.change}pp</span>}
              <div className="mt-2 space-y-1 text-[12.5px]"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><span className="flex-1">Within SLA</span><b>{data.data?.within ?? 0} ({total ? Math.round(((data.data?.within ?? 0) / total) * 100) : 0}%)</b></div><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-rose-500" /><span className="flex-1">Breached SLA</span><b>{data.data?.breached ?? 0} ({total ? Math.round(((data.data?.breached ?? 0) / total) * 100) : 0}%)</b></div></div>
            </div>
          </div>
        </Card>
        <Box icon={Bell} title="Escalation & Alerts" sub="Automate actions and notifications when SLA is at risk.">
          <ToggleRow label="Escalate to Team Lead when SLA is breached" sub="Goes to the role named in each rule." on={d.prefs.escalateOnBreach} onChange={(v) => setPrefs({ escalateOnBreach: v })} />
          <ToggleRow label="Notify Manager for repeated breaches (≥ 3)" sub="The third missed target of the day for one rep." on={d.prefs.notifyRepeatBreaches} onChange={(v) => setPrefs({ notifyRepeatBreaches: v })} />
          <ToggleRow label="Send daily SLA performance summary" sub="5:30 PM to the Owner, Admins and Managers." on={d.prefs.dailySlaSummary} onChange={(v) => setPrefs({ dailySlaSummary: v })} />
        </Box>
      </div>
      <Box icon={Users} title="Team Response Performance" sub="Individual rep performance on response time and SLA (last 7 days)." right={<button type="button" onClick={() => shared.goTab("team")} className="!min-h-0 text-[13px] font-semibold text-[#2F5BEA] underline">View Full Report →</button>}>
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full border-collapse">
            <thead><tr>{["#", "Team member", "Role", "Avg. first response", "Avg. total response", "SLA compliance", "Conversations", "Actions"].map((h) => <th key={h} className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">{h}</th>)}</tr></thead>
            <tbody>
              {!data.data && <tr><td colSpan={8}><Empty>Loading…</Empty></td></tr>}
              {data.data && !data.data.reps.length && <tr><td colSpan={8}><Empty>No replies in the last 7 days.</Empty></td></tr>}
              {(data.data?.reps ?? []).map((r, i) => (
                <tr key={r.id} className="border-t border-gray-100 dark:border-slate-800 [&>td]:px-2 [&>td]:py-2 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                  <td><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold ${i === 0 ? "bg-amber-400 text-white" : "bg-gray-100 text-gray-600"}`}>{i + 1}</span></td>
                  <td><span className="flex items-center gap-2"><Avatar name={r.name} src={r.avatar} size={28} /><b>{r.name}</b></span></td>
                  <td><Pill tone="purple">{r.role === "Sales Rep" ? "Call Rep" : r.role}</Pill></td>
                  <td>{duration(r.first)}</td><td>{duration(r.total)}</td><td><RateChip value={r.compliance} /></td><td>{r.conversations}</td>
                  <td><button type="button" aria-label="View" onClick={() => shared.goTab("team")} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><Eye className="h-[18px] w-[18px]" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
      {modal === "logs" && <LogsModal onClose={() => setModal("")} />}
      {modal === "message" && <Modal title="Off-Hours Message" sub="Sent once per quiet spell to a customer who writes outside working hours." icon={MessageSquareText} onClose={() => setModal("")} footer={<button type="button" className={btn.primary} onClick={() => setModal("")}>Done</button>}>
        <textarea rows={5} className={field} value={d.prefs.offHoursMessage} onChange={(e) => setPrefs({ offHoursMessage: e.target.value })} />
        <p className="m-0 mt-2 text-[12px] text-gray-500">Remember to Save Changes. It needs ManyChat connected.</p>
      </Modal>}
    </>
  );
}

// ── Lead & Conversations ──────────────────────────────────────────────────

export function LeadConversationSection({ ctx }: { ctx: Ctx }) {
  const { d, setPrefs, shared } = ctx;
  const stats = useStats({ range: "30d" });
  const c = stats.data?.cards;
  const [chip, setChip] = useState<"all" | "open" | "pending" | "resolved">("all");
  const [q, setQ] = useState(""), [showSearch, setShowSearch] = useState(false);
  const open = useLoad(() => socialLeadsApi.conversations("all", q), `all-${q}`, 20_000);
  const converted = useLoad(() => socialLeadsApi.conversations("converted", q), `conv-${q}`);
  const closed = useLoad(() => socialLeadsApi.conversations("closed", q), `closed-${q}`);
  const all = open.data?.conversations ?? [];
  const resolved = [...(converted.data?.conversations ?? []), ...(closed.data?.conversations ?? [])];
  const pending = all.filter((r) => r.awaitingSince);
  const openList = all.filter((r) => !["order_created", "delivered"].includes(r.status) && !r.awaitingSince);
  const rows = chip === "pending" ? pending : chip === "resolved" ? resolved : chip === "open" ? openList : [...all.filter((r) => !["order_created", "delivered"].includes(r.status)), ...resolved];
  const [picked, setPicked] = useState<string | null>(null);
  const [addField, setAddField] = useState(false);
  useEffect(() => { if (!picked && rows[0]) setPicked(rows[0].id); }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const chipOf = (r: SlLeadRow) => (["order_created", "delivered", "lost"].includes(r.status) ? "resolved" : r.awaitingSince ? "pending" : "open");
  return (
    <>
      <SectionHeader icon={MessageSquareText} title="Lead & Conversations" sub="Manage all customer conversations, lead details, statuses, tags and conversation workflows." right={<>
        <button type="button" onClick={() => ctx.go("general")} className={btn.ghost}><Settings2 className="h-4 w-4 text-[#5B3FD9]" />Conversation Rules</button>
        <button type="button" onClick={() => setAddField(true)} className={btn.primary}><Plus className="h-4 w-4" />Add Custom Field</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile icon={Users} value={(c?.total.value ?? 0).toLocaleString()} label="Total Leads" change={c?.total.change ?? null} />
        <KpiTile icon={MessageSquareText} tone="blue" value={(c?.active.value ?? 0).toLocaleString()} label="Active Conversations" change={c?.active.change ?? null} />
        <KpiTile icon={CheckCircle2} tone="green" value={(c?.resolved.value ?? 0).toLocaleString()} label="Resolved" change={c?.resolved.change ?? null} />
        <KpiTile icon={Filter} value={c?.conversion.value !== null && c ? `${c.conversion.value}%` : "—"} label="Conversion Rate" change={c?.conversion.change ?? null} unit="pp" />
        <KpiTile icon={Clock} value={duration(c?.avgResponseSeconds.value)} label="Avg. First Response" change={c?.avgResponseSeconds.change ?? null} />
        <KpiTile icon={MessageSquareText} value={duration(c?.avgResolutionSeconds.value)} label="Avg. Resolution" change={c?.avgResolutionSeconds.change ?? null} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_minmax(0,1fr)_330px]">
        <Card className="flex min-h-[560px] flex-col">
          <div className="flex items-center gap-1 px-4 pt-4"><h3 className="m-0 mr-auto text-[16px] font-bold">Conversations ({rows.length})</h3><button type="button" aria-label="Search" onClick={() => setShowSearch((v) => !v)} className={`${btn.icon} !h-9 !w-9 !border-0`}><Search className="h-4 w-4" /></button><button type="button" aria-label="Open the Inbox" onClick={() => shared.goTab("inbox")} className={`${btn.icon} !h-9 !w-9 !border-0`}><MoreHorizontal className="h-4 w-4" /></button></div>
          {showSearch && <div className="px-4 pt-2"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={`${field} !py-2`} /></div>}
          <div className="flex flex-wrap gap-1.5 px-4 pt-3">
            {([["all", "All", all.filter((r) => !["order_created", "delivered"].includes(r.status)).length + resolved.length], ["open", "Open", openList.length], ["pending", "Pending", pending.length], ["resolved", "Resolved", resolved.length]] as const).map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setChip(k)} className={`!min-h-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${chip === k ? "bg-[#5B3FD9] text-white" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300"}`}>{label} {n}</button>
            ))}
          </div>
          <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
            {!rows.length && <Empty>No conversation here.</Empty>}
            {rows.map((r) => (
              <button key={r.id} type="button" onClick={() => setPicked(r.id)} className={`!min-h-0 flex w-full gap-2.5 border-b border-gray-100 px-4 py-3 text-left dark:border-slate-800 ${picked === r.id ? "bg-[#F3F0FE] dark:bg-violet-500/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/60"}`}>
                <Avatar name={r.name} src={r.profilePic} size={40} platform={<PlatformIcon platform={r.platform} className="h-3.5 w-3.5" />} />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><b className="min-w-0 flex-1 truncate text-[14px]">{r.name}</b><span className="text-[11.5px] text-gray-500">{shortAgo(r.lastMessageAt)}</span></span>
                  <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[12.5px] text-gray-600">{r.preview}</span>{r.unread > 0 ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#5B3FD9] px-1 text-[11px] font-bold text-white">{r.unread}</span> : <Pill tone={chipOf(r) === "resolved" ? "green" : chipOf(r) === "pending" ? "amber" : "purple"}>{chipOf(r) === "resolved" ? "Resolved" : chipOf(r) === "pending" ? "Pending" : "Open"}</Pill>}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
        {picked ? <MiniConversation key={picked} id={picked} ctx={ctx} onChanged={() => { open.reload(); converted.reload(); closed.reload(); }} /> : <Card className="flex items-center justify-center xl:col-span-2"><Empty>Pick a conversation.</Empty></Card>}
      </div>
      <Box icon={Tag} title="Tags & Custom Fields" sub="The tags reps can add, and the extra fields on every lead.">
        <TagEditor tags={d.prefs.tagOptions} onChange={(t) => setPrefs({ tagOptions: t })} />
        <div className="mt-3 space-y-2">
          {d.prefs.customFields.map((f) => (
            <div key={f.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-[13.5px] dark:border-slate-700">
              <b className="w-40">{f.label}</b><Pill tone="slate">{f.type === "select" ? "Pick from list" : f.type === "money" ? "Amount (₦)" : "Text"}</Pill>
              {f.type === "select" && <span className="text-[12.5px] text-gray-500">{f.options.join(" · ")}</span>}
              <button type="button" aria-label={`Remove ${f.label}`} onClick={() => setPrefs({ customFields: d.prefs.customFields.filter((x) => x.key !== f.key) })} className="!min-h-0 ml-auto text-gray-400 hover:text-rose-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </Box>
      {addField && <CustomFieldModal onClose={() => setAddField(false)} onAdd={(f) => { setPrefs({ customFields: [...d.prefs.customFields, f] }); setAddField(false); shared.onToast("Field added. Save Changes to keep it."); }} />}
    </>
  );
}

function TagEditor({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [v, setV] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 p-2 dark:border-slate-700">
      {tags.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-[#F1EEFD] px-2 py-1 text-[12.5px] font-semibold text-[#5B3FD9]">{t}<button type="button" aria-label={`Remove ${t}`} className="!min-h-0" onClick={() => onChange(tags.filter((x) => x !== t))}><X className="h-3 w-3" /></button></span>)}
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && v.trim()) { e.preventDefault(); onChange([...new Set([...tags, v.trim()])]); setV(""); } }} placeholder="+ Add Tag (press Enter)" className="min-w-[160px] flex-1 border-0 bg-transparent px-1 py-1 text-[13px] focus:outline-none" />
    </div>
  );
}

function CustomFieldModal({ onClose, onAdd }: { onClose: () => void; onAdd: (f: { key: string; label: string; type: "select" | "text" | "money"; options: string[] }) => void }) {
  const [label, setLabel] = useState(""), [type, setType] = useState<"select" | "text" | "money">("text"), [options, setOptions] = useState("");
  return (
    <Modal title="Add Custom Field" icon={Plus} onClose={onClose} footer={<><button type="button" className={btn.ghost} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} disabled={!label.trim()} onClick={() => onAdd({ key: label.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40), label: label.trim(), type, options: type === "select" ? options.split(",").map((o) => o.trim()).filter(Boolean) : [] })}>Add Field</button></>}>
      <label className="block"><span className="mb-1 block text-[13px] font-semibold">Name</span><input className={field} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Preferred delivery day" /></label>
      <label className="mt-3 block"><span className="mb-1 block text-[13px] font-semibold">Kind</span><select className={field} value={type} onChange={(e) => setType(e.target.value as any)}><option value="text">Text</option><option value="select">Pick from list</option><option value="money">Amount (₦)</option></select></label>
      {type === "select" && <label className="mt-3 block"><span className="mb-1 block text-[13px] font-semibold">Choices (comma between)</span><input className={field} value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Monday, Wednesday, Friday" /></label>}
    </Modal>
  );
}

function MiniConversation({ id, ctx, onChanged }: { id: string; ctx: Ctx; onChanged: () => void }) {
  const { shared } = ctx;
  const [detail, setDetail] = useState<SlLeadDetail | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => socialLeadsApi.lead(id).then(setDetail).catch((e: Error) => shared.onToast(e.message));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const custom = useMemo(() => (detail as any)?.lead?.customFields ?? {}, [detail]);
  if (!detail) return <Card className="flex items-center justify-center xl:col-span-2"><Empty>Opening…</Empty></Card>;
  const l = detail.lead as SlLeadDetail["lead"] & { tags?: string[]; customFields?: Record<string, string> };
  const save = async (patch: Record<string, unknown>) => { try { await socialLeadsApi.update(id, patch); await load(); onChanged(); } catch (e) { shared.onToast((e as Error).message); } };
  const send = async () => { setBusy(true); try { await socialLeadsApi.send(id, { kind: "text", body: text }); setText(""); await load(); onChanged(); } catch (e) { shared.onToast((e as Error).message); } finally { setBusy(false); } };
  const msgs = detail.messages.filter((m) => m.direction !== "system" && m.direction !== "note").slice(-30);
  return (
    <>
      <Card className="flex min-h-[560px] min-w-0 flex-col">
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
          <Avatar name={l.name} src={l.profilePic} size={40} platform={<PlatformIcon platform={l.platform} className="h-3.5 w-3.5" />} />
          <span className="min-w-0 flex-1"><b className="block truncate text-[15px]">{l.name}</b><span className="text-[12.5px] text-gray-600">Lead · <Pill tone="purple">{["order_created", "delivered", "lost"].includes(l.status) ? "Resolved" : l.awaitingSince ? "Pending" : "Open"}</Pill> · Assigned to {l.assignedName ?? "nobody"}</span></span>
          {l.phone && <a href={`tel:${l.phone}`} aria-label="Call" className={`${btn.icon} !rounded-full`}><Phone className="h-4 w-4" /></a>}
          <button type="button" aria-label="Open in Inbox" onClick={() => shared.openLead(id)} className={`${btn.icon} !rounded-full`}><MoreHorizontal className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {!msgs.length && <Empty>No message yet.</Empty>}
          {msgs.map((m) => {
            const mine = m.direction === "out" || m.direction === "bot";
            return <div key={m.id} className={`flex ${mine ? "justify-end" : "items-end gap-2"}`}>{!mine && <Avatar name={l.name} src={l.profilePic} size={28} />}<div className="max-w-[78%]"><div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[14px] ${mine ? "bg-[#6E55E8] text-white" : "bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-slate-100"}`}>{m.body || (m.kind === "product" ? `🛍 ${m.payload?.productName ?? "Product card"}` : "")}</div><span className={`block text-[11px] text-gray-500 ${mine ? "text-right" : ""}`}>{lagosTime(m.createdAt)}{mine ? " ✓✓" : ""}</span></div></div>;
          })}
        </div>
        <div className="flex items-center gap-1.5 border-t border-gray-100 px-3 py-2.5 dark:border-slate-800">
          <button type="button" aria-label="Open in Inbox for cards and pictures" onClick={() => shared.openLead(id)} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"><Plus className="h-5 w-5" /></button>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) void send(); }} placeholder="Type a message..." className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[14px] dark:border-slate-700 dark:bg-slate-900" />
          <button type="button" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send()} className="!min-h-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#5B3FD9] text-white disabled:opacity-50"><Send className="h-4 w-4" /></button>
        </div>
      </Card>
      <Card className="min-h-[560px] p-4">
        <div className="flex items-center justify-between"><h3 className="m-0 text-[16px] font-bold">Lead Details</h3><button type="button" aria-label="Open in Inbox" onClick={() => shared.openLead(id)} className="!min-h-0 text-gray-500"><MoreHorizontal className="h-5 w-5" /></button></div>
        <div className="mt-3 flex items-center gap-3"><Avatar name={l.name} src={l.profilePic} size={48} /><span className="min-w-0 flex-1"><b className="block truncate text-[16px]">{l.name}</b>{(l.hot || l.status === "hot") && <Pill tone="red"><Flame className="h-3 w-3" />Hot Lead</Pill>}</span><button type="button" aria-label="Edit in Inbox" onClick={() => shared.openLead(id)} className={`${btn.icon} !h-9 !w-9`}><PencilLine className="h-4 w-4" /></button></div>
        <div className="mt-3 space-y-2 text-[13.5px]">
          <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-gray-500" /><span className="flex-1">{l.phone ?? "Not captured yet"}</span>{l.phone && <button type="button" aria-label="Copy" onClick={() => copyText(shared, l.phone!)} className="!min-h-0 text-gray-500"><CopyIcon className="h-4 w-4" /></button>}</div>
          <div className="flex items-center gap-2"><PlatformIcon platform={l.platform} className="h-4 w-4" /><span className="flex-1">{l.source ?? l.platform}</span></div>
          <div className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-gray-500" /><span>{l.state ? `${l.state}, Nigeria` : "State not known"}</span></div>
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-gray-500" /><span>Created: {lagosDateTime(l.firstSeenAt)}</span></div>
        </div>
        <div className="mt-3 grid grid-cols-[100px_1fr] items-center gap-2 text-[13.5px]">
          <span className="font-semibold">Lead Status</span>
          {["order_created", "delivered"].includes(l.status) ? <StatusChip status={l.status} /> : <select className={`${field} !py-1.5`} value={l.status} onChange={(e) => void save({ status: e.target.value })}>{["new", "in_conversation", "hot", "call_requested", "awaiting_customer", "on_hold", "lost"].map((s) => <option key={s} value={s}>{STATUS[s]?.label ?? s}</option>)}</select>}
          <span className="font-semibold">Assigned To</span>
          <select className={`${field} !py-1.5`} value={l.assignedTo ?? ""} onChange={(e) => e.target.value && void socialLeadsApi.transfer(id, e.target.value).then(() => { void load(); onChanged(); })}><option value="">Nobody</option>{shared.reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
        </div>
        <span className="mt-3 block text-[13.5px] font-semibold">Tags</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(l.tags ?? []).map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-[#F1EEFD] px-2 py-1 text-[12.5px] font-semibold text-[#5B3FD9]">{t}<button type="button" className="!min-h-0" aria-label={`Remove ${t}`} onClick={() => void save({ tags: (l.tags ?? []).filter((x) => x !== t) })}><X className="h-3 w-3" /></button></span>)}
          <select className="rounded-lg border border-dashed border-gray-300 bg-transparent px-2 py-1 text-[12.5px] dark:border-slate-600" value="" onChange={(e) => e.target.value && void save({ tags: [...new Set([...(l.tags ?? []), e.target.value])] })}><option value="">+ Add Tag</option>{ctx.d.prefs.tagOptions.filter((t) => !(l.tags ?? []).includes(t)).map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </div>
        <span className="mt-3 block text-[13.5px] font-semibold">Custom Fields</span>
        <div className="mt-1 grid grid-cols-[110px_1fr] items-center gap-2 text-[13px]">
          <span>Product Interest</span>
          <select className={`${field} !py-1.5`} value={l.productId ?? ""} onChange={(e) => void save({ productId: e.target.value })}><option value="">{l.product ?? "Not known"}</option>{shared.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          {ctx.d.prefs.customFields.map((f) => (
            <FieldInput key={f.key} f={f} value={String(custom?.[f.key] ?? "")} onSave={(v) => void save({ customFields: { ...(custom ?? {}), [f.key]: v } })} />
          ))}
        </div>
      </Card>
    </>
  );
}

function FieldInput({ f, value, onSave }: { f: { key: string; label: string; type: string; options: string[] }; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <>
      <span>{f.label}</span>
      {f.type === "select"
        ? <select className={`${field} !py-1.5`} value={v} onChange={(e) => { setV(e.target.value); onSave(e.target.value); }}><option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        : <input className={`${field} !py-1.5`} value={v} inputMode={f.type === "money" ? "numeric" : undefined} placeholder={f.type === "money" ? "₦" : ""} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />}
    </>
  );
}

// ── Notifications ─────────────────────────────────────────────────────────

type NotifData = { kpis: { unread: number; week: { value: number; change: number | null }; channels: number; telegramLinked: boolean }; counts: Record<string, number>; items: Array<{ id: string; type: string; title: string; message: string; link: string | null; read: boolean; createdAt: string; category: string }> };
const NOTIF_ICON = (type: string) => (/overdue|late|failed/.test(type) ? Zap : /follow_up/.test(type) ? CalendarDays : /delivered/.test(type) ? Package : /order|social_lead_new|cart/.test(type) ? Store : /info/.test(type) ? Send : Bell);

export function NotificationsSection({ ctx }: { ctx: Ctx }) {
  const { d, setPrefs, shared } = ctx;
  const [cat, setCat] = useState("all"), [q, setQ] = useState("");
  const data = useLoad(() => socialLeadsApi.section<NotifData>("notifications", { category: cat }), `n-${cat}`, 60_000);
  const [modal, setModal] = useState<"" | "logs" | "create">("");
  const n = data.data;
  const items = (n?.items ?? []).filter((x) => !q || `${x.title} ${x.message}`.toLowerCase().includes(q.toLowerCase()));
  const ev = d.prefs.notifyEvents;
  const setEv = (k: keyof typeof ev, v: boolean) => setPrefs({ notifyEvents: { ...ev, [k]: v } });
  const markAll = async () => { await socialLeadsApi.markNotificationsRead("all"); data.reload(); };
  return (
    <>
      <SectionHeader icon={Bell} title="Notifications" sub="Manage alerts, announcements, and reminders for your team and operations." right={<>
        <button type="button" onClick={() => setModal("logs")} className={btn.ghost}><FileText className="h-4 w-4" />Notification Logs</button>
        <button type="button" onClick={() => setModal("create")} className={btn.primary}><Plus className="h-4 w-4" />Create Notification</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile icon={Bell} value={n?.kpis.unread ?? "—"} label="Unread Notifications" />
        <KpiTile icon={CheckCircle2} tone="green" value={(n?.kpis.week.value ?? 0).toLocaleString()} label="Total (Last 7 Days)" change={n?.kpis.week.change ?? null} />
        <KpiTile icon={Users} value={n?.kpis.channels ?? "—"} label="Active Channels" extra={<span className="text-[12px] text-gray-500">In-app, phone, Telegram</span>} />
        <KpiTile icon={Zap} value="—" label="Delivery Rate" extra={<span className="text-[12px] text-gray-500">Not measured yet</span>} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {([["all", "All"], ["alerts", "Alerts"], ["reminders", "Reminders"], ["updates", "Updates"], ["announcements", "Announcements"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setCat(k)} className={`!min-h-0 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13.5px] font-semibold ${cat === k ? "bg-[#5B3FD9] text-white" : "border border-gray-200 bg-white text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{label}<span className={`rounded-full px-1.5 text-[11px] font-bold ${cat === k ? "bg-white/25" : k === "all" || k === "alerts" ? "bg-rose-500 text-white" : "bg-gray-100 text-gray-700"}`}>{n?.counts[k] ?? 0}</span></button>
            ))}
            <span className="relative ml-auto min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search notifications..." className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" /></span>
            <button type="button" aria-label="Mark all read" title="Mark all read" onClick={markAll} className={btn.icon}><MoreHorizontal className="h-4 w-4" /></button>
          </div>
          <Card>
            {!n && <Empty>Loading…</Empty>}
            {n && !items.length && <Empty>No notification here.</Empty>}
            {items.map((x) => {
              const Icon = NOTIF_ICON(x.type);
              return (
                <button key={x.id} type="button" onClick={async () => { if (!x.read) { await socialLeadsApi.markNotificationsRead([x.id]); data.reload(); } if (x.link) openAppPage(`#${x.link}`); }} className={`!min-h-0 flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-0 dark:border-slate-800 ${!x.read && /overdue|failed/.test(x.type) ? "bg-[#F5F2FE] dark:bg-violet-500/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/60"}`}>
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F1EEFD] text-[#5B3FD9]"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1"><b className="block text-[14px] text-gray-900 dark:text-slate-100">{x.title}</b><span className="block truncate text-[13px] text-gray-600 dark:text-slate-400">{x.message}</span></span>
                  <span className="shrink-0 text-[12px] text-gray-500">{timeAgo(x.createdAt)}</span>
                  <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${x.read ? "border-2 border-gray-300" : "bg-[#5B3FD9]"}`} />
                </button>
              );
            })}
          </Card>
        </div>
        <div className="space-y-4">
          <Box icon={Settings2} title="Notification Settings" sub="Choose what to be notified about and how you want to receive it.">
            <ToggleRow icon={<MonitorSmartphone className="h-5 w-5 text-[#5B3FD9]" />} label="In-App Notifications" sub="Receive real-time alerts inside ProtoHub OSM." on={d.prefs.notifyInApp} onChange={(v) => setPrefs({ notifyInApp: v })} />
            <ToggleRow icon={<Mail className="h-5 w-5 text-[#5B3FD9]" />} label="Email Notifications" sub="Social lead alerts are not emailed." on={false} note={<NotYet />} />
            <ToggleRow icon={<Send className="h-5 w-5 text-sky-500" />} label="Telegram Notifications" sub={n?.kpis.telegramLinked ? "Your Telegram is linked. Pick which alerts copy there in Telegram Bot › Notifications & Alerts › Social leads." : "Link your Telegram from Notifications to get these there."} on={Boolean(n?.kpis.telegramLinked)} onChange={() => openAppPage("#/dashboard/admin/telegram-bot")} />
            <ToggleRow icon={<WhatsAppIcon className="h-5 w-5 text-[#25D366]" />} label="WhatsApp Notifications" sub="Staff alerts on WhatsApp." on={false} note={<NotYet />} />
            <ToggleRow icon={<BellRing className="h-5 w-5 text-[#5B3FD9]" />} label="Browser Notifications" sub="Pop-ups on phones and computers." on={d.prefs.notifyPush} onChange={(v) => setPrefs({ notifyPush: v })} />
          </Box>
          <Box icon={Sparkles} title="Notification Preferences" sub="Customize which events trigger notifications.">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {([["newLeads", "New leads", true], ["followUpReminders", "Follow-up reminders", true], ["slaBreaches", "SLA breaches", true], ["announcements", "System announcements", true], ["orderAssigned", "Order assigned", false], ["teamPerformance", "Team performance alerts", false], ["deliveryUpdates", "Delivery updates", false], ["stockAlerts", "Inventory & stock alerts", false]] as const).map(([k, label, social]) => (
                <label key={k} className={`flex items-center gap-2 text-[13.5px] ${social ? "" : "opacity-60"}`} title={social ? "" : "Set in Settings › Alert routing"}>
                  <input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={social ? ev[k] : true} disabled={!social} onChange={(e) => setEv(k, e.target.checked)} />{label}
                </label>
              ))}
            </div>
            <p className="m-0 mt-2 text-[12px] text-gray-500">The greyed ones are app-wide alerts: who gets them is in the main Settings › Alert routing.</p>
          </Box>
        </div>
      </div>
      {modal === "logs" && <LogsModal onClose={() => setModal("")} />}
      {modal === "create" && <AnnounceModal ctx={ctx} onClose={() => setModal("")} onDone={() => { setModal(""); data.reload(); }} />}
    </>
  );
}

function AnnounceModal({ ctx, onClose, onDone }: { ctx: Ctx; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(""), [message, setMessage] = useState(""), [roles, setRoles] = useState<string[]>(["Sales Rep"]);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Create Notification" sub="An announcement in-app and as a phone pop-up." icon={Bell} onClose={onClose} footer={<><button type="button" className={btn.ghost} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} disabled={busy || !title.trim()} onClick={async () => { setBusy(true); try { const r = await socialLeadsApi.announce({ title, message, roles }); ctx.shared.onToast(`Sent to ${r.sent} ${r.sent === 1 ? "person" : "people"}.`); onDone(); } catch (e) { ctx.shared.onToast((e as Error).message); } finally { setBusy(false); } }}>Send</button></>}>
      <label className="block"><span className="mb-1 block text-[13px] font-semibold">Title</span><input className={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. New Car Care Combo is live" /></label>
      <label className="mt-3 block"><span className="mb-1 block text-[13px] font-semibold">Message</span><textarea rows={3} className={field} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
      <span className="mt-3 block text-[13px] font-semibold">Who gets it</span>
      <div className="mt-1 flex flex-wrap gap-3">{["Sales Rep", "Manager", "Admin", "Sales Closer", "Recovery Rep"].map((r) => <label key={r} className="flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={roles.includes(r)} onChange={() => setRoles((x) => (x.includes(r) ? x.filter((y) => y !== r) : [...x, r]))} />{r === "Sales Rep" ? "Call Reps" : r}</label>)}</div>
    </Modal>
  );
}

// ── Templates & Quick Replies ─────────────────────────────────────────────

type TplData = { kpis: { total: number; quick: number; categories: number; usageRate: number | null; avgResponse: number | null }; templates: Array<SlTemplate & { usage: number; lastUsedAt: string | null }>; categories: string[] };
const CAT_TONE = ["purple", "blue", "amber", "red", "green", "slate"];
const VARIABLES = ["{customer_name}", "{product_name}", "{price}", "{delivery_time}", "{order_id}"];

export function TemplatesSection({ ctx }: { ctx: Ctx }) {
  const { d, setPrefs, shared } = ctx;
  const usage = useLoad(() => socialLeadsApi.section<TplData>("templates"), "templates");
  const [kind, setKind] = useState<"template" | "quick">("template");
  const [cat, setCat] = useState("all"), [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [edit, setEdit] = useState<null | Partial<SlTemplate>>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const list = d.prefs.templates.map((t) => ({ ...t, usage: d.prefs.templateUsage[t.id]?.count ?? 0 }));
  const shown = list.filter((t) => t.kind === kind && (cat === "all" || t.category === cat) && (!q || `${t.title} ${t.body}`.toLowerCase().includes(q.toLowerCase())));
  const preview = list.find((t) => t.id === picked) ?? shown[0] ?? null;
  const toneOf = (c: string) => CAT_TONE[Math.max(0, d.prefs.templateCategories.indexOf(c)) % CAT_TONE.length];
  const k = usage.data?.kpis;
  const saveTpl = (t: Partial<SlTemplate>) => {
    const now = new Date().toISOString();
    if (t.id && list.some((x) => x.id === t.id)) setPrefs({ templates: d.prefs.templates.map((x) => (x.id === t.id ? { ...x, ...t, updatedAt: now } as SlTemplate : x)) });
    else setPrefs({ templates: [...d.prefs.templates, { id: `t${Date.now().toString(36)}`, title: t.title ?? "Reply", body: t.body ?? "", category: t.category ?? "Miscellaneous", kind: t.kind ?? kind, updatedAt: now }] });
    setEdit(null); shared.onToast("Template ready. Save Changes to keep it.");
  };
  const importCsv = async (file: File) => {
    const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
    const rows = lines.slice(1).map((l) => { const m = l.match(/("([^"]|"")*"|[^,]*)/g)?.filter((x, i, a) => !(x === "" && a[i - 1] !== undefined && a[i - 1] !== "")) ?? []; return m.map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"')); });
    const added = rows.filter((r) => r[0] && r[2]).map((r, i) => ({ id: `imp${Date.now().toString(36)}${i}`, title: r[0], category: r[1] || "Miscellaneous", body: r[2], kind: (r[3] === "quick" ? "quick" : "template") as "quick" | "template", updatedAt: new Date().toISOString() }));
    if (!added.length) { shared.onToast("No rows. Use columns: Title, Category, Message, Kind (template or quick)."); return; }
    setPrefs({ templates: [...d.prefs.templates, ...added] }); shared.onToast(`${added.length} templates added. Save Changes to keep them.`);
  };
  return (
    <>
      <SectionHeader icon={Layers} title="Templates & Quick Replies" sub="Create, manage and use pre-written messages to respond faster, stay consistent, and convert more leads." right={<>
        <label className={`${btn.ghost} cursor-pointer`}><Download className="h-4 w-4" />Import Templates<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); e.target.value = ""; }} /></label>
        <button type="button" onClick={() => setEdit({ kind, category: cat === "all" ? d.prefs.templateCategories[0] : cat })} className={btn.primary}><Plus className="h-4 w-4" />Create Template</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile icon={Layers} value={list.filter((t) => t.kind === "template").length} label="Total Templates" />
        <KpiTile icon={Zap} value={list.filter((t) => t.kind === "quick").length} label="Quick Replies" />
        <KpiTile icon={Layers} value={d.prefs.templateCategories.length} label="Categories" />
        <KpiTile icon={CheckCircle2} tone="green" value={k?.usageRate !== null && k ? `${k.usageRate}%` : "—"} label="Usage Rate" extra={<span className="text-[12px] text-gray-500">of replies sent, last 7 days</span>} />
        <KpiTile icon={Clock} value={duration(k?.avgResponse)} label="Avg. Response Time" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {([["template", `Message Templates (${list.filter((t) => t.kind === "template").length})`], ["quick", `Quick Replies ${list.filter((t) => t.kind === "quick").length}`]] as const).map(([k2, label]) => <button key={k2} type="button" onClick={() => setKind(k2)} className={`!min-h-0 rounded-xl px-5 py-2.5 text-[14.5px] font-semibold ${kind === k2 ? "bg-[#5B3FD9] text-white" : "border border-gray-200 bg-white text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>{label}</button>)}
        <span className="relative ml-auto min-w-[220px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates..." className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" /></span>
        <Select label="Category" className="w-[200px]" value={cat} onChange={setCat} options={[{ value: "all", label: "All Categories" }, ...d.prefs.templateCategories.map((c) => ({ value: c, label: c }))]} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[250px_minmax(0,1fr)_300px]">
        <Card className="p-3">
          <div className="flex items-center justify-between px-1"><h3 className="m-0 text-[16px] font-bold">Categories</h3><button type="button" aria-label="Add category" onClick={() => { const name = window.prompt("New category name"); if (name?.trim()) setPrefs({ templateCategories: [...new Set([...d.prefs.templateCategories, name.trim()])] }); }} className={`${btn.icon} !h-8 !w-8`}><Plus className="h-4 w-4" /></button></div>
          <div className="mt-2 space-y-0.5">
            {[["all", "All Templates"], ...d.prefs.templateCategories.map((c) => [c, c])].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setCat(key)} className={`!min-h-0 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13.5px] ${cat === key ? "bg-[#F1EEFD] font-semibold text-[#5B3FD9]" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
                <Layers className="h-4 w-4 shrink-0 text-[#5B3FD9]" /><span className="flex-1 truncate">{label}</span><span className="text-[12px] text-gray-500">{list.filter((t) => t.kind === kind && (key === "all" || t.category === key)).length}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card className="min-w-0 p-3">
          <h3 className="m-0 px-1 text-[16px] font-bold">{kind === "template" ? "Templates" : "Quick Replies"} ({shown.length})</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead><tr><th className="w-8 px-2 py-2"><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((t) => selected.has(t.id))} onChange={() => setSelected((x) => (shown.every((t) => x.has(t.id)) ? new Set() : new Set(shown.map((t) => t.id))))} /></th>{["Template name", "Category", "Usage", "Updated", "Actions"].map((h) => <th key={h} className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">{h}</th>)}</tr></thead>
              <tbody>
                {!shown.length && <tr><td colSpan={6}><Empty>No template here yet.</Empty></td></tr>}
                {shown.map((t) => (
                  <tr key={t.id} onClick={() => setPicked(t.id)} className={`cursor-pointer border-t border-gray-100 dark:border-slate-800 [&>td]:px-2 [&>td]:py-2.5 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200 ${preview?.id === t.id ? "bg-[#F7F5FF] dark:bg-violet-500/10" : ""}`}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => setSelected((x) => { const nn = new Set(x); if (nn.has(t.id)) nn.delete(t.id); else nn.add(t.id); return nn; })} /></td>
                    <td><b>{t.title}</b></td><td><Pill tone={toneOf(t.category)}>{t.category}</Pill></td><td>{t.usage.toLocaleString()}</td><td className="whitespace-nowrap">{t.updatedAt ? new Date(t.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Built in"}</td>
                    <td onClick={(e) => e.stopPropagation()}><span className="flex gap-1"><button type="button" aria-label="Edit" onClick={() => setEdit(t)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><PencilLine className="h-4 w-4" /></button><button type="button" aria-label="Delete" onClick={() => { setPrefs({ templates: d.prefs.templates.filter((x) => x.id !== t.id) }); }} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-rose-50 hover:text-rose-600"><X className="h-4 w-4" /></button></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected.size > 0 && <div className="mt-2 flex items-center gap-2 px-1 text-[13px]"><b>{selected.size} selected</b><button type="button" className="!min-h-0 text-rose-600 underline" onClick={() => { setPrefs({ templates: d.prefs.templates.filter((x) => !selected.has(x.id)) }); setSelected(new Set()); }}>Delete</button></div>}
        </Card>
        <Card className="p-4">
          <h3 className="m-0 text-[16px] font-bold">Template Preview</h3>
          {!preview ? <Empty>Pick a template.</Empty> : (
            <>
              <div className="mt-3 flex items-center justify-between"><b className="text-[14.5px]">{preview.title}</b><button type="button" aria-label="Copy" onClick={() => copyText(shared, preview.body)} className="!min-h-0 text-gray-500"><Copy className="h-4 w-4" /></button></div>
              <Pill tone={toneOf(preview.category)} className="mt-1">{preview.category}</Pill>
              <div className="mt-3 whitespace-pre-wrap rounded-2xl bg-[#F3F0FE] px-3.5 py-3 text-[14px] text-gray-900 dark:bg-violet-500/10 dark:text-slate-100">{fillTemplate(preview.body, { name: "Chinedu Okafor", product: shared.products[0]?.name ?? "Multi Corner Storage Shelf", orderId: "5521" } as any, shared.products[0]?.packages[0] ? money(shared.products[0].packages[0].price) : "₦39,500")}</div>
              <span className="mt-1 block text-[11.5px] text-gray-500">Sample customer and product shown.</span>
              <button type="button" onClick={() => { copyText(shared, preview.body, "Copied: paste it in any chat, or pick it from Templates in the Inbox."); }} className={`${btn.primary} mt-3 w-full`}><Send className="h-4 w-4" />Use Template</button>
              <button type="button" onClick={() => setEdit(preview)} className={`${btn.ghost} mt-2 w-full`}><PencilLine className="h-4 w-4" />Edit Template</button>
              <span className="mt-4 block text-[13.5px] font-semibold">Template Variables</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{VARIABLES.map((v) => <span key={v} className="rounded-lg bg-[#F1EEFD] px-2 py-1 text-[12px] font-semibold text-[#5B3FD9]">{v}</span>)}</div>
            </>
          )}
        </Card>
      </div>
      {edit && <TemplateModal t={edit} categories={d.prefs.templateCategories} onClose={() => setEdit(null)} onSave={saveTpl} />}
    </>
  );
}

function TemplateModal({ t, categories, onClose, onSave }: { t: Partial<SlTemplate>; categories: string[]; onClose: () => void; onSave: (t: Partial<SlTemplate>) => void }) {
  const [f, setF] = useState({ id: t.id, title: t.title ?? "", category: t.category ?? categories[0] ?? "Miscellaneous", body: t.body ?? "", kind: t.kind ?? "template" });
  return (
    <Modal title={t.id ? "Edit Template" : "Create Template"} icon={FileText} onClose={onClose} footer={<><button type="button" className={btn.ghost} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} disabled={!f.title.trim() || !f.body.trim()} onClick={() => onSave(f)}>Save template</button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label><span className="mb-1 block text-[13px] font-semibold">Name</span><input className={field} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label><span className="mb-1 block text-[13px] font-semibold">Kind</span><select className={field} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as any })}><option value="template">Message template</option><option value="quick">Quick reply</option></select></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold">Category</span><select className={field} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-[13px] font-semibold">Message</span><textarea rows={5} className={field} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">{VARIABLES.map((v) => <button key={v} type="button" onClick={() => setF({ ...f, body: `${f.body}${v}` })} className="!min-h-0 rounded-lg bg-[#F1EEFD] px-2 py-1 text-[12px] font-semibold text-[#5B3FD9]">{v}</button>)}</div>
    </Modal>
  );
}

// ── Working Hours ─────────────────────────────────────────────────────────

export function WorkingHoursSection({ ctx }: { ctx: Ctx }) {
  const { d, setPrefs, shared } = ctx;
  const p = d.prefs;
  const [modal, setModal] = useState<null | { kind: "team"; i: number | null } | { kind: "exception"; i: number | null } | { kind: "calendar" }>(null);
  const exportCsv = () => downloadCsv("working-hours.csv", ["Team", "Days", "From", "To", "On"], [["Business hours", daysLabel(p.workingDays), minuteLabel(p.startMinute), minuteLabel(p.endMinute), p.hoursEnabled ? "Yes" : "No"], ...p.teamSchedules.map((t) => [t.team, daysLabel(t.days), minuteLabel(t.start), minuteLabel(t.end), t.enabled ? "Yes" : "No"]), ...p.exceptions.map((x) => [`${x.description} (${x.date})`, x.type, x.closed ? "Closed" : minuteLabel(x.start), x.closed ? "" : minuteLabel(x.end), x.enabled ? "Yes" : "No"])]);
  const todayKey = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  return (
    <>
      <SectionHeader icon={Clock} title="Working Hours" sub="Set your business hours, team schedules, and auto-responses outside working hours." right={<>
        <button type="button" onClick={() => setModal({ kind: "calendar" })} className={btn.ghost}><CalendarDays className="h-4 w-4 text-[#5B3FD9]" />View Schedule (Calendar)</button>
        <button type="button" onClick={() => setModal({ kind: "team", i: null })} className={btn.primary}><Plus className="h-4 w-4" />Add Schedule</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile icon={Store} value={daysLabel(p.workingDays)} label="Working Days" extra={<Pill tone={p.hoursEnabled ? "green" : "slate"}>{p.hoursEnabled ? "Active" : "Off"}</Pill>} />
        <KpiTile icon={Clock} value={`${minuteLabel(p.startMinute)} – ${minuteLabel(p.endMinute)}`} label="Working Hours" extra={<Pill tone={p.hoursEnabled ? "green" : "slate"}>{p.hoursEnabled ? "Active" : "Off"}</Pill>} />
        <KpiTile icon={Timer} value="Auto-Reply" label="Outside Working Hours" extra={<Pill tone={p.offHoursReply ? "green" : "slate"}>{p.offHoursReply ? "On" : "Off"}</Pill>} />
        <KpiTile icon={Users} value={`${p.teamSchedules.length} Teams`} label="Have Schedules" extra={<button type="button" onClick={() => document.getElementById("sl-teams")?.scrollIntoView({ behavior: "smooth" })} className="!min-h-0 text-[12.5px] font-semibold text-[#5B3FD9]">Manage →</button>} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Box icon={Store} title="Business Working Hours" sub="Set your main business days and hours for the entire workspace." right={<Switch on={p.hoursEnabled} onChange={(v) => setPrefs({ hoursEnabled: v })} label="Business hours on" />}>
          <div className="grid grid-cols-[110px_1fr] items-center gap-3 text-[13.5px]">
            <span className="font-medium">Working Days</span><DayChecks days={p.workingDays} onChange={(days) => setPrefs({ workingDays: days })} />
            <span className="font-medium">Working Hours</span>
            <span className="flex items-center gap-2"><Select label="From" className="flex-1" value={String(p.startMinute)} onChange={(v) => setPrefs({ startMinute: Number(v) })} options={TIME_OPTIONS} />–<Select label="To" className="flex-1" value={String(p.endMinute)} onChange={(v) => setPrefs({ endMinute: Number(v) })} options={[...TIME_OPTIONS.slice(1), { value: "1440", label: "12:00 AM (midnight)" }]} /></span>
            <span className="font-medium">Timezone</span><select className={field} value="Africa/Lagos" onChange={() => undefined}><option value="Africa/Lagos">(GMT+01:00) West Africa Time – Lagos</option></select>
          </div>
          {!p.hoursEnabled && <p className="m-0 mt-2 text-[12px] text-amber-700">Off: leads follow the cart hand-out hours instead.</p>}
        </Box>
        <Box icon={MessageSquareText} title="After-Hours (Auto Response)" sub="Automatically reply to customers outside working hours." right={<Switch on={p.offHoursReply} onChange={(v) => setPrefs({ offHoursReply: v })} label="After-hours reply on" />}>
          <div className="flex items-center justify-between"><span className="text-[13.5px] font-semibold">Auto-Reply Message</span><select className="rounded-lg border border-gray-200 px-2 py-1 text-[13px] font-semibold text-[#5B3FD9] dark:border-slate-700 dark:bg-slate-900" value="" onChange={(e) => { const t = p.templates.find((x) => x.id === e.target.value); if (t) setPrefs({ offHoursMessage: t.body }); }}><option value="">Use Template ▾</option>{p.templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
          <textarea rows={5} className={`${field} mt-2`} value={p.offHoursMessage} onChange={(e) => setPrefs({ offHoursMessage: e.target.value })} />
          <p className="m-0 mt-1 text-[12px] text-gray-500">Sent once per quiet spell through ManyChat.</p>
        </Box>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Box icon={Users} title="Team Schedules" sub="Set different working hours for individual teams or roles." right={<button type="button" onClick={() => setModal({ kind: "team", i: null })} className={`${btn.ghost} !py-2 !text-[13px]`}><Plus className="h-4 w-4" />Add Team Schedule</button>}>
          <div id="sl-teams" className="overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead><tr>{["Team / Role", "Working days", "Hours", "Status", "Actions"].map((h) => <th key={h} className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">{h}</th>)}</tr></thead>
              <tbody>{p.teamSchedules.map((t, i) => (
                <tr key={t.id} className="border-t border-gray-100 dark:border-slate-800 [&>td]:px-2 [&>td]:py-2 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                  <td><span className="flex items-center gap-2"><Headphones className="h-4 w-4 text-[#5B3FD9]" /><b>{t.team}</b></span></td><td>{daysLabel(t.days)}</td><td className="whitespace-nowrap">{minuteLabel(t.start)} – {minuteLabel(t.end)}</td>
                  <td><span className={`inline-flex items-center gap-1 text-[13px] font-semibold ${t.enabled ? "text-emerald-600" : "text-gray-400"}`}><span className={`h-2 w-2 rounded-full ${t.enabled ? "bg-emerald-500" : "bg-gray-300"}`} />{t.enabled ? "Active" : "Off"}</span></td>
                  <td><span className="flex gap-1"><button type="button" aria-label="Edit" onClick={() => setModal({ kind: "team", i })} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><PencilLine className="h-4 w-4" /></button><button type="button" aria-label="Remove" onClick={() => setPrefs({ teamSchedules: p.teamSchedules.filter((_, j) => j !== i) })} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-rose-50 hover:text-rose-600"><X className="h-4 w-4" /></button></span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="m-0 mt-2 text-[12px] text-gray-500">Leads are handed out on the business hours above; these show each team's own hours.</p>
        </Box>
        <Box icon={Zap} title="Automation Rules" sub="Control how conversations are handled based on working hours.">
          <ToggleRow icon={<CalendarDays className="h-5 w-5 text-[#5B3FD9]" />} label="Route new leads only during working hours" on={p.assignInHoursOnly} onChange={(v) => setPrefs({ assignInHoursOnly: v })} />
          <ToggleRow icon={<Users className="h-5 w-5 text-[#5B3FD9]" />} label="Automatically assign leads when we're online" on={d.autoAssign} onChange={(v) => ctx.set((x) => ({ ...x, autoAssign: v }))} />
          <ToggleRow icon={<Clock className="h-5 w-5 text-[#5B3FD9]" />} label="Set leads to “Pending (Off-Hours)” outside working hours" on={p.pendingOffHours} onChange={(v) => setPrefs({ pendingOffHours: v })} />
        </Box>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Box icon={CalendarDays} title="Exceptions & Holidays" sub="Set special days, holidays, or temporary changes to working hours." right={<button type="button" onClick={() => setModal({ kind: "exception", i: null })} className={`${btn.ghost} !py-2 !text-[13px]`}><Plus className="h-4 w-4" />Add Exception</button>}>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full border-collapse">
              <thead><tr>{["Date", "Type", "Description", "Working hours", "Status", "Actions"].map((h) => <th key={h} className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500">{h}</th>)}</tr></thead>
              <tbody>
                {!p.exceptions.length && <tr><td colSpan={6}><Empty>No special day.</Empty></td></tr>}
                {p.exceptions.map((x, i) => (
                  <tr key={x.id} className="border-t border-gray-100 dark:border-slate-800 [&>td]:px-2 [&>td]:py-2 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                    <td className="whitespace-nowrap">{new Date(`${x.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</td>
                    <td><Pill tone={x.type === "holiday" ? "red" : "purple"}>{x.type === "holiday" ? "Holiday" : "Custom"}</Pill></td><td>{x.description}</td><td>{x.closed ? "Closed" : `${minuteLabel(x.start)} – ${minuteLabel(x.end)}`}</td>
                    <td><span className={`text-[13px] font-semibold ${x.enabled ? (x.date < todayKey ? "text-gray-400" : "text-emerald-600") : "text-gray-400"}`}>● {x.enabled ? (x.date < todayKey ? "Past" : "Active") : "Off"}</span></td>
                    <td><span className="flex gap-1"><button type="button" aria-label="Edit" onClick={() => setModal({ kind: "exception", i })} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100"><PencilLine className="h-4 w-4" /></button><button type="button" aria-label="Remove" onClick={() => setPrefs({ exceptions: p.exceptions.filter((_, j) => j !== i) })} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-rose-50 hover:text-rose-600"><X className="h-4 w-4" /></button></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Box>
        <Card className="p-4">
          <h3 className="m-0 text-[16px] font-bold">Quick Actions</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              { Icon: CalendarPlus, label: "Set Temporary Hours", go: () => setModal({ kind: "exception", i: null }) },
              { Icon: Pause, label: "Pause Routing", go: () => { ctx.set((x) => ({ ...x, autoAssign: false })); shared.onToast("Routing paused. Save Changes to apply."); } },
              { Icon: Play, label: "Resume Routing", go: () => { ctx.set((x) => ({ ...x, autoAssign: true })); shared.onToast("Routing on. Save Changes to apply."); } },
              { Icon: CopyIcon, label: "Copy Schedule", go: () => copyText(shared, `Working days: ${daysLabel(p.workingDays)}, ${minuteLabel(p.startMinute)} – ${minuteLabel(p.endMinute)} (WAT)`) },
              { Icon: Download, label: "Export Schedule", go: exportCsv },
              { Icon: Settings2, label: "Advanced Rules", go: () => ctx.go("advanced") }
            ].map((a) => <button key={a.label} type="button" onClick={a.go} className="!min-h-0 flex flex-col items-center gap-1.5 rounded-xl border border-gray-200 px-2 py-3 text-center text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"><a.Icon className="h-5 w-5 text-[#5B3FD9]" />{a.label}</button>)}
          </div>
        </Card>
      </div>
      {modal?.kind === "team" && <TeamScheduleModal t={modal.i === null ? null : p.teamSchedules[modal.i]} onClose={() => setModal(null)} onSave={(t) => { setPrefs({ teamSchedules: modal.i === null ? [...p.teamSchedules, t] : p.teamSchedules.map((x, j) => (j === modal.i ? t : x)) }); setModal(null); }} />}
      {modal?.kind === "exception" && <ExceptionModal x={modal.i === null ? null : p.exceptions[modal.i]} onClose={() => setModal(null)} onSave={(x) => { setPrefs({ exceptions: modal.i === null ? [...p.exceptions, x] : p.exceptions.map((y, j) => (j === modal.i ? x : y)) }); setModal(null); }} />}
      {modal?.kind === "calendar" && <Modal title="Weekly schedule" icon={CalendarDays} onClose={() => setModal(null)} width="max-w-[820px]">
        <div className="grid grid-cols-8 gap-1 text-[12px]">
          <span />{DAYS.map((x) => <b key={x.n} className="text-center">{x.l}</b>)}
          {[{ team: "Business hours", days: p.workingDays, start: p.startMinute, end: p.endMinute }, ...p.teamSchedules.filter((t) => t.enabled)].map((t) => (
            <>{[<b key={`${t.team}-n`} className="truncate pr-1">{t.team}</b>, ...DAYS.map((x) => <span key={`${t.team}-${x.n}`} className={`rounded-md px-1 py-2 text-center ${t.days.includes(x.n) ? "bg-[#EEEBFC] font-semibold text-[#5B3FD9]" : "bg-gray-50 text-gray-400"}`}>{t.days.includes(x.n) ? `${minuteLabel(t.start).replace(":00", "")}–${minuteLabel(t.end).replace(":00", "")}` : "Off"}</span>)]}</>
          ))}
        </div>
      </Modal>}
    </>
  );
}

function TeamScheduleModal({ t, onClose, onSave }: { t: { id: string; team: string; days: number[]; start: number; end: number; enabled: boolean } | null; onClose: () => void; onSave: (t: { id: string; team: string; days: number[]; start: number; end: number; enabled: boolean }) => void }) {
  const [f, setF] = useState(t ?? { id: `s${Date.now().toString(36)}`, team: "", days: [1, 2, 3, 4, 5, 6], start: 510, end: 1020, enabled: true });
  return (
    <Modal title={t ? "Edit Team Schedule" : "Add Team Schedule"} icon={Users} onClose={onClose} footer={<><button type="button" className={btn.ghost} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} disabled={!f.team.trim()} onClick={() => onSave(f)}>Save</button></>}>
      <label className="block"><span className="mb-1 block text-[13px] font-semibold">Team or role</span><input className={field} value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} /></label>
      <span className="mt-3 block text-[13px] font-semibold">Working days</span><DayChecks days={f.days} onChange={(days) => setF({ ...f, days })} />
      <span className="mt-3 flex items-center gap-2"><Select label="From" className="flex-1" value={String(f.start)} onChange={(v) => setF({ ...f, start: Number(v) })} options={TIME_OPTIONS} />–<Select label="To" className="flex-1" value={String(f.end)} onChange={(v) => setF({ ...f, end: Number(v) })} options={TIME_OPTIONS} /></span>
      <div className="mt-3"><ToggleRow label="On" on={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} /></div>
    </Modal>
  );
}
function ExceptionModal({ x, onClose, onSave }: { x: { id: string; date: string; type: "holiday" | "custom"; description: string; closed: boolean; start: number; end: number; enabled: boolean } | null; onClose: () => void; onSave: (x: { id: string; date: string; type: "holiday" | "custom"; description: string; closed: boolean; start: number; end: number; enabled: boolean }) => void }) {
  const [f, setF] = useState(x ?? { id: `x${Date.now().toString(36)}`, date: new Date(Date.now() + 3_600_000).toISOString().slice(0, 10), type: "custom" as const, description: "Temporary hours", closed: false, start: 600, end: 960, enabled: true });
  return (
    <Modal title={x ? "Edit Exception" : "Add Exception"} sub="A holiday closes routing for the day; custom hours replace the normal hours for that day." icon={CalendarDays} onClose={onClose} footer={<><button type="button" className={btn.ghost} onClick={onClose}>Cancel</button><button type="button" className={btn.primary} disabled={!f.date} onClick={() => onSave(f)}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <label><span className="mb-1 block text-[13px] font-semibold">Date</span><input type="date" className={field} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label><span className="mb-1 block text-[13px] font-semibold">Type</span><select className={field} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as any, closed: e.target.value === "holiday" })}><option value="holiday">Holiday (closed)</option><option value="custom">Custom hours</option></select></label>
        <label className="col-span-2"><span className="mb-1 block text-[13px] font-semibold">Description</span><input className={field} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        {!f.closed && <span className="col-span-2 flex items-center gap-2"><Select label="From" className="flex-1" value={String(f.start)} onChange={(v) => setF({ ...f, start: Number(v) })} options={TIME_OPTIONS} />–<Select label="To" className="flex-1" value={String(f.end)} onChange={(v) => setF({ ...f, end: Number(v) })} options={TIME_OPTIONS} /></span>}
      </div>
    </Modal>
  );
}

// ── Access & Permissions ──────────────────────────────────────────────────

type AccessData = { kpis: { total: number; roles: number; active: number; inactive: number }; roles: Array<{ role: string; count: number; canOpen: boolean; permissions: Record<string, boolean[]> | null }>; users: Array<{ id: string; name: string; email: string; role: string; active: boolean; avatar: string | null; headOfSales: boolean }> };
const PERM_ROWS: Array<{ group: string; Icon: React.ComponentType<{ className?: string }>; rows: Array<[string, string]> }> = [
  { group: "Leads & Conversations", Icon: MessageSquareText, rows: [["conversations", "View & manage conversations"], ["status", "Update lead status & tags"]] },
  { group: "Orders & Follow-ups", Icon: Store, rows: [["orders", "Create & update orders"], ["followUps", "Manage follow-ups"]] },
  { group: "Customers", Icon: Users, rows: [["customers", "View customer details"], ["notes", "Add notes & activities"]] },
  { group: "Products & Stock", Icon: Package, rows: [["products", ""]] },
  { group: "Reports & Analytics", Icon: BarChart3, rows: [["reports", ""]] },
  { group: "Team & Assignment", Icon: Users, rows: [["team", ""]] },
  { group: "Settings & Configuration", Icon: Settings2, rows: [["settings", ""]] }
];
const CAN_TOGGLE = ["Admin", "Manager", "Sales Rep"];

export function AccessSection({ ctx }: { ctx: Ctx }) {
  const { d, setPrefs, shared } = ctx;
  const data = useLoad(() => socialLeadsApi.section<AccessData>("access"), "access");
  const a = data.data;
  const [role, setRole] = useState<string>("Sales Rep");
  const [tab, setTab] = useState<"perm" | "users" | "settings">("perm");
  const current = a?.roles.find((r) => r.role === role) ?? a?.roles[0] ?? null;
  const users = (a?.users ?? []).filter((u) => u.role === current?.role);
  const canOpen = (r: string) => r === "Owner" || d.prefs.roles.includes(r);
  return (
    <>
      <SectionHeader icon={ShieldCheck} title="Access & Permissions" sub="Control who can access ProtoHub OSM, what they can do, and how they can use each feature." right={<>
        <button type="button" onClick={() => setTab("users")} className={btn.ghost}><FileText className="h-4 w-4" />Audit Logs</button>
        <button type="button" onClick={() => openAppPage("#/dashboard/admin/user-management")} className={btn.primary}><Plus className="h-4 w-4" />Invite User</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile icon={Users} value={a?.kpis.total ?? "—"} label="Total Users" />
        <KpiTile icon={Layers} value={a?.kpis.roles ?? "—"} label="Roles" extra={<Pill tone="green">Active</Pill>} />
        <KpiTile icon={Shield} value={a?.kpis.active ?? "—"} label="Active Users" />
        <KpiTile icon={UserPlus} value={a?.kpis.inactive ?? "—"} label={a?.kpis.inactive === 1 ? "Inactive User" : "Inactive Users"} />
        <KpiTile icon={Lock} value="Role-based" label="Access Controlled" extra={<span className="text-[12px] text-emerald-600">✓ Every page checks the role</span>} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
        <Card className="p-3">
          <div className="flex items-center justify-between px-1"><h3 className="m-0 text-[16px] font-bold">Roles ({a?.roles.length ?? 0})</h3><button type="button" onClick={() => openAppPage("#/dashboard/admin/user-management")} className={`${btn.ghost} !px-2.5 !py-1.5 !text-[12.5px]`}><Plus className="h-3.5 w-3.5" />Add Role</button></div>
          <div className="mt-2 space-y-1">
            {(a?.roles ?? []).map((r) => (
              <button key={r.role} type="button" onClick={() => setRole(r.role)} className={`!min-h-0 flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-semibold ${current?.role === r.role ? "bg-[#5B3FD9] text-white" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
                <Headphones className="h-4 w-4" /><span className="flex-1 truncate">{r.role === "Sales Rep" ? "Sales Rep (Call Rep)" : r.role}</span><span className={`rounded-full px-2 text-[11.5px] ${current?.role === r.role ? "bg-white/25" : "bg-gray-100 dark:bg-slate-800"}`}>{r.count}</span>
              </button>
            ))}
          </div>
        </Card>
        <Card className="min-w-0 p-4">
          {current && <>
            <div className="flex flex-wrap items-center gap-3"><span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#F1EEFD] text-[#5B3FD9]"><Headphones className="h-6 w-6" /></span><span className="mr-auto"><b className="block text-[18px]">{current.role}</b><span className="text-[13px] text-gray-600">{current.role === "Sales Rep" ? "Handle leads, follow-ups, upsell and close orders." : `What a ${current.role} can do in the Social Leads Inbox.`}</span></span><button type="button" onClick={() => openAppPage("#/dashboard/admin/user-management")} className={`${btn.ghost} !py-2 !text-[13px]`}><PencilLine className="h-4 w-4" />Edit Role</button></div>
            <div className="mt-3 flex flex-wrap gap-2">{([["perm", "Permissions"], ["users", `Users (${users.length})`], ["settings", "Role Settings"]] as const).map(([k2, label]) => <button key={k2} type="button" onClick={() => setTab(k2)} className={`!min-h-0 rounded-xl px-4 py-2 text-[13.5px] font-semibold ${tab === k2 ? "bg-[#5B3FD9] text-white" : "border border-gray-200 text-gray-800 dark:border-slate-700 dark:text-slate-200"}`}>{label}</button>)}</div>
            {tab === "perm" && (current.permissions ? (
              <div className="mt-3 overflow-x-auto">
                <table className="!min-w-0 w-full border-collapse">
                  <thead><tr><th className="px-2 py-2 text-left text-[12px] font-bold">Module / Feature</th>{["View", "Create", "Edit", "Delete", "Export"].map((h) => <th key={h} className="px-2 py-2 text-center text-[12px] font-bold">{h}</th>)}</tr></thead>
                  <tbody>
                    {PERM_ROWS.map((g) => (
                      g.rows.length === 1 && !g.rows[0][1]
                        ? <tr key={g.group} className="border-t border-gray-100 bg-[#FAF9FF] dark:border-slate-800 dark:bg-slate-800/40"><td className="px-2 py-2.5"><span className="flex items-center gap-2 font-bold"><g.Icon className="h-4 w-4 text-[#5B3FD9]" />{g.group}</span></td>{current.permissions![g.rows[0][0]].map((v, i) => <td key={i} className="text-center"><input type="checkbox" disabled checked={v} className="h-4 w-4 accent-[#5B3FD9]" /></td>)}</tr>
                        : [<tr key={g.group} className="border-t border-gray-100 bg-[#FAF9FF] dark:border-slate-800 dark:bg-slate-800/40"><td colSpan={6} className="px-2 py-2"><span className="flex items-center gap-2 font-bold"><g.Icon className="h-4 w-4 text-[#5B3FD9]" />{g.group}</span></td></tr>,
                          ...g.rows.map(([key, label]) => <tr key={key} className="border-t border-gray-100 dark:border-slate-800"><td className="px-2 py-2 pl-8 text-[13.5px]">{label}</td>{current.permissions![key].map((v, i) => <td key={i} className="text-center"><input type="checkbox" disabled checked={v} className="h-4 w-4 accent-[#5B3FD9]" /></td>)}</tr>)]
                    ))}
                  </tbody>
                </table>
                <p className="m-0 mt-2 text-[12px] text-gray-500">These are fixed by role in Protohub (a grid you can tick per page is not available yet). Who may open this inbox at all: Role Settings.</p>
              </div>
            ) : <Empty>This role has no access to the Social Leads Inbox.</Empty>)}
            {tab === "users" && <div className="mt-3 space-y-2">{users.map((u) => <div key={u.id} className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2 dark:border-slate-700"><Avatar name={u.name} src={u.avatar} size={36} /><span className="min-w-0 flex-1"><b className="block">{u.name}{u.headOfSales ? " · Head of Sales" : ""}</b><span className="text-[12.5px] text-gray-500">{u.email}</span></span><Pill tone={u.active ? "green" : "slate"}>{u.active ? "Active" : "Inactive"}</Pill></div>)}{!users.length && <Empty>Nobody in this role.</Empty>}</div>}
            {tab === "settings" && <div className="mt-3"><ToggleRow label={`${current.role}s can open the Social Leads Inbox`} sub={current.role === "Owner" ? "The Owner always can." : !CAN_TOGGLE.includes(current.role) ? "This role does not have the page." : "Remember to Save Changes."} on={canOpen(current.role)} onChange={CAN_TOGGLE.includes(current.role) ? (v) => setPrefs({ roles: v ? [...new Set([...d.prefs.roles, current.role])] : d.prefs.roles.filter((r) => r !== current.role) }) : undefined} /></div>}
          </>}
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between"><h3 className="m-0 text-[16px] font-bold">Users in This Role ({users.length})</h3><button type="button" onClick={() => openAppPage("#/dashboard/admin/user-management")} className="!min-h-0 text-[13px] font-semibold text-[#5B3FD9]">Manage</button></div>
            <div className="mt-2 space-y-2.5">{users.slice(0, 6).map((u) => <div key={u.id} className="flex items-center gap-2.5"><Avatar name={u.name} src={u.avatar} size={36} /><span className="min-w-0 flex-1"><b className="block truncate text-[14px]">{u.name}</b><span className="block truncate text-[12px] text-gray-500">{u.email}</span></span><Pill tone={u.active ? "green" : "slate"}>{u.active ? "Active" : "Inactive"}</Pill></div>)}</div>
          </Card>
          <Box icon={Settings2} title="Quick Settings">
            <ToggleRow label="Require two-factor authentication (2FA)" on={false} note={<NotYet />} />
            <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Allow session timeout (auto-logout)</span><NotYet /></div>
            <ToggleRow label="Restrict login by device/IP" on={false} note={<NotYet />} />
            <ToggleRow label="Notify on new user or role change" on={false} note={<NotYet />} />
          </Box>
        </div>
      </div>
    </>
  );
}

// ── Advanced ──────────────────────────────────────────────────────────────

type AdvData = { kpis: { integrations: number; webhooks: number; lastSync: string | null; records: number }; webhookUrl: string; eventsSeen: string[] };
const EVENT_LABEL: Record<string, string> = { "inbound.comment": "Comment", "inbound.message": "Message", "inbound.lead": "New Lead", "inbound.bot": "Bot message", send: "Reply sent", converted: "Order", escalated: "Late reply", test: "Test" };

export function AdvancedSection({ ctx }: { ctx: Ctx }) {
  const { s, d, setPrefs, shared } = ctx;
  const data = useLoad(() => socialLeadsApi.section<AdvData>("advanced"), "advanced");
  const [modal, setModal] = useState<"" | "logs" | "docs" | "health">("");
  const [testing, setTesting] = useState(false);
  const a = data.data;
  const test = async () => { setTesting(true); try { const r = await socialLeadsApi.testWebhook(); shared.onToast(`The address works (${r.ms} ms).`); data.reload(); } catch (e) { shared.onToast((e as Error).message); } finally { setTesting(false); } };
  const reset = () => { if (!window.confirm("Put every Social Leads setting back to the starting values? Your templates and holidays are reset too.")) return; ctx.set((x) => ({ ...x, prefs: { ...x.prefs, ...DEFAULT_RESET } as any, sla: { yellow: 2, red: 5, renotify: 10, escalate: 15, reassign: 20 }, autoAssign: true, maxOpenPerRep: 0 })); shared.onToast("Back to the starting values. Save Changes to apply."); };
  return (
    <>
      <SectionHeader icon={Settings2} title="Advanced" sub="Advanced configurations for integrations, automations, data, and system performance." right={<>
        <button type="button" onClick={reset} className={btn.ghost}><RotateCcw className="h-4 w-4 text-[#5B3FD9]" />Reset to Default</button>
        <button type="button" onClick={() => void ctx.save()} disabled={!ctx.dirty || ctx.saving} className={btn.primary}><CheckCircle2 className="h-4 w-4" />Save Changes</button>
      </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile icon={Code2} value={a?.kpis.integrations ?? "—"} label="Active Integrations" />
        <KpiTile icon={Zap} value={a?.kpis.webhooks ?? "—"} label="Active Webhooks" />
        <KpiTile icon={RefreshCw} value={a?.kpis.lastSync ? lagosDateTime(a.kpis.lastSync) : "Never"} label={a?.kpis.lastSync ? "● Last Sync" : "Last Sync"} />
        <KpiTile icon={Database} value={(a?.kpis.records ?? 0).toLocaleString()} label="Total Records" />
        <KpiTile icon={BarChart3} value="—" label="System Uptime" extra={<span className="text-[12px] text-gray-500">Not measured yet</span>} />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Box icon={Code2} title="API & Webhooks" sub="Connect ProtoHub OSM with external apps and automate data flow." right={<button type="button" onClick={() => setModal("logs")} className={`${btn.ghost} !py-2 !text-[13px]`}><RefreshCw className="h-4 w-4" />View Logs</button>}>
          <div className="flex items-center gap-3 py-1.5"><span className="flex-1 text-[13.5px] font-medium">API Access</span><NotYet /></div>
          <span className="mt-2 block text-[13px] font-semibold">Webhook URL (ManyChat posts here)</span>
          <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 px-2 py-2 text-[12px] dark:border-slate-700">{s.webhookUrl}</code><button type="button" aria-label="Copy" onClick={() => copyText(shared, s.webhookUrl)} className={`${btn.icon} !h-9 !w-9`}><Copy className="h-4 w-4" /></button></div>
          <span className="mt-3 block text-[13px] font-semibold">Webhook Events (seen this week)</span>
          <div className="mt-1 flex flex-wrap gap-1.5">{(a?.eventsSeen ?? []).length ? a!.eventsSeen.map((e) => <span key={e} className="rounded-lg bg-[#F1EEFD] px-2 py-1 text-[12px] font-semibold text-[#5B3FD9]">{EVENT_LABEL[e] ?? e}</span>) : <span className="text-[12.5px] text-gray-500">None yet.</span>}</div>
          <button type="button" onClick={async () => { if (!window.confirm("Make a new address? The old one stops working.")) return; ctx.replace(await socialLeadsApi.newAddress()); data.reload(); shared.onToast("New address made. Paste it into ManyChat."); }} className={`${btn.ghost} mt-3 !py-2 !text-[13px]`}><RotateCcw className="h-4 w-4" />Make a new address</button>
        </Box>
        <Box icon={RefreshCw} title="Data Sync & Import" sub="Control how data is synchronized between platforms.">
          <ToggleRow label="Auto-sync with Manychat" on={d.prefs.autoCreate} onChange={(v) => setPrefs({ autoCreate: v })} />
          <ToggleRow label="Sync Facebook & Instagram data" on={d.prefs.captureFacebookComments || d.prefs.captureInstagramComments || d.prefs.captureMessenger} onChange={(v) => setPrefs({ captureFacebookComments: v, captureInstagramComments: v, captureMessenger: v })} />
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Import existing leads (one-time)</span><button type="button" onClick={() => shared.goTab("leads")} className={`${btn.ghost} !py-1.5 !text-[13px]`}><Upload className="h-4 w-4" />Import Leads</button></div>
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Sync frequency</span><span className="rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-semibold dark:border-slate-700">Instant (each event)</span></div>
        </Box>
        <Box icon={Zap} title="Automation Controls" sub="Advanced rules for automation, routing, and system actions.">
          <ToggleRow label="Run automations in real time" sub="Always: the hand-out and reply clock run every minute." on={true} />
          <ToggleRow label="Allow multi-step workflows (zigzag)" sub="Build them in ManyChat." on={false} note={<NotYet />} />
          <ToggleRow label="Enable conditional routing" on={false} note={<NotYet />} />
          <ToggleRow label="Pause all automations (maintenance mode)" sub="Stops auto hand-out, moves to another rep, auto follow-ups, auto-close and after-hours replies." on={d.prefs.pauseAllAutomations} onChange={(v) => setPrefs({ pauseAllAutomations: v })} />
        </Box>
        <Box icon={Layers} title="Lead Deduplication" sub="Prevent duplicate leads across all channels.">
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Match by</span><Select label="Match by" className="w-[240px]" value={d.prefs.dedupeBy} onChange={(v) => setPrefs({ dedupeBy: v as any })} options={[{ value: "phone", label: "Phone Number (Recommended)" }, { value: "contact", label: "ManyChat contact only" }]} /></div>
          <ToggleRow label="Merge duplicate leads automatically" on={d.prefs.mergeDuplicates} onChange={(v) => setPrefs({ mergeDuplicates: v })} />
          <ToggleRow label="Keep the most recent conversation" sub="Always: replies go to the account the customer used last." on={true} />
        </Box>
        <Box icon={Database} title="Data Retention & Cleanup" sub="Manage how long data is kept and automate cleanups.">
          {["Keep conversation history for", "Keep lead data for", "Auto-delete closed leads after"].map((x) => <div key={x} className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">{x}</span><NotYet>Kept forever for now</NotYet></div>)}
          <ToggleRow label="Archive data instead of permanent deletion" sub="Nothing is ever deleted today." on={true} />
        </Box>
        <Box icon={Settings2} title="System Rules" sub="Advanced system behavior and limits.">
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Max file size (images/videos)</span><NotYet>Pictures by link only</NotYet></div>
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Allowed file types</span><span className="flex gap-1">{["JPG", "PNG"].map((x) => <span key={x} className="rounded-lg bg-[#F1EEFD] px-2 py-1 text-[12px] font-semibold text-[#5B3FD9]">{x}</span>)}</span></div>
          <div className="flex items-center gap-3 py-2"><span className="flex-1 text-[13.5px] font-medium">Rate limit (API requests)</span><span className="text-[13px] font-semibold">No limit on the ManyChat address</span></div>
          <ToggleRow label="Enable detailed system logs" sub="Always on: every event is in the activity log." on={true} />
        </Box>
      </div>
      <Box icon={Code2} title="Developer Tools" sub="Tools for testing, debugging, and system monitoring.">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={test} disabled={testing} className={btn.ghost}>{testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Test Webhook</button>
          <button type="button" onClick={() => setModal("docs")} className={btn.ghost}><BookOpen className="h-4 w-4" />API Docs</button>
          <button type="button" onClick={() => setModal("logs")} className={btn.ghost}><FileText className="h-4 w-4" />View Logs</button>
          <button type="button" onClick={() => setModal("health")} className={btn.ghost}><Activity className="h-4 w-4" />System Health</button>
        </div>
      </Box>
      {modal === "logs" && <LogsModal onClose={() => setModal("")} />}
      {modal === "docs" && <Modal title="Set up ManyChat" icon={BookOpen} onClose={() => setModal("")} width="max-w-[720px]"><SetupGuide webhookUrl={s.webhookUrl} onCopy={(t) => copyText(shared, t)} /></Modal>}
      {modal === "health" && <HealthModal ctx={ctx} onClose={() => setModal("")} />}
    </>
  );
}

const DEFAULT_RESET = {
  captureFacebookComments: true, captureInstagramComments: true, captureMessenger: true, autoCreate: true, sticky: true, pauseBotOnAssign: true, assignInHoursOnly: true, allowRepResumeBot: true,
  autoCloseDays: 7, hotKeywords: ["buy", "order", "i want"], autoFollowUpHours: 0, notifyInApp: true, notifyPush: true, distributeByWorkload: false, reassignEnabled: true, maxOpenEnabled: false,
  escalateOnBreach: true, notifyRepeatBreaches: true, dailySlaSummary: false, hoursEnabled: true, startMinute: 510, endMinute: 1020, workingDays: [1, 2, 3, 4, 5, 6], offHoursReply: false, pendingOffHours: true,
  dedupeBy: "contact", mergeDuplicates: true, pauseAllAutomations: false, eligibleRepIds: []
};

function HealthModal({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [checks, setChecks] = useState<Array<{ name: string; ok: boolean | null; text: string }>>([
    { name: "Protohub server", ok: null, text: "Checking…" }, { name: "ManyChat address", ok: null, text: "Checking…" }, { name: "ManyChat API key", ok: null, text: "Checking…" }
  ]);
  useEffect(() => {
    void (async () => {
      const out: typeof checks = [];
      try { await socialLeadsApi.header(); out.push({ name: "Protohub server", ok: true, text: "Answering" }); } catch (e) { out.push({ name: "Protohub server", ok: false, text: (e as Error).message }); }
      try { const r = await socialLeadsApi.testWebhook(); out.push({ name: "ManyChat address", ok: true, text: `Works (${r.ms} ms)` }); } catch (e) { out.push({ name: "ManyChat address", ok: false, text: (e as Error).message }); }
      if (!ctx.s.connected) out.push({ name: "ManyChat API key", ok: false, text: "Not added yet" });
      else { try { const r = await socialLeadsApi.testConnection(); out.push({ name: "ManyChat API key", ok: true, text: `Connected to ${r.pageName}` }); } catch (e) { out.push({ name: "ManyChat API key", ok: false, text: (e as Error).message }); } }
      out.push({ name: "Last event from ManyChat", ok: Boolean(ctx.s.lastEventAt), text: ctx.s.lastEventAt ? timeAgo(ctx.s.lastEventAt) : "None yet" });
      setChecks(out);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="System Health" icon={Server} onClose={onClose}>
      <div className="space-y-2">{checks.map((c) => <div key={c.name} className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 dark:border-slate-700"><span className={`h-3 w-3 rounded-full ${c.ok === null ? "bg-gray-300" : c.ok ? "bg-emerald-500" : "bg-rose-500"}`} /><b className="flex-1 text-[14px]">{c.name}</b><span className="text-[13px] text-gray-600">{c.text}</span></div>)}</div>
    </Modal>
  );
}

