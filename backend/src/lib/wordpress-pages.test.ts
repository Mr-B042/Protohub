import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, looksLikeThankYou, sortPages } from "./wordpress-pages.js";

test("titles lose their HTML entities", () => {
  assert.equal(decodeEntities("Shelf &#8211; Order Now"), "Shelf – Order Now");
  assert.equal(decodeEntities("Tom &amp; Jerry&#8217;s"), "Tom & Jerry’s");
});

test("thank-you pages are spotted by title or slug", () => {
  assert.equal(looksLikeThankYou("Order Success", "order-success"), true);
  assert.equal(looksLikeThankYou("Done", "order-received"), true);
  assert.equal(looksLikeThankYou("Shelf", "shelf"), false);
});

test("landing lists thank-you pages last, thank-you lists them first", () => {
  const rows = [{ title: "Thank You", is_thank_you: true }, { title: "Shelf", is_thank_you: false }, { title: "Brusher", is_thank_you: false }];
  assert.deepEqual(sortPages(rows, "landing").map((row) => row.title), ["Brusher", "Shelf", "Thank You"]);
  assert.deepEqual(sortPages(rows, "thank_you").map((row) => row.title), ["Thank You", "Brusher", "Shelf"]);
});
