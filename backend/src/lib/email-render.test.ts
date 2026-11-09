import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildTemplateDesign, collectLinks, newBlock, normalizeDesign, renderEmailHtml, renderEmailText, splitBadge, type CampaignFields, type EmailDesign } from "./email-render.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("the browser copy of email-render.ts is the same file", () => {
  const server = fs.readFileSync(path.join(here, "email-render.ts"), "utf8");
  const browser = fs.readFileSync(path.join(here, "..", "..", "..", "src", "lib", "email-render.ts"), "utf8");
  assert.equal(browser, server, "src/lib/email-render.ts and backend/src/lib/email-render.ts must match: copy one over the other.");
});

const fields: CampaignFields = {
  brand: "ProTools", goal: "upsell", offerType: "product", productId: "p1", productName: "Edge Brusher Max",
  productImage: "https://cdn.example.com/brush.png", productLink: "https://brightpathhubs.com/the-edge-brusher-f/", productPrice: "₦16,500 – ₦46,500",
  offerOn: true, offerTitle: "Upgrade & Save", offerBenefit: "Up to 15% OFF"
};

test("templates fill in from the setup step", () => {
  const design = buildTemplateDesign("product_promo", fields);
  const hero = design.blocks.find((block) => block.type === "hero");
  assert.ok(hero && hero.type === "hero");
  assert.equal(hero.subtitle, "Get more value with Edge Brusher Max");
  assert.deepEqual([hero.badgeTop, hero.badgeMain, hero.badgeBottom], ["Up to", "15%", "OFF"]);
  assert.equal(hero.buttonLink, fields.productLink);
  assert.deepEqual(splitBadge("₦2,000 OFF"), { top: "", main: "₦2,000", bottom: "OFF" });
  assert.equal(design.touched, false);
});

test("customer text is escaped; only web links are kept", () => {
  const design: EmailDesign = { version: 1, template: "x", touched: true, styles: buildTemplateDesign("simple_message", fields).styles, blocks: [
    { ...newBlock("text"), type: "text", text: "<script>alert(1)</script> Hi {{First Name}}" } as any,
    { ...newBlock("button"), link: "javascript:alert(1)" } as any
  ] };
  const html = renderEmailHtml(design, { firstName: "Ada Obi" });
  assert.ok(!html.includes("<script>alert(1)"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("Hi Ada"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(renderEmailHtml(design, {}).includes("Hi there"));
  assert.ok(renderEmailHtml(design, { showTags: true }).includes("{{First Name}}"));
});

test("every link goes through the click counter, in the order collectLinks lists them", () => {
  const design = buildTemplateDesign("product_promo", fields);
  design.blocks.push({ ...newBlock("social"), facebook: "https://facebook.com/pro", whatsapp: "08031234567" } as any);
  const links = collectLinks(design);
  assert.deepEqual(links.map((link) => link.url), [fields.productLink, fields.productLink, "https://facebook.com/pro", "https://wa.me/2348031234567"]);
  const seen: string[] = [];
  const html = renderEmailHtml(design, { linkFor: (url) => { seen.push(url); return `https://t.example/c/${seen.length - 1}`; }, unsubscribeUrl: "https://t.example/u", openPixelUrl: "https://t.example/o.gif" });
  assert.deepEqual(seen, links.map((link) => link.url));
  assert.ok(!html.includes(`href="${fields.productLink}"`));
  assert.ok(html.includes("https://t.example/u") && html.includes("Unsubscribe"));
  assert.ok(html.includes("https://t.example/o.gif"));
  const text = renderEmailText(design, { unsubscribeUrl: "https://t.example/u" });
  assert.ok(text.includes("Unsubscribe: https://t.example/u"));
});

test("plain mode drops pictures; the editor marks blocks", () => {
  const design = buildTemplateDesign("product_promo", fields);
  assert.ok(!renderEmailHtml(design, { plain: true }).includes("brush.png"));
  const editor = renderEmailHtml(design, { editor: true, selectedId: design.blocks[1].id });
  assert.ok(editor.includes(`data-block-id="${design.blocks[0].id}"`));
  assert.ok(editor.includes(`data-selected="1"`));
  assert.equal(normalizeDesign({ blocks: [{ id: "1", type: "bogus" }, { id: "2", type: "spacer", height: 10 }] })!.blocks.length, 1);
  assert.equal(normalizeDesign("nope"), null);
});

test("went-quiet emails show the customer's own product", async () => {
  const r = await import("./email-render.js");
  const f = { brand: "Shop", goal: "retention", offerType: "custom", productId: "p1", productName: "Sample Rack", productImage: "https://img/sample.jpg", productLink: "https://shop/sample", productPrice: "₦1,000", offerOn: false, offerTitle: "", offerBenefit: "" };
  const design = r.buildQuietDesign(f, { slug: "re-engagement", tone: "peach", title: "Still Want Your {{Their Product}}?", subtitle: "x", button: "Order Now", lines: ["Your {{Their Product}} is here."] });
  assert.equal(r.usesTheirProduct(design), true);
  const mine = { name: "Blender", price: "₦25,000", imageUrl: "https://img/blender.jpg", link: "https://shop/blender" };
  const out = r.withTheirProduct(design, mine);
  const html = r.renderEmailHtml(out, { firstName: "Ada" });
  assert.match(html, /Still Want Your Blender\?/);
  assert.match(html, /blender\.jpg/);
  assert.doesNotMatch(html, /sample\.jpg|Sample Rack|shop\/sample/);
  // A designed gift picture stays; only the button follows their product.
  const gift = r.withTheirProduct(r.buildQuietDesign(f, { slug: "win-back-campaign", tone: "lavender", title: "Hi", subtitle: "x", button: "Order", lines: [] }), mine);
  const cover = gift.blocks.find((b: any) => b.type === "cover") as any;
  assert.match(cover.imageUrl, /win-back-campaign\.jpg$/);
  assert.equal(cover.buttonLink, "https://shop/blender");
  // Not found: "your order", and no card for the wrong product.
  const none = r.withTheirProduct(design, null);
  assert.equal(none.blocks.some((b: any) => b.type === "product"), false);
  assert.match(r.renderEmailHtml(none, {}), /Your order is here\./);
  assert.equal(r.fillTheirProduct("Still want your {{Their Product}}?", mine), "Still want your Blender?");
});

test("emails Autopilot sends as they are have no [write … here] gaps; the check finds them", async () => {
  const r = await import("./email-render.js");
  const f = { brand: "Shop", goal: "retention", offerType: "custom", productId: "p", productName: "Rack", productImage: "", productLink: "https://x", productPrice: "", offerOn: false, offerTitle: "", offerBenefit: "" };
  for (const key of ["welcome_email", "product_collection", "win_back_offer", "still_interested", "review_request", "cart_reminder"]) {
    assert.deepEqual(r.unfilledGaps(r.buildStarterDesign(key, f)), [], key);
  }
  assert.deepEqual(r.unfilledGaps(r.buildStarterDesign("usage_tips", f)).length > 0, true);
  assert.deepEqual(r.unfilledGaps(null, "Hi [write the date here]"), ["[write the date here]"]);
});

test("store emails: live picks filled per customer, the promise, store links, no pay-on-delivery", async () => {
  const r = await import("./email-render.js");
  const f = { brand: "Shop", goal: "retention", offerType: "custom", productId: "p", productName: "Rack", productImage: "", productLink: "https://pod.example/rack", productPrice: "", offerOn: false, offerTitle: "", offerBenefit: "" };
  const design = r.buildStoreDesign(f, { slug: "welcome-email", tone: "lavender", title: "Shop Online, Pay Less", subtitle: "x", button: "Visit Our Store", lines: ["Hi"], picks: [{ mode: "related", count: 2, title: "Picked for you" }] });
  assert.equal(r.usesStorePicks(design), true);
  assert.deepEqual(r.unfilledGaps(design), []);
  const filled = r.withStorePicks(design, () => [{ name: "Mop Bucket", price: 6500, wasPrice: 7000, image: "https://store.example/m.jpg", url: "https://protoolshardwareventures.com.ng/products/mop" }]);
  const html = r.renderEmailHtml(filled, { brand: "Protohub" });
  assert.match(html, /Mop Bucket/); assert.match(html, /₦6,500/); assert.match(html, /line-through/);
  assert.match(html, /Full refund if your order doesn/);
  assert.doesNotMatch(html, /Pay on Delivery/);
  assert.doesNotMatch(html, /pod\.example/);
  // No products found: the block is left out, never an empty grid.
  assert.equal(r.withStorePicks(design, () => []).blocks.some((b: any) => b.type === "storePicks"), false);
  // The customer's own photo can go on the cover; the button stays on the store.
  const theirs = r.withTheirProduct({ ...design, blocks: design.blocks.map((b: any) => (b.type === "cover" ? { ...b, theirs: true } : b)) }, { name: "Rack", price: "", imageUrl: "https://img/rack.jpg", link: "https://pod.example/rack" });
  assert.equal((theirs.blocks.find((b: any) => b.type === "cover") as any).buttonLink, r.STORE_HOME);
});

test("add to your delivery: product buttons open WhatsApp and keep doing so after their product is filled in", async () => {
  const r = await import("./email-render.js");
  const f = { brand: "Shop", goal: "retention", offerType: "custom", productId: "p", productName: "Rack", productImage: "https://x/r.jpg", productLink: "https://x/order", productPrice: "₦9,000", offerOn: false, offerTitle: "", offerBenefit: "" };
  const design = r.buildAddOnDesign(f, [{ id: "a", name: "Shoe Rack", price: "₦8,000", image: "https://x/s.jpg" }]);
  const filled = r.withTheirProduct(design, { name: "Edge Brusher Max", price: "₦12,000", imageUrl: "https://x/e.jpg", link: "https://x/edge" } as any);
  const cover = filled.blocks.find((b) => b.type === "cover") as any;
  assert.ok(cover.buttonLink.startsWith("https://wa.me/2347083515972"), "cover button stays on WhatsApp");
  assert.equal(cover.imageUrl, "https://x/e.jpg", "their product photo");
  const card = filled.blocks.find((b) => b.type === "product") as any;
  assert.ok(card.link.includes(encodeURIComponent("Shoe Rack")), "the add-on card asks for that item");
  assert.ok(JSON.stringify(filled).includes("Edge Brusher Max"));
  assert.ok(!/₦0|free delivery|discount/i.test(JSON.stringify(design)), "no price or fee promises");
});

test("helpful letter: words only, numbered tips, nothing to sell", async () => {
  const r = await import("./email-render.js");
  const f = { brand: "Shop", goal: "r", offerType: "custom", productId: "p", productName: "Rack", productImage: "https://x/r.jpg", productLink: "https://x/o", productPrice: "₦1", offerOn: false, offerTitle: "", offerBenefit: "" };
  for (const version of ["store", "pod"] as const) {
    const d = r.buildLetterDesign(f, { title: "T", intro: "I", tips: ["a", "b"], close: "C" }, version);
    assert.ok(!d.blocks.some((b) => ["cover", "image", "product", "storePicks", "offer", "hero"].includes(b.type)), "no pictures, cards or offers");
    assert.ok(JSON.stringify(d).includes("1. a\\n\\n2. b"));
  }
});
