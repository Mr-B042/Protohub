import { useMemo, useState, type ReactNode } from "react";
import { NIGERIA_STATES } from "../lib/nigeria";
import { WhatsAppIcon } from "../components/WhatsAppIcon";
import type { SalesCloserFollowUps, SalesCloserOrders, SalesCloserOverview, SalesLeadKpi } from "../lib/api";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  HelpCircle,
  Info,
  Lightbulb,
  MapPin,
  MoreVertical,
  Package,
  Phone,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  StickyNote,
  Tag,
  Target,
  TrendingUp,
  UserPlus,
  Wallet
} from "lucide-react";

export type SalesCloserSection =
  | "overview"
  | "leads"
  | "add-lead"
  | "follow-ups"
  | "orders-created"
  | "my-performance"
  | "my-bonuses"
  | "scripts-templates"
  | "products"
  | "help-center"
  | "report-issue";

export type SalesCloserProduct = {
  id: string;
  name: string;
  active: boolean;
  packages: Array<{ id: string; name: string }>;
};

export type SalesCloserAssignee = { id: string; name: string };

// Sources a Sales Closer can pick when logging a lead by hand.
export type SalesLeadSource = "whatsapp" | "instagram" | "tiktok" | "facebook" | "website" | "other";
// The DB allows two more ("phone", "referral") for flexibility/future entry
// points that don't go through this form - display code must handle them
// even though nothing here creates them yet.
export type SalesLeadDisplaySource = SalesLeadSource | "phone" | "referral";
export type SalesLeadStatus = "new_lead" | "contacted" | "qualified" | "follow_up" | "order_created" | "not_interested";

export type SalesLeadDraft = {
  fullName: string;
  phone: string;
  alternatePhone: string;
  whatsappNumber: string;
  email: string;
  preferredContactMethod: "whatsapp" | "call" | "sms" | "email";
  state: string;
  city: string;
  address: string;
  source: SalesLeadSource;
  campaign: string;
  interestedProductIds: string[];
  packageId: string;
  notes: string;
  status: Exclude<SalesLeadStatus, "order_created">;
  tags: string[];
  priority: "low" | "medium" | "high";
  assignedCloserId: string;
  followUpDate: string;
  followUpTime: string;
};

export type SalesCloserLead = {
  id: string;
  fullName: string;
  phone: string;
  whatsappNumber: string;
  state: string;
  city: string;
  interestedProductIds: string[];
  productNames: string[];
  source: SalesLeadDisplaySource;
  campaign: string;
  status: SalesLeadStatus;
  priority: "low" | "medium" | "high";
  convertedOrderId: string | null;
  createdAt: string;
  lastActivityAt: string;
};

type Props = {
  section: SalesCloserSection;
  products: SalesCloserProduct[];
  assignees: SalesCloserAssignee[];
  currentUserId: string;
  saving: boolean;
  error: string;
  onSaveLead: (draft: SalesLeadDraft) => Promise<void>;
  onCancelAddLead: () => void;
  onAction: (section: SalesCloserSection) => void;
  leads: SalesCloserLead[];
  leadsLoading: boolean;
  leadsError: string;
  onUpdateLeadStatus: (leadId: string, status: SalesLeadStatus) => Promise<void>;
  onOpenOrder: (orderId: string) => void;
  onConvertLead: (leadId: string) => void;
  overview: SalesCloserOverview | null;
  overviewLoading: boolean;
  overviewError: string;
  followUps: SalesCloserFollowUps | null;
  followUpsLoading: boolean;
  followUpsError: string;
  orders: SalesCloserOrders | null;
  ordersLoading: boolean;
  ordersError: string;
};

const QUICK_TAGS = ["High Potential", "Price Sensitive", "First Time Buyer", "Repeat Customer", "Needs Follow-up"];

const SOURCE_OPTIONS: Array<{ value: SalesLeadDraft["source"]; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "facebook", label: "Facebook" },
  { value: "website", label: "Website Chat" },
  { value: "other", label: "Other" }
];

const STATUS_OPTIONS: Array<{ value: SalesLeadDraft["status"]; label: string }> = [
  { value: "new_lead", label: "New Lead" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Interested / Qualified" },
  { value: "follow_up", label: "Follow-up" },
  { value: "not_interested", label: "Not Interested" }
];

const STATUS_LABELS: Record<SalesLeadStatus, string> = {
  new_lead: "New",
  contacted: "Contacted",
  qualified: "Interested / Qualified",
  follow_up: "Follow-up",
  order_created: "Order Created",
  not_interested: "Not Interested"
};

const STATUS_TONE: Record<SalesLeadStatus, string> = {
  new_lead: "border-blue-200 bg-blue-50 text-blue-700",
  contacted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  qualified: "border-violet-200 bg-violet-50 text-violet-700",
  follow_up: "border-amber-200 bg-amber-50 text-amber-700",
  order_created: "border-emerald-300 bg-emerald-100 text-emerald-800",
  not_interested: "border-rose-200 bg-rose-50 text-rose-700"
};

const SOURCE_LABELS: Record<SalesLeadDisplaySource, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  website: "Website Chat",
  phone: "Phone",
  referral: "Referral",
  other: "Other"
};

const LEAD_TABS: Array<{ key: "all" | SalesLeadStatus; label: string }> = [
  { key: "all", label: "All Leads" },
  { key: "new_lead", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Interested / Qualified" },
  { key: "follow_up", label: "Follow-up" },
  { key: "order_created", label: "Order Created" },
  { key: "not_interested", label: "Not Interested" }
];

// Same digit-normalizing logic App.tsx's normalizeWhatsAppPhone uses -
// most numbers here are Nigerian local mobiles (080.../070.../090... or
// the same without the leading zero), converted to WhatsApp's required
// international format.
const normalizedWhatsAppDigits = (phone: string | null | undefined) => {
  let clean = (phone ?? "").replace(/\D/g, "");
  if (!clean) return null;
  if (clean.startsWith("00")) clean = clean.slice(2);
  if (clean.startsWith("234")) return clean.length >= 13 && clean.length <= 15 ? clean : null;
  if (clean.startsWith("0") && clean.length === 11) return `234${clean.slice(1)}`;
  if (!clean.startsWith("0") && clean.length === 10) return `234${clean}`;
  return clean.length >= 11 && clean.length <= 15 ? clean : null;
};

const fieldClass = "w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100";

const defaultDraft = (currentUserId: string): SalesLeadDraft => ({
  fullName: "",
  phone: "",
  alternatePhone: "",
  whatsappNumber: "",
  email: "",
  preferredContactMethod: "whatsapp",
  state: "",
  city: "",
  address: "",
  source: "whatsapp",
  campaign: "",
  interestedProductIds: [],
  packageId: "",
  notes: "",
  status: "new_lead",
  tags: [],
  priority: "medium",
  assignedCloserId: currentUserId,
  followUpDate: "",
  followUpTime: ""
});

function FieldLabel({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block text-sm font-semibold text-gray-700">
      <span>{label}{required && <span className="text-rose-500"> *</span>}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function CardHeader({ icon: Icon, title, subtitle, tone }: { icon: typeof Package; title: string; subtitle: string; tone: string }) {
  return (
    <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone}`}><Icon className="h-4.5 w-4.5" /></span>
      <div>
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <p className="mt-0.5 text-xs font-medium text-gray-500">{subtitle}</p>
      </div>
    </div>
  );
}

function PhoneField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-gray-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
      <span className="flex shrink-0 items-center gap-1.5 border-r border-gray-200 bg-gray-50 px-3 text-sm font-bold text-gray-600">🇳🇬 +234</span>
      <input
        className="w-full min-w-0 px-3 py-2.5 text-sm font-medium text-gray-900 outline-none"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ComingSoon({ icon: Icon, title }: { icon: typeof Package; title: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500"><Icon className="h-6 w-6" /></span>
      <h2 className="mt-4 text-base font-black text-gray-900">{title}</h2>
      <p className="mt-1.5 max-w-sm text-sm font-medium text-gray-500">This page ships in a later stage of the Sales Closer build.</p>
    </div>
  );
}

const timeAgo = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";

const money = (value: number) => `₦${Math.round(value).toLocaleString("en-NG")}`;

const dueLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diffMs = date.getTime() - Date.now();
  const hours = Math.round(Math.abs(diffMs) / 3_600_000);
  const unit = hours < 1 ? "now" : hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
  if (unit === "now") return "Due now";
  return diffMs >= 0 ? `Due in ${unit}` : `Overdue by ${unit}`;
};

function KpiCard({ icon: Icon, tone, label, value, displayValue, delta, deltaLabel = "vs yesterday", deltaIsMoney, sublabel }: { icon: typeof Package; tone: string; label: string; value: number; displayValue?: string; delta?: number; deltaLabel?: string; deltaIsMoney?: boolean; sublabel: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-4.5 w-4.5" /></span>
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
        </div>
      </div>
      <p className="mt-3 text-2xl font-black text-gray-950">{displayValue ?? value.toLocaleString()}</p>
      <p className="mt-1 text-xs font-medium text-gray-400">{sublabel}</p>
      {typeof delta === "number" && delta !== 0 && (
        <p className={`mt-1 flex items-center gap-1 text-xs font-bold ${delta > 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {deltaIsMoney ? money(Math.abs(delta)) : Math.abs(delta)} {deltaLabel}
        </p>
      )}
    </div>
  );
}

const PAGE_SIZE = 10;

function LeadsInboxSection({
  leads,
  loading,
  error,
  products,
  onUpdateLeadStatus,
  onOpenOrder,
  onConvertLead,
  onAddLead
}: {
  leads: SalesCloserLead[];
  loading: boolean;
  error: string;
  products: SalesCloserProduct[];
  onUpdateLeadStatus: (leadId: string, status: SalesLeadStatus) => Promise<void>;
  onOpenOrder: (orderId: string) => void;
  onConvertLead: (leadId: string) => void;
  onAddLead: () => void;
}) {
  const [tab, setTab] = useState<"all" | SalesLeadStatus>("all");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SalesLeadDisplaySource>("all");
  const [productFilter, setProductFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SalesLeadStatus>("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: leads.length };
    for (const lead of leads) counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    return counts;
  }, [leads]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    let rows = leads.filter((lead) => {
      if (tab !== "all" && lead.status !== tab) return false;
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (sourceFilter !== "all" && lead.source !== sourceFilter) return false;
      if (productFilter !== "all" && !lead.interestedProductIds.includes(productFilter)) return false;
      if (query && !`${lead.fullName} ${lead.phone}`.toLowerCase().includes(query)) return false;
      return true;
    });
    rows = [...rows].sort((a, b) => sort === "newest"
      ? new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return rows;
  }, [leads, tab, statusFilter, sourceFilter, productFilter, search, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const changeStatus = async (leadId: string, status: SalesLeadStatus) => {
    setOpenMenuId(null);
    setStatusUpdating(leadId);
    try {
      await onUpdateLeadStatus(leadId, status);
    } finally {
      setStatusUpdating(null);
    }
  };

  return (
    <div className="relative space-y-4 p-4 sm:p-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Sales Closer</p>
        <h1 className="mt-1 text-2xl font-black text-gray-950">Leads / Inbox</h1>
        <p className="mt-1 text-sm font-medium text-gray-500">All interested customers from your channels</p>
      </div>

      <div className="flex flex-wrap gap-1 overflow-x-auto rounded-lg border border-gray-200 bg-white p-1">
        {LEAD_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`!min-h-0 flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition ${tab === item.key ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50"}`}
            onClick={() => { setTab(item.key); setPage(1); }}
          >
            {item.label}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-black ${tab === item.key ? "bg-blue-200 text-blue-800" : "bg-gray-100 text-gray-500"}`}>{tabCounts[item.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input className={`${fieldClass} pl-9`} placeholder="Search by name, phone, product..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </div>
        <select className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700" value={sourceFilter} onChange={(event) => { setSourceFilter(event.target.value as typeof sourceFilter); setPage(1); }}>
          <option value="all">All Sources</option>
          {(Object.keys(SOURCE_LABELS) as SalesLeadDisplaySource[]).map((value) => <option key={value} value={value}>{SOURCE_LABELS[value]}</option>)}
        </select>
        <select className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700" value={productFilter} onChange={(event) => { setProductFilter(event.target.value); setPage(1); }}>
          <option value="all">All Products</option>
          {products.filter((product) => product.active).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <select className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }}>
          <option value="all">All Statuses</option>
          {(Object.keys(STATUS_LABELS) as SalesLeadStatus[]).map((value) => <option key={value} value={value}>{STATUS_LABELS[value]}</option>)}
        </select>
        <select className="!min-h-0 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold text-gray-700" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="newest">Sort by: Newest</option>
          <option value="oldest">Sort by: Oldest</option>
        </select>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Lead</th>
                <th className="px-4 py-3">Product Interested</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Added</th>
                <th className="px-4 py-3">Last Activity</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">Loading leads...</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">No leads match these filters yet.</td></tr>
              ) : pageRows.map((lead) => {
                const waDigits = normalizedWhatsAppDigits(lead.whatsappNumber || lead.phone);
                return (
                  <tr key={lead.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700">{initials(lead.fullName)}</span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-gray-900">{lead.fullName}</p>
                          <p className="text-xs font-medium text-gray-500">{lead.phone}</p>
                          {(lead.city || lead.state) && (
                            <p className="flex items-center gap-1 text-[11px] font-medium text-gray-400"><MapPin className="h-3 w-3" />{[lead.city, lead.state].filter(Boolean).join(", ")}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {lead.productNames.length > 0
                        ? <span className="inline-flex rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">{lead.productNames.join(", ")}</span>
                        : <span className="text-xs text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-bold text-gray-700">{SOURCE_LABELS[lead.source]}</p>
                      {lead.campaign && <p className="truncate text-[11px] font-medium text-gray-400">{lead.campaign}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-black ${STATUS_TONE[lead.status]}`}>{STATUS_LABELS[lead.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-500">{timeAgo(lead.createdAt)}</td>
                    <td className="px-4 py-3 text-xs font-medium text-gray-500">{timeAgo(lead.lastActivityAt)}</td>
                    <td className="px-4 py-3">
                      {lead.convertedOrderId ? (
                        <button type="button" className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700" onClick={() => onOpenOrder(lead.convertedOrderId!)}>
                          <ExternalLink className="h-3.5 w-3.5" /> View Order
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {lead.status !== "not_interested" && (
                            <button type="button" className="!min-h-0 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-blue-700" onClick={() => onConvertLead(lead.id)}>
                              <Check className="h-3.5 w-3.5" /> Convert
                            </button>
                          )}
                          <a href={`tel:+${normalizedWhatsAppDigits(lead.phone) ?? lead.phone.replace(/\D/g, "")}`} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600" title="Call"><Phone className="h-3.5 w-3.5" /></a>
                          {waDigits && (
                            <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-emerald-600 hover:border-emerald-300" title="Chat on WhatsApp"><WhatsAppIcon className="h-3.5 w-3.5" /></a>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="relative px-4 py-3 text-right">
                      <button type="button" className="!min-h-0 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={() => setOpenMenuId((current) => current === lead.id ? null : lead.id)}>
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {openMenuId === lead.id && (
                        <>
                          <div className="fixed inset-0 z-20" onClick={() => setOpenMenuId(null)} />
                          <div className="absolute right-4 top-full z-30 mt-1 w-48 rounded-lg border border-gray-200 bg-white p-1.5 shadow-lg">
                            <p className="px-2.5 py-1.5 text-[10px] font-black uppercase text-gray-400">Change status</p>
                            {(Object.keys(STATUS_LABELS) as SalesLeadStatus[]).filter((value) => value !== "order_created").map((value) => (
                              <button
                                key={value}
                                type="button"
                                disabled={statusUpdating === lead.id}
                                className={`!min-h-0 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-bold ${lead.status === value ? "bg-blue-50 text-blue-700" : "text-gray-600 hover:bg-gray-50"}`}
                                onClick={() => changeStatus(lead.id, value)}
                              >
                                {STATUS_LABELS[value]}
                                {lead.status === value && <Check className="h-3.5 w-3.5" />}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-xs font-medium text-gray-500">
            <p>Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length} leads</p>
            <div className="flex items-center gap-2">
              <button type="button" className="!min-h-0 rounded-lg border border-gray-200 px-3 py-1.5 font-bold text-gray-600 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Prev</button>
              <span className="font-bold text-gray-700">{page} / {totalPages}</span>
              <button type="button" className="!min-h-0 rounded-lg border border-gray-200 px-3 py-1.5 font-bold text-gray-600 disabled:opacity-40" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</button>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        className="!min-h-0 fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-3.5 text-sm font-black text-white shadow-xl shadow-blue-300/50 hover:bg-blue-700"
        onClick={onAddLead}
      >
        <Plus className="h-4 w-4" /> Quick Add Lead
      </button>
    </div>
  );
}

function FunnelBar({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-xs font-bold text-gray-600">{label}</span>
      <div className="h-7 flex-1 overflow-hidden rounded-md bg-gray-100">
        <div className={`flex h-full items-center rounded-md px-2 text-[11px] font-black text-white ${tone}`} style={{ width: `${Math.max(pct, value > 0 ? 6 : 0)}%` }}>
          {value > 0 && `${value}`}
        </div>
      </div>
      <span className="w-14 shrink-0 text-right text-xs font-bold text-gray-500">{pct}%</span>
    </div>
  );
}

function OverviewSection({
  overview,
  loading,
  error,
  onAction
}: {
  overview: SalesCloserOverview | null;
  loading: boolean;
  error: string;
  onAction: (section: SalesCloserSection) => void;
}) {
  if (loading || !overview) {
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Sales Closer</p>
          <h1 className="mt-1 text-2xl font-black text-gray-950">Overview</h1>
        </div>
        {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p> : <div className="h-64 animate-pulse rounded-lg border border-gray-100 bg-white" />}
      </div>
    );
  }

  const kpiCards: Array<{ key: keyof SalesCloserOverview["kpis"]; label: string; icon: typeof Package; tone: string }> = [
    { key: "newLeads", label: "New Leads", icon: UserPlus, tone: "bg-blue-100 text-blue-600" },
    { key: "contacted", label: "Contacted", icon: Phone, tone: "bg-emerald-100 text-emerald-600" },
    { key: "qualified", label: "Qualified", icon: Sparkles, tone: "bg-violet-100 text-violet-600" },
    { key: "ordersCreated", label: "Orders Created", icon: ShoppingCart, tone: "bg-amber-100 text-amber-600" },
    { key: "delivered", label: "Delivered", icon: Check, tone: "bg-teal-100 text-teal-600" }
  ];

  const performanceCards: Array<{ label: string; value: string }> = [
    { label: "Leads", value: overview.performanceThisMonth.leads.toLocaleString() },
    { label: "Orders Created", value: overview.performanceThisMonth.ordersCreated.toLocaleString() },
    { label: "Delivered Orders", value: overview.performanceThisMonth.deliveredOrders.toLocaleString() },
    { label: "Delivery Rate", value: `${overview.performanceThisMonth.deliveryRate}%` },
    { label: "AOV (Delivered)", value: money(overview.performanceThisMonth.aovDelivered) },
    { label: "Delivered Revenue", value: money(overview.performanceThisMonth.deliveredRevenue) },
    { label: "Upsell Revenue", value: money(overview.performanceThisMonth.upsellRevenue) },
    { label: "Cross-sell Revenue", value: money(overview.performanceThisMonth.crossSellRevenue) }
  ];

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Sales Closer</p>
        <h1 className="mt-1 text-2xl font-black text-gray-950">Overview</h1>
        <p className="mt-1 text-sm font-medium text-gray-500">Track your leads, conversations and conversions</p>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpiCards.map((card) => {
          const kpi: SalesLeadKpi = overview.kpis[card.key];
          return <KpiCard key={card.key} icon={card.icon} tone={card.tone} label={card.label} value={kpi.value} delta={kpi.deltaVsYesterday} sublabel="Today" />;
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h3 className="text-sm font-bold text-gray-900">Lead → Delivered Funnel</h3>
          <div className="mt-4 space-y-2.5">
            <FunnelBar label="New Leads" value={overview.funnel.newLeads} total={overview.funnel.newLeads} tone="bg-blue-600" />
            <FunnelBar label="Contacted" value={overview.funnel.contacted} total={overview.funnel.newLeads} tone="bg-sky-500" />
            <FunnelBar label="Qualified" value={overview.funnel.qualified} total={overview.funnel.newLeads} tone="bg-violet-500" />
            <FunnelBar label="Orders Created" value={overview.funnel.ordersCreated} total={overview.funnel.newLeads} tone="bg-amber-500" />
            <FunnelBar label="Delivered" value={overview.funnel.delivered} total={overview.funnel.newLeads} tone="bg-emerald-600" />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900">Conversion Rates</h3>
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600"><TrendingUp className="h-4 w-4" /></span>
              <div><p className="text-xs font-semibold text-gray-500">Lead → Order</p><p className="text-lg font-black text-gray-950">{overview.conversionRates.leadToOrder}%</p></div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600"><TrendingUp className="h-4 w-4" /></span>
              <div><p className="text-xs font-semibold text-gray-500">Lead → Delivered</p><p className="text-lg font-black text-gray-950">{overview.conversionRates.leadToDelivered}%</p></div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600"><Target className="h-4 w-4" /></span>
              <div><p className="text-xs font-semibold text-gray-500">Order Conversion Rate</p><p className="text-lg font-black text-gray-950">{overview.conversionRates.orderConversionRate}%</p></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h3 className="text-sm font-bold text-gray-900">Follow-ups Due</h3>
            <button type="button" className="!min-h-0 flex items-center gap-1 text-xs font-bold text-blue-600" onClick={() => onAction("follow-ups")}>View all <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="divide-y divide-gray-50">
            {overview.followUpsDue.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">No follow-ups due soon.</p>
            ) : overview.followUpsDue.map((lead) => (
              <div key={lead.id} className="flex items-center gap-3 px-5 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-black text-blue-700">{initials(lead.fullName)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-gray-900">{lead.fullName}</p>
                  <p className="truncate text-xs font-medium text-gray-400">{lead.productNames.join(", ") || "-"}</p>
                </div>
                <span className="shrink-0 text-xs font-bold text-gray-500">{dueLabel(lead.followUpAt)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
            <h3 className="text-sm font-bold text-gray-900">My Performance (This Month)</h3>
            <button type="button" className="!min-h-0 flex items-center gap-1 text-xs font-bold text-blue-600" onClick={() => onAction("my-performance")}>View full performance <ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          <div className="grid grid-cols-2 gap-4 p-5">
            {performanceCards.map((card) => (
              <div key={card.label}>
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{card.label}</p>
                <p className="mt-1 text-base font-black text-gray-950">{card.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-sm font-bold text-gray-900">Recent Leads</h3>
          <button type="button" className="!min-h-0 flex items-center gap-1 text-xs font-bold text-blue-600" onClick={() => onAction("leads")}>View all <ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Product Interested</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {overview.recentLeads.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">No leads yet.</td></tr>
              ) : overview.recentLeads.map((lead) => (
                <tr key={lead.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-3 font-bold text-gray-900">{lead.fullName}</td>
                  <td className="px-5 py-3 text-gray-600">{lead.productNames.join(", ") || "-"}</td>
                  <td className="px-5 py-3 text-gray-600">{SOURCE_LABELS[lead.source as SalesLeadDisplaySource] ?? lead.source}</td>
                  <td className="px-5 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[lead.status as SalesLeadStatus]}`}>{STATUS_LABELS[lead.status as SalesLeadStatus] ?? lead.status}</span></td>
                  <td className="px-5 py-3 text-xs text-gray-400">{timeAgo(lead.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const FOLLOW_UP_TABS = [
  { key: "all", label: "All" },
  { key: "dueToday", label: "Due Today" },
  { key: "dueThisWeek", label: "Due This Week" },
  { key: "overdue", label: "Overdue" },
  { key: "converted", label: "Converted" }
] as const;

function FollowUpsSection({
  data,
  loading,
  error,
  onAddLead
}: {
  data: SalesCloserFollowUps | null;
  loading: boolean;
  error: string;
  onAddLead: () => void;
}) {
  const [tab, setTab] = useState<(typeof FOLLOW_UP_TABS)[number]["key"]>("all");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const weekEnd = useMemo(() => new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10), []);

  const rows = data?.rows ?? [];
  const filtered = rows.filter((row) => {
    if (tab === "all") return row.status !== "order_created";
    if (tab === "dueToday") return row.followUpAt.slice(0, 10) === today && row.status !== "order_created";
    if (tab === "dueThisWeek") return row.followUpAt.slice(0, 10) >= today && row.followUpAt.slice(0, 10) <= weekEnd && row.status !== "order_created";
    if (tab === "overdue") return row.overdue;
    if (tab === "converted") return row.status === "order_created";
    return true;
  });

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Sales Closer</p>
        <h1 className="mt-1 text-2xl font-black text-gray-950">Follow-ups</h1>
        <p className="mt-1 text-sm font-medium text-gray-500">Interested customers not yet converted to orders</p>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <KpiCard icon={Clock} tone="bg-violet-100 text-violet-600" label="Total Follow-ups" value={data?.kpis.totalFollowUps ?? 0} sublabel="Leads to follow up" />
        <KpiCard icon={Calendar} tone="bg-blue-100 text-blue-600" label="Due Today" value={data?.kpis.dueToday ?? 0} sublabel="Leads" />
        <KpiCard icon={Calendar} tone="bg-sky-100 text-sky-600" label="Due This Week" value={data?.kpis.dueThisWeek ?? 0} sublabel="Leads" />
        <KpiCard icon={AlertTriangle} tone="bg-rose-100 text-rose-600" label="Overdue" value={data?.kpis.overdue ?? 0} sublabel="Leads" />
        <KpiCard icon={Check} tone="bg-emerald-100 text-emerald-600" label="Converted" value={data?.kpis.converted ?? 0} sublabel="From follow-ups" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm lg:col-span-3">
          <div className="flex flex-wrap gap-1 border-b border-gray-100 p-2">
            {FOLLOW_UP_TABS.map((item) => (
              <button key={item.key} type="button" className={`!min-h-0 rounded-lg px-3 py-2 text-xs font-bold transition ${tab === item.key ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50"}`} onClick={() => setTab(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3">Lead</th>
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Due</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Loading follow-ups...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Nothing here.</td></tr>
                ) : filtered.map((row) => {
                  const waDigits = normalizedWhatsAppDigits(row.whatsappNumber || row.phone);
                  return (
                    <tr key={row.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-4 py-3">
                        <p className="font-bold text-gray-900">{row.fullName}</p>
                        <p className="text-xs font-medium text-gray-400">{row.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{row.productNames.join(", ") || "-"}</td>
                      <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_TONE[row.status as SalesLeadStatus]}`}>{STATUS_LABELS[row.status as SalesLeadStatus] ?? row.status}</span></td>
                      <td className={`px-4 py-3 text-xs font-bold ${row.overdue ? "text-rose-600" : "text-gray-600"}`}>{dueLabel(row.followUpAt)}</td>
                      <td className="px-4 py-3 text-xs font-bold capitalize text-gray-600">{row.priority}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <a href={`tel:+${normalizedWhatsAppDigits(row.phone) ?? row.phone.replace(/\D/g, "")}`} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:border-blue-300 hover:text-blue-600" title="Call"><Phone className="h-3.5 w-3.5" /></a>
                          {waDigits && <a href={`https://wa.me/${waDigits}`} target="_blank" rel="noreferrer" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-emerald-600 hover:border-emerald-300" title="Chat on WhatsApp"><WhatsAppIcon className="h-3.5 w-3.5" /></a>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-black uppercase tracking-wide text-gray-500">Quick Actions</h3>
            <div className="mt-3 space-y-1">
              <button type="button" className="!min-h-0 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold text-gray-700 hover:bg-gray-50" onClick={onAddLead}><UserPlus className="h-4 w-4 text-blue-500" /> Add New Lead</button>
            </div>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
            <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-blue-700"><Lightbulb className="h-4 w-4" /> Follow-up Tips</h3>
            <ul className="mt-3 space-y-2 text-xs font-medium leading-5 text-blue-900">
              <li className="flex gap-2"><Info className="h-3.5 w-3.5 shrink-0" /> Respond within 5 minutes to increase conversion.</li>
              <li className="flex gap-2"><Info className="h-3.5 w-3.5 shrink-0" /> Focus on high priority leads first.</li>
              <li className="flex gap-2"><Info className="h-3.5 w-3.5 shrink-0" /> Update status after each conversation.</li>
            </ul>
          </div>
          {(data?.kpis.dueToday ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-amber-700"><Bell className="h-4 w-4" /> Reminder</h3>
              <p className="mt-2 text-xs font-semibold text-amber-800">{data?.kpis.dueToday} follow-up{data?.kpis.dueToday === 1 ? "" : "s"} due today. Don't miss any!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ORDER_STATUS_TABS = ["All", "New", "Confirmed", "In Process", "Dispatched", "Delivered", "Postponed", "Cancelled", "Failed"] as const;
const ORDER_STATUS_TONE: Record<string, string> = {
  New: "border-blue-200 bg-blue-50 text-blue-700",
  Confirmed: "border-sky-200 bg-sky-50 text-sky-700",
  "In Process": "border-amber-200 bg-amber-50 text-amber-700",
  Dispatched: "border-violet-200 bg-violet-50 text-violet-700",
  Delivered: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Postponed: "border-gray-200 bg-gray-50 text-gray-600",
  Cancelled: "border-rose-200 bg-rose-50 text-rose-700",
  Failed: "border-rose-200 bg-rose-50 text-rose-700"
};

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function OrdersCreatedSection({ data, loading, error, onOpenOrder }: { data: SalesCloserOrders | null; loading: boolean; error: string; onOpenOrder: (orderId: string) => void }) {
  const [tab, setTab] = useState<(typeof ORDER_STATUS_TABS)[number]>("All");
  const orders = data?.orders ?? [];
  const filtered = tab === "All" ? orders : orders.filter((order) => order.status === tab);

  const exportCsv = () => {
    const rows = [
      ["Order ID", "Customer", "Product", "Package", "Amount", "Status", "Created", "Delivery Date"],
      ...filtered.map((order) => [order.id, order.customer, order.productName, order.packageName, String(order.amount), order.status, order.createdAt, order.deliveredDate ?? ""])
    ];
    downloadCsv(`sales-closer-orders-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Sales Closer</p>
          <h1 className="mt-1 text-2xl font-black text-gray-950">Orders Created</h1>
          <p className="mt-1 text-sm font-medium text-gray-500">Orders you have successfully created from leads</p>
        </div>
        <button type="button" className="!min-h-0 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50" onClick={exportCsv}>Export</button>
      </div>

      {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard icon={ShoppingCart} tone="bg-blue-100 text-blue-600" label="Orders Created" value={data?.kpis.ordersCreated.value ?? 0} delta={data?.kpis.ordersCreated.deltaVsLastMonth} deltaLabel="vs last month" sublabel="This month" />
        <KpiCard icon={Check} tone="bg-emerald-100 text-emerald-600" label="Delivered Orders" value={data?.kpis.deliveredOrders.value ?? 0} delta={data?.kpis.deliveredOrders.deltaVsLastMonth} deltaLabel="vs last month" sublabel="This month" />
        <KpiCard icon={Wallet} tone="bg-teal-100 text-teal-600" label="Delivered Revenue" value={data?.kpis.deliveredRevenue.value ?? 0} displayValue={money(data?.kpis.deliveredRevenue.value ?? 0)} delta={data?.kpis.deliveredRevenue.deltaVsLastMonth} deltaLabel="vs last month" deltaIsMoney sublabel="This month" />
        <KpiCard icon={TrendingUp} tone="bg-violet-100 text-violet-600" label="Average Order Value" value={data?.kpis.aov.value ?? 0} displayValue={money(data?.kpis.aov.value ?? 0)} delta={data?.kpis.aov.deltaVsLastMonth} deltaLabel="vs last month" deltaIsMoney sublabel="This month" />
        <KpiCard icon={Target} tone="bg-amber-100 text-amber-600" label="Delivery Rate" value={data?.kpis.deliveryRate.value ?? 0} displayValue={`${data?.kpis.deliveryRate.value ?? 0}%`} delta={data?.kpis.deliveryRate.deltaVsLastMonth} deltaLabel="pts vs last month" sublabel="This month" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white shadow-sm lg:col-span-3">
          <div className="flex flex-wrap gap-1 border-b border-gray-100 p-2">
            {ORDER_STATUS_TABS.map((item) => (
              <button key={item} type="button" className={`!min-h-0 rounded-lg px-3 py-2 text-xs font-bold transition ${tab === item ? "bg-blue-50 text-blue-700" : "text-gray-500 hover:bg-gray-50"}`} onClick={() => setTab(item)}>{item}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-3">Order ID</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Product &amp; Package</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                  <th className="px-4 py-3">Delivery Date</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">Loading orders...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-gray-400">No orders yet.</td></tr>
                ) : filtered.map((order) => (
                  <tr key={order.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 font-bold text-gray-900">{order.id}</td>
                    <td className="px-4 py-3 text-gray-700">{order.customer}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{order.productName}{order.packageName ? ` (${order.packageName})` : ""}</td>
                    <td className="px-4 py-3 font-bold text-gray-900">{money(order.amount)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ${ORDER_STATUS_TONE[order.status] ?? "border-gray-200 bg-gray-50 text-gray-600"}`}>{order.status}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(order.createdAt).toLocaleDateString("en-NG", { month: "short", day: "numeric" })}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{order.deliveredDate ? new Date(order.deliveredDate).toLocaleDateString("en-NG", { month: "short", day: "numeric" }) : "-"}</td>
                    <td className="px-4 py-3">
                      <button type="button" className="!min-h-0 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50" onClick={() => onOpenOrder(order.id)}>View Details</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-black uppercase tracking-wide text-gray-500">Conversion Summary (This Month)</h3>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between"><span className="text-gray-500">Leads Captured</span><span className="font-bold text-gray-900">{data?.conversionSummaryThisMonth.leadsCaptured ?? 0}</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-500">Orders Created</span><span className="font-bold text-gray-900">{data?.conversionSummaryThisMonth.ordersCreated ?? 0}</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-500">Delivered Orders</span><span className="font-bold text-gray-900">{data?.conversionSummaryThisMonth.deliveredOrders ?? 0}</span></div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-2"><span className="text-gray-500">Lead → Order Rate</span><span className="font-bold text-blue-600">{data?.conversionSummaryThisMonth.leadToOrderRate ?? 0}%</span></div>
              <div className="flex items-center justify-between"><span className="text-gray-500">Lead → Delivered Rate</span><span className="font-bold text-emerald-600">{data?.conversionSummaryThisMonth.leadToDeliveredRate ?? 0}%</span></div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-black uppercase tracking-wide text-gray-500">Top Products (by Revenue)</h3>
            <div className="mt-3 space-y-2.5">
              {(data?.topProducts ?? []).length === 0 ? (
                <p className="text-xs text-gray-400">Nothing this month yet.</p>
              ) : data!.topProducts.map((product) => (
                <div key={product.productName} className="flex items-center justify-between text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-gray-900">{product.productName}</p>
                    <p className="text-[11px] text-gray-400">{product.orders} order{product.orders === 1 ? "" : "s"}</p>
                  </div>
                  <span className="shrink-0 font-bold text-gray-700">{money(product.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SalesCloserWorkspacePage({ section, products, assignees, currentUserId, saving, error, onSaveLead, onCancelAddLead, onAction, leads, leadsLoading, leadsError, onUpdateLeadStatus, onOpenOrder, onConvertLead, overview, overviewLoading, overviewError, followUps, followUpsLoading, followUpsError, orders, ordersLoading, ordersError }: Props) {
  const [draft, setDraft] = useState<SalesLeadDraft>(() => defaultDraft(currentUserId));
  const [formError, setFormError] = useState("");
  const [showProductPicker, setShowProductPicker] = useState(false);

  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);
  const selectedProducts = useMemo(
    () => activeProducts.filter((product) => draft.interestedProductIds.includes(product.id)),
    [activeProducts, draft.interestedProductIds]
  );
  const packageOptions = useMemo(
    () => selectedProducts.flatMap((product) => product.packages.map((pkg) => ({ ...pkg, productName: product.name }))),
    [selectedProducts]
  );
  const currentAssignee = assignees.find((assignee) => assignee.id === currentUserId);

  const toggleProduct = (productId: string) => {
    setDraft((current) => {
      const has = current.interestedProductIds.includes(productId);
      return {
        ...current,
        interestedProductIds: has
          ? current.interestedProductIds.filter((id) => id !== productId)
          : [...current.interestedProductIds, productId],
        // The package list is derived from the selected products, so a
        // package chosen before this toggle may no longer be one of the
        // options - never leave a stale id the dropdown can't display.
        packageId: ""
      };
    });
  };

  const toggleTag = (tag: string) => {
    setDraft((current) => ({
      ...current,
      tags: current.tags.includes(tag) ? current.tags.filter((item) => item !== tag) : [...current.tags, tag]
    }));
  };

  const submit = async () => {
    if (!draft.fullName.trim()) return setFormError("Enter the customer's full name.");
    if (!draft.phone.trim()) return setFormError("Enter a phone number.");
    if (draft.interestedProductIds.length === 0) return setFormError("Choose at least one product the customer is interested in.");
    setFormError("");
    try {
      await onSaveLead(draft);
      setDraft(defaultDraft(currentUserId));
    } catch (saveError: any) {
      setFormError(saveError?.message ?? "Could not save this lead.");
    }
  };

  if (section === "leads") {
    return (
      <LeadsInboxSection
        leads={leads}
        loading={leadsLoading}
        error={leadsError}
        products={products}
        onUpdateLeadStatus={onUpdateLeadStatus}
        onOpenOrder={onOpenOrder}
        onConvertLead={onConvertLead}
        onAddLead={() => onAction("add-lead")}
      />
    );
  }

  if (section === "overview") {
    return <OverviewSection overview={overview} loading={overviewLoading} error={overviewError} onAction={onAction} />;
  }

  if (section === "follow-ups") {
    return <FollowUpsSection data={followUps} loading={followUpsLoading} error={followUpsError} onAddLead={() => onAction("add-lead")} />;
  }

  if (section === "orders-created") {
    return <OrdersCreatedSection data={orders} loading={ordersLoading} error={ordersError} onOpenOrder={onOpenOrder} />;
  }

  if (section !== "add-lead") {
    const label = section === "my-performance" ? "My Performance"
      : section === "my-bonuses" ? "My Bonuses"
      : section === "scripts-templates" ? "Scripts & Templates"
      : section === "products" ? "Products"
      : section === "report-issue" ? "Report an Issue"
      : "Sales Closer";
    const icon = section === "my-performance" ? TrendingUp
      : section === "my-bonuses" ? Wallet
      : section === "scripts-templates" ? StickyNote
      : section === "products" ? Package
      : section === "report-issue" ? AlertTriangle
      : HelpCircle;
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Sales Closer</p>
          <h1 className="mt-1 text-2xl font-black text-gray-950">{label}</h1>
        </div>
        <ComingSoon icon={icon} title={label} />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-gray-400"><button type="button" className="!min-h-0 hover:underline" onClick={() => onAction("overview")}>Dashboard</button> &gt; Add Lead</p>
          <h1 className="mt-1 text-2xl font-black text-gray-950">Add New Lead</h1>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="!min-h-0 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-600" onClick={onCancelAddLead}>Cancel</button>
          <button type="button" className="!min-h-0 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 disabled:opacity-50" disabled={saving} onClick={submit}>
            {saving ? "Saving..." : <>Save Lead</>}
          </button>
        </div>
      </div>

      {(formError || error) && <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">{formError || error}</p>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <CardHeader icon={UserPlus} title="Lead Information" subtitle="Add the customer's basic details" tone="bg-blue-50 text-blue-600" />
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FieldLabel label="Full Name" required><input className={fieldClass} placeholder="e.g. Chiamaka Okoye" value={draft.fullName} onChange={(event) => setDraft((current) => ({ ...current, fullName: event.target.value }))} /></FieldLabel>
                <FieldLabel label="Phone Number" required><PhoneField value={draft.phone} placeholder="801 234 5678" onChange={(value) => setDraft((current) => ({ ...current, phone: value }))} /></FieldLabel>
                <FieldLabel label="Alternate Phone"><input className={fieldClass} placeholder="e.g. 812 345 6789" value={draft.alternatePhone} onChange={(event) => setDraft((current) => ({ ...current, alternatePhone: event.target.value }))} /></FieldLabel>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FieldLabel label="WhatsApp Number"><PhoneField value={draft.whatsappNumber} placeholder="801 234 5678" onChange={(value) => setDraft((current) => ({ ...current, whatsappNumber: value }))} /></FieldLabel>
                <FieldLabel label="Email Address"><input type="email" className={fieldClass} placeholder="e.g. chiamaka@gmail.com" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} /></FieldLabel>
                <FieldLabel label="Preferred Contact Method">
                  <select className={fieldClass} value={draft.preferredContactMethod} onChange={(event) => setDraft((current) => ({ ...current, preferredContactMethod: event.target.value as SalesLeadDraft["preferredContactMethod"] }))}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="call">Call</option>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                </FieldLabel>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FieldLabel label="Location / State">
                  <select className={fieldClass} value={draft.state} onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value }))}>
                    <option value="">Select state</option>
                    {NIGERIA_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="City / Area"><input className={fieldClass} placeholder="e.g. Ikeja, Lagos" value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} /></FieldLabel>
                <FieldLabel label="Full Address"><input className={fieldClass} placeholder="e.g. 23, Allen Avenue, Ikeja, Lagos" value={draft.address} onChange={(event) => setDraft((current) => ({ ...current, address: event.target.value }))} /></FieldLabel>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FieldLabel label="Source / Channel" required>
                  <select className={fieldClass} value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value as SalesLeadDraft["source"] }))}>
                    {SOURCE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FieldLabel>
                <FieldLabel label="Campaign (Optional)"><input className={fieldClass} placeholder="e.g. Edge Brusher - TikTok Video 03" value={draft.campaign} onChange={(event) => setDraft((current) => ({ ...current, campaign: event.target.value }))} /></FieldLabel>
                <FieldLabel label="Lead Status" required>
                  <select className={fieldClass} value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as SalesLeadDraft["status"] }))}>
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </FieldLabel>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <CardHeader icon={Package} title="Product Interest" subtitle="What products is the customer interested in?" tone="bg-violet-50 text-violet-600" />
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FieldLabel label="Interested Products" required>
                  <div className="relative">
                    <button type="button" className={`${fieldClass} flex items-center justify-between text-left`} onClick={() => setShowProductPicker((open) => !open)}>
                      <span className={selectedProducts.length === 0 ? "text-gray-400" : ""}>
                        {selectedProducts.length === 0 ? "Select product(s)" : selectedProducts.map((product) => product.name).join(", ")}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                    </button>
                    {showProductPicker && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setShowProductPicker(false)} />
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                          {activeProducts.map((product) => (
                            <label key={product.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-gray-50">
                              <input type="checkbox" className="rounded accent-blue-600" checked={draft.interestedProductIds.includes(product.id)} onChange={() => toggleProduct(product.id)} />
                              <span className="text-sm font-medium text-gray-700">{product.name}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs font-medium text-gray-400">You can select multiple products</p>
                </FieldLabel>
                <FieldLabel label="Product Package / Variant (Optional)">
                  <select className={fieldClass} value={draft.packageId} disabled={packageOptions.length === 0} onChange={(event) => setDraft((current) => ({ ...current, packageId: event.target.value }))}>
                    <option value="">Select package or variant</option>
                    {packageOptions.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.productName} - {pkg.name}</option>)}
                  </select>
                  <p className="mt-1.5 text-xs font-medium text-gray-400">e.g. 3pcs, 5pcs, 10pcs etc.</p>
                </FieldLabel>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <CardHeader icon={StickyNote} title="Lead Notes" subtitle="Add any important notes about this lead" tone="bg-amber-50 text-amber-600" />
            <div className="p-5">
              <textarea
                className={`${fieldClass} min-h-[96px] resize-y`}
                maxLength={500}
                placeholder="e.g. Customer asked about delivery time, price concern, wants to compare packages..."
                value={draft.notes}
                onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              />
              <p className="mt-1.5 text-right text-xs font-medium text-gray-400">{draft.notes.length} / 500</p>
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <CardHeader icon={Tag} title="Lead Tag" subtitle="Add tags to help organize this lead" tone="bg-emerald-50 text-emerald-600" />
            <div className="space-y-3 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Tags (Optional)</p>
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 -mt-1">Quick Tags</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_TAGS.map((tag) => {
                  const active = draft.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      className={`!min-h-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? "border-blue-400 bg-blue-50 text-blue-700" : "border-gray-200 bg-white text-gray-600"}`}
                      onClick={() => toggleTag(tag)}
                    >
                      {active && <Check className="mr-1 inline h-3 w-3" />}{tag}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <CardHeader icon={Sparkles} title="Lead Priority" subtitle="Set how important this lead is" tone="bg-rose-50 text-rose-600" />
            <div className="space-y-2 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Priority Level</p>
              <select className={fieldClass} value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as SalesLeadDraft["priority"] }))}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <p className="text-xs font-medium text-gray-400">High priority leads will be shown at the top of your list</p>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <CardHeader icon={Calendar} title="Assign & Schedule" subtitle="Assign follow-up and set reminder" tone="bg-indigo-50 text-indigo-600" />
            <div className="space-y-4 p-5">
              <FieldLabel label="Assign Follow-up To" required>
                <select className={fieldClass} value={draft.assignedCloserId} onChange={(event) => setDraft((current) => ({ ...current, assignedCloserId: event.target.value }))}>
                  {currentAssignee && <option value={currentAssignee.id}>{currentAssignee.name} (You)</option>}
                  {assignees.filter((assignee) => assignee.id !== currentUserId).map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
                </select>
              </FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                <FieldLabel label="Follow-up Date"><input type="date" className={fieldClass} value={draft.followUpDate} onChange={(event) => setDraft((current) => ({ ...current, followUpDate: event.target.value }))} /></FieldLabel>
                <FieldLabel label="Follow-up Time"><input type="time" className={fieldClass} value={draft.followUpTime} onChange={(event) => setDraft((current) => ({ ...current, followUpTime: event.target.value }))} /></FieldLabel>
              </div>
              <p className="text-xs font-medium text-gray-400">You will be reminded to follow up on this lead</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
