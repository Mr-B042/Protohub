import type { ZodError, ZodIssue } from "zod";

/**
 * Turns a ZodError into something a person can act on.
 *
 * Every route used to answer a bad request with
 *   res.status(400).json({ error: parsed.error.flatten().fieldErrors })
 * and the browser renders that as "field: message". When the schema supplied
 * wording that reads fine. When it did not - and most .max() rules never do -
 * the reader gets Zod's own English:
 *
 *   serviceAreas: Array must contain at most 20 element(s)
 *
 * which names no limit they recognise and nothing to do about it. A real
 * applicant was shown exactly that.
 *
 * The shape is unchanged - still { field: [messages] } - so nothing on the
 * client has to know this happened. Only the words change: the key becomes a
 * label a person would use, and any message that is still library output is
 * rewritten from the issue itself, which knows the limit and the type.
 *
 * A message the schema author wrote is always left alone. They know the domain;
 * this only covers the rules nobody gave words to.
 */

// Zod's own defaults all start one of these ways. Anything else came from a
// schema author and is left exactly as written.
const LIBRARY_DEFAULT = /^(String|Array|Number|Expected|Invalid enum value|Required$|Invalid input|Invalid date|Invalid literal|Unrecognized key)/i;

/** serviceAreas -> "Service areas"; guarantors.0.fullName -> "Guarantor 1 full name" */
export function humanFieldLabel(path: Array<string | number>): string {
  if (path.length === 0) return "This form";
  const words: string[] = [];
  path.forEach((segment, index) => {
    if (typeof segment === "number") {
      // Array index: fold it into the noun before it, one-based, so a reviewer
      // reads "Guarantor 2" rather than "guarantors.1".
      const previous = words.pop();
      const singular = previous ? previous.replace(/s$/i, "") : "Item";
      words.push(`${singular} ${segment + 1}`);
      return;
    }
    // Sentence case, not Title Case: "Service areas" is how a person writing to
    // another person refers to a field. Capitalisation is applied once at the
    // end rather than per word, or camelCase turns into "Service Areas".
    void index;
    const spaced = String(segment)
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .toLowerCase();
    words.push(spaced);
  });
  const label = words.join(" ").replace(/\s+/g, " ").trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function plainMessage(issue: ZodIssue): string {
  const any = issue as any;
  switch (issue.code) {
    case "too_big": {
      const limit = any.maximum;
      if (any.type === "array") return `cannot have more than ${limit} item${limit === 1 ? "" : "s"} - please remove some.`;
      if (any.type === "string") return `is too long - keep it to ${limit} character${limit === 1 ? "" : "s"} or fewer.`;
      if (any.type === "date") return `is too late a date.`;
      return `must be ${limit} or less.`;
    }
    case "too_small": {
      const limit = any.minimum;
      if (any.type === "array") return limit <= 1 ? "is required." : `needs at least ${limit} entries.`;
      if (any.type === "string") return limit <= 1 ? "is required." : `is too short - it needs at least ${limit} characters.`;
      if (any.type === "date") return `is too early a date.`;
      return `must be at least ${limit}.`;
    }
    case "invalid_type":
      return any.received === "undefined" || any.received === "null" ? "is required." : "is not in the expected format.";
    case "invalid_enum_value": {
      const options = Array.isArray(any.options) ? any.options.join(", ") : "";
      return options ? `must be one of: ${options}.` : "is not one of the allowed choices.";
    }
    case "invalid_string":
      if (any.validation === "email") return "must be a valid email address.";
      if (any.validation === "url") return "must be a valid link.";
      if (any.validation === "uuid") return "is not a valid reference.";
      return "is not in the expected format.";
    case "unrecognized_keys":
      return "contains something we do not recognise.";
    default:
      return "needs checking.";
  }
}

/**
 * Same shape the routes already return, with words a person can use.
 * Keys are human labels because the client renders `${key}: ${message}`.
 */
export function humanFieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const label = humanFieldLabel(issue.path as Array<string | number>);
    const message = LIBRARY_DEFAULT.test(issue.message) ? plainMessage(issue) : issue.message;
    const bucket = out[label] ?? (out[label] = []);
    if (!bucket.includes(message)) bucket.push(message);
  }
  // A schema whose issues all somehow vanished must still say something.
  if (Object.keys(out).length === 0) out["This form"] = ["Some details are missing or not valid."];
  return out;
}

/** For the few places that show one line rather than a field map. */
export function humanFirstMessage(error: ZodError, fallback = "Some details are missing or not valid."): string {
  const fields = humanFieldErrors(error);
  const [label, messages] = Object.entries(fields)[0] ?? [];
  if (!label || !messages?.length) return fallback;
  return label === "This form" ? messages[0] : `${label} ${messages[0]}`;
}
