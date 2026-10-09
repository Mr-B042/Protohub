// Session error recorder for Issue Management (Bright, 9 Oct 2026).
//
// Keeps the last few failed API requests and browser errors IN MEMORY for this
// tab, so a bug report can attach "POST /api/orders/5036 -> 500" without the
// reporter knowing what that means. Nothing is sent anywhere until they submit
// a report. Query strings that carry tokens or keys, bearer tokens and JWTs are
// removed here and again on the server.

export type FailedRequest = { at: string; method: string; path: string; status: number; message: string; requestId?: string; durationMs?: number };
export type BrowserError = { at: string; message: string; source?: string; stack?: string };

const MAX = 20;
const failed: FailedRequest[] = [];
const errors: BrowserError[] = [];
const scrub = (text: unknown, max = 400) => String(text ?? "")
  .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [removed]")
  .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{5,}/g, "[removed]")
  .replace(/([?&](?:[^=&]*(?:token|key|secret|password|code|signature|sig)[^=&]*)=)[^&#]*/gi, "$1[removed]")
  .slice(0, max);
const push = <T,>(list: T[], item: T) => { list.push(item); if (list.length > MAX) list.splice(0, list.length - MAX); };

export function recordFailedRequest(entry: Omit<FailedRequest, "at">) {
  // The bug report's own upload is not part of the problem being reported.
  if (entry.path.startsWith("/api/bug-reports")) return;
  push(failed, { ...entry, path: scrub(entry.path, 200), message: scrub(entry.message), at: new Date().toISOString() });
}

let installed = false;
export function installErrorRecorder() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    push(errors, { at: new Date().toISOString(), message: scrub(event.message), source: scrub(`${event.filename ?? ""}:${event.lineno ?? ""}`, 200), stack: scrub((event.error as Error | undefined)?.stack, 800) });
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: any = event.reason;
    push(errors, { at: new Date().toISOString(), message: scrub(reason?.message ?? reason), stack: scrub(reason?.stack, 800) });
  });
}

/** What a report attaches: the last 10 of each, newest first. */
export function recentErrorContext() {
  return { failedRequests: failed.slice(-10).reverse(), browserErrors: errors.slice(-10).reverse() };
}
