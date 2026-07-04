import axios from 'axios'
import { useAppModal } from '@/composables/useAppModal'
import { duplicateModalFromApi, isDuplicateApiBody } from '@/lib/duplicate-error'
import type { AppModalOptions, AppModalType } from '@/lib/app-modal'

/** Demande de confirmation via le modal global (remplace window.confirm). */
export async function confirmAppModal(
  options: Pick<AppModalOptions, 'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'onConfirm'> & {
    type?: Extract<AppModalType, 'CONFIRM' | 'DELETE' | 'WARNING'>
  },
): Promise<boolean> {
  const { showModal } = useAppModal()
  return showModal({
    type: options.type ?? 'DELETE',
    title: options.title,
    message: options.message,
    confirmLabel: options.confirmLabel,
    cancelLabel: options.cancelLabel,
    onConfirm: options.onConfirm,
  })
}

export async function showSuccessModal(title: string, message: string) {
  const { showModal } = useAppModal()
  await showModal({ type: 'SUCCESS', title, message })
}


/** Affiche le modal DUPLICATE si la réponse API est un doublon métier. */
export async function showDuplicateModalFromError(
  error: unknown,
  overrides?: Partial<AppModalOptions>,
): Promise<boolean> {
  if (!axios.isAxiosError(error)) return false
  const body = error.response?.data
  if (!isDuplicateApiBody(body)) return false

  const { showModal } = useAppModal()
  await showModal(duplicateModalFromApi(body, overrides))
  return true
}

export async function showApiErrorModal(
  error: unknown,
  fallbackMessage: string,
): Promise<boolean> {
  if (await showDuplicateModalFromError(error)) return true

  const message =
    axios.isAxiosError(error) && typeof error.response?.data?.error === 'string'
      ? error.response.data.error
      : error instanceof Error && error.message
        ? error.message
        : fallbackMessage

  const { showModal } = useAppModal()
  await showModal({ type: 'ERROR', title: 'Erreur', message })
  return true
}
