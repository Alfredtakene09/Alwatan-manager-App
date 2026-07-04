export type AppModalType =
  | 'CONFIRM'
  | 'DELETE'
  | 'SUCCESS'
  | 'WARNING'
  | 'DUPLICATE'
  | 'ERROR'
  | 'INFO'

export type AppModalOptions = {
  type: AppModalType
  title: string
  message: string
  existingData?: Record<string, string | number | null | undefined>
  confirmLabel?: string
  cancelLabel?: string
  /** Si false, masque le bouton annuler (ex. SUCCESS / INFO). */
  showCancel?: boolean
  onConfirm?: () => void | Promise<void>
  onCancel?: () => void
}

export type AppModalState = AppModalOptions & {
  open: boolean
  confirmLabel: string
  cancelLabel: string
  showCancel: boolean
}

export const APP_MODAL_DEFAULT_LABELS: Record<
  AppModalType,
  { confirm: string; cancel: string; showCancel: boolean }
> = {
  CONFIRM: { confirm: 'Confirmer', cancel: 'Annuler', showCancel: true },
  DELETE: { confirm: 'Supprimer', cancel: 'Annuler', showCancel: true },
  SUCCESS: { confirm: 'OK', cancel: 'Fermer', showCancel: false },
  WARNING: { confirm: 'Continuer', cancel: 'Annuler', showCancel: true },
  DUPLICATE: { confirm: 'Compris', cancel: 'Annuler', showCancel: true },
  ERROR: { confirm: 'OK', cancel: 'Fermer', showCancel: false },
  INFO: { confirm: 'OK', cancel: 'Fermer', showCancel: false },
}
