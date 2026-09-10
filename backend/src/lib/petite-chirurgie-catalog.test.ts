import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PETITE_CHIRURGIE_CATALOG_ITEMS,
  PETITE_CHIRURGIE_SURGEON_PERCENT,
} from "./petite-chirurgie-catalog.js";

describe("catalogue petite chirurgie", () => {
  it("définit les 3 actes additifs aux tarifs demandés (FCFA)", () => {
    const byCode = Object.fromEntries(
      PETITE_CHIRURGIE_CATALOG_ITEMS.map((item) => [item.code, item]),
    );
    assert.equal(byCode["PC-SOUTIR"]?.label, "Soutir");
    assert.equal(byCode["PC-SOUTIR"]?.totalCostFcfa, 2000);
    assert.equal(byCode["PC-PANSEMENT"]?.label, "Pansement");
    assert.equal(byCode["PC-PANSEMENT"]?.totalCostFcfa, 1000);
    assert.equal(byCode["PC-GRAND-SOUTIR"]?.label, "Grand soutir");
    assert.equal(byCode["PC-GRAND-SOUTIR"]?.totalCostFcfa, 5000);
    assert.equal(PETITE_CHIRURGIE_SURGEON_PERCENT, 70);
  });

  it("utilise des codes uniques stables", () => {
    const codes = PETITE_CHIRURGIE_CATALOG_ITEMS.map((item) => item.code);
    assert.equal(new Set(codes).size, codes.length);
  });
});
