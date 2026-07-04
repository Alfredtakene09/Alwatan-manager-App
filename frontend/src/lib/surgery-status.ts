/** Statuts opération payée, en attente de réalisation (aligné backend). */
export const AWAITING_PERFORMANCE_STATUSES = ['PAID', 'AUTHORIZED', 'IN_PROGRESS'] as const

export function isAwaitingPerformance(status: string) {
  return (AWAITING_PERFORMANCE_STATUSES as readonly string[]).includes(status)
}
