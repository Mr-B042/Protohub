import { unfilledGaps } from "./email-render.js";
import crypto from "node:crypto";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";
import { fetchAllRowsOrThrow, selectByIdBatches } from "./query-limits.js";
import { marketingSender } from "./mailer.js";
import {
  DAY_MS, lagosDay, phoneKey, resolveAudience, segmentMatches, slugFor, type AudienceChoice, type Condition, type Person
} from "./email-marketing-rules.js";
import { EmailMarketingError, audienceLabel, campaignLinks, forgetWorld, loadWorld, sendTest } from "./email-marketing.js";
import {
  PRIORITY_RANK, STAGES, branchNodeId, defaultStage, checkMet, durationDays, emailNodes, findNode, firstNodeId, inSendWindow, mayEnter, nextNodeId, nextWindowStart, nextPaydayMs,
  QUIET_REASON_LABELS, normalizeSettings, normalizeTrigger, normalizeWorkflow, quietReason, waitMs,
  type AutomationSettings, type Stage, type Trigger, type Workflow, type WorkflowNode
} from "./email-automation-rules.js";

/**
 * Automations (Bright's designs 50, 51 and steps 2-4, 8 Nov 2026).
 * Each email step sends through a hidden campaign (email_campaigns with
 * automation_id), so sending, tracking and order matching are shared with
 * campaigns. Every minute the job moves customers along; every 10 minutes it
 * looks for new customers to bring in. Rules: email-automation-rules.ts.
 */

type World = Awaited<ReturnType<typeof loadWorld>>;
type Enrollment = { on: boolean; match: "all" | "any"; conditions: Condition[] };

const newToken = () => crypto.randomBytes(18).toString("base64url");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

/** Automation goal → the campaign goal its hidden email campaigns carry. */
const CAMPAIGN_GOAL: Record<string, string> = {
  repeat: "retention", winback: "winback", cart: "cart", welcome: "announcement", reviews: "appreciation", reorder: "retention", occasion: "appreciation", loyalty: "appreciation", upsell: "upsell"
};

export function automationRow(row: any) {
  const workflow = (row.workflow ?? { nodes: [] }) as Workflow;
  return {
    id: row.id as string, name: row.name as string, description: row.description ?? "", template: row.template ?? null, goal: row.goal,
    trigger: normalizeTrigger(row.trigger), audience: (row.audience?.source ? row.audience : { source: "all" }) as AudienceChoice,
    enrollment: { on: !!row.enrollment?.on, match: row.enrollment?.match === "any" ? "any" : "all", conditions: Array.isArray(row.enrollment?.conditions) ? row.enrollment.conditions : [] } as Enrollment,
    settings: normalizeSettings(row.settings), workflow, status: row.status as string,
    // Customer Journey's grouping: the one picked, else from the template / trigger.
    stage: ((STAGES as readonly string[]).includes(row.stage) ? row.stage : defaultStage(row.template, row.trigger)) as Stage,
    launchedAt: row.launched_at ?? null, pausedAt: row.paused_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at, createdByName: row.created_by_name ?? ""
  };
}
type Automation = ReturnType<typeof automationRow>;

// ── Saving ────────────────────────────────────────────────────────────

const STEP_STATUS: Record<string, string> = { draft: "draft", active: "active", paused: "paused", archived: "archived" };

/** Creates or updates the hidden campaign behind each email step; returns the flow with their ids filled in. */
async function syncStepCampaigns(orgId: string, branchId: string, automationId: string, name: string, goal: string, audience: AudienceChoice, settings: AutomationSettings, workflow: Workflow, status: string, userId: string | null) {
  const { data: existing, error } = await supabase.from("email_campaigns").select("id, step_id, status, slug, links").eq("org_id", orgId).eq("branch_id", branchId).eq("automation_id", automationId);
  if (error) throw new Error(error.message);
  const byStep = new Map((existing ?? []).map((row: any) => [row.step_id, row]));
  const keep = new Set<string>();
  const options = { abTest: false, plainText: false, utm: settings.utm, resendNonOpeners: false, resendHours: 48, track: settings.track, sendWindow: settings.sendWindow, replyTo: settings.replyTo };
  const fill = async (nodes: WorkflowNode[]): Promise<WorkflowNode[]> => {
    const out: WorkflowNode[] = [];
    for (const node of nodes) {
      if (node.type === "condition") { out.push({ ...node, yes: await fill(node.yes), no: await fill(node.no) }); continue; }
      if (node.type !== "email") { out.push(node); continue; }
      const columns = {
        name: `${name} · ${node.name}`.slice(0, 160), goal: CAMPAIGN_GOAL[goal] ?? "retention", subject: node.email.subject, subject_b: "", preheader: node.email.preheader,
        offer_type: "custom", product_id: node.email.productId, offer: { on: false, title: "", benefit: "" }, audience, design: node.email.design ?? { blocks: [] },
        delivery: { type: "step" }, options, status: STEP_STATUS[status] ?? "draft", thumbnail_url: node.email.thumbnailUrl, offer_id: node.email.offerId ?? null, updated_at: new Date().toISOString()
      };
      const current = byStep.get(node.id);
      const slug = current?.slug ?? slugFor(`${name} ${node.name}`, crypto.randomBytes(4).toString("hex"));
      // Clicks are counted by a link's place in this list: links already sent keep
      // their place when the email is edited; new ones are added at the end.
      const old: Array<{ label: string; original?: string; url: string }> = Array.isArray(current?.links) ? current.links : [];
      const fresh = node.email.design ? campaignLinks({ slug, options }, node.email.design) : [];
      const links = [...old, ...fresh.filter((link) => !old.some((item) => (item.original ?? item.url) === link.original))];
      let campaignId = current?.id as string | undefined;
      if (current) {
        const { error: updateError } = await supabase.from("email_campaigns").update({ ...columns, links }).eq("id", current.id);
        if (updateError) throw new Error(updateError.message);
      } else {
        const { data, error: insertError } = await supabase.from("email_campaigns").insert({
          ...columns, links, org_id: orgId, branch_id: branchId, automation_id: automationId, step_id: node.id,
          slug, created_by: userId, created_by_name: "Automation",
          launched_at: status === "active" ? new Date().toISOString() : null
        }).select("id").single();
        if (insertError) throw new Error(insertError.message);
        campaignId = data.id;
      }
      keep.add(node.id);
      out.push({ ...node, campaignId: campaignId ?? null });
    }
    return out;
  };
  const filled = { nodes: await fill(workflow.nodes) };
  // Email steps taken out of the flow: their campaign is put away and anything still waiting to send is dropped.
  const removed = (existing ?? []).filter((row: any) => !keep.has(row.step_id) && row.status !== "archived").map((row: any) => row.id);
  if (removed.length) {
    await supabase.from("email_campaigns").update({ status: "archived", updated_at: new Date().toISOString() }).in("id", removed);
    await supabase.from("email_campaign_sends").update({ status: "skipped", error: "The step was taken out of the automation" }).in("campaign_id", removed).eq("status", "queued");
  }
  return filled;
}

export type AutomationInput = {
  name: string; description: string; template: string | null; goal: string; trigger: unknown; audience: AudienceChoice;
  enrollment: Enrollment; settings: unknown; workflow: unknown; stage: Stage | null;
};

/** What a launch needs: at least one finished email, and a working sender. */
async function readyToLaunch(orgId: string, branchId: string, trigger: Trigger, workflow: Workflow) {
  const emails = emailNodes(workflow);
  if (!emails.length) throw new EmailMarketingError(400, "Add at least one email to the flow before launching.");
  const unfinished = emails.find((node) => !node.email.subject.trim() || !node.email.design?.blocks?.length);
  if (unfinished) throw new EmailMarketingError(400, `"${unfinished.name}" needs a subject and some content before launching.`);
  const gapped = emails.find((node) => unfilledGaps(node.email.design, node.email.subject).length);
  if (gapped) throw new EmailMarketingError(400, `"${gapped.name}" still has parts to fill in: ${unfilledGaps(gapped.email.design, gapped.email.subject).join(", ")}. Write them, then launch.`);
  if (trigger.kind === "date_field") {
    const { data } = await supabase.from("email_custom_fields").select("id").eq("org_id", orgId).eq("branch_id", branchId).eq("key", trigger.fieldKey ?? "").eq("type", "date").eq("status", "active").maybeSingle();
    if (!data) throw new EmailMarketingError(400, "Add the date field first: Audience & Segments › Custom Fields (type Date), e.g. Birthday.");
  }
  if (trigger.kind === "in_segment") {
    const { data } = await supabase.from("email_segments").select("id").eq("org_id", orgId).eq("branch_id", branchId).eq("id", trigger.segmentId || "00000000-0000-0000-0000-000000000000").eq("status", "active").maybeSingle();
    if (!data) throw new EmailMarketingError(400, "Pick the group (segment) this flow is for.");
  }
  const sender = await marketingSender(orgId);
  if (!sender.ready) throw new EmailMarketingError(409, sender.reason ?? "Email sending is not set up.");
}

export async function saveAutomation(orgId: string, branchId: string, user: { id: string; name?: string | null }, id: string | null, input: AutomationInput, launch: boolean) {
  let workflow: Workflow;
  try { workflow = normalizeWorkflow(input.workflow); } catch (error) { throw new EmailMarketingError(400, (error as Error).message); }
  const trigger = normalizeTrigger(input.trigger);
  const settings = normalizeSettings(input.settings);
  let current: any = null;
  if (id) {
    const { data, error } = await supabase.from("email_automations").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new EmailMarketingError(404, "Automation not found.");
    if (data.status === "archived") throw new EmailMarketingError(409, "This automation is archived. Bring it back first.");
    current = data;
  }
  if (launch) await readyToLaunch(orgId, branchId, trigger, workflow);
  const status = launch ? "active" : current?.status ?? "draft";
  const now = new Date().toISOString();
  const columns = {
    name: input.name, description: input.description, template: input.template, goal: input.goal, trigger, audience: input.audience, stage: input.stage,
    enrollment: input.enrollment, settings, status, updated_at: now,
    ...(launch && current?.status !== "active" ? { launched_at: now, paused_at: null } : {})
  };
  let automationId = id;
  if (!current) {
    const { data, error } = await supabase.from("email_automations").insert({ ...columns, org_id: orgId, branch_id: branchId, workflow: { nodes: [] }, created_by: user.id, created_by_name: user.name ?? "" }).select("id").single();
    if (error) throw new Error(error.message);
    automationId = data.id;
  }
  const filled = await syncStepCampaigns(orgId, branchId, automationId!, input.name, input.goal, input.audience, settings, workflow, status, user.id);
  const { error } = await supabase.from("email_automations").update({ ...columns, workflow: filled }).eq("id", automationId!);
  if (error) throw new Error(error.message);
  return automationId!;
}

export async function setAutomationStatus(orgId: string, branchId: string, id: string, action: "launch" | "pause" | "resume" | "archive" | "unarchive") {
  const { data: row, error } = await supabase.from("email_automations").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new EmailMarketingError(404, "Automation not found.");
  const auto = automationRow(row);
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (action === "launch" || action === "resume") {
    if (auto.status === "archived") throw new EmailMarketingError(409, "Bring the automation back from the archive first.");
    await readyToLaunch(orgId, branchId, auto.trigger, auto.workflow);
    patch = { status: "active", paused_at: null, ...(auto.launchedAt ? {} : { launched_at: now }) };
  } else if (action === "pause") {
    if (auto.status !== "active") throw new EmailMarketingError(409, "Only a running automation can be paused.");
    patch = { status: "paused", paused_at: now };
  } else if (action === "archive") {
    patch = { status: "archived" };
    await supabase.from("email_automation_runs").update({ status: "exited", exit_reason: "Automation archived", finished_at: now }).eq("automation_id", id).eq("status", "active");
  } else {
    if (auto.status !== "archived") throw new EmailMarketingError(409, "This automation is not archived.");
    patch = { status: "paused", paused_at: now };
  }
  const { error: updateError } = await supabase.from("email_automations").update({ ...patch, updated_at: now }).eq("id", id);
  if (updateError) throw new Error(updateError.message);
  await supabase.from("email_campaigns").update({ status: STEP_STATUS[String(patch.status)], updated_at: now, ...(patch.status === "active" ? { launched_at: now } : {}) }).eq("automation_id", id).neq("status", "archived");
  // Steps already taken out of the flow stay archived; the live ones follow the automation.
}

export async function deleteAutomation(orgId: string, branchId: string, id: string) {
  const { count } = await supabase.from("email_automation_runs").select("id", { count: "exact", head: true }).eq("automation_id", id);
  if (count) throw new EmailMarketingError(409, "Customers have already been through this automation. Archive it instead, so its results are kept.");
  const { error } = await supabase.from("email_automations").delete().eq("org_id", orgId).eq("branch_id", branchId).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function duplicateAutomation(orgId: string, branchId: string, user: { id: string; name?: string | null }, id: string) {
  const row = await getAutomation(orgId, branchId, id);
  const strip = (nodes: WorkflowNode[]): WorkflowNode[] => nodes.map((node) => (node.type === "email" ? { ...node, campaignId: null } : node.type === "condition" ? { ...node, yes: strip(node.yes), no: strip(node.no) } : node));
  return saveAutomation(orgId, branchId, user, null, {
    name: `${row.name} (copy)`.slice(0, 160), description: row.description, template: row.template, goal: row.goal, trigger: row.trigger, audience: row.audience,
    enrollment: row.enrollment, settings: row.settings, workflow: { nodes: strip(row.workflow.nodes) }, stage: row.stage
  }, false);
}

export async function getAutomation(orgId: string, branchId: string, id: string) {
  const { data, error } = await supabase.from("email_automations").select("*").eq("org_id", orgId).eq("branch_id", branchId).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new EmailMarketingError(404, "Automation not found.");
  return automationRow(data);
}

// ── The page (design 50) ──────────────────────────────────────────────

type SendLite = { campaignId: string; email: string; status: string; sentMs: number | null; orderId: string | null; engaged: boolean };

export async function automationsPage(orgId: string, branchId: string) {
  const nowMs = Date.now();
  const [{ data: rows, error }, world] = await Promise.all([
    supabase.from("email_automations").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at", { ascending: false }).limit(200),
    loadWorld(orgId, branchId)
  ]);
  if (error) throw new Error(error.message);
  const automations = (rows ?? []).map(automationRow);
  const ids = automations.map((row) => row.id);
  const steps = ids.length ? await selectByIdBatches<any>(ids, (batch) => supabase.from("email_campaigns").select("id, automation_id").in("automation_id", batch)) : [];
  const stepOf = new Map(steps.map((row) => [row.id, row.automation_id]));
  const sends: SendLite[] = steps.length
    ? (await selectByIdBatches<any>(steps.map((row) => row.id), (batch) => supabase.from("email_campaign_sends").select("campaign_id, email, status, sent_at, order_id, first_opened_at, first_clicked_at").in("campaign_id", batch)))
      .map((row) => ({ campaignId: row.campaign_id, email: row.email, status: row.status, sentMs: row.sent_at ? Date.parse(row.sent_at) : null, orderId: row.order_id, engaged: !!(row.first_opened_at || row.first_clicked_at) }))
    : [];
  const runs = ids.length ? await selectByIdBatches<any>(ids, (batch) => supabase.from("email_automation_runs").select("automation_id, email, status, entered_at, finished_at").in("automation_id", batch)) : [];
  const orderAmount = new Map(world.orders.filter((order) => order.status === "Delivered").map((order) => [order.id, order.amount]));

  const window = (list: SendLite[], fromMs: number, toMs: number) => {
    const sent = list.filter((send) => send.status === "sent" && send.sentMs !== null && send.sentMs >= fromMs && send.sentMs < toMs);
    const people = new Set(sent.map((send) => send.email));
    const buyers = new Set(sent.filter((send) => send.orderId).map((send) => send.email));
    const revenue = sent.reduce((sum, send) => sum + (send.orderId ? orderAmount.get(send.orderId) ?? 0 : 0), 0);
    return { sent: sent.length, people: people.size, buyers: buyers.size, revenue, conversion: pct(buyers.size, people.size) };
  };
  const now30 = window(sends, nowMs - 30 * DAY_MS, nowMs + 1), before30 = window(sends, nowMs - 60 * DAY_MS, nowMs - 30 * DAY_MS);
  const reached = (fromMs: number, toMs: number) => new Set(runs.filter((run) => { const at = Date.parse(run.entered_at); return at >= fromMs && at < toMs; }).map((run) => run.email)).size;
  const reachedNow = reached(nowMs - 30 * DAY_MS, nowMs + 1), reachedBefore = reached(nowMs - 60 * DAY_MS, nowMs - 30 * DAY_MS);

  // Customer Journey (design 53): who is in a flow now and 30 days ago, and the last 30 days day by day.
  const inFlowAt = (atMs: number) => new Set(runs.filter((run) => Date.parse(run.entered_at) <= atMs
    && (run.finished_at ? Date.parse(run.finished_at) > atMs : run.status === "active")).map((run) => run.email)).size;
  const inFlowNow = inFlowAt(nowMs), inFlowBefore = inFlowAt(nowMs - 30 * DAY_MS);
  const sent30 = sends.filter((send) => send.status === "sent" && send.sentMs !== null && send.sentMs >= nowMs - 30 * DAY_MS);
  const engaged30 = new Set(sent30.filter((send) => send.engaged).map((send) => send.email)).size;
  const daily = Array.from({ length: 30 }, (_, i) => lagosDay(nowMs - (29 - i) * DAY_MS)).map((day) => {
    const rows = sent30.filter((send) => lagosDay(send.sentMs!) === day);
    return { day, sent: rows.length, conversions: rows.filter((send) => send.orderId).length, revenue: rows.reduce((sum, send) => sum + (send.orderId ? orderAmount.get(send.orderId) ?? 0 : 0), 0) };
  });

  const audienceSize = (audience: AudienceChoice) => resolveAudience(world.people, audience, world.segments, world.ctx).recipients.length;
  return {
    journey: {
      inFlow: { value: inFlowNow, change: change(inFlowNow, inFlowBefore) },
      engaged: { value: engaged30, percent: pct(engaged30, now30.people) },
      conversions: { value: now30.buyers, percent: now30.conversion },
      daily
    },
    kpis: {
      active: automations.filter((row) => row.status === "active").length,
      sent: { value: now30.sent, change: change(now30.sent, before30.sent) },
      reached: { value: reachedNow, change: change(reachedNow, reachedBefore) },
      conversion: { value: now30.conversion, changePp: now30.conversion !== null && before30.conversion !== null ? Math.round((now30.conversion - before30.conversion) * 10) / 10 : null },
      revenue: { value: now30.revenue, change: change(now30.revenue, before30.revenue) }
    },
    automations: automations.map((auto) => {
      const mine = sends.filter((send) => stepOf.get(send.campaignId) === auto.id);
      const all = window(mine, 0, nowMs + 1);
      const a30 = window(mine, nowMs - 30 * DAY_MS, nowMs + 1), b30 = window(mine, nowMs - 60 * DAY_MS, nowMs - 30 * DAY_MS);
      const myRuns = runs.filter((run) => run.automation_id === auto.id);
      return {
        ...auto,
        emails: emailNodes(auto.workflow).length,
        durationDays: durationDays(auto.workflow.nodes),
        audienceLabel: audienceLabel(auto.audience, world.segments),
        audienceCount: audienceSize(auto.audience),
        reached: new Set(myRuns.map((run) => run.email)).size,
        activeRuns: myRuns.filter((run) => run.status === "active").length,
        sent: all.sent, conversion: all.conversion, revenue: all.revenue,
        conversionChangePp: a30.conversion !== null && b30.conversion !== null ? Math.round((a30.conversion - b30.conversion) * 10) / 10 : null
      };
    })
  };
}

/** One automation's results: who is where, and each email's numbers. */
export async function automationReport(orgId: string, branchId: string, id: string) {
  const auto = await getAutomation(orgId, branchId, id);
  const world = await loadWorld(orgId, branchId);
  const [runs, { data: steps }] = await Promise.all([
    fetchAllRowsOrThrow<any>(() => supabase.from("email_automation_runs").select("email, name, status, exit_reason, node_id, entered_at, finished_at, next_at").eq("automation_id", id).order("entered_at", { ascending: false })),
    supabase.from("email_campaigns").select("id, step_id").eq("automation_id", id)
  ]);
  const campaignOf = new Map((steps ?? []).map((row: any) => [row.step_id, row.id]));
  const sends = (steps ?? []).length ? await selectByIdBatches<any>((steps ?? []).map((row: any) => row.id), (batch) => supabase.from("email_campaign_sends").select("campaign_id, status, first_opened_at, first_clicked_at, order_id, unsubscribed_at").in("campaign_id", batch)) : [];
  const orderAmount = new Map(world.orders.filter((order) => order.status === "Delivered").map((order) => [order.id, order.amount]));
  const reasons = new Map<string, number>();
  for (const run of runs) if (run.status === "exited") reasons.set(run.exit_reason ?? "Left the flow", (reasons.get(run.exit_reason ?? "Left the flow") ?? 0) + 1);
  return {
    automation: auto,
    runs: { total: runs.length, active: runs.filter((run) => run.status === "active").length, completed: runs.filter((run) => run.status === "completed").length, exited: runs.filter((run) => run.status === "exited").length },
    exitReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    emails: emailNodes(auto.workflow).map((node) => {
      const mine = sends.filter((send) => send.campaign_id === campaignOf.get(node.id));
      const sent = mine.filter((send) => send.status === "sent");
      return {
        stepId: node.id, name: node.name, subject: node.email.subject, sent: sent.length, waiting: mine.filter((send) => send.status === "queued").length,
        openRate: pct(sent.filter((send) => send.first_opened_at || send.first_clicked_at).length, sent.length), clickRate: pct(sent.filter((send) => send.first_clicked_at).length, sent.length),
        orders: sent.filter((send) => send.order_id).length, revenue: sent.reduce((sum, send) => sum + (send.order_id ? orderAmount.get(send.order_id) ?? 0 : 0), 0),
        unsubscribed: sent.filter((send) => send.unsubscribed_at).length
      };
    }),
    recent: runs.slice(0, 15).map((run) => ({
      email: run.email, name: run.name, status: run.status, exitReason: run.exit_reason, enteredAt: run.entered_at, finishedAt: run.finished_at,
      nextAt: run.status === "active" ? run.next_at : null, step: findNode(auto.workflow, run.node_id)?.type ?? null, stepName: stepName(findNode(auto.workflow, run.node_id))
    }))
  };
}

function stepName(node: WorkflowNode | null) {
  if (!node) return null;
  switch (node.type) {
    case "wait": return `Wait ${node.amount} ${node.unit === "hours" ? (node.amount === 1 ? "hour" : "hours") : node.amount === 1 ? "day" : "days"}`;
    case "email": return node.name;
    case "condition": return node.name || "Check";
    case "tag": return `${node.action === "add" ? "Add" : "Remove"} tag ${node.tagName}`;
    case "list": return `Add to ${node.listName}`;
    default: return "End";
  }
}

/** Test Flow: every email of the flow to the given addresses, marked [Test]. */
export async function testAutomationEmails(orgId: string, branchId: string, workflow: unknown, emails: string[], senderName: string) {
  let flow: Workflow;
  try { flow = normalizeWorkflow(workflow); } catch (error) { throw new EmailMarketingError(400, (error as Error).message); }
  const steps = emailNodes(flow);
  if (!steps.length) throw new EmailMarketingError(400, "The flow has no emails yet.");
  const results: Array<{ step: string; email: string; ok: boolean; error?: string }> = [];
  for (const node of steps) {
    try {
      const sent = await sendTest(orgId, branchId, { slug: "test", subject: `${node.email.subject}`, preheader: node.email.preheader, design: node.email.design, options: {} }, emails, senderName);
      for (const row of sent) results.push({ step: node.name, ...row });
    } catch (error) {
      results.push({ step: node.name, email: emails.join(", "), ok: false, error: (error as Error).message });
    }
  }
  return results;
}

// ── The engine ────────────────────────────────────────────────────────

// The engine reads a branch's customers at most every 10 minutes (orders and
// carts are the heavy part); sending re-checks the unsubscribe right before
// each email, so a slightly old read never emails someone who left.
const ENGINE_WORLD_MS = 10 * 60_000;
const engineWorlds = new Map<string, { at: number; world: World }>();
async function engineWorld(orgId: string, branchId: string) {
  const hit = engineWorlds.get(branchId);
  if (hit && Date.now() - hit.at < ENGINE_WORLD_MS) return hit.world;
  const world = await loadWorld(orgId, branchId);
  engineWorlds.set(branchId, { at: Date.now(), world });
  return world;
}

const deliveredDayMs = (day: string | null) => (day ? Date.parse(`${day.slice(0, 10)}T11:00:00Z`) : NaN);

type Candidate = { key: string; person: Person; atMs: number; label: string; triggerOrderId?: string };

/** The customers whose trigger happened since the automation went live (looking back at most 7 days). */
async function candidatesFor(auto: Automation, branchId: string, world: World, nowMs: number): Promise<Candidate[]> {
  const launchedMs = auto.launchedAt ? Date.parse(auto.launchedAt) : nowMs;
  const launchDay = lagosDay(launchedMs);
  const since = Math.max(launchedMs, nowMs - 7 * DAY_MS);
  const sinceDay = lagosDay(Math.max(launchedMs, nowMs - 7 * DAY_MS));
  const t = auto.trigger;
  const byPhone = new Map<string, Person>();
  const byEmail = new Map<string, Person>();
  const byContact = new Map<string, Person>();
  for (const person of world.people) {
    if (!person.contact || person.contact.status !== "subscribed") continue;
    if (person.stats?.key) byPhone.set(person.stats.key, person);
    const phone = phoneKey(person.contact.phone);
    if (phone && !byPhone.has(phone)) byPhone.set(phone, person);
    byEmail.set(person.contact.email, person);
    byContact.set(person.contact.id, person);
  }
  const out: Candidate[] = [];
  const productOk = (productId: string | null) => !t.productId || productId === t.productId;
  const ordersOf = (key: string) => world.orders.filter((order) => phoneKey(order.phone) === key);

  if (t.kind === "order_delivered") {
    for (const order of world.orders) {
      if (order.status !== "Delivered" || !order.deliveredDate || !productOk(order.productId)) continue;
      const day = order.deliveredDate.slice(0, 10);
      if (day < launchDay || day < sinceDay) continue;
      const person = byPhone.get(phoneKey(order.phone));
      if (person) out.push({ key: `order:${order.id}`, person, atMs: deliveredDayMs(day), label: "Order delivered", triggerOrderId: order.id });
    }
  } else if (t.kind === "order_placed") {
    for (const order of world.orders) {
      const at = Date.parse(order.createdAt);
      if (at < since || !productOk(order.productId)) continue;
      const person = byPhone.get(phoneKey(order.phone));
      if (person) out.push({ key: `order:${order.id}`, person, atMs: at, label: "Order placed", triggerOrderId: order.id });
    }
  } else if (t.kind === "cart_abandoned") {
    const wait = (t.cartMinutes ?? 60) * 60_000;
    for (const cart of await recentCarts(branchId, since)) {
      const at = Date.parse(cart.created_at);
      if (at + wait > nowMs || String(cart.status) === "Converted" || !productOk(cart.product_id ?? null)) continue;
      const person = byPhone.get(phoneKey(cart.phone)) ?? (cart.email ? byEmail.get(String(cart.email).toLowerCase()) : undefined);
      if (!person) continue;
      // A cart that became an order (same phone, ordered after it) is not left behind.
      const key = person.stats?.key;
      if (key && ordersOf(key).some((order) => Date.parse(order.createdAt) >= at)) continue;
      out.push({ key: `cart:${cart.id}`, person, atMs: at, label: "Left the order form" });
    }
  } else if (t.kind === "new_subscriber") {
    for (const contact of world.contacts) {
      const at = Date.parse(contact.createdAt);
      const person = byContact.get(contact.id);
      if (person && at >= since) out.push({ key: `contact:${contact.id}`, person, atMs: at, label: "Joined the email list" });
    }
  } else if (t.kind === "inactive") {
    for (const person of byContact.values()) {
      const s = person.stats;
      if (!s || s.lastDeliveredMs === null) continue;
      const cross = s.lastDeliveredMs + (t.inactiveDays ?? 60) * DAY_MS;
      if (cross > nowMs || cross < since) continue;
      if (s.lastOrderMs !== null && s.lastDeliveredOrderCreatedMs !== null && s.lastOrderMs > s.lastDeliveredOrderCreatedMs) continue;
      out.push({ key: `inactive:${person.contact!.id}:${lagosDay(s.lastDeliveredMs)}`, person, atMs: cross, label: `No purchase in ${t.inactiveDays ?? 60} days` });
    }
  } else if (t.kind === "date_field") {
    const today = lagosDay(nowMs);
    if (today >= launchDay) {
      for (const contact of world.contacts) {
        const value = String((contact.fields as Record<string, unknown>)[t.fieldKey ?? "birthday"] ?? "");
        const person = byContact.get(contact.id);
        if (person && /^\d{4}-\d{2}-\d{2}$/.test(value) && value.slice(5) === today.slice(5)) out.push({ key: `date:${contact.id}:${today.slice(0, 4)}`, person, atMs: nowMs, label: "Their special day" });
      }
    }
  } else if (t.kind === "vip") {
    const need = t.vipOrders ?? 3;
    for (const person of byContact.values()) {
      if (!person.stats || person.stats.deliveredCount < need) continue;
      const days = ordersOf(person.stats.key).filter((order) => order.status === "Delivered" && order.deliveredDate).map((order) => order.deliveredDate!.slice(0, 10)).sort();
      const day = days[need - 1];
      if (day && day >= launchDay && day >= sinceDay) out.push({ key: `vip:${person.contact!.id}`, person, atMs: deliveredDayMs(day), label: `Reached ${need} delivered orders` });
    }
  } else if (t.kind === "reorder") {
    const gap = (t.reorderDays ?? 30) * DAY_MS;
    for (const order of world.orders) {
      if (order.status !== "Delivered" || !order.deliveredDate || !productOk(order.productId)) continue;
      const due = deliveredDayMs(order.deliveredDate) + gap;
      if (due > nowMs || due < since) continue;
      const person = byPhone.get(phoneKey(order.phone));
      if (!person) continue;
      if (ordersOf(person.stats?.key ?? "").some((other) => Date.parse(other.createdAt) > Date.parse(order.createdAt))) continue;
      out.push({ key: `reorder:${order.id}`, person, atMs: due, label: "Time to buy again", triggerOrderId: order.id });
    }
  } else if (t.kind === "in_segment") {
    // Everyone (subscribed) in the group right now. A flow that repeats gets a fresh key each day it may start again.
    const row = world.segmentRows.find((item) => item.id === t.segmentId && item.status === "active");
    if (row) {
      for (const person of byContact.values()) {
        if (!inGroup(world, row, person)) continue;
        const id = person.contact!.id;
        out.push({ key: auto.settings.reentry ? `seg:${row.id}:${id}:${lagosDay(nowMs)}` : `seg:${row.id}:${id}`, person, atMs: nowMs, label: `In the group: ${row.name}` });
      }
    }
  } else if (t.kind === "went_quiet") {
    // Every subscribed customer whose LATEST order went quiet, however long ago
    // (Bright: "any customers who ghosted us in the past"), once it is quietDays old.
    const reasons = new Set(t.quietReasons ?? []);
    for (const person of byContact.values()) {
      const key = person.stats?.key ?? phoneKey(person.contact!.phone);
      if (!key) continue;
      const mine = ordersOf(key);
      const latest = mine[mine.length - 1];
      if (!latest) continue;
      const reason = quietReason(latest.status, latest.outcome);
      if (!reason || (reasons.size && !reasons.has(reason))) continue;
      const cross = Date.parse(latest.createdAt) + (t.quietDays ?? 1) * DAY_MS;
      if (cross > nowMs) continue;
      // A flow that repeats (the monthly reminder) gets a fresh key each day it may start again.
      const entryKey = auto.settings.reentry ? `quiet:${latest.id}:${lagosDay(nowMs)}` : `quiet:${latest.id}`;
      out.push({ key: entryKey, person, atMs: cross, label: `Went quiet: ${QUIET_REASON_LABELS[reason]}`, triggerOrderId: latest.id });
    }
  }
  return out;
}

/** Is this customer in the group (auto rules, or a fixed list)? */
function inGroup(world: World, row: World["segmentRows"][number], person: World["people"][number]) {
  return row.kind === "fixed"
    ? !!person.contact && row.contactIds.includes(person.contact.id)
    : segmentMatches(person, { match: row.match, conditions: row.conditions, exclude: row.excludeOn ? row.exclude : [] }, world.ctx);
}

async function recentCarts(branchId: string, sinceMs: number) {
  const { data, error } = await supabase.from("abandoned_carts").select("id, phone, email, created_at, status, product_id")
    .eq("branch_id", branchId).gte("created_at", new Date(sinceMs).toISOString()).order("created_at", { ascending: true }).limit(5000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Brings in the customers whose trigger just happened, for every running automation of a branch. */
async function enrollBranch(orgId: string, branchId: string, autos: Automation[], nowMs: number) {
  const world = await engineWorld(orgId, branchId);
  // Who is already walking a flow of this branch, and in which (for priority).
  const active = await fetchAllRowsOrThrow<any>(() => supabase.from("email_automation_runs").select("automation_id, email").eq("branch_id", branchId).eq("status", "active"));
  const rankOf = new Map(autos.map((auto) => [auto.id, PRIORITY_RANK[auto.settings.priority]]));
  // Group flows ("Customer Is In a Segment"): one at a time per customer, the
  // lowest rank first, so someone in several groups gets one stay-in-touch flow.
  const groupFlow = new Set(autos.filter((auto) => auto.trigger.kind === "in_segment").map((auto) => auto.id));
  const inGroupFlow = new Set(active.filter((run) => groupFlow.has(run.automation_id)).map((run) => run.email));
  const ordered = [...autos].sort((a, b) => (a.trigger.kind === "in_segment" ? a.trigger.rank ?? 50 : -1) - (b.trigger.kind === "in_segment" ? b.trigger.rank ?? 50 : -1));
  let added = 0;
  for (const auto of ordered) {
    if (!firstNodeId(auto.workflow)) continue;
    let candidates = await candidatesFor(auto, branchId, world, nowMs);
    if (!candidates.length) continue;
    if (auto.audience.source !== "all") {
      const allowed = new Set(resolveAudience(world.people, auto.audience, world.segments, world.ctx).recipients.map((person) => person.key));
      candidates = candidates.filter((row) => allowed.has(row.person.key));
    }
    if (auto.enrollment.on && auto.enrollment.conditions.length) {
      candidates = candidates.filter((row) => segmentMatches(row.person, { match: auto.enrollment.match, conditions: auto.enrollment.conditions }, world.ctx));
    }
    const myRank = PRIORITY_RANK[auto.settings.priority];
    const busyHigher = new Set(active.filter((run) => run.automation_id !== auto.id && (rankOf.get(run.automation_id) ?? 1) > myRank).map((run) => run.email));
    candidates = candidates.filter((row) => !busyHigher.has(row.person.contact!.email));
    if (groupFlow.has(auto.id)) candidates = candidates.filter((row) => !inGroupFlow.has(row.person.contact!.email));
    if (!candidates.length) continue;
    // Their earlier walks through this automation, for re-entry and limits.
    const emails = [...new Set(candidates.map((row) => row.person.contact!.email))];
    const past = await selectByIdBatches<any>(emails, (batch) => supabase.from("email_automation_runs").select("email, status, entered_at, entry_key").eq("automation_id", auto.id).in("email", batch));
    const keys = new Set(past.map((run) => run.entry_key));
    const pastBy = new Map<string, Array<{ status: string; enteredMs: number }>>();
    for (const run of past) pastBy.set(run.email, [...(pastBy.get(run.email) ?? []), { status: run.status, enteredMs: Date.parse(run.entered_at) }]);
    const first = firstNodeId(auto.workflow);
    const rows: any[] = [];
    // One event per customer per pass: the earliest one.
    for (const row of [...candidates].sort((a, b) => a.atMs - b.atMs)) {
      const email = row.person.contact!.email;
      if (keys.has(row.key) || rows.some((other) => other.email === email)) continue;
      const history = pastBy.get(email) ?? [];
      if (!mayEnter(auto.settings, history, nowMs)) continue;
      rows.push({
        org_id: orgId, branch_id: branchId, automation_id: auto.id, contact_id: row.person.contact!.id, email, phone: row.person.contact!.phone,
        name: row.person.contact!.name || row.person.stats?.name || "", entry_key: row.key, entry_no: history.length + 1, node_id: first,
        next_at: new Date(nowMs).toISOString(), history: [{ at: new Date(nowMs).toISOString(), note: `Entered: ${row.label}`, order: row.triggerOrderId ?? null }]
      });
    }
    if (!rows.length) continue;
    const { error } = await supabase.from("email_automation_runs").upsert(rows, { onConflict: "automation_id,entry_key", ignoreDuplicates: true });
    if (error) { logger.warn("automation enrol failed", { automationId: auto.id, error: error.message }); continue; }
    if (groupFlow.has(auto.id)) for (const row of rows) inGroupFlow.add(row.email);
    added += rows.length;
  }
  return added;
}

const MAX_STEPS_PER_PASS = 25;

/** Moves one customer along until a wait (or the end). */
async function advanceRun(run: any, auto: Automation, world: () => Promise<World>, nowMs: number) {
  const now = new Date(nowMs).toISOString();
  const history: any[] = Array.isArray(run.history) ? [...run.history] : [];
  const note = (text: string) => history.push({ at: now, note: text });
  const patch: Record<string, unknown> = {};
  let nodeId: string | null = run.node_id;
  let nextAt = nowMs;
  let status = "active";
  let exitReason: string | null = null;
  const enteredMs = Date.parse(run.entered_at);
  const triggerOrder = history.find((row) => row.order)?.order ?? null;
  const w = await world();
  const contact = w.contacts.find((row) => row.id === run.contact_id) ?? null;
  const key = phoneKey(run.phone ?? contact?.phone);
  const person = (contact && w.people.find((row) => row.contact?.id === contact.id)) || null;
  const newOrders = () => (key ? w.orders.filter((order) => order.id !== triggerOrder && phoneKey(order.phone) === key && Date.parse(order.createdAt) > enteredMs) : []);

  // Ways out before the next step.
  if (auto.settings.exit.onUnsubscribe && contact && contact.status !== "subscribed") { status = "exited"; exitReason = "Unsubscribed"; }
  else if (auto.settings.exit.onPurchase && newOrders().length) { status = "exited"; exitReason = "Made a new purchase"; }
  else if (auto.trigger.kind === "in_segment" && person && (() => { const row = w.segmentRows.find((item) => item.id === auto.trigger.segmentId); return !row || row.status !== "active" || !inGroup(w, row, person); })()) { status = "exited"; exitReason = "Left the group"; }
  else if (auto.trigger.kind === "went_quiet" && triggerOrder && w.orders.some((order) => order.id === triggerOrder && order.status === "Delivered")) { status = "exited"; exitReason = "Their order was delivered"; }
  else if (auto.settings.exit.afterDays && nowMs - enteredMs >= auto.settings.exit.afterDays * DAY_MS) { status = "exited"; exitReason = `Reached the ${auto.settings.exit.afterDays}-day limit`; }

  for (let i = 0; status === "active" && i < MAX_STEPS_PER_PASS; i += 1) {
    if (!nodeId) { status = "completed"; break; }
    const node = findNode(auto.workflow, nodeId);
    if (!node) { status = "exited"; exitReason = "Its step was taken out of the flow"; break; }
    if (node.type === "wait") {
      nodeId = nextNodeId(auto.workflow, node.id);
      nextAt = nowMs + waitMs(node);
      note(`Waiting ${stepName(node)?.replace(/^Wait /, "")}`);
      break;
    }
    if (node.type === "email") {
      if (!inSendWindow(nowMs, auto.settings.sendWindow)) { nextAt = nextWindowStart(nowMs, auto.settings.sendWindow); break; }
      if (auto.settings.payday && nextPaydayMs(nowMs) > nowMs) {
        nextAt = nextPaydayMs(nowMs);
        note(`"${node.name}" waits for payday (the 25th)`);
        break;
      }
      if (!node.campaignId) { note(`Skipped "${node.name}": the email was not saved`); nodeId = nextNodeId(auto.workflow, node.id); continue; }
      if (!contact || contact.status !== "subscribed") { note(`Not emailed "${node.name}": no longer subscribed`); nodeId = nextNodeId(auto.workflow, node.id); continue; }
      const { data: sent, error } = await supabase.from("email_campaign_sends").upsert({
        org_id: run.org_id, branch_id: run.branch_id, campaign_id: node.campaignId, run_no: run.entry_no, kind: "main", contact_id: contact.id,
        email: contact.email, name: contact.name || run.name || "", phone: contact.phone, variant: "a", token: newToken()
      }, { onConflict: "campaign_id,run_no,kind,email", ignoreDuplicates: true }).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (sent?.id) patch.last_send_id = sent.id;
      note(`Email "${node.name}" sent to the queue`);
      nodeId = nextNodeId(auto.workflow, node.id);
      continue;
    }
    if (node.type === "condition") {
      const lastSendId = (patch.last_send_id as string | undefined) ?? run.last_send_id;
      const last = lastSendId ? (await supabase.from("email_campaign_sends").select("first_opened_at, first_clicked_at").eq("id", lastSendId).maybeSingle()).data : null;
      const segment = (id: string) => {
        const row = w.segmentRows.find((item) => item.id === id);
        if (!row || !person) return false;
        return row.kind === "fixed" ? !!contact && row.contactIds.includes(contact.id) : segmentMatches(person, { match: row.match, conditions: row.conditions, exclude: row.excludeOn ? row.exclude : [] }, w.ctx);
      };
      const met = checkMet(node.check, {
        placedOrderSince: newOrders().length > 0,
        deliveredSince: newOrders().some((order) => order.status === "Delivered"),
        openedLast: !!last?.first_opened_at, clickedLast: !!last?.first_clicked_at,
        reviewed: !!person?.stats?.reviewed,
        inSegment: segment,
        hasTag: (tagId) => !!person && !!w.ctx.hasTag?.(person, tagId)
      });
      note(`${node.name || "Check"}: ${met ? "Yes" : "No"}`);
      nodeId = branchNodeId(auto.workflow, node.id, met);
      continue;
    }
    if (node.type === "tag") {
      if (contact) {
        const { error } = node.action === "add"
          ? await supabase.from("email_contact_tags").upsert({ org_id: run.org_id, branch_id: run.branch_id, contact_id: contact.id, tag_id: node.tagId }, { onConflict: "contact_id,tag_id", ignoreDuplicates: true })
          : await supabase.from("email_contact_tags").delete().eq("contact_id", contact.id).eq("tag_id", node.tagId);
        if (error) note(`Tag step failed: ${error.message}`); else { note(stepName(node)!); forgetWorld(run.branch_id); }
      }
      nodeId = nextNodeId(auto.workflow, node.id);
      continue;
    }
    if (node.type === "list") {
      if (contact) {
        const { data: list } = await supabase.from("email_segments").select("contact_ids, kind").eq("id", node.listId).eq("branch_id", run.branch_id).maybeSingle();
        if (list?.kind === "fixed") {
          const ids = Array.isArray(list.contact_ids) ? list.contact_ids : [];
          if (!ids.includes(contact.id)) await supabase.from("email_segments").update({ contact_ids: [...ids, contact.id], updated_at: now }).eq("id", node.listId);
          note(stepName(node)!);
          forgetWorld(run.branch_id);
        } else note(`List step skipped: "${node.listName}" is not an uploaded list any more`);
      }
      nodeId = nextNodeId(auto.workflow, node.id);
      continue;
    }
    status = "completed";
    nodeId = null;
  }
  if (status !== "active") note(status === "completed" ? "Finished the flow" : `Left: ${exitReason}`);
  const { error } = await supabase.from("email_automation_runs").update({
    ...patch, node_id: nodeId, next_at: new Date(nextAt).toISOString(), status, exit_reason: exitReason,
    finished_at: status === "active" ? null : now, history: history.slice(-60)
  }).eq("id", run.id).eq("status", "active");
  if (error) throw new Error(error.message);
}

let lastEnrollMs = 0;
let engineRunning = false;

/** Every minute (from the email job): bring new customers in (every 10 minutes) and move everyone along. */
export async function runAutomations(nowMs: number) {
  if (engineRunning) return;
  engineRunning = true;
  try {
    // A light look first: most minutes nothing is due, and a flow's emails are big.
    const { data: live, error } = await supabase.from("email_automations").select("id").eq("status", "active");
    if (error) throw new Error(error.message);
    const ids = (live ?? []).map((row: any) => row.id as string);
    if (!ids.length) return;
    const full = async (wanted: string[]) => {
      if (!wanted.length) return [];
      const { data: rows, error: rowsError } = await supabase.from("email_automations").select("*").in("id", wanted).eq("status", "active");
      if (rowsError) throw new Error(rowsError.message);
      return (rows ?? []).map((row: any) => ({ ...automationRow(row), orgId: row.org_id as string, branchId: row.branch_id as string }));
    };
    const byId = new Map<string, Awaited<ReturnType<typeof full>>[number]>();
    // Bring new customers in first, so their first step runs in this same minute.
    if (nowMs - lastEnrollMs >= 10 * 60_000) {
      lastEnrollMs = nowMs;
      const autos = await full(ids);
      for (const auto of autos) byId.set(auto.id, auto);
      const branches = new Map<string, typeof autos>();
      for (const auto of autos) branches.set(`${auto.orgId}|${auto.branchId}`, [...(branches.get(`${auto.orgId}|${auto.branchId}`) ?? []), auto]);
      for (const [key, list] of branches) {
        const [orgId, branchId] = key.split("|");
        try { await enrollBranch(orgId, branchId, list, nowMs); } catch (err) { logger.warn("automation enrol failed", { branchId, error: (err as Error).message }); }
      }
    }
    const { data: due, error: dueError } = await supabase.from("email_automation_runs").select("*").eq("status", "active").lte("next_at", new Date(nowMs).toISOString())
      .in("automation_id", ids).order("next_at", { ascending: true }).limit(200);
    if (dueError) throw new Error(dueError.message);
    for (const auto of await full([...new Set((due ?? []).map((run: any) => run.automation_id as string))].filter((id) => !byId.has(id)))) byId.set(auto.id, auto);
    const worlds = new Map<string, Promise<World>>();
    for (const run of due ?? []) {
      const auto = byId.get(run.automation_id);
      if (!auto) continue;
      const world = () => { if (!worlds.has(run.branch_id)) worlds.set(run.branch_id, engineWorld(auto.orgId, auto.branchId)); return worlds.get(run.branch_id)!; };
      try { await advanceRun(run, auto, world, nowMs); } catch (err) { logger.warn("automation step failed", { runId: run.id, error: (err as Error).message }); }
    }
  } catch (error) {
    logger.error("automations crashed", { error: (error as Error).message });
  } finally {
    engineRunning = false;
  }
}

/** For tests and the local check: forget the engine's cached customers. */
export const forgetEngine = () => { engineWorlds.clear(); lastEnrollMs = 0; };
