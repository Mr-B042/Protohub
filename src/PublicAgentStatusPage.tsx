// Where an applicant checks on their own application and sends what is still
// missing.
//
// Reached by a private token, not a login. An applicant is not a user of the
// system - they become one only once a manager approves them and grants access.
// A password here would mean real accounts for unapproved strangers, and reset
// requests to support, in exchange for nothing this link does not already do.
//
// Nothing on this page reveals anything about the business: no other
// applicants, no reviewer names, no internal notes. Only their own file.
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileSignature, Scale, ShieldCheck, X } from "lucide-react";

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "";

type Item = {
  key: string; label: string; status: string; mandatory: boolean;
  note: string | null; canUpload: boolean;
};
type AgreementSection = { heading: string; paragraphs: string[]; bullets?: string[] };
type AgreementContent = {
  key: string; title: string; shortTitle: string; purpose: string;
  summary: string[]; sections: AgreementSection[];
  version: string; companyName: string; applicantName: string;
  reference: string; issuedOn: string; opening: string;
  declaration: string; governingLaw: string; contentHash: string;
};
type Agreement = {
  id: string; key: string; label: string; version: string; status: string;
  rejectionReason: string | null; canAccept: boolean;
  acceptedAt: string | null; signedName: string | null;
  content: AgreementContent;
};
type StatusPayload = {
  orgName: string; reference: string; fullName: string; submittedAt: string;
  stage: { label: string; tone: string; detail: string };
  reason: string | null;
  items: Item[];
  agreements: Agreement[];
  guarantors: Array<{ slot: number; fullName: string; status: string }>;
};

const TONE: Record<string, { ring: string; chip: string }> = {
  good:   { ring: "border-emerald-200 bg-emerald-50", chip: "bg-emerald-100 text-emerald-800" },
  review: { ring: "border-sky-200 bg-sky-50", chip: "bg-sky-100 text-sky-800" },
  action: { ring: "border-amber-200 bg-amber-50", chip: "bg-amber-100 text-amber-800" },
  bad:    { ring: "border-rose-200 bg-rose-50", chip: "bg-rose-100 text-rose-800" }
};

// The applicant's words for each document state, not the reviewer's.
const ITEM_STATE: Record<string, { text: string; cls: string }> = {
  Approved: { text: "Approved", cls: "bg-emerald-100 text-emerald-700" },
  Submitted: { text: "With us, being checked", cls: "bg-sky-100 text-sky-700" },
  Pending: { text: "Still needed", cls: "bg-amber-100 text-amber-800" },
  Rejected: { text: "Please send again", cls: "bg-rose-100 text-rose-700" },
  "Replacement Requested": { text: "Please send again", cls: "bg-rose-100 text-rose-700" },
  "Not Applicable": { text: "Not needed", cls: "bg-gray-100 text-gray-500" }
};

const AGREEMENT_STATE: Record<string, { text: string; cls: string }> = {
  Approved: { text: "Approved", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  "Electronically Accepted": { text: "Accepted - under review", cls: "border-sky-200 bg-sky-50 text-sky-800" },
  "Awaiting Acceptance": { text: "Signature required", cls: "border-amber-200 bg-amber-50 text-amber-900" },
  Uploaded: { text: "With us, being checked", cls: "border-sky-200 bg-sky-50 text-sky-800" },
  Rejected: { text: "Please accept again", cls: "border-rose-200 bg-rose-50 text-rose-800" },
  "Replacement Requested": { text: "Please accept again", cls: "border-rose-200 bg-rose-50 text-rose-800" }
};

export default function PublicAgentStatusPage() {
  // #/agent-application/status/<token>
  const token = (window.location.hash.split("/")[3] ?? "").trim();
  const [view, setView] = useState<"loading" | "ready" | "invalid">("loading");
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState("");
  const [justSent, setJustSent] = useState<string[]>([]);
  const [selectedAgreement, setSelectedAgreement] = useState<Agreement | null>(null);
  const [agreementDraft, setAgreementDraft] = useState({ typedName: "", confirmedRead: false, agreed: false });
  const [acceptingAgreement, setAcceptingAgreement] = useState(false);
  const previews = useRef<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => () => {
    for (const url of Object.values(previews.current)) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    if (!selectedAgreement) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [selectedAgreement]);

  const load = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/public/agent-application/status/${encodeURIComponent(token)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error ?? "This status link is not valid."); setView("invalid"); return; }
      setData(body);
      setView("ready");
    } catch {
      setError("Could not open this link. Check your connection.");
      setView("invalid");
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const sendItem = async (item: Item, file: File) => {
    if (file.size > 25 * 1024 * 1024) { setError("That file is larger than 25MB."); return; }
    setUploading(item.key);
    setError("");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const res = await fetch(
        `${API_BASE}/api/public/agent-application/status/${encodeURIComponent(token)}/items/${encodeURIComponent(item.key)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataUrl }) }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error ?? "Could not send that file."); return; }
      // Show them what they just sent, same as the application form.
      if (file.type.startsWith("image/")) {
        const previous = previews.current[item.key];
        if (previous) URL.revokeObjectURL(previous);
        const url = URL.createObjectURL(file);
        previews.current[item.key] = url;
        setThumbs((value) => ({ ...value, [item.key]: url }));
      }
      setJustSent((list) => [...list, item.key]);
      await load();
    } catch {
      setError("Could not send that file. Please try again.");
    } finally { setUploading(""); }
  };

  const openAgreement = (agreement: Agreement) => {
    setError("");
    setAgreementDraft({
      typedName: agreement.canAccept ? "" : agreement.signedName ?? "",
      confirmedRead: false,
      agreed: false
    });
    setSelectedAgreement(agreement);
  };

  const acceptAgreement = async () => {
    if (!selectedAgreement) return;
    setAcceptingAgreement(true);
    setError("");
    try {
      const res = await fetch(
        `${API_BASE}/api/public/agent-application/status/${encodeURIComponent(token)}/agreements/${encodeURIComponent(selectedAgreement.key)}/accept`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: selectedAgreement.content.version,
            contentHash: selectedAgreement.content.contentHash,
            typedName: agreementDraft.typedName,
            confirmedRead: agreementDraft.confirmedRead,
            agreed: agreementDraft.agreed
          })
        }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body?.error ?? "Could not record your acceptance."); return; }
      setSelectedAgreement(null);
      await load();
    } catch {
      setError("Could not record your acceptance. Check your connection and try again.");
    } finally { setAcceptingAgreement(false); }
  };

  if (view === "loading") {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 text-sm text-gray-500">Checking your application…</div>;
  }

  if (view === "invalid" || !data) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-5">
        <div className="max-w-sm rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          <h1 className="m-0 text-lg font-bold text-gray-900">This link cannot be opened</h1>
          <p className="m-0 mt-2 text-sm text-gray-600">{error}</p>
          <p className="m-0 mt-3 text-[12px] text-gray-400">Check the link you saved, or contact the office.</p>
        </div>
      </div>
    );
  }

  const tone = TONE[data.stage.tone] ?? TONE.review;
  const outstandingDocuments = data.items.filter((item) => item.canUpload && item.mandatory);
  const outstandingAgreements = (data.agreements ?? []).filter((agreement) => agreement.canAccept);
  const outstandingCount = outstandingDocuments.length + outstandingAgreements.length;

  return (
    <div className="min-h-[100dvh] bg-gray-50 pb-16">
      <header className="border-b border-gray-200 bg-white px-5 py-5">
        <div className="mx-auto max-w-2xl">
          <h1 className="m-0 text-xl font-bold text-gray-900">Your {data.orgName} application</h1>
          <p className="m-0 mt-1 text-[13px] text-gray-500">
            {data.fullName} · <span className="font-mono">{data.reference}</span>
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-5 py-5">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">{error}</div>
        )}

        <section className={`rounded-2xl border p-5 ${tone.ring}`}>
          <span className={`inline-flex rounded-full px-3 py-1 text-[12px] font-black uppercase tracking-wide ${tone.chip}`}>
            {data.stage.label}
          </span>
          <p className="m-0 mt-3 text-[14px] leading-relaxed text-gray-700">{data.stage.detail}</p>
          {/* Only rendered when a reason was actually written - an empty one
              must not appear as a blank accusation. */}
          {data.reason && (
            <p className="m-0 mt-2 rounded-xl bg-white/70 px-3 py-2 text-[13px] text-gray-700">{data.reason}</p>
          )}
          <p className="m-0 mt-3 text-[12px] text-gray-500">
            Applied {new Date(data.submittedAt).toLocaleDateString([], { dateStyle: "medium" })}
          </p>
        </section>

        {outstandingCount > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="m-0 text-[13px] font-bold text-amber-900">
              {outstandingCount} {outstandingCount === 1 ? "thing is" : "things are"} still needed from you
            </p>
            <p className="m-0 mt-0.5 text-[12px] text-amber-800">
              Send them below. Your application waits until they arrive.
            </p>
          </div>
        )}

        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="m-0 mb-4 text-[15px] font-bold text-gray-900">Your documents</h2>
          <div className="space-y-3">
            {data.items.map((item) => {
              const state = ITEM_STATE[item.status] ?? { text: item.status, cls: "bg-gray-100 text-gray-600" };
              const sent = justSent.includes(item.key);
              return (
                <div key={item.key} className="rounded-xl border border-gray-100 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[14px] font-semibold text-gray-800">
                      {item.label}{!item.mandatory && <span className="ml-1 text-[12px] font-normal text-gray-400">(optional)</span>}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${state.cls}`}>{state.text}</span>
                  </div>
                  {item.note && (
                    <p className="m-0 mt-1.5 text-[12px] text-rose-700">{item.note}</p>
                  )}
                  {thumbs[item.key] && (
                    <img src={thumbs[item.key]} alt={`What you sent for ${item.label}`}
                      className="mt-2 h-16 w-16 rounded-lg border border-emerald-200 object-cover" />
                  )}
                  {sent && <p className="m-0 mt-1.5 text-[12px] font-bold text-emerald-700">✓ Sent. We will check it.</p>}
                  {item.canUpload && (
                    <label className="mt-2 flex cursor-pointer items-center justify-center rounded-xl bg-blue-50 px-4 py-2.5 text-[13px] font-bold text-[#1F8FE0]">
                      {uploading === item.key ? "Sending…" : item.status === "Pending" ? "Send this" : "Send a new one"}
                      <input type="file" accept="image/*,application/pdf,video/*" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendItem(item, f); }} />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {(data.agreements ?? []).length > 0 && (
          <section className="overflow-hidden rounded-lg border border-[#D8C18B] bg-white shadow-sm">
            <div className="border-b border-[#E7D9B5] bg-[#111827] px-5 py-4 text-white">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#C9A54A] bg-[#201E18] text-[#E7C86A]">
                  <Scale className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="m-0 text-[15px] font-bold">Official agreements</h2>
                  <p className="m-0 mt-0.5 text-[12px] text-gray-300">Read every document carefully before signing.</p>
                </div>
              </div>
            </div>
            <div className="space-y-3 p-4">
              {(data.agreements ?? []).map((agreement, index) => {
                const state = AGREEMENT_STATE[agreement.status] ?? { text: agreement.status, cls: "border-gray-200 bg-gray-50 text-gray-700" };
                return (
                  <article key={agreement.id} className="rounded-lg border border-[#E7D9B5] bg-[#FFFCF4] p-4">
                    <div className="flex items-start gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#F4E8C5] text-[12px] font-black text-[#7A5A13]">{index + 10}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <h3 className="m-0 text-[14px] font-bold text-gray-950">{agreement.label}</h3>
                          <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase ${state.cls}`}>{state.text}</span>
                        </div>
                        <p className="m-0 mt-1 text-[12px] leading-relaxed text-gray-600">{agreement.content.purpose}</p>
                        {agreement.rejectionReason && <p className="m-0 mt-2 text-[12px] font-semibold text-rose-700">Update requested: {agreement.rejectionReason}</p>}
                        {agreement.acceptedAt && (
                          <p className="m-0 mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Signed by {agreement.signedName} on {new Date(agreement.acceptedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                          </p>
                        )}
                        <button type="button" onClick={() => openAgreement(agreement)}
                          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-[#B89132] bg-white px-3 py-2 text-[12px] font-black text-[#6D5010] hover:bg-[#FFF7DF]">
                          <FileSignature className="h-4 w-4" /> {agreement.canAccept ? "Read and agree" : "View agreement"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
              <p className="m-0 text-[11px] leading-relaxed text-gray-500">
                Your typed name, the agreement version, exact document hash, date, time and technical audit details are recorded. Management reviews each acceptance before approving your application.
              </p>
            </div>
          </section>
        )}

        {data.guarantors.length > 0 && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="m-0 mb-1 text-[15px] font-bold text-gray-900">Your guarantors</h2>
            <p className="m-0 mb-3 text-[12px] text-gray-500">
              Please tell them to expect our call — we cannot finish without speaking to both.
            </p>
            <div className="space-y-2">
              {data.guarantors.map((g) => (
                <div key={g.slot} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2">
                  <span className="text-[14px] font-semibold text-gray-800">{g.fullName}</span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-bold text-gray-600">{g.status}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="m-0 text-center text-[12px] text-gray-400">
          Save this page. It is the only link to your application, and it does not need a password.
        </p>
      </main>

      {selectedAgreement && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={selectedAgreement.label}>
          <div className="flex max-h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-lg border border-[#C9A54A] bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-lg">
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#C9A54A] bg-[#111827] px-5 py-4 text-white">
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#C9A54A] text-[#E7C86A]"><ShieldCheck className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-[10px] font-black uppercase tracking-widest text-[#E7C86A]">Official applicant agreement</p>
                  <h2 className="m-0 mt-1 text-[16px] font-bold leading-tight">{selectedAgreement.content.title}</h2>
                  <p className="m-0 mt-1 text-[11px] text-gray-300">Version {selectedAgreement.content.version} · {selectedAgreement.content.reference}</p>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedAgreement(null)} aria-label="Close agreement"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/20 text-white hover:bg-white/10"><X className="h-5 w-5" /></button>
            </header>

            <div className="overflow-y-auto px-5 py-5 sm:px-7">
              <div className="grid gap-2 rounded-lg border border-[#E7D9B5] bg-[#FFFCF4] p-4 text-[12px] sm:grid-cols-2">
                <div><span className="block text-[10px] font-black uppercase text-[#8B6A1D]">Company</span><strong>{selectedAgreement.content.companyName}</strong></div>
                <div><span className="block text-[10px] font-black uppercase text-[#8B6A1D]">Applicant</span><strong>{selectedAgreement.content.applicantName}</strong></div>
                <div><span className="block text-[10px] font-black uppercase text-[#8B6A1D]">Application reference</span><strong>{selectedAgreement.content.reference}</strong></div>
                <div><span className="block text-[10px] font-black uppercase text-[#8B6A1D]">Issued</span><strong>{new Date(`${selectedAgreement.content.issuedOn}T00:00:00`).toLocaleDateString([], { dateStyle: "long" })}</strong></div>
              </div>

              <p className="m-0 mt-5 text-[13px] leading-relaxed text-gray-700">{selectedAgreement.content.opening}</p>

              <section className="mt-5 rounded-lg border border-[#D7BA68] bg-[#FFF8E5] p-4">
                <h3 className="m-0 text-[13px] font-black text-[#5F450B]">What you are agreeing to</h3>
                <ul className="m-0 mt-2 space-y-2 pl-5 text-[12px] leading-relaxed text-gray-700">
                  {selectedAgreement.content.summary.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </section>

              <div className="mt-6 space-y-6">
                {selectedAgreement.content.sections.map((section) => (
                  <section key={section.heading}>
                    <h3 className="m-0 border-b border-gray-200 pb-2 text-[13px] font-black text-gray-950">{section.heading}</h3>
                    {section.paragraphs.map((paragraph) => <p key={paragraph} className="m-0 mt-2 text-[12px] leading-6 text-gray-700">{paragraph}</p>)}
                    {section.bullets && <ul className="m-0 mt-2 space-y-1 pl-5 text-[12px] leading-6 text-gray-700">{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
                  </section>
                ))}
              </div>

              <section className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-[12px] leading-6 text-gray-700">
                <p className="m-0 font-bold text-gray-950">Governing law and common terms</p>
                <p className="m-0 mt-1">{selectedAgreement.content.governingLaw}</p>
                {selectedAgreement.key === "confidentiality_agreement" && (
                  <a href="https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf" target="_blank" rel="noreferrer"
                    className="mt-2 inline-flex font-bold text-[#1F6FB2] underline">Read the Nigeria Data Protection Act 2023</a>
                )}
              </section>

              {selectedAgreement.canAccept ? (
                <section className="mt-6 rounded-lg border-2 border-[#C9A54A] bg-[#FFFCF4] p-4">
                  <p className="m-0 text-[12px] font-bold leading-relaxed text-gray-900">{selectedAgreement.content.declaration}</p>
                  {error && (
                    <p role="alert" className="m-0 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-800">
                      {error}
                    </p>
                  )}
                  <label className="mt-4 flex cursor-pointer items-start gap-3 text-[12px] leading-relaxed text-gray-700">
                    <input type="checkbox" checked={agreementDraft.confirmedRead} onChange={(event) => setAgreementDraft((value) => ({ ...value, confirmedRead: event.target.checked }))} className="mt-0.5 h-4 w-4 shrink-0 accent-[#9B741D]" />
                    <span>I have read the complete agreement, including the duties, restrictions and possible consequences.</span>
                  </label>
                  <label className="mt-3 flex cursor-pointer items-start gap-3 text-[12px] leading-relaxed text-gray-700">
                    <input type="checkbox" checked={agreementDraft.agreed} onChange={(event) => setAgreementDraft((value) => ({ ...value, agreed: event.target.checked }))} className="mt-0.5 h-4 w-4 shrink-0 accent-[#9B741D]" />
                    <span>I voluntarily agree to these terms and understand that typing my full name is my electronic signature.</span>
                  </label>
                  <label className="mt-4 block text-[11px] font-black uppercase text-gray-600">
                    Type your full name exactly as shown
                    <input value={agreementDraft.typedName} onChange={(event) => setAgreementDraft((value) => ({ ...value, typedName: event.target.value }))}
                      autoComplete="name" placeholder={selectedAgreement.content.applicantName}
                      className="mt-1.5 min-h-11 w-full rounded-lg border border-[#C9A54A] bg-white px-3 text-[14px] font-semibold normal-case text-gray-950 outline-none focus:ring-2 focus:ring-[#D8B85A]" />
                  </label>
                  <button type="button" disabled={acceptingAgreement || !agreementDraft.confirmedRead || !agreementDraft.agreed || !agreementDraft.typedName.trim()}
                    onClick={() => void acceptAgreement()}
                    className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#111827] px-4 text-[13px] font-black text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
                    <FileSignature className="h-4 w-4" /> {acceptingAgreement ? "Recording acceptance..." : "Agree and sign electronically"}
                  </button>
                </section>
              ) : (
                <section className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="m-0 flex items-center gap-2 text-[13px] font-black text-emerald-900"><CheckCircle2 className="h-4 w-4" /> Acceptance recorded</p>
                  <p className="m-0 mt-1 text-[12px] text-emerald-800">
                    {selectedAgreement.signedName ? `Signed by ${selectedAgreement.signedName}` : "Submitted for review"}
                    {selectedAgreement.acceptedAt ? ` on ${new Date(selectedAgreement.acceptedAt).toLocaleString([], { dateStyle: "long", timeStyle: "short" })}` : ""}.
                  </p>
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
