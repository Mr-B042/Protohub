import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Archive, Ban, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FileText, LayoutGrid, List, ListChecks, Mail, MoreHorizontal, Pencil, Plus, Search, Send,
  SlidersHorizontal, Tag, Trash2, Undo2, UserMinus, Users, Zap, Download
} from "lucide-react";
import { emailMarketingApi, type EmAudiencePage, type EmContact, type EmDesigner, type EmField, type EmSegment, type EmTag } from "../../lib/api";
import { ModalShell } from "./AudiencePage";
import {
  Avatar, Card, EngagementBars, Pill, SegmentIcon, TAG_LOOK, TagPill, Toggle, btn, count, downloadCsv, input, lagosDate, naira, pct, phoneText, select
} from "./em-ui";

/** All Audience, Lists, Tags and Custom Fields tabs (Bright's designs, 8 Nov 2026). */

type Menu = { x: number; y: number; up: boolean; items: Array<{ label: string; icon: typeof Mail; run: () => void; danger?: boolean }> } | null;

function useMenu() {
  const [menu, setMenu] = useState<Menu>(null);
  const open = (target: HTMLElement, items: NonNullable<Menu>["items"]) => {
    const rect = target.getBoundingClientRect();
    const up = window.innerHeight - rect.bottom < 40 * items.length + 20;
    setMenu({ x: Math.max(8, rect.right - 210), y: up ? window.innerHeight - rect.top + 4 : rect.bottom + 4, up, items });
  };
  const node = menu && createPortal(
    <>
      <div className="fixed inset-0 z-[80]" onClick={() => setMenu(null)} />
      <div className="fixed z-[81] w-[210px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" style={menu.up ? { left: menu.x, bottom: menu.y } : { left: menu.x, top: menu.y }}>
        {menu.items.map((item) => (
          <button key={item.label} type="button" onClick={() => { setMenu(null); item.run(); }}
            className={`!min-h-0 flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13.5px] hover:bg-gray-50 dark:hover:bg-slate-800 ${item.danger ? "text-rose-600" : "text-gray-800 dark:text-slate-200"}`}>
            <item.icon className="h-4 w-4" />{item.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
  return { open, node };
}

const ActionButton = ({ onClick, label = "More" }: { onClick: (target: HTMLElement) => void; label?: string }) => (
  <button type="button" aria-label={label} onClick={(event) => onClick(event.currentTarget)}
    className="!min-h-0 inline-flex h-9 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-[#5B3FD9] shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900"><MoreHorizontal className="h-5 w-5" /></button>
);

function Pager({ page, pages, total, noun, size, onPage }: { page: number; pages: number; total: number; noun: string; size: number; onPage: (page: number) => void }) {
  const nums: Array<number | "…"> = pages <= 6 ? Array.from({ length: pages }, (_, i) => i + 1) : [1, 2, 3, 4, 5, "…", pages];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-3 text-[13.5px] text-gray-600 dark:border-slate-800 dark:text-slate-400">
      <span>Showing {total ? (page - 1) * size + 1 : 0}–{Math.min(page * size, total)} of {count(total)} {noun}</span>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
        {nums.map((n, i) => n === "…"
          ? <span key={`gap-${i}`} className="px-1">…</span>
          : <button key={n} type="button" onClick={() => onPage(n)} className={`!min-h-0 h-9 min-w-9 rounded-lg px-2 text-[13px] font-semibold ${n === page ? "bg-[#5B3FD9] text-white" : "border border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>{count(n)}</button>)}
        <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function TabHead({ icon: Icon, title, sub, right }: { icon: typeof Mail; title: string; sub: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 pt-4">
      <Icon className="h-8 w-8 text-[#5B3FD9]" />
      <div className="min-w-[260px] flex-1"><h3 className="m-0 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">{title}</h3><p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">{sub}</p></div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

function Chips<T extends string>({ value, onChange, items }: { value: T; onChange: (value: T) => void; items: Array<{ key: T; label: string; dot?: string; icon?: typeof Mail; filled?: boolean }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ key, label, dot, icon: Icon }) => (
        <button key={key} type="button" onClick={() => onChange(key)}
          className={`!min-h-0 inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-[13.5px] font-semibold ${value === key ? "border-[#5B3FD9] bg-[#5B3FD9] text-white shadow-sm" : "border-gray-200 bg-white text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
          {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}{Icon && <Icon className="h-4 w-4" />}{label}
        </button>
      ))}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: "list" | "grid"; onChange: (view: "list" | "grid") => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
      <button type="button" aria-label="List view" onClick={() => onChange("list")} className={`!min-h-0 px-3 py-2 ${view === "list" ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><List className="h-4 w-4" /></button>
      <button type="button" aria-label="Grid view" onClick={() => onChange("grid")} className={`!min-h-0 px-3 py-2 ${view === "grid" ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-600 dark:bg-slate-900"}`}><LayoutGrid className="h-4 w-4" /></button>
    </div>
  );
}

// ── All Audience ──────────────────────────────────────────────────────

const COLUMNS = ["Email / Phone", "Status", "Segments", "Lists", "Engagement", "Joined On", "Last Activity"] as const;

export function AllAudienceTab({ data, contacts, designer, onAdd, onChanged, onToast }: {
  data: EmAudiencePage;
  contacts: EmContact[] | null;
  designer: EmDesigner | null;
  onAdd: () => void;
  onChanged: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const [chip, setChip] = useState<"all" | "subscribed" | "unsubscribed" | "bounced">("all");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [segment, setSegment] = useState("");
  const [list, setList] = useState("");
  const [engagement, setEngagement] = useState("");
  const [joined, setJoined] = useState("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(1);
  const [sortDesc, setSortDesc] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<EmContact | null>(null);
  const [bulkTag, setBulkTag] = useState(false);
  const menu = useMenu();
  const groupName = useMemo(() => new Map([...data.segments, ...data.lists].map((row) => [row.id, row])), [data]);
  const tagById = useMemo(() => new Map(data.tags.map((row) => [row.id, row])), [data]);
  const vip = data.tags.find((row) => row.builtIn === "vip");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const days = joined === "all" ? 0 : Number(joined);
    const effective = chip === "all" ? status : chip;
    return (contacts ?? []).filter((row) => (!effective || row.status === effective)
      && (!segment || row.segments.includes(segment)) && (!list || row.lists.includes(list)) && (!engagement || row.engagement === engagement)
      && (!days || Date.now() - Date.parse(row.joinedAt) <= days * 86_400_000)
      && (!q || `${row.name} ${row.email} ${row.phone ?? ""} ${phoneText(row.phone)} ${row.tags.map((id) => tagById.get(id)?.name ?? "").join(" ")}`.toLowerCase().includes(q)))
      .sort((a, b) => (sortDesc ? b.joinedAt.localeCompare(a.joinedAt) : a.joinedAt.localeCompare(b.joinedAt)));
  }, [contacts, chip, status, segment, list, engagement, joined, query, sortDesc, tagById]);
  const size = 8;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safe = Math.min(page, pages);
  const shown = rows.slice((safe - 1) * size, safe * size);
  useEffect(() => { setPage(1); }, [chip, status, segment, list, engagement, joined, query]);
  const show = (column: string) => !hidden.has(column);

  const act = async (row: EmContact, action: "unsubscribe" | "remove") => {
    if (!window.confirm(action === "unsubscribe" ? `Unsubscribe ${row.email}? They will not get campaign emails again.` : `Remove ${row.email} from the list?`)) return;
    try {
      if (action === "unsubscribe") await emailMarketingApi.unsubscribe(row.id); else await emailMarketingApi.removeContact(row.id);
      onToast(action === "unsubscribe" ? "Unsubscribed." : "Removed from the list.");
      await onChanged();
    } catch (err) { onToast((err as Error).message || "That did not work."); }
  };
  const exportPicked = () => {
    const list2 = (contacts ?? []).filter((row) => picked.has(row.id));
    downloadCsv(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, ["Email", "Name", "Phone", "Status", "Delivered orders", "Spent (NGN)", "Joined"],
      list2.map((row) => [row.email, row.name, row.phone, row.status, row.orders, row.spent, row.joinedAt.slice(0, 10)]));
  };

  return (
    <Card className="overflow-hidden">
      <TabHead icon={Users} title="All Audience" sub="A complete view of all your contacts (subscribers, unsubs, and inactive)."
        right={<Chips value={chip} onChange={setChip} items={[
          { key: "all", label: `All Contacts (${count(data.counts.all)})`, icon: Users },
          { key: "subscribed", label: `Subscribed (${count(data.counts.subscribed)})`, icon: CheckCircle2 },
          { key: "unsubscribed", label: `Unsubscribed (${count(data.counts.unsubscribed)})`, icon: Ban },
          { key: "bounced", label: `Bounced (${count(data.counts.bounced)})`, icon: Ban }
        ]} />} />
      <div className="flex flex-wrap items-center gap-2 p-4">
        <label className="relative min-w-[220px] flex-[2]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search contacts (name, email, phone, tag...)" className={`${input} !pl-9`} />
        </label>
        <select value={status} onChange={(event) => setStatus(event.target.value)} disabled={chip !== "all"} className={`${select} !w-[130px]`} aria-label="Status"><option value="">All Status</option><option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed</option><option value="bounced">Bounced</option></select>
        <select value={segment} onChange={(event) => setSegment(event.target.value)} className={`${select} !w-[150px]`} aria-label="Segment"><option value="">All Segments</option>{data.segments.filter((row) => row.status !== "archived").map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select value={list} onChange={(event) => setList(event.target.value)} className={`${select} !w-[130px]`} aria-label="List"><option value="">All Lists</option>{data.lists.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
        <select value={engagement} onChange={(event) => setEngagement(event.target.value)} className={`${select} !w-[140px]`} aria-label="Engagement"><option value="">Engagement</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option><option value="none">Not emailed yet</option></select>
        <label className="relative">
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B3FD9]" />
          <select value={joined} onChange={(event) => setJoined(event.target.value)} className={`${select} !w-[150px] !pl-9`} aria-label="Joined"><option value="all">All Time</option><option value="7">Last 7 Days</option><option value="30">Last 30 Days</option><option value="90">Last 90 Days</option></select>
        </label>
        <ViewToggle view={view} onChange={setView} />
        <div className="relative">
          <button type="button" aria-label="Choose columns" onClick={() => setColumnsOpen(!columnsOpen)} className={`${btn.icon} !h-10 !w-10`}><SlidersHorizontal className="h-4 w-4 text-[#5B3FD9]" /></button>
          {columnsOpen && (
            <div className="absolute right-0 z-20 mt-1 w-[190px] rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {COLUMNS.map((column) => (
                <label key={column} className="flex items-center gap-2 px-2 py-1.5 text-[13px] text-gray-800 dark:text-slate-200"><input type="checkbox" checked={show(column)} onChange={() => { const next = new Set(hidden); if (next.has(column)) next.delete(column); else next.add(column); setHidden(next); }} />{column}</label>
              ))}
            </div>
          )}
        </div>
      </div>
      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-y border-gray-100 bg-[#F7F4FF] px-4 py-2 text-[13px] dark:border-slate-800 dark:bg-slate-800/50">
          <strong>{picked.size} selected</strong>
          <button type="button" onClick={() => setBulkTag(true)} className={btn.outline}><Tag className="h-3.5 w-3.5" />Tag</button>
          <button type="button" onClick={exportPicked} className={btn.outline}><Download className="h-3.5 w-3.5" />Export</button>
          <button type="button" onClick={() => setPicked(new Set())} className="!min-h-0 text-gray-600 hover:underline">Clear</button>
        </div>
      )}
      {!contacts ? <p className="m-0 p-4 text-[13px] text-gray-500">Loading…</p> : !rows.length ? (
        <div className="flex flex-col items-center gap-2 border-t border-gray-100 px-5 py-12 text-center dark:border-slate-800">
          <Mail className="h-9 w-9 text-[#B9A8F5]" />
          <p className="m-0 text-[14px] font-semibold text-gray-800 dark:text-slate-200">{contacts.length ? "Nobody matches these filters." : "Nobody is on the email list yet."}</p>
          <button type="button" onClick={onAdd} className={btn.primary}><Plus className="h-4 w-4" />Add Subscriber</button>
        </div>
      ) : view === "list" ? (
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full min-w-[1060px] text-left text-[13.5px]">
            <thead>
              <tr className="border-y border-gray-100 text-[13px] font-bold text-gray-700 dark:border-slate-800 dark:text-slate-300">
                <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Pick all" checked={shown.length > 0 && shown.every((row) => picked.has(row.id))} onChange={(event) => setPicked(event.target.checked ? new Set([...picked, ...shown.map((row) => row.id)]) : new Set([...picked].filter((id) => !shown.some((row) => row.id === id))))} /></th>
                <th className="px-3 py-3">Contact</th>
                {show("Email / Phone") && <th className="px-3 py-3">Email / Phone</th>}
                {show("Status") && <th className="px-3 py-3">Status</th>}
                {show("Segments") && <th className="px-3 py-3">Segments</th>}
                {show("Lists") && <th className="px-3 py-3">Lists</th>}
                {show("Engagement") && <th className="px-3 py-3">Engagement</th>}
                {show("Joined On") && <th className="px-3 py-3"><button type="button" onClick={() => setSortDesc(!sortDesc)} className="!min-h-0 inline-flex items-center gap-1 font-bold">Joined On<ChevronRight className={`h-3.5 w-3.5 ${sortDesc ? "rotate-90" : "-rotate-90"}`} /></button></th>}
                {show("Last Activity") && <th className="px-3 py-3">Last Activity</th>}
                <th className="px-3 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const groups = row.segments.map((id) => groupName.get(id)).filter(Boolean) as EmSegment[];
                const isVip = !!vip && row.tags.includes(vip.id);
                return (
                  <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                    <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Pick ${row.email}`} checked={picked.has(row.id)} onChange={(event) => { const next = new Set(picked); if (event.target.checked) next.add(row.id); else next.delete(row.id); setPicked(next); }} /></td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setEditing(row)} className="!min-h-0 flex items-center gap-2.5 text-left">
                        <Avatar name={row.name || row.email} />
                        <span className="min-w-0"><span className="block max-w-[170px] truncate font-bold text-gray-900 dark:text-slate-50">{row.name || row.email.split("@")[0]}</span><span className="block whitespace-nowrap text-[12px] text-gray-500">{phoneText(row.phone) || "No phone"}</span></span>
                      </button>
                    </td>
                    {show("Email / Phone") && <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-[#5B3FD9]" /><span className="max-w-[180px] truncate">{row.email}</span></span></td>}
                    {show("Status") && <td className="px-3 py-2.5">{row.status === "subscribed" ? <Pill tone="green">Subscribed</Pill> : row.status === "bounced" ? <Pill tone="amber">Bounced</Pill> : <Pill tone="red">Unsubscribed</Pill>}</td>}
                    {show("Segments") && <td className="px-3 py-2.5"><span className="flex flex-wrap gap-1">
                      {groups.slice(0, 1).map((group) => <Pill key={group.id} tone="purple"><Zap className="h-3 w-3" />{group.name}</Pill>)}
                      {isVip && <Pill tone="amber"><SegmentIcon name="crown" className="h-3 w-3" />VIP</Pill>}
                      {groups.length > 1 && <span className="text-[11.5px] text-gray-500">+{groups.length - 1}</span>}
                      {!groups.length && !isVip && <span className="text-gray-400">—</span>}
                    </span></td>}
                    {show("Lists") && <td className="max-w-[140px] truncate px-3 py-2.5">{row.lists.map((id) => groupName.get(id)?.name).filter(Boolean).join(", ") || "—"}</td>}
                    {show("Engagement") && <td className="px-3 py-2.5"><EngagementBars level={row.engagement} /></td>}
                    {show("Joined On") && <td className="whitespace-nowrap px-3 py-2.5">{lagosDate(row.joinedAt)}</td>}
                    {show("Last Activity") && <td className="whitespace-nowrap px-3 py-2.5">{lagosDate(row.lastActivityAt)}</td>}
                    <td className="px-3 py-2.5 text-center">
                      <ActionButton onClick={(target) => menu.open(target, [
                        { label: "View & edit", icon: Pencil, run: () => setEditing(row) },
                        ...(row.status === "subscribed" ? [{ label: "Unsubscribe", icon: UserMinus, run: () => void act(row, "unsubscribe") }] : []),
                        ...(row.source === "manual" || row.source === "import" ? [{ label: "Remove", icon: Trash2, run: () => void act(row, "remove"), danger: true }] : [])
                      ])} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 border-t border-gray-100 p-3 dark:border-slate-800 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((row) => (
            <button key={row.id} type="button" onClick={() => setEditing(row)} className="!min-h-0 rounded-xl border border-gray-200 p-3.5 text-left hover:border-[#C9BEF5] dark:border-slate-700">
              <span className="flex items-center gap-2.5"><Avatar name={row.name || row.email} /><span className="min-w-0"><span className="block truncate font-bold text-gray-900 dark:text-slate-50">{row.name || row.email}</span><span className="block truncate text-[12px] text-gray-500">{row.email}</span></span></span>
              <span className="mt-2 flex items-center justify-between text-[12.5px]"><EngagementBars level={row.engagement} />{row.status === "subscribed" ? <Pill tone="green">Subscribed</Pill> : <Pill tone="red">Unsubscribed</Pill>}</span>
              <span className="mt-1 block text-[12px] text-gray-500">{count(row.orders)} orders · {naira(row.spent)}</span>
            </button>
          ))}
        </div>
      )}
      {rows.length > size && <Pager page={safe} pages={pages} total={rows.length} noun="contacts" size={size} onPage={setPage} />}
      {menu.node}
      {editing && designer && <ContactEditor contact={editing} data={data} designer={designer} onClose={() => setEditing(null)} onSaved={async (message) => { setEditing(null); onToast(message); await onChanged(); }} />}
      {bulkTag && <BulkTagModal tags={data.tags.filter((row) => row.kind === "custom" && row.status === "active")} contactIds={[...picked]} onClose={() => setBulkTag(false)}
        onDone={async (message) => { setBulkTag(false); setPicked(new Set()); onToast(message); await onChanged(); }} />}
    </Card>
  );
}

function ContactEditor({ contact, data, designer, onClose, onSaved }: { contact: EmContact; data: EmAudiencePage; designer: EmDesigner; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [name, setName] = useState(contact.name);
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [tags, setTags] = useState<Set<string>>(new Set(contact.tags));
  const [fields, setFields] = useState<Record<string, unknown>>(Object.fromEntries(contact.fields.map((row) => [row.key, row.value])));
  const systemValue = (key: string) => contact.system.find((row) => row.key === key)?.value ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const custom = data.fields.filter((row) => !row.systemKey && row.status === "active");
  const system = data.fields.filter((row) => row.systemKey && row.status === "active");
  const save = async () => {
    setBusy(true);
    try {
      await emailMarketingApi.updateContact(contact.id, { name, phone, fields, tags: [...tags].filter((id) => data.tags.find((row) => row.id === id)?.kind === "custom") });
      await onSaved("Saved.");
    } catch (err) {
      setError((err as Error).message || "Could not save.");
      setBusy(false);
    }
  };
  return (
    <ModalShell wide title={contact.name || contact.email} sub={`${contact.email} · joined ${lagosDate(contact.joinedAt)}`} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}>{busy ? "Saving…" : "Save"}</button></>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3">
          <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Name<input value={name} onChange={(event) => setName(event.target.value)} className={`${input} mt-1`} /></label>
          <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} className={`${input} mt-1`} /></label>
          <div>
            <p className="m-0 mb-1.5 text-[13px] font-bold text-gray-900 dark:text-slate-50">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {data.tags.filter((row) => row.status === "active").map((tag) => {
                const on = tags.has(tag.id);
                if (tag.kind === "system") return on ? <span key={tag.id} title="Ready-made tag: follows its rule"><TagPill name={tag.name} color={tag.color} icon={tag.icon} size="sm" /></span> : null;
                return (
                  <button key={tag.id} type="button" onClick={() => { const next = new Set(tags); if (on) next.delete(tag.id); else next.add(tag.id); setTags(next); }}
                    className={`!min-h-0 rounded-lg border ${on ? "border-transparent" : "border-dashed border-gray-300 opacity-60 dark:border-slate-600"}`}>
                    <TagPill name={tag.name} color={tag.color} icon={tag.icon} size="sm" />
                  </button>
                );
              })}
            </div>
            <p className="m-0 mt-1 text-[11.5px] text-gray-500">Tap a custom tag to put it on or take it off. Ready-made tags follow their rule.</p>
          </div>
          {custom.length > 0 && <p className="m-0 pt-1 text-[13px] font-bold text-gray-900 dark:text-slate-50">Custom fields</p>}
          {custom.map((field) => <FieldInput key={field.id} field={field} value={fields[field.key]} onChange={(value) => setFields({ ...fields, [field.key]: value })} />)}
          {error && <p className="m-0 text-[12.5px] text-rose-600">{error}</p>}
        </div>
        <div className="space-y-2 rounded-xl bg-gray-50 p-3 text-[13px] dark:bg-slate-800">
          <p className="m-0 font-bold text-gray-900 dark:text-slate-50">From their orders</p>
          {system.map((field) => <div key={field.id} className="flex justify-between gap-3"><span className="text-gray-600 dark:text-slate-400">{field.name}</span><span className="text-right font-semibold text-gray-900 dark:text-slate-50">{field.systemKey === "aov" && systemValue(field.key) ? naira(Number(systemValue(field.key))) : systemValue(field.key) || "—"}</span></div>)}
          <div className="flex justify-between gap-3"><span className="text-gray-600 dark:text-slate-400">Spent</span><span className="font-semibold">{naira(contact.spent)}</span></div>
          <div className="flex justify-between gap-3"><span className="text-gray-600 dark:text-slate-400">Engagement</span><EngagementBars level={contact.engagement} /></div>
          <div className="flex justify-between gap-3"><span className="text-gray-600 dark:text-slate-400">Segments</span><span className="text-right font-semibold">{contact.segments.map((id) => data.segments.find((row) => row.id === id)?.name).filter(Boolean).join(", ") || "—"}</span></div>
          <p className="m-0 pt-1 text-[11.5px] text-gray-500">Order details come from delivered orders with the same phone number. {designer.sender.ready ? "" : designer.sender.reason}</p>
        </div>
      </div>
    </ModalShell>
  );
}

function FieldInput({ field, value, onChange }: { field: EmField; value: unknown; onChange: (value: unknown) => void }) {
  const label = <span className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">{field.name}{field.required ? <span className="text-rose-500"> *</span> : null}</span>;
  if (field.type === "dropdown") return <label className="block">{label}<select value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={`${select} mt-1`}><option value="">—</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
  if (field.type === "multi") {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return <div>{label}<div className="mt-1 flex flex-wrap gap-1.5">{field.options.map((option) => <button key={option} type="button" onClick={() => onChange(list.includes(option) ? list.filter((item) => item !== option) : [...list, option])} className={`!min-h-0 rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold ${list.includes(option) ? "border-[#5B3FD9] bg-[#EEEBFC] text-[#5B3FD9]" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{option}</button>)}</div></div>;
  }
  return <label className="block">{label}<input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} className={`${input} mt-1`} /></label>;
}

function BulkTagModal({ tags, contactIds, onClose, onDone }: { tags: EmTag[]; contactIds: string[]; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [tagId, setTagId] = useState(tags[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (add: boolean) => {
    if (!tagId) { setError("Create a custom tag first (Tags tab)."); return; }
    setBusy(true);
    try {
      await emailMarketingApi.tagContacts(tagId, contactIds, add);
      const tag = tags.find((row) => row.id === tagId)?.name ?? "the tag";
      await onDone(add ? `Tagged ${contactIds.length} with ${tag}.` : `Took ${tag} off ${contactIds.length}.`);
    } catch (err) { setError((err as Error).message || "Could not change the tag."); setBusy(false); }
  };
  return (
    <ModalShell title={`Tag ${contactIds.length} ${contactIds.length === 1 ? "person" : "people"}`} sub="Only custom tags can be put on by hand." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={() => void run(false)} className={btn.ghost}>Take off</button><button type="button" disabled={busy} onClick={() => void run(true)} className={btn.primary}><Tag className="h-4 w-4" />Put on</button></>}>
      {tags.length ? (
        <div className="flex flex-wrap gap-2">{tags.map((tag) => <button key={tag.id} type="button" onClick={() => setTagId(tag.id)} className={`!min-h-0 rounded-lg border-2 ${tagId === tag.id ? "border-[#5B3FD9]" : "border-transparent"}`}><TagPill name={tag.name} color={tag.color} icon={tag.icon} /></button>)}</div>
      ) : <p className="m-0 text-[13px] text-gray-600">No custom tags yet. Create one on the Tags tab.</p>}
      {error && <p className="m-0 mt-2 text-[12.5px] text-rose-600">{error}</p>}
    </ModalShell>
  );
}

// ── Lists ─────────────────────────────────────────────────────────────

const LIST_ICON_TONE: Record<string, string> = { users: "text-[#5B3FD9]", mail: "text-[#5B3FD9]", crown: "text-amber-500", upload: "text-sky-600", layers: "text-[#5B3FD9]" };

export function ListsTab({ lists, onChanged, onToast, onUse, onImport }: { lists: EmSegment[]; onChanged: () => Promise<void>; onToast: (message: string) => void; onUse: (id: string) => void; onImport: () => void }) {
  const [chip, setChip] = useState<"all" | "active" | "archived">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "name" | "contacts">("updated");
  const [view, setView] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(1);
  const [renaming, setRenaming] = useState<EmSegment | null>(null);
  const menu = useMenu();
  const rows = lists.filter((row) => (chip === "all" || (chip === "archived" ? row.status === "archived" : row.status !== "archived"))
    && (!query.trim() || `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "contacts" ? b.contacts - a.contacts : b.updatedAt.localeCompare(a.updatedAt)));
  const size = 8;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safe = Math.min(page, pages);
  const act = async (row: EmSegment, action: "archive" | "unarchive" | "delete") => {
    try {
      if (action === "delete") {
        if (!window.confirm(`Delete the list "${row.name}"? The people stay on the email list.`)) return;
        await emailMarketingApi.deleteSegment(row.id); onToast("List deleted.");
      } else {
        await emailMarketingApi.updateSegment(row.id, { status: action === "archive" ? "archived" : "active" });
        onToast(action === "archive" ? "List archived." : "List is active again.");
      }
      await onChanged();
    } catch (err) { onToast((err as Error).message || "That did not work."); }
  };
  const tone = (row: EmSegment) => (row.contacts ? "" : "text-gray-500");
  return (
    <Card className="overflow-hidden">
      <TabHead icon={ListChecks} title="Lists" sub="Create and manage contact lists (e.g., customers, newsletter, VIP, promo)."
        right={<div className="flex items-center gap-2"><label className="relative w-[320px] max-w-full"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lists (e.g., Customers, Newsletter...)" className={`${input} !pl-9`} /></label><ViewToggle view={view} onChange={setView} /></div>} />
      <div className="flex flex-wrap items-center gap-2 p-4">
        <Chips value={chip} onChange={(value) => { setChip(value); setPage(1); }} items={[
          { key: "all", label: `All Lists (${lists.length})`, icon: ListChecks },
          { key: "active", label: `Active (${lists.filter((row) => row.status !== "archived").length})`, dot: "bg-emerald-500" },
          { key: "archived", label: `Archived (${lists.filter((row) => row.status === "archived").length})`, dot: "bg-gray-400" }
        ]} />
        <button type="button" onClick={onImport} className={`${btn.ghost} ml-auto`}><Plus className="h-4 w-4 text-[#5B3FD9]" />Upload a list</button>
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className={`${select} !w-[190px]`} aria-label="Sort"><option value="updated">Sort: Last Updated</option><option value="name">Sort: Name</option><option value="contacts">Sort: Contacts</option></select>
      </div>
      {view === "list" ? (
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full min-w-[1000px] text-left text-[13.5px]">
            <thead><tr className="border-y border-gray-100 text-[13px] font-bold text-gray-700 dark:border-slate-800 dark:text-slate-300">
              <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Pick all" disabled /></th><th className="px-3 py-3">List Name</th><th className="px-3 py-3">Description</th><th className="px-3 py-3 text-right">Contacts</th>
              <th className="px-3 py-3 text-right">Subscribed</th><th className="px-3 py-3 text-right">Unsubscribed</th><th className="px-3 py-3">Engagement</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Last Updated</th><th className="px-3 py-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {rows.slice((safe - 1) * size, safe * size).map((row) => (
                <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                  <td className="px-4 py-3"><input type="checkbox" aria-label={`Pick ${row.name}`} /></td>
                  <td className="px-3 py-3"><span className="flex items-center gap-3"><span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#F5F2FE] dark:bg-slate-800 ${LIST_ICON_TONE[row.icon] ?? "text-[#5B3FD9]"}`}><SegmentIcon name={row.icon} /></span><span className="font-bold text-gray-900 dark:text-slate-50">{row.name}</span></span></td>
                  <td className="max-w-[230px] px-3 py-3 text-[13px]">{row.description || (row.kind === "fixed" ? "A fixed list of people" : "—")}</td>
                  <td className={`px-3 py-3 text-right font-semibold tabular-nums ${tone(row)}`}>{count(row.contacts)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{count(row.subscribed)} <span className="text-gray-500">({pct(row.contacts ? (row.subscribed / row.contacts) * 100 : null)})</span></td>
                  <td className="px-3 py-3 text-right tabular-nums">{count(row.unsubscribed)} <span className="text-gray-500">({pct(row.contacts ? (row.unsubscribed / row.contacts) * 100 : null)})</span></td>
                  <td className="px-3 py-3"><EngagementBars level={row.engagement} /></td>
                  <td className="px-3 py-3">{row.status === "archived" ? <Pill tone="slate">Archived</Pill> : <Pill tone="green">Active</Pill>}</td>
                  <td className="px-3 py-3">{lagosDate(row.updatedAt)}</td>
                  <td className="px-3 py-3 text-center"><ActionButton onClick={(target) => menu.open(target, [
                    { label: "Send a campaign", icon: Send, run: () => onUse(row.id) },
                    ...(row.builtIn ? [] : [{ label: "Rename", icon: Pencil, run: () => setRenaming(row) }]),
                    row.status === "archived" ? { label: "Unarchive", icon: Undo2, run: () => void act(row, "unarchive") } : { label: "Archive", icon: Archive, run: () => void act(row, "archive") },
                    ...(row.builtIn ? [] : [{ label: "Delete", icon: Trash2, run: () => void act(row, "delete"), danger: true }])
                  ])} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">No lists here.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 border-t border-gray-100 p-3 dark:border-slate-800 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-gray-200 p-3.5 dark:border-slate-700">
              <div className="flex items-center gap-2.5"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#F5F2FE] text-[#5B3FD9] dark:bg-slate-800"><SegmentIcon name={row.icon} /></span><span className="font-bold text-gray-900 dark:text-slate-50">{row.name}</span></div>
              <p className="m-0 mt-2 text-[12.5px] text-gray-600 dark:text-slate-400">{row.description}</p>
              <p className="m-0 mt-2 text-[13px]"><strong>{count(row.contacts)}</strong> people · {count(row.subscribed)} subscribed</p>
            </div>
          ))}
        </div>
      )}
      <Pager page={safe} pages={pages} total={rows.length} noun="lists" size={size} onPage={setPage} />
      {menu.node}
      {renaming && <RenameModal title="Rename list" name={renaming.name} description={renaming.description} onClose={() => setRenaming(null)}
        onSave={async (name, description) => { await emailMarketingApi.updateSegment(renaming.id, { name, description }); setRenaming(null); onToast("List saved."); await onChanged(); }} />}
    </Card>
  );
}

function RenameModal({ title, name: start, description: startDescription, onClose, onSave }: { title: string; name: string; description: string; onClose: () => void; onSave: (name: string, description: string) => Promise<void> }) {
  const [name, setName] = useState(start);
  const [description, setDescription] = useState(startDescription);
  const [error, setError] = useState("");
  return (
    <ModalShell title={title} onClose={onClose} footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" onClick={() => void onSave(name.trim(), description.trim()).catch((err) => setError((err as Error).message))} disabled={!name.trim()} className={btn.primary}>Save</button></>}>
      <div className="space-y-3">
        <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Name<input value={name} onChange={(event) => setName(event.target.value.slice(0, 120))} className={`${input} mt-1`} /></label>
        <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Description<input value={description} onChange={(event) => setDescription(event.target.value.slice(0, 200))} className={`${input} mt-1`} /></label>
        {error && <p className="m-0 text-[12.5px] text-rose-600">{error}</p>}
      </div>
    </ModalShell>
  );
}

// ── Tags ──────────────────────────────────────────────────────────────

const TAG_COLORS = Object.keys(TAG_LOOK);
const TAG_ICONS = ["tag", "crown", "star", "trend", "cart", "pin", "ban", "calendar", "sparkles", "gift", "heart"];

export function TagsTab({ tags, onChanged, onToast }: { tags: EmTag[]; onChanged: () => Promise<void>; onToast: (message: string) => void }) {
  const [chip, setChip] = useState<"all" | "system" | "custom">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(1);
  const [desc, setDesc] = useState(true);
  const [editing, setEditing] = useState<EmTag | "new" | null>(null);
  const menu = useMenu();
  const rows = tags.filter((row) => (chip === "all" || row.kind === chip) && (!query.trim() || `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase())))
    .sort((a, b) => (desc ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  const size = 8;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safe = Math.min(page, pages);
  const act = async (tag: EmTag, action: "archive" | "unarchive" | "delete") => {
    try {
      if (action === "delete") {
        if (!window.confirm(`Delete the tag "${tag.name}"? It comes off everyone who has it.`)) return;
        await emailMarketingApi.deleteTag(tag.id); onToast("Tag deleted.");
      } else { await emailMarketingApi.updateTag(tag.id, { status: action === "archive" ? "archived" : "active" }); onToast(action === "archive" ? "Tag archived." : "Tag is active again."); }
      await onChanged();
    } catch (err) { onToast((err as Error).message || "That did not work."); }
  };
  return (
    <Card className="overflow-hidden">
      <TabHead icon={Tag} title="Tags" sub="Create, manage, and organize tags to group and track your audience (e.g., VIP, Review, Upsell, Location)."
        right={<div className="flex items-center gap-2"><label className="relative w-[320px] max-w-full"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tags (e.g., VIP, Review, Lagos...)" className={`${input} !pl-9`} /></label><ViewToggle view={view} onChange={setView} /></div>} />
      <div className="flex flex-wrap items-center gap-2 p-4">
        <Chips value={chip} onChange={(value) => { setChip(value); setPage(1); }} items={[
          { key: "all", label: `All Tags (${tags.length})`, icon: Tag },
          { key: "system", label: "System Tags", icon: ListChecks },
          { key: "custom", label: "Custom Tags", icon: Tag }
        ]} />
        <button type="button" onClick={() => setEditing("new")} className={`${btn.primary} ml-auto`}><Plus className="h-4 w-4" />Create Tag</button>
      </div>
      {view === "list" ? (
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full min-w-[960px] text-left text-[13.5px]">
            <thead><tr className="border-y border-gray-100 text-[13px] font-bold text-gray-700 dark:border-slate-800 dark:text-slate-300">
              <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Pick all" disabled /></th><th className="px-3 py-3">Tag Name</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Description</th>
              <th className="px-3 py-3 text-right">Contacts</th><th className="px-3 py-3 text-right">% of Audience</th>
              <th className="px-3 py-3"><button type="button" onClick={() => setDesc(!desc)} className="!min-h-0 inline-flex items-center gap-1 font-bold">Created On<ChevronRight className={`h-3.5 w-3.5 ${desc ? "rotate-90" : "-rotate-90"}`} /></button></th>
              <th className="px-3 py-3">Status</th><th className="px-3 py-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {rows.slice((safe - 1) * size, safe * size).map((tag) => (
                <tr key={tag.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                  <td className="px-4 py-3"><input type="checkbox" aria-label={`Pick ${tag.name}`} /></td>
                  <td className="px-3 py-3"><TagPill name={tag.name} color={tag.color} icon={tag.icon} /></td>
                  <td className="px-3 py-3">{tag.kind === "system" ? <Pill tone="slate">System</Pill> : <Pill tone="purple">Custom</Pill>}</td>
                  <td className="max-w-[320px] px-3 py-3 text-[13px]">{tag.description || "—"}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">{count(tag.contacts)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{pct(tag.percent)}</td>
                  <td className="px-3 py-3">{lagosDate(tag.createdAt)}</td>
                  <td className="px-3 py-3">{tag.status === "active" ? <Pill tone="green">Active</Pill> : <Pill tone="slate">Archived</Pill>}</td>
                  <td className="px-3 py-3 text-center"><ActionButton onClick={(target) => menu.open(target, [
                    { label: "Edit", icon: Pencil, run: () => setEditing(tag) },
                    tag.status === "active" ? { label: "Archive", icon: Archive, run: () => void act(tag, "archive") } : { label: "Unarchive", icon: Undo2, run: () => void act(tag, "unarchive") },
                    ...(tag.kind === "custom" ? [{ label: "Delete", icon: Trash2, run: () => void act(tag, "delete"), danger: true }] : [])
                  ])} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-500">No tags here yet.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 border-t border-gray-100 p-3 dark:border-slate-800 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((tag) => (
            <button key={tag.id} type="button" onClick={() => setEditing(tag)} className="!min-h-0 rounded-xl border border-gray-200 p-3.5 text-left hover:border-[#C9BEF5] dark:border-slate-700">
              <TagPill name={tag.name} color={tag.color} icon={tag.icon} />
              <p className="m-0 mt-2 text-[12.5px] text-gray-600 dark:text-slate-400">{tag.description}</p>
              <p className="m-0 mt-2 text-[13px]"><strong>{count(tag.contacts)}</strong> contacts · {tag.kind === "system" ? "System" : "Custom"}</p>
            </button>
          ))}
        </div>
      )}
      <Pager page={safe} pages={pages} total={rows.length} noun="tags" size={size} onPage={setPage} />
      {menu.node}
      {editing && <TagModal tag={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={async (message) => { setEditing(null); onToast(message); await onChanged(); }} />}
    </Card>
  );
}

function TagModal({ tag, onClose, onDone }: { tag: EmTag | null; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [description, setDescription] = useState(tag?.description ?? "");
  const [color, setColor] = useState(tag?.color ?? "purple");
  const [icon, setIcon] = useState(tag?.icon ?? "tag");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const system = tag?.kind === "system";
  const save = async () => {
    if (!name.trim()) { setError("Give the tag a name."); return; }
    setBusy(true);
    try {
      if (tag) await emailMarketingApi.updateTag(tag.id, { ...(system ? {} : { name }), description, color, icon });
      else await emailMarketingApi.createTag({ name, description, color, icon });
      await onDone(tag ? "Tag saved." : "Tag created. Put it on people from All Audience.");
    } catch (err) { setError((err as Error).message || "Could not save the tag."); setBusy(false); }
  };
  return (
    <ModalShell title={tag ? `Edit tag` : "Create Tag"} sub={system ? "A ready-made tag: it follows its rule, so its name stays." : "A label you put on people by hand, from All Audience."} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}>{busy ? "Saving…" : tag ? "Save" : "Create Tag"}</button></>}>
      <div className="space-y-3">
        <div className="flex items-center gap-2"><span className="text-[13px] text-gray-600">Looks like:</span><TagPill name={name || "Tag"} color={color} icon={icon} /></div>
        <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Tag Name<input disabled={system} value={name} onChange={(event) => setName(event.target.value.slice(0, 40))} className={`${input} mt-1 disabled:opacity-60`} placeholder="e.g. Promo" /></label>
        <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Description<input value={description} onChange={(event) => setDescription(event.target.value.slice(0, 200))} className={`${input} mt-1`} placeholder="Who gets this tag" /></label>
        <div><p className="m-0 mb-1.5 text-[13px] font-bold text-gray-900 dark:text-slate-50">Colour</p><div className="flex flex-wrap gap-1.5">{TAG_COLORS.map((key) => <button key={key} type="button" onClick={() => setColor(key)} aria-label={key} className={`!min-h-0 h-8 w-8 rounded-lg border-2 ${TAG_LOOK[key]} ${color === key ? "border-[#5B3FD9]" : "border-transparent"}`} />)}</div></div>
        <div><p className="m-0 mb-1.5 text-[13px] font-bold text-gray-900 dark:text-slate-50">Icon</p><div className="flex flex-wrap gap-1.5">{TAG_ICONS.map((key) => <button key={key} type="button" onClick={() => setIcon(key)} aria-label={key} className={`!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border ${icon === key ? "border-[#5B3FD9] bg-[#EEEBFC] text-[#5B3FD9]" : "border-gray-200 text-gray-600 dark:border-slate-700"}`}><SegmentIcon name={key} className="h-4 w-4" /></button>)}</div></div>
        {error && <p className="m-0 text-[12.5px] text-rose-600">{error}</p>}
      </div>
    </ModalShell>
  );
}

// ── Custom Fields ─────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = { text: "Text", number: "Number", date: "Date", dropdown: "Dropdown", multi: "Multi-select" };

export function FieldsTab({ fields, onChanged, onToast }: { fields: EmField[]; onChanged: () => Promise<void>; onToast: (message: string) => void }) {
  const [chip, setChip] = useState<"all" | "active" | "inactive">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<EmField | "new" | null>(null);
  const menu = useMenu();
  const rows = fields.filter((row) => (chip === "all" || row.status === chip) && (!query.trim() || `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase())));
  const size = 8;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safe = Math.min(page, pages);
  const patch = async (field: EmField, body: Parameters<typeof emailMarketingApi.updateField>[1], message: string) => {
    try { await emailMarketingApi.updateField(field.id, body); onToast(message); await onChanged(); } catch (err) { onToast((err as Error).message || "That did not work."); }
  };
  const remove = async (field: EmField) => {
    if (!window.confirm(`Delete the field "${field.name}"? Answers saved in it are no longer shown.`)) return;
    try { await emailMarketingApi.deleteField(field.id); onToast("Field deleted."); await onChanged(); } catch (err) { onToast((err as Error).message || "That did not work."); }
  };
  return (
    <Card className="overflow-hidden">
      <TabHead icon={FileText} title="Custom Fields" sub="Create and manage custom fields to store extra customer information (e.g., State, Source, Product Interest, etc.)."
        right={<div className="flex items-center gap-2"><label className="relative w-[300px] max-w-full"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search custom fields (e.g., State, Source...)" className={`${input} !pl-9`} /></label><button type="button" onClick={() => setEditing("new")} className={btn.primary}><Plus className="h-4 w-4" />Add Custom Field</button></div>} />
      <div className="flex flex-wrap items-center gap-2 p-4">
        <Chips value={chip} onChange={(value) => { setChip(value); setPage(1); }} items={[
          { key: "all", label: `All Fields (${fields.length})`, icon: FileText },
          { key: "active", label: `Active (${fields.filter((row) => row.status === "active").length})`, dot: "bg-emerald-500" },
          { key: "inactive", label: `Inactive (${fields.filter((row) => row.status === "inactive").length})`, dot: "bg-gray-400" }
        ]} />
        <span className="ml-auto"><ViewToggle view={view} onChange={setView} /></span>
      </div>
      {view === "list" ? (
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full min-w-[1040px] text-left text-[13.5px]">
            <thead><tr className="border-y border-gray-100 text-[13px] font-bold text-gray-700 dark:border-slate-800 dark:text-slate-300">
              <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Pick all" disabled /></th><th className="px-3 py-3">Field Name</th><th className="px-3 py-3">Field Type</th><th className="px-3 py-3">Description</th>
              <th className="px-3 py-3 text-center">Required</th><th className="px-3 py-3 text-center">Use in Forms</th><th className="px-3 py-3 text-right">Contacts Filled</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Last Updated</th><th className="px-3 py-3 text-center">Actions</th>
            </tr></thead>
            <tbody>
              {rows.slice((safe - 1) * size, safe * size).map((field) => (
                <tr key={field.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                  <td className="px-4 py-3"><input type="checkbox" aria-label={`Pick ${field.name}`} /></td>
                  <td className="px-3 py-3"><span className="flex items-center gap-3"><span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#F5F2FE] text-[#5B3FD9] dark:bg-slate-800">{field.icon === "naira" ? <span className="text-[15px] font-black">₦</span> : <SegmentIcon name={field.icon} />}</span><span className="font-bold text-gray-900 dark:text-slate-50">{field.name}</span></span></td>
                  <td className="px-3 py-3"><span className="inline-flex items-center gap-1 rounded-lg border border-[#C9BEF5] px-2.5 py-1 text-[12.5px] font-bold text-[#5B3FD9] dark:border-violet-500/40">{TYPE_LABEL[field.type] ?? field.type}<ChevronRight className="h-3 w-3 rotate-90" /></span></td>
                  <td className="max-w-[260px] px-3 py-3 text-[13px]">{field.description || "—"}{field.systemKey && <span className="block text-[11.5px] text-gray-500">Filled from orders</span>}</td>
                  <td className="px-3 py-3 text-center">{field.required ? <Pill tone="purple">Yes</Pill> : <Pill tone="slate">No</Pill>}</td>
                  <td className="px-3 py-3 text-center"><span className="inline-flex" title="Sign-up forms come with Forms & Lead Capture"><Toggle on={field.useInForms} label={`Use ${field.name} in forms`} onChange={(useInForms) => void patch(field, { useInForms }, useInForms ? "Will be asked on sign-up forms." : "Left off sign-up forms.")} /></span></td>
                  <td className="px-3 py-3 text-right tabular-nums">{count(field.filled)} <span className="text-gray-500">({pct(field.filledPercent)})</span></td>
                  <td className="px-3 py-3">{field.status === "active" ? <Pill tone="green">Active</Pill> : <Pill tone="slate">Inactive</Pill>}</td>
                  <td className="px-3 py-3">{lagosDate(field.updatedAt)}</td>
                  <td className="px-3 py-3 text-center"><ActionButton onClick={(target) => menu.open(target, [
                    { label: "Edit", icon: Pencil, run: () => setEditing(field) },
                    field.status === "active" ? { label: "Switch off", icon: Archive, run: () => void patch(field, { status: "inactive" }, "Field switched off.") } : { label: "Switch on", icon: Undo2, run: () => void patch(field, { status: "active" }, "Field switched on.") },
                    ...(field.systemKey ? [] : [{ label: "Delete", icon: Trash2, run: () => void remove(field), danger: true }])
                  ])} /></td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">No fields here.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 border-t border-gray-100 p-3 dark:border-slate-800 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((field) => (
            <button key={field.id} type="button" onClick={() => setEditing(field)} className="!min-h-0 rounded-xl border border-gray-200 p-3.5 text-left hover:border-[#C9BEF5] dark:border-slate-700">
              <span className="font-bold text-gray-900 dark:text-slate-50">{field.name}</span> <Pill tone="purple">{TYPE_LABEL[field.type]}</Pill>
              <p className="m-0 mt-2 text-[12.5px] text-gray-600 dark:text-slate-400">{field.description}</p>
              <p className="m-0 mt-2 text-[13px]">{count(field.filled)} filled ({pct(field.filledPercent)})</p>
            </button>
          ))}
        </div>
      )}
      <Pager page={safe} pages={pages} total={rows.length} noun="custom fields" size={size} onPage={setPage} />
      <p className="m-0 border-t border-gray-100 px-4 py-2.5 text-[12px] text-gray-500 dark:border-slate-800">Ready-made fields are filled from orders. Your own fields are filled from an uploaded list (a column with the field's name) or by editing a person in All Audience. "Use in Forms" takes effect when sign-up forms are built.</p>
      {menu.node}
      {editing && <FieldModal field={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={async (message) => { setEditing(null); onToast(message); await onChanged(); }} />}
    </Card>
  );
}

function FieldModal({ field, onClose, onDone }: { field: EmField | null; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [name, setName] = useState(field?.name ?? "");
  const [type, setType] = useState<string>(field?.type ?? "dropdown");
  const [options, setOptions] = useState((field?.options ?? []).join(", "));
  const [description, setDescription] = useState(field?.description ?? "");
  const [required, setRequired] = useState(field?.required ?? false);
  const [useInForms, setUseInForms] = useState(field?.useInForms ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const system = !!field?.systemKey;
  const save = async () => {
    const list = options.split(",").map((item) => item.trim()).filter(Boolean);
    setBusy(true);
    try {
      if (field) await emailMarketingApi.updateField(field.id, { ...(system ? {} : { name, ...(type === "dropdown" || type === "multi" ? { options: list } : {}) }), description, required, useInForms });
      else await emailMarketingApi.createField({ name, type, options: list, description, required, useInForms });
      await onDone(field ? "Field saved." : "Field added.");
    } catch (err) { setError((err as Error).message || "Could not save the field."); setBusy(false); }
  };
  return (
    <ModalShell title={field ? `Edit "${field.name}"` : "Add Custom Field"} sub={system ? "A ready-made field, filled from orders." : "A question you want to keep an answer to for each person."} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}>{busy ? "Saving…" : field ? "Save" : "Add Field"}</button></>}>
      <div className="space-y-3">
        <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Field Name<input disabled={system} value={name} onChange={(event) => setName(event.target.value.slice(0, 60))} className={`${input} mt-1 disabled:opacity-60`} placeholder="e.g. Preferred Delivery Day" /></label>
        <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Field Type
          <select disabled={!!field} value={type} onChange={(event) => setType(event.target.value)} className={`${select} mt-1 disabled:opacity-60`}>
            {Object.entries(TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {(type === "dropdown" || type === "multi") && <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Choices (separate with commas)<input disabled={system} value={options} onChange={(event) => setOptions(event.target.value)} className={`${input} mt-1 disabled:opacity-60`} placeholder="e.g. Morning, Afternoon, Evening" /></label>}
        <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Description<input value={description} onChange={(event) => setDescription(event.target.value.slice(0, 200))} className={`${input} mt-1`} /></label>
        <label className="flex items-center gap-2 text-[13px] text-gray-800 dark:text-slate-200"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} />Required on sign-up forms</label>
        <label className="flex items-center gap-2 text-[13px] text-gray-800 dark:text-slate-200"><input type="checkbox" checked={useInForms} onChange={(event) => setUseInForms(event.target.checked)} />Use in Forms</label>
        {error && <p className="m-0 text-[12.5px] text-rose-600">{error}</p>}
      </div>
    </ModalShell>
  );
}

// ── Import / Sync ─────────────────────────────────────────────────────

const SOURCE_LOOK: Record<string, { label: string; icon: typeof Mail }> = {
  csv: { label: "CSV Import", icon: FileText }, paste: { label: "Pasted List", icon: ListChecks }, device: { label: "Phone Contacts", icon: Users }, manual: { label: "Added by hand", icon: Plus }
};
type PlatformKey = "whatsapp" | "facebook" | "instagram" | "tiktok";
const PLATFORMS: Array<{ key: PlatformKey; name: string; hint: string; why: string; colour: string; letter: string }> = [
  { key: "whatsapp", name: "WhatsApp", hint: "Sync customers & leads", why: "WhatsApp chats give phone numbers, not emails, so they can't join an email list.", colour: "#25D366", letter: "W" },
  { key: "facebook", name: "Facebook Leads", hint: "Sync your lead form contacts", why: "Needs Meta's lead-form access (a separate permission from the ad-spend connection in Tracking Hub).", colour: "#1877F2", letter: "f" },
  { key: "instagram", name: "Instagram Leads", hint: "Sync your lead form contacts", why: "Instagram lead forms come through the same Meta lead-form access.", colour: "#E1306C", letter: "IG" },
  { key: "tiktok", name: "TikTok Leads", hint: "Sync your lead form contacts", why: "Needs TikTok's lead-form access (separate from the TikTok ads connection).", colour: "#111111", letter: "T" }
];

function PlatformMark({ platform, size = 34 }: { platform: (typeof PLATFORMS)[number]; size?: number }) {
  return <span className="inline-flex shrink-0 items-center justify-center rounded-full text-[13px] font-black text-white" style={{ width: size, height: size, background: platform.colour }}>{platform.letter}</span>;
}

export function ImportSyncTab({ lists, fields, onImported, onToast, onOpenCsv, refreshKey }: {
  lists: EmSegment[];
  fields: EmField[];
  onImported: () => Promise<void>;
  onToast: (message: string) => void;
  onOpenCsv: () => void;
  refreshKey: number;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof emailMarketingApi.imports>> | null>(null);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pasting, setPasting] = useState(false);
  const [platform, setPlatform] = useState<(typeof PLATFORMS)[number] | null>(null);
  const [saving, setSaving] = useState(false);
  const load = async () => { try { setData(await emailMarketingApi.imports()); } catch (err) { onToast((err as Error).message || "Could not load the import history."); } };
  useEffect(() => { void load(); }, [refreshKey]);
  const fixedLists = lists.filter((row) => row.kind === "fixed" && row.status !== "archived");
  const rows = (data?.imports ?? []).filter((row) => (!source || row.source === source) && (!status || row.status === status));
  const size = 5;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const safe = Math.min(page, pages);
  const saveSetting = async (body: { autoSync?: boolean; defaultListId?: string | null; updateExisting?: boolean }) => {
    setSaving(true);
    try { await emailMarketingApi.saveSettings(body); await load(); onToast("Saved."); } catch (err) { onToast((err as Error).message || "Could not save."); } finally { setSaving(false); }
  };
  const fromDevice = async () => {
    const nav = navigator as Navigator & { contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<Array<{ name?: string[]; email?: string[]; tel?: string[] }>> } };
    if (!nav.contacts?.select) {
      onToast("This browser can't open your phone's contacts. On an Android phone in Chrome this opens the address book; on a computer, use Import from CSV or Paste Contacts.");
      return;
    }
    try {
      const picked = await nav.contacts.select(["name", "email", "tel"], { multiple: true });
      const found = picked.flatMap((row) => (row.email ?? []).map((email) => ({ email, name: row.name?.[0] ?? "", phone: row.tel?.[0] ?? "" })));
      if (!found.length) { onToast("None of the picked contacts has an email."); return; }
      if (!window.confirm(`Add ${found.length} people from your contacts? Only add people who agreed to get emails from you.`)) return;
      const result = await emailMarketingApi.importContacts({ rows: found, consent: true, source: "device", details: "Phone contacts" });
      onToast(`Added ${count(result.added)} from your contacts.`);
      await Promise.all([load(), onImported()]);
    } catch (err) {
      onToast((err as Error).message || "Could not read the contacts.");
    }
  };
  const tiles: Array<{ icon: typeof Mail; title: string; hint: string; button: string; run: () => void; primary?: boolean }> = [
    { icon: FileText, title: "Import from CSV", hint: "Upload a CSV file (Email, Phone, Name, etc.)", button: "Choose File", run: onOpenCsv, primary: true },
    { icon: Users, title: "Import from Contacts", hint: "Add contacts from your device or address book.", button: "Select Contacts", run: () => void fromDevice() },
    { icon: ListChecks, title: "Paste Contacts", hint: "Quickly add a list of emails or phone numbers.", button: "Paste & Import", run: () => setPasting(true) }
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <div className="flex items-start gap-3">
            <Download className="h-8 w-8 text-[#5B3FD9]" />
            <div><h3 className="m-0 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">Import / Sync Audience</h3><p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Add new contacts to your audience or keep your data in sync with other platforms.</p></div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="rounded-2xl bg-gray-50/80 p-3 dark:bg-slate-800/50">
              <p className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Import Contacts</p>
              <div className="grid gap-2.5 sm:grid-cols-3">
                {tiles.map(({ icon: Icon, title, hint, button, run, primary }) => (
                  <div key={title} className={`flex flex-col items-center gap-1.5 rounded-xl border bg-white px-2.5 py-4 text-center dark:bg-slate-900 ${primary ? "border-[#8B74EE] bg-[#F7F4FF] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                    <Icon className="h-8 w-8 text-[#5B3FD9]" />
                    <span className="text-[14px] font-bold text-gray-900 dark:text-slate-50">{title}</span>
                    <span className="text-[12px] leading-snug text-gray-600 dark:text-slate-400">{hint}</span>
                    <button type="button" onClick={run} className={`${primary ? btn.primary : btn.outline} mt-1 !px-4 !py-2`}>{button}</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-gray-50/80 p-3 dark:bg-slate-800/50">
              <p className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Sync from Platforms</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {PLATFORMS.map((row) => (
                  <button key={row.key} type="button" onClick={() => setPlatform(row)} className="!min-h-0 flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left hover:border-[#C9BEF5] dark:border-slate-700 dark:bg-slate-900">
                    <PlatformMark platform={row} />
                    <span className="min-w-0"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[12px] text-gray-600 dark:text-slate-400">{row.hint}</span></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 p-4">
            <CalendarDays className="h-7 w-7 text-[#5B3FD9]" />
            <div className="mr-auto"><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Import History</h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">A record of all imports and sync activities.</p></div>
            <select value={source} onChange={(event) => { setSource(event.target.value); setPage(1); }} className={`${select} !w-[150px]`} aria-label="Source"><option value="">All Sources</option>{Object.entries(SOURCE_LOOK).map(([key, look]) => <option key={key} value={key}>{look.label}</option>)}</select>
            <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={`${select} !w-[140px]`} aria-label="Status"><option value="">All Status</option><option value="completed">Completed</option><option value="failed">Failed</option></select>
          </div>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[860px] text-left text-[13.5px]">
              <thead><tr className="border-y border-gray-100 bg-gray-50/60 text-[13px] font-bold text-gray-700 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                <th className="px-4 py-2.5">#</th><th className="px-3 py-2.5">Source</th><th className="px-3 py-2.5">File / Details</th><th className="px-3 py-2.5 text-right">Contacts</th><th className="px-3 py-2.5 text-right">New</th>
                <th className="px-3 py-2.5 text-right">Updated</th><th className="px-3 py-2.5 text-right">Duplicates</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Date &amp; Time</th>
              </tr></thead>
              <tbody>
                {rows.slice((safe - 1) * size, safe * size).map((row, index) => {
                  const look = SOURCE_LOOK[row.source] ?? SOURCE_LOOK.csv;
                  return (
                    <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:align-middle [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                      <td className="px-4 py-2.5">{(safe - 1) * size + index + 1}</td>
                      <td className="px-3 py-2.5"><span className="flex items-center gap-2 font-semibold"><look.icon className="h-5 w-5 text-[#5B3FD9]" />{look.label}</span></td>
                      <td className="max-w-[200px] truncate px-3 py-2.5" title={row.details}>{row.details || "—"}{row.invalid ? <span className="block text-[11.5px] text-gray-500">{count(row.invalid)} bad email{row.invalid === 1 ? "" : "s"} skipped</span> : null}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{count(row.contacts)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{count(row.added)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{count(row.updated)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{count(row.duplicates)}</td>
                      <td className="px-3 py-2.5">{row.status === "completed" ? <Pill tone="green">Completed</Pill> : <Pill tone="red">Failed</Pill>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">{lagosDate(row.createdAt, true)}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-500">{data ? "No imports yet. Order-form emails join the list by themselves and are not listed here." : "Loading…"}</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > size && <Pager page={safe} pages={pages} total={rows.length} noun="imports" size={size} onPage={setPage} />}
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Undo2 className="h-5 w-5 -scale-x-100 text-[#5B3FD9]" />Sync Status</h3>
          <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-800">
            <div className="flex items-center gap-3 py-3">
              <span className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#5B3FD9] text-white"><FileText className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-bold text-gray-900 dark:text-slate-50">Order Form {data?.orderForm.on ? <Pill tone="green">Connected</Pill> : <Pill tone="slate">Off</Pill>}</span>
                <span className="block text-[12px] text-gray-600 dark:text-slate-400">{data?.orderForm.lastSyncAt ? `Last sync: ${lagosDate(data.orderForm.lastSyncAt, true)}` : "Checks for new emails every 5 minutes"} · {count(data?.orderForm.contacts ?? 0)} so far</span></span>
            </div>
            {PLATFORMS.map((row) => (
              <button key={row.key} type="button" onClick={() => setPlatform(row)} className="!min-h-0 flex w-full items-center gap-3 py-3 text-left">
                <PlatformMark platform={row} />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-2 text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.name}<Pill tone="slate">Not Connected</Pill></span><span className="block text-[12px] text-gray-600 dark:text-slate-400">Not available yet</span></span>
                <ChevronRight className="h-4 w-4 text-gray-500" />
              </button>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><SlidersHorizontal className="h-5 w-5 text-[#5B3FD9]" />Auto Sync Settings</h3>
          {data ? (
            <div className="mt-3 space-y-4">
              <div className="flex items-start gap-3">
                <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">Auto sync new leads</span><span className="block text-[12px] text-gray-600 dark:text-slate-400">Emails typed on the order form or in an unfinished order join the list by themselves.</span></span>
                <Toggle on={data.settings.autoSync} disabled={saving} label="Auto sync new leads" onChange={(autoSync) => void saveSetting({ autoSync })} />
              </div>
              <label className="flex items-center justify-between gap-3 text-[14px] font-bold text-gray-900 dark:text-slate-50">Sync interval
                <select disabled className={`${select} !w-[170px] !font-semibold`} aria-label="Sync interval"><option>Every 5 Minutes</option></select>
              </label>
              <label className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">Default list for imported contacts
                <select value={data.settings.defaultListId ?? ""} disabled={saving} onChange={(event) => void saveSetting({ defaultListId: event.target.value || null })} className={`${select} mt-1.5 !font-semibold`}>
                  <option value="">None (only the list made at upload)</option>
                  {fixedLists.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </label>
              <label className="flex items-start gap-2.5 text-[13.5px] text-gray-800 dark:text-slate-200"><input type="checkbox" className="mt-0.5" disabled={saving} checked={data.settings.updateExisting} onChange={(event) => void saveSetting({ updateExisting: event.target.checked })} />Update existing contacts (match by email): fill a missing name or phone and custom field answers.</label>
            </div>
          ) : <p className="m-0 mt-3 text-[13px] text-gray-500">Loading…</p>}
        </Card>
      </div>

      {pasting && <PasteModal fields={fields} onClose={() => setPasting(false)} onDone={async (message) => { setPasting(false); onToast(message); await Promise.all([load(), onImported()]); }} />}
      {platform && (
        <ModalShell title={platform.name} sub="Not connected" onClose={() => setPlatform(null)} footer={<button type="button" onClick={() => setPlatform(null)} className={btn.primary}>OK</button>}>
          <div className="flex items-start gap-3"><PlatformMark platform={platform} size={40} /><p className="m-0 text-[14px] leading-relaxed text-gray-700 dark:text-slate-300">{platform.why} Until then, new customers join the email list from the order form, and you can upload or paste a list.</p></div>
        </ModalShell>
      )}
    </div>
  );
}

function PasteModal({ fields, onClose, onDone }: { fields: EmField[]; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One person per line: "email", "name, email" or "name, email, phone".
  const rows = useMemo(() => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split(/[,;\t]/).map((part) => part.trim()).filter(Boolean);
    const email = parts.find((part) => part.includes("@")) ?? "";
    const phone = parts.find((part) => /^\+?\d[\d\s-]{6,}$/.test(part)) ?? "";
    const name = parts.find((part) => part !== email && part !== phone) ?? "";
    return { email, name, phone };
  }).filter((row) => row.email), [text]);
  const save = async () => {
    if (!rows.length) { setError("Paste at least one email."); return; }
    if (!consent) { setError("Tick that everyone on this list agreed to get emails from you."); return; }
    setBusy(true);
    try {
      const result = await emailMarketingApi.importContacts({ rows, consent: true, source: "paste", details: `${rows.length} pasted` });
      await onDone(`Added ${count(result.added)} people${result.invalid ? `; ${count(result.invalid)} emails were not valid` : ""}.`);
    } catch (err) { setError((err as Error).message || "Could not add them."); setBusy(false); }
  };
  void fields;
  return (
    <ModalShell title="Paste Contacts" sub="One person per line: an email, or name, email, phone." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy || !rows.length} onClick={() => void save()} className={btn.primary}>{busy ? "Adding…" : `Paste & Import ${rows.length ? count(rows.length) : ""}`}</button></>}>
      <div className="space-y-3">
        <textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} className={`${input} font-mono !text-[13px]`} placeholder={"ada@gmail.com\nTunde Bello, tunde@yahoo.com, 08031234567"} />
        <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">{count(rows.length)} people with an email found. Phone numbers alone can't be emailed, so lines without an email are skipped.</p>
        <label className="flex items-start gap-2 text-[13px] text-gray-700 dark:text-slate-300"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" />Everyone on this list agreed to get emails from us.</label>
        {error && <p className="m-0 text-[12.5px] text-rose-600">{error}</p>}
      </div>
    </ModalShell>
  );
}
