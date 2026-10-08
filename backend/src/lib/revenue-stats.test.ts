import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceStatus, InvoiceType } from "@prisma/client";
import {
  isCollectedOperationInvoice,
  netPaymentAmountsAfterPaidCap,
  registeredOperationInvoiceWhere,
  sumCollectedBreakdown,
} from "./revenue-stats.js";

describe("netPaymentAmountsAfterPaidCap", () => {
  it("plafonne un versement brut au paidAmountFcfa restant après remboursement", () => {
    const nets = netPaymentAmountsAfterPaidCap([
      {
        id: "p1",
        invoiceId: "inv-op",
        amountFcfa: 450_000,
        paidAt: new Date("2026-09-16T10:00:00Z"),
        invoicePaidAmountFcfa: 0,
      },
    ]);
    assert.equal(nets.get("p1"), 0);
  });

  it("conserve le reliquat net d'un remboursement partiel", () => {
    const nets = netPaymentAmountsAfterPaidCap([
      {
        id: "p1",
        invoiceId: "inv-op",
        amountFcfa: 450_000,
        paidAt: new Date("2026-09-16T10:00:00Z"),
        invoicePaidAmountFcfa: 200_000,
      },
    ]);
    assert.equal(nets.get("p1"), 200_000);
  });

  it("impute le plafond sur les versements les plus anciens d'abord", () => {
    const t1 = new Date("2026-09-10T10:00:00Z");
    const t2 = new Date("2026-09-16T10:00:00Z");
    const nets = netPaymentAmountsAfterPaidCap([
      {
        id: "p2",
        invoiceId: "inv-op",
        amountFcfa: 200_000,
        paidAt: t2,
        invoicePaidAmountFcfa: 400_000,
      },
      {
        id: "p1",
        invoiceId: "inv-op",
        amountFcfa: 300_000,
        paidAt: t1,
        invoicePaidAmountFcfa: 400_000,
      },
    ]);
    assert.equal(nets.get("p1"), 300_000);
    assert.equal(nets.get("p2"), 100_000);
  });
});

describe("sumCollectedBreakdown operations", () => {
  it("classe un examen opération lié à un dossier chirurgie dans surgeryFcfa", () => {
    assert.equal(
      isCollectedOperationInvoice({
        type: InvoiceType.LAB_EXAM,
        billingExamKind: "operation",
        surgeryCaseId: "surg-1",
      }),
      true,
    );
    const breakdown = sumCollectedBreakdown([
      {
        type: InvoiceType.LAB_EXAM,
        status: InvoiceStatus.PAID,
        amountFcfa: 200_000,
        paidAmountFcfa: 200_000,
        paidAt: new Date("2026-09-16T10:00:00Z"),
        createdAt: new Date("2026-09-16T10:00:00Z"),
        billingExamKind: "operation",
        surgeryCaseId: "surg-1",
      },
    ]);
    assert.equal(breakdown.surgeryFcfa, 200_000);
    assert.equal(breakdown.examsFcfa, 0);
  });

  it("ajoute une autre chirurgie (sans dossier bloc) aux entrées opérations", () => {
    assert.equal(
      isCollectedOperationInvoice({
        type: InvoiceType.LAB_EXAM,
        billingExamKind: "operation",
        surgeryCaseId: null,
      }),
      true,
    );
    const breakdown = sumCollectedBreakdown([
      {
        type: InvoiceType.LAB_EXAM,
        status: InvoiceStatus.PAID,
        amountFcfa: 500_000,
        paidAmountFcfa: 500_000,
        paidAt: new Date("2026-09-16T11:38:00Z"),
        createdAt: new Date("2026-09-16T11:38:00Z"),
        billingExamKind: "operation",
        surgeryCaseId: null,
      },
      {
        type: InvoiceType.LAB_EXAM,
        status: InvoiceStatus.PAID,
        amountFcfa: 300_000,
        paidAmountFcfa: 300_000,
        paidAt: new Date("2026-09-14T12:34:00Z"),
        createdAt: new Date("2026-09-14T12:34:00Z"),
        billingExamKind: "operation",
        surgeryCaseId: "surg-clavicule",
      },
      {
        type: InvoiceType.LAB_EXAM,
        status: InvoiceStatus.PAID,
        amountFcfa: 550_000,
        paidAmountFcfa: 550_000,
        paidAt: new Date("2026-09-15T16:58:00Z"),
        createdAt: new Date("2026-09-15T16:58:00Z"),
        billingExamKind: "operation",
        surgeryCaseId: "surg-femur",
      },
    ]);
    assert.equal(breakdown.surgeryFcfa, 1_350_000);
    assert.equal(breakdown.examsFcfa, 0);
  });

  it("ne compte qu'une facture d'opération non annulée", () => {
    assert.deepEqual(registeredOperationInvoiceWhere(), {
      status: { not: InvoiceStatus.CANCELLED },
      OR: [{ type: InvoiceType.SURGERY }, { billingExamKind: "operation" }],
    });
  });
});
