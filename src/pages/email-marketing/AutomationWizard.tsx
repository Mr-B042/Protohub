import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Info, Rocket, Save, X, Zap } from "lucide-react";
import { emailMarketingApi, type EmDesigner, type EmFlowNode, type EmWorkflow } from "../../lib/api";
import { ErrorNote, Loading, btn } from "./em-ui";
import { StepBuild, StepChoose, StepDetails, StepLaunch } from "./AutomationSteps";
import { ActionPicker, EmailStepEditor, StepEditor, TestFlowModal } from "./NodeEditor";
import {
  draftFromAutomation, draftFromTemplate, emailSteps, findNode, insertAt, launchProblems, moveNode, newNode, removeNode, replaceNode, toAutomationInput,
  type ActionKey, type AutoDraft, type Slot
} from "./automation-model";

/**
 * Create New Automation, steps 1-4 (Bright's designs 51, A, B, C). Opens on a
 * template (the Automations page, the Overview, Audience Health) or on an
 * existing automation (Edit).
 */

const STEPS = ["Choose Template", "Automation Details", "Build Workflow", "Settings & Launch"];
const NEXT_NOTE = [
  "You'll customize your emails, set the timing, and activate the automation.",
  "Next, you'll build the workflow: the emails, the timing and the steps customers go through.",
  "Design the exact steps, timing, and conditions for your automation.",
  "Once launched, this automation will start automatically for customers who meet the trigger conditions."
];

export default function AutomationWizard({ automationId, template, startStep, noun = "Automation", onClose, onDone, onToast }: {
  automationId?: string | null;
  template?: string | null;
  startStep?: number;
  /** "Journey" when opened from Customer Journey (the same flows, by customer stage). */
  noun?: "Automation" | "Journey";
  onClose: () => void;
  onDone: (message: string) => void;
  onToast: (message: string) => void;
}) {
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [draft, setDraft] = useState<AutoDraft | null>(null);
  const [step, setStep] = useState(startStep ?? (automationId ? 2 : 1));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "launch">("");
  const [dirty, setDirty] = useState(false);
  const [past, setPast] = useState<EmWorkflow[]>([]);
  const [future, setFuture] = useState<EmWorkflow[]>([]);
  const [picker, setPicker] = useState<Slot | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  const loadDesigner = useCallback(async () => {
    const data = await emailMarketingApi.designer();
    setDesigner(data);
    return data;
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadDesigner();
        if (cancelled) return;
        if (automationId) {
          const { automation } = await emailMarketingApi.automation(automationId);
          if (!cancelled) setDraft(draftFromAutomation(automation));
        } else {
          setDraft(draftFromTemplate(template === undefined ? "post_purchase" : template, data));
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message || "Could not open the automation.");
      }
    })();
    return () => { cancelled = true; };
  }, [automationId, template, loadDesigner]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [step]);

  const change = (patch: Partial<AutoDraft>) => { setDraft((current) => (current ? { ...current, ...patch } : current)); setDirty(true); };
  /** Every flow change goes through here, so Undo / Redo can step back. */
  const setFlow = (next: EmWorkflow) => {
    if (!draft) return;
    setPast((list) => [...list.slice(-40), draft.workflow]);
    setFuture([]);
    change({ workflow: next });
  };
  const undo = past.length && draft ? () => { setFuture((list) => [draft.workflow, ...list]); change({ workflow: past[past.length - 1] }); setPast((list) => list.slice(0, -1)); } : null;
  const redo = future.length && draft ? () => { setPast((list) => [...list, draft.workflow]); change({ workflow: future[0] }); setFuture((list) => list.slice(1)); } : null;

  const pickTemplate = (key: string | null) => {
    if (!draft) return;
    if (dirty && draft.workflow.nodes.length && !window.confirm("Start from this template? The current flow and its emails are replaced.")) return;
    const next = draftFromTemplate(key, designer);
    setDraft({ ...next, id: draft.id, status: draft.status, active: draft.active });
    setPast([]); setFuture([]);
    setDirty(true);
  };

  const addAt = (slot: Slot, action: ActionKey) => {
    if (!draft) return;
    const node = newNode(action, designer, emailSteps(draft.workflow).length + 1);
    setFlow(insertAt(draft.workflow, slot, node));
    setPicker(null);
    // A new step opens straight away so it can be set (an End needs nothing).
    if (node.type !== "exit") setEditing(node.id);
  };
  const onMenu = (id: string, action: "edit" | "up" | "down" | "delete") => {
    if (!draft) return;
    if (action === "edit") { setEditing(id); return; }
    if (action === "delete") {
      const node = findNode(draft.workflow, id);
      if (node?.type === "condition" && (node.yes.length || node.no.length) && !window.confirm("Delete this check and every step in its Yes and No branches?")) return;
      setFlow(removeNode(draft.workflow, id));
      return;
    }
    setFlow(moveNode(draft.workflow, id, action === "up" ? -1 : 1));
  };
  const saveStep = (next: EmFlowNode) => { if (draft) setFlow(replaceNode(draft.workflow, next)); setEditing(null); };

  const save = async (launch: boolean) => {
    if (!draft) return null;
    if (!draft.name.trim()) { setError(`Give the ${noun.toLowerCase()} a name (step 2).`); setStep(2); return null; }
    const input = toAutomationInput(draft, launch);
    const id = draft.id ? (await emailMarketingApi.updateAutomation(draft.id, input)).id : (await emailMarketingApi.createAutomation(input)).id;
    setDraft((current) => (current ? { ...current, id } : current));
    setDirty(false);
    return id;
  };
  const finish = async (mode: "draft" | "launch") => {
    if (!draft) return;
    setError("");
    const problems = mode === "launch" && draft.active ? launchProblems(draft, designer) : [];
    if (problems.length) { setError(problems.join(" ")); return; }
    setBusy(mode === "draft" ? "save" : "launch");
    try {
      const launch = mode === "launch" && draft.active;
      const id = await save(launch);
      if (!id) return;
      // Switched off while it was running: pause it.
      if (!draft.active && draft.status === "active") await emailMarketingApi.automationAction(id, "pause");
      onDone(launch
        ? draft.status === "active" ? "Changes saved. The automation keeps running." : `"${draft.name.trim()}" is running. Customers enter when the trigger happens.`
        : !draft.active && draft.status === "active" ? "Saved and paused." : "Saved. It is not running yet.");
    } catch (err) {
      setError((err as Error).message || "Could not save the automation.");
    } finally {
      setBusy("");
    }
  };
  const close = () => {
    if (dirty && !window.confirm("Close without saving? Your changes will be lost.")) return;
    onClose();
  };

  const editingNode = draft ? findNode(draft.workflow, editing) : null;
  const primaryLabel = !draft ? "Launch Automation"
    : draft.status === "active" ? (draft.active ? "Save Changes" : "Save & Pause")
      : draft.status === "paused" ? (draft.active ? "Save & Resume" : "Save Changes")
        : draft.active ? "Launch Automation" : "Save (Off)";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-slate-900/55 sm:items-center sm:p-4">
      <div className="flex h-full w-full max-w-[1320px] flex-col overflow-hidden bg-[#FBFAFF] shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[95vh] sm:rounded-3xl">
        <div className="flex items-start gap-4 px-5 pb-3 pt-5 sm:px-7">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Zap className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[26px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{automationId ? `Edit ${noun}` : `Create New ${noun}`}</h2>
            <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Build an automated email sequence that runs on customer actions.</p>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="!min-h-0 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-[#5B3FD9] hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900"><X className="h-5 w-5" /></button>
        </div>

        <div className="mx-5 rounded-2xl border border-gray-100 bg-white px-3 py-3 shadow-[0_1px_3px_rgba(16,24,40,0.05)] dark:border-slate-800 dark:bg-slate-900 sm:mx-7">
          <ol className="m-0 flex list-none items-center gap-1 overflow-x-auto p-0">
            {STEPS.map((name, index) => {
              const n = index + 1;
              const current = n === step, done = n < step;
              return (
                <li key={name} className="flex min-w-0 items-center gap-1" style={{ flex: current ? "0 0 auto" : "1 1 0" }}>
                  <button type="button" disabled={!draft} onClick={() => setStep(n)} aria-current={current ? "step" : undefined}
                    className={`!min-h-0 inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[14.5px] font-bold ${current ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-900 dark:text-slate-100"}`}>
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] ${current ? "bg-white text-[#5B3FD9]" : done ? "bg-emerald-500 text-white" : "border border-[#C9BEF5] text-[#5B3FD9]"}`}>{done ? <Check className="h-4 w-4" /> : n}</span>
                    <span className={current ? "" : "hidden md:inline"}>{name}</span>
                  </button>
                  {n < STEPS.length && <span className="hidden h-px min-w-[16px] flex-1 bg-[#D9D2F7] sm:block" />}
                </li>
              );
            })}
          </ol>
        </div>

        <div ref={body} className="flex-1 min-h-0 overflow-y-auto px-5 py-4 sm:px-7">
          <ErrorNote message={error} />
          {!draft && !error && <Loading />}
          {draft && (
            <div className={error ? "mt-3" : ""}>
              {step === 1 && <StepChoose draft={draft} designer={designer} onChange={change} onPickTemplate={pickTemplate} />}
              {step === 2 && <StepDetails draft={draft} designer={designer} onChange={change} />}
              {step === 3 && <StepBuild draft={draft} designer={designer} onChange={change} onAddAt={setPicker} onDropAt={addAt} onMenu={onMenu} onSelect={setEditing} undo={undo} redo={redo} onTest={() => setTesting(true)} />}
              {step === 4 && <StepLaunch draft={draft} designer={designer} onChange={change} />}
            </div>
          )}
        </div>

        <div className="mx-5 mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[#E4DDFB] bg-white px-4 py-3 dark:border-violet-500/30 dark:bg-slate-900 sm:mx-7">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EEEBFC] text-[#5B3FD9]"><Info className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold text-gray-900 dark:text-slate-50">{step === 3 ? "Build your workflow" : "What happens next?"}</div>
            <div className="text-[13.5px] text-gray-700 dark:text-slate-300">{NEXT_NOTE[step - 1]}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {step === 1 ? <button type="button" onClick={close} className={`${btn.ghost} !px-6 !py-3`}>Cancel</button>
              : <button type="button" onClick={() => setStep(step - 1)} className={`${btn.ghost} !px-5 !py-3`}><ArrowLeft className="h-4 w-4" />Back</button>}
            {step < 4 && <button type="button" disabled={!draft} onClick={() => setStep(step + 1)} className={`${btn.primary} !px-5 !py-3`}>Next: {STEPS[step]}<ArrowRight className="h-4 w-4" /></button>}
            {step === 4 && (
              <>
                <button type="button" disabled={!!busy || !draft} onClick={() => void finish("draft")} className={`${btn.ghost} !px-5 !py-3`}><Save className="h-4 w-4" />{busy === "save" ? "Saving…" : draft?.status === "active" ? "Save" : "Save as Draft"}</button>
                <button type="button" disabled={!!busy || !draft} onClick={() => void finish("launch")} className={`${btn.primary} !px-6 !py-3`}><Rocket className="h-4 w-4" />{busy === "launch" ? "Saving…" : primaryLabel}</button>
              </>
            )}
          </div>
        </div>
      </div>

      {picker && <ActionPicker onClose={() => setPicker(null)} onPick={(key) => addAt(picker, key)} />}
      {editingNode && editingNode.type === "email" && draft && (
        <EmailStepEditor node={editingNode} goal={draft.goal === "cart" ? "cart" : draft.goal === "winback" ? "winback" : "retention"} designer={designer} onToast={onToast}
          onDesignerChanged={async () => { await loadDesigner(); }} onClose={() => setEditing(null)} onSave={saveStep} />
      )}
      {editingNode && editingNode.type !== "email" && <StepEditor node={editingNode} designer={designer} onClose={() => setEditing(null)} onSave={saveStep} />}
      {testing && draft && <TestFlowModal name={draft.name} flow={draft.workflow} designer={designer} onClose={() => setTesting(false)} onToast={onToast} />}
    </div>,
    document.body
  );
}
