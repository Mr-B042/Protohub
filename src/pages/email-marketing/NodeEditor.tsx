import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Clock, Diamond, List, LogOut, Mail, MessageCircle, Send, Smartphone, Tag, X } from "lucide-react";
import { emailMarketingApi, type EmDesigner, type EmFlowNode, type EmWorkflow } from "../../lib/api";
import { DEFAULT_STYLES } from "../../lib/email-render";
import { ModalShell } from "./AudiencePage";
import StepDesign from "./StepDesign";
import { DEFAULT_OPTIONS, type Draft } from "./wizard-model";
import { CHECK_OPTIONS, checkQuestion, waitText, type ActionKey } from "./automation-model";
import { ErrorNote, btn, input, select } from "./em-ui";

/** Editing one step of an automation, choosing a new step, and Test Flow. */

export const ACTION_GROUPS: Array<{ key: string; label: string; icon: typeof Mail; items: Array<{ key: ActionKey | "sms" | "whatsapp" | "notify"; label: string; icon: typeof Mail; off?: string }> }> = [
  { key: "messaging", label: "Messaging", icon: Mail, items: [
    { key: "email", label: "Send Email", icon: Mail },
    { key: "sms", label: "Send SMS", icon: Send, off: "Automations send email only for now." },
    { key: "whatsapp", label: "Send WhatsApp", icon: MessageCircle, off: "Automations send email only for now." },
    { key: "notify", label: "Send Notification", icon: Bell, off: "Automations send email only for now." }
  ] },
  { key: "timing", label: "Timing & Flow", icon: Clock, items: [{ key: "wait", label: "Wait", icon: Clock }, { key: "exit", label: "End Flow", icon: LogOut }] },
  { key: "logic", label: "Conditions & Logic", icon: Diamond, items: [{ key: "condition", label: "Yes / No Check", icon: Diamond }] },
  { key: "customer", label: "Customer Actions", icon: List, items: [{ key: "list", label: "Add to List", icon: List }] },
  { key: "tags", label: "Updates & Tags", icon: Tag, items: [{ key: "tag_add", label: "Add Tag", icon: Tag }, { key: "tag_remove", label: "Remove Tag", icon: Tag }] },
  { key: "integrations", label: "Integrations", icon: Smartphone, items: [] }
];

/** The "+" menu: every step that can be added (email only, as with campaigns). */
export function ActionPicker({ onPick, onClose }: { onPick: (key: ActionKey) => void; onClose: () => void }) {
  return (
    <ModalShell title="Add a step" sub="Pick what happens next." onClose={onClose} footer={<button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>}>
      <div className="space-y-3">
        {ACTION_GROUPS.filter((group) => group.items.length).map((group) => (
          <div key={group.key}>
            <div className="mb-1.5 text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{group.label}</div>
            <div className="grid grid-cols-2 gap-2">
              {group.items.map((item) => (
                <button key={item.key} type="button" disabled={!!item.off} title={item.off} onClick={() => onPick(item.key as ActionKey)}
                  className="!min-h-0 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-left text-[13.5px] font-semibold text-gray-800 hover:border-[#8B74EE] hover:bg-[#F7F4FF] disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:text-slate-200">
                  <item.icon className="h-4 w-4 text-[#5B3FD9]" />{item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

/** Wait, check, tag, list or end: a small window. */
export function StepEditor({ node, designer, onSave, onClose }: { node: Exclude<EmFlowNode, { type: "email" }>; designer: EmDesigner | null; onSave: (next: EmFlowNode) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<EmFlowNode>(node);
  const tags = (designer?.tags ?? []).filter((tag) => tag.kind === "custom");
  const lists = (designer?.segments ?? []).filter((row) => row.kind === "fixed" && row.status !== "archived");
  const segments = (designer?.segments ?? []).filter((row) => !row.list && row.status !== "archived");
  const title = draft.type === "wait" ? "Wait" : draft.type === "condition" ? "Yes / No Check" : draft.type === "tag" ? (draft.action === "add" ? "Add Tag" : "Remove Tag") : draft.type === "list" ? "Add to List" : "End Flow";
  return (
    <ModalShell title={title} onClose={onClose} footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" onClick={() => onSave(draft)} className={btn.primary}>Save Step</button></>}>
      {draft.type === "wait" && (
        <div className="flex items-end gap-2">
          <label className="block flex-1 text-[13px] font-semibold text-gray-800 dark:text-slate-200">Wait for
            <input type="number" min={1} max={draft.unit === "hours" ? 720 : 365} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className={`${input} mt-1.5`} />
          </label>
          <select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value as "hours" | "days" })} className={`${select} !w-[130px]`} aria-label="Unit">
            <option value="hours">Hours</option><option value="days">Days</option>
          </select>
        </div>
      )}
      {draft.type === "condition" && (
        <div className="space-y-3">
          <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Check
            <select value={draft.check.kind} onChange={(event) => {
              const kind = event.target.value as typeof draft.check.kind;
              setDraft({ ...draft, check: { kind }, name: CHECK_OPTIONS.find((row) => row.kind === kind)?.question ?? draft.name });
            }} className={`${select} mt-1.5`}>
              {CHECK_OPTIONS.map((row) => <option key={row.kind} value={row.kind}>{row.label}</option>)}
            </select>
          </label>
          {draft.check.kind === "in_segment" && (
            <select value={draft.check.segmentId ?? ""} onChange={(event) => setDraft({ ...draft, check: { ...draft.check, segmentId: event.target.value } })} className={select} aria-label="Segment">
              <option value="">Pick a segment</option>{segments.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          )}
          {draft.check.kind === "has_tag" && (
            <select value={draft.check.tagId ?? ""} onChange={(event) => setDraft({ ...draft, check: { ...draft.check, tagId: event.target.value } })} className={select} aria-label="Tag">
              <option value="">Pick a tag</option>{(designer?.tags ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          )}
          <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Name on the flow
            <input value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={checkQuestion(draft.check)} className={`${input} mt-1.5`} />
          </label>
          <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">
            {draft.check.kind === "placed_order" || draft.check.kind === "delivered_order" ? "Counts orders since the customer entered this automation (not the one that started it)." :
              draft.check.kind === "opened_last" || draft.check.kind === "clicked_last" ? "Looks at the email sent last in this flow. Needs Track Performance on (step 4)." :
                draft.check.kind === "left_review" ? "Yes when an approved customer review exists for one of their orders (Products & Stock › Customer Reviews)." : "Checked at this moment."}
          </p>
        </div>
      )}
      {draft.type === "tag" && (
        tags.length ? (
          <select value={draft.tagId} onChange={(event) => setDraft({ ...draft, tagId: event.target.value, tagName: tags.find((row) => row.id === event.target.value)?.name ?? "" })} className={select} aria-label="Tag">
            <option value="">Pick a tag</option>{tags.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        ) : <p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">Make a tag first in Audience & Segments › Tags. Ready-made tags follow their own rule, so only your own tags can be put on here.</p>
      )}
      {draft.type === "list" && (
        lists.length ? (
          <select value={draft.listId} onChange={(event) => setDraft({ ...draft, listId: event.target.value, listName: lists.find((row) => row.id === event.target.value)?.name ?? "" })} className={select} aria-label="List">
            <option value="">Pick a list</option>{lists.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        ) : <p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">Make a list first in Audience & Segments › Lists (an uploaded or hand-picked list).</p>
      )}
      {draft.type === "exit" && <p className="m-0 text-[13px] text-gray-700 dark:text-slate-300">The customer leaves the automation here. Steps after this one are skipped.</p>}
    </ModalShell>
  );
}

/** An email step: name, subject and preheader, then the same designer as campaigns. */
export function EmailStepEditor({ node, goal, designer, onSave, onClose, onToast, onDesignerChanged }: {
  node: Extract<EmFlowNode, { type: "email" }>; goal: string; designer: EmDesigner | null;
  onSave: (next: EmFlowNode) => void; onClose: () => void; onToast: (message: string) => void; onDesignerChanged: () => Promise<void>;
}) {
  const [step, setStep] = useState(node);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const draft: Draft = useMemo(() => ({
    id: null, name: step.name, goal, subject: step.email.subject, subjectB: "", preheader: step.email.preheader, offerType: "custom", productId: step.email.productId,
    offer: { on: false, title: "", benefit: "" }, audience: { source: "all" },
    design: step.email.design ?? { version: 1, template: "simple_message", touched: true, styles: { ...DEFAULT_STYLES }, blocks: [] },
    delivery: { type: "one_time", sendAt: null }, sendNow: false, options: { ...DEFAULT_OPTIONS }, thumbnailUrl: step.email.thumbnailUrl, status: "draft"
  }), [step, goal]);
  const sendTest = async () => {
    const to = designer?.userEmail;
    if (!to) { setError("Your account has no email address to send the test to."); return; }
    setTesting(true);
    try {
      const { results } = await emailMarketingApi.testAutomationEmails({ emails: [to], workflow: { nodes: [step] } });
      const failed = results.find((row) => !row.ok);
      if (failed) setError(failed.error ?? "The test did not send."); else onToast(`Test sent to ${to}.`);
    } catch (err) {
      setError((err as Error).message || "Could not send the test.");
    } finally {
      setTesting(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-stretch justify-center bg-slate-900/55 sm:items-center sm:p-4">
      <div className="flex h-full w-full max-w-[1240px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[95vh] sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5 dark:border-slate-800">
          <Mail className="h-6 w-6 text-[#5B3FD9]" />
          <input value={step.name} maxLength={80} onChange={(event) => setStep({ ...step, name: event.target.value })} aria-label="Step name" className={`${input} !w-auto min-w-0 flex-1 !py-2 font-bold`} />
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 text-[#5B3FD9] dark:border-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <ErrorNote message={error} />
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Subject *
              <input value={step.email.subject} maxLength={200} onChange={(event) => setStep({ ...step, email: { ...step.email, subject: event.target.value } })} placeholder="e.g. Thank you for your order, {{first name}}" className={`${input} mt-1.5`} />
            </label>
            <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Preheader
              <input value={step.email.preheader} maxLength={100} onChange={(event) => setStep({ ...step, email: { ...step.email, preheader: event.target.value } })} placeholder="The short line shown after the subject" className={`${input} mt-1.5`} />
            </label>
          </div>
          <StepDesign draft={draft} designer={designer} onToast={onToast} onDesignerChanged={onDesignerChanged} onSendTest={() => void sendTest()}
            onChange={(patch) => {
              if (patch.design) setStep((current) => ({ ...current, email: { ...current.email, design: patch.design! } }));
              if (patch.productId !== undefined) setStep((current) => ({ ...current, email: { ...current.email, productId: patch.productId ?? null } }));
              if (patch.thumbnailUrl !== undefined) setStep((current) => ({ ...current, email: { ...current.email, thumbnailUrl: patch.thumbnailUrl ?? null } }));
            }} />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800">
          <button type="button" disabled={testing} onClick={() => void sendTest()} className={btn.ghost}><Send className="h-4 w-4" />{testing ? "Sending…" : "Send Test Email"}</button>
          <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
          <button type="button" onClick={() => onSave({ ...step, name: step.name.trim() || "Email" })} className={btn.primary}>Save Email</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Test Flow: what one customer goes through, day by day, and every email sent as a test. */
export function TestFlowModal({ name, flow, designer, onClose, onToast }: { name: string; flow: EmWorkflow; designer: EmDesigner | null; onClose: () => void; onToast: (message: string) => void }) {
  const [to, setTo] = useState(designer?.userEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rows: Array<{ depth: number; at: number; text: string; tone?: "yes" | "no" }> = [];
  const walk = (nodes: EmFlowNode[], depth: number, start: number): number => {
    let day = start;
    for (const node of nodes) {
      if (node.type === "wait") { day += node.unit === "hours" ? node.amount / 24 : node.amount; rows.push({ depth, at: day, text: `Wait ${waitText(node).toLowerCase()}` }); continue; }
      if (node.type === "email") rows.push({ depth, at: day, text: `Email "${node.name}": ${node.email.subject || "no subject yet"}` });
      if (node.type === "tag") rows.push({ depth, at: day, text: `${node.action === "add" ? "Tag" : "Untag"}: ${node.tagName || "pick a tag"}` });
      if (node.type === "list") rows.push({ depth, at: day, text: `Add to list: ${node.listName || "pick a list"}` });
      if (node.type === "exit") rows.push({ depth, at: day, text: "End of the flow" });
      if (node.type === "condition") {
        rows.push({ depth, at: day, text: node.name || checkQuestion(node.check) });
        rows.push({ depth: depth + 1, at: day, text: "If yes", tone: "yes" });
        const yes = walk(node.yes, depth + 2, day);
        rows.push({ depth: depth + 1, at: day, text: "If no", tone: "no" });
        const no = walk(node.no, depth + 2, day);
        day = Math.max(yes, no);
      }
    }
    return day;
  };
  walk(flow.nodes, 0, 0);
  const dayText = (at: number) => (at < 1 ? (at === 0 ? "Day 0" : `Hour ${Math.round(at * 24)}`) : `Day ${Math.round(at * 10) / 10}`);
  const send = async () => {
    const emails = to.split(/[,\s]+/).map((row) => row.trim()).filter(Boolean).slice(0, 5);
    if (!emails.length) { setError("Enter an email address."); return; }
    setBusy(true);
    try {
      const { results } = await emailMarketingApi.testAutomationEmails({ emails, workflow: flow });
      const failed = results.filter((row) => !row.ok);
      if (failed.length) setError(failed.map((row) => `${row.step}: ${row.error}`).join(" ")); else { onToast(`${results.length} test ${results.length === 1 ? "email" : "emails"} sent.`); onClose(); }
    } catch (err) {
      setError((err as Error).message || "Could not send the tests.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ModalShell wide title={`Test Flow: ${name || "New automation"}`} sub="What one customer goes through, step by step. Emails are not sent to customers." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Close</button><button type="button" disabled={busy} onClick={() => void send()} className={btn.primary}><Send className="h-4 w-4" />{busy ? "Sending…" : "Send Every Email as a Test"}</button></>}>
      <ErrorNote message={error} />
      <ol className="m-0 list-none space-y-1 p-0">
        <li className="flex gap-3 text-[13px]"><span className="w-16 shrink-0 font-bold text-[#5B3FD9]">Day 0</span><span className="font-semibold text-gray-900 dark:text-slate-50">The trigger happens: the customer enters</span></li>
        {rows.map((row, index) => (
          <li key={index} className="flex gap-3 text-[13px]">
            <span className="w-16 shrink-0 font-bold text-[#5B3FD9]">{row.tone ? "" : dayText(row.at)}</span>
            <span style={{ paddingLeft: row.depth * 16 }} className={row.tone === "yes" ? "font-bold text-emerald-700" : row.tone === "no" ? "font-bold text-rose-600" : "text-gray-800 dark:text-slate-200"}>{row.text}</span>
          </li>
        ))}
      </ol>
      <label className="mt-4 block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Send the emails to
        <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="you@example.com" className={`${input} mt-1.5`} />
      </label>
      <p className="m-0 mt-1 text-[12px] text-gray-500">Each email arrives marked [Test]. Up to 5 addresses, separated by commas.</p>
    </ModalShell>
  );
}
