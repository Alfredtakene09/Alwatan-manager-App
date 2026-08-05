/** Statuts opération payée, en attente de réalisation (aligné backend). */
export const AWAITING_PERFORMANCE_STATUSES = ['PAID', 'AUTHORIZED', 'IN_PROGRESS'] as const

/** Prescrit / devis — visible médecin avant encaissement patient. */
export const AWAITING_PAYMENT_STATUSES = ['NOTIFIED', 'QUOTED'] as const

export function isAwaitingPerformance(status: string) {
  return (AWAITING_PERFORMANCE_STATUSES as readonly string[]).includes(status)
}

export function isAwaitingPayment(status: string) {
  return (AWAITING_PAYMENT_STATUSES as readonly string[]).includes(status)
}

/** Onglet « En attente » côté médecin : avant ou après paiement, pas encore effectuée. */
export function isDoctorAwaiting(status: string) {
  return isAwaitingPayment(status) || isAwaitingPerformance(status)
}
