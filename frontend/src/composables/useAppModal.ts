import { reactive } from 'vue'
import {
  APP_MODAL_DEFAULT_LABELS,
  type AppModalOptions,
  type AppModalState,
} from '@/lib/app-modal'

const state = reactive<AppModalState>({
  open: false,
  type: 'INFO',
  title: '',
  message: '',
  confirmLabel: 'OK',
  cancelLabel: 'Fermer',
  showCancel: false,
})

let resolvePromise: ((confirmed: boolean) => void) | null = null

function applyDefaults(options: AppModalOptions) {
  const defaults = APP_MODAL_DEFAULT_LABELS[options.type]
  state.type = options.type
  state.title = options.title
  state.message = options.message
  state.existingData = options.existingData
  state.confirmLabel = options.confirmLabel ?? defaults.confirm
  state.cancelLabel = options.cancelLabel ?? defaults.cancel
  state.showCancel = options.showCancel ?? defaults.showCancel
  state.onConfirm = options.onConfirm
  state.onCancel = options.onCancel
  state.open = true
}

function close(confirmed: boolean) {
  state.open = false
  resolvePromise?.(confirmed)
  resolvePromise = null
}

export function useAppModal() {
  function showModal(options: AppModalOptions): Promise<boolean> {
    applyDefaults(options)
    return new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    })
  }

  async function confirmModal() {
    try {
      await state.onConfirm?.()
    } finally {
      close(true)
    }
  }

  function cancelModal() {
    state.onCancel?.()
    close(false)
  }

  return {
    state,
    showModal,
    confirmModal,
    cancelModal,
  }
}

/** Raccourci global — même instance partagée que AppModalHost. */
export function showAppModal(options: AppModalOptions) {
  return useAppModal().showModal(options)
}
