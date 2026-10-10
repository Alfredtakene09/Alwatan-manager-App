export function foldOperationServiceName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export const ORTHO_TRAUMA_BUTTON_LABEL = 'Orthopédie & Tromatologie'

export function isOrthoTraumaServiceName(serviceName: string): boolean {
  const folded = foldOperationServiceName(serviceName)
  return (
    folded.includes('orthop') ||
    folded.includes('ortoped') ||
    folded.includes('traumat') ||
    folded.includes('tromato') ||
    folded.includes('tromoto')
  )
}

/** Gynécologie, Orthopédie et Traumatologie ensemble, Chirurgie générale, puis les autres services. */
export function operationServiceGroup(serviceName: string): { key: string; title: string } {
  const folded = foldOperationServiceName(serviceName)
  if (isOrthoTraumaServiceName(serviceName)) {
    return { key: 'ortho-trauma', title: ORTHO_TRAUMA_BUTTON_LABEL }
  }
  if (!folded || folded === '—' || folded === '-') {
    return { key: 'autre', title: 'Autre service' }
  }
  return { key: folded, title: serviceName.trim() }
}

export const OPERATION_SERVICE_GROUP_RANK: Record<string, number> = {
  gynecologie: 0,
  'ortho-trauma': 1,
  'chirurgie generale': 2,
}

export function compareOperationServiceGroups(
  a: { key: string; title: string },
  b: { key: string; title: string },
): number {
  const rankA = OPERATION_SERVICE_GROUP_RANK[a.key] ?? 100
  const rankB = OPERATION_SERVICE_GROUP_RANK[b.key] ?? 100
  if (rankA !== rankB) return rankA - rankB
  return a.title.localeCompare(b.title, 'fr')
}
