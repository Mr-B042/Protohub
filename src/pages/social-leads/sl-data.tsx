import { useEffect, useRef, useState } from "react";
import { Banknote, MessageSquareText, MessagesSquare, ShoppingCart, Truck, Users } from "lucide-react";
import { socialLeadsApi, type SlStats } from "../../lib/api";
import { Kpi, fromChange, money, num, rangeLabel } from "./sl-ui";

/** Load something and reload when the key changes; keeps the last answer while reloading. */
export function useLoad<T>(load: () => Promise<T>, key: string, everyMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    let live = true;
    setBusy(true);
    loader.current().then((d) => { if (live) { setData(d); setError(""); } }).catch((e: Error) => { if (live) setError(e.message || "Could not load."); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [key, tick]);
  useEffect(() => {
    if (!everyMs) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return { data, error, busy, reload: () => setTick((n) => n + 1), setData };
}

export function useStats(params: Record<string, string | undefined>) {
  const key = JSON.stringify(params);
  return useLoad(() => socialLeadsApi.stats(params), key);
}

const vsText = (range: string) => (range === "today" ? "yesterday" : range === "yesterday" ? "the day before" : range === "all" || range === "custom" ? undefined : `previous ${rangeLabel(range).replace("Last ", "").toLowerCase()}`);

/** The six cards on Inbox / Overview / All Leads / Analytics (Bright's designs). */
export function KpiRow({ stats, first = "captured", labelOnTop }: { stats: SlStats | null; first?: "captured" | "total"; labelOnTop?: boolean }) {
  const c = stats?.cards;
  const vs = stats ? vsText(stats.filters.range) : undefined;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi icon={first === "captured" ? MessageSquareText : Users} tone="purple" value={num(first === "captured" ? c?.captured.value : c?.total.value)} label={first === "captured" ? "Comments Captured" : "Total Leads"} {...fromChange(first === "captured" ? c?.captured : c?.total)} vs={vs} labelOnTop={labelOnTop} />
      <Kpi icon={MessagesSquare} tone="blue" value={num(c?.engaged.value)} label="Engaged Leads" {...fromChange(c?.engaged)} labelOnTop={labelOnTop} />
      <Kpi icon={Users} tone="indigo" value={num(c?.assigned.value)} label="Assigned Leads" {...fromChange(c?.assigned)} labelOnTop={labelOnTop} />
      <Kpi icon={ShoppingCart} tone="red" value={num(c?.orders.value)} label="Orders Created" {...fromChange(c?.orders)} labelOnTop={labelOnTop} />
      <Kpi icon={Truck} tone="green" value={num(c?.delivered.value)} label="Delivered Orders" {...fromChange(c?.delivered)} labelOnTop={labelOnTop} />
      <Kpi icon={Banknote} tone="green" value={money(c?.revenue.value)} label="Delivered Revenue" {...fromChange(c?.revenue)} labelOnTop={labelOnTop} />
    </div>
  );
}
