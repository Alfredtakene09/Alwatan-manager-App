import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRole } from "@prisma/client";
import {
  patientsInDoctorScopeWhere,
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

  it("met l'opération encaissée sur le réceptionniste qui a encaissé, le jour du paiement", () => {
    const from = new Date("2026-10-10T00:00:00+01:00");
    const to = new Date("2026-10-11T00:00:00+01:00");
    const where = registrationSummaryInvoiceWhere({
      patientWhere: { active: true, createdAt: { gte: from, lt: to }, service: "Généraliste" },
      receptionistId: "rec-1",
      period: { from, to },
    });
    const collected = (where.OR as { AND?: unknown[] }[])[1];
    assert.ok(collected);
    assert.deepEqual(collected, {
      type: { in: ["CONSULTATION", "LAB_EXAM", "SURGERY", "HOSPITALIZATION_DEPOSIT", "HOSPITALIZATION_FINAL"] },
      status: { not: "CANCELLED" },
      patient: { active: true, service: "Généraliste" },
      AND: [
        { OR: [{ type: "SURGERY" }, { billingExamKind: "operation" }] },
        {
          OR: [
            {
              paidAt: { gte: from, lt: to },
              payments: {
                some: {
                  recordedBy: { role: UserRole.RECEPTIONNISTE },
                  recordedById: "rec-1",
                },
              },
            },
            {
              paidAt: null,
              payments: {
                some: {
                  recordedBy: { role: UserRole.RECEPTIONNISTE },
                  recordedById: "rec-1",
                  paidAt: { gte: from, lt: to },
                },
              },
            },
          ],
        },
      ],
    });
  });

  it("n'isole pas gestionnaire / direction / admin", () => {
    const where = receptionistOwnVisitsWhere({ id: "admin-1", role: UserRole.ADMIN });
    assert.deepEqual(where, {});
  });
});
