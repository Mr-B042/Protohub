import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_KINDS, DEFAULT_AUTOMATIONS, buildKeyboard, cleanCommandSettings, cleanRecipients, cleanSettings, kindForwarded,
  orderDraft, previewOf, recipientLabel, repTodayDraft, reportDraft, successRate, triggerLabel, type OrderInfo,
  cartDraft, forwardCheck, forwardDedupeKey, isQuietTime, lateTodayDraft, lagosClock, repWeekNoteDraft, roleMayReceive
} from "./telegram-rules.js";

const order: OrderInfo = {
  id: "5938", customer: "Bola <Igonor>", phone: "08023255639", productName: "5-in-1 Corner Racks", packageName: "Lite Pack",
  quantity: 1, amount: 39_500, city: "Ibadan", state: "Oyo", status: "New", repName: "Delight", callOutcome: null
};

test("the five automations from the design are there, and more", () => {
  const names = DEFAULT_AUTOMATIONS.map((row) => row.name);
  for (const name of ["New Order Alert", "Follow-up Reminder", "Failed Delivery Alert", "Low Stock Alert", "Daily Sales Report"]) assert.ok(names.includes(name), name);
  const lowStock = DEFAULT_AUTOMATIONS.find((row) => row.trigger === "low_stock")!;
  assert.equal(triggerLabel("low_stock", lowStock.settings), "Stock ≤ 5");
  assert.equal(recipientLabel(lowStock.recipients), "Inventory, Logistics");
  assert.equal(recipientLabel(DEFAULT_AUTOMATIONS[0].recipients), "Assigned Rep");
});

test("a sales rep sees the customer and amount; logistics never does", () => {
  const rep = orderDraft("order_new", order, "Sales Rep");
  assert.match(rep.text, /NEW ORDER RECEIVED/);
  assert.match(rep.text, /Amount: ₦39,500/);
  assert.match(rep.text, /Bola &lt;Igonor&gt;/); // escaped for Telegram HTML
  assert.deepEqual(rep.keyboard[0].map((b) => b.text), ["📞 Call Customer", "👁 View Order"]);
  const logistics = orderDraft("order_failed", order, "Inventory Manager & Logistics Operations");
  assert.doesNotMatch(logistics.text, /39,500|Bola|0802/);
  assert.deepEqual(logistics.keyboard[0].map((b) => b.text), ["👁 View Order"]);
});

test("buttons: app paths become # links; nothing invalid is sent", () => {
  const keyboard = buildKeyboard([[{ text: "View", path: "/dashboard/admin/orders/1" }, { text: "Call", callback: "call:1" }]], "https://app.example.com/");
  assert.deepEqual(keyboard, [[{ text: "View", url: "https://app.example.com/#/dashboard/admin/orders/1" }, { text: "Call", callback_data: "call:1" }]]);
  // No public app address: the link button is dropped, the call button stays.
  assert.deepEqual(buildKeyboard([[{ text: "View", path: "/x" }, { text: "Call", callback: "call:1" }]], null), [[{ text: "Call", callback_data: "call:1" }]]);
});

test("revenue: Owner, Admin and Manager only; ad spend: Owner and Admin (6 Nov 2026)", () => {
  const report = { label: "Thu 5 Nov", ordersIn: 17, topProducts: [{ name: "5-in-1 Corner Racks", orders: 12 }], delivered: 2, deliveredRevenue: 56_000, failed: 1, cancelled: 0, stillNew: 3, lateSendOuts: 2, adSpend: 45_000 };
  assert.match(reportDraft("daily_report", report, "Owner").text, /₦56,000[\s\S]*Ad spend: ₦45,000 · ₦2,647 per order/);
  const manager = reportDraft("daily_report", report, "Manager").text;
  assert.match(manager, /Delivered: <b>2<\/b> · ₦56,000/);
  assert.doesNotMatch(manager, /Ad spend/);
  assert.doesNotMatch(reportDraft("daily_report", report, "Sales Rep").text, /₦/);
});

test("a sales rep's /today: their own day and bonus, no revenue", () => {
  const text = repTodayDraft({ label: "Fri 6 Nov", ordersIn: 5, sentOut: 4, sentLate: 1, delivered: 2, stillNew: 1, lateNow: 1, bonus: { earned: 3_200, deliveredCount: 8 } });
  assert.match(text, /Orders given to you today: <b>5<\/b>/);
  assert.match(text, /Sent out of New: 4 \(1 late\)/);
  assert.match(text, /Your bonus this week: <b>₦3,200<\/b> \(from 8 delivered orders\)/);
  assert.equal((text.match(/₦/g) ?? []).length, 1); // the bonus is the only money
  assert.match(repTodayDraft({ label: "x", ordersIn: 0, sentOut: 0, sentLate: 0, delivered: 0, stillNew: 0, lateNow: 0, bonus: null }), /open Bonuses in Protohub/);
});

test("recipients and settings are cleaned", () => {
  assert.deepEqual(cleanRecipients("low_stock", { roles: ["Owner", "Hacker"], assignedRep: true, userIds: ["x"] }), { roles: ["Owner"], assignedRep: false, userIds: [] });
  assert.deepEqual(cleanSettings("send_out_soon", { minutesBefore: 99 }), { minutesBefore: 14 });
  assert.deepEqual(cleanSettings("daily_report", {}), { hour: 9 });
  assert.deepEqual(cleanSettings("order_new", { threshold: 3 }), {});
});

test("phone alerts: automation kinds are never forwarded twice", () => {
  const on = new Set(["ads", "other"]);
  assert.equal(kindForwarded("campaign_no_orders", on), true);
  assert.equal(kindForwarded("weekly_report_question", on), true); // "everything else"
  assert.equal(kindForwarded("order_late_send", on), false);       // its group is off
  for (const kind of AUTOMATION_KINDS) assert.equal(kindForwarded(kind, new Set(["orders", "other"])), false, kind);
});

test("commands: help and stop can never be switched off", () => {
  const settings = cleanCommandSettings({ help: false, stop: false, today: false });
  assert.equal(settings.help, true);
  assert.equal(settings.stop, true);
  assert.equal(settings.today, false);
  assert.equal(settings.myorders, true);
});

test("numbers", () => {
  assert.equal(successRate(0, 0), null);
  assert.equal(successRate(246, 2), 99.2);
  assert.equal(previewOf("✅ <b>Hi &amp; bye</b>\nline"), "✅ Hi & bye line");
});

test("gaps fixed (6 Nov 2026): reassigned orders and carts reach the rep out of the box", () => {
  const triggers = DEFAULT_AUTOMATIONS.map((row) => row.trigger);
  for (const trigger of ["order_assigned", "cart_assigned", "weekly_rep_note"]) assert.ok(triggers.includes(trigger as any), trigger);
  assert.equal(DEFAULT_AUTOMATIONS.find((row) => row.trigger === "cart_assigned")!.recipients.assignedRep, true);
});

test("reports are leadership only, whatever is saved", () => {
  assert.deepEqual(cleanRecipients("daily_report", { roles: ["Owner", "Sales Rep", "Manager", "Inventory Manager"] }).roles, ["Owner", "Manager"]);
  assert.deepEqual(cleanRecipients("weekly_rep_note", { roles: ["Owner", "Sales Rep"] }).roles, ["Sales Rep"]);
  assert.equal(roleMayReceive("weekly_report", "Sales Rep"), false);
  assert.equal(roleMayReceive("order_new", "Manager"), true);
  assert.equal(roleMayReceive("order_new", "Sales Rep"), false); // only as the order's own rep
});

test("a forwarded order alert and the matching automation share one key (no double message)", () => {
  // Automation: `${trigger}:${orderId}:${status}:${day}` (telegramOrderEvent); phone alert tag: order-<id>-<status>.
  assert.equal(forwardDedupeKey("order_delivered", "order-PH-18401-Delivered", "2026-11-06"), "order_delivered:PH-18401:Delivered:2026-11-06");
  assert.equal(forwardDedupeKey("campaign_no_orders", "camp-1", "2026-11-06"), "app_alert:camp-1");
  assert.equal(forwardDedupeKey("weekly_report_question", undefined, "2026-11-06"), null);
});

test("abandoned cart phone alerts use their real kind names", () => {
  assert.equal(kindForwarded("abandoned_cart_new", new Set(["carts"])), true);
  assert.equal(kindForwarded("abandoned_cart_assigned", new Set(["carts", "other"])), false); // an automation now
  assert.equal(kindForwarded("telegram_notice", new Set(["other"])), false);
});

test("held orders are marked; carts keep customer details from inventory staff", () => {
  assert.match(orderDraft("order_new", { ...order, held: true }, "Owner").text, /Held for review/);
  assert.doesNotMatch(orderDraft("order_new", order, "Owner").text, /Held for review/);
  const cart = { id: "C1", customer: "Ngozi", productName: "Edge Brusher Max", packageName: null, amount: 18_000, city: "Wuse", state: "FCT Abuja", repName: "Ada Rep" };
  assert.match(cartDraft(cart, "Sales Rep").text, /CART GIVEN TO YOU[\s\S]*₦18,000[\s\S]*Ngozi/);
  const inv = cartDraft(cart, "Inventory Manager");
  assert.doesNotMatch(inv.text, /Ngozi|18,000/);
  assert.deepEqual(inv.keyboard[0].map((b) => b.text), ["👁 View Cart"]);
});

test("quiet hours: 9pm to 7am Lagos by default", () => {
  const quiet = { on: true, from: 21, to: 7 };
  assert.equal(isQuietTime(Date.parse("2026-11-06T22:30:00+01:00"), quiet), true);
  assert.equal(isQuietTime(Date.parse("2026-11-07T06:59:00+01:00"), quiet), true);
  assert.equal(isQuietTime(Date.parse("2026-11-07T07:00:00+01:00"), quiet), false);
  assert.equal(isQuietTime(Date.parse("2026-11-06T13:00:00+01:00"), quiet), false);
  assert.equal(isQuietTime(Date.parse("2026-11-06T22:30:00+01:00"), { ...quiet, on: false }), false);
});

test("the weekly late & fines note", () => {
  assert.match(repWeekNoteDraft({ label: "Sun 1 Nov – Sat 7 Nov", lateSendOuts: 0, lateExamples: [], fines: [] }).text, /No late send-outs and no fines/);
  const text = repWeekNoteDraft({ label: "x", lateSendOuts: 2, lateExamples: [{ orderId: "5937", minutesLate: 12 }], fines: [{ amount: 500, reason: "Late send" }, { amount: 1000, reason: "Missed log" }] }).text;
  assert.match(text, /sent out late \(past 15 min\): <b>2<\/b>/);
  assert.match(text, /Fines: <b>2<\/b> · ₦1,500/);
  assert.match(text, /appeal it in Protohub/);
});

test("a recovery rep's /today has no bonus line", () => {
  assert.doesNotMatch(repTodayDraft({ label: "x", ordersIn: 1, sentOut: 0, sentLate: 0, delivered: 0, stillNew: 1, lateNow: 0 }), /bonus/i);
});

test("a sales rep only ever gets their own orders (6 Nov 2026)", () => {
  // Reps cannot be picked by role on order automations: only as the order's own rep.
  assert.deepEqual(cleanRecipients("order_delivered", { roles: ["Sales Rep", "Manager", "Recovery Rep", "Sales Closer"], assignedRep: true }), { roles: ["Manager"], assignedRep: true, userIds: [] });
  assert.equal(roleMayReceive("low_stock", "Sales Rep"), false);
  assert.equal(roleMayReceive("weekly_rep_note", "Sales Rep"), true);
  // Copied phone alerts: about one of their orders (checked), or about themselves.
  assert.deepEqual(forwardCheck("Sales Rep", "order_delivered", "order-PH-1-Delivered"), { allowed: true, ownOrderId: "PH-1" });
  assert.deepEqual(forwardCheck("Sales Rep", "order_late_send", "late-send-5937"), { allowed: true, ownOrderId: "5937" });
  assert.deepEqual(forwardCheck("Sales Rep", "campaign_no_orders", "camp-1"), { allowed: false });
  assert.deepEqual(forwardCheck("Sales Rep", "abandoned_cart_new", "abandoned-cart-9"), { allowed: false });
  assert.deepEqual(forwardCheck("Sales Rep", "order_confirmed", undefined), { allowed: false });
  assert.deepEqual(forwardCheck("Sales Rep", "weekly_report_question", "wr-1"), { allowed: true });
  assert.deepEqual(forwardCheck("Owner", "campaign_no_orders", "camp-1"), { allowed: true });
});

test("no role gets company information it should not have (6 Nov 2026)", () => {
  // Sales alerts: leadership only; delivery and stock: leadership + inventory/logistics; Marketer: never.
  assert.deepEqual(cleanRecipients("order_new", { roles: ["Owner", "Manager", "Inventory Manager & Logistics Operations", "Marketer"] }).roles, ["Owner", "Manager"]);
  assert.deepEqual(cleanRecipients("order_failed", { roles: ["Inventory Manager & Logistics Operations", "Marketer"] }).roles, ["Inventory Manager & Logistics Operations"]);
  assert.deepEqual(cleanRecipients("low_stock", { roles: ["Inventory Manager", "Marketer", "Admin"] }).roles, ["Inventory Manager", "Admin"]);
  assert.equal(roleMayReceive("cart_assigned", "Inventory Manager & Logistics Operations"), false);
  assert.equal(roleMayReceive("follow_up_due", "Marketer"), false);
  // Copied phone alerts: customer/amount alerts never to logistics; ad spend only to Owner/Admin.
  assert.deepEqual(forwardCheck("Inventory Manager & Logistics Operations", "order_failed", "order-1-Failed"), { allowed: false });
  assert.deepEqual(forwardCheck("Marketer", "abandoned_cart_new", "abandoned-cart-1"), { allowed: false });
  assert.deepEqual(forwardCheck("Manager", "campaign_no_orders", "camp-1"), { allowed: false });
  assert.deepEqual(forwardCheck("Admin", "campaign_no_orders", "camp-1"), { allowed: true });
  assert.deepEqual(forwardCheck("Inventory Manager & Logistics Operations", "agent_stock_drift", "drift-1"), { allowed: true });
  // What logistics does get about a failed delivery: no customer, no amount, no reason note.
  const text = orderDraft("order_failed", { ...order, callOutcome: "Customer said call 0803 123 4567" }, "Inventory Manager & Logistics Operations").text;
  assert.doesNotMatch(text, /Bola|39,500|0802|0803|Reason/);
});

test("every order status has a ready-made automation, each trigger once", () => {
  const triggers = DEFAULT_AUTOMATIONS.map((row) => row.trigger);
  for (const trigger of ["order_new", "order_assigned", "order_confirmed", "order_delivered", "order_failed", "order_cancelled", "order_rescheduled", "cart_assigned"]) assert.ok(triggers.includes(trigger as any), trigger);
  assert.equal(new Set(triggers).size, triggers.length);
  // Ready-made recipients are allowed ones (none would be stripped on save).
  for (const row of DEFAULT_AUTOMATIONS) assert.deepEqual(cleanRecipients(row.trigger, row.recipients).roles, row.recipients.roles, row.trigger);
});

test("/late shows today's late send-outs, not only what is still New (#5932, 6 Nov 2026)", () => {
  const at = (hm: string) => Date.parse(`2026-11-06T${hm}:00+01:00`);
  assert.equal(lagosClock(at("10:56")), "10:56am");
  const text = lateTodayDraft({
    label: "Fri 6 Nov", nowMs: at("19:00"),
    sentLate: [{ orderId: "5932", product: "Edge Brusher Max", repName: "Esther", limitMs: at("10:56"), sentMs: at("11:03"), took: 23 }],
    stillNew: []
  });
  assert.match(text, /Sent out after the 15 minutes: <b>1<\/b>/);
  assert.match(text, /#5932 Edge Brusher Max \(Esther\) – took 23 min · limit 10:56am, sent out 11:03am/);
  assert.match(text, /Nothing is sitting in New past the limit right now/);
  const waiting = lateTodayDraft({ label: "x", nowMs: at("19:00"), sentLate: [], stillNew: [{ orderId: "5950", product: "Rack", repName: null, limitMs: at("14:15"), waited: 31 }, { orderId: "5900", product: "Shelf", repName: null, limitMs: Date.parse("2026-11-05T11:04:00+01:00"), waited: 400 }] });
  assert.match(waiting, /#5900 Shelf – waiting 400 min · limit was Thu 5 Nov 11:04am/);
  assert.match(waiting, /Sent out after the 15 minutes: <b>0<\/b>/);
  assert.match(waiting, /Still New, past the limit right now: <b>2<\/b>[\s\S]*#5950 Rack – waiting 31 min · limit was 2:15pm/);
});
