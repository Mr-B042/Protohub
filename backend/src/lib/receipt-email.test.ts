import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { confirmationHtml, receiptInput, thankYouHtml } from "./receipt-email.js";
import { buildReceipt } from "./receipt-model.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("receipt-model.ts: the app and the server copies are the same", () => {
  const server = fs.readFileSync(path.join(here, "receipt-model.ts"), "utf8");
  const app = fs.readFileSync(path.join(here, "../../../src/components/order-receipt/receipt-model.ts"), "utf8");
  assert.equal(server, app);
});

const row = {
  id: "5973", customer: "Ada Obi", phone: "08012345678", address: "20 Test Road", city: "Agbor", state: "Delta", product_id: "p1", product_name: "5-in-1 Corner Racks",
  package_name: "Lite Pack", amount: 39500, currency: "NGN", status: "Confirmed", created_at: "2026-11-09T00:01:00Z",
  cross_sell_lines: [], additional_lines: null,
  package_components_snapshot: [{ productId: "g1", productName: "Adhesive Hook", quantity: 10, isFreeGift: true, hiddenFromCustomer: false }, { productId: "g2", productName: "Hidden", quantity: 1, isFreeGift: true, hiddenFromCustomer: true }]
};
const brand = { name: "Protohub", logoUrl: "https://cdn.example/logo.png", tagline: "", helpPhone: "08000000000" };

test("e-receipts carry the order's own figures, brand and photos", () => {
  const model = buildReceipt(receiptInput(row));
  const imageOf = (id?: string) => (id === "p1" ? "https://cdn.example/rack.jpg" : id === "g1" ? "https://cdn.example/hook.jpg" : null);
  const confirm = confirmationHtml(model, brand, imageOf);
  assert.match(confirm, /ORDER CONFIRMATION/);
  assert.match(confirm, /PH-091126-5973/);
  assert.match(confirm, /₦39,500/);
  assert.match(confirm, /Adhesive Hook x10/);
  assert.doesNotMatch(confirm, /Hidden/);
  assert.match(confirm, /logo\.png/);
  assert.match(confirm, /wa\.me\/2348000000000/);
  const thanks = thankYouHtml({ ...model, paid: true }, brand, imageOf, "https://app/#/review/tok");
  assert.match(thanks, /Thank You<br>for Your Order!/);
  assert.match(thanks, /hook\.jpg/);
  assert.match(thanks, /PAID ON/);
  assert.match(thanks, /#\/review\/tok/);
});
