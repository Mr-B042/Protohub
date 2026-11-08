import { useCallback, useEffect, useState } from "react";
import { Archive, ChevronLeft, ChevronRight, Coins, Crown, Download, Gift, Pause, Pencil, Play, Plus, Search, Ticket, Trash2, Undo2, UserPlus, Users, Wallet } from "lucide-react";
import DateWindowNav from "../../components/DateWindowNav";
import {
  emailMarketingApi, type EmLoyaltyLedgerRow, type EmLoyaltyLevel, type EmLoyaltyMember, type EmLoyaltyPage, type EmLoyaltyProgram, type EmLoyaltyReward, type EmLoyaltyRewardInput
} from "../../lib/api";
import type { DateWindow } from "../../lib/date-window";
import { ModalShell } from "./AudiencePage";
import { Avatar, Card, Donut, ErrorNote, IconTile, Loading, Pill, btn, count, downloadCsv, input, lagosDate, naira, pct, phoneText, select } from "./em-ui";
import { Legend } from "./health-ui";
import { LevelBadge, LevelPill, LevelsEditor, MonthChart, RowMenu, Tile, levelLook } from "./loyalty-ui";

/** The Loyalty & Rewards tabs after Programs (Bright's design 55, 8 Nov 2026). */

type Levels = EmLoyaltyPage["levels"];
const levelIndexOf = (levels: Levels, key: string) => Math.max(0, levels.findIndex((level) => level.key === key));
const th = "border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400";
const td = "border-b border-gray-100 last:border-0 dark:border-slate-800";

function Pages({ page, pages, total, noun, onPage }: { page: number; pages: number; total: number; noun: string; onPage: (page: number) => void }) {
  if (!total) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px] text-gray-600 dark:text-slate-400">
      <span>{count(total)} {noun}</span>
      <span className="flex items-center gap-1">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
        <span className="px-2 font-semibold">Page {page} of {pages}</span>
        <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
      </span>
    </div>
  );
}

const KIND_LOOK: Record<EmLoyaltyLedgerRow["kind"], { label: string; tone: string }> = {
  earned: { label: "Earned", tone: "green" }, used: { label: "Used", tone: "purple" }, added: { label: "Added by hand", tone: "blue" }, removed: { label: "Taken by hand", tone: "amber" }
};
const pointsCell = (row: EmLoyaltyLedgerRow) => (
  <span className={`font-bold ${!row.counted ? "text-gray-400 line-through" : row.points > 0 ? "text-emerald-600 dark:text-emerald-400" : row.points < 0 ? "text-[#5B3FD9] dark:text-violet-300" : "text-gray-500"}`}>
    {row.points > 0 ? "+" : ""}{count(row.points)}
  </span>
);

// ── Members ──────────────────────────────────────────────────────────

export function MembersTab({ onToast, levels, refreshKey, onChanged }: { onToast: (message: string) => void; levels: Levels; refreshKey: number; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [voucher, setVoucher] = useState(false);
  const [sort, setSort] = useState("spend");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ total: number; page: number; pages: number; rows: EmLoyaltyMember[] } | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setResult(await emailMarketingApi.loyaltyMembers({ query, level, voucher, sort, page })); setError(""); }
    catch (err) { setError((err as Error).message || "Could not load the members."); }
  }, [query, level, voucher, sort, page]);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load, refreshKey]);
  useEffect(() => { setPage(1); }, [query, level, voucher, sort]);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-4">
        <h3 className="m-0 mr-auto text-[18px] font-bold text-gray-900 dark:text-slate-50">Members</h3>
        <label className="relative min-w-[220px] flex-1 sm:flex-none"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or phone..." className={`${input} !py-2 !pl-9`} /></label>
        <select value={level} onChange={(event) => setLevel(event.target.value)} className={`${select} !w-[150px] !py-2`} aria-label="Level"><option value="">All Levels</option>{levels.map((row) => <option key={row.key} value={row.key}>{row.name} ({count(row.members)})</option>)}</select>
        <select value={sort} onChange={(event) => setSort(event.target.value)} className={`${select} !w-[170px] !py-2`} aria-label="Sort">
          <option value="spend">Highest spend</option><option value="points">Most points</option><option value="orders">Most orders</option><option value="recent">Latest delivery</option>
        </select>
        <label className="inline-flex items-center gap-2 text-[13px] font-semibold text-gray-700 dark:text-slate-300"><input type="checkbox" checked={voucher} onChange={(event) => setVoucher(event.target.checked)} className="h-4 w-4 accent-[#5B3FD9]" />Voucher ready</label>
      </div>
      <ErrorNote message={error} />
      {!result && !error && <div className="px-4 pb-4"><Loading /></div>}
      {result && (
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full min-w-[860px] text-left text-[13px]">
            <thead><tr className={th}>
              <th className="px-4 py-2.5">Customer</th><th className="px-2 py-2.5">Level</th><th className="px-2 py-2.5 text-right">Delivered Orders</th><th className="px-2 py-2.5 text-right">Total Spend</th>
              <th className="px-2 py-2.5 text-right">Points</th><th className="px-2 py-2.5">Voucher Ready</th><th className="px-2 py-2.5">Last Delivery</th><th className="px-3 py-2.5" />
            </tr></thead>
            <tbody>
              {result.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-600 dark:text-slate-400">No member matches. A customer becomes a member with their first delivered order.</td></tr>}
              {result.rows.map((row) => (
                <tr key={row.key} className={td}>
                  <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={row.name} /><span className="min-w-0"><span className="block max-w-[190px] truncate font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[12px] text-gray-500">{phoneText(row.phone)}</span></span></span></td>
                  <td className="px-2 py-2.5"><LevelPill index={levelIndexOf(levels, row.levelKey)} name={row.levelName} /></td>
                  <td className="px-2 py-2.5 text-right font-semibold">{count(row.delivered)}</td>
                  <td className="px-2 py-2.5 text-right font-bold">{naira(row.spend)}</td>
                  <td className="px-2 py-2.5 text-right font-semibold">{count(row.balance)}</td>
                  <td className="px-2 py-2.5">{row.voucher ? <Pill tone="green"><Gift className="h-3.5 w-3.5" />{naira(row.voucher.value)} off</Pill> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-2 py-2.5 text-gray-700 dark:text-slate-300">{lagosDate(row.lastAt)}</td>
                  <td className="px-3 py-2.5 text-right"><button type="button" onClick={() => setOpen(row.key)} className={btn.outline}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result && <Pages page={result.page} pages={result.pages} total={result.total} noun={result.total === 1 ? "member" : "members"} onPage={setPage} />}
      {open && <MemberModal memberKey={open} levels={levels} onClose={() => setOpen(null)} onToast={onToast} onChanged={async () => { await load(); await onChanged(); }} />}
    </Card>
  );
}

function MemberModal({ memberKey, levels, onClose, onToast, onChanged }: { memberKey: string; levels: Levels; onClose: () => void; onToast: (message: string) => void; onChanged: () => Promise<void> }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof emailMarketingApi.loyaltyMember>> | null>(null);
  const [error, setError] = useState("");
  const [points, setPoints] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await emailMarketingApi.loyaltyMember(memberKey)); setError(""); }
    catch (err) { setError((err as Error).message || "Could not load the member."); }
  }, [memberKey]);
  useEffect(() => { void load(); }, [load]);
  const adjust = async () => {
    setBusy(true); setError("");
    try {
      await emailMarketingApi.adjustLoyaltyPoints({ key: memberKey, points: Math.round(points), reason: reason.trim() });
      onToast(points > 0 ? `${count(points)} points added.` : `${count(-points)} points taken away.`);
      setPoints(0); setReason("");
      await load(); await onChanged();
    } catch (err) { setError((err as Error).message || "Could not change the points."); }
    finally { setBusy(false); }
  };
  const member = data?.member;
  return (
    <ModalShell wide title={member ? member.name : "Member"} sub={member ? `${phoneText(member.phone)} · member since ${lagosDate(member.firstAt)}` : undefined} onClose={onClose}
      footer={<button type="button" onClick={onClose} className={btn.ghost}>Close</button>}>
      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {member && data && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <LevelBadge index={levelIndexOf(levels, member.levelKey)} size={44} />
            <div className="mr-auto"><div className="text-[18px] font-extrabold text-gray-900 dark:text-slate-50">{member.levelName}</div><div className="text-[13px] text-gray-600 dark:text-slate-400">{member.next ? `${naira(member.next.gap)} more to reach ${member.next.name}` : "Top level"}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Total spend", naira(member.spend)], ["Delivered orders", count(member.delivered)], ["Points", count(member.balance)], ["Points used", count(member.spent)]].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-gray-200 px-3 py-2 dark:border-slate-700"><div className="text-[11.5px] font-semibold text-gray-500">{label}</div><div className="text-[17px] font-extrabold text-gray-900 dark:text-slate-50">{value}</div></div>
            ))}
          </div>
          <div>
            <h4 className="m-0 mb-1.5 text-[14px] font-bold text-gray-900 dark:text-slate-50">Vouchers ready</h4>
            {member.options.length ? (
              <ul className="m-0 list-none space-y-1 p-0">{member.options.map((option) => <li key={`${option.kind}-${option.label}`} className="flex items-center gap-2 text-[13px]"><Gift className="h-4 w-4 text-emerald-600" /><b>{naira(option.value)} off</b><span className="text-gray-600 dark:text-slate-400">{option.label}</span></li>)}</ul>
            ) : <p className="m-0 text-[13px] text-gray-500">None yet.</p>}
            {member.options.length > 1 && <p className="m-0 mt-1 text-[12px] text-gray-500">One per order: the biggest comes off the next order, the rest wait.</p>}
          </div>
          <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
            <h4 className="m-0 mb-2 text-[14px] font-bold text-gray-900 dark:text-slate-50">Add or take away points</h4>
            <div className="grid gap-2 sm:grid-cols-[130px_1fr_auto]">
              <input type="number" value={points || ""} onChange={(event) => setPoints(Math.round(Number(event.target.value) || 0))} placeholder="+50 or -20" aria-label="Points" className={`${input} !py-2`} />
              <input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} placeholder="Why (the customer sees no reason; it stays in the history)" aria-label="Reason" className={`${input} !py-2`} />
              <button type="button" disabled={busy || !points || reason.trim().length < 3} onClick={() => void adjust()} className={btn.primary}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
          <div>
            <h4 className="m-0 mb-1.5 text-[14px] font-bold text-gray-900 dark:text-slate-50">Points history</h4>
            {data.ledger.length ? (
              <div className="max-h-[260px] overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-800">
                <table className="!min-w-0 w-full text-left text-[12.5px]"><tbody>
                  {data.ledger.map((row) => (
                    <tr key={row.id} className={td}>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600 dark:text-slate-400">{lagosDate(row.at)}</td>
                      <td className="px-2 py-2"><Pill tone={KIND_LOOK[row.kind].tone}>{KIND_LOOK[row.kind].label}</Pill></td>
                      <td className="px-2 py-2 text-right">{pointsCell(row)}</td>
                      <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{row.note}{row.orderId ? <span className="block text-[11.5px] text-gray-500">Order {row.orderId}</span> : null}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            ) : <p className="m-0 text-[13px] text-gray-500">Nothing yet. Points start when the points program is on and an order is delivered.</p>}
          </div>
          <div>
            <h4 className="m-0 mb-1.5 text-[14px] font-bold text-gray-900 dark:text-slate-50">Delivered orders</h4>
            <div className="flex flex-wrap gap-1.5">{data.orders.slice(0, 30).map((order) => <span key={order.id} className="rounded-lg bg-gray-100 px-2 py-1 text-[12px] text-gray-700 dark:bg-slate-800 dark:text-slate-300">{lagosDate(order.deliveredAt)} · {naira(order.amount)}</span>)}</div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ── Points & Transactions ────────────────────────────────────────────

export function TransactionsTab({ window_, setWindow, todayKey, onToast, refreshKey }: { window_: DateWindow; setWindow: (next: DateWindow) => void; todayKey: string; onToast: (message: string) => void; refreshKey: number }) {
  const [kind, setKind] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Awaited<ReturnType<typeof emailMarketingApi.loyaltyTransactions>> | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setResult(await emailMarketingApi.loyaltyTransactions({ from: window_.start, to: window_.end, kind, query, page })); setError(""); }
    catch (err) { setError((err as Error).message || "Could not load the points history."); }
  }, [window_.start, window_.end, kind, query, page]);
  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load, refreshKey]);
  useEffect(() => { setPage(1); }, [kind, query, window_.start, window_.end]);
  const download = async () => {
    try {
      const { rows } = await emailMarketingApi.loyaltyTransactions({ from: window_.start, to: window_.end, kind, query, all: true });
      if (!rows.length) { onToast("Nothing in these days."); return; }
      downloadCsv(`loyalty-points-${window_.start}-to-${window_.end}.csv`, ["Date", "Customer", "Phone", "What", "Points", "Naira off", "Order", "Details", "Counted"],
        rows.map((row) => [lagosDate(row.at, true), row.name, row.phone, KIND_LOOK[row.kind].label, row.points, row.discount || "", row.orderId ?? "", row.note, row.counted ? "Yes" : "No"]));
    } catch (err) { onToast((err as Error).message || "Could not build the file."); }
  };
  const s = result?.summary;
  return (
    <div className="space-y-4">
      {s && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Tile icon={Coins} label="Points Earned" value={count(s.earned)} note="Delivered orders in these days" />
          <Tile icon={Gift} label="Points Used" value={count(s.used)} note="On rewards taken off orders" />
          <Tile icon={Undo2} label="Points Given Back" value={count(s.givenBack)} note="The order failed or was cancelled" />
          <Tile icon={Pencil} label="Changed by Hand" value={`${s.adjusted > 0 ? "+" : ""}${count(s.adjusted)}`} note="Added or taken away, with a reason" />
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-4">
          <h3 className="m-0 mr-auto text-[18px] font-bold text-gray-900 dark:text-slate-50">Points & Transactions</h3>
          <label className="relative min-w-[200px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, phone or order..." className={`${input} !py-2 !pl-9`} /></label>
          <select value={kind} onChange={(event) => setKind(event.target.value)} className={`${select} !w-[170px] !py-2`} aria-label="What">
            <option value="">Everything</option><option value="earned">Earned</option><option value="used">Used</option><option value="adjusted">Changed by hand</option>
          </select>
          <DateWindowNav variant="compact" value={window_} onChange={setWindow} todayKey={todayKey} />
          <button type="button" onClick={() => void download()} className={btn.ghost}><Download className="h-4 w-4" />CSV</button>
        </div>
        <ErrorNote message={error} />
        {!result && !error && <div className="px-4 pb-4"><Loading /></div>}
        {result && (
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[820px] text-left text-[13px]">
              <thead><tr className={th}><th className="px-4 py-2.5">Date</th><th className="px-2 py-2.5">Customer</th><th className="px-2 py-2.5">What</th><th className="px-2 py-2.5 text-right">Points</th><th className="px-2 py-2.5">Order</th><th className="px-3 py-2.5">Details</th></tr></thead>
              <tbody>
                {result.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-600 dark:text-slate-400">Nothing in these days. Points come once the points program is on and orders are delivered.</td></tr>}
                {result.rows.map((row) => (
                  <tr key={row.id} className={td}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-700 dark:text-slate-300">{lagosDate(row.at)}</td>
                    <td className="px-2 py-2.5"><span className="block max-w-[180px] truncate font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[12px] text-gray-500">{phoneText(row.phone)}</span></td>
                    <td className="px-2 py-2.5"><Pill tone={KIND_LOOK[row.kind].tone}>{KIND_LOOK[row.kind].label}</Pill></td>
                    <td className="px-2 py-2.5 text-right">{pointsCell(row)}</td>
                    <td className="px-2 py-2.5 font-mono text-[12px] text-gray-700 dark:text-slate-300">{row.orderId ?? "—"}</td>
                    <td className="px-3 py-2.5 text-gray-700 dark:text-slate-300">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {result && <Pages page={result.page} pages={result.pages} total={result.total} noun={result.total === 1 ? "entry" : "entries"} onPage={setPage} />}
      </Card>
    </div>
  );
}

// ── Tiers (VIP) ──────────────────────────────────────────────────────

const stripLevel = ({ key, name, minSpend, multiplier, welcomeVoucher, monthlyVoucher, perks }: EmLoyaltyLevel): EmLoyaltyLevel => ({ key, name, minSpend, multiplier, welcomeVoucher, monthlyVoucher, perks });

export function TiersTab({ program, baseRate, levels, onToast, onChanged, onCreate, onAct }: {
  program: EmLoyaltyProgram | null; baseRate: number; levels: Levels; onToast: (message: string) => void; onChanged: () => Promise<void>; onCreate: () => void;
  onAct: (action: "launch" | "pause" | "resume") => void;
}) {
  const [draft, setDraft] = useState<EmLoyaltyLevel[]>(() => (program?.levels ?? []).map(stripLevel));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft((program?.levels ?? []).map(stripLevel)); }, [program?.id, program?.levels]);
  if (!program) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <IconTile size="lg"><Crown className="h-6 w-6" /></IconTile>
        <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">No VIP levels</h3>
        <p className="m-0 max-w-md text-[14px] text-gray-600 dark:text-slate-400">Levels put each customer at Bronze, Silver or Gold by what they've had delivered, with points and vouchers for each.</p>
        <button type="button" onClick={onCreate} className={btn.primary}><Plus className="h-4 w-4" />Create VIP Tiers</button>
      </Card>
    );
  }
  const save = async () => {
    setBusy(true); setError("");
    try {
      await emailMarketingApi.updateLoyaltyProgram(program.id, {
        type: "tier", name: program.name, description: program.description, rate: program.rate, productIds: [], endsAt: program.endsAt, status: program.status === "draft" ? "draft" : "active",
        levels: draft.map((level) => ({ ...level, name: level.name.trim(), perks: level.perks.map((perk) => perk.trim()).filter(Boolean) }))
      });
      onToast("Levels saved.");
      await onChanged();
    } catch (err) { setError((err as Error).message || "Could not save the levels."); }
    finally { setBusy(false); }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(program.levels.map(stripLevel));
  const state = program.status === "active" ? "Active" : program.status === "draft" ? "Draft" : program.status === "paused" ? "Paused" : "Archived";
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="m-0 mr-auto text-[18px] font-bold text-gray-900 dark:text-slate-50">{program.name}</h3>
          <Pill tone={program.status === "active" ? "green" : program.status === "paused" ? "amber" : "slate"}>{state}</Pill>
          {program.status === "draft" && <button type="button" onClick={() => onAct("launch")} className={btn.outline}><Play className="h-3.5 w-3.5" />Turn On</button>}
          {program.status === "paused" && <button type="button" onClick={() => onAct("resume")} className={btn.outline}><Play className="h-3.5 w-3.5" />Turn On</button>}
          {program.status === "active" && <button type="button" onClick={() => onAct("pause")} className={btn.outline}><Pause className="h-3.5 w-3.5" />Pause</button>}
        </div>
        <ErrorNote message={error} />
        <LevelsEditor levels={draft} baseRate={baseRate} onChange={setDraft} />
        <div className="mt-4 flex justify-end gap-2">
          {dirty && <button type="button" onClick={() => setDraft(program.levels.map(stripLevel))} className={btn.ghost}>Undo Changes</button>}
          <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={btn.primary}>{busy ? "Saving…" : "Save Levels"}</button>
        </div>
      </Card>
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Members at each level</h3>
          <ul className="m-0 list-none space-y-2 p-0">
            {levels.map((level, index) => (
              <li key={level.key} className="flex items-center gap-2.5"><LevelBadge index={index} size={30} /><span className="min-w-0 flex-1"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{level.name}</span><span className="block text-[12px] text-gray-500">{level.spendText}</span></span><span className="text-[15px] font-extrabold text-gray-900 dark:text-slate-50">{count(level.members)}</span></li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <h3 className="m-0 mb-2 text-[16px] font-bold text-gray-900 dark:text-slate-50">How levels work</h3>
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-[13px] text-gray-700 dark:text-slate-300">
            <li>A level comes from everything a customer has had delivered, so past customers have theirs from day one.</li>
            <li>Higher levels earn more points on each order (the multiplier). An order earns at the level the customer had before it.</li>
            <li>A welcome voucher goes once to each member who reaches that level after you turn the levels on. People already there when you turn them on don't get one.</li>
            <li>A monthly voucher comes off one order a month while the member is at that level.</li>
            <li>One voucher per order. It comes off by itself, and Order Details shows the rep what came off.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

// ── Referrals (part 2) ───────────────────────────────────────────────

export function ReferralsTab() {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <IconTile size="lg"><UserPlus className="h-6 w-6" /></IconTile>
      <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Refer & Earn comes in the next part</h3>
      <p className="m-0 max-w-lg text-[14px] text-gray-600 dark:text-slate-400">A member shares their own link. The friend who orders through it gets money off, and the member gets a voucher once the friend's order is delivered. Points and VIP levels come first, as agreed.</p>
    </Card>
  );
}

// ── Rewards Catalog ──────────────────────────────────────────────────

const REWARD_STATUS: Record<string, { label: string; tone: string }> = { active: { label: "Active", tone: "green" }, paused: { label: "Paused", tone: "amber" }, archived: { label: "Archived", tone: "slate" } };

export function RewardsTab({ data, onToast, onChanged, onOpenTiers }: { data: EmLoyaltyPage; onToast: (message: string) => void; onChanged: () => Promise<void>; onOpenTiers: () => void }) {
  const [editing, setEditing] = useState<{ id: string | null; input: EmLoyaltyRewardInput } | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (row: EmLoyaltyReward, action: "pause" | "resume" | "archive" | "unarchive" | "delete") => {
    if (action === "delete" && !window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (action === "delete") { await emailMarketingApi.deleteLoyaltyReward(row.id); onToast("Reward deleted."); }
      else { await emailMarketingApi.loyaltyRewardAction(row.id, action); onToast(action === "pause" ? "Paused: it won't come off orders until you turn it back on." : action === "archive" ? "Archived." : action === "unarchive" ? "Back from the archive (paused)." : "Turned on."); }
      await onChanged();
    } catch (err) { onToast((err as Error).message || "Could not change the reward."); }
    finally { setBusy(false); }
  };
  const levelVouchers = data.levels.flatMap((level, index) => [
    ...(level.welcomeVoucher > 0 ? [{ key: `${level.key}-w`, index, text: `${level.name}: ${naira(level.welcomeVoucher)} welcome voucher`, hint: "Once, on reaching the level" }] : []),
    ...(level.monthlyVoucher > 0 ? [{ key: `${level.key}-m`, index, text: `${level.name}: ${naira(level.monthlyVoucher)} monthly voucher`, hint: "One order a month at the level" }] : [])
  ]);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 p-4">
          <div className="mr-auto"><h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Rewards Catalog</h3><p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">What points buy. The biggest reward a member can afford comes off their next order by itself.</p></div>
          <button type="button" onClick={() => setEditing({ id: null, input: { name: "", points: 100, value: 1000, status: "active" } })} className={btn.primary}><Plus className="h-4 w-4" />Add Reward</button>
        </div>
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full min-w-[720px] text-left text-[13px]">
            <thead><tr className={th}><th className="px-4 py-2.5">Reward</th><th className="px-2 py-2.5 text-right">Points Needed</th><th className="px-2 py-2.5 text-right">Takes Off</th><th className="px-2 py-2.5 text-right">Can Get It Now</th><th className="px-2 py-2.5 text-right">Used</th><th className="px-2 py-2.5">Status</th><th className="px-3 py-2.5 text-right">Actions</th></tr></thead>
            <tbody>
              {data.rewards.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-600 dark:text-slate-400">No rewards yet. Add one so points can be spent.</td></tr>}
              {data.rewards.map((row) => (
                <tr key={row.id} className={`${td} ${row.status === "archived" ? "opacity-60" : ""}`}>
                  <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><IconTile size="sm"><Ticket className="h-4 w-4" /></IconTile><span className="font-bold text-gray-900 dark:text-slate-50">{row.name}</span></span></td>
                  <td className="px-2 py-2.5 text-right font-semibold">{count(row.points)}</td>
                  <td className="px-2 py-2.5 text-right font-bold">{naira(row.value)}</td>
                  <td className="px-2 py-2.5 text-right">{count(row.canAfford)} <span className="text-[12px] text-gray-500">members</span></td>
                  <td className="px-2 py-2.5 text-right">{count(row.used)}</td>
                  <td className="px-2 py-2.5"><Pill tone={(REWARD_STATUS[row.status] ?? REWARD_STATUS.paused).tone}>{(REWARD_STATUS[row.status] ?? REWARD_STATUS.paused).label}</Pill></td>
                  <td className="px-3 py-2.5 text-right">
                    <RowMenu label={`More for ${row.name}`} disabled={busy} items={[
                      { key: "edit", label: "Edit", icon: Pencil, run: () => setEditing({ id: row.id, input: { name: row.name, points: row.points, value: row.value, status: row.status === "active" ? "active" : "paused" } }) },
                      ...(row.status === "active" ? [{ key: "pause", label: "Pause", icon: Pause, run: () => void act(row, "pause") }] : []),
                      ...(row.status === "paused" ? [{ key: "on", label: "Turn On", icon: Play, run: () => void act(row, "resume") }] : []),
                      ...(row.status !== "archived" ? [{ key: "archive", label: "Archive", icon: Archive, run: () => void act(row, "archive") }] : [{ key: "unarchive", label: "Unarchive", icon: Undo2, run: () => void act(row, "unarchive") }]),
                      ...(row.allTime === 0 ? [{ key: "delete", label: "Delete", icon: Trash2, run: () => void act(row, "delete"), danger: true }] : [])
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!data.live.points && <p className="m-0 px-4 py-2.5 text-[12px] text-amber-700 dark:text-amber-300">The points program is off, so no reward comes off any order yet.</p>}
      </Card>
      <Card className="p-4">
        <h3 className="m-0 mb-1 text-[16px] font-bold text-gray-900 dark:text-slate-50">Vouchers from VIP levels</h3>
        <p className="m-0 mb-3 text-[12.5px] text-gray-600 dark:text-slate-400">These cost no points.</p>
        {levelVouchers.length ? (
          <ul className="m-0 list-none space-y-2 p-0">{levelVouchers.map((row) => <li key={row.key} className="flex items-center gap-2.5"><LevelBadge index={row.index} size={28} /><span><span className="block text-[13.5px] font-bold text-gray-900 dark:text-slate-50">{row.text}</span><span className="block text-[12px] text-gray-500">{row.hint}</span></span></li>)}</ul>
        ) : <p className="m-0 text-[13px] text-gray-500">No level has a voucher.</p>}
        <button type="button" onClick={onOpenTiers} className={`${btn.outline} mt-3`}><Crown className="h-3.5 w-3.5" />Edit in Tiers (VIP)</button>
      </Card>
      {editing && <RewardModal id={editing.id} initial={editing.input} onClose={() => setEditing(null)} onDone={async (message) => { setEditing(null); onToast(message); await onChanged(); }} />}
    </div>
  );
}

function RewardModal({ id, initial, onClose, onDone }: { id: string | null; initial: EmLoyaltyRewardInput; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const body = { ...form, name: form.name.trim() || `${naira(form.value)} off` };
      if (id) await emailMarketingApi.updateLoyaltyReward(id, body); else await emailMarketingApi.createLoyaltyReward(body);
      await onDone(id ? "Reward saved." : "Reward added.");
    } catch (err) { setError((err as Error).message || "Could not save the reward."); setBusy(false); }
  };
  const label = "block text-[13px] font-semibold text-gray-800 dark:text-slate-200";
  return (
    <ModalShell title={id ? "Edit Reward" : "Add Reward"} sub="A voucher a member gets for their points." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}>{busy ? "Saving…" : "Save Reward"}</button></>}>
      <ErrorNote message={error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${label} sm:col-span-2`}>Name<input value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={`${naira(form.value)} off`} className={`${input} mt-1.5`} /></label>
        <label className={label}>Points needed *<input type="number" min={1} value={form.points || ""} onChange={(event) => setForm({ ...form, points: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={`${input} mt-1.5`} /></label>
        <label className={label}>Takes off (₦) *<input type="number" min={1} value={form.value || ""} onChange={(event) => setForm({ ...form, value: Math.max(0, Math.round(Number(event.target.value) || 0)) })} className={`${input} mt-1.5`} /></label>
        <p className="m-0 text-[12px] text-gray-500 sm:col-span-2">{form.points > 0 && form.value > 0 ? `Each point is worth ${naira(form.value / form.points)} on this reward.` : " "}</p>
      </div>
    </ModalShell>
  );
}

// ── Analytics ────────────────────────────────────────────────────────

export function AnalyticsTab({ data }: { data: EmLoyaltyPage }) {
  const a = data.analytics;
  const totalMembers = data.levels.reduce((sum, level) => sum + level.members, 0);
  const vouchersSix = a.months.reduce((sum, row) => sum + row.voucherNaira, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile icon={Users} label="Members" value={count(totalMembers)} note="Customers with a delivered order" />
        <Tile icon={Wallet} label="Points Not Used Yet" value={count(a.outstanding)} note="Every member's balance added up" />
        <Tile icon={Gift} label="Members With a Voucher Ready" value={count(a.withVoucher)} note="It comes off their next order" />
        <Tile icon={Ticket} label="Taken Off by Vouchers" value={naira(vouchersSix)} note="The last six months" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Points earned and used</h3>
          <div className="mb-2 mt-1"><Legend items={[{ label: "Earned", color: "#7C5CFF", bar: true }, { label: "Used", color: "#0D9488", bar: true }]} /></div>
          <MonthChart data={a.months} series={[{ key: "issued", label: "Earned", color: "#7C5CFF", kind: "bar", unit: "count" }, { key: "used", label: "Used", color: "#0D9488", kind: "bar", unit: "count" }]} empty="Shows once the points program is on and orders are delivered." />
        </Card>
        <Card className="p-4">
          <h3 className="m-0 text-[16px] font-bold text-gray-900 dark:text-slate-50">Repeat purchase rate</h3>
          <p className="m-0 mb-2 text-[12px] text-gray-500">Members with 2+ deliveries, at each month's end.</p>
          <MonthChart data={a.months} series={[{ key: "repeatRate", label: "Repeat purchase rate", color: "#7C5CFF", kind: "line", unit: "percent" }]} />
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-4">
          <h3 className="m-0 mb-3 text-[16px] font-bold text-gray-900 dark:text-slate-50">Members by level</h3>
          <div className="flex flex-wrap items-center gap-4">
            <Donut slices={data.levels.map((level, index) => ({ value: level.members, color: levelLook(index).color }))} size={150} stroke={20}>
              <span className="text-[18px] font-extrabold text-gray-900 dark:text-slate-50">{count(totalMembers)}</span><span className="text-[11.5px] text-gray-500">Members</span>
            </Donut>
            <ul className="m-0 min-w-[150px] flex-1 list-none space-y-1.5 p-0">
              {data.levels.map((level, index) => (
                <li key={level.key} className="flex items-center gap-2 text-[13px]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: levelLook(index).color }} /><span className="flex-1 text-gray-700 dark:text-slate-300">{level.name}</span><span className="font-semibold text-gray-900 dark:text-slate-50">{count(level.members)}</span><span className="w-12 text-right text-gray-500">{pct(totalMembers ? (level.members / totalMembers) * 100 : null)}</span></li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="overflow-hidden">
          <h3 className="m-0 p-4 text-[16px] font-bold text-gray-900 dark:text-slate-50">Top members by spend</h3>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[620px] text-left text-[13px]">
              <thead><tr className={th}><th className="px-4 py-2.5">Customer</th><th className="px-2 py-2.5">Level</th><th className="px-2 py-2.5 text-right">Delivered</th><th className="px-2 py-2.5 text-right">Total Spend</th><th className="px-3 py-2.5 text-right">Points</th></tr></thead>
              <tbody>
                {a.top.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-600 dark:text-slate-400">No members yet.</td></tr>}
                {a.top.map((row) => (
                  <tr key={row.key} className={td}>
                    <td className="px-4 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={row.name} /><span className="min-w-0"><span className="block max-w-[200px] truncate font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block text-[12px] text-gray-500">{phoneText(row.phone)}</span></span></span></td>
                    <td className="px-2 py-2.5"><LevelPill index={levelIndexOf(data.levels, row.levelKey)} name={row.levelName} /></td>
                    <td className="px-2 py-2.5 text-right">{count(row.delivered)}</td>
                    <td className="px-2 py-2.5 text-right font-bold">{naira(row.spend)}</td>
                    <td className="px-3 py-2.5 text-right">{count(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
