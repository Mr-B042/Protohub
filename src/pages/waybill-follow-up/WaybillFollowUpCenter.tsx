import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ClipboardList, History, Home, Loader2, Plus, RefreshCw, Settings, ShieldCheck, Truck } from "lucide-react";
import { waybillFollowUpApi, type WfDashboard } from "../../lib/api";
import LogFollowUpModal from "./LogFollowUpModal";
import TabDashboard from "./TabDashboard";
import TabHistory from "./TabHistory";
import TabMisses from "./TabMisses";
import TabReports from "./TabReports";
import WaybillTable from "./WaybillTable";
import WaybillLogsModal from "./WaybillLogsModal";
import { SessionTimer, useLiveNow } from "./Timers";
import { Card, IconTile, btn, longDate, type WfTab } from "./wf-ui";

const lagosToday = () => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 10);

const TABS: Array<{ key: WfTab; label: string; Icon: typeof Home }> = [
  { key: "dashboard", label: "Follow-Up Dashboard", Icon: Home },
  { key: "waybills", label: "Active Waybills", Icon: ClipboardList },
  { key: "history", label: "Follow-Up History", Icon: History },
  { key: "misses", label: "Missed Logs & Charges", Icon: ShieldCheck },
  { key: "reports", label: "Reports & Settings", Icon: Settings }
];

/**
 * Waybill Follow-Up Center (Bright, 7 Nov 2026), under Inventory & Logistics
 * Operations. The Follow-Up Dashboard is built to Bright's design; the other
 * four tabs follow it (his choice). Every waybill still In Transit is
 * followed up five times a working day until it is marked Received.
 */
export default function WaybillFollowUpCenter({ currentRole, onToast, onOpenWaybills }: { currentRole: string; onToast: (message: string) => void; onOpenWaybills: () => void }) {
  const [tab, setTab] = useState<WfTab>("dashboard");
  const [date, setDate] = useState(lagosToday());
  const [data, setData] = useState<WfDashboard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const nowMs = useLiveNow(data?.nowMs);
  const [logFor, setLogFor] = useState<string[] | null>(null);
  const [informing, setInforming] = useState<Set<string>>(new Set());
  const [historyWaybill, setHistoryWaybill] = useState("");
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const dateInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setData(await waybillFollowUpApi.dashboard(date));
      setError("");
    } catch (err) {
      setError((err as Error).message || "Could not load the Follow-Up Center.");
    } finally {
      setLoading(false);
    }
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  // The timers tick every second (useLiveNow); the numbers refresh every minute.
  useEffect(() => {
    const refresh = window.setInterval(() => { void load(true); }, 60_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  // One waybill opens its own log window (Bright, 12 Nov 2026); "View All" still opens the History tab.
  const openHistory = (waybillId = "") => {
    if (waybillId && data?.waybills.some((row) => row.id === waybillId)) { setLogsFor(waybillId); return; }
    setHistoryWaybill(waybillId); setTab("history");
  };
  const logsRow = logsFor ? data?.waybills.find((row) => row.id === logsFor) ?? null : null;
  // "I've informed the agent's group" (Bright, 7 Nov 2026): the server keeps the time.
  const inform = async (ids: string[]) => {
    setInforming((current) => new Set([...current, ...ids]));
    try {
      const result = await waybillFollowUpApi.inform(ids);
      onToast(result.late.length
        ? `Ticked, but late for ${result.late.join(", ")}: the late notice is charged.`
        : `Agent's group told for ${ids.length === 1 ? ids[0] : `${ids.length} waybills`}. On time.`);
      await load(true);
    } catch (err) {
      onToast((err as Error).message || "Could not save the tick.");
    } finally {
      setInforming((current) => new Set([...current].filter((id) => !ids.includes(id))));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Truck className="h-7 w-7" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Waybill Follow-Up Center</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Track, follow up and ensure all waybills are received on time.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && <SessionTimer sessions={data.sessions} nowMs={nowMs} isToday={data.date === data.today} workingDay={data.workingDay} />}
          <span className="relative">
            <button type="button" onClick={() => dateInput.current?.showPicker?.()} className={`${btn.ghost} min-w-[200px] justify-between`}>
              <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4" />{longDate(date)}</span><ChevronDown className="h-4 w-4" />
            </button>
            <input ref={dateInput} type="date" value={date} max={lagosToday()} onChange={(event) => event.target.value && setDate(event.target.value)} aria-label="Choose a day"
              className="pointer-events-none absolute inset-0 opacity-0" tabIndex={-1} />
          </span>
          <button type="button" onClick={() => setDate(lagosToday())} className={btn.soft}>Today</button>
          <button type="button" aria-label="Refresh" onClick={() => void load()} className={btn.ghost}><RefreshCw className={`h-4 w-4 text-[#5B3FD9] ${loading ? "animate-spin" : ""}`} /></button>
          <button type="button" disabled={!data} onClick={() => setLogFor([])} className={btn.primary}><Plus className="h-4 w-4" />Log Follow-Up</button>
        </div>
      </div>

      <nav className="grid grid-cols-2 gap-1 rounded-2xl border border-gray-200/80 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3 lg:grid-cols-5" aria-label="Waybill Follow-Up Center sections">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}
            className={`!min-h-0 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[14px] font-semibold ${tab === key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            <Icon className="h-4 w-4" />{label}
            {key === "waybills" && data && <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${tab === key ? "bg-white/25 text-white" : "bg-[#2F5BEA] text-white"}`}>{data.waybills.length}</span>}
          </button>
        ))}
      </nav>

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
      {!data && !error && <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}

      {data && tab === "dashboard" && <TabDashboard data={data} nowMs={nowMs} onLog={(ids) => setLogFor(ids)} onHistory={openHistory} onOpenWaybills={onOpenWaybills} onInform={inform} informing={informing} />}
      {data && tab === "waybills" && (
        <Card className="overflow-hidden">
          <div className="flex items-start gap-3 px-5 pt-4">
            <IconTile><ClipboardList className="h-5 w-5" /></IconTile>
            <div>
              <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Active Waybills ({data.waybills.length})</h3>
              <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Every waybill still In Transit. It leaves this list when it is marked Received. Tick several to log one call or WhatsApp message for all of them.</p>
            </div>
          </div>
          <WaybillTable rows={data.waybills} options={data.options.responses} pageSize={20} onLog={(ids) => setLogFor(ids)} onHistory={openHistory} onOpenWaybills={onOpenWaybills}
            nowMs={nowMs} onInform={inform} informing={informing} />
        </Card>
      )}
      {data && tab === "history" && <TabHistory options={data.options.responses} waybill={historyWaybill} onToast={onToast} />}
      {tab === "misses" && <TabMisses currentRole={currentRole} onToast={onToast} onChanged={() => void load(true)} />}
      {tab === "reports" && <TabReports canEdit={currentRole === "Owner" || currentRole === "Admin"} onToast={onToast} onSaved={() => void load(true)} />}

      {logsRow && data && (
        <WaybillLogsModal row={logsRow} options={data.options.responses} onToast={onToast} onClose={() => setLogsFor(null)}
          onLog={() => { setLogsFor(null); setLogFor([logsRow.id]); }} onOpenWaybills={() => { setLogsFor(null); onOpenWaybills(); }} />
      )}
      {logFor && data && (
        <LogFollowUpModal waybills={data.waybills} preselected={logFor} options={data.options} graceMinutes={data.settings.graceMinutes} workingDays={data.settings.workingDays}
          onClose={() => setLogFor(null)} onSaved={(message) => { setLogFor(null); onToast(message); void load(true); }} />
      )}
    </div>
  );
}
