import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateNetPeriodFinance } from "./period-finance.js";

describe("bénéfice net de la période", () => {
  it("déduit les parts réglées, salaires, dépenses et coût des produits vendus sans doubler les achats de stock", () => {
    assert.equal(calculateNetPeriodFinance({
      revenueFcfa: 1_000_000,
      entriesFcfa: 50_000,
      expensesFcfa: 300_000,
      pharmacyPurchasesFcfa: 200_000,
      pharmacyCostFcfa: 120_000,
      payrollFcfa: 250_000,
      doctorSharesCashFcfa: 80_000,
    }), 500_000);
  });

  it("restitue le coût d'un retour et autorise un bénéfice négatif", () => {
    assert.equal(calculateNetPeriodFinance({
      revenueFcfa: 10,
      entriesFcfa: 0,
      expensesFcfa: 80,
      pharmacyPurchasesFcfa: 0,
      pharmacyCostFcfa: -20,
      payrollFcfa: 20,
      doctorSharesCashFcfa: 0,
    }), -70);
  });
});
