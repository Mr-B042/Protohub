import { useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDown, ArrowRight, CalendarClock, CheckCircle2, Clock, Copy, ExternalLink, Gift, Layers, ListChecks, Loader2, MessageCircle, MessageSquareText, MoreHorizontal, PencilLine,
  Plus, RefreshCw, Search, Send, ShoppingCart, Sparkles, Star, Tag, Timer, Users, Workflow, XCircle, Zap, Filter
} from "lucide-react";
import { socialLeadsApi, type SlAutomation } from "../../lib/api";
import { FacebookIcon } from "../../components/SocialIcons";
import { Card, CardTitle, Empty, Kpi, Modal, Pill, Select, Switch, btn, field, timeAgo } from "./sl-ui";
import { useLoad } from "./sl-data";
import type { Shared } from "./SocialLeadsPage";

const TRIGGERS: Record<string, { label: string; Icon: React.ComponentType<{ className?: string }>; tile: string }> = {
  comment: { label: "Comment", Icon: MessageSquareText, tile: "bg-violet-50 text-violet-600" },
  keyword: { label: "Keyword", Icon: Tag, tile: "bg-rose-50 text-rose-500" },
  time_delay: { label: "Time Delay", Icon: Timer, tile: "bg-sky-50 text-sky-600" },
  inactivity: { label: "Inactivity", Icon: Clock, tile: "bg-fuchsia-50 text-fuchsia-600" },
  after_reply: { label: "After Reply", Icon: MessageCircle, tile: "bg-amber-50 text-amber-600" },
  order_created: { label: "Order Created", Icon: ShoppingCart, tile: "bg-amber-50 text-amber-500" },
  other: { label: "Other", Icon: Zap, tile: "bg-gray-100 text-gray-600" }
};

const TEMPLATES = [
  { key: "comment-dm", name: "Comment to Message (Main)", title: "Comment to DM", sub: "Convert ad comments to leads", trigger: "comment", Icon: MessageSquareText, description: "Auto-reply to ad comments and send product details.",
    steps: ["In ManyChat: Automation › New Automation › trigger “User comments on your post or ad”. Pick the ad.", "Add a public reply (e.g. “Thank you! We've sent you the details privately 😊”) and a private message with the product, price and 3 quick replies: “I want to order”, “More details”, “Talk to a sales rep”.", "After the private message add Action › External Request: POST, the address below with ?event=comment&flow=Comment to Message (Main)&product=<product name>, body “Add Full Contact Data”.", "On each quick reply add the same External Request with ?event=message so the reply reaches the rep."] },
  { key: "inquiry", name: "Product Inquiry Flow", title: "Product Inquiry", sub: "Answer FAQs and share offers", trigger: "keyword", Icon: ShoppingCart, description: "Answer price, availability and delivery questions.",
    steps: ["Automation › Keywords: price, how much, available, deliver, location.", "Reply with the answer, then External Request with ?event=message&flow=Product Inquiry Flow."] },
  { key: "followup", name: "Follow-up (No Response)", title: "Follow-up Reminder", sub: "Re-engage inactive leads", trigger: "time_delay", Icon: CalendarClock, description: "Re-engage leads that haven't replied within 2 hours.",
    steps: ["In the main flow add Smart Delay 2 hours, then Condition: last interaction older than 2 hours.", "Send a short reminder, then External Request with ?event=bot&flow=Follow-up (No Response)."] },
  { key: "upsell", name: "Upsell / Cross-sell", title: "Upsell / Cross-sell", sub: "Recommend related products", trigger: "after_reply", Icon: Gift, description: "Recommend related products after interest.",
    steps: ["After “I want to order”, send the 2-pack or the add-on with its price.", "External Request with ?event=bot&flow=Upsell / Cross-sell."] },
  { key: "confirm", name: "Order Confirmation (Social)", title: "Order Confirmation", sub: "Send order summary and next steps", trigger: "order_created", Icon: CheckCircle2, description: "Send order summary after order is created.",
    steps: ["Protohub sends no message to ManyChat on its own yet: the rep sends the confirmation from the Inbox (Templates › Order Confirmation).", "If you also keep a ManyChat flow for it, add External Request ?event=bot&flow=Order Confirmation (Social) so it is counted here."] }
];

export default function AutomationsTab({ shared }: { shared: Shared }) {
  const data = useLoad(() => socialLeadsApi.automations(), "automations", 60_000);
  const settings = useLoad(() => (shared.canSetup ? socialLeadsApi.settings() : Promise.resolve(null)), "settings");
  const [chip, setChip] = useState<"all" | "active" | "paused" | "draft">("all");
  const [trigger, setTrigger] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<null | { kind: "edit"; flow: Partial<SlAutomation>; template?: typeof TEMPLATES[number] } | { kind: "logs" }>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const d = data.data, k = d?.kpis;
  const flows = d?.flows ?? [];
  const shown = useMemo(() => flows.filter((f) => (chip === "all" || f.status === chip) && (trigger === "all" || f.trigger === trigger) && (!search || `${f.name} ${f.description ?? ""}`.toLowerCase().includes(search.toLowerCase()))), [flows, chip, trigger, search]);
  const main = flows.find((f) => f.trigger === "comment" && f.status === "active") ?? flows[0] ?? null;
  const sync = async () => {
    setSyncing(true);
    try { const r = await socialLeadsApi.syncAutomations(); shared.onToast(`${r.synced} flow${r.synced === 1 ? "" : "s"} read from ManyChat.`); data.reload(); }
    catch (e) { shared.onToast((e as Error).message); } finally { setSyncing(false); }
  };
  const setStatus = async (f: SlAutomation, status: string) => {
    try { await socialLeadsApi.updateAutomation(f.id, { status }); data.reload(); shared.onToast(status === "paused" ? `${f.name} paused: its events no longer create new leads.` : `${f.name} is active.`); }
    catch (e) { shared.onToast((e as Error).message); }
  };
  const count = (s: string) => flows.filter((f) => s === "all" || f.status === s).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={Zap} tone="purple" value={k?.active.value ?? "—"} label="Active Automations" change={k?.active.change ?? null} />
        <Kpi icon={Send} tone="blue" value={(k?.messagesSent.value ?? 0).toLocaleString()} label="Messages Sent" change={k?.messagesSent.change ?? null} />
        <Kpi icon={Users} tone="indigo" value={(k?.engaged.value ?? 0).toLocaleString()} label="Leads Engaged" change={k?.engaged.change ?? null} />
        <Kpi icon={ShoppingCart} tone="red" value={(k?.orders.value ?? 0).toLocaleString()} label="Orders from Automations" change={k?.orders.change ?? null} />
        <Kpi icon={RefreshCw} tone="green" value={k?.conversion.value !== null && k?.conversion.value !== undefined ? `${k.conversion.value}%` : "—"} label="Automation Conversion" change={k?.conversion.change ?? null} unit="pp" />
      </div>
      <Card className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="mr-auto">
            <h2 className="m-0 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">Automations</h2>
            <p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Create and manage automated conversations, follow-ups and lead nurturing with Manychat.</p>
          </div>
          {shared.canSetup && <button type="button" onClick={sync} disabled={syncing} className={btn.ghost}>{syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Sync from ManyChat</button>}
          {shared.canSetup && <button type="button" onClick={() => setModal({ kind: "edit", flow: { trigger: "comment", status: "draft" } })} className={btn.primary}><Plus className="h-4 w-4" />Create Automation</button>}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {([["all", "All Automations", ""], ["active", "Active", "bg-emerald-500"], ["paused", "Paused", "bg-amber-500"], ["draft", "Drafts", "bg-gray-400"]] as const).map(([key, label, dot]) => (
            <button key={key} type="button" onClick={() => setChip(key)} className={`!min-h-0 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[13.5px] font-semibold ${chip === key ? "bg-[#5B3FD9] text-white" : "border border-gray-200 bg-white text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"}`}>
              {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}{label} ({count(key)})
            </button>
          ))}
          <span className="relative ml-auto min-w-[220px]"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search automations..." className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" /></span>
          <span className="flex items-center gap-1"><Filter className="h-4 w-4 text-gray-500" /><Select label="Trigger" className="w-[160px]" value={trigger} onChange={setTrigger} options={[{ value: "all", label: "All Triggers" }, ...Object.entries(TRIGGERS).map(([v, t]) => ({ value: v, label: t.label }))]} /></span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
          <div className="overflow-x-auto rounded-2xl border border-gray-200 dark:border-slate-700">
            <table className="!min-w-[760px] w-full border-collapse">
              <thead className="bg-gray-50/80 dark:bg-slate-800/50"><tr>
                {["Automation", "Trigger", "Performance (last 7 days)", "Status", "Actions"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{h}</th>)}
              </tr></thead>
              <tbody>
                {!d && <tr><td colSpan={5}><Empty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Empty></td></tr>}
                {d && shown.length === 0 && <tr><td colSpan={5}><Empty>{flows.length ? "No automation matches." : "No automation yet. Use Sync from ManyChat to list your flows, or start from a template below. Each flow's numbers appear once its External Request carries ?flow=its name."}</Empty></td></tr>}
                {shown.map((f) => {
                  const t = TRIGGERS[f.trigger] ?? TRIGGERS.other;
                  return (
                    <tr key={f.id} className="border-t border-gray-100 dark:border-slate-800 [&>td]:px-3 [&>td]:py-3 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                      <td><span className="flex items-center gap-3"><span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl dark:bg-slate-800 ${t.tile}`}><t.Icon className="h-5 w-5" /></span><span className="min-w-0"><b className="block">{f.name}</b><span className="text-[12.5px] text-gray-500">{f.description || (f.manychatNs ? "From ManyChat" : "—")}</span></span></span></td>
                      <td><span className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 px-2.5 py-1.5 text-[12.5px] font-semibold dark:border-slate-700">{f.trigger === "comment" ? <FacebookIcon className="h-4 w-4" /> : <t.Icon className="h-4 w-4 text-[#5B3FD9]" />}{t.label}</span></td>
                      <td><span className="grid grid-cols-3 gap-4 text-center"><span><b className="block">{f.triggered.toLocaleString()}</b><span className="text-[12px] text-gray-500">Triggered</span></span><span><b className="block">{f.engaged.toLocaleString()}</b><span className="text-[12px] text-gray-500">Engaged</span></span><span><b className="block">{f.conversion !== null ? `${f.conversion}%` : "—"}</b><span className="text-[12px] text-gray-500">Converted</span></span></span></td>
                      <td><span className="flex items-center gap-2"><Switch on={f.status === "active"} label={`${f.name} active`} disabled={!shared.canSetup} onChange={(on) => void setStatus(f, on ? "active" : "paused")} /><span className={`text-[13px] font-semibold ${f.status === "active" ? "text-emerald-600" : f.status === "paused" ? "text-amber-600" : "text-gray-500"}`}>{f.status === "active" ? "Active" : f.status === "paused" ? "Paused" : "Draft"}</span></span></td>
                      <td>
                        <span className="relative flex items-center gap-1">
                          {shared.canSetup && <button type="button" aria-label="Edit" onClick={() => setModal({ kind: "edit", flow: f })} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"><PencilLine className="h-[18px] w-[18px]" /></button>}
                          <button type="button" aria-label="More" onClick={() => setMenuFor(menuFor === f.id ? null : f.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800"><MoreHorizontal className="h-[18px] w-[18px]" /></button>
                          {menuFor === f.id && (
                            <div className="absolute right-0 top-9 z-20 w-60 rounded-xl border border-gray-200 bg-white p-1 text-[13px] shadow-lg dark:border-slate-700 dark:bg-slate-900" onMouseLeave={() => setMenuFor(null)}>
                              {settings.data?.webhookUrl && <button type="button" className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); void navigator.clipboard?.writeText(`${settings.data!.webhookUrl}?event=${f.trigger === "comment" ? "comment" : "message"}&flow=${encodeURIComponent(f.name)}`); shared.onToast("Request address for this flow copied."); }}><Copy className="h-4 w-4" />Copy its request address</button>}
                              {shared.canSetup && f.status !== "draft" && <button type="button" className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); void setStatus(f, "draft"); }}><Layers className="h-4 w-4" />Move to drafts</button>}
                              {shared.canSetup && <button type="button" className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50" onClick={async () => { setMenuFor(null); await socialLeadsApi.deleteAutomation(f.id); data.reload(); }}><XCircle className="h-4 w-4" />Remove from this list</button>}
                            </div>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-gray-200 p-4 dark:border-slate-700">
            <CardTitle icon={Workflow} title={<>Automation Flow <span className="font-medium text-gray-500">(Example)</span></>} right={<a href="https://app.manychat.com" target="_blank" rel="noopener noreferrer" className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2F5BEA] underline">View Full Flow<ExternalLink className="h-3.5 w-3.5" /></a>} />
            <div className="mt-3 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /><b>{main?.name ?? "Comment to Message (Main)"}</b><Pill tone="green">{main ? (main.status === "active" ? "Active" : main.status) : "Example"}</Pill></div>
            <div className="mt-3 flex flex-col items-center gap-1.5">
              <div className="w-full rounded-xl border-2 border-[#8B7CF6] bg-[#F7F5FF] px-4 py-3 dark:bg-violet-500/10"><span className="flex items-center gap-2"><FacebookIcon className="h-6 w-6" /><span><b className="block">Trigger</b><span className="text-[13px] text-gray-600">User comments on ad</span></span></span></div>
              <ArrowDown className="h-4 w-4 text-[#5B3FD9]" />
              <div className="w-[92%] rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900"><span className="flex items-start gap-2"><Send className="mt-0.5 h-5 w-5 text-[#5B3FD9]" /><span><b className="block">Action: Send Private Message</b><span className="text-[13px] text-gray-600">Thank you for your interest! Here are the full details of the product.</span></span></span></div>
              <ArrowDown className="h-4 w-4 text-[#5B3FD9]" />
              <div className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
                <span className="flex items-center gap-2"><ListChecks className="h-5 w-5 text-[#5B3FD9]" /><b>Quick Replies</b></span>
                <div className="mt-2 flex flex-wrap gap-1.5">{["I want to order", "More details", "Talk to a sales rep"].map((x) => <span key={x} className="rounded-full border border-[#C9BEF5] bg-[#F7F5FF] px-2.5 py-1 text-[12px] font-semibold text-[#5B3FD9]">{x}</span>)}</div>
              </div>
              <ArrowDown className="h-4 w-4 text-[#5B3FD9]" />
              <div className="w-[92%] rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 px-4 py-2.5 text-[13px] text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200"><b>External Request → Protohub</b>: the lead appears in the Inbox and goes to the next rep.</div>
            </div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)]">
        <Card className="p-4">
          <CardTitle icon={Layers} title="Automation Templates" sub="Ready-to-use automation templates for your business." />
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            {TEMPLATES.map((t) => (
              <div key={t.key} className="flex flex-col rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                <t.Icon className="h-6 w-6 text-[#5B3FD9]" />
                <b className="mt-2 text-[14px]">{t.title}</b>
                <span className="flex-1 text-[12.5px] text-gray-600 dark:text-slate-400">{t.sub}</span>
                <button type="button" disabled={!shared.canSetup} onClick={() => setModal({ kind: "edit", flow: { name: t.name, description: t.description, trigger: t.trigger, status: "draft" }, template: t })} className="!min-h-0 mt-3 inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-2 py-1.5 text-[12.5px] font-semibold text-[#5B3FD9] hover:bg-[#F5F2FE] disabled:opacity-40 dark:border-slate-700">Use Template<ArrowRight className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-4">
          <CardTitle icon={Activity} title="Automation Activity" right={<button type="button" onClick={() => setModal({ kind: "logs" })} className="!min-h-0 inline-flex items-center gap-1 text-[13px] font-semibold text-[#2F5BEA] underline">View Logs<ArrowRight className="h-4 w-4" /></button>} />
          <div className="mt-2 space-y-2.5">
            {(d?.activity ?? []).length === 0 && <p className="m-0 py-4 text-[13px] text-gray-500">Nothing yet: activity shows once ManyChat sends events.</p>}
            {(d?.activity ?? []).slice(0, 5).map((a, i) => <ActivityRow key={i} a={a} />)}
          </div>
        </Card>
      </div>

      {modal?.kind === "edit" && <AutomationModal shared={shared} flow={modal.flow} template={modal.template} webhookUrl={settings.data?.webhookUrl ?? null} onClose={() => setModal(null)} onDone={() => { setModal(null); data.reload(); }} />}
      {modal?.kind === "logs" && <LogsModal onClose={() => setModal(null)} />}
    </div>
  );
}

export function activityText(a: { kind: string; ok: boolean; name: string | null; flow: string | null; error: string | null; skipped: string | null; lead: string | null }) {
  if (!a.ok) return `Problem: ${a.error ?? a.kind}`;
  if (a.skipped) return `Skipped: ${a.skipped}`;
  if (a.kind === "converted") return `Lead converted to order (${a.lead ?? ""} · ${a.name ?? ""})`;
  if (a.kind === "send") return `Reply sent to ${a.name ?? "a customer"}`;
  if (a.kind === "escalated") return `No reply in time: ${a.name ?? a.lead ?? "a lead"}`;
  if (a.kind === "test") return "Test event received";
  if (a.kind === "inbound.comment") return `${a.flow ? `Automation “${a.flow}” triggered: ` : ""}${a.name ?? "Someone"} commented`;
  if (a.kind === "inbound.bot") return `${a.flow ? `“${a.flow}” ` : "Automation "}sent a message to ${a.name ?? "a customer"}`;
  return `${a.name ?? "A customer"} wrote${a.flow ? ` (${a.flow})` : ""}`;
}
function ActivityRow({ a }: { a: { kind: string; ok: boolean; at: string; name: string | null; flow: string | null; error: string | null; skipped: string | null; lead: string | null } }) {
  const Icon = !a.ok ? XCircle : a.kind === "converted" ? ShoppingCart : a.kind === "send" || a.kind === "inbound.bot" ? Send : a.kind.startsWith("inbound") ? CheckCircle2 : Sparkles;
  const tone = !a.ok ? "bg-rose-50 text-rose-600" : a.kind === "converted" ? "bg-rose-50 text-rose-500" : a.kind === "send" || a.kind === "inbound.bot" ? "bg-sky-50 text-sky-600" : "bg-emerald-50 text-emerald-600";
  return <div className="flex items-center gap-2.5 text-[13.5px]"><span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1 truncate">{activityText(a)}</span><span className="shrink-0 text-[12px] text-gray-500">{timeAgo(a.at)}</span></div>;
}

function AutomationModal({ shared, flow, template, webhookUrl, onClose, onDone }: { shared: Shared; flow: Partial<SlAutomation>; template?: typeof TEMPLATES[number]; webhookUrl: string | null; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ name: flow.name ?? "", description: flow.description ?? "", trigger: flow.trigger ?? "comment", status: flow.status ?? "draft" });
  const [busy, setBusy] = useState(false);
  const steps = template?.steps ?? TEMPLATES.find((t) => t.trigger === form.trigger)?.steps ?? TEMPLATES[0].steps;
  const address = webhookUrl ? `${webhookUrl}?event=${form.trigger === "comment" ? "comment" : form.trigger === "after_reply" || form.trigger === "time_delay" || form.trigger === "order_created" ? "bot" : "message"}&flow=${encodeURIComponent(form.name || "My flow")}` : null;
  const save = async () => {
    if (!form.name.trim()) return shared.onToast("Give the automation a name.");
    setBusy(true);
    try {
      if (flow.id) await socialLeadsApi.updateAutomation(flow.id, form); else await socialLeadsApi.saveAutomation({ ...form, template: template?.key });
      shared.onToast("Automation saved."); onDone();
    } catch (e) { shared.onToast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal title={flow.id ? "Edit Automation" : "Create Automation"} sub="The flow itself is built in ManyChat; Protohub tracks it and turns its customers into leads." icon={Workflow} onClose={onClose} width="max-w-[720px]"
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" onClick={save} disabled={busy} className={btn.primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="mb-1 block text-[12.5px] font-semibold">Name (the same as the flow in ManyChat)</span><input className={field} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-[12.5px] font-semibold">Description</span><input className={field} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label><span className="mb-1 block text-[12.5px] font-semibold">Trigger</span><select className={field} value={form.trigger} onChange={(e) => setForm({ ...form, trigger: e.target.value })}>{Object.entries(TRIGGERS).map(([v, t]) => <option key={v} value={v}>{t.label}</option>)}</select></label>
        <label><span className="mb-1 block text-[12.5px] font-semibold">Status</span><select className={field} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused (its events do not create new leads)</option></select></label>
      </div>
      <div className="mt-4 rounded-xl bg-[#F7F5FF] p-3 dark:bg-violet-500/10">
        <b className="text-[14px]">Set it up in ManyChat</b>
        <ol className="m-0 mt-2 space-y-1.5 pl-5 text-[13px] text-gray-800 dark:text-slate-200">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
        {address ? (
          <div className="mt-3"><span className="text-[12px] font-semibold text-gray-600">Request address for this flow</span>
            <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-900">{address}</code><button type="button" className={`${btn.ghost} !py-1.5`} onClick={() => { void navigator.clipboard?.writeText(address); shared.onToast("Copied."); }}><Copy className="h-4 w-4" />Copy</button></div>
            <p className="m-0 mt-1 text-[12px] text-gray-500">Keep this address private: anyone with it can send leads to your inbox.</p>
          </div>
        ) : <p className="m-0 mt-2 text-[12.5px] text-gray-500">The Owner or an Admin sees the request address in Settings › Integrations.</p>}
      </div>
    </Modal>
  );
}

function LogsModal({ onClose }: { onClose: () => void }) {
  const logs = useLoad(() => socialLeadsApi.events(), "logs");
  return (
    <Modal title="Activity log" sub="Everything ManyChat sent and every reply, newest first." icon={Activity} onClose={onClose} width="max-w-[720px]">
      {!logs.data && <Empty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Empty>}
      {logs.error && <Empty>{logs.error}</Empty>}
      <div className="space-y-2">
        {(logs.data?.events ?? []).map((e) => (
          <div key={e.id} className="flex items-start gap-2 rounded-xl border border-gray-200 px-3 py-2 text-[13px] dark:border-slate-700">
            <Star className={`mt-0.5 h-4 w-4 ${e.ok ? "text-emerald-500" : "text-rose-500"}`} />
            <span className="min-w-0 flex-1">{activityText({ kind: e.kind, ok: e.ok, name: e.detail?.name ?? null, flow: e.detail?.flow ?? null, error: e.detail?.error ?? null, skipped: e.detail?.skipped ?? null, lead: e.detail?.lead ?? null })}</span>
            <span className="shrink-0 text-[12px] text-gray-500">{timeAgo(e.createdAt)}</span>
          </div>
        ))}
        {logs.data && !logs.data.events.length && <Empty>No activity yet.</Empty>}
      </div>
    </Modal>
  );
}

export { LogsModal };
