import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DoctorCompensationType } from "@prisma/client";
import { listEligiblePayrollEmployees, parseYearMonth, payrollMonthRangeWhere } from "./admin-payroll.js";

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

describe("historique par mois de paie", () => {
  it("lit un mois « AAAA-MM » et refuse le reste", () => {
    assert.deepEqual(parseYearMonth("2026-09"), { year: 2026, month: 9 });
    assert.equal(parseYearMonth("2026-13"), null);
    assert.equal(parseYearMonth("2026-09-01"), null);
    assert.equal(parseYearMonth(undefined), null);
  });

  it("filtre les périodes entre deux mois inclus, même à cheval sur deux années", () => {
    assert.deepEqual(payrollMonthRangeWhere({ year: 2026, month: 11 }, { year: 2027, month: 2 }), {
      AND: [
        { OR: [{ year: { gt: 2026 } }, { year: 2026, month: { gte: 11 } }] },
        { OR: [{ year: { lt: 2027 } }, { year: 2027, month: { lte: 2 } }] },
      ],
    });
  });

  it("remet les mois dans l'ordre s'ils sont inversés", () => {
    assert.deepEqual(
      payrollMonthRangeWhere({ year: 2026, month: 10 }, { year: 2026, month: 8 }),
      payrollMonthRangeWhere({ year: 2026, month: 8 }, { year: 2026, month: 10 }),
    );
  });
});
