import assert from "node:assert/strict";
import test from "node:test";

test("naira booked in kwacha at ₦65.80 = K1", async () => {
  process.env.SUPABASE_URL ??= "http://localhost"; process.env.SUPABASE_SERVICE_ROLE_KEY ??= "x";
  const { convert, DEFAULT_RATES } = await import("./currency-rates.js");
  assert.equal(DEFAULT_RATES["NGN>ZMW"].fromPerTo, 65.8);
  assert.equal(convert(65_800, { fromPerTo: 65.8 }), 1000);
  assert.equal(convert(16_488, { fromPerTo: 65.8 }), 250.58);
});
