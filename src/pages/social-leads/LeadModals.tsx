import { useMemo, useState } from "react";
import { ArrowLeftRight, CalendarPlus, CheckCircle2, Loader2, PencilLine, ShoppingCart, UserPlus, XCircle } from "lucide-react";
import { ordersApi, socialLeadsApi, type SlLeadDetail, type SlProduct } from "../../lib/api";
import { NIGERIA_STATES } from "../../lib/nigeria";
import { Avatar, Modal, btn, field, money } from "./sl-ui";
import type { Shared } from "./SocialLeadsPage";

/** The windows used by the Inbox, All Leads and Follow-ups tabs. */

const Label = ({ children }: { children: React.ReactNode }) => <span className="mb-1 block text-[12.5px] font-semibold text-gray-700 dark:text-slate-300">{children}</span>;
const States = () => <datalist id="sl-states">{NIGERIA_STATES.map((s) => <option key={s} value={s} />)}</datalist>;

const toLocalInput = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16);
/** A Lagos "YYYY-MM-DDTHH:mm" from the time picker → ISO. */
export const fromLagosInput = (value: string) => new Date(`${value}:00+01:00`).toISOString();

export function nextMorning() {
  const lagos = new Date(Date.now() + 3_600_000);
  lagos.setUTCDate(lagos.getUTCDate() + 1);
  lagos.setUTCHours(10, 0, 0, 0);
  return new Date(lagos.getTime() - 3_600_000);
}

// ── Create Order ──────────────────────────────────────────────────────────

const ORDER_SOURCE: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger" };

export function CreateOrderModal({ detail, products, onClose, onDone, onToast }: { detail: SlLeadDetail; products: SlProduct[]; onClose: () => void; onDone: (orderId: string) => void; onToast: (m: string) => void }) {
  const lead = detail.lead;
  const [productId, setProductId] = useState(lead.productId ?? products[0]?.id ?? "");
  const product = products.find((p) => p.id === productId) ?? null;
  const [packageId, setPackageId] = useState(lead.packageId ?? product?.packages[0]?.id ?? "");
  const pkg = product?.packages.find((p) => p.id === packageId) ?? null;
  const [form, setForm] = useState({
    customer: lead.name.startsWith("@") ? "" : lead.name, phone: lead.phone ?? "", whatsapp: lead.whatsapp ?? "", state: lead.state ?? "", address: lead.address ?? "",
    quantity: 1, amount: pkg ? String(pkg.price) : "", campaign: lead.campaign ?? "", note: ""
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const pickProduct = (id: string) => {
    setProductId(id);
    const p = products.find((x) => x.id === id);
    const first = p?.packages[0];
    setPackageId(first?.id ?? "");
    if (first) set("amount", String(first.price));
  };
  const pickPackage = (id: string) => { setPackageId(id); const p = product?.packages.find((x) => x.id === id); if (p) set("amount", String(p.price)); };
  const submit = async () => {
    const amount = Number(String(form.amount).replace(/[^\d.]/g, ""));
    if (!form.customer.trim()) return setProblem("Type the customer's name.");
    if (String(form.phone).replace(/\D/g, "").length < 10) return setProblem("Type the customer's phone number (11 digits).");
    if (!product) return setProblem("Pick the product.");
    if (!Number.isFinite(amount) || amount <= 0) return setProblem("Type the order amount.");
    setBusy(true); setProblem("");
    try {
      const order = await ordersApi.create({
        customer: form.customer.trim(), phone: form.phone.trim(), whatsapp: form.whatsapp.trim() || undefined, state: form.state.trim() || undefined,
        address: form.address.trim() || undefined, productId: product.id, packageId: pkg?.id, productName: product.name, packageName: pkg?.name,
        quantity: Math.max(1, Number(form.quantity) || 1), amount, currency: pkg?.currency === "ZMW" ? "ZMW" : "NGN", source: ORDER_SOURCE[lead.platform] ?? "Facebook",
        assignedRepId: lead.assignedTo ?? undefined, utmSource: lead.platform, utmCampaign: form.campaign || undefined, utmContent: lead.ref,
        sourceSocialLeadId: lead.id, response: form.note.trim() || undefined
      });
      onToast(order.already_existed ? `This lead already has order #${order.id}.` : `Order #${order.id} created. It is now in Orders.`);
      onDone(String(order.id));
    } catch (e) { setProblem((e as Error).message || "Could not create the order."); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Create Order" sub={`From ${lead.ref} · ${ORDER_SOURCE[lead.platform] ?? "Facebook"} social lead`} icon={ShoppingCart} onClose={onClose} width="max-w-[680px]"
      footer={<>
        <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
        <button type="button" onClick={submit} disabled={busy} className={btn.primary}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Create Order</button>
      </>}>
      <States />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label><Label>Customer name</Label><input className={field} value={form.customer} onChange={(e) => set("customer", e.target.value)} /></label>
        <label><Label>Phone number</Label><input className={field} inputMode="tel" value={form.phone} placeholder="0803 123 4567" onChange={(e) => set("phone", e.target.value)} /></label>
        <label><Label>WhatsApp (if different)</Label><input className={field} inputMode="tel" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></label>
        <label><Label>State</Label><input className={field} list="sl-states" value={form.state} onChange={(e) => set("state", e.target.value)} /></label>
        <label className="sm:col-span-2"><Label>Delivery address</Label><textarea rows={2} className={field} value={form.address} placeholder="House number, street, area, landmark" onChange={(e) => set("address", e.target.value)} /></label>
        <label><Label>Product</Label>
          <select className={field} value={productId} onChange={(e) => pickProduct(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label><Label>Package</Label>
          <select className={field} value={packageId} onChange={(e) => pickPackage(e.target.value)}>
            {(product?.packages ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} – {money(p.price, p.currency)}</option>)}
            {!product?.packages.length && <option value="">No package</option>}
          </select>
        </label>
        <label><Label>Quantity</Label><input className={field} type="number" min={1} value={form.quantity} onChange={(e) => set("quantity", Number(e.target.value))} /></label>
        <label><Label>Order amount</Label><input className={field} inputMode="numeric" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></label>
        <div><Label>Payment method</Label><div className={`${field} bg-gray-50 dark:bg-slate-800`}>Payment on Delivery</div></div>
        <div><Label>Order source</Label><div className={`${field} bg-gray-50 dark:bg-slate-800`}>{ORDER_SOURCE[lead.platform] ?? "Facebook"} Social Lead</div></div>
        <div><Label>Assigned rep</Label><div className={`${field} bg-gray-50 dark:bg-slate-800`}>{lead.assignedName || "You"}</div></div>
        <label><Label>Campaign</Label><input className={field} value={form.campaign} onChange={(e) => set("campaign", e.target.value)} /></label>
        <div><Label>Lead reference</Label><div className={`${field} bg-gray-50 font-semibold text-[#5B3FD9] dark:bg-slate-800`}>{lead.ref}</div></div>
        <label><Label>Note for the order (optional)</Label><input className={field} value={form.note} onChange={(e) => set("note", e.target.value)} /></label>
      </div>
      {problem && <p className="m-0 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{problem}</p>}
    </Modal>
  );
}

// ── Schedule follow-up ────────────────────────────────────────────────────

export function ScheduleModal({ leadIds, names, current, onClose, onDone, onToast }: { leadIds: string[]; names?: string; current?: { at: string | null; note: string | null }; onClose: () => void; onDone: () => void; onToast: (m: string) => void }) {
  const [at, setAt] = useState(current?.at ? toLocalInput(new Date(current.at)) : toLocalInput(nextMorning()));
  const [note, setNote] = useState(current?.note ?? "");
  const [busy, setBusy] = useState(false);
  const quick = [
    { label: "In 1 hour", at: () => new Date(Date.now() + 3_600_000) },
    { label: "This evening", at: () => { const d = new Date(Date.now() + 3_600_000); d.setUTCHours(16, 0, 0, 0); return new Date(d.getTime() - 3_600_000); } },
    { label: "Tomorrow 10am", at: nextMorning },
    { label: "In 3 days", at: () => { const d = nextMorning(); d.setUTCDate(d.getUTCDate() + 2); return d; } }
  ];
  const save = async () => {
    setBusy(true);
    try {
      if (leadIds.length === 1) await socialLeadsApi.update(leadIds[0], { nextFollowUpAt: fromLagosInput(at), followUpNote: note });
      else await socialLeadsApi.bulkFollowUp(leadIds, fromLagosInput(at), note);
      onToast(leadIds.length === 1 ? "Follow-up scheduled." : `${leadIds.length} follow-ups scheduled.`);
      onDone();
    } catch (e) { onToast((e as Error).message || "Could not schedule it."); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={leadIds.length > 1 ? `Schedule ${leadIds.length} follow-ups` : "Schedule Follow-up"} sub={names} icon={CalendarPlus} onClose={onClose}
      footer={<>
        {current?.at && leadIds.length === 1 && <button type="button" className={`${btn.ghost} mr-auto`} onClick={async () => { await socialLeadsApi.update(leadIds[0], { nextFollowUpAt: null }); onToast("Follow-up cleared."); onDone(); }}>Clear follow-up</button>}
        <button type="button" onClick={onClose} className={btn.ghost}>Cancel</button>
        <button type="button" onClick={save} disabled={busy || !at} className={btn.primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Schedule</button>
      </>}>
      <div className="flex flex-wrap gap-1.5">{quick.map((q) => <button key={q.label} type="button" onClick={() => setAt(toLocalInput(q.at()))} className="!min-h-0 rounded-full border border-gray-200 px-3 py-1 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200">{q.label}</button>)}</div>
      <label className="mt-3 block"><Label>Date and time (Lagos)</Label><input type="datetime-local" className={field} value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <label className="mt-3 block"><Label>Follow-up note</Label><textarea rows={3} className={field} value={note} placeholder="e.g. Wants to confirm delivery cost" onChange={(e) => setNote(e.target.value)} /></label>
      <p className="m-0 mt-2 text-[12px] text-gray-500">The rep gets an alert when it is due.</p>
    </Modal>
  );
}

// ── Transfer ──────────────────────────────────────────────────────────────

export function TransferModal({ leadIds, current, reps, onClose, onDone, onToast }: { leadIds: string[]; current?: string | null; reps: Shared["reps"]; onClose: () => void; onDone: () => void; onToast: (m: string) => void }) {
  const [repId, setRepId] = useState("");
  const [busy, setBusy] = useState(false);
  const list = reps.filter((r) => r.id !== current);
  const save = async () => {
    setBusy(true);
    try {
      if (leadIds.length === 1) await socialLeadsApi.transfer(leadIds[0], repId);
      else await socialLeadsApi.bulkLeads(leadIds, { repId });
      onToast(`Moved to ${reps.find((r) => r.id === repId)?.name ?? "the rep"}.`);
      onDone();
    } catch (e) { onToast((e as Error).message || "Could not move it."); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={leadIds.length > 1 ? `Transfer ${leadIds.length} leads` : "Transfer conversation"} sub="The customer stays with the new rep from now on." icon={ArrowLeftRight} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={!repId || busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Transfer</button></>}>
      <div className="space-y-1.5">
        {list.length === 0 && <p className="m-0 text-[13px] text-gray-500">No other active rep.</p>}
        {list.map((r) => (
          <label key={r.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 ${repId === r.id ? "border-[#5B3FD9] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
            <input type="radio" name="sl-rep" checked={repId === r.id} onChange={() => setRepId(r.id)} />
            <Avatar name={r.name} src={r.avatar} size={30} />
            <span className="min-w-0 flex-1"><b className="block text-[14px] text-gray-900 dark:text-slate-100">{r.name}</b><span className="text-[12px] text-gray-500">{r.role}{r.role === "Sales Rep" && !r.inRotation ? " · paused from hand-out" : ""}</span></span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

// ── Close lead ────────────────────────────────────────────────────────────

export const LOST_REASONS = ["Price too high", "Ordered elsewhere", "Not interested any more", "Delivery too far / too slow", "Does not trust paying online", "Wrong number / cannot reach", "Just asking, not buying", "Duplicate lead", "Other"];

export function CloseLeadModal({ leadIds, onClose, onDone, onToast }: { leadIds: string[]; onClose: () => void; onDone: () => void; onToast: (m: string) => void }) {
  const [reason, setReason] = useState(LOST_REASONS[0]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const lostReason = reason === "Other" ? other.trim() || "Other" : reason;
    setBusy(true);
    try {
      if (leadIds.length === 1) await socialLeadsApi.update(leadIds[0], { status: "lost", lostReason });
      else await socialLeadsApi.bulkLeads(leadIds, { status: "lost", lostReason });
      onToast(leadIds.length === 1 ? "Lead closed." : `${leadIds.length} leads closed.`);
      onDone();
    } catch (e) { onToast((e as Error).message || "Could not close it."); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={leadIds.length > 1 ? `Close ${leadIds.length} leads` : "Close Lead"} sub="Why did this customer not buy? It shows on Analytics." icon={XCircle} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} onClick={save} className={btn.primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Close Lead</button></>}>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {LOST_REASONS.map((r) => (
          <label key={r} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[13.5px] ${reason === r ? "border-[#5B3FD9] bg-[#F5F2FE] dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
            <input type="radio" name="sl-reason" checked={reason === r} onChange={() => setReason(r)} />{r}
          </label>
        ))}
      </div>
      {reason === "Other" && <input className={`${field} mt-2`} value={other} placeholder="Say why" onChange={(e) => setOther(e.target.value)} />}
    </Modal>
  );
}

// ── Edit contact ──────────────────────────────────────────────────────────

export function EditContactModal({ detail, onClose, onDone, onToast }: { detail: SlLeadDetail; onClose: () => void; onDone: () => void; onToast: (m: string) => void }) {
  const l = detail.lead;
  const [form, setForm] = useState({ name: l.name, phone: l.phone ?? "", whatsapp: l.whatsapp ?? "", state: l.state ?? "", address: l.address ?? "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await socialLeadsApi.update(l.id, form); onToast("Contact saved."); onDone(); }
    catch (e) { onToast((e as Error).message || "Could not save."); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal title="Contact Information" icon={PencilLine} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" onClick={save} disabled={busy} className={btn.primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save</button></>}>
      <States />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><Label>Name</Label><input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
        <label><Label>Phone</Label><input className={field} inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
        <label><Label>WhatsApp</Label><input className={field} inputMode="tel" value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></label>
        <label><Label>State</Label><input className={field} list="sl-states" value={form.state} onChange={(e) => set("state", e.target.value)} /></label>
        <label className="sm:col-span-2"><Label>Delivery address</Label><textarea rows={2} className={field} value={form.address} onChange={(e) => set("address", e.target.value)} /></label>
      </div>
    </Modal>
  );
}

// ── Add lead ──────────────────────────────────────────────────────────────

export function AddLeadModal({ shared, onClose, onDone }: { shared: Shared; onClose: () => void; onDone: (leadId: string) => void }) {
  const [form, setForm] = useState({ name: "", phone: "", state: "", platform: "facebook", productId: shared.products[0]?.id ?? "", note: "", campaign: "", assignTo: shared.leadership ? "" : "me" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const reps = useMemo(() => shared.reps.filter((r) => r.role === "Sales Rep"), [shared.reps]);
  const save = async () => {
    if (!form.name.trim()) return setProblem("Type the customer's name.");
    setBusy(true); setProblem("");
    try { const r = await socialLeadsApi.addLead(form); shared.onToast(`Lead ${r.lead.ref} added.`); onDone(r.lead.id); }
    catch (e) { setProblem((e as Error).message || "Could not add the lead."); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Add Lead" sub="Someone who called, or wrote on another page. Chatting needs ManyChat, so reach them by phone." icon={UserPlus} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" onClick={save} disabled={busy} className={btn.primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add Lead</button></>}>
      <States />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label><Label>Customer name</Label><input className={field} value={form.name} onChange={(e) => set("name", e.target.value)} /></label>
        <label><Label>Phone</Label><input className={field} inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} /></label>
        <label><Label>Source</Label><select className={field} value={form.platform} onChange={(e) => set("platform", e.target.value)}><option value="facebook">Facebook</option><option value="instagram">Instagram</option><option value="messenger">Messenger</option></select></label>
        <label><Label>State</Label><input className={field} list="sl-states" value={form.state} onChange={(e) => set("state", e.target.value)} /></label>
        <label><Label>Product interest</Label><select className={field} value={form.productId} onChange={(e) => set("productId", e.target.value)}>{shared.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label><Label>Campaign (optional)</Label><input className={field} value={form.campaign} onChange={(e) => set("campaign", e.target.value)} /></label>
        {shared.leadership && (
          <label className="sm:col-span-2"><Label>Assign to</Label>
            <select className={field} value={form.assignTo} onChange={(e) => set("assignTo", e.target.value)}>
              <option value="">Nobody yet</option><option value="me">Me</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        <label className="sm:col-span-2"><Label>What they said</Label><textarea rows={2} className={field} value={form.note} onChange={(e) => set("note", e.target.value)} /></label>
      </div>
      {problem && <p className="m-0 mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">{problem}</p>}
    </Modal>
  );
}

export function DoneFollowUpModal({ leadId, name, onClose, onDone, onToast }: { leadId: string; name: string; onClose: () => void; onDone: () => void; onToast: (m: string) => void }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Follow-up done" sub={name} icon={CheckCircle2} onClose={onClose}
      footer={<><button type="button" onClick={onClose} className={btn.ghost}>Cancel</button><button type="button" disabled={busy} className={btn.primary} onClick={async () => { setBusy(true); try { await socialLeadsApi.followUpDone(leadId, outcome); onToast("Follow-up marked done."); onDone(); } catch (e) { onToast((e as Error).message); } finally { setBusy(false); } }}>Mark done</button></>}>
      <label><Label>What happened? (optional)</Label><textarea rows={3} className={field} value={outcome} placeholder="e.g. Will order on Friday after payday" onChange={(e) => setOutcome(e.target.value)} /></label>
    </Modal>
  );
}
