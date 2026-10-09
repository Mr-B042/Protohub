import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Bug, CheckCircle2, ChevronDown, Clock, CloudUpload, FileText, Image as ImageIcon, Inbox, Lightbulb, Link2,
  MessageCircle, PencilRuler, Plus, Send, X
} from "lucide-react";
import { bugReportsApi, type BugReport, type BugReportKind, type BugReportStatus } from "../lib/api";

/**
 * Report a Bug / Send Feedback (Bright, 9 Oct 2026) - built to Bright's
 * design: header, four report tabs, the numbered form on the left and the
 * Quick Tips / Example Screenshot / Example Description / Our Response
 * column on the right. The sidebar and top bar are the app's own.
 *
 * Not in the design but needed for it to work: the Owner reads what is sent
 * in "Reports received" (same page, Owner only) and sets a status; a sender
 * who ticked "Send me updates" is notified each time it changes.
 */

type Props = {
  currentRole: string;
  /** Pages this person can open: the "Where did this happen?" list. */
  modules: string[];
  showToast: (message: string) => void;
  onCancel: () => void;
};

const KINDS: Array<{ key: BugReportKind; tab: string; title: string; hint: string; icon: typeof Bug; tone: string }> = [
  { key: "issue", tab: "Report an Issue", title: "Bug / Technical Issue", hint: "Something is not working as expected", icon: Bug, tone: "text-violet-600" },
  { key: "feature", tab: "Suggest a Feature", title: "New Feature Suggestion", hint: "Share an idea or improvement", icon: Lightbulb, tone: "text-amber-500" },
  { key: "ux", tab: "UX/UI Feedback", title: "UI/UX Feedback", hint: "Design, layout or user experience", icon: PencilRuler, tone: "text-pink-500" },
  { key: "other", tab: "Other", title: "Other", hint: "Anything else", icon: MessageCircle, tone: "text-blue-600" }
];

const PAGE_PARTS = ["The whole page", "A pop-up or form", "A table or list", "A button", "A number or chart", "Filters or search", "Something else"];
const STATUS: Record<BugReportStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-blue-50 text-blue-700 ring-blue-200" },
  looking: { label: "Looking into it", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  fixed: { label: "Fixed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  wont_fix: { label: "Won't change", cls: "bg-gray-100 text-gray-600 ring-gray-200" }
};
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm,video/quicktime";
const MAX_FILE = 10 * 1024 * 1024;
const MAX_FILES = 6;

type Picked = { id: string; file: File; preview: string };
const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
  reader.readAsDataURL(file);
});
const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const card = "rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900";
const field = "w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] text-gray-800 placeholder:text-gray-400 outline-none focus:border-[#1F8FE0] focus:ring-2 focus:ring-[#1F8FE0]/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const stepTitle = "m-0 mb-2.5 text-[14px] font-bold text-gray-900 dark:text-slate-100";

export default function ReportBugPage({ currentRole, modules, showToast, onCancel }: Props) {
  const isOwner = currentRole === "Owner";
  const [view, setView] = useState<"send" | "inbox">("send");
  const [kind, setKind] = useState<BugReportKind>("issue");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [module, setModule] = useState("");
  const [page, setPage] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [steps, setSteps] = useState<string[]>(["", "", ""]);
  const [wantsUpdates, setWantsUpdates] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [inbox, setInbox] = useState<BugReport[] | null>(null);

  useEffect(() => () => files.forEach((item) => URL.revokeObjectURL(item.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isOwner) return;
    bugReportsApi.all().then(setInbox).catch(() => setInbox([]));
  }, [isOwner]);
  const newCount = (inbox ?? []).filter((row) => row.status === "new").length;

  const addFiles = (list: FileList | File[]) => {
    const next: Picked[] = [];
    for (const file of Array.from(list)) {
      if (!ACCEPT.split(",").includes(file.type)) { showToast(`"${file.name}" is not a PNG, JPG, GIF or screen recording.`); continue; }
      if (file.size > MAX_FILE) { showToast(`"${file.name}" is over 10MB.`); continue; }
      next.push({ id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`, file, preview: URL.createObjectURL(file) });
    }
    setFiles((current) => {
      const merged = [...current, ...next];
      if (merged.length > MAX_FILES) showToast(`Up to ${MAX_FILES} files per report.`);
      merged.slice(MAX_FILES).forEach((item) => URL.revokeObjectURL(item.preview));
      return merged.slice(0, MAX_FILES);
    });
  };
  const removeFile = (id: string) => setFiles((current) => {
    current.filter((item) => item.id === id).forEach((item) => URL.revokeObjectURL(item.preview));
    return current.filter((item) => item.id !== id);
  });

  const reset = () => {
    files.forEach((item) => URL.revokeObjectURL(item.preview));
    setTitle(""); setDescription(""); setModule(""); setPage(""); setFiles([]); setSteps(["", "", ""]); setWantsUpdates(true); setError("");
  };

  const submit = async () => {
    if (!title.trim()) { setError("Give a short title."); return; }
    if (!description.trim()) { setError("Describe the issue in detail."); return; }
    if (!module) { setError("Choose where this happened."); return; }
    setSaving(true);
    setError("");
    try {
      const encoded = await Promise.all(files.map(async (item) => ({ name: item.file.name, dataUrl: await readAsDataUrl(item.file) })));
      const saved = await bugReportsApi.create({
        kind, title: title.trim(), description: description.trim(), module, page: page || undefined,
        steps: steps.map((step) => step.trim()).filter(Boolean), wantsUpdates, files: encoded
      });
      showToast("Report sent. Thank you - we usually respond within 1–2 business days.");
      if (isOwner) setInbox((current) => [saved, ...(current ?? [])]);
      reset();
    } catch (err: any) {
      setError(err?.message ?? "Could not send the report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1280px] pb-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-[#1F8FE0] dark:bg-blue-500/15">
            <Bug className="h-8 w-8" strokeWidth={2.25} />
          </span>
          <div>
            <h1 className="m-0 text-[26px] font-bold leading-tight text-gray-900 dark:text-slate-50">Report a Bug / Send Feedback</h1>
            <p className="m-0 mt-1 text-[14.5px] text-gray-500 dark:text-slate-400">Found an issue or have a suggestion? Let us know so we can make Protohub better.</p>
          </div>
        </div>
        {isOwner && (
          <button type="button" onClick={() => setView(view === "inbox" ? "send" : "inbox")}
            className="!min-h-0 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-[13px] font-semibold text-gray-700 hover:border-blue-300 hover:text-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {view === "inbox" ? <><Send className="h-4 w-4" /> Send a report</> : <><Inbox className="h-4 w-4" /> Reports received{newCount > 0 ? <span className="rounded-full bg-[#1F8FE0] px-2 py-0.5 text-[11px] font-bold text-white">{newCount}</span> : null}</>}
          </button>
        )}
      </div>

      {view === "inbox" && isOwner ? <ReportsInbox rows={inbox} setRows={setInbox} showToast={showToast} /> : (
        <>
          {/* Report tabs: the same four kinds as step 1 */}
          <div className="mb-5 flex flex-wrap gap-2.5">
            {KINDS.map((item) => (
              <button key={item.key} type="button" onClick={() => setKind(item.key)}
                className={`!min-h-0 rounded-xl border px-6 py-2.5 text-[13.5px] font-semibold transition-colors ${kind === item.key
                  ? "border-blue-300 bg-blue-50 text-[#1F8FE0] dark:border-blue-500/50 dark:bg-blue-500/10"
                  : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
                {item.tab}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
            {/* The form */}
            <section className={`${card} p-5 sm:p-6`}>
              <div className="space-y-6">
                <div>
                  <p className={stepTitle}>1.&nbsp;&nbsp;What type of report is this?</p>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {KINDS.map((item) => {
                      const Icon = item.icon;
                      const on = kind === item.key;
                      return (
                        <button key={item.key} type="button" onClick={() => setKind(item.key)}
                          className={`!min-h-0 relative rounded-xl border p-3.5 text-left transition-colors ${on ? "border-[#1F8FE0] bg-blue-50/60 ring-1 ring-[#1F8FE0] dark:bg-blue-500/10" : "border-gray-200 bg-white hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900"}`}>
                          <span className={`absolute right-3 top-3 flex h-4 w-4 items-center justify-center rounded-full border ${on ? "border-[#1F8FE0] bg-[#1F8FE0]" : "border-gray-300 dark:border-slate-600"}`}>
                            {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                          </span>
                          <Icon className={`h-6 w-6 ${item.tone}`} />
                          <span className={`mt-2 block text-[13.5px] font-bold ${on ? "text-[#1F5FA8] dark:text-blue-300" : "text-gray-900 dark:text-slate-100"}`}>{item.title}</span>
                          <span className="mt-0.5 block text-[12px] leading-snug text-gray-500 dark:text-slate-400">{item.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className={stepTitle}>2.&nbsp;&nbsp;Give a short title</p>
                  <input className={field} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)}
                    placeholder={kind === "issue" ? "e.g. Orders not loading, Error message, Wrong data showing, etc." : kind === "feature" ? "e.g. Add a filter for delivered date" : kind === "ux" ? "e.g. The Save button is hard to find on mobile" : "e.g. A question about bonuses"} />
                  <p className="m-0 mt-1 text-right text-[11.5px] text-gray-400">{title.length}/100</p>
                </div>

                <div>
                  <p className={stepTitle}>3.&nbsp;&nbsp;{kind === "issue" ? "Describe the issue in detail" : kind === "feature" ? "Describe your idea in detail" : kind === "ux" ? "Describe what could look or work better" : "Tell us more"}</p>
                  <textarea className={`${field} min-h-[96px] resize-y`} rows={4} value={description} maxLength={1000} onChange={(event) => setDescription(event.target.value)}
                    placeholder={kind === "issue" ? "Explain what you were trying to do, what happened, and any error message you saw." : "Explain what you would like and how it would help your work."} />
                  <p className="m-0 mt-1 text-right text-[11.5px] text-gray-400">{description.length}/1000</p>
                </div>

                <div>
                  <p className={stepTitle}>4.&nbsp;&nbsp;Where did this happen?</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <SelectBox icon={Box} value={module} onChange={(value) => { setModule(value); setPage(""); }} placeholder="Select module / page" options={modules} />
                    <SelectBox icon={Link2} value={page} onChange={setPage} placeholder="Select specific page (optional)" options={PAGE_PARTS} disabled={!module} />
                  </div>
                </div>

                <div>
                  <p className={stepTitle}>5.&nbsp;&nbsp;Add a screenshot or screen recording (optional)</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                    <button type="button" onClick={() => inputRef.current?.click()}
                      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); }}
                      className={`!min-h-0 flex min-h-[112px] flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${dragging ? "border-[#1F8FE0] bg-blue-50" : "border-gray-300 bg-gray-50/40 hover:border-[#1F8FE0] dark:border-slate-600 dark:bg-slate-800/40"}`}>
                      <CloudUpload className="h-7 w-7 text-[#1F8FE0]" />
                      <span className="mt-2 text-[13px] text-gray-600 dark:text-slate-300"><b className="font-semibold text-[#1F8FE0]">Click to upload</b> or drag and drop</span>
                      <span className="mt-1 text-[11.5px] text-gray-400">PNG, JPG, GIF up to 10MB (you can upload multiple files)</span>
                    </button>
                    <input ref={inputRef} type="file" accept={ACCEPT} multiple className="hidden"
                      onChange={(event) => { if (event.target.files?.length) addFiles(event.target.files); event.target.value = ""; }} />
                    {files.length > 0 && (
                      <div className="grid grid-cols-2 gap-3">
                        {files.map((item) => (
                          <div key={item.id} className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
                            <button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => removeFile(item.id)}
                              className="!min-h-0 absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-700 shadow ring-1 ring-gray-200 hover:text-rose-600">
                              <X className="h-3.5 w-3.5" />
                            </button>
                            {item.file.type.startsWith("video/")
                              ? <video src={item.preview} className="h-[64px] w-full rounded-md bg-gray-100 object-cover" muted />
                              : <img src={item.preview} alt={item.file.name} className="h-[64px] w-full rounded-md bg-gray-100 object-cover" />}
                            <p className="m-0 mt-1.5 truncate text-[12px] text-gray-700 dark:text-slate-200">{item.file.name}</p>
                            <p className="m-0 text-[11px] text-gray-400">{fileSize(item.file.size)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className={stepTitle}>6.&nbsp;&nbsp;Steps to reproduce (optional but helpful)</p>
                  <div className="space-y-2">
                    {steps.map((step, index) => (
                      <div key={index} className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-[13px] font-semibold text-gray-600 dark:border-slate-700 dark:text-slate-300">{index + 1}</span>
                        <input className={field} value={step} maxLength={200} aria-label={`Step ${index + 1}`}
                          onChange={(event) => setSteps((current) => current.map((value, at) => (at === index ? event.target.value : value)))}
                          placeholder={["e.g. Go to Orders page", "e.g. Click on Filter", "e.g. The page shows a blank screen"][index] ?? "e.g. What happened next"} />
                        {steps.length > 3 && (
                          <button type="button" aria-label={`Remove step ${index + 1}`} onClick={() => setSteps((current) => current.filter((_, at) => at !== index))}
                            className="!min-h-0 rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"><X className="h-4 w-4" /></button>
                        )}
                      </div>
                    ))}
                  </div>
                  {steps.length < 10 && (
                    <div className="mt-3 flex justify-center">
                      <button type="button" onClick={() => setSteps((current) => [...current, ""])}
                        className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        <Plus className="h-4 w-4" /> Add another step
                      </button>
                    </div>
                  )}
                </div>

                {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">{error}</p>}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-slate-800">
                  <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-gray-700 dark:text-slate-200">
                    <input type="checkbox" className="h-4 w-4 accent-[#1F8FE0]" checked={wantsUpdates} onChange={(event) => setWantsUpdates(event.target.checked)} />
                    Send me updates about this report
                  </label>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => { reset(); onCancel(); }}
                      className="!min-h-0 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Cancel</button>
                    <button type="button" onClick={submit} disabled={saving}
                      className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-[#1F8FE0] px-6 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#1878c0] disabled:opacity-60">
                      <Send className="h-4 w-4" /> {saving ? "Sending…" : "Submit Report"}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Right column */}
            <aside className="space-y-5">
              <section className={`${card} p-5`}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><Lightbulb className="h-6 w-6" /></span>
                  <h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-100">Quick Tips</h2>
                </div>
                <ul className="m-0 list-none space-y-3 rounded-xl bg-emerald-50/70 p-4 dark:bg-emerald-500/10">
                  {["Take a clear screenshot showing the issue.", "Include any error message text.", "Mention the exact steps to reproduce the issue.", "Tell us which page or module you were on."].map((tip) => (
                    <li key={tip} className="flex items-start gap-2.5 text-[13px] text-gray-700 dark:text-slate-200">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 fill-emerald-500 text-white" /> {tip}
                    </li>
                  ))}
                </ul>
              </section>

              <section className={`${card} p-5`}>
                <div className="mb-4 flex items-start gap-3">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-500/10"><ImageIcon className="h-6 w-6" /></span>
                  <div>
                    <h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-100">Example Screenshot</h2>
                    <p className="m-0 mt-0.5 text-[12.5px] text-gray-500 dark:text-slate-400">Show the full page or the specific error you're seeing.</p>
                  </div>
                </div>
                <ExampleScreenshot />
              </section>

              <section className={`${card} p-5`}>
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/10"><FileText className="h-6 w-6" /></span>
                  <h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-100">Example Description</h2>
                </div>
                <div className="rounded-xl bg-blue-50/70 p-4 text-[12.5px] leading-relaxed text-gray-700 dark:bg-blue-500/10 dark:text-slate-200">
                  <p className="m-0"><b>Title:</b> Orders not loading</p>
                  <p className="m-0"><b>Description:</b> When I go to the Orders page and click on the filter, the page shows a blank screen with an error message “Failed to load orders. Please try again.” This started today.</p>
                  <div className="flex gap-1.5"><b>Steps:</b>
                    <ol className="m-0 list-decimal pl-4"><li>Go to Orders page</li><li>Click on Filter</li><li>See error message</li></ol>
                  </div>
                </div>
              </section>

              <section className={`${card} flex items-start gap-3 p-5`}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-500/10"><Clock className="h-6 w-6" /></span>
                <div>
                  <h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-100">Our Response</h2>
                  <p className="m-0 mt-1 text-[13px] text-gray-500 dark:text-slate-400">We usually review and respond to bug reports within 1–2 business days.</p>
                </div>
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function SelectBox({ icon: Icon, value, onChange, placeholder, options, disabled }: {
  icon: typeof Box; value: string; onChange: (value: string) => void; placeholder: string; options: string[]; disabled?: boolean;
}) {
  return (
    <label className={`relative flex items-center ${disabled ? "opacity-60" : ""}`}>
      <Icon className="pointer-events-none absolute left-3.5 h-4 w-4 text-gray-500" />
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
        className={`${field} appearance-none !pl-10 !pr-9 ${value ? "" : "!text-gray-500"}`}>
        <option value="">{placeholder}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 h-4 w-4 text-gray-500" />
    </label>
  );
}

/** A small drawn example of a good screenshot: the page, the error, the arrow. */
function ExampleScreenshot() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-white" aria-hidden="true">
      <div className="flex h-[200px]">
        <div className="w-[26%] space-y-1.5 bg-[#0F1B2D] p-2">
          <div className="mb-2 h-2.5 w-14 rounded bg-white/70" />
          {Array.from({ length: 12 }, (_, index) => <div key={index} className={`h-1.5 rounded ${index === 5 ? "w-4/5 bg-blue-500/80" : "w-3/4 bg-white/25"}`} />)}
        </div>
        <div className="flex-1 p-3">
          <div className="mb-3 h-2.5 w-12 rounded bg-gray-700" />
          <div className="mb-2 flex gap-2">{[16, 10, 12].map((w, i) => <div key={i} className="h-2 rounded bg-gray-200" style={{ width: `${w * 4}px` }} />)}</div>
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex items-center gap-2 border-t border-gray-100 py-1.5">
              <div className="h-1.5 w-6 rounded bg-blue-200" /><div className="h-1.5 w-14 rounded bg-gray-200" /><div className="h-1.5 flex-1 rounded bg-gray-100" /><div className="h-1.5 w-6 rounded bg-gray-200" />
            </div>
          ))}
        </div>
      </div>
      <div className="absolute right-2 top-2 w-[44%] rounded-md border-2 border-rose-500 bg-rose-50 px-2 py-1.5 shadow">
        <p className="m-0 flex items-center gap-1 text-[9px] font-bold text-rose-700"><span className="flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[7px] text-white">✕</span> Error</p>
        <p className="m-0 text-[8px] text-rose-600">Failed to load orders. Please try again.</p>
      </div>
      <svg className="absolute left-[50%] top-[22%] h-[70px] w-[70px] text-rose-500" viewBox="0 0 70 70" fill="none">
        <path d="M6 64 C 20 40, 34 26, 58 8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        <path d="M44 8 L60 6 L56 21" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute bottom-[34%] left-[38%] rounded-md border-2 border-rose-500 bg-white px-2 py-1 text-[11px] font-semibold leading-tight text-rose-600 shadow">
        Show what is wrong<br />in the screenshot
      </div>
    </div>
  );
}

/** Owner only: every report sent, newest first, with a status the sender sees. */
function ReportsInbox({ rows, setRows, showToast }: { rows: BugReport[] | null; setRows: (updater: (rows: BugReport[] | null) => BugReport[] | null) => void; showToast: (message: string) => void }) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const shown = useMemo(() => (rows ?? []).filter((row) => filter === "all" || row.status === "new" || row.status === "looking"), [rows, filter]);

  const setStatus = async (row: BugReport, status: BugReportStatus) => {
    try {
      const saved = await bugReportsApi.update(row.id, { status, ownerNote: notes[row.id] ?? row.ownerNote ?? null });
      setRows((current) => (current ?? []).map((item) => (item.id === saved.id ? saved : item)));
      showToast(row.wantsUpdates ? `Marked "${STATUS[status].label}". ${row.reporterName || "The sender"} has been told.` : `Marked "${STATUS[status].label}".`);
    } catch (err: any) { showToast(err?.message ?? "Could not update the report."); }
  };
  const openFile = async (row: BugReport, path: string) => {
    try { const { url } = await bugReportsApi.fileUrl(row.id, path); window.open(url, "_blank", "noopener"); }
    catch (err: any) { showToast(err?.message ?? "Could not open the file."); }
  };

  if (rows === null) return <div className={`${card} p-8 text-center text-[13px] text-gray-500`}>Loading reports…</div>;
  return (
    <section className={`${card} p-5`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-100">Reports received</h2>
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
          {(["open", "all"] as const).map((key) => (
            <button key={key} type="button" onClick={() => setFilter(key)}
              className={`!min-h-0 rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${filter === key ? "bg-white text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100" : "text-gray-500"}`}>
              {key === "open" ? "Still open" : "All"}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <p className="m-0 py-10 text-center text-[13px] text-gray-500">{filter === "open" ? "Nothing open. Every report has been dealt with." : "No reports yet."}</p> : (
        <div className="divide-y divide-gray-100 dark:divide-slate-800">
          {shown.map((row) => {
            const kind = KINDS.find((item) => item.key === row.kind)!;
            const KindIcon = kind.icon;
            const open = openId === row.id;
            return (
              <div key={row.id} className="py-3">
                <button type="button" onClick={() => setOpenId(open ? null : row.id)} className="!min-h-0 flex w-full items-start gap-3 text-left">
                  <KindIcon className={`mt-0.5 h-5 w-5 shrink-0 ${kind.tone}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-gray-900 dark:text-slate-100">{row.title}</span>
                    <span className="block text-[12px] text-gray-500">{row.reporterName || "Someone"} · {row.reporterRole} · {row.module}{row.page ? ` · ${row.page}` : ""} · {when(row.createdAt)}{row.attachments.length ? ` · ${row.attachments.length} file${row.attachments.length === 1 ? "" : "s"}` : ""}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${STATUS[row.status].cls}`}>{STATUS[row.status].label}</span>
                </button>
                {open && (
                  <div className="ml-8 mt-3 space-y-3 text-[13px] text-gray-700 dark:text-slate-200">
                    <p className="m-0 whitespace-pre-wrap">{row.description}</p>
                    {row.steps.length > 0 && <ol className="m-0 list-decimal pl-5">{row.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
                    {row.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {row.attachments.map((file) => (
                          <button key={file.path} type="button" onClick={() => openFile(row, file.path)}
                            className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-[#1F8FE0] hover:bg-blue-50 dark:border-slate-700">
                            <ImageIcon className="h-3.5 w-3.5" /> {file.name} <span className="text-gray-400">({fileSize(file.size)})</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <textarea className={`${field} min-h-[64px]`} rows={2} maxLength={1000} placeholder={row.wantsUpdates ? "Note to the sender (sent with the status)" : "Note (the sender did not ask for updates)"}
                      value={notes[row.id] ?? row.ownerNote ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} />
                    <div className="flex flex-wrap gap-2">
                      {(["looking", "fixed", "wont_fix", "new"] as BugReportStatus[]).filter((status) => status !== row.status).map((status) => (
                        <button key={status} type="button" onClick={() => setStatus(row, status)}
                          className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 hover:border-blue-300 hover:text-[#1F8FE0] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                          {status === "new" ? "Back to New" : `Mark: ${STATUS[status].label}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
