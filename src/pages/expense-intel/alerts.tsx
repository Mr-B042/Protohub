import { useState } from "react";
import { AlertTriangle, ChevronRight, CircleAlert, Info, RotateCcw } from "lucide-react";
import { expenseIntelApi } from "../../lib/api";
import type { TabProps } from "./context";
import type { Alert } from "./model";
import { Modal, Pill, btn, select } from "./ui";

/** Smart Cost Alerts / Cost Leak Detections: one list, with View, Assign, Resolve, Dismiss. */

const TONE: Record<Alert["level"], { row: string; icon: string; I: typeof AlertTriangle; word: string }> = {
  critical: { row: "bg-rose-50/70 dark:bg-rose-500/10", icon: "text-rose-600", I: AlertTriangle, word: "Critical" },
  high: { row: "bg-orange-50/60 dark:bg-orange-500/10", icon: "text-orange-500", I: CircleAlert, word: "High" },
  medium: { row: "bg-amber-50/50 dark:bg-amber-500/10", icon: "text-amber-500", I: Info, word: "Medium" }
};

export function AlertRow({ a, onOpen, assigned }: { a: Alert; onOpen: () => void; assigned?: string | null }) {
  const t = TONE[a.level];
  return (
    <button type="button" onClick={onOpen} className={`!min-h-0 flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left ${t.row}`}>
      <t.I className={`mt-0.5 h-5 w-5 shrink-0 ${t.icon}`} />
      <span className="min-w-0 flex-1">
        <b className="block text-[13px] text-gray-900 dark:text-slate-50">{a.title}</b>
        <span className="block text-[12px] text-gray-600 dark:text-slate-300">{a.detail}</span>
        {assigned && <span className="mt-0.5 block text-[11.5px] font-semibold text-violet-700 dark:text-violet-300">Assigned to {assigned}</span>}
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
    </button>
  );
}

export function AlertsModal({ p, open, closed, actionOf, onClose, startKey }: {
  p: TabProps; open: Alert[]; closed: Alert[]; actionOf: (key: string) => { action: string; assignedToName: string | null; byName: string } | null; onClose: () => void; startKey?: string | null;
}) {
  const [focus, setFocus] = useState<string | null>(startKey ?? null);
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (key: string, action: "resolved" | "dismissed" | "assigned" | "reopen", who?: string) => {
    setBusy(true);
    try { await expenseIntelApi.alertAction(key, action, who); p.reload(); p.ctx.toast(action === "reopen" ? "Alert opened again." : action === "assigned" ? "Assigned." : `Alert ${action}.`); }
    catch (e: any) { p.ctx.toast(e?.message ?? "Could not save."); } finally { setBusy(false); }
  };
  const people = p.state.people.filter((x) => ["Owner", "Admin", "Manager", "Accountant"].includes(x.role));
  return (
    <Modal wide title="Cost alerts" sub="Worked out from this branch's own expenses and orders for the month. Resolve or dismiss when handled." onClose={onClose}>
      {open.length === 0 && <p className="m-0 rounded-xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">No open alerts this month.</p>}
      <ul className="m-0 list-none space-y-2 p-0">
        {open.map((a) => {
          const act = actionOf(a.key);
          return (
            <li key={a.key} className={`rounded-xl border p-3 ${focus === a.key ? "border-[#2F6BFF]" : "border-gray-200 dark:border-slate-700"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0"><b className="text-[13.5px] text-gray-900 dark:text-slate-50">{a.title}</b> <Pill tone={a.level === "critical" ? "red" : a.level === "high" ? "orange" : "amber"}>{TONE[a.level].word}</Pill>
                  <span className="block text-[12.5px] text-gray-600 dark:text-slate-300">{a.detail}</span>
                  {act?.action === "assigned" && <span className="block text-[11.5px] font-semibold text-violet-700">Assigned to {act.assignedToName} by {act.byName}</span>}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className={btn.outline} onClick={() => { onClose(); p.go(a.tab as any); }}>View Analysis</button>
                <select className={select} value={focus === a.key ? assignee : ""} onChange={(e) => { setFocus(a.key); setAssignee(e.target.value); }} aria-label="Assign to">
                  <option value="">Assign to…</option>{people.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.role})</option>)}
                </select>
                {focus === a.key && assignee && <button type="button" disabled={busy} className={btn.outline} onClick={() => void run(a.key, "assigned", assignee)}>Assign</button>}
                <button type="button" disabled={busy} className={btn.primary} onClick={() => void run(a.key, "resolved")}>Resolve</button>
                <button type="button" disabled={busy} className={btn.outline} onClick={() => void run(a.key, "dismissed")}>Dismiss</button>
              </div>
            </li>
          );
        })}
      </ul>
      {closed.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[12.5px] font-bold text-gray-600">Handled this month ({closed.length})</summary>
          <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
            {closed.map((a) => { const act = actionOf(a.key); return (
              <li key={a.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] dark:bg-slate-800">
                <span className="text-gray-800 dark:text-slate-200"><b>{a.title}</b> · {act?.action} by {act?.byName}</span>
                <button type="button" disabled={busy} className={btn.link} onClick={() => void run(a.key, "reopen")}><RotateCcw className="h-3.5 w-3.5" />Open again</button>
              </li>
            ); })}
          </ul>
        </details>
      )}
    </Modal>
  );
}
