import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReadyForAutoRelease } from "./hospitalization-auto-release.js";

const NOW = new Date("2026-03-10T09:00:00");

function stay(overrides: Partial<Parameters<typeof isReadyForAutoRelease>[0]> = {}) {
  return {
    endDate: new Date("2026-03-10T00:00:00"),
    totalDueFcfa: 30000,
    paidAt: new Date("2026-03-09T16:00:00"),
    invoices: [],
    ...overrides,
  };
}

describe("isReadyForAutoRelease", () => {
  it("libère un séjour payé dont le dernier jour est aujourd'hui", () => {
    assert.equal(isReadyForAutoRelease(stay(), NOW), true);
  });

  it("libère un séjour soldé par ses factures sans paidAt", () => {
    const hospitalization = stay({
      paidAt: null,
      invoices: [{ paidAmountFcfa: 20000 }, { paidAmountFcfa: 10000 }],
    });
    assert.equal(isReadyForAutoRelease(hospitalization, NOW), true);
  });

  it("garde la salle tant que le séjour n'est pas soldé", () => {
    const hospitalization = stay({ paidAt: null, invoices: [{ paidAmountFcfa: 10000 }] });
    assert.equal(isReadyForAutoRelease(hospitalization, NOW), false);
  });

  it("garde la salle tant que la date de fin n'est pas atteinte", () => {
    assert.equal(
      isReadyForAutoRelease(stay({ endDate: new Date("2026-03-11T00:00:00") }), NOW),
      false,
    );
  });

  it("ignore un séjour sans date de fin", () => {
    assert.equal(isReadyForAutoRelease(stay({ endDate: null }), NOW), false);
  });

  it("libère un séjour terminé sans montant dû", () => {
    const hospitalization = stay({ totalDueFcfa: 0, paidAt: null });
    assert.equal(isReadyForAutoRelease(hospitalization, NOW), true);
  });
});
