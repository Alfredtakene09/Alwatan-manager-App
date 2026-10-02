import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceType } from "@prisma/client";
import {
  assembleDayClosureReceiptLines,
  classifyInvoiceForDayClosure,
  dayClosureCountedFcfa,
  type DayClosureInvoice,
} from "./day-closure-sales.js";

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

function receiptInvoice(overrides: Partial<DayClosureInvoice> & Pick<DayClosureInvoice, "id" | "type">): DayClosureInvoice {
  return {
    patientId: "p",
    amountFcfa: 5000,
    paidAmountFcfa: 5000,
    billingExamKind: null,
    surgeryCaseId: null,
    hospitalizationId: null,
    visit: null,
    hospitalization: null,
    ...overrides,
  };
}

describe("assembleDayClosureReceiptLines", () => {
  it("cumule les consultations et les opérations par service, sans le nom du patient", () => {
    const summary = assembleDayClosureReceiptLines([
      {
        collectedFcfa: 5000,
        invoice: receiptInvoice({
          id: "c1",
          type: InvoiceType.CONSULTATION,
          visit: {
            reductionFcfa: 0,
            consultationFeeFcfa: 5000,
            assignedClinicService: { name: "Généraliste" },
            patient: null,
            consultation: null,
          },
        }),
      },
      {
        collectedFcfa: 4000,
        invoice: receiptInvoice({
          id: "c2",
          type: InvoiceType.CONSULTATION,
          visit: {
            reductionFcfa: 0,
            consultationFeeFcfa: 4000,
            assignedClinicService: { name: "Généraliste" },
            patient: null,
            consultation: null,
          },
          amountFcfa: 4000,
          paidAmountFcfa: 4000,
        }),
      },
      {
        collectedFcfa: 50000,
        invoice: receiptInvoice({
          id: "o1",
          type: InvoiceType.SURGERY,
          amountFcfa: 50000,
          paidAmountFcfa: 50000,
          surgeryCaseId: "s1",
          surgeryCase: { interventionType: { clinicService: { name: "Orthopédie" } } },
        }),
      },
      {
        collectedFcfa: 70000,
        invoice: receiptInvoice({
          id: "o2",
          type: InvoiceType.SURGERY,
          amountFcfa: 70000,
          paidAmountFcfa: 70000,
          surgeryCaseId: "s2",
          patientId: "p-same",
          surgeryCase: { interventionType: { clinicService: { name: "Orthopédie" } } },
        }),
      },
    ]);

    assert.deepEqual(
      summary.serviceLines.map((line) => ({ label: line.label, qty: line.qty, totalFcfa: line.totalFcfa })),
      [
        { label: "Consultation — Généraliste", qty: 2, totalFcfa: 9000 },
        { label: "Opération — Orthopédie", qty: 2, totalFcfa: 120000 },
      ],
    );
    assert.equal(summary.collectedFcfa, 129000);
  });

  it("distingue une consultation Orthopédie d'une opération Orthopédie", () => {
    const summary = assembleDayClosureReceiptLines([
      {
        collectedFcfa: 5000,
        invoice: receiptInvoice({
          id: "c-ortho",
          type: InvoiceType.CONSULTATION,
          visit: {
            reductionFcfa: 0,
            consultationFeeFcfa: 5000,
            assignedClinicService: { name: "Orthopédie" },
            patient: null,
            consultation: null,
          },
        }),
      },
      {
        collectedFcfa: 80000,
        invoice: receiptInvoice({
          id: "o-ortho",
          type: InvoiceType.SURGERY,
          amountFcfa: 80000,
          paidAmountFcfa: 80000,
          surgeryCaseId: "s-ortho",
          surgeryCase: { interventionType: { clinicService: { name: "Orthopédie" } } },
        }),
      },
    ]);

    assert.deepEqual(
      summary.serviceLines.map((line) => line.label),
      ["Consultation — Orthopédie", "Opération — Orthopédie"],
    );
  });
});
