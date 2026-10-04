import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConsultationQuotaMode, DoctorCompensationType, UserRole } from "@prisma/client";
import { consultationShare, operationShare } from "./registration-summary.js";

type ShareInvoice = Parameters<typeof operationShare>[0];

function david() {
  return {
    role: UserRole.MEDECIN,
    employee: {
      isMedecin: true,
      doctorCompensationType: DoctorCompensationType.QUOTA,
      consultationQuotaMode: ConsultationQuotaMode.PERCENT,
      consultationQuotaPercent: 50,
      consultationQuotaFcfa: null,
      surgeryQuotaPercent: 30,
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
});
