import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, KeyRound, Link2, Loader2, MessageCircleReply, Plug, RefreshCw, Save, ShieldCheck, Trash2, Zap } from "lucide-react";
import { socialLeadsApi, type SlCommentReply, type SlMetaDirect } from "../../lib/api";
import { FacebookIcon, InstagramIcon } from "../../components/SocialIcons";
import { Pill, Switch, btn, field, timeAgo } from "./sl-ui";
import { Box, ToggleRow, copyText } from "./SettingsTab";
import type { Shared } from "./SocialLeadsPage";

/**
 * Direct Meta (free): Protohub is the Meta app, no ManyChat (Bright, 13 Nov 2026).
 * One switch decides who sends: Direct Meta or ManyChat, never both.
 */

const RESULT: Record<string, string> = {
  denied: "Facebook login was cancelled.", expired: "The Facebook login took too long. Try again.", invalid: "That Facebook login could not be read. Try again.",
  forbidden: "Only the Owner or an Admin can connect Pages.", failed: "Meta refused the login. Check the App ID, App Secret and the redirect address in the app.",
  "no-pages": "This Facebook login manages no Page that can send messages."
};

function CopyLine({ label, value, shared }: { label: string; value: string; shared: Shared }) {
  return (
    <div>
      <span className="text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-800">{value}</code>
        <button type="button" aria-label={`Copy ${label}`} onClick={() => copyText(shared, value)} className={`${btn.icon} !h-9 !w-9`}><Copy className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
      <div className="mb-2 flex items-center gap-2">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${done ? "bg-emerald-600 text-white" : "bg-[#EEEBFC] text-[#5B3FD9]"}`}>{done ? <CheckCircle2 className="h-4 w-4" /> : n}</span>
        <b className="text-[14px] text-gray-900 dark:text-slate-100">{title}</b>
      </div>
      <div className="space-y-2 pl-8">{children}</div>
    </div>
  );
}

export default function DirectMetaPanel({ shared }: { shared: Shared }) {
  const [m, setM] = useState<SlMetaDirect | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [appId, setAppId] = useState(""), [appSecret, setAppSecret] = useState(""), [token, setToken] = useState("");
  const [reply, setReply] = useState<SlCommentReply | null>(null);
  const [keywords, setKeywords] = useState(""), [publics, setPublics] = useState("");

  const take = (next: SlMetaDirect) => {
    setM(next); setAppId(next.appId ?? ""); setReply(next.commentReply);
    setKeywords(next.commentReply.keywords.join(", ")); setPublics(next.commentReply.publicMessages.join("\n"));
  };
  useEffect(() => {
    socialLeadsApi.metaDirect().then(take, (e) => setError((e as Error).message));
    // Back from "Connect with Facebook": say how it went, then clean the address.
    const [path, q = ""] = window.location.hash.split("?");
    const params = new URLSearchParams(q);
    const result = params.get("meta");
    if (result) {
      shared.onToast(result.startsWith("connected-") ? `Connected ${result.slice(10)} Page(s). Comments and messages now come in.` : RESULT[result] ?? "Facebook login finished.");
      params.delete("meta");
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${path}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, fn: () => Promise<SlMetaDirect | void>, ok?: string) => {
    setBusy(key);
    try { const next = await fn(); if (next) take(next); if (ok) shared.onToast(ok); }
    catch (e) { shared.onToast((e as Error).message || "Something went wrong."); }
    finally { setBusy(""); }
  };

  if (error) return <Box icon={Plug} title="Direct Meta (free)"><p className="m-0 text-[13px] text-rose-700">{error}</p></Box>;
  if (!m || !reply) return <Box icon={Plug} title="Direct Meta (free)"><p className="m-0 flex items-center gap-2 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p></Box>;

  const appDone = Boolean(m.appId && m.hasSecret);
  const pagesDone = m.pages.length > 0;
  const receiving = Boolean(m.lastEventAt) && !m.lastError;
  const replyDirty = JSON.stringify({ ...reply, keywords: keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean), publicMessages: publics.split("\n").map((p) => p.trim()).filter(Boolean) })
    !== JSON.stringify(m.commentReply);

  return (
    <Box icon={Zap} title={<span className="flex flex-wrap items-center gap-2">Direct Meta <Pill tone="green">Free</Pill>{m.active ? <Pill tone="purple">Sending replies</Pill> : <Pill tone="slate">Off</Pill>}</span>}
      sub="Facebook Page and Instagram comments and messages straight into Protohub, with no ManyChat. Replies go out through Meta.">
      {/* The one switch: who sends. */}
      <div className="mb-3 rounded-xl border border-[#D9D2FA] bg-[#F7F5FF] p-3 dark:border-violet-500/30 dark:bg-violet-500/10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-[220px] flex-1">
            <b className="block text-[14px] text-gray-900 dark:text-slate-100">Send messages through</b>
            <span className="block text-[12.5px] text-gray-600 dark:text-slate-400">Only one sends at a time, so a customer never gets two replies. Leads, chats and reps stay the same when you switch.</span>
          </span>
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="radiogroup" aria-label="Send messages through">
            {[{ v: true, l: "Direct Meta" }, { v: false, l: "ManyChat" }].map((o) => (
              <button key={o.l} type="button" role="radio" aria-checked={m.active === o.v} disabled={busy === "switch"}
                onClick={() => { if (m.active === o.v) return; if (!o.v && !window.confirm("Switch to ManyChat? Protohub stops answering on Facebook and Instagram. In Meta Business Suite › Inbox settings, make ManyChat the app that controls conversations.")) return; void run("switch", () => socialLeadsApi.saveMetaDirect({ active: o.v }), o.v ? "Direct Meta is on." : "ManyChat sends from now on."); }}
                className={`!min-h-0 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold ${m.active === o.v ? "bg-[#5B3FD9] text-white" : "text-gray-700 hover:bg-gray-50 dark:text-slate-300 dark:hover:bg-slate-800"}`}>{o.l}</button>
            ))}
          </div>
        </div>
        {!m.active && m.manychatConnected && <p className="m-0 mt-2 text-[12px] text-gray-600 dark:text-slate-400">ManyChat is sending now. Direct Meta's comments and messages are ignored until you switch.</p>}
        {!m.active && !m.manychatConnected && <p className="m-0 mt-2 text-[12px] text-amber-700 dark:text-amber-300">Nothing is sending yet. Finish the steps below, then pick Direct Meta.</p>}
      </div>

      {m.lastError && <p className="m-0 mb-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{m.lastError}</p>}

      <div className="space-y-3">
        <Step n={1} title="Your Meta app" done={appDone}>
          <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">At developers.facebook.com, create a Business app (or use the one you have). Copy the App ID and App Secret from App settings › Basic.</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
            <input className={field} inputMode="numeric" placeholder="App ID" value={appId} onChange={(e) => setAppId(e.target.value.replace(/\D/g, ""))} aria-label="App ID" />
            <input className={field} type="password" autoComplete="off" placeholder={m.hasSecret ? "App Secret saved: paste to replace" : "App Secret"} value={appSecret} onChange={(e) => setAppSecret(e.target.value)} aria-label="App Secret" />
            <button type="button" className={btn.primary} disabled={busy === "app" || !appId || (!appSecret && !m.hasSecret)}
              onClick={() => void run("app", async () => { const next = await socialLeadsApi.saveMetaDirect({ appId, ...(appSecret ? { appSecret } : {}) }); setAppSecret(""); return next; }, "Meta accepted the app.")}>
              {busy === "app" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Save & check
            </button>
          </div>
          <p className="m-0 text-[11.5px] text-gray-500">The secret is stored encrypted and never shown again.</p>
        </Step>

        <Step n={2} title="Point the app at Protohub" done={receiving}>
          <p className="m-0 text-[12.5px] text-gray-600 dark:text-slate-400">In the app, add the products <b>Messenger</b> and <b>Instagram</b>. Under Webhooks, use this address and verify token for both <b>Page</b> (fields: feed, messages, messaging_postbacks) and <b>Instagram</b> (fields: comments, messages). Under Facebook Login › Settings, add the redirect address.</p>
          <CopyLine label="Webhook address" value={m.webhookUrl} shared={shared} />
          <CopyLine label="Verify token" value={m.verifyToken} shared={shared} />
          <CopyLine label="Valid OAuth redirect address" value={m.redirectUri} shared={shared} />
          <p className="m-0 text-[12px] text-gray-600 dark:text-slate-400">{m.lastEventAt ? `Last event from Meta: ${timeAgo(m.lastEventAt)}.` : "No event from Meta yet."}</p>
        </Step>

        <Step n={3} title="Connect your Page(s)" done={pagesDone}>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={!appDone || busy === "login"}
              onClick={() => void run("login", async () => { const r = await socialLeadsApi.metaConnectUrl(); window.location.href = r.url; })}>
              {busy === "login" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FacebookIcon className="h-4 w-4" />}Connect with Facebook
            </button>
          </div>
          <details className="text-[12.5px] text-gray-600 dark:text-slate-400">
            <summary className="cursor-pointer font-semibold">Or paste an access token (system user)</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <input className={`${field} !w-auto min-w-[260px] flex-1`} type="password" autoComplete="off" placeholder="Access token with the Page permissions" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Access token" />
              <button type="button" className={btn.ghost} disabled={!appDone || token.trim().length < 20 || busy === "token"}
                onClick={() => void run("token", async () => { const next = await socialLeadsApi.metaToken(token); setToken(""); return next; }, "Pages connected.")}>
                {busy === "token" && <Loader2 className="h-4 w-4 animate-spin" />}Connect
              </button>
            </div>
          </details>
          {m.pages.length > 0 && (
            <ul className="m-0 list-none space-y-2 p-0">
              {m.pages.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 dark:border-slate-700">
                  <FacebookIcon className="h-5 w-5" /><b className="text-[13.5px]">{p.name || p.pageId}</b>
                  {p.igUsername ? <span className="flex items-center gap-1 text-[13px] text-gray-700 dark:text-slate-300"><InstagramIcon className="h-4 w-4" />@{p.igUsername}</span> : <span className="text-[12px] text-gray-500">No Instagram linked</span>}
                  {p.subscribed ? <Pill tone="green">Receiving</Pill> : <Pill tone="red">Not receiving</Pill>}
                  <span className="ml-auto flex gap-1">
                    <button type="button" className={`${btn.ghost} !px-2.5 !py-1.5 !text-[12.5px]`} disabled={busy === `re-${p.id}`} onClick={() => void run(`re-${p.id}`, () => socialLeadsApi.metaResubscribe(p.id), "Meta will send this Page's events.")}><RefreshCw className="h-3.5 w-3.5" />Reconnect</button>
                    <button type="button" className={`${btn.ghost} !px-2.5 !py-1.5 !text-[12.5px] !text-rose-600`} disabled={busy === `rm-${p.id}`} onClick={() => { if (window.confirm(`Remove ${p.name}? Its comments and messages stop coming in.`)) void run(`rm-${p.id}`, () => socialLeadsApi.metaRemovePage(p.id), "Page removed."); }}><Trash2 className="h-3.5 w-3.5" />Remove</button>
                  </span>
                  {p.error && <span className="w-full text-[12px] text-rose-700">{p.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </Step>

        <Step n={4} title="Comment auto-reply" done={reply.enabled}>
          <ToggleRow label="Send a private message when someone comments" sub="Meta allows one private message per comment, within 7 days. If they answer, the chat opens and goes to a rep." on={reply.enabled} onChange={(v) => setReply({ ...reply, enabled: v })} />
          <label className="block">
            <span className="text-[12.5px] font-semibold">Only for comments with these words (empty = every comment)</span>
            <input className={`${field} mt-1`} placeholder="price, how much, link, interested" value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[12.5px] font-semibold">Private message</span>
            <textarea className={`${field} mt-1 min-h-[80px]`} maxLength={1000} value={reply.message} onChange={(e) => setReply({ ...reply, message: e.target.value })} />
            <span className="text-[11.5px] text-gray-500">{"{{first_name}}"} becomes the customer's first name.</span>
          </label>
          <ToggleRow label="Also reply under the comment" sub="So other people see you answered. One of these lines is picked each time." on={reply.publicReply} onChange={(v) => setReply({ ...reply, publicReply: v })} />
          {reply.publicReply && <textarea className={`${field} min-h-[70px]`} placeholder="One reply per line" value={publics} onChange={(e) => setPublics(e.target.value)} aria-label="Public replies" />}
          <ToggleRow label="Skip replies inside comment threads" sub="People answering each other under a comment are left alone." on={reply.skipThreadReplies} onChange={(v) => setReply({ ...reply, skipThreadReplies: v })} />
          <button type="button" className={btn.primary} disabled={!replyDirty || busy === "reply"}
            onClick={() => void run("reply", () => socialLeadsApi.saveMetaDirect({ commentReply: { ...reply, keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean), publicMessages: publics.split("\n").map((p) => p.trim()).filter(Boolean) } }), "Comment auto-reply saved.")}>
            {busy === "reply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save auto-reply
          </button>
        </Step>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
        <p className="m-0 flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700 dark:bg-slate-800 dark:text-slate-300"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" /><span>Until Meta approves the app (App Review: pages_messaging, instagram_manage_messages, instagram_manage_comments, pages_manage_engagement), it only works with people who have a role on the app.</span></p>
        <p className="m-0 flex items-start gap-2 rounded-xl bg-gray-50 px-3 py-2 text-[12.5px] text-gray-700 dark:bg-slate-800 dark:text-slate-300"><MessageCircleReply className="mt-0.5 h-4 w-4 shrink-0 text-[#5B3FD9]" /><span>Moving to ManyChat later: switch above to ManyChat, then in Meta Business Suite › Inbox settings › Automated responses / Conversation routing, give ManyChat control. Leads and chats stay.</span></p>
      </div>
      <p className="m-0 mt-2 flex items-center gap-1 text-[11.5px] text-gray-500"><Link2 className="h-3 w-3" />Permissions asked: {m.scopes.join(", ")}</p>
    </Box>
  );
}
