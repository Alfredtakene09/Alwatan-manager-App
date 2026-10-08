/** Pourcentages de réduction autorisés pour les réceptionnistes (examens + enregistrement patient). */
export const RECEPTION_REDUCTION_PERCENTS = [10, 15, 20] as const;

export type ReceptionReductionPercent = (typeof RECEPTION_REDUCTION_PERCENTS)[number];

export function reductionFcfaFromPercent(amountFcfa: number, percent: number): number {
  if (!Number.isFinite(amountFcfa) || amountFcfa <= 0) return 0;
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  const raw = Math.round((amountFcfa * percent) / 100);
  return Math.min(Math.max(0, raw), Math.trunc(amountFcfa));
}

/** 0 ou exactement 10 / 15 / 20 % du montant. */
export function isAllowedReceptionReduction(amountFcfa: number, reductionFcfa: number): boolean {
  if (!Number.isFinite(reductionFcfa) || reductionFcfa <= 0) return true;
  if (!Number.isFinite(amountFcfa) || amountFcfa <= 0) return false;
  return RECEPTION_REDUCTION_PERCENTS.some(
    (pct) => reductionFcfaFromPercent(amountFcfa, pct) === reductionFcfa,
  );
}
