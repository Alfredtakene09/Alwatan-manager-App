import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatInvoiceNumber,
  parseInvoiceSequence,
  parsePatientCodeSequence,
} from "./patient-code.js";

describe("numéros de facture", () => {
  it("parse les formats 3 et 6 chiffres", () => {
    assert.equal(parseInvoiceSequence("FAC-001"), 1);
    assert.equal(parseInvoiceSequence("FAC-999"), 999);
    assert.equal(parseInvoiceSequence("FAC-001000"), 1000);
    assert.equal(parseInvoiceSequence("FAC-1000"), 1000);
    assert.equal(parseInvoiceSequence("PAT-001"), 0);
  });

  it("passe à 6 chiffres après 999", () => {
    assert.equal(formatInvoiceNumber(1), "FAC-001");
    assert.equal(formatInvoiceNumber(999), "FAC-999");
    assert.equal(formatInvoiceNumber(1000), "FAC-001000");
    assert.equal(formatInvoiceNumber(1001), "FAC-001001");
  });

  it("parse les codes patients de longueur variable", () => {
    assert.equal(parsePatientCodeSequence("PAT-001"), 1);
    assert.equal(parsePatientCodeSequence("PAT-1000"), 1000);
  });
});
