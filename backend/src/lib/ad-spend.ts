// Tracking Hub -> Ad Spend (Bright, 8 Oct 2026).
//
// Meta gives the COST (tracking_meta_ad_insights: spend per ad per day, from
// every connected ad account). This file decides which product each naira of
// it belongs to and puts it next to Protohub's orders, deliveries and money.
//
// ⚠️ NEVER BY NAME. A campaign renamed from "Shelf Campaign 01" to "October
// Scaling CBO" must keep its product, so spend follows Meta IDs only:
//   1. a mapping set by the Owner, lowest level first: ad > ad set > campaign
//   2. the ad's tracking link: where its visitors landed (one product only)
//   3. a default set on the ad account
//   4. otherwise UNMAPPED - shown as such, never guessed.
// A name match is only ever offered as a suggestion in the assign box.
//
// ⚠️ ORDERS: the Product view counts every order of the product EXCEPT those
// from another ad platform (TikTok, Google...): their spend is not Meta's, so
// counting them made Meta's CPA look cheaper (Bright, 8 Oct 2026: 30 of the
// Shelf's 139 orders in a week were TikTok). Untagged orders stay in - Meta is
// the main source. Campaign / ad set / ad / account views can only count
// orders that carry that Meta id.
//
// Delivered = orders PLACED in the period that are now Delivered (the Orders
// page way), so today's CPDO fills in over the following days.

export type AdSpendLevel = "account" | "campaign" | "adset" | "ad";
export type AdSpendView = "product" | "campaign" | "adset" | "ad" | "account" | "business";
export const AD_SPEND_VIEWS: AdSpendView[] = ["product", "campaign", "adset", "ad", "account", "business"];
export type Split = { productId: string; share: number };
export type MappingSource = AdSpendLevel | "link" | null;

export type AdPlatform = "meta" | "tiktok";
export type PlatformChoice = AdPlatform | "all";
/** TikTok ids are kept as "tt:<id>" everywhere in this file, so they can never meet a Meta id. */
export const TIKTOK_PREFIX = "tt:";

export type SpendInsight = {
  platform?: AdPlatform;
  day: string; spend: number; ad_account_id: string;
  campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; ad_id: string; ad_name: string;
};
const TIKTOK_ID = /^\d{8,22}$/;
export const nameKey = (name: unknown) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Campaign / ad group / ad of a TikTok order: the ids its ad link passed
 * (utm_id / utm_term / utm_content, see TIKTOK_URL_PARAMETERS), else its
 * campaign NAME when exactly one TikTok campaign has it - today's TikTok ads
 * only pass utm_campaign=<name>. Only used to COUNT orders on a campaign row;
 * spend never follows names.
 */
export function tiktokOrderIds(order: { form_context?: Record<string, unknown> | null; utm_campaign?: string | null; utm_term?: string | null; utm_content?: string | null }, campaignByName: Map<string, string | null>) {
  const ctx = order.form_context ?? {};
  const pick = (...values: unknown[]) => { for (const value of values) if (typeof value === "string" && TIKTOK_ID.test(value.trim())) return `${TIKTOK_PREFIX}${value.trim()}`; return null; };
  // An id that is not one of the TikTok campaigns read gives way to a clear name match.
  const byId = pick(ctx.campaignId, ctx.campaign_id, ctx.utmId, ctx.utm_id);
  const byName = campaignByName.get(nameKey(order.utm_campaign ?? ctx.utmCampaign)) ?? null;
  const known = new Set(Array.from(campaignByName.values()).filter(Boolean));
  const campaignId = byId && (known.has(byId) || !byName) ? byId : byName ?? byId;
  return { campaignId, adsetId: pick(ctx.adsetId, ctx.adset_id, order.utm_term), adId: pick(ctx.adId, ctx.ad_id, order.utm_content) };
}

/** Every order of the branch placed in the window (not only form orders); review holds left out. */
export type SpendMapping = { level: AdSpendLevel; meta_id: string; splits: Split[] };
export type SpendOrder = {
  id: string; day: string; productId: string | null; status: string; amount: number; productCost: number; deliveryFee: number;
  campaignId: string | null; adsetId: string | null; adId: string | null;
  /** "TikTok", "Google"... when the order came from another ad platform. */
  otherPlatform?: string | null;
};
export type AccountInfo = { accountId: string; name: string; businessKey: string; businessName: string };

export type SpendPiece = {
  platform: AdPlatform;
  day: string; spend: number; productId: string | null; source: MappingSource;
  accountId: string; businessKey: string; campaignId: string; campaignName: string; adsetId: string; adsetName: string; adId: string; adName: string;
};

export const UNMAPPED = "__unmapped__";
const money = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

/** Shares must name real products, be positive and add up to 100. */
export function validSplits(splits: Split[], productIds: Set<string>): string | null {
  if (!splits.length) return "Pick a product.";
  if (new Set(splits.map((split) => split.productId)).size !== splits.length) return "Each product once.";
  if (splits.some((split) => !productIds.has(split.productId))) return "That product no longer exists.";
  if (splits.some((split) => !(split.share > 0))) return "Each share must be more than 0%.";
  const total = splits.reduce((sum, split) => sum + split.share, 0);
  if (Math.abs(total - 100) > 0.01) return `The shares add up to ${Math.round(total * 100) / 100}%, not 100%.`;
  return null;
}

/**
 * The product an ad's visitors landed on, from its tracking-link visits. Only
 * when one product has at least 90% of them - an ad sending people to two
 * products' forms is left for the Owner to decide.
 */
export function linkEvidence(visits: Array<{ adId: string; productId: string | null; visits: number }>): Map<string, string> {
  const byAd = new Map<string, Map<string, number>>();
  for (const row of visits) {
    if (!row.adId || !row.productId || !(row.visits > 0)) continue;
    const products = byAd.get(row.adId) ?? new Map<string, number>();
    products.set(row.productId, (products.get(row.productId) ?? 0) + row.visits);
    byAd.set(row.adId, products);
  }
  const result = new Map<string, string>();
  for (const [adId, products] of byAd) {
    const total = Array.from(products.values()).reduce((sum, value) => sum + value, 0);
    const [best, count] = Array.from(products.entries()).sort((a, b) => b[1] - a[1])[0];
    if (count / total >= 0.9) result.set(adId, best);
  }
  return result;
}

export function mappingIndex(mappings: SpendMapping[]) {
  const index = new Map<string, Split[]>();
  for (const row of mappings) if (Array.isArray(row.splits) && row.splits.length) index.set(`${row.level}:${row.meta_id}`, row.splits);
  return index;
}

/** Which product(s) one insight's spend belongs to, and why. */
export function resolveSplits(insight: Pick<SpendInsight, "ad_id" | "adset_id" | "campaign_id" | "ad_account_id">, index: Map<string, Split[]>, evidence: Map<string, string>): { splits: Split[]; source: MappingSource } {
  const manual = (level: AdSpendLevel, id: string) => (id ? index.get(`${level}:${id}`) : undefined);
  const ad = manual("ad", insight.ad_id); if (ad) return { splits: ad, source: "ad" };
  const adset = manual("adset", insight.adset_id); if (adset) return { splits: adset, source: "adset" };
  const campaign = manual("campaign", insight.campaign_id); if (campaign) return { splits: campaign, source: "campaign" };
  const linked = evidence.get(insight.ad_id); if (linked) return { splits: [{ productId: linked, share: 100 }], source: "link" };
  const account = manual("account", insight.ad_account_id); if (account) return { splits: account, source: "account" };
  return { splits: [], source: null };
}

/** Insights cut into pieces, one per product share (or one unmapped piece). */
export function allocate(insights: SpendInsight[], index: Map<string, Split[]>, evidence: Map<string, string>, accounts: Map<string, AccountInfo>): SpendPiece[] {
  const pieces: SpendPiece[] = [];
  for (const row of insights) {
    const spend = money(row.spend);
    if (spend === 0) continue;
    const account = accounts.get(row.ad_account_id);
    const base = {
      platform: row.platform ?? ("meta" as AdPlatform),
      day: String(row.day).slice(0, 10), accountId: row.ad_account_id, businessKey: account?.businessKey ?? "",
      campaignId: row.campaign_id, campaignName: row.campaign_name, adsetId: row.adset_id, adsetName: row.adset_name, adId: row.ad_id, adName: row.ad_name
    };
    const { splits, source } = resolveSplits(row, index, evidence);
    if (!splits.length) { pieces.push({ ...base, spend, productId: null, source: null }); continue; }
    for (const split of splits) pieces.push({ ...base, spend: (spend * split.share) / 100, productId: split.productId, source });
  }
  return pieces;
}

// ---------------------------------------------------------------- report

export type ReportFilters = { platform?: PlatformChoice; productId?: string; campaignId?: string; adsetId?: string; accountId?: string; businessKey?: string; q?: string };
export type Metrics = { spend: number; orders: number; delivered: number; revenue: number; profit: number; cpa: number | null; cpdo: number | null; deliveredAov: number | null; roas: number | null };

function metricsOf(spend: number, orders: SpendOrder[]): Metrics {
  const delivered = orders.filter((order) => order.status === "Delivered");
  const revenue = delivered.reduce((sum, order) => sum + order.amount, 0);
  const margin = delivered.reduce((sum, order) => sum + order.amount - order.productCost - order.deliveryFee, 0);
  return {
    spend, orders: orders.length, delivered: delivered.length, revenue, profit: margin - spend,
    cpa: orders.length ? spend / orders.length : null, cpdo: delivered.length ? spend / delivered.length : null,
    deliveredAov: delivered.length ? revenue / delivered.length : null, roas: spend > 0 ? revenue / spend : null
  };
}

export type ReportInput = {
  view: AdSpendView; from: string; to: string; compareFrom: string; compareTo: string; trendDays: string[]; chartDays: string[];
  pieces: SpendPiece[]; orders: SpendOrder[]; filters: ReportFilters;
  accounts: Map<string, AccountInfo>; products: Map<string, { name: string; imageUrl: string | null }>;
  /** Platforms whose spend Protohub reads. "All" only counts orders of these. */
  connected?: AdPlatform[];
};

export function buildReport(input: ReportInput) {
  const { view, filters } = input;
  const inRange = (day: string, from: string, to: string) => day >= from && day <= to;
  // Campaign -> account, so an order (which only knows its campaign) finds its ad account / business.
  const accountOfCampaign = new Map<string, string>();
  for (const piece of input.pieces) if (piece.campaignId && !accountOfCampaign.has(piece.campaignId)) accountOfCampaign.set(piece.campaignId, piece.accountId);
  const adsetOfAd = new Map<string, string>();
  const campaignOfAdset = new Map<string, string>();
  for (const piece of input.pieces) { if (piece.adId) adsetOfAd.set(piece.adId, piece.adsetId); if (piece.adsetId) campaignOfAdset.set(piece.adsetId, piece.campaignId); }
  const orderCampaign = (order: SpendOrder) => order.campaignId ?? (order.adsetId ? campaignOfAdset.get(order.adsetId) : undefined) ?? (order.adId ? campaignOfAdset.get(adsetOfAd.get(order.adId) ?? "") : undefined) ?? null;
  const orderAccount = (order: SpendOrder) => { const campaign = orderCampaign(order); return campaign ? accountOfCampaign.get(campaign) ?? null : null; };
  const orderBusiness = (order: SpendOrder) => { const account = orderAccount(order); return account ? input.accounts.get(account)?.businessKey ?? null : null; };

  const platform: PlatformChoice = filters.platform ?? "meta";
  const connected = new Set<AdPlatform>(input.connected ?? ["meta"]);
  // Which orders this platform choice may count: Meta = not from another ad
  // platform; TikTok = TikTok's; All = Meta's plus each connected platform's.
  const orderPlatformOk = (order: SpendOrder) => {
    const from = order.otherPlatform ?? null;
    if (platform === "meta") return !from;
    if (platform === "tiktok") return from === "TikTok";
    return !from || (from === "TikTok" && connected.has("tiktok"));
  };
  const pieceMatches = (piece: SpendPiece) =>
    (platform === "all" || piece.platform === platform)
    && (!filters.productId || (filters.productId === UNMAPPED ? piece.productId === null : piece.productId === filters.productId))
    && (!filters.campaignId || piece.campaignId === filters.campaignId)
    && (!filters.adsetId || piece.adsetId === filters.adsetId)
    && (!filters.accountId || piece.accountId === filters.accountId)
    && (!filters.businessKey || piece.businessKey === filters.businessKey);
  const metaFilter = Boolean(filters.campaignId || filters.adsetId || filters.accountId || filters.businessKey);
  // With a campaign / ad set / account / business filter, only orders carrying it can be counted.
  const orderMatches = (order: SpendOrder) =>
    (!filters.productId || order.productId === filters.productId)
    && (!filters.campaignId || orderCampaign(order) === filters.campaignId)
    && (!filters.adsetId || (order.adsetId ?? (order.adId ? adsetOfAd.get(order.adId) : null)) === filters.adsetId)
    && (!filters.accountId || orderAccount(order) === filters.accountId)
    && (!filters.businessKey || orderBusiness(order) === filters.businessKey);

  const pieces = input.pieces.filter(pieceMatches);
  const matched = filters.productId === UNMAPPED ? [] : input.orders.filter(orderMatches);
  const orders = matched.filter(orderPlatformOk);
  const period = (rows: SpendPiece[], from: string, to: string) => rows.filter((piece) => inRange(piece.day, from, to));
  const periodOrders = (rows: SpendOrder[], from: string, to: string) => rows.filter((order) => inRange(order.day, from, to));
  const nowPieces = period(pieces, input.from, input.to);
  const prevPieces = period(pieces, input.compareFrom, input.compareTo);
  const nowOrders = periodOrders(orders, input.from, input.to);
  const prevOrders = periodOrders(orders, input.compareFrom, input.compareTo);

  // Products that count for the totals: those with spend, or with orders from Meta ads.
  const isAdOrder = (order: SpendOrder) => Boolean(orderCampaign(order) || order.adId);
  const totalsOrders = (piecesIn: SpendPiece[], ordersIn: SpendOrder[]) => {
    if (metaFilter) return ordersIn.filter(isAdOrder);
    const spent = new Set(piecesIn.map((piece) => piece.productId).filter(Boolean) as string[]);
    for (const order of ordersIn) if (order.productId && isAdOrder(order)) spent.add(order.productId);
    return ordersIn.filter((order) => order.productId && spent.has(order.productId));
  };
  const sum = (rows: SpendPiece[]) => rows.reduce((total, piece) => total + piece.spend, 0);
  const kpis = metricsOf(sum(nowPieces), totalsOrders(nowPieces, nowOrders));
  // Other platforms' orders of the same products, left out above (shown under the Orders card).
  const counted = new Set(totalsOrders(nowPieces, nowOrders).map((order) => order.productId));
  const leftOutByPlatform = new Map<string, number>();
  for (const order of periodOrders(matched, input.from, input.to)) {
    if (order.otherPlatform && !orderPlatformOk(order) && order.productId && (counted.has(order.productId) || filters.productId)) leftOutByPlatform.set(order.otherPlatform, (leftOutByPlatform.get(order.otherPlatform) ?? 0) + 1);
  }
  const previous = metricsOf(sum(prevPieces), totalsOrders(prevPieces, prevOrders));

  // ------------------------------------------------ rows of the chosen view
  type Group = { id: string; name: string; pieces: SpendPiece[]; prevSpend: number; trend: number[] };
  const keyOf = (piece: SpendPiece): { id: string; name: string } => {
    if (view === "product") return piece.productId ? { id: piece.productId, name: input.products.get(piece.productId)?.name ?? "Deleted product" } : { id: UNMAPPED, name: "Not assigned to a product" };
    if (view === "campaign") return { id: piece.campaignId, name: piece.campaignName };
    if (view === "adset") return { id: piece.adsetId || `${piece.campaignId}:none`, name: piece.adsetName || "(no ad set)" };
    if (view === "ad") return { id: piece.adId, name: piece.adName };
    if (view === "account") return { id: piece.accountId, name: input.accounts.get(piece.accountId)?.name || `act_${piece.accountId}` };
    return { id: piece.businessKey || "none", name: input.accounts.get(piece.accountId)?.businessName || "Ad accounts added by hand" };
  };
  const groups = new Map<string, Group>();
  const get = (key: { id: string; name: string }) => {
    const group = groups.get(key.id) ?? { id: key.id, name: key.name, pieces: [], prevSpend: 0, trend: input.trendDays.map(() => 0) };
    if (!group.name && key.name) group.name = key.name;
    groups.set(key.id, group);
    return group;
  };
  for (const piece of nowPieces) get(keyOf(piece)).pieces.push(piece);
  for (const piece of prevPieces) { const group = groups.get(keyOf(piece).id); if (group) group.prevSpend += piece.spend; }
  const trendIndex = new Map(input.trendDays.map((day, index) => [day, index]));
  for (const piece of pieces) { const at = trendIndex.get(piece.day); const group = groups.get(keyOf(piece).id); if (at !== undefined && group) group.trend[at] += piece.spend; }
  // Products with Meta-ad orders but no spend show too (their spend may be unassigned).
  if (view === "product") for (const order of nowOrders) if (order.productId && isAdOrder(order) && !groups.has(order.productId)) get({ id: order.productId, name: input.products.get(order.productId)?.name ?? order.productId });

  const ordersFor = (group: Group) => {
    if (view === "product") return group.id === UNMAPPED ? [] : nowOrders.filter((order) => order.productId === group.id && (!metaFilter || isAdOrder(order)));
    if (view === "campaign") return nowOrders.filter((order) => orderCampaign(order) === group.id);
    if (view === "adset") return nowOrders.filter((order) => (order.adsetId ?? (order.adId ? adsetOfAd.get(order.adId) : null)) === group.id);
    if (view === "ad") return nowOrders.filter((order) => order.adId === group.id);
    if (view === "account") return nowOrders.filter((order) => orderAccount(order) === group.id);
    return nowOrders.filter((order) => orderBusiness(order) === group.id);
  };
  const distinct = (rows: SpendPiece[], pick: (piece: SpendPiece) => string) => new Set(rows.map(pick).filter(Boolean)).size;
  const q = (filters.q ?? "").trim().toLowerCase();
  const rows = Array.from(groups.values()).map((group) => {
    const metrics = metricsOf(sum(group.pieces), ordersFor(group));
    const first = group.pieces[0];
    const productIds = Array.from(new Set(group.pieces.map((piece) => piece.productId)));
    const sources = Array.from(new Set(group.pieces.map((piece) => piece.source)));
    const unassigned = group.pieces.filter((piece) => piece.productId === null).reduce((total, piece) => total + piece.spend, 0);
    const accountName = first ? input.accounts.get(first.accountId)?.name || `act_${first.accountId}` : null;
    return {
      id: group.id, name: group.name || group.id,
      image: view === "product" && group.id !== UNMAPPED ? input.products.get(group.id)?.imageUrl ?? null : null,
      campaigns: distinct(group.pieces, (piece) => piece.campaignId), adsets: distinct(group.pieces, (piece) => piece.adsetId),
      ads: distinct(group.pieces, (piece) => piece.adId), accounts: distinct(group.pieces, (piece) => piece.accountId),
      platform: first?.platform ?? null,
      accountId: first?.accountId ?? null, accountName, campaignId: first?.campaignId ?? null, campaignName: first?.campaignName ?? null, adsetId: first?.adsetId ?? null, adsetName: first?.adsetName ?? null,
      products: productIds.filter(Boolean).map((id) => ({ id: id!, name: input.products.get(id!)?.name ?? "Deleted product" })),
      // "ad" / "adset" / "campaign" / "account" = set by the Owner at that level; "link" = from the tracking link; "mixed" = parts differ.
      mappingSource: sources.length === 1 ? sources[0] : "mixed", unassignedSpend: unassigned,
      ...metrics,
      spendChange: group.prevSpend > 0 ? ((metrics.spend - group.prevSpend) / group.prevSpend) * 100 : null,
      trend: group.trend
    };
  }).filter((row) => !q || `${row.name} ${row.id} ${row.campaignName ?? ""} ${row.accountName ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => (a.id === UNMAPPED ? 1 : b.id === UNMAPPED ? -1 : b.spend - a.spend || b.orders - a.orders));

  // ------------------------------------------------ charts
  const chartIndex = new Map(input.chartDays.map((day, index) => [day, index]));
  const chart = input.chartDays.map((day) => ({ day, spend: 0, orders: 0, delivered: 0 }));
  for (const piece of pieces) { const at = chartIndex.get(piece.day); if (at !== undefined) chart[at].spend += piece.spend; }
  const chartOrders = totalsOrders(pieces.filter((piece) => chartIndex.has(piece.day)), orders.filter((order) => chartIndex.has(order.day)));
  for (const order of chartOrders) { const at = chartIndex.get(order.day)!; chart[at].orders += 1; if (order.status === "Delivered") chart[at].delivered += 1; }

  const byProductMap = new Map<string, number>();
  for (const piece of nowPieces) byProductMap.set(piece.productId ?? UNMAPPED, (byProductMap.get(piece.productId ?? UNMAPPED) ?? 0) + piece.spend);
  const byProduct = Array.from(byProductMap.entries()).map(([id, spend]) => ({
    id, name: id === UNMAPPED ? "Not assigned" : input.products.get(id)?.name ?? "Deleted product", spend, share: kpis.spend > 0 ? (spend / kpis.spend) * 100 : 0
  })).sort((a, b) => b.spend - a.spend);

  const unmappedPieces = nowPieces.filter((piece) => piece.productId === null);
  return {
    kpis, previous, rows, chart, byProduct,
    leftOut: Array.from(leftOutByPlatform.entries()).map(([platform, orders]) => ({ platform, orders })).sort((a, b) => b.orders - a.orders),
    unmapped: { spend: sum(unmappedPieces), campaigns: distinct(unmappedPieces, (piece) => piece.campaignId) }
  };
}
