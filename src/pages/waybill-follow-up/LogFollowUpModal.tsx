import { useEffect, useMemo, useState } from "react";
import { Camera, Loader2, Search, X } from "lucide-react";
import { waybillFollowUpApi, type WfActiveRow, type WfDashboard } from "../../lib/api";
import { STATUS_LOOK, btn } from "./wf-ui";

type Props = {
  waybills: WfActiveRow[];
  preselected: string[];
  options: WfDashboard["options"];
  /** The session a log made now counts for (null = between sessions). */
  sessionLabel: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
};

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result ?? ""));
  reader.onerror = () => reject(new Error("Could not read the photo."));
  reader.readAsDataURL(file);
});

/**
 * Log Follow-Up (Bright's spec, 7 Nov 2026): a channel and what the agent said
 * are required; no reply is logged as "no response", never an invented
 * answer. One call can cover several waybills, but only the ones ticked.
 */
export default function LogFollowUpModal({ waybills, preselected, options, sessionLabel, onClose, onSaved }: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set(preselected));
  const [search, setSearch] = useState("");
  const [channels, setChannels] = useState<Set<string>>(new Set());
  const [response, setResponse] = useState("");
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [otherAction, setOtherAction] = useState("");
  const [photo, setPhoto] = useState<{ name: string; dataUrl: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = useMemo(() => waybills.filter((row) => picked.has(row.id)), [waybills, picked]);
  const single = chosen.length === 1 ? chosen[0] : null;
  const pickList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return waybills.filter((row) => !q || `${row.id} ${row.agentName} ${row.state}`.toLowerCase().includes(q));
  }, [waybills, search]);

  const toggle = (set: Set<string>, value: string) => { const next = new Set(set); if (next.has(value)) next.delete(value); else next.add(value); return next; };

  const save = async () => {
    setError("");
    if (chosen.length === 0) { setError("Choose at least one waybill."); return; }
    if (channels.size === 0) { setError("Tick how you reached the agent: WhatsApp group, phone call, or both."); return; }
    if (!response) { setError("Choose what the agent said. If there was no reply, choose a 'no response' answer."); return; }
    if (response === "other" && note.trim().length < 3) { setError("Write what the agent said."); return; }
    setSaving(true);
    try {
      const result = await waybillFollowUpApi.log({
        waybillIds: chosen.map((row) => row.id), channels: [...channels], response, responseNote: note.trim(),
        nextAction: nextAction === "Other" ? otherAction.trim() : nextAction, evidence: photo ? { dataUrl: photo.dataUrl } : null
      });
      onSaved(`Follow-up saved for ${result.logged} waybill${result.logged === 1 ? "" : "s"}${result.sessionLabel ? ` (${result.sessionLabel})` : " (between sessions: kept in the history)"}.`);
    } catch (err) {
      setError((err as Error).message || "Could not save the follow-up.");
    } finally {
      setSaving(false);
    }
  };

  const label = "block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300";
  const field = "mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13.5px] dark:border-slate-700 dark:bg-slate-900";

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Log follow-up" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[94vh] w-full max-w-[620px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Log Follow-Up</h2>
            <p className="m-0 mt-0.5 text-[13px] text-gray-500">
              Follow-up session: <b className={sessionLabel ? "text-[#5B3FD9]" : "text-amber-700"}>{sessionLabel ?? "between sessions"}</b>
              {!sessionLabel && " – saved in the history, but it does not count for a session."}
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 overflow-y-auto px-6 py-5">
          {single ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl bg-gray-50 px-4 py-3 text-[13px] dark:bg-slate-800/60">
              <span className="text-gray-500">Waybill</span><b className="text-gray-900 dark:text-slate-100">{single.id}</b>
              <span className="text-gray-500">Destination</span><span className="text-gray-900 dark:text-slate-100">{[single.city, single.state].filter(Boolean).join(", ") || "—"}</span>
              <span className="text-gray-500">Agent</span><span className="text-gray-900 dark:text-slate-100">{single.agentName}{single.agentPhone ? ` · ${single.agentPhone}` : ""}</span>
              <span className="text-gray-500">Current status</span><span className="text-gray-900 dark:text-slate-100">Awaiting receipt · {STATUS_LOOK[single.status].label.replace("✓ ", "")}</span>
            </div>
          ) : (
            <div>
              <span className={label}>Waybills this call or message covered ({chosen.length} ticked)</span>
              <span className="relative mt-1 block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search waybill, agent or state" className={`${field} !mt-0 pl-8`} />
              </span>
              <div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-100 p-2 dark:border-slate-800">
                {pickList.length === 0 && <p className="m-0 px-2 py-3 text-[13px] text-gray-500">No waybill is waiting for receipt.</p>}
                {pickList.map((row) => (
                  <label key={row.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={picked.has(row.id)} onChange={() => setPicked((value) => toggle(value, row.id))} />
                    <b className="text-gray-900 dark:text-slate-100">{row.id}</b><span className="text-gray-500">{row.state} · {row.agentName}</span>
                  </label>
                ))}
              </div>
              <p className="m-0 mt-1 text-[12px] text-gray-500">Tick only the waybills you actually discussed.</p>
            </div>
          )}

          <div>
            <span className={label}>How did you reach the agent?</span>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {options.channels.map((channel) => (
                <label key={channel.key} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13px] ${channels.has(channel.key) ? "border-[#5B3FD9] bg-[#F5F2FE] text-[#3F2AA8] dark:bg-violet-500/10 dark:text-violet-200" : "border-gray-200 dark:border-slate-700"}`}>
                  <input type="checkbox" checked={channels.has(channel.key)} onChange={() => setChannels((value) => toggle(value, channel.key))} />{channel.label}
                </label>
              ))}
            </div>
            <p className="m-0 mt-1 text-[12px] text-gray-500">Tick both for WhatsApp and a phone call.</p>
          </div>

          <label className="block">
            <span className={label}>What did the agent say?</span>
            <select value={response} onChange={(event) => setResponse(event.target.value)} className={field}>
              <option value="">Choose…</option>
              {options.responses.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className={label}>Agent's exact words {response === "other" ? "(needed)" : "(optional)"}</span>
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={1000} placeholder="e.g. Will receive by 2pm, the driver is on the way" className={field} />
          </label>

          <label className="block">
            <span className={label}>Next action (optional)</span>
            <select value={nextAction} onChange={(event) => setNextAction(event.target.value)} className={field}>
              <option value="">None</option>
              {options.nextActions.map((action) => <option key={action} value={action}>{action}</option>)}
              <option value="Other">Other…</option>
            </select>
            {nextAction === "Other" && <input value={otherAction} onChange={(event) => setOtherAction(event.target.value)} maxLength={300} placeholder="What happens next" className={field} />}
          </label>

          <div>
            <span className={label}>Evidence (optional)</span>
            <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2.5 text-[13px] text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
              <Camera className="h-4 w-4" />{photo ? photo.name : "Add a WhatsApp or call-log screenshot"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) { setError("That photo is over 10MB."); return; }
                try { setPhoto({ name: file.name, dataUrl: await readAsDataUrl(file) }); } catch (err) { setError((err as Error).message); }
              }} />
            </label>
            {photo && <button type="button" onClick={() => setPhoto(null)} className="!min-h-0 mt-1 text-[12px] font-semibold text-rose-600">Remove photo</button>}
          </div>

          {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">{error}</p>}
          <p className="m-0 text-[12px] text-gray-500">Your name, the time and the session are saved with the log. Logs cannot be changed or deleted.</p>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-800">
          <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
          <button type="button" disabled={saving} onClick={save} className={btn.primary}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Save Follow-Up Log</button>
        </div>
      </div>
    </div>
  );
}
