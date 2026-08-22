import { memo, useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";

// A textarea that does not re-render the app on every keystroke.
//
// ⚠️ Why this exists. App.tsx is one component holding ~1,400 useState hooks
// across ~105,000 lines. A plain `onChange={(e) => setSomething(e.target.value)}`
// re-renders that entire component - every hook, the whole active page, the
// open modal - between pressing a key and seeing the letter. Reps typing a
// failed-delivery reason were waiting so long they started writing one-word
// reasons, which cost real information about why deliveries fail.
//
// The value lives HERE while typing, so a keystroke re-renders this one small
// component. The parent is told on a short debounce and again on blur, so a
// save that reads parent state can never miss the last few characters.

type DraftTextareaProps = {
  value: string;
  onCommit: (value: string) => void;
  /**
   * Kept in step with EVERY keystroke, undebounced.
   *
   * ⚠️ For fields whose save validates "is this filled in?". Committing on a
   * debounce means parent state can trail the box by a few hundred
   * milliseconds, and blur-before-click is not a guarantee worth betting a
   * rep's typing on - they would hit Save and be told the reason is required
   * while looking straight at it. Validate against this instead.
   */
  liveRef?: MutableRefObject<string>;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  className?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
};

/** Long enough to skip most keystrokes, short enough to feel instant. */
const COMMIT_DELAY_MS = 250;

function DraftTextareaInner({
  value, onCommit, liveRef, placeholder, rows, maxLength, className, disabled, autoFocus, ...rest
}: DraftTextareaProps) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so the flush on unmount sends the LATEST text rather than
  // whatever the closure captured when the effect was created.
  const latest = useRef(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // ⚠️ Only resync when the parent's value genuinely differs from what we last
  // sent up. Without this guard our own debounced commit bounces straight back
  // and overwrites characters typed during the round trip.
  useEffect(() => {
    if (value !== latest.current) {
      latest.current = value;
      if (liveRef) liveRef.current = value;
      setDraft(value);
    }
  }, [value, liveRef]);

  // Seed the live ref so a save that never sees a keystroke still reads right.
  useEffect(() => {
    if (liveRef) liveRef.current = latest.current;
  }, [liveRef]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (latest.current !== undefined) commitRef.current(latest.current);
  }, []);

  // A modal that closes while a debounce is pending must not lose the text.
  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
      commitRef.current(latest.current);
    }
  }, []);

  const handleChange = (next: string) => {
    latest.current = next;
    // Undebounced, no render: validation can read this the instant it is typed.
    if (liveRef) liveRef.current = next;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      commitRef.current(latest.current);
    }, COMMIT_DELAY_MS);
  };

  return (
    <textarea
      {...rest}
      value={draft}
      rows={rows}
      maxLength={maxLength}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(event) => handleChange(event.target.value)}
      // Blur fires before a button's click, so pressing Save always sees the
      // final text even if the debounce has not run yet.
      onBlur={flush}
    />
  );
}

export const DraftTextarea = memo(DraftTextareaInner);
export default DraftTextarea;
