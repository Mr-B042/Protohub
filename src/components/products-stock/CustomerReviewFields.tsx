import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageCircle, Search, ShieldCheck, Star, X } from "lucide-react";
import { customerReviewsApi, type ReviewAmounts, type ReviewChannel, type ReviewLevel, type ReviewOrderChoice, type ReviewType } from "../../lib/api";

/**
 * The "Customer review" part of the Upload media window (Bright, 7 Nov 2026):
 * which delivered order, what kind of review, the customer's own words, and
 * two separate ticks: the customer confirmed it is real (needed) and the
 * customer allowed marketing use (optional, never ticked for them).
 */
export type ReviewFormValue = {
  order: ReviewOrderChoice | null;
  /** null = follow the files (a video makes it a video review, a photo a photo review). */
  type: ReviewType | null;
  text: string;
  rating: number | null;
  channel: ReviewChannel;
  receivedOn: string;
  complaint: string;
  genuine: boolean;
  marketing: boolean;
};

export const lagosToday = () => new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 10);
export const emptyReviewForm = (): ReviewFormValue => ({
  order: null, type: null, text: "", rating: null, channel: "whatsapp", receivedOn: lagosToday(), complaint: "", genuine: false, marketing: false
});

const TYPE_TEXT: Record<ReviewType, string> = { written: "Written", photo: "Photo", video: "Video" };
const LEVEL_TEXT: Record<ReviewLevel, string> = { written: "written review", photo: "product photo", video: "video", premium: "premium video" };
const CHANNELS: Array<[ReviewChannel, string]> = [["whatsapp", "WhatsApp"], ["call", "Phone call"], ["sms", "SMS"], ["in_person", "In person"], ["other", "Other"]];
const naira = (amount: number) => `₦${Math.round(amount).toLocaleString("en-NG")}`;
const shortDay = (key: string | null) => (key ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

export function effectiveReviewType(value: ReviewFormValue, counts: { photos: number; videos: number }): ReviewType {
  return value.type ?? (counts.videos > 0 ? "video" : counts.photos > 0 ? "photo" : "written");
}

/** The first thing stopping the review being sent, or null. */
export function reviewFormProblem(value: ReviewFormValue, counts: { photos: number; videos: number }, hasScreenshot: boolean): string | null {
  if (!value.order) return "Choose the delivered order this review is for.";
  if (value.order.waiting) return "This order already has a review waiting for approval.";
  const type = effectiveReviewType(value, counts);
  if (type === "written" && value.text.trim().length < 5) return "Write what the customer said, in their words.";
  // Typed words alone prove nothing (Bright, 7 Nov 2026).
  if (type === "written" && !hasScreenshot) return "Add a WhatsApp screenshot that shows the customer's phone number.";
  if (type === "photo" && counts.photos === 0) return "Add the customer's photo.";
  if (type === "video" && counts.videos === 0) return "Add the customer's video.";
  if (!value.genuine) return "Tick that the customer confirmed this is their real experience.";
  return null;
}

export function CustomerReviewFields({ value, onChange, amounts, counts, disabled, consentName, onPickConsent, onRemoveConsent, screenshot, onPickScreenshot, onRemoveScreenshot }: {
  value: ReviewFormValue;
  onChange: (patch: Partial<ReviewFormValue>) => void;
  amounts: ReviewAmounts | null;
  counts: { photos: number; videos: number };
  disabled: boolean;
  consentName: string | null;
  onPickConsent: (file: File) => void;
  onRemoveConsent: () => void;
  /** The WhatsApp screenshot a written review needs: its name and a preview. */
  screenshot: { name: string; preview: string } | null;
  onPickScreenshot: (file: File) => void;
  onRemoveScreenshot: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ReviewOrderChoice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const consentInput = useRef<HTMLInputElement | null>(null);
  const screenshotInput = useRef<HTMLInputElement | null>(null);

  // Search the delivered orders (a rep sees only their own), a moment after typing stops.
  useEffect(() => {
    if (value.order) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const found = await customerReviewsApi.orders(query.trim());
        if (live) { setResults(found.orders); setError(""); }
      } catch (err) {
        if (live) setError((err as Error).message || "Could not load your delivered orders.");
      } finally {
        if (live) setLoading(false);
      }
    }, query ? 300 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, value.order]);

  const type = effectiveReviewType(value, counts);
  const amountOf = (level: ReviewLevel) => (amounts ? amounts[level] : 0);
  const order = value.order;
  const paid = order?.paid ?? 0;
  const adds = Math.max(0, amountOf(type) - paid);
  const label = "mb-1.5 block text-xs font-black text-gray-700 dark:text-slate-200";
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[15px] text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100";

  return (
    <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50/40 p-3 dark:border-blue-500/20 dark:bg-blue-500/5">
      <div>
        <span className={label}>Delivered order <span className="text-rose-500">*</span></span>
        {order ? (
          <div className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-950">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <span className="min-w-0 flex-1 text-[13px]">
              <b className="block text-[14px] text-gray-900 dark:text-slate-50">{order.customer || "Customer"} · order {order.id}</b>
              <span className="block text-gray-600 dark:text-slate-400">{order.productName}{order.deliveredOn ? ` · delivered ${shortDay(order.deliveredOn)}` : ""}{order.repName ? ` · ${order.repName}` : ""}</span>
              {order.paid > 0 && <span className="mt-0.5 block font-semibold text-amber-700 dark:text-amber-300">Already earned {naira(order.paid)} for this order{order.approvedLevel ? ` (${LEVEL_TEXT[order.approvedLevel]})` : ""}.</span>}
              {order.waiting && <span className="mt-0.5 block font-semibold text-rose-600">A review for this order is already waiting for approval.</span>}
            </span>
            <button type="button" disabled={disabled} onClick={() => onChange({ order: null })} className="!min-h-0 rounded-lg px-2 py-1 text-[12.5px] font-bold text-[#1F8FE0] disabled:opacity-50">Change</button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white dark:border-slate-600 dark:bg-slate-950">
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} disabled={disabled} aria-label="Search delivered orders"
                placeholder="Customer name, phone or order number"
                className="w-full rounded-t-xl border-0 border-b border-gray-100 bg-transparent py-3 pl-9 pr-3 text-[15px] text-gray-800 outline-none dark:border-slate-700 dark:text-slate-100" />
            </span>
            <div className="max-h-56 overflow-y-auto">
              {loading && <p className="m-0 flex items-center gap-2 px-3 py-3 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Looking…</p>}
              {!loading && error && <p className="m-0 px-3 py-3 text-[13px] text-rose-600">{error}</p>}
              {!loading && !error && results?.length === 0 && <p className="m-0 px-3 py-3 text-[13px] text-gray-500">{query ? "No delivered order matches." : "No delivered orders yet."}</p>}
              {!loading && !error && results?.map((choice) => (
                <button key={choice.id} type="button" disabled={disabled || choice.waiting} onClick={() => onChange({ order: choice, receivedOn: value.receivedOn < (choice.deliveredOn ?? "") ? lagosToday() : value.receivedOn })}
                  className="!min-h-0 flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2.5 text-left text-[13px] last:border-0 hover:bg-blue-50/60 disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-800">
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-gray-900 dark:text-slate-100">{choice.customer || "Customer"} · {choice.id}</b>
                    <span className="block truncate text-gray-500">{choice.productName}{choice.deliveredOn ? ` · delivered ${shortDay(choice.deliveredOn)}` : ""}</span>
                  </span>
                  {choice.waiting ? <span className="shrink-0 rounded-md bg-amber-50 px-2 py-0.5 text-[11.5px] font-bold text-amber-700">Waiting</span>
                    : choice.paid > 0 ? <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-[11.5px] font-bold text-emerald-700">{naira(choice.paid)} earned</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <span className={label}>Type of review</span>
        <div className="grid grid-cols-3 gap-2">
          {(["written", "photo", "video"] as ReviewType[]).map((key) => (
            <button key={key} type="button" disabled={disabled} onClick={() => onChange({ type: key })} aria-pressed={type === key}
              className={`!min-h-0 rounded-xl border px-2 py-2.5 text-center text-[13px] font-bold ${type === key ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 bg-white text-gray-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-200"}`}>
              {TYPE_TEXT[key]}<span className={`block text-[11.5px] font-semibold ${type === key ? "text-white/85" : "text-gray-500"}`}>{amounts ? naira(amountOf(key)) : "…"}</span>
            </button>
          ))}
        </div>
        <span className="mt-1 block text-[11.5px] text-gray-500 dark:text-slate-400">
          {type === "written" ? "A written review needs a WhatsApp screenshot that shows the customer's phone number. " : ""}
          A manager can make a strong video Premium ({amounts ? naira(amounts.premium) : "…"}). Paid once per order, at the highest level approved.
        </span>
      </div>

      <label className="block">
        <span className={label}>What the customer said {type === "written" ? <span className="text-rose-500">*</span> : <span className="font-semibold text-gray-400">(optional)</span>}</span>
        <textarea value={value.text} onChange={(event) => onChange({ text: event.target.value.slice(0, 2000) })} rows={3} disabled={disabled}
          placeholder="Their own words, good or bad. Never write a review for them." className={field} />
      </label>

      {(type === "written" || screenshot) && (
        <div>
          <span className={label}>WhatsApp screenshot {type === "written" ? <span className="text-rose-500">*</span> : <span className="font-semibold text-gray-400">(optional for a {type})</span>}</span>
          {screenshot ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-white p-2 dark:border-emerald-500/30 dark:bg-slate-950">
              <img src={screenshot.preview} alt="" className="h-16 w-12 shrink-0 rounded-lg object-cover" />
              <span className="min-w-0 flex-1 text-[12.5px]">
                <b className="block truncate text-gray-900 dark:text-slate-100">{screenshot.name}</b>
                <span className="block text-gray-500 dark:text-slate-400">The manager checks the number in it is the customer's{order?.phone ? ` (${order.phone})` : ""}.</span>
              </span>
              {!disabled && <button type="button" aria-label="Remove screenshot" onClick={onRemoveScreenshot} className="!min-h-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>}
            </div>
          ) : (
            <button type="button" disabled={disabled} onClick={() => screenshotInput.current?.click()}
              className="!min-h-0 flex w-full items-center gap-3 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/60 px-3 py-3 text-left disabled:opacity-50 dark:border-emerald-500/40 dark:bg-emerald-500/10">
              <MessageCircle className="h-6 w-6 shrink-0 text-emerald-600" />
              <span className="text-[12.5px] text-gray-700 dark:text-slate-200">
                <b className="block text-[13.5px] text-emerald-700 dark:text-emerald-300">Add the WhatsApp screenshot</b>
                The customer's message, with their phone number showing at the top of the chat.
              </span>
            </button>
          )}
          <input ref={screenshotInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPickScreenshot(file); }} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <span className={label}>Stars <span className="font-semibold text-gray-400">(if they gave any)</span></span>
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 bg-white px-2 py-2 dark:border-slate-600 dark:bg-slate-950">
            {[1, 2, 3, 4, 5].map((star) => (
              <button key={star} type="button" disabled={disabled} aria-label={`${star} star${star === 1 ? "" : "s"}`} onClick={() => onChange({ rating: value.rating === star ? null : star })} className="!min-h-0 p-0.5">
                <Star className={`h-5 w-5 ${value.rating && star <= value.rating ? "fill-amber-400 text-amber-400" : "text-gray-300 dark:text-slate-600"}`} />
              </button>
            ))}
            {value.rating && <button type="button" aria-label="Clear stars" onClick={() => onChange({ rating: null })} className="!min-h-0 ml-auto p-1 text-gray-400"><X className="h-4 w-4" /></button>}
          </div>
        </div>
        <label className="block">
          <span className={label}>Came by</span>
          <select value={value.channel} onChange={(event) => onChange({ channel: event.target.value as ReviewChannel })} disabled={disabled}
            className="!min-h-0 h-[42px] w-full rounded-xl border border-gray-200 bg-white px-3 text-[15px] !font-semibold text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">
            {CHANNELS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Came in on</span>
          <input type="date" value={value.receivedOn} min={order?.deliveredOn ?? undefined} max={lagosToday()} disabled={disabled}
            onChange={(event) => event.target.value && onChange({ receivedOn: event.target.value })}
            className="h-[42px] w-full rounded-xl border border-gray-200 bg-white px-3 text-[15px] text-gray-800 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100" />
        </label>
      </div>

      <label className="block">
        <span className={label}>Any problem the customer mentioned <span className="font-semibold text-gray-400">(optional)</span></span>
        <input value={value.complaint} onChange={(event) => onChange({ complaint: event.target.value.slice(0, 1000) })} disabled={disabled}
          placeholder="e.g. One screw was missing" className={field} />
      </label>

      <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-950">
        <span className="flex items-center gap-1.5 text-xs font-black text-gray-700 dark:text-slate-200"><ShieldCheck className="h-4 w-4 text-emerald-600" />Customer's permission</span>
        <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-gray-800 dark:text-slate-200">
          <input type="checkbox" checked={value.genuine} disabled={disabled} onChange={(event) => onChange({ genuine: event.target.checked })} className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          <span>The customer confirmed this is their real experience. <span className="text-rose-500">*</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px] text-gray-800 dark:text-slate-200">
          <input type="checkbox" checked={value.marketing} disabled={disabled} onChange={(event) => onChange({ marketing: event.target.checked })} className="mt-0.5 h-[18px] w-[18px] shrink-0" />
          <span>The customer agreed we can use it in ads and on our pages. <span className="text-gray-500">(only tick if they said yes)</span></span>
        </label>
        <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">
          {value.marketing ? "Once approved, it can be shared with customers and used in ads." : "Without this OK it stays private: only managers and you can see it. You still earn the bonus."}
        </p>
        {value.marketing && (
          consentName ? (
            <span className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">Proof: {consentName}</span>
              {!disabled && <button type="button" aria-label="Remove proof" onClick={onRemoveConsent} className="!min-h-0 p-0.5"><X className="h-4 w-4" /></button>}
            </span>
          ) : (
            <button type="button" disabled={disabled} onClick={() => consentInput.current?.click()} className="!min-h-0 text-[12.5px] font-bold text-[#1F8FE0] disabled:opacity-50">
              + Add proof of their OK (optional screenshot)
            </button>
          )
        )}
        <input ref={consentInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onPickConsent(file); }} />
      </div>

      {order && amounts && (
        <p className={`m-0 rounded-xl px-3 py-2 text-[13px] font-semibold ${adds > 0 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"}`}>
          {adds > 0
            ? paid > 0 ? `If approved as a ${LEVEL_TEXT[type]}: ${naira(adds)} more (this order already earned ${naira(paid)}).` : `Bonus if approved as a ${LEVEL_TEXT[type]}: ${naira(adds)}, in this week's report.`
            : `This order already earned ${naira(paid)}. A ${LEVEL_TEXT[type]} adds nothing more.`}
        </p>
      )}
    </div>
  );
}
