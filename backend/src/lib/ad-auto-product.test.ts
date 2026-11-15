import assert from "node:assert/strict";
import test from "node:test";
import { autoProducts, pageKey, pageProducts, productByName } from "./ad-auto-product.js";

const products = [
  { id: "rack", name: "5-in-1 Corner Racks" }, { id: "shelf", name: "Multi Corner Storage Shelf" },
  { id: "eb", name: "Edge Brusher" }, { id: "ebm", name: "Edge Brusher Max" }, { id: "tp", name: "Toothpaste Dispenser" }
];

test("page keys", () => {
  assert.equal(pageKey("https://www.BrightPathHubs.com/shelf/?utm_source=fb"), "brightpathhubs.com/shelf");
  assert.equal(pageKey("https://protohub-zeta.vercel.app/#/order-form/embed?product=551f40ae-33a6-49d5-a9ad-f030ece24a7b&x=1"), "product:551f40ae-33a6-49d5-a9ad-f030ece24a7b");
  assert.equal(pageKey("https://wa.me/2348000000000"), null);
  assert.equal(pageKey("https://www.facebook.com/page"), null);
  assert.equal(pageKey("not a url"), null);
});

test("a page sells one product when 90%+ of its orders do", () => {
  const m = pageProducts([...Array(9).fill({ page: "a.com/shelf", productId: "shelf" }), { page: "a.com/shelf", productId: "tp" }, ...Array(5).fill({ page: "a.com/mix", productId: "eb" }), ...Array(5).fill({ page: "a.com/mix", productId: "ebm" }), { page: "a.com/one", productId: "rack" }]);
  assert.equal(m.get("a.com/shelf"), "shelf");
  assert.equal(m.has("a.com/mix"), false);
  assert.equal(m.has("a.com/one"), false); // fewer than 3 orders
});

test("names: exact product only, ties refused", () => {
  assert.equal(productByName("5 5-in-1 Corner Rack Sales campaign", products), "rack");
  assert.equal(productByName("Manually 5-in-1 Corner Sales campaign", products), "rack");
  assert.equal(productByName("Corner campaign", products), null);
  assert.equal(productByName("Multi Corner Shelf 2026", products), "shelf");
  assert.equal(productByName("Edge Brusher Max Oct", products), "ebm");
  assert.equal(productByName("Edge Brusher Oct", products), "eb");
  assert.equal(productByName("Lagos women 25-45", products), null);
});

test("most certain first: ad link, then the campaign's other ads, then the name", () => {
  const ads = [
    { adId: "a1", campaignId: "c1", campaignName: "Promo Nov", adsetName: "", adName: "" },
    { adId: "a2", campaignId: "c1", campaignName: "Promo Nov", adsetName: "", adName: "" },
    { adId: "a3", campaignId: "c2", campaignName: "Toothpaste Dispenser Nov", adsetName: "", adName: "" },
    { adId: "a4", campaignId: "c3", campaignName: "Mixed", adsetName: "", adName: "" },
    { adId: "a5", campaignId: "c3", campaignName: "Mixed", adsetName: "", adName: "" },
    { adId: "a6", campaignId: "c3", campaignName: "Mixed", adsetName: "", adName: "Edge Brusher Max reel" }
  ];
  const out = autoProducts({
    ads, linkEvidence: new Map([["a4", "eb"], ["a5", "shelf"]]),
    adPage: new Map([["a1", "brightpathhubs.com/shelf"]]), pageProduct: new Map([["brightpathhubs.com/shelf", "shelf"]]), products
  });
  assert.deepEqual(out.get("a1"), { productId: "shelf", source: "ad_link" });
  assert.deepEqual(out.get("a2"), { productId: "shelf", source: "siblings" });
  assert.deepEqual(out.get("a3"), { productId: "tp", source: "name" });
  assert.equal(out.has("a4"), false); // already known from orders
  assert.equal(out.has("a6"), false); // its campaign sells two products: no guessing by name
});
