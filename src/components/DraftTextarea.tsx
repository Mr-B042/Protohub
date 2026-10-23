import { flushSync } from "react-dom";
import { memo, startTransition, useCallback, useEffect, useRef, useState, type AllHTMLAttributes, type FocusEvent, type KeyboardEvent, type MutableRefObject } from "react";

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

/** Every ordinary input/textarea attribute (type, min, max, step, disabled, onFocus, …) passes straight through. */
type PassThrough = Omit<AllHTMLAttributes<HTMLElement>, "value" | "onChange" | "onBlur" | "defaultValue" | "as">;

type DraftTextareaProps = PassThrough & {
  /** Runs after the text has been handed up. Read the text from event.target.value, not from parent state. */
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  /** Numbers are fine too (type="number" boxes): shown as typed, committed as text. */
  value: string | number | null | undefined;
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
  /** Single-line fields have the same problem; they just need an <input>. */
  as?: "textarea" | "input";
  /** false = never commit while typing; only on blur, Enter, a tap elsewhere, or closing.
   *  For heavy screens where even one commit per pause froze slow computers. */
  commitOnChange?: boolean;
  /**
   * Render the "n / max" counter here rather than in the parent.
   *
   * ⚠️ A counter driven by parent state trails the box by the debounce, so it
   * visibly lags behind the letters being typed - which looks like the bug this
   * component exists to fix. Reading the local draft keeps it instant.
   */
  showCount?: boolean;
  /** So a <label htmlFor> can still point at the field. */
  id?: string;
  "aria-label"?: string;
};

const asText = (value: unknown) => String(value ?? "");

/** Long enough to skip most keystrokes, short enough to feel instant. */
const COMMIT_DELAY_MS = 250;

function DraftTextareaInner({
  value, onCommit, liveRef, placeholder, rows, maxLength, className, disabled, autoFocus,
  as = "textarea", showCount, commitOnChange = true, onKeyDown, onFocus, onBlur, ...rest
}: DraftTextareaProps) {
  const [draft, setDraft] = useState(value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The newest text in the box. A ref, so flushes always send the latest.
  const latest = useRef<string>(asText(value));
  // The last text we sent up, and the last value the parent showed us. While a
  // background commit is still drawing, sent is ahead of seen.
  const sent = useRef<string>(asText(value));
  const seen = useRef<string>(asText(value));
  // Every text sent up that the parent has not shown back yet. An older one can
  // land after a newer one is typed; it is an echo, never a reason to resync.
  const inFlight = useRef<string[]>([]);
  const send = (text: string, background: boolean) => {
    sent.current = text;
    inFlight.current.push(text);
    if (inFlight.current.length > 20) inFlight.current.shift();
    if (background) startTransition(() => commitRef.current(text));
    else commitRef.current(text);
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  // The parent's value changed. Take it into the box ONLY when it is not just
  // the parent catching up with something we sent: a background commit can land
  // after the user typed more, and must never overwrite those letters.
  useEffect(() => {
    const next = asText(value);
    if (next === seen.current) return;
    seen.current = next;
    const echo = inFlight.current.indexOf(next);
    if (echo >= 0) { inFlight.current.splice(0, echo + 1); return; }
    if (next === latest.current) return;
    inFlight.current = [];
    latest.current = next;
    sent.current = next;
    if (liveRef) liveRef.current = next;
    setDraft(value ?? "");
  }, [value, liveRef]);

  // Seed the live ref so a save that never sees a keystroke still reads right.
  useEffect(() => {
    if (liveRef) liveRef.current = latest.current;
  }, [liveRef]);

  /** True while the parent has not yet drawn the newest text. */
  const behind = () => timer.current !== null || latest.current !== seen.current;

  // Urgent hand-over (blur, Enter, tap outside, closing): the parent gets the
  // newest text at once, even if a background commit of older text is drawing.
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (latest.current !== seen.current || latest.current !== sent.current) {
      sendRef.current(latest.current, false);
    }
  }, []);

  // ⚠️ Tap-outside hand-over. Safari (iPhone, Mac) does not move focus to a
  // tapped button, so the box never blurs and a quick "type, tap Save" would
  // read the parent value from before the last letters. While the box has
  // focus, any press elsewhere commits first - synchronously, so the click
  // that follows already sees the full text.
  const outsidePress = useRef<((event: Event) => void) | null>(null);
  const stopWatching = useCallback(() => {
    if (outsidePress.current) document.removeEventListener("pointerdown", outsidePress.current, true);
    outsidePress.current = null;
  }, []);
  const startWatching = useCallback((self: EventTarget | null) => {
    stopWatching();
    const handler = (event: Event) => {
      if (event.target === self) return;
      if (behind()) flushSync(() => flush());
    };
    outsidePress.current = handler;
    document.addEventListener("pointerdown", handler, true);
  }, [flush, stopWatching]);
  useEffect(() => stopWatching, [stopWatching]);

  // A modal that closes while a commit is pending must not lose the text.
  useEffect(() => () => {
    if (behind()) {
      if (timer.current) clearTimeout(timer.current);
      sendRef.current(latest.current, false);
    }
  }, []);

  const handleChange = (next: string) => {
    latest.current = next;
    // Undebounced, no render: validation can read this the instant it is typed.
    if (liveRef) liveRef.current = next;
    setDraft(next);
    if (commitOnChange) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        // ⚠️ IN THE BACKGROUND (23 Oct 2026). This commit re-renders the whole
        // App, which takes seconds on a slow computer. As a transition React
        // pauses that render for every new key, so typing never waits on it.
        // Urgent hand-overs (blur, Enter, tap outside) stay synchronous.
        sendRef.current(latest.current, true);
      }, COMMIT_DELAY_MS);
    }
  };

  const shared = {
    ...rest,
    value: draft,
    maxLength,
    placeholder,
    className,
    disabled,
    autoFocus,
    onChange: (event: { target: { value: string } }) => handleChange(event.target.value),
    // Enter can submit a form or run a search without the box losing focus:
    // hand the text up first so that action sees every letter.
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" && as === "input") flush();
      onKeyDown?.(event);
    },
    // Blur fires before a button's click, so pressing Save always sees the
    // final text even if the debounce has not run yet.
    onBlur: (event: FocusEvent<HTMLElement>) => { stopWatching(); flush(); onBlur?.(event); },
    onFocus: (event: FocusEvent<HTMLElement>) => { startWatching(event.currentTarget); onFocus?.(event as never); }
  };

  const field = as === "input"
    ? <input {...shared} />
    : <textarea {...shared} rows={rows} />;

  if (!showCount || !maxLength) return field;
  return (
    <span className="relative block">
      {field}
      <span className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] text-gray-400">
        {String(draft).length} / {maxLength}
      </span>
    </span>
  );
}

export const DraftTextarea = memo(DraftTextareaInner);
export default DraftTextarea;
