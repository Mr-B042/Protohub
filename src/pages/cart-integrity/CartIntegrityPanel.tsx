import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock3, Copy, FileWarning, Hand, Loader2, Moon, Phone, PhoneCall, PhoneOff,
  ShieldAlert, ShieldCheck, ShoppingBag, Timer, Zap
} from "lucide-react";
import { cartsApi, type CartIntegrityRep, type CartIntegrityView, type CartInterestedRow, type CartSpotCheck } from "../../lib/api";

// ── Cart follow-up "Check this" panel (Bright, 24 Nov 2026 audit) ───────────
// Shown above the cart charges so the Owner sees HOW the logs were made before
// approving them. Patterns are worked out on the server
// (backend/src/lib/cart-log-integrity.ts). A flag is a reason to look, not
// proof: the weekly spot-checks below are how a flag gets confirmed.
// Redesigned 24 Nov: one card per rep, only the problems that rep has, in
// plain words; spot-checks as a simple call list.

const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const shift = (key: string, n: number) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sunday = (key: string) => shift(key, -new Date(`${key}T12:00:00Z`).getUTCDay());
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" });
const RANGES = [{ days: 7, label: "7 days" }, { days: 14, label: "14 days" }, { days: 30, label: "30 days" }];
const VERDICT: Record<CartIntegrityRep["level"], { label: string; sub: string; chip: string; bar: string; ring: string; avatar: string }> = {
  high: { label: "High chance", sub: "logging to avoid the charge", chip: "bg-rose-600 text-white", bar: "bg-rose-500", ring: "ring-rose-200", avatar: "bg-rose-100 text-rose-700" },
  medium: { label: "Look closer", sub: "some logs look rushed or copied", chip: "bg-amber-500 text-white", bar: "bg-amber-400", ring: "ring-amber-200", avatar: "bg-amber-100 text-amber-800" },
  low: { label: "Looks genuine", sub: "logs look like real calls", chip: "bg-emerald-600 text-white", bar: "bg-emerald-500", ring: "ring-emerald-200", avatar: "bg-emerald-100 text-emerald-700" }
};
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Flag = { key: string; Icon: typeof Zap; count: number; text: string; severe: boolean };

/** Only the problems this rep actually has, worst first, in plain words. */
function flagsFor(r: CartIntegrityRep): Flag[] {
  const share = (n: number) => (r.logs ? n / r.logs : 0);
  const out: Flag[] = [
    { key: "denied", Icon: PhoneOff, count: r.spotDenied, text: `${plural(r.spotDenied, "customer")} said nobody called them`, severe: true },
    { key: "rushed", Icon: Zap, count: r.rushedCarts, text: `${plural(r.rushedCarts, "cart")} logged in a rush (${plural(r.rushedSittings, "sitting")}, under a minute each)`, severe: share(r.rushedCarts) >= 0.1 },
    { key: "quick", Icon: Timer, count: r.quickConversations, text: `${r.quickConversations} "talked to them" log${r.quickConversations === 1 ? "" : "s"} saved too fast for a real call`, severe: share(r.quickConversations) >= 0.05 },
    { key: "untouched", Icon: Hand, count: r.untouched, text: `${r.untouched} saved without filling the form`, severe: share(r.untouched) >= 0.05 },
    { key: "copied", Icon: Copy, count: r.repeatedWords, text: `${r.repeatedWords} with the same words as an earlier day`, severe: share(r.repeatedWords) >= 0.05 },
    { key: "mismatch", Icon: FileWarning, count: r.contradictions, text: `${r.contradictions} answer${r.contradictions === 1 ? "" : "s"} that don't add up (the outcome and "did you speak to them" disagree)`, severe: share(r.contradictions) >= 0.1 },
    { key: "notap", Icon: PhoneOff, count: r.noTap, text: `${r.noTap} logged without tapping Call or WhatsApp`, severe: r.noTap > 0 },
    { key: "late", Icon: Moon, count: r.latePct >= 30 ? r.latePct : 0, text: `${r.latePct}% logged after 6pm, in one go before the day closes`, severe: false }
  ];
  return out.filter((f) => f.count > 0).sort((a, b) => Number(b.severe) - Number(a.severe) || b.count - a.count);
}

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

  const counts = useMemo(() => {
    const reps = view?.reps ?? [];
    return { high: reps.filter((r) => r.level === "high").length, medium: reps.filter((r) => r.level === "medium").length, low: reps.filter((r) => r.level === "low").length };
  }, [view]);
  const picked = view?.reps.find((r) => r.repId === repOpen) ?? null;

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {/* Header */}
      <div className="relative bg-gradient-to-r from-slate-900 via-slate-800 to-rose-900 px-4 py-3.5 text-white">
        <button type="button" onClick={() => setOpen((o) => !o)} className="!min-h-0 flex w-full items-center gap-3 text-left">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><ShieldAlert className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-black tracking-tight !text-white">Check this before approving</span>
            <span className="block text-[12px] !text-white/75">How each rep logged their carts: real calls, or logging to avoid the ₦500</span>
          </span>
          {open ? <ChevronDown className="h-5 w-5 opacity-70" /> : <ChevronRight className="h-5 w-5 opacity-70" />}
        </button>
        {open && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl bg-white/10 p-1">
              {RANGES.map((r) => (
                <button key={r.days} type="button" onClick={() => setDays(r.days)}
                  className={`!min-h-0 rounded-lg px-3 py-1 text-[12.5px] font-bold transition ${days === r.days ? "bg-white text-slate-900 shadow" : "text-white/80 hover:text-white"}`}>Last {r.label}</button>
              ))}
            </div>
            {view && view.reps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 text-[12px] font-bold">
                {counts.high > 0 && <span className="rounded-full bg-rose-500/90 px-2.5 py-1">{counts.high} high chance</span>}
                {counts.medium > 0 && <span className="rounded-full bg-amber-500/90 px-2.5 py-1">{counts.medium} look closer</span>}
                {counts.low > 0 && <span className="rounded-full bg-emerald-500/90 px-2.5 py-1">{counts.low} look genuine</span>}
              </div>
            )}
            {loading && <Loader2 className="h-4 w-4 animate-spin opacity-80" />}
          </div>
        )}
      </div>

      {open && (
        <div className="space-y-4 p-4">
          {error && <p className="m-0 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">{error}</p>}
          {view && view.reps.length === 0 && !loading && <p className="m-0 text-[13px] text-gray-500">No follow-ups logged in this period.</p>}

          {/* Rep cards */}
          {view && view.reps.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {view.reps.map((r) => {
                const v = VERDICT[r.level];
                const flags = flagsFor(r);
                const conv = r.saidInterested ? Math.round((r.interestedBecameOrders / r.saidInterested) * 100) : null;
                const active = repOpen === r.repId;
                return (
                  <div key={r.repId} className={`flex flex-col rounded-2xl bg-white p-3.5 shadow-sm ring-1 ${active ? "ring-2 ring-slate-900" : v.ring} dark:bg-slate-900`}>
                    <div className="flex items-start gap-3">
                      <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[15px] font-black ${v.avatar}`}>{initials(r.repName)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[15px] font-black text-gray-900 dark:text-slate-50">{r.repName}</span>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-black ${v.chip}`}>{v.label}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className={`h-full rounded-full ${v.bar}`} style={{ width: `${Math.max(4, r.score)}%` }} /></div>
                        <div className="mt-1 text-[11.5px] text-gray-500">{v.sub}</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <Stat big={String(r.logs)} small={`logs${r.duplicates ? ` (+${r.duplicates} double)` : ""}`} />
                      <Stat big={conv === null ? "—" : `${conv}%`} small={`Interested → order${r.saidInterested ? ` (${r.interestedBecameOrders}/${r.saidInterested})` : ""}`} warn={conv !== null && r.saidInterested >= 5 && conv < 35} />
                      <Stat big={r.spotChecked ? `${r.spotDenied}/${r.spotChecked}` : "—"} small="spot-checks denied" warn={r.spotDenied > 0} />
                    </div>

                    <div className="mt-3 flex-1 space-y-1.5">
                      {flags.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 text-[12.5px] font-semibold text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4" />Nothing suspicious in this period</div>
                      ) : flags.slice(0, 4).map((f) => (
                        <div key={f.key} className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] ${f.severe ? "bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-100" : "bg-gray-50 text-gray-700 dark:bg-slate-800 dark:text-slate-200"}`}>
                          <f.Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${f.severe ? "text-rose-600" : "text-gray-400"}`} />
                          <span>{f.text}</span>
                        </div>
                      ))}
                      {flags.length > 4 && <div className="text-[11.5px] text-gray-500">+{flags.length - 4} more</div>}
                    </div>

                    <button type="button" onClick={() => setRepOpen(active ? null : r.repId)}
                      className={`!min-h-0 mt-3 inline-flex items-center justify-center gap-1.5 rounded-xl py-2 text-[12.5px] font-bold ${active ? "bg-slate-900 text-white" : "border border-gray-200 text-gray-800 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-100"}`}>
                      {active ? "Hide" : "See"} the logs behind this{active ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* The logs behind the picked rep */}
          {view && picked && (
            <RepEvidence rep={picked} view={view} onViewCart={onViewCart} onClose={() => setRepOpen(null)} />
          )}

          <p className="m-0 flex items-start gap-1.5 text-[11.5px] text-gray-500"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />A flag is a reason to look, not proof. The spot-check calls below are the proof: if customers say nobody called, the logs were not real.</p>
          <SpotChecks />
          <InterestedNotOrdered onViewCart={onViewCart} />
        </div>
      )}
    </section>
  );
}

function Stat({ big, small, warn = false }: { big: string; small: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl px-1.5 py-2 ${warn ? "bg-rose-50 dark:bg-rose-500/10" : "bg-gray-50 dark:bg-slate-800"}`}>
      <div className={`text-[17px] font-black tabular-nums leading-tight ${warn ? "text-rose-700" : "text-gray-900 dark:text-slate-50"}`}>{big}</div>
      <div className="text-[10.5px] leading-tight text-gray-500">{small}</div>
    </div>
  );
}

function RepEvidence({ rep, view, onViewCart, onClose }: { rep: CartIntegrityRep; view: CartIntegrityView; onViewCart: (id: string) => void; onClose: () => void }) {
  const sittings = view.sittings.filter((s) => s.repId === rep.repId);
  const flagged = view.flagged.filter((f) => f.repId === rep.repId);
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-800/40">
      <div className="flex items-center justify-between gap-2">
        <h4 className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">{rep.repName}: the logs behind the flags</h4>
        <button type="button" onClick={onClose} className="!min-h-0 text-[12px] font-semibold text-gray-500 hover:text-gray-800">Close</button>
      </div>
      {sittings.length > 0 && (
        <div className="mt-3">
          <p className="m-0 mb-1.5 text-[11px] font-black uppercase tracking-wide text-gray-500">Rushed sittings</p>
          <div className="flex flex-wrap gap-2">
            {sittings.map((s) => (
              <div key={s.startedAt} className="rounded-xl bg-white px-3 py-2 text-[12px] shadow-sm ring-1 ring-rose-200 dark:bg-slate-900">
                <div className="flex items-center gap-1.5 font-black text-rose-700"><Zap className="h-3.5 w-3.5" />{s.carts} carts in {Math.max(1, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000))} min</div>
                <div className="text-gray-600">{when(s.startedAt)} · {s.secondsPerCart}s each</div>
                <div className="text-[11px] text-gray-500">{s.outcomes.join(", ")}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="m-0 mb-1.5 mt-3 text-[11px] font-black uppercase tracking-wide text-gray-500">Flagged logs ({flagged.length})</p>
      {flagged.length === 0 ? <p className="m-0 text-[12.5px] text-gray-500">Nothing flagged in this period.</p> : (
        <div className="grid max-h-[420px] gap-2 overflow-y-auto pr-1 md:grid-cols-2">
          {flagged.slice(0, 80).map((f) => (
            <div key={f.id} className="rounded-xl bg-white p-2.5 text-[12px] shadow-sm ring-1 ring-gray-200 dark:bg-slate-900 dark:ring-slate-700">
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 dark:text-slate-100">{f.outcome}{f.custom ? ` · ${f.custom}` : ""}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-500"><Clock3 className="h-3 w-3" />{when(f.savedAt)}</span>
              </div>
              {f.note && <div className="mt-0.5 line-clamp-2 italic text-gray-600">“{f.note}”</div>}
              <div className="mt-1.5 flex flex-wrap gap-1">{f.reasons.map((why) => <span key={why} className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-semibold text-rose-700">{why}</span>)}</div>
              <button type="button" onClick={() => onViewCart(f.cartId)} className="!min-h-0 mt-1.5 text-[11.5px] font-bold text-[#1F8FE0]">Open cart →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const done = (rows ?? []).filter((r) => r.status !== "pending").length;
  const total = (rows ?? []).length;
  const denied = (rows ?? []).filter((r) => r.status === "denied").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-sky-200 dark:border-sky-500/30">
      <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-sky-600 to-indigo-600 px-4 py-3 text-white">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white/15"><PhoneCall className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-black !text-white">Spot-check calls</div>
          <div className="text-[12px] !text-white/80">Call each customer and ask: “Did someone from us call you about your order?” Reps never see this list.</div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setWeek(shift(week, -7))} className="!min-h-0 rounded-lg bg-white/15 px-2 py-1 text-[13px] font-bold hover:bg-white/25">‹</button>
          <span className="px-1 text-[12.5px] font-bold">Week of {new Date(`${week}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>
          <button type="button" disabled={isThisWeek} onClick={() => setWeek(shift(week, 7))} className="!min-h-0 rounded-lg bg-white/15 px-2 py-1 text-[13px] font-bold hover:bg-white/25 disabled:opacity-30">›</button>
        </div>
      </div>
      {total > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-sky-100 bg-sky-50/60 px-4 py-2 dark:border-sky-500/20 dark:bg-sky-500/5">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-sky-100"><div className="h-full rounded-full bg-sky-600" style={{ width: `${(done / total) * 100}%` }} /></div>
          <span className="text-[12.5px] font-bold text-sky-900 dark:text-sky-100">{done} of {total} called</span>
          {denied > 0 && <span className="rounded-full bg-rose-600 px-2.5 py-0.5 text-[11.5px] font-black text-white">{denied} said nobody called</span>}
        </div>
      )}
      <div className="space-y-4 p-4">
        {error && <p className="m-0 text-[12.5px] text-rose-700">{error}</p>}
        {rows === null && !error && <p className="m-0 flex items-center gap-1.5 text-[12.5px] text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Picking this week's customers…</p>}
        {rows && rows.length === 0 && <p className="m-0 text-[12.5px] text-gray-500">No logged customers to check for this week yet.{isThisWeek ? " Picks are made from the week's logs the first time this opens, so open it again later in the week." : ""}</p>}
        {byRep.map(([rep, list]) => (
          <div key={rep}>
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-black text-slate-700 dark:bg-slate-800 dark:text-slate-200">{initials(rep)}</span>
              <span className="text-[13.5px] font-black text-gray-900 dark:text-slate-100">{rep}</span>
              <span className="text-[11.5px] text-gray-500">{list.filter((r) => r.status !== "pending").length}/{list.length} called</span>
              {list.some((r) => r.status === "denied") && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-black text-rose-700">{list.filter((r) => r.status === "denied").length} denied</span>}
            </div>
            <div className="grid gap-2 lg:grid-cols-3">
              {list.map((r) => (
                <div key={r.id} className={`flex flex-col rounded-xl p-3 ring-1 ${r.status === "denied" ? "bg-rose-50 ring-rose-300 dark:bg-rose-500/10" : r.status === "confirmed" ? "bg-emerald-50 ring-emerald-200 dark:bg-emerald-500/10" : r.status === "unreachable" ? "bg-slate-50 ring-slate-200 dark:bg-slate-800" : "bg-white ring-gray-200 dark:bg-slate-900 dark:ring-slate-700"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13.5px] font-black text-gray-900 dark:text-slate-100">{r.customer || "No name"}</div>
                      <div className="text-[11.5px] text-gray-500">{r.attemptedAt ? when(r.attemptedAt) : ""}</div>
                    </div>
                    {r.phone && (
                      <a href={`tel:${r.phone}`} className="!min-h-0 inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#1F8FE0] px-2.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#1a7dc4]"><Phone className="h-3.5 w-3.5" />Call</a>
                    )}
                  </div>
                  <div className="mt-2 rounded-lg bg-black/[0.03] px-2 py-1.5 text-[12px] text-gray-700 dark:bg-white/5 dark:text-slate-300">
                    <span className="font-bold">{r.attemptOutcome}</span>{r.attemptNote ? <span className="line-clamp-2"> “{r.attemptNote}”</span> : null}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {([
                      ["confirmed", "Called ✓", "bg-emerald-600 text-white ring-emerald-600"],
                      ["denied", "Nobody called", "bg-rose-600 text-white ring-rose-600"],
                      ["unreachable", "No answer", "bg-slate-600 text-white ring-slate-600"]
                    ] as const).map(([st, label, on]) => (
                      <button key={st} type="button" disabled={saving === r.id} onClick={() => save(r, r.status === st ? "pending" : st)}
                        title={st === "confirmed" ? "The customer confirms we called" : st === "denied" ? "The customer says nobody called them" : "You could not reach the customer"}
                        className={`!min-h-0 rounded-lg px-1 py-1.5 text-[11.5px] font-bold ring-1 transition ${r.status === st ? on : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {r.status !== "pending" && (
                    <input value={notes[r.id] ?? r.resultNote ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      onBlur={() => { if ((notes[r.id] ?? "") !== (r.resultNote ?? "")) void save(r, r.status); }}
                      placeholder="What did the customer say? (optional)"
                      className="!min-h-0 mt-2 h-8 rounded-lg border border-gray-200 bg-white px-2 text-[12px] dark:border-slate-700 dark:bg-slate-900" />
                  )}
                  {r.checkedByName && r.status !== "pending" && <div className="mt-1 text-right text-[10.5px] text-gray-400">by {r.checkedByName}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
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
  const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
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
            <div data-smart-sticky="off" className="mt-1.5 max-h-96 overflow-auto rounded-lg border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <table className="w-full !min-w-[860px] text-[12px]">
                <thead className="sticky top-0 bg-gray-50 text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800">
                  <tr><th className="px-2.5 py-1.5">Customer</th><th className="px-2 py-1.5">Product</th><th className="px-2 py-1.5 text-right">Value</th><th className="px-2 py-1.5">Rep</th><th className="px-2 py-1.5">Assigned</th><th className="px-2 py-1.5">Said Interested</th><th className="px-2 py-1.5">Since then</th><th className="px-2 py-1.5" /></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.cartId} className="border-t border-gray-100 align-top dark:border-slate-800">
                      <td className="px-2.5 py-1.5"><span className="font-semibold text-gray-900 dark:text-slate-100">{r.customer || "No name"}</span>{r.phone && <a href={`tel:${r.phone}`} className="block text-[#1F8FE0]">{r.phone}</a>}</td>
                      <td className="px-2 py-1.5 text-gray-700">{r.product || "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">₦{Math.round(r.amount).toLocaleString("en-NG")}</td>
                      <td className="px-2 py-1.5 text-gray-700">{r.repName}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-gray-700">{r.assignedAt ? <>{dateOnly(r.assignedAt)}<span className="block text-[11px] text-gray-500">{ago(r.assignedAt)}</span></> : <span className="text-gray-400">—</span>}</td>
                      <td className="px-2 py-1.5 text-gray-700"><span className="whitespace-nowrap">{dateOnly(r.interestedAt)}</span><span className="block text-[11px] text-gray-500">{ago(r.interestedAt)}</span>{r.interestedNote && <span className="block italic text-gray-500">“{r.interestedNote}”</span>}</td>
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
