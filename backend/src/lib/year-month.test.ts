import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLimitParam, yearMonthRange } from "./year-month.js";

describe("yearMonthRange", () => {
  it("borne le mois local [from, to[", () => {
    const range = yearMonthRange("2026-09");
    assert.ok(range);
    assert.equal(range.from.getFullYear(), 2026);
    assert.equal(range.from.getMonth(), 8);
    assert.equal(range.from.getDate(), 1);
    assert.equal(range.to.getFullYear(), 2026);
    assert.equal(range.to.getMonth(), 9);
    assert.equal(range.to.getDate(), 1);
  });

  it("refuse les valeurs invalides", () => {
    assert.equal(yearMonthRange(""), null);
    assert.equal(yearMonthRange("2026-13"), null);
    assert.equal(yearMonthRange("09-2026"), null);
  });
});

describe("parseLimitParam", () => {
  it("plafonne l’export et conserve le défaut écran", () => {
    assert.equal(parseLimitParam(undefined, 200, 10_000), 200);
    assert.equal(parseLimitParam("10000", 200, 10_000), 10_000);
    assert.equal(parseLimitParam("99999", 200, 10_000), 10_000);
    assert.equal(parseLimitParam("0", 200, 10_000), 1);
  });
});
