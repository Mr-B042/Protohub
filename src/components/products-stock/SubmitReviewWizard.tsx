import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, ArrowRight, Box, CalendarDays, Camera, Check, ChevronDown, ClipboardList, Clock3, Crown, Eye, FileText, Gift, Image as ImageIcon, Info,
  Layers, Loader2, MessageSquare, Phone, Play, RotateCcw, Search, Send, ShieldCheck, ShoppingBag, Star, ThumbsUp, User, Video, X
} from "lucide-react";
import { WhatsAppIcon } from "../WhatsAppIcon";
import { customerReviewsApi, productMediaApi, type ReviewAmounts, type ReviewChannel, type ReviewMediaShows, type ReviewOrderChoice, type ReviewType } from "../../lib/api";
import { PHOTO_MAX_BYTES, fileProblem, kindOfFile, mimeOf, shrinkPhoto, uploadWithProgress, videoCover } from "../../lib/media-upload";

/**
 * Submit Customer Review, built to Bright's three designs (7 Nov 2026):
 * 1 Select Customer (the rep's own delivered order and the type), 2 Add Review
 * (what it shows, the customer's words, the photo or video), 3 Verify & Submit
 * (the details, the WhatsApp screenshot with the customer's number, the two
 * permission ticks and the bonus). Nothing is saved until Submit: then the
 * review is started, its files sent, and it goes to a manager.
 */

type Limits = { maxImageMb: number; maxVideoMb: number; imageTypes: string[]; videoTypes: string[] } | null;
type MediaItem = { id: string; file: File; preview: string; kind: "image" | "video"; problem: string | null };
type Step = 1 | 2 | 3;

const TYPE_META: Record<ReviewType, { title: string; short: string; desc: string; Icon: typeof FileText; word: string }> = {
  written: { title: "Written Review", short: "Written", desc: "Customer's feedback in text (e.g. experience, quality, etc.)", Icon: FileText, word: "text" },
  photo: { title: "Product Photo", short: "Photo", desc: "A clear photo of the product received or in use.", Icon: Camera, word: "photo" },
  video: { title: "Video Review", short: "Video", desc: "A short video of the customer sharing their experience.", Icon: Video, word: "video" }
};
const SHOWS: Array<[ReviewMediaShows, string]> = [["product_in_use", "Product in use"], ["unboxing", "Unboxing"], ["size", "Size / measurements"], ["packaging", "Packaging"], ["other", "Other"]];
const CHANNELS: Array<[ReviewChannel, string]> = [["whatsapp", "WhatsApp"], ["call", "Phone call"], ["sms", "SMS"], ["in_person", "In person"], ["other", "Other"]];
const STEPS = [
  { n: 1 as Step, title: "Select Customer", sub: "Find a delivered order", done: "Delivered order selected" },
  { n: 2 as Step, title: "Add Review", sub: "Upload feedback (photo, video or text)", done: "Review and media added" },
  { n: 3 as Step, title: "Verify & Submit", sub: "Confirm details and send for approval", done: "Confirm details and send for approval" }
];
const COMMENT_MAX = 500;
const TYPE_KEY: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

const naira = (amount: number) => `₦${Math.round(amount).toLocaleString("en-NG")}`;
const lagosToday = () => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 10);
const dayText = (key: string | null, twoDigit = false) => (key
  ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: twoDigit ? "2-digit" : "numeric", month: "short", year: "numeric", timeZone: "UTC" })
  : "—");
/** 08034567890 -> 0803 456 7890. */
const phoneText = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return /^0\d{10}$/.test(digits) ? `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}` : phone;
};
let mediaSeq = 0;

function limitProblem(file: File, limits: Limits): string | null {
  if (!limits) return null;
  const kind = kindOfFile(file);
  if (!kind) return null;
  const key = TYPE_KEY[mimeOf(file, kind)];
  const allowed = kind === "image" ? limits.imageTypes : limits.videoTypes;
  if (key && !allowed.includes(key)) return `${key.toUpperCase()} files are switched off.`;
  if (kind === "video" && file.size > limits.maxVideoMb * 1024 * 1024) return `Videos must be ${limits.maxVideoMb} MB or smaller.`;
  return null;
}
const toMedia = (files: File[], limits: Limits): MediaItem[] => files.flatMap((file) => {
  const kind = kindOfFile(file);
  return kind ? [{ id: `m${++mediaSeq}`, file, preview: URL.createObjectURL(file), kind, problem: fileProblem(file) ?? limitProblem(file, limits) }] : [];
});

// ── Pieces ──────────────────────────────────────────────────────────────────

const primaryButton = "!min-h-0 inline-flex items-center justify-center gap-2.5 rounded-[12px] bg-gradient-to-r from-[#0A6CE3] to-[#0350C5] px-5 text-[16px] font-extrabold text-white shadow-[0_6px_16px_rgba(10,90,210,0.28)] hover:from-[#0962D1] hover:to-[#0347AF] disabled:opacity-60 sm:px-8 sm:text-[19px]";
const outlineButton = "!min-h-0 inline-flex items-center justify-center gap-2 rounded-[12px] border border-[#C9D3E0] bg-white px-5 text-[16px] font-bold text-[#0F172A] hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:px-8 sm:text-[19px]";
const card = "rounded-[16px] border border-[#DCE5F0] bg-white dark:border-slate-700 dark:bg-slate-900";
const fieldLabel = "mb-2 block text-[16px] font-extrabold text-[#0F172A] sm:text-[17px] dark:text-slate-100";

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="m-0 flex list-none items-center p-0">
      {STEPS.map((item, index) => {
        const state = step > item.n ? "done" : step === item.n ? "now" : "next";
        return (
          <li key={item.n} className={`flex min-w-0 items-center ${state === "now" ? "flex-1" : "flex-none md:flex-1"}`}>
            <div className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-full border p-1.5 sm:gap-3 sm:px-3 sm:py-2.5 ${state === "now"
              ? "border-[#A9CBF6] bg-gradient-to-r from-[#EEF5FF] to-[#DFEBFD] shadow-[0_3px_12px_rgba(11,94,215,0.14)] dark:border-blue-500/40 dark:from-blue-500/15 dark:to-blue-500/10"
              : "border-[#E2E8F0] bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[16px] font-extrabold sm:h-11 sm:w-11 sm:text-[19px] ${state === "done"
                ? "bg-[#22B04B] text-white" : state === "now" ? "bg-[#0B63D6] text-white" : "bg-[#E9EDF2] text-[#4C5668] dark:bg-slate-800 dark:text-slate-300"}`}>
                {state === "done" ? <Check className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={3} /> : item.n}
              </span>
              <span className={`min-w-0 ${state === "now" ? "block" : "hidden md:block"}`}>
                <b className={`block truncate text-[15px] font-extrabold sm:text-[17px] ${state === "now" ? "text-[#0B5ED7] dark:text-blue-300" : "text-[#0F172A] dark:text-slate-100"}`}>{item.title}</b>
                <span className={`hidden truncate text-[13px] lg:block ${state === "now" ? "text-[#0B5ED7] dark:text-blue-300" : "text-gray-600 dark:text-slate-400"}`}>{state === "done" ? item.done : item.sub}</span>
              </span>
            </div>
            {index < STEPS.length - 1 && <span className={`h-[3px] w-4 shrink-0 sm:w-6 ${step > item.n || step === item.n ? "bg-[#0B63D6]" : "bg-[#D5DCE5] dark:bg-slate-700"}`} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/** The left column: name, a picture, the bonus list and the rules. Hidden on phones. */
function SidePanel({ amounts, image }: { amounts: ReviewAmounts | null; image: string | null }) {
  const rows: Array<{ Icon: typeof FileText; label: string; sub?: string; amount: number | undefined; gold?: boolean }> = [
    { Icon: FileText, label: "Written Review", amount: amounts?.written },
    { Icon: ImageIcon, label: "Product Photo", amount: amounts?.photo },
    { Icon: Video, label: "Video Review", amount: amounts?.video },
    { Icon: Crown, label: "Premium Video", sub: "(Manager Upgrade)", amount: amounts?.premium, gold: true }
  ];
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-5 overflow-y-auto border-r border-[#DCE7F7] bg-gradient-to-b from-[#F3F7FE] to-[#E7F0FC] p-6 lg:flex xl:w-[335px] dark:border-slate-800 dark:from-slate-900 dark:to-slate-950">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] bg-gradient-to-b from-[#1C7BEA] to-[#0B5ED7] text-white shadow-sm"><ShoppingBag className="h-6 w-6" /></span>
        <b className="text-[24px] font-black tracking-[-0.01em] text-[#0F172A] dark:text-slate-50">ProtoHub OSM</b>
      </div>

      {/* A phone showing the product, a five-star card and a thumbs-up, like the design. */}
      <div className="relative mx-auto h-[250px] w-[260px]" aria-hidden="true">
        <span className="absolute right-0 top-12 h-[180px] w-[170px] rotate-[8deg] rounded-[28px] bg-[#D9E7FB] dark:bg-slate-800" />
        <span className="absolute right-6 top-0 h-6 w-1 rotate-[20deg] rounded-full bg-[#2F7DF6]" />
        <span className="absolute right-0 top-5 h-1 w-6 -rotate-[20deg] rounded-full bg-[#2F7DF6]" />
        <div className="absolute left-[66px] top-5 h-[225px] w-[150px] -rotate-[6deg] rounded-[26px] border-[7px] border-[#1E293B] bg-[#1E293B] shadow-2xl">
          <div className="relative h-full w-full overflow-hidden rounded-[18px] bg-gradient-to-b from-[#FDE7C8] to-[#F3C287]">
            {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Box className="absolute left-1/2 top-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 text-[#B7793A]" />}
            <span className="absolute left-1/2 top-1/2 inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-black/35">
              <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
            </span>
          </div>
          <span className="absolute left-1/2 top-1 h-1.5 w-12 -translate-x-1/2 rounded-full bg-[#334155]" />
        </div>
        <span className="absolute left-0 top-[86px] flex -rotate-[8deg] items-center gap-0.5 rounded-xl bg-white px-3 py-2 shadow-lg">
          {[0, 1, 2, 3, 4].map((index) => <Star key={index} className="h-5 w-5 fill-[#F5B301] text-[#F5B301]" />)}
        </span>
        <span className="absolute bottom-4 left-2 inline-flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-lg">
          <ThumbsUp className="h-8 w-8 fill-[#2F7DF6] text-[#2F7DF6]" />
        </span>
      </div>

      <section className="rounded-[16px] border border-[#DCE7F7] bg-white/75 p-3 dark:border-slate-800 dark:bg-slate-900/60">
        <b className="block px-2 pb-2 text-[19px] font-black text-[#0F172A] dark:text-slate-50">Review Incentives</b>
        <ul className="m-0 list-none space-y-1.5 p-0">
          {rows.map((row) => (
            <li key={row.label} className="flex items-center gap-3 rounded-[12px] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] dark:bg-slate-900">
              <row.Icon className={`h-6 w-6 shrink-0 ${row.gold ? "text-[#F2A20C]" : "text-[#334155] dark:text-slate-300"}`} />
              <span className="min-w-0 flex-1 text-[15.5px] text-[#0F172A] dark:text-slate-100">{row.label}{row.sub && <span className="block text-[13px] text-gray-600 dark:text-slate-400">{row.sub}</span>}</span>
              <b className="text-[17px] font-black text-[#0F172A] dark:text-slate-50">{row.amount === undefined ? "…" : naira(row.amount)}</b>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[16px] border border-[#D3E2F8] bg-[#E6EFFD] p-4 dark:border-slate-800 dark:bg-slate-900/60">
        <b className="flex items-center gap-2 text-[19px] font-black text-[#0A3C8C] dark:text-blue-300"><Info className="h-6 w-6 fill-[#1C6FE3] text-white" />Good to know</b>
        <ul className="m-0 mt-3 list-none space-y-2 p-0 text-[15.5px] text-[#0F172A] dark:text-slate-200">
          {["Only for delivered orders", "Genuine customer feedback", "Manager approval required", "Your incentive is credited after approval"].map((line) => (
            <li key={line} className="flex items-start gap-2.5"><Check className="mt-0.5 h-5 w-5 shrink-0 text-[#22A04B]" strokeWidth={3} />{line}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function OrderCard({ order, image, onChange, disabled, compact = false }: { order: ReviewOrderChoice; image: string | null; onChange: () => void; disabled: boolean; compact?: boolean }) {
  const line = `flex items-center gap-2.5 text-[#0F172A] dark:text-slate-200 ${compact ? "text-[13.5px] sm:text-[15.5px]" : "text-[15px] sm:text-[16.5px]"}`;
  return (
    <section className={`flex gap-3 rounded-[16px] border border-[#CFE2FB] bg-gradient-to-r from-[#EEF5FE] to-[#E4EFFE] sm:flex-row sm:items-center sm:gap-4 dark:border-blue-500/30 dark:from-blue-500/10 dark:to-blue-500/5 ${compact ? "flex-row items-center p-3" : "flex-col p-4"}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
        <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-white shadow-sm dark:bg-slate-800 ${compact ? "h-16 w-16 sm:h-[104px] sm:w-[104px]" : "h-[96px] w-[96px] sm:h-[124px] sm:w-[124px]"}`}>
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <Box className="h-10 w-10 text-gray-400" />}
        </span>
        <div className={`min-w-0 flex-1 sm:border-l sm:border-[#BFD6F6] sm:pl-5 dark:sm:border-blue-500/30 ${compact ? "space-y-1" : "space-y-1.5"}`}>
          <p className={`m-0 flex items-center gap-2.5 font-black text-[#0F172A] dark:text-slate-50 ${compact ? "text-[15.5px] sm:text-[18.5px]" : "text-[17px] sm:text-[20px]"}`}><User className="h-5 w-5 shrink-0" /><span className="truncate">{order.customer || "Customer"}</span></p>
          {order.phone && <p className={`m-0 ${line}`}><Phone className="h-5 w-5 shrink-0" />{phoneText(order.phone)}</p>}
          <p className={`m-0 ${line}`}><ClipboardList className="h-5 w-5 shrink-0" />Order #{order.id}</p>
          <p className={`m-0 ${line}`}><Box className="h-5 w-5 shrink-0" /><span className="truncate">{order.productName}</span></p>
        </div>
      </div>
      <div className={`items-center justify-between gap-4 sm:w-[300px] sm:justify-start sm:border-l sm:border-[#BFD6F6] sm:pl-5 dark:sm:border-blue-500/30 ${compact ? "hidden sm:flex" : "flex"}`}>
        <div className="space-y-2">
          <p className={`m-0 ${line}`}><CalendarDays className="h-5 w-5 shrink-0" />Delivered: {dayText(order.deliveredOn)}</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#C9F5CF] px-3.5 py-1.5 text-[14.5px] font-bold text-[#0C6B22] dark:bg-emerald-500/15 dark:text-emerald-300"><Check className="h-4 w-4" strokeWidth={3} />Delivered</span>
        </div>
      </div>
      <button type="button" disabled={disabled} onClick={onChange} className={`!min-h-0 inline-flex shrink-0 items-center justify-center gap-2 rounded-[12px] border border-[#C5D3E6] bg-white font-extrabold text-[#0F172A] shadow-sm hover:bg-gray-50 disabled:opacity-60 sm:self-center sm:px-4 sm:py-2.5 sm:text-[16px] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 ${compact ? "self-center px-3 py-2 text-[14px]" : "self-start px-4 py-2.5 text-[16px]"}`}>
        <RotateCcw className="h-5 w-5" />Change
      </button>
    </section>
  );
}

function Tick({ checked, onChange, children, disabled }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return (
    <label className="relative flex cursor-pointer items-start gap-3 text-[15.5px] leading-snug text-[#0F172A] sm:text-[16px] dark:text-slate-100">
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className={`mt-0.5 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[6px] border-2 peer-focus-visible:ring-2 peer-focus-visible:ring-[#0B63D6]/40 ${checked ? "border-[#0B63D6] bg-[#0B63D6] text-white" : "border-[#B8C4D3] bg-white dark:border-slate-500 dark:bg-slate-900"}`}>
        {checked && <Check className="h-4 w-4" strokeWidth={3.5} />}
      </span>
      <span>{children}</span>
    </label>
  );
}

// ── The window ──────────────────────────────────────────────────────────────

export function SubmitReviewWizard({ limits, imageOf, initialFiles = [], onClose, onSubmitted }: {
  limits: Limits;
  imageOf: (productId: string) => string | null;
  /** Photos or videos already picked in Upload media. */
  initialFiles?: File[];
  onClose: () => void;
  onSubmitted: (message: string) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [amounts, setAmounts] = useState<ReviewAmounts | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReviewOrderChoice[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [order, setOrder] = useState<ReviewOrderChoice | null>(null);
  const [media, setMedia] = useState<MediaItem[]>(() => toMedia(initialFiles, limits));
  const [type, setType] = useState<ReviewType | null>(() => (initialFiles.some((file) => kindOfFile(file) === "video") ? "video" : initialFiles.some((file) => kindOfFile(file) === "image") ? "photo" : null));
  const [shows, setShows] = useState<ReviewMediaShows>("product_in_use");
  const [comment, setComment] = useState("");
  const [channel, setChannel] = useState<ReviewChannel>("whatsapp");
  const [receivedOn, setReceivedOn] = useState(lagosToday());
  const [rating, setRating] = useState<number | null>(null);
  const [complaint, setComplaint] = useState("");
  const [problemOpen, setProblemOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<{ file: File; preview: string } | null>(null);
  const [genuine, setGenuine] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<Array<{ url: string; kind: "image" | "video" }> | null>(null);
  // The review is only started on Submit; a retry after a failed send reuses it if nothing changed.
  const draft = useRef<{ id: string; productId: string; signature: string; sent: Set<string> } | null>(null);
  const submitted = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const mediaInput = useRef<HTMLInputElement | null>(null);
  const shotInput = useRef<HTMLInputElement | null>(null);
  const dateInput = useRef<HTMLInputElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ media, screenshot });
  latest.current = { media, screenshot };

  useEffect(() => { customerReviewsApi.settings().then((result) => setAmounts(result.amounts)).catch(() => undefined); }, []);
  // Free the picture previews when the window closes.
  useEffect(() => () => {
    latest.current.media.forEach((item) => URL.revokeObjectURL(item.preview));
    if (latest.current.screenshot) URL.revokeObjectURL(latest.current.screenshot.preview);
    abort.current?.abort();
  }, []);

  const close = useCallback(() => {
    if (sending) return;
    if (draft.current && !submitted.current) void customerReviewsApi.discard(draft.current.id).catch(() => undefined);
    onClose();
  }, [sending, onClose]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !viewing) close(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [close, viewing]);

  // The rep's own delivered orders (a manager sees everyone's), a moment after typing stops.
  const showResults = step === 1 && (!order || query.trim().length > 0);
  useEffect(() => {
    if (!showResults) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try { const found = await customerReviewsApi.orders(query.trim()); if (live) { setResults(found.orders); setSearchError(""); } }
      catch (err) { if (live) setSearchError((err as Error).message || "Could not load your delivered orders."); }
      finally { if (live) setSearching(false); }
    }, query ? 300 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, showResults]);

  const image = order?.productId ? imageOf(order.productId) : null;
  const activeMedia = media.filter((item) => (type === "photo" ? item.kind === "image" : type === "video" ? item.kind === "video" : false));
  const ready = activeMedia.filter((item) => !item.problem);
  const amount = amounts && type ? amounts[type] : 0;
  const paid = order?.paid ?? 0;
  const adds = Math.max(0, amount - paid);
  const word = type ? TYPE_META[type].word : "photo";

  const problemFor = (at: Step): string | null => {
    if (at === 1) {
      if (!order) return "Find and choose the customer's delivered order.";
      if (order.waiting) return "This order already has a review waiting for approval.";
      if (!type) return "Choose the type of review.";
      return null;
    }
    if (at === 2) {
      if (type === "written") return comment.trim().length < 5 ? "Write what the customer said, in their words." : null;
      if (ready.length === 0) return `Add the customer's ${word}.`;
      return null;
    }
    if (!screenshot) return "Add the WhatsApp screenshot that shows the customer's phone number.";
    if (!genuine) return "Tick that this review reflects the customer's genuine experience.";
    return null;
  };
  const go = (to: Step) => {
    if (to > step) {
      const problem = problemFor(step);
      if (problem) { setError(problem); return; }
    }
    setError("");
    setStep(to);
    body.current?.scrollTo({ top: 0 });
  };

  const addMedia = (list: FileList | null) => {
    if (!list) return;
    // Read the files now: the input is cleared straight after, which empties the list.
    const next = toMedia(Array.from(list).slice(0, 10), limits);
    setMedia((current) => [...current, ...next].slice(0, 20));
    setError("");
  };
  const removeMedia = (id: string) => setMedia((current) => {
    const item = current.find((entry) => entry.id === id);
    if (item) URL.revokeObjectURL(item.preview);
    return current.filter((entry) => entry.id !== id);
  });
  const pickScreenshot = (file: File | undefined) => {
    if (!file) return;
    if (kindOfFile(file) !== "image") { setError("The WhatsApp screenshot must be a picture (JPG, PNG or WEBP)."); return; }
    setScreenshot((current) => { if (current) URL.revokeObjectURL(current.preview); return { file, preview: URL.createObjectURL(file) }; });
    if (draft.current) draft.current.sent.delete("screenshot");
    setError("");
  };

  /** One file into the review: shrink a photo, link, send, check. */
  const sendOne = async (file: File, kind: "image" | "video", part: "content" | "proof", reviewId: string, productId: string, label: string, signal: AbortSignal) => {
    const bodyFile = kind === "image" ? await shrinkPhoto(file) : file;
    const maxImage = (limits?.maxImageMb ?? 10) * 1024 * 1024;
    if (kind === "image" && bodyFile.size > Math.min(PHOTO_MAX_BYTES, maxImage)) throw new Error(`Photos must be ${limits?.maxImageMb ?? 10} MB or smaller.`);
    const mime = kind === "image" && bodyFile !== file ? "image/jpeg" : mimeOf(file, kind);
    const cover = kind === "video" ? await videoCover(file) : {};
    const started = await productMediaApi.startUpload({ productId, mime, size: bodyFile.size, name: file.name, label: "customer_review", caption: "", reviewId, reviewPart: part });
    await uploadWithProgress(started.signedUrl, bodyFile, mime, (fraction) => setProgress(`${label} ${Math.round(fraction * 100)}%`), signal);
    setProgress(`${label}: checking…`);
    await productMediaApi.complete(started.id, cover);
  };

  const submit = async () => {
    const problem = problemFor(1) ?? problemFor(2) ?? problemFor(3);
    if (problem) { setError(problem); return; }
    setSending(true);
    setError("");
    abort.current = new AbortController();
    const signal = abort.current.signal;
    try {
      const fields = {
        orderId: order!.id, type: type!, text: comment.trim(), rating, channel, receivedOn, complaint: complaint.trim(),
        genuine, marketing, mediaShows: type === "written" ? null : shows
      };
      const signature = JSON.stringify(fields);
      // Something was changed after a failed send: start again with the new details.
      if (draft.current && draft.current.signature !== signature) {
        await customerReviewsApi.discard(draft.current.id).catch(() => undefined);
        draft.current = null;
      }
      if (!draft.current) {
        setProgress("Starting the review…");
        const started = await customerReviewsApi.start(fields);
        draft.current = { id: started.review.id, productId: started.review.productId ?? order!.productId ?? "", signature, sent: new Set() };
      }
      const current = draft.current;
      for (const [index, item] of ready.entries()) {
        if (current.sent.has(item.id)) continue;
        await sendOne(item.file, item.kind, "content", current.id, current.productId, `Sending ${word} ${index + 1} of ${ready.length}`, signal);
        current.sent.add(item.id);
      }
      if (!current.sent.has("screenshot")) {
        await sendOne(screenshot!.file, "image", "proof", current.id, current.productId, "Sending the WhatsApp screenshot", signal);
        current.sent.add("screenshot");
      }
      setProgress("Sending for approval…");
      const sent = await customerReviewsApi.submit(current.id);
      submitted.current = true;
      onSubmitted(`Review sent for manager approval. Bonus if approved: ${naira(sent.bonusIfApproved > paid ? sent.bonusIfApproved - paid : 0)}.`);
    } catch (err) {
      if (!signal.aborted) setError((err as Error).message || "Could not send the review. Try again.");
    } finally {
      setSending(false);
      setProgress("");
    }
  };

  const typeCards = (compact: boolean) => (
    <div className={`grid gap-3 ${compact ? "grid-cols-3" : "grid-cols-1 sm:gap-4 md:grid-cols-3"}`} role="radiogroup" aria-label="Type of review">
      {(["written", "photo", "video"] as ReviewType[]).map((key) => {
        const meta = TYPE_META[key];
        const on = type === key;
        return (
          <button key={key} type="button" role="radio" aria-checked={on} disabled={sending} onClick={() => { setType(key); setError(""); }}
            className={`!min-h-0 relative rounded-[14px] border text-left transition-colors ${on
              ? "border-2 border-[#0B63D6] bg-[#F3F8FF] shadow-[0_4px_14px_rgba(11,99,214,0.12)] dark:bg-blue-500/10"
              : "border-[#DDE3EA] bg-white hover:border-[#B8CBE6] dark:border-slate-700 dark:bg-slate-900"} ${compact ? "flex flex-col items-center px-2 py-3 text-center" : "flex flex-col p-4 sm:p-5"}`}>
            {on && <span className={`absolute inline-flex items-center justify-center rounded-full bg-[#0B63D6] text-white ${compact ? "right-2 top-2 h-6 w-6" : "right-3 top-3 h-8 w-8"}`}><Check className={compact ? "h-4 w-4" : "h-5 w-5"} strokeWidth={3} /></span>}
            {compact ? (
              <>
                <meta.Icon className="h-7 w-7 text-[#0B63D6]" />
                <b className="mt-1.5 text-[16px] font-extrabold text-[#0F172A] sm:text-[18px] dark:text-slate-50">{meta.short}</b>
                <b className="text-[15px] font-black text-[#0A4CB0] sm:text-[17px] dark:text-blue-300">{amounts ? naira(amounts[key]) : "…"}</b>
              </>
            ) : (
              <>
                <span className="flex items-start gap-4 pr-8">
                  <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-[12px] bg-[#EAF2FD] text-[#0B63D6] dark:bg-blue-500/15"><meta.Icon className="h-7 w-7" /></span>
                  <span className="min-w-0">
                    <b className="block text-[18px] font-extrabold text-[#0F172A] sm:text-[19px] dark:text-slate-50">{meta.title}</b>
                    <span className="mt-1 block text-[14.5px] leading-snug text-gray-600 sm:text-[15px] dark:text-slate-400">{meta.desc}</span>
                  </span>
                </span>
                <span className="mx-auto mt-4 inline-flex rounded-full bg-[#E3F0FD] px-6 py-1.5 text-[19px] font-black text-[#0A3C8C] dark:bg-blue-500/15 dark:text-blue-200">{amounts ? naira(amounts[key]) : "…"}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );

  // ── Step 1: the customer's delivered order, and the type ──
  const stepOne = (
    <div>
      <h3 className="m-0 text-[22px] font-black text-[#0F172A] sm:text-[26px] dark:text-slate-50">Who provided this review?</h3>
      <p className="m-0 mt-0.5 text-[15px] text-gray-600 sm:text-[17px] dark:text-slate-400">Find the customer's delivered order.</p>
      <div className="relative mt-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-gray-500" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search delivered orders" disabled={sending}
          placeholder="Search by customer name, phone number or order ID..."
          className="h-[54px] w-full rounded-[12px] border border-[#CBD5E1] bg-white pl-14 pr-4 text-[16px] text-[#0F172A] outline-none placeholder:text-gray-500 focus:border-[#0B63D6] focus:ring-2 focus:ring-[#0B63D6]/20 sm:h-[58px] sm:text-[17px] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
      </div>
      {showResults && (
        <div className="mt-3 overflow-hidden rounded-[14px] border border-[#DDE3EA] bg-white dark:border-slate-700 dark:bg-slate-900">
          {searching && <p className="m-0 flex items-center gap-2 px-4 py-3 text-[14.5px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Looking…</p>}
          {!searching && searchError && <p className="m-0 px-4 py-3 text-[14.5px] text-rose-600">{searchError}</p>}
          {!searching && !searchError && results?.length === 0 && <p className="m-0 px-4 py-3 text-[14.5px] text-gray-500">{query ? "No delivered order matches." : "No delivered orders yet."}</p>}
          <div className="max-h-[280px] overflow-y-auto">
            {!searching && !searchError && results?.map((choice) => (
              <button key={choice.id} type="button" disabled={choice.waiting} onClick={() => { setOrder(choice); setQuery(""); setError(""); }}
                className="!min-h-0 flex w-full items-center gap-3 border-b border-gray-100 px-4 py-3 text-left last:border-0 hover:bg-[#F3F8FF] disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-800">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-gray-100 dark:bg-slate-800">
                  {choice.productId && imageOf(choice.productId) ? <img src={imageOf(choice.productId)!} alt="" className="h-full w-full object-cover" /> : <Box className="h-5 w-5 text-gray-400" />}
                </span>
                <span className="min-w-0 flex-1">
                  <b className="block truncate text-[15.5px] text-[#0F172A] dark:text-slate-100">{choice.customer || "Customer"} · Order #{choice.id}</b>
                  <span className="block truncate text-[13.5px] text-gray-600 dark:text-slate-400">{choice.phone ? `${phoneText(choice.phone)} · ` : ""}{choice.productName} · delivered {dayText(choice.deliveredOn)}</span>
                </span>
                {choice.waiting ? <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[12.5px] font-bold text-amber-700">Waiting for approval</span>
                  : choice.paid > 0 ? <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[12.5px] font-bold text-emerald-700">{naira(choice.paid)} earned</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
      {order && !query.trim() && <div className="mt-4"><OrderCard order={order} image={image} disabled={sending} onChange={() => { setOrder(null); setQuery(""); }} /></div>}
      {order && order.paid > 0 && !query.trim() && <p className="m-0 mt-2 text-[14px] font-semibold text-amber-700">This order already earned {naira(order.paid)}. Only a higher type adds more.</p>}

      <div className="mt-6 border-t border-[#E5EAF1] pt-5 dark:border-slate-800">
        <h3 className="m-0 text-[22px] font-black text-[#0F172A] sm:text-[26px] dark:text-slate-50">What type of review are you submitting?</h3>
        <p className="m-0 mt-0.5 text-[15px] text-gray-600 sm:text-[17px] dark:text-slate-400">Choose the format the customer shared with you.</p>
        <div className="mt-4">{typeCards(false)}</div>
      </div>
    </div>
  );

  // ── Step 2: what the customer said, and the photo or video ──
  const stepTwo = order && (
    <div>
      <OrderCard compact order={order} image={image} disabled={sending} onChange={() => go(1)} />
      <h3 className="m-0 mt-5 text-[22px] font-black text-[#0F172A] sm:text-[26px] dark:text-slate-50">Add Customer Review</h3>
      <p className="m-0 mt-0.5 text-[15px] text-gray-600 sm:text-[17px] dark:text-slate-400">Share what the customer said and upload the review media.</p>
      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.88fr)]">
        <div className="space-y-4">
          <div>
            <span className={fieldLabel}>Review Type <span className="text-rose-500">*</span></span>
            {typeCards(true)}
          </div>
          {type !== "written" && (
            <label className="block">
              <span className={fieldLabel}>What does the {word} show? <span className="text-rose-500">*</span></span>
              <span className="relative block">
                <select value={shows} onChange={(event) => setShows(event.target.value as ReviewMediaShows)} disabled={sending}
                  className="!min-h-0 h-[50px] w-full appearance-none rounded-[12px] border border-[#CBD5E1] bg-white px-4 pr-10 text-[16.5px] !font-normal text-[#0F172A] dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
                  {SHOWS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-600" />
              </span>
            </label>
          )}
          <label className="block">
            <span className={fieldLabel}>Customer's comment {type === "written" ? <span className="text-rose-500">*</span> : <span className="font-normal text-gray-500">(optional)</span>}</span>
            <span className="block rounded-[12px] border border-[#CBD5E1] bg-white focus-within:border-[#0B63D6] focus-within:ring-2 focus-within:ring-[#0B63D6]/20 dark:border-slate-600 dark:bg-slate-950">
              <textarea value={comment} onChange={(event) => setComment(event.target.value.slice(0, COMMENT_MAX))} rows={3} disabled={sending} aria-label="Customer's comment"
                placeholder="The customer's own words, good or bad. Never write a review for them."
                className="!min-h-0 block w-full resize-none rounded-[12px] border-0 bg-transparent px-4 pb-0 pt-3 text-[16px] leading-relaxed text-[#0F172A] outline-none dark:text-slate-100" />
              <span className="block px-4 pb-2 text-right text-[13.5px] text-gray-500">{comment.length}/{COMMENT_MAX}</span>
            </span>
          </label>
        </div>

        <section className="rounded-[16px] border border-[#DCE5F0] bg-[#F7FAFF] p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900/60">
          {type === "written" ? (
            <div className="flex h-full flex-col items-center justify-center px-3 py-8 text-center">
              <MessageSquare className="h-11 w-11 text-[#0B63D6]" />
              <b className="mt-3 text-[18px] font-extrabold text-[#0F172A] dark:text-slate-50">No photo needed</b>
              <span className="mt-1 max-w-[320px] text-[14.5px] text-gray-600 dark:text-slate-400">A written review is the customer's own words. Next, you'll add the WhatsApp chat they sent them in, showing their phone number.</span>
            </div>
          ) : (
            <>
              <b className="block text-[17px] font-extrabold text-[#0F172A] sm:text-[19px] dark:text-slate-50">Upload Customer {type === "video" ? "Video" : "Photo"} <span className="text-rose-500">*</span></b>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {activeMedia.map((item) => (
                  <div key={item.id} className={`relative aspect-[4/5] overflow-hidden rounded-[12px] border-2 border-dashed bg-white p-2.5 dark:bg-slate-900 ${item.problem ? "border-rose-300" : "border-[#A9C8F2]"}`}>
                    {item.kind === "video"
                      ? <video src={item.preview} muted playsInline preload="metadata" className="h-full w-full rounded-[8px] bg-black object-cover" />
                      : <img src={item.preview} alt={item.file.name} className="h-full w-full rounded-[8px] object-cover" />}
                    {!sending && <button type="button" aria-label="Remove" onClick={() => removeMedia(item.id)} className="!min-h-0 absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#334155]/85 text-white hover:bg-[#1E293B]"><X className="h-4 w-4" /></button>}
                    {item.problem && <span className="absolute inset-x-2 bottom-2 rounded-md bg-rose-600 px-2 py-1 text-[11.5px] font-bold text-white">{item.problem}</span>}
                  </div>
                ))}
                {activeMedia.length < 6 && (
                  <button type="button" disabled={sending} onClick={() => mediaInput.current?.click()}
                    className="!min-h-0 flex aspect-[4/5] flex-col items-center justify-center rounded-[12px] border-2 border-dashed border-[#A9C8F2] bg-white px-3 text-center hover:bg-[#F3F8FF] disabled:opacity-60 dark:bg-slate-900">
                    {type === "video" ? <Video className="h-11 w-11 text-[#0B63D6]" /> : <ImageIcon className="h-11 w-11 text-[#0B63D6]" />}
                    <b className="mt-2 text-[17px] font-extrabold text-[#0B63D6] sm:text-[19px]">Add {type === "video" ? "Video" : "Photo"}</b>
                    <span className="mt-0.5 text-[13.5px] text-gray-600 dark:text-slate-400">Click to upload or take {type === "video" ? "a video" : "photo"}</span>
                  </button>
                )}
              </div>
              <p className="m-0 mt-3 text-center text-[13.5px] text-gray-600 dark:text-slate-400">
                {type === "video"
                  ? `${(limits?.videoTypes ?? ["mp4", "mov", "webm"]).map((key) => key.toUpperCase()).join(", ")} · Up to ${limits?.maxVideoMb ?? 100} MB`
                  : `${(limits?.imageTypes ?? ["jpg", "png", "webp"]).map((key) => key.toUpperCase()).join(", ")} · Up to ${limits?.maxImageMb ?? 10} MB`}
              </p>
              <input ref={mediaInput} type="file" multiple hidden accept={type === "video" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"}
                onChange={(event) => { addMedia(event.target.files); event.target.value = ""; }} />
            </>
          )}
        </section>
      </div>
    </div>
  );

  // ── Step 3: check everything, add the WhatsApp screenshot, tick, send ──
  const detailRow = "flex items-start gap-3 border-t border-[#E8EDF3] py-2.5 dark:border-slate-800";
  const rowIcon = "mt-0.5 h-6 w-6 shrink-0 text-[#0B63D6]";
  const stepThree = order && type && (
    <div>
      <OrderCard compact order={order} image={image} disabled={sending} onChange={() => go(1)} />
      <div className="mt-3 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <section className={`${card} p-4`}>
          <h4 className="m-0 flex items-center gap-2.5 text-[20px] font-black text-[#0F172A] sm:text-[21px] dark:text-slate-50"><ShieldCheck className="h-7 w-7 text-[#0B63D6]" />Verify Review Details</h4>
          <div className="mt-2.5 grid grid-cols-1 gap-3 rounded-[14px] border border-[#E2E8F0] bg-[#FAFCFF] p-3 sm:grid-cols-2 dark:border-slate-700 dark:bg-slate-950/40">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-[#EAF2FD] text-[#0B63D6] dark:bg-blue-500/15">{(() => { const Icon = TYPE_META[type].Icon; return <Icon className="h-6 w-6" />; })()}</span>
              <span><b className="block text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">Review Type</b><span className="text-[16.5px] text-[#0F172A] dark:text-slate-200">{TYPE_META[type].title}</span></span>
            </div>
            {type !== "written" && (
              <div className="flex items-center gap-3 sm:border-l sm:border-[#E2E8F0] sm:pl-3 dark:sm:border-slate-700">
                <b className="text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">Media</b>
                {ready[0] && (
                  <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[10px] bg-gray-100">
                    {ready[0].kind === "video" ? <video src={ready[0].preview} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={ready[0].preview} alt="" className="h-full w-full object-cover" />}
                    {ready.length > 1 && <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 text-[11px] font-bold text-white">+{ready.length - 1}</span>}
                  </span>
                )}
                <button type="button" onClick={() => setViewing(ready.map((item) => ({ url: item.preview, kind: item.kind })))}
                  className="!min-h-0 ml-auto inline-flex items-center gap-1.5 rounded-[10px] border border-[#A9C8F2] bg-white px-3.5 py-2 text-[15.5px] font-extrabold text-[#0B63D6] hover:bg-[#F3F8FF] dark:bg-slate-900">
                  <Eye className="h-5 w-5" />View
                </button>
              </div>
            )}
          </div>
          {type !== "written" && (
            <div className={detailRow}><Layers className={rowIcon} /><span><b className="block text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">What it shows</b><span className="text-[16px] text-[#0F172A] dark:text-slate-200">{SHOWS.find(([key]) => key === shows)?.[1]}</span></span></div>
          )}
          <div className={detailRow}>
            <MessageSquare className={rowIcon} />
            <span className="min-w-0 flex-1">
              <b className="block text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">Customer's comment</b>
              {comment.trim()
                ? <span className="mt-1 block rounded-[10px] bg-[#EEF4FC] px-3.5 py-2 text-[15.5px] leading-relaxed text-[#0F172A] dark:bg-blue-500/10 dark:text-slate-100">“{comment.trim()}”</span>
                : <span className="text-[15px] text-gray-500">No comment</span>}
            </span>
          </div>
          <div className={`${detailRow} grid grid-cols-1 gap-3 sm:grid-cols-2`}>
            <div className="flex items-start gap-3">
              <WhatsAppIcon className="mt-0.5 h-6 w-6 shrink-0 text-[#25B954]" />
              <span className="min-w-0">
                <b className="block text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">Received through</b>
                <span className="relative inline-flex items-center">
                  <select value={channel} onChange={(event) => setChannel(event.target.value as ReviewChannel)} disabled={sending} aria-label="Received through"
                    className="!min-h-0 h-auto appearance-none border-0 bg-transparent p-0 pr-6 text-[16.5px] !font-normal text-[#0F172A] outline-none dark:text-slate-100">
                    {CHANNELS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-gray-500" />
                </span>
              </span>
            </div>
            <div className="flex items-start gap-3 sm:border-l sm:border-[#E8EDF3] sm:pl-3 dark:sm:border-slate-800">
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#EAF2FD] text-[#0B63D6] dark:bg-blue-500/15"><CalendarDays className="h-5 w-5" /></span>
              <span className="relative">
                <b className="block text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">Date received</b>
                <button type="button" disabled={sending} onClick={() => dateInput.current?.showPicker?.()} className="!min-h-0 text-[16.5px] text-[#0F172A] underline-offset-4 hover:underline dark:text-slate-100">{dayText(receivedOn, true)}</button>
                <input ref={dateInput} type="date" value={receivedOn} min={order.deliveredOn ?? undefined} max={lagosToday()} aria-label="Date received" tabIndex={-1}
                  onChange={(event) => event.target.value && setReceivedOn(event.target.value)} className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0" />
              </span>
            </div>
          </div>
          <div className={`${detailRow} flex-wrap items-center`}>
            <Star className={rowIcon} />
            <b className="text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">Customer rating <span className="font-normal text-gray-500">(optional)</span></b>
            <span className="ml-auto flex items-center gap-1 sm:ml-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} type="button" disabled={sending} aria-label={`${star} star${star === 1 ? "" : "s"}`} onClick={() => setRating(rating === star ? null : star)} className="!min-h-0 p-0.5">
                  <Star className={`h-7 w-7 ${rating && star <= rating ? "fill-[#F5B301] text-[#F5B301]" : "text-[#CBD5E1] dark:text-slate-600"}`} />
                </button>
              ))}
            </span>
          </div>
          <div className={`${detailRow} flex-wrap items-center pb-0`}>
            <ShieldCheck className={rowIcon} />
            <b className="text-[15.5px] font-extrabold text-[#0F172A] dark:text-slate-100">Any problem mentioned?</b>
            <button type="button" disabled={sending} onClick={() => setProblemOpen((open) => !open)}
              className={`!min-h-0 ml-auto rounded-full px-4 py-1.5 text-[15px] font-bold sm:ml-6 ${complaint.trim() ? "bg-amber-100 text-amber-800" : "bg-[#D1F6D2] text-[#11733A]"}`}>
              {complaint.trim() ? "Problem noted" : "No issues reported"}
            </button>
            {(problemOpen || complaint.trim()) && (
              <input value={complaint} onChange={(event) => setComplaint(event.target.value.slice(0, 1000))} disabled={sending} aria-label="Problem the customer mentioned"
                placeholder="What problem did they mention? e.g. One screw was missing"
                className="mt-2 w-full rounded-[10px] border border-[#CBD5E1] bg-white px-3.5 py-2.5 text-[15px] dark:border-slate-600 dark:bg-slate-950" />
            )}
          </div>
        </section>

        <div className="space-y-3">
          <section className={`${card} p-4`}>
            <h4 className="m-0 flex items-center gap-2.5 text-[19px] font-black text-[#0F172A] sm:text-[21px] dark:text-slate-50"><WhatsAppIcon className="h-7 w-7 text-[#25B954]" />Verification Evidence</h4>
            {screenshot ? (
              <>
                <div className="mt-3 flex gap-3">
                  <button type="button" onClick={() => setViewing([{ url: screenshot.preview, kind: "image" }])} className="!min-h-0 block h-[150px] min-w-0 flex-1 overflow-hidden rounded-[12px] border border-[#DCE5F0] bg-gray-50">
                    <img src={screenshot.preview} alt="WhatsApp screenshot" className="h-full w-full object-cover object-top" />
                  </button>
                  <button type="button" disabled={sending} onClick={() => shotInput.current?.click()}
                    className="!min-h-0 flex w-[130px] shrink-0 flex-col items-center justify-center rounded-[12px] border-2 border-dashed border-[#A9C8F2] bg-[#F5F9FF] px-2 text-center text-[#0B63D6] hover:bg-[#EAF2FD] disabled:opacity-60 sm:w-[150px] dark:bg-slate-900">
                    <ImageIcon className="h-9 w-9" />
                    <b className="mt-1.5 text-[15.5px] font-extrabold leading-tight">Replace Screenshot</b>
                  </button>
                </div>
                <p className="m-0 mt-2 text-[13px] text-gray-600 dark:text-slate-400">Check the customer's number shows in it{order.phone ? <>: <b className="text-[#0F172A] dark:text-slate-100">{phoneText(order.phone)}</b></> : ""}. It stays private.</p>
              </>
            ) : (
              <button type="button" disabled={sending} onClick={() => shotInput.current?.click()}
                className="!min-h-0 mt-3 flex w-full items-center gap-4 rounded-[12px] border-2 border-dashed border-[#9ED9B0] bg-[#F1FBF4] p-4 text-left hover:bg-[#E6F7EC] disabled:opacity-60 dark:border-emerald-500/40 dark:bg-emerald-500/10">
                <WhatsAppIcon className="h-11 w-11 shrink-0 text-[#25B954]" />
                <span className="min-w-0">
                  <b className="block text-[17px] font-extrabold text-[#11733A] dark:text-emerald-300">Add WhatsApp Screenshot <span className="text-rose-500">*</span></b>
                  <span className="mt-0.5 block text-[14px] text-gray-700 dark:text-slate-300">The chat where {order.customer || "the customer"} sent this review, with their phone number{order.phone ? ` (${phoneText(order.phone)})` : ""} showing at the top.</span>
                </span>
              </button>
            )}
            <input ref={shotInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { pickScreenshot(event.target.files?.[0]); event.target.value = ""; }} />
          </section>

          <section className={`${card} p-4`}>
            <h4 className="m-0 flex items-center gap-2.5 text-[19px] font-black text-[#0F172A] sm:text-[21px] dark:text-slate-50"><ShieldCheck className="h-7 w-7 text-[#22A04B]" />Customer Permission</h4>
            <div className="mt-2 space-y-2">
              <Tick checked={genuine} disabled={sending} onChange={(value) => { setGenuine(value); setError(""); }}>I confirm this review reflects the customer's genuine experience. <span className="text-rose-500">*</span></Tick>
              <Tick checked={marketing} disabled={sending} onChange={setMarketing}>The customer gave permission for this content to be used in ProtoHub marketing. <span className="text-gray-500">(optional)</span></Tick>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-4 rounded-[16px] border border-[#F6DDBD] bg-[#FFF7EC] px-5 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
            <Gift className="h-10 w-10 shrink-0 text-[#E8892B]" />
            <div>
              <span className="block text-[15px] font-extrabold text-[#7A2E0E] dark:text-amber-200">Potential Incentive</span>
              <b className="text-[30px] font-black leading-none text-[#8E1212] dark:text-amber-100">{amounts ? naira(adds) : "…"}</b>
              {paid > 0 && <span className="block text-[12.5px] text-[#7A2E0E] dark:text-amber-200">This order already earned {naira(paid)}</span>}
            </div>
            <span className="mx-1 hidden h-14 w-px bg-[#F2C99A] sm:block" aria-hidden="true" />
            <div>
              <span className="block text-[15px] font-extrabold text-[#0F172A] dark:text-slate-100">Status</span>
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#FDE9C8] px-3.5 py-1.5 text-[15px] font-semibold text-[#92510E] dark:bg-amber-500/20 dark:text-amber-200"><Clock3 className="h-4 w-4" />Pending Manager Approval</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-stretch justify-center bg-slate-950/55 backdrop-blur-[2px] sm:items-center sm:p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section role="dialog" aria-modal="true" aria-label="Submit Customer Review"
        className="flex h-[100dvh] w-full max-w-[1500px] overflow-hidden bg-white shadow-2xl sm:h-[min(1000px,calc(100dvh-24px))] sm:rounded-[22px] dark:bg-slate-900">
        <SidePanel amounts={amounts} image={image ?? (results?.[0]?.productId ? imageOf(results[0].productId) : null)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-start gap-3 px-4 pt-4 sm:px-8 sm:pt-6">
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-[23px] font-black leading-tight tracking-[-0.01em] text-[#0F172A] sm:text-[34px] dark:text-slate-50">Submit Customer Review</h2>
              <p className="m-0 mt-1 text-[14px] text-gray-600 sm:text-[17px] dark:text-slate-400">Collect authentic customer feedback and earn incentives for approved reviews.</p>
            </div>
            <button type="button" aria-label="Close" disabled={sending} onClick={close} className="!min-h-0 rounded-lg p-1.5 text-[#334155] hover:bg-gray-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"><X className="h-7 w-7" /></button>
          </header>
          <div className="px-4 pt-4 sm:px-8"><Stepper step={step} /></div>
          <div className="mx-4 mt-3 border-t border-[#E5EAF1] sm:mx-8 dark:border-slate-800" />
          <div ref={body} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-8 sm:py-5">
            {step === 1 ? stepOne : step === 2 ? stepTwo : stepThree}
          </div>
          <footer className="border-t border-[#E5EAF1] px-4 py-3 sm:px-8 sm:py-4 dark:border-slate-800">
            {(error || progress) && (
              <p className={`m-0 mb-2.5 flex items-center gap-2 text-[14px] font-semibold ${error ? "text-rose-600" : "text-[#0B5ED7]"}`}>
                {progress && !error && <Loader2 className="h-4 w-4 animate-spin" />}{error || progress}
              </p>
            )}
            <div className="flex items-center gap-3">
              {step === 1
                ? <button type="button" onClick={close} className={`${outlineButton} h-[50px] sm:h-[56px] sm:w-[160px]`}>Cancel</button>
                : <button type="button" disabled={sending} onClick={() => go((step - 1) as Step)} className={`${outlineButton} h-[50px] sm:h-[56px] sm:w-[156px]`}><ArrowLeft className="h-5 w-5" />Back</button>}
              <span className="flex-1" />
              {step === 1 && (
                <button type="button" onClick={() => go(2)} className={`${primaryButton} h-[50px] flex-1 sm:h-[56px] sm:flex-none`}>
                  <span className="sm:hidden">Continue</span><span className="hidden sm:inline">Continue to Add Review</span><ArrowRight className="h-5 w-5" />
                </button>
              )}
              {step === 2 && (
                <button type="button" onClick={() => go(3)} className={`${primaryButton} h-[50px] flex-1 sm:h-[56px] sm:flex-none`}>
                  <span className="sm:hidden">Continue</span><span className="hidden sm:inline">Continue to Verify &amp; Submit</span><ArrowRight className="h-5 w-5" />
                </button>
              )}
              {step === 3 && (
                <button type="button" disabled={sending} onClick={submit} className={`${primaryButton} h-[50px] flex-1 sm:h-[56px] sm:flex-none`}>
                  {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                  <span className="sm:hidden">Submit</span><span className="hidden sm:inline">Submit for Manager Approval</span>
                </button>
              )}
            </div>
          </footer>
        </div>
      </section>

      {viewing && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/80 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewing(null); }}>
          <button type="button" aria-label="Close" onClick={() => setViewing(null)} className="!min-h-0 absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white hover:bg-white/25"><X className="h-6 w-6" /></button>
          <div className="flex max-h-full max-w-4xl flex-col items-center gap-4 overflow-y-auto">
            {viewing.map((item, index) => item.kind === "video"
              ? <video key={index} src={item.url} controls playsInline className="max-h-[80vh] max-w-full rounded-xl bg-black" />
              : <img key={index} src={item.url} alt="" className="max-h-[85vh] max-w-full rounded-xl object-contain" />)}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

