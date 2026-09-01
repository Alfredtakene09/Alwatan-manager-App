import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canRegisterPharmacyReturn,
  computeProportionalNetRefund,
  computeReturnableQuantity,
  isSameCalendarDay,
  resolvePrescriptionTotals,
} from "./pharmacy-returns.js";

describe("pharmacy-returns", () => {
  it("computeReturnableQuantity", () => {
    assert.equal(computeReturnableQuantity(5, 2), 3);
    assert.equal(computeReturnableQuantity(5, 5), 0);
  });

  it("computeProportionalNetRefund", () => {
    assert.equal(
      computeProportionalNetRefund({
        grossRefundFcfa: 1000,
        remainingGrossFcfa: 5000,
        remainingNetFcfa: 4000,
      }),
      800,
    );
    assert.equal(
      computeProportionalNetRefund({
        grossRefundFcfa: 6000,
        remainingGrossFcfa: 5000,
        remainingNetFcfa: 4000,
      }),
      4000,
    );
  });

  it("resolvePrescriptionTotals with partial returns", () => {
    const totals = resolvePrescriptionTotals({
      grossTotalFcfa: 10000,
      netTotalFcfa: 8000,
      saleLines: [{ lineTotalFcfa: 10000 }],
      saleReturns: [{ grossRefundFcfa: 2000, netRefundFcfa: 1600 }],
    });
    assert.equal(totals.remainingGrossFcfa, 8000);
    assert.equal(totals.remainingNetFcfa, 6400);
  });

  it("same-day return authorization", () => {
    const now = new Date("2026-09-01T15:00:00");
    const saleAt = new Date("2026-09-01T09:00:00");
    assert.equal(isSameCalendarDay(saleAt, now), true);
    assert.equal(
      canRegisterPharmacyReturn({ id: "p1", role: "PHARMACIEN" }, { pharmacistId: "p1", createdAt: saleAt }, now),
      true,
    );
    assert.equal(
      canRegisterPharmacyReturn({ id: "p2", role: "PHARMACIEN" }, { pharmacistId: "p1", createdAt: saleAt }, now),
      false,
    );
    assert.equal(
      canRegisterPharmacyReturn({ id: "a1", role: "ADMIN" }, { pharmacistId: "p1", createdAt: saleAt }, now),
      true,
    );
    const yesterday = new Date("2026-08-31T23:00:00");
    assert.equal(
      canRegisterPharmacyReturn({ id: "a1", role: "ADMIN" }, { pharmacistId: "p1", createdAt: yesterday }, now),
      false,
    );
  });
});

describe("pharmacy-revenue periods", () => {
  it("parseRevenuePeriod today", async () => {
    const { parseRevenuePeriod } = await import("./pharmacy-revenue.js");
    const now = new Date("2026-09-01T14:00:00");
    const { from, period } = parseRevenuePeriod("today", undefined, undefined, now);
    assert.equal(period, "today");
    assert.equal(from.getHours(), 0);
    assert.equal(from.getDate(), 1);
  });
});
