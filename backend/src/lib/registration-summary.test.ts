import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsultationQuotaMode, DoctorCompensationType, InvoiceStatus, InvoiceType, UserRole } from "@prisma/client";
import {
  consultationShare,
  consultationTariffAmount,
  exactRegistrationService,
  operationActName,
  operationLineLabel,
  registrationActivityPatientCounts,
  registrationServiceLabel,
  operationShare,
  ORTHO_TRAUMA_SERVICE,
  registrationExamQuantity,
  registrationLineIdentity,
  registrationDoctorPercent,
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

  it("recalcule la part du médecin affecté même si la facture est déjà encaissée", () => {
    const previousDoctor = david();
    const currentDoctor = david();
    previousDoctor.employee.consultationQuotaPercent = 80;
    currentDoctor.employee.consultationQuotaPercent = 25;
    const invoice = {
      type: InvoiceType.CONSULTATION,
      amountFcfa: 20_000,
      paidAmountFcfa: 20_000,
      status: InvoiceStatus.PAID,
      visit: {
        consultationFeeFcfa: 20_000,
        reductionFcfa: 0,
        assignedDoctor: currentDoctor,
        consultation: { doctor: previousDoctor },
      },
    } as ShareInvoice;

    const billedAmount = consultationTariffAmount(invoice, invoice.amountFcfa);
    const share = consultationShare(invoice, billedAmount);
    assert.equal(share.percent, 25);
    assert.equal(share.shareFcfa, 5_000);
  });

  it("n'attribue pas de quota consultation à un médecin salarié fixe", () => {
    const doctor = david();
    doctor.employee.doctorCompensationType = DoctorCompensationType.FIXED_SALARY;
    const invoice = {
      visit: { assignedDoctor: doctor, consultation: null },
    } as ShareInvoice;

    assert.deepEqual(consultationShare(invoice, 20_000), { shareFcfa: 0, percent: null });
  });

  it("calcule un taux effectif lorsque plusieurs taux sont regroupés par service", () => {
    assert.equal(registrationDoctorPercent(17_500, 30_000), 58);
    assert.equal(registrationDoctorPercent(15_000, 20_000), 75);
    assert.equal(registrationDoctorPercent(0, 0), null);
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

  it("ajoute les 11 % de l'anesthésiste à la part des médecins", () => {
    const invoice = {
      visit: null,
      surgeryCase: {
        surgeon: david(),
        surgeonPercent: 30,
        surgeonShareFcfa: 30_000,
        totalCostFcfa: 100_000,
        interventionType: {
          surgeonPercent: 30,
          anesthesiologistPercent: 11,
          anesthesiologistName: "AWAD",
          clinicService: null,
        },
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 130_000);
    assert.equal(share.percent, 41);
    assert.equal(share.shareFcfa, 53_300);
  });

  it("reprend le % fiche de l'anesthésiste quand l'acte n'a pas de taux", () => {
    const invoice = {
      visit: null,
      surgeryCase: {
        surgeon: david(),
        surgeonPercent: 30,
        surgeonShareFcfa: 30_000,
        totalCostFcfa: 100_000,
        interventionType: {
          surgeonPercent: 30,
          anesthesiologistPercent: 0,
          anesthesiologist: {
            role: UserRole.MEDECIN,
            firstName: "MHT",
            lastName: "AWAD",
            employee: {
              isMedecin: true,
              doctorCompensationType: DoctorCompensationType.QUOTA,
              consultationQuotaMode: ConsultationQuotaMode.PERCENT,
              consultationQuotaPercent: null,
              consultationQuotaFcfa: null,
              consultationTotalFcfa: null,
              surgeryQuotaPercent: 11,
            },
          },
          clinicService: null,
        },
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 100_000);
    assert.equal(share.percent, 41);
    assert.equal(share.shareFcfa, 41_000);
  });

  it("ajoute l'anesthésiste du catalogue quand l'opération n'a pas de dossier bloc", () => {
    const invoice = {
      visit: {
        assignedDoctor: david(),
        consultation: { doctor: david() },
      },
      surgeryCase: null,
      catalogOperation: {
        surgeonPercent: 30,
        anesthesiologistPercent: 11,
        anesthesiologistName: "AWAD",
        anesthesiologist: null,
      },
    } as ShareInvoice;
    const share = operationShare(invoice, 250_000);
    assert.equal(share.percent, 41);
    assert.equal(share.shareFcfa, 102_500);
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

  it("rattache une opération au service enregistré quand l'acte n'est que le nom d'un autre service", () => {
    assert.equal(
      exactRegistrationService({
        group: "operation",
        classifiedLabel: "Ophtalmologie",
        recordedService: "Gynécologie",
        operationName: "Ophtalmologie",
      }),
      "Gynécologie",
    );
    assert.equal(
      exactRegistrationService({
        group: "operation",
        classifiedLabel: "Ophtalmologie",
        recordedService: "Gynécologie",
        operationName: "Trichiasis",
      }),
      "Ophtalmologie",
    );
    assert.equal(operationLineLabel("Gynécologie", "Gynécologie"), "Gynécologie");
    assert.equal(operationLineLabel("Gynécologie", "Césarienne"), "Gynécologie (Césarienne)");
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
    assert.equal(cesarienne.serviceName, "Gynécologie");
    assert.equal(cesarienne.operationName, "Césarienne");
    assert.notEqual(cesarienne.key, autre.key);
  });

  it("fusionne orthopédie et traumatologie, toutes opérations confondues", () => {
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
    assert.equal(ORTHO_TRAUMA_SERVICE, "Orthopédie & Tromatologie");
    assert.equal(ortho.service, "Orthopédie & Tromatologie");
    assert.equal(ortho.serviceName, "Orthopédie & Tromatologie");
    assert.equal(ortho.operationName, null);
    assert.equal(trauma.service, ortho.service);
    assert.equal(fracture.service, ortho.service);
    assert.equal(ortho.key, trauma.key);
    assert.equal(ortho.key, fracture.key);
  });

  it("laisse les consultations cumulées par service", () => {
    const line = registrationLineIdentity({
      group: "consultation",
      serviceLabel: "Gynécologie",
      operationName: null,
      invoiceId: "inv-c",
    });
    assert.equal(line.service, "Gynécologie");
    assert.equal(line.serviceName, "Gynécologie");
    assert.equal(line.operationName, null);
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

  it("ne compte que les examens déjà facturés quand la prescription en contient d'autres", () => {
    const qty = registrationExamQuantity({
      billingExamKind: "examen",
      visit: {
        consultation: {
          clinicalNotes: [
            "Examens prescrits (Laboratoire) : NFS, Glycémie",
            "Examens facturés (Laboratoire) : NFS",
          ].join("\n"),
        },
      },
    });
    assert.equal(qty, 1);
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

describe("cartes d'enregistrement", () => {
  const invoice = (partial: Record<string, unknown>) =>
    partial as Parameters<typeof registrationActivityPatientCounts>[0][number];

  it("compte une facture dans une seule carte et ignore un montant nul", () => {
    const counts = registrationActivityPatientCounts([
      invoice({
        patientId: "pat-op",
        type: InvoiceType.LAB_EXAM,
        amountFcfa: 275_000,
        billingExamKind: "operation",
        surgeryCaseId: "case-1",
        hospitalizationId: null,
        visit: null,
        hospitalization: null,
      }),
      invoice({
        patientId: "pat-op",
        type: InvoiceType.LAB_EXAM,
        amountFcfa: 10_000,
        billingExamKind: "examen",
        surgeryCaseId: null,
        hospitalizationId: null,
        visit: null,
        hospitalization: null,
      }),
      invoice({
        patientId: "pat-radio",
        type: InvoiceType.LAB_EXAM,
        amountFcfa: 10_000,
        billingExamKind: "radio",
        surgeryCaseId: null,
        hospitalizationId: null,
        visit: null,
        hospitalization: null,
      }),
      invoice({
        patientId: "pat-consult",
        type: InvoiceType.CONSULTATION,
        amountFcfa: 5_000,
        billingExamKind: null,
        surgeryCaseId: null,
        hospitalizationId: null,
        visit: { consultationFeeFcfa: 5_000, reductionFcfa: 0, consultation: null },
        hospitalization: null,
      }),
      invoice({
        patientId: "pat-empty",
        type: InvoiceType.CONSULTATION,
        amountFcfa: 0,
        billingExamKind: null,
        surgeryCaseId: null,
        hospitalizationId: null,
        visit: null,
        hospitalization: null,
      }),
      invoice({
        patientId: "pat-hosp",
        type: InvoiceType.HOSPITALIZATION_FINAL,
        amountFcfa: 20_000,
        billingExamKind: null,
        surgeryCaseId: null,
        hospitalizationId: "stay-1",
        visit: null,
        hospitalization: { reductionFcfa: 0 },
      }),
    ]);

    assert.deepEqual(counts, {
      consultationPatients: 1,
      operationPatients: 1,
      examPatients: 2,
      hospitalizationPatients: 1,
    });
  });

  it("ignore un examen qui n'est pas payé", () => {
    const counts = registrationActivityPatientCounts([
      invoice({
        patientId: "pat-unpaid",
        type: InvoiceType.LAB_EXAM,
        status: InvoiceStatus.PENDING,
        amountFcfa: 8_000,
        paidAmountFcfa: 0,
        billingExamKind: "examen",
        surgeryCaseId: null,
        hospitalizationId: null,
        visit: null,
        hospitalization: null,
      }),
      invoice({
        patientId: "pat-paid",
        type: InvoiceType.LAB_EXAM,
        status: InvoiceStatus.PAID,
        amountFcfa: 8_000,
        paidAmountFcfa: 8_000,
        billingExamKind: "examen",
        surgeryCaseId: null,
        hospitalizationId: null,
        visit: null,
        hospitalization: null,
      }),
    ]);
    assert.equal(counts.examPatients, 1);
  });
});
