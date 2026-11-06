import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Send, ShieldCheck, Unplug } from "lucide-react";
import { telegramApi } from "../../lib/api";
import { Card, CardHead, TgLogo, btn, dateTime, pct, sinceText } from "./tg-ui";

type BotData = Awaited<ReturnType<typeof telegramApi.bot>>;

export default function TabBotConfig({ onToast, onChanged }: { onToast: (message: string) => void; onChanged: () => void }) {
  const [data, setData] = useState<BotData | null>(null);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);

  const load = () => telegramApi.bot().then((result) => { setData(result); setError(""); }).catch((err: Error) => setError(err.message));
  useEffect(() => { void load(); }, []);

  const run = async (key: string, task: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try { await task(); if (done) onToast(done); await load(); onChanged(); } catch (err) { onToast((err as Error).message || "Something went wrong."); } finally { setBusy(null); }
  };

  const connect = () => run("connect", async () => { await telegramApi.connect(token.trim()); setToken(""); setReplacing(false); }, "Bot connected.");
  const bot = data?.bot ?? null;

  const tokenForm = (
    <div className="space-y-3">
      <label className="block">
        <span className="text-[13px] font-semibold text-gray-800 dark:text-slate-200">Bot token from @BotFather</span>
        <div className="mt-1.5 flex gap-2">
          <div className="relative flex-1">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type={show ? "text" : "password"} value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false}
              placeholder="123456789:AAE…" className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-10 font-mono text-[13px] dark:border-slate-700 dark:bg-slate-900" />
            <button type="button" aria-label={show ? "Hide token" : "Show token"} onClick={() => setShow(!show)} className="!min-h-0 absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <button type="button" className={btn.primary} disabled={!token.trim() || busy === "connect"} onClick={connect}>
            {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Connect
          </button>
        </div>
      </label>
      <p className="m-0 flex items-start gap-1.5 text-[12.5px] text-gray-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />The token stays on Protohub's server. Nobody else sees it, and this page only ever shows its last 4 characters.</p>
    </div>
  );

  if (error) return <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">Could not load the bot: {error}</p>;
  if (!data) return <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;

  if (!bot) {
    return (
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
        <Card className="pb-5">
          <CardHead title="Connect your Telegram bot" />
          <ol className="m-0 mt-3 list-none space-y-3 px-5 p-0">
            {[
              <>Open Telegram and search <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-semibold text-[#1F8FE0]">@BotFather</a> (the official one, with a blue tick).</>,
              <>Send <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-slate-800">/newbot</code>. Give it a name, e.g. <b>ProtoHub Telegram Bot</b>, and a username that ends in "bot", e.g. <b>ProtoHubBot</b>.</>,
              <>BotFather replies with a token. Copy it and paste it below.</>
            ].map((step, index) => (
              <li key={index} className="flex gap-3 text-[14px] text-gray-800 dark:text-slate-200">
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1F8FE0] text-[13px] font-bold text-white">{index + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-5 px-5">{tokenForm}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3"><TgLogo size={44} /><b className="text-[16px] text-gray-900 dark:text-slate-50">What happens next</b></div>
          <ul className="m-0 mt-4 list-disc space-y-2 pl-5 text-[13.5px] text-gray-700 dark:text-slate-300">
            <li>Protohub sets up the bot's replies and its "/" menu for you.</li>
            <li>Seven ready-made automations are added (new orders, follow-up reminders, failed deliveries, low stock, daily and weekly reports). You can pause or change any of them.</li>
            <li>Each staff member connects their own Telegram once: Protohub → Notifications → Connect Telegram, then tap Start.</li>
            <li>Telegram does not charge for bot messages.</li>
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr]">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-4">
          <TgLogo size={64} />
          <div className="min-w-0 flex-1">
            <b className="block text-[19px] text-gray-900 dark:text-slate-50">{bot.name}</b>
            {bot.username && <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[14px] font-semibold text-[#1F8FE0]">@{bot.username}<ExternalLink className="h-3.5 w-3.5" /></a>}
            <p className="m-0 mt-1 text-[12.5px] text-gray-500">Connected {dateTime(bot.connectedAt)} · token {bot.tokenHint}</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ${bot.connected ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
            <span className={`h-2 w-2 rounded-full ${bot.connected ? "bg-emerald-500" : "bg-gray-400"}`} />{bot.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <dl className="m-0 mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            ["Webhook (replies reach Protohub)", bot.webhookActive ? "Active" : "Not active"],
            ["Last check", sinceText(bot.lastHealthAt)],
            ["Uptime, last 7 days", pct(bot.uptime)],
            ["Last message from staff", sinceText(bot.lastUpdateAt)],
            ["Waiting at Telegram", data.webhook ? String(data.webhook.pending) : "—"],
            ["Buttons open", data.appUrl ?? "Not set"]
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-gray-50 px-3.5 py-3 dark:bg-slate-800/60">
              <dt className="text-[12px] text-gray-500">{label}</dt>
              <dd className="m-0 mt-0.5 truncate text-[14px] font-semibold text-gray-900 dark:text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
        {bot.lastError && <p className="m-0 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900">{bot.lastError}</p>}
        {data.webhook?.lastErrorMessage && <p className="m-0 mt-2 text-[12.5px] text-gray-500">Telegram's last delivery problem ({data.webhook.lastErrorAt ? dateTime(data.webhook.lastErrorAt) : "—"}): {data.webhook.lastErrorMessage}</p>}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className={btn.ghost} disabled={busy === "check"} onClick={() => run("check", () => telegramApi.check(), "Checked with Telegram.")}>
            {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Check now
          </button>
          <button type="button" className={btn.ghost} disabled={busy === "test"} onClick={() => run("test", () => telegramApi.test(), "Test message sent to your Telegram.")}>
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Send me a test
          </button>
          <button type="button" className={btn.ghost} onClick={() => setReplacing(!replacing)}><KeyRound className="h-4 w-4" />Replace token</button>
          <button type="button" className={btn.danger} disabled={busy === "disconnect"} onClick={() => {
            if (window.confirm("Disconnect the bot? Staff stop getting Telegram messages until a bot is connected again.")) void run("disconnect", () => telegramApi.disconnect(), "Bot disconnected.");
          }}><Unplug className="h-4 w-4" />Disconnect bot</button>
        </div>
        {replacing && <div className="mt-4 border-t border-gray-100 pt-4 dark:border-slate-800">{tokenForm}<p className="m-0 mt-2 text-[12.5px] text-gray-500">Same bot, new token: staff stay connected. A different bot: everyone connects again.</p></div>}
      </Card>
      <Card className="p-5">
        <b className="text-[16px] text-gray-900 dark:text-slate-50">How it works</b>
        <ul className="m-0 mt-3 list-disc space-y-2 pl-5 text-[13.5px] text-gray-700 dark:text-slate-300">
          <li>Protohub sends every message straight to Telegram; nothing is kept on a phone, so app updates never log the bot out.</li>
          <li>When staff type a command or tap a button, Telegram passes it to Protohub's webhook. It is checked every 15 minutes; that is the "Uptime".</li>
          <li>Inventory and logistics staff never see customer names, phone numbers or amounts in Telegram, same as in the app.</li>
          <li>"Call Customer" sends the number only to the order's own rep and leadership.</li>
        </ul>
        <p className="m-0 mt-4 break-all rounded-xl bg-gray-50 px-3.5 py-3 text-[12px] text-gray-500 dark:bg-slate-800/60">Webhook address: {data.webhookUrl ?? "not available"}</p>
      </Card>
    </div>
  );
}
