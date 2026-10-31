import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pharmacySaleAmounts } from "./pharmacy-sale-totals.js";

describe("pharmacySaleAmounts", () => {
  it("uses prescription net totals and subtracts net returns", () => {
    const amounts = pharmacySaleAmounts({
      grossTotalFcfa: 1000,
      netTotalFcfa: 800,
      saleLines: [
        {
          lineTotalFcfa: 1000,
          returns: [{ grossRefundFcfa: 300, netRefundFcfa: 240 }],
        },
      ],
    });

    assert.deepEqual(amounts, {
      grossTotalFcfa: 1000,
      netTotalFcfa: 800,
      returnedGrossFcfa: 300,
      returnedNetFcfa: 240,
    });
  });

  it("falls back to line totals for legacy prescriptions", () => {
    const amounts = pharmacySaleAmounts({
      grossTotalFcfa: null,
      netTotalFcfa: null,
      saleLines: [
        { lineTotalFcfa: 400, returns: [] },
        { lineTotalFcfa: 600, returns: [] },
      ],
    });

    assert.equal(amounts.grossTotalFcfa, 1000);
    assert.equal(amounts.netTotalFcfa, 1000);
  });

  it("uses the net total as the gross fallback when only the net total is stored", () => {
    const amounts = pharmacySaleAmounts({
      grossTotalFcfa: null,
      netTotalFcfa: 800,
      saleLines: [{ lineTotalFcfa: 1000, returns: [] }],
    });

    assert.equal(amounts.grossTotalFcfa, 800);
    assert.equal(amounts.netTotalFcfa, 800);
  });
});
