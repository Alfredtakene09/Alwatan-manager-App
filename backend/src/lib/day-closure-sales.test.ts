import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceType } from "@prisma/client";
import {
  assembleDayClosureReceiptLines,
  classifyInvoiceForDayClosure,
  consultationServiceName,
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

  it("laisse le second passage dans le service du médecin, pas dans l'ancien dossier", () => {
    const line = classifyInvoiceForDayClosure({
      id: "1b",
      patientId: "p1",
      type: InvoiceType.CONSULTATION,
      amountFcfa: 10000,
      paidAmountFcfa: 10000,
      billingExamKind: null,
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: {
        reductionFcfa: 0,
        consultationFeeFcfa: 10000,
        assignedClinicService: { name: "Généraliste" },
        patient: { service: "Pédiatrie" },
        consultation: { clinicalNotes: null },
      },
      hospitalization: null,
    });
    assert.deepEqual(line, { label: "Généraliste", group: "consultation" });
    assert.equal(
      consultationServiceName({
        visit: {
          assignedClinicService: null,
          patient: { service: "Pédiatrie" },
        },
      }),
      "Pédiatrie",
    );
    assert.equal(
      consultationServiceName({
        visit: {
          assignedClinicService: null,
          patient: { service: "Pédiatrie" },
          assignedDoctor: {
            employee: { clinicService: { name: "Généraliste" } },
          },
        },
      }),
      "Généraliste",
    );
    assert.equal(
      consultationServiceName({
        visit: {
          assignedClinicService: null,
          patient: { service: "Généraliste" },
          assignedDoctor: {
            employee: {
              clinicService: { name: "Orthopédie" },
              clinicServiceLinks: [
                { isDefault: true, clinicService: { name: "Orthopédie" } },
                { isDefault: false, clinicService: { name: "Généraliste" } },
              ],
            },
          },
        },
      }),
      "Généraliste",
    );
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

  it("range un examen externe spécialité dans « Examens »", () => {
    const line = classifyInvoiceForDayClosure({
      id: "ext-1",
      patientId: "p-ext",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 5000,
      paidAmountFcfa: 5000,
      billingExamKind: "specialty",
      surgeryCaseId: null,
      hospitalizationId: null,
      visit: {
        notes: "PATIENT_EXTERNE",
        reductionFcfa: 0,
        consultationFeeFcfa: null,
        assignedClinicService: null,
        patient: { service: null },
        consultation: { clinicalNotes: null },
      },
      hospitalization: null,
    });
    assert.deepEqual(line, { label: "Spécialité", group: "exam" });
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
    assert.deepEqual(line, { label: "Orthopédie & Tromatologie", group: "operation" });
  });

  it("corrige un acte nommé Ophtalmologie quand le dossier est Gynécologie", () => {
    const line = classifyInvoiceForDayClosure({
      id: "6",
      patientId: "p6",
      type: InvoiceType.SURGERY,
      amountFcfa: 75000,
      paidAmountFcfa: 75000,
      billingExamKind: null,
      surgeryCaseId: "s3",
      hospitalizationId: null,
      visit: {
        reductionFcfa: 0,
        consultationFeeFcfa: 0,
        notes: null,
        assignedClinicService: { name: "Ophtalmologie" },
        patient: { service: "Gynécologie" },
        consultation: { clinicalNotes: null },
      },
      hospitalization: null,
      surgeryCase: {
        interventionType: { label: "Ophtalmologie", clinicService: { name: "Ophtalmologie" } },
      },
    });
    assert.deepEqual(line, { label: "Gynécologie", group: "operation" });
  });

  it("garde Ophtalmologie pour un acte réel même si le dossier dit Gynécologie", () => {
    const line = classifyInvoiceForDayClosure({
      id: "7",
      patientId: "p7",
      type: InvoiceType.SURGERY,
      amountFcfa: 20000,
      paidAmountFcfa: 20000,
      billingExamKind: null,
      surgeryCaseId: "s4",
      hospitalizationId: null,
      visit: {
        reductionFcfa: 0,
        consultationFeeFcfa: 0,
        notes: null,
        assignedClinicService: { name: "Ophtalmologie" },
        patient: { service: "Gynécologie" },
        consultation: { clinicalNotes: null },
      },
      hospitalization: null,
      surgeryCase: {
        interventionType: { label: "Trichiasis", clinicService: { name: "Ophtalmologie" } },
      },
    });
    assert.deepEqual(line, { label: "Ophtalmologie", group: "operation" });
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
          patientId: "p-c1",
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
          patientId: "p-c2",
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
        { label: "Opération — Orthopédie & Tromatologie", qty: 2, totalFcfa: 120000 },
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
      ["Consultation — Orthopédie & Tromatologie", "Opération — Orthopédie & Tromatologie"],
    );
  });

  it("sépare quantité et montant quand le patient change de service", () => {
    const summary = assembleDayClosureReceiptLines([
      {
        collectedFcfa: 10000,
        invoice: receiptInvoice({
          id: "pedia",
          patientId: "pat-1",
          type: InvoiceType.CONSULTATION,
          amountFcfa: 10000,
          paidAmountFcfa: 10000,
          visit: {
            reductionFcfa: 0,
            consultationFeeFcfa: 10000,
            assignedClinicService: { name: "Pédiatrie" },
            patient: { service: "Pédiatrie" },
            consultation: null,
          },
        }),
      },
      {
        collectedFcfa: 10000,
        invoice: receiptInvoice({
          id: "general",
          patientId: "pat-1",
          type: InvoiceType.CONSULTATION,
          amountFcfa: 10000,
          paidAmountFcfa: 10000,
          visit: {
            reductionFcfa: 0,
            consultationFeeFcfa: 10000,
            assignedClinicService: null,
            patient: { service: "Pédiatrie" },
            consultation: null,
            assignedDoctor: {
              employee: { clinicService: { name: "Ophtalmologie" } },
            },
          },
        }),
      },
      {
        collectedFcfa: 10000,
        invoice: receiptInvoice({
          id: "other",
          patientId: "pat-2",
          type: InvoiceType.CONSULTATION,
          amountFcfa: 10000,
          paidAmountFcfa: 10000,
          visit: {
            reductionFcfa: 0,
            consultationFeeFcfa: 10000,
            assignedClinicService: { name: "Pédiatrie" },
            patient: { service: "Pédiatrie" },
            consultation: null,
          },
        }),
      },
    ]);

    assert.deepEqual(
      summary.serviceLines.map((line) => ({ label: line.label, qty: line.qty, totalFcfa: line.totalFcfa })),
      [
        { label: "Consultation — Pédiatrie", qty: 2, totalFcfa: 20000 },
        { label: "Consultation — Ophtalmologie", qty: 1, totalFcfa: 10000 },
      ],
    );
  });

  it("ne compte qu'une fois la consultation modifiée du même médecin", () => {
    const visit = {
      reductionFcfa: 0,
      consultationFeeFcfa: 10000,
      assignedClinicService: { name: "Orthopédie & Tromatologie" },
      patient: { service: "Orthopédie & Tromatologie" },
      consultation: null,
      assignedDoctor: { id: "dr-yakhoub" },
    };
    const summary = assembleDayClosureReceiptLines([
      {
        collectedFcfa: 10000,
        invoice: receiptInvoice({
          id: "first",
          patientId: "pat-ortho",
          type: InvoiceType.CONSULTATION,
          amountFcfa: 10000,
          paidAmountFcfa: 10000,
          visit,
        }),
      },
      {
        collectedFcfa: 10000,
        invoice: receiptInvoice({
          id: "second",
          patientId: "pat-ortho",
          type: InvoiceType.CONSULTATION,
          amountFcfa: 10000,
          paidAmountFcfa: 10000,
          visit,
        }),
      },
      {
        collectedFcfa: 10000,
        invoice: receiptInvoice({
          id: "other",
          patientId: "pat-other",
          type: InvoiceType.CONSULTATION,
          amountFcfa: 10000,
          paidAmountFcfa: 10000,
          visit: { ...visit, assignedDoctor: { id: "dr-yakhoub" } },
        }),
      },
    ]);

    assert.deepEqual(
      summary.serviceLines.map((line) => ({ label: line.label, qty: line.qty, totalFcfa: line.totalFcfa })),
      [{ label: "Consultation — Orthopédie & Tromatologie", qty: 2, totalFcfa: 20000 }],
    );
  });
});
