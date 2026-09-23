import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceType } from "@prisma/client";
import { pickInvoiceForExamKind } from "./exam-reclamation-refund.js";

const createdAt = new Date("2026-09-16T10:00:00Z");

describe("pickInvoiceForExamKind", () => {
  it("prend la facture LAB_EXAM billingExamKind=operation même si un dossier chirurgie existe", () => {
    const operationInvoice = {
      id: "lab-op",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 450_000,
      paidAmountFcfa: 450_000,
      billingExamKind: "operation",
      surgeryCaseId: null,
      hospitalizationId: null,
      createdAt,
    };
    const picked = pickInvoiceForExamKind("operation", [operationInvoice], "", {
      surgeryCaseId: "surgery-1",
    });
    assert.equal(picked?.id, "lab-op");
  });

  it("retombe sur la facture liée au surgeryCase si billingExamKind est absent", () => {
    const linked = {
      id: "op-linked",
      type: InvoiceType.LAB_EXAM,
      amountFcfa: 450_000,
      paidAmountFcfa: 450_000,
      billingExamKind: null,
      surgeryCaseId: "surgery-1",
      hospitalizationId: null,
      createdAt,
    };
    const picked = pickInvoiceForExamKind("operation", [linked], "", {
      surgeryCaseId: "surgery-1",
    });
    assert.equal(picked?.id, "op-linked");
  });
});
