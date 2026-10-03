import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRole } from "@prisma/client";
import {
  patientsInDoctorScopeWhere,
  receptionistOwnPatientsWhere,
  receptionistOwnVisitsWhere,
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

  it("n'isole pas gestionnaire / direction / admin", () => {
    const where = receptionistOwnVisitsWhere({ id: "admin-1", role: UserRole.ADMIN });
    assert.deepEqual(where, {});
  });
});
