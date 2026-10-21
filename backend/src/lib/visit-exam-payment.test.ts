import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceStatus } from "@prisma/client";
import { mapCombinedExamPayment } from "./visit-exam-payment.js";

function invoice(
  invoiceNumber: string,
  amountFcfa: number,
  paidAmountFcfa: number,
  status: InvoiceStatus,
  minute: number,
) {
  return {
    id: invoiceNumber,
    invoiceNumber,
    status,
    amountFcfa,
    paidAmountFcfa,
    createdAt: new Date(Date.UTC(2026, 9, 13, 17, minute)),
  };
}

describe("mapCombinedExamPayment", () => {
  it("additionne labo + écho payés (cas PAT-1582)", () => {
    const payment = mapCombinedExamPayment([
      invoice("FAC-003167", 10_000, 10_000, InvoiceStatus.PAID, 12),
      invoice("FAC-003166", 28_700, 28_700, InvoiceStatus.PAID, 11),
    ]);
    assert.equal(payment?.amountFcfa, 38_700);
    assert.equal(payment?.paidAmountFcfa, 38_700);
    assert.equal(payment?.remainingFcfa, 0);
    assert.equal(payment?.status, InvoiceStatus.PAID);
    assert.equal(payment?.invoiceNumber, "FAC-003166 + FAC-003167");
  });

  it("garde une facture unique telle quelle", () => {
    const payment = mapCombinedExamPayment([
      invoice("FAC-003168", 10_000, 10_000, InvoiceStatus.PAID, 21),
    ]);
    assert.equal(payment?.amountFcfa, 10_000);
    assert.equal(payment?.invoiceNumber, "FAC-003168");
  });

  it("ignore les factures annulées", () => {
    const payment = mapCombinedExamPayment([
      invoice("FAC-1", 5_000, 5_000, InvoiceStatus.PAID, 1),
      invoice("FAC-2", 7_000, 0, InvoiceStatus.CANCELLED, 2),
    ]);
    assert.equal(payment?.amountFcfa, 5_000);
  });

  it("signale un reste à payer quand une facture est en attente", () => {
    const payment = mapCombinedExamPayment([
      invoice("FAC-1", 5_000, 5_000, InvoiceStatus.PAID, 1),
      invoice("FAC-2", 7_000, 0, InvoiceStatus.PENDING, 2),
    ]);
    assert.equal(payment?.amountFcfa, 12_000);
    assert.equal(payment?.remainingFcfa, 7_000);
    assert.equal(payment?.status, InvoiceStatus.PARTIALLY_PAID);
    assert.equal(payment?.payable, true);
  });

  it("retourne null sans facture", () => {
    assert.equal(mapCombinedExamPayment([]), null);
  });
});
