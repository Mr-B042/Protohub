import { useEffect, useState } from "react";
import { Eye, Loader2, Lock, Phone, TerminalSquare } from "lucide-react";
import { telegramApi } from "../../lib/api";
import { Card, CardHead, TgLogo, Toggle } from "./tg-ui";

type Data = Awaited<ReturnType<typeof telegramApi.commands>>;

const EXAMPLES: Record<string, string> = {
  start: "Sent by the Connect link, no typing needed",
  help: "/help",
  myorders: "/myorders",
  today: "/today",
  late: "/late",
  stock: "/stock edge",
  stop: "/stop"
};

/** Commands & Actions: what staff can type to the bot, and the buttons on its messages. */
export default function TabCommands({ onToast, botConnected }: { onToast: (message: string) => void; botConnected: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { telegramApi.commands().then(setData).catch((err: Error) => setError(err.message)); }, []);

  const flip = async (key: string, next: boolean) => {
    if (!data) return;
    const commands = data.commands.map((row) => row.key === key ? { ...row, enabled: next } : row);
    setData({ ...data, commands });
    setSaving(true);
    try {
      await telegramApi.saveCommands(Object.fromEntries(commands.filter((row) => row.key !== "start").map((row) => [row.key, row.enabled])));
      onToast(`/${key} ${next ? "switched on" : "switched off"}. Telegram's "/" menu is updated.`);
    } catch (err) {
      setData(data);
      onToast((err as Error).message || "Could not save.");
    } finally { setSaving(false); }
  };

  if (!botConnected) return <Card className="p-8 text-center text-[14px] text-gray-600">Connect the bot first (Bot Configuration).</Card>;
  if (error) return <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">Could not load commands: {error}</p>;
  if (!data) return <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_1fr]">
      <Card className="overflow-hidden">
        <CardHead title="Commands" action={<span className="text-[13px] text-gray-500">{data.repliesThisWeek} replies in the last 7 days{saving ? " · saving…" : ""}</span>} />
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-0 w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800/60">
                <th className="px-5 py-2">Command</th><th className="px-3 py-2">What it does</th><th className="px-3 py-2">Who can use it</th><th className="px-5 py-2 text-right">On</th>
              </tr>
            </thead>
            <tbody>
              {data.commands.map((row) => (
                <tr key={row.key} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                  <td className="whitespace-nowrap px-5 py-3"><code className="rounded-md bg-sky-50 px-2 py-1 font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">/{row.key}</code></td>
                  <td className="px-3 py-3 text-gray-800 dark:text-slate-200">{row.description}<span className="block text-[12px] text-gray-500">e.g. {EXAMPLES[row.key] ?? `/${row.key}`}</span></td>
                  <td className="px-3 py-3 text-gray-600 dark:text-slate-400">{row.who}</td>
                  <td className="px-5 py-3 text-right">{row.locked ? <span className="inline-flex items-center gap-1 text-[12px] text-gray-400"><Lock className="h-3.5 w-3.5" />Always on</span> : <Toggle on={row.enabled} disabled={saving} label={`/${row.key} on or off`} onChange={(next) => flip(row.key, next)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="space-y-4">
        <Card className="p-5">
          <b className="text-[15px] text-gray-900 dark:text-slate-50">Buttons on messages</b>
          <ul className="m-0 mt-3 list-none space-y-3 p-0 text-[13.5px] text-gray-700 dark:text-slate-300">
            <li className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span><b>Call Customer</b>: the bot replies with the customer's number to tap and call. Only the order's own rep and leadership get it.</span></li>
            <li className="flex gap-2"><Eye className="mt-0.5 h-4 w-4 shrink-0 text-[#1F8FE0]" /><span><b>View Order</b>: opens the order in Protohub.</span></li>
          </ul>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2"><TerminalSquare className="h-4 w-4 text-gray-500" /><b className="text-[15px] text-gray-900 dark:text-slate-50">What staff see when they type "/"</b></div>
          <div className="mt-3 rounded-2xl bg-[#DCEBF7] p-3 dark:bg-slate-800">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-gray-800 dark:text-slate-100"><TgLogo size={22} />{data.username ? `@${data.username}` : "Your bot"}</div>
            <ul className="m-0 list-none space-y-1 rounded-xl bg-white p-2 p-0 text-[13px] dark:bg-slate-900">
              {data.commands.filter((row) => row.key !== "start" && row.enabled).map((row) => (
                <li key={row.key} className="flex gap-2 px-3 py-1.5"><b className="text-sky-700">/{row.key}</b><span className="truncate text-gray-500">{row.description}</span></li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
