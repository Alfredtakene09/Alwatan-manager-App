import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsultationQuotaMode, DoctorCompensationType, InvoiceType, UserRole } from "@prisma/client";
import {
  consultationShare,
  consultationTariffAmount,
  operationActName,
  registrationServiceLabel,
  operationShare,
  ORTHO_TRAUMA_SERVICE,
  registrationExamQuantity,
  registrationLineIdentity,
} from "./registration-summary.js";

type ShareInvoice = Parameters<typeof operationShare>[0];

function david() {
  return {
    role: UserRole.MEDECIN,
    employee: {
      isMedecin: true,
      doctorCompensationType: DoctorCompensationType.QUOTA as DoctorCompensationType,
      consultationQuotaMode: ConsultationQuotaMode.PERCENT,
      consultationQuotaPercent: 50,
      consultationQuotaFcfa: null,
      consultationTotalFcfa: null as number | null,
      surgeryQuotaPercent: 30 as number | null,
    },
  };
}

describe("parts médecin à l'export", () => {
  it("applique 50 % du médecin sur le montant de consultation", () => {
    const invoice = {
      visit: {
        consultation: { doctor: david() },
        assignedDoctor: null,
      },
    } as ShareInvoice;
    const share = consultationShare(invoice, 20_000);
    assert.equal(share.percent, 50);
    assert.equal(share.shareFcfa, 10_000);
  });

  it("applique 30 % du médecin sur le montant d'opération, pas le % du catalogue", () => {
    const invoice = {
      visit: null,
      surgeryCase: {
        surgeon: david(),
        surgeonShareFcfa: 70_000,
        totalCostFcfa: 100_000,
        interventionType: { surgeonPercent: 70, clinicService: null },
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 100_000);
    assert.equal(share.percent, 30);
    assert.equal(share.shareFcfa, 30_000);
  });

  it("reprend le % chirurgie mis à jour même si le médecin n'est pas en quota", () => {
    const surgeon = david();
    surgeon.employee.doctorCompensationType = DoctorCompensationType.FIXED_SALARY;
    surgeon.employee.surgeryQuotaPercent = 30;
    const invoice = {
      visit: null,
      surgeryCase: {
        surgeon,
        surgeonShareFcfa: 70_000,
        totalCostFcfa: 100_000,
        interventionType: { surgeonPercent: 70, clinicService: null },
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 100_000);
    assert.equal(share.percent, 30);
    assert.equal(share.shareFcfa, 30_000);
  });

  it("reprend le % du catalogue quand la fiche n'a pas de taux chirurgie", () => {
    const surgeon = david();
    surgeon.employee.surgeryQuotaPercent = null;
    const invoice = {
      visit: null,
      surgeryCase: {
        surgeon,
        surgeonPercent: null,
        surgeonShareFcfa: 0,
        totalCostFcfa: 0,
        interventionType: { surgeonPercent: 70, clinicService: null },
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 375_000);
    assert.equal(share.percent, 70);
    assert.equal(share.shareFcfa, 262_500);
  });

  it("applique le % enregistré sur l'opération, même s'il diffère de la fiche", () => {
    const invoice = {
      visit: null,
      surgeryCase: {
        surgeon: david(),
        surgeonPercent: 40,
        surgeonShareFcfa: 70_000,
        totalCostFcfa: 100_000,
        interventionType: { surgeonPercent: 70, clinicService: null },
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 100_000);
    assert.equal(share.percent, 40);
    assert.equal(share.shareFcfa, 40_000);
  });

  it("applique le % opération au montant encaissé, pas à la part stockée du dossier", () => {
    const invoice = {
      visit: null,
      surgeryCase: {
        surgeon: david(),
        surgeonShareFcfa: 30_000,
        totalCostFcfa: 100_000,
        interventionType: { surgeonPercent: 30, clinicService: null },
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 40_000);
    assert.equal(share.percent, 30);
    assert.equal(share.shareFcfa, 12_000);
  });

  it("remplace le montant encaissé par le prix de consultation actuel", () => {
    const doctor = david();
    doctor.employee.consultationTotalFcfa = 20_000;
    const invoice = {
      type: InvoiceType.CONSULTATION,
      visit: {
        reductionFcfa: 0,
        consultation: { doctor },
        assignedDoctor: null,
      },
    } as ShareInvoice;
    assert.equal(consultationTariffAmount(invoice, 5_000), 20_000);
  });

  it("conserve une réduction et ignore les lignes qui ne sont pas une consultation", () => {
    const doctor = david();
    doctor.employee.consultationTotalFcfa = 20_000;
    const invoice = {
      type: InvoiceType.CONSULTATION,
      visit: {
        reductionFcfa: 2_000,
        consultation: { doctor },
        assignedDoctor: null,
      },
    } as ShareInvoice;
    assert.equal(consultationTariffAmount(invoice, 5_000), 18_000);
    const exam = { ...invoice, type: InvoiceType.LAB_EXAM } as ShareInvoice;
    assert.equal(consultationTariffAmount(exam, 5_000), 5_000);
  });

  it("retient le montant modifié sur la ligne, pas l'ancien tarif de la fiche", () => {
    const doctor = david();
    doctor.employee.consultationTotalFcfa = 20_000;
    const invoice = {
      type: InvoiceType.CONSULTATION,
      visit: {
        consultationFeeFcfa: 8_000,
        reductionFcfa: 0,
        consultation: { doctor },
        assignedDoctor: null,
      },
    } as ShareInvoice;
    assert.equal(consultationTariffAmount(invoice, 20_000), 8_000);
  });

  it("place la consultation dans le service modifié du dossier", () => {
    assert.equal(registrationServiceLabel("consultation", "Pédiatrie", "Gynécologie"), "Gynécologie");
    assert.equal(registrationServiceLabel("operation", "Ophtalmologie", "Gynécologie"), "Ophtalmologie");
  });
});

describe("lignes d'opérations à l'export", () => {
  it("détaille chaque opération avec le service et l'acte entre parenthèses", () => {
    const cesarienne = registrationLineIdentity({
      group: "operation",
      serviceLabel: "Gynécologie",
      operationName: "Césarienne",
      invoiceId: "inv-1",
    });
    const autre = registrationLineIdentity({
      group: "operation",
      serviceLabel: "Gynécologie",
      operationName: "Césarienne",
      invoiceId: "inv-2",
    });
    assert.equal(cesarienne.service, "Gynécologie (Césarienne)");
    assert.notEqual(cesarienne.key, autre.key);
  });

  it("nomme orthopédie et traumatologie ensemble, avec l'acte entre parenthèses", () => {
    const ortho = registrationLineIdentity({
      group: "operation",
      serviceLabel: "ORTHOPEDIE",
      operationName: "Prothèse",
      invoiceId: "inv-o",
    });
    const trauma = registrationLineIdentity({
      group: "operation",
      serviceLabel: "Tromatologie",
      operationName: "Prothèse",
      invoiceId: "inv-t",
    });
    const fracture = registrationLineIdentity({
      group: "operation",
      serviceLabel: "Traumatologie",
      operationName: "Fracture",
      invoiceId: "inv-f",
    });
    assert.equal(ortho.service, `${ORTHO_TRAUMA_SERVICE} (Prothèse)`);
    assert.equal(trauma.service, `${ORTHO_TRAUMA_SERVICE} (Prothèse)`);
    assert.equal(ortho.key, trauma.key);
    assert.equal(fracture.service, `${ORTHO_TRAUMA_SERVICE} (Fracture)`);
    assert.notEqual(ortho.key, fracture.key);
  });

  it("laisse les consultations cumulées par service", () => {
    const line = registrationLineIdentity({
      group: "consultation",
      serviceLabel: "Gynécologie",
      operationName: null,
      invoiceId: "inv-c",
    });
    assert.equal(line.service, "Gynécologie");
    assert.equal(line.key, "consultation\u0000Gynécologie");
  });

  it("fusionne les consultations orthopédie et traumatologie", () => {
    const ortho = registrationLineIdentity({
      group: "consultation",
      serviceLabel: "Orthopédie",
      operationName: null,
      invoiceId: "inv-co",
    });
    const trauma = registrationLineIdentity({
      group: "consultation",
      serviceLabel: "Tromatologie",
      operationName: null,
      invoiceId: "inv-ct",
    });
    assert.equal(ortho.service, ORTHO_TRAUMA_SERVICE);
    assert.equal(trauma.service, ORTHO_TRAUMA_SERVICE);
    assert.equal(ortho.key, trauma.key);
  });

  it("compte chaque examen de radiologie, pas la ligne", () => {
    const qty = registrationExamQuantity({
      billingExamKind: "radio",
      visit: {
        consultation: {
          clinicalNotes: "Examens prescrits (Radio) : Cheville, Pied",
        },
      },
    });
    assert.equal(qty, 2);
  });

  it("laisse une consultation hors du décompte des examens", () => {
    assert.equal(registrationExamQuantity({ billingExamKind: null, visit: null }), null);
  });

  it("prend le libellé du catalogue, puis la prescription", () => {
    const catalog = operationActName({
      surgeryCase: { interventionType: { label: "  Appendicectomie  " } },
      visit: null,
    } as Parameters<typeof operationActName>[0]);
    assert.equal(catalog, "Appendicectomie");
  });
});
