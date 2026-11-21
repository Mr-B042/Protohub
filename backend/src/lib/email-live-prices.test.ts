import assert from "node:assert/strict";
import test from "node:test";
import { livePriceText, normalizeDesign, withLivePrices } from "./email-render.js";

const money = (n: number) => `₦${n.toLocaleString("en-NG")}`;

test("price text keeps the card's style", () => {
  assert.equal(livePriceText("₦39,500 – ₦133,500", 42500, 136500, money), "₦42,500 – ₦136,500");
  assert.equal(livePriceText("From ₦39,500", 42500, 136500, money), "From ₦42,500");
  assert.equal(livePriceText("₦39,500", 42500, 42500, money), "₦42,500");
  assert.equal(livePriceText("₦39,500", 42500, 136500, money), "From ₦42,500");
  assert.equal(livePriceText("₦39,500 – ₦133,500", 42500, 42500, money), "₦42,500");
});

test("cards get today's prices; blank, unknown and price-less products stay as they were", () => {
  const design = normalizeDesign({ blocks: [
    { id: "a", type: "product", productId: "shelf", name: "Shelf", price: "₦39,500 – ₦133,500", imageUrl: "", buttonText: "Order", link: "" },
    { id: "b", type: "product", productId: "shelf", name: "Shelf", price: "", imageUrl: "", buttonText: "Order", link: "" },
    { id: "c", type: "product", productId: "gone", name: "Old", price: "₦9,000", imageUrl: "", buttonText: "Order", link: "" },
    { id: "d", type: "product", productId: "nopr", name: "New", price: "₦5,000", imageUrl: "", buttonText: "Order", link: "" }
  ] })!;
  const out = withLivePrices(design, [{ id: "shelf", priceMin: 42500, priceMax: 136500 }, { id: "nopr", priceMin: null, priceMax: null }], money);
  assert.deepEqual(out.blocks.map((b: any) => b.price), ["₦42,500 – ₦136,500", "", "₦9,000", "₦5,000"]);
  assert.equal(withLivePrices(out, [{ id: "shelf", priceMin: 42500, priceMax: 136500 }], money), out, "nothing to change: same design back");
});
