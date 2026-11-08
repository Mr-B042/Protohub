import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, ChevronRight, Download, Layers, MousePointerClick, RefreshCw, Send, ShieldCheck, TrendingUp } from "lucide-react";
import DateWindowNav from "../../components/DateWindowNav";
import { emailMarketingApi, type EmCleaningPlan, type EmHealth, type EmHealthIssue } from "../../lib/api";
import { presetRange, type DateWindow } from "../../lib/date-window";
import { ModalShell } from "./AudiencePage";
import { ErrorNote, Loading, btn, count, downloadCsv, pct, type EmSection } from "./em-ui";
import { DeliverabilityTab, GrowthTab, IssuesTab, SegmentsTab } from "./HealthTabsB";
import { EngagementTab, OverviewTab, QualityTab } from "./HealthTabsA";

/**
 * Audience Health (Bright's 7 designs, 8 Nov 2026): Email Marketing ›
 * Audience & Segments › Audience Health. Every number comes from the list,
 * the campaign emails and delivered orders; what needs an outside service
 * (inbox placement, sender score) says so instead of showing a number.
 */

export type HealthTab = "overview" | "quality" | "engagement" | "deliverability" | "growth" | "segments" | "issues";

const TABS: Array<{ key: HealthTab; label: string; icon: typeof Activity; title: string; sub: string }> = [
  { key: "overview", label: "Overview", icon: Activity, title: "Audience Health", sub: "Monitor the quality, engagement, and deliverability of your audience to keep your marketing effective." },
  { key: "quality", label: "Quality & Validity", icon: ShieldCheck, title: "Quality & Validity", sub: "Monitor your audience quality, validation status, and ensure your data is up to date and effective." },
  { key: "engagement", label: "Engagement", icon: MousePointerClick, title: "Engagement", sub: "Track how your audience interacts with your emails and campaigns, and identify ways to increase engagement." },
  { key: "deliverability", label: "Deliverability", icon: Send, title: "Deliverability", sub: "Monitor and improve how your emails get delivered, and check your sending set-up." },
  { key: "growth", label: "Growth & Churn", icon: TrendingUp, title: "Growth & Churn", sub: "Track your audience growth, churn (loss), retention, and lifetime value to drive long-term customer growth." },
  { key: "segments", label: "Segments Health", icon: Layers, title: "Segments Health", sub: "Monitor the size, quality, engagement, and performance of your audience segments." },
  { key: "issues", label: "Issues & Actions", icon: AlertTriangle, title: "Issues & Actions", sub: "Spot audience, deliverability, and engagement issues early and take quick action to keep performance on track." }
];

/** Where each tab's buttons lead. */
export type HealthNav = {
  tab: (tab: HealthTab) => void;
  create: (preset?: string) => void;
  createSegment: () => void;
  audience: () => void;
  campaigns: () => void;
  /** Email Marketing › Settings (daily limit). */
  settings: () => void;
  /** The app's Settings › Email (the email service). */
  emailSetup: () => void;
  /** The app's Settings › Alerts ("Email list problem"). */
  alerts: () => void;
  clean: () => void;
  bounceReports: () => void;
  issue: (issue: EmHealthIssue) => void;
};

const todayInLagos = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date());
const tabFromHash = (): HealthTab => {
  const tab = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("tab");
  return TABS.some((row) => row.key === tab) ? tab as HealthTab : "overview";
};

export default function AudienceHealthPage({ onNavigate, onCreate, onCreateSegment, onOpenSettings, onToast }: {
  onNavigate: (section: EmSection) => void;
  onCreate: (preset?: string) => void;
  onCreateSegment: () => void;
  onOpenSettings: (panel: "email" | "workspace") => void;
  onToast: (message: string) => void;
}) {
  const todayKey = useMemo(todayInLagos, []);
  const [tab, setTabState] = useState<HealthTab>(tabFromHash);
  const [window_, setWindow] = useState<DateWindow>(() => presetRange("last30", todayKey));
  const [data, setData] = useState<EmHealth | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<null | "clean" | "bounce">(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await emailMarketingApi.health({ from: window_.start, to: window_.end }));
      setError("");
    } catch (err) {
      setError((err as Error).message || "Could not load Audience Health.");
    } finally {
      setLoading(false);
    }
  }, [window_.start, window_.end]);
  useEffect(() => { void load(); }, [load]);
  // An alert clicked while this page is open changes only the address.
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const setTab = (next: HealthTab) => {
    setTabState(next);
    // Kept in the address so a reload (or an alert's link) opens the same tab.
    window.history.replaceState(null, "", `#/dashboard/admin/email-marketing/health${next === "overview" ? "" : `?tab=${next}`}`);
  };

  const nav: HealthNav = {
    tab: setTab,
    create: onCreate,
    createSegment: onCreateSegment,
    audience: () => onNavigate("audience"),
    campaigns: () => onNavigate("campaigns"),
    settings: () => onNavigate("settings"),
    emailSetup: () => onOpenSettings("email"),
    alerts: () => onOpenSettings("workspace"),
    clean: () => setModal("clean"),
    bounceReports: () => setModal("bounce"),
    issue: (issue) => {
      if (issue.key === "sender_not_ready" || issue.key === "send_failures") return onOpenSettings("email");
      if (issue.key === "daily_limit") return onNavigate("settings");
      if (issue.action === "clean") return setModal("clean");
      if (issue.action === "bounce_reports") return setModal("bounce");
      if (issue.action === "auth") return setTab("deliverability");
      if (issue.action === "winback") return onCreate("win_back");
      if (issue.action === "campaign") return onCreate();
      if (issue.action === "segments" || issue.action === "audience") return onNavigate("audience");
      if (issue.action === "form") return onToast("Switch the Email box on in Embed Form › Create Order Form › Form fields & validation.");
      return onNavigate("audience");
    }
  };

  const meta = TABS.find((row) => row.key === tab)!;
  const HeadIcon = meta.icon;
  const empty = data && data.overview.kpis.total.value === 0;
  const noSends = data && !empty && data.deliverability.kpis.tried === 0;

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-1 text-[12.5px] text-gray-500 dark:text-slate-400" aria-label="Breadcrumb">
        <button type="button" onClick={() => onNavigate("overview")} className="!min-h-0 hover:text-[#5B3FD9] hover:underline">Email Marketing</button>
        <ChevronRight className="h-3.5 w-3.5" />
        <button type="button" onClick={() => onNavigate("audience")} className="!min-h-0 hover:text-[#5B3FD9] hover:underline">Audience &amp; Segments</button>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className={tab === "overview" ? "font-semibold text-gray-800 dark:text-slate-200" : ""}>Audience Health</span>
        {tab !== "overview" && <><span>/</span><span className="font-semibold text-gray-800 dark:text-slate-200">{meta.label}</span></>}
      </nav>

      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><HeadIcon className="h-7 w-7" /></span>
          <div className="min-w-0">
            <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">{meta.title}</h1>
            <p className="m-0 text-[14.5px] text-gray-600 dark:text-slate-400">{meta.sub}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <DateWindowNav variant="compact" value={window_} onChange={setWindow} todayKey={todayKey} />
          <button type="button" aria-label="Refresh" onClick={() => void load()} className={btn.ghost}><RefreshCw className={`h-4 w-4 text-[#5B3FD9] ${loading ? "animate-spin" : ""}`} /></button>
          <button type="button" disabled={!data} onClick={() => data && exportReport(data, window_)} className={btn.primary}><Download className="h-4 w-4" />Export Report</button>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900" aria-label="Audience Health sections">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}
            className={`!min-h-0 inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-[13px] font-semibold xl:flex-auto ${tab === key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
            <Icon className="h-4 w-4" />{label}{key === "issues" && data && data.issues.counts.open > 0 ? ` (${data.issues.counts.open})` : ""}
          </button>
        ))}
      </nav>

      <ErrorNote message={error} />
      {!data && !error && <Loading />}
      {data && !data.sender.ready && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">Emails can't be sent: {data.sender.reason ?? "email is not set up."}</span>
          <button type="button" onClick={nav.emailSetup} className={btn.outline}>Open Settings › Email</button>
        </div>
      )}
      {empty && (
        <p className="m-0 rounded-xl border border-[#E4DDFB] bg-[#F7F4FF] px-4 py-2.5 text-[13px] text-gray-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-slate-200">
          Nobody is on the email list yet. These numbers fill in as customers give their email on the order form and as campaign emails go out.
        </p>
      )}
      {noSends && (
        <p className="m-0 rounded-xl border border-[#E4DDFB] bg-[#F7F4FF] px-4 py-2.5 text-[13px] text-gray-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-slate-200">
          {count(data!.overview.kpis.total.value)} {data!.overview.kpis.total.value === 1 ? "person is" : "people are"} on the list, but no campaign emails went out in these days. Opens, clicks and delivery show once they do.
        </p>
      )}

      {data && tab === "overview" && <OverviewTab data={data} nav={nav} />}
      {data && tab === "quality" && <QualityTab data={data} nav={nav} />}
      {data && tab === "engagement" && <EngagementTab data={data} nav={nav} />}
      {data && tab === "deliverability" && <DeliverabilityTab data={data} nav={nav} />}
      {data && tab === "growth" && <GrowthTab data={data} nav={nav} />}
      {data && tab === "segments" && <SegmentsTab data={data} nav={nav} />}
      {data && tab === "issues" && <IssuesTab data={data} nav={nav} />}

      {modal === "clean" && <CleanListModal onClose={() => setModal(null)} onDone={async (message) => { setModal(null); onToast(message); await load(); }} />}
      {modal === "bounce" && <BounceReportsModal on={!!data?.bounceReports.on} onClose={() => setModal(null)} onDone={async (message) => { setModal(null); onToast(message); await load(); }} />}
    </div>
  );
}

// ── List clean-up ─────────────────────────────────────────────────────

function CleanListModal({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [plan, setPlan] = useState<EmCleaningPlan | null>(null);
  const [pick, setPick] = useState({ neverOpened: true, duplicates: true, bounced: true });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { emailMarketingApi.cleaningPlan().then(setPlan).catch((err) => setError((err as Error).message || "Could not check the list.")); }, []);
  const rows: Array<{ key: keyof EmCleaningPlan; label: string; note: string }> = [
    { key: "neverOpened", label: "Never opened", note: "Got 3 or more emails over 60+ days and opened none. Marked Cleaned." },
    { key: "duplicates", label: "Second email for the same phone", note: "The older address of a customer who gave a newer one. Marked Cleaned." },
    { key: "bounced", label: "Bounced emails", note: "The address bounced but is still marked subscribed. Marked Bounced." }
  ];
  const total = plan ? rows.reduce((sum, row) => sum + (pick[row.key] ? plan[row.key] : 0), 0) : 0;
  const run = async () => {
    setBusy(true);
    try {
      const done = await emailMarketingApi.cleanList(pick);
      const n = done.neverOpened + done.duplicates + done.bounced;
      await onDone(n ? `List cleaned: ${count(n)} ${n === 1 ? "contact" : "contacts"} will get no more campaign emails.` : "Nothing to clean.");
    } catch (err) {
      setError((err as Error).message || "Could not clean the list.");
      setBusy(false);
    }
  };
  return (
    <ModalShell title="Clean the email list" sub="Stop emailing people who never read your emails, older duplicate emails and bounced addresses." onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
        <button type="button" disabled={busy || !plan || total === 0} onClick={() => void run()} className={btn.primary}>{busy ? "Cleaning..." : total ? `Clean ${count(total)} ${total === 1 ? "contact" : "contacts"}` : "Nothing to clean"}</button>
      </>}>
      <ErrorNote message={error} />
      {!plan && !error && <Loading />}
      {plan && (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <label key={row.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[#5B3FD9]" checked={pick[row.key]} disabled={plan[row.key] === 0} onChange={(event) => setPick({ ...pick, [row.key]: event.target.checked })} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[14px] font-semibold text-gray-900 dark:text-slate-50">{row.label}<span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[12px] font-bold text-gray-700 dark:bg-slate-800 dark:text-slate-300">{count(plan[row.key])}</span></span>
                <span className="block text-[12.5px] text-gray-600 dark:text-slate-400">{row.note}</span>
              </span>
            </label>
          ))}
          <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">Nobody is deleted. They stay in All Audience with the reason, and get no more campaign emails.</p>
        </div>
      )}
    </ModalShell>
  );
}

// ── Bounce and spam reports ───────────────────────────────────────────

function BounceReportsModal({ on, onClose, onDone }: { on: boolean; onClose: () => void; onDone: (message: string) => Promise<void> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const result = await emailMarketingApi.enableBounceReports();
      await onDone(result.skipped.length
        ? `Bounce reports are on, except ${result.skipped.join(" and ")}: your Mailjet account already sends those to another address.`
        : "Bounce and spam reports are on.");
    } catch (err) {
      setError((err as Error).message || "Could not switch on bounce reports.");
      setBusy(false);
    }
  };
  return (
    <ModalShell title={on ? "Bounce and spam reports are on" : "Switch on bounce and spam reports"} onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose} className={btn.ghost}>{on ? "Close" : "Cancel"}</button>
        <button type="button" disabled={busy} onClick={() => void run()} className={btn.primary}>{busy ? "Switching on..." : on ? "Connect again" : "Switch on"}</button>
      </>}>
      <ErrorNote message={error} />
      <div className="space-y-2.5 text-[13.5px] leading-relaxed text-gray-700 dark:text-slate-300">
        <p className="m-0">Mailjet tells Protohub when a campaign email bounces, is blocked, or is marked as spam. Then:</p>
        <ul className="m-0 list-disc space-y-1 pl-5">
          <li>an address that bounces for good is marked Bounced and gets no more emails;</li>
          <li>a customer who marks an email as spam is unsubscribed;</li>
          <li>Deliverability shows real bounce and spam rates.</li>
        </ul>
        <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">It uses the Mailjet keys in Settings › Email. If your Mailjet account already sends these reports somewhere else, that is left alone.</p>
      </div>
    </ModalShell>
  );
}

// ── Export Report ─────────────────────────────────────────────────────

function exportReport(data: EmHealth, window_: DateWindow) {
  const rows: Array<Array<string | number | null>> = [];
  const add = (tab: string, metric: string, value: string | number | null) => rows.push([tab, metric, value]);
  const o = data.overview;
  add("Overview", "Total audience", o.kpis.total.value);
  add("Overview", "Audience quality", pct(o.kpis.quality.value));
  add("Overview", "Email deliverability", pct(o.kpis.deliverability.value));
  add("Overview", "Engagement rate (opened)", pct(o.kpis.engagement.value));
  add("Overview", "At-risk audience", o.kpis.atRisk.value);
  add("Overview", "Health score", pct(o.score));
  const q = data.quality.kpis;
  add("Quality & Validity", "Valid & engaged", q.valid);
  add("Quality & Validity", "Invalid / bounced", q.bounced);
  add("Quality & Validity", "Duplicates", q.duplicate);
  add("Quality & Validity", "Unsubscribed", q.unsubscribed);
  for (const source of data.quality.sources) add("Quality & Validity", `Source: ${source.label}`, `${source.valid} of ${source.total} valid (${pct(source.qualityRate)})`);
  const e = data.engagement.kpis;
  add("Engagement", "People emailed", e.people);
  add("Engagement", "Open rate", pct(e.openRate));
  add("Engagement", "Click rate", pct(e.clickRate));
  add("Engagement", "Repeat engagement", pct(e.repeatEngagement));
  add("Engagement", "Active (last 30 days)", e.active);
  add("Engagement", "Inactive (90+ days)", e.inactive);
  const d = data.deliverability.kpis;
  add("Deliverability", "Emails sent", d.tried);
  add("Deliverability", "Delivered", `${d.delivered} (${pct(d.deliveredRate)})`);
  add("Deliverability", "Bounced", `${d.bounced} (${pct(d.bounceRate)})`);
  add("Deliverability", "Marked as spam", `${d.spam} (${pct(d.spamRate)})`);
  add("Deliverability", "Failed", `${d.failed} (${pct(d.failedRate)})`);
  if (data.auth) add("Deliverability", `Sender checks (${data.auth.domain})`, `SPF ${data.auth.spf}, DKIM ${data.auth.dkim}, DMARC ${data.auth.dmarc}`);
  const g = data.growth.kpis;
  add("Growth & Churn", "New subscribers", g.added);
  add("Growth & Churn", "Unsubscribed / bounced (churned)", g.churned);
  add("Growth & Churn", "Net growth", g.net);
  add("Growth & Churn", "Churn rate", pct(g.churnRate));
  add("Growth & Churn", "Retention rate", pct(g.retentionRate));
  add("Growth & Churn", "Audience LTV (delivered money per buying customer)", g.ltv);
  for (const row of data.segments.rows) add("Segments Health", row.name, `${row.audience} to email, ${row.health.replace("_", " ")}, open ${pct(row.openRate)}`);
  for (const issue of data.issues.open) add("Issues & Actions", `${issue.severity}: ${issue.title}`, issue.detectedAt.slice(0, 10));
  downloadCsv(`audience-health-${window_.start}-to-${window_.end}.csv`, ["Tab", "Metric", "Value"], rows);
}
