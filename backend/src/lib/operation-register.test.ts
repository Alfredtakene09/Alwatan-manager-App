import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  operationCategory,
  operationPaidFcfa,
  surgeryPaidFcfa,
  surgeryRegisteredAt,
} from "./operation-register.js";

const invoice = (overrides: Partial<Parameters<typeof operationPaidFcfa>[1] & object> = {}) => ({
  status: "PENDING",
  amountFcfa: 130_000,
  paidAmountFcfa: 0,
  createdAt: new Date(2026, 8, 28, 19),
  paidAt: null,
  payments: [],
  ...overrides,
});

describe("surgeryRegisteredAt", () => {
  it("uses the (possibly backdated) invoice registration date, not the payment date", () => {
    const surgery = {
      totalCostFcfa: 130_000,
      completedAt: new Date(2026, 9, 7, 19),
      operationScheduledAt: null,
      updatedAt: new Date(2026, 9, 7, 19),
      invoice: invoice({ status: "PAID", paidAt: new Date(2026, 9, 7, 19) }),
    };
    assert.equal(surgeryRegisteredAt(surgery).getMonth(), 8);
  });
});

describe("operationPaidFcfa", () => {
  it("sums recorded payments", () => {
    assert.equal(
      operationPaidFcfa(130_000, invoice({ payments: [{ amountFcfa: 50_000 }, { amountFcfa: 30_000 }] })),
      80_000,
    );
  });

  it("counts a PAID invoice at its billed amount", () => {
    assert.equal(operationPaidFcfa(130_000, invoice({ status: "PAID", paidAmountFcfa: 100_000 })), 130_000);
  });

  it("falls back to the surgery cost when there is no invoice", () => {
    assert.equal(
      surgeryPaidFcfa({
        totalCostFcfa: 90_000,
        completedAt: null,
        operationScheduledAt: null,
        updatedAt: new Date(),
        invoice: null,
      }),
      0,
    );
  });
});

describe("operationCategory", () => {
  it("sorts deliveries, dentistry and real operations apart", () => {
    assert.equal(operationCategory("Gynécologie", ["Accouchement naturel"]), "accouchement");
    assert.equal(operationCategory("Odontologie", ["قلع ضرس"]), "odontologie");
    assert.equal(operationCategory("Gynécologie", ["Césariennes"]), "operation");
    assert.equal(operationCategory(null, []), "operation");
  });
});
