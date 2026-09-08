import { InvoiceStatus, InvoiceType, type PatientCategory, type Prisma } from "@prisma/client";
import { immediatePaidInvoiceData } from "./invoice-paid.js";
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
  const payment = consultationInvoicePaymentData(category);
  return {
    amountFcfa,
    ...payment,
    paidAmountFcfa: payment.status === InvoiceStatus.PAID ? amountFcfa : 0,
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
  const paid =
    shouldCreateImmediateInvoice(category) && base.amountFcfa > 0
      ? immediatePaidInvoiceData(base.amountFcfa, base.issuedById)
      : {
          amountFcfa: base.amountFcfa,
          paidAmountFcfa: 0,
          status: InvoiceStatus.PENDING,
          paidAt: null,
        };

  return {
    invoiceNumber: base.invoiceNumber,
    patient: { connect: { id: base.patientId } },
    visit: { connect: { id: base.visitId } },
    issuedBy: { connect: { id: base.issuedById } },
    type: InvoiceType.CONSULTATION,
    ...paid,
  };
}
