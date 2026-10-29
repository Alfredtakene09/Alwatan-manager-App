import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allocateNetRevenueByLine, productUnitCostFcfa } from "./pharmacy-profit.js";

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

  it("répartit les montants arrondis sans dépasser le net encaissé", () => {
    const amounts = allocateNetRevenueByLine(
      [{ lineTotalFcfa: 1 }, { lineTotalFcfa: 1 }, { lineTotalFcfa: 1 }],
      { grossTotalFcfa: 3, netTotalFcfa: 2 },
    );
    assert.deepEqual(amounts, [1, 1, 0]);
    assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), 2);
  });

  it("conserve le total net lorsque les lignes ont des poids différents", () => {
    const amounts = allocateNetRevenueByLine(
      [{ lineTotalFcfa: 2 }, { lineTotalFcfa: 3 }],
      { grossTotalFcfa: 5, netTotalFcfa: 3 },
    );
    assert.deepEqual(amounts, [1, 2]);
    assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), 3);
  });
});
