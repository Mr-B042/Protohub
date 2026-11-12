import { useCallback, useEffect, useState, type ComponentType } from "react";
import { BarChart3, CheckSquare, Home, Infinity as InfinityIcon, MessageSquareText, MessagesSquare, Settings, Users, UserSquare2, Workflow, CalendarClock } from "lucide-react";
import { socialLeadsApi, type SlHeader, type SlProduct } from "../../lib/api";
import { FacebookIcon, InstagramIcon } from "../../components/SocialIcons";
import OverviewTab from "./OverviewTab";
import InboxTab from "./InboxTab";
import AllLeadsTab from "./AllLeadsTab";
import FollowUpsTab from "./FollowUpsTab";
import ConvertedTab from "./ConvertedTab";
import AutomationsTab from "./AutomationsTab";
import TeamTab from "./TeamTab";
import AnalyticsTab from "./AnalyticsTab";
import SettingsTab from "./SettingsTab";

/**
 * Social Leads Inbox (Bright, 12 Nov 2026): Facebook / Instagram comments
 * and messages through ManyChat become leads, handed to call reps, worked
 * here and turned into orders. Nine tabs, each to Bright's design.
 */

export type SlTab = "overview" | "inbox" | "leads" | "follow-ups" | "converted" | "automations" | "team" | "analytics" | "settings";
const TABS: Array<{ key: SlTab; label: string; Icon: ComponentType<{ className?: string }>; leadership?: boolean; setup?: boolean }> = [
  { key: "overview", label: "Overview", Icon: Home },
  { key: "inbox", label: "Inbox", Icon: MessageSquareText },
  { key: "leads", label: "All Leads", Icon: UserSquare2 },
  { key: "follow-ups", label: "Follow-ups", Icon: CalendarClock },
  { key: "converted", label: "Converted", Icon: CheckSquare },
  { key: "automations", label: "Automations", Icon: Workflow, leadership: true },
  { key: "team", label: "Team Performance", Icon: Users, leadership: true },
  { key: "analytics", label: "Analytics", Icon: BarChart3, leadership: true },
  { key: "settings", label: "Settings", Icon: Settings, setup: true }
];

export type Shared = {
  header: SlHeader | null;
  products: SlProduct[];
  reps: Array<{ id: string; name: string; role: string; avatar: string | null; inRotation: boolean }>;
  role: string;
  leadership: boolean;
  canSetup: boolean;
  onToast: (message: string) => void;
  refreshHeader: () => void;
  openLead: (leadId: string) => void;
  goTab: (tab: SlTab) => void;
  onOpenOrder?: (orderId: string) => void;
};

const readHash = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "");
const writeHash = (params: Record<string, string | null>) => {
  const [path, query = ""] = window.location.hash.split("?");
  const next = new URLSearchParams(query);
  for (const [k, v] of Object.entries(params)) { if (v === null) next.delete(k); else next.set(k, v); }
  const qs = next.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${path}${qs ? `?${qs}` : ""}`);
};

function ConnectionPill({ icon, label, on }: { icon: React.ReactNode; label?: string; on: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      {icon}
      {label && <b className="text-[14px] text-gray-900 dark:text-slate-100">{label}</b>}
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${on ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-gray-400"}`} />{on ? "Connected" : "Not connected"}
      </span>
    </span>
  );
}

export default function SocialLeadsPage({ currentRole, onToast, onOpenOrder }: { currentRole: string; onToast: (message: string) => void; onOpenOrder?: (orderId: string) => void }) {
  const leadership = currentRole === "Owner" || currentRole === "Admin" || currentRole === "Manager";
  const canSetup = currentRole === "Owner" || currentRole === "Admin";
  const initial = readHash();
  const [tab, setTab] = useState<SlTab>(() => {
    const t = initial.get("tab") as SlTab | null;
    if (initial.get("lead")) return "inbox";
    if (t && TABS.some((x) => x.key === t)) return t;
    return leadership ? "overview" : "inbox";
  });
  const [leadId, setLeadId] = useState<string | null>(initial.get("lead"));
  const [header, setHeader] = useState<SlHeader | null>(null);
  const [products, setProducts] = useState<SlProduct[]>([]);
  const [reps, setReps] = useState<Shared["reps"]>([]);
  const [error, setError] = useState("");

  const refreshHeader = useCallback(() => {
    socialLeadsApi.header().then((h) => { setHeader(h); setError(""); }).catch((e: Error) => setError(e.message || "Could not load the inbox."));
  }, []);
  useEffect(() => {
    refreshHeader();
    socialLeadsApi.products().then((r) => setProducts(r.products)).catch(() => undefined);
    socialLeadsApi.reps().then((r) => setReps(r.reps)).catch(() => undefined);
    const timer = window.setInterval(refreshHeader, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshHeader]);
  // A notification link (…?lead=ID) opens that conversation.
  useEffect(() => {
    const onHash = () => { const id = readHash().get("lead"); if (id) { setLeadId(id); setTab("inbox"); } };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const goTab = (next: SlTab) => { setTab(next); writeHash({ tab: next, lead: next === "inbox" ? leadId : null }); };
  const openLead = (id: string) => { setLeadId(id); setTab("inbox"); writeHash({ tab: "inbox", lead: id }); };
  const shared: Shared = { header, products, reps, role: currentRole, leadership, canSetup, onToast, refreshHeader, openLead, goTab, onOpenOrder };
  const visible = TABS.filter((t) => (!t.leadership || leadership) && (!t.setup || canSetup));
  const conn = header?.connection;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#EEEBFC] text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-300"><MessagesSquare className="h-7 w-7" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="m-0 text-[26px] font-extrabold leading-tight text-gray-900 dark:text-slate-50">Social Leads Inbox</h1>
          <p className="m-0 text-[15px] text-gray-600 dark:text-slate-400">Capture, engage and convert customers from Facebook &amp; Instagram with Manychat</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionPill icon={<InfinityIcon className="h-6 w-6 text-[#2F5BEA]" />} label="ManyChat" on={Boolean(conn?.manychat)} />
          <ConnectionPill icon={<FacebookIcon className="h-6 w-6" />} on={Boolean(conn?.facebook)} />
          <ConnectionPill icon={<InstagramIcon className="h-6 w-6" />} on={Boolean(conn?.instagram)} />
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-gray-200/80 bg-white p-1.5 dark:border-slate-800 dark:bg-slate-900" aria-label="Social Leads Inbox sections">
        {visible.map(({ key, label, Icon }) => {
          const count = key === "inbox" ? header?.counts.inbox : key === "follow-ups" ? header?.counts.followUpsDue : 0;
          return (
            <button key={key} type="button" onClick={() => goTab(key)} aria-current={tab === key ? "page" : undefined}
              className={`!min-h-0 inline-flex flex-1 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-[14.5px] font-semibold ${tab === key ? "bg-[#5B3FD9] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
              <Icon className="h-[18px] w-[18px]" />{label}
              {Boolean(count) && <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${tab === key ? "bg-white/25 text-white" : "bg-rose-500 text-white"}`}>{count}</span>}
            </button>
          );
        })}
      </nav>

      {error && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{error}</p>}
      {header && !header.connection.manychat && canSetup && tab !== "settings" && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <span>ManyChat is not connected yet, so no Facebook or Instagram leads are coming in. Connect it in Settings › Integrations.</span>
          <button type="button" onClick={() => goTab("settings")} className="!min-h-0 rounded-lg bg-amber-600 px-3 py-1.5 text-[12.5px] font-semibold text-white">Open Settings</button>
        </div>
      )}

      {tab === "overview" && <OverviewTab shared={shared} />}
      {tab === "inbox" && <InboxTab shared={shared} leadId={leadId} onLead={(id) => { setLeadId(id); writeHash({ tab: "inbox", lead: id }); }} />}
      {tab === "leads" && <AllLeadsTab shared={shared} />}
      {tab === "follow-ups" && <FollowUpsTab shared={shared} />}
      {tab === "converted" && <ConvertedTab shared={shared} />}
      {tab === "automations" && leadership && <AutomationsTab shared={shared} />}
      {tab === "team" && leadership && <TeamTab shared={shared} />}
      {tab === "analytics" && leadership && <AnalyticsTab shared={shared} />}
      {tab === "settings" && canSetup && <SettingsTab shared={shared} />}
    </div>
  );
}
