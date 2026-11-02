import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyOrderState } from "./order-state.js";

test("order states are saved one way", () => {
  assert.equal(tidyOrderState("lagos"), "Lagos");
  assert.equal(tidyOrderState("JIGAWA"), "Jigawa");
  assert.equal(tidyOrderState("OSun"), "Osun");
  assert.equal(tidyOrderState(" Rivers state "), "Rivers");
  assert.equal(tidyOrderState("Delta state"), "Delta");
  assert.equal(tidyOrderState("FCt"), "FCT Abuja");
  assert.equal(tidyOrderState("Abuja"), "FCT Abuja");
  assert.equal(tidyOrderState("Cross rivers"), "Cross River");
  assert.equal(tidyOrderState("Cross river"), "Cross River");
  assert.equal(tidyOrderState("Ibadan"), "Oyo");
  assert.equal(tidyOrderState("Akwa Ibom"), "Akwa Ibom");
});

test("what it cannot place is kept as typed", () => {
  assert.equal(tidyOrderState("Somewhere"), "Somewhere");
  assert.equal(tidyOrderState(""), "");
  assert.equal(tidyOrderState(null), null);
  assert.equal(tidyOrderState(undefined), undefined);
});
