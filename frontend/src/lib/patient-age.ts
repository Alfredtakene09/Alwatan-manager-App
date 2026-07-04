export type PatientAgeUnit = 'YEARS' | 'MONTHS' | 'DAYS'

export const PATIENT_AGE_UNITS: { value: PatientAgeUnit; label: string; max: number; placeholder: string }[] = [
  { value: 'YEARS', label: 'Ans', max: 150, placeholder: 'Ex. 32' },
  { value: 'MONTHS', label: 'Mois', max: 23, placeholder: 'Ex. 8' },
  { value: 'DAYS', label: 'Jours', max: 60, placeholder: 'Ex. 15' },
]

export function ageUnitMax(unit: PatientAgeUnit): number {
  return PATIENT_AGE_UNITS.find((row) => row.value === unit)?.max ?? 150
}

export function parsePatientAge(value: string, unit: PatientAgeUnit = 'YEARS'): number | null {
  const age = Number(value)
  const max = ageUnitMax(unit)
  if (!Number.isInteger(age) || age < 0 || age > max) return null
  return age
}

export function formatPatientAge(
  age: number | null | undefined,
  unit: PatientAgeUnit = 'YEARS',
): string | null {
  if (age == null) return null
  if (unit === 'MONTHS') return `${age} mois`
  if (unit === 'DAYS') return `${age} jour${age > 1 ? 's' : ''}`
  return `${age} an${age > 1 ? 's' : ''}`
}

export function normalizePatientAgeUnit(unit?: string | null): PatientAgeUnit {
  if (unit === 'MONTHS' || unit === 'DAYS') return unit
  return 'YEARS'
}
