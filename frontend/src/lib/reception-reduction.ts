export const RECEPTION_PATIENT_REDUCTION_PERCENTS = [10, 15, 20] as const

export type ReceptionPatientReductionPercent =
  (typeof RECEPTION_PATIENT_REDUCTION_PERCENTS)[number]

export function reductionFcfaFromPercent(amountFcfa: number, percent: number): number {
  if (!Number.isFinite(amountFcfa) || amountFcfa <= 0) return 0
  if (!Number.isFinite(percent) || percent <= 0) return 0
  const raw = Math.round((amountFcfa * percent) / 100)
  return Math.min(Math.max(0, raw), Math.trunc(amountFcfa))
}

export function matchReceptionReductionPercent(
  amountFcfa: number,
  reductionFcfa: number,
): ReceptionPatientReductionPercent | null {
  if (!Number.isFinite(amountFcfa) || amountFcfa <= 0) return null
  if (!Number.isFinite(reductionFcfa) || reductionFcfa <= 0) return null
  return (
    RECEPTION_PATIENT_REDUCTION_PERCENTS.find(
      (pct) => reductionFcfaFromPercent(amountFcfa, pct) === reductionFcfa,
    ) ?? null
  )
}
