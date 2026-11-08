import {
  AlertTriangle, ArrowRight, Ban, CheckCircle2, Copy, FileSpreadsheet, Layers, Mail, MailOpen, MousePointerClick, RefreshCw, Repeat, ShieldCheck, ShoppingCart, Sparkles,
  Timer, TrendingUp, UserMinus, UserX, Users, Wrench, Zap
} from "lucide-react";
import type { EmHealth, EmHealthCampaign } from "../../lib/api";
import { Card, Delta, Donut, Pill, STATUS_LOOK, SegmentIcon, Thumb, count, pct } from "./em-ui";
import type { HealthNav } from "./AudienceHealthPage";
import { ActionCards, BarRow, CardHead, HealthKpi, Insights, Legend, Ring, SERIES, STATUS, ScoreCard, TrendChart, tdRow, thRow } from "./health-ui";

/** Audience Health: Overview, Quality & Validity and Engagement (Bright's designs J, K, L). */

type TabProps = { data: EmHealth; nav: HealthNav };

const pts = (value: number | null | undefined, goodWhenDown = false) => <Delta value={value} suffix="pp" goodWhenDown={goodWhenDown} />;
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ── Overview ──────────────────────────────────────────────────────────

const SCORE_TEXT: Record<string, string> = {
  Excellent: "Your audience is in great shape. Keep the quality and engagement where they are.",
  Good: "Your audience is healthy. A few things below can still be improved.",
  Fair: "Your audience needs some care. Start with the actions below.",
  Poor: "Your audience has serious problems. Fix the open issues first."
};

export function OverviewTab({ data, nav }: TabProps) {
  const o = data.overview;
  const k = o.kpis;
  const b = o.breakdown;
  const slices = [
    { label: "Valid & Engaged", value: b.valid, color: SERIES.a },
    { label: "Invalid / Bounced", value: b.bounced, color: STATUS.warn },
    { label: "Unsubscribed", value: b.unsubscribed, color: STATUS.bad },
    { label: "Duplicates", value: b.duplicate, color: STATUS.info },
    { label: "Others (never open, or cleaned)", value: b.other, color: "#94A3B8" }
  ];
  const checks = o.checks.map((check) => ({
    label: check.value === null ? `${check.label}: shows once emails go out` : `${check.good ? (check.lowIsGood ? "Low" : "Good") : (check.lowIsGood ? "High" : "Low")} ${check.label.toLowerCase()} (${pct(check.value)})`,
    good: check.value === null ? true : check.good
  }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <HealthKpi icon={Users} label="Total Audience" value={count(k.total.value)}><Delta value={k.total.change} /><span>vs start</span></HealthKpi>
        <HealthKpi icon={ShieldCheck} tone="green" label="Audience Quality" value={pct(k.quality.value)}>{pts(k.quality.change)}</HealthKpi>
        <HealthKpi icon={Mail} tone="blue" label="Email Deliverability" value={pct(k.deliverability.value)}>{pts(k.deliverability.change)}</HealthKpi>
        <HealthKpi icon={MousePointerClick} label="Engagement Rate" value={pct(k.engagement.value)}>{pts(k.engagement.change)}<span>opened</span></HealthKpi>
        <HealthKpi icon={AlertTriangle} tone="red" label="At-Risk Audience" value={count(k.atRisk.value)} sub={k.atRisk.percent === null ? undefined : `(${pct(k.atRisk.percent)})`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <ScoreCard title="Audience Health Score" tip="Quality counts most (40%), then delivery (30%), opens (20%) and the at-risk share (10%). Parts with no data yet are left out."
          value={o.score} ringLabel={o.grade === "Poor" || o.grade === "Fair" ? "Needs care" : "Healthy"} grade={o.grade}
          text={o.grade ? SCORE_TEXT[o.grade] : "The score shows once people are on the list."} checks={checks} />
        <Card className="p-4">
          <CardHead title="Health Trend" sub="Share of the list in good standing, day by day" />
          <TrendChart data={o.trend} series={[{ key: "value", label: "Audience quality", color: SERIES.a, kind: "area" }]} domain={[0, 100]} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="p-4">
          <CardHead title="Audience Quality Breakdown" />
          <div className="flex flex-wrap items-center gap-4">
            <Donut slices={slices.map((slice) => ({ value: slice.value, color: slice.color }))} size={140} stroke={20}>
              <span className="text-[20px] font-extrabold text-gray-900 dark:text-slate-50">{count(b.total)}</span>
              <span className="text-[12px] text-gray-500">Total</span>
            </Donut>
            <ul className="m-0 min-w-[170px] flex-1 list-none space-y-1.5 p-0">
              {slices.map((slice) => (
                <li key={slice.label} className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
                  <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{slice.label}</span>
                  <span className="font-bold text-gray-900 dark:text-slate-50">{count(slice.value)}</span>
                  <span className="w-12 text-right text-gray-500">{pct(share(slice.value, b.total))}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Engagement Overview" />
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {[
              { icon: MailOpen, label: "Open Rate", value: pct(o.engagement.openRate), delta: pts(o.engagement.openChange) },
              { icon: MousePointerClick, label: "Click-Through Rate", value: pct(o.engagement.clickRate), delta: pts(o.engagement.clickChange) },
              { icon: Repeat, label: "Repeat Purchase Rate", value: pct(o.engagement.repeatPurchaseRate), delta: null, tip: "Customers on the list with 2+ delivered orders" },
              { icon: Users, label: "Active Audience", value: count(o.engagement.active), delta: o.engagement.activePercent === null ? null : <span className="text-[12px] text-gray-500">({pct(o.engagement.activePercent)})</span>, tip: "Opened or clicked in the last 30 days" }
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2.5 py-2.5" title={row.tip}>
                <row.icon className="h-4 w-4 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1 text-[13px] text-gray-700 dark:text-slate-300">{row.label}</span>
                <span className="text-[15px] font-bold text-gray-900 dark:text-slate-50">{row.value}</span>
                <span className="w-[86px] text-right">{row.delta}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Audience at Risk" />
          <div className="flex items-center gap-3 rounded-xl bg-rose-50 px-4 py-3 dark:bg-rose-500/10">
            <AlertTriangle className="h-6 w-6 text-rose-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[22px] font-extrabold text-rose-700 dark:text-rose-300">{count(o.atRisk.total)}</div>
              <div className="text-[12.5px] text-rose-700/80 dark:text-rose-200">{o.atRisk.percent === null ? "Nobody on the list yet" : `${pct(o.atRisk.percent)} of total`}</div>
            </div>
            <button type="button" onClick={nav.audience} className="!min-h-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-rose-700 hover:underline dark:text-rose-200">View Audience<ArrowRight className="h-3.5 w-3.5" /></button>
          </div>
          <p className="m-0 mb-1.5 mt-3 text-[12.5px] font-bold text-gray-800 dark:text-slate-200">Why they are at risk</p>
          {[
            { label: "No opens in 60+ days", value: o.atRisk.quiet },
            { label: "Email bounced", value: o.atRisk.bounced },
            { label: "Unsubscribed in the last 30 days", value: o.atRisk.unsubscribedRecently }
          ].map((row) => (
            <div key={row.label} className="flex items-center gap-2 py-1 text-[12.5px]">
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{row.label}</span>
              <span className="font-bold text-gray-900 dark:text-slate-50">{count(row.value)}</span>
              <span className="w-12 text-right text-gray-500">{pct(share(row.value, b.total))}</span>
            </div>
          ))}
        </Card>
      </div>

      <ActionCards wide sub="Keep your audience healthy and improve results with these actions." items={[
        { icon: RefreshCw, title: "Re-engage Inactive", text: `${count(o.atRisk.quiet)} ${o.atRisk.quiet === 1 ? "person has" : "people have"} not opened in 60+ days. Send them a fresh offer.`, button: "Create Campaign", onClick: () => nav.create() },
        { icon: Wrench, tone: "amber", title: "Fix Delivery Issues", text: `${count(o.atRisk.bounced)} ${o.atRisk.bounced === 1 ? "address" : "addresses"} bounced. Stop emailing them and check your sending set-up.`, button: "Clean List", onClick: nav.clean },
        { icon: UserX, tone: "red", title: "Clean Invalid Contacts", text: `${count(b.bounced + b.duplicate)} bounced or duplicate ${b.bounced + b.duplicate === 1 ? "contact" : "contacts"} on the list.`, button: "Clean List", onClick: nav.clean },
        { icon: Zap, tone: "green", title: "Create Win-back Campaign", text: "Bring back customers who have not bought in 60+ days, automatically.", button: "Set Up Win-back", onClick: () => nav.create("win_back") }
      ]} />
    </div>
  );
}

// ── Quality & Validity ────────────────────────────────────────────────

const SOURCE_ICON: Record<string, typeof Mail> = { order: ShoppingCart, cart: ShoppingCart, manual: Users, csv: FileSpreadsheet, paste: Copy, device: Users, import: FileSpreadsheet };

export function QualityTab({ data }: TabProps) {
  const q = data.quality.kpis;
  const o = data.overview;
  const rows = [
    { label: "Valid & Engaged", value: q.valid, color: SERIES.a, icon: CheckCircle2 },
    { label: "Invalid / Bounced", value: q.bounced, color: STATUS.warn, icon: Ban },
    { label: "Duplicates", value: q.duplicate, color: STATUS.info, icon: Copy },
    { label: "Unsubscribed", value: q.unsubscribed, color: STATUS.bad, icon: UserMinus },
    ...(q.other > 0 ? [{ label: "Others (never open, or cleaned)", value: q.other, color: "#94A3B8", icon: UserX }] : [])
  ];
  const insights: Array<{ ok: boolean; text: string }> = [];
  if (q.total) {
    insights.push(q.percent !== null && q.percent >= 90 ? { ok: true, text: `Audience quality is ${o.grade === "Excellent" ? "excellent" : "good"} (${pct(q.percent)}).` } : { ok: false, text: `Audience quality is ${pct(q.percent)}: below the 90% a healthy list keeps.` });
    insights.push(share(q.bounced, q.total)! < 2 ? { ok: true, text: `Bounced emails are low (${pct(share(q.bounced, q.total))}).` } : { ok: false, text: `${pct(share(q.bounced, q.total))} of emails bounced. Clean them so they stop hurting delivery.` });
    insights.push(q.duplicate === 0 ? { ok: true, text: "No customer is on the list twice." } : { ok: share(q.duplicate, q.total)! < 3, text: `${count(q.duplicate)} ${q.duplicate === 1 ? "customer gave" : "customers gave"} a second email: the older one is a duplicate.` });
    insights.push(share(q.unsubscribed, q.total)! < 5 ? { ok: true, text: `Unsubscribes are in a healthy range (${pct(share(q.unsubscribed, q.total))}).` } : { ok: false, text: `${pct(share(q.unsubscribed, q.total))} of the list unsubscribed. Send less often or make emails more useful.` });
    const worst = data.quality.sources.filter((row) => row.total >= 20 && row.qualityRate !== null).sort((a, b) => (a.qualityRate ?? 0) - (b.qualityRate ?? 0))[0];
    if (worst && (worst.qualityRate ?? 100) < 75) insights.push({ ok: false, text: `"${worst.label}" has the weakest quality (${pct(worst.qualityRate)}).` });
  }
  const recommendation = !q.total ? undefined
    : (q.percent ?? 0) >= 90 ? "Keep your current sources and clean the list now and then to keep quality high."
      : "Clean the list (bounced and duplicate emails), then check where the weakest contacts come from.";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <HealthKpi icon={Users} label="Total Audience" value={count(q.total)} />
        <HealthKpi icon={CheckCircle2} tone="green" label="Valid & Engaged" value={count(q.valid)} sub={`(${pct(q.percent)})`} />
        <HealthKpi icon={Ban} tone="amber" label="Invalid / Bounced" value={count(q.bounced)} sub={`(${pct(share(q.bounced, q.total))})`} />
        <HealthKpi icon={Copy} tone="blue" label="Duplicates" value={count(q.duplicate)} sub={`(${pct(share(q.duplicate, q.total))})`} />
        <HealthKpi icon={UserMinus} tone="red" label="Unsubscribed" value={count(q.unsubscribed)} sub={`(${pct(share(q.unsubscribed, q.total))})`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="p-4">
          <CardHead title="Audience Validity Overview" tip="Valid & Engaged: can be emailed, is not a second email of the same customer, and has not ignored 3+ emails over 60+ days." />
          <div className="flex flex-wrap items-center gap-4">
            <Ring value={q.percent} label="Valid & Engaged" />
            <ul className="m-0 min-w-[150px] flex-1 list-none space-y-1.5 p-0">
              {rows.map((row) => (
                <li key={row.label} className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
                  <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{row.label}</span>
                  <span className="font-bold text-gray-900 dark:text-slate-50">{count(row.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Data Quality Trend" sub="Share Valid & Engaged, day by day" />
          <TrendChart data={data.quality.trend} series={[{ key: "value", label: "Valid & Engaged", color: SERIES.a, kind: "area" }]} domain={[0, 100]} height={200} />
        </Card>
        <Card className="p-4">
          <CardHead title="Quality Breakdown" />
          <div className="space-y-3.5">
            {rows.map((row) => <BarRow key={row.label} icon={row.icon} label={row.label} value={count(row.value)} percent={share(row.value, q.total)} color={row.color} />)}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="p-4 pb-0"><CardHead title="Audience Quality by Source" tip="Where each person joined: the order form, an unfinished order, by hand, or one upload (each upload has its own row)." /></div>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[760px] text-left text-[13px]">
              <thead><tr className={thRow}>
                <th className="px-4 py-2.5">#</th><th className="px-2 py-2.5">Source</th><th className="px-2 py-2.5 text-right">Total</th><th className="px-2 py-2.5 text-right">Valid &amp; Engaged</th>
                <th className="px-2 py-2.5 text-right">Invalid / Bounced</th><th className="px-2 py-2.5 text-right">Duplicates</th><th className="px-2 py-2.5 text-right">Unsubscribed</th>
                <th className="px-2 py-2.5 text-right">Quality Rate</th><th className="px-4 py-2.5">Status</th>
              </tr></thead>
              <tbody>
                {data.quality.sources.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-gray-500">Nobody on the list yet.</td></tr>}
                {data.quality.sources.map((row, index) => {
                  const Icon = SOURCE_ICON[row.kind] ?? Users;
                  return (
                    <tr key={`${row.label}-${index}`} className={tdRow}>
                      <td className="px-4 py-2.5 text-gray-500">{index + 1}</td>
                      <td className="px-2 py-2.5"><span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-50" title={row.label}><Icon className="h-4 w-4 shrink-0 text-[#5B3FD9]" /><span className="max-w-[210px] truncate">{row.label}</span></span></td>
                      <td className="px-2 py-2.5 text-right font-semibold">{count(row.total)}</td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-right">{count(row.valid)} <span className="text-gray-500">({pct(share(row.valid, row.total))})</span></td>
                      <td className="px-2 py-2.5 text-right">{count(row.bounced)}</td>
                      <td className="px-2 py-2.5 text-right">{count(row.duplicate)}</td>
                      <td className="px-2 py-2.5 text-right">{count(row.unsubscribed)}</td>
                      <td className="px-2 py-2.5 text-right font-bold">{pct(row.qualityRate)}</td>
                      <td className="px-4 py-2.5"><Pill tone={row.status === "Good" ? "green" : row.status === "Fair" ? "amber" : row.status === "Poor" ? "red" : "slate"}>{row.status}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Insights title="Key Insights & Recommendations" items={insights} recommendation={recommendation} />
      </div>
    </div>
  );
}

// ── Engagement ────────────────────────────────────────────────────────

const ENGAGEMENT_LOOK: Record<string, { label: string; tone: string }> = { high: { label: "High", tone: "green" }, good: { label: "Good", tone: "blue" }, low: { label: "Low", tone: "amber" }, none: { label: "No emails yet", tone: "slate" } };

/** Bounce and spam numbers exist only once Mailjet reports them (bounce reports on). */
export function CampaignTable({ rows, mode, onAll, reportsOn = true }: { rows: EmHealthCampaign[]; mode: "engagement" | "delivery"; onAll: () => void; reportsOn?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="p-4 pb-0">
        <CardHead title={mode === "engagement" ? "Recent Campaign Performance" : "Deliverability by Campaign"}
          right={<button type="button" onClick={onAll} className="!min-h-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#5B3FD9] hover:underline">View All Campaigns<ArrowRight className="h-3.5 w-3.5" /></button>} />
      </div>
      <div className="overflow-x-auto">
        <table className={`!min-w-0 w-full text-left text-[13px] ${mode === "engagement" ? "min-w-[600px]" : "min-w-[440px]"}`}>
          <thead><tr className={thRow}>
            <th className="px-4 py-2.5">Campaign</th><th className="px-2 py-2.5 text-right">Sent</th>
            {mode === "engagement"
              ? <><th className="px-2 py-2.5 text-right">Open Rate</th><th className="px-2 py-2.5 text-right">Click Rate</th><th className="px-2 py-2.5 text-right">Orders</th><th className="px-4 py-2.5">Status</th></>
              : <><th className="px-2 py-2.5 text-right">Delivered</th><th className="px-2 py-2.5 text-right">Spam %</th><th className="px-4 py-2.5 text-right">Bounce %</th></>}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500">No campaign emails sent yet.</td></tr>}
            {rows.map((row) => {
              const status = STATUS_LOOK[row.status] ?? STATUS_LOOK.draft;
              return (
                <tr key={row.id} className={tdRow}>
                  <td className="px-4 py-2"><span className="flex min-w-0 items-center gap-2.5"><Thumb src={row.thumbnailUrl} size={34} goal={row.goal} /><span className="min-w-0"><span className={`block truncate font-semibold text-gray-900 dark:text-slate-50 ${mode === "engagement" ? "max-w-[220px]" : "max-w-[170px]"}`} title={row.name}>{row.name}</span><span className={`block truncate text-[11.5px] text-gray-500 ${mode === "engagement" ? "max-w-[220px]" : "max-w-[170px]"}`}>{row.audienceLabel}</span></span></span></td>
                  <td className="px-2 py-2 text-right">{count(row.sent)}</td>
                  {mode === "engagement" ? <>
                    <td className="px-2 py-2 text-right font-semibold">{pct(row.openRate)}</td>
                    <td className="px-2 py-2 text-right">{pct(row.clickRate)}</td>
                    <td className="px-2 py-2 text-right">{count(row.conversions)}</td>
                    <td className="px-4 py-2"><Pill tone={status.tone}>{status.label}</Pill></td>
                  </> : <>
                    <td className="px-2 py-2 text-right font-semibold">{pct(row.deliveredRate)}</td>
                    <td className="px-2 py-2 text-right">{reportsOn ? pct(row.spamRate) : "—"}</td>
                    <td className="px-4 py-2 text-right">{reportsOn ? pct(row.bounceRate) : "—"}</td>
                  </>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function EngagementTab({ data, nav }: TabProps) {
  const e = data.engagement.kpis;
  const grade = e.people === 0 || e.openRate === null ? null : e.openRate >= 40 ? "Excellent" : e.openRate >= 25 ? "Good" : e.openRate >= 15 ? "Fair" : "Poor";
  const insights: Array<{ ok: boolean; text: string }> = [];
  if (e.people > 0) {
    insights.push(e.openRate !== null && e.openRate >= 25 ? { ok: true, text: `${pct(e.openRate)} of the people emailed opened: a healthy open rate.` } : { ok: false, text: `Only ${pct(e.openRate)} opened. Try a clearer subject line and a better send time.` });
    if (e.openChange !== null) insights.push(e.openChange >= 0 ? { ok: true, text: `Opens are up ${e.openChange.toFixed(1)} points on the period before.` } : { ok: false, text: `Opens are down ${Math.abs(e.openChange).toFixed(1)} points on the period before.` });
    insights.push(e.clickRate !== null && e.clickRate >= 2 ? { ok: true, text: `${pct(e.clickRate)} clicked a link.` } : { ok: false, text: `Few clicks (${pct(e.clickRate)}). Put one clear button near the top of the email.` });
    const best = data.engagement.segments.filter((row) => row.sent >= 10 && row.openRate !== null).sort((a, b) => (b.openRate ?? 0) - (a.openRate ?? 0))[0];
    if (best) insights.push({ ok: true, text: `"${best.name}" opens the most (${pct(best.openRate)}).` });
    if (e.inactive > 0) insights.push({ ok: false, text: `${count(e.inactive)} ${e.inactive === 1 ? "person has" : "people have"} not opened in 90+ days.` });
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <HealthKpi icon={MailOpen} label="Open Rate" value={pct(e.openRate)}>{pts(e.openChange)}</HealthKpi>
        <HealthKpi icon={MousePointerClick} tone="blue" label="Click-Through Rate" value={pct(e.clickRate)}>{pts(e.clickChange)}</HealthKpi>
        <HealthKpi icon={Repeat} tone="green" label="Repeat Engagement" value={pct(e.repeatEngagement)}>{pts(e.repeatChange)}<span>opened 2+ campaigns</span></HealthKpi>
        <HealthKpi icon={Users} label="Active Audience" value={count(e.active)} sub={e.activePercent === null ? undefined : `(${pct(e.activePercent)})`}><span>opened in 30 days</span></HealthKpi>
        <HealthKpi icon={UserX} tone="red" label="Inactive Audience" value={count(e.inactive)} sub={e.inactivePercent === null ? undefined : `(${pct(e.inactivePercent)})`}><span>no opens in 90+ days</span></HealthKpi>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ScoreCard title="Engagement Score" tip="The share of people emailed in these days who opened at least one email." value={e.people ? e.openRate : null} ringLabel="Engaged" grade={grade}
          text={grade === null ? "Shows once campaign emails go out." : grade === "Excellent" || grade === "Good" ? "Your audience reads your emails. Keep sending things they want." : "Many people are not opening. Work on subject lines, timing and who you send to."} />
        <Card className="p-4">
          <CardHead title="Engagement Breakdown" sub={`${count(e.people)} ${e.people === 1 ? "person" : "people"} emailed in these days`} />
          <div className="space-y-3.5">
            <BarRow icon={MailOpen} label="Opened (Unique)" value={count(e.opened)} percent={e.openRate} color={SERIES.a} />
            <BarRow icon={MousePointerClick} label="Clicked (Unique)" value={count(e.clicked)} percent={e.clickRate} color={SERIES.b} />
            <BarRow icon={RefreshCw} label="Re-engaged" value={count(e.reengaged)} percent={share(e.reengaged, e.people)} color={STATUS.info} />
            <BarRow icon={Users} label="Active (Last 30 Days)" value={count(e.active)} percent={e.activePercent} color={STATUS.good} />
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Engagement Trend" tip="Of the emails sent each day, the share opened and clicked." sub={<Legend items={[{ label: "Open Rate", color: SERIES.a }, { label: "Click Rate", color: SERIES.b }]} />} />
          <TrendChart data={data.engagement.trend} series={[{ key: "openRate", label: "Open Rate", color: SERIES.a }, { key: "clickRate", label: "Click Rate", color: SERIES.b }]} domain={[0, 100]} height={200} empty="Shows once campaign emails go out." />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
        <Card className="overflow-hidden">
          <div className="p-4 pb-0"><CardHead title="Engagement by Segment" sub="Emails of the last 30 days" /></div>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[500px] text-left text-[13px]">
              <thead><tr className={thRow}><th className="px-4 py-2.5">Segment</th><th className="px-2 py-2.5 text-right">Audience</th><th className="px-2 py-2.5 text-right">Open Rate</th><th className="px-2 py-2.5 text-right">Click Rate</th><th className="px-4 py-2.5">Engagement</th></tr></thead>
              <tbody>
                {data.engagement.segments.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">No segment has people to email yet.</td></tr>}
                {data.engagement.segments.map((row) => {
                  const look = ENGAGEMENT_LOOK[row.engagement] ?? ENGAGEMENT_LOOK.none;
                  return (
                    <tr key={row.id} className={tdRow}>
                      <td className="px-4 py-2.5"><span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-50"><SegmentIcon name={row.icon} className="h-4 w-4 shrink-0 text-[#5B3FD9]" /><span className="max-w-[170px] truncate" title={row.name}>{row.name}</span></span></td>
                      <td className="px-2 py-2.5 text-right">{count(row.audience)}</td>
                      <td className="px-2 py-2.5 text-right font-semibold">{pct(row.openRate)}</td>
                      <td className="px-2 py-2.5 text-right">{pct(row.clickRate)}</td>
                      <td className="px-4 py-2.5"><Pill tone={look.tone}>{look.label}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <CampaignTable rows={data.engagement.campaigns} mode="engagement" onAll={nav.campaigns} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,2.2fr)]">
        <Insights title="Engagement Insights" items={insights} />
        <ActionCards items={[
          { icon: RefreshCw, title: "Run Re-engagement Campaign", text: "Win back people who stopped opening, with a fresh offer.", button: "Create Campaign", onClick: () => nav.create() },
          { icon: Sparkles, tone: "green", title: "Nurture High-Engaged Audience", text: "Follow up with buyers automatically after delivery.", button: "Set Up Automation", onClick: () => nav.create("post_purchase") },
          { icon: Layers, tone: "blue", title: "Personalize Offers", text: "Group people by what they bought and send each group its own offer.", button: "Create Segment", onClick: nav.createSegment },
          { icon: Timer, tone: "amber", title: "Find the Best Send Time", text: "Test two subject lines (A/B) and send when your customers order most.", button: "Run A/B Test", onClick: () => nav.create() }
        ]} />
      </div>
    </div>
  );
}
