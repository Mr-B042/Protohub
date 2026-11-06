import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart3, Bell, Code2, Home, Loader2, MessageSquare, MoreVertical, Plus, Send, Settings, Users, Zap } from "lucide-react";
import { telegramApi, type TelegramAutomation, type TelegramOverview, type TelegramStaff, type TelegramTrigger } from "../../lib/api";
import TabOverview from "./TabOverview";
import TabBotConfig from "./TabBotConfig";
import TabAutomations, { AutomationEditor } from "./TabAutomations";
import TabAlerts from "./TabAlerts";
import TabStaff, { copyToClipboard } from "./TabStaff";
import TabCommands from "./TabCommands";
import TabMessages from "./TabMessages";
import TabLogs from "./TabLogs";
import { TgLogo, btn, type TgTab } from "./tg-ui";

/**
 * Telegram Automation Center (Bright, 6 Nov 2026). Owner only: it holds the
 * bot token. Overview follows Bright's design; the other seven tabs follow
 * its style (he asked for them to be built the same way).
 */

const TABS: Array<{ key: TgTab; label: string; Icon: typeof Home }> = [
  { key: "overview", label: "Overview", Icon: Home },
  { key: "bot", label: "Bot Configuration", Icon: Settings },
  { key: "automations", label: "Automations", Icon: Zap },
  { key: "alerts", label: "Notifications & Alerts", Icon: Bell },
  { key: "staff", label: "Staff & Recipients", Icon: Users },
  { key: "commands", label: "Commands & Actions", Icon: Code2 },
  { key: "messages", label: "Message Center", Icon: MessageSquare },
  { key: "logs", label: "Logs & Analytics", Icon: BarChart3 }
];

const tabFromHash = (): TgTab => {
  const match = window.location.hash.match(/[?&]tab=([a-z]+)/);
  return (TABS.find((tab) => tab.key === match?.[1])?.key) ?? "overview";
};

type Props = { onToast: (message: string) => void; meId: string | null; myName: string };

export default function TelegramCenterPage({ onToast, meId, myName }: Props) {
  const [tab, setTabState] = useState<TgTab>(tabFromHash);
  const [period, setPeriod] = useState("week");
  const [overview, setOverview] = useState<TelegramOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [automationData, setAutomationData] = useState<{ automations: TelegramAutomation[]; triggers: TelegramTrigger[]; roles: string[] } | null>(null);
  const [editor, setEditor] = useState<{ editing: TelegramAutomation | null } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [testing, setTesting] = useState(false);
  const menuRef = useRef<HTMLButtonElement | null>(null);

  const setTab = (next: TgTab) => {
    setTabState(next);
    const base = window.location.hash.split("?")[0] || "#/dashboard/admin/telegram-bot";
    window.history.replaceState(null, "", `${base}${next === "overview" ? "" : `?tab=${next}`}`);
  };

  const loadOverview = useCallback(() => {
    setLoading(true);
    return telegramApi.overview(period)
      .then((result) => { setOverview(result); setError(""); })
      .catch((err: Error) => setError(err.message || "Could not load the Telegram overview."))
      .finally(() => setLoading(false));
  }, [period]);
  const loadAutomations = useCallback(() => telegramApi.automations().then(setAutomationData).catch(() => setAutomationData({ automations: [], triggers: [], roles: [] })), []);

  useEffect(() => { void loadOverview(); }, [loadOverview]);
  useEffect(() => { void loadAutomations(); }, [loadAutomations]);

  const refresh = () => { void loadOverview(); void loadAutomations(); };
  const connected = Boolean(overview?.bot?.connected);
  const staff: TelegramStaff[] = overview?.staff ?? [];

  const openCreate = () => {
    if (!connected) { onToast("Connect the bot first (Bot Configuration)."); setTab("bot"); return; }
    setEditor({ editing: null });
  };
  const toggleAutomation = async (id: string, enabled: boolean) => {
    setBusyId(id);
    try { await telegramApi.updateAutomation(id, { enabled }); onToast(enabled ? "Automation on." : "Automation paused."); refresh(); } catch (err) { onToast((err as Error).message || "Could not save."); } finally { setBusyId(null); }
  };
  const staffLink = async (row: TelegramStaff) => {
    setBusyId(row.id);
    try {
      const { url } = row.id === meId ? await telegramApi.linkMe() : await telegramApi.linkStaff(row.id);
      if (row.id === meId) { window.open(url, "_blank", "noopener"); onToast("Telegram opened: tap Start there to finish."); }
      else { await copyToClipboard(url); onToast(`Link copied. Send it to ${row.name}: it works once, for 30 minutes.`); }
    } catch (err) { onToast((err as Error).message || "Could not make the link."); } finally { setBusyId(null); }
  };
  const staffUnlink = async (row: TelegramStaff) => {
    if (!window.confirm(`Disconnect ${row.name}'s Telegram?`)) return;
    setBusyId(row.id);
    try { await (row.id === meId ? telegramApi.unlinkMe() : telegramApi.unlinkStaff(row.id)); onToast("Disconnected."); refresh(); } catch (err) { onToast((err as Error).message || "Could not disconnect."); } finally { setBusyId(null); }
  };
  const testBot = async () => {
    if (!connected) { onToast("Connect the bot first (Bot Configuration)."); setTab("bot"); return; }
    setTesting(true);
    try { await telegramApi.test(); onToast("Test message sent to your Telegram."); refresh(); } catch (err) { onToast((err as Error).message || "Could not send the test."); } finally { setTesting(false); }
  };

  const menuBox = menuRef.current?.getBoundingClientRect();

  return (
    <div className="mx-auto w-full max-w-[1520px] space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <TgLogo size={64} className="shrink-0 drop-shadow-sm" />
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[26px] font-extrabold tracking-tight text-gray-900 dark:text-slate-50">Telegram Automation Center</h1>
          <p className="m-0 mt-0.5 text-[15px] text-gray-600 dark:text-slate-400">Automate notifications, team communication, and operational workflows with Telegram.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-semibold ${connected ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300" : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300"}`}>
            <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500" : "bg-gray-400"}`} />{loading && !overview ? "Checking…" : connected ? "Connected" : "Not connected"}
          </span>
          <button type="button" className={btn.ghost} disabled={testing} onClick={testBot}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Test Bot</button>
          <button type="button" className={btn.primary} onClick={openCreate}><Plus className="h-4 w-4" />Create Automation</button>
          <button ref={menuRef} type="button" aria-label="More" onClick={() => setMenu(!menu)} className="!min-h-0 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><MoreVertical className="h-5 w-5" /></button>
        </div>
      </div>
      {menu && menuBox && createPortal(
        <>
          <div className="fixed inset-0 z-[80]" onClick={() => setMenu(false)} />
          <div className="fixed z-[81] w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" style={{ top: menuBox.bottom + 6, left: Math.max(8, menuBox.right - 224) }}>
            <button type="button" className="!min-h-0 w-full rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-gray-50 dark:hover:bg-slate-800" onClick={async () => { setMenu(false); try { await telegramApi.check(); onToast("Checked with Telegram."); refresh(); } catch (err) { onToast((err as Error).message); } }}>Check connection now</button>
            {overview?.bot?.username && <a className="block rounded-lg px-3 py-2 text-[13.5px] text-gray-800 hover:bg-gray-50 dark:text-slate-100 dark:hover:bg-slate-800" href={`https://t.me/${overview.bot.username}`} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}>Open the bot in Telegram</a>}
            <button type="button" className="!min-h-0 w-full rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenu(false); refresh(); }}>Refresh numbers</button>
            <button type="button" className="!min-h-0 w-full rounded-lg px-3 py-2 text-left text-[13.5px] hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenu(false); setTab("bot"); }}>Bot settings</button>
          </div>
        </>, document.body)}

      {/* Tabs */}
      <nav className="overflow-x-auto rounded-2xl border border-gray-200/80 bg-white p-1.5 shadow-[0_1px_3px_rgba(16,24,40,0.06)] dark:border-slate-800 dark:bg-slate-900" aria-label="Telegram sections">
        <div className="flex min-w-max gap-0.5 xl:min-w-0 xl:justify-between">
          {TABS.map(({ key, label, Icon }) => (
            <button key={key} type="button" onClick={() => setTab(key)} aria-current={tab === key ? "page" : undefined}
              className={`!min-h-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[13px] font-medium transition 2xl:px-3 2xl:text-[13.5px] ${tab === key ? "bg-[#1F8FE0] text-white shadow-sm" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
      </nav>

      {error && tab === "overview" && <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">{error}</p>}

      {tab === "overview" && <TabOverview data={overview} period={period} onPeriod={setPeriod} goTab={setTab} onCreateAutomation={openCreate} onToggleAutomation={toggleAutomation} onStaffLink={staffLink} onStaffUnlink={staffUnlink} busyId={busyId} />}
      {tab === "bot" && <TabBotConfig onToast={onToast} onChanged={refresh} />}
      {tab === "automations" && <TabAutomations automations={automationData?.automations ?? []} loaded={Boolean(automationData)} botConnected={connected} onCreate={openCreate} onEdit={(row) => setEditor({ editing: row })} onChanged={refresh} onToast={onToast} />}
      {tab === "alerts" && <TabAlerts onToast={onToast} goTab={setTab} botConnected={connected} />}
      {tab === "staff" && <TabStaff onToast={onToast} meId={meId} onChanged={refresh} botConnected={connected} />}
      {tab === "commands" && <TabCommands onToast={onToast} botConnected={connected} />}
      {tab === "messages" && <TabMessages staff={staff} onToast={onToast} botConnected={connected} myName={myName} />}
      {tab === "logs" && <TabLogs botConnected={connected} />}

      {editor && automationData && (
        <AutomationEditor editing={editor.editing} triggers={automationData.triggers} roles={automationData.roles} staff={staff}
          onClose={() => setEditor(null)} onToast={onToast} onSaved={() => { setEditor(null); refresh(); }} />
      )}
    </div>
  );
}
