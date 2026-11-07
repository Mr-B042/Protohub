import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { waybillFollowUpApi, type WfReport, type WfSettings } from "../../lib/api";
import { Card, btn, naira, shortDate } from "./wf-ui";

const addDays = (key: string, days: number) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const sundayOf = (key: string) => addDays(key, -new Date(`${key}T12:00:00Z`).getUTCDay());
const todayKey = () => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 10);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Kpi({ label, value, target, bad }: { label: string; value: string; target: string; bad?: boolean }) {
  return (
    <Card className="p-4">
      <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">{label}</p>
      <b className={`text-[24px] ${bad ? "text-rose-600" : "text-gray-900 dark:text-slate-50"}`}>{value}</b>
      <p className="m-0 text-[12px] text-gray-500">Target: {target}</p>
    </Card>
  );
}

/** Reports & Settings: the week's follow-up discipline and shipment progress; the rules (Owner/Admin). */
export default function TabReports({ canEdit, onToast, onSaved }: { canEdit: boolean; onToast: (message: string) => void; onSaved: () => void }) {
  const [weekStart, setWeekStart] = useState(sundayOf(todayKey()));
  const [report, setReport] = useState<WfReport | null>(null);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<WfSettings | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [responsible, setResponsible] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setReport(null);
    waybillFollowUpApi.report(weekStart).then((result) => { if (live) setReport(result); }).catch((err: Error) => { if (live) setError(err.message || "Could not load the report."); });
    return () => { live = false; };
  }, [weekStart]);
  const loadSettings = useCallback(() => {
    waybillFollowUpApi.settings().then((result) => { setSettings(result.settings); setPeople(result.people); setResponsible(result.responsible); }).catch(() => {});
  }, []);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      await waybillFollowUpApi.saveSettings(settings);
      onToast("Settings saved.");
      loadSettings();
      onSaved();
    } catch (err) { onToast((err as Error).message || "Could not save."); } finally { setSaving(false); }
  };

  const k = report?.kpis;
  const field = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13.5px] disabled:bg-gray-50 dark:border-slate-700 dark:bg-slate-900";
  const th = "px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 mr-auto text-[18px] font-bold text-gray-900 dark:text-slate-50">Weekly report · {shortDate(weekStart)} – {shortDate(addDays(weekStart, 6))}</h3>
        <button type="button" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))} className={btn.ghost}><ChevronLeft className="h-4 w-4" /></button>
        <button type="button" onClick={() => setWeekStart(sundayOf(todayKey()))} className={btn.soft}>This week</button>
        <button type="button" aria-label="Next week" disabled={weekStart >= sundayOf(todayKey())} onClick={() => setWeekStart(addDays(weekStart, 7))} className={btn.ghost}><ChevronRight className="h-4 w-4" /></button>
      </div>
      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
      {!report && !error && <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
      {k && report && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Follow-Up Compliance" value={k.compliance === null ? "—" : `${k.compliance}%`} target="100%" bad={k.compliance !== null && k.compliance < 100} />
            <Kpi label="Missed Follow-Ups" value={`${k.missedFollowUps} · ${naira(k.charged)}`} target="0" bad={k.missedFollowUps > 0} />
            <Kpi label="Waybills Without Updates (24h)" value={String(k.withoutUpdates)} target="0" bad={k.withoutUpdates > 0} />
            <Kpi label="Agent Response Rate" value={k.responseRate === null ? "—" : `${k.responseRate}%`} target="90%+" bad={k.responseRate !== null && k.responseRate < 90} />
            <Kpi label="Overdue Waybills" value={String(k.overdue)} target="as few as possible" bad={k.overdue > 0} />
            <Kpi label="Received This Week" value={String(k.received)} target="—" />
            <Kpi label="Days to Receive (average)" value={k.averageDaysToReceive === null ? "—" : `${k.averageDaysToReceive}`} target="as short as possible" />
            <Kpi label="Missed Sessions" value={String(k.missedSessions)} target="0" bad={k.missedSessions > 0} />
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="!min-w-[640px] w-full border-collapse text-[13px]">
                <thead className="bg-gray-50 dark:bg-slate-800/60"><tr><th className={th}>Day</th><th className={th}>Sessions</th><th className={th}>Follow-ups owed</th><th className={th}>Logged</th><th className={th}>Compliance</th><th className={th}>Missed</th><th className={th}>Charged</th></tr></thead>
                <tbody>
                  {report.days.map((day) => (
                    <tr key={day.date} className="border-b border-gray-100 last:border-0 dark:border-slate-800 [&>td]:[color:inherit]">
                      <td className="px-3 py-2.5 font-semibold text-gray-900 dark:text-slate-100">{shortDate(day.date)}{!day.workingDay && <span className="ml-1 text-[11.5px] font-normal text-gray-500">day off</span>}</td>
                      <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{day.sessions}{day.missedSessions ? <span className="text-rose-600"> ({day.missedSessions} missed)</span> : ""}</td>
                      <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{day.owed}</td>
                      <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{day.logged}</td>
                      <td className="px-3 py-2.5 text-gray-800 dark:text-slate-200">{day.compliance === null ? "—" : `${day.compliance}%`}</td>
                      <td className={`px-3 py-2.5 ${day.missed ? "text-rose-600" : "text-gray-800 dark:text-slate-200"}`}>{day.missed}</td>
                      <td className={`px-3 py-2.5 ${day.charged ? "font-semibold text-rose-600" : "text-gray-800 dark:text-slate-200"}`}>{naira(day.charged)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <Card className="p-5">
        <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Settings</h3>
        <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">
          The day a waybill is made, tick that the agent's group was told within the minutes set below (8:00 AM the next working day when it is made after 5 PM, before 8 AM or on a day off).
          From the next working day it is followed up five times a day until it is marked Received: 8:00, 10:00, 12:00 and 2:00 (each from the grace minutes before to the grace minutes after) and once by 5 PM (from the grace minutes before 4).
          {canEdit ? "" : " Only the Owner or an Admin can change these."}
        </p>
        {!settings ? <p className="m-0 mt-3 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p> : (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Responsible for follow-ups (charged)
              <select disabled={!canEdit} value={settings.responsibleUserId ?? ""} onChange={(event) => setSettings({ ...settings, responsibleUserId: event.target.value || null })} className={field}>
                <option value="">{`Automatic: the Inventory & Logistics user${responsible && !settings.responsibleUserId ? ` (${responsible.name})` : ""}`}</option>
                {people.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}
              </select>
              {!responsible && <span className="mt-1 block text-[12px] font-normal text-amber-700">Nobody is responsible right now: misses are recorded but not charged.</span>}
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Charge per waybill per missed session (₦)
              <input type="number" min={0} step={50} disabled={!canEdit} value={settings.amount} onChange={(event) => setSettings({ ...settings, amount: Number(event.target.value) || 0 })} className={field} />
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Grace minutes (before and after each time)
              <input type="number" min={0} max={45} disabled={!canEdit} value={settings.graceMinutes} onChange={(event) => setSettings({ ...settings, graceMinutes: Number(event.target.value) || 0 })} className={field} />
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Charges start on
              <input type="date" disabled={!canEdit} value={settings.chargesFrom} onChange={(event) => setSettings({ ...settings, chargesFrom: event.target.value })} className={field} />
              <span className="mt-1 block text-[12px] font-normal text-gray-500">Before this day, missed follow-ups show on the schedule and report, but nothing is charged.</span>
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Tell the agent's group within (minutes)
              <input type="number" min={15} max={240} step={5} disabled={!canEdit} value={settings.noticeMinutes} onChange={(event) => setSettings({ ...settings, noticeMinutes: Number(event.target.value) || 60 })} className={field} />
              <span className="mt-1 block text-[12px] font-normal text-gray-500">From when the waybill is made. Ticked late or not at all costs the amount below.</span>
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Charge for a late notice, per waybill (₦)
              <input type="number" min={0} step={50} disabled={!canEdit} value={settings.noticeAmount} onChange={(event) => setSettings({ ...settings, noticeAmount: Number(event.target.value) || 0 })} className={field} />
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Overdue after (days on the road)
              <input type="number" min={1} max={30} disabled={!canEdit} value={settings.overdueAfterDays} onChange={(event) => setSettings({ ...settings, overdueAfterDays: Number(event.target.value) || 1 })} className={field} />
            </label>
            <div className="text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">Working days
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DAYS.map((name, day) => (
                  <label key={name} className={`flex items-center gap-1 rounded-lg border px-2 py-1 font-normal ${settings.workingDays.includes(day) ? "border-[#5B3FD9] bg-[#F5F2FE] text-[#3F2AA8]" : "border-gray-200 text-gray-600 dark:border-slate-700"}`}>
                    <input type="checkbox" disabled={!canEdit} checked={settings.workingDays.includes(day)} onChange={() => setSettings({ ...settings, workingDays: settings.workingDays.includes(day) ? settings.workingDays.filter((value) => value !== day) : [...settings.workingDays, day].sort() })} />{name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
        {canEdit && settings && <div className="mt-4 flex justify-end"><button type="button" disabled={saving} onClick={save} className={btn.primary}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save settings</button></div>}
      </Card>
    </div>
  );
}
