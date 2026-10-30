import assert from "node:assert/strict";
import test from "node:test";
import { cron, processMemory, watchMemory } from "./memory-watch.js";

test("watchMemory returns the job's result and passes errors through", async () => {
  assert.equal(await watchMemory("t", async () => 42), 42);
  await assert.rejects(watchMemory("t", async () => { throw new Error("boom"); }), /boom/);
});

test("the wrapped scheduler is still node-cron (validate, schedule)", () => {
  assert.equal(cron.validate("*/5 * * * *"), true);
  const task = cron.schedule("0 0 1 1 *", async () => undefined, { scheduled: false } as any);
  assert.equal(typeof task.stop, "function");
  task.stop();
});

test("process memory is read on Linux and null elsewhere", () => {
  const value = processMemory();
  if (process.platform === "linux") assert.ok(value && value.programMb >= 0);
  else assert.equal(value, null);
});
