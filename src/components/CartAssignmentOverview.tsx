import { useState } from "react";
import { Check, Clock3, RefreshCw, Settings, Timer, Users, Inbox, ArrowRight } from "lucide-react";
import type { CartAssignmentPanel } from "../lib/api";

type Props = {
  panel: CartAssignmentPanel;
  onEditRules: () => void;
  onManageOrder: () => void;
  onToggle: (enabled: boolean) => void;
  saving: boolean;
  relativeTime: (value?: string | null) => string;
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

export function CartAssignmentOverview({ panel, onEditRules, onManageOrder, onToggle, saving, relativeTime }: Props) {
  const [showAllAssignments, setShowAllAssignments] = useState(false);
  const [showAllWorkload, setShowAllWorkload] = useState(false);
  const workloadScale = Math.max(5, ...panel.reps.map((rep) => rep.openCarts));
  const workloadRows = showAllWorkload ? panel.reps : panel.reps.slice(0, 4);
  const assignmentRows = showAllAssignments ? panel.recentAssignments : panel.recentAssignments.slice(0, 4);
  const cardClass = "rounded-xl border border-[#e7edf7] bg-white px-4 py-4 shadow-[0_6px_24px_rgba(37,65,112,0.04)]";
  const headingClass = "m-0 text-sm font-bold leading-tight tracking-tight";

  return (
    <div className="space-y-3 text-[#172543]">
      <section className={cardClass} aria-label="Automatic assignment status">
        <div className="flex items-center justify-between gap-2">
          <h2 className={headingClass}>Automatic Assignment Status</h2>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[9px] font-bold uppercase ${panel.active ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-600"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${panel.active ? "bg-emerald-600" : "bg-slate-400"}`} />{panel.active ? "Active" : "Paused"}
          </span>
        </div>

        <div className="mt-5 space-y-3 text-[13px]">
          <div className="flex items-center gap-3">
            <Settings className="h-4 w-4 shrink-0 text-[#253e70]" aria-hidden="true" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="font-medium">Round-Robin Mode</div>
              <div className="mt-0.5 text-xs text-[#637393]">Turn-based rotation</div>
            </div>
            {panel.canEditRules && (
              <button type="button" role="switch" aria-label="Automatic assignment" aria-checked={panel.active} disabled={saving}
                onClick={() => onToggle(!panel.active)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50 ${panel.active ? "bg-emerald-600" : "bg-slate-300"}`}>
                <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${panel.active ? "left-6" : "left-1"}`} />
              </button>
            )}
          </div>
          {[
            { icon: Users, label: "Eligible Reps", value: `${panel.eligibleReps} / ${panel.totalReps}` },
            { icon: Inbox, label: "Unassigned Carts", value: String(panel.unassignedCarts) },
            { icon: Clock3, label: "Assignment Delay", value: `${panel.assignmentDelayMinutes} minutes` },
            { icon: Timer, label: "Contact SLA", value: `${panel.contactSlaMinutes} minutes` }
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-center gap-3">
              <Icon className="h-4 w-4 shrink-0 text-[#253e70]" aria-hidden="true" />
              <span className="min-w-0 flex-1">{label}</span>
              <strong className="text-right font-semibold">{value}</strong>
            </div>
          ))}
        </div>
        {panel.active && !panel.windowOpenNow && <p className="mb-0 mt-4 text-[11px] text-amber-700">Assignment resumes during working hours.</p>}
        {panel.canEditRules && (
          <button type="button" onClick={onEditRules} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-[#cbd8ef] px-3 py-2 text-xs font-semibold text-[#172543] transition-colors hover:bg-[#f5f8ff]">
            <Settings className="h-4 w-4" aria-hidden="true" />Edit Assignment Rules
          </button>
        )}
      </section>

      <section className={cardClass} aria-label="Round-robin order">
        <div className="flex items-center justify-between gap-2">
          <h2 className={headingClass}>Round-Robin Order</h2>
          <button type="button" onClick={onManageOrder} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#cbd8ef] px-2 py-1.5 text-[11px] font-medium hover:bg-[#f5f8ff]">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />Manage order
          </button>
        </div>
        <ol className="m-0 mt-4 list-none space-y-2 p-0">
          {panel.reps.map((rep, index) => (
            <li key={rep.id} className="flex min-w-0 items-center gap-2 text-xs">
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-bold ${rep.isNext ? "bg-emerald-100 text-emerald-800" : index % 2 ? "bg-emerald-50 text-[#172543]" : "bg-[#edf3fb] text-[#172543]"}`}>{index + 1}</span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#dce7f7] text-[10px] font-bold text-[#284576]" aria-hidden="true">{initials(rep.name)}</span>
              <span className={`min-w-0 truncate ${rep.isNext ? "font-semibold" : "font-medium"}`}>{rep.name}</span>
              {rep.isNext && <span className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-emerald-700"><ArrowRight className="h-3.5 w-3.5" />Next</span>}
              <span className="ml-auto shrink-0 text-right text-[11px] text-[#637393]">{rep.openCarts} active</span>
            </li>
          ))}
          {panel.reps.length === 0 && <li className="text-sm text-amber-700">No eligible reps are in the rotation.</li>}
        </ol>
        <p className="mb-0 mt-4 text-center text-[11px] text-[#637393]">Rotates automatically through eligible reps</p>
      </section>

      <section className={cardClass} aria-label="Rep workload">
        <div className="flex items-center justify-between gap-3">
          <h2 className={headingClass}>Rep Workload (Live)</h2>
          {panel.reps.length > 4 && <button type="button" className="text-xs font-medium text-[#245ee2] hover:underline" onClick={() => setShowAllWorkload((value) => !value)}>{showAllWorkload ? "Show Less" : "View All"}</button>}
        </div>
        <ul className="m-0 mt-4 list-none space-y-3 p-0">
          {workloadRows.map((rep) => (
            <li key={rep.id} className="flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#dce7f7] text-[10px] font-bold text-[#284576]" aria-hidden="true">{initials(rep.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 truncate text-xs font-medium">{rep.name}</div>
                <div className="h-1.5 rounded-full bg-[#e5eaf2]" role="progressbar" aria-label={`${rep.name} active carts`} aria-valuenow={rep.openCarts} aria-valuemin={0} aria-valuemax={workloadScale}>
                  <div className="h-full rounded-full bg-[#2468e8]" style={{ width: `${Math.min(100, rep.openCarts / workloadScale * 100)}%` }} />
                </div>
              </div>
              <span className="w-5 shrink-0 text-right text-xs text-[#637393]">{rep.openCarts}</span>
              {panel.showsPresence && <span className="w-[50px] shrink-0 text-right text-[10px] text-[#637393]"><span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${rep.online ? "bg-emerald-600" : "bg-slate-400"}`} />{rep.online ? "Online" : "Away"}</span>}
            </li>
          ))}
          {panel.reps.length === 0 && <li className="text-sm text-[#637393]">No rep workload to show.</li>}
        </ul>
      </section>

      <section className={cardClass} aria-label="Recent assignments">
        <div className="flex items-center justify-between gap-3">
          <h2 className={headingClass}>Recent Assignments</h2>
          {panel.recentAssignments.length > 4 && <button type="button" className="text-xs font-medium text-[#245ee2] hover:underline" onClick={() => setShowAllAssignments((value) => !value)}>{showAllAssignments ? "Show Less" : "View More"}</button>}
        </div>
        <ul className="m-0 mt-4 list-none space-y-3 p-0">
          {assignmentRows.map((row) => (
            <li key={`${row.cartId}-${row.assignedAt}`} className="flex min-w-0 items-center gap-2 text-xs">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><Check className="h-3 w-3" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1 truncate">{row.cartId} <span className="px-1 text-[#637393]">→</span> {row.repName || "Unknown rep"}</span>
              <span className="shrink-0 text-[11px] text-[#637393]">{relativeTime(row.assignedAt)}</span>
            </li>
          ))}
          {panel.recentAssignments.length === 0 && <li className="text-sm text-[#637393]">No recent assignments yet.</li>}
        </ul>
      </section>
    </div>
  );
}
