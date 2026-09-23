import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { phonesMatchForDossierReuse } from "./merge-patients.js";

describe("phonesMatchForDossierReuse", () => {
  it("rattache le même numéro (espaces / préfixe ignorés)", () => {
    assert.equal(phonesMatchForDossierReuse("06 12 34 56 78", "0612345678"), true);
  });

  it("refuse un numéro trop court", () => {
    assert.equal(phonesMatchForDossierReuse("12345", "12345"), false);
  });

  it("refuse deux numéros différents", () => {
    assert.equal(phonesMatchForDossierReuse("0612345678", "0612345679"), false);
  });
});
