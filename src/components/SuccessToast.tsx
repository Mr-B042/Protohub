import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Info, X } from "lucide-react";

// The "it worked" message (Bright, 26 Nov 2026: "a beautiful success design,
// something modern"). A notice ("Nothing to export") uses the same card in blue.
//
// - The first sentence is the headline; the rest ("Record the cash when the
//   agent pays.") sits under it as the next step.
// - It stays long enough to read (`ms`, set by App from the length), shows the
//   time left as a thin bar, and pauses while a finger or mouse is on it.
// - Rendered into <body>, above any open form.
// Errors and "do this first" messages use the red card in App.tsx instead.

export function splitToastText(message: string) {
  const text = message.trim();
  const match = text.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  // Only split when the headline is a real sentence, not "Order #6402." style fragments.
  if (match && match[1].length >= 12) return { headline: match[1], detail: match[2] };
  return { headline: text, detail: "" };
}

export function SuccessToast({ message, ms, notice, onClose }: { message: string; ms: number; notice?: boolean; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(ms);
  const startedAt = useRef(Date.now());
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A new message restarts the clock.
  useEffect(() => { left.current = ms; startedAt.current = Date.now(); setPaused(false); }, [message, ms]);

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const id = window.setTimeout(() => closeRef.current(), left.current);
    return () => { window.clearTimeout(id); left.current = Math.max(0, left.current - (Date.now() - startedAt.current)); };
  }, [paused, message, ms]);

  const { headline, detail } = splitToastText(message);
  const tone = notice ? "notice" : "ok";

  return createPortal(
    <div className="success-toast-wrap" role="status" aria-live="polite">
      <div
        key={message}
        className={`success-toast success-toast-${tone}${detail ? "" : " success-toast-single"}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={() => setPaused(true)}
        onTouchEnd={() => setPaused(false)}
      >
        <div className="success-toast-icon" aria-hidden="true">
          {notice ? <Info strokeWidth={2.5} /> : <Check strokeWidth={3} className="success-toast-check" />}
        </div>
        <div className="success-toast-text">
          <p className="success-toast-headline">{headline}</p>
          {detail ? <p className="success-toast-detail">{detail}</p> : null}
        </div>
        <button type="button" className="success-toast-close" aria-label="Close message" onClick={onClose}>
          <X />
        </button>
        <span
          className="success-toast-timer"
          style={{ animationDuration: `${ms}ms`, animationPlayState: paused ? "paused" : "running" }}
          aria-hidden="true"
        />
      </div>
    </div>,
    document.body
  );
}
