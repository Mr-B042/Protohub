import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { telegramApi } from "../lib/api";
import { TgLogo } from "../pages/telegram/tg-ui";

type Me = Awaited<ReturnType<typeof telegramApi.me>>;

/**
 * "Get your alerts on Telegram" on the Notifications page (Bright, 6 Nov 2026:
 * all staff can link). Shows only once the Owner has connected a bot.
 */
export default function TelegramConnectCard({ onToast }: { onToast: (message: string) => void }) {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const timer = useRef<number | null>(null);

  const load = () => telegramApi.me().then(setMe).catch(() => setMe(null));
  useEffect(() => { void load(); return () => { if (timer.current) window.clearInterval(timer.current); }; }, []);

  // After "Connect", look for the link every 4 seconds for up to 3 minutes.
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    timer.current = window.setInterval(async () => {
      tries += 1;
      const next = await telegramApi.me().catch(() => null);
      if (next) setMe(next);
      if (next?.link.linked || tries > 45) {
        setWaiting(false);
        if (next?.link.linked) onToast("Telegram connected. Your alerts will come there.");
        if (timer.current) window.clearInterval(timer.current);
      }
    }, 4000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!me?.bot?.connected) return null;
  const linked = me.link.linked;

  const connect = async () => {
    setBusy(true);
    try {
      const { url } = await telegramApi.linkMe();
      window.open(url, "_blank", "noopener");
      setWaiting(true);
    } catch (err) { onToast((err as Error).message || "Could not make your link."); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm("Stop getting Protohub alerts on Telegram?")) return;
    setBusy(true);
    try { await telegramApi.unlinkMe(); await load(); onToast("Telegram disconnected."); } catch (err) { onToast((err as Error).message || "Could not disconnect."); } finally { setBusy(false); }
  };

  return (
    <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 to-white p-4 dark:border-sky-500/30 dark:from-sky-500/10 dark:to-slate-900">
      <TgLogo size={44} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <b className="block text-[15px] text-gray-900 dark:text-slate-50">{linked ? "Your alerts also come to Telegram" : "Get your alerts on Telegram"}</b>
        <span className="text-[13px] text-gray-600 dark:text-slate-400">
          {linked
            ? <><CheckCircle2 className="mr-1 inline h-4 w-4 text-emerald-600" />Connected{me.link.telegramUsername ? ` as @${me.link.telegramUsername}` : ""} to {me.bot.username ? `@${me.bot.username}` : "the Protohub bot"}.</>
            : waiting ? "Telegram opened: tap Start there. This updates by itself." : "New orders, reminders and updates arrive instantly in Telegram. Tap Connect, then Start."}
        </span>
      </div>
      {linked
        ? <button type="button" disabled={busy} onClick={disconnect} className="!min-h-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">Disconnect</button>
        : <button type="button" disabled={busy} onClick={connect} className="!min-h-0 inline-flex items-center gap-2 rounded-xl bg-[#1F8FE0] px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-[#1A7FCB]">
            {busy || waiting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}{waiting ? "Waiting…" : "Connect Telegram"}
          </button>}
    </section>
  );
}
