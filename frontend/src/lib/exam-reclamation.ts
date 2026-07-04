export type ExamReclamationReason = 'EXAM_MISSING' | 'RESULT_MISSING' | 'ERROR' | 'OTHER'
export type ExamReclamationStatus = 'PENDING' | 'IN_PROGRESS' | 'REFUNDED' | 'REJECTED'

export const EXAM_RECLAMATION_REASON_LABELS: Record<ExamReclamationReason, string> = {
  EXAM_MISSING: 'Examen absent',
  RESULT_MISSING: 'Résultat manquant',
  ERROR: 'Erreur de facturation',
  OTHER: 'Autre',
}

export const EXAM_RECLAMATION_STATUS_LABELS: Record<ExamReclamationStatus, string> = {
  PENDING: 'En attente',
  IN_PROGRESS: 'En traitement',
  REFUNDED: 'Remboursée',
  REJECTED: 'Rejetée',
}

export type ExamReclamationLine = {
  examKind: string
  examLabel: string
  unitPriceFcfa: number
}

export type ExamReclamationRow = {
  id: string
  consultationId: string
  visitId: string
  patientId: string
  examKind: string | null
  examLabel: string | null
  examLines: ExamReclamationLine[]
  totalFcfa: number
  reason: ExamReclamationReason
  reasonDetail: string | null
  status: ExamReclamationStatus
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  patient: { code: string; firstName: string; lastName: string }
  createdBy: { firstName: string; lastName: string }
  handledBy: { firstName: string; lastName: string } | null
}
