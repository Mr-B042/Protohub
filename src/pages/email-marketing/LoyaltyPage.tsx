import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Archive, Cake, Check, ChevronRight, Coins, Crown, FileBarChart, Gift, Layers, Mail, Pause, Pencil, Play, Plus, RefreshCw, Search, Settings, Star, Ticket, Trash2,
  Undo2, UserPlus, Users, Zap
} from "lucide-react";
import DateWindowNav from "../../components/DateWindowNav";
import { emailMarketingApi, type EmDesigner, type EmLoyaltyLevel, type EmLoyaltyPage, type EmLoyaltyProgram, type EmLoyaltyProgramInput } from "../../lib/api";
import { presetRange, type DateWindow } from "../../lib/date-window";
import { ModalShell } from "./AudiencePage";
import { Card, Delta, ErrorNote, IconTile, Loading, Pill, btn, count, downloadCsv, input, lagosDate, naira, pct } from "./em-ui";
import { LevelBadge, LevelsEditor, MonthChart, RowMenu, Tile, levelLook } from "./loyalty-ui";
import { AnalyticsTab, MembersTab, ReferralsTab, RewardsTab, TiersTab, TransactionsTab } from "./LoyaltyTabs";

/**
 * Loyalty & Rewards, built to Bright's design 55 (8 Nov 2026), part 1:
 * points and VIP levels. Bright's calls: a voucher comes off by itself when
 * a member orders again with the same phone (no code box), customers hear
 * by email, levels come from past spend and points start when the points
 * program is turned on. Refer & Earn and Birthday come next.
 */

const TABS = [
  { key: "programs", label: "Programs", icon: Gift }, { key: "members", label: "Members", icon: Users }, { key: "transactions", label: "Points & Transactions", icon: Layers },
  { key: "tiers", label: "Tiers (VIP)", icon: Star }, { key: "referrals", label: "Referrals", icon: UserPlus }, { key: "rewards", label: "Rewards Catalog", icon: Ticket },
  { key: "analytics", label: "Analytics", icon: Activity }
] as const;
export type LoyaltyTab = (typeof TABS)[number]["key"];

const STATE_LOOK: Record<string, { label: string; tone: string }> = {
  live: { label: "Active", tone: "green" }, draft: { label: "Draft", tone: "slate" }, paused: { label: "Paused", tone: "amber" }, ended: { label: "Ended", tone: "slate" }, archived: { label: "Archived", tone: "slate" }
};
const TYPE_LOOK = {
  tier: { label: "Tier", icon: Crown, tone: "purple" }, points: { label: "Points", icon: Coins, tone: "purple" },
  referral: { label: "Referral", icon: UserPlus, tone: "purple" }, reward: { label: "Reward", icon: Gift, tone: "purple" }
} as const;
const todayInLagos = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());

export const blankProgram = (type: "points" | "tier", levels: EmLoyaltyLevel[] = []): EmLoyaltyProgramInput => ({
  type, name: type === "tier" ? "VIP Club" : "Points Rewards", description: type === "tier" ? "Levels by delivered spend." : "Earn points on every delivered order.",
  rate: 1, productIds: [], levels, endsAt: null, status: "draft"
});
const toInput = (program: EmLoyaltyProgram): EmLoyaltyProgramInput => ({
  type: program.type, name: program.name, description: program.description, rate: program.rate, productIds: program.productIds, levels: program.levels, endsAt: program.endsAt,
  status: program.status === "draft" ? "draft" : "active"
});

export default function LoyaltyPage({ onToast, refreshKey, onCreateAutomation }: { onToast: (message: string) => void; refreshKey: number; onCreateAutomation: (template: string) => void }) {
  const todayKey = useMemo(todayInLagos, []);
  const [window_, setWindow] = useState<DateWindow>(() => presetRange("last30", todayKey));
  const [data, setData] = useState<EmLoyaltyPage | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<LoyaltyTab>("programs");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; input: EmLoyaltyProgramInput | null } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(0);

  const load = useCallback(async () => {
    try { setData(await emailMarketingApi.loyalty({ from: window_.start, to: window_.end })); setError(""); }
    catch (err) { setError((err as Error).message || "Could not load Loyalty & Rewards."); }
  }, [window_.start, window_.end]);
  useEffect(() => { void load(); }, [load, refreshKey, changed]);
  const reload = async () => { setChanged((n) => n + 1); };

  const openEditor = async (id: string | null, programInput: EmLoyaltyProgramInput | null) => {
    if (!designer) { try { setDesigner(await emailMarketingApi.designer()); } catch { /* products list stays empty */ } }
    setEditing({ id, input: programInput });
  };
  const tierProgram = data?.programs.find((row) => row.type === "tier" && row.status !== "archived") ?? null;
  const pointsProgram = data?.programs.find((row) => row.type === "points" && row.status !== "archived") ?? null;

  const act = async (row: EmLoyaltyProgram, action: "launch" | "pause" | "resume" | "archive" | "unarchive" | "delete") => {
    if (action === "launch" || action === "resume") {
      const sure = row.type === "tier"
        ? `Turn on "${row.name}"? Members' levels count from now. A level's welcome voucher goes to members who reach it from today, and monthly vouchers start this month. Vouchers come off members' next orders by themselves.`
        : `Turn on "${row.name}"? Orders delivered from today earn points, and a member's reward comes off their next order by itself once they have enough points.`;
      if (!row.startsAt && !window.confirm(sure)) return;
    }
    if (action === "delete" && !window.confirm(`Delete "${row.name}"? This can't be undone.`)) return;
    setBusy(true);
    try {
      if (action === "delete") { await emailMarketingApi.deleteLoyaltyProgram(row.id); onToast("Program deleted."); }
      else {
        await emailMarketingApi.loyaltyProgramAction(row.id, action);
        onToast(action === "pause" ? "Paused: no points and no vouchers until you turn it back on." : action === "archive" ? "Archived." : action === "unarchive" ? "Back from the archive (paused)." : "Turned on.");
      }
      await reload();
    } catch (err) { onToast((err as Error).message || "Could not change the program."); }
    finally { setBusy(false); }
  };

  const membersReport = async () => {
    try {
      const { rows } = await emailMarketingApi.loyaltyMembers({ all: true, sort: "spend" });
      if (!rows.length) { onToast("No members yet: a customer becomes one with their first delivered order."); return; }
      downloadCsv(`loyalty-members-${todayKey}.csv`, ["Customer", "Phone", "Level", "Delivered orders", "Total spend (₦)", "Points", "Voucher ready", "First delivery", "Last delivery"],
        rows.map((row) => [row.name, row.phone, row.levelName, row.delivered, row.spend, row.balance, row.voucher ? row.voucher.label : "", lagosDate(row.firstAt), lagosDate(row.lastAt)]));
    } catch (err) { onToast((err as Error).message || "Could not build the report."); }
  };

  const k = data?.kpis;
  const programs = (data?.programs ?? []).filter((row) => !query.trim() || `${row.name} ${row.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  const openCount = (data?.programs ?? []).filter((row) => row.status !== "archived").length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Star className="h-7 w-7" /></span>
        <div className="min-w-[260px] flex-1">
          <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Loyalty &amp; Rewards</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Build customer loyalty with points, rewards, VIP tiers, and referral programs to increase repeat purchases and lifetime value.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSettingsOpen(true)} className={`${btn.ghost} !px-5 !py-3`}><Settings className="h-4 w-4 text-[#5B3FD9]" />Loyalty Settings</button>
          <button type="button" onClick={() => void openEditor(null, null)} className={`${btn.primary} !px-5 !py-3`}><Plus className="h-4 w-4" />Create Program</button>
        </div>
      </div>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && !data.live.points && !data.live.tier && (
        <p className="m-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <b>Loyalty is off.</b> The VIP levels and the points program below are drafts. Check them, then turn them on from their menu (…). Until then nothing comes off any order.
        </p>
      )}
      {k && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Tile icon={Users} label="Loyalty Members" value={count(k.members.value)} chip={<Delta value={k.members.change} />} note="With a delivered order" />
          <Tile icon={Check} label="Active Members" value={<>{count(k.active.value)} <span className="text-[15px] font-bold text-gray-500 dark:text-slate-400">({pct(k.active.percent)})</span></>} chip={<Delta value={k.active.change} />} note="Delivered in the last 90 days" />
          <Tile icon={Coins} label="Points Issued" value={count(k.pointsIssued.value)} chip={<Delta value={k.pointsIssued.change} />} note={data!.live.points ? "In these days" : "Starts when points are on"} />
          <Tile icon={Gift} label="Rewards Redeemed" value={naira(k.redeemed.value)} chip={<Delta value={k.redeemed.change} />} note="Taken off orders" />
          <Tile icon={RefreshCw} label="Repeat Purchase Rate" value={pct(k.repeatRate.value)} chip={<Delta value={k.repeatRate.changePp} suffix="pp" />} note="2+ deliveries" />
        </div>
      )}

      {data && (
        <>
          <nav className="flex gap-1 overflow-x-auto" aria-label="Loyalty sections">
            {TABS.map((row) => (
              <button key={row.key} type="button" onClick={() => setTab(row.key)} aria-current={tab === row.key ? "page" : undefined}
                className={`!min-h-0 inline-flex flex-none items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-[14px] font-semibold ${tab === row.key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                <row.icon className="h-4 w-4" />{row.label}{row.key === "programs" ? ` (${openCount})` : ""}
              </button>
            ))}
          </nav>

          {tab === "programs" && (
            <div className="grid gap-4 xl:grid-cols-[minmax(0,2.7fr)_minmax(0,1fr)]">
              <div className="min-w-0 space-y-4">
                <Card className="overflow-hidden">
                  <div className="flex flex-wrap items-center gap-3 p-4">
                    <IconTile><Gift className="h-5 w-5" /></IconTile>
                    <div className="mr-auto min-w-0">
                      <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">Loyalty Programs</h3>
                      <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Create and manage loyalty, points, tier, and referral programs.</p>
                    </div>
                    <label className="relative min-w-[200px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search programs..." className={`${input} !py-2 !pl-9`} /></label>
                    <DateWindowNav variant="compact" value={window_} onChange={setWindow} todayKey={todayKey} />
                  </div>
                  <div className="overflow-x-auto">
                    <table className="!min-w-0 w-full min-w-[760px] text-left text-[13px]">
                      <thead><tr className="border-y border-gray-100 bg-gray-50/70 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
                        <th className="px-4 py-2.5">Program Name</th><th className="px-2 py-2.5">Type</th><th className="px-2 py-2.5">Status</th>
                        <th className="px-2 py-2.5 text-right">Members</th><th className="px-2 py-2.5 text-right">Redemptions</th><th className="px-2 py-2.5 text-right">Revenue Impact</th><th className="px-3 py-2.5 text-right">Actions</th>
                      </tr></thead>
                      <tbody>
                        {programs.map((row) => {
                          const look = TYPE_LOOK[row.type];
                          const st = STATE_LOOK[row.state] ?? STATE_LOOK.draft;
                          return (
                            <tr key={row.id} className={`border-b border-gray-100 dark:border-slate-800 ${row.status === "archived" ? "opacity-60" : ""}`}>
                              <td className="px-4 py-2.5">
                                <span className="flex items-center gap-2.5">
                                  {row.type === "tier" ? <LevelBadge index={2} size={38} /> : <IconTile><look.icon className="h-5 w-5" /></IconTile>}
                                  <span className="min-w-0"><span className="block max-w-[230px] truncate font-bold text-gray-900 dark:text-slate-50" title={row.name}>{row.name}</span><span className="block max-w-[260px] truncate text-[12px] text-gray-500" title={row.description}>{row.type === "tier" ? `Tier-based rewards (${row.levels.map((level) => level.name).join(", ")})` : row.description || `${row.rate} ${row.rate === 1 ? "point" : "points"} per ₦1,000 delivered`}</span></span>
                                </span>
                              </td>
                              <td className="px-2 py-2.5"><Pill tone={look.tone}><look.icon className="h-3.5 w-3.5" />{look.label}</Pill></td>
                              <td className="px-2 py-2.5"><span title={row.startsAt ? `On since ${lagosDate(row.startsAt)}` : undefined}><Pill tone={st.tone}>{st.label}</Pill></span></td>
                              <td className="px-2 py-2.5 text-right font-semibold">{count(row.members)}</td>
                              <td className="px-2 py-2.5 text-right font-semibold">{count(row.redemptions)}</td>
                              <td className="px-2 py-2.5 text-right"><span className="block font-bold text-gray-900 dark:text-slate-50">{row.redemptions ? naira(row.revenue) : "—"}</span>{row.redemptions > 0 && <Delta value={row.revenueChange} />}</td>
                              <td className="px-3 py-2.5 text-right">
                                <RowMenu label={`More for ${row.name}`} disabled={busy} items={[
                                  { key: "edit", label: row.type === "tier" ? "Edit Levels" : "Edit", icon: Pencil, run: () => (row.type === "tier" ? setTab("tiers") : void openEditor(row.id, toInput(row))) },
                                  ...(row.status === "active" ? [{ key: "pause", label: "Pause", icon: Pause, run: () => void act(row, "pause") }] : []),
                                  ...(row.status === "paused" || row.status === "draft" ? [{ key: "on", label: "Turn On", icon: Play, run: () => void act(row, row.status === "draft" ? "launch" : "resume") }] : []),
                                  ...(row.status !== "archived" ? [{ key: "archive", label: "Archive", icon: Archive, run: () => void act(row, "archive") }] : [{ key: "unarchive", label: "Unarchive", icon: Undo2, run: () => void act(row, "unarchive") }]),
                                  ...(!row.used ? [{ key: "delete", label: "Delete", icon: Trash2, run: () => void act(row, "delete"), danger: true }] : [])
                                ]} />
                              </td>
                            </tr>
                          );
                        })}
                        {/* The design's other two programs: part 2. */}
                        {[
                          { key: "referral" as const, name: "Refer & Earn", hint: "A friend gets money off; the customer who shared gets a voucher" },
                          { key: "reward" as const, name: "Birthday Rewards", hint: "Special gift or discount on the customer's birthday" }
                        ].filter((row) => !query.trim() || row.name.toLowerCase().includes(query.trim().toLowerCase())).map((row) => {
                          const look = TYPE_LOOK[row.key];
                          return (
                            <tr key={row.key} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                              <td className="px-4 py-2.5"><span className="flex items-center gap-2.5 opacity-70"><IconTile><look.icon className="h-5 w-5" /></IconTile><span className="min-w-0"><span className="block font-bold text-gray-900 dark:text-slate-50">{row.name}</span><span className="block max-w-[260px] truncate text-[12px] text-gray-500">{row.hint}</span></span></span></td>
                              <td className="px-2 py-2.5 opacity-70"><Pill tone={look.tone}><look.icon className="h-3.5 w-3.5" />{look.label}</Pill></td>
                              <td className="px-2 py-2.5"><Pill tone="slate">Next part</Pill></td>
                              <td className="px-2 py-2.5 text-right text-gray-400">—</td><td className="px-2 py-2.5 text-right text-gray-400">—</td><td className="px-2 py-2.5 text-right text-gray-400">—</td><td className="px-3 py-2.5" />
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="m-0 px-4 py-2.5 text-[12px] text-gray-500">Revenue Impact: delivered orders that used a voucher from the program, in the days picked.</p>
                </Card>

                <Card className="p-4">
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <IconTile><Crown className="h-5 w-5" /></IconTile>
                    <div className="mr-auto min-w-0">
                      <h3 className="m-0 text-[18px] font-bold text-gray-900 dark:text-slate-50">VIP Tiers (Customer Levels)</h3>
                      <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Reward your best customers with exclusive perks and benefits.</p>
                    </div>
                    <button type="button" onClick={() => setTab("tiers")} className={btn.ghost}><Pencil className="h-4 w-4 text-[#5B3FD9]" />Manage Tiers</button>
                  </div>
                  <div className={`grid gap-3 ${data.levels.length > 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-3"}`}>
                    {data.levels.map((level, index) => (
                      <div key={level.key} className={`rounded-2xl border p-4 ${levelLook(index).card}`}>
                        <div className="flex items-center gap-3">
                          <LevelBadge index={index} size={46} />
                          <div className="min-w-0">
                            <div className="text-[18px] font-extrabold text-gray-900 dark:text-slate-50">{level.name}</div>
                            <div className="text-[13px] text-gray-700 dark:text-slate-300">{level.spendText}</div>
                          </div>
                        </div>
                        <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
                          {level.lines.map((line) => <li key={line} className="flex items-start gap-2 text-[13.5px] text-gray-800 dark:text-slate-200"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" />{line}</li>)}
                        </ul>
                        <div className="mt-3 text-[12px] font-semibold text-gray-500">{count(level.members)} {level.members === 1 ? "member" : "members"}</div>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              <div className="min-w-0 space-y-4">
                <Card className="p-4">
                  <h3 className="m-0 mb-3 text-[18px] font-bold text-gray-900 dark:text-slate-50">Loyalty Impact</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-start gap-2.5">
                      <IconTile><Coins className="h-5 w-5" /></IconTile>
                      <div className="min-w-0"><div className="text-[19px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{naira(data.impact.revenue.value)}</div><div className="text-[12px] text-gray-600 dark:text-slate-400">Revenue from Loyalty</div><Delta value={data.impact.revenue.change} /></div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <IconTile><RefreshCw className="h-5 w-5" /></IconTile>
                      <div className="min-w-0"><div className="text-[19px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{pct(data.impact.repeatRate.value)}</div><div className="text-[12px] text-gray-600 dark:text-slate-400">Repeat Purchase Rate</div><Delta value={data.impact.repeatRate.changePp} suffix="pp" /></div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <MonthChart data={data.impact.monthly} series={[{ key: "revenue", label: "Revenue from Loyalty", color: "#7C5CFF", kind: "area", unit: "naira" }]} height={200} empty="Shows once members order again." />
                  </div>
                  <p className="m-0 mt-1 text-[11.5px] text-gray-500">Revenue from Loyalty: delivered repeat orders by members (their 2nd order on), by month.</p>
                </Card>
                <Card className="p-4">
                  <h3 className="m-0 mb-2 flex items-center gap-2 text-[18px] font-bold text-gray-900 dark:text-slate-50"><Zap className="h-5 w-5 text-[#5B3FD9]" />Quick Actions</h3>
                  <div className="space-y-1.5">
                    {[
                      { icon: Plus, label: "Create Loyalty Program", run: () => void openEditor(null, null) },
                      { icon: Crown, label: "Add / Edit VIP Tiers", run: () => setTab("tiers") },
                      { icon: Gift, label: "Manage Rewards Catalog", run: () => setTab("rewards") },
                      { icon: Layers, label: "View Points Transactions", run: () => setTab("transactions") },
                      { icon: FileBarChart, label: "Loyalty Performance Report", run: () => void membersReport() }
                    ].map((row) => (
                      <button key={row.label} type="button" onClick={row.run} className="!min-h-0 flex w-full items-center gap-3 rounded-xl border border-gray-100 px-3 py-2.5 text-left text-[14px] font-semibold text-gray-900 hover:border-[#C9BEF5] hover:bg-[#F7F4FF] dark:border-slate-800 dark:text-slate-100">
                        <IconTile size="sm"><row.icon className="h-4 w-4" /></IconTile><span className="flex-1">{row.label}</span><ChevronRight className="h-4 w-4 text-gray-400" />
                      </button>
                    ))}
                  </div>
                </Card>
                <p className="m-0 px-1 text-[12px] leading-snug text-gray-500">How vouchers work: when a member orders again with the same phone number, their best voucher comes off the order by itself (one per order; an email offer takes its place). The order form looks the same, and Order Details shows the rep what came off, so they can tell the customer on the call.</p>
              </div>
            </div>
          )}
          {tab === "members" && <MembersTab onToast={onToast} levels={data.levels} refreshKey={changed + refreshKey} onChanged={reload} />}
          {tab === "transactions" && <TransactionsTab window_={window_} setWindow={setWindow} todayKey={todayKey} onToast={onToast} refreshKey={changed + refreshKey} />}
          {tab === "tiers" && (
            <TiersTab program={tierProgram} baseRate={pointsProgram?.rate ?? 1} levels={data.levels} onToast={onToast} onChanged={reload}
              onCreate={() => void openEditor(null, blankProgram("tier", data.levels.map(({ key, name, minSpend, multiplier, welcomeVoucher, monthlyVoucher, perks }) => ({ key, name, minSpend, multiplier, welcomeVoucher, monthlyVoucher, perks }))))}
              onAct={(action) => tierProgram && void act(tierProgram, action)} />
          )}
          {tab === "referrals" && <ReferralsTab />}
          {tab === "rewards" && <RewardsTab data={data} onToast={onToast} onChanged={reload} onOpenTiers={() => setTab("tiers")} />}
          {tab === "analytics" && <AnalyticsTab data={data} />}
        </>
      )}

      {editing && (
        <ProgramModal id={editing.id} initial={editing.input} designer={designer} hasTier={!!tierProgram} hasPoints={!!pointsProgram} defaultLevels={data?.levels ?? []}
          onEditTier={() => { setEditing(null); setTab("tiers"); }} onClose={() => setEditing(null)}
          onDone={async (message) => { setEditing(null); onToast(message); await reload(); }} />
      )}
      {settingsOpen && data && (
        <SettingsModal minOrder={data.settings.minOrder} onClose={() => setSettingsOpen(false)} onCreateAutomation={() => { setSettingsOpen(false); onCreateAutomation("loyalty_update"); }}
          onDone={async (message) => { setSettingsOpen(false); onToast(message); await reload(); }} />
      )}
    </div>
  );
}

/** Create Program: pick a kind (one points program and one set of levels per branch), then its details. */
function ProgramModal({ id, initial, designer, hasTier, hasPoints, defaultLevels, onEditTier, onClose, onDone }: {
  id: string | null; initial: EmLoyaltyProgramInput | null; designer: EmDesigner | null; hasTier: boolean; hasPoints: boolean; defaultLevels: EmLoyaltyLevel[];
  onEditTier: () => void; onClose: () => void; onDone: (message: string) => Promise<void>;
}) {
  const [form, setForm] = useState<EmLoyaltyProgramInput | null>(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EmLoyaltyProgramInput>) => setForm((current) => (current ? { ...current, ...patch } : current));
  const products = designer?.products ?? [];
  const label = "block text-[13px] font-semibold text-gray-800 dark:text-slate-200";
  const save = async (status: "draft" | "active") => {
    if (!form) return;
    if (status === "active" && !id && !window.confirm(form.type === "tier"
      ? "Save and turn on? Members' levels count from now, and vouchers come off their next orders by themselves."
      : "Save and turn on? Orders delivered from today earn points, and rewards come off orders by themselves.")) return;
    setBusy(true); setError("");
    try {
      const body = { ...form, status, name: form.name.trim(), levels: form.levels.map((level) => ({ ...level, perks: level.perks.map((perk) => perk.trim()).filter(Boolean) })) };
      if (id) await emailMarketingApi.updateLoyaltyProgram(id, body); else await emailMarketingApi.createLoyaltyProgram(body);
      await onDone(id ? "Program saved." : status === "active" ? `"${body.name}" is on.` : "Saved as a draft. Turn it on from its menu (…) when you're ready.");
    } catch (err) {
      setError((err as Error).message || "Could not save the program.");
      setBusy(false);
    }
  };
  if (!form) {
    const kinds = [
      { key: "points", title: "Points Program", hint: "Earn points on every delivered order", icon: Coins, off: hasPoints ? "You already have one: edit it from the Programs list." : "", run: () => setForm(blankProgram("points")) },
      { key: "tier", title: "VIP Tiers", hint: "Bronze, Silver, Gold by spend", icon: Crown, off: hasTier ? "You already have VIP levels." : "", run: () => setForm(blankProgram("tier", defaultLevels)) },
      { key: "referral", title: "Refer & Earn", hint: "Rewards for bringing a friend", icon: UserPlus, off: "Comes in the next part." },
      { key: "birthday", title: "Birthday Rewards", hint: "A gift on the customer's birthday", icon: Cake, off: "Comes in the next part. The order form doesn't ask for birthdays yet." }
    ];
    return (
      <ModalShell title="Create Program" sub="Pick the kind of loyalty program." onClose={onClose} footer={<button type="button" onClick={onClose} className={btn.ghost}>Close</button>}>
        <div className="grid gap-2 sm:grid-cols-2">
          {kinds.map((kind) => (
            <button key={kind.key} type="button" disabled={!!kind.off && kind.key !== "tier"} onClick={kind.key === "tier" && hasTier ? onEditTier : kind.run}
              className="!min-h-0 flex items-start gap-3 rounded-xl border border-gray-200 p-3 text-left hover:border-[#8B74EE] hover:bg-[#F7F4FF] disabled:cursor-not-allowed disabled:opacity-55 dark:border-slate-700">
              <IconTile><kind.icon className="h-5 w-5" /></IconTile>
              <span className="min-w-0"><span className="block text-[14px] font-bold text-gray-900 dark:text-slate-50">{kind.title}</span><span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{kind.hint}</span>
                {kind.off && <span className="mt-1 block text-[12px] font-semibold text-[#5B3FD9]">{kind.key === "tier" && hasTier ? "Edit your levels →" : kind.off}</span>}</span>
            </button>
          ))}
        </div>
      </ModalShell>
    );
  }
  return (
    <ModalShell wide title={id ? "Edit Program" : form.type === "tier" ? "Create VIP Tiers" : "Create Points Program"} sub={form.type === "tier" ? "Levels come from each customer's delivered spend." : "Points come with each delivered order."} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
        {!id && <button type="button" disabled={busy} onClick={() => void save("draft")} className={btn.ghost}>Save as Draft</button>}
        <button type="button" disabled={busy} onClick={() => void save("active")} className={btn.primary}>{busy ? "Saving…" : id ? "Save Program" : "Save & Turn On"}</button>
      </>}>
      <ErrorNote message={error} />
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Program Name *<input value={form.name} maxLength={80} onChange={(event) => set({ name: event.target.value })} className={`${input} mt-1.5`} /></label>
          <label className={label}>Description<input value={form.description} maxLength={200} onChange={(event) => set({ description: event.target.value })} className={`${input} mt-1.5`} /></label>
          {form.type === "points" && (
            <>
              <label className={label}>Points per ₦1,000 delivered *
                <input type="number" min={0.1} max={100} step={0.5} value={form.rate} onChange={(event) => set({ rate: Number(event.target.value) || 0 })} className={`${input} mt-1.5`} />
                <span className="block text-[11.5px] font-normal text-gray-500">{`A ₦30,500 order earns ${Math.floor(30 * (form.rate || 0))} points at the first level. Higher levels multiply it.`}</span>
              </label>
              <label className={label}>Ends (optional)
                <input type="date" value={form.endsAt ? form.endsAt.slice(0, 10) : ""} onChange={(event) => set({ endsAt: event.target.value ? new Date(`${event.target.value}T23:59:00+01:00`).toISOString() : null })} className={`${input} mt-1.5`} />
                <span className="block text-[11.5px] font-normal text-gray-500">Empty = ongoing</span>
              </label>
            </>
          )}
        </div>
        {form.type === "points" && (
          <div>
            <div className="mb-1.5 flex items-center gap-2"><span className={label}>Products that earn points</span><span className="text-[12px] text-gray-500">{form.productIds.length ? `${form.productIds.length} picked` : "All products"}</span></div>
            {products.length ? (
              <div className="flex max-h-[150px] flex-wrap gap-1.5 overflow-y-auto">
                {products.map((product) => {
                  const on = form.productIds.includes(product.id);
                  return <button key={product.id} type="button" aria-pressed={on} onClick={() => set({ productIds: on ? form.productIds.filter((value) => value !== product.id) : [...form.productIds, product.id] })}
                    className={`!min-h-0 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold ${on ? "border-[#8B74EE] bg-[#F5F2FE] text-[#5B3FD9]" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{product.name}</button>;
                })}
              </div>
            ) : <p className="m-0 text-[12.5px] text-gray-500">Every product earns points.</p>}
          </div>
        )}
        {form.type === "tier" && <LevelsEditor levels={form.levels} baseRate={1} onChange={(levels) => set({ levels })} />}
        <p className="m-0 rounded-xl bg-gray-50 px-3 py-2 text-[12.5px] text-gray-600 dark:bg-slate-800/50 dark:text-slate-300">
          {form.type === "tier"
            ? "Levels count everything a customer has had delivered, so past customers get their level straight away. Welcome vouchers only go to members who reach a level after you turn the levels on."
            : "Points start the day you turn this on (past orders earn none). They count only while the order stays delivered, and rewards come off a member's next order by themselves."}
        </p>
      </div>
    </ModalShell>
  );
}

/** Loyalty Settings: the smallest order a voucher comes off, and how customers hear (email). */
function SettingsModal({ minOrder, onClose, onCreateAutomation, onDone }: { minOrder: number; onClose: () => void; onCreateAutomation: () => void; onDone: (message: string) => Promise<void> }) {
  const [value, setValue] = useState(minOrder);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError("");
    try { await emailMarketingApi.saveLoyaltySettings({ minOrder: value }); await onDone("Loyalty settings saved."); }
    catch (err) { setError((err as Error).message || "Could not save the settings."); setBusy(false); }
  };
  return (
    <ModalShell title="Loyalty Settings" sub="Rules that apply to every voucher." onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}>{busy ? "Saving…" : "Save Settings"}</button></>}>
      <ErrorNote message={error} />
      <div className="space-y-4">
        <label className="block text-[13px] font-semibold text-gray-800 dark:text-slate-200">Smallest order a voucher comes off (₦)
          <input type="number" min={0} value={value || ""} placeholder="Any order" onChange={(event) => setValue(Math.max(0, Number(event.target.value) || 0))} className={`${input} mt-1.5`} />
          <span className="block text-[11.5px] font-normal text-gray-500">Smaller orders pay full price, and the voucher waits for a bigger one.</span>
        </label>
        <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
          <div className="flex items-center gap-2 text-[14px] font-bold text-gray-900 dark:text-slate-50"><Mail className="h-4 w-4 text-[#5B3FD9]" />Telling customers (email)</div>
          <p className="m-0 mt-1 text-[12.5px] text-gray-600 dark:text-slate-400">Any email can show a member's {"{{Points}}"}, {"{{Level}}"}, {"{{Voucher}}"} and {"{{Next Level}}"}. The ready-made loyalty email goes a day after each delivery.</p>
          <button type="button" onClick={onCreateAutomation} className={`${btn.outline} mt-2`}><Zap className="h-3.5 w-3.5" />Set up the loyalty email</button>
        </div>
        <ul className="m-0 list-disc space-y-1 pl-5 text-[12.5px] text-gray-600 dark:text-slate-400">
          <li>One voucher per order: the one that takes the most off. An email offer takes its place on that order.</li>
          <li>If the order fails, is cancelled or is deleted, the voucher (and its points) comes back.</li>
          <li>Rep pay, profit and cash use the lower amount, as with Coupons.</li>
          <li>Vouchers come off orders from the order form. Orders typed in by staff pay full price for now.</li>
        </ul>
      </div>
    </ModalShell>
  );
}
