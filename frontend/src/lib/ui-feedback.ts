/**
 * Convention feedback UI (Phase 5)
 *
 * - Confirmations destructives / warnings → confirmAppModal()
 * - Erreurs API (création, paiement, suppression) → showApiErrorModal()
 *   (+ bannière UiAlert optionnelle sur la page pour le contexte)
 * - Succès ponctuels importants (paiement, transfert) → showSuccessModal()
 *   ou UiAlert type="success" en haut de page si l’utilisateur reste sur l’écran
 * - Ne plus utiliser window.confirm / window.alert
 */
export {
  confirmAppModal,
  showApiErrorModal,
  showSuccessModal,
  showDuplicateModalFromError,
} from './api-modal-helper'
