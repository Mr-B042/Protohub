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

test("every way of writing a full Nigerian number is accepted", () => {
  for (const value of ["+23408137069653", "08137069653", "+2348137069653", "8137069653", "0813 706 9653", "002348137069653", "0703-111-2222", "09012345678"]) {
    assert.equal(nigerianPhoneProblem(value), null, value);
    assert.equal(nigerianPhoneCore(value).length, 10, value);
  }
});

test("a missing or extra digit is refused (order 5914: 0803546892)", () => {
  assert.match(nigerianPhoneProblem("0803546892"), /too short/);
  assert.match(nigerianPhoneProblem("+234803546892"), /too short/);
  assert.match(nigerianPhoneProblem("081370696531"), /too long/);
  assert.match(nigerianPhoneProblem("0513 706 9653"), /check this number/);
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

test("real areas, streets and landmarks pass, even one word", () => {
  const fine = [
    ["Wimpy", "Port Harcourt", "Rivers"],
    ["Rumoimoi", "Porthacourt", "Rivers"],
    ["Yankaba", "Kano", "Kano"],
    ["Kwali Abuja", "Abuja", "FCT Abuja"],
    ["Otolo Nnewi", "Nnewi", "Anambra"],
    ["Delta Mall, Effurun", "Warri", "Delta"],
    ["Paul University Awka", "Anambra", "Anambra"],
    ["12 Lagos", "Lagos", "Lagos"],
    ["Lagos Street", "Calabar", "Cross River"],
    ["", "Lagos", "Lagos"]
  ];
  for (const [address, city, state] of fine) assert.equal(vagueAddressReason(address, city, state), null, address);
});
