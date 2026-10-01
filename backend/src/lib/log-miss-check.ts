// Log-miss dispute checks (Bright, 1 Oct 2026). Pure, tested in
// log-miss-check.test.ts. A rep who thinks a missed-log charge is wrong asks
// the system first; it shows them what they actually did that day.
//   miss_wrong      -> goes to the manager marked "system supports the rep"
//   miss_confirmed  -> the rep sees why, and may still escalate with a reason

export type CheckFinding = { level: "issue" | "info" | "ok"; text: string };
export type CheckResult = { verdict: "miss_confirmed" | "miss_wrong"; findings: CheckFinding[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
export const dayLabel = (dateKey: string) => {
  const [y, m, d] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday]} ${d} ${MONTHS[m - 1]}`;
};
const timeLabel = (lagosHour: number, minute: number) => {
  const h12 = lagosHour % 12 === 0 ? 12 : lagosHour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${lagosHour < 12 ? "AM" : "PM"}`;
};

export type FollowUpAttempt = { lagosHour: number; lagosMinute: number; channels: string[]; note?: string | null };

/**
 * Follow-up miss: N50 per order per working day (per slot for unreachable
 * "chase" orders: morning = before 12:00, later = 12:00 onwards, Lagos time).
 */
export function checkFollowUpMiss(input: {
  orderId: string;
  missDate: string;
  slot: string;
  workingDay: boolean;
  startDate: string;
  assignedToRepNow: boolean;
  attemptsThatDay: FollowUpAttempt[];
  otherOrdersLoggedThatDay: number;
}): CheckResult {
  const findings: CheckFinding[] = [];
  const day = dayLabel(input.missDate);
  if (!input.workingDay) return { verdict: "miss_wrong", findings: [{ level: "ok", text: `${day} is a Sunday. Follow-ups are never charged on Sundays.` }] };
  if (input.missDate < input.startDate) return { verdict: "miss_wrong", findings: [{ level: "ok", text: `${day} is before follow-up charges started (${input.startDate}).` }] };

  const inSlot = input.attemptsThatDay.filter((attempt) =>
    input.slot === "morning" ? attempt.lagosHour < 12 : input.slot === "later" ? attempt.lagosHour >= 12 : true);
  for (const attempt of input.attemptsThatDay) {
    findings.push({
      level: "info",
      text: `You logged order #${input.orderId} at ${timeLabel(attempt.lagosHour, attempt.lagosMinute)}${attempt.channels.length ? ` (${attempt.channels.join(", ")})` : ""}${attempt.note ? `: "${attempt.note}"` : ""}.`
    });
  }
  if (inSlot.length > 0) {
    findings.unshift({
      level: "ok",
      text: input.slot === "day"
        ? `You did log order #${input.orderId} on ${day}. This charge looks wrong.`
        : `You did log order #${input.orderId} in the ${input.slot === "morning" ? "morning" : "afternoon/evening"} on ${day}. This charge looks wrong.`
    });
    return { verdict: "miss_wrong", findings };
  }
  findings.unshift({
    level: "issue",
    text: input.slot === "day"
      ? `No log was recorded for order #${input.orderId} on ${day}.`
      : `Order #${input.orderId} could not be reached, so it needed a ${input.slot === "morning" ? "morning (before 12:00)" : "second, afternoon/evening"} try on ${day}. None was logged in that part of the day.`
  });
  if (input.otherOrdersLoggedThatDay > 0) findings.push({ level: "info", text: `That day you logged ${input.otherOrdersLoggedThatDay} other order${input.otherOrdersLoggedThatDay === 1 ? "" : "s"}.` });
  if (!input.assignedToRepNow) findings.push({ level: "info", text: `This order is now with another rep. If it was not yours on ${day}, say so when you escalate.` });
  return { verdict: "miss_confirmed", findings };
}

/** Cart-log miss: N500 per due cart not logged that day. */
export function checkCartDay(input: {
  missDate: string;
  amountCharged: number;
  cartsDueNow: number;
  cartsMissedNow: number;
  amountNow: number;
  loggedCarts: Array<{ customer: string; time: string }>;
  missedCarts: Array<{ customer: string; product: string }>;
}): CheckResult {
  const day = dayLabel(input.missDate);
  const findings: CheckFinding[] = [];
  findings.push({ level: "info", text: `On ${day} you logged ${input.loggedCarts.length} of your carts.` });
  for (const cart of input.loggedCarts.slice(0, 15)) findings.push({ level: "info", text: `Logged: ${cart.customer} at ${cart.time}.` });
  if (input.loggedCarts.length > 15) findings.push({ level: "info", text: `…and ${input.loggedCarts.length - 15} more.` });

  if (input.cartsMissedNow === 0) {
    findings.unshift({ level: "ok", text: `Every cart due on ${day} was logged or has since closed. This charge looks wrong.` });
    return { verdict: "miss_wrong", findings };
  }
  if (input.amountNow < input.amountCharged) {
    findings.unshift({ level: "ok", text: `Only ${input.cartsMissedNow} cart${input.cartsMissedNow === 1 ? " is" : "s are"} still unlogged for ${day} (₦${input.amountNow.toLocaleString("en-NG")}), less than the ₦${input.amountCharged.toLocaleString("en-NG")} charged. Part of this charge looks wrong.` });
    return { verdict: "miss_wrong", findings };
  }
  findings.unshift({ level: "issue", text: `${input.cartsMissedNow} of ${input.cartsDueNow} carts due on ${day} had no log that day (₦${input.amountNow.toLocaleString("en-NG")}).` });
  for (const cart of input.missedCarts.slice(0, 15)) findings.push({ level: "issue", text: `Not logged: ${cart.customer} (${cart.product}).` });
  if (input.missedCarts.length > 15) findings.push({ level: "issue", text: `…and ${input.missedCarts.length - 15} more.` });
  return { verdict: "miss_confirmed", findings };
}

/**
 * Fines bigger than the bonus carry into the next week (Bright, 1 Oct 2026).
 * Returns what is paid this week and what is still owed afterwards.
 */
export function applyFines(input: { earned: number; fines: number; carriedIn: number }) {
  const owed = Math.max(0, input.fines) + Math.max(0, input.carriedIn);
  const earned = Math.max(0, input.earned);
  return { finalBonus: Math.max(0, earned - owed), unpaid: Math.max(0, owed - earned) };
}
