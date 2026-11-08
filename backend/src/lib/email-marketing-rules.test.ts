import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_MS, assignVariants, automationRecipients, bestSendWindow, buildCustomers, buildPeople, cleanConditions, cleanEmail, cleanFieldValues, contextFor,
  customerTier, engagementOf, estimateFromPast, groupEngagement, kpisAt, monthEnds, nextRepeatAt, percentChange, personMatches, phoneKey, resolveAudience, segmentMatches, slugFor, withUtm,
  type CartLite, type ContactLite, type OrderLite, type SavedSegment
} from "./email-marketing-rules.js";

const NOW = Date.parse("2026-11-08T12:00:00+01:00");
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS).toISOString();
const dayKey = (n: number) => new Date(NOW - n * DAY_MS + 3_600_000).toISOString().slice(0, 10);

const order = (phone: string, status: string, amount: number, ago: number, extra: Partial<OrderLite> = {}): OrderLite => ({
  phone, email: null, status, amount, quantity: 1, productId: "p1", state: "Lagos", createdAt: daysAgo(ago + 1),
  deliveredDate: status === "Delivered" ? dayKey(ago) : null, ...extra
});

const contact = (id: string, email: string, phone: string | null, extra: Partial<ContactLite> = {}): ContactLite => ({
  id, email, name: "Ada Obi", phone, source: "order", status: "subscribed", createdAt: daysAgo(40), lastOpenedMs: null, lastClickedMs: null, lastEmailedMs: null, ...extra
});

test("a mistyped email is dropped, never an error; good ones are lower-cased", () => {
  assert.equal(cleanEmail("  Ada.Obi@Gmail.COM "), "ada.obi@gmail.com");
  assert.equal(cleanEmail("ada@gmail"), null);
  assert.equal(cleanEmail("ada gmail.com"), null);
  assert.equal(cleanEmail(""), null);
  assert.equal(cleanEmail(undefined), null);
});

test("080…, +234… and 80… are the same customer", () => {
  assert.equal(phoneKey("08031234567"), "8031234567");
  assert.equal(phoneKey("+2348031234567"), "8031234567");
  assert.equal(phoneKey("8031234567"), "8031234567");
  assert.equal(phoneKey("No phone yet"), "");
});

const orders: OrderLite[] = [
  order("08031234567", "Delivered", 20000, 100),
  order("+2348031234567", "Delivered", 30000, 10, { quantity: 1, productId: "p2", state: "Abuja" }),
  order("08099999999", "Delivered", 10000, 70),
  order("08099999999", "Cancelled", 50000, 5),
  order("08077777777", "New", 15000, 1)
];
const carts: CartLite[] = [
  { phone: "08055555555", email: "cart@x.com", productId: "p3", createdAt: daysAgo(3), converted: false },
  { phone: "08031234567", email: null, productId: "p1", createdAt: daysAgo(101), converted: true }
];

test("customers: only delivered orders are purchases; phone formats join", () => {
  const customers = buildCustomers(orders, carts);
  const ada = customers.get("8031234567")!;
  assert.equal(ada.deliveredCount, 2);
  assert.equal(ada.deliveredTotal, 50000);
  assert.equal(ada.state, "Abuja");
  assert.ok(ada.boughtProducts.has("p2"));
  assert.equal(ada.lastOpenCartMs, null); // her old cart became an order
  const bola = customers.get("8099999999")!;
  assert.equal(bola.deliveredCount, 1); // the cancelled one is not a purchase
  assert.equal(customers.get("8077777777")!.deliveredCount, 0);
  assert.ok(customers.get("8055555555")!.lastOpenCartMs); // left a cart
});

test("overview numbers as they stood on a past day", () => {
  const now = kpisAt(orders, NOW);
  assert.equal(now.buyers, 2);
  assert.equal(now.repeat, 1);
  assert.equal(now.revenue, 60000);
  assert.equal(now.ltv, 30000);
  assert.equal(now.frequency, 1.5);
  assert.equal(now.retention, 50);
  assert.equal(now.active, 2); // both had a delivery in the last 90 days
  const before = kpisAt(orders, NOW - 30 * DAY_MS);
  assert.equal(before.buyers, 2);
  assert.equal(before.repeat, 0); // her second delivery came 10 days ago
  assert.equal(percentChange(now.repeat, before.repeat), null);
  assert.equal(percentChange(12, 10), 20);
  assert.deepEqual(monthEnds(NOW, 3).map((row) => row.label), ["Sep", "Oct", "Nov"]);
});

test("conditions read in plain terms", () => {
  const customers = buildCustomers(orders, carts);
  const people = buildPeople(customers, [contact("c1", "ada@x.com", "08031234567", { lastOpenedMs: NOW - 2 * DAY_MS }), contact("c2", "new@x.com", null, { source: "manual", createdAt: daysAgo(2) })]);
  const ctx = contextFor(customers, NOW);
  const ada = people.find((p) => p.contact?.email === "ada@x.com")!;
  const stranger = people.find((p) => p.contact?.email === "new@x.com")!;
  assert.ok(personMatches(ada, { field: "purchase_count", op: "gte", value: 2 }, ctx));
  assert.ok(personMatches(ada, { field: "purchased_product", op: "is", value: "p2" }, ctx));
  assert.ok(!personMatches(ada, { field: "purchased_product", op: "is_not", value: "p2" }, ctx));
  assert.ok(personMatches(ada, { field: "last_purchase_days", op: "within", value: 30 }, ctx));
  assert.ok(!personMatches(ada, { field: "last_purchase_days", op: "over", value: 30 }, ctx));
  assert.ok(personMatches(ada, { field: "spend_top_percent", op: "top", value: 50 }, ctx));
  assert.ok(personMatches(ada, { field: "email_opened", op: "within", value: 7 }, ctx));
  assert.ok(personMatches(ada, { field: "state", op: "is", value: "abuja" }, ctx));
  assert.ok(personMatches(ada, { field: "upsell_ready", op: "is", value: "yes" }, ctx));
  // Never bought: not "inactive", and every purchase test is false.
  assert.ok(!personMatches(stranger, { field: "last_purchase_days", op: "over", value: 60 }, ctx));
  assert.ok(personMatches(stranger, { field: "purchase_count", op: "eq", value: 0 }, ctx));
  assert.ok(personMatches(stranger, { field: "joined_days", op: "within", value: 7 }, ctx));
  assert.ok(personMatches(stranger, { field: "source", op: "is", value: "manual" }, ctx));
  assert.ok(segmentMatches(ada, { match: "any", conditions: [{ field: "purchase_count", op: "gte", value: 9 }, { field: "state", op: "is", value: "Abuja" }] }, ctx));
  assert.ok(!segmentMatches(ada, { match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 9 }, { field: "state", op: "is", value: "Abuja" }] }, ctx));
  assert.deepEqual(cleanConditions([{ field: "nope", op: "x", value: 1 }, { field: "purchase_count", op: "weird", value: 3 }]), [{ field: "purchase_count", op: "gte", value: 3 }]);
});

test("audience: everyone the rules pick, but only subscribed emails receive", () => {
  const customers = buildCustomers(orders, carts);
  const people = buildPeople(customers, [
    contact("c1", "ada@x.com", "08031234567"),
    contact("c2", "bola@x.com", "08099999999", { status: "unsubscribed" })
  ]);
  const ctx = contextFor(customers, NOW);
  const all = resolveAudience(people, { source: "all" }, new Map(), ctx);
  assert.equal(all.matched.length, 2); // the two buyers; the cart-only and not-yet-delivered people have no email and no purchase
  assert.deepEqual(all.recipients.map((p) => p.contact!.email), ["ada@x.com"]);
  assert.equal(all.optedOut, 1);
  const repeat = resolveAudience(people, { source: "custom", custom: { match: "all", conditions: [{ field: "purchase_count", op: "gte", value: 2 }] } }, new Map(), ctx);
  assert.equal(repeat.recipients.length, 1);
  // Exclude people who got a delivery in the last 14 days: Ada goes.
  const excluded = resolveAudience(people, { source: "all", exclude: { on: true, boughtWithinDays: 14 } }, new Map(), ctx);
  assert.equal(excluded.recipients.length, 0);
  // A fixed (uploaded) list sends to exactly its people.
  const segments = new Map<string, SavedSegment>([["s1", { id: "s1", name: "Upload", kind: "fixed", match: "all", conditions: [], contactIds: ["c1"] }]]);
  assert.equal(resolveAudience(people, { source: "list", listId: "s1" }, segments, ctx).recipients.length, 1);
  assert.equal(resolveAudience(people, { source: "segment", segmentId: "gone" }, segments, ctx).recipients.length, 0);
});

test("A/B halves alternate down the list", () => {
  const rows = assignVariants([{ email: "d@x.com" }, { email: "a@x.com" }, { email: "c@x.com" }, { email: "b@x.com" }], true);
  assert.deepEqual(rows.map((r) => `${r.email}:${r.variant}`), ["a@x.com:a", "b@x.com:b", "c@x.com:a", "d@x.com:b"]);
  assert.ok(assignVariants([{ email: "a@x.com" }, { email: "b@x.com" }], false).every((r) => r.variant === "a"));
});

test("automations: due after the wait, only for events after switch-on, stop after a new order", () => {
  const delivery = { type: "automation" as const, automation: { trigger: "delivered" as const, delayHours: 48, exit: "purchased" as const } };
  const recent: OrderLite[] = [
    order("08011111111", "Delivered", 10000, 3), // delivered 3 days ago: due
    order("08022222222", "Delivered", 10000, 1), // 1 day ago: not yet
    order("08033333333", "Delivered", 10000, 40), // before switch-on
    order("08044444444", "Delivered", 10000, 4),
    { ...order("08044444444", "New", 10000, 0), createdAt: daysAgo(1) } // ordered again after the delivery
  ];
  const customers = buildCustomers(recent, []);
  const people = buildPeople(customers, ["08011111111", "08022222222", "08033333333", "08044444444"].map((phone, i) => contact(`c${i}`, `p${i}@x.com`, phone)));
  const started = NOW - 30 * DAY_MS;
  const due = automationRecipients(delivery, people, started, NOW, new Set());
  assert.deepEqual(due.map((p) => p.contact!.email), ["p0@x.com"]);
  assert.equal(automationRecipients(delivery, people, started, NOW, new Set(["p0@x.com"])).length, 0); // once per person
});

test("repeating campaigns: next week / next month, and stop at the end date", () => {
  const start = "2026-01-31T13:00:00.000Z";
  assert.equal(new Date(nextRepeatAt({ type: "recurring", sendAt: start, repeat: { every: "week" } }, Date.parse(start))!).toISOString(), "2026-02-07T13:00:00.000Z");
  assert.equal(new Date(nextRepeatAt({ type: "recurring", sendAt: start, repeat: { every: "month" } }, Date.parse(start))!).toISOString(), "2026-02-28T13:00:00.000Z");
  assert.equal(nextRepeatAt({ type: "recurring", sendAt: start, repeat: { every: "day", until: "2026-02-01T00:00:00.000Z" } }, Date.parse(start)), null);
  assert.equal(nextRepeatAt({ type: "one_time", sendAt: start }, Date.parse(start)), null);
});

test("links get utm tags; the app's own form keeps them inside the #/ part", () => {
  assert.equal(withUtm("https://brightpathhubs.com/the-edge-brusher-f/", { utm_source: "email", utm_campaign: "x-1" }), "https://brightpathhubs.com/the-edge-brusher-f/?utm_source=email&utm_campaign=x-1");
  assert.equal(withUtm("https://a.com/p?ref=1", { utm_content: "tok" }), "https://a.com/p?ref=1&utm_content=tok");
  assert.equal(withUtm("https://protohub-zeta.vercel.app/#/order-form/embed?product=abc", { utm_source: "email" }), "https://protohub-zeta.vercel.app/#/order-form/embed?product=abc&utm_source=email");
  assert.equal(withUtm("not a url", { utm_source: "email" }), "not a url");
  assert.match(slugFor("Upsell: Edge Brusher Max – Repeat Buyers", "AB12x"), /^upsell-edge-brusher-max-repeat-buyers-ab12x$/);
});

test("best send window comes from real order times; estimates need 3 past campaigns", () => {
  assert.equal(bestSendWindow([NOW]), null);
  const times = Array.from({ length: 30 }, (_, i) => Date.parse(`2026-11-0${(i % 7) + 1}T${i % 3 === 0 ? "08" : "19"}:30:00+01:00`));
  assert.equal(bestSendWindow(times)!.startHour, 19);
  assert.equal(estimateFromPast([{ sent: 100, opened: 40, clicked: 10, orders: 3, revenue: 0, audience: 100 }], 100, 20000), null);
  const estimate = estimateFromPast([
    { sent: 100, opened: 40, clicked: 10, orders: 2, revenue: 0, audience: 100 },
    { sent: 100, opened: 50, clicked: 12, orders: 4, revenue: 0, audience: 100 },
    { sent: 100, opened: 45, clicked: 8, orders: 3, revenue: 0, audience: 100 }
  ], 1000, 20000)!;
  assert.deepEqual([estimate.open.low, estimate.open.high], [0.4, 0.5]);
  assert.deepEqual([estimate.revenue.low, estimate.revenue.high], [400000, 800000]);
});

test("Create Segment exclusions, tags and customer status", () => {
  const customers = buildCustomers(orders, carts);
  const people = buildPeople(customers, [contact("c1", "ada@x.com", "08031234567"), contact("c2", "bola@x.com", "08099999999", { status: "unsubscribed" })]);
  const tagged = new Set(["c1"]);
  const ctx = contextFor(customers, NOW, (person, tagId) => tagId === "t-black" && !!person.contact && tagged.has(person.contact.id));
  const ada = people.find((p) => p.contact?.id === "c1")!, bola = people.find((p) => p.contact?.id === "c2")!;
  assert.ok(personMatches(ada, { field: "tag", op: "is", value: "t-black" }, ctx));
  assert.ok(personMatches(bola, { field: "tag", op: "is_not", value: "t-black" }, ctx));
  assert.ok(personMatches(bola, { field: "contact_status", op: "is", value: "unsubscribed" }, ctx));
  const rule = { match: "all" as const, conditions: [{ field: "purchase_count" as const, op: "gte", value: 1 }], exclude: [{ field: "contact_status" as const, op: "is", value: "unsubscribed" }] };
  assert.ok(segmentMatches(ada, rule, ctx));
  assert.ok(!segmentMatches(bola, rule, ctx)); // a buyer, but left out by the exclusion
  assert.equal(customerTier(ada.stats, ctx), "High Value");
});

test("engagement: high = opened in 30 days, medium = 90, low = emailed but quiet", () => {
  assert.equal(engagementOf(contact("a", "a@x.com", null, { lastOpenedMs: NOW - 5 * DAY_MS }), NOW), "high");
  assert.equal(engagementOf(contact("b", "b@x.com", null, { lastClickedMs: NOW - 60 * DAY_MS }), NOW), "medium");
  assert.equal(engagementOf(contact("c", "c@x.com", null, { lastEmailedMs: NOW - 2 * DAY_MS }), NOW), "low");
  assert.equal(engagementOf(contact("d", "d@x.com", null), NOW), "none");
  assert.equal(groupEngagement([contact("d", "d@x.com", null)], NOW), "none");
  assert.equal(groupEngagement([contact("a", "a@x.com", null, { lastOpenedMs: NOW - DAY_MS }), contact("c", "c@x.com", null, { lastEmailedMs: NOW })], NOW), "high");
});

test("custom field answers are checked against the field type", () => {
  const fields = [
    { key: "tier", type: "dropdown", options: ["Regular", "VIP"], systemKey: null },
    { key: "visits", type: "number", options: [], systemKey: null },
    { key: "colours", type: "multi", options: ["Red", "Blue"], systemKey: null },
    { key: "state", type: "dropdown", options: [], systemKey: "state" }
  ];
  assert.deepEqual(cleanFieldValues(fields, { tier: "vip", visits: "1,200", colours: "red; green; Blue", state: "Lagos", other: "x" }), { tier: "VIP", visits: "1200", colours: ["Red", "Blue"] });
  assert.deepEqual(cleanFieldValues(fields, { tier: "Gold" }), {});
});
