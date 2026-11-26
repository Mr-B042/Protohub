// Plain-words error messages (Bright, 26 Nov 2026: "always give them an error
// message instead of silent - this will teach them why it didn't proceed and
// what to do ... in all areas").
//
// ⚠️ Routes send `{ error: error.message }` straight from the database in
// ~700 places. A rep then saw "new row for relation "cart_contact_attempts"
// violates check constraint "cart_attempt_outcome_valid"" (BUG-1003) - true,
// but useless: it says neither what went wrong nor what to do. Instead of
// editing every route (one would always be missed), index.ts runs every error
// response through friendlyError(). The technical text is kept as `detail`,
// so Report a Bug still attaches the real cause.
//
// Every message answers two questions: what happened, and what to do now.
// Only TECHNICAL texts are rewritten; a route's own plain message passes
// through untouched (friendlyError returns null).

// Names people see on screen for common database columns. Anything not here
// is turned from "customer_phone" into "Customer phone".
const FIELD_LABELS: Record<string, string> = {
  outcome_code: "What happened", custom_outcome: "Reason", outcome_note: "Note", next_action_at: "Call-back date",
  customer_reached: "Did you speak to the customer", phone: "Phone number", whatsapp: "WhatsApp number",
  customer: "Customer name", customer_name: "Customer name", amount: "Amount", quantity: "Quantity",
  product_id: "Product", agent_id: "Delivery agent", assigned_rep_id: "Sales rep", rep_id: "Sales rep",
  state: "State", address: "Address", delivery_fee: "Delivery fee", logistics_cost: "Delivery fee",
  email: "Email", name: "Name", date: "Date", status: "Status", reason: "Reason", note: "Note"
};

/** "customer_phone" -> "Customer phone" (or the screen name above). */
export function fieldLabel(column: string): string {
  const key = column.trim().toLowerCase();
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const words = key.replace(/_id$/i, "").replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "A box on the form";
}

// Every message follows the same order, in short sentences:
// 1. what happened  2. whose fault (say "You did nothing wrong" when it is ours)
// 3. exactly what to do now.
const REPORT_IT = "Tap Report a Bug so we can fix it. We will see what went wrong.";

type Rule = { test: RegExp; message: (match: RegExpMatchArray) => string };

const RULES: Rule[] = [
  {
    test: /violates check constraint "([^"]+)"/i,
    message: () => `Not saved. You did nothing wrong: Protohub can't take one of the options you picked yet. For now, pick another option that fits and save again. ${REPORT_IT}`
  },
  {
    test: /null value in column "([^"]+)"[^]*violates not-null constraint/i,
    message: (m) => `Not saved. "${fieldLabel(m[1])}" is empty. Fill it in, then save again.`
  },
  {
    test: /duplicate key value violates unique constraint/i,
    message: () => "Not saved again, because it's already saved. You may have tapped Save twice, or someone else saved it first. Refresh the page to see it."
  },
  {
    test: /violates foreign key constraint/i,
    message: () => "Not saved. Something you picked (like a product, agent or customer) was deleted or changed by someone else. Refresh the page, pick it again, then save."
  },
  {
    test: /invalid input value for enum [\w.]+: "([^"]*)"/i,
    message: (m) => `Not saved. "${m[1]}" is not one of the options here. Pick one from the list, then save again.`
  },
  {
    test: /invalid input syntax for type (\w+)(?:: "([^"]*)")?/i,
    message: (m) => {
      const kind = m[1].toLowerCase();
      const typed = m[2] ? ` You typed "${m[2]}".` : "";
      if (/int|numeric|real|double|bigint|smallint/.test(kind)) return `Not saved. A number box has something that isn't a number.${typed} Type numbers only, with no commas, spaces or ₦ sign (write 5000, not 5,000). Then save again.`;
      if (/date|time/.test(kind)) return `Not saved. A date or time is not filled in properly.${typed} Pick it again from the calendar, then save.`;
      if (kind === "uuid") return "Not saved. Something you picked from a list didn't come through. Refresh the page, pick it again, then save.";
      if (kind === "boolean") return "Not saved. A Yes / No question is not answered. Tap Yes or No, then save again.";
      return `Not saved. Something you typed is not in the right form.${typed} Check what you typed, then save again.`;
    }
  },
  {
    test: /value too long for type/i,
    message: () => "Not saved. Some of the text you typed is too long. Make it shorter, then save again."
  },
  {
    test: /canceling statement due to statement timeout|statement timeout/i,
    message: () => "Not saved. Protohub took too long to answer. You did nothing wrong. Wait a minute and try again."
  },
  {
    test: /JWT expired|invalid JWT|jwt malformed/i,
    message: () => "You were signed out because it has been a while. Sign in again, then try once more."
  },
  {
    test: /permission denied for (table|relation|schema|function|sequence|view)|row-level security/i,
    message: () => "Your account isn't allowed to do this. If you need it for your work, ask the Owner to give you access."
  },
  {
    test: /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|upstream connect|network error|Failed to fetch/i,
    message: () => "Not saved. Protohub lost its connection for a moment. You did nothing wrong. Wait a minute and try again."
  },
  {
    test: /could not find the '[^']+' column|column "?[\w.]+"? (of relation "[^"]+" )?does not exist|relation "[^"]+" does not exist|function [\w.]+\(.*\) does not exist|schema cache|PGRST\d{3}/i,
    message: () => `Not saved. You did nothing wrong: part of Protohub is not set up yet on our side. ${REPORT_IT}`
  },
  {
    test: /^(TypeError|ReferenceError|SyntaxError|RangeError)\b|Cannot read propert(y|ies) of (undefined|null)|^[\w$.]+ is not (a function|defined|iterable)$|Unexpected token .* in JSON|^Internal server error\.?$/i,
    message: () => `Not saved. Something broke on our side. You did nothing wrong. Try once more. If it happens again, ${REPORT_IT.charAt(0).toLowerCase()}${REPORT_IT.slice(1)}`
  }
];

/**
 * Plain words for a technical error, or null when the text is already a
 * human message (those are passed through as the route wrote them).
 */
export function friendlyError(raw: unknown): { message: string; detail: string } | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  for (const rule of RULES) {
    const match = raw.match(rule.test);
    if (match) return { message: rule.message(match), detail: raw };
  }
  return null;
}
