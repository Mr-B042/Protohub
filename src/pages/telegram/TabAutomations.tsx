import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Pencil, Plus, Send, Trash2, Users, X } from "lucide-react";
import { telegramApi, type TelegramAutomation, type TelegramAutomationSettings, type TelegramRecipients, type TelegramStaff, type TelegramTrigger } from "../../lib/api";
import { Card, HOURS, IconBubble, Toggle, WEEKDAYS, btn, roleShort } from "./tg-ui";

const GROUP_TITLES: Array<{ key: string; title: string }> = [
  { key: "new_orders", title: "New orders" },
  { key: "follow_ups", title: "Follow-ups" },
  { key: "delivery", title: "Delivery & logistics" },
  { key: "stock", title: "Stock & inventory" },
  { key: "reports", title: "Scheduled reports" }
];

const hourText = (hour?: number) => HOURS.find((row) => row.value === (hour ?? 9))?.label ?? "9 AM";

export function settingsText(row: Pick<TelegramAutomation, "trigger" | "settings">) {
  const s = row.settings;
  if (row.trigger === "send_out_soon") return `${s.minutesBefore ?? 5} working min before the 15-minute limit`;
  if (row.trigger === "low_stock") return `Usable stock at or below ${s.threshold ?? 5} at a hub`;
  if (row.trigger === "daily_report") return `Every day at ${hourText(s.hour)}, for yesterday`;
  if (row.trigger === "weekly_report") return `${WEEKDAYS[s.weekday ?? 1]}s at ${hourText(s.hour)}, for last week`;
  return null;
}

type EditorProps = {
  editing: TelegramAutomation | null;
  triggers: TelegramTrigger[];
  roles: string[];
  staff: TelegramStaff[];
  onClose: () => void;
  onSaved: (automation: TelegramAutomation) => void;
  onToast: (message: string) => void;
};

/** Create or change an automation (also opened by the header's "Create Automation"). */
export function AutomationEditor({ editing, triggers, roles, staff, onClose, onSaved, onToast }: EditorProps) {
  const [trigger, setTrigger] = useState(editing?.trigger ?? triggers[0]?.key ?? "order_new");
  const def = triggers.find((row) => row.key === trigger);
  const [name, setName] = useState(editing?.name ?? "");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [recipients, setRecipients] = useState<TelegramRecipients>(editing?.recipients ?? { roles: [], assignedRep: true, userIds: [] });
  const [settings, setSettings] = useState<TelegramAutomationSettings>(editing?.settings ?? {});
  const [saving, setSaving] = useState(false);
  const [person, setPerson] = useState("");

  useEffect(() => { if (!editing && def && !name) setName(defaultName(def)); }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRole = (role: string) => setRecipients((current) => ({ ...current, roles: current.roles.includes(role) ? current.roles.filter((r) => r !== role) : [...current.roles, role] }));
  const save = async () => {
    setSaving(true);
    try {
      const body = { name: name.trim(), enabled, recipients: { ...recipients, assignedRep: Boolean(def?.repApplies && recipients.assignedRep) }, settings };
      const result = editing ? await telegramApi.updateAutomation(editing.id, body) : await telegramApi.createAutomation({ trigger, ...body });
      onToast(editing ? "Automation saved." : "Automation created.");
      onSaved(result.automation);
    } catch (err) { onToast((err as Error).message || "Could not save."); } finally { setSaving(false); }
  };
  const nobody = !recipients.roles.length && !recipients.userIds.length && !(def?.repApplies && recipients.assignedRep);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={editing ? "Edit automation" : "Create automation"}>
      <div className="max-h-[92vh] w-full max-w-[620px] overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-slate-800">
          <b className="text-[17px] text-gray-900 dark:text-slate-50">{editing ? "Edit automation" : "Create automation"}</b>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1.5 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-5 px-6 py-5">
          <label className="block">
            <span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">What starts the message</span>
            <select value={trigger} disabled={Boolean(editing)} onChange={(event) => { setTrigger(event.target.value); setName(""); setSettings({}); }}
              className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-[14px] disabled:bg-gray-50 dark:border-slate-700 dark:bg-slate-900">
              {triggers.map((row) => <option key={row.key} value={row.key}>{row.label.replace("{threshold}", "a limit")} – {row.description}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-[14px] dark:border-slate-700 dark:bg-slate-900" />
          </label>
          {def && def.settings.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {def.settings.includes("minutesBefore") && (
                <label className="block"><span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Minutes left when it warns</span>
                  <input type="number" min={1} max={14} value={settings.minutesBefore ?? 5} onChange={(event) => setSettings({ ...settings, minutesBefore: Number(event.target.value) })} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 px-3 text-[14px] dark:border-slate-700 dark:bg-slate-900" /></label>
              )}
              {def.settings.includes("threshold") && (
                <label className="block"><span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Warn at or below (units)</span>
                  <input type="number" min={0} max={500} value={settings.threshold ?? 5} onChange={(event) => setSettings({ ...settings, threshold: Number(event.target.value) })} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 px-3 text-[14px] dark:border-slate-700 dark:bg-slate-900" /></label>
              )}
              {def.settings.includes("weekday") && (
                <label className="block"><span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Day</span>
                  <select value={settings.weekday ?? 1} onChange={(event) => setSettings({ ...settings, weekday: Number(event.target.value) })} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-[14px] dark:border-slate-700 dark:bg-slate-900">
                    {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                  </select></label>
              )}
              {def.settings.includes("hour") && (
                <label className="block"><span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Time (Lagos)</span>
                  <select value={settings.hour ?? 9} onChange={(event) => setSettings({ ...settings, hour: Number(event.target.value) })} className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-[14px] dark:border-slate-700 dark:bg-slate-900">
                    {HOURS.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}
                  </select></label>
              )}
            </div>
          )}
          <div>
            <span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Who gets it</span>
            {def?.repApplies && (
              <label className="mt-2 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-[14px] dark:border-slate-700">
                <input type="checkbox" checked={recipients.assignedRep} onChange={(event) => setRecipients({ ...recipients, assignedRep: event.target.checked })} />The order's own rep
              </label>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {roles.map((role) => {
                const on = recipients.roles.includes(role);
                return <button key={role} type="button" onClick={() => toggleRole(role)} className={`!min-h-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${on ? "border-[#1F8FE0] bg-[#1F8FE0]/10 text-[#1F6FC4]" : "border-gray-200 text-gray-600 dark:border-slate-700 dark:text-slate-300"}`}>{on ? "✓ " : ""}{roleShort(role)}</button>;
              })}
            </div>
            <div className="mt-3 flex gap-2">
              <select aria-label="Add a person" value={person} onChange={(event) => setPerson(event.target.value)} className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-[13px] dark:border-slate-700 dark:bg-slate-900">
                <option value="">Add a specific person…</option>
                {staff.filter((row) => !recipients.userIds.includes(row.id)).map((row) => <option key={row.id} value={row.id}>{row.name} ({roleShort(row.role)}){row.linked ? "" : " – not connected"}</option>)}
              </select>
              <button type="button" className={btn.ghost} disabled={!person} onClick={() => { setRecipients({ ...recipients, userIds: [...recipients.userIds, person] }); setPerson(""); }}>Add</button>
            </div>
            {recipients.userIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {recipients.userIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[12.5px] font-semibold text-violet-700">
                    {staff.find((row) => row.id === id)?.name ?? "Former staff"}
                    <button type="button" aria-label="Remove" onClick={() => setRecipients({ ...recipients, userIds: recipients.userIds.filter((x) => x !== id) })} className="!min-h-0"><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            )}
            <p className="m-0 mt-2 text-[12px] text-gray-500">Only people who connected their Telegram get messages. Inventory and logistics staff never see customer names, numbers or amounts.</p>
          </div>
          <label className="flex items-center justify-between rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-slate-800/60">
            <span className="text-[14px] font-semibold text-gray-800 dark:text-slate-200">On</span>
            <Toggle on={enabled} onChange={setEnabled} label="Automation on or off" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 dark:border-slate-800">
          <button type="button" className={btn.ghost} onClick={onClose}>Cancel</button>
          <button type="button" className={btn.primary} disabled={saving || !name.trim() || nobody} onClick={save}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Save" : "Create"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function defaultName(def: TelegramTrigger) {
  const names: Record<string, string> = {
    order_new: "New Order Alert", order_assigned: "Order Assigned Alert", send_out_soon: "Follow-up Reminder", follow_up_due: "Follow-up Due",
    order_confirmed: "Order Confirmed Alert", order_delivered: "Order Delivered Alert", order_failed: "Failed Delivery Alert",
    order_cancelled: "Order Cancelled Alert", order_rescheduled: "Rescheduled Delivery Alert", low_stock: "Low Stock Alert",
    daily_report: "Daily Sales Report", weekly_report: "Weekly Sales Report"
  };
  return names[def.key] ?? "New automation";
}

type Props = {
  automations: TelegramAutomation[];
  loaded: boolean;
  onCreate: () => void;
  onEdit: (automation: TelegramAutomation) => void;
  onChanged: () => void;
  onToast: (message: string) => void;
  botConnected: boolean;
};

export default function TabAutomations({ automations, loaded, onCreate, onEdit, onChanged, onToast, botConnected }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const grouped = useMemo(() => GROUP_TITLES.map((group) => ({ ...group, rows: automations.filter((row) => row.group === group.key) })).filter((group) => group.rows.length), [automations]);
  const act = async (key: string, task: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await task(); onToast(done); onChanged(); } catch (err) { onToast((err as Error).message || "Something went wrong."); } finally { setBusy(null); }
  };

  if (!botConnected) return <Card className="p-8 text-center text-[14px] text-gray-600">Connect the bot first (Bot Configuration). The ready-made automations appear as soon as it is connected.</Card>;
  if (!loaded) return <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-[14px] text-gray-600 dark:text-slate-400">{automations.filter((row) => row.enabled).length} of {automations.length} automations on. Each sends only to people who connected their Telegram.</p>
        <button type="button" className={btn.primary} onClick={onCreate}><Plus className="h-4 w-4" />Create Automation</button>
      </div>
      {grouped.map((group) => (
        <Card key={group.key} className="overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50/70 px-5 py-2.5 text-[12px] font-bold uppercase tracking-wide text-gray-500 dark:border-slate-800 dark:bg-slate-800/40">{group.title}</div>
          <ul className="m-0 list-none divide-y divide-gray-100 p-0 dark:divide-slate-800">
            {group.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <IconBubble trigger={row.trigger} />
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-[15px] text-gray-900 dark:text-slate-50">{row.name}</b>
                    {row.builtIn && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-slate-800 dark:text-slate-300">Ready-made</span>}
                  </div>
                  <p className="m-0 mt-0.5 text-[13px] text-gray-600 dark:text-slate-400">{row.description}{settingsText(row) ? ` · ${settingsText(row)}` : ""}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[12px]">
                    <span className="rounded-full bg-sky-50 px-2.5 py-1 font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{row.triggerLabel}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 font-semibold text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"><Users className="h-3.5 w-3.5" />{row.recipientLabel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" title="Send me a sample" className={btn.ghost} disabled={busy === `test-${row.id}`} onClick={() => act(`test-${row.id}`, () => telegramApi.testAutomation(row.id), "Sample sent to your Telegram.")}>
                    {busy === `test-${row.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}<span className="hidden sm:inline">Sample</span>
                  </button>
                  <button type="button" className={btn.ghost} onClick={() => onEdit(row)}><Pencil className="h-4 w-4" /><span className="hidden sm:inline">Edit</span></button>
                  {!row.builtIn && (
                    <button type="button" aria-label="Delete" className={btn.danger} disabled={busy === `del-${row.id}`} onClick={() => { if (window.confirm(`Delete "${row.name}"?`)) void act(`del-${row.id}`, () => telegramApi.deleteAutomation(row.id), "Automation deleted."); }}><Trash2 className="h-4 w-4" /></button>
                  )}
                  <Toggle on={row.enabled} disabled={busy === row.id} label={`${row.name} on or off`} onChange={(next) => act(row.id, () => telegramApi.updateAutomation(row.id, { enabled: next }), next ? "Automation on." : "Automation paused.")} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
