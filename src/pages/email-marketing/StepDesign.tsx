import { useEffect, useRef, useState } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowUp, ChevronRight, Clock, Code2, Copy, Eye, Gift, Image as ImageIcon, LayoutGrid, Link2, Minus, Monitor,
  MousePointerClick, Package, Paintbrush, PanelTop, Redo2, Save, Send, Settings2, Share2, Smartphone, Square, Star, Trash2, Type, Undo2, Upload, Video, MoveVertical, X, ShoppingBag
} from "lucide-react";
import { emailMarketingApi, type EmDesigner } from "../../lib/api";
import { COVER_TONES, FEATURE_ICONS, STORE_PICKS_MODES, FONT_CHOICES, TEMPLATE_CHOICES, buildTemplateDesign, blockId, newBlock, normalizeDesign, type Align, type EmailBlock, type EmailBlockType, type EmailDesign } from "../../lib/email-render";
import EmailFrame, { DRAG_TYPE } from "./EmailFrame";
import { ModalShell } from "./AudiencePage";
import { Card, btn, input, select } from "./em-ui";
import { fieldsFor, priceText, type Draft } from "./wizard-model";

/** Step 3, Design Email (image 46): blocks on the left, the email in the middle, the picked block's settings on the right. */

const PALETTE: Array<{ type: EmailBlockType; label: string; icon: typeof Type }> = [
  { type: "cover", label: "Cover", icon: PanelTop }, { type: "text", label: "Text", icon: Type }, { type: "image", label: "Image", icon: ImageIcon }, { type: "button", label: "Button", icon: MousePointerClick },
  { type: "product", label: "Product", icon: Package }, { type: "offer", label: "Offer / Badge", icon: Gift }, { type: "divider", label: "Divider", icon: Minus },
  { type: "spacer", label: "Spacer", icon: MoveVertical }, { type: "social", label: "Social Links", icon: Share2 }, { type: "timer", label: "Timer", icon: Clock },
  { type: "video", label: "Video", icon: Video }, { type: "review", label: "Customer Review", icon: Star }, { type: "html", label: "HTML", icon: Code2 },
  { type: "storePicks", label: "Store Picks", icon: ShoppingBag }
];
const BLOCK_NAME: Record<EmailBlockType, string> = {
  storePicks: "Store Picks", header: "Header", hero: "Banner", text: "Text", image: "Image", button: "Button", product: "Product", offer: "Offer / Badge", divider: "Divider", spacer: "Spacer",
  social: "Social Links", timer: "Timer", video: "Video", review: "Customer Review", html: "HTML", features: "Feature Boxes", footer: "Footer Line", cover: "Cover"
};

const label = "block text-[13px] font-bold text-gray-900 dark:text-slate-50";
const field = `${input} mt-1.5 !py-2 !text-[13.5px]`;

export default function StepDesign({ draft, designer, onChange, onSendTest, onDesignerChanged, onToast }: {
  draft: Draft;
  designer: EmDesigner | null;
  onChange: (patch: Partial<Draft>) => void;
  onSendTest: () => void;
  onDesignerChanged: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const design = draft.design;
  const [selectedId, setSelectedId] = useState<string | null>(() => design.blocks.find((block) => block.type === "button")?.id ?? design.blocks[0]?.id ?? null);
  const [leftTab, setLeftTab] = useState<"blocks" | "styles">("blocks");
  const [rightTab, setRightTab] = useState<"content" | "settings">("content");
  const [mobile, setMobile] = useState(false);
  const [preview, setPreview] = useState(false);
  const [templates, setTemplates] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const history = useRef<{ past: EmailDesign[]; future: EmailDesign[]; lastKey: string; lastAt: number }>({ past: [], future: [], lastKey: "", lastAt: 0 });
  const selected = design.blocks.find((block) => block.id === selectedId) ?? null;
  const fields = fieldsFor(draft, designer);

  /** Every edit goes through here: history (typing in one box is one step) and touched. */
  const commit = (next: EmailDesign, key = "") => {
    const h = history.current;
    const now = Date.now();
    if (!(key && key === h.lastKey && now - h.lastAt < 1200)) {
      h.past = [...h.past.slice(-49), design];
      h.future = [];
    }
    h.lastKey = key;
    h.lastAt = now;
    onChange({ design: { ...next, touched: true } });
  };
  const undo = () => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(design);
    h.lastKey = "";
    onChange({ design: prev });
  };
  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(design);
    h.lastKey = "";
    onChange({ design: next });
  };
  const update = (patch: Partial<EmailBlock>, key?: string) => {
    if (!selected) return;
    commit({ ...design, blocks: design.blocks.map((block) => (block.id === selected.id ? ({ ...block, ...patch } as EmailBlock) : block)) }, key ? `${selected.id}:${key}` : "");
  };
  const insert = (block: EmailBlock, targetId: string | null, place: "before" | "after") => {
    const blocks = [...design.blocks];
    let at = targetId ? blocks.findIndex((row) => row.id === targetId) : -1;
    if (at < 0) at = place === "before" ? 0 : blocks.length - 1;
    // New blocks go above the footer line by default.
    if (!targetId && blocks[blocks.length - 1]?.type === "footer") at = blocks.length - 2;
    blocks.splice(place === "before" ? at : at + 1, 0, block);
    commit({ ...design, blocks });
    setSelectedId(block.id);
    setRightTab("content");
  };
  const addType = (type: string, targetId: string | null, place: "before" | "after") => {
    if (type.startsWith("saved:")) {
      const saved = designer?.saved.find((row) => row.id === type.slice(6));
      if (saved && saved.kind === "block") insert({ ...(saved.content as EmailBlock), id: blockId() }, targetId, place);
      return;
    }
    insert(newBlock(type as EmailBlockType, fields), targetId, place);
  };
  const move = (dir: -1 | 1) => {
    if (!selected) return;
    const blocks = [...design.blocks];
    const at = blocks.findIndex((row) => row.id === selected.id);
    const to = at + dir;
    if (to < 0 || to >= blocks.length) return;
    [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
    commit({ ...design, blocks });
  };
  const remove = () => {
    if (!selected) return;
    const at = design.blocks.findIndex((row) => row.id === selected.id);
    const blocks = design.blocks.filter((row) => row.id !== selected.id);
    commit({ ...design, blocks });
    setSelectedId(blocks[Math.min(at, blocks.length - 1)]?.id ?? null);
  };
  const duplicate = () => { if (selected) insert({ ...selected, id: blockId() } as EmailBlock, selected.id, "after"); };
  const applyTemplate = (key: string, saved?: EmailDesign) => {
    if (design.touched && !window.confirm("Start again from this template? Your changes to the email will be replaced (Undo brings them back).")) return;
    const next = saved ? { ...normalizeDesign(saved)!, blocks: normalizeDesign(saved)!.blocks.map((block) => ({ ...block, id: blockId() })) } : buildTemplateDesign(key, fields);
    commit({ ...next, touched: true });
    setSelectedId(next.blocks[0]?.id ?? null);
    setTemplates(false);
  };
  const saveBlock = async () => {
    if (!selected) return;
    const name = window.prompt("Name this block so you can reuse it:", BLOCK_NAME[selected.type]);
    if (!name?.trim()) return;
    try {
      await emailMarketingApi.saveItem({ kind: "block", name: name.trim(), content: selected });
      await onDesignerChanged();
      onToast("Block saved. Find it under Saved Blocks.");
    } catch (err) {
      onToast((err as Error).message || "Could not save the block.");
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = (event.target as HTMLElement | null)?.closest("input, textarea, select");
      if (typing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const savedBlocks = (designer?.saved ?? []).filter((row) => row.kind === "block");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.75fr)_minmax(0,1.05fr)]">
      <Card className="p-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-50 p-1 dark:bg-slate-800">
          {([["blocks", "Blocks", LayoutGrid], ["styles", "Styles", Paintbrush]] as const).map(([key, text, Icon]) => (
            <button key={key} type="button" onClick={() => setLeftTab(key)} className={`!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg py-2 text-[14px] font-semibold ${leftTab === key ? "bg-[#5B3FD9] text-white" : "text-gray-700 dark:text-slate-300"}`}><Icon className="h-4 w-4" />{text}</button>
          ))}
        </div>
        {leftTab === "blocks" ? (
          <>
            <h4 className="m-0 mt-4 text-[15px] font-bold text-gray-900 dark:text-slate-50">Email Blocks</h4>
            <p className="m-0 text-[12px] text-gray-500">Drag and drop to build your email, or tap to add below the picked block.</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {PALETTE.map(({ type, label: text, icon: Icon }) => (
                <button key={type} type="button" draggable onDragStart={(event) => { event.dataTransfer.setData(DRAG_TYPE, type); event.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => addType(type, selectedId, "after")}
                  className="!min-h-0 flex cursor-grab flex-col items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-1 py-3 text-center text-[12px] font-semibold leading-tight text-gray-800 hover:border-[#C9BEF5] hover:bg-[#F8F6FF] active:cursor-grabbing dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  <Icon className="h-5 w-5 text-[#5B3FD9]" />{text}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setSavedOpen(!savedOpen)} className="!min-h-0 mt-4 flex w-full items-center justify-between text-[15px] font-bold text-gray-900 dark:text-slate-50">Saved Blocks <ChevronRight className={`h-4 w-4 transition-transform ${savedOpen ? "rotate-90" : ""}`} /></button>
            {savedOpen && (
              <div className="mt-2 space-y-1.5">
                {savedBlocks.length ? savedBlocks.map((row) => (
                  <div key={row.id} draggable onDragStart={(event) => event.dataTransfer.setData(DRAG_TYPE, `saved:${row.id}`)} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] dark:border-slate-700">
                    <button type="button" onClick={() => addType(`saved:${row.id}`, selectedId, "after")} className="!min-h-0 min-w-0 flex-1 truncate text-left font-semibold text-gray-800 dark:text-slate-200">{row.name}</button>
                    <button type="button" aria-label="Delete saved block" onClick={async () => { if (!window.confirm(`Delete "${row.name}"?`)) return; await emailMarketingApi.deleteItem(row.id); await onDesignerChanged(); }} className="!min-h-0 text-gray-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )) : <p className="m-0 text-[12px] text-gray-500">Pick a block, then Settings › Save for reuse.</p>}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between">
              <h4 className="m-0 text-[15px] font-bold text-gray-900 dark:text-slate-50">Email Templates</h4>
              <button type="button" onClick={() => setTemplates(true)} className="!min-h-0 text-[13px] font-semibold text-[#5B3FD9] hover:underline">View All</button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {TEMPLATE_CHOICES.slice(0, 3).map((row) => (
                <button key={row.key} type="button" onClick={() => applyTemplate(row.key)} className={`!min-h-0 overflow-hidden rounded-lg border-2 text-center ${design.template === row.key ? "border-[#5B3FD9]" : "border-gray-200 dark:border-slate-700"}`}>
                  <div className="h-[86px] overflow-hidden bg-[#F4F2FB]"><EmailFrame design={buildTemplateDesign(row.key, fields)} scale={0.14} minHeight={600} /></div>
                  <span className="block py-1 text-[11px] font-semibold text-gray-700 dark:text-slate-300">{row.label}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <StylesPanel design={design} onChange={(styles, key) => commit({ ...design, styles }, `styles:${key}`)} />
        )}
      </Card>

      <Card className="min-w-0 p-3">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Undo" title="Undo" onClick={undo} disabled={!history.current.past.length} className={btn.icon}><Undo2 className="h-4 w-4" /></button>
          <button type="button" aria-label="Redo" title="Redo" onClick={redo} disabled={!history.current.future.length} className={btn.icon}><Redo2 className="h-4 w-4" /></button>
          <label className="relative ml-auto">
            <Monitor className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            <select value={mobile ? "mobile" : "desktop"} onChange={(event) => setMobile(event.target.value === "mobile")} className={`${select} !w-[136px] !py-2 !pl-8 !pr-6 !text-[12.5px]`} aria-label="Screen size">
              <option value="desktop">Desktop (600)</option><option value="mobile">Phone (375)</option>
            </select>
          </label>
          <button type="button" aria-label="Phone view" onClick={() => setMobile(!mobile)} className={`${btn.icon} ${mobile ? "!border-[#5B3FD9] !text-[#5B3FD9]" : ""}`}><Smartphone className="h-4 w-4" /></button>
          <button type="button" onClick={() => setPreview(true)} className={`${btn.ghost} !px-2.5 !py-2 !text-[13px]`}><Eye className="h-4 w-4" />Preview</button>
          <button type="button" onClick={onSendTest} className={`${btn.ghost} !px-2.5 !py-2 !text-[13px]`}><Send className="h-4 w-4" />Send Test</button>
        </div>
        <div className="mt-3 max-h-[640px] overflow-y-auto rounded-xl bg-[#F4F2FB] dark:bg-slate-950">
          <EmailFrame design={design} editor mobile={mobile} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setRightTab("content"); }}
            onDrop={(type, targetId, place) => addType(type, targetId, place)} brand={designer?.sender.fromName} footerNote={designer?.settings.footerNote} minHeight={560} />
        </div>
      </Card>

      <Card className="p-3">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-50 p-1 dark:bg-slate-800">
          {([["content", "Content", Square], ["settings", "Settings", Settings2]] as const).map(([key, text, Icon]) => (
            <button key={key} type="button" onClick={() => setRightTab(key)} className={`!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg py-2 text-[14px] font-semibold ${rightTab === key ? "bg-[#5B3FD9] text-white" : "text-gray-700 dark:text-slate-300"}`}><Icon className="h-4 w-4" />{text}</button>
          ))}
        </div>
        {!selected ? <p className="m-0 mt-4 text-[13px] text-gray-500">Tap a part of the email to change it.</p> : (
          <>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-slate-800">
              <span className="text-[14px] font-bold text-gray-900 dark:text-slate-50">Selected Element: {BLOCK_NAME[selected.type]}</span>
              <button type="button" aria-label="Unselect" onClick={() => setSelectedId(null)} className="!min-h-0 text-gray-500 hover:text-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 space-y-3">
              {rightTab === "content"
                ? <BlockEditor block={selected} designer={designer} draft={draft} update={update} onToast={onToast} />
                : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => move(-1)} className={btn.ghost}><ArrowUp className="h-4 w-4" />Move up</button>
                      <button type="button" onClick={() => move(1)} className={btn.ghost}><ArrowDown className="h-4 w-4" />Move down</button>
                      <button type="button" onClick={duplicate} className={btn.ghost}><Copy className="h-4 w-4" />Duplicate</button>
                      <button type="button" onClick={() => void saveBlock()} className={btn.ghost}><Save className="h-4 w-4" />Save for reuse</button>
                    </div>
                    <button type="button" onClick={remove} className={`${btn.ghost} w-full !text-rose-600`}><Trash2 className="h-4 w-4" />Delete this block</button>
                  </div>
                )}
            </div>
          </>
        )}
      </Card>

      {preview && (
        <ModalShell wide title="Preview" sub={`Subject: ${draft.subject || "(no subject yet)"}`} onClose={() => setPreview(false)} footer={<button type="button" onClick={() => setPreview(false)} className={btn.primary}>Close</button>}>
          <div className="flex flex-wrap items-start justify-center gap-4 bg-[#F4F2FB] p-3 dark:bg-slate-950">
            <EmailFrame design={design} preheader={draft.preheader} brand={designer?.sender.fromName} footerNote={designer?.settings.footerNote} fit minHeight={500} className="min-w-[280px] flex-1" />
            <EmailFrame design={design} mobile preheader={draft.preheader} brand={designer?.sender.fromName} footerNote={designer?.settings.footerNote} scale={0.8} minHeight={500} />
          </div>
        </ModalShell>
      )}
      {templates && (
        <ModalShell wide title="Email Templates" sub="Start from one of these, or from a design you saved." onClose={() => setTemplates(false)}
          footer={<>
            <button type="button" onClick={async () => {
              const name = window.prompt("Name this design so you can start from it again:", draft.name || "My template");
              if (!name?.trim()) return;
              try { await emailMarketingApi.saveItem({ kind: "template", name: name.trim(), content: design }); await onDesignerChanged(); onToast("Design saved as a template."); } catch (err) { onToast((err as Error).message || "Could not save."); }
            }} className={`${btn.ghost} mr-auto`}><Upload className="h-4 w-4" />Save this design as a template</button>
            <button type="button" onClick={() => setTemplates(false)} className={btn.primary}>Close</button>
          </>}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEMPLATE_CHOICES.map((row) => (
              <button key={row.key} type="button" onClick={() => applyTemplate(row.key)} className="!min-h-0 overflow-hidden rounded-xl border-2 border-gray-200 text-center hover:border-[#5B3FD9] dark:border-slate-700">
                <div className="h-[200px] overflow-hidden bg-[#F4F2FB]"><EmailFrame design={buildTemplateDesign(row.key, fields)} scale={0.26} minHeight={760} /></div>
                <span className="block py-1.5 text-[12.5px] font-semibold text-gray-800 dark:text-slate-200">{row.label}</span>
              </button>
            ))}
            {(designer?.saved ?? []).filter((row) => row.kind === "template").map((row) => (
              <div key={row.id} className="overflow-hidden rounded-xl border-2 border-gray-200 text-center dark:border-slate-700">
                <button type="button" onClick={() => applyTemplate(row.id, row.content as EmailDesign)} className="!min-h-0 block w-full">
                  <div className="h-[200px] overflow-hidden bg-[#F4F2FB]">{normalizeDesign(row.content) && <EmailFrame design={normalizeDesign(row.content)!} scale={0.26} minHeight={760} />}</div>
                </button>
                <div className="flex items-center justify-between px-2 py-1.5 text-[12.5px] font-semibold text-gray-800 dark:text-slate-200">
                  <span className="truncate">{row.name}</span>
                  <button type="button" aria-label="Delete template" onClick={async () => { if (!window.confirm(`Delete "${row.name}"?`)) return; await emailMarketingApi.deleteItem(row.id); await onDesignerChanged(); }} className="!min-h-0 text-gray-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function StylesPanel({ design, onChange }: { design: EmailDesign; onChange: (styles: EmailDesign["styles"], key: string) => void }) {
  const s = design.styles;
  const colours: Array<[keyof EmailDesign["styles"], string]> = [["backgroundColor", "Email background"], ["contentColor", "Content background"], ["brandColor", "Brand colour (banner)"], ["accentColor", "Button & badge colour"], ["textColor", "Text colour"]];
  return (
    <div className="mt-4 space-y-3">
      {colours.map(([key, text]) => <ColourField key={key} label={text} value={String(s[key])} onChange={(value) => onChange({ ...s, [key]: value }, key)} />)}
      <label className={label}>Font
        <select value={s.fontFamily} onChange={(event) => onChange({ ...s, fontFamily: event.target.value }, "font")} className={`${select} mt-1.5 !py-2 !text-[13.5px]`}>
          {FONT_CHOICES.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
        </select>
      </label>
      <RangeField label="Corner rounding" value={s.radius} min={0} max={32} onChange={(value) => onChange({ ...s, radius: value }, "radius")} />
    </div>
  );
}

function ColourField({ label: text, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={label}>{text}
      <span className="mt-1.5 flex items-center gap-2 rounded-xl border border-gray-200 px-2.5 py-1.5 dark:border-slate-700">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(event) => onChange(event.target.value.toUpperCase())} className="!min-h-0 h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0" aria-label={`${text} picker`} />
        <input value={value} onChange={(event) => onChange(event.target.value)} className="!min-h-0 w-full border-0 bg-transparent text-[13.5px] font-semibold text-gray-900 outline-none dark:text-slate-100" aria-label={text} />
      </span>
    </label>
  );
}

function RangeField({ label: text, value, min, max, onChange, unit = "px" }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void; unit?: string }) {
  return (
    <div>
      <span className={label}>{text}</span>
      <div className="mt-1.5 flex items-center gap-3">
        <input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="flex-1 accent-[#5B3FD9]" aria-label={text} />
        <span className="w-[70px] rounded-lg border border-gray-200 px-2 py-1 text-center text-[13px] font-semibold dark:border-slate-700">{value} {unit}</span>
      </div>
    </div>
  );
}

function AlignField({ value, onChange }: { value: Align; onChange: (value: Align) => void }) {
  return (
    <div>
      <span className={label}>Alignment</span>
      <div className="mt-1.5 grid grid-cols-3 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
        {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([key, Icon]) => (
          <button key={key} type="button" aria-label={key} onClick={() => onChange(key)} className={`!min-h-0 flex justify-center py-2 ${value === key ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-700 dark:bg-slate-900 dark:text-slate-300"}`}><Icon className="h-4 w-4" /></button>
        ))}
      </div>
    </div>
  );
}

/** Upload, paste a link, or use the product's own picture. */
function PictureField({ value, onChange, designer, onToast, text = "Picture" }: { value: string; onChange: (url: string) => void; designer: EmDesigner | null; onToast: (message: string) => void; text?: string }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { onToast("That picture is over 5 MB."); return; }
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Could not read the picture.")); reader.readAsDataURL(file); });
      onChange((await emailMarketingApi.uploadPicture(dataUrl)).url);
    } catch (err) {
      onToast((err as Error).message || "Could not upload the picture.");
    } finally {
      setBusy(false);
    }
  };
  const productPictures = (designer?.products ?? []).filter((row) => row.image).slice(0, 12);
  return (
    <div>
      <span className={label}>{text}</span>
      <div className="mt-1.5 flex gap-2">
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://..." className={`${input} !py-2 !text-[13px]`} aria-label={`${text} link`} />
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={`${btn.ghost} !py-2`} title="Upload a picture"><Upload className="h-4 w-4" />{busy ? "…" : ""}</button>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void upload(file); }} />
      </div>
      {productPictures.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {productPictures.map((row) => (
            <button key={row.id} type="button" title={row.name} onClick={() => onChange(row.image)} className={`!min-h-0 overflow-hidden rounded-md border-2 ${value === row.image ? "border-[#5B3FD9]" : "border-transparent"}`}><img src={row.image} alt={row.name} className="h-9 w-9 object-cover" /></button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkField({ value, onChange, designer, text = "Button Link", required = true }: { value: string; onChange: (url: string) => void; designer: EmDesigner | null; text?: string; required?: boolean }) {
  const [open, setOpen] = useState(false);
  const pages = (designer?.products ?? []).flatMap((row) => row.links.map((link) => ({ name: row.name, ...link })));
  const bad = value.trim() && !/^https?:\/\//i.test(value.trim());
  return (
    <div className="relative">
      <span className={label}>{text}{required && <span className="text-rose-500"> *</span>}</span>
      <span className={`mt-1.5 flex items-center gap-1 rounded-xl border px-3 dark:bg-slate-950 ${bad ? "border-rose-300" : "border-gray-200 dark:border-slate-700"}`}>
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="https://your-landing-page" className="!min-h-0 w-full min-w-0 border-0 bg-transparent py-2 text-[13px] text-gray-900 outline-none dark:text-slate-100" aria-label={text} />
        <button type="button" aria-label="Pick a landing page" onClick={() => setOpen(!open)} className="!min-h-0 text-gray-500 hover:text-[#5B3FD9]"><Link2 className="h-4 w-4" /></button>
      </span>
      {bad && <p className="m-0 mt-1 text-[11.5px] text-rose-600">A link must start with https://</p>}
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-[220px] overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {pages.length ? pages.map((page) => (
            <button key={page.url} type="button" onClick={() => { onChange(page.url); setOpen(false); }} className="!min-h-0 block w-full px-3 py-2 text-left hover:bg-[#F5F2FE] dark:hover:bg-slate-800">
              <span className="block text-[12.5px] font-semibold text-gray-900 dark:text-slate-50">{page.name}</span><span className="block truncate text-[11.5px] text-gray-500">{page.url}</span>
            </button>
          )) : <p className="m-0 px-3 py-2 text-[12px] text-gray-500">No landing pages in Tracking Hub yet. Paste the link.</p>}
        </div>
      )}
    </div>
  );
}

function BlockEditor({ block, designer, draft, update, onToast }: { block: EmailBlock; designer: EmDesigner | null; draft: Draft; update: (patch: Partial<EmailBlock>, key?: string) => void; onToast: (message: string) => void }) {
  const text = (key: string, value: string, name: string, multiline = false, max = 400) => (
    <label className={label}>{name}
      {multiline
        ? <textarea value={value} onChange={(event) => update({ [key]: event.target.value.slice(0, max) } as Partial<EmailBlock>, key)} rows={4} className={`${field} resize-y`} />
        : <input value={value} onChange={(event) => update({ [key]: event.target.value.slice(0, max) } as Partial<EmailBlock>, key)} className={field} />}
    </label>
  );
  switch (block.type) {
    case "header":
      return <>{text("brand", block.brand, "Business name")}{text("tagline", block.tagline, "Tagline")}<AlignField value={block.align} onChange={(align) => update({ align })} /></>;
    case "hero":
      return (
        <>
          {text("title", block.title, "Headline (white)")}{text("highlight", block.highlight, "Headline (coloured)")}{text("subtitle", block.subtitle, "Line under it")}
          <div className="grid grid-cols-3 gap-2">{text("badgeTop", block.badgeTop, "Badge top", false, 14)}{text("badgeMain", block.badgeMain, "Badge big", false, 8)}{text("badgeBottom", block.badgeBottom, "Badge bottom", false, 10)}</div>
          <PictureField value={block.imageUrl} onChange={(imageUrl) => update({ imageUrl })} designer={designer} onToast={onToast} />
          {text("buttonText", block.buttonText, "Button Text", false, 60)}
          <LinkField value={block.buttonLink} onChange={(buttonLink) => update({ buttonLink }, "buttonLink")} designer={designer} />
        </>
      );
    case "cover":
      return (
        <>
          {text("title", block.title, "Headline")}{text("subtitle", block.subtitle, "Line under it", true)}
          <PictureField value={block.imageUrl} onChange={(imageUrl) => update({ imageUrl })} designer={designer} onToast={onToast} />
          {text("emoji", block.emoji, "Emoji (when there is no picture)", false, 20)}
          {text("buttonText", block.buttonText, "Button Text (empty = no button)", false, 60)}
          <LinkField value={block.buttonLink} onChange={(buttonLink) => update({ buttonLink }, "buttonLink")} designer={designer} required={!!block.buttonText} />
          <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Button colour
            <select value={block.buttonTone} onChange={(event) => update({ buttonTone: event.target.value as "yellow" | "purple" })} className="!min-h-0 mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[14px] dark:border-slate-700 dark:bg-slate-950"><option value="yellow">Yellow</option><option value="purple">Purple</option></select>
          </label>
          <div className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Background</div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(COVER_TONES) as Array<keyof typeof COVER_TONES>).map((tone) => (
              <button key={tone} type="button" aria-label={tone} aria-pressed={block.tone === tone} onClick={() => update({ tone })}
                className={`!min-h-0 h-8 w-8 rounded-full border-2 ${block.tone === tone ? "border-[#5B3FD9]" : "border-gray-200"}`} style={{ background: `linear-gradient(180deg, ${COVER_TONES[tone][0]}, ${COVER_TONES[tone][1]})` }} />
            ))}
          </div>
        </>
      );
    case "text":
      return (
        <>
          {text("text", block.text, "Text", true, 2000)}
          <p className="m-0 text-[11.5px] text-gray-500">{"{{First Name}}"} becomes each customer's first name. {"{{Points}}"}, {"{{Level}}"}, {"{{Voucher}}"} and {"{{Next Level}}"} show their loyalty points, level, the voucher waiting for them and how far the next level is.</p>
          <RangeField label="Size" value={block.size} min={11} max={40} onChange={(size) => update({ size }, "size")} />
          <AlignField value={block.align} onChange={(align) => update({ align })} />
          <ColourField label="Colour (blank = normal text)" value={block.color} onChange={(color) => update({ color }, "color")} />
          <label className="flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-slate-200"><input type="checkbox" checked={block.bold} onChange={(event) => update({ bold: event.target.checked })} />Bold</label>
        </>
      );
    case "image":
      return (
        <>
          <PictureField value={block.url} onChange={(url) => update({ url })} designer={designer} onToast={onToast} />
          {text("alt", block.alt, "Describe the picture")}
          <LinkField value={block.link} onChange={(link) => update({ link }, "link")} designer={designer} text="Link when tapped" required={false} />
          <RangeField label="Width" value={block.width} min={20} max={100} unit="%" onChange={(width) => update({ width }, "width")} />
        </>
      );
    case "button":
      return (
        <>
          {text("text", block.text, "Button Text", false, 60)}
          <LinkField value={block.link} onChange={(link) => update({ link }, "link")} designer={designer} />
          <div>
            <span className={label}>Button Style</span>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(["primary", "secondary", "link"] as const).map((style) => (
                <button key={style} type="button" onClick={() => update({ style })} className={`!min-h-0 flex flex-col items-center gap-1.5 rounded-xl border px-1 py-2.5 text-[12px] font-semibold ${block.style === style ? "border-[#8B74EE] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                  {style === "primary" ? <span className="h-4 w-12 rounded" style={{ background: block.color }} /> : style === "secondary" ? <span className="h-4 w-12 rounded border-2" style={{ borderColor: block.color }} /> : <span className="text-[11px] font-bold underline" style={{ color: block.color }}>Text Link</span>}
                  {style === "primary" ? "Primary" : style === "secondary" ? "Secondary" : "Text Link"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={label}>Button Size</span>
            <div className="mt-1.5 grid grid-cols-3 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
              {(["small", "medium", "large"] as const).map((size) => (
                <button key={size} type="button" onClick={() => update({ size })} className={`!min-h-0 py-2 text-[13px] font-semibold capitalize ${block.size === size ? "bg-[#5B3FD9] text-white" : "bg-white text-gray-700 dark:bg-slate-900 dark:text-slate-300"}`}>{size}</button>
              ))}
            </div>
          </div>
          <AlignField value={block.align} onChange={(align) => update({ align })} />
          <div className="grid grid-cols-2 gap-2">
            <ColourField label="Button Color" value={block.color} onChange={(color) => update({ color }, "color")} />
            <ColourField label="Text Color" value={block.textColor} onChange={(textColor) => update({ textColor }, "textColor")} />
          </div>
          <RangeField label="Border Radius" value={block.radius} min={0} max={40} onChange={(radius) => update({ radius }, "radius")} />
        </>
      );
    case "product": {
      const products = designer?.products ?? [];
      return (
        <>
          <label className={label}>Product
            <select value={block.productId} onChange={(event) => {
              const product = products.find((row) => row.id === event.target.value);
              if (product) update({ productId: product.id, name: product.name, price: priceText(product), imageUrl: product.image || block.imageUrl, link: product.links[0]?.url ?? block.link });
            }} className={`${select} mt-1.5 !py-2 !text-[13.5px]`}>
              <option value="">Pick a product</option>{products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          {text("name", block.name, "Name shown")}{text("price", block.price, "Price shown")}
          <PictureField value={block.imageUrl} onChange={(imageUrl) => update({ imageUrl })} designer={designer} onToast={onToast} />
          {text("buttonText", block.buttonText, "Button Text", false, 40)}
          <LinkField value={block.link} onChange={(link) => update({ link }, "link")} designer={designer} />
        </>
      );
    }
    case "offer":
      return (
        <>
          {text("top", block.top, "Top line", false, 14)}{text("main", block.main, "Big text", false, 8)}{text("bottom", block.bottom, "Bottom line", false, 10)}
          <div className="grid grid-cols-2 gap-2"><ColourField label="Colour" value={block.color} onChange={(color) => update({ color }, "color")} /><ColourField label="Text Colour" value={block.textColor} onChange={(textColor) => update({ textColor }, "textColor")} /></div>
        </>
      );
    case "divider":
      return <><ColourField label="Colour" value={block.color} onChange={(color) => update({ color }, "color")} /><RangeField label="Thickness" value={block.thickness} min={1} max={8} onChange={(thickness) => update({ thickness }, "thickness")} /></>;
    case "spacer":
      return <RangeField label="Height" value={block.height} min={4} max={120} onChange={(height) => update({ height }, "height")} />;
    case "social":
      return <>{text("facebook", block.facebook, "Facebook page link")}{text("instagram", block.instagram, "Instagram link")}{text("tiktok", block.tiktok, "TikTok link")}{text("whatsapp", block.whatsapp, "WhatsApp number or link")}<AlignField value={block.align} onChange={(align) => update({ align })} /></>;
    case "timer":
      return (
        <>
          {text("label", block.label, "Label", false, 60)}
          <label className={label}>Offer ends
            <input type="datetime-local" value={toLocalInput(block.endsAt)} onChange={(event) => update({ endsAt: fromLocalInput(event.target.value) })} className={field} />
          </label>
          <p className="m-0 text-[11.5px] leading-snug text-gray-500">Emails can't count down by themselves. Each email shows the time left at the moment it is sent.</p>
        </>
      );
    case "video":
      return (
        <>
          <LinkField value={block.url} onChange={(url) => update({ url }, "url")} designer={null} text="Video link (YouTube, TikTok, Facebook)" />
          <PictureField value={block.thumbnailUrl} onChange={(thumbnailUrl) => update({ thumbnailUrl })} designer={designer} onToast={onToast} text="Cover picture" />
          {text("caption", block.caption, "Caption", false, 80)}
          <p className="m-0 text-[11.5px] leading-snug text-gray-500">Email apps can't play video inside an email, so the cover picture opens the video.</p>
        </>
      );
    case "review": {
      const reviews = designer?.reviews ?? [];
      return (
        <>
          <label className={label}>Customer review
            <select value={block.reviewId} onChange={(event) => {
              const review = reviews.find((row) => row.id === event.target.value);
              update(review ? { reviewId: review.id, quote: review.quote, name: review.name, productName: review.productName } : { reviewId: "", quote: "", name: "" });
            }} className={`${select} mt-1.5 !py-2 !text-[13.5px]`}>
              <option value="">Pick an approved review</option>
              {reviews.map((row) => <option key={row.id} value={row.id}>{row.name}: "{row.quote.slice(0, 50)}{row.quote.length > 50 ? "…" : ""}"</option>)}
            </select>
          </label>
          <p className="m-0 text-[11.5px] leading-snug text-gray-500">{reviews.length ? "Only approved reviews whose customer allowed marketing use are listed. The words can't be changed." : "No approved review has marketing permission yet. Reviews come from Products & Stock › Customer Reviews."}</p>
        </>
      );
    }
    case "html":
      return (
        <>
          <label className={label}>HTML
            <textarea value={block.html} onChange={(event) => update({ html: event.target.value.slice(0, 20000) }, "html")} rows={10} className={`${field} resize-y font-mono !text-[12px]`} />
          </label>
          <p className="m-0 text-[11.5px] leading-snug text-gray-500">Goes into the email exactly as typed. Email apps remove scripts.</p>
        </>
      );
    case "storePicks":
      return (
        <>
          <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">Our Store's products, chosen for each customer when the email is sent, with the store's prices and stock at that moment.</p>
          {text("title", block.title, "Title above the products", false, 80)}
          <label className={label}>Which products
            <select value={block.mode} onChange={(event) => update({ mode: event.target.value as typeof block.mode })} className={`${select} mt-1.5 !py-2`}>
              {STORE_PICKS_MODES.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
            </select>
          </label>
          <label className={label}>How many
            <select value={String(block.count)} onChange={(event) => update({ count: Number(event.target.value) })} className={`${select} mt-1.5 !py-2`}>
              {[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {text("buttonText", block.buttonText, "Button on each product", false, 30)}
        </>
      );
    case "features":
      return (
        <>
          {block.items.map((item, index) => (
            <div key={index} className="flex items-end gap-2">
              <label className={`${label} w-[92px] shrink-0`}>Icon
                <select value={item.icon} onChange={(event) => update({ items: block.items.map((row, i) => (i === index ? { ...row, icon: event.target.value } : row)) })} className={`${select} mt-1.5 !py-2 !text-[15px]`}>
                  {Object.entries(FEATURE_ICONS).map(([key, emoji]) => <option key={key} value={key}>{emoji}</option>)}
                </select>
              </label>
              <label className={`${label} flex-1`}>Box {index + 1}
                <input value={item.title} onChange={(event) => update({ items: block.items.map((row, i) => (i === index ? { ...row, title: event.target.value.slice(0, 40) } : row)) }, `item${index}`)} className={field} />
              </label>
              <button type="button" aria-label="Remove box" disabled={block.items.length <= 1} onClick={() => update({ items: block.items.filter((_, i) => i !== index) })} className={`${btn.icon} mb-0.5`}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {block.items.length < 4 && <button type="button" onClick={() => update({ items: [...block.items, { icon: "star", title: "New point" }] })} className={btn.outline}>Add a box</button>}
        </>
      );
    case "footer":
      return <>{text("text", block.text, "Footer line (use | between parts)", false, 160)}<p className="m-0 text-[11.5px] text-gray-500">Keep it true for every order, e.g. Pay on Delivery.</p></>;
  }
}

const toLocalInput = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 3_600_000).toISOString().slice(0, 16);
};
const fromLocalInput = (value: string) => (value ? new Date(`${value}:00+01:00`).toISOString() : new Date().toISOString());
