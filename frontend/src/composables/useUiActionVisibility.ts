import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { isUiActionAllowed } from '@/lib/ui-actions'

export function useUiActionVisibility() {
  const auth = useAuthStore()

  function canSeeUiAction(actionId: string) {
    return isUiActionAllowed(auth.user, actionId)
  }

  const hiddenUiActions = computed(() => auth.user?.hiddenUiActions ?? [])

  return { canSeeUiAction, hiddenUiActions }
}
