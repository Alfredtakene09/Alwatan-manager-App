import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paidPayrollNetFcfa, payrollMonthsStartingIn } from "./payroll-outflow.js";

describe("sorties salaires du tableau de bord", () => {
  it("rattache un mois complet à son mois de paie", () => {
    assert.deepEqual(payrollMonthsStartingIn(new Date(2026, 8, 1), new Date(2026, 9, 1)), [
      { year: 2026, month: 9 },
    ]);
  });

  it("prend chaque mois d'une plage, même à cheval sur deux années", () => {
    assert.deepEqual(payrollMonthsStartingIn(new Date(2026, 10, 1), new Date(2027, 1, 1)), [
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
  });

  it("ne compte pas le mois d'une période qui commence en cours de mois", () => {
    assert.deepEqual(payrollMonthsStartingIn(new Date(2026, 9, 27), new Date(2026, 9, 28)), []);
    assert.deepEqual(payrollMonthsStartingIn(new Date(2026, 9, 15), new Date(2026, 10, 15)), [
      { year: 2026, month: 11 },
    ]);
  });

  it("compte le net versé, sans l'avance déjà sortie", () => {
    assert.equal(
      paidPayrollNetFcfa({ grossFcfa: 600_000, primeFcfa: 20_000, advanceDeductionFcfa: 250_000 }),
      370_000,
    );
    assert.equal(paidPayrollNetFcfa({ grossFcfa: 100_000, primeFcfa: 0, advanceDeductionFcfa: 150_000 }), 0);
  });
});
