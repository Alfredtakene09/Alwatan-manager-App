export type VisitStatusCode =
  | 'WAITING_CONSULTATION'
  | 'IN_CONSULTATION'
  | 'NEEDS_SURGERY'
  | 'NEEDS_HOSPITALIZATION'
  | 'AWAITING_ACCOUNTING'
  | 'IN_TREATMENT'
  | 'COMPLETED'
  | 'CANCELLED'

export type StatusVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

export type VisitStatusMeta = {
  label: string
  level: number
  levelLabel: string
  pole: string
  variant: StatusVariant
}

export const VISIT_STATUS: Record<VisitStatusCode, VisitStatusMeta> = {
  WAITING_CONSULTATION: {
    label: 'Attente consultation',
    level: 1,
    levelLabel: 'Réception',
    pole: 'Réception',
    variant: 'info',
  },
  IN_CONSULTATION: {
    label: 'En consultation',
    level: 2,
    levelLabel: 'Consultation',
    pole: 'Médecin',
    variant: 'primary',
  },
  NEEDS_SURGERY: {
    label: 'Chirurgie notifiée',
    level: 3,
    levelLabel: 'Comptabilité',
    pole: 'Comptabilité',
    variant: 'warning',
  },
  NEEDS_HOSPITALIZATION: {
    label: 'Hospitalisation notifiée',
    level: 3,
    levelLabel: 'Comptabilité',
    pole: 'Comptabilité',
    variant: 'warning',
  },
  AWAITING_ACCOUNTING: {
    label: 'Attente comptable',
    level: 3,
    levelLabel: 'Comptabilité',
    pole: 'Comptabilité',
    variant: 'warning',
  },
  IN_TREATMENT: {
    label: 'En traitement',
    level: 4,
    levelLabel: 'Bloc / Salles',
    pole: 'Bloc & Salles',
    variant: 'success',
  },
  COMPLETED: {
    label: 'Parcours terminé',
    level: 5,
    levelLabel: 'Sortie',
    pole: 'Terminé',
    variant: 'default',
  },
  CANCELLED: {
    label: 'Annulé',
    level: 0,
    levelLabel: '—',
    pole: '—',
    variant: 'danger',
  },
}

export const PIPELINE_LEVELS = [
  { level: 1, label: 'Réception', icon: 'reception' },
  { level: 2, label: 'Consultation', icon: 'consultation' },
  { level: 3, label: 'Comptabilité', icon: 'comptabilite' },
  { level: 4, label: 'Bloc / Salles', icon: 'traitement' },
  { level: 5, label: 'Sortie', icon: 'sortie' },
] as const

export function getVisitStatusMeta(status: string): VisitStatusMeta {
  return VISIT_STATUS[status as VisitStatusCode] ?? {
    label: status,
    level: 0,
    levelLabel: 'Inconnu',
    pole: '—',
    variant: 'default',
  }
}
