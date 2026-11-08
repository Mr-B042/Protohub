import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BarChart3, FileText, GitBranch, Home, Info, LayoutGrid, Mail, Plus, RefreshCw, Save, Settings, Users, Zap } from "lucide-react";
import { emailMarketingApi, type EmCampaign, type EmOverview } from "../../lib/api";
import AudiencePage from "./AudiencePage";
import AudienceHealthPage from "./AudienceHealthPage";
import AutomationsPage from "./AutomationsPage";
import AutomationWizard from "./AutomationWizard";
import JourneysPage from "./JourneysPage";
import { LEGACY_TEMPLATE } from "./automation-model";
import CampaignWizard from "./CampaignWizard";
import CampaignsPage from "./CampaignsPage";
import TabOverview from "./TabOverview";
import { Card, ErrorNote, Loading, WaitingForDesign, btn, count, input, type EmSection } from "./em-ui";
import CampaignReport from "./CampaignReport";

/**
 * Email Marketing & Customer Retention (Bright, 8 Nov 2026), part 1:
 * Overview, Campaigns, Create Campaign and Audience & Segments, built to his
 * designs. The sidebar's sub-list and the tab bar both move between pages.
 */

const TABS: Array<{ key: EmSection; label: string; icon: typeof Home }> = [
  { key: "overview", label: "Overview", icon: Home },
  { key: "campaigns", label: "Campaigns", icon: Mail },
  { key: "automations", label: "Automations", icon: Zap },
  { key: "audience", label: "Audience & Segments", icon: Users },
  { key: "templates", label: "Templates", icon: LayoutGrid },
  { key: "forms", label: "Forms & Lead Capture", icon: FileText },
  { key: "journey", label: "Customer Journey", icon: GitBranch },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings }
];

type WizardState = { campaignId?: string | null; preset?: string; segmentId?: string } | null;

export default function EmailMarketingPage({ section, onNavigate, onToast, onOpenSettings }: {
  section: EmSection;
  onNavigate: (section: EmSection) => void;
  onToast: (message: string) => void;
  /** The app's Settings page: "email" (the email service) or "workspace" (alerts). */
  onOpenSettings: (panel: "email" | "workspace") => void;
}) {
  const [overview, setOverview] = useState<EmOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [wizard, setWizard] = useState<WizardState>(null);
  const [autoWizard, setAutoWizard] = useState<{ id?: string; template?: string | null; step?: number; noun?: "Automation" | "Journey" } | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [audienceModal, setAudienceModal] = useState<"add-subscribers" | "create-segment" | null>(null);
  const withHeader = section !== "campaigns" && section !== "audience" && section !== "health" && section !== "automations" && section !== "journey";
  /** Part 1's ready-made flow names open the Automations window on the matching template. */
  const openAutomation = (preset?: string) => setAutoWizard({ template: preset ? LEGACY_TEMPLATE[preset] ?? preset : "post_purchase" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await emailMarketingApi.overview());
      setError("");
    } catch (err) {
      setError((err as Error).message || "Could not load Email Marketing.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (withHeader && (!overview || section === "overview")) void load(); }, [section]);

  const openCampaign = (row: EmCampaign) => (row.status === "draft" ? setWizard({ campaignId: row.id }) : setReport(row.id));
  const health = overview?.health;
  const healthLook = !health ? { dot: "bg-gray-300", text: "text-gray-500", label: "No emails yet" }
    : health.grade === "good" ? { dot: "bg-emerald-500", text: "text-emerald-700", label: `Good (${health.percent}%)` }
      : health.grade === "fair" ? { dot: "bg-amber-500", text: "text-amber-700", label: `Fair (${health.percent}%)` }
        : { dot: "bg-rose-500", text: "text-rose-600", label: `Poor (${health.percent}%)` };

  return (
    <div className="space-y-4">
      {withHeader && (
        <>
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#6E55E8] to-[#4C32C4] text-white shadow-sm"><Mail className="h-7 w-7" /></span>
              <div className="min-w-0">
                <h1 className="m-0 text-[28px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Email Marketing &amp; Customer Retention</h1>
                <p className="m-0 text-[14.5px] text-gray-600 dark:text-slate-400">Build lasting customer relationships, bring customers back to buy again, and grow what each customer is worth (LTV).</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <div className="flex items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900"
                title={health ? `Last 30 days: ${count(health.sent)} emails sent, ${count(health.failed)} failed (campaigns and staff emails).` : "Shows once emails go out."}>
                <span className={`h-2.5 w-2.5 rounded-full ${healthLook.dot}`} />
                <span className="leading-tight"><span className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Email Health</span><span className={`block text-[13px] font-semibold ${healthLook.text}`}>{healthLook.label}</span></span>
              </div>
              <button type="button" aria-label="Refresh" onClick={() => void load()} className={btn.ghost}><RefreshCw className={`h-4 w-4 text-[#5B3FD9] ${loading ? "animate-spin" : ""}`} /></button>
              <button type="button" onClick={() => setWizard({})} className={`${btn.primary} !px-5 !py-3`}><Plus className="h-4 w-4" />Create Campaign</button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900" aria-label="Email Marketing sections">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => onNavigate(key)} aria-current={section === key ? "page" : undefined}
                className={`!min-h-0 inline-flex flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2.5 text-[13px] font-semibold xl:flex-auto ${section === key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </nav>

          {overview && !overview.sender.ready && (
            <p className="m-0 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Emails can't be sent yet: {overview.sender.reason}</p>
          )}
          {overview && !overview.formEmailOn && (
            <p className="m-0 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />The order form's Email box is off, so new customers can't join the list. Switch on "Email capture" in Embed Form.</p>
          )}
          {overview && overview.formEmailOn && overview.kpis.subscribers.value === 0 && section === "overview" && (
            <p className="m-0 flex items-start gap-2 rounded-xl border border-[#E4DDFB] bg-[#F7F4FF] px-4 py-2.5 text-[13px] text-gray-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-slate-200"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" />No customer has given an email yet. The order form now asks for one (optional), so the list grows as orders come in. Customer numbers below come from all delivered orders.</p>
          )}
          <ErrorNote message={error} />
        </>
      )}

      {section === "overview" && (overview ? (
        <TabOverview data={overview} onNavigate={onNavigate} onCreate={() => setWizard({})} onCreateAutomation={openAutomation} onOpenCampaign={openCampaign}
          onQuick={(action) => { setAudienceModal(action); onNavigate("audience"); }} />
      ) : !error && <Loading />)}
      {section === "campaigns" && <CampaignsPage onNavigate={onNavigate} onCreate={() => setWizard({})} onEdit={(id) => setWizard({ campaignId: id })} onToast={onToast} refreshKey={refreshKey} />}
      {section === "audience" && <AudiencePage onToast={onToast} onUseSegment={(segmentId) => setWizard({ segmentId })} openModal={audienceModal} onModalOpened={() => setAudienceModal(null)} onOpenHealth={() => onNavigate("health")} />}
      {section === "health" && (
        <AudienceHealthPage onNavigate={onNavigate} onToast={onToast} onOpenSettings={onOpenSettings} onCreate={(preset) => (preset ? openAutomation(preset) : setWizard({}))}
          onCreateSegment={() => { setAudienceModal("create-segment"); onNavigate("audience"); }} />
      )}
      {section === "automations" && <AutomationsPage onOpenWizard={setAutoWizard} onToast={onToast} refreshKey={refreshKey} />}
      {section === "journey" && <JourneysPage onOpenWizard={(options) => setAutoWizard({ ...options, noun: "Journey" })} onToast={onToast} refreshKey={refreshKey} />}
      {section === "templates" && <WaitingForDesign title="Templates" note="Templates are in the Design Email step of Create Campaign for now (View All, and Save this design as a template). This tab is waiting for its design." />}
      {section === "forms" && <WaitingForDesign title="Forms & Lead Capture" note="Today the list grows from the order form's Email box. This tab is waiting for its design." />}
      {section === "analytics" && <WaitingForDesign title="Analytics" note="Each campaign's results open from the chart button on Campaigns. This tab is waiting for its design." />}
      {section === "settings" && <SettingsTab onToast={onToast} />}

      {wizard && (
        <CampaignWizard campaignId={wizard.campaignId} preset={wizard.preset} segmentId={wizard.segmentId} onClose={() => setWizard(null)} onToast={onToast}
          onDone={(message) => { setWizard(null); onToast(message); setRefreshKey((n) => n + 1); if (withHeader) void load(); }} />
      )}
      {autoWizard && (
        <AutomationWizard automationId={autoWizard.id} template={autoWizard.template} startStep={autoWizard.step} noun={autoWizard.noun} onClose={() => setAutoWizard(null)} onToast={onToast}
          onDone={(message) => { setAutoWizard(null); onToast(message); setRefreshKey((n) => n + 1); if (section !== "automations" && section !== "journey") onNavigate("automations"); }} />
      )}
      {report && <CampaignReport id={report} onClose={() => setReport(null)} onEdit={(id) => { setReport(null); setWizard({ campaignId: id }); }} />}
    </div>
  );
}

/** No design was sent for Settings; sending needs these two numbers, so they live here. */
function SettingsTab({ onToast }: { onToast: (message: string) => void }) {
  const [data, setData] = useState<{ dailyLimit: number; footerNote: string; sender: { ready: boolean; reason?: string; fromName: string; fromEmail: string } } | null>(null);
  const [limit, setLimit] = useState("150");
  const [footer, setFooter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    emailMarketingApi.settings().then((result) => { setData(result); setLimit(String(result.dailyLimit)); setFooter(result.footerNote); }).catch((err) => setError((err as Error).message));
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      await emailMarketingApi.saveSettings({ dailyLimit: Math.round(Number(limit)), footerNote: footer });
      onToast("Settings saved.");
    } catch (err) {
      setError((err as Error).message || "Could not save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="max-w-2xl p-5">
      <h3 className="m-0 text-[17px] font-bold text-gray-900 dark:text-slate-50">Sending</h3>
      <ErrorNote message={error} />
      {!data && !error ? <Loading /> : data && (
        <div className="mt-3 space-y-4">
          <div>
            <p className="m-0 text-[13px] font-bold text-gray-900 dark:text-slate-50">Emails come from</p>
            <p className="m-0 text-[14px] text-gray-700 dark:text-slate-300">{data.sender.fromName || "—"} &lt;{data.sender.fromEmail || "no address"}&gt;</p>
            <p className="m-0 text-[12px] text-gray-500">{data.sender.ready ? "Change it in Settings › Email." : data.sender.reason}</p>
          </div>
          <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Campaign emails a day (at most)
            <input type="number" min={1} max={100000} value={limit} onChange={(event) => setLimit(event.target.value)} className={`${input} mt-1.5 max-w-[200px]`} />
            <span className="mt-1 block text-[12px] font-normal text-gray-500">The rest wait for the next day. Your email service also has its own daily limit for order and staff emails, so keep room for those.</span>
          </label>
          <label className="block text-[13px] font-bold text-gray-900 dark:text-slate-50">Line above the unsubscribe link (optional)
            <textarea value={footer} onChange={(event) => setFooter(event.target.value.slice(0, 300))} rows={2} className={`${input} mt-1.5`} placeholder="e.g. ProTools Hardware, Lagos. WhatsApp 0803 000 0000" />
            <span className="mt-1 block text-[12px] font-normal text-gray-500">Every email already ends with an Unsubscribe link; anyone who taps it is never emailed again.</span>
          </label>
          <button type="button" disabled={busy} onClick={() => void save()} className={btn.primary}><Save className="h-4 w-4" />{busy ? "Saving…" : "Save Settings"}</button>
        </div>
      )}
    </Card>
  );
}
