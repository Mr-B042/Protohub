/**
 * Designed vs plain one-link note on Autopilot emails (Bright, 21 Nov 2026).
 * Half the people get the designed email (A), half a plain note with one
 * link (B). A person always lands on the same side, in every email of every
 * flow, so each side's numbers are clean. Pure; tested in plain-test-rules.test.ts.
 */

/** Same person, same side: a stable split by email address. */
export function plainTestVariant(email: string): "a" | "b" {
  let hash = 0;
  for (const ch of email.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 2 === 0 ? "a" : "b";
}

export type SideStats = { sent: number; opened: number; clicked: number };
export type PlainVerdict = {
  kind: "too_early" | "plain" | "designed" | "tie";
  /** What decided it: clicks when there are enough, else opens. */
  measure: "clicks" | "opens";
  text: string;
};

/** Sends each side needs before any verdict. */
export const MIN_PER_SIDE = 100;
/** Clicks (both sides together) before clicks decide instead of opens. */
export const MIN_CLICKS = 10;

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/** Two-proportion z-test: is the gap bigger than luck (95%)? */
function significant(x1: number, n1: number, x2: number, n2: number) {
  const p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (!se) return false;
  return Math.abs(x1 / n1 - x2 / n2) / se >= 1.96;
}

export function plainVerdict(designed: SideStats, plain: SideStats): PlainVerdict {
  const fewest = Math.min(designed.sent, plain.sent);
  const clicksDecide = designed.clicked + plain.clicked >= MIN_CLICKS;
  const measure = clicksDecide ? "clicks" : "opens";
  if (fewest < MIN_PER_SIDE) return { kind: "too_early", measure, text: `Too early: ${fewest} of ${MIN_PER_SIDE} sent on each side` };
  const [a, b] = clicksDecide ? [designed.clicked, plain.clicked] : [designed.opened, plain.opened];
  const rateA = pct(a, designed.sent), rateB = pct(b, plain.sent);
  if (!significant(a, designed.sent, b, plain.sent)) return { kind: "tie", measure, text: `No clear winner yet (${measure}: designed ${rateA}% vs plain ${rateB}%)` };
  return rateB > rateA
    ? { kind: "plain", measure, text: `Plain wins on ${measure}: ${rateB}% vs ${rateA}%` }
    : { kind: "designed", measure, text: `Designed wins on ${measure}: ${rateA}% vs ${rateB}%` };
}
