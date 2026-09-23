import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UserRole } from "@prisma/client";
import {
  isPayrollLinkedExpenseId,
  mapPaidPayrollToExpenseCore,
  payrollExpensePeriodLabel,
} from "./payroll-expenses.js";

describe("payroll expenses listing", () => {
  it("n’identifie comme paie que les identifiants préfixés", () => {
    assert.equal(isPayrollLinkedExpenseId("payroll:abc"), true);
    assert.equal(isPayrollLinkedExpenseId("clxyz"), false);
  });

  it("transforme un salaire payé en ligne de dépense à la date du versement", () => {
    const row = mapPaidPayrollToExpenseCore({
      id: "pay1",
      year: 2026,
      month: 9,
      grossFcfa: 1_500_000,
      paidAt: new Date(2026, 8, 18, 12, 26, 0),
      employee: { firstName: "Dr", lastName: "YOUSSOUF DEMBELE" },
      paidBy: {
        firstName: "OUAZOUA",
        lastName: "GESTION",
        role: UserRole.GESTIONNAIRE,
      },
    });

    assert.equal(row.id, "payroll:pay1");
    assert.equal(row.source, "payroll");
    assert.equal(row.date, "2026-09-18");
    assert.equal(row.amountFcfa, 1_500_000);
    assert.equal(row.category, "Salaire");
    assert.equal(row.description, `Salaire — Dr YOUSSOUF DEMBELE (${payrollExpensePeriodLabel(2026, 9)})`);
    assert.equal(row.recordedByName, "OUAZOUA GESTION");
  });
});
