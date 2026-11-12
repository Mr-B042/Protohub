import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, CalendarCheck, CalendarClock, CalendarDays, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Clock, Filter, List, Loader2, MessageSquareText,
  MoreHorizontal, Phone, Plus, Search, Settings2, FileText, Target, Zap
} from "lucide-react";
import { socialLeadsApi } from "../../lib/api";
import { PlatformIcon } from "../../components/SocialIcons";
import { Avatar, Card, CardTitle, Donut, Empty, Kpi, Modal, Pager, Pill, ProductThumb, Select, btn, dayLabel, untilLabel, whenLabel } from "./sl-ui";
import { useLoad } from "./sl-data";
import { DoneFollowUpModal, ScheduleModal } from "./LeadModals";
import type { Shared } from "./SocialLeadsPage";

const STATE_LOOK: Record<string, { label: string; tone: string; Icon: React.ComponentType<{ className?: string }> }> = {
  overdue: { label: "Overdue", tone: "red", Icon: AlertTriangle },
  due_today: { label: "Due Today", tone: "amber", Icon: Clock },
  scheduled: { label: "Scheduled", tone: "purple", Icon: CalendarClock },
  completed: { label: "Completed", tone: "green", Icon: CheckCircle2 }
};
const th = "whitespace-nowrap px-3 py-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400";

export const openSettingsSection = (shared: Shared, section: string) => {
  const [path, query = ""] = window.location.hash.split("?");
  const next = new URLSearchParams(query);
  next.set("section", section);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${path}?${next.toString()}`);
  shared.goTab("settings");
};

export default function FollowUpsTab({ shared }: { shared: Shared }) {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [when, setWhen] = useState("all"), [status, setStatus] = useState("all"), [rep, setRep] = useState("all"), [product, setProduct] = useState("all");
  const [search, setSearch] = useState(""), [q, setQ] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [page, setPage] = useState(1), [size, setSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<null | { kind: "schedule"; ids: string[]; names?: string; current?: { at: string | null; note: string | null } } | { kind: "done"; id: string; name: string } | { kind: "pick" }>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [when, status, rep, product, q, day, size]);
  const params = { range: "all", when, status, rep, product, q, page, size, day: day ?? undefined };
  const data = useLoad(() => socialLeadsApi.followUps(params), JSON.stringify(params), 60_000);
  const d = data.data;
  const rows = d?.followUps ?? [];
  const k = d?.kpis;
  const done = () => { setModal(null); setSelected(new Set()); data.reload(); shared.refreshHeader(); };
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.lead.id));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={CalendarDays} tone="purple" value={k?.total.value ?? "—"} label="Total Follow-ups" change={k?.total.change ?? null} />
        <Kpi icon={Clock} tone="blue" value={k?.dueToday.value ?? "—"} label="Due Today" change={k?.dueToday.change ?? null} />
        <Kpi icon={AlertTriangle} tone="red" value={k?.overdue.value ?? "—"} label="Overdue" change={k?.overdue.change ?? null} invert />
        <Kpi icon={CalendarRange} tone="blue" value={k?.scheduled.value ?? "—"} label="Scheduled" change={k?.scheduled.change ?? null} />
        <Kpi icon={CheckCircle2} tone="green" value={k?.completed.value ?? "—"} label="Completed" change={k?.completed.change ?? null} />
        <Kpi icon={Target} tone="red" value={k?.conversion.value !== null && k?.conversion.value !== undefined ? `${k.conversion.value}%` : "—"} label="Follow-up Conversion" change={k?.conversion.change ?? null} unit="pp" />
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-start gap-3 px-5 pt-4">
            <div className="mr-auto">
              <h2 className="m-0 flex items-center gap-2 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">Follow-ups <span className="rounded-full bg-[#EEEBFC] px-2.5 py-0.5 text-[13px] font-semibold text-[#5B3FD9]">{d?.total ?? 0} follow-ups</span></h2>
              <p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Manage and never miss a follow-up with interested customers.</p>
            </div>
            <div className="inline-flex rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
              {(["list", "calendar"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setView(v)} className={`!min-h-0 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[14px] font-semibold ${view === v ? "bg-[#5B3FD9] text-white" : "text-gray-700 dark:text-slate-200"}`}>{v === "list" ? <List className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}{v === "list" ? "List" : "Calendar"}</button>
              ))}
            </div>
            <button type="button" onClick={() => setModal({ kind: "pick" })} className={btn.primary}><Plus className="h-4 w-4" />Add Follow-up</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
            <span className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, product, or lead ID..." className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" />
            </span>
            <Select label="When" className="w-[140px]" value={when} onChange={setWhen} options={[{ value: "all", label: "All Time" }, { value: "today", label: "Up to today" }, { value: "week", label: "Next 7 days" }]} />
            <Select label="Status" className="w-[140px]" value={status} onChange={setStatus} options={[{ value: "all", label: "All Status" }, { value: "overdue", label: "Overdue" }, { value: "due_today", label: "Due Today" }, { value: "scheduled", label: "Scheduled" }, { value: "completed", label: "Completed" }]} />
            {shared.leadership && <Select label="Call rep" className="w-[150px]" value={rep} onChange={setRep} options={[{ value: "all", label: "All Call Reps" }, ...shared.reps.filter((r) => r.role === "Sales Rep").map((r) => ({ value: r.id, label: r.name }))]} />}
            <Select label="Product" className="w-[150px]" value={product} onChange={setProduct} options={[{ value: "all", label: "All Products" }, ...shared.products.map((p) => ({ value: p.id, label: p.name }))]} />
            <button type="button" aria-label="Clear filters" title="Clear filters" onClick={() => { setWhen("all"); setStatus("all"); setRep("all"); setProduct("all"); setSearch(""); setDay(null); }} className={`${btn.icon} !text-[#5B3FD9]`}><Filter className="h-[18px] w-[18px]" /></button>
          </div>
          {day && <div className="mx-5 mt-3 flex items-center gap-2 text-[13px]"><Pill tone="purple">Showing {dayLabel(day)}</Pill><button type="button" className="!min-h-0 text-gray-500 underline" onClick={() => setDay(null)}>Show all days</button></div>}
          {selected.size > 0 && (
            <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl bg-[#F5F2FE] px-3 py-2 text-[13px] dark:bg-violet-500/10">
              <b>{selected.size} selected</b>
              <button type="button" className={`${btn.ghost} !py-1.5 !text-[13px]`} onClick={() => setModal({ kind: "schedule", ids: [...selected] })}><CalendarClock className="h-4 w-4" />Move to another time</button>
              <button type="button" className="!min-h-0 ml-auto text-[12.5px] text-gray-500" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
          {view === "calendar" ? <MonthCalendar counts={d?.calendar ?? []} picked={day} onPick={(x) => { setDay(x); setView("list"); }} /> : (
            <div className="mt-3 overflow-x-auto">
              <table className="!min-w-[980px] w-full border-collapse">
                <thead className="bg-gray-50/80 dark:bg-slate-800/50">
                  <tr>
                    <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); if (allOnPage) rows.forEach((r) => n.delete(r.lead.id)); else rows.forEach((r) => n.add(r.lead.id)); return n; })} /></th>
                    <th className={th}>Customer</th><th className={th}>Product / Interest</th><th className={th}>Follow-up Note</th><th className={th}>Next Follow-up</th><th className={th}>Status</th><th className={th}>Assigned To</th><th className={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.error && <tr><td colSpan={8}><Empty>{data.error}</Empty></td></tr>}
                  {!d && !data.error && <tr><td colSpan={8}><Empty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Empty></td></tr>}
                  {d && rows.length === 0 && <tr><td colSpan={8}><Empty>No follow-up here. Schedule one from a conversation, or with Add Follow-up.</Empty></td></tr>}
                  {rows.map((f) => {
                    const look = STATE_LOOK[f.state];
                    return (
                      <tr key={f.id} className="border-b border-gray-100 dark:border-slate-800 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                        <td className="!px-4"><input type="checkbox" aria-label={`Select ${f.lead.name}`} checked={selected.has(f.lead.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(f.lead.id)) n.delete(f.lead.id); else n.add(f.lead.id); return n; })} /></td>
                        <td><span className="flex items-center gap-2.5"><Avatar name={f.lead.name} src={f.lead.profilePic} size={38} platform={<PlatformIcon platform={f.lead.platform} className="h-3.5 w-3.5" />} /><span className="min-w-0"><b className="block max-w-[160px] truncate">{f.lead.name}</b><span className="text-[12.5px] text-gray-500">{f.lead.phone ?? "No phone yet"}</span></span></span></td>
                        <td>{f.lead.product ? <span className="flex items-center gap-2"><ProductThumb src={f.lead.productImage} name={f.lead.product} size={32} /><span className="max-w-[140px] font-medium leading-tight">{f.lead.product}</span></span> : "—"}</td>
                        <td className="max-w-[190px]"><span className="line-clamp-2">{f.note || <span className="text-gray-400">—</span>}</span>{f.auto && <span className="block text-[11.5px] text-gray-400">Automatic</span>}</td>
                        <td className="whitespace-nowrap"><span className="flex items-start gap-2"><CalendarDays className={`mt-0.5 h-5 w-5 ${f.state === "overdue" ? "text-rose-500" : f.state === "due_today" ? "text-amber-500" : "text-gray-500"}`} /><span><b className="block">{whenLabel(f.dueAt)}</b><span className={`text-[12px] font-semibold ${f.state === "overdue" ? "rounded bg-rose-50 px-1 text-rose-600" : f.state === "due_today" ? "rounded bg-amber-50 px-1 text-amber-700" : "text-gray-500"}`}>{f.state === "completed" ? "Done" : untilLabel(f.dueAt)}</span></span></span></td>
                        <td><Pill tone={look.tone}><look.Icon className="h-3.5 w-3.5" />{look.label}</Pill></td>
                        <td>{f.lead.assignedName ? <span className="flex items-center gap-2"><Avatar name={f.lead.assignedName} src={f.lead.assignedAvatar} size={28} /><b className="font-semibold">{f.lead.assignedName}</b></span> : <span className="text-gray-500">Unassigned</span>}</td>
                        <td>
                          <span className="relative flex items-center gap-1">
                            {f.lead.phone ? <a href={`tel:${f.lead.phone}`} aria-label="Call" className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B3FD9] hover:bg-[#F1EEFD]"><Phone className="h-[18px] w-[18px]" /></a> : <span className="inline-flex h-8 w-8 items-center justify-center text-gray-300"><Phone className="h-[18px] w-[18px]" /></span>}
                            <button type="button" aria-label="Open conversation" onClick={() => shared.openLead(f.lead.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B3FD9] hover:bg-[#F1EEFD]"><MessageSquareText className="h-[18px] w-[18px]" /></button>
                            <button type="button" aria-label="More" onClick={() => setMenuFor(menuFor === f.id ? null : f.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-slate-300"><MoreHorizontal className="h-[18px] w-[18px]" /></button>
                            {menuFor === f.id && f.state !== "completed" && (
                              <div className="absolute right-0 top-9 z-20 w-48 rounded-xl border border-gray-200 bg-white p-1 text-[13px] shadow-lg dark:border-slate-700 dark:bg-slate-900" onMouseLeave={() => setMenuFor(null)}>
                                <button type="button" className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); setModal({ kind: "done", id: f.lead.id, name: f.lead.name }); }}>Mark done</button>
                                <button type="button" className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); setModal({ kind: "schedule", ids: [f.lead.id], names: f.lead.name, current: { at: f.dueAt, note: f.note } }); }}>Change time</button>
                              </div>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {view === "list" && <Pager page={d?.page ?? 1} size={size} total={d?.total ?? 0} onPage={setPage} onSize={setSize} noun="follow-ups" />}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <CardTitle icon={CalendarCheck} title="Today's Follow-ups" right={<Pill tone="purple">{(d?.today.dueToday ?? 0) + (d?.today.overdue ?? 0)} due</Pill>} />
            <div className="mt-3 flex items-center gap-4">
              <Donut size={150} thickness={18} data={[{ label: "Completed", value: d?.today.completed ?? 0, color: "#6E3FF3" }, { label: "Left", value: (d?.today.total ?? 0) - (d?.today.completed ?? 0), color: "#E9E5FB" }]}
                center={`${d?.today.completed ?? 0}/${d?.today.total ?? 0}`} sub={d?.today.total ? `${Math.round(((d.today.completed) / d.today.total) * 100)}% completed` : "Nothing due"} />
              <div className="flex-1 space-y-2.5 text-[13.5px]">
                {[["Completed", d?.today.completed, CheckCircle2, "text-emerald-600"], ["Due Today", d?.today.dueToday, Clock, "text-amber-500"], ["Overdue", d?.today.overdue, AlertTriangle, "text-rose-500"], ["Remaining", (d?.today.dueToday ?? 0) + (d?.today.overdue ?? 0), CalendarDays, "text-gray-500"]].map(([label, value, Icon, cls]) => {
                  const I = Icon as React.ComponentType<{ className?: string }>;
                  return <div key={label as string} className="flex items-center gap-2"><I className={`h-4 w-4 ${cls}`} /><span className="flex-1">{label as string}</span><b>{(value as number) ?? 0}</b></div>;
                })}
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <CardTitle icon={CalendarRange} title="Upcoming Follow-ups" right={<button type="button" onClick={() => { setView("calendar"); }} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2F5BEA] underline">View All<ArrowRight className="h-4 w-4" /></button>} />
            <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-800">
              {(d?.upcoming ?? []).length === 0 && <p className="m-0 py-4 text-[13px] text-gray-500">Nothing scheduled after today.</p>}
              {(d?.upcoming ?? []).map((u) => (
                <button key={u.day} type="button" onClick={() => setDay(u.day)} className="!min-h-0 flex w-full items-center gap-2.5 py-2.5 text-left text-[13.5px]">
                  <CalendarDays className="h-5 w-5 text-[#5B3FD9]" /><b className="flex-1">{u.day === new Date(Date.now() + 3_600_000 + 86_400_000).toISOString().slice(0, 10) ? "Tomorrow" : new Date(`${u.day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</b>
                  <span className="text-gray-700 dark:text-slate-300"><b>{u.count}</b> follow-up{u.count === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <CardTitle icon={Zap} title="Quick Actions" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                { Icon: Plus, label: "Add Follow-up", go: () => setModal({ kind: "pick" }) },
                { Icon: CalendarClock, label: "Bulk Schedule", go: () => selected.size ? setModal({ kind: "schedule", ids: [...selected] }) : shared.onToast("Tick the follow-ups to move first, or tick leads on All Leads.") },
                { Icon: Settings2, label: "Auto Follow-up Rules", go: () => shared.canSetup ? openSettingsSection(shared, "sla") : shared.onToast("The Owner or an Admin sets the automatic follow-up rule.") },
                { Icon: FileText, label: "Follow-up Templates", go: () => shared.canSetup ? openSettingsSection(shared, "templates") : shared.onToast("Templates are in the Templates button under each chat.") }
              ].map((a) => (
                <button key={a.label} type="button" onClick={a.go} className="!min-h-0 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-3 text-left text-[13px] font-semibold text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F1EEFD] text-[#5B3FD9]"><a.Icon className="h-4 w-4" /></span>{a.label}
                </button>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {modal?.kind === "schedule" && <ScheduleModal leadIds={modal.ids} names={modal.names} current={modal.current} onClose={() => setModal(null)} onToast={shared.onToast} onDone={done} />}
      {modal?.kind === "done" && <DoneFollowUpModal leadId={modal.id} name={modal.name} onClose={() => setModal(null)} onToast={shared.onToast} onDone={done} />}
      {modal?.kind === "pick" && <PickLeadModal shared={shared} onClose={() => setModal(null)} onPick={(id, name) => setModal({ kind: "schedule", ids: [id], names: name })} />}
    </div>
  );
}

function PickLeadModal({ shared, onClose, onPick }: { shared: Shared; onClose: () => void; onPick: (id: string, name: string) => void }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search), 250); return () => clearTimeout(t); }, [search]);
  const list = useLoad(() => socialLeadsApi.conversations("all", q), q);
  return (
    <Modal title="Add Follow-up" sub="Pick the lead to follow up." icon={CalendarClock} onClose={onClose}>
      <span className="relative block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone or lead ID" className="w-full rounded-xl border border-gray-200 py-2.5 pl-9 pr-3 text-[14px] dark:border-slate-700 dark:bg-slate-900" /></span>
      <div className="mt-2 max-h-80 overflow-y-auto">
        {(list.data?.conversations ?? []).map((l) => (
          <button key={l.id} type="button" onClick={() => onPick(l.id, l.name)} className="!min-h-0 flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800">
            <Avatar name={l.name} src={l.profilePic} size={32} /><span className="min-w-0 flex-1"><b className="block truncate text-[14px]">{l.name}</b><span className="text-[12px] text-gray-500">{l.ref} · {l.product ?? "—"}</span></span><ChevronRight className="h-4 w-4 text-gray-400" />
          </button>
        ))}
        {list.data && !list.data.conversations.length && <p className="m-0 py-6 text-center text-[13px] text-gray-500">No lead found.</p>}
      </div>
    </Modal>
  );
}

function MonthCalendar({ counts, picked, onPick }: { counts: Array<{ day: string; count: number }>; picked: string | null; onPick: (day: string) => void }) {
  const todayKey = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const [month, setMonth] = useState(todayKey.slice(0, 7));
  const map = useMemo(() => new Map(counts.map((c) => [c.day, c.count])), [counts]);
  const first = new Date(`${month}-01T12:00:00Z`);
  const startDow = (first.getUTCDay() + 6) % 7; // Monday first
  const daysIn = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [...Array(startDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const shift = (n: number) => { const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  return (
    <div className="px-5 pb-5 pt-4">
      <div className="mb-3 flex items-center justify-between">
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
        <b className="text-[16px]">{first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</b>
        <button type="button" aria-label="Next month" onClick={() => shift(1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[12px] font-semibold text-gray-500">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="mt-1.5 grid grid-cols-7 gap-1.5">
        {cells.map((day, i) => day === null ? <span key={`e${i}`} /> : (
          <button key={day} type="button" onClick={() => onPick(day)} className={`!min-h-0 flex h-20 flex-col items-start rounded-xl border p-2 text-left ${day === picked ? "border-[#5B3FD9] bg-[#F5F2FE]" : day === todayKey ? "border-[#5B3FD9]/50" : "border-gray-200 dark:border-slate-700"} hover:bg-gray-50 dark:hover:bg-slate-800`}>
            <span className={`text-[13px] font-semibold ${day < todayKey ? "text-gray-400" : "text-gray-800 dark:text-slate-200"}`}>{Number(day.slice(8))}</span>
            {map.get(day) ? <span className={`mt-auto rounded-full px-2 py-0.5 text-[11.5px] font-bold ${day < todayKey ? "bg-rose-50 text-rose-600" : "bg-[#EEEBFC] text-[#5B3FD9]"}`}>{map.get(day)} due</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
