import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SalaryAdvanceStatus } from "@prisma/client";
import { planAdvanceRestoration } from "./payroll-cancel.js";

function advance(
  id: string,
  overrides: Partial<Parameters<typeof planAdvanceRestoration>[0][number]> = {},
) {
  return {
    id,
    amountFcfa: 50_000,
    remainingFcfa: 0,
    status: SalaryAdvanceStatus.DEDUCTED,
    payrollYear: 2026,
    payrollMonth: 9,
    businessDate: new Date("2026-09-01"),
    createdAt: new Date("2026-09-01T08:00:00Z"),
    ...overrides,
  };
}

describe("planAdvanceRestoration", () => {
  it("ne rend rien sans retenue", () => {
    assert.deepEqual(planAdvanceRestoration([advance("a")], 2026, 9, 0), []);
  });

  it("rouvre l'avance soldée sur le mois annulé", () => {
    const plan = planAdvanceRestoration([advance("a")], 2026, 9, 50_000);
    assert.deepEqual(plan, [
      { id: "a", restoreFcfa: 50_000, nextRemainingFcfa: 50_000, reopen: true },
    ]);
  });

  it("rend d'abord au mois annulé puis à l'avance entamée la plus récente", () => {
    const plan = planAdvanceRestoration(
      [
        advance("old-other-month", { payrollMonth: 8, businessDate: new Date("2026-07-01") }),
        advance("partial", {
          status: SalaryAdvanceStatus.PENDING,
          payrollYear: null,
          payrollMonth: null,
          remainingFcfa: 30_000,
          businessDate: new Date("2026-09-10"),
        }),
        advance("settled-sept", { amountFcfa: 10_000 }),
      ],
      2026,
      9,
      25_000,
    );
    assert.deepEqual(plan, [
      { id: "settled-sept", restoreFcfa: 10_000, nextRemainingFcfa: 10_000, reopen: true },
      { id: "partial", restoreFcfa: 15_000, nextRemainingFcfa: 45_000, reopen: false },
    ]);
  });

  it("ne rend jamais plus que ce qui a été déduit", () => {
    const plan = planAdvanceRestoration(
      [advance("a", { status: SalaryAdvanceStatus.PENDING, remainingFcfa: 45_000 })],
      2026,
      9,
      20_000,
    );
    assert.deepEqual(plan, [
      { id: "a", restoreFcfa: 5_000, nextRemainingFcfa: 50_000, reopen: false },
    ]);
  });
});
