import type { ReactNode } from "react";
import { CalendarDays, Crown, Info, Trophy, TrendingUp } from "lucide-react";
import type { TeamChallengeDetail, TeamChallengeEntry, TeamChallengeEntryStatus, TeamChallengeMilestone, TeamChallengeTeam } from "../../lib/api";

// Team Challenges - the pieces both the manager page and the rep page use
// (Bright's two designs, 3 Oct 2026). Scores are POINTS, never "orders":
// 38 points can be 20 orders. Orders are shown separately where they matter.

export const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
export const naira = (value: number) => `₦${Math.round(value || 0).toLocaleString("en-NG")}`;
export const shortDate = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const dateTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" }) : "—");

export const TEAM_TONES: Record<string, { ring: string; bg: string; text: string; bar: string; soft: string; avatar: string }> = {
  violet: { ring: "border-violet-300", bg: "bg-violet-50/60", text: "text-violet-700", bar: "bg-violet-600", soft: "bg-violet-100 text-violet-700", avatar: "bg-violet-600 text-white" },
  teal: { ring: "border-teal-300", bg: "bg-teal-50/50", text: "text-teal-700", bar: "bg-teal-500", soft: "bg-teal-100 text-teal-700", avatar: "bg-teal-500 text-white" },
  amber: { ring: "border-amber-300", bg: "bg-amber-50/60", text: "text-amber-700", bar: "bg-amber-500", soft: "bg-amber-100 text-amber-800", avatar: "bg-amber-500 text-white" },
  sky: { ring: "border-sky-300", bg: "bg-sky-50/60", text: "text-sky-700", bar: "bg-sky-500", soft: "bg-sky-100 text-sky-700", avatar: "bg-sky-500 text-white" }
};
export const toneOf = (color: string) => TEAM_TONES[color] ?? TEAM_TONES.violet;

export const ENTRY_STATUS: Record<TeamChallengeEntryStatus, { label: string; cls: string; counts: boolean }> = {
  awaiting_delivery: { label: "Potential · awaiting delivery", cls: "bg-sky-50 text-sky-700 ring-sky-200", counts: false },
  awaiting_payment: { label: "Delivered, awaiting payment", cls: "bg-amber-50 text-amber-800 ring-amber-200", counts: false },
  awaiting_verification: { label: "Awaiting manager verification", cls: "bg-orange-50 text-orange-700 ring-orange-200", counts: false },
  verified: { label: "Verified", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", counts: true },
  correction_requested: { label: "Returned for correction", cls: "bg-rose-50 text-rose-700 ring-rose-200", counts: false },
  excluded: { label: "Excluded", cls: "bg-gray-100 text-gray-600 ring-gray-200", counts: false },
  reversed: { label: "Reversed", cls: "bg-rose-50 text-rose-700 ring-rose-200", counts: false },
  linked: { label: "Linked (same customer)", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200", counts: false }
};

export function EntryPill({ status }: { status: TeamChallengeEntryStatus }) {
  const meta = ENTRY_STATUS[status];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ring-1 ${meta.cls}`}>{meta.label}</span>;
}

export const CATEGORY_LABEL: Record<TeamChallengeEntry["category"], string> = { upsell: "Upsell", cross_sell: "Cross-sell", both: "Upsell + cross-sell" };

/** "Rack 1 → 2" / "+ Edge Brusher" - what the rep actually added. */
/** "₦14,600 → 1 pt" with Potential / Final. */
export function contributionText(entry: TeamChallengeEntry) {
  if (entry.contribution === null) return "—";
  return `${entry.final ? "Final" : "Potential"} ${naira(entry.contribution)} → ${entry.points} pt${entry.points === 1 ? "" : "s"}`;
}

export function upgradeText(entry: TeamChallengeEntry) {
  const parts: string[] = [];
  const from = entry.original?.quantity;
  const to = entry.revised?.quantity;
  if (entry.category !== "cross_sell" && from && to && to > from) parts.push(`${(entry.product ?? "Item").split(" ").slice(-1)[0]} ${from} → ${to}`);
  for (const line of entry.revised?.crossSells ?? []) parts.push(`+ ${line.product}`);
  return parts.join(" · ") || entry.ruleLabel || "—";
}

export const PHASE_LABEL: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-gray-100 text-gray-700 ring-gray-200" },
  scheduled: { label: "Starts soon", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  selling: { label: "Active", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  grace: { label: "Selling closed · Delivery completion period", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  finalising: { label: "Finalising", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  paused: { label: "Paused", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  closed: { label: "Closed", cls: "bg-gray-100 text-gray-700 ring-gray-200" }
};

export function ChallengeHeader({ detail, right }: { detail: TeamChallengeDetail; right?: ReactNode }) {
  const c = detail.challenge;
  const phase = PHASE_LABEL[c.phase] ?? PHASE_LABEL.selling;
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 sm:h-14 sm:w-14"><Trophy className="h-6 w-6 sm:h-7 sm:w-7" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[17px] font-black text-gray-900 sm:text-[19px]">{c.name}</h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-bold ring-1 ${phase.cls}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{phase.label}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-gray-500">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{shortDate(c.sellFrom)} – {shortDate(c.sellTo)}</span>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-violet-50 px-2.5 py-1 text-[12px] font-bold text-violet-700"><Crown className="h-3.5 w-3.5" />{c.sponsorNote || "Owner personally funded"}</span>
          </div>
        </div>
      </div>
      {right}
    </div>
  );
}

export function Kpi({ icon, tone, label, value, sub, hint }: { icon: ReactNode; tone: string; label: string; value: ReactNode; sub?: ReactNode; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full sm:h-11 sm:w-11 ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <p className="m-0 flex items-center gap-1 text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">{label}{hint ? <span title={hint}><Info className="h-3.5 w-3.5 text-gray-400" /></span> : null}</p>
        <p className="m-0 text-[19px] font-black leading-tight text-gray-900 dark:text-slate-50 sm:text-[22px]">{value}</p>
        {sub ? <p className="m-0 text-[11.5px] text-gray-500">{sub}</p> : null}
      </div>
    </div>
  );
}

export function TeamRaceCard({ team, milestones, leaderTeamId, gap, mine, meId }: {
  team: TeamChallengeTeam; milestones: TeamChallengeMilestone[]; leaderTeamId: string | null; gap: number; mine?: boolean; meId?: string;
}) {
  const tone = toneOf(team.color);
  const target = team.nextMilestone?.target ?? milestones[milestones.length - 1]?.target ?? 1;
  const percent = Math.min(100, Math.round((team.points / Math.max(1, target)) * 100));
  const leading = leaderTeamId === team.id;
  return (
    <div className={`rounded-2xl border-2 p-4 ${leading ? `${tone.ring} ${tone.bg}` : "border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-full text-[16px] font-black ${tone.avatar}`}>{team.name.replace(/^team\s*/i, "").slice(0, 1).toUpperCase() || "T"}</span>
          <div>
            <p className="m-0 flex items-center gap-2 text-[16px] font-black text-gray-900 dark:text-slate-50">{team.name}{mine ? <span className={`rounded-md px-2 py-0.5 text-[10.5px] font-black uppercase tracking-wide ${tone.soft}`}>Your team</span> : null}</p>
            <p className="m-0 text-[12.5px] text-gray-500">{team.members.map((member) => member.name).join(" + ")}</p>
          </div>
        </div>
        {leaderTeamId ? (
          leading
            ? <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-bold ${tone.soft}`}><Crown className="h-3.5 w-3.5" />Leading by {gap}</span>
            : <span className="inline-flex items-center gap-1.5 rounded-lg bg-teal-50 px-2.5 py-1 text-[12px] font-bold text-teal-700"><TrendingUp className="h-3.5 w-3.5" />Chasing the lead</span>
        ) : <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-[12px] font-bold text-gray-600">Level</span>}
      </div>
      <div className="mt-3 flex items-end gap-3">
        <div className="shrink-0">
          <p className="m-0 text-[12px] text-gray-500">Verified points</p>
          <p className="m-0 text-[26px] font-black leading-none text-gray-900 dark:text-slate-50">{team.points} <span className="text-[18px] text-gray-400">/ {target}</span></p>
        </div>
        <div className="min-w-0 flex-1 pb-1">
          <div className="flex justify-end text-[16px] font-black text-gray-900 dark:text-slate-100">{percent}%</div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700"><div className={`h-full rounded-full ${tone.bar} transition-all`} style={{ width: `${percent}%` }} /></div>
          <p className="m-0 mt-1 text-right text-[11.5px] text-gray-500">{team.nextMilestone ? `${team.nextMilestone.away} away from ${team.nextMilestone.target}` : "Every milestone reached"} · {team.orders} verified order{team.orders === 1 ? "" : "s"}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {team.members.map((member) => (
          <div key={member.id} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-black ${tone.soft}`}>{member.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-800 dark:text-slate-200">{member.name}</span>
            {meId === member.id ? <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${tone.soft}`}>You</span> : null}
            <span className="text-[15px] font-black text-gray-900 dark:text-slate-50">{member.points}</span>
          </div>
        ))}
      </div>
      <p className="m-0 mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-semibold text-gray-700 dark:text-slate-300"><TrendingUp className={`h-4 w-4 ${tone.text}`} />{plural(team.upsells, "upsell")} <span className="text-gray-300">|</span> {plural(team.crossSells, "cross-sell")} <span className="text-gray-300">|</span> {team.onePoint} × 1-pt · {team.twoPoint} × 2+ pt <span className="text-gray-300">|</span> {naira(team.contribution)} added contribution</p>
      {team.memberPending.map((pending) => (
        <p key={pending.key} className="m-0 mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12px] font-semibold text-amber-900">
          {pending.target} points reached: member requirement pending. {pending.short.map((item) => `${item.need} more point${item.need === 1 ? "" : "s"} needed from ${item.name}`).join("; ")} to unlock the prize.
        </p>
      ))}
    </div>
  );
}

/** Both reward paths for every milestone: the first team AND the other team. */
export function PrizeTable({ milestones, memberCount, perRep }: { milestones: TeamChallengeMilestone[]; memberCount: number; perRep: boolean }) {
  const share = (amount: number) => (perRep && memberCount > 0 ? Math.round(amount / memberCount) : amount);
  const suffix = perRep ? " your share" : "";
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {milestones.map((milestone, index) => (
        <div key={milestone.key} className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
          <div className="flex items-center gap-2.5">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${index === 0 ? "bg-amber-50 text-amber-500" : "bg-violet-50 text-violet-600"}`}><Trophy className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-300">First team to {milestone.target} points</p>
              <p className="m-0 text-[19px] font-black text-gray-900 dark:text-slate-50">{naira(share(milestone.winnerAmount))}<span className="text-[13px] font-semibold text-gray-500">{suffix}</span></p>
            </div>
          </div>
          <p className="m-0 mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-[12px] text-gray-600 dark:bg-slate-800 dark:text-slate-300">
            Other team reaching {milestone.target}: <strong>{naira(share(milestone.runnerUpAmount))}</strong>{perRep ? " your share" : ""}
            {milestone.minPerMember > 0 ? <span className="block text-[11px] text-gray-500">{perRep ? "You and your teammate" : "Both teammates"} must each score at least {milestone.minPerMember} of these {milestone.target} points - one person can't carry the team.</span> : null}
            {index > 0 ? <span className="block text-[11px] text-gray-500">Totals, not extra: earlier milestone payments are taken off.</span> : null}
          </p>
        </div>
      ))}
    </div>
  );
}

/** The end-of-challenge summary (manager Summary tab; reps see it once the challenge closes). */
export function SummaryPanel({ detail }: { detail: TeamChallengeDetail }) {
  const summary = detail.summary;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi icon={<Trophy className="h-5 w-5" />} tone="bg-violet-50 text-violet-600" label="Points" value={summary.teams.reduce((sum, team) => sum + team.points, 0)} sub={`${summary.teams.reduce((sum, team) => sum + team.transactions, 0)} verified sales`} />
        <Kpi icon={<TrendingUp className="h-5 w-5" />} tone="bg-blue-50 text-blue-600" label="Added contribution" value={naira(summary.teams.reduce((sum, team) => sum + team.contribution, 0))} sub={`${naira(summary.teams.reduce((sum, team) => sum + team.revenue, 0))} extra revenue`} />
        <Kpi icon={<Crown className="h-5 w-5" />} tone="bg-amber-50 text-amber-500" label="Prizes" value={naira(summary.entitled)} sub={`${naira(summary.paid)} paid · ${naira(summary.outstanding)} to pay`} />
        <Kpi icon={<CalendarDays className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" label="Against baseline" value={summary.uplift === null ? "—" : `${summary.uplift > 0 ? "+" : ""}${summary.uplift}%`} sub={summary.baselineMonthly === null ? "Calculate the baseline in Rules & settings" : `${summary.challengeMonthly} pts/month vs ${summary.baselineMonthly} before`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {summary.teams.map((team) => (
          <div key={team.id} className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
            <p className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-50">{team.name} · {plural(team.points, "point")}</p>
            <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-300">{plural(team.transactions, "sale")} ({team.onePoint} × 1-pt, {team.twoPoint} × 2+ pt) · {naira(team.contribution)} contribution · {team.assigned} orders assigned · {team.conversion}% turned into a scored sale</p>
            <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-300">Prize {naira(team.entitled)} · paid {naira(team.paid)} · to pay {naira(team.outstanding)}</p>
            <ul className="m-0 mt-2 list-none space-y-1 p-0">
              {team.members.map((member) => <li key={member.id} className="flex justify-between rounded-lg bg-gray-50 px-3 py-1.5 text-[12.5px] dark:bg-slate-800"><span>{member.name}</span><span className="font-bold">{plural(member.points, "pt")} · {plural(member.transactions, "sale")} · {naira(member.contribution)}</span></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-gray-200 p-4 text-[13px] dark:border-slate-700">
        <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">Milestones</p>
        {summary.milestones.map((milestone) => (
          <p key={milestone.target} className="m-0 mt-1">
            <strong>{plural(milestone.target, "point")}:</strong>{" "}
            {milestone.winners.length ? `${milestone.winners.map((row) => `${row.team} first (${dateTime(row.at)})`).join(" & ")}${milestone.others.length ? ` · then ${milestone.others.map((row) => `${row.team} (${dateTime(row.at)})`).join(", ")}` : ""}${milestone.tie ? " · tie" : ""}${milestone.provisional ? " · provisional" : ""}` : "not reached"}
          </p>
        ))}
        <p className="m-0 mt-2 text-[12.5px] text-gray-500">{summary.excluded} excluded · {summary.reversed} reversed · {summary.linked} linked into another order · maximum budget {naira(summary.maxBudget)}</p>
        {summary.exceptions.length ? (
          <details className="mt-2"><summary className="cursor-pointer text-[12.5px] font-bold">Excluded and reversed orders</summary>
            <ul className="m-0 mt-1 list-disc pl-5 text-[12.5px] text-gray-600 dark:text-slate-300">{summary.exceptions.map((row) => <li key={row.orderId}>#{row.orderId} · {row.rep} · {row.status}: {row.reason ?? "—"}</li>)}</ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
