import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  AlertTriangle, ArrowUpRight, Banknote, CalendarDays, CheckCircle2, Info, Landmark,
  Lock, MoreVertical, Pencil, PiggyBank, Plus, ShieldAlert, Trash2, TrendingUp, Unlock, Wallet, X
} from "lucide-react";
import type { BankAccountRow, ReserveCategoryKey, ReserveRow, ReservesView } from "../lib/api";

// Restricted cash: money still in the account but already spoken for.
//
// ⚠️ A reserve is a LABEL, never a movement. Setting money aside does not
// transfer or withdraw a naira - bank balances, cash flow and reconciliation
// are all untouched. The only figure a reserve changes is Free Operating Cash.

const naira = (value: number) => `₦${Math.round(Number(value) || 0).toLocaleString("en-NG")}`;
const signedNaira = (value: number) => {
  const rounded = Math.round(Number(value) || 0);
  return rounded < 0 ? `−₦${Math.abs(rounded).toLocaleString("en-NG")}` : `₦${rounded.toLocaleString("en-NG")}`;
};
const dateLabel = (key: string | null) =>
  key ? new Date(`${key}T12:00:00Z`).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" }) : "—";

const SLICE_COLORS = ["#EF4444", "#3B82F6", "#8B5CF6", "#F59E0B", "#10B981", "#EC4899", "#64748B"];

const CATEGORY_LABEL: Record<ReserveCategoryKey, string> = {
  payroll: "Payroll", tax: "Tax", supplier: "Supplier Commitment",
  advertising: "Advertising", emergency: "Emergency", owner: "Owner Distribution", other: "Other"
};
const CATEGORY_ICON: Record<ReserveCategoryKey, typeof Info> = {
  payroll: Wallet, tax: Landmark, supplier: Banknote, advertising: TrendingUp,
  emergency: ShieldAlert, owner: PiggyBank, other: Lock
};

const STATUS_CHIP: Record<ReserveRow["displayStatus"], { label: string; chip: string }> = {
  active: { label: "Active", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  due_soon: { label: "Due Soon", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  overdue: { label: "Overdue", chip: "bg-rose-50 text-rose-700 border-rose-200" },
  released: { label: "Fully Released", chip: "bg-gray-100 text-gray-600 border-gray-200" },
  cancelled: { label: "Cancelled", chip: "bg-gray-100 text-gray-500 border-gray-200" }
};

const INSIGHT_STYLE = {
  healthy: { tone: "text-emerald-600 bg-emerald-50", icon: CheckCircle2 },
  info: { tone: "text-blue-600 bg-blue-50", icon: Info },
  warning: { tone: "text-amber-600 bg-amber-50", icon: AlertTriangle },
  critical: { tone: "text-rose-600 bg-rose-50", icon: ShieldAlert }
} as const;

const FILTERS = ["All Reserves", "Active Reserves", "Fully Released", "Expired / Overdue"] as const;
type ReserveFilter = (typeof FILTERS)[number];

function Modal({ title, subtitle, icon: Icon, onClose, children, footer }: {
  title: string; subtitle: string; icon: typeof Info;
  onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={onClose}
        className="!min-h-0 absolute inset-0 cursor-default bg-slate-900/40 p-0" />
      <div className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Icon className="h-5 w-5" />
            </span>
            <div>
              <h3 className="m-0 text-lg font-black text-gray-900">{title}</h3>
              <p className="m-0 mt-0.5 text-[13px] font-medium text-gray-500">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex flex-wrap justify-end gap-2.5 border-t border-gray-100 px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

export type ReservesTabProps = {
  view: ReservesView | null;
  accounts: BankAccountRow[];
  loading: boolean;
  saving: boolean;
  onCreate: (body: {
    name: string; purpose: string; bankAccountId: string | null; amount: number;
    availableToUse: boolean; expectedReleaseDate: string | null; category: ReserveCategoryKey;
  }) => Promise<void>;
  onUpdate: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRelease: (id: string, body: { amount: number; note: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export default function ReservesTab(props: ReservesTabProps) {
  const { view, loading } = props;
  const [filter, setFilter] = useState<ReserveFilter>("All Reserves");
  const [editing, setEditing] = useState<ReserveRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState<ReserveRow | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = view?.reserves ?? [];
    if (filter === "Active Reserves") return all.filter((row) => row.displayStatus === "active" || row.displayStatus === "due_soon");
    if (filter === "Fully Released") return all.filter((row) => row.displayStatus === "released");
    if (filter === "Expired / Overdue") return all.filter((row) => row.displayStatus === "overdue");
    return all;
  }, [view, filter]);

  const summary = view?.summary;
  const releasedThisWeek = (view?.reserves ?? []).filter((row) => row.releasedAmount > 0);

  const cards = [
    { label: "Total Reserved", value: naira(summary?.totalReserved ?? 0), hint: `Across ${summary?.activeCount ?? 0} reserve${(summary?.activeCount ?? 0) === 1 ? "" : "s"}`, icon: Lock, tone: "bg-violet-50 text-violet-600", valueTone: "text-gray-900" },
    { label: "Total Liquid Cash", value: naira(summary?.totalLiquidCash ?? 0), hint: "All accounts + cash in hand", icon: Landmark, tone: "bg-blue-50 text-blue-600", valueTone: "text-gray-900" },
    {
      label: "Free Operating Cash", value: signedNaira(summary?.freeOperatingCash ?? 0),
      hint: summary?.overCommitted ? "You have reserved more than you hold" : "Available for operations",
      icon: Wallet, tone: summary?.overCommitted ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600",
      valueTone: summary?.overCommitted ? "text-rose-600" : "text-gray-900"
    },
    { label: "% of Cash Reserved", value: `${(summary?.reservedPct ?? 0).toFixed(2)}%`, hint: "Of total liquid cash", icon: TrendingUp, tone: "bg-amber-50 text-amber-600", valueTone: "text-gray-900" },
    { label: "Released So Far", value: naira(releasedThisWeek.reduce((sum, row) => sum + row.releasedAmount, 0)), hint: `From ${releasedThisWeek.length} reserve${releasedThisWeek.length === 1 ? "" : "s"}`, icon: Unlock, tone: "bg-emerald-50 text-emerald-600", valueTone: "text-gray-900" }
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-2xl font-black text-gray-900">
            Restricted Cash / Reserves
            <span title="A reserve is a label, not a transfer. The cash stays exactly where it is - reserving only takes it out of Free Operating Cash."
              className="cursor-help text-gray-300 hover:text-gray-500"><Info className="h-4 w-4" /></span>
          </h2>
          <p className="m-0 mt-1 text-sm text-gray-500">Track and manage cash set aside for specific obligations and future needs.</p>
        </div>
        <button type="button" onClick={() => setCreating(true)}
          className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl border border-[#1F8FE0] bg-white px-3.5 py-2.5 text-sm font-bold text-[#1F8FE0] hover:bg-blue-50">
          <Plus className="h-4 w-4" /> Add Reserve
        </button>
      </div>

      {summary?.overCommitted && (
        <p className="m-0 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-[13px] font-bold text-rose-700">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          You have reserved {naira(summary.totalReserved)} against {naira(summary.totalLiquidCash)} of liquid cash.
          {" "}{naira(Math.abs(summary.freeOperatingCash))} of what you have promised is not actually there.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
              <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="m-0 mt-2.5 text-[11px] font-black uppercase tracking-wide text-gray-500">{card.label}</p>
              <p className={`m-0 mt-0.5 text-xl font-black ${card.valueTone}`}>{card.value}</p>
              <p className="m-0 mt-0.5 text-[11px] font-semibold text-gray-400">{card.hint}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-2xl border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-4 py-3">
            <div className="inline-flex flex-wrap items-center rounded-xl bg-gray-100 p-1">
              {FILTERS.map((entry) => (
                <button key={entry} type="button" onClick={() => setFilter(entry)}
                  className={`!min-h-0 rounded-lg px-3 py-1.5 text-[12px] font-black transition-colors ${filter === entry ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"}`}>
                  {entry}
                </button>
              ))}
            </div>
          </div>

          {loading && !view ? (
            <p className="m-0 px-4 py-10 text-center text-[13px] font-semibold text-gray-500">Loading reserves…</p>
          ) : rows.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Lock className="mx-auto h-8 w-8 text-gray-300" />
              <p className="m-0 mt-2 text-[13px] font-bold text-gray-700">
                {filter === "All Reserves" ? "Nothing is reserved yet" : `No ${filter.toLowerCase()}`}
              </p>
              <p className="m-0 mt-1 text-[12px] font-medium text-gray-500">
                Set cash aside for payroll, tax or supplier commitments so it stops looking spendable.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[940px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5">Reserve Name</th>
                    <th className="px-4 py-2.5">Purpose</th>
                    <th className="px-4 py-2.5">Account / Source</th>
                    <th className="px-4 py-2.5 text-right">Amount Reserved (₦)</th>
                    <th className="px-4 py-2.5">Available To Use</th>
                    <th className="px-4 py-2.5">Expected Release</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const Icon = CATEGORY_ICON[row.category] ?? Lock;
                    const left = row.expectedReleaseDate && view
                      ? Math.round((new Date(`${row.expectedReleaseDate}T00:00:00Z`).getTime()
                        - new Date(`${view.today}T00:00:00Z`).getTime()) / 86_400_000)
                      : null;
                    return (
                      <tr key={row.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-bold text-gray-900">{row.name}</span>
                              <span className="block text-[11px] font-semibold text-gray-400">ID: {row.refCode}</span>
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[12px] font-medium text-gray-600">{row.purpose || "—"}</td>
                        <td className="px-4 py-3 text-[12px] font-semibold text-gray-600">{row.accountLabel || "Business-wide"}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="block text-[13px] font-black text-gray-900">{naira(row.outstanding)}</span>
                          {row.releasedAmount > 0 && (
                            <span className="block text-[11px] font-semibold text-emerald-600">
                              {naira(row.releasedAmount)} released of {naira(row.amount)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-black ${row.availableToUse ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                            {row.availableToUse ? "Yes" : "No"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="block text-[12px] font-semibold text-gray-700">{dateLabel(row.expectedReleaseDate)}</span>
                          {left !== null && row.displayStatus !== "released" && (
                            <span className={`block text-[11px] font-black ${left < 0 ? "text-rose-600" : left <= 7 ? "text-amber-600" : "text-gray-400"}`}>
                              {left < 0 ? `${Math.abs(left)} days overdue` : left === 0 ? "Due today" : `${left} days left`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ${STATUS_CHIP[row.displayStatus].chip}`}>
                            {STATUS_CHIP[row.displayStatus].label}
                          </span>
                        </td>
                        <td className="relative px-4 py-3 text-right">
                          <button type="button" aria-label={`Actions for ${row.name}`}
                            onClick={() => setMenuFor(menuFor === row.id ? null : row.id)}
                            className="!min-h-0 rounded-lg bg-transparent p-1 text-gray-400 hover:text-gray-700">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {menuFor === row.id && (
                            <span className="absolute right-4 top-11 z-10 flex w-40 flex-col rounded-xl border border-gray-200 bg-white py-1 text-left shadow-lg">
                              <button type="button" onClick={() => { setEditing(row); setMenuFor(null); }}
                                className="!min-h-0 inline-flex items-center gap-2 bg-transparent px-3 py-2 text-left text-[13px] font-bold text-gray-700 hover:bg-gray-50">
                                <Pencil className="h-3.5 w-3.5" /> Edit reserve
                              </button>
                              {row.outstanding > 0 && (
                                <button type="button" onClick={() => { setReleasing(row); setMenuFor(null); }}
                                  className="!min-h-0 inline-flex items-center gap-2 bg-transparent px-3 py-2 text-left text-[13px] font-bold text-emerald-700 hover:bg-emerald-50">
                                  <Unlock className="h-3.5 w-3.5" /> Release funds
                                </button>
                              )}
                              <button type="button"
                                onClick={() => { void props.onDelete(row.id); setMenuFor(null); }}
                                className="!min-h-0 inline-flex items-center gap-2 bg-transparent px-3 py-2 text-left text-[13px] font-bold text-rose-600 hover:bg-rose-50">
                                <Trash2 className="h-3.5 w-3.5" /> Remove
                              </button>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <button type="button" onClick={() => setCreating(true)}
            className="!min-h-0 m-3 inline-flex w-[calc(100%-1.5rem)] items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-3 text-[13px] font-bold text-[#1F8FE0] hover:bg-blue-50">
            <Plus className="h-4 w-4" /> Create New Reserve
          </button>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Reserves Breakdown
            </h3>
            <div className="px-5 py-4">
              {(view?.breakdown.slices.length ?? 0) === 0 ? (
                <p className="m-0 text-[12px] font-semibold text-gray-500">Nothing reserved yet.</p>
              ) : (
                <>
                  <div className="relative h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={view!.breakdown.slices} dataKey="amount" nameKey="label"
                          innerRadius={52} outerRadius={72} paddingAngle={2} stroke="none">
                          {view!.breakdown.slices.map((slice, index) => (
                            <Cell key={slice.id} fill={SLICE_COLORS[index % SLICE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: number) => naira(value)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <span className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-base font-black text-gray-900">{naira(view!.breakdown.total)}</span>
                      <span className="text-[11px] font-semibold text-gray-400">Total Reserved</span>
                    </span>
                  </div>
                  <ul className="m-0 mt-3 list-none space-y-2 p-0">
                    {view!.breakdown.slices.map((slice, index) => (
                      <li key={slice.id} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ background: SLICE_COLORS[index % SLICE_COLORS.length] }} />
                          <span className="truncate text-[12px] font-semibold text-gray-600">{slice.label}</span>
                        </span>
                        <span className="shrink-0 text-[12px] font-black text-gray-900">{slice.sharePct.toFixed(2)}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white">
            <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
              Reserves Insights
            </h3>
            <ul className="m-0 list-none space-y-3 p-0 px-5 py-4">
              {(view?.insights ?? []).map((insight) => {
                const style = INSIGHT_STYLE[insight.kind];
                const Icon = style.icon;
                return (
                  <li key={insight.title} className="flex gap-2.5">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${style.tone}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-black text-gray-900">{insight.title}</span>
                      <span className="block text-[11px] font-medium text-gray-500">{insight.detail}</span>
                    </span>
                  </li>
                );
              })}
              {(view?.insights.length ?? 0) === 0 && (
                <li className="text-[12px] font-semibold text-gray-500">Nothing to flag.</li>
              )}
            </ul>
          </section>
        </aside>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white">
        <h3 className="m-0 border-b border-gray-100 px-5 py-4 text-[12px] font-black uppercase tracking-wide text-gray-700">
          Upcoming Reserve Releases
        </h3>
        {(view?.upcoming.length ?? 0) === 0 ? (
          <p className="m-0 px-5 py-6 text-center text-[13px] font-semibold text-gray-500">
            Nothing is due for release in the next 30 days.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-black uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-2.5">Reserve Name</th>
                  <th className="px-5 py-2.5 text-right">Amount</th>
                  <th className="px-5 py-2.5">Release Date</th>
                  <th className="px-5 py-2.5">Days Left</th>
                  <th className="px-5 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(view?.upcoming ?? []).map((entry) => {
                  const row = view?.reserves.find((reserve) => reserve.id === entry.id);
                  return (
                    <tr key={entry.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-5 py-3 text-[13px] font-bold text-gray-900">{entry.name}</td>
                      <td className="px-5 py-3 text-right text-[13px] font-black text-gray-900">{naira(entry.amount)}</td>
                      <td className="px-5 py-3 text-[12px] font-semibold text-gray-600">{dateLabel(entry.releaseDate)}</td>
                      <td className={`px-5 py-3 text-[12px] font-black ${entry.daysLeft < 0 ? "text-rose-600" : entry.daysLeft <= 7 ? "text-amber-600" : "text-gray-500"}`}>
                        {entry.daysLeft < 0 ? `${Math.abs(entry.daysLeft)} days overdue` : entry.daysLeft === 0 ? "Due today" : `${entry.daysLeft} days`}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button type="button" disabled={!row}
                          onClick={() => row && setReleasing(row)}
                          className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-[12px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                          <Unlock className="h-3.5 w-3.5" /> Release
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="m-0 flex gap-2 rounded-xl bg-violet-50 px-3.5 py-3 text-[12px] font-semibold text-violet-800">
        <Lock className="mt-0.5 h-4 w-4 shrink-0" />
        Reserved funds are protected and cannot be used for regular operations unless released. Reserving does not move
        any money — every bank balance, cash flow total and reconciliation figure is unchanged.
      </p>

      {(creating || editing) && (
        <ReserveFormModal
          reserve={editing} accounts={props.accounts} saving={props.saving}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSubmit={async (body) => {
            if (editing) await props.onUpdate(editing.id, body);
            else await props.onCreate(body);
            setCreating(false); setEditing(null);
          }}
        />
      )}

      {releasing && (
        <ReleaseModal
          reserve={releasing} saving={props.saving}
          onClose={() => setReleasing(null)}
          onSubmit={async (body) => { await props.onRelease(releasing.id, body); setReleasing(null); }}
        />
      )}
    </div>
  );
}

function ReserveFormModal({ reserve, accounts, saving, onClose, onSubmit }: {
  reserve: ReserveRow | null;
  accounts: BankAccountRow[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: {
    name: string; purpose: string; bankAccountId: string | null; amount: number;
    availableToUse: boolean; expectedReleaseDate: string | null; category: ReserveCategoryKey;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(reserve?.name ?? "");
  const [purpose, setPurpose] = useState(reserve?.purpose ?? "");
  const [category, setCategory] = useState<ReserveCategoryKey>(reserve?.category ?? "other");
  const [bankAccountId, setBankAccountId] = useState(reserve?.bankAccountId ?? "");
  const [amount, setAmount] = useState(reserve ? String(reserve.amount) : "");
  const [availableToUse, setAvailableToUse] = useState(reserve?.availableToUse ?? false);
  const [releaseDate, setReleaseDate] = useState(reserve?.expectedReleaseDate ?? "");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    const parsed = Number(String(amount).replace(/,/g, ""));
    if (!name.trim()) { setError("Give the reserve a name."); return; }
    if (!Number.isFinite(parsed) || parsed <= 0) { setError("A reserve has to be more than ₦0."); return; }
    if (reserve && parsed < reserve.releasedAmount) {
      setError(`${naira(reserve.releasedAmount)} has already been released, so it cannot be reduced below that.`);
      return;
    }
    try {
      await onSubmit({
        name: name.trim(), purpose: purpose.trim(),
        bankAccountId: bankAccountId || null, amount: parsed,
        availableToUse, expectedReleaseDate: releaseDate || null, category
      });
    } catch (submitError: any) {
      setError(submitError?.message ?? "That did not save.");
    }
  };

  return (
    <Modal
      title={reserve ? "Edit Reserve" : "Create New Reserve"}
      subtitle="Set aside cash for a specific obligation, goal or future need."
      icon={Lock} onClose={onClose}
      footer={
        <>
          {error && <p className="m-0 mr-auto text-[12px] font-bold text-rose-600">{error}</p>}
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={() => void submit()}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-[#1F8FE0] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1a7cc4] disabled:opacity-50">
            <Lock className="h-4 w-4" /> {reserve ? "Save Reserve" : "Create Reserve"}
          </button>
        </>
      }
    >
      <p className="m-0 flex gap-2 rounded-xl bg-blue-50 px-3 py-3 text-[12px] font-semibold text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Reserving does not move any money. The cash stays exactly where it is — it just stops counting towards
        Free Operating Cash.
      </p>
      <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
        Reserve Name
        <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)}
          placeholder="Payroll Reserve – August"
          className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900" />
      </label>
      <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
        Purpose
        <input value={purpose} maxLength={200} onChange={(event) => setPurpose(event.target.value)}
          placeholder="Employee salaries for August"
          className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
          Amount (₦)
          <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900" />
        </label>
        <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value as ReserveCategoryKey)}
            className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900">
            {(Object.keys(CATEGORY_LABEL) as ReserveCategoryKey[]).map((key) => (
              <option key={key} value={key}>{CATEGORY_LABEL[key]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
          Account / Source
          <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)}
            className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900">
            <option value="">Business-wide (no single account)</option>
            {accounts.filter((account) => account.active).map((account) => (
              <option key={account.id} value={account.id}>{account.name}</option>
            ))}
          </select>
        </label>
        <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
          Expected Release
          <input type="date" value={releaseDate} onChange={(event) => setReleaseDate(event.target.value)}
            className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900" />
        </label>
      </div>
      <label className="m-0 flex items-start gap-2.5 rounded-xl border border-gray-200 px-3 py-3">
        <input type="checkbox" checked={availableToUse} onChange={(event) => setAvailableToUse(event.target.checked)}
          className="mt-0.5 h-4 w-4" />
        <span>
          <span className="block text-[13px] font-bold text-gray-900">Available to use without releasing</span>
          <span className="block text-[11px] font-medium text-gray-500">
            Leave off for money that must not be touched, like payroll or tax.
          </span>
        </span>
      </label>
    </Modal>
  );
}

function ReleaseModal({ reserve, saving, onClose, onSubmit }: {
  reserve: ReserveRow;
  saving: boolean;
  onClose: () => void;
  onSubmit: (body: { amount: number; note: string }) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(reserve.outstanding));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const parsed = Number(String(amount).replace(/,/g, ""));
  const valid = Number.isFinite(parsed) && parsed > 0 && parsed <= reserve.outstanding;

  const submit = async () => {
    setError("");
    if (!valid) { setError(`Enter an amount between ₦1 and ${naira(reserve.outstanding)}.`); return; }
    try {
      await onSubmit({ amount: parsed, note: note.trim() });
    } catch (submitError: any) {
      setError(submitError?.message ?? "Could not release that reserve.");
    }
  };

  return (
    <Modal
      title="Release Funds" subtitle={`Free up cash held under ${reserve.name}.`}
      icon={Unlock} onClose={onClose}
      footer={
        <>
          {error && <p className="m-0 mr-auto text-[12px] font-bold text-rose-600">{error}</p>}
          <button type="button" onClick={onClose}
            className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button type="button" disabled={saving || !valid} onClick={() => void submit()}
            className="!min-h-0 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
            <Unlock className="h-4 w-4" /> Release {naira(Number.isFinite(parsed) ? parsed : 0)}
          </button>
        </>
      }
    >
      <div className="rounded-xl bg-gray-50 px-3.5 py-3">
        <p className="m-0 text-[12px] font-semibold text-gray-500">Currently held</p>
        <p className="m-0 text-xl font-black text-gray-900">{naira(reserve.outstanding)}</p>
        {reserve.releasedAmount > 0 && (
          <p className="m-0 text-[11px] font-semibold text-emerald-600">
            {naira(reserve.releasedAmount)} already released of {naira(reserve.amount)}
          </p>
        )}
      </div>
      <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
        Amount to release (₦)
        <input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}
          className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-bold text-gray-900" />
      </label>
      <label className="m-0 block text-[11px] font-black uppercase tracking-wide text-gray-500">
        Note (Optional)
        <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)}
          placeholder="Paid August salaries"
          className="mt-1.5 block w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] font-medium text-gray-900" />
      </label>
      <p className="m-0 flex gap-2 rounded-xl bg-blue-50 px-3 py-3 text-[12px] font-semibold text-blue-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Releasing does not move money either — it only stops this amount being held back from Free Operating Cash.
      </p>
    </Modal>
  );
}
