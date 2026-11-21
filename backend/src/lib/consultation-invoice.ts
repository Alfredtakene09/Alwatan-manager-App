import { InvoiceStatus, InvoiceType, PatientCategory, type Prisma } from "@prisma/client";
import { immediatePaidInvoiceData } from "./invoice-paid.js";
import { shouldCreateImmediateInvoice } from "./patient-billing.js";

/**
 * Consultation encaissée à la réception dès l'enregistrement.
 * ONG / partenaire : facturée au partenaire, reste en attente jusqu'à ce que l'admin la marque payée
 * (la part du médecin ne compte qu'à ce moment-là).
 */
function paidAtRegistration(category: PatientCategory) {
  return shouldCreateImmediateInvoice(category) && category !== PatientCategory.ONG;
}

/** Données facture consultation lors d'un encaissement immédiat à la réception. */
export function consultationInvoicePaymentData(category: PatientCategory): {
  status: InvoiceStatus;
  paidAt: Date | null;
} {
  if (!paidAtRegistration(category)) {
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
    paidAtRegistration(category) && base.amountFcfa > 0
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
