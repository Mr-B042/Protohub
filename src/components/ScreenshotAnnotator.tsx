import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Circle, Crop, Droplets, RotateCcw, Square, Type, Undo2, X } from "lucide-react";

/**
 * Mark up a screenshot before sending it (Issue Management, Bright, 9 Oct
 * 2026): arrow, rectangle, circle, text, blur (for phone numbers and other
 * private details) and crop. Everything is drawn on a copy; "Use this" hands
 * back a new PNG and the original is never changed.
 */

type Tool = "arrow" | "rect" | "circle" | "text" | "blur" | "crop";
type Box = { x1: number; y1: number; x2: number; y2: number };
type Mark = ({ tool: "arrow" | "rect" | "circle" | "blur" } & Box) | { tool: "text"; x: number; y: number; text: string };

const RED = "#E11D48";
const TOOLS: Array<{ key: Tool; label: string; icon: typeof Square }> = [
  { key: "arrow", label: "Arrow", icon: ArrowUpRight },
  { key: "rect", label: "Rectangle", icon: Square },
  { key: "circle", label: "Circle", icon: Circle },
  { key: "text", label: "Text", icon: Type },
  { key: "blur", label: "Blur", icon: Droplets },
  { key: "crop", label: "Crop", icon: Crop }
];
const norm = (box: Box) => ({ x: Math.min(box.x1, box.x2), y: Math.min(box.y1, box.y2), w: Math.abs(box.x2 - box.x1), h: Math.abs(box.y2 - box.y1) });

export default function ScreenshotAnnotator({ file, onDone, onClose }: { file: File; onDone: (file: File) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>("arrow");
  const [marks, setMarks] = useState<Mark[]>([]);
  const [crop, setCrop] = useState<Box | null>(null);
  const [draft, setDraft] = useState<Box | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { imageRef.current = image; setReady(true); };
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const stroke = (image: HTMLImageElement) => Math.max(3, Math.round(Math.max(image.naturalWidth, image.naturalHeight) / 300));

  /** Draw the image and every mark onto a canvas (the editor, or the final export). */
  const paint = (canvas: HTMLCanvasElement, opts: { preview: boolean }) => {
    const image = imageRef.current;
    if (!image) return;
    const area = opts.preview || !crop ? { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight } : norm(crop);
    canvas.width = Math.max(1, Math.round(area.w));
    canvas.height = Math.max(1, Math.round(area.h));
    const ctx = canvas.getContext("2d")!;
    ctx.save();
    ctx.translate(-area.x, -area.y);
    ctx.drawImage(image, 0, 0);
    const all: Mark[] = draft && tool !== "crop" && tool !== "text" ? [...marks, { tool, ...draft } as Mark] : marks;
    const width = stroke(image);
    for (const mark of all) {
      if (mark.tool === "blur") {
        const box = norm(mark);
        if (box.w < 2 || box.h < 2) continue;
        // Pixelate: draw the region tiny, then back up without smoothing.
        const small = document.createElement("canvas");
        const scale = 0.06;
        small.width = Math.max(1, Math.round(box.w * scale));
        small.height = Math.max(1, Math.round(box.h * scale));
        small.getContext("2d")!.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, small.width, small.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(small, 0, 0, small.width, small.height, box.x, box.y, box.w, box.h);
        ctx.imageSmoothingEnabled = true;
        continue;
      }
      ctx.strokeStyle = RED;
      ctx.fillStyle = RED;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (mark.tool === "rect") {
        const box = norm(mark);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
      } else if (mark.tool === "circle") {
        const box = norm(mark);
        ctx.beginPath();
        ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, Math.max(1, box.w / 2), Math.max(1, box.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
      } else if (mark.tool === "arrow") {
        const angle = Math.atan2(mark.y2 - mark.y1, mark.x2 - mark.x1);
        const head = width * 5;
        ctx.beginPath();
        ctx.moveTo(mark.x1, mark.y1);
        ctx.lineTo(mark.x2, mark.y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mark.x2, mark.y2);
        ctx.lineTo(mark.x2 - head * Math.cos(angle - Math.PI / 7), mark.y2 - head * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(mark.x2 - head * Math.cos(angle + Math.PI / 7), mark.y2 - head * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      } else if (mark.tool === "text") {
        const size = width * 7;
        ctx.font = `bold ${size}px Inter, Arial, sans-serif`;
        const metrics = ctx.measureText(mark.text);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fillRect(mark.x - size * 0.3, mark.y - size, metrics.width + size * 0.6, size * 1.35);
        ctx.fillStyle = RED;
        ctx.fillText(mark.text, mark.x, mark.y);
      }
    }
    ctx.restore();
    // The crop box (editor only): dim everything outside it.
    const cropBox = tool === "crop" && draft ? norm(draft) : crop ? norm(crop) : null;
    if (opts.preview && cropBox && cropBox.w > 2) {
      ctx.fillStyle = "rgba(15,23,42,0.55)";
      ctx.fillRect(0, 0, canvas.width, cropBox.y);
      ctx.fillRect(0, cropBox.y + cropBox.h, canvas.width, canvas.height - cropBox.y - cropBox.h);
      ctx.fillRect(0, cropBox.y, cropBox.x, cropBox.h);
      ctx.fillRect(cropBox.x + cropBox.w, cropBox.y, canvas.width - cropBox.x - cropBox.w, cropBox.h);
      ctx.setLineDash([width * 3, width * 2]);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = width / 1.5;
      ctx.strokeRect(cropBox.x, cropBox.y, cropBox.w, cropBox.h);
      ctx.setLineDash([]);
    }
  };

  useEffect(() => { if (ready && canvasRef.current) paint(canvasRef.current, { preview: true }); });

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * canvas.width, y: ((event.clientY - rect.top) / rect.height) * canvas.height };
  };
  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const at = point(event);
    if (tool === "text") {
      const text = window.prompt("Text to add to the screenshot", "This button doesn't work");
      if (text && text.trim()) setMarks((current) => [...current, { tool: "text", x: at.x, y: at.y, text: text.trim().slice(0, 80) }]);
      return;
    }
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
    setDraft({ x1: at.x, y1: at.y, x2: at.x, y2: at.y });
  };
  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draft) return;
    const at = point(event);
    setDraft({ ...draft, x2: at.x, y2: at.y });
  };
  const up = () => {
    if (!draft) return;
    const box = norm(draft);
    if (box.w > 4 || box.h > 4) {
      if (tool === "crop") setCrop(draft);
      else setMarks((current) => [...current, { tool, ...draft } as Mark]);
    }
    setDraft(null);
  };

  const save = () => {
    const out = document.createElement("canvas");
    paint(out, { preview: false });
    out.toBlob((blob) => {
      if (!blob) return;
      const name = file.name.replace(/\.[a-z0-9]+$/i, "") + "-marked.png";
      onDone(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-3" role="dialog" aria-modal="true" aria-label="Mark up screenshot">
      <div className="flex max-h-[94vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3 dark:border-slate-800">
          <div>
            <h2 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-100">Mark up screenshot</h2>
            <p className="m-0 text-[12px] text-gray-500">Point at what is wrong. Blur phone numbers and other private details.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-2.5 dark:border-slate-800">
          {TOOLS.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.key} type="button" onClick={() => setTool(item.key)}
                className={`!min-h-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold ${tool === item.key ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0]" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-200"}`}>
                <Icon className="h-4 w-4" /> {item.label}
              </button>
            );
          })}
          <span className="mx-1 h-6 w-px bg-gray-200" />
          <button type="button" disabled={marks.length === 0} onClick={() => setMarks((current) => current.slice(0, -1))}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"><Undo2 className="h-4 w-4" /> Undo</button>
          <button type="button" disabled={marks.length === 0 && !crop} onClick={() => { setMarks([]); setCrop(null); }}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-[12.5px] font-semibold text-gray-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"><RotateCcw className="h-4 w-4" /> Start again</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-gray-100 p-4 dark:bg-slate-950">
          {ready
            ? <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} className={`mx-auto block max-w-full touch-none shadow ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`} />
            : <p className="m-0 py-16 text-center text-[13px] text-gray-500">Opening the screenshot…</p>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-5 py-3 dark:border-slate-800">
          <p className="m-0 text-[12px] text-gray-500">{tool === "crop" ? "Drag to choose the part to keep." : tool === "text" ? "Click where the text should go." : "Drag on the screenshot to draw."}{crop ? " · Cropped" : ""}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="!min-h-0 rounded-lg border border-gray-200 px-4 py-2 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">Cancel</button>
            <button type="button" onClick={save} disabled={!ready} className="!min-h-0 rounded-lg bg-[#1F8FE0] px-5 py-2 text-[13px] font-semibold text-white disabled:opacity-50">Use this</button>
          </div>
        </div>
      </div>
    </div>
  );
}
