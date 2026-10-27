import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SalaryAdvanceStatus } from "@prisma/client";
import { advanceDeductibleBefore, advancesDeductibleForPayrollWhere } from "./salary-advances.js";

describe("avances par mois de prise", () => {
  it("une avance d'octobre se retient sur novembre, pas sur septembre ni octobre", () => {
    const october = new Date("2026-10-15T00:00:00.000Z");
    assert.equal(october < advanceDeductibleBefore(2026, 9), false);
    assert.equal(october < advanceDeductibleBefore(2026, 10), false);
    assert.equal(october < advanceDeductibleBefore(2026, 11), true);
  });

  it("le dernier jour du mois compte pour ce mois-là", () => {
    const lastDay = new Date("2026-10-31T00:00:00.000Z");
    assert.equal(lastDay < advanceDeductibleBefore(2026, 10), false);
    assert.equal(lastDay < advanceDeductibleBefore(2026, 11), true);
  });

  it("janvier prend les avances de décembre", () => {
    assert.deepEqual(advanceDeductibleBefore(2027, 1), new Date("2027-01-01T00:00:00.000Z"));
  });

  it("filtre les avances en attente prises avant le mois de paie", () => {
    assert.deepEqual(advancesDeductibleForPayrollWhere(2026, 11), {
      status: SalaryAdvanceStatus.PENDING,
      remainingFcfa: { gt: 0 },
      businessDate: { lt: new Date("2026-11-01T00:00:00.000Z") },
    });
  });
});
