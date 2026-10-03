import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Check, CheckCircle2, Clock, FileText, Gift, Pause, Pencil, Play, Plus, ShieldCheck, Star, X } from "lucide-react";
import { teamChallengesApi, type TeamChallengeDetail, type TeamChallengeEntry, type TeamChallengeInput } from "../../lib/api";
import {
  CATEGORY_LABEL, ChallengeHeader, EntryPill, Kpi, PrizeTable, TeamRaceCard, contributionText, dateTime, naira, shortDate, toneOf, upgradeText
} from "./TeamChallengeParts";

// Team Challenges - manager / owner page, built to Bright's first design
// (3 Oct 2026). Every number comes from the verified score ledger: nobody
// types a team total. The Owner approves the personally funded budget before
// reps see it, approves every payout and is the only one who can change the
// rules of a running challenge (with a reason, as a new rule version).

type Tab = "race" | "teams" | "verification" | "rewards" | "rules" | "log";
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "race", label: "Live race" }, { key: "teams", label: "Teams & reps" }, { key: "verification", label: "Verification" },
  { key: "rewards", label: "Rewards" }, { key: "rules", label: "Rules & settings" }, { key: "log", label: "Activity log" }
];

export default function TeamChallengesManager({ role, onToast }: { role: string; onToast: (message: string) => void }) {
  const [list, setList] = useState<Array<{ id: string; name: string; status: string; phase: string; sellFrom: string; sellTo: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamChallengeDetail | null>(null);
  const [tab, setTab] = useState<Tab>("race");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<"new" | "edit" | null>(null);
  const owner = role === "Owner";

  const loadList = useCallback(async () => {
    try {
      const result = await teamChallengesApi.list();
      setList(result.challenges);
      setSelected((current) => current && result.challenges.some((row) => row.id === current) ? current : (result.challenges.find((row) => row.status !== "closed") ?? result.challenges[0])?.id ?? null);
      setError("");
    } catch (err: any) { setError(err?.message ?? "Couldn't load the team challenges."); }
    finally { setLoading(false); }
  }, []);
  const loadDetail = useCallback(async () => {
    if (!selected) { setDetail(null); return; }
    try { setDetail(await teamChallengesApi.detail(selected)); setError(""); }
    catch (err: any) { setError(err?.message ?? "Couldn't load the challenge."); }
  }, [selected]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { void loadDetail(); }, [loadDetail]);
  const run = async (action: () => Promise<unknown>, done: string) => {
    try { await action(); onToast(done); await loadList(); await loadDetail(); }
    catch (err: any) { onToast(`Couldn't do that: ${err?.message ?? "please try again."}`); }
  };

  const pendingCount = detail ? detail.entries.filter((row) => row.status === "awaiting_verification" || (row.status === "correction_requested" && row.reviewRequestedAt) || (owner && row.escalatedAt)).length : 0;
  const c = detail?.challenge;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="m-0 text-[22px] font-black text-gray-900 dark:text-slate-50">Team Challenges</h2>
          <p className="m-0 text-[13.5px] text-gray-500">Build the competition. Track every win.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {list.length > 1 ? (
            <select value={selected ?? ""} onChange={(event) => setSelected(event.target.value)} className="!h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13px] font-semibold dark:border-slate-700 dark:bg-slate-900">
              {list.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.status})</option>)}
            </select>
          ) : null}
          {detail && c?.status !== "closed" ? <button type="button" onClick={() => setEditing("edit")} className="!min-h-[40px] inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-bold text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><Pencil className="h-4 w-4" />Edit challenge</button> : null}
          <button type="button" onClick={() => setEditing("new")} className="!min-h-[40px] inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 text-[13px] font-bold text-white shadow-sm"><Plus className="h-4 w-4" />New challenge</button>
        </div>
      </div>

      {error ? <p className="m-0 rounded-xl bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      {loading ? <p className="m-0 rounded-2xl bg-white px-5 py-10 text-center text-[13px] text-gray-500 dark:bg-slate-900">Loading challenges…</p> : null}
      {!loading && list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-violet-200 bg-white px-5 py-10 text-center dark:bg-slate-900">
          <Star className="mx-auto h-8 w-8 text-violet-300" />
          <p className="m-0 mt-2 text-[15px] font-black text-gray-900 dark:text-slate-100">No team challenge yet</p>
          <p className="m-0 mt-1 text-[13px] text-gray-500">Set up two teams, the points table and the prizes. The Owner approves the budget before reps see it.</p>
          <button type="button" onClick={() => setEditing("new")} className="!min-h-[40px] mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 text-[13px] font-bold text-white"><Plus className="h-4 w-4" />New challenge</button>
        </div>
      ) : null}

      {detail && c ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
          <ChallengeHeader detail={detail} right={
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:border-l lg:border-gray-200 lg:pl-6">
              <div>
                <p className="m-0 text-[13px] text-gray-500">First team to reach</p>
                <p className="m-0 text-[20px] font-black text-violet-700">{c.milestones[0]?.target ?? 0} verified points</p>
              </div>
              {c.status === "draft" ? (
                owner
                  ? <button type="button" onClick={() => { if (window.confirm(`Approve the personally funded prize budget of ${naira(c.maxBudget)} and publish this challenge to the reps?`)) void run(() => teamChallengesApi.publish(c.id), "Challenge published."); }} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 text-[13px] font-bold text-white"><ShieldCheck className="h-4 w-4" />Approve {naira(c.maxBudget)} & publish</button>
                  : <span className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-bold text-amber-800">Waiting for the Owner to approve the budget</span>
              ) : c.status === "closed" ? null : c.status === "paused" ? (
                <button type="button" onClick={() => void run(() => teamChallengesApi.setStatus(c.id, "active"), "Challenge resumed.")} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl border-2 border-emerald-200 px-4 text-[13px] font-bold text-emerald-700"><Play className="h-4 w-4" />Resume challenge</button>
              ) : (
                <button type="button" onClick={() => { const reason = window.prompt("Why pause the challenge? The reps will see it is paused."); if (reason !== null) void run(() => teamChallengesApi.setStatus(c.id, "paused", reason), "Challenge paused."); }} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl border-2 border-rose-200 px-4 text-[13px] font-bold text-rose-600"><Pause className="h-4 w-4" />Pause challenge</button>
              )}
            </div>
          } />

          <div className="-mx-1 mt-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-1 dark:border-slate-700" role="tablist">
            {TABS.map((item) => (
              <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
                className={`!min-h-[44px] inline-flex shrink-0 items-center gap-2 border-b-2 px-4 text-[13.5px] font-semibold ${tab === item.key ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500 hover:text-gray-800"}`}>
                {item.label}{item.key === "verification" && pendingCount > 0 ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-black text-white">{pendingCount}</span> : null}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === "race" ? <RaceTab detail={detail} /> : null}
            {tab === "teams" ? <TeamsTab detail={detail} /> : null}
            {tab === "verification" ? <VerificationTab detail={detail} owner={owner}
              onAdjust={(entry, amount, reason) => run(() => teamChallengesApi.adjust(c.id, entry.id, amount, reason), "Contribution adjusted.")}
              onEscalate={(entry, note) => run(() => teamChallengesApi.escalate(c.id, entry.id, note), "Sent to the Owner.")}
              onDecide={(entry, action, note) => run(() => teamChallengesApi.decide(c.id, entry.id, action, note), action === "verify" ? `Order #${entry.orderId} verified.` : action === "correction" ? "Correction requested." : "Order excluded.")} /> : null}
            {tab === "rewards" ? <RewardsTab detail={detail} owner={owner}
              onApprove={(teamId, key) => run(() => teamChallengesApi.approvePayout(c.id, teamId, key), "Payout approved.")}
              onPaid={(payoutId, reference) => run(() => teamChallengesApi.markPaid(c.id, payoutId, reference), "Marked paid.")} /> : null}
            {tab === "rules" ? <RulesTab detail={detail} owner={owner} onEdit={() => setEditing("edit")}
              onBaseline={() => run(() => teamChallengesApi.baseline(c.id), "Baseline calculated.")}
              onClose={() => { if (window.confirm("Close this challenge? No more orders will count.")) void run(() => teamChallengesApi.setStatus(c.id, "closed"), "Challenge closed."); }}
              onDelete={() => { if (window.confirm("Delete this draft?")) void run(async () => { await teamChallengesApi.remove(c.id); setSelected(null); }, "Draft deleted."); }} /> : null}
            {tab === "log" ? <LogTab detail={detail} /> : null}
          </div>
        </section>
      ) : null}

      {editing ? (
        <ChallengeEditor detail={editing === "edit" ? detail : null} onClose={() => setEditing(null)}
          onSave={async (body) => {
            if (editing === "edit" && detail) { await teamChallengesApi.update(detail.challenge.id, body); onToast("Challenge saved."); }
            else { const created = await teamChallengesApi.create(body); setSelected(created.id); onToast("Draft created. The Owner approves the budget to publish it."); }
            setEditing(null);
            await loadList();
            await loadDetail();
          }} />
      ) : null}
    </div>
  );
}

function RaceTab({ detail }: { detail: TeamChallengeDetail }) {
  const k = detail.kpis;
  const verified = detail.entries.filter((row) => row.status === "verified").sort((a, b) => Date.parse(b.qualifiedAt ?? b.updatedAt) - Date.parse(a.qualifiedAt ?? a.updatedAt));
  const teamOf = new Map(detail.teams.map((team) => [team.id, team]));
  const top = detail.challenge.milestones[detail.challenge.milestones.length - 1];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <Kpi icon={<Check className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" label="Verified points" value={k.verifiedPoints} sub={`${k.verifiedOrders} delivered & paid order${k.verifiedOrders === 1 ? "" : "s"}`} hint="Only manager-verified orders count." />
        <Kpi icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-500" label="Awaiting delivery" value={k.awaitingDelivery} sub="Not delivered or not paid yet" />
        <Kpi icon={<BarChart3 className="h-5 w-5" />} tone="bg-blue-50 text-blue-600" label="Added contribution" value={naira(k.addedContribution)} sub={`${naira(k.addedRevenue)} extra revenue · ${k.verifiedOrders} verified`} hint="Extra amount collected minus added product cost, delivery, rep bonus, packaging and gifts." />
        <Kpi icon={<Gift className="h-5 w-5" />} tone="bg-rose-50 text-rose-500" label="Prize budget" value={naira(k.prizeBudget)} sub="Maximum, Owner personally funded" hint="Winner + other team at the top milestone." />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {detail.teams.map((team) => <TeamRaceCard key={team.id} team={team} milestones={detail.challenge.milestones} leaderTeamId={detail.race.leaderTeamId} gap={detail.race.gap} />)}
      </div>
      <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="m-0 flex items-center gap-2 text-[15px] font-black text-gray-900 dark:text-slate-50"><Gift className="h-5 w-5" />Challenge prizes</p><p className="m-0 text-[12.5px] text-gray-500">Hit the milestones to win. Delivered, paid and verified orders only.</p></div>
          {top ? <div className="rounded-xl bg-violet-50 px-3 py-2 text-right dark:bg-violet-500/10"><p className="m-0 text-[12px] font-bold text-violet-700">Win both milestones</p><p className="m-0 text-[18px] font-black text-violet-800 dark:text-violet-200">{naira(top.winnerAmount)} <span className="text-[12px] font-semibold">total for the team</span></p></div> : null}
        </div>
        <div className="mt-3"><PrizeTable milestones={detail.challenge.milestones} memberCount={2} perRep={false} /></div>
        <p className="m-0 mt-2 text-[12px] text-gray-500">Maximum budget {naira(detail.challenge.maxBudget)}: winner {top ? naira(top.winnerAmount) : ""} + other team {top ? naira(top.runnerUpAmount) : ""}. Split equally between team members, paid separately from commission.</p>
      </div>
      <div className="rounded-2xl border border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2 px-4 pt-4"><FileText className="h-5 w-5 text-gray-500" /><div><p className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-50">Latest verified wins</p><p className="m-0 text-[12px] text-gray-500">Most recent delivered, paid and verified orders.</p></div></div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full !min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500 dark:bg-slate-800"><tr>{["Order", "Rep", "Team", "Product", "What was added", "Points", "Contribution", "Qualified"].map((h) => <th key={h} className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
            <tbody>
              {verified.slice(0, 8).map((row) => {
                const team = teamOf.get(row.teamId ?? "");
                return (
                  <tr key={row.id} className="border-t border-gray-100 dark:border-slate-800">
                    <td className="px-3 py-2.5 font-bold">#{row.orderId}</td><td className="px-3 py-2.5">{row.repName}</td>
                    <td className="px-3 py-2.5">{team ? <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-bold ${toneOf(team.color).soft}`}>{team.name}</span> : "—"}</td>
                    <td className="px-3 py-2.5">{row.product ?? "—"}</td><td className="px-3 py-2.5">{upgradeText(row)}</td>
                    <td className="px-3 py-2.5 font-black">{row.verifiedPoints ?? row.points}</td><td className="px-3 py-2.5">{naira(row.contribution ?? 0)}</td><td className="px-3 py-2.5 text-gray-500">{dateTime(row.qualifiedAt)}</td>
                  </tr>
                );
              })}
              {verified.length === 0 ? <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">No verified wins yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TeamsTab({ detail }: { detail: TeamChallengeDetail }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {detail.teams.map((team) => {
        const tone = toneOf(team.color);
        return (
          <div key={team.id} className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
            <p className={`m-0 text-[15px] font-black ${tone.text}`}>{team.name} · {team.points} points · {team.orders} verified transactions</p>
            <p className="m-0 text-[12.5px] text-gray-700 dark:text-slate-300">{team.onePoint} one-point + {team.twoPoint} two-point = {team.onePoint + team.twoPoint * 2} points · {naira(team.contribution)} added contribution · {team.zeroPoint} below the 1-point level</p>
            <p className="m-0 text-[12px] text-gray-500">{team.awaitingDelivery} awaiting delivery · {team.awaitingPayment} awaiting payment · {team.awaitingVerification} awaiting verification · added {naira(team.addedValue)}</p>
            <div className="mt-3 space-y-2">
              {team.members.map((member) => {
                const share = team.points > 0 ? Math.round((member.points / team.points) * 100) : 0;
                return (
                  <div key={member.id} className="rounded-xl bg-gray-50 p-3 dark:bg-slate-800">
                    <div className="flex items-center justify-between gap-2"><strong className="text-[14px]">{member.name}</strong><span className="text-[14px] font-black">{member.points} pts · {share}%</span></div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-700"><div className={`h-full ${tone.bar}`} style={{ width: `${share}%` }} /></div>
                    <p className="m-0 mt-1.5 text-[12px] text-gray-500">{member.orders} verified · {member.onePoint} × 1-pt · {member.twoPoint} × 2-pt · {naira(member.contribution)} contribution · {member.upsells} upsells · {member.crossSells} cross-sells · {member.pending} in progress</p>
                  </div>
                );
              })}
            </div>
            <p className="m-0 mt-2 text-[11.5px] text-gray-500">Teams are locked once the challenge starts; points never move with a rep.</p>
          </div>
        );
      })}
    </div>
  );
}

function VerificationTab({ detail, owner, onDecide, onAdjust, onEscalate }: {
  detail: TeamChallengeDetail; owner: boolean;
  onDecide: (entry: TeamChallengeEntry, action: "verify" | "correction" | "exclude", note?: string) => Promise<void>;
  onAdjust: (entry: TeamChallengeEntry, amount: number, reason: string) => Promise<void>;
  onEscalate: (entry: TeamChallengeEntry, note: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<"queue" | "progress" | "done" | "owner" | "all">(owner && detail.entries.some((row) => row.escalatedAt) ? "owner" : "queue");
  const [open, setOpen] = useState<string | null>(null);
  const rows = detail.entries.filter((row) => filter === "all" ? true
    : filter === "owner" ? Boolean(row.escalatedAt)
    : filter === "queue" ? row.status === "awaiting_verification" || row.status === "correction_requested"
    : filter === "progress" ? row.status === "awaiting_delivery" || row.status === "awaiting_payment"
    : ["verified", "excluded", "reversed"].includes(row.status))
    .sort((a, b) => Date.parse(a.qualifiedAt ?? a.updatedAt) - Date.parse(b.qualifiedAt ?? b.updatedAt));
  const teamOf = new Map(detail.teams.map((team) => [team.id, team]));
  const ask = (entry: TeamChallengeEntry, action: "correction" | "exclude") => {
    const note = window.prompt(action === "correction" ? "What does the rep need to correct or add?" : "Why is this order excluded? The rep will see this.");
    if (note && note.trim().length >= 3) void onDecide(entry, action, note.trim());
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {([["queue", "To verify"], ["owner", `With the Owner (${detail.entries.filter((row) => row.escalatedAt).length})`], ["progress", "Not delivered / paid yet"], ["done", "Decided"], ["all", "All"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key)} className={`!min-h-[36px] rounded-full px-3.5 text-[12.5px] font-bold ${filter === key ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200"}`}>{label}</button>
        ))}
      </div>
      <p className="m-0 mt-2 text-[12px] text-gray-500">Oldest qualification first: the race is decided by when an order was delivered and paid, not by when it is reviewed.</p>
      <ul className="m-0 mt-3 list-none space-y-2 p-0">
        {rows.map((entry) => {
          const team = teamOf.get(entry.teamId ?? "");
          const isOpen = open === entry.id;
          return (
            <li key={entry.id} className="rounded-xl border border-gray-200 dark:border-slate-700">
              <button type="button" onClick={() => setOpen(isOpen ? null : entry.id)} className="!min-h-[56px] flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-3 text-left">
                <strong className="text-[14px]">#{entry.orderId}</strong>
                <span className="text-[13px] text-gray-700 dark:text-slate-300">{entry.repName}</span>
                {team ? <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${toneOf(team.color).soft}`}>{team.name}</span> : null}
                <span className="text-[13px] text-gray-600">{upgradeText(entry)}</span>
                <span className="ml-auto flex flex-wrap items-center gap-2">{entry.escalatedAt ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700">With the Owner</span> : null}<span className="text-[12.5px] text-gray-600">{contributionText(entry)}</span><EntryPill status={entry.status} /></span>
              </button>
              {isOpen ? (
                <div className="border-t border-gray-100 px-3.5 py-3 dark:border-slate-800">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800">
                      <p className="m-0 text-[11px] font-black uppercase tracking-wide text-gray-500">Original order (locked)</p>
                      <p className="m-0 mt-1 text-[13px]">{entry.original?.quantity ?? "?"} × {entry.product ?? "item"}{entry.original?.amount ? ` · ${naira(entry.original.amount)}` : ""}</p>
                      <p className="m-0 mt-1 text-[12px] text-gray-500">No challenge points</p>
                    </div>
                    <div className="rounded-lg bg-emerald-50 p-3 dark:bg-emerald-500/10">
                      <p className="m-0 text-[11px] font-black uppercase tracking-wide text-emerald-700">After the rep's call</p>
                      <p className="m-0 mt-1 text-[13px]">{entry.revised?.quantity ?? "?"} × {entry.product ?? "item"} · {naira(entry.revised?.amount ?? 0)}</p>
                      {(entry.revised?.crossSells ?? []).map((line, index) => <p key={index} className="m-0 text-[12.5px]">+ {line.quantity} × {line.product} · {naira(line.amount)}</p>)}
                      <p className="m-0 mt-1 text-[12px] font-bold text-emerald-800">{entry.final ? "Amount collected" : "Order value"} {naira(entry.revised?.amount ?? 0)}</p>
                    </div>
                  </div>
                  {entry.breakdown ? (
                    <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-slate-700">
                      <table className="w-full !min-w-0 text-[12.5px]"><tbody>
                        {([["Additional revenue", entry.breakdown.revenue, 1], ["Added product cost", entry.breakdown.productCost, -1], ["Extra delivery cost", entry.breakdown.logistics, -1], ["Rep bonus", entry.breakdown.repBonus, -1], ["Packaging", entry.breakdown.packaging, -1], ["Gifts", entry.breakdown.gifts, -1]] as const).map(([label, value, sign]) => (
                          <tr key={label} className="border-b border-gray-100 dark:border-slate-800"><td className="px-3 py-1.5 text-gray-600 dark:text-slate-300">{label}</td><td className="px-3 py-1.5 text-right">{sign < 0 && value > 0 ? "−" : ""}{naira(value)}</td></tr>
                        ))}
                        {entry.breakdown.adjustment ? <tr className="border-b border-gray-100 dark:border-slate-800"><td className="px-3 py-1.5 text-gray-600">Manager adjustment{entry.adjustmentReason ? ` (${entry.adjustmentReason}, ${entry.adjustmentBy ?? ""})` : ""}</td><td className="px-3 py-1.5 text-right">{entry.breakdown.adjustment > 0 ? "+" : "−"}{naira(Math.abs(entry.breakdown.adjustment))}</td></tr> : null}
                        <tr className="bg-gray-50 font-bold dark:bg-slate-800"><td className="px-3 py-2">{entry.final ? "Final" : "Potential"} added contribution</td><td className="px-3 py-2 text-right">{naira(entry.contribution ?? 0)} → {entry.points} pt{entry.points === 1 ? "" : "s"}</td></tr>
                      </tbody></table>
                      {!entry.final ? <p className="m-0 px-3 py-1.5 text-[11.5px] text-gray-500">Potential: the rep bonus and final amount are counted once delivered and paid.</p> : null}
                    </div>
                  ) : null}
                  <p className="m-0 mt-2 text-[12.5px] text-gray-700 dark:text-slate-300">
                    {CATEGORY_LABEL[entry.category]} · <strong>{entry.points} points</strong> ({entry.ruleLabel}, rules v{entry.ruleVersion}) · added {naira(entry.addedValue)}<br />
                    Customer {entry.customer ?? "—"} · delivered {dateTime(entry.deliveredAt)} · paid {dateTime(entry.paidAt)} · <strong>qualified {dateTime(entry.qualifiedAt)}</strong>
                  </p>
                  {entry.reason ? <p className="m-0 mt-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900">{entry.reason}{entry.decidedBy ? ` (${entry.decidedBy}, ${dateTime(entry.decidedAt)})` : ""}</p> : null}
                  {entry.repNote ? <p className="m-0 mt-1.5 rounded-lg bg-blue-50 px-2.5 py-1.5 text-[12.5px] text-blue-900">Rep: "{entry.repNote}"</p> : null}
                  {entry.escalatedAt ? <p className="m-0 mt-1.5 rounded-lg bg-violet-50 px-2.5 py-1.5 text-[12.5px] text-violet-900">Escalated to the Owner: "{entry.escalationNote}"{owner ? "" : " - the Owner decides it."}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {owner && entry.escalatedAt && entry.status === "verified" ? <button type="button" onClick={() => void onDecide(entry, "verify")} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 text-[13px] font-bold text-white"><CheckCircle2 className="h-4 w-4" />Keep verified</button> : null}
                    {["awaiting_verification", "correction_requested", "excluded"].includes(entry.status) && entry.deliveredAt && entry.paidAt && (owner || !entry.escalatedAt) ? (
                      <button type="button" onClick={() => void onDecide(entry, "verify")} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 text-[13px] font-bold text-white"><CheckCircle2 className="h-4 w-4" />Verify {entry.points} points</button>
                    ) : null}
                    {entry.status === "awaiting_verification" ? <button type="button" onClick={() => ask(entry, "correction")} className="!min-h-[44px] rounded-xl border border-amber-300 px-4 text-[13px] font-bold text-amber-800">Request correction</button> : null}
                    {!["excluded", "reversed"].includes(entry.status) ? <button type="button" onClick={() => {
                      const amount = window.prompt("Adjustment to the contribution in ₦ (e.g. -2000 if the upgrade raised delivery by ₦2,000):", String(entry.adjustment || ""));
                      if (amount === null || !Number.isFinite(Number(amount))) return;
                      const reason = window.prompt("Reason (recorded in the activity log):");
                      if (reason && reason.trim().length >= 5) void onAdjust(entry, Number(amount), reason.trim());
                    }} className="!min-h-[44px] rounded-xl border border-gray-300 px-4 text-[13px] font-bold">Adjust contribution</button> : null}
                    {!owner && !entry.escalatedAt && !["excluded", "reversed"].includes(entry.status) ? <button type="button" onClick={() => { const note = window.prompt("What should the Owner look at?"); if (note && note.trim().length >= 3) void onEscalate(entry, note.trim()); }} className="!min-h-[44px] rounded-xl border border-violet-300 px-4 text-[13px] font-bold text-violet-700">Escalate to Owner</button> : null}
                    {!["excluded", "reversed"].includes(entry.status) ? <button type="button" onClick={() => ask(entry, "exclude")} className="!min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-4 text-[13px] font-bold text-rose-600"><X className="h-4 w-4" />{entry.status === "verified" ? "Reverse" : "Exclude"}</button> : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
        {rows.length === 0 ? <li className="rounded-xl bg-gray-50 px-4 py-6 text-center text-[13px] text-gray-500 dark:bg-slate-800">Nothing here.</li> : null}
      </ul>
    </div>
  );
}

function RewardsTab({ detail, owner, onApprove, onPaid }: { detail: TeamChallengeDetail; owner: boolean; onApprove: (teamId: string, key: string) => Promise<void>; onPaid: (payoutId: string, reference?: string) => Promise<void> }) {
  const totals = detail.teams.reduce((acc, team) => ({ entitled: acc.entitled + team.entitled, paid: acc.paid + team.paid }), { entitled: 0, paid: 0 });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi icon={<Gift className="h-5 w-5" />} tone="bg-violet-50 text-violet-600" label="Maximum budget" value={naira(detail.challenge.maxBudget)} />
        <Kpi icon={<Star className="h-5 w-5" />} tone="bg-amber-50 text-amber-500" label="Earned so far" value={naira(totals.entitled)} />
        <Kpi icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" label="Paid" value={naira(totals.paid)} />
        <Kpi icon={<Clock className="h-5 w-5" />} tone="bg-rose-50 text-rose-500" label="Still to pay" value={naira(totals.entitled - totals.paid)} />
      </div>
      {detail.teams.map((team) => (
        <div key={team.id} className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
          <p className={`m-0 text-[15px] font-black ${toneOf(team.color).text}`}>{team.name}</p>
          {team.reconciliation ? <p className="m-0 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-800">Prize reconciliation exception: {naira(team.reconciliation.paid)} paid but the verified ledger now entitles {naira(team.reconciliation.entitled)} ({naira(team.reconciliation.over)} over), after a return or reversal. The payment record is kept; nothing is deducted automatically. Owner review needed.</p> : null}
          <div className="mt-2 space-y-2">
            {team.entitlements.map((item) => (
              <div key={item.key} className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3 dark:bg-slate-800 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[13.5px] font-bold">{item.target} points: {!item.reached ? "not reached yet" : item.place === "winner" ? "first team" : item.place === "tie" ? "tie (split equally)" : "second team"}{item.provisional ? " · provisional" : ""}</p>
                  <p className="m-0 text-[12px] text-gray-500">
                    {item.reached ? <>Entitled to {naira(item.entitlement)} total · owed now {naira(item.step)} (after earlier payments)</> : "—"}
                    {item.payout ? <> · approved {naira(item.payout.amount)} ({item.payout.perRep.map((share) => `${share.name} ${naira(share.amount)}`).join(", ")}){item.payout.paidAt ? ` · paid ${dateTime(item.payout.paidAt)}${item.payout.reference ? ` · ref ${item.payout.reference}` : ""}` : ""}</> : null}
                  </p>
                  {item.provisional ? <p className="m-0 text-[12px] font-semibold text-amber-700">Earlier qualifying orders are still waiting for verification - verify those before approving.</p> : null}
                </div>
                {owner && item.reached && item.step > 0 && !item.payout ? <button type="button" disabled={item.provisional} onClick={() => { if (window.confirm(`Approve ${naira(item.step)} for ${team.name}, split equally?`)) void onApprove(team.id, item.key); }} className="!min-h-[44px] rounded-xl bg-violet-600 px-4 text-[13px] font-bold text-white disabled:opacity-40">Approve {naira(item.step)}</button> : null}
                {owner && item.payout && !item.payout.paidAt ? <button type="button" onClick={() => { const reference = window.prompt("Transfer reference (optional)") ?? undefined; void onPaid(item.payout!.id, reference || undefined); }} className="!min-h-[44px] rounded-xl bg-emerald-600 px-4 text-[13px] font-bold text-white">Mark paid</button> : null}
                {item.payout?.paidAt ? <span className="inline-flex items-center gap-1 text-[12.5px] font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Paid</span> : null}
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="m-0 text-[12px] text-gray-500">Payouts are worked out from the verified ledger and approved by the Owner. They are never mixed into commission or salary; a later reversal is recorded, never deducted automatically.</p>
    </div>
  );
}

function RulesTab({ detail, owner, onEdit, onClose, onDelete, onBaseline }: { detail: TeamChallengeDetail; owner: boolean; onEdit: () => void; onClose: () => void; onDelete: () => void; onBaseline: () => Promise<void> }) {
  const c = detail.challenge;
  const [working, setWorking] = useState(false);
  const teamName = new Map(detail.teams.map((team) => [team.id, team.name]));
  return (
    <div className="space-y-3 text-[13px] text-gray-700 dark:text-slate-300">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
          <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">Dates</p>
          <p className="m-0 mt-1">Selling: {shortDate(c.sellFrom)} – {shortDate(c.sellTo)}</p>
          <p className="m-0">Delivery completion: until {shortDate(c.graceUntil)} ({c.graceDays} days)</p>
          <p className="m-0 text-[12px] text-gray-500">An upgrade made by {shortDate(c.sellTo)} counts if it is delivered and paid by {shortDate(c.graceUntil)}. Africa/Lagos time.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
          <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">Points by added contribution (rules v{c.ruleVersion})</p>
          <p className="m-0 mt-1">Below {naira(c.scoring.onePointFrom)}: <strong>0 points</strong> (still shown)</p>
          <p className="m-0">{naira(c.scoring.onePointFrom)} – {naira(c.scoring.twoPointsFrom - 1)}: <strong>1 point</strong></p>
          <p className="m-0">{naira(c.scoring.twoPointsFrom)} and above: <strong>2 points</strong></p>
          <p className="m-0 mt-1 text-[12px] text-gray-500">Added contribution = additional amount collected − added product cost (Product Master, on the order's day) − extra delivery cost − the rep's upsell/cross-sell bonus − packaging ({naira(c.scoring.packagingPerUnit)} per added unit) − gifts. One transaction, one score, two points at most{c.scoring.productIds.length ? ` · ${c.scoring.productIds.length} eligible products` : " · all products"}.</p>
        </div>
      </div>
      <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
        <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">Prizes (cumulative)</p>
        <div className="mt-2"><PrizeTable milestones={c.milestones} memberCount={2} perRep={false} /></div>
        <p className="m-0 mt-2 text-[12px] text-gray-500">Each milestone has its own winner. Rewards are totals: earlier payments are taken off the next one. An exact tie splits winner + other-team amounts equally.</p>
      </div>
      <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
        <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">What counts</p>
        <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5">
          <li>The rep added a paid product or upgraded the quantity on the call; the original order is kept to compare.</li>
          <li>The order was placed in the selling period and is delivered and paid by the end of the delivery period.</li>
          <li>One order has one owner; a manager verifies it before it counts. Cancelled, failed or held orders never count; a verified order that is later cancelled is reversed with its reason.</li>
          <li>The race is timed by when each order was delivered and paid, never by when it was reviewed.</li>
        </ul>
      </div>
      <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">Historical baseline</p><p className="m-0 text-[12px] text-gray-500">The three months before the challenge, run through the same rule (delivered and paid orders, added contribution → points). The challenge should beat this.</p></div>
          <button type="button" disabled={working} onClick={async () => { setWorking(true); try { await onBaseline(); } finally { setWorking(false); } }} className="!min-h-[40px] rounded-xl border border-gray-200 px-3 text-[12.5px] font-bold disabled:opacity-50">{working ? "Calculating…" : c.baseline ? "Recalculate" : "Calculate baseline"}</button>
        </div>
        {c.baseline ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full !min-w-[420px] text-left text-[12.5px]">
              <thead className="text-[11px] uppercase text-gray-500"><tr><th className="py-1.5 pr-3">Month</th><th className="py-1.5 pr-3">Transactions</th><th className="py-1.5 pr-3">Points</th><th className="py-1.5 pr-3">Contribution</th><th className="py-1.5">By team</th></tr></thead>
              <tbody>
                {c.baseline.months.map((row) => (
                  <tr key={row.month} className="border-t border-gray-100 dark:border-slate-800"><td className="py-1.5 pr-3 font-bold">{row.month}</td><td className="py-1.5 pr-3">{row.transactions}</td><td className="py-1.5 pr-3 font-bold">{row.points}</td><td className="py-1.5 pr-3">{naira(row.contribution)}</td>
                    <td className="py-1.5">{Object.entries(row.byTeam).map(([id, value]) => `${teamName.get(id) ?? "Team"} ${value.points}`).join(" · ") || "—"}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 mt-1.5 text-[12.5px] font-bold">Average: {c.baseline.averagePoints} points a month (both teams). Targets: {c.milestones.map((m) => m.target).join(" / ")} per team.</p>
          </div>
        ) : null}
      </div>
      {c.approvedAt ? <p className="m-0 text-[12px] text-gray-500">Budget approved by {c.approvedBy} on {dateTime(c.approvedAt)}.</p> : null}
      <div className="flex flex-wrap gap-2">
        {c.status !== "closed" ? <button type="button" onClick={onEdit} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 text-[13px] font-bold"><Pencil className="h-4 w-4" />{c.status === "draft" ? "Edit draft" : owner ? "Change rules (Owner)" : "View settings"}</button> : null}
        {owner && c.status !== "draft" && c.status !== "closed" ? <button type="button" onClick={onClose} className="!min-h-[44px] rounded-xl border border-rose-200 px-4 text-[13px] font-bold text-rose-600">Close challenge</button> : null}
        {c.status === "draft" ? <button type="button" onClick={onDelete} className="!min-h-[44px] rounded-xl border border-rose-200 px-4 text-[13px] font-bold text-rose-600">Delete draft</button> : null}
      </div>
    </div>
  );
}

const LOG_LABEL: Record<string, string> = {
  draft_created: "Draft created", draft_edited: "Draft edited", published: "Budget approved and published", rules_changed: "Rules changed",
  status_paused: "Paused", status_active: "Resumed", status_closed: "Closed", entry_verified: "Order verified", entry_excluded: "Order excluded",
  entry_correction_requested: "Correction requested", entry_reversed: "Score reversed", score_reversed: "Score reversed (order changed)",
  review_requested: "Rep asked for a review", contribution_adjusted: "Contribution adjusted", escalation_resolved: "Escalation resolved by the Owner", escalated_to_owner: "Escalated to the Owner", baseline_calculated: "Baseline calculated", rep_responded: "Rep responded", payout_approved: "Payout approved", payout_paid: "Payout paid"
};

function LogTab({ detail }: { detail: TeamChallengeDetail }) {
  return (
    <ul className="m-0 list-none space-y-2 p-0">
      {detail.log.map((row) => {
        const d = (row.detail ?? {}) as Record<string, any>;
        const extra = [d.orderId ? `#${d.orderId}` : null, d.points ? `${d.points} pts` : null, d.amount ? naira(Number(d.amount)) : null, d.team ?? null, d.reason ?? null, d.note ?? null, d.reference ? `ref ${d.reference}` : null].filter(Boolean).join(" · ");
        return (
          <li key={row.id} className="flex flex-col gap-0.5 rounded-xl border border-gray-200 px-3.5 py-2.5 text-[13px] dark:border-slate-700 sm:flex-row sm:items-center sm:gap-3">
            <span className="w-36 shrink-0 text-[12px] text-gray-500">{dateTime(row.at)}</span>
            <span className="font-bold">{LOG_LABEL[row.action] ?? row.action}</span>
            <span className="min-w-0 flex-1 text-gray-600 dark:text-slate-300">{extra}</span>
            <span className="text-[12px] text-gray-500">{row.actor ?? "Protohub"}</span>
          </li>
        );
      })}
      {detail.log.length === 0 ? <li className="text-[13px] text-gray-500">Nothing yet.</li> : null}
    </ul>
  );
}

function ChallengeEditor({ detail, onClose, onSave }: { detail: TeamChallengeDetail | null; onClose: () => void; onSave: (body: TeamChallengeInput) => Promise<void> }) {
  const running = Boolean(detail && detail.challenge.status !== "draft");
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof teamChallengesApi.meta>> | null>(null);
  const today = new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);
  const plus = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState<TeamChallengeInput>(() => detail ? {
    name: detail.challenge.name, sellFrom: detail.challenge.sellFrom, sellTo: detail.challenge.sellTo, graceDays: detail.challenge.graceDays,
    milestones: detail.challenge.milestones.map((row) => ({ target: row.target, winnerAmount: row.winnerAmount, runnerUpAmount: row.runnerUpAmount, minPerMember: row.minPerMember })),
    scoring: detail.challenge.scoring, sponsorNote: detail.challenge.sponsorNote ?? undefined,
    teams: detail.teams.map((team) => ({ id: team.id, name: team.name, color: team.color, memberIds: team.members.map((member) => member.id) }))
  } : {
    name: "Upsell & Cross-Sell Race", sellFrom: today, sellTo: plus(29), graceDays: 7,
    milestones: [{ target: 50, winnerAmount: 50000, runnerUpAmount: 10000, minPerMember: 10 }, { target: 100, winnerAmount: 150000, runnerUpAmount: 40000, minPerMember: 20 }],
    scoring: { onePointFrom: 10000, twoPointsFrom: 50000, packagingPerUnit: 500, productIds: [] },
    teams: [{ name: "Team A", color: "violet", memberIds: [] }, { name: "Team B", color: "teal", memberIds: [] }]
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void teamChallengesApi.meta().then(setMeta).catch(() => setMeta({ reps: [], products: [], defaults: { milestones: [], scoring: form.scoring } })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const top = [...form.milestones].sort((a, b) => a.target - b.target).slice(-1)[0];
  const budget = top ? top.winnerAmount + top.runnerUpAmount : 0;
  const taken = useMemo(() => new Map(form.teams.flatMap((team, index) => team.memberIds.map((id) => [id, index] as const))), [form.teams]);
  const field = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[13.5px] dark:border-slate-700 dark:bg-slate-900";
  const setTeam = (index: number, patch: Partial<TeamChallengeInput["teams"][number]>) => setForm({ ...form, teams: form.teams.map((team, i) => (i === index ? { ...team, ...patch } : team)) });
  const save = async () => {
    setSaving(true); setError("");
    try { await onSave(form); } catch (err: any) { setError(err?.message ?? "Couldn't save."); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-50">{detail ? (running ? "Change a running challenge" : "Edit draft") : "New team challenge"}</h3>
            <p className="m-0 text-[12.5px] text-gray-500">{running ? "Only the Owner can change a running challenge. It becomes a new rule version and the reps are told why; teams stay locked." : "Everything can change while it is a draft. The Owner approves the budget to publish."}</p>
          </div>
          <button type="button" onClick={onClose} className="!min-h-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 space-y-4">
          <label className="block"><span className="mb-1 block text-[12.5px] font-bold">Name</span><input className={field} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block"><span className="mb-1 block text-[12.5px] font-bold">Selling starts</span><input type="date" className={field} value={form.sellFrom} onChange={(event) => setForm({ ...form, sellFrom: event.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-[12.5px] font-bold">Selling ends</span><input type="date" className={field} value={form.sellTo} onChange={(event) => setForm({ ...form, sellTo: event.target.value })} /></label>
            <label className="block"><span className="mb-1 block text-[12.5px] font-bold">Delivery completion (days)</span><input type="number" min={0} max={30} className={field} value={form.graceDays} onChange={(event) => setForm({ ...form, graceDays: Number(event.target.value) })} /></label>
          </div>
          <div>
            <p className="m-0 text-[13px] font-black">Teams {running ? <span className="font-normal text-gray-500">(locked)</span> : null}</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {form.teams.map((team, index) => (
                <div key={index} className={`rounded-2xl border-2 p-3 ${toneOf(team.color).ring}`}>
                  <div className="flex gap-2">
                    <input className={field} value={team.name} onChange={(event) => setTeam(index, { name: event.target.value })} />
                    <select className={`${field} !w-28`} value={team.color} onChange={(event) => setTeam(index, { color: event.target.value })}>{["violet", "teal", "amber", "sky"].map((color) => <option key={color} value={color}>{color}</option>)}</select>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(meta?.reps ?? []).map((rep) => {
                      const on = team.memberIds.includes(rep.id);
                      const elsewhere = taken.has(rep.id) && taken.get(rep.id) !== index;
                      return (
                        <button key={rep.id} type="button" disabled={running || elsewhere} onClick={() => setTeam(index, { memberIds: on ? team.memberIds.filter((id) => id !== rep.id) : [...team.memberIds, rep.id] })}
                          className={`!min-h-[36px] rounded-full px-3 text-[12.5px] font-bold ${on ? toneOf(team.color).soft : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"} disabled:opacity-40`}>{on ? "✓ " : ""}{rep.name}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="m-0 text-[13px] font-black">Milestones and prizes (team totals, cumulative)</p>
            <div className="mt-2 space-y-2">
              {form.milestones.map((milestone, index) => (
                <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <label className="block"><span className="mb-1 block text-[11.5px] text-gray-500">Target points</span><input type="number" min={1} className={field} value={milestone.target} onChange={(event) => setForm({ ...form, milestones: form.milestones.map((row, i) => (i === index ? { ...row, target: Number(event.target.value) } : row)) })} /></label>
                  <label className="block"><span className="mb-1 block text-[11.5px] text-gray-500">First team (₦ total)</span><input type="number" min={0} className={field} value={milestone.winnerAmount} onChange={(event) => setForm({ ...form, milestones: form.milestones.map((row, i) => (i === index ? { ...row, winnerAmount: Number(event.target.value) } : row)) })} /></label>
                  <label className="block"><span className="mb-1 block text-[11.5px] text-gray-500">Other team (₦ total)</span><input type="number" min={0} className={field} value={milestone.runnerUpAmount} onChange={(event) => setForm({ ...form, milestones: form.milestones.map((row, i) => (i === index ? { ...row, runnerUpAmount: Number(event.target.value) } : row)) })} /></label>
                  <label className="block"><span className="mb-1 block text-[11.5px] text-gray-500">Min. points per member</span><input type="number" min={0} className={field} value={milestone.minPerMember} onChange={(event) => setForm({ ...form, milestones: form.milestones.map((row, i) => (i === index ? { ...row, minPerMember: Number(event.target.value) } : row)) })} /></label>
                </div>
              ))}
            </div>
            <p className="m-0 mt-2 rounded-xl bg-violet-50 px-3 py-2 text-[13px] font-bold text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">Maximum prize budget: {naira(budget)} <span className="font-normal">(top milestone: first team + other team)</span></p>
          </div>
          <div>
            <p className="m-0 text-[13px] font-black">Points by added contribution</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([["onePointFrom", "1 point from (₦)"], ["twoPointsFrom", "2 points from (₦)"], ["packagingPerUnit", "Packaging per added unit (₦)"]] as const).map(([key, label]) => (
                <label key={key} className="block"><span className="mb-1 block text-[11.5px] text-gray-500">{label}</span><input type="number" min={0} className={field} value={form.scoring[key]} onChange={(event) => setForm({ ...form, scoring: { ...form.scoring, [key]: Number(event.target.value) } })} /></label>
              ))}
            </div>
            <p className="m-0 mt-1 text-[11.5px] text-gray-500">Added contribution = additional amount collected − added product cost − extra delivery − rep bonus − packaging − gifts. Below the 1-point level scores 0; a transaction scores two points at most.</p>
          </div>
          {running ? <label className="block"><span className="mb-1 block text-[12.5px] font-bold">Reason for the change (the reps see it)</span><input className={field} value={form.reason ?? ""} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label> : null}
          {error ? <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="!min-h-[44px] rounded-xl border border-gray-200 px-4 text-[13px] font-bold">Cancel</button>
            <button type="button" disabled={saving} onClick={() => void save()} className="!min-h-[44px] rounded-xl bg-violet-600 px-5 text-[13px] font-bold text-white disabled:opacity-50">{saving ? "Saving…" : detail ? "Save" : "Create draft"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
