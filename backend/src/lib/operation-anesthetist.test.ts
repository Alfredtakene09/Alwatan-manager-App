import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasOperationAnesthetist,
  isAnesthetistOptionalService,
  operationAnesthetistError,
} from "./operation-anesthetist.js";

describe("anesthésiste obligatoire sur une opération", () => {
  it("exempte Ophtalmologie et Odontologie, accents et casse ignorés", () => {
    assert.equal(isAnesthetistOptionalService("Ophtalmologie"), true);
    assert.equal(isAnesthetistOptionalService("ODONTOLOGIE"), true);
    assert.equal(isAnesthetistOptionalService("Chirurgie Générale"), false);
    assert.equal(isAnesthetistOptionalService("Gynécologie"), false);
    assert.equal(isAnesthetistOptionalService(null), false);
  });

  it("exige une personne et un % entre 1 et 99", () => {
    assert.equal(hasOperationAnesthetist(null), false);
    assert.equal(hasOperationAnesthetist({ anesthesiologistPercent: 0 }), false);
    assert.equal(hasOperationAnesthetist({ anesthesiologistId: "u1", anesthesiologistPercent: 0 }), false);
    assert.equal(hasOperationAnesthetist({ anesthesiologistId: "u1", anesthesiologistPercent: 11 }), true);
    assert.equal(hasOperationAnesthetist({ anesthesiologistName: "AWAD", anesthesiologistPercent: 11 }), true);
    assert.equal(hasOperationAnesthetist({ anesthesiologistName: "  ", anesthesiologistPercent: 11 }), false);
  });

  it("refuse une opération sans anesthésiste hors services exemptés", () => {
    assert.ok(operationAnesthetistError("Gynécologie", { anesthesiologistPercent: 0 }));
    assert.equal(operationAnesthetistError("Ophtalmologie", null), null);
    assert.equal(
      operationAnesthetistError("Gynécologie", { anesthesiologistId: "u1", anesthesiologistPercent: 10 }),
      null,
    );
  });
});
