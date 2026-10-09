/**
 * Base des % : uniquement l'argent encaissé.
 * Une facture soldée compte pour son montant, même si le payé enregistré est en retard.
 */
export function collectedAmountFcfa(input: {
  paidAmountFcfa?: number | null;
  amountFcfa?: number | null;
  status?: string | null;
}) {
  const paid = Math.max(0, Math.round(Number(input.paidAmountFcfa) || 0));
  const billed = Math.max(0, Math.round(Number(input.amountFcfa) || 0));
  if (input.status === "PAID" && billed > 0) return billed;
  if (paid <= 0) return 0;
  return billed > 0 ? Math.min(paid, billed) : paid;
}

/** Calcule les parts chirurgien, anesthésiste et clinique. Les trois totalisent le montant. */
export function computeInterventionCostShares(
  totalCostFcfa: number,
  surgeonPercent: number,
  assistantPercent = 0,
): {
  totalCostFcfa: number;
  surgeonShareFcfa: number;
  assistantShareFcfa: number;
  clinicShareFcfa: number;
} {
  const total = Math.max(0, Math.round(Number(totalCostFcfa) || 0));
  const surgeonRate = Math.min(100, Math.max(0, Math.round(Number(surgeonPercent) || 0)));
  const assistantRate = Math.min(100, Math.max(0, Math.round(Number(assistantPercent) || 0)));
  const surgeonShareFcfa = Math.round((total * surgeonRate) / 100);
  const assistantShareFcfa = Math.round((total * assistantRate) / 100);
  return {
    totalCostFcfa: total,
    surgeonShareFcfa,
    assistantShareFcfa,
    clinicShareFcfa: Math.max(0, total - surgeonShareFcfa - assistantShareFcfa),
  };
}
