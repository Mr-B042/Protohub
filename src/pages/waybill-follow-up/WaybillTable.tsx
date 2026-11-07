import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, MoreHorizontal, Search } from "lucide-react";
import type { WfActiveRow, WfResponseOption } from "../../lib/api";
import { ChannelIcon, Initials, Pill, ResponsePill, STATUS_LOOK, btn, lagosTime } from "./wf-ui";
import { NoticeChip } from "./Timers";

type Props = {
  rows: WfActiveRow[];
  options: WfResponseOption[];
  pageSize: number;
  onLog: (ids: string[]) => void;
  onHistory: (id: string) => void;
  onOpenWaybills: () => void;
  /** "I've informed the agent's group" with its countdown (Bright, 7 Nov 2026). */
  nowMs: number;
  onInform: (ids: string[]) => void;
  informing: Set<string>;
};

const STATUS_FILTERS = [
  { key: "", label: "All Status" },
  { key: "overdue", label: "Overdue" },
  { key: "pending", label: "Pending" },
  { key: "in_transit", label: "In Transit" },
  { key: "verify", label: "Verify Receipt" }
];

function Select({ value, onChange, children, label }: { value: string; onChange: (value: string) => void; children: React.ReactNode; label: string }) {
  return (
    <span className="relative inline-flex">
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}
        className="!min-h-0 appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-[12.5px] font-medium text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
    </span>
  );
}

/** The design's Active Waybills table: search, State / Agent / Status, select, Log Follow-Up, pages. */
export default function WaybillTable({ rows, options, pageSize, onLog, onHistory, onOpenWaybills, nowMs, onInform, informing }: Props) {
  const [search, setSearch] = useState("");
  const [state, setState] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuFor(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuFor]);

  const states = useMemo(() => [...new Set(rows.map((row) => row.state).filter(Boolean))].sort(), [rows]);
  const agents = useMemo(() => [...new Set(rows.map((row) => row.agentName).filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) =>
      (!q || `${row.id} ${row.agentName} ${row.state} ${row.city} ${row.productName}`.toLowerCase().includes(q))
      && (!state || row.state === state) && (!agent || row.agentName === agent) && (!status || row.status === status));
  }, [rows, search, state, agent, status]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * pageSize, current * pageSize);
  useEffect(() => { setPage(1); }, [search, state, agent, status]);
  // Drop picks that no longer exist (received since).
  useEffect(() => { setSelected((value) => new Set([...value].filter((id) => rows.some((row) => row.id === id)))); }, [rows]);

  const allOnPage = visible.length > 0 && visible.every((row) => selected.has(row.id));
  const toggleAll = () => setSelected((value) => {
    const next = new Set(value);
    if (allOnPage) visible.forEach((row) => next.delete(row.id)); else visible.forEach((row) => next.add(row.id));
    return next;
  });
  const toggle = (id: string) => setSelected((value) => { const next = new Set(value); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  // 1 2 3 4 5 … 9, as in the design.
  const numbers = pages <= 7 ? Array.from({ length: pages }, (_, i) => i + 1)
    : current <= 4 ? [1, 2, 3, 4, 5, -1, pages]
      : current >= pages - 3 ? [1, -1, pages - 4, pages - 3, pages - 2, pages - 1, pages]
        : [1, -1, current - 1, current, current + 1, -2, pages];
  const th = "px-2.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
        <span className="relative min-w-[200px] flex-1 sm:max-w-[230px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search waybill, agent or state..."
            className="w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-8 pr-2 text-[12.5px] dark:border-slate-700 dark:bg-slate-900" />
        </span>
        <Select label="State" value={state} onChange={setState}><option value="">All States</option>{states.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
        <Select label="Agent" value={agent} onChange={setAgent}><option value="">All Agents</option>{agents.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
        <Select label="Status" value={status} onChange={setStatus}>{STATUS_FILTERS.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}</Select>
        {selected.size > 0 && (
          <button type="button" onClick={() => onLog([...selected])} className={`${btn.primary} !px-3 !py-1.5 !text-[12.5px] sm:ml-auto`}>
            Log follow-up for {selected.size} selected
          </button>
        )}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="!min-w-[940px] w-full border-collapse text-[13px]">
          <thead className="bg-gray-50 dark:bg-slate-800/60">
            <tr>
              <th className="w-10 px-3 py-2.5"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={toggleAll} /></th>
              <th className={th}>Waybill</th><th className={th}>State</th><th className={th}>Agent</th><th className={th}>Agent Told</th><th className={th}>Last Follow-Up</th>
              <th className={th}>Agent Response</th><th className={th}>Status</th><th className={th}>Action</th><th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={10} className="px-5 py-10 text-center text-[13px] text-gray-500">
                {rows.length === 0 ? "No waybill is waiting for receipt. A waybill shows here from when it is created until it is marked Received." : "No waybill matches these filters."}
              </td></tr>
            )}
            {visible.map((row) => (
              <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:[color:inherit]">
                <td className="px-2.5 py-2.5"><input type="checkbox" aria-label={`Select ${row.id}`} checked={selected.has(row.id)} onChange={() => toggle(row.id)} /></td>
                <td className="px-2.5 py-2.5">
                  <button type="button" onClick={() => onHistory(row.id)} className="!min-h-0 whitespace-nowrap font-semibold text-[#2F5BEA] hover:underline">{row.id}</button>
                  {row.noNewsStreak >= 2 && (
                    <span className={`mt-0.5 flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold ${row.noNewsStreak >= 3 ? "text-rose-600" : "text-amber-700"}`}>
                      <AlertTriangle className="h-3 w-3" />{row.noNewsStreak >= 3 ? "No reply ×3 · escalate" : "No reply twice"}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-2.5 py-2.5 text-gray-800 dark:text-slate-200">{row.state || "—"}</td>
                <td className="px-2.5 py-2.5"><span className="flex items-center gap-2 whitespace-nowrap text-gray-800 dark:text-slate-200"><Initials name={row.agentName} />{row.agentName}</span></td>
                <td className="px-2.5 py-2.5"><NoticeChip notice={row.notice} nowMs={nowMs} busy={informing.has(row.id)} onInform={() => onInform([row.id])} /></td>
                <td className="px-2.5 py-2.5">
                  {row.lastLog
                    ? <span className="flex items-center gap-1.5 whitespace-nowrap text-gray-800 dark:text-slate-200"><ChannelIcon channels={row.lastLog.channels} />{lagosTime(row.lastLog.at)}</span>
                    : <span className="text-gray-400">—</span>}
                </td>
                <td className="px-2.5 py-2.5"><ResponsePill response={row.lastLog?.response} note={row.lastLog?.note} options={options} /></td>
                <td className="px-2.5 py-2.5"><Pill tone={STATUS_LOOK[row.status].tone}>{STATUS_LOOK[row.status].label}</Pill></td>
                <td className="px-2.5 py-2.5"><button type="button" onClick={() => onLog([row.id])} className={`${btn.outline} whitespace-nowrap`}>Log Follow-Up</button></td>
                <td className="relative px-2 py-2.5">
                  <button type="button" aria-label={`More for ${row.id}`} onClick={() => setMenuFor(menuFor === row.id ? null : row.id)} className="!min-h-0 rounded-md p-1 text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-4 w-4" /></button>
                  {menuFor === row.id && (
                    <div ref={menuRef} className="absolute right-2 top-9 z-20 w-52 rounded-xl border border-gray-200 bg-white p-1 text-[13px] shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      <button type="button" onClick={() => { setMenuFor(null); onHistory(row.id); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800">View follow-up history</button>
                      <button type="button" onClick={() => { setMenuFor(null); onOpenWaybills(); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800">Mark received (Waybills)</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[12.5px] text-gray-600 dark:text-slate-400">
        <span>Showing {filtered.length ? (current - 1) * pageSize + 1 : 0} – {Math.min(current * pageSize, filtered.length)} of {filtered.length}</span>
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <button type="button" aria-label="First page" disabled={current === 1} onClick={() => setPage(1)} className="!min-h-0 rounded-md border border-gray-200 p-1 disabled:opacity-40 dark:border-slate-700"><ChevronsLeft className="h-3.5 w-3.5" /></button>
            <button type="button" aria-label="Previous page" disabled={current === 1} onClick={() => setPage(current - 1)} className="!min-h-0 rounded-md p-1 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
            {numbers.map((number, index) => number < 0
              ? <span key={`gap-${index}`} className="px-1">…</span>
              : <button key={number} type="button" onClick={() => setPage(number)}
                  className={`!min-h-0 h-7 min-w-[28px] rounded-md px-1.5 font-semibold ${number === current ? "bg-[#2F5BEA] text-white" : "hover:bg-gray-100 dark:hover:bg-slate-800"}`}>{number}</button>)}
            <button type="button" aria-label="Next page" disabled={current === pages} onClick={() => setPage(current + 1)} className="!min-h-0 rounded-md border border-gray-200 p-1 disabled:opacity-40 dark:border-slate-700"><ChevronRight className="h-3.5 w-3.5" /></button>
          </span>
        )}
      </div>
    </div>
  );
}
