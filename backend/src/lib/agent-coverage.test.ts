import assert from "node:assert/strict";
import test from "node:test";
import { normalizeState } from "./agent-coverage.js";

test("normalizeState strips a trailing 'State' descriptor", () => {
  assert.equal(normalizeState("Rivers State"), "Rivers");
  assert.equal(normalizeState("Edo State"), "Edo");
  assert.equal(normalizeState("Rivers"), "Rivers");
});

test("normalizeState drops a comma-separated city note without changing the state", () => {
  // A hub's own label sometimes carries a city note in the state field
  // ("Edo, Benin") - this must match plain "Edo" for routing eligibility,
  // without renaming or merging that hub's own record.
  assert.equal(normalizeState("Edo, Benin"), "Edo");
  assert.equal(normalizeState("Edo State, Benin"), "Edo");
});

test("normalizeState never collapses two genuinely different states", () => {
  assert.notEqual(normalizeState("Rivers"), normalizeState("Cross River"));
  assert.notEqual(normalizeState("Rivers State"), normalizeState("Cross River"));
  assert.notEqual(normalizeState("Edo"), normalizeState("Delta"));
});

test("normalizeState folds Abuja/FCT aliases", () => {
  assert.equal(normalizeState("FCT"), "FCT Abuja");
  assert.equal(normalizeState("Abuja"), "FCT Abuja");
  assert.equal(normalizeState("FCT, Abuja"), "FCT Abuja");
});

test("normalizeState maps known city-only hub labels to their real state", () => {
  assert.equal(normalizeState("Ibadan"), "Oyo");
  assert.equal(normalizeState("Asaba Delta"), "Delta");
  assert.equal(normalizeState("Enugu Nsukka"), "Enugu");
  assert.equal(normalizeState("Oyo"), "Oyo");
  assert.equal(normalizeState("Enugu"), "Enugu");
});
