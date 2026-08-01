// The page a prospective Personal Delivery Agent fills in themselves.
//
// Reached by a shared link, with no login. It is deliberately plain and
// self-contained: the people using it are applying for work on a phone, often
// on a poor connection, and every extra step is someone lost.
import { useEffect, useState } from "react";

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "";

type Guarantor = {
  fullName: string; relationship: string; guarantorType: string; phone: string;
  whatsappPhone: string; address: string; occupation: string; yearsKnown: string;
  referenceStatement: string; idDocumentPath: string; idDocumentName: string;
};

const blankGuarantor = (guarantorType: string): Guarantor => ({
  fullName: "", relationship: "", guarantorType, phone: "", whatsappPhone: "",
  address: "", occupation: "", yearsKnown: "", referenceStatement: "",
  idDocumentPath: "", idDocumentName: ""
});

export default function PublicAgentApplicationPage() {
  const token = (window.location.hash.split("/")[2] ?? "").trim();
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "done">("loading");
  const [orgName, setOrgName] = useState("Protohub");
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");

  const [form, setForm] = useState({
    fullName: "", phone: "", whatsappPhone: "", email: "", dateOfBirth: "", gender: "",
    state: "", city: "", residentialAddress: "",
    emergencyContactName: "", emergencyContactPhone: "",
    idType: "", idNumber: "",
    idFrontPath: "", idFrontName: "", idBackPath: "", idBackName: "",
    selfiePath: "", selfieName: "", proofOfAddressPath: "", proofOfAddressName: "",
    transportMethod: "", vehicleModel: "", vehiclePlate: "", serviceAreas: "",
    bankName: "", bankAccountNumber: "", bankAccountName: "",
    consent: false
  });
  const [guarantors, setGuarantors] = useState<Guarantor[]>([
    blankGuarantor("Family"), blankGuarantor("Independent")
  ]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/public/agent-application/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) { setError(body?.error ?? "This application link is not valid."); setState("invalid"); return; }
        setOrgName(body?.orgName ?? "Protohub");
        setState("ready");
      })
      .catch(() => { if (!cancelled) { setError("Could not open this link. Check your connection."); setState("invalid"); } });
    return () => { cancelled = true; };
  }, [token]);

  const upload = async (file: File, key: string, onDone: (path: string, name: string) => void) => {
    if (file.size > 25 * 1024 * 1024) { setError("That file is larger than 25MB."); return; }
    setUploading(key);
    setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${API_BASE}/api/public/agent-application/${encodeURIComponent(token)}/upload`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error ?? "Could not upload that file."); return; }
      onDone(body.path, file.name);
    } catch {
      setError("Could not upload that file. Please try again.");
    } finally { setUploading(""); }
  };

  const submit = async () => {
    setError("");
    if (!form.fullName.trim() || !form.phone.trim()) { setError("Your name and phone number are required."); return; }
    if (!form.consent) { setError("Please confirm your details are true before submitting."); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/public/agent-application/${encodeURIComponent(token)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          serviceAreas: form.serviceAreas.trim()
            ? form.serviceAreas.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
          gender: form.gender || undefined,
          idType: form.idType || undefined,
          transportMethod: form.transportMethod || undefined,
          guarantors: guarantors
            .filter((g) => g.fullName.trim() && g.phone.trim())
            .map((g) => ({
              fullName: g.fullName.trim(), relationship: g.relationship.trim() || undefined,
              guarantorType: g.guarantorType || undefined, phone: g.phone.trim(),
              whatsappPhone: g.whatsappPhone.trim() || undefined,
              address: g.address.trim() || undefined, occupation: g.occupation.trim() || undefined,
              yearsKnown: g.yearsKnown.trim() || undefined,
              referenceStatement: g.referenceStatement.trim() || undefined,
              idDocumentPath: g.idDocumentPath || undefined
            })),
          consent: true
        })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error ?? "Could not submit your application."); return; }
      setReference(body?.reference ?? "");
      setState("done");
      window.scrollTo({ top: 0 });
    } catch {
      setError("Could not submit your application. Please try again.");
    } finally { setSaving(false); }
  };

  const label = "block text-[13px] font-semibold text-gray-700 mb-1.5";
  const input = "w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-[15px] outline-none focus:border-[#1F8FE0]";
  const card = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm";

  const fileRow = (title: string, key: string, name: string, onDone: (path: string, fileName: string) => void, accept = "image/*,application/pdf") => (
    <div>
      <span className={label}>{title}</span>
      <label className={`flex cursor-pointer items-center justify-center rounded-xl px-4 py-3 text-[14px] font-bold ${name ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-[#1F8FE0]"}`}>
        {uploading === key ? "Uploading…" : name ? "Replace file" : "Choose file"}
        <input type="file" accept={accept} className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, key, onDone); }} />
      </label>
      <p className="m-0 mt-1 text-[12px] text-gray-400">{name || "Photo or PDF, up to 25MB"}</p>
    </div>
  );

  if (state === "loading") {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 text-sm text-gray-500">Opening the form…</div>;
  }

  if (state === "invalid") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-5">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="m-0 text-lg font-bold text-gray-900">This link cannot be used</h1>
          <p className="m-0 mt-2 text-sm text-gray-600">{error}</p>
          <p className="m-0 mt-3 text-[12px] text-gray-400">Ask whoever sent it to you for a current link.</p>
        </div>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-5">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-7 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-2xl">✓</div>
          <h1 className="m-0 mt-4 text-xl font-bold text-gray-900">Application received</h1>
          {reference && <p className="m-0 mt-1 font-mono text-[13px] font-bold text-gray-500">{reference}</p>}
          <p className="m-0 mt-3 text-sm leading-relaxed text-gray-600">
            {orgName} will review your documents and call your guarantors. You will be contacted about the next steps.
          </p>
          <p className="m-0 mt-3 text-[12px] text-gray-400">
            You will not receive stock or orders until every check has been approved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-50 pb-16">
      <header className="border-b border-gray-200 bg-white px-5 py-5">
        <div className="mx-auto max-w-2xl">
          <h1 className="m-0 text-xl font-bold text-gray-900">Become a {orgName} Delivery Agent</h1>
          <p className="m-0 mt-1 text-[13px] text-gray-500">
            Fill in your details below. Your application is reviewed before you are approved — you will not hold any stock or money until then.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-5 py-5">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">{error}</div>
        )}

        <section className={card}>
          <h2 className="m-0 mb-4 text-[15px] font-bold text-gray-900">About you</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <span className={label}>Full name, as written on your ID *</span>
              <input className={input} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div><span className={label}>Phone number *</span>
              <input className={input} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0801 234 5678" /></div>
            <div><span className={label}>WhatsApp number</span>
              <input className={input} inputMode="tel" value={form.whatsappPhone} onChange={(e) => setForm({ ...form, whatsappPhone: e.target.value })} /></div>
            <div><span className={label}>Email address</span>
              <input className={input} inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><span className={label}>Date of birth</span>
              <input type="date" className={input} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></div>
            <div><span className={label}>Gender</span>
              <select className={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select</option>
                {["Male", "Female", "Prefer not to say"].map((g) => <option key={g} value={g}>{g}</option>)}
              </select></div>
            <div><span className={label}>State</span>
              <input className={input} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
            <div><span className={label}>City / town</span>
              <input className={input} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="sm:col-span-2"><span className={label}>Home address</span>
              <input className={input} value={form.residentialAddress} onChange={(e) => setForm({ ...form, residentialAddress: e.target.value })} /></div>
            <div><span className={label}>Emergency contact name</span>
              <input className={input} value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} /></div>
            <div><span className={label}>Emergency contact phone</span>
              <input className={input} inputMode="tel" value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} /></div>
          </div>
        </section>

        <section className={card}>
          <h2 className="m-0 mb-1 text-[15px] font-bold text-gray-900">Your identification</h2>
          <p className="m-0 mb-4 text-[12px] text-gray-500">Your documents are stored privately and seen only by the team reviewing your application.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className={label}>ID type</span>
              <select className={input} value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })}>
                <option value="">Select</option>
                {["NIN", "Driver's Licence", "Voter's Card", "International Passport"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><span className={label}>ID number</span>
              <input className={input} value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} /></div>
            {fileRow("Photo of your ID (front)", "idFront", form.idFrontName, (path, name) => setForm((f) => ({ ...f, idFrontPath: path, idFrontName: name })))}
            {fileRow("Photo of your ID (back)", "idBack", form.idBackName, (path, name) => setForm((f) => ({ ...f, idBackPath: path, idBackName: name })))}
            {fileRow("Selfie holding your ID", "selfie", form.selfieName, (path, name) => setForm((f) => ({ ...f, selfiePath: path, selfieName: name })), "image/*")}
            {fileRow("Proof of address", "proof", form.proofOfAddressName, (path, name) => setForm((f) => ({ ...f, proofOfAddressPath: path, proofOfAddressName: name })))}
          </div>
        </section>

        <section className={card}>
          <h2 className="m-0 mb-4 text-[15px] font-bold text-gray-900">How you will deliver</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className={label}>How do you move around?</span>
              <select className={input} value={form.transportMethod} onChange={(e) => setForm({ ...form, transportMethod: e.target.value })}>
                <option value="">Select</option>
                {["Motorcycle", "Car", "Public transport", "Bicycle", "Walking", "Hired dispatch", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><span className={label}>Vehicle (if any)</span>
              <input className={input} value={form.vehicleModel} onChange={(e) => setForm({ ...form, vehicleModel: e.target.value })} placeholder="e.g. Bajaj Boxer" /></div>
            <div><span className={label}>Plate number (if any)</span>
              <input className={input} value={form.vehiclePlate} onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })} placeholder="e.g. ABC 123 XY" /></div>
            <div><span className={label}>Areas you can deliver to</span>
              <input className={input} value={form.serviceAreas} onChange={(e) => setForm({ ...form, serviceAreas: e.target.value })} placeholder="Owerri, Orlu, Mbaise" /></div>
          </div>
        </section>

        <section className={card}>
          <h2 className="m-0 mb-1 text-[15px] font-bold text-gray-900">Your bank account</h2>
          <p className="m-0 mb-4 text-[12px] text-gray-500">This is where your delivery earnings are paid. It is never used to take money.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className={label}>Bank</span>
              <input className={input} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
            <div><span className={label}>Account number</span>
              <input className={input} inputMode="numeric" value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} /></div>
            <div className="sm:col-span-2"><span className={label}>Account name</span>
              <input className={input} value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })} /></div>
          </div>
        </section>

        <section className={card}>
          <h2 className="m-0 mb-1 text-[15px] font-bold text-gray-900">Your guarantors</h2>
          <p className="m-0 mb-4 text-[12px] leading-relaxed text-gray-500">
            Two people who will vouch for you. One can be family; <strong>the other should not be</strong> — a colleague, employer, landlord or community leader.
            We will call both of them, so please tell them to expect it.
          </p>
          {guarantors.map((g, index) => (
            <div key={index} className={`grid gap-4 sm:grid-cols-2 ${index > 0 ? "mt-5 border-t border-gray-100 pt-5" : ""}`}>
              <p className="m-0 text-[13px] font-bold text-gray-800 sm:col-span-2">
                Guarantor {index + 1} {index === 0 ? "(can be family)" : "(should not be family)"}
              </p>
              <div><span className={label}>Full name</span>
                <input className={input} value={g.fullName}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, fullName: e.target.value } : item))} /></div>
              <div><span className={label}>Phone number</span>
                <input className={input} inputMode="tel" value={g.phone}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, phone: e.target.value } : item))} /></div>
              <div><span className={label}>How do you know them?</span>
                <input className={input} value={g.relationship} placeholder="Uncle, employer, landlord…"
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, relationship: e.target.value } : item))} /></div>
              <div><span className={label}>Their occupation</span>
                <input className={input} value={g.occupation}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, occupation: e.target.value } : item))} /></div>
              <div className="sm:col-span-2"><span className={label}>Their address</span>
                <input className={input} value={g.address}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, address: e.target.value } : item))} /></div>
              <div className="sm:col-span-2"><span className={label}>How long have they known you?</span>
                <input className={input} value={g.yearsKnown} placeholder="e.g. Over 10 years"
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, yearsKnown: e.target.value } : item))} /></div>
            </div>
          ))}
        </section>

        <section className={card}>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={form.consent}
              onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
            <span className="text-[13px] leading-relaxed text-gray-700">
              Everything I have entered is true. I understand {orgName} will verify my documents and call my guarantors,
              and that I will hold company stock and customer money only after I am approved.
            </span>
          </label>
        </section>

        <button type="button" disabled={saving || Boolean(uploading)} onClick={submit}
          className="w-full rounded-xl bg-[#1F8FE0] px-6 py-3.5 text-[15px] font-bold text-white disabled:opacity-60">
          {saving ? "Submitting…" : "Submit application"}
        </button>
        <p className="m-0 text-center text-[12px] text-gray-400">
          Your application goes to {orgName} for review. Nothing is approved automatically.
        </p>
      </main>
    </div>
  );
}
