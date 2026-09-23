export type ConsultationAmounts = {
  consultationFeeFcfa: number
  reductionFcfa: number
  totalFcfa: number
}

export function computeConsultationAmounts(
  fee: number | null | undefined,
  reduction: number | null | undefined,
  invoiceAmount?: number | null,
): ConsultationAmounts {
  const reductionFcfa = Math.max(0, reduction ?? 0)
  const invoiceNet = invoiceAmount == null ? null : Math.max(0, invoiceAmount)
  // Tarif visite à 0/null mais facture présente (colonne paiement) : reprendre le brut facturé.
  let consultationFeeFcfa = fee ?? 0
  if (consultationFeeFcfa <= 0 && invoiceNet != null && invoiceNet > 0) {
    consultationFeeFcfa = invoiceNet + reductionFcfa
  }
  const netFromFee = Math.max(0, consultationFeeFcfa - reductionFcfa)
  const totalFcfa = invoiceNet != null ? invoiceNet : netFromFee

  return { consultationFeeFcfa, reductionFcfa, totalFcfa }
}

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  PAID: 'Payée',
  PENDING: 'En attente',
  DRAFT: 'Brouillon',
  CANCELLED: 'Annulée',
}
