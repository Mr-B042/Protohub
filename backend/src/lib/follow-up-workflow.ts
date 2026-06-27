import { randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";
import {
  type FollowUpOutcomeGroup,
  type FollowUpRecoveryBucket,
  classifyFollowUpOutcome
} from "./follow-up-outcomes.js";

export const FOLLOW_UP_TASK_TYPES = [
  "callback",
  "payment_check",
  "delivery_confirmation",
  "waybill_follow_up"
] as const;

export const FOLLOW_UP_TASK_PRIORITIES = [
  "same_day",
  "normal",
  "low_intent"
] as const;

export const FOLLOW_UP_TASK_STATUSES = [
  "open",
  "due",
  "overdue",
  "completed",
  "cancelled"
] as const;

export const CONTACT_ATTEMPT_CHANNELS = [
  "call",
  "whatsapp",
  "sms",
  "manual"
] as const;

export const CONTACT_ATTEMPT_TYPES = [
  "scheduled_callback",
  "fresh_follow_up",
  "delivery_confirmation",
  "payment_follow_up",
  "waybill_follow_up"
] as const;

export const BUYER_HEALTH_STATES = [
  "healthy",
  "watch",
  "at_risk",
  "not_serious_candidate"
] as const;

export type FollowUpTaskType = typeof FOLLOW_UP_TASK_TYPES[number];
export type FollowUpTaskPriority = typeof FOLLOW_UP_TASK_PRIORITIES[number];
export type FollowUpTaskStatus = typeof FOLLOW_UP_TASK_STATUSES[number];
export type ContactAttemptChannel = typeof CONTACT_ATTEMPT_CHANNELS[number];
export type ContactAttemptType = typeof CONTACT_ATTEMPT_TYPES[number];
export type BuyerHealth = typeof BUYER_HEALTH_STATES[number];

type OrderNoteRecord = {
  id: string;
  text: string;
  by: string;
  date: string;
  followUpDate?: string;
  followUpAt?: string;
};

type FollowUpTaskRow = {
  id: string;
  order_id: string;
  assigned_rep_id?: string | null;
  team_id?: string | null;
  manager_id?: string | null;
  task_type: FollowUpTaskType;
  priority: FollowUpTaskPriority;
  status: FollowUpTaskStatus;
  due_at: string;
  sla_minutes: number | null;
  note?: string | null;
  source_kind?: string | null;
  source_ref?: string | null;
  completed_at?: string | null;
};

type ContactAttemptRow = {
  id: string;
  order_id: string;
  task_id?: string | null;
  rep_id?: string | null;
  team_id?: string | null;
  manager_id?: string | null;
  attempted_at: string;
  channel: ContactAttemptChannel;
  attempt_type: ContactAttemptType;
  outcome_code: string;
  outcome_group?: FollowUpOutcomeGroup | null;
  recovery_bucket?: FollowUpRecoveryBucket | null;
  outcome_note?: string | null;
  customer_reached?: boolean | null;
  next_action_type?: string | null;
  next_action_at?: string | null;
  promise_window?: "same_day" | "tomorrow" | "later" | null;
  is_serious_signal?: boolean | null;
};

type TeamOwnership = {
  teamId: string | null;
  managerId: string | null;
};

type CreateFollowUpTaskInput = {
  orgId: string;
  orderId: string;
  assignedRepId?: string | null;
  dueAt: string;
  taskType: FollowUpTaskType;
  priority?: FollowUpTaskPriority;
  note?: string | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
  createdFromAttemptId?: string | null;
};

type RecordAttemptInput = {
  orgId: string;
  orderId: string;
  repId?: string | null;
  actorName: string;
  channel: ContactAttemptChannel;
  channels?: string[];
  attemptType: ContactAttemptType;
  outcomeCode: string;
  recoveryBucket?: FollowUpRecoveryBucket | null;
  outcomeNote?: string | null;
  taskId?: string | null;
  nextActionType?: FollowUpTaskType | null;
  nextActionAt?: string | null;
  nextActionNote?: string | null;
};

type RecordProgressNoteInput = {
  orgId: string;
  orderId: string;
  repId?: string | null;
  actorName: string;
  channel: ContactAttemptChannel;
  noteText: string;
  attemptType?: ContactAttemptType;
};

type SyncOrderFollowUpInput = {
  orgId: string;
  orderId: string;
  assignedRepId?: string | null;
  status?: string | null;
  scheduledDate?: string | null;
  scheduledAt?: string | null;
  timelineNotes?: unknown;
};

const CLOSED_ORDER_STATUSES = new Set(["Delivered", "Cancelled", "Failed"]);
const ACTIVE_FOLLOW_UP_STATUSES: FollowUpTaskStatus[] = ["open", "due", "overdue"];
const HARD_STOP_OUTCOMES = new Set(["Refused", "Wrong Number", "Wrong number", "Out of Stock", "Out of coverage", "out of coverage", "Not interested"]);
const UNREACHABLE_OUTCOMES = new Set(["No Answer", "No answer", "Line Busy", "Line busy", "Not Picking", "Switched off", "Phone switched off", "Not Reached", "Not Available", "Number not going"]);
const WEAK_INTENT_OUTCOMES = new Set([
  "Will Call Back",
  "Scheduled Callback",
  "Not Ready",
  "Travelled",
  "Seat at home",
  "Will get back to us",
  "Have questions to ask",
  "Pending",
  "Call tomorrow",
  "Call in 2-3 days",
  "Waiting for salary / payday",
  "Needs spouse approval",
  "Wants discount",
  "Asked for WhatsApp details"
]);
const PROGRESS_OUTCOMES = new Set(["Confirmed", "Ready", "Ready now", "Delivered", "Recovered Delivery", "Waybill", "Awaiting payment"]);
const NIGERIA_TIME_ZONE = "Africa/Lagos";

const twoDigit = (value: number) => String(value).padStart(2, "0");

const lagosDateKey = (input?: string | Date | null) => {
  const value = input ? new Date(input) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NIGERIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value ?? `${value.getUTCFullYear()}`;
  const month = parts.find((part) => part.type === "month")?.value ?? twoDigit(value.getUTCMonth() + 1);
  const day = parts.find((part) => part.type === "day")?.value ?? twoDigit(value.getUTCDate());
  return `${year}-${month}-${day}`;
};

const startOfLagosDayUtc = (dateKey: string) => new Date(`${dateKey}T00:00:00+01:00`);
const endOfLagosDayUtc = (dateKey: string) => new Date(`${dateKey}T23:59:59+01:00`);

const parseLegacyOrderMetadata = (value: unknown) => {
  if (!value) return {} as { timelineNotes?: unknown[] };
  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return { timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined };
  }
  if (typeof value !== "string" || !value.trim()) return {} as { timelineNotes?: unknown[] };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as { timelineNotes?: unknown[] };
    const record = parsed as Record<string, unknown>;
    return { timelineNotes: Array.isArray(record.timelineNotes) ? record.timelineNotes : undefined };
  } catch {
    return {} as { timelineNotes?: unknown[] };
  }
};

const normalizeOrderNote = (value: unknown): OrderNoteRecord | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return null;
  const followUpAt = typeof record.followUpAt === "string" && record.followUpAt.trim()
    ? record.followUpAt
    : undefined;
  const followUpDate = typeof record.followUpDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.followUpDate)
    ? record.followUpDate
    : followUpAt
      ? lagosDateKey(followUpAt)
      : undefined;
  return {
    id: typeof record.id === "string" && record.id ? record.id : `note-${randomUUID()}`,
    text,
    by: typeof record.by === "string" && record.by ? record.by : "System",
    date: typeof record.date === "string" && record.date ? record.date : new Date().toISOString(),
    followUpAt,
    followUpDate
  };
};

const normalizeOrderNotes = (value: unknown): OrderNoteRecord[] =>
  Array.isArray(value)
    ? value
        .map((entry) => normalizeOrderNote(entry))
        .filter((entry): entry is OrderNoteRecord => Boolean(entry))
    : [];

const orderNotesFor = (notes: unknown, timelineNotes?: unknown) => {
  const directTimeline = normalizeOrderNotes(timelineNotes);
  if (directTimeline.length > 0) return directTimeline;
  const directNotes = normalizeOrderNotes(notes);
  if (directNotes.length > 0) return directNotes;
  return normalizeOrderNotes(parseLegacyOrderMetadata(notes).timelineNotes);
};

export const taskStatusFor = (
  task: Pick<FollowUpTaskRow, "status" | "due_at" | "sla_minutes" | "completed_at">,
  now = new Date()
): FollowUpTaskStatus => {
  if (task.status === "completed" || task.status === "cancelled") return task.status;
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return task.status ?? "open";
  if (due.getTime() > now.getTime()) return "open";
  const overdueThreshold = due.getTime() + Math.max(0, task.sla_minutes ?? 15) * 60 * 1000;
  return now.getTime() > overdueThreshold ? "overdue" : "due";
};

const derivePriority = (dueAt: string, referenceAt = new Date()): FollowUpTaskPriority => {
  try {
    return lagosDateKey(dueAt) === lagosDateKey(referenceAt) ? "same_day" : "normal";
  } catch {
    return "normal";
  }
};

const inferCustomerReached = (outcomeCode: string) => {
  const trimmed = outcomeCode.trim();
  if (!trimmed) return undefined;
  if (UNREACHABLE_OUTCOMES.has(trimmed) || trimmed === "Wrong Number") return false;
  if (HARD_STOP_OUTCOMES.has(trimmed) || PROGRESS_OUTCOMES.has(trimmed) || WEAK_INTENT_OUTCOMES.has(trimmed)) return true;
  return undefined;
};

const shouldRequireSameDayRetry = (priority: FollowUpTaskPriority, outcomeCode: string) =>
  priority === "same_day"
  && !HARD_STOP_OUTCOMES.has(outcomeCode)
  && !PROGRESS_OUTCOMES.has(outcomeCode);

const deriveBuyerHealth = (tasks: FollowUpTaskRow[], attempts: ContactAttemptRow[]): BuyerHealth => {
  const now = new Date();
  const activeTasks = tasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  const overdueCount = activeTasks.filter((task) => taskStatusFor(task, now) === "overdue").length;
  const todayKey = lagosDateKey(now);
  const unsuccessfulToday = attempts.filter((attempt) => {
    if (!UNREACHABLE_OUTCOMES.has(attempt.outcome_code) && !WEAK_INTENT_OUTCOMES.has(attempt.outcome_code)) return false;
    return lagosDateKey(attempt.attempted_at) === todayKey;
  }).length;
  const weakIntentRecent = attempts.filter((attempt) => WEAK_INTENT_OUTCOMES.has(attempt.outcome_code)).slice(0, 3).length;

  if (unsuccessfulToday >= 3 || weakIntentRecent >= 3) return "not_serious_candidate";
  if (overdueCount > 0 || unsuccessfulToday >= 2 || weakIntentRecent >= 2) return "at_risk";
  if (activeTasks.length > 0 || unsuccessfulToday >= 1 || weakIntentRecent >= 1) return "watch";
  return "healthy";
};

const statusTextForAttempt = (fromStatus: string | null | undefined, toStatus: string | null | undefined) =>
  fromStatus && toStatus && fromStatus !== toStatus ? `Status changed from ${fromStatus} to ${toStatus}. ` : "";

export const resolveFollowUpOwnership = async (orgId: string, assignedRepId?: string | null): Promise<TeamOwnership> => {
  if (!assignedRepId) return { teamId: null, managerId: null };
  const { data } = await supabase
    .from("sales_teams")
    .select("id, lead_id")
    .eq("org_id", orgId)
    .contains("member_ids", [assignedRepId])
    .limit(1)
    .maybeSingle();
  return {
    teamId: data?.id ?? null,
    managerId: data?.lead_id ?? null
  };
};

export const refreshOrderFollowUpSummary = async (orgId: string, orderId: string) => {
  const [{ data: tasks }, { data: attempts }] = await Promise.all([
    supabase
      .from("follow_up_tasks")
      .select("id, order_id, assigned_rep_id, team_id, manager_id, task_type, priority, status, due_at, sla_minutes, note, source_kind, source_ref, completed_at")
      .eq("org_id", orgId)
      .eq("order_id", orderId)
      .order("due_at", { ascending: true }),
    supabase
      .from("order_contact_attempts")
      .select("id, order_id, task_id, rep_id, team_id, manager_id, attempted_at, channel, attempt_type, outcome_code, outcome_group, recovery_bucket, outcome_note, customer_reached, next_action_type, next_action_at, promise_window, is_serious_signal")
      .eq("org_id", orgId)
      .eq("order_id", orderId)
      .order("attempted_at", { ascending: false })
  ]);

  const safeTasks = (tasks ?? []) as FollowUpTaskRow[];
  const safeAttempts = (attempts ?? []) as ContactAttemptRow[];
  const activeTasks = safeTasks.filter((task) => !["completed", "cancelled"].includes(task.status));
  const overdueCount = activeTasks.filter((task) => taskStatusFor(task) === "overdue").length;
  const nextTask = activeTasks
    .map((task) => ({ ...task, effective_status: taskStatusFor(task) }))
    .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime())[0];
  const latestAttempt = safeAttempts[0];
  const buyerHealth = deriveBuyerHealth(safeTasks, safeAttempts);

  await supabase
    .from("orders")
    .update({
      buyer_health: buyerHealth,
      follow_up_attempt_count: safeAttempts.length,
      last_contact_attempt_at: latestAttempt?.attempted_at ?? null,
      last_contact_attempt_outcome: latestAttempt?.outcome_code ?? null,
      next_follow_up_at: nextTask?.due_at ?? null,
      overdue_follow_up_count: overdueCount
    })
    .eq("org_id", orgId)
    .eq("id", orderId);

  return {
    buyerHealth,
    activeTasks,
    attempts: safeAttempts,
    nextTask: nextTask ?? null,
    overdueCount
  };
};

export const cancelActiveFollowUpTasksForOrder = async (orgId: string, orderId: string, note?: string) => {
  await supabase
    .from("follow_up_tasks")
    .update({
      status: "cancelled",
      note: note ?? "Cancelled by order workflow update."
    })
    .eq("org_id", orgId)
    .eq("order_id", orderId)
    .in("status", ACTIVE_FOLLOW_UP_STATUSES);
  await refreshOrderFollowUpSummary(orgId, orderId);
};

export const createOrReplaceFollowUpTask = async (input: CreateFollowUpTaskInput) => {
  const { teamId, managerId } = await resolveFollowUpOwnership(input.orgId, input.assignedRepId);
  await supabase
    .from("follow_up_tasks")
    .update({
      status: "cancelled",
      note: input.note ?? "Superseded by a newer follow-up plan."
    })
    .eq("org_id", input.orgId)
    .eq("order_id", input.orderId)
    .in("status", ACTIVE_FOLLOW_UP_STATUSES);

  const dueAt = new Date(input.dueAt);
  const initialStatus: FollowUpTaskStatus = Number.isNaN(dueAt.getTime())
    ? "open"
    : dueAt.getTime() <= Date.now()
      ? "due"
      : "open";

  const payload = {
    org_id: input.orgId,
    order_id: input.orderId,
    assigned_rep_id: input.assignedRepId ?? null,
    team_id: teamId,
    manager_id: managerId,
    task_type: input.taskType,
    priority: input.priority ?? derivePriority(input.dueAt),
    status: initialStatus,
    due_at: input.dueAt,
    note: input.note ?? null,
    source_kind: input.sourceKind ?? null,
    source_ref: input.sourceRef ?? null,
    created_from_attempt_id: input.createdFromAttemptId ?? null
  };

  const { data, error } = await supabase
    .from("follow_up_tasks")
    .insert(payload)
    .select()
    .single();

  if (error) throw new Error(error.message);
  await refreshOrderFollowUpSummary(input.orgId, input.orderId);
  return data;
};

export const syncOrderFollowUpTask = async (input: SyncOrderFollowUpInput) => {
  if (!input.orderId) return null;
  if (CLOSED_ORDER_STATUSES.has(input.status ?? "")) {
    await cancelActiveFollowUpTasksForOrder(input.orgId, input.orderId, `Order moved to ${input.status}.`);
    return null;
  }

  const normalizedNotes = orderNotesFor(undefined, input.timelineNotes);
  const latestFollowUpNote = normalizedNotes.find((note) => !!(note.followUpAt || note.followUpDate));

  if (latestFollowUpNote?.followUpAt || latestFollowUpNote?.followUpDate) {
    const dueAt = latestFollowUpNote.followUpAt ?? `${latestFollowUpNote.followUpDate}T08:00:00.000Z`;
    return createOrReplaceFollowUpTask({
      orgId: input.orgId,
      orderId: input.orderId,
      assignedRepId: input.assignedRepId,
      dueAt,
      taskType: "callback",
      note: latestFollowUpNote.text,
      sourceKind: "timeline_note",
      sourceRef: latestFollowUpNote.id
    });
  }

  if (input.scheduledAt || input.scheduledDate) {
    const dueAt = input.scheduledAt ?? `${input.scheduledDate}T08:00:00.000Z`;
    return createOrReplaceFollowUpTask({
      orgId: input.orgId,
      orderId: input.orderId,
      assignedRepId: input.assignedRepId,
      dueAt,
      taskType: "delivery_confirmation",
      note: "Scheduled delivery / callback reminder",
      sourceKind: "scheduled_delivery",
      sourceRef: dueAt
    });
  }

  await cancelActiveFollowUpTasksForOrder(input.orgId, input.orderId, "No active follow-up reminder remains on this order.");
  return null;
};

export const recordContactAttemptAndNextAction = async (input: RecordAttemptInput) => {
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_rep_id, response, call_outcome, notes, timeline_notes")
    .eq("org_id", input.orgId)
    .eq("id", input.orderId)
    .single();

  if (orderError || !order) {
    throw new Error("Order not found.");
  }

  const { data: task } = input.taskId
    ? await supabase
        .from("follow_up_tasks")
        .select("id, order_id, assigned_rep_id, team_id, manager_id, task_type, priority, status, due_at, sla_minutes, note, source_kind, source_ref, completed_at")
        .eq("org_id", input.orgId)
        .eq("order_id", input.orderId)
        .eq("id", input.taskId)
        .maybeSingle()
    : await supabase
        .from("follow_up_tasks")
        .select("id, order_id, assigned_rep_id, team_id, manager_id, task_type, priority, status, due_at, sla_minutes, note, source_kind, source_ref, completed_at")
        .eq("org_id", input.orgId)
        .eq("order_id", input.orderId)
        .in("status", ACTIVE_FOLLOW_UP_STATUSES)
        .order("due_at", { ascending: true })
        .limit(1)
        .maybeSingle();

  const activeTask = (task ?? null) as FollowUpTaskRow | null;
  const outcome = classifyFollowUpOutcome({
    outcomeCode: input.outcomeCode,
    recoveryBucket: input.recoveryBucket ?? null
  });
  const reached = inferCustomerReached(outcome.outcomeCode);
  const dueDateKey = activeTask ? lagosDateKey(activeTask.due_at) : lagosDateKey(new Date());
  const nextActionDateKey = input.nextActionAt ? lagosDateKey(input.nextActionAt) : null;

  if (outcome.requiresNextAction && (!input.nextActionType || !input.nextActionAt)) {
    throw new Error("This follow-up reason needs a next callback date and time before you can save it.");
  }

  if (
    activeTask
    && shouldRequireSameDayRetry(activeTask.priority, outcome.outcomeCode)
    && (!input.nextActionAt || nextActionDateKey !== dueDateKey)
  ) {
    throw new Error("This callback was promised for today. Log the outcome and set the next follow-up within the same working day.");
  }

  const ownership = activeTask?.team_id || activeTask?.manager_id
    ? { teamId: activeTask.team_id ?? null, managerId: activeTask.manager_id ?? null }
    : await resolveFollowUpOwnership(input.orgId, input.repId ?? order.assigned_rep_id ?? null);

  const promiseWindow = input.nextActionAt
    ? lagosDateKey(input.nextActionAt) === lagosDateKey(new Date())
      ? "same_day"
      : lagosDateKey(input.nextActionAt) === lagosDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000))
        ? "tomorrow"
        : "later"
    : null;

  const { data: attempt, error: attemptError } = await supabase
    .from("order_contact_attempts")
    .insert({
      org_id: input.orgId,
      order_id: input.orderId,
      task_id: activeTask?.id ?? null,
      rep_id: input.repId ?? order.assigned_rep_id ?? null,
      team_id: ownership.teamId,
      manager_id: ownership.managerId,
      attempted_at: new Date().toISOString(),
      channel: input.channel,
      channels: input.channels ?? [],
      attempt_type: input.attemptType,
      outcome_code: outcome.outcomeCode,
      outcome_group: outcome.outcomeGroup,
      recovery_bucket: outcome.recoveryBucket,
      outcome_note: input.outcomeNote ?? null,
      customer_reached: reached ?? null,
      next_action_type: input.nextActionType ?? null,
      next_action_at: input.nextActionAt ?? null,
      promise_window: promiseWindow,
      is_serious_signal: PROGRESS_OUTCOMES.has(outcome.outcomeCode) ? true : null
    })
    .select()
    .single();

  if (attemptError || !attempt) {
    throw new Error(attemptError?.message ?? "Could not save the follow-up attempt.");
  }

  if (activeTask?.id) {
    await supabase
      .from("follow_up_tasks")
      .update({
        status: "completed",
        completed_at: attempt.attempted_at,
        completed_attempt_id: attempt.id
      })
      .eq("org_id", input.orgId)
      .eq("id", activeTask.id);
  }

  const nextNoteText = `${statusTextForAttempt(order.status, order.status)}Follow-up attempt logged: ${outcome.outcomeCode}.${input.outcomeNote ? ` ${input.outcomeNote.trim()}` : ""}${input.nextActionAt ? ` Next action: ${input.nextActionType ?? "callback"} by ${input.nextActionAt}.` : ""}`;
  const currentNotes = orderNotesFor(order.notes, order.timeline_notes);
  const timelineNotes = [
    {
      id: `note-${randomUUID()}`,
      text: nextNoteText.trim(),
      by: input.actorName,
      date: attempt.attempted_at,
      followUpDate: input.nextActionAt ? lagosDateKey(input.nextActionAt) : undefined,
      followUpAt: input.nextActionAt ?? undefined
    },
    ...currentNotes
  ];

  const nextResponse = input.nextActionAt
    ? `Next ${input.nextActionType ?? "follow-up"} set for ${input.nextActionAt}`
    : input.outcomeNote?.trim()
      ? input.outcomeNote.trim()
      : outcome.outcomeCode;

  await supabase
    .from("orders")
    .update({
      call_outcome: outcome.outcomeCode,
      response: nextResponse,
      timeline_notes: timelineNotes
    })
    .eq("org_id", input.orgId)
    .eq("id", input.orderId);

  if (input.nextActionAt && input.nextActionType) {
    await createOrReplaceFollowUpTask({
      orgId: input.orgId,
      orderId: input.orderId,
      assignedRepId: input.repId ?? order.assigned_rep_id ?? null,
      dueAt: input.nextActionAt,
      taskType: input.nextActionType,
      note: input.nextActionNote ?? input.outcomeNote ?? outcome.outcomeCode,
      sourceKind: "attempt_next_action",
      sourceRef: attempt.id,
      createdFromAttemptId: attempt.id
    });
  } else {
    await refreshOrderFollowUpSummary(input.orgId, input.orderId);
  }

  return attempt;
};

export const recordFollowUpProgressNote = async (input: RecordProgressNoteInput) => {
  const noteText = input.noteText.trim();
  if (!noteText) throw new Error("Progress note text is required.");

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id, status, assigned_rep_id, response, call_outcome, notes, timeline_notes")
    .eq("org_id", input.orgId)
    .eq("id", input.orderId)
    .single();

  if (orderError || !order) {
    throw new Error("Order not found.");
  }

  const { data: task } = await supabase
    .from("follow_up_tasks")
    .select("id, order_id, assigned_rep_id, team_id, manager_id, task_type, priority, status, due_at, sla_minutes, note, source_kind, source_ref, completed_at")
    .eq("org_id", input.orgId)
    .eq("order_id", input.orderId)
    .in("status", ACTIVE_FOLLOW_UP_STATUSES)
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const activeTask = (task ?? null) as FollowUpTaskRow | null;
  const ownership = activeTask?.team_id || activeTask?.manager_id
    ? { teamId: activeTask.team_id ?? null, managerId: activeTask.manager_id ?? null }
    : await resolveFollowUpOwnership(input.orgId, input.repId ?? order.assigned_rep_id ?? null);

  const attemptedAt = new Date().toISOString();
  const attemptType = input.attemptType
    ?? (activeTask?.task_type === "payment_check" ? "payment_follow_up" : "scheduled_callback");

  const { data: attempt, error: attemptError } = await supabase
    .from("order_contact_attempts")
    .insert({
      org_id: input.orgId,
      order_id: input.orderId,
      task_id: activeTask?.id ?? null,
      rep_id: input.repId ?? order.assigned_rep_id ?? null,
      team_id: ownership.teamId,
      manager_id: ownership.managerId,
      attempted_at: attemptedAt,
      channel: input.channel,
      attempt_type: attemptType,
      outcome_code: "Rep Update",
      outcome_note: noteText,
      customer_reached: null,
      next_action_type: null,
      next_action_at: null,
      promise_window: null,
      is_serious_signal: null
    })
    .select()
    .single();

  if (attemptError || !attempt) {
    throw new Error(attemptError?.message ?? "Could not save the follow-up progress note.");
  }

  const currentNotes = orderNotesFor(order.notes, order.timeline_notes);
  const timelineNotes = [
    {
      id: `note-${randomUUID()}`,
      text: `Follow-up progress update: ${noteText}`,
      by: input.actorName,
      date: attemptedAt
    },
    ...currentNotes
  ];

  await supabase
    .from("orders")
    .update({
      response: noteText,
      timeline_notes: timelineNotes
    })
    .eq("org_id", input.orgId)
    .eq("id", input.orderId);

  await refreshOrderFollowUpSummary(input.orgId, input.orderId);
  return attempt;
};
