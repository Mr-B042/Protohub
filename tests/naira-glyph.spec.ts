import { expect, test } from "@playwright/test";
import { NARROW_NBSP, spaceNaira } from "../src/lib/naira-glyph";

const N = NARROW_NBSP;

test("a bare zero is separated so it cannot read as NO", () => {
  expect(spaceNaira("₦0")).toBe(`₦${N}0`);
});

test("ordinary amounts get the same treatment, for consistency", () => {
  expect(spaceNaira("₦95,000")).toBe(`₦${N}95,000`);
  expect(spaceNaira("₦1,234,567")).toBe(`₦${N}1,234,567`);
});

test("a leading minus stays outside the symbol", () => {
  expect(spaceNaira("-₦500")).toBe(`-₦${N}500`);
  expect(spaceNaira("−₦0")).toBe(`−₦${N}0`);
});

test("a masked amount is separated too", () => {
  expect(spaceNaira("₦••••")).toBe(`₦${N}••••`);
});

test("calling it twice does not widen the gap", () => {
  expect(spaceNaira(spaceNaira("₦0"))).toBe(`₦${N}0`);
});

test("an already spaced string is left alone", () => {
  expect(spaceNaira("₦ 0")).toBe("₦ 0");
  expect(spaceNaira("₦ 0")).toBe("₦ 0");
});

test("other currencies are untouched - they have no collision", () => {
  expect(spaceNaira("$0")).toBe("$0");
  expect(spaceNaira("£0")).toBe("£0");
  expect(spaceNaira("NGN 0")).toBe("NGN 0");
});

test("every naira sign in a sentence is handled, not just the first", () => {
  expect(spaceNaira("Owed ₦0 of ₦95,000")).toBe(`Owed ₦${N}0 of ₦${N}95,000`);
});

test("empty and non-string input never throws", () => {
  expect(spaceNaira("")).toBe("");
  expect(spaceNaira(null as unknown as string)).toBe("");
  expect(spaceNaira(undefined as unknown as string)).toBe("");
});

// The gap must never let an amount break across lines.
test("the separator is a no-break space, not a plain one", () => {
  expect(spaceNaira("₦0")).not.toContain(" ");
  expect(NARROW_NBSP.charCodeAt(0)).toBe(0x202f);
});
