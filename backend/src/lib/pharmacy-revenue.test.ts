import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatLocalDay } from "./local-day.js";
import { parseRevenuePeriod } from "./pharmacy-revenue.js";

describe("parseRevenuePeriod", () => {
  it("uses inclusive local calendar dates for a custom period", () => {
    const now = new Date(2026, 9, 31, 12);
    const range = parseRevenuePeriod("custom", "2026-10-01", "2026-10-30", now);

    assert.equal(range.period, "custom");
    assert.equal(formatLocalDay(range.from), "2026-10-01");
    assert.equal(formatLocalDay(range.to), "2026-10-31");
  });
});
