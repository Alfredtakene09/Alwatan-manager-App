import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PatientCategory } from "@prisma/client";
import {
  buildPrescribedExamsNotesByKind,
  hasUnpaidCashierQueueExams,
  labsPendingApprovalWhere,
} from "./lab-notes.js";

describe("file d'attente paiement examens", () => {
  it("inclut STANDARD et ONG (comme la file médecin « en paiement »)", () => {
    const where = labsPendingApprovalWhere();
    const visitAnd = where.visit.AND as Array<Record<string, unknown>>;
    assert.deepEqual(visitAnd[0], {
      patient: {
        category: { in: [PatientCategory.STANDARD, PatientCategory.ONG] },
      },
    });
  });

  it("n'exclut pas les visites dont les notes sont nulles (SQL NOT LIKE ignore les NULL)", () => {
    const where = labsPendingApprovalWhere();
    const visitAnd = where.visit.AND as Array<{ OR?: unknown }>;
    assert.deepEqual(visitAnd[1], {
      OR: [
        { notes: null },
        { NOT: { notes: { contains: "PATIENT_EXTERNE" } } },
      ],
    });
  });

  it("exclut les visites annulées de la file d'attente paiement", () => {
    const where = labsPendingApprovalWhere();
    const visitAnd = where.visit.AND as Array<Record<string, unknown>>;
    assert.deepEqual(visitAnd[2], { status: { not: "CANCELLED" } });
  });

  it("reconnaît une prescription laboratoire comme encaissable à la caisse", () => {
    const notes = buildPrescribedExamsNotesByKind({ examen: ["NFS"] });
    assert.equal(hasUnpaidCashierQueueExams(notes), true);
  });
});
