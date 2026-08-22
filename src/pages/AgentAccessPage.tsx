import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  MapPin,
  MessageSquare,
  MoreVertical,
  Search,
  Shield,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  WalletCards,
  X
} from "lucide-react";
import type { AgentAccessRow, AgentAccessView, AgentLoginEvent, PortalSendOptions } from "../lib/api";
// ⚠️ Shared formatters, NOT a local `naira()`. A private one silently
// ignores the topbar "hide money" toggle - which is exactly how these
// pages kept showing real figures with privacy mode on.
import { naira } from "../lib/money-privacy";

// The portal permission set an agent role carries. Mirrors the backend's
// `/my/*` endpoints - these are descriptions of what the API already enforces,
// not switches. Showing them is the point: someone deciding whether to hand
// out access should be able to see what they are handing out.
const AGENT_PERMISSIONS: Array<{ label: string; allowed: boolean }> = [
  { label: "View assigned orders", allowed: true },
  { label: "View other agents", allowed: false },
  { label: "Update delivery status", allowed: true },
  { label: "Change delivery fees", allowed: false },
  { label: "View customer delivery info", allowed: true },
  { label: "Edit product prices", allowed: false },
  { label: "Record COD collected", allowed: true },
  { label: "Access company reports", allowed: false },
  { label: "View inventory assigned to agent", allowed: true },
  { label: "Edit reconciled COD", allowed: false },
  { label: "View own earnings", allowed: true },
  { label: "Manage users & roles", allowed: false }
];

const AVATAR_TONES = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-teal-500",
  "bg-orange-500", "bg-rose-500", "bg-indigo-500", "bg-fuchsia-500"
];

function initialsOf(name: string) {
  const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function toneFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}


function dayLabel(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" });
}

function timeLabel(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" });
}

/** "Today, 8:42 AM" / "Yesterday, 6:15 PM" / "Aug 17, 2026". */
function lastLoginLines(iso: string | null): { top: string; bottom: string } {
  if (!iso) return { top: "—", bottom: "Never logged in" };
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { top: "—", bottom: "Never logged in" };
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const when = date.getTime();
  if (when >= startOfToday) return { top: `Today, ${timeLabel(iso)}`, bottom: dayLabel(iso) ?? "" };
  if (when >= startOfToday - day) return { top: `Yesterday, ${timeLabel(iso)}`, bottom: dayLabel(iso) ?? "" };
  const days = Math.floor((startOfToday - when) / day) + 1;
  return { top: dayLabel(iso) ?? "", bottom: `${days} day${days === 1 ? "" : "s"} ago` };
}

function agoLabel(iso: string | null | undefined) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ── Small shared pieces ───────────────────────────────────

function AgentStatusPill({ status }: { status: string }) {
  const tone =
    status === "Active" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
      : status === "Probation" ? "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
        : status === "Terminated" ? "bg-gray-100 text-gray-600 dark:bg-slate-700/40 dark:text-slate-300"
          : "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${tone}`}>{status}</span>;
}

function PortalPill({ state }: { state: AgentAccessRow["portalAccess"] }) {
  const tone =
    state === "Active" ? { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300", bg: "bg-emerald-50 dark:bg-emerald-500/10" }
      : state === "Setup Required" ? { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300", bg: "bg-amber-50 dark:bg-amber-500/10" }
        : { dot: "bg-rose-500", text: "text-rose-700 dark:text-rose-300", bg: "bg-rose-50 dark:bg-rose-500/10" };
  const label = state === "Blocked" ? "Blocked" : state;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.bg} ${tone.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {label}
    </span>
  );
}

function Avatar({ name, seed, size = "md" }: { name: string; seed: string; size?: "md" | "lg" }) {
  const dims = size === "lg" ? "h-14 w-14 text-lg" : "h-9 w-9 text-[11px]";
  return (
    <span className={`inline-flex ${dims} shrink-0 items-center justify-center rounded-full font-black text-white ${toneFor(seed)}`}>
      {initialsOf(name)}
    </span>
  );
}

function DrawerField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="m-0 text-[10px] font-black uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1 text-sm font-bold text-gray-900 dark:text-slate-100">{children}</div>
    </div>
  );
}

function OpsTile({ icon: Icon, label, value, action, onAction, tone }: {
  icon: typeof Box; label: string; value: string; action: string; onAction?: () => void; tone: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-3 text-center dark:border-slate-800 dark:bg-slate-900/40">
      <Icon className={`mx-auto h-5 w-5 ${tone}`} />
      <p className="m-0 mt-1.5 text-[10px] font-black uppercase tracking-wide text-gray-400">{label}</p>
      <p className="m-0 mt-0.5 text-base font-black text-gray-900 dark:text-slate-100">{value}</p>
      <button type="button" onClick={onAction}
        className="!min-h-0 mt-1 bg-transparent p-0 text-[11px] font-bold text-[#1F8FE0] hover:underline">
        {action}
      </button>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────

export type AgentAccessPageProps = {
  view: AgentAccessView | null;
  loading: boolean;
  error: string;
  /** Creating or resetting a login writes a real auth account: Owner/Admin. */
  canManageLogins: boolean;
  /** Blocking, restoring, suspending or terminating: Owner/Admin/Manager. */
  canStandDown: boolean;
  saving: boolean;
  onRefresh: () => void;
  onCreateLogin: (agentId: string, options: PortalSendOptions) => Promise<void>;
  onResetPassword: (agentId: string, options: PortalSendOptions) => Promise<void>;
  onSuspendPortal: (agentId: string, reason: string) => Promise<void>;
  onRestorePortal: (agentId: string) => Promise<void>;
  onSignOutAll: (agentId: string) => Promise<void>;
  onSetTwoFactor: (agentId: string, required: boolean) => Promise<void>;
  onTerminate: (agentId: string, fullName: string) => Promise<void>;
  onAddNote: (agentId: string, body: string) => Promise<void>;
  onLoadLoginHistory: (agentId: string) => Promise<AgentLoginEvent[]>;
  onOpenAgent: (agentId: string, tab: "orders" | "inventory" | "cod" | "incidents") => void;
  onAddNewAgent: () => void;
};

type DrawerKind = "manage" | "setup" | "review" | null;

export default function AgentAccessPage(props: AgentAccessPageProps) {
  const { view, loading, error, canManageLogins, canStandDown, saving } = props;
  const rows = view?.rows ?? [];

  const [search, setSearch] = useState("");
  const [portalFilter, setPortalFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [stateFilter, setStateFilter] = useState("All");
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const states = useMemo(
    () => Array.from(new Set(rows.map((row) => row.state).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((row) => row.accountStatus).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const list = rows.filter((row) => {
      if (portalFilter !== "All" && row.portalAccess !== portalFilter) return false;
      if (statusFilter !== "All" && row.accountStatus !== statusFilter) return false;
      if (stateFilter !== "All" && row.state !== stateFilter) return false;
      if (!query) return true;
      return row.fullName.toLowerCase().includes(query)
        || row.agentCode.toLowerCase().includes(query)
        || (row.phone ?? "").toLowerCase().includes(query);
    });
    return list.sort((a, b) => sortAsc
      ? a.fullName.localeCompare(b.fullName)
      : b.fullName.localeCompare(a.fullName));
  }, [rows, search, portalFilter, statusFilter, stateFilter, sortAsc]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const firstShown = filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastShown = Math.min(currentPage * pageSize, filtered.length);

  useEffect(() => { setPage(1); }, [search, portalFilter, statusFilter, stateFilter, pageSize]);

  const openDrawer = (row: AgentAccessRow) => {
    setSelectedId(row.id);
    setMenuFor(null);
    // Which panel opens is decided by the row's own state, not by the person
    // clicking: a blocked or stood-down agent always goes to Review, so the
    // outstanding cash and stock are put in front of whoever acts next.
    if (row.portalAccess === "Setup Required") setDrawer("setup");
    else if (row.portalAccess === "Blocked") setDrawer("review");
    else setDrawer("manage");
  };

  const closeDrawer = () => { setDrawer(null); setSelectedId(null); };

  const exportCsv = () => {
    const header = [
      "Agent Code", "Name", "Phone", "Location", "Agent Status", "Portal Access",
      "Last Login", "Active Orders", "Stock Held", "COD Exposure", "Open Incidents"
    ];
    const lines = filtered.map((row) => [
      row.agentCode, row.fullName, row.phone, row.fullLocation, row.accountStatus, row.portalAccess,
      row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : "Never",
      row.activeOrders, row.stockUnitsHeld, row.codExposure, row.openIncidents
    ]);
    const csv = [header, ...lines]
      .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `agent-access-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const counts = view?.counts ?? { activeAccounts: 0, setupRequired: 0, suspended: 0, securityAttention: 0 };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-2xl font-black text-gray-900 dark:text-slate-100">Agent Access</h2>
          <p className="m-0 mt-0.5 text-sm text-gray-500 dark:text-slate-400">
            Manage who can access the Personal Delivery Agent portal.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setSelectedId(null); setDrawer(null); props.onRefresh(); }}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <ShieldCheck className="h-4 w-4" /> Roles &amp; Permissions
          </button>
          <button type="button" onClick={props.onAddNewAgent}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-3.5 py-2.5 text-sm font-bold text-white hover:bg-[#1a7ec4]">
            <UserPlus className="h-4 w-4" /> Add New Agent
          </button>
        </div>
      </div>

      {error && (
        <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            icon: UserPlus, value: counts.activeAccounts, label: "Active Accounts",
            hint: "Agents who can currently sign in to the portal",
            ring: "border-emerald-100 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5",
            chip: "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
            value_: "text-emerald-600 dark:text-emerald-300"
          },
          {
            icon: UserPlus, value: counts.setupRequired, label: "Setup Required",
            hint: "Approved agents who don't have access yet",
            ring: "border-amber-100 bg-amber-50/60 dark:border-amber-500/20 dark:bg-amber-500/5",
            chip: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
            value_: "text-amber-600 dark:text-amber-300"
          },
          {
            icon: UserMinus, value: counts.suspended, label: "Suspended",
            hint: "Portal access is currently blocked",
            ring: "border-rose-100 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-500/5",
            chip: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
            value_: "text-rose-600 dark:text-rose-300"
          },
          {
            icon: Shield, value: counts.securityAttention, label: "Security Attention",
            hint: "Require password reset or security review",
            ring: "border-blue-100 bg-blue-50/60 dark:border-blue-500/20 dark:bg-blue-500/5",
            chip: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
            value_: "text-blue-600 dark:text-blue-300"
          }
        ].map((card) => (
          <div key={card.label} className={`flex items-center gap-3.5 rounded-2xl border px-4 py-4 ${card.ring}`}>
            <span className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${card.chip}`}>
              <card.icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className={`m-0 text-2xl font-black leading-tight ${card.value_}`}>{loading ? "—" : card.value}</p>
              <p className="m-0 text-sm font-bold text-gray-900 dark:text-slate-100">{card.label}</p>
              <p className="m-0 mt-0.5 text-[11px] font-medium leading-4 text-gray-500 dark:text-slate-400">{card.hint}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search agent by name, ID or phone..."
            className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        {[
          { label: "Portal Access", value: portalFilter, set: setPortalFilter, options: ["Active", "Setup Required", "Blocked"] },
          { label: "Agent Status", value: statusFilter, set: setStatusFilter, options: statuses },
          { label: "State", value: stateFilter, set: setStateFilter, options: states }
        ].map((select) => (
          <select key={select.label} value={select.value} onChange={(event) => select.set(event.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="All">{select.label}: All</option>
            {select.options.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        ))}
        <button type="button" onClick={exportCsv}
          className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <Download className="h-4 w-4" /> Export
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900/40">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-gray-100 bg-gray-50/80 dark:border-slate-800 dark:bg-slate-900/60">
              <tr className="text-[10px] font-black uppercase tracking-wide text-gray-500 dark:text-slate-400">
                <th className="px-4 py-3">
                  <button type="button" onClick={() => setSortAsc((value) => !value)}
                    className="!min-h-0 inline-flex items-center gap-1 bg-transparent p-0 text-[10px] font-black uppercase tracking-wide text-gray-500 dark:text-slate-400">
                    Agent <span aria-hidden className="text-[9px]">⇅</span>
                  </button>
                </th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Agent Status</th>
                <th className="px-4 py-3">Portal Access</th>
                <th className="px-4 py-3">Last Login</th>
                <th className="px-4 py-3">Active Orders</th>
                <th className="px-4 py-3">Stock Held</th>
                <th className="px-4 py-3">COD Exposure</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">Loading agent access…</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-400">
                  {rows.length === 0 ? "No agents yet." : "No agents match these filters."}
                </td></tr>
              ) : pageRows.map((row) => {
                const login = lastLoginLines(row.lastLoginAt);
                return (
                  <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={row.fullName} seed={row.agentCode} />
                        <div className="min-w-0">
                          <p className="m-0 truncate font-bold text-gray-900 dark:text-slate-100">{row.fullName}</p>
                          <p className="m-0 text-[11px] font-medium text-gray-400">{row.agentCode} · {row.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-slate-300">{row.location || "—"}</td>
                    <td className="px-4 py-3"><AgentStatusPill status={row.accountStatus} /></td>
                    <td className="px-4 py-3"><PortalPill state={row.portalAccess} /></td>
                    <td className="px-4 py-3">
                      <p className="m-0 text-[13px] font-bold text-gray-800 dark:text-slate-200">{login.top}</p>
                      <p className="m-0 text-[11px] font-medium text-gray-400">{login.bottom}</p>
                    </td>
                    <td className="px-4 py-3 text-sm font-bold text-gray-800 dark:text-slate-200">{row.activeOrders}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-600 dark:text-slate-300">{row.stockUnitsHeld} units</td>
                    <td className={`px-4 py-3 text-sm font-bold ${row.codExposure > 0 ? "text-amber-600 dark:text-amber-300" : "text-gray-400"}`}>
                      {naira(row.codExposure)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative flex items-center justify-end gap-1.5">
                        {row.portalAccess === "Setup Required" ? (
                          <button type="button" onClick={() => openDrawer(row)}
                            className="!min-h-0 rounded-lg border border-[#1F8FE0] bg-white px-3.5 py-1.5 text-[12px] font-bold text-[#1F8FE0] hover:bg-blue-50 dark:bg-transparent">
                            Set Up
                          </button>
                        ) : row.portalAccess === "Blocked" ? (
                          <button type="button" onClick={() => openDrawer(row)}
                            className="!min-h-0 rounded-lg border border-rose-300 bg-white px-3.5 py-1.5 text-[12px] font-bold text-rose-600 hover:bg-rose-50 dark:bg-transparent">
                            Review
                          </button>
                        ) : (
                          <button type="button" onClick={() => openDrawer(row)}
                            className="!min-h-0 rounded-lg bg-[#1F8FE0] px-3.5 py-1.5 text-[12px] font-bold text-white hover:bg-[#1a7ec4]">
                            Manage
                          </button>
                        )}
                        <button type="button" aria-label={`More actions for ${row.fullName}`}
                          onClick={() => setMenuFor((current) => current === row.id ? null : row.id)}
                          className="!min-h-0 rounded-lg bg-transparent px-1 py-1.5 text-gray-400 hover:text-gray-700">
                          <MoreVertical className="h-4 w-4" />
                        </button>
                        {menuFor === row.id && (
                          <div className="absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                            <button type="button" onClick={() => { setSelectedId(row.id); setDrawer("review"); setMenuFor(null); }}
                              className="!min-h-0 block w-full bg-transparent px-3 py-2 text-left text-[12px] font-bold text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800">
                              Review agent
                            </button>
                            {canManageLogins && row.hasLogin && (
                              <button type="button" disabled={saving}
                                onClick={() => { setMenuFor(null); void props.onResetPassword(row.id, {}); }}
                                className="!min-h-0 block w-full bg-transparent px-3 py-2 text-left text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">
                                Reset password
                              </button>
                            )}
                            {canStandDown && row.hasLogin && (row.portalAccess === "Blocked" ? (
                              <button type="button" disabled={saving}
                                onClick={() => { setMenuFor(null); void props.onRestorePortal(row.id); }}
                                className="!min-h-0 block w-full bg-transparent px-3 py-2 text-left text-[12px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                                Restore access
                              </button>
                            ) : (
                              <button type="button" disabled={saving}
                                onClick={() => { setMenuFor(null); void props.onSuspendPortal(row.id, ""); }}
                                className="!min-h-0 block w-full bg-transparent px-3 py-2 text-left text-[12px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                                Block access
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[13px] font-medium text-gray-500 dark:text-slate-400">
          Showing {firstShown} to {lastShown} of {filtered.length} agents
        </p>
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}
            className="!min-h-0 rounded-lg border border-gray-200 bg-white p-2 text-gray-500 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">
            <ChevronLeft className="h-4 w-4" />
          </button>
          {Array.from({ length: totalPages }, (_, index) => index + 1).slice(0, 6).map((number) => (
            <button key={number} type="button" onClick={() => setPage(number)}
              className={`!min-h-0 h-9 w-9 rounded-lg border text-[13px] font-bold ${
                number === currentPage
                  ? "border-[#1F8FE0] bg-[#1F8FE0] text-white"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>
              {number}
            </button>
          ))}
          <button type="button" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}
            className="!min-h-0 rounded-lg border border-gray-200 bg-white p-2 text-gray-500 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          {[10, 25, 50].map((size) => <option key={size} value={size}>{size} / page</option>)}
        </select>
      </div>

      {drawer && selected && (
        <AgentAccessDrawer
          kind={drawer}
          row={selected}
          {...props}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}

// ══ Drawers ═══════════════════════════════════════════════

type DrawerProps = AgentAccessPageProps & {
  kind: Exclude<DrawerKind, null>;
  row: AgentAccessRow;
  onClose: () => void;
};

function AgentAccessDrawer(props: DrawerProps) {
  const { kind, row, onClose } = props;
  const width = kind === "review" ? "max-w-[560px]" : "max-w-[520px]";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose}
        className="!min-h-0 absolute inset-0 cursor-default bg-slate-900/30 p-0" />
      <aside className={`relative flex h-full w-full ${width} flex-col overflow-hidden bg-white shadow-2xl dark:bg-[#0f1822]`}>
        {kind === "manage" && <ManageAgentDrawer {...props} />}
        {kind === "setup" && <SetUpAgentDrawer {...props} />}
        {kind === "review" && <ReviewAgentDrawer {...props} />}
      </aside>
    </div>
  );
}

function DrawerHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-5 dark:border-slate-800">
      <div>
        <h3 className="m-0 text-xl font-black text-gray-900 dark:text-slate-100">{title}</h3>
        {subtitle && <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <button type="button" onClick={onClose} aria-label="Close"
        className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700">
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function DrawerIdentity({ row, statusPill }: { row: AgentAccessRow; statusPill: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5 px-6 py-5">
      <Avatar name={row.fullName} seed={row.agentCode} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 text-lg font-black text-gray-900 dark:text-slate-100">{row.fullName}</p>
          {statusPill}
        </div>
        <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500 dark:text-slate-400">
          {row.agentCode} • {row.phone}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-500 dark:text-slate-400">
            <MapPin className="h-3.5 w-3.5" /> {row.fullLocation || "—"}
          </span>
          <AgentStatusPill status={row.accountStatus} />
        </div>
      </div>
    </div>
  );
}

function DrawerTabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (tab: string) => void }) {
  return (
    <div className="flex gap-4 overflow-x-auto border-b border-gray-100 px-6 dark:border-slate-800">
      {tabs.map((tab) => (
        <button key={tab} type="button" onClick={() => onChange(tab)}
          className={`!min-h-0 whitespace-nowrap border-b-2 bg-transparent px-0 pb-2.5 pt-1 text-[13px] font-bold ${
            active === tab
              ? "border-[#1F8FE0] text-[#1F8FE0]"
              : "border-transparent text-gray-500 hover:text-gray-800 dark:text-slate-400"}`}>
          {tab}
        </button>
      ))}
    </div>
  );
}

function OperationalSummary({ row, onOpenAgent }: { row: AgentAccessRow; onOpenAgent: AgentAccessPageProps["onOpenAgent"] }) {
  return (
    <section className="px-6 py-5">
      <h4 className="m-0 mb-3 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
        <Box className="h-4 w-4 text-gray-400" /> Operational Summary
      </h4>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <OpsTile icon={Users} tone="text-blue-500" label="Active Orders" value={String(row.activeOrders)}
          action="View Orders" onAction={() => onOpenAgent(row.id, "orders")} />
        <OpsTile icon={Box} tone="text-emerald-500" label="Stock Held" value={`${row.stockUnitsHeld} units`}
          action="View Inventory" onAction={() => onOpenAgent(row.id, "inventory")} />
        <OpsTile icon={WalletCards} tone="text-amber-500" label="COD Exposure" value={naira(row.codExposure)}
          action="View COD" onAction={() => onOpenAgent(row.id, "cod")} />
        <OpsTile icon={AlertTriangle} tone="text-rose-500" label="Open Incidents" value={String(row.openIncidents)}
          action="View Incidents" onAction={() => onOpenAgent(row.id, "incidents")} />
      </div>
    </section>
  );
}

function LoginHistoryTab({ row, onLoadLoginHistory }: { row: AgentAccessRow; onLoadLoginHistory: AgentAccessPageProps["onLoadLoginHistory"] }) {
  const [events, setEvents] = useState<AgentLoginEvent[] | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let live = true;
    setEvents(null);
    setFailed("");
    onLoadLoginHistory(row.id)
      .then((rows) => { if (live) setEvents(rows); })
      .catch((err: any) => { if (live) setFailed(err?.message ?? "Could not load login history."); });
    return () => { live = false; };
  }, [row.id, onLoadLoginHistory]);

  return (
    <section className="px-6 py-5">
      {failed && <p className="m-0 text-sm font-bold text-rose-600">{failed}</p>}
      {!failed && events === null && <p className="m-0 text-sm text-gray-400">Loading sign-in history…</p>}
      {events !== null && events.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center dark:border-slate-700">
          <Clock3 className="mx-auto h-6 w-6 text-gray-300" />
          <p className="m-0 mt-2 text-sm font-bold text-gray-700 dark:text-slate-200">No sign-ins recorded yet</p>
          <p className="m-0 mt-1 text-[12px] font-medium leading-4 text-gray-400">
            Every attempt on this account is listed here once they start signing in.
          </p>
        </div>
      )}
      {events !== null && events.length > 0 && (
        <ul className="m-0 list-none space-y-1.5 p-0">
          {events.map((event) => (
            <li key={event.id} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2.5 dark:border-slate-800">
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 text-[13px] font-bold text-gray-900 dark:text-slate-100">
                  {event.success
                    ? <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Signed in</>
                    : <><AlertTriangle className="h-3.5 w-3.5 text-rose-500" /> Failed attempt</>}
                </p>
                <p className="m-0 mt-0.5 truncate text-[11px] font-medium text-gray-400">
                  {event.device ? event.device.slice(0, 68) : "Device not recorded"}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="m-0 text-[12px] font-bold text-gray-700 dark:text-slate-300">{dayLabel(event.at)}</p>
                <p className="m-0 text-[11px] font-medium text-gray-400">{timeLabel(event.at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PermissionsTab() {
  return (
    <section className="px-6 py-5">
      <h4 className="m-0 mb-3 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
        <Shield className="h-4 w-4 text-gray-400" /> Permissions (Agent Role)
      </h4>
      <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {AGENT_PERMISSIONS.map((permission) => (
          <p key={permission.label} className="m-0 flex items-start gap-1.5 text-[12px] font-medium text-gray-700 dark:text-slate-300">
            {permission.allowed
              ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
              : <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
            {permission.label}
          </p>
        ))}
      </div>
      <p className="m-0 mt-3 text-[11px] font-medium leading-4 text-gray-400">
        These are fixed by the Delivery Agent role and enforced by the server, not by this screen.
      </p>
    </section>
  );
}

function AccountControls({ row, props, showTerminate }: { row: AgentAccessRow; props: DrawerProps; showTerminate?: boolean }) {
  const { canManageLogins, canStandDown, saving } = props;
  return (
    <section className="px-6 py-5">
      <h4 className="m-0 mb-3 text-[13px] font-black text-gray-900 dark:text-slate-100">Account Controls</h4>
      <div className="flex flex-wrap gap-2">
        {canManageLogins && (
          <button type="button" disabled={saving} onClick={() => void props.onResetPassword(row.id, {})}
            className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <KeyRound className="h-4 w-4" /> Reset Password
          </button>
        )}
        {canStandDown && (
          <button type="button" disabled={saving} onClick={() => void props.onSignOutAll(row.id)}
            className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <LogOut className="h-4 w-4" /> Sign Out All Devices
          </button>
        )}
        {canStandDown && (row.portalAccess === "Blocked" ? (
          <button type="button" disabled={saving} onClick={() => void props.onRestorePortal(row.id)}
            className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-white px-3 py-2.5 text-[12px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:bg-transparent">
            <CheckCircle2 className="h-4 w-4" /> Restore Access
          </button>
        ) : (
          <button type="button" disabled={saving} onClick={() => void props.onSuspendPortal(row.id, "")}
            className="!min-h-0 inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3 py-2.5 text-[12px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:bg-transparent">
            <UserMinus className="h-4 w-4" /> Suspend Access
          </button>
        ))}
      </div>
      {showTerminate && canStandDown && (
        <button type="button" disabled={saving} onClick={() => void props.onTerminate(row.id, row.fullName)}
          className="!min-h-0 mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-300 bg-white px-3 py-2.5 text-[12px] font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:bg-transparent">
          <Trash2 className="h-4 w-4" /> Terminate Agent
        </button>
      )}
      <p className="m-0 mt-2.5 text-center text-[11px] font-medium text-gray-400">
        Suspending access will block the agent from signing in to the portal.
      </p>
    </section>
  );
}

// ── Manage ────────────────────────────────────────────────

function ManageAgentDrawer(props: DrawerProps) {
  const { row } = props;
  const [tab, setTab] = useState("Overview");
  const login = lastLoginLines(row.lastLoginAt);

  return (
    <>
      <DrawerHeader title="Manage Agent" onClose={props.onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <DrawerIdentity row={row} statusPill={<PortalPill state={row.portalAccess} />} />
        <DrawerTabs tabs={["Overview", "Login History", "Roles & Permissions", "Activity"]} active={tab} onChange={setTab} />

        {tab === "Overview" && (
          <>
            <section className="px-6 py-5">
              <h4 className="m-0 mb-3 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
                <ShieldCheck className="h-4 w-4 text-gray-400" /> Account &amp; Access
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <DrawerField label="Portal Access"><PortalPill state={row.portalAccess} /></DrawerField>
                <DrawerField label="Last Login">
                  <p className="m-0 text-[13px]">{login.top}</p>
                  <p className="m-0 text-[11px] font-medium text-gray-400">{login.bottom}</p>
                </DrawerField>
                <DrawerField label="Account Created">{dayLabel(row.accountCreatedAt) ?? "—"}</DrawerField>
                <DrawerField label="Login ID / Phone">{row.loginId ?? row.loginPhone ?? "—"}</DrawerField>
                <DrawerField label="Password">
                  <p className="m-0 tracking-[0.2em] text-gray-500">••••••••</p>
                  {props.canManageLogins && (
                    <button type="button" disabled={props.saving} onClick={() => void props.onResetPassword(row.id, {})}
                      className="!min-h-0 mt-0.5 bg-transparent p-0 text-[12px] font-bold text-[#1F8FE0] hover:underline disabled:opacity-50">
                      Reset Password
                    </button>
                  )}
                </DrawerField>
                <DrawerField label="Two-Factor Auth">
                  <p className="m-0 text-[13px]">{row.twoFactorRequired ? "Required" : "Not enabled"}</p>
                  {props.canManageLogins && (
                    <button type="button" disabled={props.saving}
                      onClick={() => void props.onSetTwoFactor(row.id, !row.twoFactorRequired)}
                      className="!min-h-0 mt-0.5 bg-transparent p-0 text-[12px] font-bold text-[#1F8FE0] hover:underline disabled:opacity-50">
                      {row.twoFactorRequired ? "Remove requirement" : "Enable 2FA"}
                    </button>
                  )}
                </DrawerField>
              </div>
              {row.securityReasons.length > 0 && (
                <ul className="m-0 mt-3 list-none space-y-1 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2.5 p-0 dark:border-blue-500/20 dark:bg-blue-500/5">
                  {row.securityReasons.map((reason) => (
                    <li key={reason} className="flex items-start gap-1.5 text-[12px] font-bold text-blue-800 dark:text-blue-200">
                      <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {reason}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <OperationalSummary row={row} onOpenAgent={props.onOpenAgent} />
            <PermissionsTab />
            <AccountControls row={row} props={props} />
          </>
        )}

        {tab === "Login History" && <LoginHistoryTab row={row} onLoadLoginHistory={props.onLoadLoginHistory} />}
        {tab === "Roles & Permissions" && <PermissionsTab />}
        {tab === "Activity" && <ActivityTab row={row} />}
      </div>
    </>
  );
}

function ActivityTab({ row }: { row: AgentAccessRow }) {
  const entries = [
    row.accountCreatedAt ? { label: "Portal account created", at: row.accountCreatedAt } : null,
    row.lastLoginAt ? { label: "Last successful sign-in", at: row.lastLoginAt } : null
  ].filter(Boolean) as Array<{ label: string; at: string }>;

  return (
    <section className="px-6 py-5">
      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center dark:border-slate-700">
          <Clock3 className="mx-auto h-6 w-6 text-gray-300" />
          <p className="m-0 mt-2 text-sm font-bold text-gray-700 dark:text-slate-200">Nothing recorded yet</p>
        </div>
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {entries.map((entry) => (
            <li key={entry.label} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-3 py-2.5 dark:border-slate-800">
              <p className="m-0 text-[13px] font-bold text-gray-800 dark:text-slate-200">{entry.label}</p>
              <p className="m-0 text-[12px] font-medium text-gray-400">{dayLabel(entry.at)}</p>
            </li>
          ))}
        </ul>
      )}
      {row.recentFailedAttempts > 0 && (
        <p className="m-0 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-bold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {row.recentFailedAttempts} failed sign-in attempt{row.recentFailedAttempts === 1 ? "" : "s"} in the last 14 days.
        </p>
      )}
    </section>
  );
}

// ── Set up ────────────────────────────────────────────────

function SetUpAgentDrawer(props: DrawerProps) {
  const { row } = props;
  const [loginPhone, setLoginPhone] = useState(row.loginPhone ?? row.phone ?? "");
  const [fullName, setFullName] = useState(row.fullName);
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [requireChange, setRequireChange] = useState(true);
  const [sendWhatsApp, setSendWhatsApp] = useState(false);
  const [sendSms, setSendSms] = useState(false);
  const [copyToMyEmail, setCopyToMyEmail] = useState(true);
  const [showPermissions, setShowPermissions] = useState(false);

  const passwordProblem = password.length > 0 && (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password))
    ? "Use at least 8 characters with letters and numbers."
    : "";

  return (
    <>
      <DrawerHeader title="Set Up Agent Access" subtitle="Create portal account and send access details to the agent." onClose={props.onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <section className="px-6 py-5">
          <h4 className="m-0 mb-2.5 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
            <Users className="h-4 w-4 text-gray-400" /> Agent Information
          </h4>
          <div className="flex items-start gap-3 rounded-xl border border-gray-200 px-3.5 py-3 dark:border-slate-800">
            <Avatar name={row.fullName} seed={row.agentCode} />
            <div className="min-w-0">
              <p className="m-0 font-bold text-gray-900 dark:text-slate-100">{row.fullName}</p>
              <p className="m-0 text-[12px] font-medium text-gray-500 dark:text-slate-400">{row.agentCode} • {row.phone}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-gray-500">
                  <MapPin className="h-3.5 w-3.5" /> {row.location || "—"}
                </span>
                <AgentStatusPill status={row.accountStatus} />
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 py-5">
          <h4 className="m-0 mb-3 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
            <Smartphone className="h-4 w-4 text-gray-400" /> Account Details
          </h4>
          <label className="block text-[12px] font-bold text-gray-700 dark:text-slate-300">
            Login Phone Number
            <input value={loginPhone} onChange={(event) => setLoginPhone(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </label>
          <p className="m-0 mt-1 text-[11px] font-medium text-gray-400">This will be used as the login username.</p>

          <label className="mt-3 block text-[12px] font-bold text-gray-700 dark:text-slate-300">
            Full Name
            <input value={fullName} onChange={(event) => setFullName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </label>

          <label className="mt-3 block text-[12px] font-bold text-gray-700 dark:text-slate-300">
            Portal Role
            <select disabled
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-bold text-gray-700 disabled:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              <option>Personal Delivery Agent</option>
            </select>
          </label>
          <p className="m-0 mt-1 text-[11px] font-medium text-gray-400">Defines what the agent can access and do in the portal.</p>
        </section>

        <section className="px-6 py-5">
          <h4 className="m-0 mb-3 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
            <KeyRound className="h-4 w-4 text-gray-400" /> Create Login Credentials
          </h4>
          <label className="block text-[12px] font-bold text-gray-700 dark:text-slate-300">
            Set Temporary Password
            <span className="relative mt-1 block">
              <input type={reveal ? "text" : "password"} value={password} placeholder="Leave blank to generate one"
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 pr-10 text-sm font-medium text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              <button type="button" onClick={() => setReveal((value) => !value)} aria-label={reveal ? "Hide password" : "Show password"}
                className="!min-h-0 absolute right-2 top-1/2 -translate-y-1/2 bg-transparent p-1 text-gray-400 hover:text-gray-700">
                {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>
          <p className={`m-0 mt-1 text-[11px] font-medium ${passwordProblem ? "text-rose-600" : "text-gray-400"}`}>
            {passwordProblem || "Minimum 8 characters with letters and numbers."}
          </p>

          <label className="mt-3 flex items-start gap-2 text-[12px] font-bold text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={requireChange} onChange={(event) => setRequireChange(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#1F8FE0]" />
            <span>
              Require password change on first login
              <span className="mt-0.5 block text-[11px] font-medium text-gray-400">Agent will be asked to create a new password.</span>
            </span>
          </label>
        </section>

        <section className="px-6 py-5">
          <h4 className="m-0 mb-3 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
            <Shield className="h-4 w-4 text-gray-400" /> Access &amp; Permissions
          </h4>
          <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-3 dark:border-blue-500/20 dark:bg-blue-500/5">
            <p className="m-0 text-[12px] font-medium text-blue-900 dark:text-blue-200">
              Uses default permissions for Personal Delivery Agents.
            </p>
            <button type="button" onClick={() => setShowPermissions((value) => !value)}
              className="!min-h-0 mt-2 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-blue-700 hover:bg-blue-50 dark:bg-transparent">
              {showPermissions ? "Hide Permissions" : "View Permissions"}
            </button>
            {showPermissions && (
              <div className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                {AGENT_PERMISSIONS.map((permission) => (
                  <p key={permission.label} className="m-0 flex items-start gap-1.5 text-[11px] font-medium text-blue-900 dark:text-blue-200">
                    {permission.allowed
                      ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                      : <X className="mt-0.5 h-3 w-3 shrink-0 text-rose-500" />}
                    {permission.label}
                  </p>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="px-6 py-5">
          <h4 className="m-0 mb-3 flex items-center gap-1.5 text-[13px] font-black text-gray-900 dark:text-slate-100">
            <MessageSquare className="h-4 w-4 text-gray-400" /> Send Access Details
          </h4>
          <p className="m-0 mb-2 text-[12px] font-bold text-gray-700 dark:text-slate-300">Send login details via:</p>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={() => setSendWhatsApp((value) => !value)}
              className={`!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[12px] font-bold ${
                sendWhatsApp
                  ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>
              <MessageSquare className="h-4 w-4" /> WhatsApp
            </button>
            <button type="button" onClick={() => setSendSms((value) => !value)}
              className={`!min-h-0 inline-flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-[12px] font-bold ${
                sendSms
                  ? "border-[#1F8FE0] bg-blue-50 text-[#1F8FE0]"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>
              <Smartphone className="h-4 w-4" /> SMS
            </button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[12px] font-bold text-gray-700 dark:text-slate-300">
            <input type="checkbox" checked={copyToMyEmail} onChange={(event) => setCopyToMyEmail(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-[#1F8FE0]" />
            Also send login details to my email
          </label>
        </section>
      </div>

      <div className="border-t border-gray-100 px-6 py-5 dark:border-slate-800">
        <div className="flex gap-2.5">
          <button type="button" onClick={props.onClose}
            className="!min-h-0 flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13px] font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            Cancel
          </button>
          <button type="button" disabled={props.saving || Boolean(passwordProblem) || !props.canManageLogins}
            onClick={() => void props.onCreateLogin(row.id, {
              tempPassword: password.trim() || undefined,
              requirePasswordChange: requireChange,
              sendWhatsApp, sendSms, copyToMyEmail
            })}
            className="!min-h-0 flex-1 rounded-xl bg-[#1F8FE0] px-3 py-2.5 text-[13px] font-bold text-white hover:bg-[#1a7ec4] disabled:opacity-50">
            {props.saving ? "Creating…" : "Create Account & Send"}
          </button>
        </div>
        <p className="m-0 mt-2 text-center text-[11px] font-medium leading-4 text-gray-400">
          {props.canManageLogins
            ? "An account will be created and login details sent to the agent immediately."
            : "Only an Owner or Admin can create a portal login."}
        </p>
      </div>
    </>
  );
}

// ── Review ────────────────────────────────────────────────

function ReviewAgentDrawer(props: DrawerProps) {
  const { row } = props;
  const [tab, setTab] = useState("Overview");
  const [note, setNote] = useState("");
  const login = lastLoginLines(row.lastLoginAt);

  return (
    <>
      <DrawerHeader title="Review Agent" onClose={props.onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <DrawerIdentity row={row} statusPill={<AgentStatusPill status={row.accountStatus} />} />

        {/* Standing an agent down settles nothing they are still holding. */}
        <div className="px-6 pb-1">
          <div className="rounded-xl border border-rose-200 bg-rose-50/70 px-3.5 py-3 dark:border-rose-500/30 dark:bg-rose-500/5">
            <p className="m-0 flex items-center gap-1.5 text-[13px] font-black text-rose-800 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4" /> Action required before making changes
            </p>
            <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-5">
              {row.blockers.map((blocker) => (
                <li key={blocker} className="text-[12px] font-medium text-rose-800 dark:text-rose-200">{blocker}</li>
              ))}
            </ul>
          </div>
        </div>

        <DrawerTabs tabs={["Overview", "Access & Security", "Activity", "Orders", "Inventory", "Incidents"]} active={tab} onChange={setTab} />

        {tab === "Overview" && (
          <>
            <section className="px-6 py-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <DrawerField label="Agent Status">
                  <p className="m-0 text-[13px] font-black text-rose-600 dark:text-rose-300">{row.accountStatus}</p>
                </DrawerField>
                <DrawerField label="Portal Access">
                  <p className={`m-0 text-[13px] font-black ${row.portalAccess === "Blocked" ? "text-rose-600 dark:text-rose-300" : "text-emerald-600"}`}>
                    {row.portalAccess}
                  </p>
                  <p className="m-0 text-[11px] font-medium text-gray-400">
                    {row.portalAccess === "Blocked" ? "Cannot sign in" : row.portalAccess === "Active" ? "Can sign in" : "No account yet"}
                  </p>
                </DrawerField>
                <DrawerField label="Account Created">
                  <p className="m-0 text-[13px]">{dayLabel(row.accountCreatedAt) ?? "—"}</p>
                  <p className="m-0 text-[11px] font-medium text-gray-400">{agoLabel(row.accountCreatedAt) ?? ""}</p>
                </DrawerField>
                <DrawerField label="Last Login">
                  <p className="m-0 text-[13px]">{login.top}</p>
                  <p className="m-0 text-[11px] font-medium text-gray-400">{login.bottom}</p>
                </DrawerField>
                <DrawerField label="Login Phone / Username">{row.loginId ?? row.loginPhone ?? "—"}</DrawerField>
                <DrawerField label="Password">
                  <p className="m-0 tracking-[0.2em] text-gray-500">••••••••</p>
                  {props.canManageLogins && row.hasLogin && (
                    <button type="button" disabled={props.saving} onClick={() => void props.onResetPassword(row.id, {})}
                      className="!min-h-0 mt-0.5 bg-transparent p-0 text-[12px] font-bold text-[#1F8FE0] hover:underline disabled:opacity-50">
                      Reset Password
                    </button>
                  )}
                </DrawerField>
              </div>
            </section>

            <OperationalSummary row={row} onOpenAgent={props.onOpenAgent} />

            <section className="px-6 py-5">
              <h4 className="m-0 mb-2.5 text-[13px] font-black text-gray-900 dark:text-slate-100">Recent Notes</h4>
              {row.securityReasons.length === 0 && row.blockers.length === 0 ? (
                <p className="m-0 text-[12px] font-medium text-gray-400">Nothing flagged on this account.</p>
              ) : (
                <ul className="m-0 list-disc space-y-1 pl-5">
                  {[...row.securityReasons, ...row.blockers].map((line) => (
                    <li key={line} className="text-[12px] font-medium text-gray-600 dark:text-slate-300">{line}</li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex gap-2">
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add internal note..."
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                <button type="button" disabled={props.saving || !note.trim()}
                  onClick={async () => { await props.onAddNote(row.id, note.trim()); setNote(""); }}
                  className="!min-h-0 rounded-xl bg-[#1F8FE0] px-3.5 py-2.5 text-[12px] font-bold text-white hover:bg-[#1a7ec4] disabled:opacity-50">
                  Save Note
                </button>
              </div>
            </section>

            <AccountControls row={row} props={props} showTerminate />
          </>
        )}

        {tab === "Access & Security" && (
          <>
            <section className="px-6 py-5">
              <h4 className="m-0 mb-3 text-[13px] font-black text-gray-900 dark:text-slate-100">Security review</h4>
              {row.securityReasons.length === 0 ? (
                <p className="m-0 flex items-center gap-1.5 text-[12px] font-bold text-emerald-700">
                  <CheckCircle2 className="h-4 w-4" /> Nothing outstanding on this account.
                </p>
              ) : (
                <ul className="m-0 list-none space-y-1.5 p-0">
                  {row.securityReasons.map((reason) => (
                    <li key={reason} className="flex items-start gap-1.5 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2 text-[12px] font-bold text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/5 dark:text-blue-200">
                      <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {reason}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <DrawerField label="Two-Factor Auth">
                  <p className="m-0 text-[13px]">{row.twoFactorRequired ? "Required" : "Not enabled"}</p>
                  {props.canManageLogins && row.hasLogin && (
                    <button type="button" disabled={props.saving}
                      onClick={() => void props.onSetTwoFactor(row.id, !row.twoFactorRequired)}
                      className="!min-h-0 mt-0.5 bg-transparent p-0 text-[12px] font-bold text-[#1F8FE0] hover:underline disabled:opacity-50">
                      {row.twoFactorRequired ? "Remove requirement" : "Enable 2FA"}
                    </button>
                  )}
                </DrawerField>
                <DrawerField label="Failed attempts (14 days)">{row.recentFailedAttempts}</DrawerField>
              </div>
            </section>
            <PermissionsTab />
            <AccountControls row={row} props={props} showTerminate />
          </>
        )}

        {tab === "Activity" && <ActivityTab row={row} />}

        {(tab === "Orders" || tab === "Inventory" || tab === "Incidents") && (
          <section className="px-6 py-5">
            <div className="rounded-xl border border-gray-200 px-4 py-6 text-center dark:border-slate-800">
              <p className="m-0 text-sm font-bold text-gray-900 dark:text-slate-100">
                {tab === "Orders" ? `${row.activeOrders} active order${row.activeOrders === 1 ? "" : "s"}`
                  : tab === "Inventory" ? `${row.stockUnitsHeld} unit${row.stockUnitsHeld === 1 ? "" : "s"} held`
                    : `${row.openIncidents} open incident${row.openIncidents === 1 ? "" : "s"}`}
              </p>
              <p className="m-0 mt-1 text-[12px] font-medium text-gray-400">
                The full record lives on this agent's own page, where it can be acted on.
              </p>
              <button type="button"
                onClick={() => props.onOpenAgent(row.id, tab === "Orders" ? "orders" : tab === "Inventory" ? "inventory" : "incidents")}
                className="!min-h-0 mt-2.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-bold text-[#1F8FE0] hover:bg-blue-50 dark:bg-transparent">
                Open {tab}
              </button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
