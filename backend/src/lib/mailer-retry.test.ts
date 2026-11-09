import assert from "node:assert/strict";
import test from "node:test";
import { RETRY_DELAYS_MIN, looksMisconfigured } from "./mailer.js";

test("a service that can't send for us is skipped, not tried first again", () => {
  assert.equal(looksMisconfigured("The protoolshardwareventures.com.ng domain is not verified. Please, add and verify your domain on https://resend.com/domains"), true);
  assert.equal(looksMisconfigured("API key is invalid"), true);
  assert.equal(looksMisconfigured("Unauthorized"), true);
  assert.equal(looksMisconfigured("socket hang up"), false);
  assert.equal(looksMisconfigured(null), false);
});

test("failed emails are tried again three times", () => {
  assert.deepEqual(RETRY_DELAYS_MIN, [10, 30, 90]);
});
