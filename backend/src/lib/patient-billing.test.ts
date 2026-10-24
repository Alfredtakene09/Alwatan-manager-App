import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PatientCategory } from "@prisma/client";
import {
  resolveConsultationBilling,
  resolveEditedConsultationAmount,
  withPatientDiscount,
} from "./patient-billing.js";

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

describe("réduction patient personnel", () => {
  const staff = { category: PatientCategory.PERSONNEL, discountPercent: null };

  it("applique 20 % par défaut sur la consultation", () => {
    const billing = resolveConsultationBilling(PatientCategory.PERSONNEL, 10_000, 0);
    assert.equal(billing.reductionFcfa, 2_000);
    assert.equal(billing.billableAmountFcfa, 8_000);
  });

  it("utilise le % de la fiche et garde une réduction manuelle plus forte", () => {
    assert.equal(resolveConsultationBilling(PatientCategory.PERSONNEL, 10_000, 0, 30).reductionFcfa, 3_000);
    assert.equal(resolveConsultationBilling(PatientCategory.PERSONNEL, 10_000, 5_000).reductionFcfa, 5_000);
  });

  it("ne réapplique pas la réduction sur un montant déjà réduit", () => {
    const once = withPatientDiscount(staff, 25_000, 0);
    assert.equal(once, 5_000);
    assert.equal(withPatientDiscount(staff, 25_000, once), 5_000);
  });

  it("ne touche pas aux autres catégories", () => {
    assert.equal(withPatientDiscount({ category: PatientCategory.STANDARD }, 25_000, 0), 0);
    assert.equal(resolveConsultationBilling(PatientCategory.ASSOCIE, 10_000, 0).billableAmountFcfa, 0);
  });
});
