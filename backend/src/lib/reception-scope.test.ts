import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRole, VisitStatus } from "@prisma/client";
import {
  patientsInDoctorScopeWhere,
  otherReceptionistsUntreatedPatientsWhere,
  receptionistOwnPatientsWhere,
  receptionistOwnVisitsWhere,
  registrationSummaryInvoiceWhere,
  registrationSummaryReceptionistWhere,
} from "./reception-scope.js";

describe("périmètre réceptionniste", () => {
  it("isole les dossiers du réceptionniste (listes patients / CA perso)", () => {
    const where = receptionistOwnVisitsWhere({ id: "rec-1", role: UserRole.RECEPTIONNISTE });
    assert.deepEqual(where, {
      OR: [
        { patient: { createdById: "rec-1" } },
        { invoices: { some: { issuedById: "rec-1" } } },
      ],
    });
  });

  it("sans exclusion, liste tous les réceptionnistes encore en attente", () => {
    const since = new Date("2026-10-15T10:00:00.000Z");
    const where = otherReceptionistsUntreatedPatientsWhere(null, since);
    assert.equal(Object.hasOwn(where, "createdById"), false);
    assert.deepEqual(where.createdAt, { gte: since });
    assert.deepEqual(where.createdBy, { role: UserRole.RECEPTIONNISTE });
  });

  it("liste les patients des autres réceptionnistes pas encore vus par le médecin", () => {
    const since = new Date("2026-10-15T10:00:00.000Z");
    const where = otherReceptionistsUntreatedPatientsWhere("rec-1", since);
    assert.deepEqual(where, {
      createdById: { not: "rec-1" },
      createdAt: { gte: since },
      createdBy: { role: UserRole.RECEPTIONNISTE },
      visits: {
        some: {
          status: { in: [VisitStatus.WAITING_CONSULTATION, VisitStatus.IN_CONSULTATION] },
          OR: [
            { notes: null },
            { NOT: { notes: { contains: "PATIENT_EXTERNE" } } },
          ],
        },
      },
    });
  });

  it("inclut les dossiers réenregistrés (facture émise par le réceptionniste)", () => {
    const where = receptionistOwnPatientsWhere({ id: "rec-1", role: UserRole.RECEPTIONNISTE });
    assert.deepEqual(where, {
      OR: [
        { createdById: "rec-1" },
        { invoices: { some: { issuedById: "rec-1" } } },
      ],
    });
  });

  it("inclut les patients du service du médecin, pas seulement ses visites", () => {
    const where = patientsInDoctorScopeWhere("doc-1", ["Généraliste"], ["svc-1"]);
    assert.deepEqual(where, {
      OR: [
        { visits: { some: { assignedDoctorId: "doc-1" } } },
        { visits: { some: { consultation: { is: { doctorId: "doc-1" } } } } },
        { service: { in: ["Généraliste"] } },
        { visits: { some: { assignedClinicServiceId: { in: ["svc-1"] } } } },
      ],
    });
  });

  it("attribue chaque facture du cumul à une seule réception", () => {
    const where = registrationSummaryReceptionistWhere("rec-1");
    assert.deepEqual(where, {
      OR: [
        { issuedById: "rec-1" },
        {
          patient: { createdById: "rec-1" },
          issuedBy: { role: { not: UserRole.RECEPTIONNISTE } },
        },
      ],
    });
  });

  it("met l'opération et l'examen encaissés sur le dernier réceptionniste, le jour du paiement", () => {
    const from = new Date("2026-10-10T00:00:00+01:00");
    const to = new Date("2026-10-11T00:00:00+01:00");
    const where = registrationSummaryInvoiceWhere({
      patientWhere: { active: true, createdAt: { gte: from, lt: to }, service: "Généraliste" },
      receptionistId: "rec-1",
      period: { from, to },
    });
    const collected = where.OR as Array<{
      OR?: Array<{ AND?: unknown[] }>;
    }>;
    const branches = collected[1]?.OR;
    assert.ok(branches);
    assert.deepEqual(branches[0]?.AND?.[0], {
      OR: [{ type: "SURGERY" }, { billingExamKind: "operation" }],
    });
    assert.deepEqual(branches[1]?.AND, [
      { billingExamKind: { in: ["examen", "radio", "echo", "odonto"] } },
      { paidAt: { gte: from, lt: to } },
      { payments: { some: { recordedBy: { role: UserRole.RECEPTIONNISTE } } } },
      { issuedById: "rec-1" },
    ]);
  });

  it("n'isole pas gestionnaire / direction / admin", () => {
    const where = receptionistOwnVisitsWhere({ id: "admin-1", role: UserRole.ADMIN });
    assert.deepEqual(where, {});
  });
});
