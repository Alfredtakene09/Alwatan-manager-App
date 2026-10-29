import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { productUnitCostFcfa } from "./pharmacy-profit.js";

const box = {
  purchasePriceFcfa: 3000,
  unitPriceFcfa: 5000,
  sellBySachet: true,
  sachetsPerBox: 10,
  sachetPriceFcfa: 600,
};

describe("pharmacy-profit", () => {
  it("coût d'une boîte = prix d'achat de la fiche", () => {
    assert.equal(productUnitCostFcfa(box, false), 3000);
  });

  it("vente au détail = fraction du prix d'achat de la boîte", () => {
    assert.equal(productUnitCostFcfa(box, true), 300);
    assert.equal(productUnitCostFcfa({ ...box, purchasePriceFcfa: 1000, sachetsPerBox: 3 }, true), 333);
  });

  it("produit sans prix d'achat : coût inconnu", () => {
    assert.equal(productUnitCostFcfa({ ...box, purchasePriceFcfa: null }, false), null);
    assert.equal(productUnitCostFcfa({ ...box, purchasePriceFcfa: 0 }, true), null);
  });
});
