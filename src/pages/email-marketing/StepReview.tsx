import { useState } from "react";
import {
  AlertTriangle, BarChart3, CalendarDays, CheckCircle2, ChevronRight, Clock, ClipboardList, Coins, Eye, LogOut, Mail, MailOpen, Monitor, MousePointerClick, PenLine,
  RefreshCw, ShoppingCart, Smartphone, Target, Users, XCircle
} from "lucide-react";
import type { EmDesigner, EmPlanning } from "../../lib/api";
import EmailFrame from "./EmailFrame";
import { Card, naira } from "./em-ui";
import { delayText, goalLabel, sendSummary, type Draft } from "./wizard-model";

/** Step 5, Review & Launch (image 48). */

export type Check = { key: string; label: string; state: "ok" | "warn" | "bad" | "checking"; note?: string; step: number };

export default function StepReview({ draft, designer, audienceText, planning, checks, onGoTo }: {
  draft: Draft;
  designer: EmDesigner | null;
  audienceText: string;
  planning: EmPlanning | null;
  checks: Check[];
  onGoTo: (step: number) => void;
}) {
  const [mobile, setMobile] = useState(false);
  const d = draft.delivery;
  const auto = d.automation;
  const presetName = auto?.preset ? designer?.presets.find((row) => row.key === auto.preset)?.name : null;
  const rows: Array<{ icon: typeof Mail; label: string; value: React.ReactNode }> = [
    { icon: PenLine, label: "Campaign Name", value: draft.name || "—" },
    { icon: Target, label: "Goal", value: <span className="inline-flex rounded-md bg-[#EEEBFC] px-2 py-0.5 text-[13px] font-semibold text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-200">{goalLabel(draft.goal)}</span> },
    { icon: Users, label: "Audience", value: audienceText },
    { icon: Mail, label: "Email Subject", value: <>{draft.subject || "—"}{draft.options.abTest && draft.subjectB ? <span className="block text-[12.5px] text-gray-500">B: {draft.subjectB}</span> : null}</> },
    { icon: CalendarDays, label: "Send Time", value: sendSummary(draft) },
    { icon: RefreshCw, label: "Type", value: d.type === "automation" ? `Automation${presetName ? ` (${presetName})` : ""}` : d.type === "recurring" ? `Recurring, every ${d.repeat?.every ?? "week"}` : "One-Time Campaign" },
    ...(d.type === "automation" && auto ? [
      { icon: Clock, label: auto.trigger === "inactive" ? "Quiet For" : "Delay", value: auto.trigger === "inactive" ? `${auto.inactiveDays ?? 60} days with no delivery` : `After ${delayText(auto.delayHours).toLowerCase()}` },
      { icon: LogOut, label: "Exit Condition", value: auto.exit === "purchased" ? "After customer makes another purchase" : "Never stop early" }
    ] : [])
  ];
  const est = planning?.estimate;
  const range = (low: number, high: number) => `${Math.round(low * 100)}% – ${Math.round(high * 100)}%`;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.95fr)]">
      <Card className="p-4">
        <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><ClipboardList className="h-5 w-5 text-[#5B3FD9]" />Campaign Summary</h3>
        <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-800">
          {rows.map(({ icon: Icon, label, value }) => (
            <div key={label} className="flex items-start gap-3 py-2.5">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#5B3FD9]" />
              <div className="min-w-0"><div className="text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{label}</div><div className="text-[13.5px] text-gray-700 dark:text-slate-300">{value}</div></div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><Eye className="h-5 w-5 text-[#5B3FD9]" />Email Preview</h3>
          <div className="inline-flex overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
            <button type="button" onClick={() => setMobile(false)} className={`!min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold ${!mobile ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-700 dark:bg-slate-900 dark:text-slate-300"}`}><Monitor className="h-4 w-4" />Desktop</button>
            <button type="button" onClick={() => setMobile(true)} className={`!min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold ${mobile ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-700 dark:bg-slate-900 dark:text-slate-300"}`}><Smartphone className="h-4 w-4" />Mobile</button>
          </div>
        </div>
        <div className="mt-3 max-h-[560px] overflow-y-auto rounded-xl bg-[#F4F2FB] dark:bg-slate-950">
          <EmailFrame design={draft.design} mobile={mobile} preheader={draft.preheader} brand={designer?.sender.fromName} footerNote={designer?.settings.footerNote} fit minHeight={480} />
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><BarChart3 className="h-5 w-5 text-[#5B3FD9]" />Estimated Performance</h3>
          <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-800">
            {[
              { icon: MailOpen, label: "Open Rate", value: est ? range(est.open.low, est.open.high) : null },
              { icon: MousePointerClick, label: "Click Rate", value: est ? range(est.click.low, est.click.high) : null },
              { icon: ShoppingCart, label: "Conversion Rate", value: est ? range(est.conversion.low, est.conversion.high) : null },
              { icon: Coins, label: "Est. Revenue", value: est ? `${naira(est.revenue.low)} – ${naira(est.revenue.high)}` : null }
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 py-2.5">
                <Icon className="h-5 w-5 text-[#5B3FD9]" />
                <span className="flex-1 text-[13.5px] font-semibold text-gray-800 dark:text-slate-200">{label}</span>
                {value ? <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[13px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">{value}</span> : <span className="text-[12.5px] text-gray-400">After 3 campaigns</span>}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="m-0 flex items-center gap-2 text-[17px] font-bold text-gray-900 dark:text-slate-50"><ClipboardList className="h-5 w-5 text-[#5B3FD9]" />Pre-Launch Checklist</h3>
          <div className="mt-2 divide-y divide-gray-100 dark:divide-slate-800">
            {checks.map((check) => (
              <button key={check.key} type="button" onClick={() => onGoTo(check.step)} className="!min-h-0 flex w-full items-center gap-3 py-2.5 text-left">
                {check.state === "ok" ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : check.state === "bad" ? <XCircle className="h-5 w-5 shrink-0 text-rose-600" /> : check.state === "checking" ? <RefreshCw className="h-5 w-5 shrink-0 animate-spin text-gray-400" /> : <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />}
                <span className="min-w-0 flex-1"><span className="block text-[13.5px] text-gray-800 dark:text-slate-200">{check.label}</span>{check.note && <span className="block text-[12px] text-gray-500">{check.note}</span>}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
