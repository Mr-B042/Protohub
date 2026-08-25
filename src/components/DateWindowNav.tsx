import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ArrowLeftRight, Lightbulb } from "lucide-react";
import {
  DateWindow, PRESET_LABEL, PRESET_ORDER, PresetKey, WINDOW_SIZES,
  formatWindow, normaliseWindow, presetRange, resizeWindow, shiftDay, shiftWindow,
  windowLabel, windowSize, windowSizeLabel
} from "../lib/date-window";

type Props = {
  value: DateWindow;
  onChange: (next: DateWindow) => void;
  todayKey: string;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const monthLabel = (monthKey: string) =>
  new Date(`${monthKey}-01T12:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric" });
const addMonths = (monthKey: string, delta: number) => {
  const date = new Date(`${monthKey}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
};

/** Every cell a month grid shows, including the blanks that pad its first row. */
function monthCells(monthKey: string): Array<string | null> {
  const first = new Date(`${monthKey}-01T00:00:00Z`);
  const lead = first.getUTCDay();
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, "0")}`)
  ];
}

/**
 * A sliding date window: preset, range and size as three separate controls.
 *
 * ⚠️ The RANGE is the source of truth. The preset name is derived from it, not
 * stored, so a window nudged off "Last Week" renames itself instead of lying.
 */
export default function DateWindowNav({ value, onChange, todayKey }: Props) {
  const [openPresets, setOpenPresets] = useState(false);
  const [openCalendar, setOpenCalendar] = useState(false);
  const [draft, setDraft] = useState<DateWindow>(value);
  const [leftMonth, setLeftMonth] = useState(value.start.slice(0, 7));
  const [picking, setPicking] = useState<"start" | "end">("start");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const presetAnchorRef = useRef<HTMLDivElement | null>(null);
  const calendarAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number } | null>(null);

  /**
   * ⚠️ Both popovers are PORTALLED to the body and positioned from the
   * trigger's rect. The panel used to be absolutely positioned inside the
   * toolbar, which sits inside a section carrying `overflow-hidden` for its
   * rounded corners - so the calendar was clipped off at the card edge and
   * half the quick ranges were unreachable. No amount of z-index fixes that;
   * only leaving the clipping ancestor does.
   */
  const positionFrom = useCallback((element: HTMLElement | null, width: number) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const margin = 8;
    // Flip against the right edge rather than running off the viewport.
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
    setAnchorRect({ left, top: rect.bottom + margin });
  }, []);

  const size = windowSize(value);
  const label = windowLabel(value, todayKey);

  useEffect(() => {
    if (!openCalendar) return;
    setDraft(value);
    setLeftMonth(value.start.slice(0, 7));
    setPicking("start");
  }, [openCalendar]);

  // Click-away and Escape, so a popover never strands the page under it.
  // ⚠️ The panel lives in a portal, so a click inside it is NOT inside rootRef -
  // checking only the root would dismiss the calendar on its own date cells.
  useEffect(() => {
    if (!openPresets && !openCalendar) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpenPresets(false); setOpenCalendar(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpenPresets(false); setOpenCalendar(false); }
    };
    // A portalled panel does not travel with the page, so it is repositioned
    // while open rather than left floating over unrelated content.
    const reposition = () => {
      if (openCalendar) positionFrom(calendarAnchorRef.current, Math.min(window.innerWidth * 0.92, 704));
      else if (openPresets) positionFrom(presetAnchorRef.current, 208);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [openPresets, openCalendar, positionFrom]);

  // ⚠️ Keyboard nav is scoped to this toolbar, never the document. A global
  // arrow-key handler would hijack every text field and select on the page.
  const onToolbarKey = (event: React.KeyboardEvent) => {
    if (openCalendar) return;
    const back = event.key === "ArrowLeft";
    const forward = event.key === "ArrowRight";
    if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      onChange(shiftWindow(value, event.key === "PageUp" ? -30 : 30));
      return;
    }
    if (!back && !forward) return;
    event.preventDefault();
    const step = event.altKey ? 365 : event.shiftKey ? 7 : 1;
    onChange(shiftWindow(value, back ? -step : step));
  };

  const applyPreset = (preset: PresetKey) => {
    onChange(presetRange(preset, todayKey));
    setOpenPresets(false);
  };

  const pickDay = (day: string) => {
    // First click sets the start and collapses the range; the second sets the
    // end. Anything before the start restarts the selection rather than
    // producing a backwards range the user has to undo.
    if (picking === "start" || day < draft.start) {
      setDraft({ start: day, end: day });
      setPicking("end");
      return;
    }
    setDraft(normaliseWindow({ start: draft.start, end: day }));
    setPicking("start");
  };

  const months = useMemo(() => [leftMonth, addMonths(leftMonth, 1)], [leftMonth]);

  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onToolbarKey}
      className="relative flex flex-wrap items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20">
      <button type="button" aria-label="Move back one day" title="Back one day (←)"
        onClick={() => onChange(shiftWindow(value, -1))}
        className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50">
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="relative" ref={presetAnchorRef}>
        <button type="button"
          onClick={() => {
            const next = !openPresets;
            setOpenCalendar(false);
            if (next) positionFrom(presetAnchorRef.current, 208);
            setOpenPresets(next);
          }}
          className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white px-3 text-sm font-bold text-[#1F8FE0] shadow-sm transition-colors hover:bg-slate-50">
          {label}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
        {openPresets && anchorRect && createPortal((
          <div ref={panelRef} style={{ left: anchorRect.left, top: anchorRect.top }}
            className="fixed z-[80] w-52 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-2xl">
            <p className="m-0 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Quick ranges</p>
            {PRESET_ORDER.map((preset) => (
              <button key={preset} type="button" onClick={() => applyPreset(preset)}
                className={`!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold transition-colors ${
                  label === PRESET_LABEL[preset] ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50"}`}>
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />{PRESET_LABEL[preset]}
              </button>
            ))}
            <button type="button" onClick={() => { setOpenPresets(false); setOpenCalendar(true); }}
              className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />Custom Range
            </button>
          </div>
        ), document.body)}
      </div>

      <button type="button" aria-label="Move forward one day" title="Forward one day (→)"
        onClick={() => onChange(shiftWindow(value, 1))}
        className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition-colors hover:bg-slate-50">
        <ChevronRight className="h-4 w-4" />
      </button>

      <button type="button" ref={calendarAnchorRef}
        onClick={() => {
          const next = !openCalendar;
          setOpenPresets(false);
          if (next) positionFrom(calendarAnchorRef.current, Math.min(window.innerWidth * 0.92, 704));
          setOpenCalendar(next);
        }}
        className="!min-h-0 inline-flex h-9 items-center gap-2 rounded-xl border-b-2 border-slate-200/80 px-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50">
        {formatWindow(value)}
        <CalendarDays className="h-4 w-4 text-slate-400" />
      </button>

      <label className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500">
        Window:
        <select value={size} onChange={(event) => onChange(resizeWindow(value, Number(event.target.value)))}
          className="!min-h-0 h-9 rounded-xl border border-slate-200/80 bg-white px-2 text-sm font-bold text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20">
          {/* The current width always appears, even when it is not a preset -
              otherwise a custom 5-day window would show the wrong size. */}
          {(WINDOW_SIZES.some((option) => option.days === size)
            ? WINDOW_SIZES
            : [...WINDOW_SIZES, { days: size, label: windowSizeLabel(size) }].sort((a, b) => a.days - b.days)
          ).map((option) => (
            <option key={option.days} value={option.days}>{option.label}</option>
          ))}
        </select>
      </label>

      {openCalendar && anchorRect && createPortal((
        <div ref={panelRef} style={{ left: anchorRect.left, top: anchorRect.top }}
          className="fixed z-[80] max-h-[80vh] w-[min(92vw,44rem)] overflow-y-auto rounded-2xl border border-slate-200/80 bg-white shadow-2xl">
          <div className="flex flex-col sm:flex-row">
            <div className="shrink-0 border-b border-slate-200/80 p-2 sm:w-40 sm:border-b-0 sm:border-r">
              <p className="m-0 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Quick ranges</p>
              {PRESET_ORDER.map((preset) => (
                <button key={preset} type="button"
                  onClick={() => { const range = presetRange(preset, todayKey); setDraft(range); setLeftMonth(range.start.slice(0, 7)); setPicking("start"); }}
                  className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />{PRESET_LABEL[preset]}
                </button>
              ))}
            </div>

            <div className="min-w-0 flex-1 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="min-w-0 flex-1 text-[11px] font-bold text-slate-500">
                  Start date
                  <input type="date" value={draft.start}
                    onChange={(event) => setDraft(normaliseWindow({ ...draft, start: event.target.value }))}
                    className="!min-h-0 mt-1 h-9 w-full rounded-xl border border-slate-200/80 px-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20" />
                </label>
                <ArrowLeftRight className="mb-2 h-4 w-4 shrink-0 text-slate-300" />
                <label className="min-w-0 flex-1 text-[11px] font-bold text-slate-500">
                  End date
                  <input type="date" value={draft.end}
                    onChange={(event) => setDraft(normaliseWindow({ ...draft, end: event.target.value }))}
                    className="!min-h-0 mt-1 h-9 w-full rounded-xl border border-slate-200/80 px-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20" />
                </label>
                <label className="text-[11px] font-bold text-slate-500">
                  Window
                  <select value={windowSize(draft)} onChange={(event) => setDraft(resizeWindow(draft, Number(event.target.value)))}
                    className="!min-h-0 mt-1 h-9 w-full rounded-xl border border-slate-200/80 px-2 text-sm font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/20">
                    {(WINDOW_SIZES.some((option) => option.days === windowSize(draft))
                      ? WINDOW_SIZES
                      : [...WINDOW_SIZES, { days: windowSize(draft), label: windowSizeLabel(windowSize(draft)) }].sort((a, b) => a.days - b.days)
                    ).map((option) => <option key={option.days} value={option.days}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                {months.map((monthKey, index) => (
                  <div key={monthKey}>
                    <div className="flex items-center justify-between">
                      {index === 0 ? (
                        <button type="button" onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
                          className="!min-h-0 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 text-slate-500 hover:bg-slate-50">
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                      ) : <span className="h-7 w-7" />}
                      <span className="text-sm font-black text-slate-800">{monthLabel(monthKey)}</span>
                      {index === 1 ? (
                        <button type="button" onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                          className="!min-h-0 inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200/80 text-slate-500 hover:bg-slate-50">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      ) : <span className="h-7 w-7" />}
                    </div>
                    <div className="mt-2 grid grid-cols-7 gap-y-1">
                      {WEEKDAYS.map((day, i) => (
                        <span key={i} className="pb-1 text-center text-[10px] font-black text-slate-400">{day}</span>
                      ))}
                      {monthCells(monthKey).map((day, i) => {
                        if (!day) return <span key={`b${i}`} />;
                        const isStart = day === draft.start;
                        const isEnd = day === draft.end;
                        const inside = day > draft.start && day < draft.end;
                        return (
                          <button key={day} type="button" onClick={() => pickDay(day)}
                            className={`!min-h-0 mx-auto flex h-8 w-8 items-center justify-center text-xs font-bold transition-colors ${
                              isStart ? "rounded-full bg-[#1F8FE0] text-white"
                                : isEnd ? "rounded-full border-2 border-[#1F8FE0] text-[#1F8FE0]"
                                  : inside ? "rounded-none bg-sky-50 text-sky-700"
                                    : "rounded-full text-slate-600 hover:bg-slate-100"}`}>
                            {Number(day.slice(8, 10))}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-50/60 px-4 py-3">
            <span className="text-xs font-bold text-slate-500">
              {formatWindow(draft)} · {windowSizeLabel(windowSize(draft))}
            </span>
            <span className="flex gap-2">
              <button type="button" onClick={() => setOpenCalendar(false)}
                className="!min-h-0 rounded-xl border border-slate-200/80 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={() => { onChange(normaliseWindow(draft)); setOpenCalendar(false); }}
                className="!min-h-0 rounded-xl bg-[#1F8FE0] px-4 py-2 text-sm font-bold text-white hover:bg-[#1560a8]">Apply</button>
            </span>
          </div>
        </div>
      ), document.body)}

      <p className="m-0 hidden w-full items-center gap-2 text-[11px] font-semibold text-slate-400 xl:flex">
        <Lightbulb className="h-3.5 w-3.5 shrink-0" />
        Click the toolbar, then ← → to move by day, Shift for a week, PgUp / PgDn for a month, Alt for a year.
      </p>
    </div>
  );
}
