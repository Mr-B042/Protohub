// The page a prospective Personal Delivery Agent fills in themselves.
//
// Reached by a shared link, with no login. It is deliberately plain and
// self-contained: the people using it are applying for work on a phone, often
// on a poor connection, and every extra step is someone lost.
import { useEffect, useRef, useState } from "react";
import { NIGERIA_STATES } from "./lib/nigeria";

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
  const [statusUrl, setStatusUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState("");
  // What was uploaded, shown back to them. Built from the picked file with
  // createObjectURL - the bucket is private, so nothing can be re-fetched, and
  // a 25MB data URL held in state would sink a cheap phone.
  const [previews, setPreviews] = useState<Record<string, { url: string; type: string; size: number }>>({});
  const previewsRef = useRef<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);

  useEffect(() => () => {
    for (const url of Object.values(previewsRef.current)) URL.revokeObjectURL(url);
  }, []);

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
      const previous = previewsRef.current[key];
      if (previous) URL.revokeObjectURL(previous);
      const url = URL.createObjectURL(file);
      previewsRef.current[key] = url;
      setPreviews((value) => ({ ...value, [key]: { url, type: file.type, size: file.size } }));
    } catch {
      setError("Could not upload that file. Please try again.");
    } finally { setUploading(""); }
  };

  // Everything this person must give us before a reviewer can do anything
  // useful. They will hold our stock and our customers' cash, so a half-filled
  // application is not a shortcut - it is a file that gets stuck and a person
  // who waits for a call that never comes.
  //
  // What is NOT required, on purpose: email and WhatsApp (plenty of applicants
  // have neither), gender, the back of an ID (a NIN slip and a passport have
  // no second side), and proof of address - a young agent renting a room
  // rarely has a bill in their own name, and the office can request it later
  // through their status link.
  const requiredFields: Array<{ key: string; label: string; ok: boolean }> = [
    { key: "fullName", label: "Full name", ok: Boolean(form.fullName.trim()) },
    { key: "phone", label: "Phone number", ok: Boolean(form.phone.trim()) },
    { key: "dateOfBirth", label: "Date of birth", ok: Boolean(form.dateOfBirth) },
    { key: "state", label: "State", ok: Boolean(form.state) },
    { key: "city", label: "City or town", ok: Boolean(form.city.trim()) },
    { key: "residentialAddress", label: "Home address", ok: Boolean(form.residentialAddress.trim()) },
    { key: "emergencyContactName", label: "Emergency contact name", ok: Boolean(form.emergencyContactName.trim()) },
    { key: "emergencyContactPhone", label: "Emergency contact phone", ok: Boolean(form.emergencyContactPhone.trim()) },
    { key: "idType", label: "ID type", ok: Boolean(form.idType) },
    { key: "idNumber", label: "ID number", ok: Boolean(form.idNumber.trim()) },
    { key: "idFront", label: "Photo of your ID", ok: Boolean(form.idFrontPath) },
    { key: "selfie", label: "Selfie holding your ID", ok: Boolean(form.selfiePath) },
    { key: "transportMethod", label: "How you move around", ok: Boolean(form.transportMethod) },
    { key: "serviceAreas", label: "Areas you can deliver to", ok: Boolean(form.serviceAreas.trim()) },
    { key: "bankName", label: "Bank", ok: Boolean(form.bankName.trim()) },
    { key: "bankAccountNumber", label: "Account number", ok: Boolean(form.bankAccountNumber.trim()) },
    { key: "bankAccountName", label: "Account name", ok: Boolean(form.bankAccountName.trim()) },
    // A plate is only meaningful for something that carries one.
    ...(["Motorcycle", "Car"].includes(form.transportMethod)
      ? [{ key: "vehiclePlate", label: "Plate number", ok: Boolean(form.vehiclePlate.trim()) }]
      : []),
    ...guarantors.flatMap((g, index) => [
      { key: `g${index}Name`, label: `Guarantor ${index + 1} full name`, ok: Boolean(g.fullName.trim()) },
      { key: `g${index}Phone`, label: `Guarantor ${index + 1} phone number`, ok: Boolean(g.phone.trim()) },
      { key: `g${index}Rel`, label: `Guarantor ${index + 1} - how you know them`, ok: Boolean(g.relationship.trim()) },
      { key: `g${index}Addr`, label: `Guarantor ${index + 1} address`, ok: Boolean(g.address.trim()) }
    ])
  ];
  const isMissing = (key: string) => missing.includes(key);

  const submit = async () => {
    setError("");
    const gaps = requiredFields.filter((field) => !field.ok);
    if (gaps.length > 0) {
      setMissing(gaps.map((field) => field.key));
      setError(gaps.length === 1
        ? `${gaps[0].label} is still needed.`
        : `${gaps.length} things are still needed, marked in red below.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Two relatives vouching for each other is not independent verification.
    // The reviewer's approval check refuses this pair anyway, so saying it here
    // saves the applicant from waiting on an application that cannot pass.
    if (guarantors.every((g) => g.guarantorType === "Family")) {
      setMissing(["g1Type"]);
      setError("Your second guarantor cannot also be family. Please give someone independent - an employer, landlord, colleague or community leader.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (guarantors[0].phone.replace(/\D/g, "") &&
        guarantors[0].phone.replace(/\D/g, "") === guarantors[1].phone.replace(/\D/g, "")) {
      setMissing(["g1Phone"]);
      setError("Both guarantors have the same phone number. Please give two different people.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!form.consent) { setError("Please confirm your details are true before submitting."); return; }
    setMissing([]);
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
          // Both guarantors are required now, so nothing is filtered out - a
          // dropped row would fail the server's minimum with a confusing
          // message about a guarantor the applicant thinks they entered.
          guarantors: guarantors.map((g) => ({
            fullName: g.fullName.trim(), relationship: g.relationship.trim(),
            guarantorType: g.guarantorType, phone: g.phone.trim(),
            whatsappPhone: g.whatsappPhone.trim() || undefined,
            address: g.address.trim(), occupation: g.occupation.trim() || undefined,
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
      if (body?.statusToken) {
        setStatusUrl(`${window.location.origin}${window.location.pathname}#/agent-application/status/${body.statusToken}`);
      }
      setState("done");
      window.scrollTo({ top: 0 });
    } catch {
      setError("Could not submit your application. Please try again.");
    } finally { setSaving(false); }
  };

  const label = "block text-[13px] font-semibold text-gray-700 mb-1.5";
  const baseInput = "w-full rounded-xl border bg-white px-3.5 py-2.5 text-[15px] outline-none";
  const input = `${baseInput} border-gray-200 focus:border-[#1F8FE0]`;
  // A red ring on the exact field that is missing, so "3 things are still
  // needed" does not become a hunt down a long form on a small screen.
  const fieldClass = (key: string) =>
    isMissing(key) ? `${baseInput} border-rose-400 bg-rose-50/40 focus:border-rose-500` : input;
  const card = "rounded-2xl border border-gray-200 bg-white p-5 shadow-sm";
  const req = <span className="text-rose-500">*</span>;
  const readableSize = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;

  const fileRow = (
    title: string, key: string, name: string,
    onDone: (path: string, fileName: string) => void,
    accept = "image/*,application/pdf",
    required = false
  ) => {
    const preview = previews[key];
    const wrong = required && isMissing(key);
    return (
      <div>
        <span className={label}>{title} {required && req}</span>
        {/* Show them what they actually sent. On a phone it is genuinely easy
            to attach the wrong photo, and nobody finds out until a reviewer
            rejects it days later. */}
        {name && (
          <div className={`mb-2 flex items-center gap-3 rounded-xl border p-2 ${wrong ? "border-rose-300 bg-rose-50/50" : "border-emerald-200 bg-emerald-50/60"}`}>
            {preview && preview.type.startsWith("image/") ? (
              <a href={preview.url} target="_blank" rel="noreferrer" className="shrink-0">
                <img src={preview.url} alt={`Preview of ${title}`}
                  className="h-16 w-16 rounded-lg border border-emerald-200 object-cover" />
              </a>
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-white text-2xl">📄</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[13px] font-bold text-gray-800">{name}</p>
              <p className="m-0 text-[11px] text-gray-500">
                {preview ? readableSize(preview.size) : "Uploaded"}
                {preview?.type.startsWith("image/") ? " · tap to view full size" : ""}
              </p>
              <p className="m-0 mt-0.5 text-[11px] font-bold text-emerald-700">✓ Uploaded</p>
            </div>
          </div>
        )}
        <label className={`flex cursor-pointer items-center justify-center rounded-xl px-4 py-3 text-[14px] font-bold ${
          name ? "bg-gray-100 text-gray-700" : wrong ? "bg-rose-50 text-rose-700 ring-1 ring-rose-300" : "bg-blue-50 text-[#1F8FE0]"}`}>
          {uploading === key ? "Uploading…" : name ? "Choose a different file" : "Choose file"}
          <input type="file" accept={accept} className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f, key, onDone); }} />
        </label>
        {!name && <p className="m-0 mt-1 text-[12px] text-gray-400">Photo or PDF, up to 25MB</p>}
      </div>
    );
  };

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

          {/* Their way back in. There is no password because they are not a
              user yet - this link IS the key, so it has to be impossible to
              miss on the one screen where they still have it. */}
          {statusUrl && (
            <div className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left">
              <p className="m-0 text-[13px] font-bold text-gray-900">Save this link</p>
              <p className="m-0 mt-1 text-[12px] leading-relaxed text-gray-600">
                It is how you check your progress and send anything else we ask for. There is no password —
                keep it private, and do not send it to anyone.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <input readOnly value={statusUrl} onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-[12px] text-gray-700" />
                <button type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(statusUrl)
                      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000); })
                      .catch(() => setCopied(false));
                  }}
                  className="shrink-0 rounded-lg bg-[#1F8FE0] px-3.5 py-2 text-[12px] font-bold text-white">
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <a href={statusUrl} className="mt-2.5 block text-center text-[13px] font-bold text-[#1F8FE0]">
                Open my application →
              </a>
            </div>
          )}

          <p className="m-0 mt-4 text-[12px] text-gray-400">
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
              <span className={label}>Full name, as written on your ID {req}</span>
              <input className={fieldClass("fullName")} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div><span className={label}>Phone number {req}</span>
              <input className={fieldClass("phone")} inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="0801 234 5678" /></div>
            <div><span className={label}>WhatsApp number</span>
              <input className={input} inputMode="tel" value={form.whatsappPhone} onChange={(e) => setForm({ ...form, whatsappPhone: e.target.value })} placeholder="Leave blank if same as above" /></div>
            <div><span className={label}>Email address</span>
              <input className={input} inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Optional" /></div>
            <div><span className={label}>Date of birth {req}</span>
              <input type="date" className={fieldClass("dateOfBirth")} value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} /></div>
            <div><span className={label}>Gender</span>
              <select className={input} value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                <option value="">Select</option>
                {["Male", "Female", "Prefer not to say"].map((g) => <option key={g} value={g}>{g}</option>)}
              </select></div>
            <div><span className={label}>State {req}</span>
              <select className={fieldClass("state")} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                <option value="">Select your state</option>
                {NIGERIA_STATES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select></div>
            <div><span className={label}>City / town {req}</span>
              <input className={fieldClass("city")} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="sm:col-span-2"><span className={label}>Home address {req}</span>
              <input className={fieldClass("residentialAddress")} value={form.residentialAddress} onChange={(e) => setForm({ ...form, residentialAddress: e.target.value })}
                placeholder="Street, area and any landmark" /></div>
            <div><span className={label}>Emergency contact name {req}</span>
              <input className={fieldClass("emergencyContactName")} value={form.emergencyContactName} onChange={(e) => setForm({ ...form, emergencyContactName: e.target.value })} /></div>
            <div><span className={label}>Emergency contact phone {req}</span>
              <input className={fieldClass("emergencyContactPhone")} inputMode="tel" value={form.emergencyContactPhone} onChange={(e) => setForm({ ...form, emergencyContactPhone: e.target.value })} /></div>
          </div>
        </section>

        <section className={card}>
          <h2 className="m-0 mb-1 text-[15px] font-bold text-gray-900">Your identification</h2>
          <p className="m-0 mb-4 text-[12px] text-gray-500">Your documents are stored privately and seen only by the team reviewing your application.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className={label}>ID type {req}</span>
              <select className={fieldClass("idType")} value={form.idType} onChange={(e) => setForm({ ...form, idType: e.target.value })}>
                <option value="">Select</option>
                {["NIN", "Driver's Licence", "Voter's Card", "International Passport"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><span className={label}>ID number {req}</span>
              <input className={fieldClass("idNumber")} value={form.idNumber} onChange={(e) => setForm({ ...form, idNumber: e.target.value })} /></div>
            {fileRow("Photo of your ID (front)", "idFront", form.idFrontName, (path, name) => setForm((f) => ({ ...f, idFrontPath: path, idFrontName: name })), "image/*,application/pdf", true)}
            {fileRow("Photo of your ID (back)", "idBack", form.idBackName, (path, name) => setForm((f) => ({ ...f, idBackPath: path, idBackName: name })))}
            {fileRow("Selfie holding your ID", "selfie", form.selfieName, (path, name) => setForm((f) => ({ ...f, selfiePath: path, selfieName: name })), "image/*", true)}
            {fileRow("Proof of address", "proof", form.proofOfAddressName, (path, name) => setForm((f) => ({ ...f, proofOfAddressPath: path, proofOfAddressName: name })))}
          </div>
        </section>

        <section className={card}>
          <h2 className="m-0 mb-4 text-[15px] font-bold text-gray-900">How you will deliver</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className={label}>How do you move around? {req}</span>
              <select className={fieldClass("transportMethod")} value={form.transportMethod} onChange={(e) => setForm({ ...form, transportMethod: e.target.value })}>
                <option value="">Select</option>
                {["Motorcycle", "Car", "Public transport", "Bicycle", "Walking", "Hired dispatch", "Other"].map((t) => <option key={t} value={t}>{t}</option>)}
              </select></div>
            <div><span className={label}>Vehicle {["Motorcycle", "Car"].includes(form.transportMethod) ? "" : "(if any)"}</span>
              <input className={input} value={form.vehicleModel} onChange={(e) => setForm({ ...form, vehicleModel: e.target.value })} placeholder="e.g. Bajaj Boxer" /></div>
            <div><span className={label}>Plate number {["Motorcycle", "Car"].includes(form.transportMethod) ? req : "(if any)"}</span>
              <input className={fieldClass("vehiclePlate")} value={form.vehiclePlate} onChange={(e) => setForm({ ...form, vehiclePlate: e.target.value })} placeholder="e.g. ABC 123 XY" /></div>
            <div><span className={label}>Areas you can deliver to {req}</span>
              <input className={fieldClass("serviceAreas")} value={form.serviceAreas} onChange={(e) => setForm({ ...form, serviceAreas: e.target.value })} placeholder="Owerri, Orlu, Mbaise" /></div>
          </div>
        </section>

        <section className={card}>
          <h2 className="m-0 mb-1 text-[15px] font-bold text-gray-900">Your bank account</h2>
          <p className="m-0 mb-4 text-[12px] text-gray-500">This is where your delivery earnings are paid. It is never used to take money.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><span className={label}>Bank {req}</span>
              <input className={fieldClass("bankName")} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></div>
            <div><span className={label}>Account number {req}</span>
              <input className={fieldClass("bankAccountNumber")} inputMode="numeric" value={form.bankAccountNumber} onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })} /></div>
            <div className="sm:col-span-2"><span className={label}>Account name {req}</span>
              <input className={fieldClass("bankAccountName")} value={form.bankAccountName} onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
                placeholder="Exactly as it appears on your bank app" /></div>
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
              <div><span className={label}>Full name {req}</span>
                <input className={fieldClass(`g${index}Name`)} value={g.fullName}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, fullName: e.target.value } : item))} /></div>
              <div><span className={label}>Phone number {req}</span>
                <input className={fieldClass(index === 1 && isMissing("g1Phone") ? "g1Phone" : `g${index}Phone`)} inputMode="tel" value={g.phone}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, phone: e.target.value } : item))} /></div>
              <div><span className={label}>How do you know them? {req}</span>
                <input className={fieldClass(`g${index}Rel`)} value={g.relationship} placeholder="Uncle, employer, landlord…"
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, relationship: e.target.value } : item))} /></div>
              {/* Stated by the applicant rather than assumed from the slot, so
                  the all-family pair can be caught before they submit. */}
              <div><span className={label}>Are they a relative? {req}</span>
                <select className={fieldClass(index === 1 && isMissing("g1Type") ? "g1Type" : `g${index}TypeOk`)} value={g.guarantorType}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, guarantorType: e.target.value } : item))}>
                  <option value="Family">Yes, a family member</option>
                  <option value="Independent">No, not family</option>
                </select></div>
              <div><span className={label}>Their occupation</span>
                <input className={input} value={g.occupation}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, occupation: e.target.value } : item))} /></div>
              <div><span className={label}>How long have they known you?</span>
                <input className={input} value={g.yearsKnown} placeholder="e.g. Over 10 years"
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, yearsKnown: e.target.value } : item))} /></div>
              <div className="sm:col-span-2"><span className={label}>Their address {req}</span>
                <input className={fieldClass(`g${index}Addr`)} value={g.address}
                  onChange={(e) => setGuarantors((list) => list.map((item, i) => i === index ? { ...item, address: e.target.value } : item))} /></div>
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

        {/* A named list of what is left, so nobody submits three times trying
            to guess which box the form is unhappy about. */}
        {missing.length > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
            <p className="m-0 text-[13px] font-bold text-rose-800">Still needed before you can submit</p>
            <ul className="m-0 mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-rose-700">
              {requiredFields.filter((field) => !field.ok).map((field) => <li key={field.key}>{field.label}</li>)}
            </ul>
          </div>
        )}

        <button type="button" disabled={saving || Boolean(uploading)} onClick={submit}
          className="w-full rounded-xl bg-[#1F8FE0] px-6 py-3.5 text-[15px] font-bold text-white disabled:opacity-60">
          {saving ? "Submitting…" : uploading ? "Wait for the upload to finish…" : "Submit application"}
        </button>
        <p className="m-0 text-center text-[12px] text-gray-400">
          Your application goes to {orgName} for review. Nothing is approved automatically.
        </p>
      </main>
    </div>
  );
}
