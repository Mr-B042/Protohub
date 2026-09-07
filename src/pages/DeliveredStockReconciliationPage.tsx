import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Box, Check, CheckCircle2, ChevronRight, CircleHelp,
  MapPin, Package, RefreshCw, Search, Users, X
} from "lucide-react";
import {
  deliveredStockReconciliationApi,
  type DeliveredStockReconciliationRow
} from "../lib/api";
import { PERIODS, periodBounds, periodRangeLabel, type DateRange, type Period } from "../lib/period-bounds";
import DateWindowNav from "../components/DateWindowNav";

/** "All time" is not a Period - it is the absence of a window. */
type Scope = Period | "All time";
const SCOPES: Scope[] = ["All time", ...PERIODS];

const count = (value: number) => Math.max(0, Math.round(value)).toLocaleString("en-NG");
const lower = (value: unknown) => String(value ?? "").trim().toLowerCase();
const pending = (row: DeliveredStockReconciliationRow) => row.status === "pending";
const outstanding = (row: DeliveredStockReconciliationRow) => row.status === "pending" || row.status === "exception";
const sumQty = (rows: DeliveredStockReconciliationRow[]) => rows.reduce((sum, row) => sum + row.quantity, 0);
const uniqueOrders = (rows: DeliveredStockReconciliationRow[]) => new Set(rows.map((row) => row.orderId)).size;

type Group = { key: string; name: string; rows: DeliveredStockReconciliationRow[] };
const groupRows = (rows: DeliveredStockReconciliationRow[], key: (row: DeliveredStockReconciliationRow) => string, name: (row: DeliveredStockReconciliationRow) => string): Group[] => {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const id = key(row);
    const found = groups.get(id);
    if (found) found.rows.push(row);
    else groups.set(id, { key: id, name: name(row), rows: [row] });
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
};

function Status({ value }: { value: DeliveredStockReconciliationRow["status"] }) {
  const style = value === "reconciled" ? "bg-emerald-100 text-emerald-700"
    : value === "exception" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700";
  return <span className={`rounded-md px-2 py-1 text-[10px] font-bold capitalize ${style}`}>{value}</span>;
}

export default function DeliveredStockReconciliationPage() {
  const [rows, setRows] = useState<DeliveredStockReconciliationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [stateKey, setStateKey] = useState("");
  const [agentKey, setAgentKey] = useState("");
  const [productKey, setProductKey] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);
  const [flagging, setFlagging] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  // ⚠️ DEFAULTS TO ALL TIME, and that is deliberate. This is a work queue, not
  // a report: a default window that happens to exclude an old pending line
  // shows "All delivered stock is reconciled" over stock that never came off
  // the shelf. The officer narrows it by choice; the page never narrows it for
  // them.
  const [scope, setScope] = useState<Scope>("All time");
  const [range, setRange] = useState<DateRange>({ start: "", end: "" });

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await deliveredStockReconciliationApi.list();
      setRows(result.rows ?? []);
    } catch (cause: any) {
      setError(cause?.message ?? "Could not load delivered stock reconciliation.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const todayKey = useMemo(() => new Date().toISOString().slice(0, 10), []);
  // ⚠️ ONE SOURCE OF TRUTH. The pills and the calendar are two ways to set the
  // SAME window: a pill writes its bounds into `range`, and the calendar writes
  // its own. `scope` only records which pill looks selected. Letting each hold
  // its own dates is how a page ends up filtering by one window while the label
  // above it names another.
  const bounds = useMemo(() => {
    if (scope === "All time") return null;
    if (range.start && range.end) return { dateFrom: range.start, dateTo: range.end };
    return periodBounds(scope, range);
  }, [scope, range]);
  const applyPeriod = (option: Scope) => {
    setScope(option);
    if (option === "All time") { setRange({ start: "", end: "" }); return; }
    const next = periodBounds(option, range);
    setRange(next ? { start: next.dateFrom, end: next.dateTo } : { start: "", end: "" });
  };
  // ⚠️ ONE WINDOW, APPLIED ONCE. Everything below - the columns, the product
  // groups, the modal and the deduct buttons - reads from `scoped`, so what is
  // on screen is exactly what a Reconcile button will post. Filtering the list
  // but not the modal would let "Reconcile & Deduct Group" take rows the
  // officer had filtered away and never saw.
  const scoped = useMemo(() => {
    if (!bounds) return rows;
    return rows.filter((row) => {
      const day = String(row.deliveredAt).slice(0, 10);
      return day >= bounds.dateFrom && day <= bounds.dateTo;
    });
  }, [rows, bounds]);
  // Outstanding work the window is hiding. Never left silent.
  const hiddenOutstanding = useMemo(() => {
    if (!bounds) return [] as DeliveredStockReconciliationRow[];
    const shown = new Set(scoped.map((row) => row.id));
    return rows.filter((row) => outstanding(row) && !shown.has(row.id));
  }, [rows, scoped, bounds]);

  const openRows = useMemo(() => scoped.filter(outstanding), [scoped]);
  const states = useMemo(() => groupRows(openRows, (row) => lower(row.state) || "unassigned", (row) => row.state || "Unassigned"), [openRows]);
  useEffect(() => {
    if (!stateKey || !states.some((group) => group.key === stateKey)) setStateKey(states[0]?.key ?? "");
  }, [states, stateKey]);
  const stateRows = states.find((group) => group.key === stateKey)?.rows ?? [];
  const agents = useMemo(() => groupRows(stateRows, (row) => row.agentId, (row) => row.agentName), [stateRows]);
  useEffect(() => {
    if (!agentKey || !agents.some((group) => group.key === agentKey)) setAgentKey(agents[0]?.key ?? "");
  }, [agents, agentKey]);
  const agentRows = agents.find((group) => group.key === agentKey)?.rows ?? [];
  const products = useMemo(() => groupRows(agentRows, (row) => row.productId, (row) => row.productName), [agentRows]);
  useEffect(() => {
    if (!productKey || !products.some((group) => group.key === productKey)) setProductKey(products[0]?.key ?? "");
  }, [products, productKey]);
  const productPendingRows = products.find((group) => group.key === productKey)?.rows ?? [];
  const productHistoryRows = useMemo(() => {
    if (!agentKey || !productKey) return [];
    return scoped.filter((row) => row.agentId === agentKey && row.productId === productKey)
      .sort((a, b) => String(a.deliveredAt).localeCompare(String(b.deliveredAt))).slice(-200);
  }, [scoped, agentKey, productKey]);
  const eligibleRows = productHistoryRows.filter(pending);
  const chosenRows = productHistoryRows.filter((row) => selected.has(row.id) && pending(row));
  const selectedUnits = sumQty(chosenRows);
  const currentStock = productHistoryRows[0]?.currentStock ?? 0;
  const selectedAfter = currentStock - selectedUnits;
  const selectedAgent = agents.find((group) => group.key === agentKey);
  const selectedProduct = products.find((group) => group.key === productKey);

  const chooseProduct = (key: string, open = false) => {
    setProductKey(key); setSelected(new Set()); setFlagging(false); setIssueNote("");
    if (open) setModalOpen(true);
  };
  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allEligibleSelected = eligibleRows.length > 0 && eligibleRows.every((row) => selected.has(row.id));
  const toggleAll = () => setSelected(allEligibleSelected ? new Set() : new Set(eligibleRows.map((row) => row.id)));

  const reconcile = async (lineIds: string[]) => {
    if (lineIds.length === 0 || working) return;
    setWorking(true); setError("");
    try {
      await deliveredStockReconciliationApi.reconcile(lineIds);
      setSelected(new Set()); setModalOpen(false); await load();
    } catch (cause: any) { setError(cause?.message ?? "Could not reconcile selected stock."); }
    finally { setWorking(false); }
  };
  const flag = async () => {
    const ids = [...selected];
    if (ids.length === 0 || issueNote.trim().length < 3 || working) return;
    setWorking(true); setError("");
    try {
      await deliveredStockReconciliationApi.flag(ids, issueNote.trim());
      setSelected(new Set()); setFlagging(false); setIssueNote(""); setModalOpen(false); await load();
    } catch (cause: any) { setError(cause?.message ?? "Could not flag selected stock."); }
    finally { setWorking(false); }
  };
  const resolveIssue = async (lineId: string) => {
    if (working) return;
    setWorking(true); setError("");
    try { await deliveredStockReconciliationApi.resolve(lineId); await load(); }
    catch (cause: any) { setError(cause?.message ?? "Could not return this issue to Pending."); }
    finally { setWorking(false); }
  };

  const q = lower(query);
  const visibleStates = states.filter((group) => !q || lower(group.name).includes(q));
  const today = new Date().toISOString().slice(0, 10);
  const deliveredToday = rows.filter((row) => String(row.deliveredAt).slice(0, 10) === today);

  return <div className="space-y-3 text-gray-900">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h1 className="text-2xl font-black tracking-tight">Delivered Stock Reconciliation</h1><p className="mt-1 text-sm text-gray-500">Group by state, agent and product. Verify delivered orders and manually post stock deductions.</p></div>
      <button type="button" onClick={() => setShowHelp((value) => !value)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-bold text-blue-700"><CircleHelp className="h-4 w-4" />How it works</button>
    </header>
    {showHelp && <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><strong>Delivered → Pending → Verified → Deducted.</strong> Checking orders only previews the result. Stock and its ledger entry change together after you press Deduct Selected.</div>}

    <div className="rounded-lg border border-gray-200 bg-white px-3 py-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        {SCOPES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => applyPeriod(option)}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
              scope === option ? "bg-gray-900 text-white shadow-sm" : "text-gray-600 hover:bg-gray-100"}`}
          >
            {option}
          </button>
        ))}
        <span className="ml-auto text-xs font-semibold text-gray-500">
          {scope === "All time"
            ? `Every delivered line · ${count(rows.length)} row${rows.length === 1 ? "" : "s"}`
            : periodRangeLabel(scope, range)}
        </span>
      </div>
      {/* The app's own range picker - quick ranges, a two-month calendar and a
          window size - rather than a second one built for this page. Choosing
          here makes the window Custom, because a hand-picked range is no longer
          the pill that happened to be lit. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        <DateWindowNav
          value={range.start && range.end ? range : { start: todayKey, end: todayKey }}
          onChange={(next) => { setScope("Custom"); setRange(next); }}
          todayKey={todayKey}
        />
        {scope !== "All time" && (
          <button type="button" onClick={() => applyPeriod("All time")}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-gray-600 hover:bg-gray-100">
            Clear window
          </button>
        )}
      </div>
    </div>

    {/* ⚠️ A FILTER MUST NEVER QUIETLY SWALLOW OUTSTANDING STOCK. Without this the
        empty state below would read "All delivered stock is reconciled" while
        units sat pending outside the chosen window - the same lie a date filter
        told on the waybill and expenses pages. */}
    {hiddenOutstanding.length > 0 && (
      <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
        <span className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {count(sumQty(hiddenOutstanding))} unit{sumQty(hiddenOutstanding) === 1 ? "" : "s"} across {uniqueOrders(hiddenOutstanding)} order{uniqueOrders(hiddenOutstanding) === 1 ? "" : "s"} are still pending outside this window.
        </span>
        <button type="button" onClick={() => { setScope("All time"); setRange({ start: "", end: "" }); }}
          className="shrink-0 rounded-lg border border-amber-400 bg-white px-4 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-100">
          Show all
        </button>
      </div>
    )}
    {error && <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700"><AlertTriangle className="h-4 w-4" />{error}</div>}

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {([
        ["Delivered Orders (Today)", uniqueOrders(deliveredToday), `${count(sumQty(deliveredToday))} units`, Box, "bg-blue-100 text-blue-700"],
        ["Units Pending Deduction", sumQty(openRows), `Across ${uniqueOrders(openRows)} orders`, Package, "bg-orange-100 text-orange-700"],
        ["Active Agents", new Set(openRows.map((row) => row.agentId)).size, "With delivered orders", Users, "bg-emerald-100 text-emerald-700"],
        ["Exceptions", rows.filter((row) => row.status === "exception").length, "Need attention", AlertTriangle, "bg-rose-100 text-rose-700"]
      ] as Array<[string, number, string, typeof Box, string]>).map(([label, value, helper, Icon, tone]) => <div key={label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"><div className="flex gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span><div><p className="text-xs font-semibold text-gray-500">{label}</p><p className="text-2xl font-black">{count(value)}</p><p className="text-[11px] text-gray-400">{helper}</p></div></div></div>)}
    </div>

    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
      <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap"><b className="rounded-full bg-blue-600 px-2 py-1 text-white">1</b> Select State <ChevronRight className="h-3 w-3" /><b className="rounded-full bg-blue-500 px-2 py-1 text-white">2</b> Select Agent <ChevronRight className="h-3 w-3" /><b className="rounded-full bg-blue-400 px-2 py-1 text-white">3</b> Product Group <ChevronRight className="h-3 w-3" /><b className="rounded-full bg-blue-300 px-2 py-1 text-white">4</b> Verify Orders <ChevronRight className="h-3 w-3" /><b className="rounded-full bg-blue-200 px-2 py-1 text-blue-900">5</b> Reconcile</div>
      <button type="button" onClick={() => void load()} className="ml-3 rounded-md p-2 text-blue-600" title="Refresh"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
    </div>

    {loading && rows.length === 0 ? <div className="rounded-xl border border-gray-200 bg-white p-16 text-center text-sm text-gray-400">Loading delivered stock…</div> : openRows.length === 0 ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-16 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><h2 className="mt-3 font-black text-emerald-900">{scope === "All time" ? "All delivered stock is reconciled" : `Nothing pending in ${scope === "Custom" ? "this range" : scope.toLowerCase()}`}</h2><p className="mt-1 text-sm text-emerald-700">{scope === "All time" ? "New delivered orders will appear here automatically." : "This is the chosen window only — switch to All time to see the whole queue."}</p></div> : <div className="grid gap-3 xl:grid-cols-[0.8fr_0.8fr_1.6fr]">
      <section className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm"><h2 className="px-2 py-2 text-sm font-black text-blue-700">States ({states.length})</h2><div className="relative mb-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search state…" className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm" /></div>{visibleStates.map((group) => <button type="button" key={group.key} onClick={() => { setStateKey(group.key); setAgentKey(""); setProductKey(""); }} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left ${stateKey === group.key ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-gray-50"}`}><MapPin className="h-4 w-4 text-blue-500" /><span className="flex-1 font-bold">{group.name}</span><span className="text-xs text-gray-500">{uniqueOrders(group.rows)} · {count(sumQty(group.rows))}</span><ChevronRight className="h-4 w-4" /></button>)}</section>
      <section className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm"><h2 className="px-2 py-2 text-sm font-black text-blue-700">Agents in {states.find((group) => group.key === stateKey)?.name ?? "State"} ({agents.length})</h2>{agents.map((group) => <button type="button" key={group.key} onClick={() => { setAgentKey(group.key); setProductKey(""); }} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-3 text-left ${agentKey === group.key ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-gray-50"}`}><Users className="h-4 w-4 text-blue-500" /><span className="flex-1 font-bold">{group.name}</span><span className="text-xs text-gray-500">{uniqueOrders(group.rows)} · {count(sumQty(group.rows))}</span><ChevronRight className="h-4 w-4" /></button>)}</section>
      <section className="rounded-lg border border-gray-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-black">{selectedAgent?.name ?? "Select an agent"} — {states.find((group) => group.key === stateKey)?.name}</h2><p className="text-xs text-gray-500">{uniqueOrders(agentRows)} delivered orders · {count(sumQty(agentRows))} units pending</p></div>{agentRows.filter(pending).length > 0 && <button type="button" disabled={working || agentRows.filter(pending).length > 100} onClick={() => { const eligible = agentRows.filter(pending); if (window.confirm(`Deduct ${sumQty(eligible)} units across ${uniqueOrders(eligible)} delivered orders for ${selectedAgent?.name}?`)) void reconcile(eligible.map((row) => row.id)); }} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Reconcile All ({count(sumQty(agentRows.filter(pending)))} Units)</button>}</div><div className="p-2"><div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-[10px] font-bold uppercase text-gray-400"><span>Product Group</span><span>Orders / Units</span><span>Action</span></div>{products.map((group) => <div key={group.key} className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-lg border px-3 py-3 ${productKey === group.key ? "border-blue-300 bg-blue-50" : "border-transparent hover:bg-gray-50"}`}><button type="button" onClick={() => chooseProduct(group.key)} className="flex min-w-0 items-center gap-2 text-left"><span className="rounded-lg bg-orange-50 p-2 text-orange-600"><Package className="h-4 w-4" /></span><span className="truncate text-sm font-bold">{group.name}</span></button><span className="text-right text-xs text-gray-600">{uniqueOrders(group.rows)} · <b>{count(sumQty(group.rows))}</b></span><button type="button" onClick={() => chooseProduct(group.key, true)} className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-bold text-blue-700">View Orders</button></div>)}</div>
        {selectedProduct && <div className="m-2 flex flex-col gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-black">{selectedProduct.name}</p><p className="text-xs text-gray-600">{uniqueOrders(productPendingRows)} delivered orders · {count(sumQty(productPendingRows))} units pending deduction</p></div><button type="button" onClick={() => { setSelected(new Set(eligibleRows.map((row) => row.id))); setModalOpen(true); }} className="rounded-lg border border-orange-400 bg-white px-4 py-2 text-xs font-bold text-orange-700">Reconcile & Deduct Group ({count(sumQty(productPendingRows.filter(pending)))} Units)</button></div>}
      </section>
    </div>}

    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"><b>Important:</b> Checking orders only previews the result. The final action deducts from the exact agent location and posts the matching immutable ledger entries in one transaction.</div>

    {modalOpen && selectedProduct && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3" onMouseDown={(event) => { if (event.currentTarget === event.target && !working) setModalOpen(false); }}><div className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-white shadow-2xl"><div className="flex items-start justify-between p-5"><div><h2 className="text-xl font-black">View Delivered Orders</h2><p className="text-sm text-gray-500">Select orders to deduct from agent stock.</p></div><button type="button" disabled={working} onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button></div>
      <div className="mx-5 rounded-lg border border-gray-200 p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row"><div><p className="text-lg font-black">{selectedProduct.name}</p><p className="text-xs text-blue-600">Agent Stock</p></div><div><p className="text-xs text-gray-500">Agent</p><p className="font-black">{selectedAgent?.name}</p><p className="text-xs text-gray-500">{states.find((group) => group.key === stateKey)?.name}</p></div></div></div>
      <div className="grid grid-cols-2 gap-2 p-5 lg:grid-cols-4">{[["Current Agent Stock", currentStock], ["Pending Delivered Qty", sumQty(eligibleRows)], ["Selected for Deduction", selectedUnits], ["Projected Stock After", selectedAfter]].map(([label, value], index) => <div key={String(label)} className={`rounded-lg border p-3 ${index === 3 ? "border-blue-200 bg-blue-50" : "border-gray-200"}`}><p className="text-xs text-gray-500">{label}</p><p className="text-2xl font-black">{count(Number(value))} <span className="text-xs font-medium text-gray-400">units</span></p></div>)}</div>
      <div className="px-5 pb-4"><div className="flex items-center justify-between border-y border-gray-100 py-3"><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={allEligibleSelected} onChange={toggleAll} disabled={eligibleRows.length === 0} />Select All ({eligibleRows.length} orders · {count(sumQty(eligibleRows))} units)</label><span className="text-xs text-gray-500">Reconciled rows are locked</span></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="bg-gray-50 text-[10px] uppercase text-gray-500"><tr><th className="p-3"></th><th>Order</th><th>Delivered</th><th>Customer</th><th>Qty</th><th>Current Stock → After</th><th>Status</th></tr></thead><tbody>{(() => { let running = currentStock; return productHistoryRows.map((row) => { const before = running; if (pending(row)) running -= row.quantity; const locked = row.status !== "pending"; return <tr key={row.id} className="border-b border-gray-100"><td className="p-3"><input type="checkbox" checked={row.status === "reconciled" || selected.has(row.id)} disabled={locked} onChange={() => toggle(row.id)} /></td><td className="font-bold">{row.orderId}</td><td>{new Date(row.deliveredAt).toLocaleString("en-NG", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" })}</td><td>{row.customer}</td><td className="font-bold">{count(row.quantity)}</td><td>{locked ? "—" : `${count(before)} → ${count(running)}`}</td><td><Status value={row.status} /></td></tr>; }); })()}</tbody></table></div></div>
      <div className="mx-5 rounded-lg border border-blue-100 bg-blue-50 p-4"><p className="text-xs font-black text-blue-900">Live Deduction Preview</p><div className="mt-3 grid grid-cols-4 gap-3 text-center"><div><b className="text-xl">{count(currentStock)}</b><p className="text-[10px] text-gray-500">Current</p></div><div><b className="text-xl">{chosenRows.length}</b><p className="text-[10px] text-gray-500">Orders</p></div><div><b className="text-xl">−{count(selectedUnits)}</b><p className="text-[10px] text-gray-500">Deduction</p></div><div><b className={`text-xl ${selectedAfter < 0 ? "text-rose-600" : "text-blue-700"}`}>{count(selectedAfter)}</b><p className="text-[10px] text-gray-500">New Stock</p></div></div></div>
      {flagging && <div className="mx-5 mt-4"><textarea value={issueNote} onChange={(event) => setIssueNote(event.target.value)} placeholder="Describe the quantity, product, agent, or delivery issue…" className="min-h-20 w-full rounded-lg border border-rose-200 p-3 text-sm" /></div>}
      <div className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end"><button type="button" onClick={() => setModalOpen(false)} disabled={working} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-bold">Cancel</button>{flagging ? <button type="button" onClick={() => void flag()} disabled={working || selected.size === 0 || issueNote.trim().length < 3} className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">Submit Issue</button> : <button type="button" onClick={() => setFlagging(true)} disabled={working || selected.size === 0} className="rounded-lg border border-rose-300 px-5 py-2 text-sm font-bold text-rose-700 disabled:opacity-40">Flag Issue</button>}<button type="button" onClick={() => void reconcile([...selected])} disabled={working || selected.size === 0 || selectedAfter < 0} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white disabled:bg-gray-200 disabled:text-gray-400">{working ? "Posting…" : `Deduct Selected (${count(selectedUnits)} Units)`}</button></div>
    </div></div>}
  </div>;
}
