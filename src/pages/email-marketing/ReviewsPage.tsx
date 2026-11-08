import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Gift, Image as ImageIcon, Mail, Pencil, Play, Plus, Search, Send, Settings, Star, ThumbsUp,
  Users, Video, XCircle, Zap, type LucideIcon
} from "lucide-react";
import DateWindowNav from "../../components/DateWindowNav";
import { ReviewSheet } from "../../components/products-stock/ReviewsTab";
import { customerReviewsApi, type CustomerReview, type ReviewAmounts, type ReviewDashboard, type ReviewRequestRow } from "../../lib/api";
import { presetRange, type DateWindow } from "../../lib/date-window";
import { Avatar, Card, Delta, Donut, ErrorNote, IconTile, Loading, Pill, btn, count, input, lagosDate, naira, select } from "./em-ui";
import { MonthChart, RowMenu, Tile } from "./loyalty-ui";

/**
 * Reviews & UGC, built to Bright's design 56 (8 Nov 2026), over the existing
 * Customer Reviews (#937): the same reviews, approvals and rep bonus.
 * Bright's calls: the incentive card is the REP bonus ("Keep rep pay"), and a
 * customer can send a review through their own order's link ("Personal
 * review link"), emailed from Review Request or copied into WhatsApp.
 */

const TABS = [
  { key: "all", label: "All Reviews", icon: Star }, { key: "pending", label: "Pending", icon: Clock }, { key: "approved", label: "Approved", icon: CheckCircle2 },
  { key: "rejected", label: "Rejected", icon: XCircle }, { key: "ugc", label: "UGC Library", icon: ImageIcon }, { key: "request", label: "Review Request", icon: Send },
  { key: "incentives", label: "Incentives", icon: Gift }, { key: "analytics", label: "Analytics", icon: BarChart3 }
] as const;
type Tab = (typeof TABS)[number]["key"];
const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pending", tone: "amber" }, approved: { label: "Approved", tone: "green" }, rejected: { label: "Rejected", tone: "red" }, changes_requested: { label: "Asked to fix", tone: "orange" }
};
const PER_PAGE = 8;
const todayInLagos = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const dayMs = (day: string, end = false) => Date.parse(`${day}T00:00:00+01:00`) + (end ? 86_400_000 : 0);
const reviewMs = (row: CustomerReview) => Date.parse(row.submittedAt ?? row.createdAt);

function Stars({ value, size = 15 }: { value: number | null; size?: number }) {
  if (!value) return <span className="text-[12.5px] text-gray-400">No rating</span>;
  return <span className="inline-flex items-center gap-1 whitespace-nowrap" style={{ fontSize: size }}><span className="text-amber-400">{"★".repeat(value)}<span className="text-gray-300">{"★".repeat(5 - value)}</span></span><span className="text-[13px] font-semibold text-gray-700 dark:text-slate-300">{value.toFixed(1)}</span></span>;
}
const contentFiles = (row: CustomerReview) => row.files.filter((file) => file.part === "content");

export default function ReviewsPage({ onToast, refreshKey }: { onToast: (message: string) => void; refreshKey: number }) {
  const todayKey = useMemo(todayInLagos, []);
  const [window_, setWindow] = useState<DateWindow>(() => presetRange("last30", todayKey));
  const [tab, setTab] = useState<Tab>("all");
  const [reviews, setReviews] = useState<CustomerReview[] | null>(null);
  const [amounts, setAmounts] = useState<ReviewAmounts | null>(null);
  const [dash, setDash] = useState<ReviewDashboard | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [changed, setChanged] = useState(0);
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState("");
  const [rating, setRating] = useState("");
  const [type, setType] = useState("");
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const [list, numbers] = await Promise.all([customerReviewsApi.list(), customerReviewsApi.dashboard({ from: window_.start, to: window_.end })]);
      setReviews(list.reviews); setAmounts(list.amounts); setDash(numbers); setError("");
    } catch (err) { setError((err as Error).message || "Could not load the reviews."); }
  }, [window_.start, window_.end]);
  useEffect(() => { void load(); }, [load, refreshKey, changed]);
  useEffect(() => { setPage(1); }, [tab, query, product, rating, type, featuredOnly, window_.start, window_.end]);

  const fromMs = dayMs(window_.start), toMs = dayMs(window_.end, true);
  const listed = (reviews ?? [])
    .filter((row) => tab === "all" || (tab === "rejected" ? row.status === "rejected" || row.status === "changes_requested" : row.status === tab))
    .filter((row) => { const ms = reviewMs(row); return ms >= fromMs && ms < toMs; })
    .filter((row) => !product || row.productId === product)
    .filter((row) => !rating || (rating === "none" ? !row.rating : row.rating === Number(rating)))
    .filter((row) => !type || row.type === type)
    .filter((row) => !featuredOnly || row.featured)
    .filter((row) => !query.trim() || `${row.customer} ${row.orderId} ${row.productName} ${row.text}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(listed.length / PER_PAGE));
  const shown = listed.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const feature = async (row: CustomerReview, on: boolean) => {
    try { await customerReviewsApi.feature(row.id, on); onToast(on ? "Featured: it shows first." : "No longer featured."); setChanged((n) => n + 1); }
    catch (err) { onToast((err as Error).message || "Could not change it."); }
  };
  const k = dash?.kpis;
  const isReviewTab = tab === "all" || tab === "pending" || tab === "approved" || tab === "rejected";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Star className="h-7 w-7" /></span>
        <div className="min-w-[260px] flex-1">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Reviews &amp; UGC</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Collect, manage, and showcase customer reviews, photos, and videos (User-Generated Content) to build trust and boost sales.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTab("incentives")} className={`${btn.ghost} !px-5 !py-3`}><Settings className="h-4 w-4 text-[#5B3FD9]" />Review Settings</button>
          <button type="button" onClick={() => setTab("request")} className={`${btn.primary} !px-5 !py-3`}><Plus className="h-4 w-4" />Request Review</button>
        </div>
      </div>

      <ErrorNote message={error} />
      {!reviews && !error && <Loading />}
      {k && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Tile icon={Star} label="Total Reviews" value={count(k.total.value)} chip={<Delta value={k.total.change} />} note="In these days" />
          <Tile icon={Camera} label="Photo Reviews" value={count(k.photo.value)} chip={<Delta value={k.photo.change} />} />
          <Tile icon={Video} label="Video Reviews" value={count(k.video.value)} chip={<Delta value={k.video.change} />} />
          <Tile icon={ThumbsUp} label="Average Rating" value={k.rating.value === null ? "—" : <>{k.rating.value.toFixed(1)} / 5.0 <span className="text-amber-400">★</span></>} note={k.rating.rated ? `From ${count(k.rating.rated)} rated reviews` : "No star ratings yet"} />
          <Tile icon={Users} label="Reviewers" value={count(k.reviewers.value)} chip={<Delta value={k.reviewers.change} />} note="Different customers" />
        </div>
      )}

      {reviews && dash && (
        <>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Review sections">
            {TABS.map((row) => {
              const n = row.key === "pending" ? dash.counts.pending : row.key === "approved" ? dash.counts.approved : row.key === "rejected" ? dash.counts.rejected : null;
              return (
                <button key={row.key} type="button" onClick={() => setTab(row.key)} aria-current={tab === row.key ? "page" : undefined}
                  className={`!min-h-0 inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-[14px] font-semibold ${tab === row.key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                  <row.icon className="h-4 w-4" />{row.label}{n !== null ? ` (${count(n)})` : ""}
                </button>
              );
            })}
          </nav>

          {isReviewTab && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <Card className="min-w-0 overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <IconTile><Star className="h-5 w-5" /></IconTile>
                  <div className="min-w-0"><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Reviews ({count(listed.length)})</h3><p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Manage, approve, and feature customer reviews.</p></div>
                </div>
                <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                  <label className="relative min-w-[220px] flex-[2]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reviews (name, order ID, product)..." className={`${input} !py-2 !pl-9`} /></label>
                  <select value={product} onChange={(event) => setProduct(event.target.value)} className={`${select} !w-[150px] !py-2`} aria-label="Product"><option value="">All Products</option>{dash.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
                  <select value={rating} onChange={(event) => setRating(event.target.value)} className={`${select} !w-[130px] !py-2`} aria-label="Rating"><option value="">All Ratings</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}<option value="none">No rating</option></select>
                  <select value={type} onChange={(event) => setType(event.target.value)} className={`${select} !w-[120px] !py-2`} aria-label="Type"><option value="">All Types</option><option value="written">Written</option><option value="photo">Photo</option><option value="video">Video</option></select>
                  <DateWindowNav variant="compact" value={window_} onChange={setWindow} todayKey={todayKey} />
                  {featuredOnly && <button type="button" onClick={() => setFeaturedOnly(false)} className={btn.outline}>Featured only ×</button>}
                </div>
                <div className="overflow-x-auto">
                  <table className="!min-w-0 w-full min-w-[700px] text-left text-[13px]">
                    <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                      <th className="px-4 py-2.5">Customer / Order</th><th className="px-2 py-2.5">Product</th><th className="px-2 py-2.5">Rating</th><th className="px-2 py-2.5">Review &amp; Media</th>
                      <th className="px-2 py-2.5">Date</th><th className="px-2 py-2.5">Status</th><th className="py-2.5 pl-1 pr-4 text-right">Actions</th>
                    </tr></thead>
                    <tbody>
                      {shown.length === 0 && <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-600 dark:text-slate-400">No reviews here for these days. Ask for reviews from the Review Request tab.</td></tr>}
                      {shown.map((row) => {
                        const media = contentFiles(row);
                        const st = STATUS[row.status] ?? STATUS.pending;
                        return (
                          <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                            <td className="px-4 py-3"><span className="flex items-center gap-2.5"><Avatar name={row.customer || "C"} /><span className="min-w-0"><span className="block max-w-[120px] truncate font-bold text-gray-900 dark:text-slate-50">{row.customer || "Customer"}</span><span className="block text-[12px] text-gray-500">{row.orderId}</span></span></span></td>
                            <td className="px-2 py-3"><span className="block max-w-[96px] truncate text-gray-800 dark:text-slate-200" title={row.productName}>{row.productName || "—"}</span></td>
                            <td className="px-2 py-3"><Stars value={row.rating} /></td>
                            <td className="px-2 py-3">
                              {row.text && <span className="block max-w-[160px] truncate italic text-gray-800 dark:text-slate-200" title={row.text}>“{row.text}”</span>}
                              {media.length > 0 && (
                                <span className="mt-1 flex items-center gap-1">
                                  {media.slice(0, 2).map((file) => (
                                    <span key={file.id} className="relative inline-block h-9 w-9 overflow-hidden rounded-md bg-gray-100">
                                      {file.thumbUrl ? <img src={file.thumbUrl} alt="" className="h-full w-full object-cover" /> : null}
                                      {file.kind === "video" && <span className="absolute inset-0 flex items-center justify-center bg-black/30"><Play className="h-3.5 w-3.5 fill-white text-white" /></span>}
                                    </span>
                                  ))}
                                  {media.length > 2 && <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[#EEEBFC] text-[12px] font-bold text-[#5B3FD9]">+{media.length - 2}</span>}
                                </span>
                              )}
                              <span className="mt-1 flex flex-wrap gap-1">
                                {row.source === "customer" && <Pill tone="blue">From customer link</Pill>}
                                {row.featured && <Pill tone="purple">★ Featured</Pill>}
                                {row.legacy && <Pill tone="slate">From before</Pill>}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-2 py-3 text-gray-700 dark:text-slate-300">{lagosDate(row.submittedAt ?? row.createdAt)}</td>
                            <td className="px-2 py-3"><Pill tone={st.tone}>{st.label}</Pill></td>
                            <td className="py-3 pl-1 pr-4 text-right">
                              <RowMenu label={`More for ${row.customer}`} items={[
                                { key: "open", label: row.status === "pending" ? "Open & Decide" : "Open", icon: Pencil, run: () => setOpen(row.id) },
                                ...(row.status === "approved" && row.marketingOk ? [{ key: "feature", label: row.featured ? "Stop Featuring" : "Feature It", icon: Star, run: () => void feature(row, !row.featured) }] : [])
                              ]} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {listed.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px] text-gray-600 dark:text-slate-400">
                    <span>Showing {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, listed.length)} of {count(listed.length)} reviews</span>
                    <span className="flex items-center gap-1">
                      <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
                      <span className="px-2 font-semibold">Page {page} of {pages}</span>
                      <button type="button" aria-label="Next page" disabled={page === pages} onClick={() => setPage(page + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
                    </span>
                  </div>
                )}
              </Card>

              <div className="min-w-0 space-y-4">
                <Card className="p-4">
                  <h3 className="m-0 mb-2 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Gift className="h-5 w-5 text-[#5B3FD9]" />Review Performance</h3>
                  <MonthChart data={dash.monthly} series={[{ key: "reviews", label: "Reviews", color: "#7C5CFF", kind: "area", unit: "count" }]} height={190} empty="Shows once reviews come in." />
                </Card>
                {amounts && (
                  <Card className="p-4">
                    <div className="mb-3 flex items-start gap-2">
                      <Gift className="mt-0.5 h-5 w-5 text-[#5B3FD9]" />
                      <div className="mr-auto"><h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Review Bonus <span className="text-[13px] font-normal text-gray-500">(For Reps)</span></h3><p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Paid to the order's rep once per order when the review is approved.</p></div>
                      <button type="button" onClick={() => setTab("incentives")} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#5B3FD9]"><Pencil className="h-3.5 w-3.5" />Edit</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {([["written", "Written", Pencil], ["photo", "Photo", Camera], ["video", "Video", Video], ["premium", "Premium Video", Star]] as Array<[keyof ReviewAmounts, string, LucideIcon]>).map(([key, label, Icon]) => (
                        <div key={key} className="rounded-xl border border-gray-200 p-2.5 text-center dark:border-slate-700"><Icon className="mx-auto h-5 w-5 text-[#5B3FD9]" /><div className="text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">{label}</div><div className="text-[18px] font-extrabold text-gray-900 dark:text-slate-50">{naira(amounts[key])}</div></div>
                      ))}
                    </div>
                  </Card>
                )}
                <Card className="p-4">
                  <h3 className="m-0 mb-2 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Zap className="h-5 w-5 text-[#5B3FD9]" />Quick Actions</h3>
                  <div className="space-y-1.5">
                    {[
                      { icon: Send, label: "Send Review Request (Bulk)", run: () => setTab("request") },
                      { icon: ImageIcon, label: "Manage UGC Library (Photos & Videos)", run: () => setTab("ugc") },
                      { icon: Star, label: "Show Featured Reviews", run: () => { setTab("approved"); setFeaturedOnly(true); } },
                      { icon: BarChart3, label: "View Review Analytics & Reports", run: () => setTab("analytics") }
                    ].map((row) => (
                      <button key={row.label} type="button" onClick={row.run} className="!min-h-0 flex w-full items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 text-left text-[14px] font-semibold text-gray-900 hover:border-[#C9BEF5] hover:bg-[#F7F4FF] dark:border-slate-800 dark:text-slate-100">
                        <IconTile size="sm"><row.icon className="h-4 w-4" /></IconTile><span className="flex-1">{row.label}</span><ChevronRight className="h-4 w-4 text-gray-400" />
                      </button>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}
          {tab === "ugc" && <UgcLibrary reviews={reviews} onOpen={setOpen} onFeature={feature} />}
          {tab === "request" && <RequestTab onToast={onToast} links={dash.links} />}
          {tab === "incentives" && amounts && <IncentivesTab amounts={amounts} onToast={onToast} onSaved={() => setChanged((n) => n + 1)} />}
          {tab === "analytics" && <AnalyticsTab reviews={reviews} dash={dash} />}
        </>
      )}

      {open && <ReviewSheet reviewId={open} writable onClose={() => setOpen(null)} onChanged={() => setChanged((n) => n + 1)} onToast={onToast} />}
    </div>
  );
}

/** Approved photos and videos. Only the ones the customer allowed for marketing can be used outside. */
function UgcLibrary({ reviews, onOpen, onFeature }: { reviews: CustomerReview[]; onOpen: (id: string) => void; onFeature: (row: CustomerReview, on: boolean) => Promise<void> }) {
  const [onlyShareable, setOnlyShareable] = useState(true);
  const items = reviews.filter((row) => row.status === "approved" && (!onlyShareable || row.marketingOk))
    .flatMap((row) => contentFiles(row).map((file) => ({ row, file })));
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="mr-auto"><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">UGC Library ({count(items.length)})</h3><p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Customers' approved photos and videos.</p></div>
        <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-gray-700 dark:text-slate-300"><input type="checkbox" checked={onlyShareable} onChange={(event) => setOnlyShareable(event.target.checked)} className="h-4 w-4 accent-[#5B3FD9]" />Only ones we may share</label>
      </div>
      {items.length === 0 ? (
        <p className="m-0 rounded-xl bg-gray-50 px-4 py-10 text-center text-[14px] text-gray-600 dark:bg-slate-800/40 dark:text-slate-400">{onlyShareable ? "No approved photo or video that the customer allowed for marketing yet." : "No approved photos or videos yet."}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {items.map(({ row, file }) => (
            <div key={file.id} className="overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700">
              <button type="button" onClick={() => onOpen(row.id)} className="!min-h-0 relative block aspect-square w-full bg-gray-100 dark:bg-slate-800">
                {file.thumbUrl && <img src={file.thumbUrl} alt="" className="h-full w-full object-cover" />}
                {file.kind === "video" && <span className="absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/50 p-2"><Play className="h-5 w-5 fill-white text-white" /></span></span>}
                {row.featured && <span className="absolute left-1.5 top-1.5 rounded-md bg-[#5B3FD9] px-1.5 py-0.5 text-[11px] font-bold text-white">★ Featured</span>}
                {!row.marketingOk && <span className="absolute right-1.5 top-1.5 rounded-md bg-gray-900/70 px-1.5 py-0.5 text-[11px] font-bold text-white">Private</span>}
              </button>
              <div className="p-2">
                <div className="truncate text-[12.5px] font-bold text-gray-900 dark:text-slate-50">{row.productName || "Product"}</div>
                <div className="flex items-center justify-between gap-1 text-[12px] text-gray-500"><Stars value={row.rating} size={11} />
                  {row.marketingOk && <button type="button" onClick={() => void onFeature(row, !row.featured)} className="!min-h-0 font-semibold text-[#5B3FD9]">{row.featured ? "Unfeature" : "Feature"}</button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Delivered orders without a review: email the customer's own link, or copy it for WhatsApp. */
function RequestTab({ onToast, links }: { onToast: (message: string) => void; links: ReviewDashboard["links"] }) {
  const [rows, setRows] = useState<ReviewRequestRow[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await customerReviewsApi.requests()).orders); setError(""); }
    catch (err) { setError((err as Error).message || "Could not load the orders."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const copy = async (row: ReviewRequestRow) => {
    try {
      const { url } = await customerReviewsApi.link(row.id);
      const message = `Hi ${row.customer.split(" ")[0] || "there"}, thank you for your order! How is your ${row.productName || "order"}? It would mean a lot if you left a quick review (photos welcome): ${url}`;
      await navigator.clipboard.writeText(message).catch(() => undefined);
      onToast("Message with the review link copied. Paste it into WhatsApp.");
      await load();
    } catch (err) { onToast((err as Error).message || "Could not make the link."); }
  };
  const email = async (ids: string[]) => {
    setBusy(true);
    try {
      const result = await customerReviewsApi.emailRequests(ids);
      onToast(`${result.sent} sent${result.noEmail ? ` · ${result.noEmail} without an email` : ""}${result.unsubscribed ? ` · ${result.unsubscribed} unsubscribed (skipped)` : ""}${result.failed ? ` · ${result.failed} failed` : ""}.`);
      setPicked([]); await load();
    } catch (err) { onToast((err as Error).message || "Could not send."); }
    finally { setBusy(false); }
  };
  const shown = (rows ?? []).filter((row) => !query.trim() || `${row.customer} ${row.id} ${row.productName}`.toLowerCase().includes(query.trim().toLowerCase()));
  const withEmail = shown.filter((row) => row.hasEmail);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="mr-auto min-w-0"><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Review Request</h3><p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Delivered in the last 60 days, no review yet. Each order has its own link: the customer rates, writes and adds photos or a video, and it waits here for approval.</p></div>
        <label className="relative min-w-[200px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer, order, product..." className={`${input} !py-2 !pl-9`} /></label>
        <button type="button" disabled={busy || !(picked.length || withEmail.length)} onClick={() => void email(picked.length ? picked : withEmail.map((row) => row.id))} className={btn.primary}><Mail className="h-4 w-4" />{picked.length ? `Email ${picked.length} Picked` : `Email All With an Email (${withEmail.length})`}</button>
      </div>
      <p className="m-0 px-4 pb-3 text-[12.5px] text-gray-500">In these days: {count(links.made)} links made · {count(links.emailed)} emailed · {count(links.opened)} opened. Most customers have no email yet, so "Copy for WhatsApp" is the main way.</p>
      <ErrorNote message={error} />
      {!rows && !error && <div className="px-4 pb-4"><Loading /></div>}
      {rows && (
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full min-w-[760px] text-left text-[13px]">
            <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
              <th className="w-10 px-4 py-2.5" /><th className="px-2 py-2.5">Customer / Order</th><th className="px-2 py-2.5">Product</th><th className="px-2 py-2.5">Delivered</th><th className="px-2 py-2.5">Asked</th><th className="px-3 py-2.5 text-right">Actions</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600 dark:text-slate-400">Every delivered order from the last 60 days already has a review.</td></tr>}
              {shown.slice(0, 150).map((row) => (
                <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                  <td className="px-4 py-2.5"><input type="checkbox" disabled={!row.hasEmail} aria-label={`Pick ${row.customer}`} checked={picked.includes(row.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, row.id] : picked.filter((id) => id !== row.id))} className="h-4 w-4 accent-[#5B3FD9]" /></td>
                  <td className="px-2 py-2.5"><span className="block font-bold text-gray-900 dark:text-slate-50">{row.customer}</span><span className="block text-[12px] text-gray-500">{row.id}{row.hasEmail ? " · has email" : ""}</span></td>
                  <td className="px-2 py-2.5"><span className="block max-w-[180px] truncate">{row.productName}</span></td>
                  <td className="px-2 py-2.5 whitespace-nowrap">{lagosDate(row.deliveredOn ? `${row.deliveredOn}T12:00:00+01:00` : null)}</td>
                  <td className="px-2 py-2.5">{row.openedAt ? <Pill tone="green">Opened</Pill> : row.emailedAt ? <Pill tone="blue">Emailed</Pill> : row.copiedAt ? <Pill tone="purple">Link copied</Pill> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2.5"><span className="flex justify-end gap-1.5">
                    <button type="button" onClick={() => void copy(row)} className={btn.outline}><Copy className="h-3.5 w-3.5" />Copy for WhatsApp</button>
                    {row.hasEmail && <button type="button" disabled={busy} onClick={() => void email([row.id])} className={btn.outline}><Mail className="h-3.5 w-3.5" />Email</button>}
                  </span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** The rep bonus amounts (Bright: "Keep rep pay"). */
function IncentivesTab({ amounts, onToast, onSaved }: { amounts: ReviewAmounts; onToast: (message: string) => void; onSaved: () => void }) {
  const [form, setForm] = useState(amounts);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { customerReviewsApi.settings().then((row) => setCanEdit(row.canEdit)).catch(() => undefined); }, []);
  const save = async () => {
    setBusy(true);
    try { await customerReviewsApi.saveSettings(form); onToast("Review bonus saved. New approvals use it; past ones keep theirs."); onSaved(); }
    catch (err) { onToast((err as Error).message || "Could not save."); }
    finally { setBusy(false); }
  };
  return (
    <Card className="max-w-3xl p-5">
      <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Review Bonus (For Reps)</h3>
      <p className="m-0 mt-1 text-[13.5px] text-gray-600 dark:text-slate-400">Paid to the order's rep once per order, at the highest level approved, on the weekly report of the week it is approved. Reviews customers send through their link pay the rep too. Customers get no money.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {([["written", "Written"], ["photo", "Photo"], ["video", "Video"], ["premium", "Premium video"]] as Array<[keyof ReviewAmounts, string]>).map(([key, label]) => (
          <label key={key} className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">{label} (₦)
            <input type="number" min={0} disabled={!canEdit} value={form[key]} onChange={(event) => setForm({ ...form, [key]: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={`${input} mt-1.5`} />
          </label>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        {canEdit ? <button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}><Check className="h-4 w-4" />{busy ? "Saving…" : "Save Bonus"}</button> : <span className="text-[13px] text-gray-500">Only the Owner or an Admin can change these.</span>}
      </div>
    </Card>
  );
}

function AnalyticsTab({ reviews, dash }: { reviews: CustomerReview[]; dash: ReviewDashboard }) {
  const decided = reviews.filter((row) => row.status !== "pending");
  const rated = reviews.filter((row) => row.rating);
  const byStars = [5, 4, 3, 2, 1].map((n) => ({ n, count: rated.filter((row) => row.rating === n).length }));
  const byType = [["written", "Written", "#B9A3FF"], ["photo", "Photo", "#7C5CFF"], ["video", "Video", "#0D9488"]] as const;
  const products = [...reviews.reduce((map, row) => {
    const key = row.productName || "Other"; const item = map.get(key) ?? { name: key, count: 0, sum: 0, rated: 0 };
    item.count += 1; if (row.rating) { item.sum += row.rating; item.rated += 1; } map.set(key, item); return map;
  }, new Map<string, { name: string; count: number; sum: number; rated: number }>()).values()].sort((a, b) => b.count - a.count).slice(0, 8);
  const approvedShare = decided.length ? Math.round((reviews.filter((row) => row.status === "approved").length / decided.length) * 100) : null;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="p-4">
        <h3 className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Stars given</h3>
        {rated.length === 0 ? <p className="m-0 text-[13px] text-gray-500">No star ratings yet. Reviews sent through customer links always have one.</p> : byStars.map((row) => (
          <div key={row.n} className="mb-2 flex items-center gap-2 text-[13px]"><span className="w-12 text-amber-400">{"★".repeat(row.n)}</span><span className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-[#7C5CFF]" style={{ width: `${(row.count / rated.length) * 100}%` }} /></span><span className="w-8 text-right font-semibold">{row.count}</span></div>
        ))}
      </Card>
      <Card className="p-4">
        <h3 className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Kinds of review</h3>
        <div className="flex items-center gap-4">
          <Donut slices={byType.map(([key, , color]) => ({ value: reviews.filter((row) => row.type === key).length, color }))} size={130} stroke={18}><span className="text-[18px] font-extrabold">{count(reviews.length)}</span><span className="text-[11px] text-gray-500">Reviews</span></Donut>
          <ul className="m-0 list-none space-y-1.5 p-0">{byType.map(([key, label, color]) => <li key={key} className="flex items-center gap-2 text-[13px]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{label}<b className="ml-auto pl-3">{reviews.filter((row) => row.type === key).length}</b></li>)}</ul>
        </div>
        <p className="m-0 mt-3 text-[12.5px] text-gray-600 dark:text-slate-400">Approved: {approvedShare === null ? "—" : `${approvedShare}% of decided reviews`} · From customer links: {count(reviews.filter((row) => row.source === "customer").length)}</p>
      </Card>
      <Card className="p-4">
        <h3 className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Reviews by product</h3>
        <ul className="m-0 list-none space-y-2 p-0">{products.map((row) => <li key={row.name} className="flex items-center gap-2 text-[13px]"><span className="min-w-0 flex-1 truncate">{row.name}</span><span className="text-amber-500">{row.rated ? `${(row.sum / row.rated).toFixed(1)} ★` : ""}</span><b className="w-8 text-right">{row.count}</b></li>)}</ul>
      </Card>
      <Card className="p-4 xl:col-span-3">
        <h3 className="m-0 mb-2 text-[16px] font-bold text-gray-900 dark:text-slate-50">Reviews by month</h3>
        <MonthChart data={dash.monthly} series={[{ key: "reviews", label: "Reviews", color: "#7C5CFF", kind: "bar", unit: "count" }]} height={200} empty="Shows once reviews come in." />
      </Card>
    </div>
  );
}
