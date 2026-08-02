import { computed, onMounted, onUnmounted, shallowRef, type ComputedRef } from 'vue'

/**
 * Cible Teleport pour les modales : l’élément en plein écran s’il existe,
 * sinon `body`. Sinon les overlays hors de l’élément fullscreen restent invisibles.
 */
const fullscreenElement = shallowRef<Element | null>(null)
let subscribers = 0

function syncFullscreenElement() {
  fullscreenElement.value = document.fullscreenElement
}

export function useModalTeleportTarget(): ComputedRef<string | Element> {
  onMounted(() => {
    if (subscribers === 0) {
      document.addEventListener('fullscreenchange', syncFullscreenElement)
      syncFullscreenElement()
    }
    subscribers += 1
  })

  onUnmounted(() => {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers === 0) {
      document.removeEventListener('fullscreenchange', syncFullscreenElement)
    }
  })

  return computed(() => fullscreenElement.value ?? 'body')
}
