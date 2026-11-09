import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive, BarChart3, CalendarDays, CheckCircle2, ChevronDown, Coins, Copy, FileText, LayoutGrid, List, Mail, MailOpen, MoreHorizontal, MousePointerClick,
  Pause, Pencil, Play, Plus, Search, Send, ShoppingCart, Trash2, Undo2, Users, Zap, Eye
} from "lucide-react";
import { emailMarketingApi, type EmCampaign } from "../../lib/api";
import {
  Card, Delta, ErrorNote, GOAL_TYPES, KpiTile, Loading, Pill, STATUS_LOOK, Thumb, btn, count, input, lagosDate, naira, pct, rate, select, type EmSection
} from "./em-ui";
import CampaignReport from "./CampaignReport";
import EmailPreviewGallery from "./EmailPreviewGallery";

/** Campaigns page, built to Bright's design (image 49, 8 Nov 2026). */

type StatusTab = "all" | "scheduled" | "sending" | "completed" | "drafts" | "archived";
const STATUS_TABS: Array<{ key: StatusTab; label: string; icon: typeof Mail; statuses: string[] }> = [
  { key: "all", label: "All Campaigns", icon: Mail, statuses: [] },
  { key: "scheduled", label: "Scheduled", icon: CalendarDays, statuses: ["scheduled", "paused"] },
  { key: "sending", label: "Sending", icon: Send, statuses: ["sending", "active"] },
  { key: "completed", label: "Completed", icon: CheckCircle2, statuses: ["completed", "cancelled"] },
  { key: "drafts", label: "Drafts", icon: FileText, statuses: ["draft"] },
  { key: "archived", label: "Archived", icon: Archive, statuses: ["archived"] }
];
const RANGES = [
  { key: "7", label: "Last 7 Days", days: 7 },
  { key: "30", label: "Last 30 Days", days: 30 },
  { key: "90", label: "Last 90 Days", days: 90 },
  { key: "365", label: "Last 12 Months", days: 365 },
  { key: "all", label: "All Time", days: 0 }
];

type MenuState = { row: EmCampaign; x: number; y: number; up: boolean } | null;

function sums(rows: EmCampaign[]) {
  return rows.reduce((acc, row) => ({
    sent: acc.sent + row.stats.sent, opened: acc.opened + row.stats.opened, clicked: acc.clicked + row.stats.clicked,
    orders: acc.orders + row.stats.orders, revenue: acc.revenue + row.stats.revenue
  }), { sent: 0, opened: 0, clicked: 0, orders: 0, revenue: 0 });
}
const pointChange = (now: number | null, before: number | null) => (now === null || before === null ? null : Math.round((now - before) * 10) / 10);

export default function CampaignsPage({ onNavigate, onCreate, onEdit, onToast, refreshKey }: {
  onNavigate: (section: EmSection) => void;
  onCreate: () => void;
  onEdit: (id: string) => void;
  onToast: (message: string) => void;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<EmCampaign[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<StatusTab>("all");
  const [range, setRange] = useState("30");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [audience, setAudience] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState>(null);
  const [report, setReport] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const [testFor, setTestFor] = useState<EmCampaign | null>(null);
  const [page, setPage] = useState(1);

  const load = async () => {
    try {
      const result = await emailMarketingApi.campaigns();
      setRows(result.campaigns);
      setError("");
    } catch (err) {
      setError((err as Error).message || "Could not load the campaigns.");
    }
  };
  useEffect(() => { void load(); }, [refreshKey]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [menu]);

  const all = rows ?? [];
  const days = RANGES.find((row) => row.key === range)?.days ?? 30;
  const nowMs = Date.now();
  const inWindow = (row: EmCampaign, from: number, to: number) => {
    const at = Date.parse(row.stats.lastSentAt ?? row.launchedAt ?? row.createdAt);
    return at >= from && at < to;
  };
  const current = days ? all.filter((row) => inWindow(row, nowMs - days * 86_400_000, nowMs + 60_000)) : all;
  const previous = days ? all.filter((row) => inWindow(row, nowMs - 2 * days * 86_400_000, nowMs - days * 86_400_000)) : [];
  const now = sums(current), before = sums(previous);
  const nonArchived = all.filter((row) => row.status !== "archived");

  const audiences = useMemo(() => [...new Set(all.map((row) => row.audienceLabel ?? ""))].filter(Boolean).sort(), [all]);
  const filtered = useMemo(() => {
    const statuses = STATUS_TABS.find((row) => row.key === tab)?.statuses ?? [];
    const q = query.trim().toLowerCase();
    return all.filter((row) => (tab === "all" ? row.status !== "archived" : statuses.includes(row.status))
      && (!type || row.goal === type)
      && (!audience || row.audienceLabel === audience)
      && (!status || row.status === status)
      && (!q || `${row.name} ${row.subject} ${row.audienceLabel ?? ""} ${GOAL_TYPES[row.goal]?.label ?? ""}`.toLowerCase().includes(q)));
  }, [all, tab, query, type, audience, status]);
  const pageSize = 10;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);
  useEffect(() => { setPage(1); }, [tab, query, type, audience, status]);

  const act = async (row: EmCampaign, action: "pause" | "resume" | "cancel" | "archive" | "unarchive" | "duplicate" | "delete") => {
    setMenu(null);
    try {
      if (action === "duplicate") { const created = await emailMarketingApi.duplicateCampaign(row.id); onToast("Copied. The copy is a draft."); await load(); onEdit(created.id); return; }
      if (action === "delete") {
        if (!window.confirm(`Delete the draft "${row.name}"? This cannot be undone.`)) return;
        await emailMarketingApi.deleteCampaign(row.id); onToast("Draft deleted."); await load(); return;
      }
      await emailMarketingApi.act(row.id, action);
      onToast({ pause: "Paused. Nothing more goes out until you resume.", resume: "Resumed.", cancel: "Back to draft.", archive: "Archived.", unarchive: "Moved out of the archive." }[action]);
      await load();
    } catch (err) {
      onToast((err as Error).message || "That did not work.");
    }
  };
  const archivePicked = async () => {
    const list = all.filter((row) => picked.has(row.id));
    let done = 0;
    for (const row of list) {
      try { await emailMarketingApi.act(row.id, "archive"); done += 1; } catch { /* sending ones refuse */ }
    }
    onToast(done === list.length ? `Archived ${done}.` : `Archived ${done} of ${list.length}. Campaigns that are waiting or sending must be paused first.`);
    setPicked(new Set());
    await load();
  };

  const openMenu = (row: EmCampaign, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const up = window.innerHeight - rect.bottom < 300;
    setMenu({ row, x: Math.max(8, rect.right - 210), y: up ? window.innerHeight - rect.top + 4 : rect.bottom + 4, up });
  };

  const menuItems = (row: EmCampaign) => {
    const items: Array<{ label: string; icon: typeof Mail; run: () => void; danger?: boolean }> = [];
    if (["draft", "scheduled", "paused", "active"].includes(row.status)) items.push({ label: row.status === "draft" ? "Edit" : "Edit (keeps its schedule)", icon: Pencil, run: () => { setMenu(null); onEdit(row.id); } });
    items.push({ label: "See results", icon: BarChart3, run: () => { setMenu(null); setReport(row.id); } });
    items.push({ label: "Send test email", icon: Send, run: () => { setMenu(null); setTestFor(row); } });
    items.push({ label: "Duplicate", icon: Copy, run: () => void act(row, "duplicate") });
    if (["scheduled", "sending", "active"].includes(row.status)) items.push({ label: "Pause", icon: Pause, run: () => void act(row, "pause") });
    if (row.status === "paused") items.push({ label: "Resume", icon: Play, run: () => void act(row, "resume") });
    if (["scheduled", "paused"].includes(row.status) && !row.runCount) items.push({ label: "Back to draft", icon: Undo2, run: () => void act(row, "cancel") });
    if (["draft", "completed", "cancelled", "paused"].includes(row.status)) items.push({ label: "Archive", icon: Archive, run: () => void act(row, "archive") });
    if (row.status === "archived") items.push({ label: "Unarchive", icon: Undo2, run: () => void act(row, "unarchive") });
    if (row.status === "draft") items.push({ label: "Delete draft", icon: Trash2, run: () => void act(row, "delete"), danger: true });
    return items;
  };

  const tabCount = (key: StatusTab) => key === "all" ? nonArchived.length : all.filter((row) => (STATUS_TABS.find((t) => t.key === key)?.statuses ?? []).includes(row.status)).length;
  const openNow = rate(now.opened, now.sent), openBefore = rate(before.opened, before.sent);
  const clickNow = rate(now.clicked, now.sent), clickBefore = rate(before.clicked, before.sent);
  const convNow = rate(now.orders, now.sent), convBefore = rate(before.orders, before.sent);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Mail className="h-7 w-7" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Campaigns</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Manage, track and improve all your email campaigns.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setGallery(true)} className={btn.ghost}><Eye className="h-4 w-4 text-[#5B3FD9]" />Preview Emails</button>
          <button type="button" onClick={() => onNavigate("templates")} className={btn.ghost}><FileText className="h-4 w-4 text-[#5B3FD9]" />Templates</button>
          <button type="button" onClick={() => onNavigate("automations")} className={btn.ghost}><Zap className="h-4 w-4 text-[#5B3FD9]" />Automations</button>
          <button type="button" onClick={() => onNavigate("audience")} className={btn.ghost}><Users className="h-4 w-4 text-[#5B3FD9]" />Audiences</button>
          <button type="button" onClick={onCreate} className={btn.primary}><Plus className="h-4 w-4" />New Campaign</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiTile icon={Send} label="Total Campaigns" value={count(nonArchived.length)} />
        <KpiTile icon={Mail} tone="green" label="Sent" value={count(now.sent)} />
        <KpiTile icon={MailOpen} label="Open Rate" value={pct(openNow)}><Delta value={pointChange(openNow, openBefore)} suffix="pp" /></KpiTile>
        <KpiTile icon={MousePointerClick} label="Click Rate" value={pct(clickNow)}><Delta value={pointChange(clickNow, clickBefore)} suffix="pp" /></KpiTile>
        <KpiTile icon={ShoppingCart} label="Conversions" value={pct(convNow)}><Delta value={pointChange(convNow, convBefore)} suffix="pp" /></KpiTile>
        <KpiTile icon={Coins} label="Revenue" value={naira(now.revenue)}><Delta value={before.revenue > 0 ? Math.round(((now.revenue - before.revenue) / before.revenue) * 1000) / 10 : null} /></KpiTile>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}
            className={`!min-h-0 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold ${tab === key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            <Icon className="h-4 w-4" />{label} ({tabCount(key)})
          </button>
        ))}
        <label className="relative ml-auto">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B3FD9]" />
          <select value={range} onChange={(event) => setRange(event.target.value)} className={`${select} !w-[170px] !pl-9`} aria-label="Date range">
            {RANGES.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
          </select>
        </label>
      </div>

      <ErrorNote message={error} />
      {!rows && !error && <Loading />}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3 dark:border-slate-800">
          <label className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search campaign (name, subject, or type)..." className={`${input} !pl-9`} />
          </label>
          <select value={type} onChange={(event) => setType(event.target.value)} className={`${select} !w-[150px]`} aria-label="Type">
            <option value="">All Types</option>
            {Object.entries(GOAL_TYPES).map(([key, look]) => <option key={key} value={key}>{look.label}</option>)}
          </select>
          <select value={audience} onChange={(event) => setAudience(event.target.value)} className={`${select} !w-[170px]`} aria-label="Audience">
            <option value="">All Audiences</option>
            {audiences.map((label) => <option key={label} value={label}>{label}</option>)}
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={`${select} !w-[150px]`} aria-label="Status">
            <option value="">All Status</option>
            {Object.entries(STATUS_LOOK).map(([key, look]) => <option key={key} value={key}>{look.label.replace("✓ ", "")}</option>)}
          </select>
          <div className="ml-auto inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
            <button type="button" aria-label="List view" onClick={() => setView("list")} className={`!min-h-0 px-3 py-2 ${view === "list" ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><List className="h-4 w-4" /></button>
            <button type="button" aria-label="Grid view" onClick={() => setView("grid")} className={`!min-h-0 px-3 py-2 ${view === "grid" ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><LayoutGrid className="h-4 w-4" /></button>
          </div>
        </div>

        {picked.size > 0 && (
          <div className="flex items-center gap-3 border-b border-gray-100 bg-[#F7F4FF] px-4 py-2 text-[13px] dark:border-slate-800 dark:bg-slate-800/50">
            <strong>{picked.size} selected</strong>
            <button type="button" onClick={() => void archivePicked()} className={btn.outline}><Archive className="h-3.5 w-3.5" />Archive</button>
            <button type="button" onClick={() => setPicked(new Set())} className="!min-h-0 text-[13px] text-gray-600 hover:underline">Clear</button>
          </div>
        )}

        {rows && !filtered.length ? (
          <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
            <Mail className="h-9 w-9 text-[#B9A8F5]" />
            <p className="m-0 text-[15px] font-semibold text-gray-800 dark:text-slate-200">{all.length ? "No campaign matches these filters." : "No campaigns yet."}</p>
            {!all.length && <button type="button" onClick={onCreate} className={btn.primary}><Plus className="h-4 w-4" />New Campaign</button>}
          </div>
        ) : view === "list" ? (
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[1080px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-gray-100 text-[13px] font-bold text-gray-700 dark:border-slate-800 dark:text-slate-300">
                  <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Pick all" checked={shown.length > 0 && shown.every((row) => picked.has(row.id))}
                    onChange={(event) => setPicked(event.target.checked ? new Set([...picked, ...shown.map((row) => row.id)]) : new Set([...picked].filter((id) => !shown.some((row) => row.id === id))))} /></th>
                  <th className="px-3 py-3">Campaign Name</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Audience</th><th className="px-3 py-3 text-right">Sent</th>
                  <th className="px-3 py-3 text-right">Open Rate</th><th className="px-3 py-3 text-right">Click Rate</th><th className="px-3 py-3 text-right">Conversions</th>
                  <th className="px-3 py-3 text-right">Revenue</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const look = GOAL_TYPES[row.goal] ?? GOAL_TYPES.retention;
                  const TypeIcon = look.icon;
                  const state = STATUS_LOOK[row.status] ?? STATUS_LOOK.draft;
                  const s = row.stats;
                  const when = row.delivery?.type === "automation" ? "Runs automatically" : lagosDate(s.lastSentAt ?? row.nextRunAt ?? row.sendAt ?? row.createdAt, true);
                  return (
                    <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                      <td className="px-4 py-3"><input type="checkbox" aria-label={`Pick ${row.name}`} checked={picked.has(row.id)} onChange={(event) => { const next = new Set(picked); if (event.target.checked) next.add(row.id); else next.delete(row.id); setPicked(next); }} /></td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => (row.status === "draft" ? onEdit(row.id) : setReport(row.id))} className="!min-h-0 flex items-center gap-3 text-left">
                          <Thumb src={row.thumbnailUrl} goal={row.goal} size={64} />
                          <span className="min-w-0">
                            <span className="line-clamp-2 max-w-[230px] font-bold text-gray-900 dark:text-slate-50">{row.name}</span>
                            <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-gray-500"><CalendarDays className="h-3.5 w-3.5" />{when}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3"><Pill tone={look.tone} className="!text-[12.5px]"><TypeIcon className="h-3.5 w-3.5" />{look.label}</Pill></td>
                      <td className="px-3 py-3"><span className="block max-w-[150px] truncate">{row.audienceLabel ?? "—"}</span><span className="text-[12.5px] text-gray-500">({count(row.audienceCount)})</span></td>
                      <td className="px-3 py-3 text-right tabular-nums">{count(s.sent)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{pct(rate(s.opened, s.sent))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{pct(rate(s.clicked, s.sent))}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{pct(rate(s.orders, s.sent))}</td>
                      <td className="px-3 py-3 text-right font-bold tabular-nums">{naira(s.revenue)}</td>
                      <td className="px-3 py-3"><Pill tone={state.tone}>{state.label}</Pill></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          <button type="button" aria-label="Results" onClick={() => setReport(row.id)} className={btn.icon}><BarChart3 className="h-4 w-4 text-[#5B3FD9]" /></button>
                          <button type="button" aria-label="More" onClick={(event) => openMenu(row, event.currentTarget)} className="!min-h-0 rounded-md p-1.5 text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-slate-800"><MoreHorizontal className="h-5 w-5" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((row) => {
              const look = GOAL_TYPES[row.goal] ?? GOAL_TYPES.retention;
              const state = STATUS_LOOK[row.status] ?? STATUS_LOOK.draft;
              return (
                <div key={row.id} className="rounded-xl border border-gray-200 p-3.5 dark:border-slate-700">
                  <div className="flex items-start gap-3">
                    <Thumb src={row.thumbnailUrl} goal={row.goal} size={56} />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 line-clamp-2 font-bold text-gray-900 dark:text-slate-50">{row.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5"><Pill tone={look.tone}>{look.label}</Pill><Pill tone={state.tone}>{state.label}</Pill></div>
                    </div>
                    <button type="button" aria-label="More" onClick={(event) => openMenu(row, event.currentTarget)} className="!min-h-0 rounded-md p-1 text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-5 w-5" /></button>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[12px]">
                    {[["Sent", count(row.stats.sent)], ["Opened", pct(rate(row.stats.opened, row.stats.sent))], ["Clicked", pct(rate(row.stats.clicked, row.stats.sent))], ["Revenue", naira(row.stats.revenue)]].map(([label, value]) => (
                      <div key={label} className="rounded-lg bg-gray-50 py-1.5 dark:bg-slate-800"><div className="font-bold text-gray-900 dark:text-slate-50">{value}</div><div className="text-gray-500">{label}</div></div>
                    ))}
                  </div>
                  <button type="button" onClick={() => setReport(row.id)} className={`${btn.outline} mt-3 w-full`}><BarChart3 className="h-3.5 w-3.5" />See results</button>
                </div>
              );
            })}
          </div>
        )}

        {filtered.length > pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-[13px] text-gray-600 dark:border-slate-800 dark:text-slate-400">
            <span>Showing {(Math.min(page, pages) - 1) * pageSize + 1}–{Math.min(Math.min(page, pages) * pageSize, filtered.length)} of {filtered.length} campaigns</span>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: pages }, (_, i) => i + 1).slice(0, 8).map((n) => (
                <button key={n} type="button" onClick={() => setPage(n)} className={`!min-h-0 h-9 w-9 rounded-lg text-[13px] font-semibold ${n === Math.min(page, pages) ? "bg-[#5B3FD9] text-white" : "border border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>{n}</button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setMenu(null)} />
          <div className="fixed z-[81] w-[210px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            style={menu.up ? { left: menu.x, bottom: menu.y } : { left: menu.x, top: menu.y }}>
            {menuItems(menu.row).map((item) => (
              <button key={item.label} type="button" onClick={item.run}
                className={`!min-h-0 flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] hover:bg-gray-50 dark:hover:bg-slate-800 ${item.danger ? "text-rose-600" : "text-gray-800 dark:text-slate-200"}`}>
                <item.icon className="h-4 w-4" />{item.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
      {gallery && <EmailPreviewGallery title="Campaign Email Previews" campaigns={(rows ?? []).filter((row) => row.status !== "archived")} onClose={() => setGallery(false)} onEdit={(id) => { setGallery(false); onEdit(id); }} />}
      {report && <CampaignReport id={report} onClose={() => setReport(null)} onEdit={(id) => { setReport(null); onEdit(id); }} />}
      {testFor && <TestSendModal campaign={testFor} onClose={() => setTestFor(null)} onToast={onToast} />}
    </div>
  );
}

/** "Send test email" from a campaign row. */
export function TestSendModal({ campaign, defaultEmail = "", onClose, onToast, sendTest }: {
  campaign: { id: string; name: string };
  defaultEmail?: string;
  onClose: () => void;
  onToast: (message: string) => void;
  sendTest?: (emails: string[]) => Promise<Array<{ email: string; ok: boolean; error?: string }>>;
}) {
  const [text, setText] = useState(defaultEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLInputElement | null>(null);
  useEffect(() => { box.current?.focus(); }, []);
  const send = async () => {
    const emails = text.split(/[\s,;]+/).map((row) => row.trim()).filter(Boolean);
    if (!emails.length) { setError("Add an email address."); return; }
    setBusy(true);
    setError("");
    try {
      const results = sendTest ? await sendTest(emails) : (await emailMarketingApi.sendTest(campaign.id, emails)).results;
      const failed = results.filter((row) => !row.ok);
      if (failed.length) setError(`Not sent to ${failed.map((row) => row.email).join(", ")}: ${failed[0].error ?? "the email service refused it"}`);
      else { onToast(`Test email sent to ${emails.join(", ")}. Links in a test go straight to their pages.`); onClose(); }
    } catch (err) {
      setError((err as Error).message || "Could not send the test.");
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Send a test email</h3>
        <p className="m-0 mt-1 text-[13px] text-gray-600 dark:text-slate-400">"{campaign.name}" goes to these addresses with [Test] in front of the subject. Up to 5, separated by commas.</p>
        <input ref={box} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void send(); }} placeholder="you@example.com" className={`${input} mt-4`} />
        {error && <p className="m-0 mt-2 text-[12.5px] text-rose-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void send()} className={btn.primary}><Send className="h-4 w-4" />{busy ? "Sending…" : "Send Test"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
