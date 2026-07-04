export function splitPatientFullName(value: string): { firstName: string; lastName: string } {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export function joinPatientFullName(firstName: string, lastName: string): string {
  const first = firstName.trim()
  const last = lastName.trim()
  if (!first && !last) return ''
  if (first.toLowerCase() === last.toLowerCase()) return first
  return `${first} ${last}`.trim()
}

export { parsePatientAge, formatPatientAge, normalizePatientAgeUnit } from '@/lib/patient-age'
export type { PatientAgeUnit } from '@/lib/patient-age'
