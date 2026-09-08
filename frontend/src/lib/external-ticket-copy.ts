/**
 * Libellés et règles du ticket thermique « patient externe » (réception).
 * Isolé de l’impression pour pouvoir tester la logique sans Vue.
 */

export const PAID_STATUS_FR = 'Payé'
export const PENDING_PAYMENT_STATUS_FR = 'En attente de paiement'

/** Clôture professionnelle — le patient externe règle à la réception, pas « en attente ». */
export const EXTERNAL_TICKET_THANKS_KEY = 'Merci de votre confiance'

/** Clés UI que le ticket externe doit avoir dans fr / en / ar. */
export const EXTERNAL_TICKET_I18N_KEYS = [
  'Reçu examens',
  'Date',
  'Patient',
  'Médecin',
  'Paiement',
  'Facture',
  'Sous-total',
  'Réduction',
  'Total',
  'À payer',
  'Payé',
  EXTERNAL_TICKET_THANKS_KEY,
  'Laboratoire',
  'Radio',
  'Écho',
  'Odonto',
  'Opération',
  'Spécialité',
  'Hospitalisation',
] as const

/**
 * Ticket externe : n’afficher « Payé » que si le dossier est réellement facturé.
 * Ne jamais renvoyer le libellé d’attente de paiement (réservé aux tickets labo / gestionnaire).
 */
export function resolveExternalTicketPaidLabel(
  status: string | null | undefined,
): typeof PAID_STATUS_FR | null {
  return (status ?? '').trim() === PAID_STATUS_FR ? PAID_STATUS_FR : null
}

/** Le message « En attente de paiement » reste uniquement sur les tickets où le paiement n’est pas fait à la réception. */
export function shouldPrintPendingPaymentThanks(
  ticketKind: 'external' | 'lab' | 'consultation',
): boolean {
  return ticketKind === 'lab'
}
