import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceType } from "@prisma/client";
import { classifyInvoiceForDayClosure, dayClosureCountedFcfa } from "./day-closure-sales.js";

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

  it("réserve la section « Examens » au laboratoire", () => {
    const line = classifyInvoiceForDayClosure({
      id: "2",
      patientId: "p2",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 10000,
      paidAmountFcfa: 10000,
      billingExamKind: "examen",
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: null,
      hospitalization: null,
    });
    assert.deepEqual(line, { label: "Laboratoire", group: "exam" });
  });

  it("bascule échographie et radiologie dans « Autres »", () => {
    const base = {
      patientId: "p3",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 10000,
      paidAmountFcfa: 10000,
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: null,
      hospitalization: null,
    };
    assert.deepEqual(
      classifyInvoiceForDayClosure({ ...base, id: "3", billingExamKind: "echo" }),
      { label: "Echographie", group: "other" },
    );
    assert.deepEqual(
      classifyInvoiceForDayClosure({ ...base, id: "4", billingExamKind: "radio" }),
      { label: "Radiologie", group: "other" },
    );
  });

  it("garde spécialité et odontologie dans « Consultations »", () => {
    const base = {
      patientId: "p5",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 8000,
      paidAmountFcfa: 8000,
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: null,
      hospitalization: null,
    };
    assert.deepEqual(
      classifyInvoiceForDayClosure({ ...base, id: "5", billingExamKind: "specialty" }),
      { label: "Spécialité", group: "consultation" },
    );
    assert.deepEqual(
      classifyInvoiceForDayClosure({ ...base, id: "6", billingExamKind: "odonto" }),
      { label: "Odontologie", group: "consultation" },
    );
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

describe("dayClosureCountedFcfa", () => {
  it("compte l'hospitalisation encaissée même si paidAmountFcfa est à 0", () => {
    assert.equal(
      dayClosureCountedFcfa({ amountFcfa: 150000, paidAmountFcfa: 0 }, 150000),
      150000,
    );
  });

  it("plafonne un versement au montant déjà enregistré", () => {
    assert.equal(
      dayClosureCountedFcfa({ amountFcfa: 10000, paidAmountFcfa: 5000 }, 10000),
      5000,
    );
  });
});
