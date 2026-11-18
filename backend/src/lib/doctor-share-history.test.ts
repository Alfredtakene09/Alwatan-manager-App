import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doctorShareSettlementRange } from "./doctor-share-history.js";

describe("doctorShareSettlementRange", () => {
  it("inclut les deux dates calendaires, même en fin de mois", () => {
    const range = doctorShareSettlementRange("2026-10-30", "2026-10-31");
    assert.ok(range);
    assert.deepEqual(range.gte, new Date(2026, 9, 30));
    assert.deepEqual(range.lt, new Date(2026, 10, 1));
  });

  it("refuse les dates manquantes, impossibles ou inversées", () => {
    assert.equal(doctorShareSettlementRange("", "2026-10-31"), null);
    assert.equal(doctorShareSettlementRange("2026-02-30", "2026-03-01"), null);
    assert.equal(doctorShareSettlementRange("2026-11-01", "2026-10-31"), null);
  });
});
