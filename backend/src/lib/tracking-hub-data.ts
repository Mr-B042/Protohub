import { supabase } from "./supabase.js";
import { addDaysToDateKey, lagosDateKey } from "./sales-bonus-engine.js";
import {
  PURCHASE_STATUS_LABEL, attributionCapture, domainOf, healthScore, humanMetaError, orderAdIds, pathOf, purchaseStatus,
  reconciliationVerdict, type HealthItem, type PurchaseStatus
} from "./tracking-hub.js";

// Tracking Hub data (Bright, 2 Oct 2026). Loads orders, sends, browser
// reports, page views, links, sources and websites, and works out every
// count the hub's tabs show. Used by routes/tracking-hub.ts and the hourly
// alert job, so there is one set of numbers.

export const startIso = (day: string) => new Date(`${day}T00:00:00+01:00`).toISOString();
export const endIso = (day: string) => new Date(`${day}T23:59:59.999+01:00`).toISOString();
export const dayOfIso = (iso: string) => lagosDateKey(iso);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
export const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : now > 0 ? 100 : 0);

export type OrderRow = {
  id: string; created_at: string; product_id: string | null; product_name: string | null; package_name?: string | null; amount: number | null; currency: string | null; status: string | null;
  customer?: string | null; phone?: string | null; state?: string | null; city?: string | null;
  utm_source: string | null; utm_campaign: string | null; utm_content: string | null; utm_term: string | null; utm_medium?: string | null; referrer: string | null;
  form_context: Record<string, any> | null; review_hold: boolean | null; delivered_date?: string | null;
};

const ORDER_FIELDS = "id, created_at, product_id, product_name, package_name, amount, currency, status, customer, phone, state, city, utm_source, utm_campaign, utm_content, utm_term, utm_medium, referrer, form_context, review_hold, delivered_date";

/** Orders that came through a Protohub form (they carry the ad ids and tracking mode). */
export async function formOrders(orgId: string, branchId: string, from: string, to: string): Promise<OrderRow[]> {
  const rows: OrderRow[] = [];
  for (let page = 0; page < 40; page += 1) {
    const { data, error } = await supabase.from("orders").select(ORDER_FIELDS)
      .eq("org_id", orgId).eq("branch_id", branchId).gte("created_at", startIso(from)).lte("created_at", endIso(to))
      .not("form_context", "is", null).order("id").range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as OrderRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return rows.filter((row) => row.form_context && Object.keys(row.form_context).length > 0 && row.review_hold !== true);
}

export type Events = { server: Map<string, any>; delivered: Map<string, any>; browser: Map<string, any> };

export async function eventsFor(orgId: string, orderIds: string[]): Promise<Events> {
  const server = new Map<string, any>();
  const delivered = new Map<string, any>();
  const browser = new Map<string, any>();
  for (let i = 0; i < orderIds.length; i += 300) {
    const chunk = orderIds.slice(i, i + 300);
    const [serverRes, browserRes] = await Promise.all([
      supabase.from("meta_capi_events").select("order_id, event_name, meta_event_name, event_id, status, http_status, message, test_mode, sent_at, attempts, pixel_id").eq("org_id", orgId).in("order_id", chunk),
      supabase.from("tracking_browser_events").select("order_id, event_id, pixel_id, page_url, page_domain, pixels_on_page, fired_at").eq("org_id", orgId).in("order_id", chunk)
    ]);
    if (serverRes.error) throw serverRes.error;
    if (browserRes.error) throw browserRes.error;
    for (const row of serverRes.data ?? []) (row.event_name === "Delivered" ? delivered : server).set(String(row.order_id), row);
    for (const row of browserRes.data ?? []) browser.set(String(row.order_id), row);
  }
  return { server, delivered, browser };
}

export type LedgerStatus = PurchaseStatus | "page_pixel" | "capi_only" | "sending";
export const LEDGER_LABEL: Record<LedgerStatus, string> = { ...PURCHASE_STATUS_LABEL, page_pixel: "Thank-you page", capi_only: "CAPI only", sending: "Sending", deduped: "Deduped" };

export type LedgerRow = ReturnType<typeof ledgerRow>;

export function ledgerRow(order: OrderRow, events: Events) {
  const server = events.server.get(order.id) ?? null;
  const browser = events.browser.get(order.id) ?? null;
  const ctx = order.form_context ?? {};
  const mode = String(ctx.metaTrackingMode ?? "landing_page") || "landing_page";
  let status: LedgerStatus = purchaseStatus({ serverStatus: server?.status ?? null, serverEventId: server?.event_id ?? null, browserEventId: browser?.event_id ?? null, serverTest: Boolean(server?.test_mode) });
  if (status === "server_only" && mode === "protohub") status = "capi_only";
  if (status === "not_tracked" && mode === "landing_page") status = "page_pixel";
  if (status === "not_tracked" && Date.now() - Date.parse(order.created_at) < 120_000) status = "sending";
  const ids = orderAdIds(order);
  const landing = typeof ctx.landingPageUrl === "string" && ctx.landingPageUrl ? ctx.landingPageUrl : null;
  return {
    orderId: order.id, createdAt: order.created_at, product: order.product_name ?? "", productId: order.product_id,
    website: domainOf(landing) ?? domainOf(order.referrer) ?? null, landingPath: pathOf(landing),
    source: order.utm_source ?? null, campaignId: ids.campaignId, adsetId: ids.adsetId, adId: ids.adId,
    value: Number(order.amount) || 0, currency: order.currency ?? "NGN", orderStatus: order.status,
    trackingMode: mode, trackingKey: ctx.metaTrackingKey ? String(ctx.metaTrackingKey).toLowerCase() : null,
    browser: Boolean(browser), browserAt: browser?.fired_at ?? null,
    serverStatus: server?.status ?? null, serverAt: server?.sent_at ?? null, serverTest: Boolean(server?.test_mode), serverPixel: server?.pixel_id ?? null,
    eventId: server?.event_id ?? browser?.event_id ?? null,
    status, statusLabel: LEDGER_LABEL[status]
  };
}

export function kpisOf(rows: LedgerRow[]) {
  const orders = rows.length;
  const sent = (row: LedgerRow) => row.serverStatus === "sent" || row.serverStatus === "dry_run";
  const purchaseEvents = rows.filter((row) => row.browser || sent(row)).length;
  const browserEvents = rows.filter((row) => row.browser).length;
  const serverEvents = rows.filter(sent).length;
  const deduped = rows.filter((row) => row.status === "deduped").length;
  const failed = rows.filter((row) => row.status === "capi_failed").length;
  const unmatched = rows.filter((row) => row.trackingMode !== "landing_page" && row.status === "not_tracked").length;
  return {
    orders, purchaseEvents, browserEvents, serverEvents, deduped, unmatched, failed,
    browserPct: pct(browserEvents, orders), serverPct: pct(serverEvents, orders), purchasePct: pct(purchaseEvents, orders),
    dedupRate: pct(deduped, purchaseEvents), unmatchedPct: pct(unmatched, orders)
  };
}

export type JourneyRow = { day: string; event_type: string; product_id: string | null; tracking_key: string | null; domain: string | null; path: string | null; campaign_id: string | null; ad_id: string | null; visits: number };

/** Page views (form_opened), form starts (first_interaction), order presses, redirects - distinct visits. */
export async function journeyCounts(orgId: string, branchId: string, from: string, to: string): Promise<JourneyRow[]> {
  const { data, error } = await supabase.rpc("tracking_journey_counts", { p_org: orgId, p_branch: branchId, p_from: startIso(from), p_to: endIso(to) });
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({ ...row, day: String(row.day).slice(0, 10), visits: Number(row.visits) || 0 }));
}

export const sumVisits = (rows: JourneyRow[], type: string, test: (row: JourneyRow) => boolean = () => true) =>
  rows.filter((row) => row.event_type === type && test(row)).reduce((sum, row) => sum + row.visits, 0);

export async function loadBasics(orgId: string, branchId: string) {
  const [sources, websites, profiles, links, products, connections, adAccounts] = await Promise.all([
    supabase.from("tracking_data_sources").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("is_main", { ascending: false }).order("name"),
    supabase.from("tracking_websites").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("domain"),
    supabase.from("tracking_profiles").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("name"),
    supabase.from("meta_capi_configs").select("*").eq("org_id", orgId).order("label"),
    supabase.from("products").select("id, name, image_url, sku").eq("org_id", orgId),
    supabase.from("tracking_meta_connections").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("created_at"),
    supabase.from("tracking_meta_ad_accounts").select("*").eq("org_id", orgId).eq("branch_id", branchId).order("name")
  ]);
  for (const result of [sources, websites, profiles, links, products, connections, adAccounts]) if (result.error) throw result.error;
  // A Pixel found through a Meta Business connection uses the connection's
  // token unless it has its own; a Pixel switched off has none.
  const connectionOf = new Map((connections.data ?? []).map((row: any) => [row.id, row]));
  const withToken = (sources.data ?? []).map((row: any) => {
    const connection: any = row.connection_id ? connectionOf.get(row.connection_id) ?? null : null;
    return { ...row, connection, effective_token: row.active === false ? null : row.access_token || connection?.access_token || null };
  });
  const productIds = (products.data ?? []).map((row: any) => row.id);
  const { data: packages } = productIds.length ? await supabase.from("product_packages").select("product_id, image_url, display_order").in("product_id", productIds).not("image_url", "is", null) : { data: [] as any[] };
  const imageOf = new Map<string, string>();
  for (const product of products.data ?? []) if (product.image_url) imageOf.set(product.id, product.image_url);
  for (const pack of (packages ?? []).sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0))) if (!imageOf.has(pack.product_id) && pack.image_url) imageOf.set(pack.product_id, pack.image_url);
  return {
    sources: withToken,
    connections: connections.data ?? [],
    adAccounts: adAccounts.data ?? [],
    websites: websites.data ?? [],
    profiles: profiles.data ?? [],
    links: (links.data ?? []).filter((row: any) => (!row.branch_id || row.branch_id === branchId) && row.tracking_key !== "__default__"),
    defaultLink: (links.data ?? []).find((row: any) => row.tracking_key === "__default__") ?? null,
    products: (products.data ?? []).map((row: any) => ({ id: row.id, name: row.name, sku: row.sku, imageUrl: imageOf.get(row.id) ?? null }))
  };
}
export type Basics = Awaited<ReturnType<typeof loadBasics>>;

export const STRATEGY_OF_MODE: Record<string, string> = { hybrid: "browser_capi", protohub: "capi_only", landing_page: "landing_page", off: "off" };
export const MODE_OF_STRATEGY: Record<string, string> = { browser_capi: "hybrid", capi_only: "protohub", landing_page: "landing_page" };

// ---------------------------------------------------------------- settings

export const DEFAULT_HUB_SETTINGS = {
  enabled: true,
  currency: "NGN",
  timezone: "Africa/Lagos",
  sendBrowser: true,
  sendCapi: true,
  multiPlatform: true,
  logAllEvents: true,
  trackingMode: "order_based" as "order_based" | "thank_you" | "hybrid",
  defaultStrategy: "browser_capi" as "browser_capi" | "capi_only" | "landing_page",
  defaultDataSources: {} as Record<string, string>,
  defaultEventValue: "order_total" as "order_total",
  defaultWebsiteId: null as string | null,
  defaultProfileId: null as string | null,
  notifications: { capiFailures: true, connection: true, duplicatePixel: true, lostParameters: false, dailySummary: false },
  urlParameters: "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_id={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}&campaign_id={{campaign.id}}&adset_id={{adset.id}}&ad_id={{ad.id}}",
  lowConversionRate: 30,
  investigateBelowMatchRate: 85
};
export type HubSettings = typeof DEFAULT_HUB_SETTINGS;

export async function loadHubSettings(orgId: string, branchId: string): Promise<HubSettings> {
  const { data } = await supabase.from("tracking_settings").select("settings").eq("org_id", orgId).eq("branch_id", branchId).maybeSingle();
  const saved = (data?.settings ?? {}) as Partial<HubSettings>;
  return { ...DEFAULT_HUB_SETTINGS, ...saved, notifications: { ...DEFAULT_HUB_SETTINGS.notifications, ...(saved.notifications ?? {}) } };
}

export async function hubAudit(orgId: string, branchId: string, actor: { id?: string | null; name?: string | null } | null, action: string, subject: { type?: string; id?: string | null; label?: string | null } = {}, detail: Record<string, unknown> = {}) {
  await supabase.from("tracking_audit").insert({
    org_id: orgId, branch_id: branchId, action, subject_type: subject.type ?? null, subject_id: subject.id ?? null, subject_label: subject.label ?? null,
    detail, actor_id: actor?.id ?? null, actor_name: actor?.name ?? null
  });
}

// ------------------------------------------------------------- assessment

export type Issue = {
  key: string; severity: "red" | "orange" | "yellow"; level: "critical" | "warning" | "info";
  title: string; detail: string; action: string; at: string | null; tab: string; affected: string; actionLabel: string;
  orderIds?: string[]; subjectId?: string | null;
};

/** Health of every source / website / link and the issue list (Overview, Diagnostics, alerts). */
export async function assess(orgId: string, branchId: string) {
  const basics = await loadBasics(orgId, branchId);
  const today = lagosDateKey();
  const weekAgo = addDaysToDateKey(today, -6);
  const [orders, journey] = await Promise.all([formOrders(orgId, branchId, weekAgo, today), journeyCounts(orgId, branchId, weekAgo, today).catch(() => [] as JourneyRow[])]);
  const events = await eventsFor(orgId, orders.map((order) => order.id));
  const rows = orders.map((order) => ledgerRow(order, events));
  const browserRows = Array.from(events.browser.values());
  const serverRows = Array.from(events.server.values());

  const sourceRows = basics.sources.map((source: any) => {
    const stats = source.meta_stats ?? {};
    const counts7d = (stats.counts7d ?? stats.counts ?? null) as Record<string, number> | null;
    const prev7d = (stats.prev7d ?? null) as Record<string, number> | null;
    const total = (map: Record<string, number> | null) => (map ? Object.values(map).reduce((sum, value) => sum + Number(value || 0), 0) : null);
    const sentByProtohub7d = serverRows.filter((row: any) => row.status === "sent" && (!row.pixel_id || row.pixel_id === source.pixel_id)).length;
    const events7d = total(counts7d);
    const platform = source.platform ?? "meta";
    const connection = source.connection ?? null;
    const usesConnectionToken = Boolean(connection && !source.access_token);
    const checkOk = usesConnectionToken && connection.last_check_ok === false ? false : source.last_check_ok;
    const health = source.active === false ? "off"
      : !source.effective_token ? "no_token"
      : source.status === "paused" ? "disconnected"
      : source.has_access === false ? "no_access"
      : checkOk === false ? "error"
      : source.status === "testing" ? "testing"
      : checkOk === true || (usesConnectionToken && connection.last_check_ok === true && source.has_access === true) ? "healthy" : "unchecked";
    return {
      id: source.id, name: source.name, description: source.description ?? "", platform, businessName: source.business_name, adAccountIds: source.ad_account_ids ?? [], adAccountLabel: source.ad_account_label ?? "",
      pixelId: source.pixel_id, datasetName: source.dataset_name ?? null, currency: source.currency ?? "NGN", timezone: source.timezone ?? "Africa/Lagos",
      hasToken: Boolean(source.effective_token), ownToken: Boolean(source.access_token), active: source.active !== false, hasAccess: source.has_access ?? null,
      connectionId: connection?.id ?? null, connectionName: connection?.name ?? null, metaLastFiredAt: source.meta_last_fired_at ?? null, testEventCode: source.test_event_code ?? "", isMain: source.is_main, status: source.status,
      lastCheckAt: source.last_check_at ?? (usesConnectionToken ? connection.last_check_at : null), lastCheckOk: checkOk ?? null,
      lastCheckMessage: source.last_check_message ?? (usesConnectionToken ? connection.last_check_message : null),
      metaStatsAt: source.meta_stats_at, emq: stats.emq ?? null,
      events7d, events7dChange: events7d !== null && prev7d ? change(events7d, total(prev7d) ?? 0) : null, eventsFromMeta: events7d !== null, sentByProtohub7d,
      health, healthy: health === "healthy" || health === "testing", createdAt: source.created_at
    };
  });

  const linkRowsBase = basics.links.map((link: any) => {
    const key = String(link.tracking_key).toLowerCase();
    const linkOrders = rows.filter((row) => row.trackingKey === key);
    const failures = linkOrders.filter((row) => row.status === "capi_failed").length;
    const strategy = STRATEGY_OF_MODE[link.mode] ?? "landing_page";
    const checklist = link.checklist ?? {};
    const problems: string[] = [];
    if (!link.data_source_id && !link.pixel_id) problems.push("No data source");
    if (strategy !== "landing_page" && !(checklist.thankYouPixelRemoved && checklist.testEventSeen)) problems.push("Go-live checklist not finished");
    if (failures > 0) problems.push(`${failures} CAPI failure${failures === 1 ? "" : "s"} this week`);
    return { id: link.id, key, problems, healthy: problems.length === 0 && link.active !== false, websiteId: link.website_id };
  });

  const websiteRows = basics.websites.map((site: any) => {
    const beacons = browserRows.filter((row: any) => row.page_domain === site.domain);
    const lastBeacon = beacons.map((row: any) => row.fired_at).sort().pop() ?? null;
    const scan = site.last_scan as { pages?: Array<{ pixels: string[] }> } | null;
    const scanPixels = new Set((scan?.pages ?? []).flatMap((page) => page.pixels ?? []));
    const duplicatePixel = beacons.some((row: any) => (row.pixels_on_page ?? []).length > 1) || scanPixels.size > 1;
    const siteLinks = basics.links.filter((link: any) => link.website_id === site.id);
    const siteOrders = rows.filter((row) => row.website === site.domain);
    const views = journey.filter((row) => row.domain === site.domain);
    const lastView = views.map((row) => row.day).sort().pop() ?? null;
    const lastOrder = siteOrders.map((row) => row.createdAt).sort().pop() ?? null;
    const lastEvent = [lastBeacon, lastOrder].filter(Boolean).sort().pop() ?? (lastView ? `${lastView}T12:00:00+01:00` : null);
    const source = basics.sources.find((row: any) => row.id === site.data_source_id);
    const usesBrowser = siteLinks.some((link: any) => link.mode === "hybrid");
    const problems: string[] = [];
    if (!source) problems.push("No data source chosen");
    if (usesBrowser && !lastBeacon && !scanPixels.size) problems.push("Browser Pixel not detected");
    if (duplicatePixel) problems.push("More than one Pixel on the page");
    const landingPaths = new Set<string>([
      ...siteLinks.map((link: any) => pathOf(link.landing_page_url)).filter(Boolean) as string[],
      ...views.map((row) => row.path).filter(Boolean) as string[]
    ]);
    const disconnected = !source && siteOrders.length === 0 && views.length === 0;
    return {
      id: site.id, domain: site.domain, label: site.label ?? "", platform: site.platform, dataSourceId: site.data_source_id,
      dataSourceName: source?.name ?? null, dataSourceIsMain: Boolean(source?.is_main), dataSourcePlatform: source?.platform ?? "meta",
      notes: site.notes, forms: siteLinks.length, activeForms: siteLinks.filter((link: any) => link.active !== false).length,
      orders7d: siteOrders.length, lastBrowserEvent: lastBeacon, lastEvent, duplicatePixel, landingPages: Array.from(landingPaths),
      lastScanAt: site.last_scan_at, lastScan: site.last_scan ?? null,
      status: disconnected ? "disconnected" : problems.length === 0 ? "healthy" : "warning", problems, createdAt: site.created_at
    };
  });

  const differentIds = rows.filter((row) => row.browser && row.serverStatus === "sent" && row.status === "server_only").length;
  const capiFailures24h = rows.filter((row) => row.status === "capi_failed" && Date.parse(row.createdAt) > Date.now() - 86_400_000).length;
  const items: HealthItem[] = [
    { key: "sources", label: "Data Sources", total: sourceRows.filter((row: any) => row.active).length, healthy: sourceRows.filter((row: any) => row.active && row.healthy).length, detail: "" },
    { key: "websites", label: "Websites", total: websiteRows.length, healthy: websiteRows.filter((row: any) => row.status === "healthy").length, detail: "" },
    { key: "links", label: "Tracking Links", total: linkRowsBase.length, healthy: linkRowsBase.filter((row: any) => row.healthy).length, detail: "" },
    { key: "dedup", label: "Event Deduplication", total: 1, healthy: differentIds === 0 ? 1 : 0, detail: differentIds === 0 ? "Working properly" : `${differentIds} order${differentIds === 1 ? "" : "s"} with mismatched ids` },
    { key: "capi", label: "CAPI Connection", total: 1, healthy: capiFailures24h === 0 && sourceRows.some((row: any) => row.active && row.hasToken) ? 1 : 0,
      detail: !sourceRows.some((row: any) => row.hasToken) ? "No token connected" : capiFailures24h === 0 ? "All active" : `${capiFailures24h} failure${capiFailures24h === 1 ? "" : "s"} in 24h` }
  ];
  for (const item of items.slice(0, 3)) item.detail = `${item.healthy} Healthy`;
  const result = { basics, rows, orders, events, journey, sourceRows, websiteRows, linkRows: linkRowsBase, items, score: healthScore(items) };
  return { ...result, issues: await buildIssues(orgId, branchId, result) };
}

const LEVEL: Record<Issue["severity"], Issue["level"]> = { red: "critical", orange: "warning", yellow: "info" };

async function buildIssues(orgId: string, branchId: string, a: { basics: Basics; rows: LedgerRow[]; orders: OrderRow[]; events: Events; sourceRows: any[]; websiteRows: any[]; linkRows: any[] }): Promise<Issue[]> {
  const issues: Issue[] = [];
  const push = (issue: Omit<Issue, "level">) => issues.push({ ...issue, level: LEVEL[issue.severity] });
  const failed = a.rows.filter((row) => row.status === "capi_failed");
  const byReason = new Map<string, { rows: LedgerRow[]; message: string; http: number | null; at: string }>();
  for (const row of failed) {
    const event = a.events.server.get(row.orderId);
    const key = String(event?.message ?? "");
    const entry = byReason.get(key) ?? { rows: [] as LedgerRow[], message: key, http: event?.http_status ?? null, at: event?.sent_at ?? row.createdAt };
    entry.rows.push(row);
    if ((event?.sent_at ?? "") > entry.at) entry.at = event.sent_at;
    byReason.set(key, entry);
  }
  for (const entry of byReason.values()) {
    const human = humanMetaError(entry.message, entry.http);
    push({ key: `capi:${entry.message.slice(0, 40)}`, severity: "red", title: human.title, detail: `${entry.rows.length} Purchase event${entry.rows.length === 1 ? " has" : "s have"} not been delivered to Meta.`, action: human.action, at: entry.at, tab: "ledger", affected: `${entry.rows.length} orders`, actionLabel: "View Orders", orderIds: entry.rows.map((row) => row.orderId) });
  }
  const missingBrowser = a.rows.filter((row) => row.trackingMode === "hybrid" && !row.browser && row.serverStatus === "sent");
  if (missingBrowser.length) push({ key: "browser:missing", severity: "red", title: "Missing browser events", detail: `${missingBrowser.length} orders without a browser Purchase`, action: "Re-copy the embed code from Tracking Links onto the landing pages; the new code reports each browser Purchase.", at: missingBrowser[0].createdAt, tab: "ledger", affected: `${missingBrowser.length} orders`, actionLabel: "View Orders", orderIds: missingBrowser.map((row) => row.orderId) });
  for (const connection of a.basics.connections as any[]) {
    const pixels = a.sourceRows.filter((row: any) => row.connectionId === connection.id && row.active && !row.ownToken);
    const affected = `${pixels.length} Pixel${pixels.length === 1 ? "" : "s"}`;
    if (!connection.access_token) push({ key: `conn:token:${connection.id}`, severity: "red", title: `${connection.name || "Meta Business"}: disconnected`, detail: `${affected} cannot send server events or read Meta's numbers.`, action: "Paste a new System User token on the connection (Data Sources).", at: connection.updated_at, tab: "sources", affected, actionLabel: "Fix Now", subjectId: connection.id });
    else if (connection.last_check_ok === false) {
      const human = humanMetaError(connection.last_check_message, null);
      push({ key: `conn:error:${connection.id}`, severity: "red", title: `${connection.name || "Meta Business"}: ${human.title}`, detail: `${affected} affected.`, action: human.action, at: connection.last_check_at, tab: "sources", affected, actionLabel: "Fix Now", subjectId: connection.id });
    }
  }
  for (const source of a.sourceRows) {
    if (!source.active) continue;
    if (source.connectionId && !source.ownToken && (source.health === "no_token" || source.health === "error")) continue;
    if (source.health === "no_access") { push({ key: `source:access:${source.id}`, severity: "orange", title: `${source.name}: not given to the System User`, detail: `Pixel ${source.pixelId} is switched on, but the connection's token cannot use it.`, action: "In Meta Business Settings → System Users → Assign assets, give this Pixel to the System User, then press Sync Assets.", at: null, tab: "sources", affected: "Data source", actionLabel: "Fix Now", subjectId: source.id }); continue; }
    if (source.health === "no_token") push({ key: `source:token:${source.id}`, severity: "orange", title: `${source.name}: no Conversions API token`, detail: "Server Purchase events cannot be sent and Meta's numbers cannot be read.", action: "Connect your Meta Business in Data Sources, or give this Pixel its own token.", at: null, tab: "sources", affected: "Data source", actionLabel: "Fix Now", subjectId: source.id });
    else if (source.health === "error") {
      const human = humanMetaError(source.lastCheckMessage, null);
      push({ key: `source:error:${source.id}`, severity: "red", title: `${source.name}: ${human.title}`, detail: `Pixel ${source.pixelId}.`, action: human.action, at: source.lastCheckAt, tab: "sources", affected: "Data source", actionLabel: "Fix Now", subjectId: source.id });
    } else if (source.health === "unchecked") push({ key: `source:unchecked:${source.id}`, severity: "yellow", title: `${source.name}: connection not tested`, detail: `Pixel ${source.pixelId}.`, action: "Press Test Connection on the data source.", at: null, tab: "sources", affected: "Data source", actionLabel: "View Details", subjectId: source.id });
    const emq = source.emq as Record<string, number> | null;
    if (emq && Object.values(emq).some((score) => score < 7.5)) push({ key: `source:emq:${source.id}`, severity: "orange", title: "Event match quality low", detail: `${source.name} (${Math.min(...Object.values(emq))}/10)`, action: "Pass more customer details: re-copy the embed code so _fbp/_fbc reach the form.", at: source.metaStatsAt, tab: "diagnostics", affected: "Events", actionLabel: "View Details", subjectId: source.id });
  }
  for (const site of a.websiteRows) {
    for (const problem of site.problems) {
      const isDup = problem.startsWith("More than one");
      const isMissing = problem.startsWith("Browser");
      push({ key: `site:${site.id}:${problem}`, severity: isMissing ? "red" : isDup ? "orange" : "yellow", title: isMissing ? "Pixel not detected on page" : isDup ? "Duplicate pixel detected" : site.domain, detail: isMissing || isDup ? site.domain : problem,
        action: isMissing ? "Re-copy the embed code from Tracking Links onto the page; the new code reports each browser Purchase." : isDup ? "Remove the extra Pixel code (theme, plugin or a second snippet) so each Purchase is counted once." : "Choose the data source this website should use.",
        at: site.lastBrowserEvent ?? site.lastScanAt, tab: "websites", affected: `${site.orders7d} orders`, actionLabel: isDup ? "Check Page" : "Fix Now", subjectId: site.id });
    }
  }
  const linkById = new Map(a.basics.links.map((link: any) => [link.id, link]));
  for (const link of a.linkRows) {
    for (const problem of link.problems) {
      const row: any = linkById.get(link.id);
      push({ key: `link:${link.id}:${problem}`, severity: problem.startsWith("Go-live") ? "orange" : problem.includes("CAPI") ? "red" : "yellow", title: row?.label ?? "Tracking link", detail: problem,
        action: problem.startsWith("Go-live") ? "Remove the Purchase Pixel from the thank-you page and run a test event, then tick the checklist." : "Open the link in Tracking Links.", at: null, tab: "links", affected: "Tracking link", actionLabel: "Fix Now", subjectId: link.id });
    }
  }
  const adOrders = a.orders.filter((order) => /^(fb|ig|facebook|instagram|meta|an|msg)$/i.test(String(order.utm_source ?? "")));
  const lost = adOrders.filter((order) => !orderAdIds(order).campaignId).length;
  if (lost > 0) push({ key: "params:lost", severity: "yellow", title: "Missing campaign parameters", detail: "Visits without fbclid/utm", action: "Add the URL parameters from Settings to every ad (campaign_id={{campaign.id}} ...).", at: null, tab: "settings", affected: `${lost} visits`, actionLabel: "View Details" });
  const capture = attributionCapture(a.orders);
  if (capture.orders >= 10 && capture.fields.fbp_fbc < 50) push({ key: "params:fbp", severity: "yellow", title: "CAPI Match Quality", detail: `Meta's browser id (_fbp/_fbc) captured on only ${capture.fields.fbp_fbc}% of ad orders.`, action: "Re-copy the embed code onto each landing page so the browser id is passed in.", at: null, tab: "diagnostics", affected: `${capture.orders} orders`, actionLabel: "View Details" });
  const today = lagosDateKey();
  const { data: insights } = await supabase.from("tracking_meta_ad_insights").select("campaign_id, campaign_name, purchases").eq("org_id", orgId).eq("branch_id", branchId).eq("day", today);
  const metaByCampaign = new Map<string, { name: string; purchases: number }>();
  for (const row of insights ?? []) {
    const entry = metaByCampaign.get(row.campaign_id) ?? { name: row.campaign_name, purchases: 0 };
    entry.purchases += Number(row.purchases) || 0;
    metaByCampaign.set(row.campaign_id, entry);
  }
  const todayRows = a.rows.filter((row) => dayOfIso(row.createdAt) === today);
  for (const [campaignId, meta] of metaByCampaign) {
    const ours = todayRows.filter((row) => row.campaignId === campaignId).length;
    const verdict = reconciliationVerdict({ protohubOrders: ours, purchaseEvents: ours, sentToMeta: ours, duplicates: 0, metaPurchases: Math.round(meta.purchases) });
    if (verdict.tone === "warn") push({ key: `campaign:${campaignId}`, severity: "orange", title: `Campaign ${meta.name || campaignId}`, detail: `${Math.round(meta.purchases)} Meta purchases / ${ours} Protohub orders today.`, action: verdict.likely, at: null, tab: "reconciliation", affected: `${ours} orders`, actionLabel: "View Details", subjectId: campaignId });
  }
  const order = { red: 0, orange: 1, yellow: 2 };
  return issues.sort((x, y) => order[x.severity] - order[y.severity]);
}
