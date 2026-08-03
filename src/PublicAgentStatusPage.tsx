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

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "";

type Item = {
  key: string; label: string; status: string; mandatory: boolean;
  note: string | null; canUpload: boolean;
};
type StatusPayload = {
  orgName: string; reference: string; fullName: string; submittedAt: string;
  stage: { label: string; tone: string; detail: string };
  reason: string | null;
  items: Item[];
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

export default function PublicAgentStatusPage() {
  // #/agent-application/status/<token>
  const token = (window.location.hash.split("/")[3] ?? "").trim();
  const [view, setView] = useState<"loading" | "ready" | "invalid">("loading");
  const [data, setData] = useState<StatusPayload | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState("");
  const [justSent, setJustSent] = useState<string[]>([]);
  const previews = useRef<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => () => {
    for (const url of Object.values(previews.current)) URL.revokeObjectURL(url);
  }, []);

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
  const outstanding = data.items.filter((item) => item.canUpload && item.mandatory);

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

        {outstanding.length > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="m-0 text-[13px] font-bold text-amber-900">
              {outstanding.length} {outstanding.length === 1 ? "thing is" : "things are"} still needed from you
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
    </div>
  );
}
