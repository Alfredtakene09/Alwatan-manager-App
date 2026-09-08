import { InvoiceStatus, type Prisma } from "@prisma/client";

/** Champs d'une facture encaissée immédiatement (montant + ligne InvoicePayment). */
export function immediatePaidInvoiceData(
  amountFcfa: number,
  recordedById: string,
): Pick<Prisma.InvoiceCreateInput, "amountFcfa" | "paidAmountFcfa" | "status" | "paidAt" | "payments"> {
  if (amountFcfa <= 0) {
    return {
      amountFcfa: 0,
      paidAmountFcfa: 0,
      status: InvoiceStatus.PENDING,
      paidAt: null,
    };
  }
  return {
    amountFcfa,
    paidAmountFcfa: amountFcfa,
    status: InvoiceStatus.PAID,
    paidAt: new Date(),
    payments: {
      create: {
        amountFcfa,
        recordedById,
      },
    },
  };
}
