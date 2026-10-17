import test from "node:test";
import assert from "node:assert/strict";
import { frameBlockReason, landingPagesFromLinks } from "./landing-pages.js";

const link = (over: Record<string, unknown>) => ({ product_id: "p1", landing_page_url: "https://brightpathhubs.com/shelf/", label: "Shelf Corner", active: true, ...over }) as any;

test("one page per product, however many links point at it", () => {
  const pages = landingPagesFromLinks([
    link({}),
    link({ landing_page_url: "https://www.brightpathhubs.com/shelf", label: "Shelf ad set 2" }),
    link({ product_id: "p2" })
  ]);
  assert.deepEqual(pages.map((page) => [page.productId, page.label]), [["p1", "Shelf Corner"], ["p2", "Shelf Corner"]]);
});

test("paused links, links without a product, thank-you pages and junk are left out", () => {
  const pages = landingPagesFromLinks([
    link({ active: false }),
    link({ product_id: null }),
    link({ landing_page_url: "https://brightpathhubs.com/thank-you-shelf/" }),
    link({ landing_page_url: "not a page" }),
    link({ landing_page_url: "javascript:alert(1)" }),
    link({ landing_page_url: "" })
  ]);
  assert.deepEqual(pages, []);
});

test("a link with no name shows the page's path", () => {
  assert.equal(landingPagesFromLinks([link({ label: "  " })])[0].label, "/shelf/");
});

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name.toLowerCase()] ?? null });
const APP = "https://protohub-zeta.vercel.app";

test("a site that sends no framing rules can be shown", () => {
  assert.equal(frameBlockReason(headers({}), APP), null);
  assert.equal(frameBlockReason(headers({ "content-security-policy": "default-src 'self'" }), APP), null);
});

test("X-Frame-Options DENY or SAMEORIGIN blocks it", () => {
  assert.ok(frameBlockReason(headers({ "x-frame-options": "DENY" }), APP));
  assert.ok(frameBlockReason(headers({ "x-frame-options": "SAMEORIGIN" }), APP));
});

test("frame-ancestors allows only the sources it names", () => {
  assert.ok(frameBlockReason(headers({ "content-security-policy": "frame-ancestors 'self'" }), APP));
  assert.equal(frameBlockReason(headers({ "content-security-policy": "frame-ancestors 'self' https://protohub-zeta.vercel.app" }), APP), null);
  assert.equal(frameBlockReason(headers({ "content-security-policy": "frame-ancestors *.vercel.app" }), APP), null);
  assert.equal(frameBlockReason(headers({ "content-security-policy": "frame-ancestors *" }), APP), null);
});
