import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RECEPTION_REDUCTION_PERCENTS,
  isAllowedReceptionReduction,
  reductionFcfaFromPercent,
} from "./reception-reduction.js";

describe("réductions réception 10 / 15 / 20 %", () => {
  it("calcule 10, 15 et 20 %", () => {
    assert.equal(reductionFcfaFromPercent(5000, 10), 500);
    assert.equal(reductionFcfaFromPercent(5000, 15), 750);
    assert.equal(reductionFcfaFromPercent(5000, 20), 1000);
  });

  it("autorise uniquement 0 et les paliers 10 / 15 / 20", () => {
    assert.equal(isAllowedReceptionReduction(10_000, 0), true);
    assert.equal(isAllowedReceptionReduction(10_000, 1000), true);
    assert.equal(isAllowedReceptionReduction(10_000, 1500), true);
    assert.equal(isAllowedReceptionReduction(10_000, 2000), true);
    assert.equal(isAllowedReceptionReduction(10_000, 500), false);
    assert.equal(isAllowedReceptionReduction(10_000, 3000), false);
  });

  it("expose uniquement 10, 15 et 20", () => {
    assert.deepEqual([...RECEPTION_REDUCTION_PERCENTS], [10, 15, 20]);
  });
});
