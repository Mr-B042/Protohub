import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell, Database, FileText, FolderOpen, Image as ImageIcon, KeyRound, Loader2, Lock, Package, ScrollText, Settings, ShieldCheck,
  Tag, Upload, Video, Workflow, X
} from "lucide-react";
import { productMediaApi, type CatalogSettings, type MediaEvent } from "../../lib/api";
import { timeAgo } from "../../lib/media-upload";
import { cardShell } from "./shared";

// Settings (Bright's design, 17 Oct 2026). Every switch here does something.
// The few in the design that have nothing behind them yet (backorders,
// product comparison, per-state pricing) are shown locked with the reason,
// never as a toggle that silently does nothing.

const SECTIONS = [
  { id: "general", label: "General Settings", hint: "Basic product & stock configurations", icon: Settings, tone: "bg-blue-50 text-[#1F8FE0]" },
  { id: "media", label: "Media Settings", hint: "Image and video upload rules", icon: ImageIcon, tone: "bg-blue-50 text-blue-500" },
  { id: "approval", label: "Approval Workflow", hint: "Control who can publish content", icon: Workflow, tone: "bg-violet-50 text-violet-500" },
  { id: "stock", label: "Stock Management", hint: "Stock alerts and thresholds", icon: Package, tone: "bg-emerald-50 text-emerald-600" },
  { id: "pricing", label: "Pricing & Offers", hint: "Bundle, discount and free gift settings", icon: Tag, tone: "bg-rose-50 text-rose-500" },
  { id: "categories", label: "Categories", hint: "Category rules and display settings", icon: FolderOpen, tone: "bg-fuchsia-50 text-fuchsia-500" },
  { id: "fields", label: "Product Fields", hint: "Fields and information", icon: FileText, tone: "bg-indigo-50 text-indigo-500" },
  { id: "access", label: "Access & Permissions", hint: "Role-based access control", icon: KeyRound, tone: "bg-amber-50 text-amber-500" },
  { id: "notifications", label: "Notifications", hint: "Alerts and activity updates", icon: Bell, tone: "bg-emerald-50 text-emerald-500" },
  { id: "data", label: "Data & Export", hint: "Export product and media lists", icon: Database, tone: "bg-sky-50 text-sky-500" },
  { id: "security", label: "Security", hint: "File checks, validation and safety", icon: ShieldCheck, tone: "bg-teal-50 text-teal-600" },
  { id: "audit", label: "Audit Log", hint: "Track changes and activities", icon: ScrollText, tone: "bg-rose-50 text-rose-500" }
] as const;

const ACTION_TEXT: Record<string, string> = {
  uploaded: "uploaded", approved: "approved", rejected: "rejected", changes_requested: "asked for changes on", deleted: "deleted", updated: "edited",
  refused: "had a file refused", settings_changed: "changed settings", category_added: "added category", category_deleted: "deleted category"
};

export function SettingsTab({ settings, onSaved, canApprove, canManageCatalog, lowStockThreshold, onLowStockThreshold, currencies, offerCounts, categoryCount, onGoCategories, onExport, onToast }: {
  settings: CatalogSettings | null;
  onSaved: (next: CatalogSettings) => void;
  canApprove: boolean;
  canManageCatalog: boolean;
  lowStockThreshold: number;
  onLowStockThreshold: (value: number) => void;
  currencies: string[];
  offerCounts: { active: number; gifts: number; bundles: number };
  categoryCount: number;
  onGoCategories: () => void;
  onExport: (what: "products" | "media" | "categories" | "offers") => void;
  onToast: (message: string) => void;
}) {
  const [draft, setDraft] = useState<CatalogSettings | null>(settings);
  const [threshold, setThreshold] = useState(String(lowStockThreshold));
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState("general");
  const [events, setEvents] = useState<MediaEvent[] | null>(null);
  const [uploadingSlot, setUploadingSlot] = useState("");
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => { setDraft(settings); }, [settings]);
  useEffect(() => { setThreshold(String(lowStockThreshold)); }, [lowStockThreshold]);
  useEffect(() => { if (canApprove) productMediaApi.events().then((result) => setEvents(result.events ?? [])).catch(() => setEvents([])); }, [canApprove]);

  if (!draft) return <div className={`${cardShell} p-8 text-center text-[13px] text-gray-400`}>Loading settings...</div>;
  const locked = !canApprove;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings) || Number(threshold) !== lowStockThreshold;
  const set = <K extends keyof CatalogSettings>(key: K, value: CatalogSettings[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    if (!settings || locked) return;
    setSaving(true);
    try {
      const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify((settings as any)[key]))) as Partial<CatalogSettings>;
      if (Object.keys(changed).length) onSaved(await productMediaApi.saveSettings(changed));
      const nextThreshold = Math.max(0, Math.round(Number(threshold) || 0));
      if (canManageCatalog && nextThreshold !== lowStockThreshold) onLowStockThreshold(nextThreshold);
      onToast("Settings saved.");
    } catch (error: any) { onToast(error?.message ?? "Could not save settings."); }
    finally { setSaving(false); }
  };
  const jump = (id: string) => { setActive(id); refs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const uploadDefault = async (slot: "main" | "video" | "lifestyle", file: File | null) => {
    setUploadingSlot(slot);
    try {
      const dataUrl = file ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); }) : null;
      const next = await productMediaApi.saveDefaultImage(slot, dataUrl);
      onSaved(next);
    } catch (error: any) { onToast(error?.message ?? "Could not save the picture."); }
    finally { setUploadingSlot(""); }
  };
  const toggleType = (key: "allowedImageTypes" | "allowedVideoTypes", type: string) => {
    const list = draft[key];
    set(key, list.includes(type) ? list.filter((entry) => entry !== type) : [...list, type]);
  };
  const section = (id: string, title: string, hint: string, children: ReactNode, action?: ReactNode) => {
    const meta = SECTIONS.find((entry) => entry.id === id) ?? { icon: ImageIcon, tone: "bg-violet-50 text-violet-500" };
    const Icon = meta.icon;
    return (
      <section ref={(el) => { refs.current[id] = el; }} className={`${cardShell} scroll-mt-20 p-4 sm:p-5`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl dark:bg-slate-800 ${meta.tone}`}><Icon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1"><h2 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">{title}</h2><p className="m-0 mt-0.5 text-[12.5px] text-gray-500 dark:text-slate-400">{hint}</p></div>
          {action}
        </div>
        <div className="mt-4">{children}</div>
      </section>
    );
  };
  const saveButton = (
    <button type="button" disabled={locked || saving || !dirty} onClick={save} className="!min-h-0 hidden shrink-0 items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-[13px] font-black text-white disabled:opacity-50 sm:inline-flex">
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save Changes
    </button>
  );

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <nav className={`${cardShell} -mx-4 flex gap-1 overflow-x-auto rounded-none border-x-0 p-2 [scrollbar-width:none] sm:mx-0 sm:rounded-2xl sm:border-x lg:sticky lg:top-20 lg:flex-col lg:overflow-visible [&::-webkit-scrollbar]:hidden`} aria-label="Settings sections">
        {SECTIONS.map((entry) => {
          const Icon = entry.icon;
          const on = active === entry.id;
          return (
            <button key={entry.id} type="button" onClick={() => jump(entry.id)}
              className={`!min-h-0 flex shrink-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left lg:w-full ${on ? "bg-blue-50 ring-1 ring-blue-100 dark:bg-blue-500/15 dark:ring-blue-500/30" : "hover:bg-gray-50 dark:hover:bg-slate-900"}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl dark:bg-slate-800 ${entry.tone}`}><Icon className="h-[18px] w-[18px]" /></span>
              <span className="min-w-0"><span className={`block whitespace-nowrap text-[13.5px] font-bold ${on ? "text-[#1F8FE0]" : "text-gray-800 dark:text-slate-100"}`}>{entry.label}</span><span className="hidden truncate text-[11.5px] text-gray-500 lg:block dark:text-slate-400">{entry.hint}</span></span>
            </button>
          );
        })}
      </nav>

      <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {locked && <p className="m-0 flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2.5 text-[13px] font-semibold text-gray-600 dark:bg-slate-800 dark:text-slate-300"><Lock className="h-4 w-4" />Only an Owner, Admin or Manager can change these settings.</p>}
          {section("general", "General Settings", "Basic configuration for your product catalogue and stock system.", (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default Currency"><Select value={draft.preferredCurrency} disabled={locked} onChange={(value) => set("preferredCurrency", value)}>{Array.from(new Set([draft.preferredCurrency, ...currencies])).map((code) => <option key={code} value={code}>{code === "NGN" ? "Nigerian Naira (₦)" : code === "GHS" ? "Ghana Cedi (GH₵)" : code === "KES" ? "Kenyan Shilling (KSh)" : code === "USD" ? "US Dollar ($)" : code === "GBP" ? "British Pound (£)" : code}</option>)}</Select></Field>
              <Field label="Price Display Format"><Select value={draft.priceFormat} disabled={locked} onChange={(value) => set("priceFormat", value as "full" | "short")}><option value="full">₦1,234,567</option><option value="short">₦1.2M</option></Select></Field>
              <Field label="Units Display"><Select value={draft.unitsWord} disabled={locked} onChange={(value) => set("unitsWord", value as CatalogSettings["unitsWord"])}><option value="units">Units</option><option value="pcs">Units (pcs)</option><option value="pieces">Pieces</option></Select></Field>
              <Field label="Default View"><Select value={draft.defaultView} disabled={locked} onChange={(value) => set("defaultView", value as "grid" | "list")}><option value="grid">Grid View</option><option value="list">List View</option></Select></Field>
              <Toggle on={draft.showSku} disabled={locked} onChange={(value) => set("showSku", value)} title="Show product codes (SKU)" hint="Display SKU on product cards and lists" />
              <Toggle on={draft.showStockToReps} disabled={locked} onChange={(value) => set("showStockToReps", value)} title="Show stock quantity to sales reps" hint="Off: reps see 'In stock' instead of numbers" />
              <Toggle on={false} disabled lockedNote="Not built yet" onChange={() => undefined} title="Enable product comparison" hint="Allow comparison between products" />
              <Toggle on={draft.showLowStockWarning} disabled={locked} onChange={(value) => set("showLowStockWarning", value)} title="Show low stock warning" hint="Highlight products with low stock" />
            </div>
          ), saveButton)}

          {section("media", "Media Settings", "Control image and video uploads, file types, size limits and quality.", (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Allowed Image Types"><Chips options={["jpg", "png", "webp"]} chosen={draft.allowedImageTypes} disabled={locked} onToggle={(type) => toggleType("allowedImageTypes", type)} /></Field>
                <Field label="Allowed Video Types"><Chips options={["mp4", "mov", "webm"]} chosen={draft.allowedVideoTypes} disabled={locked} onToggle={(type) => toggleType("allowedVideoTypes", type)} /></Field>
                <Field label="Max Image File Size"><Select value={String(draft.maxImageMb)} disabled={locked} onChange={(value) => set("maxImageMb", Number(value))}>{[2, 5, 10].map((mb) => <option key={mb} value={mb}>{mb} MB</option>)}</Select></Field>
                <Field label="Max Video File Size"><Select value={String(draft.maxVideoMb)} disabled={locked} onChange={(value) => set("maxVideoMb", Number(value))}>{[25, 50, 100].map((mb) => <option key={mb} value={mb}>{mb} MB</option>)}</Select></Field>
                <Toggle on disabled lockedNote="Always on" onChange={() => undefined} title="Compress images automatically" hint="Photos are shrunk and saved fresh for the web" />
                <Toggle on disabled lockedNote="Always on" onChange={() => undefined} title="Generate thumbnails for videos" hint="A cover picture is made for every video" />
                <Toggle on disabled lockedNote="Always on" onChange={() => undefined} title="Check every file" hint="Each upload's real type is read before it is kept" />
                <Toggle on disabled lockedNote="Always on" onChange={() => undefined} title="Allow only safe file types" hint="Apps, scripts and documents are blocked" />
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-500/20 dark:bg-blue-500/10">
                <ShieldCheck className="mt-0.5 h-7 w-7 shrink-0 text-[#1F8FE0]" />
                <div><p className="m-0 text-[14px] font-black text-[#1F8FE0]">Security Protection</p>
                  <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-gray-600 dark:text-slate-300">Every upload's real type is read from the file itself, not its name. Apps and scripts (EXE, BAT, CMD, SCR, APK, etc.), web pages and documents are refused and deleted. Photos are redrawn as clean copies with location data removed.</p></div>
              </div>
            </div>
          ))}

          {section("approval", "Approval Workflow", "Control who can publish content.", (
            <div className="grid gap-4 sm:grid-cols-2">
              <Toggle on={draft.repUploadsEnabled} disabled={locked} onChange={(value) => set("repUploadsEnabled", value)} title="Team members can send media" hint="Sales reps and other roles can add photos and videos" />
              <Toggle on={draft.requireApproval} disabled={locked} onChange={(value) => set("requireApproval", value)} title="Their files need approval" hint="Off: their files go straight into the gallery" />
              <p className="m-0 text-[12.5px] text-gray-500 sm:col-span-2 dark:text-slate-400">Owner, Admin and Manager always publish directly and approve everyone else's files. Each person can send up to 40 files an hour and have 30 waiting at once.</p>
            </div>
          ))}

          {section("notifications", "Notifications", "Alerts and activity updates.", (
            <div className="grid gap-4 sm:grid-cols-2">
              <Toggle on={draft.notifyApprovers} disabled={locked} onChange={(value) => set("notifyApprovers", value)} title="Tell approvers about new files" hint="Bell + phone alert to Owner, Admin and Manager" />
              <Toggle on={draft.notifySenders} disabled={locked} onChange={(value) => set("notifySenders", value)} title="Tell senders the decision" hint="Approved, rejected or changes asked, with the reason" />
            </div>
          ))}

          {section("security", "Security", "File checks, validation and safety.", (
            <div className="space-y-2 text-[13px] text-gray-600 dark:text-slate-300">
              <p className="m-0">Files waiting for approval sit in a private area that nobody else can open. Only approved files are public, served from storage, never from Protohub's own address.</p>
              <p className="m-0 font-bold text-gray-800 dark:text-slate-100">Recently refused files</p>
              {events === null ? <p className="m-0 text-gray-400">{canApprove ? "Loading..." : "Approvers only."}</p>
                : events.filter((event) => event.action === "refused").slice(0, 6).map((event) => (
                  <p key={event.id} className="m-0 flex items-start gap-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-[12px] text-rose-700 dark:bg-rose-500/10 dark:text-rose-200"><X className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span><b>{event.actorName}</b> · {event.detail} · {timeAgo(event.createdAt)}</span></p>
                ))}
              {events && !events.some((event) => event.action === "refused") && <p className="m-0 text-gray-400">No refused files.</p>}
            </div>
          ))}

          {section("audit", "Audit Log", "Track changes and activities.", (
            events === null ? <p className="m-0 text-[13px] text-gray-400">{canApprove ? "Loading..." : "Approvers only."}</p> : events.length === 0 ? <p className="m-0 text-[13px] text-gray-400">Nothing yet.</p> : (
              <ul className="m-0 max-h-80 list-none divide-y divide-gray-100 overflow-y-auto p-0 dark:divide-slate-800">
                {events.slice(0, 60).map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-3 py-2 text-[12.5px]">
                    <span className="min-w-0 text-gray-700 dark:text-slate-200"><b>{event.actorName}</b> {ACTION_TEXT[event.action] ?? event.action} <span className="text-gray-500">{event.detail}</span></span>
                    <span className="shrink-0 text-[11px] text-gray-400">{timeAgo(event.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )
          ))}
        </div>

        <div className="min-w-0 space-y-4">
          {section("stock", "Stock Management", "Set stock alerts, thresholds and behaviour.", (
            <div className="space-y-4">
              <Field label="Low Stock Threshold">
                <div className="flex overflow-hidden rounded-xl border border-gray-200 dark:border-slate-600">
                  <input value={threshold} disabled={!canManageCatalog} onChange={(event) => setThreshold(event.target.value.replace(/\D/g, "").slice(0, 5))} inputMode="numeric" className="h-11 min-w-0 flex-1 px-3 text-[14px] disabled:bg-gray-50 dark:bg-slate-950 dark:text-slate-100" />
                  <span className="flex items-center border-l border-gray-200 bg-gray-50 px-3 text-[13px] text-gray-500 dark:border-slate-600 dark:bg-slate-900">units</span>
                </div>
                <span className="mt-1 block text-[11.5px] text-gray-400">{canManageCatalog ? "Show a low stock warning when units fall to this number. Same rule as the stock alerts." : "Set by an Owner or Admin."}</span>
              </Field>
              <Field label="Out of Stock Behaviour"><Select value={draft.hideUnavailableFromReps ? "hide" : "show"} disabled={locked} onChange={(value) => set("hideUnavailableFromReps", value === "hide")}><option value="show">Show as unavailable</option><option value="hide">Hide from sales reps</option></Select></Field>
              <Toggle on={draft.hideUnavailableFromReps} disabled={locked} onChange={(value) => set("hideUnavailableFromReps", value)} title="Auto-hide unavailable products" hint="Hide out of stock products from sales reps" />
              <Toggle on={false} disabled lockedNote="Not available" onChange={() => undefined} title="Allow backorders" hint="The order form follows each package's own stock rule (set in Inventory)" />
            </div>
          ))}

          {section("pricing", "Pricing & Offers", "Configure bundle, discount and free gift settings.", (
            <div className="space-y-3 text-[13px]">
              <Status title="Bundle offers" value={`${offerCounts.bundles} live`} hint="Multi-packs are packages; switch each on or off in Bundles & Offers." />
              <Status title="Free gift offers" value={`${offerCounts.gifts} live`} hint="Gifts are added per offer and come out of stock on delivery." />
              <Toggle on={false} disabled lockedNote="Not available" onChange={() => undefined} title="Allow custom pricing per state" hint="Packages can be limited to states in Inventory, not priced per state" />
              <Toggle on={false} disabled lockedNote="Not built yet" onChange={() => undefined} title="Show discount prices" hint="Display original and discounted prices" />
            </div>
          ))}

          {section("images", "Default Product Images", "Set default images when a product has no media.", (
            <div className="grid grid-cols-3 gap-2.5">
              {([["main", "Main Image", draft.defaultMainImageUrl], ["video", "Video Thumbnail", draft.defaultVideoThumbUrl], ["lifestyle", "Lifestyle Image", draft.defaultLifestyleImageUrl]] as const).map(([slot, label, url]) => (
                <div key={slot} className="text-center">
                  <label className={`relative block aspect-square overflow-hidden rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-900 ${locked ? "" : "cursor-pointer hover:border-[#1F8FE0]"}`}>
                    {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-gray-300">{slot === "video" ? <Video className="h-7 w-7" /> : <ImageIcon className="h-7 w-7" />}</span>}
                    {uploadingSlot === slot ? <span className="absolute inset-0 flex items-center justify-center bg-white/70"><Loader2 className="h-5 w-5 animate-spin text-[#1F8FE0]" /></span>
                      : !locked && <span className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-[#1F8FE0] text-white"><Upload className="h-3.5 w-3.5" /></span>}
                    {!locked && <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadDefault(slot, file); }} />}
                  </label>
                  <span className="mt-1.5 block text-[11.5px] text-gray-500">{label}</span>
                  {url && !locked && <button type="button" onClick={() => uploadDefault(slot, null)} className="!min-h-0 text-[11px] font-bold text-rose-600">Remove</button>}
                </div>
              ))}
              <p className="col-span-3 m-0 text-[11.5px] text-gray-400">Shown on product cards with no photos yet. Main image is used first.</p>
            </div>
          ))}

          {section("categories", "Categories", "Category rules and display settings.", (
            <div className="flex items-center justify-between gap-3 text-[13px] text-gray-600 dark:text-slate-300">
              <span>{categoryCount} categor{categoryCount === 1 ? "y" : "ies"}. Each product sits in one category.</span>
              <button type="button" onClick={onGoCategories} className="!min-h-0 shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 font-bold dark:border-slate-600">Manage</button>
            </div>
          ))}

          {section("fields", "Product Fields", "Fields and information.", (
            <div className="space-y-1.5 text-[13px] text-gray-600 dark:text-slate-300">
              <p className="m-0">Name, SKU, description, prices, packages, cost and stock are edited on each product in Inventory.</p>
              <p className="m-0 text-[12px] text-gray-400">Custom extra fields are not built yet.</p>
            </div>
          ))}

          {section("access", "Access & Permissions", "Role-based access control.", (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-left text-[12px]">
                <thead className="text-gray-400"><tr><th className="py-1.5">Role</th><th className="py-1.5 text-center">View</th><th className="py-1.5 text-center">Add media</th><th className="py-1.5 text-center">Approve</th><th className="py-1.5 text-center">Catalogue</th></tr></thead>
                <tbody className="divide-y divide-gray-100 text-gray-700 dark:divide-slate-800 dark:text-slate-200">
                  {([["Owner", 1, 1, 1, 1], ["Admin", 1, 1, 1, 1], ["Manager", 1, 1, 1, 0], ["Sales Rep", 1, draft.repUploadsEnabled ? (draft.requireApproval ? 2 : 1) : 0, 0, 0], ["Recovery Rep", 1, draft.repUploadsEnabled ? (draft.requireApproval ? 2 : 1) : 0, 0, 0], ["Viewer", 1, 0, 0, 0]] as const).map(([role, ...cells]) => (
                    <tr key={role}><td className="py-1.5 font-semibold">{role}</td>{cells.map((cell, index) => <td key={index} className="py-1.5 text-center">{cell === 1 ? "✓" : cell === 2 ? "With approval" : "—"}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {section("data", "Data & Export", "Export product and media lists.", (
            <div className="grid grid-cols-2 gap-2">
              {([["products", "Products"], ["media", "Media list"], ["categories", "Categories"], ["offers", "Offers"]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => onExport(key)} className="!min-h-0 rounded-xl border border-gray-200 py-2.5 text-[13px] font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-200">Download {label}</button>
              ))}
            </div>
          ))}
        </div>
      </div>

      {dirty && !locked && (
        <div className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 sm:hidden">
          <button type="button" disabled={saving} onClick={save} className="!min-h-0 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1F8FE0] py-3.5 text-sm font-black text-white shadow-lg">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save Changes</button>
        </div>
      )}
      {dirty && !locked && (
        <div className="fixed bottom-6 right-6 z-40 hidden sm:block">
          <button type="button" disabled={saving} onClick={save} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#1F8FE0] px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-500/30">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save Changes</button>
        </div>
      )}
    </div>
  );
}

const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className="block"><span className="mb-1.5 block text-[13px] font-bold text-gray-800 dark:text-slate-100">{label}</span>{children}</label>;

function Select({ value, onChange, disabled, children }: { value: string; onChange: (value: string) => void; disabled?: boolean; children: ReactNode }) {
  return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-[14px] text-gray-800 disabled:bg-gray-50 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100">{children}</select>;
}

function Chips({ options, chosen, onToggle, disabled }: { options: string[]; chosen: string[]; onToggle: (value: string) => void; disabled?: boolean }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-gray-200 px-2 py-1.5 dark:border-slate-600">
      {options.map((option) => {
        const on = chosen.includes(option);
        return <button key={option} type="button" disabled={disabled} onClick={() => onToggle(option)} aria-pressed={on}
          className={`!min-h-0 rounded-lg px-2.5 py-1 text-[12px] font-black uppercase ${on ? "bg-blue-50 text-[#1F8FE0] dark:bg-blue-500/15" : "bg-gray-100 text-gray-400 line-through dark:bg-slate-800"}`}>{option}</button>;
      })}
    </div>
  );
}

function Toggle({ on, onChange, title, hint, disabled, lockedNote }: { on: boolean; onChange: (value: boolean) => void; title: string; hint: string; disabled?: boolean; lockedNote?: string }) {
  return (
    <div className={`flex items-start gap-3 ${lockedNote && !on ? "opacity-60" : ""}`}>
      <button type="button" role="switch" aria-checked={on} aria-label={title} disabled={disabled} onClick={() => onChange(!on)}
        className={`!min-h-0 relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed ${on ? "bg-[#1F8FE0]" : "bg-gray-300 dark:bg-slate-600"} ${disabled && !lockedNote ? "opacity-60" : ""}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[1.375rem]" : "left-0.5"}`} />
      </button>
      <span className="min-w-0"><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-100">{title}{lockedNote && <span className="ml-1.5 inline-block whitespace-nowrap rounded bg-gray-100 px-1.5 py-0.5 align-middle text-[10px] font-bold text-gray-500 dark:bg-slate-800">{lockedNote}</span>}</span>
        <span className="block text-[12px] text-gray-500 dark:text-slate-400">{hint}</span></span>
    </div>
  );
}

const Status = ({ title, value, hint }: { title: string; value: string; hint: string }) => (
  <div className="flex items-start justify-between gap-3">
    <span><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-100">{title}</span><span className="block text-[12px] text-gray-500 dark:text-slate-400">{hint}</span></span>
    <span className="shrink-0 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{value}</span>
  </div>
);
