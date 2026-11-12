import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight, Bot, CalendarClock, CalendarDays, CheckCheck, ChevronDown, ChevronRight, Copy, ExternalLink, FileText, Filter, Flame, ImageIcon, Loader2, MapPin,
  MessageSquareText, MoreHorizontal, Package, PencilLine, Phone, Plus, Search, Send, ShoppingCart, Smile, Sparkles, Tag, Timer, User, Video, XCircle, Zap, Box, Megaphone, Gauge, AlertTriangle
} from "lucide-react";
import { socialLeadsApi, type SlLeadDetail, type SlLeadRow, type SlMessage } from "../../lib/api";
import { PlatformIcon } from "../../components/SocialIcons";
import { Avatar, Card, Pill, ProductThumb, STATUS, StatusChip, btn, duration, lagosDateTime, lagosTime, money, shortAgo, toMs, whenLabel } from "./sl-ui";
import { KpiRow, useLoad, useStats } from "./sl-data";
import { AddLeadModal, CloseLeadModal, CreateOrderModal, EditContactModal, ScheduleModal, TransferModal } from "./LeadModals";
import type { Shared } from "./SocialLeadsPage";

/** The Lagos day of a server time; "" when it cannot be read (never throws). */
const lagosDayOf = (iso: string | null | undefined) => { const ms = toMs(iso);  return Number.isFinite(ms) ? new Date(ms + 3_600_000).toISOString().slice(0, 10) : ""; };
const PLATFORM_NAME: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger" };
const MORE_FILTERS = [
  { key: "unassigned", label: "Unassigned" }, { key: "new", label: "New leads" }, { key: "awaiting_reply", label: "Waiting for our reply" },
  { key: "awaiting", label: "Awaiting customer" }, { key: "follow_up", label: "Follow-up due" }, { key: "overdue", label: "Overdue reply" },
  { key: "converted", label: "Converted" }, { key: "closed", label: "Closed" }
];
const EMOJI = ["😊", "🙏", "👍", "🙌", "🎉", "✅", "📦", "🚚", "💯", "❤️", "😀", "👋"];

/** {customer_name} {product_name} {price} {delivery_time} {order_id} (and the older {name} {product}). */
export const fillTemplate = (body: string, lead: SlLeadDetail["lead"], price?: string | null) => {
  const first = (lead.name || "").replace(/^@/, "").split(" ")[0] || "there";
  return body.replace(/\{(customer_name|name)\}/g, first).replace(/\{(product_name|product)\}/g, lead.product || "product")
    .replace(/\{price\}/g, price || "the price").replace(/\{delivery_time\}/g, "1–3 working days").replace(/\{order_id\}/g, lead.orderId ? `#${lead.orderId}` : "");
};

export default function InboxTab({ shared, leadId, onLead }: { shared: Shared; leadId: string | null; onLead: (id: string | null) => void }) {
  const stats = useStats({ range: "7d" });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  const list = useLoad(() => socialLeadsApi.conversations(filter, q), `${filter}|${q}`, 15_000);
  const rows = list.data?.conversations ?? [];
  const counts = list.data?.counts ?? {};
  // Open the first conversation when none is picked (desktop).
  useEffect(() => { if (!leadId && rows.length && window.innerWidth >= 1280) onLead(rows[0].id); }, [leadId, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const chip = (key: string, label: string, count?: number, tone = "bg-[#EEEBFC] text-[#5B3FD9]") => (
    <button key={key} type="button" onClick={() => setFilter(key)}
      className={`!min-h-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-semibold ${filter === key ? "bg-[#5B3FD9] text-white" : "bg-gray-50 text-gray-700 hover:bg-gray-100 dark:bg-slate-800 dark:text-slate-200"}`}>
      {label}{count !== undefined && <span className={`rounded-full px-1.5 text-[11px] font-bold ${filter === key ? "bg-white/25 text-white" : tone}`}>{count}</span>}
    </button>
  );

  return (
    <div className="space-y-4">
      <KpiRow stats={stats.data} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(300px,0.95fr)_minmax(0,1.75fr)_minmax(320px,1.05fr)]">
        {/* Left: conversations */}
        <Card className={`flex min-h-[640px] flex-col ${leadId ? "hidden xl:flex" : ""}`}>
          <div className="flex items-center gap-2 px-4 pt-4">
            <h3 className="m-0 mr-auto text-[17px] font-bold text-gray-900 dark:text-slate-50">Conversations ({rows.length})</h3>
            <span className="relative">
              <button type="button" aria-label="More filters" onClick={() => setMoreOpen((v) => !v)} className={`${btn.icon} !h-9 !w-9 !border-0 ${MORE_FILTERS.some((f) => f.key === filter) ? "!text-[#5B3FD9]" : ""}`}><Filter className="h-[18px] w-[18px]" /></button>
              {moreOpen && (
                <div className="absolute right-0 top-10 z-20 w-56 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900" onMouseLeave={() => setMoreOpen(false)}>
                  {MORE_FILTERS.map((f) => (
                    <button key={f.key} type="button" onClick={() => { setFilter(f.key); setMoreOpen(false); }}
                      className={`!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-[13px] ${filter === f.key ? "bg-[#EEEBFC] font-semibold text-[#5B3FD9]" : "text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>{f.label}</button>
                  ))}
                </div>
              )}
            </span>
            <button type="button" aria-label="Add a lead" onClick={() => setAdding(true)} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#5B3FD9] text-white hover:bg-[#4C32C4]"><Plus className="h-5 w-5" /></button>
          </div>
          <div className="px-4 pt-3">
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, message, product..." className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" />
            </span>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {chip("all", "All", counts.all)}
              {chip("mine", "Mine", counts.mine, "bg-gray-200 text-gray-700")}
              {chip("unread", "Unread", counts.unread, "bg-amber-400 text-white")}
              {chip("hot", "Hot", counts.hot, "bg-rose-50 text-rose-600")}
              {MORE_FILTERS.some((f) => f.key === filter) && chip(filter, MORE_FILTERS.find((f) => f.key === filter)!.label)}
            </div>
          </div>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
            {list.error && <p className="m-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{list.error}</p>}
            {!list.data && !list.error && <p className="flex items-center gap-2 px-4 py-6 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Loading…</p>}
            {list.data && rows.length === 0 && (
              <p className="px-5 py-10 text-center text-[13px] text-gray-500">
                {filter === "all" && !q ? (shared.leadership ? "No conversation yet. Comments and messages appear here as soon as ManyChat sends them." : "No conversation has been given to you yet.") : "No conversation matches."}
              </p>
            )}
            {rows.map((row) => <ConversationCard key={row.id} row={row} active={row.id === leadId} onClick={() => onLead(row.id)} />)}
          </div>
        </Card>

        {leadId
          ? <Conversation key={leadId} leadId={leadId} shared={shared} onBack={() => onLead(null)} onChanged={() => { list.reload(); stats.reload(); shared.refreshHeader(); }} />
          : <Card className="hidden min-h-[640px] items-center justify-center text-[14px] text-gray-500 xl:col-span-2 xl:flex"><span className="flex items-center gap-2"><MessageSquareText className="h-5 w-5" />Pick a conversation.</span></Card>}
      </div>
      {adding && <AddLeadModal shared={shared} onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); list.reload(); onLead(id); }} />}
    </div>
  );
}

function ConversationCard({ row, active, onClick }: { row: SlLeadRow; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`!min-h-0 relative flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left dark:border-slate-800 ${active ? "bg-[#F3F0FE] dark:bg-violet-500/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/60"}`}>
      {active && <span className="absolute inset-y-0 left-0 w-1 rounded-r bg-[#5B3FD9]" />}
      <Avatar name={row.name} src={row.profilePic} size={46} platform={<PlatformIcon platform={row.platform} className="h-4 w-4" />} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <b className="min-w-0 flex-1 truncate text-[14.5px] text-gray-900 dark:text-slate-50">{row.name}</b>
          <span className="shrink-0 text-[12px] text-gray-500">{shortAgo(row.lastMessageAt ?? row.createdAt)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] text-gray-600 dark:text-slate-400">{row.preview || "—"}</span>
          {row.unread > 0 && <span className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-[#5B3FD9] px-1.5 text-[12px] font-bold text-white">{row.unread}</span>}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip status={row.chip} size="sm" />
          {row.product && <span className="inline-flex max-w-[140px] items-center gap-1 truncate rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:border-slate-700 dark:text-slate-300"><Box className="h-3 w-3 shrink-0" />{row.product.split(" ").slice(-1)[0]}</span>}
          {row.slaStage && ["red", "renotify", "escalate", "reassign"].includes(row.slaStage) && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600"><Timer className="h-3 w-3" />late</span>}
        </span>
      </span>
    </button>
  );
}

// ── Middle + right ────────────────────────────────────────────────────────

type Modal = null | "order" | "schedule" | "transfer" | "close" | "contact";

function Conversation({ leadId, shared, onBack, onChanged }: { leadId: string; shared: Shared; onBack: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<SlLeadDetail | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<"" | "more" | "templates" | "emoji" | "product">("");
  const [side, setSide] = useState<"details" | "history" | "notes">("details");
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement | null>(null);
  const lastAt = useRef<string | null>(null);

  const load = async () => {
    try {
      const d = await socialLeadsApi.lead(leadId);
      setDetail(d); setError("");
      lastAt.current = d.messages[d.messages.length - 1]?.createdAt ?? null;
      if (d.lead.unread) { await socialLeadsApi.markRead(leadId).catch(() => undefined); onChanged(); }
    } catch (e) { setError((e as Error).message || "Could not open this conversation."); }
  };
  useEffect(() => { void load(); }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  // New messages every 5 seconds; the clock ticks every second.
  useEffect(() => {
    const poll = window.setInterval(async () => {
      try {
        const r = await socialLeadsApi.messagesSince(leadId, lastAt.current);
        if (r.messages.length) {
          setDetail((d) => d ? { ...d, messages: [...d.messages, ...r.messages.filter((m) => !d.messages.some((x) => x.id === m.id))], lead: { ...d.lead, awaitingSince: r.awaitingSince, status: r.status } } : d);
          lastAt.current = r.messages[r.messages.length - 1].createdAt;
          if (r.unread) { await socialLeadsApi.markRead(leadId).catch(() => undefined); onChanged(); }
        }
      } catch { /* next tick */ }
    }, 5000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [detail?.messages.length]);

  const send = async (body: { kind: "text" | "note" | "product" | "image"; body?: string; productId?: string; packageId?: string; imageUrl?: string }) => {
    setSending(true);
    try {
      const r = await socialLeadsApi.send(leadId, body);
      setDetail((d) => d ? { ...d, messages: [...d.messages, r.message], lead: body.kind === "note" ? d.lead : { ...d.lead, awaitingSince: null } } : d);
      lastAt.current = r.message.createdAt;
      setText(""); setMenu("");
      if (body.kind !== "note") onChanged();
    } catch (e) { shared.onToast((e as Error).message || "Could not send."); void load(); }
    finally { setSending(false); }
  };
  const update = async (patch: Record<string, unknown>, message?: string) => {
    try { await socialLeadsApi.update(leadId, patch); if (message) shared.onToast(message); await load(); onChanged(); }
    catch (e) { shared.onToast((e as Error).message || "Could not save."); }
  };

  if (error) return <Card className="flex min-h-[640px] items-center justify-center p-6 text-[14px] text-rose-700 xl:col-span-2">{error}</Card>;
  if (!detail) return <Card className="flex min-h-[640px] items-center justify-center text-[14px] text-gray-500 xl:col-span-2"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Opening…</Card>;
  const lead = detail.lead;
  const waitedLive = lead.awaitingSince ? Math.max(detail.clock.waitingSeconds ?? 0, 0) : null;
  const clockTone = waitedLive === null ? "green" : waitedLive >= detail.clock.sla.red * 60 ? "red" : waitedLive >= detail.clock.sla.yellow * 60 ? "amber" : "green";
  const canChat = detail.connected && !lead.manual && detail.window.state !== "none" && detail.window.state !== "closed";
  const notes = detail.messages.filter((m) => m.direction === "note");
  const templates = shared.header?.prefs.templates ?? [];
  const pricePkg = detail.packages.find((p) => p.id === lead.packageId) ?? detail.packages[0];
  const priceText = pricePkg ? money(pricePkg.price, pricePkg.currency) : null;

  return (
    <>
      <Card className="flex min-h-[640px] min-w-0 flex-col">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
          <button type="button" onClick={onBack} className={`${btn.icon} !h-9 !w-9 xl:hidden`} aria-label="Back to conversations">‹</button>
          <Avatar name={lead.name} src={lead.profilePic} size={46} />
          <div className="min-w-0">
            <b className="block truncate text-[17px] text-gray-900 dark:text-slate-50">{lead.name}</b>
            <span className="flex items-center gap-1.5 text-[12.5px] text-gray-600 dark:text-slate-400">
              <PlatformIcon platform={lead.platform} className="h-3.5 w-3.5" />{PLATFORM_NAME[lead.platform]} •
              {detail.window.state === "open" && lead.lastCustomerMessageAt && Date.now() - toMs(lead.lastCustomerMessageAt) < 10 * 60_000
                ? <span className="inline-flex items-center gap-1 text-emerald-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Active now</span>
                : <span>Last message {shortAgo(lead.lastCustomerMessageAt)}</span>}
            </span>
          </div>
          <button type="button" onClick={() => setModal("transfer")} className="!min-h-0 inline-flex items-center gap-2 rounded-full bg-[#F1EEFD] px-3 py-1.5 text-[13px] font-semibold text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-200">
            {lead.assignedName ? <><Avatar name={lead.assignedName} src={lead.assignedAvatar} size={22} />Assigned to: {lead.assignedName}</> : <>Not assigned yet</>}<ChevronRight className="h-4 w-4" />
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            {lead.phone ? <a href={`tel:${lead.phone}`} aria-label="Call" title={`Call ${lead.phone}`} className={`${btn.icon} !rounded-full`}><Phone className="h-[18px] w-[18px]" /></a>
              : <button type="button" disabled className={`${btn.icon} !rounded-full`} title="No phone number yet"><Phone className="h-[18px] w-[18px]" /></button>}
            {(lead.whatsapp || lead.phone)
              ? <a href={`https://wa.me/${String(lead.whatsapp || lead.phone).replace(/\D/g, "").replace(/^0/, "234")}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp video or call" title="Open WhatsApp" className={`${btn.icon} !rounded-full`}><Video className="h-[18px] w-[18px]" /></a>
              : <button type="button" disabled className={`${btn.icon} !rounded-full`} title="No WhatsApp number yet"><Video className="h-[18px] w-[18px]" /></button>}
            <span className="relative">
              <button type="button" aria-label="More" onClick={() => setMenu(menu === "more" ? "" : "more")} className={`${btn.icon} !rounded-full`}><MoreHorizontal className="h-[18px] w-[18px]" /></button>
              {menu === "more" && (
                <div className="absolute right-0 top-11 z-20 w-60 rounded-xl border border-gray-200 bg-white p-1 text-[13px] shadow-lg dark:border-slate-700 dark:bg-slate-900" onMouseLeave={() => setMenu("")}>
                  {lead.manychatUrl && <a href={lead.manychatUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800"><ExternalLink className="h-4 w-4" />Open in ManyChat</a>}
                  <MenuItem icon={Bot} onClick={() => { setMenu(""); void update({ botPaused: !lead.botPaused }, lead.botPaused ? "Bot switched back on." : "Bot paused for this chat."); }}>{lead.botPaused ? "Switch the bot back on" : "Pause the bot (I'm handling it)"}</MenuItem>
                  <MenuItem icon={Flame} onClick={() => { setMenu(""); void update({ hot: !lead.hot }); }}>{lead.hot ? "No longer hot" : "Mark as hot lead"}</MenuItem>
                  <MenuItem icon={Copy} onClick={() => { setMenu(""); void navigator.clipboard?.writeText(lead.ref); shared.onToast(`${lead.ref} copied.`); }}>Copy lead ID ({lead.ref})</MenuItem>
                  <MenuItem icon={XCircle} onClick={() => { setMenu(""); setModal("close"); }}>Close lead</MenuItem>
                </div>
              )}
            </span>
          </div>
        </div>

        {/* Response clock */}
        <div className={`mx-4 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2 text-[13.5px] ${clockTone === "red" ? "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300" : clockTone === "amber" ? "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"}`}>
          <span className="flex items-center gap-2 font-semibold"><Timer className="h-[18px] w-[18px]" />
            {lead.awaitingSince ? <>Waiting for reply: <LiveClock base={detail.clock.waitingSeconds ?? 0} since={detail.lead.awaitingSince!} /></> : lead.firstResponseSeconds !== null ? <>Response Time: {duration(lead.firstResponseSeconds)}</> : <>No message waiting</>}
          </span>
          <span className="rounded-lg bg-white/70 px-2.5 py-1 text-[12.5px] font-medium text-gray-700 dark:bg-slate-900/60 dark:text-slate-300">SLA: Reply within {detail.clock.sla.red} minutes</span>
        </div>
        {detail.window.state === "human_only" && <Notice tone="amber">The 24-hour window has closed. You can still reply for {Math.ceil(detail.window.leftMs / 86_400_000)} more day(s) as a person; automated messages are off.</Notice>}
        {detail.window.state === "closed" && <Notice tone="red">Over 7 days since the customer last wrote: Meta does not allow a message. {lead.phone ? "Call them instead." : "Ask ManyChat to send a new comment reply."}</Notice>}
        {detail.window.state === "none" && !lead.manual && <Notice tone="amber">This customer only commented. You can message them once they reply to ManyChat's private message.</Notice>}
        {lead.manual && <Notice tone="slate">Added by hand: there is no Facebook chat for this lead. Call them on their number.</Notice>}
        {!detail.connected && !lead.manual && <Notice tone="amber">ManyChat is not connected, so replies cannot be sent yet.</Notice>}

        {/* Messages */}
        <div ref={scroller} className="min-h-[300px] flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
          {detail.messages.length === 0 && <p className="py-10 text-center text-[13px] text-gray-500">No message yet.</p>}
          {detail.messages.map((m, i) => {
            const prev = detail.messages[i - 1];
            const day = lagosDayOf(m.createdAt);
            const prevDay = prev ? lagosDayOf(prev.createdAt) : null;
            return (
              <div key={m.id}>
                {day !== prevDay && <div className="my-2 flex justify-center"><span className="rounded-lg bg-gray-100 px-3 py-1 text-[12px] font-medium text-gray-600 dark:bg-slate-800 dark:text-slate-300">{day === new Date(Date.now() + 3_600_000).toISOString().slice(0, 10) ? "Today" : new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</span></div>}
                <Bubble m={m} lead={lead} />
              </div>
            );
          })}
        </div>

        {/* Composer */}
        <div className="mx-4 mb-4 rounded-2xl border border-gray-200 dark:border-slate-700">
          <div className="flex gap-1 border-b border-gray-100 px-3 pt-2 dark:border-slate-800">
            {(["reply", "note"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setMode(k)} className={`!min-h-0 border-b-2 px-3 pb-2 text-[13.5px] font-semibold ${mode === k ? "border-[#5B3FD9] text-[#5B3FD9]" : "border-transparent text-gray-600 dark:text-slate-400"}`}>{k === "reply" ? "Reply" : "Internal Note"}</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} disabled={mode === "reply" && !canChat}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); void send({ kind: mode === "note" ? "note" : "text", body: text }); } }}
            placeholder={mode === "note" ? "A note only the team sees…" : canChat ? "Type a message..." : "Replies are not possible for this lead right now."}
            className={`block w-full resize-none border-0 bg-transparent px-4 py-3 text-[14px] focus:outline-none disabled:cursor-not-allowed dark:text-slate-100 ${mode === "note" ? "bg-amber-50/50 dark:bg-amber-500/5" : ""}`} />
          <div className="flex flex-wrap items-center gap-1 px-3 pb-3">
            <ComposerButton label="Send a product card" icon={Plus} disabled={!canChat || mode === "note"} onClick={() => setMenu(menu === "product" ? "" : "product")} />
            <ComposerButton label="Send the product picture" icon={ImageIcon} disabled={!canChat || mode === "note" || !detail.product?.image} onClick={() => void send({ kind: "image", imageUrl: detail.product!.image!, body: text || undefined })} />
            <ComposerButton label="Videos are sent from ManyChat for now" icon={Video} disabled onClick={() => undefined} />
            <ComposerButton label="Send the price list" icon={FileText} disabled={!canChat || mode === "note" || !detail.packages.length} onClick={() => setText(`${detail.product?.name ?? lead.product ?? "Prices"}:\n${detail.packages.map((p) => `• ${p.name}: ${money(p.price, p.currency)}`).join("\n")}\nPayment on delivery. Which one would you like?`)} />
            <span className="relative">
              <ComposerButton label="Emoji" icon={Smile} onClick={() => setMenu(menu === "emoji" ? "" : "emoji")} />
              {menu === "emoji" && <div className="absolute bottom-11 left-0 z-20 grid w-56 grid-cols-6 gap-1 rounded-xl border border-gray-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">{EMOJI.map((e) => <button key={e} type="button" onClick={() => { setText((t) => t + e); setMenu(""); }} className="!min-h-0 rounded-lg p-1 text-[20px] hover:bg-gray-100 dark:hover:bg-slate-800">{e}</button>)}</div>}
            </span>
            <span className="relative ml-auto">
              <button type="button" onClick={() => setMenu(menu === "templates" ? "" : "templates")} className={`${btn.ghost} !py-2 !text-[13.5px]`}><Zap className="h-4 w-4 text-[#5B3FD9]" />Templates<ChevronDown className="h-4 w-4" /></button>
              {menu === "templates" && (
                <div className="absolute bottom-12 right-0 z-20 max-h-80 w-80 overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                  {templates.length === 0 && <p className="m-0 p-3 text-[12.5px] text-gray-500">No templates yet (Settings › Templates & Quick Replies).</p>}
                  {templates.map((t) => (
                    <button key={t.id} type="button" onClick={() => { setText(fillTemplate(t.body, lead, priceText)); setMenu(""); void socialLeadsApi.templateUsed(t.id).catch(() => undefined); }} className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800">
                      <b className="block text-[13px] text-gray-900 dark:text-slate-100">{t.title} <span className="font-normal text-gray-400">· {t.kind === "quick" ? "Quick reply" : t.category}</span></b>
                      <span className="line-clamp-2 text-[12px] text-gray-500">{fillTemplate(t.body, lead, priceText)}</span>
                    </button>
                  ))}
                </div>
              )}
            </span>
            <button type="button" disabled={sending || !text.trim() || (mode === "reply" && !canChat)} onClick={() => void send({ kind: mode === "note" ? "note" : "text", body: text })} className={`${btn.primary} !py-2`}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{mode === "note" ? "Save note" : "Send"}
            </button>
          </div>
          {menu === "product" && <ProductPicker shared={shared} defaultId={lead.productId} onPick={(productId, packageId) => void send({ kind: "product", productId, packageId, body: text || undefined })} onClose={() => setMenu("")} />}
        </div>
      </Card>

      {/* Right panel */}
      <Card className="flex min-h-[640px] min-w-0 flex-col p-3">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-gray-50 p-1 dark:bg-slate-800/60">
          {([["details", "Lead Details"], ["history", "Customer History"], ["notes", "Notes"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSide(k)} className={`!min-h-0 rounded-lg px-2 py-2 text-[13px] font-semibold ${side === k ? "bg-[#5B3FD9] text-white" : "text-gray-700 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"}`}>{label}{k === "notes" && notes.length ? ` (${notes.length})` : ""}</button>
          ))}
        </div>
        {side === "details" && <LeadDetails detail={detail} shared={shared} onModal={setModal} onUpdate={update} onRequestPhone={() => { setMode("reply"); setText(`Please send your phone number so our delivery team can reach you 🙏`); }} />}
        {side === "history" && <History detail={detail} shared={shared} />}
        {side === "notes" && (
          <div className="mt-3 space-y-2 overflow-y-auto">
            {notes.length === 0 && <p className="m-0 px-2 py-6 text-center text-[13px] text-gray-500">No note yet. Use Internal Note under the chat: only the team sees it.</p>}
            {[...notes].reverse().map((n) => (
              <div key={n.id} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                <p className="m-0 whitespace-pre-wrap text-[13.5px] text-gray-900 dark:text-slate-100">{n.body}</p>
                <span className="text-[11.5px] text-gray-500">{n.senderName ?? "—"} · {lagosDateTime(n.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {modal === "order" && <CreateOrderModal detail={detail} products={shared.products} onClose={() => setModal(null)} onToast={shared.onToast} onDone={() => { setModal(null); void load(); onChanged(); }} />}
      {modal === "schedule" && <ScheduleModal leadIds={[lead.id]} names={lead.name} current={{ at: lead.followUpAt, note: lead.followUpNote }} onClose={() => setModal(null)} onToast={shared.onToast} onDone={() => { setModal(null); void load(); onChanged(); }} />}
      {modal === "transfer" && <TransferModal leadIds={[lead.id]} current={lead.assignedTo} reps={shared.reps} onClose={() => setModal(null)} onToast={shared.onToast} onDone={() => { setModal(null); void load(); onChanged(); }} />}
      {modal === "close" && <CloseLeadModal leadIds={[lead.id]} onClose={() => setModal(null)} onToast={shared.onToast} onDone={() => { setModal(null); void load(); onChanged(); }} />}
      {modal === "contact" && <EditContactModal detail={detail} onClose={() => setModal(null)} onToast={shared.onToast} onDone={() => { setModal(null); void load(); onChanged(); }} />}
    </>
  );
}

function LiveClock({ base, since }: { base: number; since: string }) {
  const [start] = useState(() => Date.now());
  const [, setTick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setTick((n) => n + 1), 1000); return () => window.clearInterval(t); }, []);
  void since;
  return <span>{duration(base + Math.round((Date.now() - start) / 1000))}</span>;
}

function Notice({ tone, children }: { tone: "amber" | "red" | "slate"; children: React.ReactNode }) {
  const cls = tone === "red" ? "border-rose-200 bg-rose-50 text-rose-800" : tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-gray-200 bg-gray-50 text-gray-700";
  return <p className={`mx-4 mt-2 mb-0 flex items-start gap-2 rounded-xl border px-3 py-2 text-[12.5px] dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 ${cls}`}><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{children}</p>;
}

function MenuItem({ icon: Icon, onClick, children }: { icon: React.ComponentType<{ className?: string }>; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"><Icon className="h-4 w-4" />{children}</button>;
}

function ComposerButton({ icon: Icon, label, onClick, disabled }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"><Icon className="h-5 w-5" /></button>;
}

function Bubble({ m, lead }: { m: SlMessage; lead: SlLeadDetail["lead"] }) {
  if (m.direction === "system") return <p className="m-0 text-center text-[11.5px] text-gray-500">{m.body} · {lagosTime(m.createdAt)}</p>;
  if (m.direction === "note") {
    return (
      <div className="ml-auto max-w-[78%] rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
        <span className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Internal note · {m.senderName}</span>
        <p className="m-0 whitespace-pre-wrap text-[14px] text-gray-900 dark:text-slate-100">{m.body}</p>
        <span className="block text-right text-[11.5px] text-gray-500">{lagosTime(m.createdAt)}</span>
      </div>
    );
  }
  const mine = m.direction === "out" || m.direction === "bot";
  const product = m.kind === "product" ? m.payload : null;
  return (
    <div className={`flex items-end gap-2 ${mine ? "justify-end" : ""}`}>
      {!mine && <Avatar name={lead.name} src={lead.profilePic} size={32} />}
      <div className={`max-w-[78%] ${mine ? "items-end" : ""} flex flex-col`}>
        {m.kind === "comment" && <span className="mb-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500"><Megaphone className="h-3 w-3" />Commented on the ad</span>}
        {product ? (
          <div className="flex w-[360px] max-w-full gap-3 rounded-2xl bg-[#F3F0FE] p-3 dark:bg-violet-500/10">
            {product.imageUrl ? <img src={product.imageUrl} alt="" className="h-28 w-28 shrink-0 rounded-xl object-cover" /> : <ProductThumb name={product.productName} size={112} />}
            <div className="min-w-0">
              <b className="block text-[15px] text-gray-900 dark:text-slate-50">{product.productName}</b>
              {product.price !== null && <b className="block text-[17px] text-[#5B3FD9]">{money(product.price, product.currency)}</b>}
              {product.packageName && <span className="block text-[12.5px] text-gray-600">{product.packageName}</span>}
              <a href={product.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex rounded-lg bg-[#5B3FD9] px-3 py-1.5 text-[12.5px] font-semibold text-white">View Details</a>
              {m.body && <p className="m-0 mt-2 text-[13px] text-gray-800 dark:text-slate-200">{m.body}</p>}
            </div>
          </div>
        ) : m.kind === "image" ? (
          <div className="rounded-2xl bg-[#F3F0FE] p-2 dark:bg-violet-500/10">
            <img src={m.payload?.imageUrl} alt="" className="max-h-56 rounded-xl object-cover" />
            {m.body && <p className="m-0 mt-1.5 px-1 text-[14px] text-gray-900 dark:text-slate-100">{m.body}</p>}
          </div>
        ) : (
          <div className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14.5px] leading-snug ${mine ? "rounded-br-md bg-[#EEEBFC] text-gray-900 dark:bg-violet-500/20 dark:text-slate-100" : "rounded-bl-md bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-slate-100"}`}>{m.body}</div>
        )}
        <span className={`mt-1 flex items-center gap-1 text-[11.5px] text-gray-500 ${mine ? "justify-end" : ""}`}>
          {mine && <>{m.direction === "bot" ? "ManyChat" : m.senderName} ·</>} {lagosTime(m.createdAt)}
          {mine && m.status === "ok" && <CheckCheck className="h-3.5 w-3.5 text-[#5B3FD9]" />}
          {m.status === "sending" && <Loader2 className="h-3 w-3 animate-spin" />}
          {m.status === "failed" && <span className="font-semibold text-rose-600" title={m.error ?? ""}>Not sent: {m.error}</span>}
        </span>
      </div>
      {mine && <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.direction === "bot" ? "bg-[#EEEBFC] text-[#5B3FD9]" : "bg-gray-100 text-gray-600 dark:bg-slate-800"}`}>{m.direction === "bot" ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}</span>}
    </div>
  );
}

function ProductPicker({ shared, defaultId, onPick, onClose }: { shared: Shared; defaultId: string | null; onPick: (productId: string, packageId?: string) => void; onClose: () => void }) {
  const [productId, setProductId] = useState(defaultId ?? shared.products[0]?.id ?? "");
  const product = shared.products.find((p) => p.id === productId);
  const [packageId, setPackageId] = useState("");
  return (
    <div className="border-t border-gray-100 px-3 py-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2">
        <Package className="h-4 w-4 text-[#5B3FD9]" /><b className="text-[13px]">Send a product card</b>
        <select value={productId} onChange={(e) => { setProductId(e.target.value); setPackageId(""); }} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900">{shared.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select value={packageId} onChange={(e) => setPackageId(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] dark:border-slate-700 dark:bg-slate-900"><option value="">First package</option>{(product?.packages ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} – {money(p.price, p.currency)}</option>)}</select>
        <button type="button" disabled={!productId} onClick={() => onPick(productId, packageId || undefined)} className={`${btn.primary} !py-1.5 !text-[13px]`}>Send card</button>
        <button type="button" onClick={onClose} className="!min-h-0 text-[12.5px] text-gray-500">Cancel</button>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5 text-[13.5px]">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" />
      {label && <span className="w-[118px] shrink-0 font-medium text-gray-800 dark:text-slate-200">{label}</span>}
      <span className="min-w-0 flex-1 text-gray-700 dark:text-slate-300">{children}</span>
    </div>
  );
}

function LeadDetails({ detail, shared, onModal, onUpdate, onRequestPhone }: { detail: SlLeadDetail; shared: Shared; onModal: (m: Modal) => void; onUpdate: (patch: Record<string, unknown>, message?: string) => Promise<void>; onRequestPhone: () => void }) {
  const lead = detail.lead;
  const pkg = detail.packages.find((p) => p.id === lead.packageId) ?? detail.packages[0] ?? null;
  const converted = lead.status === "order_created" || lead.status === "delivered";
  const statusOptions = ["new", "in_conversation", "hot", "call_requested", "awaiting_customer", "on_hold", "lost"];
  return (
    <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
      <div className="flex items-center gap-3 px-1">
        <Avatar name={lead.name} src={lead.profilePic} size={54} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[17px] text-gray-900 dark:text-slate-50">{lead.name}</b>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <PlatformIcon platform={lead.platform} className="h-4 w-4" />
            <Pill tone="green"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{lead.lastCustomerMessageAt ? "Engaged" : "Commented"}</Pill>
            {(lead.hot || lead.status === "hot") && <Pill tone="red"><Flame className="h-3 w-3" />Hot Lead</Pill>}
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
        <div className="flex items-center justify-between"><b className="text-[15px] text-gray-900 dark:text-slate-50">Contact Information</b><button type="button" aria-label="Edit contact" onClick={() => onModal("contact")} className="!min-h-0 text-[#5B3FD9]"><PencilLine className="h-4 w-4" /></button></div>
        <Row icon={Phone}>
          <span className="flex items-center gap-2">
            {lead.phone ? <a href={`tel:${lead.phone}`} className="font-semibold text-gray-900 dark:text-slate-100">{lead.phone}</a> : <span className="text-gray-500">Not captured yet</span>}
            {lead.phone && <button type="button" aria-label="Copy phone" onClick={() => { void navigator.clipboard?.writeText(lead.phone!); shared.onToast("Phone copied."); }} className="!min-h-0 text-gray-500"><Copy className="h-4 w-4" /></button>}
            {!lead.phone && !lead.manual && <button type="button" onClick={onRequestPhone} className="!min-h-0 ml-auto inline-flex items-center gap-1 rounded-lg bg-[#EEEBFC] px-2.5 py-1 text-[12.5px] font-semibold text-[#5B3FD9]">Request<ChevronRight className="h-3.5 w-3.5" /></button>}
          </span>
        </Row>
        <Row icon={MapPin}>{lead.state ? `${lead.state}${lead.state.toLowerCase().includes("state") || lead.state.toLowerCase() === "fct" ? "" : " State"}` : <span className="text-gray-500">State not known</span>}</Row>
        {lead.address && <Row icon={MapPin}>{lead.address}</Row>}
        <Row icon={CalendarDays}>First seen: {lagosDateTime(lead.firstSeenAt)}</Row>
      </div>

      <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
        <b className="text-[15px] text-gray-900 dark:text-slate-50">Lead Information</b>
        <Row icon={Box} label="Product Interest">
          <select value={lead.productId ?? ""} onChange={(e) => void onUpdate({ productId: e.target.value })} className="w-full truncate border-0 bg-transparent p-0 text-[13.5px] font-semibold text-[#2F5BEA] focus:outline-none">
            {!lead.productId && <option value="">{lead.product || "Not known"}</option>}
            {shared.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Row>
        <Row icon={Tag} label="Offer / Package">
          {detail.packages.length ? (
            <select value={pkg?.id ?? ""} onChange={(e) => void onUpdate({ packageId: e.target.value })} className="w-full border-0 bg-transparent p-0 text-[13.5px] text-gray-800 focus:outline-none dark:text-slate-200">
              {detail.packages.map((p) => <option key={p.id} value={p.id}>{p.name} – {money(p.price, p.currency)}</option>)}
            </select>
          ) : "—"}
        </Row>
        <Row icon={Megaphone} label="Source">{lead.source || PLATFORM_NAME[lead.platform]}</Row>
        <Row icon={MessageSquareText} label="Original Comment">{lead.originalComment ? `“${lead.originalComment.length > 60 ? `${lead.originalComment.slice(0, 60)}…` : lead.originalComment}”` : "—"}</Row>
        <Row icon={Gauge} label="Lead Score">
          <span className="flex items-center gap-2"><span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${lead.score}%` }} /></span><b className="text-gray-900 dark:text-slate-100">{lead.score}%</b></span>
        </Row>
      </div>

      <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700">
        <b className="text-[15px] text-gray-900 dark:text-slate-50">Assignment &amp; Actions</b>
        <Row icon={User} label="Assigned to">
          <button type="button" onClick={() => onModal("transfer")} className="!min-h-0 flex w-full items-center gap-2 rounded-lg border border-gray-200 px-2 py-1 dark:border-slate-700">
            {lead.assignedName ? <><Avatar name={lead.assignedName} src={lead.assignedAvatar} size={24} /><b className="flex-1 text-left text-gray-900 dark:text-slate-100">{lead.assignedName}</b></> : <span className="flex-1 text-left text-gray-500">Nobody yet</span>}
            <ArrowLeftRight className="h-4 w-4 text-[#5B3FD9]" />
          </button>
        </Row>
        <Row icon={Sparkles} label="Status">
          {converted ? <StatusChip status={lead.status} /> : (
            <span className="relative inline-flex">
              <StatusChip status={lead.chip} />
              <select aria-label="Change status" value={lead.status} onChange={(e) => e.target.value === "lost" ? onModal("close") : void onUpdate({ status: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0">
                {statusOptions.map((s) => <option key={s} value={s}>{STATUS[s]?.label ?? s}</option>)}
              </select>
            </span>
          )}
        </Row>
        <Row icon={CalendarClock} label="Next Follow-up">
          <span className="flex items-center gap-2">
            <span className={lead.followUpAt ? "font-semibold text-gray-900 dark:text-slate-100" : "text-gray-500"}>{lead.followUpAt ? whenLabel(lead.followUpAt) : "Not scheduled"}</span>
            <button type="button" onClick={() => onModal("schedule")} className="!min-h-0 ml-auto text-[13px] font-semibold text-[#5B3FD9] underline">{lead.followUpAt ? "Change" : "Schedule"}</button>
          </span>
        </Row>
      </div>

      {lead.orderId
        ? <button type="button" onClick={() => shared.onOpenOrder?.(lead.orderId!)} className={`${btn.soft} w-full !py-3 !text-[15px]`}><ShoppingCart className="h-5 w-5" />Order #{lead.orderId} · open</button>
        : <button type="button" onClick={() => onModal("order")} className={`${btn.primary} w-full !py-3 !text-[15px]`}><ShoppingCart className="h-5 w-5" />Create Order</button>}
      <div className="grid grid-cols-3 gap-2">
        {([["schedule", CalendarDays, "Schedule Follow-up"], ["transfer", ArrowLeftRight, "Transfer"], ["close", CheckCheck, "Close Lead"]] as const).map(([m, Icon, label]) => (
          <button key={m} type="button" onClick={() => onModal(m)} disabled={m === "close" && lead.status === "lost"} className="!min-h-0 flex flex-col items-center gap-1 rounded-xl border border-gray-200 px-2 py-3 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
            <Icon className="h-5 w-5 text-[#5B3FD9]" />{label}
          </button>
        ))}
      </div>
    </div>
  );
}

function History({ detail, shared }: { detail: SlLeadDetail; shared: Shared }) {
  const fups = detail.followUps;
  const orders = detail.history;
  const total = useMemo(() => orders.filter((o) => o.status === "Delivered").reduce((s, o) => s + o.amount, 0), [orders]);
  return (
    <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700"><span className="text-[12px] text-gray-500">Orders</span><b className="block text-[20px] text-gray-900 dark:text-slate-50">{orders.length}</b></div>
        <div className="rounded-xl border border-gray-200 p-3 dark:border-slate-700"><span className="text-[12px] text-gray-500">Delivered value</span><b className="block text-[20px] text-gray-900 dark:text-slate-50">{money(total)}</b></div>
      </div>
      <b className="block px-1 text-[14px] text-gray-900 dark:text-slate-50">Past orders</b>
      {orders.length === 0 && <p className="m-0 px-1 text-[13px] text-gray-500">{detail.lead.phone ? "No order with this phone number yet." : "Past orders show once we have the customer's phone number."}</p>}
      {orders.map((o) => (
        <button key={o.id} type="button" onClick={() => shared.onOpenOrder?.(String(o.id))} className="!min-h-0 flex w-full items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-left hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800">
          <span className="min-w-0 flex-1"><b className="block truncate text-[13.5px] text-gray-900 dark:text-slate-100">#{o.id} · {o.product}</b><span className="text-[12px] text-gray-500">{lagosDateTime(o.createdAt)}{o.packageName ? ` · ${o.packageName}` : ""}</span></span>
          <span className="text-right"><b className="block text-[13.5px]">{money(o.amount, o.currency)}</b><Pill tone={o.status === "Delivered" ? "green" : ["Cancelled", "Failed"].includes(o.status) ? "red" : "amber"}>{o.status}</Pill></span>
        </button>
      ))}
      <b className="block px-1 pt-1 text-[14px] text-gray-900 dark:text-slate-50">Follow-ups</b>
      {fups.length === 0 && <p className="m-0 px-1 text-[13px] text-gray-500">None scheduled.</p>}
      {fups.map((f) => (
        <div key={f.id} className="rounded-xl border border-gray-200 px-3 py-2 text-[13px] dark:border-slate-700">
          <span className="flex items-center justify-between gap-2"><b>{whenLabel(f.dueAt)}</b><Pill tone={f.status === "done" ? "green" : f.status === "cancelled" ? "slate" : "purple"}>{f.status === "done" ? "Done" : f.status === "cancelled" ? "Replaced" : "Scheduled"}</Pill></span>
          {f.note && <span className="block text-gray-600 dark:text-slate-400">{f.note}</span>}
          <span className="text-[11.5px] text-gray-400">{f.auto ? "Automatic" : `By ${f.createdByName ?? "—"}`}</span>
        </div>
      ))}
    </div>
  );
}
