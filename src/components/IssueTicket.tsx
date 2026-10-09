import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CheckCircle2, Image as ImageIcon, Lock, MessageSquare, Send, Users, XCircle } from "lucide-react";
import { bugReportsApi, type BugReport, type BugReportEvent, type BugReportStatus, type IssuePriority } from "../lib/api";
import {
  AFFECTED_LABEL, AWAITING, FREQUENCY_LABEL, IMPACT_LABEL, IMPACT_TONE, KIND_LABEL, PRIORITY_TONE, REF_LABEL, STATUS_LABEL, STATUS_TONE,
  fileSize, stamp, stepsFor
} from "../lib/issue-labels";

/**
 * One ticket (Issue Management, Bright, 9 Oct 2026), for the reporter (My
 * Reports) and for the technical team (Issue Management). The team also sees
 * Technical Data and Internal Notes, and can change status, priority,
 * assignee and duplicates. The reporter can reply, and confirm a fix.
 */

type Tab = "Overview" | "Attachments" | "Steps to Reproduce" | "Technical Data" | "Activity" | "Internal Notes";
type Props = {
  id: string;
  mode: "reporter" | "team";
  team?: Array<{ id: string; name: string; role: string }>;
  showToast: (message: string) => void;
  onBack: () => void;
  onChanged?: (report: BugReport) => void;
};

const card = "rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900";
const field = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

export function StatusBadge({ status }: { status: BugReportStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}
export function PriorityBadge({ priority }: { priority: IssuePriority | null }) {
  return priority ? <span className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-black ${PRIORITY_TONE[priority]}`}>{priority}</span> : <span className="text-gray-400">—</span>;
}

export default function IssueTicket({ id, mode, team = [], showToast, onBack, onChanged }: Props) {
  const isTeam = mode === "team";
  const [data, setData] = useState<{ report: BugReport; events: BugReportEvent[] } | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState(false);
  const [statusNote, setStatusNote] = useState("");
  const [duplicate, setDuplicate] = useState("");
  const [verifyComment, setVerifyComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => bugReportsApi.get(id).then((value) => { setData(value); onChanged?.(value.report); }).catch((err: any) => showToast(err?.message ?? "Could not load the ticket."));
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await job(); await load(); if (done) showToast(done); }
    catch (err: any) { showToast(err?.message ?? "That didn't save."); }
    finally { setBusy(false); }
  };
  const openFile = async (path: string) => {
    try { const { url } = await bugReportsApi.fileUrl(id, path); window.open(url, "_blank", "noopener"); }
    catch (err: any) { showToast(err?.message ?? "Could not open the file."); }
  };

  if (!data) return <div className={`${card} p-10 text-center text-[13px] text-gray-500`}>Loading the ticket…</div>;
  const { report, events } = data;
  const tabs: Tab[] = isTeam ? ["Overview", "Attachments", "Steps to Reproduce", "Technical Data", "Activity", "Internal Notes"] : ["Overview", "Attachments", "Steps to Reproduce", "Activity"];
  const publicEvents = events.filter((event) => !event.internal);
  const notes = events.filter((event) => event.kind === "note");
  const awaiting = AWAITING.includes(report.status);
  const d = report.details ?? {};
  const env = report.environment ?? {};
  const failed: any[] = report.errorContext?.failedRequests ?? [];
  const pageErrors: any[] = report.errorContext?.browserErrors ?? [];

  const fact = (labelText: string, value: ReactNode) => (
    <div><p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{labelText}</p><div className="m-0 mt-0.5 text-[13px] text-gray-900 dark:text-slate-100">{value || "—"}</div></div>
  );
  const answer = (labelText: string, value?: string | string[]) => {
    const text = Array.isArray(value) ? value.join(", ") : value;
    return text ? <div><p className="m-0 text-[12px] font-semibold text-gray-500">{labelText}</p><p className="m-0 mt-0.5 whitespace-pre-wrap text-[13.5px] text-gray-800 dark:text-slate-200">{text}</p></div> : null;
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="!min-h-0 inline-flex items-center gap-1.5 text-[13px] font-semibold text-gray-600 hover:text-[#1F8FE0]"><ArrowLeft className="h-4 w-4" /> Back</button>

      <section className={`${card} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 font-mono text-[13px] font-black text-[#1F8FE0]">{report.code} <span className="ml-2 font-sans text-[12px] font-semibold text-gray-500">{KIND_LABEL[report.kind]}</span></p>
            <h1 className="m-0 mt-1 text-[20px] font-bold text-gray-900 dark:text-slate-50">{report.title}</h1>
            <p className="m-0 mt-1 text-[12.5px] text-gray-500">
              {report.reporterName} · {report.department ?? report.reporterRole} · {stamp(report.createdAt)}
              {report.affectedCount > 1 && <> · <Users className="mb-0.5 inline h-3.5 w-3.5" /> {report.affectedCount} people affected</>}
            </p>
          </div>
          <div className="flex items-center gap-2"><PriorityBadge priority={report.priority} /><StatusBadge status={report.status} /></div>
        </div>
        {report.duplicateOfCode && <p className="m-0 mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700 dark:bg-slate-800 dark:text-slate-200">This is a duplicate of <b>{report.duplicateOfCode}</b>. Its updates reach you there.</p>}
        <div className="mt-4 flex flex-wrap gap-1 border-b border-gray-100 dark:border-slate-800">
          {tabs.map((item) => (
            <button key={item} type="button" onClick={() => setTab(item)}
              className={`!min-h-0 -mb-px border-b-2 px-3 py-2 text-[13px] font-semibold ${tab === item ? "border-[#1F8FE0] text-[#1F8FE0]" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
              {item}{item === "Attachments" && report.attachments.length ? ` (${report.attachments.length})` : item === "Internal Notes" && notes.length ? ` (${notes.length})` : ""}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {tab === "Overview" && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-3">
                {report.kind === "issue" && <>{answer("What were you trying to do?", d.tried)}{answer("What actually happened?", d.actual)}{answer("What did you expect to happen?", d.expected)}{d.errorMessage && <div><p className="m-0 text-[12px] font-semibold text-gray-500">Error message</p><p className="m-0 mt-0.5 rounded-md bg-rose-50 px-2.5 py-1.5 font-mono text-[12.5px] text-rose-700">{d.errorMessage}</p></div>}</>}
                {report.kind === "feature" && <>{answer("Problem to solve", d.problem)}{answer("Suggested solution", d.solution)}{answer("Who would use it", d.users)}{answer("How often", d.usefulness)}{answer("Expected benefit", [...(d.benefits ?? []).filter((item) => item !== "Other"), ...(d.benefitOther ? [d.benefitOther] : [])])}</>}
                {report.kind === "ux" && <>{answer("What is the problem", [...(d.uxProblems ?? []).filter((item) => item !== "Other"), ...(d.uxOther ? [d.uxOther] : [])])}{answer("Trying to accomplish", d.goal)}{answer("What would make it easier", d.improvement)}</>}
                {report.kind === "other" && answer("Details", d.more)}
                {!d.tried && !d.actual && !d.problem && !d.more && !d.goal && !(d.uxProblems?.length) && answer("Description", report.description)}
              </div>
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 dark:bg-slate-800/50">
                {fact("Module", report.module)}
                {fact("Page / tab", report.page)}
                {report.kind !== "feature" && fact("Impact", report.impact ? <b className={IMPACT_TONE[report.impact]}>{IMPACT_LABEL[report.impact]}</b> : null)}
                {fact("Priority", <PriorityBadge priority={report.priority} />)}
                {report.kind !== "feature" && fact("Who is affected", report.affected ? AFFECTED_LABEL[report.affected] : null)}
                {report.kind === "issue" && fact("How often", report.frequency ? FREQUENCY_LABEL[report.frequency] : null)}
                {report.affectedRef && fact(`Affected ${REF_LABEL[report.affectedRefKind ?? "order"].toLowerCase()}`, report.affectedRef)}
                {fact("Assigned to", report.assigneeName)}
                {isTeam && fact("Contact reporter", report.mayContact ? "Yes" : "No")}
                {isTeam && fact("Updates", report.wantsUpdates ? "Wants updates" : "No updates")}
              </div>
            </div>
          )}

          {tab === "Attachments" && (report.attachments.length === 0 ? <p className="m-0 py-6 text-center text-[13px] text-gray-500">No files were attached.</p> : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {report.attachments.map((file) => (
                <button key={file.path} type="button" onClick={() => openFile(file.path)} className="!min-h-0 flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 text-left hover:border-[#1F8FE0] dark:border-slate-700">
                  <ImageIcon className="h-5 w-5 shrink-0 text-[#1F8FE0]" />
                  <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100">{file.name}</span><span className="text-[11.5px] text-gray-500">{file.mime || "file"} · {fileSize(file.size)} · opens in a new tab</span></span>
                </button>
              ))}
            </div>
          ))}

          {tab === "Steps to Reproduce" && (report.steps.length === 0 ? <p className="m-0 py-6 text-center text-[13px] text-gray-500">No steps were given.</p> : (
            <ol className="m-0 space-y-2 pl-0">
              {report.steps.map((step, index) => (
                <li key={index} className="flex list-none items-start gap-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-[12px] font-bold text-gray-600">{index + 1}</span><span className="pt-1 text-[13.5px] text-gray-800 dark:text-slate-200">{step}</span></li>
              ))}
            </ol>
          ))}

          {tab === "Technical Data" && isTeam && (
            <div className="space-y-4 text-[12.5px]">
              <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-4 sm:grid-cols-4 dark:bg-slate-800/50">
                {fact("Environment", `${env.browser ?? "?"} ${env.browserVersion ?? ""} · ${env.os ?? "?"} · ${env.device ?? "?"} · ${env.screen ?? ""}`)}
                {fact("Application", `Protohub Web · Build ${env.appBuild ?? "?"}`)}
                {fact("Reported", `${stamp(report.createdAt)} · ${env.timezone ?? ""}`)}
                {fact("User", `${env.userName ?? report.reporterName} · ${env.userRole ?? report.reporterRole} · ${env.workspace ?? ""}`)}
                {fact("Page when reported", env.currentPage)}
                {fact("Previous page", env.previousPage)}
                {fact("URL", env.url)}
                {fact("Session", `${env.sessionId ?? "?"} · ${env.online === false ? "Offline" : "Online"}${env.connection ? ` · ${env.connection}` : ""}`)}
                {fact("Viewport", `${env.viewport ?? "?"} @${env.pixelRatio ?? 1}x · ${env.language ?? ""}`)}
              </div>
              <div>
                <p className="m-0 mb-2 text-[13px] font-bold text-gray-900 dark:text-slate-100">Failed requests in their session ({failed.length})</p>
                {failed.length === 0 ? <p className="m-0 text-gray-500">None recorded.</p> : (
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
                    <table className="w-full min-w-[620px] text-left font-mono text-[12px]">
                      <thead className="bg-gray-50 text-[11px] uppercase text-gray-500 dark:bg-slate-800"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Request</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Request ID</th><th className="px-3 py-2">Message</th></tr></thead>
                      <tbody>{failed.map((item, index) => <tr key={index} className="border-t border-gray-100 dark:border-slate-800"><td className="whitespace-nowrap px-3 py-1.5">{item.at ? new Date(item.at).toLocaleTimeString("en-NG") : ""}</td><td className="px-3 py-1.5">{item.method} {item.path}</td><td className={`px-3 py-1.5 font-bold ${item.status >= 500 || item.status === 0 ? "text-rose-600" : "text-amber-700"}`}>{item.status || "no answer"}</td><td className="whitespace-nowrap px-3 py-1.5">{item.requestId ?? "—"}</td><td className="px-3 py-1.5 font-sans">{item.message}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <p className="m-0 mb-2 text-[13px] font-bold text-gray-900 dark:text-slate-100">Page errors ({pageErrors.length})</p>
                {pageErrors.length === 0 ? <p className="m-0 text-gray-500">None recorded.</p> : pageErrors.map((item, index) => (
                  <details key={index} className="mb-1.5 rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700"><summary className="cursor-pointer font-mono text-[12px] text-rose-700">{item.message}</summary><pre className="m-0 mt-2 whitespace-pre-wrap text-[11px] text-gray-600">{item.source}{"\n"}{item.stack}</pre></details>
                ))}
              </div>
              <p className="m-0 text-[11.5px] text-gray-500">Passwords, sign-in tokens and keys are removed before anything is saved.</p>
            </div>
          )}

          {tab === "Activity" && (
            <ol className="m-0 space-y-3 border-l-2 border-gray-100 pl-4 dark:border-slate-800">
              {(isTeam ? events.filter((event) => event.kind !== "note") : publicEvents).map((event) => (
                <li key={event.id} className="relative list-none">
                  <span className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-2 ring-white ${event.kind === "reply" ? "bg-[#1F8FE0]" : event.kind === "reopened" ? "bg-rose-500" : event.kind === "verified_fixed" ? "bg-emerald-500" : "bg-gray-300"}`} />
                  <p className="m-0 text-[11.5px] text-gray-500">{stamp(event.createdAt)}{event.internal ? <span className="ml-2 inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 text-[10px] font-bold text-gray-600"><Lock className="h-2.5 w-2.5" /> team only</span> : null}</p>
                  <p className={`m-0 mt-0.5 whitespace-pre-wrap text-[13px] ${event.kind === "reply" ? "rounded-lg bg-blue-50 px-3 py-2 text-gray-800 dark:bg-blue-500/10 dark:text-slate-100" : "text-gray-800 dark:text-slate-200"}`}>
                    {event.kind === "submitted" ? `${event.actorName} submitted the report` : event.kind === "reply" ? <><b>{event.actorName}:</b> {event.body}</> : event.body}
                  </p>
                </li>
              ))}
            </ol>
          )}

          {tab === "Internal Notes" && isTeam && (
            notes.length === 0 ? <p className="m-0 py-4 text-[13px] text-gray-500">No internal notes yet. Notes here are never shown to the reporter.</p> : (
              <div className="space-y-2">{notes.map((event) => <div key={event.id} className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2"><p className="m-0 text-[11.5px] text-amber-800"><Lock className="mb-0.5 mr-1 inline h-3 w-3" />{event.actorName} · {stamp(event.createdAt)}</p><p className="m-0 mt-0.5 whitespace-pre-wrap text-[13px] text-gray-800">{event.body}</p></div>)}</div>
            )
          )}
        </div>
      </section>

      {/* "Is it fixed?" for the reporter */}
      {!isTeam && awaiting && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
          <h2 className="m-0 text-[15px] font-bold text-emerald-900">{report.code} has been {report.status === "released" ? "released" : "fixed"}</h2>
          <p className="m-0 mt-1 text-[13px] text-emerald-900/80">Can you confirm that the problem is no longer happening?</p>
          <input className={`${field} mt-3`} maxLength={1000} value={verifyComment} onChange={(event) => setVerifyComment(event.target.value)} placeholder="Anything to add? (optional)" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => run(() => bugReportsApi.verify(id, true, verifyComment || undefined), "Thank you - the ticket is closed.")} className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" /> Yes, it's fixed</button>
            <button type="button" disabled={busy} onClick={() => run(() => bugReportsApi.verify(id, false, verifyComment || undefined), "Reopened - the team has been told.")} className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-4 py-2 text-[13px] font-semibold text-rose-700 disabled:opacity-50"><XCircle className="h-4 w-4" /> No, issue still exists</button>
          </div>
        </section>
      )}

      {/* Team controls */}
      {isTeam && (
        <section className={`${card} grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-4`}>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-gray-600">Status</span>
            <select className={field} value={report.status} disabled={busy} onChange={(event) => run(() => bugReportsApi.update(id, { status: event.target.value as BugReportStatus, note: statusNote || undefined }), "Status updated.").then(() => setStatusNote(""))}>
              {stepsFor(report.kind).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
            </select>
            <input className={`${field} mt-1.5`} maxLength={1000} value={statusNote} onChange={(event) => setStatusNote(event.target.value)} placeholder="Note sent with the next status change (optional)" />
          </label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-gray-600">Priority {report.priorityOverridden ? "(set by the team)" : "(worked out by Protohub)"}</span>
            <select className={field} value={report.priorityOverridden ? report.priority ?? "auto" : "auto"} disabled={busy || report.kind === "feature"} onChange={(event) => run(() => bugReportsApi.update(id, { priority: event.target.value as IssuePriority | "auto" }), "Priority updated.")}>
              <option value="auto">Auto{report.priority && !report.priorityOverridden ? ` (${report.priority})` : ""}</option>
              {(["P0", "P1", "P2", "P3"] as IssuePriority[]).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            {report.kind === "feature" && <span className="mt-1 block text-[11px] text-gray-500">Feature ideas have no priority; use the status steps.</span>}
          </label>
          <label className="block"><span className="mb-1 block text-[12px] font-semibold text-gray-600">Assigned to</span>
            <select className={field} value={report.assigneeId ?? ""} disabled={busy} onChange={(event) => run(() => bugReportsApi.update(id, { assigneeId: event.target.value || null }), "Assignment saved.")}>
              <option value="">Unassigned</option>
              {team.map((person) => <option key={person.id} value={person.id}>{person.name} ({person.role})</option>)}
            </select>
          </label>
          <div><span className="mb-1 block text-[12px] font-semibold text-gray-600">Duplicate of</span>
            <div className="flex gap-1.5">
              <input className={field} maxLength={20} value={duplicate} onChange={(event) => setDuplicate(event.target.value)} placeholder={report.duplicateOfCode ?? "e.g. BUG-1039"} />
              <button type="button" disabled={busy || !duplicate.trim()} onClick={() => run(() => bugReportsApi.update(id, { duplicateOf: duplicate.trim() }), "Marked as a duplicate.").then(() => setDuplicate(""))} className="!min-h-0 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 disabled:opacity-40">Merge</button>
            </div>
          </div>
        </section>
      )}

      {/* Reply / internal note */}
      {report.status !== "duplicate" && (
        <section className={`${card} p-5`}>
          {isTeam && (
            <div className="mb-3 flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
              <button type="button" onClick={() => setInternal(false)} className={`!min-h-0 flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${!internal ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}><MessageSquare className="mr-1 inline h-3.5 w-3.5" />Reply to Reporter</button>
              <button type="button" onClick={() => setInternal(true)} className={`!min-h-0 flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${internal ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}><Lock className="mr-1 inline h-3.5 w-3.5" />Internal Note</button>
            </div>
          )}
          <textarea className={`${field} min-h-[80px]`} rows={3} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)}
            placeholder={isTeam ? (internal ? "Only the technical team sees this. e.g. API returns duplicate assignment records." : "The reporter sees this. e.g. We've found the problem - please try again and tell us if it works.") : report.status === "needs_info" ? "Answer the team's question here." : "Add more information or reply to the team."} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-gray-500">{isTeam ? (internal ? "Never shown to the reporter." : report.wantsUpdates ? "The reporter is notified." : "The reporter didn't ask for updates; they'll see it in My Reports.") : "The technical team is notified."}</span>
            <button type="button" disabled={busy || !message.trim()} onClick={() => run(() => bugReportsApi.message(id, message.trim(), internal), internal ? "Note saved." : "Reply sent.").then(() => setMessage(""))}
              className={`!min-h-0 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50 ${internal ? "bg-amber-600" : "bg-[#1F8FE0]"}`}><Send className="h-4 w-4" /> {internal ? "Save note" : "Send reply"}</button>
          </div>
        </section>
      )}
    </div>
  );
}
