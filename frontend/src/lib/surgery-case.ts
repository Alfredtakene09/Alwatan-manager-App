export type SurgeryCaseRow = {
  id: string
  status: string
  totalCostFcfa: number
  surgeonShareFcfa: number
  clinicShareFcfa: number
  paidAt?: string | null
  authorizedAt?: string | null
  operationScheduledAt?: string | null
  completedAt?: string | null
  surgeonPaidAt?: string | null
  surgeonPaidById?: string | null
  assistantPaidAt?: string | null
  assistantPaidById?: string | null
  clinicPaidAt?: string | null
  clinicPaidById?: string | null
  createdAt: string
  updatedAt: string
  myShareKind?: 'surgeon' | 'assistant'
  interventionType: {
    id: string
    label: string
    totalCostFcfa: number
    surgeonPercent: number
    anesthesiologistPercent: number
    anesthesiologistName?: string | null
    anesthesiologist?: {
      id: string
      firstName: string
      lastName: string
    } | null
    clinicService?: { id: string; name: string } | null
  }
  surgeon: {
    id: string
    firstName: string
    lastName: string
    employee?: {
      clinicService?: { id: string; name: string } | null
      clinicServiceLinks?: { clinicService?: { id: string; name: string } | null }[]
    } | null
  }
  accountant?: SurgeryUserRef | null
  visit: {
    id: string
    createdBy?: SurgeryUserRef | null
    patient: {
      code: string
      firstName: string
      lastName: string
      phone?: string | null
      service?: string | null
    }
    consultation?: {
      id?: string
      doctorComment?: string | null
      diagnosis?: string | null
    } | null
    assignedClinicService?: { id: string; name: string } | null
  }
  invoice?: {
    id?: string
    invoiceNumber?: string
    status: string
    amountFcfa: number
    paidAmountFcfa: number
    paidAt?: string | null
    type?: string
    billingExamKind?: string | null
    createdAt?: string
    issuedBy?: SurgeryUserRef | null
    payments?: {
      id: string
      amountFcfa: number
      paidAt: string
      recordedBy?: SurgeryUserRef | null
    }[]
  } | null
}

export type SurgeryUserRef = {
  id: string
  firstName: string
  lastName: string
}

export const SURGERY_STATUS_LABELS: Record<string, string> = {
  NOTIFIED: 'En attente de paiement',
  QUOTED: 'Devis en attente',
  PAID: 'Payée',
  AUTHORIZED: 'Autorisée',
  IN_PROGRESS: 'En cours',
  COMPLETED: 'Effectuée',
  CANCELLED: 'Non effectuée',
}

export function formatSurgeryDate(value?: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

export function todayDateInputValue() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Valeur YYYY-MM-DD pour un input date à partir d'une date ISO serveur */
export function operationDateInputFromIso(value?: string | null) {
  if (!value) return todayDateInputValue()
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return todayDateInputValue()
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
