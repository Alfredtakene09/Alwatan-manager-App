import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceStatus } from "@prisma/client";
import { nextConsultationInvoiceState, scaledPaymentAmounts } from "./recorded-tariff.js";

describe("tarif consultation sur facture existante", () => {
  it("aligne une facture soldée sur le nouveau prix", () => {
    const next = nextConsultationInvoiceState(
      { amountFcfa: 5_000, paidAmountFcfa: 5_000, status: InvoiceStatus.PAID },
      8_000,
    );
    assert.equal(next.amountFcfa, 8_000);
    assert.equal(next.paidAmountFcfa, 8_000);
    assert.equal(next.status, InvoiceStatus.PAID);
    assert.equal(next.alignPayments, true);
  });

  it("laisse l'acompte et met à jour le net", () => {
    const next = nextConsultationInvoiceState(
      { amountFcfa: 5_000, paidAmountFcfa: 2_000, status: InvoiceStatus.PARTIALLY_PAID },
      8_000,
    );
    assert.equal(next.amountFcfa, 8_000);
    assert.equal(next.paidAmountFcfa, 2_000);
    assert.equal(next.status, InvoiceStatus.PARTIALLY_PAID);
    assert.equal(next.alignPayments, false);
  });

  it("répartit le nouveau total sur les versements", () => {
    assert.deepEqual(scaledPaymentAmounts([3_000, 2_000], 10_000), [6_000, 4_000]);
    assert.deepEqual(scaledPaymentAmounts([5_000], 8_000), [8_000]);
  });
});
