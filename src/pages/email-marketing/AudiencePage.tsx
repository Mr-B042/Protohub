import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive, Ban, ChevronLeft, ChevronRight, Crown, Download, FileText, LayoutGrid, Layers, List, ListChecks, Mail, MailOpen, MoreHorizontal, Pause, Pencil, Play, Plus, Search, Send,
  Sparkles, Tag, Trash2, TrendingUp, Undo2, Upload, UserPlus, Users, Zap, Activity
} from "lucide-react";
import { emailMarketingApi, type EmAudiencePage, type EmContact, type EmDesigner, type EmField, type EmSegment } from "../../lib/api";
import {
  Card, Delta, Donut, ErrorNote, IconTile, KpiTile, Loading, Pill, SLICE_COLORS, SegmentIcon, WaitingForDesign, btn, count, downloadCsv, input, lagosDate, pct, select
} from "./em-ui";
import { AllAudienceTab, FieldsTab, ImportSyncTab, ListsTab, TagsTab } from "./AudienceTabs";
import SegmentEditor from "./SegmentEditor";

/** Audience & Segments, built to Bright's design (image 52, 8 Nov 2026). */

type SubTab = "segments" | "audience" | "lists" | "tags" | "fields" | "import" | "health";
const SUB_TABS: Array<{ key: SubTab; label: string; icon: typeof Users }> = [
  { key: "segments", label: "Segments", icon: Layers },
  { key: "audience", label: "All Audience", icon: Users },
  { key: "lists", label: "Lists", icon: ListChecks },
  { key: "tags", label: "Tags", icon: Tag },
  { key: "fields", label: "Custom Fields", icon: FileText },
  { key: "import", label: "Import / Sync", icon: Upload },
  { key: "health", label: "Audience Health", icon: Activity }
];
// The page icon follows the tab, as in Bright's designs.
const HEADER_ICON: Partial<Record<SubTab, typeof Users>> = { tags: Tag, fields: Layers, import: Upload };
const ICON_TONE: Record<string, string> = {
  crown: "text-amber-500", refresh: "text-[#5B3FD9]", cart: "text-[#5B3FD9]", clock: "text-[#5B3FD9]", cartx: "text-[#5B3FD9]", sparkles: "text-[#5B3FD9]",
  tag: "text-[#5B3FD9]", pin: "text-[#5B3FD9]", upload: "text-sky-600", users: "text-[#5B3FD9]"
};
const SOURCE_LABEL: Record<string, string> = { order: "Order form", cart: "Unfinished order", manual: "Added by hand", import: "Uploaded" };

type Modal = null | { kind: "add" } | { kind: "import" } | { kind: "segment"; segment?: EmSegment };

export default function AudiencePage({ onToast, onUseSegment, openModal, onModalOpened }: {
  onToast: (message: string) => void;
  onUseSegment: (segmentId: string) => void;
  openModal: "add-subscribers" | "create-segment" | null;
  onModalOpened: () => void;
}) {
  const [data, setData] = useState<EmAudiencePage | null>(null);
  const [contacts, setContacts] = useState<EmContact[] | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<SubTab>("segments");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Modal>(null);
  const [menu, setMenu] = useState<{ segment: EmSegment; x: number; y: number; up: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [importRefresh, setImportRefresh] = useState(0);
  const loadDesigner = async () => { try { setDesigner(await emailMarketingApi.designer()); } catch (err) { setError((err as Error).message || "Could not load the builder."); } };
  useEffect(() => { if ((modal?.kind === "segment" || tab === "audience") && !designer) void loadDesigner(); }, [modal, tab]);

  const load = async () => {
    try {
      setData(await emailMarketingApi.audience());
      setError("");
    } catch (err) {
      setError((err as Error).message || "Could not load the audience.");
    }
  };
  const loadContacts = async () => {
    try { setContacts((await emailMarketingApi.contacts()).contacts); } catch (err) { setError((err as Error).message || "Could not load the email list."); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (tab === "audience" && !contacts) void loadContacts(); }, [tab]);
  useEffect(() => {
    if (!openModal) return;
    setModal(openModal === "add-subscribers" ? { kind: "add" } : { kind: "segment" });
    onModalOpened();
  }, [openModal]);
  const reloadAll = async () => { await Promise.all([load(), contacts || tab === "audience" ? loadContacts() : Promise.resolve(), designer ? loadDesigner() : Promise.resolve()]); };

  const segments = data?.segments ?? [];
  const filtered = useMemo(() => segments.filter((row) => (!kind || row.kind === kind) && (!status || row.status === status)
    && (!query.trim() || `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase()))), [segments, kind, status, query]);
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pages);
  const shown = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [kind, status, query]);

  const segmentAction = async (segment: EmSegment, action: "pause" | "resume" | "archive" | "delete") => {
    setMenu(null);
    try {
      if (action === "delete") {
        if (!window.confirm(`Delete the group "${segment.name}"? The people stay on the list.`)) return;
        await emailMarketingApi.deleteSegment(segment.id);
        onToast("Group deleted.");
      } else {
        await emailMarketingApi.updateSegment(segment.id, { status: action === "pause" ? "paused" : action === "archive" ? "archived" : "active" });
        onToast(action === "pause" ? "Group paused. Campaigns can't pick it until you turn it back on." : action === "archive" ? "Group archived." : "Group is on again.");
      }
      await load();
    } catch (err) {
      onToast((err as Error).message || "That did not work.");
    }
  };

  const exportCsv = async () => {
    try {
      const list = contacts ?? (await emailMarketingApi.contacts()).contacts;
      if (!list.length) { onToast("The list is empty, so there is nothing to export yet."); return; }
      downloadCsv(`email-list-${new Date().toISOString().slice(0, 10)}.csv`, ["Email", "Name", "Phone", "Source", "Status", "Delivered orders", "Spent (NGN)", "Joined"],
        list.map((row) => [row.email, row.name, row.phone, SOURCE_LABEL[row.source] ?? row.source, row.status, row.orders, row.spent, row.joinedAt.slice(0, 10)]));
    } catch (err) {
      onToast((err as Error).message || "Could not export.");
    }
  };

  const k = data?.kpis;
  const slices = data?.donut.slices ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        {(() => { const HeadIcon = HEADER_ICON[tab] ?? Users; return <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><HeadIcon className="h-7 w-7" /></span>; })()}
        <div className="mr-auto min-w-0">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Audience &amp; Segments</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Manage your email list, uploaded lists and auto-updating groups for targeted emails.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setModal({ kind: "import" })} className={btn.ghost}><Upload className="h-4 w-4 text-[#5B3FD9]" />Import Audience</button>
          <button type="button" onClick={() => void exportCsv()} className={btn.ghost}><Download className="h-4 w-4 text-[#5B3FD9]" />Export</button>
          <button type="button" onClick={() => setModal({ kind: "segment" })} className={btn.primary}><Plus className="h-4 w-4" />Create Segment</button>
        </div>
      </div>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}

      {k && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <KpiTile icon={Users} label="Total Audience" value={count(k.total.value)}><Delta value={k.total.change} /></KpiTile>
          <KpiTile icon={Mail} label="Subscribed" value={<>{count(k.subscribed.value)} <span className="text-[16px] font-bold">({pct(k.subscribed.percent)})</span></>}><Delta value={k.subscribed.change} /></KpiTile>
          <KpiTile icon={Ban} tone="red" label="Unsubscribed" value={<>{count(k.unsubscribed.value)} <span className="text-[16px] font-bold">({pct(k.unsubscribed.percent)})</span></>} />
          <KpiTile icon={Send} label="Engaged (Last 30 Days)" value={<>{count(k.engaged.value)} <span className="text-[16px] font-bold">({pct(k.engaged.percent)})</span></>} />
          <KpiTile icon={Crown} tone="amber" label="VIP Customers" value={<>{count(k.vip.value)} <span className="text-[16px] font-bold">({pct(k.vip.percent)})</span></>} />
        </div>
      )}
      {data && data.kpis.total.value === 0 && (
        <p className="m-0 rounded-xl border border-[#E4DDFB] bg-[#F7F4FF] px-4 py-2.5 text-[13px] text-gray-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-slate-200">
          Nobody is on the email list yet. {count(data.customersWithoutEmail)} customers have bought from you but none gave an email. The order form now asks for one, so the list fills as orders come in. You can also add people or upload a list.
        </p>
      )}

      <nav className="flex flex-wrap gap-1.5" aria-label="Audience sections">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}
            className={`!min-h-0 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold ${tab === key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            <Icon className="h-4 w-4" />{label}{key === "segments" && data ? ` (${segments.length})` : ""}
          </button>
        ))}
      </nav>

      {tab === "segments" && data && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3 dark:border-slate-800">
              <label className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search segments (e.g., repeat buyers, inactive, etc)..." className={`${input} !pl-9`} />
              </label>
              <select value={kind} onChange={(event) => setKind(event.target.value)} className={`${select} !w-[150px]`} aria-label="Type"><option value="">All Types</option><option value="auto">Auto-updates</option><option value="fixed">Fixed list</option></select>
              <select value={status} onChange={(event) => setStatus(event.target.value)} className={`${select} !w-[140px]`} aria-label="Status"><option value="">All Status</option><option value="active">Active</option><option value="paused">Paused</option></select>
              <div className="ml-auto inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
                <button type="button" aria-label="List view" onClick={() => setView("list")} className={`!min-h-0 px-3 py-2 ${view === "list" ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><List className="h-4 w-4" /></button>
                <button type="button" aria-label="Grid view" onClick={() => setView("grid")} className={`!min-h-0 px-3 py-2 ${view === "grid" ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><LayoutGrid className="h-4 w-4" /></button>
              </div>
            </div>
            {view === "list" ? (
              <div className="overflow-x-auto">
                <table className="!min-w-0 w-full min-w-[700px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-[13px] font-bold text-gray-700 dark:border-slate-800 dark:text-slate-300">
                      <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Pick all" checked={shown.length > 0 && shown.every((row) => picked.has(row.id))} onChange={(event) => setPicked(event.target.checked ? new Set(shown.map((row) => row.id)) : new Set())} /></th>
                      <th className="px-2 py-3">Segment Name</th><th className="px-2 py-3">Type</th><th className="whitespace-nowrap px-2 py-3 text-right">Audience Size</th><th className="whitespace-nowrap px-2 py-3 text-right">% of Total</th>
                      <th className="whitespace-nowrap px-2 py-3">Last Updated</th><th className="px-2 py-3">Status</th><th className="px-2 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((segment) => (
                      <tr key={segment.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                        <td className="px-4 py-3"><input type="checkbox" aria-label={`Pick ${segment.name}`} checked={picked.has(segment.id)} onChange={(event) => { const next = new Set(picked); if (event.target.checked) next.add(segment.id); else next.delete(segment.id); setPicked(next); }} /></td>
                        <td className="px-3 py-3">
                          <button type="button" onClick={() => setModal({ kind: "segment", segment })} className="!min-h-0 flex items-center gap-3 text-left">
                            <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F5F2FE] dark:bg-slate-800 ${ICON_TONE[segment.icon] ?? "text-[#5B3FD9]"}`}><SegmentIcon name={segment.icon} /></span>
                            <span className="min-w-0"><span className="block max-w-[230px] truncate font-bold text-gray-900 dark:text-slate-50" title={segment.name}>{segment.name}</span><span className="block max-w-[230px] truncate text-[12px] text-gray-500" title={segment.description}>{segment.description}</span></span>
                          </button>
                        </td>
                        <td className="px-2 py-3">{segment.kind === "auto" ? <Pill tone="purple"><Zap className="h-3.5 w-3.5" />Auto-updates</Pill> : <Pill tone="blue"><Layers className="h-3.5 w-3.5" />Fixed list</Pill>}</td>
                        <td className="px-2 py-3 text-right tabular-nums" title={`${count(segment.customers)} customers match; ${count(segment.size)} have an email you can use`}>
                          <span className="font-semibold">{count(segment.size)}</span>
                          {segment.customers > segment.size && <span className="block whitespace-nowrap text-[11px] text-gray-500">of {count(segment.customers)} customers</span>}
                        </td>
                        <td className="px-2 py-3 text-right tabular-nums">{pct(segment.percent)}</td>
                        <td className="whitespace-nowrap px-2 py-3">{lagosDate(segment.updatedAt)}</td>
                        <td className="px-2 py-3">{segment.status === "active" ? <Pill tone="green">Active</Pill> : segment.status === "archived" ? <Pill tone="slate">Archived</Pill> : <Pill tone="slate">Paused</Pill>}</td>
                        <td className="px-2 py-3 text-center">
                          <button type="button" aria-label="More" onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const up = window.innerHeight - rect.bottom < 240; setMenu({ segment, x: Math.max(8, rect.right - 200), y: up ? window.innerHeight - rect.top + 4 : rect.bottom + 4, up }); }}
                            className="!min-h-0 inline-flex h-9 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300"><MoreHorizontal className="h-5 w-5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid gap-3 p-3 sm:grid-cols-2">
                {shown.map((segment) => (
                  <button key={segment.id} type="button" onClick={() => setModal({ kind: "segment", segment })} className="!min-h-0 rounded-xl border border-gray-200 p-3.5 text-left hover:border-[#C9BEF5] dark:border-slate-700">
                    <div className="flex items-center gap-2.5"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#F5F2FE] dark:bg-slate-800 ${ICON_TONE[segment.icon] ?? "text-[#5B3FD9]"}`}><SegmentIcon name={segment.icon} /></span><span className="font-bold text-gray-900 dark:text-slate-50">{segment.name}</span></div>
                    <p className="m-0 mt-2 text-[12.5px] text-gray-600 dark:text-slate-400">{segment.description}</p>
                    <p className="m-0 mt-2 text-[13px]"><strong>{count(segment.size)}</strong> on the list · {count(segment.customers)} customers</p>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-[13px] text-gray-600 dark:border-slate-800 dark:text-slate-400">
              <span>Showing {filtered.length ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, filtered.length)} of {filtered.length} segments</span>
              <div className="flex items-center gap-1.5">
                <button type="button" aria-label="Previous page" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
                {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" onClick={() => setPage(n)} className={`!min-h-0 h-9 w-9 rounded-lg text-[13px] font-semibold ${n === safePage ? "bg-[#5B3FD9] text-white" : "border border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>{n}</button>
                ))}
                <button type="button" aria-label="Next page" disabled={safePage >= pages} onClick={() => setPage(safePage + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          </Card>

          <div className="min-w-0 space-y-4">
            <Card className="p-5">
              <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Audience Overview</h3>
              <div className="mt-3 flex items-center gap-4">
                <Donut slices={slices.map((slice, i) => ({ value: slice.count, color: SLICE_COLORS[i % SLICE_COLORS.length] }))} size={128} stroke={22}>
                  <span className="text-[20px] font-extrabold text-gray-900 dark:text-slate-50">{count(data.donut.total)}</span>
                  <span className="text-[11.5px] text-gray-600 dark:text-slate-400">Total Audience</span>
                </Donut>
                <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0 text-[12.5px]">
                  {slices.map((slice, i) => (
                    <li key={slice.label} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                      <span className="flex-1 text-gray-700 dark:text-slate-300">{slice.label}</span>
                      <span className="font-bold tabular-nums text-gray-900 dark:text-slate-50">{pct(slice.percent)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
            <Card className="p-5">
              <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><TrendingUp className="h-5 w-5 text-[#5B3FD9]" />Audience Insights</h3>
              <div className="mt-3 space-y-2">
                {[
                  { icon: Users, tone: "bg-[#F5F2FE]", label: "Top Segment", value: data.insights.topSegment ? `${data.insights.topSegment.name} (${count(data.insights.topSegment.size)})` : "Shows once people join the list" },
                  { icon: TrendingUp, tone: "bg-emerald-50", label: "Fastest Growing", value: data.insights.fastestGrowing ? `${data.insights.fastestGrowing.name} (+${pct(data.insights.fastestGrowing.growth)})` : "Needs 30 days of list history" },
                  { icon: MailOpen, tone: "bg-sky-50", label: "Engagement Rate", value: data.insights.engagementRate === null ? "No emails sent yet" : `${pct(data.insights.engagementRate)} opened or clicked in 30 days` },
                  { icon: Sparkles, tone: "bg-[#F5F2FE]", label: "Next Best Opportunity", value: data.insights.nextBest ? `${data.insights.nextBest.name} (${count(data.insights.nextBest.size)} on the list, ${count(data.insights.nextBest.customers)} customers)` : "—" }
                ].map(({ icon: Icon, tone, label, value }) => (
                  <div key={label} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 dark:bg-slate-800 ${tone}`}>
                    <IconTile size="sm"><Icon className="h-4 w-4" /></IconTile>
                    <div className="min-w-0"><div className="text-[13px] font-bold text-gray-900 dark:text-slate-50">{label}</div><div className="text-[12.5px] text-gray-700 dark:text-slate-300">{value}</div></div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "audience" && data && <AllAudienceTab data={data} contacts={contacts} designer={designer} onAdd={() => setModal({ kind: "add" })} onChanged={reloadAll} onToast={onToast} />}
      {tab === "lists" && data && <ListsTab lists={data.lists} onChanged={reloadAll} onToast={onToast} onUse={onUseSegment} onImport={() => setModal({ kind: "import" })} />}
      {tab === "tags" && data && <TagsTab tags={data.tags} onChanged={reloadAll} onToast={onToast} />}
      {tab === "fields" && data && <FieldsTab fields={data.fields} onChanged={reloadAll} onToast={onToast} />}
      {tab === "import" && data && <ImportSyncTab lists={data.lists} fields={data.fields} onImported={reloadAll} onToast={onToast} onOpenCsv={() => setModal({ kind: "import" })} refreshKey={importRefresh} />}
      {tab === "health" && <WaitingForDesign title="Audience Health" note="Your Audience Health designs (7 tabs) are in. They are built next, right after this part ships, and fill in as campaign emails go out." />}

      {menu && createPortal(
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setMenu(null)} />
          <div className="fixed z-[81] w-[200px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" style={menu.up ? { left: menu.x, bottom: menu.y } : { left: menu.x, top: menu.y }}>
            {[
              { label: "Edit", icon: Pencil, run: () => { setMenu(null); setModal({ kind: "segment", segment: menu.segment }); } },
              { label: "Send a campaign", icon: Send, run: () => { setMenu(null); onUseSegment(menu.segment.id); } },
              menu.segment.status === "active" ? { label: "Pause", icon: Pause, run: () => void segmentAction(menu.segment, "pause") } : { label: "Turn on", icon: Play, run: () => void segmentAction(menu.segment, "resume") },
              ...(menu.segment.status !== "archived" ? [{ label: "Archive", icon: Archive, run: () => void segmentAction(menu.segment, "archive") }] : []),
              { label: "Delete", icon: Trash2, run: () => void segmentAction(menu.segment, "delete"), danger: true }
            ].map((item) => (
              <button key={item.label} type="button" onClick={item.run} className={`!min-h-0 flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] hover:bg-gray-50 dark:hover:bg-slate-800 ${"danger" in item && item.danger ? "text-rose-600" : "text-gray-800 dark:text-slate-200"}`}>
                <item.icon className="h-4 w-4" />{item.label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
      {modal?.kind === "add" && <AddContactModal onClose={() => setModal(null)} onDone={async (message) => { setModal(null); onToast(message); await reloadAll(); }} />}
      {modal?.kind === "import" && <ImportModal fields={data?.fields ?? []} onClose={() => setModal(null)} onDone={async (message) => { setModal(null); onToast(message); setImportRefresh((n) => n + 1); await reloadAll(); }} />}
      {modal?.kind === "segment" && (designer
        ? <SegmentEditor segment={modal.segment} designer={designer} onClose={() => setModal(null)} onDone={async (message) => { setModal(null); onToast(message); await reloadAll(); }} />
        : createPortal(<div className="fixed inset-0 z-[88] flex items-center justify-center bg-slate-900/40"><div className="rounded-2xl bg-white px-6 py-4 dark:bg-slate-900"><Loading /></div></div>, document.body))}
    </div>
  );
}

export function ModalShell({ title, sub, onClose, children, footer, wide = false }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/50 p-3 sm:p-6" onClick={onClose}>
      <div className={`flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900 ${wide ? "max-w-3xl" : "max-w-lg"}`} onClick={(event) => event.stopPropagation()}>
        <div className="border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">{title}</h3>
          {sub && <p className="m-0 mt-0.5 text-[13px] text-gray-600 dark:text-slate-400">{sub}</p>}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-6 py-3.5 dark:border-slate-800">{footer}</div>
      </div>
    </div>,
    document.body
  );
}

function AddContactModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (!consent) { setError("Tick that this person agreed to get emails from you."); return; }
    setBusy(true);
    try {
      await emailMarketingApi.addContact({ ...form, consent: true });
      await onDone(`${form.email} is on the list.`);
    } catch (err) {
      setError((err as Error).message || "Could not add that person.");
      setBusy(false);
    }
  };
  return (
    <ModalShell title="Add a subscriber" sub="Someone who asked to get your offers by email." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}><UserPlus className="h-4 w-4" />{busy ? "Adding…" : "Add"}</button></>}>
      <div className="space-y-3">
        <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Email *<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} type="email" className={`${input} mt-1`} placeholder="name@example.com" /></label>
        <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={`${input} mt-1`} /></label>
        <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Phone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={`${input} mt-1`} placeholder="080..." /></label>
        <label className="flex items-start gap-2 text-[13px] text-gray-700 dark:text-slate-300"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />This person agreed to get emails from us.</label>
        {error && <p className="m-0 text-[12.5px] text-rose-600">{error}</p>}
      </div>
    </ModalShell>
  );
}

/** CSV columns are found by name: email (needed), name, phone, and any custom field's name. */
export function parseCsv(text: string, fields: Array<Pick<EmField, "key" | "name" | "systemKey">> = []): Array<{ email: string; name?: string; phone?: string; fields?: Record<string, string> }> {
  const lines: string[][] = [];
  let row: string[] = [], cellText = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cellText += '"'; i += 1; } else if (ch === '"') quoted = false; else cellText += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") { row.push(cellText); cellText = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i += 1; row.push(cellText); lines.push(row); row = []; cellText = ""; }
    else cellText += ch;
  }
  if (cellText || row.length) { row.push(cellText); lines.push(row); }
  const clean = lines.filter((cells) => cells.some((c) => c.trim()));
  if (!clean.length) return [];
  const header = clean[0].map((c) => c.trim().toLowerCase());
  const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  let emailAt = find("email", "e-mail", "mail"), nameAt = find("name"), phoneAt = find("phone", "mobile", "number", "whatsapp");
  let body = clean.slice(1);
  if (emailAt < 0) {
    // No header row: the column that holds the @ signs.
    emailAt = clean[0].findIndex((c) => c.includes("@"));
    nameAt = -1; phoneAt = -1;
    body = clean;
  }
  if (emailAt < 0) return [];
  // Columns named like one of the business's own fields fill that field.
  const custom = fields.filter((field) => !field.systemKey).map((field) => ({ key: field.key, at: header.findIndex((h, i) => i !== emailAt && i !== nameAt && i !== phoneAt && (h === field.name.toLowerCase() || h === field.key)) })).filter((row) => row.at >= 0);
  return body.map((cells) => {
    const answers = Object.fromEntries(custom.map((row) => [row.key, (cells[row.at] ?? "").trim()]).filter(([, value]) => value));
    return { email: (cells[emailAt] ?? "").trim(), name: nameAt >= 0 ? (cells[nameAt] ?? "").trim() : undefined, phone: phoneAt >= 0 ? (cells[phoneAt] ?? "").trim() : undefined, ...(Object.keys(answers).length ? { fields: answers } : {}) };
  }).filter((r) => r.email);
}

export function ImportModal({ onClose, onDone, onListCreated, fields = [] }: { onClose: () => void; onDone: (message: string) => Promise<void>; onListCreated?: (listId: string) => void; fields?: Array<Pick<EmField, "key" | "name" | "systemKey">> }) {
  const [rows, setRows] = useState<Array<{ email: string; name?: string; phone?: string; fields?: Record<string, string> }> | null>(null);
  const [fileName, setFileName] = useState("");
  const [listName, setListName] = useState(`Upload ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`);
  const [makeList, setMakeList] = useState(true);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pick = async (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { setError("Save the spreadsheet as CSV first (File › Save As › CSV), then upload that."); return; }
    const text = await file.text();
    const parsed = parseCsv(text, fields);
    if (!parsed.length) { setError("No email column was found. The file needs a column of email addresses."); return; }
    setRows(parsed);
    setFileName(file.name);
  };
  const upload = async () => {
    if (!rows?.length) { setError("Choose a CSV file first."); return; }
    if (!consent) { setError("Tick that everyone on this list agreed to get emails from you."); return; }
    setBusy(true);
    try {
      const result = await emailMarketingApi.importContacts({ rows, consent: true, source: "csv", details: fileName, ...(makeList && listName.trim() ? { listName: listName.trim() } : {}) });
      if (result.listId) onListCreated?.(result.listId);
      await onDone(`Added ${count(result.added)} people${result.updated ? `, filled in ${count(result.updated)} already on the list` : ""}${result.alreadyOnList - result.updated > 0 ? `, ${count(result.alreadyOnList - result.updated)} were already on the list` : ""}${result.invalid ? `, ${count(result.invalid)} emails were not valid and were skipped` : ""}.`);
    } catch (err) {
      setError((err as Error).message || "Could not upload the list.");
      setBusy(false);
    }
  };
  return (
    <ModalShell title="Import audience" sub="Upload a CSV file with an email column. Name, phone and columns named like your custom fields are kept too." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy || !rows} onClick={() => void upload()} className={btn.primary}><Upload className="h-4 w-4" />{busy ? "Uploading…" : `Upload ${rows ? count(rows.length) : ""}`}</button></>}>
      <div className="space-y-3">
        <button type="button" onClick={() => fileRef.current?.click()} className="!min-h-0 flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-[#C9BEF5] bg-[#FAF8FF] px-4 py-6 text-center dark:bg-violet-500/5">
          <Upload className="h-6 w-6 text-[#5B3FD9]" />
          <span className="text-[14px] font-bold text-[#5B3FD9]">{fileName || "Choose a CSV file"}</span>
          <span className="text-[12px] text-gray-500">{rows ? `${count(rows.length)} rows with an email` : "Excel: save as CSV first"}</span>
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void pick(file); }} />
        <label className="flex items-center gap-2 text-[13px] text-gray-700 dark:text-slate-300"><input type="checkbox" checked={makeList} onChange={(event) => setMakeList(event.target.checked)} />Keep them together as a list you can send to</label>
        {makeList && <input value={listName} onChange={(event) => setListName(event.target.value)} className={input} aria-label="List name" />}
        <label className="flex items-start gap-2 text-[13px] text-gray-700 dark:text-slate-300"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />Everyone on this list agreed to get emails from us.</label>
        {error && <p className="m-0 text-[12.5px] text-rose-600">{error}</p>}
      </div>
    </ModalShell>
  );
}
