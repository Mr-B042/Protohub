import { createPortal } from "react-dom";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleDollarSign,
  Gauge,
  Gift,
  Info,
  Package,
  Pencil,
  Plus,
  Target,
  MoreVertical,
  Trash2,
  TrendingUp,
  Wallet,
  X,
  XCircle
} from "lucide-react";
import { LoadingState } from "./ui/loading-state";

export type ManagerChallengeMilestone = {
  index: number;
  startDate: string;
  endDate: string;
  targetUnits: number;
  progressUnits: number;
  progressPercent: number;
  rewardAmount: number;
  earnedRewardAmount: number;
  status: "Earned" | "Missed" | "In Progress" | "Upcoming" | "Paused" | "Draft";
};

export type ManagerProductChallenge = {
  id: string;
  productId: string;
  name: string;
  cadence: "weekly" | "monthly" | "quarterly";
  targetUnits: number;
  startDate: string;
  endDate: string;
  rewardAmount: number;
  currency: string;
  milestoneMode: "none" | "weekly";
  milestoneDistribution: "even" | "custom";
  milestoneTargets: number[];
  milestones: ManagerChallengeMilestone[];
  earnedRewardAmount: number;
  status: "draft" | "active" | "paused" | "completed";
  description: string;
  progressUnits: number;
  progressPercent: number;
  expectedPercent: number;
  daysLeft: number;
  computedStatus: string;
  qualifiedOrders: number;
};

export type ManagerChallengeDraft = Pick<
  ManagerProductChallenge,
  | "productId"
  | "name"
  | "cadence"
  | "targetUnits"
  | "startDate"
  | "endDate"
  | "rewardAmount"
  | "currency"
  | "milestoneMode"
  | "milestoneDistribution"
  | "milestoneTargets"
  | "status"
  | "description"
>;

type ChallengeProduct = { id: string; name: string; imageUrl?: string; active?: boolean };

type Props = {
  role: string;
  products: ChallengeProduct[];
  challenges: ManagerProductChallenge[];
  loading: boolean;
  error: string;
  formatMoney: (amount: number, currency: string) => string;
  onSave: (draft: ManagerChallengeDraft, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenBonusRules: () => void;
};

const fieldControlClass = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100";

const DAY_MS = 86_400_000;

const dateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseDateKey = (value: string) => new Date(`${value}T12:00:00`);

const formatDateShort = (value: string) => {
  const date = parseDateKey(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-NG", { month: "short", day: "numeric" });
};

const endForCadence = (startDate: string, cadence: ManagerChallengeDraft["cadence"]) => {
  const start = parseDateKey(startDate);
  if (Number.isNaN(start.getTime())) return startDate;
  const end = new Date(start);
  if (cadence === "weekly") end.setDate(end.getDate() + 6);
  if (cadence === "monthly") end.setMonth(end.getMonth() + 1, 0);
  if (cadence === "quarterly") end.setMonth(end.getMonth() + 3, 0);
  return dateKey(end);
};

const milestoneCount = (cadence: ManagerChallengeDraft["cadence"]) =>
  cadence === "monthly" ? 4 : cadence === "quarterly" ? 12 : 1;

const distributeWholeNumber = (total: number, count: number) => {
  const safeTotal = Math.max(0, Math.trunc(total));
  const safeCount = Math.max(1, Math.trunc(count));
  const base = Math.floor(safeTotal / safeCount);
  const remainder = safeTotal - base * safeCount;
  return Array.from({ length: safeCount }, (_, index) => base + (index < remainder ? 1 : 0));
};

const milestoneRanges = (startDate: string, endDate: string, count: number) => {
  const start = parseDateKey(startDate);
  const end = parseDateKey(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const windowDays = Math.max(1, Math.floor(days / Math.max(1, count)));
  return Array.from({ length: count }, (_, index) => {
    const rangeStart = new Date(start);
    rangeStart.setDate(rangeStart.getDate() + index * windowDays);
    const rangeEnd = index === count - 1 ? new Date(end) : new Date(rangeStart);
    if (index !== count - 1) rangeEnd.setDate(rangeEnd.getDate() + windowDays - 1);
    return { startDate: dateKey(rangeStart), endDate: dateKey(rangeEnd) };
  });
};

const defaultDraft = (products: ChallengeProduct[]): ManagerChallengeDraft => {
  const today = new Date();
  const startDate = dateKey(new Date(today.getFullYear(), today.getMonth(), 1, 12));
  const product = products.find((item) => item.active !== false) ?? products[0];
  return {
    productId: product?.id ?? "",
    name: product ? `${product.name} - Monthly Challenge` : "Monthly Product Challenge",
    cadence: "monthly",
    targetUnits: 1_000,
    startDate,
    endDate: endForCadence(startDate, "monthly"),
    rewardAmount: 0,
    currency: "NGN",
    milestoneMode: "weekly",
    milestoneDistribution: "even",
    milestoneTargets: [],
    status: "active",
    description: "Complete each weekly milestone to earn that portion of the monthly product reward."
  };
};

const statusStyle = (status: string) => {
  if (["Achieved", "On Track", "Completed", "Earned"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (["At Risk", "Upcoming", "In Progress"].includes(status)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (["Behind", "Ended", "Missed"].includes(status)) return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-gray-200 bg-gray-50 text-gray-600";
};

const milestoneTone = (status: ManagerChallengeMilestone["status"]) => {
  if (status === "Earned") return { card: "border-emerald-200 bg-emerald-50/50", bar: "bg-violet-600", value: "text-violet-700", footer: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircle2 };
  if (status === "Missed") return { card: "border-rose-200 bg-rose-50/50", bar: "bg-orange-500", value: "text-orange-600", footer: "border-rose-200 bg-rose-50 text-rose-700", Icon: XCircle };
  return { card: "border-blue-200 bg-blue-50/40", bar: "bg-blue-600", value: "text-blue-700", footer: "border-blue-200 bg-blue-50 text-blue-700", Icon: Circle };
};

const CARD_ACCENTS = [
  { bar: "bg-violet-500", label: "text-violet-600" },
  { bar: "bg-emerald-500", label: "text-emerald-600" },
  { bar: "bg-blue-500", label: "text-blue-600" },
  { bar: "bg-amber-500", label: "text-amber-600" }
];

export function ManagerProductChallenges({
  role,
  products,
  challenges,
  loading,
  error,
  formatMoney,
  onSave,
  onDelete,
  onOpenBonusRules
}: Props) {
  const canEdit = role === "Owner";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"Challenges" | "Bonus Rules">("Challenges");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draft, setDraft] = useState<ManagerChallengeDraft>(() => defaultDraft(products));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null);
  const [showAllProducts, setShowAllProducts] = useState(false);

  const productMap = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  useEffect(() => {
    if (!challenges.some((challenge) => challenge.id === selectedChallengeId)) setSelectedChallengeId(challenges[0]?.id ?? null);
  }, [challenges, selectedChallengeId]);
  const orderedChallenges = useMemo(() => [...challenges].sort((a, b) => {
    const rank = (challenge: ManagerProductChallenge) => {
      if (challenge.progressUnits >= challenge.targetUnits) return 3;
      const totalDays = Math.max(1, Math.ceil((parseDateKey(challenge.endDate).getTime() - parseDateKey(challenge.startDate).getTime()) / DAY_MS) + 1);
      const elapsed = Math.max(0, totalDays - Math.max(0, challenge.daysLeft));
      if (elapsed <= 1 && challenge.progressUnits === 0) return 2;
      const expected = (elapsed / totalDays) * challenge.targetUnits;
      const pace = expected > 0 ? challenge.progressUnits / expected : 1;
      return pace < 0.8 ? 0 : pace < 0.95 ? 1 : 2;
    };
    return rank(a) - rank(b);
  }), [challenges]);
  const previewProduct = productMap.get(draft.productId);
  const draftCount = milestoneCount(draft.cadence);
  const visibleTargets = draft.milestoneDistribution === "custom"
    ? draft.milestoneTargets
    : distributeWholeNumber(draft.targetUnits, draftCount);
  const visibleRanges = milestoneRanges(draft.startDate, draft.endDate, draftCount);

  const openNew = () => {
    setEditingId(undefined);
    setDraft(defaultDraft(products));
    setFormError("");
    setDrawerTab("Challenges");
    setDrawerOpen(true);
  };

  const openEdit = (challenge: ManagerProductChallenge) => {
    setEditingId(challenge.id);
    setDraft({
      productId: challenge.productId,
      name: challenge.name,
      cadence: challenge.cadence,
      targetUnits: challenge.targetUnits,
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      rewardAmount: challenge.rewardAmount,
      currency: challenge.currency,
      milestoneMode: challenge.milestoneMode ?? "none",
      milestoneDistribution: challenge.milestoneDistribution ?? "even",
      milestoneTargets: challenge.milestoneTargets ?? [],
      status: challenge.status,
      description: challenge.description
    });
    setFormError("");
    setDrawerTab("Challenges");
    setDrawerOpen(true);
  };

  const setCadence = (cadence: ManagerChallengeDraft["cadence"]) => {
    setDraft((current) => ({
      ...current,
      cadence,
      milestoneMode: cadence === "weekly" ? "none" : current.milestoneMode,
      endDate: endForCadence(current.startDate, cadence),
      milestoneTargets: current.milestoneDistribution === "custom"
        ? distributeWholeNumber(current.targetUnits, milestoneCount(cadence))
        : []
    }));
  };

  const chooseDistribution = (distribution: ManagerChallengeDraft["milestoneDistribution"]) => {
    setDraft((current) => ({
      ...current,
      milestoneDistribution: distribution,
      milestoneTargets: distribution === "custom"
        ? distributeWholeNumber(current.targetUnits, milestoneCount(current.cadence))
        : []
    }));
  };

  const save = async () => {
    if (!draft.productId) return setFormError("Choose a product.");
    if (!draft.name.trim()) return setFormError("Enter a challenge name.");
    if (draft.targetUnits < 1) return setFormError("Target pieces must be at least 1.");
    if (!draft.startDate || !draft.endDate || draft.endDate < draft.startDate) return setFormError("Choose a valid date range.");
    if (draft.milestoneMode === "weekly" && draft.milestoneDistribution === "custom") {
      if (draft.milestoneTargets.length !== draftCount) return setFormError(`Enter all ${draftCount} milestone targets.`);
      const total = draft.milestoneTargets.reduce((sum, target) => sum + Number(target || 0), 0);
      if (total !== draft.targetUnits) {
        return setFormError(`Milestone targets total ${total.toLocaleString()} pcs, but the challenge target is ${draft.targetUnits.toLocaleString()} pcs.`);
      }
    }
    setSaving(true);
    setFormError("");
    try {
      await onSave(draft, editingId);
      setDrawerOpen(false);
    } catch (saveError: any) {
      setFormError(saveError?.message ?? "Could not save this challenge.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId || !window.confirm("Remove this challenge? Existing orders will not be changed.")) return;
    setSaving(true);
    setFormError("");
    try {
      await onDelete(editingId);
      setDrawerOpen(false);
    } catch (deleteError: any) {
      setFormError(deleteError?.message ?? "Could not remove this challenge.");
    } finally {
      setSaving(false);
    }
  };

  const drawer = drawerOpen && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[130] flex justify-end bg-slate-950/30" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) setDrawerOpen(false);
    }}>
      <aside className="flex h-full w-full max-w-[480px] flex-col border-l border-gray-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label="Owner settings">
        <header className="flex items-start justify-between border-b border-gray-100 px-5 py-5">
          <div>
            <h2 className="text-xl font-black text-gray-950">Owner Settings</h2>
            <p className="mt-1 text-sm font-medium text-gray-500">Create and manage product challenges.</p>
          </div>
          <button type="button" className="!min-h-0 flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setDrawerOpen(false)} title="Close owner settings">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex gap-2 border-b border-gray-100 px-5 py-3">
          {(["Challenges", "Bonus Rules"] as const).map((tab) => (
            <button key={tab} type="button" className={`!min-h-0 rounded-lg px-3 py-2 text-sm font-black ${drawerTab === tab ? "bg-violet-50 text-violet-700 shadow-sm" : "text-gray-600"}`} onClick={() => setDrawerTab(tab)}>
              {tab}
            </button>
          ))}
        </div>

        {drawerTab === "Challenges" ? (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-4 rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-gray-900">{editingId ? "Edit Challenge" : "Create Challenge"}</h3>
                  <p className="mt-1 text-xs font-medium text-gray-400">Cancelled, failed, and held orders do not count.</p>
                </div>
                {editingId && (
                  <button type="button" className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-2 text-xs font-black text-rose-600" disabled={saving} onClick={remove}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                )}
              </div>

              <FieldLabel label="Choose product">
                <select className={fieldControlClass} value={draft.productId} onChange={(event) => {
                  const productId = event.target.value;
                  const product = productMap.get(productId);
                  setDraft((current) => ({ ...current, productId, name: editingId ? current.name : `${product?.name ?? "Product"} - Monthly Challenge` }));
                }}>
                  <option value="">Choose product</option>
                  {products.filter((product) => product.active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </FieldLabel>

              <FieldLabel label="Challenge name">
                <input className={fieldControlClass} maxLength={160} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </FieldLabel>

              <div>
                <p className="text-xs font-black text-gray-500">Challenge type</p>
                <div className="mt-1.5 grid grid-cols-3 overflow-hidden rounded-lg border border-gray-200">
                  {(["weekly", "monthly", "quarterly"] as const).map((cadence) => (
                    <button key={cadence} type="button" className={`!min-h-0 border-r border-gray-200 px-2 py-2.5 text-xs font-black capitalize last:border-r-0 ${draft.cadence === cadence ? "bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-300" : "bg-white text-gray-500"}`} onClick={() => setCadence(cadence)}>
                      {cadence}
                    </button>
                  ))}
                </div>
              </div>

              {draft.cadence !== "weekly" && (
                <div>
                  <p className="text-xs font-black text-violet-700">Milestone structure</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" className={`!min-h-0 rounded-lg border p-3 text-left ${draft.milestoneMode === "weekly" ? "border-violet-300 bg-violet-50 text-violet-800" : "border-gray-200 bg-white text-gray-600"}`} onClick={() => setDraft((current) => ({ ...current, milestoneMode: "weekly" }))}>
                      <span className="flex items-center gap-2 text-xs font-black"><CheckCircle2 className="h-4 w-4" /> Weekly milestones</span>
                      <span className="mt-1 block text-[10px] font-semibold leading-4 text-gray-500">Split the full reward into independently earned weeks.</span>
                    </button>
                    <button type="button" className={`!min-h-0 rounded-lg border p-3 text-left ${draft.milestoneMode === "none" ? "border-violet-300 bg-violet-50 text-violet-800" : "border-gray-200 bg-white text-gray-600"}`} onClick={() => setDraft((current) => ({ ...current, milestoneMode: "none", milestoneTargets: [] }))}>
                      <span className="text-xs font-black">No milestones</span>
                      <span className="mt-1 block text-[10px] font-semibold leading-4 text-gray-500">Pay only when the full target is reached.</span>
                    </button>
                  </div>
                </div>
              )}

              <FieldLabel label={`${draft.cadence === "monthly" ? "Monthly" : draft.cadence === "quarterly" ? "Quarterly" : "Weekly"} target (pcs)`}>
                <div className="relative">
                  <input type="number" min="1" className={`${fieldControlClass} pr-12`} value={draft.targetUnits} onChange={(event) => setDraft((current) => ({ ...current, targetUnits: Math.max(0, Number(event.target.value) || 0) }))} />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">pcs</span>
                </div>
              </FieldLabel>

              {draft.milestoneMode === "weekly" && draft.cadence !== "weekly" && (
                <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
                  <p className="text-xs font-black text-violet-700">Weekly milestone setup</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <ChoiceButton selected={draft.milestoneDistribution === "even"} onClick={() => chooseDistribution("even")}>Auto-distribute evenly</ChoiceButton>
                    <ChoiceButton selected={draft.milestoneDistribution === "custom"} onClick={() => chooseDistribution("custom")}>Custom weekly targets</ChoiceButton>
                  </div>
                  <div className={`mt-3 grid gap-2 ${draftCount <= 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
                    {Array.from({ length: draftCount }, (_, index) => (
                      <label key={index} className="text-[10px] font-black text-gray-500">
                        Week {index + 1}
                        <input
                          type="number"
                          min="1"
                          readOnly={draft.milestoneDistribution === "even"}
                          className={`mt-1 w-full rounded-lg border px-2 py-2 text-center text-xs font-black ${draft.milestoneDistribution === "even" ? "border-gray-100 bg-gray-100 text-gray-500" : "border-violet-200 bg-white text-gray-900"}`}
                          value={visibleTargets[index] ?? 0}
                          onChange={(event) => setDraft((current) => {
                            const targets = [...current.milestoneTargets];
                            targets[index] = Math.max(0, Number(event.target.value) || 0);
                            return { ...current, milestoneTargets: targets };
                          })}
                        />
                        <span className="mt-1 block truncate text-[9px] font-semibold text-gray-400">
                          {visibleRanges[index] ? `${formatDateShort(visibleRanges[index].startDate)}-${formatDateShort(visibleRanges[index].endDate)}` : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-right text-[10px] font-bold text-gray-500">Total: {visibleTargets.reduce((sum, target) => sum + Number(target || 0), 0).toLocaleString()} pcs</p>
                </div>
              )}

              <div className="rounded-lg border border-gray-100 bg-gray-50/70 p-3">
                <p className="text-xs font-black text-gray-700">Reward structure</p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <MoneyField label={`Total ${draft.cadence} reward`} value={draft.rewardAmount} onChange={(value) => setDraft((current) => ({ ...current, rewardAmount: value }))} />
                  <MoneyField label="Per milestone reward" value={draft.rewardAmount / (draft.milestoneMode === "weekly" ? draftCount : 1)} readOnly />
                </div>
                <p className="mt-2 text-[10px] font-semibold leading-4 text-gray-500">A week pays only when its own target is met. Rewards are tracked here and are not posted into payroll twice.</p>
              </div>

              <div>
                <p className="text-xs font-black text-gray-500">Challenge period</p>
                <div className="mt-1.5 grid grid-cols-2 gap-3">
                  <FieldLabel label="Start date" small>
                    <input type="date" className={`${fieldControlClass} text-xs`} value={draft.startDate} onChange={(event) => setDraft((current) => ({ ...current, startDate: event.target.value, endDate: endForCadence(event.target.value, current.cadence) }))} />
                  </FieldLabel>
                  <FieldLabel label="End date" small>
                    <input type="date" className={`${fieldControlClass} text-xs`} value={draft.endDate} onChange={(event) => setDraft((current) => ({ ...current, endDate: event.target.value }))} />
                  </FieldLabel>
                </div>
              </div>

              <FieldLabel label="Description (optional)">
                <textarea className={`${fieldControlClass} min-h-[72px] resize-y`} maxLength={1000} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
              </FieldLabel>

              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-3">
                <span>
                  <strong className="block text-xs text-gray-900">Active challenge</strong>
                  <span className="mt-1 block text-[10px] font-semibold text-gray-500">Challenge is live and counting qualified orders.</span>
                </span>
                <input type="checkbox" className="h-5 w-5 accent-violet-600" checked={draft.status === "active"} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.checked ? "active" : "paused" }))} />
              </label>

              <div>
                <p className="mb-2 text-xs font-black text-violet-600">Preview</p>
                <div className="rounded-lg border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm">
                  <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">{draft.cadence} challenge</p>
                  <div className="mt-3 flex items-center gap-3">
                    {previewProduct?.imageUrl
                      ? <img src={previewProduct.imageUrl} alt="" className="h-12 w-12 rounded-lg border border-gray-100 object-cover" />
                      : <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-violet-500"><Package className="h-5 w-5" /></span>}
                    <div className="min-w-0">
                      <h4 className="break-words text-base font-black text-gray-950">{previewProduct?.name ?? "Choose a product"}</h4>
                      <p className="mt-1 text-xs font-semibold text-gray-500">{draft.targetUnits.toLocaleString()} pcs target</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="font-bold text-gray-500">Challenge reward</span>
                    <strong className="text-violet-700">{formatMoney(draft.rewardAmount, draft.currency)}</strong>
                  </div>
                </div>
              </div>

              {formError && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{formError}</p>}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><CircleDollarSign className="h-7 w-7" /></span>
            <h3 className="mt-4 text-lg font-black text-gray-900">Manager bonus rules</h3>
            <p className="mt-2 max-w-sm text-sm font-medium leading-6 text-gray-500">Profit gates and delivery-rate tiers remain in the full Bonus & Performance editor so there is one source of truth.</p>
            <button type="button" className="!min-h-0 mt-5 inline-flex items-center gap-2 rounded-lg bg-gray-950 px-4 py-3 text-sm font-black text-white" onClick={() => { setDrawerOpen(false); onOpenBonusRules(); }}>
              Open bonus rules <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {drawerTab === "Challenges" && (
          <footer className="flex items-center justify-between gap-3 border-t border-gray-100 bg-white px-5 py-4">
            <button type="button" className="!min-h-0 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-black text-gray-600" onClick={() => setDrawerOpen(false)}>Cancel</button>
            <button type="button" className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-200 disabled:opacity-50" disabled={saving} onClick={save}>
              {saving ? "Saving..." : <><Check className="h-4 w-4" /> Save Challenge</>}
            </button>
          </footer>
        )}
      </aside>
    </div>,
    document.body
  ) : null;

  return (
    <>
      <section className="manager-product-challenges overflow-hidden rounded-lg border border-indigo-200 bg-gradient-to-br from-indigo-50/80 via-white to-violet-50/70 shadow-sm" aria-label="Product challenges">
        <header className="flex flex-col gap-3 border-b border-indigo-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-rose-600 shadow-sm"><Target className="h-5 w-5" /></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-indigo-600">Product challenges</p>
              <p className="mt-1 text-sm font-medium text-gray-500">Complete weekly milestones to earn the full monthly reward. Each successful milestone is earned independently.</p>
            </div>
          </div>
          {canEdit && (
            <button type="button" className="!min-h-0 inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-200" onClick={openNew}>
              <Plus className="h-4 w-4" /> Add Challenge
            </button>
          )}
        </header>

        <div className="space-y-4 p-3 sm:p-4">
          {loading ? (
            <LoadingState label="Loading product challenges" />
          ) : error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4 text-sm font-bold text-rose-700">{error}</div>
          ) : challenges.length === 0 ? (
            <div className="manager-product-challenges-empty flex flex-col items-center justify-center rounded-lg border border-dashed border-indigo-200 bg-white/70 px-5 py-8 text-center">
              <Target className="h-7 w-7 text-indigo-300" />
              <h3 className="mt-3 text-sm font-black text-gray-900">No product challenge is active right now</h3>
              <p className="mt-1 max-w-lg text-xs font-medium leading-5 text-gray-500">
                {canEdit
                  ? "Create a monthly challenge and split its reward across weekly milestones."
                  : "The Owner has not set up a product challenge yet."}
              </p>
              {canEdit && <button type="button" className="!min-h-0 mt-4 inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-black text-indigo-700" onClick={openNew}><Plus className="h-3.5 w-3.5" /> Create first challenge</button>}
            </div>
          ) : challenges.length >= 2 ? (
            <>
              <ChallengeSummaryStrip challenges={challenges} formatMoney={formatMoney} />
              <div className="relative rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <button type="button" aria-label="Previous products" className="!min-h-0 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 sm:flex" onClick={() => document.querySelector('.challenge-selector-track')?.scrollBy({ left: -320, behavior: 'smooth' })}>‹</button>
                  <div className="challenge-selector-track flex min-w-0 flex-1 gap-3 overflow-x-auto pb-1">
                  {orderedChallenges.map((challenge, index) => <ChallengeSelector key={challenge.id} challenge={challenge} product={productMap.get(challenge.productId)} selected={selectedChallengeId === challenge.id} onClick={() => setSelectedChallengeId(challenge.id)} accent={CARD_ACCENTS[index % CARD_ACCENTS.length]} />)}
                  </div>
                  <button type="button" aria-label="Next products" className="!min-h-0 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-500 sm:flex" onClick={() => document.querySelector('.challenge-selector-track')?.scrollBy({ left: 320, behavior: 'smooth' })}>›</button>
                  <button type="button" className="!min-h-0 hidden shrink-0 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 xl:block" onClick={() => setShowAllProducts(true)}>View all products</button>
                </div>
              </div>
              {(() => { const selected = challenges.find((challenge) => challenge.id === selectedChallengeId) ?? orderedChallenges[0]; return selected ? <ChallengeCard key={selected.id} challenge={selected} product={productMap.get(selected.productId)} canEdit={canEdit} formatMoney={formatMoney} onEdit={() => openEdit(selected)} onDelete={() => void onDelete(selected.id)} onToggleStatus={() => void onSave({ ...selected, status: selected.status === "active" ? "paused" : "active" }, selected.id)} /> : null; })()}
            </>
          ) : (
            challenges.map((challenge) => (
              <ChallengeCard
                key={challenge.id}
                challenge={challenge}
                product={productMap.get(challenge.productId)}
                canEdit={canEdit}
                formatMoney={formatMoney}
                onEdit={() => openEdit(challenge)}
                onDelete={() => void onDelete(challenge.id)}
                onToggleStatus={() => void onSave({ ...challenge, status: challenge.status === "active" ? "paused" : "active" }, challenge.id)}
              />
            ))
          )}
        </div>
      </section>
      {drawer}
      {showAllProducts && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[125] flex justify-end bg-slate-950/30" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowAllProducts(false); }}><aside className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black text-gray-900">All product challenges</h2><p className="text-xs text-gray-500">Prioritized by attention needed.</p></div><button type="button" className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100" onClick={() => setShowAllProducts(false)}><X className="h-5 w-5" /></button></div><div className="mt-5 space-y-3">{orderedChallenges.map((challenge, index) => <ChallengeSelector key={challenge.id} challenge={challenge} product={productMap.get(challenge.productId)} selected={selectedChallengeId === challenge.id} onClick={() => { setSelectedChallengeId(challenge.id); setShowAllProducts(false); }} accent={CARD_ACCENTS[index % CARD_ACCENTS.length]} />)}</div></aside></div>, document.body)}
    </>
  );
}

function ChallengeCard({
  challenge,
  product,
  canEdit,
  formatMoney,
  onEdit,
  onDelete,
  onToggleStatus
}: {
  challenge: ManagerProductChallenge;
  product?: ChallengeProduct;
  canEdit: boolean;
  formatMoney: Props["formatMoney"];
  onEdit: () => void;
  onDelete: () => void;
  onToggleStatus: () => void;
}) {
  const hasMilestones = challenge.milestoneMode === "weekly" && challenge.milestones?.length > 0;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article className="relative overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
      <div className="h-1 bg-violet-500" />
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            {product?.imageUrl
              ? <img src={product.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-gray-100 object-cover sm:h-20 sm:w-20" />
              : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500 sm:h-20 sm:w-20"><Package className="h-7 w-7" /></span>}
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-violet-600">{challenge.cadence} challenge</p>
              <h3 className="mt-2 break-words text-xl font-black leading-tight text-gray-950">{product?.name ?? challenge.name}</h3>
              <p className="mt-1 text-sm font-semibold text-gray-500">{challenge.name}</p>
              <p className="mt-2 text-xs font-semibold text-gray-400">{challenge.qualifiedOrders} qualified order{challenge.qualifiedOrders === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="min-w-[180px] rounded-lg border border-violet-100 bg-violet-50/70 px-5 py-4 text-center">
              <p className="text-[10px] font-black uppercase tracking-[0.12em] text-violet-600">Challenge reward</p>
              <p className="mt-2 text-2xl font-black text-violet-700">{formatMoney(challenge.rewardAmount, challenge.currency)}</p>
              <p className="mt-1 text-[10px] font-semibold text-gray-500">{hasMilestones ? "Paid through weekly milestones" : "Paid when the full target is met"}</p>
            </div>
            {canEdit && <div className="relative"><button type="button" className="!min-h-0 flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-violet-700" onClick={() => setMenuOpen((open) => !open)} title="Challenge options"><MoreVertical className="h-4 w-4" /></button>{menuOpen && <div className="absolute right-0 top-10 z-10 w-32 rounded-lg border border-gray-200 bg-white p-1 text-left shadow-lg"><button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs font-bold text-gray-700 hover:bg-gray-50" onClick={() => { setMenuOpen(false); onEdit(); }}>Edit</button><button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs font-bold text-amber-700 hover:bg-amber-50" onClick={() => { setMenuOpen(false); onToggleStatus(); }}>{challenge.status === "active" ? "Pause" : "Resume"}</button><button type="button" className="w-full rounded px-2 py-1.5 text-left text-xs font-bold text-rose-600 hover:bg-rose-50" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button></div>}</div>}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 border-y border-gray-100 py-4 sm:grid-cols-3">
          <Metric label={`${challenge.cadence} target`} value={`${challenge.targetUnits.toLocaleString()} pcs`} detail="Total for this challenge" />
          <Metric label="Overall progress" value={`${challenge.progressUnits.toLocaleString()} pcs`} detail={`${challenge.progressPercent}% complete`} />
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">Time remaining</p>
            <p className="mt-2 flex items-center gap-2 text-xl font-black text-gray-900"><CalendarDays className="h-5 w-5 text-gray-400" /> {challenge.daysLeft} day{challenge.daysLeft === 1 ? "" : "s"}</p>
            <p className="mt-1 text-xs font-semibold text-gray-500">Until {formatDateShort(challenge.endDate)}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-700 to-violet-400" style={{ width: `${Math.min(100, challenge.progressPercent)}%` }} />
          </div>
          <span className="shrink-0 text-xs font-black text-gray-500">{challenge.progressUnits.toLocaleString()} / {challenge.targetUnits.toLocaleString()} pcs</span>
        </div>

        {hasMilestones ? (
          <div className="mt-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs font-black uppercase tracking-[0.1em] text-violet-700">Weekly milestones <span className="normal-case tracking-normal text-gray-500">(reward split across {challenge.milestones.length} weeks)</span></p>
              <p className="text-sm font-black text-emerald-700">Earned: {formatMoney(challenge.earnedRewardAmount, challenge.currency)} / {formatMoney(challenge.rewardAmount, challenge.currency)}</p>
            </div>
            <div className={`mt-3 grid gap-3 ${challenge.milestones.length <= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
              {challenge.milestones.map((milestone) => <MilestoneCard key={milestone.index} milestone={milestone} currency={challenge.currency} formatMoney={formatMoney} />)}
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-xs font-semibold leading-5 text-blue-800">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Each week earns independently. A missed week pays zero, while successful milestone rewards remain earned.</span>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-black ${statusStyle(challenge.computedStatus)}`}>{challenge.computedStatus}</span>
            <span className="text-xs font-bold text-gray-500">Full target challenge - no weekly milestones</span>
          </div>
        )}
      </div>
    </article>
  );
}

function MilestoneCard({ milestone, currency, formatMoney }: { milestone: ManagerChallengeMilestone; currency: string; formatMoney: Props["formatMoney"] }) {
  const tone = milestoneTone(milestone.status);
  const Icon = tone.Icon;
  const shownReward = milestone.status === "Missed" ? 0 : milestone.rewardAmount;
  const rewardState = milestone.status === "Earned" ? "Earned" : milestone.status === "Missed" ? "Missed" : "Available";
  const remainingUnits = Math.max(0, milestone.targetUnits - milestone.progressUnits);
  const today = new Date();
  const end = parseDateKey(milestone.endDate);
  const daysRemaining = Math.max(0, Math.ceil((end.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime()) / DAY_MS) + 1);
  const start = parseDateKey(milestone.startDate);
  const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS) + 1);
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.ceil((new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime() - start.getTime()) / DAY_MS) + 1));
  const dailyTarget = Math.ceil(milestone.targetUnits / totalDays);
  const expectedByToday = dailyTarget * elapsedDays;
  const requiredPace = daysRemaining > 0 ? Math.ceil(remainingUnits / daysRemaining) : remainingUnits;
  const paceVariance = milestone.progressUnits - expectedByToday;
  const dailyPaceStatus = milestone.status === "Upcoming" ? `Starts ${formatDateShort(milestone.startDate)}` : paceVariance > 0 ? `Ahead by ${paceVariance.toLocaleString()} pcs` : paceVariance === 0 ? "On pace" : `${Math.abs(paceVariance).toLocaleString()} pcs to catch up`;
  const paceGuidance = milestone.status === "Upcoming" ? "Prepare for this week" : paceVariance >= 0 ? "Keep this pace" : `Need ${Math.max(requiredPace, dailyTarget).toLocaleString()} pcs/day`;
  return (
    <div className={`rounded-lg border p-3 ${tone.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-black uppercase text-violet-700">Week {milestone.index}</p>
          <p className="mt-1 text-[10px] font-semibold text-gray-500">{formatDateShort(milestone.startDate)} - {formatDateShort(milestone.endDate)}</p>
        </div>
        <Icon className={`h-5 w-5 ${milestone.status === "Earned" ? "text-emerald-600" : milestone.status === "Missed" ? "text-rose-500" : "text-blue-600"}`} />
      </div>
      <p className={`mt-4 text-xl font-black ${tone.value}`}>{milestone.progressUnits.toLocaleString()} <span className="text-sm text-gray-400">/ {milestone.targetUnits.toLocaleString()} pcs</span></p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.min(100, milestone.progressPercent)}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        <div className="rounded-md bg-white/70 px-2 py-1.5"><p className="font-bold uppercase text-gray-400">Remaining</p><p className="mt-0.5 text-sm font-black text-gray-900">{remainingUnits.toLocaleString()} pcs</p></div>
        <div className="rounded-md bg-white/70 px-2 py-1.5"><p className="font-bold uppercase text-gray-400">Needed daily</p><p className="mt-0.5 text-sm font-black text-gray-900">{requiredPace.toLocaleString()} pcs</p></div>
      </div>
      <div className="mt-2 flex items-center justify-between rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1.5 text-[10px]">
        <span><span className="font-bold uppercase text-gray-400">Daily target</span> <b className="ml-1 text-gray-900">{dailyTarget.toLocaleString()} pcs/day</b></span>
        <span className={`text-right font-black ${paceVariance > 0 ? "text-emerald-600" : paceVariance < 0 ? "text-rose-600" : "text-gray-500"}`}>{dailyPaceStatus}<span className="ml-1 font-semibold text-gray-500">· {paceGuidance}</span></span>
      </div>
      <p className={`mt-2 text-[10px] font-black ${milestone.status === "Missed" ? "text-rose-600" : milestone.status === "Earned" ? "text-emerald-600" : "text-blue-600"}`}>{milestone.status === "Earned" ? "Target met" : milestone.status === "Missed" ? "Target missed" : milestone.status}</p>
      <div className={`mt-3 flex items-center justify-between rounded-lg border px-3 py-2 text-xs font-black ${tone.footer}`}>
        <span>{formatMoney(shownReward, currency)}</span><span>{rewardState}</span>
      </div>
    </div>
  );
}

function ChallengeSelector({ challenge, product, selected, onClick, accent }: { challenge: ManagerProductChallenge; product?: ChallengeProduct; selected: boolean; onClick: () => void; accent: (typeof CARD_ACCENTS)[number] }) {
  const completed = challenge.progressUnits >= challenge.targetUnits;
  const totalDays = Math.max(1, Math.ceil((parseDateKey(challenge.endDate).getTime() - parseDateKey(challenge.startDate).getTime()) / DAY_MS) + 1);
  const elapsed = Math.max(0, totalDays - Math.max(0, challenge.daysLeft));
  const expected = (elapsed / totalDays) * challenge.targetUnits;
  const ratio = expected > 0 ? challenge.progressUnits / expected : 1;
  const status = completed ? "Completed" : elapsed <= 1 && challenge.progressUnits === 0 ? "Just Started" : ratio < 0.8 ? "Behind" : ratio < 0.95 ? "At Risk" : "On Track";
  return <button type="button" onClick={onClick} className={`min-w-[270px] flex-1 rounded-xl border p-2.5 text-left transition ${selected ? "border-violet-500 bg-violet-50/70 ring-2 ring-violet-200" : "border-gray-200 bg-white hover:border-violet-300"}`}><div className="flex items-center gap-3">{product?.imageUrl ? <img src={product.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-gray-100 object-cover" /> : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-500"><Package className="h-5 w-5" /></span>}<div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className={`truncate text-sm ${selected ? "font-black text-gray-950" : "font-bold text-gray-800"}`}>{product?.name ?? challenge.name}</span><span className="text-xs font-black text-gray-500">{challenge.progressPercent}%</span></div><p className="mt-1 text-xs font-black text-violet-700">{challenge.progressUnits.toLocaleString()} <span className="font-semibold text-gray-400">/ {challenge.targetUnits.toLocaleString()} pcs</span></p><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200"><div className={`h-full rounded-full ${accent.bar}`} style={{ width: `${Math.min(100, challenge.progressPercent)}%` }} /></div><div className="mt-1.5 flex justify-end"><span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${statusStyle(status)}`}>{status}</span></div></div></div></button>;
}

function CompactChallengeCard({
  challenge,
  product,
  canEdit,
  formatMoney,
  accent,
  onEdit
}: {
  challenge: ManagerProductChallenge;
  product?: ChallengeProduct;
  canEdit: boolean;
  formatMoney: Props["formatMoney"];
  accent: (typeof CARD_ACCENTS)[number];
  onEdit: () => void;
}) {
  const hasMilestones = challenge.milestoneMode === "weekly" && challenge.milestones?.length > 0;
  const cadenceLabel = challenge.cadence.charAt(0).toUpperCase() + challenge.cadence.slice(1);
  return (
    <article className="relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className={`h-1 ${accent.bar}`} />
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-[9px] font-black uppercase tracking-[0.12em] ${accent.label}`}>{cadenceLabel} challenge</p>
            <h4 className="mt-1 truncate text-sm font-black text-gray-950">{product?.name ?? challenge.name}</h4>
          </div>
          {canEdit && (
            <button type="button" className="!min-h-0 flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></button>
          )}
        </div>

        <div className="mt-3 flex items-end justify-between gap-2">
          <p className="text-xl font-black text-gray-950">
            {challenge.progressUnits.toLocaleString()} <span className="text-xs font-bold text-gray-400">/ {challenge.targetUnits.toLocaleString()} pcs</span>
          </p>
          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black text-gray-600">{challenge.progressPercent}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div className={`h-full rounded-full ${accent.bar}`} style={{ width: `${Math.min(100, challenge.progressPercent)}%` }} />
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] font-bold text-gray-500">
          <span>{challenge.daysLeft} day{challenge.daysLeft === 1 ? "" : "s"} left</span>
          <span className={`inline-flex rounded-full border px-2 py-0.5 font-black ${statusStyle(challenge.computedStatus)}`}>{challenge.computedStatus}</span>
        </div>

        {hasMilestones ? (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <p className="text-[9px] font-black uppercase tracking-[0.1em] text-gray-400">Weekly milestones</p>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {challenge.milestones.map((milestone) => {
                const tone = milestoneTone(milestone.status);
                const Icon = tone.Icon;
                const label = milestone.status === "Earned"
                  ? formatMoney(milestone.rewardAmount, challenge.currency)
                  : milestone.status === "Missed"
                  ? formatMoney(0, challenge.currency)
                  : milestone.status === "In Progress"
                  ? "Current"
                  : "Pending";
                const labelTone = milestone.status === "Earned" ? "text-emerald-600" : milestone.status === "Missed" ? "text-rose-500" : milestone.status === "In Progress" ? "text-blue-600" : "text-gray-400";
                return (
                  <div key={milestone.index} className="rounded-md border border-gray-100 bg-gray-50/70 px-1 py-1.5 text-center">
                    <div className="flex items-center justify-center gap-0.5 text-[8px] font-black text-gray-400">
                      W{milestone.index}
                      <Icon className={`h-2.5 w-2.5 ${milestone.status === "Earned" ? "text-emerald-600" : milestone.status === "Missed" ? "text-rose-500" : "text-blue-500"}`} />
                    </div>
                    <p className="mt-0.5 text-[11px] font-black text-gray-900">{milestone.progressUnits.toLocaleString()}</p>
                    <p className={`truncate text-[8px] font-bold ${labelTone}`}>{label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${statusStyle(challenge.computedStatus)}`}>Full target - no weekly milestones</span>
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs">
          <div>
            <p className="text-[9px] font-black uppercase text-gray-400">Earned so far</p>
            <p className="mt-0.5 font-black text-emerald-700">{formatMoney(challenge.earnedRewardAmount, challenge.currency)}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black uppercase text-gray-400">{cadenceLabel} bonus</p>
            <p className="mt-0.5 font-black text-violet-700">{formatMoney(challenge.rewardAmount, challenge.currency)}</p>
          </div>
        </div>
        <p className="mt-2 text-[9px] font-semibold leading-4 text-gray-400">{cadenceLabel} completion bonus unlocked at {challenge.targetUnits.toLocaleString()} pcs</p>
      </div>
    </article>
  );
}

function ChallengeSummaryStrip({ challenges, formatMoney }: { challenges: ManagerProductChallenge[]; formatMoney: Props["formatMoney"] }) {
  const stats = useMemo(() => {
    const totalTarget = challenges.reduce((sum, item) => sum + item.targetUnits, 0);
    const totalProgress = challenges.reduce((sum, item) => sum + item.progressUnits, 0);
    const totalProgressPercent = totalTarget > 0 ? Math.round((totalProgress / totalTarget) * 100) : 0;
    const totalEarned = challenges.reduce((sum, item) => sum + item.earnedRewardAmount, 0);
    const totalPotential = challenges.reduce((sum, item) => sum + item.rewardAmount, 0);
    const daysRemaining = challenges.reduce((min, item) => Math.min(min, item.daysLeft), Infinity);
    const requiredPace = challenges.reduce((sum, item) => {
      const remaining = Math.max(0, item.targetUnits - item.progressUnits);
      return sum + (item.daysLeft > 0 ? remaining / item.daysLeft : 0);
    }, 0);
    return {
      totalTarget,
      totalProgress,
      totalProgressPercent,
      totalEarned,
      totalPotential,
      daysRemaining: Number.isFinite(daysRemaining) ? daysRemaining : 0,
      requiredPace: Math.round(requiredPace),
      currency: challenges[0]?.currency ?? "NGN"
    };
  }, [challenges]);

  const items = [
    { icon: Target, label: "Active Targets", value: String(challenges.filter((item) => item.status === "active").length), detail: "Active challenges" },
    { icon: TrendingUp, label: "Total Progress", value: `${stats.totalProgress.toLocaleString()} / ${stats.totalTarget.toLocaleString()} pcs`, detail: "Across all challenges" },
    { icon: Gift, label: "Total Earned", value: `${formatMoney(stats.totalEarned, stats.currency)} / ${formatMoney(stats.totalPotential, stats.currency)}`, detail: "Across all challenges" },
    { icon: Gauge, label: "Required Pace", value: `${stats.requiredPace.toLocaleString()} pcs/day`, detail: "To hit all targets" }
  ];

  return (
    <div className="grid grid-cols-1 gap-0 rounded-xl border border-indigo-100 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-3 border-b border-gray-100 p-3 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600"><item.icon className="h-3.5 w-3.5" /></span>
          <div><p className="text-[9px] font-black uppercase tracking-[0.08em] text-gray-400">{item.label}</p><p className="mt-1 text-sm font-black text-gray-950">{item.value}</p><p className="mt-0.5 text-[9px] font-semibold text-gray-400">{item.detail}</p></div>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><p className="text-[10px] font-black uppercase tracking-[0.12em] text-gray-400">{label}</p><p className="mt-2 text-2xl font-black text-violet-700">{value}</p><p className="mt-1 text-xs font-semibold text-gray-500">{detail}</p></div>;
}

function FieldLabel({ label, small = false, children }: { label: string; small?: boolean; children: ReactNode }) {
  return <label className={`block font-black text-gray-500 ${small ? "text-[10px]" : "text-xs"}`}><span>{label}</span><div className="mt-1.5">{children}</div></label>;
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`!min-h-0 rounded-lg border px-3 py-2 text-xs font-black ${selected ? "border-violet-300 bg-white text-violet-700" : "border-gray-200 bg-white text-gray-500"}`} onClick={onClick}>{children}</button>;
}

function MoneyField({ label, value, readOnly = false, onChange }: { label: string; value: number; readOnly?: boolean; onChange?: (value: number) => void }) {
  return (
    <label className="block text-[10px] font-black text-gray-500">
      {label}
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-gray-400">N</span>
        <input
          type="number"
          min="0"
          readOnly={readOnly}
          className={`w-full rounded-lg border py-2.5 pl-7 pr-3 text-sm font-bold ${readOnly ? "border-gray-100 bg-gray-100 text-gray-500" : "border-gray-200 bg-white text-gray-900"}`}
          value={readOnly ? Math.round(value) : value}
          onChange={(event) => onChange?.(Math.max(0, Number(event.target.value) || 0))}
        />
      </div>
    </label>
  );
}
