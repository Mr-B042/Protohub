import assert from "node:assert/strict";
import test from "node:test";
import { SubmitSchema } from "./pda-application-schema.js";

// A complete, believable application. Each test below removes exactly one thing.
const complete = () => ({
  fullName: "Chinedu Okeke",
  phone: "08031234567",
  dateOfBirth: "1995-04-11",
  state: "Imo",
  city: "Owerri",
  residentialAddress: "12 Wetheral Road, Owerri",
  emergencyContactName: "Ngozi Okeke",
  emergencyContactPhone: "08037654321",
  idType: "NIN" as const,
  idNumber: "12345678901",
  idFrontPath: "org/public/link/front.jpg",
  selfiePath: "org/public/link/selfie.jpg",
  transportMethod: "Public transport" as const,
  serviceAreas: ["Owerri", "Orlu"],
  bankName: "GTBank",
  bankAccountNumber: "0123456789",
  bankAccountName: "Chinedu Okeke",
  guarantors: [
    { fullName: "Emeka Okeke", relationship: "Uncle", guarantorType: "Family" as const, phone: "08011111111", address: "5 Douglas Road" },
    { fullName: "Adaeze Nwosu", relationship: "Employer", guarantorType: "Independent" as const, phone: "08022222222", address: "9 Tetlow Road" }
  ],
  consent: true as const
});

const firstError = (result: ReturnType<typeof SubmitSchema.safeParse>) => {
  if (result.success) return "";
  const flat = result.error.flatten();
  return String(Object.values(flat.fieldErrors).flat()[0] ?? flat.formErrors[0] ?? "");
};

test("a complete application is accepted", () => {
  assert.equal(SubmitSchema.safeParse(complete()).success, true);
});

// Each of these is something a reviewer cannot work around by "just calling
// them" - it either identifies the person, locates them, or pays them.
for (const field of [
  "dateOfBirth", "state", "city", "residentialAddress",
  "emergencyContactName", "emergencyContactPhone",
  "idType", "idNumber", "idFrontPath", "selfiePath",
  "transportMethod", "serviceAreas",
  "bankName", "bankAccountNumber", "bankAccountName"
] as const) {
  test(`${field} is required`, () => {
    const payload: Record<string, unknown> = complete();
    delete payload[field];
    assert.equal(SubmitSchema.safeParse(payload).success, false, `${field} should be required`);
  });
}

test("email and WhatsApp stay optional", () => {
  // Plenty of applicants have neither; demanding them turns away real people.
  const payload = complete();
  assert.equal(SubmitSchema.safeParse(payload).success, true);
});

test("the back of an ID is not demanded", () => {
  // A NIN slip and a passport have no second side.
  const payload = complete();
  assert.equal(Object.hasOwn(payload, "idBackPath"), false);
  assert.equal(SubmitSchema.safeParse(payload).success, true);
});

test("proof of address is not demanded up front", () => {
  // A young agent renting a room rarely has a bill in their own name; the
  // office can request it later.
  assert.equal(SubmitSchema.safeParse(complete()).success, true);
});

test("both guarantors are required", () => {
  const payload = complete();
  payload.guarantors = [payload.guarantors[0]];
  assert.equal(SubmitSchema.safeParse(payload).success, false);
});

test("a guarantor needs a relationship and an address", () => {
  for (const field of ["relationship", "address"] as const) {
    const payload = complete();
    const guarantor: Record<string, unknown> = { ...payload.guarantors[0] };
    delete guarantor[field];
    payload.guarantors = [guarantor as typeof payload.guarantors[0], payload.guarantors[1]];
    assert.equal(SubmitSchema.safeParse(payload).success, false, `guarantor ${field} should be required`);
  }
});

test("two family guarantors are refused", () => {
  // Two relatives vouching for each other is not independent verification, and
  // the reviewer's approval check refuses the pair anyway.
  const payload = complete();
  payload.guarantors = payload.guarantors.map((g) => ({ ...g, guarantorType: "Family" as const }));
  const result = SubmitSchema.safeParse(payload);
  assert.equal(result.success, false);
  assert.match(firstError(result), /not be family/);
});

test("the same person cannot be both guarantors", () => {
  const payload = complete();
  payload.guarantors = payload.guarantors.map((g) => ({ ...g, phone: "08011111111" }));
  const result = SubmitSchema.safeParse(payload);
  assert.equal(result.success, false);
  assert.match(firstError(result), /two different people/);
});

test("the applicant cannot guarantee themselves", () => {
  // Written differently on purpose - the check compares digits, not strings.
  const payload = complete();
  payload.guarantors[0] = { ...payload.guarantors[0], phone: "0803 123 4567" };
  const result = SubmitSchema.safeParse(payload);
  assert.equal(result.success, false);
  assert.match(firstError(result), /cannot be you/);
});

test("a motorcycle or car needs a plate number, other transport does not", () => {
  const withoutPlate = { ...complete(), transportMethod: "Motorcycle" as const };
  assert.equal(SubmitSchema.safeParse(withoutPlate).success, false);

  const withPlate = { ...withoutPlate, vehiclePlate: "ABC 123 XY" };
  assert.equal(SubmitSchema.safeParse(withPlate).success, true);

  const onFoot = { ...complete(), transportMethod: "Walking" as const };
  assert.equal(SubmitSchema.safeParse(onFoot).success, true);
});

test("consent must be given", () => {
  const payload = { ...complete(), consent: false as unknown as true };
  assert.equal(SubmitSchema.safeParse(payload).success, false);
});

// A validation message is read by somebody filling in a form on a phone, not by
// a developer. A real applicant was shown "Array must contain at most 20
// element(s)" - true, and useless. These lock every rule to its own words.
const ZODISH = /^(String|Array|Number|Expected|Invalid enum value|Required$|Invalid input)/i;

const messagesFor = (payload: Record<string, unknown>) => {
  const result = SubmitSchema.safeParse(payload);
  assert.equal(result.success, false, "expected this payload to be refused");
  const flat = (result as { error: any }).error.flatten();
  return [...Object.values(flat.fieldErrors).flat(), ...flat.formErrors] as string[];
};

test("too many delivery areas is explained in words, not Zod's", () => {
  const payload = complete();
  payload.serviceAreas = Array.from({ length: 25 }, (_, i) => `Area ${i + 1}`);
  const messages = messagesFor(payload);
  assert.ok(messages.length > 0);
  for (const message of messages) assert.ok(!ZODISH.test(message), `raw Zod message leaked: ${message}`);
  assert.ok(messages.some((m) => /delivery areas/i.test(m)), messages.join(" | "));
});

test("no rule in the schema falls back to Zod's own wording", () => {
  // One oversized value per constrained field, plus the empty payload, so a
  // rule added later without a message fails this rather than an applicant.
  const overlong = "x".repeat(1200);
  const cases: Array<Record<string, unknown>> = [
    {},
    { ...complete(), fullName: overlong },
    { ...complete(), phone: overlong },
    { ...complete(), dateOfBirth: overlong },
    { ...complete(), state: overlong, city: overlong, residentialAddress: overlong },
    { ...complete(), emergencyContactName: overlong, emergencyContactPhone: overlong },
    { ...complete(), idNumber: overlong, bankName: overlong, bankAccountNumber: overlong, bankAccountName: overlong },
    { ...complete(), vehicleModel: overlong, vehiclePlate: overlong },
    { ...complete(), whatsappPhone: overlong, email: overlong },
    { ...complete(), serviceAreas: [overlong] },
    { ...complete(), guarantors: [...complete().guarantors, ...complete().guarantors] },
    { ...complete(), guarantors: complete().guarantors.map((g) => ({ ...g, fullName: overlong, phone: overlong, address: overlong })) },
    { ...complete(), guarantors: complete().guarantors.map((g) => ({ ...g, guarantorType: "Neighbour" })) }
  ];
  for (const payload of cases) {
    for (const message of messagesFor(payload)) {
      assert.ok(!ZODISH.test(message), `raw Zod message leaked: ${message}`);
    }
  }
});
