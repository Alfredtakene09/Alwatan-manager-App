import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceType } from "@prisma/client";
import { classifyInvoiceForDayClosure } from "./day-closure-sales.js";

describe("classifyInvoiceForDayClosure", () => {
  it("classe les consultations par service clinique", () => {
    const label = classifyInvoiceForDayClosure({
      id: "1",
      patientId: "p1",
      type: InvoiceType.CONSULTATION,
      amountFcfa: 5000,
      paidAmountFcfa: 5000,
      billingExamKind: null,
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: {
        reductionFcfa: 0,
        consultationFeeFcfa: 5000,
        assignedClinicService: { name: "Généraliste" },
        patient: { service: null },
        consultation: { clinicalNotes: null },
      },
      hospitalization: null,
    });
    assert.equal(label, "Généraliste");
  });

  it("classe les examens via billingExamKind", () => {
    const label = classifyInvoiceForDayClosure({
      id: "2",
      patientId: "p2",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 10000,
      paidAmountFcfa: 10000,
      billingExamKind: "echo",
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: null,
      hospitalization: null,
    });
    assert.equal(label, "Echographie");
  });

  it("classe la chirurgie sous le libellé photo", () => {
    const label = classifyInvoiceForDayClosure({
      id: "3",
      patientId: "p3",
      type: InvoiceType.SURGERY,
      amountFcfa: 20000,
      paidAmountFcfa: 20000,
      billingExamKind: null,
      surgeryCaseId: "s1",
      hospitalizationId: null,
      visit: null,
      hospitalization: null,
    });
    assert.equal(label, "Chirurgie");
  });
});
