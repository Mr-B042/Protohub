import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, CalendarPlus, Download, Filter, Loader2, MessageSquareText, MoreHorizontal, PencilLine, Plus, RefreshCw, Search, Upload, XCircle } from "lucide-react";
import { socialLeadsApi, type SlLeadRow } from "../../lib/api";
import { PlatformIcon } from "../../components/SocialIcons";
import { Avatar, Card, DateRange, Empty, Pager, ProductThumb, STATUS, STATUS_FILTER_OPTIONS, Select, StatusChip, btn, downloadCsv, lagosDateTime, timeAgo } from "./sl-ui";
import { KpiRow, useLoad, useStats } from "./sl-data";
import { AddLeadModal, CloseLeadModal, ScheduleModal, TransferModal } from "./LeadModals";
import type { Shared } from "./SocialLeadsPage";

const PLATFORM_NAME: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", messenger: "Messenger" };
const th = "whitespace-nowrap px-3 py-3 text-left text-[11.5px] font-bold uppercase tracking-wide text-gray-500 dark:text-slate-400";

/** "Name,Phone,Source,Product,State,Message" CSV → rows for Import. */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i += 1; row.push(cell); lines.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); lines.push(row); }
  const [head, ...body] = lines.filter((l) => l.some((c) => c.trim()));
  if (!head) return [];
  const keys = head.map((h) => h.trim().toLowerCase());
  const pick = (r: string[], ...names: string[]) => { for (const n of names) { const i = keys.indexOf(n); if (i >= 0 && r[i]?.trim()) return r[i].trim(); } return ""; };
  return body.map((r) => ({ name: pick(r, "name", "customer", "full name"), phone: pick(r, "phone", "phone number"), platform: pick(r, "source", "platform").toLowerCase(), product: pick(r, "product", "product interest"), state: pick(r, "state"), note: pick(r, "message", "note", "comment"), campaign: pick(r, "campaign") }));
}

export default function AllLeadsTab({ shared }: { shared: Shared }) {
  const [range, setRange] = useState<{ range: string; from?: string; to?: string }>({ range: "7d" });
  const [source, setSource] = useState("all"), [product, setProduct] = useState("all"), [rep, setRep] = useState("all"), [status, setStatus] = useState("all");
  const [search, setSearch] = useState(""), [q, setQ] = useState("");
  const [page, setPage] = useState(1), [size, setSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<"" | "add" | "schedule" | "transfer" | "close">("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { const t = setTimeout(() => setQ(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [range, source, product, rep, status, q, size]);
  const params = { ...range, source, product, rep, status, q, page, size };
  const stats = useStats({ ...range, source, product, rep });
  const list = useLoad(() => socialLeadsApi.leads(params), JSON.stringify(params));
  const rows = list.data?.leads ?? [];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const done = () => { setModal(""); setSelected(new Set()); list.reload(); stats.reload(); shared.refreshHeader(); };

  const exportCsv = async () => {
    setBusy("export");
    try {
      const { rows: all } = await socialLeadsApi.exportLeads({ ...range, source, product, rep, status, q });
      downloadCsv(`social-leads-${new Date().toISOString().slice(0, 10)}.csv`,
        ["Lead ID", "Customer", "Phone", "Source", "Product interest", "Latest message", "Status", "Assigned to", "State", "Campaign", "Created", "Order"],
        all.map((r) => [r.ref, r.name, r.phone, PLATFORM_NAME[r.platform], r.product, r.preview, STATUS[r.chip]?.label ?? r.chip, r.assignedName ?? "Unassigned", r.state, r.campaign, lagosDateTime(r.createdAt), r.orderId]));
    } catch (e) { shared.onToast((e as Error).message); } finally { setBusy(""); }
  };
  const importCsv = async (file: File) => {
    setBusy("import");
    try {
      const rowsIn = parseCsv(await file.text()).filter((r) => r.name);
      if (!rowsIn.length) { shared.onToast("No rows found. The first line must have column names: Name, Phone, Source, Product, State, Message."); return; }
      const productId = (name: string) => shared.products.find((p) => p.name.toLowerCase() === name.toLowerCase() || p.name.toLowerCase().includes(name.toLowerCase()))?.id;
      const r = await socialLeadsApi.importLeads(rowsIn.map((x) => ({ ...x, productId: x.product ? productId(x.product) ?? "" : "" })));
      shared.onToast(`${r.added} lead${r.added === 1 ? "" : "s"} added.${r.problems.length ? ` ${r.problems.length} not added: ${r.problems[0]}` : ""}`);
      done();
    } catch (e) { shared.onToast((e as Error).message); } finally { setBusy(""); if (fileRef.current) fileRef.current.value = ""; }
  };

  return (
    <div className="space-y-4">
      <KpiRow stats={stats.data} first="total" />
      <Card>
        <div className="flex flex-wrap items-start gap-3 px-5 pt-4">
          <div className="mr-auto">
            <h2 className="m-0 flex items-center gap-2 text-[22px] font-extrabold text-gray-900 dark:text-slate-50">All Leads <span className="rounded-full bg-[#EEEBFC] px-2.5 py-0.5 text-[13px] font-semibold text-[#5B3FD9]">{(list.data?.total ?? 0).toLocaleString()} leads</span></h2>
            <p className="m-0 text-[13.5px] text-gray-600 dark:text-slate-400">Complete list of all social media leads with filters, status, and team assignment.</p>
          </div>
          <button type="button" onClick={exportCsv} disabled={busy === "export"} className={btn.ghost}>{busy === "export" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Export</button>
          {shared.leadership && <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === "import"} className={btn.ghost} title="CSV with columns: Name, Phone, Source, Product, State, Message">{busy === "import" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Import</button>}
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importCsv(f); }} />
          <button type="button" onClick={() => setModal("add")} className={btn.primary}><Plus className="h-4 w-4" />Add Lead</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <span className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, message, or lead ID..." className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-9 pr-3 text-[13.5px] dark:border-slate-700 dark:bg-slate-900" />
          </span>
          <DateRange compact range={range.range} onChange={(r) => setRange(r)} />
          <Select label="Source" className="w-[150px]" value={source} onChange={setSource} options={[{ value: "all", label: "All Sources" }, { value: "facebook", label: "Facebook" }, { value: "instagram", label: "Instagram" }, { value: "messenger", label: "Messenger" }]} />
          <Select label="Product" className="w-[160px]" value={product} onChange={setProduct} options={[{ value: "all", label: "All Products" }, ...shared.products.map((p) => ({ value: p.id, label: p.name }))]} />
          {shared.leadership && <Select label="Call rep" className="w-[160px]" value={rep} onChange={setRep} options={[{ value: "all", label: "All Call Reps" }, { value: "none", label: "Unassigned" }, ...shared.reps.filter((r) => r.role === "Sales Rep").map((r) => ({ value: r.id, label: r.name }))]} />}
          <Select label="Status" className="w-[160px]" value={status} onChange={setStatus} options={[{ value: "all", label: "All Status" }, ...STATUS_FILTER_OPTIONS.map((k) => ({ value: k, label: STATUS[k]?.label ?? k }))]} />
          <button type="button" aria-label="Clear filters" title="Clear filters" onClick={() => { setSource("all"); setProduct("all"); setRep("all"); setStatus("all"); setSearch(""); setRange({ range: "7d" }); }} className={`${btn.icon} !text-[#5B3FD9]`}><Filter className="h-[18px] w-[18px]" /></button>
          <button type="button" aria-label="Refresh" onClick={() => { list.reload(); stats.reload(); }} className={btn.icon}><RefreshCw className={`h-[18px] w-[18px] ${list.busy ? "animate-spin" : ""}`} /></button>
        </div>
        {selected.size > 0 && (
          <div className="mx-5 mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#F5F2FE] px-3 py-2 text-[13px] dark:bg-violet-500/10">
            <b className="mr-2">{selected.size} selected</b>
            <button type="button" className={`${btn.ghost} !py-1.5 !text-[13px]`} onClick={() => setModal("schedule")}><CalendarPlus className="h-4 w-4" />Schedule follow-up</button>
            {shared.leadership && <button type="button" className={`${btn.ghost} !py-1.5 !text-[13px]`} onClick={() => setModal("transfer")}><ArrowLeftRight className="h-4 w-4" />Assign to a rep</button>}
            {shared.leadership && <button type="button" className={`${btn.ghost} !py-1.5 !text-[13px]`} onClick={() => setModal("close")}><XCircle className="h-4 w-4" />Close as lost</button>}
            <button type="button" className="!min-h-0 ml-auto text-[12.5px] text-gray-500" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="!min-w-[1180px] w-full border-collapse">
            <thead className="bg-gray-50/80 dark:bg-slate-800/50">
              <tr>
                <th className="w-10 px-4 py-3"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); if (allOnPage) rows.forEach((r) => n.delete(r.id)); else rows.forEach((r) => n.add(r.id)); return n; })} /></th>
                <th className={th}>Lead ID</th><th className={th}>Customer</th><th className={th}>Source</th><th className={th}>Product Interest</th><th className={th}>Latest Message</th><th className={th}>Status</th><th className={th}>Assigned To</th><th className={th}>Created</th><th className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.error && <tr><td colSpan={10}><Empty>{list.error}</Empty></td></tr>}
              {!list.data && !list.error && <tr><td colSpan={10}><Empty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Empty></td></tr>}
              {list.data && rows.length === 0 && <tr><td colSpan={10}><Empty>No lead matches these filters.</Empty></td></tr>}
              {rows.map((r: SlLeadRow) => (
                <tr key={r.id} className="border-b border-gray-100 dark:border-slate-800 [&>td]:px-3 [&>td]:py-2.5 [&>td]:align-middle [&>td]:text-[13.5px] [&>td]:text-gray-800 dark:[&>td]:text-slate-200">
                  <td className="!px-4"><input type="checkbox" aria-label={`Select ${r.ref}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td><span className="whitespace-nowrap rounded-lg bg-[#EEEBFC] px-2 py-1 text-[12.5px] font-bold text-[#5B3FD9] dark:bg-violet-500/15 dark:text-violet-200">{r.ref}</span></td>
                  <td><span className="flex items-center gap-2.5"><Avatar name={r.name} src={r.profilePic} size={36} /><span className="min-w-0"><b className="block max-w-[160px] truncate">{r.name}</b><span className="text-[12.5px] text-gray-500">{r.phone ?? "No phone yet"}</span></span></span></td>
                  <td><span className="flex items-center gap-1.5"><PlatformIcon platform={r.platform} className="h-5 w-5" />{r.platform !== "messenger" && PLATFORM_NAME[r.platform]}</span></td>
                  <td>{r.product ? <span className="inline-flex max-w-[220px] items-center gap-2 rounded-xl border border-gray-200 px-2 py-1 dark:border-slate-700"><ProductThumb src={r.productImage} name={r.product} size={26} /><span className="truncate font-medium">{r.product}</span></span> : <span className="text-gray-400">—</span>}</td>
                  <td><span className="inline-flex max-w-[260px] items-start gap-1.5 rounded-xl bg-gray-50 px-2.5 py-1.5 dark:bg-slate-800/60"><MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" /><span className="line-clamp-2">{r.preview || "—"}</span></span></td>
                  <td><StatusChip status={r.chip} /></td>
                  <td>{r.assignedName ? <span className="flex items-center gap-2"><Avatar name={r.assignedName} src={r.assignedAvatar} size={28} /><b className="font-semibold">{r.assignedName}</b></span> : <span className="flex items-center gap-2 text-gray-500"><Avatar name="?" size={28} />Unassigned</span>}</td>
                  <td className="whitespace-nowrap text-gray-600">{timeAgo(r.createdAt)}</td>
                  <td>
                    <span className="relative flex items-center gap-1">
                      <button type="button" aria-label="Open conversation" title="Open conversation" onClick={() => shared.openLead(r.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B3FD9] hover:bg-[#F1EEFD]"><MessageSquareText className="h-[18px] w-[18px]" /></button>
                      <button type="button" aria-label="Edit" title="Open and edit" onClick={() => shared.openLead(r.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-slate-300"><PencilLine className="h-[18px] w-[18px]" /></button>
                      <button type="button" aria-label="More" onClick={() => setMenuFor(menuFor === r.id ? null : r.id)} className="!min-h-0 inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 dark:text-slate-300"><MoreHorizontal className="h-[18px] w-[18px]" /></button>
                      {menuFor === r.id && (
                        <div className="absolute right-0 top-9 z-20 w-52 rounded-xl border border-gray-200 bg-white p-1 text-[13px] shadow-lg dark:border-slate-700 dark:bg-slate-900" onMouseLeave={() => setMenuFor(null)}>
                          <button type="button" className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); setSelected(new Set([r.id])); setModal("schedule"); }}>Schedule follow-up</button>
                          {shared.leadership && <button type="button" className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); setSelected(new Set([r.id])); setModal("transfer"); }}>Assign to a rep</button>}
                          {r.orderId && <button type="button" className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800" onClick={() => { setMenuFor(null); shared.onOpenOrder?.(r.orderId!); }}>Open order #{r.orderId}</button>}
                          {r.status !== "lost" && <button type="button" className="!min-h-0 block w-full rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50" onClick={() => { setMenuFor(null); setSelected(new Set([r.id])); setModal("close"); }}>Close as lost</button>}
                        </div>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager page={list.data?.page ?? 1} size={size} total={list.data?.total ?? 0} onPage={setPage} onSize={setSize} noun="leads" />
      </Card>
      {modal === "add" && <AddLeadModal shared={shared} onClose={() => setModal("")} onDone={() => done()} />}
      {modal === "schedule" && <ScheduleModal leadIds={[...selected]} onClose={() => setModal("")} onToast={shared.onToast} onDone={done} />}
      {modal === "transfer" && <TransferModal leadIds={[...selected]} reps={shared.reps} onClose={() => setModal("")} onToast={shared.onToast} onDone={done} />}
      {modal === "close" && <CloseLeadModal leadIds={[...selected]} onClose={() => setModal("")} onToast={shared.onToast} onDone={done} />}
    </div>
  );
}
