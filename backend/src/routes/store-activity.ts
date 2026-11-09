import { Router } from "express";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { addDaysToDateKey, lagosDateKey } from "../lib/sales-bonus-engine.js";

/**
 * Our Store activity (Bright, 9 Nov 2026; migration 343). Every role records
 * what they do in Our Store; only the Owner reads it.
 *  - The Our Store page sends: open, page (each store page that loads in the
 *    frame), heartbeat (every 30 s while it is on screen, for time spent),
 *    full_store, home.
 *  - The store itself, once its snippet is added, sends page / product /
 *    search / cart / checkout / order with the page address and title.
 */
const router = Router();
router.use(requireAuth);

export const STORE_ORIGIN = "https://protoolshardwareventures.com.ng";
const EVENTS = ["open", "heartbeat", "page", "full_store", "home", "product", "search", "cart", "checkout", "order"] as const;

const EventSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  event: z.enum(EVENTS),
  url: z.string().max(600).optional(),
  title: z.string().max(200).optional(),
  detail: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
  device: z.string().max(40).optional()
});

/** Only the store's own addresses are kept (anything else is dropped). */
const storeUrl = (value?: string) => {
  const url = String(value ?? "").trim();
  return url.startsWith(STORE_ORIGIN) || url.startsWith(STORE_ORIGIN.replace("https://", "https://www.")) ? url.slice(0, 600) : null;
};

router.post("/event", async (req, res) => {
  const parsed = EventSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Bad store event." }); return; }
  // The Owner's "View as" is not the other person using the store.
  if (req.user!.effectiveUserId && req.user!.effectiveUserId !== req.user!.id) { res.json({ ok: true, skipped: true }); return; }
  const user = req.user!;
  const d = parsed.data;
  const now = new Date().toISOString();
  try {
    if (d.event === "open") {
      const { data: created, error } = await supabase.from("store_activity_sessions").upsert({
        id: d.sessionId, org_id: user.orgId, branch_id: user.branchId ?? null, user_id: user.id, user_name: user.name ?? "", role: user.role ?? "",
        started_at: now, last_seen_at: now, device: d.device ?? ""
      }, { onConflict: "id", ignoreDuplicates: true }).select("id");
      if (error) throw error;
      // The same visit sent twice (a page drawn twice) is one visit.
      if (!created?.length) { res.json({ ok: true, repeat: true }); return; }
    } else {
      // Only the person's own session moves on.
      const { data: session } = await supabase.from("store_activity_sessions").select("id, pages, user_id").eq("id", d.sessionId).eq("user_id", user.id).maybeSingle();
      if (!session) { res.json({ ok: false, reason: "no session" }); return; }
      await supabase.from("store_activity_sessions").update({ last_seen_at: now, ...(d.event === "page" || d.event === "product" ? { pages: Number(session.pages ?? 0) + 1 } : {}) }).eq("id", d.sessionId);
      if (d.event === "heartbeat") { res.json({ ok: true }); return; }
    }
    const { error } = await supabase.from("store_activity_events").insert({
      org_id: user.orgId, branch_id: user.branchId ?? null, session_id: d.sessionId, user_id: user.id, user_name: user.name ?? "", role: user.role ?? "",
      event: d.event, url: storeUrl(d.url), title: d.title?.trim().slice(0, 200) || null, detail: d.detail ?? {}
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (error: any) {
    // Never trouble the person over activity that could not be noted.
    console.warn("[store-activity]", error?.message ?? error);
    res.json({ ok: false });
  }
});

async function allRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>) {
  const out: T[] = [];
  for (let page = 0; page < 50; page += 1) {
    const { data, error } = await build(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

router.get("/summary", requireRole("Owner"), async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const today = lagosDateKey(new Date().toISOString());
    const since = addDaysToDateKey(today, -(days - 1));
    const sinceIso = new Date(`${since}T00:00:00+01:00`).toISOString();
    const orgId = req.user!.orgId;
    const [sessions, events, usersResult] = await Promise.all([
      allRows<any>((from, to) => supabase.from("store_activity_sessions").select("id, user_id, user_name, role, started_at, last_seen_at, pages, device").eq("org_id", orgId).gte("started_at", sinceIso).order("started_at", { ascending: false }).range(from, to)),
      allRows<any>((from, to) => supabase.from("store_activity_events").select("session_id, user_id, user_name, role, event, url, title, detail, created_at").eq("org_id", orgId).gte("created_at", sinceIso).order("created_at", { ascending: false }).range(from, to)),
      supabase.from("users").select("id, name, role, active").eq("org_id", orgId).eq("active", true)
    ]);
    if (usersResult.error) throw usersResult.error;
    const users = (usersResult.data ?? []).map((row: any) => ({ id: String(row.id), name: String(row.name ?? "User"), role: String(row.role ?? "") }));
    const nameOf = new Map(users.map((row) => [row.id, row]));
    // Time in the store per visit: start to the last "still here", 30 s minimum.
    const seconds = (row: any) => Math.max(30, Math.round((Date.parse(row.last_seen_at) - Date.parse(row.started_at)) / 1000));
    const count = (list: any[], kind: string) => list.filter((row) => row.event === kind).length;

    type Tally = { visits: number; seconds: number; pages: number; fullStore: number; products: number; searches: number; carts: number; checkouts: number; orders: number; lastAt: string | null; days: Set<string> };
    const blank = (): Tally => ({ visits: 0, seconds: 0, pages: 0, fullStore: 0, products: 0, searches: 0, carts: 0, checkouts: 0, orders: 0, lastAt: null, days: new Set() });
    const byUser = new Map<string, Tally>();
    const tallyOf = (id: string) => { if (!byUser.has(id)) byUser.set(id, blank()); return byUser.get(id)!; };
    for (const row of sessions) {
      const t = tallyOf(String(row.user_id));
      t.visits += 1; t.seconds += seconds(row); t.pages += Number(row.pages) || 0;
      t.days.add(lagosDateKey(row.started_at));
      if (!t.lastAt || row.last_seen_at > t.lastAt) t.lastAt = row.last_seen_at;
    }
    for (const row of events) {
      const t = tallyOf(String(row.user_id));
      if (row.event === "full_store") t.fullStore += 1;
      if (row.event === "product") t.products += 1;
      if (row.event === "search") t.searches += 1;
      if (row.event === "cart") t.carts += 1;
      if (row.event === "checkout") t.checkouts += 1;
      if (row.event === "order") t.orders += 1;
    }
    const person = (id: string, t: Tally) => {
      const who = nameOf.get(id);
      const session = sessions.find((row) => String(row.user_id) === id);
      return { userId: id, name: who?.name ?? session?.user_name ?? "Former user", role: who?.role ?? session?.role ?? "", visits: t.visits, seconds: t.seconds, pages: t.pages,
        activeDays: t.days.size, fullStore: t.fullStore, products: t.products, searches: t.searches, carts: t.carts, checkouts: t.checkouts, orders: t.orders, lastAt: t.lastAt };
    };
    const people = [...byUser.entries()].map(([id, t]) => person(id, t)).sort((a, b) => b.visits - a.visits || String(b.lastAt).localeCompare(String(a.lastAt)));
    const roles = new Map<string, { role: string; people: number; visits: number; seconds: number; pages: number; carts: number; orders: number }>();
    for (const row of people) {
      const r = roles.get(row.role) ?? { role: row.role || "—", people: 0, visits: 0, seconds: 0, pages: 0, carts: 0, orders: 0 };
      r.people += 1; r.visits += row.visits; r.seconds += row.seconds; r.pages += row.pages; r.carts += row.carts; r.orders += row.orders;
      roles.set(row.role, r);
    }
    const daily: Array<{ day: string; visits: number; people: number }> = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = addDaysToDateKey(today, -i);
      const list = sessions.filter((row) => lagosDateKey(row.started_at) === day);
      daily.push({ day, visits: list.length, people: new Set(list.map((row) => row.user_id)).size });
    }
    // The store's own pages and products people looked at most.
    const pageCounts = new Map<string, { title: string; url: string; views: number; kind: string }>();
    for (const row of events) {
      if (!["page", "product"].includes(row.event) || !row.url) continue;
      const key = row.url.split("?")[0];
      const entry = pageCounts.get(key) ?? { title: row.title || key.replace(STORE_ORIGIN, "") || "Home", url: key, views: 0, kind: row.event };
      entry.views += 1; if (row.event === "product") entry.kind = "product";
      pageCounts.set(key, entry);
    }
    const storeSends = events.some((row) => ["product", "search", "cart", "checkout", "order"].includes(row.event) || (row.event === "page" && row.url));
    res.json({
      days, since, today, storeConnected: storeSends,
      kpis: {
        people: people.length, staff: users.length, visits: sessions.length, seconds: people.reduce((sum, row) => sum + row.seconds, 0),
        pages: people.reduce((sum, row) => sum + row.pages, 0), fullStore: count(events, "full_store"), products: count(events, "product"),
        searches: count(events, "search"), carts: count(events, "cart"), checkouts: count(events, "checkout"), orders: count(events, "order")
      },
      roles: [...roles.values()].sort((a, b) => b.visits - a.visits),
      people,
      notOpened: users.filter((row) => !byUser.has(row.id)).map((row) => ({ userId: row.id, name: row.name, role: row.role })),
      daily,
      topPages: [...pageCounts.values()].sort((a, b) => b.views - a.views).slice(0, 15),
      recent: events.slice(0, 120).map((row) => ({
        at: row.created_at, userId: String(row.user_id), name: nameOf.get(String(row.user_id))?.name ?? row.user_name, role: row.role, event: row.event,
        title: row.title ?? null, url: row.url ?? null, detail: row.detail ?? {}
      }))
    });
  } catch (error: any) {
    console.error("[store-activity]", error?.message ?? error);
    res.status(500).json({ error: error?.message ?? "Could not load store activity." });
  }
});

export default router;
