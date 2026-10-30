import assert from "node:assert/strict";
import test from "node:test";
import { shareRepeatedPictures } from "./shared-pictures.js";

// The app's half lives in the frontend (src/lib/shared-pictures.ts); loaded at
// run time so the backend build does not compile frontend files.
const loadRestore = async () => {
  const appHalf = new URL("../../../src/lib/shared-pictures.ts", import.meta.url).href;
  return ((await import(appHalf)) as { restoreSharedPictures: <T>(rows: T[]) => T[] }).restoreSharedPictures;
};

const picture = (seed: string) => `data:image/png;base64,${seed.repeat(3000)}`;
const product = (id: string, urls: string[]) => ({
  id,
  packages: [{ id: `${id}-p`, companion_products: urls.map((imageUrl, i) => ({ productId: `${id}-${i}`, imageUrl, unitPrice: 500 })) }]
});
const rows = [
  product("a", [picture("A"), picture("B"), "https://cdn.example.com/x.png"]),
  product("b", [picture("A"), picture("B")]),
  product("c", [picture("A"), ""]),
  { id: "d", packages: null }
];

test("sends each repeated picture once", () => {
  const sent = JSON.stringify(shareRepeatedPictures(structuredClone(rows)));
  assert.equal(sent.split(picture("A")).length - 1, 1);
  assert.equal(sent.split(picture("B")).length - 1, 1);
  assert.ok(sent.length < JSON.stringify(rows).length / 2);
});

test("the app gets back exactly the original list", async () => {
  const restoreSharedPictures = await loadRestore();
  const back = restoreSharedPictures(JSON.parse(JSON.stringify(shareRepeatedPictures(structuredClone(rows)))));
  assert.deepEqual(back, rows);
  assert.ok(!JSON.stringify(back).includes("imageRef"));
});

test("leaves the stored list untouched", () => {
  const copy = structuredClone(rows);
  shareRepeatedPictures(copy);
  assert.deepEqual(copy, rows);
});
