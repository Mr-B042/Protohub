import { Ban, CalendarDays, CalendarPlus, ChevronDown, Coins, Info, MailOpen, MapPin, Plus, RefreshCw, ShoppingCart, Tag, Trash2, Users } from "lucide-react";
import type { EmCondition, EmConditionField, EmDesigner, EmDesignerProduct } from "../../lib/api";
import { select } from "./em-ui";

/** Condition rows: "Match All / Any" + rows (images 45 and D). */

const GROUP_ICON: Record<string, typeof Users> = {
  "Purchase History": ShoppingCart, "Purchase Frequency": RefreshCw, "Last Purchase": CalendarDays, "First Purchase": CalendarPlus,
  "Money Spent": Coins, Location: MapPin, Carts: ShoppingCart, "Email Activity": MailOpen, "Email List": Users
};
const DAY_CHOICES = [1, 3, 7, 14, 30, 60, 90, 180, 365];
const SOURCE_CHOICES = [{ value: "order", label: "Order form" }, { value: "cart", label: "Unfinished order (cart)" }, { value: "manual", label: "Added by hand" }, { value: "import", label: "Uploaded list" }];
const STATUS_CHOICES = [{ value: "subscribed", label: "Subscribed" }, { value: "unsubscribed", label: "Unsubscribed" }, { value: "bounced", label: "Bounced" }, { value: "cleaned", label: "Cleaned (list clean-up)" }];
export const CHANNELS = ["Facebook", "Instagram", "TikTok", "Website", "Audience Network", "Threads", "WhatsApp", "Direct"];

export type BuilderOptions = { fields: EmConditionField[]; products: EmDesignerProduct[]; states: string[]; tags: EmDesigner["tags"] };

export function defaultValue(field: EmConditionField, o: BuilderOptions): string | number {
  switch (field.value) {
    case "product": return o.products[0]?.id ?? "";
    case "number": return 2;
    case "days": return 30;
    case "money": return 50000;
    case "percent": return 20;
    case "state": return o.states.includes("Lagos") ? "Lagos" : o.states[0] ?? "Lagos";
    case "source": return "order";
    case "status": return "unsubscribed";
    case "tag": return o.tags[0]?.id ?? "";
    case "channel": return "Facebook";
    case "quiet": return "any";
    default: return "yes";
  }
}

const cell = `${select} !py-2 !text-[13px] !font-semibold`;
/** Why their latest order went quiet (read from the rep's last call note). */
const QUIET_CHOICES = [
  { value: "any", label: "Any reason" },
  { value: "unreachable", label: "Stopped picking calls or replying" },
  { value: "not_ready", label: "Not ready yet (travel, money, timing)" },
  { value: "let_down", label: "We let them down (stock, area)" },
  { value: "said_no", label: "Said no thanks" },
  { value: "other", label: "Other or no reason written" }
];

export function ConditionRow({ condition, options, onChange, onRemove, iconTile = false, exclusion = false }: {
  condition: EmCondition;
  options: BuilderOptions;
  onChange: (next: EmCondition) => void;
  onRemove: () => void;
  iconTile?: boolean;
  exclusion?: boolean;
}) {
  const field = options.fields.find((row) => row.field === condition.field) ?? options.fields[0];
  const Icon = exclusion ? Ban : GROUP_ICON[field?.group ?? ""] ?? Users;
  if (!field) return null;
  return (
    <div className={`grid items-center gap-2 ${iconTile ? "grid-cols-[auto_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.95fr)_auto]" : "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"}`}>
      {iconTile && <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${exclusion ? "bg-rose-50 text-rose-500 dark:bg-rose-500/10" : "bg-[#F5F2FE] text-[#5B3FD9] dark:bg-violet-500/15"}`}><Icon className="h-4 w-4" /></span>}
      <label className="relative">
        {!iconTile && <Icon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B3FD9]" />}
        <select aria-label="Condition" value={condition.field} className={`${cell} ${iconTile ? "" : "!pl-8"}`}
          onChange={(event) => {
            const next = options.fields.find((row) => row.field === event.target.value)!;
            onChange({ field: next.field, op: next.ops[0].op, value: defaultValue(next, options) });
          }}>
          {options.fields.map((row) => <option key={row.field} value={row.field}>{row.label}</option>)}
        </select>
      </label>
      <select aria-label="Test" value={condition.op} onChange={(event) => onChange({ ...condition, op: event.target.value })} className={cell}>
        {field.ops.map((op) => <option key={op.op} value={op.op}>{op.label}</option>)}
      </select>
      <ValueInput field={field} op={condition.op} value={condition.value} options={options} onChange={(value) => onChange({ ...condition, value })} />
      <button type="button" aria-label="Remove condition" onClick={onRemove}
        className="!min-h-0 inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#5B3FD9] hover:bg-[#F5F2FE] dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
    </div>
  );
}

export default function SegmentBuilder({ match, conditions, fields, products, states, tags = [], onChange, compact = false, dropdownMatch = false }: {
  match: "all" | "any";
  conditions: EmCondition[];
  fields: EmConditionField[];
  products: EmDesignerProduct[];
  states: string[];
  tags?: EmDesigner["tags"];
  onChange: (next: { match: "all" | "any"; conditions: EmCondition[] }) => void;
  compact?: boolean;
  /** Create Segment (image D): a Match dropdown and icon tiles on each row. */
  dropdownMatch?: boolean;
}) {
  const options: BuilderOptions = { fields, products, states, tags };
  const set = (index: number, next: EmCondition) => onChange({ match, conditions: conditions.map((row, i) => (i === index ? next : row)) });
  const add = () => {
    const field = fields.find((row) => row.field === "purchase_count") ?? fields[0];
    if (!field) return;
    onChange({ match, conditions: [...conditions, { field: field.field, op: field.ops[0].op, value: defaultValue(field, options) }] });
  };
  return (
    <div className={`rounded-xl border border-gray-200 dark:border-slate-700 ${compact ? "p-3" : "p-4"}`}>
      {dropdownMatch ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-gray-900 dark:text-slate-50"><Users className="h-4 w-4" />Match</span>
          <label className="relative">
            <select aria-label="Match" value={match} onChange={(event) => onChange({ match: event.target.value as "all" | "any", conditions })}
              className="!min-h-0 appearance-none border-0 bg-transparent pr-6 text-[14px] !font-bold text-gray-900 outline-none dark:text-slate-50">
              <option value="all">All Conditions (AND)</option><option value="any">Any Condition (OR)</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
          </label>
          <span className="ml-auto inline-flex items-center gap-1 text-[12px] text-gray-600 dark:text-slate-400"><Info className="h-3.5 w-3.5" />Customer must meet {match === "all" ? "ALL" : "ANY"} of the conditions below.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[13.5px] font-bold text-gray-900 dark:text-slate-50">Match</span>
          {(["all", "any"] as const).map((value) => (
            <button key={value} type="button" onClick={() => onChange({ match: value, conditions })}
              className={`!min-h-0 rounded-lg border px-3.5 py-1.5 text-[13px] font-semibold ${match === value ? "border-[#5B3FD9] bg-[#5B3FD9] text-white" : "border-gray-200 bg-white text-gray-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"}`}>
              {value === "all" ? "All Conditions (AND)" : "Any Condition (OR)"}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 space-y-2">
        {conditions.map((condition, index) => (
          <ConditionRow key={index} condition={condition} options={options} iconTile={dropdownMatch} onChange={(next) => set(index, next)}
            onRemove={() => onChange({ match, conditions: conditions.filter((_, i) => i !== index) })} />
        ))}
      </div>
      <button type="button" onClick={add}
        className={`!min-h-0 mt-3 flex items-center justify-center gap-2 rounded-xl border border-[#B9A8F5] py-2.5 text-[13.5px] font-bold text-[#5B3FD9] hover:bg-[#F3EFFE] ${dropdownMatch ? "mx-auto bg-white px-5 dark:bg-slate-900" : "w-full border-dashed bg-[#FAF8FF] dark:bg-violet-500/5"}`}>
        <Plus className="h-4 w-4" />Add Condition
      </button>
    </div>
  );
}

function ValueInput({ field, op, value, options, onChange }: { field: EmConditionField; op: string; value: string | number; options: BuilderOptions; onChange: (value: string | number) => void }) {
  if (field.value === "product") {
    return <select aria-label="Product" value={String(value)} onChange={(event) => onChange(event.target.value)} className={cell}>{options.products.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>;
  }
  if (field.value === "days") {
    return <select aria-label="Days" value={String(value)} onChange={(event) => onChange(Number(event.target.value))} className={cell}>{DAY_CHOICES.map((days) => <option key={days} value={days}>{days} day{days === 1 ? "" : "s"}{field.unit && op === "over" ? ` ${field.unit}` : ""}</option>)}</select>;
  }
  if (field.value === "percent") {
    return <select aria-label="Top" value={String(value)} onChange={(event) => onChange(Number(event.target.value))} className={cell}>{[10, 20, 25, 50].map((n) => <option key={n} value={n}>{n}{field.unit ?? "%"}</option>)}</select>;
  }
  if (field.value === "state") {
    return <select aria-label="State" value={String(value)} onChange={(event) => onChange(event.target.value)} className={cell}>{(options.states.length ? options.states : ["Lagos"]).map((state) => <option key={state} value={state}>{state}</option>)}</select>;
  }
  if (field.value === "source") {
    return <select aria-label="Source" value={String(value)} onChange={(event) => onChange(event.target.value)} className={cell}>{SOURCE_CHOICES.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select>;
  }
  if (field.value === "status") {
    return <select aria-label="Status" value={String(value)} onChange={(event) => onChange(event.target.value)} className={`${cell} ${value === "unsubscribed" ? "!border-rose-200 !bg-rose-50 !text-rose-600 dark:!bg-rose-500/10" : ""}`}>{STATUS_CHOICES.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select>;
  }
  if (field.value === "tag") {
    return options.tags.length
      ? <select aria-label="Tag" value={String(value)} onChange={(event) => onChange(event.target.value)} className={cell}>{options.tags.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
      : <span className="inline-flex items-center gap-1 text-[12.5px] text-gray-500"><Tag className="h-3.5 w-3.5" />No tags yet</span>;
  }
  if (field.value === "channel") {
    return <select aria-label="Source" value={String(value)} onChange={(event) => onChange(event.target.value)} className={cell}>{CHANNELS.map((row) => <option key={row} value={row}>{row}</option>)}</select>;
  }
  if (field.value === "quiet") {
    return <select aria-label="Why" value={String(value)} onChange={(event) => onChange(event.target.value)} className={cell}>{QUIET_CHOICES.map((row) => <option key={row.value} value={row.value}>{row.label}</option>)}</select>;
  }
  if (field.value === "none") return <span className="text-[12.5px] text-gray-500">—</span>;
  return (
    <span className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 dark:border-slate-700 dark:bg-slate-950">
      {field.value === "money" && <span className="text-[13px] text-gray-500">₦</span>}
      <input aria-label="Value" type="number" min={0} value={String(value)} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="!min-h-0 w-full min-w-0 border-0 bg-transparent py-2 text-[13px] font-semibold text-gray-900 outline-none dark:text-slate-100" />
      {field.unit && field.value === "number" && <span className="text-[12.5px] text-gray-500">{field.unit}</span>}
    </span>
  );
}
