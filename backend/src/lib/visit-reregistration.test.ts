import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { VisitStatus } from "@prisma/client";
import { reregistrationRequired, type ReregistrationVisit } from "./visit-reregistration.js";

function visit(overrides: Partial<ReregistrationVisit> = {}): ReregistrationVisit {
  return {
    status: VisitStatus.COMPLETED,
    notes: null,
    assignedDoctorId: "doc-1",
    consultation: {
      clinicalNotes: "Examens prescrits (examen) : NFS",
      completedAt: null,
      labSentToLabAt: null,
    },
    ...overrides,
  };
}

describe("reregistrationRequired", () => {
  it("relance la consultation quand le service change", () => {
    assert.equal(
      reregistrationRequired({
        visit: visit(),
        previousService: "Interne",
        nextService: "Pédiatrie",
        nextDoctorId: "doc-1",
      }),
      true,
    );
  });

  it("relance la consultation quand le médecin change", () => {
    assert.equal(
      reregistrationRequired({
        visit: visit(),
        previousService: "Interne",
        nextService: "interne",
        nextDoctorId: "doc-2",
      }),
      true,
    );
  });

  it("ne change rien si seuls le nom ou d'autres champs sont modifiés", () => {
    assert.equal(
      reregistrationRequired({
        visit: visit(),
        previousService: "Interne",
        nextService: " interne ",
        nextDoctorId: "doc-1",
      }),
      false,
    );
    assert.equal(
      reregistrationRequired({ visit: visit(), previousService: "Interne" }),
      false,
    );
  });

  it("ignore une visite encore en attente sans travail du médecin", () => {
    assert.equal(
      reregistrationRequired({
        visit: visit({ status: VisitStatus.WAITING_CONSULTATION, consultation: null }),
        previousService: "Interne",
        nextService: "Pédiatrie",
      }),
      false,
    );
  });

  it("ignore l'absence de visite", () => {
    assert.equal(
      reregistrationRequired({ visit: null, previousService: "A", nextService: "B" }),
      false,
    );
  });
});
