import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowUpRight, Banknote, Check, ChevronDown, ChevronLeft, ChevronRight, Database, Download, Eye, FileText, Info,
  MessageSquare, Minus, Package, Percent, Printer, Search, Send, ShoppingCart, Tag, Truck, Wallet, X
} from "lucide-react";
import type { WeeklyRepReport, WeeklyReportCorrection } from "../lib/api";
import type { SnapshotDifference, WeeklyReportSnapshot } from "../pages/weekly-report-model";
import { CORRECTION_SECTION_LABEL } from "../pages/weekly-report-model";

// Rep weekly report review window, built to Bright's image (8 Oct 2026):
// header with the 3-step approval, five match cards, Verification Check,
// Bonus Summary, Issues to Review, System Notes, then every paid order with
// its Base / Upsell / Cross-sell and the workings behind each.

type OrderRow = WeeklyReportSnapshot["orders"][number];
export type WeeklyRepReportModalProps = {
  repName: string; report: WeeklyRepReport | null; frozen: WeeklyReportSnapshot | null; live: WeeklyReportSnapshot | null;
  differences: SnapshotDifference[];
  editedAfterSubmit: Array<{ orderId: string; editedAt: string; what: string; by: string | null }>;
  weekStart: string; weekEnd: string; sym: string; canAct: boolean; canFlag: boolean; corrections: WeeklyReportCorrection[];
  onClose: () => void; onApprove?: () => Promise<void>; onReturn?: () => void; onFlag?: () => void; ownerView?: boolean;
};

const nf = (value: number) => Math.round(value).toLocaleString("en-NG");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayShort = (key: string) => { const [, m, d] = key.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };
const day = (key: string | null | undefined) => (key ? `${dayShort(key)} ${key.slice(0, 4)}` : "—");
// Lagos date + 12-hour time, e.g. "6 Oct 2026, 07:29 PM".
const lagosParts = (iso: string) => {
  const local = new Date(Date.parse(iso) + 3_600_000);
  const hours = local.getUTCHours();
  const time = `${String(hours % 12 || 12).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  return { key: local.toISOString().slice(0, 10), time };
};
const when = (iso: string | null | undefined) => { if (!iso) return ""; const p = lagosParts(iso); return `${day(p.key)}, ${p.time}`; };
const whenShort = (iso: string | null | undefined) => { if (!iso) return ""; const p = lagosParts(iso); return `${dayShort(p.key)}, ${p.time}`; };
const pct = (value: number) => `${Math.round(value)}%`;

type CheckKey = "orders" | "delivered" | "rate" | "products" | "cross" | "upsell" | "base" | "fines" | "final";
const CHECK_ICON: Record<CheckKey, ReactNode> = {
  orders: <ShoppingCart />, delivered: <Truck />, rate: <Percent />, products: <Package />, cross: <Tag />, upsell: <ArrowUpRight />, base: <Database />, fines: <Minus />, final: <Wallet />
};

export default function WeeklyRepReportModal(props: WeeklyRepReportModalProps) {
  const { repName, report, frozen, live, differences, editedAfterSubmit, weekStart, weekEnd, sym, canAct, canFlag, corrections, onClose, onApprove, onReturn, onFlag, ownerView } = props;
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState("");
  const [openCheck, setOpenCheck] = useState<Set<CheckKey>>(new Set());
  const [tile, setTile] = useState<"paid" | "base" | "upsell" | "cross" | "zero">("paid");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [openOrder, setOpenOrder] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const checkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { setPage(1); }, [tile, search, pageSize]);

  const status = report?.status ?? "draft";
  const shown = frozen ?? live;
  const money = (value: number) => `${value < 0 ? "−" : ""}${sym}${nf(Math.abs(value))}`;
  const diffKeys = new Set(differences.map((item) => item.key));
  const productDiff = differences.some((item) => item.key.startsWith("product:"));

  // ---------------------------------------------------------------- checks
  const checks: Array<{ key: CheckKey; label: string; submitted: string; now: string; ok: boolean }> = frozen && live ? [
    { key: "orders", label: "System Orders", submitted: nf(frozen.totals.orders), now: nf(live.totals.orders), ok: !diffKeys.has("orders") },
    { key: "delivered", label: "Delivered", submitted: nf(frozen.totals.delivered), now: nf(live.totals.delivered), ok: !diffKeys.has("delivered") },
    { key: "rate", label: "Delivery Rate", submitted: pct(frozen.totals.deliveryRate), now: pct(live.totals.deliveryRate), ok: !diffKeys.has("deliveryRate") },
    { key: "products", label: "Product Breakdown", submitted: `${frozen.products.length} product${frozen.products.length === 1 ? "" : "s"}`, now: productDiff ? "Changed" : "Verified", ok: !productDiff },
    { key: "cross", label: "Cross-sells", submitted: `${frozen.totals.crossSellOrders} · ${money(frozen.totals.crossSellBonus)}`, now: `${live.totals.crossSellOrders} · ${money(live.totals.crossSellBonus)}`, ok: !diffKeys.has("crossSellOrders") && !diffKeys.has("crossSellBonus") },
    { key: "upsell", label: "Upsells", submitted: `${frozen.totals.upsellOrders} · ${money(frozen.totals.upsellBonus)}`, now: `${live.totals.upsellOrders} · ${money(live.totals.upsellBonus)}`, ok: !diffKeys.has("upsellOrders") && !diffKeys.has("upsellBonus") },
    { key: "base", label: "Base Bonus", submitted: money(frozen.totals.baseBonus), now: money(live.totals.baseBonus), ok: !diffKeys.has("baseBonus") },
    { key: "fines", label: "Fines / Deductions", submitted: money(frozen.totals.fines), now: money(live.totals.fines), ok: !diffKeys.has("fines") },
    { key: "final", label: "Final Payable", submitted: money(frozen.totals.finalBonus), now: money(live.totals.finalBonus), ok: !diffKeys.has("finalBonus") }
  ] : [];
  const matched = checks.filter((row) => row.ok).length;
  const issues = checks.filter((row) => !row.ok);

  // What changed, order by order, for a "Different" line.
  const changeDetail = (key: CheckKey): ReactNode => {
    if (!frozen || !live) return null;
    const before = new Map(frozen.orders.map((order) => [order.id, order]));
    const after = new Map(live.orders.map((order) => [order.id, order]));
    const ids = Array.from(new Set([...before.keys(), ...after.keys()]));
    const lines: string[] = [];
    if (key === "products") {
      const was = new Map(frozen.products.map((row) => [row.key, row]));
      const now = new Map(live.products.map((row) => [row.key, row]));
      for (const productKey of new Set([...was.keys(), ...now.keys()])) {
        const a = was.get(productKey); const b = now.get(productKey);
        if (!a || !b || a.orders !== b.orders || a.delivered !== b.delivered) lines.push(`${(b ?? a)!.name}: ${a ? `${a.orders} orders, ${a.delivered} delivered` : "not in the report"} → ${b ? `${b.orders} orders, ${b.delivered} delivered` : "gone"}`);
      }
    } else if (key === "orders" || key === "delivered" || key === "rate") {
      for (const id of ids) {
        const a = before.get(id); const b = after.get(id);
        const inA = Boolean(a?.placedThisWeek); const inB = Boolean(b?.placedThisWeek);
        if (inA !== inB) lines.push(`#${id}: ${inB ? "now counted this week" : "no longer counted this week"}`);
        else if (inA && a!.status !== b!.status && (a!.status === "Delivered" || b!.status === "Delivered")) lines.push(`#${id}: ${a!.status} → ${b!.status}`);
      }
    } else {
      const part = (order: OrderRow | undefined) => {
        if (!order) return 0;
        const upsell = order.upsellBonus ?? 0; const cross = order.crossSellBonus ?? 0;
        return key === "upsell" ? upsell : key === "cross" ? cross : key === "base" ? order.baseBonus ?? order.bonus - upsell - cross : order.bonus;
      };
      for (const id of ids) { const a = part(before.get(id)); const b = part(after.get(id)); if (a !== b) lines.push(`#${id}: ${money(a)} → ${money(b)}`); }
      if (key === "fines" || key === "final") {
        const fineIds = new Set([...frozen.fines.map((fine) => fine.id), ...live.fines.map((fine) => fine.id)]);
        for (const id of fineIds) {
          const a = frozen.fines.find((fine) => fine.id === id); const b = live.fines.find((fine) => fine.id === id);
          if ((a?.amount ?? 0) !== (b?.amount ?? 0)) lines.push(`Fine "${(b ?? a)!.label}": ${money(a?.amount ?? 0)} → ${money(b?.amount ?? 0)}`);
        }
      }
    }
    return lines.length
      ? <ul className="m-0 list-none space-y-0.5 p-0">{lines.slice(0, 12).map((line) => <li key={line}>• {line}</li>)}{lines.length > 12 ? <li>…and {lines.length - 12} more</li> : null}</ul>
      : <span>The total moved without a single order changing (for example a rule or rate change).</span>;
  };
  const toggleCheck = (key: CheckKey) => { const next = new Set(openCheck); if (next.has(key)) next.delete(key); else next.add(key); setOpenCheck(next); };
  const showAllIssues = () => { setOpenCheck(new Set(issues.map((row) => row.key))); checkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  // ---------------------------------------------------------------- orders
  const inWeek = (key: string | null) => Boolean(key && key >= weekStart && key <= weekEnd);
  const parts = (order: OrderRow) => {
    const upsell = order.upsellBonus ?? 0; const cross = order.crossSellBonus ?? 0;
    return { base: order.baseBonus ?? order.bonus - upsell - cross, upsell, cross, total: order.bonus };
  };
  const delivered = (shown?.orders ?? []).filter((order) => order.status === "Delivered" && inWeek(order.deliveredDate));
  const tiles = {
    paid: delivered.filter((order) => order.bonus > 0), base: delivered.filter((order) => parts(order).base !== 0),
    upsell: delivered.filter((order) => parts(order).upsell !== 0), cross: delivered.filter((order) => parts(order).cross !== 0), zero: delivered.filter((order) => order.bonus === 0)
  };
  const sumOf = (rows: OrderRow[], pick: (p: ReturnType<typeof parts>) => number) => rows.reduce((total, order) => total + pick(parts(order)), 0);
  const q = search.trim().toLowerCase();
  const listed = tiles[tile].filter((order) => !q || `${order.id} ${order.customer} ${order.product}`.toLowerCase().includes(q));
  const pages = Math.max(1, Math.ceil(listed.length / pageSize));
  const pageRows = listed.slice((page - 1) * pageSize, page * pageSize);
  const liveLines = useMemo(() => new Map((live?.orders ?? []).map((order) => [order.id, order.bonusLines])), [live]);
  const toggleOrder = (id: string) => { const next = new Set(openOrder); if (next.has(id)) next.delete(id); else next.add(id); setOpenOrder(next); };

  const exportCsv = (withWorkings: boolean) => {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const head = ["Order", "Customer", "Product", "Placed", "Delivered", "Status", "Base", "Upsell", "Cross-sell", "Total bonus", ...(withWorkings ? ["How it was worked out"] : [])];
    const lines = [head.map(cell).join(",")];
    for (const order of listed) {
      const p = parts(order);
      const workings = (order.bonusLines ?? liveLines.get(order.id) ?? []).map((line) => `${line.label}: ${line.amount ? money(line.amount) : "—"} (${line.note})`).join(" | ");
      lines.push([order.id, order.customer, order.product, order.date, order.deliveredDate ?? "", order.status, p.base, p.upsell, p.cross, p.total, ...(withWorkings ? [workings] : [])].map(cell).join(","));
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    link.download = `${repName.replace(/\s+/g, "-")}-weekly-report-${weekStart}${withWorkings ? "-workings" : ""}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setExportOpen(false);
  };

  // ---------------------------------------------------------------- steps
  const managerDone = Boolean(report?.managerReviewedAt) && ["manager_approved", "owner_approved", "locked"].includes(status);
  const ownerDone = ["owner_approved", "locked"].includes(status);
  const steps = [
    { n: 1, label: "Submitted", sub: report?.submittedAt ? whenShort(report.submittedAt) : "Not yet", done: Boolean(report?.submittedAt) && status !== "draft", active: status === "submitted" },
    { n: 2, label: "Manager Review", sub: status === "returned" ? "Returned to rep" : managerDone ? `Approved ${whenShort(report?.managerReviewedAt)}` : "Pending", done: managerDone, active: status === "manager_approved" },
    { n: 3, label: "Owner Approval", sub: ownerDone ? `Approved ${whenShort(report?.ownerApprovedAt ?? report?.lockedAt)}` : "Pending", done: ownerDone, active: ownerDone }
  ];
  const statusPill = status === "submitted" ? ["Submitted", "bg-emerald-50 text-emerald-700"] : status === "returned" ? ["Returned", "bg-rose-50 text-rose-700"]
    : status === "manager_approved" ? ["Manager approved", "bg-blue-50 text-blue-700"] : ownerDone ? ["Approved", "bg-emerald-50 text-emerald-700"] : ["Not submitted", "bg-gray-100 text-gray-600"];

  const t = shown?.totals;
  const kpis: Array<{ icon: ReactNode; tone: string; label: string; value: string; sub: string; ok: boolean | null }> = shown && t ? [
    { icon: <ShoppingCart />, tone: "bg-blue-50 text-blue-600", label: "System Orders", value: nf((live ?? shown).totals.orders), sub: frozen ? `Submitted: ${nf(frozen.totals.orders)}` : "Not submitted", ok: frozen ? !diffKeys.has("orders") : null },
    { icon: <Truck />, tone: "bg-emerald-50 text-emerald-600", label: "Delivered", value: nf((live ?? shown).totals.delivered), sub: frozen ? `Submitted: ${nf(frozen.totals.delivered)}` : "Not submitted", ok: frozen ? !diffKeys.has("delivered") : null },
    { icon: <Percent />, tone: "bg-violet-50 text-violet-600", label: "Delivery Rate", value: pct((live ?? shown).totals.deliveryRate), sub: frozen ? `Submitted: ${pct(frozen.totals.deliveryRate)}` : "Not submitted", ok: frozen ? !diffKeys.has("deliveryRate") : null },
    { icon: <Package />, tone: "bg-amber-50 text-amber-500", label: "Upsells", value: nf((live ?? shown).totals.upsellOrders), sub: money((live ?? shown).totals.upsellBonus), ok: frozen ? !diffKeys.has("upsellOrders") && !diffKeys.has("upsellBonus") : null },
    { icon: <Tag />, tone: "bg-rose-50 text-rose-500", label: "Cross-sells", value: nf((live ?? shown).totals.crossSellOrders), sub: money((live ?? shown).totals.crossSellBonus), ok: frozen ? !diffKeys.has("crossSellOrders") && !diffKeys.has("crossSellBonus") : null }
  ] : [];

  const adjustments = t?.adjustments ?? 0;
  const carried = t?.carriedFines ?? 0;
  const formulaTiles: Array<{ icon: ReactNode; tone: string; label: string; value: number; op?: string }> = t ? [
    { icon: <Database />, tone: "bg-blue-50 text-blue-600", label: "Base Bonus", value: t.baseBonus },
    { icon: <ArrowUpRight />, tone: "bg-blue-50 text-blue-600", label: "Upsell Bonus", value: t.upsellBonus, op: "+" },
    { icon: <Tag />, tone: "bg-rose-50 text-rose-500", label: "Cross-sell", value: t.crossSellBonus, op: "+" },
    ...(adjustments > 0 ? [{ icon: <Check />, tone: "bg-emerald-50 text-emerald-600", label: "Corrections", value: adjustments, op: "+" }] : []),
    { icon: <Minus />, tone: "bg-rose-50 text-rose-500", label: "Fines", value: t.fines, op: "−" },
    ...(carried > 0 ? [{ icon: <Minus />, tone: "bg-rose-50 text-rose-500", label: "Last week's fines", value: carried, op: "−" }] : [])
  ] : [];

  const notes: string[] = [
    ...editedAfterSubmit.map((edit) => `Order #${edit.orderId}: ${edit.what} after submit (${whenShort(edit.editedAt)}${edit.by ? `, ${edit.by}` : ""})`),
    ...((t?.manuallyAdjustedOrders ?? 0) > 0 ? [`${t!.manuallyAdjustedOrders} order${t!.manuallyAdjustedOrders === 1 ? " has" : "s have"} a bonus changed by hand.`] : [])
  ];

  const tileDefs: Array<{ key: typeof tile; icon: ReactNode; tone: string; label: string; count: number; amount: number }> = [
    { key: "paid", icon: <ShoppingCart />, tone: "text-blue-600", label: "All Paid Orders", count: tiles.paid.length, amount: sumOf(tiles.paid, (p) => p.total) },
    { key: "base", icon: <Database />, tone: "text-amber-500", label: "Base Bonus", count: tiles.base.length, amount: sumOf(tiles.base, (p) => p.base) },
    { key: "upsell", icon: <ArrowUpRight />, tone: "text-blue-600", label: "Upsell Bonus", count: tiles.upsell.length, amount: sumOf(tiles.upsell, (p) => p.upsell) },
    { key: "cross", icon: <Tag />, tone: "text-rose-500", label: "Cross-sell Bonus", count: tiles.cross.length, amount: sumOf(tiles.cross, (p) => p.cross) },
    { key: "zero", icon: <Truck />, tone: "text-emerald-600", label: "Delivered · No Bonus", count: tiles.zero.length, amount: 0 }
  ];
  const tileWord = { paid: "orders that paid", base: "orders with a base bonus", upsell: "orders with an upsell bonus", cross: "orders with a cross-sell bonus", zero: "delivered orders with no bonus" }[tile];

  const card = "rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900";
  const okPill = (ok: boolean) => ok
    ? <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-emerald-700"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>Match</span>
    : <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-orange-600"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-orange-500 text-[12px] font-black text-white">!</span>Different</span>;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4 print:static print:bg-white" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${repName} weekly report`} onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-[96vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900 print:max-h-none print:shadow-none">
        <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 absolute right-4 top-4 z-10 rounded-lg p-1 text-gray-500 hover:bg-gray-100 print:hidden dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
        <div className="overflow-y-auto px-5 pb-5 pt-5 sm:px-6">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-4 pr-8">
            <div className="flex items-center gap-4">
              <span className="inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-violet-100 text-[30px] font-black text-violet-700 dark:bg-violet-500/20">{repName.slice(0, 1).toUpperCase()}</span>
              <div>
                <h2 className="m-0 text-[24px] font-black text-gray-900 dark:text-slate-50">{repName} — Weekly Report</h2>
                <p className="m-0 mt-1 flex flex-wrap items-center gap-3 text-[16px] text-gray-800 dark:text-slate-200">{day(weekStart).replace(/ \d{4}$/, "")} – {day(weekEnd)} <span className={`rounded-full px-3 py-0.5 text-[13px] font-bold ${statusPill[1]}`}>{statusPill[0]}</span></p>
                <p className="m-0 mt-1 text-[14px] text-gray-500">{report?.submittedAt ? `Submitted on ${when(report.submittedAt)}` : "Not submitted yet: today's figures are shown."}{(report?.submitCount ?? 0) > 1 ? ` · submission ${report!.submitCount}` : ""}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {steps.map((step) => (
                <div key={step.n} className={`flex min-w-[170px] items-center gap-3 rounded-xl px-3.5 py-2.5 ${step.n === 1 && step.done || step.active ? "bg-blue-50 dark:bg-blue-500/10" : "bg-gray-50 dark:bg-slate-800/60"}`}>
                  <span className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-[14px] font-bold ${step.done ? "bg-blue-600 text-white" : "bg-gray-300 text-white dark:bg-slate-600"}`}>{step.n}</span>
                  <span><span className={`block text-[13.5px] font-semibold ${step.done ? "text-blue-700 dark:text-blue-300" : "text-gray-700 dark:text-slate-300"}`}>{step.label}</span><span className="block text-[12px] text-gray-500">{step.sub}</span></span>
                </div>
              ))}
            </div>
          </div>

          {/* Five match cards */}
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {kpis.map((kpi) => (
              <div key={kpi.label} className={`${card} flex gap-3 px-4 py-3.5`}>
                <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full [&>svg]:h-6 [&>svg]:w-6 ${kpi.tone}`}>{kpi.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-gray-700 dark:text-slate-300">{kpi.label}</span>
                  <strong className="block text-[24px] font-black leading-tight text-gray-900 dark:text-slate-50">{kpi.value}</strong>
                  <span className="block text-[13px] text-gray-500">{kpi.sub}</span>
                  {kpi.ok !== null ? <span className="mt-1 flex justify-end">{okPill(kpi.ok)}</span> : null}
                </span>
              </div>
            ))}
          </div>

          {/* Verification Check | Bonus Summary + Issues + Notes */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div ref={checkRef} className={`${card} p-4`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600"><FileText className="h-6 w-6" /></span>
                  <div><h3 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Verification Check</h3><p className="m-0 text-[13px] text-gray-500">We compared the rep's submission with the system records.</p></div>
                </div>
                {checks.length ? (
                  <div className="w-36 shrink-0 text-right">
                    <span className="text-[13px] text-gray-700 dark:text-slate-300">{matched} of {checks.length} matched</span>
                    <span className="mt-1 block h-2 rounded-full bg-gray-200 dark:bg-slate-700"><span className="block h-2 rounded-full bg-emerald-500" style={{ width: `${(matched / checks.length) * 100}%` }} /></span>
                  </div>
                ) : null}
              </div>
              {!frozen ? (
                <p className="m-0 mt-4 rounded-xl bg-gray-50 px-4 py-3 text-[13px] text-gray-600 dark:bg-slate-800 dark:text-slate-300">{repName} has not submitted this week yet, so there is nothing to compare. Today's figures are shown everywhere else.</p>
              ) : (
                <table className="!min-w-0 mt-3 w-full text-left text-[13.5px]">
                  <thead className="bg-gray-50 text-[12px] uppercase text-gray-600 dark:bg-slate-800/60 dark:text-slate-400 [&_th]:bg-transparent [&_th]:[color:inherit]">
                    <tr><th className="px-3 py-2.5 font-bold">Item</th><th className="px-3 py-2.5 font-bold">Submitted</th><th className="px-3 py-2.5 font-bold">System now</th><th className="px-3 py-2.5 font-bold">Status</th><th className="w-6" /></tr>
                  </thead>
                  <tbody>
                    {checks.map((row) => (
                      <Fragment key={row.key}>
                        <tr onClick={() => !row.ok && toggleCheck(row.key)} className={`border-t border-gray-100 dark:border-slate-800 ${row.ok ? "" : "cursor-pointer bg-amber-50/70 dark:bg-amber-500/10"}`}>
                          <td className={`px-3 py-2.5 ${row.ok ? "text-gray-800 dark:text-slate-200" : "font-bold text-gray-900 dark:text-slate-100"}`}>{row.label}</td>
                          <td className="px-3 py-2.5 text-gray-700 dark:text-slate-300">{row.submitted}</td>
                          <td className="px-3 py-2.5 text-gray-700 dark:text-slate-300">{row.now}</td>
                          <td className="px-3 py-2.5">{okPill(row.ok)}</td>
                          <td className="pr-2 text-gray-500">{row.ok ? null : openCheck.has(row.key) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                        </tr>
                        {!row.ok && openCheck.has(row.key) ? <tr className="bg-amber-50/40 dark:bg-amber-500/5"><td colSpan={5} className="px-4 pb-3 pt-1 text-[12.5px] text-amber-900 dark:text-amber-200">{changeDetail(row.key)}</td></tr> : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="space-y-4">
              {t ? (
                <div className={`${card} p-4`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><Banknote className="h-6 w-6" /></span>
                      <div>
                        <h3 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Bonus Summary</h3>
                        <p className="m-0 mt-0.5 text-[13px] leading-snug text-gray-600 dark:text-slate-400">Based on {nf(t.deliveredForBonus)} delivered orders ({dayShort(weekStart)} – {dayShort(weekEnd)}){(t.carryOverOrders ?? 0) > 0 ? `, including ${t.carryOverOrders} placed in an earlier week (${money(t.carryOverBonus ?? 0)})` : ""}. Week delivery rate: {pct(t.deliveryRate)} ({nf(t.delivered)} of {nf(t.orders)} placed).</p>
                      </div>
                    </div>
                    <div className="rounded-xl bg-emerald-50 px-5 py-3 text-center dark:bg-emerald-500/10">
                      <span className="block text-[13px] text-emerald-800 dark:text-emerald-300">Final Payable</span>
                      <strong className="block text-[28px] font-black leading-tight text-emerald-700">{money(t.finalBonus)}</strong>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1 xl:flex-nowrap">
                    {formulaTiles.map((item) => (
                      <Fragment key={item.label}>
                        {item.op ? <span className="text-[16px] font-bold text-gray-400">{item.op}</span> : null}
                        <div className="flex min-w-0 items-center gap-1.5 rounded-xl border border-gray-200 px-2 py-2 dark:border-slate-700">
                          <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full [&>svg]:h-4 [&>svg]:w-4 ${item.tone}`}>{item.icon}</span>
                          <span className="min-w-0"><span className="block whitespace-nowrap text-[11px] text-gray-600 dark:text-slate-400">{item.label}</span><strong className="block whitespace-nowrap text-[14px] font-black text-gray-900 dark:text-slate-100">{money(item.value)}</strong></span>
                        </div>
                      </Fragment>
                    ))}
                    <span className="text-[16px] font-bold text-gray-400">=</span>
                    <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-2 py-2 dark:bg-emerald-500/10">
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600"><Wallet className="h-4 w-4" /></span>
                      <span><span className="block whitespace-nowrap text-[11px] text-gray-700">Final Payable</span><strong className="block whitespace-nowrap text-[14px] font-black text-emerald-700">{money(t.finalBonus)}</strong></span>
                    </div>
                  </div>
                </div>
              ) : null}

              {issues.length > 0 ? (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:bg-amber-500/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex gap-3"><AlertTriangle className="h-8 w-8 shrink-0 text-orange-500" /><div><h3 className="m-0 text-[16px] font-black text-amber-900 dark:text-amber-200">Issues to Review ({issues.length})</h3><p className="m-0 text-[13px] text-orange-700">These items are different from the system records.</p></div></div>
                    <button type="button" onClick={showAllIssues} className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-[13px] font-bold text-blue-700">View Details <ChevronRight className="h-4 w-4" /></button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {issues.map((row) => (
                      <button key={row.key} type="button" onClick={() => { setOpenCheck(new Set([...openCheck, row.key])); checkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}
                        className="!min-h-0 flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-white px-3 py-2.5 text-left text-[13px] dark:bg-slate-900">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-orange-500 [&>svg]:h-4 [&>svg]:w-4">{CHECK_ICON[row.key]}</span>
                        <span className="w-[130px] font-bold text-gray-900 dark:text-slate-100">{row.label}</span>
                        <span className="flex-1 text-gray-600 dark:text-slate-400">Submitted: {row.submitted} <span className="mx-1 text-gray-300">|</span> System: {row.now}</span>
                        <ChevronRight className="h-4 w-4 text-orange-500" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : frozen ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-[13.5px] font-semibold text-emerald-800 dark:bg-emerald-500/10">Everything the rep submitted still matches the system records.</div>
              ) : null}

              <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:bg-blue-500/10">
                <div className="flex gap-3">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white"><Info className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <h3 className="m-0 text-[16px] font-black text-gray-900 dark:text-slate-100">System Notes</h3>
                    {notes.length ? (
                      <ul className="m-0 mt-2 list-none space-y-1 p-0 text-[13px] text-gray-800 dark:text-slate-200">
                        {notes.slice(0, 8).map((note) => <li key={note} className="flex gap-2"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-orange-400" /><span>{note.replace(/^(Order #\w+):/, "$1:")}</span></li>)}
                        {notes.length > 8 ? <li className="text-gray-500">…and {notes.length - 8} more changes.</li> : null}
                      </ul>
                    ) : <p className="m-0 mt-1 text-[13px] text-gray-600">No order was changed after the report was submitted.</p>}
                    {report?.repNote ? <p className="m-0 mt-3 text-[13px]"><b>Rep's note:</b> {report.repNote}</p> : null}
                    {corrections.length ? (
                      <div className="mt-3 text-[12.5px]">
                        <b>Returns and flags on this report</b>
                        <ul className="m-0 mt-1 list-none space-y-1 p-0">
                          {corrections.map((item) => (
                            <li key={item.id}>{item.kind === "flag" ? "Flag" : "Return"} · {CORRECTION_SECTION_LABEL[item.section]}: {item.problem}{item.orderRef ? ` (${item.orderRef})` : ""} — "{item.comment}" <span className="text-gray-500">{item.raisedByName} · {whenShort(item.createdAt)} · {item.status === "open" ? "Open" : `Answered: ${item.response ?? ""}`}</span></li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Paid orders */}
          {shown ? (
            <div className={`${card} mt-4 p-4`}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                {tileDefs.map((item) => (
                  <button key={item.key} type="button" onClick={() => setTile(item.key)}
                    className={`!min-h-0 flex items-center gap-3 rounded-xl border px-4 py-3 text-left ${tile === item.key ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500 dark:bg-blue-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                    <span className={`[&>svg]:h-6 [&>svg]:w-6 ${item.tone}`}>{item.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2"><span className={`whitespace-nowrap text-[13.5px] font-semibold ${tile === item.key ? "text-blue-700" : "text-gray-800 dark:text-slate-200"}`}>{item.label}</span><span className={`rounded-full px-2 text-[12px] font-bold ${tile === item.key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300"}`}>{item.count}</span></span>
                      <strong className={`block text-[16px] font-black ${tile === item.key ? "text-blue-700" : "text-gray-900 dark:text-slate-100"}`}>{money(item.amount)}</strong>
                    </span>
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-[13px] text-gray-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <Info className="h-4 w-4 shrink-0 text-blue-600" />
                  <span>Showing <b className="text-blue-700">{nf(listed.length)}</b> {tileWord}</span>
                  <span className="text-gray-300">|</span>
                  <span>Total bonus: <b>{money(sumOf(tiles.paid, (p) => p.total))}</b> (Base {money(sumOf(delivered, (p) => p.base))} · Upsell {money(sumOf(delivered, (p) => p.upsell))} · Cross-sell {money(sumOf(delivered, (p) => p.cross))})</span>
                </div>
                <label className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order, customer or product…" className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-3 text-[13px] dark:border-slate-700 dark:bg-slate-900" />
                </label>
                <div className="relative">
                  <button type="button" onClick={() => setExportOpen((value) => !value)} className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold dark:border-slate-700 dark:bg-slate-900"><Download className="h-4 w-4" /> Export <ChevronDown className="h-4 w-4" /></button>
                  {exportOpen ? (
                    <div className="absolute right-0 z-10 mt-1 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      <button type="button" onClick={() => exportCsv(false)} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800">These orders (CSV)</button>
                      <button type="button" onClick={() => exportCsv(true)} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-slate-800">With how each bonus was worked out</button>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full !min-w-[1100px] text-left text-[13px]">
                  <thead className="bg-gray-50 text-[11.5px] uppercase text-gray-600 dark:bg-slate-800/60 dark:text-slate-400 [&_th]:bg-transparent [&_th]:[color:inherit]">
                    <tr>{["#", "Order ID", "Customer", "Product", "Placed Date", "Delivered Date", "Status", "Base", "Upsell", "Cross-sell", "Total Bonus", "Actions"].map((head) => <th key={head} className={`whitespace-nowrap px-3 py-2.5 font-bold ${head === "Actions" ? "text-center" : ""}`}>{head}</th>)}</tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? <tr><td colSpan={12} className="px-3 py-8 text-center text-gray-500">No orders here.</td></tr> : pageRows.map((order, index) => {
                      const p = parts(order);
                      const [productName, ...pack] = order.product.split(" – ");
                      const lines = order.bonusLines ?? liveLines.get(order.id) ?? null;
                      const expanded = openOrder.has(order.id);
                      const cell = (value: number) => <td className="px-3 py-3">{money(value)}</td>;
                      return (
                        <Fragment key={order.id}>
                          <tr className="border-t border-gray-100 text-gray-800 dark:border-slate-800 dark:text-slate-200">
                            <td className="px-3 py-3 text-gray-600">{(page - 1) * pageSize + index + 1}</td>
                            <td className="px-3 py-3 font-black">#{order.id}{order.bonusManuallyAdjusted ? <span className="ml-1 text-[10px] font-bold text-amber-600">edited</span> : null}</td>
                            <td className="px-3 py-3">{order.customer}</td>
                            <td className="max-w-[240px] px-3 py-3"><span className="block">{productName}</span>{pack.length ? <span className="flex items-center gap-1 text-gray-600"><Check className="h-3.5 w-3.5 text-emerald-600" />{pack.join(" – ")}</span> : null}</td>
                            <td className="whitespace-nowrap px-3 py-3">{order.placedThisWeek ? day(order.date) : <><span className="text-blue-700">{day(order.date)}</span><span className="mt-1 flex w-fit items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700"><span className="h-1.5 w-1.5 rounded-full bg-blue-600" />Earlier week</span></>}</td>
                            <td className="whitespace-nowrap px-3 py-3">{day(order.deliveredDate)}</td>
                            <td className="px-3 py-3"><span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[12px] font-semibold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />{order.status}</span></td>
                            {cell(p.base)}{cell(p.upsell)}{cell(p.cross)}
                            <td className="px-3 py-3 font-black">{money(p.total)}</td>
                            <td className="px-3 py-3 text-center"><button type="button" aria-label="How it was worked out" onClick={() => toggleOrder(order.id)} className={`!min-h-0 rounded-lg p-1.5 ${expanded ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800"}`}><Eye className="h-4 w-4" /></button></td>
                          </tr>
                          {expanded ? (
                            <tr className="bg-gray-50/70 dark:bg-slate-800/30">
                              <td />
                              <td colSpan={11} className="px-3 pb-3 pt-1 text-[12.5px]">
                                <b className="text-gray-800 dark:text-slate-200">How #{order.id}'s bonus was worked out</b>
                                {lines?.length ? (
                                  <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                                    {lines.map((line, i) => (
                                      <li key={i} className="flex gap-3">
                                        <span className={`w-[90px] shrink-0 text-right font-bold ${line.tone === "earned" ? "text-emerald-700" : line.tone === "blocked" ? "text-rose-700" : "text-gray-500"}`}>{line.amount ? money(line.amount) : line.tone === "blocked" ? "not paid" : "–"}</span>
                                        <span><b>{line.label}.</b> <span className="text-gray-600 dark:text-slate-400">{line.note}</span></span>
                                      </li>
                                    ))}
                                    {!order.bonusLines ? <li className="text-[11px] text-gray-400">Submitted before the workings were saved with the report: this explanation is from today's records.</li> : null}
                                  </ul>
                                ) : <p className="m-0 mt-1 text-gray-500">No details saved for this order.</p>}
                                {order.bonusNote ? <p className="m-0 mt-1.5 font-semibold text-amber-700">{order.bonusNote}</p> : null}
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-end gap-4 text-[13px] text-gray-600 dark:text-slate-400">
                <label className="flex items-center gap-2">Rows per page
                  <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="!min-h-0 h-8 rounded-lg border border-gray-200 bg-white px-2 text-[13px] dark:border-slate-700 dark:bg-slate-900">{[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}</select>
                </label>
                <span>{listed.length ? `${(page - 1) * pageSize + 1}–${Math.min(listed.length, page * pageSize)}` : "0"} of {nf(listed.length)}</span>
                <button type="button" aria-label="Previous" disabled={page <= 1} onClick={() => setPage(page - 1)} className="!min-h-0 rounded p-1 disabled:opacity-30"><ChevronLeft className="h-5 w-5" /></button>
                <button type="button" aria-label="Next" disabled={page >= pages} onClick={() => setPage(page + 1)} className="!min-h-0 rounded p-1 disabled:opacity-30"><ChevronRight className="h-5 w-5" /></button>
              </div>
            </div>
          ) : null}

          {error ? <p className="m-0 mt-3 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">{error}</p> : null}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-3.5 sm:px-6 print:hidden dark:border-slate-800">
          <button type="button" onClick={() => window.print()} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border border-gray-200 px-5 py-2.5 text-[14px] font-bold text-gray-800 dark:border-slate-700 dark:text-slate-200"><Printer className="h-5 w-5" /> Print Report</button>
          {!ownerView ? (
            <div className="flex flex-wrap gap-3">
              {canAct && onReturn && (status === "submitted" || status === "manager_approved") ? (
                <button type="button" onClick={onReturn} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border border-rose-300 px-5 py-2.5 text-[14px] font-bold text-rose-600 hover:bg-rose-50"><Send className="h-4 w-4" /> Return to Rep</button>
              ) : null}
              {canFlag && onFlag ? (
                <button type="button" onClick={onFlag} className="!min-h-0 inline-flex items-center gap-2 rounded-xl border border-amber-300 px-5 py-2.5 text-[14px] font-bold text-amber-700 hover:bg-amber-50"><MessageSquare className="h-4 w-4" /> Request Changes</button>
              ) : null}
              {canAct && onApprove && status === "submitted" ? (
                <button type="button" disabled={approving} onClick={async () => {
                  setApproving(true); setError("");
                  try { await onApprove(); } catch (err: any) { setError(err?.message ?? "Could not approve."); setApproving(false); }
                }} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-2.5 text-[14px] font-bold text-white hover:bg-blue-700 disabled:opacity-50"><Check className="h-5 w-5" /> {approving ? "Approving…" : "Approve & Lock"}</button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
