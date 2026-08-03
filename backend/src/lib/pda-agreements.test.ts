import assert from "node:assert/strict";
import test from "node:test";
import {
  PDA_AGREEMENT_TEMPLATES, PDA_AGREEMENT_VERSION,
  renderPdaAgreement, signerNameMatches
} from "./pda-agreements.js";

test("all six required Personal Delivery Agent agreements are defined", () => {
  assert.equal(PDA_AGREEMENT_TEMPLATES.length, 6);
  assert.equal(new Set(PDA_AGREEMENT_TEMPLATES.map((item) => item.key)).size, 6);
  for (const agreement of PDA_AGREEMENT_TEMPLATES) {
    assert.ok(agreement.summary.length >= 4);
    assert.ok(agreement.sections.length >= 4);
  }
});

test("rendered agreement binds the company, applicant, reference and version", () => {
  const agreement = renderPdaAgreement({
    key: "inventory_agreement",
    companyName: "Bright Path Hub",
    applicantName: "Blessing Nnenna",
    reference: "PDA-APP-00012",
    issuedOn: "2026-08-03"
  });
  assert.equal(agreement.version, PDA_AGREEMENT_VERSION);
  assert.match(agreement.opening, /Bright Path Hub/);
  assert.match(agreement.opening, /Blessing Nnenna/);
  assert.match(agreement.opening, /PDA-APP-00012/);
  assert.match(agreement.contentHash, /^[a-f0-9]{64}$/);
});

test("agreement hash changes if a party changes", () => {
  const common = {
    key: "cod_agreement" as const,
    companyName: "Bright Path Hub",
    reference: "PDA-APP-00012",
    issuedOn: "2026-08-03"
  };
  const first = renderPdaAgreement({ ...common, applicantName: "Blessing Nnenna" });
  const second = renderPdaAgreement({ ...common, applicantName: "Another Person" });
  assert.notEqual(first.contentHash, second.contentHash);
});

test("typed signature tolerates case and punctuation but not another name", () => {
  assert.equal(signerNameMatches(" Blessing  Nnenna ", "BLESSING NNENNA"), true);
  assert.equal(signerNameMatches("Blessing-Nnenna", "Blessing Nnenna"), true);
  assert.equal(signerNameMatches("Blessing N.", "Blessing Nnenna"), false);
});
