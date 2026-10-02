import { useState, type ReactNode } from "react";
import { Activity, Database, FileText, Globe, Link2, Monitor, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { PRESETS, type HubTab, type Range } from "../components/tracking-hub/HubParts";
import OverviewTab from "../components/tracking-hub/OverviewTab";
import DataSourcesTab from "../components/tracking-hub/DataSourcesTab";
import WebsitesTab from "../components/tracking-hub/WebsitesTab";
import LinksTab from "../components/tracking-hub/LinksTab";
import LedgerTab from "../components/tracking-hub/LedgerTab";
import ReconciliationTab from "../components/tracking-hub/ReconciliationTab";
import DiagnosticsTab from "../components/tracking-hub/DiagnosticsTab";
import SettingsTab from "../components/tracking-hub/SettingsTab";

/**
 * Tracking Hub (Bright, 2 Oct 2026): one place for ad conversion tracking.
 * Every tab is built to one of Bright's images: each draws its own page
 * header (breadcrumb, title, actions) above this tab bar, then its content.
 * Owner only (it holds the Meta tokens).
 */

const TABS: Array<{ key: HubTab; label: string; icon: typeof Monitor }> = [
  { key: "overview", label: "Overview", icon: Monitor },
  { key: "sources", label: "Data Sources", icon: Database },
  { key: "websites", label: "Websites", icon: Globe },
  { key: "links", label: "Tracking Links", icon: Link2 },
  { key: "ledger", label: "Event Ledger", icon: FileText },
  { key: "reconciliation", label: "Reconciliation", icon: RefreshCw },
  { key: "diagnostics", label: "Diagnostics", icon: Activity },
  { key: "settings", label: "Settings", icon: SettingsIcon }
];

export default function TrackingHubPage({ onToast, renderMetaDefaults, onOpenOrder }: { onToast: (message: string) => void; renderMetaDefaults?: () => ReactNode; onOpenOrder?: (orderId: string) => void }) {
  const [tab, setTab] = useState<HubTab>("overview");
  const [range, setRange] = useState<Range>(PRESETS[0].range());
  const [creatingLink, setCreatingLink] = useState(0);
  const [ledgerFilter, setLedgerFilter] = useState<{ status?: string; orderIds?: string[] }>({});
  const [ledgerKey, setLedgerKey] = useState(0);
  const openLedger = (filter: { status?: string; orderIds?: string[] }) => { setLedgerFilter(filter); setLedgerKey((value) => value + 1); setTab("ledger"); };
  const go = (next: HubTab) => { if (next === "ledger") setLedgerFilter({}); setTab(next); };

  const tabBar = (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white px-2 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex min-w-max gap-1">
        {TABS.map((item) => (
          <button key={item.key} type="button" onClick={() => go(item.key)}
            className={`!min-h-0 inline-flex items-center gap-2 border-b-2 px-4 py-3.5 text-[14px] font-semibold transition-colors ${tab === item.key ? "border-blue-600 text-blue-600" : "border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-300"}`}>
            <item.icon className="h-4 w-4" /> {item.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (tab === "sources") return <DataSourcesTab tabBar={tabBar} onToast={onToast} />;
  if (tab === "websites") return <WebsitesTab tabBar={tabBar} onToast={onToast} />;
  if (tab === "links") return <LinksTab tabBar={tabBar} onToast={onToast} createSignal={creatingLink} />;
  if (tab === "ledger") return <LedgerTab key={ledgerKey} tabBar={tabBar} onToast={onToast} range={range} onRange={setRange} initial={ledgerFilter} onOpenOrder={onOpenOrder} />;
  if (tab === "reconciliation") return <ReconciliationTab tabBar={tabBar} onToast={onToast} range={range} onRange={setRange} onOpenLedger={openLedger} />;
  if (tab === "diagnostics") return <DiagnosticsTab tabBar={tabBar} onToast={onToast} range={range} onRange={setRange} onTab={go} onOpenLedger={openLedger} />;
  if (tab === "settings") return <SettingsTab tabBar={tabBar} onToast={onToast} onTab={go} renderMetaDefaults={renderMetaDefaults} />;
  return <OverviewTab tabBar={tabBar} range={range} onRange={setRange} onTab={go} onToast={onToast} onOpenLedger={openLedger} onCreateLink={() => { setTab("links"); setCreatingLink((value) => value + 1); }} />;
}
