import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, Info, Mail, Rocket, Save, Send, X } from "lucide-react";
import { emailMarketingApi, type EmDesigner, type EmPlanning, type EmPreview } from "../../lib/api";
import { collectLinks, safeUrl } from "../../lib/email-render";
import { TestSendModal } from "./CampaignsPage";
import StepAudience from "./StepAudience";
import StepDesign from "./StepDesign";
import StepReview, { type Check as LaunchCheck } from "./StepReview";
import StepSchedule from "./StepSchedule";
import StepSetup from "./StepSetup";
import { ErrorNote, Loading, btn } from "./em-ui";
import { audienceSummary, draftFromCampaign, goalLabel, newDraft, sendSummary, syncDesign, toInput, type Draft } from "./wizard-model";

/**
 * Create Next Campaign (Bright's designs 44–48, 8 Nov 2026): five steps in
 * one window. Nothing is saved until Save as Draft, Send Test or Launch.
 */

const STEPS = ["Campaign Setup", "Choose Audience", "Design Email", "Schedule & Automate", "Review & Launch"];

export default function CampaignWizard({ campaignId, preset, segmentId, onClose, onDone, onToast }: {
  campaignId?: string | null;
  preset?: string;
  segmentId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
  onToast: (message: string) => void;
}) {
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState(1);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "launch" | "test">("");
  const [preview, setPreview] = useState<EmPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [planning, setPlanning] = useState<EmPlanning | null>(null);
  const [links, setLinks] = useState<{ key: string; results: Array<{ url: string; ok: boolean; reason: string }> } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const body = useRef<HTMLDivElement | null>(null);

  const loadDesigner = useCallback(async () => {
    const result = await emailMarketingApi.designer();
    setDesigner(result);
    return result;
  }, []);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const loaded = await loadDesigner();
        if (!live) return;
        if (campaignId) {
          const { campaign } = await emailMarketingApi.campaign(campaignId);
          if (live) setDraft(draftFromCampaign(campaign));
        } else {
          setDraft(newDraft(loaded, preset, segmentId));
        }
      } catch (err) {
        if (live) setError((err as Error).message || "Could not open the campaign builder.");
      }
    })();
    return () => { live = false; };
  }, [campaignId, preset, segmentId, loadDesigner]);

  const change = (patch: Partial<Draft>) => {
    setDirty(true);
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      const setupChanged = ["goal", "productId", "offer", "offerType"].some((key) => key in patch);
      return setupChanged ? syncDesign(next, designer) : next;
    });
  };

  // Who it goes to, recounted as the audience changes.
  const audienceKey = draft ? JSON.stringify(draft.audience) : "";
  useEffect(() => {
    if (!draft) return;
    setPreviewing(true);
    const timer = window.setTimeout(() => {
      emailMarketingApi.audiencePreview(draft.audience).then((result) => setPreview(result)).catch(() => setPreview(null)).finally(() => setPreviewing(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [audienceKey]);
  useEffect(() => {
    if (!draft || step < 4) return;
    emailMarketingApi.planning(preview?.recipients ?? 0).then(setPlanning).catch(() => setPlanning(null));
  }, [step, preview?.recipients]);
  const linkKey = draft ? JSON.stringify(collectLinks(draft.design).map((link) => link.url)) : "";
  useEffect(() => {
    if (!draft || step !== 5 || links?.key === linkKey) return;
    const urls = [...new Set(collectLinks(draft.design).map((link) => link.url))].slice(0, 20);
    if (!urls.length) { setLinks({ key: linkKey, results: [] }); return; }
    setLinks(null);
    emailMarketingApi.checkLinks(urls).then((result) => setLinks({ key: linkKey, results: result.results })).catch(() => setLinks({ key: linkKey, results: urls.map((url) => ({ url, ok: false, reason: "Could not check" })) }));
  }, [step, linkKey]);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [step]);

  const save = async (): Promise<string | null> => {
    if (!draft) return null;
    setError("");
    try {
      if (draft.id) {
        await emailMarketingApi.updateCampaign(draft.id, toInput(draft));
        setDirty(false);
        return draft.id;
      }
      const created = await emailMarketingApi.createCampaign(toInput(draft));
      setDraft((current) => (current ? { ...current, id: created.id } : current));
      setDirty(false);
      return created.id;
    } catch (err) {
      setError((err as Error).message || "Could not save the campaign.");
      return null;
    }
  };

  const checks: LaunchCheck[] = useMemo(() => {
    if (!draft) return [];
    const auto = draft.delivery.type === "automation";
    const recipients = preview?.recipients ?? 0;
    const blocks = draft.design.blocks;
    const brokenButton = blocks.some((block) => (block.type === "button" && !safeUrl(block.link)) || (block.type === "hero" && block.buttonText.trim() && !safeUrl(block.buttonLink)));
    const sendAtMs = draft.delivery.sendAt ? Date.parse(draft.delivery.sendAt) : NaN;
    const failedLinks = links?.results.filter((row) => !row.ok) ?? [];
    const list: LaunchCheck[] = [
      { key: "details", step: 1, label: "Campaign details are complete", state: draft.name.trim() && draft.subject.trim() ? "ok" : "bad", note: !draft.name.trim() ? "Add a campaign name." : !draft.subject.trim() ? "Add an email subject." : undefined },
      {
        key: "audience", step: 2, label: `Audience is selected (${recipients.toLocaleString("en-NG")} customers)`,
        state: recipients > 0 ? "ok" : draft.sendNow && !auto ? "bad" : preview ? "warn" : "checking",
        note: recipients > 0 ? undefined : auto ? "Nobody has an email yet. It starts emailing as people join." : draft.sendNow ? "Nobody in this audience has an email yet. Schedule it for later instead." : "Nobody has an email yet. If still nobody at send time, nothing goes out."
      },
      { key: "design", step: 3, label: "Email design is ready", state: blocks.length && !brokenButton && collectLinks(draft.design).length ? "ok" : "bad", note: !blocks.length ? "The email is empty." : brokenButton ? "A button has no https:// link." : !collectLinks(draft.design).length ? "Add a button so customers can order." : undefined },
      { key: "schedule", step: 4, label: "Schedule and automation set", state: auto || draft.sendNow || (Number.isFinite(sendAtMs) && sendAtMs > Date.now()) ? "ok" : "bad", note: auto || draft.sendNow || (Number.isFinite(sendAtMs) && sendAtMs > Date.now()) ? sendSummary(draft) : "Pick a send time in the future." },
      { key: "links", step: 3, label: "Links and CTA are working", state: !links ? "checking" : failedLinks.length ? "warn" : "ok", note: failedLinks.length ? `${failedLinks[0].reason}: ${failedLinks[0].url}` : undefined },
      { key: "ab", step: 4, label: "A/B test (optional) configured", state: draft.options.abTest && !draft.subjectB.trim() ? "bad" : "ok", note: draft.options.abTest ? (draft.subjectB.trim() ? `B: ${draft.subjectB}` : "Add the second subject line.") : "Off" },
      { key: "utm", step: 4, label: "UTM tracking enabled", state: draft.options.utm ? "ok" : "warn", note: draft.options.utm ? undefined : "Off: orders are matched by phone or email only." }
    ];
    if (designer && !designer.sender.ready) list.unshift({ key: "sender", step: 5, label: "Email sending is set up", state: "bad", note: designer.sender.reason });
    return list;
  }, [draft, preview, links, designer]);
  const blocking = checks.filter((check) => check.state === "bad");
  const launched = draft && ["scheduled", "active", "sending"].includes(draft.status);

  const launch = async () => {
    if (!draft) return;
    if (blocking.length) { setError(blocking.map((check) => check.note ?? check.label).join(" ")); return; }
    setBusy("launch");
    try {
      const id = await save();
      if (!id) return;
      if (launched) { onDone("Changes saved."); return; }
      const result = await emailMarketingApi.launch(id, draft.delivery.type === "one_time" && draft.sendNow);
      onDone(result.status === "active" ? `"${draft.name}" is running. It emails each customer when the trigger happens.` : draft.sendNow ? `"${draft.name}" is sending now.` : `"${draft.name}" is scheduled for ${sendSummary(draft)}.`);
    } catch (err) {
      setError((err as Error).message || "Could not launch the campaign.");
    } finally {
      setBusy("");
    }
  };
  const saveDraft = async () => {
    setBusy("save");
    const id = await save();
    setBusy("");
    if (id) onDone(launched ? "Changes saved." : "Saved as a draft. Find it under Campaigns › Drafts.");
  };
  const openTest = async () => {
    setBusy("test");
    const id = await save();
    setBusy("");
    if (id) setTestOpen(true);
  };
  const close = () => {
    if (dirty && !window.confirm("Close without saving? Your changes will be lost.")) return;
    onClose();
  };

  const summary = draft ? `Goal: ${goalLabel(draft.goal)}  •  Audience: ${audienceSummary(draft, designer, preview)}  •  ${draft.delivery.type === "automation" ? "Runs" : "Send"}: ${sendSummary(draft)}` : "";
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-slate-900/55 sm:items-center sm:p-4">
      <div className="flex h-full w-full max-w-[1240px] flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[95vh] sm:rounded-3xl">
        <div className="flex items-start gap-4 px-5 pb-3 pt-5 sm:px-7">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Mail className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[26px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{campaignId ? "Edit Campaign" : "Create Next Campaign"}</h2>
            <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Set up, design, and schedule your next email campaign.</p>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="!min-h-0 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 text-[#5B3FD9] hover:bg-gray-50 dark:border-slate-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="mx-5 rounded-2xl border border-gray-100 bg-white px-3 py-3 shadow-[0_1px_3px_rgba(16,24,40,0.05)] dark:border-slate-800 dark:bg-slate-900 sm:mx-7">
          <ol className="m-0 flex list-none items-center gap-1 overflow-x-auto p-0">
            {STEPS.map((label, index) => {
              const n = index + 1;
              const current = n === step, done = n < step;
              return (
                <li key={label} className="flex min-w-0 items-center gap-1" style={{ flex: current ? "0 0 auto" : "1 1 0" }}>
                  <button type="button" onClick={() => setStep(n)} aria-current={current ? "step" : undefined}
                    className={`!min-h-0 inline-flex shrink-0 items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-[14.5px] font-bold ${current ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-900 dark:text-slate-100"}`}>
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[13px] ${current ? "bg-white/20 text-white" : done ? "bg-[#5B3FD9] text-white" : "border border-[#C9BEF5] text-[#5B3FD9]"}`}>{done ? <Check className="h-4 w-4" /> : n}</span>
                    <span className={current ? "" : "hidden md:inline"}>{label}</span>
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
              {step === 1 && <StepSetup draft={draft} designer={designer} onChange={change} />}
              {step === 2 && <StepAudience draft={draft} designer={designer} preview={preview} previewing={previewing} onChange={change} onToast={onToast} onDesignerChanged={async () => { await loadDesigner(); }} />}
              {step === 3 && <StepDesign draft={draft} designer={designer} onChange={change} onSendTest={() => void openTest()} onDesignerChanged={async () => { await loadDesigner(); }} onToast={onToast} />}
              {step === 4 && <StepSchedule draft={draft} designer={designer} preview={preview} planning={planning} onChange={change} />}
              {step === 5 && <StepReview draft={draft} designer={designer} audienceText={`${audienceSummary(draft, designer, null)} (${(preview?.recipients ?? 0).toLocaleString("en-NG")} customers)`} planning={planning} checks={checks} onGoTo={setStep} />}
            </div>
          )}
        </div>

        <div className="mx-5 mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-[#E4DDFB] bg-[#F7F4FF] px-4 py-3 dark:border-violet-500/30 dark:bg-violet-500/10 sm:mx-7">
          {step === 5 ? <Info className="h-7 w-7 shrink-0 text-[#5B3FD9]" /> : <Mail className="h-7 w-7 shrink-0 text-[#5B3FD9]" />}
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-bold text-gray-900 dark:text-slate-50">{step === 5 ? (launched ? "Save your changes?" : "Ready to Launch?") : "Campaign Summary"}</div>
            <div className="truncate text-[13.5px] text-gray-700 dark:text-slate-300" title={summary}>
              {step === 5 ? (blocking.length ? `Fix ${blocking.length === 1 ? "this" : "these"} first: ${blocking.map((check) => check.label).join(", ")}.` : "Your campaign is set. You can send it now or save it for later.") : summary}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {step === 1 && <button type="button" disabled={!!busy || !draft} onClick={() => void saveDraft()} className={`${btn.ghost} !px-5 !py-3`}>{busy === "save" ? "Saving…" : "Save as Draft"}</button>}
            {step > 1 && step < 5 && <button type="button" onClick={() => setStep(step - 1)} className={`${btn.ghost} !px-5 !py-3`}><ArrowLeft className="h-4 w-4" />Back: {STEPS[step - 2]}</button>}
            {step < 5 && <button type="button" disabled={!draft} onClick={() => setStep(step + 1)} className={`${btn.primary} !px-5 !py-3`}>Next: {STEPS[step]}<ArrowRight className="h-4 w-4" /></button>}
            {step === 5 && (
              <>
                <button type="button" disabled={!!busy} onClick={() => void saveDraft()} className={`${btn.ghost} !px-5 !py-3`}><Save className="h-4 w-4" />{busy === "save" ? "Saving…" : launched ? "Save" : "Save as Draft"}</button>
                <button type="button" disabled={!!busy} onClick={() => void openTest()} className={`${btn.ghost} !px-5 !py-3`}><Send className="h-4 w-4" />{busy === "test" ? "Saving…" : "Send Test Email"}</button>
                <button type="button" disabled={!!busy || blocking.length > 0} title={blocking.length ? blocking.map((check) => check.note ?? check.label).join(" ") : undefined} onClick={() => void launch()} className={`${btn.primary} !px-6 !py-3`}>
                  {busy === "launch" ? "Launching…" : launched ? "Save Changes" : "Launch Campaign"}<Rocket className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {testOpen && draft?.id && <TestSendModal campaign={{ id: draft.id, name: draft.name || "This campaign" }} defaultEmail={designer?.userEmail ?? ""} onClose={() => setTestOpen(false)} onToast={onToast} />}
    </div>,
    document.body
  );
}
