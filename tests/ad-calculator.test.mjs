import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/ad-calculator.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { adCalc } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const base = { price: 39_500, productCost: 12_000, deliveryCost: 4_000, commission: 0, otherCost: 0, failedCost: 0 };

test("framework example: cheap clicks, poor delivery costs more per delivery", () => {
  const a = adCalc({ ...base, cpp: 6_000, deliveryRate: 40 });
  const b = adCalc({ ...base, cpp: 7_500, deliveryRate: 87.5 });
  assert.equal(a.adCostPerDelivery, 15_000);
  assert.equal(Math.round(b.adCostPerDelivery), 8_571);
  assert.ok(b.profitPerDelivered > a.profitPerDelivered);
});

test("break-even = rate × left per delivery − failed share", () => {
  const r = adCalc({ ...base, failedCost: 2_000, cpp: 10_000, deliveryRate: 60 });
  assert.equal(r.leftPerDelivery, 23_500);
  assert.equal(r.breakEvenCpp, 0.6 * 23_500 - 0.4 * 2_000);
  // At exactly break-even CPP the profit is zero.
  const even = adCalc({ ...base, failedCost: 2_000, cpp: r.breakEvenCpp, deliveryRate: 60 });
  assert.ok(Math.abs(even.profitPerDelivered) < 1e-9);
});

test("status steps match Campaign decisions", () => {
  const be = adCalc({ ...base, cpp: 0, deliveryRate: 50 }).breakEvenCpp; // 11,750
  assert.equal(adCalc({ ...base, cpp: be * 0.7, deliveryRate: 50 }).status, "scale");
  assert.equal(adCalc({ ...base, cpp: be * 0.8, deliveryRate: 50 }).status, "keep");
  assert.equal(adCalc({ ...base, cpp: be * 0.9, deliveryRate: 50 }).status, "watch");
  assert.equal(adCalc({ ...base, cpp: be * 1.01, deliveryRate: 50 }).status, "turn_off");
  assert.equal(adCalc({ ...base, productCost: 40_000, cpp: 1, deliveryRate: 50 }).status, "no_profit");
});

test("0% delivery has no per-delivery numbers", () => {
  const r = adCalc({ ...base, cpp: 5_000, deliveryRate: 0 });
  assert.equal(r.adCostPerDelivery, null);
  assert.equal(r.profitPerDelivered, null);
  assert.equal(r.status, "no_profit");
});
