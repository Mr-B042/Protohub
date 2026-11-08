import assert from "node:assert/strict";
import test from "node:test";
import { cleanEmail } from "./email-clean.js";

test("a mistyped email is dropped, never an error; good ones are lower-cased", () => {
  assert.equal(cleanEmail("  Ada.Obi@Gmail.COM "), "ada.obi@gmail.com");
  assert.equal(cleanEmail("ada@gmail"), null);
  assert.equal(cleanEmail("ada gmail.com"), null);
  assert.equal(cleanEmail("ada@@gmail.com"), null);
  assert.equal(cleanEmail(""), null);
  assert.equal(cleanEmail(undefined), null);
  assert.equal(cleanEmail(`${"a".repeat(250)}@x.com`), null);
});
