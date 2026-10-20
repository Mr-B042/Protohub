import { buildAgentRows, buildHeatmap, buildStockPlan, figuresFor, growthPct, stateLabel, worstProducts, type WorstMode, type TrendAgent, type TrendHub, type TrendProduct } from "./product-trend-model";
import { downloadXlsx, printReport, type Cell, type Sheet } from "./exports";
import type { TrendModel } from "./tab-context";

// The Export menu's Excel workbook and PDF report (Bright's brief: report
// date, period, data freshness and how the figures are worked out, all
// following the filters on screen).

export type ReportInput = {
  model: TrendModel; products: TrendProduct[]; hubs: TrendHub[]; agents: TrendAgent[]; canSeeProfit: boolean;
  from: string; to: string; prevFrom: string; prevTo: string; days: number; filtersText: string; updatedAt: number;
};

export const DEFINITIONS = [
  "Orders: orders placed in the period. Held duplicate orders are left out.",
  "Delivered / delivery rate: of the orders placed in the period, how many are now delivered (the Orders-page way). Rates are only ranked with 10+ orders.",
  "Units: pieces (one order of three racks = three units). Stock is always counted in units.",
  "Net profit (delivered): delivered revenue − product cost − delivery fees − running costs (every expense except Delivery). Costs tagged to a product stay with it; untagged costs are shared by delivered sales. Same as Finance › Product Profitability: Direct Net Profit − Shared Opex.",
  "States and agents have no costs of their own (ads are not tracked by state), so each delivered order carries its product's running costs in proportion to its sales.",
  "Forecast: the period's pace of units ordered, widened by how steady orders were. With too little history there is no forecast and the stock plan covers waiting customers only.",
  "Stock with agents: good units (not defective or missing) at active agent hubs. Warehouse stock is what a stock plan can share out."
];

const r1 = (v: number) => Math.round(v * 10) / 10;
const r0 = (v: number) => Math.round(v);

export function buildReportSheets(input: ReportInput): { sheets: Sheet[]; summary: Array<[string, string]>; kpis: Array<[string, string]> } {
  const { model, products, hubs, agents, canSeeProfit, from, to, prevFrom, prevTo, days, filtersText, updatedAt } = input;
  const totals = figuresFor(model.orders, model.costs);
  const before = figuresFor(model.previous, model.previousCosts);
  const net = model.productRows.reduce((s, r) => s + r.now.net, 0);
  const meta: Array<[string, string]> = [
    ["Report date", new Date().toLocaleString("en-GB")],
    ["Period", `${from} to ${to} (${days} days)`],
    ["Compared with", `${prevFrom} to ${prevTo}`],
    ["Filters", filtersText || "None"],
    ["Data updated", new Date(updatedAt).toLocaleString("en-GB")]
  ];
  const kpis: Array<[string, string]> = [
    ["Total orders", `${totals.orders.toLocaleString("en-NG")} (${fmtGrowth(growthPct(totals.orders, before.orders))})`],
    ["Delivered", `${totals.delivered.toLocaleString("en-NG")} (${fmtGrowth(growthPct(totals.delivered, before.delivered))})`],
    ["Delivery rate", `${totals.rate.toFixed(1)}%`],
    ["Units delivered", totals.unitsDelivered.toLocaleString("en-NG")],
    ["Delivered revenue", `₦${r0(totals.revenue).toLocaleString("en-NG")}`],
    canSeeProfit ? ["Net profit (delivered)", `₦${r0(net).toLocaleString("en-NG")}`] : ["Delivered AOV", `₦${r0(totals.aov).toLocaleString("en-NG")}`]
  ];

  const productHead: Cell[] = ["Product", "SKU", "Orders", "Orders before", "Growth %", "Delivered", "Units delivered", "Delivery rate %", "Delivered revenue", "Delivered AOV", ...(canSeeProfit ? ["Net profit"] : []), "Stock with agents", "Top states (orders)"];
  const productRows = [...model.productRows].sort((a, b) => b.now.orders - a.now.orders).map((r) => [
    r.product.name, r.product.sku ?? "", r.now.orders, r.before.orders, growthPct(r.now.orders, r.before.orders) === null ? "" : r1(growthPct(r.now.orders, r.before.orders)!),
    r.now.delivered, r.now.unitsDelivered, r1(r.now.rate), r0(r.now.revenue), r0(r.now.aov), ...(canSeeProfit ? [r0(r.now.net)] : []), r.stockWithAgents,
    r.topStatesByOrders.map((s) => `${stateLabel(s.key)} ${r0(s.share)}%`).join("; ")
  ] as Cell[]);

  const worstHead: Cell[] = ["Ranking", "Product", "Orders", "Delivery rate %", ...(canSeeProfit ? ["Net profit"] : []), "Why it is here", "What to check"];
  const worstModes: WorstMode[] = canSeeProfit ? ["rate", "net", "drop"] : ["rate", "drop"];
  const worstRows: Cell[][] = worstModes.flatMap((mode) => worstProducts(model.productRows, mode, totals.rate).map((w) => [
    mode === "rate" ? "Lowest delivery rate" : mode === "net" ? "Lowest net profit" : "Biggest drop in orders",
    w.row.product.name, w.row.now.orders, r1(w.row.now.rate), ...(canSeeProfit ? [r0(w.row.now.net)] : []), w.why, w.check
  ] as Cell[]));

  const stateHead: Cell[] = ["State", "Orders", "Orders before", "Confirmed", "Delivered", "Units delivered", "Delivery rate %", "Failed", "Cancelled", "Still open", "Delivered revenue", ...(canSeeProfit ? ["Net profit"] : []), "Stock with agents", "Active agents"];
  const stateRows = model.stateRows.map((r) => [stateLabel(r.state), r.now.orders, r.before.orders, r.now.confirmed, r.now.delivered, r.now.unitsDelivered, r1(r.now.rate), r.now.failed, r.now.cancelled, r.now.open,
    r0(r.now.revenue), ...(canSeeProfit ? [r0(r.now.net)] : []), r.stockWithAgents, r.activeAgents] as Cell[]);

  const heat = buildHeatmap(model.orders, model.costs);
  const states = model.stateRows.map((r) => r.state);
  const crossHead: Cell[] = ["Product", "Measure", ...states.map(stateLabel)];
  const crossRows: Cell[][] = model.productRows.flatMap((r) => (["Orders", "Delivered"] as const).map((m) => [r.product.name, m, ...states.map((s) => {
    const f = heat.get(`${r.product.id}|${s}`); return f ? (m === "Orders" ? f.orders : f.delivered) : 0;
  })] as Cell[]));

  const agentRows = buildAgentRows({ orders: model.orders, previousOrders: model.previous, costs: model.costs, previousCosts: model.previousCosts, hubs, agents, productId: "all" });
  const agentHead: Cell[] = ["Agent", "States", "Orders", "Delivered", "Delivery rate %", "vs other agents in state (points)", "Avg. delivery days", "Failed", "Cancelled", "Pending", "Delivery fees", ...(canSeeProfit ? ["Net profit"] : []), "Stock held"];
  const agentData = agentRows.map((a) => [a.name, a.states.map(stateLabel).join("; "), a.now.orders, a.now.delivered, r1(a.now.rate), a.vsPeers === null ? "" : r1(a.vsPeers),
    a.now.avgDeliveryDays === null ? "" : r1(a.now.avgDeliveryDays), a.now.failed, a.now.cancelled, a.now.open, r0(a.now.logistics), ...(canSeeProfit ? [r0(a.now.net)] : []), a.stockHeld] as Cell[]);

  const stockHead: Cell[] = ["Product", "State", "Stock with agents", "Waiting units", "30-day forecast", "Delivery rate %", "Days of cover", "Need", "Recommended from warehouse", "Priority", "Forecast confidence"];
  const ids = new Set(model.orders.map((o) => o.productId));
  const stockRows: Cell[][] = products.filter((p) => ids.has(p.id)).flatMap((p) => {
    const plan = buildStockPlan({ orders: model.orders, productId: p.id, hubs, days, available: p.warehouseStock ?? 0, netPerUnit: 0 });
    return plan.rows.map((r) => [p.name, stateLabel(r.state), r.stock, r.waitingUnits, r0(r.forecast), r1(r.rate), r.coverDays === null ? "" : r0(r.coverDays), r.need, r.recommended, r.priority, plan.confidence.level] as Cell[]);
  });

  return {
    summary: meta, kpis,
    sheets: [
      { name: "Summary", rows: [["Item", "Value"], ...meta, ["", ""], ...kpis] },
      { name: "Products", rows: [productHead, ...productRows] },
      { name: "Worst Products", rows: [worstHead, ...worstRows] },
      { name: "States", rows: [stateHead, ...stateRows] },
      { name: "Product x State", rows: [crossHead, ...crossRows] },
      { name: "Agents", rows: [agentHead, ...agentData] },
      { name: "Stock Plan", rows: [stockHead, ...stockRows] },
      { name: "Definitions", rows: [["How the figures are worked out"], ...DEFINITIONS.map((d) => [d])] }
    ]
  };
}

const fmtGrowth = (g: number | null) => (g === null ? "new" : `${g >= 0 ? "+" : ""}${g.toFixed(1)}% vs before`);

export function exportExcel(input: ReportInput) {
  downloadXlsx(`product-trend-${input.from}-to-${input.to}.xlsx`, buildReportSheets(input).sheets);
}

export function exportPdf(input: ReportInput) {
  const { sheets, summary, kpis } = buildReportSheets(input);
  const take = (name: string, cols: number[], limit = 12) => {
    const rows = sheets.find((s) => s.name === name)?.rows ?? [];
    return rows.slice(0, limit + 1).map((row) => cols.map((c) => row[c]));
  };
  const profit = input.canSeeProfit;
  printReport({
    title: "Product Trend Report",
    subtitle: "Best and worst products, states, agents and stock - from Protohub's live orders.",
    meta: summary,
    kpis,
    sections: [
      { title: "Top products (by orders)", rows: take("Products", profit ? [0, 2, 4, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 8, 10]) },
      { title: "Worst performing products", note: "Ranked three ways; products need 10+ orders, except money-losers, which are always shown.", rows: take("Worst Products", profit ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4], 15) },
      { title: "States", rows: take("States", profit ? [0, 1, 4, 6, 7, 10, 11, 12] : [0, 1, 4, 6, 7, 10, 11]) },
      { title: "Delivery agents", rows: take("Agents", [0, 1, 2, 3, 4, 5, 6, 7]) },
      { title: "Stock plan (states needing stock first)", note: "Recommended units come from the warehouse; nothing moves without an approved waybill.", rows: take("Stock Plan", [0, 1, 2, 3, 4, 6, 8, 9, 10], 15) }
    ],
    definitions: DEFINITIONS
  });
}
