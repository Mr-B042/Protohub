import { describe, expect, it } from "vitest";
import { shareRepeatedPictures } from "./shared-pictures.js";

// The app's half lives in the frontend (src/lib/shared-pictures.ts); loaded at
// run time so the backend build does not compile frontend files.
const appHalf = new URL("../../../src/lib/shared-pictures.ts", import.meta.url).href;
const { restoreSharedPictures } = (await import(appHalf)) as { restoreSharedPictures: <T>(rows: T[]) => T[] };

const picture = (seed: string) => `data:image/png;base64,${seed.repeat(3000)}`;
const product = (id: string, urls: string[]) => ({
  id,
  packages: [{ id: `${id}-p`, companion_products: urls.map((imageUrl, i) => ({ productId: `${id}-${i}`, imageUrl, unitPrice: 500 })) }]
});

describe("shared add-on pictures", () => {
  const rows = [
    product("a", [picture("A"), picture("B"), "https://cdn.example.com/x.png"]),
    product("b", [picture("A"), picture("B")]),
    product("c", [picture("A"), ""]),
    { id: "d", packages: null }
  ];

  it("sends each repeated picture once", () => {
    const shared = shareRepeatedPictures(structuredClone(rows));
    const sent = JSON.stringify(shared);
    expect(sent.split(picture("A")).length - 1).toBe(1);
    expect(sent.split(picture("B")).length - 1).toBe(1);
    expect(sent.length).toBeLessThan(JSON.stringify(rows).length / 2);
  });

  it("the app gets back exactly the original list", () => {
    const back = restoreSharedPictures(JSON.parse(JSON.stringify(shareRepeatedPictures(structuredClone(rows)))));
    expect(back).toEqual(rows);
    expect(JSON.stringify(back)).not.toContain("imageRef");
  });

  it("leaves the stored list untouched", () => {
    const copy = structuredClone(rows);
    shareRepeatedPictures(copy);
    expect(copy).toEqual(rows);
  });
});
