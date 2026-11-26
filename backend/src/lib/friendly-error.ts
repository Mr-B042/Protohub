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

/** "customer_phone" -> "Customer phone". */
export function fieldLabel(column: string): string {
  const words = column.replace(/_id$/i, "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "A required field";
}

const OUR_SIDE = "This is a problem on our side, not something you did. Tap Report a Bug (the details are attached automatically) so we can fix it.";

type Rule = { test: RegExp; message: (match: RegExpMatchArray) => string };

const RULES: Rule[] = [
  {
    test: /violates check constraint "([^"]+)"/i,
    message: () => `Not saved: one of your choices is not accepted yet. ${OUR_SIDE} If another option also fits, you can use that for now.`
  },
  {
    test: /null value in column "([^"]+)"[^]*violates not-null constraint/i,
    message: (m) => `Not saved: "${fieldLabel(m[1])}" is missing. Fill it in and save again.`
  },
  {
    test: /duplicate key value violates unique constraint/i,
    message: () => "Not saved again: this already exists. Refresh the page to see it."
  },
  {
    test: /violates foreign key constraint/i,
    message: () => "Not saved: something this is linked to no longer exists (someone may have deleted or changed it). Refresh the page and try again."
  },
  {
    test: /invalid input value for enum [\w.]+: "([^"]*)"/i,
    message: (m) => `Not saved: "${m[1]}" is not an accepted choice here. Pick one from the list.`
  },
  {
    test: /invalid input syntax for type (\w+)(?:: "([^"]*)")?/i,
    message: (m) => {
      const kind = m[1].toLowerCase();
      const what = /int|numeric|real|double|bigint|smallint/.test(kind) ? "a number"
        : /date|time/.test(kind) ? "a date or time"
        : kind === "uuid" ? "a link to another record"
        : kind === "boolean" ? "a yes/no answer" : "a value";
      return `Not saved: ${what}${m[2] ? ` ("${m[2]}")` : ""} is in the wrong format. Check what you typed and save again.`;
    }
  },
  {
    test: /value too long for type/i,
    message: () => "Not saved: some of the text is too long. Shorten it and save again."
  },
  {
    test: /canceling statement due to statement timeout|statement timeout/i,
    message: () => "This took too long and was stopped, so nothing was saved. Try again in a minute."
  },
  {
    test: /JWT expired|invalid JWT|jwt malformed/i,
    message: () => "Your session expired. Sign out and sign in again, then retry."
  },
  {
    test: /permission denied for (table|relation|schema|function|sequence|view)|row-level security/i,
    message: () => "You don't have permission to do this. Ask the Owner if you need it."
  },
  {
    test: /fetch failed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|socket hang up|upstream connect|network error|Failed to fetch/i,
    message: () => "Protohub couldn't reach its database just now, so nothing was saved. Try again in a minute."
  },
  {
    test: /could not find the '[^']+' column|column "?[\w.]+"? (of relation "[^"]+" )?does not exist|relation "[^"]+" does not exist|function [\w.]+\(.*\) does not exist|schema cache|PGRST\d{3}/i,
    message: () => `Not saved: part of Protohub's database is missing or out of date. ${OUR_SIDE}`
  },
  {
    test: /^(TypeError|ReferenceError|SyntaxError|RangeError)\b|Cannot read propert(y|ies) of (undefined|null)|^[\w$.]+ is not (a function|defined|iterable)$|Unexpected token .* in JSON|^Internal server error\.?$/i,
    message: () => `Something went wrong on our side, so this did not go through. ${OUR_SIDE}`
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
