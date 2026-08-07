import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { humanFieldErrors, humanFieldLabel, humanFirstMessage } from "./validation-message.js";

// Zod's own wording. Anything matching this reaching a reader is the bug.
const LIBRARY = /^(String|Array|Number|Expected|Invalid enum value|Required$|Invalid input)/i;
const allMessages = (fields: Record<string, string[]>) => Object.values(fields).flat();

const fieldsFor = (schema: z.ZodTypeAny, value: unknown) => {
  const result = schema.safeParse(value);
  assert.equal(result.success, false, "expected this value to be refused");
  return humanFieldErrors((result as { error: z.ZodError }).error);
};

test("the reported case reads as a sentence, not as library output", () => {
  const schema = z.object({ serviceAreas: z.array(z.string()).max(20) });
  const fields = fieldsFor(schema, { serviceAreas: Array.from({ length: 25 }, (_, i) => `A${i}`) });
  const [label] = Object.keys(fields);
  assert.equal(label, "Service areas");
  assert.match(fields[label][0], /cannot have more than 20 items/);
  for (const message of allMessages(fields)) assert.ok(!LIBRARY.test(message), message);
});

test("wording written by a schema author is never overwritten", () => {
  const schema = z.object({ phone: z.string().min(7, "Enter a phone number we can reach you on.") });
  const fields = fieldsFor(schema, { phone: "12" });
  assert.deepEqual(fields["Phone"], ["Enter a phone number we can reach you on."]);
});

test("every issue kind produces something actionable", () => {
  const schema = z.object({
    name: z.string().max(3),
    count: z.array(z.string()).min(2),
    kind: z.enum(["a", "b"]),
    email: z.string().email(),
    missing: z.string()
  });
  const fields = fieldsFor(schema, { name: "far too long", count: ["one"], kind: "z", email: "nope" });
  const messages = allMessages(fields);
  assert.ok(messages.length >= 5);
  for (const message of messages) assert.ok(!LIBRARY.test(message), `library wording leaked: ${message}`);
  assert.match(fields["Missing"][0], /required/i);
  assert.match(fields["Email"][0], /valid email/i);
  assert.match(fields["Kind"][0], /must be one of: a, b/);
});

test("a nested list names the entry a person would point at", () => {
  assert.equal(humanFieldLabel(["guarantors", 1, "fullName"]), "Guarantor 2 full name");
  assert.equal(humanFieldLabel(["serviceAreas"]), "Service areas");
  assert.equal(humanFieldLabel([]), "This form");
});

test("the single-line form reads as one sentence", () => {
  const schema = z.object({ serviceAreas: z.array(z.string()).max(20) });
  const result = schema.safeParse({ serviceAreas: Array.from({ length: 25 }, (_, i) => `A${i}`) });
  assert.equal(result.success, false);
  const line = humanFirstMessage((result as { error: z.ZodError }).error);
  assert.match(line, /^Service areas cannot have more than 20 items/);
  assert.ok(!LIBRARY.test(line));
});
