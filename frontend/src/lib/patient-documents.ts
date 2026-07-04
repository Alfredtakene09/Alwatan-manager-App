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
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export function formatDocumentDate(value: string) {
  return new Date(value).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}
