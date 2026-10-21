import { InvoiceStatus } from "@prisma/client";

export type PaymentInvoice = {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  amountFcfa: number;
  paidAmountFcfa: number;
  createdAt?: Date;
};

export function mapInvoicePayment(invoice: PaymentInvoice | null | undefined) {
  if (!invoice || invoice.status === InvoiceStatus.CANCELLED) return null;
  const remainingFcfa = Math.max(0, invoice.amountFcfa - invoice.paidAmountFcfa);
  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    amountFcfa: invoice.amountFcfa,
    paidAmountFcfa: invoice.paidAmountFcfa,
    remainingFcfa,
    payable:
      remainingFcfa > 0 &&
      (invoice.status === InvoiceStatus.PENDING ||
        invoice.status === InvoiceStatus.PARTIALLY_PAID ||
        invoice.status === InvoiceStatus.DRAFT),
  };
}

/** Factures examens actives d’une visite, de la plus ancienne à la plus récente. */
export function activeExamInvoices<T extends PaymentInvoice>(invoices: T[]): T[] {
  return invoices
    .filter((invoice) => invoice.status !== InvoiceStatus.CANCELLED)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
}

/**
 * Un dossier externe a une facture par service (labo, écho…) : la colonne paiement
 * et le reçu doivent afficher la somme de toutes, jamais une seule.
 */
export function mapCombinedExamPayment(invoices: PaymentInvoice[]) {
  const active = activeExamInvoices(invoices);
  if (active.length <= 1) return mapInvoicePayment(active[0]);
  const amountFcfa = active.reduce((sum, invoice) => sum + invoice.amountFcfa, 0);
  const paidAmountFcfa = active.reduce((sum, invoice) => sum + invoice.paidAmountFcfa, 0);
  const status = active.every((invoice) => invoice.status === InvoiceStatus.PAID)
    ? InvoiceStatus.PAID
    : paidAmountFcfa > 0
      ? InvoiceStatus.PARTIALLY_PAID
      : active[0]!.status;
  return mapInvoicePayment({
    id: active[0]!.id,
    invoiceNumber: active.map((invoice) => invoice.invoiceNumber).join(" + "),
    status,
    amountFcfa,
    paidAmountFcfa,
  });
}
