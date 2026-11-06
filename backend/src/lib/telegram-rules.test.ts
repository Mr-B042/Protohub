import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATION_KINDS, DEFAULT_AUTOMATIONS, buildKeyboard, cleanCommandSettings, cleanRecipients, cleanSettings, kindForwarded,
  orderDraft, previewOf, recipientLabel, repTodayDraft, reportDraft, successRate, triggerLabel, type OrderInfo
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
