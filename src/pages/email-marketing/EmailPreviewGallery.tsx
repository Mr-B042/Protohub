import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Monitor, Pencil, Smartphone, X } from "lucide-react";
import { emailMarketingApi, type EmCampaign, type EmDesigner, type EmFlowNode } from "../../lib/api";
import { withTheirProduct, type EmailDesign, type TheirProduct } from "../../lib/email-render";
import EmailFrame from "./EmailFrame";

/**
 * Every email, drawn exactly as customers get it (Bright, 9 Nov 2026: "get
 * each email preview of all automations so we can see how emails look and
 * decide to modify them… the same goes to campaigns"). Automations show
 * their emails in order with the day each goes out; {{Their Product}} parts
 * show a sample product. Edit opens that flow or campaign.
 */

export type PreviewFlow = { id: string; name: string; status: string; nodes: EmFlowNode[] };
type Item = { key: string; group: string; groupId: string; status: string; when: string; name: string; subject: string; preheader: string; design: EmailDesign | null; loading?: boolean };

/** The emails of a flow in order, with when each goes ("Day 1", "Day 3 · if they didn't order"). */
export function flowEmails(nodes: EmFlowNode[], startDays = 0, note = ""): Array<{ id: string; name: string; subject: string; preheader: string; design: EmailDesign | null; when: string }> {
  const out: Array<{ id: string; name: string; subject: string; preheader: string; design: EmailDesign | null; when: string }> = [];
  let days = startDays;
  for (const node of nodes) {
    if (node.type === "wait") days += node.unit === "hours" ? node.amount / 24 : node.amount;
    if (node.type === "email") {
      const day = Math.floor(days) + 1;
      out.push({ id: node.id, name: node.name, subject: node.email.subject, preheader: node.email.preheader, design: (node.email.design as EmailDesign | null) ?? null, when: `Day ${day}${days % 1 ? ` (+${Math.round((days % 1) * 24)}h)` : ""}${note}` });
    }
    if (node.type === "condition") {
      out.push(...flowEmails(node.yes, days, ` · if yes: ${node.name}`), ...flowEmails(node.no, days, ` · if no: ${node.name}`));
    }
  }
  return out;
}

export default function EmailPreviewGallery({ title, flows, campaigns, onClose, onEdit }: {
  title: string;
  flows?: PreviewFlow[];
  campaigns?: EmCampaign[];
  onClose: () => void;
  onEdit: (groupId: string) => void;
}) {
  const [mobile, setMobile] = useState(false);
  const [only, setOnly] = useState("");
  const [designer, setDesigner] = useState<EmDesigner | null>(null);
  const [loaded, setLoaded] = useState<Record<string, EmailDesign | null>>({});
  useEffect(() => { void emailMarketingApi.designer().then(setDesigner).catch(() => undefined); }, []);
  // Campaign lists come without their designs: fetch each one shown.
  useEffect(() => {
    for (const row of campaigns ?? []) {
      if (row.design || row.id in loaded) continue;
      void emailMarketingApi.campaign(row.id).then((res) => setLoaded((prev) => ({ ...prev, [row.id]: (res.campaign.design as EmailDesign | null) ?? null }))).catch(() => setLoaded((prev) => ({ ...prev, [row.id]: null })));
    }
  }, [campaigns]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sample = designer?.products.find((row) => row.image && row.links.length) ?? designer?.products[0];
  const theirs: TheirProduct | null = sample ? { name: sample.name, price: sample.priceMin ? `From ₦${Math.round(sample.priceMin).toLocaleString("en-NG")}` : "", imageUrl: sample.image, link: sample.links[0]?.url ?? "" } : null;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const flow of flows ?? []) {
      flowEmails(flow.nodes).forEach((row, index) => out.push({ key: `${flow.id}:${row.id}:${index}`, group: flow.name, groupId: flow.id, status: flow.status, when: row.when, name: row.name, subject: row.subject, preheader: row.preheader, design: row.design }));
    }
    for (const row of campaigns ?? []) {
      out.push({ key: row.id, group: row.name, groupId: row.id, status: row.status, when: row.sendAt ? new Date(row.sendAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : row.status, name: row.name, subject: row.subject, preheader: row.preheader, design: (row.design as EmailDesign | null | undefined) ?? loaded[row.id] ?? null, loading: !row.design && !(row.id in loaded) });
    }
    return out;
  }, [flows, campaigns, loaded]);
  const groups = [...new Map(items.map((item) => [item.groupId, item.group])).entries()];
  const shown = items.filter((item) => !only || item.groupId === only);
  const fill = (text: string) => (theirs ? text.split("{{Their Product}}").join(theirs.name) : text);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#F6F7FB] dark:bg-slate-950" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mr-auto min-w-0">
          <h2 className="m-0 text-[20px] font-extrabold text-gray-900 dark:text-slate-50">{title}</h2>
          <p className="m-0 text-[12.5px] text-gray-500">{shown.length} email{shown.length === 1 ? "" : "s"}, drawn exactly as customers get them{theirs ? `. Parts that show the customer's own product use a sample: ${theirs.name}.` : "."}</p>
        </div>
        <select value={only} onChange={(event) => setOnly(event.target.value)} aria-label="Show" className="!min-h-0 max-w-[320px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-[13px] font-semibold dark:border-slate-700 dark:bg-slate-900">
          <option value="">All ({groups.length})</option>
          {groups.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div className="flex rounded-xl border border-gray-200 p-0.5 dark:border-slate-700">
          <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)} className={`!min-h-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${!mobile ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><Monitor className="h-4 w-4" />Desktop</button>
          <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)} className={`!min-h-0 inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[13px] font-semibold ${mobile ? "bg-[#5B3FD9] text-white" : "text-gray-600"}`}><Smartphone className="h-4 w-4" />Phone</button>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="!min-h-0 rounded-xl border border-gray-200 p-2 dark:border-slate-700"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {!shown.length && <p className="m-0 text-center text-[14px] text-gray-500">No emails yet.</p>}
        <div className={`grid gap-5 ${mobile ? "grid-cols-[repeat(auto-fill,minmax(300px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(420px,1fr))]"}`}>
          {shown.map((item) => (
            <div key={item.key} className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
              <div className="space-y-1 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-wide text-[#5B3FD9]" title={item.group}>{item.group.replace(/^Autopilot: /, "")}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${item.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>{item.status}</span>
                </div>
                <div className="text-[14px] font-bold text-gray-900 dark:text-slate-50">{item.name} <span className="font-semibold text-gray-500">· {item.when}</span></div>
                <div className="truncate text-[13px] text-gray-800 dark:text-slate-200" title={fill(item.subject)}><b>Subject:</b> {fill(item.subject) || "—"}</div>
                {item.preheader && <div className="truncate text-[12.5px] text-gray-500" title={fill(item.preheader)}>{fill(item.preheader)}</div>}
              </div>
              <div className="flex-1 bg-[#F2F4F7] p-2">
                {item.design ? <EmailFrame design={theirs ? withTheirProduct(item.design, theirs) : item.design} mobile={mobile} fit brand={designer?.sender.fromName} footerNote={designer?.settings.footerNote} preheader={item.preheader} minHeight={420} />
                  : <p className="m-0 p-6 text-center text-[13px] text-gray-500">{item.loading ? "Loading…" : "This email has no saved design."}</p>}
              </div>
              <div className="border-t border-gray-100 px-4 py-2.5 dark:border-slate-800">
                <button type="button" onClick={() => onEdit(item.groupId)} className="!min-h-0 inline-flex items-center gap-1.5 text-[13px] font-bold text-[#5B3FD9]"><Pencil className="h-4 w-4" />Edit</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
