import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Eye, Loader2, Sparkles, X } from "lucide-react";
import { emailMarketingApi, type EmAudience, type EmCampaign, type EmCampaignInput, type EmDesigner } from "../../lib/api";
import { STORE_HOME, asPersonalNote, buildLetterDesign, buildQuietDesign, buildStoreDesign, type EmailDesign } from "../../lib/email-render";
import EmailPreviewGallery from "./EmailPreviewGallery";
import { christmasSeason, normalMonth, planDays, tipSlot, type PlanSlot } from "./email-plan";
import { TIPS } from "./tips-library";
import { DEFAULT_OPTIONS, priceText } from "./wizard-model";

/**
 * Monthly Plan (Bright, 9 Nov 2026): two emails a week, selling in payday
 * weeks, helpful emails in between; December is the Christmas season. Each
 * send goes in two versions that never overlap: delivered customers (Our
 * Store) and everyone else (pay on delivery). 8:00am Lagos.
 */

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const nice = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const VERSIONS = [
  { key: "store" as const, label: "Store", who: "Delivered customers · Our Store", audience: { source: "custom", custom: { name: "Delivered customers", match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 1 }] } } as EmAudience },
  { key: "pod" as const, label: "Pay on Delivery", who: "No delivery yet · best seller", audience: { source: "custom", custom: { name: "No delivery yet", match: "all", conditions: [{ field: "purchase_count", op: "eq", value: 0 }] } } as EmAudience }
];
const PILLAR_STYLE: Record<PlanSlot["pillar"], string> = {
  Sales: "bg-amber-50 text-amber-800", Education: "bg-emerald-50 text-emerald-800", Proof: "bg-sky-50 text-sky-800", Community: "bg-pink-50 text-pink-800", Product: "bg-violet-50 text-violet-800"
};

export default function MonthlyPlan({ campaigns, onClose, onDone, onToast }: { campaigns: EmCampaign[]; onClose: () => void; onDone: () => void; onToast: (message: string) => void }) {
  const today = lagosToday();
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - 1;
  const choices = [0, 1, 2].map((add) => ({ year: y + Math.floor((m + add) / 12), month: (m + add) % 12 }));
  const [pick, setPick] = useState(() => (m === 10 ? 1 : 0));
  const [cutoff, setCutoff] = useState(20);
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);
  const [library, setLibrary] = useState(false);
  const [ab, setAb] = useState(true);
  const [person, setPerson] = useState(() => { try { return localStorage.getItem("em.personSender") ?? ""; } catch { return ""; } });
  useEffect(() => { try { localStorage.setItem("em.personSender", person); } catch { /* private mode */ } }, [person]);
  const [counts, setCounts] = useState<Record<string, number | null>>({ store: null, pod: null });
  useEffect(() => { emailMarketingApi.designer().then(setDesigner).catch((err) => setError((err as Error).message || "Could not load.")); }, []);
  useEffect(() => { for (const v of VERSIONS) void emailMarketingApi.audiencePreview(v.audience).then((res) => setCounts((prev) => ({ ...prev, [v.key]: res.recipients }))).catch(() => undefined); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && preview === null && !library) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, preview, library]);

  const { year, month } = choices[pick];
  const label = `${MONTHS[month]} ${year}`;
  const cutoffText = new Date(Date.UTC(year, 11, cutoff, 12)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const slots = useMemo(() => (month === 11 ? christmasSeason(cutoffText) : normalMonth(month, year)), [month, year, cutoffText]);
  // Days that already carry a one-time email (holidays etc.): move ours a day so nobody gets two in a day.
  const busyDays = useMemo(() => new Set(campaigns.filter((row) => row.status !== "archived" && !row.name.startsWith("Plan:") && row.sendAt)
    .map((row) => new Date(row.sendAt!).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }))), [campaigns]);
  const rows = useMemo(() => planDays(year, month, cutoff).map((day, index) => {
    const fixed = month === 11 && (index === 6 || index === 7); // the cut-off day and Christmas Day stay put
    let sendDay = day;
    for (let i = 0; !fixed && busyDays.has(sendDay) && i < 3; i += 1) sendDay = addDay(sendDay, 1);
    return { slot: slots[index], day, sendDay, moved: sendDay !== day, clash: busyDays.has(sendDay) };
  }), [year, month, cutoff, slots, busyDays]);
  const nameOf = (index: number, version: (typeof VERSIONS)[number]) => `Plan: ${label} · ${index + 1}. ${rows[index].slot.title} · ${version.label}`;
  // Already scheduled = any plan email for this month, place and version (its title may have changed since).
  // A draft is one that failed to schedule (e.g. refused for a missing link): it doesn't count, so the place gets filled.
  const allNames = campaigns.filter((row) => row.status !== "archived" && row.status !== "draft").map((row) => row.name);
  const has = (index: number, version: (typeof VERSIONS)[number]) => allNames.some((name) => name.startsWith(`Plan: ${label} · ${index + 1}. `) && name.endsWith(` · ${version.label}`));
  const best = designer?.products.find((row) => row.image && row.links.length) ?? designer?.products[0];
  const fields = () => ({ brand: designer?.sender.fromName || "Our Store", goal: "retention", offerType: "custom", productId: best?.id ?? "", productName: best?.name ?? "", productImage: best?.image ?? "",
    productLink: best?.links[0]?.url ?? "", productPrice: priceText(best), offerOn: false, offerTitle: "", offerBenefit: "" });
  const designOf = (slot: PlanSlot, version: "store" | "pod"): EmailDesign => {
    if (slot.tip) return buildLetterDesign(fields(), slot.tip, version);
    if (version === "store" && !slot.noSell) return buildStoreDesign(fields(), slot.store.spec!);
    const d = buildQuietDesign(fields(), slot.pod.spec!);
    // Every email needs one link: a thank-you gets a quiet one.
    if (!slot.noSell) return d;
    const link = { id: `l${slot.key}`, type: "button" as const, text: "We're here whenever you need us →", link: version === "store" ? STORE_HOME : fields().productLink || STORE_HOME, style: "link" as const, size: "small" as const, align: "center" as const, color: "#2A98DE", textColor: "#FFFFFF", radius: 0 };
    return { ...d, blocks: [...d.blocks.slice(0, -1), link, d.blocks[d.blocks.length - 1]] };
  };
  // A/B (Bright, 9 Nov 2026): B = short lowercase subject, from a person, as a plain note.
  const subjectB = (slot: PlanSlot, subject: string) => {
    const plain = (slot.tip ? slot.tip.title : subject.replace(/,?\s*\{\{First Name\}\}/, "")).replace(/[^\p{L}\p{N}\s',:?-]/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
    return slot.tip ? `{{First Name}}, ${plain}` : plain;
  };
  const future = rows.map((row, index) => ({ ...row, index })).filter((row) => row.sendDay >= today);
  const todo = future.filter((row) => VERSIONS.some((v) => !has(row.index, v)));

  const schedule = async () => {
    if (!designer) return;
    setBusy(true); setError("");
    let made = 0;
    try {
      for (const row of todo) {
        // Today's send can't be at 8am any more: an hour from now instead.
        const at = row.sendDay === today ? new Date(Date.now() + 3_600_000) : new Date(`${row.sendDay}T08:00:00+01:00`);
        for (const v of VERSIONS) {
          const name = nameOf(row.index, v);
          if (has(row.index, v)) continue;
          const words = v.key === "store" ? row.slot.store : row.slot.pod;
          const input: EmCampaignInput = {
            name, goal: "retention", subject: words.subject, subjectB: ab ? subjectB(row.slot, words.subject) : "", preheader: words.preheader, offerType: "custom",
            productId: v.key === "pod" ? best?.id ?? null : null, offer: { on: false, title: "", benefit: "" }, audience: v.audience, design: designOf(row.slot, v.key),
            delivery: { type: "one_time", sendAt: at.toISOString() },
            options: { ...DEFAULT_OPTIONS, abTest: ab, ...(ab ? { noteB: true, ...(person.trim() ? { fromNameB: person.trim() } : {}) } : {}) }, thumbnailUrl: null, offerId: null
          };
          const created = await emailMarketingApi.createCampaign(input);
          await emailMarketingApi.launch(created.id, false);
          made += 1;
        }
      }
      onToast(`Scheduled ${made} emails for ${label}.`);
      onDone();
    } catch (err) {
      setError(`${(err as Error).message || "Could not schedule."}${made ? ` (${made} were scheduled before this.)` : ""}`);
    } finally { setBusy(false); }
  };

  const previewRow = preview === null ? null : rows[preview];
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Monthly Plan">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5B3FD9] text-white"><Sparkles className="h-5 w-5" /></span>
          <div className="mr-auto">
            <h2 className="m-0 text-[19px] font-extrabold text-gray-900 dark:text-slate-50">Monthly Plan</h2>
            <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Two emails a week: 7 helpful tips as plain letters, and 1 selling email in payday week (the 25th–31st). The tips change every month.</p>
          </div>
          <button type="button" onClick={() => setLibrary(true)} disabled={!designer} className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] font-semibold text-[#5B3FD9] dark:border-slate-700"><Eye className="h-4 w-4" />Tips Library ({TIPS.length})</button>
          <button type="button" onClick={onClose} aria-label="Close" className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-slate-800">
          {choices.map((c, index) => (
            <button key={index} type="button" onClick={() => setPick(index)}
              className={`!min-h-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold ${pick === index ? "bg-[#5B3FD9] text-white" : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>
              {MONTHS[c.month]} {c.year}{c.month === 11 ? " 🎄" : ""}
            </button>
          ))}
          {month === 11 && (
            <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-gray-600">Last day to order for Christmas delivery:
              <select value={cutoff} onChange={(event) => setCutoff(Number(event.target.value))} className="!min-h-0 rounded-lg border border-gray-200 px-2 py-1 text-[12.5px] dark:border-slate-700 dark:bg-slate-900">
                {[18, 19, 20, 21, 22].map((day) => <option key={day} value={day}>{day} December</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-gray-100 px-5 py-3 dark:border-slate-800">
          {VERSIONS.map((v) => (
            <div key={v.key} className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800/60">
              <div className="text-[13px] font-bold text-gray-900 dark:text-slate-50">{v.label} <span className="text-[#5B3FD9]">{counts[v.key] ?? "…"}</span></div>
              <div className="text-[11.5px] text-gray-500">{v.who}</div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-[#F7F4FF] px-5 py-3 dark:border-slate-800 dark:bg-violet-500/10">
          <label className="flex items-center gap-2 text-[13px] font-bold text-gray-900 dark:text-slate-50"><input type="checkbox" className="h-4 w-4 accent-[#5B3FD9]" checked={ab} onChange={(event) => setAb(event.target.checked)} />A/B test every email</label>
          {ab && <>
            <label className="flex items-center gap-1.5 text-[12.5px] text-gray-700 dark:text-slate-300">Version B comes from
              <input value={person} onChange={(event) => setPerson(event.target.value)} maxLength={60} placeholder="e.g. Bright from ProTools"
                className="!min-h-0 w-[210px] rounded-lg border border-gray-200 bg-white px-2 py-1 text-[12.5px] dark:border-slate-700 dark:bg-slate-900" />
            </label>
            <span className="text-[12px] text-gray-500">Half get A (designed, from your business). Half get B: a plain note, short lowercase subject{person.trim() ? `, from "${person.trim()}"` : ""}. Compare clicks, not opens.</span>
          </>}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && <p className="m-0 mb-3 rounded-xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{error}</p>}
          <ul className="m-0 list-none space-y-2 p-0">
            {rows.map((row, index) => {
              const past = row.sendDay < today;
              const done = VERSIONS.every((v) => has(index, v));
              return (
                <li key={index} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${past ? "border-gray-100 opacity-50" : "border-gray-200 dark:border-slate-700"}`}>
                  <div className="w-[92px] shrink-0 text-[13px] font-bold text-gray-900 dark:text-slate-50">{nice(row.sendDay)}</div>
                  <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${PILLAR_STYLE[row.slot.pillar]}`}>{row.slot.tip ? "Helpful tip" : row.slot.pillar}</span>
                  <div className="mr-auto min-w-0">
                    <div className="text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.slot.title}</div>
                    <div className="truncate text-[12px] text-gray-500">A: {row.slot.store.subject.replace("{{First Name}}", "Ada")}</div>
                    {ab && <div className="truncate text-[12px] text-gray-500">B: {subjectB(row.slot, row.slot.store.subject).replace("{{First Name}}", "Ada")}</div>}
                    {row.moved && <div className="text-[11.5px] text-amber-700">Moved from {nice(row.day)}: another email already goes out that day.</div>}
                    {row.clash && <div className="text-[11.5px] text-amber-700">Another email also goes out this day.</div>}
                  </div>
                  {done ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-700"><Check className="h-3.5 w-3.5" />Scheduled</span>
                    : past ? <span className="text-[12px] text-gray-400">Day has passed</span> : null}
                  <button type="button" onClick={() => setPreview(index)} disabled={!designer} className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] font-semibold text-[#5B3FD9] dark:border-slate-700"><Eye className="h-4 w-4" />Preview</button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800">
          <span className="mr-auto text-[12.5px] text-gray-500">{todo.length} send{todo.length === 1 ? "" : "s"} left in {label} = {todo.length * 2} emails, at 8:00am</span>
          <button type="button" onClick={() => void schedule()} disabled={busy || !todo.length || !designer} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#5B3FD9] px-4 py-2.5 text-[14px] font-bold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{todo.length ? `Schedule ${label}` : "All Scheduled"}
          </button>
        </div>
      </div>
      {library && designer && (
        <EmailPreviewGallery title={`Tips Library: ${TIPS.length} helpful letters`}
          flows={[{ id: "tips", name: "Helpful tips", status: "draft", nodes: TIPS.map((tip) => ({ id: `tip-${tip.key}`, type: "email", name: `${tip.topic}: ${tip.title}`,
            email: { subject: tip.subject, preheader: tip.preheader, design: designOf(tipSlot(tip.key, tip), "store"), productId: null, thumbnailUrl: null } })) }]}
          onClose={() => setLibrary(false)} onEdit={() => setLibrary(false)} />
      )}
      {previewRow && preview !== null && (
        <EmailPreviewGallery title={`${nice(previewRow.sendDay)}: ${previewRow.slot.title}`}
          flows={[{ id: `plan-${preview}`, name: previewRow.slot.title, status: "draft", nodes: VERSIONS.flatMap((v) => {
            const words = v.key === "store" ? previewRow.slot.store : previewRow.slot.pod;
            const design = designOf(previewRow.slot, v.key);
            return [
              { id: `plan-${preview}-${v.key}`, type: "email" as const, name: `${v.label} · A (designed)`, email: { subject: words.subject, preheader: words.preheader, design, productId: null, thumbnailUrl: null } },
              ...(ab ? [{ id: `plan-${preview}-${v.key}-b`, type: "email" as const, name: `${v.label} · B (plain note${person.trim() ? `, from ${person.trim()}` : ""})`, email: { subject: subjectB(previewRow.slot, words.subject), preheader: words.preheader, design: asPersonalNote(design, person), productId: null, thumbnailUrl: null } }] : [])
            ];
          }) }]}
          onClose={() => setPreview(null)} onEdit={() => setPreview(null)} />
      )}
    </div>,
    document.body
  );
}
