export type PatientCategory = 'STANDARD' | 'ASSOCIE' | 'ONG' | 'PERSONNEL'

export const PATIENT_CATEGORIES: {
  value: PatientCategory
  label: string
  hint: string
}[] = [
  { value: 'STANDARD', label: 'Standard', hint: 'Paiement et facture immédiats' },
  { value: 'ASSOCIE', label: 'Associé / enfant', hint: 'Exonéré — aucun frais' },
  { value: 'PERSONNEL', label: 'Personnel', hint: 'Réduction sur tout le parcours (20 % par défaut)' },
]

/**
 * Catégories proposées à l'enregistrement standard (sans ONG ni Personnel).
 * Le parcours Personnel dispose de sa propre page dédiée.
 */
export const RECEPTION_DASHBOARD_CATEGORIES = PATIENT_CATEGORIES.filter(
  (category) => category.value !== 'PERSONNEL',
)

export function isExemptCategory(category: PatientCategory) {
  return category === 'ASSOCIE'
}

/** Réduction par défaut d'un patient personnel sur tout son parcours. */
export const DEFAULT_STAFF_DISCOUNT_PERCENT = 20

/** % de réduction du patient (personnel uniquement, 20 % si non renseigné). Même règle que le serveur. */
export function patientDiscountPercent(
  patient: { category?: string | null; discountPercent?: number | null } | null | undefined,
) {
  if (!patient || patient.category !== 'PERSONNEL') return 0
  const percent = patient.discountPercent ?? DEFAULT_STAFF_DISCOUNT_PERCENT
  return Math.min(100, Math.max(0, Math.round(percent)))
}

export function patientDiscountFcfa(
  patient: { category?: string | null; discountPercent?: number | null } | null | undefined,
  grossFcfa: number,
) {
  const percent = patientDiscountPercent(patient)
  return percent > 0 && grossFcfa > 0 ? Math.round((grossFcfa * percent) / 100) : 0
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
