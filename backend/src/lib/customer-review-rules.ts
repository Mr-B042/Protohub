// Customer Reviews (Bright, 7 Nov 2026): the rules, kept free of the database
// so they can be tested. The bonus itself is paid inside the
// approve_customer_review function (migration 329), which follows the same
// rule as `topUp` below; the screens use `topUp` to say what an approval adds.

export const REVIEW_TYPES = ["written", "photo", "video"] as const;
export type ReviewType = (typeof REVIEW_TYPES)[number];
export const REVIEW_LEVELS = ["written", "photo", "video", "premium"] as const;
export type ReviewLevel = (typeof REVIEW_LEVELS)[number];
export const REVIEW_CHANNELS = ["whatsapp", "call", "sms", "in_person", "other"] as const;
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

export const LEVEL_LABEL: Record<ReviewLevel, string> = {
  written: "Written review",
  photo: "Product photo",
  video: "Video",
  premium: "Premium video"
};

/** Why an approver did not approve (the rep sees the reason and the note). */
export const REJECT_REASONS = {
  duplicate: "Duplicate review",
  unclear_photo: "Unclear photo",
  unusable_video: "Video can't be used",
  unverified_customer: "Customer can't be confirmed",
  wrong_order: "Wrong order",
  fabricated: "Looks made up",
  missing_info: "Missing information",
  other: "Other"
} as const;
export type RejectReason = keyof typeof REJECT_REASONS;
export const isRejectReason = (value: unknown): value is RejectReason => typeof value === "string" && value in REJECT_REASONS;

export type ReviewAmounts = { written: number; photo: number; video: number; premium: number };
export const DEFAULT_AMOUNTS: ReviewAmounts = { written: 50, photo: 100, video: 200, premium: 400 };

export const levelRank = (level: string | null | undefined) => (level ? REVIEW_LEVELS.indexOf(level as ReviewLevel) : -1);
export const amountFor = (level: ReviewLevel, amounts: ReviewAmounts) => Math.max(0, Math.round(Number(amounts[level] ?? 0)));

/**
 * What an approval pays: the order is worth its HIGHEST approved level, and
 * whatever was already paid for the order comes off. A photo (100) then a
 * video (200) pays 100 + 100; a premium upgrade after that pays 200 more.
 * Never negative: a lower review after a higher one pays nothing.
 */
export function topUp(approvedAmounts: number[], newAmount: number, alreadyPaid: number) {
  const worth = Math.max(0, newAmount, ...approvedAmounts);
  return { worth, credit: Math.max(0, Math.round(worth - Math.max(0, alreadyPaid))) };
}

/** The Sunday that starts the report week holding this Lagos day. */
export function weekStartOf(dateKey: string) {
  const day = new Date(`${dateKey}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}
export const lagosDay = (ms: number) => new Date(ms + 60 * 60_000).toISOString().slice(0, 10);
export const addDays = (dateKey: string, days: number) => {
  const day = new Date(`${dateKey}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
};

/**
 * Payroll counts a week's review bonus in the month its week ENDS in (the
 * Saturday), like the payout changes on weekly reports.
 */
export const payrollMonthOfWeek = (weekStart: string) => addDays(weekStart, 6).slice(0, 7);

export type NewReviewInput = {
  orderId: unknown; type: unknown; text: unknown; rating?: unknown; channel?: unknown; receivedOn?: unknown;
  complaint?: unknown; genuine: unknown; marketing?: unknown;
};

/**
 * What is wrong with a review before it is saved, or null. The customer's
 * own words are never made up: a written review needs them; a photo or video
 * may come without words.
 */
export function reviewProblem(input: NewReviewInput, context: { today: string; deliveredOn: string | null }): string | null {
  if (typeof input.orderId !== "string" || !input.orderId.trim()) return "Choose the delivered order this review is for.";
  if (!REVIEW_TYPES.includes(input.type as ReviewType)) return "Choose the type of review: written, photo or video.";
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (input.type === "written" && text.length < 5) return "Write what the customer said, in their words.";
  if (text.length > 2000) return "Keep the customer's words under 2,000 characters.";
  if (input.rating !== undefined && input.rating !== null && input.rating !== "") {
    const rating = Number(input.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return "A rating is 1 to 5 stars, or leave it empty.";
  }
  if (input.channel !== undefined && !REVIEW_CHANNELS.includes(input.channel as ReviewChannel)) return "Choose how the customer sent it.";
  if (input.receivedOn !== undefined && input.receivedOn !== null && input.receivedOn !== "") {
    const day = String(input.receivedOn);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "Choose the day the review came in.";
    if (day > context.today) return "The day the review came in can't be in the future.";
    if (context.deliveredOn && day < context.deliveredOn) return "The review can't have come in before the order was delivered.";
  }
  if (typeof input.complaint === "string" && input.complaint.length > 1000) return "Keep the problem the customer mentioned under 1,000 characters.";
  if (input.genuine !== true) return "Tick that the customer confirmed this is their real experience.";
  return null;
}

/** Files a review needs before it can be sent: a photo needs a photo, a video a video. */
export function filesProblem(type: ReviewType, files: Array<{ kind: string; status: string; part: string | null }>): string | null {
  const content = files.filter((file) => file.part !== "consent");
  if (content.some((file) => file.status === "uploading")) return "Some files are still being sent. Wait for them to finish.";
  const ready = content.filter((file) => file.status === "pending");
  if (type === "photo" && !ready.some((file) => file.kind === "image")) return "A photo review needs at least one photo.";
  if (type === "video" && !ready.some((file) => file.kind === "video")) return "A video review needs at least one video.";
  return null;
}

/** The levels an approver can approve this review at: never above what its files show. */
export function levelsFor(type: ReviewType, hasVideo: boolean, hasPhoto: boolean): ReviewLevel[] {
  const out: ReviewLevel[] = ["written"];
  if (hasPhoto || hasVideo) out.push("photo");
  if (hasVideo) out.push("video", "premium");
  // The rep's own choice is always offered, even if the files say less.
  if (!out.includes(type)) out.push(type);
  return REVIEW_LEVELS.filter((level) => out.includes(level));
}

export function cleanAmounts(raw: Partial<Record<keyof ReviewAmounts, unknown>> | null | undefined): ReviewAmounts {
  const pick = (value: unknown, fallback: number) => {
    const amount = Math.round(Number(value));
    return Number.isFinite(amount) && amount >= 0 && amount <= 100000 ? amount : fallback;
  };
  return {
    written: pick(raw?.written, DEFAULT_AMOUNTS.written),
    photo: pick(raw?.photo, DEFAULT_AMOUNTS.photo),
    video: pick(raw?.video, DEFAULT_AMOUNTS.video),
    premium: pick(raw?.premium, DEFAULT_AMOUNTS.premium)
  };
}
