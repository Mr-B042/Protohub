import { useMemo, useState } from "react";
import { AlertOctagon, Eye, PauseCircle, Rocket, ThumbsUp } from "lucide-react";
import type { HubSinceStart } from "../../lib/api";
import { adCalc, type AdCalcInput, type AdCalcStatus } from "../../lib/ad-calculator";
import { currencySymbol } from "../../lib/money-privacy";
import { Modal, outlineButton, selectCls } from "./HubParts";

/**
 * Break-even calculator (Bright's ad framework, part 6, 16 Nov 2026): pick a
 * product to fill in its real numbers (delivered orders 7–37 days ago, and its
 * campaigns' cost per order since they started), then change any box to ask
 * "what if". Maths: src/lib/ad-calculator.ts.
 */

type Field = Exclude<keyof AdCalcInput, "deliveryRate">;
const FIELDS: Array<{ key: Field; label: string; hint: string }> = [
  { key: "price", label: "Selling price", hint: "What the customer pays" },
  { key: "productCost", label: "Product cost", hint: "Cost of the goods" },
  { key: "deliveryCost", label: "Delivery cost", hint: "Agent's fee per delivered order" },
  { key: "commission", label: "Rep commission & bonus", hint: "Per delivered order" },
  { key: "otherCost", label: "Other costs", hint: "Packaging, waybill… per delivered order" },
  { key: "failedCost", label: "Cost per failed order", hint: "Money lost when an order is not delivered" },
  { key: "cpp", label: "Ad cost per placed order", hint: "Ad spend ÷ Protohub orders (not Meta purchases)" }
];

const STATUS: Record<AdCalcStatus, { title: string; text: string; tone: string; Icon: typeof Rocket }> = {
  scale: { title: "Scale", text: "Well under break-even. Raise the budget slowly (about 20% every 2–3 days) while it stays there.", tone: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200", Icon: Rocket },
  keep: { title: "Keep running", text: "Under break-even: each delivered order makes money after ads.", tone: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200", Icon: ThumbsUp },
  watch: { title: "Watch", text: "Close to break-even. Don't raise the budget; turn it off if it goes above.", tone: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200", Icon: Eye },
  turn_off: { title: "Turn off", text: "Above break-even: every delivered order loses money on ads.", tone: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200", Icon: AlertOctagon },
  no_profit: { title: "Loses money even with free ads", text: "Costs and failed orders are more than a delivery earns. Fix the price, costs or delivery rate first.", tone: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200", Icon: PauseCircle }
};

const EMPTY: Record<Field, string> = { price: "", productCost: "", deliveryCost: "", commission: "", otherCost: "", failedCost: "", cpp: "" };
const num = (text: string) => Number(text.replace(/[^\d.]/g, "")) || 0;
const round = (value: number) => String(Math.round(value));

export default function AdCalculator({ data, onClose }: { data: HubSinceStart; onClose: () => void }) {
  const sym = currencySymbol();
  const cash = (value: number | null) => (value === null ? "—" : `${value < 0 ? "−" : ""}${sym}${Math.round(Math.abs(value)).toLocaleString("en-NG")}`);
  const products = useMemo(() => data.targets.filter((row) => row.averages || data.rows.some((r) => r.productId === row.productId)).sort((a, b) => a.name.localeCompare(b.name)), [data]);
  const [productId, setProductId] = useState("");
  const [values, setValues] = useState<Record<Field, string>>(EMPTY);
  const [rate, setRate] = useState(65);
  const [filledFrom, setFilledFrom] = useState("");

  const pick = (id: string) => {
    setProductId(id);
    const row = data.targets.find((t) => t.productId === id);
    if (!row) { setFilledFrom(""); return; }
    const camp = data.rows.filter((r) => r.productId === id);
    const spend = camp.reduce((s, r) => s + r.spend, 0);
    const orders = camp.reduce((s, r) => s + r.orders, 0);
    setValues({
      ...EMPTY,
      price: row.averages ? round(row.averages.price) : "",
      productCost: row.averages ? round(row.averages.productCost) : "",
      deliveryCost: row.averages ? round(row.averages.deliveryFee) : "",
      cpp: orders > 0 ? round(spend / orders) : ""
    });
    const r = row.deliveryRate ?? row.deliveredRate ?? null;
    if (r !== null && r !== undefined) setRate(Math.max(10, Math.round(r * 100)));
    setFilledFrom([
      row.averages ? `average of delivered orders placed 7–37 days ago (${row.basedOn} orders)` : "no delivered order 7–37 days ago: type the price and costs",
      orders > 0 ? `ad cost from its campaigns since they started (${orders} orders)` : "no campaign orders yet: type the ad cost"
    ].join("; "));
  };

  const input: AdCalcInput = { ...(Object.fromEntries(FIELDS.map((f) => [f.key, num(values[f.key])])) as Record<Field, number>), deliveryRate: rate };
  const r = adCalc(input);
  const s = STATUS[r.status];
  const target = data.targets.find((t) => t.productId === productId)?.own ?? null;

  return (
    <Modal wide title="Break-even calculator" subtitle="Judge an ad by profit per delivered order, not by CPC." onClose={onClose}>
      <div className="grid gap-5 md:grid-cols-[1fr_1.05fr]">
        <div className="space-y-3">
          <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-200">Fill in from a product
            <select value={productId} onChange={(e) => pick(e.target.value)} className={`${selectCls} mt-1 w-full`}>
              <option value="">Type my own numbers</option>
              {products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
            </select>
          </label>
          {filledFrom && <p className="m-0 text-[11.5px] text-gray-500 dark:text-slate-400">Filled from: {filledFrom}. Change any box.</p>}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className={`block text-[12.5px] font-semibold text-gray-700 dark:text-slate-200 ${f.key === "cpp" ? "sm:col-span-2" : ""}`}>{f.label}
                <span className="mt-1 flex h-10 items-center rounded-lg border border-gray-200 bg-white px-2.5 focus-within:border-[#8B74EE] dark:border-slate-700 dark:bg-slate-900">
                  <span className="mr-1 text-gray-400">{sym}</span>
                  <input inputMode="numeric" value={values[f.key]} placeholder="0" onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                    className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[14px] font-semibold text-gray-900 outline-none dark:text-slate-50" />
                </span>
                <span className="mt-0.5 block text-[11px] font-normal text-gray-500">{f.hint}</span>
              </label>
            ))}
          </div>
          <label className="block text-[12.5px] font-semibold text-gray-700 dark:text-slate-200">
            <span className="flex items-center justify-between">Delivery rate<b className="text-[15px] text-gray-900 dark:text-slate-50">{rate}%</b></span>
            <input type="range" min={10} max={100} step={1} value={rate} onChange={(e) => setRate(Number(e.target.value))} className="mt-1 w-full accent-[#5B3FD9]" />
            <span className="block text-[11px] font-normal text-gray-500">Share of placed orders that get delivered</span>
          </label>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "Break-even ad cost per order", value: cash(r.breakEvenCpp > 0 ? r.breakEvenCpp : 0), sub: "Spend more than this per placed order and you lose money", strong: true },
              { label: "Ad cost per delivery", value: cash(r.adCostPerDelivery), sub: `${cash(input.cpp)} ÷ ${rate}% delivered` },
              { label: "Profit per delivered order", value: cash(r.profitPerDelivered), sub: "After ads and failed orders", tone: r.profitPerDelivered !== null && r.profitPerDelivered < 0 ? "text-rose-600" : "" },
              { label: "Profit margin", value: r.marginPct === null ? "—" : `${r.marginPct.toFixed(1)}%`, sub: "Of the selling price", tone: r.marginPct !== null && r.marginPct < 0 ? "text-rose-600" : "" }
            ].map((t) => (
              <div key={t.label} className={`rounded-xl border p-3 ${t.strong ? "border-[#C9BCF7] bg-[#F7F4FF] dark:border-violet-500/40 dark:bg-violet-500/10" : "border-gray-200 dark:border-slate-700"}`}>
                <span className="block text-[11.5px] font-semibold text-gray-500 dark:text-slate-400">{t.label}</span>
                <b className={`mt-0.5 block text-[22px] font-black leading-tight text-gray-900 dark:text-slate-50 ${t.tone ?? ""}`}>{t.value}</b>
                <span className="mt-0.5 block text-[11px] text-gray-500">{t.sub}</span>
              </div>
            ))}
          </div>
          <div className={`rounded-xl border p-3 ${s.tone}`}>
            <span className="flex items-center gap-1.5 text-[14px] font-extrabold"><s.Icon className="h-4 w-4" />{s.title}{r.shareOfBreakEven !== null && input.cpp > 0 ? <span className="font-semibold"> · {Math.round(r.shareOfBreakEven * 100)}% of break-even</span> : null}</span>
            <span className="mt-0.5 block text-[12.5px]">{input.cpp > 0 || r.status === "no_profit" ? s.text : "Type the ad cost per placed order to see the decision."}</span>
          </div>
          <ul className="m-0 list-none space-y-1 p-0 text-[12px] text-gray-600 dark:text-slate-300">
            <li>A delivered order leaves <b>{cash(r.leftPerDelivery)}</b> before ads.</li>
            <li>Per placed order you make <b className={r.profitPerPlaced < 0 ? "text-rose-600" : ""}>{cash(r.profitPerPlaced)}</b> after ads.</li>
            {target !== null && <li>Your saved target for this product: <b>{cash(target)}</b> per order.</li>}
            <li className="text-gray-500">Contribution profit only: salaries and other running costs are not taken off.</li>
          </ul>
        </div>
      </div>
      <div className="mt-5 flex justify-end"><button type="button" onClick={onClose} className={outlineButton}>Close</button></div>
    </Modal>
  );
}
