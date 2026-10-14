import test from "node:test";
import assert from "node:assert/strict";
import { itemCountLabel, nameSaysWhatItIs } from "./item-count-label.js";

test("a name that says what it is gets no extra unit word", () => {
  assert.equal(nameSaysWhatItIs("8pc Kitchen Knife Set"), true);
  assert.equal(nameSaysWhatItIs("3-In-1 Toilet Cleaning Brush SET"), true);
  assert.equal(nameSaysWhatItIs("2-in-1 Window Groove"), false, "one tool that does two jobs is not a set");
  assert.equal(nameSaysWhatItIs("Toothpaste Dispenser"), false);
  assert.equal(itemCountLabel(1, "8pc Kitchen Knife Set"), "8pc Kitchen Knife Set");
  assert.equal(itemCountLabel(2, "3-In-1 Toilet Cleaning Brush SET"), "2 × 3-In-1 Toilet Cleaning Brush SET");
});

test("the product's own unit word wins", () => {
  assert.equal(itemCountLabel(1, "Kitchen Knives", { unitSingular: "set", unitPlural: "sets" }), "1 set of Kitchen Knives");
  assert.equal(itemCountLabel(3, "Kitchen Knives", { unitSingular: "set" }), "3 sets of Kitchen Knives");
});

test("otherwise the old wording, with the package's word when given", () => {
  assert.equal(itemCountLabel(1, "Toothpaste Dispenser"), "1 pc of Toothpaste Dispenser");
  assert.equal(itemCountLabel(2, "Toothpaste Dispenser"), "2 pcs of Toothpaste Dispenser");
  assert.equal(itemCountLabel(2, "Shelf", null, { singular: "unit", plural: "units" }), "2 units of Shelf");
});
