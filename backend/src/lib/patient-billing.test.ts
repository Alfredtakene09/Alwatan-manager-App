import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveEditedConsultationAmount } from "./patient-billing.js";

describe("montant après changement de médecin", () => {
  it("retire l'ancien montant et reprend le tarif du nouveau médecin", () => {
    assert.equal(
      resolveEditedConsultationAmount({
        doctorChanged: true,
        configuredAmount: 8000,
        requestedAmount: 5000,
        previousFee: 5000,
      }),
      8000,
    );
  });

  it("garde un montant saisi différent de l'ancien", () => {
    assert.equal(
      resolveEditedConsultationAmount({
        doctorChanged: true,
        configuredAmount: 8000,
        requestedAmount: 6000,
        previousFee: 5000,
      }),
      6000,
    );
  });

  it("ne change pas le montant si le médecin reste le même", () => {
    assert.equal(
      resolveEditedConsultationAmount({
        doctorChanged: false,
        configuredAmount: 8000,
        requestedAmount: 5000,
        previousFee: 5000,
      }),
      5000,
    );
  });
});
