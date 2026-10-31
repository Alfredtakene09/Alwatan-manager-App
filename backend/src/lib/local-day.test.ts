import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLocalDay, parseLocalDay } from "./local-day.js";

describe("parseLocalDay", () => {
  it("parses a calendar day at local midnight", () => {
    const date = parseLocalDay("2026-10-23");
    assert.ok(date);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 9);
    assert.equal(date.getDate(), 23);
    assert.equal(date.getHours(), 0);
  });

  it("rejects malformed or impossible calendar days", () => {
    assert.equal(parseLocalDay("2026-02-30"), null);
    assert.equal(parseLocalDay("2026/10/23"), null);
    assert.equal(parseLocalDay(undefined), null);
  });

  it("formats a local calendar day without shifting it through UTC", () => {
    assert.equal(formatLocalDay(new Date(2026, 9, 1, 0, 0, 0)), "2026-10-01");
  });
});
