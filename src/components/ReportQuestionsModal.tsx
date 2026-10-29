import { useState } from "react";
import { Bot, CheckCircle2, HelpCircle, MessageSquareReply, Send, UserRound } from "lucide-react";
import { Modal } from "./WeeklyReportParts";
import type { WeeklyReportQuestion } from "../lib/api";

/**
 * Questions to the manager on one rep's weekly figures (Bright, 29 Oct 2026).
 * Protohub raises its own when a figure does not add up; the Owner can ask
 * too. The manager answers; the Owner accepts or asks again. Every question
 * is a few short lines with the numbers to check ("simple ABC").
 */

const STATUS = {
  open: { label: "Waiting for the manager", tone: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-500/30" },
  answered: { label: "Answered: owner to check", tone: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-200 dark:ring-blue-500/30" },
  accepted: { label: "Done", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30" }
} as const;

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

export function ReportQuestionsModal({ repName, questions, viewerRole, onAsk, onAnswer, onAccept, onFollowUp, onClose }: {
  repName: string;
  questions: WeeklyReportQuestion[];
  viewerRole: string;
  onAsk?: (text: string) => Promise<void>;
  onAnswer?: (id: string, text: string) => Promise<void>;
  onAccept?: (id: string) => Promise<void>;
  onFollowUp?: (id: string, text: string) => Promise<void>;
  onClose: () => void;
}) {
  const isOwner = viewerRole === "Owner";
  const canAnswer = viewerRole === "Manager" || viewerRole === "Admin";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<Record<string, boolean>>({});
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const ordered = [...questions].sort((a, b) => {
    const rank = { open: 0, answered: 1, accepted: 2 };
    return rank[a.status] - rank[b.status] || a.createdAt.localeCompare(b.createdAt);
  });
  const run = async (key: string, action: () => Promise<void>, after?: () => void) => {
    setBusy(key); setError("");
    try { await action(); after?.(); }
    catch (err: any) { setError(err?.message ?? "Could not save."); }
    finally { setBusy(""); }
  };
  const textOf = (id: string) => (drafts[id] ?? "").trim();
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-800 outline-none focus:border-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  return (
    <Modal title={`Questions about ${repName}'s figures`} subtitle={isOwner ? "Protohub asks by itself when something does not add up. You can ask too." : "Answer each question. The week cannot go to the owner until every question is answered."} onClose={onClose} wide>
      <div className="space-y-4 px-6 py-5">
        {ordered.length === 0 ? <p className="m-0 rounded-xl bg-gray-50 px-3 py-3 text-[13px] text-gray-600 dark:bg-slate-800/60 dark:text-slate-300">No questions about {repName} this week.</p> : null}
        {ordered.map((question) => {
          const status = STATUS[question.status];
          return (
            <div key={question.id} className={`rounded-2xl border p-4 ${question.status === "open" ? "border-rose-200 dark:border-rose-500/30" : "border-gray-200 dark:border-slate-700"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-bold text-gray-600 dark:text-slate-300">
                  {question.source === "auto" ? <><Bot className="h-4 w-4 text-amber-600" />Protohub found this</> : <><HelpCircle className="h-4 w-4 text-[#1F6FEB]" />Asked by {question.messages[0]?.byName ?? "the owner"}</>}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ${status.tone}`}>{status.label}</span>
              </div>
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {question.messages.map((message, index) => {
                  const fromManager = message.kind === "answer";
                  const system = message.kind === "closed" || message.kind === "accepted";
                  return (
                    <li key={index} className={`flex ${fromManager ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${system ? "bg-gray-50 text-gray-600 dark:bg-slate-800/60 dark:text-slate-300" : fromManager ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-500/15 dark:text-emerald-50" : "bg-amber-50 text-amber-950 dark:bg-amber-500/10 dark:text-amber-50"}`}>
                        <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold opacity-70">
                          {fromManager ? <MessageSquareReply className="h-3.5 w-3.5" /> : message.byRole === "System" ? <Bot className="h-3.5 w-3.5" /> : system ? <CheckCircle2 className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
                          {message.byName} · {when(message.at)}
                        </p>
                        <p className="m-0 mt-1 whitespace-pre-line text-[14px] leading-relaxed">{message.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {question.status === "open" && canAnswer && onAnswer ? (
                <div className="mt-3">
                  <textarea className={`${field} min-h-[80px]`} value={drafts[question.id] ?? ""} placeholder="Your answer: what you checked and why the figure is right (or what you will change)."
                    onChange={(event) => setDrafts({ ...drafts, [question.id]: event.target.value })} />
                  <button type="button" disabled={busy === question.id || textOf(question.id).length < 5}
                    onClick={() => run(question.id, () => onAnswer(question.id, textOf(question.id)), () => setDrafts({ ...drafts, [question.id]: "" }))}
                    className="!min-h-0 mt-2 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
                    <Send className="h-4 w-4" />{busy === question.id ? "Sending…" : "Send answer"}
                  </button>
                </div>
              ) : null}
              {question.status === "open" && !canAnswer ? <p className="m-0 mt-3 text-[12px] text-gray-500">Waiting for the manager's answer.</p> : null}

              {question.status === "answered" && isOwner && onAccept && onFollowUp ? (
                asking[question.id] ? (
                  <div className="mt-3">
                    <textarea className={`${field} min-h-[70px]`} value={drafts[question.id] ?? ""} placeholder="What is still not clear?"
                      onChange={(event) => setDrafts({ ...drafts, [question.id]: event.target.value })} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={busy === question.id || textOf(question.id).length < 5}
                        onClick={() => run(question.id, () => onFollowUp(question.id, textOf(question.id)), () => { setDrafts({ ...drafts, [question.id]: "" }); setAsking({ ...asking, [question.id]: false }); })}
                        className="!min-h-0 rounded-xl bg-[#1F6FEB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">{busy === question.id ? "Sending…" : "Send"}</button>
                      <button type="button" onClick={() => setAsking({ ...asking, [question.id]: false })} className="!min-h-0 rounded-xl px-3 py-2 text-[13px] font-bold text-gray-600">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" disabled={busy === question.id} onClick={() => run(question.id, () => onAccept(question.id))}
                      className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />Accept answer</button>
                    <button type="button" onClick={() => setAsking({ ...asking, [question.id]: true })}
                      className="!min-h-0 rounded-xl bg-white px-4 py-2 text-[13px] font-bold text-gray-700 ring-1 ring-gray-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">Ask again</button>
                  </div>
                )
              ) : null}
            </div>
          );
        })}

        {isOwner && onAsk ? (
          <div className="rounded-2xl border border-dashed border-gray-300 p-4 dark:border-slate-600">
            <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-50">Ask the manager about {repName}</p>
            <p className="m-0 mt-0.5 text-[11.5px] text-gray-500">Keep it short: what you see, the number you expect, and what to explain.</p>
            <textarea className={`${field} mt-2 min-h-[80px]`} value={newText} onChange={(event) => setNewText(event.target.value)}
              placeholder={"e.g.\nThe report shows ₦7,800 base.\nI count 39 deliveries × ₦200 = ₦7,800.\nWhy add +₦400?"} />
            <button type="button" disabled={busy === "new" || newText.trim().length < 5}
              onClick={() => run("new", () => onAsk(newText.trim()), () => setNewText(""))}
              className="!min-h-0 mt-2 inline-flex items-center gap-1.5 rounded-xl bg-[#1F6FEB] px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50">
              <Send className="h-4 w-4" />{busy === "new" ? "Sending…" : "Send question"}
            </button>
          </div>
        ) : null}
        {error ? <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">{error}</p> : null}
      </div>
    </Modal>
  );
}
