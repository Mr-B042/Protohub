import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Archive, CalendarDays, ChevronLeft, ChevronRight, Clock, Copy, Crown, FileBarChart, Gift, Layers, LayoutGrid, List, MoreHorizontal, Pause, Pencil, Percent, Play, Plus,
  Search, Send, ShoppingCart, Tag, Ticket, Trash2, Undo2, Users, Zap
} from "lucide-react";
import DateWindowNav from "../../components/DateWindowNav";
import { emailMarketingApi, type EmDesigner, type EmOfferInput, type EmOfferRow, type EmOfferType, type EmOffersPage } from "../../lib/api";
import { presetRange, type DateWindow } from "../../lib/date-window";
import { ModalShell } from "./AudiencePage";
import { Card, Delta, Donut, ErrorNote, IconTile, Loading, Pill, btn, count, downloadCsv, input, lagosDate, naira, pct, select } from "./em-ui";

/**
 * Coupons & Offers, built to Bright's design 54 (8 Nov 2026). No code box on
 * the order form (Bright): an offer rides on an email, and the order form
 * shows the lower price to whoever comes from that email. Bundles and Free
 * Gifts come next (they take stock and cost).
 */

const TYPE_LOOK: Record<EmOfferType, { label: string; tone: string; icon: typeof Tag; color: string; donut: string }> = {
  discount: { label: "Discount", tone: "purple", icon: Percent, color: "text-[#5B3FD9]", donut: "#7C5CFF" },
  fixed: { label: "Fixed Discount", tone: "blue", icon: Tag, color: "text-sky-600", donut: "#0284C7" },
  flash: { label: "Flash Sale", tone: "purple", icon: Zap, color: "text-[#5B3FD9]", donut: "#B9A3FF" },
  loyalty: { label: "Loyalty", tone: "amber", icon: Crown, color: "text-amber-500", donut: "#F5B000" }
};
const STATE_LOOK: Record<string, { label: string; tone: string }> = {
  live: { label: "Active", tone: "green" }, scheduled: { label: "Scheduled", tone: "amber" }, expired: { label: "Expired", tone: "slate" },
  paused: { label: "Paused", tone: "amber" }, draft: { label: "Draft", tone: "slate" }, archived: { label: "Archived", tone: "slate" }
};
const TABS = [
  { key: "all", label: "All Offers", icon: Ticket }, { key: "coupons", label: "Coupons", icon: Ticket }, { key: "bundles", label: "Bundles", icon: Layers },
  { key: "flash", label: "Flash Sales", icon: Zap }, { key: "loyalty", label: "Loyalty", icon: Crown }, { key: "scheduled", label: "Scheduled", icon: CalendarDays }
] as const;
type TabKey = (typeof TABS)[number]["key"];
const PER_PAGE = 5;
const todayInLagos = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());

const DAY_MS = 86_400_000;
export const OFFER_TEMPLATES: Array<{ key: string; name: string; hint: string; input: () => EmOfferInput }> = [
  { key: "save10", name: "10% Off Coupon", hint: "10% off any order", input: () => blank({ name: "10% Off", type: "discount", benefit: "percent", value: 10, code: "SAVE10" }) },
  { key: "naira500", name: "₦500 Off", hint: "₦500 off orders of ₦10,000+", input: () => blank({ name: "₦500 Off", type: "fixed", benefit: "fixed", value: 500, code: "NAIRA500", minOrder: 10000 }) },
  { key: "flash", name: "Weekend Flash Sale", hint: "10% off for 3 days", input: () => blank({ name: "Weekend Flash Sale", type: "flash", benefit: "percent", value: 10, code: "FLASH10", endsAt: new Date(Date.now() + 3 * DAY_MS).toISOString() }) },
  { key: "loyalty", name: "Loyalty Reward", hint: "5% off for customers with 2+ delivered orders", input: () => blank({ name: "Loyalty Reward", type: "loyalty", benefit: "percent", value: 5, code: "LOYALTY5", minDelivered: 2 }) },
  { key: "big", name: "Big Order Discount", hint: "₦1,000 off orders of ₦30,000+", input: () => blank({ name: "Big Order Discount", type: "fixed", benefit: "fixed", value: 1000, code: "BIG1000", minOrder: 30000 }) }
];
function blank(patch: Partial<EmOfferInput> = {}): EmOfferInput {
  return { name: "", description: "", type: "discount", benefit: "percent", value: 10, code: "", minOrder: 0, productIds: [], minDelivered: 0, startsAt: null, endsAt: null, usageLimit: null, perCustomerLimit: 1, status: "active", ...patch };
}
const dateText = (row: EmOfferRow) => (row.startsAt || row.endsAt ? `${row.startsAt ? lagosDate(row.startsAt) : "Now"} – ${row.endsAt ? lagosDate(row.endsAt) : "Ongoing"}` : "Ongoing");

export default function OffersPage({ onToast, refreshKey }: { onToast: (message: string) => void; refreshKey: number }) {
  const todayKey = useMemo(todayInLagos, []);
  const [window_, setWindow] = useState<DateWindow>(() => presetRange("last30", todayKey));
  const [data, setData] = useState<EmOffersPage | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<"list" | "grid">("list");
  const [checked, setChecked] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; input: EmOfferInput } | null>(null);
  const [templates, setTemplates] = useState(false);
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await emailMarketingApi.offers({ from: window_.start, to: window_.end })); setError(""); }
    catch (err) { setError((err as Error).message || "Could not load the offers."); }
  }, [window_.start, window_.end]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { setPage(1); }, [tab, query, type, status]);
  const openEditor = async (id: string | null, offerInput: EmOfferInput) => {
    if (!designer) { try { setDesigner(await emailMarketingApi.designer()); } catch { /* products list stays empty */ } }
    setEditing({ id, input: offerInput });
  };

  const rows = useMemo(() => (data?.offers ?? [])
    .filter((row) => (status ? row.state === status : row.state !== "archived"))
    .filter((row) => tab === "all" || (tab === "coupons" ? row.type === "discount" || row.type === "fixed" : tab === "scheduled" ? row.state === "scheduled" : tab === "bundles" ? false : row.type === tab))
    .filter((row) => !type || row.type === type)
    .filter((row) => !query.trim() || `${row.name} ${row.code}`.toLowerCase().includes(query.trim().toLowerCase())), [data, tab, type, status, query]);
  const live = (data?.offers ?? []).filter((row) => row.state !== "archived");
  const tabCount = (key: TabKey) => (key === "all" ? live.length : key === "coupons" ? live.filter((row) => row.type === "discount" || row.type === "fixed").length : key === "scheduled" ? live.filter((row) => row.state === "scheduled").length : key === "bundles" ? 0 : live.filter((row) => row.type === key).length);
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const act = async (row: EmOfferRow, action: "launch" | "pause" | "resume" | "archive" | "unarchive" | "delete") => {
    setBusy(true);
    try {
      if (action === "delete") {
        if (!window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
        await emailMarketingApi.deleteOffer(row.id); onToast("Offer deleted.");
      } else {
        await emailMarketingApi.offerAction(row.id, action);
        onToast(action === "pause" ? "Paused: emails that carry it charge full price until you resume it." : action === "archive" ? "Archived." : action === "unarchive" ? "Back from the archive (paused)." : "Turned on.");
      }
      await load();
    } catch (err) { onToast((err as Error).message || "Could not change the offer."); }
    finally { setBusy(false); }
  };
  const bulk = async (action: "pause" | "resume" | "archive") => {
    const targets = live.filter((row) => checked.includes(row.id));
    setBusy(true);
    for (const row of targets) { try { await emailMarketingApi.offerAction(row.id, action); } catch { /* keep going */ } }
    setBusy(false); setChecked([]);
    onToast(`${targets.length} ${action === "pause" ? "paused" : action === "resume" ? "turned on" : "archived"}.`);
    await load();
  };
  const usageReport = async () => {
    try {
      const { rows: list } = await emailMarketingApi.offerUsage({ from: window_.start, to: window_.end });
      if (!list.length) { onToast("No order used an offer in these days."); return; }
      downloadCsv(`offer-usage-${window_.start}-to-${window_.end}.csv`, ["Date", "Offer", "Code", "Order", "Customer", "Phone", "Order status", "Before (₦)", "Discount (₦)", "Paid (₦)"],
        list.map((row) => [lagosDate(row.at, true), row.offer, row.code, row.orderId, row.customer, row.phone, row.status, row.before, row.discount, row.paid]));
    } catch (err) { onToast((err as Error).message || "Could not build the report."); }
  };
  const copyCode = async (code: string) => { try { await navigator.clipboard.writeText(code); onToast(`Copied ${code}.`); } catch { onToast(code); } };

  const k = data?.kpis;
  const totalRevenue = (data?.byType ?? []).reduce((sum, row) => sum + row.revenue, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Tag className="h-7 w-7" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Coupons &amp; Offers</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Create and manage discount codes, special offers, bundles, and promotional campaigns to drive more sales.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTemplates(true)} className={`${btn.ghost} !px-5 !py-3`}><Layers className="h-4 w-4 text-[#5B3FD9]" />Offer Templates</button>
          <button type="button" onClick={() => void openEditor(null, blank())} className={`${btn.primary} !px-5 !py-3`}><Plus className="h-4 w-4" />Create Offer</button>
        </div>
      </div>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {k && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Tile icon={Ticket} label="Active Offers" value={count(k.active.value)} chip={<Delta value={k.active.change} />} />
          <Tile icon={Percent} label="Total Redemptions" value={count(k.redemptions.value)} chip={<Delta value={k.redemptions.change} />} />
          <Tile icon={Users} label="Unique Customers" value={count(k.customers.value)} chip={<Delta value={k.customers.change} />} />
          <Tile icon={ShoppingCart} label="Revenue from Offers" value={naira(k.revenue.value)} chip={<Delta value={k.revenue.change} />} note="Delivered orders" />
          <Tile icon={Send} label="Conversion Lift" value={k.lift.value === null ? "—" : `${k.lift.value > 0 ? "+" : ""}${k.lift.value.toFixed(1)}pp`} chip={<Delta value={k.lift.changePp} suffix="pp" />}
            note={k.lift.value === null ? "Needs 20+ emails with and without offers" : "Orders per email: with an offer vs without"} />
        </div>
      )}

      {data && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <h3 className="m-0 w-full text-[18px] font-bold text-gray-900 dark:text-slate-50 lg:w-auto lg:min-w-[150px]">Create Offer Type</h3>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {([
              { type: "discount", label: "Discount Coupon", hint: "% off order value", icon: Percent, run: () => void openEditor(null, blank({ type: "discount", benefit: "percent", value: 10 })) },
              { type: "fixed", label: "Fixed Discount", hint: "₦ off order value", icon: Tag, run: () => void openEditor(null, blank({ type: "fixed", benefit: "fixed", value: 500 })) },
              { type: "bundle", label: "Bundle Offer", hint: "Buy more, save more", icon: Layers, off: "Comes next, with Free Gift: the free pieces come out of stock." },
              { type: "flash", label: "Flash Sale", hint: "Limited-time deal", icon: Zap, run: () => void openEditor(null, blank({ type: "flash", benefit: "percent", value: 10, endsAt: new Date(Date.now() + 3 * DAY_MS).toISOString() })) },
              { type: "gift", label: "Free Gift", hint: "Gift with purchase", icon: Gift, off: "Comes next, with Bundle: the gift comes out of stock and its cost counts." },
              { type: "loyalty", label: "Loyalty Offer", hint: "Reward loyal customers", icon: Crown, run: () => void openEditor(null, blank({ type: "loyalty", benefit: "percent", value: 5, minDelivered: 2 })) }
            ] as Array<{ type: string; label: string; hint: string; icon: typeof Tag; run?: () => void; off?: string }>).map((tile) => (
              <button key={tile.type} type="button" disabled={!!tile.off} title={tile.off} onClick={tile.run}
                className="!min-h-0 flex flex-col items-center gap-1 rounded-xl border border-gray-200 px-2 py-3 text-center hover:border-[#8B74EE] hover:bg-[#F7F4FF] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700">
                <IconTile><tile.icon className="h-5 w-5" /></IconTile>
                <span className="text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{tile.label}</span>
                <span className="text-[12px] text-gray-600 dark:text-slate-400">{tile.off ? "Next part" : tile.hint}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {data && (
        <>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Offer types">
            {TABS.map((row) => (
              <button key={row.key} type="button" onClick={() => setTab(row.key)} aria-current={tab === row.key ? "page" : undefined}
                className={`!min-h-0 inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-[14px] font-semibold ${tab === row.key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                <row.icon className="h-4 w-4" />{row.label} ({tabCount(row.key)})
              </button>
            ))}
          </nav>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2.7fr)_minmax(0,1fr)]">
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 p-4">
                <label className="relative min-w-[200px] flex-[2]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search offers (name or code)..." className={`${input} !py-2 !pl-9`} /></label>
                <select value={type} onChange={(event) => setType(event.target.value)} className={`${select} !w-[140px] !py-2`} aria-label="Type"><option value="">All Types</option>{(Object.keys(TYPE_LOOK) as EmOfferType[]).map((key) => <option key={key} value={key}>{TYPE_LOOK[key].label}</option>)}</select>
                <select value={status} onChange={(event) => setStatus(event.target.value)} className={`${select} !w-[140px] !py-2`} aria-label="Status">
                  <option value="">All Status</option><option value="live">Active</option><option value="scheduled">Scheduled</option><option value="expired">Expired</option><option value="paused">Paused</option><option value="draft">Draft</option><option value="archived">Archived</option>
                </select>
                <DateWindowNav variant="compact" value={window_} onChange={setWindow} todayKey={todayKey} />
              </div>
              {checked.length > 0 && (
                <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-[#F5F2FE] px-3 py-2 text-[13px] dark:bg-violet-500/10">
                  <span className="mr-auto font-semibold">{checked.length} selected</span>
                  <button type="button" disabled={busy} onClick={() => void bulk("pause")} className={btn.outline}><Pause className="h-3.5 w-3.5" />Pause</button>
                  <button type="button" disabled={busy} onClick={() => void bulk("resume")} className={btn.outline}><Play className="h-3.5 w-3.5" />Turn On</button>
                  <button type="button" disabled={busy} onClick={() => void bulk("archive")} className={btn.outline}><Archive className="h-3.5 w-3.5" />Archive</button>
                </div>
              )}
              {tab === "bundles" ? (
                <p className="m-0 px-4 pb-8 pt-2 text-center text-[13.5px] text-gray-600 dark:text-slate-400">Bundle offers (buy more, save more) come in the next part, with Free Gifts: the free pieces come out of stock, so that is set up first.</p>
              ) : view === "list" ? (
                <div className="overflow-x-auto">
                  <table className="!min-w-0 w-full min-w-[820px] text-left text-[13px]">
                    <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                      <th className="w-10 px-4 py-2.5"><input type="checkbox" aria-label="Select all on this page" className="h-4 w-4 accent-[#5B3FD9]" checked={shown.length > 0 && shown.every((row) => checked.includes(row.id))}
                        onChange={(event) => setChecked(event.target.checked ? [...new Set([...checked, ...shown.map((row) => row.id)])] : checked.filter((id) => !shown.some((row) => row.id === id)))} /></th>
                      <th className="px-2 py-2.5">Offer Name</th><th className="px-2 py-2.5">Code</th><th className="px-2 py-2.5">Type</th><th className="px-2 py-2.5">Discount/Benefit</th>
                      <th className="px-2 py-2.5 text-right">Redemptions</th><th className="px-2 py-2.5 text-right">Revenue</th><th className="px-2 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {shown.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-600 dark:text-slate-400">{live.length ? "No offer matches." : "No offers yet. Pick an offer type above, or start from a template."}</td></tr>}
                      {shown.map((row) => {
                        const look = TYPE_LOOK[row.type];
                        const st = STATE_LOOK[row.state] ?? STATE_LOOK.draft;
                        return (
                          <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                            <td className="px-4 py-2.5"><input type="checkbox" aria-label={`Select ${row.name}`} className="h-4 w-4 accent-[#5B3FD9]" checked={checked.includes(row.id)} onChange={(event) => setChecked(event.target.checked ? [...checked, row.id] : checked.filter((id) => id !== row.id))} /></td>
                            <td className="px-2 py-2.5">
                              <span className="flex items-center gap-2.5">
                                {row.imageUrl ? <img src={row.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" /> : <IconTile><look.icon className="h-5 w-5" /></IconTile>}
                                <span className="min-w-0"><span className="block max-w-[170px] truncate font-bold text-gray-900 dark:text-slate-50" title={row.name}>{row.name}</span><span className="flex items-center gap-1 text-[12px] text-gray-500"><CalendarDays className="h-3.5 w-3.5" />{dateText(row)}</span></span>
                              </span>
                            </td>
                            <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 font-mono text-[12px] font-bold text-gray-800 dark:bg-slate-800 dark:text-slate-200">{row.code}<button type="button" aria-label={`Copy ${row.code}`} onClick={() => void copyCode(row.code)} className="!min-h-0 text-gray-500 hover:text-[#5B3FD9]"><Copy className="h-3.5 w-3.5" /></button></span></td>
                            <td className="px-2 py-2.5"><Pill tone={look.tone}><look.icon className="h-3.5 w-3.5" />{look.label}</Pill></td>
                            <td className="px-2 py-2.5 font-semibold text-gray-900 dark:text-slate-50">{row.benefitText}{row.minOrder > 0 && <span className="block text-[11.5px] font-normal text-gray-500">on ₦{Math.round(row.minOrder).toLocaleString("en-NG")}+</span>}</td>
                            <td className="px-2 py-2.5 text-right font-semibold">{count(row.redemptions)}</td>
                            <td className="px-2 py-2.5 text-right font-bold">{naira(row.revenue)}</td>
                            <td className="px-2 py-2.5"><Pill tone={st.tone}>{st.label}</Pill></td>
                            <td className="px-3 py-2.5 text-right"><OfferMenu row={row} disabled={busy} onEdit={() => void openEditor(row.id, toInput(row))} onCopy={() => void copyCode(row.code)} onAct={(action) => void act(row, action)} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="grid gap-3 px-4 pb-2 sm:grid-cols-2">
                  {shown.map((row) => {
                    const look = TYPE_LOOK[row.type];
                    return (
                      <div key={row.id} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                        <div className="flex items-start gap-2"><IconTile size="sm"><look.icon className="h-4 w-4" /></IconTile><span className="min-w-0 flex-1 truncate font-bold text-gray-900 dark:text-slate-50">{row.name}</span><Pill tone={(STATE_LOOK[row.state] ?? STATE_LOOK.draft).tone}>{(STATE_LOOK[row.state] ?? STATE_LOOK.draft).label}</Pill></div>
                        <div className="mt-2 text-[20px] font-extrabold text-gray-900 dark:text-slate-50">{row.benefitText}</div>
                        <div className="mt-1 flex items-center justify-between text-[12.5px] text-gray-600 dark:text-slate-400"><span className="font-mono font-bold">{row.code}</span><span>{count(row.redemptions)} used · {naira(row.revenue)}</span></div>
                        <div className="mt-2 flex justify-end"><OfferMenu row={row} disabled={busy} onEdit={() => void openEditor(row.id, toInput(row))} onCopy={() => void copyCode(row.code)} onAct={(action) => void act(row, action)} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
              {tab !== "bundles" && rows.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px] text-gray-600 dark:text-slate-400">
                  <span>Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, rows.length)} of {rows.length} {rows.length === 1 ? "offer" : "offers"}</span>
                  <span className="flex items-center gap-1">
                    <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
                    {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 3), Math.max(0, page - 3) + 5).map((n) => (
                      <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined} className={`!min-h-0 h-9 min-w-9 rounded-lg px-2 text-[13px] font-semibold ${n === page ? "bg-[#5B3FD9] text-white" : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{n}</button>
                    ))}
                    <button type="button" aria-label="Next page" disabled={page === pages} onClick={() => setPage(page + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
                  </span>
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="m-0 mr-auto text-[18px] font-bold text-gray-900 dark:text-slate-50">Offer Performance</h3>
                  <span className="inline-flex rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
                    <button type="button" aria-label="List view" onClick={() => setView("list")} className={`!min-h-0 rounded-lg p-2 ${view === "list" ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><List className="h-4 w-4" /></button>
                    <button type="button" aria-label="Grid view" onClick={() => setView("grid")} className={`!min-h-0 rounded-lg p-2 ${view === "grid" ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><LayoutGrid className="h-4 w-4" /></button>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <Donut slices={data.byType.map((row) => ({ value: row.revenue, color: TYPE_LOOK[row.type].donut }))} size={150} stroke={20}>
                    <span className="text-[17px] font-extrabold text-gray-900 dark:text-slate-50">{naira(totalRevenue)}</span><span className="text-[11.5px] text-gray-500">Offer Revenue</span>
                  </Donut>
                  <ul className="m-0 min-w-[150px] flex-1 list-none space-y-1.5 p-0">
                    {data.byType.map((row) => (
                      <li key={row.type} className="flex items-center gap-2 text-[12.5px]">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: TYPE_LOOK[row.type].donut }} />
                        <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{TYPE_LOOK[row.type].label}</span>
                        <span className="font-semibold text-gray-900 dark:text-slate-50">{pct(totalRevenue ? (row.revenue / totalRevenue) * 100 : null)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {totalRevenue === 0 && <p className="m-0 mt-2 text-[12px] text-gray-500">Shows once orders that used an offer are delivered.</p>}
              </Card>
              <Card className="p-4">
                <h3 className="m-0 mb-2 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Zap className="h-5 w-5 text-[#5B3FD9]" />Quick Actions</h3>
                <div className="space-y-1.5">
                  {[
                    { icon: Plus, label: "Create New Offer", run: () => void openEditor(null, blank()) },
                    { icon: Layers, label: "Manage Offer Templates", run: () => setTemplates(true) },
                    { icon: Clock, label: `Expired Offers (${data.expired})`, run: () => { setTab("all"); setStatus("expired"); } },
                    { icon: FileBarChart, label: "Offer Usage Report", run: () => void usageReport() }
                  ].map((row) => (
                    <button key={row.label} type="button" onClick={row.run} className="!min-h-0 flex w-full items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 text-left text-[14px] font-semibold text-gray-900 hover:border-[#C9BEF5] hover:bg-[#F7F4FF] dark:border-slate-800 dark:text-slate-100">
                      <IconTile size="sm"><row.icon className="h-4 w-4" /></IconTile><span className="flex-1">{row.label}</span><ChevronRight className="h-4 w-4 text-gray-400" />
                    </button>
                  ))}
                </div>
              </Card>
              <p className="m-0 px-1 text-[12px] leading-snug text-gray-500">How customers get an offer: pick it in Create Campaign (Offer Details) or in an automation email. Whoever orders from that email sees the lower price on the order form, and the order is saved with it. The form looks the same for everyone else.</p>
            </div>
          </div>
        </>
      )}

      {editing && <OfferModal id={editing.id} initial={editing.input} designer={designer} onClose={() => setEditing(null)} onDone={async (message) => { setEditing(null); onToast(message); await load(); }} />}
      {templates && (
        <ModalShell title="Offer Templates" sub="Ready-made offers. Pick one and change anything before saving." onClose={() => setTemplates(false)} footer={<button type="button" onClick={() => setTemplates(false)} className={btn.ghost}>Close</button>}>
          <div className="space-y-2">
            {OFFER_TEMPLATES.map((row) => (
              <button key={row.key} type="button" onClick={() => { setTemplates(false); void openEditor(null, row.input()); }} className="!min-h-0 flex w-full items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 text-left hover:border-[#8B74EE] hover:bg-[#F7F4FF] dark:border-slate-700">
                <IconTile size="sm"><Ticket className="h-4 w-4" /></IconTile>
                <span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{row.hint}</span></span>
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </button>
            ))}
          </div>
        </ModalShell>
      )}
    </div>
  );
}

const toInput = (row: EmOfferRow): EmOfferInput => ({
  name: row.name, description: row.description, type: row.type, benefit: row.benefit, value: row.value, code: row.code, minOrder: row.minOrder, productIds: row.productIds,
  minDelivered: row.minDelivered, startsAt: row.startsAt, endsAt: row.endsAt, usageLimit: row.usageLimit, perCustomerLimit: row.perCustomerLimit, status: row.status === "draft" ? "draft" : "active"
});

function Tile({ icon: Icon, label, value, chip, note }: { icon: typeof Tag; label: string; value: string; chip?: React.ReactNode; note?: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <IconTile size="lg"><Icon className="h-6 w-6" /></IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug text-gray-600 dark:text-slate-400">{label}</div>
        <div className="flex flex-wrap items-center gap-x-2"><span className="text-[22px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{value}</span>{chip}</div>
        {note && <div className="text-[11.5px] leading-snug text-gray-500">{note}</div>}
      </div>
    </Card>
  );
}

function OfferMenu({ row, disabled, onEdit, onCopy, onAct }: { row: EmOfferRow; disabled: boolean; onEdit: () => void; onCopy: () => void; onAct: (action: "launch" | "pause" | "resume" | "archive" | "unarchive" | "delete") => void }) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true); };
  }, [at]);
  const items: Array<{ key: string; label: string; icon: typeof Tag; run: () => void; danger?: boolean }> = [
    { key: "edit", label: "Edit", icon: Pencil, run: onEdit },
    { key: "copy", label: "Copy Code", icon: Copy, run: onCopy },
    ...(row.status === "active" ? [{ key: "pause", label: "Pause", icon: Pause, run: () => onAct("pause") }] : []),
    ...(row.status === "paused" || row.status === "draft" ? [{ key: "resume", label: "Turn On", icon: Play, run: () => onAct(row.status === "draft" ? "launch" : "resume") }] : []),
    ...(row.status !== "archived" ? [{ key: "archive", label: "Archive", icon: Archive, run: () => onAct("archive") }] : [{ key: "unarchive", label: "Unarchive", icon: Undo2, run: () => onAct("unarchive") }]),
    ...(row.allTime === 0 ? [{ key: "delete", label: "Delete", icon: Trash2, run: () => onAct("delete"), danger: true }] : [])
  ];
  return (
    <>
      <button ref={button} type="button" disabled={disabled} aria-label={`More for ${row.name}`} onClick={(event) => {
        event.stopPropagation();
        const rect = button.current!.getBoundingClientRect();
        setAt(at ? null : { top: rect.bottom + 4, left: Math.min(window.innerWidth - 190, rect.right - 180) });
      }} className={btn.icon}><MoreHorizontal className="h-4 w-4" /></button>
      {at && createPortal(
        <div style={{ top: at.top, left: at.left }} className="fixed z-[80] w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
          {items.map((item) => (
            <button key={item.key} type="button" onClick={() => { setAt(null); item.run(); }} className={`!min-h-0 flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800 ${item.danger ? "text-rose-600" : "text-gray-700 dark:text-slate-200"}`}>
              <item.icon className="h-4 w-4" />{item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

/** Create / edit an offer. */
function OfferModal({ id, initial, designer, onClose, onDone }: { id: string | null; initial: EmOfferInput; designer: EmDesigner | null; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [form, setForm] = useState<EmOfferInput>(initial);
  const [codeTouched, setCodeTouched] = useState(!!initial.code);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EmOfferInput>) => setForm((current) => ({ ...current, ...patch }));
  const toLocal = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 3_600_000).toISOString().slice(0, 16) : "");
  const fromLocal = (value: string) => (value ? new Date(`${value}:00+01:00`).toISOString() : null);
  const products = designer?.products ?? [];
  const save = async (status: "draft" | "active") => {
    setBusy(true); setError("");
    try {
      const body = { ...form, status, code: form.code.trim().toUpperCase(), name: form.name.trim() };
      if (id) await emailMarketingApi.updateOffer(id, body); else await emailMarketingApi.createOffer(body);
      await onDone(id ? "Offer saved." : status === "active" ? `"${body.name}" is on. Pick it in Create Campaign or an automation email.` : "Saved as a draft.");
    } catch (err) {
      setError((err as Error).message || "Could not save the offer.");
      setBusy(false);
    }
  };
  const label = "block text-[13px] font-semibold text-gray-800 dark:text-slate-200";
  return (
    <ModalShell wide title={id ? "Edit Offer" : "Create Offer"} sub="An offer lowers the price for customers who order from an email that carries it." onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
        {!id && <button type="button" disabled={busy} onClick={() => void save("draft")} className={btn.ghost}>Save as Draft</button>}
        <button type="button" disabled={busy} onClick={() => void save("active")} className={btn.primary}>{busy ? "Saving…" : id ? "Save Offer" : "Save & Turn On"}</button>
      </>}>
      <ErrorNote message={error} />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(TYPE_LOOK) as EmOfferType[]).map((key) => {
            const look = TYPE_LOOK[key];
            return (
              <button key={key} type="button" aria-pressed={form.type === key} onClick={() => set({ type: key, ...(key === "fixed" ? { benefit: "fixed" } : key === "discount" ? { benefit: "percent" } : {}), ...(key === "loyalty" && form.minDelivered < 1 ? { minDelivered: 2 } : {}), ...(key === "flash" && !form.endsAt ? { endsAt: new Date(Date.now() + 3 * DAY_MS).toISOString() } : {}) })}
                className={`!min-h-0 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[13.5px] font-semibold ${form.type === key ? "border-[#8B74EE] bg-[#F5F2FE] text-[#5B3FD9]" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>
                <look.icon className="h-4 w-4" />{key === "discount" ? "Discount Coupon" : look.label === "Loyalty" ? "Loyalty Offer" : look.label}
              </button>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Offer Name *<input value={form.name} maxLength={120} onChange={(event) => set({ name: event.target.value, ...(codeTouched ? {} : { code: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16) }) })} placeholder="e.g. Weekend Flash Sale" className={`${input} mt-1.5`} /></label>
          <label className={label}>Code *<input value={form.code} maxLength={24} onChange={(event) => { setCodeTouched(true); set({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, "") }); }} placeholder="FLASH10" className={`${input} mt-1.5 font-mono uppercase`} />
            <span className="block text-[11.5px] font-normal text-gray-500">Shown on the order and in reports. Customers never type it.</span>
          </label>
          <div className={label}>Discount *
            <div className="mt-1.5 flex gap-2">
              {form.type !== "discount" && form.type !== "fixed" && (
                <select value={form.benefit} onChange={(event) => set({ benefit: event.target.value as "percent" | "fixed" })} className={`${select} !w-[120px]`} aria-label="Kind">
                  <option value="percent">% off</option><option value="fixed">₦ off</option>
                </select>
              )}
              <input type="number" min={1} max={form.benefit === "percent" ? 90 : undefined} value={form.value} onChange={(event) => set({ value: Number(event.target.value) || 0 })} className={input} aria-label="Value" />
              <span className="self-center text-[13px] font-semibold text-gray-600">{form.benefit === "percent" ? "%" : "₦"}</span>
            </div>
          </div>
          <label className={label}>Minimum Order (₦)<input type="number" min={0} value={form.minOrder || ""} onChange={(event) => set({ minOrder: Number(event.target.value) || 0 })} placeholder="No minimum" className={`${input} mt-1.5`} /></label>
          <label className={label}>Starts<input type="datetime-local" value={toLocal(form.startsAt)} onChange={(event) => set({ startsAt: fromLocal(event.target.value) })} className={`${input} mt-1.5`} /><span className="block text-[11.5px] font-normal text-gray-500">Empty = straight away (Lagos time)</span></label>
          <label className={label}>Ends {form.type === "flash" ? "*" : ""}<input type="datetime-local" value={toLocal(form.endsAt)} onChange={(event) => set({ endsAt: fromLocal(event.target.value) })} className={`${input} mt-1.5`} /><span className="block text-[11.5px] font-normal text-gray-500">{form.type === "flash" ? "A flash sale needs an end" : "Empty = ongoing"}</span></label>
          <label className={label}>Total Uses (optional)<input type="number" min={1} value={form.usageLimit ?? ""} onChange={(event) => set({ usageLimit: event.target.value ? Math.max(1, Math.round(Number(event.target.value))) : null })} placeholder="No limit" className={`${input} mt-1.5`} /></label>
          <label className={label}>Uses per Customer<input type="number" min={1} max={50} value={form.perCustomerLimit} onChange={(event) => set({ perCustomerLimit: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className={`${input} mt-1.5`} /><span className="block text-[11.5px] font-normal text-gray-500">By phone number. Each email works once.</span></label>
          {form.type === "loyalty" && (
            <label className={label}>Delivered Orders Needed *<input type="number" min={1} max={100} value={form.minDelivered} onChange={(event) => set({ minDelivered: Math.max(1, Math.round(Number(event.target.value) || 1)) })} className={`${input} mt-1.5`} /><span className="block text-[11.5px] font-normal text-gray-500">Customers with fewer pay the normal price.</span></label>
          )}
          <label className={`${label} sm:col-span-2`}>Description (optional)<input value={form.description} maxLength={200} onChange={(event) => set({ description: event.target.value })} className={`${input} mt-1.5`} /></label>
        </div>
        <div>
          <div className="mb-1.5 flex items-center gap-2"><span className={label}>Products</span><span className="text-[12px] text-gray-500">{form.productIds.length ? `${form.productIds.length} picked` : "All products"}</span></div>
          {products.length ? (
            <div className="flex max-h-[150px] flex-wrap gap-1.5 overflow-y-auto">
              {products.map((product) => {
                const on = form.productIds.includes(product.id);
                return <button key={product.id} type="button" aria-pressed={on} onClick={() => set({ productIds: on ? form.productIds.filter((idValue) => idValue !== product.id) : [...form.productIds, product.id] })}
                  className={`!min-h-0 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold ${on ? "border-[#8B74EE] bg-[#F5F2FE] text-[#5B3FD9]" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{product.name}</button>;
              })}
            </div>
          ) : <p className="m-0 text-[12.5px] text-gray-500">Applies to every product.</p>}
        </div>
      </div>
    </ModalShell>
  );
}
