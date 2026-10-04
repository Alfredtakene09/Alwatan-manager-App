import { InvoiceStatus } from "@prisma/client";

/** Répartit un nouveau total sur les versements existants (le dernier absorbe l'écart). */
export function scaledPaymentAmounts(amounts: number[], targetFcfa: number): number[] {
  if (amounts.length === 0) return [];
  const target = Math.max(0, Math.round(targetFcfa));
  if (amounts.length === 1) return [target];
  const sum = amounts.reduce((total, amount) => total + amount, 0);
  if (sum === target) return [...amounts];
  if (sum <= 0) {
    const next = amounts.map(() => 0);
    next[next.length - 1] = target;
    return next;
  }
  const scaled = amounts.map((amount) => Math.floor((amount * target) / sum));
  const drift = target - scaled.reduce((total, amount) => total + amount, 0);
  scaled[scaled.length - 1] += drift;
  return scaled;
}

export type ConsultationInvoiceSnapshot = {
  amountFcfa: number;
  paidAmountFcfa: number;
  status: InvoiceStatus;
};

/**
 * Nouveau tarif de consultation sur une facture déjà enregistrée.
 * Une facture soldée reste soldée, au nouveau montant.
 * Un acompte ne dépasse pas le nouveau net.
 */
export function nextConsultationInvoiceState(
  invoice: ConsultationInvoiceSnapshot,
  netFcfa: number,
): ConsultationInvoiceSnapshot & { alignPayments: boolean } {
  if (invoice.status === InvoiceStatus.CANCELLED) {
    return { ...invoice, alignPayments: false };
  }

  const net = Math.max(0, Math.round(netFcfa));
  const fullyPaid =
    invoice.status === InvoiceStatus.PAID ||
    (invoice.amountFcfa > 0 && invoice.paidAmountFcfa >= invoice.amountFcfa);
  const paid = fullyPaid ? net : Math.min(Math.max(0, invoice.paidAmountFcfa), net);

  let status = invoice.status;
  if (invoice.status !== InvoiceStatus.DRAFT || paid > 0) {
    if (net <= 0 || paid <= 0) {
      status = invoice.status === InvoiceStatus.DRAFT ? InvoiceStatus.DRAFT : InvoiceStatus.PENDING;
    } else if (paid >= net) {
      status = InvoiceStatus.PAID;
    } else {
      status = InvoiceStatus.PARTIALLY_PAID;
    }
  }

  return {
    amountFcfa: net,
    paidAmountFcfa: paid,
    status,
    alignPayments: paid !== invoice.paidAmountFcfa,
  };
}
