import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aggregateDiagnoses } from "./recorded-diagnoses.js";

describe("aggregateDiagnoses", () => {
  it("ignore les diagnostics vides et fusionne les variantes d’espaces", () => {
    const rows = aggregateDiagnoses([
      { diagnosis: "  Paludisme  ", createdAt: new Date("2026-01-02") },
      { diagnosis: "paludisme", createdAt: new Date("2026-03-01") },
      { diagnosis: " ", createdAt: new Date("2026-02-01") },
      { diagnosis: null, createdAt: new Date("2026-02-01") },
      { diagnosis: "Hypertension", createdAt: new Date("2026-01-15") },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.label, "paludisme");
    assert.equal(rows[0]?.count, 2);
    assert.equal(rows[0]?.lastAt.toISOString().slice(0, 10), "2026-03-01");
    assert.equal(rows[1]?.label, "Hypertension");
    assert.equal(rows[1]?.count, 1);
  });
});
