import test from "node:test";
import assert from "node:assert/strict";
import { lateSendWindow, minutesLate } from "./late-send-rules.js";

// Lagos is UTC+1: 10:00 Lagos = 09:00Z.
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

test("Tuesday daytime order: 15 minutes from arrival", () => {
  const w = lateSendWindow(at("2026-10-27T12:00:00Z")); // Tue 13:00 Lagos
  assert.equal(iso(w.startMs), "2026-10-27T12:00:00.000Z");
  assert.equal(iso(w.deadlineMs), "2026-10-27T12:15:00.000Z");
});

test("Night order on Tuesday: clock starts at 10am", () => {
  const w = lateSendWindow(at("2026-10-26T23:30:00Z")); // Tue 00:30 Lagos
  assert.equal(iso(w.startMs), "2026-10-27T09:00:00.000Z");
  assert.equal(iso(w.deadlineMs), "2026-10-27T09:15:00.000Z");
});

test("Monday early order: clock starts at 11am", () => {
  const w = lateSendWindow(at("2026-10-26T06:00:00Z")); // Mon 07:00 Lagos
  assert.equal(iso(w.startMs), "2026-10-26T10:00:00.000Z");
  assert.equal(iso(w.deadlineMs), "2026-10-26T10:15:00.000Z");
});

test("Monday 10:30 is still before Monday's start", () => {
  const w = lateSendWindow(at("2026-10-26T09:30:00Z"));
  assert.equal(iso(w.deadlineMs), "2026-10-26T10:15:00.000Z");
});

test("Saturday evening and Sunday orders wait for Monday 11am", () => {
  assert.equal(iso(lateSendWindow(at("2026-10-24T17:00:00Z")).deadlineMs), "2026-10-26T10:15:00.000Z"); // Sat 18:00
  assert.equal(iso(lateSendWindow(at("2026-10-25T11:00:00Z")).deadlineMs), "2026-10-26T10:15:00.000Z"); // Sun noon
});

test("After 5:30pm: next morning", () => {
  assert.equal(iso(lateSendWindow(at("2026-10-27T17:00:00Z")).deadlineMs), "2026-10-28T09:15:00.000Z"); // Tue 18:00
});

test("Arrives 5:25pm: 5 minutes today, 10 tomorrow", () => {
  const w = lateSendWindow(at("2026-10-27T16:25:00Z")); // Tue 17:25 Lagos
  assert.equal(iso(w.startMs), "2026-10-27T16:25:00.000Z");
  assert.equal(iso(w.deadlineMs), "2026-10-28T09:10:00.000Z");
});

test("minutes late", () => {
  const d = at("2026-10-27T09:15:00Z");
  assert.equal(minutesLate(d, at("2026-10-27T09:14:00Z"), 0), 0);
  assert.equal(minutesLate(d, at("2026-10-27T09:40:00Z"), 0), 25);
  assert.equal(minutesLate(d, null, at("2026-10-27T09:16:00Z")), 1);
});
