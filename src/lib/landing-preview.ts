// ── Landing page preview (Bright, 17 Oct 2026) ──────────────────────────────
// Products & Stock lets staff open a product's REAL landing page inside
// Protohub to study it. That page carries the LIVE order form, so the form has
// to know it is being studied, not used.
//
// How it knows: the preview window sets a flag on the Protohub window. The
// form loads from the same address as Protohub (protohub-zeta.vercel.app), so
// from inside the landing page it can read that flag on window.top even though
// the WordPress page sits in between. Customers never have Protohub around the
// page, so for them the flag is never there and the form stays live.
//
// ⚠️ Same address is the whole trick. If the form ever loads from a different
// address than the one staff sign in at, the flag cannot be read, the form
// stays LIVE - and the preview window says so instead of claiming it is safe
// (it waits for the form's "locked" message below).

const FLAG = "__protohubLandingPreview";
export const LANDING_PREVIEW_LOCKED_MESSAGE = "protohub-landing-preview-locked";

export function setLandingPreviewFlag(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) (window as any)[FLAG] = true;
  else delete (window as any)[FLAG];
}

/** True only for a form running inside a Protohub landing page preview. */
export function insideLandingPreview(): boolean {
  try {
    return typeof window !== "undefined" && window.top !== window && (window.top as any)?.[FLAG] === true;
  } catch {
    // A different address: the browser refuses the read. Not a preview.
    return false;
  }
}

/** The form tells the preview window it really is locked to view-only. */
export function announceLandingPreviewLocked(productId: string) {
  try {
    window.top?.postMessage({ type: LANDING_PREVIEW_LOCKED_MESSAGE, productId }, window.location.origin);
  } catch {
    // Nothing to tell: without the flag there is no preview window.
  }
}
