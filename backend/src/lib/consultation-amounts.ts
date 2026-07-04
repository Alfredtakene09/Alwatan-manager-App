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
  const consultationFeeFcfa = fee ?? 0
  const reductionFcfa = Math.max(0, reduction ?? 0)
  const netFromFee = Math.max(0, consultationFeeFcfa - reductionFcfa)
  const totalFcfa = invoiceAmount != null ? invoiceAmount : netFromFee

  return { consultationFeeFcfa, reductionFcfa, totalFcfa }
}
