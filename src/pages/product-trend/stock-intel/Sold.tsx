import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Check, ChevronDown, ChevronRight, Download, Filter, Loader2, Package, Search, X } from "lucide-react";
import DateWindowNav from "../../../components/DateWindowNav";
import { PRESET_LABEL, presetRange, shiftDay, windowSize, type DateWindow, type PresetKey } from "../../../lib/date-window";
import { stockIntelApi, type StockSoldData } from "../../../lib/api";
import { SERIES_COLORS, downloadCsv, nf } from "../parts";
import { Card, CardHead, one, place, type IntelCtx } from "./shared";

// ── Overview › Pieces Sold (Bright, 24 Nov 2026) ────────────────────────────
// Pieces DELIVERED per product, per day, per state, per agent, for any dates
// (backend/src/lib/stock-sold.ts). Its date filter is its own: the stock
// figures above and below are about stock right now and do not move with it.

const CHIPS: PresetKey[] = ["today", "yesterday", "thisWeek", "lastWeek", "thisMonth", "lastMonth"];
type GroupBy = "product" | "state" | "agent" | "productState" | "productAgent";
const GROUPS: Array<{ value: GroupBy; label: string }> = [
  { value: "product", label: "By Product" }, { value: "state", label: "By State" }, { value: "agent", label: "By Agent" },
  { value: "productState", label: "Product by State" }, { value: "productAgent", label: "Product by Agent" }
];
type Sort = "most" | "fewest" | "name";
const MAX_DAY_COLUMNS = 62;
const lagosToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
const shortDay = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const daysOf = (w: DateWindow) => { const out: string[] = []; for (let d = w.start; d <= w.end && out.length < 400; d = shiftDay(d, 1)) out.push(d); return out; };

type WithIt = { itemId: string; kind: "gift" | "cross_sell" | "extra" | "package"; pieces: number };
type Sub = { key: string; label: string; pieces: number; orders: number; byDay: Map<string, number> };
type Group = { key: string; first: string; second: string | null; pieces: number; orders: number; byDay: Map<string, number>; withIt: WithIt[]; subs: Sub[] };
/** What a row opens into: a state → its agents, an agent → its products, a product → its states. */
const SUB_OF: Record<GroupBy, { dim: "agent" | "product" | "state"; title: string }> = {
  state: { dim: "agent", title: "Agents in this state" }, agent: { dim: "product", title: "Products this agent sold" },
  product: { dim: "state", title: "States this product sold in" }, productState: { dim: "agent", title: "Agents" }, productAgent: { dim: "state", title: "States" }
};
const KIND_TEXT: Record<WithIt["kind"], string> = { gift: "free gift", cross_sell: "cross-sell", extra: "extra item", package: "in the package" };
const KIND_TONE: Record<WithIt["kind"], string> = {
  gift: "bg-pink-50 text-pink-800 ring-pink-200", cross_sell: "bg-violet-50 text-violet-800 ring-violet-200",
  extra: "bg-amber-50 text-amber-800 ring-amber-200", package: "bg-slate-50 text-slate-700 ring-slate-200"
};

export function SoldSection({ ctx }: { ctx: IntelCtx }) {
  const todayKey = ctx.data.today || lagosToday();
  const [range, setRange] = useState<DateWindow>(() => presetRange("today", todayKey));
  const [sold, setSold] = useState<StockSoldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [groupBy, setGroupBy] = useState<GroupBy>("product");
  const [sort, setSort] = useState<Sort>("most");
  const [search, setSearch] = useState("");
  const [eachDay, setEachDay] = useState(false);
  // Custom filters: any mix of products, states and agents at once (empty = all).
  const [pickProducts, setPickProducts] = useState<string[]>([]);
  const [pickStates, setPickStates] = useState<string[]>([]);
  const [pickAgents, setPickAgents] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    stockIntelApi.sold({ start: range.start, end: range.end, productId: ctx.productId })
      .then((r) => { if (!cancelled) setSold(r); })
      .catch((e: any) => { if (!cancelled) setError(e?.message ?? "Could not count the pieces sold."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range.start, range.end, ctx.productId, tick]);

  const agentName = useMemo(() => new Map((sold?.agents ?? []).map((a) => [a.id, a.name])), [sold]);
  const nameOfAgent = (id: string) => (id ? agentName.get(id) ?? "Delivery agent" : "No agent");
  const days = useMemo(() => daysOf(range), [range]);
  // The tab's own product picker replaces this one; drop picks it would hide.
  useEffect(() => { if (ctx.productId) setPickProducts([]); }, [ctx.productId]);
  const filtering = pickProducts.length + pickStates.length + pickAgents.length > 0;
  // Every loaded day, with the product / state / agent filters applied.
  const kept = useMemo(() => {
    const p = new Set(pickProducts), st = new Set(pickStates), a = new Set(pickAgents);
    return (sold?.lines ?? []).filter((l) => (!p.size || p.has(l.productId)) && (!st.size || st.has(l.state)) && (!a.size || a.has(l.agentId)));
  }, [sold, pickProducts, pickStates, pickAgents]);
  const keptCells = useMemo(() => {
    const st = new Set(pickStates), a = new Set(pickAgents);
    return (sold?.orderCells ?? []).filter((c) => (!st.size || st.has(c.state)) && (!a.size || a.has(c.agentId)));
  }, [sold, pickStates, pickAgents]);
  const lines = useMemo(() => kept.filter((l) => l.day >= range.start && l.day <= range.end), [kept, range]);
  const cells = useMemo(() => keptCells.filter((c) => c.day >= range.start && c.day <= range.end), [keptCells, range]);
  // Gifts and add-ons: never products of their own, only shown inside the main product.
  const extras = useMemo(() => {
    const p = new Set(pickProducts), st = new Set(pickStates), a = new Set(pickAgents);
    return (sold?.extras ?? []).filter((e) => e.day >= range.start && e.day <= range.end
      && (!p.size || p.has(e.productId)) && (!st.size || st.has(e.state)) && (!a.size || a.has(e.agentId)));
  }, [sold, range, pickProducts, pickStates, pickAgents]);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = (key: string) => setOpenRows((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const chipCount = (preset: PresetKey) => {
    const r = presetRange(preset, todayKey);
    return kept.filter((l) => l.day >= r.start && l.day <= r.end).reduce((s, l) => s + l.pieces, 0);
  };

  // Choices come from every loaded day, so a pick does not vanish when the dates change.
  const options = useMemo(() => {
    const all = sold?.lines ?? [];
    // Counts are for the picked dates; names sold earlier stay listed (0) so a pick never vanishes.
    const inRange = (day: string) => day >= range.start && day <= range.end;
    const count = (key: (l: (typeof all)[number]) => string) => { const m = new Map<string, number>(); for (const l of all) m.set(key(l), (m.get(key(l)) ?? 0) + (inRange(l.day) ? l.pieces : 0)); return m; };
    const asList = (m: Map<string, number>, label: (k: string) => string) => [...m].map(([value, n]) => ({ value, label: label(value), n })).sort((x, y) => y.n - x.n);
    return {
      products: asList(count((l) => l.productId), ctx.productName),
      states: asList(count((l) => l.state), place),
      // Agents narrow to the picked states / products, so "Lagos" lists only agents that sold in Lagos.
      agents: asList((() => {
        const st = new Set(pickStates), p = new Set(pickProducts), m = new Map<string, number>();
        for (const l of all) if ((!st.size || st.has(l.state)) && (!p.size || p.has(l.productId))) m.set(l.agentId, (m.get(l.agentId) ?? 0) + (inRange(l.day) ? l.pieces : 0));
        for (const id of pickAgents) if (!m.has(id)) m.set(id, 0);
        return m;
      })(), nameOfAgent)
    };
  }, [sold, ctx, agentName, pickStates, pickProducts, pickAgents, range]);

  const totals = useMemo(() => {
    const pieces = lines.reduce((s, l) => s + l.pieces, 0);
    // With products picked, an order is counted once per picked product it held.
    const orders = pickProducts.length ? lines.reduce((s, l) => s + l.orders, 0) : cells.reduce((s, c) => s + c.orders, 0);
    const perDay = new Map<string, number>();
    for (const l of lines) perDay.set(l.day, (perDay.get(l.day) ?? 0) + l.pieces);
    const best = [...perDay].sort((a, b) => b[1] - a[1])[0];
    const perProduct = new Map<string, number>();
    for (const l of lines) perProduct.set(l.productId, (perProduct.get(l.productId) ?? 0) + l.pieces);
    const top = [...perProduct].sort((a, b) => b[1] - a[1])[0];
    const pastDays = days.filter((d) => d <= todayKey).length || 1;
    return { pieces, orders, perDay, best, top, avg: pieces / pastDays, products: perProduct };
  }, [lines, cells, pickProducts, days, todayKey]);

  // Chart: each day, stacked by the five best-selling products, the rest as "Other".
  const chart = useMemo(() => {
    const top = [...totals.products].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
    const rows = days.map((day) => {
      const entry: Record<string, number | string> = { day, label: shortDay(day) };
      for (const id of top) entry[id] = 0;
      entry.other = 0;
      return entry;
    });
    const at = new Map(rows.map((r) => [r.day as string, r]));
    for (const l of lines) {
      const r = at.get(l.day);
      if (!r) continue;
      const k = top.includes(l.productId) ? l.productId : "other";
      r[k] = (r[k] as number) + l.pieces;
    }
    return { rows, top, hasOther: rows.some((r) => (r.other as number) > 0) };
  }, [lines, days, totals.products]);

  const groups = useMemo(() => {
    const map = new Map<string, Group>();
    const add = (key: string, first: string, second: string | null, day: string, pieces: number, orders: number) => {
      const g = map.get(key) ?? { key, first, second, pieces: 0, orders: 0, byDay: new Map(), withIt: [], subs: [] };
      g.pieces += pieces; g.orders += orders; g.byDay.set(day, (g.byDay.get(day) ?? 0) + pieces);
      map.set(key, g);
      return g;
    };
    const dim = SUB_OF[groupBy].dim;
    const subKey = (l: { productId: string; state: string; agentId: string }) => dim === "agent" ? l.agentId : dim === "product" ? l.productId : l.state;
    const subLabel = (k: string) => dim === "agent" ? nameOfAgent(k) : dim === "product" ? ctx.productName(k) : place(k);
    const addSub = (g: Group, k: string, day: string, pieces: number, orders: number) => {
      let sub = g.subs.find((x) => x.key === k);
      if (!sub) { sub = { key: k, label: subLabel(k), pieces: 0, orders: 0, byDay: new Map() }; g.subs.push(sub); }
      sub.pieces += pieces; sub.orders += orders; sub.byDay.set(day, (sub.byDay.get(day) ?? 0) + pieces);
    };
    // State → agents: an order counted once even if it held two products (order cells).
    const exactAgentOrders = groupBy === "state" && !pickProducts.length;
    for (const l of lines) {
      const product = ctx.productName(l.productId);
      if (groupBy === "product") add(l.productId, product, null, l.day, l.pieces, l.orders);
      else if (groupBy === "productState") add(`${l.productId}|${l.state}`, product, place(l.state), l.day, l.pieces, l.orders);
      else if (groupBy === "productAgent") add(`${l.productId}|${l.agentId}`, product, nameOfAgent(l.agentId), l.day, l.pieces, l.orders);
      else if (groupBy === "state") add(l.state, place(l.state), null, l.day, l.pieces, pickProducts.length ? l.orders : 0);
      else add(l.agentId, nameOfAgent(l.agentId), null, l.day, l.pieces, pickProducts.length ? l.orders : 0);
    }
    const keyOfLine = (x: { productId: string; state: string; agentId: string }) =>
      groupBy === "product" ? x.productId : groupBy === "productState" ? `${x.productId}|${x.state}` : groupBy === "productAgent" ? `${x.productId}|${x.agentId}` : groupBy === "state" ? x.state : x.agentId;
    for (const l of lines) { const g = map.get(keyOfLine(l)); if (g) addSub(g, subKey(l), l.day, l.pieces, exactAgentOrders ? 0 : l.orders); }
    if (exactAgentOrders) for (const c of cells) { const g = map.get(c.state); const sub = g?.subs.find((x) => x.key === c.agentId); if (sub) sub.orders += c.orders; }
    for (const g of map.values()) g.subs.sort((a, b) => b.pieces - a.pieces || a.label.localeCompare(b.label));
    const keyOf = (x: { productId: string; state: string; agentId: string }) =>
      groupBy === "product" ? x.productId : groupBy === "productState" ? `${x.productId}|${x.state}` : groupBy === "productAgent" ? `${x.productId}|${x.agentId}` : groupBy === "state" ? x.state : x.agentId;
    for (const e of extras) {
      const g = map.get(keyOf(e));
      if (!g) continue;
      const found = g.withIt.find((w) => w.itemId === e.itemId && w.kind === e.kind);
      if (found) found.pieces += e.pieces; else g.withIt.push({ itemId: e.itemId, kind: e.kind, pieces: e.pieces });
    }
    for (const g of map.values()) g.withIt.sort((a, b) => b.pieces - a.pieces);
    // By state / agent, an order holding two products is still one order.
    if ((groupBy === "state" || groupBy === "agent") && !pickProducts.length) {
      for (const c of cells) { const g = map.get(groupBy === "state" ? c.state : c.agentId); if (g) g.orders += c.orders; }
    }
    const q = search.trim().toLowerCase();
    const list = [...map.values()].filter((g) => !q || `${g.first} ${g.second ?? ""}`.toLowerCase().includes(q));
    return list.sort((a, b) => sort === "name" ? `${a.first}${a.second}`.localeCompare(`${b.first}${b.second}`) : sort === "fewest" ? a.pieces - b.pieces : b.pieces - a.pieces);
  }, [lines, cells, extras, pickProducts, groupBy, sort, search, ctx, agentName]);

  // States and agents ranked highest to lowest, shown above every view (Bright, 24 Nov 2026).
  const stateSummary = useMemo(() => {
    const map = new Map<string, { state: string; pieces: number; orders: number; agents: Set<string> }>();
    for (const l of lines) {
      const e = map.get(l.state) ?? { state: l.state, pieces: 0, orders: 0, agents: new Set<string>() };
      e.pieces += l.pieces; e.agents.add(l.agentId);
      if (pickProducts.length) e.orders += l.orders;
      map.set(l.state, e);
    }
    if (!pickProducts.length) for (const c of cells) { const e = map.get(c.state); if (e) e.orders += c.orders; }
    return [...map.values()].sort((a, b) => b.pieces - a.pieces || a.state.localeCompare(b.state));
  }, [lines, cells, pickProducts]);
  // Which state(s) each agent's sales came from, for the line under its name.
  const agentStates = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const l of lines) { const m = map.get(l.agentId) ?? new Map<string, number>(); m.set(l.state, (m.get(l.state) ?? 0) + l.pieces); map.set(l.agentId, m); }
    return new Map([...map].map(([id, m]) => [id, [...m].sort((a, b) => b[1] - a[1]).map(([st]) => place(st)).join(", ")]));
  }, [lines]);
  // Agents ranked by pieces sold (orders counted once each when no product is picked).
  const agentSummary = useMemo(() => {
    const map = new Map<string, { agentId: string; pieces: number; orders: number }>();
    for (const l of lines) {
      const e = map.get(l.agentId) ?? { agentId: l.agentId, pieces: 0, orders: 0 };
      e.pieces += l.pieces;
      if (pickProducts.length) e.orders += l.orders;
      map.set(l.agentId, e);
    }
    if (!pickProducts.length) for (const c of cells) { const e = map.get(c.agentId); if (e) e.orders += c.orders; }
    return [...map.values()].sort((a, b) => b.pieces - a.pieces || b.orders - a.orders);
  }, [lines, cells, pickProducts]);
  // Stock left right now (Bright, 26 Nov 2026), for the picked products if any.
  // A waybill sent out of a hub already came off it; "on the way" = still in transit to it.
  const stockBy = useMemo(() => {
    const byState = new Map<string, { left: number; onTheWay: number }>();
    const byAgent = new Map<string, { left: number; onTheWay: number }>();
    for (const row of sold?.stock ?? []) {
      if (pickProducts.length && !pickProducts.includes(row.productId)) continue;
      for (const [map, key] of [[byState, row.state], [byAgent, row.agentId]] as const) {
        const cur = map.get(key) ?? { left: 0, onTheWay: 0 };
        cur.left += row.left; cur.onTheWay += row.onTheWay; map.set(key, cur);
      }
    }
    return { byState, byAgent, loaded: Boolean(sold?.stock) };
  }, [sold, pickProducts]);
  const toggleAgent = (id: string) => setPickAgents((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleState = (state: string) => setPickStates((prev) => prev.includes(state) ? prev.filter((x) => x !== state) : [...prev, state]);

  const showDays = eachDay && days.length <= MAX_DAY_COLUMNS;
  // With only a few rows (e.g. one state picked) they open by themselves.
  const autoOpen = groups.length <= 3;
  const isOpen = (key: string) => (autoOpen ? !openRows.has(key) : openRows.has(key));
  const firstHead = groupBy === "state" ? "State" : groupBy === "agent" ? "Agent" : "Product";
  const secondHead = groupBy === "productState" ? "State" : groupBy === "productAgent" ? "Agent" : null;
  const pastDays = days.filter((d) => d <= todayKey).length || 1;

  const exportCsv = () => downloadCsv(`pieces-sold-${range.start}-to-${range.end}.csv`, [
    [firstHead, ...(secondHead ? [secondHead] : []), "Pieces sold", "Orders", "A day", "Came with", ...days],
    ...groups.flatMap((g) => [
      [g.first, ...(secondHead ? [g.second ?? ""] : []), g.pieces, g.orders, one(g.pieces / pastDays),
        g.withIt.map((w) => `${ctx.productName(w.itemId)} x${w.pieces} (${KIND_TEXT[w.kind]})`).join("; "), ...days.map((d) => g.byDay.get(d) ?? 0)],
      ...g.subs.map((sub) => [`  - ${sub.label}`, ...(secondHead ? [""] : []), sub.pieces, sub.orders, one(sub.pieces / pastDays), "", ...days.map((d) => sub.byDay.get(d) ?? 0)])
    ])
  ]);

  const select = "!min-h-0 h-9 rounded-xl border border-slate-200/80 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  return (
    <Card className="overflow-hidden">
      <div className="p-4 pb-3">
        <CardHead Icon={Package} title="Pieces Sold" info="Pieces of the main product delivered, counted on the day they were delivered. Free gifts, cross-sells and extra items are not counted as products: open a row to see what came with it."
          sub={`Main products delivered, by product, state and agent${ctx.productId ? ` · ${ctx.productName(ctx.productId)}` : ""}`}
          action={<button type="button" onClick={exportCsv} disabled={groups.length === 0} className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200"><Download className="h-4 w-4" />CSV</button>} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-y border-slate-200/80 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/30">
        <div className="inline-flex flex-wrap items-center gap-1">
          {CHIPS.map((preset) => {
            const r = presetRange(preset, todayKey);
            const active = range.start === r.start && range.end === r.end;
            return (
              <button key={preset} type="button" onClick={() => setRange(r)}
                className={`!min-h-0 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all ${active ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" : "text-slate-500 hover:bg-white hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"}`}>
                {PRESET_LABEL[preset]}
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-black tabular-nums ${active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200/70 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`}>{sold ? nf(chipCount(preset)) : "…"}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product, state or agent…"
              className="!min-h-0 h-9 w-full rounded-xl border border-slate-200/80 bg-white pl-9 pr-3 text-sm font-medium text-slate-700 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/20 sm:w-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </div>
          <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} className={select}>{GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}</select>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={select}>
            <option value="most">Most Sold First</option><option value="fewest">Fewest Sold First</option><option value="name">A – Z</option>
          </select>
        </div>
      </div>
      <div className="border-b border-slate-200/80 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/30">
        <DateWindowNav value={range} onChange={setRange} todayKey={todayKey} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/30">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500"><Filter className="h-4 w-4" />Filter:</span>
        {!ctx.productId && <MultiPick label="Products" all="All products" options={options.products} value={pickProducts} onChange={setPickProducts} />}
        <MultiPick label="States" all="All states" options={options.states} value={pickStates} onChange={setPickStates} />
        <MultiPick label="Agents" all="All agents" options={options.agents} value={pickAgents} onChange={setPickAgents} />
        {filtering && (
          <>
            {[...pickProducts.map((v) => ({ v, label: ctx.productName(v), drop: () => setPickProducts(pickProducts.filter((x) => x !== v)) })),
              ...pickStates.map((v) => ({ v, label: place(v), drop: () => setPickStates(pickStates.filter((x) => x !== v)) })),
              ...pickAgents.map((v) => ({ v, label: nameOfAgent(v), drop: () => setPickAgents(pickAgents.filter((x) => x !== v)) }))
            ].map((chip) => (
              <span key={chip.v} className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-sky-50 py-1 pl-2.5 pr-1 text-[12px] font-semibold text-sky-800 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200">
                <span className="truncate">{chip.label}</span>
                <button type="button" aria-label={`Remove ${chip.label}`} onClick={chip.drop} className="!min-h-0 rounded-full p-0.5 hover:bg-sky-100"><X className="h-3 w-3" /></button>
              </span>
            ))}
            <button type="button" onClick={() => { setPickProducts([]); setPickStates([]); setPickAgents([]); }} className="!min-h-0 text-[12.5px] font-semibold text-[#1F8FE0] hover:underline">Clear filters</button>
          </>
        )}
      </div>

      {error ? (
        <div className="m-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          <span>{error}</span>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="!min-h-0 rounded-lg border border-rose-300 bg-white px-3 py-1.5 font-semibold text-rose-700">Try again</button>
        </div>
      ) : (
        <div className={`space-y-4 p-4 transition-opacity ${loading ? "opacity-50" : ""}`}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {([
              ["Pieces sold", nf(totals.pieces), `${windowSize(range)} day${windowSize(range) === 1 ? "" : "s"}`],
              ["Orders delivered", nf(totals.orders), totals.orders > 0 ? `${one(totals.pieces / totals.orders)} pieces an order` : "None yet"],
              ["A day on average", one(totals.avg), "pieces a day"],
              ["Best day", totals.best ? nf(totals.best[1]) : "—", totals.best ? dayName(totals.best[0]) : "No sales yet"],
              ["Best seller", totals.top ? ctx.productName(totals.top[0]) : "—", totals.top ? `${nf(totals.top[1])} pieces` : "No sales yet"]
            ] as Array<[string, string, string]>).map(([label, value, foot]) => (
              <div key={label} className="min-w-0 rounded-xl border border-gray-200 px-3 py-2.5 dark:border-slate-700">
                <div className="text-[11.5px] font-semibold text-gray-500">{label}</div>
                <div className="truncate text-[19px] font-black tracking-tight text-gray-900 dark:text-slate-50">{value}</div>
                <div className="truncate text-[11px] text-gray-500">{foot}</div>
              </div>
            ))}
          </div>

          {days.length > 1 && (
            <div className="min-w-0">
              <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart.rows} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} formatter={(v: number, k: string) => [nf(v), k === "other" ? "Other products" : ctx.productName(k)]} labelFormatter={(_, p) => (p?.[0]?.payload?.day ? dayName(p[0].payload.day) : "")} />
                  {chart.top.map((id, i) => <Bar key={id} dataKey={id} stackId="s" fill={SERIES_COLORS[i % SERIES_COLORS.length]} maxBarSize={36} />)}
                  {chart.hasOther && <Bar dataKey="other" stackId="s" fill="#94a3b8" maxBarSize={36} />}
                </BarChart>
              </ResponsiveContainer>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-gray-600 dark:text-slate-400">
                {chart.top.map((id, i) => <span key={id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />{ctx.productName(id)}</span>)}
                {chart.hasOther && <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />Other products</span>}
              </div>
            </div>
          )}

          {stateSummary.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Ranking title="States" sub="highest to lowest" hint="Click to filter · left = in stock now"
                rows={stateSummary.map((st) => ({ key: st.state, label: place(st.state), pieces: st.pieces, orders: st.orders, note: `${st.agents.size} agent${st.agents.size === 1 ? "" : "s"}`, on: pickStates.includes(st.state), stock: stockBy.loaded ? stockBy.byState.get(st.state) ?? { left: 0, onTheWay: 0 } : undefined }))}
                total={totals.pieces} onPick={toggleState} />
              <Ranking title="Agents" sub="highest to lowest" hint="Click to filter · left = in stock now"
                rows={agentSummary.map((ag) => ({ key: ag.agentId, label: nameOfAgent(ag.agentId), pieces: ag.pieces, orders: ag.orders, note: agentStates.get(ag.agentId) ?? "", on: pickAgents.includes(ag.agentId), stock: stockBy.loaded ? stockBy.byAgent.get(ag.agentId) ?? { left: 0, onTheWay: 0 } : undefined }))}
                total={totals.pieces} onPick={toggleAgent} />
            </div>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12.5px] font-semibold text-gray-600 dark:text-slate-300">{groups.length} row{groups.length === 1 ? "" : "s"} · {GROUPS.find((g) => g.value === groupBy)!.label.toLowerCase()}{loading && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}</span>
              <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={eachDay} onChange={(e) => setEachDay(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                Show each day
              </label>
            </div>
            {eachDay && days.length > MAX_DAY_COLUMNS && <p className="m-0 mb-2 text-[12px] text-amber-700">Pick {MAX_DAY_COLUMNS} days or fewer to see each day. The CSV still has every day.</p>}
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
              <table className={`w-full text-[12.5px] ${showDays ? "!min-w-[720px]" : "!min-w-0"}`}>
                <thead className="bg-gray-50 dark:bg-slate-800/60">
                  <tr className="text-left text-[11px] font-semibold text-gray-500">
                    <th className="sticky left-0 bg-gray-50 px-3 py-2 dark:bg-slate-800">{firstHead}</th>
                    {secondHead && <th className="px-3 py-2">{secondHead}</th>}
                    <th className="px-3 py-2 text-right">Pieces sold</th>
                    <th className="px-3 py-2 text-right">Orders</th>
                    <th className="px-3 py-2 text-right">A day</th>
                    {!showDays && <th className="w-[28%] px-3 py-2">Share</th>}
                    {showDays && days.map((d) => <th key={d} className={`whitespace-nowrap px-2 py-2 text-right ${d === todayKey ? "text-[#1F8FE0]" : ""}`}>{shortDay(d)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.key}>
                    <tr className="border-t border-gray-100 dark:border-slate-800">
                      <td className="sticky left-0 bg-white px-3 py-2 font-semibold text-gray-900 dark:bg-slate-900 dark:text-slate-100">
                        <button type="button" onClick={() => toggleRow(g.key)} aria-expanded={isOpen(g.key)} className="!min-h-0 inline-flex items-start gap-1.5 text-left">
                          <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform ${isOpen(g.key) ? "rotate-90" : ""}`} />
                          <span>{g.first}
                            {groupBy === "agent" && agentStates.get(g.key) && <span className="block text-[11px] font-medium text-gray-500">{agentStates.get(g.key)}</span>}
                            <span className="block text-[11px] font-medium text-gray-500">{g.subs.length} {SUB_OF[groupBy].dim}{g.subs.length === 1 ? "" : "s"}{g.withIt.length > 0 && ` · + ${g.withIt.length} item${g.withIt.length === 1 ? "" : "s"} with it`}</span>
                          </span>
                        </button>
                      </td>
                      {secondHead && <td className="px-3 py-2 text-gray-700 dark:text-slate-300">{g.second}</td>}
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{nf(g.pieces)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{nf(g.orders)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{one(g.pieces / pastDays)}</td>
                      {!showDays && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full rounded-full bg-[#1F8FE0]" style={{ width: `${totals.pieces ? (g.pieces / totals.pieces) * 100 : 0}%` }} /></div>
                            <span className="w-10 text-right text-[11.5px] tabular-nums text-gray-500">{totals.pieces ? Math.round((g.pieces / totals.pieces) * 100) : 0}%</span>
                          </div>
                        </td>
                      )}
                      {showDays && days.map((d) => { const n = g.byDay.get(d) ?? 0; return <td key={d} className={`px-2 py-2 text-right tabular-nums ${n ? "font-semibold text-gray-900 dark:text-slate-100" : "text-gray-300"}`}>{n || "·"}</td>; })}
                    </tr>
                    {isOpen(g.key) && g.subs.map((sub, si) => (
                      <tr key={`${g.key}|${sub.key}`} className="bg-[#f6fafe] text-[12px] dark:bg-slate-900">
                        <td className="sticky left-0 bg-[#f6fafe] py-1.5 pl-[34px] pr-3 text-gray-800 dark:bg-slate-900 dark:text-slate-200">
                          {si === 0 && <span className="mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">{SUB_OF[groupBy].title}</span>}
                          <span className="font-medium">{sub.label}</span>
                        </td>
                        {secondHead && <td />}
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{nf(sub.pieces)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{nf(sub.orders)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">{one(sub.pieces / pastDays)}</td>
                        {!showDays && (
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full rounded-full bg-sky-400" style={{ width: `${g.pieces ? (sub.pieces / g.pieces) * 100 : 0}%` }} /></div>
                              <span className="w-10 text-right text-[11px] tabular-nums text-gray-500" title={`Share of ${g.first}`}>{g.pieces ? Math.round((sub.pieces / g.pieces) * 100) : 0}%</span>
                            </div>
                          </td>
                        )}
                        {showDays && days.map((d) => { const n = sub.byDay.get(d) ?? 0; return <td key={d} className={`px-2 py-1.5 text-right tabular-nums ${n ? "text-gray-900 dark:text-slate-100" : "text-gray-300"}`}>{n || "·"}</td>; })}
                      </tr>
                    ))}
                    {isOpen(g.key) && g.withIt.length > 0 && (
                      <tr className="bg-gray-50/70 dark:bg-slate-800/40">
                        <td colSpan={showDays ? 4 + (secondHead ? 1 : 0) + days.length : 5 + (secondHead ? 1 : 0)} className="px-3 py-2.5 pl-[34px]">
                          <div className="mb-1.5 text-[11px] font-semibold text-gray-500">Came with it (not counted as sold products)</div>
                          <div className="flex flex-wrap gap-1.5">
                            {g.withIt.map((w) => (
                              <span key={`${w.itemId}|${w.kind}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ${KIND_TONE[w.kind]}`}>
                                {ctx.productName(w.itemId)} <b className="tabular-nums">× {nf(w.pieces)}</b><span className="font-medium opacity-75">· {KIND_TEXT[w.kind]}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                  {groups.length === 0 && !loading && (
                    <tr><td colSpan={showDays ? 4 + (secondHead ? 1 : 0) + days.length : 5 + (secondHead ? 1 : 0)} className="py-10 text-center text-gray-500">{search ? "Nothing matches the search." : filtering ? "No pieces delivered on these dates for these filters." : "No pieces delivered on these dates."}</td></tr>
                  )}
                </tbody>
                {groups.length > 1 && (
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 font-bold dark:border-slate-700">
                      <td className="sticky left-0 bg-white px-3 py-2 dark:bg-slate-900">Total{search && " (shown)"}</td>
                      {secondHead && <td />}
                      <td className="px-3 py-2 text-right tabular-nums">{nf(groups.reduce((s, g) => s + g.pieces, 0))}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{(groupBy === "state" || groupBy === "agent") && !pickProducts.length ? nf(groups.reduce((s, g) => s + g.orders, 0)) : ""}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600">{one(groups.reduce((s, g) => s + g.pieces, 0) / pastDays)}</td>
                      {!showDays && <td />}
                      {showDays && days.map((d) => <td key={d} className="px-2 py-2 text-right tabular-nums">{nf(groups.reduce((s, g) => s + (g.byDay.get(d) ?? 0), 0)) || "·"}</td>)}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/** A dropdown of checkboxes: pick any number (none picked = all). Portalled, so a card's overflow never clips it. */
function MultiPick({ label, all, options, value, onChange }: {
  label: string; all: string; options: Array<{ value: string; label: string; n: number }>; value: string[]; onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => { const r = btn.current?.getBoundingClientRect(); if (r) setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 288)), top: r.bottom + 6 }); };
    place();
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  const picked = new Set(value);
  const shown = options.filter((o) => !q.trim() || o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const text = value.length === 0 ? all : value.length === 1 ? options.find((o) => o.value === value[0])?.label ?? `1 ${label.toLowerCase()}` : `${value.length} ${label.toLowerCase()}`;
  return (
    <>
      <button ref={btn} type="button" onClick={() => { setQ(""); setOpen((o) => !o); }}
        className={`!min-h-0 inline-flex h-9 max-w-[220px] items-center gap-1.5 rounded-xl border px-3 text-sm font-bold shadow-sm ${value.length ? "border-sky-300 bg-sky-50 text-sky-800" : "border-slate-200/80 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"}`}>
        <span className="text-slate-400">{label}:</span><span className="truncate">{text}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
      </button>
      {open && pos && createPortal(
        <div ref={panel} style={{ left: pos.left, top: pos.top }} className="fixed z-[80] w-[280px] rounded-xl border border-slate-200/80 bg-white p-2 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${label.toLowerCase()}…`}
            className="!min-h-0 h-8 w-full rounded-lg border border-slate-200/80 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/20 dark:border-slate-700 dark:bg-slate-900" />
          <div className="mt-1.5 flex justify-between px-1 text-[12px] font-semibold">
            <button type="button" onClick={() => onChange([...new Set([...value, ...shown.map((o) => o.value)])])} className="!min-h-0 text-[#1F8FE0]">Select {q ? "shown" : "all"}</button>
            <button type="button" onClick={() => onChange([])} className="!min-h-0 text-slate-500">Clear</button>
          </div>
          <div className="mt-1 max-h-[280px] overflow-y-auto">
            {shown.map((o) => (
              <button key={o.value} type="button" onClick={() => onChange(picked.has(o.value) ? value.filter((v) => v !== o.value) : [...value, o.value])}
                className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800">
                <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${picked.has(o.value) ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-slate-300"}`}>{picked.has(o.value) && <Check className="h-3 w-3" />}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">{o.label}</span>
                <span className="text-[11px] tabular-nums text-slate-400">{nf(o.n)}</span>
              </button>
            ))}
            {shown.length === 0 && <p className="m-0 px-2 py-3 text-center text-[12.5px] text-slate-400">Nothing found.</p>}
          </div>
        </div>, document.body)}
    </>
  );
}

/** A ranked list (highest first): rank, name, share bar, pieces, orders and stock left now. Clicking a row filters to it. */
function Ranking({ title, sub, hint, rows, total, onPick }: {
  title: string; sub: string; hint: string; total: number; onPick: (key: string) => void;
  rows: Array<{ key: string; label: string; pieces: number; orders: number; note: string; on: boolean; stock?: { left: number; onTheWay: number } }>;
}) {
  const withStock = rows.some((r) => r.stock);
  return (
    <div className="min-w-0 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13px] font-bold text-gray-900 dark:text-slate-100">{title} <span className="font-medium text-gray-500">· {sub} · {rows.length}</span></span>
        <span className="text-[11.5px] text-gray-500">{hint}</span>
      </div>
      <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
        {rows.map((r, i) => {
          const share = total ? (r.pieces / total) * 100 : 0;
          return (
            <button key={r.key || "none"} type="button" onClick={() => onPick(r.key)} aria-pressed={r.on}
              className={`!min-h-0 grid w-full ${withStock ? "grid-cols-[22px_minmax(0,1fr)_minmax(48px,0.7fr)_40px_58px_92px]" : "grid-cols-[22px_minmax(0,1fr)_minmax(60px,0.8fr)_44px_64px]"} items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] transition-colors ${r.on ? "bg-sky-50 ring-1 ring-sky-200 dark:bg-sky-500/10" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
              <span className={`text-center text-[11px] font-bold ${i < 3 ? "text-[#1F8FE0]" : "text-gray-400"}`}>{i + 1}</span>
              <span className="min-w-0">
                <span className="block truncate font-semibold text-gray-900 dark:text-slate-100">{r.label}</span>
                {r.note && <span className="block truncate text-[11px] text-gray-500">{r.note}</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-[#1F8FE0]" style={{ width: `${share}%` }} /></span>
                <span className="w-8 text-right text-[10.5px] tabular-nums text-gray-500">{Math.round(share)}%</span>
              </span>
              <span className="text-right text-[14px] font-black tabular-nums text-gray-900 dark:text-slate-50" title="Pieces sold">{nf(r.pieces)}</span>
              <span className="text-right text-[11px] tabular-nums text-gray-500" title="Orders delivered">{nf(r.orders)} order{r.orders === 1 ? "" : "s"}</span>
              {withStock && (
                <span className="flex flex-col items-end" title="In stock right now. Waybills sent out are already taken off; 'on the way' is still in transit to them.">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums ${!r.stock || r.stock.left === 0 ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : r.stock.left + r.stock.onTheWay < r.pieces ? "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"}`}>{nf(r.stock?.left ?? 0)} left</span>
                  {r.stock && r.stock.onTheWay > 0 && <span className="mt-0.5 whitespace-nowrap text-[10px] font-semibold tabular-nums text-sky-600 dark:text-sky-300">+{nf(r.stock.onTheWay)} on the way</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
