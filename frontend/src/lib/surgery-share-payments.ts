import type { SurgeryCaseRow } from '@/lib/surgery-case'
import { computeOperationShares } from '@/lib/surgery-shares'
import { formatFcfa } from '@/lib/roles'

export type OperationShareKind = 'surgeon' | 'assistant' | 'clinic'

export const SHARE_KIND_LABELS: Record<OperationShareKind, string> = {
  surgeon: 'Médecin',
  assistant: 'Assistant',
  clinic: 'Clinique',
}

export function surgeryHasAssistant(surgery: SurgeryCaseRow): boolean {
  return (surgery.interventionType.anesthesiologistPercent ?? 0) > 0
}

export function getApplicableShareKinds(surgery: SurgeryCaseRow): OperationShareKind[] {
  const kinds: OperationShareKind[] = ['surgeon']
  if (surgeryHasAssistant(surgery)) {
    kinds.push('assistant')
  }
  kinds.push('clinic')
  return kinds
}

export function isSharePaid(surgery: SurgeryCaseRow, kind: OperationShareKind): boolean {
  switch (kind) {
    case 'surgeon':
      return Boolean(surgery.surgeonPaidAt)
    case 'assistant':
      return Boolean(surgery.assistantPaidAt)
    case 'clinic':
      return Boolean(surgery.clinicPaidAt)
  }
}

export function hasAnySharePaid(surgery: SurgeryCaseRow): boolean {
  return getApplicableShareKinds(surgery).some((kind) => isSharePaid(surgery, kind))
}

export function isFullyPaid(surgery: SurgeryCaseRow): boolean {
  return getApplicableShareKinds(surgery).every((kind) => isSharePaid(surgery, kind))
}

export function getUnpaidShareKinds(surgery: SurgeryCaseRow): OperationShareKind[] {
  return getApplicableShareKinds(surgery).filter((kind) => !isSharePaid(surgery, kind))
}

export function getShareAmountFcfa(surgery: SurgeryCaseRow, kind: OperationShareKind): number {
  const shares = computeOperationShares(surgery)
  switch (kind) {
    case 'surgeon':
      return shares.surgeonShareFcfa
    case 'assistant':
      return shares.assistantShareFcfa
    case 'clinic':
      return shares.clinicShareFcfa
  }
}

export function formatSharePaymentLine(surgery: SurgeryCaseRow, kind: OperationShareKind): string {
  const paid = isSharePaid(surgery, kind)
  const amount = formatFcfa(getShareAmountFcfa(surgery, kind))
  return `${SHARE_KIND_LABELS[kind]} ${amount}${paid ? ' ✓' : ''}`
}

export function sumUnpaidShareAmounts(
  surgeries: SurgeryCaseRow[],
  kind?: OperationShareKind,
): number {
  return surgeries.reduce((sum, surgery) => {
    const kinds = kind ? [kind] : getUnpaidShareKinds(surgery)
    return sum + kinds.reduce((part, shareKind) => part + getShareAmountFcfa(surgery, shareKind), 0)
  }, 0)
}

export function countUnpaidShares(surgeries: SurgeryCaseRow[]): number {
  return surgeries.reduce((sum, surgery) => sum + getUnpaidShareKinds(surgery).length, 0)
}

export function getDoctorShareKind(
  surgery: SurgeryCaseRow,
  userId: string,
): OperationShareKind | null {
  if (surgery.surgeon.id === userId) return 'surgeon'
  const assistant = surgery.interventionType.anesthesiologist
  if (
    assistant?.id === userId &&
    (surgery.interventionType.anesthesiologistPercent ?? 0) > 0
  ) {
    return 'assistant'
  }
  return null
}

export function getSharePaidAt(surgery: SurgeryCaseRow, kind: OperationShareKind): string | null {
  switch (kind) {
    case 'surgeon':
      return surgery.surgeonPaidAt ?? null
    case 'assistant':
      return surgery.assistantPaidAt ?? null
    case 'clinic':
      return surgery.clinicPaidAt ?? null
  }
}
