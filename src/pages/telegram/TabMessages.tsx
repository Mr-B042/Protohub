import { useEffect, useMemo, useState } from "react";
import { Loader2, Megaphone, Send, X } from "lucide-react";
import { telegramApi, type TelegramStaff } from "../../lib/api";
import { Card, CardHead, TgLogo, btn, dateTime, roleShort } from "./tg-ui";

type Audience = "everyone" | "roles" | "people";

/** Message Center: announcements to staff on Telegram, and what was sent before. */
export default function TabMessages({ staff, onToast, botConnected, myName }: { staff: TelegramStaff[]; onToast: (message: string) => void; botConnected: boolean; myName: string }) {
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<Audience>("everyone");
  const [roles, setRoles] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [pick, setPick] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof telegramApi.announcements>>["announcements"] | null>(null);

  const load = () => telegramApi.announcements().then((result) => setHistory(result.announcements)).catch(() => setHistory([]));
  useEffect(() => { if (botConnected) void load(); }, [botConnected]);

  const allRoles = useMemo(() => [...new Set(staff.map((row) => row.role))].sort(), [staff]);
  const targets = staff.filter((row) => audience === "everyone" || (audience === "roles" ? roles.includes(row.role) : people.includes(row.id)));
  const reachable = targets.filter((row) => row.linked).length;

  const send = async () => {
    setSending(true);
    try {
      const result = await telegramApi.announce({ text: text.trim(), everyone: audience === "everyone", roles: audience === "roles" ? roles : [], userIds: audience === "people" ? people : [] });
      onToast(`Sent to ${result.sent}${result.failed ? `, ${result.failed} failed` : ""}${result.notLinked ? ` · ${result.notLinked} not connected yet` : ""}.`);
      setText("");
      await load();
    } catch (err) { onToast((err as Error).message || "Could not send."); } finally { setSending(false); }
  };

  if (!botConnected) return <Card className="p-8 text-center text-[14px] text-gray-600">Connect the bot first (Bot Configuration).</Card>;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
      <Card className="pb-5">
        <CardHead title="Send an announcement" />
        <div className="mt-3 space-y-4 px-5">
          <div className="flex flex-wrap gap-2">
            {([["everyone", "Everyone connected"], ["roles", "By role"], ["people", "Specific people"]] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setAudience(key)} className={`!min-h-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold ${audience === key ? "border-[#1F8FE0] bg-[#1F8FE0] text-white" : "border-gray-200 text-gray-700 dark:border-slate-700 dark:text-slate-300"}`}>{label}</button>
            ))}
          </div>
          {audience === "roles" && (
            <div className="flex flex-wrap gap-2">
              {allRoles.map((role) => {
                const on = roles.includes(role);
                return <button key={role} type="button" onClick={() => setRoles(on ? roles.filter((r) => r !== role) : [...roles, role])} className={`!min-h-0 rounded-full border px-3 py-1.5 text-[13px] font-semibold ${on ? "border-[#1F8FE0] bg-[#1F8FE0]/10 text-[#1F6FC4]" : "border-gray-200 text-gray-600 dark:border-slate-700"}`}>{on ? "✓ " : ""}{roleShort(role)}</button>;
              })}
            </div>
          )}
          {audience === "people" && (
            <div>
              <div className="flex gap-2">
                <select aria-label="Add a person" value={pick} onChange={(event) => setPick(event.target.value)} className="h-10 flex-1 rounded-xl border border-gray-200 bg-white px-3 text-[13px] dark:border-slate-700 dark:bg-slate-900">
                  <option value="">Choose a person…</option>
                  {staff.filter((row) => !people.includes(row.id)).map((row) => <option key={row.id} value={row.id}>{row.name} ({roleShort(row.role)}){row.linked ? "" : " – not connected"}</option>)}
                </select>
                <button type="button" className={btn.ghost} disabled={!pick} onClick={() => { setPeople([...people, pick]); setPick(""); }}>Add</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {people.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[12.5px] font-semibold text-violet-700">{staff.find((row) => row.id === id)?.name}
                    <button type="button" aria-label="Remove" className="!min-h-0" onClick={() => setPeople(people.filter((x) => x !== id))}><X className="h-3.5 w-3.5" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <label className="block">
            <span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Message</span>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={5} maxLength={3500} placeholder="e.g. Team meeting at 4pm today. Please finish your follow-ups before then."
              className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[14px] dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-gray-600 dark:text-slate-400">{reachable} of {targets.length} will get it (the rest have not connected Telegram).</span>
            <button type="button" className={btn.primary} disabled={sending || !text.trim() || reachable === 0} onClick={send}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send</button>
          </div>
          {text.trim() && (
            <div className="rounded-2xl bg-[#DCEBF7] p-3 dark:bg-slate-800">
              <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-gray-700 dark:text-slate-200"><TgLogo size={18} />Preview</div>
              <div className="whitespace-pre-wrap rounded-xl bg-white p-3 text-[13.5px] text-gray-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"><b>📣 Announcement</b>{"\n"}{text.trim()}{"\n\n"}<i className="text-gray-500">– {myName}</i></div>
            </div>
          )}
        </div>
      </Card>
      <Card className="pb-3">
        <CardHead title="Sent before" />
        <ul className="m-0 mt-2 list-none divide-y divide-gray-100 p-0 px-5 dark:divide-slate-800">
          {(history ?? []).map((row) => (
            <li key={row.batchId} className="flex gap-3 py-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fuchsia-50"><Megaphone className="h-4 w-4 text-fuchsia-600" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 line-clamp-2 text-[13.5px] text-gray-900 dark:text-slate-100">{row.preview}</p>
                <span className="text-[12px] text-gray-500">{dateTime(row.createdAt)} · {row.sent} delivered{row.failed ? ` · ${row.failed} failed` : ""}</span>
              </div>
            </li>
          ))}
          {history && history.length === 0 && <li className="py-6 text-center text-[13px] text-gray-500">No announcements yet.</li>}
          {!history && <li className="py-6 text-center text-[13px] text-gray-500"><Loader2 className="inline h-4 w-4 animate-spin" /></li>}
        </ul>
      </Card>
    </div>
  );
}
