import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceType } from "@prisma/client";
import { classifyInvoiceForDayClosure } from "./day-closure-sales.js";

describe("classifyInvoiceForDayClosure", () => {
  it("classe les consultations par service clinique", () => {
    const line = classifyInvoiceForDayClosure({
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
    assert.deepEqual(line, { label: "Généraliste", group: "consultation" });
  });

  it("classe les examens via billingExamKind", () => {
    const line = classifyInvoiceForDayClosure({
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
    assert.deepEqual(line, { label: "Echographie", group: "exam" });
  });

  it("classe une opération du bloc sous le service du type d'intervention", () => {
    const line = classifyInvoiceForDayClosure({
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
      surgeryCase: { interventionType: { clinicService: { name: "Gynécologie" } } },
    });
    assert.deepEqual(line, { label: "Gynécologie", group: "operation" });
  });

  it("classe une opération hors bloc avec le service de la visite", () => {
    const line = classifyInvoiceForDayClosure({
      id: "4",
      patientId: "p4",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 50000,
      paidAmountFcfa: 50000,
      billingExamKind: "operation",
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: {
        reductionFcfa: 0,
        consultationFeeFcfa: 0,
        assignedClinicService: { name: "Traumatologie" },
        patient: { service: null },
        consultation: { clinicalNotes: null },
      },
      hospitalization: null,
    });
    assert.deepEqual(line, { label: "Traumatologie", group: "operation" });
  });

  it("retombe sur « Chirurgie » quand aucun service n'est rattaché", () => {
    const line = classifyInvoiceForDayClosure({
      id: "5",
      patientId: "p5",
      type: InvoiceType.SURGERY,
      amountFcfa: 20000,
      paidAmountFcfa: 20000,
      billingExamKind: null,
      surgeryCaseId: "s2",
      hospitalizationId: null,
      visit: null,
      hospitalization: null,
    });
    assert.deepEqual(line, { label: "Chirurgie", group: "operation" });
  });
});
