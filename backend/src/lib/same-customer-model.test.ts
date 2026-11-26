import { test } from "node:test";
import assert from "node:assert/strict";
import { phone10, repMessage, situationKey, splitCustomers, supervisorMessage, type CustomerRecord } from "./same-customer-model.js";

const rec = (kind: "order" | "cart", id: string, phone: string, repId: string, repName: string, product: string, at: string, customer = "Ada Customer"): CustomerRecord =>
  ({ kind, id, phone10: phone10(phone), repId, repName, customer, product, createdAt: at });

test("26 Nov: #6411 Chelsea and #6412 Esther, same phone in two formats -> one split customer", () => {
  const out = splitCustomers([
    rec("order", "6411", "08099990001", "c", "Chelsea", "Multi Corner Storage Shelf", "2026-11-26T00:25:00Z", "A Customer"),
    rec("order", "6412", "+2348099990001", "e", "Esther", "5-in-1 Corner Racks", "2026-11-26T00:32:00Z"),
    rec("order", "6500", "08011112222", "c", "Chelsea", "X", "2026-11-26T01:00:00Z")
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].customer, "A Customer");
  const toEsther = repMessage(out[0], "e");
  assert.match(toEsther.title, /also with Chelsea/);
  assert.match(toEsther.message, /order #6412 \(5-in-1 Corner Racks\) with you, and order #6411 \(Multi Corner Storage Shelf\) with Chelsea\. Agree with Chelsea who calls them/);
  assert.match(supervisorMessage(out[0]).message, /#6411 Chelsea \(Multi Corner Storage Shelf\) · #6412 Esther \(5-in-1 Corner Racks\)\. Decide who handles/);
});

test("an open cart with another rep counts too; same rep twice does not", () => {
  const cart = splitCustomers([rec("order", "1", "08030000001", "a", "Ada", "Shelf", "2026-11-25T09:00:00Z"), rec("cart", "CART-X", "08030000001", "b", "Bisi", "Racks", "2026-11-25T10:00:00Z")]);
  assert.match(repMessage(cart[0], "b").message, /an abandoned cart \(Racks\) with you, and order #1 \(Shelf\) with Ada/);
  assert.equal(splitCustomers([rec("order", "1", "08030000001", "a", "Ada", "S", "t1"), rec("order", "2", "08030000001", "a", "Ada", "R", "t2")]).length, 0);
});

test("a short or missing phone never matches, and a new record makes a new situation", () => {
  assert.equal(phone10("12345"), "");
  assert.equal(splitCustomers([rec("order", "1", "123", "a", "Ada", "S", "t1"), rec("order", "2", "123", "b", "Bisi", "R", "t2")]).length, 0);
  const two = splitCustomers([rec("order", "1", "08030000001", "a", "Ada", "S", "t1"), rec("order", "2", "08030000001", "b", "Bisi", "R", "t2")])[0];
  const three = splitCustomers([rec("order", "1", "08030000001", "a", "Ada", "S", "t1"), rec("order", "2", "08030000001", "b", "Bisi", "R", "t2"), rec("cart", "C", "08030000001", "b", "Bisi", "Q", "t3")])[0];
  assert.notEqual(situationKey(two), situationKey(three));
});
