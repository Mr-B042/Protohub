import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight, Bell, CheckCircle2, CircleCheck, Clock, Copy, Database, FileText, Globe, Info, Link2, Plus, Radio, Settings as SettingsIcon,
  Shield, ShoppingCart, SlidersHorizontal, Sparkles, TriangleAlert, Users
} from "lucide-react";
import { trackingHubApi, type HubAuditEntry, type HubProfile, type HubSettings, type HubSettingsResponse, type HubStrategy } from "../../lib/api";
import {
  Card, EmptyRow, HubHeader, Loading, Modal, PlatformIcon, StatusPill, Toggle, ago, copyText, input, labelCls, primaryButton, rowCls, smallButton,
  STRATEGY_LABEL, tableCls, timeOf, useLoad, darkButton, type HubTab, type Toast
} from "./HubParts";
import { auditLabel } from "./DataSourcesTab";

// Settings tab - built to Bright's image (2 Oct 2026). One settings record per
// branch (tracking_settings); the top tabs and the left list open the same
// sections.

type Section = "general" | "rules" | "event" | "attribution" | "platform" | "dedup" | "notifications" | "team" | "audit" | "advanced";
const TOP_TABS: Array<{ key: Section; label: string }> = [
  { key: "general", label: "General" }, { key: "rules", label: "Tracking Rules" }, { key: "event", label: "Event Configuration" }, { key: "attribution", label: "Attribution & UTM" },
  { key: "dedup", label: "Deduplication" }, { key: "notifications", label: "Notifications" }, { key: "team", label: "Team Access" }, { key: "audit", label: "Audit Logs" }
];
const SIDE: Array<{ key: Section; title: string; sub: string; icon: ReactNode }> = [
  { key: "general", title: "General Settings", sub: "Basic tracking configuration", icon: <SettingsIcon className="h-5 w-5" /> },
  { key: "event", title: "Purchase Event Settings", sub: "Default event behaviour", icon: <ShoppingCart className="h-5 w-5" /> },
  { key: "attribution", title: "Attribution Settings", sub: "Campaign and UTM capture", icon: <Link2 className="h-5 w-5" /> },
  { key: "platform", title: "Platform Settings", sub: "Meta, TikTok and other platforms", icon: <Database className="h-5 w-5" /> },
  { key: "dedup", title: "Deduplication Rules", sub: "Prevent duplicate events", icon: <Shield className="h-5 w-5" /> },
  { key: "notifications", title: "Alert & Notifications", sub: "Get notified about issues", icon: <Bell className="h-5 w-5" /> },
  { key: "team", title: "Team Access", sub: "Manage who can change settings", icon: <Users className="h-5 w-5" /> },
  { key: "audit", title: "Data & Logs", sub: "Retention, export and history", icon: <FileText className="h-5 w-5" /> },
  { key: "advanced", title: "Advanced Settings", sub: "For technical configuration", icon: <SlidersHorizontal className="h-5 w-5" /> }
];
const sideFor = (section: Section): Section => (section === "rules" ? "general" : section);

export default function SettingsTab({ tabBar, onToast, onTab, renderMetaDefaults }: { tabBar: ReactNode; onToast: Toast; onTab: (tab: HubTab) => void; renderMetaDefaults?: () => ReactNode }) {
  const { data, reload } = useLoad(() => trackingHubApi.settings(), [], onToast);
  const [section, setSection] = useState<Section>("general");
  const [draft, setDraft] = useState<HubSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setDraft(data.settings); }, [data]);
  const header = <HubHeader title="Settings" subtitle="Configure how Protohub tracks orders and sends conversion events to your advertising platforms." />;
  if (!data || !draft) return <div className="space-y-5">{header}{tabBar}<Loading /></div>;
  const set = (patch: Partial<HubSettings>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const save = async (next: HubSettings = draft) => {
    setSaving(true);
    try { const result = await trackingHubApi.saveSettings(next); setDraft(result.settings); onToast("Settings saved."); reload(); } catch (err: any) { onToast(err?.message ?? "Could not save."); } finally { setSaving(false); }
  };
  const saveButton = <button type="button" className={`${primaryButton} !rounded-lg !px-4 !py-2.5 !text-[13px]`} disabled={saving} onClick={() => void save()}><Plus className="h-4 w-4" /> {saving ? "Saving…" : "Save Changes"}</button>;

  return (
    <div className="space-y-5">
      {header}
      {tabBar}
      <Card className="px-2">
        <div className="overflow-x-auto"><div className="flex min-w-max gap-1">
          {TOP_TABS.map((tab) => (
            <button key={tab.key} type="button" onClick={() => setSection(tab.key)} className={`!min-h-0 -mb-px inline-flex items-center gap-1.5 border-b-2 px-4 py-3.5 text-[14px] font-semibold ${section === tab.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-300"}`}>
              {section === tab.key ? <CircleCheck className="h-4 w-4" /> : null}{tab.label}
            </button>
          ))}
        </div></div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[236px_minmax(0,1fr)]">
        <Card className="h-fit p-2">
          <ul className="m-0 list-none space-y-1 p-0">
            {SIDE.map((item) => {
              const active = sideFor(section) === item.key;
              return (
                <li key={item.key}><button type="button" onClick={() => setSection(item.key)} className={`!min-h-0 flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left ${active ? "bg-blue-50 dark:bg-blue-950/30" : "hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
                  <span className={active ? "text-blue-600" : "text-gray-700 dark:text-slate-300"}>{item.icon}</span>
                  <span><span className={`block text-[14px] font-semibold ${active ? "text-blue-600" : "text-gray-900 dark:text-slate-100"}`}>{item.title}</span><span className="block text-[12px] text-gray-500">{item.sub}</span></span>
                </button></li>
              );
            })}
          </ul>
        </Card>

        {section === "general" ? <GeneralSection data={data} draft={draft} set={set} saveButton={saveButton} onToast={onToast} onTab={onTab} /> : null}
        {section === "rules" ? <Panel title="Tracking Rules" sub="What happens when an order is created." action={saveButton}><TrackingMode draft={draft} set={set} /><RuleSummary draft={draft} /></Panel> : null}
        {section === "event" ? (
          <Panel title="Purchase Event Settings" sub="Default event behaviour for new tracking links." action={saveButton}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelCls}>Default Event Strategy<select value={draft.defaultStrategy} onChange={(e) => set({ defaultStrategy: e.target.value as HubStrategy, sendBrowser: e.target.value === "browser_capi" })} className={input}><option value="browser_capi">Browser + CAPI (Recommended)</option><option value="capi_only">CAPI only</option><option value="landing_page">Thank-you page Pixel</option></select></label>
              <label className={labelCls}>Default Event ID<select disabled className={input}><option>Protohub Order ID (e.g. {"PH-18452"})</option></select><span className="mt-1 block text-[11.5px] font-normal text-gray-500">The order id is the event_id, so browser and server events count once.</span></label>
              <label className={labelCls}>Default Event Value<select value={draft.defaultEventValue} disabled className={input}><option value="order_total">Order Total</option></select><span className="mt-1 block text-[11.5px] font-normal text-gray-500">The value sent with Purchase events.</span></label>
              <label className={labelCls}>Currency<select value={draft.currency} onChange={(e) => set({ currency: e.target.value })} className={input}><option value="NGN">₦ - Nigerian Naira (NGN)</option><option value="USD">$ - US Dollar (USD)</option><option value="GHS">GH₵ - Ghana Cedi (GHS)</option></select></label>
            </div>
            <p className="m-0 mt-3 text-[12px] text-gray-500">Existing links keep their own strategy; change each one in Tracking Links. Purchase is sent once per order, ever. The Delivered sale event goes when the order is delivered.</p>
          </Panel>
        ) : null}
        {section === "attribution" ? (
          <Panel title="Attribution & UTM" sub="Paste these into every ad (Ad → Tracking → URL parameters). Then each order tells Protohub its campaign, ad set and ad — no setup per campaign." action={saveButton}>
            <textarea rows={4} value={draft.urlParameters} onChange={(e) => set({ urlParameters: e.target.value })} className={`${input} h-auto py-2 font-mono text-[12px]`} />
            <div className="mt-2 flex gap-2"><button type="button" className={smallButton} onClick={() => copyText(draft.urlParameters, onToast, "URL parameters copied.")}><Copy className="h-3.5 w-3.5" /> Copy</button></div>
            <ul className="m-0 mt-4 list-none space-y-1.5 p-0 text-[13px] text-gray-700 dark:text-slate-300">
              {["fbclid (added by Meta on every click)", "_fbp / _fbc (Meta's browser ids, read on the landing page)", "Campaign, ad set and ad ids", "UTM source, medium, campaign, content, term", "Landing page and referrer", "Device and browser"].map((item) => <li key={item} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" />{item}</li>)}
            </ul>
          </Panel>
        ) : null}
        {section === "platform" ? <PlatformSection data={data} onToast={onToast} onChanged={reload} onTab={onTab} /> : null}
        {section === "dedup" ? (
          <Panel title="Deduplication Rules" sub="How Protohub stops one order counting twice in Meta.">
            <dl className="m-0 grid max-w-2xl grid-cols-[220px_1fr] gap-y-2.5 text-[13.5px]">
              <dt className="text-gray-500">Event ID</dt><dd className="m-0 font-semibold">Protohub Order ID — same id from browser and server</dd>
              <dt className="text-gray-500">Server repeat protection</dt><dd className="m-0 font-semibold">STRICT — one Purchase per order, ever</dd>
              <dt className="text-gray-500">Browser repeat protection</dt><dd className="m-0 font-semibold">The page blocks a second Purchase with the same id</dd>
              <dt className="text-gray-500">Thank-you page Pixel</dt><dd className="m-0 font-semibold">Must be removed for Browser + CAPI links (go-live checklist)</dd>
              <dt className="text-gray-500">Duplicate Pixel on a page</dt><dd className="m-0 font-semibold">Reported in Websites and Diagnostics</dd>
            </dl>
          </Panel>
        ) : null}
        {section === "notifications" ? (
          <Panel title="Alert & Notifications" sub="Owners get a notification once per issue per day." action={saveButton}>
            <div className="grid gap-3 sm:grid-cols-2">
              <ToggleTile title="CAPI failures" sub="A Purchase could not be delivered to Meta." checked={draft.notifications.capiFailures} onChange={(value) => set({ notifications: { ...draft.notifications, capiFailures: value } })} />
              <ToggleTile title="Connection problems" sub="A data source token stopped working." checked={draft.notifications.connection} onChange={(value) => set({ notifications: { ...draft.notifications, connection: value } })} />
              <ToggleTile title="Duplicate Pixel" sub="A page loads more than one Pixel." checked={draft.notifications.duplicatePixel} onChange={(value) => set({ notifications: { ...draft.notifications, duplicatePixel: value } })} />
              <ToggleTile title="Lost campaign parameters" sub="Ad orders arriving without a campaign id." checked={draft.notifications.lostParameters} onChange={(value) => set({ notifications: { ...draft.notifications, lostParameters: value } })} />
              <ToggleTile title="Daily summary" sub="One message each morning with yesterday's tracking." checked={draft.notifications.dailySummary} onChange={(value) => set({ notifications: { ...draft.notifications, dailySummary: value } })} />
            </div>
          </Panel>
        ) : null}
        {section === "team" ? (
          <Panel title="Team Access" sub="The Tracking Hub holds the Meta tokens, so only Owners can open or change it.">
            <table className={tableCls}>
              <thead><tr className="text-gray-500"><th>Name</th><th>Email</th><th>Access</th></tr></thead>
              <tbody>
                {data.owners.map((owner) => <tr key={owner.email} className={rowCls}><td className="py-2.5 font-semibold">{owner.name}</td><td className="py-2.5 text-gray-600">{owner.email}</td><td className="py-2.5"><StatusPill size="sm" tone="blue">Owner — full access</StatusPill></td></tr>)}
                {data.owners.length === 0 ? <EmptyRow colSpan={3} text="No active Owner." /> : null}
              </tbody>
            </table>
          </Panel>
        ) : null}
        {section === "audit" ? <AuditSection /> : null}
        {section === "advanced" ? (
          <div className="space-y-4">
            <Panel title="Advanced Settings" sub="Thresholds used to flag links and campaigns." action={saveButton}>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelCls}>Flag a link as Low Performance below this conversion rate (%)<input type="number" min={0} max={100} value={draft.lowConversionRate} onChange={(e) => set({ lowConversionRate: Number(e.target.value) })} className={input} /></label>
                <label className={labelCls}>Mark Reconciliation rows "Investigate" below this match rate (%)<input type="number" min={0} max={100} value={draft.investigateBelowMatchRate} onChange={(e) => set({ investigateBelowMatchRate: Number(e.target.value) })} className={input} /></label>
              </div>
            </Panel>
            {renderMetaDefaults ? renderMetaDefaults() : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Panel({ title, sub, action, children }: { title: string; sub?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="h-fit p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">{title}</h2>{sub ? <p className="m-0 mt-0.5 text-[13px] text-gray-500">{sub}</p> : null}</div>{action}</div>
      <div className="mt-4">{children}</div>
    </Card>
  );
}

function ToggleTile({ icon, title, sub, checked, onChange, disabled }: { icon?: ReactNode; title: string; sub: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-gray-200 p-3.5 dark:border-slate-700">
      {icon ? <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/40">{icon}</span> : null}
      <span className="min-w-0 flex-1"><strong className="block text-[13.5px] text-gray-900 dark:text-slate-100">{title}</strong><span className="mt-0.5 block text-[11.5px] leading-snug text-gray-500">{sub}</span></span>
      <Toggle checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function TrackingMode({ draft, set }: { draft: HubSettings; set: (patch: Partial<HubSettings>) => void }) {
  const options: Array<{ key: HubSettings["trackingMode"]; title: string; tag?: string; sub: string }> = [
    { key: "order_based", title: "Order-based Tracking", tag: "(Recommended)", sub: "Send Purchase event when order is successfully created in Protohub. Most accurate and prevents duplicates." },
    { key: "thank_you", title: "Thank-you Page Only", sub: "Rely on Pixel/CAPI on thank-you page. Protohub will not send Purchase event." },
    { key: "hybrid", title: "Hybrid Mode", sub: "Send Purchase from Protohub and also allow thank-you page for backup." }
  ];
  const pick = (key: HubSettings["trackingMode"]) => set({ trackingMode: key, defaultStrategy: key === "thank_you" ? "landing_page" : draft.sendBrowser ? "browser_capi" : "capi_only" });
  return (
    <div className="space-y-2.5">
      {options.map((option) => {
        const active = draft.trackingMode === option.key;
        return (
          <button key={option.key} type="button" onClick={() => pick(option.key)} className={`!min-h-0 flex w-full items-start gap-3 rounded-xl border p-4 text-left ${active ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20" : "border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"}`}>
            <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${active ? "border-blue-600" : "border-gray-300"}`}>{active ? <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> : null}</span>
            <span><span className={`block text-[14px] font-semibold ${active ? "text-blue-700 dark:text-blue-400" : "text-gray-900 dark:text-slate-100"}`}>{option.title} {option.tag ? <span className="font-normal text-gray-500">{option.tag}</span> : null}</span><span className="mt-0.5 block text-[12.5px] text-gray-600 dark:text-slate-400">{option.sub}</span></span>
          </button>
        );
      })}
      {draft.trackingMode === "hybrid" ? <p className="m-0 rounded-lg bg-amber-50 p-3 text-[12px] text-amber-800">Hybrid: if the thank-you page also fires Purchase with a different id, Meta counts the order twice. Use it only as a short backup.</p> : null}
    </div>
  );
}

function RuleSummary({ draft }: { draft: HubSettings }) {
  return (
    <dl className="m-0 mt-5 grid max-w-2xl grid-cols-[200px_1fr] gap-y-2 text-[13.5px]">
      <dt className="text-gray-500">When</dt><dd className="m-0 font-semibold">{draft.trackingMode === "thank_you" ? "The thank-you page loads (Protohub sends nothing)" : "Order created successfully"}</dd>
      <dt className="text-gray-500">Send</dt><dd className="m-0 font-semibold">{draft.trackingMode === "thank_you" ? "—" : [draft.sendBrowser ? "Meta Browser Purchase" : null, draft.sendCapi ? "Meta CAPI Purchase" : null].filter(Boolean).join(" + ")}</dd>
      <dt className="text-gray-500">Event ID</dt><dd className="m-0 font-semibold">Protohub Order ID</dd>
      <dt className="text-gray-500">Value</dt><dd className="m-0 font-semibold">Order Total ({draft.currency})</dd>
      <dt className="text-gray-500">Duplicate Protection</dt><dd className="m-0 font-semibold">STRICT — one Purchase per order, ever</dd>
      <dt className="text-gray-500">Redirect</dt><dd className="m-0 font-semibold">After the Pixel has fired</dd>
    </dl>
  );
}

function GeneralSection({ data, draft, set, saveButton, onToast, onTab }: { data: HubSettingsResponse; draft: HubSettings; set: (patch: Partial<HubSettings>) => void; saveButton: ReactNode; onToast: Toast; onTab: (tab: HubTab) => void }) {
  const [platform, setPlatform] = useState<"meta" | "tiktok" | "google" | "other">("meta");
  const [testing, setTesting] = useState(false);
  const platformSources = data.dataSources.filter((row) => (platform === "other" ? row.platform === "other" || row.platform === "snapchat" : row.platform === platform));
  const defaultFor = draft.defaultDataSources[platform] ?? platformSources.find((row) => row.isMain)?.id ?? platformSources[0]?.id ?? "";
  const chosen = data.dataSources.find((row) => row.id === defaultFor);
  const test = async () => {
    if (!chosen) return;
    setTesting(true);
    try { const r = await trackingHubApi.testDataSource(chosen.id); onToast(r.ok ? r.message : r.human?.title ?? r.message); } catch (err: any) { onToast(err?.message ?? "Test failed."); } finally { setTesting(false); }
  };
  const site = data.websites.find((row) => row.id === draft.defaultWebsiteId);
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,1fr)]">
      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">General Settings</h2><p className="m-0 mt-0.5 text-[13px] text-gray-500">Default configuration for tracking across all websites and products.</p></div>{saveButton}</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={labelCls}>Default Currency<select value={draft.currency} onChange={(e) => set({ currency: e.target.value })} className={input}><option value="NGN">₦ - Nigerian Naira (NGN)</option><option value="USD">$ - US Dollar (USD)</option><option value="GHS">GH₵ - Ghana Cedi (GHS)</option></select></label>
            <label className={labelCls}>Default Timezone<select value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} className={input}><option value="Africa/Lagos">(GMT+1) Africa/Lagos</option><option value="Africa/Accra">(GMT+0) Africa/Accra</option><option value="Africa/Nairobi">(GMT+3) Africa/Nairobi</option></select></label>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ToggleTile icon={<ShoppingCart className="h-4 w-4" />} title="Enable Tracking Hub" sub="Track and send conversion events for all orders." checked={draft.enabled} onChange={(value) => set({ enabled: value })} />
            <ToggleTile icon={<Sparkles className="h-4 w-4" />} title="Auto-capture Meta Parameters" sub="Automatically capture fbclid, fbp, fbc and campaign parameters. Always on." checked onChange={() => undefined} disabled />
            <ToggleTile icon={<Globe className="h-4 w-4" />} title="Send Browser Pixel Events" sub="Fire Purchase event on customer's browser." checked={draft.sendBrowser} onChange={(value) => set({ sendBrowser: value, defaultStrategy: draft.trackingMode === "thank_you" ? "landing_page" : value ? "browser_capi" : "capi_only" })} />
            <ToggleTile icon={<Radio className="h-4 w-4" />} title="Send Server Events (CAPI)" sub="Send Purchase event via Conversions API." checked={draft.sendCapi} onChange={(value) => set({ sendCapi: value })} />
            <ToggleTile icon={<ShoppingCart className="h-4 w-4" />} title="Allow Multiple Platforms" sub="Enable tracking for Meta, TikTok, Google Ads, etc." checked={draft.multiPlatform} onChange={(value) => set({ multiPlatform: value })} />
            <ToggleTile icon={<Link2 className="h-4 w-4" />} title="Log All Events" sub="Keep a detailed log of all events for debugging." checked={draft.logAllEvents} onChange={(value) => set({ logAllEvents: value })} />
          </div>
          {!draft.enabled ? <p className="m-0 mt-3 rounded-lg bg-amber-50 p-3 text-[12.5px] text-amber-800">With the hub off, Protohub stops sending Purchase and Delivered events to Meta. Orders are still taken.</p> : null}
        </Card>

        <Card className="p-5">
          <h2 className="m-0 text-[18px] font-black text-gray-900 dark:text-slate-100">Default Platform Configuration</h2>
          <p className="m-0 mt-0.5 text-[13px] text-gray-500">Choose your default data sources and event settings for each platform.</p>
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-gray-50 p-1 sm:grid-cols-4 dark:bg-slate-800">
            {([["meta", "Meta (Facebook)"], ["tiktok", "TikTok"], ["google", "Google Ads"], ["other", "Other Platforms"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setPlatform(key)} className={`!min-h-0 flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold ${platform === key ? "bg-white text-blue-600 shadow-sm dark:bg-slate-900" : "text-gray-600 dark:text-slate-300"}`}><PlatformIcon platform={key} size="sm" />{label}</button>
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className={labelCls}>Default {platform === "meta" ? "Meta" : platform === "tiktok" ? "TikTok" : platform === "google" ? "Google" : ""} Data Source
              <div className="relative">
                <select value={defaultFor} onChange={(e) => set({ defaultDataSources: { ...draft.defaultDataSources, [platform]: e.target.value } })} className={`${input} pr-24`}>
                  {platformSources.length === 0 ? <option value="">No data source yet</option> : null}
                  {platformSources.map((row) => <option key={row.id} value={row.id}>{row.name} (ID: {row.pixelId})</option>)}
                </select>
                {chosen ? <span className="pointer-events-none absolute right-9 top-1/2 mt-0.5 -translate-y-1/2"><StatusPill size="sm" tone={chosen.health === "healthy" ? "green" : "orange"}>{chosen.health === "healthy" ? "Active" : "Check"}</StatusPill></span> : null}
              </div>
            </label>
            <label className={labelCls}>Default Event Strategy<select value={draft.defaultStrategy} onChange={(e) => set({ defaultStrategy: e.target.value as HubStrategy, sendBrowser: e.target.value === "browser_capi" })} className={input}><option value="browser_capi">Browser + CAPI (Recommended)</option><option value="capi_only">CAPI only</option><option value="landing_page">Thank-you page Pixel</option></select></label>
            <label className={labelCls}><span className="inline-flex items-center gap-1">Default Event ID <Info className="h-3.5 w-3.5 text-gray-400" /></span><select disabled className={input}><option>Protohub Order ID (e.g. PH-18452)</option></select><span className="mt-1 block text-[11.5px] font-normal text-gray-500">Use the unique Protohub order ID as event_id for deduplication.</span></label>
            <label className={labelCls}>Default Event Value<select disabled value="order_total" className={input}><option value="order_total">Order Total</option></select><span className="mt-1 block text-[11.5px] font-normal text-gray-500">The value to send with Purchase events.</span></label>
          </div>
          {platform !== "meta" ? <p className="m-0 mt-3 text-[12px] text-gray-500">Protohub sends server events to Meta and TikTok. Other platforms are saved for reference.</p> : null}
          <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 ${chosen?.health === "healthy" ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"}`}>
            <span className="flex items-center gap-2 text-[13px] text-gray-800">
              {chosen?.health === "healthy" ? <CheckCircle2 className="h-5 w-5 fill-emerald-500 text-white" /> : <TriangleAlert className="h-5 w-5 text-amber-500" />}
              {chosen ? (chosen.health === "healthy" ? `${chosen.name} is connected and tracking events.${data.lastSentAt ? ` Last event sent ${ago(data.lastSentAt)}.` : ""}` : `${chosen.name} needs attention — test the connection.`) : "Connect a data source for this platform in Data Sources."}
            </span>
            {chosen ? <button type="button" className={smallButton} disabled={testing} onClick={() => void test()}><Radio className="h-3.5 w-3.5" /> {testing ? "Testing…" : "Test Connection"}</button> : <button type="button" className={smallButton} onClick={() => onTab("sources")}>Open Data Sources</button>}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <h2 className="m-0 flex items-center gap-1.5 text-[17px] font-black text-gray-900 dark:text-slate-100">Tracking Mode <Info className="h-4 w-4 text-gray-400" /></h2>
          <div className="mt-3"><TrackingMode draft={draft} set={set} /></div>
          <div className="mt-3 flex gap-3 rounded-xl bg-blue-50 p-4 dark:bg-blue-950/30">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div><p className="m-0 text-[13.5px] font-semibold text-blue-700">Recommended for your setup</p><p className="m-0 mt-0.5 text-[12.5px] text-gray-700 dark:text-slate-300">Order-based tracking gives you better accuracy, prevents duplicate events and works across all your WordPress sites and landing pages.</p></div>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="m-0 flex items-center gap-2 text-[17px] font-black text-gray-900 dark:text-slate-100"><Globe className="h-5 w-5" /> Default Website &amp; Form</h2>
          <label className={`${labelCls} mt-3`}>Default Website<select value={draft.defaultWebsiteId ?? ""} onChange={(e) => set({ defaultWebsiteId: e.target.value || null })} className={input}><option value="">None</option>{data.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</select><span className="mt-1 block text-[11.5px] font-normal text-gray-500">Used when creating new tracking links.{site ? "" : ""}</span></label>
          <label className={`${labelCls} mt-3`}>Default Form Tracking Profile<select value={draft.defaultProfileId ?? ""} onChange={(e) => set({ defaultProfileId: e.target.value || null })} className={input}><option value="">None</option>{data.profiles.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select><span className="mt-1 block text-[11.5px] font-normal text-gray-500">Default profile for new embed forms. Manage profiles in Platform Settings.</span></label>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between"><h2 className="m-0 text-[17px] font-black text-gray-900 dark:text-slate-100">Tracking Health</h2><button type="button" className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-blue-600" onClick={() => onTab("diagnostics")}>View Diagnostics <ArrowRight className="h-3.5 w-3.5" /></button></div>
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
            {data.health.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-3 text-[13px]">
                <span className="flex items-center gap-2 text-gray-700 dark:text-slate-300">{item.ok ? <CheckCircle2 className="h-4 w-4 fill-emerald-500 text-white" /> : <TriangleAlert className="h-4 w-4 text-amber-500" />}{item.label}</span>
                <span className={`flex items-center gap-1.5 font-semibold ${item.ok ? "text-emerald-600" : "text-amber-600"}`}><span className={`h-2 w-2 rounded-full ${item.ok ? "bg-emerald-500" : "bg-amber-500"}`} />{item.value}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function PlatformSection({ data, onToast, onChanged, onTab }: { data: HubSettingsResponse; onToast: Toast; onChanged: () => void; onTab: (tab: HubTab) => void }) {
  const [editing, setEditing] = useState<HubProfile | "new" | null>(null);
  const sourceName = (id: string | null) => data.dataSources.find((row) => row.id === id)?.name ?? "—";
  const siteName = (id: string | null) => data.websites.find((row) => row.id === id)?.domain ?? "—";
  return (
    <div className="space-y-4">
      <Panel title="Platform Settings" sub="Data sources by platform. Add or change them in the Data Sources tab." action={<button type="button" className={smallButton} onClick={() => onTab("sources")}>Open Data Sources</button>}>
        <table className={tableCls}>
          <thead><tr className="text-gray-500"><th>Data source</th><th>Platform</th><th>Pixel / dataset</th><th>Status</th></tr></thead>
          <tbody>
            {data.dataSources.map((row) => <tr key={row.id} className={rowCls}><td className="py-2.5"><span className="flex items-center gap-2"><PlatformIcon platform={row.platform} size="sm" /><strong className="font-semibold">{row.name}</strong>{row.isMain ? <span className="rounded bg-blue-50 px-1.5 text-[10.5px] font-semibold text-blue-700">Default</span> : null}</span></td><td className="py-2.5 capitalize text-gray-600">{row.platform}</td><td className="py-2.5 font-mono text-[12px] text-gray-600">{row.pixelId}</td><td className="py-2.5"><StatusPill size="sm" tone={row.health === "healthy" ? "green" : row.health === "testing" || row.health === "unchecked" ? "orange" : "red"}>{row.health === "healthy" ? "Healthy" : row.health.replace("_", " ")}</StatusPill></td></tr>)}
            {data.dataSources.length === 0 ? <EmptyRow colSpan={4} text="No data source yet." /> : null}
          </tbody>
        </table>
      </Panel>
      <Panel title="Tracking Profiles" sub={'"Household products — Meta": a data source, default website and purchase strategy, chosen once per form instead of Pixel IDs.'} action={<button type="button" className={smallButton} onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" /> New profile</button>}>
        <div className="grid gap-3 md:grid-cols-2">
          {data.profiles.map((profile) => (
            <button key={profile.id} type="button" onClick={() => setEditing(profile)} className="!min-h-0 rounded-xl border border-gray-200 p-4 text-left hover:border-blue-300 dark:border-slate-700">
              <span className="flex items-center justify-between gap-2"><strong className="text-[14px] text-gray-900 dark:text-slate-100">{profile.name}</strong><StatusPill size="sm" tone={profile.status === "production" ? "green" : "orange"}>{profile.status === "production" ? "Production" : "Testing"}</StatusPill></span>
              <span className="mt-2 block text-[12px] text-gray-600">Data source: {sourceName(profile.dataSourceId)}</span>
              <span className="block text-[12px] text-gray-600">Website: {siteName(profile.defaultWebsiteId)}</span>
              <span className="block text-[12px] text-gray-600">Strategy: {STRATEGY_LABEL[profile.strategy]}</span>
              {profile.adAccountLabel ? <span className="block text-[12px] text-gray-600">Ad account: {profile.adAccountLabel}</span> : null}
            </button>
          ))}
          {data.profiles.length === 0 ? <p className="m-0 text-[13px] text-gray-500">No profile yet.</p> : null}
        </div>
      </Panel>
      {editing ? <ProfileForm profile={editing === "new" ? null : editing} data={data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onToast("Profile saved."); onChanged(); }} /> : null}
    </div>
  );
}

function ProfileForm({ profile, data, onClose, onSaved }: { profile: HubProfile | null; data: HubSettingsResponse; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: profile?.name ?? "", dataSourceId: profile?.dataSourceId ?? "", defaultWebsiteId: profile?.defaultWebsiteId ?? "", strategy: profile?.strategy ?? "browser_capi", adAccountLabel: profile?.adAccountLabel ?? "", status: profile?.status ?? "production" });
  const [error, setError] = useState("");
  return (
    <Modal title={profile ? `Edit ${profile.name}` : "New tracking profile"} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={`${labelCls} sm:col-span-2`}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Household Products - Meta" className={input} /></label>
        <label className={labelCls}>Data source<select value={form.dataSourceId} onChange={(e) => setForm({ ...form, dataSourceId: e.target.value })} className={input}><option value="">Choose…</option>{data.dataSources.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label className={labelCls}>Default website<select value={form.defaultWebsiteId} onChange={(e) => setForm({ ...form, defaultWebsiteId: e.target.value })} className={input}><option value="">None</option>{data.websites.map((row) => <option key={row.id} value={row.id}>{row.domain}</option>)}</select></label>
        <label className={labelCls}>Purchase strategy<select value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value as HubStrategy })} className={input}><option value="browser_capi">Browser + CAPI</option><option value="capi_only">CAPI only</option><option value="landing_page">Thank-you page Pixel</option></select></label>
        <label className={labelCls}>Ad account (name)<input value={form.adAccountLabel} onChange={(e) => setForm({ ...form, adAccountLabel: e.target.value })} placeholder="Household Ads" className={input} /></label>
        <label className={labelCls}>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as HubProfile["status"] })} className={input}><option value="production">Production</option><option value="testing">Testing</option></select></label>
      </div>
      {error ? <p className="m-0 mt-3 text-[13px] font-semibold text-rose-700">{error}</p> : null}
      <div className="mt-4 flex justify-between gap-2">
        {profile ? <button type="button" className={`${smallButton} !text-rose-700`} onClick={async () => { if (!window.confirm("Delete this profile?")) return; await trackingHubApi.deleteProfile(profile.id); onSaved(); }}>Delete</button> : <span />}
        <span className="flex gap-2"><button type="button" className={smallButton} onClick={onClose}>Cancel</button>
          <button type="button" className={`${darkButton} !rounded-lg !px-4 !py-2 !text-[13px]`} onClick={async () => { try { await trackingHubApi.saveProfile(profile?.id ?? null, { ...form, dataSourceId: form.dataSourceId || null, defaultWebsiteId: form.defaultWebsiteId || null }); onSaved(); } catch (err: any) { setError(err?.message ?? "Could not save."); } }}>Save</button></span>
      </div>
    </Modal>
  );
}

function AuditSection() {
  const { data } = useLoad(() => trackingHubApi.audit(), []);
  return (
    <Panel title="Audit Logs" sub="Who changed what in the Tracking Hub (last 300 changes).">
      <table className={tableCls}>
        <thead><tr className="text-gray-500"><th>When</th><th>What</th><th>On</th><th>By</th></tr></thead>
        <tbody>
          {(data?.entries ?? []).map((row: HubAuditEntry, index) => <tr key={index} className={rowCls}><td className="whitespace-nowrap py-2 text-gray-600"><Clock className="mr-1 inline h-3.5 w-3.5" />{ago(row.at)} · {timeOf(row.at)}</td><td className="py-2 font-semibold">{auditLabel(row.action)}</td><td className="py-2 text-gray-600">{row.subject ?? row.subjectType ?? "—"}</td><td className="py-2 text-gray-600">{row.by ?? "System"}</td></tr>)}
          {data && data.entries.length === 0 ? <EmptyRow colSpan={4} text="No changes recorded yet." /> : null}
          {!data ? <EmptyRow colSpan={4} text="Loading…" /> : null}
        </tbody>
      </table>
    </Panel>
  );
}

