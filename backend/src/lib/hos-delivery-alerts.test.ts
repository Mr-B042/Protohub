import test from "node:test";
import assert from "node:assert/strict";
import { sortRepsByRate, type RepDeliveryLine } from "./hos-delivery-alerts.js";

const line = (name: string, counted: number, delivered: number): RepDeliveryLine => ({
  repId: name, name, counted, delivered, rate: Math.round((delivered / counted) * 100), notDelivered: counted - delivered
});

test("under 60% is urgent, 60 to under 65% is a warning, 65%+ is left alone", () => {
  const { urgent, warning } = sortRepsByRate([line("A", 20, 10), line("B", 20, 12), line("C", 20, 13), line("D", 20, 15)]);
  assert.deepEqual(urgent.map((row) => row.name), ["A"]); // 50%
  assert.deepEqual(warning.map((row) => row.name), ["B"]); // 60%; C is 65%
});

test("a rep with fewer than 10 counted orders is not judged yet", () => {
  const { urgent, warning } = sortRepsByRate([line("New", 6, 1)]);
  assert.equal(urgent.length + warning.length, 0);
});
