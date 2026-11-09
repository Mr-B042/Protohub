import { useEffect, useMemo, useRef, useState } from "react";
import { renderEmailHtml, type EmailBlockType, type EmailDesign } from "../../lib/email-render";
import { emailBrandNow } from "../../lib/email-brand-store";

/**
 * Shows an email exactly as it is sent: the HTML from email-render.ts in a
 * sandboxed frame (no scripts run inside, so a pasted HTML block can't do
 * anything). In the editor, a click picks a block and blocks can be dropped
 * in from the left-hand list.
 */
export const DRAG_TYPE = "application/x-em-block";

export default function EmailFrame({
  design, mobile = false, editor = false, selectedId, onSelect, onDrop, preheader, brand, footerNote, scale: fixedScale = 1, fit = false, minHeight = 360, className = "", showTags = false
}: {
  design: EmailDesign;
  mobile?: boolean;
  editor?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onDrop?: (type: EmailBlockType | `saved:${string}`, targetId: string | null, place: "before" | "after") => void;
  preheader?: string;
  brand?: string;
  footerNote?: string;
  /** Thumbnails draw the full email smaller. */
  scale?: number;
  /** Shrink to the box's width (side previews). */
  fit?: boolean;
  minHeight?: number;
  className?: string;
  showTags?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [height, setHeight] = useState(minHeight);
  useEffect(() => {
    if (!fit || !box.current) return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [fit]);
  const handlers = useRef({ onSelect, onDrop });
  handlers.current = { onSelect, onDrop };
  const logo = emailBrandNow();
  const html = useMemo(() => renderEmailHtml(design, {
    editor, selectedId: selectedId ?? undefined, mobile, preheader, brand: brand || logo.name || undefined, footerNote, showTags: showTags || editor, firstName: showTags || editor ? undefined : "Customer",
    linkFor: (url) => url, logoUrl: logo.logoUrl ?? undefined
  }), [design, editor, selectedId, mobile, preheader, brand, footerNote, showTags, logo.logoUrl, logo.name]);
  const [shown, setShown] = useState(html);
  // Typing re-draws at most every 150 ms so the frame doesn't flash per key.
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(html), 150);
    return () => window.clearTimeout(timer);
  }, [html]);

  const wire = () => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    const measure = () => setHeight(Math.max(minHeight, doc.documentElement.scrollHeight));
    measure();
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", measure, { once: true }));
    // Links never navigate inside the preview.
    doc.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a")) event.preventDefault();
      const block = target?.closest("[data-block-id]") as HTMLElement | null;
      if (block && handlers.current.onSelect) handlers.current.onSelect(block.dataset.blockId!);
    });
    if (!editor) return;
    const style = doc.createElement("style");
    style.textContent = `[data-drop="before"]{box-shadow:inset 0 4px 0 #5B3FD9}[data-drop="after"]{box-shadow:inset 0 -4px 0 #5B3FD9}body.em-drop-end table.c{box-shadow:0 4px 0 #5B3FD9}`;
    doc.head.appendChild(style);
    const clear = () => { doc.querySelectorAll("[data-drop]").forEach((el) => el.removeAttribute("data-drop")); doc.body.classList.remove("em-drop-end"); };
    const spot = (event: DragEvent): { id: string | null; place: "before" | "after"; el: HTMLElement | null } => {
      const blocks = [...doc.querySelectorAll<HTMLElement>("[data-block-id]")];
      for (const el of blocks) {
        const rect = el.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) return { id: el.dataset.blockId!, place: "before", el };
      }
      const last = blocks[blocks.length - 1] ?? null;
      return { id: last?.dataset.blockId ?? null, place: "after", el: last };
    };
    doc.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      clear();
      const at = spot(event);
      if (at.el) at.el.setAttribute("data-drop", at.place); else doc.body.classList.add("em-drop-end");
    });
    doc.addEventListener("dragleave", (event) => { if (!(event.relatedTarget as Node | null)) clear(); });
    doc.addEventListener("drop", (event) => {
      const type = event.dataTransfer?.getData(DRAG_TYPE);
      clear();
      if (!type) return;
      event.preventDefault();
      const at = spot(event);
      handlers.current.onDrop?.(type as EmailBlockType, at.id, at.place);
    });
  };

  const width = mobile ? 375 + 16 : 600 + 24;
  const scale = fit ? (boxWidth ? Math.min(1, boxWidth / width) : 0.6) : fixedScale;
  return (
    <div ref={box} className={className} style={scale !== 1 ? { width: fit ? "100%" : width * scale, height: height * scale, overflow: "hidden" } : undefined}>
      <iframe
        ref={frame}
        title="Email preview"
        sandbox="allow-same-origin"
        srcDoc={shown}
        onLoad={wire}
        scrolling="no"
        className="block border-0 bg-transparent"
        style={{ width: scale !== 1 ? width : "100%", maxWidth: scale !== 1 ? undefined : width, height, margin: scale !== 1 ? (fit ? `0 ${Math.max(0, (boxWidth - width * scale) / 2)}px` : undefined) : "0 auto", transform: scale !== 1 ? `scale(${scale})` : undefined, transformOrigin: "top left", pointerEvents: scale !== 1 && !fit ? "none" : undefined }}
      />
    </div>
  );
}
