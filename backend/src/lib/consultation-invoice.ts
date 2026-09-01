import { InvoiceStatus, InvoiceType, type PatientCategory, type Prisma } from "@prisma/client";
import { shouldCreateImmediateInvoice } from "./patient-billing.js";

/** Données facture consultation lors d'un encaissement immédiat à la réception. */
export function consultationInvoicePaymentData(category: PatientCategory): {
  status: InvoiceStatus;
  paidAt: Date | null;
} {
  if (!shouldCreateImmediateInvoice(category)) {
    return { status: InvoiceStatus.PENDING, paidAt: null };
  }
  return { status: InvoiceStatus.PAID, paidAt: new Date() };
}

export function consultationInvoiceUpdateData(
  category: PatientCategory,
  amountFcfa: number,
): Prisma.InvoiceUpdateInput {
  return {
    amountFcfa,
    ...consultationInvoicePaymentData(category),
  };
}

export function consultationInvoiceCreateData(
  category: PatientCategory,
  base: {
    invoiceNumber: string;
    patientId: string;
    visitId: string;
    amountFcfa: number;
    issuedById: string;
  },
): Prisma.InvoiceCreateInput {
  const payment = consultationInvoicePaymentData(category);
  return {
    invoiceNumber: base.invoiceNumber,
    patient: { connect: { id: base.patientId } },
    visit: { connect: { id: base.visitId } },
    issuedBy: { connect: { id: base.issuedById } },
    type: InvoiceType.CONSULTATION,
    amountFcfa: base.amountFcfa,
    status: payment.status,
    paidAt: payment.paidAt,
  };
}
