import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, PhoneCall, ShieldAlert, ShieldCheck } from "lucide-react";
import { cartsApi, type CartIntegrityView, type CartInterestedRow, type CartSpotCheck } from "../../lib/api";

// ── Cart follow-up "Check this" panel (Bright, 24 Nov 2026 audit) ───────────
// Shown above the cart charges so the Owner sees HOW the logs were made before
// approving them. Patterns are worked out on the server
// (backend/src/lib/cart-log-integrity.ts). A flag is a reason to look, not
// proof: the weekly spot-checks below are how a flag gets confirmed.

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const shift = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sunday = (key: string) => shift(key, -new Date(`${key}T12:00:00Z`).getUTCDay());
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const RANGES = [{ days: 7, label: "Last 7 days" }, { days: 14, label: "Last 14 days" }, { days: 30, label: "Last 30 days" }];
const LEVEL: Record<"high" | "medium" | "low", { label: string; tone: string }> = {
  high: { label: "High chance", tone: "bg-rose-100 text-rose-800 ring-rose-200" },
  medium: { label: "Look closer", tone: "bg-amber-100 text-amber-800 ring-amber-200" },
  low: { label: "Looks genuine", tone: "bg-emerald-100 text-emerald-800 ring-emerald-200" }
};
const SPOT_LABEL: Record<CartSpotCheck["status"], string> = { pending: "Not called yet", confirmed: "Customer confirms the call", denied: "Customer says nobody called", unreachable: "Could not reach customer" };

export function CartIntegrityPanel({ onViewCart }: { onViewCart: (cartId: string) => void }) {
  const [open, setOpen] = useState(true);
  const [days, setDays] = useState(7);
  const [view, setView] = useState<CartIntegrityView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [repOpen, setRepOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const to = lagosToday();
    setLoading(true); setError("");
    cartsApi.integrity({ from: shift(to, -(days - 1)), to })
      .then((v) => { if (!cancelled) setView(v); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Could not check the logs."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days, open]);

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <button type="button" onClick={() => setOpen((o) => !o)} className="!min-h-0 flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <ShieldAlert className="h-4 w-4 text-rose-600" />
        <span className="text-[13px] font-black text-gray-900 dark:text-slate-100">Check this before approving</span>
        <span className="text-[11.5px] text-gray-500">How the follow-ups were logged: rushed, copied, untouched or without a call</span>
        {open ? <ChevronDown className="ml-auto h-4 w-4 text-gray-400" /> : <ChevronRight className="ml-auto h-4 w-4 text-gray-400" />}
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-3 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {RANGES.map((r) => (
              <button key={r.days} type="button" onClick={() => setDays(r.days)}
                className={`!min-h-0 rounded-lg px-2.5 py-1 text-[12px] font-bold ${days === r.days ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{r.label}</button>
            ))}
            {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
          {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800">{error}</p>}
          {view && view.reps.length === 0 && !loading && <p className="m-0 text-[12.5px] text-gray-500">No follow-ups logged in this period.</p>}
          {view && view.reps.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="w-full !min-w-[860px] text-[12px]">
                <thead className="bg-gray-50 text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800">
                  <tr>
                    <th className="px-3 py-2">Rep</th>
                    <th className="px-2 py-2 text-right" title="Logs after removing double-saves">Logs</th>
                    <th className="px-2 py-2 text-right" title="5+ different carts at under a minute each">Rushed</th>
                    <th className="px-2 py-2 text-right" title="Interested / Not interested saved under a minute after the previous cart">Too-quick talks</th>
                    <th className="px-2 py-2 text-right" title="Interested, not reached, no note: the old pre-filled form saved as it was">Untouched</th>
                    <th className="px-2 py-2 text-right" title="Same words as an earlier day's log on the same cart">Copied words</th>
                    <th className="px-2 py-2 text-right" title="Outcome and 'spoke to them' disagree">Don't add up</th>
                    <th className="px-2 py-2 text-right" title="Logs with no Call / WhatsApp tap first (since taps began)">No call tap</th>
                    <th className="px-2 py-2 text-right" title="Saved at 6pm or later">After 6pm</th>
                    <th className="px-2 py-2 text-right" title="Carts logged Interested that became orders">Interested → order</th>
                    <th className="px-2 py-2 text-right" title="Spot-check call-backs where the customer said nobody called">Denied</th>
                    <th className="px-3 py-2">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {view.reps.map((r) => {
                    const pct = (x: number) => (r.logs ? Math.round((x / r.logs) * 100) : 0);
                    const cell = (x: number, warnAt: number, title?: string) => (
                      <td className={`px-2 py-2 text-right tabular-nums ${x > 0 && pct(x) >= warnAt ? "font-bold text-rose-700" : x > 0 ? "text-gray-800 dark:text-slate-200" : "text-gray-300"}`} title={title}>{x || "–"}</td>
                    );
                    const flagged = view.flagged.filter((f) => f.repId === r.repId);
                    return (
                      <FragmentRow key={r.repId}>
                        <tr className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800/50" onClick={() => setRepOpen(repOpen === r.repId ? null : r.repId)}>
                          <td className="px-3 py-2 font-semibold text-gray-900 dark:text-slate-100">
                            <span className="inline-flex items-center gap-1"><ChevronRight className={`h-3.5 w-3.5 text-gray-400 transition-transform ${repOpen === r.repId ? "rotate-90" : ""}`} />{r.repName}</span>
                            {r.duplicates > 0 && <span className="block pl-[18px] text-[10.5px] font-medium text-gray-400">{r.duplicates} double-saves left out</span>}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">{r.logs}</td>
                          {cell(r.rushedCarts, 10, `${r.rushedSittings} sitting(s)`)}
                          {cell(r.quickConversations, 5)}
                          {cell(r.untouched, 5)}
                          {cell(r.repeatedWords, 5)}
                          {cell(r.contradictions, 10)}
                          <td className={`px-2 py-2 text-right tabular-nums ${r.noTap > 0 ? "font-bold text-rose-700" : "text-gray-300"}`}>{r.tapChecked ? `${r.noTap} of ${r.tapChecked}` : "–"}</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${r.latePct >= 30 ? "font-bold text-amber-700" : "text-gray-600"}`}>{r.latePct}%</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${r.saidInterested >= 5 && r.interestedBecameOrders / r.saidInterested < 0.35 ? "font-bold text-rose-700" : "text-gray-600"}`}>{r.saidInterested ? `${r.interestedBecameOrders} of ${r.saidInterested}` : "–"}</td>
                          <td className={`px-2 py-2 text-right tabular-nums ${r.spotDenied > 0 ? "font-bold text-rose-700" : "text-gray-300"}`}>{r.spotChecked ? `${r.spotDenied} of ${r.spotChecked}` : "–"}</td>
                          <td className="px-3 py-2"><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ${LEVEL[r.level].tone}`}>{LEVEL[r.level].label}</span></td>
                        </tr>
                        {repOpen === r.repId && (
                          <tr className="bg-slate-50/70 dark:bg-slate-800/40">
                            <td colSpan={12} className="px-4 py-3">
                              {view.sittings.filter((s) => s.repId === r.repId).length > 0 && (
                                <div className="mb-3">
                                  <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">Rushed sittings</p>
                                  <ul className="m-0 list-none space-y-1 p-0">
                                    {view.sittings.filter((s) => s.repId === r.repId).map((s) => (
                                      <li key={s.startedAt} className="text-[12px] text-gray-800 dark:text-slate-200">
                                        <b>{s.carts} carts</b> in {Math.max(1, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000))} min ({s.secondsPerCart}s each) · {when(s.startedAt)} · <span className="text-gray-500">{s.outcomes.join(", ")}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              <p className="m-0 mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-500">Flagged logs ({flagged.length})</p>
                              {flagged.length === 0 ? <p className="m-0 text-[12px] text-gray-500">Nothing flagged in this period.</p> : (
                                <ul className="m-0 max-h-72 list-none space-y-1.5 overflow-y-auto p-0 pr-1">
                                  {flagged.slice(0, 80).map((f) => (
                                    <li key={f.id} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                                      <div className="flex flex-wrap items-center gap-x-2">
                                        <span className="font-semibold text-gray-900 dark:text-slate-100">{f.outcome}{f.custom ? ` · ${f.custom}` : ""}</span>
                                        <span className="text-gray-500">{when(f.savedAt)}</span>
                                        <button type="button" onClick={() => onViewCart(f.cartId)} className="!min-h-0 ml-auto text-[11.5px] font-semibold text-[#1F8FE0]">View cart</button>
                                      </div>
                                      {f.note && <div className="italic text-gray-600">“{f.note}”</div>}
                                      <div className="mt-0.5 flex flex-wrap gap-1">{f.reasons.map((why) => <span key={why} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-700">{why}</span>)}</div>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 flex items-start gap-1.5 text-[11px] text-gray-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />A flag is a reason to look, not proof. Confirm with the spot-checks: if customers say nobody called, the logs were not real.</p>
          <SpotChecks />
          <InterestedNotOrdered onViewCart={onViewCart} />
        </div>
      )}
    </section>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

/** Each week: up to 3 random logged customers per rep, for a manager to call back. */
function SpotChecks() {
  const [week, setWeek] = useState(() => sunday(lagosToday()));
  const [rows, setRows] = useState<CartSpotCheck[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setRows(null); setError("");
    cartsApi.spotChecks(week).then((r) => { if (!cancelled) setRows(r.rows); }).catch((e: any) => { if (!cancelled) setError(e?.message ?? "Could not load the spot checks."); });
    return () => { cancelled = true; };
  }, [week]);

  const save = async (row: CartSpotCheck, status: CartSpotCheck["status"]) => {
    setSaving(row.id);
    try {
      const { row: saved } = await cartsApi.saveSpotCheck(row.id, { status, note: notes[row.id] ?? row.resultNote ?? "" });
      setRows((list) => (list ?? []).map((r) => (r.id === row.id ? saved : r)));
    } catch (e: any) { setError(e?.message ?? "Could not save."); } finally { setSaving(null); }
  };
  const byRep = useMemo(() => {
    const m = new Map<string, CartSpotCheck[]>();
    for (const r of rows ?? []) m.set(r.repName ?? "Sales rep", [...(m.get(r.repName ?? "Sales rep") ?? []), r]);
    return [...m];
  }, [rows]);
  const isThisWeek = week === sunday(lagosToday());

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 dark:border-sky-500/30 dark:bg-sky-500/5">
      <div className="flex flex-wrap items-center gap-2">
        <PhoneCall className="h-4 w-4 text-sky-700" />
        <span className="text-[13px] font-black text-gray-900 dark:text-slate-100">Spot-check calls</span>
        <span className="text-[11.5px] text-gray-600">3 random logged customers per rep each week. Call them and ask: "Did someone from us call you about your order?" Reps never see this list.</span>
        <span className="ml-auto inline-flex items-center gap-1">
          <button type="button" onClick={() => setWeek(shift(week, -7))} className="!min-h-0 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[12px] font-semibold">‹</button>
          <span className="text-[12px] font-semibold text-gray-700">Week of {new Date(`${week}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
          <button type="button" disabled={isThisWeek} onClick={() => setWeek(shift(week, 7))} className="!min-h-0 rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[12px] font-semibold disabled:opacity-40">›</button>
        </span>
      </div>
      {error && <p className="m-0 mt-2 text-[12px] text-rose-700">{error}</p>}
      {rows === null && !error && <p className="m-0 mt-2 flex items-center gap-1.5 text-[12px] text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Picking this week's customers…</p>}
      {rows && rows.length === 0 && <p className="m-0 mt-2 text-[12px] text-gray-500">No logged customers to check for this week yet.{isThisWeek ? " Picks are made from the week's logs the first time this opens, so open it again later in the week." : ""}</p>}
      {byRep.map(([rep, list]) => (
        <div key={rep} className="mt-2">
          <p className="m-0 text-[12px] font-bold text-gray-800 dark:text-slate-200">{rep}</p>
          <ul className="m-0 mt-1 list-none space-y-1.5 p-0">
            {list.map((r) => (
              <li key={r.id} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-gray-900 dark:text-slate-100">{r.customer || "No name"}</span>
                  {r.phone && <a href={`tel:${r.phone}`} className="font-semibold text-[#1F8FE0]">{r.phone}</a>}
                  <span className="text-gray-500">Logged: <b className="text-gray-700">{r.attemptOutcome}</b>{r.attemptNote ? ` · "${r.attemptNote}"` : ""}{r.attemptedAt ? ` · ${when(r.attemptedAt)}` : ""}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {(["confirmed", "denied", "unreachable"] as const).map((st) => (
                    <button key={st} type="button" disabled={saving === r.id} onClick={() => save(r, r.status === st ? "pending" : st)}
                      className={`!min-h-0 rounded-md px-2 py-1 text-[11.5px] font-semibold ring-1 ${r.status === st
                        ? st === "denied" ? "bg-rose-600 text-white ring-rose-600" : st === "confirmed" ? "bg-emerald-600 text-white ring-emerald-600" : "bg-slate-600 text-white ring-slate-600"
                        : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"}`}>
                      {st === "confirmed" ? <ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> : null}{SPOT_LABEL[st]}
                    </button>
                  ))}
                  <input value={notes[r.id] ?? r.resultNote ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                    onBlur={() => { if (r.status !== "pending" && (notes[r.id] ?? "") !== (r.resultNote ?? "")) void save(r, r.status); }}
                    placeholder="What the customer said (optional)"
                    className="!min-h-0 h-7 min-w-[180px] flex-1 rounded-md border border-gray-200 px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900" />
                  {r.checkedByName && r.status !== "pending" && <span className="text-[11px] text-gray-500">by {r.checkedByName}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * Carts logged "Interested" that never became an order (Bright, 24 Nov 2026:
 * 136 of them since 29 Sep, ₦5.5M). Newest first: the recent ones are the
 * ones still worth a call.
 */
function InterestedNotOrdered({ onViewCart }: { onViewCart: (cartId: string) => void }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<CartInterestedRow[] | null>(null);
  const [error, setError] = useState("");
  const [rep, setRep] = useState("all");
  const [onlyDropped, setOnlyDropped] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setRows(null); setError("");
    cartsApi.interestedNotOrdered(days).then((r) => { if (!cancelled) setRows(r.rows); }).catch((e: any) => { if (!cancelled) setError(e?.message ?? "Could not load."); });
    return () => { cancelled = true; };
  }, [days]);
  const reps = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.repName, (m.get(r.repName) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const shown = (rows ?? []).filter((r) => (rep === "all" || r.repName === rep) && (!onlyDropped || r.logsAfter === 0));
  const total = shown.reduce((s, r) => s + r.amount, 0);
  const ago = (iso: string) => { const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000); return d === 0 ? "today" : d === 1 ? "1 day ago" : `${d} days ago`; };
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-black text-gray-900 dark:text-slate-100">🛒 Said "Interested", never ordered</span>
        <span className="text-[11.5px] text-gray-600">Still open, no order linked or under their phone number. Call the newest first.</span>
        <span className="ml-auto inline-flex gap-1">
          {[7, 30, 60].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} className={`!min-h-0 rounded-md px-2 py-0.5 text-[12px] font-bold ${days === d ? "bg-slate-900 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>Last {d} days</button>
          ))}
        </span>
      </div>
      {error && <p className="m-0 mt-2 text-[12px] text-rose-700">{error}</p>}
      {rows === null && !error && <p className="m-0 mt-2 flex items-center gap-1.5 text-[12px] text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading…</p>}
      {rows && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setRep("all")} className={`!min-h-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${rep === "all" ? "bg-amber-600 text-white ring-amber-600" : "bg-white text-gray-700 ring-gray-200"}`}>All reps · {rows.length}</button>
            {reps.map(([name, n]) => (
              <button key={name} type="button" onClick={() => setRep(name)} className={`!min-h-0 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1 ${rep === name ? "bg-amber-600 text-white ring-amber-600" : "bg-white text-gray-700 ring-gray-200"}`}>{name} · {n}</button>
            ))}
            <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-700">
              <input type="checkbox" checked={onlyDropped} onChange={(e) => setOnlyDropped(e.target.checked)} /> Only never touched again
            </label>
          </div>
          <p className="m-0 mt-2 text-[12px] font-semibold text-gray-700">{shown.length} cart{shown.length === 1 ? "" : "s"} · ₦{Math.round(total).toLocaleString("en-NG")}</p>
          {shown.length === 0 ? <p className="m-0 mt-1 text-[12px] text-gray-500">None in this period.</p> : (
            <div className="mt-1.5 max-h-96 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <table className="w-full !min-w-[760px] text-[12px]">
                <thead className="sticky top-0 bg-gray-50 text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800">
                  <tr><th className="px-2.5 py-1.5">Customer</th><th className="px-2 py-1.5">Product</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5">Rep</th><th className="px-2 py-1.5">Said Interested</th><th className="px-2 py-1.5">Since then</th><th className="px-2 py-1.5" /></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.cartId} className="border-t border-gray-100 align-top dark:border-slate-800">
                      <td className="px-2.5 py-1.5"><span className="font-semibold text-gray-900 dark:text-slate-100">{r.customer || "No name"}</span>{r.phone && <a href={`tel:${r.phone}`} className="block text-[#1F8FE0]">{r.phone}</a>}</td>
                      <td className="px-2 py-1.5 text-gray-700">{r.product || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">₦{Math.round(r.amount).toLocaleString("en-NG")}</td>
                      <td className="px-2 py-1.5 text-gray-700">{r.repName}</td>
                      <td className="px-2 py-1.5 text-gray-700">{ago(r.interestedAt)}{r.interestedNote && <span className="block italic text-gray-500">“{r.interestedNote}”</span>}</td>
                      <td className={`px-2 py-1.5 ${r.logsAfter === 0 ? "font-semibold text-rose-700" : "text-gray-700"}`}>{r.logsAfter === 0 ? "Never touched again" : `${r.logsAfter} log${r.logsAfter === 1 ? "" : "s"} · last ${r.lastOutcome ?? ""}${r.lastLogAt ? `, ${ago(r.lastLogAt)}` : ""}`}</td>
                      <td className="px-2 py-1.5 text-right"><button type="button" onClick={() => onViewCart(r.cartId)} className="!min-h-0 text-[11.5px] font-semibold text-[#1F8FE0]">View cart</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
