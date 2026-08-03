import { formatAppDate } from '@/i18n/locale-format'
import { translateTemplate } from '@/lib/dashboard-i18n'

export type PatientDocumentKind = 'EXAMEN' | 'ODONTO' | 'RADIO' | 'ECHO' | 'CONSULTATION' | 'AUTRE'

export const PATIENT_DOCUMENT_KIND_LABELS: Record<PatientDocumentKind, string> = {
  EXAMEN: 'Examen',
  ODONTO: 'Odonto',
  RADIO: 'Radio',
  ECHO: 'Écho',
  CONSULTATION: 'Consultation',
  AUTRE: 'Autre',
}

export const PATIENT_DOCUMENT_KINDS = Object.keys(
  PATIENT_DOCUMENT_KIND_LABELS,
) as PatientDocumentKind[]

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return translateTemplate('{n} o', { n: bytes })
  if (bytes < 1024 * 1024) {
    return translateTemplate('{n} Ko', { n: (bytes / 1024).toFixed(1) })
  }
  return translateTemplate('{n} Mo', { n: (bytes / (1024 * 1024)).toFixed(1) })
}

export function formatDocumentDate(value: string) {
  return formatAppDate(value, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}
