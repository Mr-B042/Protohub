type TeamRecord = {
  id: string;
  name: string;
  leadId?: string | null;
  productIds: string[];
  memberIds: string[];
};

type UserRecord = {
  id: string;
  name: string;
  active: boolean;
};

type OrderNoteRecord = {
  id: string;
  text: string;
  by: string;
  date: string;
  followUpDate?: string;
  followUpAt?: string;
};

type OrderRecord = {
  id: string;
  customer?: string | null;
  assignedRepId?: string | null;
  productId?: string | null;
  status?: string | null;
  callOutcome?: string | null;
  buyerHealth?: string | null;
  createdAt?: string | null;
  date?: string | null;
  scheduledDate?: string | null;
  scheduledAt?: string | null;
  notes?: unknown;
  timelineNotes?: unknown;
  timeline_notes?: unknown;
};

type FollowUpTaskRecord = {
  id: string;
  orderId: string;
  status: string;
  dueAt: string;
  slaMinutes?: number | null;
  completedAt?: string | null;
};

type ContactAttemptRecord = {
  id: string;
  orderId: string;
  repId?: string | null;
  attemptedAt: string;
  outcomeCode: string;
};

type FollowUpInsight = {
  overdue: boolean;
  dueSoon: boolean;
};

const CLOSED_ORDER_STATUSES = new Set(["Delivered", "Cancelled", "Failed"]);
const MANAGER_OPEN_STATUSES = new Set(["New", "Confirmed", "In Process", "Dispatched", "Postponed"]);
const MANAGER_WORKED_STATUSES = new Set(["Confirmed", "In Process", "Dispatched", "Delivered", "Postponed", "Cancelled", "Failed"]);

const pad = (value: number) => String(value).padStart(2, "0");
const formatDateKey = (value: Date) => `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
const normalizeDateKey = (value?: string | null) => {
  if (!value) return formatDateKey(new Date());
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? formatDateKey(new Date()) : formatDateKey(parsed);
};
const percentOf = (part: number, total: number) => (total <= 0 ? 0 : Math.round((part / total) * 100));
const plannedMomentTimestamp = (plannedAt?: string | null, plannedDate?: string | null) => {
  if (plannedAt) {
    const parsed = new Date(plannedAt);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  if (plannedDate && /^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) {
    const parsed = new Date(`${plannedDate}T08:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return null;
};
const ageInDaysForOrder = (order: Pick<OrderRecord, "createdAt" | "date">) => {
  const parsed = new Date(order.createdAt ?? order.date ?? "");
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, (Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000));
};
const statusForOrder = (order: Pick<OrderRecord, "status">) => order.status ?? "New";
const taskDueSoon = (task: Pick<FollowUpTaskRecord, "status" | "dueAt">) => {
  if (task.status === "completed" || task.status === "cancelled") return false;
  const parsed = new Date(task.dueAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() > Date.now() && parsed.getTime() - Date.now() <= 2 * 60 * 60 * 1000;
};
const taskOverdue = (task: Pick<FollowUpTaskRecord, "status" | "dueAt" | "slaMinutes">) => {
  if (task.status === "completed" || task.status === "cancelled") return false;
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return Date.now() > due.getTime() + Math.max(0, task.slaMinutes ?? 15) * 60 * 1000;
};
const taskDueNow = (task: Pick<FollowUpTaskRecord, "status" | "dueAt">) => {
  if (task.status === "completed" || task.status === "cancelled") return false;
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() <= Date.now();
};
const taskCompletedOnTime = (task: Pick<FollowUpTaskRecord, "status" | "dueAt" | "slaMinutes" | "completedAt">) => {
  if (task.status !== "completed" || !task.completedAt) return false;
  const due = new Date(task.dueAt);
  const completed = new Date(task.completedAt);
  if (Number.isNaN(due.getTime()) || Number.isNaN(completed.getTime())) return false;
  return completed.getTime() <= due.getTime() + Math.max(0, task.slaMinutes ?? 15) * 60 * 1000;
};

const normalizeOrderNote = (value: unknown): OrderNoteRecord | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return null;
  const followUpDate = typeof record.followUpDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.followUpDate)
    ? record.followUpDate
    : undefined;
  const followUpAt = typeof record.followUpAt === "string" && record.followUpAt
    ? record.followUpAt
    : undefined;
  return {
    id: typeof record.id === "string" && record.id ? record.id : `note-${Date.now()}`,
    text,
    by: typeof record.by === "string" && record.by ? record.by : "System",
    date: typeof record.date === "string" && record.date ? record.date : new Date().toISOString(),
    followUpDate: followUpDate ?? (followUpAt ? normalizeDateKey(followUpAt) : undefined),
    followUpAt
  };
};

const normalizeOrderNotes = (value: unknown): OrderNoteRecord[] =>
  Array.isArray(value)
    ? value
        .map((entry) => normalizeOrderNote(entry))
        .filter((entry): entry is OrderNoteRecord => Boolean(entry))
    : [];

const parseLegacyOrderMetadata = (value: unknown) => {
  if (!value) {
    return {} as { scheduledAt?: string; timelineNotes?: unknown[] };
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return {
      scheduledAt: typeof record.scheduledAt === "string" ? record.scheduledAt : undefined,
      timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined
    };
  }
  if (typeof value !== "string" || !value.trim()) {
    return {} as { scheduledAt?: string; timelineNotes?: unknown[] };
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} as { scheduledAt?: string; timelineNotes?: unknown[] };
    }
    const record = parsed as Record<string, unknown>;
    return {
      scheduledAt: typeof record.scheduledAt === "string" ? record.scheduledAt : undefined,
      timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined
    };
  } catch {
    return {} as { scheduledAt?: string; timelineNotes?: unknown[] };
  }
};

const orderNotesFor = (order: Pick<OrderRecord, "notes" | "timelineNotes" | "timeline_notes">) => {
  const directTimeline = normalizeOrderNotes(order.timelineNotes ?? order.timeline_notes);
  if (directTimeline.length > 0) return directTimeline;
  const directNotes = normalizeOrderNotes(order.notes);
  if (directNotes.length > 0) return directNotes;
  const legacy = parseLegacyOrderMetadata(order.notes);
  return normalizeOrderNotes(legacy.timelineNotes);
};

const followUpInsightsForOrder = (order: OrderRecord): FollowUpInsight[] => {
  if (CLOSED_ORDER_STATUSES.has(statusForOrder(order))) return [];

  const now = Date.now();
  const entries: Array<FollowUpInsight & { sortTime: number }> = [];
  const scheduledTime = plannedMomentTimestamp(order.scheduledAt, order.scheduledDate);
  if (scheduledTime != null) {
    entries.push({
      overdue: scheduledTime <= now,
      dueSoon: scheduledTime > now && scheduledTime - now <= 2 * 60 * 60 * 1000,
      sortTime: scheduledTime
    });
  }

  for (const note of orderNotesFor(order)) {
    const followUpTime = plannedMomentTimestamp(note.followUpAt, note.followUpDate);
    if (followUpTime == null) continue;
    entries.push({
      overdue: followUpTime <= now,
      dueSoon: followUpTime > now && followUpTime - now <= 2 * 60 * 60 * 1000,
      sortTime: followUpTime
    });
  }

  return entries
    .sort((a, b) => a.sortTime - b.sortTime)
    .map(({ sortTime: _sortTime, ...entry }) => entry);
};

const nextFollowUpForOrder = (order: OrderRecord) => {
  const entries = followUpInsightsForOrder(order);
  if (entries.length === 0) return null;
  const dueNow = entries.find((entry) => entry.overdue);
  return dueNow ?? entries[0];
};

export type ManagerPerformanceRow = {
  actionQueue: {
    overdueNow: Array<{
      id: string;
      customer: string;
      repName: string;
      status: string;
      callOutcome?: string | null;
      buyerHealth?: string | null;
      nextFollowUpAt?: string | null;
    }>;
    dueSoon: Array<{
      id: string;
      customer: string;
      repName: string;
      status: string;
      callOutcome?: string | null;
      buyerHealth?: string | null;
      nextFollowUpAt?: string | null;
    }>;
    openPipeline: Array<{
      id: string;
      customer: string;
      repName: string;
      status: string;
      callOutcome?: string | null;
      buyerHealth?: string | null;
      nextFollowUpAt?: string | null;
    }>;
    atRiskPipeline: Array<{
      id: string;
      customer: string;
      repName: string;
      status: string;
      callOutcome?: string | null;
      buyerHealth?: string | null;
      nextFollowUpAt?: string | null;
    }>;
  };
  team: TeamRecord;
  lead?: UserRecord;
  members: UserRecord[];
  memberPerformance: Array<{
    member: UserRecord;
    orders: number;
    delivered: number;
    deliveryRate: number;
  }>;
  orders: number;
  delivered: number;
  openOrders: number;
  overdueFollowUps: number;
  dueSoonFollowUps: number;
  pipelineAtRisk: number;
  deliveryRate: number;
  confirmedPathRate: number;
  followUpCompliance: number;
  pipelineHealth: number;
  teamConsistency: number;
  hasActivity: boolean;
  score: number;
  bestRate: number;
  worstRate: number;
  blockers: Array<{ label: string; count: number }>;
  activeMembers: number;
  watchOrders: number;
  atRiskOrders: number;
  notSeriousCandidates: number;
};

export type ManagerPerformanceSummary = {
  averageScore: number;
  teamsNeedingAttention: number;
  totalOverdueFollowUps: number;
  totalOrders: number;
  totalDelivered: number;
  overallDeliveryRate: number;
};

export const buildManagerPerformance = (
  teams: TeamRecord[],
  users: UserRecord[],
  orders: OrderRecord[],
  tasks: FollowUpTaskRecord[] = [],
  attempts: ContactAttemptRecord[] = []
): { rows: ManagerPerformanceRow[]; summary: ManagerPerformanceSummary } => {
  const summarizeOrder = (order: OrderRecord, members: UserRecord[]) => ({
    id: order.id,
    customer: order.customer?.trim() || "Unnamed Customer",
    repName: members.find((member) => member.id === order.assignedRepId)?.name ?? "Unassigned",
    status: statusForOrder(order),
    callOutcome: order.callOutcome ?? null,
    buyerHealth: order.buyerHealth ?? null,
    nextFollowUpAt: order.scheduledAt ?? order.scheduledDate ?? null
  });

  const rows = teams.map((team) => {
    const memberIds = new Set(team.memberIds);
    const teamProductScope = new Set(team.productIds);
    const lead = users.find((user) => user.id === team.leadId);
    const members = users.filter((user) => memberIds.has(user.id));
    const teamOrders = orders.filter((order) =>
      order.assignedRepId
      && memberIds.has(order.assignedRepId)
      && (teamProductScope.size === 0 || (order.productId ? teamProductScope.has(order.productId) : false))
    );
    const teamOrderIds = new Set(teamOrders.map((order) => order.id));
    const teamTasks = tasks.filter((task) => teamOrderIds.has(task.orderId));
    const teamAttempts = attempts.filter((attempt) => teamOrderIds.has(attempt.orderId));
    const deliveredOrders = teamOrders.filter((order) => statusForOrder(order) === "Delivered");
    const workedOrders = teamOrders.filter((order) => MANAGER_WORKED_STATUSES.has(statusForOrder(order)));
    const followUpEntries = teamOrders
      .map((order) => ({ order, followUp: nextFollowUpForOrder(order) }))
      .filter((entry) => entry.followUp);
    const dueTasks = teamTasks.filter((task) => taskDueNow(task));
    const overdueTaskOrderIds = new Set(
      teamTasks.filter((task) => taskOverdue(task)).map((task) => task.orderId)
    );
    const overdueFollowUpOrders = teamTasks.length > 0
      ? teamOrders.filter((order) => overdueTaskOrderIds.has(order.id))
      : followUpEntries.filter((entry) => entry.followUp?.overdue).map((entry) => entry.order);
    const overdueFollowUps = teamTasks.length > 0
      ? teamTasks.filter((task) => taskOverdue(task)).length
      : followUpEntries.filter((entry) => entry.followUp?.overdue).length;
    const dueSoonTaskOrderIds = new Set(
      teamTasks.filter((task) => taskDueSoon(task) && !taskOverdue(task)).map((task) => task.orderId)
    );
    const dueSoonOrders = teamTasks.length > 0
      ? teamOrders.filter((order) => dueSoonTaskOrderIds.has(order.id))
      : followUpEntries.filter((entry) => entry.followUp?.dueSoon).map((entry) => entry.order);
    const dueSoonFollowUps = teamTasks.length > 0
      ? teamTasks.filter((task) => taskDueSoon(task) && !taskOverdue(task)).length
      : followUpEntries.filter((entry) => entry.followUp?.dueSoon).length;
    const activePipeline = teamOrders.filter((order) => MANAGER_OPEN_STATUSES.has(statusForOrder(order)));
    const atRiskPipelineOrders = activePipeline.filter((order) => {
      if (order.buyerHealth === "at_risk" || order.buyerHealth === "not_serious_candidate") return true;
      const status = statusForOrder(order);
      const ageDays = ageInDaysForOrder(order);
      const followUp = nextFollowUpForOrder(order);
      const orderTaskOverdue = teamTasks.some((task) => task.orderId === order.id && taskOverdue(task));
      if (orderTaskOverdue) return true;
      if (followUp?.overdue) return true;
      if (status === "Postponed" && !followUp) return true;
      if (status === "Dispatched" && ageDays >= 3) return true;
      if ((status === "New" || status === "Confirmed" || status === "In Process") && ageDays >= 2 && !followUp) return true;
      return false;
    });
    const pipelineAtRisk = atRiskPipelineOrders.length;
    const memberPerformance = members.map((member) => {
      const repOrders = teamOrders.filter((order) => order.assignedRepId === member.id);
      const repDelivered = repOrders.filter((order) => statusForOrder(order) === "Delivered").length;
      return {
        member,
        orders: repOrders.length,
        delivered: repDelivered,
        deliveryRate: percentOf(repDelivered, repOrders.length)
      };
    });
    const activeMemberPerformance = memberPerformance.filter((row) => row.orders > 0);
    const memberRates = activeMemberPerformance.map((row) => row.deliveryRate);
    const bestRate = memberRates.length > 0 ? Math.max(...memberRates) : 100;
    const worstRate = memberRates.length > 0 ? Math.min(...memberRates) : 100;
    const consistencyGap = activeMemberPerformance.length <= 1 ? 0 : bestRate - worstRate;
    const deliveryRate = percentOf(deliveredOrders.length, teamOrders.length);
    const confirmedPathRate = percentOf(deliveredOrders.length, workedOrders.length);
    const followUpCompliance = teamTasks.length > 0
      ? (dueTasks.length === 0 ? 100 : percentOf(dueTasks.filter((task) => taskCompletedOnTime(task)).length, dueTasks.length))
      : (followUpEntries.length === 0 ? 100 : percentOf(followUpEntries.length - overdueFollowUps, followUpEntries.length));
    const pipelineHealth = activePipeline.length === 0 ? 100 : percentOf(activePipeline.length - pipelineAtRisk, activePipeline.length);
    const teamConsistency = Math.max(0, Math.round(activeMemberPerformance.length <= 1 ? 100 : 100 - consistencyGap));
    const hasActivity = teamOrders.length > 0;
    const score = hasActivity
      ? Math.round(
          deliveryRate * 0.6
          + followUpCompliance * 0.15
          + pipelineHealth * 0.1
          + teamConsistency * 0.1
          + confirmedPathRate * 0.05
        )
      : 0;
    const blockerCounts = new Map<string, number>();
    if (teamAttempts.length > 0) {
      teamAttempts.forEach((attempt) => {
        const outcome = attempt.outcomeCode.trim();
        if (!outcome) return;
        blockerCounts.set(outcome, (blockerCounts.get(outcome) ?? 0) + 1);
      });
    } else {
      teamOrders.forEach((order) => {
        const outcome = (order.callOutcome ?? "").trim();
        if (!outcome) return;
        blockerCounts.set(outcome, (blockerCounts.get(outcome) ?? 0) + 1);
      });
    }
    const blockers = [...blockerCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, count]) => ({ label, count }));

    return {
      team,
      actionQueue: {
        overdueNow: overdueFollowUpOrders
          .slice()
          .sort((left, right) => {
            const leftTime = plannedMomentTimestamp(left.scheduledAt, left.scheduledDate) ?? 0;
            const rightTime = plannedMomentTimestamp(right.scheduledAt, right.scheduledDate) ?? 0;
            return leftTime - rightTime;
          })
          .slice(0, 5)
          .map((order) => summarizeOrder(order, members)),
        dueSoon: dueSoonOrders
          .slice()
          .sort((left, right) => {
            const leftTime = plannedMomentTimestamp(left.scheduledAt, left.scheduledDate) ?? Number.MAX_SAFE_INTEGER;
            const rightTime = plannedMomentTimestamp(right.scheduledAt, right.scheduledDate) ?? Number.MAX_SAFE_INTEGER;
            return leftTime - rightTime;
          })
          .slice(0, 5)
          .map((order) => summarizeOrder(order, members)),
        openPipeline: activePipeline
          .slice()
          .sort((left, right) => {
            const leftTime = plannedMomentTimestamp(left.scheduledAt, left.scheduledDate) ?? new Date(left.createdAt ?? left.date ?? 0).getTime();
            const rightTime = plannedMomentTimestamp(right.scheduledAt, right.scheduledDate) ?? new Date(right.createdAt ?? right.date ?? 0).getTime();
            return leftTime - rightTime;
          })
          .slice(0, 5)
          .map((order) => summarizeOrder(order, members)),
        atRiskPipeline: atRiskPipelineOrders
          .slice()
          .sort((left, right) => {
            const leftWeight = left.buyerHealth === "not_serious_candidate" ? 2 : left.buyerHealth === "at_risk" ? 1 : 0;
            const rightWeight = right.buyerHealth === "not_serious_candidate" ? 2 : right.buyerHealth === "at_risk" ? 1 : 0;
            if (leftWeight !== rightWeight) return rightWeight - leftWeight;
            const leftTime = plannedMomentTimestamp(left.scheduledAt, left.scheduledDate) ?? new Date(left.createdAt ?? left.date ?? 0).getTime();
            const rightTime = plannedMomentTimestamp(right.scheduledAt, right.scheduledDate) ?? new Date(right.createdAt ?? right.date ?? 0).getTime();
            return leftTime - rightTime;
          })
          .slice(0, 5)
          .map((order) => summarizeOrder(order, members))
      },
      lead,
      members,
      memberPerformance,
      orders: teamOrders.length,
      delivered: deliveredOrders.length,
      openOrders: activePipeline.length,
      overdueFollowUps,
      dueSoonFollowUps,
      pipelineAtRisk,
      deliveryRate,
      confirmedPathRate,
      followUpCompliance,
      pipelineHealth,
      teamConsistency,
      hasActivity,
      score,
      bestRate,
      worstRate,
      blockers,
      activeMembers: members.filter((member) => member.active).length,
      watchOrders: teamOrders.filter((order) => order.buyerHealth === "watch").length,
      atRiskOrders: teamOrders.filter((order) => order.buyerHealth === "at_risk").length,
      notSeriousCandidates: teamOrders.filter((order) => order.buyerHealth === "not_serious_candidate").length
    };
  });

  const activeRows = rows.filter((row) => row.hasActivity);
  const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
  const totalDelivered = rows.reduce((sum, row) => sum + row.delivered, 0);
  return {
    rows,
    summary: {
      averageScore: activeRows.length === 0 ? 0 : Math.round(activeRows.reduce((sum, row) => sum + row.score, 0) / activeRows.length),
      teamsNeedingAttention: activeRows.filter((row) => row.score < 55 || row.overdueFollowUps > 0).length,
      totalOverdueFollowUps: rows.reduce((sum, row) => sum + row.overdueFollowUps, 0),
      totalOrders,
      totalDelivered,
      overallDeliveryRate: percentOf(totalDelivered, totalOrders)
    }
  };
};
