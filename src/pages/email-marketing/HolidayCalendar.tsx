import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Check, Eye, Loader2, X } from "lucide-react";
import { emailMarketingApi, type EmAudience, type EmCampaign, type EmCampaignInput, type EmDesigner } from "../../lib/api";
import { buildHolidayDesign, type HolidayTier } from "../../lib/email-render";
import { HOLIDAYS, TIERS, holidayCampaignName, upcomingHolidays } from "./holidays";
import EmailPreviewGallery from "./EmailPreviewGallery";
import { DEFAULT_OPTIONS, priceText } from "./wizard-model";

/**
 * Holiday Calendar (Bright, 9 Nov 2026): every Nigerian holiday and festival
 * for the next 12 months. Scheduling one makes four campaigns, one per
 * customer group, that can't overlap: VIP (top 20% spenders) first, then
 * Loyal (2+ deliveries) and First-time (1 delivery) with the VIPs taken out,
 * then Everyone else (no delivery yet). Each sends at 8:00am Lagos on its day.
 */

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const nice = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
const SUBJECT: Record<HolidayTier, (title: string) => string> = {
  vip: (t) => `${t} A first look, just for you, {{First Name}}`,
  loyal: (t) => `${t} Picked for you, {{First Name}}`,
  first: (t) => `${t} Shop online, pay less, {{First Name}}`,
  everyone: (t) => `${t} {{First Name}}, celebrate with us`
};
const PREHEADER: Record<HolidayTier, string> = {
  vip: "Thank you for being one of our best customers", loyal: "Thank you for coming back to us", first: "Pay online, pay less", everyone: "Order today, pay on delivery"
};

export default function HolidayCalendar({ campaigns, onClose, onDone, onToast }: {
  campaigns: EmCampaign[];
  onClose: () => void;
  onDone: () => void;
  onToast: (message: string) => void;
}) {
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sendDay, setSendDay] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<HolidayTier, number | null>>({ vip: null, loyal: null, first: null, everyone: null });
  useEffect(() => { emailMarketingApi.designer().then(setDesigner).catch((err) => setError((err as Error).message || "Could not load.")); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !preview) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, preview]);

  const today = lagosToday();
  const list = useMemo(() => upcomingHolidays(today), [today]);
  const topId = designer?.segments.find((row) => row.builtIn === "top_spenders" && row.status === "active")?.id ?? null;
  const best = designer?.products.find((row) => row.image && row.links.length) ?? designer?.products[0];
  const names = new Set(campaigns.filter((row) => row.status !== "archived").map((row) => row.name));
  const scheduled = (h: (typeof list)[number]) => TIERS.every((tier) => names.has(holidayCampaignName(h, tier)));

  const audienceOf = (tier: HolidayTier): EmAudience => {
    const not = topId ? { exclude: { on: true, segmentId: topId } } : {};
    if (tier === "vip") return { source: "custom", custom: { name: "VIP (Top 20% Spenders)", match: "all", conditions: [{ field: "spend_top_percent", op: "top", value: 20 }] } };
    if (tier === "loyal") return { source: "custom", custom: { name: "Loyal (2+ deliveries, not VIP)", match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 2 }] }, ...not };
    if (tier === "first") return { source: "custom", custom: { name: "First-time (1 delivery, not VIP)", match: "all", conditions: [{ field: "purchase_count", op: "eq", value: 1 }] }, ...not };
    return { source: "custom", custom: { name: "Everyone else (no delivery yet)", match: "all", conditions: [{ field: "purchase_count", op: "eq", value: 0 }] } };
  };
  // How many people each version reaches today (the same counting the campaign uses).
  useEffect(() => {
    if (!designer) return;
    for (const tier of TIERS) {
      void emailMarketingApi.audiencePreview(audienceOf(tier.key)).then((res) => setCounts((prev) => ({ ...prev, [tier.key]: res.recipients }))).catch(() => undefined);
    }
  }, [designer, topId]); // eslint-disable-line react-hooks/exhaustive-deps

  const fields = () => ({ brand: designer?.sender.fromName || "Our Store", goal: "retention", offerType: "custom", productId: best?.id ?? "", productName: best?.name ?? "", productImage: best?.image ?? "",
    productLink: best?.links[0]?.url ?? "", productPrice: priceText(best), offerOn: false, offerTitle: "", offerBenefit: "" });
  const designsFor = (slug: string) => {
    const h = HOLIDAYS.find((row) => row.slug === slug)!;
    return TIERS.map((tier) => ({ tier, design: buildHolidayDesign(fields(), h, tier.key) }));
  };

  const schedule = async () => {
    if (!designer) return;
    if (!topId) { setError("The 'Top 20% Spenders' segment is missing, so VIPs can't be kept out of the other versions. Open Audience & Segments once and try again."); return; }
    setBusy(true); setError("");
    let made = 0;
    try {
      for (const h of list.filter((row) => picked.has(row.slug))) {
        const day = sendDay[h.slug] ?? h.sendDay;
        const sendAt = new Date(`${day}T08:00:00+01:00`).toISOString();
        for (const { tier, design } of designsFor(h.slug)) {
          const name = holidayCampaignName(h, tier);
          if (names.has(name)) continue;
          const input: EmCampaignInput = {
            name, goal: "retention", subject: SUBJECT[tier.key](h.title), subjectB: "", preheader: PREHEADER[tier.key], offerType: "custom",
            productId: tier.key === "everyone" ? best?.id ?? null : null, offer: { on: false, title: "", benefit: "" }, audience: audienceOf(tier.key), design,
            delivery: { type: "one_time", sendAt }, options: { ...DEFAULT_OPTIONS }, thumbnailUrl: null, offerId: null
          };
          const created = await emailMarketingApi.createCampaign(input);
          await emailMarketingApi.launch(created.id, false);
          made += 1;
        }
      }
      onToast(`Scheduled ${made} holiday emails.`);
      onDone();
    } catch (err) {
      setError(`${(err as Error).message || "Could not schedule."}${made ? ` (${made} were scheduled before this.)` : ""}`);
    } finally { setBusy(false); }
  };

  const previewItems = preview ? designsFor(preview) : [];
  const previewHoliday = list.find((row) => row.slug === preview);

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-label="Holiday Calendar">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5B3FD9] text-white"><CalendarDays className="h-5 w-5" /></span>
          <div className="mr-auto">
            <h2 className="m-0 text-[19px] font-extrabold text-gray-900 dark:text-slate-50">Holiday & Festival Calendar</h2>
            <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Each holiday goes out in four versions. Every customer gets exactly one (big spenders get only the VIP one).</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 border-b border-gray-100 px-5 py-3 sm:grid-cols-4 dark:border-slate-800">
          {TIERS.map((tier) => (
            <div key={tier.key} className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800/60">
              <div className="text-[13px] font-bold text-gray-900 dark:text-slate-50">{tier.label} <span className="text-[#5B3FD9]">{counts[tier.key] ?? "…"}</span></div>
              <div className="text-[11.5px] text-gray-500">{tier.who}{tier.key === "everyone" ? " · pay on delivery" : " · Our Store"}</div>
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {error && <p className="m-0 mb-3 rounded-xl bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700">{error}</p>}
          {!designer && !error && <p className="m-0 text-[13px] text-gray-500">Loading…</p>}
          <ul className="m-0 list-none space-y-2 p-0">
            {list.map((h) => {
              const done = scheduled(h);
              const on = picked.has(h.slug);
              return (
                <li key={h.slug} className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2.5 ${on ? "border-[#5B3FD9] bg-[#F7F4FF] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                  <input type="checkbox" checked={on || done} disabled={done || !designer} aria-label={`Schedule ${h.name}`}
                    onChange={() => setPicked((prev) => { const next = new Set(prev); if (next.has(h.slug)) next.delete(h.slug); else next.add(h.slug); return next; })} />
                  <img src={`/email-templates/${h.photo}.jpg`} alt="" className="h-11 w-14 rounded-lg object-cover" />
                  <div className="mr-auto min-w-0">
                    <div className="text-[14px] font-bold text-gray-900 dark:text-slate-50">{h.name} <span className="font-semibold text-gray-500">· {nice(h.day)}</span></div>
                    <div className="text-[12px] text-gray-500">
                      {h.note === "moon" ? "Expected date: it can move a day with the moon sighting. " : h.note === "varies" ? "The day differs by community/state: change the send day if needed. " : ""}
                      {h.sendBefore ? `Sent ${h.sendBefore} days early so orders arrive in time.` : "Sent on the day."}
                    </div>
                  </div>
                  {done ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-700"><Check className="h-3.5 w-3.5" />Scheduled</span> : (
                    <label className="flex items-center gap-1.5 text-[12px] text-gray-600">Send at 8am on
                      <input type="date" value={sendDay[h.slug] ?? h.sendDay} min={today} onChange={(event) => setSendDay((prev) => ({ ...prev, [h.slug]: event.target.value }))}
                        className="!min-h-0 rounded-lg border border-gray-200 px-2 py-1 text-[12.5px] dark:border-slate-700 dark:bg-slate-900" />
                    </label>
                  )}
                  <button type="button" onClick={() => setPreview(h.slug)} disabled={!designer} className="!min-h-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] font-semibold text-[#5B3FD9] dark:border-slate-700"><Eye className="h-4 w-4" />Preview</button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={() => setPicked(new Set(list.filter((h) => !scheduled(h)).map((h) => h.slug)))} disabled={!designer} className="!min-h-0 rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-300">Pick all</button>
          <span className="mr-auto text-[12.5px] text-gray-500">{picked.size} holiday{picked.size === 1 ? "" : "s"} picked = {picked.size * 4} emails</span>
          <button type="button" onClick={() => void schedule()} disabled={busy || !picked.size || !designer} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#5B3FD9] px-4 py-2.5 text-[14px] font-bold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}Schedule {picked.size ? `${picked.size} holiday${picked.size === 1 ? "" : "s"}` : ""}
          </button>
        </div>
      </div>
      {preview && previewHoliday && (
        <EmailPreviewGallery title={`${previewHoliday.name}: the 4 versions`}
          flows={[{ id: preview, name: previewHoliday.name, status: "draft", nodes: previewItems.map(({ tier, design }) => ({ id: `${preview}-${tier.key}`, type: "email", name: `${tier.label} (${tier.who})`, email: { subject: SUBJECT[tier.key](previewHoliday.title), preheader: PREHEADER[tier.key], design, productId: null, thumbnailUrl: null } })) }]}
          onClose={() => setPreview(null)} onEdit={() => setPreview(null)} />
      )}
    </div>,
    document.body
  );
}
