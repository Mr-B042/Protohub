import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Box, Bug, CheckCircle2, ChevronDown, ChevronRight, Circle, Clipboard, Clock, CloudUpload, FileText, GripVertical,
  Image as ImageIcon, Lightbulb, Link2, MessageCircle, MonitorPlay, PencilRuler, Plus, Send, Square, Trash2, Users, X
} from "lucide-react";
import {
  bugReportsApi, uploadToSignedUrl, type BugReport, type BugReportKind, type IssueAffected, type IssueDetails, type IssueFrequency,
  type IssueImpact, type IssueRefKind, type SimilarIssue
} from "../lib/api";
import { EXTRA_MODULES, partsFor } from "../lib/issue-modules";
import { captureEnvironment } from "../lib/report-environment";
import { recentErrorContext } from "../lib/error-recorder";
import ScreenshotAnnotator from "../components/ScreenshotAnnotator";

/**
 * Report a Bug / Send Feedback (Bright, 9 Oct 2026). Layout is Bright's
 * design (header, four tabs, numbered form, Quick Tips column); the content
 * is his Issue & Feedback Management spec:
 *   - the form changes with the type (bug / feature / UI-UX / other);
 *   - impact, who is affected, how often, and the affected order or customer;
 *   - "similar issues already reported" with "I'm experiencing this too";
 *   - upload, paste or record the screen, and mark up screenshots;
 *   - browser, device, page and recent failed requests attached automatically;
 *   - a ticket (BUG-1048) on submit, tracked in My Reports.
 */

type Props = {
  currentRole: string;
  userName: string;
  workspace: string;
  modules: string[];
  /** The page they were on before opening this one. */
  previousPage: string | null;
  showToast: (message: string) => void;
  onCancel: () => void;
  onViewReport: (id: string) => void;
};

const KINDS: Array<{ key: BugReportKind; tab: string; title: string; hint: string; icon: typeof Bug; tone: string }> = [
  { key: "issue", tab: "Report an Issue", title: "Bug / Technical Issue", hint: "Something is not working as expected", icon: Bug, tone: "text-violet-600" },
  { key: "feature", tab: "Suggest a Feature", title: "New Feature Suggestion", hint: "Share an idea or improvement", icon: Lightbulb, tone: "text-amber-500" },
  { key: "ux", tab: "UX/UI Feedback", title: "UI/UX Feedback", hint: "Design, layout or user experience", icon: PencilRuler, tone: "text-pink-500" },
  { key: "other", tab: "Other", title: "Other", hint: "Anything else", icon: MessageCircle, tone: "text-blue-600" }
];
const IMPACTS: Array<{ key: IssueImpact; label: string; hint: string; dot: string; on: string }> = [
  { key: "low", label: "Low", hint: "Minor inconvenience. Work can continue normally.", dot: "bg-blue-500", on: "border-blue-400 bg-blue-50 ring-blue-400" },
  { key: "medium", label: "Medium", hint: "Something isn't working correctly, but there's a workaround.", dot: "bg-amber-400", on: "border-amber-400 bg-amber-50 ring-amber-400" },
  { key: "high", label: "High", hint: "Important work is blocked or significantly affected.", dot: "bg-orange-500", on: "border-orange-400 bg-orange-50 ring-orange-400" },
  { key: "critical", label: "Critical", hint: "A major operation has stopped: customers, orders, payments or data are affected, or many people cannot work.", dot: "bg-rose-600", on: "border-rose-400 bg-rose-50 ring-rose-400" }
];
const AFFECTED: Array<{ key: IssueAffected; label: string }> = [
  { key: "only_me", label: "Only me" }, { key: "one_customer", label: "One customer / order" }, { key: "several_users", label: "Several users" },
  { key: "department", label: "One department" }, { key: "everyone", label: "Everyone" }, { key: "not_sure", label: "Not sure" }
];
const REF_KINDS: Array<{ key: IssueRefKind; label: string; placeholder: string }> = [
  { key: "order", label: "Order ID", placeholder: "e.g. 5036" }, { key: "customer", label: "Customer", placeholder: "Name or phone" },
  { key: "product", label: "Product", placeholder: "e.g. Edge Brusher Max" }, { key: "delivery", label: "Delivery", placeholder: "Order or waybill number" },
  { key: "sales_rep", label: "Sales Rep", placeholder: "e.g. Chidinma" }
];
const FREQUENCY: Array<{ key: IssueFrequency; label: string }> = [
  { key: "first_time", label: "First time" }, { key: "sometimes", label: "Sometimes" }, { key: "every_time", label: "Every time" },
  { key: "started_today", label: "Started today" }, { key: "several_days", label: "Has been happening for several days" }, { key: "not_sure", label: "Not sure" }
];
const FEATURE_USERS = ["Owner", "Manager", "Sales Rep", "Logistics", "Inventory", "Customers"];
const USEFULNESS = ["Daily", "Weekly", "Occasionally"];
const BENEFITS = ["Save time", "Increase sales", "Reduce errors", "Improve customer experience", "Improve reporting", "Improve workflow", "Other"];
const UX_PROBLEMS = ["Hard to understand", "Too many steps", "Information difficult to find", "Poor mobile experience", "Layout/design issue", "Button/action unclear", "Text difficult to understand", "Page feels slow", "Accessibility issue", "Other"];
const VAGUE_TITLES = /^(problem|issue|error|bug|help|check this|it'?s not working|not working|urgent|fix this|please fix)[.!\s]*$/i;

const ACCEPT = ["image/png", "image/jpeg", "image/gif", "image/webp", "video/mp4", "video/webm", "video/quicktime"];
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES = 5;

type Picked = { id: string; file: File; preview: string };
const fileSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const when = (iso: string) => new Date(iso).toLocaleString("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

const card = "rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900";
const field = "w-full rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-[13.5px] text-gray-800 placeholder:text-gray-400 outline-none focus:border-[#1F8FE0] focus:ring-2 focus:ring-[#1F8FE0]/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";
const label = "mb-1.5 block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300";
const stepTitle = "m-0 mb-2.5 text-[14px] font-bold text-gray-900 dark:text-slate-100";
const pill = (on: boolean) => `!min-h-0 rounded-full border px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${on ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/10" : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`;

export default function ReportBugPage({ currentRole, userName, workspace, modules, previousPage, showToast, onCancel, onViewReport }: Props) {
  const moduleOptions = useMemo(() => Array.from(new Set([...modules, ...EXTRA_MODULES])), [modules]);
  const startModule = previousPage && moduleOptions.includes(previousPage) ? previousPage : "";
  const [kind, setKind] = useState<BugReportKind>("issue");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState<IssueDetails>({});
  const [module, setModule] = useState(startModule);
  const [page, setPage] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [steps, setSteps] = useState<string[]>(["", "", ""]);
  const [dragStep, setDragStep] = useState<number | null>(null);
  const [impact, setImpact] = useState<IssueImpact | undefined>();
  const [affected, setAffected] = useState<IssueAffected | undefined>();
  const [refKind, setRefKind] = useState<IssueRefKind>("order");
  const [ref, setRef] = useState("");
  const [frequency, setFrequency] = useState<IssueFrequency | undefined>();
  const [wantsUpdates, setWantsUpdates] = useState(true);
  const [mayContact, setMayContact] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [annotating, setAnnotating] = useState<Picked | null>(null);
  const [recording, setRecording] = useState<{ recorder: MediaRecorder; stream: MediaStream; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [similar, setSimilar] = useState<SimilarIssue[]>([]);
  const [joined, setJoined] = useState<Record<string, boolean>>({});
  const [showTech, setShowTech] = useState(false);
  const [done, setDone] = useState<BugReport | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef(files);
  filesRef.current = files;

  const set = (patch: Partial<IssueDetails>) => setDetails((current) => ({ ...current, ...patch }));
  const toggle = (key: "users" | "benefits" | "uxProblems", value: string) => setDetails((current) => {
    const list = current[key] ?? [];
    return { ...current, [key]: list.includes(value) ? list.filter((item) => item !== value) : [...list, value] };
  });

  useEffect(() => () => filesRef.current.forEach((item) => URL.revokeObjectURL(item.preview)), []);

  // ── Files: upload, paste, record ──
  const addFiles = (list: FileList | File[]) => {
    const next: Picked[] = [];
    for (const file of Array.from(list)) {
      if (!ACCEPT.includes(file.type)) { showToast(`"${file.name}" is not a PNG, JPG, GIF, MP4 or WebM.`); continue; }
      if (file.size > MAX_FILE) { showToast(`"${file.name}" is over 25MB.`); continue; }
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
  const replaceFile = (id: string, file: File) => setFiles((current) => current.map((item) => {
    if (item.id !== id) return item;
    URL.revokeObjectURL(item.preview);
    return { ...item, file, preview: URL.createObjectURL(file) };
  }));

  // Ctrl/Cmd + V anywhere on the page attaches a copied screenshot.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (items.length === 0) return;
      event.preventDefault();
      addFiles(items.map((file, index) => new File([file], `pasted-screenshot-${Date.now()}-${index + 1}.png`, { type: file.type })));
      showToast("Screenshot pasted.");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const pasteFromClipboard = async () => {
    try {
      const items = await (navigator.clipboard as any).read();
      const blobs: File[] = [];
      for (const item of items) {
        const type = item.types.find((value: string) => value.startsWith("image/"));
        if (type) blobs.push(new File([await item.getType(type)], `pasted-screenshot-${Date.now()}.png`, { type }));
      }
      if (blobs.length) { addFiles(blobs); showToast("Screenshot pasted."); }
      else showToast("No screenshot copied yet. Take one, then press Paste (or Ctrl/Cmd + V).");
    } catch {
      showToast("Press Ctrl + V (Cmd + V on Mac) to paste the screenshot.");
    }
  };

  const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices && typeof MediaRecorder !== "undefined";
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 12 }, audio: false });
      const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find((value) => MediaRecorder.isTypeSupported(value)) ?? "";
      const recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 900_000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const mime = (recorder.mimeType || "video/webm").split(";")[0];
        addFiles([new File(chunks, `screen-recording-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.${mime === "video/mp4" ? "mp4" : "webm"}`, { type: mime })]);
        setRecording(null);
      };
      stream.getVideoTracks()[0]?.addEventListener("ended", () => { if (recorder.state === "recording") recorder.stop(); });
      recorder.start(1000);
      setElapsed(0);
      setRecording({ recorder, stream, started: Date.now() });
    } catch {
      showToast("Screen recording was cancelled or isn't allowed in this browser.");
    }
  };
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const seconds = Math.round((Date.now() - recording.started) / 1000);
      setElapsed(seconds);
      // About 3 minutes keeps a recording under 25MB at this quality.
      if (seconds >= 180 && recording.recorder.state === "recording") recording.recorder.stop();
    }, 500);
    return () => window.clearInterval(timer);
  }, [recording]);

  // ── Similar issues ──
  useEffect(() => {
    const text = title.trim();
    if (text.length < 10) { setSimilar([]); return; }
    const timer = window.setTimeout(() => {
      bugReportsApi.similar(text, module, kind).then(setSimilar).catch(() => setSimilar([]));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [title, module, kind]);
  const meToo = async (issue: SimilarIssue) => {
    try {
      await bugReportsApi.meToo(issue.id);
      setJoined((current) => ({ ...current, [issue.id]: true }));
      showToast(`Added you to ${issue.code}. You'll get its updates in My Reports.`);
    } catch (err: any) { showToast(err?.message ?? "Could not add you to that ticket."); }
  };

  const environment = useMemo(() => captureEnvironment({
    userName, userRole: currentRole, workspace, currentPage: module || previousPage || "", previousPage, previousUrl: null
  }), [userName, currentRole, workspace, module, previousPage]);
  const errorContext = recentErrorContext();

  const reset = () => {
    files.forEach((item) => URL.revokeObjectURL(item.preview));
    setTitle(""); setDetails({}); setModule(startModule); setPage(""); setFiles([]); setSteps(["", "", ""]);
    setImpact(undefined); setAffected(undefined); setRef(""); setFrequency(undefined); setWantsUpdates(true); setMayContact(true);
    setError(""); setSimilar([]); setJoined({}); setDone(null);
  };

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed.length < 10) { setError("Make the title at least 10 characters - say the page and what went wrong."); return; }
    if (VAGUE_TITLES.test(trimmed)) { setError("That title is too general. Say the page and what went wrong, e.g. \"Orders page becomes blank after applying Status filter\"."); return; }
    if (kind === "issue" && !details.actual?.trim()) { setError("Say what actually happened."); return; }
    if (kind === "feature" && !details.problem?.trim()) { setError("Say what problem this would solve."); return; }
    if (kind === "ux" && !(details.uxProblems?.length) && !details.goal?.trim()) { setError("Choose what the problem is."); return; }
    if (kind === "other" && !details.more?.trim()) { setError("Tell us more."); return; }
    if (!module) { setError("Choose where this happened."); return; }
    if (kind !== "feature" && !impact) { setError("Choose how much this is affecting your work."); return; }
    if (recording) { setError("Stop the screen recording first."); return; }
    setSaving("Sending your report…");
    setError("");
    try {
      const { report, uploads } = await bugReportsApi.create({
        kind, title: trimmed, details, module, page: page || undefined,
        steps: kind === "feature" ? [] : steps.map((step) => step.trim()).filter(Boolean),
        impact: kind === "feature" ? undefined : impact,
        affected: kind === "feature" ? undefined : affected,
        affectedRefKind: ref.trim() ? refKind : undefined, affectedRef: ref.trim() || undefined,
        frequency: kind === "issue" ? frequency : undefined,
        environment, errorContext, wantsUpdates, mayContact,
        files: files.map((item) => ({ name: item.file.name, mime: item.file.type, size: item.file.size }))
      });
      if (uploads.length) {
        const sent: Array<{ path: string; name: string }> = [];
        for (let index = 0; index < uploads.length; index += 1) {
          setSaving(`Uploading file ${index + 1} of ${uploads.length}…`);
          try { await uploadToSignedUrl(uploads[index].signedUrl, files[index].file); sent.push({ path: uploads[index].path, name: uploads[index].name }); }
          catch { showToast(`"${uploads[index].name}" didn't upload. The report was still sent.`); }
        }
        if (sent.length) await bugReportsApi.attach(report.id, sent);
      }
      files.forEach((item) => URL.revokeObjectURL(item.preview));
      setFiles([]);
      setDone(report);
    } catch (err: any) {
      setError(err?.message ?? "Could not send the report.");
    } finally {
      setSaving("");
    }
  };

  const kindMeta = KINDS.find((item) => item.key === kind)!;
  // Section numbers follow what the chosen type actually shows.
  const sections = [
    "type", "title", "describe", "where", "evidence",
    ...(kind === "feature" ? [] : ["steps", "impact", "affected"]),
    ...(kind === "issue" ? ["frequency"] : [])
  ];
  const n = (key: string) => `${sections.indexOf(key) + 1}.`;

  if (done) {
    const impactMeta = IMPACTS.find((item) => item.key === done.impact);
    return (
      <div className="mx-auto w-full max-w-[720px] py-10">
        <section className={`${card} p-8 text-center`}>
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-9 w-9" /></span>
          <h1 className="m-0 mt-4 text-[22px] font-bold text-gray-900 dark:text-slate-50">Report submitted</h1>
          <p className="m-0 mt-3 font-mono text-[26px] font-black tracking-wide text-[#1F8FE0]">{done.code}</p>
          <p className="m-0 mt-2 text-[15px] font-semibold text-gray-800 dark:text-slate-100">{done.title}</p>
          <div className="mx-auto mt-5 grid max-w-[460px] grid-cols-3 gap-3 text-left text-[12.5px]">
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800"><span className="block text-gray-500">Status</span><b className="text-gray-900 dark:text-slate-100">New</b></div>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800"><span className="block text-gray-500">Impact</span><b className="text-gray-900 dark:text-slate-100">{impactMeta?.label ?? "—"}</b></div>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800"><span className="block text-gray-500">Submitted</span><b className="text-gray-900 dark:text-slate-100">{when(done.createdAt)}</b></div>
          </div>
          <p className="m-0 mt-5 text-[13px] text-gray-500">Quote <b>{done.code}</b> if you mention it to anyone.{done.wantsUpdates ? " You'll be notified as it moves." : ""}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button type="button" onClick={() => onViewReport(done.id)} className="!min-h-0 rounded-lg bg-[#1F8FE0] px-6 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#1878c0]">View Report</button>
            <button type="button" onClick={reset} className="!min-h-0 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Submit Another</button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1280px] pb-8">
      {/* Header */}
      <div className="mb-5 flex items-center gap-4">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-[#1F8FE0] dark:bg-blue-500/15">
          <Bug className="h-8 w-8" strokeWidth={2.25} />
        </span>
        <div>
          <h1 className="m-0 text-[26px] font-bold leading-tight text-gray-900 dark:text-slate-50">Report a Bug / Send Feedback</h1>
          <p className="m-0 mt-1 text-[14.5px] text-gray-500 dark:text-slate-400">Found an issue or have a suggestion? Let us know so we can make Protohub better.</p>
        </div>
      </div>

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
        <section className={`${card} p-5 sm:p-6`}>
          <div className="space-y-7">
            {/* Type */}
            <div>
              <p className={stepTitle}>{n("type")}&nbsp;&nbsp;What type of report is this?</p>
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

            {/* Title + similar issues */}
            <div>
              <p className={stepTitle}>{n("title")}&nbsp;&nbsp;Give a short title</p>
              <input className={field} value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)}
                placeholder={kind === "issue" ? "e.g. Orders page becomes blank after applying Status filter" : kind === "feature" ? "e.g. Add bulk order assignment" : kind === "ux" ? "e.g. Order table is difficult to use on mobile" : "e.g. Question about how bonuses are worked out"} />
              <div className="mt-1 flex items-center justify-between gap-3 text-[11.5px]">
                <span className={title.trim().length > 0 && (title.trim().length < 10 || VAGUE_TITLES.test(title.trim())) ? "font-semibold text-amber-700" : "text-gray-500"}>
                  Be specific — mention the page and what went wrong.{title.trim().length > 0 && title.trim().length < 10 ? ` (${10 - title.trim().length} more characters)` : ""}
                </span>
                <span className="text-gray-400">{title.length}/100</span>
              </div>
              {similar.length > 0 && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="m-0 mb-2 flex items-center gap-2 text-[13px] font-bold text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4" /> Similar issues already reported</p>
                  <div className="space-y-2">
                    {similar.map((issue) => (
                      <div key={issue.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 dark:bg-slate-900">
                        <div className="min-w-0">
                          <p className="m-0 truncate text-[13px] font-semibold text-gray-900 dark:text-slate-100"><span className="font-mono text-[#1F8FE0]">{issue.code}</span> — {issue.title}</p>
                          <p className="m-0 text-[11.5px] text-gray-500"><Users className="mr-1 inline h-3 w-3" />{issue.affectedCount} {issue.affectedCount === 1 ? "person" : "people"} affected · {issue.statusLabel}</p>
                        </div>
                        {issue.mine ? <span className="text-[12px] font-semibold text-gray-500">You reported this</span>
                          : joined[issue.id] ? <span className="text-[12px] font-semibold text-emerald-700">✓ Added - you'll get its updates</span>
                            : <button type="button" onClick={() => meToo(issue)} className="!min-h-0 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-800 hover:bg-amber-100">I'm experiencing this too</button>}
                      </div>
                    ))}
                  </div>
                  <p className="m-0 mt-2 text-[11.5px] text-amber-800/80 dark:text-amber-200/80">If one of these is yours, press "I'm experiencing this too" instead of sending a new report - it raises its importance.</p>
                </div>
              )}
            </div>

            {/* The type's own questions */}
            <div>
              <p className={stepTitle}>{n("describe")}&nbsp;&nbsp;{kind === "issue" ? "Describe the issue in detail" : kind === "feature" ? "Describe your idea" : kind === "ux" ? "What could look or work better?" : "Tell us more"}</p>
              {kind === "issue" && (
                <div className="space-y-3">
                  <TextArea labelText="What were you trying to do?" value={details.tried} onChange={(value) => set({ tried: value })} placeholder="e.g. I was trying to assign Order #5036 to Chidinma." />
                  <TextArea labelText="What actually happened?" required value={details.actual} onChange={(value) => set({ actual: value })} placeholder="e.g. After selecting Chidinma and clicking Assign, the loading icon stayed on screen and the order was not assigned." />
                  <TextArea labelText="What did you expect to happen?" value={details.expected} onChange={(value) => set({ expected: value })} placeholder="e.g. The order should be assigned immediately and Chidinma should appear under Assigned To." />
                  <div>
                    <span className={label}>Error message (optional)</span>
                    <input className={field} maxLength={500} value={details.errorMessage ?? ""} onChange={(event) => set({ errorMessage: event.target.value })} placeholder="e.g. Failed to update order. Please try again." />
                  </div>
                </div>
              )}
              {kind === "feature" && (
                <div className="space-y-4">
                  <TextArea labelText="What problem are you trying to solve?" required value={details.problem} onChange={(value) => set({ problem: value })} placeholder="e.g. When we receive many orders, managers assign them one by one." />
                  <TextArea labelText="Suggested solution" value={details.solution} onChange={(value) => set({ solution: value })} placeholder="e.g. Let managers select several orders and assign them to one rep." />
                  <div>
                    <span className={label}>Who would use this?</span>
                    <div className="flex flex-wrap gap-2">{FEATURE_USERS.map((value) => <button key={value} type="button" className={pill((details.users ?? []).includes(value))} onClick={() => toggle("users", value)}>{value}</button>)}</div>
                  </div>
                  <div>
                    <span className={label}>How often would this be useful?</span>
                    <div className="flex flex-wrap gap-2">{USEFULNESS.map((value) => <button key={value} type="button" className={pill(details.usefulness === value)} onClick={() => set({ usefulness: details.usefulness === value ? undefined : value })}>{value}</button>)}</div>
                  </div>
                  <div>
                    <span className={label}>Expected benefit</span>
                    <div className="flex flex-wrap gap-2">{BENEFITS.map((value) => <button key={value} type="button" className={pill((details.benefits ?? []).includes(value))} onClick={() => toggle("benefits", value)}>{value}</button>)}</div>
                    {(details.benefits ?? []).includes("Other") && <input className={`${field} mt-2`} maxLength={200} value={details.benefitOther ?? ""} onChange={(event) => set({ benefitOther: event.target.value })} placeholder="What other benefit?" />}
                  </div>
                </div>
              )}
              {kind === "ux" && (
                <div className="space-y-4">
                  <div>
                    <span className={label}>What is the problem? <span className="text-rose-500">*</span></span>
                    <div className="flex flex-wrap gap-2">{UX_PROBLEMS.map((value) => <button key={value} type="button" className={pill((details.uxProblems ?? []).includes(value))} onClick={() => toggle("uxProblems", value)}>{value}</button>)}</div>
                    {(details.uxProblems ?? []).includes("Other") && <input className={`${field} mt-2`} maxLength={200} value={details.uxOther ?? ""} onChange={(event) => set({ uxOther: event.target.value })} placeholder="What else?" />}
                  </div>
                  <TextArea labelText="What were you trying to accomplish?" value={details.goal} onChange={(value) => set({ goal: value })} placeholder="e.g. Find a customer's last order quickly on my phone." />
                  <TextArea labelText="What would make this easier?" value={details.improvement} onChange={(value) => set({ improvement: value })} placeholder="e.g. A bigger search box at the top of the Orders page." />
                </div>
              )}
              {kind === "other" && (
                <TextArea labelText="Tell us what's on your mind" required value={details.more} onChange={(value) => set({ more: value })} placeholder="Anything that doesn't fit a bug, an idea or a design problem." />
              )}
            </div>

            {/* Where */}
            <div>
              <p className={stepTitle}>{n("where")}&nbsp;&nbsp;Where did this happen?</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectBox icon={Box} value={module} onChange={(value) => { setModule(value); setPage(""); }} placeholder="Select module / page" options={moduleOptions} />
                <SelectBox icon={Link2} value={page} onChange={setPage} placeholder="Select specific page (optional)" options={module ? partsFor(module) : []} disabled={!module} />
              </div>
              {previousPage && <p className="m-0 mt-1.5 text-[11.5px] text-gray-500">You were on <b>{previousPage}</b> before opening this page{module === previousPage ? " - already filled in. Change it if needed." : "."}</p>}
            </div>

            {/* Evidence */}
            <div>
              <p className={stepTitle}>{n("evidence")}&nbsp;&nbsp;Add a screenshot or screen recording (optional)</p>
              <div className="mb-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => inputRef.current?.click()} className={pill(false)}><CloudUpload className="mr-1.5 inline h-4 w-4" />Upload Screenshot</button>
                <button type="button" onClick={pasteFromClipboard} className={pill(false)}><Clipboard className="mr-1.5 inline h-4 w-4" />Paste Screenshot</button>
                {canRecord && (recording
                  ? <button type="button" onClick={() => recording.recorder.stop()} className="!min-h-0 rounded-full border border-rose-300 bg-rose-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-rose-700"><Square className="mr-1.5 inline h-3.5 w-3.5 fill-rose-600" />Stop recording ({Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")})</button>
                  : <button type="button" onClick={startRecording} className={pill(false)}><MonitorPlay className="mr-1.5 inline h-4 w-4" />Record Screen</button>)}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <button type="button" onClick={() => inputRef.current?.click()}
                  onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files); }}
                  className={`!min-h-0 flex min-h-[112px] flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${dragging ? "border-[#1F8FE0] bg-blue-50" : "border-gray-300 bg-gray-50/40 hover:border-[#1F8FE0] dark:border-slate-600 dark:bg-slate-800/40"}`}>
                  <CloudUpload className="h-7 w-7 text-[#1F8FE0]" />
                  <span className="mt-2 text-[13px] text-gray-600 dark:text-slate-300"><b className="font-semibold text-[#1F8FE0]">Click to upload</b> or drag and drop</span>
                  <span className="mt-1 text-[11.5px] text-gray-400">PNG, JPG, GIF, MP4 or WebM up to 25MB · up to 5 files · or press Ctrl/Cmd + V</span>
                </button>
                <input ref={inputRef} type="file" accept={ACCEPT.join(",")} multiple className="hidden"
                  onChange={(event) => { if (event.target.files?.length) addFiles(event.target.files); event.target.value = ""; }} />
                {files.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {files.map((item) => {
                      const video = item.file.type.startsWith("video/");
                      return (
                        <div key={item.id} className="relative overflow-hidden rounded-xl border border-gray-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
                          <button type="button" aria-label={`Remove ${item.file.name}`} onClick={() => removeFile(item.id)}
                            className="!min-h-0 absolute right-1.5 top-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white text-gray-700 shadow ring-1 ring-gray-200 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
                          {video ? <video src={item.preview} className="h-[64px] w-full rounded-md bg-gray-100 object-cover" muted />
                            : <img src={item.preview} alt={item.file.name} className="h-[64px] w-full rounded-md bg-gray-100 object-cover" />}
                          <p className="m-0 mt-1.5 truncate text-[12px] text-gray-700 dark:text-slate-200">{item.file.name}</p>
                          <div className="flex items-center justify-between">
                            <p className="m-0 text-[11px] text-gray-400">{fileSize(item.file.size)}</p>
                            {!video && item.file.type !== "image/gif" && <button type="button" onClick={() => setAnnotating(item)} className="!min-h-0 text-[11.5px] font-semibold text-[#1F8FE0] hover:underline">Annotate</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Steps (not for feature ideas) */}
            {kind !== "feature" && (
              <div>
                <p className={stepTitle}>{n("steps")}&nbsp;&nbsp;Steps to reproduce {kind === "issue" ? "(strongly encouraged)" : "(optional but helpful)"}</p>
                {kind === "issue" && <p className="m-0 mb-2.5 rounded-lg bg-blue-50/70 px-3 py-2 text-[12px] text-blue-900 dark:bg-blue-500/10 dark:text-blue-200"><b>Why we need this:</b> these steps let the technical team recreate the exact problem.</p>}
                <div className="space-y-2">
                  {steps.map((step, index) => (
                    <div key={index} className={`flex items-center gap-2 rounded-lg ${dragStep === index ? "opacity-50" : ""}`}
                      draggable onDragStart={() => setDragStep(index)} onDragEnd={() => setDragStep(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        if (dragStep === null || dragStep === index) return;
                        setSteps((current) => { const next = [...current]; const [moved] = next.splice(dragStep, 1); next.splice(index, 0, moved); return next; });
                        setDragStep(index);
                      }}>
                      <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-gray-300" aria-label="Drag to reorder" />
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-[13px] font-semibold text-gray-600 dark:border-slate-700 dark:text-slate-300">{index + 1}</span>
                      <input className={field} value={step} maxLength={300} aria-label={`Step ${index + 1}`}
                        onChange={(event) => setSteps((current) => current.map((value, at) => (at === index ? event.target.value : value)))}
                        placeholder={["e.g. Go to Orders page", "e.g. Click on Filter", "e.g. The page shows a blank screen"][index] ?? "e.g. What happened next"} />
                      <button type="button" aria-label={`Delete step ${index + 1}`} disabled={steps.length <= 1} onClick={() => setSteps((current) => current.filter((_, at) => at !== index))}
                        className="!min-h-0 rounded-md p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
                {steps.length < 15 && (
                  <div className="mt-3 flex justify-center">
                    <button type="button" onClick={() => setSteps((current) => [...current, ""])}
                      className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] font-medium text-gray-700 hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      <Plus className="h-4 w-4" /> Add another step
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Impact */}
            {kind !== "feature" && (
              <div>
                <p className={stepTitle}>{n("impact")}&nbsp;&nbsp;How much is this affecting your work?</p>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {IMPACTS.map((item) => {
                    const on = impact === item.key;
                    return (
                      <button key={item.key} type="button" onClick={() => setImpact(item.key)}
                        className={`!min-h-0 rounded-xl border p-3 text-left transition-colors ${on ? `${item.on} ring-1` : "border-gray-200 bg-white hover:border-gray-300 dark:border-slate-700 dark:bg-slate-900"}`}>
                        <span className={`flex items-center gap-2 text-[13.5px] font-bold ${on ? "text-gray-900" : "text-gray-900 dark:text-slate-100"}`}><span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />{item.label}</span>
                        <span className={`mt-0.5 block text-[12px] leading-snug ${on ? "text-gray-700" : "text-gray-600 dark:text-slate-400"}`}>{item.hint}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="m-0 mt-1.5 text-[11.5px] text-gray-500">You tell us the impact. The technical team sets the priority.</p>
              </div>
            )}

            {/* Who is affected */}
            {kind !== "feature" && (
              <div>
                <p className={stepTitle}>{n("affected")}&nbsp;&nbsp;Who is affected?</p>
                <div className="flex flex-wrap gap-2">{AFFECTED.map((item) => <button key={item.key} type="button" className={pill(affected === item.key)} onClick={() => setAffected(affected === item.key ? undefined : item.key)}>{item.label}</button>)}</div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[190px_minmax(0,1fr)]">
                  <select className={field} value={refKind} onChange={(event) => setRefKind(event.target.value as IssueRefKind)} aria-label="Affected item type">
                    {REF_KINDS.map((item) => <option key={item.key} value={item.key}>Affected {item.label.toLowerCase()}</option>)}
                  </select>
                  <input className={field} maxLength={80} value={ref} onChange={(event) => setRef(event.target.value)} placeholder={`${REF_KINDS.find((item) => item.key === refKind)?.placeholder} (optional)`} />
                </div>
              </div>
            )}

            {/* Frequency */}
            {kind === "issue" && (
              <div>
                <p className={stepTitle}>{n("frequency")}&nbsp;&nbsp;How often does this happen?</p>
                <div className="flex flex-wrap gap-2">{FREQUENCY.map((item) => <button key={item.key} type="button" className={pill(frequency === item.key)} onClick={() => setFrequency(frequency === item.key ? undefined : item.key)}>{item.label}</button>)}</div>
              </div>
            )}

            {/* What is attached automatically */}
            <div className="rounded-xl border border-gray-200 bg-gray-50/60 dark:border-slate-700 dark:bg-slate-800/40">
              <button type="button" onClick={() => setShowTech(!showTech)} className="!min-h-0 flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="text-[13px] font-semibold text-gray-800 dark:text-slate-100">Technical details we attach automatically</span>
                {showTech ? <ChevronDown className="h-4 w-4 text-gray-500" /> : <ChevronRight className="h-4 w-4 text-gray-500" />}
              </button>
              {showTech && (
                <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 border-t border-gray-200 px-4 py-3 text-[12px] text-gray-600 dark:border-slate-700 dark:text-slate-300 sm:grid-cols-2">
                  <span><b>Environment:</b> {environment.browser} {environment.browserVersion} · {environment.os} · {environment.device} · {environment.screen}</span>
                  <span><b>You:</b> {userName} · {currentRole} · {workspace}</span>
                  <span><b>Page:</b> {environment.currentPage || "—"} · {environment.url}</span>
                  <span><b>Application:</b> Protohub Web · Build {environment.appBuild}</span>
                  <span><b>Time:</b> {when(environment.capturedAt)} · {environment.timezone}</span>
                  <span><b>Network:</b> {environment.online ? "Online" : "Offline"}{environment.connection ? ` · ${environment.connection}` : ""} · Session {environment.sessionId}</span>
                  <span className="sm:col-span-2"><b>Recent problems in this session:</b> {errorContext.failedRequests.length} failed request{errorContext.failedRequests.length === 1 ? "" : "s"}, {errorContext.browserErrors.length} page error{errorContext.browserErrors.length === 1 ? "" : "s"}{errorContext.failedRequests[0] ? ` (latest: ${errorContext.failedRequests[0].method} ${errorContext.failedRequests[0].path} → ${errorContext.failedRequests[0].status || "no answer"})` : ""}. Passwords and sign-in tokens are removed.</span>
                </div>
              )}
            </div>

            {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">{error}</p>}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-slate-800">
              <div className="space-y-1.5">
                <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-gray-700 dark:text-slate-200">
                  <input type="checkbox" className="h-4 w-4 accent-[#1F8FE0]" checked={wantsUpdates} onChange={(event) => setWantsUpdates(event.target.checked)} />
                  Send me updates about this report
                </label>
                <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-gray-700 dark:text-slate-200">
                  <input type="checkbox" className="h-4 w-4 accent-[#1F8FE0]" checked={mayContact} onChange={(event) => setMayContact(event.target.checked)} />
                  Allow the technical team to contact me for more information
                </label>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => { reset(); onCancel(); }}
                  className="!min-h-0 rounded-lg border border-gray-200 bg-white px-6 py-2.5 text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Cancel</button>
                <button type="button" onClick={submit} disabled={!!saving}
                  className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-[#1F8FE0] px-6 py-2.5 text-[13.5px] font-semibold text-white hover:bg-[#1878c0] disabled:opacity-60">
                  <Send className="h-4 w-4" /> {saving || "Submit Report"}
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
          <section className={`${card} p-5 text-[12.5px] text-gray-600 dark:text-slate-300`}>
            <p className="m-0 flex items-center gap-2 font-semibold text-gray-800 dark:text-slate-100"><Circle className="h-3 w-3 fill-[#1F8FE0] text-[#1F8FE0]" /> {kindMeta.tab}</p>
            <p className="m-0 mt-1">Every report gets a ticket number you can follow in <b>My Reports</b>.</p>
          </section>
        </aside>
      </div>

      {annotating && (
        <ScreenshotAnnotator file={annotating.file} onClose={() => setAnnotating(null)}
          onDone={(file) => { replaceFile(annotating.id, file); setAnnotating(null); showToast("Marked-up screenshot attached."); }} />
      )}
    </div>
  );
}

function TextArea({ labelText, value, onChange, placeholder, required }: { labelText: string; value?: string; onChange: (value: string) => void; placeholder: string; required?: boolean }) {
  return (
    <div>
      <span className={label}>{labelText}{required && <span className="text-rose-500"> *</span>}</span>
      <textarea className={`${field} min-h-[72px] resize-y`} rows={3} maxLength={1000} value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <p className="m-0 mt-0.5 text-right text-[11px] text-gray-400">{(value ?? "").length}/1000</p>
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
