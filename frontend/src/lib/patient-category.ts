export type PatientCategory = 'STANDARD' | 'ASSOCIE' | 'ONG' | 'PERSONNEL'

export const PATIENT_CATEGORIES: {
  value: PatientCategory
  label: string
  hint: string
}[] = [
  { value: 'STANDARD', label: 'Standard', hint: 'Paiement et facture immédiats' },
  { value: 'ASSOCIE', label: 'Associé / enfant', hint: 'Exonéré — aucun frais' },
  { value: 'PERSONNEL', label: 'Personnel', hint: 'Parcours gratuit — recommandé par un membre du personnel' },
]

/**
 * Catégories proposées à l'enregistrement standard (sans ONG ni Personnel).
 * Le parcours Personnel dispose de sa propre page dédiée.
 */
export const RECEPTION_DASHBOARD_CATEGORIES = PATIENT_CATEGORIES.filter(
  (category) => category.value !== 'PERSONNEL',
)

export function isExemptCategory(category: PatientCategory) {
  return category === 'ASSOCIE' || category === 'PERSONNEL'
}

export function isDeferredCategory(_category: PatientCategory) {
  return false
}

/** Réduction et encart total — uniquement pour les patients Standard. */
export function showConsultationBillingSummary(category: PatientCategory) {
  return category === 'STANDARD'
}

export function patientCategoryLabel(category: PatientCategory) {
  if (category === 'ONG') return 'Standard'
  return PATIENT_CATEGORIES.find((c) => c.value === category)?.label ?? category
}
