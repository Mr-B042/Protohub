import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
};
const { nigerianPhoneProblem, nigerianPhoneCore } = await load("../src/lib/ng-phone.ts");
const { vagueAddressReason } = await load("../src/lib/nigeria.ts");
const { KNOWN_AREA_NAMES } = await load("../src/lib/ng-areas.ts");

test("every way of writing a full Nigerian number is accepted", () => {
  for (const value of ["+23408012345678", "08012345678", "+2348012345678", "8012345678", "0801 234 5678", "002348012345678", "0703-111-2222", "09012345678"]) {
    assert.equal(nigerianPhoneProblem(value), null, value);
    assert.equal(nigerianPhoneCore(value).length, 10, value);
  }
});

test("a missing or extra digit is refused (order 5914: 0803546892)", () => {
  assert.match(nigerianPhoneProblem("0803546892"), /too short/);
  assert.match(nigerianPhoneProblem("+234803546892"), /too short/);
  assert.match(nigerianPhoneProblem("080123456781"), /too long/);
  assert.match(nigerianPhoneProblem("0501 234 5678"), /check this number/);
  assert.equal(nigerianPhoneProblem(""), null); // empty is the "required" message's job
});

test("an address that only repeats the state or city is sent back", () => {
  const place = [
    ["Port Harcourt", "River", "Rivers"],
    ["Agbor Delta State", "Delta", "Delta"],
    ["Kaduna", "Kaduna", "Kaduna"],
    ["Ikom", "Ikom", "Cross River"],
    ["Ikorodu", "Ikorodu", "Lagos"],
    ["Yankaba", "Yankaba", "Kano"],
    ["Jalingo Taraba State", "Jalingo", "Taraba"],
    ["𝑬𝒅𝒐 𝑺𝒕𝒆", "𝑬𝒅𝒐", "Edo"],
    ["Lagos", "", "Lagos"],
    ["Ado Ekiti", "Ado Ekiti", "Ekiti"]
  ];
  for (const [address, city, state] of place) assert.equal(vagueAddressReason(address, city, state), "place", address);
  assert.equal(vagueAddressReason("Joavigna@gmail.com", "Abuja", "FCT Abuja"), "email");
});

test("one name or a known area alone is sent back for more (order 5918)", () => {
  const short = [
    ["Elebu", "Ibadan", "Oyo"],
    ["Wimpy", "Port Harcourt", "Rivers"],
    ["Rumoimoi", "Porthacourt", "Rivers"],
    ["Yankaba", "Kano", "Kano"],
    ["Kwali Abuja", "Abuja", "FCT Abuja"],
    ["Otolo Nnewi", "Nnewi", "Anambra"],
    ["Iyana Ipaja", "Alimosho", "Lagos"],
    ["Elebu, Ibadan Oyo State", "Ibadan", "Oyo"]
  ];
  for (const [address, city, state] of short) assert.equal(vagueAddressReason(address, city, state, KNOWN_AREA_NAMES), "short", address);
});

test("real streets and landmarks pass, even without a number", () => {
  const fine = [
    ["Delta Mall, Effurun", "Warri", "Delta"],
    ["Opposite First Bank Elebu", "Ibadan", "Oyo"],
    ["Elebu Market Road", "Ibadan", "Oyo"],
    ["Agodi Gate", "Ibadan", "Oyo"],
    ["Mrs Ade provisions Elebu", "Ibadan", "Oyo"],
    ["Paul University Awka", "Anambra", "Anambra"],
    ["12 Lagos", "Lagos", "Lagos"],
    ["Lagos Street", "Calabar", "Cross River"],
    ["", "Lagos", "Lagos"]
  ];
  for (const [address, city, state] of fine) assert.equal(vagueAddressReason(address, city, state, KNOWN_AREA_NAMES), null, address);
});

const { STATE_AREAS, areaSuggestions } = await load("../src/lib/ng-areas.ts");
const { NIGERIA_STATES } = await load("../src/lib/nigeria.ts");

test("every state (and FCT Abuja) has its own area list, no strays", () => {
  assert.deepEqual(Object.keys(STATE_AREAS).sort(), [...NIGERIA_STATES].sort());
  for (const [state, areas] of Object.entries(STATE_AREAS)) {
    assert.ok(areas.length >= 8, state);
    assert.equal(new Set(areas.map((a) => a.toLowerCase())).size, areas.length, `${state} has a repeat`);
  }
});

test("suggestions stay in the chosen state and narrow as the customer types", () => {
  assert.deepEqual(areaSuggestions("Lagos", "", 3), ["Ikeja", "Ikorodu", "Surulere"]);
  assert.ok(areaSuggestions("Lagos", "lek").includes("Lekki"));
  assert.ok(areaSuggestions("Lagos", "lek").every((area) => STATE_AREAS.Lagos.includes(area)));
  assert.deepEqual(areaSuggestions("Rivers", "rumu").slice(0, 2), ["Rumuokoro", "Rumuola"]);
  assert.ok(areaSuggestions("Lagos", "island").includes("Lagos Island")); // a word inside the name
  assert.deepEqual(areaSuggestions("Lagos", "Ikeja"), []); // already picked
  assert.deepEqual(areaSuggestions("Kano", "Ikeja"), []); // never another state's area
});

const { STATE_ADDRESS_EXAMPLE, addressExampleFor } = await load("../src/lib/ng-areas.ts");

test("every state has its own address example, and it is not another state's", () => {
  assert.deepEqual(Object.keys(STATE_ADDRESS_EXAMPLE).sort(), [...NIGERIA_STATES].sort());
  assert.match(addressExampleFor("Kano"), /Kano/);
  assert.match(addressExampleFor("Lagos"), /Ikeja/);
  assert.doesNotMatch(addressExampleFor(""), /Aba Road|Rumuola/);
  // The example itself must pass the vague-address check.
  for (const [state, example] of Object.entries(STATE_ADDRESS_EXAMPLE)) assert.equal(vagueAddressReason(example, "", state), null, state);
});
