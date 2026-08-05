/** Calcule les parts chirurgien / clinique sur le montant réellement encaissé. */
export function computeInterventionCostShares(
  totalCostFcfa: number,
  surgeonPercent: number,
): { totalCostFcfa: number; surgeonShareFcfa: number; clinicShareFcfa: number } {
  const total = Math.max(0, Math.round(Number(totalCostFcfa) || 0));
  const percent = Math.min(100, Math.max(0, Math.round(Number(surgeonPercent) || 0)));
  const surgeonShareFcfa = Math.round((total * percent) / 100);
  return {
    totalCostFcfa: total,
    surgeonShareFcfa,
    clinicShareFcfa: total - surgeonShareFcfa,
  };
}
