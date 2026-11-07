import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, BadgeCheck, CheckCircle2, ClipboardCheck, Clock, Film, Image as ImageIcon, Loader2, Lock, Megaphone, MessageCircle, MessageSquareQuote,
  Plus, RefreshCw, Search, Settings2, Star, Wallet, XCircle
} from "lucide-react";
import { customerReviewsApi, type CustomerReview, type ReviewAmounts, type ReviewDetail, type ReviewLevel, type ReviewList, type ReviewStatus } from "../../lib/api";
import { Sheet, cardShell } from "./shared";

/**
 * Products & Stock › Customer Reviews (Bright, 7 Nov 2026). Reps see their
 * own reviews and what they earned; Owner / Admin / Manager see everyone's
 * and decide the waiting ones. Approving pays the order's rep once per order,
 * at the highest level approved, in the weekly report of the week approved.
 */

const naira = (amount: number) => `${amount < 0 ? "-" : ""}₦${Math.abs(Math.round(amount)).toLocaleString("en-NG")}`;
const shortDay = (value: string | null) => (value ? new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: value.length === 10 ? "UTC" : "Africa/Lagos" }) : "—");
/** A Nigerian mobile as WhatsApp shows an unsaved contact: 08031234567 -> +234 803 123 4567. */
const whatsappForm = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  const local = /^0[789]\d{9}$/.test(digits) ? digits.slice(1) : /^234[789]\d{9}$/.test(digits) ? digits.slice(3) : null;
  return local ? `+234 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : null;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });

const LEVEL_TEXT: Record<ReviewLevel, string> = { written: "Written", photo: "Photo", video: "Video", premium: "Premium video" };
const STATUS_LOOK: Record<ReviewStatus, { text: string; tone: string }> = {
  pending: { text: "Waiting for approval", tone: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  approved: { text: "Approved", tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" },
  changes_requested: { text: "Asked to fix", tone: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300" },
  rejected: { text: "Not approved", tone: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300" }
};
const EVENT_TEXT: Record<string, string> = {
  submitted: "Sent for approval", approved: "Approved", upgraded: "Moved up", rejected: "Not approved", changes_requested: "Asked to fix",
  marketing_allowed: "Marketing allowed", marketing_withdrawn: "Made private", imported: "Brought over"
};

type Filter = "pending" | "approved" | "changes_requested" | "rejected" | "all";
const FILTERS: Array<[Filter, string]> = [["pending", "Waiting"], ["approved", "Approved"], ["changes_requested", "Asked to fix"], ["rejected", "Not approved"], ["all", "All"]];

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold ${tone}`}>{children}</span>;
}

function Stars({ value }: { value: number | null }) {
  if (!value) return null;
  return <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5 stars`}>{[1, 2, 3, 4, 5].map((star) => <Star key={star} className={`h-3.5 w-3.5 ${star <= value ? "fill-amber-400 text-amber-400" : "text-gray-300 dark:text-slate-600"}`} />)}</span>;
}

function Tile({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: string; note?: string; tone: string }) {
  return (
    <div className={`${cardShell} flex items-start gap-3 p-4`}>
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-bold text-gray-500 dark:text-slate-400">{label}</span>
        <b className="block text-[22px] font-black leading-tight text-gray-900 dark:text-slate-50">{value}</b>
        {note && <span className="block text-[11.5px] text-gray-500 dark:text-slate-400">{note}</span>}
      </span>
    </div>
  );
}

function levelOf(review: CustomerReview): string {
  return review.approvedLevel ? LEVEL_TEXT[review.approvedLevel] : LEVEL_TEXT[review.type];
}

function ReviewCard({ review, amounts, onOpen }: { review: CustomerReview; amounts: ReviewAmounts | null; onOpen: () => void }) {
  // Only the customer's own photos and videos make the picture: never a screenshot with their number.
  const cover = review.files.find((file) => file.part === "content" && file.thumbUrl);
  const hasVideo = review.files.some((file) => file.part === "content" && file.kind === "video");
  const look = STATUS_LOOK[review.status];
  return (
    <button type="button" onClick={onOpen} className={`${cardShell} !min-h-0 flex w-full gap-3 p-3 text-left transition-colors hover:border-[#1F8FE0]/50`}>
      <span className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gray-100 dark:bg-slate-800">
        {cover?.thumbUrl ? <img src={cover.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <MessageSquareQuote className="h-7 w-7 text-gray-400" />}
        {hasVideo && <span className="absolute bottom-1 left-1 inline-flex items-center gap-0.5 rounded bg-black/60 px-1 text-[9px] font-black text-white"><Film className="h-2.5 w-2.5" />VIDEO</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <Pill tone={look.tone}>{look.text}</Pill>
          <Pill tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/10 dark:text-blue-300">{levelOf(review)}</Pill>
          {review.legacy ? <Pill tone="bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">From before</Pill>
            : review.marketingOk ? <Pill tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Megaphone className="h-3 w-3" />For marketing</Pill>
              : <Pill tone="bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300"><Lock className="h-3 w-3" />Private</Pill>}
        </span>
        <b className="mt-1 block truncate text-[14px] text-gray-900 dark:text-slate-50">{review.customer || "Customer"} · order {review.orderId}</b>
        <span className="block truncate text-[12.5px] text-gray-600 dark:text-slate-400">{review.productName}{review.repName ? ` · ${review.repName}` : ""}</span>
        {review.text && <span className="mt-0.5 block truncate text-[12.5px] italic text-gray-500 dark:text-slate-400">“{review.text}”</span>}
        <span className="mt-1 flex items-center gap-2 text-[12px] text-gray-500 dark:text-slate-400">
          <span>{shortDay(review.submittedAt ?? review.createdAt)}</span>
          <Stars value={review.rating} />
          <span className="ml-auto font-bold text-gray-800 dark:text-slate-200">
            {review.status === "approved" ? (review.bonus.paidForReview > 0 ? `+${naira(review.bonus.paidForReview)}` : review.legacy ? "No bonus" : "Already paid")
              : review.status === "pending" && amounts ? `${naira(Math.max(0, amounts[review.type] - review.bonus.paidForOrder))} if approved` : ""}
          </span>
        </span>
      </span>
    </button>
  );
}

function AmountsCard({ amounts, onSaved, onToast }: { amounts: ReviewAmounts; onSaved: (amounts: ReviewAmounts) => void; onToast: (message: string) => void }) {
  const [draft, setDraft] = useState(amounts);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(amounts), [amounts]);
  const save = async () => {
    setSaving(true);
    try { const done = await customerReviewsApi.saveSettings(draft); onSaved(done.amounts); onToast("Review bonus amounts saved."); }
    catch (error) { onToast((error as Error).message || "Could not save."); } finally { setSaving(false); }
  };
  return (
    <section className={`${cardShell} p-4`}>
      <b className="flex items-center gap-2 text-[15px] text-gray-900 dark:text-slate-50"><Settings2 className="h-4 w-4 text-[#1F8FE0]" />Review bonus amounts</b>
      <p className="m-0 mt-0.5 text-[12.5px] text-gray-500 dark:text-slate-400">Paid once per order at the highest level approved. A change applies to approvals from now on.</p>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["written", "photo", "video", "premium"] as ReviewLevel[]).map((level) => (
          <label key={level} className="block text-[12.5px] font-bold text-gray-700 dark:text-slate-300">{LEVEL_TEXT[level]} (₦)
            <input type="number" min={0} step={50} value={draft[level]} onChange={(event) => setDraft({ ...draft, [level]: Number(event.target.value) || 0 })}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] font-normal dark:border-slate-600 dark:bg-slate-950" />
          </label>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button type="button" disabled={saving} onClick={save} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13.5px] font-black text-white disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Save amounts
        </button>
      </div>
    </section>
  );
}

function ReviewSheet({ reviewId, writable, onClose, onChanged, onToast }: {
  reviewId: string; writable: boolean; onClose: () => void; onChanged: () => void; onToast: (message: string) => void;
}) {
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [level, setLevel] = useState<ReviewLevel | null>(null);
  const [mode, setMode] = useState<"none" | "reject" | "changes">("none");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    customerReviewsApi.detail(reviewId).then((result) => { if (live) { setDetail(result); setLevel(result.review.type); } }).catch((err: Error) => { if (live) setError(err.message || "Could not load the review."); });
    return () => { live = false; };
  }, [reviewId]);

  const act = async (run: () => Promise<ReviewDetail>, done: (result: ReviewDetail) => string) => {
    setBusy(true);
    try {
      const result = await run();
      setDetail(result);
      setMode("none"); setNote(""); setReason("");
      onToast(result.warning || done(result));
      onChanged();
    } catch (err) { onToast((err as Error).message || "Could not save."); } finally { setBusy(false); }
  };

  const review = detail?.review;
  const canDecide = !!detail?.canApprove && writable && review?.status === "pending";
  const content = review?.files.filter((file) => file.part === "content") ?? [];
  const proof = review?.files.filter((file) => file.part === "consent") ?? [];
  // A written review's WhatsApp screenshot with the customer's number (Bright, 7 Nov 2026).
  const screenshots = review?.files.filter((file) => file.part === "proof") ?? [];
  const missingScreenshot = !!review && !review.legacy && screenshots.length === 0;
  const hasVideo = content.some((file) => file.kind === "video");
  const premiumOption = detail?.options.find((option) => option.level === "premium");
  const chosen = detail?.options.find((option) => option.level === level) ?? null;
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] dark:border-slate-600 dark:bg-slate-950";
  const section = "rounded-2xl border border-gray-100 p-3 dark:border-slate-800";
  const head = "mb-2 flex items-center gap-1.5 text-[12.5px] font-black uppercase tracking-wide text-gray-500 dark:text-slate-400";

  const footer = review && detail ? (
    canDecide ? (
      mode === "none" ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy} onClick={() => setMode("reject")} className="!min-h-0 rounded-xl border border-rose-200 px-3 py-2.5 text-[13.5px] font-bold text-rose-600 disabled:opacity-50">Not approve</button>
          <button type="button" disabled={busy} onClick={() => setMode("changes")} className="!min-h-0 rounded-xl border border-gray-200 px-3 py-2.5 text-[13.5px] font-bold text-gray-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">Ask to fix</button>
          <button type="button" disabled={busy || !level} onClick={() => act(() => customerReviewsApi.approve(review.id, level!, note), (result) => (result.credited ?? 0) > 0 ? `Approved. ${naira(result.credited ?? 0)} goes into ${review.repName || "the rep"}'s report this week.` : "Approved. This order's bonus was already paid.")}
            className="!min-h-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-[13.5px] font-black text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Approve{chosen ? ` as ${chosen.label.toLowerCase()} · +${naira(chosen.adds)}` : ""}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {mode === "reject" && (
            <select value={reason} onChange={(event) => setReason(event.target.value)} className={`!min-h-0 h-10 ${field} !font-normal`} aria-label="Reason">
              <option value="">Why is it not approved?</option>
              {Object.entries(detail.reasons).map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
          )}
          <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} rows={2} className={field}
            placeholder={mode === "changes" ? "What should the rep fix? (they will send it again)" : "A note for the rep (needed for Other)"} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => setMode("none")} className="!min-h-0 rounded-xl border border-gray-200 px-4 py-2.5 text-[13.5px] font-bold text-gray-700 dark:border-slate-600 dark:text-slate-200">Back</button>
            <button type="button" disabled={busy || (mode === "reject" ? !reason : note.trim().length < 3)}
              onClick={() => act(() => mode === "reject" ? customerReviewsApi.reject(review.id, reason, note) : customerReviewsApi.requestChanges(review.id, note), () => mode === "reject" ? "Marked not approved. The rep has been told why." : "Sent back to the rep to fix.")}
              className={`!min-h-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-black text-white disabled:opacity-50 ${mode === "reject" ? "bg-rose-600" : "bg-[#1F8FE0]"}`}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{mode === "reject" ? "Not approve" : "Send back to fix"}
            </button>
          </div>
        </div>
      )
    ) : detail.canApprove && writable && review.status === "approved" && !review.legacy ? (
      <div className="flex flex-wrap gap-2">
        {hasVideo && review.approvedLevel === "video" && premiumOption && (
          <button type="button" disabled={busy} onClick={() => act(() => customerReviewsApi.premium(review.id), (result) => `Premium. ${naira(result.credited ?? 0)} more for ${review.repName || "the rep"}.`)}
            className="!min-h-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-[13.5px] font-black text-white disabled:opacity-50">
            <BadgeCheck className="h-4 w-4" />Make Premium · +{naira(premiumOption.adds)}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => act(() => customerReviewsApi.setMarketing(review.id, !review.marketingOk), () => review.marketingOk ? "Made private. Its files left the gallery." : "Allowed for marketing. Its files are now in the gallery.")}
          className="!min-h-0 inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-[13.5px] font-bold text-gray-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200">
          {review.marketingOk ? <><Lock className="h-4 w-4" />Customer took back permission: make private</> : <><Megaphone className="h-4 w-4" />Customer now allows marketing</>}
        </button>
      </div>
    ) : null
  ) : null;

  return (
    <Sheet wide title={review ? `${review.customer || "Customer"} · order ${review.orderId}` : "Customer review"}
      subtitle={review ? `${review.productName}${review.repName ? ` · ${review.repName}` : ""}` : undefined} onClose={onClose} footer={footer}>
      {!detail && !error && <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
      {error && <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      {review && detail && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={STATUS_LOOK[review.status].tone}>{STATUS_LOOK[review.status].text}</Pill>
            <Pill tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/10 dark:text-blue-300">{review.approvedLevel ? `Approved as ${LEVEL_TEXT[review.approvedLevel].toLowerCase()}` : `Sent as ${LEVEL_TEXT[review.type].toLowerCase()}`}</Pill>
            {review.legacy && <Pill tone="bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">From Customer Retention · no bonus</Pill>}
          </div>
          {(review.status === "rejected" || review.status === "changes_requested") && (review.decisionReasonText || review.decisionNote) && (
            <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:bg-rose-500/10 dark:text-rose-200">
              <b>{review.reviewedByName ?? "Manager"}:</b> {[review.decisionReasonText, review.decisionNote].filter(Boolean).join(". ")}
            </p>
          )}

          {content.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {content.map((file) => file.kind === "video"
                ? <video key={file.id} src={file.url ?? undefined} poster={file.thumbUrl ?? undefined} controls playsInline preload="metadata" className="aspect-square w-full rounded-xl bg-black object-contain" />
                : <a key={file.id} href={file.url ?? undefined} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-gray-100 dark:bg-slate-800"><img src={file.thumbUrl ?? file.url ?? undefined} alt={file.name} className="aspect-square w-full object-cover" /></a>)}
            </div>
          )}

          <section className={section}>
            <p className={head}><MessageSquareQuote className="h-4 w-4" />What the customer said</p>
            {review.text ? <p className="m-0 text-[14.5px] italic text-gray-900 dark:text-slate-100">“{review.text}”</p> : <p className="m-0 text-[13px] text-gray-500">No words written down.</p>}
            <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-gray-500 dark:text-slate-400">
              <Stars value={review.rating} /><span>Came by {review.channelText}</span><span>on {shortDay(review.receivedOn)}</span>
            </p>
            {review.complaint && <p className="m-0 mt-2 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[13px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Problem mentioned: {review.complaint}</p>}
          </section>

          {(screenshots.length > 0 || missingScreenshot) && (
            <section className={section}>
              <p className={head}><MessageCircle className="h-4 w-4" />WhatsApp screenshot</p>
              {missingScreenshot ? (
                <p className="m-0 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[13px] font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">No WhatsApp screenshot. Every review needs one showing the customer's phone number: ask the rep to fix it.</p>
              ) : (
                <div className="flex flex-wrap items-start gap-3">
                  {screenshots.map((file) => (
                    <a key={file.id} href={file.url ?? undefined} target="_blank" rel="noreferrer" className="block w-40 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800">
                      <img src={file.thumbUrl ?? file.url ?? undefined} alt="WhatsApp screenshot" className="max-h-72 w-full object-contain" />
                    </a>
                  ))}
                  <p className="m-0 min-w-[200px] flex-1 text-[13px] text-gray-800 dark:text-slate-200">
                    Check the number in the screenshot is the customer's{review.phone ? <>: <b className="whitespace-nowrap">{review.phone}</b>{whatsappForm(review.phone) ? <> (on WhatsApp: <b className="whitespace-nowrap">{whatsappForm(review.phone)}</b>)</> : null}</> : "."}
                    <span className="mt-1 block text-[12px] text-gray-500 dark:text-slate-400">Tap the screenshot to see it full size. It stays private: it is never shared or used in ads.</span>
                  </p>
                </div>
              )}
            </section>
          )}

          <section className={section}>
            <p className={head}><ClipboardCheck className="h-4 w-4" />Permission and order</p>
            <ul className="m-0 list-none space-y-1 p-0 text-[13.5px] text-gray-800 dark:text-slate-200">
              <li>{review.genuine ? "✓ Customer confirmed it is their real experience" : review.legacy ? "Not asked (logged before reviews were approved)" : "Not confirmed"}</li>
              <li>{review.marketingOk ? "✓ Customer allowed marketing use" : "Private: no OK for marketing (never shared or used in ads)"}{review.marketingWithdrawnAt ? ` · taken back ${shortDay(review.marketingWithdrawnAt)}` : ""}</li>
              {proof.map((file) => <li key={file.id}><a href={file.url ?? undefined} target="_blank" rel="noreferrer" className="font-semibold text-[#1F8FE0]">See proof of permission</a></li>)}
              <li>Order {review.orderId}{review.deliveredOn ? ` · delivered ${shortDay(review.deliveredOn)}` : ""}{review.orderStatus && review.orderStatus !== "Delivered" ? <b className="text-rose-600"> · now {review.orderStatus}</b> : null}</li>
              {review.phone && <li>Customer phone: {review.phone}</li>}
              <li>Rep: {review.repName || "—"}{review.submittedByName && review.submittedByName !== review.repName ? ` · sent by ${review.submittedByName}` : ""}</li>
            </ul>
          </section>

          {detail.canApprove && (
            <section className={section}>
              <p className={head}><Wallet className="h-4 w-4" />Bonus and checks</p>
              {review.status === "pending" ? (
                <div className="space-y-1.5" role="radiogroup" aria-label="Approve as">
                  {detail.options.map((option) => (
                    <label key={option.level} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-[13.5px] ${level === option.level ? "border-[#1F8FE0] bg-blue-50/60 dark:bg-blue-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                      <input type="radio" name="level" checked={level === option.level} onChange={() => setLevel(option.level)} disabled={!writable} />
                      <span className="flex-1 font-semibold text-gray-900 dark:text-slate-100">{option.label} <span className="font-normal text-gray-500">({naira(option.amount)})</span></span>
                      <b className={option.adds > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-gray-400"}>{option.adds > 0 ? `+${naira(option.adds)}` : "adds nothing"}</b>
                    </label>
                  ))}
                  <p className="m-0 text-[12px] text-gray-500 dark:text-slate-400">The rep sent it as {LEVEL_TEXT[review.type].toLowerCase()}. Premium is for a clear, strong video good enough for ads.</p>
                  {canDecide && <input value={note} onChange={(event) => setNote(event.target.value.slice(0, 500))} placeholder="A note for the rep (optional)" className={field} />}
                </div>
              ) : (
                <p className="m-0 text-[13.5px] text-gray-800 dark:text-slate-200">{review.legacy ? "No bonus: logged before reviews were approved." : `This review paid ${naira(review.bonus.paidForReview)}. The order has earned ${naira(review.bonus.paidForOrder)} in all.`}</p>
              )}
              <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[12.5px]">
                <li className={detail.duplicates.length ? "font-semibold text-rose-600" : "text-gray-500 dark:text-slate-400"}>
                  {detail.duplicates.length ? `Same file seen before: ${detail.duplicates.map((item) => item.orderId ? `order ${item.orderId} (${item.status})` : item.status).join(", ")}` : "✓ No file was seen before"}
                </li>
                <li className="text-gray-500 dark:text-slate-400">
                  {detail.others.length ? `Other reviews of this order: ${detail.others.map((item) => `${levelOf(item)} (${STATUS_LOOK[item.status].text.toLowerCase()})`).join(", ")}` : "✓ First review of this order"}
                </li>
                {detail.ledger.length > 0 && <li className="text-gray-500 dark:text-slate-400">Already paid for this order: {detail.ledger.map((item) => `${naira(item.amount)} ${item.levelText.toLowerCase()} (${shortDay(item.createdAt)})`).join(" + ")}</li>}
              </ul>
            </section>
          )}

          {detail.events.length > 0 && (
            <section className={section}>
              <p className={head}><Clock className="h-4 w-4" />History</p>
              <ol className="m-0 list-none space-y-1 p-0 text-[12.5px] text-gray-700 dark:text-slate-300">
                {detail.events.map((event, index) => (
                  <li key={index}><b>{EVENT_TEXT[event.action] ?? event.action}</b> · {event.actorName} · {when(event.at)}{event.amount ? ` · ${naira(event.amount)}` : ""}{event.note ? ` · ${event.note}` : ""}</li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function ReviewsTab({ writable, onToast, onSend }: { writable: boolean; onToast: (message: string) => void; onSend?: () => void }) {
  const [data, setData] = useState<ReviewList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [kind, setKind] = useState<"" | ReviewLevel>("");
  const [privacy, setPrivacy] = useState<"" | "marketing" | "private">("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [canEditAmounts, setCanEditAmounts] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await customerReviewsApi.list()); setError(""); }
    catch (err) { setError((err as Error).message || "Could not load the customer reviews."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { customerReviewsApi.settings().then((result) => setCanEditAmounts(result.canEdit)).catch(() => undefined); }, []);

  // Approvers start on the waiting ones; reps on everything they sent.
  const shownFilter: Filter = filter ?? (data?.canApprove && (data.summary.waiting ?? 0) > 0 ? "pending" : "all");
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.reviews ?? []).filter((review) => (shownFilter === "all" || review.status === shownFilter)
      && (!kind || (review.approvedLevel ?? review.type) === kind)
      && (!privacy || (privacy === "marketing" ? review.marketingOk : !review.marketingOk))
      && (!q || `${review.customer} ${review.orderId} ${review.productName} ${review.repName} ${review.text}`.toLowerCase().includes(q)));
  }, [data, shownFilter, kind, privacy, search]);
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { pending: 0, approved: 0, changes_requested: 0, rejected: 0, all: 0 };
    for (const review of data?.reviews ?? []) { out[review.status] += 1; out.all += 1; }
    return out;
  }, [data]);

  const s = data?.summary;
  const mine = data && !data.canApprove;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-600 dark:bg-amber-500/10" label={mine ? "My reviews waiting" : "Waiting for approval"} value={String(s?.waiting ?? "…")} />
        <Tile icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" label="Approved this week" value={String(s?.approvedThisWeek ?? "…")} />
        <Tile icon={<Wallet className="h-5 w-5" />} tone="bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/10" label={mine ? "My review bonus this week" : "Review bonus this week"} value={s ? naira(s.bonusThisWeek) : "…"} note={s ? `${naira(s.bonusTotal)} in all` : undefined} />
        <Tile icon={<Megaphone className="h-5 w-5" />} tone="bg-violet-50 text-violet-600 dark:bg-violet-500/10" label="Approved for marketing" value={String(s?.forMarketing ?? "…")} note="the rest stay private" />
      </div>

      <div className={`${cardShell} space-y-3 p-3`}>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([key, text]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={shownFilter === key}
              className={`!min-h-0 rounded-full border px-3 py-1.5 text-[13px] font-bold ${shownFilter === key ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 bg-white text-gray-600 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300"}`}>
              {text} <span className={shownFilter === key ? "text-white/80" : "text-gray-400"}>{counts[key]}</span>
            </button>
          ))}
          <button type="button" aria-label="Refresh" onClick={() => void load()} className="!min-h-0 ml-auto rounded-full border border-gray-200 p-2 text-gray-600 dark:border-slate-600 dark:text-slate-300"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
          {onSend && writable && (
            <button type="button" onClick={onSend} className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-3.5 py-2 text-[13px] font-black text-white">
              <Plus className="h-4 w-4" />Send a customer review
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, order, product, rep or words" aria-label="Search reviews"
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-[14px] dark:border-slate-600 dark:bg-slate-950" />
          </span>
          <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Type" className="!min-h-0 h-[42px] rounded-xl border border-gray-200 bg-white px-3 text-[14px] !font-semibold dark:border-slate-600 dark:bg-slate-950">
            <option value="">All types</option>
            {(["written", "photo", "video", "premium"] as ReviewLevel[]).map((level) => <option key={level} value={level}>{LEVEL_TEXT[level]}</option>)}
          </select>
          <select value={privacy} onChange={(event) => setPrivacy(event.target.value as typeof privacy)} aria-label="Marketing" className="!min-h-0 h-[42px] rounded-xl border border-gray-200 bg-white px-3 text-[14px] !font-semibold dark:border-slate-600 dark:bg-slate-950">
            <option value="">Marketing and private</option>
            <option value="marketing">For marketing</option>
            <option value="private">Private only</option>
          </select>
        </div>
      </div>

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
      {!data && !error && <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
      {data && shown.length === 0 && (
        <div className={`${cardShell} flex flex-col items-center gap-2 px-4 py-10 text-center`}>
          {shownFilter === "pending" ? <CheckCircle2 className="h-8 w-8 text-emerald-500" /> : <ImageIcon className="h-8 w-8 text-gray-300" />}
          <b className="text-[15px] text-gray-900 dark:text-slate-50">{shownFilter === "pending" ? "Nothing waiting" : "No reviews here yet"}</b>
          <span className="max-w-md text-[13px] text-gray-500 dark:text-slate-400">
            {mine ? "Send a customer's review from Upload media: choose “Customer review” and pick the delivered order." : "Reviews reps send from Upload media show here for you to approve."}
          </span>
        </div>
      )}
      {shown.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((review) => <ReviewCard key={review.id} review={review} amounts={data?.amounts ?? null} onOpen={() => setOpenId(review.id)} />)}
        </div>
      )}

      {canEditAmounts && data && <AmountsCard amounts={data.amounts} onToast={onToast} onSaved={(amounts) => setData((current) => current ? { ...current, amounts } : current)} />}
      {data?.reviews.some((review) => review.legacy) && (
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-slate-400"><XCircle className="h-3.5 w-3.5" />“From before” reviews were logged in Customer Retention (Aug 2026), before reviews were approved. They earn no bonus.</p>
      )}

      {openId && <ReviewSheet reviewId={openId} writable={writable} onClose={() => setOpenId(null)} onChanged={() => void load()} onToast={onToast} />}
    </div>
  );
}
