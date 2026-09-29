import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

export type UpgradeBonusRule = { id?: string; fromQty: number; toQty: number; amount: number };

/**
 * The rules with one pair's bonus set - or removed, for null. The pair keeps
 * its place and its id; any duplicate of the pair is dropped, since payroll
 * only ever paid the first one.
 */
export function withUpgradeAmount<T extends UpgradeBonusRule>(rules: T[], fromQty: number, toQty: number, amount: number | null): T[] {
  const index = rules.findIndex((rule) => rule.fromQty === fromQty && rule.toQty === toQty);
  const others = rules.filter((rule) => !(rule.fromQty === fromQty && rule.toQty === toQty));
  if (amount === null) return others;
  const existing = index >= 0 ? rules[index] : undefined;
  const rule = { ...existing, id: existing?.id || `up-${fromQty}-${toQty}`, fromQty, toQty, amount } as T;
  const at = index >= 0 ? rules.slice(0, index).filter((r) => !(r.fromQty === fromQty && r.toQty === toQty)).length : others.length;
  return [...others.slice(0, at), rule, ...others.slice(at)];
}

/**
 * The upgrade bonus as ONE grid: what the customer first ordered down the side,
 * what the rep moved them up to across the top, the bonus where the two meet.
 *
 * ⚠️ WHY A GRID, NOT A LIST OF RULES. The list showed each rule as its own
 * "From [1] → [2] = ₦[2800]" card, in the order they were typed. Eleven of them
 * could not be read at a glance - Bright: "is not attractive". In a grid the
 * amounts line up, a missing upgrade is a visible gap, and the pattern (bigger
 * jump, bigger bonus) is obvious.
 *
 * Cells are keyed by the (from, to) pair, never by a rule id, so a rule saved
 * without an id - the bug behind PR #663 - cannot make a box ignore typing.
 * An empty box means no rule; clearing a box removes its rule. Both pay ₦0, the
 * same as a rule of ₦0, so nothing about pay depends on the difference.
 */
export default function UpgradeBonusGrid({
  rules,
  minDeliveryRate,
  packageQuantities,
  symbol,
  onSetAmount,
  onMinDeliveryRateChange
}: {
  rules: UpgradeBonusRule[];
  minDeliveryRate: number;
  /** The product's package sizes - offered as rows and columns even before any rule uses them. */
  packageQuantities: number[];
  symbol: string;
  /** null removes the rule for that pair. */
  onSetAmount: (fromQty: number, toQty: number, amount: number | null) => void;
  onMinDeliveryRateChange: (value: number) => void;
}) {
  // Sizes added here but not yet used by a rule. Kept on screen only: a size
  // with no bonus in it has nothing to save.
  const [extraSizes, setExtraSizes] = useState<number[]>([]);
  const [newSize, setNewSize] = useState("");

  // First rule wins for a pair, exactly as payroll picks it.
  const amountByPair = useMemo(() => {
    const map = new Map<string, number>();
    for (const rule of rules) {
      const key = `${rule.fromQty}-${rule.toQty}`;
      if (!map.has(key)) map.set(key, Number(rule.amount) || 0);
    }
    return map;
  }, [rules]);

  const sizes = useMemo(() => {
    const all = new Set<number>();
    for (const rule of rules) {
      if (rule.fromQty > 0) all.add(rule.fromQty);
      if (rule.toQty > 0) all.add(rule.toQty);
    }
    for (const qty of [...packageQuantities, ...extraSizes]) if (qty > 0) all.add(qty);
    return [...all].sort((a, b) => a - b);
  }, [rules, packageQuantities, extraSizes]);

  const fromSizes = sizes.slice(0, -1);
  const toSizes = sizes.slice(1);
  const filled = [...amountByPair.values()].filter((amount) => amount > 0).length;

  const addSize = () => {
    const qty = Math.round(Number(newSize));
    if (!Number.isFinite(qty) || qty <= 0) return;
    setExtraSizes((prev) => (prev.includes(qty) ? prev : [...prev, qty]));
    setNewSize("");
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <strong className="text-sm text-gray-900 dark:text-slate-100">2. Upgrade Bonus</strong>
          <p className="m-0 text-[11px] leading-4 text-gray-500 dark:text-slate-400">
            Paid when a rep moves a customer up to a bigger package. {filled} upgrade{filled === 1 ? "" : "s"} set.
          </p>
        </div>
        <label className="inline-flex shrink-0 items-center gap-2 self-start rounded-[8px] border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900">
          <span className="text-gray-600 dark:text-slate-300">Full bonus from a weekly delivery rate of</span>
          <span className="inline-flex items-center rounded-[6px] border border-gray-200 px-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 dark:border-slate-700">
            <input
              aria-label="Weekly delivery rate needed for the full upgrade bonus"
              inputMode="numeric"
              className="!min-h-0 h-6 w-8 border-0 !bg-transparent p-0 text-right text-xs font-bold text-gray-900 focus-visible:!outline-none dark:!text-slate-100"
              value={minDeliveryRate}
              onChange={(event) => onMinDeliveryRateChange(Number(event.target.value.replace(/[^\d]/g, "")) || 0)}
            />
            <span className="text-gray-400">%</span>
          </span>
        </label>
      </div>
      <p className="m-0 -mt-1 text-[11px] leading-4 text-gray-500 dark:text-slate-400">
        Below {minDeliveryRate}%, the rep gets half.
      </p>

      {sizes.length < 2 ? (
        <p className="m-0 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-4 text-center text-xs text-gray-500 dark:border-slate-700 dark:bg-slate-900">
          Add at least two package sizes below to set an upgrade bonus.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {/* ⚠️ !min-w-0: the app gives every <table> a 1,040px minimum
              (styles.css), which pushed the last columns out of the window. */}
          <table className="w-full !min-w-0 border-collapse text-xs tabular-nums [&_td]:!border-gray-100 [&_th]:!border-gray-100 dark:[&_td]:!border-slate-800 dark:[&_th]:!border-slate-800">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left text-[10px] font-semibold uppercase leading-4 tracking-wider text-gray-500 dark:!bg-slate-800 dark:!text-slate-400">
                  <span className="block whitespace-nowrap">To →</span>
                  <span className="block whitespace-nowrap">Ordered ↓</span>
                </th>
                {toSizes.map((to) => (
                  <th key={to} scope="col" className="bg-gray-50 px-2 py-2 text-center text-[13px] font-black text-gray-800 dark:!bg-slate-800 dark:!text-slate-200">
                    {to}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fromSizes.map((from) => (
                <tr key={from} className="border-t border-gray-100 dark:border-slate-800">
                  <th scope="row" className="sticky left-0 z-10 bg-white px-3 py-1.5 align-middle text-left text-[13px] font-black text-gray-800 dark:!bg-slate-900 dark:!text-slate-200">
                    {from}
                  </th>
                  {toSizes.map((to) => (
                    to <= from ? (
                      <td key={to} aria-hidden className="bg-gray-50/80 dark:!bg-slate-800/40" />
                    ) : (
                      <td key={to} className="px-1.5 py-1.5">
                        <AmountCell
                          label={`Bonus for upgrading ${from} to ${to}`}
                          symbol={symbol}
                          value={amountByPair.has(`${from}-${to}`) ? amountByPair.get(`${from}-${to}`)! : null}
                          onChange={(amount) => onSetAmount(from, to, amount)}
                        />
                      </td>
                    )
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 text-[11px] leading-4 text-gray-500 dark:text-slate-400">
          Clear a box to remove that upgrade. An empty box pays nothing.
        </p>
        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          <input
            aria-label="New package size"
            inputMode="numeric"
            placeholder="Size"
            className="!min-h-0 h-8 w-16 rounded-[6px] border border-gray-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900"
            value={newSize}
            onChange={(event) => setNewSize(event.target.value.replace(/[^\d]/g, ""))}
            onKeyDown={(event) => { if (event.key === "Enter") addSize(); }}
          />
          <button
            type="button"
            onClick={addSize}
            disabled={!newSize}
            className="!min-h-0 inline-flex h-8 items-center gap-1 rounded-[6px] bg-blue-600 px-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />Add size
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * One bonus box. Shows "2,800" at rest; while typing it shows plain digits so
 * the cursor never jumps as commas appear.
 */
function AmountCell({ value, symbol, label, onChange }: {
  value: number | null;
  symbol: string;
  label: string;
  onChange: (amount: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === null ? "" : value.toLocaleString("en-NG"));
  const paying = value !== null && value > 0;
  return (
    <label
      className={`flex h-8 min-w-[6.5rem] items-center gap-1 rounded-[6px] border px-2 transition-colors focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100 ${
        paying
          ? "border-emerald-200 bg-emerald-50 dark:!border-emerald-800 dark:!bg-emerald-950/60"
          : value === null
            ? "border-dashed border-gray-200 bg-white dark:!border-slate-700 dark:!bg-slate-900"
            : "border-gray-200 bg-white dark:!border-slate-700 dark:!bg-slate-900"
      }`}
    >
      <span className={`text-[11px] font-semibold ${paying ? "text-emerald-700 dark:text-emerald-400" : "text-gray-300 dark:text-slate-600"}`}>
        {symbol}
      </span>
      <input
        aria-label={label}
        inputMode="numeric"
        placeholder="—"
        className="!min-h-0 h-full w-full min-w-0 border-0 !bg-transparent p-0 text-right text-xs font-bold text-gray-900 placeholder:font-normal placeholder:text-gray-300 focus-visible:!outline-none dark:!text-slate-100"
        value={shown}
        onFocus={() => setDraft(value === null ? "" : String(value))}
        onBlur={() => setDraft(null)}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^\d]/g, "");
          setDraft(digits);
          onChange(digits === "" ? null : Number(digits));
        }}
      />
    </label>
  );
}
