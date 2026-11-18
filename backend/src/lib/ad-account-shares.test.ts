import assert from "node:assert/strict";
import test from "node:test";
import { decideClaims } from "./ad-account-shares-rules.js";

const NG = "ng", ZM = "zm";
const c = (campaignId: string) => ({ campaignId, homeBranchId: NG, sharedWith: [NG, ZM] });
const ev = () => ({ orderBranches: new Map<string, Map<string, number>>(), mappedBranches: new Map<string, Set<string>>(), pageBranches: new Map<string, Set<string>>() });

test("a shared campaign counts in Zambia only on proof; everything else stays home", () => {
  const e = ev();
  e.orderBranches.set("zm-orders", new Map([[ZM, 4]]));
  e.orderBranches.set("ng-orders", new Map([[NG, 9], [ZM, 1]]));
  e.mappedBranches.set("zm-mapped", new Set([ZM]));
  e.pageBranches.set("zm-page", new Set([ZM]));
  e.pageBranches.set("both-pages", new Set([NG, ZM]));
  const claims = decideClaims(["zm-orders", "ng-orders", "zm-mapped", "zm-page", "both-pages", "nothing"].map(c), e);
  assert.equal(claims.get("zm-orders"), ZM);
  assert.equal(claims.has("ng-orders"), false);   // more Nigeria orders: stays home
  assert.equal(claims.get("zm-mapped"), ZM);
  assert.equal(claims.get("zm-page"), ZM);
  assert.equal(claims.get("both-pages"), ZM);     // home is not a candidate, Zambia's page sells it
  assert.equal(claims.has("nothing"), false);     // no proof: Nigeria
});

test("a page proof never beats home orders", () => {
  const e = ev();
  e.orderBranches.set("x", new Map([[NG, 2]]));
  e.pageBranches.set("x", new Set([ZM]));
  assert.equal(decideClaims([c("x")], e).has("x"), false);
});

test("a branch with only shared accounts books back to the share's start once, then just the days asked", async () => {
  const { sharedOnlyFrom } = await import("./ad-account-shares-rules.js");
  assert.equal(sharedOnlyFrom("2026-11-17", null, "2026-11-15"), "2026-11-15");          // first run: back-fill
  assert.equal(sharedOnlyFrom("2026-11-17", "2026-11-18T00:13:00Z", "2026-11-15"), "2026-11-17"); // later runs
  assert.equal(sharedOnlyFrom("2026-11-10", null, "2026-11-15"), "2026-11-10");          // asked for more: keep it
  assert.equal(sharedOnlyFrom("2026-11-17", null, null), "2026-11-17");
});
