import { InvoiceStatus, InvoiceType, type PatientCategory, type Prisma } from "@prisma/client";
import { shouldCreateImmediateInvoice } from "./patient-billing.js";

/**
 * Facture consultation à l'enregistrement réception :
 * toujours PENDING — l'encaissement est réservé au gestionnaire / direction.
 */
export function consultationInvoicePaymentData(_category: PatientCategory): {
  status: InvoiceStatus;
  paidAt: Date | null;
} {
  return { status: InvoiceStatus.PENDING, paidAt: null };
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

/** Indique si une facture consultation doit être créée pour cette catégorie. */
export function shouldCreateConsultationInvoice(category: PatientCategory) {
  return shouldCreateImmediateInvoice(category);
}
