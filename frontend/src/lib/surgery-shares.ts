import type { SurgeryCaseRow } from '@/lib/surgery-case'
import { fullName } from '@/lib/roles'

export type OperationShareBreakdown = {
  totalFcfa: number
  surgeonShareFcfa: number
  assistantShareFcfa: number
  clinicShareFcfa: number
  hasAssistant: boolean
}

export function surgeryCompletedAtIso(surgery: SurgeryCaseRow): string {
  return surgery.completedAt ?? surgery.operationScheduledAt ?? surgery.updatedAt
}

export function computeOperationShares(surgery: SurgeryCaseRow): OperationShareBreakdown {
  const totalFcfa = surgery.totalCostFcfa
  const anestPercent = surgery.interventionType.anesthesiologistPercent ?? 0
  const hasAssistant = anestPercent > 0
  const assistantShareFcfa = hasAssistant ? Math.round((totalFcfa * anestPercent) / 100) : 0
  const surgeonShareFcfa = surgery.surgeonShareFcfa ?? 0
  const clinicShareFcfa = totalFcfa - surgeonShareFcfa - assistantShareFcfa

  return {
    totalFcfa,
    surgeonShareFcfa,
    assistantShareFcfa,
    clinicShareFcfa,
    hasAssistant,
  }
}

export function formatAssistantLabel(surgery: SurgeryCaseRow): string | null {
  const percent = surgery.interventionType.anesthesiologistPercent ?? 0
  if (percent <= 0) return null

  const assistant = surgery.interventionType.anesthesiologist
  if (assistant) {
    return fullName(assistant.firstName, assistant.lastName)
  }

  const name = surgery.interventionType.anesthesiologistName?.trim()
  if (name) return name

  return 'Assistant chirurgie'
}
