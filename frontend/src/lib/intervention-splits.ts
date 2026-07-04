export function clinicPercentFromSplits(surgeonPercent: number, anesthesiologistPercent: number) {
  return Math.max(0, 100 - surgeonPercent - anesthesiologistPercent)
}

export function validateInterventionPercents(surgeonPercent: number, anesthesiologistPercent: number) {
  if (surgeonPercent < 1 || surgeonPercent > 99) {
    return 'Le pourcentage chirurgien doit être entre 1 et 99.'
  }
  if (anesthesiologistPercent < 0 || anesthesiologistPercent > 99) {
    return 'Le pourcentage assistant chirurgie doit être entre 0 et 99.'
  }
  if (surgeonPercent + anesthesiologistPercent > 100) {
    return 'La somme chirurgien + assistant chirurgie ne peut pas dépasser 100 %.'
  }
  return null
}
