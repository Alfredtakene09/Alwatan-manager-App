import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VisitStatus } from "@prisma/client";
import { buildMedicalHistoryEntry, classifyVisitAction } from "./patient-medical-record.js";

const otherDoctorVisit = {
  id: "visit-1",
  createdAt: new Date("2026-01-01T10:00:00Z"),
  updatedAt: new Date("2026-01-01T10:00:00Z"),
  status: VisitStatus.COMPLETED,
  consultation: {
    doctorId: "doctor-a",
    clinicalNotes: "Examens prescrits (Laboratoire) : NFS",
    doctorComment: "Conduite A",
    diagnosis: "Paludisme",
    completedAt: new Date("2026-01-01T10:00:00Z"),
    updatedAt: new Date("2026-01-01T10:00:00Z"),
    doctor: { firstName: "Amadou", lastName: "Diallo" },
  },
};

describe("classifyVisitAction", () => {
  it("classe une visite sans acte chirurgical en consultation", () => {
    assert.deepEqual(classifyVisitAction({ prescribedOperations: [] }), {
      action: "consultation",
      detail: null,
    });
  });

  it("classe une opération du bloc ou prescrite", () => {
    assert.deepEqual(classifyVisitAction({ surgeryLabel: "Appendicectomie" }), {
      action: "operation",
      detail: "Appendicectomie",
    });
    assert.deepEqual(
      classifyVisitAction({ prescribedOperations: ["Petite chirurgie"] }),
      { action: "operation", detail: "Petite chirurgie" },
    );
  });
});

describe("buildMedicalHistoryEntry — dossier partagé", () => {
  it("masque le diagnostic d’un autre médecin sans droit élargi", () => {
    const entry = buildMedicalHistoryEntry(otherDoctorVisit, {
      viewerDoctorId: "doctor-b",
      canViewAllClinicalDetails: false,
    });
    assert.equal(entry?.diagnosis, null);
    assert.equal(entry?.doctorComment, null);
  });

  it("expose tout l’historique au médecin lié au patient", () => {
    const entry = buildMedicalHistoryEntry(otherDoctorVisit, {
      viewerDoctorId: "doctor-b",
      canViewAllClinicalDetails: true,
    });
    assert.equal(entry?.diagnosis, "Paludisme");
    assert.equal(entry?.doctorComment, "Conduite A");
    assert.equal(entry?.doctor?.lastName, "Diallo");
  });
});
