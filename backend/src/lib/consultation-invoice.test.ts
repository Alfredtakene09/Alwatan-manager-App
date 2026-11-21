import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PatientCategory } from "@prisma/client";
import { consultationInvoiceCreateData } from "./consultation-invoice.js";

describe("facture consultation", () => {
  it("renseigne paidAmountFcfa et une ligne de paiement pour un patient STANDARD", () => {
    const data = consultationInvoiceCreateData(PatientCategory.STANDARD, {
      invoiceNumber: "FAC-001",
      patientId: "p1",
      visitId: "v1",
      amountFcfa: 5000,
      issuedById: "u1",
    });
    assert.equal(data.status, "PAID");
    assert.equal(data.paidAmountFcfa, 5000);
    assert.equal(data.amountFcfa, 5000);
    assert.ok(data.payments);
  });

  it("laisse PENDING sans paiement pour un patient exonéré", () => {
    const data = consultationInvoiceCreateData(PatientCategory.ASSOCIE, {
      invoiceNumber: "FAC-002",
      patientId: "p1",
      visitId: "v1",
      amountFcfa: 0,
      issuedById: "u1",
    });
    assert.equal(data.status, "PENDING");
    assert.equal(data.paidAmountFcfa, 0);
  });

  it("laisse PENDING avec le montant complet pour un patient ONG / partenaire", () => {
    const data = consultationInvoiceCreateData(PatientCategory.ONG, {
      invoiceNumber: "FAC-003",
      patientId: "p1",
      visitId: "v1",
      amountFcfa: 5000,
      issuedById: "u1",
    });
    assert.equal(data.status, "PENDING");
    assert.equal(data.amountFcfa, 5000);
    assert.equal(data.paidAmountFcfa, 0);
    assert.equal(data.payments, undefined);
  });
});
