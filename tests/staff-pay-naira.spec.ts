import { expect, test } from "@playwright/test";
import { money, payMoney, payShortMoney, paySignedMoney, paySymbol, setActiveCurrency, setMoneyHiddenGlobal } from "../src/lib/money-privacy";
import { NARROW_NBSP } from "../src/lib/naira-glyph";

const N = NARROW_NBSP;

// Bright, 18 Nov 2026: staff pay keeps its naira value in every branch.
test("in the Zambia branch, order money reads K but staff pay stays naira", () => {
  setActiveCurrency({ code: "ZMW", symbol: "K", locale: "en-ZM" });
  expect(money(1180)).toBe("K1,180");
  expect(payMoney(200)).toBe(`₦${N}200`);
  expect(paySignedMoney(-500)).toBe(`−₦${N}500`);
  expect(paySignedMoney(400)).toBe(`+₦${N}400`);
  expect(payShortMoney(45_000)).toBe(`₦${N}45K`);
  expect(paySymbol()).toBe("₦");
  setActiveCurrency({ code: "NGN", symbol: "₦", locale: "en-NG" });
});

test("staff pay is still hidden in privacy mode", () => {
  setMoneyHiddenGlobal(true);
  expect(payMoney(200)).toBe(`₦${N}••••`);
  setMoneyHiddenGlobal(false);
});
