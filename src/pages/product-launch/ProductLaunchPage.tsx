import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Ban, CheckCircle2, ChevronRight, ClipboardList, EyeOff, History, Loader2, Megaphone, Power, Rocket, Settings2, Users, X } from "lucide-react";
import { productLaunchApi, type ProductLaunchCart, type ProductLaunchEvent, type ProductLaunchOrder, type ProductLaunchProduct } from "../../lib/api";
import { LAUNCH_STAGE_LABEL, type LaunchSettings, type LaunchStage } from "../../lib/product-launch";
import { ProductThumb, nf, pct1 } from "../product-trend/parts";

/**
 * Product Launch (Bright, 1 Nov 2026) - Owner only.
 *
 * Try a new product quietly before the team sells it:
 *  1. Silent Test: orders are shared out by round robin as usual, but only the
 *     Owner sees them or hears about them. Customers get no message.
 *  2. Soft Launch: every hidden order appears for its rep with an alert; the
 *     team works them; they stay out of the weekly delivery rate but are paid.
 *  3. Live: a normal product.
 */

type Props = {
  onToast: (message: string) => void;
  /** Reload products elsewhere in the app after a switch (badges, order form). */
  onChanged?: () => void;
  /** Writes are blocked while the Owner previews someone else read-only. */
  readOnly?: boolean;
};

const STAGE_TONE: Record<LaunchStage, string> = {
  silent: "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-500/30",
  soft: "bg-teal-100 text-teal-800 ring-teal-200 dark:bg-teal-500/15 dark:text-teal-200 dark:ring-teal-500/30",
  live: "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30"
};

const STAGE_HELP: Record<LaunchStage, string> = {
  silent: "Orders are shared to reps as normal, but only you can see them. Nobody else is told, and customers get no message. Its ad spend stays out of Expenses until the test moves on (you still see it in the Tracking Hub).",
  soft: "Everyone sees and works these orders. They are left out of the weekly delivery rate; delivered ones still pay the rep.",
  live: "A normal product. Orders count everywhere."
};

const SETTING_ROWS: Array<{ key: keyof LaunchSettings; stage: string; title: string; help: string }> = [
  { key: "silentCustomerMessages", stage: "Silent Test", title: "Message customers", help: "Send the usual automatic order confirmation (WhatsApp, SMS, email) while the test is hidden. Off: customers hear from us only after the switch to Soft Launch." },
  { key: "silentHoldCarts", stage: "Silent Test", title: "Hold back abandoned carts", help: "Carts for this product are not handed to reps and are hidden from them. They go out as normal after the switch." },
  { key: "revealRepAlerts", stage: "Switching to Soft Launch", title: "Alert reps and leadership", help: "Each hidden order sends the normal new-order alert (app, push, WhatsApp) to its rep, Admins and Managers, as if it had just come in." },
  { key: "revealCustomerMessages", stage: "Switching to Soft Launch", title: "Send customers their confirmation", help: "Customers who heard nothing during Silent Test get their order confirmation when their order appears." },
  { key: "softLeaveOutOfRate", stage: "Soft Launch", title: "Leave out of the delivery rate", help: "These orders do not count in the weekly report's orders or delivery rate. A delivered one still pays the rep's bonus." }
];

const OPEN = (status: string) => !["Delivered", "Failed", "Cancelled"].includes(status);
/** A cart still waiting for a rep: open and nobody given it yet (held back during Silent Test). */
const CART_WAITING = (cart: ProductLaunchCart) => !cart.repId && (cart.status === "Open abandoned" || cart.status === "In progress");
const shortDate = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Africa/Lagos" }) : "—";
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });

function StagePill({ stage }: { stage: LaunchStage }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ring-1 ${STAGE_TONE[stage]}`}>{LAUNCH_STAGE_LABEL[stage]}</span>;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
      <div className="text-[11.5px] font-medium text-gray-500 dark:text-slate-400">{label}</div>
      <div className="mt-0.5 text-[20px] font-black text-gray-900 dark:text-slate-50">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
}

/** The three steps, with the product's place on them. */
function Stepper({ stage }: { stage: LaunchStage }) {
  const steps: LaunchStage[] = ["silent", "soft", "live"];
  const at = steps.indexOf(stage);
  return (
    <ol className="m-0 flex list-none items-center gap-1 p-0 text-[12px] font-semibold">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-1">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${index === at ? `ring-1 ${STAGE_TONE[step]}` : index < at ? "text-emerald-700 dark:text-emerald-300" : "text-gray-400 dark:text-slate-500"}`}>
            {index < at ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="text-[11px]">{index + 1}</span>}
            {LAUNCH_STAGE_LABEL[step]}
          </span>
          {index < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-gray-300" />}
        </li>
      ))}
    </ol>
  );
}

type Pending = { product: ProductLaunchProduct; to: LaunchStage };

export default function ProductLaunchPage({ onToast, onChanged, readOnly = false }: Props) {
  const [data, setData] = useState<{ products: ProductLaunchProduct[]; orders: ProductLaunchOrder[]; carts: ProductLaunchCart[]; events: ProductLaunchEvent[] } | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [ending, setEnding] = useState<ProductLaunchProduct | null>(null);
  const [startProductId, setStartProductId] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await productLaunchApi.list());
      setError("");
    } catch (err: any) {
      setError(err?.message ?? "Could not load Product Launch.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const testing = useMemo(() => (data?.products ?? []).filter((product) => product.stage !== "live"), [data]);
  // Products that ran a test before and are now live: kept below with their history.
  const finished = useMemo(() => (data?.products ?? []).filter((product) => product.stage === "live" && (data?.events ?? []).some((event) => event.productId === product.id)), [data]);
  const startable = useMemo(() => (data?.products ?? []).filter((product) => product.stage === "live" && product.onOrderForm), [data]);

  if (error && !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
        {error} <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">Try again</button>
      </div>
    );
  }
  if (!data) return <div className="flex items-center gap-2 py-16 text-[13px] text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading Product Launch…</div>;

  return (
    <div className="space-y-5 pb-10 text-gray-900 dark:text-slate-100" data-testid="product-launch-page">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet-600 text-white shadow-md"><Rocket className="h-5 w-5" /></span>
          <div>
            <h1 className="m-0 text-[26px] font-black tracking-tight text-gray-900 dark:text-slate-50">Product Launch</h1>
            <p className="m-0 mt-0.5 max-w-3xl text-[13px] text-gray-500 dark:text-slate-400">Try a new product quietly before the team sells it. See how customers react while only you can see the orders, then hand it to the team, then make it a normal product.</p>
          </div>
        </div>
      </header>

      {/* How it works */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(["silent", "soft", "live"] as LaunchStage[]).map((stage, index) => (
          <div key={stage} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gray-900 text-[12px] font-black text-white dark:bg-slate-100 dark:text-slate-900">{index + 1}</span>
              <StagePill stage={stage} />
            </div>
            <p className="m-0 mt-2 text-[12.5px] leading-relaxed text-gray-600 dark:text-slate-300">{STAGE_HELP[stage]}</p>
          </div>
        ))}
      </section>

      {/* Start a test */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="m-0 text-[16px] font-black">Start a test</h2>
        <p className="m-0 mt-0.5 text-[12.5px] text-gray-500">Pick a product that is on the order form (switched on, with at least one package switched on). From the moment you start, its new orders follow the test rules. Orders it already has are not changed.</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select value={startProductId} onChange={(event) => setStartProductId(event.target.value)} aria-label="Product to test"
            className="h-10 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-[13px] dark:border-slate-700 dark:bg-slate-900">
            <option value="">Choose a product…</option>
            {startable.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          {(["silent", "soft"] as LaunchStage[]).map((stage) => (
            <button key={stage} type="button" disabled={!startProductId || readOnly}
              onClick={() => { const product = data.products.find((item) => item.id === startProductId); if (product) setPending({ product, to: stage }); }}
              className={`!min-h-0 h-10 rounded-lg px-4 text-[13px] font-semibold text-white shadow-sm disabled:opacity-40 ${stage === "silent" ? "bg-violet-600 hover:bg-violet-700" : "bg-teal-600 hover:bg-teal-700"}`}>
              Start in {LAUNCH_STAGE_LABEL[stage]}
            </button>
          ))}
        </div>
      </section>

      {testing.length === 0 && (
        <p className="m-0 rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-center text-[13px] text-gray-500">No product is being tested right now.</p>
      )}

      {testing.map((product) => (
        <ProductCard key={product.id} product={product} data={data} readOnly={readOnly} onSwitch={(to) => setPending({ product, to })}
          onEnd={() => setEnding(product)}
          onSettings={async (patch) => {
            try {
              const result = await productLaunchApi.saveSettings(product.id, patch);
              setData((current) => current ? { ...current, products: current.products.map((item) => item.id === product.id ? { ...item, settings: result.settings } : item) } : current);
              onToast("Saved.");
            } catch (err: any) { onToast(`Could not save: ${err?.message ?? "please retry"}.`); }
          }} />
      ))}

      {finished.length > 0 && (
        <section className="space-y-3">
          <h2 className="m-0 text-[16px] font-black">Finished tests</h2>
          {finished.map((product) => <ProductCard key={product.id} product={product} data={data} readOnly={readOnly} compact onSwitch={(to) => setPending({ product, to })} />)}
        </section>
      )}

      {ending && (
        <EndDialog product={ending} orders={data.orders.filter((order) => order.productId === ending.id)} carts={(data.carts ?? []).filter((cart) => cart.productId === ending.id)} onClose={() => setEnding(null)}
          onConfirm={async (choice, note) => {
            try {
              const result = await productLaunchApi.endTest(ending.id, choice, note);
              onToast(choice === "cancel"
                ? `Test ended. ${ending.name} is switched off${result.cancelled > 0 ? `; ${result.cancelled} hidden order${result.cancelled === 1 ? "" : "s"} cancelled quietly` : ""}${result.cartsClosed > 0 ? `; ${result.cartsClosed} held cart${result.cartsClosed === 1 ? "" : "s"} closed` : ""}.`
                : `Test ended. ${ending.name} is switched off${result.revealed > 0 ? `; ${result.revealed} order${result.revealed === 1 ? "" : "s"} handed to the team, alerts going out one by one` : ""}.`);
              setEnding(null);
              await load();
              onChanged?.();
            } catch (err: any) {
              onToast(`Could not end the test: ${err?.message ?? "please retry"}.`);
            }
          }} />
      )}

      {pending && (
        <SwitchDialog pending={pending} orders={data.orders.filter((order) => order.productId === pending.product.id)} carts={(data.carts ?? []).filter((cart) => cart.productId === pending.product.id)} onClose={() => setPending(null)}
          onConfirm={async (note) => {
            try {
              const result = await productLaunchApi.setStage(pending.product.id, pending.to, note);
              onToast(result.revealed > 0
                ? `${pending.product.name} is now in ${LAUNCH_STAGE_LABEL[pending.to]}. ${result.revealed} order${result.revealed === 1 ? "" : "s"} now showing to the team; alerts are going out one by one.`
                : `${pending.product.name} is now ${pending.to === "live" ? "Live" : `in ${LAUNCH_STAGE_LABEL[pending.to]}`}.`);
              setPending(null);
              setStartProductId("");
              await load();
              onChanged?.();
            } catch (err: any) {
              onToast(`Could not switch: ${err?.message ?? "please retry"}.`);
            }
          }} />
      )}
    </div>
  );
}

function ProductCard({ product, data, readOnly, compact = false, onSwitch, onEnd, onSettings }: {
  product: ProductLaunchProduct;
  data: { orders: ProductLaunchOrder[]; carts?: ProductLaunchCart[]; events: ProductLaunchEvent[] };
  readOnly: boolean;
  compact?: boolean;
  onSwitch: (to: LaunchStage) => void;
  /** End a test that did not sell (only offered while testing). */
  onEnd?: () => void;
  onSettings?: (patch: Partial<LaunchSettings>) => void;
}) {
  const [tab, setTab] = useState<"orders" | "reps" | "settings" | "history">("orders");
  const orders = data.orders.filter((order) => order.productId === product.id);
  const events = data.events.filter((event) => event.productId === product.id);
  const since = events.find((event) => event.to === product.stage)?.at;
  // The latest event says whether a finished test was ended (switched off) rather than made Live.
  const ended = product.stage === "live" ? events[0]?.endedWith ?? null : null;
  const hidden = orders.filter((order) => order.stage === "silent");
  const delivered = orders.filter((order) => order.status === "Delivered");
  const closed = orders.filter((order) => order.status === "Failed" || order.status === "Cancelled");
  const open = orders.filter((order) => OPEN(order.status));
  const pieces = delivered.reduce((sum, order) => sum + order.quantity, 0);
  const carts = (data.carts ?? []).filter((cart) => cart.productId === product.id);
  const heldCarts = carts.filter((cart) => CART_WAITING(cart));
  const byRep = useMemo(() => {
    const map = new Map<string, { name: string; orders: number; hidden: number; delivered: number; open: number }>();
    for (const order of orders) {
      const key = order.repId ?? "none";
      const row = map.get(key) ?? { name: order.repName ?? "Not shared yet", orders: 0, hidden: 0, delivered: 0, open: 0 };
      row.orders += 1;
      if (order.stage === "silent") row.hidden += 1;
      if (order.status === "Delivered") row.delivered += 1;
      if (OPEN(order.status)) row.open += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.orders - a.orders);
  }, [orders]);

  // The next step is the obvious button; the others sit beside it.
  const next: LaunchStage | null = product.stage === "silent" ? "soft" : product.stage === "soft" ? "live" : null;
  const others = (["silent", "soft", "live"] as LaunchStage[]).filter((stage) => stage !== product.stage && stage !== next);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb src={product.imageUrl} name={product.name} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 truncate text-[16px] font-black">{product.name}</h3>
              {ended
                ? <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-gray-700 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-200"><Power className="h-3 w-3" />Test ended</span>
                : <StagePill stage={product.stage} />}
              {!product.active && <span className="text-[11.5px] font-semibold text-gray-500">Switched off - not taking orders</span>}
            </div>
            {!ended && <div className="mt-1"><Stepper stage={product.stage} /></div>}
            {since && <p className="m-0 mt-1 text-[11.5px] text-gray-500">{ended
              ? `Test ended ${dateTime(since)}${ended === "cancelled" ? " - hidden orders cancelled quietly" : " - orders handed to the team"}`
              : `In ${LAUNCH_STAGE_LABEL[product.stage]} since ${dateTime(since)}`}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onEnd && product.stage !== "live" && (
            <button type="button" disabled={readOnly} onClick={onEnd}
              className="!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-3 text-[12.5px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-500/30 dark:text-rose-300">
              <Ban className="h-4 w-4" /> End test
            </button>
          )}
          {!ended && others.map((stage) => (
            <button key={stage} type="button" disabled={readOnly} onClick={() => onSwitch(stage)}
              className="!min-h-0 h-9 rounded-lg border border-gray-200 px-3 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200">
              {stage === "live" ? "Make Live" : `Back to ${LAUNCH_STAGE_LABEL[stage]}`}
            </button>
          ))}
          {next && (
            <button type="button" disabled={readOnly} onClick={() => onSwitch(next)}
              className={`!min-h-0 inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold text-white shadow-sm disabled:opacity-40 ${next === "soft" ? "bg-teal-600 hover:bg-teal-700" : "bg-emerald-600 hover:bg-emerald-700"}`}>
              {next === "soft" ? <><Megaphone className="h-4 w-4" /> Move to Soft Launch</> : <><Rocket className="h-4 w-4" /> Make Live</>}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 xl:grid-cols-7">
        <Stat label="Test orders" value={nf(orders.length)} sub={orders.length > 0 ? `first ${shortDate(orders.map((order) => order.createdAt).sort()[0])}` : "none yet"} />
        <Stat label="Hidden from the team" value={nf(hidden.length)} sub={product.stage === "silent" ? "appear at Soft Launch" : hidden.length > 0 ? "still hidden" : "none"} />
        <Stat label="Being worked" value={nf(open.length)} sub="not yet closed" />
        <Stat label="Delivered" value={nf(delivered.length)} sub={`${nf(pieces)} piece${pieces === 1 ? "" : "s"}`} />
        <Stat label="Delivery rate" value={orders.length > 0 ? pct1((delivered.length / orders.length) * 100) : "—"} sub="of test orders" />
        <Stat label="Failed or cancelled" value={nf(closed.length)} />
        <Stat label="Abandoned carts" value={nf(carts.length)}
          sub={product.stage === "silent" && product.settings.silentHoldCarts ? `${nf(heldCarts.length)} held back from reps` : `${nf(carts.filter((cart) => cart.status === "Converted").length)} became orders`} />
      </div>

      {!compact && (
        <>
          <nav className="flex gap-1 overflow-x-auto border-t border-gray-100 px-4 pt-3 dark:border-slate-800" role="tablist" aria-label={`${product.name} details`}>
            {([["orders", "Orders", ClipboardList], ["reps", "By rep", Users], ["settings", "Settings", Settings2], ["history", "History", History]] as const).map(([key, label, Icon]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
                className={`!min-h-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${tab === key ? "bg-gray-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-gray-600 hover:bg-gray-50 dark:text-slate-300"}`}>
                <Icon className="h-3.5 w-3.5" />{label}
              </button>
            ))}
          </nav>
          <div className="p-4">
            {tab === "orders" && <OrdersTable orders={orders} />}
            {tab === "reps" && (
              byRep.length === 0 ? <p className="m-0 py-6 text-center text-[12.5px] text-gray-500">No orders yet.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full !min-w-[520px] border-separate border-spacing-0 text-[12.5px]">
                    <thead><tr>{["Rep", "Orders shared", "Hidden", "Being worked", "Delivered"].map((head) => <th key={head} className="border-b border-gray-200 px-2 py-2 text-left text-[11.5px] font-semibold text-gray-500">{head}</th>)}</tr></thead>
                    <tbody>{byRep.map((row) => (
                      <tr key={row.name}>
                        <td className="border-b border-gray-100 px-2 py-2 font-semibold">{row.name}</td>
                        <td className="border-b border-gray-100 px-2 py-2">{nf(row.orders)}</td>
                        <td className="border-b border-gray-100 px-2 py-2">{row.hidden > 0 ? <span className="inline-flex items-center gap-1 text-violet-700"><EyeOff className="h-3.5 w-3.5" />{nf(row.hidden)}</span> : "—"}</td>
                        <td className="border-b border-gray-100 px-2 py-2">{nf(row.open)}</td>
                        <td className="border-b border-gray-100 px-2 py-2">{nf(row.delivered)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )
            )}
            {tab === "settings" && onSettings && (
              <div className="space-y-2">
                {SETTING_ROWS.map((row) => (
                  <label key={row.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 dark:border-slate-700">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-violet-600" checked={product.settings[row.key]} disabled={readOnly}
                      onChange={(event) => onSettings({ [row.key]: event.target.checked })} />
                    <span>
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-400">{row.stage}</span>
                      <span className="block text-[13px] font-bold">{row.title}</span>
                      <span className="block text-[12px] text-gray-500 dark:text-slate-400">{row.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {tab === "history" && (
              events.length === 0 ? <p className="m-0 py-6 text-center text-[12.5px] text-gray-500">No switches yet.</p> : (
                <ol className="m-0 list-none space-y-2 p-0">
                  {events.map((event) => (
                    <li key={event.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 px-3 py-2 text-[12.5px] dark:border-slate-800">
                      <span className="text-gray-500">{dateTime(event.at)}</span>
                      <StagePill stage={event.from} /><ChevronRight className="h-3.5 w-3.5 text-gray-400" /><StagePill stage={event.to} />
                      {event.endedWith && <span className="font-semibold text-gray-700">Test ended, product switched off</span>}
                      {event.ordersCancelled > 0 && <span className="text-gray-600">{event.ordersCancelled} hidden order{event.ordersCancelled === 1 ? "" : "s"} cancelled quietly</span>}
                      {event.ordersRevealed > 0 && <span className="text-gray-600">{event.ordersRevealed} order{event.ordersRevealed === 1 ? "" : "s"} shown to the team</span>}
                      {event.cartsHandedOut > 0 && <span className="text-gray-600">{event.cartsHandedOut} held cart{event.cartsHandedOut === 1 ? "" : "s"} shared to reps</span>}
                      {event.cartsClosed > 0 && <span className="text-gray-600">{event.cartsClosed} held cart{event.cartsClosed === 1 ? "" : "s"} closed</span>}
                      {event.by && <span className="text-gray-500">by {event.by}</span>}
                      {event.note && <span className="w-full text-gray-600">“{event.note}”</span>}
                    </li>
                  ))}
                </ol>
              )
            )}
          </div>
        </>
      )}
    </section>
  );
}

function OrdersTable({ orders }: { orders: ProductLaunchOrder[] }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rows = showAll ? sorted : sorted.slice(0, 12);
  if (orders.length === 0) return <p className="m-0 py-6 text-center text-[12.5px] text-gray-500">No orders yet. They appear here the moment they come in.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full !min-w-[620px] border-separate border-spacing-0 text-[12.5px]">
        <thead><tr>{["Order", "Came in", "Shared to", "Status", "Seen by the team"].map((head) => <th key={head} className="border-b border-gray-200 px-2 py-2 text-left text-[11.5px] font-semibold text-gray-500">{head}</th>)}</tr></thead>
        <tbody>{rows.map((order) => (
          <tr key={order.id}>
            <td className="border-b border-gray-100 px-2 py-2 font-semibold">#{order.id}</td>
            <td className="border-b border-gray-100 px-2 py-2">{dateTime(order.createdAt)}</td>
            <td className="border-b border-gray-100 px-2 py-2">{order.repName ?? "Not shared yet"}</td>
            <td className="border-b border-gray-100 px-2 py-2">{order.status}</td>
            <td className="border-b border-gray-100 px-2 py-2">{order.stage === "silent" ? <span className="inline-flex items-center gap-1 text-violet-700"><EyeOff className="h-3.5 w-3.5" /> Hidden</span> : order.revealedAt ? dateTime(order.revealedAt) : "From the start"}</td>
          </tr>
        ))}</tbody>
      </table>
      {sorted.length > 12 && (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="!min-h-0 mt-2 text-[12.5px] font-semibold text-violet-700">{showAll ? "Show fewer" : `Show all ${sorted.length}`}</button>
      )}
    </div>
  );
}

/** Says exactly what a switch will do before it happens. */
function SwitchDialog({ pending, orders, carts, onClose, onConfirm }: { pending: Pending; orders: ProductLaunchOrder[]; carts: ProductLaunchCart[]; onClose: () => void; onConfirm: (note: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { product, to } = pending;
  const from = product.stage;
  const hidden = orders.filter((order) => order.stage === "silent");
  const hiddenOpen = hidden.filter((order) => OPEN(order.status));
  const reps = new Set(hiddenOpen.map((order) => order.repId).filter(Boolean)).size;
  const reveals = from === "silent" && to !== "silent";
  const minutes = Math.max(1, Math.ceil((hiddenOpen.length * 4) / 60));

  const effects: string[] = [];
  if (to === "silent") {
    effects.push("New orders for this product will be shared to reps as normal, but only you will see them.");
    effects.push(product.settings.silentCustomerMessages ? "Customers still get the usual automatic messages." : "Customers get no message until you move to Soft Launch.");
    if (product.settings.silentHoldCarts) effects.push("Its abandoned carts are kept away from reps.");
    effects.push("Orders it already has are not hidden.");
    effects.push("Its ad spend stops going into Expenses from today. It is added back, each day on its real date, when the test moves on or ends.");
  }
  if (reveals) {
    effects.push(`${hidden.length} hidden order${hidden.length === 1 ? "" : "s"} will appear on the team's dashboards now${reps > 0 ? `, for ${reps} rep${reps === 1 ? "" : "s"}` : ""}.`);
    if (hiddenOpen.length > 0 && product.settings.revealRepAlerts) effects.push(`Each rep, Admin and Manager gets the normal new-order alert for the ${hiddenOpen.length} still open, one every few seconds (about ${minutes} minute${minutes === 1 ? "" : "s"}).`);
    if (hiddenOpen.length > 0 && product.settings.revealCustomerMessages && !product.settings.silentCustomerMessages) effects.push(`${hiddenOpen.length} customer${hiddenOpen.length === 1 ? "" : "s"} get their order confirmation.`);
    effects.push("The 15-minute rule and daily follow-up logging start from now for these orders, not from when they came in.");
    const held = carts.filter(CART_WAITING).length;
    effects.push("The ad spend held during Silent Test goes into Expenses now, each day on its real date, and records as normal from here.");
    if (held > 0 && product.settings.silentHoldCarts) effects.push(`${held} held abandoned cart${held === 1 ? "" : "s"} will be shared out to reps now, in turn, each with the normal cart alert - however old.`);
  }
  if (to === "soft") effects.push(product.settings.softLeaveOutOfRate ? "These orders stay out of the weekly delivery rate; delivered ones still pay the rep." : "These orders count in the weekly delivery rate (setting is off).");
  if (to === "live") effects.push("New orders are normal orders from now on. Orders from the test keep their badge and stay out of the delivery rate.");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Move ${product.name} to ${LAUNCH_STAGE_LABEL[to]}`}>
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="m-0 text-[17px] font-black">{to === "live" ? `Make ${product.name} Live?` : `Move ${product.name} to ${LAUNCH_STAGE_LABEL[to]}?`}</h2>
            <div className="mt-1 flex items-center gap-1.5"><StagePill stage={from} /><ChevronRight className="h-3.5 w-3.5 text-gray-400" /><StagePill stage={to} /></div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          <p className="m-0 text-[12.5px] font-semibold text-gray-500">What happens:</p>
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-[13px] text-gray-700 dark:text-slate-200">{effects.map((line) => <li key={line}>{line}</li>)}</ul>
          <label className="block text-[12.5px] font-semibold text-gray-600">Note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="e.g. Customers liked it - handing to the team"
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-[13px] font-normal dark:border-slate-700 dark:bg-slate-900" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className="!min-h-0 h-10 rounded-lg border border-gray-200 px-4 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">Cancel</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(note.trim()); } finally { setBusy(false); } }}
            className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-lg bg-gray-900 px-4 text-[13px] font-semibold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{to === "live" ? "Make Live" : `Move to ${LAUNCH_STAGE_LABEL[to]}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ending a test that did not sell: the Owner picks what happens to its hidden orders. */
function EndDialog({ product, orders, carts, onClose, onConfirm }: {
  product: ProductLaunchProduct; orders: ProductLaunchOrder[]; carts: ProductLaunchCart[]; onClose: () => void;
  onConfirm: (choice: "cancel" | "deliver", note: string) => Promise<void>;
}) {
  const hiddenOpen = orders.filter((order) => order.stage === "silent" && OPEN(order.status));
  const reps = new Set(hiddenOpen.map((order) => order.repId).filter(Boolean)).size;
  const heldCarts = product.stage === "silent" && product.settings.silentHoldCarts ? carts.filter(CART_WAITING).length : 0;
  const [choice, setChoice] = useState<"cancel" | "deliver">("cancel");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const option = (value: "cancel" | "deliver", title: string, lines: string[]) => (
    <label className={`block cursor-pointer rounded-xl border p-3 ${choice === value ? "border-gray-900 ring-1 ring-gray-900 dark:border-slate-100 dark:ring-slate-100" : "border-gray-200 dark:border-slate-700"}`}>
      <span className="flex items-center gap-2 text-[13.5px] font-bold">
        <input type="radio" name="end-choice" checked={choice === value} onChange={() => setChoice(value)} className="h-4 w-4 accent-gray-900" />{title}
      </span>
      <ul className="m-0 mt-1.5 list-disc space-y-1 pl-9 text-[12.5px] text-gray-600 dark:text-slate-300">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`End the test of ${product.name}`}>
      <div className="w-full max-w-lg rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="m-0 text-[17px] font-black">End the test of {product.name}?</h2>
            <p className="m-0 mt-1 text-[12.5px] text-gray-500">The product is switched off, so its order form stops taking orders. The test stays on this page with its numbers and history. You can switch the product back on later in Products &amp; Stock.{product.stage === "silent" ? " The ad spend held during the test goes into Expenses now, each day on its real date." : ""}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="!min-h-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 px-5 py-4">
          {hiddenOpen.length === 0 && heldCarts === 0 ? (
            <p className="m-0 text-[13px] text-gray-700 dark:text-slate-200">No hidden orders are waiting, so nothing else changes.</p>
          ) : (
            <>
              <p className="m-0 text-[12.5px] font-semibold text-gray-500">
                {[hiddenOpen.length > 0 ? `${hiddenOpen.length} hidden order${hiddenOpen.length === 1 ? " is" : "s are"} still open${reps > 0 ? `, shared to ${reps} rep${reps === 1 ? "" : "s"}` : ""}` : "",
                  heldCarts > 0 ? `${heldCarts} abandoned cart${heldCarts === 1 ? " is" : "s are"} held back` : ""].filter(Boolean).join(", and ")}. What should happen to them?
              </p>
              {option("cancel", "Cancel them quietly", [
                "Marked Cancelled, with \"test ended\" written in each order's history.",
                "Reps never see them and nobody is alerted. Customers get no message.",
                "They never count in any rate, report or recovery list.",
                ...(heldCarts > 0 ? [`The ${heldCarts} held cart${heldCarts === 1 ? " is" : "s are"} closed as Lost, given to nobody.`] : [])
              ])}
              {option("deliver", "Let the team deliver them", [
                "They appear for their reps now, with the normal new-order alert.",
                product.settings.revealCustomerMessages && !product.settings.silentCustomerMessages ? "Customers get their order confirmation." : "Customers get no automatic message (settings).",
                "Left out of the weekly delivery rate; delivered ones still pay the rep. No new orders come in.",
                ...(heldCarts > 0 ? [`The ${heldCarts} held cart${heldCarts === 1 ? " is" : "s are"} shared out to reps, in turn, so they can call those customers too.`] : [])
              ])}
            </>
          )}
          <label className="block text-[12.5px] font-semibold text-gray-600">Note (optional)
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="e.g. Too few orders in two weeks"
              className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-[13px] font-normal dark:border-slate-700 dark:bg-slate-900" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-slate-800">
          <button type="button" onClick={onClose} className="!min-h-0 h-10 rounded-lg border border-gray-200 px-4 text-[13px] font-semibold text-gray-700 dark:border-slate-700 dark:text-slate-200">Keep testing</button>
          <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(choice, note.trim()); } finally { setBusy(false); } }}
            className="!min-h-0 inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-4 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}End test
          </button>
        </div>
      </div>
    </div>
  );
}
