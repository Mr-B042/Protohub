import { deliver, leadershipRecipients } from "./weekly-report-notifications.js";

// Team Challenges alerts (Bright, 5 Oct 2026): a bell entry + phone push for
// the moments that change what someone should do - never a ping per point.
// Reps get their own orders and team news; managers get the work; the Owner
// gets money and escalations. A failed alert never fails the action.

const REP_LINK = "/dashboard/sales-rep/team-challenges";
const LEADER_LINK = "/dashboard/admin/manager-overview/team-challenges";
const naira = (value: number) => `₦${Math.round(value || 0).toLocaleString("en-NG")}`;

type Alert = { title: string; message: string; kind: string; tag: string; type?: "info" | "warning" | "success" };
type Ctx = { orgId: string; branchId: string; challengeId: string; name: string };

async function toReps(ctx: Ctx, repIds: string[], alert: Alert) {
  const ids = Array.from(new Set(repIds.filter(Boolean)));
  if (ids.length) await deliver(ctx.orgId, ctx.branchId, ids.map((id) => ({ id, role: "Sales Rep" })), { ...alert, link: REP_LINK });
}
async function toLeaders(ctx: Ctx, alert: Alert, ownerOnly = false) {
  const people = (await leadershipRecipients(ctx.orgId, ctx.branchId)).filter((person) => !ownerOnly || person.role === "Owner");
  if (people.length) await deliver(ctx.orgId, ctx.branchId, people, { ...alert, link: LEADER_LINK });
}

export type TeamChallengeEvent =
  | { kind: "published"; teams: Array<{ name: string; memberIds: string[]; memberNames: string[] }>; firstTarget: number; firstPrize: number; sellFrom: string; sellTo: string }
  | { kind: "rules_changed"; repIds: string[]; reason: string; ruleVersion: number }
  | { kind: "entry_decided"; repId: string; orderId: string; status: "verified" | "excluded" | "correction_requested" | "reversed"; points: number; contribution: number | null; note: string | null }
  | { kind: "entry_linked"; repId: string; orderId: string; primaryOrderId: string }
  | { kind: "rep_responded"; repName: string; orderId: string; review: boolean }
  | { kind: "escalated"; orderId: string; by: string; note: string }
  | { kind: "lead_changed"; repIds: string[]; leader: string; leaderPoints: number; other: string; otherPoints: number }
  | { kind: "milestone"; repIds: string[]; team: string; target: number; confirmed: boolean; first: boolean; amount: number }
  | { kind: "payout"; repIds: string[]; team: string; target: number; amount: number; perRep: number; paid: boolean }
  | { kind: "deadline"; repIds: string[]; which: "selling" | "delivery"; date: string; daysLeft: number; pendingVerification: number }
  | { kind: "closed"; repIds: string[]; lines: string[] }
  | { kind: "cancelled"; repIds: string[] };

export async function notifyTeamChallenge(ctx: Ctx, event: TeamChallengeEvent): Promise<void> {
  try {
    const tag = (suffix: string) => `team-challenge-${ctx.challengeId}-${suffix}`;
    switch (event.kind) {
      case "published":
        for (const team of event.teams) {
          await toReps(ctx, team.memberIds, {
            title: `Team challenge started: ${ctx.name}`,
            message: `You're on ${team.name} with ${team.memberNames.join(" + ")}. First team to ${event.firstTarget} verified points wins ${naira(event.firstPrize)}. Selling ${event.sellFrom} – ${event.sellTo}.`,
            kind: "team_challenge_started", tag: tag("started"), type: "success"
          });
        }
        return;
      case "rules_changed":
        await toReps(ctx, event.repIds, { title: `${ctx.name}: the rules changed`, message: `Rules version ${event.ruleVersion}. ${event.reason}`, kind: "team_challenge_rules", tag: tag(`rules-${event.ruleVersion}`), type: "warning" });
        return;
      case "entry_decided": {
        const titles = { verified: `Order #${event.orderId} verified: +${event.points} point${event.points === 1 ? "" : "s"}`, excluded: `Order #${event.orderId} excluded from the challenge`, correction_requested: `Order #${event.orderId} needs a correction`, reversed: `Order #${event.orderId}: points reversed` };
        const message = event.status === "verified"
          ? `${event.contribution !== null ? `Added contribution ${naira(event.contribution)}. ` : ""}It now counts for your team.`
          : `${event.note ?? ""} Open Team Challenges to see why${event.status !== "reversed" ? " or to respond" : ""}.`.trim();
        await toReps(ctx, [event.repId], { title: titles[event.status], message, kind: `team_challenge_${event.status}`, tag: tag(`entry-${event.orderId}-${event.status}`), type: event.status === "verified" ? "success" : "warning" });
        return;
      }
      case "entry_linked":
        await toReps(ctx, [event.repId], { title: `Order #${event.orderId} linked to #${event.primaryOrderId}`, message: "Same customer within the link window: the two orders are one transaction, scored once on the first order.", kind: "team_challenge_linked", tag: tag(`linked-${event.orderId}`), type: "info" });
        return;
      case "rep_responded":
        await toLeaders(ctx, { title: `${event.repName} ${event.review ? "asked for a review" : "answered a correction"} on #${event.orderId}`, message: `${ctx.name}: it's back in the Verification list.`, kind: "team_challenge_rep_response", tag: tag(`response-${event.orderId}-${Date.now()}`), type: "info" });
        return;
      case "escalated":
        await toLeaders(ctx, { title: `Order #${event.orderId} escalated to you`, message: `${event.by}: "${event.note}" (${ctx.name}). Only you can decide it now.`, kind: "team_challenge_escalated", tag: tag(`escalated-${event.orderId}`), type: "warning" }, true);
        return;
      case "lead_changed": {
        const alert = { title: `${event.leader} took the lead`, message: `${ctx.name}: ${event.leader} ${event.leaderPoints} – ${event.other} ${event.otherPoints} verified points.`, kind: "team_challenge_lead", tag: tag(`lead-${event.leader}-${event.leaderPoints}`), type: "info" as const };
        await toReps(ctx, event.repIds, alert);
        await toLeaders(ctx, alert);
        return;
      }
      case "milestone": {
        const place = event.first ? "first" : "too";
        const alert = event.confirmed
          ? { title: `${event.team} reached ${event.target} point${event.target === 1 ? "" : "s"} ${place}`, message: `${ctx.name}: confirmed. Prize ${naira(event.amount)} for the team once the Owner approves the payout.`, kind: "team_challenge_milestone", tag: tag(`milestone-${event.team}-${event.target}-confirmed`), type: "success" as const }
          : { title: `${event.team} reached ${event.target} point${event.target === 1 ? "" : "s"} (provisional)`, message: `${ctx.name}: earlier orders still need verifying before the winner is confirmed.`, kind: "team_challenge_milestone", tag: tag(`milestone-${event.team}-${event.target}-provisional`), type: "info" as const };
        await toReps(ctx, event.repIds, alert);
        await toLeaders(ctx, alert);
        return;
      }
      case "payout":
        await toReps(ctx, event.repIds, {
          title: event.paid ? `Challenge prize paid: ${naira(event.perRep)}` : `Challenge prize approved: ${naira(event.perRep)}`,
          message: `${ctx.name}: ${event.team}, ${event.target} points - ${naira(event.amount)} for the team, ${naira(event.perRep)} each.`,
          kind: "team_challenge_payout", tag: tag(`payout-${event.team}-${event.target}-${event.paid ? "paid" : "approved"}`), type: "success"
        });
        return;
      case "deadline": {
        const what = event.which === "selling" ? "Selling closes" : "The delivery period closes";
        await toReps(ctx, event.repIds, {
          title: `${ctx.name}: ${what} in ${event.daysLeft} day${event.daysLeft === 1 ? "" : "s"}`,
          message: event.which === "selling" ? `Upgrades and add-ons recorded by ${event.date} still count.` : `Orders must be delivered and paid by ${event.date} to count. Follow up on yours now.`,
          kind: "team_challenge_deadline", tag: tag(`deadline-${event.which}`), type: "warning"
        });
        if (event.which === "delivery" && event.pendingVerification > 0) {
          await toLeaders(ctx, { title: `${ctx.name}: ${event.pendingVerification} order${event.pendingVerification === 1 ? "" : "s"} to verify`, message: `The delivery period closes ${event.date}. Verify before the challenge is finalised.`, kind: "team_challenge_deadline", tag: tag("deadline-verify"), type: "warning" });
        }
        return;
      }
      case "cancelled":
        await toReps(ctx, event.repIds, { title: `${ctx.name} was cancelled`, message: "The Owner cancelled this team challenge. Your normal sales bonus is not affected.", kind: "team_challenge_cancelled", tag: tag("cancelled"), type: "warning" });
        return;
      case "closed": {
        const alert = { title: `${ctx.name} is closed`, message: event.lines.join(" · "), kind: "team_challenge_closed", tag: tag("closed"), type: "success" as const };
        await toReps(ctx, event.repIds, alert);
        await toLeaders(ctx, alert);
        return;
      }
    }
  } catch (error: any) {
    console.warn("[team-challenge-notifications] alert failed:", error?.message ?? error);
  }
}
