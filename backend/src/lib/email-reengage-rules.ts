/**
 * Engaged-first sending + "Still want our emails?" (Bright, 21 Nov 2026).
 *
 * Only 70 of 361 people ever opened a marketing email; 144 got 3+ and opened
 * none. Gmail judges a sender by how many people ignore it, so emailing the
 * quiet ones pushes everyone's emails toward spam. So:
 *  - Broadcasts (scheduled / Plan campaigns) skip QUIET people: 3+ emails in
 *    the last 60 days and not one opened or clicked in those 60 days.
 *    Everyone else gets them, so new people still get their 3 chances.
 *  - Quiet people get "Still want our emails?" (email 1), then 4 days later a
 *    last check (email 2). Opening or clicking anything puts them back.
 *    No answer 4 days after email 2: marked "cleaned" — no more marketing
 *    emails. Order receipts and delivery updates still go (they're separate).
 *  - A cleaned person who places a new order comes back on the list.
 * Pure; tested in email-reengage-rules.test.ts.
 */

import { normalizeDesign, type EmailDesign } from "./email-render.js";

export const DAY = 86_400_000;
export const REENGAGE = { windowDays: 60, chances: 3, gapDays: 4 } as const;
export const CLEANED_REASON = "No opens in 60 days and no answer to 2 'Still want our emails?' checks";

export type Activity = { lastOpenedMs: number | null; lastClickedMs: number | null };

export const lastActiveMs = (a: Activity) => Math.max(a.lastOpenedMs ?? 0, a.lastClickedMs ?? 0);

/** Quiet: 3+ emails in 60 days, none opened or clicked in those 60 days. */
export function isQuiet(activity: Activity, emailsInWindow: number, nowMs: number) {
  return emailsInWindow >= REENGAGE.chances && lastActiveMs(activity) < nowMs - REENGAGE.windowDays * DAY;
}

/** This person's latest check: when email 1 and email 2 were sent (null = not yet). */
export type CheckRound = { round: number; email1Ms: number | null; email2Ms: number | null; email1Waiting: boolean; email2Waiting: boolean };

export type ReengageAction = "send1" | "send2" | "stop" | "none";

export function reengageAction(activity: Activity, quiet: boolean, check: CheckRound | null, nowMs: number): ReengageAction {
  const active = lastActiveMs(activity);
  // No check yet, or the last one is over and they went quiet again since.
  const lastCheckMs = check ? Math.max(check.email1Ms ?? 0, check.email2Ms ?? 0) : 0;
  const fresh = !check || (lastCheckMs > 0 && nowMs - lastCheckMs > REENGAGE.windowDays * DAY);
  if (fresh) return quiet && !(check && (check.email1Waiting || check.email2Waiting)) ? "send1" : "none";
  if (check!.email1Waiting || check!.email2Waiting) return "none";
  if (check!.email1Ms === null) return "none";
  // They opened or clicked something after the check began: they stay.
  if (active >= check!.email1Ms) return "none";
  if (check!.email2Ms === null) return nowMs - check!.email1Ms >= REENGAGE.gapDays * DAY ? "send2" : "none";
  return nowMs - check!.email2Ms >= REENGAGE.gapDays * DAY ? "stop" : "none";
}

const STORE_URL = "https://brightpathhubs.com/";

export type CheckStep = "reengage1" | "reengage2";

/** The two check emails: short, one button, plain words. */
export function checkDesign(step: CheckStep, brand: string): { subject: string; preheader: string; design: EmailDesign } {
  const first = step === "reengage1";
  const blocks = [
    { id: "rh", type: "header", brand, tagline: "", align: "center" },
    { id: "rt1", type: "text", text: "Hi {{First Name}},", size: 17, align: "left", color: "", bold: true },
    {
      id: "rt2", type: "text", size: 15, align: "left", color: "", bold: false,
      text: first
        ? `We noticed you haven't opened our emails in a while. We don't want to fill your inbox with things you don't read.\n\nIf you'd still like to hear about new products and offers from ${brand}, tap the button below.\n\nIf not, you don't need to do anything. We'll stop these emails in a few days.`
        : `This is our last check. Tap below if you want to keep getting our new products and offers.\n\nIf we don't hear from you, we'll stop these emails. No hard feelings.`
    },
    { id: "rb", type: "button", text: first ? "Yes, keep me on the list" : "Keep my emails coming", link: STORE_URL, style: "primary", size: "large", align: "center", color: "#5B3FD9", textColor: "#FFFFFF", radius: 10 },
    { id: "rt3", type: "text", text: "Emails about any order you place (receipts and delivery updates) will still come as normal.", size: 13, align: "left", color: "#6B7280", bold: false },
    { id: "rs", type: "text", text: `Thank you,\nThe ${brand} Team`, size: 15, align: "left", color: "", bold: false },
    { id: "rf", type: "footer", text: "Pay on Delivery | Delivered to Your Door" }
  ];
  return {
    subject: first ? "{{First Name}}, do you still want our emails?" : "Should we stop emailing you, {{First Name}}?",
    preheader: first ? "One tap to stay, or we'll stop." : `Last check from ${brand}`,
    design: normalizeDesign({ blocks, styles: { brandColor: "#5B3FD9" } })!
  };
}
