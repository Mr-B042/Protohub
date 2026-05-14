type TeamRecord = {
  id: string;
  name: string;
  leadId?: string | null;
  productIds: readonly string[];
  memberIds: readonly string[];
};

type UserRecord = {
  id: string;
  name: string;
  active: boolean;
  lastSeenAt?: string | null;
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
  nextFollowUpAt?: string | null;
  lastContactAttemptAt?: string | null;
  lastContactAttemptOutcome?: string | null;
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

type ManagerActivityRecord = {
  id: string;
  teamId: string;
  managerId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  orderId?: string | null;
  repId?: string | null;
  actionType: string;
  note?: string | null;
  createdAt: string;
};

type FollowUpInsight = {
  overdue: boolean;
  dueSoon: boolean;
};
type QueueTimingStatus =
  | "scheduled"
  | "due_now"
  | "due_soon"
  | "late"
  | "handled_on_time"
  | "handled_late"
  | "no_timer";
type QueueOrderSummary = {
  id: string;
  customer: string;
  repName: string;
  status: string;
  callOutcome?: string | null;
  buyerHealth?: string | null;
  nextFollowUpAt?: string | null;
  dueAt?: string | null;
  slaMinutes?: number | null;
  lastActionAt?: string | null;
  lastActionOutcome?: string | null;
  handledAt?: string | null;
  timingStatus: QueueTimingStatus;
  latenessMinutes?: number | null;
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
const taskDeadlineMs = (task: Pick<FollowUpTaskRecord, "dueAt" | "slaMinutes">) => {
  const due = new Date(task.dueAt);
  if (Number.isNaN(due.getTime())) return null;
  return due.getTime() + Math.max(0, task.slaMinutes ?? 15) * 60 * 1000;
};
const startOfToday = () => {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value.getTime();
};
const isSameDayAsToday = (value?: string | null) => {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() >= startOfToday();
};
const minutesSince = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - parsed.getTime()) / (60 * 1000)));
};
const managerPresenceScore = (lastSeenAt?: string | null) => {
  const inactiveMinutes = minutesSince(lastSeenAt);
  if (inactiveMinutes == null) return 0;
  if (!isSameDayAsToday(lastSeenAt)) return 0;
  if (inactiveMinutes <= 60) return 100;
  if (inactiveMinutes <= 240) return 85;
  if (inactiveMinutes <= 480) return 70;
  return 55;
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
    overdueNow: QueueOrderSummary[];
    dueSoon: QueueOrderSummary[];
    openPipeline: QueueOrderSummary[];
    atRiskPipeline: QueueOrderSummary[];
  };
  team: TeamRecord;
  lead?: UserRecord;
  members: UserRecord[];
  managerLastSeenAt?: string | null;
  managerLastActionAt?: string | null;
  managerAccountability: number;
  managerOversightStatus: "on_track" | "watching" | "needs_attention" | "inactive" | "escalated" | "unassigned";
  managerActionsToday: number;
  handledOnTimeToday: number;
  handledLateToday: number;
  stillWaitingNow: number;
  reviewedActionableQueue: number;
  unreviewedActionableQueue: number;
  actionableQueue: number;
  externalEscalationsToday: number;
  recentManagerActions: Array<{
    id: string;
    actorName: string;
    actionType: string;
    createdAt: string;
    orderId?: string | null;
    customer?: string | null;
    note?: string | null;
  }>;
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
  inactiveManagers: number;
  escalatedManagers: number;
  managerActionsToday: number;
  handledOnTimeToday: number;
  handledLateToday: number;
  stillWaitingNow: number;
};

export const buildManagerPerformance = (
  teams: readonly TeamRecord[],
  users: readonly UserRecord[],
  orders: readonly OrderRecord[],
  tasks: readonly FollowUpTaskRecord[] = [],
  attempts: readonly ContactAttemptRecord[] = [],
  managerActivities: readonly ManagerActivityRecord[] = []
): { rows: ManagerPerformanceRow[]; summary: ManagerPerformanceSummary } => {
  const summarizeOrder = (
    order: OrderRecord,
    members: UserRecord[],
    tasksForOrder: FollowUpTaskRecord[],
    attemptsForOrder: ContactAttemptRecord[]
  ): QueueOrderSummary => {
    const sortedTasks = tasksForOrder
      .slice()
      .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
    const activeTask = sortedTasks.find((task) => task.status !== "completed" && task.status !== "cancelled");
    const latestCompletedTask = sortedTasks
      .filter((task) => task.status === "completed" && task.completedAt)
      .sort((left, right) => new Date(right.completedAt ?? 0).getTime() - new Date(left.completedAt ?? 0).getTime())[0];
    const latestAttempt = attemptsForOrder
      .slice()
      .sort((left, right) => new Date(right.attemptedAt).getTime() - new Date(left.attemptedAt).getTime())[0];
    const dueAt = activeTask?.dueAt ?? latestCompletedTask?.dueAt ?? order.nextFollowUpAt ?? order.scheduledAt ?? order.scheduledDate ?? null;
    const slaMinutes = activeTask?.slaMinutes ?? latestCompletedTask?.slaMinutes ?? 15;
    const deadlineMs = dueAt ? new Date(dueAt).getTime() + Math.max(0, slaMinutes ?? 15) * 60 * 1000 : null;
    const handledAt = activeTask
      ? null
      : latestCompletedTask?.completedAt ?? latestAttempt?.attemptedAt ?? null;
    const lastActionAt = latestAttempt?.attemptedAt ?? latestCompletedTask?.completedAt ?? order.lastContactAttemptAt ?? null;
    const lastActionOutcome = latestAttempt?.outcomeCode ?? order.lastContactAttemptOutcome ?? order.callOutcome ?? null;
    let timingStatus: QueueTimingStatus = "no_timer";
    let latenessMinutes: number | null = null;

    if (activeTask) {
      if (taskOverdue(activeTask)) {
        timingStatus = "late";
        const activeDeadlineMs = taskDeadlineMs(activeTask);
        latenessMinutes = activeDeadlineMs == null ? null : Math.max(0, Math.round((Date.now() - activeDeadlineMs) / (60 * 1000)));
      } else if (taskDueNow(activeTask)) {
        timingStatus = "due_now";
      } else if (taskDueSoon(activeTask)) {
        timingStatus = "due_soon";
      } else {
        timingStatus = "scheduled";
      }
    } else if (latestCompletedTask && latestCompletedTask.completedAt) {
      timingStatus = taskCompletedOnTime(latestCompletedTask) ? "handled_on_time" : "handled_late";
      const completedDeadlineMs = taskDeadlineMs(latestCompletedTask);
      const completedMs = new Date(latestCompletedTask.completedAt).getTime();
      latenessMinutes = completedDeadlineMs == null ? null : Math.max(0, Math.round((completedMs - completedDeadlineMs) / (60 * 1000)));
    } else if (dueAt && deadlineMs != null) {
      if (lastActionAt) {
        const lastActionMs = new Date(lastActionAt).getTime();
        if (!Number.isNaN(lastActionMs)) {
          const lateMinutes = Math.max(0, Math.round((lastActionMs - deadlineMs) / (60 * 1000)));
          latenessMinutes = lateMinutes;
          timingStatus = lateMinutes > 0 ? "handled_late" : "handled_on_time";
        }
      } else if (Date.now() > deadlineMs) {
        timingStatus = "late";
        latenessMinutes = Math.max(0, Math.round((Date.now() - deadlineMs) / (60 * 1000)));
      } else {
        const dueMs = new Date(dueAt).getTime();
        if (Date.now() >= dueMs) timingStatus = "due_now";
        else if (dueMs - Date.now() <= 2 * 60 * 60 * 1000) timingStatus = "due_soon";
        else timingStatus = "scheduled";
      }
    }

    return {
      id: order.id,
      customer: order.customer?.trim() || "Unnamed Customer",
      repName: members.find((member) => member.id === order.assignedRepId)?.name ?? "Unassigned",
      status: statusForOrder(order),
      callOutcome: order.callOutcome ?? null,
      buyerHealth: order.buyerHealth ?? null,
      nextFollowUpAt: activeTask?.dueAt ?? order.nextFollowUpAt ?? order.scheduledAt ?? order.scheduledDate ?? null,
      dueAt,
      slaMinutes,
      lastActionAt,
      lastActionOutcome,
      handledAt,
      timingStatus,
      latenessMinutes
    };
  };

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
    const tasksByOrder = new Map<string, FollowUpTaskRecord[]>();
    for (const task of teamTasks) {
      const list = tasksByOrder.get(task.orderId) ?? [];
      list.push(task);
      tasksByOrder.set(task.orderId, list);
    }
    const attemptsByOrder = new Map<string, ContactAttemptRecord[]>();
    for (const attempt of teamAttempts) {
      const list = attemptsByOrder.get(attempt.orderId) ?? [];
      list.push(attempt);
      attemptsByOrder.set(attempt.orderId, list);
    }
    const teamManagerActivities = managerActivities.filter((activity) => activity.teamId === team.id);
    const leadActivities = lead
      ? teamManagerActivities.filter((activity) => activity.actorId === lead.id)
      : [];
    const sortedLeadActivities = leadActivities
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    const leadActivitiesToday = leadActivities.filter((activity) => isSameDayAsToday(activity.createdAt));
    const externalEscalationsToday = teamManagerActivities.filter((activity) => activity.actorId !== lead?.id && isSameDayAsToday(activity.createdAt)).length;
    const deliveredOrders = teamOrders.filter((order) => statusForOrder(order) === "Delivered");
    const workedOrders = teamOrders.filter((order) => MANAGER_WORKED_STATUSES.has(statusForOrder(order)));
    const followUpEntries = teamOrders
      .map((order) => ({ order, followUp: nextFollowUpForOrder(order) }))
      .filter((entry) => entry.followUp);
    const dueTasks = teamTasks.filter((task) => taskDueNow(task));
    const activeTasks = teamTasks.filter((task) => task.status !== "completed" && task.status !== "cancelled");
    const completedTasksToday = teamTasks.filter((task) => task.status === "completed" && isSameDayAsToday(task.completedAt));
    const handledOnTimeToday = completedTasksToday.filter((task) => taskCompletedOnTime(task)).length;
    const handledLateToday = Math.max(0, completedTasksToday.length - handledOnTimeToday);
    const stillWaitingNow = activeTasks.filter((task) => taskDueNow(task) || taskOverdue(task)).length;
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
    const actionableOrders = new Map<string, OrderRecord>();
    for (const order of overdueFollowUpOrders) actionableOrders.set(order.id, order);
    for (const order of dueSoonOrders) actionableOrders.set(order.id, order);
    for (const order of atRiskPipelineOrders) actionableOrders.set(order.id, order);
    const actionableOrderIds = new Set(actionableOrders.keys());
    const reviewedActionableOrderIds = new Set(
      leadActivitiesToday
        .map((activity) => activity.orderId)
        .filter((value): value is string => typeof value === "string" && actionableOrderIds.has(value))
    );
    const actionableQueue = actionableOrderIds.size;
    const reviewedActionableQueue = reviewedActionableOrderIds.size;
    const unreviewedActionableQueue = Math.max(0, actionableQueue - reviewedActionableQueue);
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
    const reviewCoverage = actionableQueue === 0
      ? (isSameDayAsToday(lead?.lastSeenAt) || leadActivitiesToday.length > 0 ? 100 : 0)
      : percentOf(reviewedActionableQueue, actionableQueue);
    const presenceScore = lead ? managerPresenceScore(lead.lastSeenAt) : 0;
    const interventionCadence = actionableQueue === 0
      ? (leadActivitiesToday.length > 0 ? 100 : presenceScore)
      : percentOf(Math.min(leadActivitiesToday.length, actionableQueue), actionableQueue);
    const managerAccountability = !lead
      ? 0
      : actionableQueue === 0
        ? 100
        : Math.round(reviewCoverage * 0.6 + presenceScore * 0.25 + interventionCadence * 0.15);
    const inactiveMinutes = minutesSince(lead?.lastSeenAt);
    const managerOversightStatus: ManagerPerformanceRow["managerOversightStatus"] = !lead
      ? "unassigned"
      : actionableQueue > 0 && unreviewedActionableQueue > 0 && (!isSameDayAsToday(lead.lastSeenAt) || (inactiveMinutes ?? 0) >= 720)
        ? "escalated"
        : !isSameDayAsToday(lead.lastSeenAt)
          ? "inactive"
          : actionableQueue > 0 && unreviewedActionableQueue > 0
            ? "needs_attention"
            : actionableQueue > 0
              ? "watching"
              : "on_track";
    const score = hasActivity
      ? Math.round(
          deliveryRate * 0.6
          + followUpCompliance * 0.1
          + pipelineHealth * 0.1
          + teamConsistency * 0.1
          + confirmedPathRate * 0.05
          + managerAccountability * 0.05
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
          .map((order) => summarizeOrder(order, members, tasksByOrder.get(order.id) ?? [], attemptsByOrder.get(order.id) ?? [])),
        dueSoon: dueSoonOrders
          .slice()
          .sort((left, right) => {
            const leftTime = plannedMomentTimestamp(left.scheduledAt, left.scheduledDate) ?? Number.MAX_SAFE_INTEGER;
            const rightTime = plannedMomentTimestamp(right.scheduledAt, right.scheduledDate) ?? Number.MAX_SAFE_INTEGER;
            return leftTime - rightTime;
          })
          .slice(0, 5)
          .map((order) => summarizeOrder(order, members, tasksByOrder.get(order.id) ?? [], attemptsByOrder.get(order.id) ?? [])),
        openPipeline: activePipeline
          .slice()
          .sort((left, right) => {
            const leftTime = plannedMomentTimestamp(left.scheduledAt, left.scheduledDate) ?? new Date(left.createdAt ?? left.date ?? 0).getTime();
            const rightTime = plannedMomentTimestamp(right.scheduledAt, right.scheduledDate) ?? new Date(right.createdAt ?? right.date ?? 0).getTime();
            return leftTime - rightTime;
          })
          .slice(0, 5)
          .map((order) => summarizeOrder(order, members, tasksByOrder.get(order.id) ?? [], attemptsByOrder.get(order.id) ?? [])),
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
          .map((order) => summarizeOrder(order, members, tasksByOrder.get(order.id) ?? [], attemptsByOrder.get(order.id) ?? []))
      },
      lead,
      members,
      managerLastSeenAt: lead?.lastSeenAt ?? null,
      managerLastActionAt: sortedLeadActivities[0]?.createdAt ?? null,
      managerAccountability,
      managerOversightStatus,
      managerActionsToday: leadActivitiesToday.length,
      handledOnTimeToday,
      handledLateToday,
      stillWaitingNow,
      reviewedActionableQueue,
      unreviewedActionableQueue,
      actionableQueue,
      externalEscalationsToday,
      recentManagerActions: sortedLeadActivities
        .slice(0, 4)
        .map((activity) => ({
          id: activity.id,
          actorName: activity.actorName?.trim() || lead?.name || "Manager",
          actionType: activity.actionType,
          createdAt: activity.createdAt,
          orderId: activity.orderId ?? null,
          customer: activity.orderId ? actionableOrders.get(activity.orderId)?.customer ?? teamOrders.find((order) => order.id === activity.orderId)?.customer ?? null : null,
          note: activity.note ?? null
        })),
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
      teamsNeedingAttention: activeRows.filter((row) => row.score < 55 || row.overdueFollowUps > 0 || row.managerOversightStatus === "needs_attention" || row.managerOversightStatus === "escalated").length,
      totalOverdueFollowUps: rows.reduce((sum, row) => sum + row.overdueFollowUps, 0),
      totalOrders,
      totalDelivered,
      overallDeliveryRate: percentOf(totalDelivered, totalOrders),
      inactiveManagers: rows.filter((row) => row.managerOversightStatus === "inactive").length,
      escalatedManagers: rows.filter((row) => row.managerOversightStatus === "escalated").length,
      managerActionsToday: rows.reduce((sum, row) => sum + row.managerActionsToday, 0),
      handledOnTimeToday: rows.reduce((sum, row) => sum + row.handledOnTimeToday, 0),
      handledLateToday: rows.reduce((sum, row) => sum + row.handledLateToday, 0),
      stillWaitingNow: rows.reduce((sum, row) => sum + row.stillWaitingNow, 0)
    }
  };
};
