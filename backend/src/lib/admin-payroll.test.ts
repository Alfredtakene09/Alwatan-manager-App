import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DoctorCompensationType } from "@prisma/client";
import { listEligiblePayrollEmployees } from "./admin-payroll.js";

describe("listEligiblePayrollEmployees", () => {
  it("exclut un employé dont le compte application est désactivé", () => {
    const rows = listEligiblePayrollEmployees([
      {
        id: "e1",
        firstName: "Actif",
        lastName: "User",
        updatedAt: new Date(),
        isMedecin: false,
        doctorCompensationType: DoctorCompensationType.FIXED_SALARY,
        fixedSalaryFcfa: 100_000,
        user: { id: "u1", active: true },
      },
      {
        id: "e2",
        firstName: "Inactif",
        lastName: "Compte",
        updatedAt: new Date(),
        isMedecin: false,
        doctorCompensationType: DoctorCompensationType.FIXED_SALARY,
        fixedSalaryFcfa: 200_000,
        user: { id: "u2", active: false },
      },
      {
        id: "e3",
        firstName: "Sans",
        lastName: "Compte",
        updatedAt: new Date(),
        isMedecin: false,
        doctorCompensationType: DoctorCompensationType.FIXED_SALARY,
        fixedSalaryFcfa: 150_000,
        user: null,
      },
    ]);

    assert.deepEqual(
      rows.map((r) => r.employeeId).sort(),
      ["e1", "e3"],
    );
    assert.equal(
      rows.reduce((sum, r) => sum + r.grossFcfa, 0),
      250_000,
    );
  });
});
