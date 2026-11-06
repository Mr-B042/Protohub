import { useEffect, useState } from "react";
import { ArrowRight, BellRing, Info, Loader2 } from "lucide-react";
import { telegramApi } from "../../lib/api";
import { Card, Toggle, btn, type TgTab } from "./tg-ui";

type Group = { key: string; label: string; hint: string; enabled: boolean };

/**
 * Notifications & Alerts: phone alerts the app already sends can also land in
 * Telegram. Each person only gets what they already get on their phone
 * (Settings → Alert routing decides who); Telegram is one more place for it.
 */
export default function TabAlerts({ onToast, goTab, botConnected }: { onToast: (message: string) => void; goTab: (tab: TgTab) => void; botConnected: boolean }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { telegramApi.alerts().then((result) => setGroups(result.groups)).catch((err: Error) => setError(err.message)); }, []);

  const flip = async (key: string, next: boolean) => {
    if (!groups) return;
    const updated = groups.map((group) => group.key === key ? { ...group, enabled: next } : group);
    setGroups(updated);
    setSaving(true);
    try {
      await telegramApi.saveAlerts(updated.filter((group) => group.enabled).map((group) => group.key));
      onToast(next ? "These alerts now also go to Telegram." : "These alerts stay on phones only.");
    } catch (err) {
      setGroups(groups);
      onToast((err as Error).message || "Could not save.");
    } finally { setSaving(false); }
  };

  if (!botConnected) return <Card className="p-8 text-center text-[14px] text-gray-600">Connect the bot first (Bot Configuration).</Card>;
  if (error) return <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">Could not load alerts: {error}</p>;
  if (!groups) return <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-50"><BellRing className="h-5 w-5 text-amber-600" /></span>
          <div>
            <b className="text-[16px] text-gray-900 dark:text-slate-50">Also send these phone alerts to Telegram</b>
            <p className="m-0 text-[13px] text-gray-500">Each person gets only the alerts they already get on their phone.</p>
          </div>
          {saving && <Loader2 className="ml-auto h-4 w-4 animate-spin text-gray-400" />}
        </div>
        <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
          {groups.map((group) => (
            <li key={group.key} className="flex items-center gap-4 px-5 py-4">
              <div className="min-w-0 flex-1">
                <b className="block text-[14.5px] text-gray-900 dark:text-slate-100">{group.label}</b>
                <span className="block text-[13px] text-gray-500">{group.hint}</span>
              </div>
              <Toggle on={group.enabled} disabled={saving} label={`${group.label} to Telegram`} onChange={(next) => flip(group.key, next)} />
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <div className="flex items-start gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0 text-[#1F8FE0]" /><b className="text-[15px] text-gray-900 dark:text-slate-50">Not listed here</b></div>
        <p className="m-0 mt-2 text-[13.5px] text-gray-700 dark:text-slate-300">New orders, follow-up reminders, failed deliveries, low stock and the daily and weekly reports are Automations: you choose exactly who gets each one there, so they never arrive twice.</p>
        <button type="button" className={`${btn.link} mt-3`} onClick={() => goTab("automations")}>Go to Automations <ArrowRight className="h-4 w-4" /></button>
        <p className="m-0 mt-5 text-[13.5px] text-gray-700 dark:text-slate-300">Who gets each phone alert in the first place is set in <b>Settings → Alert routing</b>.</p>
      </Card>
    </div>
  );
}
