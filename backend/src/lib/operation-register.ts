/**
 * Registre des opérations — mêmes règles que la page « Opérations » (ReceptionOperationsView) :
 * une opération compte dans la période de sa date d'enregistrement (modifiable, peut être antidatée),
 * et son montant payé est le cumul encaissé sur la facture.
 */

type OperationInvoiceSource = {
  status: string;
  amountFcfa: number;
  paidAmountFcfa: number;
  createdAt: Date;
  paidAt: Date | null;
  payments: Array<{ amountFcfa: number }>;
};

type SurgeryDateSource = {
  totalCostFcfa: number;
  completedAt: Date | null;
  operationScheduledAt: Date | null;
  updatedAt: Date;
  invoice: OperationInvoiceSource | null;
};

/** Date d'enregistrement d'une opération du bloc (= surgeryCompletedAtIso côté frontend). */
export function surgeryRegisteredAt(surgery: SurgeryDateSource): Date {
  return (
    surgery.invoice?.createdAt ??
    surgery.completedAt ??
    surgery.operationScheduledAt ??
    surgery.invoice?.paidAt ??
    surgery.updatedAt
  );
}

/** Date d'enregistrement d'une opération facturée hors bloc (= otherOperationDateIso). */
export function otherOperationRegisteredAt(invoice: OperationInvoiceSource): Date {
  return invoice.createdAt ?? invoice.paidAt ?? new Date(0);
}

/** Montant payé affiché sur la page Opérations (= paymentInfo côté frontend). */
export function operationPaidFcfa(
  billedFcfa: number,
  invoice: OperationInvoiceSource | null,
): number {
  const recordedFcfa = (invoice?.payments ?? []).reduce(
    (sum, payment) => sum + (payment.amountFcfa || 0),
    0,
  );
  let paidFcfa = Math.max(invoice?.paidAmountFcfa ?? 0, recordedFcfa);
  const outstandingFcfa = Math.max(0, billedFcfa - paidFcfa);
  const isPaid = invoice?.status === "PAID" || (billedFcfa > 0 && outstandingFcfa === 0);
  if (isPaid && billedFcfa > paidFcfa) paidFcfa = billedFcfa;
  return paidFcfa;
}

export function surgeryPaidFcfa(surgery: SurgeryDateSource): number {
  return operationPaidFcfa(surgery.invoice?.amountFcfa ?? surgery.totalCostFcfa, surgery.invoice);
}

export type OperationCategory = "operation" | "odontologie" | "accouchement";

function foldName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Accouchements (rubrique « Autres ») et odontologie sont suivis à part des vraies opérations. */
export function operationCategory(
  serviceName: string | null | undefined,
  interventionLabels: Array<string | null | undefined>,
): OperationCategory {
  const labels = interventionLabels.map(foldName);
  if (labels.some((label) => label.includes("accouch") || label.includes("ولادة") || label.includes("توليد"))) {
    return "accouchement";
  }
  const service = foldName(serviceName);
  if (service.includes("odonto") || service.includes("dentaire")) return "odontologie";
  return "operation";
}
