import { useCallback, useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Clock, ExternalLink, FileText, Info, ListChecks, Star, Truck, Users } from "lucide-react";
import { teamChallengesApi, type TeamChallengeDetail, type TeamChallengeEntry } from "../../lib/api";
import { CATEGORY_LABEL, ChallengeHeader, plural, ENTRY_STATUS, EntryPill, Kpi, PrizeTable, TeamRaceCard, dateTime, naira, shortDate, upgradeText } from "./TeamChallengeParts";

// Team Challenges - the sales rep's page (Bright's second design, 3 Oct
// 2026). The rep sees both team standings, their own contribution and their
// OWN orders only (never the rival team's customers), what they can still
// win on both reward paths, and what they have earned, approved and been paid.

type Tab = "race" | "contribution" | "orders" | "rewards";

export default function TeamChallengesRep({ onToast, onOpenOrders, onOpenFollowUps, onOpenScripts }: {
  onToast: (message: string) => void; onOpenOrders: () => void; onOpenFollowUps: () => void; onOpenScripts?: () => void;
}) {
  const [list, setList] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<TeamChallengeDetail | null>(null);
  const [tab, setTab] = useState<Tab>("race");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [responding, setResponding] = useState<TeamChallengeEntry | null>(null);

  useEffect(() => {
    void teamChallengesApi.list().then((result) => {
      setList(result.challenges);
      setSelected((result.challenges.find((row) => row.status === "active") ?? result.challenges[0])?.id ?? null);
    }).catch((err: any) => setError(err?.message ?? "Couldn't load the team challenges.")).finally(() => setLoading(false));
  }, []);
  const load = useCallback(async () => {
    if (!selected) return;
    try { setDetail(await teamChallengesApi.detail(selected)); setError(""); }
    catch (err: any) { setError(err?.message ?? "Couldn't load the challenge."); }
  }, [selected]);
  useEffect(() => { void load(); }, [load]);

  const myTeam = detail?.teams.find((team) => team.id === detail.me.teamId) ?? null;
  const me = myTeam?.members.find((member) => member.id === detail?.me.id) ?? null;
  const mine = detail?.entries ?? [];
  const awaitingDelivery = mine.filter((row) => row.status === "awaiting_delivery" || row.status === "awaiting_payment").length;
  const awaitingVerification = mine.filter((row) => row.status === "awaiting_verification" || row.status === "correction_requested").length;
  const contribution = myTeam && myTeam.points > 0 && me ? Math.round((me.points / myTeam.points) * 100) : 0;
  const memberCount = myTeam?.members.length || 2;
  const myShare = (amount: number) => Math.round(amount / Math.max(1, memberCount));

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-transparent px-5 py-4 lg:flex-row lg:items-center lg:justify-between dark:border-slate-700 dark:from-slate-800">
        <div>
          <p className="m-0 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.14em] text-indigo-600"><span className="h-2 w-2 rounded-full bg-indigo-500" />Sales rep portal</p>
          <h1 className="m-0 text-[24px] font-black text-gray-900 dark:text-slate-50">Team Challenges</h1>
          <p className="m-0 text-[13.5px] text-gray-500">Your contribution. Your team. Your next win.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setTab("rewards")} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-[13px] font-bold text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><Info className="h-4 w-4" />Challenge rules</button>
          <button type="button" onClick={onOpenOrders} className="!min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 text-[13px] font-bold text-white"><ExternalLink className="h-4 w-4" />Open my orders</button>
        </div>
      </header>

      {error ? <p className="m-0 rounded-xl bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      {loading ? <p className="m-0 rounded-2xl bg-white px-5 py-10 text-center text-[13px] text-gray-500 dark:bg-slate-900">Loading…</p> : null}
      {!loading && list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-violet-200 bg-white px-5 py-10 text-center dark:bg-slate-900">
          <Star className="mx-auto h-8 w-8 text-violet-300" />
          <p className="m-0 mt-2 text-[15px] font-black text-gray-900 dark:text-slate-100">No team challenge for you right now</p>
          <p className="m-0 mt-1 text-[13px] text-gray-500">When your manager starts one and puts you on a team, it shows here.</p>
        </div>
      ) : null}

      {detail ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-5">
          <ChallengeHeader detail={detail} right={
            <div className="lg:border-l lg:border-gray-200 lg:pl-6">
              <p className="m-0 text-[13px] font-semibold text-gray-700 dark:text-slate-200">First-to-reach race</p>
              <p className="m-0 text-[12.5px] text-gray-500">Every delivered, paid and verified win moves your team forward.</p>
            </div>
          } />
          <div className="-mx-1 mt-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-1 dark:border-slate-700" role="tablist">
            {([["race", "Live race"], ["contribution", "My contribution"], ["orders", "My qualifying orders"], ["rewards", "Rewards & rules"]] as const).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`!min-h-[44px] shrink-0 border-b-2 px-4 text-[13.5px] font-semibold ${tab === key ? "border-violet-600 text-violet-700" : "border-transparent text-gray-500"}`}>{label}</button>
            ))}
          </div>

          {tab === "race" ? (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
                <Kpi icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" label="My verified points" value={me?.points ?? 0} sub={`${plural(me?.upsells ?? 0, "upsell")} · ${plural(me?.crossSells ?? 0, "cross-sell")}`} hint="Only manager-verified, delivered and paid orders count." />
                <Kpi icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-600" label="My team contribution" value={`${contribution}%`} sub={`${me?.points ?? 0} of ${myTeam?.points ?? 0} team points`} />
                <Kpi icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-500" label="Awaiting delivery" value={awaitingDelivery} sub="Not counted yet" />
                <Kpi icon={<FileText className="h-5 w-5" />} tone="bg-violet-50 text-violet-600" label="Awaiting verification" value={awaitingVerification} sub="Delivered + paid" />
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {detail.teams.map((team) => <TeamRaceCard key={team.id} team={team} milestones={detail.challenge.milestones} leaderTeamId={detail.race.leaderTeamId} gap={detail.race.gap} mine={team.id === detail.me.teamId} meId={detail.me.id} />)}
              </div>
              <WhatYouCanWin detail={detail} myShare={myShare} />
              <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <OrdersTable entries={mine.slice(0, 6)} onRespond={setResponding} compact />
                <div className="space-y-3">
                  <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                    <p className="m-0 flex items-center gap-2 text-[14px] font-black"><Truck className="h-5 w-5" />Keep your team moving</p>
                    <p className="m-0 mt-1 text-[12.5px] text-gray-500">{awaitingDelivery} of your order{awaitingDelivery === 1 ? "" : "s"} awaiting delivery or payment. Help get them delivered and paid.</p>
                    <button type="button" onClick={onOpenFollowUps} className="!min-h-[44px] mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-[13px] font-bold text-white">Open follow-ups <ArrowRight className="h-4 w-4" /></button>
                  </div>
                  {onOpenScripts ? (
                    <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                      <p className="m-0 flex items-center gap-2 text-[14px] font-black"><ListChecks className="h-5 w-5" />Approved selling scripts</p>
                      <p className="m-0 mt-1 text-[12.5px] text-gray-500">Use proven scripts to find more upsell and cross-sell opportunities.</p>
                      <button type="button" onClick={onOpenScripts} className="!min-h-[44px] mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-violet-300 px-4 text-[13px] font-bold text-violet-700">Open Scripts Hub <ArrowRight className="h-4 w-4" /></button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "contribution" ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Kpi icon={<Star className="h-5 w-5" />} tone="bg-violet-50 text-violet-600" label="My points" value={me?.points ?? 0} />
                <Kpi icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" label="Verified orders" value={me?.orders ?? 0} />
                <Kpi icon={<Users className="h-5 w-5" />} tone="bg-blue-50 text-blue-600" label="Share of team" value={`${contribution}%`} />
                <Kpi icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-500" label="In progress" value={me?.pending ?? 0} />
              </div>
              <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
                <p className="m-0 text-[14px] font-black">Where my points came from</p>
                {(["upsell", "both", "cross_sell"] as const).map((category) => {
                  const rows = mine.filter((row) => row.status === "verified" && row.category === category);
                  const points = rows.reduce((sum, row) => sum + (row.verifiedPoints ?? row.points), 0);
                  return <p key={category} className="m-0 mt-2 flex justify-between text-[13px]"><span>{CATEGORY_LABEL[category]} · {rows.length} order{rows.length === 1 ? "" : "s"}</span><strong>{points} pts</strong></p>;
                })}
                <p className="m-0 mt-3 text-[12px] text-gray-500">Teammates: {myTeam?.members.filter((member) => member.id !== detail.me.id).map((member) => `${member.name} ${member.points} pts`).join(" · ") || "—"}</p>
              </div>
            </div>
          ) : null}

          {tab === "orders" ? <div className="mt-4"><OrdersTable entries={mine} onRespond={setResponding} /></div> : null}

          {tab === "rewards" ? (
            <div className="mt-4 space-y-3">
              <RewardStatus detail={detail} myShare={myShare} />
              <WhatYouCanWin detail={detail} myShare={myShare} />
              <div className="rounded-2xl border border-gray-200 p-4 text-[13px] text-gray-700 dark:border-slate-700 dark:text-slate-300">
                <p className="m-0 text-[14px] font-black text-gray-900 dark:text-slate-50">Challenge rules (v{detail.challenge.ruleVersion})</p>
                <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5">
                  <li>Points: cross-sell {detail.challenge.scoring.crossSell}, upgrade by one unit {detail.challenge.scoring.upgradePlusOne}, by two or more {detail.challenge.scoring.upgradePlusTwo}. One order scores once, at its highest. Free gifts never count.</li>
                  <li>Selling {shortDate(detail.challenge.sellFrom)} – {shortDate(detail.challenge.sellTo)}; orders must be delivered and paid by {shortDate(detail.challenge.graceUntil)}.</li>
                  <li>An order counts only when it is delivered, paid and verified by your manager. A cancelled or returned order is reversed with its reason.</li>
                  <li>Each milestone has its own winner, timed by when the order was delivered and paid. Prizes are team totals split equally, paid separately from commission.</li>
                </ul>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {responding && detail ? <RespondModal entry={responding} onClose={() => setResponding(null)} onSend={async (note, review) => {
        try { await teamChallengesApi.respond(detail.challenge.id, responding.id, note, review); onToast("Sent to your manager."); setResponding(null); await load(); }
        catch (err: any) { onToast(`Couldn't send: ${err?.message ?? "please try again."}`); }
      }} /> : null}
    </div>
  );
}

function WhatYouCanWin({ detail, myShare }: { detail: TeamChallengeDetail; myShare: (amount: number) => number }) {
  const milestones = detail.challenge.milestones;
  const top = milestones[milestones.length - 1];
  const team = detail.teams.find((row) => row.id === detail.me.teamId);
  return (
    <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 text-[15px] font-black text-gray-900 dark:text-slate-50">What you can win</p>
        <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11.5px] font-bold text-blue-700">Equal team split</span>
      </div>
      <p className="m-0 text-[12.5px] text-gray-500">Prizes unlock only when your team reaches the milestone. Paid separately from normal commission.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <PrizeTable milestones={milestones} memberCount={team?.members.length || 2} perRep />
        {top ? (
          <div className="rounded-xl bg-violet-50 p-4 dark:bg-violet-500/10">
            <p className="m-0 text-[13px] font-bold text-violet-700">Win both milestones</p>
            <p className="m-0 text-[24px] font-black text-violet-800 dark:text-violet-100">{naira(myShare(top.winnerAmount))}</p>
            <p className="m-0 text-[12px] text-violet-700">total potential for you</p>
            <p className="m-0 mt-2 text-[12px] text-gray-600 dark:text-slate-300">If the other team gets there first, reaching {top.target} still pays you {naira(myShare(top.runnerUpAmount))} in total.</p>
            <p className="m-0 mt-2 text-[12.5px] font-bold text-gray-800 dark:text-slate-100">Challenge prize earned: {naira(myShare(team?.entitled ?? 0))}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RewardStatus({ detail, myShare }: { detail: TeamChallengeDetail; myShare: (amount: number) => number }) {
  const team = detail.teams.find((row) => row.id === detail.me.teamId);
  const top = detail.challenge.milestones[detail.challenge.milestones.length - 1];
  const mineOf = (payout: NonNullable<NonNullable<typeof team>["entitlements"][number]["payout"]>) => payout.perRep.find((share) => share.repId === detail.me.id)?.amount ?? 0;
  const awaiting = (team?.entitlements ?? []).reduce((sum, item) => sum + (item.payout && !item.payout.paidAt ? mineOf(item.payout) : 0), 0);
  const paid = (team?.entitlements ?? []).reduce((sum, item) => sum + (item.payout?.paidAt ? mineOf(item.payout) : 0), 0);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Kpi icon={<Star className="h-5 w-5" />} tone="bg-violet-50 text-violet-600" label="Potential prize" value={naira(myShare(top?.winnerAmount ?? 0))} sub="If your team wins both" />
      <Kpi icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-blue-50 text-blue-600" label="Earned entitlement" value={naira(myShare(team?.entitled ?? 0))} sub={(team?.entitlements ?? []).some((item) => item.provisional) ? "Provisional: checks pending" : "What your team qualified for"} />
      <Kpi icon={<Clock className="h-5 w-5" />} tone="bg-amber-50 text-amber-500" label="Awaiting payout" value={naira(awaiting)} sub="Approved, not paid yet" />
      <Kpi icon={<CheckCircle2 className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-600" label="Paid" value={naira(paid)} sub="Confirmed payment" />
    </div>
  );
}

function OrdersTable({ entries, onRespond, compact = false }: { entries: TeamChallengeEntry[]; onRespond: (entry: TeamChallengeEntry) => void; compact?: boolean }) {
  const [filter, setFilter] = useState<"all" | "delivery" | "verification">("all");
  const rows = entries.filter((row) => filter === "all" ? true : filter === "delivery" ? row.status === "awaiting_delivery" || row.status === "awaiting_payment" : row.status === "awaiting_verification" || row.status === "correction_requested");
  const count = (test: (row: TeamChallengeEntry) => boolean) => entries.filter(test).length;
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <div><p className="m-0 flex items-center gap-2 text-[15px] font-black"><FileText className="h-5 w-5 text-gray-500" />My qualifying orders</p><p className="m-0 text-[12px] text-gray-500">One order = one score. Delivered, paid and manager-verified orders count.</p></div>
        <div className="flex flex-wrap gap-1.5">
          {([["all", `All (${entries.length})`], ["delivery", `Awaiting delivery (${count((row) => row.status === "awaiting_delivery" || row.status === "awaiting_payment")})`], ["verification", `Awaiting verification (${count((row) => row.status === "awaiting_verification" || row.status === "correction_requested")})`]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} className={`!min-h-[32px] rounded-full px-3 text-[12px] font-bold ${filter === key ? "bg-violet-100 text-violet-700" : "bg-gray-50 text-gray-600 dark:bg-slate-800"}`}>{label}</button>
          ))}
        </div>
      </div>
      <ul className="m-0 mt-3 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-2 text-[13.5px]"><strong>#{row.orderId}</strong><span className="text-gray-600 dark:text-slate-300">{upgradeText(row)}</span><span className="font-bold">{row.points} {row.points === 1 ? "pt" : "pts"}</span><span className="text-gray-500">{naira(row.addedValue)} added</span></p>
              {!compact || row.reason ? <p className="m-0 mt-0.5 text-[12px] text-gray-500">{row.customer ?? ""}{row.qualifiedAt ? ` · qualified ${dateTime(row.qualifiedAt)}` : ""}{row.reason ? ` · ${row.reason}` : ""}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <EntryPill status={row.status} />
              {row.status === "correction_requested" || row.status === "excluded" || row.status === "reversed" ? (
                <button type="button" onClick={() => onRespond(row)} className="!min-h-[36px] rounded-lg border border-violet-300 px-3 text-[12px] font-bold text-violet-700">{row.status === "correction_requested" ? "Respond" : "Request review"}</button>
              ) : null}
            </div>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-4 py-6 text-center text-[13px] text-gray-500">No orders here yet. Upgrades and paid add-ons you record show up automatically.</li> : null}
      </ul>
      <p className="m-0 px-4 py-2 text-[11px] text-gray-400">{Object.entries(ENTRY_STATUS).filter(([, meta]) => meta.counts).map(([, meta]) => meta.label).join(", ")} orders count toward the race.</p>
    </div>
  );
}

function RespondModal({ entry, onClose, onSend }: { entry: TeamChallengeEntry; onClose: () => void; onSend: (note: string, requestReview: boolean) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const review = entry.status !== "correction_requested";
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/40 sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-t-3xl bg-white p-5 shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
        <h3 className="m-0 text-[17px] font-black">{review ? "Ask for a review" : "Respond to the correction"} · #{entry.orderId}</h3>
        {entry.reason ? <p className="m-0 mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">Manager: "{entry.reason}"</p> : null}
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} placeholder={review ? "Why should this order count?" : "What did you correct or add?"} className="mt-3 w-full rounded-xl border border-gray-200 p-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" />
        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="!min-h-[44px] rounded-xl border border-gray-200 px-4 text-[13px] font-bold">Cancel</button>
          <button type="button" disabled={sending || note.trim().length < 3} onClick={async () => { setSending(true); await onSend(note.trim(), review); setSending(false); }} className="!min-h-[44px] rounded-xl bg-violet-600 px-5 text-[13px] font-bold text-white disabled:opacity-50">{sending ? "Sending…" : "Send to manager"}</button>
        </div>
      </div>
    </div>
  );
}
