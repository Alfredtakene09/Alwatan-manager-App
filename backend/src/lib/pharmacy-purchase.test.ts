import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computePurchaseLineCorrection } from "./pharmacy-purchase.js";

const lines = [
  { productId: "a", quantity: 10, unitCostFcfa: 1000, stockQuantity: 10 },
  { productId: "b", quantity: 2, unitCostFcfa: 500, stockQuantity: 20 },
];

describe("computePurchaseLineCorrection", () => {
  it("répercute la quantité et le prix sur le montant et le stock", () => {
    const result = computePurchaseLineCorrection({
      lines,
      lineIndex: 0,
      quantity: 12,
      unitCostFcfa: 900,
      unitsPerBox: 1,
    });
    assert.equal(result.amountDeltaFcfa, 12 * 900 - 10 * 1000);
    assert.equal(result.stockDelta, 2);
    assert.deepEqual(result.nextLines[0], {
      productId: "a",
      quantity: 12,
      unitCostFcfa: 900,
      stockQuantity: 12,
    });
    assert.deepEqual(result.nextLines[1], lines[1]);
  });

  it("compte le stock en sachets pour un produit vendu au détail", () => {
    const result = computePurchaseLineCorrection({
      lines,
      lineIndex: 1,
      quantity: 1,
      unitCostFcfa: 500,
      unitsPerBox: 10,
    });
    assert.equal(result.stockDelta, -10);
    assert.equal(result.amountDeltaFcfa, -500);
    assert.equal(result.nextLines[1]?.stockQuantity, 10);
  });

  it("retire la ligne quand la quantité passe à 0", () => {
    const result = computePurchaseLineCorrection({
      lines,
      lineIndex: 0,
      quantity: 0,
      unitCostFcfa: 1000,
      unitsPerBox: 1,
    });
    assert.deepEqual(result.nextLines, [lines[1]]);
    assert.equal(result.amountDeltaFcfa, -10000);
    assert.equal(result.stockDelta, -10);
  });

  it("refuse de retirer le dernier produit ou une ligne inconnue", () => {
    assert.throws(
      () =>
        computePurchaseLineCorrection({
          lines: [lines[0]!],
          lineIndex: 0,
          quantity: 0,
          unitCostFcfa: 1000,
          unitsPerBox: 1,
        }),
      /PURCHASE_LAST_LINE/,
    );
    assert.throws(
      () =>
        computePurchaseLineCorrection({
          lines,
          lineIndex: 5,
          quantity: 1,
          unitCostFcfa: 1000,
          unitsPerBox: 1,
        }),
      /PURCHASE_LINE_NOT_FOUND/,
    );
  });
});
