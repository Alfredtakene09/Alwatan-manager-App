import type { SurgeryCaseRow } from '@/lib/surgery-case'
import { fullName } from '@/lib/roles'

export type OperationShareBreakdown = {
  totalFcfa: number
  surgeonShareFcfa: number
  assistantShareFcfa: number
  clinicShareFcfa: number
  hasAssistant: boolean
}

/**
 * Date colonne / filtres = date d'enregistrement saisie (créée ou modifiée).
 * Ne pas utiliser updatedAt : il vaut « maintenant » à chaque sauvegarde et écrase la date choisie.
 */
export function surgeryCompletedAtIso(surgery: SurgeryCaseRow): string {
  if (surgery.invoice?.createdAt) return surgery.invoice.createdAt
  return (
    surgery.completedAt ??
    surgery.operationScheduledAt ??
    surgery.invoice?.paidAt ??
    surgery.updatedAt
  )
}

/** Les % ne s'appliquent qu'au montant encaissé. */
function collectedBaseFcfa(surgery: SurgeryCaseRow) {
  const billed = Math.max(0, surgery.totalCostFcfa || surgery.invoice?.amountFcfa || 0)
  let paid = Math.max(0, surgery.invoice?.paidAmountFcfa ?? 0)
  if (surgery.invoice?.status === 'PAID' && billed > paid) paid = billed
  if (paid <= 0) return 0
  return billed > 0 ? Math.min(paid, billed) : paid
}

export function operationSurgeonPercent(surgery: SurgeryCaseRow) {
  if (surgery.surgeonPercent != null && surgery.surgeonPercent > 0) return surgery.surgeonPercent
  const billed = Math.max(0, surgery.totalCostFcfa || 0)
  const stored = surgery.surgeonShareFcfa ?? 0
  const catalog = surgery.interventionType.surgeonPercent ?? 0
  if (billed > 0 && stored > 0) {
    const derived = Math.round((stored * 100) / billed)
    if (catalog > 0 && Math.abs(derived - catalog) <= 1) return catalog
    return derived
  }
  return catalog
}

function recordedAssistant(surgery: SurgeryCaseRow) {
  if (surgery.anesthesiologistPercent != null || surgery.anesthesiologistId) {
    return {
      percent: surgery.anesthesiologistPercent ?? 0,
      person: surgery.anesthesiologist ?? null,
      name: '',
    }
  }
  return {
    percent: surgery.interventionType.anesthesiologistPercent ?? 0,
    person: surgery.interventionType.anesthesiologist ?? null,
    name: surgery.interventionType.anesthesiologistName?.trim() || '',
  }
}

export function computeOperationShares(surgery: SurgeryCaseRow): OperationShareBreakdown {
  const totalFcfa = surgery.totalCostFcfa
  const baseFcfa = collectedBaseFcfa(surgery)
  const anestPercent = recordedAssistant(surgery).percent
  const hasAssistant = anestPercent > 0
  const assistantShareFcfa = hasAssistant ? Math.round((baseFcfa * anestPercent) / 100) : 0
  const surgeonPercent = operationSurgeonPercent(surgery)
  const surgeonShareFcfa = surgeonPercent > 0 ? Math.round((baseFcfa * surgeonPercent) / 100) : 0
  const clinicShareFcfa = Math.max(0, baseFcfa - surgeonShareFcfa - assistantShareFcfa)

  return {
    totalFcfa,
    surgeonShareFcfa,
    assistantShareFcfa,
    clinicShareFcfa,
    hasAssistant,
  }
}

export function formatAssistantLabel(surgery: SurgeryCaseRow): string | null {
  const assistant = recordedAssistant(surgery)
  if (assistant.percent <= 0) return null
  if (assistant.person) return fullName(assistant.person.firstName, assistant.person.lastName)
  if (assistant.name) return assistant.name
  return 'Anesthésiste'
}
