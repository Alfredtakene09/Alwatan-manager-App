import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { partnerExamInvoicePlan } from "./partner-exam-invoices.js";

describe("factures examens ONG / partenaire", () => {
  it("crée une facture en attente à la première prescription", () => {
    assert.deepEqual(partnerExamInvoicePlan(12000, []), { action: "create", amountFcfa: 12000 });
  });

  it("ajoute un examen sur la facture encore ouverte", () => {
    const plan = partnerExamInvoicePlan(15000, [
      { id: "f1", amountFcfa: 12000, paidAmountFcfa: 0, status: "PENDING" },
    ]);
    assert.deepEqual(plan, { action: "update", invoiceId: "f1", amountFcfa: 15000 });
  });

  it("facture seulement l'écart si l'ancienne facture est déjà réglée", () => {
    const plan = partnerExamInvoicePlan(15000, [
      { id: "f1", amountFcfa: 12000, paidAmountFcfa: 12000, status: "PAID" },
    ]);
    assert.deepEqual(plan, { action: "create", amountFcfa: 3000 });
  });

  it("ne change rien si la prescription est identique", () => {
    const plan = partnerExamInvoicePlan(12000, [
      { id: "f1", amountFcfa: 12000, paidAmountFcfa: 0, status: "PENDING" },
    ]);
    assert.deepEqual(plan, { action: "none" });
  });

  it("ne descend jamais sous le montant déjà réglé", () => {
    const plan = partnerExamInvoicePlan(2000, [
      { id: "f1", amountFcfa: 12000, paidAmountFcfa: 5000, status: "PARTIALLY_PAID" },
    ]);
    assert.deepEqual(plan, { action: "update", invoiceId: "f1", amountFcfa: 5000 });
  });
});
