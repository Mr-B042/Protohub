import { useMemo, useState, type ReactNode } from "react";
import { NIGERIA_STATES } from "../lib/nigeria";
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  HelpCircle,
  Home,
  Inbox,
  Package,
  Sparkles,
  StickyNote,
  Tag,
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
  source: "whatsapp" | "instagram" | "tiktok" | "facebook" | "website" | "other";
  campaign: string;
  interestedProductIds: string[];
  packageId: string;
  notes: string;
  status: "new_lead" | "contacted" | "qualified" | "follow_up" | "not_interested";
  tags: string[];
  priority: "low" | "medium" | "high";
  assignedCloserId: string;
  followUpDate: string;
  followUpTime: string;
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

export function SalesCloserWorkspacePage({ section, products, assignees, currentUserId, saving, error, onSaveLead, onCancelAddLead, onAction }: Props) {
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

  if (section !== "add-lead") {
    const label = section === "overview" ? "Overview"
      : section === "leads" ? "Leads / Inbox"
      : section === "follow-ups" ? "Follow-ups"
      : section === "orders-created" ? "Orders Created"
      : section === "my-performance" ? "My Performance"
      : section === "my-bonuses" ? "My Bonuses"
      : section === "scripts-templates" ? "Scripts & Templates"
      : section === "products" ? "Products"
      : section === "report-issue" ? "Report an Issue"
      : "Sales Closer";
    const icon = section === "overview" ? Home
      : section === "leads" ? Inbox
      : section === "follow-ups" ? Clock
      : section === "orders-created" ? Package
      : section === "my-performance" ? TrendingUp
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
