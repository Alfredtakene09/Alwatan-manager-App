import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paidSurgeonShareFcfa } from "./doctor-share-claims.js";

describe("part chirurgien déduite du solde", () => {
  it("retire 30 % quand l'opération est soldée", () => {
    assert.equal(
      paidSurgeonShareFcfa({
        surgeonShareFcfa: 15_000,
        totalCostFcfa: 50_000,
        invoiceAmountFcfa: 50_000,
        paidAmountFcfa: 50_000,
      }),
      15_000,
    );
  });

  it("ne retient que la part de la tranche encaissée", () => {
    assert.equal(
      paidSurgeonShareFcfa({
        surgeonShareFcfa: 15_000,
        totalCostFcfa: 50_000,
        invoiceAmountFcfa: 50_000,
        paidAmountFcfa: 25_000,
      }),
      7_500,
    );
  });

  it("ne déduit rien tant qu'aucun encaissement", () => {
    assert.equal(
      paidSurgeonShareFcfa({
        surgeonShareFcfa: 15_000,
        totalCostFcfa: 50_000,
        invoiceAmountFcfa: 50_000,
        paidAmountFcfa: 0,
      }),
      0,
    );
  });
});
