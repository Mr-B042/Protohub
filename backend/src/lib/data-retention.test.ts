import assert from "node:assert/strict";
import test from "node:test";
import { orphanedPdaMediaPaths } from "./data-retention.js";

test("orphanedPdaMediaPaths keeps referenced uploads and gives incomplete applications seven days", () => {
  const now = Date.parse("2026-08-28T12:00:00Z");
  const objects = [
    { path: "org/referenced.jpg", createdAt: "2026-08-20T00:00:00Z" },
    { path: "org/fresh.jpg", createdAt: "2026-08-22T12:00:01Z" },
    { path: "org/orphan.jpg", createdAt: "2026-08-20T00:00:00Z" },
    { path: "org/unknown-age.jpg", createdAt: null }
  ];
  assert.deepEqual(orphanedPdaMediaPaths(objects, new Set(["org/referenced.jpg"]), now), ["org/orphan.jpg"]);
});
