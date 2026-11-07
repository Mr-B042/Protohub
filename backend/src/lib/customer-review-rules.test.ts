import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_AMOUNTS, amountFor, cleanAmounts, filesProblem, levelsFor, payrollMonthOfWeek, reviewProblem, topUp, weekStartOf
} from "./customer-review-rules.js";

test("the order is paid once, at its highest approved level: photo, then video, then premium", () => {
  const photo = amountFor("photo", DEFAULT_AMOUNTS);
  const video = amountFor("video", DEFAULT_AMOUNTS);
  const premium = amountFor("premium", DEFAULT_AMOUNTS);
  assert.deepEqual(topUp([], photo, 0), { worth: 100, credit: 100 });
  assert.deepEqual(topUp([photo], video, 100), { worth: 200, credit: 100 }); // only the extra 100
  assert.deepEqual(topUp([photo, video], premium, 200), { worth: 400, credit: 200 }); // total 400
  assert.deepEqual(topUp([video], photo, 200), { worth: 200, credit: 0 }); // a lower one after a higher one pays nothing
  assert.deepEqual(topUp([photo], photo, 100), { worth: 100, credit: 0 }); // the same level twice pays once
});

test("a review needs the order, the type, the customer's words for written, and the genuine tick", () => {
  const ok = { orderId: "1001", type: "written", text: "It works well, I like it", genuine: true };
  const context = { today: "2026-11-07", deliveredOn: "2026-11-05" };
  assert.equal(reviewProblem(ok, context), null);
  assert.match(reviewProblem({ ...ok, orderId: "" }, context)!, /delivered order/);
  assert.match(reviewProblem({ ...ok, text: "ok" }, context)!, /what the customer said/);
  assert.equal(reviewProblem({ ...ok, type: "photo", text: "" }, context), null); // a photo may come without words
  assert.match(reviewProblem({ ...ok, genuine: false }, context)!, /real experience/);
  assert.match(reviewProblem({ ...ok, rating: 6 }, context)!, /1 to 5/);
  assert.match(reviewProblem({ ...ok, receivedOn: "2026-11-08" }, context)!, /future/);
  assert.match(reviewProblem({ ...ok, receivedOn: "2026-11-04" }, context)!, /before the order was delivered/);
  assert.match(reviewProblem({ ...ok, channel: "telegram" }, context)!, /how the customer sent it/);
});

test("files: a photo review needs a photo, a video review a video; consent proof does not count", () => {
  assert.equal(filesProblem("written", [{ kind: "image", status: "pending", part: "proof" }]), null);
  assert.match(filesProblem("photo", [{ kind: "image", status: "pending", part: "consent" }])!, /at least one photo/);
  assert.equal(filesProblem("photo", [{ kind: "image", status: "pending", part: "content" }, { kind: "image", status: "pending", part: "proof" }]), null);
  assert.match(filesProblem("video", [{ kind: "image", status: "pending", part: "content" }])!, /at least one video/);
  assert.match(filesProblem("photo", [{ kind: "image", status: "uploading", part: "content" }])!, /still being sent/);
});

test("every review needs a WhatsApp screenshot (proof); the screenshot is never a product photo", () => {
  assert.match(filesProblem("written", [])!, /WhatsApp screenshot that shows the customer's phone number/);
  // Photos and videos too (Bright, 7 Nov 2026): a saved picture doesn't prove it came from the customer.
  assert.match(filesProblem("photo", [{ kind: "image", status: "pending", part: "content" }])!, /WhatsApp screenshot/);
  assert.match(filesProblem("video", [{ kind: "video", status: "pending", part: "content" }])!, /WhatsApp screenshot/);
  assert.equal(filesProblem("video", [{ kind: "video", status: "pending", part: "content" }, { kind: "image", status: "pending", part: "proof" }]), null);
  // A product photo alone does not back a written review, and the permission screenshot does not either.
  assert.match(filesProblem("written", [{ kind: "image", status: "pending", part: "content" }])!, /WhatsApp screenshot/);
  assert.match(filesProblem("written", [{ kind: "image", status: "pending", part: "consent" }])!, /WhatsApp screenshot/);
  // The WhatsApp screenshot does not make a photo review.
  assert.match(filesProblem("photo", [{ kind: "image", status: "pending", part: "proof" }])!, /at least one photo/);
});

test("an approver can only pick levels the files show; premium needs a video", () => {
  assert.deepEqual(levelsFor("written", false, false), ["written"]);
  assert.deepEqual(levelsFor("photo", false, true), ["written", "photo"]);
  assert.deepEqual(levelsFor("video", true, false), ["written", "photo", "video", "premium"]);
});

test("pay weeks start on Sunday; payroll takes the month the week ends in", () => {
  assert.equal(weekStartOf("2026-11-07"), "2026-11-01"); // Saturday -> its Sunday
  assert.equal(weekStartOf("2026-11-08"), "2026-11-08"); // Sunday
  assert.equal(payrollMonthOfWeek("2026-11-29"), "2026-12"); // 29 Nov - 5 Dec ends in December
  assert.equal(payrollMonthOfWeek("2026-11-22"), "2026-11");
});

test("bonus amounts are cleaned", () => {
  assert.deepEqual(cleanAmounts({ written: "75", photo: -5, video: 250.4, premium: "x" }), { written: 75, photo: 100, video: 250, premium: 400 });
});
