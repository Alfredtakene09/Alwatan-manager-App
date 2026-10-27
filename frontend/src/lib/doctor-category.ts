export type DoctorCategory = 'GENERALISTE' | 'SPECIALISTE' | 'AUTRE'

export const DOCTOR_CATEGORY_OPTIONS: { value: DoctorCategory; label: string; hint: string }[] = [
  { value: 'GENERALISTE', label: 'Généraliste', hint: 'Médecine générale' },
  { value: 'SPECIALISTE', label: 'Spécialiste', hint: 'Chirurgie, gynéco, ophtalmo…' },
  { value: 'AUTRE', label: 'Autre', hint: 'Interne, kiné, stagiaire…' },
]

export const DOCTOR_CATEGORY_LABEL: Record<DoctorCategory, string> = {
  GENERALISTE: 'Généraliste',
  SPECIALISTE: 'Spécialiste',
  AUTRE: 'Autre médecin',
}

/** Filtre « Catégorie » partagé : employés, paie du mois, historique. '' = tous. */
export type StaffCategoryFilter = '' | 'PERSONNEL' | 'MEDECIN' | DoctorCategory

export const STAFF_CATEGORY_FILTER_OPTIONS: { value: StaffCategoryFilter; label: string }[] = [
  { value: '', label: 'Toutes les catégories' },
  { value: 'PERSONNEL', label: 'Personnel' },
  { value: 'MEDECIN', label: 'Médecins (tous)' },
  { value: 'GENERALISTE', label: 'Médecins généralistes' },
  { value: 'SPECIALISTE', label: 'Médecins spécialistes' },
  { value: 'AUTRE', label: 'Autres médecins' },
]

export function staffCategoryFilterLabel(filter: StaffCategoryFilter): string {
  return STAFF_CATEGORY_FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? ''
}

export function matchesStaffCategory(
  filter: StaffCategoryFilter,
  employee: { isMedecin?: boolean; doctorCategory?: DoctorCategory | null },
): boolean {
  if (!filter) return true
  if (filter === 'PERSONNEL') return !employee.isMedecin
  if (!employee.isMedecin) return false
  if (filter === 'MEDECIN') return true
  return employee.doctorCategory === filter
}

/** « Médecin · Spécialiste » ou « Personnel ». */
export function staffCategoryLabel(employee: {
  isMedecin?: boolean
  doctorCategory?: DoctorCategory | null
}): string {
  if (!employee.isMedecin) return 'Personnel'
  return employee.doctorCategory
    ? `Médecin · ${DOCTOR_CATEGORY_OPTIONS.find((o) => o.value === employee.doctorCategory)?.label}`
    : 'Médecin'
}
