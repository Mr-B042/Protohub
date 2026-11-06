import { useState } from "react";
import {
  AlertTriangle, ArrowRight, BarChart3, CalendarDays, CheckCircle2, ChevronRight, Code2, Eye, Megaphone, MessageSquare, MoreHorizontal,
  Phone, RefreshCw, Settings, ShoppingCart, UserPlus, Users, Zap
} from "lucide-react";
import type { TelegramOverview, TelegramStaff } from "../../lib/api";
import { Card, CardHead, IconBubble, StatusDot, TgLogo, Toggle, avatarTone, btn, initials, pct, roleShort, sinceText, timeOfDay, type TgTab } from "./tg-ui";

/**
 * Overview tab: Bright's design (6 Nov 2026), section for section. Numbers
 * are live; where nothing has happened yet the same box shows an honest empty.
 */

type Props = {
  data: TelegramOverview | null;
  period: string;
  onPeriod: (period: string) => void;
  goTab: (tab: TgTab) => void;
  onCreateAutomation: () => void;
  onToggleAutomation: (id: string, enabled: boolean) => void;
  onStaffLink: (staff: TelegramStaff) => void;
  onStaffUnlink: (staff: TelegramStaff) => void;
  busyId: string | null;
};

function Delta({ text, good }: { text: string | null; good: boolean }) {
  if (!text) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11.5px] font-bold ${good ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"}`}>
      {good ? "▲" : "▼"} {text}
    </span>
  );
}

function Kpi({ icon, tint, value, label, delta }: { icon: JSX.Element; tint: string; value: string; label: string; delta?: JSX.Element | null }) {
  return (
    <Card className="flex flex-col p-4">
      <span className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${tint}`}>{icon}</span>
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[28px] font-extrabold leading-none tracking-tight text-gray-900 dark:text-slate-50">{value}</span>
          {delta}
        </div>
        <p className="m-0 mt-2 text-[13px] text-gray-600 dark:text-slate-400">{label}</p>
      </div>
    </Card>
  );
}

const PERIODS = [{ value: "today", label: "Today" }, { value: "week", label: "This Week" }, { value: "month", label: "This Month" }];

export default function TabOverview({ data, period, onPeriod, goTab, onCreateAutomation, onToggleAutomation, onStaffLink, onStaffUnlink, busyId }: Props) {
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const k = data?.kpis;
  const bot = data?.bot ?? null;
  const messagesDelta = k && k.messagesYesterday > 0 ? Math.round(((k.messagesToday - k.messagesYesterday) / k.messagesYesterday) * 100) : null;
  const rateDelta = k && k.successRate != null && k.successRateBefore != null ? Math.round((k.successRate - k.successRateBefore) * 10) / 10 : null;
  const linkedCount = data?.staff.filter((row) => row.linked).length ?? 0;
  const active = (data?.automations ?? []).filter((row) => row.enabled);
  const tableRows = [...(data?.automations ?? [])].sort((a, b) => Number(b.enabled) - Number(a.enabled)).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Row 1: bot card + five numbers */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-[3.1fr_repeat(5,minmax(0,1fr))] 2xl:grid-cols-[2.55fr_repeat(5,minmax(0,1fr))]">
        <button type="button" onClick={() => goTab("bot")}
          className="!min-h-0 group relative col-span-2 overflow-hidden rounded-2xl bg-gradient-to-br from-[#2F8BEA] via-[#2D7FE0] to-[#5BA8F2] text-left text-white shadow-[0_6px_18px_rgba(31,143,224,0.35)] lg:col-span-3 xl:col-span-1">
          <svg className="pointer-events-none absolute inset-x-0 bottom-9 h-24 w-full opacity-30" viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 60 C 80 20, 160 100, 240 55 S 360 30, 400 50 L400 100 L0 100 Z" fill="#fff" />
          </svg>
          <div className="relative flex items-center gap-4 px-5 pb-4 pt-4">
            <span className="shrink-0 rounded-[20px] bg-white/95 p-2 shadow-lg"><TgLogo size={54} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <b className="truncate text-[18px] font-bold">{bot?.name ?? "No bot connected"}</b>
                <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-[#1F6FC4]">Operations Bot</span>
              </div>
              <p className="m-0 mt-0.5 text-[14px] text-white/85">{bot?.username ? `@${bot.username}` : "Connect your bot in Bot Configuration"}</p>
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold ${bot?.connected ? "bg-emerald-500/90" : "bg-white/25"}`}>
                <span className="h-2 w-2 rounded-full bg-white" />{bot?.connected ? "Connected" : "Not connected"}
              </span>
            </div>
            <ChevronRight className="h-5 w-5 text-white/80 transition-transform group-hover:translate-x-0.5" />
          </div>
          <div className="relative grid grid-cols-1 border-t border-white/20 bg-white/10 text-[12px] sm:grid-cols-3 sm:whitespace-nowrap">
            <span className="flex min-w-0 items-center gap-1.5 px-3 py-2.5"><RefreshCw className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Last Sync: {bot ? sinceText(bot.lastHealthAt ?? bot.connectedAt) : "—"}</span></span>
            <span className="flex min-w-0 items-center gap-1.5 border-white/20 px-3 py-2.5 max-sm:border-y sm:border-x"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Webhook: {bot?.webhookActive ? "Active" : bot ? "Not active" : "—"}</span></span>
            <span className="flex min-w-0 items-center gap-1.5 px-3 py-2.5"><BarChart3 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Uptime: {pct(bot?.uptime)}</span></span>
          </div>
        </button>
        <Kpi icon={<Users className="h-5 w-5 text-sky-600" />} tint="bg-sky-50 dark:bg-sky-500/10" value={String(k?.connectedStaff ?? 0)} label="Connected Staff"
          delta={k && k.connectedStaffNew > 0 ? <Delta text={`+${k.connectedStaffNew}`} good /> : null} />
        <Kpi icon={<MessageSquare className="h-5 w-5 text-violet-600" />} tint="bg-violet-50 dark:bg-violet-500/10" value={String(k?.messagesToday ?? 0)} label="Messages Today"
          delta={messagesDelta != null ? <Delta text={`${messagesDelta >= 0 ? "+" : ""}${messagesDelta}%`} good={messagesDelta >= 0} /> : null} />
        <Kpi icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} tint="bg-emerald-50 dark:bg-emerald-500/10" value={pct(k?.successRate)} label="Delivery Success Rate"
          delta={rateDelta != null && rateDelta !== 0 ? <Delta text={`${rateDelta > 0 ? "+" : ""}${rateDelta}%`} good={rateDelta > 0} /> : null} />
        <Kpi icon={<Zap className="h-5 w-5 text-orange-500" />} tint="bg-orange-50 dark:bg-orange-500/10" value={String(k?.activeAutomations ?? 0)} label="Active Automations" />
        <Kpi icon={<AlertTriangle className="h-5 w-5 text-rose-600" />} tint="bg-rose-50 dark:bg-rose-500/10" value={String(k?.failed ?? 0)} label="Failed Messages" />
      </div>

      {/* Row 2: performance, recent activity, quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1.05fr_1fr]">
        <Card className="pb-3">
          <CardHead title="Automation Performance" action={
            <select aria-label="Period" value={period} onChange={(event) => onPeriod(event.target.value)}
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-medium text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              {PERIODS.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
            </select>
          } />
          <ul className="m-0 mt-2 list-none space-y-1 px-5 p-0">
            {(data?.performance ?? []).map((row) => (
              <li key={row.key} className="flex items-center gap-3 py-2">
                <IconBubble group={row.key} />
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-gray-900 dark:text-slate-100">{row.label}</div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600" style={{ width: `${row.rate ?? 0}%` }} />
                  </div>
                </div>
                <span className={`w-12 text-right text-[14px] font-bold ${row.rate == null ? "text-gray-400" : "text-emerald-700 dark:text-emerald-300"}`}>{pct(row.rate)}</span>
              </li>
            ))}
          </ul>
          {data && data.performance.every((row) => row.rate == null) && <p className="m-0 px-5 pt-1 text-[12px] text-gray-500">No automated messages in this period yet: each bar fills as messages go out.</p>}
        </Card>

        <Card className="pb-3">
          <CardHead title="Recent Activity" action={<button type="button" className={btn.link} onClick={() => goTab("logs")}>View All <ArrowRight className="h-4 w-4" /></button>} />
          <ul className="m-0 mt-2 list-none divide-y divide-gray-100 p-0 px-5 dark:divide-slate-800">
            {(data?.recent ?? []).slice(0, 5).map((row) => (
              <li key={row.id} className="flex items-start gap-3 py-2.5">
                {row.status === "failed" ? <IconBubble trigger="order_failed" /> : <IconBubble trigger={row.trigger} />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-gray-900 dark:text-slate-100">{row.status === "failed" ? `Not delivered: ${row.title ?? "message"}` : row.title ?? "Message sent"}</div>
                  <div className="truncate text-[12.5px] text-gray-500 dark:text-slate-400">{[row.orderId ? `Order #${row.orderId}` : null, row.recipient ? `to ${row.recipient}` : null].filter(Boolean).join(" ") || "—"}</div>
                </div>
                <span className="shrink-0 pt-0.5 text-[12.5px] text-gray-500">{timeOfDay(row.createdAt)}</span>
              </li>
            ))}
            {data && data.recent.length === 0 && <li className="py-6 text-center text-[13px] text-gray-500">Nothing sent yet. Connect the bot and your staff, and activity shows here.</li>}
          </ul>
        </Card>

        <Card className="pb-4 lg:col-span-2 xl:col-span-1">
          <CardHead title="Quick Actions" />
          <div className="mt-3 grid grid-cols-1 gap-2.5 px-4 sm:grid-cols-2">
            {[
              { title: "Create Automation", sub: "Set up a new workflow", icon: <Zap className="h-5 w-5 text-sky-600" />, tint: "bg-sky-50", go: onCreateAutomation },
              { title: "Send Announcement", sub: "Broadcast to your team", icon: <Megaphone className="h-5 w-5 text-fuchsia-600" />, tint: "bg-fuchsia-50", go: () => goTab("messages") },
              { title: "Connect Staff", sub: "Link Telegram accounts", icon: <UserPlus className="h-5 w-5 text-emerald-600" />, tint: "bg-emerald-50", go: () => goTab("staff") },
              { title: "Schedule Report", sub: "Daily, weekly or custom", icon: <CalendarDays className="h-5 w-5 text-orange-500" />, tint: "bg-orange-50", go: () => goTab("automations") },
              { title: "Manage Commands", sub: "Set bot commands & actions", icon: <Code2 className="h-5 w-5 text-sky-600" />, tint: "bg-sky-50", go: () => goTab("commands") },
              { title: "Bot Settings", sub: "Token, webhook & security", icon: <Settings className="h-5 w-5 text-gray-700" />, tint: "bg-gray-100", go: () => goTab("bot") }
            ].map((tile) => (
              <button key={tile.title} type="button" onClick={tile.go}
                className="!min-h-0 flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-2.5 py-2.5 text-left transition hover:border-[#1F8FE0]/50 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tile.tint} dark:bg-slate-800`}>{tile.icon}</span>
                <span className="min-w-0">
                  <b className="block text-[13px] leading-tight text-gray-900 dark:text-slate-100">{tile.title}</b>
                  <span className="mt-0.5 block text-[11px] leading-snug text-gray-500 dark:text-slate-400">{tile.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Row 3: staff, automations table, promo */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1.32fr_1.18fr]">
        <Card className="pb-2">
          <CardHead title={`Connected Staff (${linkedCount})`} action={<button type="button" className={btn.link} onClick={() => goTab("staff")}>Manage <ArrowRight className="h-4 w-4" /></button>} />
          <ul className="m-0 mt-2 list-none divide-y divide-gray-100 p-0 px-5 dark:divide-slate-800">
            {(data?.staff ?? []).slice(0, 5).map((row) => (
              <li key={row.id} className="relative flex items-center gap-3 py-2.5">
                <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${avatarTone(row.name)}`}>{initials(row.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-gray-900 dark:text-slate-100">{row.name}</div>
                  <div className="truncate text-[12px] text-gray-500">{roleShort(row.role)}</div>
                </div>
                <StatusDot on={row.linked} />
                <button type="button" aria-label={`Options for ${row.name}`} onClick={() => setMenuFor(menuFor === row.id ? null : row.id)} className="!min-h-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
                {menuFor === row.id && (
                  <div className="absolute right-0 top-11 z-20 w-52 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    {row.linked
                      ? <button type="button" disabled={busyId === row.id} onClick={() => { setMenuFor(null); onStaffUnlink(row); }} className="!min-h-0 w-full rounded-lg px-3 py-2 text-left text-[13px] text-rose-700 hover:bg-rose-50">Disconnect their Telegram</button>
                      : <button type="button" disabled={busyId === row.id} onClick={() => { setMenuFor(null); onStaffLink(row); }} className="!min-h-0 w-full rounded-lg px-3 py-2 text-left text-[13px] text-gray-800 hover:bg-gray-50 dark:text-slate-100">Copy their connect link</button>}
                    <button type="button" onClick={() => { setMenuFor(null); goTab("staff"); }} className="!min-h-0 w-full rounded-lg px-3 py-2 text-left text-[13px] text-gray-800 hover:bg-gray-50 dark:text-slate-100">Open Staff & Recipients</button>
                  </div>
                )}
              </li>
            ))}
            {data && data.staff.length === 0 && <li className="py-6 text-center text-[13px] text-gray-500">No staff yet.</li>}
          </ul>
        </Card>

        <Card className="pb-3">
          <CardHead title={`Active Automations (${active.length})`} action={<button type="button" className={btn.link} onClick={() => goTab("automations")}>View All <ArrowRight className="h-4 w-4" /></button>} />
          <div className="mt-3 overflow-x-auto px-5">
            <table className="!min-w-0 w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-gray-50 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800/60 dark:text-slate-400">
                  <th className="rounded-l-lg px-3 py-2">Automation</th><th className="px-3 py-2">Trigger</th><th className="px-3 py-2">Recipient</th><th className="rounded-r-lg px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2.5"><span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-100"><IconBubble trigger={row.trigger} size="sm" /><span className="truncate">{row.name}</span></span></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-gray-600 dark:text-slate-400">{row.triggerLabel}</td>
                    <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-violet-50 px-2.5 py-1 text-[12px] font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"><Users className="h-3.5 w-3.5" />{row.recipientLabel}</span></td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${row.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-slate-800"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${row.enabled ? "bg-emerald-500" : "bg-gray-400"}`} />{row.enabled ? "Active" : "Paused"}
                        </span>
                        <Toggle on={row.enabled} disabled={busyId === row.id} label={`${row.name} on or off`} onChange={(next) => onToggleAutomation(row.id, next)} />
                      </span>
                    </td>
                  </tr>
                ))}
                {tableRows.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-500">Automations appear once the bot is connected.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Telegram for Your Business (illustration with a sample message) */}
        <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#EAF4FF] via-[#F3F8FF] to-[#E4F1FF] p-5 lg:col-span-2 xl:col-span-1 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800">
          <div className="grid grid-cols-[150px_minmax(0,1fr)] items-start gap-4">
            <div className="overflow-hidden rounded-[28px] border-[6px] border-gray-900 bg-[#DCEBF7] shadow-xl" aria-hidden="true">
              <div className="flex items-center gap-1.5 rounded-t-[20px] bg-[#2F8BEA] px-2.5 py-2 text-white">
                <TgLogo size={18} />
                <span className="min-w-0 leading-tight"><b className="block truncate text-[10.5px]">ProtoHub Bot</b><span className="text-[9px] text-white/80">bot</span></span>
              </div>
              <div className="space-y-1.5 p-2">
                <div className="rounded-lg bg-white p-2 text-[9.5px] leading-[1.45] text-gray-800 shadow-sm">
                  <div className="flex items-center gap-1 font-bold"><ShoppingCart className="h-3 w-3 text-orange-500" />NEW ORDER RECEIVED</div>
                  <div>Order ID: #PH-5938</div>
                  <div>Product: 5-in-1 Corner Rack</div>
                  <div>Amount: ₦39,500</div>
                  <div>Location: Lagos</div>
                  <div className="flex justify-between"><span>Assigned to: Esther</span><span className="text-gray-400">2:15 PM</span></div>
                </div>
                <div className="flex items-center justify-center gap-1 rounded-md bg-white/90 py-1 text-[9.5px] font-semibold text-gray-700"><Phone className="h-3 w-3" />Call Customer</div>
                <div className="flex items-center justify-center gap-1 rounded-md bg-white/90 py-1 text-[9.5px] font-semibold text-gray-700"><Eye className="h-3 w-3" />View Order</div>
              </div>
            </div>
            <div>
              <div className="flex items-start justify-between gap-2">
                <h3 className="m-0 text-[18px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Telegram for Your Business</h3>
                <TgLogo size={40} className="shrink-0 drop-shadow" />
              </div>
              <ul className="m-0 mt-3 list-none space-y-2 p-0 text-[12.5px] text-gray-800 dark:text-slate-200">
                {["Real-time order alerts", "Follow-up accountability", "Delivery & logistics updates", "Stock & inventory alerts", "Daily & weekly reports"].map((item) => (
                  <li key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 fill-emerald-500 text-white" />{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
