import assert from "node:assert/strict";
import test from "node:test";
import { autoPriority, basePriority, isOpen, redact, redactText, similarity, statusesFor, ticketCode, ticketNumberFrom } from "./issue-rules.js";

test("ticket codes per kind, and reading them back", () => {
  assert.equal(ticketCode("issue", 1048), "BUG-1048");
  assert.equal(ticketCode("feature", 214), "FEAT-0214");
  assert.equal(ticketCode("ux", 182), "UX-0182");
  assert.equal(ticketNumberFrom("BUG-1048"), 1048);
  assert.equal(ticketNumberFrom("bug 1048"), 1048);
  assert.equal(ticketNumberFrom("1048"), 1048);
  assert.equal(ticketNumberFrom("hello"), null);
});

test("priority: impact x who is affected", () => {
  assert.equal(basePriority("critical", "everyone"), "P0");
  assert.equal(basePriority("critical", "only_me"), "P1");
  assert.equal(basePriority("high", "department"), "P1");
  assert.equal(basePriority("high", "only_me"), "P2");
  assert.equal(basePriority("medium", "several_users"), "P2");
  assert.equal(basePriority("medium", "only_me"), "P3");
  assert.equal(basePriority("low", "only_me"), "P3");
  assert.equal(basePriority(null, null), "P3");
});

test("priority rises with people affected, orders involved and age; features have none", () => {
  assert.equal(autoPriority({ kind: "issue", impact: "medium", affected: "only_me", affectedCount: 4 }), "P2");
  assert.equal(autoPriority({ kind: "issue", impact: "medium", affected: "only_me", affectedCount: 12 }), "P1");
  assert.equal(autoPriority({ kind: "issue", impact: "high", affected: "only_me", affectedRefKind: "order" }), "P1");
  const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
  assert.equal(autoPriority({ kind: "issue", impact: "low", affected: "only_me", createdAt: old, status: "triaged" }), "P2");
  assert.equal(autoPriority({ kind: "issue", impact: "high", affected: "department", createdAt: old, status: "in_progress" }), "P1");
  assert.equal(autoPriority({ kind: "issue", impact: "low", affected: "only_me", createdAt: old, status: "closed" }), "P3");
  assert.equal(autoPriority({ kind: "feature", impact: "critical", affected: "everyone" }), null);
  assert.equal(autoPriority({ kind: "issue", impact: "medium", affected: "only_me", text: "Remittance shows the wrong amount" }), "P2");
  assert.equal(autoPriority({ kind: "issue", impact: "low", affected: "only_me", text: "Remittance shows the wrong amount" }), "P3");
});

test("status steps per kind; open means still being worked on", () => {
  assert.ok(statusesFor("issue").includes("testing"));
  assert.ok(statusesFor("feature").includes("released"));
  assert.ok(!statusesFor("feature").includes("testing"));
  assert.equal(isOpen("in_progress"), true);
  assert.equal(isOpen("resolved"), false);
  assert.equal(isOpen("closed"), false);
});

test("similar titles match; unrelated ones do not", () => {
  const a = { title: "Orders page becomes blank after applying Status filter", module: "Orders" };
  assert.ok(similarity(a, { title: "Orders page blank when using filters", module: "Orders" }) >= 0.34);
  assert.ok(similarity(a, { title: "Add bulk order assignment feature", module: "Orders" }) < 0.34);
});

test("secrets never reach the stored technical data", () => {
  assert.equal(redactText("GET /api/x?token=abc123&id=5"), "GET /api/x?token=[removed]&id=5");
  assert.match(redactText("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefgh"), /\[removed\]/);
  assert.deepEqual(redact({ password: "x", nested: { apiKey: "y", ok: 1 } }), { password: "[removed]", nested: { apiKey: "[removed]", ok: 1 } });
  assert.deepEqual(redact({ sessionId: "S-AB12", accessToken: "t", pinned: true }), { sessionId: "S-AB12", accessToken: "[removed]", pinned: true });
});
