import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Link2Off, Loader2, Search, UserCheck } from "lucide-react";
import { telegramApi, type TelegramStaff } from "../../lib/api";
import { Card, StatusDot, TgLogo, avatarTone, btn, initials, roleShort, sinceText } from "./tg-ui";

type Row = TelegramStaff & { week: { sent: number; failed: number; last: string | null } };

export async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const el = document.createElement("textarea");
    el.value = text; document.body.appendChild(el); el.select();
    const ok = document.execCommand("copy"); document.body.removeChild(el); return ok;
  }
}

/** Staff & Recipients: who is connected, and links that connect them. */
export default function TabStaff({ onToast, meId, onChanged, botConnected }: { onToast: (message: string) => void; meId: string | null; onChanged: () => void; botConnected: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");

  const load = () => telegramApi.staff().then((result) => { setRows(result.staff); setError(""); }).catch((err: Error) => setError(err.message));
  useEffect(() => { void load(); }, []);
  // Someone may be tapping Start in Telegram right now: look again every 10 seconds.
  useEffect(() => { const timer = window.setInterval(() => { void load(); }, 10_000); return () => window.clearInterval(timer); }, []);

  const roles = useMemo(() => [...new Set((rows ?? []).map((row) => row.role))].sort(), [rows]);
  const shown = (rows ?? []).filter((row) => (role === "all" || row.role === role) && (status === "all" || (status === "on") === row.linked) && row.name.toLowerCase().includes(search.trim().toLowerCase()));
  const me = rows?.find((row) => row.id === meId) ?? null;
  const linked = (rows ?? []).filter((row) => row.linked).length;

  const linkFor = async (row: Row) => {
    setBusy(row.id);
    try {
      const { url } = row.id === meId ? await telegramApi.linkMe() : await telegramApi.linkStaff(row.id);
      if (row.id === meId) { window.open(url, "_blank", "noopener"); onToast("Telegram opened: tap Start there to finish."); }
      else { await copyToClipboard(url); onToast(`Link copied. Send it to ${row.name} (e.g. on WhatsApp): it works once, for 30 minutes.`); }
    } catch (err) { onToast((err as Error).message || "Could not make the link."); } finally { setBusy(null); }
  };
  const unlink = async (row: Row) => {
    if (!window.confirm(`Disconnect ${row.name}'s Telegram? They stop getting messages until they connect again.`)) return;
    setBusy(row.id);
    try { await (row.id === meId ? telegramApi.unlinkMe() : telegramApi.unlinkStaff(row.id)); onToast("Disconnected."); await load(); onChanged(); } catch (err) { onToast((err as Error).message || "Could not disconnect."); } finally { setBusy(null); }
  };

  if (!botConnected) return <Card className="p-8 text-center text-[14px] text-gray-600">Connect the bot first (Bot Configuration). Then staff can link their Telegram here or from Notifications.</Card>;
  if (error) return <p className="m-0 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">Could not load staff: {error}</p>;
  if (!rows) return <p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="flex flex-wrap items-center gap-4 p-5">
          <TgLogo size={48} />
          <div className="min-w-0 flex-1">
            <b className="block text-[16px] text-gray-900 dark:text-slate-50">Your Telegram</b>
            <span className="text-[13.5px] text-gray-600 dark:text-slate-400">{me?.linked ? `Connected${me.telegramUsername ? ` as @${me.telegramUsername}` : ""}. Test messages and samples come here.` : "Connect it to get your alerts, samples and the daily report."}</span>
          </div>
          {me && (me.linked
            ? <button type="button" className={btn.ghost} disabled={busy === me.id} onClick={() => unlink(me)}><Link2Off className="h-4 w-4" />Disconnect</button>
            : <button type="button" className={btn.primary} disabled={busy === me.id} onClick={() => linkFor(me)}>{busy === me.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}Connect my Telegram</button>)}
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-emerald-600" /><b className="text-[16px] text-gray-900 dark:text-slate-50">{linked} of {rows.length} staff connected</b></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${rows.length ? (linked / rows.length) * 100 : 0}%` }} /></div>
          <p className="m-0 mt-3 text-[13px] text-gray-600 dark:text-slate-400">Staff connect themselves from <b>Notifications → Connect Telegram</b>, or send them their own link below.</p>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3 dark:border-slate-800">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff" className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" />
          </div>
          <select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900">
            <option value="all">All roles</option>{roles.map((name) => <option key={name} value={name}>{roleShort(name)}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900">
            <option value="all">Everyone</option><option value="on">Connected</option><option value="off">Not connected</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="!min-w-0 w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="bg-gray-50 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:bg-slate-800/60">
                <th className="px-5 py-2">Staff</th><th className="px-3 py-2">Telegram</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Last 7 days</th><th className="px-3 py-2">Last message</th><th className="px-5 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.id} className="border-b border-gray-100 last:border-0 dark:border-slate-800">
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-3">
                      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold ${avatarTone(row.name)}`}>{initials(row.name)}</span>
                      <span className="min-w-0"><b className="block truncate text-gray-900 dark:text-slate-100">{row.name}{row.id === meId ? " (you)" : ""}</b><span className="block text-[12.5px] text-gray-500">{roleShort(row.role)}</span></span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-gray-700 dark:text-slate-300">{row.linked ? (row.telegramUsername ? `@${row.telegramUsername}` : row.telegramName ?? "Connected") : "—"}</td>
                  <td className="px-3 py-3"><StatusDot on={row.linked} /></td>
                  <td className="px-3 py-3 text-gray-700 dark:text-slate-300">{row.week.sent} sent{row.week.failed ? <span className="text-rose-600"> · {row.week.failed} failed</span> : ""}</td>
                  <td className="px-3 py-3 text-gray-500">{sinceText(row.week.last)}</td>
                  <td className="px-5 py-3 text-right">
                    {row.linked
                      ? <button type="button" className={btn.ghost} disabled={busy === row.id} onClick={() => unlink(row)}><Link2Off className="h-4 w-4" />Disconnect</button>
                      : <button type="button" className={btn.ghost} disabled={busy === row.id} onClick={() => linkFor(row)}>{busy === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : row.id === meId ? <ExternalLink className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{row.id === meId ? "Connect" : "Copy connect link"}</button>}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500">No staff match.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
