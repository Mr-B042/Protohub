import { useState } from "react";
import {
  AlertTriangle, ArrowRight, Bell, CheckCircle2, ChevronLeft, ChevronRight, Clock, Copy, Flame, Gauge, Inbox, KeyRound, Layers, Link2, Mail, MailX, MousePointerClick,
  Repeat, Rocket, Send, Settings, ShieldCheck, ShoppingBag, Sparkles, TrendingDown, TrendingUp, UserMinus, UserPlus, Users, Wallet, Wrench, XCircle
} from "lucide-react";
import type { EmHealth, EmHealthIssue } from "../../lib/api";
import { Card, Delta, Donut, Pill, SegmentIcon, btn, count, lagosDate, naira, pct } from "./em-ui";
import type { HealthNav } from "./AudienceHealthPage";
import { CampaignTable } from "./HealthTabsA";
import { ActionCards, BarRow, CardHead, GradePill, HealthKpi, Insights, Legend, NotMeasured, Ring, SERIES, STATUS, ScoreCard, TrendChart, dayLabel, tdRow, thRow } from "./health-ui";

/** Audience Health: Deliverability, Growth & Churn, Segments Health, Issues & Actions (Bright's designs M, N, O, P). */

type TabProps = { data: EmHealth; nav: HealthNav };

const pts = (value: number | null | undefined, goodWhenDown = false) => <Delta value={value} suffix=" pts" goodWhenDown={goodWhenDown} />;
const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

// ── Deliverability ────────────────────────────────────────────────────

const AUTH_LOOK = {
  verified: { label: "Verified", tone: "green" }, other: { label: "Found, but not for Mailjet", tone: "amber" }, missing: { label: "Not found", tone: "red" },
  enforced: { label: "Enforced", tone: "green" }, monitoring: { label: "Found (monitor only)", tone: "blue" }
} as const;

export function DeliverabilityTab({ data, nav }: TabProps) {
  const d = data.deliverability.kpis;
  const on = data.bounceReports.on;
  const auth = data.auth;
  const needsReports = <NotMeasured text="Needs bounce reports" />;
  const insights: Array<{ ok: boolean; text: string }> = [];
  if (d.tried > 0) {
    insights.push(d.deliveredRate !== null && d.deliveredRate >= 95 ? { ok: true, text: `${pct(d.deliveredRate)} of emails were ${on ? "delivered" : "accepted by Mailjet"}.` } : { ok: false, text: `Only ${pct(d.deliveredRate)} of emails got through. Check the failed ones and your sending set-up.` });
    if (on && d.bounceRate !== null) insights.push(d.bounceRate < 2 ? { ok: true, text: `Bounce rate is low (${pct(d.bounceRate)}).` } : { ok: false, text: `Bounce rate is ${pct(d.bounceRate)}: clean the list before the next campaign.` });
    if (on && d.spamRate !== null) insights.push(d.spamRate < 0.1 ? { ok: true, text: "Almost nobody marks your emails as spam." } : { ok: false, text: `${pct(d.spamRate, 2)} marked an email as spam. Send only to people who expect your emails.` });
    if (d.failed > 0) insights.push({ ok: false, text: `${count(d.failed)} ${d.failed === 1 ? "email was" : "emails were"} refused by the email service.` });
  }
  if (!on) insights.push({ ok: false, text: "Bounce and spam reports are off, so bounces and spam complaints are not counted yet." });
  if (auth) {
    insights.push(auth.spf === "verified" && auth.dkim === "verified" ? { ok: true, text: `SPF and DKIM are set up for ${auth.domain}.` } : { ok: false, text: `Sender checks are not complete for ${auth.domain}: add the missing records your email service gives you.` });
    if (auth.dmarc === "monitoring") insights.push({ ok: true, text: "DMARC is set to monitor only. That is fine to start; you can make it stricter later." });
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HealthKpi icon={Send} label="Emails Sent" value={count(d.tried)} />
        <HealthKpi icon={CheckCircle2} tone="green" label="Delivered" value={count(d.delivered)} sub={`(${pct(d.deliveredRate)})`}>{pts(d.deliveredChange)}{!on && <span>accepted</span>}</HealthKpi>
        <HealthKpi icon={Inbox} tone="blue" label="Inbox Placement" value="—"><NotMeasured text="Needs an inbox test service" /></HealthKpi>
        <HealthKpi icon={Flame} tone="amber" label="Spam Rate" value={on ? pct(d.spamRate, 2) : "—"}>{on ? pts(d.spamChange, true) : needsReports}</HealthKpi>
        <HealthKpi icon={MailX} tone="red" label="Bounce Rate" value={on ? pct(d.bounceRate) : "—"}>{on ? pts(d.bounceChange, true) : needsReports}</HealthKpi>
        <HealthKpi icon={XCircle} tone="red" label="Failed" value={pct(d.failedRate)} sub={`(${count(d.failed)})`}>{pts(d.failedChange, true)}</HealthKpi>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ScoreCard title="Deliverability Score" tip={on ? "The share of emails sent that were delivered (not bounced or refused)." : "The share of emails the email service accepted. Switch on bounce reports to take bounces off too."}
          value={data.deliverability.score} ringLabel={on ? "Delivered" : "Accepted"} grade={data.deliverability.grade}
          text={data.deliverability.grade === null ? "Shows once campaign emails go out." : data.deliverability.grade === "Excellent" || data.deliverability.grade === "Good" ? "Your emails are getting through. Keep the list clean to stay here." : "Too many emails are not getting through. Start with the open issues."} />
        <Card className="p-4">
          <CardHead title="Delivery Breakdown" />
          <div className="space-y-1">
            {[
              { icon: CheckCircle2, label: on ? "Delivered" : "Accepted by Mailjet", value: d.delivered, rate: d.deliveredRate, color: "text-emerald-600", known: true },
              { icon: Flame, label: "Marked as Spam", value: d.spam, rate: d.spamRate, color: "text-amber-600", known: on },
              { icon: MailX, label: "Bounced", value: d.bounced, rate: d.bounceRate, color: "text-rose-600", known: on },
              { icon: XCircle, label: "Failed", value: d.failed, rate: d.failedRate, color: "text-rose-600", known: true }
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px]">
                <row.icon className={`h-4 w-4 ${row.color}`} />
                <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{row.label}</span>
                {row.known ? <><span className="font-bold text-gray-900 dark:text-slate-50">{count(row.value)}</span><span className="w-14 text-right text-gray-600">{pct(row.rate, row.label === "Marked as Spam" ? 2 : 1)}</span></> : needsReports}
              </div>
            ))}
            <div className="flex items-center gap-2.5 rounded-lg bg-[#F5F2FE] px-2 py-2 text-[13px] font-bold dark:bg-violet-500/10">
              <Mail className="h-4 w-4 text-[#5B3FD9]" /><span className="min-w-0 flex-1 text-gray-900 dark:text-slate-50">Total Sent</span>
              <span className="text-gray-900 dark:text-slate-50">{count(d.tried)}</span><span className="w-14 text-right text-gray-700 dark:text-slate-300">{d.tried ? "100%" : "—"}</span>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Delivery Trend" sub={on ? "Share delivered of the emails sent each day" : "Share accepted of the emails sent each day"} />
          <TrendChart data={data.deliverability.trend} series={[{ key: "value", label: on ? "Delivered" : "Accepted", color: SERIES.a, kind: "area" }]} domain={[0, 100]} height={200} empty="Shows once campaign emails go out." />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]">
        <Card className="p-4">
          <CardHead title="Sender Reputation" tip="Sender score, domain and IP reputation are given by outside services that track mail across many senders. Protohub can't measure them; list reputation comes from your own bounce, spam and unsubscribe rates." />
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {[
              { label: "Sender Score", value: <NotMeasured text="Needs an outside service" /> },
              { label: "Domain Reputation", value: <NotMeasured text="Needs an outside service" /> },
              { label: "IP Reputation", value: <NotMeasured text="Mailjet's shared servers" /> },
              { label: "List Reputation", value: <GradePill grade={data.deliverability.listReputation} empty="Shows once emails go out" /> }
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2 py-2.5 text-[13px]">
                <Gauge className="h-4 w-4 text-[#5B3FD9]" /><span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{row.label}</span>{row.value}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Authentication Status" sub={auth ? `Checked for ${auth.domain}` : undefined} tip="SPF, DKIM and DMARC are records on your web address that prove your emails really come from you. Checked every 6 hours." />
          {!auth && <p className="m-0 text-[13px] text-gray-600 dark:text-slate-400">Add a sender address in Settings › Email to check these.</p>}
          {auth && (
            <div className="divide-y divide-gray-100 dark:divide-slate-800">
              {[
                { icon: KeyRound, label: "SPF", look: AUTH_LOOK[auth.spf] },
                { icon: KeyRound, label: "DKIM", look: AUTH_LOOK[auth.dkim] },
                { icon: ShieldCheck, label: "DMARC", look: AUTH_LOOK[auth.dmarc] },
                { icon: Link2, label: "Custom Tracking Domain", look: { label: "Not set", tone: "slate" }, note: "Email links go through Protohub's own address." }
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-2 py-2.5 text-[13px]" title={"note" in row ? row.note : undefined}>
                  {row.look.tone === "green" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : row.look.tone === "red" ? <XCircle className="h-4 w-4 text-rose-600" /> : <row.icon className="h-4 w-4 text-gray-400" />}
                  <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{row.label}</span><Pill tone={row.look.tone}>{row.look.label}</Pill>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2.5 text-[13px] dark:border-slate-800">
            <Bell className="h-4 w-4 text-[#5B3FD9]" /><span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">Bounce &amp; spam reports</span>
            {on ? <Pill tone="green">On</Pill> : <button type="button" onClick={nav.bounceReports} className={btn.outline}>Switch on</button>}
          </div>
        </Card>
        <CampaignTable rows={data.deliverability.campaigns} mode="delivery" onAll={nav.campaigns} reportsOn={on} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,2.2fr)]">
        <Insights items={insights} />
        <ActionCards items={[
          { icon: Sparkles, title: "Keep List Clean", text: "Stop emailing bounced addresses and people who never open.", button: "Clean List", onClick: nav.clean },
          { icon: ShieldCheck, tone: "green", title: "Maintain Authentication", text: "Keep SPF, DKIM and DMARC in place on your sending address.", button: "View Settings", onClick: nav.emailSetup },
          { icon: Rocket, tone: "blue", title: "Warm Up Sending", text: "Start with a low daily limit and raise it week by week.", button: "Set Daily Limit", onClick: nav.settings },
          { icon: Bell, tone: "amber", title: "Monitor Continuously", text: "Get an alert when a serious email list problem appears.", button: "Set Alerts", onClick: nav.alerts }
        ]} />
      </div>
    </div>
  );
}

// ── Growth & Churn ────────────────────────────────────────────────────

const heat = (value: number | null) => (value === null ? undefined : { background: `rgba(22, 163, 74, ${0.08 + 0.62 * Math.max(0, Math.min(1, value / 100))})`, color: value >= 60 ? "#fff" : undefined });

export function GrowthTab({ data, nav }: TabProps) {
  const g = data.growth.kpis;
  const v = data.growth.value;
  const change = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 1000) / 10);
  const insights: Array<{ ok: boolean; text: string }> = [];
  if (g.total > 0) {
    insights.push(g.net >= 0 ? { ok: true, text: `The list grew by ${count(g.net)} in these days (${count(g.added)} joined, ${count(g.churned)} left).` } : { ok: false, text: `The list shrank by ${count(Math.abs(g.net))}: more people left than joined.` });
    if (g.churnRate !== null) insights.push(g.churnRate < 2 ? { ok: true, text: `Churn is low (${pct(g.churnRate)}).` } : { ok: false, text: `Churn is ${pct(g.churnRate)}. Send fewer, more useful emails.` });
    if (v.repeatRate !== null) insights.push({ ok: v.repeatRate >= 20, text: `${pct(v.repeatRate)} of customers on the list bought twice or more.` });
    if (g.added === 0) insights.push({ ok: false, text: "Nobody joined the list in these days. Check that the order form's Email box is on." });
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <HealthKpi icon={Users} label="Total Audience" value={count(g.total)} />
        <HealthKpi icon={UserPlus} tone="green" label="New Subscribers" value={count(g.added)}><Delta value={g.addedChange} /></HealthKpi>
        <HealthKpi icon={TrendingUp} tone="blue" label="Net Growth" value={`${g.net > 0 ? "+" : ""}${count(g.net)}`}><Delta value={g.netChange} /></HealthKpi>
        <HealthKpi icon={UserMinus} tone="red" label="Churned (Unsubscribed / Bounced)" value={count(g.churned)} sub={g.churnRate === null ? undefined : `(${pct(g.churnRate)})`}>{pts(g.churnChange, true)}</HealthKpi>
        <HealthKpi icon={Repeat} tone="green" label="Retention Rate" value={pct(g.retentionRate)}>{pts(g.retentionChange)}</HealthKpi>
        <HealthKpi icon={Wallet} tone="amber" label="Audience LTV" value={g.ltv === null ? "—" : naira(g.ltv)}><Delta value={g.ltvChange} /><span title="Money from delivered orders per customer on the list who bought">so far</span></HealthKpi>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <CardHead title="Audience Growth Trend" sub={<Legend items={[{ label: "Subscribed (left scale)", color: SERIES.a }, { label: "New Subscribers (right scale)", color: SERIES.b, bar: true }]} />} />
          <TrendChart data={data.growth.series} series={[
            { key: "total", label: "Subscribed", color: SERIES.a, unit: "count" },
            { key: "added", label: "New Subscribers", color: SERIES.b, kind: "bar", axis: "right", unit: "count" }
          ]} empty="Shows once people join the list." />
        </Card>
        <Card className="p-4">
          <CardHead title="Churn (Audience Loss) Trend" tip="Churn: unsubscribed or bounced. A list clean-up is not counted." sub={<Legend items={[{ label: "Churned (left scale)", color: SERIES.a, bar: true }, { label: "Churn Rate (right scale)", color: STATUS.bad }]} />} />
          <TrendChart data={data.growth.series} series={[
            { key: "churned", label: "Churned", color: SERIES.a, kind: "bar", unit: "count" },
            { key: "churnRate", label: "Churn Rate", color: STATUS.bad, axis: "right", unit: "percent" }
          ]} empty="Nobody has left the list in these days." />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="overflow-hidden">
          <div className="p-4 pb-0"><CardHead title="Growth & Churn Summary" /></div>
          <table className="!min-w-0 w-full text-left text-[12.5px]">
            <thead><tr className={thRow}><th className="px-4 py-2">Metric</th><th className="px-2 py-2 text-right">Current Period</th><th className="px-2 py-2 text-right">Previous Period</th><th className="px-4 py-2 text-right">Change</th></tr></thead>
            <tbody>
              {data.growth.summary.map((row) => {
                const fmt = (value: number | null) => (value === null ? "—" : row.percent ? pct(value) : count(value));
                const diff = row.percent ? (row.now === null || row.before === null ? null : Math.round((row.now - row.before) * 10) / 10) : change(row.now, row.before);
                return (
                  <tr key={row.key} className={tdRow}>
                    <td className="px-4 py-2 font-semibold text-gray-800 dark:text-slate-200">{row.label}</td>
                    <td className="px-2 py-2 text-right font-bold">{fmt(row.now)}</td>
                    <td className="px-2 py-2 text-right text-gray-600">{fmt(row.before)}</td>
                    <td className="px-4 py-2 text-right"><Delta value={diff} suffix={row.percent ? " pts" : "%"} goodWhenDown={!row.goodWhenUp} note="—" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card className="overflow-hidden">
          <div className="p-4 pb-0"><CardHead title="Audience Cohort Retention" tip="Of the people who joined in a month, the share still on the list 7, 14, 30, 60 and 90 days later. A dash: not that old yet." /></div>
          <div className="overflow-x-auto px-4 pb-4">
            <table className="!min-w-0 w-full min-w-[340px] border-separate border-spacing-1 text-center text-[12px]">
              <thead><tr className="text-[11px] font-bold uppercase text-gray-500"><th className="px-1 py-1 text-left">Joined</th>{[7, 14, 30, 60, 90].map((day) => <th key={day} className="px-1 py-1">Day {day}</th>)}</tr></thead>
              <tbody>
                {data.growth.cohorts.map((row) => (
                  <tr key={row.month}>
                    <td className="whitespace-nowrap px-1 py-1 text-left font-semibold text-gray-800 dark:text-slate-200">{row.label}<span className="block text-[10.5px] font-normal text-gray-500">{count(row.size)} joined</span></td>
                    {row.cells.map((cell, index) => <td key={index} className="rounded-md px-1 py-1.5 font-semibold text-gray-800 dark:text-slate-100" style={heat(cell)}>{cell === null ? "–" : pct(cell, 0)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Customer Value & Behavior" tip="Customers on the email list, matched to their delivered orders by phone." />
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {[
              { icon: ShoppingBag, label: "Avg. Order Value (Delivered)", value: v.aov === null ? "—" : naira(v.aov), delta: <Delta value={change(v.aov, v.aovBefore)} /> },
              { icon: Repeat, label: "Purchase Frequency", value: v.frequency === null ? "—" : v.frequency.toFixed(2), delta: <Delta value={change(v.frequency, v.frequencyBefore)} />, tip: "Delivered orders per customer who bought in these days" },
              { icon: Wallet, label: "LTV So Far", value: v.ltv === null ? "—" : naira(v.ltv), delta: <Delta value={change(v.ltv, v.ltvBefore)} /> },
              { icon: Users, label: "Repeat Buyer Rate", value: pct(v.repeatRate), delta: pts(v.repeatRate === null || v.repeatRateBefore === null ? null : Math.round((v.repeatRate - v.repeatRateBefore) * 10) / 10) }
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2.5 py-2.5" title={row.tip}>
                <row.icon className="h-4 w-4 text-[#5B3FD9]" /><span className="min-w-0 flex-1 text-[13px] text-gray-700 dark:text-slate-300">{row.label}</span>
                <span className="text-[14.5px] font-bold text-gray-900 dark:text-slate-50">{row.value}</span><span className="w-[78px] text-right">{row.delta}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,2.2fr)]">
        <Insights items={insights} />
        <ActionCards items={[
          { icon: UserPlus, title: "Acquire More Subscribers", text: "Add people by hand or upload a list. New orders join by themselves.", button: "Add Subscribers", onClick: nav.audience },
          { icon: TrendingDown, tone: "red", title: "Reduce Churn", text: "Bring back customers who stopped buying before they leave the list.", button: "Set Up Win-back", onClick: () => nav.create("win_back") },
          { icon: Repeat, tone: "green", title: "Improve Retention", text: "Follow up after each delivery so customers buy again.", button: "Set Up Sequence", onClick: () => nav.create("post_purchase") },
          { icon: Wallet, tone: "amber", title: "Increase LTV", text: "Offer an upgrade or a matching product to recent buyers.", button: "Create Offer", onClick: () => nav.create() }
        ]} />
      </div>
    </div>
  );
}

// ── Segments Health ───────────────────────────────────────────────────

const HEALTH_LOOK = { healthy: { label: "Healthy", tone: "green" }, at_risk: { label: "At Risk", tone: "amber" }, unhealthy: { label: "Unhealthy", tone: "red" } } as const;

export function SegmentsTab({ data, nav }: TabProps) {
  const sg = data.segments;
  const k = sg.kpis;
  const c = sg.checks;
  const [page, setPage] = useState(1);
  const perPage = 6;
  const pages = Math.max(1, Math.ceil(sg.rows.length / perPage));
  const rows = sg.rows.slice((page - 1) * perPage, page * perPage);
  const insights: Array<{ ok: boolean; text: string }> = [];
  if (k.total > 0) {
    insights.push({ ok: k.healthy === k.total, text: `${count(k.healthy)} of ${count(k.total)} segments are healthy.` });
    for (const row of sg.rows.filter((item) => item.health !== "healthy").slice(0, 3)) {
      insights.push({ ok: false, text: row.audience === 0 ? `"${row.name}" has nobody to email.` : `"${row.name}" is ${row.health === "at_risk" ? "at risk" : "unhealthy"}${row.openRate !== null ? ` (opens ${pct(row.openRate)})` : ""}.` });
    }
    const best = sg.rows.filter((row) => row.sent >= 10 && row.openRate !== null).sort((a, b) => (b.openRate ?? 0) - (a.openRate ?? 0))[0];
    if (best) insights.push({ ok: true, text: `"${best.name}" has the best open rate (${pct(best.openRate)}).` });
  }
  const checkRows = [
    { label: "Valid Contacts", value: c.valid, ok: true },
    { label: "Duplicates", value: c.duplicate, ok: share(c.duplicate, c.total) === null || share(c.duplicate, c.total)! < 3 },
    { label: "Invalid / Bounced", value: c.bounced, ok: share(c.bounced, c.total) === null || share(c.bounced, c.total)! < 2 },
    { label: "Unsubscribed", value: c.unsubscribed, ok: share(c.unsubscribed, c.total) === null || share(c.unsubscribed, c.total)! < 5 }
  ];
  const firstReading = sg.trend.find((row) => row.healthy !== null)?.day ?? null;
  const hygieneGrade = c.hygiene === null ? null : c.hygiene >= 95 ? "Excellent" : c.hygiene >= 85 ? "Good" : c.hygiene >= 70 ? "Fair" : "Poor";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <HealthKpi icon={Layers} label="Total Segments" value={count(k.total)} />
        <HealthKpi icon={CheckCircle2} tone="green" label="Healthy Segments" value={count(k.healthy)} sub={`(${pct(share(k.healthy, k.total))})`} />
        <HealthKpi icon={AlertTriangle} tone="amber" label="At Risk" value={count(k.atRisk)} sub={`(${pct(share(k.atRisk, k.total))})`} />
        <HealthKpi icon={XCircle} tone="red" label="Unhealthy" value={count(k.unhealthy)} sub={`(${pct(share(k.unhealthy, k.total))})`} />
        <HealthKpi icon={Users} tone="blue" label="Total in Segments" value={count(k.inSegments)}><span>in at least one</span></HealthKpi>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <ScoreCard title="Segments Health Overview" tip="Unhealthy: nobody to email, or 30%+ bounced or unsubscribed. At risk: 15%+ gone, or under 15% opening after 10+ emails in 30 days."
          value={sg.healthPercent} ringLabel="Healthy" grade={sg.grade}
          text={k.total === 0 ? "Shows once you have segments." : k.healthy === k.total ? "All your segments are in good shape." : "Some segments need attention: see the list below."} />
        <Card className="p-4">
          <CardHead title="Segments by Health Status" />
          <div className="space-y-3.5">
            <BarRow icon={CheckCircle2} label="Healthy Segments" value={count(k.healthy)} percent={share(k.healthy, k.total)} color={STATUS.good} />
            <BarRow icon={AlertTriangle} label="At Risk" value={count(k.atRisk)} percent={share(k.atRisk, k.total)} color={STATUS.warn} />
            <BarRow icon={XCircle} label="Unhealthy" value={count(k.unhealthy)} percent={share(k.unhealthy, k.total)} color={STATUS.bad} />
            <div className="flex items-center gap-2 rounded-lg bg-[#F5F2FE] px-2 py-2 text-[13px] font-bold dark:bg-violet-500/10">
              <Layers className="h-4 w-4 text-[#5B3FD9]" /><span className="min-w-0 flex-1">Total Segments</span><span>{count(k.total)}</span><span className="w-14 text-right">{k.total ? "100%" : "—"}</span>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Segment Health Trend" sub={<>{firstReading ? `One reading a day, since ${dayLabel(firstReading)}` : "One reading a day"}<span className="mt-1 block"><Legend items={[{ label: "Healthy", color: STATUS.good }, { label: "At Risk", color: STATUS.warn }, { label: "Unhealthy", color: STATUS.bad }]} /></span></>} />
          <TrendChart data={sg.trend} series={[
            { key: "healthy", label: "Healthy", color: STATUS.good }, { key: "atRisk", label: "At Risk", color: STATUS.warn }, { key: "unhealthy", label: "Unhealthy", color: STATUS.bad }
          ]} domain={[0, 100]} height={200} empty="The first reading is today; the trend grows day by day." />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="p-4 pb-0">
            <CardHead title="Segments Performance" sub="Opens and clicks of the last 30 days"
              right={<button type="button" onClick={nav.audience} className="!min-h-0 inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#5B3FD9] hover:underline">View All Segments<ArrowRight className="h-3.5 w-3.5" /></button>} />
          </div>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[680px] text-left text-[13px]">
              <thead><tr className={thRow}>
                <th className="px-4 py-2.5">Segment Name</th><th className="px-2 py-2.5 text-right">Audience</th><th className="px-2 py-2.5 text-right">Growth</th><th className="px-2 py-2.5 text-right">Open Rate</th>
                <th className="px-2 py-2.5 text-right">Click Rate</th><th className="px-2 py-2.5">Health</th><th className="px-4 py-2.5 text-right">Action</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500">No segments yet.</td></tr>}
                {rows.map((row) => (
                  <tr key={row.id} className={tdRow}>
                    <td className="px-4 py-2.5"><span className="flex items-center gap-2 font-semibold text-gray-900 dark:text-slate-50"><SegmentIcon name={row.icon} className="h-4 w-4 text-[#5B3FD9]" /><span className="max-w-[220px] truncate" title={row.name}>{row.name}</span></span></td>
                    <td className="px-2 py-2.5 text-right">{count(row.audience)}</td>
                    <td className="px-2 py-2.5 text-right">{row.growth === null ? "—" : <Delta value={row.growth} />}</td>
                    <td className="px-2 py-2.5 text-right font-semibold">{pct(row.openRate)}</td>
                    <td className="px-2 py-2.5 text-right">{pct(row.clickRate)}</td>
                    <td className="px-2 py-2.5"><Pill tone={HEALTH_LOOK[row.health].tone}>{HEALTH_LOOK[row.health].label}</Pill></td>
                    <td className="px-4 py-2.5 text-right"><button type="button" onClick={nav.audience} className={btn.outline}>Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 text-[12.5px] text-gray-600">
              <span>Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, sg.rows.length)} of {sg.rows.length} segments</span>
              <span className="flex gap-1">
                <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" aria-label="Next page" disabled={page === pages} onClick={() => setPage(page + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
              </span>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <CardHead title="Segment Quality Checks" tip="The whole email list, which every segment draws from." />
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {checkRows.map((row) => (
              <div key={row.label} className="flex items-center gap-2 py-2.5 text-[13px]">
                {row.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
                <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{row.label}</span>
                <span className="font-bold text-gray-900 dark:text-slate-50">{count(row.value)}</span><span className="w-14 text-right text-gray-600">{pct(share(row.value, c.total))}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#F5F2FE] px-3 py-3 dark:bg-violet-500/10" title="The share of the list that is neither bounced nor a duplicate.">
            <ShieldCheck className="h-5 w-5 text-[#5B3FD9]" /><span className="min-w-0 flex-1 text-[13px] font-bold text-gray-900 dark:text-slate-50">List Hygiene Score</span>
            <span className="text-[16px] font-extrabold text-gray-900 dark:text-slate-50">{pct(c.hygiene)}</span><GradePill grade={hygieneGrade} empty="—" />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,2.2fr)]">
        <Insights items={insights} />
        <ActionCards items={[
          { icon: AlertTriangle, tone: "amber", title: "Improve At-Risk Segment", text: "Send an at-risk segment a fresh, useful offer.", button: "Create Campaign", onClick: () => nav.create() },
          { icon: Copy, tone: "blue", title: "Clean & Merge", text: "Stop emailing older duplicate emails and bounced addresses.", button: "Clean Segments", onClick: nav.clean },
          { icon: Wrench, tone: "red", title: "Rebuild Unhealthy Segment", text: "Change the rules of a segment that has nobody left to email.", button: "Rebuild", onClick: nav.audience },
          { icon: Settings, title: "Set Segment Rules", text: "Review who each segment takes in and leaves out.", button: "Manage Rules", onClick: nav.audience }
        ]} />
      </div>
    </div>
  );
}

// ── Issues & Actions ──────────────────────────────────────────────────

const AREA_LOOK: Record<EmHealthIssue["area"], { label: string; icon: typeof Send }> = {
  deliverability: { label: "Deliverability", icon: Send }, engagement: { label: "Engagement", icon: MousePointerClick }, quality: { label: "Quality & Validity", icon: ShieldCheck },
  segments: { label: "Segments Health", icon: Layers }, growth: { label: "Growth & Churn", icon: TrendingUp }
};
const SEVERITY_LOOK: Record<EmHealthIssue["severity"], { label: string; tone: string; color: string }> = {
  critical: { label: "Critical", tone: "red", color: STATUS.bad }, high: { label: "High", tone: "orange", color: "#EA580C" },
  medium: { label: "Medium", tone: "amber", color: "#EAB308" }, low: { label: "Low", tone: "blue", color: STATUS.info }
};

export function IssuesTab({ data, nav }: TabProps) {
  const is = data.issues;
  const k = is.counts;
  const [page, setPage] = useState(1);
  const perPage = 5;
  const pages = Math.max(1, Math.ceil(is.open.length / perPage));
  const rows = is.open.slice((page - 1) * perPage, page * perPage);
  const openChange = k.openBefore > 0 ? Math.round(((k.open - k.openBefore) / k.openBefore) * 1000) / 10 : null;
  const severities = (["critical", "high", "medium", "low"] as const).map((key) => ({ key, ...SEVERITY_LOOK[key], value: k[key] }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <HealthKpi icon={AlertTriangle} tone="red" label="Open Issues" value={count(k.open)}><Delta value={openChange} goodWhenDown /></HealthKpi>
        <HealthKpi icon={Flame} tone="red" label="Critical" value={count(k.critical)} />
        <HealthKpi icon={AlertTriangle} tone="amber" label="High Priority" value={count(k.high)} />
        <HealthKpi icon={Clock} tone="amber" label="Medium" value={count(k.medium)} />
        <HealthKpi icon={Bell} tone="blue" label="Low" value={count(k.low)} />
        <HealthKpi icon={CheckCircle2} tone="green" label="Resolved (30 Days)" value={count(k.resolved30)} />
        <HealthKpi icon={Gauge} tone="green" label="Resolution Rate" value={pct(k.resolutionRate)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="p-4">
          <CardHead title="Issues Overview" />
          <div className="flex flex-wrap items-center gap-4">
            <Donut slices={severities.map((row) => ({ value: row.value, color: row.color }))} size={140} stroke={20}>
              <span className="text-[22px] font-extrabold text-gray-900 dark:text-slate-50">{count(k.open)}</span><span className="text-[12px] text-gray-500">Open Issues</span>
            </Donut>
            <ul className="m-0 min-w-[150px] flex-1 list-none space-y-1.5 p-0">
              {severities.map((row) => (
                <li key={row.key} className="flex items-center gap-2 text-[12.5px]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
                  <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{row.label} ({row.value})</span>
                  <span className="text-gray-500">{pct(share(row.value, k.open))}</span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
        <Card className="p-4">
          <CardHead title="Issue Trends" sub="Open issues at the end of each day" />
          <TrendChart data={is.trend} series={[{ key: "open", label: "Open issues", color: SERIES.a, unit: "count" }]} height={190} empty="No issues in these days." />
        </Card>
        <Card className="p-4">
          <CardHead title="Resolution Summary" tip="An issue is resolved when the check no longer finds the problem. Last 30 days." />
          <div className="flex flex-wrap items-center gap-4">
            <Ring value={k.resolutionRate} label="Resolved" color={STATUS.good} size={130} />
            <div className="min-w-[140px] flex-1 space-y-2 text-[13px]">
              <div className="flex justify-between gap-2"><span className="text-gray-600 dark:text-slate-400">Resolved Issues</span><span className="font-bold">{count(k.resolved30)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-gray-600 dark:text-slate-400">Total Issues</span><span className="font-bold">{count(k.total)}</span></div>
              <div className="flex justify-between gap-2"><span className="text-gray-600 dark:text-slate-400">Avg. Time to Resolve</span><span className="font-bold">{k.avgHoursToFix === null ? "—" : `${k.avgHoursToFix} hours`}</span></div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="p-4 pb-0"><CardHead title={`Open Issues (${k.open})`} sub="Checked every time this page opens, and every morning" /></div>
          <div className="overflow-x-auto">
            <table className="!min-w-0 w-full min-w-[780px] text-left text-[13px]">
              <thead><tr className={thRow}>
                <th className="px-4 py-2.5">#</th><th className="px-2 py-2.5">Issue</th><th className="px-2 py-2.5">Area</th><th className="px-2 py-2.5">Severity</th>
                <th className="px-2 py-2.5">Detected</th><th className="px-2 py-2.5">Status</th><th className="px-4 py-2.5 text-right">Action</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500"><CheckCircle2 className="mr-1.5 inline h-4 w-4 text-emerald-600" />No open issues.</td></tr>}
                {rows.map((issue, index) => {
                  const area = AREA_LOOK[issue.area];
                  const severity = SEVERITY_LOOK[issue.severity];
                  return (
                    <tr key={issue.id} className={tdRow}>
                      <td className="px-4 py-2.5 text-gray-500">{(page - 1) * perPage + index + 1}</td>
                      <td className="px-2 py-2.5 font-semibold text-gray-900 dark:text-slate-50"><span className="block max-w-[300px]">{issue.title}</span></td>
                      <td className="px-2 py-2.5"><span className="flex items-center gap-1.5 whitespace-nowrap text-gray-700 dark:text-slate-300"><area.icon className="h-4 w-4 text-[#5B3FD9]" />{area.label}</span></td>
                      <td className="px-2 py-2.5"><Pill tone={severity.tone}>{severity.label}</Pill></td>
                      <td className="whitespace-nowrap px-2 py-2.5 text-gray-600">{lagosDate(issue.detectedAt, true)}</td>
                      <td className="px-2 py-2.5"><Pill tone="slate">Open</Pill></td>
                      <td className="px-4 py-2.5 text-right"><button type="button" onClick={() => nav.issue(issue)} className={`${btn.outline} whitespace-nowrap`}>Take Action<ArrowRight className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-2.5 text-[12.5px] text-gray-600">
              <span>Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, is.open.length)} of {is.open.length} issues</span>
              <span className="flex gap-1">
                <button type="button" aria-label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)} className={btn.icon}><ChevronLeft className="h-4 w-4" /></button>
                <button type="button" aria-label="Next page" disabled={page === pages} onClick={() => setPage(page + 1)} className={btn.icon}><ChevronRight className="h-4 w-4" /></button>
              </span>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <CardHead title="Recommended Actions" />
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {[
              { icon: Send, title: "Fix Deliverability", text: "Check bounces, failures and sender checks.", button: "Fix Now", run: () => nav.tab("deliverability") },
              { icon: Repeat, title: "Re-engage Inactive Audience", text: "Send people who stopped opening a fresh offer.", button: "Create Campaign", run: () => nav.create() },
              { icon: Sparkles, title: "Clean Audience List", text: "Stop emailing bounced, duplicate and never-opening contacts.", button: "Clean List", run: nav.clean },
              { icon: Layers, title: "Review Segment Rules", text: "Fix segments that are at risk or empty.", button: "Edit Rules", run: nav.audience },
              { icon: Bell, title: "Set Issue Alerts", text: "Choose who gets an alert for a serious problem.", button: "Set Alerts", run: nav.alerts }
            ].map((row) => (
              <div key={row.title} className="flex items-center gap-2.5 py-2.5">
                <row.icon className="h-4 w-4 shrink-0 text-[#5B3FD9]" />
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-gray-900 dark:text-slate-50">{row.title}</span><span className="block text-[12px] text-gray-500">{row.text}</span></span>
                <button type="button" onClick={row.run} className={btn.outline}>{row.button}</button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="p-4">
          <CardHead title="Issue Categories Breakdown" sub="Open issues by area" />
          <div className="space-y-3.5">
            {is.byArea.map((row) => <BarRow key={row.area} icon={AREA_LOOK[row.area].icon} label={AREA_LOOK[row.area].label} value={`(${row.count})`} percent={share(row.count, k.open)} color={SERIES.a} />)}
          </div>
        </Card>
        <ActionCards title="Quick Actions" items={[
          { icon: Sparkles, title: "Run List Cleaning", text: "Stop emailing bounced, duplicate and never-opening contacts.", button: "Clean List", onClick: nav.clean },
          { icon: Repeat, tone: "green", title: "Re-engagement Campaign", text: "Win back people who stopped opening.", button: "Create Campaign", onClick: () => nav.create() },
          { icon: ShieldCheck, tone: "blue", title: "Fix Deliverability", text: "Check and set up SPF, DKIM and DMARC.", button: "Check Set-up", onClick: () => nav.tab("deliverability") },
          { icon: Bell, tone: "amber", title: "Create Alert Rule", text: "Get an alert when a serious problem appears.", button: "Set Alerts", onClick: nav.alerts }
        ]} />
      </div>
    </div>
  );
}
